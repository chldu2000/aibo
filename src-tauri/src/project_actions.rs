//! Project task definitions and execution, independent of Tauri command state.
use crate::{CoreError, ProjectAction, ProjectActionRun, workspace_by_id, session_by_id,
    now_iso, ui_i18n::{self, HostMessage}};
use sqlx::{Row, SqlitePool};
use std::{fs, path::Path, time::Duration};
use tokio::process::Command as TokioCommand;
use ulid::Ulid;

const CANCELLED_OUTPUT: &str = "\nExecution stopped after cancellation or loss of its record; earlier effects may remain. Inspect changes before another run.";
const TRUNCATED_OUTPUT: &str = "\n… 工程动作输出已截断";
const RESTARTED_OUTPUT: &str = "\nHost restarted before execution settled; inspect effects before retrying.";

fn output_segment(text: &str, start: usize, end: usize, message: serde_json::Value) -> serde_json::Value {
    serde_json::json!({"start":start,"end":end,"raw":&text[start..end],"message":message})
}
fn output_display(segments: Vec<serde_json::Value>) -> Option<serde_json::Value> {
    if segments.is_empty() { None } else { Some(serde_json::json!({"schema":"aibo.project-output-display/v1","segments":segments})) }
}
fn complete_output(display: HostMessage) -> (String, Option<serde_json::Value>) {
    let metadata = display.localized.map(|message| output_display(vec![output_segment(&display.diagnostic,0,display.diagnostic.len(),message)]).unwrap());
    (display.diagnostic, metadata)
}
/// Preserve existing sanitization and byte limits; mark only producer-owned fragments.
fn command_output(raw: &str, cancelled: bool) -> (String, Option<serde_json::Value>) {
    let mut raw = raw.to_owned();
    if cancelled { raw.push_str(CANCELLED_OUTPUT); }
    let sanitized = crate::artifact::sanitize_content("project-action.command", &raw);
    let output = crate::artifact::truncate_utf8(&sanitized,1024 * 1024,TRUNCATED_OUTPUT);
    let truncated = sanitized.len() > 1024 * 1024;
    let literal_end = if truncated { output.len() - TRUNCATED_OUTPUT.len() } else { output.len() };
    let mut segments = Vec::new();
    if cancelled {
        let start = sanitized.len() - CANCELLED_OUTPUT.len();
        // A truncated fragment still belongs to this producer, never to stdout.
        if start < literal_end { segments.push(output_segment(&output,start,literal_end,
            ui_i18n::display_descriptor("native.project.outputCancelled",serde_json::json!({})))); }
    }
    if truncated { segments.push(output_segment(&output,literal_end,output.len(),
        ui_i18n::display_descriptor("native.project.outputTruncated",serde_json::json!({})))); }
    (output, output_display(segments))
}

// Serialize only admission, so duplicates observe the first persisted intent.
static ADMISSION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn validation(key: &str, diagnostic: &str) -> CoreError {
    ui_i18n::invalid_path_message(HostMessage::with_diagnostic(key, serde_json::json!({}), diagnostic))
}
fn initialization(key: &str, diagnostic: &str) -> CoreError {
    ui_i18n::initialization_message(HostMessage::with_diagnostic(key, serde_json::json!({}), diagnostic))
}


fn project_action_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<ProjectAction, CoreError> {
    let args_json: String = row.try_get("args_json")?;
    let args = serde_json::from_str(&args_json).map_err(|error| {
        ui_i18n::invalid_path_message(HostMessage::with_diagnostic("native.project.storedArgs", serde_json::json!({"error":error.to_string()}), format!("invalid project action args: {error}")))
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
    .ok_or_else(|| CoreError::Localized {
        error:Box::new(CoreError::SessionNotFound(format!("project action {action_id}"))),
        localized:ui_i18n::display_descriptor("native.project.missing",serde_json::json!({"id":action_id})),
    })?;
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
        return Err(validation("native.project.name", "project action name must be 1-80 characters"));
    }
    if !matches!(kind, "test" | "lint" | "build" | "custom") {
        return Err(validation("native.project.kind", "unsupported project action kind"));
    }
    if program.is_empty() || program.len() > 255 || program.as_bytes().contains(&0) {
        return Err(validation("native.project.program", "project action program is invalid"));
    }
    if args.len() > 32
        || args
            .iter()
            .any(|arg| arg.len() > 4096 || arg.as_bytes().contains(&0))
    {
        return Err(validation("native.project.argsLimit", "project action args exceed limits"));
    }
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let action_cwd = cwd.as_deref().unwrap_or(".");
    let canonical_cwd = crate::workspace_guard::canonicalize_target_message(&root, Path::new(action_cwd))
        .map_err(crate::ui_i18n::invalid_path_message)?;
    if !canonical_cwd.is_dir() {
        return Err(validation("native.project.cwd", "project action cwd is not a directory"));
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
        ui_i18n::invalid_path_message(HostMessage::with_diagnostic("native.project.serializeArgs", serde_json::json!({"error":error.to_string()}), format!("serialize project action args: {error}")))
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
            return Err(validation("native.project.workspace", "project action belongs to another workspace"));
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
                return Err(validation("native.project.requestConflict", "request ID already belongs to different project task input"));
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
    if !action.enabled { return Err(validation("native.project.disabled", "project action is disabled")); }
    let session_context = if let Some(id) = session_id {
        let session = session_by_id(db, id).await?;
        if session.workspace_id != workspace_id { return Err(validation("native.project.sessionWorkspace", "session does not belong to workspace")); }
        let context: String = sqlx::query_scalar("SELECT json_object('id',id,'workspaceId',workspace_id,'state',state,'archived',archived,'updatedAt',updated_at) FROM sessions WHERE id=?")
            .bind(id).fetch_one(db).await?;
        Some(context)
    } else { None };
    let root = fs::canonicalize(&workspace.path).map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let cwd = crate::workspace_guard::canonicalize_target_message(&root, Path::new(&action.cwd)).map_err(crate::ui_i18n::invalid_path_message)?;
    if !cwd.is_dir() { return Err(validation("native.project.taskCwd", "task working directory is not a directory")); }
    let context = serde_json::json!({"workspaceId":workspace_id,"workspacePath":workspace.path,"workspaceTrust":workspace.trust,"workspaceUpdatedAt":workspace.updated_at,"root":root,"cwd":cwd,"definition":action,"session":session_context});
    Ok(PreparedTask { action, root, cwd, context })
}

#[cfg(test)]
pub(crate) async fn run_project_action(db: &SqlitePool, data_dir: &Path, workspace_id: String, action_id: String, session_id: Option<String>, request_id: String) -> Result<ProjectActionRun, CoreError> {
    run_project_action_with_confirmation(db, data_dir, workspace_id, action_id, session_id, request_id, "test".into(), |_| async { Ok(true) }).await
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
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
    run_project_action_with_localized_confirmation(db, data_dir, workspace_id, action_id, session_id, request_id, caller, crate::ui_i18n::Locale::ZhCn, confirm).await
}

pub(crate) async fn run_project_action_with_localized_confirmation<F, Fut>(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_id: String,
    action_id: String,
    session_id: Option<String>,
    request_id: String,
    caller: String,
    locale: crate::ui_i18n::Locale,
    confirm: F,
) -> Result<ProjectActionRun, CoreError>
where F: FnOnce(String) -> Fut, Fut: std::future::Future<Output = Result<bool, String>> {
    if request_id.is_empty() || request_id.len() > 128 || !request_id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
        return Err(validation("native.project.requestId", "invalid project task request ID"));
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
    let message = crate::ui_i18n::message(locale, "native.projectSummary", &serde_json::json!({"name":prepared.action.name,"workspace":prepared.root.to_string_lossy(),"cwd":prepared.cwd.to_string_lossy(),"program":prepared.action.program,"args":serde_json::to_string(&prepared.action.args).unwrap(),"session":session_id.clone().map(serde_json::Value::String).unwrap_or_else(||crate::ui_i18n::descriptor("native.noSession",serde_json::json!({}))),"caller":caller}));
    if message.len() > 16 * 1024 { return Err(validation("native.project.summaryLimit", "task approval summary exceeds 16 KiB")); }
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
            .ok_or_else(|| initialization("native.project.admissionMissing", "project task request disappeared during admission"));
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
        let decision_key = match decision {
            "denied" => Some("native.writeRun.denied"), "stale" => Some("native.writeRun.stale"),
            "cancelled" => Some("native.writeRun.cancelled"), "unavailable" => Some("native.writeRun.unavailable"),
            "expired" => Some("native.writeRun.expired"), _ => None,
        };
        let reason = decision_key.map(|key| ui_i18n::display_descriptor(key,serde_json::json!({})))
            .unwrap_or_else(||serde_json::json!(decision));
        let (output, localized_output) = complete_output(HostMessage::with_diagnostic("native.project.outputRejected",
            serde_json::json!({"decision":reason}),format!("Task was not started: approval {decision}. Submit a new request after checking the current context.")));
        sqlx::query("UPDATE project_action_runs SET status='rejected',approval_outcome=?,approval_decided_at=?,completed_at=?,output=?,localized_output_json=? WHERE id=? AND status='awaiting_approval'")
            .bind(decision).bind(&decided_at).bind(&decided_at).bind(output).bind(localized_output.map(|value|value.to_string()))
            .bind(&run_id).execute(db).await?;
        return replay_request(db, &workspace_id, &request_id, &request_json).await?
            .ok_or_else(|| initialization("native.project.approvalMissing", "task approval record disappeared"));
    }
    let mut command = TokioCommand::new(&action.program);
    command.args(&action.args).current_dir(&prepared.cwd);
    let execution = match crate::controlled_process::execute_cancellable(command, Duration::from_secs(300), 1024 * 1024 + 1, cancellation_requested(db, &run_id)).await {
        Ok(execution) => execution,
        Err(error) => {
            let message = crate::artifact::sanitize_content("project-action.command", &format!("Execution result unknown: {error}"));
            let (_, localized_output) = complete_output(HostMessage::with_diagnostic("native.project.outputUnknown",
                serde_json::json!({"error":message.strip_prefix("Execution result unknown: ").unwrap_or(&message)}),&message));
            let completed_at = now_iso();
            let changed = sqlx::query("UPDATE project_action_runs SET status='outcome_unknown',output=?,localized_output_json=?,completed_at=? WHERE id=? AND status='running'")
                .bind(&message).bind(localized_output.as_ref().map(|value|value.to_string())).bind(&completed_at).bind(&run_id).execute(db).await?.rows_affected();
            if changed != 1 { return Err(initialization("native.project.recordChanged", "project task record changed concurrently")); }
            return Ok(ProjectActionRun { schema: "aibo.project-action-run/v3".into(), id: run_id,
                action_id, action_name: Some(action.name.clone()), workspace_id, session_id,
                status: "outcome_unknown".into(), exit_code: None, output: message, localized_output, artifact_id: None,
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
    let (output, localized_output) = command_output(&output, execution.cancelled);
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
    let changed = sqlx::query("UPDATE project_action_runs SET status=?,exit_code=?,output=?,localized_output_json=?,artifact_id=?,completed_at=? WHERE id=? AND status='running'")
        .bind(status).bind(exit_code).bind(&output).bind(localized_output.as_ref().map(|value|value.to_string())).bind(&artifact_id).bind(&completed_at).bind(&run_id).execute(db).await?.rows_affected();
    if changed != 1 { return Err(initialization("native.project.recordChanged", "project task record changed concurrently")); }
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
        localized_output,
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
        localized_output: row.try_get::<Option<String>,_>("localized_output_json")?.and_then(|raw|serde_json::from_str(&raw).ok()),
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
    list_project_action_runs_page(db, workspace_id, limit, None).await
}

pub(crate) async fn list_project_action_runs_page(db: &SqlitePool, workspace_id: String, limit: Option<i64>, before: Option<&crate::execution_history::Cursor>) -> Result<Vec<ProjectActionRun>, CoreError> {
    if let Some(cursor) = before { cursor.validate(&workspace_id)?; }
    workspace_by_id(db, &workspace_id).await?;
    let limit = limit.unwrap_or(10).clamp(1, 50);
    let rows = sqlx::query(
        "SELECT id, schema_version, action_id, workspace_id, session_id, status,
                exit_code, output, localized_output_json, artifact_id, started_at, completed_at, json_extract(snapshot_json,'$.definition.name') AS action_name
         FROM project_action_runs WHERE workspace_id = ? AND (? IS NULL OR (started_at, 'task', id) < (?, ?, ?))
         ORDER BY started_at DESC, id DESC LIMIT ?",
    )
    .bind(&workspace_id)
    .bind(before.map(|cursor| cursor.started_at.as_str()))
    .bind(before.map(|cursor| cursor.started_at.as_str()))
    .bind(before.map(|cursor| cursor.kind.as_str()))
    .bind(before.map(|cursor| cursor.id.as_str()))
    .bind(limit)
    .fetch_all(db)
    .await?;
    rows.iter().map(project_action_run_from_row).collect()
}


/// Startup-only recovery: incomplete execution is never automatically replayed.
pub(crate) async fn recover(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    let (output, display) = complete_output(HostMessage::with_diagnostic("native.project.outputRestartApproval",
        serde_json::json!({}),"Host restarted during approval; task was not started."));
    let mut changed = sqlx::query("UPDATE project_action_runs SET status='rejected',approval_outcome='recovered',approval_decided_at=?,completed_at=?,output=?,localized_output_json=? WHERE status='awaiting_approval'")
        .bind(now_iso()).bind(now_iso()).bind(output).bind(display.map(|value|value.to_string())).execute(db).await?.rows_affected();
    let mut transaction = db.begin().await?;
    let running = sqlx::query("SELECT id,output FROM project_action_runs WHERE status='running'").fetch_all(&mut *transaction).await?;
    for row in running {
        let previous: String = row.try_get("output")?;
        let output = format!("{previous}{RESTARTED_OUTPUT}");
        // Running tasks have not settled an output display; old text stays literal.
        let display = output_display(vec![output_segment(&output,previous.len(),output.len(),
            ui_i18n::display_descriptor("native.project.outputRestartExecution",serde_json::json!({})))]);
        changed += sqlx::query("UPDATE project_action_runs SET status='outcome_unknown',completed_at=?,output=output || ?,localized_output_json=? WHERE id=? AND status='running'")
            .bind(now_iso()).bind(RESTARTED_OUTPUT).bind(display.map(|value|value.to_string())).bind(row.get::<String,_>("id")).execute(&mut *transaction).await?.rows_affected();
    }
    transaction.commit().await?;
    Ok(changed)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn rendered_output(run: &ProjectActionRun, locale: ui_i18n::Locale) -> String {
        let Some(display) = &run.localized_output else { return run.output.clone(); };
        let mut output = String::new(); let mut previous = 0;
        for segment in display["segments"].as_array().unwrap() {
            let start = segment["start"].as_u64().unwrap() as usize; let end = segment["end"].as_u64().unwrap() as usize;
            assert_eq!(&run.output[start..end],segment["raw"].as_str().unwrap());
            output.push_str(&run.output[previous..start]);output.push_str(&ui_i18n::render(locale,&segment["message"]));previous=end;
        }
        output.push_str(&run.output[previous..]);output
    }

    #[tokio::test]
    async fn command_output_display_marks_only_owned_fragments_and_survives_reopen() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("host.db");
        let db = crate::open_database(&path).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Display',1,?,?)")
            .bind(root.path().to_string_lossy().as_ref()).bind(now_iso()).bind(now_iso()).execute(&db).await.unwrap();
        // A command printing the host's exact cancellation sentence is still raw stdout.
        let literal = format!("命令原文 /{{output}}{CANCELLED_OUTPUT}");
        let action = save_project_action(&db,"w".into(),None,"任务原文 /{name}".into(),"test".into(),"/bin/sh".into(),vec!["-c".into(),"printf '%s' \"$1\"".into(),"fixture".into(),literal.clone()],None,None).await.unwrap();
        let run = run_project_action(&db,root.path(),"w".into(),action.id.clone(),None,"literal".into()).await.unwrap();
        assert_eq!(run.output,literal);assert!(run.localized_output.is_none());
        assert!(serde_json::to_value(&run).unwrap().get("localizedOutput").is_none());
        let denied = run_project_action_with_confirmation(&db,root.path(),"w".into(),action.id,None,"denied".into(),"main".into(), |_|async {Ok(false)}).await.unwrap();
        assert_eq!(denied.output,"Task was not started: approval denied. Submit a new request after checking the current context.");
        assert!(rendered_output(&denied,ui_i18n::Locale::ZhCn).starts_with("任务未启动：审批被拒绝"));
        let oversized = save_project_action(&db,"w".into(),None,"Large".into(),"test".into(),"/usr/bin/python3".into(),vec!["-c".into(),"import sys; sys.stdout.write('原文 /{output}\\n' + 'x' * 1050000)".into()],None,None).await.unwrap();
        let large = run_project_action(&db,root.path(),"w".into(),oversized.id,None,"large".into()).await.unwrap();
        assert_eq!(large.status,"completed");assert!(large.output.len()<=1024*1024);assert!(large.output.ends_with(TRUNCATED_OUTPUT));
        assert!(rendered_output(&large,ui_i18n::Locale::En).ends_with("\n… Project action output truncated"));
        assert!(large.output.starts_with("原文 /{output}\n"));
        let before = serde_json::to_value(list_project_action_runs(&db,"w".into(),None).await.unwrap()).unwrap();
        db.close().await; let db=crate::open_database(&path).await.unwrap();
        assert_eq!(serde_json::to_value(list_project_action_runs(&db,"w".into(),None).await.unwrap()).unwrap(),before);
        let conflict=run_project_action(&db,root.path(),"w".into(),denied.action_id.clone(),None,"denied".into()).await.unwrap_err();
        assert_eq!(serde_json::to_value(conflict).unwrap()["localized"]["key"],"native.project.requestConflict");
        let replay=run_project_action_with_confirmation(&db,root.path(),"w".into(),denied.action_id.clone(),None,"denied".into(),"main".into(), |_|async {panic!("replay requested approval")}).await.unwrap();
        assert_eq!(serde_json::to_value(replay).unwrap(),serde_json::to_value(denied).unwrap());
        db.close().await;
        // Native truncation may cut a producer's own notice; ranges never include stdout.
        let raw=format!("{}原文", "x".repeat(1024*1024-80));
        let (output,display)=command_output(&raw,true);let display=display.unwrap();
        assert!(output.len()<=1024*1024);assert_eq!(display["segments"].as_array().unwrap().len(),2);
        let first=&display["segments"][0];assert_eq!(first["start"],raw.len());
        assert_eq!(first["message"]["key"],"native.project.outputCancelled");
        assert!(first["raw"].as_str().unwrap().starts_with("\nExecution stopped"));
    }

    #[tokio::test]
    async fn task_validation_display_preserves_definitions_and_never_approves_or_executes_rejections() {
        let root = std::env::temp_dir().join(format!("aibo-task-display-{}", Ulid::new()));
        fs::create_dir_all(&root).unwrap(); fs::write(root.join("file"), "原文 /{path}").unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        for id in ["workspace", "other"] {
            sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES(?,?,?,1,?,?)")
                .bind(id).bind(root.join(id).to_string_lossy().as_ref()).bind(id).bind(now_iso()).bind(now_iso()).execute(&db).await.unwrap();
        }
        sqlx::query("UPDATE workspaces SET path=? WHERE id='workspace'").bind(root.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('foreign','other','pi','原文 /{session}','idle',?,?)")
            .bind(now_iso()).bind(now_iso()).execute(&db).await.unwrap();
        let action = save_project_action(&db,"workspace".into(),None,"任务原文 /{name}".into(),"test".into(),"/bin/sh".into(),vec!["-c".into(),"printf once >> effects".into()],None,None).await.unwrap();
        let baseline = serde_json::to_value(&action).unwrap();
        for (name, kind, program, args, cwd, key, diagnostic) in [
            ("".into(), "test", "/bin/sh", vec![], ".", "name", "project action name must be 1-80 characters"),
            ("x".repeat(81), "test", "/bin/sh", vec![], ".", "name", "project action name must be 1-80 characters"),
            ("name".into(), "bad", "/bin/sh", vec![], ".", "kind", "unsupported project action kind"),
            ("name".into(), "test", "", vec![], ".", "program", "project action program is invalid"),
            ("name".into(), "test", "/bin/sh", vec!["arg".into();33], ".", "argsLimit", "project action args exceed limits"),
            ("name".into(), "test", "/bin/sh", vec!["x".repeat(4097)], ".", "argsLimit", "project action args exceed limits"),
            ("name".into(), "test", "/bin/sh", vec![], "file", "cwd", "project action cwd is not a directory"),
        ] {
            let error = save_project_action(&db,"workspace".into(),Some(action.id.clone()),name,kind.into(),program.into(),args,Some(cwd.into()),None).await.unwrap_err();
            let payload = serde_json::to_value(error).unwrap();
            assert_eq!(payload["code"], "invalid_workspace_path");
            assert_eq!(payload["message"], format!("invalid workspace path: {diagnostic}"));
            assert_eq!(payload["localized"]["key"], format!("native.project.{key}"));
            assert_ne!(ui_i18n::render(ui_i18n::Locale::ZhCn, &payload["localized"]), diagnostic);
            assert_eq!(serde_json::to_value(project_action_by_id(&db,"workspace",&action.id).await.unwrap()).unwrap(), baseline);
        }
        for (index,key,diagnostic) in [
            (0,"disabled","project action is disabled"),
            (1,"taskCwd","task working directory is not a directory"),
            (2,"sessionWorkspace","session does not belong to workspace"),
            (3,"requestId","invalid project task request ID"),
            (4,"summaryLimit","task approval summary exceeds 16 KiB"),
        ] {
            if index == 0 { sqlx::query("UPDATE project_actions SET enabled=0 WHERE id=?").bind(&action.id).execute(&db).await.unwrap(); }
            if index == 1 { sqlx::query("UPDATE project_actions SET cwd='file' WHERE id=?").bind(&action.id).execute(&db).await.unwrap(); }
            if index == 4 { sqlx::query("UPDATE project_actions SET args_json=? WHERE id=?").bind(serde_json::json!(vec!["x".repeat(4000);5]).to_string()).bind(&action.id).execute(&db).await.unwrap(); }
            let error = run_project_action_with_confirmation(&db,&root,"workspace".into(),action.id.clone(),if index==2 {Some("foreign".into())} else {None},if index==3 {"invalid id".into()} else {format!("request-{index}")},"main".into(), |_| async {panic!("rejected task requested approval")}).await.unwrap_err();
            let payload = serde_json::to_value(error).unwrap();
            assert_eq!(payload["code"], "invalid_workspace_path");
            assert_eq!(payload["message"], format!("invalid workspace path: {diagnostic}"));
            assert_eq!(payload["localized"]["key"], format!("native.project.{key}"));
            assert!(list_project_action_runs(&db,"workspace".into(),None).await.unwrap().is_empty());
            assert!(!root.join("effects").exists());
            sqlx::query("UPDATE project_actions SET enabled=1,cwd='.',args_json=? WHERE id=?").bind(serde_json::to_string(&action.args).unwrap()).bind(&action.id).execute(&db).await.unwrap();
        }
        fs::create_dir_all(root.join("other")).unwrap();
        let error = save_project_action(&db,"other".into(),Some(action.id.clone()),"name".into(),"test".into(),"/bin/sh".into(),vec![],None,None).await.unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap()["localized"]["key"], "native.project.workspace");
        let error = project_action_by_id(&db,"workspace","missing /{id}").await.unwrap_err();
        let payload = serde_json::to_value(error).unwrap();
        assert_eq!(payload["code"], "session_not_found");
        assert_eq!(payload["message"], "session not found: project action missing /{id}");
        assert_eq!(ui_i18n::render(ui_i18n::Locale::En,&payload["localized"]), "Project action not found: missing /{id}");
        sqlx::query("UPDATE project_actions SET args_json=? WHERE id=?").bind(serde_json::json!("参数原文 /{error}").to_string()).bind(&action.id).execute(&db).await.unwrap();
        let error = list_project_actions(&db,"workspace".into()).await.unwrap_err();
        let payload = serde_json::to_value(error).unwrap();
        assert_eq!(payload["code"], "invalid_workspace_path");
        assert_eq!(payload["localized"]["key"], "native.project.storedArgs");
        let raw = payload["localized"]["params"]["error"].as_str().unwrap();
        assert!(raw.contains("参数原文 /{error}"));
        assert_eq!(payload["message"], format!("invalid workspace path: invalid project action args: {raw}"));
        sqlx::query("UPDATE project_actions SET args_json=? WHERE id=?").bind(serde_json::to_string(&action.args).unwrap()).bind(&action.id).execute(&db).await.unwrap();
        assert_eq!(serde_json::to_value(project_action_by_id(&db,"workspace",&action.id).await.unwrap()).unwrap(),baseline);
        let run = run_project_action(&db,&root,"workspace".into(),action.id,None,"recovered".into()).await.unwrap();
        assert_eq!(run.status,"completed");assert_eq!(fs::read_to_string(root.join("effects")).unwrap(),"once");
        assert_eq!(list_project_action_runs(&db,"workspace".into(),None).await.unwrap().len(),1);
        db.close().await; fs::remove_dir_all(root).unwrap();
    }

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
        assert!(run.localized_output.is_none());
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
        assert!(replay.output.ends_with(RESTARTED_OUTPUT));
        assert!(rendered_output(&replay,ui_i18n::Locale::ZhCn).ends_with("请检查实际影响后再重试。"));
        let missing = save_project_action(&reopened, "workspace".into(), None, "Missing program".into(), "test".into(), root.join("missing-program").to_string_lossy().into_owned(), vec![], None, None).await.unwrap();
        let failed = run_project_action(&reopened, &root, "workspace".into(), missing.id, None, Ulid::new().to_string()).await.unwrap();
        assert_eq!(failed.status, "outcome_unknown");
        assert_eq!(failed.schema, "aibo.project-action-run/v3");
        assert!(failed.output.starts_with("Execution result unknown: "));
        assert!(rendered_output(&failed,ui_i18n::Locale::ZhCn).starts_with("执行结果未知："));
        let segment=&failed.localized_output.as_ref().unwrap()["segments"][0];
        let raw=segment["message"]["params"]["error"].as_str().unwrap();
        assert_eq!(failed.output,format!("Execution result unknown: {raw}"));
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
        let conflict = run_project_action_with_confirmation(&db, &root, "workspace".into(), action.id.clone(), None, "denied".into(), "other-window".into(), |_| async { panic!("conflicting replay requested approval") }).await.unwrap_err();
        let conflict = serde_json::to_value(conflict).unwrap();
        assert_eq!(conflict["code"], "invalid_workspace_path");
        assert_eq!(conflict["message"], "invalid workspace path: request ID already belongs to different project task input");
        assert_eq!(conflict["localized"]["key"], "native.project.requestConflict");
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
        assert_eq!(replay.output,"Host restarted during approval; task was not started.");
        assert_eq!(rendered_output(&replay,ui_i18n::Locale::ZhCn),"宿主在审批期间重启，任务未启动。");
        assert_eq!(serde_json::to_value(&replay).unwrap(),serde_json::to_value(list_project_action_runs(&reopened,"workspace".into(),None).await.unwrap().remove(0)).unwrap());
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
        assert_eq!(settled.output,format!("BEFORE_CANCEL{CANCELLED_OUTPUT}"));
        assert!(rendered_output(&settled,ui_i18n::Locale::ZhCn).starts_with("BEFORE_CANCEL\n执行因取消"));
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT cancel_requested_at FROM project_action_runs WHERE id=?").bind(&run.id).fetch_one(&db).await.unwrap(), requested);
        assert!(!cancel_project_action(&db, "workspace".into(), run.id.clone()).await.unwrap());
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(root.join("before").exists()); assert!(!root.join("after").exists());
        sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='workspace'").execute(&db).await.unwrap();
        let replay = run_project_action(&db, &root, "workspace".into(), action.id, None, "cancel-request".into()).await.unwrap();
        assert_eq!(replay.id, run.id); assert_eq!(replay.status, "outcome_unknown");
        assert_eq!(serde_json::to_value(&replay).unwrap(),serde_json::to_value(&settled).unwrap());
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
