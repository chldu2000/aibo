use crate::plugin_manifest::{self, Contribution};
use crate::plugin_dependencies::{self, Report as DependencyReport};
use serde::Serialize;
use serde_json::{json, Value};
use crate::ui_i18n::HostMessage;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{collections::HashSet, fs, io::Read, path::{Component, Path, PathBuf}, time::Duration};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub localized_issue: Option<Value>,
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub localized_activation_issues: Vec<Value>,
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

pub(crate) fn version_command(path: &Path) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(path);
    command.arg("--version").env_clear();
    for name in ["SystemRoot", "WINDIR", "PATH", "LANG", "LC_ALL"] {
        if let Some(value) = std::env::var_os(name) { command.env(name, value); }
    }
    command
}

async fn executable_version(path: &Path) -> Result<semver::Version, HostMessage> {
    let output = crate::controlled_process::execute(version_command(path), Duration::from_secs(2), 8193)
        .await.map_err(|_| HostMessage::with_diagnostic("native.dependency.probeFailed", json!({}), "version probe failed"))?;
    if output.timed_out { return Err(HostMessage::with_diagnostic("native.dependency.probeTimeout", json!({}), "version probe timed out")); }
    if !output.success || output.stdout.len() > 8192 || output.stderr.len() > 8192 {
        return Err(HostMessage::with_diagnostic("native.dependency.probeFailed", json!({}), "version probe failed"));
    }
    let mut bytes = output.stdout;
    bytes.extend(output.stderr);
    parse_dependency_version(&String::from_utf8_lossy(&bytes)).ok_or_else(|| HostMessage::with_diagnostic("native.dependency.versionMissing", json!({}), "version was not reported"))
}

pub(crate) async fn dependency_diagnostics(manifest: &Value) -> Vec<PluginDependencyDiagnostic> {
    let normalized = plugin_manifest::normalize(manifest).ok();
    let dependencies = normalized.as_ref().map(|model| model.executable_dependencies.as_slice())
        .unwrap_or_else(|| manifest["dependencies"].as_array().map(Vec::as_slice).unwrap_or_default());
    let mut diagnostics = Vec::with_capacity(dependencies.len());
    for dependency in dependencies {
        let name = dependency["name"].as_str().unwrap().to_owned();
        let executable = (if name == "node" { crate::node_runtime::for_manifest(manifest) } else { crate::find_executable(&name) })
            .map(|path|path.to_string_lossy().into_owned());
        let version_range = dependency["versionRange"].as_str().map(ToOwned::to_owned);
        let (available, detected_version, issue) = match (executable.as_deref(), version_range.as_deref()) {
            (None, _) => (false, None, Some(if name == "node" { HostMessage::new("native.dependency.nodeMissing", json!({})) } else { HostMessage::with_diagnostic("native.dependency.executableMissing", json!({}), "executable was not found") })),
            (Some(_), None) => (true, None, None),
            (Some(path), Some(range)) => match (executable_version(Path::new(path)).await, semver::VersionReq::parse(range)) {
                (Ok(version), Ok(requirement)) if requirement.matches(&version) => (true, Some(version.to_string()), None),
                (Ok(version), Ok(_)) => (false, Some(version.to_string()), Some(HostMessage::with_diagnostic("native.dependency.versionMismatch", json!({"range":range}), format!("version does not satisfy {range}")))),
                (Err(error), _) => (false, None, Some(error)),
                (_, Err(_)) => (false, None, Some(HostMessage::with_diagnostic("native.dependency.versionRangeInvalid", json!({}), "manifest version range is invalid"))),
            },
        };
        let localized_issue = issue.as_ref().and_then(|issue|issue.localized.clone());
        let issue = issue.map(|issue|issue.diagnostic);
        diagnostics.push(PluginDependencyDiagnostic { kind: dependency["kind"].as_str().unwrap().to_owned(), name,
            required: dependency["required"].as_bool().unwrap(), available, executable, version_range, detected_version, issue, localized_issue });
    }
    diagnostics
}

pub(crate) fn platform() -> String {
    format!("{}-{}", if cfg!(target_os = "windows") { "windows" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" },
        if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" })
}

fn io_error(_: impl std::fmt::Display) -> String { "invalid_request: plugin package could not be read or installed".into() }
fn host_io_error(error: impl std::fmt::Display) -> HostMessage {
    HostMessage::with_diagnostic("native.registry.ioFailure", json!({}), io_error(error))
}

fn package_path(root: &Path, raw: &str) -> Result<PathBuf, HostMessage> {
    if raw.contains('\\') || raw.contains(':') || raw.split('/').any(|part| part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' '])) {
        return Err(HostMessage::with_diagnostic("native.registry.unsafePath", json!({}), "invalid_request: unsafe package path"));
    }
    let path = Path::new(raw);
    if !path.components().all(|component| matches!(component, Component::Normal(_))) { return Err(HostMessage::with_diagnostic("native.registry.unsafePath", json!({}), "invalid_request: unsafe package path")); }
    let resolved = root.join(path).canonicalize().map_err(host_io_error)?;
    if !resolved.starts_with(root) || !resolved.is_file() { return Err(HostMessage::with_diagnostic("native.registry.pathEscape", json!({}), "invalid_request: package path escapes root")); }
    Ok(resolved)
}

fn files(root: &Path, directory: &Path, result: &mut Vec<PathBuf>, size: &mut u64) -> Result<(), HostMessage> {
    if directory.strip_prefix(root).map_err(host_io_error)?.components().count() > 16 { return Err(HostMessage::with_diagnostic("native.registry.nestingLimit", json!({}), "invalid_request: package nesting limit")); }
    for entry in fs::read_dir(directory).map_err(host_io_error)? {
        let entry = entry.map_err(host_io_error)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(host_io_error)?;
        if metadata.file_type().is_symlink() { return Err(HostMessage::with_diagnostic("native.registry.links", json!({}), "invalid_request: links are not allowed in packages")); }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 { return Err(HostMessage::with_diagnostic("native.registry.reparsePoints", json!({}), "invalid_request: reparse points are not allowed")); }
        }
        if metadata.is_dir() { files(root, &entry.path(), result, size)?; }
        else if metadata.is_file() {
            *size = size.checked_add(metadata.len()).ok_or_else(||HostMessage::with_diagnostic("native.registry.packageTooLarge", json!({}), "invalid_request: package too large"))?;
            if *size > MAX_PACKAGE_BYTES || result.len() >= 4096 { return Err(HostMessage::with_diagnostic("native.registry.packageLimit", json!({}), "invalid_request: package limit exceeded")); }
            let relative = entry.path().strip_prefix(root).map_err(host_io_error)?.to_path_buf();
            package_path(root, &relative.to_string_lossy().replace('\\', "/"))?;
            result.push(relative);
        } else { return Err(HostMessage::with_diagnostic("native.registry.specialFile", json!({}), "invalid_request: package contains special file")); }
    }
    Ok(())
}

fn hash_file(path: &Path, digest: &mut Sha256) -> Result<(), HostMessage> {
    let mut file = fs::File::open(path).map_err(host_io_error)?;
    let mut bytes = [0u8; 16384];
    loop {
        let count = file.read(&mut bytes).map_err(host_io_error)?;
        if count == 0 { break; }
        digest.update(&bytes[..count]);
    }
    Ok(())
}

pub(crate) fn inspect(root: &Path) -> Result<(Value, Vec<PathBuf>, String), HostMessage> {
    let mut entries = Vec::new();
    files(root, root, &mut entries, &mut 0)?;
    entries.sort();
    let manifest_path = package_path(root, "plugin.json")?;
    if fs::metadata(&manifest_path).map_err(host_io_error)?.len() > 1_048_576 { return Err(HostMessage::with_diagnostic("native.registry.manifestTooLarge", json!({}), "invalid_request: manifest too large")); }
    let manifest: Value = serde_json::from_slice(&fs::read(manifest_path).map_err(host_io_error)?).map_err(host_io_error)?;
    let normalized = plugin_manifest::normalize_display(&manifest)?;
    if !manifest["platforms"].as_array().unwrap().iter().any(|p| p == &platform()) { return Err(HostMessage::with_diagnostic("native.registry.platform", json!({}), "protocol_incompatible: package platform")); }
    for name in if normalized.version == 1 { vec!["runtime", "view"] } else { vec![] } {
        let range = &manifest["protocols"][name];
        if range.is_null() && name == "view" { continue; }
        // Initial host implements exactly v1.0; reject unsupported major/minor bounds.
        if range["min"] != "1.0" || range["max"] != "1.0" { return Err(HostMessage::with_diagnostic("native.registry.legacyProtocol", json!({}), "protocol_incompatible: supported protocol is 1.0")); }
    }
    if let Some(executable) = manifest["entrypoint"]["executable"].as_str() { package_path(root, executable)?; }
    for entry in normalized.contributions.iter().filter(|entry| entry.kind == "toolView") {
        for field in ["frontend", "backend"] { package_path(root, entry.metadata[field].as_str().unwrap())?; }
    }
    let mut ids = HashSet::new();
    for agent in normalized.session_agents(manifest["pluginId"].as_str().unwrap()) {
        if !ids.insert(agent["agentId"].as_str().unwrap().to_owned()) { return Err(HostMessage::with_diagnostic("native.registry.duplicateAgent", json!({}), "manifest_mismatch: duplicate Agent ID")); }
    }
    if let Some(resources) = manifest["resources"].as_array() {
        for resource in resources {
            let path = package_path(root, resource["path"].as_str().unwrap())?;
            let mut hash = Sha256::new(); hash_file(&path, &mut hash)?;
            if format!("{:x}", hash.finalize()) != resource["sha256"].as_str().unwrap() { return Err(HostMessage::with_diagnostic("native.registry.resourceDigest", json!({}), "manifest_mismatch: resource digest")); }
        }
    }
    let mut digest = Sha256::new();
    for entry in &entries {
        let name = entry.to_string_lossy().replace('\\', "/");
        digest.update((name.len() as u64).to_le_bytes()); digest.update(name.as_bytes());
        digest.update(fs::metadata(root.join(entry)).map_err(host_io_error)?.len().to_le_bytes());
        hash_file(&root.join(entry), &mut digest)?;
    }
    Ok((manifest, entries, format!("{:x}", digest.finalize())))
}

pub(crate) async fn list(db: &SqlitePool) -> Result<Vec<PluginInstallation>, HostMessage> {
    // A preparing candidate and rollback backups are never current installations.
    let rows = sqlx::query(
        "SELECT id, plugin_id, plugin_version, package_digest, enabled, installed, manifest_json
         FROM plugin_installations p
         WHERE NOT EXISTS(SELECT 1 FROM plugin_replacements r WHERE r.target_id=p.id AND r.phase='preparing')
           AND (p.source NOT LIKE '%bundled-plugin-sources%' OR (
             p.installed=1 AND p.id=(SELECT current.id FROM plugin_installations current
             WHERE current.plugin_id=p.plugin_id AND current.installed=1
             ORDER BY current.enabled_at DESC,current.created_at DESC,current.id DESC LIMIT 1)))
         ORDER BY p.created_at,p.id",
    ).fetch_all(db).await.map_err(host_io_error)?;
    let mut installations = Vec::new();
    for row in rows {
        let manifest: Value = serde_json::from_str(row.get::<&str, _>("manifest_json")).map_err(host_io_error)?;
        let normalized = plugin_manifest::normalize_display(&manifest)?;
        let activation_diagnostics = plugin_manifest::activation_diagnostics(&manifest)?;
        let localized_activation_issues = activation_diagnostics.iter().map(HostMessage::display).collect();
        let activation_issues: Vec<String> = activation_diagnostics.into_iter().map(|issue|issue.diagnostic).collect();
        let package_dependencies = plugin_dependencies::resolve_display(db, row.get("id"), false).await?;
        let dependencies = dependency_diagnostics(&manifest).await;
        let installed = row.get::<i64, _>("installed") != 0;
        installations.push(PluginInstallation { id: row.get("id"), plugin_id: row.get("plugin_id"), plugin_version: row.get("plugin_version"),
            package_digest: row.get("package_digest"), enabled: row.get::<i64, _>("enabled") != 0, installed,
            runnable: installed && package_dependencies.ready() && activation_issues.is_empty() && dependencies.iter().all(|dependency|!dependency.required || dependency.available), dependencies, contributions: normalized.contributions, activation_issues, localized_activation_issues, package_dependencies, manifest });
    }
    Ok(installations)
}

pub(crate) async fn install(db: &SqlitePool, data_dir: &Path, source: &Path) -> Result<PluginInstallation, HostMessage> {
    install_reserved(db, data_dir, source, None, None).await
}

// The replacement journal reserves the candidate identity before touching files.
pub(crate) async fn install_reserved(db: &SqlitePool, data_dir: &Path, source: &Path, reserved: Option<&str>, confirmed_digest: Option<&str>) -> Result<PluginInstallation, HostMessage> {
    let _lock = INSTALL_LOCK.lock().await;
    let source = source.canonicalize().map_err(host_io_error)?;
    let registry = data_dir.join("plugins");
    fs::create_dir_all(&registry).map_err(host_io_error)?;
    let registry = registry.canonicalize().map_err(host_io_error)?;
    if source.starts_with(&registry) || registry.starts_with(&source) { return Err(HostMessage::with_diagnostic("native.registry.separateDirectories", json!({}), "invalid_request: package and registry must be separate")); }
    let (manifest, entries, expected_digest) = inspect(&source)?;
    if confirmed_digest.is_some_and(|confirmed|confirmed!=expected_digest) {return Err(HostMessage::new("native.plugin.packageChanged",json!({})));}
    let normalized = plugin_manifest::normalize_display(&manifest)?;
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM plugin_installations WHERE plugin_id=? AND plugin_version=? AND package_digest=? AND installed=0")
        .bind(manifest["pluginId"].as_str().unwrap()).bind(manifest["version"].as_str().unwrap()).bind(&expected_digest)
        .fetch_optional(db).await.map_err(host_io_error)?;
    let id = reserved.map(str::to_owned).or(existing).unwrap_or_else(|| ulid::Ulid::new().to_string());
    let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plugin_removals WHERE installation_id=?)").bind(&id).fetch_one(db).await.map_err(host_io_error)?;
    if pending { cleanup_removed(db,data_dir,&id,manifest["pluginId"].as_str().unwrap()).await?; }
    let staging = registry.join(format!(".staging-{id}"));
    let destination = registry.join(&id);
    fs::create_dir(&staging).map_err(host_io_error)?;
    let copy_result = (|| {
        for entry in entries {
            let target = staging.join(&entry);
            fs::create_dir_all(target.parent().unwrap()).map_err(host_io_error)?;
            fs::copy(source.join(&entry), target).map_err(host_io_error)?;
        }
        let (_, _, actual_digest) = inspect(&staging)?;
        if actual_digest != expected_digest { return Err(HostMessage::with_diagnostic("native.registry.copyChanged", json!({}), "manifest_mismatch: package changed during copy")); }
        Ok::<(), HostMessage>(())
    })();
    if let Err(error) = copy_result { let _ = fs::remove_dir_all(&staging); return Err(error); }
    let persist = async {
        let mut transaction = db.begin().await.map_err(host_io_error)?;
        for agent in normalized.session_agents(manifest["pluginId"].as_str().unwrap()) {
            let conflict: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_contributions a JOIN plugin_installations p ON a.installation_id = p.id WHERE a.agent_id = ? AND p.plugin_id <> ?")
                .bind(agent["agentId"].as_str().unwrap()).bind(manifest["pluginId"].as_str().unwrap()).fetch_one(&mut *transaction).await.map_err(host_io_error)?;
            if conflict != 0 { return Err(HostMessage::with_diagnostic("native.registry.foreignAgent", json!({}), "manifest_mismatch: Agent ID belongs to another plugin")); }
        }
        let restored = sqlx::query("UPDATE plugin_installations SET source=?,install_path=?,manifest_json=?,installed=1,enabled=0,enabled_at=NULL,removed_at=NULL WHERE id=? AND installed=0")
            .bind(source.to_string_lossy().as_ref()).bind(destination.to_string_lossy().as_ref()).bind(manifest.to_string()).bind(&id)
            .execute(&mut *transaction).await.map_err(host_io_error)?.rows_affected() == 1;
        if !restored {
            sqlx::query("INSERT INTO plugin_installations (id, plugin_id, plugin_version, package_digest, source, install_path, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(&id).bind(manifest["pluginId"].as_str().unwrap()).bind(manifest["version"].as_str().unwrap()).bind(&expected_digest)
                .bind(source.to_string_lossy().as_ref()).bind(destination.to_string_lossy().as_ref()).bind(manifest.to_string()).bind(crate::now_iso())
                .execute(&mut *transaction).await.map_err(host_io_error)?;
            for agent in normalized.session_agents(manifest["pluginId"].as_str().unwrap()) {
                sqlx::query("INSERT INTO agent_contributions (installation_id, agent_id, metadata_json) VALUES (?, ?, ?)")
                    .bind(&id).bind(agent["agentId"].as_str().unwrap()).bind(agent.to_string()).execute(&mut *transaction).await.map_err(host_io_error)?;
            }
        }
        fs::rename(&staging, &destination).map_err(host_io_error)?;
        transaction.commit().await.map_err(host_io_error)?;
        Ok::<(), HostMessage>(())
    }.await;
    if let Err(error) = persist { let _ = fs::remove_dir_all(&staging); let _ = fs::remove_dir_all(&destination); return Err(error); }
    let retained = registry.join(format!(".retained-{id}"));
    if retained.exists() { fs::remove_dir_all(retained).map_err(host_io_error)?; }
    let dependencies = dependency_diagnostics(&manifest).await;
    let activation_diagnostics = plugin_manifest::activation_diagnostics(&manifest)?;
    let localized_activation_issues = activation_diagnostics.iter().map(HostMessage::display).collect();
    let activation_issues: Vec<String> = activation_diagnostics.into_iter().map(|issue|issue.diagnostic).collect();
    let package_dependencies = plugin_dependencies::resolve_display(db, &id, false).await?;
    let runnable = package_dependencies.ready() && activation_issues.is_empty() && dependencies.iter().all(|dependency|!dependency.required || dependency.available);
    Ok(PluginInstallation { id, plugin_id: manifest["pluginId"].as_str().unwrap().into(), plugin_version: manifest["version"].as_str().unwrap().into(),
        package_digest: expected_digest, enabled: false, installed: true, runnable, dependencies, contributions: normalized.contributions, activation_issues, localized_activation_issues, package_dependencies, manifest })
}

pub(crate) async fn install_builtins(db: &SqlitePool, data_dir: &Path) -> Result<(), String> {
    // Keep retired package metadata for history, but never advertise it as enabled.
    sqlx::query("UPDATE plugin_installations SET enabled=0 WHERE json_extract(manifest_json,'$.schema')='aibo.plugin-manifest/v1'")
        .execute(db).await.map_err(io_error)?;
    for (directory, files) in [
        ("codex-2.0.18", vec![("background-tasks.mjs", include_bytes!("../capability-plugins/codex/background-tasks.mjs").as_slice()),("NOTICE.md", include_bytes!("../capability-plugins/codex/NOTICE.md").as_slice()), ("plugin.json", include_bytes!("../capability-plugins/codex/plugin.json").as_slice()), ("engine.mjs", include_bytes!("../capability-plugins/codex/engine.mjs").as_slice()), ("worker.mjs", include_bytes!("../capability-plugins/codex/worker.mjs").as_slice()), ("session-provider.mjs", include_bytes!("../capability-plugins/session-provider.mjs").as_slice())]),
        ("pi-2.0.11", vec![("NOTICE.md", include_bytes!("../capability-plugins/pi/NOTICE.md").as_slice()), ("plugin.json", include_bytes!("../capability-plugins/pi/plugin.json").as_slice()), ("engine.mjs", include_bytes!("../capability-plugins/pi/engine.mjs").as_slice()), ("worker.mjs", include_bytes!("../capability-plugins/pi/worker.mjs").as_slice()), ("session-provider.mjs", include_bytes!("../capability-plugins/session-provider.mjs").as_slice())]),
    ] {
        let source = data_dir.join("bundled-plugin-sources").join(directory);
        fs::create_dir_all(&source).map_err(io_error)?;
        let source = source.canonicalize().map_err(io_error)?;
        for (name, contents) in files {
            let target = source.join(name);
            if target.exists() && fs::symlink_metadata(&target).map_err(io_error)?.file_type().is_symlink() { return Err("invalid_request: bundled plugin source contains a link".into()); }
            fs::write(target, contents).map_err(io_error)?;
        }
        let (manifest, _, digest) = inspect(&source).map_err(|error|error.diagnostic)?;
        // Bootstrap only. Never resurrect an uninstalled package, re-enable a disabled
        // package, or silently add the bundled version beside a user replacement.
        let known:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plugin_installations WHERE plugin_id=?)")
            .bind(manifest["pluginId"].as_str().unwrap()).fetch_one(db).await.map_err(io_error)?;
        if known {continue;}
        let existing: Option<String> = sqlx::query_scalar("SELECT id FROM plugin_installations WHERE plugin_id=? AND plugin_version=? AND package_digest=? AND installed=1")
            .bind(manifest["pluginId"].as_str().unwrap()).bind(manifest["version"].as_str().unwrap()).bind(digest)
            .fetch_optional(db).await.map_err(io_error)?;
        let id = match existing { Some(id) => id, None => install(db, data_dir, &source).await.map_err(|error|error.diagnostic)?.id };
        // Only this host-packaged native executor receives native enforcement.
        // An installed plugin with the same public IDs does not inherit the grant.
        if directory.starts_with("codex-") {
            sqlx::query("INSERT OR REPLACE INTO session_execution_authorities(installation_id,contribution_id,backend) VALUES(?,?,'codex-native')")
                .bind(&id).bind(manifest["contributions"][0]["id"].as_str().ok_or("invalid bundled contribution")?)
                .execute(db).await.map_err(io_error)?;
        }
        if let Err(error) = enable(db, &id, true).await {
            if error.diagnostic.starts_with("protocol_incompatible:") || error.diagnostic.starts_with("dependency_missing:") {
                tracing::error!(plugin_id=manifest["pluginId"].as_str().unwrap_or("unknown"),installation_id=%id,%error,"bundled plugin was installed but could not be enabled");
                continue;
            }
            return Err(error.diagnostic);
        }
    }
    Ok(())
}

pub(crate) async fn enable(db: &SqlitePool, id: &str, enabled: bool) -> Result<(), HostMessage> {
    if enabled {
        let raw: String = sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=? AND installed=1")
            .bind(id).fetch_optional(db).await.map_err(|error|HostMessage::with_diagnostic("native.registry.ioFailure",json!({}),io_error(error)))?.ok_or_else(||HostMessage::with_diagnostic("native.registry.installationMissing",json!({}),"invalid_request: installation not found"))?;
        let manifest: Value = serde_json::from_str(&raw).map_err(|error|HostMessage::with_diagnostic("native.registry.ioFailure",json!({}),io_error(error)))?;
        let issues = plugin_manifest::activation_diagnostics(&manifest)?;
        if !issues.is_empty() {
            let diagnostic = format!("protocol_incompatible: {}", issues.iter().map(|issue|issue.diagnostic.as_str()).collect::<Vec<_>>().join(" "));
            return Err(HostMessage::with_diagnostic("native.registry.activationRejected",json!({"reasons":{"kind":"list","items":issues.iter().map(HostMessage::display).collect::<Vec<_>>()}}),diagnostic));
        }
        if manifest["schema"] == "aibo.plugin-manifest/v2" && dependency_diagnostics(&manifest).await.iter().any(|dependency|dependency.required && !dependency.available) {
            return Err(HostMessage::with_diagnostic("native.registry.executableUnavailable",json!({}),"dependency_missing: required executable dependency is unavailable"));
        }
    }
    if enabled {
        let report = plugin_dependencies::resolve_display(db, id, true).await?;
        if !report.ready() {
            let problem = report.dependencies.iter().find(|dependency|dependency.required && !dependency.available).unwrap();
            let reason = problem.message().unwrap_or_else(||HostMessage::with_diagnostic("native.packageDependency.unavailable",json!({}),"dependency unavailable"));
            return Err(HostMessage::with_diagnostic("native.registry.packageDependencyUnavailable",json!({"plugin":problem.plugin_id,"reason":reason.display()}),format!("{}: {}",problem.plugin_id,reason.diagnostic)));
        }
    }
    let changed = sqlx::query("UPDATE plugin_installations SET enabled = ?, enabled_at = ? WHERE id = ? AND installed=1")
        .bind(enabled).bind(if enabled { Some(crate::now_iso()) } else { None }).bind(id).execute(db).await.map_err(|error|HostMessage::with_diagnostic("native.registry.ioFailure",json!({}),io_error(error)))?;
    if changed.rows_affected() != 1 { return Err(HostMessage::with_diagnostic("native.registry.installationMissing",json!({}),"invalid_request: installation not found")); }
    Ok(())
}

// Recovery references outlive active processes. Closed sessions retain their exact release.
async fn recovery_references(db: &SqlitePool, id: &str) -> Result<i64,HostMessage> {
    sqlx::query_scalar("WITH RECURSIVE retained(id) AS (
        SELECT id FROM plugin_installations WHERE installed=1 AND id<>?
        UNION SELECT plugin_installation_id FROM sessions WHERE plugin_installation_id IS NOT NULL AND id NOT IN (SELECT session_id FROM plugin_session_retirements)
        UNION SELECT installation_id FROM capability_invocations WHERE status='running'
        UNION SELECT installation_id FROM capability_provider_bindings
        UNION SELECT installation_id FROM capability_binding_candidates
        UNION SELECT d.dependency_installation_id FROM plugin_dependency_bindings d JOIN retained r ON r.id=d.installation_id
    ) SELECT COUNT(*) FROM retained WHERE id=?")
        .bind(id).bind(id).fetch_one(db).await.map_err(host_io_error)
}

/// Reclaim only tombstoned releases whose exact-release recovery references are gone.
pub(crate) async fn collect_retired(db: &SqlitePool, data_dir: &Path) -> Result<(),HostMessage> {
    let _lock = INSTALL_LOCK.lock().await;
    let pending: Vec<(String,String)> = sqlx::query_as("SELECT p.id,p.plugin_id FROM plugin_removals r JOIN plugin_installations p ON p.id=r.installation_id WHERE p.installed=0")
        .fetch_all(db).await.map_err(host_io_error)?;
    for (id,plugin) in pending { cleanup_removed(db,data_dir,&id,&plugin).await?; }
    let registry=data_dir.join("plugins");
    if !registry.exists() { return Ok(()); }
    let registry=registry.canonicalize().map_err(host_io_error)?;
    let rows=sqlx::query("SELECT id,install_path FROM plugin_installations WHERE installed=0").fetch_all(db).await.map_err(host_io_error)?;
    for row in rows {
        let id: String=row.get("id");
        let path=PathBuf::from(row.get::<String,_>("install_path"));
        if path != registry.join(format!(".retained-{id}")) || recovery_references(db,&id).await? != 0 {continue;}
        if path.exists() {fs::remove_dir_all(path).map_err(host_io_error)?;}
    }
    Ok(())
}

async fn cleanup_removed(db: &SqlitePool, data_dir: &Path, id: &str, plugin: &str) -> Result<(),HostMessage> {
    crate::plugin_lifecycle::remove_owned_display(data_dir,&["plugins",id])?;
    crate::plugin_lifecycle::remove_owned_display(data_dir,&["plugins",&format!(".retained-{id}")])?;
    crate::plugin_lifecycle::remove_owned_display(data_dir,&["plugin-data",plugin,id])?;
    // Shared configuration belongs to the plugin identity, not one release.
    sqlx::query("DELETE FROM agent_settings WHERE plugin_id=? AND scope_kind<>'session' AND NOT EXISTS(SELECT 1 FROM plugin_installations WHERE plugin_id=? AND installed=1)")
        .bind(plugin).bind(plugin).execute(db).await.map_err(host_io_error)?;
    sqlx::query("DELETE FROM plugin_removals WHERE installation_id=?").bind(id).execute(db).await.map_err(host_io_error)?;
    Ok(())
}

pub(crate) async fn uninstall(db: &SqlitePool, data_dir: &Path, id: &str) -> Result<(), HostMessage> {
    let _lock = INSTALL_LOCK.lock().await;
    let row = sqlx::query("SELECT install_path, installed, plugin_id FROM plugin_installations WHERE id=?")
        .bind(id).fetch_optional(db).await.map_err(host_io_error)?
        .ok_or("invalid_request: installation not found")?;
    if row.get::<i64, _>("installed") == 0 { return Err(HostMessage::with_diagnostic("native.registry.alreadyUninstalled", json!({}), "invalid_request: plugin is already uninstalled")); }
    let path = PathBuf::from(row.get::<String, _>("install_path"));
    let registry = data_dir.join("plugins").canonicalize().map_err(host_io_error)?;
    let parent = path.parent().ok_or_else(||HostMessage::with_diagnostic("native.registry.installationPath", json!({}), "invalid_request: invalid installation path"))?;
    if parent != registry || path.file_name().and_then(|name|name.to_str()) != Some(id) {
        return Err(HostMessage::with_diagnostic("native.registry.installationEscape", json!({}), "invalid_request: installation path escapes registry"));
    }
    let active:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE installation_id=? AND status='running'").bind(id).fetch_one(db).await.map_err(host_io_error)?;
    if active != 0 {return Err(HostMessage::with_diagnostic("native.registry.uninstallBusy", json!({}), "busy: capability invocations must drain before uninstall"));}
    if recovery_references(db,id).await? > 0 { return Err(HostMessage::with_diagnostic("native.registry.references", json!({}), "plugin_references: 插件仍有引用，请先迁移或明确保留历史并停用")); }
    let plugin: String = row.get("plugin_id");
    crate::plugin_lifecycle::owned_path_display(data_dir,&["plugins",id])?;
    crate::plugin_lifecycle::owned_path_display(data_dir,&["plugin-data",&plugin,id])?;
    let trash = parent.join(format!(".retained-{id}"));
    let result = async {
        let mut tx=db.begin().await.map_err(host_io_error)?;
        let changed=sqlx::query("UPDATE plugin_installations SET installed=0,enabled=0,enabled_at=NULL,removed_at=?,install_path=? WHERE id=? AND installed=1")
            .bind(crate::now_iso()).bind(trash.to_string_lossy().as_ref()).bind(id).execute(&mut *tx).await.map_err(host_io_error)?;
        sqlx::query("INSERT INTO plugin_removals VALUES(?,?)").bind(id).bind(crate::now_iso()).execute(&mut *tx).await.map_err(host_io_error)?;
        tx.commit().await.map_err(host_io_error)?;
        Ok::<_,HostMessage>(changed)
    }.await;
    match result {
        Ok(changed) if changed.rows_affected() == 1 => {
            cleanup_removed(db,data_dir,id,&plugin).await?;
            Ok(())
        }
        _ => {
            Err(HostMessage::with_diagnostic("native.registry.uninstallFailed", json!({}), "invalid_request: plugin uninstall failed"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Connection;

    #[tokio::test]
    async fn missing_required_executable_rejects_enable_with_display_and_retains_disabled_installation() {
        let root = std::env::temp_dir().join(format!("aibo-enable-executable-{}", ulid::Ulid::new()));
        let package = root.join("package");
        fs::create_dir_all(&package).unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/provider.json")).unwrap();
        manifest["executableDependencies"] = json!([{"kind":"executable","name":"aibo-definitely-missing-agent-binary","required":true}]);
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
        fs::write(package.join("git-worker.mjs"), "throw new Error('must not run');").unwrap();
        let data = root.join("data");
        let db = crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        let installed = install(&db, &data, &package).await.unwrap();
        assert!(!installed.enabled && !installed.runnable);
        let error = enable(&db, &installed.id, true).await.unwrap_err();
        assert_eq!(error.diagnostic, "dependency_missing: required executable dependency is unavailable");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &error.display()), "A required executable dependency is unavailable.");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &error.display()), "必需的可执行依赖不可用。");
        assert!(!list(&db).await.unwrap()[0].enabled);
        let pins:i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plugin_dependency_bindings").fetch_one(&db).await.unwrap();
        assert_eq!(pins, 0);
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn installation_and_refresh_expose_activation_display_without_enabling_incompatible_packages() {
        let root = std::env::temp_dir().join(format!("aibo-activation-display-{}", ulid::Ulid::new()));
        let package = root.join("package");
        fs::create_dir_all(&package).unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/declarative.json")).unwrap();
        manifest["host"] = json!({"min":"99.0.0","maxExclusive":"100.0.0"});
        manifest["contributions"][0]["contractVersion"] = json!("2.0.0");
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
        let data = root.join("data");
        let db = crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        let installed = install(&db, &data, &package).await.unwrap();
        assert!(installed.installed && !installed.enabled && !installed.runnable);
        assert_eq!(installed.manifest, manifest);
        assert_eq!(installed.activation_issues, vec!["当前宿主版本不在插件要求的范围内。", "必需贡献 dev.aibo.git-view.changes 不受支持（类型：semanticView，操作：无具体操作）；请检查 runtime 协议、语义版本、作用域和权限。"]);
        assert_eq!(installed.localized_activation_issues.len(), 2);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &installed.localized_activation_issues[0]), "The current host version is outside the range required by this plugin.");
        assert_eq!(installed.localized_activation_issues[1]["params"]["operation"]["key"], "native.activation.noOperation");
        let before = serde_json::to_value(&installed).unwrap();
        let rejected = enable(&db, &installed.id, true).await.unwrap_err();
        assert_eq!(rejected.diagnostic, format!("protocol_incompatible: {}", installed.activation_issues.join(" ")));
        assert_eq!(rejected.display()["params"]["reasons"]["items"], json!(installed.localized_activation_issues));
        assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &rejected.display()).starts_with("Cannot enable this plugin: The current host version is outside"));
        for enabled in [true,false] {
            let missing = enable(&db, "missing", enabled).await.unwrap_err();
            assert_eq!(missing.diagnostic, "invalid_request: installation not found");
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &missing.display()), "未找到插件安装。");
        }
        let refreshed = list(&db).await.unwrap();
        assert_eq!(serde_json::to_value(&refreshed[0]).unwrap(), before);
        assert_eq!(before["localizedActivationIssues"][0]["schema"], "aibo.host-message/v1");
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

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
        assert!(enable(&db, &installed.id, true).await.unwrap_err().diagnostic.contains("dependency"));
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
    async fn removal_rejects_references_and_cleans_private_data_after_detachment() {
        let root=tempfile::tempdir().unwrap();
        let data=root.path();
        let db=crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        let source=Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/plugins/capability-echo");
        let release=install(&db,data,&source).await.unwrap();
        sqlx::query("INSERT INTO capability_provider_bindings(scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,updated_at) VALUES('application','application','test','1.0.0',?,'test',?)")
            .bind(&release.id).bind(crate::now_iso()).execute(&db).await.unwrap();
        let private=crate::plugin_storage::directory(&data.join("plugins").join(&release.id),&release.plugin_id,&release.id,"instance").unwrap();
        fs::write(private.join("cache"),"old").unwrap();
        assert!(uninstall(&db,data,&release.id).await.unwrap_err().diagnostic.contains("plugin_references"));
        assert!(private.join("cache").exists());
        sqlx::query("DELETE FROM capability_provider_bindings WHERE installation_id=?").bind(&release.id).execute(&db).await.unwrap();
        uninstall(&db,data,&release.id).await.unwrap();
        assert!(!private.exists());
        assert!(!data.join("plugins").join(&release.id).exists());
        assert!(!list(&db).await.unwrap()[0].installed);
        let restored=install(&db,data,&source).await.unwrap();
        assert_eq!(restored.id,release.id);
        assert!(!private.exists(),"reinstallation does not resurrect removed data");
        db.close().await;
    }

    #[tokio::test]
    async fn interrupted_removal_resumes_cleanup_without_deleting_business_assets() {
        let root=tempfile::tempdir().unwrap();let data=root.path();
        let db=crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        let source=Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/plugins/capability-echo");
        let release=install(&db,data,&source).await.unwrap();
        let private=crate::plugin_storage::directory(&data.join("plugins").join(&release.id),&release.plugin_id,&release.id,"instance").unwrap();
        fs::write(private.join("cache"),"private").unwrap();
        fs::create_dir(data.join("artifacts")).unwrap();fs::write(data.join("artifacts/history"),"business").unwrap();
        // Simulate process exit after committing removal, before filesystem cleanup.
        sqlx::query("UPDATE plugin_installations SET installed=0,enabled=0 WHERE id=?").bind(&release.id).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO plugin_removals VALUES(?,'now')").bind(&release.id).execute(&db).await.unwrap();
        collect_retired(&db,data).await.unwrap();collect_retired(&db,data).await.unwrap();
        assert!(!private.exists());assert!(!data.join("plugins").join(&release.id).exists());
        assert_eq!(fs::read_to_string(data.join("artifacts/history")).unwrap(),"business");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM plugin_removals").fetch_one(&db).await.unwrap(),0);
        db.close().await;
    }

    #[tokio::test]
    #[ignore = "requires a built package in AIBO_TEST_PLUGIN_PATH"]
    async fn packaged_node_plugin_installs_and_initializes() {
        let source = PathBuf::from(std::env::var("AIBO_TEST_PLUGIN_PATH").unwrap());
        let root = std::env::temp_dir().join(format!("aibo-package-native-{}", ulid::Ulid::new()));
        let db = crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
        let installed = install(&db, &root, &source).await.unwrap();
        assert!(installed.runnable, "{}", serde_json::to_string(&installed.dependencies).unwrap());
        enable(&db, &installed.id, true).await.unwrap();
        let directory = root.join("plugins").join(&installed.id);
        let (manifest, _, _) = inspect(&directory.canonicalize().unwrap()).unwrap();
        let preload = crate::plugin_sdk::prepare(&root.join("plugins")).unwrap();
        let runtime = crate::plugin_runtime::PluginRuntime::spawn_interactive(
            &crate::node_runtime::executable().unwrap(),
            &["--import".into(), tauri::Url::from_file_path(preload).unwrap().to_string(),
                directory.join(manifest["entrypoint"]["executable"].as_str().unwrap()).to_string_lossy().into_owned()],
            &directory, None).unwrap();
        let reply = runtime.request("capability.initialize", serde_json::json!({
            "protocol":"2.1", "pluginId":manifest["pluginId"], "pluginVersion":manifest["version"],
            "instanceId":"native-package", "generationId":runtime.generation_id, "installationId":installed.id,
            "contributionId":manifest["contributions"][0]["id"], "privateData":{"path":root,"formatVersion":1}
        }), Duration::from_secs(10)).await.unwrap();
        assert_eq!(reply["pluginVersion"], manifest["version"]);
        runtime.stop_and_wait().await;
        uninstall(&db, &root, &installed.id).await.unwrap();
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn invalid_manifest_installation_exposes_display_and_does_not_create_a_candidate() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("package");fs::create_dir(&source).unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/declarative.json")).unwrap();
        manifest["host"] = json!({"min":"0.2.0","maxExclusive":"0.1.0"});
        fs::write(source.join("plugin.json"), manifest.to_string()).unwrap();
        let data = root.path().join("data");
        let db = crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        let error = install(&db, &data, &source).await.err().unwrap();
        assert_eq!(error.diagnostic, "invalid_manifest: empty version range");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &error.display()), "版本范围为空。");
        let rows:i64=sqlx::query_scalar("SELECT COUNT(*) FROM plugin_installations").fetch_one(&db).await.unwrap();
        assert_eq!(rows, 0);assert_eq!(fs::read_dir(data.join("plugins")).unwrap().count(), 0);
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(source.join("plugin.json")).unwrap()).unwrap(), manifest);
        db.close().await;
    }

    #[tokio::test]
    async fn package_validation_display_preserves_digest_guards_and_leaves_no_candidate() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source {raw}");
        fs::create_dir(&source).unwrap();
        let source = source.canonicalize().unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/declarative.json")).unwrap();
        manifest["platforms"] = json!([if platform() == "linux-x64" {"darwin-arm64"} else {"linux-x64"}]);
        fs::write(source.join("plugin.json"), manifest.to_string()).unwrap();
        let incompatible = inspect(&source).unwrap_err();
        assert_eq!(incompatible.diagnostic, "protocol_incompatible: package platform");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &incompatible.display()), "插件包不支持当前平台。");
        manifest["platforms"] = json!([platform()]);
        fs::write(source.join("plugin.json"), manifest.to_string()).unwrap();
        let (_, _, digest) = inspect(&source).unwrap();
        let data = root.path().join("data");
        let db = crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        let error = install_reserved(&db, &data, &source, Some("candidate"), Some("stale-digest")).await.err().unwrap();
        assert_eq!(error.diagnostic, "安装包已变化，请重新确认");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &error.display()), "The package changed. Confirm it again.");
        let rows:i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plugin_installations").fetch_one(&db).await.unwrap();
        assert_eq!(rows, 0);
        assert_eq!(fs::read_dir(data.join("plugins")).unwrap().count(), 0);
        assert_eq!(inspect(&source).unwrap().2, digest);
        fs::write(source.join("plugin.json"), vec![b' ';1_048_577]).unwrap();
        let oversized = inspect(&source).unwrap_err();
        assert_eq!(oversized.diagnostic, "invalid_request: manifest too large");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &oversized.display()), "The plugin manifest is too large.");
        db.close().await;
    }

    #[cfg(unix)]
    #[test]
    fn package_file_guards_translate_without_following_links_or_reading_oversized_files() {
        use crate::ui_i18n::{render, Locale};
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret"), "keep").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
        let links = inspect(root.path()).unwrap_err();
        assert_eq!(links.diagnostic, "invalid_request: links are not allowed in packages");
        assert_eq!(render(Locale::ZhCn, &links.display()), "插件包不允许包含链接。");
        fs::remove_file(root.path().join("link")).unwrap();
        let file = fs::File::create(root.path().join("large")).unwrap();
        file.set_len(MAX_PACKAGE_BYTES + 1).unwrap();
        let large = inspect(root.path()).unwrap_err();
        assert_eq!(large.diagnostic, "invalid_request: package limit exceeded");
        assert_eq!(render(Locale::En, &large.display()), "The plugin package exceeds the file count or size limit.");
        drop(file); fs::remove_file(root.path().join("large")).unwrap();
        let socket = std::os::unix::net::UnixListener::bind(root.path().join("socket")).unwrap();
        let special = inspect(root.path()).unwrap_err();
        assert_eq!(special.diagnostic, "invalid_request: package contains special file");
        assert_eq!(render(Locale::ZhCn, &special.display()), "插件包包含特殊文件。");
        drop(socket); fs::remove_file(root.path().join("socket")).unwrap();
        let mut nested = root.path().to_path_buf();
        for _ in 0..17 {nested.push("nested");fs::create_dir(&nested).unwrap();}
        let nesting = inspect(root.path()).unwrap_err();
        assert_eq!(nesting.diagnostic, "invalid_request: package nesting limit");
        assert_eq!(render(Locale::En, &nesting.display()), "The package nesting depth exceeds the limit.");
        assert_eq!(fs::read_to_string(outside.path().join("secret")).unwrap(), "keep");
    }

    #[test]
    fn resource_integrity_error_retains_legacy_diagnostic_and_localized_display() {
        let root = tempfile::tempdir().unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
        manifest["platforms"] = json!([platform()]);
        fs::create_dir(root.path().join("bin")).unwrap();
        fs::create_dir(root.path().join("resources")).unwrap();
        fs::write(root.path().join("bin/echo-agent"), "not executed").unwrap();
        fs::write(root.path().join("resources/logo.svg"), "changed bytes").unwrap();
        fs::write(root.path().join("plugin.json"), manifest.to_string()).unwrap();
        let error = inspect(&root.path().canonicalize().unwrap()).unwrap_err();
        assert_eq!(error.diagnostic, "manifest_mismatch: resource digest");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &error.display()), "The plugin resource digest does not match.");
        assert_eq!(fs::read_to_string(root.path().join("resources/logo.svg")).unwrap(), "changed bytes");
    }

    #[test]
    fn rejects_escaping_and_ambiguous_package_paths() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        for raw in ["../secret", "/etc/passwd", "C:/secret", "dir\\file", "a/../b", "./plugin.json", "a//b", "file:stream", "trailing."] {
            let error = package_path(&root, raw).unwrap_err();
            assert_eq!(error.diagnostic, "invalid_request: unsafe package path", "{raw}");
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &error.display()), "The package path is unsafe.");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn version_probe_deadline_includes_descendant_pipes() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("aibo-version-probe-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let executable = root.join("version-probe");
        fs::write(&executable, "#!/bin/sh\nprintf 'v1.2.3\\n'\nsleep 3 &\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let started = std::time::Instant::now();
        let result = executable_version(&executable).await;
        fs::remove_dir_all(root).unwrap();
        let error = result.unwrap_err();
        assert_eq!(error.diagnostic, "version probe timed out");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &error.display()), "版本检测超时");
        assert!(started.elapsed() < Duration::from_millis(2800));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn version_probe_errors_preserve_diagnostics_without_exposing_process_output() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("aibo-version-errors-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let executable = root.join("probe");
        for (script, diagnostic, zh) in [
            ("#!/bin/sh\nprintf 'secret-output'\nexit 1\n", "version probe failed", "版本检测失败"),
            ("#!/bin/sh\nprintf 'secret-output'\n", "version was not reported", "未返回版本信息"),
        ] {
            fs::write(&executable, script).unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
            let error = executable_version(&executable).await.unwrap_err();
            assert_eq!(error.diagnostic, diagnostic);
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &error.display()), diagnostic);
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &error.display()), zh);
            assert!(!serde_json::to_string(&error).unwrap().contains("secret-output"));
        }
        let missing = executable_version(&root.join("missing")).await.unwrap_err();
        assert_eq!(missing.diagnostic, "version probe failed");
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn reports_dependency_versions_and_incompatibility() {
        let manifest = serde_json::json!({"dependencies":[
            {"kind":"runtime","name":"node","versionRange":">=22","required":true},
            {"kind":"runtime","name":"node","versionRange":">=999","required":false},
            {"kind":"executable","name":"aibo-definitely-missing-agent-binary","required":false},
            {"kind":"runtime","name":"node","versionRange":"invalid-range","required":false}
        ]});
        let diagnostics = dependency_diagnostics(&manifest).await;
        assert_eq!(diagnostics.len(), 4);
        assert!(diagnostics[0].required);
        assert!(diagnostics[0].available, "Node is a test prerequisite");
        assert!(diagnostics[0].detected_version.is_some());
        assert!(!diagnostics[1].available);
        assert!(diagnostics[1].issue.as_deref().unwrap().contains("does not satisfy"));
        assert!(!diagnostics[2].required);
        assert!(!diagnostics[2].available);
        assert_eq!(diagnostics[2].issue.as_deref(), Some("executable was not found"));
        assert!(diagnostics[0].localized_issue.is_none());
        let mismatch = diagnostics[1].localized_issue.as_ref().unwrap();
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, mismatch), "version does not satisfy >=999");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, mismatch), "版本不满足 >=999");
        let missing = diagnostics[2].localized_issue.as_ref().unwrap();
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, missing), "未找到可执行文件");
        assert_eq!(diagnostics[3].issue.as_deref(), Some("manifest version range is invalid"));
        assert!(!diagnostics[3].available);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, diagnostics[3].localized_issue.as_ref().unwrap()), "清单中的版本范围无效");
        let serialized = serde_json::to_value(&diagnostics[2]).unwrap();
        assert_eq!(serialized["issue"], "executable was not found");
        assert_eq!(serialized["localizedIssue"]["schema"], "aibo.host-message/v1");
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
        assert_eq!(installed.iter().find(|plugin| plugin.plugin_id == "dev.aibo.codex").unwrap().plugin_version, "2.0.18");
        assert_eq!(installed.iter().find(|plugin| plugin.plugin_id == "dev.aibo.pi").unwrap().plugin_version, "2.0.11");
        assert!(installed.iter().all(|plugin|plugin.enabled && plugin.installed));
        for plugin in &installed {
            assert_eq!(plugin.manifest["hostSdk"]["min"], if plugin.plugin_id == "dev.aibo.codex" { "0.1.9" } else { "0.1.8" });
            let directory = root.join("plugins").join(&plugin.id);
            assert!(!directory.join("runtime.mjs").exists());
            assert!(!directory.join("stdio.mjs").exists());
        }
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
