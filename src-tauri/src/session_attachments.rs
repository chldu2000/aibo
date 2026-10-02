//! Host-owned attachment registration, validation, and draft/queue/turn ownership.
//! Ownership changes run inside the caller's message transaction.
use crate::{clipboard_images, now_iso, session_by_id, workspace_by_id, CoreError};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::{fs, path::Path};
use ulid::Ulid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAttachment {
    pub(crate) schema: String,
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: Option<String>,
    pub(crate) path: String,
    pub(crate) content_hash: Option<String>,
    pub(crate) size: Option<i64>,
    pub(crate) media_type: String,
    pub(crate) source: String,
    pub(crate) send_strategy: String,
    pub(crate) inline_context: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAttachmentValidation {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    pub(crate) current_hash: Option<String>,
    pub(crate) size: Option<i64>,
}

fn attachment_media_type(path: &Path, is_dir: bool) -> String {
    if is_dir {
        return "inode/directory".to_owned();
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md" | "markdown") => "text/markdown".to_owned(),
        Some("txt" | "log") => "text/plain".to_owned(),
        Some("json") => "application/json".to_owned(),
        Some("png") => "image/png".to_owned(),
        Some("jpg" | "jpeg") => "image/jpeg".to_owned(),
        Some("gif") => "image/gif".to_owned(),
        Some("svg") => "image/svg+xml".to_owned(),
        Some("rs") => "text/x-rust".to_owned(),
        Some("ts" | "tsx" | "js" | "jsx" | "svelte") => "text/javascript".to_owned(),
        _ => "application/octet-stream".to_owned(),
    }
}

pub(crate) async fn register_session_attachments(
    session_id: String,
    paths: Vec<String>,
    db: &SqlitePool,
) -> Result<Vec<ContextAttachment>, CoreError> {
    let session = session_by_id(db, &session_id).await?;
    let workspace = workspace_by_id(db, &session.workspace_id).await?;
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let now = now_iso();
    let mut attachments = Vec::new();
    for raw_path in paths {
        let target = crate::workspace_guard::canonicalize_target(&root, Path::new(&raw_path))
            .map_err(CoreError::InvalidWorkspacePath)?;
        let metadata = fs::metadata(&target).map_err(|error| {
            CoreError::InvalidWorkspacePath(format!("attachment is unavailable: {error}"))
        })?;
        let is_dir = metadata.is_dir();
        if !is_dir && !metadata.is_file() {
            return Err(CoreError::InvalidWorkspacePath(
                "only files and directories can be attached".to_owned(),
            ));
        }
        let relative = target
            .strip_prefix(&root)
            .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let size = (!is_dir)
            .then_some(metadata.len())
            .map(|value| value as i64);
        let content_hash = if !is_dir && metadata.len() <= 10 * 1024 * 1024 {
            let bytes =
                fs::read(&target).map_err(|error| CoreError::Database(error.to_string()))?;
            let mut digest = Sha256::new();
            digest.update(bytes);
            Some(format!("sha256:{:x}", digest.finalize()))
        } else {
            None
        };
        let id = Ulid::new().to_string();
        sqlx::query(
            "INSERT INTO attachments
             (id, workspace_id, session_id, turn_id, path, content_hash, size,
              media_type, source, send_strategy, created_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'picker', 'reference', ?)",
        )
        .bind(&id)
        .bind(&workspace.id)
        .bind(&session_id)
        .bind(&relative)
        .bind(&content_hash)
        .bind(size)
        .bind(attachment_media_type(&target, is_dir))
        .bind(&now)
        .execute(db)
        .await?;
        attachments.push(ContextAttachment {
            schema: "aibo.context-attachment/v1".to_owned(),
            id,
            workspace_id: workspace.id.clone(),
            session_id: session_id.clone(),
            turn_id: None,
            path: relative,
            content_hash,
            size,
            media_type: attachment_media_type(&target, is_dir),
            source: "picker".to_owned(),
            send_strategy: "reference".to_owned(),
            inline_context: None,
            created_at: now.clone(),
        });
    }
    Ok(attachments)
}

pub(crate) async fn list_session_attachments(
    session_id: String,
    db: &SqlitePool,
) -> Result<Vec<ContextAttachment>, CoreError> {
    session_by_id(db, &session_id).await?;
    let rows = sqlx::query(
        "SELECT id, schema_version, workspace_id, session_id, turn_id, path, content_hash, size,
                media_type, source, send_strategy, created_at, inline_context
         FROM attachments WHERE session_id = ? AND (queued_message_id IS NULL OR turn_id IS NOT NULL) ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ContextAttachment {
                schema: row.try_get("schema_version")?,
                id: row.try_get("id")?,
                workspace_id: row.try_get("workspace_id")?,
                session_id: row.try_get("session_id")?,
                turn_id: row.try_get("turn_id")?,
                path: row.try_get("path")?,
                content_hash: row.try_get("content_hash")?,
                size: row.try_get("size")?,
                media_type: row.try_get("media_type")?,
                source: row.try_get("source")?,
                send_strategy: row.try_get("send_strategy")?,
                inline_context: row.try_get("inline_context")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

pub(crate) async fn remove_session_attachment(
    session_id: String,
    attachment_id: String,
    db: &SqlitePool,
    data_dir: &Path,
) -> Result<(), CoreError> {
    session_by_id(db, &session_id).await?;
    let deleted = sqlx::query("DELETE FROM attachments WHERE id = ? AND session_id = ? AND turn_id IS NULL AND queued_message_id IS NULL RETURNING media_type, inline_context")
        .bind(&attachment_id).bind(&session_id).fetch_optional(db).await?;
    if let Some(row) = deleted {
        if row.get::<String, _>("media_type").starts_with("image/") {
            if let Some(context) = row.get::<Option<String>, _>("inline_context") {
                clipboard_images::remove_file(data_dir, &context);
            }
        }
    }
    Ok(())
}

pub(crate) async fn validate_session_attachments(
    session_id: String,
    db: &SqlitePool,
) -> Result<Vec<ContextAttachmentValidation>, CoreError> {
    let session = session_by_id(db, &session_id).await?;
    let workspace = workspace_by_id(db, &session.workspace_id).await?;
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let rows = sqlx::query(
        "SELECT id, path, content_hash, size FROM attachments
         WHERE session_id = ? AND turn_id IS NULL AND queued_message_id IS NULL AND inline_context IS NULL ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| validate_file(&root, row))
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

fn validate_file(
    root: &Path,
    row: &sqlx::sqlite::SqliteRow,
) -> Result<ContextAttachmentValidation, sqlx::Error> {
    let id: String = row.try_get("id")?;
    let path: String = row.try_get("path")?;
    let expected_hash: Option<String> = row.try_get("content_hash")?;
    let expected_size: Option<i64> = row.try_get("size")?;
    let result = crate::workspace_guard::canonicalize_target(&root, Path::new(&path));
    let (status, reason, current_hash, size) = match result {
        Err(error) => ("missing", Some(error), None, None),
        Ok(target) => match fs::metadata(&target) {
            Err(error) => ("missing", Some(error.to_string()), None, None),
            Ok(metadata) => {
                let size = (!metadata.is_dir()).then_some(metadata.len() as i64);
                if let Some(expected_size) = expected_size {
                    if size != Some(expected_size) {
                        return Ok(ContextAttachmentValidation {
                            id,
                            path,
                            status: "changed".to_owned(),
                            reason: Some("文件大小已变化".to_owned()),
                            current_hash: None,
                            size,
                        });
                    }
                }
                let current_hash = if metadata.is_file() && metadata.len() <= 10 * 1024 * 1024 {
                    let bytes = fs::read(&target)
                        .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
                    let mut digest = Sha256::new();
                    digest.update(bytes);
                    Some(format!("sha256:{:x}", digest.finalize()))
                } else {
                    None
                };
                if expected_hash.is_some() && current_hash != expected_hash {
                    (
                        "changed",
                        Some("文件内容已变化".to_owned()),
                        current_hash,
                        size,
                    )
                } else {
                    ("ready", None, current_hash, size)
                }
            }
        },
    };
    Ok(ContextAttachmentValidation {
        id,
        path,
        status: status.to_owned(),
        reason,
        current_hash,
        size,
    })
}

/// Freeze only references present in the accepted message, not the next draft.
pub(crate) async fn freeze_for_queue(
    tx: &mut SqliteConnection,
    session_id: &str,
    queue_id: &str,
    text: &str,
) -> Result<(), sqlx::Error> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM attachments WHERE session_id=? AND turn_id IS NULL AND queued_message_id IS NULL")
        .bind(session_id).fetch_all(&mut *tx).await?;
    for id in ids {
        if text.contains(&format!("[attachment:{id}]"))
            || text.contains(&format!("\"snapshotId\":\"{id}\""))
        {
            sqlx::query("UPDATE attachments SET queued_message_id=? WHERE id=? AND session_id=? AND turn_id IS NULL AND queued_message_id IS NULL")
                .bind(queue_id).bind(id).bind(session_id).execute(&mut *tx).await?;
        }
    }
    Ok(())
}

pub(crate) async fn inputs<'a, E: sqlx::Executor<'a, Database = sqlx::Sqlite>>(
    executor: E,
    session_id: &str,
    queue_id: Option<&str>,
    capabilities: &[String],
) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query("SELECT id,media_type,inline_context,content_hash FROM attachments WHERE session_id=? AND turn_id IS NULL AND queued_message_id IS ? ORDER BY created_at")
        .bind(session_id).bind(queue_id).fetch_all(executor).await.map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| clipboard_images::turn_attachment(row, capabilities))
        .collect()
}

pub(crate) async fn bind_to_turn(
    tx: &mut SqliteConnection,
    session_id: &str,
    queue_id: Option<&str>,
    turn_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE attachments SET turn_id=? WHERE session_id=? AND turn_id IS NULL AND queued_message_id IS ?")
        .bind(turn_id).bind(session_id).bind(queue_id).execute(tx).await?;
    Ok(())
}

pub(crate) async fn prepare_turn(
    tx: &mut SqliteConnection,
    session_id: &str,
    queue_id: Option<&str>,
    turn_id: &str,
    capabilities: &[String],
) -> Result<Vec<serde_json::Value>, String> {
    let attachments = inputs(&mut *tx, session_id, queue_id, capabilities).await?;
    bind_to_turn(tx, session_id, queue_id, turn_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(attachments)
}

pub(crate) async fn validate_queued(
    db: &SqlitePool,
    session_id: &str,
    queue_id: &str,
) -> Result<(), String> {
    let session = session_by_id(db, session_id)
        .await
        .map_err(|e| e.to_string())?;
    let workspace = workspace_by_id(db, &session.workspace_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = fs::canonicalize(&workspace.path).map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id,path,content_hash,size,media_type,inline_context FROM attachments WHERE session_id=? AND queued_message_id=?")
        .bind(session_id).bind(queue_id).fetch_all(db).await.map_err(|e| e.to_string())?;
    for row in rows {
        if row.get::<String, _>("media_type").starts_with("image/") {
            clipboard_images::turn_attachment(&row, &session.capabilities)?;
            continue;
        }
        if row.get::<Option<String>, _>("inline_context").is_some() {
            continue;
        }
        let result = validate_file(&root, &row).map_err(|e| e.to_string())?;
        if result.status != "ready" {
            return Err(format!(
                "附件不可用：{}: {}",
                result.path,
                result.reason.unwrap_or(result.status)
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn queue_and_turn_ownership_preserve_other_drafts_and_rollback_together() {
        let root = std::env::temp_dir().join(format!("aibo-attachment-{}", Ulid::new()));
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("first.txt"), "first").unwrap();
        fs::write(workspace.join("next.txt"), "next").unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'test',1,'now','now')").bind(workspace.to_str().unwrap()).execute(&db).await.unwrap();
        for session in ["s", "other"] {
            sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES(?,'w','plugin','test','idle','now','now')").bind(session).execute(&db).await.unwrap();
        }
        for turn in ["turn", "next-turn"] {
            sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES(?,'s',?,'running','now')").bind(turn).bind(turn).execute(&db).await.unwrap();
        }
        let first = register_session_attachments("s".into(), vec!["first.txt".into()], &db)
            .await
            .unwrap()
            .remove(0);
        let next = register_session_attachments("s".into(), vec!["next.txt".into()], &db)
            .await
            .unwrap()
            .remove(0);
        let other = register_session_attachments("other".into(), vec!["first.txt".into()], &db)
            .await
            .unwrap()
            .remove(0);
        let mut tx = db.begin().await.unwrap();
        sqlx::query("INSERT INTO queued_messages(id,session_id,caller,text,created_at) VALUES('q','s','main','text','now')").execute(&mut *tx).await.unwrap();
        freeze_for_queue(
            &mut tx,
            "s",
            "q",
            &format!("[attachment:{}] [attachment:{}]", first.id, other.id),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        validate_queued(&db, "s", "q").await.unwrap();
        let draft = validate_session_attachments("s".into(), &db).await.unwrap();
        assert_eq!(draft.len(), 1);
        assert_eq!(draft[0].id, next.id);
        // The same content mutation is rejected for queued and draft files.
        fs::write(workspace.join("first.txt"), "FIRST").unwrap();
        fs::write(workspace.join("next.txt"), "NEXT").unwrap();
        assert!(validate_queued(&db, "s", "q")
            .await
            .unwrap_err()
            .contains("内容已变化"));
        assert_eq!(
            validate_session_attachments("s".into(), &db).await.unwrap()[0].status,
            "changed"
        );
        fs::write(workspace.join("first.txt"), "first").unwrap();
        let mut tx = db.begin().await.unwrap();
        let attachments = prepare_turn(&mut tx, "s", Some("q"), "turn", &[])
            .await
            .unwrap();
        assert_eq!(
            attachments,
            vec![serde_json::json!({"attachmentId":first.id})]
        );
        tx.rollback().await.unwrap();
        assert_eq!(inputs(&db, "s", Some("q"), &[]).await.unwrap(), attachments);
        let mut tx = db.begin().await.unwrap();
        prepare_turn(&mut tx, "s", Some("q"), "turn", &[])
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert!(inputs(&db, "s", Some("q"), &[]).await.unwrap().is_empty());
        let mut tx = db.begin().await.unwrap();
        let draft = prepare_turn(&mut tx, "s", None, "next-turn", &[])
            .await
            .unwrap();
        assert_eq!(draft, vec![serde_json::json!({"attachmentId":next.id})]);
        tx.commit().await.unwrap();
        assert_eq!(
            inputs(&db, "other", None, &[]).await.unwrap(),
            vec![serde_json::json!({"attachmentId":other.id})]
        );
        // History attachments cannot be removed by the draft command.
        remove_session_attachment("s".into(), first.id.clone(), &db, &root)
            .await
            .unwrap();
        let bound: String = sqlx::query_scalar("SELECT turn_id FROM attachments WHERE id=?")
            .bind(first.id)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(bound, "turn");
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
}
