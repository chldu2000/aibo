//! Workspace Git operations, independent of Tauri command state.
use crate::{CoreError, GitFileActionResult, GitWorkspaceActionResult, GitCommitResult,
    GitBranch, GitCommit, GitCommitFile, GitCommitFileList, WorkspaceFileDiff, GitRemoteStatus,
    GitStashEntry, workspace_by_id, command_output_bounded, WORKSPACE_DIFF_MAX_BYTES,
    truncate_diff_with_marker, parse_unified_hunks};
use sqlx::SqlitePool;
use std::{path::Path, process::Command, time::{Duration, Instant}};
use tokio::process::Command as TokioCommand;

const GIT_OUTPUT_LIMIT: usize = 256 * 1024;

/// One deadline for preconditions, mutation, and result inspection.
pub(crate) struct GitOperation<'a> {
    workspace_path: &'a str,
    deadline: Instant,
    cancellation: Option<crate::workspace_write_runs::Cancellation>,
}
impl<'a> GitOperation<'a> {
    pub(crate) fn new(workspace_path: &'a str) -> Self {
        Self { workspace_path, cancellation: None, deadline: Instant::now() + Duration::from_secs(120) }
    }
    pub(crate) fn cancellable(mut self, cancellation: crate::workspace_write_runs::Cancellation) -> Self { self.cancellation = Some(cancellation); self }
    pub(crate) async fn run(&self, args: &[&str], action: &str) -> Result<(crate::controlled_process::ProcessResult, String), CoreError> {
        capture_git_operation(git_command(self.workspace_path, args), action, self.deadline.saturating_duration_since(Instant::now()), self.cancellation.as_ref()).await
    }
    async fn action(&self, args: &[&str], action: &str) -> Result<GitWorkspaceActionResult, CoreError> {
        let (output, message) = self.run(args, action).await?;
        Ok(GitWorkspaceActionResult { action: action.into(), applied: output.success, message })
    }
    async fn has_head(&self) -> Result<bool, CoreError> {
        let (output, message) = self.run(&["rev-parse", "--verify", "--quiet", "HEAD"], "inspect_head").await?;
        match output.exit_code {
            Some(0) => Ok(true), Some(1) => Ok(false),
            _ => Err(CoreError::Database(format!("Unable to inspect Git HEAD: {message}"))),
        }
    }
}

fn git_command(workspace_path: &str, args: &[&str]) -> TokioCommand {
    let mut command = TokioCommand::new("git");
    command.args(["--literal-pathspecs", "-C", workspace_path]).args(args)
        .env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "Never");
    command
}

pub(crate) async fn apply_git_index_action(
    workspace_path: &str, path: &str, action: &str, cancellation: Option<crate::workspace_write_runs::Cancellation>,
) -> Result<GitFileActionResult, CoreError> {
    crate::workspace_guard::canonicalize_target(Path::new(workspace_path), Path::new(path))
        .map_err(CoreError::InvalidWorkspacePath)?;
    let mut operation = GitOperation::new(workspace_path);
    operation.cancellation = cancellation;
    let result = match action {
        "stage" => operation.action(&["add", "--", path], action).await?,
        "unstage" => {
            if operation.has_head().await? { operation.action(&["restore", "--staged", "--", path], action).await? }
            else { operation.action(&["rm", "--cached", "--ignore-unmatch", "--", path], action).await? }
        }
        _ => return Err(CoreError::InvalidWorkspacePath("unsupported Git index action".into())),
    };
    Ok(GitFileActionResult { path: path.into(), action: action.into(), applied: result.applied, message: result.message })
}

pub(crate) async fn apply_workspace_git_file_action_requested(
    db: &SqlitePool,
    workspace_id: String,
    path: String,
    action: String,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitFileActionResult, CoreError> {
    apply_workspace_git_file_action_requested_in_repository(db, workspace_id, path, action, request, None).await
}

pub(crate) async fn apply_workspace_git_file_action_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    path: String,
    action: String,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitFileActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.index", serde_json::json!({"repositoryId":repository_id,"path":path,"action":action}), request, |cancel| apply_git_index_action(&repository_path, &path, &action, Some(cancel))).await
}

// Use the same status classification as the Git panel. Explicit literal paths
// keep group staging from sweeping untracked files or resolving other conflicts.
async fn stage_workspace_group(operation: &GitOperation<'_>, action: &str) -> Result<GitWorkspaceActionResult, CoreError> {
    let (status, message) = operation.run(&["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."], "inspect_stage_group").await?;
    if !status.success {
        return Ok(GitWorkspaceActionResult { action: action.into(), applied: false, message });
    }
    if status.stdout.len() > GIT_OUTPUT_LIMIT || std::str::from_utf8(&status.stdout).is_err() {
        return Err(CoreError::Database("无法完整读取 Git 分组文件列表，未执行暂存".into()));
    }
    let (prefix, message) = operation.run(&["rev-parse", "--show-prefix"], "inspect_stage_prefix").await?;
    if !prefix.success { return Err(CoreError::Database(message)); }
    let prefix = std::str::from_utf8(&prefix.stdout).map_err(|_| CoreError::InvalidWorkspacePath("invalid Git path encoding".into()))?.trim_end_matches('\n');
    let mut paths = Vec::new();
    for file in crate::change_set::parse_workspace_git_status(&status.stdout) {
        let selected = !file.conflicted && if action == "stage_untracked" { file.untracked } else { file.unstaged && !file.untracked };
        if !selected { continue; }
        // Porcelain paths are repository-relative, but Git -C may point at a
        // workspace inside that repository. Stage only paths inside that scope.
        let path = file.path.strip_prefix(prefix).filter(|path| !path.is_empty())
            .ok_or_else(|| CoreError::InvalidWorkspacePath("Git group path is outside the workspace".into()))?.to_owned();
        paths.push(path);
    }
    if paths.is_empty() { return Ok(GitWorkspaceActionResult { action: action.into(), applied: true, message: "该分组没有需要暂存的文件".into() }); }
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    operation.action(&args, action).await
}

async fn run_git_workspace_action(workspace_path: &str, action: &str, cancellation: Option<crate::workspace_write_runs::Cancellation>) -> Result<GitWorkspaceActionResult, CoreError> {
    let mut operation = GitOperation::new(workspace_path);
    operation.cancellation = cancellation;
    match action {
        "stage_changed" | "stage_untracked" => stage_workspace_group(&operation, action).await,
        "stage_all" => operation.action(&["add", "-A", "--", "."], action).await,
        "unstage_all" => {
            if operation.has_head().await? { operation.action(&["restore", "--staged", "--", "."], action).await }
            else { operation.action(&["rm", "--cached", "-r", "--ignore-unmatch", "--", "."], action).await }
        }
        _ => Err(CoreError::InvalidWorkspacePath("unsupported Git workspace action".into())),
    }
}

pub(crate) async fn apply_workspace_git_action_requested(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitWorkspaceActionResult, CoreError> {
    apply_workspace_git_action_requested_in_repository(db, workspace_id, action, request, None).await
}

pub(crate) async fn apply_workspace_git_action_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.index-all", serde_json::json!({"repositoryId":repository_id,"action":action}), request, |cancel| run_git_workspace_action(&repository_path, &action, Some(cancel))).await
}

async fn commit_workspace(operation: &GitOperation<'_>, message: &str) -> Result<GitCommitResult, CoreError> {
    let trimmed = message.trim();
    if trimmed.is_empty() { return Err(CoreError::Database("提交信息不能为空".into())); }
    let (staged, detail) = operation.run(&["diff", "--cached", "--quiet"], "inspect_staged").await?;
    match staged.exit_code {
        Some(0) => return Ok(GitCommitResult { committed: false, hash: None, message: "没有已暂存的更改可提交".into() }),
        Some(1) => {},
        _ => return Err(CoreError::Database(format!("Unable to inspect staged changes: {detail}"))),
    }
    let result = operation.action(&["commit", "-m", trimmed], "commit").await?;
    if !result.applied { return Ok(GitCommitResult { committed: false, hash: None, message: result.message }); }
    // The successful mutation remains successful if optional hash inspection fails.
    let hash = operation.run(&["rev-parse", "HEAD"], "inspect_commit").await.ok()
        .filter(|(output, _)| output.success)
        .map(|(output, _)| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty());
    Ok(GitCommitResult { committed: true, hash, message: result.message })
}

pub(crate) async fn commit_workspace_changes_requested(
    db: &SqlitePool,
    workspace_id: String,
    message: String,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitCommitResult, CoreError> {
    commit_workspace_changes_requested_in_repository(db, workspace_id, message, request, None).await
}

pub(crate) async fn commit_workspace_changes_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    message: String,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitCommitResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.commit", serde_json::json!({"repositoryId":repository_id,"message":message}), request, |cancel| async { commit_workspace(&GitOperation::new(&repository_path).cancellable(cancel), &message).await }).await
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
    list_workspace_git_branches_in_repository(db, workspace_id, None).await
}

pub(crate) async fn list_workspace_git_branches_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    repository_id: Option<&str>,
) -> Result<Vec<GitBranch>, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    list_git_branches(&repository_path)
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

pub(crate) async fn checkout_workspace_git_branch_requested(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitWorkspaceActionResult, CoreError> {
    checkout_workspace_git_branch_requested_in_repository(db, workspace_id, branch, request, None).await
}

pub(crate) async fn checkout_workspace_git_branch_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    validate_git_ref_name(&branch)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.checkout", serde_json::json!({"repositoryId":repository_id,"branch":branch}), request, |cancel| async { GitOperation::new(&repository_path).cancellable(cancel).action(&["switch", "--", &branch], "checkout").await }).await
}

pub(crate) async fn create_workspace_git_branch_requested(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitWorkspaceActionResult, CoreError> {
    create_workspace_git_branch_requested_in_repository(db, workspace_id, branch, request, None).await
}

pub(crate) async fn create_workspace_git_branch_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    validate_git_ref_name(&branch)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.create-branch", serde_json::json!({"repositoryId":repository_id,"branch":branch}), request, |cancel| async { GitOperation::new(&repository_path).cancellable(cancel).action(&["switch", "-c", &branch], "create_branch").await }).await
}

fn list_git_history(workspace_path: &str, limit: u32, offset: u32) -> Result<Vec<GitCommit>, CoreError> {
    let limit = limit.clamp(1, 100);
    let output = Command::new("git")
        .args([
            "-C",
            workspace_path,
            "log",
            &format!("--skip={offset}"),
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
    list_workspace_git_history_in_repository(db, workspace_id, limit, None, None).await
}

pub(crate) async fn list_workspace_git_history_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    limit: Option<u32>,
    repository_id: Option<&str>,
    offset: Option<u32>,
) -> Result<Vec<GitCommit>, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    list_git_history(&repository_path, limit.unwrap_or(30), offset.unwrap_or(0))
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
    list_workspace_git_commit_files_in_repository(db, workspace_id, commit, offset, limit, None).await
}

pub(crate) async fn list_workspace_git_commit_files_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    commit: String,
    offset: Option<usize>,
    limit: Option<usize>,
    repository_id: Option<&str>,
) -> Result<GitCommitFileList, CoreError> {
    validate_git_ref_name(&commit)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    let files = git_commit_files(&repository_path, &commit)?;
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
    get_workspace_git_commit_file_diff_in_repository(db, workspace_id, commit, path, None).await
}

pub(crate) async fn get_workspace_git_commit_file_diff_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    commit: String,
    path: String,
    repository_id: Option<&str>,
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
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    let mut command = Command::new("git");
    let output = command_output_bounded(
        command.args([
            "-C",
            &repository_path,
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
    get_workspace_git_remote_status_in_repository(db, workspace_id, None).await
}

pub(crate) async fn get_workspace_git_remote_status_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    repository_id: Option<&str>,
) -> Result<GitRemoteStatus, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    git_remote_status(&repository_path)
}

pub(crate) async fn sync_workspace_git_requested(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitWorkspaceActionResult, CoreError> {
    sync_workspace_git_requested_in_repository(db, workspace_id, action, request, None).await
}

pub(crate) async fn sync_workspace_git_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let command = git_sync_command(&repository_path, &action)?;
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.sync", serde_json::json!({"repositoryId":repository_id,"action":action}), request, |cancel| execute_git_action(command, action, Duration::from_secs(120), Some(cancel))).await
}

fn git_sync_command(workspace_path: &str, action: &str) -> Result<TokioCommand, CoreError> {
    let args: &[&str] = match action {
        "fetch" => &["fetch", "--all", "--prune"],
        "pull" => &["pull", "--ff-only"],
        "push" => &["push"],
        _ => return Err(CoreError::InvalidWorkspacePath("unsupported Git sync action".into())),
    };
    Ok(git_command(workspace_path, args))
}

async fn execute_git_action(command: TokioCommand, action: String, timeout: Duration, cancellation: Option<crate::workspace_write_runs::Cancellation>) -> Result<GitWorkspaceActionResult, CoreError> {
    let (output, message) = capture_git_operation(command, &action, timeout, cancellation.as_ref()).await?;
    Ok(GitWorkspaceActionResult { action, applied: output.success, message })
}

async fn capture_git_operation(command: TokioCommand, action: &str, timeout: Duration, cancellation: Option<&crate::workspace_write_runs::Cancellation>) -> Result<(crate::controlled_process::ProcessResult, String), CoreError> {
    if timeout.is_zero() { return Err(CoreError::WriteOutcomeUnknown(format!("Git {action}: deadline expired before launching the next command"))); }
    if let Some(cancel) = cancellation {
        if cancel.is_requested().await { return Err(CoreError::WriteOutcomeUnknown(format!("Git {action}: stopped before launching the next command"))); }
    }
    let output = crate::controlled_process::execute_cancellable(command, timeout, GIT_OUTPUT_LIMIT + 1, async {
        match cancellation { Some(cancel) => cancel.requested().await, None => std::future::pending::<()>().await }
    }).await
        .map_err(|error| CoreError::WriteOutcomeUnknown(format!("Git {action}: {error}")))?;
    let mut message = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        if !message.is_empty() { message.push('\n'); }
        message.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    // Redaction may shorten captured output below the byte limit. Remember
    // truncation before sanitizing so that discarded bytes are never hidden.
    let truncated = output.stdout.len() > GIT_OUTPUT_LIMIT || output.stderr.len() > GIT_OUTPUT_LIMIT || message.len() > GIT_OUTPUT_LIMIT;
    let sanitized = crate::artifact::sanitize_content("git.command", message.trim());
    let message = if truncated || sanitized.len() > GIT_OUTPUT_LIMIT {
        const SUFFIX: &str = "\n… Git 输出已截断";
        format!("{}{}", crate::artifact::truncate_utf8(&sanitized, GIT_OUTPUT_LIMIT - SUFFIX.len(), ""), SUFFIX)
    } else { sanitized };
    if output.timed_out || output.cancelled {
        return Err(CoreError::WriteOutcomeUnknown(format!("Git {action} 已停止，部分更改可能已生效。\n{message}")));
    }
    let message = if message.is_empty() {
        if output.success { "Git 操作已完成".into() }
        else { format!("git exited with {:?}", output.exit_code) }
    } else { message };
    Ok((output, message))
}

pub(crate) async fn list_workspace_git_stashes(
    db: &SqlitePool,
    workspace_id: String,
) -> Result<Vec<GitStashEntry>, CoreError> {
    list_workspace_git_stashes_in_repository(db, workspace_id, None).await
}

pub(crate) async fn list_workspace_git_stashes_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    repository_id: Option<&str>,
) -> Result<Vec<GitStashEntry>, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    let output = Command::new("git")
        .args([
            "-C",
            &repository_path,
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

pub(crate) async fn apply_workspace_git_stash_requested(
    db: &SqlitePool,
    workspace_id: String,
    reference: String,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitWorkspaceActionResult, CoreError> {
    apply_workspace_git_stash_requested_in_repository(db, workspace_id, reference, request, None).await
}

pub(crate) async fn apply_workspace_git_stash_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    reference: String,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    validate_git_ref_name(&reference)?;
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.stash-apply", serde_json::json!({"repositoryId":repository_id,"reference":reference}), request, |cancel| async { GitOperation::new(&repository_path).cancellable(cancel).action(&["stash", "apply", &reference], "stash_apply").await }).await
}

pub(crate) async fn stash_workspace_git_requested(
    db: &SqlitePool,
    workspace_id: String,
    message: Option<String>,
    request: &crate::workspace_write_runs::Request,
) -> Result<GitWorkspaceActionResult, CoreError> {
    stash_workspace_git_requested_in_repository(db, workspace_id, message, request, None).await
}

pub(crate) async fn stash_workspace_git_requested_in_repository(
    db: &SqlitePool,
    workspace_id: String,
    message: Option<String>,
    request: &crate::workspace_write_runs::Request,
    repository_id: Option<&str>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    let workspace = workspace_by_id(db, &workspace_id).await?;
    let repository_path = crate::git_repositories::resolve(&workspace.path, repository_id)?;
    if workspace.trust != "trusted" {
        return Err(CoreError::WorkspaceTrustRequired);
    }
    let message = message.unwrap_or_else(|| "aibo workspace changes".to_owned());
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.stash-push", serde_json::json!({"repositoryId":repository_id,"message":message}), request, |cancel| async { GitOperation::new(&repository_path).cancellable(cancel).action(&["stash", "push", "-u", "-m", &message], "stash_push").await }).await
}


#[cfg(test)]
pub(crate) async fn apply_workspace_git_file_action(
    db: &SqlitePool,
    workspace_id: String,
    path: String,
    action: String,
) -> Result<GitFileActionResult, CoreError> {
    apply_workspace_git_file_action_requested(db, workspace_id, path, action, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
pub(crate) async fn apply_workspace_git_action(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    apply_workspace_git_action_requested(db, workspace_id, action, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
pub(crate) async fn commit_workspace_changes(
    db: &SqlitePool,
    workspace_id: String,
    message: String,
) -> Result<GitCommitResult, CoreError> {
    commit_workspace_changes_requested(db, workspace_id, message, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
pub(crate) async fn checkout_workspace_git_branch(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    checkout_workspace_git_branch_requested(db, workspace_id, branch, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
pub(crate) async fn create_workspace_git_branch(
    db: &SqlitePool,
    workspace_id: String,
    branch: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    create_workspace_git_branch_requested(db, workspace_id, branch, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
pub(crate) async fn sync_workspace_git(
    db: &SqlitePool,
    workspace_id: String,
    action: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    sync_workspace_git_requested(db, workspace_id, action, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
pub(crate) async fn apply_workspace_git_stash(
    db: &SqlitePool,
    workspace_id: String,
    reference: String,
) -> Result<GitWorkspaceActionResult, CoreError> {
    apply_workspace_git_stash_requested(db, workspace_id, reference, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
pub(crate) async fn stash_workspace_git(
    db: &SqlitePool,
    workspace_id: String,
    message: Option<String>,
) -> Result<GitWorkspaceActionResult, CoreError> {
    stash_workspace_git_requested(db, workspace_id, message, &crate::workspace_write_runs::Request::test()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_history_pages_continue_without_repeating_commits() {
        let root = std::env::temp_dir().join(format!("aibo-git-history-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git").arg("-C").arg(&root).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "Aibo Fixture"]);
        git(&["config", "user.email", "fixture@example.invalid"]);
        git(&["config", "commit.gpgsign", "false"]);
        for index in 0..5 { git(&["commit", "-q", "--allow-empty", "-m", &format!("Commit {index}")]); }
        let first = list_git_history(root.to_str().unwrap(), 2, 0).unwrap();
        let second = list_git_history(root.to_str().unwrap(), 2, 2).unwrap();
        let last = list_git_history(root.to_str().unwrap(), 2, 4).unwrap();
        assert_eq!(first.iter().map(|commit| commit.subject.as_str()).collect::<Vec<_>>(), ["Commit 4", "Commit 3"]);
        assert_eq!(second.iter().map(|commit| commit.subject.as_str()).collect::<Vec<_>>(), ["Commit 2", "Commit 1"]);
        assert_eq!(last[0].subject, "Commit 0");
        assert_eq!(last.len(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn group_staging_preserves_other_groups_and_conflicts() {
        let root = std::env::temp_dir().join(format!("aibo-git-groups-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.to_str().unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git").arg("-C").arg(&root).args(args).output().unwrap();
            assert!(output.status.success(), "{args:?}: {}", String::from_utf8_lossy(&output.stderr));
            output.stdout
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "Aibo Fixture"]);
        git(&["config", "user.email", "fixture@example.invalid"]);
        git(&["config", "commit.gpgsign", "false"]);
        for name in ["tracked.txt", "deleted.txt", "partial.txt", "conflict.txt", "renamed.txt"] {
            std::fs::write(root.join(name), "base\n").unwrap();
        }
        git(&["add", "."]); git(&["commit", "-qm", "base"]);
        git(&["checkout", "-qb", "topic"]);
        std::fs::write(root.join("conflict.txt"), "topic\n").unwrap();
        git(&["commit", "-qam", "topic"]); git(&["checkout", "-q", "main"]);
        std::fs::write(root.join("conflict.txt"), "main\n").unwrap();
        git(&["commit", "-qam", "main"]);
        assert!(!Command::new("git").args(["-C", path, "merge", "topic"]).output().unwrap().status.success());
        std::fs::write(root.join("tracked.txt"), "changed\n").unwrap();
        std::fs::remove_file(root.join("deleted.txt")).unwrap();
        std::fs::write(root.join("partial.txt"), "already staged\n").unwrap();git(&["add", "partial.txt"]);
        std::fs::write(root.join("partial.txt"), "working copy\n").unwrap();
        git(&["mv", "renamed.txt", "renamed target.txt"]);
        std::fs::write(root.join("renamed target.txt"), "renamed and modified\n").unwrap();
        std::fs::write(root.join("new [x].txt"), "untracked\n").unwrap();
        std::fs::create_dir(root.join("new directory")).unwrap();
        std::fs::write(root.join("new directory/nested.txt"), "nested\n").unwrap();

        assert!(run_git_workspace_action(path, "stage_changed", None).await.unwrap().applied);
        assert_eq!(git(&["show", ":tracked.txt"]), b"changed\n");
        assert_eq!(git(&["show", ":partial.txt"]), b"working copy\n");
        assert_eq!(git(&["show", ":renamed target.txt"]), b"renamed and modified\n");
        assert!(git(&["ls-files", "deleted.txt"]).is_empty());
        assert!(git(&["ls-files", "new [x].txt", "new directory/nested.txt"]).is_empty(), "changed group must not stage untracked files");
        assert!(!git(&["ls-files", "--unmerged", "conflict.txt"]).is_empty(), "changed group must not resolve conflicts");

        std::fs::write(root.join("tracked.txt"), "still unstaged\n").unwrap();
        assert!(run_git_workspace_action(path, "stage_untracked", None).await.unwrap().applied);
        assert_eq!(git(&["show", ":new [x].txt"]), b"untracked\n");
        assert_eq!(git(&["show", ":new directory/nested.txt"]), b"nested\n");
        assert_eq!(git(&["show", ":tracked.txt"]), b"changed\n", "untracked group must not stage tracked changes");
        assert!(!git(&["ls-files", "--unmerged", "conflict.txt"]).is_empty());
        assert!(run_git_workspace_action(path, "stage_untracked", None).await.unwrap().applied, "empty group is a no-op");
        assert!(run_git_workspace_action(path, "stage_all", None).await.unwrap().applied);
        assert_eq!(git(&["show", ":tracked.txt"]), b"still unstaged\n");
        assert!(git(&["ls-files", "--unmerged"]).is_empty(), "repository-wide stage_all keeps its original scope");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn group_staging_handles_unborn_and_nested_workspaces() {
        let root = std::env::temp_dir().join(format!("aibo-git-group-scope-{}", ulid::Ulid::new()));
        let nested = root.join("nested workspace");
        std::fs::create_dir_all(&nested).unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git").arg("-C").arg(&root).args(args).output().unwrap();
            assert!(output.status.success(), "{args:?}: {}", String::from_utf8_lossy(&output.stderr));
            output.stdout
        };
        git(&["init", "-q"]);
        std::fs::write(root.join("outside.txt"), "outside\n").unwrap();
        std::fs::write(nested.join("inside.txt"), "inside\n").unwrap();
        assert!(run_git_workspace_action(nested.to_str().unwrap(), "stage_changed", None).await.unwrap().applied);
        assert!(git(&["ls-files"]).is_empty(), "unborn tracked group must not stage new files");
        assert!(run_git_workspace_action(nested.to_str().unwrap(), "stage_untracked", None).await.unwrap().applied);
        assert_eq!(git(&["ls-files"]), b"nested workspace/inside.txt\n", "subdirectory workspace must not include its sibling files");
        std::fs::write(nested.join("inside.txt"), "updated\n").unwrap();
        assert!(run_git_workspace_action(nested.to_str().unwrap(), "stage_changed", None).await.unwrap().applied);
        assert_eq!(git(&["show", ":nested workspace/inside.txt"]), b"updated\n");
        #[cfg(unix)]
        {
            std::fs::write(nested.join(":(glob)*.txt"), "literal\n").unwrap();
            std::fs::write(nested.join("inside.txt"), "not staged\n").unwrap();
            assert!(run_git_workspace_action(nested.to_str().unwrap(), "stage_untracked", None).await.unwrap().applied);
            assert_eq!(git(&["show", ":nested workspace/:(glob)*.txt"]), b"literal\n");
            assert_eq!(git(&["show", ":nested workspace/inside.txt"]), b"updated\n", "literal pathspec must not expand to tracked files");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn unborn_index_and_failed_preconditions_do_not_delete_working_files_or_start_writes() {
        let root = std::env::temp_dir().join(format!("aibo-git-preconditions-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.to_str().unwrap();
        let invalid = GitOperation::new(path);
        assert!(invalid.has_head().await.is_err());
        assert!(commit_workspace(&invalid, "must not commit").await.is_err());
        assert!(Command::new("git").args(["init", "-q", path]).status().unwrap().success());
        std::fs::write(root.join("file.txt"), "keep working content").unwrap();
        assert!(apply_git_index_action(path, "file.txt", "stage", None).await.unwrap().applied);
        assert!(apply_git_index_action(path, "file.txt", "unstage", None).await.unwrap().applied);
        assert!(run_git_workspace_action(path, "stage_all", None).await.unwrap().applied);
        assert!(run_git_workspace_action(path, "unstage_all", None).await.unwrap().applied);
        assert_eq!(std::fs::read_to_string(root.join("file.txt")).unwrap(), "keep working content");
        assert!(Command::new("git").args(["-C", path, "ls-files"]).output().unwrap().stdout.is_empty());
        let expired = GitOperation { workspace_path: path, cancellation: None, deadline: Instant::now() - Duration::from_secs(1) };
        assert!(expired.action(&["config", "aibo.unexpected", "written"], "expired-write").await.is_err());
        assert!(!Command::new("git").args(["-C", path, "config", "--get", "aibo.unexpected"]).status().unwrap().success());
        #[cfg(unix)]
        {
        // A nested workspace must not reinterpret a filename as a repository-root pathspec.
        let nested = root.join("nested"); std::fs::create_dir(&nested).unwrap();
        std::fs::write(root.join("outside.txt"), "outside workspace").unwrap();
        assert!(!apply_git_index_action(nested.to_str().unwrap(), ":(top)outside.txt", "stage", None).await.unwrap().applied);
        assert!(Command::new("git").args(["-C", path, "ls-files"]).output().unwrap().stdout.is_empty());
        std::fs::write(nested.join(":(glob)*.txt"), "literal name").unwrap();
        assert!(apply_git_index_action(nested.to_str().unwrap(), ":(glob)*.txt", "stage", None).await.unwrap().applied);
        let staged = Command::new("git").args(["-C", path, "ls-files"]).output().unwrap();
        assert!(String::from_utf8_lossy(&staged.stdout).contains(":(glob)*.txt"));
        assert!(!String::from_utf8_lossy(&staged.stdout).contains("outside.txt"));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn commit_hook_timeout_preserves_uncertain_commit_and_stops_descendants() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("aibo-git-hook-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.to_str().unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git").args(["-C", path]).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        };
        git(&["init", "-q"]); git(&["config", "user.name", "Aibo Fixture"]);
        git(&["config", "user.email", "fixture@example.invalid"]); git(&["config", "commit.gpgsign", "false"]);
        let hooks = root.join("hooks"); std::fs::create_dir(&hooks).unwrap();
        git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
        let hook = hooks.join("post-commit");
        std::fs::write(&hook, "#!/bin/sh\nprintf POST_COMMIT_STARTED\ntouch hook-started\n(sleep 6; touch late-hook-effect) &\nwait\n").unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(root.join("file.txt"), "committed content").unwrap();
        git(&["add", "--", "file.txt"]);
        let operation = GitOperation { workspace_path: path, cancellation: None, deadline: Instant::now() + Duration::from_secs(3) };
        let error = tokio::time::timeout(Duration::from_secs(5), commit_workspace(&operation, "Fixture\n\nCo-authored-by: Codex <codex@openai.com>")).await.unwrap().unwrap_err();
        assert!(matches!(&error, CoreError::WriteOutcomeUnknown(_)), "{error}");
        assert!(error.to_string().contains("POST_COMMIT_STARTED"), "{error}");
        assert!(root.join("hook-started").exists());
        // A commit can exist even though its post-commit hook never returned.
        assert_eq!(git(&["show", "HEAD:file.txt"]), "committed content");
        assert_eq!(git(&["rev-list", "--count", "HEAD"]), "1");
        tokio::time::sleep(Duration::from_millis(6200)).await;
        assert!(!root.join("late-hook-effect").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

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
        let result = tokio::time::timeout(Duration::from_secs(5), execute_git_action(command, "fetch".into(), Duration::from_secs(2), None)).await.unwrap();
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
        let result = execute_git_action(command, "fetch".into(), Duration::from_secs(3), None).await.unwrap();
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
        assert!(checkout_workspace_git_branch(&db, "workspace".into(), "main".into()).await.unwrap().applied);
        assert!(checkout_workspace_git_branch(&db, "workspace".into(), "service-test".into()).await.unwrap().applied);
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
        let history = crate::workspace_write_runs::list(&db, "workspace".into(), Some(100)).await.unwrap();
        let history = serde_json::to_value(history).unwrap();
        for operation in ["git.index", "git.commit", "git.create-branch", "git.checkout", "git.stash-push", "git.stash-apply", "git.sync"] {
            assert!(history.as_array().unwrap().iter().any(|run| run["operation"] == operation && run["status"] == "completed" && run["result"]["ok"] == true), "missing history for {operation}");
        }
        let remote_head = Command::new("git").arg("-C").arg(&remote).args(["rev-parse", "refs/heads/service-test"]).output().unwrap();
        assert!(remote_head.status.success());
        assert_eq!(String::from_utf8_lossy(&remote_head.stdout).trim(), git(&["rev-parse", "HEAD"]));
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='workspace'").execute(&db).await.unwrap();
        for action in ["stage_all", "stage_changed", "stage_untracked"] {
            assert!(matches!(apply_workspace_git_action(&db, "workspace".into(), action.into()).await, Err(CoreError::WorkspaceTrustRequired)));
        }
        assert!(git(&["diff", "--cached", "--name-only"]).is_empty());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
