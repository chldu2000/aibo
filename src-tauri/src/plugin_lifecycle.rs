//! Host-owned removal previews and upgrade policy. Package history is not recovery data.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum UpgradePolicy {
    Automatic,
    Ask,
    Pinned,
}

pub(crate) async fn policy(db: &SqlitePool) -> Result<UpgradePolicy, String> {
    let value: String =
        sqlx::query_scalar("SELECT policy FROM plugin_upgrade_preferences WHERE id=1")
            .fetch_one(db)
            .await
            .map_err(error)?;
    serde_json::from_value(serde_json::Value::String(value)).map_err(error)
}
pub(crate) async fn save_policy(
    db: &SqlitePool,
    policy: UpgradePolicy,
) -> Result<UpgradePolicy, String> {
    sqlx::query("UPDATE plugin_upgrade_preferences SET policy=? WHERE id=1")
        .bind(
            serde_json::to_value(policy)
                .map_err(error)?
                .as_str()
                .unwrap(),
        )
        .execute(db)
        .await
        .map_err(error)?;
    Ok(policy)
}
pub(crate) fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reference {
    pub id: String,
    pub label: String,
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

pub(crate) async fn impact(db: &SqlitePool, id: &str) -> Result<Impact, String> {
    let row = sqlx::query(
        "SELECT plugin_id,plugin_version FROM plugin_installations WHERE id=? AND installed=1",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(error)?
    .ok_or("插件已卸载，请刷新列表")?;
    let sessions = sqlx::query("SELECT id,label FROM sessions WHERE plugin_installation_id=? AND id NOT IN (SELECT session_id FROM plugin_session_retirements) ORDER BY id")
        .bind(id).fetch_all(db).await.map_err(error)?.into_iter().map(|row|Reference{id:row.get("id"),label:row.get("label")}).collect();
    let dependencies = sqlx::query("SELECT DISTINCT p.id,COALESCE(json_extract(p.manifest_json,'$.displayName'),p.plugin_id)||' · '||p.plugin_version AS label FROM plugin_dependency_bindings d JOIN plugin_installations p ON p.id=d.installation_id WHERE d.dependency_installation_id=? AND p.installed=1 AND p.id<>? ORDER BY p.id")
        .bind(id).bind(id).fetch_all(db).await.map_err(error)?.into_iter().map(|row|Reference{id:row.get("id"),label:row.get("label")}).collect();
    let bindings = sqlx::query("SELECT scope_kind||':'||scope_id||':'||capability_id||':'||contract_version AS id,contribution_id||' · '||scope_kind||'/'||scope_id||' · '||capability_id AS label FROM capability_provider_bindings WHERE installation_id=? UNION SELECT 'candidate:'||candidate_id AS id,contribution_id||' · 候选绑定' AS label FROM capability_binding_candidates WHERE installation_id=? ORDER BY id")
        .bind(id).bind(id).fetch_all(db).await.map_err(error)?.into_iter().map(|row|Reference{id:row.get("id"),label:row.get("label")}).collect();
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
        .map(|row|Reference{id:row.get("id"),label:row.get("plugin_version")}).collect();
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
                &result.sessions,
                &result.dependencies,
                &result.bindings
            ))
            .map_err(error)?
        )
    );
    Ok(result)
}

/// Only accept host-owned descendants. Never follow a substituted directory symlink.
pub(crate) fn owned_path(root: &Path, parts: &[&str]) -> Result<PathBuf, String> {
    let mut path = root.canonicalize().map_err(error)?;
    for part in parts {
        if part.is_empty()
            || *part == "."
            || *part == ".."
            || !part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        {
            return Err("无效的插件存储路径".into());
        }
        path.push(part);
        match std::fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err("插件存储路径不是安全目录".into())
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(error(e)),
        }
    }
    Ok(path)
}
pub(crate) fn remove_owned(root: &Path, parts: &[&str]) -> Result<(), String> {
    let path = owned_path(root, parts)?;
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
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(policy(&db).await.unwrap(), UpgradePolicy::Automatic);
        save_policy(&db, UpgradePolicy::Pinned).await.unwrap();
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(policy(&db).await.unwrap(), UpgradePolicy::Pinned);
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

    #[cfg(unix)]
    #[test]
    fn cleanup_rejects_symlinked_private_directories_and_path_escape() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep"), "history").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("plugin-data")).unwrap();
        assert!(remove_owned(root.path(), &["plugin-data", "plugin", "release"]).is_err());
        assert!(remove_owned(root.path(), &["../outside"]).is_err());
        assert!(outside.path().join("keep").exists());
    }
}
