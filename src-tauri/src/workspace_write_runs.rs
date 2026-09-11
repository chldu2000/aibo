//! Durable host-owned write intent and settlement, independent of pages and windows.
use crate::{CoreError, Workspace};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::{future::Future, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteRun {
    schema: String,
    id: String,
    workspace_id: String,
    operation: String,
    status: String,
    snapshot: Value,
    result: Option<Value>,
    started_at: String,
    completed_at: Option<String>,
}

pub(crate) async fn execute<T, F, Fut>(
    db: &SqlitePool, workspace: &Workspace, operation: &str, input: Value, execute: F,
) -> Result<T, CoreError>
where T: Serialize, F: FnOnce() -> Fut, Fut: Future<Output = Result<T, CoreError>> {
    if workspace.trust != "trusted" { return Err(CoreError::WorkspaceTrustRequired); }
    let _write = crate::workspace_writes::acquire(db, &workspace.id, Path::new(&workspace.path)).await?;
    let id = ulid::Ulid::new().to_string();
    let snapshot = serde_json::json!({"schema":"aibo.workspace-write-intent/v1","origin":"host","workspaceId":workspace.id,"workspacePath":workspace.path,"operation":operation,"input":input});
    let snapshot_json = snapshot.to_string();
    if snapshot_json.len() > 64 * 1024 { return Err(CoreError::InvalidWorkspacePath("workspace write intent exceeds 64 KiB".into())); }
    sqlx::query("INSERT INTO workspace_write_runs (id,schema_version,workspace_id,operation,status,snapshot_json,started_at) VALUES (?,'aibo.workspace-write-run/v1',?,?,'running',?,?)")
        .bind(&id).bind(&workspace.id).bind(operation).bind(snapshot_json).bind(crate::now_iso()).execute(db).await?;
    // Construct/poll the operation only after durable admission succeeds.
    let result = execute().await;
    let (status, document) = match &result {
        // Completed is lifecycle settlement, not a claim that Git applied changes.
        // The original typed output retains applied/committed and its explanation.
        Ok(value) => {
            let output = serde_json::to_value(value).map_err(|error| CoreError::WriteOutcomeUnknown(format!("write {id} result serialization failed: {error}")))?;
            ("completed", serde_json::json!({"ok":true,"output":output}))
        },
        Err(error) => (if matches!(error, CoreError::WriteOutcomeUnknown(_)) { "outcome_unknown" } else { "failed" }, serde_json::json!({"ok":false,"error":error})),
    };
    let changed = sqlx::query("UPDATE workspace_write_runs SET status=?,result_json=?,completed_at=? WHERE id=? AND status='running'")
        .bind(status).bind(document.to_string()).bind(crate::now_iso()).bind(&id).execute(db).await
        .map_err(|error| CoreError::WriteOutcomeUnknown(format!("write {id} could not persist its result: {error}")))?.rows_affected();
    if changed != 1 { return Err(CoreError::WriteOutcomeUnknown(format!("write {id} record changed before settlement"))); }
    result
}

pub(crate) async fn list(db: &SqlitePool, workspace_id: String, limit: Option<i64>) -> Result<Vec<WriteRun>, CoreError> {
    crate::workspace_by_id(db, &workspace_id).await?;
    let rows = sqlx::query("SELECT * FROM workspace_write_runs WHERE workspace_id=? ORDER BY started_at DESC,id DESC LIMIT ?")
        .bind(workspace_id).bind(limit.unwrap_or(20).clamp(1,100)).fetch_all(db).await?;
    rows.iter().map(|row| {
        let snapshot: String = row.try_get("snapshot_json")?;
        let result: Option<String> = row.try_get("result_json")?;
        Ok(WriteRun { schema: row.try_get("schema_version")?, id: row.try_get("id")?, workspace_id: row.try_get("workspace_id")?,
            operation: row.try_get("operation")?, status: row.try_get("status")?,
            snapshot: serde_json::from_str(&snapshot).map_err(|error| CoreError::Initialization(error.to_string()))?,
            result: result.map(|value| serde_json::from_str(&value)).transpose().map_err(|error| CoreError::Initialization(error.to_string()))?,
            started_at: row.try_get("started_at")?, completed_at: row.try_get("completed_at")? })
    }).collect()
}

/// Startup-only. Unsettled writes are observable, never replayed.
pub(crate) async fn recover(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    let result = serde_json::json!({"ok":false,"error":{"code":"outcome_unknown","message":"Host restarted before write settlement; inspect local and remote effects before another operation."}});
    Ok(sqlx::query("UPDATE workspace_write_runs SET status='outcome_unknown',result_json=?,completed_at=? WHERE status='running'")
        .bind(result.to_string()).bind(crate::now_iso()).execute(db).await?.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> (std::path::PathBuf, SqlitePool, Workspace) {
        let root = std::env::temp_dir().join(format!("aibo-write-ledger-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Ledger',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        let workspace = crate::workspace_by_id(&db, "workspace").await.unwrap();
        (root, db, workspace)
    }

    #[tokio::test]
    async fn durable_admission_precedes_effects_and_failed_settlement_never_claims_success() {
        let (root, db, workspace) = fixture().await;
        sqlx::raw_sql("CREATE TRIGGER reject_intent BEFORE INSERT ON workspace_write_runs BEGIN SELECT RAISE(ABORT,'fixture admission failure'); END;").execute(&db).await.unwrap();
        let rejected = execute(&db, &workspace, "fixture.write", serde_json::json!({"name":"effect"}), || async {
            std::fs::write(root.join("effect"), "must not happen").unwrap(); Ok(serde_json::json!({"applied":true}))
        }).await;
        assert!(matches!(rejected, Err(CoreError::Database(_)))); assert!(!root.join("effect").exists());
        sqlx::raw_sql("DROP TRIGGER reject_intent; CREATE TRIGGER reject_settlement BEFORE UPDATE ON workspace_write_runs BEGIN SELECT RAISE(ABORT,'fixture settlement failure'); END;").execute(&db).await.unwrap();
        let unknown = execute(&db, &workspace, "fixture.write", serde_json::json!({"name":"effect"}), || async {
            let pending = list(&db, "workspace".into(), None).await.unwrap();
            assert_eq!(pending.len(), 1); assert_eq!(pending[0].status, "running");
            assert_eq!(pending[0].snapshot["input"]["name"], "effect");
            assert!(pending[0].result.is_none());
            std::fs::write(root.join("effect"), "already happened").unwrap(); Ok(serde_json::json!({"applied":true}))
        }).await;
        assert!(matches!(unknown, Err(CoreError::WriteOutcomeUnknown(_))));
        assert_eq!(std::fs::read_to_string(root.join("effect")).unwrap(), "already happened");
        assert!(matches!(crate::workspace_writes::acquire(&db, "workspace", &root).await, Err(CoreError::WorkspaceWriteBusy)));
        sqlx::raw_sql("DROP TRIGGER reject_settlement;").execute(&db).await.unwrap();
        assert_eq!(recover(&db).await.unwrap(), 1); assert_eq!(recover(&db).await.unwrap(), 0);
        let recovered = list(&db, "workspace".into(), None).await.unwrap();
        assert_eq!(recovered[0].status, "outcome_unknown");
        assert_eq!(recovered[0].result.as_ref().unwrap()["error"]["code"], "outcome_unknown");
        assert_eq!(std::fs::read_to_string(root.join("effect")).unwrap(), "already happened");
        let failure = execute::<Value, _, _>(&db, &workspace, "fixture.invalid", serde_json::json!({}), || async { Err(CoreError::InvalidWorkspacePath("fixture invalid input".into())) }).await;
        assert!(failure.is_err());
        assert!(list(&db, "workspace".into(), None).await.unwrap().iter().any(|run| run.status == "failed" && run.result.as_ref().unwrap()["error"]["code"] == "invalid_workspace_path"));
        db.close().await; std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn interrupted_git_commit_remains_observable_and_recovers_without_reexecution() {
        use std::os::unix::fs::PermissionsExt;
        let (root, db, _) = fixture().await;
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git").arg("-C").arg(&root).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        };
        git(&["init", "-q"]); git(&["config", "user.name", "Aibo Fixture"]); git(&["config", "user.email", "fixture@example.invalid"]); git(&["config", "commit.gpgsign", "false"]);
        let hooks = root.join("hooks"); std::fs::create_dir(&hooks).unwrap(); git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
        let hook = hooks.join("post-commit");
        std::fs::write(&hook, "#!/bin/sh\ntouch hook-started\n(sleep 2; touch late-hook) &\nwait\n").unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(root.join("source.txt"), "committed").unwrap(); git(&["add", "--", "source.txt"]);
        let task_db = db.clone();
        let owner = tokio::spawn(async move { crate::workspace_git::commit_workspace_changes(&task_db, "workspace".into(), "Ledger fixture\n\nCo-authored-by: Codex <codex@openai.com>".into()).await });
        tokio::time::timeout(std::time::Duration::from_secs(5), async { while !root.join("hook-started").exists() { tokio::time::sleep(std::time::Duration::from_millis(10)).await; } }).await.unwrap();
        let pending = list(&db, "workspace".into(), None).await.unwrap();
        assert_eq!(pending[0].status, "running"); assert_eq!(pending[0].operation, "git.commit");
        assert!(pending[0].snapshot["input"]["message"].as_str().unwrap().starts_with("Ledger fixture"));
        owner.abort(); let _ = owner.await;
        assert!(matches!(crate::workspace_writes::acquire(&db, "workspace", &root).await, Err(CoreError::WorkspaceWriteBusy)));
        assert_eq!(git(&["show", "HEAD:source.txt"]), "committed");
        db.close().await;
        let reopened = crate::open_database(&root.join("host.db")).await.unwrap();
        assert_eq!(recover(&reopened).await.unwrap(), 1); assert_eq!(recover(&reopened).await.unwrap(), 0);
        let history = list(&reopened, "workspace".into(), None).await.unwrap();
        assert_eq!(history.len(), 1); assert_eq!(history[0].id, pending[0].id); assert_eq!(history[0].status, "outcome_unknown");
        assert!(history[0].completed_at.is_some());
        tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
        assert!(!root.join("late-hook").exists()); assert_eq!(git(&["rev-list", "--count", "HEAD"]), "1");
        reopened.close().await; std::fs::remove_dir_all(root).unwrap();
    }
}
