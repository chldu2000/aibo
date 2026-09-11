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
    #[serde(default)]
    pub turn_id: Option<String>,
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
pub(crate) struct Response { pub instance_id: String, pub invocation_id: String, pub installation_id: String, pub generation_id: String, pub output: Value }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Provider {
    pub installation_id: String,
    pub contribution_id: String,
    pub plugin_id: String,
    pub version: String,
    #[serde(skip_serializing)] pub(crate) operation: Value,
    #[serde(skip_serializing)] manifest: Value,
    #[serde(skip_serializing)] directory: PathBuf,
    #[serde(skip_serializing)] digest: String,
}
const MAX_CALL_DEPTH: usize = 8;
const MAX_CHILD_CALLS: usize = 32;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallSite { invocation_id: String, installation_id: String, contribution_id: String }
#[derive(Clone)]
struct Chain {
    caller: String,
    sites: Vec<CallSite>,
    permissions: Vec<String>,
    deadline: Instant,
    deadline_ms: i64,
    cancellations: Vec<watch::Receiver<bool>>,
    ancestors: Vec<PluginRuntime>,
}
impl Chain {
    async fn cancelled(&self) {
        loop {
            if self.cancellations.iter().any(|cancel| *cancel.borrow() || cancel.has_changed().is_err()) || self.ancestors.iter().any(|runtime|runtime.was_stopped() || runtime.has_exited()) { return; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildRequest {
    invocation_id: String, generation_id: String, plugin_id: String,
    contribution_id: String, capability: String, version: String, input: Value,
}
struct Slot { id: String, permit: Arc<Semaphore>, runtime: Mutex<Option<PluginRuntime>>, touched: Mutex<Instant> }
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
    /// Cursor-based audit access; window ownership is supplied by trusted IPC.
    pub async fn events(&self, caller: &str, scope: &Scope, after: i64, limit: u32) -> Result<Vec<Value>, Failure> {
        Self::identity(scope,"audit","1.0.0")?;
        if after < 0 || limit == 0 || limit > 100 { return Err(fail("invalid_input", "Invalid event page")); }
        self.workspace(scope).await?;
        let (kind,id) = scope.key();
        let rows = sqlx::query("SELECT sequence,payload_json FROM capability_events WHERE caller_window=? AND scope_kind=? AND scope_id=? AND sequence>? ORDER BY sequence LIMIT ?")
            .bind(caller).bind(kind).bind(id).bind(after).bind(limit).fetch_all(&self.db).await.map_err(database)?;
        rows.into_iter().map(|row| {
            let mut event: Value = serde_json::from_str(row.get("payload_json")).map_err(database)?;
            event["sequence"] = json!(row.get::<i64,_>("sequence"));
            Ok(event)
        }).collect()
    }
    async fn validate_turn(&self, request: &Request) -> Result<(), Failure> {
        let Some(turn) = &request.turn_id else { return Ok(()); };
        if turn.is_empty() || turn.len() > 160 { return Err(fail("invalid_input", "Invalid turn identity")); }
        let owner: Option<(String,String)> = sqlx::query_as("SELECT t.session_id,s.workspace_id FROM turns t JOIN sessions s ON s.id=t.session_id WHERE t.id=?")
            .bind(turn).fetch_optional(&self.db).await.map_err(database)?;
        let allowed = owner.is_some_and(|(session,workspace)|match &request.scope {
            Scope::Application => false, Scope::Workspace(id) => *id == workspace, Scope::Session(id) => *id == session,
        });
        if !allowed { return Err(fail("permission_denied", "Turn does not belong to the invocation scope")); }
        Ok(())
    }
    fn identity(scope: &Scope, capability: &str, version: &str) -> Result<(), Failure> {
        if scope.key().1.is_empty() || scope.key().1.len() > 160 || capability.len() > 160 || capability.is_empty() || version.len() > 128 || semver::Version::parse(version).is_err() {
            return Err(fail("unsupported", "Invalid scope or capability version"));
        }
        Ok(())
    }
    pub async fn providers(&self, scope: &Scope, capability: &str, version: &str) -> Result<Vec<Provider>, Failure> {
        self.offers(scope,capability,version,None).await
    }
    async fn offers(&self, scope: &Scope, capability: &str, version: &str, installation: Option<&str>) -> Result<Vec<Provider>, Failure> {
        Self::identity(scope, capability, version)?;
        self.workspace(scope).await?;
        let rows = sqlx::query("SELECT id,plugin_id,manifest_json,install_path,package_digest FROM plugin_installations WHERE installed=1 AND enabled=1 AND (? IS NULL OR id=?)")
            .bind(installation).bind(installation).fetch_all(&self.db).await.map_err(database)?;
        let mut providers = vec![];
        let mut other_version = false;
        for row in rows {
            let manifest: Value = serde_json::from_str(row.get("manifest_json")).map_err(database)?;
            let model = plugin_manifest::normalize(&manifest).map_err(database)?;
            if model.version != 2 || !plugin_manifest::activation_issues(&manifest).map_err(database)?.is_empty() { continue; }
            if plugin_registry::dependency_diagnostics(&manifest).iter().any(|dependency|dependency.required && !dependency.available) { continue; }
            let dependencies = crate::plugin_dependencies::resolve(&self.db,row.get("id"),false).await.map_err(database)?;
            for contribution in model.contributions.iter().filter(|item|item.kind == "capabilityProvider" && plugin_manifest::contribution_supported(item,&manifest) && item.scope == scope.key().0 && dependencies.supports(&item.id)) {
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
    /// Host-selected semantic contribution binding; never accepts plugin-provided caller authority.
    pub(crate) async fn invoke_bound(&self, caller: &str, request: Request, binding: &Binding) -> Result<Response,Failure> {
        Self::identity(&request.scope,&request.capability,&request.version)?;
        if request.scope != binding.scope || request.capability != binding.capability || request.version != binding.version || request.input.to_string().len() > MAX_INPUT { return Err(fail("invalid_input", "Contribution binding mismatch")); }
        let provider = self.offers(&request.scope,&request.capability,&request.version,Some(&binding.installation_id)).await?.into_iter().find(|offer|offer.contribution_id == binding.contribution_id).ok_or_else(||fail("provider_unavailable", "Contribution provider is unavailable"))?;
        self.invoke_selected(caller,request,provider,None).await
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
        let (kind, scope_id) = scope.key();
        sqlx::query("INSERT INTO capability_instances(id,installation_id,contribution_id,scope_kind,scope_id,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(installation_id,contribution_id,scope_kind,scope_id) DO NOTHING")
            .bind(ulid::Ulid::new().to_string()).bind(&provider.installation_id).bind(&provider.contribution_id).bind(kind).bind(scope_id).bind(crate::now_iso()).execute(&self.db).await.map_err(database)?;
        let instance_id: String = sqlx::query_scalar("SELECT id FROM capability_instances WHERE installation_id=? AND contribution_id=? AND scope_kind=? AND scope_id=?")
            .bind(&provider.installation_id).bind(&provider.contribution_id).bind(kind).bind(scope_id).fetch_one(&self.db).await.map_err(database)?;
        let slot = Arc::new(Slot { id: instance_id, permit: Arc::new(Semaphore::new(1)), runtime: Mutex::new(None), touched: Mutex::new(Instant::now()) });
        slots.insert(key, slot.clone()); Ok(slot)
    }
    pub async fn invoke(&self, caller: &str, request: Request) -> Result<Response, Failure> {
        Self::identity(&request.scope,&request.capability,&request.version)?;
        if request.request_id.is_empty() || request.request_id.len() > 160 || request.input.to_string().len() > MAX_INPUT { return Err(fail("invalid_input", "Request size or identity limit")); }
        let provider = self.provider(&request).await?;
        self.invoke_selected(caller,request,provider,None).await
    }
    fn invoke_selected<'a>(&'a self, caller: &'a str, request: Request, provider: Provider, parent: Option<Chain>) -> std::pin::Pin<Box<dyn std::future::Future<Output=Result<Response,Failure>> + Send + 'a>> {
        Box::pin(async move {
        if provider.operation["effect"] != "read" { return Err(fail("permission_denied", "Write operations are not enabled in this runtime slice")); }
        let workspace = self.workspace(&request.scope).await?;
        self.validate_turn(&request).await?;
        if provider.operation["permissions"].as_array().unwrap().iter().any(|permission| permission != "workspace.read" || workspace.is_none()) { return Err(fail("permission_denied", "Operation requires an unavailable permission")); }
        if !jsonschema::options().build(&provider.operation["inputSchema"]).map_err(database)?.is_valid(&request.input) { return Err(fail("invalid_input", "Input does not match the capability contract")); }
        let permissions: Vec<String> = provider.operation["permissions"].as_array().unwrap().iter().map(|value|value.as_str().unwrap().to_owned()).collect();
        if let Some(parent) = &parent {
            if permissions.iter().any(|permission|!parent.permissions.contains(permission)) { return Err(fail("permission_denied", "Dependency call exceeds its caller permissions")); }
            if parent.sites.len() >= MAX_CALL_DEPTH || parent.sites.iter().any(|site|site.installation_id == provider.installation_id && site.contribution_id == provider.contribution_id) {
                return Err(fail("busy", "Dependency call cycle or depth limit"));
            }
        }
        let slot = self.slot(&provider,&request.scope).await?;
        let _permit = slot.permit.clone().try_acquire_owned().map_err(|_|fail("busy", "An invocation is already active in this scope"))?;
        let key = (caller.to_string(),request.request_id.clone());
        let (cancel,cancelled) = watch::channel(false);
        {
            let mut flights = self.flights.lock().await;
            if flights.len() >= MAX_ACTIVE || flights.contains_key(&key) { return Err(fail("busy", "Invocation limit or duplicate request ID")); }
            flights.insert(key.clone(),Flight { cancel, installation_id: provider.installation_id.clone(), contribution_id: provider.contribution_id.clone(), workspace_id: workspace.as_ref().map(|workspace|workspace.id.clone()) });
        }
        let id = ulid::Ulid::new().to_string();
        let timeout = Duration::from_millis(provider.operation["timeoutMs"].as_u64().unwrap());
        let deadline = Instant::now() + timeout;
        let deadline_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64 + timeout.as_millis() as i64;
        let mut chain = parent.clone().unwrap_or_else(||Chain { caller: caller.into(), sites: vec![], permissions: permissions.clone(), deadline, deadline_ms, cancellations: vec![], ancestors: vec![] });
        chain.permissions = permissions;
        chain.deadline = chain.deadline.min(deadline);
        chain.deadline_ms = chain.deadline_ms.min(deadline_ms);
        chain.cancellations.push(cancelled);
        chain.sites.push(CallSite { invocation_id: id.clone(), installation_id: provider.installation_id.clone(), contribution_id: provider.contribution_id.clone() });
        let (kind,scope_id) = request.scope.key();
        let insert = sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms,parent_invocation_id,root_invocation_id,caller_installation_id,instance_id,turn_id) VALUES(?,?,?,?,?,?,?,?,'running',?,?,?,?,?,?,?)")
            .bind(&id).bind(caller).bind(kind).bind(scope_id).bind(&request.capability).bind(&request.version).bind(&provider.installation_id).bind(&provider.contribution_id).bind(crate::now_iso()).bind(chain.deadline_ms).bind(parent.as_ref().and_then(|chain|chain.sites.last()).map(|site|&site.invocation_id)).bind(&chain.sites[0].invocation_id).bind(parent.as_ref().and_then(|chain|chain.sites.last()).map(|site|&site.installation_id)).bind(&slot.id).bind(&request.turn_id).execute(&self.db).await;
        if let Err(error) = insert { self.flights.lock().await.remove(&key); return Err(database(error)); }
        let mut result = self.execute(&id,&request,&provider,&slot,workspace.as_ref(),&chain).await;
        if result.is_err() { if let Some(runtime) = slot.runtime.lock().await.take() { runtime.stop().await; } }
        *slot.touched.lock().await = Instant::now();
        self.flights.lock().await.remove(&key);
        let status = match &result { Ok(_) => "completed", Err(error) => error.code.as_str() };
        sqlx::query("UPDATE capability_invocations SET status=?,finished_at=? WHERE id=?").bind(status).bind(crate::now_iso()).bind(&id).execute(&self.db).await.map_err(database)?;
        if let Err(error) = &mut result { error.invocation_id = Some(id); }
        result
        })
    }
    async fn execute(&self, id: &str, request: &Request, provider: &Provider, slot: &Slot, workspace: Option<&crate::Workspace>, chain: &Chain) -> Result<Response, Failure> {
        let prepare = async {
        let current: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plugin_installations WHERE id=? AND enabled=1 AND installed=1").bind(&provider.installation_id).fetch_one(&self.db).await.map_err(database)?;
        if current != 1 { return Err(fail("provider_unavailable", "Provider was disabled")); }
        let (_,_,digest) = plugin_registry::inspect(&provider.directory).map_err(|_|fail("provider_unavailable", "Installed package integrity check failed"))?;
        if digest != provider.digest { return Err(fail("provider_unavailable", "Installed package changed")); }
        let dependencies = crate::plugin_dependencies::resolve(&self.db,&provider.installation_id,true).await.map_err(database)?;
        if !dependencies.supports(&provider.contribution_id) { return Err(fail("provider_unavailable", "A pinned package dependency is unavailable")); }
        // Recheck scope authority immediately before giving a runtime its workspace.
        self.workspace(&request.scope).await?;
        self.validate_turn(request).await?;
        crate::git_capability_guard::check(&request.capability,&request.input,workspace.map(|workspace|workspace.path.as_str())).map_err(|_|fail("permission_denied", "Git target is outside the allowed workspace resources"))?;
        let mut active = slot.runtime.lock().await;
        if active.as_ref().is_some_and(|runtime|runtime.was_stopped() || runtime.has_exited()) { *active = None; }
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
        let private_data = crate::plugin_storage::directory(&provider.directory,&provider.plugin_id,&provider.installation_id,&slot.id).map_err(database)?;
        let handshake = runtime.request("capability.initialize",json!({"protocol":"2.0","instanceId":slot.id,"privateData":{"path":private_data,"formatVersion":1},"generationId":runtime.generation_id,"installationId":provider.installation_id,"pluginId":provider.plugin_id,"pluginVersion":provider.manifest["version"],"contributionId":provider.contribution_id}),Duration::from_secs(5)).await.map_err(transport)?;
        let expected = json!({"capability":request.capability,"version":request.version,"operationId":provider.operation["id"]});
        if handshake["protocol"] != "2.0" || handshake["pluginId"] != provider.plugin_id || handshake["pluginVersion"] != provider.manifest["version"] || handshake["generationId"] != runtime.generation_id || !handshake["operations"].as_array().is_some_and(|operations|operations.contains(&expected)) {
            return Err(fail("incompatible_version", "Runtime did not negotiate the declared operation"));
        }
        sqlx::query("UPDATE capability_invocations SET generation_id=? WHERE id=?").bind(&runtime.generation_id).bind(id).execute(&self.db).await.map_err(database)?;
        Ok::<_,Failure>(runtime)
        };
        let runtime = tokio::select! {
            biased;
            _ = chain.cancelled() => return Err(fail("cancelled", "Invocation was cancelled")),
            _ = tokio::time::sleep_until(chain.deadline.into()) => return Err(fail("timeout", "Invocation deadline expired")),
            runtime = prepare => runtime?,
        };
        let call = runtime.request("capability.invoke",json!({"invocationId":id,"instanceId":slot.id,"generationId":runtime.generation_id,"contributionId":provider.contribution_id,"capability":request.capability,"contractVersion":request.version,"operationId":provider.operation["id"],"scope":request.scope,"deadlineUnixMs":chain.deadline_ms,"context":{"turnId":request.turn_id,"workspaceId":workspace.filter(|_|chain.permissions.iter().any(|permission|permission == "workspace.read")).map(|workspace|&workspace.id),"workspacePath":workspace.filter(|_|chain.permissions.iter().any(|permission|permission == "workspace.read")).map(|workspace|&workspace.path),"originalCaller":{"kind":"window","id":chain.caller},"permissions":chain.permissions,"callChain":chain.sites},"input":request.input}),chain.deadline.saturating_duration_since(Instant::now()));
        tokio::pin!(call);
        let mut notifications = runtime.notifications.lock().await;
        let mut child_ids = std::collections::HashSet::new();
        let raw = loop {
            tokio::select! {
                biased;
                _ = chain.cancelled() => return Err(fail("cancelled", "Invocation was cancelled")),
                _ = tokio::time::sleep_until(chain.deadline.into()) => return Err(fail("timeout", "Invocation deadline expired")),
                raw = &mut call => break raw.map_err(transport)?,
                message = notifications.recv() => {
                    let message = message.ok_or_else(||fail("provider_unavailable", "Capability process exited"))?;
                    let child_id = message["id"].as_str().ok_or_else(||fail("invalid_input", "Missing child request ID"))?;
                    if message["method"] != "capability.call" || child_ids.len() >= MAX_CHILD_CALLS || !child_ids.insert(child_id.to_owned()) { return Err(fail("busy", "Duplicate child request or call count limit")); }
                    let result = self.child_call(&message["params"],id,&runtime,request,provider,chain).await;
                    // Failures are structured data, so no plugin-provided text is reflected.
                    let reply = match result { Ok(response) => json!({"ok":true,"response":response}), Err(error) => json!({"ok":false,"error":error}) };
                    tokio::select! {
                        biased;
                        _ = chain.cancelled() => return Err(fail("cancelled", "Invocation was cancelled")),
                        _ = tokio::time::sleep_until(chain.deadline.into()) => return Err(fail("timeout", "Invocation deadline expired")),
                        result = runtime.reply(message["id"].clone(),Ok(reply)) => result.map_err(transport)?,
                    }
                }
            }
        };
        if raw["invocationId"] != id || raw["generationId"] != runtime.generation_id || raw["output"].to_string().len() > MAX_OUTPUT || !raw.as_object().is_some_and(|object|object.len() == 3 && object.contains_key("output")) || !jsonschema::options().build(&provider.operation["outputSchema"]).map_err(database)?.is_valid(&raw["output"]) {
            return Err(fail("invalid_output", "Runtime returned a stale or invalid result"));
        }
        Ok(Response { instance_id: slot.id.clone(), invocation_id: id.into(), installation_id: provider.installation_id.clone(), generation_id: runtime.generation_id.clone(), output: raw["output"].clone() })
    }
    async fn child_call(&self, params: &Value, parent_id: &str, runtime: &PluginRuntime, request: &Request, provider: &Provider, chain: &Chain) -> Result<Response, Failure> {
        let child: ChildRequest = serde_json::from_value(params.clone()).map_err(|_|fail("invalid_input", "Invalid dependency call envelope"))?;
        if child.invocation_id != parent_id || child.generation_id != runtime.generation_id { return Err(fail("permission_denied", "Dependency call does not belong to this invocation")); }
        if child.input.to_string().len() > MAX_INPUT { return Err(fail("invalid_input", "Dependency input exceeds limit")); }
        let prepare = async {
            let dependencies = crate::plugin_dependencies::resolve(&self.db,&provider.installation_id,true).await.map_err(database)?;
            let dependency = dependencies.dependencies.iter().find(|dependency|dependency.plugin_id == child.plugin_id && dependency.contribution_ids.contains(&provider.contribution_id))
                .ok_or_else(||fail("permission_denied", "Calling contribution has not declared this dependency"))?;
            if !dependencies.supports(&provider.contribution_id) || !dependency.available { return Err(fail("provider_unavailable", "Pinned dependency is unavailable")); }
            let offers = self.offers(&request.scope,&child.capability,&child.version,dependency.installation_id.as_deref()).await?;
            offers.into_iter().find(|offer|Some(&offer.installation_id) == dependency.installation_id.as_ref() && offer.contribution_id == child.contribution_id)
                .ok_or_else(||fail("provider_unavailable", "Pinned dependency does not provide this contribution"))
        };
        let selected = tokio::select! {
            biased;
            _ = chain.cancelled() => return Err(fail("cancelled", "Invocation was cancelled")),
            _ = tokio::time::sleep_until(chain.deadline.into()) => return Err(fail("timeout", "Invocation deadline expired")),
            selected = prepare => selected?,
        };
        let mut child_chain = chain.clone();
        child_chain.ancestors.push(runtime.clone());
        // Children inherit scope and original identity; UI provider settings cannot reroute them.
        self.invoke_selected(&chain.caller,Request { turn_id: request.turn_id.clone(), scope: request.scope.clone(), capability: child.capability, version: child.version, request_id: ulid::Ulid::new().to_string(), input: child.input },selected,Some(child_chain)).await
    }

}
fn transport(error: String) -> Failure {
    let code = error.split(':').next().unwrap_or("");
    fail(match code { "busy" | "timeout" | "cancelled" | "unsupported" | "incompatible_version" | "permission_denied" | "invalid_output" | "invalid_input" => code, _ => "provider_unavailable" }, "Capability transport failed")
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
        async fn chain_package(&self, name: &str, dependency: Option<&str>, permissions: bool, timeout: u64) -> String {
            let path = self.root.join(name);
            fs::create_dir_all(&path).unwrap();
            let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/capability-echo/plugin.json")).unwrap();
            let plugin = format!("dev.aibo.{name}");
            manifest["pluginId"] = json!(plugin);
            manifest["contributions"][0]["id"] = json!(format!("{plugin}.read"));
            let op = &mut manifest["contributions"][0]["operations"][0];
            op["id"] = json!(format!("{plugin}.echo"));
            op["capability"]["id"] = json!(format!("{plugin}.echo"));
            op["permissions"] = if permissions {json!(["workspace.read"])} else {json!([])};
            op["timeoutMs"] = json!(timeout);
            op["inputSchema"]["properties"]["mode"] = json!({"enum":["normal","stale","undeclared","scope","parent-crash"]});
            op["outputSchema"]["properties"]["value"]["maxLength"] = json!(8192);
            if let Some(dependency) = dependency {
                manifest["packageDependencies"] = json!([{"pluginId":format!("dev.aibo.{dependency}"),"version":{"min":"1.0.0","maxExclusive":"2.0.0"},"required":true,"contributionIds":[format!("{plugin}.read")]}]);
            }
            fs::write(path.join("plugin.json"),manifest.to_string()).unwrap();
            fs::write(path.join("worker.mjs"),include_str!("../../fixtures/plugins/capability-chain/worker.mjs")).unwrap();
            let installed = plugin_registry::install(&self.db,&self.root.join("data"),&path).await.unwrap();
            plugin_registry::enable(&self.db,&installed.id,true).await.unwrap();
            installed.id
        }
        async fn chain_binding(&self, name: &str, installation: &str, workspace: &str) {
            self.broker.bind(Binding {scope:Scope::Workspace(workspace.into()),capability:format!("dev.aibo.{name}.echo"),version:"1.0.0".into(),installation_id:installation.into(),contribution_id:format!("dev.aibo.{name}.read")}).await.unwrap();
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
    fn request(scope: &str, id: &str, input: Value) -> Request { Request {turn_id:None,scope:Scope::Workspace(scope.into()),capability:CAP.into(),version:"1.0.0".into(),request_id:id.into(),input} }
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
        assert_eq!(result.instance_id,again.instance_id,"logical instance survives restart");
        restarted.stop_installation(&fixture.installation).await.unwrap();
        fixture.finish().await;
    }
    #[tokio::test]
    async fn cache_limit_eviction_and_crash_preserve_scope_identity_and_isolation() {
        let f=Fixture::new().await;
        for scope in ["a","b"] { f.bind(Scope::Workspace(scope.into()),&f.installation).await; }
        let first=f.broker.invoke("main",request("a","first",json!({"value":"first"}))).await.unwrap();
        let provider=f.broker.provider(&request("a","lookup",json!({"value":"ok"}))).await.unwrap();
        for index in 1..MAX_INSTANCES {f.broker.slot(&provider,&Scope::Workspace(format!("cache-{index}"))).await.unwrap();}
        assert_eq!(f.broker.slot(&provider,&Scope::Workspace("overflow".into())).await.err().unwrap().code,"busy");
        let slot=f.broker.slot(&provider,&Scope::Workspace("a".into())).await.unwrap();
        let old_runtime=slot.runtime.lock().await.clone().unwrap();
        *slot.touched.lock().await=Instant::now()-IDLE_TTL-Duration::from_secs(1);
        // Reopening an expired instance evicts its process but keeps persisted identity.
        let reopened=f.broker.invoke("main",request("a","reopen",json!({"value":"ok"}))).await.unwrap();
        assert_eq!(first.instance_id,reopened.instance_id);
        assert_ne!(first.generation_id,reopened.generation_id);
        assert!(old_runtime.was_stopped());
        f.broker.stop_installation(&f.installation).await.unwrap();
        let other={let broker=f.broker.clone();tokio::spawn(async move {broker.invoke("main",request("b","other",json!({"value":"keep","delayMs":500}))).await})};
        running(&f,1).await;
        assert_eq!(f.broker.invoke("main",request("a","crash",json!({"value":"crash","mode":"crash"}))).await.unwrap_err().code,"provider_unavailable");
        assert_eq!(other.await.unwrap().unwrap().output["value"],"keep");
        f.finish().await;
    }

    #[tokio::test]
    async fn lifecycle_events_are_snapshots_scoped_and_recover_once() {
        let f = Fixture::new().await;
        f.bind(Scope::Workspace("a".into()),&f.installation).await;
        f.bind(Scope::Workspace("b".into()),&f.installation).await;
        let a = f.broker.invoke("main",request("a","a",json!({"value":"secret input"}))).await.unwrap();
        let b = f.broker.invoke("main",request("b","b",json!({"value":"b"}))).await.unwrap();
        assert_ne!(a.instance_id,b.instance_id);
        let events = f.broker.events("main",&Scope::Workspace("a".into()),0,100).await.unwrap();
        assert_eq!(events.len(),3);
        assert_eq!(events.iter().map(|e|e["type"].as_str().unwrap()).collect::<Vec<_>>(),["admitted","started","finished"]);
        assert_eq!(events[0]["generationId"],Value::Null,"admission must not be rewritten by a later generation");
        assert_eq!(events[1]["generationId"],a.generation_id);
        assert_eq!(events[2]["status"],"completed");
        let schema: Value = serde_json::from_str(include_str!("../../contracts/capability-event.v1.schema.json")).unwrap();
        let validator = jsonschema::options().build(&schema).unwrap();
        for event in &events { assert!(validator.is_valid(event),"{event}"); assert!(!event.to_string().contains("secret input")); }
        assert!(f.broker.events("other",&Scope::Workspace("a".into()),0,100).await.unwrap().is_empty());
        assert_eq!(f.broker.events("main",&Scope::Workspace("a".into()),events[0]["sequence"].as_i64().unwrap(),1).await.unwrap(),vec![events[1].clone()]);
        assert!(f.broker.events("main",&Scope::Workspace("a".into()),-1,100).await.is_err());
        assert!(f.broker.events("main",&Scope::Workspace("a".into()),0,101).await.is_err());
        // Simulate a persisted invocation left running by an earlier app process.
        sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms) VALUES('orphan','main','workspace','a',?,'1.0.0',?,?,'running',?,0)")
            .bind(CAP).bind(&f.installation).bind(CONTRIBUTION).bind(crate::now_iso()).execute(&f.db).await.unwrap();
        Broker::recover(&f.db).await.unwrap();
        Broker::recover(&f.db).await.unwrap();
        let recovered = f.broker.events("main",&Scope::Workspace("a".into()),events[2]["sequence"].as_i64().unwrap(),100).await.unwrap();
        assert_eq!(recovered.len(),2);
        assert_eq!(recovered[1]["status"],"interrupted");
        assert_eq!(recovered[1]["instanceId"],Value::Null,"old audit rows need no fabricated instance");
        for event in &recovered { assert!(validator.is_valid(event)); }
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='a'").execute(&f.db).await.unwrap();
        assert_eq!(f.broker.events("main",&Scope::Workspace("a".into()),0,100).await.unwrap_err().code,"permission_denied");
        f.finish().await;
    }

    #[tokio::test]
    async fn turn_correlation_is_validated_and_inherited_by_dependencies() {
        let f = Fixture::new().await;
        let leaf = f.chain_package("leaf",None,true,5000).await;
        let parent = f.chain_package("parent",Some("leaf"),true,5000).await;
        f.chain_binding("parent",&parent,"a").await;
        f.chain_binding("parent",&parent,"b").await;
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('session','a','test','session','idle',?,?)")
            .bind(crate::now_iso()).bind(crate::now_iso()).execute(&f.db).await.unwrap();
        sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,started_at) VALUES('turn','session','external','completed',?)")
            .bind(crate::now_iso()).execute(&f.db).await.unwrap();
        let req = Request { turn_id:Some("turn".into()),..chain_request("a","parent","turn-call",json!({"value":"hello"})) };
        let result = f.broker.invoke("main",req.clone()).await.unwrap();
        let rows: Vec<(String,Option<String>)> = sqlx::query_as("SELECT installation_id,turn_id FROM capability_invocations WHERE root_invocation_id=?")
            .bind(&result.invocation_id).fetch_all(&f.db).await.unwrap();
        assert_eq!(rows.len(),2);
        assert!(rows.contains(&(leaf,Some("turn".into()))));
        assert!(rows.iter().all(|(_,turn)|turn.as_deref()==Some("turn")));
        let denied = Request {scope:Scope::Workspace("b".into()),..req.clone()};
        assert_eq!(f.broker.invoke("main",denied).await.unwrap_err().code,"permission_denied");
        assert_eq!(f.broker.validate_turn(&Request {scope:Scope::Application,..req.clone()}).await.unwrap_err().code,"permission_denied");
        assert_eq!(f.broker.validate_turn(&Request {scope:Scope::Session("different".into()),..req.clone()}).await.unwrap_err().code,"permission_denied");
        f.broker.validate_turn(&Request {scope:Scope::Session("session".into()),..req.clone()}).await.unwrap();
        assert_eq!(f.broker.validate_turn(&Request {turn_id:Some("missing".into()),..req}).await.unwrap_err().code,"permission_denied");
        let events = f.broker.events("main",&Scope::Workspace("a".into()),0,100).await.unwrap();
        assert_eq!(events.len(),6);
        assert!(events.iter().all(|event|event["turnId"]=="turn"));
        let agent_events: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_events").fetch_one(&f.db).await.unwrap();
        assert_eq!(agent_events,0);
        f.finish().await;
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
    fn chain_request(workspace: &str, name: &str, id: &str, input: Value) -> Request {
        Request {capability:format!("dev.aibo.{name}.echo"),..request(workspace,id,input)}
    }
    #[tokio::test]
    async fn dependency_chain_preserves_identity_scope_release_and_audit() {
        let fixture = Fixture::new().await;
        let leaf = fixture.chain_package("leaf",None,true,5000).await;
        let middle = fixture.chain_package("middle",Some("leaf"),true,4000).await;
        let parent = fixture.chain_package("parent",Some("middle"),true,3000).await;
        fixture.chain_binding("parent",&parent,"a").await;
        let source = fixture.root.join("leaf");
        let mut manifest: Value = serde_json::from_str(&fs::read_to_string(source.join("plugin.json")).unwrap()).unwrap();
        manifest["version"] = json!("1.1.0");
        fs::write(source.join("plugin.json"),manifest.to_string()).unwrap();
        let newer = plugin_registry::install(&fixture.db,&fixture.root.join("data"),&source).await.unwrap();
        plugin_registry::enable(&fixture.db,&newer.id,true).await.unwrap();
        fixture.chain_binding("leaf",&newer.id,"a").await;
        // The child uses its dependency pin even when the UI binds a newer leaf release.
        // Middle has no UI provider binding at all.
        let response = fixture.broker.invoke("original-window",chain_request("a","parent","chain",json!({"value":"chain"}))).await.unwrap();
        let output: Value = serde_json::from_str(response.output["value"].as_str().unwrap()).unwrap();
        assert_eq!(output["caller"],json!({"kind":"window","id":"original-window"}));
        assert_eq!(output["chain"].as_array().unwrap().iter().map(|site|site["installationId"].as_str().unwrap()).collect::<Vec<_>>(),vec![parent.as_str(),middle.as_str(),leaf.as_str()]);
        assert_eq!(response.output["workspacePath"],fixture.root.join("a").to_string_lossy().as_ref());
        let rows = sqlx::query("SELECT * FROM capability_invocations ORDER BY started_at").fetch_all(&fixture.db).await.unwrap();
        assert_eq!(rows.len(),3);
        for row in &rows {
            assert_eq!(row.get::<String,_>("caller_window"),"original-window");
            assert_eq!(row.get::<String,_>("root_invocation_id"),response.invocation_id);
            assert_eq!(row.get::<i64,_>("deadline_ms"),rows[0].get::<i64,_>("deadline_ms"));
            assert_eq!(row.get::<String,_>("status"),"completed");
        }
        assert_eq!(rows[1].get::<String,_>("parent_invocation_id"),response.invocation_id);
        assert_eq!(rows[1].get::<String,_>("caller_installation_id"),parent);
        fixture.finish().await;
    }
    #[tokio::test]
    async fn dependency_calls_reject_forgery_and_permission_amplification() {
        let fixture = Fixture::new().await;
        fixture.chain_package("leaf",None,true,3000).await;
        let parent = fixture.chain_package("parent",Some("leaf"),true,3000).await;
        fixture.chain_binding("parent",&parent,"a").await;
        for (mode,code) in [("stale","permission_denied"),("undeclared","permission_denied"),("scope","provider_unavailable")] {
            assert_eq!(fixture.broker.invoke("main",chain_request("a","parent",mode,json!({"value":"bad","mode":mode}))).await.unwrap_err().code,code);
        }
        let weak = fixture.chain_package("weak",Some("leaf"),false,3000).await;
        fixture.chain_binding("weak",&weak,"a").await;
        assert_eq!(fixture.broker.invoke("main",chain_request("a","weak","denied",json!({"value":"bad"}))).await.unwrap_err().code,"permission_denied");
        let children: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE parent_invocation_id IS NOT NULL").fetch_one(&fixture.db).await.unwrap();
        assert_eq!(children,0);
        fixture.finish().await;
    }
    #[tokio::test]
    async fn parent_cancellation_drains_descendants_and_preserves_other_workspace() {
        let fixture = Fixture::new().await;
        fixture.chain_package("leaf",None,true,5000).await;
        let parent = fixture.chain_package("parent",Some("leaf"),true,5000).await;
        for workspace in ["a","b"] {fixture.chain_binding("parent",&parent,workspace).await;}
        let first = {let broker=fixture.broker.clone();tokio::spawn(async move {broker.invoke("main",chain_request("a","parent","cancel",json!({"value":"cancel","delayMs":1000}))).await})};
        let second = {let broker=fixture.broker.clone();tokio::spawn(async move {broker.invoke("main",chain_request("b","parent","keep",json!({"value":"keep","delayMs":1000}))).await})};
        running(&fixture,4).await;
        assert!(!fixture.broker.cancel("other","cancel").await);
        assert!(fixture.broker.cancel("main","cancel").await);
        assert_eq!(first.await.unwrap().unwrap_err().code,"cancelled");
        let statuses: Vec<String> = sqlx::query_scalar("SELECT status FROM capability_invocations WHERE scope_id='a'").fetch_all(&fixture.db).await.unwrap();
        assert_eq!(statuses,vec!["cancelled","cancelled"]);
        assert!(second.await.unwrap().is_ok());
        fixture.finish().await;
    }
    #[tokio::test]
    async fn parent_deadline_and_crash_stop_children_without_running_audit_leaks() {
        let fixture = Fixture::new().await;
        fixture.chain_package("leaf",None,true,5000).await;
        let parent = fixture.chain_package("parent",Some("leaf"),true,700).await;
        fixture.chain_binding("parent",&parent,"a").await;
        assert_eq!(fixture.broker.invoke("main",chain_request("a","parent","timeout",json!({"value":"slow","delayMs":5000}))).await.unwrap_err().code,"timeout");
        assert_eq!(fixture.broker.invoke("main",chain_request("a","parent","crash",json!({"value":"slow","mode":"parent-crash","delayMs":5000}))).await.unwrap_err().code,"provider_unavailable");
        let running: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE status='running'").fetch_one(&fixture.db).await.unwrap();
        assert_eq!(running,0);
        let children: Vec<String> = sqlx::query_scalar("SELECT status FROM capability_invocations WHERE parent_invocation_id IS NOT NULL ORDER BY started_at").fetch_all(&fixture.db).await.unwrap();
        assert_eq!(children,vec!["timeout","cancelled"]);
        assert!(fixture.broker.flights.lock().await.is_empty());
        fixture.finish().await;
    }
    #[tokio::test]
    async fn dependency_call_depth_is_bounded_and_permissionless_context_has_no_path() {
        let fixture = Fixture::new().await;
        let mut last = String::new();
        for index in (0..9).rev() {
            let dependency = (index < 8).then(||format!("depth{}",index+1));
            last=fixture.chain_package(&format!("depth{index}"),dependency.as_deref(),false,15000).await;
        }
        fixture.chain_binding("depth0",&last,"a").await;
        assert_eq!(fixture.broker.invoke("main",chain_request("a","depth0","depth",json!({"value":"deep"}))).await.unwrap_err().code,"busy");
        let leaf: String = sqlx::query_scalar("SELECT id FROM plugin_installations WHERE plugin_id='dev.aibo.depth8'").fetch_one(&fixture.db).await.unwrap();
        fixture.chain_binding("depth8",&leaf,"a").await;
        let result=fixture.broker.invoke("main",chain_request("a","depth8","no-path",json!({"value":"none"}))).await.unwrap();
        assert_eq!(result.output["workspacePath"],Value::Null);
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
