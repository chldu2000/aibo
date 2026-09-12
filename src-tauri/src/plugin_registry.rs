use crate::plugin_manifest::{self, Contribution};
use crate::plugin_dependencies::{self, Report as DependencyReport};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{collections::HashSet, fs, io::Read, path::{Component, Path, PathBuf}, process::Stdio, thread, time::{Duration, Instant}};
use tokio::sync::Mutex;

static INSTALL_LOCK: Mutex<()> = Mutex::const_new(());
const MAX_PACKAGE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginDependencyDiagnostic {
    pub kind: String,
    pub name: String,
    pub required: bool,
    pub available: bool,
    pub executable: Option<String>,
    pub version_range: Option<String>,
    pub detected_version: Option<String>,
    pub issue: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallation {
    pub id: String,
    pub plugin_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub enabled: bool,
    pub installed: bool,
    pub runnable: bool,
    pub dependencies: Vec<PluginDependencyDiagnostic>,
    pub contributions: Vec<Contribution>,
    pub activation_issues: Vec<String>,
    pub package_dependencies: DependencyReport,
    pub manifest: Value,
}

pub(crate) fn parse_dependency_version(output: &str) -> Option<semver::Version> {
    output.split_whitespace().find_map(|token| {
        let token = token.trim_matches(|character: char| !character.is_ascii_alphanumeric() && !matches!(character, '.' | '-' | '+')).trim_start_matches('v');
        if !token.chars().next().is_some_and(|character|character.is_ascii_digit()) { return None; }
        let normalized = match token.matches('.').count() { 0 => format!("{token}.0.0"), 1 => format!("{token}.0"), _ => token.to_owned() };
        semver::Version::parse(&normalized).ok()
    })
}

fn executable_version(path: &Path) -> Result<semver::Version, &'static str> {
    let mut command = std::process::Command::new(path);
    command.arg("--version").env_clear().stdout(Stdio::piped()).stderr(Stdio::piped());
    for name in ["SystemRoot", "WINDIR", "PATH", "LANG", "LC_ALL"] {
        if let Some(value) = std::env::var_os(name) { command.env(name, value); }
    }
    let mut child = command.spawn().map_err(|_|"version probe failed")?;
    let stdout = child.stdout.take().ok_or("version probe failed")?;
    let stderr = child.stderr.take().ok_or("version probe failed")?;
    let stdout = thread::spawn(move || { let mut bytes = Vec::new(); let _ = stdout.take(8192).read_to_end(&mut bytes); bytes });
    let stderr = thread::spawn(move || { let mut bytes = Vec::new(); let _ = stderr.take(8192).read_to_end(&mut bytes); bytes });
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_|"version probe failed")? { break status; }
        if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); return Err("version probe timed out"); }
        thread::sleep(Duration::from_millis(10));
    };
    let mut bytes = stdout.join().map_err(|_|"version probe failed")?;
    bytes.extend(stderr.join().map_err(|_|"version probe failed")?);
    if !status.success() { return Err("version probe failed"); }
    parse_dependency_version(&String::from_utf8_lossy(&bytes)).ok_or("version was not reported")
}

pub(crate) fn dependency_diagnostics(manifest: &Value) -> Vec<PluginDependencyDiagnostic> {
    let normalized = plugin_manifest::normalize(manifest).ok();
    let dependencies = normalized.as_ref().map(|model| model.executable_dependencies.as_slice())
        .unwrap_or_else(|| manifest["dependencies"].as_array().map(Vec::as_slice).unwrap_or_default());
    dependencies.iter().map(|dependency| {
        let name = dependency["name"].as_str().unwrap().to_owned();
        let executable = crate::find_executable(&name).map(|path|path.to_string_lossy().into_owned());
        let version_range = dependency["versionRange"].as_str().map(ToOwned::to_owned);
        let (available, detected_version, issue) = match (executable.as_deref(), version_range.as_deref()) {
            (None, _) => (false, None, Some("executable was not found".to_owned())),
            (Some(_), None) => (true, None, None),
            (Some(path), Some(range)) => match (executable_version(Path::new(path)), semver::VersionReq::parse(range)) {
                (Ok(version), Ok(requirement)) if requirement.matches(&version) => (true, Some(version.to_string()), None),
                (Ok(version), Ok(_)) => (false, Some(version.to_string()), Some(format!("version does not satisfy {range}"))),
                (Err(error), _) => (false, None, Some(error.to_owned())),
                (_, Err(_)) => (false, None, Some("manifest version range is invalid".to_owned())),
            },
        };
        PluginDependencyDiagnostic { kind: dependency["kind"].as_str().unwrap().to_owned(), name,
            required: dependency["required"].as_bool().unwrap(), available, executable, version_range, detected_version, issue }
    }).collect()
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
    let normalized = plugin_manifest::normalize(&manifest)?;
    if !manifest["platforms"].as_array().unwrap().iter().any(|p| p == &platform()) { return Err("protocol_incompatible: package platform".into()); }
    for name in if normalized.version == 1 { vec!["runtime", "view"] } else { vec![] } {
        let range = &manifest["protocols"][name];
        if range.is_null() && name == "view" { continue; }
        // Initial host implements exactly v1.0; reject unsupported major/minor bounds.
        if range["min"] != "1.0" || range["max"] != "1.0" { return Err("protocol_incompatible: supported protocol is 1.0".into()); }
    }
    if let Some(executable) = manifest["entrypoint"]["executable"].as_str() { package_path(root, executable)?; }
    let mut ids = HashSet::new();
    for agent in normalized.agents() {
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
    // The registry keeps immutable releases so active sessions can remain
    // pinned to an older package. The manager, however, should present only
    // the current bundled release instead of showing every development digest
    // produced from the same built-in plugin version. External tombstones stay
    // visible so the user can see that a package was removed and reinstall the
    // same release; bundled tombstones remain internal recovery records.
    let rows = sqlx::query(
        "SELECT id, plugin_id, plugin_version, package_digest, enabled, installed, manifest_json
         FROM plugin_installations p
         WHERE p.source NOT LIKE '%bundled-plugin-sources%'
            OR (
             p.installed=1
             AND p.id = (
               SELECT current.id
               FROM plugin_installations current
               WHERE current.plugin_id=p.plugin_id
                 AND current.installed=1
                 AND current.source LIKE '%bundled-plugin-sources%'
               ORDER BY current.enabled_at DESC, current.created_at DESC, current.id DESC
               LIMIT 1
             )
           )
         ORDER BY p.created_at, p.id",
    )
        .fetch_all(db).await.map_err(|e| e.to_string())?;
    let mut installations = Vec::new();
    for row in rows {
        let manifest: Value = serde_json::from_str(row.get::<&str, _>("manifest_json")).map_err(io_error)?;
        let normalized = plugin_manifest::normalize(&manifest)?;
        let activation_issues = plugin_manifest::activation_issues(&manifest)?;
        let package_dependencies = plugin_dependencies::resolve(db, row.get("id"), false).await?;
        let dependencies = dependency_diagnostics(&manifest);
        let installed = row.get::<i64, _>("installed") != 0;
        installations.push(PluginInstallation { id: row.get("id"), plugin_id: row.get("plugin_id"), plugin_version: row.get("plugin_version"),
            package_digest: row.get("package_digest"), enabled: row.get::<i64, _>("enabled") != 0, installed,
            runnable: installed && package_dependencies.ready() && activation_issues.is_empty() && dependencies.iter().all(|dependency|!dependency.required || dependency.available), dependencies, contributions: normalized.contributions, activation_issues, package_dependencies, manifest });
    }
    Ok(installations)
}

pub(crate) async fn install(db: &SqlitePool, data_dir: &Path, source: &Path) -> Result<PluginInstallation, String> {
    let _lock = INSTALL_LOCK.lock().await;
    let source = source.canonicalize().map_err(io_error)?;
    let registry = data_dir.join("plugins");
    fs::create_dir_all(&registry).map_err(io_error)?;
    let registry = registry.canonicalize().map_err(io_error)?;
    if source.starts_with(&registry) || registry.starts_with(&source) { return Err("invalid_request: package and registry must be separate".into()); }
    let (manifest, entries, expected_digest) = inspect(&source)?;
    let normalized = plugin_manifest::normalize(&manifest)?;
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
        for agent in normalized.agents() {
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
            for agent in normalized.agents() {
                sqlx::query("INSERT INTO agent_contributions (installation_id, agent_id, metadata_json) VALUES (?, ?, ?)")
                    .bind(&id).bind(agent["agentId"].as_str().unwrap()).bind(agent.to_string()).execute(&mut *transaction).await.map_err(io_error)?;
            }
        }
        fs::rename(&staging, &destination).map_err(io_error)?;
        transaction.commit().await.map_err(io_error)?;
        Ok::<(), String>(())
    }.await;
    if let Err(error) = persist { let _ = fs::remove_dir_all(&staging); let _ = fs::remove_dir_all(&destination); return Err(error); }
    let retained = registry.join(format!(".retained-{id}"));
    if retained.exists() { fs::remove_dir_all(retained).map_err(io_error)?; }
    let dependencies = dependency_diagnostics(&manifest);
    let activation_issues = plugin_manifest::activation_issues(&manifest)?;
    let package_dependencies = plugin_dependencies::resolve(db, &id, false).await?;
    let runnable = package_dependencies.ready() && activation_issues.is_empty() && dependencies.iter().all(|dependency|!dependency.required || dependency.available);
    Ok(PluginInstallation { id, plugin_id: manifest["pluginId"].as_str().unwrap().into(), plugin_version: manifest["version"].as_str().unwrap().into(),
        package_digest: expected_digest, enabled: false, installed: true, runnable, dependencies, contributions: normalized.contributions, activation_issues, package_dependencies, manifest })
}

pub(crate) async fn install_builtins(db: &SqlitePool, data_dir: &Path) -> Result<(), String> {
    for (directory, files) in [
        ("codex-1.0.0", vec![("plugin.json", include_bytes!("../builtin-plugins/codex/plugin.json").as_slice()), ("codex-plugin.mjs", include_bytes!("../builtin-plugins/codex/codex-plugin.mjs").as_slice())]),
        ("pi-1.0.0", vec![("plugin.json", include_bytes!("../builtin-plugins/pi/plugin.json").as_slice()), ("pi-plugin.mjs", include_bytes!("../builtin-plugins/pi/pi-plugin.mjs").as_slice())]),
    ] {
        let source = data_dir.join("bundled-plugin-sources").join(directory);
        fs::create_dir_all(&source).map_err(io_error)?;
        let source = source.canonicalize().map_err(io_error)?;
        for (name, contents) in files {
            let target = source.join(name);
            if target.exists() && fs::symlink_metadata(&target).map_err(io_error)?.file_type().is_symlink() { return Err("invalid_request: bundled plugin source contains a link".into()); }
            fs::write(target, contents).map_err(io_error)?;
        }
        let (manifest, _, digest) = inspect(&source)?;
        let existing: Option<String> = sqlx::query_scalar("SELECT id FROM plugin_installations WHERE plugin_id=? AND plugin_version=? AND package_digest=? AND installed=1")
            .bind(manifest["pluginId"].as_str().unwrap()).bind(manifest["version"].as_str().unwrap()).bind(digest)
            .fetch_optional(db).await.map_err(io_error)?;
        let id = match existing { Some(id) => id, None => install(db, data_dir, &source).await?.id };
        enable(db, &id, true).await?;
    }
    Ok(())
}

pub(crate) async fn enable(db: &SqlitePool, id: &str, enabled: bool) -> Result<(), String> {
    if enabled {
        let raw: String = sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=? AND installed=1")
            .bind(id).fetch_optional(db).await.map_err(io_error)?.ok_or("invalid_request: installation not found")?;
        let manifest: Value = serde_json::from_str(&raw).map_err(io_error)?;
        let issues = plugin_manifest::activation_issues(&manifest)?;
        if !issues.is_empty() { return Err(format!("protocol_incompatible: {}", issues.join(" "))); }
        if manifest["schema"] == "aibo.plugin-manifest/v2" && dependency_diagnostics(&manifest).iter().any(|dependency|dependency.required && !dependency.available) {
            return Err("dependency_missing: required executable dependency is unavailable".into());
        }
    }
    if enabled {
        let report = plugin_dependencies::resolve(db, id, true).await?;
        if !report.ready() {
            let problem = report.dependencies.iter().find(|dependency|dependency.required && !dependency.available).unwrap();
            return Err(format!("{}: {}",problem.plugin_id,problem.issue.as_deref().unwrap_or("dependency unavailable")));
        }
    }
    let changed = sqlx::query("UPDATE plugin_installations SET enabled = ?, enabled_at = ? WHERE id = ? AND installed=1")
        .bind(enabled).bind(if enabled { Some(crate::now_iso()) } else { None }).bind(id).execute(db).await.map_err(io_error)?;
    if changed.rows_affected() != 1 { return Err("invalid_request: installation not found".into()); }
    Ok(())
}

// Recovery references outlive active processes. Closed sessions retain their exact release.
async fn recovery_references(db: &SqlitePool, id: &str) -> Result<i64,String> {
    sqlx::query_scalar("WITH RECURSIVE retained(id) AS (
        SELECT id FROM plugin_installations WHERE installed=1 AND id<>?
        UNION SELECT plugin_installation_id FROM sessions WHERE plugin_installation_id IS NOT NULL
        UNION SELECT installation_id FROM capability_invocations WHERE status='running'
        UNION SELECT installation_id FROM capability_provider_bindings
        UNION SELECT installation_id FROM capability_binding_candidates
        UNION SELECT d.dependency_installation_id FROM plugin_dependency_bindings d JOIN retained r ON r.id=d.installation_id
    ) SELECT COUNT(*) FROM retained WHERE id=?")
        .bind(id).bind(id).fetch_one(db).await.map_err(io_error)
}

/// Reclaim only tombstoned releases whose exact-release recovery references are gone.
pub(crate) async fn collect_retired(db: &SqlitePool, data_dir: &Path) -> Result<(),String> {
    let _lock = INSTALL_LOCK.lock().await;
    let registry=data_dir.join("plugins");
    if !registry.exists() { return Ok(()); }
    let registry=registry.canonicalize().map_err(io_error)?;
    let rows=sqlx::query("SELECT id,install_path FROM plugin_installations WHERE installed=0").fetch_all(db).await.map_err(io_error)?;
    for row in rows {
        let id: String=row.get("id");
        let path=PathBuf::from(row.get::<String,_>("install_path"));
        if path != registry.join(format!(".retained-{id}")) || recovery_references(db,&id).await? != 0 {continue;}
        if path.exists() {fs::remove_dir_all(path).map_err(io_error)?;}
    }
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
    let active:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE installation_id=? AND status='running'").bind(id).fetch_one(db).await.map_err(io_error)?;
    if active != 0 {return Err("busy: capability invocations must drain before uninstall".into());}
    let retained = recovery_references(db,id).await? > 0;
    let trash = parent.join(format!(".retained-{id}"));
    if path.exists() { fs::rename(&path, &trash).map_err(io_error)?; }
    let result = sqlx::query("UPDATE plugin_installations SET installed=0,enabled=0,enabled_at=NULL,removed_at=?,install_path=? WHERE id=? AND installed=1")
        .bind(crate::now_iso()).bind(trash.to_string_lossy().as_ref()).bind(id).execute(db).await.map_err(io_error);
    match result {
        Ok(changed) if changed.rows_affected() == 1 => {
            if !retained && trash.exists() { fs::remove_dir_all(trash).map_err(io_error)?; }
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

    #[tokio::test]
    async fn installs_declarative_v2_without_an_entrypoint_but_requires_its_dependency() {
        let root = std::env::temp_dir().join(format!("aibo-v2-registry-{}", ulid::Ulid::new()));
        let package = root.join("package");
        fs::create_dir_all(&package).unwrap();
        let original: Value = serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/declarative.json")).unwrap();
        fs::write(package.join("plugin.json"), original.to_string()).unwrap();
        let data = root.join("data");
        let db = crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        let installed = install(&db, &data, &package).await.unwrap();
        assert_eq!(installed.manifest, original);
        assert!(installed.installed && !installed.enabled && !installed.runnable);
        assert!(installed.dependencies.is_empty(), "package dependencies are not local executable probes");
        assert_eq!(installed.contributions.len(), 1);
        assert_eq!(installed.contributions[0].kind, "semanticView");
        assert!(installed.activation_issues.is_empty());
        assert!(!installed.package_dependencies.ready());
        assert!(enable(&db, &installed.id, true).await.unwrap_err().contains("dependency"));
        assert!(!list(&db).await.unwrap()[0].enabled);
        let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions").fetch_one(&db).await.unwrap();
        assert_eq!(sessions, 0);
        let agents: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_contributions").fetch_one(&db).await.unwrap();
        assert_eq!(agents, 0);
        uninstall(&db, &data, &installed.id).await.unwrap();
        let reinstalled = install(&db, &data, &package).await.unwrap();
        assert_eq!(reinstalled.id, installed.id);
        assert_eq!(reinstalled.manifest, original);
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn retired_release_is_retained_until_recovery_references_disappear() {
        let root=std::env::temp_dir().join(format!("aibo-release-{}",ulid::Ulid::new()));
        let db=crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
        let source=Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/plugins/capability-echo");
        let release=install(&db,&root,&source).await.unwrap();
        sqlx::query("INSERT INTO capability_provider_bindings(scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,updated_at) VALUES('application','application','test','1.0.0',?,'test',?)")
            .bind(&release.id).bind(crate::now_iso()).execute(&db).await.unwrap();
        let data=crate::plugin_storage::directory(&root.join("plugins").join(&release.id),&release.plugin_id,&release.id,"instance").unwrap();
        fs::write(data.join("cache"),"retained").unwrap();
        uninstall(&db,&root,&release.id).await.unwrap();
        let retained=root.join("plugins").join(format!(".retained-{}",release.id));
        collect_retired(&db,&root).await.unwrap();assert!(retained.is_dir());
        assert!(!list(&db).await.unwrap()[0].installed);
        let restored=install(&db,&root,&source).await.unwrap();
        assert_eq!(restored.id,release.id);
        assert!(!retained.exists());
        assert_eq!(fs::read_to_string(data.join("cache")).unwrap(),"retained");
        uninstall(&db,&root,&release.id).await.unwrap();
        sqlx::query("DELETE FROM capability_provider_bindings WHERE installation_id=?").bind(&release.id).execute(&db).await.unwrap();
        collect_retired(&db,&root).await.unwrap();assert!(!retained.exists());
        assert!(data.join("cache").exists(),"package collection never cleans private data");
        db.close().await;fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_escaping_and_ambiguous_package_paths() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        for raw in ["../secret", "/etc/passwd", "C:/secret", "dir\\file", "a/../b", "./plugin.json", "a//b", "file:stream", "trailing."] {
            assert!(package_path(&root, raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn reports_dependency_versions_and_incompatibility() {
        let manifest = serde_json::json!({"dependencies":[
            {"kind":"runtime","name":"node","versionRange":">=22","required":true},
            {"kind":"runtime","name":"node","versionRange":">=999","required":false},
            {"kind":"executable","name":"aibo-definitely-missing-agent-binary","required":false}
        ]});
        let diagnostics = dependency_diagnostics(&manifest);
        assert_eq!(diagnostics.len(), 3);
        assert!(diagnostics[0].required);
        assert!(diagnostics[0].available, "Node is a test prerequisite");
        assert!(diagnostics[0].detected_version.is_some());
        assert!(!diagnostics[1].available);
        assert!(diagnostics[1].issue.as_deref().unwrap().contains("does not satisfy"));
        assert!(!diagnostics[2].required);
        assert!(!diagnostics[2].available);
        assert_eq!(diagnostics[2].issue.as_deref(), Some("executable was not found"));
    }

    #[test]
    fn parses_common_dependency_version_output() {
        assert_eq!(parse_dependency_version("node v22.15.0").unwrap(), semver::Version::new(22, 15, 0));
        assert_eq!(parse_dependency_version("codex-cli 0.104.2").unwrap(), semver::Version::new(0, 104, 2));
    }

    #[tokio::test]
    async fn session_migration_preserves_old_history_and_allows_external_identity() {
        let root = std::env::temp_dir().join(format!("aibo-history-upgrade-{}", ulid::Ulid::new()));
        let old = root.join("migrations");
        fs::create_dir_all(&old).unwrap();
        let migrations = sqlx::migrate!("./migrations");
        for migration in migrations.iter().filter(|m| m.version < 20) {
            fs::write(old.join(format!("{:04}_fixture.sql", migration.version)), migration.sql.as_bytes()).unwrap();
        }
        let path = root.join("host.db");
        let mut connection = sqlx::SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(false)).await.unwrap();
        sqlx::migrate::Migrator::new(old.as_path()).await.unwrap().run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,created_at,updated_at) VALUES('w','/old','old','2026','2026');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('s','w','codex','history','idle','2026','2026');
            INSERT INTO session_bindings(session_id,external_session_id,bound_at) VALUES('s','native-old','2026');
            INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES('t','s','native-turn','completed','2026');
            INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES('m','s','t','assistant','preserve me','completed','2026','2026');
            INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json) VALUES('e','s','g',0,'2026','session.started','{\"historical\":true}');
            INSERT INTO process_runs(id,session_id,agent,generation_id,state,started_at) VALUES('p','s','codex','g','exited','2026');")
            .execute(&mut connection).await.unwrap();
        // First cross the event-version boundary, then upgrade this real database
        // through the application's normal migrator. Preserve both event formats.
        for migration in migrations.iter().filter(|m| m.version >= 20 && m.version <= 27) {
            fs::write(old.join(format!("{:04}_fixture.sql", migration.version)), migration.sql.as_bytes()).unwrap();
        }
        sqlx::migrate::Migrator::new(old.as_path()).await.unwrap().run(&mut connection).await.unwrap();
        sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json,schema_version) VALUES('e2','s','g',1,'2026','session.started','{\"historicalV2\":true}','2.0')").execute(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        for _ in 0..2 {
            let db = crate::open_database(&path).await.unwrap();
            let events: Vec<(String, String)> = sqlx::query_as("SELECT payload_json,schema_version FROM agent_events ORDER BY sequence").fetch_all(&db).await.unwrap();
            assert_eq!(events, vec![("{\"historical\":true}".into(), "1.0".into()), ("{\"historicalV2\":true}".into(), "2.0".into())]);
            assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages WHERE id='m'").fetch_one(&db).await.unwrap(), 1);
            let history = serde_json::to_value(crate::session_history::read(&db, "w".into(), "s".into(), None).await.unwrap()).unwrap();
            assert_eq!(history["source"], "persisted-core");
            assert_eq!(history["items"][0]["content"], "preserve me");
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT external_session_id FROM session_bindings WHERE session_id='s'").fetch_one(&db).await.unwrap(), "native-old");
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT external_turn_id FROM turns WHERE id='t'").fetch_one(&db).await.unwrap(), "native-turn");
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT generation_id FROM process_runs WHERE id='p'").fetch_one(&db).await.unwrap(), "g");
            db.close().await;
        }
        let mut connection = sqlx::SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().filename(&path)).await.unwrap();
        sqlx::query("PRAGMA foreign_keys=ON").execute(&mut connection).await.unwrap();
        assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut connection).await.unwrap().is_empty());
        let message: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='m' AND session_id='s'").fetch_one(&mut connection).await.unwrap();
        assert_eq!(message,"preserve me");
        let event: (String,String) = sqlx::query_as("SELECT payload_json,schema_version FROM agent_events WHERE event_id='e'").fetch_one(&mut connection).await.unwrap();
        assert_eq!(event,("{\"historical\":true}".into(),"1.0".into()));
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('external','w','dev.example.agent','external','idle','2026','2026')").execute(&mut connection).await.unwrap();
        assert!(sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('bad','missing','dev.example.agent','bad','idle','2026','2026')").execute(&mut connection).await.is_err());
        connection.close().await.unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn bundled_codex_release_is_installed_enabled_and_idempotent() {
        let root = std::env::temp_dir().join(format!("aibo-builtin-plugin-{}", ulid::Ulid::new()));
        let db = crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
        install_builtins(&db, &root).await.unwrap();
        install_builtins(&db, &root).await.unwrap();
        let installed = list(&db).await.unwrap();
        assert_eq!(installed.len(), 2);
        assert_eq!(installed.iter().map(|plugin|plugin.plugin_id.as_str()).collect::<std::collections::HashSet<_>>(), std::collections::HashSet::from(["dev.aibo.codex", "dev.aibo.pi"]));
        assert!(installed.iter().all(|plugin|plugin.enabled && plugin.installed));
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn list_hides_stale_bundled_digests_but_keeps_external_releases() {
        let root = std::env::temp_dir().join(format!("aibo-bundled-list-{}", ulid::Ulid::new()));
        let db = crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
        install_builtins(&db, &root).await.unwrap();
        sqlx::query(
            "INSERT INTO plugin_installations
             (id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,enabled,created_at,enabled_at,installed)
             SELECT 'stale-codex','dev.aibo.codex',plugin_version,'stale-digest',
                    '/tmp/bundled-plugin-sources/codex-old','/tmp/stale-codex',manifest_json,1,'2020','2020',1
             FROM plugin_installations WHERE plugin_id='dev.aibo.codex' LIMIT 1",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO plugin_installations
             (id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,enabled,created_at,enabled_at,installed)
             SELECT 'external-copy','dev.example.agent','1.0.0','external-digest',
                    '/tmp/external','/tmp/external-copy',manifest_json,1,'2020','2020',1
             FROM plugin_installations WHERE plugin_id='dev.aibo.codex' LIMIT 1",
        )
        .execute(&db)
        .await
        .unwrap();

        let visible = list(&db).await.unwrap();
        assert_eq!(visible.iter().filter(|plugin| plugin.plugin_id == "dev.aibo.codex").count(), 1);
        assert!(visible.iter().any(|plugin| plugin.plugin_id == "dev.example.agent"));
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
}
