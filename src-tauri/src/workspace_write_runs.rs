//! Durable host-owned write intent and settlement, independent of pages and windows.
use crate::{CoreError, Workspace};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::{future::Future, path::Path};

static ADMISSION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Constructed by the host composition root; never deserialized from UI input.
pub(crate) struct Request {
    id: String,
    caller: String,
    confirmation: Option<Box<dyn Fn(String) -> std::pin::Pin<Box<dyn Future<Output = Result<bool, String>> + Send>> + Send + Sync>>,
}
impl Request {
    #[cfg(test)]
    pub(crate) fn new(id: String, caller: String) -> Self { Self { id, caller, confirmation: None } }
    pub(crate) fn with_confirmation<F, Fut>(id: String, caller: String, confirm: F) -> Self
    where F: Fn(String) -> Fut + Send + Sync + 'static, Fut: Future<Output = Result<bool, String>> + Send + 'static {
        Self { id, caller, confirmation: Some(Box::new(move |message| Box::pin(confirm(message)))) }
    }
    #[cfg(test)]
    pub(crate) fn test() -> Self { Self::new(ulid::Ulid::new().to_string(), "test".into()) }
}

/// Explicit execution context; cancellation survives renderer disposal and trust revocation.
#[derive(Clone)]
pub(crate) struct Cancellation { db: SqlitePool, run_id: String }
impl Cancellation {
    pub(crate) async fn is_requested(&self) -> bool {
        sqlx::query_scalar::<_, i64>("SELECT cancel_requested_at IS NOT NULL OR status NOT IN ('awaiting_approval','running') FROM workspace_write_runs WHERE id=?")
            .bind(&self.run_id).fetch_optional(&self.db).await.map(|value| value != Some(0)).unwrap_or(true)
    }
    pub(crate) async fn requested(&self) {
        loop {
            if self.is_requested().await { return; }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
}

pub(crate) async fn cancel(db: &SqlitePool, workspace_id: &str, run_id: &str, caller: &str) -> Result<bool, CoreError> {
    Ok(sqlx::query("UPDATE workspace_write_runs SET cancel_requested_at=COALESCE(cancel_requested_at,?) WHERE id=? AND workspace_id=? AND caller_window=? AND status IN ('awaiting_approval','running')")
        .bind(crate::now_iso()).bind(run_id).bind(workspace_id).bind(caller).execute(db).await?.rows_affected() == 1)
}

async fn replay<T: DeserializeOwned>(db: &SqlitePool, workspace_id: &str, request: &Request, identity: &str) -> Result<Option<Result<T, CoreError>>, CoreError> {
    let row = sqlx::query("SELECT id,status,request_json,result_json FROM workspace_write_runs WHERE workspace_id=? AND request_id=?")
        .bind(workspace_id).bind(&request.id).fetch_optional(db).await?;
    let Some(row) = row else { return Ok(None); };
    if row.get::<String, _>("request_json") != identity {
        return Err(CoreError::InvalidWorkspacePath("write request ID belongs to different input or caller".into()));
    }
    if matches!(row.get::<String, _>("status").as_str(), "awaiting_approval" | "running") { return Ok(Some(Err(CoreError::WorkspaceWriteBusy))); }
    let result: Option<String> = row.try_get("result_json")?;
    let document: Value = serde_json::from_str(result.as_deref().ok_or_else(|| CoreError::WriteOutcomeUnknown("stored write has no result".into()))?)
        .map_err(|error| CoreError::Initialization(error.to_string()))?;
    if document["ok"] == true {
        let value = serde_json::from_value(document["output"].clone()).map_err(|error| CoreError::Initialization(format!("stored write result incompatible: {error}")))?;
        Ok(Some(Ok(value)))
    } else {
        let code = document["error"]["code"].as_str().ok_or_else(|| CoreError::Initialization("stored write error has no code".into()))?;
        let message = document["error"]["message"].as_str().ok_or_else(|| CoreError::Initialization("stored write error has no message".into()))?;
        Ok(Some(Err(CoreError::WriteReplay { code: code.into(), message: message.into() })))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteRun {
    schema: String,
    id: String,
    workspace_id: String,
    request_id: Option<String>,
    caller_window: Option<String>,
    operation: String,
    status: String,
    snapshot: Value,
    result: Option<Value>,
    started_at: String,
    completed_at: Option<String>,
    cancel_requested_at: Option<String>,
    approval_outcome: Option<String>,
    approval_decided_at: Option<String>,
}

#[cfg(test)]
pub(crate) async fn execute<T, F, Fut>(db: &SqlitePool, workspace: &Workspace, operation: &str, input: Value, execute: F) -> Result<T, CoreError>
where T: Serialize + DeserializeOwned, F: FnOnce() -> Fut, Fut: Future<Output = Result<T, CoreError>> {
    execute_requested(db, workspace, operation, input, &Request::test(), |_| execute()).await
}

pub(crate) async fn execute_requested<T, F, Fut>(
    db: &SqlitePool, workspace: &Workspace, operation: &str, input: Value, request: &Request, execute: F,
) -> Result<T, CoreError>
where T: Serialize + DeserializeOwned, F: FnOnce(Cancellation) -> Fut, Fut: Future<Output = Result<T, CoreError>> {
    if workspace.trust != "trusted" { return Err(CoreError::WorkspaceTrustRequired); }
    if request.id.is_empty() || request.id.len() > 128 || !request.id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
        return Err(CoreError::InvalidWorkspacePath("invalid workspace write request ID".into()));
    }
    let identity = serde_json::json!({"operation":operation,"input":&input,"caller":&request.caller}).to_string();
    let admission = ADMISSION.lock().await;
    if let Some(result) = replay(db, &workspace.id, request, &identity).await? { return result; }
    let _write = crate::workspace_writes::acquire(db, &workspace.id, Path::new(&workspace.path)).await?;
    drop(admission);
    let id = ulid::Ulid::new().to_string();
    let approval_context = if request.confirmation.is_some() { Some(prepare_approval(db, workspace, &input).await?) } else { None };
    let message = format!("Git 写入：{operation}\n工作区：{}\n调用窗口：{}\n输入：{}\n\n批准仅适用于本次请求；操作可能执行仓库钩子或修改远程引用。", workspace.path, request.caller, input);
    if request.confirmation.is_some() && message.len() > 16 * 1024 { return Err(CoreError::InvalidWorkspacePath("Git approval summary exceeds 16 KiB".into())); }
    let snapshot = serde_json::json!({"schema":"aibo.workspace-write-intent/v1","origin":"host","workspaceId":workspace.id,"workspacePath":workspace.path,"operation":operation,"input":input,"approvalContext":approval_context});
    let snapshot_json = snapshot.to_string();
    if snapshot_json.len() > 64 * 1024 { return Err(CoreError::InvalidWorkspacePath("workspace write intent exceeds 64 KiB".into())); }
    let admitted = sqlx::query("INSERT INTO workspace_write_runs (id,schema_version,workspace_id,operation,status,snapshot_json,started_at,request_id,caller_window,request_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,request_id) DO NOTHING")
        .bind(&id).bind(if request.confirmation.is_some() { "aibo.workspace-write-run/v2" } else { "aibo.workspace-write-run/v1" }).bind(&workspace.id).bind(operation).bind(if request.confirmation.is_some() { "awaiting_approval" } else { "running" }).bind(snapshot_json).bind(crate::now_iso()).bind(&request.id).bind(&request.caller).bind(&identity).execute(db).await?.rows_affected();
    if admitted == 0 {
        return replay(db, &workspace.id, request, &identity).await?
            .ok_or_else(|| CoreError::Initialization("write request disappeared during admission".into()))?;
    }
    if let Some(confirm) = &request.confirmation {
        let cancellation = Cancellation { db: db.clone(), run_id: id.clone() };
        let mut decision = await_approval(confirm(message), cancellation.requested(), std::time::Duration::from_secs(300)).await;
        if decision == "approved" {
            match prepare_approval(db, workspace, &snapshot["input"]).await {
                Ok(context) if Some(&context) == approval_context.as_ref() => {},
                _ => decision = "stale",
            }
        }
        let decided_at = crate::now_iso();
        if decision == "approved" {
            let started = sqlx::query("UPDATE workspace_write_runs SET status='running',approval_outcome='approved',approval_decided_at=? WHERE id=? AND status='awaiting_approval' AND cancel_requested_at IS NULL")
                .bind(&decided_at).bind(&id).execute(db).await?.rows_affected();
            if started != 1 { decision = "cancelled"; }
        }
        if decision != "approved" {
            let error = CoreError::WriteReplay { code: "approval_rejected".into(), message: format!("Git write was not started: approval {decision}. Check the current context before submitting a new request.") };
            let result = serde_json::json!({"ok":false,"error":&error});
            sqlx::query("UPDATE workspace_write_runs SET status='rejected',approval_outcome=?,approval_decided_at=?,completed_at=?,result_json=? WHERE id=? AND status='awaiting_approval'")
                .bind(decision).bind(&decided_at).bind(&decided_at).bind(result.to_string()).bind(&id).execute(db).await?;
            return Err(error);
        }
    }
    // Construct/poll the operation only after durable admission and approval succeed.
    let result = execute(Cancellation { db: db.clone(), run_id: id.clone() }).await;
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
    list_page(db, workspace_id, limit, None).await
}

pub(crate) async fn list_page(db: &SqlitePool, workspace_id: String, limit: Option<i64>, before: Option<&crate::execution_history::Cursor>) -> Result<Vec<WriteRun>, CoreError> {
    if let Some(cursor) = before { cursor.validate(&workspace_id)?; }
    crate::workspace_by_id(db, &workspace_id).await?;
    let rows = sqlx::query("SELECT * FROM workspace_write_runs WHERE workspace_id=? AND (? IS NULL OR (started_at, 'git', id) < (?, ?, ?)) ORDER BY started_at DESC,id DESC LIMIT ?")
        .bind(workspace_id).bind(before.map(|cursor| cursor.started_at.as_str())).bind(before.map(|cursor| cursor.started_at.as_str())).bind(before.map(|cursor| cursor.kind.as_str())).bind(before.map(|cursor| cursor.id.as_str())).bind(limit.unwrap_or(20).clamp(1,100)).fetch_all(db).await?;
    rows.iter().map(|row| {
        let snapshot: String = row.try_get("snapshot_json")?;
        let result: Option<String> = row.try_get("result_json")?;
        Ok(WriteRun { schema: row.try_get("schema_version")?, id: row.try_get("id")?, workspace_id: row.try_get("workspace_id")?,
            request_id: row.try_get("request_id")?, caller_window: row.try_get("caller_window")?,
            operation: row.try_get("operation")?, status: row.try_get("status")?,
            snapshot: serde_json::from_str(&snapshot).map_err(|error| CoreError::Initialization(error.to_string()))?,
            result: result.map(|value| serde_json::from_str(&value)).transpose().map_err(|error| CoreError::Initialization(error.to_string()))?,
            started_at: row.try_get("started_at")?, completed_at: row.try_get("completed_at")?, cancel_requested_at: row.try_get("cancel_requested_at")?, approval_outcome: row.try_get("approval_outcome")?, approval_decided_at: row.try_get("approval_decided_at")? })
    }).collect()
}

async fn prepare_approval(db: &SqlitePool, workspace: &Workspace, input: &Value) -> Result<Value, CoreError> {
    let current = crate::workspace_by_id(db, &workspace.id).await?;
    if current.trust != "trusted" { return Err(CoreError::WorkspaceTrustRequired); }
    if current.path != workspace.path { return Err(CoreError::InvalidWorkspacePath("workspace changed before Git approval".into())); }
    let root = tokio::fs::canonicalize(&current.path).await.map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let session = if let Some(id) = input["sessionId"].as_str() {
        let context: Option<String> = sqlx::query_scalar("SELECT json_object('id',id,'workspaceId',workspace_id,'state',state,'archived',archived,'updatedAt',updated_at) FROM sessions WHERE id=? AND workspace_id=?")
            .bind(id).bind(&workspace.id).fetch_optional(db).await?;
        Some(context.ok_or_else(|| CoreError::InvalidWorkspacePath("Git caller session is no longer in this workspace".into()))?)
    } else { None };
    let fingerprint = crate::workspace_git_approval::fingerprint(&current.path).await?;
    Ok(serde_json::json!({"root":root,"workspacePath":current.path,"workspaceTrust":current.trust,"workspaceUpdatedAt":current.updated_at,"session":session,"repositoryFingerprint":fingerprint}))
}

async fn await_approval(confirmation: impl Future<Output = Result<bool, String>>, cancellation: impl Future<Output = ()>, timeout: std::time::Duration) -> &'static str {
    tokio::select! {
        result = tokio::time::timeout(timeout, confirmation) => match result {
            Ok(Ok(true)) => "approved", Ok(Ok(false)) => "denied", Ok(Err(_)) => "unavailable", Err(_) => "expired",
        },
        _ = cancellation => "cancelled",
    }
}

/// Startup-only. Unsettled writes are observable, never replayed.
pub(crate) async fn recover(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    let rejected_result = serde_json::json!({"ok":false,"error":{"code":"approval_rejected","message":"Host restarted during approval; Git write was not started."}});
    let rejected = sqlx::query("UPDATE workspace_write_runs SET status='rejected',approval_outcome='recovered',approval_decided_at=?,completed_at=?,result_json=? WHERE status='awaiting_approval'")
        .bind(crate::now_iso()).bind(crate::now_iso()).bind(rejected_result.to_string()).execute(db).await?.rows_affected();
    let result = serde_json::json!({"ok":false,"error":{"code":"outcome_unknown","message":"Host restarted before write settlement; inspect local and remote effects before another operation."}});
    Ok(sqlx::query("UPDATE workspace_write_runs SET status='outcome_unknown',result_json=?,completed_at=? WHERE status='running'")
        .bind(result.to_string()).bind(crate::now_iso()).execute(db).await?.rows_affected() + rejected)
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
    async fn git_approval_revalidates_state_and_never_replays_denied_requests() {
        let (root, db, _) = fixture().await;
        assert!(std::process::Command::new("git").args(["init", "-q"]).arg(&root).status().unwrap().success());
        std::fs::write(root.join(".gitignore"), "host.db*\n").unwrap();
        std::fs::write(root.join("source.txt"), "before").unwrap();
        for decision in ["denied", "stale", "trust", "cancelled", "unavailable", "approved"] {
            let task_db = db.clone(); let task_root = root.clone();
            let request = Request::with_confirmation(decision.into(), "main".into(), move |message| {
                let db = task_db.clone(); let root = task_root.clone();
                async move {
                    assert!(message.contains("git.index-all") && message.contains("stage_all"));
                    let pending = list(&db, "workspace".into(), None).await.unwrap().into_iter().find(|run| run.status == "awaiting_approval").unwrap();
                    assert!(pending.result.is_none() && pending.approval_outcome.is_none());
                    assert!(matches!(crate::workspace_writes::acquire(&db, "workspace", &root).await, Err(CoreError::WorkspaceWriteBusy)));
                    match decision {
                        "denied" => Ok(false),
                        "stale" => { std::fs::write(root.join("source.txt"), "changed while waiting").unwrap(); Ok(true) },
                        "trust" => { sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='workspace'").execute(&db).await.unwrap(); Ok(true) },
                        "cancelled" => { assert!(cancel(&db, "workspace", &pending.id, "main").await.unwrap()); Ok(true) },
                        "unavailable" => Err("window closed".into()),
                        _ => Ok(true),
                    }
                }
            });
            let result = crate::workspace_git::apply_workspace_git_action_requested(&db, "workspace".into(), "stage_all".into(), &request).await;
            let expected = if decision == "trust" { "stale" } else { decision };
            sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='workspace'").execute(&db).await.unwrap();
            let history = list(&db, "workspace".into(), None).await.unwrap();
            let run = history.iter().find(|run| run.request_id.as_deref() == Some(decision)).unwrap();
            assert_eq!(run.schema, "aibo.workspace-write-run/v2");
            assert_eq!(run.approval_outcome.as_deref(), Some(expected));
            assert!(run.approval_decided_at.is_some() && run.completed_at.is_some());
            let index = std::process::Command::new("git").arg("-C").arg(&root).arg("ls-files").output().unwrap();
            if decision == "approved" { assert!(result.unwrap().applied); assert!(!index.stdout.is_empty()); }
            else {
                let error = serde_json::to_value(result.unwrap_err()).unwrap();
                assert_eq!(error["code"], "approval_rejected"); assert_eq!(run.status, "rejected"); assert!(index.stdout.is_empty());
                let replay_request = Request::with_confirmation(decision.into(), "main".into(), |_| async { panic!("replay prompted again") });
                let replay = crate::workspace_git::apply_workspace_git_action_requested(&db, "workspace".into(), "stage_all".into(), &replay_request).await.unwrap_err();
                assert_eq!(serde_json::to_value(replay).unwrap(), error);
            }
        }
        db.close().await; std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn git_approval_timeout_and_restart_never_start_a_write() {
        assert_eq!(await_approval(std::future::pending(), std::future::pending(), std::time::Duration::from_millis(10)).await, "expired");
        let (root, db, _) = fixture().await;
        assert!(std::process::Command::new("git").args(["init", "-q"]).arg(&root).status().unwrap().success());
        std::fs::write(root.join(".gitignore"), "host.db*\n").unwrap();
        let task_db = db.clone();
        let owner = tokio::spawn(async move {
            let request = Request::with_confirmation("waiting".into(), "main".into(), |_| std::future::pending());
            crate::workspace_git::apply_workspace_git_action_requested(&task_db, "workspace".into(), "stage_all".into(), &request).await
        });
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop { if list(&db, "workspace".into(), None).await.unwrap().iter().any(|run| run.status == "awaiting_approval") { break; }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        let duplicate = Request::with_confirmation("waiting".into(), "main".into(), |_| async { panic!("duplicate opened another dialog") });
        assert!(matches!(crate::workspace_git::apply_workspace_git_action_requested(&db, "workspace".into(), "stage_all".into(), &duplicate).await, Err(CoreError::WorkspaceWriteBusy)));
        owner.abort(); let _ = owner.await;
        assert!(matches!(crate::workspace_writes::acquire(&db, "workspace", &root).await, Err(CoreError::WorkspaceWriteBusy)));
        db.close().await;
        let reopened = crate::open_database(&root.join("host.db")).await.unwrap();
        assert_eq!(recover(&reopened).await.unwrap(), 1); assert_eq!(recover(&reopened).await.unwrap(), 0);
        let history = list(&reopened, "workspace".into(), None).await.unwrap();
        assert_eq!(history[0].status, "rejected"); assert_eq!(history[0].approval_outcome.as_deref(), Some("recovered"));
        assert!(crate::workspace_git::apply_workspace_git_action_requested(&reopened, "workspace".into(), "stage_all".into(), &duplicate).await.is_err());
        let index = std::process::Command::new("git").arg("-C").arg(&root).arg("ls-files").output().unwrap();
        assert!(index.stdout.is_empty());
        reopened.close().await; std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn request_migration_preserves_legacy_results_without_inventing_identity() {
        let db = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('w');").execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0033_workspace_write_runs.sql")).execute(&db).await.unwrap();
        sqlx::query(r#"INSERT INTO workspace_write_runs VALUES ('old','aibo.workspace-write-run/v1','w','git.commit','completed','{}','{"ok":true,"output":{"committed":true}}','before','after')"#).execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0034_workspace_write_requests.sql")).execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0035_workspace_write_cancellation.sql")).execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0036_workspace_write_approval.sql")).execute(&db).await.unwrap();
        let row = sqlx::query("SELECT * FROM workspace_write_runs WHERE id='old'").fetch_one(&db).await.unwrap();
        assert_eq!(row.get::<String,_>("completed_at"), "after");
        assert!(row.get::<Option<String>,_>("request_id").is_none());
        assert!(row.get::<Option<String>,_>("caller_window").is_none());
        assert!(row.get::<Option<String>,_>("cancel_requested_at").is_none());
        assert!(row.get::<Option<String>,_>("approval_outcome").is_none());
        let value: Value = serde_json::from_str(row.get::<&str,_>("result_json")).unwrap();
        assert_eq!(value["output"]["committed"], true);
        db.close().await;
    }

    #[tokio::test]
    async fn durable_cancel_prevents_the_next_git_command_and_is_idempotent() {
        let (root, db, workspace) = fixture().await;
        std::fs::write(root.join("file.txt"), "keep").unwrap();
        let result = execute_requested(&db, &workspace, "git.index", serde_json::json!({}), &Request::test(), |context| async {
            let runs = list(&db, "workspace".into(), None).await.unwrap();
            assert!(cancel(&db, "workspace", &runs[0].id, "test").await.unwrap());
            let first = list(&db, "workspace".into(), None).await.unwrap()[0].cancel_requested_at.clone();
            assert!(cancel(&db, "workspace", &runs[0].id, "test").await.unwrap());
            assert_eq!(list(&db, "workspace".into(), None).await.unwrap()[0].cancel_requested_at, first);
            crate::workspace_git::apply_git_index_action(&workspace.path, "file.txt", "stage", Some(context)).await
        }).await.unwrap_err();
        // This directory is not a Git repository: a spawned command would instead
        // return a known nonzero result. Cancellation rejects before any spawn.
        assert!(matches!(result, CoreError::WriteOutcomeUnknown(_)));
        assert!(result.to_string().contains("before launching"));
        assert_eq!(std::fs::read_to_string(root.join("file.txt")).unwrap(), "keep");
        db.close().await; std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn duplicate_requests_do_not_repeat_effects_and_preserve_results_and_errors() {
        let (root, db, workspace) = fixture().await;
        let request = Request::new("same-request".into(), "main".into());
        for id in ["".to_owned(), "x".repeat(129), "bad id".to_owned()] {
            assert!(execute_requested::<Value, _, _>(&db, &workspace, "fixture.write", serde_json::json!({}), &Request::new(id, "main".into()), |_| async { panic!("invalid ID executed") }).await.is_err());
        }
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let input = serde_json::json!({"name":"effect"});
        let (first, second) = tokio::join!(
            execute_requested(&db, &workspace, "fixture.write", input.clone(), &request, |_| async {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                std::fs::write(root.join("effect"), "once").unwrap();
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                Ok(serde_json::json!({"applied":true}))
            }),
            execute_requested(&db, &workspace, "fixture.write", input.clone(), &request, |_| async {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                std::fs::write(root.join("effect"), "once").unwrap();
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                Ok(serde_json::json!({"applied":true}))
            })
        );
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(first.is_ok() || second.is_ok());
        for result in [first, second] { if let Err(error) = result { assert!(matches!(error, CoreError::WorkspaceWriteBusy)); } }
        let replay: Value = execute_requested(&db, &workspace, "fixture.write", input.clone(), &request, |_| async { panic!("duplicate re-executed") }).await.unwrap();
        assert_eq!(replay, serde_json::json!({"applied":true}));
        for (operation, input, request) in [
            ("different-operation", input.clone(), Request::new("same-request".into(), "main".into())),
            ("fixture.write", serde_json::json!({"name":"other"}), Request::new("same-request".into(), "main".into())),
            ("fixture.write", input.clone(), Request::new("same-request".into(), "other-window".into())),
        ] {
            assert!(execute_requested::<Value, _, _>(&db, &workspace, operation, input, &request, |_| async { panic!("conflicting request executed") }).await.is_err());
        }
        let denied = Request::new("failed-request".into(), "main".into());
        let original = execute_requested::<Value, _, _>(&db, &workspace, "fixture.error", serde_json::json!({}), &denied, |_| async { Err(CoreError::InvalidWorkspacePath("fixture rejection".into())) }).await.unwrap_err();
        let repeated = execute_requested::<Value, _, _>(&db, &workspace, "fixture.error", serde_json::json!({}), &denied, |_| async { panic!("failed request replayed") }).await.unwrap_err();
        assert_eq!(serde_json::to_value(original).unwrap(), serde_json::to_value(repeated).unwrap());
        assert_eq!(list(&db, "workspace".into(), None).await.unwrap().len(), 2);
        db.close().await;
        let reopened = crate::open_database(&root.join("host.db")).await.unwrap();
        let replay: Value = execute_requested(&reopened, &workspace, "fixture.write", input, &request, |_| async { panic!("restarted request executed") }).await.unwrap();
        assert_eq!(replay["applied"], true);
        assert_eq!(std::fs::read_to_string(root.join("effect")).unwrap(), "once");
        reopened.close().await; std::fs::remove_dir_all(root).unwrap();
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
        let owner = tokio::spawn(async move { crate::workspace_git::commit_workspace_changes_requested(&task_db, "workspace".into(), "Ledger fixture\n\nCo-authored-by: Codex <codex@openai.com>".into(), &Request::new("restart-commit".into(), "test".into())).await });
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
        let replay = crate::workspace_git::commit_workspace_changes_requested(&reopened, "workspace".into(), "Ledger fixture\n\nCo-authored-by: Codex <codex@openai.com>".into(), &Request::new("restart-commit".into(), "test".into())).await.unwrap_err();
        assert_eq!(serde_json::to_value(replay).unwrap()["code"], "outcome_unknown");
        assert_eq!(list(&reopened, "workspace".into(), None).await.unwrap().len(), 1);
        tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
        assert!(!root.join("late-hook").exists()); assert_eq!(git(&["rev-list", "--count", "HEAD"]), "1");
        reopened.close().await; std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancelled_git_commit_preserves_effects_output_and_caller_scope() {
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
        std::fs::write(&hook, "#!/bin/sh\nprintf BEFORE_CANCEL\ntouch hook-started\n(sleep 2; touch late-hook) &\nwait\n").unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(root.join("source.txt"), "committed").unwrap(); git(&["add", "--", "source.txt"]);
        let task_db = db.clone();
        let owner = tokio::spawn(async move { crate::workspace_git::commit_workspace_changes_requested(&task_db, "workspace".into(), "Ledger fixture\n\nCo-authored-by: Codex <codex@openai.com>".into(), &Request::new("restart-commit".into(), "test".into())).await });
        tokio::time::timeout(std::time::Duration::from_secs(5), async { while !root.join("hook-started").exists() { tokio::time::sleep(std::time::Duration::from_millis(10)).await; } }).await.unwrap();
        let pending = list(&db, "workspace".into(), None).await.unwrap();
        assert_eq!(pending[0].status, "running"); assert_eq!(pending[0].operation, "git.commit");
        assert!(pending[0].snapshot["input"]["message"].as_str().unwrap().starts_with("Ledger fixture"));
        let run_id = &pending[0].id;
        assert!(!cancel(&db, "workspace", run_id, "other-window").await.unwrap());
        assert!(!cancel(&db, "other-workspace", run_id, "test").await.unwrap());
        assert!(list(&db, "workspace".into(), None).await.unwrap()[0].cancel_requested_at.is_none());
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='workspace'").execute(&db).await.unwrap();
        assert!(cancel(&db, "workspace", run_id, "test").await.unwrap());
        let result = tokio::time::timeout(std::time::Duration::from_secs(3), owner).await.unwrap().unwrap().unwrap_err();
        assert!(matches!(result, CoreError::WriteOutcomeUnknown(_)));
        assert!(result.to_string().contains("BEFORE_CANCEL"));
        assert!(!cancel(&db, "workspace", run_id, "test").await.unwrap());
        let settled = list(&db, "workspace".into(), None).await.unwrap();
        assert!(settled[0].cancel_requested_at.is_some());
        sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='workspace'").execute(&db).await.unwrap();
        assert_eq!(git(&["show", "HEAD:source.txt"]), "committed");
        db.close().await;
        let reopened = crate::open_database(&root.join("host.db")).await.unwrap();
        assert_eq!(recover(&reopened).await.unwrap(), 0); assert_eq!(recover(&reopened).await.unwrap(), 0);
        let history = list(&reopened, "workspace".into(), None).await.unwrap();
        assert_eq!(history.len(), 1); assert_eq!(history[0].id, pending[0].id); assert_eq!(history[0].status, "outcome_unknown");
        assert!(history[0].completed_at.is_some());
        let replay = crate::workspace_git::commit_workspace_changes_requested(&reopened, "workspace".into(), "Ledger fixture\n\nCo-authored-by: Codex <codex@openai.com>".into(), &Request::new("restart-commit".into(), "test".into())).await.unwrap_err();
        assert_eq!(serde_json::to_value(replay).unwrap()["code"], "outcome_unknown");
        assert_eq!(list(&reopened, "workspace".into(), None).await.unwrap().len(), 1);
        tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
        assert!(!root.join("late-hook").exists()); assert_eq!(git(&["rev-list", "--count", "HEAD"]), "1");
        reopened.close().await; std::fs::remove_dir_all(root).unwrap();
    }
}
