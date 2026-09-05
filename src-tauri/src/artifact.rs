use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tokio::fs;
use ulid::Ulid;

pub(crate) const ARTIFACT_SCHEMA: &str = "aibo.artifact/v1";

/// Truncate a UTF-8 string without splitting a code point. The returned value
/// is bounded by `max_bytes`, including the optional suffix.
pub(crate) fn truncate_utf8(content: &str, max_bytes: usize, suffix: &str) -> String {
    if content.len() <= max_bytes {
        return content.to_owned();
    }
    if max_bytes == 0 {
        return String::new();
    }
    let suffix = if suffix.len() > max_bytes { "" } else { suffix };
    let mut end = max_bytes.saturating_sub(suffix.len());
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = content[..end].to_owned();
    truncated.push_str(suffix);
    truncated
}

pub(crate) fn sanitize_content(source: &str, content: &str) -> String {
    if !source.contains("command") {
        return content.to_owned();
    }
    content
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            let Some(marker) = ["api_key", "api-key", "token", "secret", "password"]
                .iter()
                .find(|marker| lower.contains(**marker))
            else {
                return line.to_owned();
            };
            let marker_end = lower.find(marker).unwrap_or(0) + marker.len();
            let suffix = &line[marker_end..];
            let Some(delimiter) = suffix.find(['=', ':']) else {
                return line.to_owned();
            };
            let value_start = marker_end + delimiter + 1;
            let secret_start = value_start
                + line[value_start..]
                    .find(|character: char| !character.is_whitespace())
                    .unwrap_or(0);
            let value_end = line[secret_start..]
                .find(char::is_whitespace)
                .map(|offset| secret_start + offset)
                .unwrap_or(line.len());
            format!("{}[REDACTED]{}", &line[..secret_start], &line[value_end..])
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn persist_text(
    db: &SqlitePool,
    data_dir: &Path,
    workspace_id: &str,
    session_id: &str,
    turn_id: Option<&str>,
    source: &str,
    media_type: &str,
    content: &str,
) -> Result<String, sqlx::Error> {
    let sanitized = sanitize_content(source, content);
    let bytes = sanitized.as_bytes();
    let mut digest = Sha256::new();
    digest.update(bytes);
    let content_hash = format!("sha256:{:x}", digest.finalize());
    let artifact_dir = data_dir.join("artifacts");
    fs::create_dir_all(&artifact_dir)
        .await
        .map_err(sqlx::Error::Io)?;
    let storage_path = artifact_dir.join(content_hash.trim_start_matches("sha256:"));
    if !storage_path.exists() {
        fs::write(&storage_path, bytes)
            .await
            .map_err(sqlx::Error::Io)?;
    }
    let size = i64::try_from(bytes.len()).unwrap_or(i64::MAX);
    let storage_ref = format!("artifacts/{}", content_hash.trim_start_matches("sha256:"));
    let artifact_id = Ulid::new().to_string();
    sqlx::query(
        "INSERT OR IGNORE INTO artifacts
         (id, schema_version, workspace_id, session_id, turn_id, source, media_type,
          size, content_hash, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&artifact_id)
    .bind(ARTIFACT_SCHEMA)
    .bind(workspace_id)
    .bind(session_id)
    .bind(turn_id)
    .bind(source)
    .bind(media_type)
    .bind(size)
    .bind(content_hash)
    .bind(storage_ref)
    .bind(crate::now_iso())
    .execute(db)
    .await?;
    Ok(artifact_id)
}

#[cfg(test)]
mod tests {
    use super::{sanitize_content, truncate_utf8};

    #[test]
    fn redacts_command_artifact_secrets_but_preserves_other_artifacts() {
        assert_eq!(
            sanitize_content("pi.command", "token=secret-value\nhello"),
            "token=[REDACTED]\nhello"
        );
        assert_eq!(
            sanitize_content("codex.diff", "token=secret-value"),
            "token=secret-value"
        );
    }

    #[test]
    fn truncates_utf8_without_splitting_code_points_or_exceeding_limit() {
        let value = truncate_utf8("前缀🙂后缀", 10, "…");
        assert!(value.len() <= 10);
        assert!(std::str::from_utf8(value.as_bytes()).is_ok());
        assert!(value.ends_with('…'));
    }
}

pub(crate) fn artifact_root_from_checkpoint(checkpoint_root: &Path) -> PathBuf {
    checkpoint_root
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}
