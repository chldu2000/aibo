//! Persisted Core history remains readable without any Agent or plugin runtime.
use crate::{CoreError, Session, TimelineItem};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Cursor {
    schema: String, workspace_id: String, session_id: String,
    created_at: String, sequence: String, id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    schema: &'static str, source: &'static str, session: Session,
    items: Vec<TimelineItem>, next_before: Option<Cursor>,
}

pub(crate) async fn read(db: &SqlitePool, workspace_id: String, session_id: String, before: Option<Cursor>) -> Result<Page, CoreError> {
    let session = crate::session_by_id(db, &session_id).await?;
    if session.workspace_id != workspace_id { return Err(CoreError::InvalidWorkspacePath("history session does not belong to workspace".into())); }
    let sequence = if let Some(cursor) = &before {
        if cursor.schema != "aibo.session-history-cursor/v1" || cursor.workspace_id != workspace_id || cursor.session_id != session_id || cursor.created_at.is_empty() || cursor.created_at.len() > 64 || cursor.sequence.len() > 20 || cursor.id.is_empty() || cursor.id.len() > 256 {
            return Err(CoreError::InvalidWorkspacePath("invalid session history cursor or scope".into()));
        }
        Some(cursor.sequence.parse::<i64>().map_err(|_| CoreError::InvalidWorkspacePath("invalid history sequence".into()))?)
    } else { None };
    let mut rows = sqlx::query("SELECT id,session_id,turn_id,external_message_id,role,tool_name,content,status,created_at,updated_at,sequence FROM messages WHERE session_id=? AND (? IS NULL OR (created_at,sequence,id) < (?,?,?)) ORDER BY created_at DESC,sequence DESC,id DESC LIMIT 51")
        .bind(&session_id).bind(before.as_ref().map(|cursor| &cursor.created_at)).bind(before.as_ref().map(|cursor| &cursor.created_at)).bind(sequence).bind(before.as_ref().map(|cursor| &cursor.id)).fetch_all(db).await?;
    let has_more = rows.len() > 50; rows.truncate(50);
    let next_before = if has_more { rows.last().map(|row| Cursor {
        schema: "aibo.session-history-cursor/v1".into(), workspace_id, session_id,
        created_at: row.get("created_at"), sequence: row.get::<i64,_>("sequence").to_string(), id: row.get("id"),
    }) } else { None };
    let items = rows.iter().rev().map(crate::row_to_timeline_item).collect::<Result<Vec<_>,_>>()?;
    Ok(Page { schema: "aibo.session-history-page/v1", source: "persisted-core", session, items, next_before })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn persisted_pi_history_reads_from_a_read_only_database_without_a_runtime() {
        let root = std::env::temp_dir().join(format!("aibo-session-history-{}",ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap(); let path = root.join("host.db");
        let db = crate::open_database(&path).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w',?,'History',0,'before','before')").bind(root.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO plugin_installations(id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,enabled,created_at) VALUES ('disabled','dev.aibo.pi','1.0.0','fixture','local','/unavailable-history-fixture','{}',0,'before')").execute(&db).await.unwrap();
        for (id,archived) in [("session",0),("archived",1)] {
            sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,archived,plugin_installation_id,created_at,updated_at) VALUES (?,'w','dev.aibo.pi.agent',?,'closed',?,'disabled','before','before')").bind(id).bind(id).bind(archived).execute(&db).await.unwrap();
            for index in 0..151 {
                sqlx::query("INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES (?,?,'assistant',?,'completed',?,'2026-09-12T00:00:00Z','after')")
                    .bind(format!("{id}-{index:03}")).bind(id).bind(format!("saved branch message {index}"))
                    .bind(index%3).execute(&db).await.unwrap();
            }
        }
        db.close().await;
        let readonly = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&path).read_only(true)).await.unwrap();
        for id in ["session","archived"] {
            let mut cursor = None; let mut seen = std::collections::HashSet::new(); let mut pages = 0;
            loop {
                let page = read(&readonly,"w".into(),id.into(),cursor).await.unwrap(); pages+=1;
                assert_eq!(page.source,"persisted-core"); assert_eq!(page.session.plugin_installation_id.as_deref(),Some("disabled"));
                assert!(page.items.len()<=50);
                for item in &page.items { assert!(seen.insert(item.id.clone())); assert!(item.content.starts_with("saved branch message")); }
                cursor = page.next_before;
                if cursor.is_none() { break; }
            }
            assert_eq!(pages,4); assert_eq!(seen.len(),151);
        }
        let page = read(&readonly,"w".into(),"session".into(),None).await.unwrap();
        assert!(read(&readonly,"other".into(),"session".into(),None).await.is_err());
        assert!(read(&readonly,"w".into(),"archived".into(),page.next_before).await.is_err());
        let processes: i64 = sqlx::query_scalar("SELECT count(*) FROM process_runs").fetch_one(&readonly).await.unwrap(); assert_eq!(processes,0);
        readonly.close().await; std::fs::remove_dir_all(root).unwrap();
    }
}
