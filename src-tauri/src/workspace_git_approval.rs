//! Bounded, read-only local repository fingerprint for approval revalidation.
use crate::CoreError;
use sha2::{Digest, Sha256};
use std::{path::Path, time::{Duration, Instant}};
use tokio::{io::AsyncReadExt, process::Command};

fn invalid(message: impl Into<String>) -> CoreError { CoreError::InvalidWorkspacePath(message.into()) }

pub(crate) async fn fingerprint(path: &str) -> Result<String, CoreError> {
    let deadline = Instant::now() + Duration::from_secs(15);
    async fn read(path: &str, args: &[&str], deadline: Instant) -> Result<Vec<u8>, CoreError> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { return Err(invalid("Git approval inspection timed out")); }
        let mut command = Command::new("git");
        command.args(["--literal-pathspecs", "-C", path]).args(args)
            .env("GIT_OPTIONAL_LOCKS", "0").env("GIT_TERMINAL_PROMPT", "0");
        let output = crate::controlled_process::execute(command, remaining, 8 * 1024 * 1024 + 1).await
            .map_err(|error| invalid(format!("Git approval inspection failed: {error}")))?;
        if !output.success || output.timed_out || output.stdout.len() > 8 * 1024 * 1024 || output.stderr.len() > 8 * 1024 * 1024 {
            return Err(invalid("Git approval inspection failed or exceeded its bounds"));
        }
        Ok(output.stdout)
    }
    let root = read(path, &["rev-parse", "--show-toplevel"], deadline).await?;
    let root = String::from_utf8(root).map_err(|_| invalid("Git root is not UTF-8"))?;
    let root = root.trim_end_matches(['\r', '\n']);
    let mut hash = Sha256::new();
    for args in [
        vec!["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
        vec!["for-each-ref", "--format=%(refname) %(objectname)"],
        vec!["diff", "--no-ext-diff", "--no-textconv", "--binary"],
        vec!["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary"],
        vec!["config", "--null", "--list", "--show-origin"],
    ] {
        let bytes = read(root, &args, deadline).await?;
        hash.update((bytes.len() as u64).to_le_bytes()); hash.update(bytes);
    }
    // Status alone cannot detect edits to an already-untracked file.
    let paths = read(root, &["ls-files", "--others", "--exclude-standard", "-z"], deadline).await?;
    hash.update((paths.len() as u64).to_le_bytes()); hash.update(&paths);
    let mut remaining = 16 * 1024 * 1024_u64;
    for raw in paths.split(|byte| *byte == 0).filter(|raw| !raw.is_empty()) {
        let relative = std::str::from_utf8(raw).map_err(|_| invalid("Git path is not UTF-8"))?;
        let file = Path::new(root).join(relative);
        let bytes = tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), async {
            let metadata = tokio::fs::symlink_metadata(&file).await?;
            hash.update([u8::from(metadata.file_type().is_symlink())]);
            #[cfg(unix)]
            { use std::os::unix::fs::PermissionsExt; hash.update(metadata.permissions().mode().to_le_bytes()); }
            #[cfg(not(unix))]
            hash.update([u8::from(metadata.permissions().readonly())]);
            if metadata.file_type().is_symlink() {
                return Ok::<_, std::io::Error>(tokio::fs::read_link(&file).await?.as_os_str().as_encoded_bytes().to_vec());
            }
            if !metadata.is_file() { return Err(std::io::Error::other("unsupported untracked file type")); }
            let mut bytes = Vec::new();
            tokio::fs::File::open(&file).await?.take(remaining + 1).read_to_end(&mut bytes).await?;
            Ok(bytes)
        }).await.map_err(|_| invalid("Git approval file inspection timed out"))?
            .map_err(|error| invalid(format!("Git approval file inspection failed: {error}")))?;
        if bytes.len() as u64 > remaining { return Err(invalid("Git approval untracked data exceeds 16 MiB")); }
        remaining -= bytes.len() as u64;
        hash.update((bytes.len() as u64).to_le_bytes()); hash.update(bytes);
    }
    Ok(format!("sha256:{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn fingerprint_tracks_index_worktree_refs_configuration_and_untracked_bounds() {
        let root = std::env::temp_dir().join(format!("aibo-git-approval-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.to_str().unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git").args(["-C", path]).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        };
        git(&["init", "-q"]); git(&["config", "user.name", "Aibo Fixture"]); git(&["config", "user.email", "fixture@example.invalid"]);
        git(&["config", "commit.gpgsign", "false"]); git(&["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(root.join("file.txt"), "first\n").unwrap(); git(&["add", "--", "file.txt"]);
        git(&["commit", "-qm", "Fixture\n\nCo-authored-by: Codex <codex@openai.com>"]);
        let initial = fingerprint(path).await.unwrap(); assert_eq!(fingerprint(path).await.unwrap(), initial);
        std::fs::write(root.join("file.txt"), "working change\n").unwrap();
        let working = fingerprint(path).await.unwrap(); assert_ne!(working, initial);
        git(&["add", "--", "file.txt"]); assert_ne!(fingerprint(path).await.unwrap(), working);
        git(&["restore", "--staged", "--worktree", "--", "file.txt"]); assert_eq!(fingerprint(path).await.unwrap(), initial);
        git(&["branch", "approval-ref"]); let refs = fingerprint(path).await.unwrap(); assert_ne!(refs, initial);
        git(&["config", "aibo.fixture", "changed"]); let config = fingerprint(path).await.unwrap(); assert_ne!(config, refs);
        std::fs::write(root.join("untracked"), "first").unwrap(); let untracked = fingerprint(path).await.unwrap(); assert_ne!(untracked, config);
        std::fs::write(root.join("untracked"), "other").unwrap(); assert_ne!(fingerprint(path).await.unwrap(), untracked);
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            let before = fingerprint(path).await.unwrap();
            std::fs::set_permissions(root.join("untracked"), std::fs::Permissions::from_mode(0o700)).unwrap();
            assert_ne!(fingerprint(path).await.unwrap(), before);
        }
        std::fs::File::create(root.join("oversized")).unwrap().set_len(16 * 1024 * 1024 + 1).unwrap();
        assert!(fingerprint(path).await.unwrap_err().to_string().contains("16 MiB"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
