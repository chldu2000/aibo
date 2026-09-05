mod artifact;
mod change_set;
mod codex;
mod execution_profile;
mod pi;
mod workspace_guard;

use change_set::{
    capture as capture_workspace, checkpoint_file_path, persist as persist_change_set,
    restore as restore_change_set, workspace_changes, FileState, RestoreReport, WorkspaceSnapshot,
};
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
    collections::{BTreeSet, HashMap},
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};
use tauri::{Manager, State};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tokio::sync::Mutex;
use tokio::{io::AsyncReadExt, process::Command as TokioCommand, time as tokio_time};
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEntry {
    name: String,
    source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilityInventory {
    workspace_id: String,
    inspected_at: String,
    instructions: Vec<CapabilityEntry>,
    skills: Vec<CapabilityEntry>,
    tools: Vec<CapabilityEntry>,
    mcp_servers: Vec<CapabilityEntry>,
    warnings: Vec<String>,
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
    pub(crate) previous_path: Option<String>,
    pub(crate) kind: String,
    pub(crate) baseline_exists: bool,
    pub(crate) baseline_hash: Option<String>,
    pub(crate) baseline_size: Option<i64>,
    pub(crate) baseline_dirty: bool,
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
pub struct CheckpointFile {
    pub(crate) schema: String,
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: String,
    pub(crate) path: String,
    pub(crate) file_exists: bool,
    pub(crate) content_hash: Option<String>,
    pub(crate) size: Option<i64>,
    pub(crate) storage_path: Option<String>,
    pub(crate) baseline_dirty: bool,
    pub(crate) available: bool,
    pub(crate) reason: Option<String>,
    pub(crate) created_at: String,
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
pub struct RestoreOperation {
    pub(crate) schema: String,
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: String,
    pub(crate) status: String,
    pub(crate) restored: Vec<String>,
    pub(crate) conflicts: Vec<String>,
    pub(crate) unsupported: Vec<String>,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChange {
    pub(crate) path: String,
    pub(crate) previous_path: Option<String>,
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
    pub(crate) hunks: Vec<TurnDiffHunk>,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDiffHunk {
    pub(crate) index: i64,
    pub(crate) header: String,
    pub(crate) content: String,
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
pub struct GitHunkActionResult {
    pub(crate) path: String,
    pub(crate) hunk_index: i64,
    pub(crate) action: String,
    pub(crate) applied: bool,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAttachment {
    pub(crate) schema: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAttachmentValidation {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    pub(crate) current_hash: Option<String>,
    pub(crate) size: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub(crate) schema: String,
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: Option<String>,
    pub(crate) source: String,
    pub(crate) media_type: String,
    pub(crate) size: i64,
    pub(crate) content_hash: String,
    pub(crate) storage_path: String,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactContent {
    pub(crate) artifact: Artifact,
    pub(crate) content: String,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAction {
    pub(crate) schema: String,
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: String,
    pub(crate) enabled: bool,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionRun {
    pub(crate) schema: String,
    pub(crate) id: String,
    pub(crate) action_id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: Option<String>,
    pub(crate) status: String,
    pub(crate) exit_code: Option<i64>,
    pub(crate) output: String,
    pub(crate) artifact_id: Option<String>,
    pub(crate) started_at: String,
    pub(crate) completed_at: String,
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

/// A process-local runtime cannot survive an application restart. Normalize
/// durable running state before exposing the database to the UI so a stale
/// session is recoverable instead of appearing to be actively executing.
async fn recover_interrupted_sessions(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    let now = now_iso();
    sqlx::query(
        "UPDATE process_runs SET state = 'crashed', ended_at = ?
         WHERE state IN ('starting', 'running', 'stopping') AND session_id IN (
           SELECT id FROM sessions WHERE archived = 0
             AND state IN ('starting', 'running', 'waiting_approval')
         )",
    )
    .bind(&now)
    .execute(db)
    .await?;
    sqlx::query(
        "UPDATE messages SET status = 'failed', updated_at = ?
         WHERE status IN ('streaming', 'queued') AND session_id IN (
           SELECT id FROM sessions WHERE archived = 0
             AND state IN ('starting', 'running', 'waiting_approval')
         )",
    )
    .bind(&now)
    .execute(db)
    .await?;
    sqlx::query(
        "UPDATE turns SET status = 'interrupted', completed_at = ?
         WHERE status = 'running' AND session_id IN (
           SELECT id FROM sessions WHERE archived = 0
             AND state IN ('starting', 'running', 'waiting_approval')
         )",
    )
    .bind(&now)
    .execute(db)
    .await?;
    let result = sqlx::query(
        "UPDATE sessions SET state = 'interrupted', updated_at = ?
         WHERE archived = 0 AND state IN ('starting', 'running', 'waiting_approval')",
    )
    .bind(now)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

/// Normalize an adapter crash while the application is still running. Startup
/// recovery covers the same durable states after a process restart, but an
/// in-process crash must not leave the active turn looking as if it is still
/// streaming until the next launch.
pub(crate) async fn mark_turn_interrupted(
    db: &SqlitePool,
    session_id: &str,
    turn_id: &str,
) -> Result<(), sqlx::Error> {
    let now = now_iso();
    sqlx::query(
        "UPDATE turns SET status = 'interrupted', completed_at = ?
         WHERE id = ? AND session_id = ? AND status = 'running'",
    )
    .bind(&now)
    .bind(turn_id)
    .bind(session_id)
    .execute(db)
    .await?;
    sqlx::query(
        "UPDATE messages SET status = 'failed', updated_at = ?
         WHERE session_id = ? AND turn_id = ? AND status IN ('streaming', 'queued')",
    )
    .bind(now)
    .bind(session_id)
    .bind(turn_id)
    .execute(db)
    .await?;
    Ok(())
}

/// Rebuild a durable, unknown-attribution change set for turns that were
/// interrupted before an adapter could emit its terminal event. The baseline
/// bytes/metadata already captured before the restart remain authoritative;
/// the post-restart workspace snapshot is intentionally not attributed to the
/// Agent because it may include edits made after the crash.
async fn recover_interrupted_turn_changes(db: &SqlitePool) -> Result<u64, String> {
    let rows = sqlx::query(
        "SELECT turns.id, turns.session_id, turns.external_turn_id,
                sessions.workspace_id, workspaces.path
         FROM turns
         JOIN sessions ON sessions.id = turns.session_id
         JOIN workspaces ON workspaces.id = sessions.workspace_id
         WHERE turns.status = 'running'",
    )
    .fetch_all(db)
    .await
    .map_err(|error| format!("read interrupted turns: {error}"))?;
    let mut recovered = 0_u64;
    for row in rows {
        let turn_id: String = row
            .try_get("id")
            .map_err(|error| format!("read interrupted turn id: {error}"))?;
        let session_id: String = row
            .try_get("session_id")
            .map_err(|error| format!("read interrupted session id: {error}"))?;
        let workspace_id: String = row
            .try_get("workspace_id")
            .map_err(|error| format!("read interrupted workspace id: {error}"))?;
        let workspace_path: String = row
            .try_get("path")
            .map_err(|error| format!("read interrupted workspace path: {error}"))?;
        let existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM turn_change_sets WHERE session_id = ? AND turn_id = ?",
        )
        .bind(&session_id)
        .bind(&turn_id)
        .fetch_one(db)
        .await
        .map_err(|error| format!("check interrupted change set: {error}"))?;
        if existing > 0 {
            continue;
        }
        let checkpoint_rows = sqlx::query(
            "SELECT path, file_exists, content_hash, size, baseline_head, baseline_dirty,
                    created_at
             FROM checkpoints WHERE session_id = ? AND turn_id = ? ORDER BY path ASC",
        )
        .bind(&session_id)
        .bind(&turn_id)
        .fetch_all(db)
        .await
        .map_err(|error| format!("read interrupted checkpoint: {error}"))?;
        if checkpoint_rows.is_empty() {
            // A crash can happen before the adapter finishes writing the
            // baseline checkpoint. Keep a durable, non-restorable record so
            // the interrupted turn is still visible after restart instead of
            // silently disappearing from Changes.
            let (result, capture_error) = match capture_workspace(Path::new(&workspace_path)).await
            {
                Ok(snapshot) => (
                    Some(snapshot),
                    Some("应用重启后重建；turn 基线 checkpoint 未持久化".to_owned()),
                ),
                Err(error) => (None, Some(format!("应用重启后重建；无法采集结果：{error}"))),
            };
            let change_set_id = persist_change_set(
                db,
                &workspace_id,
                &session_id,
                &turn_id,
                None,
                result.as_ref(),
                capture_error.as_deref(),
            )
            .await
            .map_err(|error| format!("persist interrupted change set: {error}"))?;
            sqlx::query(
                "UPDATE turn_change_sets
                 SET attribution = 'unknown', updated_at = ?
                 WHERE id = ?",
            )
            .bind(now_iso())
            .bind(&change_set_id)
            .execute(db)
            .await
            .map_err(|error| format!("mark interrupted change set unknown: {error}"))?;
            recovered = recovered.saturating_add(1);
            continue;
        }
        let mut files = Vec::with_capacity(checkpoint_rows.len());
        let mut dirty_paths = BTreeSet::new();
        let mut baseline_head = None;
        let mut baseline_dirty = false;
        let mut captured_at = None;
        for checkpoint in checkpoint_rows {
            let path: String = checkpoint
                .try_get("path")
                .map_err(|error| format!("read checkpoint path: {error}"))?;
            let exists = checkpoint
                .try_get::<i64, _>("file_exists")
                .map_err(|error| format!("read checkpoint existence: {error}"))?
                != 0;
            let hash: Option<String> = checkpoint
                .try_get("content_hash")
                .map_err(|error| format!("read checkpoint hash: {error}"))?;
            let size = checkpoint
                .try_get::<Option<i64>, _>("size")
                .map_err(|error| format!("read checkpoint size: {error}"))?
                .and_then(|value| u64::try_from(value).ok());
            let dirty = checkpoint
                .try_get::<i64, _>("baseline_dirty")
                .map_err(|error| format!("read checkpoint attribution: {error}"))?
                != 0;
            if dirty {
                dirty_paths.insert(path.clone());
                baseline_dirty = true;
            }
            if baseline_head.is_none() {
                baseline_head = checkpoint
                    .try_get::<Option<String>, _>("baseline_head")
                    .map_err(|error| format!("read checkpoint head: {error}"))?;
            }
            if captured_at.is_none() {
                captured_at = checkpoint
                    .try_get::<Option<String>, _>("created_at")
                    .map_err(|error| format!("read checkpoint timestamp: {error}"))?;
            }
            files.push(FileState {
                path,
                exists,
                hash,
                size,
            });
        }
        let baseline = WorkspaceSnapshot {
            head: baseline_head,
            dirty: baseline_dirty,
            captured_at: captured_at.unwrap_or_else(now_iso),
            files,
            dirty_paths,
        };
        let (result, capture_error) = match capture_workspace(Path::new(&workspace_path)).await {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error)),
        };
        let change_set_id = persist_change_set(
            db,
            &workspace_id,
            &session_id,
            &turn_id,
            Some(&baseline),
            result.as_ref(),
            capture_error.as_deref(),
        )
        .await
        .map_err(|error| format!("persist interrupted change set: {error}"))?;
        sqlx::query(
            "UPDATE turn_change_sets
             SET attribution = 'unknown',
                 capture_error = COALESCE(capture_error, ?), updated_at = ?
             WHERE id = ?",
        )
        .bind("应用重启后重建；结果可能包含崩溃后的用户修改")
        .bind(now_iso())
        .bind(&change_set_id)
        .execute(db)
        .await
        .map_err(|error| format!("mark interrupted change set unknown: {error}"))?;
        recovered = recovered.saturating_add(1);
    }
    Ok(recovered)
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
    // Keep migrations embedded at build time so a fresh app and an upgraded
    // local database share the same durable schema.
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

#[tauri::command]
async fn open_workspace_location(
    workspace_id: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    let target = target.trim();
    if !matches!(target, "finder" | "terminal" | "editor") {
        return Err(CoreError::InvalidWorkspacePath(
            "unsupported workspace location target".to_owned(),
        ));
    }
    let configured_editor = env::var("AIBO_EDITOR")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    #[cfg(target_os = "macos")]
    let mut process = {
        if target == "editor" {
            let editor = configured_editor.as_deref().ok_or_else(|| {
                CoreError::Initialization(
                    "未配置编辑器；请设置 AIBO_EDITOR（macOS 应填写应用名或 .app 路径）".to_owned(),
                )
            })?;
            let mut command = Command::new("open");
            command.args(["-a", editor]);
            command
        } else {
            let mut command = Command::new("open");
            if target == "terminal" {
                command.args(["-a", "Terminal"]);
            }
            command
        }
    };
    #[cfg(target_os = "windows")]
    let mut process = {
        if target == "editor" {
            let editor = configured_editor.as_deref().ok_or_else(|| {
                CoreError::Initialization(
                    "未配置编辑器；请设置 AIBO_EDITOR（Windows 应填写编辑器可执行文件路径）"
                        .to_owned(),
                )
            })?;
            Command::new(editor)
        } else if target == "finder" {
            let mut command = Command::new("explorer");
            command
        } else {
            let mut command = Command::new("cmd");
            command.args(["/C", "start", "", "cmd", "/K"]);
            command.current_dir(&workspace.path);
            command
        }
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut process = {
        if target == "editor" {
            let editor = configured_editor.as_deref().ok_or_else(|| {
                CoreError::Initialization(
                    "未配置编辑器；请设置 AIBO_EDITOR（填写可执行文件路径）".to_owned(),
                )
            })?;
            Command::new(editor)
        } else if target == "finder" {
            Command::new("xdg-open")
        } else {
            let mut command = Command::new("x-terminal-emulator");
            command.current_dir(&workspace.path);
            command
        }
    };
    #[cfg(target_os = "windows")]
    if matches!(target, "finder" | "editor") {
        process.arg(&workspace.path);
    }
    #[cfg(not(target_os = "windows"))]
    process.arg(&workspace.path);
    process.spawn().map_err(|error| {
        CoreError::Initialization(format!("open workspace in {target}: {error}"))
    })?;
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
        "SELECT path, previous_path, change_kind, baseline_exists, baseline_hash, baseline_size,
                baseline_dirty, result_exists, result_hash, result_size
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
                previous_path: file.try_get("previous_path")?,
                kind: file.try_get("change_kind")?,
                baseline_exists: file.try_get::<i64, _>("baseline_exists")? != 0,
                baseline_hash: file.try_get("baseline_hash")?,
                baseline_size: file.try_get("baseline_size")?,
                baseline_dirty: file.try_get::<i64, _>("baseline_dirty")? != 0,
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
async fn list_turn_checkpoints(
    session_id: String,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<CheckpointFile>, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let rows = sqlx::query(
        "SELECT schema_version, id, workspace_id, session_id, turn_id, path,
                file_exists, content_hash, size, storage_path, baseline_dirty, created_at
         FROM checkpoints
         WHERE session_id = ? AND (? IS NULL OR turn_id = ?)
         ORDER BY path ASC",
    )
    .bind(&session_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(|row| {
            let file_exists = row.try_get::<i64, _>("file_exists")? != 0;
            let storage_path: Option<String> = row.try_get("storage_path")?;
            let baseline_dirty = row.try_get::<i64, _>("baseline_dirty")? != 0;
            let available = !file_exists || storage_path.is_some();
            Ok(CheckpointFile {
                schema: row.try_get("schema_version")?,
                id: row.try_get("id")?,
                workspace_id: row.try_get("workspace_id")?,
                session_id: row.try_get("session_id")?,
                turn_id: row.try_get("turn_id")?,
                path: row.try_get("path")?,
                file_exists,
                content_hash: row.try_get("content_hash")?,
                size: row.try_get("size")?,
                storage_path,
                baseline_dirty,
                available,
                reason: if available {
                    None
                } else {
                    Some("baseline 文件过大、不可哈希或 checkpoint 文件不可用".to_owned())
                },
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

async fn persist_restore_operation(
    db: &SqlitePool,
    workspace_id: &str,
    session_id: &str,
    turn_id: &str,
    report: &RestoreReport,
    status_override: Option<&str>,
) -> Result<RestoreOperation, CoreError> {
    let id = Ulid::new().to_string();
    let created_at = now_iso();
    let default_status = if report.applied {
        "completed"
    } else if !report.conflicts.is_empty() || !report.unsupported.is_empty() {
        "blocked"
    } else {
        "failed"
    };
    let status = status_override.unwrap_or(default_status);
    let restored_json = serde_json::to_string(&report.restored)
        .map_err(|error| CoreError::Database(format!("serialize restored paths: {error}")))?;
    let conflicts_json = serde_json::to_string(&report.conflicts)
        .map_err(|error| CoreError::Database(format!("serialize restore conflicts: {error}")))?;
    let unsupported_json = serde_json::to_string(&report.unsupported).map_err(|error| {
        CoreError::Database(format!("serialize restore unsupported paths: {error}"))
    })?;

    sqlx::query(
        "INSERT INTO restore_operations
         (id, schema_version, workspace_id, session_id, turn_id, status,
          restored_json, conflicts_json, unsupported_json, created_at)
         VALUES (?, 'aibo.restore-operation/v1', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(workspace_id)
    .bind(session_id)
    .bind(turn_id)
    .bind(status)
    .bind(&restored_json)
    .bind(&conflicts_json)
    .bind(&unsupported_json)
    .bind(&created_at)
    .execute(db)
    .await?;

    Ok(RestoreOperation {
        schema: "aibo.restore-operation/v1".to_owned(),
        id,
        workspace_id: workspace_id.to_owned(),
        session_id: session_id.to_owned(),
        turn_id: turn_id.to_owned(),
        status: status.to_owned(),
        restored: report.restored.clone(),
        conflicts: report.conflicts.clone(),
        unsupported: report.unsupported.clone(),
        created_at,
    })
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
    let report = match restore_change_set(
        &state.db,
        &state.data_dir.join("checkpoints"),
        Path::new(&workspace.path),
        &session_id,
        &turn_id,
    )
    .await
    {
        Ok(report) => report,
        Err(error) => {
            let failure = RestoreReport {
                unsupported: vec![error.clone()],
                ..RestoreReport::default()
            };
            persist_restore_operation(
                &state.db,
                &session.workspace_id,
                &session_id,
                &turn_id,
                &failure,
                Some("failed"),
            )
            .await?;
            return Err(CoreError::Database(error));
        }
    };
    let _operation = persist_restore_operation(
        &state.db,
        &session.workspace_id,
        &session_id,
        &turn_id,
        &report,
        None,
    )
    .await?;
    let audit_id = Ulid::new().to_string();
    let now = now_iso();
    let audit_message = if report.applied {
        format!(
            "已恢复本轮 Agent 变更（{} 个文件）；恢复动作已记录。",
            report.restored.len()
        )
    } else if !report.conflicts.is_empty() {
        format!(
            "恢复已阻止：{} 个文件在本轮后发生了变化；未覆盖用户修改。",
            report.conflicts.len()
        )
    } else if !report.unsupported.is_empty() {
        format!("恢复已阻止：{}", report.unsupported.join("、"))
    } else {
        "恢复未执行：没有可恢复的变更。".to_owned()
    };
    sqlx::query(
        "INSERT INTO messages
         (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'system', ?, 'completed', 0, ?, ?)",
    )
    .bind(&audit_id)
    .bind(&session_id)
    .bind(&turn_id)
    .bind(format!("restore:{audit_id}"))
    .bind(audit_message)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(RestoreTurnChangeSetResult {
        applied: report.applied,
        restored: report.restored,
        conflicts: report.conflicts,
        unsupported: report.unsupported,
    })
}

#[tauri::command]
async fn list_restore_operations(
    session_id: String,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RestoreOperation>, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    let rows = sqlx::query(
        "SELECT schema_version, id, workspace_id, session_id, turn_id, status,
                restored_json, conflicts_json, unsupported_json, created_at
         FROM restore_operations
         WHERE session_id = ? AND (? IS NULL OR turn_id = ?)
         ORDER BY created_at DESC, id DESC",
    )
    .bind(&session_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .fetch_all(&state.db)
    .await?;

    rows.iter()
        .map(|row| {
            let workspace_id: String = row.try_get("workspace_id")?;
            if workspace_id != session.workspace_id {
                return Err(sqlx::Error::Protocol(
                    "restore operation workspace mismatch".to_owned(),
                ));
            }
            let restored_json: String = row.try_get("restored_json")?;
            let conflicts_json: String = row.try_get("conflicts_json")?;
            let unsupported_json: String = row.try_get("unsupported_json")?;
            let restored = serde_json::from_str(&restored_json).map_err(|error| {
                sqlx::Error::Protocol(format!("invalid restored paths: {error}"))
            })?;
            let conflicts = serde_json::from_str(&conflicts_json).map_err(|error| {
                sqlx::Error::Protocol(format!("invalid restore conflicts: {error}"))
            })?;
            let unsupported = serde_json::from_str(&unsupported_json).map_err(|error| {
                sqlx::Error::Protocol(format!("invalid restore unsupported paths: {error}"))
            })?;
            Ok(RestoreOperation {
                schema: row.try_get("schema_version")?,
                id: row.try_get("id")?,
                workspace_id,
                session_id: row.try_get("session_id")?,
                turn_id: row.try_get("turn_id")?,
                status: row.try_get("status")?,
                restored,
                conflicts,
                unsupported,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
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
                previous_path: file.previous_path,
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
    let row = sqlx::query(
        "SELECT previous_path, baseline_exists, baseline_hash, baseline_dirty,
                result_exists, result_hash, baseline_head, attribution
         FROM file_changes
         JOIN turn_change_sets ON turn_change_sets.id = file_changes.change_set_id
         WHERE file_changes.path = ? AND turn_change_sets.session_id = ?
           AND turn_change_sets.turn_id = ?",
    )
    .bind(&path)
    .bind(&session_id)
    .bind(&turn_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else {
        return Err(CoreError::Database(
            "requested file is not in the turn change set".to_owned(),
        ));
    };
    let previous_path: Option<String> = row.try_get("previous_path")?;
    let baseline_path = previous_path.as_deref().unwrap_or(&path);
    let baseline_exists = row.try_get::<i64, _>("baseline_exists")? != 0;
    let baseline_hash: Option<String> = row.try_get("baseline_hash")?;
    let baseline_dirty = row.try_get::<i64, _>("baseline_dirty")? != 0;
    let result_exists = row.try_get::<i64, _>("result_exists")? != 0;
    let result_hash: Option<String> = row.try_get("result_hash")?;
    let baseline_head: Option<String> = row.try_get("baseline_head")?;
    if (baseline_exists && baseline_hash.is_none()) || (result_exists && result_hash.is_none()) {
        return Ok(TurnFileDiff {
            path,
            available: false,
            diff: String::new(),
            hunks: Vec::new(),
            reason: Some("文件过大或无法安全哈希，暂不生成 inline diff".to_owned()),
        });
    }
    let root = Path::new(&workspace.path);
    let target = crate::workspace_guard::canonicalize_target(root, Path::new(&path))
        .map_err(CoreError::InvalidWorkspacePath)?;
    let baseline_bytes = if !baseline_exists {
        Vec::new()
    } else {
        let checkpoint = checkpoint_file_path(
            &state.data_dir.join("checkpoints"),
            &session_id,
            &turn_id,
            baseline_path,
        );
        if checkpoint.is_file() {
            fs::read(&checkpoint).map_err(|error| {
                CoreError::Database(format!("read checkpoint diff source: {error}"))
            })?
        } else if baseline_dirty {
            return Ok(TurnFileDiff {
                path,
                available: false,
                diff: String::new(),
                hunks: Vec::new(),
                reason: Some("本轮前已有修改，且 baseline checkpoint 不可用".to_owned()),
            });
        } else if let Some(head) = baseline_head.as_deref() {
            let output = Command::new("git")
                .args([
                    "-C",
                    &workspace.path,
                    "show",
                    &format!("{head}:{baseline_path}"),
                ])
                .output()
                .map_err(|error| CoreError::Database(format!("read Git baseline: {error}")))?;
            if !output.status.success() {
                return Ok(TurnFileDiff {
                    path,
                    available: false,
                    diff: String::new(),
                    hunks: Vec::new(),
                    reason: Some("Git baseline 不可用，暂不生成 diff".to_owned()),
                });
            }
            output.stdout
        } else {
            return Ok(TurnFileDiff {
                path,
                available: false,
                diff: String::new(),
                hunks: Vec::new(),
                reason: Some("缺少 baseline checkpoint，暂不生成 diff".to_owned()),
            });
        }
    };
    let result_bytes = if result_exists {
        fs::read(&target)
            .map_err(|error| CoreError::Database(format!("read current diff source: {error}")))?
    } else {
        Vec::new()
    };
    if result_exists {
        let mut digest = Sha256::new();
        digest.update(&result_bytes);
        let current_hash = format!("sha256:{:x}", digest.finalize());
        if result_hash.as_deref() != Some(current_hash.as_str()) {
            return Ok(TurnFileDiff {
                path,
                available: false,
                diff: String::new(),
                hunks: Vec::new(),
                reason: Some("文件在本轮结束后发生变化，暂不生成 diff".to_owned()),
            });
        }
    }
    if baseline_bytes.len() > 10 * 1024 * 1024 || result_bytes.len() > 10 * 1024 * 1024 {
        return Ok(TurnFileDiff {
            path,
            available: false,
            diff: String::new(),
            hunks: Vec::new(),
            reason: Some("文件超过 inline diff 限额".to_owned()),
        });
    }
    if std::str::from_utf8(&baseline_bytes).is_err() || std::str::from_utf8(&result_bytes).is_err()
    {
        return Ok(TurnFileDiff {
            path,
            available: false,
            diff: String::new(),
            hunks: Vec::new(),
            reason: Some("二进制文件暂不提供文本 diff".to_owned()),
        });
    }
    let mut diff = run_unified_text_diff(&path, &baseline_bytes, &result_bytes)
        .map_err(CoreError::Database)?;
    if diff.len() > 200_000 {
        diff = crate::artifact::truncate_utf8(&diff, 200_000, "\n… diff 已截断");
    }
    Ok(TurnFileDiff {
        path,
        available: true,
        hunks: parse_unified_hunks(&diff),
        diff,
        reason: None,
    })
}

struct TurnDiffSources {
    baseline: Vec<u8>,
    result: Vec<u8>,
    baseline_dirty: bool,
}

enum TurnDiffSourceError {
    NotChanged,
    Unavailable(String),
    UnsafePath(String),
    Failed(String),
}

async fn load_turn_diff_sources(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_path: &str,
    session_id: &str,
    turn_id: &str,
    path: &str,
) -> Result<TurnDiffSources, TurnDiffSourceError> {
    let row = sqlx::query(
        "SELECT previous_path, change_kind, baseline_exists, baseline_hash, baseline_dirty,
                result_exists, result_hash, baseline_head
         FROM file_changes
         JOIN turn_change_sets ON turn_change_sets.id = file_changes.change_set_id
         WHERE file_changes.path = ? AND turn_change_sets.session_id = ?
           AND turn_change_sets.turn_id = ?",
    )
    .bind(path)
    .bind(session_id)
    .bind(turn_id)
    .fetch_optional(db)
    .await
    .map_err(|error| TurnDiffSourceError::Failed(format!("read turn diff metadata: {error}")))?;
    let Some(row) = row else {
        return Err(TurnDiffSourceError::NotChanged);
    };
    let previous_path: Option<String> = row
        .try_get("previous_path")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?;
    let change_kind: String = row
        .try_get("change_kind")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?;
    if change_kind == "renamed" {
        return Err(TurnDiffSourceError::Unavailable(
            "重命名文件暂不支持 hunk 级操作，请使用文件级恢复".to_owned(),
        ));
    }
    let baseline_path = previous_path.as_deref().unwrap_or(path);
    let baseline_exists = row
        .try_get::<i64, _>("baseline_exists")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?
        != 0;
    let baseline_hash: Option<String> = row
        .try_get("baseline_hash")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?;
    let baseline_dirty = row
        .try_get::<i64, _>("baseline_dirty")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?
        != 0;
    let result_exists = row
        .try_get::<i64, _>("result_exists")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?
        != 0;
    let result_hash: Option<String> = row
        .try_get("result_hash")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?;
    let baseline_head: Option<String> = row
        .try_get("baseline_head")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?;
    let attribution: String = row
        .try_get("attribution")
        .map_err(|error| TurnDiffSourceError::Failed(error.to_string()))?;
    if attribution == "unknown" {
        return Err(TurnDiffSourceError::Unavailable(
            "本轮变更归属未知，禁止应用 Git 操作".to_owned(),
        ));
    }
    if (baseline_exists && baseline_hash.is_none()) || (result_exists && result_hash.is_none()) {
        return Err(TurnDiffSourceError::Unavailable(
            "文件过大或无法安全哈希".to_owned(),
        ));
    }
    let root = Path::new(workspace_path);
    let target = crate::workspace_guard::canonicalize_target(root, Path::new(path))
        .map_err(TurnDiffSourceError::UnsafePath)?;
    let baseline = if !baseline_exists {
        Vec::new()
    } else {
        let checkpoint = checkpoint_file_path(
            &data_dir.join("checkpoints"),
            session_id,
            turn_id,
            baseline_path,
        );
        if checkpoint.is_file() {
            fs::read(checkpoint)
                .map_err(|error| TurnDiffSourceError::Failed(format!("read checkpoint: {error}")))?
        } else if baseline_dirty {
            return Err(TurnDiffSourceError::Unavailable(
                "本轮前已有修改，且 baseline checkpoint 不可用".to_owned(),
            ));
        } else if let Some(head) = baseline_head.as_deref() {
            let output = Command::new("git")
                .args([
                    "-C",
                    workspace_path,
                    "show",
                    &format!("{head}:{baseline_path}"),
                ])
                .output()
                .map_err(|error| {
                    TurnDiffSourceError::Failed(format!("read Git baseline: {error}"))
                })?;
            if !output.status.success() {
                return Err(TurnDiffSourceError::Unavailable(
                    "Git baseline 不可用".to_owned(),
                ));
            }
            output.stdout
        } else {
            return Err(TurnDiffSourceError::Unavailable(
                "缺少 baseline checkpoint".to_owned(),
            ));
        }
    };
    let result = if result_exists {
        let bytes = fs::read(&target)
            .map_err(|error| TurnDiffSourceError::Failed(format!("read current file: {error}")))?;
        let current_hash = {
            let mut digest = Sha256::new();
            digest.update(&bytes);
            format!("sha256:{:x}", digest.finalize())
        };
        if result_hash.as_deref() != Some(current_hash.as_str()) {
            return Err(TurnDiffSourceError::Unavailable(
                "当前文件已在本轮后发生变化，拒绝应用 hunk".to_owned(),
            ));
        }
        bytes
    } else {
        Vec::new()
    };
    if baseline.len() > 10 * 1024 * 1024 || result.len() > 10 * 1024 * 1024 {
        return Err(TurnDiffSourceError::Unavailable(
            "文件超过 inline diff 限额".to_owned(),
        ));
    }
    if std::str::from_utf8(&baseline).is_err() || std::str::from_utf8(&result).is_err() {
        return Err(TurnDiffSourceError::Unavailable(
            "二进制文件暂不支持 hunk 操作".to_owned(),
        ));
    }
    Ok(TurnDiffSources {
        baseline,
        result,
        baseline_dirty,
    })
}

/// Generate a unified text diff without treating the current Git HEAD as the
/// baseline. This preserves the distinction between pre-existing dirty files
/// and changes made by the selected turn, and also works in non-Git folders.
fn run_unified_text_diff(path: &str, baseline: &[u8], result: &[u8]) -> Result<String, String> {
    let id = Ulid::new();
    let directory = env::temp_dir();
    let baseline_path = directory.join(format!("aibo-diff-{id}-baseline"));
    let result_path = directory.join(format!("aibo-diff-{id}-result"));
    fs::write(&baseline_path, baseline).map_err(|error| format!("write diff baseline: {error}"))?;
    fs::write(&result_path, result).map_err(|error| format!("write diff result: {error}"))?;
    // Keep standard a/ and b/ prefixes so the same diff can be safely fed to
    // Git's patch machinery when hunk-level actions are added.
    let baseline_label = format!("a/{path}");
    let result_label = format!("b/{path}");
    let output = Command::new("diff")
        .args(["-u", "-L", &baseline_label, "-L", &result_label])
        .arg(&baseline_path)
        .arg(&result_path)
        .output();
    let output = match output {
        Ok(output) if output.status.success() || output.status.code() == Some(1) => output,
        _ => Command::new("git")
            .args([
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--unified=3",
                "--label",
                &baseline_label,
                "--label",
                &result_label,
            ])
            .arg(&baseline_path)
            .arg(&result_path)
            .output()
            .map_err(|error| format!("run unified diff: {error}"))?,
    };
    let _ = fs::remove_file(&baseline_path);
    let _ = fs::remove_file(&result_path);
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!("diff exited with {}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_unified_hunks(diff: &str) -> Vec<TurnDiffHunk> {
    let mut hunks = Vec::new();
    let mut current_header: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();
    for line in diff.lines() {
        if line.starts_with("@@ ") {
            if let Some(header) = current_header.take() {
                hunks.push(TurnDiffHunk {
                    index: hunks.len() as i64,
                    header,
                    content: current_lines.join("\n"),
                });
                current_lines.clear();
            }
            current_header = Some(line.to_owned());
            current_lines.push(line);
        } else if current_header.is_some() {
            current_lines.push(line);
        }
    }
    if let Some(header) = current_header {
        hunks.push(TurnDiffHunk {
            index: hunks.len() as i64,
            header,
            content: current_lines.join("\n"),
        });
    }
    hunks
}

fn select_unified_hunk(diff: &str, hunk_index: usize) -> Result<String, String> {
    let lines: Vec<&str> = diff.lines().collect();
    let header_start = lines
        .iter()
        .position(|line| line.starts_with("--- "))
        .ok_or_else(|| "diff 缺少文件头".to_owned())?;
    let plus_header = header_start + 1;
    if lines
        .get(plus_header)
        .map_or(true, |line| !line.starts_with("+++ "))
    {
        return Err("diff 缺少目标文件头".to_owned());
    }
    let hunk_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| line.starts_with("@@ ").then_some(index))
        .collect();
    let Some(&start) = hunk_starts.get(hunk_index) else {
        return Err(format!("hunk index {hunk_index} 超出范围"));
    };
    let end = hunk_starts
        .get(hunk_index + 1)
        .copied()
        .unwrap_or(lines.len());
    let mut patch = Vec::with_capacity(end - header_start + 1);
    patch.extend_from_slice(&lines[header_start..plus_header + 1]);
    patch.extend_from_slice(&lines[start..end]);
    Ok(format!("{}\n", patch.join("\n")))
}

#[tauri::command]
async fn apply_git_hunk_action(
    session_id: String,
    turn_id: String,
    path: String,
    hunk_index: i64,
    action: String,
    state: State<'_, AppState>,
) -> Result<GitHunkActionResult, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    if !matches!(action.as_str(), "stage" | "unstage" | "revert") {
        return Err(CoreError::InvalidWorkspacePath(
            "unsupported Git hunk action".to_owned(),
        ));
    }
    if hunk_index < 0 {
        return Err(CoreError::InvalidWorkspacePath(
            "hunk index must not be negative".to_owned(),
        ));
    }
    let sources = match load_turn_diff_sources(
        &state.db,
        &state.data_dir,
        &workspace.path,
        &session_id,
        &turn_id,
        &path,
    )
    .await
    {
        Ok(sources) => sources,
        Err(TurnDiffSourceError::NotChanged) => {
            return Err(CoreError::Database(
                "requested file is not in the turn change set".to_owned(),
            ));
        }
        Err(TurnDiffSourceError::UnsafePath(error)) => {
            return Err(CoreError::InvalidWorkspacePath(error));
        }
        Err(TurnDiffSourceError::Unavailable(reason)) => {
            return Ok(GitHunkActionResult {
                path,
                hunk_index,
                action,
                applied: false,
                message: reason,
            });
        }
        Err(TurnDiffSourceError::Failed(error)) => return Err(CoreError::Database(error)),
    };
    if sources.baseline_dirty {
        return Ok(GitHunkActionResult {
            path,
            hunk_index,
            action,
            applied: false,
            message: "本轮前已有修改，拒绝执行 hunk 级 Git 操作".to_owned(),
        });
    }
    let git = Command::new("git")
        .args(["-C", &workspace.path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|error| CoreError::Database(format!("probe Git workspace: {error}")))?;
    if !git.status.success() || String::from_utf8_lossy(&git.stdout).trim() != "true" {
        return Ok(GitHunkActionResult {
            path,
            hunk_index,
            action,
            applied: false,
            message: "非 Git 工作区不支持 hunk 级操作".to_owned(),
        });
    }
    let full_diff = run_unified_text_diff(&path, &sources.baseline, &sources.result)
        .map_err(CoreError::Database)?;
    let patch =
        select_unified_hunk(&full_diff, hunk_index as usize).map_err(CoreError::Database)?;
    let patch_path = env::temp_dir().join(format!("aibo-hunk-{id}.patch", id = Ulid::new()));
    fs::write(&patch_path, patch.as_bytes())
        .map_err(|error| CoreError::Database(format!("write hunk patch: {error}")))?;
    let mut check_args = vec![
        "-C".to_owned(),
        workspace.path.clone(),
        "apply".to_owned(),
        "--check".to_owned(),
        "--whitespace=nowarn".to_owned(),
    ];
    if action == "stage" || action == "unstage" {
        check_args.push("--cached".to_owned());
    }
    if action == "unstage" || action == "revert" {
        check_args.push("--reverse".to_owned());
    }
    check_args.push(patch_path.to_string_lossy().into_owned());
    let check = Command::new("git")
        .args(&check_args)
        .output()
        .map_err(|error| CoreError::Database(format!("check hunk patch: {error}")))?;
    if !check.status.success() {
        let _ = fs::remove_file(&patch_path);
        let message = String::from_utf8_lossy(&check.stderr).trim().to_owned();
        return Ok(GitHunkActionResult {
            path,
            hunk_index,
            action,
            applied: false,
            message: if message.is_empty() {
                format!("git apply --check exited with {}", check.status)
            } else {
                message
            },
        });
    }
    let mut apply_args = check_args;
    if let Some(check_index) = apply_args.iter().position(|value| value == "--check") {
        apply_args.remove(check_index);
    }
    let output = Command::new("git")
        .args(&apply_args)
        .output()
        .map_err(|error| CoreError::Database(format!("apply hunk patch: {error}")))?;
    let _ = fs::remove_file(&patch_path);
    let message = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    Ok(GitHunkActionResult {
        path,
        hunk_index,
        action,
        applied: output.status.success(),
        message: if message.is_empty() {
            if output.status.success() {
                "Git hunk 操作已完成".to_owned()
            } else {
                format!("git exited with {}", output.status)
            }
        } else {
            message
        },
    })
}

#[tauri::command]
async fn apply_git_file_action(
    session_id: String,
    path: String,
    action: String,
    turn_id: Option<String>,
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
    if action == "revert" {
        if let Some(turn_id) = turn_id.as_deref() {
            let metadata = sqlx::query(
                "SELECT baseline_dirty, change_kind FROM file_changes
                 JOIN turn_change_sets ON turn_change_sets.id = file_changes.change_set_id
                 WHERE file_changes.path = ? AND turn_change_sets.session_id = ?
                   AND turn_change_sets.turn_id = ?",
            )
            .bind(&path)
            .bind(&session_id)
            .bind(turn_id)
            .fetch_optional(&state.db)
            .await?;
            let baseline_dirty = metadata
                .as_ref()
                .map(|row| row.try_get::<i64, _>("baseline_dirty"))
                .transpose()?;
            let change_kind = metadata
                .as_ref()
                .map(|row| row.try_get::<String, _>("change_kind"))
                .transpose()?;
            if change_kind.as_deref() == Some("renamed") {
                return Ok(GitFileActionResult {
                    path,
                    action,
                    applied: false,
                    message: "重命名文件请使用“恢复本轮变更”，以便同时恢复源路径".to_owned(),
                });
            }
            if baseline_dirty == Some(1) {
                return Ok(GitFileActionResult {
                    path,
                    action,
                    applied: false,
                    message: "本轮前已有修改，禁止整文件还原；请审阅后处理".to_owned(),
                });
            }
        }
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
            schema: "aibo.context-attachment/v1".to_owned(),
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
        "SELECT id, schema_version, workspace_id, session_id, turn_id, path, content_hash, size,
                media_type, source, send_strategy, created_at
         FROM attachments WHERE session_id = ? ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ContextAttachment {
                schema: row.try_get("schema_version")?,
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
async fn remove_session_attachment(
    session_id: String,
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    session_by_id(&state.db, &session_id).await?;
    sqlx::query("DELETE FROM attachments WHERE id = ? AND session_id = ?")
        .bind(attachment_id)
        .bind(session_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[tauri::command]
async fn bind_session_attachments(
    session_id: String,
    turn_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let internal_turn_id: String = sqlx::query_scalar(
        "SELECT id FROM turns
         WHERE session_id = ? AND (id = ? OR external_turn_id = ?)
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
         LIMIT 1",
    )
    .bind(&session_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| CoreError::SessionNotFound(format!("turn {turn_id}")))?;
    sqlx::query("UPDATE attachments SET turn_id = ? WHERE session_id = ? AND turn_id IS NULL")
        .bind(internal_turn_id)
        .bind(session_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[tauri::command]
async fn validate_session_attachments(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ContextAttachmentValidation>, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let rows = sqlx::query(
        "SELECT id, path, content_hash, size FROM attachments
         WHERE session_id = ? AND turn_id IS NULL ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(|row| {
            let id: String = row.try_get("id")?;
            let path: String = row.try_get("path")?;
            let expected_hash: Option<String> = row.try_get("content_hash")?;
            let expected_size: Option<i64> = row.try_get("size")?;
            let result = crate::workspace_guard::canonicalize_target(&root, Path::new(&path));
            let (status, reason, current_hash, size) = match result {
                Err(error) => ("missing", Some(error), None, None),
                Ok(target) => match fs::metadata(&target) {
                    Err(error) => ("missing", Some(error.to_string()), None, None),
                    Ok(metadata) => {
                        let size = (!metadata.is_dir()).then_some(metadata.len() as i64);
                        if let Some(expected_size) = expected_size {
                            if size != Some(expected_size) {
                                return Ok(ContextAttachmentValidation {
                                    id,
                                    path,
                                    status: "changed".to_owned(),
                                    reason: Some("文件大小已变化".to_owned()),
                                    current_hash: None,
                                    size,
                                });
                            }
                        }
                        let current_hash =
                            if metadata.is_file() && metadata.len() <= 10 * 1024 * 1024 {
                                let bytes = fs::read(&target)
                                    .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
                                let mut digest = Sha256::new();
                                digest.update(bytes);
                                Some(format!("sha256:{:x}", digest.finalize()))
                            } else {
                                None
                            };
                        if expected_hash.is_some() && current_hash != expected_hash {
                            (
                                "changed",
                                Some("文件内容已变化".to_owned()),
                                current_hash,
                                size,
                            )
                        } else {
                            ("ready", None, current_hash, size)
                        }
                    }
                },
            };
            Ok(ContextAttachmentValidation {
                id,
                path,
                status: status.to_owned(),
                reason,
                current_hash,
                size,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

#[tauri::command]
async fn list_turn_artifacts(
    session_id: String,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Artifact>, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let rows = sqlx::query(
        "SELECT id, schema_version, workspace_id, session_id, turn_id, source,
                media_type, size, content_hash, storage_path, created_at
         FROM artifacts
         WHERE session_id = ? AND (? IS NULL OR turn_id = ?)
         ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(Artifact {
                schema: row.try_get("schema_version")?,
                id: row.try_get("id")?,
                workspace_id: row.try_get("workspace_id")?,
                session_id: row.try_get("session_id")?,
                turn_id: row.try_get("turn_id")?,
                source: row.try_get("source")?,
                media_type: row.try_get("media_type")?,
                size: row.try_get("size")?,
                content_hash: row.try_get("content_hash")?,
                storage_path: row.try_get("storage_path")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

#[tauri::command]
async fn read_artifact(
    session_id: String,
    artifact_id: String,
    state: State<'_, AppState>,
) -> Result<ArtifactContent, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let row = sqlx::query(
        "SELECT id, schema_version, workspace_id, session_id, turn_id, source,
                media_type, size, content_hash, storage_path, created_at
         FROM artifacts WHERE id = ? AND session_id = ?",
    )
    .bind(&artifact_id)
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| CoreError::SessionNotFound(format!("artifact {artifact_id}")))?;
    let artifact = Artifact {
        schema: row.try_get("schema_version")?,
        id: row.try_get("id")?,
        workspace_id: row.try_get("workspace_id")?,
        session_id: row.try_get("session_id")?,
        turn_id: row.try_get("turn_id")?,
        source: row.try_get("source")?,
        media_type: row.try_get("media_type")?,
        size: row.try_get("size")?,
        content_hash: row.try_get("content_hash")?,
        storage_path: row.try_get("storage_path")?,
        created_at: row.try_get("created_at")?,
    };
    let Some(hash) = artifact.content_hash.strip_prefix("sha256:") else {
        return Err(CoreError::InvalidWorkspacePath(
            "artifact content hash is invalid".to_owned(),
        ));
    };
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CoreError::InvalidWorkspacePath(
            "artifact content hash is invalid".to_owned(),
        ));
    }
    const MAX_ARTIFACT_READ_BYTES: usize = 2 * 1024 * 1024;
    let path = state.data_dir.join("artifacts").join(hash);
    let bytes = fs::read(&path).map_err(|error| {
        CoreError::Initialization(format!("artifact content is unavailable: {error}"))
    })?;
    let truncated = bytes.len() > MAX_ARTIFACT_READ_BYTES;
    let content =
        String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_ARTIFACT_READ_BYTES)]).to_string();
    Ok(ArtifactContent {
        artifact,
        content,
        truncated,
    })
}

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

#[tauri::command]
async fn list_project_actions(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectAction>, CoreError> {
    workspace_by_id(&state.db, &workspace_id).await?;
    let rows = sqlx::query(
        "SELECT id, workspace_id, schema_version, name, kind, program, args_json,
                cwd, enabled, created_at, updated_at
         FROM project_actions WHERE workspace_id = ? ORDER BY enabled DESC, kind ASC, name ASC",
    )
    .bind(&workspace_id)
    .fetch_all(&state.db)
    .await?;
    rows.iter().map(project_action_from_row).collect()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn save_project_action(
    workspace_id: String,
    action_id: Option<String>,
    name: String,
    kind: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    enabled: Option<bool>,
    state: State<'_, AppState>,
) -> Result<ProjectAction, CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
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
            .fetch_optional(&state.db)
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
    .execute(&state.db)
    .await?;
    project_action_by_id(&state.db, &workspace_id, &id).await
}

#[tauri::command]
async fn delete_project_action(
    workspace_id: String,
    action_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    workspace_by_id(&state.db, &workspace_id).await?;
    sqlx::query("DELETE FROM project_actions WHERE id = ? AND workspace_id = ?")
        .bind(action_id)
        .bind(workspace_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

async fn read_process_output<R: tokio::io::AsyncRead + Unpin>(reader: R) -> Vec<u8> {
    const MAX: usize = 1024 * 1024 + 1;
    let mut bytes = Vec::new();
    let mut reader = reader;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        if bytes.len() < MAX {
            let remaining = MAX - bytes.len();
            bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
    }
    bytes
}

#[tauri::command]
async fn run_project_action(
    workspace_id: String,
    action_id: String,
    session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<ProjectActionRun, CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let action = project_action_by_id(&state.db, &workspace_id, &action_id).await?;
    if !action.enabled {
        return Err(CoreError::InvalidWorkspacePath(
            "project action is disabled".to_owned(),
        ));
    }
    if let Some(session_id) = session_id.as_deref() {
        let session = session_by_id(&state.db, session_id).await?;
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
    let stdout_task = tauri::async_runtime::spawn(read_process_output(stdout));
    let stderr_task = tauri::async_runtime::spawn(read_process_output(stderr));
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
            let _ = child.kill().await;
            // Reap the process before collecting its pipes. This keeps a
            // timed-out project action from surviving its audit record or
            // holding the workspace command open after the UI reports timeout.
            let _ = child.wait().await;
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
            &state.db,
            &state.data_dir,
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
    .execute(&state.db)
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

#[tauri::command]
async fn list_project_action_runs(
    workspace_id: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectActionRun>, CoreError> {
    workspace_by_id(&state.db, &workspace_id).await?;
    let limit = limit.unwrap_or(10).clamp(1, 50);
    let rows = sqlx::query(
        "SELECT id, schema_version, action_id, workspace_id, session_id, status,
                exit_code, output, artifact_id, started_at, completed_at
         FROM project_action_runs WHERE workspace_id = ?
         ORDER BY completed_at DESC LIMIT ?",
    )
    .bind(&workspace_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    rows.iter().map(project_action_run_from_row).collect()
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
async fn clear_pi_queue(session_id: String, state: State<'_, AppState>) -> Result<(), CoreError> {
    state.pi.clear_queue(&session_id).await.map_err(Into::into)
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
            "queue-management",
            "read-only-tools",
            "workspace-write-gateway",
            "workspace-command-gateway",
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

const WORKSPACE_INSTRUCTION_FILES: &[&str] = &[
    "AGENTS.md",
    "CLAUDE.md",
    "CODEX.md",
    ".aibo/instructions.md",
    ".codex/AGENTS.md",
    ".codex/instructions.md",
    ".pi/AGENTS.md",
    ".pi/instructions.md",
];

const WORKSPACE_SKILL_DIRECTORIES: &[&str] = &[".aibo/skills", ".codex/skills", ".pi/skills"];

const WORKSPACE_MCP_CONFIGS: &[&str] = &[
    ".mcp.json",
    ".aibo/mcp.json",
    ".codex/mcp.json",
    ".pi/mcp.json",
];

fn capability_entry(name: impl Into<String>, source: impl Into<String>) -> CapabilityEntry {
    CapabilityEntry {
        name: name.into(),
        source: source.into(),
    }
}

fn collect_workspace_capabilities(root: &Path) -> WorkspaceCapabilityInventory {
    let mut instructions = Vec::new();
    for relative in WORKSPACE_INSTRUCTION_FILES {
        let path = root.join(relative);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        instructions.push(capability_entry(*relative, "workspace"));
    }

    let mut skills = Vec::new();
    let mut warnings = Vec::new();
    for relative_directory in WORKSPACE_SKILL_DIRECTORIES {
        let directory = root.join(relative_directory);
        let metadata = match fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                warnings.push(format!("无法读取技能目录 {relative_directory}: {error}"));
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(format!("无法读取技能目录 {relative_directory}: {error}"));
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(ToOwned::to_owned) else {
                continue;
            };
            let source = format!("{relative_directory}/{name}");
            skills.push(capability_entry(name, source));
        }
    }
    skills.sort_by(|left, right| left.source.cmp(&right.source));

    let mut mcp_servers = Vec::new();
    for relative in WORKSPACE_MCP_CONFIGS {
        let path = root.join(relative);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                warnings.push(format!("无法读取 MCP 配置 {relative}: {error}"));
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                warnings.push(format!("无法读取 MCP 配置 {relative}: {error}"));
                continue;
            }
        };
        let value: serde_json::Value = match serde_json::from_str(&contents) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(format!("MCP 配置 {relative} 不是有效 JSON: {error}"));
                continue;
            }
        };
        let Some(servers) = value
            .get("mcpServers")
            .or_else(|| value.get("servers"))
            .and_then(serde_json::Value::as_object)
        else {
            warnings.push(format!("MCP 配置 {relative} 缺少 mcpServers/servers"));
            continue;
        };
        for name in servers.keys() {
            mcp_servers.push(capability_entry(name.clone(), *relative));
        }
    }
    mcp_servers.sort_by(|left, right| left.name.cmp(&right.name));

    let tools = [
        ("workspace-read", "aibo-core"),
        ("workspace-search", "aibo-core"),
        ("artifact-store", "aibo-core"),
        ("checkpoint-restore", "aibo-core"),
        ("project-actions", "aibo-core"),
    ]
    .into_iter()
    .map(|(name, source)| capability_entry(name, source))
    .collect();

    WorkspaceCapabilityInventory {
        workspace_id: String::new(),
        inspected_at: now_iso(),
        instructions,
        skills,
        tools,
        mcp_servers,
        warnings,
    }
}

#[tauri::command]
async fn inspect_workspace_capabilities(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceCapabilityInventory, CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    let root = fs::canonicalize(&workspace.path)
        .map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let mut inventory = collect_workspace_capabilities(&root);
    inventory.workspace_id = workspace_id;
    Ok(inventory)
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
            tauri::async_runtime::block_on(recover_interrupted_turn_changes(&db)).map_err(
                |error| {
                    Box::new(CoreError::Initialization(format!(
                        "recover interrupted turn changes: {error}"
                    ))) as Box<dyn Error>
                },
            )?;
            tauri::async_runtime::block_on(recover_interrupted_sessions(&db)).map_err(|error| {
                Box::new(CoreError::Initialization(format!(
                    "recover interrupted sessions: {error}"
                ))) as Box<dyn Error>
            })?;
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
            open_workspace_location,
            probe_agents,
            inspect_workspace_capabilities,
            get_app_snapshot,
            resolve_execution_profile,
            get_session_execution_profile,
            list_sessions,
            get_timeline,
            get_turn_change_set,
            list_turn_checkpoints,
            list_restore_operations,
            restore_turn_change_set,
            get_workspace_changes,
            get_turn_file_diff,
            apply_git_hunk_action,
            apply_git_file_action,
            register_session_attachments,
            list_session_attachments,
            remove_session_attachment,
            bind_session_attachments,
            validate_session_attachments,
            list_turn_artifacts,
            read_artifact,
            list_project_actions,
            save_project_action,
            delete_project_action,
            run_project_action,
            list_project_action_runs,
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
            clear_pi_queue,
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
        canonical_workspace_path, clone_cached_runtime, collect_workspace_capabilities,
        find_executable, mark_turn_interrupted, normalize_session_filter, now_iso, open_database,
        persist_restore_operation, recover_interrupted_sessions, recover_interrupted_turn_changes,
        remove_cached_runtime, require_trusted_workspace, session_execution_profile,
        workspace_label, CoreError, SessionListFilter, Workspace,
    };
    use crate::change_set::{
        capture as capture_workspace, persist_baseline_checkpoint, persist_checkpoint_metadata,
        RestoreReport,
    };
    use crate::execution_profile;
    use sqlx::Row;
    use std::{collections::HashMap, fs, path::PathBuf, sync::Arc, time::Duration};
    use tokio::io::AsyncWriteExt;
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
    fn bounded_process_output_drains_large_pipes() {
        tauri::async_runtime::block_on(async {
            let (mut writer, reader) = tokio::io::duplex(8 * 1024);
            let writer_task = tokio::spawn(async move {
                let payload = vec![b'x'; 2 * 1024 * 1024];
                writer.write_all(&payload).await.expect("write output");
            });
            let output =
                tokio::time::timeout(Duration::from_secs(2), super::read_process_output(reader))
                    .await
                    .expect("reader should drain the pipe");
            writer_task.await.expect("writer task");
            assert_eq!(output.len(), 1024 * 1024 + 1);
        });
    }

    #[test]
    fn unified_diff_uses_turn_baseline_instead_of_head() {
        let diff = super::run_unified_text_diff(
            "src/main.rs",
            b"fn main() {\n  old();\n}\n",
            b"fn main() {\n  new();\n}\n",
        )
        .expect("unified diff");
        assert!(diff.contains("a/src/main.rs"));
        assert!(diff.contains("b/src/main.rs"));
        assert!(diff.contains("-  old();"));
        assert!(diff.contains("+  new();"));
        let hunks = super::parse_unified_hunks(&diff);
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].header.starts_with("@@ "));
        assert!(hunks[0].content.contains("+  new();"));
        let patch = super::select_unified_hunk(&diff, 0).expect("select hunk patch");
        assert!(patch.starts_with("--- a/src/main.rs\n+++ b/src/main.rs\n@@ "));
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
    fn startup_recovery_marks_stale_runtime_state_interrupted() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let directory_path = directory.to_string_lossy().to_string();
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'workspace', 1, ?, ?)",
            )
            .bind(&directory_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            for (id, state, archived) in [
                ("running", "running", 0_i64),
                ("waiting", "waiting_approval", 0),
                ("archived", "running", 1),
            ] {
                sqlx::query(
                    "INSERT INTO sessions (id, workspace_id, agent, label, state, archived, created_at, updated_at)
                     VALUES (?, 'workspace', 'pi', ?, ?, ?, ?, ?)",
                )
                .bind(id)
                .bind(id)
                .bind(state)
                .bind(archived)
                .bind(&now)
                .bind(&now)
                .execute(&pool)
                .await
                .expect("session");
            }
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, started_at)
                 VALUES ('turn', 'running', 'external-turn', 'running', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn");
            sqlx::query(
                "INSERT INTO messages (id, session_id, role, content, status, created_at, updated_at)
                 VALUES ('message', 'running', 'assistant', '', 'streaming', ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("message");
            sqlx::query(
                "INSERT INTO messages (id, session_id, role, content, status, created_at, updated_at)
                 VALUES ('queued-message', 'running', 'user', 'pending', 'queued', ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("queued message");
            sqlx::query(
                "INSERT INTO process_runs (id, session_id, agent, generation_id, state, started_at)
                 VALUES ('process', 'running', 'pi', 'generation', 'running', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("process run");
            let recovered = recover_interrupted_sessions(&pool).await.expect("recovery");
            assert_eq!(recovered, 2);
            let state: String =
                sqlx::query_scalar("SELECT state FROM sessions WHERE id = 'running'")
                    .fetch_one(&pool)
                    .await
                    .expect("running state");
            assert_eq!(state, "interrupted");
            let turn_state: String =
                sqlx::query_scalar("SELECT status FROM turns WHERE id = 'turn'")
                    .fetch_one(&pool)
                    .await
                    .expect("turn state");
            assert_eq!(turn_state, "interrupted");
            let message_state: String =
                sqlx::query_scalar("SELECT status FROM messages WHERE id = 'message'")
                    .fetch_one(&pool)
                    .await
                    .expect("message state");
            assert_eq!(message_state, "failed");
            let queued_state: String =
                sqlx::query_scalar("SELECT status FROM messages WHERE id = 'queued-message'")
                    .fetch_one(&pool)
                    .await
                    .expect("queued message state");
            assert_eq!(queued_state, "failed");
            let process_state: String =
                sqlx::query_scalar("SELECT state FROM process_runs WHERE id = 'process'")
                    .fetch_one(&pool)
                    .await
                    .expect("process state");
            assert_eq!(process_state, "crashed");
            let archived_state: String =
                sqlx::query_scalar("SELECT state FROM sessions WHERE id = 'archived'")
                    .fetch_one(&pool)
                    .await
                    .expect("archived state");
            assert_eq!(archived_state, "running");
            pool.close().await;
            let _ = fs::remove_file(&database_path);
            let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
            fs::remove_dir_all(directory).expect("cleanup");
        });
    }

    #[test]
    fn in_process_adapter_crash_marks_active_turn_and_messages_interrupted() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let workspace_path = directory.to_string_lossy().to_string();
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'workspace', 1, ?, ?)",
            )
            .bind(&workspace_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            sqlx::query(
                "INSERT INTO sessions (id, workspace_id, agent, label, state, archived, created_at, updated_at)
                 VALUES ('session', 'workspace', 'pi', 'session', 'running', 0, ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("session");
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, started_at)
                 VALUES ('turn', 'session', 'external-turn', 'running', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn");
            for (id, role, status) in [
                ("assistant", "assistant", "streaming"),
                ("queued", "user", "queued"),
            ] {
                sqlx::query(
                    "INSERT INTO messages (id, session_id, turn_id, role, content, status, created_at, updated_at)
                     VALUES (?, 'session', 'turn', ?, '', ?, ?, ?)",
                )
                .bind(id)
                .bind(role)
                .bind(status)
                .bind(&now)
                .bind(&now)
                .execute(&pool)
                .await
                .expect("message");
            }

            mark_turn_interrupted(&pool, "session", "turn")
                .await
                .expect("mark interrupted");
            let turn_status: String =
                sqlx::query_scalar("SELECT status FROM turns WHERE id = 'turn'")
                    .fetch_one(&pool)
                    .await
                    .expect("turn status");
            assert_eq!(turn_status, "interrupted");
            let remaining_active: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM messages WHERE session_id = 'session' AND status IN ('streaming', 'queued')",
            )
            .fetch_one(&pool)
            .await
            .expect("message statuses");
            assert_eq!(remaining_active, 0);
            pool.close().await;
            let _ = fs::remove_file(&database_path);
            let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
            fs::remove_dir_all(directory).expect("cleanup");
        });
    }

    #[test]
    fn startup_recovery_rebuilds_interrupted_turn_change_set_from_checkpoint() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let workspace_root = directory.join("workspace");
            fs::create_dir_all(&workspace_root).expect("workspace directory");
            let workspace_path = workspace_root.to_string_lossy().to_string();
            fs::write(workspace_root.join("notes.txt"), "before").expect("baseline file");
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'workspace', 1, ?, ?)",
            )
            .bind(&workspace_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            sqlx::query(
                "INSERT INTO sessions (id, workspace_id, agent, label, state, archived, created_at, updated_at)
                 VALUES ('session', 'workspace', 'pi', 'session', 'running', 0, ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("session");
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, input_text, started_at)
                 VALUES ('turn', 'session', 'external-turn', 'running', 'update notes', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn");

            let baseline = capture_workspace(&workspace_root)
                .await
                .expect("baseline snapshot");
            let checkpoint_root = directory.join("app-data").join("checkpoints");
            persist_baseline_checkpoint(
                &checkpoint_root,
                "session",
                "turn",
                &workspace_root,
                &baseline,
            )
            .await
            .expect("checkpoint bytes");
            persist_checkpoint_metadata(
                &pool,
                &checkpoint_root,
                "workspace",
                "session",
                "turn",
                &baseline,
            )
            .await
            .expect("checkpoint metadata");
            fs::write(workspace_root.join("notes.txt"), "agent result").expect("result file");
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, input_text, started_at)
                 VALUES ('turn-missing-checkpoint', 'session', 'external-turn-2', 'running', 'no checkpoint', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn without checkpoint");

            let recovered = recover_interrupted_turn_changes(&pool)
                .await
                .expect("reconstruct change set");
            assert_eq!(recovered, 2);
            let attribution: String = sqlx::query_scalar(
                "SELECT attribution FROM turn_change_sets WHERE session_id = 'session' AND turn_id = 'turn'",
            )
            .fetch_one(&pool)
            .await
            .expect("attribution");
            assert_eq!(attribution, "unknown");
            let capture_error: String = sqlx::query_scalar(
                "SELECT capture_error FROM turn_change_sets WHERE session_id = 'session' AND turn_id = 'turn'",
            )
            .fetch_one(&pool)
            .await
            .expect("capture error");
            assert!(capture_error.contains("重启后重建"));
            let changed_path: String = sqlx::query_scalar(
                "SELECT path FROM file_changes WHERE change_set_id = (SELECT id FROM turn_change_sets WHERE turn_id = 'turn')",
            )
            .fetch_one(&pool)
            .await
            .expect("file change");
            assert_eq!(changed_path, "notes.txt");
            let missing_checkpoint_error: String = sqlx::query_scalar(
                "SELECT capture_error FROM turn_change_sets WHERE session_id = 'session' AND turn_id = 'turn-missing-checkpoint'",
            )
            .fetch_one(&pool)
            .await
            .expect("missing checkpoint error");
            assert!(missing_checkpoint_error.contains("checkpoint 未持久化"));

            recover_interrupted_sessions(&pool)
                .await
                .expect("runtime recovery");
            let turn_state: String =
                sqlx::query_scalar("SELECT status FROM turns WHERE id = 'turn'")
                    .fetch_one(&pool)
                    .await
                    .expect("turn state");
            assert_eq!(turn_state, "interrupted");
            pool.close().await;
            let _ = fs::remove_file(&database_path);
            let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
            fs::remove_dir_all(directory).expect("cleanup");
        });
    }

    #[test]
    fn persists_restore_operation_as_versioned_audit() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let workspace_path = directory.to_string_lossy().to_string();
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'workspace', 1, ?, ?)",
            )
            .bind(&workspace_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            sqlx::query(
                "INSERT INTO sessions (id, workspace_id, agent, label, state, archived, created_at, updated_at)
                 VALUES ('session', 'workspace', 'codex', 'session', 'idle', 0, ?, ?)",
            )
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("session");
            sqlx::query(
                "INSERT INTO turns (id, session_id, external_turn_id, status, started_at)
                 VALUES ('turn', 'session', 'external-turn', 'completed', ?)",
            )
            .bind(&now)
            .execute(&pool)
            .await
            .expect("turn");

            let report = RestoreReport {
                applied: true,
                restored: vec!["src/main.rs".to_owned()],
                ..RestoreReport::default()
            };
            let operation =
                persist_restore_operation(&pool, "workspace", "session", "turn", &report, None)
                    .await
                    .expect("restore operation");
            assert_eq!(operation.schema, "aibo.restore-operation/v1");
            assert_eq!(operation.status, "completed");
            assert_eq!(operation.restored, vec!["src/main.rs"]);
            let row = sqlx::query(
                "SELECT schema_version, status, restored_json FROM restore_operations WHERE id = ?",
            )
            .bind(&operation.id)
            .fetch_one(&pool)
            .await
            .expect("audit row");
            assert_eq!(row.get::<String, _>("schema_version"), operation.schema);
            assert_eq!(row.get::<String, _>("status"), "completed");
            assert_eq!(row.get::<String, _>("restored_json"), "[\"src/main.rs\"]");
            pool.close().await;
            let _ = fs::remove_file(&database_path);
            let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
            fs::remove_dir_all(directory).expect("cleanup");
        });
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
            "attachments",
            "artifacts",
            "project_actions",
            "project_action_runs",
            "checkpoints",
            "restore_operations",
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
            ("attachments", "content_hash"),
            ("attachments", "send_strategy"),
            ("attachments", "schema_version"),
            ("artifacts", "content_hash"),
            ("artifacts", "storage_path"),
            ("file_changes", "baseline_dirty"),
            ("file_changes", "previous_path"),
            ("project_actions", "args_json"),
            ("project_action_runs", "status"),
            ("checkpoints", "storage_path"),
            ("checkpoints", "baseline_head"),
            ("checkpoints", "baseline_dirty"),
            ("restore_operations", "status"),
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

    #[test]
    fn workspace_capability_inventory_lists_safe_resource_names() {
        let directory = test_directory();
        fs::write(directory.join("AGENTS.md"), "instructions").expect("instruction file");
        fs::create_dir_all(directory.join(".codex/skills/review")).expect("skill directory");
        fs::write(
            directory.join(".mcp.json"),
            r#"{"mcpServers":{"filesystem":{"command":"node"},"search":{"url":"https://example.invalid"}}}"#,
        )
        .expect("MCP config");

        let inventory = collect_workspace_capabilities(&directory);
        assert_eq!(
            inventory
                .instructions
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["AGENTS.md"]
        );
        assert_eq!(inventory.skills[0].name, "review");
        assert_eq!(inventory.skills[0].source, ".codex/skills/review");
        assert_eq!(
            inventory
                .mcp_servers
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["filesystem", "search"]
        );
        assert!(inventory
            .tools
            .iter()
            .any(|entry| entry.name == "checkpoint-restore"));
        assert!(inventory.warnings.is_empty());
        fs::remove_dir_all(directory).expect("cleanup");
    }
}
