//! Host-owned removal previews and session migration. Package history is not recovery data.
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};

pub(crate) fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reference {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub localized_label: Option<serde_json::Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Impact {
    pub id: String,
    pub token: String,
    pub sessions: Vec<Reference>,
    pub dependencies: Vec<Reference>,
    pub bindings: Vec<Reference>,
    pub active: i64,
    pub targets: Vec<Reference>,
}

fn confirmation_references(items: &[Reference]) -> Vec<serde_json::Value> {
    items.iter().map(|item|serde_json::json!({"id":item.id,"label":item.label})).collect()
}
impl Impact {
    /// Display metadata never participates in package or reference confirmation identity.
    pub(crate) fn confirmation_value(&self) -> serde_json::Value {
        serde_json::json!({"id":self.id,"token":self.token,"sessions":confirmation_references(&self.sessions),"dependencies":confirmation_references(&self.dependencies),"bindings":confirmation_references(&self.bindings),"active":self.active,"targets":confirmation_references(&self.targets)})
    }
}

pub(crate) async fn impact(db: &SqlitePool, id: &str) -> Result<Impact, crate::ui_i18n::HostMessage> {
    let row = sqlx::query(
        "SELECT plugin_id,plugin_version FROM plugin_installations WHERE id=? AND installed=1",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(error)?
    .ok_or_else(||crate::ui_i18n::HostMessage::new("native.plugin.uninstalled",serde_json::json!({})))?;
    let sessions = sqlx::query("SELECT id,label FROM sessions WHERE plugin_installation_id=? AND id NOT IN (SELECT session_id FROM plugin_session_retirements) ORDER BY id")
        .bind(id).fetch_all(db).await.map_err(error)?.into_iter().map(|row|Reference{id:row.get("id"),label:row.get("label"),localized_label:None}).collect();
    let dependencies = sqlx::query("SELECT DISTINCT p.id,COALESCE(json_extract(p.manifest_json,'$.displayName'),p.plugin_id)||' · '||p.plugin_version AS label FROM plugin_dependency_bindings d JOIN plugin_installations p ON p.id=d.installation_id WHERE d.dependency_installation_id=? AND p.installed=1 AND p.id<>? ORDER BY p.id")
        .bind(id).bind(id).fetch_all(db).await.map_err(error)?.into_iter().map(|row|Reference{id:row.get("id"),label:row.get("label"),localized_label:None}).collect();
    let bindings = sqlx::query("SELECT scope_kind||':'||scope_id||':'||capability_id||':'||contract_version AS id,contribution_id||' · '||scope_kind||'/'||scope_id||' · '||capability_id AS label,NULL AS candidate_contribution FROM capability_provider_bindings WHERE installation_id=? UNION SELECT 'candidate:'||candidate_id AS id,contribution_id||' · 候选绑定' AS label,contribution_id AS candidate_contribution FROM capability_binding_candidates WHERE installation_id=? ORDER BY id")
        .bind(id).bind(id).fetch_all(db).await.map_err(error)?.into_iter().map(|row|Reference{id:row.get("id"),label:row.get("label"),localized_label:row.get::<Option<String>,_>("candidate_contribution").map(|contribution|crate::ui_i18n::display_descriptor("native.plugin.candidateBinding",serde_json::json!({"contribution":contribution})))}).collect();
    let active = sqlx::query_scalar(
        "SELECT COUNT(*) FROM capability_invocations WHERE installation_id=? AND status='running'",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(error)?;
    let version = semver::Version::parse(row.get("plugin_version")).map_err(error)?;
    let targets = sqlx::query("SELECT id,plugin_version FROM plugin_installations WHERE plugin_id=? AND installed=1 AND enabled=1 ORDER BY plugin_version,id")
        .bind(row.get::<String,_>("plugin_id")).fetch_all(db).await.map_err(error)?.into_iter()
        .filter(|row|semver::Version::parse(row.get("plugin_version")).is_ok_and(|other|other>version))
        .map(|row|Reference{id:row.get("id"),label:row.get("plugin_version"),localized_label:None}).collect();
    let mut result = Impact {
        id: id.into(),
        token: String::new(),
        sessions,
        dependencies,
        bindings,
        active,
        targets,
    };
    // Activity can finish while the dialog is open; the set of affected references must not change.
    result.token = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                &result.id,
                confirmation_references(&result.sessions),
                confirmation_references(&result.dependencies),
                confirmation_references(&result.bindings)
            ))
            .map_err(error)?
        )
    );
    Ok(result)
}

/// Only accept host-owned descendants. Never follow a substituted directory symlink.
pub(crate) fn owned_path(root: &Path, parts: &[&str]) -> Result<PathBuf, String> {
    owned_path_display(root, parts).map_err(|error|error.diagnostic)
}

pub(crate) fn owned_path_display(root: &Path, parts: &[&str]) -> Result<PathBuf, crate::ui_i18n::HostMessage> {
    let mut path = root.canonicalize().map_err(error)?;
    for part in parts {
        if part.is_empty()
            || *part == "."
            || *part == ".."
            || !part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        {
            return Err(crate::ui_i18n::HostMessage::new("native.registry.storagePath",serde_json::json!({})));
        }
        path.push(part);
        match std::fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err(crate::ui_i18n::HostMessage::new("native.registry.storageDirectory",serde_json::json!({})))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(error(e).into()),
        }
    }
    Ok(path)
}
pub(crate) fn remove_owned(root: &Path, parts: &[&str]) -> Result<(), String> {
    remove_owned_display(root, parts).map_err(|error|error.diagnostic)
}

pub(crate) fn remove_owned_display(root: &Path, parts: &[&str]) -> Result<(), crate::ui_i18n::HostMessage> {
    let path = owned_path_display(root, parts)?;
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(error)?;
    }
    Ok(())
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationReport {
    pub migrated: Vec<String>,
    pub failed: Vec<Reference>,
}

pub(crate) async fn recover_candidates(db: &SqlitePool, data: &Path) -> Result<(), String> {
    let rows=sqlx::query("SELECT c.session_id,c.installation_id,p.plugin_id,i.id AS instance_id FROM plugin_session_candidates c JOIN sessions s ON s.id=c.session_id JOIN plugin_installations p ON p.id=c.installation_id JOIN capability_instances i ON i.installation_id=c.installation_id AND i.scope_kind='session' AND i.scope_id=c.session_id AND i.contribution_id=s.agent WHERE s.plugin_installation_id<>c.installation_id")
        .fetch_all(db).await.map_err(error)?;
    for row in rows {
        remove_owned(
            data,
            &[
                "plugin-data",
                row.get("plugin_id"),
                row.get("installation_id"),
                "v1",
                row.get("instance_id"),
            ],
        )?;
    }
    sqlx::query("DELETE FROM plugin_session_candidates")
        .execute(db)
        .await
        .map_err(error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Connection;

    #[tokio::test]
    async fn plugin_lifecycle_migration_preserves_history_and_policy_across_reopen() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("aibo.sqlite3");
        let mut connection = sqlx::SqliteConnection::connect_with(
            &sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .foreign_keys(false)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = old
            .iter()
            .filter(|migration| migration.version <= 54)
            .cloned()
            .collect::<Vec<_>>()
            .into();
        old.run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/fixture','Fixture',1,'now','now'); INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('s','w','legacy','History','idle','now','now'); INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('m','s','assistant','history preserved','completed','now','now');")
            .execute(&mut connection).await.unwrap();
        let checksums: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&mut connection)
                .await
                .unwrap();
        connection.close().await.unwrap();
        // The retired upgrade policy row is no longer read, but migration 55 still creates and keeps it.
        let stored = |db: SqlitePool| async move {
            sqlx::query_scalar::<_, String>("SELECT policy FROM plugin_upgrade_preferences WHERE id=1")
                .fetch_one(&db)
                .await
                .unwrap()
        };
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(stored(db.clone()).await, "automatic");
        sqlx::query("UPDATE plugin_upgrade_preferences SET policy='pinned' WHERE id=1")
            .execute(&db)
            .await
            .unwrap();
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(stored(db.clone()).await, "pinned");
        let after: Vec<(i64, Vec<u8>)> = sqlx::query_as(
            "SELECT version,checksum FROM _sqlx_migrations WHERE version<=54 ORDER BY version",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(checksums, after);
        let content: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='m'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(content, "history preserved");
        assert!(sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&db)
            .await
            .unwrap()
            .is_empty());
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(integrity, "ok");
        db.close().await;
    }

    #[tokio::test]
    async fn candidate_display_metadata_preserves_legacy_confirmation_identity() {
        let db=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE plugin_installations(id TEXT,plugin_id TEXT,plugin_version TEXT,installed INTEGER,enabled INTEGER,manifest_json TEXT);
          CREATE TABLE sessions(id TEXT,label TEXT,plugin_installation_id TEXT);
          CREATE TABLE plugin_session_retirements(session_id TEXT);
          CREATE TABLE plugin_dependency_bindings(installation_id TEXT,dependency_installation_id TEXT);
          CREATE TABLE capability_provider_bindings(installation_id TEXT,scope_kind TEXT,scope_id TEXT,capability_id TEXT,contract_version TEXT,contribution_id TEXT);
          CREATE TABLE capability_binding_candidates(installation_id TEXT,candidate_id TEXT,contribution_id TEXT);
          CREATE TABLE capability_invocations(installation_id TEXT,status TEXT);
          INSERT INTO plugin_installations VALUES('old','plugin','1.0.0',1,1,'{}');
          INSERT INTO capability_binding_candidates VALUES('old','candidate','原文{contribution}');").execute(&db).await.unwrap();
        let value=impact(&db,"old").await.unwrap();
        let legacy=serde_json::json!(["old",[],[],[{"id":"candidate:candidate","label":"原文{contribution} · 候选绑定"}]]);
        assert_eq!(value.token,format!("{:x}",Sha256::digest(legacy.to_string().as_bytes())));
        let display=value.bindings[0].localized_label.as_ref().unwrap();
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,display),"原文{contribution} · candidate binding");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,display),value.bindings[0].label);
        let confirmation=value.confirmation_value();
        assert!(confirmation["bindings"][0].get("localizedLabel").is_none());
        assert!(serde_json::to_value(&value).unwrap()["bindings"][0].get("localizedLabel").is_some());
        assert_eq!(impact(&db,"old").await.unwrap().token,value.token);
        sqlx::query("UPDATE capability_binding_candidates SET contribution_id='real change'").execute(&db).await.unwrap();
        assert_ne!(impact(&db,"old").await.unwrap().token,value.token);
        db.close().await;
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_rejects_symlinked_private_directories_and_path_escape() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep"), "history").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("plugin-data")).unwrap();
        let symlink = remove_owned_display(root.path(), &["plugin-data", "plugin", "release"]).unwrap_err();
        assert_eq!(symlink.diagnostic, "插件存储路径不是安全目录");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &symlink.display()), "The plugin storage path is not a safe directory.");
        let escape = remove_owned_display(root.path(), &["../outside"]).unwrap_err();
        assert_eq!(escape.diagnostic, "无效的插件存储路径");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &escape.display()), "The plugin storage path is invalid.");
        assert_eq!(remove_owned(root.path(), &["../outside"]).unwrap_err(), escape.diagnostic);
        assert!(outside.path().join("keep").exists());
    }
}
