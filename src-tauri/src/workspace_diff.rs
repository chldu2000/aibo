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
}

pub(crate) fn workspace_file_diff(
    workspace_path: &str,
    path: &str,
    staged: bool,
) -> Result<WorkspaceFileDiff, CoreError> {
    let root = Path::new(workspace_path);
    crate::workspace_guard::canonicalize_target(root, Path::new(path))
        .map_err(CoreError::InvalidWorkspacePath)?;

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
        let target = crate::workspace_guard::canonicalize_target(root, Path::new(path))
            .map_err(CoreError::InvalidWorkspacePath)?;
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
    })
}
