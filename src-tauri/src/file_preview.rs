use crate::CoreError;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreview {
    path: String,
    content: String,
    start_line: usize,
    total_lines: usize,
    truncated: bool,
    target_line: usize,
}

pub(crate) fn read(root: &Path, path: &Path, line: Option<u32>) -> Result<FilePreview, CoreError> {
    let canonical = crate::workspace_guard::canonicalize_target_message(root, path).map_err(crate::ui_i18n::session_operation_message)?;
    let (content, truncated) = crate::text_preview::read_text(root, &canonical)?;
    let lines: Vec<_> = content.split('\n').collect();
    let target = line.unwrap_or(1) as usize;
    if target == 0 || target > lines.len() {
        return Err(crate::ui_i18n::read_error(if truncated { "native.search.lineBeyondPreview" } else { "native.search.lineBeyondFile" }, serde_json::json!({})));
    }
    // Bound rendered rows, retaining the true line numbers around the requested location.
    let start = target.saturating_sub(101);
    let end = (start + 400).min(lines.len());
    Ok(FilePreview {
        path: canonical.to_string_lossy().into_owned(),
        content: lines[start..end].join("\n"), start_line: start + 1,
        total_lines: lines.len(), truncated, target_line: target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_preview_reads_absolute_and_relative_paths_with_bounded_rows() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("文件 name.ts");
        std::fs::write(&file, (1..=1200).map(|n| format!("line {n}")).collect::<Vec<_>>().join("\n")).unwrap();
        let preview = read(root.path(), Path::new("文件 name.ts"), Some(800)).unwrap();
        assert_eq!(preview.target_line, 800);
        assert_eq!(preview.start_line, 700);
        assert_eq!(preview.total_lines, 1200);
        assert_eq!(preview.content.lines().count(), 400);
        assert_eq!(preview.content.lines().nth(100), Some("line 800"));
        assert!(read(root.path(), &file, None).is_ok());
        let error = serde_json::to_value(read(root.path(), &file, Some(1201)).unwrap_err()).unwrap();
        assert_eq!(error["message"], "session operation failed: 目标行超出文件范围");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &error["localized"]), "The requested line is outside the file.");
        assert!(read(root.path(), &file, Some(0)).is_err());
    }
    #[test]
    fn file_preview_rejects_escape_directory_missing_binary_and_non_utf8() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        assert!(read(root.path(), outside.path(), None).is_err());
        assert!(read(root.path(), Path::new("../outside"), None).is_err());
        assert!(read(root.path(), Path::new("."), None).is_err());
        assert!(read(root.path(), Path::new("missing"), None).is_err());
        for bytes in [&b"a\0b"[..], &[0xff][..]] {
            std::fs::write(root.path().join("bad"), bytes).unwrap();
            assert!(read(root.path(), Path::new("bad"), None).is_err());
        }
        #[cfg(unix)] {
            std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
            assert!(read(root.path(), Path::new("escape"), None).is_err());
        }
    }
    #[test]
    fn file_preview_reports_byte_limit_and_does_not_claim_unread_lines() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("large"), "x\n".repeat(1024 * 1024 + 100)).unwrap();
        let preview = read(root.path(), Path::new("large"), None).unwrap();
        assert!(preview.truncated);
        assert_eq!(preview.content.lines().count(), 400);
        let error = serde_json::to_value(read(root.path(), Path::new("large"), Some(2_000_000)).unwrap_err()).unwrap();
        assert_eq!(error["code"], "session_operation_error");
        assert_eq!(error["message"], "session operation failed: 目标行超出文本预览的 2 MiB 读取范围");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &error["localized"]), "The requested line is beyond the 2 MiB text preview limit.");
    }
}
