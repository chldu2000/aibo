//! Inspect workspace Git changes without applying them.
use crate::{
    text_diff::{
        command_output_bounded, parse_unified_hunks, run_unified_text_diff_bounded,
        truncate_diff_with_marker, TurnDiffHunk, WORKSPACE_DIFF_MAX_BYTES,
    },
    CoreError,
};
use serde::Serialize;
use std::{path::Path, process::Command};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileDiff {
    pub(crate) path: String,
    pub(crate) staged: bool,
    pub(crate) available: bool,
    pub(crate) truncated: bool,
    pub(crate) diff: String,
    pub(crate) hunks: Vec<TurnDiffHunk>,
    pub(crate) reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_reason: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) localized_suffix: Option<serde_json::Value>,
}

pub(crate) fn workspace_file_diff(
    workspace_path: &str,
    path: &str,
    staged: bool,
) -> Result<WorkspaceFileDiff, CoreError> {
    let root = Path::new(workspace_path);
    crate::workspace_guard::canonicalize_target_message(root, Path::new(path))
        .map_err(crate::ui_i18n::invalid_path_message)?;

    let mut command = Command::new("git");
    command.args([
        "-C",
        workspace_path,
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
    ]);
    if staged {
        command.arg("--cached");
    }
    let output = command_output_bounded(command.args(["--", path]), WORKSPACE_DIFF_MAX_BYTES + 1)
        .map_err(|error| CoreError::Database(format!("read Git diff: {error}")))?;
    if !output.status.success() {
        return Err(CoreError::Database(format!(
            "git diff exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let mut diff = String::from_utf8_lossy(&output.stdout).to_string();
    let mut diff_truncated = output.stdout_truncated;
    if diff.is_empty() && !staged {
        let target = crate::workspace_guard::canonicalize_target_message(root, Path::new(path))
            .map_err(crate::ui_i18n::invalid_path_message)?;
        let tracked = Command::new("git")
            .args([
                "-C",
                workspace_path,
                "ls-files",
                "--error-unmatch",
                "--",
                path,
            ])
            .output()
            .map(|value| value.status.success())
            .unwrap_or(false);
        if !tracked && target.is_file() {
            let metadata = target.metadata().map_err(|error| {
                CoreError::Database(format!("read untracked file metadata: {error}"))
            })?;
            if metadata.len() > WORKSPACE_DIFF_MAX_BYTES as u64 {
                return Ok(WorkspaceFileDiff {
                    path: path.to_owned(),
                    staged,
                    available: false,
                    truncated: false,
                    diff: String::new(),
                    hunks: Vec::new(),
                    reason: Some("未跟踪文件过大，暂不生成文本 diff".to_owned()),
                    localized_suffix: None,
                    localized_reason: Some(crate::ui_i18n::display_descriptor("native.diff.untrackedTooLarge", serde_json::json!({}))),
                });
            }
            let content = std::fs::read(&target)
                .map_err(|error| CoreError::Database(format!("read untracked file: {error}")))?;
            if content.contains(&0) {
                return Ok(WorkspaceFileDiff {
                    path: path.to_owned(),
                    staged,
                    available: false,
                    truncated: false,
                    diff: String::new(),
                    hunks: Vec::new(),
                    reason: Some("二进制文件暂不提供文本 diff".to_owned()),
                    localized_suffix: None,
                    localized_reason: Some(crate::ui_i18n::display_descriptor("native.diff.binary", serde_json::json!({}))),
                });
            }
            let generated =
                run_unified_text_diff_bounded(path, &[], &content, WORKSPACE_DIFF_MAX_BYTES)
                    .map_err(CoreError::Database)?;
            diff = generated.0;
            diff_truncated = generated.1;
        }
    }

    if diff.is_empty() {
        return Ok(WorkspaceFileDiff {
            path: path.to_owned(),
            staged,
            available: false,
            truncated: false,
            diff,
            hunks: Vec::new(),
            reason: Some("当前状态没有可展示的文件变更".to_owned()),
            localized_suffix: None,
            localized_reason: Some(crate::ui_i18n::display_descriptor("native.diff.noChanges", serde_json::json!({}))),
        });
    }
    if diff_truncated || diff.len() > WORKSPACE_DIFF_MAX_BYTES {
        diff = truncate_diff_with_marker(&diff, WORKSPACE_DIFF_MAX_BYTES);
        diff_truncated = true;
    }
    Ok(WorkspaceFileDiff {
        path: path.to_owned(),
        staged,
        available: true,
        truncated: diff_truncated,
        hunks: parse_unified_hunks(&diff),
        diff,
        reason: None,
        localized_reason: None,
        localized_suffix: diff_truncated.then(||crate::ui_i18n::display_descriptor("native.diff.truncatedSuffix", serde_json::json!({}))),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui_i18n::{render, Locale};

    #[test]
    fn unavailable_diffs_keep_original_reasons_and_localize_without_changing_evidence() {
        let root = std::env::temp_dir().join(format!("aibo-diff-i18n-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git").arg("-C").arg(&root).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "Aibo Fixture"]);
        git(&["config", "user.email", "fixture@example.invalid"]);
        git(&["config", "commit.gpgsign", "false"]);
        std::fs::write(root.join("原始{path}.txt"), "original\n").unwrap();
        git(&["add", "."]); git(&["commit", "-q", "-m", "original"]);
        std::fs::write(root.join("binary.dat"), [1, 0, 2]).unwrap();
        std::fs::write(root.join("large.txt"), vec![b'a'; WORKSPACE_DIFF_MAX_BYTES + 1]).unwrap();
        for (path, reason, english) in [
            ("原始{path}.txt", "当前状态没有可展示的文件变更", "There are no file changes to display."),
            ("binary.dat", "二进制文件暂不提供文本 diff", "Text diffs are unavailable for binary files."),
            ("large.txt", "未跟踪文件过大，暂不生成文本 diff", "The untracked file is too large to generate a text diff."),
        ] {
            let value = workspace_file_diff(root.to_str().unwrap(), path, false).unwrap();
            assert!(!value.available); assert!(!value.truncated); assert!(value.hunks.is_empty()); assert!(value.diff.is_empty());
            assert_eq!(value.path, path); assert_eq!(value.reason.as_deref(), Some(reason));
            let display = value.localized_reason.as_ref().unwrap();
            assert_eq!(render(Locale::ZhCn, display), reason); assert_eq!(render(Locale::En, display), english);
            assert_eq!(serde_json::to_value(&value).unwrap()["localizedReason"]["schema"], "aibo.host-message/v1");
        }
        std::fs::write(root.join("原始{path}.txt"), "原始代码 {reason}\n").unwrap();
        let value = workspace_file_diff(root.to_str().unwrap(), "原始{path}.txt", false).unwrap();
        assert!(value.available); assert!(value.diff.contains("原始代码 {reason}")); assert!(!value.hunks.is_empty());
        assert!(serde_json::to_value(&value).unwrap().get("localizedReason").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod truncation_display_tests {
    use super::*;
    #[tokio::test]
    async fn truncated_workspace_and_commit_diffs_mark_only_host_suffixes() {
        let root = std::env::temp_dir().join(format!("aibo-truncated-diff-{}",ulid::Ulid::new()));
        let repo = root.join("repo");std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git").arg("-C").arg(&repo).args(args).output().unwrap();
            assert!(output.status.success(), "{}",String::from_utf8_lossy(&output.stderr));
        };
        git(&["init","-q","-b","main"]);git(&["config","user.name","Fixture"]);git(&["config","user.email","fixture@example.invalid"]);git(&["config","commit.gpgsign","false"]);
        let path = "原文{path}.txt";std::fs::write(repo.join(path),"original\n").unwrap();git(&["add","."]);git(&["commit","-qm","baseline"]);
        let content = "用户正文 {suffix}\n… diff 已截断\n".repeat(20_000);std::fs::write(repo.join(path),&content).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w',?,'原文',1,'now','now')").bind(repo.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        let unstaged = workspace_file_diff(repo.to_str().unwrap(),path,false).unwrap();git(&["add","."]);
        let staged = workspace_file_diff(repo.to_str().unwrap(),path,true).unwrap();git(&["commit","-qm","large result"]);
        let committed = crate::workspace_git::get_workspace_git_commit_file_diff(&db,"w".into(),"HEAD".into(),path.into()).await.unwrap();
        for value in [unstaged,staged,committed] {
            assert!(value.available && value.truncated);assert!(value.diff.len() <= WORKSPACE_DIFF_MAX_BYTES);
            assert!(value.diff.contains("用户正文 {suffix}"));assert!(value.diff.ends_with("\n… diff 已截断"));
            assert!(value.hunks.last().unwrap().content.ends_with("\n… diff 已截断"));
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,value.localized_suffix.as_ref().unwrap()),"\n… diff truncated");
            assert_eq!(serde_json::to_value(&value).unwrap()["localizedSuffix"]["schema"],"aibo.host-message/v1");
        }
        assert_eq!(std::fs::read_to_string(repo.join(path)).unwrap(),content);db.close().await;std::fs::remove_dir_all(root).unwrap();
    }
}
