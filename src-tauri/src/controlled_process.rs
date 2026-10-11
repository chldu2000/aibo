//! Bounded process lifetime, including descendants that keep output pipes open.
use std::{io, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

pub(crate) struct ProcessResult {
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

struct ProcessGroup { pid: u32, completed: bool }
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe { libc::kill(-(self.pid as i32), libc::SIGKILL); }
        #[cfg(windows)]
        if !self.completed {
            // Normal completion has already reaped the PID. Only cancellation,
            // timeout or I/O failure needs this best-effort tree termination.
            if let Ok(mut cleanup) = crate::process_command::background("taskkill")
                .args(["/PID", &self.pid.to_string(), "/T", "/F"])
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
            {
                // Finish walking the tree before Child::drop/start_kill removes
                // its root. Bound this fallback, including owner-task abortion.
                let deadline = std::time::Instant::now() + Duration::from_secs(1);
                loop {
                    match cleanup.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) if std::time::Instant::now() < deadline => {
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        _ => { let _ = cleanup.kill(); let _ = cleanup.wait(); break; }
                    }
                }
            }
        }
    }
}

async fn reap(child: &mut tokio::process::Child) {
    let _ = child.start_kill();
    // Cleanup must not turn a process timeout into another unbounded wait.
    let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
}

async fn capture<R: tokio::io::AsyncRead + Unpin>(mut reader: R, bytes: &mut Vec<u8>, limit: usize) -> io::Result<()> {
    let mut buffer = [0; 8192];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 { return Ok(()); }
        let retained = count.min(limit.saturating_sub(bytes.len()));
        bytes.extend_from_slice(&buffer[..retained]);
    }
}

pub(crate) async fn execute(command: Command, timeout: Duration, output_limit: usize) -> io::Result<ProcessResult> {
    execute_cancellable(command, timeout, output_limit, std::future::pending()).await
}

pub(crate) async fn execute_cancellable(
    mut command: Command, timeout: Duration, output_limit: usize,
    cancellation: impl std::future::Future<Output = ()>,
) -> io::Result<ProcessResult> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    crate::isolate_process_tree(&mut command);
    let mut child = command.spawn()?;
    // Retain the process group ID even after wait() reaps the root process.
    let mut group = ProcessGroup { pid: child.id().expect("spawned process has an id"), completed: false };
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let mut result = ProcessResult { exit_code: None, success: false, timed_out: false, cancelled: false, stdout: Vec::new(), stderr: Vec::new() };
    let completion = tokio::select! {
        completion = tokio::time::timeout(timeout, async {
            tokio::try_join!(child.wait(), capture(stdout, &mut result.stdout, output_limit), capture(stderr, &mut result.stderr, output_limit))
        }) => Some(completion),
        _ = cancellation => None,
    };
    group.completed = matches!(&completion, Some(Ok(Ok(_))));
    drop(group);
    match completion {
        Some(Ok(Ok((status, (), ())))) => { result.exit_code = status.code(); result.success = status.success(); }
        Some(Ok(Err(error))) => { reap(&mut child).await; return Err(error); }
        Some(Err(_)) => { result.timed_out = true; reap(&mut child).await; }
        None => { result.cancelled = true; reap(&mut child).await; }
    }
    Ok(result)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn shell(script: &str) -> Command { let mut command = Command::new("sh"); command.args(["-c", script]); command }

    #[tokio::test]
    async fn deadline_includes_descendant_pipes_and_preserves_partial_output() {
        let result = tokio::time::timeout(Duration::from_secs(3), execute(shell("printf BEFORE_TIMEOUT; sleep 30 &"), Duration::from_millis(300), 1024)).await.unwrap().unwrap();
        assert!(result.timed_out);
        assert_eq!(result.stdout, b"BEFORE_TIMEOUT");
    }

    #[tokio::test]
    async fn output_is_bounded_without_blocking_a_noisy_process() {
        let result = execute(shell("head -c 200000 /dev/zero; printf ERROR >&2"), Duration::from_secs(3), 100).await.unwrap();
        assert!(result.success);
        assert_eq!(result.stdout.len(), 100);
        assert_eq!(result.stderr, b"ERROR");
    }

    #[tokio::test]
    async fn aborting_the_owner_stops_descendant_side_effects() {
        let root = std::env::temp_dir().join(format!("aibo-process-{}", ulid::Ulid::new()));
        std::fs::create_dir(&root).unwrap();
        let mut command = shell("touch ready; (sleep 1; touch escaped) & wait"); command.current_dir(&root);
        let owner = tokio::spawn(execute(command, Duration::from_secs(30), 100));
        tokio::time::timeout(Duration::from_secs(3), async { while !root.join("ready").exists() { tokio::time::sleep(Duration::from_millis(10)).await; } }).await.unwrap();
        assert!(!root.join("escaped").exists(), "descendant side effect occurred before cancellation");
        owner.abort(); let _ = owner.await;
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(!root.join("escaped").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::path::Path;

    fn fixture(action: &str, directory: &Path) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "controlled_process::windows_tests::child_fixture", "--nocapture"])
            .env("AIBO_PROCESS_TEST_ACTION", action).current_dir(directory);
        command
    }

    // A separate copy of the test process gives these tests real Windows
    // children without depending on shell quoting, Node or a network service.
    #[test]
    fn child_fixture() {
        let Ok(action) = std::env::var("AIBO_PROCESS_TEST_ACTION") else { return; };
        match action.as_str() {
            "output" => {
                #[link(name = "kernel32")]
                extern "system" { fn GetConsoleWindow() -> *mut std::ffi::c_void; }
                assert!(unsafe { GetConsoleWindow() }.is_null(), "background child has a console");
                println!("{}", "x".repeat(200_000));
                eprint!("CHILD_STDERR");
            }
            "normal" => {
                let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
                for _ in 0..3 {
                    let result = runtime.block_on(execute(fixture("output", Path::new(".")), Duration::from_secs(5), 100)).unwrap();
                    assert!(result.success);
                    assert_eq!(result.stdout.len(), 100);
                    assert_eq!(result.stderr, b"CHILD_STDERR");
                }
                // Catch cleanup commands that wrongly inherit this process's stderr.
                std::thread::sleep(Duration::from_millis(300));
            }
            "tree" => {
                let mut descendant = crate::process_command::background(std::env::current_exe().unwrap());
                descendant.args(["--exact", "controlled_process::windows_tests::child_fixture", "--nocapture"])
                    .env("AIBO_PROCESS_TEST_ACTION", "delayed-write");
                let mut child = descendant.spawn().unwrap();
                std::fs::write("ready", b"ready").unwrap();
                let _ = child.wait();
            }
            "delayed-write" => {
                std::thread::sleep(Duration::from_millis(1500));
                std::fs::write("escaped", b"escaped").unwrap();
            }
            _ => panic!("unknown fixture action"),
        }
    }

    async fn ready(root: &Path) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !root.join("ready").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("fixture started");
    }

    #[test]
    fn normal_completion_is_quiet_and_children_have_no_console() {
        let root = tempfile::tempdir().unwrap();
        let mut command = crate::process_command::background(std::env::current_exe().unwrap());
        let output = command.args(["--exact", "controlled_process::windows_tests::child_fixture", "--nocapture"])
            .env("AIBO_PROCESS_TEST_ACTION", "normal").current_dir(root.path()).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
        assert!(output.stderr.is_empty(), "{}", String::from_utf8_lossy(&output.stderr));
    }

    #[tokio::test]
    async fn cancellation_stops_descendant_side_effects() {
        let root = tempfile::tempdir().unwrap();
        let result = execute_cancellable(fixture("tree", root.path()), Duration::from_secs(10), 1024, ready(root.path())).await.unwrap();
        assert!(result.cancelled);
        tokio::time::sleep(Duration::from_millis(1800)).await;
        assert!(!root.path().join("escaped").exists());
    }

    #[tokio::test]
    async fn timeout_stops_descendant_side_effects() {
        let root = tempfile::tempdir().unwrap();
        let result = execute(fixture("tree", root.path()), Duration::from_millis(700), 1024).await.unwrap();
        assert!(root.path().join("ready").exists());
        assert!(result.timed_out);
        tokio::time::sleep(Duration::from_millis(1800)).await;
        assert!(!root.path().join("escaped").exists());
    }

    #[tokio::test]
    async fn aborting_owner_stops_descendant_side_effects() {
        let root = tempfile::tempdir().unwrap();
        let owner = tokio::spawn(execute(fixture("tree", root.path()), Duration::from_secs(10), 1024));
        ready(root.path()).await;
        owner.abort();
        let _ = owner.await;
        tokio::time::sleep(Duration::from_millis(1800)).await;
        assert!(!root.path().join("escaped").exists());
    }
}
