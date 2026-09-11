use super::*;
use crate::workspace_write_runs;
use std::{fs, sync::atomic::{AtomicUsize, Ordering}};

struct Fixture { root: PathBuf, db: SqlitePool, broker: Broker, installations: HashMap<String,String> }
impl Fixture {
    async fn new(middle: bool, root_read: bool, bridge_read: bool, timeout: u64) -> Self {
        let root = std::env::temp_dir().join(format!("aibo-write-chain-{}",ulid::Ulid::new()));
        let db = crate::open_database(&root.join("data/host.db")).await.unwrap();
        for id in ["a","b"] { fs::create_dir_all(root.join(id)).unwrap(); sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES(?,?,?,1,?,?)").bind(id).bind(root.join(id).to_str().unwrap()).bind(id).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap(); }
        let mut f = Self {root,db:db.clone(),broker:Broker::new(db),installations:HashMap::new()};
        let leaf = f.install("leaf","1.0.0",None,false,30000).await; f.installations.insert("leaf".into(),leaf);
        if middle {let mid = f.install("middle","1.0.0",Some("leaf"),bridge_read,30000).await; f.installations.insert("middle".into(),mid);}
        let parent = f.install("parent","1.0.0",Some(if middle {"middle"} else {"leaf"}),root_read,timeout).await;
        f.installations.insert("parent".into(),parent.clone());
        f.broker.bind(Binding {scope:Scope::Workspace("a".into()),capability:"dev.aibo.write-parent.run".into(),version:"1.0.0".into(),installation_id:parent,contribution_id:"dev.aibo.write-parent.worker".into()}).await.unwrap();
        f
    }
    async fn install(&self, name: &str, version: &str, dependency: Option<&str>, read: bool, timeout: u64) -> String {
        let directory = self.root.join(format!("{name}-{version}")); fs::create_dir_all(&directory).unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/capability-write-chain/plugin.json")).unwrap();
        let plugin = format!("dev.aibo.write-{name}"); manifest["pluginId"] = json!(plugin); manifest["version"] = json!(version);
        manifest["entrypoint"]["args"] = json!([self.root.join(format!("{name}-{version}-started")).to_str().unwrap()]);
        let contribution = &mut manifest["contributions"][0]; contribution["id"] = json!(format!("{plugin}.worker"));
        let op = &mut contribution["operations"][0]; op["id"] = json!(format!("{plugin}.run")); op["capability"]["id"] = json!(format!("{plugin}.run")); op["timeoutMs"] = json!(timeout);
        if read {op["effect"] = json!("read"); op["permissions"] = json!(["workspace.read"]);}
        if let Some(dependency) = dependency {manifest["packageDependencies"] = json!([{"pluginId":format!("dev.aibo.write-{dependency}"),"version":{"min":"1.0.0","maxExclusive":"2.0.0"},"required":true,"contributionIds":[format!("{plugin}.worker")]}]);} else {manifest.as_object_mut().unwrap().remove("packageDependencies");}
        fs::write(directory.join("plugin.json"),manifest.to_string()).unwrap(); fs::write(directory.join("worker.mjs"),include_str!("../../fixtures/plugins/capability-write-chain/worker.mjs")).unwrap();
        let installed = plugin_registry::install(&self.db,&self.root.join("data"),&directory).await.unwrap(); assert!(installed.runnable);
        plugin_registry::enable(&self.db,&installed.id,true).await.unwrap(); installed.id
    }
    async fn rows(&self) -> Vec<Value> {serde_json::to_value(workspace_write_runs::list(&self.db,"a".into(),None).await.unwrap()).unwrap().as_array().unwrap().clone()}
    fn started(&self, name: &str) -> bool {self.root.join(format!("{name}-1.0.0-started")).exists()}
    fn effect(&self, name: &str) -> PathBuf {self.root.join(format!("a/dev.aibo.write-{name}.txt"))}
    async fn finish(self) {
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM plugin_installations").fetch_all(&self.db).await.unwrap();
        for id in ids {self.broker.stop_installation(&id).await.unwrap();} self.db.close().await; fs::remove_dir_all(self.root).unwrap();
    }
}
fn request(id: &str, mode: &str) -> Request {Request {scope:Scope::Workspace("a".into()),capability:"dev.aibo.write-parent.run".into(),version:"1.0.0".into(),request_id:id.into(),turn_id:None,input:json!({"value":id,"mode":mode})}}
fn approval(id: &str) -> workspace_write_runs::Request {workspace_write_runs::Request::with_confirmation(id.into(),"main".into(), |_|async {Ok(true)})}

#[tokio::test]
async fn nested_writes_share_one_lease_but_each_requires_approval_and_pinned_identity() {
    let f = Fixture::new(true,false,false,30000).await;
    let alternate = f.install("leaf","1.0.1",None,false,30000).await;
    f.broker.bind(Binding {scope:Scope::Workspace("a".into()),capability:"dev.aibo.write-leaf.run".into(),version:"1.0.0".into(),installation_id:alternate,contribution_id:"dev.aibo.write-leaf.worker".into()}).await.unwrap();
    let root = f.root.clone(); let db = f.db.clone(); let prompts = Arc::new(AtomicUsize::new(0)); let count = prompts.clone();
    let confirmation = workspace_write_runs::Request::with_confirmation("chain".into(),"main".into(),move |message| {
        let root = root.clone(); let db = db.clone(); let count = count.clone(); async move {
            let step = count.fetch_add(1,Ordering::SeqCst); let name = ["parent","middle","leaf"][step];
            assert!(!root.join(format!("{name}-1.0.0-started")).exists()); assert!(message.contains(&format!("dev.aibo.write-{name}.run")));
            if step > 0 {assert!(message.contains("原始调用窗口：main") && message.contains("父写入已获准"));}
            assert!(matches!(crate::workspace_writes::acquire(&db,"a",&root.join("a")).await,Err(crate::CoreError::WorkspaceWriteBusy)));
            assert!(crate::workspace_writes::acquire(&db,"b",&root.join("b")).await.is_ok()); Ok(true)
        }
    });
    let response = f.broker.invoke_authorized("main",request("chain","normal"),&confirmation).await.unwrap();
    assert_eq!(prompts.load(Ordering::SeqCst),3); assert!(!f.root.join("leaf-1.0.1-started").exists());
    assert_eq!(response.output["trace"],json!(["dev.aibo.write-parent","dev.aibo.write-middle","dev.aibo.write-leaf"])); assert_eq!(response.output["caller"],"main");
    let sites: Vec<Value> = serde_json::from_str(response.output["chain"].as_str().unwrap()).unwrap(); assert_eq!(sites.len(),3);
    assert_eq!(sites[2]["installationId"],f.installations["leaf"]);
    let rows = f.rows().await; assert_eq!(rows.len(),3); let root = rows.iter().find(|row|row["parentWriteRunId"].is_null()).unwrap();
    assert_eq!(root["rootWriteRunId"],root["id"]);
    for row in &rows {assert_eq!(row["status"],"completed"); assert_eq!(row["rootWriteRunId"],root["id"]); assert_eq!(row["callerWindow"],"main");}
    let child = rows.iter().find(|row|!row["parentWriteRunId"].is_null()).unwrap();
    let forged = Request {scope:Scope::Workspace("a".into()),capability:child["snapshot"]["input"]["capability"].as_str().unwrap().into(),version:"1.0.0".into(),request_id:child["requestId"].as_str().unwrap().into(),turn_id:None,input:child["snapshot"]["input"]["input"].clone()};
    let no_prompt = workspace_write_runs::Request::with_confirmation(forged.request_id.clone(),"main".into(), |_|async {panic!("A child ID cannot become a standalone authorized request")});
    assert_eq!(f.broker.invoke_authorized("main",forged,&no_prompt).await.unwrap_err().code,"invalid_input");
    let linked: Vec<(String,String,Option<String>,i64)> = sqlx::query_as("SELECT write_run_id,caller_window,parent_invocation_id,deadline_ms FROM capability_invocations ORDER BY started_at,id").fetch_all(&f.db).await.unwrap();
    assert_eq!(linked.len(),3); assert!(linked.iter().all(|(_,caller,_,deadline)|caller == "main" && *deadline <= linked[0].3));
    assert_eq!(linked.iter().filter(|(_,_,parent,_)|parent.is_none()).count(),1);
    for name in ["parent","middle","leaf"] {assert_eq!(fs::read_to_string(f.effect(name)).unwrap(),"chain\n");}
    let replay = f.broker.invoke_authorized("main",request("chain","normal"),&confirmation).await.unwrap(); assert_eq!(replay.invocation_id,response.invocation_id); assert_eq!(prompts.load(Ordering::SeqCst),3);
    assert!(crate::workspace_writes::acquire(&f.db,"a",&f.root.join("a")).await.is_ok()); f.finish().await;
}

#[tokio::test]
async fn child_denial_is_observable_without_starting_the_child_or_undoing_parent_effects() {
    let f = Fixture::new(false,false,false,30000).await; let prompts = Arc::new(AtomicUsize::new(0)); let count = prompts.clone();
    let confirm = workspace_write_runs::Request::with_confirmation("deny".into(),"main".into(),move |_| {let count = count.clone(); async move {Ok(count.fetch_add(1,Ordering::SeqCst) == 0)}});
    let response = f.broker.invoke_authorized("main",request("deny","normal"),&confirm).await.unwrap();
    assert_eq!(response.output["trace"],json!(["dev.aibo.write-parent","error:approval_rejected"])); assert!(!f.started("leaf")); assert!(!f.effect("leaf").exists()); assert_eq!(fs::read_to_string(f.effect("parent")).unwrap(),"deny\n");
    let rows = f.rows().await; assert_eq!(rows.len(),2); assert!(rows.iter().any(|row|row["status"] == "rejected" && !row["parentWriteRunId"].is_null()));
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&f.db).await.unwrap(),1);
    f.broker.invoke_authorized("main",request("deny","normal"),&confirm).await.unwrap(); assert_eq!(prompts.load(Ordering::SeqCst),2); f.finish().await;
}

#[tokio::test]
async fn parent_stop_deadline_crash_and_child_context_changes_reject_pending_children() {
    for case in ["cancel-root","cancel-child","deadline","parent-crash","disabled","package"] {
        let f = Fixture::new(false,false,false,if case == "deadline" {2500} else {30000}).await;
        let broker = f.broker.clone(); let db = f.db.clone(); let leaf = f.installations["leaf"].clone(); let count = Arc::new(AtomicUsize::new(0));
        let confirm = workspace_write_runs::Request::with_confirmation(case.into(),"main".into(),move |_| {let broker = broker.clone(); let db = db.clone(); let leaf = leaf.clone(); let count = count.clone(); async move {
            if count.fetch_add(1,Ordering::SeqCst) == 0 {return Ok(true);}
            match case {
                "cancel-root" => {assert!(broker.cancel("main",case).await);},
                "cancel-child" => {let id: String = sqlx::query_scalar("SELECT id FROM workspace_write_runs WHERE status='awaiting_approval'").fetch_one(&db).await.unwrap(); assert!(!workspace_write_runs::cancel(&db,"a",&id,"other").await.unwrap()); assert!(workspace_write_runs::cancel(&db,"a",&id,"main").await.unwrap());},
                "disabled" => {plugin_registry::enable(&db,&leaf,false).await.unwrap(); broker.stop_installation(&leaf).await.unwrap();},
                "package" => {let path: String = sqlx::query_scalar("SELECT install_path FROM plugin_installations WHERE id=?").bind(&leaf).fetch_one(&db).await.unwrap(); fs::write(PathBuf::from(path).join("worker.mjs"),"throw Error('tampered')").unwrap();},
                _ => {std::future::pending::<()>().await;},
            }
            Ok(true)
        }});
        let result = tokio::time::timeout(Duration::from_secs(10),f.broker.invoke_authorized("main",request(case,if case == "parent-crash" {case} else {"normal"}),&confirm)).await.unwrap();
        if matches!(case,"cancel-root"|"deadline"|"parent-crash") {assert_eq!(result.unwrap_err().code,"outcome_unknown", "{case}");} else {assert!(result.unwrap().output["trace"].as_array().unwrap().contains(&json!("error:approval_rejected")));}
        assert!(!f.started("leaf"),"{case}"); assert!(!f.effect("leaf").exists());
        assert!(f.rows().await.iter().any(|row|row["status"] == "rejected" && !row["parentWriteRunId"].is_null()),"{case}");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM workspace_write_runs WHERE status IN ('awaiting_approval','running')").fetch_one(&f.db).await.unwrap(),0); f.finish().await;
    }
}

#[tokio::test]
async fn a_child_unknown_outcome_cannot_be_hidden_by_parent_success_or_replayed() {
    for mode in ["ignore-unknown","invalid-output","slow","duplicate","settlement"] {
        let f = Fixture::new(false,false,false,30000).await; let broker = f.broker.clone();
        if mode == "settlement" {sqlx::raw_sql("CREATE TRIGGER fail_child_settlement BEFORE UPDATE ON workspace_write_runs WHEN NEW.parent_write_run_id IS NOT NULL AND NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture child settlement'); END;").execute(&f.db).await.unwrap();}
        let worker_mode = if mode == "settlement" {"normal"} else {mode};
        let task = tokio::spawn(async move {broker.invoke_authorized("main",request(mode,worker_mode),&approval(mode)).await});
        if mode == "slow" {
            tokio::time::timeout(Duration::from_secs(10),async {while !f.effect("leaf").exists() {tokio::time::sleep(Duration::from_millis(10)).await;}}).await.unwrap();
            let child: String = sqlx::query_scalar("SELECT id FROM workspace_write_runs WHERE parent_write_run_id IS NOT NULL AND status='running'").fetch_one(&f.db).await.unwrap();
            assert!(workspace_write_runs::cancel(&f.db,"a",&child,"main").await.unwrap());
        }
        assert_eq!(task.await.unwrap().unwrap_err().code,"outcome_unknown"); assert!(!f.root.join("a/parent-continued.txt").exists());
        let rows = f.rows().await; assert_eq!(rows.len(),2); assert!(rows.iter().any(|row|row["parentWriteRunId"].is_null() && row["status"] == "outcome_unknown"));
        assert_eq!(f.broker.invoke_authorized("main",request(mode,worker_mode),&approval(mode)).await.unwrap_err().code,"outcome_unknown");
        assert_eq!(fs::read_to_string(f.effect("leaf")).unwrap(),format!("{mode}\n"));
        if mode == "slow" {tokio::time::sleep(Duration::from_millis(3200)).await; assert!(!f.root.join("a/late.txt").exists());}
        if mode == "settlement" {
            assert!(matches!(crate::workspace_writes::acquire(&f.db,"a",&f.root.join("a")).await,Err(crate::CoreError::WorkspaceWriteBusy)));
            workspace_write_runs::recover(&f.db).await.unwrap(); assert!(f.rows().await.iter().all(|row|row["status"] == "outcome_unknown"));
        }
        f.finish().await;
    }
}

#[tokio::test]
async fn read_parents_and_read_bridges_cannot_amplify_write_permissions() {
    for bridge in [false,true] {
        let f = Fixture::new(bridge,!bridge,bridge,30000).await;
        let prompts = Arc::new(AtomicUsize::new(0)); let count = prompts.clone();
        let confirm = workspace_write_runs::Request::with_confirmation("denied".into(),"main".into(),move |_| {let count = count.clone(); async move {count.fetch_add(1,Ordering::SeqCst); Ok(true)}});
        let result = f.broker.invoke_authorized("main",request("denied","normal"),&confirm).await.unwrap();
        assert!(result.output["trace"].as_array().unwrap().contains(&json!("error:permission_denied"))); assert!(!f.started("leaf")); assert!(!f.effect("leaf").exists());
        assert_eq!(prompts.load(Ordering::SeqCst),usize::from(bridge)); f.finish().await;
    }
    for mode in ["forged","undeclared"] {
        let f = Fixture::new(false,false,false,30000).await; let result = f.broker.invoke_authorized("main",request(mode,mode),&approval(mode)).await.unwrap();
        assert!(result.output["trace"].as_array().unwrap().contains(&json!("error:permission_denied"))); assert_eq!(f.rows().await.len(),1); assert!(!f.started("leaf")); f.finish().await;
    }
}

#[tokio::test]
async fn restart_snapshot_preserves_parent_unknown_and_unapproved_child_rejection() {
    let f = Fixture::new(false,false,false,30000).await;
    let snapshot = f.root.join("restart.db"); let target = snapshot.clone(); let db = f.db.clone(); let prompts = Arc::new(AtomicUsize::new(0));
    let confirm = workspace_write_runs::Request::with_confirmation("restart".into(),"main".into(),move |_| {let target = target.clone(); let db = db.clone(); let prompts = prompts.clone(); async move {
        if prompts.fetch_add(1,Ordering::SeqCst) == 0 {return Ok(true);}
        // Capture a real, transactionally consistent DB at the crash boundary;
        // let the original process finish normally rather than orphaning a worker.
        sqlx::query("VACUUM INTO ?").bind(target.to_str().unwrap()).execute(&db).await.unwrap(); Ok(false)
    }});
    f.broker.invoke_authorized("main",request("restart","normal"),&confirm).await.unwrap();
    let recovered = crate::open_database(&snapshot).await.unwrap();
    let before: Vec<(String,String,Option<String>,String)> = sqlx::query_as("SELECT id,status,parent_write_run_id,root_write_run_id FROM workspace_write_runs ORDER BY started_at,id").fetch_all(&recovered).await.unwrap();
    assert_eq!(before.len(),2); assert!(before.iter().any(|(_,status,parent,_)|status == "running" && parent.is_none())); assert!(before.iter().any(|(_,status,parent,_)|status == "awaiting_approval" && parent.is_some()));
    assert_eq!(workspace_write_runs::recover(&recovered).await.unwrap(),2); Broker::recover(&recovered).await.unwrap();
    let after: Vec<(String,String,Option<String>,String)> = sqlx::query_as("SELECT id,status,parent_write_run_id,root_write_run_id FROM workspace_write_runs ORDER BY started_at,id").fetch_all(&recovered).await.unwrap();
    for ((id,_,parent,root),(new_id,status,new_parent,new_root)) in before.iter().zip(&after) {assert_eq!((id,parent,root),(new_id,new_parent,new_root)); assert_eq!(status,if parent.is_some() {"rejected"} else {"outcome_unknown"});}
    let broker = Broker::new(recovered.clone());
    let confirm = workspace_write_runs::Request::with_confirmation("restart".into(),"main".into(), |_|async {panic!("Recovered root must not resume children")});
    assert_eq!(broker.invoke_authorized("main",request("restart","normal"),&confirm).await.unwrap_err().code,"outcome_unknown");
    assert!(!f.started("leaf")); assert_eq!(fs::read_to_string(f.effect("parent")).unwrap(),"restart\n"); recovered.close().await; f.finish().await;
}
