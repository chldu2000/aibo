//! Workspace boundary checks shared by controlled tools and project actions.
//!
//! This module intentionally does not perform any I/O beyond canonicalizing
//! paths. Callers still decide whether an operation is allowed by the resolved
//! execution profile and workspace trust state.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use crate::ui_i18n::HostMessage;
use serde_json::json;

/// Resolve a target beneath `workspace_root` without allowing symlink or
/// parent-directory escape.
///
/// The target may not exist yet (for example, a new file passed to a write
/// tool). In that case the nearest existing parent is canonicalized and the
/// missing suffix is appended for the containment check.
pub(crate) fn canonicalize_target(workspace_root: &Path, target: &Path) -> Result<PathBuf, String> {
    canonicalize_target_message(workspace_root, target).map_err(|error| error.diagnostic)
}

/// Preserve display ownership for host UI consumers; tool protocols use the String wrapper.
pub(crate) fn canonicalize_target_message(workspace_root: &Path, target: &Path) -> Result<PathBuf, HostMessage> {
    let root = std::fs::canonicalize(workspace_root)
        .map_err(|error| HostMessage::with_diagnostic("native.path.workspaceUnavailable", json!({"error":error.to_string()}), format!("workspace root is unavailable: {error}")))?;
    let candidate = if target.is_absolute() {
        target.to_path_buf()
    } else {
        root.join(target)
    };

    let (existing, missing) = split_existing_prefix(&candidate)?;
    let canonical_existing = std::fs::canonicalize(&existing)
        .map_err(|error| HostMessage::with_diagnostic("native.path.parentUnavailable", json!({"error":error.to_string()}), format!("target parent is unavailable: {error}")))?;
    if !canonical_existing.starts_with(&root) {
        return Err(HostMessage::with_diagnostic("native.path.outsideWorkspace", json!({}), "target escapes the workspace"));
    }

    let resolved = missing
        .into_iter()
        .fold(canonical_existing, |path, part| path.join(part));
    if !resolved.starts_with(&root) {
        return Err(HostMessage::with_diagnostic("native.path.outsideWorkspace", json!({}), "target escapes the workspace"));
    }
    Ok(resolved)
}

fn split_existing_prefix(path: &Path) -> Result<(PathBuf, Vec<std::ffi::OsString>), HostMessage> {
    let mut missing = Vec::new();
    let mut cursor = path.to_path_buf();
    while !cursor.exists() {
        let Some(name) = cursor.file_name() else {
            return Err(HostMessage::with_diagnostic("native.path.noParent", json!({}), "target has no existing parent"));
        };
        missing.push(name.to_owned());
        cursor = cursor
            .parent()
            .ok_or_else(|| HostMessage::with_diagnostic("native.path.noParent", json!({}), "target has no existing parent"))?
            .to_path_buf();
    }
    missing.reverse();
    Ok((cursor, missing))
}

#[cfg(test)]
mod tests {
    use super::canonicalize_target;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn tempdir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "aibo-workspace-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&path).expect("temp directory");
        path
    }

    #[tokio::test]
    async fn localized_boundary_errors_preserve_tool_diagnostics_and_block_shared_reads_and_writes() {
        use crate::ui_i18n::{Locale, render};
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("workspace");
        fs::create_dir(&root).unwrap();
        let outside = directory.path().join("原文{path}.txt");
        fs::write(&outside, "原始正文").unwrap();
        let init = std::process::Command::new("git").arg("init").arg(&root).output().unwrap();
        assert!(init.status.success());
        let mut targets = vec![PathBuf::from("../原文{path}.txt")];
        #[cfg(unix)] {
            std::os::unix::fs::symlink(directory.path(), root.join("link")).unwrap();
            targets.push(PathBuf::from("link/原文{path}.txt"));
        }
        for target in targets {
            let owned = super::canonicalize_target_message(&root, &target).unwrap_err();
            assert_eq!(owned.diagnostic, "target escapes the workspace");
            assert_eq!(canonicalize_target(&root, &target).unwrap_err(), owned.diagnostic);
            assert_eq!(render(Locale::ZhCn, &owned.display()), "目标路径超出工作区范围。");
            let errors = [
                crate::file_preview::read(&root, &target, None).unwrap_err(),
                crate::text_preview::read_text(&root, &target).unwrap_err(),
                crate::workspace_diff::workspace_file_diff(root.to_str().unwrap(), target.to_str().unwrap(), false).unwrap_err(),
                crate::workspace_git::apply_git_index_action(root.to_str().unwrap(), target.to_str().unwrap(), "stage", None).await.unwrap_err(),
            ];
            for (index, error) in errors.into_iter().enumerate() {
                let value = serde_json::to_value(error).unwrap();
                let (code, prefix) = if index < 2 { ("session_operation_error", "session operation failed: ") } else { ("invalid_workspace_path", "invalid workspace path: ") };
                assert_eq!(value["code"], code);
                assert_eq!(value["message"], format!("{prefix}target escapes the workspace"));
                assert_eq!(value["localized"], owned.display());
                assert_eq!(render(Locale::En, &value["localized"]), owned.diagnostic);
            }
            assert_eq!(fs::read_to_string(&outside).unwrap(), "原始正文");
            let index = std::process::Command::new("git").current_dir(&root).args(["ls-files"]).output().unwrap();
            assert!(index.status.success());
            assert!(index.stdout.is_empty());
        }
        let missing_root = root.join("missing{error}");
        let error = super::canonicalize_target_message(&missing_root, std::path::Path::new("file")).unwrap_err();
        let os_error = fs::canonicalize(&missing_root).unwrap_err().to_string();
        assert_eq!(error.diagnostic, format!("workspace root is unavailable: {os_error}"));
        assert_eq!(error.display()["params"]["error"], os_error);
        assert_eq!(render(Locale::ZhCn, &error.display()), format!("工作区根目录不可用：{os_error}"));
        assert_eq!(canonicalize_target(&missing_root, std::path::Path::new("file")).unwrap_err(), error.diagnostic);
        let no_parent = super::split_existing_prefix(std::path::Path::new("missing-parent/child")).unwrap_err();
        assert_eq!(no_parent.diagnostic, "target has no existing parent");
        assert_eq!(no_parent.display()["key"], "native.path.noParent");
        fs::write(root.join("safe.txt"), "正常正文").unwrap();
        assert_eq!(crate::text_preview::read_text(&root, std::path::Path::new("safe.txt")).unwrap(), ("正常正文".into(), false));
        crate::workspace_git::apply_git_index_action(root.to_str().unwrap(), "safe.txt", "stage", None).await.unwrap();
        let index = std::process::Command::new("git").current_dir(&root).args(["ls-files"]).output().unwrap();
        assert!(index.status.success());
        assert_eq!(String::from_utf8(index.stdout).unwrap(), "safe.txt\n");
    }

    #[test]
    fn accepts_existing_and_new_targets_inside_workspace() {
        let directory = tempdir();
        let root = directory.join("workspace");
        fs::create_dir_all(root.join("src")).expect("workspace");
        fs::write(root.join("src/main.rs"), "fn main() {}").expect("file");

        let existing = canonicalize_target(&root, root.join("src/main.rs").as_path())
            .expect("existing target");
        assert!(existing.ends_with("src/main.rs"));
        let new_target =
            canonicalize_target(&root, std::path::Path::new("src/new.rs")).expect("new target");
        assert!(new_target.ends_with("src/new.rs"));
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn rejects_parent_escape() {
        let directory = tempdir();
        let root = directory.join("workspace");
        fs::create_dir_all(&root).expect("workspace");
        let error = canonicalize_target(&root, std::path::Path::new("../outside.txt"))
            .expect_err("escape should be rejected");
        assert!(error.contains("escapes"));
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let directory = tempdir();
        let root = directory.join("workspace");
        let outside = directory.join("outside");
        fs::create_dir_all(&root).expect("workspace");
        fs::create_dir_all(&outside).expect("outside");
        std::os::unix::fs::symlink(&outside, root.join("link")).expect("symlink");
        let error = canonicalize_target(&root, std::path::Path::new("link/file.txt"))
            .expect_err("symlink escape should be rejected");
        assert!(error.contains("escapes"));
        fs::remove_dir_all(directory).expect("cleanup");
    }
}
