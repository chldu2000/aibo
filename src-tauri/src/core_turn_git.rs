//! Turn-scoped Git mutations. The host ledger owns approval and execution lifetime.
use crate::turn_changes::TurnDiffSourceError;
use crate::{CoreError, GitFileActionResult, GitHunkActionResult, workspace_write_runs::Request};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

fn validate_path(path: &str) -> Result<(), CoreError> {
    if path.is_empty() || Path::new(path).components().any(|part| !matches!(part, std::path::Component::Normal(_))) {
        return Err(crate::ui_i18n::invalid_path_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.pathRelative", serde_json::json!({}), "turn Git path must be workspace-relative")));
    }
    Ok(())
}

pub(crate) async fn apply_file(
    db: &SqlitePool, data_dir: &Path, session_id: &str, path: &str,
    action: &str, turn_id: Option<&str>, request: &Request,
) -> Result<GitFileActionResult, CoreError> {
    validate_path(path)?;
    if !matches!(action, "stage" | "unstage" | "revert") {
        return Err(crate::ui_i18n::invalid_path_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.fileActionUnsupported", serde_json::json!({}), "unsupported Git file action")));
    }
    if action == "revert" && turn_id.is_none() {
        return Err(crate::ui_i18n::invalid_path_error("native.turn.restoreTurnRequired", serde_json::json!({})));
    }
    let session = crate::session_by_id(db, session_id).await?;
    let workspace = crate::workspace_by_id(db, &session.workspace_id).await?;
    let operation = if action == "revert" { "git.file-revert" } else { "git.index" };
    crate::workspace_write_runs::execute_requested(db, &workspace, operation, serde_json::json!({
        "path":path,"action":action,"sessionId":session_id,"turnId":turn_id,
    }), request, |cancel| async {
        if action != "revert" {
            return crate::workspace_git::apply_git_index_action(&workspace.path, path, action, Some(cancel)).await;
        }
        let result = |applied, message: crate::ui_i18n::HostMessage| GitFileActionResult { path: path.into(), action: action.into(), applied, message: message.diagnostic, localized_message: message.localized };
        let sources = match crate::turn_changes::load_turn_diff_sources(db, data_dir, &workspace.path, session_id, turn_id.unwrap(), path, false).await {
            Ok(sources) => sources,
            Err(TurnDiffSourceError::NotChanged) => return Ok(result(false, crate::ui_i18n::HostMessage::new("native.turn.notChanged", serde_json::json!({})))),
            Err(TurnDiffSourceError::Unavailable(message)) => return Ok(result(false, message)),
            Err(TurnDiffSourceError::UnsafePath(message)) => return Err(crate::ui_i18n::invalid_path_message(message)),
            Err(TurnDiffSourceError::Failed(message)) => return Err(CoreError::Database(message)),
        };
        if sources.baseline_dirty {
            return Ok(result(false, crate::ui_i18n::HostMessage::new("native.turn.dirtyFileRestore", serde_json::json!({}))));
        }
        let git = crate::workspace_git::GitOperation::new(&workspace.path).cancellable(cancel.clone());
        let baseline_mode = if sources.baseline_exists {
            let head: Option<String> = sqlx::query_scalar("SELECT baseline_head FROM turn_change_sets WHERE session_id=? AND turn_id=?")
                .bind(session_id).bind(turn_id).fetch_one(db).await?;
            let Some(head) = head else { return Ok(result(false, crate::ui_i18n::HostMessage::new("native.turn.modeBaselineMissing", serde_json::json!({})))); };
            let (output, message) = git.run(&["ls-tree", "--format=%(objectmode)", &head, "--", path], "inspect_restore_mode").await?;
            if !output.success { return Ok(result(false, message.into())); }
            match String::from_utf8_lossy(&output.stdout).trim() {
                "100644" => Some(0o644), "100755" => Some(0o755),
                _ => return Ok(result(false, crate::ui_i18n::HostMessage::new("native.turn.modeNotRegular", serde_json::json!({})))),
            }
        } else { None };
        restore_worktree(&workspace.path, path, &sources, baseline_mode, Some(&cancel)).await?;
        // The worktree has changed. Any subsequent failure is a partial/unknown outcome,
        // even a conclusive nonzero Git exit. Never blindly overwrite the file to roll back.
        let (output, message) = if sources.baseline_exists {
            git.run(&["add", "--", path], "restore_file_index").await?
        } else {
            git.run(&["rm", "--cached", "--ignore-unmatch", "--", path], "restore_file_index").await?
        };
        if !output.success {
            return Err(crate::ui_i18n::unknown_message(crate::ui_i18n::HostMessage::new("native.turn.indexRestoreFailed", serde_json::json!({"path":path,"error":message.display()}))));
        }
        Ok(result(true, crate::ui_i18n::HostMessage::new("native.turn.fileRestored", serde_json::json!({}))))
    }).await
}

struct RestoreTemp(PathBuf);
impl Drop for RestoreTemp {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

pub(crate) async fn restore_worktree(
    workspace_path: &str, path: &str, sources: &crate::turn_changes::TurnDiffSources,
    baseline_mode: Option<u32>,
    cancel: Option<&crate::workspace_write_runs::Cancellation>,
) -> Result<(), CoreError> {
    let root = tokio::fs::canonicalize(workspace_path).await.map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
    let resolve = || {
        let target = crate::workspace_guard::canonicalize_target_message(&root, Path::new(path)).map_err(crate::ui_i18n::invalid_path_message)?;
        if target != root.join(path) {
            return Err(crate::ui_i18n::invalid_path_error("native.turn.restoreSymlink", serde_json::json!({})));
        }
        Ok(target)
    };
    let target = resolve()?;
    let unknown = |error: std::io::Error| crate::ui_i18n::unknown_message(crate::ui_i18n::HostMessage::new("native.turn.restoreWriteFailed", serde_json::json!({"path":path,"error":error.to_string()})));
    let stopped = || {
        let display = crate::ui_i18n::HostMessage::new("native.turn.restoreCancelled", serde_json::json!({}));
        CoreError::Localized {error:Box::new(CoreError::WriteReplay {code:"cancelled".into(),message:display.diagnostic}),localized:display.localized.unwrap()}
    };
    if let Some(cancel) = cancel { if cancel.is_requested().await { return Err(stopped()); } }
    // Prepare a sibling and rename it, rather than truncating a live file or writing
    // through hard links. Await each filesystem step; cancellation does not abandon
    // a blocking filesystem worker that could write after the workspace lock is freed.
    let prepared = if sources.baseline_exists {
        let parent = target.parent().ok_or_else(|| crate::ui_i18n::invalid_path_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.restoreNoParent", serde_json::json!({}), "restore target has no parent")))?;
        tokio::fs::create_dir_all(parent).await.map_err(unknown)?;
        let temporary = RestoreTemp(parent.join(format!(".aibo-restore-{}", ulid::Ulid::new())));
        let mut options = tokio::fs::OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] options.mode(0o600);
        let mut file = options.open(&temporary.0).await.map_err(unknown)?;
        file.write_all(&sources.baseline).await.map_err(unknown)?;
        file.flush().await.map_err(unknown)?;
        let mut permissions = if sources.result_exists {
            tokio::fs::metadata(&target).await.map_err(unknown)?.permissions()
        } else { file.metadata().await.map_err(unknown)?.permissions() };
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = baseline_mode {
                permissions.set_mode((permissions.mode() & !0o111) | (mode & 0o111));
            }
        }
        #[cfg(not(unix))] let _ = baseline_mode;
        file.set_permissions(permissions).await.map_err(unknown)?;
        drop(file);
        Some(temporary)
    } else { None };
    if let Some(cancel) = cancel { if cancel.is_requested().await { return Err(stopped()); } }
    if resolve()? != target { return Err(crate::ui_i18n::invalid_path_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.restoreTargetChanged", serde_json::json!({}), "restore target changed"))); }
    // Recheck after preparing the replacement. An external writer is not covered by
    // the host lock; this reduces the race but is not a filesystem compare-and-swap.
    if sources.result_exists {
        let current = crate::turn_changes::read_turn_diff_file(&target).await.map_err(|error| CoreError::InvalidWorkspacePath(error.to_string()))?;
        if current != sources.result { return Err(crate::ui_i18n::invalid_path_error("native.turn.restoreFileChanged", serde_json::json!({}))); }
    } else {
        match tokio::fs::symlink_metadata(&target).await {
            Ok(_) => return Err(crate::ui_i18n::invalid_path_error("native.turn.restoreFileReappeared", serde_json::json!({}))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(unknown(error)),
        }
    }
    if let Some(temporary) = prepared {
        tokio::fs::rename(&temporary.0, &target).await.map_err(unknown)?;
    } else if sources.result_exists {
        tokio::fs::remove_file(&target).await.map_err(unknown)?;
    }
    Ok(())
}

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
        builder.create(&path).map_err(|error| crate::ui_i18n::database_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.patchDirectoryFailed", serde_json::json!({"error":error.to_string()}), format!("create private patch directory: {error}"))))?;
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
        return Err(crate::ui_i18n::invalid_path_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.hunkActionUnsupported", serde_json::json!({}), "unsupported Git hunk action or index")));
    }
    // Patch targets must be relative file names. Resolve containment again after approval.
    validate_path(path)?;
    let session = crate::session_by_id(db, session_id).await?;
    let workspace = crate::workspace_by_id(db, &session.workspace_id).await?;
    crate::workspace_write_runs::execute_requested(db, &workspace, "git.hunk", serde_json::json!({
        "sessionId":session_id,"turnId":turn_id,"path":path,"hunkIndex":hunk_index,"action":action,
    }), request, |cancel| async {
        let result = |applied, message: crate::ui_i18n::HostMessage| GitHunkActionResult {
            path: path.into(), hunk_index, action: action.into(), applied, message: message.diagnostic, localized_message: message.localized,
        };
        let sources = match crate::turn_changes::load_turn_diff_sources(db, data_dir, &workspace.path, session_id, turn_id, path, true).await {
            Ok(sources) => sources,
            Err(TurnDiffSourceError::NotChanged) => return Ok(result(false, crate::ui_i18n::HostMessage::new("native.turn.notChanged", serde_json::json!({})))),
            Err(TurnDiffSourceError::Unavailable(message)) => return Ok(result(false, message)),
            Err(TurnDiffSourceError::UnsafePath(message)) => return Err(crate::ui_i18n::invalid_path_message(message)),
            Err(TurnDiffSourceError::Failed(message)) => return Err(CoreError::Database(message)),
        };
        if sources.baseline_dirty {
            return Ok(result(false, crate::ui_i18n::HostMessage::new("native.turn.dirtyHunk", serde_json::json!({}))));
        }
        let operation = crate::workspace_git::GitOperation::new(&workspace.path).cancellable(cancel);
        let directory = PatchDirectory::new()?;
        let baseline = directory.0.join("baseline"); let current = directory.0.join("result");
        tokio::fs::write(&baseline, &sources.baseline).await.map_err(|error| CoreError::Database(error.to_string()))?;
        tokio::fs::write(&current, &sources.result).await.map_err(|error| CoreError::Database(error.to_string()))?;
        let (diff, message) = operation.run(&[
            "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", "--no-prefix", "--",
            baseline.to_str().ok_or_else(|| crate::ui_i18n::invalid_path_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.temporaryPathUtf8", serde_json::json!({}), "temporary path is not UTF-8")))?,
            current.to_str().ok_or_else(|| crate::ui_i18n::invalid_path_message(crate::ui_i18n::HostMessage::with_diagnostic("native.turn.temporaryPathUtf8", serde_json::json!({}), "temporary path is not UTF-8")))?,
        ], "prepare_hunk").await?;
        if !matches!(diff.exit_code, Some(0 | 1)) { return Ok(result(false, message.into())); }
        // The bounded runner drains excess bytes; truncated patches must never be applied.
        if diff.stdout.len() > 256 * 1024 || diff.stderr.len() > 256 * 1024 {
            return Ok(result(false, crate::ui_i18n::HostMessage::new("native.turn.hunkLimit", serde_json::json!({}))));
        }
        let normalized = crate::text_diff::normalize_unified_diff_headers(
            &String::from_utf8_lossy(&diff.stdout),
            &if sources.baseline_exists { patch_label("a", path) } else { "/dev/null".into() },
            &if sources.result_exists { patch_label("b", path) } else { "/dev/null".into() },
        );
        let patch = crate::text_diff::select_unified_hunk(&normalized, hunk_index as usize).map_err(crate::ui_i18n::database_message)?;
        let patch_path = directory.0.join("selected.patch");
        tokio::fs::write(&patch_path, patch).await.map_err(|error| CoreError::Database(error.to_string()))?;
        let mut args = vec!["apply", "--check", "--whitespace=nowarn"];
        if matches!(action, "stage" | "unstage") { args.push("--cached"); }
        if matches!(action, "unstage" | "revert") { args.push("--reverse"); }
        args.push("--"); args.push(patch_path.to_str().unwrap());
        let (check, message) = operation.run(&args, "check_hunk").await?;
        if !check.success { return Ok(result(false, message.into())); }
        args.remove(1);
        let (output, message) = operation.run(&args, "apply_hunk").await?;
        Ok(result(output.success, message.into()))
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
        async fn file(&self, action: &str, request: &Request) -> Result<GitFileActionResult, CoreError> {
            apply_file(&self.db, &self.directory.0, "session", &self.path, action, Some("turn"), request).await
        }
        async fn close(self) { self.db.close().await; }
    }

    fn approve(id: &str) -> Request {
        Request::with_confirmation(id.into(), "main".into(), |summary| async move {
            assert!(summary.contains("git.hunk") && summary.contains("hunkIndex")); Ok(true)
        })
    }

    fn approve_file(id: &str) -> Request {
        Request::with_confirmation(id.into(), "main".into(), |summary| async move {
            assert!(summary.contains("git.file-revert") && summary.contains("turnId")); Ok(true)
        })
    }

    fn check_display(error: &CoreError, code: &str, diagnostic: &str, english: &str) {
        let payload = serde_json::to_value(error).unwrap();
        assert_eq!(payload["code"],code);
        assert_eq!(payload["message"],diagnostic);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&payload["localized"]),english);
        assert_ne!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&payload["localized"]),english);
    }

    #[tokio::test]
    async fn turn_git_validation_displays_translate_without_changing_diagnostics_or_files() {
        let f = Fixture::new("file.txt").await;
        let request = Request::with_confirmation("invalid".into(),"main".into(), |_|async {panic!("invalid input must not ask for approval")});
        let cases = [
            (apply_file(&f.db,&f.directory.0,"session","../原文{path}","revert",Some("turn"),&request).await.unwrap_err(),"invalid workspace path: turn Git path must be workspace-relative","Turn Git paths must be relative to the workspace."),
            (apply_file(&f.db,&f.directory.0,"session","file.txt","unsupported",Some("turn"),&request).await.unwrap_err(),"invalid workspace path: unsupported Git file action","This Git file action is unsupported."),
            (apply_file(&f.db,&f.directory.0,"session","file.txt","revert",None,&request).await.unwrap_err(),"invalid workspace path: 整文件还原需要明确的本轮变更记录","Whole-file restoration requires an explicit record of this turn’s changes."),
            (apply_hunk(&f.db,&f.directory.0,"session","turn","file.txt",-1,"stage",&request).await.unwrap_err(),"invalid workspace path: unsupported Git hunk action or index","This Git hunk action or index is unsupported."),
        ];
        for (error,diagnostic,english) in cases {check_display(&error,"invalid_workspace_path",diagnostic,english);}
        assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(),f.changed);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspace_write_runs").fetch_one(&f.db).await.unwrap();assert_eq!(count,0);
        f.close().await;
    }

    #[tokio::test]
    async fn restore_safety_errors_translate_and_preserve_files() {
        for appeared in [false,true] {
            let f = Fixture::new("file.txt").await;
            std::fs::write(f.root.join("file.txt"),"later user edit {error}").unwrap();
            let sources = crate::turn_changes::TurnDiffSources {baseline_exists:true,result_exists:!appeared,baseline:f.baseline.as_bytes().to_vec(),result:f.changed.as_bytes().to_vec(),baseline_dirty:false};
            let error = restore_worktree(f.root.to_str().unwrap(),"file.txt",&sources,Some(0o644),None).await.unwrap_err();
            check_display(&error,"invalid_workspace_path",if appeared {"invalid workspace path: 文件已重新出现，拒绝覆盖"} else {"invalid workspace path: 文件已在准备恢复期间变化，拒绝覆盖"},if appeared {"The file reappeared. Overwriting it is blocked."} else {"The file changed while restoration was being prepared. Overwriting it is blocked."});
            assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(),"later user edit {error}");
            assert!(!std::fs::read_dir(&f.root).unwrap().any(|entry|entry.unwrap().file_name().to_string_lossy().starts_with(".aibo-restore-")));
            f.close().await;
        }
        #[cfg(unix)] {
            let f = Fixture::new("file.txt").await;
            std::fs::rename(f.root.join("file.txt"),f.root.join("original.txt")).unwrap();
            std::os::unix::fs::symlink("original.txt",f.root.join("file.txt")).unwrap();
            let sources = crate::turn_changes::TurnDiffSources {baseline_exists:true,result_exists:true,baseline:f.baseline.as_bytes().to_vec(),result:f.changed.as_bytes().to_vec(),baseline_dirty:false};
            let error = restore_worktree(f.root.to_str().unwrap(),"file.txt",&sources,Some(0o644),None).await.unwrap_err();
            check_display(&error,"invalid_workspace_path","invalid workspace path: 整文件还原不支持符号链接路径","Whole-file restoration does not support symbolic-link paths.");
            assert_eq!(std::fs::read_to_string(f.root.join("original.txt")).unwrap(),f.changed);
            assert!(std::fs::symlink_metadata(f.root.join("file.txt")).unwrap().file_type().is_symlink());
            f.close().await;
        }
    }

    #[tokio::test]
    async fn restore_cancelled_before_replacement_preserves_display_and_replays_without_writing() {
        let f = Fixture::new("file.txt").await;
        let workspace = crate::workspace_by_id(&f.db,"workspace").await.unwrap();
        let request = Request::with_confirmation("cancel-before-replacement".into(),"main".into(), |_|async {Ok(true)});
        let fixture = &f;
        let run = || crate::workspace_write_runs::execute_with_context(&f.db,&workspace,"core.turn-restore",serde_json::json!({"sessionId":"session","turnId":"turn"}),&request,||async {Ok(serde_json::json!({"fixture":"cancel"}))},|cancel| async move {
            assert!(crate::workspace_write_runs::cancel(&fixture.db,"workspace",cancel.run_id(),"main").await.unwrap());
            let sources = crate::turn_changes::TurnDiffSources {baseline_exists:true,result_exists:true,baseline:fixture.baseline.as_bytes().to_vec(),result:fixture.changed.as_bytes().to_vec(),baseline_dirty:false};
            restore_worktree(fixture.root.to_str().unwrap(),"file.txt",&sources,Some(0o644),Some(&cancel)).await
        });
        let error = run().await.unwrap_err();
        check_display(&error,"cancelled","整文件还原已在替换文件前取消","Whole-file restoration was cancelled before replacing the file.");
        assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(),f.changed);
        std::fs::write(f.root.join("file.txt"),"later user edit").unwrap();
        assert_eq!(serde_json::to_value(run().await.unwrap_err()).unwrap(),serde_json::to_value(error).unwrap());
        assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(),"later user edit");
        f.close().await;
    }

    #[tokio::test]
    async fn whole_file_restore_updates_staged_result_and_replays_without_writing_again() {
        for path in ["file.txt", "literal[1] 空格.txt"] {
            let f = Fixture::new(path).await;
            f.git(&["add", "--", path]);
            let restored = f.file("revert", &approve_file("revert")).await.unwrap();
            assert!(restored.applied, "{}", restored.message);
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,restored.localized_message.as_ref().unwrap()),restored.message);
            assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,restored.localized_message.as_ref().unwrap()).starts_with("Restored the file"));
            assert_eq!(std::fs::read_to_string(f.root.join(path)).unwrap(), f.baseline);
            assert_eq!(f.git(&["show", &format!(":{path}")]), f.baseline);
            // New edits after settlement must survive retries of the old request.
            std::fs::write(f.root.join(path), "later user edit").unwrap();
            let replay = Request::with_confirmation("revert".into(), "main".into(), |_| async { panic!("replay approval") });
            assert_eq!(serde_json::to_value(f.file("revert", &replay).await.unwrap()).unwrap(), serde_json::to_value(restored).unwrap());
            assert_eq!(std::fs::read_to_string(f.root.join(path)).unwrap(), "later user edit");
            assert!(f.file("stage", &replay).await.is_err());
            let row = sqlx::query("SELECT status,operation,approval_outcome FROM workspace_write_runs").fetch_one(&f.db).await.unwrap();
            assert_eq!(row.get::<String,_>("operation"), "git.file-revert");
            assert_eq!(row.get::<String,_>("status"), "completed");
            assert_eq!(row.get::<String,_>("approval_outcome"), "approved");
            f.close().await;
        }
    }

    #[tokio::test]
    async fn whole_file_restore_keeps_partial_effects_and_unknown_record_when_index_update_fails() {
        let f = Fixture::new("file.txt").await;
        f.git(&["add", "--", "file.txt"]);
        // Read-only approval probes still work while another Git process owns this lock.
        std::fs::write(f.root.join(".git/index.lock"), "fixture lock").unwrap();
        let error = f.file("revert", &approve_file("failed-index")).await.unwrap_err();
        assert!(error.is_write_outcome_unknown(), "{error}");
        let payload = serde_json::to_value(&error).unwrap();
        let display = &payload["localized"];
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,display),error.to_string());
        let english = crate::ui_i18n::render(crate::ui_i18n::Locale::En,display);
        assert!(english.contains("File file.txt was restored, but updating the Git index failed."));
        assert!(english.contains("index.lock"));
        assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(), f.baseline);
        assert_eq!(f.git(&["show", ":file.txt"]), f.changed);
        std::fs::remove_file(f.root.join(".git/index.lock")).unwrap();
        let replay = Request::with_confirmation("failed-index".into(), "main".into(), |_| async { panic!("partial replay approval") });
        assert_eq!(serde_json::to_value(f.file("revert", &replay).await.unwrap_err()).unwrap(), serde_json::to_value(error).unwrap());
        assert_eq!(f.git(&["show", ":file.txt"]), f.changed);
        let status: String = sqlx::query_scalar("SELECT status FROM workspace_write_runs").fetch_one(&f.db).await.unwrap();
        assert_eq!(status, "outcome_unknown"); f.close().await;
    }

    #[tokio::test]
    async fn whole_file_restore_refuses_denial_later_edits_dirty_and_corrupt_baselines() {
        for condition in ["denied", "later-edit", "dirty", "corrupt-checkpoint", "stale-turn"] {
            let f = Fixture::new("file.txt").await;
            match condition {
                "later-edit" => std::fs::write(f.root.join("file.txt"), "later edit").unwrap(),
                "dirty" => { sqlx::query("UPDATE file_changes SET baseline_dirty=1").execute(&f.db).await.unwrap(); }
                "corrupt-checkpoint" => {
                    let checkpoint = crate::checkpoint_file_path(&f.directory.0.join("checkpoints"), "session", "turn", "file.txt");
                    std::fs::create_dir_all(checkpoint.parent().unwrap()).unwrap();
                    std::fs::write(checkpoint, "corrupt baseline").unwrap();
                }
                _ => {},
            }
            let db = f.db.clone();
            let request = Request::with_confirmation(condition.into(), "main".into(), move |_| {
                let db = db.clone();
                async move {
                    if condition == "stale-turn" { sqlx::query("UPDATE file_changes SET result_hash='changed'").execute(&db).await.unwrap(); }
                    Ok(condition != "denied")
                }
            });
            let before = std::fs::read(f.root.join("file.txt")).unwrap();
            let result = f.file("revert", &request).await;
            if matches!(condition, "denied" | "stale-turn") {
                assert_eq!(serde_json::to_value(result.unwrap_err()).unwrap()["code"], "approval_rejected");
            } else { assert!(!result.unwrap().applied, "{condition}"); }
            assert_eq!(std::fs::read(f.root.join("file.txt")).unwrap(), before);
            assert_eq!(f.git(&["show", ":file.txt"]), f.baseline);
            f.close().await;
        }
    }

    #[tokio::test]
    async fn whole_file_restore_handles_added_and_deleted_files() {
        for kind in ["added", "deleted"] {
            let f = Fixture::new("file.txt").await;
            if kind == "added" {
                f.git(&["rm", "--cached", "--", "file.txt"]);
                f.git(&["commit", "-qm", "Remove baseline\n\nCo-authored-by: Codex <codex@openai.com>"]);
                sqlx::query("UPDATE file_changes SET change_kind='added',baseline_exists=0,baseline_hash=NULL").execute(&f.db).await.unwrap();
                f.git(&["add", "--", "file.txt"]);
            } else {
                std::fs::remove_file(f.root.join("file.txt")).unwrap();
                sqlx::query("UPDATE file_changes SET change_kind='deleted',result_exists=0,result_hash=NULL").execute(&f.db).await.unwrap();
                f.git(&["add", "--", "file.txt"]);
            }
            let result = f.file("revert", &approve_file("restore")).await.unwrap(); assert!(result.applied, "{kind}: {}", result.message);
            if kind == "added" { assert!(!f.root.join("file.txt").exists()); assert_eq!(f.git(&["ls-files"]), ""); }
            else { assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(), f.baseline); assert_eq!(f.git(&["show", ":file.txt"]), f.baseline); }
            assert!(!std::fs::read_dir(&f.root).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with(".aibo-restore-")));
            f.close().await;
        }
    }

    #[tokio::test]
    async fn whole_file_restore_preserves_binary_baseline_bytes() {
        let f = Fixture::new("file.txt").await;
        let baseline = [0xff, 0, 1]; let changed = [0xfe, 0, 2];
        std::fs::write(f.root.join("file.txt"), baseline).unwrap(); f.git(&["add", "--", "file.txt"]);
        f.git(&["commit", "-qm", "Binary baseline\n\nCo-authored-by: Codex <codex@openai.com>"]);
        sqlx::query("UPDATE turn_change_sets SET baseline_head=?").bind(f.git(&["rev-parse", "HEAD"]).trim()).execute(&f.db).await.unwrap();
        std::fs::write(f.root.join("file.txt"), changed).unwrap(); f.git(&["add", "--", "file.txt"]);
        sqlx::query("UPDATE file_changes SET baseline_hash=?,result_hash=?")
            .bind(format!("sha256:{:x}", Sha256::digest(baseline))).bind(format!("sha256:{:x}", Sha256::digest(changed))).execute(&f.db).await.unwrap();
        assert!(f.file("revert", &approve_file("binary")).await.unwrap().applied);
        assert_eq!(std::fs::read(f.root.join("file.txt")).unwrap(), baseline);
        let index = std::process::Command::new("git").arg("-C").arg(&f.root).args(["show", ":file.txt"]).output().unwrap();
        assert!(index.status.success()); assert_eq!(index.stdout, baseline); f.close().await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn whole_file_restore_preserves_executable_baseline_without_writing_through_hardlinks() {
        use std::os::unix::fs::PermissionsExt;
        for deleted in [false, true] {
            let f = Fixture::new("file.txt").await;
            std::fs::write(f.root.join("file.txt"), &f.baseline).unwrap();
            std::fs::set_permissions(f.root.join("file.txt"), std::fs::Permissions::from_mode(0o755)).unwrap();
            f.git(&["add", "--", "file.txt"]); f.git(&["commit", "-qm", "Executable baseline\n\nCo-authored-by: Codex <codex@openai.com>"]);
            sqlx::query("UPDATE turn_change_sets SET baseline_head=?").bind(f.git(&["rev-parse", "HEAD"]).trim()).execute(&f.db).await.unwrap();
            std::fs::write(f.root.join("file.txt"), &f.changed).unwrap();
            std::fs::set_permissions(f.root.join("file.txt"), std::fs::Permissions::from_mode(0o644)).unwrap();
            let outside = f.directory.0.join("outside-workspace"); std::fs::hard_link(f.root.join("file.txt"), &outside).unwrap();
            if deleted {
                std::fs::remove_file(f.root.join("file.txt")).unwrap();
                sqlx::query("UPDATE file_changes SET change_kind='deleted',result_exists=0,result_hash=NULL").execute(&f.db).await.unwrap();
            }
            f.git(&["add", "--", "file.txt"]);
            let result = f.file("revert", &approve_file("mode")).await.unwrap(); assert!(result.applied, "{}", result.message);
            assert_eq!(std::fs::read_to_string(&outside).unwrap(), f.changed);
            assert_eq!(std::fs::metadata(&outside).unwrap().permissions().mode() & 0o111, 0);
            assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(), f.baseline);
            assert_eq!(std::fs::metadata(f.root.join("file.txt")).unwrap().permissions().mode() & 0o111, 0o111);
            assert!(f.git(&["ls-files", "--stage"]).starts_with("100755 ")); f.close().await;
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn whole_file_restore_cancellation_kills_git_filter_and_preserves_partial_effects() {
        let f = Fixture::new("file.txt").await; f.git(&["add", "--", "file.txt"]);
        let filter = f.directory.0.join("clean-filter.sh");
        std::fs::write(&filter, "#!/bin/sh\nIFS= read -r first\nIFS= read -r second\nif [ \"$second\" = 'line 1' ]; then\n  printf RESTORE_FILTER_STARTED >&2\n  touch ../filter-started\n  (sleep 3; touch ../late-filter-effect) &\n  wait\nfi\nprintf '%s\\n%s\\n' \"$first\" \"$second\"\ncat\n").unwrap();
        f.git(&["config", "filter.fixture.clean", &format!("/bin/sh '{}'", filter.to_str().unwrap().replace('\'', "'\\''"))]);
        f.git(&["config", "filter.fixture.required", "true"]);
        std::fs::write(f.root.join(".git/info/attributes"), "file.txt filter=fixture\n").unwrap();
        let request = approve_file("cancel-filter");
        let execution = f.file("revert", &request);
        let cancellation = async {
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                while !f.directory.0.join("filter-started").exists() { tokio::time::sleep(std::time::Duration::from_millis(20)).await; }
            }).await.expect("filter started after file replacement");
            let id: String = sqlx::query_scalar("SELECT id FROM workspace_write_runs WHERE status='running'").fetch_one(&f.db).await.unwrap();
            sqlx::query("UPDATE workspaces SET trusted=0").execute(&f.db).await.unwrap();
            assert!(!crate::workspace_write_runs::cancel(&f.db, "workspace", &id, "other").await.unwrap());
            assert!(crate::workspace_write_runs::cancel(&f.db, "workspace", &id, "main").await.unwrap());
        };
        let (result, ()) = tokio::join!(execution, cancellation);
        let error = result.unwrap_err(); assert!(error.is_write_outcome_unknown(), "{error}");
        assert!(error.to_string().contains("RESTORE_FILTER_STARTED"));
        assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(), f.baseline);
        assert_eq!(f.git(&["show", ":file.txt"]), f.changed);
        let row = sqlx::query("SELECT status,cancel_requested_at FROM workspace_write_runs").fetch_one(&f.db).await.unwrap();
        assert_eq!(row.get::<String,_>("status"), "outcome_unknown"); assert!(row.get::<Option<String>,_>("cancel_requested_at").is_some());
        tokio::time::sleep(std::time::Duration::from_millis(3200)).await;
        assert!(!f.directory.0.join("late-filter-effect").exists()); f.close().await;
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
    async fn truncated_turn_preview_marks_host_suffix_without_authorizing_a_patch() {
        let f = Fixture::new("file.txt").await;
        let line = "原文 {suffix}\n… diff 已截断\n";
        let content = line.repeat((256 * 1024 - 128) / line.len());
        assert!(content.len() > 200_000 && content.len() < 256 * 1024);
        std::fs::write(f.root.join("file.txt"), &content).unwrap();
        sqlx::query("UPDATE file_changes SET result_hash=?").bind(format!("sha256:{:x}",Sha256::digest(content.as_bytes()))).execute(&f.db).await.unwrap();
        let preview = crate::turn_changes::get_turn_file_diff("session".into(),"turn".into(),"file.txt".into(),&f.db,&f.directory.0).await.unwrap();
        assert!(preview.available);assert!(preview.diff.len() <= 200_000);assert!(preview.diff.ends_with("\n… diff 已截断"));
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,preview.localized_suffix.as_ref().unwrap()),"\n… diff truncated");
        assert!(preview.hunks.last().unwrap().content.ends_with("\n… diff 已截断"));
        let result = f.apply("revert",&approve("truncated-preview")).await.unwrap();
        assert!(!result.applied);assert_eq!(std::fs::read_to_string(f.root.join("file.txt")).unwrap(),content);
        assert_eq!(f.git(&["show",":file.txt"]),f.baseline);f.close().await;
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
            let display = output.localized_message.as_ref().unwrap();
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,display),output.message);
            assert_ne!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,display),output.message);
            if condition == "later-edit" {
                let preview = crate::turn_changes::get_turn_file_diff("session".into(),"turn".into(),"file.txt".into(),&f.db,&f.directory.0).await.unwrap();
                assert!(!preview.available);assert_eq!(preview.reason.as_deref(),Some(output.message.as_str()));
                assert_eq!(preview.localized_reason,output.localized_message);
            }
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

    #[tokio::test]
    async fn preview_and_write_share_evidence_checks_without_sharing_authorization() {
        for restriction in ["unknown", "renamed", "corrupt", "later-edit"] {
            let f = Fixture::new("review.txt").await;
            let preview = crate::turn_changes::get_turn_file_diff("session".into(), "turn".into(), f.path.clone(), &f.db, &f.directory.0).await.unwrap();
            assert!(preview.available);
            assert_eq!(preview.hunks.len(), 2);
            match restriction {
                "unknown" => { sqlx::query("UPDATE turn_change_sets SET attribution='unknown'").execute(&f.db).await.unwrap(); }
                "renamed" => { sqlx::query("UPDATE file_changes SET change_kind='renamed'").execute(&f.db).await.unwrap(); }
                "corrupt" => {
                    let checkpoint = crate::change_set::checkpoint_file_path(&f.directory.0.join("checkpoints"), "session", "turn", &f.path);
                    std::fs::create_dir_all(checkpoint.parent().unwrap()).unwrap();
                    std::fs::write(checkpoint, "corrupt baseline").unwrap();
                }
                "later-edit" => { std::fs::write(f.root.join(&f.path), "user edit after preview").unwrap(); }
                _ => unreachable!(),
            }
            let preview = crate::turn_changes::get_turn_file_diff("session".into(), "turn".into(), f.path.clone(), &f.db, &f.directory.0).await.unwrap();
            assert_eq!(preview.available, matches!(restriction, "unknown" | "renamed"), "{restriction}");
            let before = std::fs::read(f.root.join(&f.path)).unwrap();
            let result = f.apply("revert", &approve(restriction)).await.unwrap();
            assert!(!result.applied, "{restriction}");
            assert_eq!(std::fs::read(f.root.join(&f.path)).unwrap(), before);
            f.close().await;
        }
    }

}
