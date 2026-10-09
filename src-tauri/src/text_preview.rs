//! Shared bounded workspace text reads for search and answer-link previews.
use crate::CoreError;
use std::{io::Read, path::Path};
pub(crate) const MAX_TEXT: u64 = 2 * 1024 * 1024;
fn error(message: impl ToString) -> CoreError { CoreError::SessionOperation(message.to_string()) }

pub(crate) fn read_text(root: &Path, relative: &Path) -> Result<(String, bool), CoreError> {
    let path = crate::workspace_guard::canonicalize_target_message(root, relative).map_err(crate::ui_i18n::session_operation_message)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(error)?;
    if !file.metadata().map_err(error)?.is_file() {
        return Err(crate::ui_i18n::read_error("native.search.notRegular",serde_json::json!({})));
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    let truncated = bytes.len() as u64 > MAX_TEXT;
    if bytes.contains(&0) {
        return Err(crate::ui_i18n::read_error("native.search.binaryPreview",serde_json::json!({})));
    }
    if truncated {
        bytes.truncate(MAX_TEXT as usize);
        while std::str::from_utf8(&bytes).is_err() && bytes.len() > MAX_TEXT as usize - 4 {
            bytes.pop();
        }
    }
    let text = String::from_utf8(bytes).map_err(|_| crate::ui_i18n::read_error("native.search.notUtf8",serde_json::json!({})))?;
    Ok((text, truncated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui_i18n::{render, Locale};

    #[test]
    fn bounded_text_read_preserves_content_and_localizes_only_owned_errors() {
        let root = tempfile::tempdir().unwrap();
        for (name, bytes, key, diagnostic, english) in [
            ("binary", &b"a\0b"[..], "binaryPreview", "二进制文件不提供文本预览", "Text previews are unavailable for binary files."),
            ("invalid", &[0xff][..], "notUtf8", "文件不是 UTF-8 文本", "This file is not UTF-8 text."),
        ] {
            std::fs::write(root.path().join(name), bytes).unwrap();
            let error = read_text(root.path(), Path::new(name)).unwrap_err();
            let payload = serde_json::to_value(&error).unwrap();
            assert_eq!(payload["code"], "session_operation_error");
            assert_eq!(payload["message"], format!("session operation failed: {diagnostic}"));
            assert_eq!(payload["localized"]["key"], format!("native.search.{key}"));
            assert_eq!(render(Locale::En, &payload["localized"]), english);
            assert_eq!(render(Locale::ZhCn, &payload["localized"]), diagnostic);
            let warning = crate::ui_i18n::named_read_warning("文件 {warning}", &error);
            assert_eq!(warning.diagnostic, format!("文件 {{warning}}：{error}"));
            assert_eq!(render(Locale::En, warning.localized.as_ref().unwrap()), format!("文件 {{warning}}: {english}"));
        }
        let directory = read_text(root.path(), Path::new(".")).unwrap_err();
        assert_eq!(serde_json::to_value(directory).unwrap()["localized"]["key"], "native.search.notRegular");
        let content = "原始正文 {error} English\n";
        std::fs::write(root.path().join("text"), content).unwrap();
        assert_eq!(read_text(root.path(), Path::new("text")).unwrap(), (content.to_owned(), false));
        let missing = serde_json::to_value(read_text(root.path(), Path::new("missing")).unwrap_err()).unwrap();
        assert!(missing.get("localized").is_none(), "operating-system diagnostics remain literal");
    }

    #[test]
    fn bounded_text_read_keeps_utf8_boundary_and_rejects_workspace_escape() {
        let root = tempfile::tempdir().unwrap();
        let content = format!("{}中文", "a".repeat(MAX_TEXT as usize - 1));
        std::fs::write(root.path().join("large"), content).unwrap();
        let (text, truncated) = read_text(root.path(), Path::new("large")).unwrap();
        assert!(truncated);
        assert_eq!(text, "a".repeat(MAX_TEXT as usize - 1));
        let outside = tempfile::NamedTempFile::new().unwrap();
        assert!(read_text(root.path(), outside.path()).is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
            assert!(read_text(root.path(), Path::new("escape")).is_err());
        }
    }
}
