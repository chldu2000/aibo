//! Shared bounded workspace text reads for search and answer-link previews.
use crate::CoreError;
use std::{io::Read, path::Path};
pub(crate) const MAX_TEXT: u64 = 2 * 1024 * 1024;
fn error(message: impl ToString) -> CoreError { CoreError::SessionOperation(message.to_string()) }

pub(crate) fn read_text(root: &Path, relative: &Path) -> Result<(String, bool), CoreError> {
    let path = crate::workspace_guard::canonicalize_target(root, relative).map_err(error)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(error)?;
    if !file.metadata().map_err(error)?.is_file() {
        return Err(error("此路径不是普通文件"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    let truncated = bytes.len() as u64 > MAX_TEXT;
    if bytes.contains(&0) {
        return Err(error("二进制文件不提供文本预览"));
    }
    if truncated {
        bytes.truncate(MAX_TEXT as usize);
        while std::str::from_utf8(&bytes).is_err() && bytes.len() > MAX_TEXT as usize - 4 {
            bytes.pop();
        }
    }
    let text = String::from_utf8(bytes).map_err(|_| error("文件不是 UTF-8 文本"))?;
    Ok((text, truncated))
}
