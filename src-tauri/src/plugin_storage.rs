//! Host-selected private storage, separate from immutable release packages.
//! Each release and instance owns its format directory; rollback never shares new data.
use serde_json::json;
use crate::ui_i18n::HostMessage;
fn owned(key: &str, diagnostic: &str) -> HostMessage {
    HostMessage::with_diagnostic(key,json!({}),diagnostic)
}
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(crate) fn directory_display(
    package: &Path,
    plugin: &str,
    installation: &str,
    instance: &str,
) -> Result<PathBuf, HostMessage> {
    let data = package
        .parent()
        .and_then(Path::parent)
        .ok_or_else(||owned("native.storage.root","invalid storage root"))?;
    let mut path = data.canonicalize().map_err(|_| owned("native.storage.unavailable","storage unavailable"))?;
    for component in ["plugin-data", plugin, installation, "v1", instance] {
        if component.is_empty()
            || !component
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            || component == "."
            || component == ".."
        {
            return Err(owned("native.storage.identity","invalid storage identity"));
        }
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(owned("native.storage.directory","unsafe storage directory"))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&path).map_err(|_| owned("native.storage.unavailable","storage unavailable"))?
            }
            Err(_) => return Err(owned("native.storage.unavailable","storage unavailable")),
        }
    }
    let owner = path.join("owner.json");
    let expected = json!({"schema":"aibo.plugin-data/v1","formatVersion":1,"pluginId":plugin,"installationId":installation,"instanceId":instance});
    use std::io::Write;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&owner)
    {
        Ok(mut file) => file
            .write_all(expected.to_string().as_bytes())
            .map_err(|_| owned("native.storage.unavailable","storage unavailable"))?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(&owner).map_err(|_| owned("native.storage.unavailable","storage unavailable"))?;
            if !metadata.is_file() || metadata.len() > 4096 {
                return Err(owned("native.storage.owner","invalid storage owner"));
            }
            let saved: serde_json::Value =
                serde_json::from_slice(&fs::read(&owner).map_err(|_| owned("native.storage.unavailable","storage unavailable"))?)
                    .map_err(|_| owned("native.storage.owner","invalid storage owner"))?;
            if saved != expected {
                return Err(owned("native.storage.ownerMismatch","storage owner mismatch"));
            }
        }
        Err(_) => return Err(owned("native.storage.unavailable","storage unavailable")),
    }
    Ok(path)
}

/// Legacy protocol consumers retain the same string diagnostics.
pub(crate) fn directory(package: &Path, plugin: &str, installation: &str, instance: &str) -> Result<PathBuf,String> {
    directory_display(package,plugin,installation,instance).map_err(|error|error.diagnostic)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_display_preserves_owner_records_and_cache_across_rejections() {
        let root = tempfile::tempdir().unwrap();
        let package = root.path().join("plugins/release");
        fs::create_dir_all(&package).unwrap();
        let data = directory_display(&package,"dev.test","release","instance").unwrap();
        let owner = data.join("owner.json");
        let original = fs::read(&owner).unwrap();
        fs::write(data.join("cache"),b"cache unchanged").unwrap();
        for (path,plugin,key,diagnostic) in [
            (Path::new("/"),"dev.test","root","invalid storage root"),
            (root.path().join("missing/plugins/release").as_path(),"dev.test","unavailable","storage unavailable"),
            (package.as_path(),"../escape","identity","invalid storage identity"),
        ] {
            let error = directory_display(path,plugin,"release","instance").unwrap_err();
            assert_eq!(error.diagnostic,diagnostic);
            assert_eq!(error.localized.as_ref().unwrap()["key"],format!("native.storage.{key}"));
            assert_eq!(directory(path,plugin,"release","instance").unwrap_err(),diagnostic);
        }
        for (bytes,key,diagnostic) in [
            (b"invalid json".as_slice(),"owner","invalid storage owner"),
            (b"{}".as_slice(),"ownerMismatch","storage owner mismatch"),
        ] {
            fs::write(&owner,bytes).unwrap();
            let error = directory_display(&package,"dev.test","release","instance").unwrap_err();
            assert_eq!(error.diagnostic,diagnostic);
            assert_eq!(error.localized.as_ref().unwrap()["key"],format!("native.storage.{key}"));
            assert_ne!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),diagnostic);
            assert_eq!(fs::read(&owner).unwrap(),bytes);
            assert_eq!(fs::read(data.join("cache")).unwrap(),b"cache unchanged");
        }
        fs::write(&owner,&original).unwrap();
        assert_eq!(directory_display(&package,"dev.test","release","instance").unwrap(),data);
        assert_eq!(fs::read(&owner).unwrap(),original);
        #[cfg(unix)] {
            std::os::unix::fs::symlink(&data,root.path().join("plugin-data/evil")).unwrap();
            let error = directory_display(&package,"evil","release","instance").unwrap_err();
            assert_eq!(error.diagnostic,"unsafe storage directory");
            assert_eq!(error.localized.as_ref().unwrap()["key"],"native.storage.directory");
            assert_eq!(fs::read(&owner).unwrap(),original);
        }
        assert!(!root.path().join("escape").exists());
        assert_eq!(fs::read(data.join("cache")).unwrap(),b"cache unchanged");
    }
    #[test]
    fn storage_is_versioned_isolated_and_rejects_links() {
        let root = std::env::temp_dir().join(format!("aibo-storage-{}", ulid::Ulid::new()));
        let package = root.join("plugins/release");
        fs::create_dir_all(&package).unwrap();
        let first = directory(&package, "dev.test", "release", "instance").unwrap();
        fs::write(first.join("cache"), "old").unwrap();
        assert_eq!(
            directory(&package, "dev.test", "release", "instance").unwrap(),
            first
        );
        let newer = directory(&package, "dev.test", "new-release", "instance").unwrap();
        assert!(!newer.join("cache").exists());
        assert!(!first.starts_with(&package));
        fs::remove_dir_all(&package).unwrap();
        assert_eq!(fs::read_to_string(first.join("cache")).unwrap(), "old");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&first, root.join("plugin-data/evil")).unwrap();
            assert!(directory(&package, "evil", "release", "instance").is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
