//! Replacement previews, durable undo, and crash recovery. No business history is rolled back.
use crate::{
    plugin_lifecycle::{self, error, Impact},
    plugin_registry,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    #[serde(skip)]
    pub digest: String,
    pub plugin_id: String,
    pub version: String,
    pub kind: String,
    pub token: String,
    pub previous: Vec<String>,
    pub impacts: Vec<Impact>,
    pub blockers: Vec<String>,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct Release {
    pub id: String,
    pub enabled: bool,
    pub enabled_at: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct SavedSession {
    pub id: String,
    pub source: String,
    pub binding: Option<String>,
    pub capabilities: Option<String>,
    pub bound_at: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct Snapshot {
    pub releases: Vec<Release>,
    pub sessions: Vec<SavedSession>,
    pub bindings: Vec<Value>,
}

pub(crate) async fn preview(db: &SqlitePool, source: &Path) -> Result<Preview, String> {
    let source = source.canonicalize().map_err(error)?;
    let (manifest, _, digest) = plugin_registry::inspect(&source)?;
    let plugin = manifest["pluginId"].as_str().ok_or("invalid pluginId")?;
    let version = manifest["version"].as_str().ok_or("invalid version")?;
    let next = semver::Version::parse(version).map_err(error)?;
    let rows=sqlx::query("SELECT id,plugin_version,package_digest,enabled FROM plugin_installations WHERE plugin_id=? AND installed=1 ORDER BY id")
        .bind(plugin).fetch_all(db).await.map_err(error)?;
    let mut kind = "install";
    let mut impacts = vec![];
    let mut previous = vec![];
    let mut blockers = vec![];
    for row in &rows {
        let old = semver::Version::parse(row.get("plugin_version")).map_err(error)?;
        if old > next {
            kind = "downgrade";
        } else if kind != "downgrade" {
            kind = if old == next { "replace" } else { "upgrade" };
        }
        let impact = plugin_lifecycle::impact(db, row.get("id")).await?;
        if impact.active > 0 {
            blockers.push("请先停止插件正在运行的任务，再替换版本".into());
        }
        if !impact.dependencies.is_empty() {
            blockers.push("仍有其他插件固定依赖此版本，请先处理依赖引用".into());
        }
        let candidates: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM capability_binding_candidates WHERE installation_id=?",
        )
        .bind(row.get::<String, _>("id"))
        .fetch_one(db)
        .await
        .map_err(error)?;
        if candidates > 0 {
            blockers.push("存在尚未完成的能力选择，请完成或取消后重试".into());
        }
        previous.push(row.get::<String, _>("plugin_version"));
        impacts.push(impact);
    }
    if rows.len() == 1 && rows[0].get::<String, _>("package_digest") == digest {
        kind = "installed";
        blockers.clear();
    }
    if rows.len() > 1
        && rows
            .iter()
            .any(|row| row.get::<String, _>("package_digest") == digest)
    {
        blockers.push("已有多个历史安装版本，请先卸载其余版本再安装此包".into());
    }
    // Snapshot references and the package bytes both participate in confirmation.
    let snapshot = snapshot(db, plugin).await?;
    let token = format!(
        "{:x}",
        Sha256::digest(json!([digest, snapshot, impacts]).to_string().as_bytes())
    );
    Ok(Preview {
        digest,
        plugin_id: plugin.into(),
        version: version.into(),
        kind: kind.into(),
        token,
        previous,
        impacts,
        blockers,
    })
}

pub(crate) async fn snapshot(db: &SqlitePool, plugin: &str) -> Result<Snapshot, String> {
    let releases=sqlx::query("SELECT id,enabled,enabled_at FROM plugin_installations WHERE plugin_id=? AND installed=1 ORDER BY id")
        .bind(plugin).fetch_all(db).await.map_err(error)?.into_iter().map(|r|Release{id:r.get("id"),enabled:r.get::<i64,_>("enabled")!=0,enabled_at:r.get("enabled_at")}).collect();
    let sessions=sqlx::query("SELECT s.id,s.plugin_installation_id,b.plugin_binding_json,b.plugin_capabilities_json,b.bound_at FROM sessions s JOIN plugin_installations p ON p.id=s.plugin_installation_id LEFT JOIN session_bindings b ON b.session_id=s.id WHERE p.plugin_id=? AND p.installed=1 AND s.id NOT IN (SELECT session_id FROM plugin_session_retirements) ORDER BY s.id")
        .bind(plugin).fetch_all(db).await.map_err(error)?.into_iter().map(|r|SavedSession{id:r.get("id"),source:r.get("plugin_installation_id"),binding:r.get("plugin_binding_json"),capabilities:r.get("plugin_capabilities_json"),bound_at:r.get("bound_at")}).collect();
    let bindings:Vec<String>=sqlx::query_scalar("SELECT json_object('scope_kind',b.scope_kind,'scope_id',b.scope_id,'capability_id',b.capability_id,'contract_version',b.contract_version,'installation_id',b.installation_id,'contribution_id',b.contribution_id,'updated_at',b.updated_at) FROM capability_provider_bindings b JOIN plugin_installations p ON p.id=b.installation_id WHERE p.plugin_id=? AND p.installed=1 ORDER BY b.scope_kind,b.scope_id,b.capability_id,b.contract_version")
        .bind(plugin).fetch_all(db).await.map_err(error)?;
    Ok(Snapshot {
        releases,
        sessions,
        bindings: bindings
            .into_iter()
            .map(|v| serde_json::from_str(&v).map_err(error))
            .collect::<Result<_, _>>()?,
    })
}

// Called with plugin admission blocked, or before starting any runtime on boot.
pub(crate) async fn restore(db: &SqlitePool, plugin: &str) -> Result<(), String> {
    let row=sqlx::query("SELECT target_id,snapshot_json FROM plugin_replacements WHERE plugin_id=? AND phase='preparing'")
        .bind(plugin).fetch_one(db).await.map_err(error)?;
    let target: String = row.get("target_id");
    let saved: Snapshot = serde_json::from_str(row.get("snapshot_json")).map_err(error)?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await.map_err(error)?;
    for old in &saved.releases {
        sqlx::query("UPDATE plugin_installations SET installed=1,enabled=?,enabled_at=?,removed_at=NULL WHERE id=?")
            .bind(old.enabled).bind(&old.enabled_at).bind(&old.id).execute(&mut *tx).await.map_err(error)?;
    }
    for session in &saved.sessions {
        sqlx::query("INSERT INTO plugin_session_migrations SELECT ?,s.id,s.plugin_installation_id,?,b.plugin_binding_json,? FROM sessions s LEFT JOIN session_bindings b ON b.session_id=s.id WHERE s.id=? AND s.plugin_installation_id<>?")
            .bind(ulid::Ulid::new().to_string()).bind(&session.source).bind(crate::now_iso()).bind(&session.id).bind(&session.source).execute(&mut *tx).await.map_err(error)?;
        sqlx::query("UPDATE sessions SET plugin_installation_id=? WHERE id=?")
            .bind(&session.source)
            .bind(&session.id)
            .execute(&mut *tx)
            .await
            .map_err(error)?;
        sqlx::query("UPDATE session_bindings SET plugin_binding_json=?,plugin_capabilities_json=?,generation_id=NULL,bound_at=? WHERE session_id=?")
            .bind(&session.binding).bind(&session.capabilities).bind(&session.bound_at).bind(&session.id).execute(&mut *tx).await.map_err(error)?;
        sqlx::query("DELETE FROM plugin_session_candidates WHERE session_id=?")
            .bind(&session.id)
            .execute(&mut *tx)
            .await
            .map_err(error)?;
    }
    sqlx::query("DELETE FROM capability_provider_bindings WHERE installation_id=?")
        .bind(&target)
        .execute(&mut *tx)
        .await
        .map_err(error)?;
    for binding in &saved.bindings {
        sqlx::query("INSERT OR REPLACE INTO capability_provider_bindings VALUES(?,?,?,?,?,?,?)")
            .bind(binding["scope_kind"].as_str())
            .bind(binding["scope_id"].as_str())
            .bind(binding["capability_id"].as_str())
            .bind(binding["contract_version"].as_str())
            .bind(binding["installation_id"].as_str())
            .bind(binding["contribution_id"].as_str())
            .bind(binding["updated_at"].as_str())
            .execute(&mut *tx)
            .await
            .map_err(error)?;
    }
    sqlx::query("DELETE FROM capability_binding_candidates WHERE installation_id=?")
        .bind(&target)
        .execute(&mut *tx)
        .await
        .map_err(error)?;
    sqlx::query("UPDATE plugin_installations SET installed=0,enabled=0,removed_at=? WHERE id=?")
        .bind(crate::now_iso())
        .bind(&target)
        .execute(&mut *tx)
        .await
        .map_err(error)?;
    sqlx::query(
        "INSERT OR IGNORE INTO plugin_removals SELECT id,? FROM plugin_installations WHERE id=?",
    )
    .bind(crate::now_iso())
    .bind(&target)
    .execute(&mut *tx)
    .await
    .map_err(error)?;
    sqlx::query("DELETE FROM plugin_replacements WHERE plugin_id=?")
        .bind(plugin)
        .execute(&mut *tx)
        .await
        .map_err(error)?;
    tx.commit().await.map_err(error)
}

pub(crate) async fn recover(db: &SqlitePool, data: &Path) -> Result<(), String> {
    let pending: Vec<String> =
        sqlx::query_scalar("SELECT plugin_id FROM plugin_replacements WHERE phase='preparing'")
            .fetch_all(db)
            .await
            .map_err(error)?;
    for plugin in pending {
        let target: String =
            sqlx::query_scalar("SELECT target_id FROM plugin_replacements WHERE plugin_id=?")
                .bind(&plugin)
                .fetch_one(db)
                .await
                .map_err(error)?;
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plugin_installations WHERE id=?)")
                .bind(&target)
                .fetch_one(db)
                .await
                .map_err(error)?;
        if !exists {
            plugin_lifecycle::remove_owned(data, &["plugins", &target])?;
            plugin_lifecycle::remove_owned(data, &["plugins", &format!(".staging-{target}")])?;
        }
        restore(db, &plugin).await?;
    }
    collect(db, data).await
}
pub(crate) async fn collect(db: &SqlitePool, data: &Path) -> Result<(), String> {
    plugin_registry::collect_retired(db, data).await?;
    sqlx::query("DELETE FROM plugin_replacements WHERE phase='expired'")
        .execute(db)
        .await
        .map_err(error)?;
    Ok(())
}
pub(crate) async fn expire(db: &SqlitePool, plugin: &str, data: &Path) -> Result<(), String> {
    sqlx::query(
        "UPDATE plugin_replacements SET phase='expired' WHERE plugin_id=? AND phase='ready'",
    )
    .bind(plugin)
    .execute(db)
    .await
    .map_err(error)?;
    collect(db, data).await
}
pub(crate) async fn undo_targets(db: &SqlitePool) -> Result<Vec<String>, String> {
    sqlx::query_scalar("SELECT target_id FROM plugin_replacements WHERE phase='ready'")
        .fetch_all(db)
        .await
        .map_err(error)
}
