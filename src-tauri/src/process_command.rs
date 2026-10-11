//! Platform defaults for non-interactive host commands.
use std::{ffi::OsStr, path::PathBuf, process::Command};
#[cfg(windows)]
use std::path::Path;

pub(crate) fn background(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    hide_window(&mut command);
    command
}

pub(crate) fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = command;
}

pub(crate) fn find_in_path(name: &str, search_path: &OsStr) -> Option<PathBuf> {
    for directory in std::env::split_paths(search_path) {
        #[cfg(windows)]
        {
            // npm installs a Unix shell shim beside its Windows .cmd launcher.
            // A regular file without an extension is not a Windows executable.
            let extensions = ["exe", "com", "cmd", "bat"];
            if Path::new(name).extension().is_some_and(|extension|
                extensions.iter().any(|allowed| extension.eq_ignore_ascii_case(allowed)))
            {
                let candidate = directory.join(name);
                if crate::is_executable(&candidate) { return Some(candidate); }
            } else {
                for extension in extensions {
                    let candidate = directory.join(format!("{name}.{extension}"));
                    if crate::is_executable(&candidate) { return Some(candidate); }
                }
            }
        }
        #[cfg(not(windows))]
        {
            let candidate = directory.join(name);
            if crate::is_executable(&candidate) { return Some(candidate); }
        }
    }
    None
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_npm_shim_resolves_and_runs_from_a_path_with_spaces() {
        let root = tempfile::Builder::new().prefix("aibo command ").tempdir().unwrap();
        std::fs::write(root.path().join("example"), "#!/bin/sh\necho wrong\n").unwrap();
        let script = root.path().join("example.cmd");
        std::fs::write(&script, "@echo off\r\necho version 1.2.3\r\n").unwrap();
        let search = std::env::join_paths([root.path()]).unwrap();
        let resolved = find_in_path("example", &search).unwrap();
        assert_eq!(resolved, script);
        // Rust's Command handles .cmd/.bat invocation and argument escaping.
        let output = background(&resolved).arg("--version").output().unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "version 1.2.3");
        assert_eq!(find_in_path("example.cmd", &search), Some(script.clone()));
        std::fs::remove_file(script).unwrap();
        assert!(find_in_path("example", &search).is_none());
    }

    #[test]
    fn windows_native_executable_takes_precedence_over_batch_shim() {
        let root = tempfile::tempdir().unwrap();
        for name in ["example", "example.cmd", "example.exe"] {
            std::fs::write(root.path().join(name), "fixture").unwrap();
        }
        let search = std::env::join_paths([root.path()]).unwrap();
        assert_eq!(find_in_path("example", &search), Some(root.path().join("example.exe")));
    }
}
