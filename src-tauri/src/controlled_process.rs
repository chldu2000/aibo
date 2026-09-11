//! Bounded process lifetime, including descendants that keep output pipes open.
use std::{io, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

pub(crate) struct ProcessResult {
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

struct ProcessGroup(u32);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe { libc::kill(-(self.0 as i32), libc::SIGKILL); }
        #[cfg(windows)]
        { let _ = std::process::Command::new("taskkill").args(["/PID", &self.0.to_string(), "/T", "/F"]).spawn(); }
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

pub(crate) async fn execute(mut command: Command, timeout: Duration, output_limit: usize) -> io::Result<ProcessResult> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    crate::isolate_process_tree(&mut command);
    let mut child = command.spawn()?;
    // Retain the process group ID even after wait() reaps the root process.
    let group = ProcessGroup(child.id().expect("spawned process has an id"));
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let mut result = ProcessResult { exit_code: None, success: false, timed_out: false, stdout: Vec::new(), stderr: Vec::new() };
    let completion = tokio::time::timeout(timeout, async {
        tokio::try_join!(child.wait(), capture(stdout, &mut result.stdout, output_limit), capture(stderr, &mut result.stderr, output_limit))
    }).await;
    drop(group);
    match completion {
        Ok(Ok((status, (), ()))) => { result.exit_code = status.code(); result.success = status.success(); }
        Ok(Err(error)) => { reap(&mut child).await; return Err(error); }
        Err(_) => { result.timed_out = true; reap(&mut child).await; }
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
        owner.abort(); let _ = owner.await;
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(!root.join("escaped").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
