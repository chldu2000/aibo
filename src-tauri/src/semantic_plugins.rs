//! Installed JSON semantic contributions. Identity, leases and actions belong to the host.
use crate::{
    capability_broker::{Binding, Broker, Request, Scope},
    plugin_dependencies, plugin_manifest,
};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
const TTL: Duration = Duration::from_secs(1800);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Contribution {
    pub installation_id: String,
    pub contribution_id: String,
    pub title: String,
    pub available: bool,
    pub issue: Option<String>,
    #[serde(skip)]
    metadata: Value,
}
pub(crate) async fn catalog(db: &SqlitePool) -> Result<Vec<Contribution>, String> {
    let rows=sqlx::query("SELECT id,manifest_json FROM plugin_installations WHERE installed=1 AND enabled=1 ORDER BY plugin_id,created_at,id").fetch_all(db).await.map_err(|e|e.to_string())?;
    let mut result = vec![];
    for row in rows {
        let manifest: Value =
            serde_json::from_str(row.get("manifest_json")).map_err(|e| e.to_string())?;
        let model = plugin_manifest::normalize(&manifest)?;
        if model.version != 2 || !plugin_manifest::activation_issues(&manifest)?.is_empty() {
            continue;
        }
        let dependencies = plugin_dependencies::resolve(db, row.get("id"), false).await?;
        for contribution in model.contributions.into_iter().filter(|entry| {
            entry.kind == "semanticView"
                && plugin_manifest::semantic_supported(&entry.metadata, &manifest)
        }) {
            let available = dependencies.supports(&contribution.id);
            result.push(Contribution {
                installation_id: row.get("id"),
                contribution_id: contribution.id,
                title: contribution.metadata["title"].as_str().unwrap().into(),
                available,
                issue: (!available).then(|| "依赖不可用".into()),
                metadata: contribution.metadata,
            });
        }
    }
    Ok(result)
}
struct ViewState {
    snapshot: Value,
    touched: Instant,
}
struct Lease {
    owner: String,
    open_request: Option<String>,
    contribution: Contribution,
    binding: Binding,
    generation: String,
    released: AtomicBool,
    state: Mutex<ViewState>,
}
#[derive(Default, Clone)]
pub(crate) struct SemanticPlugins {
    leases: Arc<Mutex<HashMap<String, Arc<Lease>>>>,
}
fn validate(snapshot: &Value) -> Result<(), String> {
    static SCHEMA: OnceLock<jsonschema::Validator> = OnceLock::new();
    let validator = SCHEMA.get_or_init(|| {
        jsonschema::validator_for(
            &serde_json::from_str::<Value>(include_str!(
                "../../contracts/semantic-view.experimental-v1.schema.json"
            ))
            .unwrap(),
        )
        .unwrap()
    });
    if snapshot.to_string().len() > 262_144 || !validator.is_valid(snapshot) {
        return Err("invalid_output: semantic snapshot".into());
    }
    let actions = snapshot["actions"].as_array().unwrap();
    if actions
        .iter()
        .map(|a| a["id"].as_str().unwrap())
        .collect::<HashSet<_>>()
        .len()
        != actions.len()
    {
        return Err("invalid_output: duplicate action".into());
    }
    if snapshot["view"]["kind"] == "collection" {
        let view = &snapshot["view"];
        let items = view["items"].as_array().unwrap();
        let properties = view["properties"].as_array().unwrap();
        let keys: HashSet<_> = properties
            .iter()
            .map(|p| p["key"].as_str().unwrap())
            .collect();
        if keys.len() != properties.len()
            || items
                .iter()
                .map(|i| i["id"].as_str().unwrap())
                .collect::<HashSet<_>>()
                .len()
                != items.len()
            || view["page"]["offset"].as_u64().unwrap() + items.len() as u64
                > view["page"]["total"].as_u64().unwrap()
        {
            return Err("invalid_output: collection identity or pagination".into());
        }
        for item in items {
            if item["values"].as_object().unwrap().len() != keys.len()
                || properties.iter().any(|p| {
                    item["values"].get(p["key"].as_str().unwrap()).is_none()
                        || (p["type"] == "enum"
                            && !p["values"]
                                .as_array()
                                .unwrap()
                                .contains(&item["values"][p["key"].as_str().unwrap()]))
                })
            {
                return Err("invalid_output: collection values".into());
            }
        }
        if !view["selection"].is_null() && !items.iter().any(|i| i["id"] == view["selection"]) {
            return Err("invalid_output: selection".into());
        }
    }
    Ok(())
}
impl SemanticPlugins {
    pub async fn open(
        &self,
        db: &SqlitePool,
        broker: &Broker,
        owner: &str,
        workspace: &str,
        installation: &str,
        contribution: &str,
    ) -> Result<Value, String> {
        self.open_requested(
            db,
            broker,
            owner,
            workspace,
            installation,
            contribution,
            None,
        )
        .await
    }
    async fn open_requested(
        &self,
        db: &SqlitePool,
        broker: &Broker,
        owner: &str,
        workspace: &str,
        installation: &str,
        contribution: &str,
        request_id: Option<String>,
    ) -> Result<Value, String> {
        if request_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 160)
        {
            return Err("invalid_input: open request ID".into());
        }
        let selected = catalog(db)
            .await?
            .into_iter()
            .find(|item| {
                item.installation_id == installation
                    && item.contribution_id == contribution
                    && item.available
            })
            .ok_or("provider_unavailable: semantic contribution")?;
        let dependencies = plugin_dependencies::resolve(db, installation, true).await?;
        let mut allowed = vec![installation.to_owned()];
        allowed.extend(
            dependencies
                .dependencies
                .iter()
                .filter(|d| d.available && d.contribution_ids.contains(&selected.contribution_id))
                .filter_map(|d| d.installation_id.clone()),
        );
        let scope = Scope::Workspace(workspace.into());
        let capability = selected.metadata["provider"]["capability"]
            .as_str()
            .unwrap()
            .to_owned();
        let version = selected.metadata["provider"]["version"]["min"]
            .as_str()
            .unwrap()
            .to_owned();
        let offers = broker
            .providers(&scope, &capability, &version)
            .await
            .map_err(|e| e.code)?
            .into_iter()
            .filter(|offer| {
                allowed.contains(&offer.installation_id)
                    && offer.operation["id"] == selected.metadata["provider"]["operation"]
            })
            .collect::<Vec<_>>();
        if offers.len() != 1 {
            return Err(if offers.is_empty() {
                "provider_unavailable"
            } else {
                "provider_selection_required"
            }
            .into());
        }
        let provider = &offers[0];
        let generation = ulid::Ulid::new().to_string();
        let lease = Arc::new(Lease {
            owner: owner.into(),
            open_request: request_id,
            contribution: selected,
            binding: Binding {
                scope,
                capability: capability.into(),
                version: version.into(),
                installation_id: provider.installation_id.clone(),
                contribution_id: provider.contribution_id.clone(),
            },
            generation: generation.clone(),
            released: AtomicBool::new(false),
            state: Mutex::new(ViewState {
                snapshot: Value::Null,
                touched: Instant::now(),
            }),
        });
        {
            let mut leases = self.leases.lock().await;
            leases.retain(|_, lease| {
                !lease.released.load(Ordering::Acquire)
                    && lease
                        .state
                        .try_lock()
                        .map(|state| state.touched.elapsed() < TTL)
                        .unwrap_or(true)
            });
            if lease.open_request.is_some()
                && leases
                    .values()
                    .any(|old| old.owner == owner && old.open_request == lease.open_request)
            {
                return Err("busy: duplicate open request".into());
            }
            if leases.len() >= 128 {
                return Err("busy: semantic instance limit".into());
            }
            leases.insert(generation.clone(), lease.clone());
        }
        let result = self
            .query(db, broker, &lease, "refresh", None, 0, None)
            .await;
        if result.is_err() {
            self.leases.lock().await.remove(&generation);
        }
        result
    }
    async fn query(
        &self,
        db: &SqlitePool,
        broker: &Broker,
        lease: &Lease,
        action: &str,
        item: Option<&str>,
        offset: u64,
        expected: Option<Value>,
    ) -> Result<Value, String> {
        let mut state = lease
            .state
            .try_lock()
            .map_err(|_| "busy: semantic action")?;
        if expected
            .as_ref()
            .is_some_and(|context| &state.snapshot["context"] != context)
        {
            return Err("stale_context: action revision".into());
        }
        if lease.released.load(Ordering::Acquire) || state.touched.elapsed() > TTL {
            return Err("stale_context: released view".into());
        }
        if !catalog(db).await?.iter().any(|entry| {
            entry.installation_id == lease.contribution.installation_id
                && entry.contribution_id == lease.contribution.contribution_id
                && entry.available
        }) {
            return Err("provider_unavailable: semantic contribution".into());
        }
        let request = Request {
            scope: lease.binding.scope.clone(),
            capability: lease.binding.capability.clone(),
            version: lease.binding.version.clone(),
            request_id: format!("semantic:{}", lease.generation),
            input: json!({"actionId":action,"itemId":item,"offset":offset}),
        };
        let invocation = broker.invoke_bound(&lease.owner, request, &lease.binding);
        tokio::pin!(invocation);
        let output = loop {
            tokio::select! {
                result=&mut invocation=>break result.map_err(|e|e.code)?.output,
                _=tokio::time::sleep(Duration::from_millis(20))=>{
                    if lease.released.load(Ordering::Acquire) {broker.cancel(&lease.owner,&format!("semantic:{}",lease.generation)).await;}
                }
            }
        };
        if lease.released.load(Ordering::Acquire) {
            return Err("cancelled: released view".into());
        }
        let Scope::Workspace(workspace) = &lease.binding.scope else {
            return Err("invalid scope".into());
        };
        let snapshot = json!({"schema":"aibo.semantic-view/experimental-v1","context":{"workspaceId":workspace,"contributionId":lease.contribution.contribution_id,"generation":lease.generation,"revision":state.snapshot["context"]["revision"].as_u64().unwrap_or(0)+1},"contribution":{"id":lease.contribution.contribution_id,"title":lease.contribution.title,"extensionPoint":"workspace.tool"},"state":output["state"],"view":output["view"],"actions":output["actions"]});
        validate(&snapshot)?;
        state.snapshot = snapshot.clone();
        state.touched = Instant::now();
        Ok(snapshot)
    }
    pub async fn act(
        &self,
        db: &SqlitePool,
        broker: &Broker,
        owner: &str,
        action: crate::semantic_git::Action,
    ) -> Result<Value, String> {
        let lease = self
            .leases
            .lock()
            .await
            .get(&action.context.generation)
            .cloned()
            .ok_or("stale_context: unknown view")?;
        if lease.owner != owner {
            return Err("permission_denied: view owner".into());
        }
        let offset = {
            let state = lease
                .state
                .try_lock()
                .map_err(|_| "busy: semantic action")?;
            if state.snapshot["context"] != serde_json::to_value(&action.context).unwrap() {
                return Err("stale_context: action revision".into());
            }
            if !state.snapshot["actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["id"] == action.action_id && a["enabled"] == true)
            {
                return Err("unsupported: disabled action".into());
            }
            if action.action_id == "open-diff" {
                if !state.snapshot["view"]["items"]
                    .as_array()
                    .is_some_and(|items| {
                        items
                            .iter()
                            .any(|item| item["id"].as_str() == action.item_id.as_deref())
                    })
                {
                    return Err("invalid_input: selection".into());
                }
            } else if action.item_id.is_some() {
                return Err("invalid_input: unexpected item".into());
            }
            let offset = state.snapshot["view"]["page"]["offset"]
                .as_u64()
                .unwrap_or(0);
            match action.action_id.as_str() {
                "next" => offset + 50,
                "previous" => offset.saturating_sub(50),
                "refresh" | "back" => 0,
                _ => offset,
            }
        };
        self.query(
            db,
            broker,
            &lease,
            &action.action_id,
            action.item_id.as_deref(),
            offset,
            Some(serde_json::to_value(&action.context).unwrap()),
        )
        .await
    }
    pub async fn release(
        &self,
        broker: &Broker,
        owner: &str,
        generation: &str,
    ) -> Result<(), String> {
        let mut leases = self.leases.lock().await;
        if let Some(lease) = leases.get(generation) {
            if lease.owner != owner {
                return Err("permission_denied: view owner".into());
            }
            lease.released.store(true, Ordering::Release);
            broker
                .cancel(owner, &format!("semantic:{generation}"))
                .await;
        }
        leases.remove(generation);
        Ok(())
    }
    async fn cancel_open(
        &self,
        broker: &Broker,
        owner: &str,
        request_id: &str,
    ) -> Result<(), String> {
        let generation = self
            .leases
            .lock()
            .await
            .values()
            .find(|lease| lease.owner == owner && lease.open_request.as_deref() == Some(request_id))
            .map(|lease| lease.generation.clone());
        if let Some(generation) = generation {
            self.release(broker, owner, &generation).await?;
        }
        Ok(())
    }
    pub async fn invalidate(
        &self,
        broker: &Broker,
        installation: &str,
        contributions: Option<&[String]>,
    ) {
        let leases = self
            .leases
            .lock()
            .await
            .values()
            .filter(|lease| {
                lease.contribution.installation_id == installation
                    && contributions.map_or(true, |ids| {
                        ids.contains(&lease.contribution.contribution_id)
                    })
            })
            .cloned()
            .collect::<Vec<_>>();
        for lease in leases {
            let _ = self.release(broker, &lease.owner, &lease.generation).await;
        }
    }
}
#[tauri::command]
pub(crate) async fn list_semantic_contributions(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<Contribution>, String> {
    catalog(&state.db).await
}
#[tauri::command]
pub(crate) async fn open_semantic_contribution(
    workspace_id: String,
    installation_id: String,
    contribution_id: String,
    request_id: Option<String>,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Value, String> {
    state
        .semantic_plugins
        .open_requested(
            &state.db,
            &state.capability_broker,
            window.label(),
            &workspace_id,
            &installation_id,
            &contribution_id,
            request_id,
        )
        .await
}
#[tauri::command]
pub(crate) async fn act_semantic_contribution(
    action: crate::semantic_git::Action,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Value, String> {
    state
        .semantic_plugins
        .act(&state.db, &state.capability_broker, window.label(), action)
        .await
}
#[tauri::command]
pub(crate) async fn release_semantic_contribution(
    generation: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state
        .semantic_plugins
        .release(&state.capability_broker, window.label(), &generation)
        .await
}

#[tauri::command]
pub(crate) async fn cancel_semantic_open(
    request_id: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state
        .semantic_plugins
        .cancel_open(&state.capability_broker, window.label(), &request_id)
        .await
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
    };
    struct Fixture {
        root: PathBuf,
        db: SqlitePool,
        broker: Broker,
        host: SemanticPlugins,
        git: String,
        view: String,
    }
    impl Fixture {
        async fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("aibo-installed-git-{}", ulid::Ulid::new()));
            fs::create_dir_all(root.join("workspace")).unwrap();
            assert!(Command::new("git")
                .args(["init", "-q"])
                .arg(root.join("workspace"))
                .status()
                .unwrap()
                .success());
            fs::write(root.join("workspace/one.txt"), "hello from installed Git\n").unwrap();
            let db = crate::open_database(&root.join("data/aibo.sqlite3"))
                .await
                .unwrap();
            sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Git',1,?,?)").bind(root.join("workspace").to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
            let base = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
            let git = crate::plugin_registry::install(
                &db,
                &root.join("data"),
                &base.join("fixtures/plugins/git-read"),
            )
            .await
            .unwrap();
            assert!(git.runnable, "{:?}", git.activation_issues);
            crate::plugin_registry::enable(&db, &git.id, true)
                .await
                .unwrap();
            let view = crate::plugin_registry::install(
                &db,
                &root.join("data"),
                &base.join("fixtures/plugins/git-view"),
            )
            .await
            .unwrap();
            crate::plugin_registry::enable(&db, &view.id, true)
                .await
                .unwrap();
            Self {
                root,
                broker: Broker::new(db.clone()),
                db,
                host: SemanticPlugins::default(),
                git: git.id,
                view: view.id,
            }
        }
        async fn open(&self) -> Value {
            self.host
                .open(
                    &self.db,
                    &self.broker,
                    "main",
                    "w",
                    &self.git,
                    "dev.aibo.git.workspace",
                )
                .await
                .unwrap()
        }
        async fn call(
            &self,
            cap: &str,
            input: Value,
        ) -> Result<crate::capability_broker::Response, crate::capability_broker::Failure> {
            let binding = Binding {
                scope: Scope::Workspace("w".into()),
                capability: format!("dev.aibo.git.{cap}"),
                version: "1.0.0".into(),
                installation_id: self.git.clone(),
                contribution_id: "dev.aibo.git.read".into(),
            };
            self.broker.bind(binding).await.unwrap();
            self.broker
                .invoke(
                    "main",
                    Request {
                        scope: Scope::Workspace("w".into()),
                        capability: format!("dev.aibo.git.{cap}"),
                        version: "1.0.0".into(),
                        request_id: ulid::Ulid::new().to_string(),
                        input,
                    },
                )
                .await
        }
        async fn finish(self) {
            self.broker.stop_installation(&self.git).await.unwrap();
            self.db.close().await;
            fs::remove_dir_all(self.root).unwrap();
        }
    }
    fn action(snapshot: &Value, id: &str, item: Option<&str>) -> crate::semantic_git::Action {
        serde_json::from_value(json!({"context":snapshot["context"],"actionId":id,"itemId":item}))
            .unwrap()
    }
    #[tokio::test]
    async fn installed_git_runs_without_agent_or_view_and_rejects_path_escape() {
        let fixture = Fixture::new().await;
        let result = fixture.call("changes", json!({})).await.unwrap();
        assert_eq!(result.output["items"][0]["path"], "one.txt");
        let result = fixture
            .call("diff", json!({"path":"one.txt","staged":false}))
            .await
            .unwrap();
        assert!(result.output["content"]
            .as_str()
            .unwrap()
            .contains("hello from installed Git"));
        assert_eq!(
            fixture
                .call("diff", json!({"path":"one.txt","staged":true}))
                .await
                .unwrap()
                .output["content"],
            ""
        );
        for path in ["../secret", "/etc/passwd", ".git/config"] {
            assert_eq!(
                fixture
                    .call("diff", json!({"path":path,"staged":false}))
                    .await
                    .unwrap_err()
                    .code,
                "permission_denied"
            );
        }
        for table in ["sessions", "agent_events"] {
            assert_eq!(
                sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                    .fetch_one(&fixture.db)
                    .await
                    .unwrap(),
                0
            );
        }
        fixture.finish().await;
    }
    #[tokio::test]
    async fn bundled_and_separate_views_render_with_host_owned_identity_and_strict_actions() {
        let fixture = Fixture::new().await;
        assert_eq!(catalog(&fixture.db).await.unwrap().len(), 2);
        let snapshot = fixture.open().await;
        assert_eq!(snapshot["view"]["items"][0]["values"]["path"], "one.txt");
        let inspect = action(&snapshot, "open-diff", Some("worktree:one.txt"));
        assert!(fixture
            .host
            .act(&fixture.db, &fixture.broker, "other", inspect.clone())
            .await
            .unwrap_err()
            .contains("permission_denied"));
        assert!(fixture
            .host
            .act(
                &fixture.db,
                &fixture.broker,
                "main",
                action(&snapshot, "open-diff", Some("worktree:../secret"))
            )
            .await
            .is_err());
        let detail = fixture
            .host
            .act(&fixture.db, &fixture.broker, "main", inspect.clone())
            .await
            .unwrap();
        assert_eq!(detail["view"]["kind"], "detail");
        assert!(fixture
            .host
            .act(&fixture.db, &fixture.broker, "main", inspect)
            .await
            .unwrap_err()
            .contains("stale_context"));
        fixture
            .host
            .release(
                &fixture.broker,
                "main",
                snapshot["context"]["generation"].as_str().unwrap(),
            )
            .await
            .unwrap();
        assert!(fixture
            .host
            .act(
                &fixture.db,
                &fixture.broker,
                "main",
                action(&detail, "back", None)
            )
            .await
            .is_err());
        let independent = fixture
            .host
            .open(
                &fixture.db,
                &fixture.broker,
                "main",
                "w",
                &fixture.view,
                "dev.aibo.git-view.changes",
            )
            .await
            .unwrap();
        assert_eq!(
            independent["contribution"]["id"],
            "dev.aibo.git-view.changes"
        );
        assert_eq!(independent["view"], snapshot["view"]);
        fixture.finish().await;
    }
    #[tokio::test]
    async fn disabled_or_uninstalled_contributions_cannot_reactivate_from_old_actions() {
        let fixture = Fixture::new().await;
        let snapshot = fixture
            .host
            .open(
                &fixture.db,
                &fixture.broker,
                "main",
                "w",
                &fixture.view,
                "dev.aibo.git-view.changes",
            )
            .await
            .unwrap();
        crate::plugin_registry::enable(&fixture.db, &fixture.view, false)
            .await
            .unwrap();
        fixture
            .host
            .invalidate(&fixture.broker, &fixture.view, None)
            .await;
        assert!(fixture
            .host
            .act(
                &fixture.db,
                &fixture.broker,
                "main",
                action(&snapshot, "refresh", None)
            )
            .await
            .is_err());
        assert!(
            fixture.call("changes", json!({})).await.is_ok(),
            "disabling a declaration package does not disable the provider"
        );
        crate::plugin_registry::enable(&fixture.db, &fixture.view, true)
            .await
            .unwrap();
        crate::plugin_registry::enable(&fixture.db, &fixture.git, false)
            .await
            .unwrap();
        fixture
            .broker
            .stop_installation(&fixture.git)
            .await
            .unwrap();
        crate::plugin_registry::uninstall(&fixture.db, &fixture.root.join("data"), &fixture.git)
            .await
            .unwrap();
        let catalog = catalog(&fixture.db).await.unwrap();
        assert_eq!(catalog.len(), 1);
        assert!(!catalog[0].available);
        assert!(fixture
            .host
            .open(
                &fixture.db,
                &fixture.broker,
                "main",
                "w",
                &fixture.view,
                "dev.aibo.git-view.changes"
            )
            .await
            .is_err());
        fixture.finish().await;
    }
    #[tokio::test]
    async fn closing_an_inflight_view_cancels_its_worker_and_git_process_group() {
        let fixture = Fixture::new().await;
        let source = fixture.root.join("slow-package");
        fs::create_dir_all(&source).unwrap();
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("fixtures/plugins/git-read");
        let mut manifest: Value =
            serde_json::from_str(&fs::read_to_string(base.join("plugin.json")).unwrap()).unwrap();
        manifest["version"] = json!("1.0.1");
        fs::write(source.join("plugin.json"), manifest.to_string()).unwrap();
        let worker=fs::read_to_string(base.join("git-worker.mjs")).unwrap().replace("const root = p.context.workspacePath;",r#"const root = p.context.workspacePath; execFileSync('node',['-e',"require('fs').writeFileSync(process.argv[1],String(process.pid));setTimeout(()=>{},10000)",path.join(root,'child.pid')]);"#);
        fs::write(source.join("git-worker.mjs"), worker).unwrap();
        let installed =
            crate::plugin_registry::install(&fixture.db, &fixture.root.join("data"), &source)
                .await
                .unwrap();
        crate::plugin_registry::enable(&fixture.db, &installed.id, true)
            .await
            .unwrap();
        let query = {
            let host = fixture.host.clone();
            let db = fixture.db.clone();
            let broker = fixture.broker.clone();
            let id = installed.id.clone();
            tokio::spawn(async move {
                host.open_requested(
                    &db,
                    &broker,
                    "main",
                    "w",
                    &id,
                    "dev.aibo.git.workspace",
                    Some("pending-open".into()),
                )
                .await
            })
        };
        let pid_file = fixture.root.join("workspace/child.pid");
        tokio::time::timeout(Duration::from_secs(10), async {
            while !pid_file.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        fixture
            .host
            .cancel_open(&fixture.broker, "other-window", "pending-open")
            .await
            .unwrap();
        assert_eq!(fixture.host.leases.lock().await.len(), 1);
        fixture
            .host
            .cancel_open(&fixture.broker, "main", "pending-open")
            .await
            .unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(3), query)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err()
            .contains("cancelled"));
        let pid = fs::read_to_string(pid_file).unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let output = Command::new("ps")
                    .args(["-o", "stat=", "-p", pid.trim()])
                    .output()
                    .unwrap();
                let status = String::from_utf8_lossy(&output.stdout);
                if status.trim().is_empty() || status.trim().starts_with('Z') {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM capability_invocations WHERE status='running'"
            )
            .fetch_one(&fixture.db)
            .await
            .unwrap(),
            0
        );
        fixture
            .broker
            .stop_installation(&installed.id)
            .await
            .unwrap();
        fixture.finish().await;
    }
    #[tokio::test]
    async fn installed_git_paginates_truncates_and_rechecks_symlink_targets() {
        let fixture = Fixture::new().await;
        for n in 0..52 {
            fs::write(fixture.root.join(format!("workspace/file-{n}.txt")), "file").unwrap();
        }
        let page = fixture.open().await;
        assert_eq!(page["view"]["items"].as_array().unwrap().len(), 50);
        let next = fixture
            .host
            .act(
                &fixture.db,
                &fixture.broker,
                "main",
                action(&page, "next", None),
            )
            .await
            .unwrap();
        assert_eq!(next["view"]["page"]["offset"], 50);
        fs::write(fixture.root.join("workspace/one.txt"), "x".repeat(64000)).unwrap();
        let output = fixture
            .call("diff", json!({"path":"one.txt","staged":false}))
            .await
            .unwrap()
            .output;
        assert_eq!(output["truncated"], true);
        assert_eq!(output["content"].as_str().unwrap().len(), 32000);
        fs::write(
            fixture.root.join("workspace/one.txt"),
            format!("{}😀tail", "a".repeat(31999)),
        )
        .unwrap();
        let unicode = fixture
            .call("diff", json!({"path":"one.txt","staged":false}))
            .await
            .unwrap()
            .output;
        assert_eq!(unicode["truncated"], true);
        assert!(unicode["content"].as_str().unwrap().len() <= 32000);
        #[cfg(unix)]
        {
            fs::write(fixture.root.join("outside"), "outside-secret").unwrap();
            fs::remove_file(fixture.root.join("workspace/one.txt")).unwrap();
            std::os::unix::fs::symlink(
                fixture.root.join("outside"),
                fixture.root.join("workspace/one.txt"),
            )
            .unwrap();
            assert_eq!(
                fixture
                    .call("diff", json!({"path":"one.txt","staged":false}))
                    .await
                    .unwrap_err()
                    .code,
                "permission_denied"
            );
            assert!(fixture
                .host
                .act(
                    &fixture.db,
                    &fixture.broker,
                    "main",
                    action(&next, "open-diff", Some("worktree:one.txt"))
                )
                .await
                .unwrap_err()
                .contains("permission_denied"));
        }
        fixture.finish().await;
    }
}
