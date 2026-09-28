//! The app owns Node. Never fall back to a user/global installation.
use std::{path::{Path, PathBuf}, sync::OnceLock};

static RESOURCE_ROOT: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn initialize(resources: PathBuf) {
    let _ = RESOURCE_ROOT.set(resources);
}

fn at(root: &Path) -> Option<PathBuf> {
    let path = root.join("node-runtime").join(if cfg!(windows) { "node.exe" } else { "node" });
    crate::is_executable(&path).then_some(path)
}

pub(crate) fn executable() -> Option<PathBuf> {
    if let Some(root) = RESOURCE_ROOT.get() { return at(root); }
    // Cargo tests and source development use the same prepared distribution.
    #[cfg(debug_assertions)]
    { return at(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")); }
    #[cfg(not(debug_assertions))]
    { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_runtime_does_not_resolve_system_node() {
        assert!(at(&std::env::temp_dir().join(ulid::Ulid::new().to_string())).is_none());
    }
    #[test]
    fn prepared_node_runs_without_path() {
        let node = executable().expect("run pnpm prepare:node before Cargo tests");
        let output = std::process::Command::new(node).env_clear()
            .args(["--input-type=module", "-e", "console.log(process.versions.node)"]).output().unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "24.18.0");
    }
}
