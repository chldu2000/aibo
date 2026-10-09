use super::*;
use std::fs;

fn replacement_package(root:&Path, version:&str) {
    let path=root.join("package/plugin.json");
    let mut manifest:Value=serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    manifest["version"]=json!(version);fs::write(path,manifest.to_string()).unwrap();
}

// Existing migration tests model established native history, not disposable opens.
async fn replacement_history(db: &SqlitePool) {
    sqlx::query("INSERT OR IGNORE INTO turns(id,session_id,external_turn_id,status,input_text,started_at) SELECT 'history-'||id,id,'history-'||id,'completed','established history','now' FROM sessions")
        .execute(db).await.unwrap();
}

#[tokio::test]
async fn plugin_replacement_rebuilds_empty_binding_preserving_draft_and_undo() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let before=host.saved_binding(&session.id).await.unwrap();
    sqlx::query("INSERT INTO composer_drafts(session_id,text,updated_at) VALUES(?,'unfinished draft','now')").bind(&session.id).execute(&db).await.unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    assert_eq!(preview.rebuild_sessions,vec![session.id.clone()]);
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,true).await.unwrap();
    assert!(host.saved_binding(&session.id).await.unwrap().is_none());
    let calls:i64=sqlx::query_scalar("SELECT count(*) FROM capability_invocations WHERE installation_id=?").bind(&target.id).fetch_one(&db).await.unwrap();assert_eq!(calls,0);
    let draft:String=sqlx::query_scalar("SELECT text FROM composer_drafts WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(draft,"unfinished draft");
    host.undo_plugin_replacement(&root.join("data"),&target.id).await.unwrap();
    assert_eq!(host.saved_binding(&session.id).await.unwrap(),before);
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_first_failure_requires_durable_non_delivery_and_restores_draft() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES('first-failure',?,'first-failure','failed','retry manually','now')").bind(&session.id).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES('failed-input',?,'first-failure','user','retry manually','completed','now','now')").bind(&session.id).execute(&db).await.unwrap();
    // Historical failures cannot be inferred safe from failed status alone.
    assert!(crate::session_rebuild::plan(&db,&session.id).await.unwrap().is_none());
    sqlx::query("INSERT INTO turn_delivery VALUES('first-failure','possibly_sent')").execute(&db).await.unwrap();
    assert!(crate::session_rebuild::plan(&db,&session.id).await.unwrap().is_none());
    sqlx::query("UPDATE turn_delivery SET state='responded'").execute(&db).await.unwrap();
    assert!(crate::session_rebuild::plan(&db,&session.id).await.unwrap().is_none());
    sqlx::query("UPDATE turn_delivery SET state='not_sent'").execute(&db).await.unwrap();
    sqlx::query("INSERT INTO composer_drafts(session_id,text,updated_at) VALUES(?,'other draft','now')").bind(&session.id).execute(&db).await.unwrap();
    assert!(crate::session_rebuild::plan(&db,&session.id).await.unwrap().is_none());
    sqlx::query("DELETE FROM composer_drafts").execute(&db).await.unwrap();
    sqlx::query("INSERT INTO attachments(id,workspace_id,session_id,turn_id,path,media_type,source,send_strategy,created_at) VALUES('failed-file','w',?,'first-failure','note.txt','text/plain','manual','reference','now')").bind(&session.id).execute(&db).await.unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    assert_eq!(preview.rebuild_sessions,vec![session.id.clone()]);
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,true).await.unwrap();
    assert!(host.saved_binding(&session.id).await.unwrap().is_none());
    let draft:String=sqlx::query_scalar("SELECT text FROM composer_drafts WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(draft,"retry manually");
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(count,1,"upgrade must not resend");
    let files:i64=sqlx::query_scalar("SELECT count(*) FROM attachments WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(files,2,"keep historical attachment and restore a draft copy");
    host.undo_plugin_replacement(&root.join("data"),&target.id).await.unwrap();
    let draft:String=sqlx::query_scalar("SELECT text FROM composer_drafts WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(draft,"retry manually","undo preserves recovered draft");
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_skips_archived_failure_and_undo_restores_it() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    let active=host.create_with_profile_from("main","w",&source,&session.agent,None).await.unwrap();
    sqlx::query("UPDATE session_bindings SET plugin_binding_json=json_set(plugin_binding_json,'$.nativeSessionId','broken-recovery') WHERE session_id=?").bind(&session.id).execute(&db).await.unwrap();
    let before=host.saved_binding(&session.id).await.unwrap();
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('archive-history',?,'assistant','retained history','completed','now','now')").bind(&session.id).execute(&db).await.unwrap();
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    let stale=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    sqlx::query("UPDATE sessions SET archived=1,state='closed' WHERE id=?").bind(&session.id).execute(&db).await.unwrap();
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&stale.token),false,true).await.err().unwrap().diagnostic.contains("确认"));
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    assert_eq!(preview.archived_sessions,vec![session.id.clone()]);
    // Explicit inclusion retains strict identity validation and rolls back all changes.
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.err().unwrap().diagnostic.contains("原会话"));
    assert!(!crate::session_by_id(&db,&session.id).await.unwrap().history_only);
    assert_eq!(host.saved_binding(&session.id).await.unwrap(),before);
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let attempts:i64=sqlx::query_scalar("SELECT count(*) FROM capability_invocations WHERE scope_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,true).await.unwrap();
    let after_attempts:i64=sqlx::query_scalar("SELECT count(*) FROM capability_invocations WHERE scope_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(attempts,after_attempts,"skipped archive must not invoke the candidate");
    let content:String=sqlx::query_scalar("SELECT content FROM messages WHERE id='archive-history'").fetch_one(&db).await.unwrap();assert_eq!(content,"retained history");
    let skipped=crate::session_by_id(&db,&session.id).await.unwrap();
    assert!(skipped.archived && skipped.history_only);assert_eq!(skipped.state,"closed");
    assert_eq!(skipped.plugin_installation_id.as_deref(),Some(source.as_str()));
    assert_eq!(crate::session_by_id(&db,&active.id).await.unwrap().plugin_installation_id.as_deref(),Some(target.id.as_str()));
    host.undo_plugin_replacement(&root.join("data"),&target.id).await.unwrap();
    assert!(!crate::session_by_id(&db,&session.id).await.unwrap().history_only);
    assert_eq!(host.saved_binding(&session.id).await.unwrap(),before);
    broker.stop_installation(&source).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_is_single_version_and_undo_restores_history_and_bindings() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let source=session.plugin_installation_id.clone().unwrap();
    let pending=host.prepare_with_profile("w",&source,&session.agent,None).await.unwrap();
    let before=host.saved_binding(&session.id).await.unwrap();
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    assert_eq!(preview.kind,"upgrade");
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
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
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let error=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.err().unwrap();
    assert!(error.diagnostic.contains("原会话"),"{error}");
    assert_eq!(error.display()["key"],"native.plugin.upgradeFailed");
    assert_eq!(error.display()["params"]["reason"]["key"],"native.plugin.identityChanged");
    assert_eq!(host.saved_binding(&first.id).await.unwrap(),first_before);
    assert_eq!(host.saved_binding(&second.id).await.unwrap(),second_before);
    assert_eq!(crate::session_by_id(&db,&first.id).await.unwrap().plugin_installation_id.as_deref(),Some(source.as_str()));
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM plugin_installations WHERE installed=1").fetch_one(&db).await.unwrap();assert_eq!(count,1);
    assert!(crate::plugin_replacement::undo_targets(&db).await.unwrap().is_empty());
    // Removing the corrupted test session allows a retry of the same candidate identity.
    sqlx::query("DELETE FROM sessions WHERE id=?").bind(&second.id).execute(&db).await.unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
    broker.stop_session(&first.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_downgrade_requires_reinstall_and_keeps_business_history() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    sqlx::query("INSERT INTO messages(id,session_id,role,content,status,created_at,updated_at) VALUES('retained',?,'assistant','business history','completed','now','now')").bind(&session.id).execute(&db).await.unwrap();
    replacement_history(&db).await;
    replacement_package(&root,"0.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();assert_eq!(preview.kind,"downgrade");
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.err().unwrap().diagnostic.contains("直接降级"));
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),true,false).await.unwrap();assert!(!target.enabled);
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
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
    host.invoke_capability_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap();
    assert!(crate::plugin_replacement::undo_targets(&db).await.unwrap().is_empty());
    let binding=host.saved_binding(&session.id).await.unwrap();
    let worker_path=root.join("data/plugins").join(&target.id).join("worker.mjs");
    let worker=fs::read(&worker_path).unwrap();
    let calls:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    let error=host.undo_plugin_replacement(&root.join("data"),&target.id).await.unwrap_err();
    assert_eq!(error.diagnostic,"新版已开始使用或没有可撤销的升级；如需降级，请选择清除数据重装");
    assert_eq!(error.display()["key"],"native.plugin.undoUnavailable");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"The upgrade can no longer be undone. To downgrade, choose to clear plugin data and reinstall.");
    assert_eq!(host.saved_binding(&session.id).await.unwrap(),binding);
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().plugin_installation_id.as_ref(),Some(&target.id));
    assert_eq!(fs::read(worker_path).unwrap(),worker);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap(),calls);
    assert!(!root.join("data/plugins").join(source).exists());
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_duplicate_same_version_and_stale_confirmation() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();assert_eq!(preview.kind,"installed");
    let same=host.replace_plugin(&root.join("data"),&root.join("package"),None,false,false).await.unwrap();assert_eq!(Some(same.id),session.plugin_installation_id);
    let path=root.join("package/worker.mjs");let worker=fs::read_to_string(&path).unwrap();fs::write(&path,format!("{worker}\n// replacement bytes\n")).unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();assert_eq!(preview.kind,"replace");
    fs::write(&path,format!("{worker}\n// another package\n")).unwrap();
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.err().unwrap().diagnostic.contains("确认"));
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
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
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    sqlx::query("UPDATE sessions SET state='running' WHERE id=?").bind(&session.id).execute(&db).await.unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    assert!(host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.err().unwrap().diagnostic.contains("停止"));
    sqlx::query("UPDATE sessions SET state='closed',archived=1 WHERE id=?").bind(&session.id).execute(&db).await.unwrap();
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
    let after=crate::session_by_id(&db,&session.id).await.unwrap();assert!(after.archived);assert_eq!(after.state,"closed");assert!(!after.history_only);assert_eq!(after.plugin_installation_id.as_deref(),Some(target.id.as_str()));
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_preserves_disabled_state_and_bootstrap_does_not_resurrect_versions() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let old=session.plugin_installation_id.clone().unwrap();
    plugin_registry::enable(&db,&old,false).await.unwrap();
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
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
        replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
        let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
        let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
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
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let target=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,false).await.unwrap();
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
    let display=report.failed[0].localized_label.as_ref().unwrap();
    let reason=display["params"]["reason"].as_str().expect("a crashed provider keeps its original diagnostic");
    assert!(!reason.is_empty());
    assert_eq!(report.failed[0].label,format!("{}：{reason}",session.label));
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,display),format!("{}: {reason}",session.label));
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
    let error=host.remove_release(&root.join("data"),&impact,false).await.unwrap_err();
    assert_eq!(error.diagnostic,"请先迁移会话，或明确选择保留历史并停用");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"Migrate the sessions first, or explicitly choose to keep their history and disable them.");
    sqlx::query("INSERT INTO capability_provider_bindings VALUES('application','application','test','1.0.0',?,'test','now')").bind(&source).execute(&db).await.unwrap();
    assert!(host.remove_release(&root.join("data"),&impact,true).await.unwrap_err().diagnostic.contains("引用已变化"));
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
    for error in [host.cancel_from_display("other-window",&session.id).await.unwrap_err(),host.close_from_display("other-window",&session.id).await.unwrap_err()] {
        assert_eq!(error.diagnostic,"permission_denied: invocation belongs to another window");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"This operation belongs to another window.");
    }
    let error=host.archive_from_display("main",&session.id).await.unwrap_err();
    assert_eq!(error.diagnostic,"busy: session has an active invocation");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"This session has an active operation.");
    let error=host.fork_display_from("main",&session.id,None,crate::ui_i18n::Locale::En).await.unwrap_err();
    assert_eq!(error.diagnostic,"busy: session must be idle before branching");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"The session must be idle before branching.");
    assert!(!host.live.lock().await.get(&session.id).unwrap().cancel.load(Ordering::Acquire));
    host.cancel_from("main", &session.id).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    assert_eq!(crate::session_by_id(&db, &session.id).await.unwrap().state, "interrupted");
    let failure: String = sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? AND event_type='adapter.crashed' ORDER BY occurred_at DESC LIMIT 1").bind(&session.id).fetch_one(&db).await.unwrap();
    let failure: Value = serde_json::from_str(&failure).unwrap();
    assert_eq!(failure["payload"]["status"], "interrupted");
    assert!(failure["eventId"].is_string());
    let display=&failure["payload"]["localizedReason"];
    assert_eq!(display["schema"],"aibo.host-message/v1");
    assert_eq!(display["key"],"native.session.invocationFailure");
    assert_eq!(display["params"]["code"],"cancelled");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,display),failure["payload"]["reason"].as_str().unwrap());
    assert_ne!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,display),failure["payload"]["reason"].as_str().unwrap());
    let terminal_count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM agent_events WHERE session_id=? AND turn_id=? AND event_type='adapter.crashed'")
        .bind(&session.id).bind(failure["turnId"].as_str().unwrap()).fetch_one(&db).await.unwrap();
    assert_eq!(terminal_count,1);
    broker.stop_session(&session.id).await.unwrap();
    db.close().await;
    let reopened=crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    let persisted:String=sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE event_id=?")
        .bind(failure["eventId"].as_str().unwrap()).fetch_one(&reopened).await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&persisted).unwrap(),failure);
    assert_eq!(crate::session_by_id(&reopened,&session.id).await.unwrap().state,"interrupted");
    reopened.close().await;
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
    assert!(plugin_registry::enable(&db, &installed.id, true).await.unwrap_err().diagnostic.contains("已退役"));
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
        ("background-tasks.mjs",include_str!("../capability-plugins/codex/background-tasks.mjs")),
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
    let mut background = Vec::new();
    for status in ["running","completed","unknown"] {
        let task=json!({"id":format!("job-{status}"),"rootTurnId":turn,"name":"任务名称 {name}","command":"echo 命令原文 {command}","activity":"任务属于原会话，分支不继承进程状态。","status":status,"exitCode":7,"outputPath":"/用户/{path}"});
        sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,tool_name,content,status,created_at,updated_at) VALUES(?,?,?,'system','background_task',?,?,?,?)")
            .bind(format!("background-{status}")).bind(&source.id).bind(&turn).bind(task.to_string()).bind(if status=="running"{"streaming"}else{"completed"}).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        background.push(task);
    }
    let raw_label = "用户 /{label} · 分支";
    sqlx::query("UPDATE sessions SET label=? WHERE id=?").bind(raw_label).bind(&source.id).execute(&db).await.unwrap();
    let notice = crate::ui_i18n::HostMessage::new("native.session.controlChanged",json!({"label":"模式原文 {label}"}));
    for (id,metadata) in [("host-notice",notice.localized.as_ref().map(Value::to_string)),("legacy-notice",None)] {
        sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,localized_content_json,status,created_at,updated_at) VALUES(?,?,?,'system',?,?,'completed',?,?)")
            .bind(id).bind(&source.id).bind(&turn).bind(&notice.diagnostic).bind(metadata).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
    }
    assert!(host.fork_from("main",&source.id,Some("foreign-turn")).await.unwrap_err().contains("completed source turn"));
    let error=host.fork_display_from("main",&source.id,Some("foreign-turn"),crate::ui_i18n::Locale::En).await.unwrap_err();
    assert_eq!(error.diagnostic,"invalid_input: fork boundary must be a completed source turn");
    let serialized=serde_json::to_value(crate::ui_i18n::session_operation_message(error)).unwrap();
    assert_eq!(serialized["code"],"session_operation_error");
    assert_eq!(serialized["message"],"session operation failed: invalid_input: fork boundary must be a completed source turn");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&serialized["localized"]),"Choose a completed turn from the source session as the branch boundary.");
    sqlx::query("UPDATE turns SET status='failed' WHERE id=?").bind(&turn).execute(&db).await.unwrap();
    let error=host.fork_display_from("main",&source.id,None,crate::ui_i18n::Locale::En).await.unwrap_err();
    assert_eq!(error.diagnostic,"invalid_input: no completed fork boundary");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"This session has no completed turn to branch from.");
    sqlx::query("UPDATE turns SET status='completed',external_turn_id=id WHERE id=?").bind(&turn).execute(&db).await.unwrap();
    let error=host.fork_display_from("main",&source.id,Some(&turn),crate::ui_i18n::Locale::En).await.unwrap_err();
    assert_eq!(error.diagnostic,"history_only: this turn has no native fork identity");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"This turn has no native branch identity and only supports history.");
    sqlx::query("UPDATE turns SET external_turn_id=? WHERE id=?").bind(&native).bind(&turn).execute(&db).await.unwrap();
    let sessions:i64=sqlx::query_scalar("SELECT COUNT(*) FROM sessions").fetch_one(&db).await.unwrap();assert_eq!(sessions,1);
    let branch = host.fork_with_locale_from("main",&source.id,Some(&turn),crate::ui_i18n::Locale::En).await.unwrap();
    assert_eq!(branch.label,format!("{raw_label} · Branch"));
    assert_eq!(crate::session_by_id(&db,&source.id).await.unwrap().label,raw_label);
    let notices: Vec<(String,Option<String>)> = sqlx::query_as("SELECT content,localized_content_json FROM messages WHERE session_id=? AND role='system' AND tool_name IS NULL ORDER BY created_at,sequence,id")
        .bind(&branch.id).fetch_all(&db).await.unwrap();
    assert_eq!(notices.len(),2);assert!(notices.iter().all(|(content,_)|content==&notice.diagnostic));
    assert_eq!(notices.iter().filter(|(_,metadata)|metadata.is_some()).count(),1);
    let display:Value=serde_json::from_str(notices.iter().find_map(|(_,metadata)|metadata.as_ref()).unwrap()).unwrap();
    assert_eq!(display,notice.localized.clone().unwrap());
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&display),"Switched to 模式原文 {label} after approval");
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
    let rows=sqlx::query("SELECT * FROM messages WHERE session_id=? AND tool_name='background_task'").bind(&branch.id).fetch_all(&db).await.unwrap();
    assert_eq!(rows.len(),3);
    for row in rows {
        let item=serde_json::to_value(crate::row_to_timeline_item(&row).unwrap()).unwrap();
        let task:Value=serde_json::from_str(item["content"].as_str().unwrap()).unwrap();
        let original=background.iter().find(|value|value["id"]==task["id"]).unwrap();
        let mut expected=original.clone();expected["rootTurnId"]=item["turnId"].clone();
        if original["status"]=="running" {
            expected["status"]=json!("unknown");assert_eq!(item["status"],"failed");
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&item["localizedActivity"]),"This task belongs to the source session. A branch does not inherit its process state.");
            assert!(item.get("localizedContent").is_none());
        } else {assert!(item.get("localizedActivity").is_none());}
        assert_eq!(task,expected);
        let stored:String=sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND id=?").bind(&source.id).bind(format!("background-{}",original["status"].as_str().unwrap())).fetch_one(&db).await.unwrap();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(),*original);
    }
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
    let reopened=crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    assert_eq!(crate::session_by_id(&reopened,&branch.id).await.unwrap().label,branch.label);
    let saved:Vec<(String,Option<String>)>=sqlx::query_as("SELECT content,localized_content_json FROM messages WHERE session_id=? AND role='system' AND tool_name IS NULL ORDER BY created_at,sequence,id").bind(&branch.id).fetch_all(&reopened).await.unwrap();
    assert_eq!(saved,notices);
    let row=sqlx::query("SELECT * FROM messages WHERE session_id=? AND tool_name='background_task' AND status='failed'").bind(&branch.id).fetch_one(&reopened).await.unwrap();
    let restored=serde_json::to_value(crate::row_to_timeline_item(&row).unwrap()).unwrap();
    assert_eq!(restored["localizedActivity"]["key"],"native.background.forkActivity");
    assert!(restored.get("localizedContent").is_none());
    reopened.close().await;
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
    let delivery:String=sqlx::query_scalar("SELECT d.state FROM turn_delivery d JOIN turns t ON t.id=d.turn_id WHERE t.session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(delivery,"not_sent","denied host approval never dispatches to the provider");
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
        for (error,key,diagnostic) in [
            (host.resolve_approval_display_from("other-window",&session.id,&request_id,"accept").await.unwrap_err(),"native.approval.sessionMismatch","invalid_session: approval session mismatch"),
            (host.resolve_approval_option_display_from("main",&session.id,&request_id,"allow").await.unwrap_err(),"native.approval.coreDecision","invalid_request: Core tool approvals take a decision"),
            (host.resolve_approval_display_from("main",&session.id,&request_id,"invalid").await.unwrap_err(),"native.approval.decision","invalid_request: approval decision must be accept or cancel"),
        ] {assert_eq!(error.diagnostic,diagnostic);assert_eq!(error.display()["key"],key);assert_ne!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&error.display()),diagnostic);}
        assert!(host.pending_tools.lock().await.contains_key(&request_id));
        assert!(!target.exists());
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

#[tokio::test]
async fn session_start_and_invocation_guards_keep_diagnostics_and_display_without_execution() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    broker.stop_session(&session.id).await.unwrap();
    let installation=session.plugin_installation_id.as_ref().unwrap();
    let raw:String=sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=?").bind(installation).fetch_one(&db).await.unwrap();
    let binding=host.saved_binding(&session.id).await.unwrap().unwrap();
    let before:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    let missing="缺失身份 /{id}";
    for (error,key,diagnostic,english) in [
        (host.prepare_with_profile_display(missing,installation,&session.agent,None).await.unwrap_err(),"native.error.workspaceNotFound",format!("workspace not found: {missing}"),format!("Workspace not found: {missing}")),
        (host.resume_from_display("main",missing).await.unwrap_err(),"native.error.sessionNotFound",format!("session not found: {missing}"),format!("Session not found: {missing}")),
        (host.active_timeline_display_from("main",missing).await.unwrap_err(),"native.error.sessionNotFound",format!("session not found: {missing}"),format!("Session not found: {missing}")),
    ] {
        assert_eq!(error.diagnostic,diagnostic);assert_eq!(error.display()["key"],key);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),english);
        assert_eq!(serde_json::to_value(error).unwrap()["localized"]["params"]["id"],missing);
    }
    for (target,agent,key,diagnostic,english) in [
        ("missing",session.agent.as_str(),"native.session.installationUnavailable","provider_unavailable: installation is disabled or missing","The plugin installation is disabled or missing."),
        (installation.as_str(),"missing.agent","native.session.contributionMissing","provider_unavailable: session contribution is missing","The plugin’s session contribution is missing."),
    ] {
        let error=host.prepare_with_profile_display("w",target,agent,None).await.unwrap_err();
        assert_eq!(error.diagnostic,diagnostic);assert_eq!(error.display()["key"],key);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),english);
    }
    sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'").execute(&db).await.unwrap();
    let error=host.prepare_with_profile_display("w",installation,&session.agent,None).await.unwrap_err();
    assert_eq!(error.diagnostic,"permission_denied: workspace trust required");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"Trust the workspace before creating a session.");
    sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='w'").execute(&db).await.unwrap();
    let sessions:i64=sqlx::query_scalar("SELECT COUNT(*) FROM sessions").fetch_one(&db).await.unwrap();assert_eq!(sessions,1);
    let mut invalid:Value=serde_json::from_str(&raw).unwrap();invalid["version"]=json!("bad-version");
    for (mutation,key,diagnostic,english) in [
        ("retired","native.session.retiredData","history_only: 此会话的插件数据已清除，仅保留业务历史","This session’s plugin data has been cleared. Its conversation history is still available."),
        ("unbound","native.session.newCapabilitySession","history_only: create a new capability session","This session only supports history. Create a new capability session to continue."),
        ("disabled","native.session.pinnedUnavailable","provider_unavailable: pinned release is disabled or missing","The release pinned to this session is disabled or missing."),
        ("invalid","native.manifest.schemaValidation","invalid_manifest: schema validation failed","The manifest does not match its schema."),
        ("retiredRuntime","native.session.retiredRuntime","history_only: this session uses the retired Agent runtime","This session uses a retired Agent runtime and only supports history."),
        ("closed","native.session.closed","invalid_session: session is closed","This session is closed or archived."),
        ("oldBinding","native.session.oldBinding","history_only: old session binding cannot execute","The old session binding cannot execute. Its history is still available."),
    ] {
        match mutation {
            "retired"=>{sqlx::query("INSERT INTO plugin_session_retirements VALUES(?,'now')").bind(&session.id).execute(&db).await.unwrap();},
            "unbound"=>{sqlx::query("UPDATE sessions SET plugin_installation_id=NULL WHERE id=?").bind(&session.id).execute(&db).await.unwrap();},
            "disabled"=>{sqlx::query("UPDATE plugin_installations SET enabled=0 WHERE id=?").bind(installation).execute(&db).await.unwrap();},
            "invalid"=>{sqlx::query("UPDATE plugin_installations SET manifest_json=? WHERE id=?").bind(invalid.to_string()).bind(installation).execute(&db).await.unwrap();},
            "retiredRuntime"=>{sqlx::query("UPDATE sessions SET agent='retired.agent' WHERE id=?").bind(&session.id).execute(&db).await.unwrap();},
            "closed"=>{sqlx::query("UPDATE sessions SET archived=1 WHERE id=?").bind(&session.id).execute(&db).await.unwrap();},
            "oldBinding"=>{sqlx::query("UPDATE session_bindings SET plugin_binding_json='{}' WHERE session_id=?").bind(&session.id).execute(&db).await.unwrap();},
            _=>unreachable!(),
        }
        let errors=[
            host.resume_from_display("main",&session.id).await.unwrap_err(),
            host.invoke_capability_display_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap_err(),
            host.run_admitted("main",&session.id,"消息原文 {message}",None,false,None).await.unwrap_err(),
            host.fork_display_from("main",&session.id,None,crate::ui_i18n::Locale::En).await.unwrap_err(),
            host.active_timeline_display_from("main",&session.id).await.unwrap_err(),
            host.invoke_capability_display_from("main",&session.id,"session.snapshot",json!({})).await.unwrap_err(),
            host.invoke_capability_display_from("main",&session.id,"model.reasoning",json!({"action":"list"})).await.unwrap_err(),
            host.invoke_capability_display_from("main",&session.id,"session.tree",json!({"action":"get"})).await.unwrap_err(),
            host.invoke_capability_display_from("main",&session.id,"session.tree",json!({"action":"navigate","entryId":"原始节点 {id}","summarize":false,"customInstructions":null,"replaceInstructions":false})).await.unwrap_err(),
            host.invoke_capability_display_from("main",&session.id,"user-input.respond",json!({"requestId":"原始请求 {id}","answers":{"回答":"原文"}})).await.unwrap_err(),
        ];
        for error in errors {
            assert_eq!(error.diagnostic,diagnostic);
            assert_eq!(error.display()["key"],key);
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),english);
            let serialized=serde_json::to_value(&error).unwrap();assert_eq!(serialized["message"],diagnostic);assert_eq!(serialized["localized"],error.display());
            let ipc=serde_json::to_value(crate::ui_i18n::session_operation_message(error)).unwrap();
            assert_eq!(ipc["code"],"session_operation_error");
            assert_eq!(ipc["message"],format!("session operation failed: {diagnostic}"));
            assert_eq!(ipc["localized"],serialized["localized"]);
        }
        assert_eq!(host.resume_from("main",&session.id).await.unwrap_err(),diagnostic);
        let calls:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();assert_eq!(calls,before);
        let turns:i64=sqlx::query_scalar("SELECT COUNT(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(turns,0);
        // Restore the same pinned identity and binding for the next independent guard.
        sqlx::query("DELETE FROM plugin_session_retirements WHERE session_id=?").bind(&session.id).execute(&db).await.unwrap();
        sqlx::query("UPDATE sessions SET plugin_installation_id=?,agent=?,archived=0 WHERE id=?").bind(installation).bind(&session.agent).bind(&session.id).execute(&db).await.unwrap();
        sqlx::query("UPDATE plugin_installations SET enabled=1,manifest_json=? WHERE id=?").bind(&raw).bind(installation).execute(&db).await.unwrap();
        sqlx::query("UPDATE session_bindings SET plugin_binding_json=? WHERE session_id=?").bind(binding.to_string()).bind(&session.id).execute(&db).await.unwrap();
    }
    // Rejection must not prevent a later successful resume using the same binding.
    host.resume_from_display("main",&session.id).await.unwrap();
    let error=host.invoke_capability_display_from("main",&session.id,"未知能力 {capability}",json!({})).await.unwrap_err();
    assert_eq!(error.diagnostic,"capability_unsupported: 未知能力 {capability}");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"This session does not support 未知能力 {capability}.");
    let error=host.invoke_capability_display_from("main",&session.id,"goal.resume",json!({"invalid":true})).await.unwrap_err();
    assert_eq!(error.diagnostic,"invalid_input: goal.resume takes no parameters");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"Resuming a goal does not accept parameters.");
    assert_eq!(host.saved_binding(&session.id).await.unwrap().unwrap()["nativeSessionId"],binding["nativeSessionId"]);
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().plugin_installation_id.as_ref(),Some(installation));
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
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
    let delivery:String=sqlx::query_scalar("SELECT d.state FROM turn_delivery d JOIN turns t ON t.id=d.turn_id WHERE t.session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(delivery,"responded");
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
    assert!(stale_control.diagnostic.contains("finished accepting interactions"));
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&stale_control.display()),"This turn no longer accepts interactions.");
    let binding=host.saved_binding(&session.id).await.unwrap().unwrap();
    let error=host.close_from_display("main",&session.id).await.unwrap_err();
    assert_eq!(error.diagnostic,"busy: session is still stopping");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"The session is still stopping. Try again after it finishes.");
    assert_ne!(crate::session_by_id(&db,&session.id).await.unwrap().state,"closed");
    assert_eq!(host.saved_binding(&session.id).await.unwrap().unwrap(),binding);
    let pending_host = host.clone(); let id = session.id.clone();
    let mut read = tokio::spawn(async move { pending_host.invoke_capability_from("main", &id, "session.timeline", json!({})).await });
    let premature = tokio::time::timeout(Duration::from_millis(50), &mut read).await;
    drop(finalization);
    let result = match premature { Ok(result) => result.unwrap(), Err(_) => read.await.unwrap() };
    wait_for_turn(&host, &session.id).await;
    host.close_from_display("main",&session.id).await.unwrap();
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().state,"closed");
    assert_eq!(host.saved_binding(&session.id).await.unwrap().unwrap()["nativeSessionId"],binding["nativeSessionId"]);
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
        ("background-tasks.mjs",include_str!("../capability-plugins/codex/background-tasks.mjs")),
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
        let page=serde_json::to_value(crate::session_history::read(&db,"w".into(),session.id.clone(),None).await.unwrap()).unwrap();
        let display=page["items"].as_array().unwrap().iter().find(|item|item["role"]=="user").unwrap();
        assert_eq!(display["content"],"继续执行当前目标");
        assert_eq!(display["localizedContent"]["key"],"native.goal.resumePrompt");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&display["localizedContent"]),"Continue working on the current goal.");
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
    let prompt_count=if mode=="hold" {2}else{1};
    let prompts:Vec<(String,String,String)>=sqlx::query_as("SELECT content,localized_content_json,turn_id FROM messages WHERE session_id=? AND role='user'").bind(&session.id).fetch_all(&db).await.unwrap();
    assert_eq!(prompts.len(),prompt_count);
    for (content,metadata,turn) in prompts {
        assert_eq!(content,"继续执行当前目标");
        let descriptor:Value=serde_json::from_str(&metadata).unwrap();
        assert_eq!(descriptor["key"],"native.goal.resumePrompt");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&descriptor),"Continue working on the current goal.");
        let input:String=sqlx::query_scalar("SELECT input_text FROM turns WHERE id=?").bind(turn).fetch_one(&db).await.unwrap();assert_eq!(input,content);
    }
    // An ordinary user can submit exactly the same words; it gets no host marker.
    let approved=crate::workspace_write_runs::Request::with_confirmation("literal-goal-input".into(),"main".into(),|_|async{Ok(true)});
    host.send_from("main",&session.id,"继续执行当前目标",Some(approved)).await.unwrap();
    wait_for_turn(&host,&session.id).await;
    let ordinary:(String,String,Option<String>)=sqlx::query_as("SELECT id,content,localized_content_json FROM messages WHERE session_id=? AND role='user' AND localized_content_json IS NULL").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(ordinary.1,"继续执行当前目标");assert!(ordinary.2.is_none());
    let calls:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    broker.stop_session(&session.id).await.unwrap();
    broker.stop_installation(&installed.id).await.unwrap();
    db.close().await;
    let reopened=crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
    let page=serde_json::to_value(crate::session_history::read(&reopened,"w".into(),session.id.clone(),None).await.unwrap()).unwrap();
    let items=page["items"].as_array().unwrap();
    assert_eq!(items.iter().filter(|item|item["localizedContent"]["key"]=="native.goal.resumePrompt").count(),prompt_count);
    let raw=items.iter().find(|item|item["id"]==ordinary.0).unwrap();assert_eq!(raw["content"],ordinary.1);assert!(raw.get("localizedContent").is_none());
    let after:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&reopened).await.unwrap();assert_eq!(after,calls);
    reopened.close().await;
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
        ("background-tasks.mjs",include_str!("../capability-plugins/codex/background-tasks.mjs")),
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
    assert_eq!(branch.label,format!("{} · 分支",crate::session_by_id(&db,&source.id).await.unwrap().label));
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
async fn queue_validation_translates_without_claiming_messages_or_dispatching() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    broker.stop_session(&session.id).await.unwrap();
    sqlx::query("INSERT INTO session_queues(session_id,paused) VALUES(?,1)").bind(&session.id).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO queued_messages(id,session_id,caller,text,status,created_at) VALUES('sending',?,'main','用户原文 {message}','sending','now')").bind(&session.id).execute(&db).await.unwrap();
    let before:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    for (input,key,diagnostic,english) in [
        (json!({}),"actionRequired","invalid_input: queue action required","Choose a queue action."),
        (json!({"action":4}),"actionRequired","invalid_input: queue action required","Choose a queue action."),
        (json!({"action":"followUp"}),"messageRequired","invalid_input: message required","Provide a message to add to the queue."),
        (json!({"action":"remove"}),"idRequired","invalid_input: message id required","Choose a queued message."),
        (json!({"action":"sendNow"}),"idRequired","invalid_input: message id required","Choose a queued message."),
        (json!({"action":"未知操作 {action}"}),"unknownAction","invalid_input: unknown queue action","This queue action is not supported."),
        (json!({"action":"sendNow","id":"missing"}),"missing","invalid_input: queued message no longer exists","This queued message no longer exists."),
        (json!({"action":"sendNow","id":"sending"}),"sending","busy: message is already being sent","This message is already being sent."),
    ] {
        let error=host.invoke_capability_display_from("main",&session.id,"queue.manage",input).await.unwrap_err();
        assert_eq!(error.diagnostic,diagnostic);
        assert_eq!(error.display()["key"],format!("native.queue.{key}"));
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),english);
        let serialized=serde_json::to_value(error).unwrap();assert_eq!(serialized["message"],diagnostic);
        let item:(String,String)=sqlx::query_as("SELECT text,status FROM queued_messages WHERE id='sending'").fetch_one(&db).await.unwrap();
        assert_eq!(item,("用户原文 {message}".into(),"sending".into()));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM queued_messages").fetch_one(&db).await.unwrap(),1);
    }
    for index in 1..100 {
        sqlx::query("INSERT INTO queued_messages(id,session_id,caller,text,created_at) VALUES(?,?,'main','普通排队原文','now')").bind(format!("item-{index}")).bind(&session.id).execute(&db).await.unwrap();
    }
    let error=host.enqueue_admitted("main",&session.id,"新草稿原文").await.unwrap_err();
    assert_eq!(error.diagnostic,"invalid_input: queue is full (100 messages)");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"The queue is full (100 messages). Remove a message before adding another.");
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM queued_messages").fetch_one(&db).await.unwrap(),100);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap(),before);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM turns").fetch_one(&db).await.unwrap(),0);
    host.invoke_capability_display_from("main",&session.id,"queue.manage",json!({"action":"remove","id":"item-1"})).await.unwrap();
    let id=host.enqueue_admitted("main",&session.id,"新草稿原文").await.unwrap();
    let snapshot=queue_state(&host,&session.id).await;
    assert_eq!(snapshot["paused"],true);
    assert_eq!(snapshot["items"].as_array().unwrap().len(),100);
    assert_eq!(snapshot["items"].as_array().unwrap().iter().find(|item|item["id"]==id).unwrap()["text"],"新草稿原文");
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
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
        let error=host.invoke_capability_display_from("main", &session.id, "queue.manage", input).await.unwrap_err();
        assert_eq!(error.diagnostic,"capability_unsupported: queue.steer");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"This session does not support queue.steer.");
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
    // A settled turn without acknowledgement must preserve unknown delivery.
    let turn_id: String = sqlx::query_scalar("SELECT id FROM turns WHERE session_id=? ORDER BY started_at LIMIT 1").bind(&session.id).fetch_one(&db).await.unwrap();
    sqlx::query("UPDATE queued_messages SET status='sending',turn_id=? WHERE session_id=?").bind(&turn_id).bind(&session.id).execute(&db).await.unwrap();
    host.settle_queue_turn(&session.id, &turn_id, true).await.unwrap();
    let unacknowledged = queue_state(&host, &session.id).await;
    assert_eq!(unacknowledged["items"][0]["status"], "uncertain");
    assert_eq!(unacknowledged["items"][0]["error"], "未收到投递确认，请核对会话记录后处理。");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &unacknowledged["items"][0]["localizedError"]), "No delivery acknowledgement was received. Check the conversation history before taking action.");
    // Simulate a process exit after durable claim but before an acknowledgement.
    sqlx::query("UPDATE queued_messages SET status='sending' WHERE session_id=?").bind(&session.id).execute(&db).await.unwrap();
    broker.stop_session(&session.id).await.unwrap();
    crate::session_recovery::recover(&db).await.unwrap();
    let restored = SessionHost::new(db.clone(), broker.clone());
    let snapshot = queue_state(&restored, &session.id).await;
    assert_eq!(snapshot["items"][0]["id"], before["items"][0]["id"]);
    assert_eq!(snapshot["items"][0]["status"], "uncertain");
    assert_eq!(snapshot["items"][0]["error"], "应用已重启，投递结果未知，请核对会话记录。");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &snapshot["items"][0]["localizedError"]), "The app restarted. Delivery is unknown; check the conversation history.");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &snapshot["items"][0]["localizedError"]), snapshot["items"][0]["error"]);
    let turn_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    for (input, key, diagnostic, english) in [
        (json!({"action":"resume"}), "native.queue.resumeUncertain", "请先核对并移除投递结果未知的消息。", "Check and remove messages with unknown delivery results before resuming."),
        (json!({"action":"sendNow","id":snapshot["items"][0]["id"]}), "native.queue.sendUncertain", "消息投递结果未知，请核对会话记录后删除该条，避免重复发送。", "Delivery is unknown. Check the conversation history and delete this message to avoid sending it twice."),
    ] {
        let legacy = restored.invoke_capability_from("main", &session.id, "queue.manage", input.clone()).await.unwrap_err();
        assert_eq!(legacy, diagnostic);
        let error = restored.invoke_capability_display_from("main", &session.id, "queue.manage", input).await.unwrap_err();
        let payload = serde_json::to_value(&error).unwrap();
        assert_eq!(payload["message"], diagnostic);
        assert_eq!(payload["localized"]["schema"], "aibo.host-message/v1");
        assert_eq!(payload["localized"]["key"], key);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En, &payload["localized"]), english);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn, &payload["localized"]), diagnostic);
        assert_eq!(queue_state(&restored, &session.id).await["items"], snapshot["items"]);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(count, turn_count, "unknown delivery never sends again");
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
async fn changed_clipboard_image_errors_keep_display_metadata_without_dispatch_or_resend() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let image=serde_json::from_value(json!({"mediaType":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII="})).unwrap();
    let attachments=crate::clipboard_images::register(&db,&root.join("data"),&session.id,vec![image]).await.unwrap();
    let context:Value=serde_json::from_str(attachments[0].inline_context.as_deref().unwrap()).unwrap();
    fs::write(context["path"].as_str().unwrap(),"changed image {error}").unwrap();
    let error=host.send_configured_from("main",&session.id,"原始草稿 {error}").await.unwrap_err();
    assert_eq!(error.diagnostic,"图片附件已变化，请重新粘贴。");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"The image attachment changed. Paste it again.");
    let turns:i64=sqlx::query_scalar("SELECT COUNT(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(turns,0);
    let text=format!("原始草稿 {{error}} [attachment:{}]",attachments[0].id);
    host.invoke_capability_from("main",&session.id,"queue.manage",json!({"action":"followUp","message":text})).await.unwrap();
    let snapshot=tokio::time::timeout(Duration::from_secs(5),async {
        loop {let snapshot=queue_state(&host,&session.id).await;if snapshot["items"][0]["status"]=="failed" {break snapshot;}tokio::time::sleep(Duration::from_millis(10)).await;}
    }).await.unwrap();
    assert_eq!(snapshot["items"][0]["error"],error.diagnostic);assert_eq!(snapshot["items"][0]["localizedError"],error.localized.unwrap());assert_eq!(snapshot["items"][0]["text"],text);assert_eq!(snapshot["paused"],true);
    let reopened=SessionHost::new(db.clone(),broker.clone());let restored=queue_state(&reopened,&session.id).await;
    for key in ["items","paused"] {assert_eq!(restored[key],snapshot[key]);}
    assert!(restored["revision"].as_i64().unwrap()>snapshot["revision"].as_i64().unwrap(),"queue snapshots keep their existing monotonic read revisions");
    let turns:i64=sqlx::query_scalar("SELECT COUNT(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();assert_eq!(turns,0);
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn changed_file_queue_errors_persist_without_dispatch_or_consuming_next_draft() {
    for (changed,reason,english) in [("AFTER!","文件内容已变化","The file content changed."),("longer content","文件大小已变化","The file size changed.")] {
        let (root,db,broker,host,session)=concurrent_session_fixture().await;
        let workspace=crate::workspace_by_id(&db,&session.workspace_id).await.unwrap();
        let file=PathBuf::from(&workspace.path).join("原文{path}.txt");
        let next=PathBuf::from(&workspace.path).join("next.txt");
        fs::write(&file,"before").unwrap();
        // Same byte length isolates the content-hash check from the size check.
        fs::write(&next,"next draft").unwrap();
        let attachments=crate::session_attachments::register_session_attachments(session.id.clone(),vec!["原文{path}.txt".into(),"next.txt".into()],&db).await.unwrap();
        fs::write(&file,changed).unwrap();
        let text=format!("原始草稿 {{error}} [attachment:{}]",attachments[0].id);
        host.invoke_capability_from("main",&session.id,"queue.manage",json!({"action":"followUp","message":text})).await.unwrap();
        let snapshot=tokio::time::timeout(Duration::from_secs(5),async {
            loop {let snapshot=queue_state(&host,&session.id).await;if snapshot["items"][0]["status"]=="failed" {break snapshot;}tokio::time::sleep(Duration::from_millis(10)).await;}
        }).await.unwrap();
        assert_eq!(snapshot["items"][0]["text"],text);
        assert_eq!(snapshot["items"][0]["error"],format!("附件不可用：原文{{path}}.txt: {reason}"));
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&snapshot["items"][0]["localizedError"]),format!("Attachment unavailable: 原文{{path}}.txt: {english}"));
        assert_eq!(snapshot["paused"],true);
        let reopened=SessionHost::new(db.clone(),broker.clone());let restored=queue_state(&reopened,&session.id).await;
        for key in ["items","paused"] {assert_eq!(restored[key],snapshot[key]);}
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM turns WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap(),0);
        let ownership:(Option<String>,Option<String>)=sqlx::query_as("SELECT turn_id,queued_message_id FROM attachments WHERE id=?").bind(&attachments[1].id).fetch_one(&db).await.unwrap();
        assert_eq!(ownership,(None,None));
        assert_eq!(fs::read(&file).unwrap(),changed.as_bytes());assert_eq!(fs::read(&next).unwrap(),b"next draft");
        broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
    }
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
    let before=crate::session_execution_profile(&db,&session.id).await.unwrap().profile;
    let invocations:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    let error=host.resolve_approval_option_display_from("other-window",&session.id,&request_id,"exit-plan-default").await.unwrap_err();
    assert_eq!(error.diagnostic,"permission_denied: invocation belongs to another window");assert_eq!(error.display()["key"],"native.approval.otherWindow");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&error.display()),"此操作属于另一个窗口。");
    let payload=serde_json::to_value(crate::ui_i18n::session_operation_message(error)).unwrap();
    assert_eq!(payload["code"],"session_operation_error");assert_eq!(payload["localized"]["key"],"native.approval.otherWindow");
    sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'").execute(&db).await.unwrap();
    assert!(host.resolve_approval_option_from("main", &session.id, &request_id, "exit-plan-default").await.unwrap_err().contains("workspace_untrusted"));
    let error=host.resolve_approval_option_display_from("main",&session.id,&request_id,"exit-plan-default").await.unwrap_err();
    assert_eq!(error.display()["key"],"native.approval.workspaceTrust");assert!(error.diagnostic.starts_with("workspace_untrusted:"));
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"Trust the workspace before switching this session mode.");
    assert_eq!(crate::session_execution_profile(&db,&session.id).await.unwrap().profile,before);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap(),invocations);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM agent_events WHERE session_id=? AND event_type='session.control_changed'").bind(&session.id).fetch_one(&db).await.unwrap(),0);
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
    let display: String = sqlx::query_scalar("SELECT localized_content_json FROM messages WHERE session_id=? AND role='system'").bind(&session.id).fetch_one(&db).await.unwrap();
    let display: Value = serde_json::from_str(&display).unwrap();
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&display),"Switched to Code after approval");
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&display),record);
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
    let reopened = crate::open_database(&root.join("data/db")).await.unwrap();
    let history = serde_json::to_value(crate::session_history::read(&reopened,"w".into(),session.id.clone(),None).await.unwrap()).unwrap();
    let system: Vec<_> = history["items"].as_array().unwrap().iter().filter(|item|item["role"]=="system").collect();
    assert_eq!(system.len(),2,"reopening neither loses nor duplicates the reset notice");
    for (item,raw) in system.iter().zip(&recorded) {
        assert_eq!(item["content"].as_str().unwrap(),raw);
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&item["localizedContent"]),*raw);
    }
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&system[0]["localizedContent"]),"Cleared the context and switched to Code after approval");
    assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&system[1]["localizedContent"]).starts_with("The session has resumed. Its context was cleared"));
    reopened.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn background_tasks_update_after_parent_completion_and_reject_stale_ownership() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    host.send_from("main", &session.id, "hello", None).await.unwrap();
    wait_for_turn(&host, &session.id).await;
    let (generation,binding):(String,String)=sqlx::query_as("SELECT generation_id,plugin_binding_json FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    let binding:Value=serde_json::from_str(&binding).unwrap();
    let turn:String=sqlx::query_scalar("SELECT id FROM turns WHERE session_id=? LIMIT 1").bind(&session.id).fetch_one(&db).await.unwrap();
    sqlx::query("UPDATE session_bindings SET plugin_capabilities_json=json_insert(plugin_capabilities_json,'$[#]','background-tasks.list') WHERE session_id=?").bind(&session.id).execute(&db).await.unwrap();
    let mut event=json!({"nativeSessionId":binding["nativeSessionId"],"turnId":null,"type":"background-task.updated","correlation":null,"payload":{"id":"job","rootTurnId":turn,"name":"Eval","command":"python eval.py","status":"running","activity":""}});
    for _ in 0..2 { host.project_event(&session.id,"w",&generation,&binding,event.clone(),EventOrigin::Host).await.unwrap(); }
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM agent_events WHERE session_id=? AND event_type='background-task.updated'").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(count,1,"identical observations do not grow history");
    event["payload"]["status"]=json!("failed"); event["payload"]["exitCode"]=json!(2);
    host.project_event(&session.id,"w",&generation,&binding,event.clone(),EventOrigin::Host).await.unwrap();
    let (status,content):(String,String)=sqlx::query_as("SELECT status,content FROM messages WHERE session_id=? AND tool_name='background_task'").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(status,"failed"); assert_eq!(serde_json::from_str::<Value>(&content).unwrap()["exitCode"],2);
    // Rejected events must roll back even the delivery update that precedes later guards.
    sqlx::query("UPDATE turn_delivery SET state='possibly_sent' WHERE turn_id=?").bind(&turn).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES('other-parent',?,'other-native','completed','other input','now')").bind(&session.id).execute(&db).await.unwrap();
    let snapshot = |db: SqlitePool, id: String| async move {
        let history=serde_json::to_value(crate::session_history::read(&db,"w".into(),id.clone(),None).await.unwrap()).unwrap();
        let events:Vec<String>=sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? ORDER BY sequence").bind(&id).fetch_all(&db).await.unwrap();
        let binding:(String,String,String)=sqlx::query_as("SELECT generation_id,plugin_binding_json,plugin_capabilities_json FROM session_bindings WHERE session_id=?").bind(&id).fetch_one(&db).await.unwrap();
        let session:(String,String)=sqlx::query_as("SELECT state,updated_at FROM sessions WHERE id=?").bind(&id).fetch_one(&db).await.unwrap();
        let turns:Vec<(String,String,Option<String>,Option<String>)>=sqlx::query_as("SELECT t.id,t.status,t.completed_at,d.state FROM turns t LEFT JOIN turn_delivery d ON d.turn_id=t.id WHERE t.session_id=? ORDER BY t.id").bind(&id).fetch_all(&db).await.unwrap();
        json!({"history":history,"events":events,"binding":binding,"session":session,"turns":turns})
    };
    let original=snapshot(db.clone(),session.id.clone()).await;
    let mut wrong_binding=event.clone();wrong_binding["nativeSessionId"]=json!("foreign-native");
    let mut foreign_parent=event.clone();foreign_parent["payload"]["rootTurnId"]=json!("foreign");
    let mut changed_parent=event.clone();changed_parent["payload"]["rootTurnId"]=json!("other-parent");
    let inactive=json!({"nativeSessionId":binding["nativeSessionId"],"turnId":turn,"type":"message.completed","correlation":null,"payload":{"text":"provider 原文 {text}"}});
    let forged=json!({"nativeSessionId":binding["nativeSessionId"],"turnId":turn,"type":"session.control_changed","correlation":null,"payload":{"controlId":"code","previousControlId":"plan","label":"Code","cause":"approval","requestId":"r"}});
    for (candidate, candidate_generation, origin, key, diagnostic) in [
        (json!({}),generation.as_str(),EventOrigin::Plugin,"schema","invalid_output: session event schema"),
        (event.clone(),"stale",EventOrigin::Host,"generation","invalid_session: stale session generation"),
        (wrong_binding,generation.as_str(),EventOrigin::Host,"binding","invalid_session: native binding"),
        (foreign_parent,generation.as_str(),EventOrigin::Plugin,"backgroundOwner","invalid_session: background parent turn"),
        (changed_parent,generation.as_str(),EventOrigin::Plugin,"backgroundChanged","invalid_session: background task changed parent"),
        (inactive,generation.as_str(),EventOrigin::Plugin,"inactiveTurn","invalid_session: event for inactive turn"),
        (forged,generation.as_str(),EventOrigin::Plugin,"hostControl","permission_denied: session control changes are committed by the host"),
    ] {
        let error=host.project_event_display(&session.id,"w",candidate_generation,&binding,candidate.clone(),origin).await.unwrap_err();
        assert_eq!(error.diagnostic,diagnostic);
        assert_eq!(error.localized,Some(crate::ui_i18n::display_descriptor(&format!("native.event.{key}"),json!({}))));
        for locale in [crate::ui_i18n::Locale::ZhCn,crate::ui_i18n::Locale::En] {
            let translated=crate::ui_i18n::render(locale,&error.display());
            assert!(!translated.is_empty());assert_ne!(translated,diagnostic);
        }
        assert_eq!(snapshot(db.clone(),session.id.clone()).await,original,"{key} leaves history and binding unchanged");
        assert_eq!(host.project_event(&session.id,"w",candidate_generation,&binding,candidate,origin).await.unwrap_err(),diagnostic,"provider callbacks keep their exact error protocol");
        assert_eq!(snapshot(db.clone(),session.id.clone()).await,original,"legacy {key} also rolls back delivery and projection");
    }
    event["payload"]["status"]=json!("completed");event["payload"]["exitCode"]=json!(0);
    host.project_event_display(&session.id,"w",&generation,&binding,event.clone(),EventOrigin::Plugin).await.unwrap();
    let (status,content):(String,String)=sqlx::query_as("SELECT status,content FROM messages WHERE session_id=? AND tool_name='background_task'").bind(&session.id).fetch_one(&db).await.unwrap();
    assert_eq!(status,"completed");assert_eq!(serde_json::from_str::<Value>(&content).unwrap(),event["payload"],"a valid retry still records provider data literally");
    broker.stop_session(&session.id).await.unwrap(); db.close().await; fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plugin_replacement_confirmation_survives_observational_refresh() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    replacement_history(&db).await;
    // Warm the same metadata read that remains active while management is open.
    host.invoke_capability_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap();
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    host.invoke_capability_from("main",&session.id,"model.select",json!({"action":"list"})).await.unwrap();
    let result=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,true).await;
    let error=result.as_ref().err().map(|error|error.diagnostic.clone());
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
    assert!(result.is_ok(),"unchanged metadata must not invalidate installation confirmation: {error:?}");
}

#[tokio::test]
async fn plugin_replacement_confirmation_rejects_changed_recovery_and_stale_generation() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    replacement_history(&db).await;
    replacement_package(&root,"99.0.0");
    let preview=crate::plugin_replacement::preview(&db,&root.join("package")).await.unwrap();
    let binding=host.saved_binding(&session.id).await.unwrap().unwrap();
    let generation:String=sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    let mut response=Response{instance_id:String::new(),invocation_id:String::new(),installation_id:session.plugin_installation_id.clone().unwrap(),generation_id:"stale".into(),output:json!({"recovery":binding["recovery"]}),negotiated_operations:json!([])};
    assert!(host.save_recovery_display(&session.id,&response).await.unwrap_err().diagnostic.contains("generation changed"));
    assert_eq!(host.saved_binding(&session.id).await.unwrap().unwrap(),binding);
    response.generation_id=generation;
    response.output["recovery"]["data"]["confirmationTest"]=json!("changed");
    host.save_recovery_display(&session.id,&response).await.unwrap();
    assert_eq!(host.saved_binding(&session.id).await.unwrap().unwrap()["recovery"],response.output["recovery"]);
    let error=host.replace_plugin(&root.join("data"),&root.join("package"),Some(&preview.token),false,true).await.err().unwrap();
    assert!(error.diagnostic.contains("请先查看并确认版本替换影响"));
    assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"Review and confirm the version replacement impact first. References or package contents may have changed.");
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn provider_crash_cannot_supply_host_display_metadata() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let binding=host.saved_binding(&session.id).await.unwrap().unwrap();
    let generation:String=sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    let reason="提供者原因 {error}: native.broker.cancelled";
    host.project_event(&session.id,&session.workspace_id,&generation,&binding,
        json!({"nativeSessionId":binding["nativeSessionId"],"turnId":null,"type":"adapter.crashed","correlation":null,
            "payload":{"reason":reason,"providerDetail":"原始数据","localizedReason":crate::ui_i18n::display_descriptor("native.broker.cancelled",json!({}))}}),
        EventOrigin::Plugin).await.unwrap();
    let raw:String=sqlx::query_scalar("SELECT payload_json FROM agent_events WHERE session_id=? AND event_type='adapter.crashed'").bind(&session.id).fetch_one(&db).await.unwrap();
    let event:Value=serde_json::from_str(&raw).unwrap();
    assert_eq!(event["payload"]["reason"],reason);
    assert_eq!(event["payload"]["providerDetail"],"原始数据");
    assert!(event["payload"].get("localizedReason").is_none());
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().state,"idle");
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn configured_turn_permission_errors_keep_display_without_dispatch_or_mutation() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let installation=session.plugin_installation_id.as_ref().unwrap();
    let binding=host.saved_binding(&session.id).await.unwrap();
    let invocations:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    let turns:i64=sqlx::query_scalar("SELECT COUNT(*) FROM turns").fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO composer_drafts(session_id,text,updated_at) VALUES(?,'草稿原文 {error}','now')").bind(&session.id).execute(&db).await.unwrap();
    for (mutation,key,diagnostic,english) in [
        ("trust","native.permissions.workspaceTrust","permission_denied: workspace trust required","Trust the workspace before sending a turn."),
        ("disabled","native.permissions.installationDisabled","provider_unavailable: installation is disabled","The plugin installation is disabled."),
        ("history","native.permissions.historyOnly","history_only","This session contains history only and cannot execute turns."),
    ] {
        match mutation {
            "trust"=>{sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'").execute(&db).await.unwrap();},
            "disabled"=>{sqlx::query("UPDATE plugin_installations SET enabled=0 WHERE id=?").bind(installation).execute(&db).await.unwrap();},
            _=>{sqlx::query("UPDATE sessions SET plugin_installation_id=NULL WHERE id=?").bind(&session.id).execute(&db).await.unwrap();},
        }
        for error in [host.send_configured_from("main",&session.id,"输入原文 {error}").await.unwrap_err(),
            host.invoke_capability_display_from("main",&session.id,"goal.resume",json!({})).await.unwrap_err()] {
            assert_eq!(error.diagnostic,diagnostic);assert_eq!(error.display()["key"],key);
            assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),english);
            assert_ne!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&error.display()),english);
            let core=serde_json::to_value(crate::ui_i18n::session_operation_message(error)).unwrap();
            assert_eq!(core["code"],"session_operation_error");assert_eq!(core["localized"]["key"],key);
        }
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap(),invocations);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM turns").fetch_one(&db).await.unwrap(),turns);
        assert_eq!(host.saved_binding(&session.id).await.unwrap(),binding);
        assert!(host.live.lock().await.get(&session.id).is_none());
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT text FROM composer_drafts WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap(),"草稿原文 {error}");
        sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='w'").execute(&db).await.unwrap();
        sqlx::query("UPDATE plugin_installations SET enabled=1 WHERE id=?").bind(installation).execute(&db).await.unwrap();
        sqlx::query("UPDATE sessions SET plugin_installation_id=? WHERE id=?").bind(installation).bind(&session.id).execute(&db).await.unwrap();
    }
    let missing="missing {id}";
    let error=host.send_configured_from("main",missing,"输入").await.unwrap_err();
    assert_eq!(error.diagnostic,format!("session not found: {missing}"));assert_eq!(error.display()["key"],"native.error.sessionNotFound");
    host.send_configured_from("main",&session.id,"successful retry").await.unwrap();wait_for_turn(&host,&session.id).await;
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().state,"idle");
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM turns").fetch_one(&db).await.unwrap(),turns+1);
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn invalid_profiles_keep_display_and_reject_creation_without_execution() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    let base=crate::session_execution_profile(&db,&session.id).await.unwrap().profile;
    let binding=host.saved_binding(&session.id).await.unwrap();
    let sessions:i64=sqlx::query_scalar("SELECT COUNT(*) FROM sessions").fetch_one(&db).await.unwrap();
    let invocations:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    let old:String=sqlx::query_scalar("SELECT requested_json FROM session_execution_profiles WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
    for field in ["schema","interactionMode","approvalPolicy","approvalReviewer","filesystemPolicy","commandPolicy","networkPolicy"] {
        let value="原始值 /{value}";
        let mut raw=serde_json::to_value(&base.requested).unwrap();raw[field]=json!(value);
        let mut profile=base.clone();profile.requested=serde_json::from_value(raw.clone()).unwrap();
        let diagnostic=if field=="schema" {format!("unsupported execution profile schema: {value}")} else {format!("invalid execution profile {field}: {value}")};
        let key=if field=="schema" {"native.profile.schema"} else {"native.profile.choice"};
        let error=host.prepare_with_profile_display(&session.workspace_id,session.plugin_installation_id.as_ref().unwrap(),&session.agent,Some(profile)).await.unwrap_err();
        assert_eq!(error.diagnostic,diagnostic);assert_eq!(error.display()["key"],key);
        assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&error.display()).contains(value));
        sqlx::query("UPDATE session_execution_profiles SET requested_json=? WHERE session_id=?").bind(raw.to_string()).bind(&session.id).execute(&db).await.unwrap();
        let payload=serde_json::to_value(crate::session_execution_profile(&db,&session.id).await.unwrap_err()).unwrap();
        assert_eq!(payload["code"],"invalid_execution_profile");
        assert_eq!(payload["message"],format!("invalid execution profile: {diagnostic}"));
        assert_eq!(payload["localized"]["key"],"native.error.invalidExecutionProfile");assert_eq!(payload["localized"]["params"]["error"]["key"],key);
        assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,&payload["localized"]).contains(value));
        sqlx::query("UPDATE session_execution_profiles SET requested_json=? WHERE session_id=?").bind(&old).bind(&session.id).execute(&db).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM sessions").fetch_one(&db).await.unwrap(),sessions);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap(),invocations);
        assert_eq!(host.saved_binding(&session.id).await.unwrap(),binding);
    }
    let mut requested=base.requested.clone();requested.filesystem_policy="agent-managed".into();
    let error=execution_profile::resolve_with_backend(execution_profile::EnforcementBackend::CoreProxy,Some(requested),"now".into()).unwrap_err();
    assert_eq!(error.diagnostic,"unsupported: provider-managed permissions require an agent-managed provider");assert_eq!(error.display()["key"],"native.profile.agentManaged");
    assert_eq!(crate::session_execution_profile(&db,&session.id).await.unwrap().profile.requested,base.requested);
    host.send_configured_from("main",&session.id,"valid profile still runs").await.unwrap();wait_for_turn(&host,&session.id).await;
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().state,"idle");
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn saved_profile_parse_errors_preserve_display_and_never_dispatch_or_rewrite_data() {
    let (root,db,broker,host,session)=concurrent_session_fixture().await;
    broker.stop_session(&session.id).await.unwrap();
    let binding=host.saved_binding(&session.id).await.unwrap();
    let profile=crate::session_execution_profile(&db,&session.id).await.unwrap().profile;
    let invocations:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap();
    let turns:i64=sqlx::query_scalar("SELECT COUNT(*) FROM turns").fetch_one(&db).await.unwrap();
    let raw=json!("解析原文 /{error}").to_string();
    for (column,key,prefix) in [
        ("requested_json","native.profile.storedRequested","invalid requested execution profile"),
        ("enforced_json","native.profile.storedEnforced","invalid enforced execution profile"),
        ("unsupported_json","native.profile.storedUnsupported","invalid unsupported capabilities"),
        ("adapter_capabilities_json","native.profile.storedCapabilities","invalid adapter capabilities"),
    ] {
        let old:String=sqlx::query_scalar(&format!("SELECT {column} FROM session_execution_profiles WHERE session_id=?")).bind(&session.id).fetch_one(&db).await.unwrap();
        sqlx::query(&format!("UPDATE session_execution_profiles SET {column}=? WHERE session_id=?")).bind(&raw).bind(&session.id).execute(&db).await.unwrap();
        let core=crate::session_execution_profile(&db,&session.id).await.unwrap_err();
        let payload=serde_json::to_value(&core).unwrap();
        assert_eq!(payload["code"],"invalid_execution_profile");
        let display=&payload["localized"];assert_eq!(display["key"],"native.error.invalidExecutionProfile");
        let reason=&display["params"]["error"];assert_eq!(reason["key"],key);
        let parser=reason["params"]["error"].as_str().unwrap();assert!(parser.contains("解析原文 /{error}"));
        assert_eq!(core.to_string(),format!("invalid execution profile: {prefix}: {parser}"));
        assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,display).ends_with(parser));
        assert!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,display).ends_with(parser));
        for error in [host.resume_from_display("main",&session.id).await.unwrap_err(),host.send_configured_from("main",&session.id,"保留输入").await.unwrap_err()] {
            assert_eq!(error.diagnostic,core.to_string());assert_eq!(error.display(),*display);
        }
        assert_eq!(sqlx::query_scalar::<_,String>(&format!("SELECT {column} FROM session_execution_profiles WHERE session_id=?")).bind(&session.id).fetch_one(&db).await.unwrap(),raw);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap(),invocations);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM turns").fetch_one(&db).await.unwrap(),turns);
        assert_eq!(host.saved_binding(&session.id).await.unwrap(),binding);
        assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().state,"idle");
        sqlx::query(&format!("UPDATE session_execution_profiles SET {column}=? WHERE session_id=?")).bind(&old).bind(&session.id).execute(&db).await.unwrap();
    }
    // A valid database rejects unknown backends; exercise the row decoder without weakening that constraint.
    assert!(sqlx::query("UPDATE session_execution_profiles SET enforcement_backend=? WHERE session_id=?").bind(&raw).bind(&session.id).execute(&db).await.is_err());
    let row=sqlx::query("SELECT session_id,schema_version,requested_json,enforced_json,unsupported_json,adapter_capabilities_json,native_sandbox,resolved_at,? AS enforcement_backend FROM session_execution_profiles WHERE session_id=?").bind(&raw).bind(&session.id).fetch_one(&db).await.unwrap();
    let error=execution_profile::from_row(&row,session.id.clone()).unwrap_err();
    assert_eq!(error.display()["key"],"native.profile.storedBackend");
    assert_eq!(error.diagnostic,format!("invalid enforcement backend: {}",error.display()["params"]["error"].as_str().unwrap()));
    assert_eq!(crate::session_execution_profile(&db,&session.id).await.unwrap().profile,profile);
    host.send_configured_from("main",&session.id,"valid after parse rejection").await.unwrap();wait_for_turn(&host,&session.id).await;
    assert_eq!(crate::session_by_id(&db,&session.id).await.unwrap().state,"idle");
    broker.stop_session(&session.id).await.unwrap();db.close().await;fs::remove_dir_all(root).unwrap();
}
