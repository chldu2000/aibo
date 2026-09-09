use crate::{change_set::{capture as capture_workspace, persist as persist_change_set, WorkspaceSnapshot}, execution_profile, plugin_contract::contracts, plugin_registry, plugin_runtime::PluginRuntime, Session};
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Arc, time::Duration};
use tauri::Emitter;
use tokio::sync::Mutex;

const TIMEOUT: Duration = Duration::from_secs(15);
fn event_capability(kind: &str) -> Option<&'static str> {
    match kind {
        "approval.requested" | "approval.resolved" => Some("approval.respond"),
        "user_input.requested" | "user_input.resolved" => Some("user-input.respond"),
        "queue.updated" => Some("queue.manage"),
        "compaction.started" | "compaction.completed" => Some("compaction.run"),
        _ => None,
    }
}
fn negotiated_capabilities(
    plugin_id: &str,
    agent_id: &str,
    declared: &[Value],
    actual: &[Value],
) -> Vec<Value> {
    let mut negotiated = actual.to_vec();
    // Bundled Codex 1.0.0 releases shipped the approval and user-input
    // handlers and declared both capabilities in their manifest, but omitted
    // them from the runtime handshake. Keep already-pinned sessions usable
    // while newer releases report the capabilities correctly.
    if plugin_id == "dev.aibo.codex" && agent_id == "dev.aibo.codex.agent" {
        for capability in ["approval.respond", "user-input.respond"] {
            let capability = json!(capability);
            if declared.contains(&capability) && !negotiated.contains(&capability) {
                negotiated.push(capability);
            }
        }
    }
    negotiated
}
#[derive(Clone)]
pub(crate) struct PluginHost {
    db: SqlitePool,
    runtimes: Arc<Mutex<HashMap<String, PluginRuntime>>>,
    lifecycle: Arc<Mutex<()>>,
    database_writes: Arc<Mutex<()>>,
    turn_baselines: Arc<Mutex<HashMap<String, Option<WorkspaceSnapshot>>>>,
    app: Option<tauri::AppHandle>,
}

impl PluginHost {
    pub fn new(db: SqlitePool) -> Self { Self { db, runtimes: Arc::default(), lifecycle: Arc::default(), database_writes: Arc::default(), turn_baselines: Arc::default(), app: None } }

    pub fn with_app(db: SqlitePool, app: tauri::AppHandle) -> Self {
        Self { app: Some(app), ..Self::new(db) }
    }

    pub async fn create(&self, workspace_id: &str, installation_id: &str, agent_id: &str) -> Result<Session, String> {
        let _guard = self.lifecycle.lock().await;
        let workspace = crate::workspace_by_id(&self.db, workspace_id).await.map_err(|e| e.to_string())?;
        if workspace.trust != "trusted" { return Err("permission_denied: workspace must be trusted".into()); }
        let id = ulid::Ulid::new().to_string();
        let now = crate::now_iso();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES(?,?,?,?,'starting',?,?,?)")
            .bind(&id).bind(workspace_id).bind(agent_id).bind("Plugin session").bind(&now).bind(&now).bind(installation_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        if let Err(error) = self.start(&id, false).await {
            let _ = sqlx::query("UPDATE sessions SET state='failed' WHERE id=?").bind(&id).execute(&self.db).await;
            return Err(error);
        }
        crate::session_by_id(&self.db, &id).await.map_err(|e|e.to_string())
    }

    pub async fn resume(&self, session_id: &str) -> Result<(), String> {
        let _guard = self.lifecycle.lock().await;
        if self.runtimes.lock().await.contains_key(session_id) { return Ok(()); }
        let state: Option<String> = sqlx::query_scalar("SELECT state FROM sessions WHERE id=?")
            .bind(session_id).fetch_optional(&self.db).await.map_err(|e| e.to_string())?;
        if state.as_deref() == Some("closed") { return Err("invalid_session: session is closed".into()); }
        let can_recreate = self.can_recreate_empty_codex_session(session_id).await;
        match self.start(session_id, true).await {
            Ok(()) => Ok(()),
            Err(_error) if can_recreate => {
                // Older bundled Codex releases cannot recover a thread that
                // was created before its first rollout. An empty session has
                // no conversation history to lose, so retry it as a fresh
                // logical thread. Sessions with any turn remain pinned to
                // their binding and surface the real recovery failure.
                self.start(session_id, false).await
            }
            Err(error) => Err(error),
        }
    }

    async fn can_recreate_empty_codex_session(&self, session_id: &str) -> bool {
        let row = sqlx::query(
            "SELECT s.agent, p.plugin_id,
                    EXISTS(SELECT 1 FROM turns t WHERE t.session_id=s.id) AS has_turns
             FROM sessions s
             JOIN plugin_installations p ON p.id=s.plugin_installation_id
             WHERE s.id=?",
        )
        .bind(session_id)
        .fetch_optional(&self.db)
        .await;
        let Ok(Some(row)) = row else { return false; };
        empty_codex_session_recovery_allowed(
            row.get::<String, _>("plugin_id").as_str(),
            row.get::<String, _>("agent").as_str(),
            row.get::<i64, _>("has_turns") != 0,
        )
    }

    async fn start(&self, session_id: &str, resume: bool) -> Result<(), String> {
        let row = sqlx::query("SELECT s.agent,s.workspace_id,s.plugin_installation_id,p.install_path,p.manifest_json,p.package_digest,p.enabled,b.plugin_binding_json FROM sessions s JOIN plugin_installations p ON p.id=s.plugin_installation_id LEFT JOIN session_bindings b ON b.session_id=s.id WHERE s.id=?")
            .bind(session_id).fetch_one(&self.db).await.map_err(|_|"invalid_session: plugin installation missing".to_string())?;
        if row.get::<i64,_>("enabled") == 0 { return Err("permission_denied: plugin is disabled".into()); }
        let workspace_id: String = row.get("workspace_id");
        let workspace = crate::workspace_by_id(&self.db, &workspace_id).await.map_err(|e|e.to_string())?;
        if workspace.trust != "trusted" { return Err("permission_denied: workspace must be trusted".into()); }
        let directory = PathBuf::from(row.get::<String,_>("install_path"));
        let (manifest, _, digest) = plugin_registry::inspect(&directory)?;
        if digest != row.get::<String,_>("package_digest") { return Err("manifest_mismatch: installed package changed".into()); }
        let agent_id: String = row.get("agent");
        let agent = manifest["agents"].as_array().unwrap().iter().find(|agent| agent["agentId"] == agent_id).ok_or("invalid_session: Agent contribution missing")?;
        // v1 minimal host grants no workspace/command/network/credential proxies.
        // Process execution is explicitly enabled by the user, never advertised as a sandbox.
        let requested_permissions = agent["requestedPermissions"].as_array().unwrap();
        if let Some(permission) = requested_permissions.iter().find(|permission|permission["required"] == true && permission["id"] != "workspace.read") {
            return Err(format!("capability_unsupported: required permission '{}' cannot be enforced", permission["id"].as_str().unwrap()));
        }
        let diagnostics = plugin_registry::dependency_diagnostics(&manifest);
        if let Some(missing) = diagnostics.iter().find(|dependency|dependency.required && !dependency.available) {
            return Err(format!("dependency_missing: required {} '{}' is unavailable: {}", missing.kind, missing.name, missing.issue.as_deref().unwrap_or("dependency check failed")));
        }
        let mut args: Vec<String> = manifest["entrypoint"]["args"].as_array().map(|args|args.iter().map(|a|a.as_str().unwrap().to_string()).collect()).unwrap_or_default();
        let entrypoint = directory.join(manifest["entrypoint"]["executable"].as_str().unwrap());
        let command = diagnostics.iter().find(|dependency|dependency.kind == "runtime" && dependency.available)
            .and_then(|dependency|dependency.executable.as_ref()).map(PathBuf::from);
        let executable = if let Some(command) = command { args.insert(0, entrypoint.to_string_lossy().into_owned()); command } else { entrypoint };
        let runtime = PluginRuntime::spawn(&executable, &args, &directory)?;
        let installation_id: String = row.get("plugin_installation_id");
        let data_root = directory.parent().and_then(|plugins|plugins.parent()).ok_or("invalid_request: invalid plugin registry path")?;
        let runtime_data = data_root.join("plugin-state").join(&installation_id).join(session_id);
        std::fs::create_dir_all(&runtime_data).map_err(|_|"invalid_request: plugin runtime data directory")?;
        let runtime_data = runtime_data.canonicalize().map_err(|_|"invalid_request: plugin runtime data directory")?;
        let start_result = async {
            let grants: Vec<Value> = requested_permissions.iter().map(|permission| {
                if permission["id"] == "workspace.read" && permission["required"] == true {
                    json!({"id":"workspace.read","decision":"granted","enforcement":"agent-native","constraints":{"roots":[workspace.path]}})
                } else {
                    json!({"id":permission["id"],"decision":"denied","enforcement":"core-proxy","constraints":{}})
                }
            }).collect();
            let initialized = runtime.request("aibo.initialize", json!({"runtimeInstanceId":ulid::Ulid::new().to_string(),"generationId":runtime.generation_id,
                "host":{"appVersion":"0.1.0","platform":plugin_registry::platform(),"runtimeProtocolVersions":["1.0"],"viewProtocolVersions":["1.0"]},
                "expectedPlugin":{"pluginId":manifest["pluginId"],"pluginVersion":manifest["version"]},"permissionGrants":grants}), TIMEOUT).await?;
            if initialized["pluginId"] != manifest["pluginId"] || initialized["pluginVersion"] != manifest["version"] || initialized["runtimeProtocolVersion"] != "1.0" || initialized["viewProtocolVersion"] != "1.0" {
                return Err("manifest_mismatch: handshake identity or protocol".into());
            }
            let actual = initialized["agents"].as_array().and_then(|agents|agents.iter().find(|a|a["agentId"] == agent_id)).ok_or("manifest_mismatch: handshake Agent")?;
            let actual_caps = actual["capabilities"].as_array().ok_or("invalid_request: handshake capabilities")?;
            let declared = agent["capabilities"].as_array().unwrap();
            if actual_caps.iter().any(|c| !declared.contains(c)) || ["session.create","session.resume","session.close","turn.send","turn.cancel","stream.text","view.standard"].iter().any(|required|!actual_caps.contains(&json!(required))) {
                return Err("capability_unsupported: minimal lifecycle capabilities required".into());
            }
            let negotiated_caps = negotiated_capabilities(
                manifest["pluginId"].as_str().unwrap(),
                &agent_id,
                declared,
                actual_caps,
            );
            let actual_capabilities = negotiated_caps
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<String>>();
            let profile_agent = crate::execution_profile_agent(&agent_id, &actual_capabilities);
            let stored_profile: i64 = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM session_execution_profiles WHERE session_id=?)",
            )
            .bind(session_id)
            .fetch_one(&self.db)
            .await
            .map_err(|error| error.to_string())?;
            let mut execution_profile = if stored_profile == 1 {
                crate::session_execution_profile(&self.db, session_id)
                    .await
                    .map_err(|error| error.to_string())?
                    .profile
            } else {
                execution_profile::resolve(&profile_agent, None, crate::now_iso())?
            };
            execution_profile.adapter_capabilities = actual_capabilities;
            execution_profile.native_sandbox = profile_agent == "codex";
            execution_profile::save_for_session(&self.db, session_id, &execution_profile)
                .await
                .map_err(|error| error.to_string())?;
            let workspace_scope = if requested_permissions.iter().any(|permission|permission["id"] == "workspace.read" && permission["required"] == true) {
                json!({"workspaceId":workspace_id,"trusted":true,"path":workspace.path})
            } else { json!({"workspaceId":workspace_id,"trusted":true}) };
            let mut runtime_profile = serde_json::to_value(&execution_profile.enforced)
                .map_err(|error| error.to_string())?;
            runtime_profile["runtimeDataPath"] = json!(runtime_data);
            let mut params = json!({"agentId":agent_id,"sessionId":session_id,"workspace":workspace_scope,"executionProfile":runtime_profile});
            let previous: Option<String> = row.get("plugin_binding_json");
            if resume {
                let binding: Value = serde_json::from_str(previous.as_deref().ok_or("invalid_recovery_data: binding missing")?).map_err(|_|"invalid_recovery_data")?;
                if !contracts().binding.is_valid(&binding) { return Err("invalid_recovery_data: invalid binding".into()); }
                params["binding"] = binding;
            }
            let result = runtime.request(if resume {"session.resume"} else {"session.create"}, params, TIMEOUT).await?;
            if result["kind"] != "session" || result["agentId"] != agent_id || result["sessionId"] != session_id { return Err("invalid_session: plugin response identity".into()); }
            let now = crate::now_iso();
            let binding = json!({"schema":"aibo.plugin-session-binding/v1","sessionId":session_id,"pluginInstallationId":row.get::<String,_>("plugin_installation_id"),
                "pluginId":manifest["pluginId"],"pluginVersion":manifest["version"],"agentId":agent_id,"nativeSessionId":result["nativeSessionId"],
                "runtimeProtocolVersion":"1.0","recovery":result["recovery"],"createdAt":now,"updatedAt":now});
            if !contracts().binding.is_valid(&binding) { return Err("invalid_recovery_data: invalid session response".into()); }
            let mut tx = self.db.begin().await.map_err(|e|e.to_string())?;
            sqlx::query("INSERT INTO session_bindings(session_id,external_session_id,generation_id,adapter_version,bound_at,plugin_binding_json,plugin_capabilities_json) VALUES(?,?,?,'1.0',?,?,?) ON CONFLICT(session_id) DO UPDATE SET external_session_id=excluded.external_session_id,generation_id=excluded.generation_id,plugin_binding_json=excluded.plugin_binding_json,plugin_capabilities_json=excluded.plugin_capabilities_json,bound_at=excluded.bound_at")
                .bind(session_id).bind(result["nativeSessionId"].as_str()).bind(&runtime.generation_id).bind(&now).bind(binding.to_string()).bind(Value::Array(negotiated_caps).to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("UPDATE sessions SET state='idle',updated_at=? WHERE id=?").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("INSERT INTO process_runs(id,session_id,agent,generation_id,state,started_at,plugin_installation_id,runtime_protocol_version) VALUES(?,?,?,?,'running',?,?,'1.0')")
                .bind(ulid::Ulid::new().to_string()).bind(session_id).bind(&agent_id).bind(&runtime.generation_id).bind(&now).bind(row.get::<String,_>("plugin_installation_id")).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            tx.commit().await.map_err(|e|e.to_string())?;
            Ok::<Value,String>(binding)
        }.await;
        let binding = match start_result { Ok(binding) => binding, Err(error) => { runtime.stop().await; return Err(error); } };
        self.runtimes.lock().await.insert(session_id.into(), runtime.clone());
        let host = self.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            let mut sequence = 0i64;
            let mut notifications = runtime.notifications.lock().await;
            while let Some(message) = notifications.recv().await {
                if let Err(error) = host.project(&session_id, &workspace_id, &runtime.generation_id, &binding, sequence, message).await {
                    tracing::error!(session_id = %session_id, generation_id = %runtime.generation_id, error = %error, "plugin notification projection failed");
                    runtime.stop().await;
                    break;
                }
                sequence += 1;
            }
            let process_state = if runtime.was_stopped() { "exited" } else { "crashed" };
            let _write_guard = host.database_writes.lock().await;
            let mut runtimes = host.runtimes.lock().await;
            if runtimes.get(&session_id).is_some_and(|current|current.generation_id == runtime.generation_id) {
                runtimes.remove(&session_id);
                let _ = sqlx::query("UPDATE sessions SET state='interrupted',updated_at=? WHERE id=? AND state NOT IN ('closed','failed')").bind(crate::now_iso()).bind(&session_id).execute(&host.db).await;
                let _ = sqlx::query("UPDATE turns SET status='interrupted',completed_at=? WHERE session_id=? AND status='running'").bind(crate::now_iso()).bind(&session_id).execute(&host.db).await;
            }
            let _ = sqlx::query("UPDATE process_runs SET state=?,ended_at=? WHERE generation_id=?").bind(process_state).bind(crate::now_iso()).bind(&runtime.generation_id).execute(&host.db).await;
        });
        Ok(())
    }

    pub async fn send(&self, session_id: &str, text: &str) -> Result<(), String> {
        if text.trim().is_empty() || text.len() > 200_000 { return Err("invalid_request: input length".into()); }
        self.resume(session_id).await?;
        let runtime = self.runtimes.lock().await.get(session_id).cloned().ok_or("invalid_session")?;
        let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
        let workspace = crate::workspace_by_id(&self.db, &session.workspace_id).await.map_err(|e|e.to_string())?;
        if workspace.trust != "trusted" { return Err("permission_denied: workspace trust was revoked".into()); }
        let baseline = capture_workspace(Path::new(&workspace.path)).await.ok();
        let attachments: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM attachments WHERE session_id=? AND turn_id IS NULL ORDER BY created_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.db)
        .await
        .map_err(|e| e.to_string())?;
        let turn = ulid::Ulid::new().to_string();
        let user_message_id = ulid::Ulid::new().to_string();
        self.turn_baselines.lock().await.insert(turn.clone(), baseline);
        let now = crate::now_iso();
        {
            let _write_guard = self.database_writes.lock().await;
            let mut tx = self.db.begin().await.map_err(|e|e.to_string())?;
            let changed = sqlx::query("UPDATE sessions SET state='running',updated_at=? WHERE id=? AND state IN ('idle','interrupted')").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            if changed.rows_affected() != 1 { return Err("busy: session has an active turn".into()); }
            sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES(?,?,?,'running',?,?)").bind(&turn).bind(session_id).bind(&turn).bind(text).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES(?,?,?,'user',?,'completed',?,?)")
                .bind(&user_message_id).bind(session_id).bind(&turn).bind(text).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            tx.commit().await.map_err(|e|e.to_string())?;
        }
        if let Err(error) = crate::auto_name_session_from_first_message(
            &self.db,
            session_id,
            &user_message_id,
            text,
        )
        .await
        {
            tracing::warn!(session_id = %session_id, error = %error, "unable to auto-name plugin session");
        }
        let attachment_references: Vec<Value> = attachments
            .iter()
            .map(|attachment_id| json!({"attachmentId": attachment_id}))
            .collect();
        let result = runtime.request("turn.send", json!({"agentId":session.agent,"sessionId":session_id,"turnId":turn,"input":{"text":text,"attachments":attachment_references}}), TIMEOUT).await;
        if let Err(error) = result {
            runtime.stop().await;
            let _write_guard = self.database_writes.lock().await;
            sqlx::query("UPDATE turns SET status='failed',completed_at=? WHERE id=? AND status='running'").bind(crate::now_iso()).bind(&turn).execute(&self.db).await.map_err(|e|e.to_string())?;
            self.turn_baselines.lock().await.remove(&turn);
            return Err(error);
        }
        let _write_guard = self.database_writes.lock().await;
        let mut transaction = self.db.begin().await.map_err(|e| e.to_string())?;
        for attachment_id in attachments {
            sqlx::query("UPDATE attachments SET turn_id=? WHERE id=? AND session_id=? AND turn_id IS NULL")
                .bind(&turn)
                .bind(attachment_id)
                .bind(session_id)
                .execute(&mut *transaction)
                .await
                .map_err(|e| e.to_string())?;
        }
        transaction.commit().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn cancel(&self, session_id: &str) -> Result<(), String> {
        let runtime = self.runtimes.lock().await.get(session_id).cloned();
        let turn: Option<String> = sqlx::query_scalar("SELECT id FROM turns WHERE session_id=? AND status='running' ORDER BY started_at DESC LIMIT 1").bind(session_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?;
        if let (Some(runtime), Some(turn)) = (runtime.as_ref(), turn.as_deref()) {
            let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
            runtime.request("turn.cancel", json!({"agentId":session.agent,"sessionId":session_id,"turnId":turn,"reason":"user"}), TIMEOUT).await?;
        } else if runtime.is_none() {
            // Runtime teardown already interrupts its active turn. A cancel
            // click can race that cleanup, so cancellation must be idempotent
            // instead of replacing the useful failure with "runtime unavailable".
            let now = crate::now_iso();
            let _write_guard = self.database_writes.lock().await;
            let mut tx = self.db.begin().await.map_err(|e|e.to_string())?;
            sqlx::query("UPDATE turns SET status='interrupted',completed_at=? WHERE session_id=? AND status='running'")
                .bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("UPDATE sessions SET state='interrupted',updated_at=? WHERE id=? AND state IN ('running','waiting_approval','waiting_user')")
                .bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            tx.commit().await.map_err(|e|e.to_string())?;
        }
        Ok(())
    }

    pub async fn invoke(&self, session_id: &str, view_id: &str, action_id: &str, input: Value) -> Result<Value, String> {
        if !input.is_object() { return Err("invalid_request: operation input must be an object".into()); }
        self.resume(session_id).await?;
        let runtime = self.runtimes.lock().await.get(session_id).cloned().ok_or("invalid_session: runtime unavailable")?;
        let row = sqlx::query("SELECT s.agent,s.state,b.generation_id,b.plugin_capabilities_json,p.manifest_json,v.generation_id AS view_generation,v.document_json FROM sessions s JOIN session_bindings b ON b.session_id=s.id JOIN plugin_installations p ON p.id=s.plugin_installation_id JOIN plugin_views v ON v.session_id=s.id WHERE s.id=? AND v.view_id=?")
            .bind(session_id).bind(view_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?
            .ok_or("invalid_request: view or plugin session not found")?;
        if row.get::<String,_>("generation_id") != runtime.generation_id || row.get::<String,_>("view_generation") != runtime.generation_id {
            return Err("invalid_session: stale view generation".into());
        }
        if row.get::<String,_>("state") == "running" { return Err("busy: session has an active turn".into()); }
        let document: Value = serde_json::from_str(row.get::<&str,_>("document_json")).map_err(|_|"invalid_request: stored view")?;
        let action = document["actions"].as_array().and_then(|actions|actions.iter().find(|action|action["id"] == action_id))
            .ok_or("invalid_request: undeclared view action")?;
        if action["confirmation"] != "never" { return Err("capability_unsupported: action confirmation is not implemented".into()); }
        let manifest: Value = serde_json::from_str(row.get::<&str,_>("manifest_json")).map_err(|_|"manifest_mismatch")?;
        let agent_id: String = row.get("agent");
        let agent = manifest["agents"].as_array().and_then(|agents|agents.iter().find(|agent|agent["agentId"] == agent_id))
            .ok_or("manifest_mismatch: Agent contribution missing")?;
        if action["operationId"].is_null() {
            let capability = action["capability"].as_str().ok_or("manifest_mismatch: standard action capability")?;
            let declared = agent["capabilities"].as_array().is_some_and(|items|items.contains(&json!(capability)));
            if !declared { return Err("manifest_mismatch: standard action capability is undeclared".into()); }
            let input_validator = jsonschema::options().should_validate_formats(true).build(&action["inputSchema"])
                .map_err(|_|"manifest_mismatch: standard action input schema")?;
            if !input_validator.is_valid(&input) { return Err("invalid_request: standard action input schema validation failed".into()); }
            return self.invoke_capability(session_id, capability, input).await;
        }
        let operation_id = action["operationId"].as_str().ok_or("manifest_mismatch: operation id")?;
        let operation = agent["operations"].as_array().and_then(|operations|operations.iter().find(|operation|operation["id"] == operation_id))
            .ok_or("invalid_request: undeclared operation")?;
        if action["capability"] != operation["capability"] || action["inputSchema"] != operation["inputSchema"] {
            return Err("manifest_mismatch: view action contract differs from operation".into());
        }
        let capabilities: Value = serde_json::from_str(row.get::<&str,_>("plugin_capabilities_json")).map_err(|_|"manifest_mismatch: negotiated capabilities missing")?;
        if !capabilities.as_array().is_some_and(|items|items.contains(&operation["capability"])) {
            return Err("capability_unsupported: operation capability was not negotiated".into());
        }
        let input_validator = jsonschema::options().should_validate_formats(true).build(&operation["inputSchema"])
            .map_err(|_|"manifest_mismatch: operation input schema")?;
        if !input_validator.is_valid(&input) { return Err("invalid_request: operation input schema validation failed".into()); }
        let result = runtime.request("operation.invoke", json!({"agentId":agent_id,"sessionId":session_id,"operationId":operation_id,"input":input}), TIMEOUT).await?;
        if result["kind"] != "operation" || result["operationId"] != operation_id { runtime.stop().await; return Err("manifest_mismatch: operation response identity".into()); }
        let output_validator = jsonschema::options().should_validate_formats(true).build(&operation["outputSchema"])
            .map_err(|_|"manifest_mismatch: operation output schema")?;
        if !output_validator.is_valid(&result["output"]) { runtime.stop().await; return Err("invalid_request: operation output schema validation failed".into()); }
        Ok(result["output"].clone())
    }

    pub async fn invoke_capability(&self, session_id: &str, capability: &str, input: Value) -> Result<Value, String> {
        if !input.is_object() { return Err("invalid_request: operation input must be an object".into()); }
        self.resume(session_id).await?;
        let runtime = self.runtimes.lock().await.get(session_id).cloned().ok_or("invalid_session: runtime unavailable")?;
        let row = sqlx::query("SELECT s.agent,s.state,b.generation_id,b.plugin_capabilities_json,p.manifest_json FROM sessions s JOIN session_bindings b ON b.session_id=s.id JOIN plugin_installations p ON p.id=s.plugin_installation_id WHERE s.id=?")
            .bind(session_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?
            .ok_or("invalid_request: plugin session not found")?;
        if row.get::<String,_>("generation_id") != runtime.generation_id {
            return Err("invalid_session: stale runtime generation".into());
        }
        if row.get::<String,_>("state") == "running" && capability != "queue.manage" { return Err("busy: session has an active turn".into()); }
        let manifest: Value = serde_json::from_str(row.get::<&str,_>("manifest_json")).map_err(|_|"manifest_mismatch")?;
        let agent_id: String = row.get("agent");
        let agent = manifest["agents"].as_array().and_then(|agents|agents.iter().find(|agent|agent["agentId"] == agent_id))
            .ok_or("manifest_mismatch: Agent contribution missing")?;
        let operations: Vec<&Value> = agent["operations"].as_array().into_iter().flatten()
            .filter(|operation| operation["capability"] == capability).collect();
        let operation = match operations.as_slice() {
            [operation] => *operation,
            [] => return Err("capability_unsupported: no operation implements the requested capability".into()),
            _ => return Err("manifest_mismatch: capability must map to exactly one operation".into()),
        };
        let operation_id = operation["id"].as_str().ok_or("manifest_mismatch: operation id")?;
        let capabilities: Value = serde_json::from_str(row.get::<&str,_>("plugin_capabilities_json")).map_err(|_|"manifest_mismatch: negotiated capabilities missing")?;
        if !capabilities.as_array().is_some_and(|items|items.contains(&json!(capability))) {
            return Err("capability_unsupported: operation capability was not negotiated".into());
        }
        let input_validator = jsonschema::options().should_validate_formats(true).build(&operation["inputSchema"])
            .map_err(|_|"manifest_mismatch: operation input schema")?;
        if !input_validator.is_valid(&input) { return Err("invalid_request: operation input schema validation failed".into()); }
        let result = runtime.request("operation.invoke", json!({"agentId":agent_id,"sessionId":session_id,"operationId":operation_id,"input":input}), TIMEOUT).await?;
        if result["kind"] != "operation" || result["operationId"] != operation_id { runtime.stop().await; return Err("manifest_mismatch: operation response identity".into()); }
        let output_validator = jsonschema::options().should_validate_formats(true).build(&operation["outputSchema"])
            .map_err(|_|"manifest_mismatch: operation output schema")?;
        if !output_validator.is_valid(&result["output"]) { runtime.stop().await; return Err("invalid_request: operation output schema validation failed".into()); }
        Ok(result["output"].clone())
    }

    pub async fn close(&self, session_id: &str) -> Result<(), String> {
        let _guard = self.lifecycle.lock().await;
        let mut close_error = None;
        if let Some(runtime) = self.runtimes.lock().await.remove(session_id) {
            let agent: Option<String> = sqlx::query_scalar("SELECT agent FROM sessions WHERE id=?").bind(session_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?;
            if let Some(agent) = agent {
                if let Err(error) = runtime.request("session.close", json!({"agentId":agent,"sessionId":session_id}), TIMEOUT).await { close_error = Some(error); }
            }
            runtime.stop().await;
        }
        let _write_guard = self.database_writes.lock().await;
        sqlx::query("UPDATE session_bindings SET generation_id=NULL WHERE session_id=?").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        sqlx::query("UPDATE turns SET status='interrupted',completed_at=? WHERE session_id=? AND status='running'").bind(crate::now_iso()).bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        sqlx::query("UPDATE sessions SET state='closed',updated_at=? WHERE id=?").bind(crate::now_iso()).bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        match close_error { Some(error) => Err(error), None => Ok(()) }
    }

    pub async fn uninstall(&self, data_dir: &std::path::Path, installation_id: &str) -> Result<(), String> {
        let sessions: Vec<String> = sqlx::query_scalar("SELECT id FROM sessions WHERE plugin_installation_id=? AND state NOT IN ('closed','failed')")
            .bind(installation_id).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
        for session_id in sessions { self.close(&session_id).await?; }
        plugin_registry::uninstall(&self.db, data_dir, installation_id).await
    }

    async fn finalize_turn_changes(&self, workspace_id: &str, session_id: &str, turn_id: &str) -> Result<(), String> {
        let baseline = self.turn_baselines.lock().await.remove(turn_id).flatten();
        let workspace = crate::workspace_by_id(&self.db, workspace_id).await.map_err(|error| error.to_string())?;
        let (result, capture_error) = match capture_workspace(Path::new(&workspace.path)).await {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error)),
        };
        persist_change_set(&self.db, workspace_id, session_id, turn_id, baseline.as_ref(), result.as_ref(), capture_error.as_deref())
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn project(&self, session_id: &str, workspace_id: &str, generation: &str, binding: &Value, sequence: i64, message: Value) -> Result<(), String> {
        if !contracts().runtime.is_valid(&message) { return Err("invalid_request: notification schema".into()); }
        let p = &message["params"];
        if p["sessionId"] != session_id || p["agentId"] != binding["agentId"] { return Err("invalid_session: notification identity".into()); }
        let mut emitted_event = None;
        let _write_guard = self.database_writes.lock().await;
        let mut tx = self.db.begin().await.map_err(|e|e.to_string())?;
        let active: (String, String) = sqlx::query_as("SELECT generation_id,plugin_capabilities_json FROM session_bindings WHERE session_id=?").bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        if active.0 != generation { return Err("invalid_session: old generation".into()); }
        if message["method"] == "view/render" {
            let document = &p["document"];
            if !contracts().view.is_valid(document) { return Err("invalid_request: view schema".into()); }
            let manifest: String = sqlx::query_scalar("SELECT p.manifest_json FROM plugin_installations p JOIN sessions s ON s.plugin_installation_id=p.id WHERE s.id=?")
                .bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
            let manifest: Value = serde_json::from_str(&manifest).map_err(|_|"manifest_mismatch")?;
            if !manifest["agents"].as_array().unwrap().iter().filter(|a|a["agentId"] == binding["agentId"])
                .any(|a|a["views"].as_array().unwrap().iter().any(|v|v["viewId"] == document["viewId"])) { return Err("invalid_request: undeclared view".into()); }
            let mut ids = std::collections::HashSet::new();
            let mut nodes = vec![&document["root"]];
            while let Some(node) = nodes.pop() {
                if !ids.insert(node["id"].as_str().unwrap()) || ids.len() > 4096 { return Err("invalid_request: duplicate or excessive view nodes".into()); }
                if let Some(action_id) = node["props"].get("actionId") {
                    if !document["actions"].as_array().unwrap().iter().any(|action|action["id"] == *action_id) { return Err("invalid_request: undeclared node action".into()); }
                }
                nodes.extend(node["children"].as_array().unwrap());
            }
            let previous: Option<(String, i64)> = sqlx::query_as("SELECT generation_id,revision FROM plugin_views WHERE session_id=? AND view_id=?").bind(session_id).bind(document["viewId"].as_str()).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
            let revision = document["revision"].as_i64().ok_or("invalid_request: revision")?;
            if previous.is_some_and(|(previous_generation, previous_revision)|previous_generation == generation && revision <= previous_revision) { return Err("invalid_request: stale view revision".into()); }
            for action in document["actions"].as_array().unwrap() {
                let agent = manifest["agents"].as_array().unwrap().iter().find(|agent|agent["agentId"] == binding["agentId"])
                    .ok_or("manifest_mismatch: Agent contribution missing")?;
                if let Some(operation_id) = action["operationId"].as_str() {
                    let declared = agent["operations"].as_array().and_then(|operations|operations.iter().find(|operation|operation["id"] == operation_id))
                        .ok_or("invalid_request: view action references undeclared operation")?;
                    if action["capability"] != declared["capability"] || action["inputSchema"] != declared["inputSchema"] { return Err("manifest_mismatch: view action contract".into()); }
                } else if !agent["capabilities"].as_array().is_some_and(|items|items.contains(&action["capability"])) {
                    return Err("manifest_mismatch: standard view action capability".into());
                }
            }
            if !document["resources"].as_array().unwrap().is_empty() { return Err("capability_unsupported: dynamic view resources".into()); }
            sqlx::query("INSERT INTO plugin_views(session_id,view_id,generation_id,revision,document_json) VALUES(?,?,?,?,?) ON CONFLICT(session_id,view_id) DO UPDATE SET generation_id=excluded.generation_id,revision=excluded.revision,document_json=excluded.document_json")
                .bind(session_id).bind(document["viewId"].as_str()).bind(generation).bind(revision).bind(document.to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        } else {
            if p["nativeSessionId"] != binding["nativeSessionId"] { return Err("invalid_session: native binding".into()); }
            let now = crate::now_iso();
            let event_id = ulid::Ulid::new().to_string();
            let event = json!({"schemaVersion":"2.0","eventId":event_id,"generationId":generation,"sequence":sequence,"occurredAt":now,
                "source":{"pluginId":binding["pluginId"],"pluginVersion":binding["pluginVersion"],"agentId":binding["agentId"],"runtimeProtocolVersion":"1.0"},
                "workspaceId":workspace_id,"sessionId":session_id,"nativeSessionId":p["nativeSessionId"],"turnId":p["turnId"],"type":p["type"],"correlation":p["correlation"],"payload":p["payload"],"rawRef":null});
            emitted_event = Some(event.clone());
            let kind = p["type"].as_str().unwrap();
            if !["session.started","session.info_changed","turn.started","message.delta","message.completed","reasoning.updated","reasoning.completed","tool.started","tool.updated","tool.completed","turn.completed","turn.failed","approval.requested","approval.resolved","user_input.requested","user_input.resolved"].contains(&kind) {
                return Err("capability_unsupported: event outside minimal lifecycle".into());
            }
            let negotiated: Value = serde_json::from_str(&active.1).map_err(|_|"manifest_mismatch: negotiated capabilities missing")?;
            if event_capability(kind).is_some_and(|capability|!negotiated.as_array().is_some_and(|items|items.contains(&json!(capability)))) {
                return Err("capability_unsupported: event capability was not negotiated".into());
            }
            let turn_id = p["turnId"].as_str();
            if (kind.starts_with("turn.") || kind.starts_with("message.") || kind.starts_with("reasoning.") || kind.starts_with("tool.")) && turn_id.is_none() { return Err("invalid_session: turn identity required".into()); }
            if kind == "session.info_changed" {
                if turn_id.is_some() { return Err("invalid_session: recovery update cannot belong to a turn".into()); }
                let previous: String = sqlx::query_scalar("SELECT plugin_binding_json FROM session_bindings WHERE session_id=?").bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
                let mut current: Value = serde_json::from_str(&previous).map_err(|_|"invalid_recovery_data")?;
                current["recovery"] = p["payload"]["recovery"].clone();
                current["updatedAt"] = json!(now);
                if !contracts().binding.is_valid(&current) { return Err("invalid_recovery_data: recovery update".into()); }
                sqlx::query("UPDATE session_bindings SET plugin_binding_json=? WHERE session_id=?").bind(current.to_string()).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            }
            if let Some(turn) = turn_id {
                let state: Option<String> = sqlx::query_scalar("SELECT status FROM turns WHERE id=? AND session_id=?").bind(turn).bind(session_id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
                if state.as_deref() != Some("running") { return Err("invalid_session: event for inactive turn".into()); }
                if kind == "message.delta" || kind == "message.completed" {
                    let text = p["payload"][if kind == "message.delta" {"delta"} else {"text"}].as_str().ok_or("invalid_request: message text")?;
                    let item_id = p["payload"]["itemId"].as_str().or_else(||p["correlation"]["itemId"].as_str()).filter(|value|!value.is_empty()).unwrap_or("assistant");
                    let id = format!("{turn}:assistant:{item_id}");
                    if kind == "message.delta" {
                        sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'assistant',?,'streaming',?,?,?) ON CONFLICT(id) DO UPDATE SET content=content || excluded.content,updated_at=excluded.updated_at")
                            .bind(id).bind(session_id).bind(turn).bind(item_id).bind(text).bind(sequence).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    } else {
                        sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'assistant',?,'completed',?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,status='completed',updated_at=excluded.updated_at")
                            .bind(id).bind(session_id).bind(turn).bind(item_id).bind(text).bind(sequence).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    }
                } else if kind.starts_with("reasoning.") {
                    let item_id = p["payload"]["itemId"].as_str().filter(|value| !value.is_empty()).ok_or("invalid_request: reasoning item id")?;
                    let value = p["payload"][if kind == "reasoning.updated" { "delta" } else { "summary" }].as_str();
                    let mut chars = value.unwrap_or_default().chars();
                    let mut content: String = chars.by_ref().take(12_000).collect();
                    if chars.next().is_some() { content.push('…'); }
                    let append = kind == "reasoning.updated";
                    let status = if kind == "reasoning.completed" { "completed" } else { "streaming" };
                    let message_id = format!("{turn}:reasoning:{item_id}");
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'system','reasoning',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=CASE WHEN ?=1 THEN messages.content || excluded.content WHEN excluded.content='' THEN messages.content ELSE excluded.content END,status=excluded.status,updated_at=excluded.updated_at")
                        .bind(message_id).bind(session_id).bind(turn).bind(item_id).bind(content).bind(status).bind(sequence).bind(&now).bind(&now).bind(if append { 1_i64 } else { 0_i64 })
                        .execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind.starts_with("tool.") {
                    let payload = &p["payload"];
                    let item_id = payload["itemId"].as_str().filter(|value| !value.is_empty()).ok_or("invalid_request: tool item id")?;
                    let item_type = payload["itemType"].as_str().filter(|value| !value.is_empty()).ok_or("invalid_request: tool item type")?;
                    let limit = |value: Option<&str>, max: usize| value.map(|text| {
                        let mut chars = text.chars();
                        let result: String = chars.by_ref().take(max).collect();
                        if chars.next().is_some() { format!("{result}…") } else { result }
                    });
                    let is_command = item_type.to_ascii_lowercase().contains("command");
                    let protect = |value: Option<String>| value.map(|text| if is_command { crate::artifact::sanitize_content("codex.command", &text) } else { text });
                    let summary = protect(limit(payload["summary"].as_str(), 12_000)).unwrap_or_else(|| item_type.to_owned());
                    let delta = protect(limit(payload["delta"].as_str(), 4_000));
                    let output = protect(limit(payload["output"].as_str(), 12_000));
                    let command = protect(limit(payload["command"].as_str(), 4_000));
                    let cwd = limit(payload["cwd"].as_str(), 4_000);
                    let exit_code = payload["exitCode"].as_i64();
                    let raw_status = payload["status"].as_str().unwrap_or_default().to_ascii_lowercase();
                    let status = if ["failed", "error", "declined", "cancelled", "canceled"].contains(&raw_status.as_str()) { "failed" }
                        else if kind == "tool.completed" { "completed" } else { "streaming" };
                    let content = output.as_deref().or(delta.as_deref()).unwrap_or(&summary);
                    let append = kind == "tool.updated" && delta.is_some() && output.is_none();
                    let message_id = format!("{turn}:tool:{item_id}");
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,tool_command,tool_cwd,tool_exit_code,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'tool',?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=CASE WHEN ?=1 THEN messages.content || excluded.content ELSE excluded.content END,tool_name=excluded.tool_name,tool_command=COALESCE(excluded.tool_command,messages.tool_command),tool_cwd=COALESCE(excluded.tool_cwd,messages.tool_cwd),tool_exit_code=COALESCE(excluded.tool_exit_code,messages.tool_exit_code),status=excluded.status,updated_at=excluded.updated_at")
                        .bind(message_id).bind(session_id).bind(turn).bind(item_id).bind(item_type).bind(command).bind(cwd).bind(exit_code).bind(content).bind(status).bind(sequence).bind(&now).bind(&now).bind(if append { 1_i64 } else { 0_i64 })
                        .execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "approval.requested" || kind == "user_input.requested" {
                    let request_id = p["payload"]["requestId"].as_str().ok_or("invalid_request: request id")?;
                    if request_id.is_empty() { return Err("invalid_request: request id".into()); }
                    let waiting = if kind == "approval.requested" { "waiting_approval" } else { "waiting_user" };
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?").bind(waiting).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "approval.resolved" || kind == "user_input.resolved" {
                    sqlx::query("UPDATE sessions SET state='running',updated_at=? WHERE id=?").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "turn.completed" || kind == "turn.failed" {
                    let status = if kind == "turn.failed" { "failed" } else { p["payload"]["status"].as_str().ok_or("invalid_request: terminal status")? };
                    if !["completed","interrupted","failed"].contains(&status) { return Err("invalid_request: terminal status".into()); }
                    sqlx::query("UPDATE turns SET status=?,completed_at=? WHERE id=? AND status='running'").bind(status).bind(&now).bind(turn).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    let session_state = match status {
                        "completed" => "idle",
                        "interrupted" => "interrupted",
                        "failed" => "failed",
                        _ => return Err("invalid_request: terminal status".into()),
                    };
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?").bind(session_state).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                }
            }
            sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,turn_id,payload_json,schema_version) VALUES(?,?,?,?,?,?,?,?,'2.0')")
                .bind(event_id).bind(session_id).bind(generation).bind(sequence).bind(now).bind(kind).bind(turn_id).bind(event.to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        tx.commit().await.map_err(|e|e.to_string())?;
        if let (Some(app), Some(event)) = (&self.app, emitted_event) {
            let _ = app.emit("agent-event", event);
        }
        if matches!(p["type"].as_str(), Some("turn.completed" | "turn.failed")) {
            if let Some(turn_id) = p["turnId"].as_str() {
                self.finalize_turn_changes(workspace_id, session_id, turn_id).await?;
            }
        }
        Ok(())
    }
}

fn empty_codex_session_recovery_allowed(plugin_id: &str, agent_id: &str, has_turns: bool) -> bool {
    plugin_id == "dev.aibo.codex" && agent_id == "dev.aibo.codex.agent" && !has_turns
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn maps_interactive_events_to_negotiated_capabilities() {
        assert_eq!(event_capability("approval.requested"), Some("approval.respond"));
        assert_eq!(event_capability("user_input.resolved"), Some("user-input.respond"));
        assert_eq!(event_capability("message.delta"), None);
    }

    #[test]
    fn restores_interactive_capabilities_for_pinned_bundled_codex_releases() {
        let declared = vec![json!("turn.send"), json!("approval.respond"), json!("user-input.respond")];
        let actual = vec![json!("turn.send")];
        let bundled = negotiated_capabilities(
            "dev.aibo.codex",
            "dev.aibo.codex.agent",
            &declared,
            &actual,
        );
        assert!(bundled.contains(&json!("approval.respond")));
        assert!(bundled.contains(&json!("user-input.respond")));
        assert_eq!(
            negotiated_capabilities("dev.example.plugin", "dev.example.agent", &declared, &actual),
            actual,
        );
    }

    #[test]
    fn only_empty_bundled_codex_sessions_can_be_recreated() {
        assert!(empty_codex_session_recovery_allowed("dev.aibo.codex", "dev.aibo.codex.agent", false));
        assert!(!empty_codex_session_recovery_allowed("dev.aibo.codex", "dev.aibo.codex.agent", true));
        assert!(!empty_codex_session_recovery_allowed("dev.aibo.other", "dev.aibo.codex.agent", false));
        assert!(!empty_codex_session_recovery_allowed("dev.aibo.codex", "dev.aibo.other.agent", false));
    }

    async fn wait_turn(db: &SqlitePool, session: &str, status: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let actual: Option<String> = sqlx::query_scalar("SELECT status FROM turns WHERE session_id=? ORDER BY started_at DESC LIMIT 1")
                    .bind(session).fetch_optional(db).await.unwrap();
                if actual.as_deref() == Some(status) { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap_or_else(|_| panic!("turn must reach expected terminal state"));
    }

    async fn wait_session_state(db: &SqlitePool, session: &str, state: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let actual: Option<String> = sqlx::query_scalar("SELECT state FROM sessions WHERE id=?")
                    .bind(session).fetch_optional(db).await.unwrap();
                if actual.as_deref() == Some(state) { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("session must reach expected state");
    }

    #[tokio::test]
    async fn installs_external_package_streams_cancels_and_restores_persisted_session() {
        let root = std::env::temp_dir().join(format!("aibo-plugin-host-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let package = root.join("external-package");
        fs::create_dir(&package).unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
        fs::write(package.join("echo-agent.mjs"), include_str!("../../fixtures/plugins/echo-agent/echo-agent.mjs")).unwrap();
        manifest["entrypoint"] = json!({"executable":"echo-agent.mjs"});
        manifest["platforms"] = json!([plugin_registry::platform()]);
        manifest["dependencies"] = json!([{"kind":"runtime","name":"node","versionRange":">=22","required":true}]);
        manifest["resources"] = json!([]);
        manifest["agents"][0]["requestedPermissions"] = json!([]);
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
        let data = root.join("data");
        let db = crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('test',?,'test',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        let installation = plugin_registry::install(&db, &data, &package).await.unwrap();
        assert!(!installation.enabled);
        assert!(installation.runnable);
        assert!(installation.dependencies[0].available);
        assert!(plugin_registry::install(&db, &data, &package).await.is_err(), "duplicate install must roll back");
        assert_eq!(plugin_registry::list(&db).await.unwrap().len(), 1);
        let host = PluginHost::new(db.clone());
        assert!(host.create("test", &installation.id, "dev.aibo.echo.agent").await.unwrap_err().contains("disabled"));
        plugin_registry::enable(&db, &installation.id, true).await.unwrap();
        let session = host.create("test", &installation.id, "dev.aibo.echo.agent").await.unwrap();
        sqlx::query("INSERT INTO attachments(id,workspace_id,session_id,turn_id,path,content_hash,size,media_type,source,send_strategy,created_at) VALUES('attachment-1','test',?,NULL,'notes.md',NULL,5,'text/markdown','manual','reference',?)")
            .bind(&session.id)
            .bind(crate::now_iso())
            .execute(&db)
            .await
            .unwrap();
        host.send(&session.id, "hello 你好 🌍\u{2028}plugin").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        let label: String = sqlx::query_scalar("SELECT label FROM sessions WHERE id=?")
            .bind(&session.id)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(label, "hello 你好 🌍 plugin");
        let change_sets: i64 = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turn_change_sets WHERE session_id=?")
                    .bind(&session.id).fetch_one(&db).await.unwrap();
                if count > 0 { break count; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert_eq!(change_sets, 1, "plugin turns receive Core change-set projection");
        let attachment_turn: Option<String> = sqlx::query_scalar("SELECT turn_id FROM attachments WHERE id='attachment-1'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(attachment_turn.is_some(), "accepted plugin turns bind their attachment references");
        let state: String = sqlx::query_scalar("SELECT state FROM sessions WHERE id=?").bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(state, "idle");
        let text: String = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND role='assistant'").bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(text, "hello 你好 🌍\u{2028}plugin");
        let views: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plugin_views WHERE session_id=?").bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(views, 1);
        let invoked = host.invoke(&session.id, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"})).await.unwrap();
        assert_eq!(invoked, json!({"cursor":1}));
        let commands = host.invoke(&session.id, "dev.aibo.echo.tasks", "commands", json!({})).await.unwrap();
        assert_eq!(commands, json!({"commands":[]}));
        let invoked = host.invoke_capability(&session.id, "ext.dev.aibo.echo.refresh", json!({"label":"semantic"})).await.unwrap();
        assert_eq!(invoked, json!({"cursor":1}));
        assert!(host.invoke_capability(&session.id, "goal.manage", json!({})).await.unwrap_err().contains("no operation"));
        assert!(host.invoke(&session.id, "dev.aibo.echo.tasks", "refresh", json!({})).await.unwrap_err().contains("input schema"));
        assert!(host.invoke(&session.id, "dev.aibo.echo.tasks", "missing", json!({})).await.unwrap_err().contains("undeclared view action"));
        host.send(&session.id, "reasoning fixture").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        let reasoning: (String, String) = sqlx::query_as("SELECT content,status FROM messages WHERE session_id=? AND role='system' AND tool_name='reasoning'")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(reasoning, ("Checking the fixture.".into(), "completed".into()));
        let version: String = sqlx::query_scalar("SELECT schema_version FROM agent_events WHERE session_id=? LIMIT 1").bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(version, "2.0");
        host.send(&session.id, &"cancel me ".repeat(100)).await.unwrap();
        host.cancel(&session.id).await.unwrap();
        wait_turn(&db, &session.id, "interrupted").await;
        wait_session_state(&db, &session.id, "interrupted").await;

        // App restart drops the runtime without closing the Aibo session. The
        // next host must resume the pinned binding and preserve history.
        let runtime = host.runtimes.lock().await.remove(&session.id).expect("active runtime");
        runtime.stop().await;
        let process_state: String = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let state: Option<String> = sqlx::query_scalar("SELECT state FROM process_runs WHERE generation_id=?")
                    .bind(&runtime.generation_id).fetch_optional(&db).await.unwrap();
                if state.as_deref() == Some("exited") || state.as_deref() == Some("crashed") { break state.unwrap(); }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert_eq!(process_state, "exited");
        let restarted = PluginHost::new(db.clone());
        restarted.resume(&session.id).await.unwrap();
        restarted.send(&session.id, "after restart").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        wait_session_state(&db, &session.id, "idle").await;
        restarted.close(&session.id).await.unwrap();
        assert!(restarted.resume(&session.id).await.unwrap_err().contains("session is closed"));
        restarted.uninstall(&data, &installation.id).await.unwrap();
        let removed = plugin_registry::list(&db).await.unwrap();
        assert_eq!(removed.len(), 1);
        assert!(!removed[0].installed);
        assert!(!removed[0].enabled);
        let historical_messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id=?")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert!(historical_messages >= 3, "uninstall must preserve projected history");
        let reinstalled = plugin_registry::install(&db, &data, &package).await.unwrap();
        assert_eq!(reinstalled.id, installation.id, "reinstalling the same release revives its stable record");
        assert!(reinstalled.installed);
        assert!(!reinstalled.enabled);
        tokio::time::sleep(Duration::from_millis(100)).await;
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn crashed_plugin_marks_generation_crashed_and_session_interrupted() {
        let root = std::env::temp_dir().join(format!("aibo-plugin-crash-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let package = root.join("external-package");
        fs::create_dir(&package).unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
        let executable = if cfg!(windows) { "node.exe" } else { "node" };
        fs::copy(crate::find_executable("node").expect("Node test prerequisite"), package.join(executable)).unwrap();
        fs::write(package.join("crash-agent.mjs"), include_str!("../../fixtures/plugins/echo-agent/crash-agent.mjs")).unwrap();
        manifest["entrypoint"] = json!({"executable":executable,"args":["crash-agent.mjs"]});
        manifest["platforms"] = json!([plugin_registry::platform()]);
        manifest["dependencies"] = json!([]);
        manifest["resources"] = json!([]);
        manifest["agents"][0]["requestedPermissions"] = json!([]);
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();

        let data = root.join("data");
        let db = crate::open_database(&data.join("aibo.sqlite3")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('test',?,'test',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        let installation = plugin_registry::install(&db, &data, &package).await.unwrap();
        plugin_registry::enable(&db, &installation.id, true).await.unwrap();
        let host = PluginHost::new(db.clone());
        let session = host.create("test", &installation.id, "dev.aibo.echo.agent").await.unwrap();
        host.send(&session.id, "crash now").await.unwrap();
        wait_session_state(&db, &session.id, "interrupted").await;
        let process_state: String = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let state: Option<String> = sqlx::query_scalar("SELECT state FROM process_runs WHERE session_id=? ORDER BY started_at DESC LIMIT 1")
                    .bind(&session.id).fetch_optional(&db).await.unwrap();
                if state.as_deref() == Some("crashed") { break state.unwrap(); }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert_eq!(process_state, "crashed");
        let turn_state: String = sqlx::query_scalar("SELECT status FROM turns WHERE session_id=? ORDER BY started_at DESC LIMIT 1")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(turn_state, "interrupted");
        host.cancel(&session.id).await.expect("cancel remains idempotent after runtime teardown");
        host.close(&session.id).await.unwrap();
        db.close().await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        fs::remove_dir_all(root).unwrap();
    }
}
