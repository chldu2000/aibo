//! Restart recovery owns the ordering between turn evidence and durable state.
use crate::{
    change_set::{
        capture_message as capture_workspace, persist_message as persist_change_set, FileState, WorkspaceSnapshot,
    },
    now_iso,
};
use sqlx::{Row, SqlitePool};
use std::{collections::BTreeSet, path::Path};

#[derive(Debug)]
pub(crate) struct Recovery {
    pub(crate) sessions: u64,
    pub(crate) change_sets: u64,
}

/// Rebuild evidence while turns are still running, then atomically normalize
/// durable runtime state. A failed step can be retried before any runtime starts.
pub(crate) async fn recover(db: &SqlitePool) -> Result<Recovery, String> {
    let change_sets = recover_interrupted_turn_changes(db).await?;
    let sessions = recover_interrupted_sessions(db)
        .await
        .map_err(|error| format!("recover interrupted sessions: {error}"))?;
    Ok(Recovery {
        sessions,
        change_sets,
    })
}

/// A process-local runtime cannot survive an application restart. Normalize
/// durable running state before exposing the database to the UI so a stale
/// session is recoverable instead of appearing to be actively executing.
async fn recover_interrupted_sessions(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE session_queues SET paused=1")
        .execute(&mut *tx)
        .await?;
    let display = crate::ui_i18n::HostMessage::new("native.queue.restarted", serde_json::json!({}));
    sqlx::query("UPDATE queued_messages SET status='uncertain',error=?,localized_error_json=? WHERE status='sending'")
        .bind(display.diagnostic).bind(display.localized.map(|value|value.to_string())).execute(&mut *tx).await?;
    let now = now_iso();
    sqlx::query(
        "UPDATE process_runs SET state = 'crashed', ended_at = ?
         WHERE state IN ('starting', 'running', 'stopping') AND session_id IN (
           SELECT id FROM sessions WHERE archived = 0
             AND state IN ('starting', 'running', 'waiting_approval', 'waiting_user', 'compacting')
         )",
    )
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE messages SET status = 'failed', updated_at = ?
         WHERE status IN ('streaming', 'queued') AND session_id IN (
           SELECT id FROM sessions WHERE archived = 0
             AND state IN ('starting', 'running', 'waiting_approval', 'waiting_user', 'compacting')
         )",
    )
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE turns SET status = 'interrupted', completed_at = ?
         WHERE status = 'running' AND session_id IN (
           SELECT id FROM sessions WHERE archived = 0
             AND state IN ('starting', 'running', 'waiting_approval', 'waiting_user', 'compacting')
         )",
    )
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    let result = sqlx::query(
        "UPDATE sessions SET state = 'interrupted', updated_at = ?
         WHERE archived = 0 AND state IN ('starting', 'running', 'waiting_approval', 'waiting_user', 'compacting')",
    )
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected())
}

/// Normalize an adapter crash while the application is still running. Startup
/// recovery covers the same durable states after a process restart, but an
/// in-process crash must not leave the active turn looking as if it is still
/// streaming until the next launch.
pub(crate) async fn mark_turn_interrupted(
    db: &SqlitePool,
    session_id: &str,
    turn_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let now = now_iso();
    sqlx::query(
        "UPDATE turns SET status = 'interrupted', completed_at = ?
         WHERE id = ? AND session_id = ? AND status = 'running'",
    )
    .bind(&now)
    .bind(turn_id)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE messages SET status = 'failed', updated_at = ?
         WHERE session_id = ? AND turn_id = ? AND status IN ('streaming', 'queued')",
    )
    .bind(now)
    .bind(session_id)
    .bind(turn_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Rebuild a durable, unknown-attribution change set for turns that were
/// interrupted before an adapter could emit its terminal event. The baseline
/// bytes/metadata already captured before the restart remain authoritative;
/// the post-restart workspace snapshot is intentionally not attributed to the
/// Agent because it may include edits made after the crash.
async fn recover_interrupted_turn_changes(db: &SqlitePool) -> Result<u64, String> {
    let rows = sqlx::query(
        "SELECT turns.id, turns.session_id, turns.external_turn_id,
                sessions.workspace_id, workspaces.path
         FROM turns
         JOIN sessions ON sessions.id = turns.session_id
         JOIN workspaces ON workspaces.id = sessions.workspace_id
         WHERE turns.status = 'running'",
    )
    .fetch_all(db)
    .await
    .map_err(|error| format!("read interrupted turns: {error}"))?;
    let mut recovered = 0_u64;
    for row in rows {
        let turn_id: String = row
            .try_get("id")
            .map_err(|error| format!("read interrupted turn id: {error}"))?;
        let session_id: String = row
            .try_get("session_id")
            .map_err(|error| format!("read interrupted session id: {error}"))?;
        let workspace_id: String = row
            .try_get("workspace_id")
            .map_err(|error| format!("read interrupted workspace id: {error}"))?;
        let workspace_path: String = row
            .try_get("path")
            .map_err(|error| format!("read interrupted workspace path: {error}"))?;
        let existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM turn_change_sets WHERE session_id = ? AND turn_id = ?",
        )
        .bind(&session_id)
        .bind(&turn_id)
        .fetch_one(db)
        .await
        .map_err(|error| format!("check interrupted change set: {error}"))?;
        if existing > 0 {
            continue;
        }
        let checkpoint_rows = sqlx::query(
            "SELECT path, file_exists, content_hash, size, baseline_head, baseline_dirty,
                    created_at
             FROM checkpoints WHERE session_id = ? AND turn_id = ? ORDER BY path ASC",
        )
        .bind(&session_id)
        .bind(&turn_id)
        .fetch_all(db)
        .await
        .map_err(|error| format!("read interrupted checkpoint: {error}"))?;
        if checkpoint_rows.is_empty() {
            // A crash can happen before the adapter finishes writing the
            // baseline checkpoint. Keep a durable, non-restorable record so
            // the interrupted turn is still visible after restart instead of
            // silently disappearing from Changes.
            let (result, capture_error) = match capture_workspace(Path::new(&workspace_path)).await
            {
                Ok(snapshot) => (
                    Some(snapshot),
                    crate::ui_i18n::HostMessage::new("native.recovery.noBaseline", serde_json::json!({})),
                ),
                Err(error) => (None, crate::ui_i18n::HostMessage::with_diagnostic("native.recovery.captureFailed", serde_json::json!({"error":error.display()}),format!("应用重启后重建；无法采集结果：{}",error.diagnostic))),
            };
            let change_set_id = persist_change_set(
                db,
                &workspace_id,
                &session_id,
                &turn_id,
                None,
                result.as_ref(),
                Some(&capture_error),
            )
            .await
            .map_err(|error| format!("persist interrupted change set: {error}"))?;
            sqlx::query(
                "UPDATE turn_change_sets
                 SET attribution = 'unknown', localized_capture_error_json = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(capture_error.localized.map(|value|value.to_string()))
            .bind(now_iso())
            .bind(&change_set_id)
            .execute(db)
            .await
            .map_err(|error| format!("mark interrupted change set unknown: {error}"))?;
            recovered = recovered.saturating_add(1);
            continue;
        }
        let mut files = Vec::with_capacity(checkpoint_rows.len());
        let mut dirty_paths = BTreeSet::new();
        let mut baseline_head = None;
        let mut baseline_dirty = false;
        let mut captured_at = None;
        for checkpoint in checkpoint_rows {
            let path: String = checkpoint
                .try_get("path")
                .map_err(|error| format!("read checkpoint path: {error}"))?;
            let exists = checkpoint
                .try_get::<i64, _>("file_exists")
                .map_err(|error| format!("read checkpoint existence: {error}"))?
                != 0;
            let hash: Option<String> = checkpoint
                .try_get("content_hash")
                .map_err(|error| format!("read checkpoint hash: {error}"))?;
            let size = checkpoint
                .try_get::<Option<i64>, _>("size")
                .map_err(|error| format!("read checkpoint size: {error}"))?
                .and_then(|value| u64::try_from(value).ok());
            let dirty = checkpoint
                .try_get::<i64, _>("baseline_dirty")
                .map_err(|error| format!("read checkpoint attribution: {error}"))?
                != 0;
            if dirty {
                dirty_paths.insert(path.clone());
                baseline_dirty = true;
            }
            if baseline_head.is_none() {
                baseline_head = checkpoint
                    .try_get::<Option<String>, _>("baseline_head")
                    .map_err(|error| format!("read checkpoint head: {error}"))?;
            }
            if captured_at.is_none() {
                captured_at = checkpoint
                    .try_get::<Option<String>, _>("created_at")
                    .map_err(|error| format!("read checkpoint timestamp: {error}"))?;
            }
            files.push(FileState {
                path,
                exists,
                hash,
                size,
            });
        }
        let baseline = WorkspaceSnapshot {
            head: baseline_head,
            dirty: baseline_dirty,
            captured_at: captured_at.unwrap_or_else(now_iso),
            files,
            dirty_paths,
        };
        let (result, capture_error) = match capture_workspace(Path::new(&workspace_path)).await {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error)),
        };
        let change_set_id = persist_change_set(
            db,
            &workspace_id,
            &session_id,
            &turn_id,
            Some(&baseline),
            result.as_ref(),
            capture_error.as_ref(),
        )
        .await
        .map_err(|error| format!("persist interrupted change set: {error}"))?;
        let recovery = crate::ui_i18n::HostMessage::new("native.recovery.uncertainContent", serde_json::json!({}));
        sqlx::query(
            "UPDATE turn_change_sets
             SET attribution = 'unknown',
                 localized_capture_error_json = CASE WHEN capture_error IS NULL THEN ? ELSE localized_capture_error_json END,
                 capture_error = COALESCE(capture_error, ?), updated_at = ?
             WHERE id = ?",
        )
        .bind(recovery.localized.map(|value|value.to_string()))
        .bind(recovery.diagnostic)
        .bind(now_iso())
        .bind(&change_set_id)
        .execute(db)
        .await
        .map_err(|error| format!("mark interrupted change set unknown: {error}"))?;
        recovered = recovered.saturating_add(1);
    }
    Ok(recovered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        change_set::{persist_baseline_checkpoint, persist_checkpoint_metadata},
        open_database,
    };
    use std::{fs, path::PathBuf};
    use ulid::Ulid;
    fn test_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("aibo-recovery-{}", Ulid::new()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[tokio::test]
    async fn failed_restart_capture_retains_nested_display_in_both_checkpoint_paths() {
        use crate::ui_i18n::{Locale, render};
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("app.db");
        let root = directory.path().join("workspace{path}");fs::create_dir(&root).unwrap();fs::write(root.join("file.txt"),"原始正文").unwrap();
        let db = open_database(&path).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'原文',1,'now','now')").bind(root.to_str().unwrap()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('s','w','third.party','原文','running','now','now')").execute(&db).await.unwrap();
        for turn in ["with-checkpoint","without-checkpoint"] {
            sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES(?,'s',?,'running','输入原文{input}','now')").bind(turn).bind(turn).execute(&db).await.unwrap();
        }
        let checkpoint_root = directory.path().join("checkpoints");
        let baseline = capture_workspace(&root).await.unwrap();
        persist_baseline_checkpoint(&checkpoint_root,"s","with-checkpoint",&root,&baseline).await.unwrap();
        persist_checkpoint_metadata(&db,&checkpoint_root,"w","s","with-checkpoint",&baseline).await.unwrap();
        let stored: String = sqlx::query_scalar("SELECT storage_path FROM checkpoints WHERE turn_id='with-checkpoint'").fetch_one(&db).await.unwrap();
        let stored = directory.path().join(stored);
        let checkpoint_before = fs::read(&stored).unwrap();
        fs::remove_dir_all(&root).unwrap();
        let os = fs::canonicalize(&root).unwrap_err().to_string();
        let diagnostic = format!("canonicalize workspace: {os}");
        let result = recover(&db).await.unwrap();assert_eq!(result.change_sets,2);assert_eq!(result.sessions,1);
        let mut persisted = Vec::new();
        for turn in ["with-checkpoint","without-checkpoint"] {
            let value = serde_json::to_value(crate::turn_changes::get_turn_change_set("s".into(),Some(turn.into()),&db).await.unwrap().unwrap()).unwrap();
            assert_eq!(value["attribution"],"unknown");
            assert_eq!(value["captureStatus"],if turn=="with-checkpoint" {"partial"} else {"failed"});
            let display = &value["localizedCaptureError"];
            if turn=="with-checkpoint" {
                assert_eq!(value["captureError"],diagnostic);assert_eq!(display["key"],"native.changes.canonicalize");assert_eq!(display["params"]["error"],os);
                assert_eq!(render(Locale::ZhCn,display),format!("无法解析工作区路径：{os}"));
            } else {
                assert_eq!(value["captureError"],format!("应用重启后重建；无法采集结果：{diagnostic}"));assert_eq!(display["key"],"native.recovery.captureFailed");
                assert_eq!(display["params"]["error"]["key"],"native.changes.canonicalize");
                assert_eq!(render(Locale::ZhCn,display),format!("应用重启后重建；无法采集结果：无法解析工作区路径：{os}"));
            }
            assert!(render(Locale::En,display).contains(&diagnostic));persisted.push((turn,value));
        }
        assert_eq!(fs::read(&stored).unwrap(),checkpoint_before);assert!(!root.exists());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM turns WHERE status='interrupted' AND input_text='输入原文{input}'").fetch_one(&db).await.unwrap(),2);
        db.close().await;
        let db = open_database(&path).await.unwrap();let again = recover(&db).await.unwrap();assert_eq!(again.change_sets,0);assert_eq!(again.sessions,0);
        for (turn,value) in persisted { assert_eq!(serde_json::to_value(crate::turn_changes::get_turn_change_set("s".into(),Some(turn.into()),&db).await.unwrap().unwrap()).unwrap(),value); }
        assert_eq!(fs::read(stored).unwrap(),checkpoint_before);db.close().await;
    }

    #[test]
    fn startup_recovery_marks_stale_runtime_state_interrupted() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let directory_path = directory.to_string_lossy().to_string();
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'workspace', 1, ?, ?)",
            )
            .bind(&directory_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            for (id, state, archived) in [
                ("running", "running", 0_i64),
                ("waiting", "waiting_approval", 0),
                ("archived", "running", 1),
            ] {
                sqlx::query(
                    "INSERT INTO sessions (id, workspace_id, agent, label, state, archived, created_at, updated_at)
                     VALUES (?, 'workspace', 'pi', ?, ?, ?, ?, ?)",
                )
                .bind(id)
                .bind(id)
                .bind(state)
                .bind(archived)
                .bind(&now)
                .bind(&now)
                .execute(&pool)
                .await
                .expect("session");
            }
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, started_at)
                 VALUES ('turn', 'running', 'external-turn', 'running', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn");
            sqlx::query(
                "INSERT INTO messages (id, session_id, role, content, status, created_at, updated_at)
                 VALUES ('message', 'running', 'assistant', '', 'streaming', ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("message");
            sqlx::query(
                "INSERT INTO messages (id, session_id, role, content, status, created_at, updated_at)
                 VALUES ('queued-message', 'running', 'user', 'pending', 'queued', ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("queued message");
            sqlx::query(
                "INSERT INTO process_runs (id, session_id, agent, generation_id, state, started_at)
                 VALUES ('process', 'running', 'pi', 'generation', 'running', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("process run");
            // A failure in the final state update must not commit earlier
            // message/process normalization. The whole recovery can retry.
            sqlx::query("CREATE TRIGGER reject_recovery BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'injected recovery failure'); END").execute(&pool).await.unwrap();
            assert!(recover(&pool).await.is_err());
            let process: String =
                sqlx::query_scalar("SELECT state FROM process_runs WHERE id='process'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(process, "running");
            let message: String =
                sqlx::query_scalar("SELECT status FROM messages WHERE id='queued-message'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(message, "queued");
            sqlx::query("DROP TRIGGER reject_recovery")
                .execute(&pool)
                .await
                .unwrap();
            let recovered = recover(&pool).await.expect("recovery");
            assert_eq!(recovered.sessions, 2);
            let state: String =
                sqlx::query_scalar("SELECT state FROM sessions WHERE id = 'running'")
                    .fetch_one(&pool)
                    .await
                    .expect("running state");
            assert_eq!(state, "interrupted");
            let turn_state: String =
                sqlx::query_scalar("SELECT status FROM turns WHERE id = 'turn'")
                    .fetch_one(&pool)
                    .await
                    .expect("turn state");
            assert_eq!(turn_state, "interrupted");
            let message_state: String =
                sqlx::query_scalar("SELECT status FROM messages WHERE id = 'message'")
                    .fetch_one(&pool)
                    .await
                    .expect("message state");
            assert_eq!(message_state, "failed");
            let queued_state: String =
                sqlx::query_scalar("SELECT status FROM messages WHERE id = 'queued-message'")
                    .fetch_one(&pool)
                    .await
                    .expect("queued message state");
            assert_eq!(queued_state, "failed");
            let process_state: String =
                sqlx::query_scalar("SELECT state FROM process_runs WHERE id = 'process'")
                    .fetch_one(&pool)
                    .await
                    .expect("process state");
            assert_eq!(process_state, "crashed");
            let archived_state: String =
                sqlx::query_scalar("SELECT state FROM sessions WHERE id = 'archived'")
                    .fetch_one(&pool)
                    .await
                    .expect("archived state");
            assert_eq!(archived_state, "running");
            pool.close().await;
            let _ = fs::remove_file(&database_path);
            let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
            fs::remove_dir_all(directory).expect("cleanup");
        });
    }

    #[test]
    fn in_process_adapter_crash_marks_active_turn_and_messages_interrupted() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let workspace_path = directory.to_string_lossy().to_string();
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'workspace', 1, ?, ?)",
            )
            .bind(&workspace_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            sqlx::query(
                "INSERT INTO sessions (id, workspace_id, agent, label, state, archived, created_at, updated_at)
                 VALUES ('session', 'workspace', 'pi', 'session', 'running', 0, ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("session");
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, started_at)
                 VALUES ('turn', 'session', 'external-turn', 'running', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn");
            for (id, role, status) in [
                ("assistant", "assistant", "streaming"),
                ("queued", "user", "queued"),
            ] {
                sqlx::query(
                    "INSERT INTO messages (id, session_id, turn_id, role, content, status, created_at, updated_at)
                     VALUES (?, 'session', 'turn', ?, '', ?, ?, ?)",
                )
                .bind(id)
                .bind(role)
                .bind(status)
                .bind(&now)
                .bind(&now)
                .execute(&pool)
                .await
                .expect("message");
            }

            mark_turn_interrupted(&pool, "session", "turn")
                .await
                .expect("mark interrupted");
            let turn_status: String =
                sqlx::query_scalar("SELECT status FROM turns WHERE id = 'turn'")
                    .fetch_one(&pool)
                    .await
                    .expect("turn status");
            assert_eq!(turn_status, "interrupted");
            let remaining_active: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM messages WHERE session_id = 'session' AND status IN ('streaming', 'queued')",
            )
            .fetch_one(&pool)
            .await
            .expect("message statuses");
            assert_eq!(remaining_active, 0);
            pool.close().await;
            let _ = fs::remove_file(&database_path);
            let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
            fs::remove_dir_all(directory).expect("cleanup");
        });
    }

    #[test]
    fn startup_recovery_rebuilds_interrupted_turn_change_set_from_checkpoint() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let workspace_root = directory.join("workspace");
            fs::create_dir_all(&workspace_root).expect("workspace directory");
            let workspace_path = workspace_root.to_string_lossy().to_string();
            fs::write(workspace_root.join("notes.txt"), "before").expect("baseline file");
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'workspace', 1, ?, ?)",
            )
            .bind(&workspace_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            sqlx::query(
                "INSERT INTO sessions (id, workspace_id, agent, label, state, archived, created_at, updated_at)
                 VALUES ('session', 'workspace', 'pi', 'session', 'running', 0, ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("session");
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, input_text, started_at)
                 VALUES ('turn', 'session', 'external-turn', 'running', 'update notes', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn");

            let baseline = capture_workspace(&workspace_root)
                .await
                .expect("baseline snapshot");
            let checkpoint_root = directory.join("app-data").join("checkpoints");
            persist_baseline_checkpoint(
                &checkpoint_root,
                "session",
                "turn",
                &workspace_root,
                &baseline,
            )
            .await
            .expect("checkpoint bytes");
            persist_checkpoint_metadata(
                &pool,
                &checkpoint_root,
                "workspace",
                "session",
                "turn",
                &baseline,
            )
            .await
            .expect("checkpoint metadata");
            fs::write(workspace_root.join("notes.txt"), "agent result").expect("result file");
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, input_text, started_at)
                 VALUES ('turn-missing-checkpoint', 'session', 'external-turn-2', 'running', 'no checkpoint', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn without checkpoint");

            let recovered = recover(&pool).await.expect("reconstruct change set");
            assert_eq!(recovered.change_sets, 2);
            let attribution: String = sqlx::query_scalar(
                "SELECT attribution FROM turn_change_sets WHERE session_id = 'session' AND turn_id = 'turn'",
            )
            .fetch_one(&pool)
            .await
            .expect("attribution");
            assert_eq!(attribution, "unknown");
            let capture_error: String = sqlx::query_scalar(
                "SELECT capture_error FROM turn_change_sets WHERE session_id = 'session' AND turn_id = 'turn'",
            )
            .fetch_one(&pool)
            .await
            .expect("capture error");
            assert!(capture_error.contains("重启后重建"));
            let recovered_set = crate::turn_changes::get_turn_change_set("session".into(),Some("turn".into()),&pool).await.unwrap().unwrap();
            assert_eq!(recovered_set.capture_error.as_deref(),Some(capture_error.as_str()));
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,recovered_set.localized_capture_error.as_ref().unwrap()), "Rebuilt after the app restarted; the result may include user changes made after the crash.");
            let changed_path: String = sqlx::query_scalar(
                "SELECT path FROM file_changes WHERE change_set_id = (SELECT id FROM turn_change_sets WHERE turn_id = 'turn')",
            )
            .fetch_one(&pool)
            .await
            .expect("file change");
            assert_eq!(changed_path, "notes.txt");
            let missing_checkpoint_error: String = sqlx::query_scalar(
                "SELECT capture_error FROM turn_change_sets WHERE session_id = 'session' AND turn_id = 'turn-missing-checkpoint'",
            )
            .fetch_one(&pool)
            .await
            .expect("missing checkpoint error");
            assert!(missing_checkpoint_error.contains("checkpoint 未持久化"));
            let missing = crate::turn_changes::get_turn_change_set("session".into(),Some("turn-missing-checkpoint".into()),&pool).await.unwrap().unwrap();
            assert_eq!(missing.capture_error.as_deref(),Some(missing_checkpoint_error.as_str()));
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,missing.localized_capture_error.as_ref().unwrap()), "Rebuilt after the app restarted; the turn baseline checkpoint was not persisted.");

            let repeated = recover(&pool).await.expect("repeat recovery");
            assert_eq!(repeated.sessions, 0);
            assert_eq!(repeated.change_sets, 0);
            let turn_state: String =
                sqlx::query_scalar("SELECT status FROM turns WHERE id = 'turn'")
                    .fetch_one(&pool)
                    .await
                    .expect("turn state");
            assert_eq!(turn_state, "interrupted");
            pool.close().await;
            let _ = fs::remove_file(&database_path);
            let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
            fs::remove_dir_all(directory).expect("cleanup");
        });
    }
}
