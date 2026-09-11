//! Shared seek boundary for interleaved task and Git execution history.
use crate::CoreError;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Cursor {
    schema: String,
    workspace_id: String,
    pub(crate) started_at: String,
    pub(crate) kind: Kind,
    pub(crate) id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Kind { Git, Task }
impl Kind { pub(crate) fn as_str(&self) -> &'static str { match self { Self::Git => "git", Self::Task => "task" } } }
impl Cursor {
    pub(crate) fn validate(&self, workspace_id: &str) -> Result<(), CoreError> {
        if self.schema != "aibo.execution-cursor/v1" || self.workspace_id != workspace_id || self.id.is_empty() || self.id.len() > 256 || self.started_at.is_empty() || self.started_at.len() > 64 {
            return Err(CoreError::InvalidWorkspacePath("invalid execution history cursor or workspace".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    async fn page(db: &sqlx::SqlitePool, cursor: Option<&Cursor>) -> Vec<Value> {
        let tasks = crate::project_actions::list_project_action_runs_page(db, "w".into(), Some(21), cursor).await.unwrap();
        let writes = crate::workspace_write_runs::list_page(db, "w".into(), Some(21), cursor).await.unwrap();
        let mut rows: Vec<Value> = tasks.into_iter().map(|run| json!({"kind":"task","run":run})).chain(writes.into_iter().map(|run| json!({"kind":"git","run":run}))).collect();
        rows.sort_by(|a, b| {
            let key = |row: &Value| (row["run"]["startedAt"].as_str().unwrap().to_owned(), row["kind"].as_str().unwrap().to_owned(), row["run"]["id"].as_str().unwrap().to_owned());
            key(b).cmp(&key(a))
        });
        rows.truncate(20); rows
    }
    #[tokio::test]
    async fn seek_pages_preserve_equal_timestamps_across_sources_and_new_insertions() {
        let root = std::env::temp_dir().join(format!("aibo-history-cursor-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        for id in ["w", "other"] {
            sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES (?,?,?,0,'before','before')")
                .bind(id).bind(root.join(id).to_string_lossy().as_ref()).bind(id).execute(&db).await.unwrap();
        }
        for index in 0..65 {
            let id = format!("same-{index:03}");
            sqlx::query("INSERT INTO project_action_runs(id,schema_version,action_id,workspace_id,status,output,started_at,completed_at,snapshot_json) VALUES (?,'aibo.project-action-run/v1','deleted-action','w','completed','retained output','2026-09-12T00:00:00Z','after','{}')")
                .bind(&id).execute(&db).await.unwrap();
            sqlx::query(r#"INSERT INTO workspace_write_runs(id,schema_version,workspace_id,operation,status,snapshot_json,result_json,started_at,completed_at) VALUES (?,'aibo.workspace-write-run/v1','w','git.commit','completed','{}','{"ok":true,"output":{"committed":true}}','2026-09-12T00:00:00Z','after')"#)
                .bind(id).execute(&db).await.unwrap();
        }
        let first = page(&db, None).await;
        let mut seen = std::collections::HashSet::new();
        let mut rows = first; let mut page_number = 0;
        loop {
            if rows.is_empty() { break; }
            page_number += 1;
            for row in &rows { assert!(seen.insert(format!("{}:{}", row["kind"].as_str().unwrap(), row["run"]["id"].as_str().unwrap()))); }
            let last = rows.last().unwrap();
            let cursor: Cursor = serde_json::from_value(json!({"schema":"aibo.execution-cursor/v1","workspaceId":"w","startedAt":last["run"]["startedAt"],"kind":last["kind"],"id":last["run"]["id"]})).unwrap();
            if page_number == 1 {
                // New head rows must not shift older pages. Deleting the boundary
                // row must not invalidate an already-issued seek cursor either.
                sqlx::query("INSERT INTO workspace_write_runs(id,schema_version,workspace_id,operation,status,snapshot_json,started_at) VALUES ('new','aibo.workspace-write-run/v1','w','git.commit','running','{}','2026-09-13T00:00:00Z')").execute(&db).await.unwrap();
                sqlx::query("DELETE FROM project_action_runs WHERE id=?").bind(&cursor.id).execute(&db).await.unwrap();
            }
            rows = page(&db, Some(&cursor)).await;
        }
        assert_eq!(seen.len(), 130); assert_eq!(page_number, 7);
        assert_eq!(page(&db, None).await[0]["run"]["id"], "new");
        let wrong: Cursor = serde_json::from_value(json!({"schema":"aibo.execution-cursor/v1","workspaceId":"other","startedAt":"before","kind":"git","id":"same-000"})).unwrap();
        assert!(crate::workspace_write_runs::list_page(&db, "w".into(), None, Some(&wrong)).await.is_err());
        assert!(crate::project_actions::list_project_action_runs_page(&db, "w".into(), None, Some(&wrong)).await.is_err());
        assert!(crate::workspace_write_runs::list_page(&db, "other".into(), None, None).await.unwrap().is_empty());
        db.close().await; std::fs::remove_dir_all(root).unwrap();
    }
}
