//! External presentation releases contain data and assets, never native executables.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Read,
    path::Path,
};
use tokio::sync::Mutex;

static MUTATION: Mutex<()> = Mutex::const_new(());
const MAX_RESOURCE: u64 = 8 * 1024 * 1024;
const MAX_TOTAL: u64 = 32 * 1024 * 1024;
fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

/// Preinstalled trusted releases. Their identity prefix is reserved, so a local
/// package can never claim to be host-built presentation code.
const BUILTIN_PREFIX: &str = "dev.aibo.builtin.";
const BUILTINS: [&str; 2] = [
    include_str!("../../src/lib/ui-kit/kits/material3/presentation.json"),
    include_str!("../../src/lib/ui-kit/kits/ak-ui/presentation.json"),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Release {
    pub digest: String,
    pub manifest: Value,
    pub enabled: bool,
    /// `builtin` releases execute trusted host code; `local` ones stay isolated.
    pub source: &'static str,
}

fn source_of(plugin_id: &str) -> &'static str {
    if plugin_id.starts_with(BUILTIN_PREFIX) { "builtin" } else { "local" }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Package {
    pub release: Release,
    pub resources: BTreeMap<String, String>,
}

fn token(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"#.,%() /+*-".contains(&b))
        && ![
            "url",
            "expression",
            "image",
            "paint",
            "attr",
            "env",
            "/*",
            "*/",
        ]
        .iter()
        .any(|v| lower.contains(v))
}
fn manifest(source: &str) -> Result<Value, String> {
    if source.len() > 128 * 1024 {
        return Err("presentation_manifest_too_large".into());
    }
    let value: Value = serde_json::from_str(source).map_err(error)?;
    let schema: Value = serde_json::from_str(include_str!(
        "../../contracts/presentation-package.v1.schema.json"
    ))
    .map_err(error)?;
    let validator = jsonschema::options().build(&schema).map_err(error)?;
    if !validator.is_valid(&value) {
        return Err("invalid_presentation_manifest".into());
    }
    let mut paths = HashSet::new();
    let mut total = 0;
    let resources = value["resources"].as_array().unwrap();
    for resource in resources {
        let path = resource["path"].as_str().unwrap().to_ascii_lowercase();
        if path == "presentation.json" || !paths.insert(path) {
            return Err("duplicate_presentation_resource".into());
        }
        total += resource["bytes"].as_u64().unwrap();
    }
    if total > MAX_TOTAL {
        return Err("presentation_package_too_large".into());
    }
    if let Some(entry) = value["entry"].as_str() {
        if !resources
            .iter()
            .any(|r| r["path"] == entry && r["mediaType"] == "text/javascript")
        {
            return Err("missing_presentation_entry".into());
        }
    } else if resources
        .iter()
        .any(|r| r["mediaType"] == "text/javascript")
    {
        return Err("unexpected_presentation_script".into());
    }
    if let Some(themes) = value["themes"].as_array() {
        let mut ids = HashSet::new();
        for theme in themes {
            if !ids.insert(theme["id"].as_str().unwrap()) {
                return Err("invalid_presentation_themes".into());
            }
            if !theme["tokens"]
                .as_object()
                .unwrap()
                .values()
                .all(|v| token(v.as_str().unwrap()))
            {
                return Err("unsafe_presentation_token".into());
            }
        }
        if !ids.contains(value["defaultThemeId"].as_str().unwrap()) {
            return Err("invalid_presentation_themes".into());
        }
    }
    Ok(value)
}

fn read(root: &Path, relative: &str, limit: u64) -> Result<Vec<u8>, String> {
    let mut path = root.to_path_buf();
    for part in Path::new(relative).components() {
        if !matches!(part, std::path::Component::Normal(_)) {
            return Err("invalid_presentation_path".into());
        }
        path.push(part);
        if fs::symlink_metadata(&path)
            .map_err(error)?
            .file_type()
            .is_symlink()
        {
            return Err("presentation_symlink".into());
        }
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(&path).map_err(error)?;
    let metadata = file.metadata().map_err(error)?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("invalid_presentation_resource_size".into());
    }
    if !path.canonicalize().map_err(error)?.starts_with(root) {
        return Err("invalid_presentation_path".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > limit {
        return Err("invalid_presentation_resource_size".into());
    }
    Ok(bytes)
}

fn load(root: &Path) -> Result<(String, Value, BTreeMap<String, Vec<u8>>, String), String> {
    let root = root.canonicalize().map_err(error)?;
    let source = String::from_utf8(read(&root, "presentation.json", 128 * 1024)?).map_err(error)?;
    let manifest = manifest(&source)?;
    let mut resources = BTreeMap::new();
    for resource in manifest["resources"].as_array().unwrap() {
        let path = resource["path"].as_str().unwrap();
        let bytes = read(&root, path, MAX_RESOURCE)?;
        if bytes.len() as u64 != resource["bytes"].as_u64().unwrap() {
            return Err("presentation_resource_size_mismatch".into());
        }
        if format!("{:x}", Sha256::digest(&bytes)) != resource["sha256"].as_str().unwrap() {
            return Err("presentation_resource_integrity_mismatch".into());
        }
        resources.insert(path.to_owned(), bytes);
    }
    Ok((digest(&source, &resources), manifest, resources, source))
}

fn digest(source: &str, resources: &BTreeMap<String, Vec<u8>>) -> String {
    // Manifest carries every resource digest; length framing avoids concatenation ambiguity.
    let mut hash = Sha256::new();
    hash.update((source.len() as u64).to_be_bytes());
    hash.update(source.as_bytes());
    for (path, bytes) in resources {
        hash.update((path.len() as u64).to_be_bytes());
        hash.update(path.as_bytes());
        hash.update((bytes.len() as u64).to_be_bytes());
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}

pub(crate) async fn list(db: &SqlitePool) -> Result<Vec<Release>, String> {
    sqlx::query("SELECT digest,plugin_id,manifest_json,enabled FROM presentation_releases WHERE installed=1 ORDER BY plugin_id,version")
        .fetch_all(db).await.map_err(error)?.into_iter().map(|row| Ok(Release {
            digest: row.get("digest"), manifest: serde_json::from_str(row.get::<&str,_>("manifest_json")).map_err(error)?, enabled: row.get("enabled"),
            source: source_of(row.get("plugin_id")),
        })).collect()
}

/// Register the releases compiled into this host build. Idempotent; a changed
/// build replaces its own earlier built-in rows and keeps each window's choice.
pub(crate) async fn register_builtins(db: &SqlitePool) -> Result<(), String> {
    register(db, &BUILTINS).await
}

async fn register(db: &SqlitePool, sources: &[&str]) -> Result<(), String> {
    let _guard = MUTATION.lock().await;
    let mut tx = db.begin().await.map_err(error)?;
    let mut current = Vec::new();
    for source in sources {
        let manifest = manifest(source)?;
        let id = manifest["id"].as_str().unwrap();
        if !id.starts_with(BUILTIN_PREFIX) || !manifest["resources"].as_array().unwrap().is_empty() {
            return Err("invalid_builtin_presentation".into());
        }
        let digest = digest(source, &BTreeMap::new());
        current.push(digest.clone());
        let stale: Vec<String> = sqlx::query_scalar("SELECT digest FROM presentation_releases WHERE plugin_id=? AND digest<>?")
            .bind(id).bind(&digest).fetch_all(&mut *tx).await.map_err(error)?;
        // Free UNIQUE(plugin_id, version) before inserting a rebuilt release of the same version.
        sqlx::query("UPDATE presentation_releases SET version=version||'+replaced.'||digest,installed=0 WHERE plugin_id=? AND digest<>?")
            .bind(id).bind(&digest).execute(&mut *tx).await.map_err(error)?;
        sqlx::query("INSERT INTO presentation_releases(digest,plugin_id,version,manifest_json) VALUES(?,?,?,?) ON CONFLICT(digest) DO UPDATE SET installed=1,enabled=1")
            .bind(&digest).bind(id).bind(manifest["version"].as_str().unwrap()).bind(*source).execute(&mut *tx).await.map_err(error)?;
        for old in stale {
            let rows = sqlx::query("SELECT window_id,theme_id FROM presentation_selections WHERE digest=?")
                .bind(&old).fetch_all(&mut *tx).await.map_err(error)?;
            for row in rows {
                let theme: Option<String> = row.get("theme_id");
                let theme = theme.filter(|theme| manifest["themes"].as_array().is_some_and(|themes| themes.iter().any(|t| t["id"] == theme.as_str())));
                sqlx::query("UPDATE presentation_selections SET digest=?,theme_id=? WHERE window_id=?")
                    .bind(&digest).bind(theme).bind(row.get::<String, _>("window_id")).execute(&mut *tx).await.map_err(error)?;
            }
            sqlx::query("DELETE FROM presentation_releases WHERE digest=?").bind(&old).execute(&mut *tx).await.map_err(error)?;
        }
    }
    // A kit removed from this build: its windows fall back to the host default.
    let retired: Vec<String> = sqlx::query_scalar("SELECT digest FROM presentation_releases WHERE plugin_id LIKE 'dev.aibo.builtin.%'")
        .fetch_all(&mut *tx).await.map_err(error)?;
    for old in retired.into_iter().filter(|digest| !current.contains(digest)) {
        sqlx::query("DELETE FROM presentation_selections WHERE digest=?").bind(&old).execute(&mut *tx).await.map_err(error)?;
        sqlx::query("DELETE FROM presentation_releases WHERE digest=?").bind(&old).execute(&mut *tx).await.map_err(error)?;
    }
    tx.commit().await.map_err(error)
}

async fn plugin_id(db: &SqlitePool, digest: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT plugin_id FROM presentation_releases WHERE digest=?")
        .bind(digest).fetch_optional(db).await.map_err(error)
}

pub(crate) async fn install(
    db: &SqlitePool,
    data: &Path,
    source: &Path,
) -> Result<Release, String> {
    let _guard = MUTATION.lock().await;
    let (digest, manifest, resources, raw) = load(source)?;
    if source_of(manifest["id"].as_str().unwrap()) == "builtin" {
        return Err("reserved_presentation_id".into());
    }
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT digest FROM presentation_releases WHERE plugin_id=? AND version=?",
    )
    .bind(manifest["id"].as_str().unwrap())
    .bind(manifest["version"].as_str().unwrap())
    .fetch_optional(db)
    .await
    .map_err(error)?;
    if existing.is_some_and(|old| old != digest) {
        return Err("presentation_release_conflict".into());
    }
    let packages = data.join("presentation-packages");
    fs::create_dir_all(&packages).map_err(error)?;
    cleanup_removed(db,data,&digest).await?;
    let destination = packages.join(&digest);
    if destination.exists() {
        if load(&destination)?.0 != digest {
            return Err("presentation_release_corrupt".into());
        }
    } else {
        let stage = packages.join(format!(".staging-{}", ulid::Ulid::new()));
        fs::create_dir(&stage).map_err(error)?;
        let result = (|| {
            fs::write(stage.join("presentation.json"), &raw).map_err(error)?;
            for (path, bytes) in &resources {
                let target = stage.join(path);
                fs::create_dir_all(target.parent().unwrap()).map_err(error)?;
                fs::write(target, bytes).map_err(error)?;
            }
            fs::rename(&stage, &destination).map_err(error)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&stage);
        }
        result?;
    }
    sqlx::query("INSERT INTO presentation_releases(digest,plugin_id,version,manifest_json) VALUES(?,?,?,?) ON CONFLICT(digest) DO UPDATE SET installed=1,enabled=1")
        .bind(&digest).bind(manifest["id"].as_str().unwrap()).bind(manifest["version"].as_str().unwrap()).bind(raw).execute(db).await.map_err(error)?;
    Ok(Release {
        digest,
        manifest,
        enabled: true,
        source: "local",
    })
}

pub(crate) async fn package(db: &SqlitePool, data: &Path, digest: &str) -> Result<Package, String> {
    use base64::Engine;
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM presentation_releases WHERE digest=? AND installed=1 AND enabled=1",
    )
    .bind(digest)
    .fetch_one(db)
    .await
    .map_err(error)?;
    if exists != 1 || digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("presentation_unavailable".into());
    }
    if plugin_id(db, digest).await?.is_some_and(|id| source_of(&id) == "builtin") {
        // Built-in releases have no files: the registered manifest is data only and
        // their executable code is the host build itself. Re-verify before serving.
        let source: String = sqlx::query_scalar("SELECT manifest_json FROM presentation_releases WHERE digest=?")
            .bind(digest).fetch_one(db).await.map_err(error)?;
        if self::digest(&source, &BTreeMap::new()) != digest {
            return Err("presentation_release_corrupt".into());
        }
        return Ok(Package {
            release: Release { digest: digest.to_owned(), manifest: manifest(&source)?, enabled: true, source: "builtin" },
            resources: BTreeMap::new(),
        });
    }
    let (actual, manifest, resources, _) = load(&data.join("presentation-packages").join(digest))?;
    if actual != digest {
        return Err("presentation_release_corrupt".into());
    }
    Ok(Package {
        release: Release {
            digest: actual,
            manifest,
            enabled: true,
            source: "local",
        },
        resources: resources
            .into_iter()
            .map(|(path, bytes)| {
                (
                    path,
                    base64::engine::general_purpose::STANDARD.encode(bytes),
                )
            })
            .collect(),
    })
}

async fn reject_builtin(db: &SqlitePool, digest: &str) -> Result<(), String> {
    if plugin_id(db, digest).await?.is_some_and(|id| source_of(&id) == "builtin") {
        return Err("builtin_presentation_immutable".into());
    }
    Ok(())
}

pub(crate) async fn enable(db: &SqlitePool, digest: &str, enabled: bool) -> Result<(), String> {
    let _guard = MUTATION.lock().await;
    reject_builtin(db, digest).await?;
    let mut tx = db.begin().await.map_err(error)?;
    if sqlx::query("UPDATE presentation_releases SET enabled=? WHERE digest=? AND installed=1")
        .bind(enabled)
        .bind(digest)
        .execute(&mut *tx)
        .await
        .map_err(error)?
        .rows_affected()
        != 1
    {
        return Err("presentation_unavailable".into());
    }
    if !enabled {
        sqlx::query("DELETE FROM presentation_selections WHERE digest=?")
            .bind(digest)
            .execute(&mut *tx)
            .await
            .map_err(error)?;
    }
    tx.commit().await.map_err(error)
}

pub(crate) async fn removal_windows(db: &SqlitePool, digest: &str) -> Result<Vec<String>,String> {
    sqlx::query_scalar("SELECT window_id FROM presentation_selections WHERE digest=? ORDER BY window_id").bind(digest).fetch_all(db).await.map_err(error)
}
async fn cleanup_removed(db:&SqlitePool,data:&Path,digest:&str)->Result<(),String> {
    let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM presentation_removals WHERE digest=?)").bind(digest).fetch_one(db).await.map_err(error)?;
    if pending {
        crate::plugin_lifecycle::remove_owned(data,&["presentation-packages",digest])?;
        sqlx::query("DELETE FROM presentation_removals WHERE digest=?").bind(digest).execute(db).await.map_err(error)?;
    }
    Ok(())
}
pub(crate) async fn collect_removed(db:&SqlitePool,data:&Path)->Result<(),String> {
    let _guard=MUTATION.lock().await;
    let digests:Vec<String>=sqlx::query_scalar("SELECT digest FROM presentation_removals").fetch_all(db).await.map_err(error)?;
    for digest in digests {cleanup_removed(db,data,&digest).await?;}
    Ok(())
}
pub(crate) async fn uninstall(db: &SqlitePool, data: &Path, digest: &str, expected_windows: &[String]) -> Result<(), String> {
    let _guard = MUTATION.lock().await;
    reject_builtin(db, digest).await?;
    if removal_windows(db,digest).await? != expected_windows { return Err("皮肤引用已变化，请重新确认卸载".into()); }
    crate::plugin_lifecycle::owned_path(data,&["presentation-packages",digest])?;
    let mut tx = db.begin().await.map_err(error)?;
    sqlx::query("DELETE FROM presentation_selections WHERE digest=?")
        .bind(digest)
        .execute(&mut *tx)
        .await
        .map_err(error)?;
    sqlx::query("UPDATE presentation_releases SET installed=0,enabled=0 WHERE digest=?")
        .bind(digest)
        .execute(&mut *tx)
        .await
        .map_err(error)?;
    sqlx::query("INSERT INTO presentation_removals VALUES(?) ON CONFLICT DO NOTHING").bind(digest).execute(&mut *tx).await.map_err(error)?;
    tx.commit().await.map_err(error)?;
    cleanup_removed(db,data,digest).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Selection {
    pub digest: String,
    pub theme_id: Option<String>,
}

pub(crate) async fn selection(db: &SqlitePool, window: &str) -> Result<Option<Selection>, String> {
    Ok(sqlx::query("SELECT s.digest,s.theme_id FROM presentation_selections s JOIN presentation_releases p ON p.digest=s.digest WHERE window_id=? AND p.installed=1 AND p.enabled=1")
        .bind(window).fetch_optional(db).await.map_err(error)?.map(|row| Selection { digest: row.get("digest"), theme_id: row.get("theme_id") }))
}

/// Commit only after frontend candidate preflight. Expected selection prevents stale commits.
pub(crate) async fn select(
    db: &SqlitePool,
    data: &Path,
    window: &str,
    digest: Option<&str>,
    theme: Option<&str>,
    expected: Option<&str>,
) -> Result<(), String> {
    let _guard = MUTATION.lock().await;
    if selection(db, window)
        .await?
        .as_ref()
        .map(|s| s.digest.as_str())
        != expected
    {
        return Err("presentation_selection_superseded".into());
    }
    if let Some(digest) = digest {
        let package = package(db, data, digest).await?;
        if let Some(theme) = theme {
            if !package.release.manifest["themes"]
                .as_array()
                .is_some_and(|themes| themes.iter().any(|t| t["id"] == theme))
            {
                return Err("invalid_presentation_theme".into());
            }
        }
        sqlx::query("INSERT INTO presentation_selections(window_id,digest,theme_id) VALUES(?,?,?) ON CONFLICT(window_id) DO UPDATE SET digest=excluded.digest,theme_id=excluded.theme_id")
            .bind(window).bind(digest).bind(theme).execute(db).await.map_err(error)?;
    } else {
        sqlx::query("DELETE FROM presentation_selections WHERE window_id=?")
            .bind(window)
            .execute(db)
            .await
            .map_err(error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(root: &Path, version: &str) {
        fs::create_dir_all(root).unwrap();
        let script = b"globalThis.presentation = {};";
        fs::write(root.join("skin.js"), script).unwrap();
        let value = json!({"schema":"aibo.presentation-package/v1","id":"dev.example.skin","version":version,"displayName":"Example","hostApi":"1.0.0","coreSemantics":"1.0.0","snapshotSchemas":["aibo.semantic-view/v1"],"entry":"skin.js","surfaces":["workbench"],"resources":[{"path":"skin.js","bytes":script.len(),"sha256":format!("{:x}",Sha256::digest(script)),"mediaType":"text/javascript"}],"themes":[{"id":"dark","label":"Dark","colorScheme":"dark","tokens":{"--primary":"#123456"}}],"defaultThemeId":"dark"});
        fs::write(root.join("presentation.json"), value.to_string()).unwrap();
    }
    fn temp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("aibo-presentation-{}", ulid::Ulid::new()))
    }

    fn builtin(version: &str, token: &str) -> String {
        json!({"schema":"aibo.presentation-package/v1","id":"dev.aibo.builtin.example","version":version,"displayName":"Example","hostApi":"1.0.0","coreSemantics":"1.0.0","snapshotSchemas":["aibo.semantic-view/v1"],"resources":[],"themes":[{"id":"light","label":"Light","colorScheme":"light","tokens":{"--primary":token}},{"id":"dark","label":"Dark","colorScheme":"dark","tokens":{"--primary":token}}],"defaultThemeId":"light"}).to_string()
    }

    #[tokio::test]
    async fn builtin_releases_register_idempotently_and_keep_window_choice_across_rebuilds() {
        let root = temp();
        let db = crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
        register_builtins(&db).await.unwrap();
        register_builtins(&db).await.unwrap();
        let shipped = list(&db).await.unwrap();
        assert_eq!(shipped.iter().filter(|release| release.source == "builtin").count(), BUILTINS.len());
        for release in &shipped {
            let package = package(&db, &root, &release.digest).await.unwrap();
            assert!(package.resources.is_empty(), "built-in content never comes from disk");
            assert_eq!(package.release.manifest, release.manifest);
            assert_eq!(enable(&db, &release.digest, false).await.unwrap_err(), "builtin_presentation_immutable");
            assert_eq!(uninstall(&db, &root, &release.digest, &[]).await.unwrap_err(), "builtin_presentation_immutable");
        }

        let first = builtin("1.0.0", "#111111");
        register(&db, &[&first]).await.unwrap();
        let old = list(&db).await.unwrap().into_iter().find(|release| release.manifest["id"] == "dev.aibo.builtin.example").unwrap();
        assert!(list(&db).await.unwrap().iter().all(|release| release.source != "builtin" || release.digest == old.digest),
            "kits missing from the build are retired");
        select(&db, &root, "main", Some(&old.digest), Some("dark"), None).await.unwrap();
        select(&db, &root, "other", Some(&old.digest), None, None).await.unwrap();

        // A rebuilt host may change content without a version bump.
        let rebuilt = builtin("1.0.0", "#222222");
        register(&db, &[&rebuilt]).await.unwrap();
        let new = list(&db).await.unwrap().into_iter().find(|release| release.manifest["id"] == "dev.aibo.builtin.example").unwrap();
        assert_ne!(new.digest, old.digest);
        let main = selection(&db, "main").await.unwrap().unwrap();
        assert_eq!((main.digest.as_str(), main.theme_id.as_deref()), (new.digest.as_str(), Some("dark")));
        assert_eq!(selection(&db, "other").await.unwrap().unwrap().digest, new.digest);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM presentation_releases WHERE plugin_id='dev.aibo.builtin.example'")
            .fetch_one(&db).await.unwrap();
        assert_eq!(count, 1);

        register(&db, &[]).await.unwrap();
        assert!(selection(&db, "main").await.unwrap().is_none(), "a retired kit falls back to the default");
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn host_api_accepts_known_bridge_versions_only() {
        for (version, accepted) in [("1.0.0", true), ("1.1.0", true), ("1.2.0", false), ("2.0.0", false)] {
            let source = builtin("1.0.0", "#444444").replace("\"hostApi\":\"1.0.0\"", &format!("\"hostApi\":\"{version}\""));
            assert_eq!(manifest(&source).is_ok(), accepted, "hostApi {version}");
        }
    }

    #[tokio::test]
    async fn local_packages_cannot_claim_builtin_identity() {
        let root = temp();
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("presentation.json"), builtin("1.0.0", "#333333")).unwrap();
        let db = crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
        assert_eq!(install(&db, &root, &source).await.unwrap_err(), "reserved_presentation_id");
        let local = builtin("1.0.0", "#333333").replace("dev.aibo.builtin.example", "dev.example.skin");
        assert_eq!(register(&db, &[&local]).await.unwrap_err(), "invalid_builtin_presentation");
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn disk_install_upgrade_restart_disable_and_reinstall_preserve_selection_rules() {
        let root = temp();
        let source = root.join("source");
        fixture(&source, "1.0.0");
        let db_path = root.join("aibo.sqlite3");
        let db = crate::open_database(&db_path).await.unwrap();
        let first = install(&db, &root, &source).await.unwrap();
        assert!(
            selection(&db, "main").await.unwrap().is_none(),
            "install is not activation"
        );
        select(&db, &root, "main", Some(&first.digest), Some("dark"), None)
            .await
            .unwrap();
        assert!(selection(&db, "second").await.unwrap().is_none());
        fixture(&source, "2.0.0");
        let second = install(&db, &root, &source).await.unwrap();
        assert_eq!(
            selection(&db, "main").await.unwrap().unwrap().digest,
            first.digest
        );
        assert!(select(&db, &root, "main", Some(&second.digest), None, None)
            .await
            .unwrap_err()
            .contains("superseded"));
        assert!(select(
            &db,
            &root,
            "main",
            Some(&second.digest),
            Some("missing"),
            Some(&first.digest)
        )
        .await
        .is_err());
        select(
            &db,
            &root,
            "main",
            Some(&second.digest),
            None,
            Some(&first.digest),
        )
        .await
        .unwrap();
        db.close().await;
        let db = crate::open_database(&db_path).await.unwrap();
        assert_eq!(
            selection(&db, "main").await.unwrap().unwrap().digest,
            second.digest
        );
        enable(&db, &second.digest, false).await.unwrap();
        assert!(selection(&db, "main").await.unwrap().is_none());
        assert!(package(&db, &root, &second.digest).await.is_err());
        select(&db, &root, "main", Some(&first.digest), None, None)
            .await
            .unwrap();
        let windows=removal_windows(&db,&first.digest).await.unwrap();
        uninstall(&db, &root, &first.digest, &windows).await.unwrap();
        assert!(!root.join("presentation-packages").join(&first.digest).exists());
        assert!(selection(&db, "main").await.unwrap().is_none());
        assert!(package(&db, &root, &first.digest).await.is_err());
        fixture(&source, "1.0.0");
        assert_eq!(
            install(&db, &root, &source).await.unwrap().digest,
            first.digest
        );
        assert!(package(&db, &root, &first.digest).await.is_ok());
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn corruption_and_same_version_replacement_never_replace_active_release() {
        let root = temp();
        let source = root.join("source");
        fixture(&source, "1.0.0");
        let db = crate::open_database(&root.join("aibo.sqlite3"))
            .await
            .unwrap();
        let release = install(&db, &root, &source).await.unwrap();
        select(&db, &root, "main", Some(&release.digest), None, None)
            .await
            .unwrap();
        let path = source.join("presentation.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["displayName"] = json!("Changed");
        fs::write(path, value.to_string()).unwrap();
        assert!(install(&db, &root, &source)
            .await
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(
            selection(&db, "main").await.unwrap().unwrap().digest,
            release.digest
        );
        fs::write(
            root.join("presentation-packages")
                .join(&release.digest)
                .join("skin.js"),
            b"tampered",
        )
        .unwrap();
        assert!(package(&db, &root, &release.digest).await.is_err());
        assert!(
            select(&db, &root, "second", Some(&release.digest), None, None)
                .await
                .is_err()
        );
        assert!(selection(&db, "second").await.unwrap().is_none());
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn schema_and_semantics_reject_traversal_network_tokens_and_oversized_packages() {
        let root = temp();
        fixture(&root, "1.0.0");
        let original: Value =
            serde_json::from_slice(&fs::read(root.join("presentation.json")).unwrap()).unwrap();
        for path in [
            "../secret",
            "/secret",
            "dir/../secret",
            "dir\\secret",
            "skin.js/child",
            "https://example.com/script",
        ] {
            let mut value = original.clone();
            value["resources"][0]["path"] = json!(path);
            assert!(manifest(&value.to_string()).is_err(), "{path}");
        }
        for text in [
            "url(https://example.com)",
            "red;display:none",
            "u\\72l(x)",
            "/*x*/red",
        ] {
            let mut value = original.clone();
            value["themes"][0]["tokens"]["--primary"] = json!(text);
            assert!(manifest(&value.to_string()).is_err());
        }
        let mut value = original.clone();
        value["resources"][0]["bytes"] = json!(MAX_RESOURCE + 1);
        assert!(manifest(&value.to_string()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_resource_and_manifest() {
        use std::os::unix::fs::symlink;
        let root = temp();
        let source = root.join("source");
        fixture(&source, "1.0.0");
        fs::rename(source.join("skin.js"), root.join("outside.js")).unwrap();
        symlink(root.join("outside.js"), source.join("skin.js")).unwrap();
        assert!(load(&source).unwrap_err().contains("symlink"));
        fs::remove_file(source.join("skin.js")).unwrap();
        fixture(&source, "1.0.0");
        fs::rename(source.join("presentation.json"), root.join("outside.json")).unwrap();
        symlink(root.join("outside.json"), source.join("presentation.json")).unwrap();
        assert!(load(&source).unwrap_err().contains("symlink"));
        fs::remove_dir_all(root).unwrap();
    }
}
