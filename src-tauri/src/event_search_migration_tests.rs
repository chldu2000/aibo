use serde_json::{json, Value};
use sqlx::{Connection, SqlitePool};

async fn search(db: &SqlitePool, caller: &str, text: &str) -> Vec<crate::global_search::Item> {
    crate::global_search::search(db, caller, crate::global_search::Request {
        query: text.into(), kind: None, workspace_id: None, limit: 50,
    }).await.unwrap().items
}

#[tokio::test]
async fn event_search_migration_preserves_history_and_rebuilds_only_derived_data() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("host.db");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path).create_if_missing(true).foreign_keys(false);
    let mut old_db = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
    let mut old = sqlx::migrate!("./migrations");
    old.migrations = old.iter().filter(|m| m.version <= 65).cloned().collect::<Vec<_>>().into();
    old.run(&mut old_db).await.unwrap();
    sqlx::raw_sql(r#"
        INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at)
          VALUES('w','/missing','Workspace',1,'before','before');
        INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at)
          VALUES('s','w','disabled','Session','closed','before','before');
        INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at)
          VALUES('m','s','user','保留用户正文','completed','before','before');
        INSERT INTO composer_drafts(session_id,text,updated_at) VALUES('s','未发送草稿','before');
        INSERT INTO plugin_installations(id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,enabled,created_at)
          VALUES('p','org.example.plugin','1.0.0','digest','local','/missing/plugin','{}',0,'before');
        INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms)
          VALUES('call','owner','session','s','可查调用摘要','1.0.0','p','read','running','before',0);
        UPDATE capability_invocations SET generation_id='generation' WHERE id='call';
        INSERT INTO capability_events(invocation_id,caller_window,scope_kind,scope_id,payload_json)
          VALUES('call','owner','session','s','{"schema":"aibo.capability-stream/v1","stream":{"text":"原始审计独有词"}}');
        UPDATE capability_invocations SET status='completed',finished_at='after' WHERE id='call';
        INSERT INTO search_documents(id,kind,source,target_id,workspace_id,title,body,updated_at)
          VALUES('file:w:example','file','file','example.txt','w','example.txt','缓存文件正文','before');
        INSERT INTO search_file_state(document_id,signature) VALUES('file:w:example','unchanged');
    "#).execute(&mut old_db).await.unwrap();
    for (sequence, content) in [(1, "子代理旧正文"), (2, "子代理最新正文")] {
        sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json) VALUES(?,'s','generation',?,'before','subagent.message',?)")
            .bind(format!("child-{sequence}")).bind(sequence)
            .bind(json!({"payload":{"agentId":"child","entry":{"id":"entry","role":"assistant","content":content,"status":"completed"}}}).to_string())
            .execute(&mut old_db).await.unwrap();
    }
    let checksums: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&mut old_db).await.unwrap();
    let events: Vec<(i64, String)> = sqlx::query_as("SELECT sequence,payload_json FROM capability_events ORDER BY sequence").fetch_all(&mut old_db).await.unwrap();
    let agents: Vec<(String, String)> = sqlx::query_as("SELECT event_id,payload_json FROM agent_events ORDER BY event_id").fetch_all(&mut old_db).await.unwrap();
    let stable_documents: Vec<(i64, String, String)> = sqlx::query_as("SELECT rowid,id,body FROM search_documents WHERE source!='capability-event' ORDER BY rowid").fetch_all(&mut old_db).await.unwrap();
    assert!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM search_documents WHERE source='capability-event'").fetch_one(&mut old_db).await.unwrap() > 0);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM search_fts WHERE search_fts MATCH '原始审计独有词'").fetch_one(&mut old_db).await.unwrap(), 1);
    old_db.close().await.unwrap();

    for _ in 0..2 {
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(sqlx::query_as::<_,(i64,Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=65 ORDER BY version").fetch_all(&db).await.unwrap(), checksums);
        assert_eq!(sqlx::query_as::<_,(i64,String)>("SELECT sequence,payload_json FROM capability_events ORDER BY sequence").fetch_all(&db).await.unwrap(), events);
        assert_eq!(sqlx::query_as::<_,(String,String)>("SELECT event_id,payload_json FROM agent_events ORDER BY event_id").fetch_all(&db).await.unwrap(), agents);
        assert_eq!(sqlx::query_as::<_,(i64,String,String)>("SELECT rowid,id,body FROM search_documents ORDER BY rowid").fetch_all(&db).await.unwrap(), stable_documents);
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT text FROM composer_drafts WHERE session_id='s'").fetch_one(&db).await.unwrap(), "未发送草稿");
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT signature FROM search_file_state WHERE document_id='file:w:example'").fetch_one(&db).await.unwrap(), "unchanged");
        assert!(search(&db, "owner", "原始审计独有词").await.is_empty());
        assert!(search(&db, "owner", "审计").await.is_empty()); // short-query LIKE path
        assert_eq!(search(&db, "owner", "可查调用摘要").await.len(), 1);
        assert!(search(&db, "other", "可查调用摘要").await.is_empty());
        assert_eq!(search(&db, "owner", "保留用户正文").await.len(), 1);
        assert_eq!(search(&db, "owner", "子代理最新正文").await.len(), 1);
        let child = crate::session_history::read_subagent(&db, "s", "child").await.unwrap();
        assert_eq!(child.len(), 1);
        assert_eq!(child[0]["content"], "子代理最新正文");
        let scope = crate::capability_broker::Scope::Session("s".into());
        let audit = crate::capability_history::events_from(&db, "owner", scope.clone(), None, false).await.unwrap();
        let audit: Value = serde_json::to_value(audit).unwrap();
        assert_eq!(audit["events"].as_array().unwrap().len(), events.len());
        assert!(audit["events"].as_array().unwrap().iter().any(|e| e["payload"]["stream"]["text"] == "原始审计独有词"));
        let other = crate::capability_history::events_from(&db, "other", scope, None, false).await.unwrap();
        assert_eq!(serde_json::to_value(other).unwrap()["events"], json!([]));
        sqlx::query("INSERT INTO search_fts(search_fts,rank) VALUES('integrity-check',1)").execute(&db).await.unwrap();
        assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&db).await.unwrap().is_empty());
        assert_eq!(sqlx::query_scalar::<_,String>("PRAGMA integrity_check").fetch_one(&db).await.unwrap(), "ok");
        db.close().await;
    }

    let db = crate::open_database(&path).await.unwrap();
    sqlx::query("INSERT INTO capability_events(invocation_id,caller_window,scope_kind,scope_id,payload_json) VALUES('call','owner','session','s','{\"stream\":{\"text\":\"新原始事件词\"}}')").execute(&db).await.unwrap();
    sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms) VALUES('new-call','owner','session','s','新调用摘要词','1.0.0','p','read','running','now',0)").execute(&db).await.unwrap();
    sqlx::query("UPDATE capability_invocations SET status='completed',finished_at='now' WHERE id='new-call'").execute(&db).await.unwrap();
    assert!(search(&db, "owner", "新原始事件词").await.is_empty());
    assert_eq!(search(&db, "owner", "新调用摘要词").await.len(), 1);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM search_documents WHERE source='capability-event'").fetch_one(&db).await.unwrap(), 0);
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('new-message','s','assistant','新消息正文','completed','now','now')").execute(&db).await.unwrap();
    assert_eq!(search(&db, "owner", "新消息正文").await.len(), 1);
    sqlx::query("UPDATE messages SET content='替换后的正文' WHERE id='new-message'").execute(&db).await.unwrap();
    assert!(search(&db, "owner", "新消息正文").await.is_empty());
    assert_eq!(search(&db, "owner", "替换后的正文").await.len(), 1);
    sqlx::query("DELETE FROM messages WHERE id='new-message'").execute(&db).await.unwrap();
    assert!(search(&db, "owner", "替换后的正文").await.is_empty());
    sqlx::query("INSERT INTO search_fts(search_fts,rank) VALUES('integrity-check',1)").execute(&db).await.unwrap();
    db.close().await;
}
