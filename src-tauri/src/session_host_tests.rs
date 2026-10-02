use super::*;
use std::fs;

fn replacement_package(root:&Path, version:&str) {
    let path=root.join("package/plugin.json");
    let mut manifest:Value=serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    manifest["version"]=json!(version);fs::write(path,manifest.to_string()).unwrap();
}

#[tokio::test]
async fn plugin_replacement_is_single_version_and_undo_restores_history_and_bindings() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    let pending=host.prepare_with_profile("w",&source,&session.agent,None).await.unwrap();
    let before=host.saved_binding(&session.id).await.unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    assert_eq!(preview.kind,"upgrade");
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
    assert_ne!(target.id,source);assert!(target.enabled);
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM plugin_installations WHERE installed=1").fetch_one(&db).await.unwrap();assert_eq!(count,1);
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().plugin_installation_id.as_deref(),Some(target.id.as_str()));
    assert_eq!(crate::session_by_id(&db,&pending.id).await.unwrap().plugin_installation_id.as_deref(),Some(target.id.as_str()));
    assert_eq!(crate::plugin_replacement::undo_targets(&db).await.unwrap(),vec![target.id.clone()]);
    crate::plugin_replacement::recover(&db,&root.join("data")).await.unwrap();
    host.undo_plugin_replacement(&root.join("data"),&target.id).await.unwrap();
    assert_eq!(host.saved_binding(&session.id).await.unwrap(),before);
    assert_eq!(crate::session_by_id(&db,&pending.id).await.unwrap().plugin_installation_id.as_deref(),Some(source.as_str()));
    assert!(!root.join("data/plugins").join(&target.id).exists());
    host.invoke_capability_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap();
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_partial_failure_restores_every_session_and_retries() {
    let (root,db,broker,host,first)=concurrent_session_fixture().await;
    let source=first.plugin_installation_id.clone().unwrap();
    let second=host.create_with_profile_from("main","w",&source,&first.agent,None).await.unwrap();
    let first_before=host.saved_binding(&first.id).await.unwrap();
    sqlx::query("UPDATE session_bindings SET plugin_binding_json=json_set(plugin_binding_json,'$.nativeSessionId','broken-recovery') WHERE session_id=?").bind(&second.id).execute(&db).await.unwrap();
    let second_before=host.saved_binding(&second.id).await.unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let error=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.err().unwrap();
    assert!(error.contains("原会话"),"{error}");
    assert_eq!(host.saved_binding(&first.id).await.unwrap(),first_before);
    assert_eq!(host.saved_binding(&second.id).await.unwrap(),second_before);
    assert_eq!(crate::session_by_id(&db,&first.id).await.unwrap().plugin_installation_id.as_deref(),Some(source.as_str()));
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM plugin_installations WHERE installed=1").fetch_one(&db).await.unwrap();assert_eq!(count,1);
    assert!(crate::plugin_replacement::undo_targets(&db).await.unwrap().is_empty());
    // Removing the corrupted test session allows a retry of the same candidate identity.
    sqlx::query("DELETE FROM sessions WHERE id=?").bind(&second.id).execute(&db).await.unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
    broker.stop_session(&first.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_downgrade_requires_reinstall_and_keeps_business_history() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('retained',?,'assistant','business history','completed','now','now')").bind(&session.id).execute(&db).await.unwrap();
    replacement_package(&root,"0.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();assert_eq!(preview.kind,"downgrade");
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.err().unwrap().contains("直接降级"));
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),true).await.unwrap();assert!(!target.enabled);
    assert!(crate::session_by_id(&db,&session.id).await.unwrap().history_only);
    let content:String=sqlx::query_scalar("SELECT content FROM messages WHERE id='retained'").fetch_one(&db).await.unwrap();assert_eq!(content,"business history");
    assert!(!root.join("data/plugins").join(session.plugin_installation_id.unwrap()).exists());
    assert!(host.undo_plugin_replacement(&root.join("data"),&target.id).await.is_err());
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_use_invalidates_undo_and_cleans_backup() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
    host.invoke_capability_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap();
    assert!(crate::plugin_replacement::undo_targets(&db).await.unwrap().is_empty());
    assert!(host.undo_plugin_replacement(&root.join("data"),&target.id).await.is_err());
    assert!(!root.join("data/plugins").join(source).exists());
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_duplicate_same_version_and_stale_confirmation() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();assert_eq!(preview.kind,"installed");
    let same=host.replace_plugin(&root.join("data"),&root.join("package"),None,false).await.unwrap();assert_eq!(Some(same.id),session.plugin_installation_id);
    let path=root.join("package/worker.mjs");let worker=fs::read_to_string(&path).unwrap();fs::write(&path,format!("{worker}\n// replacement bytes\n")).unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();assert_eq!(preview.kind,"replace");
    fs::write(&path,format!("{worker}\n// another package\n")).unwrap();
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.err().unwrap().contains("确认"));
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_crash_recovery_restores_partially_migrated_sessions() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let before=host.saved_binding(&session.id).await.unwrap();
    let saved=crate::plugin_replacement::snapshot(&db,"dev.aibo.pi").await.unwrap();
    let source=session.plugin_installation_id.clone().unwrap();
    let target=install_test_upgrade(&root,&db,false).await;
    sqlx::query("INSERT INTO plugin_replacements VALUES('dev.aibo.pi',?,?,'preparing','now')")
        .bind(&target).bind(serde_json::to_string(&saved).unwrap()).execute(&db).await.unwrap();
    host.migrate_session_for_replacement(&root.join("data"),&session.id,&source,&target).await.unwrap();
    broker.stop_installation(&target).await.unwrap();
    db.close().await;
    let reopened=crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    crate::plugin_replacement::recover(&reopened,&root.join("data")).await.unwrap();
    crate::plugin_replacement::recover(&reopened,&root.join("data")).await.unwrap();
    let recovered=SessionHost::new(reopened.clone(),Broker::new(reopened.clone()));
    assert_eq!(recovered.saved_binding(&session.id).await.unwrap(),before);
    assert_eq!(crate::session_by_id(&reopened,&session.id).await.unwrap().plugin_installation_id.as_deref(),Some(source.as_str()));
    assert!(!root.join("data/plugins").join(target).exists());
    assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&reopened).await.unwrap().is_empty());
    reopened.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_preserves_closed_archived_sessions_and_blocks_running_work() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    replacement_package(&root,"99.0.0");
    sqlx::query("UPDATE sessions SET state='running' WHERE id=?").bind(&session.id).execute(&db).await.unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.err().unwrap().contains("停止"));
    sqlx::query("UPDATE sessions SET state='closed',archived=1 WHERE id=?").bind(&session.id).execute(&db).await.unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
    let after=crate::session_by_id(&db,&session.id).await.unwrap();assert!(after.archived);assert_eq!(after.state,"closed");assert!(!after.history_only);assert_eq!(after.plugin_installation_id.as_deref(),Some(target.id.as_str()));
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_preserves_disabled_state_and_bootstrap_does_not_resurrect_versions() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let old=session.plugin_installation_id.clone().unwrap();
    plugin_registry::enable(&db,&old,false).await.unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
    assert!(!target.enabled);
    plugin_registry::install_builtins(&db,&root.join("data")).await.unwrap();
    let rows:Vec<(String,i64)>=sqlx::query_as("SELECT id,enabled FROM plugin_installations WHERE plugin_id='dev.aibo.pi' AND installed=1").fetch_all(&db).await.unwrap();assert_eq!(rows,vec![(target.id.clone(),0)]);
    assert_eq!(crate::plugin_replacement::undo_targets(&db).await.unwrap(),vec![target.id.clone()]);
    let impact=crate::plugin_lifecycle::impact(&db,&target.id).await.unwrap();host.remove_release(&root.join("data"),&impact,true).await.unwrap();
    plugin_registry::install_builtins(&db,&root.join("data")).await.unwrap();
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM plugin_installations WHERE plugin_id='dev.aibo.pi' AND installed=1").fetch_one(&db).await.unwrap();assert_eq!(count,0);
    assert!(crate::plugin_replacement::undo_targets(&db).await.unwrap().is_empty());
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_host_edits_invalidate_undo_before_execution() {
    for change in ["message","queue","profile","binding"] {
        let (root,db,broker,host,session)=concurrent_session_fixture().await;
        replacement_package(&root,"99.0.0");
        let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
        let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
        let sql=match change {
            "message"=>"INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('new',?,'user','new content','completed','now','now')",
            "queue"=>"INSERT INTO queued_messages(id,session_id,caller,text,created_at) VALUES('queued',?,'main','new work','now')",
            "profile"=>"UPDATE session_execution_profiles SET updated_at=updated_at WHERE session_id=?",
            _=>"UPDATE session_bindings SET plugin_binding_json=plugin_binding_json WHERE session_id=?",
        };
        sqlx::query(sql).bind(&session.id).execute(&db).await.unwrap();
        assert!(host.undo_plugin_replacement(&root.join("data"),&target.id).await.is_err(),"{change}");
        crate::plugin_replacement::collect(&db,&root.join("data")).await.unwrap();
        broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn plugin_replacement_preserves_other_session_scoped_private_state() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    let instance=ulid::Ulid::new().to_string();
    sqlx::query("INSERT INTO capability_instances(id,installation_id,contribution_id,scope_kind,scope_id,created_at) VALUES(?,?,'session-tool','session',?,'now')")
        .bind(&instance).bind(&source).bind(&session.id).execute(&db).await.unwrap();
    let old=crate::plugin_storage::directory(&root.join("data/plugins").join(&source),"dev.aibo.pi",&source,&instance).unwrap();
    fs::write(old.join("state.json"),"private session tool data").unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false).await.unwrap();
    let copied:String=sqlx::query_scalar("SELECT id FROM capability_instances WHERE installation_id=? AND contribution_id='session-tool'").bind(&target.id).fetch_one(&db).await.unwrap();
    let path=root.join("data/plugin-data/dev.aibo.pi").join(&target.id).join("v1").join(copied).join("state.json");
    assert_eq!(fs::read_to_string(path).unwrap(),"private session tool data");
    assert_eq!(fs::read_to_string(old.join("state.json")).unwrap(),"private session tool data");
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

async fn install_test_upgrade(root: &Path, db: &SqlitePool, broken: bool) -> String {
    let package=root.join("package");
    let mut manifest:Value=serde_json::from_str(&fs::read_to_string(package.join("plugin.json")).unwrap()).unwrap();
    manifest["version"]=json!("99.0.0");
    fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
    if broken { fs::write(package.join("worker.mjs"),"process.exit(1);").unwrap(); }
    let target=plugin_registry::install(db,&root.join("data"),&package).await.unwrap();
    plugin_registry::enable(db,&target.id,true).await.unwrap();
    target.id
}

#[tokio::test]
async fn plugin_upgrade_migrates_recovery_before_removing_old_private_data() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    let before=host.saved_binding(&session.id).await.unwrap().unwrap();
    let target=install_test_upgrade(&root,&db,false).await;
    let report=host.migrate_release(&root.join("data"),&source,&target).await.unwrap();
    assert!(report.failed.is_empty(),"{:?}",report.failed.iter().map(|e|&e.label).collect::<Vec<_>>());
    assert_eq!(report.migrated,vec![session.id.clone()]);
    let after=host.saved_binding(&session.id).await.unwrap().unwrap();
    assert_eq!(before["nativeSessionId"],after["nativeSessionId"]);
    assert_eq!(after["pluginInstallationId"],target);
    assert!(!after["recovery"].to_string().contains(&source));
    let impact=crate::plugin_lifecycle::impact(&db,&source).await.unwrap();
    assert!(impact.sessions.is_empty());
    host.remove_release(&root.join("data"),&impact,false).await.unwrap();
    assert!(!root.join("data/plugin-data/dev.aibo.pi").join(&source).exists());
    host.invoke_capability_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap();
    let audit:i64=sqlx::query_scalar("SELECT COUNT(*) FROM plugin_session_migrations WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(audit,1);
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_upgrade_failure_preserves_original_binding() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    let before=host.saved_binding(&session.id).await.unwrap();
    let target=install_test_upgrade(&root,&db,true).await;
    let report=host.migrate_release(&root.join("data"),&source,&target).await.unwrap();
    assert_eq!(report.failed.len(),1);
    assert_eq!(host.saved_binding(&session.id).await.unwrap(),before);
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().plugin_installation_id.as_deref(),Some(source.as_str()));
    host.invoke_capability_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap();
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_removal_requires_current_confirmation_and_keeps_history_after_reinstall() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('history',?,'assistant','keep this history','completed','now','now')").bind(&session.id).execute(&db).await.unwrap();
    let impact=crate::plugin_lifecycle::impact(&db,&source).await.unwrap();
    assert!(host.remove_release(&root.join("data"),&impact,false).await.is_err());
    sqlx::query("INSERT INTO capability_provider_bindings VALUES('application','application','test','1.0.0',?,'test','now')").bind(&source).execute(&db).await.unwrap();
    assert!(host.remove_release(&root.join("data"),&impact,true).await.unwrap_err().contains("引用已变化"));
    let impact=crate::plugin_lifecycle::impact(&db,&source).await.unwrap();
    host.remove_release(&root.join("data"),&impact,true).await.unwrap();
    let content:String=sqlx::query_scalar("SELECT content FROM messages WHERE id='history'").fetch_one(&db).await.unwrap();
    assert_eq!(content,"keep this history");
    let history=serde_json::to_value(crate::session_history::read(&db,"w".into(),session.id.clone(),None).await.unwrap()).unwrap();
    assert_eq!(history["session"]["historyOnly"],true);
    assert!(history["items"].as_array().unwrap().iter().any(|item|item["content"]=="keep this history"));
    let restored=plugin_registry::install(&db,&root.join("data"),&root.join("package")).await.unwrap();
    assert_eq!(restored.id,source);
    plugin_registry::enable(&db,&source,true).await.unwrap();
    assert!(host.resume_from("main",&session.id).await.unwrap_err().contains("history_only"));
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn capability_session_projects_tools_and_recovers_after_process_restart() {
    let root = std::env::temp_dir().join(format!("aibo-session-host-{}", ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("read-tool.txt"), "host-owned tool data".repeat(5000)).unwrap();
    for (name, source) in [
        ("plugin.json", include_str!("../capability-plugins/pi/plugin.json")),
        ("worker.mjs", include_str!("../capability-plugins/pi/worker.mjs")),
        ("engine.mjs", include_str!("../capability-plugins/pi/engine.mjs")),
        ("session-provider.mjs", include_str!("../capability-plugins/session-provider.mjs")),
        ("runtime.mjs", include_str!("../../packages/capability-runtime/runtime.mjs")),
        ("stdio.mjs", include_str!("../../packages/capability-runtime/stdio.mjs")),
    ] { fs::write(package.join(name), source).unwrap(); }
    let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,?,?)")
        .bind(workspace.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db, &root.join("data"), &package).await.unwrap();
    plugin_registry::enable(&db, &installed.id, true).await.unwrap();
    let broker = Broker::new(db.clone()).with_sdk_module(Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/pi/fake-sdk.mjs")));
    let host = SessionHost::new(db.clone(), broker.clone());
    let session = host.create_with_profile_from("main", "w", &installed.id, "dev.aibo.pi.agent", None).await.unwrap();
    let generation: String = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    host.send_from("main", &session.id, "core plugin read fixture", None).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    let state = crate::session_by_id(&db, &session.id).await.unwrap();
    let events: Vec<String> = sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? ORDER BY sequence").bind(&session.id).fetch_all(&db).await.unwrap();
    assert_eq!(state.state, "idle", "events: {events:?}");
    assert!(events.iter().any(|event| event.contains("tool.completed")));
    for event in events { let event: Value = serde_json::from_str(&event).unwrap(); assert_eq!(event["source"]["runtimeProtocolVersion"], "2.1"); }
    let messages: Vec<String> = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='assistant'").bind(&session.id).fetch_all(&db).await.unwrap();
    assert!(messages.iter().any(|message| message == "Core read completed"));
    crate::agent_settings::save(&db, crate::agent_settings::Save {
        installation_id:installed.id.clone(), contribution_id:"dev.aibo.pi.agent".into(),
        scope:Scope::Application, version:1, expected_revision:0,
        values:serde_json::json!({"additionalInstructions":"Use concise answers."}),
    }).await.unwrap();
    host.send_from("main", &session.id, "settings delivery", None).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    let configured: Vec<String> = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='assistant'")
        .bind(&session.id).fetch_all(&db).await.unwrap();
    assert!(configured.iter().any(|message| message == "Use concise answers.\n\nsettings delivery"), "{configured:?}");
    crate::agent_settings::save(&db, crate::agent_settings::Save {
        installation_id:installed.id.clone(), contribution_id:"dev.aibo.pi.agent".into(),
        scope:Scope::Application, version:1, expected_revision:1, values:serde_json::json!({}),
    }).await.unwrap();
    let activity_before_resume = crate::session_by_id(&db, &session.id).await.unwrap().updated_at;
    broker.stop_session(&session.id).await.unwrap();
    let host = SessionHost::new(db.clone(), broker.clone());
    host.resume_from("main", &session.id).await.unwrap();
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().updated_at, activity_before_resume,
        "reopening a stopped provider must not promote an unchanged conversation");
    let resumed: String = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_ne!(generation, resumed);
    host.send_from("main", &session.id, "queue parity prompt", None).await.unwrap();
    assert!(host.cancel_from("other-window", &session.id).await.unwrap_err().contains("permission_denied"));
    host.cancel_from("main", &session.id).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "interrupted");
    let failure: String = sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? AND event_type='adapter.crashed' ORDER BY occurred_at DESC LIMIT 1").bind(&session.id).fetch_one(&db).await.unwrap();
    let failure: Value = serde_json::from_str(&failure).unwrap();
    assert_eq!(failure["payload"]["status"], "interrupted");
    assert!(failure["eventId"].is_string());
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn third_party_agent_managed_history_tools_use_host_scope_without_core_file_authority() {
    let root=std::env::temp_dir().join(format!("aibo-history-provider-{}",ulid::Ulid::new()));
    let package=root.join("package");let workspace=root.join("workspace");
    fs::create_dir_all(&package).unwrap();fs::create_dir_all(&workspace).unwrap();
    for (name,source) in [
        ("plugin.json",include_str!("../capability-plugins/pi/plugin.json")),
        ("worker.mjs",include_str!("../capability-plugins/pi/worker.mjs")),
        ("engine.mjs",include_str!("../capability-plugins/pi/engine.mjs")),
        ("session-provider.mjs",include_str!("../capability-plugins/session-provider.mjs")),
    ] {fs::write(package.join(name),source.replace("dev.aibo.pi","org.example.history")).unwrap();}
    let mut manifest:Value=serde_json::from_str(&fs::read_to_string(package.join("plugin.json")).unwrap()).unwrap();
    manifest["contributions"][0]["executionPolicy"]=json!("agent-managed");
    fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
    let db=crate::open_database(&root.join("data/db")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'w',1,'now','now')")
        .bind(workspace.to_string_lossy().as_ref()).execute(&db).await.unwrap();
    sqlx::raw_sql("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('source','w','offline.agent','source','closed','now','now');
        INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('raw','source','tool','HOST_ONLY_ORIGINAL','completed','now','now');")
        .execute(&db).await.unwrap();
    let installed=plugin_registry::install(&db,&root.join("data"),&package).await.unwrap();
    plugin_registry::enable(&db,&installed.id,true).await.unwrap();
    let broker=Broker::new(db.clone()).with_sdk_module(Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/pi/fake-sdk.mjs")));
    let host=SessionHost::new(db.clone(),broker.clone());
    let target=host.create_with_profile_from("main","w",&installed.id,"org.example.history.agent",None).await.unwrap();
    assert!(crate::session_by_id(&db,&target.id).await.unwrap().capabilities.contains(&"host-tools".into()));
    assert_eq!(execution_profile::installation_backend(&db,&installed.id,"org.example.history.agent").await.unwrap(),execution_profile::EnforcementBackend::AgentManaged);
    for _ in 0..2 {
        let attachment=crate::session_context::capture(&db,&target.id,"source").await.unwrap();
        let text=format!("host history fixture\n[AIBO_SESSION_REFERENCES]\nnotice\n{}\n[/AIBO_SESSION_REFERENCES]",json!([{"snapshotId":attachment.id,"sourceSessionId":"source","contentHash":attachment.content_hash}]));
        host.send_from("main",&target.id,&text,None).await.unwrap();wait_for_turn(&host,&target.id).await;
        let output:Option<String>=sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='assistant' ORDER BY created_at DESC LIMIT 1")
            .bind(&target.id).fetch_optional(&db).await.unwrap();
        assert!(output.unwrap_or_default().contains("HOST_ONLY_ORIGINAL"));
        broker.stop_session(&target.id).await.unwrap();host.resume_from("main",&target.id).await.unwrap();
    }
    host.send_from("main",&target.id,"core plugin read fixture",None).await.unwrap();wait_for_turn(&host,&target.id).await;
    let events:Vec<String>=sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=?").bind(&target.id).fetch_all(&db).await.unwrap();
    assert!(events.iter().any(|event|event.contains("native provider permissions do not authorize Core tools")),"{events:?}");
    broker.stop_session(&target.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

async fn wait_for_turn(host: &SessionHost, session: &str) {
    tokio::time::timeout(Duration::from_secs(15), async {
        while host.live.lock().await.contains_key(session) { tokio::time::sleep(Duration::from_millis(20)).await; }
    }).await.expect("session invocation did not settle");
}

#[tokio::test]
async fn retired_agent_packages_and_unbound_history_cannot_start_execution() {
    let root = std::env::temp_dir().join(format!("aibo-retired-session-{}", ulid::Ulid::new()));
    let db = crate::open_database(&root.join("aibo.sqlite3")).await.unwrap();
    let package = root.join("retired-package");
    fs::create_dir_all(&package).unwrap();
    let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
    manifest["entrypoint"] = json!({"executable":"worker.mjs"});
    manifest["dependencies"] = json!([]);
    manifest["resources"] = json!([]);
    fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(package.join("worker.mjs"), "throw new Error('retired runtime must never start');").unwrap();
    let installed = plugin_registry::install(&db, &root, &package).await.unwrap();
    assert!(!installed.runnable);
    assert!(plugin_registry::enable(&db, &installed.id, true).await.unwrap_err().contains("已退役"));
    sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/retired','History',1,'2026','2026');
        INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('old','w','codex','History','idle','2026','2026');
        INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('old-message','old','assistant','retained history','completed','2026','2026');")
        .execute(&db).await.unwrap();
    let host = SessionHost::new(db.clone(), Broker::new(db.clone()));
    assert!(host.resume_from("main", "old").await.unwrap_err().contains("history_only"));
    assert!(host.send_from("main", "old", "must not execute", None).await.unwrap_err().contains("history_only"));
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turns WHERE session_id='old'").fetch_one(&db).await.unwrap();
    assert_eq!(count, 0);
    let content: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='old-message'").fetch_one(&db).await.unwrap();
    assert_eq!(content, "retained history");
    assert!(host.archive_from("main", "old").await.unwrap().archived);
    assert!(!host.unarchive("old").await.unwrap().archived);
    assert!(host.resume_from("main", "old").await.unwrap_err().contains("history_only"));
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn codex_branch_uses_native_boundary_and_copies_host_history_and_profile() {
    let root = std::env::temp_dir().join(format!("aibo-host-fork-{}",ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    let mut manifest: Value = serde_json::from_str(include_str!("../capability-plugins/codex/plugin.json")).unwrap();
    manifest["executableDependencies"] = json!([{"kind":"runtime","name":"node","versionRange":">=22","required":true}]);
    fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
    let engine = include_str!("../capability-plugins/codex/engine.mjs");
    let native_start = "const launcher = codexLauncher();";
    assert!(engine.contains(native_start));
    fs::write(package.join("engine.mjs"),engine.replace(native_start,"const launcher = { command: process.execPath, prefix: [path.join(import.meta.dirname, 'fake-codex.mjs')], shell: false };")).unwrap();
    for (name, source) in [
        ("worker.mjs",include_str!("../capability-plugins/codex/worker.mjs")),
        ("fake-codex.mjs",include_str!("../../fixtures/plugins/codex/fake-codex.mjs")),
        ("session-provider.mjs",include_str!("../capability-plugins/session-provider.mjs")),
    ] {fs::write(package.join(name),source).unwrap();}
    let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,?,?)")
        .bind(workspace.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db,&root.join("data"),&package).await.unwrap();
    plugin_registry::enable(&db,&installed.id,true).await.unwrap();
    // Fixture native execution is explicitly authorized by the host, not its ID.
    assert_eq!(execution_profile::installation_backend(&db,&installed.id,"dev.aibo.codex.agent").await.unwrap(),execution_profile::EnforcementBackend::Unnegotiated);
    sqlx::query("INSERT INTO session_execution_authorities(installation_id,contribution_id,backend) VALUES(?,'dev.aibo.codex.agent','codex-native')")
        .bind(&installed.id).execute(&db).await.unwrap();
    let broker = Broker::new(db.clone());
    let host = SessionHost::new(db.clone(),broker.clone());
    broker.bind(Binding {scope:Scope::Workspace("w".into()),capability:"aibo.session.catalog".into(),version:"1.0.0".into(),installation_id:installed.id.clone(),contribution_id:"dev.aibo.codex.catalog".into()}).await.unwrap();
    let catalog = broker.invoke("main",Request {scope:Scope::Workspace("w".into()),capability:"aibo.session.catalog".into(),version:"1.0.0".into(),request_id:"catalog".into(),turn_id:None,input:json!({})}).await.unwrap();
    assert_eq!(catalog.output["threads"][0]["id"],"catalog-thread");
    let count:i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions").fetch_one(&db).await.unwrap();
    assert_eq!(count,0,"workspace catalog must not create a conversation");
    let source = host.create_with_profile_from("main","w",&installed.id,"dev.aibo.codex.agent",None).await.unwrap();
    let (models, snapshot) = tokio::join!(
        host.invoke_capability_from("main", &source.id, "model.select", json!({"action":"list"})),
        host.invoke_capability_from("main", &source.id, "session.snapshot", json!({})),
    );
    models.unwrap();
    snapshot.unwrap();
    host.send_configured_from("main",&source.id,"branch message").await.unwrap();
    wait_for_turn(&host,&source.id).await;
    assert_eq!(crate::session_by_id(&db, &source.id).await.unwrap().label, "branch message");
    let (turn,native):(String,String) = sqlx::query_as("SELECT id,external_turn_id FROM turns WHERE session_id=? AND status='completed'")
        .bind(&source.id).fetch_one(&db).await.unwrap();
    assert_ne!(turn,native);
    assert_eq!(native,"native-turn");
    assert!(host.fork_from("main",&source.id,Some("foreign-turn")).await.unwrap_err().contains("completed source turn"));
    let branch = host.fork_from("main",&source.id,Some(&turn)).await.unwrap();
    assert_ne!(branch.id,source.id);
    assert_eq!(branch.state,"idle");
    assert_eq!(host.saved_binding(&source.id).await.unwrap().unwrap()["nativeSessionId"],"native-thread");
    assert_eq!(host.saved_binding(&branch.id).await.unwrap().unwrap()["nativeSessionId"],"forked-thread");
    let copied:Vec<String> = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='assistant'")
        .bind(&branch.id).fetch_all(&db).await.unwrap();
    assert_eq!(copied,vec!["branch message"]);
    let profiles:Vec<String> = sqlx::query_scalar("SELECT enforced_json FROM session_execution_profiles WHERE session_id IN (?,?)")
        .bind(&source.id).bind(&branch.id).fetch_all(&db).await.unwrap();
    assert_eq!(profiles.len(),2);
    assert_eq!(profiles[0],profiles[1]);
    // The fake native process keeps fork history in memory, so exercise writable
    // turn cleanup separately from the native branch-boundary fixture above.
    let mut requested = execution_profile::default_requested_profile("codex").unwrap();
    requested.filesystem_policy = "workspace-write".into();
    let profile = execution_profile::resolve("dev.aibo.codex.agent", Some(requested), crate::now_iso()).unwrap();
    let editable = host.create_with_profile_from("main","w",&installed.id,"dev.aibo.codex.agent",Some(profile)).await.unwrap();
    for index in 0..2 {
        host.send_configured_from("main", &editable.id, &format!("unique turn: {index}")).await.unwrap();
        wait_for_turn(&host, &editable.id).await;
        assert_eq!(crate::session_by_id(&db, &editable.id).await.unwrap().state, "idle");
    }
    broker.stop_session(&editable.id).await.unwrap();
    broker.stop_session(&source.id).await.unwrap();
    broker.stop_session(&branch.id).await.unwrap();
    broker.stop_installation(&installed.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn capability_session_write_requires_host_authorization_and_owned_tool_approval() {
    let root = std::env::temp_dir().join(format!("aibo-session-write-{}", ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("read-tool.txt"), "host-owned tool data".repeat(5000)).unwrap();
    for (name, source) in [
        ("plugin.json", include_str!("../capability-plugins/pi/plugin.json")),
        ("worker.mjs", include_str!("../capability-plugins/pi/worker.mjs")),
        ("engine.mjs", include_str!("../capability-plugins/pi/engine.mjs")),
        ("session-provider.mjs", include_str!("../capability-plugins/session-provider.mjs")),
        ("runtime.mjs", include_str!("../../packages/capability-runtime/runtime.mjs")),
        ("stdio.mjs", include_str!("../../packages/capability-runtime/stdio.mjs")),
    ] { fs::write(package.join(name), source).unwrap(); }
    let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,?,?)")
        .bind(workspace.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db, &root.join("data"), &package).await.unwrap();
    plugin_registry::enable(&db, &installed.id, true).await.unwrap();
    let broker = Broker::new(db.clone()).with_sdk_module(Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/pi/fake-sdk.mjs")));
    let host = SessionHost::new(db.clone(), broker.clone());

    let mut requested = execution_profile::default_requested_profile("pi").unwrap();
    requested.interaction_mode = "edit".into();
    requested.filesystem_policy = "workspace-write".into();
    requested.approval_policy = "on-request".into();
    let profile = execution_profile::resolve_with_backend(execution_profile::EnforcementBackend::CoreProxy, Some(requested), crate::now_iso()).unwrap();
    let session = host.create_with_profile_from("main", "w", &installed.id, "dev.aibo.pi.agent", Some(profile)).await.unwrap();
    let target = workspace.join("core-tool.txt");
    assert!(host.send_from("main", &session.id, "core plugin write fixture", None).await.unwrap_err().contains("approval_required"));
    assert!(!target.exists());
    let denied = crate::workspace_write_runs::Request::with_confirmation("deny".into(), "main".into(), |_| async { Ok(false) });
    host.send_from("main", &session.id, "core plugin write fixture", Some(denied)).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert!(!target.exists());
    assert!(host.pending_tools.lock().await.is_empty());
    for decision in ["cancel", "accept"] {
        host.send_configured_from("main", &session.id, "core plugin write fixture").await.unwrap();
        let request_id = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Some(id) = host.pending_tools.lock().await.keys().next().cloned() { break id; }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.expect("tool approval was not requested");
        assert!(!target.exists(), "write must wait for its tool approval");
        assert!(host.resolve_approval_from("other-window", &session.id, &request_id, "accept").await.is_err());
        assert!(host.resolve_approval_option_from("main", &session.id, &request_id, "allow").await.unwrap_err().contains("take a decision"),
            "Core tool approvals never accept a provider option ID");
        assert!(host.pending_tools.lock().await.contains_key(&request_id));
        host.resolve_approval_from("main", &session.id, &request_id, decision).await.unwrap();
        wait_for_turn(&host, &session.id).await;
        assert_eq!(target.exists(), decision == "accept");
        assert!(host.resolve_approval_from("main", &session.id, &request_id, "accept").await.is_err(), "a consumed approval cannot execute again");
    }
    assert_eq!(fs::read_to_string(&target).unwrap(), "Core plugin write");
    fs::write(&target, "trust revoked").unwrap();
    let approved = crate::workspace_write_runs::Request::with_confirmation("revoke".into(), "main".into(), |_| async { Ok(true) });
    host.send_from("main", &session.id, "core plugin write fixture", Some(approved)).await.unwrap();
    let request_id = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(id) = host.pending_tools.lock().await.keys().next().cloned() { break id; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("tool approval was not requested");
    sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'").execute(&db).await.unwrap();
    assert!(host.resolve_approval_from("main", &session.id, &request_id, "accept").await.is_err());
    wait_for_turn(&host, &session.id).await;
    assert_eq!(fs::read_to_string(&target).unwrap(), "trust revoked", "trust is rechecked at tool execution");
    sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='w'").execute(&db).await.unwrap();
    broker.stop_session(&session.id).await.unwrap();
    fs::write(&target, "after stop").unwrap();
    host.resume_from("main", &session.id).await.unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "after stop", "resume must not replay the previous write");
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn capability_session_cancel_stops_an_approved_host_command() {
    let root = std::env::temp_dir().join(format!("aibo-session-command-{}", ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("read-tool.txt"), "host-owned tool data".repeat(5000)).unwrap();
    for (name, source) in [
        ("plugin.json", include_str!("../capability-plugins/pi/plugin.json")),
        ("worker.mjs", include_str!("../capability-plugins/pi/worker.mjs")),
        ("engine.mjs", include_str!("../capability-plugins/pi/engine.mjs")),
        ("session-provider.mjs", include_str!("../capability-plugins/session-provider.mjs")),
        ("runtime.mjs", include_str!("../../packages/capability-runtime/runtime.mjs")),
        ("stdio.mjs", include_str!("../../packages/capability-runtime/stdio.mjs")),
    ] { fs::write(package.join(name), source).unwrap(); }
    let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,?,?)")
        .bind(workspace.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db, &root.join("data"), &package).await.unwrap();
    plugin_registry::enable(&db, &installed.id, true).await.unwrap();
    let broker = Broker::new(db.clone()).with_sdk_module(Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/pi/fake-sdk.mjs")));
    let host = SessionHost::new(db.clone(), broker.clone());

    let mut requested = execution_profile::default_requested_profile("pi").unwrap();
    requested.interaction_mode = "edit".into();
    requested.command_policy = "approved".into();
    requested.approval_policy = "on-request".into();
    let profile = execution_profile::resolve_with_backend(execution_profile::EnforcementBackend::CoreProxy, Some(requested), crate::now_iso()).unwrap();
    let session = host.create_with_profile_from("main", "w", &installed.id, "dev.aibo.pi.agent", Some(profile)).await.unwrap();
    let approved = crate::workspace_write_runs::Request::with_confirmation("command".into(), "main".into(), |_| async { Ok(true) });
    host.send_from("main", &session.id, "core plugin bash cancel command", Some(approved)).await.unwrap();
    let request_id = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(id) = host.pending_tools.lock().await.keys().next().cloned() { break id; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("command approval was not requested");
    assert!(!workspace.join("command-started").exists());
    let approval_host = host.clone();
    let session_id = session.id.clone();
    let execution = tokio::spawn(async move { approval_host.resolve_approval_from("main", &session_id, &request_id, "accept").await });
    tokio::time::timeout(Duration::from_secs(10), async {
        while !workspace.join("command-started").exists() { tokio::time::sleep(Duration::from_millis(10)).await; }
    }).await.expect("approved command did not start");
    host.cancel_from("main", &session.id).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert!(execution.await.unwrap().is_err());
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert!(!workspace.join("command-finished").exists(), "cancelled shell must not run its next command");
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "interrupted");
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

async fn concurrent_session_fixture() -> (PathBuf, SqlitePool, Broker, SessionHost, Session) {
    session_queue_fixture(false).await
}

async fn session_queue_fixture(external: bool) -> (PathBuf, SqlitePool, Broker, SessionHost, Session) {
    let root = std::env::temp_dir().join(format!("aibo-session-host-{}", ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("read-tool.txt"), "host-owned tool data".repeat(5000)).unwrap();
    for (name, source) in [
        ("plugin.json", include_str!("../capability-plugins/pi/plugin.json")),
        ("worker.mjs", include_str!("../capability-plugins/pi/worker.mjs")),
        ("engine.mjs", include_str!("../capability-plugins/pi/engine.mjs")),
        ("session-provider.mjs", include_str!("../capability-plugins/session-provider.mjs")),
        ("runtime.mjs", include_str!("../../packages/capability-runtime/runtime.mjs")),
        ("stdio.mjs", include_str!("../../packages/capability-runtime/stdio.mjs")),
    ] { fs::write(package.join(name), source).unwrap(); }
    if external {
        // A separately installed provider with no native queue or steering operation.
        for name in ["plugin.json", "worker.mjs", "engine.mjs"] {
            let text = fs::read_to_string(package.join(name)).unwrap().replace("dev.aibo.pi", "dev.example.waiting");
            fs::write(package.join(name), text.replace("'queue.manage', ", "")).unwrap();
        }
        let mut manifest: Value = serde_json::from_str(&fs::read_to_string(package.join("plugin.json")).unwrap()).unwrap();
        manifest["contributions"][0]["operations"].as_array_mut().unwrap().retain(|op| op["capability"]["id"] != "dev.example.waiting.queue.manage");
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
    }
    let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,?,?)")
        .bind(workspace.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db, &root.join("data"), &package).await.unwrap();
    plugin_registry::enable(&db, &installed.id, true).await.unwrap();
    let broker = Broker::new(db.clone()).with_sdk_module(Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/pi/fake-sdk.mjs")));
    let host = SessionHost::new(db.clone(), broker.clone());
    let session = host.create_with_profile_from("main", "w", &installed.id, if external {"dev.example.waiting.agent"} else {"dev.aibo.pi.agent"}, None).await.unwrap();

    (root, db, broker, host, session)
}

#[tokio::test]
async fn concurrent_session_context_reads_do_not_report_initialization_busy() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;

    let (models, skills) = tokio::join!(
        host.invoke_capability_from("main", &session.id, "model.select", serde_json::json!({"action":"list"})),
        host.invoke_capability_from("main", &session.id, "skill.list", serde_json::json!({})),
    );
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "idle");
    assert!(host.invoke_capability_from("main", &session.id, "model.select", serde_json::json!({"action":"list"})).await.is_ok());
    assert!(host.invoke_capability_from("main", &session.id, "skill.list", serde_json::json!({})).await.is_ok());
    assert!(host.invoke_capability_from("main", &session.id, "model.reasoning", serde_json::json!({"action":"list"})).await.is_ok());
    assert!(host.invoke_capability_from("main", &session.id, "command.list", serde_json::json!({})).await.is_ok());
    let opens: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE scope_id=? AND capability_id='aibo.session.open'")
        .bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(opens, 1, "warm session metadata reads must reuse the existing native binding");
    broker.fail_next_dynamic_binding_for_test();
    host.send_from("main", &session.id, "warm Pi session turn", None).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "idle");
    broker.stop_session(&session.id).await.unwrap();
    assert!(host.invoke_capability_from("main", &session.id, "skill.list", serde_json::json!({})).await.is_ok());
    let reopened: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE scope_id=? AND capability_id='aibo.session.open'")
        .bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(reopened, 2, "a stopped runtime must resume before the next metadata read");
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(&root).unwrap();
    for result in [models, skills] {
        assert!(result.is_ok(), "{}", crate::CoreError::SessionOperation(result.unwrap_err()));
    }
}

#[tokio::test]
async fn session_admission_is_isolated_and_live_controls_bypass_idle_reads() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    let admission = host.session_operation(&session.id).await;
    let second = tokio::time::timeout(Duration::from_secs(3), host.create_with_profile_from(
        "other-window", "w", session.plugin_installation_id.as_deref().unwrap(), "dev.aibo.pi.agent", None,
    )).await.expect("one session blocked creation of another session").unwrap();
    tokio::time::timeout(Duration::from_secs(3), host.invoke_capability_from(
        "other-window", &second.id, "model.select", json!({"action":"list"}),
    )).await.expect("one session blocked another session's reads").unwrap();
    drop(admission);

    host.send_from("main", &session.id, "queue parity prompt", None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE scope_id=? AND capability_id='aibo.session.turn' AND status='running'")
                .bind(&session.id).fetch_one(&db).await.unwrap();
            if count > 0 {
                let run = host.live.lock().await.get(&session.id).cloned().unwrap();
                let generation: String = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
                if broker.request_is_live("main", &run.request_id, &generation).await { break; }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("turn did not start");
    let admission = host.session_operation(&session.id).await;
    let denied = tokio::time::timeout(Duration::from_secs(2), host.invoke_capability_from(
        "other-window", &session.id, "queue.manage", json!({"action":"steer","message":"queued"}),
    )).await.expect("ownership check was queued").unwrap_err();
    assert!(denied.contains("permission_denied"));
    tokio::time::timeout(Duration::from_secs(2), host.invoke_capability_from(
        "main", &session.id, "queue.manage", json!({"action":"steer","message":"queued"}),
    )).await.expect("live control waited for idle admission").unwrap();
    tokio::time::timeout(Duration::from_secs(2), host.cancel_from("main", &session.id))
        .await.expect("cancel waited for idle admission").unwrap();
    wait_for_turn(&host, &session.id).await;
    drop(admission);
    host.close_from("main", &session.id).await.unwrap();
    host.close_from("other-window", &second.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn pending_context_read_and_send_share_session_admission() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    let (models, sent) = tokio::join!(
        host.invoke_capability_from("main", &session.id, "model.select", json!({"action":"list"})),
        host.send_from("main", &session.id, "hello", None),
    );
    models.unwrap();
    sent.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "idle");
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn completed_turn_snapshot_does_not_use_retired_interaction() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    host.send_from("main", &session.id, "boundary message", None).await.unwrap();
    // Hold only finalization to deterministically expose the real interval after
    // Broker completion and before SessionHost removes its live-turn record.
    let finalization = host.turn_baselines.lock().await;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE scope_id=? AND capability_id='aibo.session.turn' AND status='completed'")
                .bind(&session.id).fetch_one(&db).await.unwrap();
            if count > 0 { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap();
    assert!(host.live.lock().await.contains_key(&session.id));
    let messages: Vec<String> = sqlx::query_scalar("SELECT role FROM messages WHERE session_id=?")
        .bind(&session.id).fetch_all(&db).await.unwrap();
    assert!(messages.iter().any(|role| role=="user"));
    assert!(messages.iter().any(|role| role=="assistant"));
    let timeline = host.active_timeline_from("main", &session.id).await.unwrap();
    assert_eq!(timeline.iter().filter(|item| item.role == "user" && item.content == "boundary message").count(), 1);
    assert!(timeline.iter().any(|item| item.role == "assistant"));
    let stale_control = host.invoke_provider_capability("main", &session.id, "queue.manage", json!({"action":"steer","message":"do not replay"})).await.unwrap_err();
    assert!(stale_control.contains("finished accepting interactions"));
    let pending_host = host.clone(); let id = session.id.clone();
    let mut read = tokio::spawn(async move { pending_host.invoke_capability_from("main", &id, "session.timeline", json!({})).await });
    let premature = tokio::time::timeout(Duration::from_millis(50), &mut read).await;
    drop(finalization);
    let result = match premature { Ok(result) => result.unwrap(), Err(_) => read.await.unwrap() };
    wait_for_turn(&host, &session.id).await;
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
    assert!(result.is_ok(), "{}", crate::CoreError::SessionOperation(result.unwrap_err()));
}

#[tokio::test]
async fn accepted_turn_snapshot_does_not_use_unready_interaction() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    host.send_from("main", &session.id, "boundary message", None).await.unwrap();
    let admission = broker.hold_admission_for_test().await;
    let run = host.live.lock().await.get(&session.id).cloned().unwrap();
    let generation: String = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?")
        .bind(&session.id).fetch_one(&db).await.unwrap();
    assert!(!broker.request_is_live("main", &run.request_id, &generation).await);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id=? AND role='user'")
        .bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(count, 1);
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('other-branch',?,'user','OTHER_BRANCH','completed',?,?)")
        .bind(&session.id).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let timeline = host.active_timeline_from("main", &session.id).await.unwrap();
    assert_eq!(timeline.iter().filter(|item| item.role == "user" && item.content == "boundary message").count(), 1);
    assert!(!timeline.iter().any(|item| item.content == "OTHER_BRANCH"), "a native branch must not include unrelated host history");
    let pending_host = host.clone(); let id = session.id.clone();
    let mut read = tokio::spawn(async move { pending_host.invoke_capability_from("main", &id, "session.timeline", json!({})).await });
    let premature = tokio::time::timeout(Duration::from_millis(50), &mut read).await;
    drop(admission);
    let result = match premature { Ok(result) => result.unwrap(), Err(_) => read.await.unwrap() };
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "idle");
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
    assert!(result.is_ok(), "{}", crate::CoreError::SessionOperation(result.unwrap_err()));
}

#[tokio::test]
async fn selected_session_permissions_survive_restart_without_secondary_consent() {
    use crate::session_permissions as permissions;
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    let mut profile = crate::session_execution_profile(&db, &session.id).await.unwrap().profile;
    profile.enforced.interaction_mode = "edit".into();
    profile.enforced.filesystem_policy = "workspace-write".into();
    profile.enforced.command_policy = "trusted".into();
    profile.enforced.approval_policy = "on-request".into();
    profile.enforced.approval_reviewer = "auto-review".into();
    profile.requested = profile.enforced.clone();
    execution_profile::save_for_session(&db, &session.id, &profile).await.unwrap();
    sqlx::raw_sql("CREATE TRIGGER reject_redundant_turn_binding BEFORE INSERT ON capability_provider_bindings WHEN NEW.capability_id='aibo.session.turn.write' BEGIN SELECT RAISE(ABORT, 'turn binding storage unavailable'); END;")
        .execute(&db).await.unwrap();

    for _ in 0..2 {
        host.send_configured_from("main", &session.id, "selected broad-mode message").await.unwrap();
        wait_for_turn(&host, &session.id).await;
        assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "idle");
        let failures: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_events WHERE session_id=? AND event_type='adapter.crashed' AND json_extract(payload_json,'$.payload.reason')='Capability storage is unavailable'")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(failures, 0, "Approve for me must not fail in host capability storage");
    }

    broker.stop_session(&session.id).await.unwrap();
    host.send_configured_from("main", &session.id, "after runtime restart").await.unwrap();
    wait_for_turn(&host, &session.id).await;

    sqlx::query("UPDATE workspaces SET permission_epoch=permission_epoch+1 WHERE id='w'").execute(&db).await.unwrap();
    assert!(permissions::turn_request(&db, &session.id, "main").await.is_ok(), "a new turn uses the currently selected profile and trust context");

    broker.stop_session(&session.id).await.unwrap(); db.close().await; fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn first_prompt_names_capability_sessions_without_overwriting_manual_names() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    host.send_configured_from("main", &session.id, "  第一条消息\n用于命名  ").await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().label, "第一条消息 用于命名");
    host.send_configured_from("main", &session.id, "第二条消息").await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().label, "第一条消息 用于命名");
    let manual = host.create_with_profile_from("main", "w", session.plugin_installation_id.as_deref().unwrap(), &session.agent, None).await.unwrap();
    sqlx::query("UPDATE sessions SET label='手动名称' WHERE id=?").bind(&manual.id).execute(&db).await.unwrap();
    host.send_configured_from("main", &manual.id, "不能覆盖手动名称").await.unwrap();
    wait_for_turn(&host, &manual.id).await;
    assert_eq!(crate::session_by_id(&db, &manual.id).await.unwrap().label, "手动名称");
    broker.stop_session(&session.id).await.unwrap();
    broker.stop_session(&manual.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn goal_resume_and_pause_use_host_execution_ownership_and_policy() {
    for mode in ["hold", "complete"] {
    let root = std::env::temp_dir().join(format!("aibo-host-goal-{}",ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    let mut manifest: Value = serde_json::from_str(include_str!("../capability-plugins/codex/plugin.json")).unwrap();
    manifest["executableDependencies"] = json!([{"kind":"runtime","name":"node","versionRange":">=22","required":true}]);
    fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
    let engine = include_str!("../capability-plugins/codex/engine.mjs");
    let native_start = "const launcher = codexLauncher();";
    assert!(engine.contains(native_start));
    fs::write(package.join("engine.mjs"),engine.replace(native_start,"const launcher = { command: process.execPath, prefix: [path.join(import.meta.dirname, 'fake-codex.mjs')], shell: false };")).unwrap();
    for (name, source) in [
        ("worker.mjs",include_str!("../capability-plugins/codex/worker.mjs")),
        ("fake-codex.mjs",include_str!("../../fixtures/plugins/codex/fake-codex.mjs")),
        ("session-provider.mjs",include_str!("../capability-plugins/session-provider.mjs")),
        ("runtime.mjs",include_str!("../../packages/capability-runtime/runtime.mjs")),
        ("stdio.mjs",include_str!("../../packages/capability-runtime/stdio.mjs")),
    ] {let source = if name == "fake-codex.mjs" {source.replace("let nativeTurnId", &format!("process.env.CODEX_FAKE_GOAL_MODE = '{mode}'; process.env.CODEX_FAKE_GOAL_FILE = {};\nlet nativeTurnId", serde_json::to_string(&root.join("goal.json")).unwrap()))} else {source.to_owned()};
        fs::write(package.join(name),source).unwrap();}
    let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,?,?)")
        .bind(workspace.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db,&root.join("data"),&package).await.unwrap();
    plugin_registry::enable(&db,&installed.id,true).await.unwrap();
    // Fixture native execution is explicitly authorized by the host, not its ID.
    assert_eq!(execution_profile::installation_backend(&db,&installed.id,"dev.aibo.codex.agent").await.unwrap(),execution_profile::EnforcementBackend::Unnegotiated);
    sqlx::query("INSERT INTO session_execution_authorities(installation_id,contribution_id,backend) VALUES(?,'dev.aibo.codex.agent','codex-native')")
        .bind(&installed.id).execute(&db).await.unwrap();
    let broker = Broker::new(db.clone());
    let host = SessionHost::new(db.clone(),broker.clone());

    let mut requested = execution_profile::default_requested_profile("codex").unwrap();
    requested.filesystem_policy = "workspace-write".into();
    let profile = execution_profile::resolve("dev.aibo.codex.agent", Some(requested), crate::now_iso()).unwrap();
    let session = host.create_with_profile_from("main","w",&installed.id,"dev.aibo.codex.agent",Some(profile)).await.unwrap();
    host.invoke_capability_from("main",&session.id,"goal.manage",json!({"action":"set","objective":"Keep the goal","tokenBudget":2000})).await.unwrap();
    let initial = host.invoke_capability_from("main",&session.id,"goal.manage",json!({"action":"get"})).await.unwrap();
    assert_eq!(initial["goal"]["status"],"paused");
    host.invoke_capability_from("main",&session.id,"goal.resume",json!({})).await.unwrap();
    assert!(host.live.lock().await.contains_key(&session.id));
    assert!(host.invoke_capability_from("main",&session.id,"goal.resume",json!({})).await.unwrap_err().contains("busy"));
    if mode == "hold" {
        let during = host.invoke_capability_from("main",&session.id,"goal.manage",json!({"action":"get"})).await.unwrap();
        assert_eq!(during["goal"]["status"],"active");
        assert!(host.invoke_capability_from("other-window",&session.id,"goal.manage",json!({"action":"pause"})).await.unwrap_err().contains("permission_denied"));
        let paused = host.invoke_capability_from("main",&session.id,"goal.manage",json!({"action":"pause"})).await.unwrap();
        assert_eq!(paused["goal"]["status"],"paused");
        wait_for_turn(&host,&session.id).await;
        let after = crate::session_by_id(&db,&session.id).await.unwrap();
        assert!(["idle","interrupted"].contains(&after.state.as_str()));
        host.invoke_capability_from("main",&session.id,"goal.resume",json!({})).await.unwrap();
        host.invoke_capability_from("main",&session.id,"goal.manage",json!({"action":"pause"})).await.unwrap();
    }
    wait_for_turn(&host,&session.id).await;
    let final_goal = host.invoke_capability_from("main",&session.id,"goal.manage",json!({"action":"get"})).await.unwrap();
    assert_eq!(final_goal["goal"]["objective"],"Keep the goal");
    assert_eq!(final_goal["goal"]["tokenBudget"],2000);
    if mode == "complete" {
        assert_eq!(final_goal["goal"]["status"],"complete");
        assert_eq!(final_goal["goal"]["tokensUsed"],100);
        let contents:Vec<String> = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='assistant' ORDER BY sequence")
            .bind(&session.id).fetch_all(&db).await.unwrap();
        assert_eq!(contents,vec!["Goal step 1","Goal step 2"]);
        assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().state,"idle");
    }
    broker.stop_session(&session.id).await.unwrap();
    broker.stop_installation(&installed.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn subagent_history_survives_restart_without_a_running_provider() {
    let root = std::env::temp_dir().join(format!("aibo-host-subagents-{}",ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    let mut manifest: Value = serde_json::from_str(include_str!("../capability-plugins/codex/plugin.json")).unwrap();
    manifest["executableDependencies"] = json!([{"kind":"runtime","name":"node","versionRange":">=22","required":true}]);
    fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
    let engine = include_str!("../capability-plugins/codex/engine.mjs");
    let native_start = "const launcher = codexLauncher();";
    assert!(engine.contains(native_start));
    fs::write(package.join("engine.mjs"),engine.replace(native_start,"const launcher = { command: process.execPath, prefix: [path.join(import.meta.dirname, 'fake-codex.mjs')], shell: false };")).unwrap();
    for (name, source) in [
        ("worker.mjs",include_str!("../capability-plugins/codex/worker.mjs")),
        ("fake-codex.mjs",include_str!("../../fixtures/plugins/codex/fake-codex.mjs")),
        ("session-provider.mjs",include_str!("../capability-plugins/session-provider.mjs")),
        ("runtime.mjs",include_str!("../../packages/capability-runtime/runtime.mjs")),
        ("stdio.mjs",include_str!("../../packages/capability-runtime/stdio.mjs")),
    ] {fs::write(package.join(name),source).unwrap();}
    let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Test',1,?,?)")
        .bind(workspace.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db,&root.join("data"),&package).await.unwrap();
    plugin_registry::enable(&db,&installed.id,true).await.unwrap();
    // Fixture native execution is explicitly authorized by the host, not its ID.
    assert_eq!(execution_profile::installation_backend(&db,&installed.id,"dev.aibo.codex.agent").await.unwrap(),execution_profile::EnforcementBackend::Unnegotiated);
    sqlx::query("INSERT INTO session_execution_authorities(installation_id,contribution_id,backend) VALUES(?,'dev.aibo.codex.agent','codex-native')")
        .bind(&installed.id).execute(&db).await.unwrap();
    let broker = Broker::new(db.clone());
    let host = SessionHost::new(db.clone(),broker.clone());
    broker.bind(Binding {scope:Scope::Workspace("w".into()),capability:"aibo.session.catalog".into(),version:"1.0.0".into(),installation_id:installed.id.clone(),contribution_id:"dev.aibo.codex.catalog".into()}).await.unwrap();
    let catalog = broker.invoke("main",Request {scope:Scope::Workspace("w".into()),capability:"aibo.session.catalog".into(),version:"1.0.0".into(),request_id:"catalog".into(),turn_id:None,input:json!({})}).await.unwrap();
    assert_eq!(catalog.output["threads"][0]["id"],"catalog-thread");
    let count:i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions").fetch_one(&db).await.unwrap();
    assert_eq!(count,0,"workspace catalog must not create a conversation");
    let source = host.create_with_profile_from("main","w",&installed.id,"dev.aibo.codex.agent",None).await.unwrap();

    host.send_configured_from("main",&source.id,"subagents please").await.unwrap();
    wait_for_turn(&host,&source.id).await;
    let cards: Vec<String> = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND tool_name='subagent' ORDER BY sequence")
        .bind(&source.id).fetch_all(&db).await.unwrap();
    assert_eq!(cards.len(),2);
    let states: Vec<Value> = cards.iter().map(|value|serde_json::from_str::<Value>(value).unwrap()["status"].clone()).collect();
    assert_eq!(states,vec![json!("completed"),json!("failed")]);
    let entries = crate::session_history::read_subagent(&db,&source.id,"child-0").await.unwrap();
    assert_eq!(entries.len(),3);
    assert_eq!(entries.last().unwrap()["content"],"Review complete.");
    assert!(crate::session_history::read_subagent(&db,&source.id,"unrelated").await.unwrap().is_empty());
    let branch = host.fork_from("main",&source.id,None).await.unwrap();
    assert_eq!(crate::session_history::read_subagent(&db,&branch.id,"child-0").await.unwrap(),entries);
    sqlx::query("UPDATE sessions SET archived=1 WHERE id=?").bind(&source.id).execute(&db).await.unwrap();
    db.close().await;
    let reopened = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    assert_eq!(crate::session_history::read_subagent(&reopened,&source.id,"child-0").await.unwrap(),entries);
    reopened.close().await;
    fs::remove_dir_all(root).unwrap();
}

async fn queue_state(host: &SessionHost, session: &str) -> Value {
    host.invoke_capability_from("main", session, "queue.manage", json!({"action":"get"})).await.unwrap()
}
async fn wait_for_queue_idle(host: &SessionHost, session: &str) {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if !host.live.lock().await.contains_key(session) && queue_state(host,session).await["items"].as_array().unwrap().is_empty() { break; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("queue did not drain");
}
#[tokio::test]
async fn durable_queue_preserves_fifo_removes_by_identity_and_steers_once() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    host.send_from("main", &session.id, "host queue delay", None).await.unwrap();
    for text in ["duplicate", "duplicate", "last"] {
        host.send_configured_from("main", &session.id, text).await.unwrap();
    }
    let queued = queue_state(&host, &session.id).await;
    let items = queued["items"].as_array().unwrap();
    assert_eq!(items.len(),3);
    assert_ne!(items[0]["id"],items[1]["id"]);
    host.invoke_capability_from("main",&session.id,"queue.manage",json!({"action":"remove","id":items[0]["id"]})).await.unwrap();
    host.invoke_capability_from("main",&session.id,"queue.manage",json!({"action":"sendNow","id":items[2]["id"]})).await.unwrap();
    assert_eq!(queue_state(&host,&session.id).await["items"].as_array().unwrap().len(),1);
    wait_for_queue_idle(&host,&session.id).await;
    let messages: Vec<String> = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='user' ORDER BY created_at,id").bind(&session.id).fetch_all(&db).await.unwrap();
    assert_eq!(messages,vec!["host queue delay","last","duplicate"]);
    let turns: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(turns,2,"steering must not create a new turn");
    broker.stop_session(&session.id).await.unwrap(); db.close().await; fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn durable_queue_survives_stop_and_restart_until_explicit_resume() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    host.send_from("main",&session.id,"host queue delay",None).await.unwrap();
    host.send_configured_from("main",&session.id,"after stop").await.unwrap();
    host.cancel_from("main",&session.id).await.unwrap();
    wait_for_turn(&host,&session.id).await;
    let snapshot=queue_state(&host,&session.id).await;
    assert_eq!(snapshot["paused"],true); assert_eq!(snapshot["items"][0]["text"],"after stop");
    broker.stop_session(&session.id).await.unwrap();
    crate::session_recovery::recover(&db).await.unwrap();
    let restored=SessionHost::new(db.clone(),broker.clone());
    assert_eq!(queue_state(&restored,&session.id).await["items"][0]["id"],snapshot["items"][0]["id"]);
    restored.invoke_capability_from("main",&session.id,"queue.manage",json!({"action":"resume"})).await.unwrap();
    wait_for_queue_idle(&restored,&session.id).await;
    let count: i64=sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id=? AND role='user' AND content='after stop'").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(count,1);
    broker.stop_session(&session.id).await.unwrap(); db.close().await; fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn durable_queue_freezes_attachments_and_retains_changed_files() {
    let (root, db, broker, host, session) = session_queue_fixture(true).await;
    let workspace=crate::workspace_by_id(&db,&session.workspace_id).await.unwrap();
    fs::write(Path::new(&workspace.path).join("queued.txt"),"original").unwrap();
    sqlx::query("INSERT INTO attachments(id,workspace_id,session_id,path,size,media_type,source,send_strategy,created_at) VALUES('queued-file','w',?,'queued.txt',8,'text/plain','manual','reference','now')").bind(&session.id).execute(&db).await.unwrap();
    host.send_from("main",&session.id,"host queue delay",None).await.unwrap();
    // A freshly added draft attachment belongs only to the queued message.
    sqlx::query("UPDATE attachments SET turn_id=NULL WHERE id='queued-file'").execute(&db).await.unwrap();
    host.send_configured_from("main",&session.id,"use file [attachment:queued-file]").await.unwrap();
    let queued=queue_state(&host,&session.id).await;
    sqlx::query("INSERT INTO attachments(id,workspace_id,session_id,path,media_type,source,send_strategy,created_at) VALUES('next-draft','w',?,'next.txt','text/plain','manual','reference','now')").bind(&session.id).execute(&db).await.unwrap();
    fs::write(Path::new(&workspace.path).join("queued.txt"),"changed length").unwrap();
    tokio::time::timeout(Duration::from_secs(10),async {
        loop { if queue_state(&host,&session.id).await["items"][0]["status"]=="failed" {break;} tokio::time::sleep(Duration::from_millis(20)).await; }
    }).await.unwrap();
    let failed=queue_state(&host,&session.id).await;
    assert_eq!(failed["paused"],true); assert_eq!(failed["items"][0]["id"],queued["items"][0]["id"]);
    let draft: (Option<String>,Option<String>)=sqlx::query_as("SELECT turn_id,queued_message_id FROM attachments WHERE id='next-draft'").fetch_one(&db).await.unwrap();
    assert_eq!(draft,(None,None));
    host.invoke_capability_from("main",&session.id,"queue.manage",json!({"action":"remove","id":queued["items"][0]["id"]})).await.unwrap();
    let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE id='queued-file'").fetch_one(&db).await.unwrap(); assert_eq!(count,0);
    broker.stop_session(&session.id).await.unwrap(); db.close().await; fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn queued_send_now_waits_for_finishing_turn_then_starts_exactly_once() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    host.send_from("main",&session.id,"boundary message",None).await.unwrap();
    let finalization=host.turn_baselines.lock().await;
    tokio::time::timeout(Duration::from_secs(5),async {
        loop { if host.live.lock().await.get(&session.id).is_some_and(|run|*run.phase.borrow()==TurnPhase::Settling) {break;} tokio::time::sleep(Duration::from_millis(10)).await; }
    }).await.unwrap();
    host.send_configured_from("main",&session.id,"after boundary").await.unwrap();
    let queued=queue_state(&host,&session.id).await;
    let sending_host=host.clone(); let id=session.id.clone(); let message_id=queued["items"][0]["id"].clone();
    let mut pending=tokio::spawn(async move {sending_host.invoke_capability_from("main",&id,"queue.manage",json!({"action":"sendNow","id":message_id})).await});
    assert!(tokio::time::timeout(Duration::from_millis(30),&mut pending).await.is_err());
    drop(finalization); pending.await.unwrap().unwrap();
    wait_for_queue_idle(&host,&session.id).await;
    let prompts:Vec<String>=sqlx::query_scalar("SELECT input_text FROM turns WHERE session_id=? ORDER BY started_at,id").bind(&session.id).fetch_all(&db).await.unwrap();
    assert_eq!(prompts,vec!["boundary message","after boundary"]);
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn external_provider_without_native_queue_gets_durable_fifo_but_not_steering() {
    let (root, db, broker, host, session) = session_queue_fixture(true).await;
    assert!(session.capabilities.contains(&"queue.manage".into()));
    assert!(!session.capabilities.contains(&"queue.steer".into()));
    let raw: String = sqlx::query_scalar("SELECT plugin_capabilities_json FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert!(!raw.contains("queue.manage"), "host flags must not become provider capabilities");
    host.send_from("main", &session.id, "host queue delay", None).await.unwrap();
    for text in ["first", "second"] { host.send_configured_from("main", &session.id, text).await.unwrap(); }
    let before = queue_state(&host, &session.id).await;
    assert_eq!(before["items"].as_array().unwrap().len(), 2);
    for input in [json!({"action":"steer","message":"must stay in draft"}), json!({"action":"sendNow","id":before["items"][0]["id"]})] {
        assert!(host.invoke_capability_from("main", &session.id, "queue.manage", input).await.unwrap_err().contains("queue.steer"));
    }
    assert_eq!(queue_state(&host, &session.id).await["items"], before["items"], "rejected steering must not claim, duplicate or fail items");
    wait_for_queue_idle(&host, &session.id).await;
    let prompts: Vec<String> = sqlx::query_scalar("SELECT input_text FROM turns WHERE session_id=? ORDER BY started_at,id").bind(&session.id).fetch_all(&db).await.unwrap();
    assert_eq!(prompts, vec!["host queue delay", "first", "second"]);
    broker.stop_session(&session.id).await.unwrap(); db.close().await; fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn external_queue_survives_restart_and_never_retries_uncertain_delivery() {
    let (root, db, broker, host, session) = session_queue_fixture(true).await;
    host.send_from("main", &session.id, "host queue delay", None).await.unwrap();
    host.send_configured_from("main", &session.id, "retained",).await.unwrap();
    host.cancel_from("main", &session.id).await.unwrap(); wait_for_turn(&host, &session.id).await;
    let before = queue_state(&host, &session.id).await;
    assert_eq!(before["paused"], true);
    // Simulate a process exit after durable claim but before an acknowledgement.
    sqlx::query("UPDATE queued_messages SET status='sending' WHERE session_id=?").bind(&session.id).execute(&db).await.unwrap();
    broker.stop_session(&session.id).await.unwrap();
    crate::session_recovery::recover(&db).await.unwrap();
    let restored = SessionHost::new(db.clone(), broker.clone());
    let snapshot = queue_state(&restored, &session.id).await;
    assert_eq!(snapshot["items"][0]["id"], before["items"][0]["id"]);
    assert_eq!(snapshot["items"][0]["status"], "uncertain");
    for input in [json!({"action":"resume"}), json!({"action":"sendNow","id":snapshot["items"][0]["id"]})] {
        assert!(restored.invoke_capability_from("main", &session.id, "queue.manage", input).await.is_err());
    }
    restored.invoke_capability_from("main", &session.id, "queue.manage", json!({"action":"remove","id":snapshot["items"][0]["id"]})).await.unwrap();
    restored.invoke_capability_from("main", &session.id, "queue.manage", json!({"action":"followUp","message":"after recovery"})).await.unwrap();
    restored.invoke_capability_from("main", &session.id, "queue.manage", json!({"action":"resume"})).await.unwrap();
    wait_for_queue_idle(&restored, &session.id).await;
    let prompts: Vec<String> = sqlx::query_scalar("SELECT input_text FROM turns WHERE session_id=? ORDER BY started_at,id").bind(&session.id).fetch_all(&db).await.unwrap();
    assert_eq!(prompts, vec!["host queue delay", "after recovery"]);
    broker.stop_session(&session.id).await.unwrap(); db.close().await; fs::remove_dir_all(root).unwrap();
}


#[tokio::test]
async fn context_window_changes_cannot_bypass_live_turn_admission() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    host.send_from("main", &session.id, "queue parity prompt", None).await.unwrap();
    assert!(host.live.lock().await.contains_key(&session.id));
    let error = host.invoke_capability_from("main", &session.id, "model.context-window", json!({"action":"set","contextWindow":"long"})).await.unwrap_err();
    assert!(error.starts_with("busy:"), "{error}");
    host.cancel_from("main", &session.id).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn third_party_session_negotiates_tree_timeline_and_mediated_access() {
    let (root, db, broker, host, session) = session_queue_fixture(true).await;
    assert_eq!(session.agent, "dev.example.waiting.agent");
    for capability in ["session.tree", "session.timeline", "compaction.run", "model.select", "queue.manage"] {
        assert!(session.capabilities.contains(&capability.into()), "{capability}: {:?}", session.capabilities);
    }
    assert!(!session.capabilities.contains(&"session.fork".into()));
    let profile = crate::session_execution_profile(&db, &session.id).await.unwrap().profile;
    assert_eq!(profile.enforcement_backend, execution_profile::EnforcementBackend::CoreProxy);
    assert_eq!(profile.session_controls.iter().map(|option|option.id.as_str()).collect::<Vec<_>>(), ["read-only", "plan", "workspace-write"]);
    assert!(!profile.native_sandbox);
    host.send_from("main", &session.id, "third party timeline", None).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    let timeline = host.active_timeline_from("main", &session.id).await.unwrap();
    assert!(timeline.iter().any(|entry| entry.role == "assistant" && entry.content.contains("third party timeline")));
    let tree = host.invoke_capability_from("main", &session.id, "session.tree", json!({"action":"get"})).await.unwrap();
    assert!(tree["tree"].is_array());
    let error = host.invoke_capability_from("main", &session.id, "goal.manage", json!({"action":"get"})).await.unwrap_err();
    assert!(error.contains("capability_unsupported"));
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn clipboard_image_reaches_the_negotiated_provider_from_host_storage() {
    let (root, db, broker, host, session) = concurrent_session_fixture().await;
    assert!(session.capabilities.contains(&"image.input".into()));
    let image = serde_json::from_value(serde_json::json!({
        "mediaType":"image/png",
        "data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII="
    })).unwrap();
    let attachments = crate::clipboard_images::register(&db, &root.join("data"), &session.id, vec![image]).await.unwrap();
    host.send_from("main", &session.id, "host clipboard image fixture", None).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    let status: String = sqlx::query_scalar("SELECT status FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(status, "completed", "the fixture rejects absent or changed native image bytes");
    let turn: Option<String> = sqlx::query_scalar("SELECT turn_id FROM attachments WHERE id=?").bind(&attachments[0].id).fetch_one(&db).await.unwrap();
    assert!(turn.is_some());
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn prepared_session_is_visible_before_native_start_and_negotiates_only_when_ready() {
    let (root,db,broker,host,original)=concurrent_session_fixture().await;
    let installation=original.plugin_installation_id.as_deref().unwrap();
    let pending=host.prepare_with_profile("w",installation,&original.agent,None).await.unwrap();
    assert_eq!(pending.state,"starting");
    assert!(pending.external_session_id.is_none());
    assert!(pending.capabilities.is_empty());
    assert!(broker.session_runtime_generation(installation,&original.agent,&pending.id).await.is_none());
    let profile=crate::session_execution_profile(&db,&pending.id).await.unwrap();
    assert!(!profile.profile.session_controls.is_empty(),"local mode declarations are available before native startup");
    let (first,second)=tokio::join!(host.resume_from("main",&pending.id),host.resume_from("main",&pending.id));
    first.unwrap();second.unwrap();
    let ready=crate::session_by_id(&db,&pending.id).await.unwrap();
    assert_eq!(ready.id,pending.id);
    assert_eq!(ready.state,"idle");
    assert!(ready.capabilities.iter().any(|cap|cap=="turn.send"));
    assert!(ready.external_session_id.is_some());
    let failed=host.prepare_with_profile("w",installation,&original.agent,None).await.unwrap();
    plugin_registry::enable(&db,installation,false).await.unwrap();
    assert!(host.resume_from("main",&failed.id).await.is_err());
    assert_eq!(crate::session_by_id(&db,&failed.id).await.unwrap().state,"failed");
    assert!(host.prepare_with_profile("w",installation,&original.agent,None).await.is_err());
    broker.stop_session(&original.id).await.unwrap();
    broker.stop_session(&pending.id).await.unwrap();
    db.close().await;fs::remove_dir_all(root).unwrap();
}

/// The configuration-only echo ACP plugin, opened in Plan mode. The agent runs as `node <fixture>`
/// because the host PATH is shared by parallel tests.
async fn acp_echo_plan_session() -> (PathBuf, SqlitePool, Broker, SessionHost, Session) {
    acp_echo_initial_session(false).await
}

async fn acp_echo_initial_session(without_ask: bool) -> (PathBuf, SqlitePool, Broker, SessionHost, Session) {
    let root = std::env::temp_dir().join(format!("aibo-acp-transition-{}", ulid::Ulid::new()));
    let package = root.join("package");
    let workspace = root.join("workspace");
    fs::create_dir_all(&package).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures");
    for name in ["plugin.json", "worker.mjs", "acp.json"] {
        fs::copy(fixtures.join("plugins/acp-echo").join(name), package.join(name)).unwrap();
    }
    let mut manifest: Value = serde_json::from_str(&fs::read_to_string(package.join("plugin.json")).unwrap()).unwrap();
    manifest["executableDependencies"] = json!([{"kind":"runtime","name":"node","versionRange":">=22","required":true},{"kind":"executable","name":"node","required":true}]);
    if without_ask {
        let controls = manifest["contributions"][0]["sessionControls"].as_array_mut().unwrap();
        controls.retain(|control| control["profile"]["interactionMode"] != "ask");
        // A write mode listed first must never become an implicit authorization.
        controls.sort_by_key(|control| control["profile"]["interactionMode"] == "plan");
    }
    fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
    let mut config: Value = serde_json::from_str(&fs::read_to_string(package.join("acp.json")).unwrap()).unwrap();
    config["command"] = json!("node");
    config["args"] = json!([fixtures.join("acp/echo-agent.mjs").to_string_lossy()]);
    if without_ask { config["modes"].as_object_mut().unwrap().remove("ask"); }
    fs::write(package.join("acp.json"), config.to_string()).unwrap();
    let db = crate::open_database(&root.join("data/db")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'w',1,'now','now')")
        .bind(workspace.to_string_lossy().as_ref()).execute(&db).await.unwrap();
    let installed = plugin_registry::install(&db, &root.join("data"), &package).await.unwrap();
    plugin_registry::enable(&db, &installed.id, true).await.unwrap();
    let broker = Broker::new(db.clone());
    let host = SessionHost::new(db.clone(), broker.clone());
    let mut requested = execution_profile::default_requested_profile("generic").unwrap();
    requested.interaction_mode = "plan".into();
    requested.network_policy = "agent-managed".into();
    let plan = execution_profile::resolve_with_backend(execution_profile::EnforcementBackend::AgentManaged, Some(requested), crate::now_iso()).unwrap();
    let session = host.create_with_profile_from("main", "w", &installed.id, "dev.example.acp-echo.agent", if without_ask { None } else { Some(plan) }).await.unwrap();
    (root, db, broker, host, session)
}

#[tokio::test]
async fn new_session_without_requested_profile_uses_declared_read_only_mode() {
    let (root, db, broker, host, session) = acp_echo_initial_session(true).await;
    let profile = crate::session_execution_profile(&db, &session.id).await.unwrap().profile;
    assert_eq!(profile.requested.interaction_mode, "plan");
    assert_eq!(profile.enforced.filesystem_policy, "read-only");
    assert_eq!(profile.enforced.command_policy, "disabled");
    assert_eq!(session.state, "idle");
    host.send_from("main", &session.id, "default mode", None).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "idle");
    let explicit = execution_profile::resolve_with_backend(execution_profile::EnforcementBackend::AgentManaged, None, crate::now_iso()).unwrap();
    let pending = host.prepare_with_profile("w", session.plugin_installation_id.as_deref().unwrap(), &session.agent, Some(explicit)).await.unwrap();
    assert_eq!(crate::session_execution_profile(&db, &pending.id).await.unwrap().profile.requested.interaction_mode, "ask");
    assert!(host.resume_from("main", &pending.id).await.is_err());
    let status: String = sqlx::query_scalar("SELECT status FROM capability_invocations WHERE scope_id=? AND capability_id='aibo.session.open'")
        .bind(&pending.id).fetch_one(&db).await.unwrap();
    assert_eq!(status, "invalid_input", "explicit Ask must be rejected, not silently become Plan");
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires a built session plugin in AIBO_TEST_PLUGIN_PATH and native authentication"]
async fn packaged_session_opens_with_implicit_profile() {
    let root = std::env::temp_dir().join(format!("aibo-packaged-session-{}", ulid::Ulid::new()));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let db = crate::open_database(&root.join("data/db")).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'w',1,'now','now')")
        .bind(workspace.to_string_lossy().as_ref()).execute(&db).await.unwrap();
    let source = PathBuf::from(std::env::var("AIBO_TEST_PLUGIN_PATH").unwrap());
    let installed = plugin_registry::install(&db, &root.join("data"), &source).await.unwrap();
    plugin_registry::enable(&db, &installed.id, true).await.unwrap();
    let contribution = installed.manifest["contributions"].as_array().unwrap().iter()
        .find(|entry| entry["kind"] == "capabilityProvider" && entry["scope"] == "session").unwrap()["id"].as_str().unwrap();
    let broker = Broker::new(db.clone());
    let host = SessionHost::new(db.clone(), broker.clone());
    // Same two-stage path as the desktop create action; no hand-written Plan profile.
    let pending = host.prepare_with_profile("w", &installed.id, contribution, None).await.unwrap();
    let result = host.resume_from("main", &pending.id).await;
    let session = crate::session_by_id(&db, &pending.id).await.unwrap();
    let profile = crate::session_execution_profile(&db, &pending.id).await.unwrap().profile;
    broker.stop_session(&pending.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
    result.unwrap();
    assert_eq!(session.state, "idle");
    assert_eq!(profile.enforced.interaction_mode, "plan");
    assert!(session.capabilities.contains(&"session.create".into()));
}

async fn pending_approval(db: &SqlitePool, session: &str) -> String {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let events: Vec<String> = sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? AND event_type='approval.requested'")
                .bind(session).fetch_all(db).await.unwrap();
            if let Some(event) = events.first() { break serde_json::from_str::<Value>(event).unwrap()["payload"]["requestId"].as_str().unwrap().to_owned(); }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("plan approval was not requested")
}

#[tokio::test]
async fn approved_plan_transition_is_committed_by_the_host_before_the_agent_switches() {
    let (root, db, broker, host, session) = acp_echo_plan_session().await;
    let mode = |db: SqlitePool, id: String| async move { crate::session_execution_profile(&db, &id).await.unwrap().profile.enforced.interaction_mode };
    host.send_from("main", &session.id, "exitplan", None).await.unwrap();
    let request_id = pending_approval(&db, &session.id).await;
    assert!(host.resolve_approval_option_from("other-window", &session.id, &request_id, "exit-plan-default").await.unwrap_err().contains("another window"));
    sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'").execute(&db).await.unwrap();
    assert!(host.resolve_approval_option_from("main", &session.id, &request_id, "exit-plan-default").await.unwrap_err().contains("workspace_untrusted"));
    assert_eq!(mode(db.clone(), session.id.clone()).await, "plan", "a refused transition leaves the host profile unchanged");
    sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='w'").execute(&db).await.unwrap();
    host.resolve_approval_option_from("main", &session.id, &request_id, "exit-plan-default").await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(mode(db.clone(), session.id.clone()).await, "edit");
    let changed: String = sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? AND event_type='session.control_changed'")
        .bind(&session.id).fetch_one(&db).await.unwrap();
    let changed: Value = serde_json::from_str(&changed).unwrap();
    assert_eq!(changed["payload"], json!({"controlId":"code","previousControlId":"plan","label":"Code","cause":"approval","requestId":request_id}));
    let record: String = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='system'").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(record, "审批后切换到 Code");
    let reply: String = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='assistant'").bind(&session.id).fetch_one(&db).await.unwrap();
    assert!(reply.contains("exitplan:exit-plan-default"), "{reply}");
    let status: String = sqlx::query_scalar("SELECT status FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(status, "completed");
    let (generation, binding): (String, String) = sqlx::query_as("SELECT generation_id,plugin_binding_json FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    let binding: Value = serde_json::from_str(&binding).unwrap();
    let turn: String = sqlx::query_scalar("SELECT id FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    let forged = json!({"nativeSessionId":binding["nativeSessionId"],"turnId":turn,"type":"session.control_changed","correlation":null,
        "payload":{"controlId":"code","previousControlId":"plan","label":"Code","cause":"approval","requestId":"r"}});
    assert!(host.project_event(&session.id, "w", &generation, &binding, forged, EventOrigin::Plugin).await.unwrap_err().contains("committed by the host"),
        "providers cannot announce control changes");
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn clear_context_approval_is_recorded_and_the_first_resume_says_what_was_restored() {
    let (root, db, broker, host, session) = acp_echo_plan_session().await;
    host.send_from("main", &session.id, "exitplan", None).await.unwrap();
    let request_id = pending_approval(&db, &session.id).await;
    host.resolve_approval_option_from("main", &session.id, &request_id, "exit-plan-clear-default").await.unwrap();
    wait_for_turn(&host, &session.id).await;
    let changed: String = sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? AND event_type='session.control_changed'")
        .bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&changed).unwrap()["payload"]["contextReset"], true);
    let notes = |db: SqlitePool, id: String| async move {
        sqlx::query_scalar::<_, String>("SELECT content FROM messages WHERE session_id=? AND role='system' ORDER BY created_at,sequence").bind(id).fetch_all(&db).await.unwrap()
    };
    assert_eq!(notes(db.clone(), session.id.clone()).await, ["审批后清空上下文并切换到 Code"]);
    for _ in 0..2 {
        broker.stop_session(&session.id).await.unwrap();
        host.resume_from("main", &session.id).await.unwrap();
    }
    let recorded = notes(db.clone(), session.id.clone()).await;
    assert_eq!(recorded.len(), 2, "one notice per reset, however often the session resumes: {recorded:?}");
    assert!(recorded[1].starts_with("会话已恢复。之前批准计划时清空过上下文"));
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}
