use serde::Serialize;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{Manager, State};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tracing::{info, warn};
use ulid::Ulid;

const PI_SDK_VERSION: &str = "0.84.4";

#[derive(Clone)]
pub struct AppState {
    db: SqlitePool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    id: String,
    path: String,
    label: String,
    trust: String,
    last_opened_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDiagnostic {
    agent: String,
    label: String,
    status: String,
    executable: Option<String>,
    version: Option<String>,
    capabilities: Vec<String>,
    auth_state: String,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    platform: String,
    app_version: String,
    workspace_count: i64,
    diagnostics: Vec<AgentDiagnostic>,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("invalid workspace path: {0}")]
    InvalidWorkspacePath(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("agent probe failed: {0}")]
    AgentProbe(String),
    #[error("app initialization failed: {0}")]
    Initialization(String),
}

impl Serialize for CoreError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct ErrorPayload<'a> {
            code: &'static str,
            message: &'a str,
        }

        let code = match self {
            Self::InvalidWorkspacePath(_) => "invalid_workspace_path",
            Self::WorkspaceNotFound(_) => "workspace_not_found",
            Self::Database(_) => "database_error",
            Self::AgentProbe(_) => "agent_probe_error",
            Self::Initialization(_) => "initialization_error",
        };
        ErrorPayload {
            code,
            message: &self.to_string(),
        }
        .serialize(serializer)
    }
}

impl From<sqlx::Error> for CoreError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<sqlx::migrate::MigrateError> for CoreError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        Self::Database(format!("migration failed: {error}"))
    }
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

async fn open_database(path: &Path) -> Result<SqlitePool, CoreError> {
    let parent = path.parent().ok_or_else(|| {
        CoreError::Initialization("database path has no parent directory".to_owned())
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        CoreError::Initialization(format!("create app data directory: {error}"))
    })?;

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

fn canonical_workspace_path(raw_path: &str) -> Result<PathBuf, CoreError> {
    let input = raw_path.trim();
    if input.is_empty() {
        return Err(CoreError::InvalidWorkspacePath(
            "path must not be empty".to_owned(),
        ));
    }

    let path = Path::new(input);
    let canonical = fs::canonicalize(path).map_err(|error| {
        CoreError::InvalidWorkspacePath(format!("{input} is not accessible: {error}"))
    })?;
    let metadata = fs::metadata(&canonical).map_err(|error| {
        CoreError::InvalidWorkspacePath(format!("cannot inspect {input}: {error}"))
    })?;
    if !metadata.is_dir() {
        return Err(CoreError::InvalidWorkspacePath(format!(
            "{input} is not a directory"
        )));
    }
    Ok(canonical)
}

fn workspace_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Workspace")
        .to_owned()
}

fn row_to_workspace(row: &sqlx::sqlite::SqliteRow) -> Result<Workspace, CoreError> {
    let trusted: i64 = row.try_get("trusted")?;
    Ok(Workspace {
        id: row.try_get("id")?,
        path: row.try_get("path")?,
        label: row.try_get("label")?,
        trust: if trusted == 1 {
            "trusted".to_owned()
        } else {
            "untrusted".to_owned()
        },
        last_opened_at: row.try_get("last_opened_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn workspace_by_id(db: &SqlitePool, id: &str) -> Result<Workspace, CoreError> {
    let row = sqlx::query(
        "SELECT id, path, label, trusted, last_opened_at, created_at, updated_at
         FROM workspaces WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| CoreError::WorkspaceNotFound(id.to_owned()))?;
    row_to_workspace(&row)
}

#[tauri::command]
async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, CoreError> {
    let rows = sqlx::query(
        "SELECT id, path, label, trusted, last_opened_at, created_at, updated_at
         FROM workspaces ORDER BY last_opened_at DESC, updated_at DESC",
    )
    .fetch_all(&state.db)
    .await?;
    rows.iter().map(row_to_workspace).collect()
}

#[tauri::command]
async fn add_workspace(path: String, state: State<'_, AppState>) -> Result<Workspace, CoreError> {
    let canonical = canonical_workspace_path(&path)?;
    let canonical_string = canonical.to_string_lossy().into_owned();
    let label = workspace_label(&canonical);
    let now = now_iso();
    let id = Ulid::new().to_string();

    sqlx::query(
        "INSERT OR IGNORE INTO workspaces
         (id, path, label, trusted, last_opened_at, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&canonical_string)
    .bind(&label)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?;

    sqlx::query(
        "UPDATE workspaces SET label = ?, last_opened_at = ?, updated_at = ? WHERE path = ?",
    )
    .bind(&label)
    .bind(&now)
    .bind(&now)
    .bind(&canonical_string)
    .execute(&state.db)
    .await?;

    workspace_by_path(&state.db, &canonical_string).await
}

async fn workspace_by_path(db: &SqlitePool, path: &str) -> Result<Workspace, CoreError> {
    let row = sqlx::query(
        "SELECT id, path, label, trusted, last_opened_at, created_at, updated_at
         FROM workspaces WHERE path = ?",
    )
    .bind(path)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| CoreError::Database("workspace insert was not readable".to_owned()))?;
    row_to_workspace(&row)
}

#[tauri::command]
async fn set_workspace_trust(
    workspace_id: String,
    trusted: bool,
    state: State<'_, AppState>,
) -> Result<Workspace, CoreError> {
    let updated = sqlx::query("UPDATE workspaces SET trusted = ?, updated_at = ? WHERE id = ?")
        .bind(i64::from(trusted))
        .bind(now_iso())
        .bind(&workspace_id)
        .execute(&state.db)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CoreError::WorkspaceNotFound(workspace_id));
    }
    workspace_by_id(&state.db, &workspace_id).await
}

#[tauri::command]
async fn remove_workspace(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    let result = sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(&workspace_id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(CoreError::WorkspaceNotFound(workspace_id));
    }
    Ok(())
}

fn find_executable(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for directory in env::split_paths(&path_var) {
        let candidate = directory.join(name);
        if is_executable(&candidate) {
            return Some(candidate);
        }
        #[cfg(windows)]
        for extension in [".exe", ".cmd", ".bat"] {
            let candidate = directory.join(format!("{name}{extension}"));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn probe_binary(agent: &str, label: &str, capabilities: &[&str]) -> AgentDiagnostic {
    let Some(path) = find_executable(agent) else {
        return AgentDiagnostic {
            agent: agent.to_owned(),
            label: label.to_owned(),
            status: "missing".to_owned(),
            executable: None,
            version: None,
            capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
            auth_state: "delegated".to_owned(),
            message: Some(format!("{label} executable was not found on PATH.")),
        };
    };

    match Command::new(&path).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let version = stdout
                .lines()
                .chain(stderr.lines())
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(ToOwned::to_owned);
            AgentDiagnostic {
                agent: agent.to_owned(),
                label: label.to_owned(),
                status: "ready".to_owned(),
                executable: Some(path.to_string_lossy().into_owned()),
                version,
                capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
                auth_state: "delegated".to_owned(),
                message: Some("Authentication remains in the native agent store.".to_owned()),
            }
        }
        Ok(output) => AgentDiagnostic {
            agent: agent.to_owned(),
            label: label.to_owned(),
            status: "error".to_owned(),
            executable: Some(path.to_string_lossy().into_owned()),
            version: None,
            capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
            auth_state: "delegated".to_owned(),
            message: Some(format!("{label} --version exited with {}.", output.status)),
        },
        Err(error) => AgentDiagnostic {
            agent: agent.to_owned(),
            label: label.to_owned(),
            status: "error".to_owned(),
            executable: Some(path.to_string_lossy().into_owned()),
            version: None,
            capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
            auth_state: "delegated".to_owned(),
            message: Some(format!("Unable to run {label}: {error}")),
        },
    }
}

fn probe_pi() -> AgentDiagnostic {
    let cli_path = find_executable("pi");
    AgentDiagnostic {
        agent: "pi".to_owned(),
        label: "Pi".to_owned(),
        status: "ready".to_owned(),
        executable: cli_path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        version: Some(format!("SDK {PI_SDK_VERSION}")),
        capabilities: ["sdk-host", "streaming", "abort", "session-tree"]
            .into_iter()
            .map(ToOwned::to_owned)
            .collect(),
        auth_state: "delegated".to_owned(),
        message: Some(match cli_path {
            Some(_) => {
                "Project-locked SDK host ready; RPC CLI compatibility is available.".to_owned()
            }
            None => "Project-locked SDK host ready; global Pi CLI is optional.".to_owned(),
        }),
    }
}

#[tauri::command]
async fn probe_agents() -> Result<Vec<AgentDiagnostic>, CoreError> {
    let codex = probe_binary(
        "codex",
        "Codex",
        &["app-server", "streaming", "approval", "history"],
    );
    if codex.status == "error" {
        warn!(message = ?codex.message, "codex probe returned an error");
    }
    Ok(vec![codex, probe_pi()])
}

#[tauri::command]
async fn get_app_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, CoreError> {
    let workspace_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
        .fetch_one(&state.db)
        .await?;
    Ok(AppSnapshot {
        platform: env::consts::OS.to_owned(),
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        workspace_count,
        diagnostics: probe_agents().await?,
    })
}

pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("aibo=info")),
        )
        .with_target(false)
        .try_init();

    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|error| {
                Box::new(CoreError::Initialization(format!(
                    "resolve app data directory: {error}"
                ))) as Box<dyn Error>
            })?;
            let db_path = data_dir.join("aibo.sqlite3");
            let db = tauri::async_runtime::block_on(open_database(&db_path))
                .map_err(|error| Box::new(error) as Box<dyn Error>)?;
            info!(path = %db_path.display(), "aibo core initialized");
            app.manage(AppState { db });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_workspaces,
            add_workspace,
            set_workspace_trust,
            remove_workspace,
            probe_agents,
            get_app_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aibo");
}

#[cfg(test)]
mod tests {
    use super::{canonical_workspace_path, find_executable, open_database, workspace_label};
    use sqlx::Row;
    use std::{fs, path::PathBuf};
    use ulid::Ulid;

    fn test_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("aibo-phase1-{}", Ulid::new()));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn canonicalizes_existing_directory() {
        let path = test_directory();
        let canonical = canonical_workspace_path(path.to_str().unwrap()).expect("valid directory");
        assert_eq!(canonical, fs::canonicalize(&path).unwrap());
        assert_eq!(
            workspace_label(&canonical),
            canonical.file_name().unwrap().to_string_lossy()
        );
        fs::remove_dir_all(path).expect("remove test directory");
    }

    #[test]
    fn rejects_missing_workspace() {
        let path = std::env::temp_dir().join(format!("aibo-missing-{}", Ulid::new()));
        let error = canonical_workspace_path(path.to_str().unwrap()).expect_err("missing path");
        assert!(error.to_string().contains("not accessible"));
    }

    #[test]
    fn finds_a_known_executable_without_shelling_out() {
        assert!(find_executable("sh").is_some() || cfg!(windows));
    }

    #[test]
    fn migrates_sqlite_with_wal_and_workspace_storage() {
        let directory = test_directory();
        let database_path = directory.join("aibo.sqlite3");
        let pool = tauri::async_runtime::block_on(open_database(&database_path))
            .expect("open and migrate database");

        let table_count: i64 = tauri::async_runtime::block_on(
            sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'",
            )
            .fetch_one(&pool),
        )
        .expect("query workspace table");
        assert_eq!(table_count, 1);

        let journal_mode: String =
            tauri::async_runtime::block_on(sqlx::query("PRAGMA journal_mode").fetch_one(&pool))
                .expect("query journal mode")
                .try_get(0)
                .expect("read journal mode");
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");

        tauri::async_runtime::block_on(pool.close());
        fs::remove_file(&database_path).expect("remove test database");
        let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
        fs::remove_dir_all(directory).expect("remove test directory");
    }
}
