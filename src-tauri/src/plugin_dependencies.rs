//! Package dependency graph and immutable release pins; not an execution permission grant.
use crate::{plugin_manifest, plugin_registry};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet};
use tokio::sync::Mutex;

static RESOLUTION_LOCK: Mutex<()> = Mutex::const_new(());
const MAX_DEPTH: usize = 16;
const MAX_VISITED: usize = 128;
const MAX_RELEASES: i64 = 4096;
const MAX_GRAPH_BYTES: usize = 8 * 1_048_576;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Diagnostic {
    pub plugin_id: String,
    pub required: bool,
    pub installation_id: Option<String>,
    pub version: Option<String>,
    pub available: bool,
    pub issue: Option<String>,
    pub contribution_ids: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub dependencies: Vec<Diagnostic>,
    pub unavailable_contributions: Vec<String>,
}
impl Report {
    pub fn ready(&self) -> bool { self.dependencies.iter().all(|item|!item.required || item.available) }
    pub fn supports(&self, contribution: &str) -> bool { self.ready() && !self.unavailable_contributions.iter().any(|id|id == contribution) }
}
#[derive(Clone)]
struct Release { id: String, plugin: String, version: semver::Version, manifest: Value, installed: bool, enabled: bool }
struct Graph {
    releases: HashMap<String,Release>,
    pins: HashMap<(String,String),String>,
    planned: Vec<(String,String,String)>,
    visited: HashSet<String>,
    health: HashMap<String,bool>,
}
impl Graph {
    fn compatible(release: &Release, dependency: &Value) -> bool {
        let Ok(min) = semver::Version::parse(dependency["version"]["min"].as_str().unwrap_or("")) else { return false; };
        let Ok(max) = semver::Version::parse(dependency["version"]["maxExclusive"].as_str().unwrap_or("")) else { return false; };
        release.version >= min && release.version < max
    }
    fn candidate(&self, owner: &str, dependency: &Value) -> Option<Release> {
        let plugin = dependency["pluginId"].as_str().unwrap();
        if let Some(id) = self.pins.get(&(owner.into(),plugin.into())) {
            return self.releases.get(id).cloned();
        }
        // Prefer a usable enabled release, otherwise retain an installed candidate
        // for diagnostics/cycle detection. The selected release is pinned on commit.
        self.releases.values().filter(|release|release.installed && release.plugin == plugin && Self::compatible(release,dependency))
            .max_by(|a,b|a.enabled.cmp(&b.enabled).then(a.version.cmp(&b.version)).then(a.id.cmp(&b.id))).cloned()
    }
    fn executable(&mut self, release: &Release) -> bool {
        *self.health.entry(release.id.clone()).or_insert_with(|| {
            plugin_manifest::activation_issues(&release.manifest).is_ok_and(|issues|issues.is_empty()) &&
                plugin_registry::dependency_diagnostics(&release.manifest).iter().all(|dependency|!dependency.required || dependency.available)
        })
    }
    fn walk(&mut self, id: &str, stack: &mut Vec<String>) -> Result<Report,String> {
        if stack.iter().any(|ancestor|ancestor == id) { return Err("dependency_cycle: package dependency cycle".into()); }
        self.visited.insert(id.into());
        if stack.len() >= MAX_DEPTH || self.visited.len() > MAX_VISITED { return Err("dependency_limit: dependency graph exceeds host limits".into()); }
        let release = self.releases.get(id).cloned().ok_or("dependency_missing: release no longer exists")?;
        plugin_manifest::normalize(&release.manifest)?;
        stack.push(id.into());
        let mut report = Report::default();
        for dependency in release.manifest["packageDependencies"].as_array().into_iter().flatten() {
            let plugin = dependency["pluginId"].as_str().unwrap();
            let candidate = self.candidate(id,dependency);
            let checkpoint = self.planned.len();
            let issue = match &candidate {
                None => Some("dependency_missing: no compatible installed release".into()),
                Some(candidate) if candidate.plugin != plugin || !Self::compatible(candidate,dependency) => Some("dependency_incompatible: pinned release no longer matches the declared range".into()),
                Some(candidate) if !candidate.installed => Some("dependency_unavailable: pinned release was uninstalled".into()),
                Some(candidate) => match self.walk(&candidate.id,stack) {
                    Err(issue) => Some(issue),
                    Ok(child) if !child.ready() => child.dependencies.iter().find(|item|item.required && !item.available).and_then(|item|item.issue.clone()),
                    Ok(_) if !candidate.enabled => Some("dependency_unavailable: selected release is disabled".into()),
                    Ok(_) if !self.executable(candidate) => Some("dependency_unavailable: selected release cannot activate".into()),
                    Ok(_) => None,
                },
            };
            let contribution_ids: Vec<String> = dependency["contributionIds"].as_array().unwrap().iter().map(|id|id.as_str().unwrap().into()).collect();
            if issue.is_some() {
                self.planned.truncate(checkpoint);
                report.unavailable_contributions.extend(contribution_ids.iter().cloned());
            } else if let Some(candidate) = &candidate {
                if !self.pins.contains_key(&(id.into(),plugin.into())) { self.planned.push((id.into(),plugin.into(),candidate.id.clone())); }
            }
            report.dependencies.push(Diagnostic { plugin_id: plugin.into(), required: dependency["required"].as_bool().unwrap(), version: candidate.as_ref().map(|candidate|candidate.version.to_string()), installation_id: candidate.map(|candidate|candidate.id), available: issue.is_none(), issue, contribution_ids });
        }
        stack.pop();
        report.unavailable_contributions.sort();report.unavailable_contributions.dedup();
        Ok(report)
    }
}

/// Dry-run for UI; `persist` is used for activation and before Broker dispatch.
/// A failed required graph cannot leave a partially committed set of pins.
pub(crate) async fn resolve(db: &SqlitePool, root: &str, persist: bool) -> Result<Report,String> {
    let _guard = RESOLUTION_LOCK.lock().await;
    let mut tx = db.begin().await.map_err(|e|e.to_string())?;
    let root_manifest: String = sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=?")
        .bind(root).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?.ok_or("dependency_missing: root installation does not exist")?;
    let root_manifest: Value = serde_json::from_str(&root_manifest).map_err(|_|"dependency_incompatible: invalid root manifest")?;
    plugin_manifest::normalize(&root_manifest)?;
    if !root_manifest["packageDependencies"].as_array().is_some_and(|items|!items.is_empty()) { return Ok(Report::default()); }
    let rows = sqlx::query("SELECT id,plugin_id,plugin_version,installed,enabled FROM plugin_installations LIMIT ?")
        .bind(MAX_RELEASES+1).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    if rows.len() as i64 > MAX_RELEASES { return Err("dependency_limit: release inventory exceeds host limit".into()); }
    let mut releases = HashMap::new();
    for row in rows {
        // Malformed unrelated historical rows cannot disable every healthy package.
        let Ok(version) = semver::Version::parse(row.get("plugin_version")) else { continue; };
        let release = Release { id:row.get("id"),plugin:row.get("plugin_id"),version,manifest:Value::Null,installed:row.get::<i64,_>("installed")!=0,enabled:row.get::<i64,_>("enabled")!=0 };
        releases.insert(release.id.clone(),release);
    }
    let pins: Vec<(String,String,String)> = sqlx::query_as("SELECT installation_id,dependency_plugin_id,dependency_installation_id FROM plugin_dependency_bindings")
        .fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let mut graph = Graph { releases,pins:pins.into_iter().map(|(owner,plugin,id)|((owner,plugin),id)).collect(),planned:vec![],visited:HashSet::new(),health:HashMap::new() };
    // Load only the selected reachable releases, not every historical manifest.
    // The whole graph has a byte budget in addition to per-manifest limits.
    let mut pending = vec![root.to_owned()];
    let mut loaded = HashSet::new();
    let mut bytes = 0usize;
    while let Some(id) = pending.pop() {
        if !loaded.insert(id.clone()) { continue; }
        if loaded.len() > MAX_VISITED { return Err("dependency_limit: reachable release limit".into()); }
        let raw: String = sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=?")
            .bind(&id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        bytes = bytes.saturating_add(raw.len());
        if bytes > MAX_GRAPH_BYTES { return Err("dependency_limit: graph manifest byte limit".into()); }
        let manifest = serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null);
        let valid = plugin_manifest::normalize(&manifest).is_ok();
        let Some(release) = graph.releases.get_mut(&id) else { return Err("dependency_incompatible: invalid reachable release version".into()); };
        release.manifest = manifest.clone();
        if !valid { continue; } // walk assigns failure to the affected optional/required edge.
        for dependency in manifest["packageDependencies"].as_array().into_iter().flatten() {
            if let Some(candidate) = graph.candidate(&id,dependency) {
                if candidate.installed { pending.push(candidate.id); }
            }
        }
    }
    let report = graph.walk(root,&mut vec![])?;
    if persist && report.ready() {
        for (owner,plugin,id) in graph.planned {
            sqlx::query("INSERT INTO plugin_dependency_bindings(installation_id,dependency_plugin_id,dependency_installation_id,created_at) VALUES(?,?,?,?) ON CONFLICT(installation_id,dependency_plugin_id) DO NOTHING")
                .bind(owner).bind(plugin).bind(id).bind(crate::now_iso()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        tx.commit().await.map_err(|e|e.to_string())?;
    }
    Ok(report)
}

/// Required edges make the dependent package unavailable; optional edges only
/// invalidate their declared local contributions and do not poison unrelated parents.
pub(crate) async fn invalidations(db: &SqlitePool, installation: &str) -> Result<Vec<(String,Option<Vec<String>>)>,String> {
    let rows: Vec<(String,String,String,String)> = sqlx::query_as("SELECT b.installation_id,b.dependency_plugin_id,b.dependency_installation_id,p.manifest_json FROM plugin_dependency_bindings b JOIN plugin_installations p ON p.id=b.installation_id")
        .fetch_all(db).await.map_err(|e|e.to_string())?;
    let mut affected: HashMap<String,Option<Vec<String>>> = HashMap::from([(installation.into(),None)]);
    let mut queue = vec![installation.to_owned()];
    let mut visited = HashSet::new();
    while let Some(id) = queue.pop() {
        if !visited.insert(id.clone()) { continue; }
        for (owner,plugin,dependency,raw) in rows.iter().filter(|row|row.2 == id) {
            let _ = dependency;
            let manifest: Value = serde_json::from_str(raw).map_err(|_|"dependency_incompatible: stored manifest")?;
            let Some(declaration) = manifest["packageDependencies"].as_array().and_then(|entries|entries.iter().find(|entry|entry["pluginId"] == plugin.as_str())) else { continue; };
            if declaration["required"] == true {
                affected.insert(owner.clone(),None);queue.push(owner.clone());
            } else {
                let ids: Vec<String> = declaration["contributionIds"].as_array().unwrap().iter().map(|id|id.as_str().unwrap().into()).collect();
                if let Some(current) = affected.entry(owner.clone()).or_insert_with(||Some(vec![])) { current.extend(ids);current.sort();current.dedup(); }
            }
        }
    }
    Ok(affected.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capability_broker::{Broker,Binding,Request,Scope};
    use serde_json::json;
    use std::{fs,path::PathBuf,time::Duration};
    struct Fixture { root: PathBuf, db: SqlitePool, broker: Broker }
    impl Fixture {
        async fn new() -> Self {
            let root=std::env::temp_dir().join(format!("aibo-dependency-{}",ulid::Ulid::new()));
            let db=crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
            fs::create_dir_all(root.join("workspace")).unwrap();
            sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'w',1,?,?)")
                .bind(root.join("workspace").to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
            Self {root,broker:Broker::new(db.clone()),db}
        }
        async fn install(&self, plugin: &str, version: &str, dependencies: Value, extra: bool) -> String {
            let path=self.root.join(format!("{plugin}-{version}"));fs::create_dir_all(&path).unwrap();
            let source=include_str!("../../fixtures/plugins/capability-echo/plugin.json").replace("dev.aibo.capability-echo",plugin);
            let mut manifest: Value=serde_json::from_str(&source).unwrap();manifest["version"]=json!(version);manifest["packageDependencies"]=dependencies;
            if extra {
                let mut contribution=manifest["contributions"][0].clone();
                contribution["id"]=json!(format!("{plugin}.optional"));
                contribution["operations"][0]["id"]=json!(format!("{plugin}.optional-echo"));
                contribution["operations"][0]["capability"]["id"]=json!(format!("{plugin}.optional-echo"));
                manifest["contributions"].as_array_mut().unwrap().push(contribution);
            }
            fs::write(path.join("plugin.json"),manifest.to_string()).unwrap();
            fs::write(path.join("worker.mjs"),include_str!("../../fixtures/plugins/capability-echo/worker.mjs")).unwrap();
            plugin_registry::install(&self.db,&self.root.join("data"),&path).await.unwrap().id
        }
        async fn finish(self) {
            let ids:Vec<String>=sqlx::query_scalar("SELECT id FROM plugin_installations").fetch_all(&self.db).await.unwrap();
            for id in ids {self.broker.stop_installation(&id).await.unwrap();}
            self.db.close().await;fs::remove_dir_all(self.root).unwrap();
        }
    }
    fn dependency(plugin: &str, owner: &str, required: bool, optional_contribution: bool) -> Value {
        json!([{"pluginId":plugin,"version":{"min":"1.0.0","maxExclusive":"2.0.0"},"required":required,"contributionIds":[format!("{owner}.{}",if optional_contribution {"optional"} else {"read"})]}])
    }
    #[tokio::test]
    async fn required_missing_blocks_activation_optional_missing_only_disables_target_contribution() {
        let f=Fixture::new().await;
        let required=f.install("dev.test.required","1.0.0",dependency("dev.test.missing","dev.test.required",true,false),false).await;
        assert!(!resolve(&f.db,&required,false).await.unwrap().ready());
        assert!(plugin_registry::enable(&f.db,&required,true).await.is_err());
        let optional=f.install("dev.test.optional","1.0.0",dependency("dev.test.missing","dev.test.optional",false,true),true).await;
        plugin_registry::enable(&f.db,&optional,true).await.unwrap();
        let report=resolve(&f.db,&optional,true).await.unwrap();
        assert!(report.ready() && report.supports("dev.test.optional.read"));
        assert!(!report.supports("dev.test.optional.optional"));
        assert!(f.broker.providers(&Scope::Workspace("w".into()),"dev.test.optional.optional-echo","1.0.0").await.unwrap().is_empty());
        assert_eq!(f.broker.providers(&Scope::Workspace("w".into()),"dev.test.optional.echo","1.0.0").await.unwrap().len(),1);
        let child=f.install("dev.test.missing","1.0.0",json!([]),false).await;plugin_registry::enable(&f.db,&child,true).await.unwrap();
        assert_eq!(f.broker.providers(&Scope::Workspace("w".into()),"dev.test.optional.optional-echo","1.0.0").await.unwrap().len(),1);
        let pins:i64=sqlx::query_scalar("SELECT COUNT(*) FROM plugin_dependency_bindings").fetch_one(&f.db).await.unwrap();assert_eq!(pins,0,"provider enumeration must not pin newly available optional releases");
        f.broker.bind(Binding {scope:Scope::Workspace("w".into()),capability:"dev.test.optional.echo".into(),version:"1.0.0".into(),installation_id:optional.clone(),contribution_id:"dev.test.optional.read".into()}).await.unwrap();
        let pins:i64=sqlx::query_scalar("SELECT COUNT(*) FROM plugin_dependency_bindings").fetch_one(&f.db).await.unwrap();assert_eq!(pins,1);
        f.finish().await;
    }
    #[tokio::test]
    async fn pins_survive_new_releases_disable_uninstall_and_reinstall() {
        let f=Fixture::new().await;
        let first=f.install("dev.test.leaf","1.0.0",json!([]),false).await;plugin_registry::enable(&f.db,&first,true).await.unwrap();
        let chosen=f.install("dev.test.leaf","1.2.0",json!([]),false).await;plugin_registry::enable(&f.db,&chosen,true).await.unwrap();
        let parent=f.install("dev.test.parent","1.0.0",dependency("dev.test.leaf","dev.test.parent",true,false),false).await;
        assert_eq!(resolve(&f.db,&parent,false).await.unwrap().dependencies[0].installation_id.as_deref(),Some(chosen.as_str()));
        let pins:i64=sqlx::query_scalar("SELECT COUNT(*) FROM plugin_dependency_bindings").fetch_one(&f.db).await.unwrap();assert_eq!(pins,0,"UI diagnosis is read-only");
        plugin_registry::enable(&f.db,&parent,true).await.unwrap();
        let newest=f.install("dev.test.leaf","1.3.0",json!([]),false).await;plugin_registry::enable(&f.db,&newest,true).await.unwrap();
        assert_eq!(resolve(&f.db,&parent,true).await.unwrap().dependencies[0].installation_id.as_deref(),Some(chosen.as_str()));
        plugin_registry::enable(&f.db,&chosen,false).await.unwrap();
        let report=resolve(&f.db,&parent,true).await.unwrap();assert!(!report.ready());assert_eq!(report.dependencies[0].installation_id.as_deref(),Some(chosen.as_str()));
        plugin_registry::uninstall(&f.db,&f.root.join("data"),&chosen).await.unwrap();assert!(!resolve(&f.db,&parent,true).await.unwrap().ready());
        let reinstalled=plugin_registry::install(&f.db,&f.root.join("data"),&f.root.join("dev.test.leaf-1.2.0")).await.unwrap();assert_eq!(reinstalled.id,chosen);
        plugin_registry::enable(&f.db,&chosen,true).await.unwrap();assert!(resolve(&f.db,&parent,true).await.unwrap().ready());
        f.finish().await;
    }
    #[tokio::test]
    async fn required_cycle_rejects_activation_without_partial_pins() {
        let f=Fixture::new().await;
        let leaf=f.install("dev.test.leaf","1.0.0",json!([]),false).await;plugin_registry::enable(&f.db,&leaf,true).await.unwrap();
        let mut dependencies=dependency("dev.test.leaf","dev.test.a",true,false);
        dependencies.as_array_mut().unwrap().push(dependency("dev.test.b","dev.test.a",true,false)[0].clone());
        let a=f.install("dev.test.a","1.0.0",dependencies,false).await;
        f.install("dev.test.b","1.0.0",dependency("dev.test.a","dev.test.b",true,false),false).await;
        let error=plugin_registry::enable(&f.db,&a,true).await.unwrap_err();assert!(error.contains("dependency_cycle"),"{error}");
        let pins:i64=sqlx::query_scalar("SELECT COUNT(*) FROM plugin_dependency_bindings").fetch_one(&f.db).await.unwrap();assert_eq!(pins,0);
        f.finish().await;
    }
    #[tokio::test]
    async fn optional_cycle_does_not_poison_unrelated_features_or_create_cyclic_pins() {
        let f=Fixture::new().await;
        let a=f.install("dev.test.a","1.0.0",dependency("dev.test.b","dev.test.a",false,true),true).await;
        let b=f.install("dev.test.b","1.0.0",dependency("dev.test.a","dev.test.b",true,false),false).await;
        plugin_registry::enable(&f.db,&a,true).await.unwrap();plugin_registry::enable(&f.db,&b,true).await.unwrap();
        let report=resolve(&f.db,&a,true).await.unwrap();assert!(report.ready() && report.supports("dev.test.a.read"));assert!(!report.supports("dev.test.a.optional"));
        let pins:i64=sqlx::query_scalar("SELECT COUNT(*) FROM plugin_dependency_bindings").fetch_one(&f.db).await.unwrap();assert_eq!(pins,1);
        f.finish().await;
    }
    #[tokio::test]
    async fn invalidation_traverses_required_edges_and_stops_at_optional_edges() {
        let f=Fixture::new().await;
        let leaf=f.install("dev.test.leaf","1.0.0",json!([]),false).await;plugin_registry::enable(&f.db,&leaf,true).await.unwrap();
        let required=f.install("dev.test.required","1.0.0",dependency("dev.test.leaf","dev.test.required",true,false),false).await;plugin_registry::enable(&f.db,&required,true).await.unwrap();
        let parent=f.install("dev.test.parent","1.0.0",dependency("dev.test.required","dev.test.parent",true,false),false).await;plugin_registry::enable(&f.db,&parent,true).await.unwrap();
        let optional=f.install("dev.test.optional","1.0.0",dependency("dev.test.leaf","dev.test.optional",false,true),true).await;plugin_registry::enable(&f.db,&optional,true).await.unwrap();
        let unrelated=f.install("dev.test.unrelated","1.0.0",dependency("dev.test.optional","dev.test.unrelated",true,false),false).await;plugin_registry::enable(&f.db,&unrelated,true).await.unwrap();
        let affected:HashMap<_,_>=invalidations(&f.db,&leaf).await.unwrap().into_iter().collect();
        assert_eq!(affected.get(&leaf),Some(&None));assert_eq!(affected.get(&required),Some(&None));assert_eq!(affected.get(&parent),Some(&None));
        assert_eq!(affected.get(&optional),Some(&Some(vec!["dev.test.optional.optional".into()])));assert!(!affected.contains_key(&unrelated));
        f.finish().await;
    }
    #[tokio::test]
    async fn losing_optional_dependency_cancels_only_affected_real_invocation() {
        let f=Fixture::new().await;
        let leaf=f.install("dev.test.leaf","1.0.0",json!([]),false).await;plugin_registry::enable(&f.db,&leaf,true).await.unwrap();
        let parent=f.install("dev.test.parent","1.0.0",dependency("dev.test.leaf","dev.test.parent",false,true),true).await;plugin_registry::enable(&f.db,&parent,true).await.unwrap();
        for (cap,contribution) in [("echo","read"),("optional-echo","optional")] {
            f.broker.bind(Binding {scope:Scope::Workspace("w".into()),capability:format!("dev.test.parent.{cap}"),version:"1.0.0".into(),installation_id:parent.clone(),contribution_id:format!("dev.test.parent.{contribution}")}).await.unwrap();
        }
        let invoke=|cap:&str| {let broker=f.broker.clone();let capability=format!("dev.test.parent.{cap}");let request_id=cap.to_owned();tokio::spawn(async move {broker.invoke("main",Request {scope:Scope::Workspace("w".into()),capability,version:"1.0.0".into(),request_id,input:json!({"value":"ok","delayMs":500})}).await})};
        let regular=invoke("echo");let affected=invoke("optional-echo");
        tokio::time::timeout(Duration::from_secs(5),async {loop {
            let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM capability_invocations WHERE status='running' AND generation_id IS NOT NULL").fetch_one(&f.db).await.unwrap();
            if count==2 {break;}tokio::task::yield_now().await;
        }}).await.unwrap();
        plugin_registry::enable(&f.db,&leaf,false).await.unwrap();
        for (installation,contributions) in invalidations(&f.db,&leaf).await.unwrap() {f.broker.stop_contributions(&installation,contributions.as_deref()).await.unwrap();}
        assert_eq!(affected.await.unwrap().unwrap_err().code,"cancelled");assert_eq!(regular.await.unwrap().unwrap().output["value"],"ok");
        assert!(resolve(&f.db,&parent,false).await.unwrap().supports("dev.test.parent.read"));
        f.finish().await;
    }
}
