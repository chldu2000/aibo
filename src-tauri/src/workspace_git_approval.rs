//! Bounded, read-only local repository fingerprint for approval revalidation.
use crate::CoreError;
use sha2::{Digest, Sha256};
use std::{path::Path, time::{Duration, Instant}};
use tokio::{io::AsyncReadExt, process::Command};

fn invalid(message: impl Into<String>) -> CoreError { CoreError::InvalidWorkspacePath(message.into()) }

/// Inspection avoids worktree status/diff: those reads can run clean filters or
/// fsmonitor hooks. Plumbing commands use a fixed policy; working bytes are hashed
/// by the host, including files marked assume-unchanged or skip-worktree.
pub(crate) fn read_command(path: &str, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.args(["--no-lazy-fetch", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false", "-C", path]).args(args)
        .env("GIT_OPTIONAL_LOCKS", "0").env("GIT_NO_LAZY_FETCH", "1").env("GIT_TERMINAL_PROMPT", "0");
    command
}

async fn read(path: &str, args: &[&str], deadline: Instant) -> Result<Vec<u8>, CoreError> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() { return Err(invalid("Git approval inspection timed out")); }
    let output = crate::controlled_process::execute(read_command(path, args), remaining, 8 * 1024 * 1024 + 1).await
        .map_err(|error| invalid(format!("Git approval inspection failed: {error}")))?;
    if !output.success || output.timed_out || output.stdout.len() > 8 * 1024 * 1024 || output.stderr.len() > 8 * 1024 * 1024 {
        return Err(invalid("Git approval inspection failed or exceeded its bounds (Git must support --no-lazy-fetch)"));
    }
    Ok(output.stdout)
}
fn frame(hash: &mut Sha256, bytes: &[u8]) { hash.update((bytes.len() as u64).to_le_bytes()); hash.update(bytes); }

// Stream tracked files without retaining their contents. Untracked data retains
// its aggregate 16 MiB admission limit; all reads share the original deadline.
async fn hash_entry(hash: &mut Sha256, file: &Path, deadline: Instant, budget: &mut Option<u64>) -> Result<bool, CoreError> {
    tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), async {
        let metadata = match tokio::fs::symlink_metadata(file).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => { frame(hash, b"absent"); return Ok(false); }
            Err(error) => return Err(invalid(format!("Git approval file inspection failed: {error}"))),
        };
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; frame(hash, &metadata.permissions().mode().to_le_bytes()); }
        #[cfg(not(unix))] frame(hash, &[u8::from(metadata.permissions().readonly())]);
        if metadata.file_type().is_symlink() {
            frame(hash, b"symlink");
            let target = tokio::fs::read_link(file).await.map_err(|error| invalid(error.to_string()))?;
            let bytes = target.as_os_str().as_encoded_bytes();
            consume(budget, bytes.len() as u64)?; frame(hash, bytes); return Ok(false);
        }
        if metadata.is_dir() { frame(hash, b"directory"); return Ok(true); }
        if !metadata.is_file() { return Err(invalid("unsupported Git working-tree file type")); }
        frame(hash, b"file");
        let mut input = tokio::fs::File::open(file).await.map_err(|error| invalid(error.to_string()))?;
        let mut content = Sha256::new(); let mut length = 0_u64; let mut buffer = vec![0; 64 * 1024];
        loop {
            let read = input.read(&mut buffer).await.map_err(|error| invalid(error.to_string()))?;
            if read == 0 { break; }
            consume(budget, read as u64)?; content.update(&buffer[..read]); length += read as u64;
        }
        frame(hash, &length.to_le_bytes()); frame(hash, &content.finalize()); Ok(false)
    }).await.map_err(|_| invalid("Git approval file inspection timed out"))?
}
fn consume(budget: &mut Option<u64>, count: u64) -> Result<(), CoreError> {
    if let Some(remaining) = budget {
        if count > *remaining { return Err(invalid("Git approval untracked data exceeds 16 MiB")); }
        *remaining -= count;
    }
    Ok(())
}
fn relative_path(root: &Path, raw: &[u8]) -> Result<std::path::PathBuf, CoreError> {
    let path = std::str::from_utf8(raw).map_err(|_| invalid("Git path is not UTF-8"))?;
    if path.is_empty() || Path::new(path).components().any(|part| !matches!(part, std::path::Component::Normal(_))) { return Err(invalid("Git listed an invalid relative path")); }
    // A final symlink is hashed as a link. Never follow a symlink in its parents.
    let candidate = root.join(path);
    let parent = candidate.parent().ok_or_else(|| invalid("Git path has no parent"))?;
    let resolved = crate::workspace_guard::canonicalize_target(root, parent).map_err(invalid)?;
    if resolved != parent { return Err(invalid("Git approval path traverses a symbolic directory")); }
    Ok(candidate)
}

pub(crate) async fn fingerprint(path: &str) -> Result<String, CoreError> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let root = read(path, &["rev-parse", "--show-toplevel"], deadline).await?;
    let root = String::from_utf8(root).map_err(|_| invalid("Git root is not UTF-8"))?;
    let root = tokio::fs::canonicalize(root.trim_end_matches(['\r', '\n'])).await.map_err(|error| invalid(error.to_string()))?;
    let mut pending = std::collections::VecDeque::from([(root, 0)]);
    let mut seen = std::collections::HashSet::new(); let mut hash = Sha256::new();
    let mut untracked = Some(16 * 1024 * 1024_u64);
    while let Some((root, depth)) = pending.pop_front() {
        if depth > 8 || seen.len() >= 128 || !seen.insert(root.clone()) { return Err(invalid("Git approval nested repository limit or cycle")); }
        let path = root.to_str().ok_or_else(|| invalid("Git root is not UTF-8"))?;
        frame(&mut hash, path.as_bytes());
        for args in [
            vec!["for-each-ref", "--format=%(refname) %(objectname)"],
            vec!["config", "--null", "--list", "--show-origin"],
            vec!["diff", "--cached", "--raw", "--no-abbrev", "--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", "-z"],
        ] { frame(&mut hash, &read(path, &args, deadline).await?); }
        // HEAD includes unborn/detached/branch identity; administrative attributes
        // and sparse patterns are otherwise absent from a config --list result.
        for name in ["HEAD", "info/attributes", "info/exclude", "info/sparse-checkout"] {
            let location = read(path, &["rev-parse", "--path-format=absolute", "--git-path", name], deadline).await?;
            let location = String::from_utf8(location).map_err(|_| invalid("Git administrative path is not UTF-8"))?;
            frame(&mut hash, name.as_bytes());
            hash_entry(&mut hash, Path::new(location.trim_end_matches(['\r', '\n'])), deadline, &mut None).await?;
        }
        let index = read(path, &["ls-files", "--stage", "-v", "-z"], deadline).await?;
        frame(&mut hash, &index);
        for entry in index.split(|byte| *byte == 0).filter(|entry| !entry.is_empty()) {
            let tab = entry.iter().position(|byte| *byte == b'\t').ok_or_else(|| invalid("invalid Git index entry"))?;
            let file = relative_path(&root, &entry[tab + 1..])?;
            frame(&mut hash, &entry[tab + 1..]);
            let directory = hash_entry(&mut hash, &file, deadline, &mut None).await?;
            let gitlink = entry[..tab].split(|byte| *byte == b' ').nth(1) == Some(b"160000".as_slice());
            if gitlink && directory {
                let nested = read(file.to_str().ok_or_else(|| invalid("Git path is not UTF-8"))?, &["rev-parse", "--show-toplevel"], deadline).await?;
                let nested = String::from_utf8(nested).map_err(|_| invalid("Git root is not UTF-8"))?;
                let nested = tokio::fs::canonicalize(nested.trim_end_matches(['\r', '\n'])).await.map_err(|error| invalid(error.to_string()))?;
                if nested == file { pending.push_back((nested, depth + 1)); }
                else if tokio::fs::read_dir(&file).await.map_err(|error| invalid(error.to_string()))?.next_entry().await.map_err(|error| invalid(error.to_string()))?.is_some() {
                    return Err(invalid("uninitialized Git submodule is not empty"));
                }
            }
        }
        let files = read(path, &["ls-files", "--others", "--exclude-standard", "-z"], deadline).await?;
        frame(&mut hash, &files);
        for raw in files.split(|byte| *byte == 0).filter(|raw| !raw.is_empty()) {
            let file = relative_path(&root, raw)?;
            if hash_entry(&mut hash, &file, deadline, &mut untracked).await? {
                return Err(invalid("untracked nested repository requires explicit registration"));
            }
        }
    }
    Ok(format!("sha256:{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn git(root: &Path, args: &[&str]) -> Vec<u8> {
        let output = std::process::Command::new("git").arg("-C").arg(root).args(args).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr)); output.stdout
    }
    fn fixture() -> (std::path::PathBuf, std::path::PathBuf) {
        let directory = std::env::temp_dir().join(format!("aibo-read-policy-{}", ulid::Ulid::new()));
        let root = directory.join("repo"); std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-q"]); git(&root, &["config", "user.name", "Fixture"]); git(&root, &["config", "user.email", "fixture@example.invalid"]);
        git(&root, &["config", "commit.gpgsign", "false"]); git(&root, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(root.join("file"), "before\n").unwrap(); git(&root, &["add", "--", "file"]);
        git(&root, &["commit", "-qm", "Baseline\n\nCo-authored-by: Codex <codex@openai.com>"]);
        (directory, root)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn preflight_never_runs_fsmonitor_filters_or_diff_drivers_but_approved_git_can() {
        let (directory, root) = fixture();
        let clean = directory.join("clean.sh"); let monitor = directory.join("monitor.sh");
        std::fs::write(&clean, "touch ../clean-ran\ncat\n").unwrap();
        std::fs::write(&monitor, "touch ../monitor-ran\nprintf 'token\\0/\\0'\n").unwrap();
        let shell = |path: &Path| format!("/bin/sh '{}'", path.to_str().unwrap().replace('\'', "'\\''"));
        git(&root, &["config", "filter.proof.clean", &shell(&clean)]); git(&root, &["config", "filter.proof.required", "true"]);
        git(&root, &["config", "core.fsmonitor", &shell(&monitor)]);
        git(&root, &["config", "diff.proof.command", &shell(&clean)]); git(&root, &["config", "diff.proof.textconv", &shell(&clean)]);
        std::fs::write(root.join(".git/info/attributes"), "file filter=proof diff=proof\n").unwrap();
        std::fs::write(root.join("file"), "after!\n").unwrap();
        // Positive controls demonstrate that these configured programs are executable.
        git(&root, &["status", "--porcelain=v2"]); assert!(directory.join("monitor-ran").exists());
        git(&root, &["-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-textconv", "--binary"]);
        assert!(directory.join("clean-ran").exists());
        std::fs::remove_file(directory.join("monitor-ran")).unwrap(); std::fs::remove_file(directory.join("clean-ran")).unwrap();
        fingerprint(root.to_str().unwrap()).await.unwrap();
        assert!(!directory.join("monitor-ran").exists()); assert!(!directory.join("clean-ran").exists());
        let process = directory.join("process.sh"); std::fs::write(&process, "touch ../process-ran\nexit 1\n").unwrap();
        git(&root, &["config", "filter.proof.process", &shell(&process)]);
        let unsafe_diff = std::process::Command::new("git").arg("-C").arg(&root).args(["-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-textconv"]).output().unwrap();
        assert!(!unsafe_diff.status.success()); assert!(directory.join("process-ran").exists());
        std::fs::remove_file(directory.join("process-ran")).unwrap();
        fingerprint(root.to_str().unwrap()).await.unwrap(); assert!(!directory.join("process-ran").exists());
        git(&root, &["config", "--unset", "filter.proof.process"]);
        let db = crate::open_database(&directory.join("host.db")).await.unwrap(); let now = crate::now_iso();
        sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Preflight',1,?,?)").bind(root.to_str().unwrap()).bind(&now).bind(&now).execute(&db).await.unwrap();
        for accept in [false, true] {
            let markers = directory.clone();
            let request = crate::workspace_write_runs::Request::with_confirmation(format!("request-{accept}"), "main".into(), move |_| {
                let markers = markers.clone(); async move {
                    assert!(!markers.join("monitor-ran").exists()); assert!(!markers.join("clean-ran").exists()); Ok(accept)
                }
            });
            let result = crate::workspace_git::apply_workspace_git_file_action_requested(&db, "workspace".into(), "file".into(), "stage".into(), &request).await;
            if accept { assert!(result.unwrap().applied); assert!(directory.join("clean-ran").exists()); assert_eq!(git(&root, &["show", ":file"]), b"after!\n"); }
            else { assert_eq!(serde_json::to_value(result.unwrap_err()).unwrap()["code"], "approval_rejected"); assert!(!directory.join("monitor-ran").exists()); assert!(!directory.join("clean-ran").exists()); }
        }
        db.close().await; std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn raw_worktree_hash_detects_hidden_edits_and_intent_to_add() {
        let (directory, root) = fixture(); let path = root.to_str().unwrap();
        for flag in ["--assume-unchanged", "--skip-worktree"] {
            git(&root, &["update-index", flag, "file"]);
            let before = fingerprint(path).await.unwrap();
            std::fs::write(root.join("file"), if flag == "--assume-unchanged" { "change1" } else { "change2" }).unwrap();
            assert_ne!(fingerprint(path).await.unwrap(), before);
            git(&root, &["update-index", "--no-assume-unchanged", "--no-skip-worktree", "file"]);
        }
        std::fs::write(root.join("empty"), "").unwrap(); git(&root, &["add", "-N", "--", "empty"]);
        let intent = fingerprint(path).await.unwrap(); git(&root, &["add", "--", "empty"]);
        assert_ne!(fingerprint(path).await.unwrap(), intent);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn tracked_contents_are_streamed_beyond_the_untracked_budget() {
        use std::io::{Seek, SeekFrom, Write};
        let (directory, root) = fixture(); let path = root.to_str().unwrap();
        let file = root.join("large"); std::fs::File::create(&file).unwrap().set_len(20 * 1024 * 1024).unwrap();
        git(&root, &["add", "--", "large"]);
        let before = fingerprint(path).await.unwrap();
        let mut output = std::fs::OpenOptions::new().write(true).open(file).unwrap();
        output.seek(SeekFrom::End(-1)).unwrap(); output.write_all(b"x").unwrap(); drop(output);
        assert_ne!(fingerprint(path).await.unwrap(), before); std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn nested_worktree_contents_are_fingerprinted_without_status_commands() {
        let (directory, root) = fixture(); let (_, source) = fixture();
        git(&root, &["-c", "protocol.file.allow=always", "submodule", "add", "-q", source.to_str().unwrap(), "nested"]);
        git(&root, &["commit", "-qm", "Nested fixture\n\nCo-authored-by: Codex <codex@openai.com>"]);
        let path = root.to_str().unwrap(); let before = fingerprint(path).await.unwrap();
        std::fs::write(root.join("nested/file"), "first dirty content").unwrap(); let dirty = fingerprint(path).await.unwrap(); assert_ne!(dirty, before);
        std::fs::write(root.join("nested/file"), "other dirty content").unwrap(); assert_ne!(fingerprint(path).await.unwrap(), dirty);
        std::fs::remove_dir_all(source.parent().unwrap()).unwrap(); std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn baseline_read_policy_does_not_lazy_fetch_missing_promisor_objects() {
        let (directory, root) = fixture(); let remote = directory.join("remote");
        let result = std::process::Command::new("git").args(["init", "--bare", "-q"]).arg(&remote).status().unwrap(); assert!(result.success());
        let helper = directory.join("upload.sh"); std::fs::write(&helper, "touch ../fetch-ran\nexit 1\n").unwrap();
        git(&root, &["config", "remote.origin.url", remote.to_str().unwrap()]); git(&root, &["config", "remote.origin.promisor", "true"]);
        git(&root, &["config", "remote.origin.uploadpack", &format!("/bin/sh '{}'", helper.to_str().unwrap().replace('\'', "'\\''"))]);
        let missing = "0123456789012345678901234567890123456789";
        let mut unsafe_command = Command::new("git"); unsafe_command.arg("-C").arg(&root).args(["cat-file", "-e", missing]);
        let output = crate::controlled_process::execute(unsafe_command, Duration::from_secs(3), 4096).await.unwrap(); assert!(!output.success);
        // Upload-pack runs with the remote repository as its working directory.
        assert!(directory.join("fetch-ran").exists()); std::fs::remove_file(directory.join("fetch-ran")).unwrap();
        let output = crate::controlled_process::execute(read_command(root.to_str().unwrap(), &["cat-file", "-e", missing]), Duration::from_secs(3), 4096).await.unwrap();
        assert!(!output.success && !output.timed_out); assert!(!directory.join("fetch-ran").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }
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
