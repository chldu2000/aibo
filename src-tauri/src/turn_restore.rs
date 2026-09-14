//! Bounded whole-turn restore planning and execution, including non-Git workspaces.
use crate::{CoreError, RestoreTurnChangeSetResult, TurnDiffSources, change_set::RestoreReport, workspace_write_runs::{Cancellation, Request}};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::{future::Future, path::{Path, PathBuf}, time::{Duration, Instant}};

#[derive(Serialize, sqlx::FromRow)]
struct Fact {
    id: String, path: String, previous_path: Option<String>, change_kind: String,
    baseline_exists: i64, baseline_hash: Option<String>, baseline_dirty: i64,
    result_exists: i64, result_hash: Option<String>,
}
fn digest(bytes: &[u8]) -> String { format!("sha256:{:x}", Sha256::digest(bytes)) }
fn invalid(message: impl Into<String>) -> CoreError { CoreError::InvalidWorkspacePath(message.into()) }

async fn metadata(db: &SqlitePool, session: &str, turn: &str) -> Result<(Value, Vec<Fact>), CoreError> {
    let set: Option<String> = sqlx::query_scalar("SELECT json_object('id',id,'workspaceId',workspace_id,'schema',schema_version,'baselineHead',baseline_head,'attribution',attribution,'captureStatus',capture_status,'updatedAt',updated_at) FROM turn_change_sets WHERE session_id=? AND turn_id=?")
        .bind(session).bind(turn).fetch_optional(db).await?;
    let set: Value = serde_json::from_str(&set.ok_or_else(|| invalid("turn change set not found"))?).map_err(|error| invalid(error.to_string()))?;
    let files = sqlx::query_as::<_, Fact>("SELECT id,path,previous_path,change_kind,baseline_exists,baseline_hash,baseline_dirty,result_exists,result_hash FROM file_changes WHERE change_set_id=? ORDER BY path COLLATE BINARY LIMIT 5001")
        .bind(set["id"].as_str()).fetch_all(db).await?;
    if files.len() > 5000 { return Err(invalid("restore exceeds 5000 files")); }
    Ok((set, files))
}
fn metadata_digest(set: &Value, files: &[Fact]) -> String {
    digest(json!({"set":set,"files":files}).to_string().as_bytes())
}

struct Step { path: String, before: Option<Vec<u8>>, after: Option<Vec<u8>>, mode: Option<u32> }
struct Action { label: String, steps: Vec<Step> }
struct Prepared { root: PathBuf, actions: Vec<Action>, report: RestoreReport, metadata_digest: String, proof: String, description: String }

async fn read_file(root: &Path, path: &str) -> Result<(Option<Vec<u8>>, Value), CoreError> {
    if path.is_empty() || Path::new(path).components().any(|part| !matches!(part, std::path::Component::Normal(_))) { return Err(invalid("restore path must be workspace-relative")); }
    let target = crate::workspace_guard::canonicalize_target(root, Path::new(path)).map_err(invalid)?;
    if target != root.join(path) { return Err(invalid(format!("symbolic restore path is unsupported: {path}"))); }
    match tokio::fs::symlink_metadata(&target).await {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((None, Value::Null)),
        Err(error) => Err(invalid(error.to_string())),
        Ok(metadata) => {
            if !metadata.is_file() { return Err(invalid(format!("restore target is not a regular file: {path}"))); }
            let bytes = crate::read_turn_diff_file(&target).await.map_err(|error| invalid(error.to_string()))?;
            #[cfg(unix)] let permissions = { use std::os::unix::fs::PermissionsExt; metadata.permissions().mode() };
            #[cfg(not(unix))] let permissions = u32::from(metadata.permissions().readonly());
            let proof = json!({"hash":digest(&bytes),"permissions":permissions});
            Ok((Some(bytes), proof))
        }
    }
}

async fn git_read(root: &Path, args: &[&str], deadline: Instant) -> Result<Vec<u8>, CoreError> {
    let command = crate::workspace_git_approval::read_command(root.to_str().ok_or_else(|| invalid("Git root is not UTF-8"))?, args);
    let result = crate::controlled_process::execute(command, deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(15)), 10 * 1024 * 1024 + 1).await.map_err(|error| invalid(error.to_string()))?;
    if !result.success || result.timed_out || result.stdout.len() > 10 * 1024 * 1024 || result.stderr.len() > 10 * 1024 * 1024 { return Err(invalid("Git restore baseline unavailable or exceeds bounds")); }
    Ok(result.stdout)
}

async fn prepare(db: &SqlitePool, checkpoints: &Path, root: &Path, session: &str, turn: &str) -> Result<Prepared, CoreError> {
    tokio::time::timeout(Duration::from_secs(60), async {
        let deadline = Instant::now() + Duration::from_secs(60);
        let root = tokio::fs::canonicalize(root).await.map_err(|error| invalid(error.to_string()))?;
        let (set, files) = metadata(db, session, turn).await?;
        if set["schema"] != crate::change_set::CHANGE_SET_SCHEMA { return Err(invalid("unsupported restore change set schema")); }
        let metadata_digest = metadata_digest(&set, &files);
        let mut report = RestoreReport::default(); let mut actions = Vec::new(); let mut proofs = Vec::new();
        let mut affected = std::collections::HashSet::new(); let mut retained = 0;
        let mut description = "恢复本轮工作区文件；不更新 Git 暂存区。取消或失败可能留下部分恢复结果。\n文件清单：".to_string();
        if !matches!(set["attribution"].as_str(), Some("agent" | "mixed")) { report.unsupported.push("本轮变更归属未知，禁止恢复".into()); }
        for file in files {
            let label = file.previous_path.as_ref().map(|source| format!("{source} → {}", file.path)).unwrap_or_else(|| file.path.clone());
            description.push_str(&format!("\n{}", json!({"kind":file.change_kind,"path":file.path,"previousPath":file.previous_path})));
            if description.len() > 12 * 1024 { return Err(invalid("restore file list exceeds the 12 KiB review limit")); }
            if !affected.insert(file.path.clone()) { return Err(invalid("restore paths overlap")); }
            let (current, current_proof) = read_file(&root, &file.path).await?;
            proofs.push(json!({"path":file.path,"current":current_proof}));
            let matches = current.is_some() == (file.result_exists != 0) && current.as_ref().map(|bytes| digest(bytes)) == file.result_hash;
            if !matches { report.conflicts.push(file.path.clone()); continue; }
            if file.baseline_dirty != 0 || (file.baseline_exists != 0 && file.baseline_hash.is_none()) || (file.result_exists != 0 && file.result_hash.is_none()) {
                report.unsupported.push(format!("{}（baseline 不可安全恢复）", file.path)); continue;
            }
            let destination = if file.change_kind == "renamed" {
                let source = file.previous_path.as_ref().ok_or_else(|| invalid("renamed file has no original path"))?;
                if !affected.insert(source.clone()) { return Err(invalid("restore rename paths overlap")); }
                let (source_bytes, source_proof) = read_file(&root, source).await?;
                proofs.push(json!({"path":source,"current":source_proof}));
                if source_bytes.is_some() { report.conflicts.push(format!("{source}（重命名源路径已存在）")); continue; }
                source.as_str()
            } else { &file.path };
            let mut mode = None;
            let baseline = if file.baseline_exists != 0 {
                let checkpoint = crate::checkpoint_file_path(checkpoints, session, turn, destination);
                let bytes = if checkpoint.is_file() {
                    crate::read_turn_diff_file(&checkpoint).await.map_err(|error| invalid(error.to_string()))?
                } else if let Some(head) = set["baselineHead"].as_str() {
                    git_read(&root, &["show", &format!("{head}:{destination}")], deadline).await?
                } else { return Err(invalid(format!("checkpoint unavailable for {destination}"))); };
                if file.baseline_hash.as_deref() != Some(digest(&bytes).as_str()) {
                    report.unsupported.push(format!("{destination}（baseline checkpoint 校验失败）")); continue;
                }
                if let Some(head) = set["baselineHead"].as_str() {
                    let value = git_read(&root, &["ls-tree", "--format=%(objectmode)", head, "--", destination], deadline).await?;
                    mode = match String::from_utf8_lossy(&value).trim() {
                        "100644" => Some(0o644), "100755" => Some(0o755),
                        _ => { report.unsupported.push(format!("{destination}（Git 基线不是普通文件）")); continue; }
                    };
                }
                Some(bytes)
            } else { None };
            retained += current.as_ref().map_or(0, Vec::len) + baseline.as_ref().map_or(0, Vec::len);
            if retained > 100 * 1024 * 1024 { return Err(invalid("restore plan exceeds 100 MiB")); }
            let steps = if file.change_kind == "renamed" {
                if baseline.is_none() || current.is_none() { return Err(invalid("invalid rename baseline/result")); }
                vec![Step { path: destination.into(), before: None, after: baseline, mode }, Step { path: file.path, before: current, after: None, mode: None }]
            } else { vec![Step { path: file.path, before: current, after: baseline, mode }] };
            actions.push(Action { label, steps });
        }
        let proof = digest(json!({"metadata":metadata_digest,"files":proofs,"conflicts":report.conflicts,"unsupported":report.unsupported}).to_string().as_bytes());
        Ok(Prepared { root, actions, report, metadata_digest, proof, description })
    }).await.map_err(|_| invalid("restore preflight exceeded 60 seconds"))?
}

struct Outcome { report: RestoreReport, error: Option<CoreError> }
async fn execute<F, G>(mut plan: Prepared, cancel: Option<&Cancellation>, guard: F) -> Outcome
where F: Fn() -> G, G: Future<Output = Result<(), CoreError>> {
    if !plan.report.conflicts.is_empty() || !plan.report.unsupported.is_empty() { return Outcome { report: plan.report, error: None }; }
    let deadline = Instant::now() + Duration::from_secs(120); let mut started = false;
    for action in plan.actions {
        for step in action.steps {
            let attempt = async {
                guard().await?;
                if Instant::now() >= deadline { return Err(invalid("restore deadline expired before next file")); }
                let sources = TurnDiffSources { baseline_exists: step.after.is_some(), result_exists: step.before.is_some(), baseline: step.after.unwrap_or_default(), result: step.before.unwrap_or_default(), baseline_dirty: false };
                crate::core_turn_git::restore_worktree(plan.root.to_str().ok_or_else(|| invalid("restore root is not UTF-8"))?, &step.path, &sources, step.mode, cancel).await
            }.await;
            if let Err(error) = attempt {
                let error = if started || matches!(error, CoreError::WriteOutcomeUnknown(_)) {
                    CoreError::WriteOutcomeUnknown(format!("整轮恢复在 {} 停止，已完成 {:?}；部分文件或目录可能已改变，未自动回滚：{error}", step.path, plan.report.restored))
                } else { error };
                plan.report.unsupported.push(error.to_string());
                return Outcome { report: plan.report, error: Some(error) };
            }
            started = true;
        }
        plan.report.restored.push(action.label);
    }
    plan.report.applied = true; Outcome { report: plan.report, error: None }
}

async fn scope(db: &SqlitePool, workspace: &crate::Workspace, session: &str, turn: &str) -> Result<Value, CoreError> {
    let current = crate::workspace_by_id(db, &workspace.id).await?;
    if current.trust != "trusted" { return Err(CoreError::WorkspaceTrustRequired); }
    if current.path != workspace.path { return Err(invalid("restore workspace changed")); }
    let root = tokio::fs::canonicalize(&current.path).await.map_err(|error| invalid(error.to_string()))?;
    let session: Option<String> = sqlx::query_scalar("SELECT json_object('sessionId',s.id,'state',s.state,'archived',s.archived,'updatedAt',s.updated_at,'turnId',t.id,'turnStatus',t.status) FROM sessions s JOIN turns t ON t.session_id=s.id JOIN turn_change_sets c ON c.session_id=s.id AND c.turn_id=t.id AND c.workspace_id=s.workspace_id WHERE s.id=? AND s.workspace_id=? AND t.id=?")
        .bind(session).bind(&workspace.id).bind(turn).fetch_optional(db).await?;
    Ok(json!({"workspaceId":workspace.id,"path":current.path,"root":root,"trust":current.trust,"updatedAt":current.updated_at,"session":session.ok_or_else(|| invalid("restore turn is not in this workspace session"))?}))
}

pub(crate) async fn restore_requested(db: &SqlitePool, data_dir: &Path, session_id: &str, turn_id: &str, request: &Request) -> Result<RestoreTurnChangeSetResult, CoreError> {
    let session = crate::session_by_id(db, session_id).await?;
    let workspace = crate::workspace_by_id(db, &session.workspace_id).await?;
    let selected = tokio::sync::Mutex::new(None);
    let workspace = &workspace; let selected = &selected;
    crate::workspace_write_runs::execute_with_context(db, &workspace, "core.turn-restore", json!({"sessionId":session_id,"turnId":turn_id}), request,
        || async {
            selected.lock().await.take();
            let before = scope(db, &workspace, session_id, turn_id).await?;
            let plan = prepare(db, &data_dir.join("checkpoints"), Path::new(&workspace.path), session_id, turn_id).await?;
            let after = scope(db, &workspace, session_id, turn_id).await?;
            if before != after { return Err(invalid("restore scope changed during preflight")); }
            let context = json!({"scope":after,"root":plan.root,"proof":plan.proof,"approvalDescription":plan.description});
            *selected.lock().await = Some((plan, after)); Ok(context)
        }, |cancel| async move {
            let (plan, expected_scope) = selected.lock().await.take().ok_or_else(|| invalid("restore was not prepared by host approval"))?;
            let expected_metadata = plan.metadata_digest.clone();
            let outcome = execute(plan, Some(&cancel), || async {
                if scope(db, &workspace, session_id, turn_id).await? != expected_scope { return Err(invalid("restore scope changed after approval")); }
                let (set, files) = metadata(db, session_id, turn_id).await?;
                if metadata_digest(&set, &files) != expected_metadata { return Err(invalid("restore change set changed after approval")); }
                Ok(())
            }).await;
            persist_audit(db, &workspace.id, session_id, turn_id, &outcome).await.map_err(|error| CoreError::WriteOutcomeUnknown(format!("恢复审计无法保存，请核对实际文件：{error}")))?;
            if let Some(error) = outcome.error { return Err(error); }
            Ok(RestoreTurnChangeSetResult { applied: outcome.report.applied, restored: outcome.report.restored, conflicts: outcome.report.conflicts, unsupported: outcome.report.unsupported })
        }).await
}

async fn persist_audit(db: &SqlitePool, workspace: &str, session: &str, turn: &str, outcome: &Outcome) -> Result<(), CoreError> {
    let report = &outcome.report;
    let status = if outcome.error.is_some() { "failed" } else if report.applied { "completed" } else { "blocked" };
    let message = if let Some(error) = &outcome.error { format!("本轮恢复未完成：{error}") }
        else if report.applied { format!("已恢复本轮 Agent 变更（{} 个文件）；恢复动作已记录。", report.restored.len()) }
        else { format!("恢复已阻止；冲突：{}；不支持：{}。", report.conflicts.join("、"), report.unsupported.join("、")) };
    let id = ulid::Ulid::new().to_string(); let now = crate::now_iso();
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO restore_operations (id,schema_version,workspace_id,session_id,turn_id,status,restored_json,conflicts_json,unsupported_json,created_at) VALUES (?,'aibo.restore-operation/v1',?,?,?,?,?,?,?,?)")
        .bind(&id).bind(workspace).bind(session).bind(turn).bind(status).bind(json!(report.restored).to_string()).bind(json!(report.conflicts).to_string()).bind(json!(report.unsupported).to_string()).bind(&now).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO messages (id,session_id,turn_id,external_message_id,role,content,status,sequence,created_at,updated_at) VALUES (?,?,?,?,'system',?,'completed',0,?,?)")
        .bind(ulid::Ulid::new().to_string()).bind(session).bind(turn).bind(format!("restore:{id}")).bind(message).bind(&now).bind(&now).execute(&mut *tx).await?;
    tx.commit().await?; Ok(())
}

#[cfg(test)]
pub(crate) async fn restore_unchecked(db: &SqlitePool, checkpoints: &Path, root: &Path, session: &str, turn: &str) -> Result<RestoreReport, String> {
    let plan = prepare(db, checkpoints, root, session, turn).await.map_err(|error| error.to_string())?;
    let outcome = execute(plan, None, || async { Ok(()) }).await;
    match outcome.error { Some(error) => Err(error.to_string()), None => Ok(outcome.report) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;
    struct Fixture { directory: PathBuf, root: PathBuf, data: PathBuf, db: SqlitePool }
    impl Fixture {
        fn git(&self, args: &[&str]) -> String {
            let output = std::process::Command::new("git").arg("-C").arg(&self.root).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr)); String::from_utf8(output.stdout).unwrap()
        }
        async fn new(git: bool) -> Self {
            let directory = std::env::temp_dir().join(format!("aibo-turn-restore-{}", ulid::Ulid::new()));
            let root = directory.join("workspace"); let data = directory.join("data");
            std::fs::create_dir_all(&root).unwrap(); std::fs::create_dir(&data).unwrap();
            let db = crate::open_database(&data.join("host.db")).await.unwrap();
            let f = Self { directory, root, data, db };
            for name in ["edit.txt", "old.txt", "delete.txt", "keep.txt"] { std::fs::write(f.root.join(name), format!("before {name}")).unwrap(); }
            if git {
                f.git(&["init", "-q"]); f.git(&["config", "user.name", "Fixture"]); f.git(&["config", "user.email", "fixture@example.invalid"]);
                f.git(&["config", "commit.gpgsign", "false"]); f.git(&["config", "core.hooksPath", "/dev/null"]);
                f.git(&["add", "-A"]); f.git(&["commit", "-qm", "Restore baseline\n\nCo-authored-by: Codex <codex@openai.com>"]);
            }
            let now = crate::now_iso();
            sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Restore',1,?,?)").bind(f.root.to_str().unwrap()).bind(&now).bind(&now).execute(&f.db).await.unwrap();
            sqlx::query("INSERT INTO sessions (id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('session','workspace','pi','Restore','idle',?,?)").bind(&now).bind(&now).execute(&f.db).await.unwrap();
            sqlx::query("INSERT INTO turns (id,session_id,external_turn_id,status,started_at) VALUES ('turn','session','fixture','completed',?)").bind(&now).execute(&f.db).await.unwrap();
            let before = crate::change_set::capture(&f.root).await.unwrap();
            crate::change_set::persist_baseline_checkpoint(&f.data.join("checkpoints"), "session", "turn", &f.root, &before).await.unwrap();
            std::fs::write(f.root.join("edit.txt"), "after").unwrap(); std::fs::rename(f.root.join("old.txt"), f.root.join("new.txt")).unwrap();
            std::fs::remove_file(f.root.join("delete.txt")).unwrap(); std::fs::write(f.root.join("added.txt"), "added").unwrap();
            let after = crate::change_set::capture(&f.root).await.unwrap();
            crate::change_set::persist(&f.db, "workspace", "session", "turn", Some(&before), Some(&after), None).await.unwrap();
            f
        }
        async fn restore(&self, request: &Request) -> Result<RestoreTurnChangeSetResult, CoreError> { restore_requested(&self.db, &self.data, "session", "turn", request).await }
        fn restored(&self) {
            for name in ["edit.txt", "old.txt", "delete.txt", "keep.txt"] { assert_eq!(std::fs::read_to_string(self.root.join(name)).unwrap(), format!("before {name}")); }
            assert!(!self.root.join("new.txt").exists()); assert!(!self.root.join("added.txt").exists());
        }
        fn unchanged(&self) {
            assert_eq!(std::fs::read_to_string(self.root.join("edit.txt")).unwrap(), "after");
            assert!(self.root.join("new.txt").exists()); assert!(self.root.join("added.txt").exists());
            assert!(!self.root.join("old.txt").exists()); assert!(!self.root.join("delete.txt").exists());
        }
        async fn close(self) { self.db.close().await; std::fs::remove_dir_all(self.directory).unwrap(); }
    }
    fn approve(id: &str) -> Request {
        Request::with_confirmation(id.into(), "main".into(), |message| async move {
            assert!(message.contains("core.turn-restore") && message.contains("old.txt") && message.contains("new.txt")); Ok(true)
        })
    }

    #[tokio::test]
    async fn host_restores_git_and_plain_workspaces_with_rename_and_idempotent_legacy_audit() {
        for git in [false, true] {
            let f = Fixture::new(git).await;
            let index = git.then(|| { f.git(&["add", "-A"]); f.git(&["diff", "--cached", "--binary"]) });
            let result = f.restore(&approve("restore")).await.unwrap(); assert!(result.applied); assert_eq!(result.restored.len(), 4);
            f.restored(); if let Some(index) = index { assert_eq!(f.git(&["diff", "--cached", "--binary"]), index); }
            std::fs::write(f.root.join("edit.txt"), "later user edit").unwrap();
            let replay = Request::with_confirmation("restore".into(), "main".into(), |_| async { panic!("restore replay prompted") });
            assert_eq!(serde_json::to_value(f.restore(&replay).await.unwrap()).unwrap(), serde_json::to_value(result).unwrap());
            assert_eq!(std::fs::read_to_string(f.root.join("edit.txt")).unwrap(), "later user edit");
            let audits = sqlx::query("SELECT schema_version,status,restored_json FROM restore_operations").fetch_all(&f.db).await.unwrap();
            assert_eq!(audits.len(), 1); assert_eq!(audits[0].get::<String,_>("schema_version"), "aibo.restore-operation/v1"); assert_eq!(audits[0].get::<String,_>("status"), "completed");
            let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE external_message_id LIKE 'restore:%'").fetch_one(&f.db).await.unwrap(); assert_eq!(messages, 1);
            let writes = sqlx::query("SELECT status,operation,approval_outcome FROM workspace_write_runs").fetch_all(&f.db).await.unwrap();
            assert_eq!(writes.len(), 1); assert_eq!(writes[0].get::<String,_>("operation"), "core.turn-restore"); assert_eq!(writes[0].get::<String,_>("status"), "completed"); assert_eq!(writes[0].get::<String,_>("approval_outcome"), "approved"); f.close().await;
        }
    }

    #[tokio::test]
    async fn host_restore_rejects_denial_cancel_and_stale_file_metadata_checkpoint_or_scope() {
        for decision in ["denied", "cancelled", "file", "metadata", "checkpoint", "trust", "session"] {
            let f = Fixture::new(false).await; let db = f.db.clone(); let root = f.root.clone(); let data = f.data.clone();
            let request = Request::with_confirmation(decision.into(), "main".into(), move |_| {
                let db = db.clone(); let root = root.clone(); let data = data.clone();
                async move {
                    match decision {
                        "denied" => return Ok(false),
                        "cancelled" => {
                            let id: String = sqlx::query_scalar("SELECT id FROM workspace_write_runs WHERE status='awaiting_approval'").fetch_one(&db).await.unwrap();
                            assert!(!crate::workspace_write_runs::cancel(&db, "workspace", &id, "other").await.unwrap());
                            assert!(crate::workspace_write_runs::cancel(&db, "workspace", &id, "main").await.unwrap());
                        }
                        "file" => std::fs::write(root.join("edit.txt"), "later edit").unwrap(),
                        "metadata" => { sqlx::query("UPDATE file_changes SET baseline_hash='changed' WHERE path='edit.txt'").execute(&db).await.unwrap(); }
                        "checkpoint" => std::fs::write(crate::checkpoint_file_path(&data.join("checkpoints"), "session", "turn", "edit.txt"), "corrupt").unwrap(),
                        "trust" => { sqlx::query("UPDATE workspaces SET trusted=0").execute(&db).await.unwrap(); }
                        "session" => { sqlx::query("UPDATE sessions SET archived=1").execute(&db).await.unwrap(); }
                        _ => unreachable!(),
                    }
                    Ok(true)
                }
            });
            let error = f.restore(&request).await.unwrap_err(); assert_eq!(serde_json::to_value(error).unwrap()["code"], "approval_rejected");
            if decision == "file" { assert_eq!(std::fs::read_to_string(f.root.join("edit.txt")).unwrap(), "later edit"); } else { f.unchanged(); }
            assert!(f.root.join("added.txt").exists());
            let decision_saved: String = sqlx::query_scalar("SELECT approval_outcome FROM workspace_write_runs").fetch_one(&f.db).await.unwrap();
            assert_eq!(decision_saved, if matches!(decision, "denied" | "cancelled") { decision } else { "stale" });
            let audit_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM restore_operations").fetch_one(&f.db).await.unwrap(); assert_eq!(audit_count, 0); f.close().await;
        }
    }

    #[tokio::test]
    async fn restore_preflight_blocks_all_files_on_conflict_dirty_or_corrupt_baseline() {
        for condition in ["conflict", "dirty", "corrupt"] {
            let f = Fixture::new(false).await;
            match condition {
                "conflict" => std::fs::write(f.root.join("old.txt"), "user recreated source").unwrap(),
                "dirty" => { sqlx::query("UPDATE file_changes SET baseline_dirty=1 WHERE path='edit.txt'").execute(&f.db).await.unwrap(); }
                _ => std::fs::write(crate::checkpoint_file_path(&f.data.join("checkpoints"), "session", "turn", "edit.txt"), "wrong bytes").unwrap(),
            }
            let result = f.restore(&approve(condition)).await.unwrap(); assert!(!result.applied); assert!(result.restored.is_empty());
            assert!(f.root.join("added.txt").exists()); assert_eq!(std::fs::read_to_string(f.root.join("edit.txt")).unwrap(), "after");
            let status: String = sqlx::query_scalar("SELECT status FROM restore_operations").fetch_one(&f.db).await.unwrap(); assert_eq!(status, "blocked"); f.close().await;
        }
    }

    #[tokio::test]
    async fn partial_restore_cancel_or_scope_loss_persists_unknown_without_rollback() {
        for cancel_operation in [false, true] {
            let f = Fixture::new(false).await;
            let plan = prepare(&f.db, &f.data.join("checkpoints"), &f.root, "session", "turn").await.unwrap();
            let workspace = crate::workspace_by_id(&f.db, "workspace").await.unwrap();
            let calls = std::sync::atomic::AtomicUsize::new(0);
            let request = Request::with_confirmation("partial".into(), "main".into(), |_| async { Ok(true) });
            let db = &f.db; let calls = &calls;
            let result: Result<(), CoreError> = crate::workspace_write_runs::execute_with_context(db, &workspace, "core.turn-restore", json!({"sessionId":"session","turnId":"turn"}), &request, || async { Ok(json!({"fixture":"partial"})) }, |cancel| async move {
                let outcome = execute(plan, Some(&cancel), || async {
                    if calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 1 {
                        if cancel_operation {
                            let id: String = sqlx::query_scalar("SELECT id FROM workspace_write_runs WHERE status='running'").fetch_one(db).await.unwrap();
                            assert!(crate::workspace_write_runs::cancel(db, "workspace", &id, "main").await.unwrap());
                        } else { return Err(CoreError::WorkspaceTrustRequired); }
                    }
                    Ok(())
                }).await;
                persist_audit(db, "workspace", "session", "turn", &outcome).await?;
                Err(outcome.error.expect("second file must stop"))
            }).await;
            assert!(matches!(result, Err(CoreError::WriteOutcomeUnknown(_))));
            assert!(!f.root.join("added.txt").exists()); assert!(!f.root.join("delete.txt").exists());
            assert_eq!(std::fs::read_to_string(f.root.join("edit.txt")).unwrap(), "after");
            let row = sqlx::query("SELECT status,restored_json,unsupported_json FROM restore_operations").fetch_one(&f.db).await.unwrap();
            assert_eq!(row.get::<String,_>("status"), "failed"); assert_eq!(row.get::<String,_>("restored_json"), "[\"added.txt\"]"); assert!(row.get::<String,_>("unsupported_json").contains("未自动回滚"));
            let status: String = sqlx::query_scalar("SELECT status FROM workspace_write_runs").fetch_one(&f.db).await.unwrap(); assert_eq!(status, "outcome_unknown"); f.close().await;
        }
    }

    #[tokio::test]
    async fn restore_audit_projection_is_atomic_and_failure_does_not_reexecute_files() {
        let f = Fixture::new(false).await;
        sqlx::query("CREATE TRIGGER reject_restore_message BEFORE INSERT ON messages WHEN NEW.external_message_id LIKE 'restore:%' BEGIN SELECT RAISE(ABORT,'fixture message failure'); END").execute(&f.db).await.unwrap();
        let error = f.restore(&approve("audit-failure")).await.unwrap_err(); assert!(matches!(error, CoreError::WriteOutcomeUnknown(_))); f.restored();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM restore_operations").fetch_one(&f.db).await.unwrap(); assert_eq!(count, 0);
        sqlx::query("DROP TRIGGER reject_restore_message").execute(&f.db).await.unwrap();
        std::fs::write(f.root.join("edit.txt"), "later edit").unwrap();
        let request = Request::with_confirmation("audit-failure".into(), "main".into(), |_| async { panic!("audit failure replay") });
        assert_eq!(serde_json::to_value(f.restore(&request).await.unwrap_err()).unwrap(), serde_json::to_value(error).unwrap());
        assert_eq!(std::fs::read_to_string(f.root.join("edit.txt")).unwrap(), "later edit"); f.close().await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn restore_scope_detects_directory_link_retarget_after_preflight() {
        let f = Fixture::new(false).await;
        let link = f.directory.join("workspace-link"); let other = f.directory.join("other");
        std::fs::create_dir(&other).unwrap(); std::os::unix::fs::symlink(&f.root, &link).unwrap();
        sqlx::query("UPDATE workspaces SET path=?").bind(link.to_str().unwrap()).execute(&f.db).await.unwrap();
        let workspace = crate::workspace_by_id(&f.db, "workspace").await.unwrap();
        let expected = scope(&f.db, &workspace, "session", "turn").await.unwrap();
        let plan = prepare(&f.db, &f.data.join("checkpoints"), &link, "session", "turn").await.unwrap();
        std::fs::remove_file(&link).unwrap(); std::os::unix::fs::symlink(&other, &link).unwrap();
        let outcome = execute(plan, None, || async {
            if scope(&f.db, &workspace, "session", "turn").await? != expected { return Err(invalid("scope changed")); }
            Ok(())
        }).await;
        assert!(outcome.error.is_some()); assert!(outcome.report.restored.is_empty()); f.unchanged();
        assert_eq!(std::fs::read_dir(other).unwrap().count(), 0); f.close().await;
    }
}
