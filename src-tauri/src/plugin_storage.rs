//! Host-selected private storage, separate from immutable release packages.
//! Each release and instance owns its format directory; rollback never shares new data.
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(crate) fn directory(
    package: &Path,
    plugin: &str,
    installation: &str,
    instance: &str,
) -> Result<PathBuf, String> {
    let data = package
        .parent()
        .and_then(Path::parent)
        .ok_or("invalid storage root")?;
    let mut path = data.canonicalize().map_err(|_| "storage unavailable")?;
    for component in ["plugin-data", plugin, installation, "v1", instance] {
        if component.is_empty()
            || !component
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            || component == "."
            || component == ".."
        {
            return Err("invalid storage identity".into());
        }
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("unsafe storage directory".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&path).map_err(|_| "storage unavailable")?
            }
            Err(_) => return Err("storage unavailable".into()),
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
            .map_err(|_| "storage unavailable")?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(&owner).map_err(|_| "storage unavailable")?;
            if !metadata.is_file() || metadata.len() > 4096 {
                return Err("invalid storage owner".into());
            }
            let saved: serde_json::Value =
                serde_json::from_slice(&fs::read(&owner).map_err(|_| "storage unavailable")?)
                    .map_err(|_| "invalid storage owner")?;
            if saved != expected {
                return Err("storage owner mismatch".into());
            }
        }
        Err(_) => return Err("storage unavailable".into()),
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
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
