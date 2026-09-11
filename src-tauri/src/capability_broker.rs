//! Trusted caller identity is injected by IPC. No caller permissions or workspace paths
//! are accepted from request JSON. This first runtime slice executes read operations only.
use crate::{plugin_manifest, plugin_registry, plugin_runtime::PluginRuntime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::{Duration, Instant}};
use tokio::sync::{watch, Mutex, Semaphore};

const MAX_INSTANCES: usize = 32;
const MAX_ACTIVE: usize = 32;
const MAX_INPUT: usize = 65_536;
const MAX_OUTPUT: usize = 262_144;
const IDLE_TTL: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Scope { Application, Workspace(String), Session(String) }
impl Scope {
    fn key(&self) -> (&str, &str) { match self { Self::Application => ("application", "application"), Self::Workspace(id) => ("workspace", id), Self::Session(id) => ("session", id) } }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub scope: Scope,
    pub capability: String,
    pub version: String,
    pub request_id: String,
    pub input: Value,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Binding {
    pub scope: Scope,
    pub capability: String,
    pub version: String,
    pub installation_id: String,
    pub contribution_id: String,
}
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Failure { pub code: String, pub message: String, pub invocation_id: Option<String> }
fn fail(code: &str, message: &str) -> Failure { Failure { code: code.into(), message: message.into(), invocation_id: None } }
fn database(_: impl std::fmt::Display) -> Failure { fail("provider_unavailable", "Capability storage is unavailable") }
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Response { pub invocation_id: String, pub installation_id: String, pub generation_id: String, pub output: Value }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Provider {
    pub installation_id: String,
    pub contribution_id: String,
    pub plugin_id: String,
    pub version: String,
    #[serde(skip_serializing)] operation: Value,
    #[serde(skip_serializing)] manifest: Value,
    #[serde(skip_serializing)] directory: PathBuf,
    #[serde(skip_serializing)] digest: String,
}
struct Slot { permit: Arc<Semaphore>, runtime: Mutex<Option<PluginRuntime>>, touched: Mutex<Instant> }
struct Flight { cancel: watch::Sender<bool>, installation_id: String, contribution_id: String, workspace_id: Option<String> }
type RuntimeKey = (String, String, Scope);
#[derive(Clone)]
pub(crate) struct Broker {
    db: SqlitePool,
    mutations: Arc<Mutex<()>>,
    slots: Arc<Mutex<HashMap<RuntimeKey, Arc<Slot>>>>,
    flights: Arc<Mutex<HashMap<(String, String), Flight>>>,
}
impl Broker {
    pub fn new(db: SqlitePool) -> Self { Self { db, mutations: Default::default(), slots: Default::default(), flights: Default::default() } }
    // Serialize desktop lifecycle mutations so re-enable cannot race with drain/uninstall.
    pub async fn mutation_guard(&self) -> tokio::sync::OwnedMutexGuard<()> { self.mutations.clone().lock_owned().await }
    pub async fn recover(db: &SqlitePool) -> Result<(), String> {
        sqlx::query("UPDATE capability_invocations SET status='interrupted',finished_at=? WHERE status='running'")
            .bind(crate::now_iso()).execute(db).await.map_err(|e|e.to_string())?;
        Ok(())
    }
    async fn workspace(&self, scope: &Scope) -> Result<Option<crate::Workspace>, Failure> {
        let id = match scope {
            Scope::Application => return Ok(None), Scope::Workspace(id) => id.clone(),
            Scope::Session(id) => sqlx::query_scalar::<_, String>("SELECT workspace_id FROM sessions WHERE id=?")
                .bind(id).fetch_optional(&self.db).await.map_err(database)?.ok_or_else(||fail("provider_unavailable", "Session no longer exists"))?,
        };
        let workspace = crate::workspace_by_id(&self.db, &id).await.map_err(|_|fail("provider_unavailable", "Workspace no longer exists"))?;
        if workspace.trust != "trusted" { return Err(fail("permission_denied", "Workspace must be trusted")); }
        Ok(Some(workspace))
    }
    fn identity(scope: &Scope, capability: &str, version: &str) -> Result<(), Failure> {
        if scope.key().1.is_empty() || scope.key().1.len() > 160 || capability.len() > 160 || capability.is_empty() || version.len() > 128 || semver::Version::parse(version).is_err() {
            return Err(fail("unsupported", "Invalid scope or capability version"));
        }
        Ok(())
    }
    pub async fn providers(&self, scope: &Scope, capability: &str, version: &str) -> Result<Vec<Provider>, Failure> {
        Self::identity(scope, capability, version)?;
        self.workspace(scope).await?;
        let rows = sqlx::query("SELECT id,plugin_id,manifest_json,install_path,package_digest FROM plugin_installations WHERE installed=1 AND enabled=1")
            .fetch_all(&self.db).await.map_err(database)?;
        let mut providers = vec![];
        let mut other_version = false;
        for row in rows {
            let manifest: Value = serde_json::from_str(row.get("manifest_json")).map_err(database)?;
            let model = plugin_manifest::normalize(&manifest).map_err(database)?;
            if model.version != 2 || !plugin_manifest::activation_issues(&manifest).map_err(database)?.is_empty() { continue; }
            if plugin_registry::dependency_diagnostics(&manifest).iter().any(|dependency|dependency.required && !dependency.available) { continue; }
            let dependencies = crate::plugin_dependencies::resolve(&self.db,row.get("id"),false).await.map_err(database)?;
            for contribution in model.contributions.iter().filter(|item|item.kind == "capabilityProvider" && item.scope == scope.key().0 && dependencies.supports(&item.id)) {
                for operation in contribution.metadata["operations"].as_array().unwrap() {
                    if operation["capability"]["id"] != capability { continue; }
                    if operation["capability"]["version"] != version { other_version = true; continue; }
                    providers.push(Provider { installation_id: row.get("id"), contribution_id: contribution.id.clone(), plugin_id: row.get("plugin_id"), version: version.into(), operation: operation.clone(), manifest: manifest.clone(), directory: PathBuf::from(row.get::<String,_>("install_path")), digest: row.get("package_digest") });
                }
            }
        }
        if providers.is_empty() && other_version { return Err(fail("incompatible_version", "No provider implements the requested contract version")); }
        Ok(providers)
    }
    pub async fn bind(&self, binding: Binding) -> Result<(), Failure> {
        let offers = self.providers(&binding.scope, &binding.capability, &binding.version).await?;
        if !offers.iter().any(|provider|provider.installation_id == binding.installation_id && provider.contribution_id == binding.contribution_id) {
            return Err(fail("provider_unavailable", "Selected provider is unavailable"));
        }
        if let Scope::Session(id) = &binding.scope {
            let pinned: Option<String> = sqlx::query_scalar("SELECT plugin_installation_id FROM sessions WHERE id=?").bind(id).fetch_one(&self.db).await.map_err(database)?;
            if pinned.as_deref() != Some(binding.installation_id.as_str()) { return Err(fail("permission_denied", "Session provider must match its pinned installation")); }
        }
        let dependencies = crate::plugin_dependencies::resolve(&self.db,&binding.installation_id,true).await.map_err(database)?;
        if !dependencies.supports(&binding.contribution_id) { return Err(fail("provider_unavailable", "Selected contribution has an unavailable dependency")); }
        let (kind,id) = binding.scope.key();
        sqlx::query("INSERT INTO capability_provider_bindings(scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope_kind,scope_id,capability_id,contract_version) DO UPDATE SET installation_id=excluded.installation_id,contribution_id=excluded.contribution_id,updated_at=excluded.updated_at")
            .bind(kind).bind(id).bind(binding.capability).bind(binding.version).bind(binding.installation_id).bind(binding.contribution_id).bind(crate::now_iso()).execute(&self.db).await.map_err(database)?;
        Ok(())
    }
    async fn provider(&self, request: &Request) -> Result<Provider, Failure> {
        let (kind,id) = request.scope.key();
        let binding: Option<(String,String)> = sqlx::query_as("SELECT installation_id,contribution_id FROM capability_provider_bindings WHERE scope_kind=? AND scope_id=? AND capability_id=? AND contract_version=?")
            .bind(kind).bind(id).bind(&request.capability).bind(&request.version).fetch_optional(&self.db).await.map_err(database)?;
        let offers = match self.providers(&request.scope, &request.capability, &request.version).await {
            Err(error) if binding.is_some() && error.code == "incompatible_version" => return Err(fail("provider_unavailable", "Bound contract version is unavailable")),
            result => result?,
        };
        if let Some((installation,contribution)) = binding {
            if let Scope::Session(id) = &request.scope {
                let pinned: Option<String> = sqlx::query_scalar("SELECT plugin_installation_id FROM sessions WHERE id=?").bind(id).fetch_one(&self.db).await.map_err(database)?;
                if pinned.as_deref() != Some(installation.as_str()) { return Err(fail("provider_unavailable", "Session binding no longer matches its pinned installation")); }
            }
            return offers.into_iter().find(|provider|provider.installation_id == installation && provider.contribution_id == contribution)
                .ok_or_else(||fail("provider_unavailable", "Bound release is unavailable; choose a provider explicitly"));
        }
        if offers.is_empty() { return Err(fail("unsupported", "No provider declares this capability")); }
        Err(fail("provider_selection_required", "Choose and bind a provider before calling it"))
    }
    pub async fn cancel(&self, caller: &str, request_id: &str) -> bool {
        self.flights.lock().await.get(&(caller.into(),request_id.into())).is_some_and(|flight|flight.cancel.send(true).is_ok())
    }
    pub async fn stop_installation(&self, installation: &str) -> Result<(), Failure> {
        self.stop_contributions(installation,None).await
    }
    pub async fn stop_contributions(&self, installation: &str, contributions: Option<&[String]>) -> Result<(), Failure> {
        let matches = |id: &str| contributions.map_or(true,|ids|ids.iter().any(|item|item == id));
        for flight in self.flights.lock().await.values().filter(|flight|flight.installation_id == installation && matches(&flight.contribution_id)) { let _ = flight.cancel.send(true); }
        let mut slots = self.slots.lock().await;
        let keys: Vec<_> = slots.keys().filter(|key|key.0 == installation && matches(&key.1)).cloned().collect();
        let retired: Vec<_> = keys.into_iter().filter_map(|key|slots.remove(&key)).collect();
        drop(slots);
        for slot in retired { if let Some(runtime) = slot.runtime.lock().await.take() { runtime.stop().await; } }
        tokio::time::timeout(Duration::from_secs(6),async {
            while self.flights.lock().await.values().any(|flight|flight.installation_id == installation && matches(&flight.contribution_id)) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.map_err(|_|fail("busy", "Provider invocations are still draining"))?;
        Ok(())
    }
    pub async fn stop_workspace(&self, workspace: &str) -> Result<(), Failure> {
        for flight in self.flights.lock().await.values().filter(|flight|flight.workspace_id.as_deref() == Some(workspace)) { let _ = flight.cancel.send(true); }
        let sessions: Vec<String> = sqlx::query_scalar("SELECT id FROM sessions WHERE workspace_id=?").bind(workspace).fetch_all(&self.db).await.map_err(database)?;
        let mut slots = self.slots.lock().await;
        let keys: Vec<_> = slots.keys().filter(|key|match &key.2 { Scope::Workspace(id) => id == workspace, Scope::Session(id) => sessions.contains(id), Scope::Application => false }).cloned().collect();
        let retired: Vec<_> = keys.into_iter().filter_map(|key|slots.remove(&key)).collect();
        drop(slots);
        for slot in retired { if let Some(runtime) = slot.runtime.lock().await.take() { runtime.stop().await; } }
        Ok(())
    }
    async fn slot(&self, provider: &Provider, scope: &Scope) -> Result<Arc<Slot>, Failure> {
        let key = (provider.installation_id.clone(),provider.contribution_id.clone(),scope.clone());
        let mut slots = self.slots.lock().await;
        let mut expired = vec![];
        for (key,slot) in slots.iter() {
            if slot.permit.available_permits() == 1 && slot.touched.lock().await.elapsed() > IDLE_TTL { expired.push(key.clone()); }
        }
        for key in expired { if let Some(slot) = slots.remove(&key) { if let Some(runtime) = slot.runtime.lock().await.take() { runtime.stop().await; } } }
        if let Some(slot) = slots.get(&key) { return Ok(slot.clone()); }
        if slots.len() >= MAX_INSTANCES { return Err(fail("busy", "Capability instance limit reached")); }
        let slot = Arc::new(Slot { permit: Arc::new(Semaphore::new(1)), runtime: Mutex::new(None), touched: Mutex::new(Instant::now()) });
        slots.insert(key, slot.clone()); Ok(slot)
    }
    pub async fn invoke(&self, caller: &str, request: Request) -> Result<Response, Failure> {
        Self::identity(&request.scope,&request.capability,&request.version)?;
        if request.request_id.is_empty() || request.request_id.len() > 160 || request.input.to_string().len() > MAX_INPUT { return Err(fail("invalid_input", "Request size or identity limit")); }
        let provider = self.provider(&request).await?;
        if provider.operation["effect"] != "read" { return Err(fail("permission_denied", "Write operations are not enabled in this runtime slice")); }
        let workspace = self.workspace(&request.scope).await?;
        if provider.operation["permissions"].as_array().unwrap().iter().any(|permission| permission != "workspace.read" || workspace.is_none()) { return Err(fail("permission_denied", "Operation requires an unavailable permission")); }
        if !jsonschema::options().build(&provider.operation["inputSchema"]).map_err(database)?.is_valid(&request.input) { return Err(fail("invalid_input", "Input does not match the capability contract")); }
        let slot = self.slot(&provider,&request.scope).await?;
        let _permit = slot.permit.clone().try_acquire_owned().map_err(|_|fail("busy", "An invocation is already active in this scope"))?;
        let key = (caller.to_string(),request.request_id.clone());
        let (cancel,mut cancelled) = watch::channel(false);
        {
            let mut flights = self.flights.lock().await;
            if flights.len() >= MAX_ACTIVE || flights.contains_key(&key) { return Err(fail("busy", "Invocation limit or duplicate request ID")); }
            flights.insert(key.clone(),Flight { cancel, installation_id: provider.installation_id.clone(), contribution_id: provider.contribution_id.clone(), workspace_id: workspace.as_ref().map(|workspace|workspace.id.clone()) });
        }
        let id = ulid::Ulid::new().to_string();
        let timeout = Duration::from_millis(provider.operation["timeoutMs"].as_u64().unwrap());
        let deadline_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64 + timeout.as_millis() as i64;
        let (kind,scope_id) = request.scope.key();
        let insert = sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms) VALUES(?,?,?,?,?,?,?,?,'running',?,?)")
            .bind(&id).bind(caller).bind(kind).bind(scope_id).bind(&request.capability).bind(&request.version).bind(&provider.installation_id).bind(&provider.contribution_id).bind(crate::now_iso()).bind(deadline_ms).execute(&self.db).await;
        if let Err(error) = insert { self.flights.lock().await.remove(&key); return Err(database(error)); }
        let mut result = tokio::select! {
            biased;
            _ = cancelled.changed() => Err(fail("cancelled", "Invocation was cancelled")),
            result = tokio::time::timeout(timeout,self.execute(&id,&request,&provider,&slot,workspace.as_ref(),deadline_ms)) => result.unwrap_or_else(|_|Err(fail("timeout", "Invocation deadline expired"))),
        };
        if result.is_err() { if let Some(runtime) = slot.runtime.lock().await.take() { runtime.stop().await; } }
        *slot.touched.lock().await = Instant::now();
        self.flights.lock().await.remove(&key);
        let status = match &result { Ok(_) => "completed", Err(error) => error.code.as_str() };
        sqlx::query("UPDATE capability_invocations SET status=?,finished_at=? WHERE id=?").bind(status).bind(crate::now_iso()).bind(&id).execute(&self.db).await.map_err(database)?;
        if let Err(error) = &mut result { error.invocation_id = Some(id); }
        result
    }
    async fn execute(&self, id: &str, request: &Request, provider: &Provider, slot: &Slot, workspace: Option<&crate::Workspace>, deadline_ms: i64) -> Result<Response, Failure> {
        let current: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plugin_installations WHERE id=? AND enabled=1 AND installed=1").bind(&provider.installation_id).fetch_one(&self.db).await.map_err(database)?;
        if current != 1 { return Err(fail("provider_unavailable", "Provider was disabled")); }
        let (_,_,digest) = plugin_registry::inspect(&provider.directory).map_err(|_|fail("provider_unavailable", "Installed package integrity check failed"))?;
        if digest != provider.digest { return Err(fail("provider_unavailable", "Installed package changed")); }
        let dependencies = crate::plugin_dependencies::resolve(&self.db,&provider.installation_id,true).await.map_err(database)?;
        if !dependencies.supports(&provider.contribution_id) { return Err(fail("provider_unavailable", "A pinned package dependency is unavailable")); }
        // Recheck scope authority immediately before giving a runtime its workspace.
        self.workspace(&request.scope).await?;
        let mut active = slot.runtime.lock().await;
        if active.as_ref().is_some_and(|runtime|runtime.was_stopped()) { *active = None; }
        if active.is_none() {
            let entrypoint = provider.directory.join(provider.manifest["entrypoint"]["executable"].as_str().unwrap());
            let mut args: Vec<String> = provider.manifest["entrypoint"]["args"].as_array().into_iter().flatten().map(|arg|arg.as_str().unwrap().into()).collect();
            let executable = if entrypoint.extension().is_some_and(|extension|extension == "mjs" || extension == "js") {
                args.insert(0,entrypoint.to_string_lossy().into_owned());
                crate::find_executable("node").ok_or_else(||fail("provider_unavailable", "Node is unavailable"))?
            } else { entrypoint };
            let runtime = PluginRuntime::spawn_capability(&executable,&args,&provider.directory).map_err(|_|fail("provider_unavailable", "Capability process could not start"))?;
            *active = Some(runtime);
        }
        let runtime = active.as_ref().unwrap().clone();
        drop(active);
        // Handshake is idempotent for an existing generation, and every invocation
        // checks the exact contribution/contract/operation instead of trusting a capability name.
        let handshake = runtime.request("capability.initialize",json!({"protocol":"2.0","generationId":runtime.generation_id,"installationId":provider.installation_id,"pluginId":provider.plugin_id,"pluginVersion":provider.manifest["version"],"contributionId":provider.contribution_id}),Duration::from_secs(5)).await.map_err(transport)?;
        let expected = json!({"capability":request.capability,"version":request.version,"operationId":provider.operation["id"]});
        if handshake["protocol"] != "2.0" || handshake["pluginId"] != provider.plugin_id || handshake["pluginVersion"] != provider.manifest["version"] || handshake["generationId"] != runtime.generation_id || !handshake["operations"].as_array().is_some_and(|operations|operations.contains(&expected)) {
            return Err(fail("incompatible_version", "Runtime did not negotiate the declared operation"));
        }
        sqlx::query("UPDATE capability_invocations SET generation_id=? WHERE id=?").bind(&runtime.generation_id).bind(id).execute(&self.db).await.map_err(database)?;
        let raw = runtime.request("capability.invoke",json!({"invocationId":id,"generationId":runtime.generation_id,"contributionId":provider.contribution_id,"capability":request.capability,"contractVersion":request.version,"operationId":provider.operation["id"],"scope":request.scope,"deadlineUnixMs":deadline_ms,"context":{"workspaceId":workspace.map(|workspace|&workspace.id),"workspacePath":workspace.map(|workspace|&workspace.path)},"input":request.input}),Duration::from_millis(provider.operation["timeoutMs"].as_u64().unwrap())).await.map_err(transport)?;
        if raw["invocationId"] != id || raw["generationId"] != runtime.generation_id || raw["output"].to_string().len() > MAX_OUTPUT || !raw.as_object().is_some_and(|object|object.len() == 3 && object.contains_key("output")) || !jsonschema::options().build(&provider.operation["outputSchema"]).map_err(database)?.is_valid(&raw["output"]) {
            return Err(fail("invalid_output", "Runtime returned a stale or invalid result"));
        }
        Ok(Response { invocation_id: id.into(), installation_id: provider.installation_id.clone(), generation_id: runtime.generation_id, output: raw["output"].clone() })
    }
}
fn transport(error: String) -> Failure {
    let code = error.split(':').next().unwrap_or("");
    fail(match code { "busy" | "timeout" | "cancelled" | "unsupported" | "incompatible_version" | "permission_denied" | "invalid_output" => code, _ => "provider_unavailable" }, "Capability transport failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    const CAP: &str = "dev.aibo.capability-echo.echo";
    const CONTRIBUTION: &str = "dev.aibo.capability-echo.read";
    struct Fixture { root: PathBuf, db: SqlitePool, broker: Broker, installation: String }
    impl Fixture {
        async fn new() -> Self {
            let root = std::env::temp_dir().join(format!("aibo-capability-{}",ulid::Ulid::new()));
            let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
            for id in ["a","b"] {
                fs::create_dir_all(root.join(id)).unwrap();
                sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES(?,?,?,1,?,?)")
                    .bind(id).bind(root.join(id).to_string_lossy().as_ref()).bind(id).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
            }
            let mut fixture = Self { root, db: db.clone(), broker: Broker::new(db), installation: String::new() };
            fixture.installation = fixture.install("1.0.0","workspace",None).await;
            fixture
        }
        async fn install(&self, version: &str, scope: &str, mutate: Option<fn(&mut Value)>) -> String {
            let path = self.root.join(format!("package-{version}-{scope}"));
            fs::create_dir_all(&path).unwrap();
            let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/capability-echo/plugin.json")).unwrap();
            manifest["version"] = json!(version); manifest["contributions"][0]["scope"] = json!(scope);
            if scope == "application" { manifest["contributions"][0]["operations"][0]["permissions"] = json!([]); }
            if let Some(mutate) = mutate { mutate(&mut manifest); }
            fs::write(path.join("plugin.json"),manifest.to_string()).unwrap();
            fs::write(path.join("worker.mjs"),include_str!("../../fixtures/plugins/capability-echo/worker.mjs")).unwrap();
            let plugin = plugin_registry::install(&self.db,&self.root.join("data"),&path).await.unwrap();
            assert!(plugin.runnable);
            plugin_registry::enable(&self.db,&plugin.id,true).await.unwrap();
            plugin.id
        }
        async fn bind(&self, scope: Scope, installation: &str) {
            self.broker.bind(Binding { scope, capability: CAP.into(),version:"1.0.0".into(),installation_id:installation.into(),contribution_id:CONTRIBUTION.into() }).await.unwrap();
        }
        async fn finish(self) {
            let installations: Vec<String> = sqlx::query_scalar("SELECT id FROM plugin_installations").fetch_all(&self.db).await.unwrap();
            for id in installations { self.broker.stop_installation(&id).await.unwrap(); }
            self.db.close().await;
            fs::remove_dir_all(self.root).unwrap();
        }
    }
    fn request(scope: &str, id: &str, input: Value) -> Request { Request {scope:Scope::Workspace(scope.into()),capability:CAP.into(),version:"1.0.0".into(),request_id:id.into(),input} }
    async fn running(fixture: &Fixture, count: i64) {
        tokio::time::timeout(Duration::from_secs(5),async {
            loop {
                let actual: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE status='running' AND generation_id IS NOT NULL").fetch_one(&fixture.db).await.unwrap();
                if actual >= count { break; }
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
    }
    #[tokio::test]
    async fn invokes_real_process_without_agent_and_retains_binding_after_restart() {
        let fixture = Fixture::new().await;
        let req = request("a","read",json!({"value":"hello"}));
        assert_eq!(fixture.broker.invoke("main",req.clone()).await.unwrap_err().code,"provider_selection_required");
        fixture.bind(req.scope.clone(),&fixture.installation).await;
        let result = fixture.broker.invoke("main",req.clone()).await.unwrap();
        assert_eq!(result.output,json!({"value":"hello","workspacePath":fixture.root.join("a").to_string_lossy()}));
        let again = fixture.broker.invoke("main",req.clone()).await.unwrap();
        assert_eq!(result.generation_id,again.generation_id,"idle scope reuses its generation");
        let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions").fetch_one(&fixture.db).await.unwrap();
        let events: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_events").fetch_one(&fixture.db).await.unwrap();
        assert_eq!((sessions,events),(0,0));
        fixture.broker.stop_installation(&fixture.installation).await.unwrap();
        let restarted = Broker::new(fixture.db.clone());
        let result = restarted.invoke("main",req).await.unwrap();
        assert_ne!(result.generation_id,again.generation_id);
        restarted.stop_installation(&fixture.installation).await.unwrap();
        fixture.finish().await;
    }
    #[tokio::test]
    async fn explicit_binding_survives_new_release_and_never_falls_back_after_disable() {
        let fixture = Fixture::new().await;
        let newer = fixture.install("1.1.0","workspace",None).await;
        let req = request("a","read",json!({"value":"bound"}));
        assert_eq!(fixture.broker.providers(&req.scope,CAP,"1.0.0").await.unwrap().len(),2);
        assert_eq!(fixture.broker.invoke("main",req.clone()).await.unwrap_err().code,"provider_selection_required");
        fixture.bind(req.scope.clone(),&fixture.installation).await;
        assert_eq!(fixture.broker.invoke("main",req.clone()).await.unwrap().installation_id,fixture.installation);
        plugin_registry::enable(&fixture.db,&fixture.installation,false).await.unwrap();
        fixture.broker.stop_installation(&fixture.installation).await.unwrap();
        assert_eq!(fixture.broker.invoke("main",req.clone()).await.unwrap_err().code,"provider_unavailable");
        fixture.bind(req.scope.clone(),&newer).await;
        assert_eq!(fixture.broker.invoke("main",req).await.unwrap().installation_id,newer);
        fixture.finish().await;
    }
    #[tokio::test]
    async fn cancellation_is_owned_by_window_and_isolated_from_other_workspaces() {
        let fixture = Fixture::new().await;
        for id in ["a","b"] { fixture.bind(Scope::Workspace(id.into()),&fixture.installation).await; }
        let first = { let broker = fixture.broker.clone(); tokio::spawn(async move { broker.invoke("main",request("a","cancel",json!({"value":"first","delayMs":500}))).await }) };
        let second = { let broker = fixture.broker.clone(); tokio::spawn(async move { broker.invoke("main",request("b","keep",json!({"value":"second","delayMs":500}))).await }) };
        running(&fixture,2).await;
        assert!(!fixture.broker.cancel("other-window","cancel").await);
        assert_eq!(fixture.broker.invoke("main",request("a","duplicate-scope",json!({"value":"busy"}))).await.unwrap_err().code,"busy");
        assert!(fixture.broker.cancel("main","cancel").await);
        assert_eq!(first.await.unwrap().unwrap_err().code,"cancelled");
        assert_eq!(second.await.unwrap().unwrap().output["value"],"second");
        assert!(!fixture.broker.cancel("main","cancel").await);
        fixture.finish().await;
    }
    #[tokio::test]
    async fn validates_input_authority_versions_and_untrusted_runtime_output() {
        let fixture = Fixture::new().await;
        let scope = Scope::Workspace("a".into());
        fixture.bind(scope.clone(),&fixture.installation).await;
        assert!(matches!(fixture.broker.providers(&scope,CAP,"2.0.0").await,Err(Failure { code, .. }) if code == "incompatible_version"));
        assert_eq!(fixture.broker.invoke("main",request("a","bad",json!({"value":"hello","workspacePath":"/etc"}))).await.unwrap_err().code,"invalid_input");
        for mode in ["wrong-generation","wrong-output"] {
            assert_eq!(fixture.broker.invoke("main",request("a",mode,json!({"value":"hello","mode":mode}))).await.unwrap_err().code,"invalid_output");
        }
        assert_eq!(fixture.broker.invoke("main",request("a","crash",json!({"value":"hello","mode":"crash"}))).await.unwrap_err().code,"provider_unavailable");
        assert!(fixture.broker.invoke("main",request("a","after-crash",json!({"value":"healthy"}))).await.is_ok());
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='a'").execute(&fixture.db).await.unwrap();
        assert_eq!(fixture.broker.invoke("main",request("a","denied",json!({"value":"hello"}))).await.unwrap_err().code,"permission_denied");
        assert_eq!(fixture.broker.invoke("main",request("missing","missing",json!({"value":"hello"}))).await.unwrap_err().code,"provider_unavailable");
        fixture.finish().await;
    }
    #[tokio::test]
    async fn timeouts_and_workspace_revocation_stop_the_generation_and_audit_terminal_state() {
        let fixture = Fixture::new().await;
        fixture.bind(Scope::Workspace("a".into()),&fixture.installation).await;
        let error = fixture.broker.invoke("main",request("a","timeout",json!({"value":"slow","delayMs":3000}))).await.unwrap_err();
        assert_eq!(error.code,"timeout");
        let status: String = sqlx::query_scalar("SELECT status FROM capability_invocations WHERE id=?").bind(error.invocation_id).fetch_one(&fixture.db).await.unwrap();
        assert_eq!(status,"timeout");
        let active = { let broker = fixture.broker.clone(); tokio::spawn(async move {broker.invoke("main",request("a","revoked",json!({"value":"revoked","delayMs":500}))).await}) };
        running(&fixture,1).await;
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='a'").execute(&fixture.db).await.unwrap();
        fixture.broker.stop_workspace("a").await.unwrap();
        assert!(active.await.unwrap().is_err());
        let running: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE status='running'").fetch_one(&fixture.db).await.unwrap();
        assert_eq!(running,0);
        fixture.finish().await;
    }
    #[tokio::test]
    async fn application_scope_and_session_scope_use_explicit_authority() {
        let fixture = Fixture::new().await;
        let application = fixture.install("1.0.1","application",None).await;
        fixture.bind(Scope::Application,&application).await;
        let result = fixture.broker.invoke("main",Request {scope:Scope::Application,..request("ignored","application",json!({"value":"app"}))}).await.unwrap();
        assert_eq!(result.output["workspacePath"],Value::Null);
        let session_provider = fixture.install("1.0.2","session",None).await;
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES('session','a','dev.example.agent','session','idle',?,?,?)")
            .bind(crate::now_iso()).bind(crate::now_iso()).bind(&session_provider).execute(&fixture.db).await.unwrap();
        fixture.bind(Scope::Session("session".into()),&session_provider).await;
        let result = fixture.broker.invoke("main",Request {scope:Scope::Session("session".into()),..request("ignored","session",json!({"value":"session"}))}).await.unwrap();
        assert_eq!(result.installation_id,session_provider);
        // A later data migration changing the session pin must not silently retain an incompatible binding.
        sqlx::query("UPDATE sessions SET plugin_installation_id=? WHERE id='session'").bind(application).execute(&fixture.db).await.unwrap();
        assert_eq!(fixture.broker.invoke("main",Request {scope:Scope::Session("session".into()),..request("ignored","stale",json!({"value":"session"}))}).await.unwrap_err().code,"provider_unavailable");
        fixture.finish().await;
    }
    #[test]
    fn request_json_cannot_supply_caller_identity_permissions_or_workspace_paths() {
        let valid = json!({"scope":{"kind":"workspace","id":"a"},"capability":CAP,"version":"1.0.0","requestId":"request","input":{"value":"a"}});
        assert!(serde_json::from_value::<Request>(valid.clone()).is_ok());
        for key in ["caller","permissions","workspacePath","generationId","installationId","deadlineUnixMs"] {
            let mut forged = valid.clone(); forged[key] = json!("forged");
            assert!(serde_json::from_value::<Request>(forged).is_err(),"{key}");
        }
    }
}
