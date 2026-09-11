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
            if row.try_get::<String, _>("request_json")? != request_json {
                return Err(CoreError::InvalidWorkspacePath("request ID already belongs to different project task input".into()));
            }
            Ok(Some(project_action_run_from_row(&row)?))
        }
        None => Ok(None),
    }
}

pub(crate) async fn run_project_action(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_id: String,
    action_id: String,
    session_id: Option<String>,
    request_id: String,
) -> Result<ProjectActionRun, CoreError> {
    if request_id.is_empty() || request_id.len() > 128 || !request_id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
        return Err(CoreError::InvalidWorkspacePath("invalid project task request ID".into()));
    }
    let admission = ADMISSION.lock().await;
    let request_json = serde_json::json!({"actionId": &action_id, "sessionId": &session_id}).to_string();
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    if let Some(run) = replay_request(db, &workspace_id, &request_id, &request_json).await? {
        return Ok(run);
    }
    let action = project_action_by_id(db, &workspace_id, &action_id).await?;
    if !action.enabled {
        return Err(CoreError::InvalidWorkspacePath(
            "project action is disabled".to_owned(),
        ));
    }
    if let Some(session_id) = session_id.as_deref() {
        let session = session_by_id(db, session_id).await?;
        if session.workspace_id != workspace_id {
            return Err(CoreError::InvalidWorkspacePath(
                "session does not belong to workspace".to_owned(),
            ));
        }
    }
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let cwd = crate::workspace_guard::canonicalize_target(&root, Path::new(&action.cwd))
        .map_err(CoreError::InvalidWorkspacePath)?;
    let _write = crate::workspace_writes::acquire(db, &workspace_id, &root).await?;
    let started_at = now_iso();
    let run_id = Ulid::new().to_string();
    let snapshot = serde_json::to_string(&serde_json::json!({"schema":"aibo.project-action-snapshot/v1","origin":"admission","definition":&action})).map_err(|error| CoreError::Initialization(error.to_string()))?;
    // Record intent before the first side effect. A crash leaves a recoverable run.
    let admitted = sqlx::query("INSERT INTO project_action_runs (id,schema_version,action_id,workspace_id,session_id,status,output,started_at,completed_at,snapshot_json,request_id,request_json) VALUES (?,'aibo.project-action-run/v2',?,?,?,'running','',?,NULL,?,?,?) ON CONFLICT(workspace_id,request_id) DO NOTHING")
        .bind(&run_id).bind(&action_id).bind(&workspace_id).bind(&session_id).bind(&started_at).bind(snapshot).bind(&request_id).bind(&request_json).execute(db).await?.rows_affected();
    if admitted == 0 {
        return replay_request(db, &workspace_id, &request_id, &request_json).await?
            .ok_or_else(|| CoreError::Initialization("project task request disappeared during admission".into()));
    }
    drop(admission);
    let mut command = TokioCommand::new(&action.program);
    command.args(&action.args).current_dir(&cwd);
    let execution = match crate::controlled_process::execute(command, Duration::from_secs(300), 1024 * 1024 + 1).await {
        Ok(execution) => execution,
        Err(error) => {
            let message = crate::artifact::sanitize_content("project-action.command", &format!("Execution result unknown: {error}"));
            let completed_at = now_iso();
            let changed = sqlx::query("UPDATE project_action_runs SET status='outcome_unknown',output=?,completed_at=? WHERE id=? AND status='running'")
                .bind(&message).bind(&completed_at).bind(&run_id).execute(db).await?.rows_affected();
            if changed != 1 { return Err(CoreError::Initialization("project task record changed concurrently".into())); }
            return Ok(ProjectActionRun { schema: "aibo.project-action-run/v2".into(), id: run_id,
                action_id, action_name: Some(action.name), workspace_id, session_id,
                status: "outcome_unknown".into(), exit_code: None, output: message, artifact_id: None,
                started_at, completed_at: Some(completed_at) });
        }
    };
    let status = if execution.timed_out { "outcome_unknown" } else if execution.success { "completed" } else { "failed" };
    let exit_code = execution.exit_code.map(i64::from);
    let mut output = String::from_utf8_lossy(&execution.stdout).to_string();
    let stderr = String::from_utf8_lossy(&execution.stderr).to_string();
    if !stderr.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&stderr);
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
        schema: "aibo.project-action-run/v2".to_owned(),
        id: run_id,
        action_id,
        action_name: Some(action.name),
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
    Ok(sqlx::query("UPDATE project_action_runs SET status='outcome_unknown',completed_at=?,output=output || '\nHost restarted before execution settled; inspect effects before retrying.' WHERE status='running'")
        .bind(now_iso()).execute(db).await?.rows_affected())
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
        assert_eq!(failed.schema, "aibo.project-action-run/v2");
        assert!(list_project_action_runs(&reopened, "workspace".into(), None).await.unwrap().iter().any(|run| run.id == failed.id));
        reopened.close().await;
        fs::remove_dir_all(root).unwrap();
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
        sqlx::query("DELETE FROM project_actions WHERE id='a'").execute(&db).await.unwrap();
        let row = sqlx::query("SELECT * FROM project_action_runs WHERE id='r'").fetch_one(&db).await.unwrap();
        assert_eq!(row.get::<String,_>("schema_version"), "aibo.project-action-run/v1");
        assert_eq!(row.get::<String,_>("output"), "OLD_OUTPUT");
        assert_eq!(row.get::<String,_>("completed_at"), "after");
        let snapshot: serde_json::Value = serde_json::from_str(row.get::<&str,_>("snapshot_json")).unwrap();
        assert_eq!(snapshot["origin"], "migration-current-definition");
        db.close().await;
    }

}
