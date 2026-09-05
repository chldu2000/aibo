//! Workspace boundary checks shared by controlled tools and project actions.
//!
//! This module intentionally does not perform any I/O beyond canonicalizing
//! paths. Callers still decide whether an operation is allowed by the resolved
//! execution profile and workspace trust state.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// Resolve a target beneath `workspace_root` without allowing symlink or
/// parent-directory escape.
///
/// The target may not exist yet (for example, a new file passed to a write
/// tool). In that case the nearest existing parent is canonicalized and the
/// missing suffix is appended for the containment check.
pub(crate) fn canonicalize_target(workspace_root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(workspace_root)
        .map_err(|error| format!("workspace root is unavailable: {error}"))?;
    let candidate = if target.is_absolute() {
        target.to_path_buf()
    } else {
        root.join(target)
    };

    let (existing, missing) = split_existing_prefix(&candidate)?;
    let canonical_existing = std::fs::canonicalize(&existing)
        .map_err(|error| format!("target parent is unavailable: {error}"))?;
    if !canonical_existing.starts_with(&root) {
        return Err("target escapes the workspace".to_owned());
    }

    let resolved = missing
        .into_iter()
        .fold(canonical_existing, |path, part| path.join(part));
    if !resolved.starts_with(&root) {
        return Err("target escapes the workspace".to_owned());
    }
    Ok(resolved)
}

fn split_existing_prefix(path: &Path) -> Result<(PathBuf, Vec<std::ffi::OsString>), String> {
    let mut missing = Vec::new();
    let mut cursor = path.to_path_buf();
    while !cursor.exists() {
        let Some(name) = cursor.file_name() else {
            return Err("target has no existing parent".to_owned());
        };
        missing.push(name.to_owned());
        cursor = cursor
            .parent()
            .ok_or_else(|| "target has no existing parent".to_owned())?
            .to_path_buf();
    }
    missing.reverse();
    Ok((cursor, missing))
}

#[cfg(test)]
mod tests {
    use super::canonicalize_target;
    use std::{fs, path::PathBuf};

    fn tempdir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "aibo-workspace-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&path).expect("temp directory");
        path
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
