use crate::plugin_contract::contracts;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{collections::HashSet, fs, io::Read, path::{Component, Path, PathBuf}};
use tokio::sync::Mutex;

static INSTALL_LOCK: Mutex<()> = Mutex::const_new(());
const MAX_PACKAGE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallation {
    pub id: String,
    pub plugin_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub enabled: bool,
    pub installed: bool,
    pub manifest: Value,
}

pub(crate) fn platform() -> String {
    format!("{}-{}", if cfg!(target_os = "windows") { "windows" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" },
        if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" })
}

fn io_error(_: impl std::fmt::Display) -> String { "invalid_request: plugin package could not be read or installed".into() }

fn package_path(root: &Path, raw: &str) -> Result<PathBuf, String> {
    if raw.contains('\\') || raw.contains(':') || raw.split('/').any(|part| part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' '])) {
        return Err("invalid_request: unsafe package path".into());
    }
    let path = Path::new(raw);
    if !path.components().all(|component| matches!(component, Component::Normal(_))) { return Err("invalid_request: unsafe package path".into()); }
    let resolved = root.join(path).canonicalize().map_err(io_error)?;
    if !resolved.starts_with(root) || !resolved.is_file() { return Err("invalid_request: package path escapes root".into()); }
    Ok(resolved)
}

fn files(root: &Path, directory: &Path, result: &mut Vec<PathBuf>, size: &mut u64) -> Result<(), String> {
    if directory.strip_prefix(root).map_err(io_error)?.components().count() > 16 { return Err("invalid_request: package nesting limit".into()); }
    for entry in fs::read_dir(directory).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
        if metadata.file_type().is_symlink() { return Err("invalid_request: links are not allowed in packages".into()); }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 { return Err("invalid_request: reparse points are not allowed".into()); }
        }
        if metadata.is_dir() { files(root, &entry.path(), result, size)?; }
        else if metadata.is_file() {
            *size = size.checked_add(metadata.len()).ok_or("invalid_request: package too large")?;
            if *size > MAX_PACKAGE_BYTES || result.len() >= 4096 { return Err("invalid_request: package limit exceeded".into()); }
            let relative = entry.path().strip_prefix(root).map_err(io_error)?.to_path_buf();
            package_path(root, &relative.to_string_lossy().replace('\\', "/"))?;
            result.push(relative);
        } else { return Err("invalid_request: package contains special file".into()); }
    }
    Ok(())
}

fn hash_file(path: &Path, digest: &mut Sha256) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(io_error)?;
    let mut bytes = [0u8; 16384];
    loop {
        let count = file.read(&mut bytes).map_err(io_error)?;
        if count == 0 { break; }
        digest.update(&bytes[..count]);
    }
    Ok(())
}

pub(crate) fn inspect(root: &Path) -> Result<(Value, Vec<PathBuf>, String), String> {
    let mut entries = Vec::new();
    files(root, root, &mut entries, &mut 0)?;
    entries.sort();
    let manifest_path = package_path(root, "plugin.json")?;
    if fs::metadata(&manifest_path).map_err(io_error)?.len() > 1_048_576 { return Err("invalid_request: manifest too large".into()); }
    let manifest: Value = serde_json::from_slice(&fs::read(manifest_path).map_err(io_error)?).map_err(io_error)?;
    if !contracts().manifest.is_valid(&manifest) { return Err("invalid_request: manifest schema validation failed".into()); }
    if !manifest["platforms"].as_array().unwrap().iter().any(|p| p == &platform()) { return Err("protocol_incompatible: package platform".into()); }
    for name in ["runtime", "view"] {
        let range = &manifest["protocols"][name];
        if range.is_null() && name == "view" { continue; }
        // Initial host implements exactly v1.0; reject unsupported major/minor bounds.
        if range["min"] != "1.0" || range["max"] != "1.0" { return Err("protocol_incompatible: supported protocol is 1.0".into()); }
    }
    package_path(root, manifest["entrypoint"]["executable"].as_str().unwrap())?;
    let mut ids = HashSet::new();
    for agent in manifest["agents"].as_array().unwrap() {
        if !ids.insert(agent["agentId"].as_str().unwrap()) { return Err("manifest_mismatch: duplicate Agent ID".into()); }
    }
    if let Some(resources) = manifest["resources"].as_array() {
        for resource in resources {
            let path = package_path(root, resource["path"].as_str().unwrap())?;
            let mut hash = Sha256::new(); hash_file(&path, &mut hash)?;
            if format!("{:x}", hash.finalize()) != resource["sha256"].as_str().unwrap() { return Err("manifest_mismatch: resource digest".into()); }
        }
    }
    let mut digest = Sha256::new();
    for entry in &entries {
        let name = entry.to_string_lossy().replace('\\', "/");
        digest.update((name.len() as u64).to_le_bytes()); digest.update(name.as_bytes());
        digest.update(fs::metadata(root.join(entry)).map_err(io_error)?.len().to_le_bytes());
        hash_file(&root.join(entry), &mut digest)?;
    }
    Ok((manifest, entries, format!("{:x}", digest.finalize())))
}

pub(crate) async fn list(db: &SqlitePool) -> Result<Vec<PluginInstallation>, String> {
    let rows = sqlx::query("SELECT id, plugin_id, plugin_version, package_digest, enabled, installed, manifest_json FROM plugin_installations ORDER BY created_at, id")
        .fetch_all(db).await.map_err(|e| e.to_string())?;
    rows.into_iter().map(|row| Ok(PluginInstallation { id: row.get("id"), plugin_id: row.get("plugin_id"), plugin_version: row.get("plugin_version"),
        package_digest: row.get("package_digest"), enabled: row.get::<i64, _>("enabled") != 0,
        installed: row.get::<i64, _>("installed") != 0,
        manifest: serde_json::from_str(row.get::<&str, _>("manifest_json")).map_err(io_error)? })).collect()
}

pub(crate) async fn install(db: &SqlitePool, data_dir: &Path, source: &Path) -> Result<PluginInstallation, String> {
    let _lock = INSTALL_LOCK.lock().await;
    let source = source.canonicalize().map_err(io_error)?;
    let registry = data_dir.join("plugins");
    fs::create_dir_all(&registry).map_err(io_error)?;
    let registry = registry.canonicalize().map_err(io_error)?;
    if source.starts_with(&registry) || registry.starts_with(&source) { return Err("invalid_request: package and registry must be separate".into()); }
    let (manifest, entries, expected_digest) = inspect(&source)?;
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM plugin_installations WHERE plugin_id=? AND plugin_version=? AND package_digest=? AND installed=0")
        .bind(manifest["pluginId"].as_str().unwrap()).bind(manifest["version"].as_str().unwrap()).bind(&expected_digest)
        .fetch_optional(db).await.map_err(io_error)?;
    let id = existing.unwrap_or_else(|| ulid::Ulid::new().to_string());
    let staging = registry.join(format!(".staging-{id}"));
    let destination = registry.join(&id);
    fs::create_dir(&staging).map_err(io_error)?;
    let copy_result = (|| {
        for entry in entries {
            let target = staging.join(&entry);
            fs::create_dir_all(target.parent().unwrap()).map_err(io_error)?;
            fs::copy(source.join(&entry), target).map_err(io_error)?;
        }
        let (_, _, actual_digest) = inspect(&staging)?;
        if actual_digest != expected_digest { return Err("manifest_mismatch: package changed during copy".into()); }
        Ok::<(), String>(())
    })();
    if let Err(error) = copy_result { let _ = fs::remove_dir_all(&staging); return Err(error); }
    let persist = async {
        let mut transaction = db.begin().await.map_err(io_error)?;
        for agent in manifest["agents"].as_array().unwrap() {
            let conflict: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_contributions a JOIN plugin_installations p ON a.installation_id = p.id WHERE a.agent_id = ? AND p.plugin_id <> ?")
                .bind(agent["agentId"].as_str().unwrap()).bind(manifest["pluginId"].as_str().unwrap()).fetch_one(&mut *transaction).await.map_err(io_error)?;
            if conflict != 0 { return Err("manifest_mismatch: Agent ID belongs to another plugin".into()); }
        }
        let restored = sqlx::query("UPDATE plugin_installations SET source=?,install_path=?,manifest_json=?,installed=1,enabled=0,enabled_at=NULL,removed_at=NULL WHERE id=? AND installed=0")
            .bind(source.to_string_lossy().as_ref()).bind(destination.to_string_lossy().as_ref()).bind(manifest.to_string()).bind(&id)
            .execute(&mut *transaction).await.map_err(io_error)?.rows_affected() == 1;
        if !restored {
            sqlx::query("INSERT INTO plugin_installations (id, plugin_id, plugin_version, package_digest, source, install_path, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(&id).bind(manifest["pluginId"].as_str().unwrap()).bind(manifest["version"].as_str().unwrap()).bind(&expected_digest)
                .bind(source.to_string_lossy().as_ref()).bind(destination.to_string_lossy().as_ref()).bind(manifest.to_string()).bind(crate::now_iso())
                .execute(&mut *transaction).await.map_err(io_error)?;
            for agent in manifest["agents"].as_array().unwrap() {
                sqlx::query("INSERT INTO agent_contributions (installation_id, agent_id, metadata_json) VALUES (?, ?, ?)")
                    .bind(&id).bind(agent["agentId"].as_str().unwrap()).bind(agent.to_string()).execute(&mut *transaction).await.map_err(io_error)?;
            }
        }
        fs::rename(&staging, &destination).map_err(io_error)?;
        transaction.commit().await.map_err(io_error)?;
        Ok::<(), String>(())
    }.await;
    if let Err(error) = persist { let _ = fs::remove_dir_all(&staging); let _ = fs::remove_dir_all(&destination); return Err(error); }
    Ok(PluginInstallation { id, plugin_id: manifest["pluginId"].as_str().unwrap().into(), plugin_version: manifest["version"].as_str().unwrap().into(),
        package_digest: expected_digest, enabled: false, installed: true, manifest })
}

pub(crate) async fn enable(db: &SqlitePool, id: &str, enabled: bool) -> Result<(), String> {
    let changed = sqlx::query("UPDATE plugin_installations SET enabled = ?, enabled_at = ? WHERE id = ? AND installed=1")
        .bind(enabled).bind(if enabled { Some(crate::now_iso()) } else { None }).bind(id).execute(db).await.map_err(io_error)?;
    if changed.rows_affected() != 1 { return Err("invalid_request: installation not found".into()); }
    Ok(())
}

pub(crate) async fn uninstall(db: &SqlitePool, data_dir: &Path, id: &str) -> Result<(), String> {
    let _lock = INSTALL_LOCK.lock().await;
    let row = sqlx::query("SELECT install_path, installed FROM plugin_installations WHERE id=?")
        .bind(id).fetch_optional(db).await.map_err(io_error)?
        .ok_or("invalid_request: installation not found")?;
    if row.get::<i64, _>("installed") == 0 { return Err("invalid_request: plugin is already uninstalled".into()); }
    let path = PathBuf::from(row.get::<String, _>("install_path"));
    let registry = data_dir.join("plugins").canonicalize().map_err(io_error)?;
    let parent = path.parent().ok_or("invalid_request: invalid installation path")?;
    if parent != registry || path.file_name().and_then(|name|name.to_str()) != Some(id) {
        return Err("invalid_request: installation path escapes registry".into());
    }
    let trash = parent.join(format!(".removing-{id}"));
    if path.exists() { fs::rename(&path, &trash).map_err(io_error)?; }
    let result = sqlx::query("UPDATE plugin_installations SET installed=0,enabled=0,enabled_at=NULL,removed_at=? WHERE id=? AND installed=1")
        .bind(crate::now_iso()).bind(id).execute(db).await.map_err(io_error);
    match result {
        Ok(changed) if changed.rows_affected() == 1 => {
            if trash.exists() { fs::remove_dir_all(trash).map_err(io_error)?; }
            Ok(())
        }
        _ => {
            if trash.exists() { let _ = fs::rename(&trash, &path); }
            Err("invalid_request: plugin uninstall failed".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Connection;

    #[test]
    fn rejects_escaping_and_ambiguous_package_paths() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        for raw in ["../secret", "/etc/passwd", "C:/secret", "dir\\file", "a/../b", "./plugin.json", "a//b", "file:stream", "trailing."] {
            assert!(package_path(&root, raw).is_err(), "{raw}");
        }
    }

    #[tokio::test]
    async fn session_migration_preserves_old_history_and_allows_external_identity() {
        let mut connection = sqlx::SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(false)).await.unwrap();
        let migrations = sqlx::migrate!("./migrations");
        for migration in migrations.iter().filter(|m|m.version < 20) {
            let mut transaction = connection.begin().await.unwrap();
            sqlx::raw_sql(&migration.sql).execute(&mut *transaction).await.unwrap();
            transaction.commit().await.unwrap();
        }
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,created_at,updated_at) VALUES('w','/old','old','2026','2026');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('s','w','codex','history','idle','2026','2026');
            INSERT INTO session_bindings(session_id,external_session_id,bound_at) VALUES('s','native-old','2026');
            INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES('t','s','native-turn','completed','2026');
            INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES('m','s','t','assistant','preserve me','completed','2026','2026');
            INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json) VALUES('e','s','g',0,'2026','session.started','{\"historical\":true}');
            INSERT INTO process_runs(id,session_id,agent,generation_id,state,started_at) VALUES('p','s','codex','g','exited','2026');")
            .execute(&mut connection).await.unwrap();
        for migration in migrations.iter().filter(|m|m.version >= 20) {
            let mut transaction = connection.begin().await.unwrap();
            sqlx::raw_sql(&migration.sql).execute(&mut *transaction).await.unwrap();
            transaction.commit().await.unwrap();
        }
        sqlx::query("PRAGMA foreign_keys=ON").execute(&mut connection).await.unwrap();
        assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut connection).await.unwrap().is_empty());
        let message: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='m' AND session_id='s'").fetch_one(&mut connection).await.unwrap();
        assert_eq!(message,"preserve me");
        let event: (String,String) = sqlx::query_as("SELECT payload_json,schema_version FROM agent_events WHERE event_id='e'").fetch_one(&mut connection).await.unwrap();
        assert_eq!(event,("{\"historical\":true}".into(),"1.0".into()));
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('external','w','dev.example.agent','external','idle','2026','2026')").execute(&mut connection).await.unwrap();
        assert!(sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('bad','missing','dev.example.agent','bad','idle','2026','2026')").execute(&mut connection).await.is_err());
    }
}
