//! Immutable references to persisted Core history; no native Agent runtime is required.
use crate::{ContextAttachment, CoreError};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};

const MAX_SNAPSHOT_BYTES: usize = 128 * 1024;

/// Queue controls run inside an existing turn. Bind only snapshots actually
/// present in the accepted message, preserving any newly added draft context.
pub(crate) async fn consume_queued(db: &SqlitePool, session_id: &str, turn_id: &str, message: &str) -> Result<(), CoreError> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM attachments WHERE session_id=? AND turn_id IS NULL AND inline_context IS NOT NULL")
        .bind(session_id).fetch_all(db).await?;
    for id in ids {
        if message.contains(&format!("\"snapshotId\":\"{id}\"")) {
            sqlx::query("UPDATE attachments SET turn_id=? WHERE id=? AND session_id=? AND turn_id IS NULL")
                .bind(turn_id).bind(id).bind(session_id).execute(db).await?;
        }
    }
    Ok(())
}

pub(crate) async fn capture(db: &SqlitePool, target_id: &str, source_id: &str) -> Result<ContextAttachment, CoreError> {
    let target = crate::session_by_id(db, target_id).await?;
    let source = crate::session_by_id(db, source_id).await?;
    if target.workspace_id != source.workspace_id || target_id == source_id || target.archived {
        return Err(CoreError::InvalidWorkspacePath("只能引用当前工作区的其他会话，且目标会话不能已归档。".into()));
    }
    // One SQLite read transaction freezes membership and streaming content.
    // Bound allocation before loading a potentially very large history.
    let mut tx = db.begin().await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id=?")
        .bind(source_id).fetch_one(&mut *tx).await?;
    if count == 0 { return Err(CoreError::InvalidWorkspacePath("该会话暂无已保存的消息可供引用。".into())); }
    let through: String = sqlx::query_scalar("SELECT id FROM messages WHERE session_id=? ORDER BY created_at DESC,sequence DESC,id DESC LIMIT 1")
        .bind(source_id).fetch_one(&mut *tx).await?;
    let tool_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id=? AND role='tool'")
        .bind(source_id).fetch_one(&mut *tx).await?;
    // Never load tool bodies. Bound both the number and size of conversational excerpts in SQL.
    let rows = sqlx::query("SELECT id,role,substr(content,1,1501) AS content,length(content) AS original_length,status FROM messages WHERE session_id=? AND role IN ('user','assistant') ORDER BY created_at DESC,sequence DESC,id DESC LIMIT 12")
        .bind(source_id).fetch_all(&mut *tx).await?;
    let items = rows.iter().rev().map(|row| {
        let content: String = row.get("content");
        // Do not recursively embed references from earlier turns.
        let clean = content.split("[AIBO_SESSION_REFERENCES]").next().unwrap_or_default()
            .split("[AIBO_CONTEXT_ATTACHMENTS]").next().unwrap_or_default().trim();
        let text = clean.chars().take(1500).collect::<String>();
        json!({"id":row.get::<String,_>("id"),"role":row.get::<String,_>("role"),
            "content":text,"status":row.get::<String,_>("status"),
            "truncated":row.get::<i64,_>("original_length") > text.chars().count() as i64})
    }).collect::<Vec<_>>();
    let id = ulid::Ulid::new().to_string();
    let now = crate::now_iso();
    let snapshot = json!({
        "schema":"aibo.session-reference/v2", "snapshotId":id,
        "source":"persisted-core", "sourceSessionId":source_id,
        "sourceAgent":source.agent, "sourceLabel":source.label,
        "capturedAt":now, "throughMessageId":through,
        "summaryKind":"extractive", "contextMode":"conversation-excerpts",
        "totalMessageCount":count,"omittedMessageCount":count-items.len() as i64,
        "omittedToolMessageCount":tool_count,"toolOutputsIncluded":false,
        "readAvailability":"on-demand reading is not available yet",
        "historyScope":"Aibo persisted history only; may not include native history before import",
        "messages":items
    }).to_string();
    if snapshot.len() > MAX_SNAPSHOT_BYTES {
        return Err(CoreError::InvalidWorkspacePath("会话快照超过 128 KiB 上限，未添加引用。".into()));
    }
    let hash = format!("sha256:{:x}", Sha256::digest(snapshot.as_bytes()));
    let path = format!("会话：{}", source.label);
    sqlx::query("INSERT INTO attachments (id,workspace_id,session_id,path,content_hash,size,media_type,source,send_strategy,created_at,inline_context) VALUES (?,?,?,?,?,?,'application/vnd.aibo.session-reference+json','manual','inline',?,?)")
        .bind(&id).bind(&target.workspace_id).bind(target_id).bind(&path).bind(&hash)
        .bind(snapshot.len() as i64).bind(&now).bind(&snapshot).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(ContextAttachment {
        schema:"aibo.context-attachment/v1".into(), id, workspace_id:target.workspace_id,
        session_id:target_id.into(),turn_id:None,path,content_hash:Some(hash),size:Some(snapshot.len() as i64),
        media_type:"application/vnd.aibo.session-reference+json".into(),source:"manual".into(),
        send_strategy:"inline".into(),inline_context:Some(snapshot),created_at:now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn snapshots_are_scoped_persisted_and_immutable() {
        let root = std::env::temp_dir().join(format!("aibo-context-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("test.db")).await.unwrap();
        for id in ["w", "other"] {
            sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES (?,?,?,0,'now','now')")
                .bind(id).bind(root.join(id).to_string_lossy().as_ref()).bind(id).execute(&db).await.unwrap();
        }
        for (id,w,archived) in [("target","w",0),("source","w",1),("foreign","other",0),("empty","w",0)] {
            sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,archived,created_at,updated_at) VALUES (?,?,'dev.aibo.pi.agent',?,'closed',?,'now','now')")
                .bind(id).bind(w).bind(id).bind(archived).execute(&db).await.unwrap();
        }
        sqlx::query("INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES ('m','source','assistant','原始回答','streaming',1,'now','now')").execute(&db).await.unwrap();
        for source in ["target","foreign","empty","missing"] { assert!(capture(&db,"target",source).await.is_err()); }
        assert!(capture(&db,"source","target").await.is_err());
        let attachment = capture(&db,"target","source").await.unwrap();
        let original = attachment.inline_context.unwrap();
        let value: serde_json::Value = serde_json::from_str(&original).unwrap();
        assert_eq!(value["throughMessageId"], "m");
        assert_eq!(value["messages"][0]["content"], "原始回答");
        assert_eq!(value["summaryKind"], "extractive");
        sqlx::query("UPDATE messages SET content='updated',status='completed' WHERE id='m'").execute(&db).await.unwrap();
        let persisted: String = sqlx::query_scalar("SELECT inline_context FROM attachments WHERE id=?").bind(&attachment.id).fetch_one(&db).await.unwrap();
        assert_eq!(persisted,original);
        let fresh = capture(&db,"target","source").await.unwrap();
        sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES ('turn','target','turn','running','queued','now')").execute(&db).await.unwrap();
        consume_queued(&db,"target","turn",&original).await.unwrap();
        let bound: Option<String> = sqlx::query_scalar("SELECT turn_id FROM attachments WHERE id=?").bind(&attachment.id).fetch_one(&db).await.unwrap();
        assert_eq!(bound.as_deref(),Some("turn"));
        let pending: Option<String> = sqlx::query_scalar("SELECT turn_id FROM attachments WHERE id=?").bind(&fresh.id).fetch_one(&db).await.unwrap();
        assert!(pending.is_none());
        assert_ne!(fresh.content_hash,attachment.content_hash);
        sqlx::query("UPDATE messages SET content=? WHERE id='m'").bind("界".repeat(MAX_SNAPSHOT_BYTES)).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES ('tool','source','tool',?,'completed',2,'now','now')")
            .bind("PRIVATE_TOOL_OUTPUT".repeat(100000)).execute(&db).await.unwrap();
        let compact = capture(&db,"target","source").await.unwrap();
        let compact_text = compact.inline_context.unwrap();
        assert!(!compact_text.contains("PRIVATE_TOOL_OUTPUT"));
        let compact_value: serde_json::Value = serde_json::from_str(&compact_text).unwrap();
        assert_eq!(compact_value["throughMessageId"],"tool");
        assert_eq!(compact_value["omittedToolMessageCount"],1);
        assert_eq!(compact_value["messages"][0]["truncated"],true);
        assert_eq!(compact_value["messages"][0]["content"].as_str().unwrap().chars().count(),1500);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM attachments").fetch_one(&db).await.unwrap(); assert_eq!(count,3);
        sqlx::query("DELETE FROM attachments WHERE id=? AND session_id='target'").bind(&attachment.id).execute(&db).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM attachments WHERE id=?").bind(&attachment.id).fetch_one(&db).await.unwrap(); assert_eq!(count,0);
        db.close().await; std::fs::remove_dir_all(root).unwrap();
    }
}
