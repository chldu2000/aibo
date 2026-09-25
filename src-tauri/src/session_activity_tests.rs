use sqlx::{Connection, Executor};

const CREATED: &str = "2026-09-01T00:00:00Z";
const MESSAGE: &str = "2026-09-02T00:00:00Z";
const CONTENT: &str = "2026-09-03T00:00:00Z";
const MAINTENANCE: &str = "2026-09-25T00:00:00Z";

#[tokio::test]
async fn previously_applied_session_activity_migration_upgrades_without_losing_history() {
    let root = std::env::temp_dir().join(format!("aibo-applied-migration-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("aibo.sqlite3");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path).create_if_missing(true).foreign_keys(false);
    let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
    let mut previous = sqlx::migrate!("./migrations");
    previous.migrations = previous.iter().filter(|m| m.version <= 49).map(|migration| {
        if migration.version != 49 { return migration.clone(); }
        // Frozen SQL from the already-applied development version. Do not replace
        // this with the current migration: that would miss checksum regressions.
        sqlx::migrate::Migration::new(49, migration.description.clone(), migration.migration_type,
            include_str!("../../fixtures/migrations/0049_session_content_activity.sql").into(), false)
    }).collect::<Vec<_>>().into();
    previous.run(&mut connection).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/activity','Activity',1,?,?)")
        .bind(CREATED).bind(CREATED).execute(&mut connection).await.unwrap();
    sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('s','w','external.agent','Keep me','idle',?,?)")
        .bind(CREATED).bind(CREATED).execute(&mut connection).await.unwrap();
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('m','s','assistant','Keep this message','completed',?,?)")
        .bind(MESSAGE).bind(MESSAGE).execute(&mut connection).await.unwrap();
    connection.close().await.unwrap();

    // Exercise the same migration/checksum path as Tauri startup, twice.
    for _ in 0..2 {
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(crate::session_by_id(&db, "s").await.unwrap().label, "Keep me");
        assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, MESSAGE);
        let content: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='m'").fetch_one(&db).await.unwrap();
        assert_eq!(content, "Keep this message");
        let index: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_sessions_workspace_content_activity'")
            .fetch_one(&db).await.unwrap();
        assert_eq!(index, 0);
        let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE version=50 AND success=1")
            .fetch_one(&db).await.unwrap();
        assert_eq!(applied, 1);
        db.close().await;
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn session_activity_survives_metadata_status_and_snapshot_refreshes() {
    let root = std::env::temp_dir().join(format!("aibo-session-activity-{}", ulid::Ulid::new()));
    let db = crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/activity','Activity',1,?,?)")
        .bind(CREATED).bind(CREATED).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('s','w','external.agent','Session','idle',?,?)")
        .bind(CREATED).bind(CREATED).execute(&db).await.unwrap();
    assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, CREATED);
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('m','s','assistant','hello','streaming',?,?)")
        .bind(MESSAGE).bind(MESSAGE).execute(&db).await.unwrap();
    assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, MESSAGE);
    sqlx::query("UPDATE messages SET content='hello world',updated_at=? WHERE id='m'")
        .bind(CONTENT).execute(&db).await.unwrap();
    assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, CONTENT);

    // Same writes used by rename, resume, close, unarchive and crash recovery.
    for state in ["idle", "closed", "interrupted"] {
        sqlx::query("UPDATE sessions SET label='renamed',state=?,archived=0,updated_at=? WHERE id='s'")
            .bind(state).bind(MAINTENANCE).execute(&db).await.unwrap();
        assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, CONTENT);
    }
    sqlx::query("UPDATE messages SET content='hello world',status='failed',updated_at=? WHERE id='m'")
        .bind(MAINTENANCE).execute(&db).await.unwrap();
    assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, CONTENT);
    // Empty attachment-only user messages are still new conversation content.
    sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,archived,created_at,updated_at) VALUES('new','w','external.agent','Newer','idle',1,?,?)")
        .bind("2026-09-04T00:00:00Z").bind(CREATED).execute(&db).await.unwrap();
    let all = crate::list_sessions_from_db(&db, "w", None, Some("all".into())).await.unwrap();
    assert_eq!(all.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["new", "s"]);
    let active = crate::list_sessions_from_db(&db, "w", None, Some("active".into())).await.unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, "s");
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('u','s','user','','completed',?,?)")
        .bind(MAINTENANCE).bind(MAINTENANCE).execute(&db).await.unwrap();
    assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, MAINTENANCE);
    let all = crate::list_sessions_from_db(&db, "w", None, Some("all".into())).await.unwrap();
    assert_eq!(all.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["s", "new"]);
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('q','s','user','queued','queued',?,?)")
        .bind("2026-09-26T00:00:00Z").bind("2026-09-26T00:00:00Z").execute(&db).await.unwrap();
    assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, MAINTENANCE);
    sqlx::query("UPDATE messages SET status='completed',updated_at='2026-09-27T00:00:00Z' WHERE id='q'")
        .execute(&db).await.unwrap();
    assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, "2026-09-27T00:00:00Z");
    for (sequence, content, expected) in [(1, "child reply", 28), (2, "child reply", 28), (3, "child update", 30)] {
        let occurred = format!("2026-09-{:02}T00:00:00Z", 27 + sequence);
        let payload = serde_json::json!({"payload":{"agentId":"child","entry":{"id":"entry","content":content}}});
        sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json,schema_version) VALUES(?,'s','g',?,?,'subagent.message',?,'2.0')")
            .bind(format!("e{sequence}")).bind(sequence).bind(occurred).bind(payload.to_string()).execute(&db).await.unwrap();
        assert_eq!(crate::session_by_id(&db, "s").await.unwrap().updated_at, format!("2026-09-{expected:02}T00:00:00Z"));
    }
    db.close().await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn session_activity_migration_repairs_old_maintenance_timestamps() {
    let mut db = sqlx::SqliteConnection::connect("sqlite::memory:").await.unwrap();
    for migration in sqlx::migrate!("./migrations").iter().filter(|m| m.version < 49) {
        db.execute("PRAGMA foreign_keys=OFF").await.unwrap();
        sqlx::raw_sql(&migration.sql).execute(&mut db).await.unwrap();
    }
    db.execute("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/activity','Activity',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')").await.unwrap();
    for id in ["empty", "legacy", "streamed"] {
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES(?,'w','external.agent','Session','idle',?,?)")
            .bind(id).bind(CREATED).bind(MAINTENANCE).execute(&mut db).await.unwrap();
    }
    for id in ["legacy", "streamed"] {
        sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES(?,?,'assistant','hello','failed',?,?)")
            .bind(id).bind(id).bind(MESSAGE).bind(MAINTENANCE).execute(&mut db).await.unwrap();
    }
    sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json,schema_version) VALUES('e','streamed','g',1,?,'message.delta','{}','2.0')")
        .bind(CONTENT).execute(&mut db).await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0049_session_content_activity.sql")).execute(&mut db).await.unwrap();
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT id,content_updated_at FROM sessions ORDER BY julianday(content_updated_at) DESC,id DESC")
        .fetch_all(&mut db).await.unwrap();
    assert_eq!(rows, vec![
        ("streamed".into(), "2026-09-03T00:00:00.000Z".into()),
        ("legacy".into(), "2026-09-02T00:00:00.000Z".into()),
        ("empty".into(), "2026-09-01T00:00:00.000Z".into()),
    ]);
}
