//! Workspace Git operations, independent of Tauri command state.
use crate::{CoreError, GitFileActionResult, GitWorkspaceActionResult, GitCommitResult,
    GitBranch, GitCommit, GitCommitFile, GitCommitFileList, WorkspaceFileDiff, GitRemoteStatus,
    GitStashEntry, workspace_by_id, command_output_bounded, WORKSPACE_DIFF_MAX_BYTES,
    truncate_diff_with_marker, parse_unified_hunks};
use sqlx::SqlitePool;
use std::{path::Path, process::Command, time::Duration};
use tokio::process::Command as TokioCommand;

pub(crate) fn apply_git_index_action(
    workspace_path: &str,
    path: &str,
    action: &str,
) -> Result<GitFileActionResult, CoreError> {
    crate::workspace_guard::canonicalize_target(Path::new(workspace_path), Path::new(path))
        .map_err(CoreError::InvalidWorkspacePath)?;
    if !matches!(action, "stage" | "unstage") {
        return Err(CoreError::InvalidWorkspacePath(
            "unsupported Git index action".to_owned(),
        ));
    }
    let mut command = Command::new("git");
    command.args(["-C", workspace_path]);
    if action == "stage" {
        command.args(["add", "--", path]);
    } else {
        let has_head = Command::new("git")
            .args(["-C", workspace_path, "rev-parse", "--verify", "HEAD"])
            .output()
            .is_ok_and(|output| output.status.success());
        if has_head {
            command.args(["restore", "--staged", "--", path]);
        } else {
            command.args(["rm", "--cached", "--ignore-unmatch", "--", path]);
        }
    }
    let output = command
        .output()
        .map_err(|error| CoreError::Database(format!("run Git file action: {error}")))?;
    let message = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    Ok(GitFileActionResult {
        path: path.to_owned(),
        action: action.to_owned(),
        applied: output.status.success(),
        message: if message.is_empty() {
            if output.status.success() {
                "Git 操作已完成".to_owned()
            } else {
                format!("git exited with {}", output.status)
            }
        } else {
            message
        },
    })
}

pub(crate) async fn apply_workspace_git_file_action(
    db: &SqlitePool,
    workspace_id: String,
    path: String,
    action: String,
) -> Result<GitFileActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    apply_git_index_action(&workspace.path, &path, &action)
}

fn run_git_workspace_action(
    workspace_path: &str,
    action: &str,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let mut command = Command::new("git");
    command.args(["-C", workspace_path]);
    match action {
        "stage_all" => {
            command.args(["add", "-A", "--", "."]);
        }
        "unstage_all" => {
            let has_head = Command::new("git")
                .args(["-C", workspace_path, "rev-parse", "--verify", "HEAD"])
                .output()
                .is_ok_and(|output| output.status.success());
            if has_head {
                command.args(["restore", "--staged", "--", "."]);
            } else {
                command.args(["rm", "--cached", "-r", "--ignore-unmatch", "--", "."]);
            }
        }
        _ => {
            return Err(CoreError::InvalidWorkspacePath(
                "unsupported Git workspace action".to_owned(),
            ));
        }
    }
    let output = command
        .output()
        .map_err(|error| CoreError::Database(format!("run Git workspace action: {error}")))?;
    let message = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    Ok(GitWorkspaceActionResult {
        action: action.to_owned(),
        applied: output.status.success(),
        message: if message.is_empty() {
            if output.status.success() {
                "Git 操作已完成".to_owned()
            } else {
                format!("git exited with {}", output.status)
            }
        } else {
            message
        },
    })
}

pub(crate) async fn apply_workspace_git_action(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    run_git_workspace_action(&workspace.path, &action)
}

fn commit_workspace(workspace_path: &str, message: &str) -> Result<GitCommitResult, CoreError> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Database("提交信息不能为空".to_owned()));
    }
    let staged = Command::new("git")
        .args(["-C", workspace_path, "diff", "--cached", "--quiet"])
        .output()
        .map_err(|error| CoreError::Database(format!("check staged Git changes: {error}")))?;
    if staged.status.success() {
        return Ok(GitCommitResult {
            committed: false,
            hash: None,
            message: "没有已暂存的更改可提交".to_owned(),
        });
    }
    let output = Command::new("git")
        .args(["-C", workspace_path, "commit", "-m", trimmed])
        .output()
        .map_err(|error| CoreError::Database(format!("create Git commit: {error}")))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Ok(GitCommitResult {
            committed: false,
            hash: None,
            message: if message.is_empty() {
                format!("git commit exited with {}", output.status)
            } else {
                message
            },
        });
    }
    let hash = Command::new("git")
        .args(["-C", workspace_path, "rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|value| value.status.success())
        .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_owned())
        .filter(|value| !value.is_empty());
    Ok(GitCommitResult {
        committed: true,
        hash,
        message: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
    })
}

pub(crate) async fn commit_workspace_changes(
    db: &SqlitePool,
    workspace_id: String,
    message: String,
) -> Result<GitCommitResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    commit_workspace(&workspace.path, &message)
}

fn list_git_branches(workspace_path: &str) -> Result<Vec<GitBranch>, CoreError> {
    let output = Command::new("git")
        .args([
            "-C",
            workspace_path,
            "for-each-ref",
            "--format=%(refname:short)%09%(HEAD)%09%(objectname)",
            "refs/heads",
        ])
        .output()
        .map_err(|error| CoreError::Database(format!("list Git branches: {error}")))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(CoreError::Database(if message.is_empty() {
            format!("git branch listing exited with {}", output.status)
        } else {
            message
        }));
    }
    let mut branches = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let name = fields.next()?.trim();
            if name.is_empty() {
                return None;
            }
            let marker = fields.next().unwrap_or_default().trim();
            let commit = fields
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            Some(GitBranch {
                name: name.to_owned(),
                current: marker == "*",
                commit: commit.map(ToOwned::to_owned),
            })
        })
        .collect::<Vec<_>>();
    branches.sort_by(|left, right| {
        right
            .current
            .cmp(&left.current)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(branches)
}

pub(crate) async fn list_workspace_git_branches(
    db: &SqlitePool,
    workspace_id: String,
) -> Result<Vec<GitBranch>, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    list_git_branches(&workspace.path)
}

fn validate_git_ref_name(name: &str) -> Result<(), CoreError> {
    if name.trim().is_empty() || name.starts_with('-') || name.contains('\n') || name.contains('\r')
    {
        return Err(CoreError::InvalidWorkspacePath(
            "无效的 Git 分支名称".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) async fn checkout_workspace_git_branch(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    validate_git_ref_name(&branch)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    let output = Command::new("git")
        .args(["-C", &workspace.path, "switch", "--", &branch])
        .output()
        .map_err(|error| CoreError::Database(format!("switch Git branch: {error}")))?;
    let message = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    Ok(GitWorkspaceActionResult {
        action: "checkout".to_owned(),
        applied: output.status.success(),
        message: if message.is_empty() {
            if output.status.success() {
                format!("已切换到 {branch}")
            } else {
                format!("git switch exited with {}", output.status)
            }
        } else {
            message
        },
    })
}

pub(crate) async fn create_workspace_git_branch(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    validate_git_ref_name(&branch)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    let output = Command::new("git")
        .args(["-C", &workspace.path, "switch", "-c", &branch])
        .output()
        .map_err(|error| CoreError::Database(format!("create Git branch: {error}")))?;
    let message = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    Ok(GitWorkspaceActionResult {
        action: "create_branch".to_owned(),
        applied: output.status.success(),
        message: if message.is_empty() {
            if output.status.success() {
                format!("已创建并切换到 {branch}")
            } else {
                format!("git switch -c exited with {}", output.status)
            }
        } else {
            message
        },
    })
}

fn list_git_history(workspace_path: &str, limit: u32) -> Result<Vec<GitCommit>, CoreError> {
    let limit = limit.clamp(1, 100);
    let output = Command::new("git")
        .args([
            "-C",
            workspace_path,
            "log",
            &format!("-{limit}"),
            "--date=iso-strict",
            "--format=%H%x09%h%x09%s%x09%an%x09%aI",
        ])
        .output()
        .map_err(|error| CoreError::Database(format!("read Git history: {error}")))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if message.contains("does not have any commits") || message.contains("bad default revision")
        {
            return Ok(Vec::new());
        }
        return Err(CoreError::Database(if message.is_empty() {
            format!("git log exited with {}", output.status)
        } else {
            message
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let fields = line.split('\t').collect::<Vec<_>>();
            if fields.len() < 5 || fields[0].is_empty() {
                return None;
            }
            Some(GitCommit {
                hash: fields[0].to_owned(),
                short_hash: fields[1].to_owned(),
                subject: fields[2].to_owned(),
                author: fields[3].to_owned(),
                authored_at: fields[4].to_owned(),
            })
        })
        .collect())
}

pub(crate) async fn list_workspace_git_history(
    db: &SqlitePool,
    workspace_id: String,
    limit: Option<u32>,
) -> Result<Vec<GitCommit>, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    list_git_history(&workspace.path, limit.unwrap_or(30))
}

fn git_commit_files(workspace_path: &str, commit: &str) -> Result<Vec<GitCommitFile>, CoreError> {
    let output = Command::new("git")
        .args([
            "-C",
            workspace_path,
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-z",
            "-M",
            commit,
        ])
        .output()
        .map_err(|error| CoreError::Database(format!("read Git commit files: {error}")))?;
    if !output.status.success() {
        return Err(CoreError::Database(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }

    let fields = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let status = String::from_utf8_lossy(fields[index]);
        index += 1;
        let Some(path) = fields.get(index) else { break };
        index += 1;
        let code = status.chars().next().unwrap_or('M');
        let (previous_path, path) = if matches!(code, 'R' | 'C') {
            let Some(new_path) = fields.get(index) else {
                break;
            };
            index += 1;
            (
                Some(String::from_utf8_lossy(path).into_owned()),
                String::from_utf8_lossy(new_path).into_owned(),
            )
        } else {
            (None, String::from_utf8_lossy(path).into_owned())
        };
        files.push(GitCommitFile {
            path,
            previous_path,
            kind: match code {
                'A' => "added",
                'D' => "deleted",
                'R' | 'C' => "renamed",
                _ => "modified",
            }
            .to_owned(),
        });
    }
    Ok(files)
}

pub(crate) async fn list_workspace_git_commit_files(
    db: &SqlitePool,
    workspace_id: String,
    commit: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<GitCommitFileList, CoreError> {
    validate_git_ref_name(&commit)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let files = git_commit_files(&workspace.path, &commit)?;
    let total = files.len();
    let offset = offset.unwrap_or(0).min(total);
    let limit = limit.unwrap_or(10).clamp(1, 100);
    Ok(GitCommitFileList {
        commit,
        files: files.into_iter().skip(offset).take(limit).collect(),
        total,
    })
}

pub(crate) async fn get_workspace_git_commit_file_diff(
    db: &SqlitePool,
    workspace_id: String,
    commit: String,
    path: String,
) -> Result<WorkspaceFileDiff, CoreError> {
    validate_git_ref_name(&commit)?;
    if Path::new(&path).is_absolute()
        || Path::new(&path)
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(CoreError::InvalidWorkspacePath(
            "无效的提交文件路径".to_owned(),
        ));
    }
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let mut command = Command::new("git");
    let output = command_output_bounded(
        command.args([
            "-C",
            &workspace.path,
            "show",
            "--no-ext-diff",
            "--no-color",
            "--format=",
            "--unified=3",
            &commit,
            "--",
            &path,
        ]),
        WORKSPACE_DIFF_MAX_BYTES + 1,
    )
    .map_err(|error| CoreError::Database(format!("read Git commit diff: {error}")))?;
    if !output.status.success() {
        return Err(CoreError::Database(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let truncated = output.stdout_truncated;
    let diff = if truncated {
        truncate_diff_with_marker(
            &String::from_utf8_lossy(&output.stdout),
            WORKSPACE_DIFF_MAX_BYTES,
        )
    } else {
        String::from_utf8_lossy(&output.stdout).into_owned()
    };
    Ok(WorkspaceFileDiff {
        path,
        staged: false,
        available: !diff.is_empty(),
        truncated,
        hunks: parse_unified_hunks(&diff),
        diff,
        reason: Some("该提交中的文件没有可展示的文本差异".to_owned())
            .filter(|_| output.stdout.is_empty()),
    })
}

fn git_remote_status(workspace_path: &str) -> Result<GitRemoteStatus, CoreError> {
    let branch = Command::new("git")
        .args(["-C", workspace_path, "branch", "--show-current"])
        .output()
        .map_err(|error| CoreError::Database(format!("read Git branch: {error}")))?;
    let branch = String::from_utf8_lossy(&branch.stdout).trim().to_owned();
    let branch = (!branch.is_empty()).then_some(branch);
    let upstream = Command::new("git")
        .args([
            "-C",
            workspace_path,
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ])
        .output()
        .ok()
        .filter(|value| value.status.success())
        .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_owned())
        .filter(|value| !value.is_empty());
    let Some(upstream_name) = upstream.clone() else {
        return Ok(GitRemoteStatus {
            branch,
            upstream: None,
            ahead: 0,
            behind: 0,
        });
    };
    let counts = Command::new("git")
        .args([
            "-C",
            workspace_path,
            "rev-list",
            "--left-right",
            "--count",
            "HEAD...@{upstream}",
        ])
        .output()
        .map_err(|error| CoreError::Database(format!("read Git remote status: {error}")))?;
    if !counts.status.success() {
        return Ok(GitRemoteStatus {
            branch,
            upstream: Some(upstream_name),
            ahead: 0,
            behind: 0,
        });
    }
    let values = String::from_utf8_lossy(&counts.stdout)
        .split_whitespace()
        .filter_map(|value| value.parse::<u32>().ok())
        .collect::<Vec<_>>();
    Ok(GitRemoteStatus {
        branch,
        upstream: Some(upstream_name),
        ahead: values.first().copied().unwrap_or(0),
        behind: values.get(1).copied().unwrap_or(0),
    })
}

pub(crate) async fn get_workspace_git_remote_status(
    db: &SqlitePool,
    workspace_id: String,
) -> Result<GitRemoteStatus, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    git_remote_status(&workspace.path)
}

pub(crate) async fn sync_workspace_git(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    let command = git_sync_command(&workspace.path, &action)?;
    execute_git_sync(command, action, Duration::from_secs(120)).await
}

fn git_sync_command(workspace_path: &str, action: &str) -> Result<TokioCommand, CoreError> {
    let args: &[&str] = match action {
        "fetch" => &["fetch", "--all", "--prune"],
        "pull" => &["pull", "--ff-only"],
        "push" => &["push"],
        _ => return Err(CoreError::InvalidWorkspacePath("unsupported Git sync action".into())),
    };
    let mut command = TokioCommand::new("git");
    command.args(["-C", workspace_path]).args(args)
        .env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "Never");
    Ok(command)
}

async fn execute_git_sync(command: TokioCommand, action: String, timeout: Duration) -> Result<GitWorkspaceActionResult, CoreError> {
    const OUTPUT_LIMIT: usize = 256 * 1024;
    let output = crate::controlled_process::execute(command, timeout, OUTPUT_LIMIT + 1).await
        .map_err(|error| CoreError::WriteOutcomeUnknown(format!("Git {action}: {error}")))?;
    let mut message = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        if !message.is_empty() { message.push('\n'); }
        message.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    // Redaction may shorten captured output below the byte limit. Remember
    // truncation before sanitizing so that discarded bytes are never hidden.
    let truncated = output.stdout.len() > OUTPUT_LIMIT || output.stderr.len() > OUTPUT_LIMIT || message.len() > OUTPUT_LIMIT;
    let sanitized = crate::artifact::sanitize_content("git.sync.command", message.trim());
    let message = if truncated || sanitized.len() > OUTPUT_LIMIT {
        const SUFFIX: &str = "\n… Git 输出已截断";
        format!("{}{}", crate::artifact::truncate_utf8(&sanitized, OUTPUT_LIMIT - SUFFIX.len(), ""), SUFFIX)
    } else { sanitized };
    if output.timed_out || output.cancelled {
        return Err(CoreError::WriteOutcomeUnknown(format!("Git {action} 已停止，远端或本地引用可能已更改。\n{message}")));
    }
    Ok(GitWorkspaceActionResult {
        action,
        applied: output.success,
        message: if message.is_empty() {
            if output.success { "Git 同步已完成".into() }
            else { format!("git exited with {:?}", output.exit_code) }
        } else { message },
    })
}

pub(crate) async fn list_workspace_git_stashes(
    db: &SqlitePool,
    workspace_id: String,
) -> Result<Vec<GitStashEntry>, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let output = Command::new("git")
        .args([
            "-C",
            &workspace.path,
            "stash",
            "list",
            "--format=%gd%x09%gs",
        ])
        .output()
        .map_err(|error| CoreError::Database(format!("list Git stashes: {error}")))?;
    if !output.status.success() {
        return Err(CoreError::Database(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (reference, message) = line.split_once('\t')?;
            Some(GitStashEntry {
                reference: reference.to_owned(),
                message: message.to_owned(),
            })
        })
        .collect())
}

pub(crate) async fn apply_workspace_git_stash(
    db: &SqlitePool,
    workspace_id: String,
    reference: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    validate_git_ref_name(&reference)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    let output = Command::new("git")
        .args(["-C", &workspace.path, "stash", "apply", &reference])
        .output()
        .map_err(|error| CoreError::Database(format!("apply Git stash: {error}")))?;
    let message = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    Ok(GitWorkspaceActionResult {
        action: "stash_apply".to_owned(),
        applied: output.status.success(),
        message: if message.is_empty() {
            if output.status.success() {
                "已应用暂存栈".to_owned()
            } else {
                format!("git stash apply exited with {}", output.status)
            }
        } else {
            message
        },
    })
}

pub(crate) async fn stash_workspace_git(
    db: &SqlitePool,
    workspace_id: String,
    message: Option<String>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let _write = crate::workspace_writes::acquire(db, &workspace_id, std::path::Path::new(&workspace.path)).await?;
    let message = message.unwrap_or_else(|| "aibo workspace changes".to_owned());
    let output = Command::new("git")
        .args(["-C", &workspace.path, "stash", "push", "-u", "-m", &message])
        .output()
        .map_err(|error| CoreError::Database(format!("create Git stash: {error}")))?;
    let text = String::from_utf8_lossy(if output.status.success() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_owned();
    Ok(GitWorkspaceActionResult {
        action: "stash_push".to_owned(),
        applied: output.status.success(),
        message: if text.is_empty() {
            if output.status.success() {
                "已保存暂存栈".to_owned()
            } else {
                format!("git stash push exited with {}", output.status)
            }
        } else {
            text
        },
    })
}


#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn git_sync_deadline_stops_transport_descendants_and_reports_uncertain_effects() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("aibo-git-transport-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(Command::new("git").args(["init", "-q"]).arg(&root).status().unwrap().success());
        assert!(Command::new("git").arg("-C").arg(&root).args(["remote", "add", "origin", "ssh://fixture.invalid/repo"]).status().unwrap().success());
        let helper = root.join("transport");
        std::fs::write(&helper, "#!/bin/sh\nprintf BEFORE_TIMEOUT >&2\n(sleep 4; touch late-effect) &\nexit 1\n").unwrap();
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut command = git_sync_command(root.to_str().unwrap(), "fetch").unwrap();
        // Git invokes only this local fixture; no SSH connection is attempted.
        command.current_dir(&root).env("GIT_SSH", &helper).env("GIT_SSH_VARIANT", "ssh");
        let result = tokio::time::timeout(Duration::from_secs(5), execute_git_sync(command, "fetch".into(), Duration::from_secs(2))).await.unwrap();
        let error = result.unwrap_err();
        assert!(matches!(&error, CoreError::WriteOutcomeUnknown(_)), "{error}");
        assert!(error.to_string().contains("BEFORE_TIMEOUT"), "{error}");
        assert_eq!(serde_json::to_value(&error).unwrap()["code"], "outcome_unknown");
        tokio::time::sleep(Duration::from_millis(4200)).await;
        assert!(!root.join("late-effect").exists());
        assert!(git_sync_command(root.to_str().unwrap(), "--upload-pack=unexpected").is_err());
        // A transport that exits conclusively still returns a bounded failure response.
        std::fs::write(&helper, "#!/bin/sh\nprintf 'token=fixture-secret\\n' >&2\nhead -c 400000 /dev/zero | tr '\\000' x >&2\nexit 1\n").unwrap();
        let mut command = git_sync_command(root.to_str().unwrap(), "fetch").unwrap();
        command.current_dir(&root).env("GIT_SSH", &helper).env("GIT_SSH_VARIANT", "ssh");
        let result = execute_git_sync(command, "fetch".into(), Duration::from_secs(3)).await.unwrap();
        assert!(!result.applied);
        assert!(result.message.len() <= 256 * 1024 + 64);
        assert!(result.message.contains("Git 输出已截断"));
        assert!(result.message.contains("[REDACTED]"));
        assert!(!result.message.contains("fixture-secret"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn workspace_git_service_preserves_writes_history_and_trust_without_a_window() {
        let root = std::env::temp_dir().join(format!("aibo-git-service-{}", ulid::Ulid::new()));
        let repo = root.join("workspace");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git").arg("-C").arg(&repo).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "Aibo Fixture"]);
        git(&["config", "user.email", "fixture@example.invalid"]);
        git(&["config", "commit.gpgsign", "false"]);
        let hooks = root.join("empty-hooks");
        std::fs::create_dir(&hooks).unwrap();
        git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        let now = crate::now_iso();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Git service',1,?,?)")
            .bind(repo.to_string_lossy().as_ref()).bind(&now).bind(&now).execute(&db).await.unwrap();
        std::fs::write(repo.join("source.txt"), "first\n").unwrap();
        assert!(apply_workspace_git_file_action(&db, "workspace".into(), "source.txt".into(), "stage".into()).await.unwrap().applied);
        assert_eq!(git(&["diff", "--cached", "--name-only"]), "source.txt");
        let commit = commit_workspace_changes(&db, "workspace".into(), "Fixture commit\n\nCo-authored-by: Codex <codex@openai.com>".into()).await.unwrap();
        assert!(commit.committed);
        let history = list_workspace_git_history(&db, "workspace".into(), None).await.unwrap();
        assert_eq!(history[0].hash, commit.hash.unwrap());
        assert_eq!(list_workspace_git_commit_files(&db, "workspace".into(), history[0].hash.clone(), None, None).await.unwrap().files[0].path, "source.txt");
        assert!(create_workspace_git_branch(&db, "workspace".into(), "service-test".into()).await.unwrap().applied);
        assert!(list_workspace_git_branches(&db, "workspace".into()).await.unwrap().iter().any(|branch| branch.name == "service-test" && branch.current));
        std::fs::write(repo.join("source.txt"), "second\n").unwrap();
        assert!(stash_workspace_git(&db, "workspace".into(), Some("service fixture".into())).await.unwrap().applied);
        assert_eq!(std::fs::read_to_string(repo.join("source.txt")).unwrap(), "first\n");
        let stashes = list_workspace_git_stashes(&db, "workspace".into()).await.unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(apply_workspace_git_stash(&db, "workspace".into(), stashes[0].reference.clone()).await.unwrap().applied);
        assert_eq!(std::fs::read_to_string(repo.join("source.txt")).unwrap(), "second\n");
        assert!(apply_workspace_git_file_action(&db, "workspace".into(), "../outside".into(), "stage".into()).await.is_err());
        assert!(create_workspace_git_branch(&db, "workspace".into(), "--orphan".into()).await.is_err());
        // Exercise production push/fetch/pull against a local bare remote, without network or credentials.
        let remote = root.join("remote.git");
        assert!(Command::new("git").args(["init", "--bare", "-q"]).arg(&remote).status().unwrap().success());
        assert!(Command::new("git").arg("-C").arg(&remote).args(["config", "core.hooksPath", hooks.to_str().unwrap()]).status().unwrap().success());
        git(&["remote", "add", "origin", remote.to_str().unwrap()]);
        git(&["config", "branch.service-test.remote", "origin"]);
        git(&["config", "branch.service-test.merge", "refs/heads/service-test"]);
        for action in ["push", "fetch", "pull"] {
            let result = sync_workspace_git(&db, "workspace".into(), action.into()).await.unwrap();
            assert!(result.applied, "{action}: {}", result.message);
        }
        let remote_head = Command::new("git").arg("-C").arg(&remote).args(["rev-parse", "refs/heads/service-test"]).output().unwrap();
        assert!(remote_head.status.success());
        assert_eq!(String::from_utf8_lossy(&remote_head.stdout).trim(), git(&["rev-parse", "HEAD"]));
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='workspace'").execute(&db).await.unwrap();
        assert!(matches!(apply_workspace_git_action(&db, "workspace".into(), "stage_all".into()).await, Err(CoreError::WorkspaceTrustRequired)));
        assert!(git(&["diff", "--cached", "--name-only"]).is_empty());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
