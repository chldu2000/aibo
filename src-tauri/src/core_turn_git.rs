//! Turn-scoped Git mutations. The host ledger owns approval and execution lifetime.
use crate::{CoreError, GitHunkActionResult, TurnDiffSourceError, workspace_write_runs::Request};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};

/// Private temporary files are removed on success, error, cancellation and future disposal.
struct PatchDirectory(PathBuf);
impl PatchDirectory {
    fn new() -> Result<Self, CoreError> {
        let path = std::env::temp_dir().join(format!("aibo-turn-patch-{}", ulid::Ulid::new()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)] {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).map_err(|error| CoreError::Database(format!("create private patch directory: {error}")))?;
        Ok(Self(path))
    }
}
impl Drop for PatchDirectory {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

// Git's C-style path quoting, including control characters and non-ASCII bytes.
// A file name must never be able to inject another patch header.
fn patch_label(prefix: &str, path: &str) -> String {
    let mut label = format!("\"{prefix}/");
    for byte in path.bytes() {
        match byte {
            b'"' | b'\\' => { label.push('\\'); label.push(byte as char); }
            0x20..=0x7e => label.push(byte as char),
            _ => label.push_str(&format!("\\{byte:03o}")),
        }
    }
    label.push('"'); label
}

pub(crate) async fn apply_hunk(
    db: &SqlitePool, data_dir: &Path, session_id: &str, turn_id: &str,
    path: &str, hunk_index: i64, action: &str, request: &Request,
) -> Result<GitHunkActionResult, CoreError> {
    if !matches!(action, "stage" | "unstage" | "revert") || hunk_index < 0 {
        return Err(CoreError::InvalidWorkspacePath("unsupported Git hunk action or index".into()));
    }
    // Patch targets must be relative file names. Resolve containment again after approval.
    if path.is_empty() || Path::new(path).components().any(|part| !matches!(part, std::path::Component::Normal(_))) {
        return Err(CoreError::InvalidWorkspacePath("hunk path must be workspace-relative".into()));
    }
    let session = crate::session_by_id(db, session_id).await?;
    let workspace = crate::workspace_by_id(db, &session.workspace_id).await?;
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.hunk", serde_json::json!({
        "sessionId":session_id,"turnId":turn_id,"path":path,"hunkIndex":hunk_index,"action":action,
    }), request, |cancel| async {
        let result = |applied, message: String| GitHunkActionResult {
            path: path.into(), hunk_index, action: action.into(), applied, message,
        };
        let sources = match crate::load_turn_diff_sources(db, data_dir, &workspace.path, session_id, turn_id, path, true).await {
            Ok(sources) => sources,
            Err(TurnDiffSourceError::NotChanged) => return Ok(result(false, "该文件不在本轮变更记录中".into())),
            Err(TurnDiffSourceError::Unavailable(message)) => return Ok(result(false, message)),
            Err(TurnDiffSourceError::UnsafePath(message)) => return Err(CoreError::InvalidWorkspacePath(message)),
            Err(TurnDiffSourceError::Failed(message)) => return Err(CoreError::Database(message)),
        };
        if sources.baseline_dirty {
            return Ok(result(false, "本轮前已有修改，拒绝执行 hunk 级 Git 操作".into()));
        }
        let operation = crate::workspace_git::GitOperation::new(&workspace.path).cancellable(cancel);
        let directory = PatchDirectory::new()?;
        let baseline = directory.0.join("baseline"); let current = directory.0.join("result");
        tokio::fs::write(&baseline, &sources.baseline).await.map_err(|error| CoreError::Database(error.to_string()))?;
        tokio::fs::write(&current, &sources.result).await.map_err(|error| CoreError::Database(error.to_string()))?;
        let (diff, message) = operation.run(&[
            "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", "--no-prefix", "--",
            baseline.to_str().ok_or_else(|| CoreError::InvalidWorkspacePath("temporary path is not UTF-8".into()))?,
            current.to_str().ok_or_else(|| CoreError::InvalidWorkspacePath("temporary path is not UTF-8".into()))?,
        ], "prepare_hunk").await?;
        if !matches!(diff.exit_code, Some(0 | 1)) { return Ok(result(false, message)); }
        // The bounded runner drains excess bytes; truncated patches must never be applied.
        if diff.stdout.len() > 256 * 1024 || diff.stderr.len() > 256 * 1024 {
            return Ok(result(false, "hunk diff 超过 256 KiB，未执行局部修改".into()));
        }
        let normalized = crate::normalize_unified_diff_headers(
            &String::from_utf8_lossy(&diff.stdout),
            &if sources.baseline_exists { patch_label("a", path) } else { "/dev/null".into() },
            &if sources.result_exists { patch_label("b", path) } else { "/dev/null".into() },
        );
        let patch = crate::select_unified_hunk(&normalized, hunk_index as usize).map_err(CoreError::Database)?;
        let patch_path = directory.0.join("selected.patch");
        tokio::fs::write(&patch_path, patch).await.map_err(|error| CoreError::Database(error.to_string()))?;
        let mut args = vec!["apply", "--check", "--whitespace=nowarn"];
        if matches!(action, "stage" | "unstage") { args.push("--cached"); }
        if matches!(action, "unstage" | "revert") { args.push("--reverse"); }
        args.push("--"); args.push(patch_path.to_str().unwrap());
        let (check, message) = operation.run(&args, "check_hunk").await?;
        if !check.success { return Ok(result(false, message)); }
        args.remove(1);
        let (output, message) = operation.run(&args, "apply_hunk").await?;
        Ok(result(output.success, message))
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use sqlx::Row;

    struct Fixture { directory: PatchDirectory, db: SqlitePool, root: PathBuf, path: String, baseline: String, changed: String }
    impl Fixture {
        fn git(&self, args: &[&str]) -> String {
            let output = std::process::Command::new("git").arg("--literal-pathspecs").arg("-C").arg(&self.root).args(args).output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            String::from_utf8(output.stdout).unwrap()
        }
        async fn new(path: &str) -> Self {
            let directory = PatchDirectory::new().unwrap();
            let root = directory.0.join("workspace"); std::fs::create_dir(&root).unwrap();
            let db = crate::open_database(&directory.0.join("host.db")).await.unwrap();
            let baseline = (0..30).map(|i| format!("line {i}\n")).collect::<String>();
            let changed = baseline.replace("line 1\n", "first change\n").replace("line 28\n", "last change\n");
            let fixture = Self { directory, db, root, path: path.into(), baseline, changed };
            fixture.git(&["init", "-q"]); fixture.git(&["config", "user.name", "Fixture"]);
            fixture.git(&["config", "user.email", "fixture@example.invalid"]);
            fixture.git(&["config", "commit.gpgsign", "false"]); fixture.git(&["config", "core.hooksPath", "/dev/null"]);
            std::fs::write(fixture.root.join(path), &fixture.baseline).unwrap(); fixture.git(&["add", "--", path]);
            fixture.git(&["commit", "-qm", "Baseline\n\nCo-authored-by: Codex <codex@openai.com>"]);
            let head = fixture.git(&["rev-parse", "HEAD"]);
            std::fs::write(fixture.root.join(path), &fixture.changed).unwrap();
            let now = crate::now_iso();
            sqlx::query("INSERT INTO workspaces (id,path,label,trusted,created_at,updated_at) VALUES ('workspace',?,'Hunk fixture',1,?,?)")
                .bind(fixture.root.to_str().unwrap()).bind(&now).bind(&now).execute(&fixture.db).await.unwrap();
            sqlx::query("INSERT INTO sessions (id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('session','workspace','pi','Fixture','idle',?,?)")
                .bind(&now).bind(&now).execute(&fixture.db).await.unwrap();
            sqlx::query("INSERT INTO turns (id,session_id,external_turn_id,status,started_at) VALUES ('turn','session','external-turn','completed',?)")
                .bind(&now).execute(&fixture.db).await.unwrap();
            sqlx::query("INSERT INTO turn_change_sets (id,workspace_id,session_id,turn_id,schema_version,baseline_head,attribution,capture_status,created_at,updated_at) VALUES ('set','workspace','session','turn','aibo.turn-changeset/v1',?,'agent','captured',?,?)")
                .bind(head.trim()).bind(&now).bind(&now).execute(&fixture.db).await.unwrap();
            sqlx::query("INSERT INTO file_changes (id,change_set_id,path,change_kind,baseline_exists,baseline_hash,result_exists,result_hash,created_at) VALUES ('file','set',?,'modified',1,?,1,?,?)")
                .bind(path).bind(format!("sha256:{:x}", Sha256::digest(fixture.baseline.as_bytes())))
                .bind(format!("sha256:{:x}", Sha256::digest(fixture.changed.as_bytes()))).bind(&now).execute(&fixture.db).await.unwrap();
            fixture
        }
        async fn apply(&self, action: &str, request: &Request) -> Result<GitHunkActionResult, CoreError> {
            apply_hunk(&self.db, &self.directory.0, "session", "turn", &self.path, 0, action, request).await
        }
        async fn close(self) { self.db.close().await; }
    }

    fn approve(id: &str) -> Request {
        Request::with_confirmation(id.into(), "main".into(), |summary| async move {
            assert!(summary.contains("git.hunk") && summary.contains("hunkIndex")); Ok(true)
        })
    }

    #[tokio::test]
    async fn hunk_stage_unstage_revert_and_replay_preserve_other_hunks_and_quoted_paths() {
        // Include control characters to prove a name cannot inject patch syntax.
        for path in ["file.txt", "空 格\"\\\n--- injected.txt"] {
            let f = Fixture::new(path).await;
            let staged = f.apply("stage", &approve("stage")).await.unwrap(); assert!(staged.applied, "{}", staged.message);
            let index = f.git(&["show", &format!(":{path}")]);
            assert_eq!(index, f.baseline.replace("line 1\n", "first change\n"));
            assert_eq!(std::fs::read_to_string(f.root.join(path)).unwrap(), f.changed);
            let unstaged = f.apply("unstage", &approve("unstage")).await.unwrap(); assert!(unstaged.applied, "{}", unstaged.message);
            assert_eq!(f.git(&["show", &format!(":{path}")]), f.baseline);
            let reverted = f.apply("revert", &approve("revert")).await.unwrap(); assert!(reverted.applied, "{}", reverted.message);
            let expected = f.baseline.replace("line 28\n", "last change\n");
            assert_eq!(std::fs::read_to_string(f.root.join(path)).unwrap(), expected);
            let replay = Request::with_confirmation("revert".into(), "main".into(), |_| async { panic!("replay must not prompt") });
            assert_eq!(serde_json::to_value(f.apply("revert", &replay).await.unwrap()).unwrap(), serde_json::to_value(reverted).unwrap());
            assert_eq!(std::fs::read_to_string(f.root.join(path)).unwrap(), expected);
            assert!(f.apply("stage", &replay).await.is_err());
            let rows = sqlx::query("SELECT status,approval_outcome,result_json FROM workspace_write_runs").fetch_all(&f.db).await.unwrap();
            assert_eq!(rows.len(), 3);
            for row in rows { assert_eq!(row.get::<String,_>("status"), "completed"); assert_eq!(row.get::<String,_>("approval_outcome"), "approved"); }
            f.close().await;
        }
    }

    #[tokio::test]
    async fn hunk_approval_rejects_denial_cancellation_and_changed_turn_context() {
        for decision in ["denied", "cancelled", "metadata", "workspace", "session"] {
            let f = Fixture::new("file.txt").await;
            let db = f.db.clone(); let root = f.root.clone();
            let request = Request::with_confirmation(decision.into(), "main".into(), move |_| {
                let db = db.clone(); let root = root.clone();
                async move {
                    let id: String = sqlx::query_scalar("SELECT id FROM workspace_write_runs WHERE status='awaiting_approval'").fetch_one(&db).await.unwrap();
                    assert!(matches!(crate::workspace_writes::acquire(&db, "workspace", &root).await, Err(CoreError::WorkspaceWriteBusy)));
                    match decision {
                        "denied" => return Ok(false),
                        "cancelled" => {
                            assert!(!crate::workspace_write_runs::cancel(&db, "workspace", &id, "other-window").await.unwrap());
                            assert!(crate::workspace_write_runs::cancel(&db, "workspace", &id, "main").await.unwrap());
                        }
                        "metadata" => { sqlx::query("UPDATE file_changes SET baseline_hash='changed'").execute(&db).await.unwrap(); }
                        "workspace" => { std::fs::write(root.join("file.txt"), "changed during approval").unwrap(); }
                        "session" => { sqlx::query("UPDATE sessions SET archived=1").execute(&db).await.unwrap(); }
                        _ => unreachable!(),
                    }
                    Ok(true)
                }
            });
            let error = serde_json::to_value(f.apply("stage", &request).await.unwrap_err()).unwrap();
            assert_eq!(error["code"], "approval_rejected");
            assert_eq!(f.git(&["show", ":file.txt"]), f.baseline);
            let row = sqlx::query("SELECT status,approval_outcome FROM workspace_write_runs").fetch_one(&f.db).await.unwrap();
            assert_eq!(row.get::<String,_>("status"), "rejected");
            assert_eq!(row.get::<String,_>("approval_outcome"), if matches!(decision, "denied" | "cancelled") { decision } else { "stale" });
            let replay = Request::with_confirmation(decision.into(), "main".into(), |_| async { panic!("denied replay prompted") });
            assert_eq!(serde_json::to_value(f.apply("stage", &replay).await.unwrap_err()).unwrap(), error);
            f.close().await;
        }
    }

    #[tokio::test]
    async fn hunk_refuses_later_edits_dirty_baselines_and_truncated_patches() {
        for condition in ["later-edit", "dirty-baseline", "oversized"] {
            let f = Fixture::new("file.txt").await;
            match condition {
                "later-edit" => std::fs::write(f.root.join("file.txt"), "user's later edit\n").unwrap(),
                "dirty-baseline" => {
                    sqlx::query("UPDATE file_changes SET baseline_dirty=1").execute(&f.db).await.unwrap();
                }
                "oversized" => {
                    let large = "x".repeat(300 * 1024);
                    std::fs::write(f.root.join("file.txt"), &large).unwrap();
                    sqlx::query("UPDATE file_changes SET result_hash=?").bind(format!("sha256:{:x}", Sha256::digest(large.as_bytes())))
                        .execute(&f.db).await.unwrap();
                }
                _ => unreachable!(),
            }
            let before = std::fs::read(f.root.join("file.txt")).unwrap();
            let output = f.apply("revert", &approve(condition)).await.unwrap();
            assert!(!output.applied, "{condition}");
            if condition == "oversized" { assert!(output.message.contains("256 KiB")); }
            assert_eq!(std::fs::read(f.root.join("file.txt")).unwrap(), before);
            assert_eq!(f.git(&["show", ":file.txt"]), f.baseline);
            f.close().await;
        }
    }

    #[tokio::test]
    async fn hunk_handles_added_and_deleted_files() {
        for kind in ["added", "deleted"] {
            let f = Fixture::new("file.txt").await;
            if kind == "added" {
                f.git(&["rm", "--cached", "--", "file.txt"]);
                f.git(&["commit", "-qm", "Remove baseline\n\nCo-authored-by: Codex <codex@openai.com>"]);
                sqlx::query("UPDATE file_changes SET change_kind='added',baseline_exists=0,baseline_hash=NULL").execute(&f.db).await.unwrap();
            } else {
                std::fs::remove_file(f.root.join("file.txt")).unwrap();
                sqlx::query("UPDATE file_changes SET change_kind='deleted',result_exists=0,result_hash=NULL").execute(&f.db).await.unwrap();
            }
            let output = f.apply("stage", &approve("stage")).await.unwrap();
            assert!(output.applied, "{kind}: {}", output.message);
            if kind == "added" { assert_eq!(f.git(&["show", ":file.txt"]), f.changed); }
            else { assert_eq!(f.git(&["ls-files"]), ""); }
            let output = f.apply("unstage", &approve("unstage")).await.unwrap();
            assert!(output.applied, "{kind}: {}", output.message);
            if kind == "added" { assert_eq!(f.git(&["ls-files"]), ""); }
            else { assert_eq!(f.git(&["show", ":file.txt"]), f.baseline); }
            f.close().await;
        }
    }
}
