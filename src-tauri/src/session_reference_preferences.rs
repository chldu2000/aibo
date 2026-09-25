//! Host-owned defaults for newly captured references; null means all conversation messages.
use crate::CoreError;
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionReferencePreferences {
    pub message_limit: Option<i64>,
}

pub(crate) async fn read(db: &SqlitePool) -> Result<SessionReferencePreferences, CoreError> {
    let message_limit = sqlx::query_scalar("SELECT message_limit FROM session_reference_preferences WHERE id=1")
        .fetch_one(db).await?;
    Ok(SessionReferencePreferences { message_limit })
}

pub(crate) async fn save(db: &SqlitePool, message_limit: Option<i64>) -> Result<SessionReferencePreferences, CoreError> {
    if message_limit.is_some_and(|limit| !(1..=10000).contains(&limit)) {
        return Err(CoreError::InvalidWorkspacePath("消息条数必须是 1 到 10000 的整数。".into()));
    }
    let message_limit = sqlx::query_scalar("UPDATE session_reference_preferences SET message_limit=? WHERE id=1 RETURNING message_limit")
        .bind(message_limit).fetch_one(db).await?;
    Ok(SessionReferencePreferences { message_limit })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Connection;

    #[tokio::test]
    async fn reference_preferences_migration_preserves_history_and_persists() {
        let root = std::env::temp_dir().join(format!("aibo-reference-preferences-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("test.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(false);
        let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = old.iter().filter(|m| m.version <= 53).cloned().collect::<Vec<_>>().into();
        old.run(&mut connection).await.unwrap();
        let checksums: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/reference-test','w',1,'now','now');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','custom.agent','s','closed','now','now');
            INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES ('m','s','user','preserved','completed',1,'now','now');")
            .execute(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(read(&db).await.unwrap().message_limit, Some(12));
        for invalid in [0, -1, 10001] { assert!(save(&db, Some(invalid)).await.is_err()); }
        assert_eq!(read(&db).await.unwrap().message_limit, Some(12));
        assert_eq!(save(&db, None).await.unwrap().message_limit, None);
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(read(&db).await.unwrap().message_limit, None);
        save(&db, Some(27)).await.unwrap();
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(read(&db).await.unwrap().message_limit, Some(27));
        let content: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='m'").fetch_one(&db).await.unwrap();
        assert_eq!(content, "preserved");
        let after: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations WHERE version<=53 ORDER BY version")
            .fetch_all(&db).await.unwrap();
        assert_eq!(after, checksums);
        assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&db).await.unwrap().is_empty());
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&db).await.unwrap();
        assert_eq!(integrity, "ok");
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
