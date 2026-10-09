//! Compatibility for exact historical migrations applied during development.
use sqlx::migrate::{Migrate, MigrateError, Migration, MigrationType};

pub(crate) async fn run(connection: &mut sqlx::SqliteConnection) -> Result<(), MigrateError> {
    let mut migrator = sqlx::migrate!("./migrations");
    connection.ensure_migrations_table().await?;
    let applied = connection.list_applied_migrations().await?;
    for historical in [initial_search_migration(), initial_lifecycle_migration()] {
        if applied
            .iter()
            .any(|m| m.version == historical.version && m.checksum == historical.checksum)
        {
            // Validate exact historical SQL without rewriting its recorded checksum.
            // Subsequent migrations converge the known versions to the current schema.
            // Unknown checksums retain SQLx's normal rejection behavior.
            let migration = migrator
                .migrations
                .to_mut()
                .iter_mut()
                .find(|m| m.version == historical.version)
                .expect("embedded historical migration");
            *migration = historical;
        }
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

fn initial_lifecycle_migration() -> Migration {
    Migration::new(
        55,
        "plugin lifecycle".into(),
        MigrationType::Simple,
        include_str!("../migration-history/0055_plugin_lifecycle_initial.sql").into(),
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Connection, Row};

    #[tokio::test]
    async fn project_output_display_migration_preserves_legacy_results_and_checksums_across_reopen() {
        let root=tempfile::tempdir().unwrap();let path=root.path().join("host.db");
        let options=sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(false);
        let mut connection=sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        let mut old=sqlx::migrate!("./migrations");
        old.migrations=old.iter().filter(|migration|migration.version<=64).cloned().collect::<Vec<_>>().into();
        old.run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/missing','Legacy',0,'before','before');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('s','w','disabled','原会话','closed','before','before');
            INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('m','s','user','消息原文 {message}','completed','before','before');
            INSERT INTO composer_drafts(session_id,text,updated_at) VALUES('s','草稿原文 {draft}','before');
            INSERT INTO project_action_runs(id,schema_version,action_id,workspace_id,session_id,status,exit_code,output,started_at,completed_at,snapshot_json,request_id,request_json,approval_outcome,approval_decided_at)
            VALUES('old','aibo.project-action-run/v3','deleted','w','s','rejected',NULL,'Task was not started: approval denied. Submit a new request after checking the current context.','before','after','{}','original-request','{\"caller\":\"main\"}','denied','after');")
            .execute(&mut connection).await.unwrap();
        let before=sqlx::query_as::<_,(String,String,String,String,String,String)>("SELECT id,status,output,snapshot_json,request_json,approval_outcome FROM project_action_runs").fetch_one(&mut connection).await.unwrap();
        let checksums=sqlx::query_as::<_,(i64,Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        let diagnostic="Host restarted during approval; task was not started.";
        let display=serde_json::json!({"schema":"aibo.project-output-display/v1","segments":[{"start":0,"end":diagnostic.len(),"raw":diagnostic,"message":crate::ui_i18n::display_descriptor("native.project.outputRestartApproval",serde_json::json!({}))}]});
        for pass in 0..2 {
            let db=crate::open_database(&path).await.unwrap();
            assert_eq!(sqlx::query_as::<_,(i64,Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=64 ORDER BY version").fetch_all(&db).await.unwrap(),checksums);
            assert_eq!(sqlx::query_as::<_,(String,String,String,String,String,String)>("SELECT id,status,output,snapshot_json,request_json,approval_outcome FROM project_action_runs WHERE id='old'").fetch_one(&db).await.unwrap(),before);
            assert!(sqlx::query_scalar::<_,Option<String>>("SELECT localized_output_json FROM project_action_runs WHERE id='old'").fetch_one(&db).await.unwrap().is_none());
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT content FROM messages WHERE id='m'").fetch_one(&db).await.unwrap(),"消息原文 {message}");
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT text FROM composer_drafts WHERE session_id='s'").fetch_one(&db).await.unwrap(),"草稿原文 {draft}");
            if pass==0 {
                sqlx::query("INSERT INTO project_action_runs(id,schema_version,action_id,workspace_id,status,output,localized_output_json,started_at,completed_at,snapshot_json) VALUES('new','aibo.project-action-run/v3','deleted','w','rejected',?,?,'new','new','{}')")
                    .bind(diagnostic).bind(display.to_string()).execute(&db).await.unwrap();
            } else {
                let runs=crate::project_actions::list_project_action_runs(&db,"w".into(),None).await.unwrap();
                let run=runs.iter().find(|run|run.id=="new").unwrap();assert_eq!(run.output,diagnostic);
                assert_eq!(run.localized_output.as_ref(),Some(&display));
                assert!(runs.iter().find(|run|run.id=="old").unwrap().localized_output.is_none());
            }
            assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&db).await.unwrap().is_empty());
            assert_eq!(sqlx::query_scalar::<_,String>("PRAGMA integrity_check").fetch_one(&db).await.unwrap(),"ok");
            db.close().await;
        }
    }

    #[tokio::test]
    async fn host_display_migration_preserves_legacy_text_and_optional_metadata_across_reopen() {
        let root = std::env::temp_dir().join(format!("aibo-display-migration-{}",ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap(); let path = root.join("host.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(false);
        let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        // All predecessors are frozen by the migration immutability gate.
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = old.iter().filter(|migration| migration.version <= 60).cloned().collect::<Vec<_>>().into();
        old.run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Legacy',0,'before','before');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','before','before');
            INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES ('t','s','legacy-turn','completed','before');
            INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES ('m','s','t','system','已有恢复记录','completed','before','before');
            INSERT INTO composer_drafts(session_id,text,updated_at) VALUES ('s','未发送草稿','before');
            INSERT INTO restore_operations(id,schema_version,workspace_id,session_id,turn_id,status,restored_json,conflicts_json,unsupported_json,created_at) VALUES ('r','aibo.restore-operation/v1','w','s','t','blocked','[]','[]','[\"已有原始原因\"]','before');")
            .execute(&mut connection).await.unwrap();
        let checksums: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        for pass in 0..2 {
            let db = crate::open_database(&path).await.unwrap();
            let after: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations WHERE version<=60 ORDER BY version").fetch_all(&db).await.unwrap();
            assert_eq!(after,checksums);
            let old = sqlx::query("SELECT content,localized_content_json FROM messages WHERE id='m'").fetch_one(&db).await.unwrap();
            assert_eq!(old.get::<String,_>("content"),"已有恢复记录");assert!(old.get::<Option<String>,_>("localized_content_json").is_none());
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT text FROM composer_drafts WHERE session_id='s'").fetch_one(&db).await.unwrap(),"未发送草稿");
            let raw: String = sqlx::query_scalar("SELECT unsupported_json FROM restore_operations WHERE id='r'").fetch_one(&db).await.unwrap();assert_eq!(raw,"[\"已有原始原因\"]");
            if pass == 0 {
                let display = crate::ui_i18n::display_descriptor("native.restore.auditCompleted",serde_json::json!({"count":1})).to_string();
                sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,localized_content_json,status,created_at,updated_at) VALUES ('new','s','t','system','新原始诊断',?,'completed','after','after')").bind(&display).execute(&db).await.unwrap();
            } else {
                let row = sqlx::query("SELECT id,session_id,turn_id,external_message_id,role,tool_name,content,localized_content_json,status,created_at,updated_at FROM messages WHERE id='new'").fetch_one(&db).await.unwrap();
                let message = crate::row_to_timeline_item(&row).unwrap();assert_eq!(message.content,"新原始诊断");
                assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,message.localized_content.as_ref().unwrap()).contains("restor"));
            }
            assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&db).await.unwrap().is_empty());
            assert_eq!(sqlx::query_scalar::<_,String>("PRAGMA integrity_check").fetch_one(&db).await.unwrap(),"ok");
            db.close().await;
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn queue_display_migration_preserves_delivery_and_errors_across_reopen() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("host.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(false);
        let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = old.iter().filter(|migration|migration.version <= 61).cloned().collect::<Vec<_>>().into();
        old.run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Legacy',0,'before','before');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','before','before');
            INSERT INTO session_queues(session_id,paused,revision) VALUES ('s',1,7);
            INSERT INTO queued_messages(id,session_id,caller,text,status,error,delivery,created_at) VALUES ('q','s','main','草稿 {error}','uncertain','原始诊断','steer','before');
            INSERT INTO composer_drafts(session_id,text,updated_at) VALUES ('s','未发送草稿','before');")
            .execute(&mut connection).await.unwrap();
        let checksums: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        for pass in 0..2 {
            let db = crate::open_database(&path).await.unwrap();
            assert_eq!(sqlx::query_as::<_,(i64,Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=61 ORDER BY version").fetch_all(&db).await.unwrap(),checksums);
            let row = sqlx::query("SELECT text,status,error,delivery,localized_error_json FROM queued_messages WHERE id='q'").fetch_one(&db).await.unwrap();
            assert_eq!(row.get::<String,_>("text"),"草稿 {error}"); assert_eq!(row.get::<String,_>("status"),"uncertain");
            assert_eq!(row.get::<String,_>("error"),"原始诊断"); assert_eq!(row.get::<String,_>("delivery"),"steer");
            assert_eq!(sqlx::query_as::<_,(bool,i64)>("SELECT paused,revision FROM session_queues WHERE session_id='s'").fetch_one(&db).await.unwrap(),(true,7));
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT text FROM composer_drafts WHERE session_id='s'").fetch_one(&db).await.unwrap(),"未发送草稿");
            if pass == 0 {
                assert!(row.get::<Option<String>,_>("localized_error_json").is_none());
                let display = crate::ui_i18n::display_descriptor("native.queue.restarted",serde_json::json!({})).to_string();
                sqlx::query("UPDATE queued_messages SET localized_error_json=? WHERE id='q'").bind(display).execute(&db).await.unwrap();
            } else {
                let display: serde_json::Value = serde_json::from_str(&row.get::<String,_>("localized_error_json")).unwrap();
                assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&display),"The app restarted. Delivery is unknown; check the conversation history.");
            }
            assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&db).await.unwrap().is_empty());
            assert_eq!(sqlx::query_scalar::<_,String>("PRAGMA integrity_check").fetch_one(&db).await.unwrap(),"ok");
            db.close().await;
        }
    }

    #[tokio::test]
    async fn turn_capture_display_migration_preserves_history_across_reopen() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("host.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(false);
        let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = old.iter().filter(|migration|migration.version <= 62).cloned().collect::<Vec<_>>().into();
        old.run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Legacy',0,'before','before');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','before','before');
            INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES ('t','s','legacy','completed','before');
            INSERT INTO turn_change_sets(id,workspace_id,session_id,turn_id,schema_version,attribution,capture_status,capture_error,created_at,updated_at) VALUES ('set','w','s','t','aibo.turn-changeset/v1','unknown','partial','已有诊断 {error}','before','before');
            INSERT INTO composer_drafts(session_id,text,updated_at) VALUES ('s','未发送草稿','before');")
            .execute(&mut connection).await.unwrap();
        let checksums: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        for pass in 0..2 {
            let db = crate::open_database(&path).await.unwrap();
            assert_eq!(sqlx::query_as::<_,(i64,Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=62 ORDER BY version").fetch_all(&db).await.unwrap(),checksums);
            let change_set = crate::turn_changes::get_turn_change_set("s".into(),Some("t".into()),&db).await.unwrap().unwrap();
            assert_eq!(change_set.capture_error.as_deref(),Some("已有诊断 {error}"));
            assert_eq!(change_set.attribution,"unknown");assert_eq!(change_set.capture_status,"partial");assert_eq!(change_set.id,"set");
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT text FROM composer_drafts WHERE session_id='s'").fetch_one(&db).await.unwrap(),"未发送草稿");
            if pass == 0 {
                assert!(change_set.localized_capture_error.is_none());
                let display = crate::ui_i18n::display_descriptor("native.recovery.uncertainContent",serde_json::json!({})).to_string();
                sqlx::query("UPDATE turn_change_sets SET localized_capture_error_json=? WHERE id='set'").bind(display).execute(&db).await.unwrap();
            } else {
                assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,change_set.localized_capture_error.as_ref().unwrap()),"Rebuilt after the app restarted; the result may include user changes made after the crash.");
            }
            assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&db).await.unwrap().is_empty());
            assert_eq!(sqlx::query_scalar::<_,String>("PRAGMA integrity_check").fetch_one(&db).await.unwrap(),"ok");
            db.close().await;
        }
    }

    #[tokio::test]
    async fn context_display_migration_backfills_only_identified_host_messages_across_reopen() {
        use serde_json::{json, Value};
        use crate::ui_i18n::{render, Locale};
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("host.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(false);
        let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = old.iter().filter(|migration| migration.version <= 63).cloned().collect::<Vec<_>>().into();
        old.run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Legacy',0,'before','before');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','before','before'),('other','w','disabled','Other','closed','before','before');
            INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES ('t','s','legacy','completed','before'),('other-t','other','other','completed','before');
            INSERT INTO composer_drafts(session_id,text,updated_at) VALUES ('s','未发送草稿 {label}','before');")
            .execute(&mut connection).await.unwrap();
        let resumed = "会话已恢复。之前批准计划时清空过上下文，恢复后 Agent 的上下文可能不包含清空之后的对话与操作；时间线保留了完整记录。";
        let label = "模式原文 {label}";
        let cases = [
            ("plain", "s", "t", "system", false, None, false),
            ("reset", "s", "t", "system", true, None, false),
            ("user", "s", "t", "user", false, None, false),
            ("assistant", "s", "t", "assistant", false, None, false),
            ("changed", "s", "t", "system", false, None, true),
            ("wrong-session", "other", "other-t", "system", false, None, false),
            ("wrong-turn", "s", "other-t", "system", false, None, false),
            ("existing", "s", "t", "system", false, Some("{\"original\":true}"), false),
            ("ambiguous", "s", "t", "system", false, None, false),
        ];
        for (index, (request, message_session, message_turn, role, reset, metadata, changed)) in cases.iter().enumerate() {
            let payload = json!({"payload":{"requestId":request,"label":label,"contextReset":reset}}).to_string();
            sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,turn_id,payload_json,schema_version) VALUES (?,'s','old',?,'before','session.control_changed','t',?,'2.0')")
                .bind(format!("event-{request}")).bind(index as i64).bind(&payload).execute(&mut connection).await.unwrap();
            if *request == "ambiguous" {
                sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,turn_id,payload_json,schema_version) VALUES ('duplicate','s','old',99,'before','session.control_changed','t',?,'2.0')")
                    .bind(payload).execute(&mut connection).await.unwrap();
            }
            let content = if *changed { "用户修改后的提示".into() } else { format!("{}{}",if *reset {"审批后清空上下文并切换到 "} else {"审批后切换到 "},label) };
            sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,localized_content_json,status,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,'completed',?,'before','before')")
                .bind(format!("t:control:{request}")).bind(message_session).bind(message_turn).bind(role).bind(content).bind(metadata).bind(index as i64).execute(&mut connection).await.unwrap();
        }
        for (id,role) in [("s:context-reset-resumed:event-reset","system"),("s:context-reset-resumed:event-plain","system"),("s:context-reset-resumed:missing","system"),("s:context-reset-resumed:event-user","user")] {
            sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES (?,'s',?,?,'completed','before','before')")
                .bind(id).bind(role).bind(resumed).execute(&mut connection).await.unwrap();
        }
        sqlx::raw_sql("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,turn_id,payload_json,schema_version) VALUES ('invalid','s','old',100,'before','session.control_changed','t','invalid JSON','2.0'),('lookalike','s','old',101,'before','agent.message','t','{\"payload\":{\"requestId\":\"missing\",\"label\":\"模式原文 {label}\"}}','2.0');
            INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES ('t:control:missing','s','t','system','审批后切换到 模式原文 {label}','completed','before','before');")
            .execute(&mut connection).await.unwrap();
        let checksums: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&mut connection).await.unwrap();
        let history_sql = "SELECT json_object('id',id,'sessionId',session_id,'turnId',turn_id,'role',role,'content',content,'status',status,'sequence',sequence,'createdAt',created_at,'updatedAt',updated_at) FROM messages ORDER BY id";
        let before: Vec<String> = sqlx::query_scalar(history_sql).fetch_all(&mut connection).await.unwrap();
        let events: Vec<String> = sqlx::query_scalar("SELECT payload_json FROM agent_events ORDER BY event_id").fetch_all(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        for _ in 0..2 {
            let db = crate::open_database(&path).await.unwrap();
            assert_eq!(sqlx::query_as::<_,(i64,Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=63 ORDER BY version").fetch_all(&db).await.unwrap(),checksums);
            assert_eq!(sqlx::query_scalar::<_,String>(history_sql).fetch_all(&db).await.unwrap(),before);
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT payload_json FROM agent_events ORDER BY event_id").fetch_all(&db).await.unwrap(),events);
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT text FROM composer_drafts WHERE session_id='s'").fetch_one(&db).await.unwrap(),"未发送草稿 {label}");
            let rows: Vec<(String,Option<String>)> = sqlx::query_as("SELECT id,localized_content_json FROM messages ORDER BY id").fetch_all(&db).await.unwrap();
            for (id,metadata) in rows {
                let expected = match id.as_str() {
                    "t:control:plain" => Some(("native.session.controlChanged",format!("Switched to {label} after approval"))),
                    "t:control:reset" => Some(("native.session.controlResetChanged",format!("Cleared the context and switched to {label} after approval"))),
                    "s:context-reset-resumed:event-reset" => Some(("native.session.contextResetResumed","The session has resumed. Its context was cleared when the plan was approved. The restored Agent context may omit conversations and actions after that reset; the timeline retains the complete record.".into())),
                    _ => None,
                };
                if let Some((key,en)) = expected {
                    let value: Value = serde_json::from_str(metadata.as_ref().unwrap()).unwrap();
                    assert_eq!(value["schema"],"aibo.host-message/v1"); assert_eq!(value["key"],key);
                    assert_eq!(render(Locale::En,&value),en);
                    let raw: String = sqlx::query_scalar("SELECT content FROM messages WHERE id=?").bind(&id).fetch_one(&db).await.unwrap();
                    assert_eq!(render(Locale::ZhCn,&value),raw);
                } else if id == "t:control:existing" { assert_eq!(metadata.as_deref(),Some("{\"original\":true}")); }
                else { assert!(metadata.is_none(),"unidentified history must remain raw: {id}"); }
            }
            assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&db).await.unwrap().is_empty());
            assert_eq!(sqlx::query_scalar::<_,String>("PRAGMA integrity_check").fetch_one(&db).await.unwrap(),"ok");
            db.close().await;
        }
    }

    #[tokio::test]
    async fn lifecycle_migration_versions_preserve_data_and_checksums() {
        for sql in [
            include_str!("../migration-history/0055_plugin_lifecycle_initial.sql"),
            include_str!("../../fixtures/migrations/0055_plugin_lifecycle.sql"),
        ] {
            let root = std::env::temp_dir()
                .join(format!("aibo-lifecycle-migration-{}", ulid::Ulid::new()));
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
            let mut migrations: Vec<_> = old.iter().filter(|m| m.version < 55).cloned().collect();
            migrations.push(Migration::new(
                55,
                "plugin lifecycle".into(),
                MigrationType::Simple,
                sql.into(),
                false,
            ));
            old.migrations = migrations.into();
            old.run(&mut connection).await.unwrap();
            sqlx::raw_sql("UPDATE plugin_upgrade_preferences SET policy='pinned';
                INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Legacy',0,'before','before');
                INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','before','before');
                INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES ('m','s','assistant','历史内容','completed',0,'before','before');
                INSERT INTO composer_drafts(session_id,text,updated_at) VALUES ('s','草稿','before');
                INSERT INTO plugin_session_retirements VALUES ('s','before');")
                .execute(&mut connection).await.unwrap();
            let before: Vec<(i64, Vec<u8>)> =
                sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
                    .fetch_all(&mut connection)
                    .await
                    .unwrap();
            connection.close().await.unwrap();
            for _ in 0..2 {
                let db = crate::open_database(&path)
                    .await
                    .expect("applied lifecycle migration must upgrade");
                let after: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations WHERE version<=55 ORDER BY version").fetch_all(&db).await.unwrap();
                assert_eq!(before, after);
                let data: (String,String,String,String) = sqlx::query_as("SELECT m.content,d.text,r.retired_at,p.policy FROM messages m JOIN composer_drafts d ON d.session_id=m.session_id JOIN plugin_session_retirements r ON r.session_id=m.session_id CROSS JOIN plugin_upgrade_preferences p WHERE m.id='m'").fetch_one(&db).await.unwrap();
                assert_eq!(
                    data,
                    (
                        "历史内容".into(),
                        "草稿".into(),
                        "before".into(),
                        "pinned".into()
                    )
                );
                sqlx::query("SELECT session_id,installation_id FROM plugin_session_candidates")
                    .fetch_all(&db)
                    .await
                    .unwrap();
                sqlx::query("SELECT digest FROM presentation_removals")
                    .fetch_all(&db)
                    .await
                    .unwrap();
                let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
                    .fetch_one(&db)
                    .await
                    .unwrap();
                assert_eq!(integrity, "ok");
                assert!(sqlx::query("PRAGMA foreign_key_check")
                    .fetch_all(&db)
                    .await
                    .unwrap()
                    .is_empty());
                db.close().await;
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[tokio::test]
    async fn fresh_database_migrations_are_complete_and_repeatable() {
        let root = std::env::temp_dir().join(format!("aibo-fresh-migration-{}", ulid::Ulid::new()));
        let path = root.join("aibo.sqlite3");
        let expected = sqlx::migrate!("./migrations").iter().count() as i64;
        for _ in 0..2 {
            let db = crate::open_database(&path).await.unwrap();
            let count: i64 =
                sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations WHERE success=1")
                    .fetch_one(&db)
                    .await
                    .unwrap();
            assert_eq!(count, expected);
            let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&db)
                .await
                .unwrap();
            assert_eq!(integrity, "ok");
            assert!(sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&db)
                .await
                .unwrap()
                .is_empty());
            db.close().await;
        }
        std::fs::remove_dir_all(root).unwrap();
    }

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
                // Frozen applied SQL: constructing this from current migrations
                // would let an accidental edit silently redefine the old database.
                Migration::new(
                    51,
                    "global search".into(),
                    MigrationType::Simple,
                    include_str!("../../fixtures/migrations/0051_global_search.sql").into(),
                    false,
                )
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
            let previous_history: Vec<(i64, Vec<u8>)> =
                sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
                    .fetch_all(&mut connection)
                    .await
                    .unwrap();
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
            let reopened = crate::open_database(&path).await.expect("repeated startup");
            let history: Vec<(i64, Vec<u8>)> = sqlx::query_as(
                "SELECT version, checksum FROM _sqlx_migrations WHERE version <= 51 ORDER BY version",
            ).fetch_all(&reopened).await.unwrap();
            assert_eq!(
                history, previous_history,
                "upgrade must preserve all applied checksums"
            );
            let stored: (String, String, String) = sqlx::query_as(
                "SELECT s.label, m.content, d.text FROM sessions s JOIN messages m ON m.session_id=s.id JOIN composer_drafts d ON d.session_id=s.id WHERE s.id='s'",
            ).fetch_one(&reopened).await.unwrap();
            assert_eq!(stored, ("Session".into(), content, draft));
            let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&reopened)
                .await
                .unwrap();
            assert_eq!(integrity, "ok");
            reopened.close().await;
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[tokio::test]
    async fn unknown_checksums_are_still_rejected() {
        for version in [50_i64, 51, 55, 56, 57, 58, 59] {
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
