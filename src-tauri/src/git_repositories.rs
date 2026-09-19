//! Workspace-owned repository discovery and target resolution.
use crate::{AppState, CoreError};
use serde::Serialize;
use std::{
    collections::{HashSet, VecDeque},
    path::{Component, Path, PathBuf},
    process::Command,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Repository {
    id: String,
    name: String,
    relative_path: String,
    kind: &'static str,
    external_root: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Discovery {
    repositories: Vec<Repository>,
    limited: bool,
    warnings: Vec<String>,
    scan_budget: usize,
}
fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::InvalidWorkspacePath(message.into())
}
fn top_level(path: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .args(["-C"])
        .arg(path)
        .args(["rev-parse", "--show-toplevel"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    std::fs::canonicalize(
        String::from_utf8(output.stdout)
            .ok()?
            .trim_end_matches(['\r', '\n']),
    )
    .ok()
}
/// IDs are workspace-relative directories, never arbitrary absolute paths. Recheck
/// canonical containment and the repository boundary on every read and write.
pub(crate) fn resolve(workspace: &str, id: Option<&str>) -> Result<String, CoreError> {
    let Some(id) = id else {
        return Ok(workspace.to_owned());
    };
    let root = std::fs::canonicalize(workspace).map_err(|e| invalid(e.to_string()))?;
    let candidate = if id == "." {
        root.clone()
    } else {
        if id.is_empty()
            || Path::new(id)
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(invalid("invalid repository ID"));
        }
        let path = std::fs::canonicalize(root.join(id)).map_err(|e| invalid(e.to_string()))?;
        if !path.starts_with(&root) {
            return Err(invalid("repository escapes workspace"));
        }
        path
    };
    let top = top_level(&candidate).ok_or_else(|| invalid("repository is no longer available"))?;
    if id != "." && top != candidate {
        return Err(invalid("repository boundary changed"));
    }
    Ok(candidate.to_string_lossy().into_owned())
}
fn discover(workspace: &str, budget: usize) -> Result<Discovery, CoreError> {
    let root = std::fs::canonicalize(workspace).map_err(|e| invalid(e.to_string()))?;
    let mut result = Discovery {
        repositories: vec![],
        limited: false,
        warnings: vec![],
        scan_budget: budget,
    };
    let mut pending = VecDeque::from([(root.clone(), 0)]);
    let max_depth = 8 + budget / 2000;
    let max_repositories = (budget / 16).max(1);
    let mut visited = 0;
    let mut seen = HashSet::new();
    while let Some((path, depth)) = pending.pop_front() {
        if visited >= budget || result.repositories.len() >= max_repositories {
            result.limited = true;
            break;
        }
        visited += 1;
        let marker = path.join(".git");
        if path == root || marker.exists() {
            if let Some(top) = top_level(&path) {
                if (path == root || top == path) && seen.insert(top.clone()) {
                    let relative = path.strip_prefix(&root).unwrap();
                    let id = if relative.as_os_str().is_empty() {
                        ".".into()
                    } else {
                        relative.to_string_lossy().into_owned()
                    };
                    let kind = if marker.is_file() {
                        let output = Command::new("git")
                            .arg("-C")
                            .arg(&path)
                            .args(["rev-parse", "--show-superproject-working-tree"])
                            .output();
                        if output.is_ok_and(|o| {
                            o.status.success() && !o.stdout.iter().all(u8::is_ascii_whitespace)
                        }) {
                            "submodule"
                        } else {
                            "worktree"
                        }
                    } else {
                        "repository"
                    };
                    result.repositories.push(Repository {
                        id,
                        name: top
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                        relative_path: if relative.as_os_str().is_empty() {
                            ".".into()
                        } else {
                            relative.to_string_lossy().into_owned()
                        },
                        kind,
                        external_root: !top.starts_with(&root),
                    });
                }
            } else if marker.exists() {
                result.warnings.push(format!(
                    "无法读取仓库 {}",
                    path.strip_prefix(&root).unwrap().display()
                ));
            }
        }
        let entries = match std::fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(e) => {
                result.warnings.push(format!(
                    "{}: {e}",
                    path.strip_prefix(&root).unwrap().display()
                ));
                continue;
            }
        };
        let mut dirs = vec![];
        for entry in entries.flatten() {
            let name = entry.file_name();
            if matches!(
                name.to_str(),
                Some(
                    ".git"
                        | "node_modules"
                        | "target"
                        | "dist"
                        | "build"
                        | ".next"
                        | ".venv"
                        | "vendor"
                        | ".cache"
                )
            ) {
                continue;
            }
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                dirs.push(entry.path());
            }
        }
        dirs.sort();
        if depth >= max_depth && !dirs.is_empty() {
            result.limited = true;
        } else {
            pending.extend(dirs.into_iter().map(|path| (path, depth + 1)));
        }
    }
    Ok(result)
}
#[tauri::command]
pub(crate) async fn list_workspace_git_repositories(
    workspace_id: String,
    scan_budget: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Discovery, CoreError> {
    let workspace = crate::workspace_by_id(&state.db, &workspace_id).await?;
    let budget = scan_budget.unwrap_or(2000).clamp(1, 100_000);
    tokio::task::spawn_blocking(move || discover(&workspace.path, budget))
        .await
        .map_err(|e| invalid(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn git(path: &Path, args: &[&str]) {
        assert!(Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap()
            .status
            .success());
    }
    #[test]
    fn discovers_siblings_nested_and_worktrees_and_bounds_targets() {
        let root = std::env::temp_dir().join(format!("aibo-repositories-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(root.join("one/nested")).unwrap();
        std::fs::create_dir_all(root.join("two")).unwrap();
        for name in ["one", "one/nested", "two"] {
            git(&root.join(name), &["init", "-q"]);
        }
        git(
            &root.join("one"),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        );
        git(
            &root.join("one"),
            &["worktree", "add", "-b", "linked", "../linked"],
        );
        let found = discover(root.to_str().unwrap(), 2000).unwrap();
        assert_eq!(found.repositories.len(), 4);
        assert!(found
            .repositories
            .iter()
            .any(|r| r.id == "linked" && r.kind == "worktree"));
        assert!(found.repositories.iter().any(|r| r.id == "one/nested"));
        assert!(discover(root.to_str().unwrap(), 1).unwrap().limited);
        assert!(resolve(root.to_str().unwrap(), Some("one"))
            .unwrap()
            .ends_with("one"));
        assert!(resolve(root.to_str().unwrap(), Some("../outside")).is_err());
        assert!(resolve(root.to_str().unwrap(), Some("/tmp")).is_err());
        std::fs::create_dir(root.join("one/ordinary")).unwrap();
        assert!(resolve(root.to_str().unwrap(), Some("one/ordinary")).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("one"), root.join("alias")).unwrap();
            assert_eq!(
                discover(root.to_str().unwrap(), 2000)
                    .unwrap()
                    .repositories
                    .len(),
                4
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn repository_operations_isolate_sibling_indexes_commits_branches_and_stashes() {
        use crate::workspace_git::*;
        use crate::workspace_write_runs::Request;
        let root =
            std::env::temp_dir().join(format!("aibo-repository-actions-{}", ulid::Ulid::new()));
        for name in ["one", "two"] {
            let path = root.join(name);
            std::fs::create_dir_all(&path).unwrap();
            git(&path, &["init", "-q", "-b", "main"]);
            git(&path, &["config", "user.name", "Fixture"]);
            git(&path, &["config", "user.email", "fixture@example.invalid"]);
            git(&path, &["config", "commit.gpgsign", "false"]);
            git(&path, &["config", "core.hooksPath", "/dev/null"]);
            std::fs::write(path.join("same.txt"), name).unwrap();
        }
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        let now = crate::now_iso();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Parent',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(&now).bind(&now).execute(&db).await.unwrap();
        let request = Request::test();
        assert!(
            apply_workspace_git_file_action_requested_in_repository(
                &db,
                "w".into(),
                "same.txt".into(),
                "stage".into(),
                &request,
                Some("two")
            )
            .await
            .unwrap()
            .applied
        );
        // Reusing a write ID for a different repository must not replay the first result.
        assert!(apply_workspace_git_file_action_requested_in_repository(
            &db,
            "w".into(),
            "same.txt".into(),
            "stage".into(),
            &request,
            Some("one")
        )
        .await
        .is_err());
        let one = crate::workspace_changes(&root.join("one")).await.unwrap();
        let two = crate::workspace_changes(&root.join("two")).await.unwrap();
        assert!(!one.files[0].staged);
        assert!(two.files[0].staged);
        let diff = crate::workspace_file_diff(
            &resolve(root.to_str().unwrap(), Some("two")).unwrap(),
            "same.txt",
            true,
        )
        .unwrap();
        assert!(diff.diff.contains("+two"));
        assert!(!diff.diff.contains("+one"));
        let committed = commit_workspace_changes_requested_in_repository(
            &db,
            "w".into(),
            "Only two".into(),
            &Request::test(),
            Some("two"),
        )
        .await
        .unwrap();
        assert!(committed.committed);
        assert_eq!(
            list_workspace_git_history_in_repository(&db, "w".into(), None, Some("two"))
                .await
                .unwrap()[0]
                .subject,
            "Only two"
        );
        assert!(
            list_workspace_git_history_in_repository(&db, "w".into(), None, Some("one"))
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            create_workspace_git_branch_requested_in_repository(
                &db,
                "w".into(),
                "topic".into(),
                &Request::test(),
                Some("two")
            )
            .await
            .unwrap()
            .applied
        );
        assert!(
            list_workspace_git_branches_in_repository(&db, "w".into(), Some("two"))
                .await
                .unwrap()
                .iter()
                .any(|b| b.name == "topic" && b.current)
        );
        std::fs::write(root.join("two/same.txt"), "changed").unwrap();
        assert!(
            stash_workspace_git_requested_in_repository(
                &db,
                "w".into(),
                None,
                &Request::test(),
                Some("two")
            )
            .await
            .unwrap()
            .applied
        );
        assert_eq!(
            std::fs::read_to_string(root.join("two/same.txt")).unwrap(),
            "two"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("one/same.txt")).unwrap(),
            "one"
        );
        assert_eq!(
            list_workspace_git_stashes_in_repository(&db, "w".into(), Some("two"))
                .await
                .unwrap()
                .len(),
            1
        );
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'")
            .execute(&db)
            .await
            .unwrap();
        assert!(apply_workspace_git_file_action_requested_in_repository(
            &db,
            "w".into(),
            "same.txt".into(),
            "stage".into(),
            &Request::test(),
            Some("one")
        )
        .await
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovers_submodules_and_marks_external_roots_without_following_directory_links() {
        let root =
            std::env::temp_dir().join(format!("aibo-repository-submodule-{}", ulid::Ulid::new()));
        let project = root.join("project");
        let seed = root.join("seed");
        for path in [&project, &seed] {
            std::fs::create_dir_all(path).unwrap();
            git(path, &["init", "-q"]);
            git(
                path,
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "commit",
                    "--allow-empty",
                    "-m",
                    "initial",
                ],
            );
        }
        git(
            &project,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                seed.to_str().unwrap(),
                "module",
            ],
        );
        let found = discover(project.to_str().unwrap(), 2000).unwrap();
        assert_eq!(found.repositories.len(), 2);
        assert!(found
            .repositories
            .iter()
            .any(|repo| repo.id == "module" && repo.kind == "submodule"));
        std::fs::create_dir(project.join("inner")).unwrap();
        let nested = discover(project.join("inner").to_str().unwrap(), 2000).unwrap();
        assert!(nested.repositories[0].external_root);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&seed, project.join("outside")).unwrap();
            assert_eq!(
                discover(project.to_str().unwrap(), 2000)
                    .unwrap()
                    .repositories
                    .len(),
                2
            );
            assert!(resolve(project.to_str().unwrap(), Some("outside")).is_err());
        }
        std::fs::remove_file(project.join("module/.git")).unwrap();
        assert!(resolve(project.to_str().unwrap(), Some("module")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
