//! Compatibility for the exact search migration applied during development.
use sqlx::migrate::{Migrate, MigrateError, Migration, MigrationType};

pub(crate) async fn run(connection: &mut sqlx::SqliteConnection) -> Result<(), MigrateError> {
    let mut migrator = sqlx::migrate!("./migrations");
    connection.ensure_migrations_table().await?;
    let applied = connection.list_applied_migrations().await?;
    let initial = initial_search_migration();
    if applied
        .iter()
        .any(|m| m.version == 51 && m.checksum == initial.checksum)
    {
        // Validate against the actual historical SQL, retaining its recorded checksum.
        // Migration 52 brings this exact development version to the current schema.
        // All other mismatches still go through SQLx's normal rejection path.
        let migration = migrator
            .migrations
            .to_mut()
            .iter_mut()
            .find(|m| m.version == 51)
            .expect("embedded search migration");
        *migration = initial;
    }
    migrator.run(connection).await
}

fn initial_search_migration() -> Migration {
    Migration::new(
        51,
        "global search".into(),
        MigrationType::Simple,
        include_str!("../migration-history/0051_global_search_initial.sql").into(),
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Connection, Row};

    #[tokio::test]
    async fn applied_search_versions_upgrade_without_losing_history() {
        for initial_version in [true, false] {
            let root = std::env::temp_dir().join(format!("aibo-migration-{}", ulid::Ulid::new()));
            std::fs::create_dir_all(&root).unwrap();
            let path = root.join("aibo.sqlite3");
            let options = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(false);
            let mut connection = sqlx::SqliteConnection::connect_with(&options)
                .await
                .unwrap();
            let mut old = sqlx::migrate!("./migrations");
            let mut migrations: Vec<_> = old.iter().filter(|m| m.version < 51).cloned().collect();
            let applied = if initial_version {
                initial_search_migration()
            } else {
                old.iter().find(|m| m.version == 51).unwrap().clone()
            };
            migrations.push(applied.clone());
            old.migrations = migrations.into();
            old.run(&mut connection).await.unwrap();
            sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Legacy',0,'before','before');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','before','before');
            INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES ('m','s','assistant','升级之前的中文历史','completed',0,'before','before');
            INSERT INTO composer_drafts(session_id,text,updated_at) VALUES ('s','未发送草稿','before');")
            .execute(&mut connection).await.unwrap();
            for (sequence, agent, entry) in [(1, "a:b", "c"), (2, "a", "b:c")] {
                let payload = serde_json::json!({"payload":{"agentId":agent,"entry":{"id":entry,"role":"assistant","content":"独立身份条目"}}});
                sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json) VALUES (?,'s','generation',?,'now','subagent.message',?)")
                .bind(format!("child-{sequence}")).bind(sequence).bind(payload.to_string()).execute(&mut connection).await.unwrap();
            }
            connection.close().await.unwrap();

            let db = crate::open_database(&path)
                .await
                .expect("initial search migration must upgrade");
            let content: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='m'")
                .fetch_one(&db)
                .await
                .unwrap();
            assert_eq!(content, "升级之前的中文历史");
            let checksum: Vec<u8> =
                sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=51")
                    .fetch_one(&db)
                    .await
                    .unwrap();
            assert_eq!(checksum, applied.checksum.as_ref());
            let draft: String =
                sqlx::query_scalar("SELECT text FROM composer_drafts WHERE session_id='s'")
                    .fetch_one(&db)
                    .await
                    .unwrap();
            assert_eq!(draft, "未发送草稿");
            let child_count: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM search_fts WHERE search_fts MATCH '独立身份'",
            )
            .fetch_one(&db)
            .await
            .unwrap();
            assert_eq!(
                child_count, 2,
                "upgrade must recover entries hidden by legacy identity collisions"
            );
            let hit: String =
                sqlx::query_scalar("SELECT body FROM search_fts WHERE search_fts MATCH '中文历史'")
                    .fetch_one(&db)
                    .await
                    .unwrap();
            assert_eq!(hit, content);
            sqlx::query("SELECT signature FROM search_file_state")
                .fetch_all(&db)
                .await
                .unwrap();
            let version: i64 = sqlx::query("SELECT MAX(version) AS version FROM _sqlx_migrations")
                .fetch_one(&db)
                .await
                .unwrap()
                .get("version");
            assert!(version >= 52);
            db.close().await;
            crate::open_database(&path)
                .await
                .expect("repeated startup")
                .close()
                .await;
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[tokio::test]
    async fn unknown_checksums_are_still_rejected() {
        for version in [50_i64, 51] {
            let root = std::env::temp_dir().join(format!("aibo-migration-{}", ulid::Ulid::new()));
            let path = root.join("aibo.sqlite3");
            let db = crate::open_database(&path).await.unwrap();
            sqlx::query("UPDATE _sqlx_migrations SET checksum=zeroblob(48) WHERE version=?")
                .bind(version)
                .execute(&db)
                .await
                .unwrap();
            db.close().await;
            let error = crate::open_database(&path).await.unwrap_err().to_string();
            assert!(
                error.contains(&format!(
                    "migration {version} was previously applied but has been modified"
                )),
                "{error}"
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
