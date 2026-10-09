mod session_attachments;
mod session_recovery;
mod text_diff;
mod workspace_diff;
mod turn_changes;
mod node_runtime;
mod app_storage;
mod session_history_tools;
mod session_reference_preferences;
mod agent_settings;
mod workspace_preferences;
mod host_confirmation;
mod ui_i18n;
mod project_actions;
mod controlled_process;
mod workspace_git;
mod git_repositories;
mod core_turn_git;
mod turn_restore;
mod execution_history;
mod session_history;
mod global_search;
mod database_migrations;
mod search_files;
mod text_preview;
mod file_preview;
mod search_assets;
#[cfg(test)]
mod session_activity_tests;
mod session_context;
mod clipboard_images;
mod capability_history;
mod workspace_git_approval;
mod workspace_writes;
mod workspace_write_runs;
mod artifact;
mod change_set;
mod execution_profile;
mod session_controls;
mod session_permissions;
mod session_models;
mod plugin_runtime;
mod plugin_sdk;
mod plugin_contract;
mod plugin_manifest;
mod plugin_authentication;
mod session_contract;
mod session_host;
mod plugin_dependencies;
mod capability_broker;
mod plugin_registry;
mod presentation_packages;
mod plugin_storage;
mod plugin_lifecycle;
mod plugin_replacement;
mod session_rebuild;
mod workspace_guard;
mod semantic_git;
mod semantic_plugins;
mod tool_views;
mod git_capability_guard;

// Preserve the existing serialized types at the crate root while their
// implementation and invariants live with the owning business modules.
pub use session_attachments::{ContextAttachment, ContextAttachmentValidation};
pub use text_diff::TurnDiffHunk;
pub use turn_changes::{
    ChangeSetState, CheckpointFile, CommandRunRef, FileChange, RestoreOperation,
    TurnChangeSet, TurnFileDiff, VerificationRef,
};
pub use workspace_diff::WorkspaceFileDiff;

use change_set::{checkpoint_file_path, workspace_changes};
use workspace_diff::workspace_file_diff;
use execution_profile::{
    from_row as profile_from_row, resolve as resolve_profile,
    save_for_session as save_session_profile, ExecutionProfile, ResolvedExecutionProfile,
    SessionExecutionProfile,
};
use serde::{Serialize, Deserialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Connection, Row, SqlitePool,
};
use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::{Manager, State};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tokio::{io::AsyncReadExt, process::Command as TokioCommand};
use tracing::{info, warn};
use ulid::Ulid;

const PI_SDK_VERSION: &str = "0.84.4";
const SESSION_AUTO_LABEL_MAX_CHARS: usize = 40;
pub(crate) const DEFAULT_CAPABILITY_SESSION_LABEL: &str = "Session";
const CONTEXT_ATTACHMENTS_MARKER: &str = "\n\n[AIBO_CONTEXT_ATTACHMENTS]";

#[derive(Clone)]
pub struct AppState {
    db: SqlitePool,
    plugins: session_host::SessionHost,
    semantic_git: semantic_git::GitPresentation,
    semantic_plugins: semantic_plugins::SemanticPlugins,
    capability_broker: capability_broker::Broker,
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
pub struct WorkspacePathSuggestion {
    path: String,
    is_directory: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    localized_message: Option<serde_json::Value>,
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    localized_warnings: Vec<serde_json::Value>,
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
    pub(crate) history_only: bool,
    pub(crate) external_session_id: Option<String>,
    pub(crate) plugin_installation_id: Option<String>,
    pub(crate) capabilities: Vec<String>,
    pub(crate) created_at: String,
    // Navigation activity time; sessions.updated_at remains the maintenance clock.
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComposerDraft {
    pub(crate) schema_version: String,
    pub(crate) session_id: String,
    pub(crate) text: String,
    pub(crate) send_failed: bool,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionReasoningOption {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionServiceTierOption {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionContextWindowOption {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) description: Option<String>,
    pub(crate) tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionModelOption {
    pub(crate) reference: String,
    pub(crate) label: String,
    pub(crate) provider: Option<String>,
    pub(crate) id: String,
    pub(crate) description: Option<String>,
    pub(crate) is_default: bool,
    pub(crate) default_reasoning_effort: Option<String>,
    pub(crate) reasoning_efforts: Vec<SessionReasoningOption>,
    pub(crate) service_tiers: Vec<SessionServiceTierOption>,
    pub(crate) context_windows: Vec<SessionContextWindowOption>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionModelCatalog {
    pub(crate) parameter_scope: String,
    pub(crate) current: Option<SessionModelOption>,
    pub(crate) models: Vec<SessionModelOption>,
    pub(crate) current_reasoning_effort: Option<String>,
    pub(crate) reasoning_efforts: Vec<SessionReasoningOption>,
    pub(crate) current_service_tier: Option<String>,
    pub(crate) current_context_window: Option<String>,
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
    pub(crate) entry_type: Option<String>,
    pub(crate) content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_activity: Option<serde_json::Value>,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTurnChangeSetResult {
    pub(crate) applied: bool,
    pub(crate) restored: Vec<String>,
    pub(crate) conflicts: Vec<String>,
    pub(crate) unsupported: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) localized_conflicts: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) localized_unsupported: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChange {
    pub(crate) staged_stats: Option<change_set::GitLineStats>,
    pub(crate) unstaged_stats: Option<change_set::GitLineStats>,
    pub(crate) path: String,
    pub(crate) previous_path: Option<String>,
    pub(crate) kind: String,
    pub(crate) staged: bool,
    pub(crate) unstaged: bool,
    pub(crate) untracked: bool,
    pub(crate) conflicted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChanges {
    pub(crate) workspace_id: String,
    pub(crate) head: Option<String>,
    pub(crate) branch: Option<String>,
    pub(crate) dirty: bool,
    pub(crate) captured_at: String,
    pub(crate) files: Vec<WorkspaceFileChange>,
    pub(crate) capture_status: String,
    pub(crate) capture_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_capture_error: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub(crate) name: String,
    pub(crate) current: bool,
    pub(crate) commit: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub(crate) hash: String,
    pub(crate) short_hash: String,
    pub(crate) subject: String,
    pub(crate) author: String,
    pub(crate) authored_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    pub(crate) path: String,
    pub(crate) previous_path: Option<String>,
    pub(crate) kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileList {
    pub(crate) commit: String,
    pub(crate) files: Vec<GitCommitFile>,
    pub(crate) total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteStatus {
    pub(crate) branch: Option<String>,
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: u32,
    pub(crate) behind: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub(crate) reference: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileActionResult {
    pub(crate) path: String,
    pub(crate) action: String,
    pub(crate) applied: bool,
    pub(crate) message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) localized_message: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceActionResult {
    pub(crate) action: String,
    pub(crate) applied: bool,
    pub(crate) message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) localized_message: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub(crate) committed: bool,
    pub(crate) hash: Option<String>,
    pub(crate) message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) localized_message: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunkActionResult {
    pub(crate) path: String,
    pub(crate) hunk_index: i64,
    pub(crate) action: String,
    pub(crate) applied: bool,
    pub(crate) message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) localized_message: Option<serde_json::Value>,
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
    pub(crate) action_name: Option<String>,
    pub(crate) workspace_id: String,
    pub(crate) session_id: Option<String>,
    pub(crate) status: String,
    pub(crate) exit_code: Option<i64>,
    pub(crate) output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_output: Option<serde_json::Value>,
    pub(crate) artifact_id: Option<String>,
    pub(crate) started_at: String,
    pub(crate) completed_at: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("invalid workspace path: {0}")]
    InvalidWorkspacePath(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("workspace trust is required for the requested execution profile")]
    WorkspaceTrustRequired,
    #[error("workspace has an unfinished write; wait for it to settle before submitting another operation")]
    WorkspaceWriteBusy,
    #[error("写入结果未知，请核对实际更改后再操作：{0}")]
    WriteOutcomeUnknown(String),
    #[error("{message}")]
    WriteReplay { code: String, message: String },
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("session must be idle before its execution profile can change")]
    SessionBusy,
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
    #[error("session operation failed: {0}")]
    SessionOperation(String),
    /// Display metadata for an explicit host-owned read diagnostic.
    #[error("{message}")]
    ReadDiagnostic { message: String, localized: serde_json::Value },
    /// Display metadata wraps an existing diagnostic without changing its code or text.
    #[error("{error}")]
    Localized { error: Box<CoreError>, localized: serde_json::Value },
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
            code: &'a str,
            message: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            localized: Option<serde_json::Value>,
        }

        let code = match self {
            Self::InvalidWorkspacePath(_) => "invalid_workspace_path",
            Self::WorkspaceNotFound(_) => "workspace_not_found",
            Self::WorkspaceTrustRequired => "workspace_trust_required",
            Self::WorkspaceWriteBusy => "workspace_write_busy",
            Self::WriteOutcomeUnknown(_) => "outcome_unknown",
            Self::WriteReplay { code, .. } => code.as_str(),
            Self::Localized { error, localized } => {
                let mut payload = serde_json::to_value(error).map_err(serde::ser::Error::custom)?;
                payload["localized"] = localized.clone();
                return payload.serialize(serializer);
            },
            Self::SessionNotFound(_) => "session_not_found",
            Self::SessionBusy => "session_busy",
            Self::InvalidSessionLabel(_) => "invalid_session_label",
            Self::InvalidSessionFilter(_) => "invalid_session_filter",
            Self::InvalidExecutionProfile(_) => "invalid_execution_profile",
            Self::Database(_) => "database_error",
            Self::AgentProbe(_) => "agent_probe_error",
            Self::SessionOperation(_) => "session_operation_error",
            Self::ReadDiagnostic { .. } => "session_operation_error",
            Self::Initialization(_) => "initialization_error",
        };
        ErrorPayload {
            code,
            message: &self.to_string(),
            localized: match self {
                Self::ReadDiagnostic { localized, .. } => Some(localized.clone()),
                _ => ui_i18n::core_error_localization(self,code),
            },
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

fn session_label_from_first_message(input: &str) -> Option<String> {
    let visible_input = input
        .split_once(CONTEXT_ATTACHMENTS_MARKER)
        .map(|(message, _)| message)
        .unwrap_or(input);
    let normalized = visible_input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        return None;
    }
    if normalized.chars().count() <= SESSION_AUTO_LABEL_MAX_CHARS {
        return Some(normalized);
    }
    let mut truncated = normalized
        .chars()
        .take(SESSION_AUTO_LABEL_MAX_CHARS - 1)
        .collect::<String>();
    truncated.push('…');
    Some(truncated)
}

pub(crate) async fn auto_name_session_from_first_message(
    db: &SqlitePool,
    session_id: &str,
    user_message_id: &str,
    input: &str,
) -> Result<bool, sqlx::Error> {
    let Some(label) = session_label_from_first_message(input) else {
        return Ok(false);
    };
    let Some(row) = sqlx::query(
        "SELECT s.agent, s.label, s.plugin_installation_id, w.label AS workspace_label
         FROM sessions s
         JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.id = ?",
    )
    .bind(session_id)
    .fetch_optional(db)
    .await?
    else {
        return Ok(false);
    };
    let agent: String = row.try_get("agent")?;
    let current_label: String = row.try_get("label")?;
    let plugin_installation_id: Option<String> = row.try_get("plugin_installation_id")?;
    let workspace_label: String = row.try_get("workspace_label")?;
    let default_label = match agent.as_str() {
        _ if plugin_installation_id.is_some() && current_label == DEFAULT_CAPABILITY_SESSION_LABEL => DEFAULT_CAPABILITY_SESSION_LABEL.to_owned(),
        "codex" => format!("Codex · {workspace_label}"),
        "pi" => format!("Pi · {workspace_label}"),
        _ if plugin_installation_id.is_some() => "Plugin session".to_owned(),
        _ => return Ok(false),
    };
    if current_label != default_label {
        return Ok(false);
    }

    let updated = sqlx::query(
        "UPDATE sessions SET label = ?, updated_at = ?
         WHERE id = ? AND label = ?
           AND NOT EXISTS (
             SELECT 1 FROM messages
             WHERE session_id = ? AND role = 'user' AND id <> ?
           )",
    )
    .bind(&label)
    .bind(now_iso())
    .bind(session_id)
    .bind(default_label)
    .bind(session_id)
    .bind(user_message_id)
    .execute(db)
    .await?;
    Ok(updated.rows_affected() == 1)
}

#[tauri::command]
async fn get_composer_draft(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Option<ComposerDraft>, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    let row = sqlx::query(
        "SELECT schema_version, session_id, text, send_failed, updated_at
         FROM composer_drafts WHERE session_id = ?",
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| CoreError::Database(error.to_string()))?;
    Ok(row.map(|row| ComposerDraft {
        schema_version: row.get("schema_version"),
        session_id: row.get("session_id"),
        text: row.get("text"),
        send_failed: row.get::<i64, _>("send_failed") != 0,
        updated_at: row.get("updated_at"),
    }))
}

#[tauri::command]
async fn save_composer_draft(
    session_id: String,
    text: String,
    send_failed: bool,
    state: State<'_, AppState>,
) -> Result<Option<ComposerDraft>, CoreError> {
    session_by_id(&state.db, &session_id).await?;
    if text.chars().count() > 100_000 {
        return Err(CoreError::Database(
            "composer draft exceeds 100000 characters".to_owned(),
        ));
    }
    if text.trim().is_empty() {
        sqlx::query("DELETE FROM composer_drafts WHERE session_id = ?")
            .bind(&session_id)
            .execute(&state.db)
            .await
            .map_err(|error| CoreError::Database(error.to_string()))?;
        return Ok(None);
    }
    let updated_at = now_iso();
    sqlx::query(
        "INSERT INTO composer_drafts
           (session_id, schema_version, text, send_failed, updated_at)
         VALUES (?, 'aibo.composer-draft/v1', ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           schema_version = excluded.schema_version,
           text = excluded.text,
           send_failed = excluded.send_failed,
           updated_at = excluded.updated_at",
    )
    .bind(&session_id)
    .bind(&text)
    .bind(if send_failed { 1_i64 } else { 0_i64 })
    .bind(&updated_at)
    .execute(&state.db)
    .await
    .map_err(|error| CoreError::Database(error.to_string()))?;
    // Drafts are recovery hints, not an unbounded archive. Keep the most
    // recently edited 200 sessions in the desktop store; the active row is
    // always retained because it was just upserted above.
    sqlx::query(
        "DELETE FROM composer_drafts
         WHERE session_id NOT IN (
           SELECT session_id FROM composer_drafts
           ORDER BY updated_at DESC LIMIT 200
         )",
    )
    .execute(&state.db)
    .await
    .map_err(|error| CoreError::Database(error.to_string()))?;
    Ok(Some(ComposerDraft {
        schema_version: "aibo.composer-draft/v1".to_owned(),
        session_id,
        text,
        send_failed,
        updated_at,
    }))
}

async fn open_database(path: &Path) -> Result<SqlitePool, CoreError> {
    let parent = path.parent().ok_or_else(|| {
        crate::ui_i18n::initialization_message(crate::ui_i18n::HostMessage::with_diagnostic("native.database.parent",serde_json::json!({}),"database path has no parent directory"))
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        ui_i18n::initialization_message(ui_i18n::HostMessage::with_diagnostic("native.database.createDirectory",serde_json::json!({"error":error.to_string()}),format!("create app data directory: {error}")))
    })?;

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);
    // Keep migrations embedded at build time so a fresh app and an upgraded
    // local database share the same durable schema.
    // SQLite table rebuilds must not cascade-delete history. This connection is
    // never exposed to application queries; each migration remains transactional.
    let mut migration_connection = sqlx::SqliteConnection::connect_with(&options.clone().foreign_keys(false)).await?;
    database_migrations::run(&mut migration_connection).await?;
    let violations = sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut migration_connection).await?;
    if !violations.is_empty() { return Err(crate::ui_i18n::database_message(crate::ui_i18n::HostMessage::with_diagnostic("native.database.foreignKeys",serde_json::json!({}),"migration foreign key check failed"))); }
    migration_connection.close().await?;
    let pool = SqlitePoolOptions::new().max_connections(5).connect_with(options).await?;
    Ok(pool)
}

fn canonical_workspace_path(raw_path: &str) -> Result<PathBuf, CoreError> {
    let input = raw_path.trim();
    if input.is_empty() {
        return Err(ui_i18n::invalid_path_message(ui_i18n::HostMessage::with_diagnostic(
            "native.workspace.emptyPath", serde_json::json!({}), "path must not be empty")));
    }

    let path = Path::new(input);
    let canonical = fs::canonicalize(path).map_err(|error| {
        ui_i18n::invalid_path_message(ui_i18n::HostMessage::with_diagnostic("native.workspace.inaccessible", serde_json::json!({"path":input,"error":error.to_string()}), format!("{input} is not accessible: {error}")))
    })?;
    let metadata = fs::metadata(&canonical).map_err(|error| {
        ui_i18n::invalid_path_message(ui_i18n::HostMessage::with_diagnostic("native.workspace.inspectFailed", serde_json::json!({"path":input,"error":error.to_string()}), format!("cannot inspect {input}: {error}")))
    })?;
    if !metadata.is_dir() {
        return Err(ui_i18n::invalid_path_message(ui_i18n::HostMessage::with_diagnostic(
            "native.workspace.notDirectory", serde_json::json!({"path":input}), format!("{input} is not a directory"))));
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

const WORKSPACE_PATH_RESULT_LIMIT: usize = 100;

fn normalize_workspace_path_query(query: &str) -> String {
    query
        .trim()
        .trim_start_matches('@')
        .trim_start_matches("./")
        .replace('\\', "/")
        .to_lowercase()
}

fn collect_workspace_paths(
    root: &Path,
    current: &Path,
    query: &str,
    results: &mut Vec<WorkspacePathSuggestion>,
    depth: usize,
) {
    if results.len() >= WORKSPACE_PATH_RESULT_LIMIT || depth > 12 {
        return;
    }
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };
    for entry in entries.flatten() {
        if results.len() >= WORKSPACE_PATH_RESULT_LIMIT {
            break;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        let is_directory = metadata.is_dir();
        if is_directory
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| matches!(name, ".git" | ".aibo" | "node_modules" | "target"))
        {
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if query.is_empty() || relative.to_lowercase().contains(query) {
            results.push(WorkspacePathSuggestion {
                path: relative,
                is_directory,
            });
        }
        if is_directory {
            collect_workspace_paths(root, &path, query, results, depth + 1);
        }
    }
}

#[tauri::command]
async fn search_global_assets(request: global_search::Request, window: tauri::Window, state: State<'_, AppState>) -> Result<global_search::Page, CoreError> {
    search_assets::search(&state.db, &state.data_dir, window.label(), request).await
}

#[tauri::command]
async fn search_global_files(request: global_search::Request, request_id: String, window: tauri::Window, state: State<'_, AppState>) -> Result<global_search::Page, CoreError> {
    if request_id.len()>128 { return Err(ui_i18n::session_operation_message(ui_i18n::HostMessage::new("native.search.requestIdTooLong",serde_json::json!({})))); }
    search_files::search(&state.db, window.label(), &format!("{}:{request_id}",window.label()), request).await
}
#[tauri::command]
fn cancel_global_file_search(request_id: String, window: tauri::Window) { if request_id.len()<=128 {search_files::cancel(&format!("{}:{request_id}",window.label()));} }

#[tauri::command]
async fn search_global(request: global_search::Request, window: tauri::Window, state: State<'_, AppState>) -> Result<global_search::Page, CoreError> {
    global_search::search(&state.db, window.label(), request).await
}

#[tauri::command]
async fn read_search_result(target: global_search::Target, window: tauri::Window, state: State<'_, AppState>) -> Result<global_search::Detail, CoreError> {
    if target.source == "attachment" || target.source == "artifact" { return search_assets::detail(&state.db, &state.data_dir, target).await; }
    if target.source == "file" { return search_files::detail(&state.db, target).await; }
    global_search::detail(&state.db, window.label(), target).await
}

#[tauri::command]
async fn read_linked_file(session_id: String, path: String, line: Option<u32>, state: State<'_, AppState>) -> Result<file_preview::FilePreview, CoreError> {
    // Resolve ownership from the persisted session, never a caller-provided workspace root.
    let session = session_by_id(&state.db, &session_id).await?;
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    tauri::async_runtime::spawn_blocking(move || file_preview::read(std::path::Path::new(&workspace.path), std::path::Path::new(&path), line))
        .await.map_err(|error| CoreError::SessionOperation(error.to_string()))?
}

#[tauri::command]
async fn search_workspace_paths(
    workspace_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspacePathSuggestion>, CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    let root = canonical_workspace_path(&workspace.path)?;
    let normalized_query = normalize_workspace_path_query(&query);
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::with_capacity(WORKSPACE_PATH_RESULT_LIMIT);
        collect_workspace_paths(&root, &root, &normalized_query, &mut results, 0);
        results.sort_by(|left, right| {
            right
                .is_directory
                .cmp(&left.is_directory)
                .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
        });
        results
    })
    .await
    .map_err(|error| CoreError::InvalidWorkspacePath(format!("scan workspace: {error}")))
}

#[tauri::command]
async fn add_workspace(path: String, state: State<'_, AppState>) -> Result<Workspace, CoreError> {
    add_workspace_in_db(&path, &state.db).await
}

async fn add_workspace_in_db(path: &str, db: &SqlitePool) -> Result<Workspace, CoreError> {
    let canonical = canonical_workspace_path(path)?;
    let canonical_string = canonical.to_string_lossy().into_owned();
    let label = workspace_label(&canonical);
    let now = now_iso();
    let id = Ulid::new().to_string();

    sqlx::query(
        "INSERT OR IGNORE INTO workspaces
         (id, path, label, trusted, last_opened_at, created_at, updated_at)
         VALUES (?, ?, ?, (SELECT trust_new_workspaces FROM workspace_preferences WHERE id = 1), ?, ?, ?)",
    )
    .bind(&id)
    .bind(&canonical_string)
    .bind(&label)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await?;

    sqlx::query(
        "UPDATE workspaces SET label = ?, last_opened_at = ?, updated_at = ? WHERE path = ?",
    )
    .bind(&label)
    .bind(&now)
    .bind(&now)
    .bind(&canonical_string)
    .execute(db)
    .await?;

    workspace_by_path(db, &canonical_string).await
}

#[tauri::command]
async fn read_session_reference_preferences(state: State<'_, AppState>) -> Result<session_reference_preferences::SessionReferencePreferences, CoreError> {
    session_reference_preferences::read(&state.db).await
}

#[tauri::command]
async fn save_session_reference_preferences(message_limit: Option<i64>, state: State<'_, AppState>) -> Result<session_reference_preferences::SessionReferencePreferences, CoreError> {
    session_reference_preferences::save(&state.db, message_limit).await
}

#[tauri::command]
async fn read_workspace_preferences(state: State<'_, AppState>) -> Result<workspace_preferences::WorkspacePreferences, CoreError> {
    workspace_preferences::read(&state.db).await
}

#[tauri::command]
async fn save_workspace_preferences(trust_new_workspaces: bool, state: State<'_, AppState>) -> Result<workspace_preferences::WorkspacePreferences, CoreError> {
    workspace_preferences::save(&state.db, trust_new_workspaces).await
}

async fn workspace_by_path(db: &SqlitePool, path: &str) -> Result<Workspace, CoreError> {
    let row = sqlx::query(
        "SELECT id, path, label, trusted, last_opened_at, created_at, updated_at
         FROM workspaces WHERE path = ?",
    )
    .bind(path)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| crate::ui_i18n::database_message(crate::ui_i18n::HostMessage::with_diagnostic("native.database.workspaceUnreadable",serde_json::json!({}),"workspace insert was not readable")))?;
    row_to_workspace(&row)
}

#[tauri::command]
async fn set_workspace_trust(
    workspace_id: String,
    trusted: bool,
    state: State<'_, AppState>,
) -> Result<Workspace, CoreError> {
    let _guard = state.capability_broker.mutation_guard().await;
    let updated = sqlx::query("UPDATE workspaces SET permission_epoch = permission_epoch + CASE WHEN trusted != ? THEN 1 ELSE 0 END, trusted = ?, updated_at = ? WHERE id = ?")
        .bind(i64::from(trusted))
        .bind(i64::from(trusted))
        .bind(now_iso())
        .bind(&workspace_id)
        .execute(&state.db)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CoreError::WorkspaceNotFound(workspace_id));
    }
    if !trusted {
        sqlx::query("DELETE FROM session_permission_grants WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id=?)")
            .bind(&workspace_id).execute(&state.db).await?;
    }
    if !trusted { state.capability_broker.stop_workspace(&workspace_id).await.map_err(|error|CoreError::Initialization(error.message))?; }
    workspace_by_id(&state.db, &workspace_id).await
}

#[tauri::command]
async fn remove_workspace(
    app: tauri::AppHandle,
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    let _guard = state.capability_broker.mutation_guard().await;
    if !tool_views::close_matching(&app,None,Some(&workspace_id),None,None,true).await.map_err(CoreError::SessionOperation)? { return Err(CoreError::SessionOperation("cancelled".into())); }
    state.capability_broker.stop_workspace(&workspace_id).await.map_err(|error|ui_i18n::session_operation_message(error.into_host_message()))?;
    state
        .plugins
        .close_workspace(&workspace_id)
        .await
        .map_err(CoreError::SessionOperation)?;
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
        return Err(ui_i18n::invalid_path_message(ui_i18n::HostMessage::with_diagnostic("native.workspace.locationTarget",serde_json::json!({}),"unsupported workspace location target")));
    }
    let configured_editor = env::var("AIBO_EDITOR")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    #[cfg(target_os = "macos")]
    let mut process = {
        if target == "editor" {
            let editor = configured_editor.as_deref().ok_or_else(|| {
                ui_i18n::initialization_message(ui_i18n::HostMessage::new("native.workspace.editorMac",serde_json::json!({})))
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
                ui_i18n::initialization_message(ui_i18n::HostMessage::new("native.workspace.editorWindows",serde_json::json!({})))
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
                ui_i18n::initialization_message(ui_i18n::HostMessage::new("native.workspace.editorUnix",serde_json::json!({})))
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
        ui_i18n::initialization_message(ui_i18n::HostMessage::with_diagnostic("native.workspace.openLocation",serde_json::json!({"target":target,"error":error.to_string()}),format!("open workspace in {target}: {error}")))
    })?;
    Ok(())
}

fn row_to_session(row: &sqlx::sqlite::SqliteRow) -> Result<Session, CoreError> {
    let mut capabilities = row.try_get::<Option<String>, _>("plugin_capabilities_json")?
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default();
    let manifest = row.try_get::<Option<String>, _>("queue_manifest_json")?
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let binding = row.try_get::<Option<String>, _>("plugin_binding_json")?
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let contribution: String = row.try_get("agent")?;
    let (queue, steering) = match (manifest, binding) {
        (Some(manifest), Some(binding)) if session_contract::binding_schema().is_valid(&binding) =>
            session_contract::queue_capabilities(&manifest, &contribution, &capabilities),
        _ => (false, false),
    };
    // These UI capabilities are host projections, not provider negotiation data.
    capabilities.retain(|capability| capability != "queue.manage" && capability != "queue.steer");
    if queue { capabilities.push("queue.manage".into()); }
    if steering { capabilities.push("queue.steer".into()); }
    let history_only=row.try_get::<i64,_>("history_only")?!=0;
    if history_only { capabilities.clear(); }
    Ok(Session {
        id: row.try_get("id")?,
        workspace_id: row.try_get("workspace_id")?,
        agent: row.try_get("agent")?,
        label: row.try_get("label")?,
        state: row.try_get("state")?,
        archived: row.try_get::<i64, _>("archived")? != 0,
        history_only,
        external_session_id: row.try_get("external_session_id")?,
        plugin_installation_id: row.try_get("plugin_installation_id")?,
        capabilities,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_timeline_item(row: &sqlx::sqlite::SqliteRow) -> Result<TimelineItem, CoreError> {
    let mut content: String = row.try_get("content")?;
    let mut localized_content: Option<serde_json::Value> = row.try_get::<Option<String>, _>("localized_content_json").ok().flatten().and_then(|value| serde_json::from_str(&value).ok());
    let mut localized_activity = None;
    // Forking records an activity descriptor, rather than a replacement JSON body.
    if localized_content.as_ref().is_some_and(|value|value["key"] == "native.background.forkActivity") {
        localized_activity = localized_content.take();
    }
    if row.try_get::<Option<String>, _>("tool_name")?.as_deref() == Some("subagent") && row.try_get::<String, _>("status")? == "failed" {
        if let Ok(mut task) = serde_json::from_str::<serde_json::Value>(&content) {
            if ["pending", "running", "waiting"].contains(&task["status"].as_str().unwrap_or_default()) {
                task["status"] = serde_json::json!("interrupted");
                let activity = ui_i18n::HostMessage::new("native.subagent.interruptedActivity", serde_json::json!({}));
                task["activity"] = serde_json::json!(activity.diagnostic);
                localized_activity = activity.localized;
                content = task.to_string();
            }
        }
    }
    Ok(TimelineItem {
        id: row.try_get("id")?,
        session_id: row.try_get("session_id")?,
        turn_id: row.try_get("turn_id")?,
        external_message_id: row.try_get("external_message_id")?,
        role: row.try_get("role")?,
        tool_name: row.try_get("tool_name")?,
        entry_type: None,
        localized_content,
        localized_activity,
        content,
        status: row.try_get("status")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn session_snapshot_timeline(snapshot: &serde_json::Value, session_id: &str) -> Vec<TimelineItem> {
    snapshot
        .get("branch")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            if let Some(parts) = entry.get("parts").and_then(serde_json::Value::as_array) {
                return parts.iter().enumerate().map(|(index, part)| {
                    let mut projected = entry.clone();
                    if let Some(fields) = part.as_object() {
                        for (key, value) in fields { projected[key] = value.clone(); }
                    }
                    projected["id"] = serde_json::json!(format!("{}:part:{index}", entry["id"].as_str().unwrap_or_default()));
                    projected
                }).collect::<Vec<_>>();
            }
            vec![entry.clone()]
        })
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?.to_owned();
            let entry_type = entry
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("system");
            let source_role = entry.get("role").and_then(serde_json::Value::as_str);
            let role = match source_role {
                Some("user") => "user",
                Some("assistant") => "assistant",
                Some("toolResult") | Some("tool") => "tool",
                _ => "system",
            };
            let content = entry
                .get("summary")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if role == "assistant" && content.trim().is_empty() {
                return None;
            }
            if content.is_empty() && entry_type != "message" {
                return None;
            }
            let stop_reason = entry.get("stopReason").and_then(serde_json::Value::as_str);
            let is_error = entry
                .get("isError")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let status = if is_error || matches!(stop_reason, Some("error")) {
                "failed"
            } else if matches!(stop_reason, Some("aborted" | "cancelled" | "canceled")) {
                "interrupted"
            } else {
                "completed"
            };
            let timestamp = entry
                .get("timestamp")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned();
            Some(TimelineItem {
                id: id.clone(),
                session_id: session_id.to_owned(),
                turn_id: None,
                external_message_id: Some(id),
                role: role.to_owned(),
                tool_name: entry
                    .get("toolName")
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned),
                entry_type: Some(entry_type.to_owned()),
                localized_content: None,
                localized_activity: None,
                content,
                status: status.to_owned(),
                created_at: timestamp.clone(),
                updated_at: timestamp,
            })
        })
        .collect()
}

async fn session_by_id(db: &SqlitePool, id: &str) -> Result<Session, CoreError> {
    let row = sqlx::query(
        "SELECT s.id, s.workspace_id, s.agent, s.label, s.state, s.archived,
                b.external_session_id, s.plugin_installation_id, b.plugin_capabilities_json, b.plugin_binding_json,
                p.manifest_json AS queue_manifest_json,
                EXISTS(SELECT 1 FROM plugin_session_retirements r WHERE r.session_id=s.id) AS history_only,
                s.created_at, COALESCE(s.content_updated_at, s.created_at) AS updated_at
         FROM sessions s
         LEFT JOIN session_bindings b ON b.session_id = s.id
         LEFT JOIN plugin_installations p ON p.id = s.plugin_installation_id
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
    let requests_side_effects = profile.enforced.filesystem_policy != "read-only"
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
                adapter_capabilities_json, native_sandbox, resolved_at, enforcement_backend
         FROM session_execution_profiles WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_optional(db)
    .await?;
    let session = session_by_id(db, session_id).await?;
    let backend = if let Some(installation) = &session.plugin_installation_id {
        execution_profile::installation_backend(db, installation, &session.agent).await.map_err(CoreError::InvalidExecutionProfile)?
    } else { execution_profile::EnforcementBackend::legacy_agent(&session.agent) };
    if let Some(row) = row {
        let mut stored = profile_from_row(&row, session_id.to_owned())
            .map_err(ui_i18n::invalid_execution_profile_message)?;
        if session.plugin_installation_id.is_some() {
            let mut resolved = execution_profile::resolve_with_backend(
                backend,
                Some(stored.profile.requested.clone()),
                stored.profile.resolved_at.clone(),
            )
            .map_err(ui_i18n::invalid_execution_profile_message)?;
            resolved.adapter_capabilities = session.capabilities;
            resolved.session_controls = session_controls::for_installation(db, session.plugin_installation_id.as_ref().unwrap(), &session.agent, &resolved).await.map_err(CoreError::InvalidExecutionProfile)?;
            stored.profile = resolved;
        }
        return Ok(stored);
    }

    let mut resolved = execution_profile::resolve_with_backend(
        backend,
        None,
        now_iso(),
    )
    .map_err(ui_i18n::invalid_execution_profile_message)?;
    if session.plugin_installation_id.is_some() {
        resolved.adapter_capabilities = session.capabilities;
        resolved.session_controls = session_controls::for_installation(db, session.plugin_installation_id.as_ref().unwrap(), &session.agent, &resolved).await.map_err(CoreError::InvalidExecutionProfile)?;
    }
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
    resolve_profile(&agent, requested, now_iso()).map_err(ui_i18n::invalid_execution_profile_message)
}

#[tauri::command]
async fn get_session_execution_profile(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<SessionExecutionProfile, CoreError> {
    session_execution_profile(&state.db, &session_id).await
}

#[tauri::command]
async fn update_session_execution_profile(
    session_id: String,
    control_id: String,
    window: tauri::WebviewWindow, state: State<'_, AppState>,
) -> Result<SessionExecutionProfile, CoreError> {
    let _admission = state.plugins.session_operation(&session_id).await;
    let session = session_by_id(&state.db, &session_id).await?;
    if session.archived {
        return Err(ui_i18n::session_operation_error("native.controls.archived","archived sessions must be unarchived before changing their execution profile"));
    }
    if matches!(
        session.state.as_str(),
        "starting" | "running" | "waiting_approval" | "waiting_user" | "compacting"
    ) {
        return Err(CoreError::SessionBusy);
    }
    let current = session_execution_profile(&state.db, &session_id).await?.profile;
    let mut resolved = session_controls::select(&current, &control_id)
        .map_err(ui_i18n::invalid_execution_profile_message)?;
    if session.plugin_installation_id.is_some() {
        resolved.adapter_capabilities = session.capabilities.clone();
    }
    let workspace = workspace_by_id(&state.db, &session.workspace_id).await?;
    require_trusted_workspace(&workspace, &resolved)?;

    if session.plugin_installation_id.is_none() {
        return Err(ui_i18n::session_operation_error("native.controls.historyOnly","history_only: old session configuration is read-only"));
    }
    // The next capability open captures the updated host execution profile.
    state.plugins.close_admitted(window.label(), &session_id).await.map_err(ui_i18n::session_operation_message)?;
    save_session_profile(&state.db, &session_id, &resolved).await?;
    sqlx::query("UPDATE sessions SET state = 'idle', updated_at = ? WHERE id = ?")
        .bind(now_iso())
        .bind(&session_id)
        .execute(&state.db)
        .await?;
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
        Some("waiting_user") => Ok(SessionListFilter::State("waiting_user")),
        Some("compacting") => Ok(SessionListFilter::State("compacting")),
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
    list_sessions_from_db(&state.db, &workspace_id, search, status_filter).await
}

async fn list_sessions_from_db(
    db: &SqlitePool,
    workspace_id: &str,
    search: Option<String>,
    status_filter: Option<String>,
) -> Result<Vec<Session>, CoreError> {
    let filter = normalize_session_filter(status_filter.as_deref())?;
    let search = search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.to_lowercase()));
    let mut query_text = String::from(
        "SELECT s.id, s.workspace_id, s.agent, s.label, s.state, s.archived,
                b.external_session_id, s.plugin_installation_id, b.plugin_capabilities_json, b.plugin_binding_json,
                p.manifest_json AS queue_manifest_json,
                EXISTS(SELECT 1 FROM plugin_session_retirements r WHERE r.session_id=s.id) AS history_only,
                s.created_at, COALESCE(s.content_updated_at, s.created_at) AS updated_at
         FROM sessions s
         LEFT JOIN session_bindings b ON b.session_id = s.id
         LEFT JOIN plugin_installations p ON p.id = s.plugin_installation_id
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
    query_text.push_str(" ORDER BY julianday(COALESCE(s.content_updated_at, s.created_at)) DESC, s.id DESC");

    let mut query = sqlx::query(&query_text).bind(&workspace_id);
    if let Some(search) = search {
        query = query.bind(search.clone()).bind(search.clone()).bind(search);
    }
    if let SessionListFilter::State(value) = filter {
        query = query.bind(value);
    }
    let rows = query.fetch_all(db).await?;
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
        return Err(CoreError::Localized {error:Box::new(CoreError::InvalidSessionLabel("label must not be empty".to_owned())),localized:ui_i18n::display_descriptor("native.error.labelEmpty",serde_json::json!({}))});
    }
    if label.chars().count() > 120 {
        return Err(CoreError::Localized {error:Box::new(CoreError::InvalidSessionLabel("label must be at most 120 characters".to_owned())),localized:ui_i18n::display_descriptor("native.error.labelTooLong",serde_json::json!({}))});
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
async fn read_session_history_around(workspace_id: String, session_id: String, message_id: String, state: State<'_, AppState>) -> Result<session_history::Page, CoreError> {
    session_history::around(&state.db, workspace_id, session_id, message_id).await
}

#[tauri::command]
async fn read_session_history(workspace_id: String, session_id: String, before: Option<session_history::Cursor>, state: State<'_, AppState>) -> Result<session_history::Page, CoreError> {
    session_history::read(&state.db, workspace_id, session_id, before).await
}

/// Child history is read from persisted events without starting an Agent process.
#[tauri::command]
async fn get_subagent_history(session_id: String, agent_id: String, state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, CoreError> {
    session_history::read_subagent(&state.db, &session_id, &agent_id).await
}

#[tauri::command]
async fn get_timeline(
    session_id: String,
    window: tauri::WebviewWindow, state: State<'_, AppState>,
) -> Result<Vec<TimelineItem>, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    if session.capabilities.iter().any(|cap| cap == "session.timeline")
        && session.plugin_installation_id.is_some()
        && !session.archived
    {
        return state.plugins.active_timeline_display_from(window.label(), &session_id).await.map_err(ui_i18n::session_operation_message);
    }
    let rows = sqlx::query(
        "SELECT id, session_id, turn_id, external_message_id, role, tool_name, content, localized_content_json,
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

#[cfg(test)]
async fn persist_restore_operation(
    db: &SqlitePool,
    workspace_id: &str,
    session_id: &str,
    turn_id: &str,
    report: &crate::change_set::RestoreReport,
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
        localized_conflicts: None, localized_unsupported: None,
        created_at,
    })
}

#[tauri::command]
async fn restore_turn_change_set(
    session_id: String,
    turn_id: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<RestoreTurnChangeSetResult, CoreError> {
    let request = host_write_request(request_id, window, state.db.clone(), host_confirmation::Category::TurnRestore);
    turn_restore::restore_requested(&state.db, &state.data_dir, &session_id, &turn_id, &request).await
}

#[tauri::command]
async fn get_workspace_changes(
    workspace_id: String,
    repository_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceChanges, CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    let repository_path = git_repositories::resolve(&workspace.path, repository_id.as_deref())?;
    let changes = change_set::workspace_changes_message(Path::new(&repository_path))
        .await
        .map_err(ui_i18n::database_message)?;
    Ok(WorkspaceChanges {
        workspace_id,
        head: changes.head,
        branch: changes.branch,
        dirty: changes.dirty,
        captured_at: changes.captured_at,
        files: changes
            .files
            .into_iter()
            .map(|file| WorkspaceFileChange {
                staged_stats: file.staged_stats,
                unstaged_stats: file.unstaged_stats,
                path: file.path,
                previous_path: file.previous_path,
                kind: file.kind.to_owned(),
                staged: file.staged,
                unstaged: file.unstaged,
                untracked: file.untracked,
                conflicted: file.conflicted,
            })
            .collect(),
        capture_status: changes.capture_status.to_owned(),
        capture_error: changes.capture_error,
        localized_capture_error: changes.localized_capture_error,
    })
}

#[tauri::command]
async fn get_workspace_file_diff(
    workspace_id: String,
    repository_id: Option<String>,
    path: String,
    staged: bool,
    state: State<'_, AppState>,
) -> Result<WorkspaceFileDiff, CoreError> {
    let workspace = workspace_by_id(&state.db, &workspace_id).await?;
    let root = git_repositories::resolve(&workspace.path, repository_id.as_deref())?;
    tokio::task::spawn_blocking(move || workspace_file_diff(&root, &path, staged))
        .await
        .map_err(|error| CoreError::Database(format!("workspace diff task failed: {error}")))?
}

#[tauri::command]
async fn apply_git_hunk_action(
    session_id: String,
    turn_id: String,
    path: String,
    hunk_index: i64,
    action: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitHunkActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    core_turn_git::apply_hunk(&state.db, &state.data_dir, &session_id, &turn_id, &path, hunk_index, &action, &request).await
}

#[tauri::command]
async fn apply_workspace_git_file_action(
    workspace_id: String,
    repository_id: Option<String>,
    path: String,
    action: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitFileActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::apply_workspace_git_file_action_requested_in_repository(&state.db, workspace_id, path, action, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn apply_workspace_git_action(
    workspace_id: String,
    repository_id: Option<String>,
    action: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::apply_workspace_git_action_requested_in_repository(&state.db, workspace_id, action, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn commit_workspace_changes(
    workspace_id: String,
    repository_id: Option<String>,
    message: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitCommitResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::commit_workspace_changes_requested_in_repository(&state.db, workspace_id, message, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn list_workspace_git_branches(
    workspace_id: String,
    repository_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<GitBranch>, CoreError> {
    workspace_git::list_workspace_git_branches_in_repository(&state.db, workspace_id, repository_id.as_deref()).await
}

#[tauri::command]
async fn checkout_workspace_git_branch(
    workspace_id: String,
    repository_id: Option<String>,
    branch: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::checkout_workspace_git_branch_requested_in_repository(&state.db, workspace_id, branch, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn create_workspace_git_branch(
    workspace_id: String,
    repository_id: Option<String>,
    branch: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::create_workspace_git_branch_requested_in_repository(&state.db, workspace_id, branch, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn list_workspace_git_history(
    workspace_id: String,
    repository_id: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<GitCommit>, CoreError> {
    workspace_git::list_workspace_git_history_in_repository(&state.db, workspace_id, limit, repository_id.as_deref(), offset).await
}

#[tauri::command]
async fn list_workspace_git_commit_files(
    workspace_id: String,
    repository_id: Option<String>,
    commit: String,
    offset: Option<usize>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<GitCommitFileList, CoreError> {
    workspace_git::list_workspace_git_commit_files_in_repository(&state.db, workspace_id, commit, offset, limit, repository_id.as_deref()).await
}

#[tauri::command]
async fn get_workspace_git_commit_file_diff(
    workspace_id: String,
    repository_id: Option<String>,
    commit: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceFileDiff, CoreError> {
    workspace_git::get_workspace_git_commit_file_diff_in_repository(&state.db, workspace_id, commit, path, repository_id.as_deref()).await
}

#[tauri::command]
async fn get_workspace_git_remote_status(
    workspace_id: String,
    repository_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<GitRemoteStatus, CoreError> {
    workspace_git::get_workspace_git_remote_status_in_repository(&state.db, workspace_id, repository_id.as_deref()).await
}

#[tauri::command]
async fn sync_workspace_git(
    workspace_id: String,
    repository_id: Option<String>,
    action: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::sync_workspace_git_requested_in_repository(&state.db, workspace_id, action, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn list_workspace_git_stashes(
    workspace_id: String,
    repository_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<GitStashEntry>, CoreError> {
    workspace_git::list_workspace_git_stashes_in_repository(&state.db, workspace_id, repository_id.as_deref()).await
}

#[tauri::command]
async fn apply_workspace_git_stash(
    workspace_id: String,
    repository_id: Option<String>,
    reference: String,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::apply_workspace_git_stash_requested_in_repository(&state.db, workspace_id, reference, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn stash_workspace_git(
    workspace_id: String,
    repository_id: Option<String>,
    message: Option<String>,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    workspace_git::stash_workspace_git_requested_in_repository(&state.db, workspace_id, message, &request, repository_id.as_deref()).await
}

#[tauri::command]
async fn apply_git_file_action(
    session_id: String,
    path: String,
    action: String,
    turn_id: Option<String>,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<GitFileActionResult, CoreError> {
    let request = git_write_request(request_id, window, state.db.clone());
    core_turn_git::apply_file(&state.db, &state.data_dir, &session_id, &path, &action, turn_id.as_deref(), &request).await
}

#[tauri::command]
async fn reference_session(session_id: String, source_session_id: String, state: State<'_, AppState>) -> Result<ContextAttachment, CoreError> {
    session_context::capture(&state.db, &session_id, &source_session_id).await
}

#[tauri::command]
async fn get_session_attachment_preview(session_id: String, attachment_id: String, state: State<'_, AppState>) -> Result<String, ui_i18n::HostMessage> {
    clipboard_images::preview(&state.db, &session_id, &attachment_id).await
}

#[tauri::command]
async fn register_session_clipboard_images(session_id: String, images: Vec<clipboard_images::ImageInput>, state: State<'_, AppState>) -> Result<Vec<ContextAttachment>, CoreError> {
    clipboard_images::register(&state.db, &state.data_dir, &session_id, images).await
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

#[tauri::command]
async fn list_project_actions(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectAction>, CoreError> {
    project_actions::list_project_actions(&state.db, workspace_id).await
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
    project_actions::save_project_action(&state.db, workspace_id, action_id, name, kind, program, args, cwd, enabled).await
}

#[tauri::command]
async fn delete_project_action(
    workspace_id: String,
    action_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    project_actions::delete_project_action(&state.db, workspace_id, action_id).await
}

#[tauri::command]
async fn run_project_action(
    workspace_id: String,
    action_id: String,
    session_id: Option<String>,
    request_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<ProjectActionRun, CoreError> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let caller = window.label().to_owned();
    let locale = ui_i18n::window_locale(&window);
    let db = state.db.clone();
    project_actions::run_project_action_with_localized_confirmation(&state.db, &state.data_dir, workspace_id, action_id, session_id, request_id, caller, locale, |message| async move {
        host_confirmation::confirm(&db, host_confirmation::Category::ProjectAction, || async move {
            let (send, receive) = tokio::sync::oneshot::channel();
            window.app_handle().dialog().message(message).parent(&window).title(host_confirmation::Category::ProjectAction.title(locale))
                .buttons(MessageDialogButtons::OkCancelCustom(ui_i18n::message(locale,"native.allowOnce",&serde_json::json!({})), ui_i18n::message(locale,"native.cancel",&serde_json::json!({}))))
                .show(move |accepted| { let _ = send.send(accepted); });
            receive.await.map_err(|_| "confirmation_unavailable".to_owned())
        }).await
    }).await
}

#[tauri::command]
async fn cancel_project_action(
    workspace_id: String, run_id: String, state: State<'_, AppState>,
) -> Result<bool, CoreError> {
    project_actions::cancel_project_action(&state.db, workspace_id, run_id).await
}

fn git_write_request(request_id: String, window: tauri::WebviewWindow, db: SqlitePool) -> workspace_write_runs::Request {
    host_write_request(request_id, window, db, host_confirmation::Category::Git)
}

fn host_write_request(request_id: String, window: tauri::WebviewWindow, db: SqlitePool, category: host_confirmation::Category) -> workspace_write_runs::Request {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let locale = ui_i18n::window_locale(&window);
    workspace_write_runs::Request::with_confirmation(request_id, window.label().into(), move |message| {
        let window = window.clone();
        let db = db.clone();
        async move {
            host_confirmation::confirm(&db, category, || async move {
                let (send, receive) = tokio::sync::oneshot::channel();
                window.app_handle().dialog().message(message).parent(&window).title(category.title(locale))
                    .buttons(MessageDialogButtons::OkCancelCustom(ui_i18n::message(locale,"native.allowOnce",&serde_json::json!({})), ui_i18n::message(locale,"native.cancel",&serde_json::json!({}))))
                    .show(move |accepted| { let _ = send.send(accepted); });
                receive.await.map_err(|_| "confirmation_unavailable".to_owned())
            }).await
        }
    }).with_locale(locale)
}

#[tauri::command]
async fn cancel_workspace_write(workspace_id: String, run_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<bool, CoreError> {
    workspace_write_runs::cancel(&state.db, &workspace_id, &run_id, window.label()).await
}

#[tauri::command]
async fn list_workspace_write_runs(workspace_id: String, limit: Option<i64>, before: Option<execution_history::Cursor>, state: State<'_, AppState>) -> Result<Vec<workspace_write_runs::WriteRun>, CoreError> {
    workspace_write_runs::list_page(&state.db, workspace_id, limit, before.as_ref()).await
}

#[tauri::command]
async fn list_project_action_runs(
    workspace_id: String,
    limit: Option<i64>,
    before: Option<execution_history::Cursor>,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectActionRun>, CoreError> {
    project_actions::list_project_action_runs_page(&state.db, workspace_id, limit, before.as_ref()).await
}

pub(crate) async fn read_process_output<R: tokio::io::AsyncRead + Unpin>(reader: R) -> Vec<u8> {
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

#[cfg(unix)]
pub(crate) fn isolate_process_tree(command: &mut TokioCommand) {
    command.process_group(0);
}

#[cfg(not(unix))]
pub(crate) fn isolate_process_tree(_command: &mut TokioCommand) {}

pub(crate) async fn terminate_process_tree(child: &mut tokio::process::Child) {
    let pid = child.id();
    #[cfg(unix)]
    if let Some(pid) = pid {
        // Each controlled command is started as its own process group. A
        // negative pid addresses that entire group, including grandchildren.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    if let Some(pid) = pid {
        let _ = TokioCommand::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[tauri::command]
async fn list_codex_threads(workspace_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<serde_json::Value, CoreError> {
    let scope = capability_broker::Scope::Workspace(workspace_id);
    let capability = "aibo.session.catalog";
    let providers = state.capability_broker.providers(&scope, capability, "1.0.0").await.map_err(|e|CoreError::Initialization(e.message))?;
    let mut threads = Vec::new();
    for provider in providers {
        let binding = capability_broker::Binding {scope:scope.clone(),capability:capability.into(),version:"1.0.0".into(),installation_id:provider.installation_id,contribution_id:provider.contribution_id};
        let request = capability_broker::Request {scope:scope.clone(),capability:capability.into(),version:"1.0.0".into(),request_id:Ulid::new().to_string(),turn_id:None,input:serde_json::json!({})};
        let response = state.capability_broker.invoke_bound(window.label(),request,&binding).await.map_err(|e|CoreError::Initialization(e.message))?;
        threads.extend(response.output["threads"].as_array().into_iter().flatten().cloned());
    }
    Ok(serde_json::json!(threads))
}

#[tauri::command]
async fn read_codex_thread(session_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<serde_json::Value, CoreError> {
    let result = state.plugins.invoke_capability_display_from(window.label(), &session_id, "session.snapshot", serde_json::json!({})).await.map_err(ui_i18n::session_operation_message)?;
    Ok(result["thread"].clone())
}

#[tauri::command]
async fn fork_codex_thread(session_id: String, through_turn_id: Option<String>, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Session, CoreError> {
    state.plugins.fork_display_from(window.label(), &session_id, through_turn_id.as_deref(), ui_i18n::window_locale(&window)).await.map_err(ui_i18n::session_operation_message)
}

#[tauri::command]
async fn archive_codex_thread(session_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Session, CoreError> {
    archive_session(session_id, window, state).await
}

#[tauri::command]
async fn unarchive_codex_thread(session_id: String, state: State<'_, AppState>) -> Result<Session, CoreError> {
    unarchive_session(session_id, state).await
}

#[tauri::command]
async fn archive_session(session_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Session, CoreError> {
    state.plugins.archive_from_display(window.label(), &session_id).await.map_err(ui_i18n::session_operation_message)
}

#[tauri::command]
async fn unarchive_session(session_id: String, state: State<'_, AppState>) -> Result<Session, CoreError> {
    state.plugins.unarchive(&session_id).await.map_err(CoreError::SessionOperation)
}

#[tauri::command]
async fn list_capability_providers(scope: capability_broker::Scope, capability: String, version: String, state: State<'_, AppState>) -> Result<Vec<capability_broker::Provider>, capability_broker::Failure> {
    state.capability_broker.providers(&scope, &capability, &version).await
}
#[tauri::command]
async fn bind_capability_provider(binding: capability_broker::Binding, state: State<'_, AppState>) -> Result<(), capability_broker::Failure> {
    let _guard = state.capability_broker.mutation_guard().await;
    state.capability_broker.bind(binding).await
}
#[tauri::command]
async fn invoke_capability(request: capability_broker::Request, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<capability_broker::Response, capability_broker::Failure> {
    let broker = state.capability_broker.clone();
    let caller = window.label().to_owned();
    let approval = host_write_request(request.request_id.clone(), window, state.db.clone(), host_confirmation::Category::CapabilityWrite);
    // Execution belongs to Core even if the calling view disappears.
    tokio::spawn(async move { broker.invoke_authorized(&caller, request, &approval).await }).await.map_err(|_| capability_broker::Failure { code: "provider_unavailable".into(), message: "Capability task stopped".into(), invocation_id: None, localized:Some(ui_i18n::display_descriptor("native.broker.taskStopped",serde_json::json!({}))) })?
}
#[tauri::command]
async fn list_capability_history_scopes(before: Option<String>, legacy: Option<bool>, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<capability_history::ScopePage, CoreError> {
    capability_history::scopes_from(&state.db, window.label(), before, legacy.unwrap_or(false)).await
}
#[tauri::command]
async fn read_capability_history(scope: capability_broker::Scope, before: Option<String>, legacy: Option<bool>, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<capability_history::EventPage, CoreError> {
    capability_history::events_from(&state.db, window.label(), scope, before, legacy.unwrap_or(false)).await
}

#[tauri::command]
async fn list_capability_events(scope: capability_broker::Scope, after_sequence: i64, limit: u32, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, capability_broker::Failure> {
    state.capability_broker.events(window.label(), &scope, after_sequence, limit).await
}

#[tauri::command]
async fn cancel_capability(request_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.capability_broker.cancel(window.label(), &request_id).await)
}

#[tauri::command]
async fn read_agent_settings(target: agent_settings::Target, state: State<'_, AppState>) -> Result<serde_json::Value, ui_i18n::HostMessage> {
    agent_settings::read(&state.db, &target).await
}
#[tauri::command]
async fn save_agent_settings(request: agent_settings::Save, state: State<'_, AppState>) -> Result<serde_json::Value, ui_i18n::HostMessage> {
    let _guard = state.capability_broker.mutation_guard().await;
    agent_settings::save(&state.db, request).await
}

#[tauri::command]
async fn plugin_authentication_action(id: String, action: plugin_authentication::Action, state: State<'_, AppState>) -> Result<plugin_authentication::Status, ui_i18n::HostMessage> {
    let _guard = state.capability_broker.mutation_guard().await;
    plugin_authentication::execute(&state.db, &state.data_dir, &id, action).await
}

#[tauri::command]
async fn list_plugin_installations(state: State<'_, AppState>) -> Result<Vec<plugin_registry::PluginInstallation>, ui_i18n::HostMessage> {
    plugin_registry::list(&state.db).await
}

#[tauri::command]
async fn list_presentation_packages(state: State<'_, AppState>) -> Result<Vec<presentation_packages::Release>, ui_i18n::HostMessage> {
    presentation_packages::list(&state.db).await
}
#[tauri::command]
async fn install_presentation_package(path: String, state: State<'_, AppState>) -> Result<presentation_packages::Release, ui_i18n::HostMessage> {
    presentation_packages::install(&state.db, &state.data_dir, Path::new(&path)).await
}
#[tauri::command]
async fn read_presentation_package(digest: String, state: State<'_, AppState>) -> Result<presentation_packages::Package, ui_i18n::HostMessage> {
    presentation_packages::package(&state.db, &state.data_dir, &digest).await
}
#[tauri::command]
async fn set_presentation_package_enabled(digest: String, enabled: bool, state: State<'_, AppState>) -> Result<(), ui_i18n::HostMessage> {
    presentation_packages::enable(&state.db, &digest, enabled).await
}
#[tauri::command]
async fn preview_presentation_removal(digest: String, state: State<'_, AppState>) -> Result<Vec<String>, ui_i18n::HostMessage> {
    presentation_packages::removal_windows(&state.db,&digest).await
}
#[tauri::command]
async fn uninstall_presentation_package(digest: String, expected_windows: Vec<String>, state: State<'_, AppState>) -> Result<(), ui_i18n::HostMessage> {
    presentation_packages::uninstall(&state.db, &state.data_dir, &digest, &expected_windows).await
}
#[tauri::command]
async fn get_presentation_selection(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Option<presentation_packages::Selection>, ui_i18n::HostMessage> {
    presentation_packages::selection(&state.db, window.label()).await
}
#[tauri::command]
async fn select_presentation_package(digest: Option<String>, theme_id: Option<String>, expected_digest: Option<String>, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), ui_i18n::HostMessage> {
    presentation_packages::select(&state.db, &state.data_dir, window.label(), digest.as_deref(), theme_id.as_deref(), expected_digest.as_deref()).await
}

#[tauri::command]
async fn install_agent_plugin(app: tauri::AppHandle, path: String, token: Option<String>, reinstall: Option<bool>, skip_archived: Option<bool>, state: State<'_, AppState>) -> Result<plugin_registry::PluginInstallation,ui_i18n::HostMessage> {
    let _guard = state.capability_broker.mutation_guard().await;
    let preview=plugin_replacement::preview(&state.db,Path::new(&path)).await?;
    // Only stop running tools after the replacement review has passed. An identical
    // install, stale token or blocked replacement must not interrupt live work.
    let may_replace = preview.kind != "installed" && preview.blockers.is_empty()
        && (preview.previous.is_empty() && token.is_none() || token.as_deref() == Some(preview.token.as_str()))
        && (preview.kind == "downgrade") == reinstall.unwrap_or(false);
    let previous=preview.impacts;
    for old in previous.iter().filter(|_| may_replace) { if !tool_views::close_matching(&app,None,None,Some(&old.id),None,true).await.map_err(ui_i18n::HostMessage::from)? { return Err("cancelled".to_owned().into()); } }
    let installed=state.plugins.replace_plugin(&state.data_dir, Path::new(&path), token.as_deref(), reinstall.unwrap_or(false), skip_archived.unwrap_or(true)).await?;
    for old in previous {if old.id!=installed.id {state.semantic_plugins.invalidate(&state.capability_broker,&old.id,None).await;}}
    Ok(installed)
}

#[tauri::command]
async fn preview_plugin_install(path:String,state:State<'_,AppState>)->Result<plugin_replacement::Preview,ui_i18n::HostMessage>{
    plugin_replacement::preview(&state.db,Path::new(&path)).await
}
#[tauri::command]
async fn list_plugin_undo_targets(state:State<'_,AppState>)->Result<Vec<String>,ui_i18n::HostMessage>{
    plugin_replacement::collect(&state.db,&state.data_dir).await?;
    plugin_replacement::undo_targets(&state.db).await.map_err(Into::into)
}
#[tauri::command]
async fn undo_plugin_replacement(id:String,state:State<'_,AppState>)->Result<(),ui_i18n::HostMessage>{
    let _guard=state.capability_broker.mutation_guard().await;
    state.plugins.undo_plugin_replacement(&state.data_dir,&id).await?;
    state.semantic_plugins.invalidate(&state.capability_broker,&id,None).await;
    Ok(())
}

#[tauri::command]
async fn set_agent_plugin_enabled(app: tauri::AppHandle, id: String, enabled: bool, state: State<'_, AppState>) -> Result<plugin_lifecycle::MigrationReport, ui_i18n::HostMessage> {
    let _guard = state.capability_broker.mutation_guard().await;
    if !enabled && !tool_views::close_matching(&app,None,None,Some(&id),None,true).await.map_err(ui_i18n::HostMessage::from)? { return Err("cancelled".to_owned().into()); }
    plugin_registry::enable(&state.db, &id, enabled).await?;
    if !enabled {
        for (installation,contributions) in plugin_dependencies::invalidations(&state.db,&id).await? {
            state.semantic_plugins.invalidate(&state.capability_broker,&installation,contributions.as_deref()).await;
            state.capability_broker.stop_contributions(&installation,contributions.as_deref()).await.map_err(capability_broker::Failure::into_host_message)?;
        }
    }
    Ok(plugin_lifecycle::MigrationReport::default())
}

#[tauri::command]
async fn preview_plugin_removal(id: String, state: State<'_, AppState>) -> Result<plugin_lifecycle::Impact,ui_i18n::HostMessage> {
    plugin_lifecycle::impact(&state.db,&id).await
}
#[tauri::command]
async fn migrate_plugin_sessions(id: String, target: String, state: State<'_, AppState>) -> Result<plugin_lifecycle::MigrationReport,ui_i18n::HostMessage> {
    let _guard = state.capability_broker.mutation_guard().await;
    state.plugins.migrate_release(&state.data_dir,&id,&target).await
}
#[tauri::command]
async fn uninstall_agent_plugin(app: tauri::AppHandle, id: String, token: String, keep_history: bool, state: State<'_, AppState>) -> Result<(),ui_i18n::HostMessage> {
    let _guard = state.capability_broker.mutation_guard().await;
    let impact=plugin_lifecycle::impact(&state.db,&id).await?;
    if impact.token!=token { return Err(ui_i18n::HostMessage::new("native.plugin.removalChanged",serde_json::json!({}))); }
    if !tool_views::close_matching(&app,None,None,Some(&id),None,true).await.map_err(ui_i18n::HostMessage::from)? { return Err("cancelled".to_owned().into()); }
    state.plugins.remove_release(&state.data_dir,&impact,keep_history).await?;
    state.semantic_plugins.invalidate(&state.capability_broker,&id,None).await;
    Ok(())
}

#[tauri::command]
async fn create_agent_session(workspace_id: String, agent_id: String, installation_id: Option<String>, requested_profile: Option<ExecutionProfile>, defer_start: Option<bool>, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Session, ui_i18n::HostMessage> {
    let _guard = state.capability_broker.mutation_guard().await;
    let installation_id = match installation_id {
        Some(id) => id,
        None => sqlx::query_scalar(
            "SELECT p.id FROM agent_contributions a JOIN plugin_installations p ON p.id=a.installation_id WHERE a.agent_id=? AND p.installed=1 AND p.enabled=1 ORDER BY p.enabled_at DESC, p.created_at DESC LIMIT 1",
        ).bind(&agent_id).fetch_optional(&state.db).await.map_err(|error|error.to_string())?
            .ok_or_else(||ui_i18n::HostMessage::with_diagnostic("native.session.noEnabledInstallation",serde_json::json!({}),"provider_unavailable: no enabled installation for this contribution"))?,
    };
    let backend = execution_profile::installation_backend(&state.db, &installation_id, &agent_id).await?;
    // Preserve absence: SessionHost chooses a compatible declared initial mode.
    let profile = requested_profile.map(|requested| execution_profile::resolve_with_backend(backend, Some(requested), now_iso())).transpose()?;
    let session = state.plugins.prepare_with_profile_display(&workspace_id, &installation_id, &agent_id, profile).await?;
    drop(_guard);
    if defer_start == Some(true) { return Ok(session); }
    state.plugins.resume_from_display(window.label(), &session.id).await?;
    session_by_id(&state.db,&session.id).await.map_err(|error|ui_i18n::HostMessage::from(error.to_string()))
}

#[tauri::command]
async fn send_agent_prompt(session_id: String, input: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Session, ui_i18n::HostMessage> {
    let session = session_by_id(&state.db, &session_id).await.map_err(|error|error.to_string())?;
    if session.plugin_installation_id.is_none() { return Err(ui_i18n::HostMessage::with_diagnostic("native.session.newCapabilitySession",serde_json::json!({}),"history_only: create a new capability session")); }
    state.plugins.send_configured_from(window.label(), &session_id, &input).await?;
    session_by_id(&state.db, &session_id).await.map_err(|error|ui_i18n::HostMessage::from(error.to_string()))
}

#[tauri::command]
async fn cancel_agent_turn(session_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), ui_i18n::HostMessage> {
    let session = session_by_id(&state.db, &session_id).await.map_err(|error|error.to_string())?;
    if session.plugin_installation_id.is_none() { return Err(ui_i18n::HostMessage::with_diagnostic("native.session.newCapabilitySession",serde_json::json!({}),"history_only: create a new capability session")); }
    state.plugins.cancel_from_display(window.label(), &session_id).await?;
    Ok(())
}

#[tauri::command]
async fn resume_agent_session(session_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Session, ui_i18n::HostMessage> {
    let session = session_by_id(&state.db, &session_id).await.map_err(|error|error.to_string())?;
    if session.plugin_installation_id.is_none() { return Err(ui_i18n::HostMessage::with_diagnostic("native.session.newCapabilitySession",serde_json::json!({}),"history_only: create a new capability session")); }
    state.plugins.resume_from_display(window.label(), &session_id).await?;
    session_by_id(&state.db, &session_id).await.map_err(|error|ui_i18n::HostMessage::from(error.to_string()))
}

#[tauri::command]
async fn close_agent_session(session_id: String, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), ui_i18n::HostMessage> {
    let session = session_by_id(&state.db, &session_id).await.map_err(|error|error.to_string())?;
    if session.plugin_installation_id.is_none() { return Err(ui_i18n::HostMessage::with_diagnostic("native.session.newCapabilitySession",serde_json::json!({}),"history_only: create a new capability session")); }
    state.plugins.close_from_display(window.label(), &session_id).await?;
    Ok(())
}

#[tauri::command]
async fn invoke_agent_capability(session_id: String, capability: String, input: serde_json::Value, window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<serde_json::Value, ui_i18n::HostMessage> {
    state.plugins.invoke_capability_display_from(window.label(), &session_id, &capability, input).await
}

#[tauri::command]
async fn resolve_agent_approval(
    session_id: String,
    request_id: String,
    decision: Option<String>,
    option_id: Option<String>,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    if session.plugin_installation_id.is_some() {
        let result = match (decision, option_id) {
            (Some(decision), None) => state.plugins.resolve_approval_display_from(window.label(), &session_id, &request_id, &decision).await,
            (None, Some(option)) => state.plugins.resolve_approval_option_display_from(window.label(), &session_id, &request_id, &option).await,
            _ => Err(ui_i18n::HostMessage::with_diagnostic("native.approval.answerShape",serde_json::json!({}),"invalid_request: answer an approval with either a decision or an option")),
        };
        result.map_err(ui_i18n::session_operation_message)?;
        return Ok(());
    }
    Err(ui_i18n::session_operation_message(ui_i18n::HostMessage::with_diagnostic("native.approval.historyOnly",serde_json::json!({}),"history_only: old native session cannot execute")))
}

#[tauri::command]
async fn resolve_agent_user_input(
    session_id: String,
    request_id: String,
    answers: serde_json::Value,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    if session.plugin_installation_id.is_some() {
        state
            .plugins
            .invoke_capability_display_from(
                window.label(), &session_id,
                "user-input.respond",
                serde_json::json!({ "requestId": request_id, "answers": answers }),
            )
            .await
            .map_err(ui_i18n::session_operation_message)?;
        return Ok(());
    }
    Err(ui_i18n::session_operation_error("native.session.userInputHistoryOnly","history_only: old native session cannot execute"))
}

#[tauri::command]
async fn get_session_models(
    session_id: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<SessionModelCatalog, CoreError> {
    let session = session_by_id(&state.db, &session_id).await?;
    if session.plugin_installation_id.is_none() {
        return Err(ui_i18n::session_operation_error("native.models.historyOnly","history_only: model discovery requires a capability session"));
    }
    let models = state.plugins.invoke_capability_display_from(window.label(), &session_id, "model.select", serde_json::json!({"action":"list"})).await.map_err(ui_i18n::session_operation_message)?;
    let reasoning = if session.capabilities.iter().any(|capability|capability == "model.reasoning") {
        Some(state.plugins.invoke_capability_display_from(window.label(), &session_id, "model.reasoning", serde_json::json!({"action":"list"})).await.map_err(ui_i18n::session_operation_message)?)
    } else { None };
    plugin_model_catalog(&models, reasoning.as_ref())
}

fn plugin_model_catalog(result: &serde_json::Value, reasoning: Option<&serde_json::Value>) -> Result<SessionModelCatalog, CoreError> {
    let parameter_scope = match result.get("parameterScope") {
        None => "all-models",
        Some(serde_json::Value::String(scope)) if scope == "all-models" || scope == "current-model" => scope.as_str(),
        _ => return Err(ui_i18n::session_operation_error("native.models.parameterScope","plugin model catalog returned invalid parameterScope")),
    }.to_owned();
    let raw_models = result.get("models").and_then(serde_json::Value::as_array)
        .ok_or_else(|| ui_i18n::session_operation_error("native.models.missingModels","plugin model catalog did not return models"))?;
    let models = raw_models.iter().filter_map(|item| {
        let provider = item.get("provider").and_then(serde_json::Value::as_str).map(ToOwned::to_owned);
        let id = item.get("id").and_then(serde_json::Value::as_str)
            .or_else(|| item.get("modelId").and_then(serde_json::Value::as_str))
            .or_else(|| item.get("model").and_then(serde_json::Value::as_str))?.to_owned();
        let reference = item.get("reference").and_then(serde_json::Value::as_str).map(ToOwned::to_owned)
            .unwrap_or_else(|| provider.as_ref().map(|provider|format!("{provider}/{id}")).unwrap_or_else(||id.clone()));
        let mut reasoning_efforts = item.get("supportedReasoningEfforts").or_else(||item.get("reasoningEfforts"))
            .and_then(serde_json::Value::as_array).into_iter().flatten().filter_map(|effort| {
                let id = effort.as_str().or_else(||effort.get("reasoningEffort").and_then(serde_json::Value::as_str)).or_else(||effort.get("id").and_then(serde_json::Value::as_str))?.to_owned();
                Some(SessionReasoningOption { label: effort.get("label").and_then(serde_json::Value::as_str).unwrap_or(&id).to_owned(), description: effort.get("description").and_then(serde_json::Value::as_str).map(ToOwned::to_owned), id })
            }).collect::<Vec<_>>();
        // Pi SDK descriptors carry per-model capability metadata instead of
        // the normalized effort array. The session-level list only describes
        // the current model and cannot populate the other matrix rows.
        if item.get("supportedReasoningEfforts").is_none()
            && item.get("reasoningEfforts").is_none()
            && item.get("reasoning").and_then(serde_json::Value::as_bool).is_some()
        {
            reasoning_efforts = session_models::reasoning_options(item);
        }
        let service_tiers = item.get("serviceTiers").and_then(serde_json::Value::as_array).into_iter().flatten().filter_map(|tier| {
            let id = tier.as_str().or_else(||tier.get("id").and_then(serde_json::Value::as_str))?.to_owned();
            Some(SessionServiceTierOption { label: tier.get("name").or_else(||tier.get("label")).and_then(serde_json::Value::as_str).unwrap_or(&id).to_owned(), description: tier.get("description").and_then(serde_json::Value::as_str).map(ToOwned::to_owned), id })
        }).collect();
        let context_windows = item.get("contextWindows").and_then(serde_json::Value::as_array).into_iter().flatten().filter_map(|option| {
            let id = option.get("id")?.as_str()?.to_owned();
            if id.is_empty() { return None; }
            Some(SessionContextWindowOption {
                label: option.get("label").or_else(|| option.get("name")).and_then(serde_json::Value::as_str).unwrap_or(&id).to_owned(),
                description: option.get("description").and_then(serde_json::Value::as_str).map(ToOwned::to_owned),
                tokens: option.get("tokens").and_then(serde_json::Value::as_u64).filter(|value| *value > 0 && *value <= 9_007_199_254_740_991), id,
            })
        }).collect();
        Some(SessionModelOption { label: item.get("displayName").or_else(||item.get("name")).and_then(serde_json::Value::as_str).unwrap_or(&reference).to_owned(),
            description: item.get("description").and_then(serde_json::Value::as_str).map(ToOwned::to_owned), is_default: item.get("isDefault").and_then(serde_json::Value::as_bool).unwrap_or(false),
            default_reasoning_effort: item.get("defaultReasoningEffort").and_then(serde_json::Value::as_str).map(ToOwned::to_owned), reference, provider, id, reasoning_efforts, service_tiers, context_windows })
    }).collect::<Vec<_>>();
    let current_reference = result.get("current").and_then(serde_json::Value::as_str).map(ToOwned::to_owned)
        .or_else(|| result.get("current").and_then(|current| {
            let provider = current.get("provider").and_then(serde_json::Value::as_str)?;
            let id = current.get("id").and_then(serde_json::Value::as_str)?;
            Some(format!("{provider}/{id}"))
        }));
    let current = current_reference
        .as_deref()
        .and_then(|reference|models.iter().find(|model|model.reference == reference || model.id == reference).cloned())
        .or_else(|| models.iter().find(|model| model.is_default).cloned());
    let current_reasoning_effort = reasoning.and_then(|value|value.get("current")).and_then(serde_json::Value::as_str).map(ToOwned::to_owned);
    let reasoning_efforts = reasoning.and_then(|value|value.get("levels")).and_then(serde_json::Value::as_array).into_iter().flatten().filter_map(|level| {
        let id = level.as_str().or_else(||level.get("id").and_then(serde_json::Value::as_str)).or_else(||level.get("reasoningEffort").and_then(serde_json::Value::as_str))?.to_owned();
        Some(SessionReasoningOption { label: level.get("label").and_then(serde_json::Value::as_str).unwrap_or(&id).to_owned(), description: level.get("description").and_then(serde_json::Value::as_str).map(ToOwned::to_owned), id })
    }).collect::<Vec<_>>();
    let current_service_tier = result.get("currentServiceTier").and_then(serde_json::Value::as_str).map(ToOwned::to_owned);
    let current_context_window = result.get("currentContextWindow").and_then(serde_json::Value::as_str).map(ToOwned::to_owned);
    Ok(SessionModelCatalog { parameter_scope, current, models, current_reasoning_effort, reasoning_efforts, current_service_tier, current_context_window })
}

#[tauri::command]
async fn get_pi_session_tree(
    session_id: String,
    window: tauri::WebviewWindow, state: State<'_, AppState>,
) -> Result<serde_json::Value, CoreError> {
    if session_by_id(&state.db, &session_id).await?.plugin_installation_id.is_some() {
        return state
            .plugins
            .invoke_capability_display_from(window.label(), &session_id, "session.tree", serde_json::json!({"action":"get"}))
            .await
            .map_err(ui_i18n::session_operation_message);
    }
    Err(ui_i18n::session_operation_error("native.tree.historyOnly","history_only: the session tree requires a bound capability session"))
}

#[tauri::command]
async fn navigate_pi_session_tree(
    session_id: String,
    entry_id: String,
    summarize: bool,
    custom_instructions: Option<String>,
    replace_instructions: bool,
    window: tauri::WebviewWindow, state: State<'_, AppState>,
) -> Result<serde_json::Value, CoreError> {
    if session_by_id(&state.db, &session_id).await?.plugin_installation_id.is_some() {
        return state
            .plugins
            .invoke_capability_display_from(window.label(),
                &session_id,
                "session.tree",
                serde_json::json!({"action":"navigate","entryId":entry_id,"summarize":summarize,"customInstructions":custom_instructions,"replaceInstructions":replace_instructions}),
            )
            .await
            .map_err(ui_i18n::session_operation_message);
    }
    Err(ui_i18n::session_operation_error("native.tree.navigationHistoryOnly","legacy Pi session is history-only; tree navigation requires a new Pi SDK plugin session"))
}

fn find_executable(name: &str) -> Option<PathBuf> {
    if name == "node" { return node_runtime::executable(); }
    for directory in env::split_paths(&executable_search_path()) {
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

pub(crate) fn executable_search_path() -> std::ffi::OsString {
    let inherited = executable_search_path_from(
        env::var_os("PATH"),
        env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")),
    );
    let mut paths = Vec::new();
    if let Some(node) = node_runtime::executable() {
        if let Some(parent) = node.parent() { paths.push(parent.to_path_buf()); }
    }
    paths.extend(env::split_paths(&inherited));
    env::join_paths(paths).unwrap_or(inherited)
}

fn executable_search_path_from(
    inherited: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> std::ffi::OsString {
    let mut directories: Vec<PathBuf> = inherited
        .as_ref()
        .map(|path| env::split_paths(path).collect())
        .unwrap_or_default();
    let mut append = |path: PathBuf| {
        if !directories.contains(&path) {
            directories.push(path);
        }
    };

    #[cfg(target_os = "macos")]
    {
        append(PathBuf::from("/opt/homebrew/bin"));
        append(PathBuf::from("/usr/local/bin"));
    }
    if let Some(home) = home {
        let home = PathBuf::from(home);
        #[cfg(windows)]
        for relative in ["AppData/Local/nvs/default", "AppData/Roaming/npm"] {
            append(home.join(relative));
        }
        for relative in [
            ".local/bin",
            ".volta/bin",
            ".asdf/shims",
            ".local/share/fnm/aliases/default/bin",
        ] {
            append(home.join(relative));
        }
        if let Ok(versions) = fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<_> = versions
                .flatten()
                .filter_map(|entry| {
                    let version = entry.file_name();
                    let version = version.to_string_lossy();
                    semver::Version::parse(version.trim_start_matches('v'))
                        .ok()
                        .map(|version| (version, entry.path()))
                })
                .collect();
            versions.sort_by(|left, right| right.0.cmp(&left.0));
            for (_, version) in versions {
                append(version.join("bin"));
            }
        }
    }
    env::join_paths(directories).unwrap_or_else(|_| inherited.unwrap_or_default())
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
        let message = ui_i18n::HostMessage::with_diagnostic("native.diagnostics.executableMissing",serde_json::json!({"label":label}),format!("{label} executable was not found on PATH."));
        return AgentDiagnostic {
            agent: agent.to_owned(),
            label: label.to_owned(),
            status: "missing".to_owned(),
            executable: None,
            version: None,
            capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
            auth_state: "delegated".to_owned(),
            message: Some(message.diagnostic),
            localized_message: message.localized,
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
            let message = ui_i18n::HostMessage::with_diagnostic("native.diagnostics.authStore",serde_json::json!({}),"Authentication remains in the native agent store.");
            AgentDiagnostic {
                agent: agent.to_owned(),
                label: label.to_owned(),
                status: "ready".to_owned(),
                executable: Some(path.to_string_lossy().into_owned()),
                version,
                capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
                auth_state: "delegated".to_owned(),
                message: Some(message.diagnostic),
                localized_message: message.localized,
            }
        }
        Ok(output) => {
            let message = ui_i18n::HostMessage::with_diagnostic("native.diagnostics.probeExit",serde_json::json!({"label":label,"status":output.status.to_string()}),format!("{label} --version exited with {}.", output.status));
            AgentDiagnostic {
                agent: agent.to_owned(),
                label: label.to_owned(),
                status: "error".to_owned(),
                executable: Some(path.to_string_lossy().into_owned()),
                version: None,
                capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
                auth_state: "delegated".to_owned(),
                message: Some(message.diagnostic),
                localized_message: message.localized,
            }
        },
        Err(error) => {
            let message = ui_i18n::HostMessage::with_diagnostic("native.diagnostics.probeRun",serde_json::json!({"label":label,"error":error.to_string()}),format!("Unable to run {label}: {error}"));
            AgentDiagnostic {
                agent: agent.to_owned(),
                label: label.to_owned(),
                status: "error".to_owned(),
                executable: Some(path.to_string_lossy().into_owned()),
                version: None,
                capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
                auth_state: "delegated".to_owned(),
                message: Some(message.diagnostic),
                localized_message: message.localized,
            }
        },
    }
}

fn probe_pi() -> AgentDiagnostic {
    let cli_path = find_executable("pi");
    let node_path = find_executable("node");
    pi_diagnostic(cli_path,node_path)
}

fn pi_diagnostic(cli_path: Option<PathBuf>, node_path: Option<PathBuf>) -> AgentDiagnostic {
    let host_ready = node_path.is_some();
    let (key,diagnostic) = if host_ready {
        if cli_path.is_some() { ("native.diagnostics.piReady","Project-locked SDK host ready; workspace writes are mediated by Aibo Core; Pi has no native sandbox.") }
        else { ("native.diagnostics.piReadyOptional","Project-locked SDK host ready; workspace writes are mediated by Aibo Core; global Pi CLI is optional; Pi has no native sandbox.") }
    } else { ("native.diagnostics.piNodeRequired","Node.js is required to start the project-locked Pi SDK host.") };
    let message = ui_i18n::HostMessage::with_diagnostic(key,serde_json::json!({}),diagnostic);
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
        message: Some(message.diagnostic),
        localized_message: message.localized,
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
                warnings.push(ui_i18n::HostMessage::new("native.inventory.skillRead",serde_json::json!({"path":relative_directory,"error":error.to_string()})));
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(ui_i18n::HostMessage::new("native.inventory.skillRead",serde_json::json!({"path":relative_directory,"error":error.to_string()})));
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
                warnings.push(ui_i18n::HostMessage::new("native.inventory.mcpRead",serde_json::json!({"path":relative,"error":error.to_string()})));
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                warnings.push(ui_i18n::HostMessage::new("native.inventory.mcpRead",serde_json::json!({"path":relative,"error":error.to_string()})));
                continue;
            }
        };
        let value: serde_json::Value = match serde_json::from_str(&contents) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(ui_i18n::HostMessage::new("native.inventory.mcpJson",serde_json::json!({"path":relative,"error":error.to_string()})));
                continue;
            }
        };
        let Some(servers) = value
            .get("mcpServers")
            .or_else(|| value.get("servers"))
            .and_then(serde_json::Value::as_object)
        else {
            warnings.push(ui_i18n::HostMessage::new("native.inventory.mcpServers",serde_json::json!({"path":relative})));
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

    let localized_warnings = warnings.iter().map(ui_i18n::HostMessage::display).collect();
    let warnings = warnings.into_iter().map(|warning| warning.diagnostic).collect();

    WorkspaceCapabilityInventory {
        workspace_id: String::new(),
        inspected_at: now_iso(),
        instructions,
        skills,
        tools,
        mcp_servers,
        warnings,
        localized_warnings,
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

#[tauri::command]
async fn get_turn_change_set(
    session_id: String,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<TurnChangeSet>, CoreError> {
    turn_changes::get_turn_change_set(session_id, turn_id, &state.db).await
}

#[tauri::command]
async fn list_turn_checkpoints(
    session_id: String,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<CheckpointFile>, CoreError> {
    turn_changes::list_turn_checkpoints(session_id, turn_id, &state.db).await
}

#[tauri::command]
async fn list_restore_operations(
    session_id: String,
    turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RestoreOperation>, CoreError> {
    turn_changes::list_restore_operations(session_id, turn_id, &state.db).await
}

#[tauri::command]
async fn get_turn_file_diff(
    session_id: String,
    turn_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<TurnFileDiff, CoreError> {
    turn_changes::get_turn_file_diff(session_id, turn_id, path, &state.db, &state.data_dir).await
}

#[tauri::command]
async fn register_session_attachments(
    session_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ContextAttachment>, CoreError> {
    session_attachments::register_session_attachments(session_id, paths, &state.db).await
}

#[tauri::command]
async fn list_session_attachments(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ContextAttachment>, CoreError> {
    session_attachments::list_session_attachments(session_id, &state.db).await
}

#[tauri::command]
async fn remove_session_attachment(
    session_id: String,
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    session_attachments::remove_session_attachment(session_id, attachment_id, &state.db, &state.data_dir).await
}

#[tauri::command]
async fn validate_session_attachments(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ContextAttachmentValidation>, CoreError> {
    session_attachments::validate_session_attachments(session_id, &state.db).await
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
        .register_uri_scheme_protocol("aibo-tool", |context, request| tool_views::document(context.webview_label(),request.uri().path()))
        .manage(ui_i18n::WindowLanguages::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    if tool_views::close_matching(window.app_handle(),Some(window.label()),None,None,None,true).await.unwrap_or(false) { let _ = window.destroy(); }
                });
            }
            if matches!(event, tauri::WindowEvent::Destroyed) { window.state::<ui_i18n::WindowLanguages>().remove(window.label()); }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|error| {
                Box::new(CoreError::Initialization(format!(
                    "resolve app data directory: {error}"
                ))) as Box<dyn Error>
            })?;
            let data_dir = app_storage::data_dir(data_dir);
            node_runtime::initialize(data_dir.clone());
            let db_path = data_dir.join("aibo.sqlite3");
            let db = tauri::async_runtime::block_on(open_database(&db_path))
                .map_err(|error| Box::new(error) as Box<dyn Error>)?;
            tauri::async_runtime::block_on(plugin_replacement::recover(&db,&data_dir))
                .map_err(|error| Box::new(ui_i18n::initialization_message(error)) as Box<dyn Error>)?;
            tauri::async_runtime::block_on(plugin_registry::install_builtins(&db, &data_dir))
                .map_err(|error| Box::new(CoreError::Initialization(format!("install built-in plugins: {error}"))) as Box<dyn Error>)?;
            tauri::async_runtime::block_on(presentation_packages::register_builtins(&db))
                .map_err(|error| Box::new(CoreError::Initialization(format!("register built-in presentations: {error}"))) as Box<dyn Error>)?;
            if let Err(error)=tauri::async_runtime::block_on(presentation_packages::collect_removed(&db,&data_dir)) {
                warn!(%error,"presentation resource cleanup deferred");
            }
            let recovery = tauri::async_runtime::block_on(session_recovery::recover(&db))
                .map_err(|error| Box::new(CoreError::Initialization(error)) as Box<dyn Error>)?;
            info!(sessions = recovery.sessions, change_sets = recovery.change_sets, "interrupted session recovery complete");
            tauri::async_runtime::block_on(project_actions::recover(&db))
                .map_err(|error| Box::new(CoreError::Initialization(format!("recover project tasks: {error}"))) as Box<dyn Error>)?;
            tauri::async_runtime::block_on(workspace_write_runs::recover(&db))
                .map_err(|error| Box::new(CoreError::Initialization(format!("recover workspace writes: {error}"))) as Box<dyn Error>)?;
            tauri::async_runtime::block_on(capability_broker::Broker::recover(&db))
                .map_err(|error| Box::new(CoreError::Initialization(error)) as Box<dyn Error>)?;
            tauri::async_runtime::block_on(plugin_lifecycle::recover_candidates(&db,&data_dir))
                .map_err(|error| Box::new(CoreError::Initialization(error)) as Box<dyn Error>)?;
            if let Err(error) = tauri::async_runtime::block_on(plugin_registry::collect_retired(&db, &data_dir)) {
                warn!(%error, "retired plugin collection deferred");
            }
            info!(path = %db_path.display(), "aibo core initialized");
            let sdk_module=[app.path().resource_dir().ok().map(|dir|dir.join("pi-sdk-bundle/index.js")),Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js"))].into_iter().flatten().find(|path|path.is_file());
            let broker=capability_broker::Broker::new(db.clone()).with_sdk_module(sdk_module);
            app.manage(AppState {
                capability_broker: broker.clone(),
                semantic_git: semantic_git::GitPresentation::default(),
                semantic_plugins: semantic_plugins::SemanticPlugins::default(),
                plugins: session_host::SessionHost::with_app(db.clone(),broker,app.handle().clone()),
                db,
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ui_i18n::set_window_locale,
            semantic_plugins::cancel_semantic_open,
            semantic_plugins::list_semantic_contributions,
            semantic_plugins::open_semantic_contribution,
            semantic_plugins::act_semantic_contribution,
            semantic_plugins::writes::write_semantic_contribution,
            semantic_plugins::release_semantic_contribution,
            semantic_git::open_semantic_git,
            semantic_git::act_semantic_git,
            semantic_git::release_semantic_git,
            list_capability_providers,
            bind_capability_provider,
            invoke_capability,
            cancel_capability,
            list_capability_events,
            list_capability_history_scopes,
            read_capability_history,
            list_plugin_installations,
            plugin_authentication_action,
            preview_plugin_removal,
            migrate_plugin_sessions,
            read_agent_settings,
            save_agent_settings,
            list_presentation_packages,
            install_presentation_package,
            read_presentation_package,
            set_presentation_package_enabled,
            uninstall_presentation_package,
            preview_presentation_removal,
            get_presentation_selection,
            select_presentation_package,
            install_agent_plugin,
            preview_plugin_install,
            list_plugin_undo_targets,
            undo_plugin_replacement,
            set_agent_plugin_enabled,
            uninstall_agent_plugin,
            create_agent_session,
            send_agent_prompt,
            cancel_agent_turn,
            resume_agent_session,
            close_agent_session,
            invoke_agent_capability,
            list_workspaces,
            search_workspace_paths,
            search_global,
            search_global_files,
            search_global_assets,
            cancel_global_file_search,
            read_search_result,
            read_linked_file,
            add_workspace,
            host_confirmation::read_host_confirmation_preferences,
            host_confirmation::save_host_confirmation_preference,
            read_session_reference_preferences,
            save_session_reference_preferences,
            read_workspace_preferences,
            save_workspace_preferences,
            set_workspace_trust,
            tool_views::open_tool_view,
            tool_views::request_tool_view,
            tool_views::close_tool_view,
            remove_workspace,
            open_workspace_location,
            node_runtime::get_node_runtime,
            node_runtime::select_node_runtime,
            node_runtime::download_node_runtime,
            probe_agents,
            inspect_workspace_capabilities,
            get_app_snapshot,
            resolve_execution_profile,
            get_session_execution_profile,
            update_session_execution_profile,
            list_sessions,
            get_timeline,
            get_subagent_history,
            read_session_history,
            read_session_history_around,
            get_turn_change_set,
            list_turn_checkpoints,
            list_restore_operations,
            restore_turn_change_set,
            get_workspace_changes,
            git_repositories::list_workspace_git_repositories,
            get_workspace_file_diff,
            apply_workspace_git_file_action,
            apply_workspace_git_action,
            commit_workspace_changes,
            list_workspace_git_branches,
            checkout_workspace_git_branch,
            create_workspace_git_branch,
            list_workspace_git_history,
            list_workspace_git_commit_files,
            get_workspace_git_commit_file_diff,
            get_workspace_git_remote_status,
            sync_workspace_git,
            list_workspace_git_stashes,
            apply_workspace_git_stash,
            stash_workspace_git,
            get_turn_file_diff,
            apply_git_hunk_action,
            apply_git_file_action,
            register_session_attachments,
            register_session_clipboard_images,
            get_session_attachment_preview,
            reference_session,
            list_session_attachments,
            remove_session_attachment,
            validate_session_attachments,
            get_composer_draft,
            save_composer_draft,
            list_turn_artifacts,
            read_artifact,
            list_project_actions,
            save_project_action,
            delete_project_action,
            run_project_action,
            cancel_project_action,
            list_project_action_runs,
            list_workspace_write_runs,
            cancel_workspace_write,
            rename_session,
            list_codex_threads,
            read_codex_thread,
            fork_codex_thread,
            archive_codex_thread,
            unarchive_codex_thread,
            archive_session,
            unarchive_session,
            resolve_agent_approval,
            resolve_agent_user_input,
            get_session_models,
            get_pi_session_tree,
            navigate_pi_session_tree,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Aibo")
        .run(|app, event| {
            static EXIT_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if EXIT_READY.load(std::sync::atomic::Ordering::SeqCst) { return; }
                api.prevent_exit();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if tool_views::close_matching(&app,None,None,None,None,true).await.unwrap_or(false) {
                        EXIT_READY.store(true,std::sync::atomic::Ordering::SeqCst); app.exit(0);
                    }
                });
            }
        });
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn database_owned_failures_preserve_diagnostics_and_do_not_create_a_database() {
        let root=tempfile::tempdir().unwrap();let blocked=root.path().join("file");std::fs::write(&blocked,"sentinel").unwrap();
        let path=blocked.join("child").join("host.db");
        let error=super::open_database(&path).await.unwrap_err();let payload=serde_json::to_value(error).unwrap();
        assert_eq!(payload["code"],"initialization_error");assert_eq!(payload["localized"]["key"],"native.database.createDirectory");
        let raw=payload["localized"]["params"]["error"].as_str().unwrap();
        assert_eq!(payload["message"],format!("app initialization failed: create app data directory: {raw}"));
        assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&payload["localized"]).ends_with(raw));
        assert_eq!(std::fs::read_to_string(&blocked).unwrap(),"sentinel");assert!(!path.exists());
        let payload=serde_json::to_value(super::open_database(std::path::Path::new("")).await.unwrap_err()).unwrap();
        assert_eq!(payload["message"],"app initialization failed: database path has no parent directory");
        assert_eq!(payload["localized"]["key"],"native.database.parent");
        let db=super::open_database(&root.path().join("valid.db")).await.unwrap();
        let payload=serde_json::to_value(super::workspace_by_path(&db,"missing /{path}").await.unwrap_err()).unwrap();
        assert_eq!(payload["code"],"database_error");assert_eq!(payload["message"],"database error: workspace insert was not readable");
        assert_eq!(payload["localized"]["key"],"native.database.workspaceUnreadable");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM workspaces").fetch_one(&db).await.unwrap(),0);db.close().await;
    }
    use super::{
        auto_name_session_from_first_message,
        canonical_workspace_path, collect_workspace_capabilities,
        executable_search_path_from, find_executable,
        normalize_session_filter, now_iso, open_database,
        persist_restore_operation, session_snapshot_timeline, plugin_model_catalog,
         require_trusted_workspace,
        session_execution_profile, session_label_from_first_message,
        workspace_label, CoreError, SessionListFilter, Workspace,
    };
    use crate::change_set::{
        RestoreReport,
    };
    use crate::execution_profile;
    use sqlx::Row;
    use std::{collections::HashMap, env, fs, path::PathBuf, time::Duration};
    use tokio::io::AsyncWriteExt;
    use ulid::Ulid;

    fn test_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("aibo-phase1-{}", Ulid::new()));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[tokio::test]
    async fn interrupted_subagent_display_preserves_persisted_snapshots_and_reopens_without_provider() {
        use serde_json::{json, Value};
        let directory = test_directory();
        let path = directory.join("aibo.sqlite3");
        let db = open_database(&path).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,'now','now')")
            .bind(directory.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,archived,created_at,updated_at) VALUES('s','w','third.party','原始会话','interrupted',1,'now','now')")
            .execute(&db).await.unwrap();
        let base = json!({"id":"child","parentId":"parent","rootTurnId":"turn","name":"名称原文 {name}","task":"任务原文 {task}","activity":"提供者活动 {activity}","providerExtra":{"content":"过程原文 {content}"}});
        let mut fixtures = Vec::new();
        for (index, (task_status, message_status, tool)) in [
            ("pending","failed","subagent"),("running","failed","subagent"),("waiting","failed","subagent"),
            ("completed","failed","subagent"),("failed","failed","subagent"),("interrupted","failed","subagent"),
            ("running","streaming","subagent"),("running","failed","shell"),
        ].into_iter().enumerate() {
            let mut task = base.clone(); task["status"] = json!(task_status);
            fixtures.push((format!("card-{index}"),task.to_string(),message_status,tool,index < 3));
        }
        fixtures.push(("malformed".into(),"not JSON".into(),"failed","subagent",false));
        for (id,content,status,tool,_) in &fixtures {
            sqlx::query("INSERT INTO messages(id,session_id,role,tool_name,content,status,created_at,updated_at) VALUES(?,'s','system',?,?,?,'2026-10-09','2026-10-09')")
                .bind(id).bind(tool).bind(content).bind(status).execute(&db).await.unwrap();
        }
        db.close().await;
        for _ in 0..2 {
            let db = open_database(&path).await.unwrap();
            let page = serde_json::to_value(crate::session_history::read(&db,"w".into(),"s".into(),None).await.unwrap()).unwrap();
            let around = serde_json::to_value(crate::session_history::around(&db,"w".into(),"s".into(),"card-0".into()).await.unwrap()).unwrap();
            assert_eq!(page["items"],around["items"]);
            for (id,raw,status,_,localized) in &fixtures {
                let item = page["items"].as_array().unwrap().iter().find(|item|item["id"]==*id).unwrap();
                assert_eq!(item["status"],*status);
                let stored: String = sqlx::query_scalar("SELECT content FROM messages WHERE id=?").bind(id).fetch_one(&db).await.unwrap();
                assert_eq!(&stored,raw);
                if *localized {
                    let task: Value = serde_json::from_str(item["content"].as_str().unwrap()).unwrap();
                    let mut expected: Value = serde_json::from_str(raw).unwrap();
                    expected["status"] = json!("interrupted"); expected["activity"] = json!("执行已中断，已保留收到的过程记录。");
                    assert_eq!(task,expected);
                    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&item["localizedActivity"]),"Execution was interrupted. The received process records have been retained.");
                    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&item["localizedActivity"]),task["activity"].as_str().unwrap());
                } else {
                    assert_eq!(item["content"],*raw); assert!(item.get("localizedActivity").is_none());
                }
            }
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM turns").fetch_one(&db).await.unwrap(),0);
            db.close().await;
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires an isolated SQLite backup in AIBO_MIGRATION_PROBE_DB"]
    fn database_upgrade_snapshot_probe() {
        let path = PathBuf::from(env::var("AIBO_MIGRATION_PROBE_DB").expect("isolated backup path"));
        tauri::async_runtime::block_on(async {
            let pool = open_database(&path).await.expect("existing database must upgrade and reopen");
            pool.close().await;
        });
    }

    #[tokio::test]
    async fn invalid_workspace_additions_preserve_existing_rows_and_allow_later_valid_addition() {
        use crate::ui_i18n::{Locale, render};
        let directory = tempfile::tempdir().unwrap();
        let db = open_database(&directory.path().join("app.db")).await.unwrap();
        let existing = directory.path().join("现有{path}");
        fs::create_dir(&existing).unwrap();
        let original = super::add_workspace_in_db(existing.to_str().unwrap(), &db).await.unwrap();
        let snapshot = sqlx::query_scalar::<_,String>("SELECT json_object('id',id,'path',path,'label',label,'trusted',trusted,'createdAt',created_at,'updatedAt',updated_at,'lastOpenedAt',last_opened_at) FROM workspaces ORDER BY id").fetch_all(&db).await.unwrap();
        let file = directory.path().join("文件{path}.txt");
        fs::write(&file, "原始正文").unwrap();
        let missing = directory.path().join("不存在{error}");
        let os_error = fs::canonicalize(&missing).unwrap_err().to_string();
        for (path, key, diagnostic) in [
            ("   ".to_owned(), "native.workspace.emptyPath", "path must not be empty".to_owned()),
            (format!("  {}  ",file.display()), "native.workspace.notDirectory", format!("{} is not a directory",file.display())),
            (format!("  {}  ",missing.display()), "native.workspace.inaccessible", format!("{} is not accessible: {os_error}",missing.display())),
        ] {
            let error = super::add_workspace_in_db(&path, &db).await.unwrap_err();
            let value = serde_json::to_value(error).unwrap();
            assert_eq!(value["code"], "invalid_workspace_path");
            assert_eq!(value["message"], format!("invalid workspace path: {diagnostic}"));
            assert_eq!(value["localized"]["key"], key);
            assert_eq!(render(Locale::En, &value["localized"]), diagnostic);
            if key != "native.workspace.emptyPath" {
                assert_eq!(value["localized"]["params"]["path"], path.trim());
                assert!(render(Locale::ZhCn, &value["localized"]).contains(path.trim()));
            }
            if key == "native.workspace.inaccessible" { assert_eq!(value["localized"]["params"]["error"], os_error); }
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT json_object('id',id,'path',path,'label',label,'trusted',trusted,'createdAt',created_at,'updatedAt',updated_at,'lastOpenedAt',last_opened_at) FROM workspaces ORDER BY id").fetch_all(&db).await.unwrap(), snapshot);
            assert_eq!(fs::read_to_string(&file).unwrap(), "原始正文");
            assert!(!missing.exists());
        }
        let valid = directory.path().join("正常{path}");
        fs::create_dir(&valid).unwrap();
        let added = super::add_workspace_in_db(&format!("  {}  ",valid.display()), &db).await.unwrap();
        assert_eq!(added.path, fs::canonicalize(&valid).unwrap().to_string_lossy());
        assert_eq!(added.label, "正常{path}");
        let repeated = super::add_workspace_in_db(valid.to_str().unwrap(), &db).await.unwrap();
        assert_eq!(repeated.id, added.id);
        assert_ne!(original.id, added.id);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM workspaces").fetch_one(&db).await.unwrap(), 2);
        db.close().await;
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
    fn first_message_session_label_is_compact_and_bounded() {
        assert_eq!(
            session_label_from_first_message("  分析一下\n这个项目  ").as_deref(),
            Some("分析一下 这个项目")
        );
        assert_eq!(
            session_label_from_first_message(
                "解释项目\n\n[AIBO_CONTEXT_ATTACHMENTS]\n- src/lib.rs"
            )
            .as_deref(),
            Some("解释项目")
        );
        let label = session_label_from_first_message(&"会".repeat(45)).expect("label");
        assert_eq!(label.chars().count(), 40);
        assert!(label.ends_with('…'));
    }

    #[test]
    fn auto_name_only_replaces_default_label_for_first_user_message() {
        tauri::async_runtime::block_on(async {
            let directory = test_directory();
            let database_path = directory.join("aibo.sqlite3");
            let pool = open_database(&database_path).await.expect("database");
            let now = now_iso();
            let directory_path = directory.to_string_lossy().to_string();
            sqlx::query(
                "INSERT INTO workspaces (id, path, label, trusted, created_at, updated_at)
                 VALUES ('workspace', ?, 'demo', 1, ?, ?)",
            )
            .bind(&directory_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("workspace");
            for (id, label) in [
                ("default", "Codex · demo"),
                ("manual", "我的会话"),
                ("existing", "Pi · demo"),
            ] {
                let agent = if id == "existing" { "pi" } else { "codex" };
                sqlx::query(
                    "INSERT INTO sessions
                       (id, workspace_id, agent, label, state, created_at, updated_at)
                     VALUES (?, 'workspace', ?, ?, 'idle', ?, ?)",
                )
                .bind(id)
                .bind(agent)
                .bind(label)
                .bind(&now)
                .bind(&now)
                .execute(&pool)
                .await
                .expect("session");
            }
            for (id, session_id, content) in [
                ("first", "default", "首条消息"),
                ("manual-first", "manual", "不会覆盖"),
                ("existing-first", "existing", "已有消息"),
                ("existing-second", "existing", "第二条消息"),
            ] {
                sqlx::query(
                    "INSERT INTO messages
                       (id, session_id, role, content, status, created_at, updated_at)
                     VALUES (?, ?, 'user', ?, 'completed', ?, ?)",
                )
                .bind(id)
                .bind(session_id)
                .bind(content)
                .bind(&now)
                .bind(&now)
                .execute(&pool)
                .await
                .expect("message");
            }

            assert!(
                auto_name_session_from_first_message(&pool, "default", "first", "首条消息")
                    .await
                    .expect("auto name")
            );
            assert!(!auto_name_session_from_first_message(
                &pool,
                "manual",
                "manual-first",
                "不会覆盖"
            )
            .await
            .expect("manual name"));
            assert!(!auto_name_session_from_first_message(
                &pool,
                "existing",
                "existing-second",
                "第二条消息"
            )
            .await
            .expect("existing messages"));

            let labels = sqlx::query("SELECT id, label FROM sessions ORDER BY id")
                .fetch_all(&pool)
                .await
                .expect("labels")
                .into_iter()
                .map(|row| (row.get::<String, _>("id"), row.get::<String, _>("label")))
                .collect::<HashMap<_, _>>();
            assert_eq!(labels.get("default").map(String::as_str), Some("首条消息"));
            assert_eq!(labels.get("manual").map(String::as_str), Some("我的会话"));
            assert_eq!(
                labels.get("existing").map(String::as_str),
                Some("Pi · demo")
            );
            pool.close().await;
            fs::remove_dir_all(directory).expect("remove test directory");
        });
    }

    #[test]
    fn finds_a_known_executable_without_shelling_out() {
        assert!(find_executable("sh").is_some() || cfg!(windows));
    }

    #[test]
    fn executable_search_path_adds_gui_missing_user_tool_directories() {
        let home = if cfg!(windows) { PathBuf::from(r"C:\Users\aibo-test") } else { PathBuf::from("/Users/aibo-test") };
        let first = PathBuf::from("first");
        let path = executable_search_path_from(
            Some(env::join_paths([first.clone(), PathBuf::from("second")]).unwrap()),
            Some(home.as_os_str().to_owned()),
        );
        let directories: Vec<_> = env::split_paths(&path).collect();
        assert_eq!(directories[0], first);
        assert!(directories.contains(&home.join(".local/bin")));
        assert!(directories.contains(&home.join(".volta/bin")));
        #[cfg(windows)]
        assert!(directories.contains(&home.join("AppData/Local/nvs/default")));
        #[cfg(target_os = "macos")]
        assert!(directories.contains(&PathBuf::from("/opt/homebrew/bin")));
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

    #[tokio::test]
    async fn workspace_git_index_actions_stage_and_unstage_files() {
        let root = test_directory();
        let root_path = root.to_str().unwrap();
        fs::write(root.join("tracked.txt"), "baseline").expect("tracked file");
        assert!(std::process::Command::new("git")
            .args(["-C", root_path, "init", "-q"])
            .status()
            .unwrap()
            .success());
        assert!(std::process::Command::new("git")
            .args(["-C", root_path, "add", "tracked.txt"])
            .status()
            .unwrap()
            .success());
        assert!(std::process::Command::new("git")
            .args([
                "-C",
                root_path,
                "-c",
                "user.name=Aibo",
                "-c",
                "user.email=aibo@example.invalid",
                "commit",
                "-qm",
                "initial",
            ])
            .status()
            .unwrap()
            .success());
        fs::write(root.join("tracked.txt"), "changed").expect("modified file");

        assert!(
            crate::workspace_git::apply_git_index_action(root_path, "tracked.txt", "stage", None).await
                .expect("stage")
                .applied
        );
        let staged = std::process::Command::new("git")
            .args(["-C", root_path, "status", "--porcelain=v1", "tracked.txt"])
            .output()
            .expect("staged status");
        assert!(String::from_utf8_lossy(&staged.stdout).starts_with("M "));

        assert!(
            crate::workspace_git::apply_git_index_action(root_path, "tracked.txt", "unstage", None).await
                .expect("unstage")
                .applied
        );
        let unstaged = std::process::Command::new("git")
            .args(["-C", root_path, "status", "--porcelain=v1", "tracked.txt"])
            .output()
            .expect("unstaged status");
        assert!(String::from_utf8_lossy(&unstaged.stdout).starts_with(" M"));
        fs::remove_dir_all(root).expect("cleanup");
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
            "composer_drafts",
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
            ("composer_drafts", "schema_version"),
            ("composer_drafts", "text"),
            ("composer_drafts", "send_failed"),
            ("composer_drafts", "updated_at"),
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
                approval_reviewer: "user".to_owned(),
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
        // A declared control can combine full filesystem access with disabled
        // commands/network; filesystem authority alone still requires trust.
        let mut full_access = profile.clone();
        full_access.enforced.filesystem_policy = "danger-full-access".into();
        full_access.enforced.command_policy = "disabled".into();
        full_access.enforced.network_policy = "disabled".into();
        assert!(matches!(require_trusted_workspace(&workspace, &full_access), Err(CoreError::WorkspaceTrustRequired)));
    }

    #[test]
    fn runtime_diagnostics_preserve_original_messages_and_probe_results() {
        use crate::ui_i18n::{render,Locale};
        let label="程序原文 {label}";
        let missing=super::probe_binary(&format!("aibo-missing-{}",Ulid::new()),label,&["capability.raw"]);
        assert_eq!(missing.status,"missing");assert_eq!(missing.message.as_deref(),Some(format!("{label} executable was not found on PATH.").as_str()));
        assert_eq!(missing.capabilities,["capability.raw"]);
        assert_eq!(render(Locale::En,missing.localized_message.as_ref().unwrap()),missing.message.unwrap());
        assert_eq!(render(Locale::ZhCn,missing.localized_message.as_ref().unwrap()),format!("未在 PATH 中找到 {label} 可执行文件。"));
        for (cli,node,key,diagnostic) in [
            (true,true,"native.diagnostics.piReady","Project-locked SDK host ready; workspace writes are mediated by Aibo Core; Pi has no native sandbox."),
            (false,true,"native.diagnostics.piReadyOptional","Project-locked SDK host ready; workspace writes are mediated by Aibo Core; global Pi CLI is optional; Pi has no native sandbox."),
            (false,false,"native.diagnostics.piNodeRequired","Node.js is required to start the project-locked Pi SDK host."),
        ] {
            let value=super::pi_diagnostic(cli.then(||PathBuf::from("/raw/pi")),node.then(||PathBuf::from("/raw/node")));
            assert_eq!(value.status,if node {"ready"}else{"missing"});assert_eq!(value.message.as_deref(),Some(diagnostic));
            assert_eq!(value.localized_message.as_ref().unwrap()["key"],key);
            assert_eq!(render(Locale::En,value.localized_message.as_ref().unwrap()),diagnostic);
            assert_eq!(value.version.as_deref(),Some(format!("SDK {}",super::PI_SDK_VERSION).as_str()));
            assert_eq!(value.executable.as_deref(),node.then_some("/raw/node"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn executable_diagnostics_keep_exit_status_version_and_io_error_raw() {
        use crate::ui_i18n::{render,Locale};
        use std::os::unix::fs::PermissionsExt;
        let directory=test_directory();let program=directory.join("probe");
        for (body,key,status,version) in [
            ("#!/bin/sh\nprintf 'version {raw}\\n'\n","native.diagnostics.authStore","ready",Some("version {raw}")),
            ("#!/bin/sh\nprintf 'secret-output' >&2\nexit 7\n","native.diagnostics.probeExit","error",None),
            ("#!/aibo-test-nonexistent-interpreter-9c9ea001\n","native.diagnostics.probeRun","error",None),
        ] {
            fs::write(&program,body).unwrap();fs::set_permissions(&program,fs::Permissions::from_mode(0o700)).unwrap();
            let value=super::probe_binary(program.to_str().unwrap(),"程序原文 {label}",&["capability.raw"]);
            assert_eq!(value.status,status);assert_eq!(value.version.as_deref(),version);
            assert_eq!(value.executable.as_deref(),program.to_str());
            let display=value.localized_message.as_ref().unwrap();assert_eq!(display["key"],key);
            assert_eq!(render(Locale::En,display),*value.message.as_ref().unwrap());
            assert_ne!(render(Locale::ZhCn,display),*value.message.as_ref().unwrap());
            assert!(!serde_json::to_value(value).unwrap().to_string().contains("secret-output"));
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn workspace_open_and_search_errors_keep_original_codes_and_diagnostics() {
        use crate::ui_i18n::{self,HostMessage};
        for (key,diagnostic) in [
            ("native.workspace.editorMac","未配置编辑器；请设置 AIBO_EDITOR（macOS 应填写应用名或 .app 路径）"),
            ("native.workspace.editorWindows","未配置编辑器；请设置 AIBO_EDITOR（Windows 应填写编辑器可执行文件路径）"),
            ("native.workspace.editorUnix","未配置编辑器；请设置 AIBO_EDITOR（填写可执行文件路径）"),
        ] {
            let error=ui_i18n::initialization_message(HostMessage::new(key,serde_json::json!({})));
            let original=serde_json::to_value(CoreError::Initialization(diagnostic.into())).unwrap();
            let value=serde_json::to_value(error).unwrap();assert_eq!(value["code"],original["code"]);assert_eq!(value["message"],original["message"]);
            assert!(ui_i18n::render(ui_i18n::Locale::En,&value["localized"]).starts_with("No editor is configured."));
        }
        for (error,original) in [
            (ui_i18n::invalid_path_message(HostMessage::with_diagnostic("native.workspace.locationTarget",serde_json::json!({}),"unsupported workspace location target")),CoreError::InvalidWorkspacePath("unsupported workspace location target".into())),
            (ui_i18n::initialization_message(HostMessage::with_diagnostic("native.workspace.openLocation",serde_json::json!({"target":"editor","error":"底层诊断 {error}"}),"open workspace in editor: 底层诊断 {error}")),CoreError::Initialization("open workspace in editor: 底层诊断 {error}".into())),
            (ui_i18n::session_operation_message(HostMessage::new("native.search.requestIdTooLong",serde_json::json!({}))),CoreError::SessionOperation("搜索请求标识过长".into())),
        ] {
            let value=serde_json::to_value(error).unwrap();let raw=serde_json::to_value(original).unwrap();
            assert_eq!(value["code"],raw["code"]);assert_eq!(value["message"],raw["message"]);
            assert!(value["localized"]["key"].as_str().unwrap().starts_with("native."));
        }
    }

    #[test]
    fn workspace_capability_warnings_preserve_raw_diagnostics_and_resource_names() {
        use crate::ui_i18n;
        let directory = test_directory();
        fs::create_dir_all(directory.join(".codex/skills/技能 {id}")).unwrap();
        fs::create_dir_all(directory.join(".pi")).unwrap();
        fs::write(directory.join(".mcp.json"),r#"{"mcpServers":{"服务器原文 {id}":{"command":"secret-command"}}}"#).unwrap();
        let ready = collect_workspace_capabilities(&directory);
        assert_eq!(ready.skills[0].name,"技能 {id}");
        assert_eq!(ready.mcp_servers[0].name,"服务器原文 {id}");
        assert!(ready.warnings.is_empty());
        assert!(serde_json::to_value(ready).unwrap().get("localizedWarnings").is_none());
        fs::write(directory.join(".mcp.json"),r#"{"secret":"not-a-server-or-warning"}"#).unwrap();
        fs::write(directory.join(".codex/mcp.json"),"invalid JSON").unwrap();
        fs::write(directory.join(".pi/mcp.json"),[0xff,0xfe]).unwrap();
        // An ordinary file in place of a parent produces a genuine metadata read error.
        fs::write(directory.join(".aibo"),"do not read this as a directory").unwrap();
        let inventory = collect_workspace_capabilities(&directory);
        assert_eq!(inventory.warnings.len(),inventory.localized_warnings.len());
        assert_eq!(inventory.skills[0].name,"技能 {id}");
        let mut keys = std::collections::HashSet::new();
        for (raw,display) in inventory.warnings.iter().zip(&inventory.localized_warnings) {
            keys.insert(display["key"].as_str().unwrap());
            assert_eq!(ui_i18n::render(ui_i18n::Locale::ZhCn,display),*raw);
            let english = ui_i18n::render(ui_i18n::Locale::En,display);
            assert_ne!(english,*raw);
            let path=display["params"]["path"].as_str().unwrap();
            let error=display["params"]["error"].as_str().unwrap_or_default();
            let legacy = match display["key"].as_str().unwrap() {
                "native.inventory.skillRead" => format!("无法读取技能目录 {path}: {error}"),
                "native.inventory.mcpRead" => format!("无法读取 MCP 配置 {path}: {error}"),
                "native.inventory.mcpJson" => format!("MCP 配置 {path} 不是有效 JSON: {error}"),
                "native.inventory.mcpServers" => format!("MCP 配置 {path} 缺少 mcpServers/servers"),
                key => panic!("unexpected host warning: {key}"),
            };
            assert_eq!(*raw,legacy);
            assert!(raw.contains(path));assert!(english.contains(path));
            if let Some(error)=display["params"]["error"].as_str() { assert!(raw.ends_with(error));assert!(english.ends_with(error)); }
        }
        assert!(keys.contains("native.inventory.mcpServers"));
        assert!(keys.contains("native.inventory.mcpJson"));
        assert!(keys.contains("native.inventory.mcpRead"));
        #[cfg(unix)] assert!(keys.contains("native.inventory.skillRead"));
        let serialized=serde_json::to_value(&inventory).unwrap();
        assert_eq!(serialized["warnings"],serde_json::json!(inventory.warnings));
        assert_eq!(serialized["localizedWarnings"],serde_json::json!(inventory.localized_warnings));
        assert!(!serialized.to_string().contains("not-a-server-or-warning"));
        fs::remove_dir_all(directory).unwrap();
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

    #[test]
    fn session_snapshot_timeline_projects_only_the_active_branch() {
        let snapshot = serde_json::json!({
            "branch": [
                { "id": "user-root", "type": "message", "timestamp": "2026-09-07T00:00:00Z", "role": "user", "summary": "root" },
                { "id": "assistant-tool-call", "type": "message", "timestamp": "2026-09-07T00:00:00Z", "role": "assistant", "summary": "" },
                { "id": "model", "type": "model_change", "timestamp": "2026-09-07T00:00:01Z", "summary": "模型已切换" },
                { "id": "summary", "type": "branch_summary", "timestamp": "2026-09-07T00:00:01Z", "summary": "分支总结" },
                { "id": "assistant-selected", "type": "message", "timestamp": "2026-09-07T00:00:02Z", "role": "assistant", "summary": "selected branch" }
            ],
            "tree": [
                { "id": "user-root", "children": [
                    { "id": "assistant-selected", "children": [] },
                    { "id": "assistant-other", "children": [] }
                ]}
            ]
        });

        let timeline = session_snapshot_timeline(&snapshot, "pi-session");
        assert_eq!(timeline.len(), 4);
        assert_eq!(timeline[0].id, "user-root");
        assert_eq!(timeline[1].role, "system");
        assert_eq!(timeline[1].entry_type.as_deref(), Some("model_change"));
        assert_eq!(timeline[2].entry_type.as_deref(), Some("branch_summary"));
        assert_eq!(timeline[3].content, "selected branch");
        assert!(timeline.iter().all(|item| item.id != "assistant-tool-call"));
        assert!(timeline.iter().all(|item| item.id != "assistant-other"));
    }

    #[test]
    fn session_snapshot_timeline_preserves_structured_assistant_parts() {
        let snapshot = serde_json::json!({"branch": [{
            "id": "mixed", "type": "message", "role": "assistant",
            "timestamp": "2026-09-10T00:00:00Z", "summary": "flattened fallback",
            "parts": [
                {"role": "system", "type": "reasoning", "toolName": "reasoning", "summary": "思考内容未显示"},
                {"role": "tool", "type": "tool_call", "toolName": "read", "summary": "{\"path\":\"README.md\"}"},
                {"role": "assistant", "type": "message", "summary": "我先查看文件。"}
            ]
        }]});
        let timeline = session_snapshot_timeline(&snapshot, "session");
        assert_eq!(timeline.len(), 3);
        assert_eq!(timeline[0].role, "system");
        assert_eq!(timeline[0].tool_name.as_deref(), Some("reasoning"));
        assert_eq!(timeline[1].role, "tool");
        assert_eq!(timeline[1].entry_type.as_deref(), Some("tool_call"));
        assert_eq!(timeline[1].tool_name.as_deref(), Some("read"));
        assert_eq!(timeline[2].role, "assistant");
        assert_eq!(timeline[2].content, "我先查看文件。");
        assert_eq!(timeline[2].tool_name, None);
        assert_ne!(timeline[0].id, timeline[1].id);
        assert_ne!(timeline[1].id, timeline[2].id);
        assert!(timeline.iter().all(|item| item.created_at == "2026-09-10T00:00:00Z"));
    }

    #[test]
    fn plugin_model_catalog_context_windows_are_optional_and_model_specific() {
        let catalog = plugin_model_catalog(&serde_json::json!({
            "models":[{"id":"model","contextWindows":[
                {"id":"standard","label":"128K","tokens":128000},
                {"id":"long","label":"1M","description":"Extended context","tokens":1000000},
                {"id":"unknown","tokens":-1}, {"id":""}
            ]},{"id":"legacy"}], "current":"model", "currentContextWindow":"long"
        }), None).unwrap();
        assert_eq!(catalog.current_context_window.as_deref(), Some("long"));
        assert_eq!(catalog.models[0].context_windows.len(), 3);
        assert_eq!(catalog.models[0].context_windows[1].tokens, Some(1000000));
        assert_eq!(catalog.models[0].context_windows[1].label, "1M");
        assert_eq!(catalog.models[0].context_windows[2].tokens, None);
        assert!(catalog.models[1].context_windows.is_empty());
        let old = plugin_model_catalog(&serde_json::json!({"models":[{"id":"old"}]}), None).unwrap();
        assert_eq!(old.current_context_window, None);
        assert!(old.models[0].context_windows.is_empty());
    }

    #[test]
    fn plugin_model_catalog_validates_parameter_scope_and_keeps_legacy_matrix() {
        let mut value = serde_json::json!({"models":[{"id":"one"},{"id":"two"}],"current":"one"});
        assert_eq!(plugin_model_catalog(&value, None).unwrap().parameter_scope, "all-models");
        for scope in ["all-models", "current-model"] {
            value["parameterScope"] = serde_json::json!(scope);
            let catalog = plugin_model_catalog(&value, None).unwrap();
            assert_eq!(serde_json::to_value(catalog).unwrap()["parameterScope"], scope);
        }
        for invalid in [serde_json::json!("matrix"), serde_json::json!(null), serde_json::json!(true)] {
            value["parameterScope"] = invalid;
            let original=value.clone();
            let error=serde_json::to_value(plugin_model_catalog(&value,None).unwrap_err()).unwrap();
            assert_eq!(error["code"],"session_operation_error");
            assert_eq!(error["message"],"session operation failed: plugin model catalog returned invalid parameterScope");
            assert_eq!(error["localized"]["key"],"native.models.parameterScope");
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&error["localized"]),"插件模型目录返回了无效的 parameterScope。");
            assert_eq!(value,original);
        }
    }

    #[test]
    fn plugin_model_catalog_missing_models_keeps_diagnostic_and_owned_display() {
        for value in [serde_json::json!({}),serde_json::json!({"models":null}),serde_json::json!({"models":"提供者原文 {models}"})] {
            let original=value.clone();
            let payload=serde_json::to_value(plugin_model_catalog(&value,None).unwrap_err()).unwrap();
            assert_eq!(payload["code"],"session_operation_error");
            assert_eq!(payload["message"],"session operation failed: plugin model catalog did not return models");
            assert_eq!(payload["localized"]["key"],"native.models.missingModels");
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&payload["localized"]),"The plugin model catalog did not return a model list.");
            assert_eq!(value,original);
        }
        assert!(plugin_model_catalog(&serde_json::json!({"models":[]}),None).unwrap().models.is_empty());
    }

    #[test]
    fn plugin_model_catalog_normalizes_provider_and_reasoning_shapes() {
        let catalog = plugin_model_catalog(
            &serde_json::json!({
                "models": [{
                    "provider": "openai",
                    "id": "gpt-5",
                    "displayName": "GPT-5",
                    "isDefault": true,
                    "supportedReasoningEfforts": ["low", {"id": "high", "label": "High"}],
                    "serviceTiers": [{"id": "priority", "name": "Fast", "description": "Faster responses"}]
                }],
                "currentServiceTier": "priority"
            }),
            Some(&serde_json::json!({"current": "high", "levels": ["low", "high"]})),
        )
        .expect("normalize plugin model catalog");

        assert_eq!(catalog.current.as_ref().map(|model| model.reference.as_str()), Some("openai/gpt-5"));
        assert_eq!(catalog.models[0].reasoning_efforts[1].label, "High");
        assert_eq!(catalog.current_reasoning_effort.as_deref(), Some("high"));
        assert_eq!(catalog.reasoning_efforts.len(), 2);
        assert_eq!(catalog.models[0].service_tiers[0].id, "priority");
        assert_eq!(catalog.current_service_tier.as_deref(), Some("priority"));
    }

    #[test]
    fn plugin_model_catalog_preserves_pi_per_model_reasoning_matrix() {
        let catalog = plugin_model_catalog(
            &serde_json::json!({
                "current": {"provider": "test", "id": "plain"},
                "models": [
                    {"provider": "test", "id": "plain", "reasoning": false},
                    {"provider": "test", "id": "thinking", "reasoning": true},
                    {"provider": "test", "id": "extended", "reasoning": true,
                     "thinkingLevelMap": {"minimal": null, "xhigh": "xhigh", "max": "max"}},
                    {"provider": "test", "id": "explicit", "reasoning": true,
                     "reasoningEfforts": []}
                ]
            }),
            Some(&serde_json::json!({"current": "off", "levels": ["off"]})),
        ).expect("normalize Pi SDK model descriptors");
        let efforts = |index: usize| catalog.models[index].reasoning_efforts.iter()
            .map(|option| option.id.as_str()).collect::<Vec<_>>();
        assert_eq!(efforts(0), vec!["off"]);
        assert_eq!(efforts(1), vec!["off", "minimal", "low", "medium", "high"]);
        assert_eq!(efforts(2), vec!["off", "low", "medium", "high", "xhigh", "max"]);
        assert!(efforts(3).is_empty(), "explicit plugin effort lists take precedence");
        assert_eq!(catalog.current.as_ref().unwrap().reference, "test/plain");
        assert_eq!(catalog.current.as_ref().unwrap().reasoning_efforts[0].id, "off");
        assert_eq!(catalog.current_reasoning_effort.as_deref(), Some("off"));
        assert!(catalog.models.iter().all(|model| model.service_tiers.is_empty()), "Pi does not advertise undiscoverable service tiers");
    }
}

impl CoreError {
    pub(crate) fn is_write_outcome_unknown(&self) -> bool {
        match self {
            Self::WriteOutcomeUnknown(_) => true,
            Self::Localized {error,..} => error.is_write_outcome_unknown(),
            Self::WriteReplay {code,..} => code == "outcome_unknown",
            _ => false,
        }
    }
}
