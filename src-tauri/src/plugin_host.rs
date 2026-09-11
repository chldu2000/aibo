mod compatibility;
use compatibility::{negotiated_capabilities, apply_pi_recovery_profile, empty_codex_session_recovery_allowed};
use crate::{artifact::sanitize_content, change_set::{capture as capture_workspace, persist as persist_change_set, WorkspaceSnapshot}, execution_profile, plugin_contract::contracts, plugin_registry, plugin_runtime::PluginRuntime, workspace_guard::canonicalize_target, Session};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use regex::RegexBuilder;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Arc, time::Duration};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, Semaphore};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_COMMAND_BYTES: usize = 16 * 1024;
const MAX_READ_BYTES: u64 = 512 * 1024;

fn wildcard_regex(pattern: &str, case_insensitive: bool) -> Result<regex::Regex, String> {
    let mut expression = String::from("^");
    let characters = pattern.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == '*' && characters.get(index + 1) == Some(&'*') && characters.get(index + 2) == Some(&'/') {
            expression.push_str("(?:.*/)?");
            index += 3;
            continue;
        }
        match character {
            '*' => expression.push_str(".*"),
            '?' => expression.push('.'),
            _ => expression.push_str(&regex::escape(&character.to_string())),
        }
        index += 1;
    }
    expression.push('$');
    RegexBuilder::new(&expression)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|error| format!("invalid glob pattern: {error}"))
}

fn collect_workspace_files(root: &Path, current: &Path, output: &mut Vec<PathBuf>, visited: &mut std::collections::HashSet<PathBuf>) -> Result<(), String> {
    let current = canonicalize_target(root, current)?;
    if current.is_file() {
        output.push(current);
        return Ok(());
    }
    if !current.is_dir() { return Ok(()); }
    if !visited.insert(current.clone()) || output.len() >= 10_000 { return Ok(()); }
    let entries = std::fs::read_dir(&current).map_err(|error| format!("read workspace directory: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read workspace entry: {error}"))?;
        let path = entry.path();
        let Ok(path) = canonicalize_target(root, &path) else { continue; };
        if path.is_dir() {
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
            if name == ".git" || name == "node_modules" { continue; }
            collect_workspace_files(root, &path, output, visited)?;
        } else if path.is_file() {
            output.push(path);
            if output.len() >= 10_000 { break; }
        }
    }
    Ok(())
}

fn workspace_files(root: &Path, current: &Path) -> Result<Vec<PathBuf>, String> {
    let mut output = Vec::new();
    collect_workspace_files(root, current, &mut output, &mut std::collections::HashSet::new())?;
    output.sort();
    Ok(output)
}

fn image_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) { return Some("image/jpeg"); }
    if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10])
        && bytes.get(12..16) == Some(b"IHDR")
    { return Some("image/png"); }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { return Some("image/gif"); }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { return Some("image/webp"); }
    if bytes.starts_with(b"BM") { return Some("image/bmp"); }
    None
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum EventOrigin { Plugin, CoreTool }

fn event_capability_required(kind: &str, origin: EventOrigin) -> Option<&'static str> {
    // Provenance is assigned at the call site, never read from plugin JSON.
    if origin == EventOrigin::CoreTool && matches!(kind, "approval.requested" | "approval.resolved") { None }
    else { event_capability(kind) }
}

fn event_capability(kind: &str) -> Option<&'static str> {
    match kind {
        "approval.requested" | "approval.resolved" => Some("approval.respond"),
        "user_input.requested" | "user_input.resolved" => Some("user-input.respond"),
        "queue.updated" => Some("queue.manage"),
        "compaction.started" | "compaction.completed" => Some("compaction.run"),
        "usage.updated" => Some("ext.dev.aibo.pi.usage"),
        "retry.started" | "retry.completed" => Some("ext.dev.aibo.pi.retry"),
        "extension.updated" => Some("ext.dev.aibo.pi.extension"),
        _ => None,
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ViewVersion {
    generation_id: String,
    revision: u64,
}

#[derive(Clone)]
pub(crate) struct PluginHost {
    db: SqlitePool,
    runtimes: Arc<Mutex<HashMap<String, PluginRuntime>>>,
    lifecycle: Arc<Mutex<()>>,
    database_writes: Arc<Mutex<()>>,
    turn_baselines: Arc<Mutex<HashMap<String, Option<WorkspaceSnapshot>>>>,
    event_sequences: Arc<Mutex<HashMap<String, i64>>>,
    pending_tools: Arc<Mutex<HashMap<String, PendingPluginTool>>>,
    app: Option<tauri::AppHandle>,
    view_action_gate: Arc<Semaphore>,
}

struct PendingPluginTool {
    runtime: PluginRuntime,
    request_id: Value,
    session_id: String,
    workspace_id: String,
    generation_id: String,
    turn_id: Option<String>,
    tool: String,
    input: Value,
}

impl PluginHost {
    pub fn new(db: SqlitePool) -> Self { Self { db, runtimes: Arc::default(), lifecycle: Arc::default(), database_writes: Arc::default(), turn_baselines: Arc::default(), event_sequences: Arc::default(), pending_tools: Arc::default(), app: None, view_action_gate: Arc::new(Semaphore::new(1)) } }

    pub fn with_app(db: SqlitePool, app: tauri::AppHandle) -> Self {
        Self { app: Some(app), ..Self::new(db) }
    }

    pub async fn create(&self, workspace_id: &str, installation_id: &str, agent_id: &str) -> Result<Session, String> {
        self.create_with_profile(workspace_id, installation_id, agent_id, None).await
    }

    pub async fn create_with_profile(
        &self,
        workspace_id: &str,
        installation_id: &str,
        agent_id: &str,
        profile: Option<execution_profile::ResolvedExecutionProfile>,
    ) -> Result<Session, String> {
        let _guard = self.lifecycle.lock().await;
        let workspace = crate::workspace_by_id(&self.db, workspace_id).await.map_err(|e| e.to_string())?;
        if workspace.trust != "trusted" { return Err("permission_denied: workspace must be trusted".into()); }
        let id = ulid::Ulid::new().to_string();
        let now = crate::now_iso();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES(?,?,?,?,'starting',?,?,?)")
            .bind(&id).bind(workspace_id).bind(agent_id).bind("Plugin session").bind(&now).bind(&now).bind(installation_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        if let Some(profile) = profile {
            execution_profile::save_for_session(&self.db, &id, &profile).await.map_err(|error| error.to_string())?;
        }
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
        if crate::plugin_manifest::normalize(&manifest)?.version != 1 {
            return Err("protocol_incompatible: v2 activation is not available".into());
        }
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
        let sdk_module = if manifest["pluginId"] == "dev.aibo.pi" {
            self.pi_sdk_module_path()
        } else {
            None
        };
        let runtime = PluginRuntime::spawn(&executable, &args, &directory, sdk_module.as_deref())?;
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
                manifest["version"].as_str().unwrap_or_default(),
                &agent_id,
                declared,
                actual_caps,
            );
            let actual_capabilities = negotiated_caps
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<String>>();
            let backend = execution_profile::EnforcementBackend::legacy_agent(&agent_id);
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
                execution_profile::resolve_with_backend(backend, None, crate::now_iso())?
            };
            execution_profile.adapter_capabilities = actual_capabilities;
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
                if manifest["pluginId"] == "dev.aibo.pi" && apply_pi_recovery_profile(&mut execution_profile, &binding) {
                    execution_profile::save_for_session(&self.db, session_id, &execution_profile)
                        .await.map_err(|error| error.to_string())?;
                    let mut recovered_runtime_profile = serde_json::to_value(&execution_profile.enforced)
                        .map_err(|error| error.to_string())?;
                    recovered_runtime_profile["runtimeDataPath"] = json!(runtime_data);
                    params["executionProfile"] = recovered_runtime_profile;
                }
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
        let initial_sequence: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sequence), -1) + 1 FROM agent_events WHERE session_id=? AND generation_id=?")
            .bind(session_id)
            .bind(&runtime.generation_id)
            .fetch_one(&self.db)
            .await
            .map_err(|error| error.to_string())?;
        self.event_sequences.lock().await.insert(Self::sequence_key(session_id, &runtime.generation_id), initial_sequence);
        let host = self.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            let mut notifications = runtime.notifications.lock().await;
            while let Some(message) = notifications.recv().await {
                let sequence = host.next_sequence(&session_id, &runtime.generation_id).await;
                if message["method"] == "aibo/tool-request" {
                    if let Err(error) = host.handle_tool_request(&session_id, &workspace_id, &runtime, &binding, sequence, message).await {
                        tracing::error!(session_id = %session_id, generation_id = %runtime.generation_id, error = %error, "plugin Core tool request failed");
                        runtime.stop().await;
                        break;
                    }
                    continue;
                }
                if let Err(error) = host.project(&session_id, &workspace_id, &runtime.generation_id, &binding, sequence, message).await {
                    tracing::error!(session_id = %session_id, generation_id = %runtime.generation_id, error = %error, "plugin notification projection failed");
                    runtime.stop().await;
                    break;
                }
            }
            let pending_count = host
                .cancel_pending_tools_for_generation(
                    &session_id,
                    &workspace_id,
                    &runtime,
                    &binding,
                )
                .await;
            let sequence = host.next_sequence(&session_id, &runtime.generation_id).await;
            let event = json!({"jsonrpc":"2.0","method":"agent/event","params":{
                "agentId":binding["agentId"],"sessionId":session_id,"nativeSessionId":binding["nativeSessionId"],
                "turnId":null,"type":"adapter.crashed","correlation":null,
                "payload":{"reason":if runtime.was_stopped() {"plugin stopped"} else {"plugin crashed"},"pendingApprovalCount":pending_count}
            }});
            let _ = host.project(
                &session_id,
                &workspace_id,
                &runtime.generation_id,
                &binding,
                sequence,
                event,
            ).await;
            host.event_sequences.lock().await.remove(&Self::sequence_key(&session_id, &runtime.generation_id));
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

    fn sequence_key(session_id: &str, generation_id: &str) -> String {
        format!("{session_id}:{generation_id}")
    }

    fn turn_key(session_id: &str, turn_id: &str) -> String {
        format!("{session_id}:{turn_id}")
    }

    fn pi_sdk_module_path(&self) -> Option<PathBuf> {
        let bundled = self
            .app
            .as_ref()
            .and_then(|app| app.path().resource_dir().ok())
            .map(|directory| directory.join("pi-sdk-bundle/index.js"));
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js");
        [bundled, Some(source)]
            .into_iter()
            .flatten()
            .find(|path| path.is_file())
    }

    async fn next_sequence(&self, session_id: &str, generation_id: &str) -> i64 {
        let mut sequences = self.event_sequences.lock().await;
        let key = Self::sequence_key(session_id, generation_id);
        let sequence = sequences.entry(key).or_insert(0);
        let current = *sequence;
        *sequence += 1;
        current
    }

    async fn reply_tool_error(
        runtime: &PluginRuntime,
        request_id: Value,
        error: impl Into<String>,
    ) -> Result<(), String> {
        runtime.reply(request_id, Err(error.into())).await
    }

    async fn handle_tool_request(
        &self,
        session_id: &str,
        workspace_id: &str,
        runtime: &PluginRuntime,
        binding: &Value,
        sequence: i64,
        message: Value,
    ) -> Result<(), String> {
        let request_id = message["id"].clone();
        let params = &message["params"];
        if params["agentId"] != binding["agentId"]
            || params["sessionId"] != session_id
            || params["nativeSessionId"] != binding["nativeSessionId"]
        {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "invalid_session: Core tool identity mismatch",
            )
            .await;
        }
        let Some(tool) = params["tool"].as_str() else {
            return Self::reply_tool_error(runtime, request_id, "invalid_request: Core tool name")
                .await;
        };
        let Some(input) = params["input"].as_object() else {
            return Self::reply_tool_error(runtime, request_id, "invalid_request: Core tool input")
                .await;
        };
        let Some(turn_id) = params["turnId"].as_str() else {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "invalid_session: Core tool turn identity missing",
            )
            .await;
        };
        let active_turn: Option<String> =
            sqlx::query_scalar("SELECT id FROM turns WHERE id=? AND session_id=? AND status='running'")
                .bind(turn_id)
                .bind(session_id)
                .fetch_optional(&self.db)
                .await
                .map_err(|error| error.to_string())?;
        if active_turn.is_none() {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "invalid_session: Core tool turn is not active",
            )
            .await;
        }
        let profile = crate::session_execution_profile(&self.db, session_id)
            .await
            .map_err(|error| error.to_string())?
            .profile
            .enforced;
        let workspace = crate::workspace_by_id(&self.db, workspace_id)
            .await
            .map_err(|error| error.to_string())?;
        if workspace.trust != "trusted" {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "permission_denied: workspace trust was revoked",
            )
            .await;
        }

        let (normalized_input, mut approval_payload, requires_approval) = match tool {
            "read_file" => {
                let Some(path) = input
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|path| !path.trim().is_empty())
                else {
                    return Self::reply_tool_error(runtime, request_id, "invalid_request: Pi read path is missing").await;
                };
                let action = input.get("action").and_then(Value::as_str).unwrap_or("read");
                if !matches!(action, "read" | "access" | "exists" | "is_directory" | "list" | "glob" | "grep" | "image_mime") {
                    return Self::reply_tool_error(runtime, request_id, "invalid_request: unsupported Pi read action").await;
                }
                (
                    json!({"path":path,"action":action,"pattern":input.get("pattern"),"glob":input.get("glob"),"ignoreCase":input.get("ignoreCase"),"literal":input.get("literal"),"context":input.get("context"),"limit":input.get("limit")}),
                    Value::Null,
                    false,
                )
            }
            "write_file" => {
                if profile.interaction_mode != "edit"
                    || profile.filesystem_policy != "workspace-write"
                {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "permission_denied: Pi workspace writes are disabled",
                    )
                    .await;
                }
                let Some(path) = input
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|path| !path.trim().is_empty())
                else {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi write path is missing",
                    )
                    .await;
                };
                let Some(content) = input.get("content").and_then(Value::as_str) else {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi write content is missing",
                    )
                    .await;
                };
                if content.len() > crate::pi::MAX_WRITE_BYTES {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi write content is too large",
                    )
                    .await;
                }
                let resolved =
                    match canonicalize_target(Path::new(&workspace.path), Path::new(path)) {
                        Ok(path) => path,
                        Err(error) => return Self::reply_tool_error(runtime, request_id, error).await,
                    };
                let relative = resolved
                    .strip_prefix(&workspace.path)
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|_| resolved.display().to_string());
                (
                    json!({"path":resolved.to_string_lossy(),"content":content}),
                    json!({"requestId":"","kind":"pi_tool","command":format!("write {relative}"),"cwd":workspace.path,"availableDecisions":["accept","cancel"]}),
                    profile.approval_policy == "on-request",
                )
            }
            "run_command" => {
                if profile.interaction_mode != "edit" || profile.command_policy == "disabled" {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "permission_denied: Pi command execution is disabled",
                    )
                    .await;
                }
                let Some(command) = input
                    .get("command")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|command| !command.is_empty())
                else {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi command is missing",
                    )
                    .await;
                };
                if command.len() > MAX_COMMAND_BYTES {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi command is too long",
                    )
                    .await;
                }
                let raw_cwd = input
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or(&workspace.path);
                let cwd = match canonicalize_target(
                    Path::new(&workspace.path),
                    Path::new(raw_cwd),
                ) {
                    Ok(path) if path.is_dir() => path,
                    Ok(_) => {
                        return Self::reply_tool_error(
                            runtime,
                            request_id,
                            "invalid_request: Pi command cwd is not a directory",
                        )
                        .await;
                    }
                    Err(error) => return Self::reply_tool_error(runtime, request_id, error).await,
                };
                let timeout = input.get("timeout").cloned().unwrap_or(Value::Null);
                (
                    json!({"command":command,"cwd":cwd.to_string_lossy(),"timeout":timeout}),
                    json!({"requestId":"","kind":"pi_command","command":sanitize_content("pi.command", command),"cwd":cwd,"availableDecisions":["accept","cancel"]}),
                    profile.approval_policy == "on-request" || profile.command_policy == "approved",
                )
            }
            _ => {
                return Self::reply_tool_error(
                    runtime,
                    request_id,
                    "unsupported: Core tool is not available",
                )
                .await;
            }
        };

        if !requires_approval {
            let result = self
                .execute_plugin_tool(session_id, workspace_id, tool, &normalized_input)
                .await;
            return runtime.reply(request_id, result).await;
        }

        let request_key = request_id
            .as_str()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| request_id.to_string());
        let approval_id = format!("pi-tool:{request_key}");
        approval_payload["requestId"] = json!(approval_id);
        let pending = PendingPluginTool {
            runtime: runtime.clone(),
            request_id: request_id.clone(),
            session_id: session_id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            generation_id: runtime.generation_id.clone(),
            turn_id: Some(turn_id.to_owned()),
            tool: tool.to_owned(),
            input: normalized_input,
        };
        {
            let mut pending_tools = self.pending_tools.lock().await;
            if pending_tools.contains_key(&approval_id) {
                drop(pending_tools);
                return Self::reply_tool_error(runtime, request_id, "busy: duplicate Core tool request").await;
            }
            pending_tools.insert(approval_id.clone(), pending);
        }
        let event = json!({"jsonrpc":"2.0","method":"agent/event","params":{
            "agentId":binding["agentId"],"sessionId":session_id,"nativeSessionId":binding["nativeSessionId"],"turnId":turn_id,
            "type":"approval.requested","correlation":{"requestId":approval_id},"payload":approval_payload
        }});
        if let Err(error) = self
            .project_event(
                session_id,
                workspace_id,
                &runtime.generation_id,
                binding,
                sequence,
                event,
                EventOrigin::CoreTool,
            )
            .await
        {
            self.pending_tools.lock().await.remove(&approval_id);
            let _ = Self::reply_tool_error(runtime, request_id, error.clone()).await;
            return Err(error);
        }
        Ok(())
    }

    async fn execute_plugin_tool(
        &self,
        session_id: &str,
        workspace_id: &str,
        tool: &str,
        input: &Value,
    ) -> Result<Value, String> {
        let workspace = crate::workspace_by_id(&self.db, workspace_id)
            .await
            .map_err(|error| error.to_string())?;
        if workspace.trust != "trusted" {
            return Err("permission_denied: workspace trust was revoked".into());
        }
        let profile = crate::session_execution_profile(&self.db, session_id)
            .await
            .map_err(|error| error.to_string())?
            .profile
            .enforced;
        match tool {
            "read_file" => {
                let path = input["path"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi read path")?;
                let action = input["action"].as_str().unwrap_or("read");
                let resolved = canonicalize_target(Path::new(&workspace.path), Path::new(path))?;
                match action {
                    "exists" => Ok(json!({"path":resolved,"exists":resolved.exists()})),
                    "access" => {
                        if !resolved.exists() { return Err("invalid_request: Pi read path does not exist".into()); }
                        Ok(json!({"path":resolved,"exists":true}))
                    }
                    "is_directory" => Ok(json!({"path":resolved,"exists":resolved.exists(),"isDirectory":resolved.is_dir()})),
                    "read" => {
                        if !resolved.is_file() { return Err("invalid_request: Pi read target is not a file".into()); }
                        let metadata = tokio::fs::metadata(&resolved).await.map_err(|error| format!("read workspace file metadata: {error}"))?;
                        if metadata.len() > MAX_READ_BYTES { return Err("invalid_request: Pi read file exceeds the Core limit".into()); }
                        let bytes = tokio::fs::read(&resolved).await.map_err(|error| format!("read workspace file: {error}"))?;
                        if let Some(mime_type) = image_mime_type(&bytes) {
                            Ok(json!({"path":resolved,"data":BASE64.encode(&bytes),"encoding":"base64","mimeType":mime_type,"bytes":bytes.len()}))
                        } else {
                            let content = String::from_utf8(bytes).map_err(|_| "invalid_request: binary files are not readable through the text Core tool".to_owned())?;
                            Ok(json!({"path":resolved,"content":content,"bytes":content.len()}))
                        }
                    }
                    "image_mime" => {
                        if !resolved.is_file() { return Err("invalid_request: Pi image target is not a file".into()); }
                        let metadata = tokio::fs::metadata(&resolved).await.map_err(|error| format!("read workspace image metadata: {error}"))?;
                        if metadata.len() > MAX_READ_BYTES { return Err("invalid_request: Pi image exceeds the Core limit".into()); }
                        let bytes = tokio::fs::read(&resolved).await.map_err(|error| format!("read workspace image: {error}"))?;
                        Ok(json!({"path":resolved,"mimeType":image_mime_type(&bytes)}))
                    }
                    "list" => {
                        if !resolved.is_dir() { return Err("invalid_request: Pi list target is not a directory".into()); }
                        let mut entries = std::fs::read_dir(&resolved)
                            .map_err(|error| format!("read workspace directory: {error}"))?
                            .filter_map(Result::ok)
                            .filter_map(|entry| entry.file_name().into_string().ok())
                            .collect::<Vec<_>>();
                        entries.sort_by_key(|entry| entry.to_lowercase());
                        Ok(json!({"path":resolved,"entries":entries}))
                    }
                    "glob" => {
                        let pattern = input["pattern"].as_str().ok_or("invalid_request: Pi find pattern is missing")?;
                        let matcher = wildcard_regex(pattern, false)?;
                        let limit = input["limit"].as_u64().unwrap_or(1000).clamp(1, 10_000) as usize;
                        let files = workspace_files(Path::new(&workspace.path), &resolved)?;
                        let root = resolved.clone();
                        let mut paths = files.into_iter().filter_map(|file| {
                            let relative = file.strip_prefix(&root).ok()?.to_string_lossy().replace('\\', "/");
                            let basename = file.file_name()?.to_string_lossy();
                            if matcher.is_match(&relative) || matcher.is_match(&basename) { Some(file.to_string_lossy().into_owned()) } else { None }
                        }).take(limit).collect::<Vec<_>>();
                        paths.sort();
                        Ok(json!({"path":resolved,"paths":paths}))
                    }
                    "grep" => {
                        let pattern = input["pattern"].as_str().ok_or("invalid_request: Pi grep pattern is missing")?;
                        let literal = input["literal"].as_bool().unwrap_or(false);
                        let case_insensitive = input["ignoreCase"].as_bool().unwrap_or(false);
                        let matcher = if literal {
                            RegexBuilder::new(&format!(".*{}.*", regex::escape(pattern)))
                                .case_insensitive(case_insensitive)
                                .build()
                                .map_err(|error| format!("invalid grep pattern: {error}"))?
                        } else {
                            RegexBuilder::new(pattern).case_insensitive(case_insensitive).build().map_err(|error| format!("invalid grep pattern: {error}"))?
                        };
                        let glob = input["glob"].as_str().map(|value| wildcard_regex(value, false)).transpose()?;
                        let context = input["context"].as_u64().unwrap_or(0).min(20) as usize;
                        let limit = input["limit"].as_u64().unwrap_or(100).clamp(1, 1000) as usize;
                        let files = workspace_files(Path::new(&workspace.path), &resolved)?;
                        let search_root = if resolved.is_dir() { resolved.clone() } else { resolved.parent().unwrap_or(&resolved).to_path_buf() };
                        let mut matches = Vec::new();
                        for file in files {
                            if matches.len() >= limit { break; }
                            let relative = file.strip_prefix(&search_root).unwrap_or(&file).to_string_lossy().replace('\\', "/");
                            let basename = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                            if glob.as_ref().is_some_and(|glob| !glob.is_match(&relative) && !glob.is_match(&basename)) { continue; }
                            let Ok(content) = std::fs::read_to_string(&file) else { continue; };
                            let lines = content.lines().collect::<Vec<_>>();
                            for (index, line) in lines.iter().enumerate() {
                                if matcher.is_match(line) {
                                    let start = index.saturating_sub(context);
                                    let end = (index + context + 1).min(lines.len());
                                    for context_index in start..end {
                                        let marker = if context_index == index { ':' } else { '-' };
                                        matches.push(format!("{}{}{}{} {}", relative, marker, context_index + 1, marker, lines[context_index]));
                                        if matches.len() >= limit { break; }
                                    }
                                }
                                if matches.len() >= limit { break; }
                            }
                        }
                        let content = if matches.is_empty() { "No matches found".to_owned() } else { matches.join("\n") };
                        Ok(json!({"path":resolved,"content":content,"matchCount":matches.len()}))
                    }
                    _ => Err("invalid_request: unsupported Pi read action".into()),
                }
            }
            "write_file" => {
                if profile.interaction_mode != "edit"
                    || profile.filesystem_policy != "workspace-write"
                {
                    return Err("permission_denied: Pi workspace writes are disabled".into());
                }
                let path = input["path"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi write path")?;
                let content = input["content"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi write content")?;
                if content.len() > crate::pi::MAX_WRITE_BYTES {
                    return Err("invalid_request: Pi write content is too large".into());
                }
                let resolved =
                    canonicalize_target(Path::new(&workspace.path), Path::new(path))?;
                if let Some(parent) = resolved.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|error| format!("create write directory: {error}"))?;
                }
                tokio::fs::write(&resolved, content)
                    .await
                    .map_err(|error| format!("write workspace file: {error}"))?;
                Ok(json!({"path":resolved,"bytes":content.len(),"tool":tool}))
            }
            "run_command" => {
                if profile.interaction_mode != "edit" || profile.command_policy == "disabled" {
                    return Err("permission_denied: Pi command execution is disabled".into());
                }
                let command = input["command"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi command")?;
                let cwd = input["cwd"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi command cwd")?;
                let cwd = canonicalize_target(Path::new(&workspace.path), Path::new(cwd))?;
                if !cwd.is_dir() {
                    return Err("invalid_request: Pi command cwd is not a directory".into());
                }
                let timeout = input["timeout"]
                    .as_f64()
                    .filter(|value| value.is_finite() && *value > 0.0)
                    .unwrap_or(120.0)
                    .min(300.0);
                let output = crate::pi::run_shell_command(command, &cwd, timeout)
                    .await
                    .map_err(|error| error.to_string())?;
                let stdout =
                    crate::pi::truncate_command_output(String::from_utf8_lossy(&output.stdout).as_ref());
                let stderr =
                    crate::pi::truncate_command_output(String::from_utf8_lossy(&output.stderr).as_ref());
                let combined = if stderr.is_empty() {
                    stdout.clone()
                } else if stdout.is_empty() {
                    stderr.clone()
                } else {
                    format!("{stdout}\n{stderr}")
                };
                Ok(json!({"command":sanitize_content("pi.command", command),"cwd":cwd,"exitCode":output.status.code(),"stdout":stdout,"stderr":stderr,"output":crate::pi::truncate_command_output(&combined)}))
            }
            _ => Err("unsupported: Core tool is not available".into()),
        }
    }

    /// The v1 pi-tool namespace belongs to Core, regardless of the agent identity.
    /// Expired Core approvals must never fall through to a provider operation.
    pub async fn resolve_approval(&self, session_id: &str, request_id: &str, decision: &str) -> Result<(), String> {
        if request_id.starts_with("pi-tool:") {
            return self.resolve_core_tool_approval(session_id, request_id, decision).await;
        }
        self.invoke_capability(session_id, "approval.respond", json!({"requestId": request_id, "decision": decision})).await?;
        Ok(())
    }

    pub async fn resolve_core_tool_approval(
        &self,
        session_id: &str,
        request_id: &str,
        decision: &str,
    ) -> Result<(), String> {
        if !matches!(decision, "accept" | "cancel") {
            return Err("invalid_request: approval decision must be accept or cancel".into());
        }
        let pending = {
            let mut pending_tools = self.pending_tools.lock().await;
            let pending = pending_tools.get(request_id)
                .ok_or_else(|| "invalid_request: Core tool approval is no longer pending".to_owned())?;
            if pending.session_id != session_id {
                return Err("invalid_session: approval session mismatch".into());
            }
            pending_tools.remove(request_id).expect("pending request checked under lock")
        };
        let binding_json: String =
            sqlx::query_scalar("SELECT plugin_binding_json FROM session_bindings WHERE session_id=?")
                .bind(session_id)
                .fetch_one(&self.db)
                .await
                .map_err(|error| error.to_string())?;
        let binding: Value = serde_json::from_str(&binding_json)
            .map_err(|_| "invalid_recovery_data: invalid plugin binding".to_owned())?;
        let sequence = self.next_sequence(session_id, &pending.generation_id).await;
        let event = json!({"jsonrpc":"2.0","method":"agent/event","params":{
            "agentId":binding["agentId"],"sessionId":session_id,"nativeSessionId":binding["nativeSessionId"],"turnId":pending.turn_id,
            "type":"approval.resolved","correlation":{"requestId":request_id},"payload":{"requestId":request_id,"decision":decision,"tool":pending.tool}
        }});
        if let Err(error) = self
            .project_event(
                session_id,
                &pending.workspace_id,
                &pending.generation_id,
                &binding,
                sequence,
                event,
                EventOrigin::CoreTool,
            )
            .await
        {
            let _ = pending.runtime.reply(pending.request_id, Err(error.clone())).await;
            return Err(error);
        }
        let result = if decision == "accept" {
            self.execute_plugin_tool(&pending.session_id, &pending.workspace_id, &pending.tool, &pending.input)
                .await
        } else {
            Err("permission_denied: Pi tool request was rejected".into())
        };
        pending.runtime.reply(pending.request_id, result).await
    }

    async fn cancel_pending_tools(&self, session_id: &str) {
        let ids = self
            .pending_tools
            .lock()
            .await
            .iter()
            .filter(|(_, request)| request.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.resolve_core_tool_approval(session_id, &id, "cancel").await;
        }
    }

    async fn cancel_pending_tools_for_generation(
        &self,
        session_id: &str,
        workspace_id: &str,
        runtime: &PluginRuntime,
        binding: &Value,
    ) -> usize {
        let pending = {
            let mut requests = self.pending_tools.lock().await;
            let ids = requests
                .iter()
                .filter(|(_, request)| {
                    request.session_id == session_id
                        && request.generation_id == runtime.generation_id
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| requests.remove(&id).map(|request| (id, request)))
                .collect::<Vec<_>>()
        };
        for (request_id, request) in &pending {
            let _ = request
                .runtime
                .reply(
                    request.request_id.clone(),
                    Err("cancelled: plugin generation exited before approval".to_owned()),
                )
                .await;
            let sequence = self.next_sequence(session_id, &runtime.generation_id).await;
            let event = json!({"jsonrpc":"2.0","method":"agent/event","params":{
                "agentId":binding["agentId"],"sessionId":session_id,"nativeSessionId":binding["nativeSessionId"],
                "turnId":request.turn_id,"type":"approval.resolved","correlation":{"requestId":request_id},
                "payload":{"requestId":request_id,"decision":"cancel","tool":request.tool}
            }});
            let _ = self.project(
                session_id,
                workspace_id,
                &runtime.generation_id,
                binding,
                sequence,
                event,
            ).await;
        }
        pending.len()
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
        self.turn_baselines.lock().await.insert(Self::turn_key(session_id, &turn), baseline);
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
            self.turn_baselines.lock().await.remove(&Self::turn_key(session_id, &turn));
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
        self.cancel_pending_tools(session_id).await;
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

    pub async fn view_snapshots(&self, session_id: &str) -> Result<Vec<Value>, String> {
        let rows = sqlx::query("SELECT generation_id,document_json FROM plugin_views WHERE session_id=? ORDER BY view_id")
            .bind(session_id).fetch_all(&self.db).await.map_err(|error| error.to_string())?;
        rows.into_iter().map(|row| {
            let document: Value = serde_json::from_str(row.get::<&str,_>("document_json")).map_err(|_| "invalid_request: stored view")?;
            let revision = document["revision"].as_u64().ok_or("invalid_request: stored view revision")?;
            Ok(json!({"document":document,"version":ViewVersion { generation_id: row.get("generation_id"), revision }}))
        }).collect()
    }

    #[cfg(test)]
    async fn invoke(&self, session_id: &str, view_id: &str, action_id: &str, input: Value) -> Result<Value, String> {
        self.invoke_native(session_id, view_id, action_id, input, None).await
    }

    pub async fn invoke_versioned(&self, session_id: &str, view_id: &str, action_id: &str, input: Value, version: ViewVersion) -> Result<Value, String> {
        self.invoke_native(session_id, view_id, action_id, input, Some(version)).await
    }

    async fn invoke_native(&self, session_id: &str, view_id: &str, action_id: &str, input: Value, version: Option<ViewVersion>) -> Result<Value, String> {
        self.invoke_with_confirmation(session_id, view_id, action_id, input, version, |message| async move {
            let app = self.app.as_ref().ok_or("confirmation_unavailable: desktop host required")?;
            let (send, receive) = tokio::sync::oneshot::channel();
            app.dialog().message(message).title("Aibo · 确认插件操作")
                .buttons(MessageDialogButtons::OkCancelCustom("允许本次操作".into(), "取消".into()))
                .show(move |accepted| { let _ = send.send(accepted); });
            tokio::time::timeout(Duration::from_secs(300), receive).await
                .map_err(|_| "confirmation_expired".to_string())?
                .map_err(|_| "confirmation_cancelled".to_string())
        }).await
    }

    async fn view_action_context(&self, session_id: &str, view_id: &str) -> Result<String, String> {
        let row = sqlx::query("SELECT s.state,s.archived,w.trusted,p.enabled,p.installed,p.install_path,p.package_digest,b.generation_id,v.generation_id AS view_generation,json_object('session',s.id,'workspace',s.workspace_id,'state',s.state,'updated',s.updated_at,'installation',p.id,'digest',p.package_digest,'generation',b.generation_id,'document',v.document_json,'profile',(SELECT json_object('requested',requested_json,'enforced',enforced_json,'backend',enforcement_backend) FROM session_execution_profiles WHERE session_id=s.id),'pluginId',p.plugin_id,'label',s.label,'workspacePath',w.path) AS context FROM sessions s JOIN workspaces w ON w.id=s.workspace_id JOIN session_bindings b ON b.session_id=s.id JOIN plugin_installations p ON p.id=s.plugin_installation_id JOIN plugin_views v ON v.session_id=s.id AND v.view_id=? WHERE s.id=?")
            .bind(view_id).bind(session_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?
            .ok_or("invalid_request: view context unavailable")?;
        if row.get::<i64,_>("enabled") == 0 || row.get::<i64,_>("installed") == 0 || row.get::<i64,_>("trusted") == 0 || row.get::<i64,_>("archived") != 0 {
            return Err("permission_denied: view context is no longer available".into());
        }
        if matches!(row.get::<String,_>("state").as_str(), "running" | "waiting_approval" | "waiting_user" | "closed") { return Err("busy: session is not available for view actions".into()); }
        let runtime = self.runtimes.lock().await.get(session_id).cloned().ok_or("invalid_session: runtime unavailable")?;
        if runtime.generation_id != row.get::<String,_>("generation_id") || runtime.generation_id != row.get::<String,_>("view_generation") { return Err("invalid_session: stale view generation".into()); }
        let (_, _, digest) = plugin_registry::inspect(Path::new(&row.get::<String,_>("install_path")))?;
        if digest != row.get::<String,_>("package_digest") { return Err("manifest_mismatch: installed package changed".into()); }
        Ok(row.get("context"))
    }

    async fn confirm_view_action<F, Fut>(&self, session_id: &str, view_id: &str, action: &Value, input: &Value, expected: &str, confirm: F) -> Result<(), String>
    where F: FnOnce(String) -> Fut, Fut: std::future::Future<Output = Result<bool, String>> {
        if action["confirmation"] != "never" {
            let context: Value = serde_json::from_str(expected).map_err(|_| "invalid_request: confirmation context")?;
            let message = format!("插件：{}\n会话：{}\n工作区：{}\n视图：{}\n动作：{}\n能力：{}\n参数：{}", context["pluginId"].as_str().unwrap_or_default(), context["label"].as_str().unwrap_or(session_id), context["workspacePath"].as_str().unwrap_or_default(), view_id, action["id"].as_str().unwrap_or_default(), action["capability"].as_str().unwrap_or_default(), input);
            if !confirm(message).await? { return Err("confirmation_cancelled: action was not executed".into()); }
        }
        if self.view_action_context(session_id, view_id).await? != expected { return Err("confirmation_stale: view context changed; request confirmation again".into()); }
        Ok(())
    }

    async fn invoke_with_confirmation<F, Fut>(&self, session_id: &str, view_id: &str, action_id: &str, input: Value, version: Option<ViewVersion>, confirm: F) -> Result<Value, String>
    where F: FnOnce(String) -> Fut, Fut: std::future::Future<Output = Result<bool, String>> {
        // One host confirmation/dispatch at a time; permit drops on cancellation too.
        let _permit = self.view_action_gate.clone().try_acquire_owned().map_err(|_| "busy: another view action is pending")?;
        if !input.is_object() { return Err("invalid_request: operation input must be an object".into()); }
        if input.to_string().len() > 16 * 1024 { return Err("invalid_request: view action input exceeds 16 KiB".into()); }
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
        if let Some(version) = version {
            if version.generation_id != runtime.generation_id || document["revision"].as_u64() != Some(version.revision) {
                return Err("stale_view: refresh the view before submitting this action".into());
            }
        }
        let action = document["actions"].as_array().and_then(|actions|actions.iter().find(|action|action["id"] == action_id))
            .ok_or("invalid_request: undeclared view action")?;
        let expected_context = self.view_action_context(session_id, view_id).await?;
        let expected: Value = serde_json::from_str(&expected_context).map_err(|_| "invalid_request: confirmation context")?;
        if expected["document"].as_str() != Some(row.get::<&str,_>("document_json")) {
            return Err("confirmation_stale: view changed during validation".into());
        }
        if expected["generation"].as_str() != Some(runtime.generation_id.as_str()) {
            return Err("confirmation_stale: runtime changed during validation".into());
        }
        let manifest: Value = serde_json::from_str(row.get::<&str,_>("manifest_json")).map_err(|_|"manifest_mismatch")?;
        if crate::plugin_manifest::normalize(&manifest)?.version != 1 {
            return Err("protocol_incompatible: v2 activation is not available".into());
        }
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
            self.confirm_view_action(session_id, view_id, action, &input, &expected_context, confirm).await?;
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
        self.confirm_view_action(session_id, view_id, action, &input, &expected_context, confirm).await?;
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
        // Snapshot reads do not mutate the provider. Timeline refreshes must
        // remain available while a Pi turn is streaming or compacting.
        if row.get::<String,_>("state") == "running" && !matches!(capability, "queue.manage" | "session.snapshot") { return Err("busy: session has an active turn".into()); }
        let manifest: Value = serde_json::from_str(row.get::<&str,_>("manifest_json")).map_err(|_|"manifest_mismatch")?;
        if crate::plugin_manifest::normalize(&manifest)?.version != 1 {
            return Err("protocol_incompatible: v2 activation is not available".into());
        }
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
        if input["action"] == "set" && matches!(capability, "model.select" | "model.reasoning") {
            // Persist successful configuration at the shared boundary. In particular,
            // Pi resumes from this profile; generic calls must not bypass that write.
            let _write_guard = self.database_writes.lock().await;
            let generation: Option<String> = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?")
                .bind(session_id).fetch_one(&self.db).await.map_err(|error|error.to_string())?;
            if generation.as_deref() != Some(runtime.generation_id.as_str()) {
                return Err("invalid_session: stale model configuration response".into());
            }
            let mut profile = crate::session_execution_profile(&self.db, session_id).await.map_err(|error|error.to_string())?.profile;
            if apply_model_configuration(&mut profile, capability, &input, &result["output"]) {
                execution_profile::save_for_session(&self.db, session_id, &profile).await.map_err(|error|error.to_string())?;
            }
        }
        Ok(result["output"].clone())
    }

    pub async fn close(&self, session_id: &str) -> Result<(), String> {
        let _guard = self.lifecycle.lock().await;
        self.cancel_pending_tools(session_id).await;
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

    pub async fn archive(&self, session_id: &str) -> Result<Session, String> {
        let existing = crate::session_by_id(&self.db, session_id).await.map_err(|error|error.to_string())?;
        if existing.plugin_installation_id.is_none() { return Err("invalid_session: session is not plugin-backed".into()); }
        if existing.archived { return Ok(existing); }
        if matches!(existing.state.as_str(), "starting" | "running" | "waiting_approval" | "waiting_user" | "compacting") {
            return Err("busy: plugin session must be idle before it is archived".into());
        }
        self.close(session_id).await?;
        sqlx::query("UPDATE sessions SET archived=1,state='closed',updated_at=? WHERE id=?")
            .bind(crate::now_iso()).bind(session_id).execute(&self.db).await.map_err(|error|error.to_string())?;
        crate::session_by_id(&self.db, session_id).await.map_err(|error|error.to_string())
    }

    pub async fn unarchive(&self, session_id: &str) -> Result<Session, String> {
        let existing = crate::session_by_id(&self.db, session_id).await.map_err(|error|error.to_string())?;
        if existing.plugin_installation_id.is_none() { return Err("invalid_session: session is not plugin-backed".into()); }
        if !existing.archived { return Ok(existing); }
        // Leave the runtime lazy. The next prompt resumes the pinned plugin
        // binding, while the restored session is immediately selectable.
        sqlx::query("UPDATE sessions SET archived=0,state='interrupted',updated_at=? WHERE id=?")
            .bind(crate::now_iso()).bind(session_id).execute(&self.db).await.map_err(|error|error.to_string())?;
        crate::session_by_id(&self.db, session_id).await.map_err(|error|error.to_string())
    }

    pub async fn uninstall(&self, data_dir: &std::path::Path, installation_id: &str) -> Result<(), String> {
        let sessions: Vec<String> = sqlx::query_scalar("SELECT id FROM sessions WHERE plugin_installation_id=? AND state NOT IN ('closed','failed')")
            .bind(installation_id).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
        for session_id in sessions { self.close(&session_id).await?; }
        plugin_registry::uninstall(&self.db, data_dir, installation_id).await
    }

    pub async fn close_workspace(&self, workspace_id: &str) -> Result<(), String> {
        let sessions: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM sessions WHERE workspace_id=? AND plugin_installation_id IS NOT NULL AND state NOT IN ('closed','failed')",
        )
        .bind(workspace_id)
        .fetch_all(&self.db)
        .await
        .map_err(|error| error.to_string())?;
        for session_id in sessions { self.close(&session_id).await?; }
        Ok(())
    }

    async fn finalize_turn_changes(&self, workspace_id: &str, session_id: &str, turn_id: &str) -> Result<(), String> {
        let baseline = self.turn_baselines.lock().await.remove(&Self::turn_key(session_id, turn_id)).flatten();
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
        self.project_event(session_id, workspace_id, generation, binding, sequence, message, EventOrigin::Plugin).await
    }

    async fn project_event(&self, session_id: &str, workspace_id: &str, generation: &str, binding: &Value, sequence: i64, message: Value, origin: EventOrigin) -> Result<(), String> {
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
            if !["session.started","session.info_changed","turn.started","message.delta","message.completed","reasoning.updated","reasoning.completed","tool.started","tool.updated","tool.completed","turn.completed","turn.failed","approval.requested","approval.resolved","user_input.requested","user_input.resolved","usage.updated","queue.updated","compaction.started","compaction.completed","retry.started","retry.completed","extension.updated","adapter.crashed"].contains(&kind) {
                return Err("capability_unsupported: event outside minimal lifecycle".into());
            }
            let negotiated: Value = serde_json::from_str(&active.1).map_err(|_|"manifest_mismatch: negotiated capabilities missing")?;
            if event_capability_required(kind, origin).is_some_and(|capability|!negotiated.as_array().is_some_and(|items|items.contains(&json!(capability)))) {
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
                    let external_item_id = scoped_external_item_id(turn, item_id);
                    let id = format!("{turn}:assistant:{item_id}");
                    if kind == "message.delta" {
                        sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'assistant',?,'streaming',?,?,?) ON CONFLICT(id) DO UPDATE SET content=content || excluded.content,updated_at=excluded.updated_at")
                            .bind(id).bind(session_id).bind(turn).bind(&external_item_id).bind(text).bind(sequence).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    } else {
                        sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'assistant',?,'completed',?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,status='completed',updated_at=excluded.updated_at")
                            .bind(id).bind(session_id).bind(turn).bind(&external_item_id).bind(text).bind(sequence).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
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
                    let external_item_id = scoped_external_item_id(turn, item_id);
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'system','reasoning',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=CASE WHEN ?=1 THEN messages.content || excluded.content WHEN excluded.content='' THEN messages.content ELSE excluded.content END,status=excluded.status,updated_at=excluded.updated_at")
                        .bind(message_id).bind(session_id).bind(turn).bind(external_item_id).bind(content).bind(status).bind(sequence).bind(&now).bind(&now).bind(if append { 1_i64 } else { 0_i64 })
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
                    let external_item_id = scoped_external_item_id(turn, item_id);
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,tool_command,tool_cwd,tool_exit_code,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'tool',?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=CASE WHEN ?=1 THEN messages.content || excluded.content ELSE excluded.content END,tool_name=excluded.tool_name,tool_command=COALESCE(excluded.tool_command,messages.tool_command),tool_cwd=COALESCE(excluded.tool_cwd,messages.tool_cwd),tool_exit_code=COALESCE(excluded.tool_exit_code,messages.tool_exit_code),status=excluded.status,updated_at=excluded.updated_at")
                        .bind(message_id).bind(session_id).bind(turn).bind(external_item_id).bind(item_type).bind(command).bind(cwd).bind(exit_code).bind(content).bind(status).bind(sequence).bind(&now).bind(&now).bind(if append { 1_i64 } else { 0_i64 })
                        .execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "approval.requested" || kind == "user_input.requested" {
                    let request_id = p["payload"]["requestId"].as_str().ok_or("invalid_request: request id")?;
                    if request_id.is_empty() { return Err("invalid_request: request id".into()); }
                    let waiting = if kind == "approval.requested" { "waiting_approval" } else { "waiting_user" };
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?").bind(waiting).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "approval.resolved" || kind == "user_input.resolved" {
                    sqlx::query("UPDATE sessions SET state='running',updated_at=? WHERE id=?").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "compaction.started" {
                    sqlx::query("UPDATE sessions SET state='compacting',updated_at=? WHERE id=?").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "compaction.completed" {
                    let running: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM turns WHERE session_id=? AND status='running')")
                        .bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?")
                        .bind(if running != 0 { "running" } else { "idle" }).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
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

fn scoped_external_item_id(turn_id: &str, item_id: &str) -> String {
    format!("{turn_id}:{item_id}")
}





// v1 model capabilities accept either a reference or a provider/model pair.
// Only model fields are mirrored for recovery; permissions and enforcement stay unchanged.
fn apply_model_configuration(profile: &mut execution_profile::ResolvedExecutionProfile, capability: &str, input: &Value, output: &Value) -> bool {
    let value = if capability == "model.select" {
        output.get("current").and_then(Value::as_str).map(ToOwned::to_owned)
            .or_else(|| input.get("reference").and_then(Value::as_str).map(ToOwned::to_owned))
            .or_else(|| Some(format!("{}/{}", input.get("provider")?.as_str()?, input.get("modelId")?.as_str()?)))
    } else {
        output.get("level").or_else(||output.get("current")).and_then(Value::as_str)
            .or_else(||input.get("level").and_then(Value::as_str)).map(ToOwned::to_owned)
    };
    let Some(value) = value else { return false; };
    if capability == "model.select" {
        profile.requested.model = Some(value.clone());
        profile.enforced.model = Some(value);
    } else {
        profile.requested.reasoning_effort = Some(value.clone());
        profile.enforced.reasoning_effort = Some(value);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scopes_reused_plugin_item_ids_to_their_turn() {
        assert_eq!(scoped_external_item_id("turn-a", "assistant-1"), "turn-a:assistant-1");
        assert_eq!(scoped_external_item_id("turn-b", "assistant-1"), "turn-b:assistant-1");
        assert_ne!(scoped_external_item_id("turn-a", "tool-1"), scoped_external_item_id("turn-b", "tool-1"));
    }

    #[test]
    fn restores_pi_model_and_reasoning_into_the_execution_profile() {
        let mut profile = execution_profile::resolve("pi", None, "before".into()).unwrap();
        let binding = json!({"recovery":{"data":{
            "model":{"provider":"openai-codex","modelId":"gpt-5.6-luna"},
            "thinkingLevel":"medium"
        }}});
        assert!(apply_pi_recovery_profile(&mut profile, &binding));
        assert_eq!(profile.requested.model.as_deref(), Some("openai-codex/gpt-5.6-luna"));
        assert_eq!(profile.enforced.model, profile.requested.model);
        assert_eq!(profile.requested.reasoning_effort.as_deref(), Some("medium"));
        assert_eq!(profile.enforced.reasoning_effort, profile.requested.reasoning_effort);
        assert_ne!(profile.resolved_at, "before");
    }

    #[test]
    fn pi_execution_profile_takes_precedence_over_stale_recovery() {
        let mut requested = execution_profile::default_requested_profile("pi").unwrap();
        requested.model = Some("openai-codex/gpt-5.6-luna".into());
        requested.reasoning_effort = Some("low".into());
        let mut profile = execution_profile::resolve("pi", Some(requested), "before".into()).unwrap();
        let binding = json!({"recovery":{"data":{
            "model":{"provider":"openai-codex","modelId":"gpt-5.6-luna"},
            "thinkingLevel":"medium"
        }}});
        assert!(!apply_pi_recovery_profile(&mut profile, &binding));
        assert_eq!(profile.requested.reasoning_effort.as_deref(), Some("low"));
        assert_eq!(profile.enforced.reasoning_effort.as_deref(), Some("low"));
        assert_eq!(profile.resolved_at, "before");
    }

    #[test]
    fn maps_interactive_events_to_negotiated_capabilities() {
        assert_eq!(event_capability("approval.requested"), Some("approval.respond"));
        assert_eq!(event_capability("user_input.resolved"), Some("user-input.respond"));
        assert_eq!(event_capability("message.delta"), None);
        assert_eq!(event_capability_required("approval.requested", EventOrigin::Plugin), Some("approval.respond"));
        assert_eq!(event_capability_required("approval.resolved", EventOrigin::Plugin), Some("approval.respond"));
        assert_eq!(event_capability_required("approval.requested", EventOrigin::CoreTool), None);
        assert_eq!(event_capability_required("approval.resolved", EventOrigin::CoreTool), None);
        assert_eq!(event_capability_required("queue.updated", EventOrigin::CoreTool), Some("queue.manage"));
    }

    #[test]
    fn recognizes_only_supported_image_signatures_for_core_reads() {
        assert_eq!(image_mime_type(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(image_mime_type(b"GIF89a"), Some("image/gif"));
        assert_eq!(image_mime_type(b"RIFFxxxxWEBP"), Some("image/webp"));
        assert_eq!(image_mime_type(b"BMfake-bitmap"), Some("image/bmp"));
        assert_eq!(image_mime_type(b"not an image"), None);
    }

    #[test]
    fn restores_interactive_capabilities_for_pinned_bundled_codex_releases() {
        let declared = vec![json!("turn.send"), json!("approval.respond"), json!("user-input.respond")];
        let actual = vec![json!("turn.send")];
        let bundled = negotiated_capabilities(
            "dev.aibo.codex",
            "1.0.0",
            "dev.aibo.codex.agent",
            &declared,
            &actual,
        );
        assert_eq!(negotiated_capabilities("dev.aibo.codex", "2.0.0", "dev.aibo.codex.agent", &declared, &actual), actual);
        assert!(bundled.contains(&json!("approval.respond")));
        assert!(bundled.contains(&json!("user-input.respond")));
        assert_eq!(
            negotiated_capabilities("dev.example.plugin", "1.0.0", "dev.example.agent", &declared, &actual),
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
        fs::write(root.join("read-tool.txt"), "Core mediated read").unwrap();
        host.send(&session.id, "core read fixture").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        let read_content: String = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND external_message_id LIKE '%:core-read-result'")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(read_content, "Core mediated read");
        fs::write(root.join("read-tool.png"), [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, b'I', b'H', b'D', b'R']).unwrap();
        host.send(&session.id, "core image fixture").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        let image_content: String = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND external_message_id LIKE '%:core-image-result'")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert!(image_content.contains("\"encoding\":\"base64\""));
        assert!(image_content.contains("\"mimeType\":\"image/png\""));
        fs::write(root.parent().unwrap().join("outside-read.txt"), "must stay outside").unwrap();
        host.send(&session.id, "core read boundary").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        let leaked: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id=? AND content LIKE '%must stay outside%'")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(leaked, 0, "Core read must reject paths outside the workspace");
        let disabled_command_session = host.create("test", &installation.id, "dev.aibo.echo.agent").await.unwrap();
        host.send(&disabled_command_session.id, "core command fixture").await.unwrap();
        wait_turn(&db, &disabled_command_session.id, "failed").await;
        let disabled_state: String = sqlx::query_scalar("SELECT state FROM sessions WHERE id=?")
            .bind(&disabled_command_session.id).fetch_one(&db).await.unwrap();
        assert_eq!(disabled_state, "failed", "disabled Core command requests must fail without execution-profile escalation");
        host.close(&disabled_command_session.id).await.unwrap();
        let change_sets: i64 = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turn_change_sets WHERE session_id=?")
                    .bind(&session.id).fetch_one(&db).await.unwrap();
                if count > 0 { break count; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert!(change_sets >= 1, "plugin turns receive Core change-set projection");
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
        let requested_profile = execution_profile::ExecutionProfile {
            schema: execution_profile::EXECUTION_PROFILE_SCHEMA.to_owned(),
            interaction_mode: "edit".to_owned(),
            approval_policy: "on-request".to_owned(),
            filesystem_policy: "workspace-write".to_owned(),
            command_policy: "approved".to_owned(),
            network_policy: "disabled".to_owned(),
            model: None,
            reasoning_effort: None,
        };
        let resolved_profile = execution_profile::resolve_with_backend(execution_profile::EnforcementBackend::CoreProxy, Some(requested_profile), crate::now_iso()).unwrap();
        execution_profile::save_for_session(&db, &session.id, &resolved_profile).await.unwrap();
        assert!(!session.capabilities.contains(&"approval.respond".to_owned()), "Core approvals must work without a plugin approval operation");
        host.send(&session.id, "core tool fixture").await.unwrap();
        wait_session_state(&db, &session.id, "waiting_approval").await;
        let approval_id: String = sqlx::query_scalar(
            "SELECT json_extract(payload_json, '$.payload.requestId') FROM agent_events WHERE session_id=? AND event_type='approval.requested' ORDER BY sequence DESC LIMIT 1",
        )
        .bind(&session.id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert!(approval_id.starts_with("pi-tool:"));
        assert!(host.resolve_approval("another-session", &approval_id, "accept").await.unwrap_err().contains("session mismatch"));
        host.resolve_approval(&session.id, &approval_id, "accept").await.unwrap();
        assert!(host.resolve_approval(&session.id, &approval_id, "accept").await.unwrap_err().contains("no longer pending"));
        wait_turn(&db, &session.id, "completed").await;
        assert_eq!(fs::read_to_string(root.join("core-tool.txt")).unwrap(), "Core mediated Pi write");
        host.send(&session.id, "core command fixture").await.unwrap();
        wait_session_state(&db, &session.id, "waiting_approval").await;
        let command_approval_id: String = sqlx::query_scalar(
            "SELECT json_extract(payload_json, '$.payload.requestId') FROM agent_events WHERE session_id=? AND event_type='approval.requested' ORDER BY sequence DESC LIMIT 1",
        )
        .bind(&session.id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert!(command_approval_id.starts_with("pi-tool:"));
        host.resolve_approval(&session.id, &command_approval_id, "accept").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        let command_output: String = sqlx::query_scalar("SELECT content FROM messages WHERE session_id=? AND external_message_id LIKE '%:core-command-result'")
            .bind(&session.id).fetch_one(&db).await.unwrap();
        assert_eq!(command_output, "AIBO_CORE_COMMAND_OK");
        let before_configuration = crate::session_execution_profile(&db, &session.id).await.unwrap().profile;
        host.invoke_capability(&session.id, "model.select", json!({"action":"set","provider":"external","modelId":"new-model"})).await.unwrap();
        host.invoke_capability(&session.id, "model.reasoning", json!({"action":"set","level":"high"})).await.unwrap();
        assert!(host.invoke_capability(&session.id, "model.reasoning", json!({"action":"set","level":"invalid"})).await.is_err());
        let after_configuration = crate::session_execution_profile(&db, &session.id).await.unwrap().profile;
        assert_eq!(after_configuration.requested.model.as_deref(), Some("external/new-model"));
        assert_eq!(after_configuration.requested.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(after_configuration.enforcement_backend, before_configuration.enforcement_backend);
        assert_eq!(after_configuration.enforced.filesystem_policy, before_configuration.enforced.filesystem_policy);
        assert_eq!(after_configuration.enforced.command_policy, before_configuration.enforced.command_policy);

        async fn settled_view(db: &SqlitePool, session: &str, after: u64) -> String {
            for _ in 0..200 {
                let document: String = sqlx::query_scalar("SELECT document_json FROM plugin_views WHERE session_id=? AND view_id='dev.aibo.echo.tasks'")
                    .bind(session).fetch_one(db).await.unwrap();
                let value: Value = serde_json::from_str(&document).unwrap();
                if value["data"]["cursor"] == "Completed turns: 6" && value["revision"].as_u64().unwrap() > after { return document; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("view projection did not settle");
        }
        let before_view = settled_view(&db, &session.id, 0).await;
        let before_revision = serde_json::from_str::<Value>(&before_view).unwrap()["revision"].as_u64().unwrap();
        let invoked = host.invoke(&session.id, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"})).await.unwrap();
        assert_eq!(invoked, json!({"cursor":6}));
        // The native dialog is a host-only port; exercise decisions with the real
        // package/runtime while keeping unit tests independent of window automation.
        let original = settled_view(&db, &session.id, before_revision).await;
        let snapshots = host.view_snapshots(&session.id).await.unwrap();
        let snapshot = snapshots.iter().find(|item| item["document"]["viewId"] == "dev.aibo.echo.tasks").unwrap();
        let version: ViewVersion = serde_json::from_value(snapshot["version"].clone()).unwrap();
        assert_eq!(version.revision, snapshot["document"]["revision"].as_u64().unwrap());
        assert!(host.invoke_versioned(&session.id, "dev.aibo.echo.tasks", "commands", json!({}), ViewVersion { revision: version.revision + 1, ..version.clone() }).await.unwrap_err().contains("stale_view"));
        assert!(host.invoke_versioned(&session.id, "dev.aibo.echo.tasks", "commands", json!({}), ViewVersion { generation_id: "old-runtime".into(), ..version.clone() }).await.unwrap_err().contains("stale_view"));
        let versioned = host.invoke_versioned(&session.id, "dev.aibo.echo.tasks", "commands", json!({}), version).await.unwrap();
        assert_eq!(versioned, json!({"commands":[]}));
        let mut confirmation_view: Value = serde_json::from_str(&original).unwrap();
        for action in confirmation_view["actions"].as_array_mut().unwrap() {
            if action["id"] == "refresh" { action["confirmation"] = json!("always"); }
        }
        let confirmed_document = confirmation_view.to_string();
        sqlx::query("UPDATE plugin_views SET document_json=? WHERE session_id=? AND view_id='dev.aibo.echo.tasks'")
            .bind(&confirmed_document).bind(&session.id).execute(&db).await.unwrap();
        let concurrent_host = host.clone();
        let concurrent_session = session.id.clone();
        let denied = host.invoke_with_confirmation(&session.id, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"}), None, |message| async move {
            assert!(message.contains("manual"));
            // A duplicate submission cannot open a second dialog or execute.
            assert!(concurrent_host.invoke(&concurrent_session, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"})).await.unwrap_err().contains("busy"));
            Ok(false)
        }).await;
        let error = denied.unwrap_err();
        assert!(error.contains("confirmation_cancelled"), "{error}");
        let mut sensitive_view = confirmation_view.clone();
        for action in sensitive_view["actions"].as_array_mut().unwrap() {
            if action["id"] == "refresh" { action["confirmation"] = json!("when-sensitive"); }
        }
        sqlx::query("UPDATE plugin_views SET document_json=? WHERE session_id=? AND view_id='dev.aibo.echo.tasks'")
            .bind(sensitive_view.to_string()).bind(&session.id).execute(&db).await.unwrap();
        let approved = host.invoke_with_confirmation(&session.id, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"}), None, |_| async { Ok(true) }).await.unwrap();
        assert_eq!(approved, json!({"cursor":6}));
        let confirmation_revision = confirmation_view["revision"].as_u64().unwrap();
        let _ = settled_view(&db, &session.id, confirmation_revision).await;
        sqlx::query("UPDATE plugin_views SET document_json=? WHERE session_id=? AND view_id='dev.aibo.echo.tasks'")
            .bind(&confirmed_document).bind(&session.id).execute(&db).await.unwrap();
        let unavailable = host.invoke(&session.id, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"})).await.unwrap_err();
        assert!(unavailable.contains("confirmation_unavailable"));
        let revoked = host.invoke_with_confirmation(&session.id, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"}), None, |_| async {
            sqlx::query("UPDATE workspaces SET trusted=0 WHERE id=(SELECT workspace_id FROM sessions WHERE id=?)")
                .bind(&session.id).execute(&db).await.unwrap();
            Ok(true)
        }).await;
        assert!(revoked.unwrap_err().contains("permission_denied"));
        sqlx::query("UPDATE workspaces SET trusted=1 WHERE id=(SELECT workspace_id FROM sessions WHERE id=?)")
            .bind(&session.id).execute(&db).await.unwrap();
        // A view update while the human decides requires a fresh confirmation.
        let stale = host.invoke_with_confirmation(&session.id, "dev.aibo.echo.tasks", "refresh", json!({"label":"manual"}), None, |_| async {
            sqlx::query("UPDATE plugin_views SET document_json=? WHERE session_id=? AND view_id='dev.aibo.echo.tasks'")
                .bind(&original).bind(&session.id).execute(&db).await.unwrap();
            Ok(true)
        }).await;
        assert!(stale.unwrap_err().contains("confirmation_stale"));
        let commands = host.invoke(&session.id, "dev.aibo.echo.tasks", "commands", json!({})).await.unwrap();
        assert_eq!(commands, json!({"commands":[]}));
        let invoked = host.invoke_capability(&session.id, "ext.dev.aibo.echo.refresh", json!({"label":"semantic"})).await.unwrap();
        assert_eq!(invoked, json!({"cursor":6}));
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
        assert_eq!(restarted.invoke_capability(&session.id, "model.select", json!({"action":"list"})).await.unwrap()["current"], "external/new-model");
        assert_eq!(restarted.invoke_capability(&session.id, "model.reasoning", json!({"action":"list"})).await.unwrap()["current"], "high");
        restarted.send(&session.id, "after restart").await.unwrap();
        wait_turn(&db, &session.id, "completed").await;
        wait_session_state(&db, &session.id, "idle").await;
        let archived = restarted.archive(&session.id).await.unwrap();
        assert!(archived.archived);
        assert_eq!(archived.state, "closed");
        assert!(restarted.resume(&session.id).await.unwrap_err().contains("session is closed"));
        let restored = restarted.unarchive(&session.id).await.unwrap();
        assert!(!restored.archived);
        assert_eq!(restored.state, "interrupted");
        restarted.resume(&session.id).await.unwrap();
        restarted.close(&session.id).await.unwrap();
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
