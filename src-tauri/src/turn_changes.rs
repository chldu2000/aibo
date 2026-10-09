//! Turn change evidence, validated diff sources, and persisted review history.
use crate::{
    change_set::checkpoint_file_path,
    session_by_id,
    text_diff::{parse_unified_hunks, run_unified_text_diff, TurnDiffHunk},
    workspace_by_id, CoreError,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use tokio::io::AsyncReadExt;

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
    pub(crate) capture_error: Option<String>, // Original diagnostic.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_capture_error: Option<serde_json::Value>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_reason: Option<serde_json::Value>,
    pub(crate) created_at: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_conflicts: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_unsupported: Option<Vec<serde_json::Value>>,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFileDiff {
    pub(crate) path: String,
    pub(crate) available: bool,
    pub(crate) diff: String,
    pub(crate) hunks: Vec<TurnDiffHunk>,
    pub(crate) reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_reason: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_suffix: Option<serde_json::Value>,
}

pub(crate) struct TurnDiffSources {
    pub(crate) baseline: Vec<u8>,
    pub(crate) result: Vec<u8>,
    pub(crate) baseline_exists: bool,
    pub(crate) result_exists: bool,
    pub(crate) baseline_dirty: bool,
}

pub(crate) enum TurnDiffSourceError {
    NotChanged,
    Unavailable(crate::ui_i18n::HostMessage),
    UnsafePath(crate::ui_i18n::HostMessage),
    Failed(String),
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

pub(crate) async fn read_turn_diff_file(path: &Path) -> Result<Vec<u8>, std::io::Error> {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let mut bytes = Vec::new();
        tokio::fs::File::open(path)
            .await?
            .take(10 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await?;
        if bytes.len() > 10 * 1024 * 1024 {
            return Err(std::io::Error::other("turn diff file exceeds 10 MiB"));
        }
        Ok(bytes)
    })
    .await
    .map_err(|_| std::io::Error::other("turn diff file read timed out"))?
}

#[derive(Clone, Copy)]
enum SourceUse {
    Preview,
    Apply { require_text: bool },
}

pub(crate) async fn load_turn_diff_sources(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_path: &str,
    session_id: &str,
    turn_id: &str,
    path: &str,
    require_text: bool,
) -> Result<TurnDiffSources, TurnDiffSourceError> {
    load_sources(
        db,
        data_dir,
        workspace_path,
        session_id,
        turn_id,
        path,
        SourceUse::Apply { require_text },
    )
    .await
}

async fn load_sources(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_path: &str,
    session_id: &str,
    turn_id: &str,
    path: &str,
    purpose: SourceUse,
) -> Result<TurnDiffSources, TurnDiffSourceError> {
    let row = sqlx::query(
        "SELECT previous_path, change_kind, baseline_exists, baseline_hash, file_changes.baseline_dirty,
                result_exists, result_hash, baseline_head, attribution
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
    if matches!(purpose, SourceUse::Apply { .. }) && change_kind == "renamed" {
        return Err(TurnDiffSourceError::Unavailable(
            crate::ui_i18n::HostMessage::new("native.turn.renamed", serde_json::json!({})),
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
    if matches!(purpose, SourceUse::Apply { .. }) && attribution == "unknown" {
        return Err(TurnDiffSourceError::Unavailable(
            crate::ui_i18n::HostMessage::new("native.turn.unknownAttribution", serde_json::json!({})),
        ));
    }
    if (baseline_exists && baseline_hash.is_none()) || (result_exists && result_hash.is_none()) {
        return Err(TurnDiffSourceError::Unavailable(
            crate::ui_i18n::HostMessage::new("native.turn.unsafeHash", serde_json::json!({})),
        ));
    }
    let root = Path::new(workspace_path);
    let target = crate::workspace_guard::canonicalize_target_message(root, Path::new(path))
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
            read_turn_diff_file(&checkpoint)
                .await
                .map_err(|error| TurnDiffSourceError::Failed(format!("read checkpoint: {error}")))?
        } else if baseline_dirty {
            return Err(TurnDiffSourceError::Unavailable(
                crate::ui_i18n::HostMessage::new("native.turn.dirtyCheckpointUnavailable", serde_json::json!({})),
            ));
        } else if let Some(head) = baseline_head.as_deref() {
            let command = crate::workspace_git_approval::read_command(
                workspace_path,
                &["show", &format!("{head}:{baseline_path}")],
            );
            let output = crate::controlled_process::execute(
                command,
                std::time::Duration::from_secs(15),
                10 * 1024 * 1024 + 1,
            )
            .await
            .map_err(|error| TurnDiffSourceError::Failed(format!("read Git baseline: {error}")))?;
            if !output.success
                || output.timed_out
                || output.stdout.len() > 10 * 1024 * 1024
                || output.stderr.len() > 10 * 1024 * 1024
            {
                return Err(TurnDiffSourceError::Unavailable(
                    crate::ui_i18n::HostMessage::new("native.turn.gitBaselineUnavailable", serde_json::json!({})),
                ));
            }
            output.stdout
        } else {
            return Err(TurnDiffSourceError::Unavailable(
                crate::ui_i18n::HostMessage::new("native.turn.checkpointMissing", serde_json::json!({})),
            ));
        }
    };
    if baseline_exists {
        let mut digest = Sha256::new();
        digest.update(&baseline);
        let checkpoint_hash = format!("sha256:{:x}", digest.finalize());
        if baseline_hash.as_deref() != Some(checkpoint_hash.as_str()) {
            return Err(TurnDiffSourceError::Unavailable(
                crate::ui_i18n::HostMessage::new("native.turn.checkpointInvalid", serde_json::json!({})),
            ));
        }
    }
    let result = if result_exists {
        let bytes = read_turn_diff_file(&target)
            .await
            .map_err(|error| TurnDiffSourceError::Failed(format!("read current file: {error}")))?;
        let current_hash = {
            let mut digest = Sha256::new();
            digest.update(&bytes);
            format!("sha256:{:x}", digest.finalize())
        };
        if result_hash.as_deref() != Some(current_hash.as_str()) {
            return Err(TurnDiffSourceError::Unavailable(
                crate::ui_i18n::HostMessage::new("native.turn.laterChanges", serde_json::json!({})),
            ));
        }
        bytes
    } else {
        if target.exists() {
            return Err(TurnDiffSourceError::Unavailable(
                crate::ui_i18n::HostMessage::new("native.turn.fileReappeared", serde_json::json!({})),
            ));
        }
        Vec::new()
    };
    if baseline.len() > 10 * 1024 * 1024 || result.len() > 10 * 1024 * 1024 {
        return Err(TurnDiffSourceError::Unavailable(
            crate::ui_i18n::HostMessage::new("native.turn.inlineLimit", serde_json::json!({})),
        ));
    }
    if matches!(
        purpose,
        SourceUse::Preview | SourceUse::Apply { require_text: true }
    ) && (std::str::from_utf8(&baseline).is_err() || std::str::from_utf8(&result).is_err())
    {
        return Err(TurnDiffSourceError::Unavailable(
            crate::ui_i18n::HostMessage::new("native.turn.binary", serde_json::json!({})),
        ));
    }
    Ok(TurnDiffSources {
        baseline,
        result,
        baseline_exists,
        result_exists,
        baseline_dirty,
    })
}

pub(crate) async fn get_turn_change_set(
    session_id: String,
    turn_id: Option<String>,
    db: &SqlitePool,
) -> Result<Option<TurnChangeSet>, CoreError> {
    session_by_id(db, &session_id).await?;
    let row = sqlx::query(
        "SELECT id, schema_version, workspace_id, session_id, turn_id,
                baseline_head, baseline_dirty, baseline_captured_at,
                result_head, result_dirty, result_captured_at,
                attribution, capture_status, capture_error, localized_capture_error_json
         FROM turn_change_sets
         WHERE session_id = ? AND (? IS NULL OR turn_id = ?)
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(&session_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .fetch_optional(db)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let change_set_id: String = row.try_get("id")?;
    let file_rows = sqlx::query(
        "SELECT path, previous_path, change_kind, baseline_exists, baseline_hash, baseline_size,
                baseline_dirty, result_exists, result_hash, result_size
         FROM file_changes WHERE change_set_id = ? ORDER BY path ASC",
    )
    .bind(&change_set_id)
    .fetch_all(db)
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
    .fetch_all(db)
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
        localized_capture_error: row.try_get::<Option<String>,_>("localized_capture_error_json")?
            .and_then(|text| serde_json::from_str(&text).ok()),
    }))
}

pub(crate) async fn list_turn_checkpoints(
    session_id: String,
    turn_id: Option<String>,
    db: &SqlitePool,
) -> Result<Vec<CheckpointFile>, CoreError> {
    session_by_id(db, &session_id).await?;
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
    .fetch_all(db)
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
                localized_reason: (!available).then(||crate::ui_i18n::display_descriptor("native.checkpoint.unavailable",serde_json::json!({}))),
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

pub(crate) async fn list_restore_operations(
    session_id: String,
    turn_id: Option<String>,
    db: &SqlitePool,
) -> Result<Vec<RestoreOperation>, CoreError> {
    let session = session_by_id(db, &session_id).await?;
    let rows = sqlx::query(
        "SELECT schema_version, id, workspace_id, session_id, turn_id, status,
                restored_json, conflicts_json, unsupported_json, localized_conflicts_json, localized_unsupported_json, created_at
         FROM restore_operations
         WHERE session_id = ? AND (? IS NULL OR turn_id = ?)
         ORDER BY created_at DESC, id DESC",
    )
    .bind(&session_id)
    .bind(&turn_id)
    .bind(&turn_id)
    .fetch_all(db)
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
                localized_conflicts: row.try_get::<Option<String>, _>("localized_conflicts_json")?.and_then(|value| serde_json::from_str(&value).ok()),
                localized_unsupported: row.try_get::<Option<String>, _>("localized_unsupported_json")?.and_then(|value| serde_json::from_str(&value).ok()),
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

/// Preview shares source validation with writes, but does not authorize them.
/// Renames and unknown attribution remain readable; write admission is stricter.
pub(crate) async fn get_turn_file_diff(
    session_id: String,
    turn_id: String,
    path: String,
    db: &SqlitePool,
    data_dir: &Path,
) -> Result<TurnFileDiff, CoreError> {
    let session = session_by_id(db, &session_id).await?;
    let workspace = workspace_by_id(db, &session.workspace_id).await?;
    let sources = match load_sources(
        db,
        data_dir,
        &workspace.path,
        &session_id,
        &turn_id,
        &path,
        SourceUse::Preview,
    )
    .await
    {
        Ok(sources) => sources,
        Err(TurnDiffSourceError::NotChanged) => {
            return Err(CoreError::Database(
                "requested file is not in the turn change set".into(),
            ))
        }
        Err(TurnDiffSourceError::UnsafePath(reason)) => {
            return Err(crate::ui_i18n::invalid_path_message(reason))
        }
        Err(TurnDiffSourceError::Failed(reason)) => return Err(CoreError::Database(reason)),
        Err(TurnDiffSourceError::Unavailable(reason)) => {
            return Ok(TurnFileDiff {
                path,
                available: false,
                diff: String::new(),
                hunks: Vec::new(),
                reason: Some(reason.diagnostic),
                localized_reason: reason.localized,
                localized_suffix: None,
            })
        }
    };
    let mut diff = run_unified_text_diff(&path, &sources.baseline, &sources.result)
        .map_err(CoreError::Database)?;
    let truncated = diff.len() > 200_000;
    if truncated {
        diff = crate::artifact::truncate_utf8(&diff, 200_000, "\n… diff 已截断");
    }
    Ok(TurnFileDiff {
        path,
        available: true,
        hunks: parse_unified_hunks(&diff),
        diff,
        reason: None,
        localized_reason: None,
        localized_suffix: truncated.then(||crate::ui_i18n::display_descriptor("native.diff.truncatedSuffix", serde_json::json!({}))),
    })
}

#[cfg(test)]
mod checkpoint_display_tests {
    use super::*;
    #[tokio::test]
    async fn checkpoint_display_preserves_metadata_availability_and_reopen() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("host.db");
        let db = crate::open_database(&path).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Project',0,'now','now');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','now','now');
            INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES ('t','s','native','completed','now');")
            .execute(&db).await.unwrap();
        for (id, exists, storage) in [("missing",true,None),("stored",true,Some("/raw/{reason}")),("absent",false,None)] {
            sqlx::query("INSERT INTO checkpoints(id,schema_version,workspace_id,session_id,turn_id,path,file_exists,content_hash,size,storage_path,baseline_dirty,created_at) VALUES (?,'aibo.checkpoint/v1','w','s','t',?,?,'original-hash',7,?,1,'now')")
                .bind(id).bind(format!("原文{{reason}}/{id}")).bind(exists).bind(storage).execute(&db).await.unwrap();
        }
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        let items = list_turn_checkpoints("s".into(),Some("t".into()),&db).await.unwrap();
        assert_eq!(items.len(),3);
        for item in items {
            assert_eq!(item.workspace_id,"w");assert_eq!(item.session_id,"s");assert_eq!(item.turn_id,"t");
            assert_eq!(item.path,format!("原文{{reason}}/{}",item.id));assert!(item.baseline_dirty);
            assert_eq!(item.content_hash.as_deref(),Some("original-hash"));assert_eq!(item.size,Some(7));
            if item.id == "missing" {
                assert!(!item.available);assert_eq!(item.reason.as_deref(),Some("baseline 文件过大、不可哈希或 checkpoint 文件不可用"));
                assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,item.localized_reason.as_ref().unwrap()),"The baseline file is too large, cannot be hashed, or its checkpoint file is unavailable.");
                assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,item.localized_reason.as_ref().unwrap()),item.reason.unwrap());
            } else {
                assert!(item.available);assert!(item.reason.is_none());
                assert!(serde_json::to_value(item).unwrap().get("localizedReason").is_none());
            }
        }
        db.close().await;
    }
}
