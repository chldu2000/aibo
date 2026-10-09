//! Unified text diffs shared by workspace inspection and turn changes.
use serde::Serialize;
use std::{
    env, fs,
    io::{self, Read},
    process::{Command, ExitStatus, Stdio},
    thread,
};
use ulid::Ulid;
pub(crate) const WORKSPACE_DIFF_MAX_BYTES: usize = 200_000;
const DIFF_TRUNCATION_SUFFIX: &str = "\n… diff 已截断";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDiffHunk {
    pub(crate) index: i64,
    pub(crate) header: String,
    pub(crate) content: String,
}

pub(crate) struct BoundedCommandOutput {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr: Vec<u8>,
}

/// Generate a unified text diff without treating the current Git HEAD as the
/// baseline. This preserves the distinction between pre-existing dirty files
/// and changes made by the selected turn, and also works in non-Git folders.
pub(crate) fn run_unified_text_diff(
    path: &str,
    baseline: &[u8],
    result: &[u8],
) -> Result<String, String> {
    run_unified_text_diff_bounded(path, baseline, result, usize::MAX).map(|(diff, _)| diff)
}

pub(crate) fn run_unified_text_diff_bounded(
    path: &str,
    baseline: &[u8],
    result: &[u8],
    max_output_bytes: usize,
) -> Result<(String, bool), String> {
    let id = Ulid::new();
    let directory = env::temp_dir();
    let baseline_path = directory.join(format!("aibo-diff-{id}-baseline"));
    let result_path = directory.join(format!("aibo-diff-{id}-result"));
    fs::write(&baseline_path, baseline).map_err(|error| format!("write diff baseline: {error}"))?;
    fs::write(&result_path, result).map_err(|error| format!("write diff result: {error}"))?;
    // Keep standard a/ and b/ prefixes so the same diff can be safely fed to
    // Git's patch machinery when hunk-level actions are added.
    let baseline_label = format!("a/{path}");
    let result_label = format!("b/{path}");
    let mut command = Command::new("git");
    let output = command_output_bounded(
        command
            .args([
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-color",
                "--unified=3",
                "--no-prefix",
            ])
            .arg(&baseline_path)
            .arg(&result_path),
        max_output_bytes.saturating_add(1),
    );
    let output = match output {
        Ok(output) => output,
        Err(error) => {
            let _ = fs::remove_file(&baseline_path);
            let _ = fs::remove_file(&result_path);
            return Err(format!("run unified diff: {error}"));
        }
    };
    let _ = fs::remove_file(&baseline_path);
    let _ = fs::remove_file(&result_path);
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!(
            "git diff --no-index exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let raw_diff = String::from_utf8_lossy(&output.stdout);
    let normalized = normalize_unified_diff_headers(&raw_diff, &baseline_label, &result_label);
    let truncated = output.stdout_truncated || normalized.len() > max_output_bytes;
    let diff = if truncated {
        truncate_diff_with_marker(&normalized, max_output_bytes)
    } else {
        normalized
    };
    Ok((diff, truncated))
}

pub(crate) fn truncate_diff_with_marker(content: &str, max_bytes: usize) -> String {
    if max_bytes == 0 {
        return String::new();
    }
    if DIFF_TRUNCATION_SUFFIX.len() >= max_bytes {
        return crate::artifact::truncate_utf8(DIFF_TRUNCATION_SUFFIX, max_bytes, "");
    }
    let content_limit = max_bytes - DIFF_TRUNCATION_SUFFIX.len();
    let mut truncated = crate::artifact::truncate_utf8(content, content_limit, "");
    truncated.push_str(DIFF_TRUNCATION_SUFFIX);
    truncated
}

pub(crate) fn normalize_unified_diff_headers(
    diff: &str,
    baseline_label: &str,
    result_label: &str,
) -> String {
    let mut normalized = String::with_capacity(diff.len());
    let mut file_header = true;
    let mut replaced_old_header = false;
    let mut replaced_new_header = false;
    let mut lines = diff.split('\n').peekable();
    while let Some(line) = lines.next() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if file_header && line.starts_with("diff --git ") {
            normalized.push_str("diff --git ");
            normalized.push_str(baseline_label);
            normalized.push(' ');
            normalized.push_str(result_label);
        } else if file_header && !replaced_old_header && line.starts_with("--- ") {
            normalized.push_str("--- ");
            normalized.push_str(baseline_label);
            replaced_old_header = true;
        } else if file_header && !replaced_new_header && line.starts_with("+++ ") {
            normalized.push_str("+++ ");
            normalized.push_str(result_label);
            replaced_new_header = true;
        } else {
            normalized.push_str(line);
        }
        if line.starts_with("@@ ") {
            file_header = false;
        }
        if lines.peek().is_some() {
            normalized.push('\n');
        }
    }
    normalized
}

pub(crate) fn parse_unified_hunks(diff: &str) -> Vec<TurnDiffHunk> {
    let mut hunks = Vec::new();
    let mut current_header: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();
    for line in diff.lines() {
        if line.starts_with("@@ ") {
            if let Some(header) = current_header.take() {
                hunks.push(TurnDiffHunk {
                    index: hunks.len() as i64,
                    header,
                    content: current_lines.join("\n"),
                });
                current_lines.clear();
            }
            current_header = Some(line.to_owned());
            current_lines.push(line);
        } else if current_header.is_some() {
            current_lines.push(line);
        }
    }
    if let Some(header) = current_header {
        hunks.push(TurnDiffHunk {
            index: hunks.len() as i64,
            header,
            content: current_lines.join("\n"),
        });
    }
    hunks
}

pub(crate) fn select_unified_hunk(diff: &str, hunk_index: usize) -> Result<String, crate::ui_i18n::HostMessage> {
    let lines: Vec<&str> = diff.lines().collect();
    let header_start = lines
        .iter()
        .position(|line| line.starts_with("--- "))
        .ok_or_else(|| crate::ui_i18n::HostMessage::new("native.diff.missingFileHeader",serde_json::json!({})))?;
    let plus_header = header_start + 1;
    if lines
        .get(plus_header)
        .map_or(true, |line| !line.starts_with("+++ "))
    {
        return Err(crate::ui_i18n::HostMessage::new("native.diff.missingTargetHeader",serde_json::json!({})));
    }
    let hunk_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| line.starts_with("@@ ").then_some(index))
        .collect();
    let Some(&start) = hunk_starts.get(hunk_index) else {
        return Err(crate::ui_i18n::HostMessage::new("native.diff.hunkOutOfRange",serde_json::json!({"index":hunk_index.to_string()})));
    };
    let end = hunk_starts
        .get(hunk_index + 1)
        .copied()
        .unwrap_or(lines.len());
    let mut patch = Vec::with_capacity(end - header_start + 1);
    patch.extend_from_slice(&lines[header_start..plus_header + 1]);
    patch.extend_from_slice(&lines[start..end]);
    Ok(format!("{}\n", patch.join("\n")))
}

pub(crate) fn command_output_bounded(
    command: &mut Command,
    stdout_limit: usize,
) -> io::Result<BoundedCommandOutput> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("Git stdout was not captured"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("Git stderr was not captured"))?;
    let stdout_task = thread::spawn(move || read_bounded(stdout, stdout_limit));
    let stderr_task = thread::spawn(move || read_bounded(stderr, 64 * 1024));
    let status = child.wait()?;
    let (stdout, stdout_truncated) = stdout_task
        .join()
        .map_err(|_| io::Error::other("Git stdout reader panicked"))??;
    let (stderr, _) = stderr_task
        .join()
        .map_err(|_| io::Error::other("Git stderr reader panicked"))??;
    Ok(BoundedCommandOutput {
        status,
        stdout,
        stdout_truncated,
        stderr,
    })
}

fn read_bounded<R: Read>(mut reader: R, limit: usize) -> io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    let mut truncated = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(bytes.len());
        if remaining > 0 {
            bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        if read > remaining {
            truncated = true;
        }
    }
    Ok((bytes, truncated))
}

#[cfg(test)]
mod tests {
    #[test]
    fn unified_diff_uses_turn_baseline_instead_of_head() {
        let diff = crate::text_diff::run_unified_text_diff(
            "src/main.rs",
            b"fn main() {\n  old();\n}\n",
            b"fn main() {\n  new();\n}\n",
        )
        .expect("unified diff");
        assert!(diff.contains("a/src/main.rs"));
        assert!(diff.contains("b/src/main.rs"));
        assert!(diff.contains("-  old();"));
        assert!(diff.contains("+  new();"));
        let hunks = crate::text_diff::parse_unified_hunks(&diff);
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].header.starts_with("@@ "));
        assert!(hunks[0].content.contains("+  new();"));
        let patch = crate::text_diff::select_unified_hunk(&diff, 0).expect("select hunk patch");
        assert!(patch.starts_with("--- a/src/main.rs\n+++ b/src/main.rs\n@@ "));
    }

    #[test]
    fn unified_diff_supports_an_empty_baseline_for_untracked_files() {
        let diff = crate::text_diff::run_unified_text_diff("new.txt", b"", b"new line\n")
            .expect("untracked file diff");
        assert!(diff.contains("--- a/new.txt"));
        assert!(diff.contains("+++ b/new.txt"));
        assert!(diff.contains("+new line"));
    }

    #[test]
    fn bounded_unified_diff_limits_large_output() {
        let result = vec![b'x'; 10_000];
        let (diff, truncated) =
            crate::text_diff::run_unified_text_diff_bounded("large.txt", b"", &result, 1_000)
                .expect("bounded diff");
        assert!(truncated);
        assert!(diff.len() <= 1_000);
        assert!(diff.ends_with("diff 已截断"));
    }
}

#[cfg(test)]
mod validation_display_tests {
    #[test]
    fn malformed_hunks_preserve_codes_diagnostics_and_explicit_display_metadata() {
        for (patch,index,raw,en) in [
            ("raw provider text",0,"diff 缺少文件头","The diff is missing its source file header."),
            ("--- a/{path}\n@@ hunk",0,"diff 缺少目标文件头","The diff is missing its target file header."),
            ("--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n-old\n+new",12,"hunk index 12 超出范围","Hunk index 12 is out of range."),
        ] {
            let error=super::select_unified_hunk(patch,index).unwrap_err();assert_eq!(error.diagnostic,raw);
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,error.localized.as_ref().unwrap()),en);
            let error=crate::ui_i18n::database_message(error);let value=serde_json::to_value(&error).unwrap();
            assert_eq!(value["code"],"database_error");assert_eq!(value["message"],format!("database error: {raw}"));
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&value["localized"]),raw);
        }
    }
}
