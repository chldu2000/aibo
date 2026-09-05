//! Turn-scoped workspace snapshots and durable change-set persistence.

use crate::workspace_guard::canonicalize_target;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tokio::task;
use ulid::Ulid;

pub(crate) const CHANGE_SET_SCHEMA: &str = "aibo.turn-changeset/v1";
pub(crate) const CHECKPOINT_SCHEMA: &str = "aibo.checkpoint/v1";
const MAX_SCANNED_FILES: usize = 5_000;
const MAX_HASH_BYTES: u64 = 10 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct FileState {
    pub(crate) path: String,
    pub(crate) exists: bool,
    pub(crate) hash: Option<String>,
    pub(crate) size: Option<u64>,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkspaceSnapshot {
    pub(crate) head: Option<String>,
    pub(crate) dirty: bool,
    pub(crate) captured_at: String,
    pub(crate) files: Vec<FileState>,
    pub(crate) dirty_paths: BTreeSet<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct FileChange {
    pub(crate) path: String,
    pub(crate) kind: &'static str,
    /// Original relative path when the agent moved a file.
    pub(crate) previous_path: Option<String>,
    pub(crate) baseline: Option<FileState>,
    pub(crate) result: Option<FileState>,
    pub(crate) baseline_dirty: bool,
}

#[derive(Debug, Default)]
pub(crate) struct RestoreReport {
    pub(crate) applied: bool,
    pub(crate) restored: Vec<String>,
    pub(crate) conflicts: Vec<String>,
    pub(crate) unsupported: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkspaceFileChange {
    pub(crate) path: String,
    pub(crate) kind: &'static str,
    pub(crate) previous_path: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkspaceChanges {
    pub(crate) head: Option<String>,
    pub(crate) dirty: bool,
    pub(crate) captured_at: String,
    pub(crate) files: Vec<WorkspaceFileChange>,
    pub(crate) capture_status: &'static str,
    pub(crate) capture_error: Option<String>,
}

/// Capture a Git-backed status snapshot, falling back to a bounded filesystem
/// walk for non-Git workspaces. The blocking walk and hashing happen off the
/// async runtime so large workspaces do not stall event processing.
pub(crate) async fn capture(root: &Path) -> Result<WorkspaceSnapshot, String> {
    let root = root.to_path_buf();
    task::spawn_blocking(move || capture_sync(&root))
        .await
        .map_err(|error| format!("workspace snapshot task failed: {error}"))?
}

fn checkpoint_scope(root: &Path, session_id: &str, turn_id: &str) -> PathBuf {
    let mut digest = Sha256::new();
    digest.update(session_id.as_bytes());
    digest.update([0]);
    digest.update(turn_id.as_bytes());
    root.join(format!("{:x}", digest.finalize()))
}

pub(crate) fn checkpoint_file_path(
    root: &Path,
    session_id: &str,
    turn_id: &str,
    relative_path: &str,
) -> PathBuf {
    let mut digest = Sha256::new();
    digest.update(relative_path.as_bytes());
    checkpoint_scope(root, session_id, turn_id).join(format!("{:x}.bin", digest.finalize()))
}

pub(crate) async fn persist_baseline_checkpoint(
    checkpoint_root: &Path,
    session_id: &str,
    turn_id: &str,
    workspace_root: &Path,
    snapshot: &WorkspaceSnapshot,
) -> Result<(), String> {
    let checkpoint_root = checkpoint_root.to_path_buf();
    let session_id = session_id.to_owned();
    let turn_id = turn_id.to_owned();
    let workspace_root = workspace_root.to_path_buf();
    let snapshot = snapshot.clone();
    task::spawn_blocking(move || {
        let mut stored_bytes = 0_u64;
        let checkpoint_dir = checkpoint_scope(&checkpoint_root, &session_id, &turn_id);
        fs::create_dir_all(&checkpoint_dir)
            .map_err(|error| format!("create checkpoint directory: {error}"))?;
        for file in &snapshot.files {
            if !file.exists || file.hash.is_none() || file.size.unwrap_or(u64::MAX) > MAX_HASH_BYTES
            {
                continue;
            }
            let size = file.size.unwrap_or(0);
            if stored_bytes.saturating_add(size) > MAX_CHECKPOINT_BYTES {
                break;
            }
            let resolved = canonicalize_target(&workspace_root, Path::new(&file.path))
                .map_err(|error| format!("unsafe checkpoint path {}: {error}", file.path))?;
            let bytes = fs::read(&resolved)
                .map_err(|error| format!("read checkpoint file {}: {error}", file.path))?;
            let target = checkpoint_file_path(&checkpoint_root, &session_id, &turn_id, &file.path);
            fs::write(target, bytes)
                .map_err(|error| format!("write checkpoint file {}: {error}", file.path))?;
            stored_bytes = stored_bytes.saturating_add(size);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("checkpoint task failed: {error}"))?
}

/// Persist one durable row per baseline file after its checkpoint bytes have
/// been written. Rows for files that cannot be safely copied (large/binary or
/// unreadable files) are retained with a null storage path so later recovery
/// and a future review surface can explain why restoration is unavailable.
pub(crate) async fn persist_checkpoint_metadata(
    db: &SqlitePool,
    checkpoint_root: &Path,
    workspace_id: &str,
    session_id: &str,
    turn_id: &str,
    snapshot: &WorkspaceSnapshot,
) -> Result<(), sqlx::Error> {
    let app_data_root = checkpoint_root.parent().unwrap_or(checkpoint_root);
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM checkpoints WHERE session_id = ? AND turn_id = ?")
        .bind(session_id)
        .bind(turn_id)
        .execute(&mut *tx)
        .await?;
    for file in &snapshot.files {
        let checkpoint_path =
            checkpoint_file_path(checkpoint_root, session_id, turn_id, &file.path);
        let storage_path = if file.exists
            && file.hash.is_some()
            && file.size.unwrap_or(u64::MAX) <= MAX_HASH_BYTES
            && checkpoint_path.is_file()
        {
            checkpoint_path
                .strip_prefix(app_data_root)
                .ok()
                .map(|path| path.to_string_lossy().replace('\\', "/"))
        } else {
            None
        };
        sqlx::query(
            "INSERT INTO checkpoints
             (id, schema_version, workspace_id, session_id, turn_id, path,
              file_exists, content_hash, size, storage_path, baseline_head,
              baseline_dirty, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Ulid::new().to_string())
        .bind(CHECKPOINT_SCHEMA)
        .bind(workspace_id)
        .bind(session_id)
        .bind(turn_id)
        .bind(&file.path)
        .bind(i64::from(file.exists))
        .bind(file.hash.as_deref())
        .bind(file.size.map(|size| size as i64))
        .bind(storage_path)
        .bind(snapshot.head.as_deref())
        .bind(i64::from(snapshot.dirty_paths.contains(&file.path)))
        .bind(crate::now_iso())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

fn capture_sync(root: &Path) -> Result<WorkspaceSnapshot, String> {
    let root =
        fs::canonicalize(root).map_err(|error| format!("canonicalize workspace: {error}"))?;
    if let Some(snapshot) = capture_git(&root)? {
        return Ok(snapshot);
    }
    let mut files = Vec::new();
    walk_files(&root, &root, &mut files)?;
    Ok(WorkspaceSnapshot {
        head: None,
        dirty: false,
        captured_at: crate::now_iso(),
        files,
        dirty_paths: BTreeSet::new(),
    })
}

fn capture_git(root: &Path) -> Result<Option<WorkspaceSnapshot>, String> {
    let probe = Command::new("git")
        .args([
            "-C",
            &root.to_string_lossy(),
            "rev-parse",
            "--is-inside-work-tree",
        ])
        .output();
    let Ok(probe) = probe else {
        return Ok(None);
    };
    if !probe.status.success() || String::from_utf8_lossy(&probe.stdout).trim() != "true" {
        return Ok(None);
    }

    let head = Command::new("git")
        .args(["-C", &root.to_string_lossy(), "rev-parse", "HEAD"])
        .output()
        .map_err(|error| format!("read Git HEAD: {error}"))?;
    let head = head
        .status
        .success()
        .then(|| String::from_utf8_lossy(&head.stdout).trim().to_owned());
    let status = Command::new("git")
        .args([
            "-C",
            &root.to_string_lossy(),
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain=v1",
            "-z",
        ])
        .output()
        .map_err(|error| format!("read Git status: {error}"))?;
    if !status.status.success() {
        return Err(format!("git status exited with {}", status.status));
    }
    let dirty = status.stdout.iter().any(|byte| *byte != 0);
    let tracked = Command::new("git")
        .args(["-C", &root.to_string_lossy(), "ls-files", "-z"])
        .output()
        .map_err(|error| format!("read tracked Git files: {error}"))?;
    let mut paths = BTreeMap::<String, ()>::new();
    for path in tracked
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
    {
        paths.insert(String::from_utf8_lossy(path).to_string(), ());
    }
    let mut dirty_paths = BTreeSet::new();
    let mut records = status
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let code = String::from_utf8_lossy(&record[..2]);
        let mut path = String::from_utf8_lossy(&record[3..]).to_string();
        // Rename/copy records can contain an old path followed by a new path.
        // The final path is the one whose resulting content we need to hash.
        if code.contains('R') || code.contains('C') {
            if let Some(next) = records.next() {
                path = String::from_utf8_lossy(next).to_string();
            }
        }
        dirty_paths.insert(path.clone());
        paths.insert(path, ());
    }
    let mut files = Vec::with_capacity(paths.len());
    for path in paths.into_keys() {
        let resolved = canonicalize_target(root, Path::new(&path))
            .map_err(|error| format!("unsafe Git path {path}: {error}"))?;
        files.push(file_state(root, &resolved, path));
    }
    Ok(Some(WorkspaceSnapshot {
        head,
        dirty,
        captured_at: crate::now_iso(),
        files,
        dirty_paths,
    }))
}

pub(crate) async fn workspace_changes(root: &Path) -> Result<WorkspaceChanges, String> {
    let root = root.to_path_buf();
    task::spawn_blocking(move || workspace_changes_sync(&root))
        .await
        .map_err(|error| format!("workspace changes task failed: {error}"))?
}

fn workspace_changes_sync(root: &Path) -> Result<WorkspaceChanges, String> {
    let root =
        fs::canonicalize(root).map_err(|error| format!("canonicalize workspace: {error}"))?;
    let probe = Command::new("git")
        .args([
            "-C",
            &root.to_string_lossy(),
            "rev-parse",
            "--is-inside-work-tree",
        ])
        .output();
    let Ok(probe) = probe else {
        return Ok(WorkspaceChanges {
            head: None,
            dirty: false,
            captured_at: crate::now_iso(),
            files: Vec::new(),
            capture_status: "unsupported",
            capture_error: Some("Git 不可用，非 Git 工作区暂不提供全局变更归属".to_owned()),
        });
    };
    if !probe.status.success() || String::from_utf8_lossy(&probe.stdout).trim() != "true" {
        return Ok(WorkspaceChanges {
            head: None,
            dirty: false,
            captured_at: crate::now_iso(),
            files: Vec::new(),
            capture_status: "unsupported",
            capture_error: Some("非 Git 工作区暂不提供全局变更归属；本轮变更仍可用".to_owned()),
        });
    }
    let head = Command::new("git")
        .args(["-C", &root.to_string_lossy(), "rev-parse", "HEAD"])
        .output()
        .map_err(|error| format!("read Git HEAD: {error}"))?;
    let head = head
        .status
        .success()
        .then(|| String::from_utf8_lossy(&head.stdout).trim().to_owned());
    let status = Command::new("git")
        .args([
            "-C",
            &root.to_string_lossy(),
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain=v1",
            "-z",
        ])
        .output()
        .map_err(|error| format!("read Git status: {error}"))?;
    if !status.status.success() {
        return Err(format!("git status exited with {}", status.status));
    }
    let mut files = Vec::new();
    let mut records = status
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let code = String::from_utf8_lossy(&record[..2]);
        let path = String::from_utf8_lossy(&record[3..]).to_string();
        let kind = if code.contains('R') || code.contains('C') {
            let source_path = path;
            let next = records
                .next()
                .map(|value| String::from_utf8_lossy(value).to_string());
            if let Some(path) = next {
                files.push(WorkspaceFileChange {
                    path,
                    kind: "renamed",
                    previous_path: Some(source_path),
                });
            } else {
                files.push(WorkspaceFileChange {
                    path: source_path,
                    kind: "modified",
                    previous_path: None,
                });
            }
            continue;
        } else if code.contains('A') || code == "??" {
            "added"
        } else if code.contains('D') {
            "deleted"
        } else {
            "modified"
        };
        files.push(WorkspaceFileChange {
            path,
            kind,
            previous_path: None,
        });
    }
    Ok(WorkspaceChanges {
        head,
        dirty: !files.is_empty(),
        captured_at: crate::now_iso(),
        files,
        capture_status: "captured",
        capture_error: None,
    })
}

fn walk_files(root: &Path, current: &Path, files: &mut Vec<FileState>) -> Result<(), String> {
    if files.len() >= MAX_SCANNED_FILES {
        return Ok(());
    }
    let entries = fs::read_dir(current).map_err(|error| format!("scan workspace: {error}"))?;
    for entry in entries {
        if files.len() >= MAX_SCANNED_FILES {
            break;
        }
        let entry = entry.map_err(|error| format!("read workspace entry: {error}"))?;
        let name = entry.file_name();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
            && is_ignored_directory(&name)
        {
            continue;
        }
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            walk_files(root, &path, files)?;
        } else if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let resolved = canonicalize_target(root, &path)
                .map_err(|error| format!("unsafe workspace path {relative}: {error}"))?;
            files.push(file_state(root, &resolved, relative));
        }
    }
    Ok(())
}

fn is_ignored_directory(name: &std::ffi::OsStr) -> bool {
    matches!(
        name.to_str(),
        Some(".git") | Some("node_modules") | Some("target") | Some("dist") | Some("build")
    )
}

fn file_state(root: &Path, resolved: &Path, path: String) -> FileState {
    let metadata = fs::metadata(resolved).ok();
    let size = metadata.as_ref().map(|value| value.len());
    let hash = size
        .filter(|value| *value <= MAX_HASH_BYTES)
        .and_then(|_| fs::read(resolved).ok())
        .map(|bytes| {
            let mut digest = Sha256::new();
            digest.update(bytes);
            format!("sha256:{:x}", digest.finalize())
        });
    FileState {
        path: path_from_root(root, resolved, path),
        exists: metadata.is_some(),
        hash,
        size,
    }
}

pub(crate) fn current_file_state(root: &Path, path: &str) -> Result<FileState, String> {
    let root =
        fs::canonicalize(root).map_err(|error| format!("canonicalize workspace: {error}"))?;
    let resolved = canonicalize_target(&root, Path::new(path))
        .map_err(|error| format!("unsafe change-set path {path}: {error}"))?;
    Ok(file_state(&root, &resolved, path.to_owned()))
}

fn path_from_root(root: &Path, resolved: &Path, fallback: String) -> String {
    resolved
        .strip_prefix(root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or(fallback)
}

pub(crate) fn diff(
    baseline: Option<&WorkspaceSnapshot>,
    result: Option<&WorkspaceSnapshot>,
) -> Vec<FileChange> {
    let baseline_dirty_paths = baseline
        .map(|snapshot| snapshot.dirty_paths.clone())
        .unwrap_or_default();
    let mut paths = BTreeMap::<String, (Option<FileState>, Option<FileState>)>::new();
    if let Some(snapshot) = baseline {
        for file in &snapshot.files {
            paths.entry(file.path.clone()).or_default().0 = Some(file.clone());
        }
    }
    if let Some(snapshot) = result {
        for file in &snapshot.files {
            paths.entry(file.path.clone()).or_default().1 = Some(file.clone());
        }
    }
    let mut changes: Vec<FileChange> = paths
        .into_iter()
        .filter_map(|(path, (baseline, result))| {
            let same = baseline
                .as_ref()
                .map(|file| (&file.exists, &file.hash, &file.size))
                == result
                    .as_ref()
                    .map(|file| (&file.exists, &file.hash, &file.size));
            if same {
                return None;
            }
            let kind = match (
                baseline.as_ref().map(|file| file.exists),
                result.as_ref().map(|file| file.exists),
            ) {
                (None | Some(false), Some(true)) => "added",
                (Some(true), None | Some(false)) => "deleted",
                _ => "modified",
            };
            let baseline_dirty = baseline_dirty_paths.contains(&path);
            Some(FileChange {
                path,
                kind,
                previous_path: None,
                baseline,
                result,
                baseline_dirty,
            })
        })
        .collect();

    // Git may report a rename, but a filesystem snapshot only exposes the
    // deleted source and added destination. Pair exact content matches so the
    // durable turn contract keeps the source path and restore can move the
    // file back safely. Hashes are required to avoid guessing across similar
    // files; each entry is paired at most once.
    let mut consumed_deleted = BTreeSet::new();
    for add_index in 0..changes.len() {
        if changes[add_index].kind != "added" {
            continue;
        }
        let Some(result) = changes[add_index].result.as_ref() else {
            continue;
        };
        let Some(result_hash) = result.hash.as_deref() else {
            continue;
        };
        let Some(delete_index) = changes.iter().enumerate().find_map(|(index, candidate)| {
            if index == add_index
                || candidate.kind != "deleted"
                || consumed_deleted.contains(&index)
            {
                return None;
            }
            let baseline = candidate.baseline.as_ref()?;
            (baseline.hash.as_deref() == Some(result_hash)
                && baseline.size == result.size
                && baseline.exists)
                .then_some(index)
        }) else {
            continue;
        };
        let source = changes[delete_index].path.clone();
        changes[add_index].kind = "renamed";
        changes[add_index].previous_path = Some(source);
        // Preserve the source baseline and its attribution on the destination
        // row; the result remains the destination file state.
        changes[add_index].baseline = changes[delete_index].baseline.clone();
        changes[add_index].baseline_dirty = changes[delete_index].baseline_dirty;
        consumed_deleted.insert(delete_index);
    }
    changes
        .into_iter()
        .enumerate()
        .filter_map(|(index, change)| (!consumed_deleted.contains(&index)).then_some(change))
        .collect()
}

pub(crate) async fn persist(
    db: &SqlitePool,
    workspace_id: &str,
    session_id: &str,
    turn_id: &str,
    baseline: Option<&WorkspaceSnapshot>,
    result: Option<&WorkspaceSnapshot>,
    capture_error: Option<&str>,
) -> Result<String, sqlx::Error> {
    let id = Ulid::new().to_string();
    let now = crate::now_iso();
    let files = diff(baseline, result);
    let attribution = if baseline.is_none() || result.is_none() {
        "unknown"
    } else if files.iter().any(|file| file.baseline_dirty) {
        "mixed"
    } else {
        "agent"
    };
    let capture_status = match (baseline.is_some(), result.is_some()) {
        (true, true) => "captured",
        (false, false) => "failed",
        _ => "partial",
    };
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO turn_change_sets
         (id, workspace_id, session_id, turn_id, schema_version,
          baseline_head, baseline_dirty, baseline_captured_at,
          result_head, result_dirty, result_captured_at, attribution,
          capture_status, capture_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, turn_id) DO UPDATE SET
           result_head = excluded.result_head,
           result_dirty = excluded.result_dirty,
           result_captured_at = excluded.result_captured_at,
           attribution = excluded.attribution,
           capture_status = excluded.capture_status,
           capture_error = excluded.capture_error,
           updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(workspace_id)
    .bind(session_id)
    .bind(turn_id)
    .bind(CHANGE_SET_SCHEMA)
    .bind(baseline.and_then(|snapshot| snapshot.head.as_deref()))
    .bind(baseline.map(|snapshot| i64::from(snapshot.dirty)))
    .bind(baseline.map(|snapshot| snapshot.captured_at.as_str()))
    .bind(result.and_then(|snapshot| snapshot.head.as_deref()))
    .bind(result.map(|snapshot| i64::from(snapshot.dirty)))
    .bind(result.map(|snapshot| snapshot.captured_at.as_str()))
    .bind(attribution)
    .bind(capture_status)
    .bind(capture_error)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    let change_set_id: String =
        sqlx::query_scalar("SELECT id FROM turn_change_sets WHERE session_id = ? AND turn_id = ?")
            .bind(session_id)
            .bind(turn_id)
            .fetch_one(&mut *tx)
            .await?;
    sqlx::query("DELETE FROM file_changes WHERE change_set_id = ?")
        .bind(&change_set_id)
        .execute(&mut *tx)
        .await?;
    for file in files {
        sqlx::query(
            "INSERT INTO file_changes
             (id, change_set_id, path, previous_path, change_kind,
              baseline_exists, baseline_hash, baseline_size,
              result_exists, result_hash, result_size, baseline_dirty, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Ulid::new().to_string())
        .bind(&change_set_id)
        .bind(file.path)
        .bind(file.previous_path)
        .bind(file.kind)
        .bind(i64::from(
            file.baseline.as_ref().is_some_and(|value| value.exists),
        ))
        .bind(
            file.baseline
                .as_ref()
                .and_then(|value| value.hash.as_deref()),
        )
        .bind(
            file.baseline
                .as_ref()
                .and_then(|value| value.size.map(|size| size as i64)),
        )
        .bind(i64::from(
            file.result.as_ref().is_some_and(|value| value.exists),
        ))
        .bind(file.result.as_ref().and_then(|value| value.hash.as_deref()))
        .bind(
            file.result
                .as_ref()
                .and_then(|value| value.size.map(|size| size as i64)),
        )
        .bind(i64::from(file.baseline_dirty))
        .bind(&now)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(change_set_id)
}

/// Restore a turn's file changes after a complete, non-destructive preflight.
/// We intentionally refuse files that were already dirty at baseline,
/// unknown/large hashes, and any current file whose content changed after the
/// turn. Unrelated baseline edits do not block safe Agent-owned files.
pub(crate) async fn restore(
    db: &SqlitePool,
    checkpoint_root: &Path,
    workspace_root: &Path,
    session_id: &str,
    turn_id: &str,
) -> Result<RestoreReport, String> {
    let row = sqlx::query(
        "SELECT baseline_head, baseline_dirty, attribution FROM turn_change_sets
         WHERE session_id = ? AND turn_id = ?",
    )
    .bind(session_id)
    .bind(turn_id)
    .fetch_optional(db)
    .await
    .map_err(|error| format!("read change set: {error}"))?;
    let Some(row) = row else {
        return Err("turn change set not found".to_owned());
    };
    let baseline_head: Option<String> = sqlx::Row::try_get(&row, "baseline_head")
        .map_err(|error| format!("read baseline head: {error}"))?;
    let attribution: String = sqlx::Row::try_get(&row, "attribution")
        .map_err(|error| format!("read change set attribution: {error}"))?;
    if attribution == "unknown" {
        return Ok(RestoreReport {
            unsupported: vec!["本轮变更归属未知，禁止恢复".to_owned()],
            ..RestoreReport::default()
        });
    }
    let files = sqlx::query(
        "SELECT path, previous_path, change_kind, baseline_exists, baseline_hash,
                result_exists, result_hash, baseline_dirty
         FROM file_changes WHERE change_set_id = (
           SELECT id FROM turn_change_sets WHERE session_id = ? AND turn_id = ?
         ) ORDER BY path ASC",
    )
    .bind(session_id)
    .bind(turn_id)
    .fetch_all(db)
    .await
    .map_err(|error| format!("read changed files: {error}"))?;

    let mut report = RestoreReport::default();
    if files.is_empty() {
        report.applied = true;
        return Ok(report);
    }
    let root = fs::canonicalize(workspace_root)
        .map_err(|error| format!("canonicalize workspace: {error}"))?;
    struct RestoreAction {
        path: String,
        previous_path: Option<String>,
        baseline_exists: bool,
        result_exists: bool,
        target: std::path::PathBuf,
        source_target: Option<std::path::PathBuf>,
        baseline_bytes: Option<Vec<u8>>,
        backup: Option<Vec<u8>>,
        source_backup: Option<Vec<u8>>,
    }
    let mut actions = Vec::with_capacity(files.len());
    for row in &files {
        let path: String = sqlx::Row::try_get(row, "path")
            .map_err(|error| format!("read changed path: {error}"))?;
        let previous_path: Option<String> = sqlx::Row::try_get(row, "previous_path")
            .map_err(|error| format!("read previous changed path: {error}"))?;
        let change_kind: String = sqlx::Row::try_get(row, "change_kind")
            .map_err(|error| format!("read change kind: {error}"))?;
        let baseline_exists: bool = sqlx::Row::try_get::<i64, _>(row, "baseline_exists")
            .map_err(|error| format!("read baseline existence: {error}"))?
            != 0;
        let baseline_hash: Option<String> = sqlx::Row::try_get(row, "baseline_hash")
            .map_err(|error| format!("read baseline hash: {error}"))?;
        let result_exists: bool = sqlx::Row::try_get::<i64, _>(row, "result_exists")
            .map_err(|error| format!("read result existence: {error}"))?
            != 0;
        let result_hash: Option<String> = sqlx::Row::try_get(row, "result_hash")
            .map_err(|error| format!("read result hash: {error}"))?;
        let baseline_dirty: bool = sqlx::Row::try_get::<i64, _>(row, "baseline_dirty")
            .map_err(|error| format!("read baseline attribution: {error}"))?
            != 0;
        if result_exists && result_hash.is_none() {
            report
                .unsupported
                .push(format!("{path}（文件过大或无法哈希）"));
            continue;
        }
        let current = current_file_state(&root, &path)?;
        let current_matches_result = current.exists == result_exists
            && (!result_exists || current.hash.as_deref() == result_hash.as_deref());
        if !current_matches_result {
            report.conflicts.push(path.clone());
            continue;
        }
        if baseline_exists && (baseline_dirty || baseline_hash.is_none()) {
            report
                .unsupported
                .push(format!("{path}（baseline 不可安全恢复）"));
            continue;
        }
        let target = canonicalize_target(&root, Path::new(&path))
            .map_err(|error| format!("unsafe restore path {path}: {error}"))?;
        let source_target = if change_kind == "renamed" {
            let source = previous_path
                .as_deref()
                .ok_or_else(|| format!("重命名变更 {path} 缺少源路径，禁止恢复"))?;
            let source_target = canonicalize_target(&root, Path::new(source))
                .map_err(|error| format!("unsafe restore source path {source}: {error}"))?;
            if source_target == target {
                return Err(format!("重命名源路径与目标路径相同: {path}"));
            }
            if source_target.exists() {
                report
                    .conflicts
                    .push(format!("{source}（重命名源路径已存在）"));
                continue;
            }
            Some(source_target)
        } else {
            None
        };
        let backup = if result_exists {
            Some(fs::read(&target).map_err(|error| format!("read current file {path}: {error}"))?)
        } else {
            None
        };
        let baseline_bytes = if baseline_exists {
            let baseline_path = previous_path.as_deref().unwrap_or(&path);
            let checkpoint =
                checkpoint_file_path(checkpoint_root, session_id, turn_id, baseline_path);
            if checkpoint.is_file() {
                Some(
                    tokio::fs::read(&checkpoint)
                        .await
                        .map_err(|error| format!("read checkpoint {baseline_path}: {error}"))?,
                )
            } else if let Some(head) = baseline_head.as_deref() {
                let output = Command::new("git")
                    .args([
                        "-C",
                        &root.to_string_lossy(),
                        "show",
                        &format!("{head}:{baseline_path}"),
                    ])
                    .output()
                    .map_err(|error| format!("read Git baseline {baseline_path}: {error}"))?;
                if !output.status.success() {
                    return Err(format!("Git baseline is unavailable for {baseline_path}"));
                }
                Some(output.stdout)
            } else {
                return Err(format!("checkpoint is unavailable for {path}"));
            }
        } else {
            None
        };
        actions.push(RestoreAction {
            path,
            previous_path,
            baseline_exists,
            result_exists,
            target,
            source_target,
            baseline_bytes,
            backup,
            source_backup: None,
        });
    }
    if !report.conflicts.is_empty() || !report.unsupported.is_empty() {
        return Ok(report);
    }

    for (index, action) in actions.iter().enumerate() {
        let operation = async {
            if let Some(source_target) = action.source_target.as_ref() {
                let bytes = action
                    .baseline_bytes
                    .as_ref()
                    .ok_or_else(|| format!("missing baseline bytes for {}", action.path))?;
                if let Some(parent) = source_target.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|error| format!("create rename restore directory: {error}"))?;
                }
                tokio::fs::write(source_target, bytes)
                    .await
                    .map_err(|error| format!("restore renamed source {}: {error}", action.path))?;
                if let Err(error) = tokio::fs::remove_file(&action.target).await {
                    let _ = tokio::fs::remove_file(source_target).await;
                    return Err(format!(
                        "remove renamed destination {}: {error}",
                        action.path
                    ));
                }
            } else if !action.baseline_exists && action.result_exists {
                tokio::fs::remove_file(&action.target)
                    .await
                    .map_err(|error| format!("remove restored file {}: {error}", action.path))?;
            } else {
                let bytes = action
                    .baseline_bytes
                    .as_ref()
                    .ok_or_else(|| format!("missing baseline bytes for {}", action.path))?;
                if let Some(parent) = action.target.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|error| format!("create restore directory: {error}"))?;
                }
                tokio::fs::write(&action.target, bytes)
                    .await
                    .map_err(|error| format!("restore file {}: {error}", action.path))?;
            }
            Ok::<(), String>(())
        }
        .await;
        if let Err(error) = operation {
            if let Some(source_target) = action.source_target.as_ref() {
                let _ = match &action.source_backup {
                    Some(bytes) => tokio::fs::write(source_target, bytes).await,
                    None => tokio::fs::remove_file(source_target).await,
                };
            }
            for previous in actions[..index].iter() {
                match &previous.backup {
                    Some(bytes) => {
                        let _ = tokio::fs::write(&previous.target, bytes).await;
                    }
                    None => {
                        let _ = tokio::fs::remove_file(&previous.target).await;
                    }
                }
                if let Some(source_target) = previous.source_target.as_ref() {
                    match &previous.source_backup {
                        Some(bytes) => {
                            let _ = tokio::fs::write(source_target, bytes).await;
                        }
                        None => {
                            let _ = tokio::fs::remove_file(source_target).await;
                        }
                    }
                }
            }
            return Err(format!(
                "restore rolled back after {}: {error}",
                action.path
            ));
        }
        report.restored.push(
            action
                .previous_path
                .as_ref()
                .map(|source| format!("{source} → {}", action.path))
                .unwrap_or_else(|| action.path.clone()),
        );
    }
    report.applied = true;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::{diff, persist, FileState, WorkspaceSnapshot};
    use sqlx::{sqlite::SqlitePoolOptions, Row};
    use std::{collections::BTreeSet, fs, path::PathBuf, process::Command};

    fn tempdir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "aibo-change-set-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos(),
            super::Ulid::new()
        ));
        fs::create_dir_all(&path).expect("temp directory");
        path
    }

    fn snapshot(dirty: bool, files: Vec<FileState>) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            head: Some("head".to_owned()),
            dirty,
            captured_at: "now".to_owned(),
            files,
            dirty_paths: BTreeSet::new(),
        }
    }

    fn file(path: &str, exists: bool, hash: &str) -> FileState {
        FileState {
            path: path.to_owned(),
            exists,
            hash: Some(hash.to_owned()),
            size: Some(hash.len() as u64),
        }
    }

    #[test]
    fn diffs_added_modified_and_deleted_files() {
        let before = snapshot(
            true,
            vec![file("old.txt", true, "a"), file("changed.txt", true, "a")],
        );
        let after = snapshot(
            false,
            vec![file("changed.txt", true, "b"), file("new.txt", true, "c")],
        );
        let changes = diff(Some(&before), Some(&after));
        assert_eq!(changes.len(), 3);
        assert_eq!(
            changes
                .iter()
                .find(|item| item.path == "old.txt")
                .unwrap()
                .kind,
            "deleted"
        );
        assert_eq!(
            changes
                .iter()
                .find(|item| item.path == "new.txt")
                .unwrap()
                .kind,
            "added"
        );
        assert_eq!(
            changes
                .iter()
                .find(|item| item.path == "changed.txt")
                .unwrap()
                .kind,
            "modified"
        );
    }

    #[test]
    fn detects_renamed_files_by_matching_content_hash() {
        let before = snapshot(false, vec![file("docs/old.md", true, "same")]);
        let after = snapshot(false, vec![file("docs/new.md", true, "same")]);
        let changes = diff(Some(&before), Some(&after));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, "renamed");
        assert_eq!(changes[0].path, "docs/new.md");
        assert_eq!(changes[0].previous_path.as_deref(), Some("docs/old.md"));
        assert!(changes[0]
            .baseline
            .as_ref()
            .is_some_and(|file| file.path == "docs/old.md"));
    }

    #[test]
    fn git_snapshot_includes_clean_tracked_files_for_attribution() {
        let root = tempdir();
        fs::write(root.join("tracked.txt"), "before").expect("file");
        assert!(Command::new("git")
            .args(["-C", root.to_str().unwrap(), "init", "-q"])
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["-C", root.to_str().unwrap(), "add", "tracked.txt"])
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args([
                "-C",
                root.to_str().unwrap(),
                "-c",
                "user.name=Aibo",
                "-c",
                "user.email=aibo@example.invalid",
                "commit",
                "-qm",
                "initial",
            ])
            .status()
            .unwrap()
            .success());
        let before = tauri::async_runtime::block_on(super::capture(&root)).expect("baseline");
        assert!(!before.dirty);
        assert!(before
            .files
            .iter()
            .find(|file| file.path == "tracked.txt")
            .is_some_and(|file| file.hash.is_some()));
        fs::write(root.join("tracked.txt"), "after").expect("modify");
        let after = tauri::async_runtime::block_on(super::capture(&root)).expect("result");
        let changes = diff(Some(&before), Some(&after));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, "modified");
        let workspace_changes =
            tauri::async_runtime::block_on(super::workspace_changes(&root)).expect("status");
        assert_eq!(workspace_changes.capture_status, "captured");
        assert_eq!(workspace_changes.files[0].path, "tracked.txt");
        assert_eq!(workspace_changes.files[0].kind, "modified");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn persists_and_replaces_turn_change_set_rows() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("sqlite pool");
            sqlx::query("CREATE TABLE turn_change_sets (id TEXT PRIMARY KEY, workspace_id TEXT, session_id TEXT, turn_id TEXT, schema_version TEXT, baseline_head TEXT, baseline_dirty INTEGER, baseline_captured_at TEXT, result_head TEXT, result_dirty INTEGER, result_captured_at TEXT, attribution TEXT, capture_status TEXT, capture_error TEXT, created_at TEXT, updated_at TEXT, UNIQUE(session_id, turn_id))")
                .execute(&pool).await.expect("change set table");
            sqlx::query("CREATE TABLE file_changes (id TEXT PRIMARY KEY, change_set_id TEXT, path TEXT, previous_path TEXT, change_kind TEXT, baseline_exists INTEGER, baseline_hash TEXT, baseline_size INTEGER, baseline_dirty INTEGER DEFAULT 0, result_exists INTEGER, result_hash TEXT, result_size INTEGER, created_at TEXT)")
                .execute(&pool).await.expect("file changes table");

            let before = snapshot(false, vec![file("src/a.rs", true, "old")]);
            let after = snapshot(false, vec![file("src/a.rs", true, "new")]);
            persist(
                &pool,
                "workspace",
                "session",
                "turn",
                Some(&before),
                Some(&after),
                None,
            )
            .await
            .expect("persist change set");
            let file_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_changes")
                .fetch_one(&pool)
                .await
                .expect("count file changes");
            assert_eq!(file_count, 1);

            let changed = snapshot(false, vec![file("src/b.rs", true, "new")]);
            persist(
                &pool,
                "workspace",
                "session",
                "turn",
                Some(&before),
                Some(&changed),
                None,
            )
            .await
            .expect("replace change set");
            let row = sqlx::query("SELECT (SELECT COUNT(*) FROM turn_change_sets) AS set_count, (SELECT COUNT(*) FROM file_changes) AS file_count, (SELECT path FROM file_changes ORDER BY path LIMIT 1) AS path")
                .fetch_one(&pool).await.expect("read replaced change set");
            assert_eq!(row.get::<i64, _>("set_count"), 1);
            assert_eq!(row.get::<i64, _>("file_count"), 2);
            assert_eq!(row.get::<String, _>("path"), "src/a.rs");
        });
    }

    #[test]
    fn persists_restart_safe_checkpoint_metadata() {
        tauri::async_runtime::block_on(async {
            let root = tempdir();
            fs::write(root.join("notes.txt"), "baseline").expect("baseline file");
            let checkpoint_root = root.join("app-data").join("checkpoints");
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("sqlite pool");
            sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&pool)
                .await
                .expect("foreign keys");
            sqlx::query("CREATE TABLE workspaces (id TEXT PRIMARY KEY)")
                .execute(&pool)
                .await
                .expect("workspace table");
            sqlx::query("CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id))")
                .execute(&pool)
                .await
                .expect("session table");
            sqlx::query(
                "CREATE TABLE turns (id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id))",
            )
            .execute(&pool)
            .await
            .expect("turn table");
            sqlx::query("CREATE TABLE checkpoints (id TEXT PRIMARY KEY, schema_version TEXT, workspace_id TEXT, session_id TEXT, turn_id TEXT, path TEXT, file_exists INTEGER, content_hash TEXT, size INTEGER, storage_path TEXT, baseline_head TEXT, baseline_dirty INTEGER DEFAULT 0, created_at TEXT)")
                .execute(&pool).await.expect("checkpoint table");
            sqlx::query("INSERT INTO workspaces (id) VALUES ('workspace')")
                .execute(&pool)
                .await
                .expect("workspace row");
            sqlx::query("INSERT INTO sessions (id, workspace_id) VALUES ('session', 'workspace')")
                .execute(&pool)
                .await
                .expect("session row");
            sqlx::query("INSERT INTO turns (id, session_id) VALUES ('turn', 'session')")
                .execute(&pool)
                .await
                .expect("turn row");
            let snapshot = super::capture(&root).await.expect("snapshot");
            super::persist_baseline_checkpoint(
                &checkpoint_root,
                "session",
                "turn",
                &root,
                &snapshot,
            )
            .await
            .expect("checkpoint bytes");
            super::persist_checkpoint_metadata(
                &pool,
                &checkpoint_root,
                "workspace",
                "session",
                "turn",
                &snapshot,
            )
            .await
            .expect("checkpoint metadata");
            let row = sqlx::query("SELECT schema_version, path, file_exists, storage_path FROM checkpoints WHERE session_id = 'session' AND turn_id = 'turn'")
                .fetch_one(&pool).await.expect("checkpoint row");
            assert_eq!(row.get::<String, _>("schema_version"), "aibo.checkpoint/v1");
            assert_eq!(row.get::<String, _>("path"), "notes.txt");
            assert_eq!(row.get::<i64, _>("file_exists"), 1);
            assert!(row.get::<Option<String>, _>("storage_path").is_some());
            fs::remove_dir_all(root).expect("cleanup");
        });
    }

    #[test]
    fn attributes_only_files_dirty_before_the_turn_as_mixed() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("sqlite pool");
            sqlx::query("CREATE TABLE turn_change_sets (id TEXT PRIMARY KEY, workspace_id TEXT, session_id TEXT, turn_id TEXT, schema_version TEXT, baseline_head TEXT, baseline_dirty INTEGER, baseline_captured_at TEXT, result_head TEXT, result_dirty INTEGER, result_captured_at TEXT, attribution TEXT, capture_status TEXT, capture_error TEXT, created_at TEXT, updated_at TEXT, UNIQUE(session_id, turn_id))")
                .execute(&pool).await.expect("change set table");
            sqlx::query("CREATE TABLE file_changes (id TEXT PRIMARY KEY, change_set_id TEXT, path TEXT, previous_path TEXT, change_kind TEXT, baseline_exists INTEGER, baseline_hash TEXT, baseline_size INTEGER, baseline_dirty INTEGER DEFAULT 0, result_exists INTEGER, result_hash TEXT, result_size INTEGER, created_at TEXT)")
                .execute(&pool).await.expect("file changes table");

            let mut before = snapshot(
                true,
                vec![
                    file("user.txt", true, "user-old"),
                    file("agent.txt", true, "old"),
                ],
            );
            before.dirty_paths.insert("user.txt".to_owned());
            let after = snapshot(
                true,
                vec![
                    file("user.txt", true, "user-old"),
                    file("agent.txt", true, "new"),
                ],
            );
            persist(
                &pool,
                "workspace",
                "session",
                "turn",
                Some(&before),
                Some(&after),
                None,
            )
            .await
            .expect("persist change set");
            let attribution: String = sqlx::query_scalar(
                "SELECT attribution FROM turn_change_sets WHERE session_id = 'session' AND turn_id = 'turn'",
            )
            .fetch_one(&pool)
            .await
            .expect("read attribution");
            assert_eq!(attribution, "agent");
            let baseline_dirty: i64 = sqlx::query_scalar(
                "SELECT baseline_dirty FROM file_changes WHERE path = 'agent.txt'",
            )
            .fetch_one(&pool)
            .await
            .expect("read file attribution");
            assert_eq!(baseline_dirty, 0);
        });
    }

    #[test]
    fn restores_clean_git_turn_and_blocks_post_turn_conflict() {
        tauri::async_runtime::block_on(async {
            let root = tempdir();
            fs::write(root.join("tracked.txt"), "before").expect("file");
            assert!(Command::new("git")
                .args(["-C", root.to_str().unwrap(), "init", "-q"])
                .status()
                .unwrap()
                .success());
            assert!(Command::new("git")
                .args(["-C", root.to_str().unwrap(), "add", "tracked.txt"])
                .status()
                .unwrap()
                .success());
            assert!(Command::new("git")
                .args([
                    "-C",
                    root.to_str().unwrap(),
                    "-c",
                    "user.name=Aibo",
                    "-c",
                    "user.email=aibo@example.invalid",
                    "commit",
                    "-qm",
                    "initial",
                ])
                .status()
                .unwrap()
                .success());
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("sqlite pool");
            sqlx::query("CREATE TABLE turn_change_sets (id TEXT PRIMARY KEY, workspace_id TEXT, session_id TEXT, turn_id TEXT, schema_version TEXT, baseline_head TEXT, baseline_dirty INTEGER, baseline_captured_at TEXT, result_head TEXT, result_dirty INTEGER, result_captured_at TEXT, attribution TEXT, capture_status TEXT, capture_error TEXT, created_at TEXT, updated_at TEXT, UNIQUE(session_id, turn_id))")
                .execute(&pool).await.expect("change set table");
            sqlx::query("CREATE TABLE file_changes (id TEXT PRIMARY KEY, change_set_id TEXT, path TEXT, previous_path TEXT, change_kind TEXT, baseline_exists INTEGER, baseline_hash TEXT, baseline_size INTEGER, baseline_dirty INTEGER DEFAULT 0, result_exists INTEGER, result_hash TEXT, result_size INTEGER, created_at TEXT)")
                .execute(&pool).await.expect("file changes table");
            let baseline = super::capture(&root).await.expect("baseline");
            fs::write(root.join("tracked.txt"), "agent result").expect("agent change");
            let result = super::capture(&root).await.expect("result");
            persist(
                &pool,
                "workspace",
                "session",
                "turn",
                Some(&baseline),
                Some(&result),
                None,
            )
            .await
            .expect("persist");
            let checkpoint_root = root.join("checkpoint-data");
            let restored = super::restore(&pool, &checkpoint_root, &root, "session", "turn")
                .await
                .expect("restore");
            assert!(restored.applied);
            assert_eq!(
                fs::read_to_string(root.join("tracked.txt")).unwrap(),
                "before"
            );

            fs::write(root.join("tracked.txt"), "agent result").expect("agent change again");
            let result = super::capture(&root).await.expect("result again");
            persist(
                &pool,
                "workspace",
                "session",
                "turn",
                Some(&baseline),
                Some(&result),
                None,
            )
            .await
            .expect("persist again");
            fs::write(root.join("tracked.txt"), "user follow-up").expect("user change");
            let blocked = super::restore(&pool, &checkpoint_root, &root, "session", "turn")
                .await
                .expect("conflict report");
            assert!(!blocked.applied);
            assert_eq!(blocked.conflicts, vec!["tracked.txt"]);
            assert_eq!(
                fs::read_to_string(root.join("tracked.txt")).unwrap(),
                "user follow-up"
            );
            fs::remove_dir_all(root).expect("cleanup");
        });
    }

    #[test]
    fn restores_non_git_turn_from_app_data_checkpoint() {
        tauri::async_runtime::block_on(async {
            let root = tempdir();
            fs::write(root.join("notes.txt"), "before").expect("file");
            let checkpoint_root = root.join("app-data");
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("sqlite pool");
            sqlx::query("CREATE TABLE turn_change_sets (id TEXT PRIMARY KEY, workspace_id TEXT, session_id TEXT, turn_id TEXT, schema_version TEXT, baseline_head TEXT, baseline_dirty INTEGER, baseline_captured_at TEXT, result_head TEXT, result_dirty INTEGER, result_captured_at TEXT, attribution TEXT, capture_status TEXT, capture_error TEXT, created_at TEXT, updated_at TEXT, UNIQUE(session_id, turn_id))")
                .execute(&pool).await.expect("change set table");
            sqlx::query("CREATE TABLE file_changes (id TEXT PRIMARY KEY, change_set_id TEXT, path TEXT, previous_path TEXT, change_kind TEXT, baseline_exists INTEGER, baseline_hash TEXT, baseline_size INTEGER, baseline_dirty INTEGER DEFAULT 0, result_exists INTEGER, result_hash TEXT, result_size INTEGER, created_at TEXT)")
                .execute(&pool).await.expect("file changes table");
            let baseline = super::capture(&root).await.expect("baseline");
            assert!(baseline.head.is_none());
            super::persist_baseline_checkpoint(
                &checkpoint_root,
                "session",
                "turn",
                &root,
                &baseline,
            )
            .await
            .expect("checkpoint");
            fs::write(root.join("notes.txt"), "agent result").expect("agent change");
            let result = super::capture(&root).await.expect("result");
            persist(
                &pool,
                "workspace",
                "session",
                "turn",
                Some(&baseline),
                Some(&result),
                None,
            )
            .await
            .expect("persist");
            let restored = super::restore(&pool, &checkpoint_root, &root, "session", "turn")
                .await
                .expect("restore");
            assert!(restored.applied);
            assert_eq!(
                fs::read_to_string(root.join("notes.txt")).unwrap(),
                "before"
            );
            fs::remove_dir_all(root).expect("cleanup");
        });
    }

    #[test]
    fn restores_a_renamed_file_to_its_original_path() {
        tauri::async_runtime::block_on(async {
            let root = tempdir();
            fs::write(root.join("old.txt"), "before").expect("file");
            let checkpoint_root = tempdir();
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("sqlite pool");
            sqlx::query("CREATE TABLE turn_change_sets (id TEXT PRIMARY KEY, workspace_id TEXT, session_id TEXT, turn_id TEXT, schema_version TEXT, baseline_head TEXT, baseline_dirty INTEGER, baseline_captured_at TEXT, result_head TEXT, result_dirty INTEGER, result_captured_at TEXT, attribution TEXT, capture_status TEXT, capture_error TEXT, created_at TEXT, updated_at TEXT, UNIQUE(session_id, turn_id))")
                .execute(&pool)
                .await
                .expect("change set table");
            sqlx::query("CREATE TABLE file_changes (id TEXT PRIMARY KEY, change_set_id TEXT, path TEXT, previous_path TEXT, change_kind TEXT, baseline_exists INTEGER, baseline_hash TEXT, baseline_size INTEGER, baseline_dirty INTEGER DEFAULT 0, result_exists INTEGER, result_hash TEXT, result_size INTEGER, created_at TEXT)")
                .execute(&pool)
                .await
                .expect("file changes table");

            let baseline = super::capture(&root).await.expect("baseline");
            super::persist_baseline_checkpoint(
                &checkpoint_root,
                "session",
                "turn",
                &root,
                &baseline,
            )
            .await
            .expect("checkpoint");
            fs::rename(root.join("old.txt"), root.join("new.txt")).expect("rename");
            let result = super::capture(&root).await.expect("result");
            super::persist(
                &pool,
                "workspace",
                "session",
                "turn",
                Some(&baseline),
                Some(&result),
                None,
            )
            .await
            .expect("persist");

            let change = sqlx::query("SELECT change_kind, previous_path FROM file_changes")
                .fetch_one(&pool)
                .await
                .expect("read rename");
            assert_eq!(change.get::<String, _>("change_kind"), "renamed");
            assert_eq!(
                change.get::<Option<String>, _>("previous_path").as_deref(),
                Some("old.txt")
            );
            let restored = super::restore(&pool, &checkpoint_root, &root, "session", "turn")
                .await
                .expect("restore");
            assert!(restored.applied);
            assert_eq!(restored.restored, vec!["old.txt → new.txt"]);
            assert_eq!(fs::read_to_string(root.join("old.txt")).unwrap(), "before");
            assert!(!root.join("new.txt").exists());
            fs::remove_dir_all(root).expect("cleanup");
            fs::remove_dir_all(checkpoint_root).expect("checkpoint cleanup");
        });
    }
}
