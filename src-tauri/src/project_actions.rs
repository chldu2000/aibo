//! Project task definitions and execution, independent of Tauri command state.
use crate::{CoreError, ProjectAction, ProjectActionRun, workspace_by_id, session_by_id,
    now_iso};
use sqlx::{Row, SqlitePool};
use std::{fs, path::Path, time::Duration};
use tokio::process::Command as TokioCommand;
use ulid::Ulid;

// Serialize only admission, so duplicates observe the first persisted intent.
static ADMISSION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn project_action_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<ProjectAction, CoreError> {
    let args_json: String = row.try_get("args_json")?;
    let args = serde_json::from_str(&args_json).map_err(|error| {
        CoreError::InvalidWorkspacePath(format!("invalid project action args: {error}"))
    })?;
    Ok(ProjectAction {
        schema: row.try_get("schema_version")?,
        id: row.try_get("id")?,
        workspace_id: row.try_get("workspace_id")?,
        name: row.try_get("name")?,
        kind: row.try_get("kind")?,
        program: row.try_get("program")?,
        args,
        cwd: row.try_get("cwd")?,
        enabled: row.try_get::<i64, _>("enabled")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn project_action_by_id(
    db: &SqlitePool,
    workspace_id: &str,
    action_id: &str,
) -> Result<ProjectAction, CoreError> {
    let row = sqlx::query(
        "SELECT id, workspace_id, schema_version, name, kind, program, args_json,
                cwd, enabled, created_at, updated_at
         FROM project_actions WHERE id = ? AND workspace_id = ?",
    )
    .bind(action_id)
    .bind(workspace_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| CoreError::SessionNotFound(format!("project action {action_id}")))?;
    project_action_from_row(&row)
}

pub(crate) async fn list_project_actions(
    db: &SqlitePool,
    workspace_id: String,
) -> Result<Vec<ProjectAction>, CoreError> {
    workspace_by_id(db, &workspace_id).await?;
    let rows = sqlx::query(
        "SELECT id, workspace_id, schema_version, name, kind, program, args_json,
                cwd, enabled, created_at, updated_at
         FROM project_actions WHERE workspace_id = ? ORDER BY enabled DESC, kind ASC, name ASC",
    )
    .bind(&workspace_id)
    .fetch_all(db)
    .await?;
    rows.iter().map(project_action_from_row).collect()
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_project_action(
    db: &SqlitePool,
    workspace_id: String,
    action_id: Option<String>,
    name: String,
    kind: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    enabled: Option<bool>,
) -> Result<ProjectAction, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let name = name.trim();
    let kind = kind.trim();
    let program = program.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(CoreError::InvalidWorkspacePath(
            "project action name must be 1-80 characters".to_owned(),
        ));
    }
    if !matches!(kind, "test" | "lint" | "build" | "custom") {
        return Err(CoreError::InvalidWorkspacePath(
            "unsupported project action kind".to_owned(),
        ));
    }
    if program.is_empty() || program.len() > 255 || program.as_bytes().contains(&0) {
        return Err(CoreError::InvalidWorkspacePath(
            "project action program is invalid".to_owned(),
        ));
    }
    if args.len() > 32
        || args
            .iter()
            .any(|arg| arg.len() > 4096 || arg.as_bytes().contains(&0))
    {
        return Err(CoreError::InvalidWorkspacePath(
            "project action args exceed limits".to_owned(),
        ));
    }
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let action_cwd = cwd.as_deref().unwrap_or(".");
    let canonical_cwd = crate::workspace_guard::canonicalize_target(&root, Path::new(action_cwd))
        .map_err(CoreError::InvalidWorkspacePath)?;
    if !canonical_cwd.is_dir() {
        return Err(CoreError::InvalidWorkspacePath(
            "project action cwd is not a directory".to_owned(),
        ));
    }
    let cwd = canonical_cwd
        .strip_prefix(&root)
        .map(|path| {
            let value = path.to_string_lossy().replace('\\', "/");
            if value.is_empty() {
                ".".to_owned()
            } else {
                value
            }
        })
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let args_json = serde_json::to_string(&args).map_err(|error| {
        CoreError::InvalidWorkspacePath(format!("serialize project action args: {error}"))
    })?;
    let id = action_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Ulid::new().to_string());
    if let Some(existing) =
        sqlx::query_scalar::<_, String>("SELECT workspace_id FROM project_actions WHERE id = ?")
            .bind(&id)
            .fetch_optional(db)
            .await?
    {
        if existing != workspace_id {
            return Err(CoreError::InvalidWorkspacePath(
                "project action belongs to another workspace".to_owned(),
            ));
        }
    }
    let now = now_iso();
    sqlx::query(
        "INSERT INTO project_actions
         (id, workspace_id, schema_version, name, kind, program, args_json, cwd, enabled, created_at, updated_at)
         VALUES (?, ?, 'aibo.project-action/v1', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
           program = excluded.program, args_json = excluded.args_json, cwd = excluded.cwd,
           enabled = excluded.enabled, updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(&workspace_id)
    .bind(name)
    .bind(kind)
    .bind(program)
    .bind(args_json)
    .bind(cwd)
    .bind(enabled.unwrap_or(true) as i64)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await?;
    project_action_by_id(db, &workspace_id, &id).await
}

pub(crate) async fn delete_project_action(
    db: &SqlitePool,
    workspace_id: String,
    action_id: String,
) -> Result<(), CoreError> {
    workspace_by_id(db, &workspace_id).await?;
    sqlx::query("DELETE FROM project_actions WHERE id = ? AND workspace_id = ?")
        .bind(action_id)
        .bind(workspace_id)
        .execute(db)
        .await?;
    Ok(())
}

/// Request identity is scoped to a workspace. Replaying observes the original run,
/// including unknown outcomes; it never resolves a new task definition or executes again.
async fn replay_request(
    db: &SqlitePool, workspace_id: &str, request_id: &str, request_json: &str,
) -> Result<Option<ProjectActionRun>, CoreError> {
    let row = sqlx::query("SELECT *, json_extract(snapshot_json,'$.definition.name') AS action_name FROM project_action_runs WHERE workspace_id=? AND request_id=?")
        .bind(workspace_id).bind(request_id).fetch_optional(db).await?;
    match row {
        Some(row) => {
            let stored: serde_json::Value = serde_json::from_str(row.try_get::<&str, _>("request_json")?).map_err(|error| CoreError::Initialization(error.to_string()))?;
            let mut requested: serde_json::Value = serde_json::from_str(request_json).map_err(|error| CoreError::Initialization(error.to_string()))?;
            // Old desktop-only requests did not record a window. They remain
            // readable, but replay still cannot enter approval or execution.
            if stored.get("caller").is_none() { requested.as_object_mut().unwrap().remove("caller"); }
            if stored != requested {
                return Err(CoreError::InvalidWorkspacePath("request ID already belongs to different project task input".into()));
            }
            Ok(Some(project_action_run_from_row(&row)?))
        }
        None => Ok(None),
    }
}

/// Persist user intent before signalling execution; repeated cancellation is idempotent.
pub(crate) async fn cancel_project_action(db: &SqlitePool, workspace_id: String, run_id: String) -> Result<bool, CoreError> {
    workspace_by_id(db, &workspace_id).await?;
    let changed = sqlx::query("UPDATE project_action_runs SET cancel_requested_at=COALESCE(cancel_requested_at,?) WHERE workspace_id=? AND id=? AND status IN ('awaiting_approval','running')")
        .bind(now_iso()).bind(workspace_id).bind(run_id).execute(db).await?.rows_affected();
    Ok(changed == 1)
}

async fn cancellation_requested(db: &SqlitePool, run_id: &str) {
    loop {
        let requested = sqlx::query_scalar::<_, Option<String>>("SELECT cancel_requested_at FROM project_action_runs WHERE id=? AND status IN ('awaiting_approval','running')")
            .bind(run_id).fetch_optional(db).await;
        match requested {
            Ok(Some(None)) => tokio::time::sleep(Duration::from_millis(100)).await,
            // Loss of the record or database access also stops execution rather
            // than allowing unobservable writes. Settlement may require recovery.
            _ => return,
        }
    }
}

async fn await_approval(
    confirmation: impl std::future::Future<Output = Result<bool, String>>,
    cancellation: impl std::future::Future<Output = ()>,
    timeout: Duration,
) -> &'static str {
    tokio::select! {
        result = tokio::time::timeout(timeout, confirmation) => match result {
            Ok(Ok(true)) => "approved", Ok(Ok(false)) => "denied",
            Ok(Err(_)) => "unavailable", Err(_) => "expired",
        },
        _ = cancellation => "cancelled",
    }
}

struct PreparedTask {
    action: ProjectAction,
    root: std::path::PathBuf,
    cwd: std::path::PathBuf,
    context: serde_json::Value,
}

async fn prepare_task(db: &SqlitePool, workspace_id: &str, action_id: &str, session_id: Option<&str>) -> Result<PreparedTask, CoreError> {
    let workspace = workspace_by_id(db, workspace_id).await?;
    if workspace.trust != "trusted" { return Err(CoreError::WorkspaceTrustRequired); }
    let action = project_action_by_id(db, workspace_id, action_id).await?;
    if !action.enabled { return Err(CoreError::InvalidWorkspacePath("project action is disabled".into())); }
    let session_context = if let Some(id) = session_id {
        let session = session_by_id(db, id).await?;
        if session.workspace_id != workspace_id { return Err(CoreError::InvalidWorkspacePath("session does not belong to workspace".into())); }
        let context: String = sqlx::query_scalar("SELECT json_object('id',id,'workspaceId',workspace_id,'state',state,'archived',archived,'updatedAt',updated_at) FROM sessions WHERE id=?")
            .bind(id).fetch_one(db).await?;
        Some(context)
    } else { None };
    let root = fs::canonicalize(&workspace.path).map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let cwd = crate::workspace_guard::canonicalize_target(&root, Path::new(&action.cwd)).map_err(CoreError::InvalidWorkspacePath)?;
    if !cwd.is_dir() { return Err(CoreError::InvalidWorkspacePath("task working directory is not a directory".into())); }
    let context = serde_json::json!({"workspaceId":workspace_id,"workspacePath":workspace.path,"workspaceTrust":workspace.trust,"workspaceUpdatedAt":workspace.updated_at,"root":root,"cwd":cwd,"definition":action,"session":session_context});
    Ok(PreparedTask { action, root, cwd, context })
}

#[cfg(test)]
pub(crate) async fn run_project_action(db: &SqlitePool, data_dir: &Path, workspace_id: String, action_id: String, session_id: Option<String>, request_id: String) -> Result<ProjectActionRun, CoreError> {
    run_project_action_with_confirmation(db, data_dir, workspace_id, action_id, session_id, request_id, "test".into(), |_| async { Ok(true) }).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_project_action_with_confirmation<F, Fut>(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_id: String,
    action_id: String,
    session_id: Option<String>,
    request_id: String,
    caller: String,
    confirm: F,
) -> Result<ProjectActionRun, CoreError>
where F: FnOnce(String) -> Fut, Fut: std::future::Future<Output = Result<bool, String>> {
    if request_id.is_empty() || request_id.len() > 128 || !request_id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
        return Err(CoreError::InvalidWorkspacePath("invalid project task request ID".into()));
    }
    let admission = ADMISSION.lock().await;
    let request_json = serde_json::json!({"actionId": &action_id, "sessionId": &session_id, "caller": &caller}).to_string();
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    if let Some(run) = replay_request(db, &workspace_id, &request_id, &request_json).await? {
        return Ok(run);
    }
    let prepared = prepare_task(db, &workspace_id, &action_id, session_id.as_deref()).await?;
    let message = format!("任务：{}\n工作区：{}\n工作目录：{}\n程序：{}\n参数（JSON 数组）：{}\n会话：{}\n窗口：{}", prepared.action.name, prepared.root.display(), prepared.cwd.display(), prepared.action.program, serde_json::to_string(&prepared.action.args).unwrap(), session_id.as_deref().unwrap_or("无"), caller);
    if message.len() > 16 * 1024 { return Err(CoreError::InvalidWorkspacePath("task approval summary exceeds 16 KiB".into())); }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, &prepared.root).await?;
    let action = &prepared.action;
    let started_at = now_iso();
    let run_id = Ulid::new().to_string();
    let snapshot = serde_json::to_string(&serde_json::json!({"schema":"aibo.project-action-snapshot/v1","origin":"admission","definition":&action,"approvalContext":&prepared.context,"caller":&caller})).map_err(|error| CoreError::Initialization(error.to_string()))?;
    // Record intent before the first side effect. A crash leaves a recoverable run.
    let admitted = sqlx::query("INSERT INTO project_action_runs (id,schema_version,action_id,workspace_id,session_id,status,output,started_at,completed_at,snapshot_json,request_id,request_json) VALUES (?,'aibo.project-action-run/v3',?,?,?,'awaiting_approval','',?,NULL,?,?,?) ON CONFLICT(workspace_id,request_id) DO NOTHING")
        .bind(&run_id).bind(&action_id).bind(&workspace_id).bind(&session_id).bind(&started_at).bind(snapshot).bind(&request_id).bind(&request_json).execute(db).await?.rows_affected();
    if admitted == 0 {
        return replay_request(db, &workspace_id, &request_id, &request_json).await?
            .ok_or_else(|| CoreError::Initialization("project task request disappeared during admission".into()));
    }
    drop(admission);
    let decision = await_approval(confirm(message), cancellation_requested(db, &run_id), Duration::from_secs(300)).await;
    let mut decision = decision;
    if decision == "approved" {
        match prepare_task(db, &workspace_id, &action_id, session_id.as_deref()).await {
            Ok(current) if current.context == prepared.context => {},
            _ => decision = "stale",
        }
    }
    let decided_at = now_iso();
    if decision == "approved" {
        let started = sqlx::query("UPDATE project_action_runs SET status='running',approval_outcome='approved',approval_decided_at=? WHERE id=? AND status='awaiting_approval' AND cancel_requested_at IS NULL")
            .bind(&decided_at).bind(&run_id).execute(db).await?.rows_affected();
        if started == 0 { decision = "cancelled"; }
    }
    if decision != "approved" {
        sqlx::query("UPDATE project_action_runs SET status='rejected',approval_outcome=?,approval_decided_at=?,completed_at=?,output=? WHERE id=? AND status='awaiting_approval'")
            .bind(decision).bind(&decided_at).bind(&decided_at).bind(format!("Task was not started: approval {decision}. Submit a new request after checking the current context."))
            .bind(&run_id).execute(db).await?;
        return replay_request(db, &workspace_id, &request_id, &request_json).await?
            .ok_or_else(|| CoreError::Initialization("task approval record disappeared".into()));
    }
    let mut command = TokioCommand::new(&action.program);
    command.args(&action.args).current_dir(&prepared.cwd);
    let execution = match crate::controlled_process::execute_cancellable(command, Duration::from_secs(300), 1024 * 1024 + 1, cancellation_requested(db, &run_id)).await {
        Ok(execution) => execution,
        Err(error) => {
            let message = crate::artifact::sanitize_content("project-action.command", &format!("Execution result unknown: {error}"));
            let completed_at = now_iso();
            let changed = sqlx::query("UPDATE project_action_runs SET status='outcome_unknown',output=?,completed_at=? WHERE id=? AND status='running'")
                .bind(&message).bind(&completed_at).bind(&run_id).execute(db).await?.rows_affected();
            if changed != 1 { return Err(CoreError::Initialization("project task record changed concurrently".into())); }
            return Ok(ProjectActionRun { schema: "aibo.project-action-run/v3".into(), id: run_id,
                action_id, action_name: Some(action.name.clone()), workspace_id, session_id,
                status: "outcome_unknown".into(), exit_code: None, output: message, artifact_id: None,
                started_at, completed_at: Some(completed_at) });
        }
    };
    let status = if execution.timed_out || execution.cancelled { "outcome_unknown" } else if execution.success { "completed" } else { "failed" };
    let exit_code = execution.exit_code.map(i64::from);
    let mut output = String::from_utf8_lossy(&execution.stdout).to_string();
    let stderr = String::from_utf8_lossy(&execution.stderr).to_string();
    if !stderr.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&stderr);
    }
    if execution.cancelled {
        output.push_str("\nExecution stopped after cancellation or loss of its record; earlier effects may remain. Inspect changes before another run.");
    }
    let output = crate::artifact::truncate_utf8(
        &crate::artifact::sanitize_content("project-action.command", &output),
        1024 * 1024,
        "\n… 工程动作输出已截断",
    );
    let completed_at = now_iso();
    let artifact_id = if let Some(session_id) = session_id.as_deref() {
        crate::artifact::persist_text(
            db,
            data_dir,
            &workspace_id,
            session_id,
            None,
            &format!("project-action.{}", action.kind),
            "text/plain",
            &output,
        )
        .await
        .ok()
    } else {
        None
    };
    let changed = sqlx::query("UPDATE project_action_runs SET status=?,exit_code=?,output=?,artifact_id=?,completed_at=? WHERE id=? AND status='running'")
        .bind(status).bind(exit_code).bind(&output).bind(&artifact_id).bind(&completed_at).bind(&run_id).execute(db).await?.rows_affected();
    if changed != 1 { return Err(CoreError::Initialization("project task record changed concurrently".into())); }
    Ok(ProjectActionRun {
        schema: "aibo.project-action-run/v3".to_owned(),
        id: run_id,
        action_id,
        action_name: Some(action.name.clone()),
        workspace_id,
        session_id,
        status: status.to_owned(),
        exit_code,
        output,
        artifact_id,
        started_at,
        completed_at: Some(completed_at),
    })
}

fn project_action_run_from_row(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<ProjectActionRun, CoreError> {
    Ok(ProjectActionRun {
        schema: row.try_get("schema_version")?,
        id: row.try_get("id")?,
        action_id: row.try_get("action_id")?,
        action_name: row.try_get("action_name")?,
        workspace_id: row.try_get("workspace_id")?,
        session_id: row.try_get("session_id")?,
        status: row.try_get("status")?,
        exit_code: row.try_get("exit_code")?,
        output: row.try_get("output")?,
        artifact_id: row.try_get("artifact_id")?,
        started_at: row.try_get("started_at")?,
        completed_at: row.try_get("completed_at")?,
    })
}

pub(crate) async fn list_project_action_runs(
    db: &SqlitePool,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<ProjectActionRun>, CoreError> {
    workspace_by_id(db, &workspace_id).await?;
    let limit = limit.unwrap_or(10).clamp(1, 50);
    let rows = sqlx::query(
        "SELECT id, schema_version, action_id, workspace_id, session_id, status,
                exit_code, output, artifact_id, started_at, completed_at, json_extract(snapshot_json,'$.definition.name') AS action_name
         FROM project_action_runs WHERE workspace_id = ?
         ORDER BY started_at DESC, id DESC LIMIT ?",
    )
    .bind(&workspace_id)
    .bind(limit)
    .fetch_all(db)
    .await?;
    rows.iter().map(project_action_run_from_row).collect()
}


/// Startup-only recovery: incomplete execution is never automatically replayed.
pub(crate) async fn recover(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    let rejected = sqlx::query("UPDATE project_action_runs SET status='rejected',approval_outcome='recovered',approval_decided_at=?,completed_at=?,output='Host restarted during approval; task was not started.' WHERE status='awaiting_approval'")
        .bind(now_iso()).bind(now_iso()).execute(db).await?.rows_affected();
    Ok(sqlx::query("UPDATE project_action_runs SET status='outcome_unknown',completed_at=?,output=output || '\nHost restarted before execution settled; inspect effects before retrying.' WHERE status='running'")
        .bind(now_iso()).execute(db).await?.rows_affected() + rejected)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn task_service_runs_without_a_window_and_preserves_scope_and_history() {
        let root = std::env::temp_dir().join(format!("aibo-project-service-{}", Ulid::new()));
        fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        let now = now_iso();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Task service',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(&now).bind(&now).execute(&db).await.unwrap();
        let action = save_project_action(&db, "workspace".into(), None, "Check".into(), "test".into(), "/bin/sh".into(),
            vec!["-c".into(), "printf PROJECT_TASK_OK; printf TASK_STDERR >&2".into()], None, None).await.unwrap();
        assert_eq!(list_project_actions(&db, "workspace".into()).await.unwrap().len(), 1);
        let run = run_project_action(&db, &root, "workspace".into(), action.id.clone(), None, Ulid::new().to_string()).await.unwrap();
        assert_eq!(run.status, "completed");
        assert_eq!(run.exit_code, Some(0));
        assert!(run.output.contains("PROJECT_TASK_OK"));
        assert!(run.output.contains("TASK_STDERR"));
        let history = list_project_action_runs(&db, "workspace".into(), Some(10)).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, run.id);
        assert_eq!(history[0].output, run.output);
        assert!(save_project_action(&db, "workspace".into(), None, "Escape".into(), "test".into(), "/bin/sh".into(),
            vec![], Some("..".into()), None).await.is_err());
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='workspace'").execute(&db).await.unwrap();
        assert!(matches!(run_project_action(&db, &root, "workspace".into(), action.id.clone(), None, Ulid::new().to_string()).await, Err(CoreError::WorkspaceTrustRequired)));
        assert_eq!(list_project_action_runs(&db, "workspace".into(), None).await.unwrap().len(), 1);
        delete_project_action(&db, "workspace".into(), action.id).await.unwrap();
        assert!(list_project_actions(&db, "workspace".into()).await.unwrap().is_empty());
        let retained = list_project_action_runs(&db, "workspace".into(), None).await.unwrap();
        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].action_name.as_deref(), Some("Check"));
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn running_record_survives_owner_loss_and_startup_marks_unknown() {
        let root = std::env::temp_dir().join(format!("aibo-task-recovery-{}", Ulid::new()));
        fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        let now = now_iso();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Recovery',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(&now).bind(&now).execute(&db).await.unwrap();
        let action = save_project_action(&db, "workspace".into(), None, "Long task".into(), "test".into(), "/bin/sh".into(), vec!["-c".into(), "touch started; sleep 30".into()], None, None).await.unwrap();
        let task_db = db.clone(); let task_root = root.clone(); let action_id = action.id.clone();
        let owner = tokio::spawn(async move { run_project_action(&task_db, &task_root, "workspace".into(), action_id, None, "recovery-request".into()).await });
        tokio::time::timeout(Duration::from_secs(3), async { while !root.join("started").exists() { tokio::time::sleep(Duration::from_millis(10)).await; } }).await.unwrap();
        let pending = list_project_action_runs(&db, "workspace".into(), None).await.unwrap();
        assert_eq!(pending[0].status, "running");
        assert!(pending[0].completed_at.is_none());
        owner.abort(); let _ = owner.await;
        assert!(matches!(crate::workspace_git::apply_workspace_git_action(&db, "workspace".into(), "stage_all".into()).await, Err(CoreError::WorkspaceWriteBusy)));
        delete_project_action(&db, "workspace".into(), action.id.clone()).await.unwrap();
        db.close().await;
        let reopened = crate::open_database(&root.join("host.db")).await.unwrap();
        assert_eq!(recover(&reopened).await.unwrap(), 1);
        assert_eq!(recover(&reopened).await.unwrap(), 0);
        let recovered = list_project_action_runs(&reopened, "workspace".into(), None).await.unwrap();
        assert_eq!(recovered[0].id, pending[0].id);
        assert_eq!(recovered[0].status, "outcome_unknown");
        assert_eq!(recovered[0].action_name.as_deref(), Some("Long task"));
        assert!(recovered[0].completed_at.is_some());
        let replay = run_project_action(&reopened, &root, "workspace".into(), action.id, None, "recovery-request".into()).await.unwrap();
        assert_eq!(replay.id, pending[0].id);
        assert_eq!(replay.status, "outcome_unknown");
        let missing = save_project_action(&reopened, "workspace".into(), None, "Missing program".into(), "test".into(), root.join("missing-program").to_string_lossy().into_owned(), vec![], None, None).await.unwrap();
        let failed = run_project_action(&reopened, &root, "workspace".into(), missing.id, None, Ulid::new().to_string()).await.unwrap();
        assert_eq!(failed.status, "outcome_unknown");
        assert_eq!(failed.schema, "aibo.project-action-run/v3");
        assert!(list_project_action_runs(&reopened, "workspace".into(), None).await.unwrap().iter().any(|run| run.id == failed.id));
        reopened.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn approval_wait_is_bounded_even_when_the_window_never_replies() {
        let result = tokio::time::timeout(Duration::from_secs(1), await_approval(std::future::pending(), std::future::pending(), Duration::from_millis(10))).await.unwrap();
        assert_eq!(result, "expired");
    }

    #[tokio::test]
    async fn approval_rechecks_definition_trust_and_cancellation_before_any_effect() {
        let root = std::env::temp_dir().join(format!("aibo-task-approval-{}", Ulid::new()));
        fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Approval',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(now_iso()).bind(now_iso()).execute(&db).await.unwrap();
        let action = save_project_action(&db, "workspace".into(), None, "Review command".into(), "test".into(), "/bin/sh".into(),
            vec!["-c".into(), "touch original".into()], None, None).await.unwrap();
        let denied = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "denied".into(), "window".into(), |message| {
            assert!(message.contains("/bin/sh")); assert!(message.contains("touch original")); assert!(message.contains("window"));
            async {
            let pending = list_project_action_runs(&db, "workspace".into(), None).await.unwrap();
            assert_eq!(pending[0].status, "awaiting_approval");
            assert!(!root.join("original").exists());
            Ok(false)
            }
        }).await.unwrap();
        assert_eq!(denied.status, "rejected");
        assert!(denied.output.contains("denied"));
        let replay = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "denied".into(), "window".into(), |_| async { panic!("a replay must not request approval again") }).await.unwrap();
        assert_eq!(replay.id, denied.id);
        assert!(run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "denied".into(), "other-window".into(), |_| async { Ok(true) }).await.is_err());
        let unavailable = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "unavailable".into(), "window".into(), |_| async { Err("window closed".into()) }).await.unwrap();
        assert!(unavailable.output.contains("unavailable"));
        let revoked = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "revoked".into(), "window".into(), |_| async {
            sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='workspace'").execute(&db).await.unwrap(); Ok(true)
        }).await.unwrap();
        assert!(revoked.output.contains("stale"));
        sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='workspace'").execute(&db).await.unwrap();
        let changed = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "changed".into(), "window".into(), |_| async {
            sqlx::query("UPDATE project_actions SET args_json=? WHERE id=?").bind(serde_json::json!(["-c","touch changed"]).to_string()).bind(&action.id).execute(&db).await.unwrap(); Ok(true)
        }).await.unwrap();
        assert!(changed.output.contains("stale"));
        assert!(!root.join("original").exists()); assert!(!root.join("changed").exists());
        let cancelled = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "cancel-approval".into(), "window".into(), |_| async {
            let pending = list_project_action_runs(&db, "workspace".into(), None).await.unwrap().into_iter().find(|run| run.status == "awaiting_approval").unwrap();
            assert!(cancel_project_action(&db, "workspace".into(), pending.id).await.unwrap());
            std::future::pending::<Result<bool, String>>().await
        }).await.unwrap();
        assert!(cancelled.output.contains("cancelled")); assert!(!root.join("changed").exists());
        let approved = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id, None, "approved".into(), "window".into(), |message| async move { assert!(message.contains("touch changed")); Ok(true) }).await.unwrap();
        assert_eq!(approved.status, "completed"); assert!(root.join("changed").exists()); assert!(!root.join("original").exists());
        let approval: (String, String) = sqlx::query_as("SELECT approval_outcome,approval_decided_at FROM project_action_runs WHERE id=?").bind(&approved.id).fetch_one(&db).await.unwrap();
        assert_eq!(approval.0, "approved"); assert!(!approval.1.is_empty());
        db.close().await; fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn restart_during_approval_rejects_without_replaying_or_claiming_unknown_effects() {
        let root = std::env::temp_dir().join(format!("aibo-approval-recovery-{}", Ulid::new()));
        fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Recovery',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(now_iso()).bind(now_iso()).execute(&db).await.unwrap();
        let action = save_project_action(&db, "workspace".into(), None, "Pending".into(), "test".into(), "/bin/sh".into(), vec!["-c".into(), "touch effect".into()], None, None).await.unwrap();
        let task_db = db.clone(); let task_root = root.clone(); let id = action.id.clone();
        let owner = tokio::spawn(async move { run_project_action_with_confirmation(&task_db, &task_root, "workspace".into(), id, None, "pending".into(), "test".into(), |_| std::future::pending()).await });
        tokio::time::timeout(Duration::from_secs(3), async { loop {
            if list_project_action_runs(&db, "workspace".into(), None).await.unwrap().iter().any(|run| run.status == "awaiting_approval") { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        } }).await.unwrap();
        owner.abort(); let _ = owner.await;
        assert!(!root.join("effect").exists());
        db.close().await;
        let reopened = crate::open_database(&root.join("host.db")).await.unwrap();
        assert_eq!(recover(&reopened).await.unwrap(), 1); assert_eq!(recover(&reopened).await.unwrap(), 0);
        let replay = run_project_action(&reopened, &root, "workspace".into(), action.id, None, "pending".into()).await.unwrap();
        assert_eq!(replay.status, "rejected"); assert!(replay.output.contains("not started"));
        assert!(!root.join("effect").exists());
        reopened.close().await; fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cancellation_is_scoped_persistent_and_stops_descendants_without_erasing_effects() {
        let root = std::env::temp_dir().join(format!("aibo-task-cancel-{}", Ulid::new()));
        fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        for (id, path) in [("workspace", root.clone()), ("other", root.join("other"))] {
            fs::create_dir_all(&path).unwrap();
            sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES (?,?,'Cancel',1,?,?)")
                .bind(id).bind(path.to_string_lossy().as_ref()).bind(now_iso()).bind(now_iso()).execute(&db).await.unwrap();
        }
        let action = save_project_action(&db, "workspace".into(), None, "Cancel me".into(), "test".into(), "/bin/sh".into(),
            vec!["-c".into(), "printf BEFORE_CANCEL; touch before; (sleep 1; touch after) & wait".into()], None, None).await.unwrap();
        let task_db = db.clone(); let task_root = root.clone(); let action_id = action.id.clone();
        let owner = tokio::spawn(async move { run_project_action(&task_db, &task_root, "workspace".into(), action_id, None, "cancel-request".into()).await });
        tokio::time::timeout(Duration::from_secs(5), async { while !root.join("before").exists() { tokio::time::sleep(Duration::from_millis(10)).await; } }).await.unwrap();
        let run = list_project_action_runs(&db, "workspace".into(), None).await.unwrap().remove(0);
        assert!(!cancel_project_action(&db, "other".into(), run.id.clone()).await.unwrap());
        assert!(!cancel_project_action(&db, "workspace".into(), "missing".into()).await.unwrap());
        // Revoking trust must not prevent a user from stopping existing execution.
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='workspace'").execute(&db).await.unwrap();
        assert!(cancel_project_action(&db, "workspace".into(), run.id.clone()).await.unwrap());
        let requested: String = sqlx::query_scalar("SELECT cancel_requested_at FROM project_action_runs WHERE id=?").bind(&run.id).fetch_one(&db).await.unwrap();
        let _ = cancel_project_action(&db, "workspace".into(), run.id.clone()).await.unwrap();
        let settled = tokio::time::timeout(Duration::from_secs(3), owner).await.unwrap().unwrap().unwrap();
        assert_eq!(settled.status, "outcome_unknown");
        assert!(settled.output.contains("BEFORE_CANCEL"));
        assert!(settled.output.contains("earlier effects may remain"));
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT cancel_requested_at FROM project_action_runs WHERE id=?").bind(&run.id).fetch_one(&db).await.unwrap(), requested);
        assert!(!cancel_project_action(&db, "workspace".into(), run.id.clone()).await.unwrap());
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(root.join("before").exists()); assert!(!root.join("after").exists());
        sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='workspace'").execute(&db).await.unwrap();
        let replay = run_project_action(&db, &root, "workspace".into(), action.id, None, "cancel-request".into()).await.unwrap();
        assert_eq!(replay.id, run.id); assert_eq!(replay.status, "outcome_unknown");
        let _released = crate::workspace_writes::acquire(&db, "workspace", &root).await.unwrap();
        db.close().await; fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn tasks_and_git_share_workspace_exclusion_without_blocking_other_workspaces() {
        let root = std::env::temp_dir().join(format!("aibo-write-scope-{}", Ulid::new()));
        let first = root.join("first"); let second = root.join("second");
        fs::create_dir_all(&first).unwrap(); fs::create_dir_all(&second).unwrap();
        assert!(std::process::Command::new("git").args(["init", "-q"]).current_dir(&first).status().unwrap().success());
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        for (id, path) in [("first", &first), ("second", &second)] {
            sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES (?,?,'Writes',1,?,?)")
                .bind(id).bind(path.to_string_lossy().as_ref()).bind(now_iso()).bind(now_iso()).execute(&db).await.unwrap();
        }
        let slow = save_project_action(&db, "first".into(), None, "Slow".into(), "test".into(), "/bin/sh".into(),
            vec!["-c".into(), "touch started; while [ ! -f release ]; do sleep 0.01; done".into()], None, None).await.unwrap();
        let fast = save_project_action(&db, "second".into(), None, "Fast".into(), "test".into(), "/bin/sh".into(),
            vec!["-c".into(), "echo independent".into()], None, None).await.unwrap();
        // A Git-side reservation also excludes task admission, before any run is recorded.
        let reservation = crate::workspace_writes::acquire(&db, "first", &first).await.unwrap();
        assert!(matches!(run_project_action(&db, &root, "first".into(), slow.id.clone(), None, "blocked".into()).await, Err(CoreError::WorkspaceWriteBusy)));
        assert!(list_project_action_runs(&db, "first".into(), None).await.unwrap().is_empty());
        drop(reservation);
        let task_db = db.clone(); let task_root = root.clone(); let id = slow.id.clone();
        let owner = tokio::spawn(async move { run_project_action(&task_db, &task_root, "first".into(), id, None, "active".into()).await });
        tokio::time::timeout(Duration::from_secs(5), async { while !first.join("started").exists() { tokio::time::sleep(Duration::from_millis(10)).await; } }).await.unwrap();
        assert!(matches!(run_project_action(&db, &root, "first".into(), slow.id, None, "different-request".into()).await, Err(CoreError::WorkspaceWriteBusy)));
        assert!(matches!(crate::workspace_git::apply_workspace_git_action(&db, "first".into(), "stage_all".into()).await, Err(CoreError::WorkspaceWriteBusy)));
        assert_eq!(run_project_action(&db, &root, "second".into(), fast.id, None, "independent".into()).await.unwrap().status, "completed");
        assert!(std::process::Command::new("git").args(["diff", "--cached", "--name-only"]).current_dir(&first).output().unwrap().stdout.is_empty());
        fs::write(first.join("release"), "done").unwrap();
        assert_eq!(owner.await.unwrap().unwrap().status, "completed");
        assert!(crate::workspace_git::apply_workspace_git_action(&db, "first".into(), "stage_all".into()).await.unwrap().applied);
        assert!(!std::process::Command::new("git").args(["diff", "--cached", "--name-only"]).current_dir(&first).output().unwrap().stdout.is_empty());
        db.close().await; fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn duplicate_requests_execute_once_and_survive_definition_deletion_and_restart() {
        let root = std::env::temp_dir().join(format!("aibo-task-dedup-{}", Ulid::new()));
        fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        let now = now_iso();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Dedup',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(&now).bind(&now).execute(&db).await.unwrap();
        let action = save_project_action(&db, "workspace".into(), None, "Write".into(), "test".into(), "/bin/sh".into(),
            vec!["-c".into(), "echo effect >> effects; sleep 0.2".into()], None, None).await.unwrap();
        let (first, second) = tokio::join!(
            run_project_action(&db, &root, "workspace".into(), action.id.clone(), None, "same-request".into()),
            run_project_action(&db, &root, "workspace".into(), action.id.clone(), None, "same-request".into())
        );
        let first = first.unwrap(); let second = second.unwrap();
        assert_eq!(first.id, second.id);
        assert!(first.status == "completed" || second.status == "completed");
        assert_eq!(fs::read_to_string(root.join("effects")).unwrap(), "effect\n");
        assert!(run_project_action(&db, &root, "workspace".into(), "different-action".into(), None, "same-request".into()).await.is_err());
        // Emulate a pre-approval v2 request: its original identity has no caller.
        sqlx::query("UPDATE project_action_runs SET schema_version='aibo.project-action-run/v2',request_json=json_remove(request_json,'$.caller'),approval_outcome=NULL,approval_decided_at=NULL WHERE id=?")
            .bind(&first.id).execute(&db).await.unwrap();
        delete_project_action(&db, "workspace".into(), action.id.clone()).await.unwrap();
        db.close().await;
        let reopened = crate::open_database(&root.join("host.db")).await.unwrap();
        let replay = run_project_action(&reopened, &root, "workspace".into(), action.id, None, "same-request".into()).await.unwrap();
        assert_eq!(replay.id, first.id);
        assert_eq!(replay.status, "completed");
        assert_eq!(fs::read_to_string(root.join("effects")).unwrap(), "effect\n");
        reopened.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn lifecycle_migration_keeps_v1_records_and_marks_backfilled_definition_origin() {
        let db = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE sessions(id TEXT PRIMARY KEY); CREATE TABLE project_actions(id TEXT PRIMARY KEY,name TEXT,kind TEXT,program TEXT,args_json TEXT,cwd TEXT); INSERT INTO workspaces VALUES ('w'); INSERT INTO project_actions VALUES ('a','Old name','test','echo','[]','.');").execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0012_project_action_runs.sql")).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO project_action_runs VALUES ('r','aibo.project-action-run/v1','a','w',NULL,'completed',0,'OLD_OUTPUT',NULL,'before','after')").execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0029_project_action_lifecycle.sql")).execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0030_project_action_requests.sql")).execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0031_project_action_cancellation.sql")).execute(&db).await.unwrap();
        sqlx::query("UPDATE project_action_runs SET request_id='legacy-key',request_json='{}',cancel_requested_at='legacy-cancel' WHERE id='r'").execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0032_project_action_approval.sql")).execute(&db).await.unwrap();
        sqlx::query("DELETE FROM project_actions WHERE id='a'").execute(&db).await.unwrap();
        let row = sqlx::query("SELECT * FROM project_action_runs WHERE id='r'").fetch_one(&db).await.unwrap();
        assert_eq!(row.get::<String,_>("schema_version"), "aibo.project-action-run/v1");
        assert_eq!(row.get::<String,_>("request_id"), "legacy-key");
        assert_eq!(row.get::<String,_>("cancel_requested_at"), "legacy-cancel");
        assert!(row.get::<Option<String>,_>("approval_outcome").is_none());
        assert_eq!(row.get::<String,_>("output"), "OLD_OUTPUT");
        assert_eq!(row.get::<String,_>("completed_at"), "after");
        let snapshot: serde_json::Value = serde_json::from_str(row.get::<&str,_>("snapshot_json")).unwrap();
        assert_eq!(snapshot["origin"], "migration-current-definition");
        db.close().await;
    }

}
