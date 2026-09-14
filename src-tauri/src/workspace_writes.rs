//! Host-owned exclusion for project tasks and workspace Git writes.
//! This coordinates this host process, not external editors or arbitrary agents.
use crate::CoreError;
use sqlx::SqlitePool;
use std::{collections::HashSet, path::{Path, PathBuf}, sync::{LazyLock, Mutex}};

static WRITERS: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub(crate) struct WorkspaceWrite(PathBuf);
impl WorkspaceWrite { pub(crate) fn root(&self) -> &Path { &self.0 } }
impl Drop for WorkspaceWrite {
    fn drop(&mut self) {
        WRITERS.lock().unwrap_or_else(|error| error.into_inner()).remove(&self.0);
    }
}

pub(crate) async fn acquire(db: &SqlitePool, workspace_id: &str, path: &Path) -> Result<WorkspaceWrite, CoreError> {
    let path = std::fs::canonicalize(path).map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    {
        let mut writers = WRITERS.lock().unwrap_or_else(|error| error.into_inner());
        if !writers.insert(path.clone()) { return Err(CoreError::WorkspaceWriteBusy); }
    }
    let guard = WorkspaceWrite(path);
    // An interrupted task owner may have released its in-memory guard before
    // startup recovery settles the durable record. Do not bypass that record.
    let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM project_action_runs WHERE workspace_id=? AND status IN ('awaiting_approval','running')) OR EXISTS(SELECT 1 FROM workspace_write_runs WHERE workspace_id=? AND status IN ('awaiting_approval','running'))")
        .bind(workspace_id).bind(workspace_id).fetch_one(db).await?;
    if pending { return Err(CoreError::WorkspaceWriteBusy); }
    Ok(guard)
}
