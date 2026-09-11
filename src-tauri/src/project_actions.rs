//! Project task definitions and execution, independent of Tauri command state.
use crate::{CoreError, ProjectAction, ProjectActionRun, workspace_by_id, session_by_id,
    now_iso, read_process_output, isolate_process_tree, terminate_process_tree};
use sqlx::{Row, SqlitePool};
use std::{fs, path::Path, time::Duration};
use tokio::{process::Command as TokioCommand, time as tokio_time};
use ulid::Ulid;

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

pub(crate) async fn run_project_action(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_id: String,
    action_id: String,
    session_id: Option<String>,
) -> Result<ProjectActionRun, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
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
    let started_at = now_iso();
    let mut command = TokioCommand::new(&action.program);
    command
        .args(&action.args)
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    isolate_process_tree(&mut command);
    let mut child = command
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| CoreError::Initialization(format!("start project action: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CoreError::Initialization("project action stdout unavailable".to_owned()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CoreError::Initialization("project action stderr unavailable".to_owned()))?;
    let stdout_task = tokio::spawn(read_process_output(stdout));
    let stderr_task = tokio::spawn(read_process_output(stderr));
    let wait_result = tokio_time::timeout(Duration::from_secs(300), child.wait()).await;
    let (status, exit_code) = match wait_result {
        Ok(result) => {
            let status = result.map_err(|error| {
                CoreError::Initialization(format!("wait for project action: {error}"))
            })?;
            (
                if status.success() {
                    "completed"
                } else {
                    "failed"
                },
                status.code().map(i64::from),
            )
        }
        Err(_) => {
            terminate_process_tree(&mut child).await;
            ("timed_out", None)
        }
    };
    let mut output = String::from_utf8_lossy(&stdout_task.await.unwrap_or_default()).to_string();
    let stderr = String::from_utf8_lossy(&stderr_task.await.unwrap_or_default()).to_string();
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
    let run_id = Ulid::new().to_string();
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
    sqlx::query(
        "INSERT INTO project_action_runs
         (id, schema_version, action_id, workspace_id, session_id, status, exit_code, output, artifact_id, started_at, completed_at)
         VALUES (?, 'aibo.project-action-run/v1', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&run_id)
    .bind(&action_id)
    .bind(&workspace_id)
    .bind(&session_id)
    .bind(status)
    .bind(exit_code)
    .bind(&output)
    .bind(&artifact_id)
    .bind(&started_at)
    .bind(&completed_at)
    .execute(db)
    .await?;
    Ok(ProjectActionRun {
        schema: "aibo.project-action-run/v1".to_owned(),
        id: run_id,
        action_id,
        workspace_id,
        session_id,
        status: status.to_owned(),
        exit_code,
        output,
        artifact_id,
        started_at,
        completed_at,
    })
}

fn project_action_run_from_row(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<ProjectActionRun, CoreError> {
    Ok(ProjectActionRun {
        schema: row.try_get("schema_version")?,
        id: row.try_get("id")?,
        action_id: row.try_get("action_id")?,
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
                exit_code, output, artifact_id, started_at, completed_at
         FROM project_action_runs WHERE workspace_id = ?
         ORDER BY completed_at DESC LIMIT ?",
    )
    .bind(&workspace_id)
    .bind(limit)
    .fetch_all(db)
    .await?;
    rows.iter().map(project_action_run_from_row).collect()
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
        let run = run_project_action(&db, &root, "workspace".into(), action.id.clone(), None).await.unwrap();
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
        assert!(matches!(run_project_action(&db, &root, "workspace".into(), action.id.clone(), None).await, Err(CoreError::WorkspaceTrustRequired)));
        assert_eq!(list_project_action_runs(&db, "workspace".into(), None).await.unwrap().len(), 1);
        delete_project_action(&db, "workspace".into(), action.id).await.unwrap();
        assert!(list_project_actions(&db, "workspace".into()).await.unwrap().is_empty());
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
}
