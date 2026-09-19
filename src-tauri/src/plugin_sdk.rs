//! One content-addressed public SDK per host build, outside installed plugin packages.
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}, sync::Mutex};

pub(crate) const VERSION: &str = "0.1.0";
static PREPARE: Mutex<()> = Mutex::new(());
const FILES: &[(&str, &[u8])] = &[
    ("register.mjs", include_bytes!("../../packages/plugin-host/register.mjs")),
    ("loader.mjs", include_bytes!("../../packages/plugin-host/loader.mjs")),
    ("sdk.json", include_bytes!("../../packages/plugin-host/sdk.json")),
];

fn verify(directory: &Path) -> Result<(), String> {
    if !fs::symlink_metadata(directory).map_err(|e| e.to_string())?.file_type().is_dir() {
        return Err("invalid_request: host SDK directory is not a regular directory".into());
    }
    for (name, bytes) in FILES {
        let path = directory.join(name);
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.file_type().is_file() || metadata.len() != bytes.len() as u64
            || fs::read(path).map_err(|e| e.to_string())? != *bytes {
            return Err("manifest_mismatch: host SDK integrity check failed".into());
        }
    }
    Ok(())
}

pub(crate) fn prepare(registry: &Path) -> Result<PathBuf, String> {
    let _lock = PREPARE.lock().map_err(|_| "internal: host SDK lock failed")?;
    let mut hash = Sha256::new();
    for (name, bytes) in FILES {
        hash.update(name.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    let destination = registry.join(format!(".host-sdk-{:x}", hash.finalize()));
    if !destination.try_exists().map_err(|e| e.to_string())? {
        let staging = registry.join(format!(".sdk-staging-{}", ulid::Ulid::new()));
        fs::create_dir(&staging).map_err(|e| e.to_string())?;
        let result = (|| {
            for (name, bytes) in FILES { fs::write(staging.join(name), bytes).map_err(|e| e.to_string())?; }
            match fs::rename(&staging, &destination) {
                Ok(()) => Ok(()),
                Err(_) if destination.exists() => verify(&destination),
                Err(error) => Err(error.to_string()),
            }
        })();
        let _ = fs::remove_dir_all(&staging);
        result?;
    }
    verify(&destination)?;
    Ok(destination.join("register.mjs"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_sdk_is_reused_and_tampering_is_rejected() {
        let root = std::env::temp_dir().join(format!("aibo-sdk-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let first = prepare(&root).unwrap();
        assert_eq!(prepare(&root).unwrap(), first);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let sdk: serde_json::Value = serde_json::from_slice(FILES[2].1).unwrap();
        assert_eq!(sdk["version"], VERSION);
        fs::write(first.parent().unwrap().join("sdk.json"), "{}").unwrap();
        assert!(prepare(&root).unwrap_err().contains("integrity"));
        fs::remove_dir_all(root).unwrap();
    }
}
