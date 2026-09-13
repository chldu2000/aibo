use super::*;
use std::fs;

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
    broker.stop_session(&session.id).await.unwrap();
    let host = SessionHost::new(db.clone(), broker.clone());
    host.resume_from("main", &session.id).await.unwrap();
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
    let native_start = "spawn('codex', ['app-server', '--stdio']";
    assert!(engine.contains(native_start));
    fs::write(package.join("engine.mjs"),engine.replace(native_start,"spawn(process.execPath, [new URL('./fake-codex.mjs', import.meta.url).pathname]")).unwrap();
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
    let broker = Broker::new(db.clone());
    let host = SessionHost::new(db.clone(),broker.clone());
    broker.bind(Binding {scope:Scope::Workspace("w".into()),capability:"dev.aibo.codex.thread.list".into(),version:"1.0.0".into(),installation_id:installed.id.clone(),contribution_id:"dev.aibo.codex.catalog".into()}).await.unwrap();
    let catalog = broker.invoke("main",Request {scope:Scope::Workspace("w".into()),capability:"dev.aibo.codex.thread.list".into(),version:"1.0.0".into(),request_id:"catalog".into(),turn_id:None,input:json!({})}).await.unwrap();
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
    host.send_from("main",&source.id,"branch message",None).await.unwrap();
    wait_for_turn(&host,&source.id).await;
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
    broker.stop_session(&source.id).await.unwrap();
    broker.stop_session(&branch.id).await.unwrap();
    broker.stop_installation(&installed.id).await.unwrap();
    db.close().await;
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn capability_session_write_requires_host_confirmation_and_owned_tool_approval() {
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
        let approved = crate::workspace_write_runs::Request::with_confirmation(decision.into(), "main".into(), |_| async { Ok(true) });
        host.send_from("main", &session.id, "core plugin write fixture", Some(approved)).await.unwrap();
        let request_id = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Some(id) = host.pending_tools.lock().await.keys().next().cloned() { break id; }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.expect("tool approval was not requested");
        assert!(!target.exists(), "write must wait for its tool approval");
        assert!(host.resolve_approval_from("other-window", &session.id, &request_id, "accept").await.is_err());
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
    let timeline = host.pi_timeline_from("main", &session.id).await.unwrap();
    assert_eq!(timeline.iter().filter(|item| item.role == "user" && item.content == "boundary message").count(), 1);
    assert!(timeline.iter().any(|item| item.role == "assistant"));
    let stale_control = host.invoke_capability_from("main", &session.id, "queue.manage", json!({"action":"steer","message":"do not replay"})).await.unwrap_err();
    assert!(stale_control.contains("finished accepting interactions"));
    let pending_host = host.clone(); let id = session.id.clone();
    let mut read = tokio::spawn(async move { pending_host.invoke_capability_from("main", &id, "session.snapshot", json!({})).await });
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
    let timeline = host.pi_timeline_from("main", &session.id).await.unwrap();
    assert_eq!(timeline.iter().filter(|item| item.role == "user" && item.content == "boundary message").count(), 1);
    assert!(!timeline.iter().any(|item| item.content == "OTHER_BRANCH"), "a native branch must not include unrelated host history");
    let pending_host = host.clone(); let id = session.id.clone();
    let mut read = tokio::spawn(async move { pending_host.invoke_capability_from("main", &id, "session.snapshot", json!({})).await });
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
