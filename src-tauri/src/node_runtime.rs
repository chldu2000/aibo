//! Resolve compatible local Node installations, with an explicitly downloaded private fallback.
//! All callers use the same resolver; running processes retain their executable.
use std::{collections::HashMap, ffi::OsString, fs, io::{Read, Write}, path::{Path, PathBuf}, sync::{Mutex, OnceLock}, time::Duration};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};


/// Keep raw diagnostics for existing consumers and explicit display metadata for the UI.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct RuntimeError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    localized: Option<Value>,
}
impl RuntimeError {
    fn host(key: &str, params: Value) -> Self {
        let mut localized = crate::ui_i18n::descriptor(key, params);
        localized["schema"] = json!("aibo.host-message/v1");
        Self { code:"node_runtime_error", message:crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&localized), localized:Some(localized) }
    }
    fn display_value(&self) -> Value { self.localized.clone().unwrap_or_else(||json!(self.message)) }
}
impl From<String> for RuntimeError { fn from(message: String) -> Self { Self {code:"node_runtime_error",message,localized:None} } }
impl From<&str> for RuntimeError { fn from(message: &str) -> Self { message.to_owned().into() } }
impl std::fmt::Display for RuntimeError { fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { self.message.fmt(formatter) } }
impl std::ops::Deref for RuntimeError { type Target=str; fn deref(&self) -> &str { &self.message } }

const HOST_REQUIREMENT: &str = ">=22";
const LOCK: &str = include_str!("../../scripts/node-runtime.json");
const MAX_ARCHIVE: u64 = 128 * 1024 * 1024;
const MAX_BINARY: u64 = 256 * 1024 * 1024;
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Preferences { manual_path: Option<PathBuf>, managed_directory: Option<PathBuf> }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Selection { pub path: PathBuf, pub version: String, pub source: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    selected: Option<Selection>, manual_path: Option<PathBuf>, host_requirement: &'static str,
    download_version: String, download_supported: bool, issues: Vec<String>, localized_issues: Vec<Value>,
}
struct Cached { fingerprint: String, resolved_stamp: Option<(u64, Option<std::time::SystemTime>)>, checked_at: std::time::Instant, result: Result<(String, PathBuf), RuntimeError> }
struct Runtime { root: Option<PathBuf>, cache: Mutex<HashMap<PathBuf, Cached>>, mutation: Mutex<()> }

pub(crate) fn initialize(data_dir: PathBuf) { let _ = RUNTIME.set(Runtime::new(Some(data_dir.join("node-runtime")))) ; }
fn runtime() -> &'static Runtime { RUNTIME.get_or_init(|| Runtime::new(None)) }
fn binary_name() -> &'static str { if cfg!(windows) { "node.exe" } else { "node" } }
fn file_stamp(path: &Path) -> Option<(u64, Option<std::time::SystemTime>)> {
    fs::metadata(path).ok().map(|meta|(meta.len(), meta.modified().ok()))
}
fn local_path() -> OsString {
    crate::executable_search_path_from(std::env::var_os("PATH"), std::env::var_os("HOME").or_else(||std::env::var_os("USERPROFILE")))
}
pub(crate) fn executable() -> Option<PathBuf> { resolve(None) }
pub(crate) fn resolve(requirement: Option<&str>) -> Option<PathBuf> {
    runtime().select(&local_path(), requirement).0.map(|entry|entry.path)
}
pub(crate) fn for_manifest(manifest: &serde_json::Value) -> Option<PathBuf> {
    let dependencies = manifest.get("executableDependencies").or_else(||manifest.get("dependencies"));
    let requirement = dependencies.and_then(|value|value.as_array()).into_iter().flatten()
        .find(|dependency|dependency["name"] == "node").and_then(|dependency|dependency["versionRange"].as_str());
    resolve(requirement)
}

impl Runtime {
    fn new(root: Option<PathBuf>) -> Self { Self { root, cache: Mutex::new(HashMap::new()), mutation: Mutex::new(()) } }
    fn preferences(&self) -> Result<Preferences, RuntimeError> {
        let Some(root) = &self.root else { return Ok(Preferences::default()); };
        match fs::read(root.join("selection.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_|RuntimeError::host("native.node.preferencesCorrupt",json!({}))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
            Err(error) => Err(error.to_string().into()),
        }
    }
    fn save(&self, value: &Preferences) -> Result<(), RuntimeError> {
        let root = self.root.as_ref().ok_or(RuntimeError::host("native.node.notInitialized",json!({})))?;
        fs::create_dir_all(root).map_err(|e|e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e|e.to_string())?;
        file.write_all(&serde_json::to_vec(value).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        file.as_file().sync_all().map_err(|e|e.to_string())?;
        file.persist(root.join("selection.json")).map_err(|e|e.to_string())?;
        Ok(())
    }
    fn inspect(&self, candidate: &Path, managed: bool) -> Result<(String, PathBuf), RuntimeError> {
        if !candidate.is_absolute() || !crate::is_executable(candidate) { return Err(RuntimeError::host("native.node.notExecutable",json!({}))); }
        let path = fs::canonicalize(candidate).map_err(|e|e.to_string())?;
        let meta = fs::metadata(&path).map_err(|e|e.to_string())?;
        let record = if managed { Some(fs::read(path.with_file_name("runtime.json")).map_err(|e|e.to_string())?) } else { None };
        let fingerprint = format!("{}:{:?}:{:?}", meta.len(), meta.modified(), record);
        let mut cache = self.cache.lock().unwrap();
        if let Some(entry) = cache.get(&path).filter(|entry|entry.fingerprint == fingerprint && entry.checked_at.elapsed() < Duration::from_secs(30)
            && entry.result.as_ref().map_or(true, |(_, executable)|crate::is_executable(executable) && file_stamp(executable) == entry.resolved_stamp)) { return entry.result.clone(); }
        let result = (|| {
            if let Some(record) = record {
                let record: serde_json::Value = serde_json::from_slice(&record).map_err(|e|e.to_string())?;
                let spec = distribution()?;
                if record["archiveSha256"] != spec.sha256 || record["version"] != spec.version || record["target"] != spec.target
                    || record["binarySha256"] != digest_file(&path)? { return Err(RuntimeError::host("native.node.managedIntegrity",json!({}))); }
            }
            probe(&path)
        })();
        let resolved_stamp = result.as_ref().ok().and_then(|(_, path)|file_stamp(path));
        cache.insert(path, Cached { fingerprint, resolved_stamp, checked_at: std::time::Instant::now(), result: result.clone() });
        result
    }
    fn select(&self, search: &OsString, requirement: Option<&str>) -> (Option<Selection>, Vec<RuntimeError>) {
        let mut issues = Vec::new();
        let preferences = match self.preferences() { Ok(value) => value, Err(error) => return (None, vec![error]) };
        let host = semver::VersionReq::parse(HOST_REQUIREMENT).unwrap();
        let required = match semver::VersionReq::parse(requirement.unwrap_or("*")) {
            Ok(value) => value, Err(_) => return (None, vec![RuntimeError::host("native.node.pluginRequirementInvalid",json!({}))]),
        };
        let mut candidates = Vec::new();
        if let Some(path) = preferences.manual_path { candidates.push((path, "manual")); }
        else {
            for directory in std::env::split_paths(search).filter(|path|path.is_absolute()) {
                let path = directory.join(binary_name());
                if path.exists() && !candidates.iter().any(|(existing, _)|existing == &path) { candidates.push((path, "system")); }
            }
            if let Some(directory) = preferences.managed_directory { candidates.push((directory.join(binary_name()), "managed")); }
        }
        for (path, source) in candidates {
            match self.inspect(&path, source == "managed") {
                Ok((version, executable)) if semver::Version::parse(&version).is_ok_and(|version|host.matches(&version) && required.matches(&version)) =>
                    return (Some(Selection { path: executable, version, source: source.into() }), issues),
                Ok((version, _)) => issues.push(RuntimeError::host("native.node.incompatibleCandidate",json!({"path":path.to_string_lossy(),"version":version,"requirement":HOST_REQUIREMENT,"pluginRequirement":requirement.map(|value|crate::ui_i18n::descriptor("native.node.pluginRequirement",json!({"requirement":value}))).unwrap_or_else(||json!(""))}))),
                Err(error) => issues.push(RuntimeError::host("native.node.candidateFailed",json!({"path":path.to_string_lossy(),"error":error.display_value()}))),
            }
        }
        if issues.is_empty() { issues.push(RuntimeError::host("native.node.notFound",json!({}))); }
        (None, issues)
    }
    fn status(&self, search: &OsString) -> Status {
        let (selected, issues) = self.select(search, None);
        let lock: serde_json::Value = serde_json::from_str(LOCK).unwrap();
        Status { selected, localized_issues:issues.iter().map(RuntimeError::display_value).collect(), issues:issues.iter().map(ToString::to_string).collect(), manual_path: self.preferences().ok().and_then(|value|value.manual_path),
            host_requirement: HOST_REQUIREMENT, download_version: lock["version"].as_str().unwrap().into(), download_supported: distribution().is_ok() }
    }
    fn choose(&self, path: Option<PathBuf>) -> Result<(), RuntimeError> {
        let _guard = self.mutation.try_lock().map_err(|_|RuntimeError::host("native.node.updating",json!({})))?;
        self.cache.lock().unwrap().clear();
        if let Some(path) = &path {
            let (version, _) = self.inspect(path, false)?;
            if !semver::VersionReq::parse(HOST_REQUIREMENT).unwrap().matches(&semver::Version::parse(&version).unwrap()) {
                return Err(RuntimeError::host("native.node.incompatibleSelection",json!({"version":version,"requirement":HOST_REQUIREMENT})));
            }
        }
        let mut preferences = self.preferences().unwrap_or_default();
        preferences.manual_path = path;
        self.save(&preferences)
    }
    fn install(&self, bytes: &[u8], spec: &Distribution) -> Result<(), RuntimeError> {
        if bytes.len() as u64 > MAX_ARCHIVE || format!("{:x}", Sha256::digest(bytes)) != spec.sha256 { return Err(RuntimeError::host("native.node.archiveIntegrity",json!({}))); }
        let root = self.root.as_ref().ok_or(RuntimeError::host("native.node.notInitialized",json!({})))?;
        fs::create_dir_all(root).map_err(|e|e.to_string())?;
        let stage = tempfile::Builder::new().prefix("download-").tempdir_in(root).map_err(|e|e.to_string())?;
        extract(bytes, spec, stage.path())?;
        let binary = stage.path().join(binary_name());
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).map_err(|e|e.to_string())?; }
        let (version, _) = probe(&binary)?;
        if version != spec.version { return Err(RuntimeError::host("native.node.versionMismatch",json!({}))); }
        let record = serde_json::json!({"version":spec.version,"target":spec.target,"archiveSha256":spec.sha256,"binarySha256":digest_file(&binary)?});
        fs::write(stage.path().join("runtime.json"), serde_json::to_vec(&record).unwrap()).map_err(|e|e.to_string())?;
        // Publish a new directory instead of replacing a running executable (also safe on Windows).
        let destination = root.join(format!("{}-{}", spec.version, ulid::Ulid::new()));
        fs::rename(stage.path(), &destination).map_err(|e|e.to_string())?;
        let mut preferences = self.preferences().unwrap_or_default();
        preferences.managed_directory = Some(destination.clone());
        if let Err(error) = self.save(&preferences) { let _ = fs::remove_dir_all(destination); return Err(error); }
        self.cache.lock().unwrap().clear();
        Ok(())
    }
    fn download(&self) -> Result<(), RuntimeError> {
        let _guard = self.mutation.try_lock().map_err(|_|RuntimeError::host("native.node.downloadBusy",json!({})))?;
        let spec = distribution()?;
        let client = reqwest::blocking::Client::builder().https_only(true).connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(300)).redirect(reqwest::redirect::Policy::limited(3)).build().map_err(|e|e.to_string())?;
        let response = client.get(format!("https://nodejs.org/dist/v{}/{}", spec.version, spec.archive)).send()
            .and_then(|response|response.error_for_status()).map_err(|e|RuntimeError::host("native.node.downloadFailed",json!({"error":e.to_string()})))?;
        let mut bytes = Vec::new();
        response.take(MAX_ARCHIVE + 1).read_to_end(&mut bytes).map_err(|e|RuntimeError::host("native.node.downloadInterrupted",json!({"error":e.to_string()})))?;
        self.install(&bytes, &spec)
    }
}

fn probe(path: &Path) -> Result<(String, PathBuf), RuntimeError> {
    // Isolate the synchronous resolver from any caller's Tokio runtime. Probes are cached by file identity.
    let path = path.to_owned();
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e|e.to_string())?.block_on(async {
            // Test features used by the host SDK, not just a potentially misleading --version banner.
            let mut command = tokio::process::Command::new(&path);
            command.env_clear().stdin(std::process::Stdio::null());
            for name in ["SystemRoot", "WINDIR", "PATH", "HOME", "USERPROFILE", "LANG", "VOLTA_HOME", "ASDF_DATA_DIR", "NVM_DIR"] {
                if let Some(value) = std::env::var_os(name) { command.env(name, value); }
            }
            command.current_dir(std::env::temp_dir()).args(["--input-type=module", "-e",
                "import {register} from 'node:module'; if(typeof register!=='function')process.exit(1); console.log(JSON.stringify({version:process.versions.node,executable:process.execPath}))"]);
            let output = crate::controlled_process::execute(command, Duration::from_secs(3), 1024).await.map_err(|e|e.to_string())?;
            if output.timed_out || !output.success || output.stdout.len() >= 1024 { return Err(RuntimeError::host("native.node.probeFailed",json!({}))); }
            #[derive(Deserialize)] struct Identity { version: String, executable: PathBuf }
            let identity: Identity = serde_json::from_slice(&output.stdout).map_err(|_|RuntimeError::host("native.node.notNode",json!({})))?;
            semver::Version::parse(&identity.version).map_err(|_|RuntimeError::host("native.node.invalidVersion",json!({})))?;
            if !identity.executable.is_absolute() || !crate::is_executable(&identity.executable) { return Err(RuntimeError::host("native.node.invalidExecutable",json!({}))); }
            Ok((identity.version, identity.executable))
        })
    }).join().map_err(|_|RuntimeError::host("native.node.detectionFailed",json!({})))?
}
fn digest_file(path: &Path) -> Result<String, RuntimeError> {
    let mut file = fs::File::open(path).map_err(|e|e.to_string())?;
    let mut hash = Sha256::new(); std::io::copy(&mut file, &mut hash).map_err(|e|e.to_string())?;
    Ok(format!("{:x}", hash.finalize()))
}
struct Distribution { version: String, target: String, archive: String, sha256: String }
fn distribution() -> Result<Distribution, RuntimeError> {
    let target = format!("{}-{}", if cfg!(target_os="macos") { "darwin" } else if cfg!(windows) { "win" } else { std::env::consts::OS },
        match std::env::consts::ARCH { "aarch64" => "arm64", "x86_64" => "x64", other => other });
    let lock: serde_json::Value = serde_json::from_str(LOCK).unwrap();
    let spec = &lock["targets"][&target];
    if cfg!(target_env="musl") || spec.is_null() { return Err(RuntimeError::host("native.node.unsupportedDownload",json!({}))); }
    Ok(Distribution { version: lock["version"].as_str().unwrap().into(), archive: spec["archive"].as_str().unwrap().into(), sha256: spec["sha256"].as_str().unwrap().into(), target })
}
fn extract(bytes: &[u8], spec: &Distribution, destination: &Path) -> Result<(), RuntimeError> {
    let prefix = spec.archive.trim_end_matches(".tar.gz").trim_end_matches(".zip");
    let binary = if spec.target.starts_with("win-") { "node.exe" } else { "bin/node" };
    let entries = [(format!("{prefix}/{binary}"), binary_name()), (format!("{prefix}/LICENSE"), "LICENSE")];
    let copy = |reader: &mut dyn Read, name: &str| -> Result<(), RuntimeError> {
        let mut file = fs::File::create(destination.join(name)).map_err(|e|e.to_string())?;
        let count = std::io::copy(&mut reader.take(MAX_BINARY + 1), &mut file).map_err(|e|e.to_string())?;
        if count > MAX_BINARY { return Err(RuntimeError::host("native.node.extractedTooLarge",json!({}))); }
        Ok(())
    };
    if spec.archive.ends_with(".zip") {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e|e.to_string())?;
        for (entry, name) in &entries {
            let mut file = archive.by_name(entry).map_err(|e|e.to_string())?;
            if !file.is_file() || file.is_symlink() { return Err(RuntimeError::host("native.node.archiveTypeInvalid",json!({}))); }
            copy(&mut file, name)?;
        }
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        for entry in archive.entries().map_err(|e|e.to_string())? {
            let mut entry = entry.map_err(|e|e.to_string())?;
            let path = entry.path().map_err(|e|e.to_string())?.to_path_buf();
            if let Some((_, name)) = entries.iter().find(|(expected, _)|path == Path::new(expected)) {
                if !entry.header().entry_type().is_file() { return Err(RuntimeError::host("native.node.archiveTypeInvalid",json!({}))); }
                copy(&mut entry, name)?;
            }
        }
    }
    if !destination.join(binary_name()).is_file() || !destination.join("LICENSE").is_file() { return Err(RuntimeError::host("native.node.archiveIncomplete",json!({}))); }
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_node_runtime(refresh: bool) -> Result<Status, RuntimeError> {
    tauri::async_runtime::spawn_blocking(move || {
        if refresh { runtime().cache.lock().unwrap().clear(); }
        runtime().status(&local_path())
    }).await.map_err(|e|RuntimeError::from(e.to_string()))
}
#[tauri::command]
pub(crate) async fn select_node_runtime(path: Option<PathBuf>) -> Result<Status, RuntimeError> {
    tauri::async_runtime::spawn_blocking(move || { runtime().choose(path)?; Ok(runtime().status(&local_path())) }).await.map_err(|e|RuntimeError::from(e.to_string()))?
}
#[tauri::command]
pub(crate) async fn download_node_runtime() -> Result<Status, RuntimeError> {
    tauri::async_runtime::spawn_blocking(|| { runtime().download()?; Ok(runtime().status(&local_path())) }).await.map_err(|e|RuntimeError::from(e.to_string()))?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn fake(root: &Path, name: &str, version: &str) -> PathBuf {
        let directory = root.join(name); fs::create_dir_all(&directory).unwrap();
        let path = directory.join("node");
        let identity = serde_json::json!({"version":version,"executable":path}).to_string().replace('\'', "'\\''");
        fs::write(&path, format!("#!/bin/sh\nprintf '%s\\n' '{identity}'\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap(); path
    }
    #[test]
    fn diagnostics_keep_legacy_text_and_locale_neutral_metadata_without_changing_selection() {
        let root = tempfile::tempdir().unwrap();
        let runtime = Runtime::new(Some(root.path().into()));
        let missing = runtime.status(&OsString::new());
        assert_eq!(missing.issues,vec!["未找到兼容的 Node，请下载运行时或选择已有文件。"]);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&missing.localized_issues[0]),"No compatible Node was found. Download the runtime or choose an existing file.");
        let old = fake(root.path(),"用户目录 {version}","18.0.0");
        runtime.save(&Preferences {manual_path:Some(old.clone()),managed_directory:None}).unwrap();
        let incompatible = runtime.status(&OsString::new());
        assert!(incompatible.selected.is_none());
        assert_eq!(incompatible.manual_path.as_ref(),Some(&old));
        assert!(incompatible.issues[0].contains("Node 18.0.0 不满足 >=22"));
        let en=crate::ui_i18n::render(crate::ui_i18n::Locale::En,&incompatible.localized_issues[0]);
        assert!(en.contains("Node 18.0.0 does not satisfy >=22"));assert!(en.contains("用户目录 {version}"));
        let failed=runtime.choose(Some(old.clone())).unwrap_err();
        let value=serde_json::to_value(failed).unwrap();
        assert_eq!(value["code"],"node_runtime_error");
        assert_eq!(value["message"],"Node 18.0.0 不满足 >=22，原设置已保留。");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&value["localized"]),"Node 18.0.0 does not satisfy >=22. Your previous selection was kept.");
        assert_eq!(runtime.preferences().unwrap().manual_path,Some(old));
    }

    fn managed(runtime: &Runtime, version: &str) -> PathBuf {
        let path = fake(runtime.root.as_ref().unwrap(), "managed fixture", version);
        let spec = distribution().unwrap();
        fs::write(path.with_file_name("runtime.json"), serde_json::to_vec(&serde_json::json!({
            "version":spec.version,"target":spec.target,"archiveSha256":spec.sha256,"binarySha256":digest_file(&path).unwrap()
        })).unwrap()).unwrap();
        runtime.save(&Preferences { manual_path: None, managed_directory: Some(path.parent().unwrap().into()) }).unwrap();
        path
    }
    #[test]
    fn resolves_local_then_managed_using_host_and_plugin_requirements() {
        let root = tempfile::tempdir().unwrap(); let runtime = Runtime::new(Some(root.path().join("app")));
        let old = fake(root.path(), "old", "18.0.0"); let local = fake(root.path(), "with spaces", "22.20.0");
        let backup = managed(&runtime, "24.18.0");
        let search = std::env::join_paths([old.parent().unwrap(), local.parent().unwrap()]).unwrap();
        let selected = runtime.select(&search, None).0.unwrap();
        assert_eq!(selected.path, local); assert_eq!(selected.source, "system");
        assert_eq!(runtime.select(&search, Some(">=24")).0.unwrap().path, backup);
        assert!(runtime.select(&search, Some(">=99")).0.is_none());
        assert!(runtime.select(&search, Some("invalid")).0.is_none());
        fs::remove_file(local).unwrap(); assert_eq!(runtime.select(&search, None).0.unwrap().path, backup);
        fs::write(&backup, "tampered").unwrap(); assert!(runtime.select(&search, None).0.is_none());
    }
    #[test]
    fn manual_choice_persists_and_failed_choice_keeps_previous_setting() {
        let root = tempfile::tempdir().unwrap(); let runtime = Runtime::new(Some(root.path().join("app")));
        let local = fake(root.path(), "local", "24.18.0"); let manual = fake(root.path(), "manual", "22.20.0");
        let old = fake(root.path(), "old", "18.0.0"); let search = local.parent().unwrap().as_os_str().to_owned();
        runtime.choose(Some(manual.clone())).unwrap();
        let reopened = Runtime::new(runtime.root.clone());
        assert_eq!(reopened.select(&search, None).0.unwrap().source, "manual");
        assert_eq!(reopened.select(&search, None).0.unwrap().path, manual);
        assert!(reopened.select(&search, Some(">=24")).0.is_none(), "explicit selections do not silently switch");
        assert!(reopened.choose(Some(old)).is_err());
        assert_eq!(reopened.preferences().unwrap().manual_path.as_ref(), Some(&manual));
        fs::remove_file(manual).unwrap(); assert!(reopened.select(&search, None).0.is_none());
        reopened.choose(None).unwrap(); assert_eq!(reopened.select(&search, None).0.unwrap().path, local);
    }
    #[test]
    fn version_manager_shim_resolves_the_actual_node_and_rechecks_changed_target() {
        let root = tempfile::tempdir().unwrap(); let runtime = Runtime::new(None);
        let actual = fake(root.path(), "engine", "24.18.0");
        let shim = fake(root.path(), "shim", "0.0.0");
        fs::write(&shim, format!("#!/bin/sh\nexec '{}' \"$@\"\n", actual.display())).unwrap();
        let search = shim.parent().unwrap().as_os_str().to_owned();
        assert_eq!(runtime.select(&search, None).0.unwrap().path, actual);
        fake(root.path(), "engine", "18.0.0");
        assert!(runtime.select(&search, None).0.is_none());
        fs::remove_file(actual).unwrap();
        assert!(runtime.select(&search, None).0.is_none());
    }
    #[test]
    fn empty_relative_broken_and_wrong_executables_are_not_selected() {
        let root = tempfile::tempdir().unwrap(); let runtime = Runtime::new(Some(root.path().join("app")));
        assert!(runtime.select(&OsString::from(":.:relative"), None).0.is_none());
        let path = fake(root.path(), "wrong", "not-node");
        assert!(runtime.choose(Some(path)).is_err());
        assert!(runtime.preferences().unwrap().manual_path.is_none());
        let path = fake(root.path(), "no access", "24.18.0");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(runtime.choose(Some(path)).is_err());
    }
    #[test]
    fn install_checks_digest_and_does_not_publish_incomplete_archives() {
        let root = tempfile::tempdir().unwrap(); let runtime = Runtime::new(Some(root.path().join("app")));
        let previous = managed(&runtime, "24.18.0");
        assert!(runtime.install(b"incomplete", &distribution().unwrap()).is_err());
        let mut spec = distribution().unwrap(); spec.sha256 = format!("{:x}", Sha256::digest(b"incomplete"));
        assert!(runtime.install(b"incomplete", &spec).is_err());
        assert_eq!(runtime.select(&OsString::new(), None).0.unwrap().path, previous);
        assert_eq!(fs::read_dir(runtime.root.as_ref().unwrap()).unwrap().count(), 2, "failed staging directories cleaned up");
    }
    #[test]
    fn extraction_only_writes_expected_regular_files() {
        let root = tempfile::tempdir().unwrap(); let spec = distribution().unwrap();
        let prefix = spec.archive.trim_end_matches(".tar.gz");
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        for (name, data) in [(format!("{prefix}/bin/node"), "node"), (format!("{prefix}/LICENSE"), "license"), ("unrelated".into(), "ignored")] {
            let mut header = tar::Header::new_gnu(); header.set_size(data.len() as u64); header.set_mode(0o755); header.set_cksum();
            tar.append_data(&mut header, name, data.as_bytes()).unwrap();
        }
        let bytes = tar.into_inner().unwrap().finish().unwrap(); extract(&bytes, &spec, root.path()).unwrap();
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
        assert_eq!(fs::read_to_string(root.path().join("node")).unwrap(), "node");
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()); let mut tar = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu(); header.set_size(0); header.set_mode(0o755); header.set_entry_type(tar::EntryType::Symlink); header.set_link_name("/tmp/not-node").unwrap(); header.set_cksum();
        tar.append_data(&mut header, format!("{prefix}/bin/node"), std::io::empty()).unwrap();
        let bytes = tar.into_inner().unwrap().finish().unwrap(); assert!(extract(&bytes, &spec, root.path()).is_err());
    }
    #[test]
    fn native_node_passes_feature_probe_without_node_options() {
        let node = executable().expect("Install a compatible Node for runtime integration tests");
        assert!(semver::Version::parse(&probe(&node).unwrap().0).unwrap().major >= 22);
    }
    #[test]
    #[ignore = "downloads official Node into isolated temporary application data"]
    fn official_download_runs_with_empty_search_path_and_survives_restart() {
        let root = tempfile::tempdir().unwrap(); let runtime = Runtime::new(Some(root.path().join("app")));
        runtime.download().unwrap();
        let reopened = Runtime::new(runtime.root.clone());
        let selection = reopened.select(&OsString::new(), None).0.unwrap();
        assert_eq!(selection.source, "managed"); assert_eq!(selection.version, distribution().unwrap().version);
        let result = std::process::Command::new(selection.path).env_clear().arg("--version").output().unwrap();
        assert!(result.status.success());
    }
}
