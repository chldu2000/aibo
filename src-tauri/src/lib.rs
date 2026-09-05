mod change_set;
mod codex;
mod execution_profile;
mod pi;
mod workspace_guard;

use change_set::{restore as restore_change_set, workspace_changes};
use codex::{CodexManager, CodexThreadSnapshot, CodexThreadSummary};
use execution_profile::{
    default_requested_profile, from_row as profile_from_row, resolve as resolve_profile,
    save_for_session as save_session_profile, ExecutionProfile, ResolvedExecutionProfile,
    SessionExecutionProfile,
};
use pi::PiManager;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    collections::HashMap,
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use tauri::{Manager, State};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tokio::sync::Mutex;
use tracing::{info, warn};
use ulid::Ulid;

const PI_SDK_VERSION: &str = "0.84.4";

async fn clone_cached_runtime<T>(
    runtimes: &Mutex<HashMap<String, Arc<T>>>,
    session_id: &str,
) -> Option<Arc<T>> {
    let runtimes = runtimes.lock().await;
    runtimes.get(session_id).cloned()
}

async fn remove_cached_runtime<T>(
    runtimes: &Mutex<HashMap<String, Arc<T>>>,
    session_id: &str,
) -> Option<Arc<T>> {
    runtimes.lock().await.remove(session_id)
}

#[derive(Clone)]
pub struct AppState {
    db: SqlitePool,
    codex: CodexManager,
    pi: PiManager,
    data_dir: PathBuf,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) agent: String,
    pub(crate) label: String,
    pub(crate) state: String,
    pub(crate) archived: bool,
    pub(crate) external_session_id: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineItem {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: Option<String>,
    pub(crate) external_message_id: Option<String>,
    pub(crate) role: String,
    pub(crate) tool_name: Option<String>,
    pub(crate) content: String,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSetState {
    pub(crate) head: Option<String>,
    pub(crate) dirty: Option<bool>,
    pub(crate) captured_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) baseline_exists: bool,
    pub(crate) baseline_hash: Option<String>,
    pub(crate) baseline_size: Option<i64>,
    pub(crate) result_exists: bool,
    pub(crate) result_hash: Option<String>,
    pub(crate) result_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunRef {
    pub(crate) id: String,
    pub(crate) tool_name: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) exit_code: Option<i64>,
    pub(crate) status: String,
    pub(crate) output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationRef {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnChangeSet {
    pub(crate) id: String,
    pub(crate) schema: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: String,
    pub(crate) baseline: ChangeSetState,
    pub(crate) result: ChangeSetState,
    pub(crate) files: Vec<FileChange>,
    pub(crate) commands: Vec<CommandRunRef>,
    pub(crate) verification: Vec<VerificationRef>,
    pub(crate) attribution: String,
    pub(crate) capture_status: String,
    pub(crate) capture_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTurnChangeSetResult {
    pub(crate) applied: bool,
    pub(crate) restored: Vec<String>,
    pub(crate) conflicts: Vec<String>,
    pub(crate) unsupported: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChange {
    pub(crate) path: String,
    pub(crate) kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChanges {
    pub(crate) workspace_id: String,
    pub(crate) head: Option<String>,
    pub(crate) dirty: bool,
    pub(crate) captured_at: String,
    pub(crate) files: Vec<WorkspaceFileChange>,
    pub(crate) capture_status: String,
    pub(crate) capture_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFileDiff {
    pub(crate) path: String,
    pub(crate) available: bool,
    pub(crate) diff: String,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileActionResult {
    pub(crate) path: String,
    pub(crate) action: String,
    pub(crate) applied: bool,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAttachment {
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: Option<String>,
    pub(crate) path: String,
    pub(crate) content_hash: Option<String>,
    pub(crate) size: Option<i64>,
    pub(crate) media_type: String,
    pub(crate) source: String,
    pub(crate) send_strategy: String,
    pub(crate) created_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("invalid workspace path: {0}")]
    InvalidWorkspacePath(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("workspace trust is required for the requested execution profile")]
    WorkspaceTrustRequired,
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("invalid session label: {0}")]
    InvalidSessionLabel(String),
    #[error("invalid session filter: {0}")]
    InvalidSessionFilter(String),
    #[error("invalid execution profile: {0}")]
    InvalidExecutionProfile(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("agent probe failed: {0}")]
    AgentProbe(String),
    #[error("codex adapter error: {0}")]
    Codex(String),
    #[error("Pi adapter error: {0}")]
    Pi(String),
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
            Self::WorkspaceTrustRequired => "workspace_trust_required",
            Self::SessionNotFound(_) => "session_not_found",
            Self::InvalidSessionLabel(_) => "invalid_session_label",
            Self::InvalidSessionFilter(_) => "invalid_session_filter",
            Self::InvalidExecutionProfile(_) => "invalid_execution_profile",
            Self::Database(_) => "database_error",
            Self::AgentProbe(_) => "agent_probe_error",
            Self::Codex(_) => "codex_error",
            Self::Pi(_) => "pi_error",
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

impl From<codex::CodexError> for CoreError {
    fn from(error: codex::CodexError) -> Self {
        Self::Codex(error.to_string())
    }
}

impl From<pi::PiError> for CoreError {
    fn from(error: pi::PiError) -> Self {
        Self::Pi(error.to_string())
    }
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn is_verification_command(command: Option<&str>) -> bool {
    let Some(command) = command else { return false };
    let command = command.trim_start().to_ascii_lowercase();
    [
        "pnpm test",
        "pnpm build",
        "pnpm exec tsc",
        "npm test",
        "yarn test",
        "cargo test",
        "cargo fmt --check",
        "pytest",
        "vitest",
    ]
    .iter()
    .any(|prefix| command.starts_with(prefix))
}

fn attachment_media_type(path: &Path, is_dir: bool) -> String {
    if is_dir {
        return "inode/directory".to_owned();
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md" | "markdown") => "text/markdown".to_owned(),
        Some("txt" | "log") => "text/plain".to_owned(),
        Some("json") => "application/json".to_owned(),
        Some("png") => "image/png".to_owned(),
        Some("jpg" | "jpeg") => "image/jpeg".to_owned(),
        Some("gif") => "image/gif".to_owned(),
        Some("svg") => "image/svg+xml".to_owned(),
        Some("rs") => "text/x-rust".to_owned(),
        Some("ts" | "tsx" | "js" | "jsx" | "svelte") => "text/javascript".to_owned(),
        _ => "application/octet-stream".to_owned(),
    }
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
    state.codex.close_workspace(&workspace_id).await?;
    state.pi.close_workspace(&workspace_id).await?;
    let result = sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(&workspace_id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(CoreError::WorkspaceNotFound(workspace_id));
    }
    Ok(())
}

fn row_to_session(row: &sqlx::sqlite::SqliteRow) -> Result<Session, CoreError> {
    Ok(Session {
        id: row.try_get("id")?,
        workspace_id: row.try_get("workspace_id")?,
        agent: row.try_get("agent")?,
        label: row.try_get("label")?,
        state: row.try_get("state")?,
        archived: row.try_get::<i64, _>("archived")? != 0,
        external_session_id: row.try_get("external_session_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_timeline_item(row: &sqlx::sqlite::SqliteRow) -> Result<TimelineItem, CoreError> {
    Ok(TimelineItem {
        id: row.try_get("id")?,
        session_id: row.try_get("session_id")?,
        turn_id: row.try_get("turn_id")?,
        external_message_id: row.try_get("external_message_id")?,
        role: row.try_get("role")?,
        tool_name: row.try_get("tool_name")?,
        content: row.try_get("content")?,
        status: row.try_get("status")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn session_by_id(db: &SqlitePool, id: &str) -> Result<Session, CoreError> {
    let row = sqlx::query(
        "SELECT s.id, s.workspace_id, s.agent, s.label, s.state, s.archived,
                b.external_session_id, s.created_at, s.updated_at
         FROM sessions s
         LEFT JOIN session_bindings b ON b.session_id = s.id
         WHERE s.id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| CoreError::SessionNotFound(id.to_owned()))?;
    row_to_session(&row)
}

async fn session_agent(db: &SqlitePool, session_id: &str) -> Result<String, CoreError> {
    sqlx::query_scalar("SELECT agent FROM sessions WHERE id = ?")
        .bind(session_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| CoreError::SessionNotFound(session_id.to_owned()))
}

fn require_trusted_workspace(
    workspace: &Workspace,
    profile: &ResolvedExecutionProfile,
) -> Result<(), CoreError> {
    let requests_side_effects = profile.enforced.filesystem_policy == "workspace-write"
        || profile.enforced.command_policy != "disabled"
        || profile.enforced.network_policy != "disabled";
    if requests_side_effects && workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    Ok(())
}

async fn session_execution_profile(
    db: &SqlitePool,
    session_id: &str,
) -> Result<SessionExecutionProfile, CoreError> {
    let row = sqlx::query(
        "SELECT session_id, schema_version, requested_json, enforced_json, unsupported_json,
                adapter_capabilities_json, native_sandbox, resolved_at
         FROM session_execution_profiles WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_optional(db)
    .await?;
    if let Some(row) = row {
        return profile_from_row(&row, session_id.to_owned())
            .map_err(CoreError::InvalidExecutionProfile);
    }

    let agent = session_agent(db, session_id).await?;
    let mut resolved = resolve_profile(&agent, default_requested_profile(&agent).ok(), now_iso())
        .map_err(CoreError::InvalidExecutionProfile)?;
    resolved
        .unsupported
        .push("legacy_session_profile_missing".to_owned());
    Ok(SessionExecutionProfile {
        session_id: session_id.to_owned(),
        profile: resolved,
    })
}

#[tauri::command]
async fn resolve_execution_profile(
    agent: String,
    requested: Option<ExecutionProfile>,
) -> Result<ResolvedExecutionProfile, CoreError> {
    resolve_profile(&agent, requested, now_iso()).map_err(CoreError::InvalidExecutionProfile)
}

#[tauri::command]
async fn get_session_execution_profile(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<SessionExecutionProfile, CoreError> {
    session_execution_profile(&state.db, &session_id).await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionListFilter {
    All,
    Active,
    Archived,
    State(&'static str),
}

fn normalize_session_filter(raw: Option<&str>) -> Result<SessionListFilter, CoreError> {
    match raw.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("active") => Ok(SessionListFilter::Active),
        Some("all") => Ok(SessionListFilter::All),
        Some("archived") => Ok(SessionListFilter::Archived),
        Some("created") => Ok(SessionListFilter::State("created")),
        Some("starting") => Ok(SessionListFilter::State("starting")),
        Some("idle") => Ok(SessionListFilter::State("idle")),
        Some("running") => Ok(SessionListFilter::State("running")),
        Some("waiting_approval") => Ok(SessionListFilter::State("waiting_approval")),
        Some("interrupted") => Ok(SessionListFilter::State("interrupted")),
        Some("failed") => Ok(SessionListFilter::State("failed")),
        Some("closed") => Ok(SessionListFilter::State("closed")),
        Some(value) => Err(CoreError::InvalidSessionFilter(value.to_owned())),
    }
}

#[tauri::command]
async fn list_sessions(
    workspace_id: String,
    search: Option<String>,
    status_filter: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Session>, CoreError> {
    let filter = normalize_session_filter(status_filter.as_deref())?;
    let search = search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.to_lowercase()));
    let mut query_text = String::from(
        "SELECT s.id, s.workspace_id, s.agent, s.label, s.state, s.archived,
                b.external_session_id, s.created_at, s.updated_at
         FROM sessions s
         LEFT JOIN session_bindings b ON b.session_id = s.id
         WHERE s.workspace_id = ?",
    );
    if search.is_some() {
        query_text.push_str(
            " AND (lower(s.label) LIKE ? OR lower(s.agent) LIKE ?
                   OR EXISTS (SELECT 1 FROM messages m
                              WHERE m.session_id = s.id AND lower(m.content) LIKE ?))",
        );
    }
    match filter {
        SessionListFilter::All => {}
        SessionListFilter::Active => query_text.push_str(" AND s.archived = 0"),
        SessionListFilter::Archived => query_text.push_str(" AND s.archived = 1"),
        SessionListFilter::State(_) => query_text.push_str(" AND s.archived = 0 AND s.state = ?"),
    }
    query_text.push_str(" ORDER BY s.archived ASC, s.updated_at DESC");

    let mut query = sqlx::query(&query_text).bind(&workspace_id);
    if let Some(search) = search {
        query = query.bind(search.clone()).bind(search.clone()).bind(search);
    }
    if let SessionListFilter::State(value) = filter {
        query = query.bind(value);
    }
    let rows = query.fetch_all(&state.db).await?;
    rows.iter().map(row_to_session).collect()
}

#[tauri::command]
async fn rename_session(
    session_id: String,
    label: String,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(CoreError::InvalidSessionLabel(
            "label must not be empty".to_owned(),
        ));
    }
    if label.chars().count() > 120 {
        return Err(CoreError::InvalidSessionLabel(
            "label must be at most 120 characters".to_owned(),
        ));
    }
    session_by_id(&state.db, &session_id).await?;
    let updated = sqlx::query("UPDATE sessions SET label = ?, updated_at = ? WHERE id = ?")
        .bind(label)
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CoreError::SessionNotFound(session_id));
    }
    session_by_id(&state.db, &session_id).await
}

#[tauri::command]
async fn get_timeline(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TimelineItem>, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let rows = sqlx::query(
        "SELECT id, session_id, turn_id, external_message_id, role, tool_name, content,
                status, created_at, updated_at
         FROM messages
         WHERE session_id = ?
         ORDER BY created_at ASC, sequence ASC, id ASC",
    )
    .bind(session_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter().map(row_to_timeline_item).collect()
}

#[tauri::command]
async fn get_turn_change_set(
    session_id: String,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<TurnChangeSet>, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let row = sqlx::query(
        "SELECT id, schema_version, workspace_id, session_id, turn_id,
                baseline_head, baseline_dirty, baseline_captured_at,
                result_head, result_dirty, result_captured_at,
                attribution, capture_status, capture_error
         FROM turn_change_sets
         WHERE session_id = ? AND (? IS NULL OR turn_id = ?)
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(&session_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let change_set_id: String = row.try_get("id")?;
    let file_rows = sqlx::query(
        "SELECT path, change_kind, baseline_exists, baseline_hash, baseline_size,
                result_exists, result_hash, result_size
         FROM file_changes WHERE change_set_id = ? ORDER BY path ASC",
    )
    .bind(&change_set_id)
    .fetch_all(&state.db)
    .await?;
    let files = file_rows
        .iter()
        .map(|file| {
            Ok(FileChange {
                path: file.try_get("path")?,
                kind: file.try_get("change_kind")?,
                baseline_exists: file.try_get::<i64, _>("baseline_exists")? != 0,
                baseline_hash: file.try_get("baseline_hash")?,
                baseline_size: file.try_get("baseline_size")?,
                result_exists: file.try_get::<i64, _>("result_exists")? != 0,
                result_hash: file.try_get("result_hash")?,
                result_size: file.try_get("result_size")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;
    let command_rows = sqlx::query(
        "SELECT id, tool_name, tool_command, tool_cwd, tool_exit_code, status, content FROM messages
         WHERE session_id = ? AND turn_id = ? AND role = 'tool'
           AND lower(COALESCE(tool_name, '')) LIKE '%command%'
         ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .bind(row.try_get::<String, _>("turn_id")?)
    .fetch_all(&state.db)
    .await?;
    let commands = command_rows
        .iter()
        .map(|command| {
            Ok(CommandRunRef {
                id: command.try_get("id")?,
                tool_name: command.try_get("tool_name")?,
                command: command.try_get("tool_command")?,
                cwd: command.try_get("tool_cwd")?,
                exit_code: command.try_get("tool_exit_code")?,
                status: command.try_get("status")?,
                output: command.try_get("content")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;
    let verification = commands
        .iter()
        .filter(|command| is_verification_command(command.command.as_deref()))
        .map(|command| VerificationRef {
            id: command.id.clone(),
            status: if command.exit_code.is_some_and(|code| code != 0) || command.status == "failed"
            {
                "failed".to_owned()
            } else if command.status == "completed" {
                "passed".to_owned()
            } else {
                "running".to_owned()
            },
            output: command.output.clone(),
        })
        .collect();
    Ok(Some(TurnChangeSet {
        id: change_set_id,
        schema: row.try_get("schema_version")?,
        workspace_id: row.try_get("workspace_id")?,
        session_id: row.try_get("session_id")?,
        turn_id: row.try_get("turn_id")?,
        baseline: ChangeSetState {
            head: row.try_get("baseline_head")?,
            dirty: row
                .try_get::<Option<i64>, _>("baseline_dirty")?
                .map(|value| value != 0),
            captured_at: row.try_get("baseline_captured_at")?,
        },
        result: ChangeSetState {
            head: row.try_get("result_head")?,
            dirty: row
                .try_get::<Option<i64>, _>("result_dirty")?
                .map(|value| value != 0),
            captured_at: row.try_get("result_captured_at")?,
        },
        files,
        commands,
        verification,
        attribution: row.try_get("attribution")?,
        capture_status: row.try_get("capture_status")?,
        capture_error: row.try_get("capture_error")?,
    }))
}

#[tauri::command]
async fn restore_turn_change_set(
    session_id: String,
    turn_id: String,
    state: State<'_, AppState>,
) -> Result<RestoreTurnChangeSetResult, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let report = restore_change_set(
        &state.db,
        &state.data_dir.join("checkpoints"),
        Path::new(&workspace.path),
        &session_id,
        &turn_id,
    )
    .await
    .map_err(CoreError::Database)?;
    Ok(RestoreTurnChangeSetResult {
        applied: report.applied,
        restored: report.restored,
        conflicts: report.conflicts,
        unsupported: report.unsupported,
    })
}

#[tauri::command]
async fn get_workspace_changes(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceChanges, CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    let changes = workspace_changes(Path::new(&workspace.path))
        .await
        .map_err(CoreError::Database)?;
    Ok(WorkspaceChanges {
        workspace_id,
        head: changes.head,
        dirty: changes.dirty,
        captured_at: changes.captured_at,
        files: changes
            .files
            .into_iter()
            .map(|file| WorkspaceFileChange {
                path: file.path,
                kind: file.kind.to_owned(),
            })
            .collect(),
        capture_status: changes.capture_status.to_owned(),
        capture_error: changes.capture_error,
    })
}

#[tauri::command]
async fn get_turn_file_diff(
    session_id: String,
    turn_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<TurnFileDiff, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    let changed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM file_changes WHERE path = ? AND change_set_id = (
           SELECT id FROM turn_change_sets WHERE session_id = ? AND turn_id = ?
         )",
    )
    .bind(&path)
    .bind(&session_id)
    .bind(&turn_id)
    .fetch_one(&state.db)
    .await?;
    if changed == 0 {
        return Err(CoreError::Database(
            "requested file is not in the turn change set".to_owned(),
        ));
    }
    let root = Path::new(&workspace.path);
    crate::workspace_guard::canonicalize_target(root, Path::new(&path))
        .map_err(CoreError::InvalidWorkspacePath)?;
    let git = Command::new("git")
        .args(["-C", &workspace.path, "rev-parse", "--is-inside-work-tree"])
        .output();
    let Ok(git) = git else {
        return Ok(TurnFileDiff {
            path,
            available: false,
            diff: String::new(),
            reason: Some("Git 不可用，当前工作区暂不提供 unified diff".to_owned()),
        });
    };
    if !git.status.success() || String::from_utf8_lossy(&git.stdout).trim() != "true" {
        return Ok(TurnFileDiff {
            path,
            available: false,
            diff: String::new(),
            reason: Some("非 Git 工作区暂不提供 unified diff".to_owned()),
        });
    }
    let output = Command::new("git")
        .args([
            "-C",
            &workspace.path,
            "diff",
            "--no-ext-diff",
            "--unified=3",
            "HEAD",
            "--",
            &path,
        ])
        .output()
        .map_err(|error| CoreError::Database(format!("read file diff: {error}")))?;
    if !output.status.success() {
        return Err(CoreError::Database(format!(
            "git diff exited with {}",
            output.status
        )));
    }
    let mut diff = String::from_utf8_lossy(&output.stdout).to_string();
    if diff.len() > 200_000 {
        diff.truncate(200_000);
        diff.push_str("\n… diff 已截断");
    }
    Ok(TurnFileDiff {
        path,
        available: true,
        diff,
        reason: None,
    })
}

#[tauri::command]
async fn apply_git_file_action(
    session_id: String,
    path: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<GitFileActionResult, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    if !matches!(action.as_str(), "stage" | "unstage" | "revert") {
        return Err(CoreError::InvalidWorkspacePath(
            "unsupported Git file action".to_owned(),
        ));
    }
    let root = Path::new(&workspace.path);
    crate::workspace_guard::canonicalize_target(root, Path::new(&path))
        .map_err(CoreError::InvalidWorkspacePath)?;
    let args: Vec<&str> = match action.as_str() {
        "stage" => vec!["-C", &workspace.path, "add", "--", &path],
        "unstage" => vec!["-C", &workspace.path, "restore", "--staged", "--", &path],
        "revert" => vec!["-C", &workspace.path, "restore", "--worktree", "--", &path],
        _ => unreachable!(),
    };
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|error| CoreError::Database(format!("run Git file action: {error}")))?;
    let message = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    if !output.status.success() {
        return Ok(GitFileActionResult {
            path,
            action,
            applied: false,
            message: if message.is_empty() {
                format!("git exited with {}", output.status)
            } else {
                message
            },
        });
    }
    Ok(GitFileActionResult {
        path,
        action,
        applied: true,
        message: if message.is_empty() {
            "Git 操作已完成".to_owned()
        } else {
            message
        },
    })
}

#[tauri::command]
async fn register_session_attachments(
    session_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ContextAttachment>, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let now = now_iso();
    let mut attachments = Vec::new();
    for raw_path in paths {
        let target = crate::workspace_guard::canonicalize_target(&root, Path::new(&raw_path))
            .map_err(CoreError::InvalidWorkspacePath)?;
        let metadata = fs::metadata(&target).map_err(|error| {
            CoreError::InvalidWorkspacePath(format!("attachment is unavailable: {error}"))
        })?;
        let is_dir = metadata.is_dir();
        if !is_dir && !metadata.is_file() {
            return Err(CoreError::InvalidWorkspacePath(
                "only files and directories can be attached".to_owned(),
            ));
        }
        let relative = target
            .strip_prefix(&root)
            .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let size = (!is_dir)
            .then_some(metadata.len())
            .map(|value| value as i64);
        let content_hash = if !is_dir && metadata.len() <= 10 * 1024 * 1024 {
            let bytes =
                fs::read(&target).map_err(|error| CoreError::Database(error.to_string()))?;
            let mut digest = Sha256::new();
            digest.update(bytes);
            Some(format!("sha256:{:x}", digest.finalize()))
        } else {
            None
        };
        let id = Ulid::new().to_string();
        sqlx::query(
            "INSERT INTO attachments
             (id, workspace_id, session_id, turn_id, path, content_hash, size,
              media_type, source, send_strategy, created_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'picker', 'reference', ?)",
        )
        .bind(&id)
        .bind(&workspace.id)
        .bind(&session_id)
        .bind(&relative)
        .bind(&content_hash)
        .bind(size)
        .bind(attachment_media_type(&target, is_dir))
        .bind(&now)
        .execute(&state.db)
        .await?;
        attachments.push(ContextAttachment {
            id,
            workspace_id: workspace.id.clone(),
            session_id: session_id.clone(),
            turn_id: None,
            path: relative,
            content_hash,
            size,
            media_type: attachment_media_type(&target, is_dir),
            source: "picker".to_owned(),
            send_strategy: "reference".to_owned(),
            created_at: now.clone(),
        });
    }
    Ok(attachments)
}

#[tauri::command]
async fn list_session_attachments(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ContextAttachment>, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let rows = sqlx::query(
        "SELECT id, workspace_id, session_id, turn_id, path, content_hash, size,
                media_type, source, send_strategy, created_at
         FROM attachments WHERE session_id = ? ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ContextAttachment {
                id: row.try_get("id")?,
                workspace_id: row.try_get("workspace_id")?,
                session_id: row.try_get("session_id")?,
                turn_id: row.try_get("turn_id")?,
                path: row.try_get("path")?,
                content_hash: row.try_get("content_hash")?,
                size: row.try_get("size")?,
                media_type: row.try_get("media_type")?,
                source: row.try_get("source")?,
                send_strategy: row.try_get("send_strategy")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

#[tauri::command]
async fn list_codex_threads(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CodexThreadSummary>, CoreError> {
    state
        .codex
        .list_threads(&workspace_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn read_codex_thread(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<CodexThreadSnapshot, CoreError> {
    state
        .codex
        .read_thread(&session_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn fork_codex_thread(
    session_id: String,
    through_turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    let source_profile = session_execution_profile(&state.db, &session_id).await?;
    let forked = state
        .codex
        .fork(&session_id, through_turn_id.as_deref())
        .await
        .map_err(CoreError::from)?;
    save_session_profile(&state.db, &forked.id, &source_profile.profile).await?;
    Ok(forked)
}

#[tauri::command]
async fn archive_codex_thread(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    state.codex.archive(&session_id).await.map_err(Into::into)
}

#[tauri::command]
async fn unarchive_codex_thread(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    state.codex.unarchive(&session_id).await.map_err(Into::into)
}

#[tauri::command]
async fn archive_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    match session.agent.as_str() {
        "codex" => state.codex.archive(&session_id).await.map_err(Into::into),
        "pi" => state.pi.archive(&session_id).await.map_err(Into::into),
        agent => Err(CoreError::Initialization(format!(
            "unsupported session agent: {agent}"
        ))),
    }
}

#[tauri::command]
async fn unarchive_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    match session.agent.as_str() {
        "codex" => state.codex.unarchive(&session_id).await.map_err(Into::into),
        "pi" => state.pi.unarchive(&session_id).await.map_err(Into::into),
        agent => Err(CoreError::Initialization(format!(
            "unsupported session agent: {agent}"
        ))),
    }
}

#[tauri::command]
async fn create_codex_session(
    workspace_id: String,
    requested_profile: Option<ExecutionProfile>,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    let profile = resolve_profile("codex", requested_profile, now_iso())
        .map_err(CoreError::InvalidExecutionProfile)?;
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    require_trusted_workspace(&workspace, &profile)?;
    let session = state
        .codex
        .create_session(&workspace_id, &profile)
        .await
        .map_err(CoreError::from)?;
    save_session_profile(&state.db, &session.id, &profile).await?;
    Ok(session)
}

#[tauri::command]
async fn send_codex_prompt(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    state
        .codex
        .send_prompt(&session_id, &input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn abort_codex_turn(session_id: String, state: State<'_, AppState>) -> Result<(), CoreError> {
    state.codex.abort(&session_id).await.map_err(Into::into)
}

#[tauri::command]
async fn resolve_codex_approval(
    session_id: String,
    request_id: String,
    decision: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    state
        .codex
        .resolve_approval(&session_id, &request_id, &decision)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn close_codex_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    state.codex.close(&session_id).await.map_err(Into::into)
}

#[tauri::command]
async fn create_pi_session(
    workspace_id: String,
    requested_profile: Option<ExecutionProfile>,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    let profile = resolve_profile("pi", requested_profile, now_iso())
        .map_err(CoreError::InvalidExecutionProfile)?;
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    require_trusted_workspace(&workspace, &profile)?;
    let session = state
        .pi
        .create_session(&workspace_id, &profile)
        .await
        .map_err(CoreError::from)?;
    save_session_profile(&state.db, &session.id, &profile).await?;
    Ok(session)
}

#[tauri::command]
async fn send_pi_prompt(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    state
        .pi
        .send_prompt(&session_id, &input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn abort_pi_turn(session_id: String, state: State<'_, AppState>) -> Result<(), CoreError> {
    state.pi.abort(&session_id).await.map_err(Into::into)
}

#[tauri::command]
async fn resolve_pi_approval(
    session_id: String,
    request_id: String,
    decision: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    state
        .pi
        .resolve_approval(&session_id, &request_id, &decision)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn close_pi_session(session_id: String, state: State<'_, AppState>) -> Result<(), CoreError> {
    state.pi.close(&session_id).await.map_err(Into::into)
}

#[tauri::command]
async fn steer_pi_prompt(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    state
        .pi
        .steer(&session_id, &input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn follow_up_pi_prompt(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    state
        .pi
        .follow_up(&session_id, &input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_pi_session_tree(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, CoreError> {
    state.pi.tree(&session_id).await.map_err(Into::into)
}

#[tauri::command]
async fn navigate_pi_session_tree(
    session_id: String,
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, CoreError> {
    state
        .pi
        .navigate_tree(&session_id, &entry_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_pi_session_snapshot(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, CoreError> {
    state.pi.snapshot(&session_id).await.map_err(Into::into)
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
    let node_path = find_executable("node");
    let host_ready = node_path.is_some();
    AgentDiagnostic {
        agent: "pi".to_owned(),
        label: "Pi".to_owned(),
        status: if host_ready { "ready" } else { "missing" }.to_owned(),
        executable: node_path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        version: Some(format!("SDK {PI_SDK_VERSION}")),
        capabilities: [
            "sdk-host",
            "streaming",
            "abort",
            "session-tree",
            "read-only-tools",
            "workspace-write-gateway",
            "aibo-approval",
        ]
        .into_iter()
        .map(ToOwned::to_owned)
        .collect(),
        auth_state: "delegated".to_owned(),
        message: Some(if host_ready {
            match cli_path {
                Some(_) => "Project-locked SDK host ready; workspace writes are mediated by Aibo Core; Pi has no native sandbox.".to_owned(),
                None => "Project-locked SDK host ready; workspace writes are mediated by Aibo Core; global Pi CLI is optional; Pi has no native sandbox.".to_owned(),
            }
        } else {
            "Node.js is required to start the project-locked Pi SDK host.".to_owned()
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
        .plugin(tauri_plugin_dialog::init())
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
            let codex = CodexManager::new(app.handle().clone(), db.clone(), data_dir.clone());
            let pi = PiManager::new(app.handle().clone(), db.clone(), data_dir.clone());
            app.manage(AppState {
                db,
                codex,
                pi,
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_workspaces,
            add_workspace,
            set_workspace_trust,
            remove_workspace,
            probe_agents,
            get_app_snapshot,
            resolve_execution_profile,
            get_session_execution_profile,
            list_sessions,
            get_timeline,
            get_turn_change_set,
            restore_turn_change_set,
            get_workspace_changes,
            get_turn_file_diff,
            apply_git_file_action,
            register_session_attachments,
            list_session_attachments,
            rename_session,
            list_codex_threads,
            read_codex_thread,
            fork_codex_thread,
            archive_codex_thread,
            unarchive_codex_thread,
            archive_session,
            unarchive_session,
            create_codex_session,
            send_codex_prompt,
            abort_codex_turn,
            resolve_codex_approval,
            close_codex_session,
            create_pi_session,
            send_pi_prompt,
            abort_pi_turn,
            resolve_pi_approval,
            close_pi_session,
            steer_pi_prompt,
            follow_up_pi_prompt,
            get_pi_session_tree,
            navigate_pi_session_tree,
            get_pi_session_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aibo");
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_workspace_path, clone_cached_runtime, find_executable, normalize_session_filter,
        now_iso, open_database, remove_cached_runtime, require_trusted_workspace,
        session_execution_profile, workspace_label, CoreError, SessionListFilter, Workspace,
    };
    use crate::execution_profile;
    use sqlx::Row;
    use std::{collections::HashMap, fs, path::PathBuf, sync::Arc, time::Duration};
    use tokio::sync::Mutex;
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
    fn runtime_cache_access_releases_the_mutex_before_follow_up_work() {
        tauri::async_runtime::block_on(async {
            let runtime = Arc::new(7_u8);
            let runtimes = Mutex::new(HashMap::from([("session".to_owned(), runtime.clone())]));

            let cached = clone_cached_runtime(&runtimes, "session")
                .await
                .expect("cached runtime");
            let removed = tokio::time::timeout(
                Duration::from_millis(100),
                remove_cached_runtime(&runtimes, "session"),
            )
            .await
            .expect("runtime cache mutex should not remain locked")
            .expect("removed runtime");

            assert!(Arc::ptr_eq(&cached, &removed));
            assert!(runtimes.lock().await.is_empty());
        });
    }

    #[test]
    fn normalizes_session_filters_with_active_default() {
        assert_eq!(
            normalize_session_filter(None).expect("default filter"),
            SessionListFilter::Active
        );
        assert_eq!(
            normalize_session_filter(Some(" archived ")).expect("archived filter"),
            SessionListFilter::Archived
        );
        assert_eq!(
            normalize_session_filter(Some("running")).expect("state filter"),
            SessionListFilter::State("running")
        );
        assert!(normalize_session_filter(Some("unknown")).is_err());
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

        for table in [
            "sessions",
            "session_bindings",
            "turns",
            "messages",
            "agent_events",
            "session_execution_profiles",
            "turn_change_sets",
            "file_changes",
        ] {
            let present: i64 = tauri::async_runtime::block_on(
                sqlx::query_scalar(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
                )
                .bind(table)
                .fetch_one(&pool),
            )
            .expect("query phase 1 table");
            assert_eq!(present, 1, "missing migrated table {table}");
        }

        for (table, column) in [
            ("sessions", "archived"),
            ("session_bindings", "parent_external_session_id"),
            ("messages", "tool_name"),
            ("session_execution_profiles", "requested_json"),
            ("session_execution_profiles", "enforced_json"),
            ("session_execution_profiles", "native_sandbox"),
            ("messages", "tool_command"),
            ("messages", "tool_cwd"),
            ("messages", "tool_exit_code"),
        ] {
            let present: i64 = tauri::async_runtime::block_on(
                sqlx::query_scalar("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?")
                    .bind(table)
                    .bind(column)
                    .fetch_one(&pool),
            )
            .expect("query lifecycle column");
            assert_eq!(present, 1, "missing migrated column {table}.{column}");
        }

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

    #[test]
    fn persists_and_reads_a_session_execution_profile() {
        let directory = test_directory();
        let database_path = directory.join("aibo.sqlite3");
        let pool = tauri::async_runtime::block_on(open_database(&database_path))
            .expect("open and migrate database");
        let workspace_id = Ulid::new().to_string();
        let session_id = Ulid::new().to_string();
        let directory_string = directory.to_string_lossy().into_owned();
        tauri::async_runtime::block_on(async {
            let now = now_iso();
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES (?, ?, ?, 1, ?, ?)",
            )
            .bind(&workspace_id)
            .bind(&directory_string)
            .bind("profile-fixture")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert workspace");
            sqlx::query(
                "INSERT INTO sessions (id, workspace_id, agent, label, state, created_at, updated_at)
                 VALUES (?, ?, 'codex', ?, 'idle', ?, ?)",
            )
            .bind(&session_id)
            .bind(&workspace_id)
            .bind("Codex · profile-fixture")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert session");
            let profile = execution_profile::resolve("codex", None, now.clone())
                .expect("resolve default profile");
            execution_profile::save_for_session(&pool, &session_id, &profile)
                .await
                .expect("save session profile");
            let loaded = session_execution_profile(&pool, &session_id)
                .await
                .expect("load session profile");
            assert_eq!(loaded.session_id, session_id);
            assert_eq!(loaded.profile.enforced, profile.enforced);
            assert_eq!(loaded.profile.native_sandbox, profile.native_sandbox);
        });
        tauri::async_runtime::block_on(pool.close());
        fs::remove_file(&database_path).expect("remove test database");
        let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn writable_execution_requires_workspace_trust() {
        let profile = execution_profile::resolve(
            "codex",
            Some(execution_profile::ExecutionProfile {
                schema: execution_profile::EXECUTION_PROFILE_SCHEMA.to_owned(),
                interaction_mode: "edit".to_owned(),
                approval_policy: "on-request".to_owned(),
                filesystem_policy: "workspace-write".to_owned(),
                command_policy: "approved".to_owned(),
                network_policy: "disabled".to_owned(),
                model: None,
                reasoning_effort: None,
            }),
            now_iso(),
        )
        .expect("resolve writable profile");
        let workspace = Workspace {
            id: "workspace".to_owned(),
            path: "/tmp/workspace".to_owned(),
            label: "workspace".to_owned(),
            trust: "untrusted".to_owned(),
            last_opened_at: None,
            created_at: now_iso(),
            updated_at: now_iso(),
        };
        assert!(matches!(
            require_trusted_workspace(&workspace, &profile),
            Err(CoreError::WorkspaceTrustRequired)
        ));
    }
}
