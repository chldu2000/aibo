//! Workspace-scoped capability writes use the host ledger, not provider assertions
//! of idempotence. Approval preparation reads metadata and package bytes only.
use super::*;
use crate::{workspace_write_runs, CoreError};

const OPERATION: &str = "capability.invoke";
fn core(error: Failure) -> CoreError { CoreError::WriteReplay { code: error.code, message: error.message } }
fn failure(error: CoreError) -> Failure {
    let value = serde_json::to_value(&error).unwrap_or(Value::Null);
    let code = match value["code"].as_str().unwrap_or("provider_unavailable") {
        "workspace_write_busy" => "busy",
        "workspace_trust_required" => "permission_denied",
        "invalid_workspace_path" => "invalid_input",
        code => code,
    };
    fail(code, value["message"].as_str().unwrap_or("Capability write could not settle"))
}
fn input(request: &Request) -> Value {
    json!({"scope":request.scope,"capability":request.capability,"contractVersion":request.version,"turnId":request.turn_id,"input":request.input})
}
impl Broker {
    /// Version probes are execution too: wait for process-group cleanup on timeout
    /// or cancellation rather than dropping a blocking registry diagnostic.
    pub(super) async fn check_executables(&self, manifest: &Value, chain: &Chain) -> Result<(), Failure> {
        for dependency in manifest["executableDependencies"].as_array().into_iter().flatten() {
            if dependency["required"] != true { continue; }
            let executable = crate::find_executable(dependency["name"].as_str().unwrap()).ok_or_else(||fail("provider_unavailable", "Executable dependency is unavailable"))?;
            let Some(range) = dependency["versionRange"].as_str() else { continue; };
            let remaining = chain.deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { return Err(fail("timeout", "Dependency inspection deadline expired")); }
            let mut command = tokio::process::Command::new(executable);
            command.arg("--version").env_clear();
            for name in ["SystemRoot", "WINDIR", "PATH", "LANG", "LC_ALL"] { if let Some(value) = std::env::var_os(name) { command.env(name,value); } }
            let output = crate::controlled_process::execute_cancellable(command, remaining.min(Duration::from_secs(2)), 8193, chain.cancelled()).await.map_err(|_|fail("provider_unavailable", "Executable version probe failed"))?;
            if output.cancelled { return Err(fail("cancelled", "Dependency inspection cancelled")); }
            if output.timed_out { return Err(fail("timeout", "Dependency inspection timed out")); }
            let mut bytes = output.stdout; let stderr = output.stderr;
            if !output.success || bytes.len() > 8192 || stderr.len() > 8192 { return Err(fail("provider_unavailable", "Executable version probe failed or exceeded output bounds")); }
            bytes.extend(stderr);
            let version = plugin_registry::parse_dependency_version(&String::from_utf8_lossy(&bytes));
            if !version.is_some_and(|version|semver::VersionReq::parse(range).is_ok_and(|range|range.matches(&version))) { return Err(fail("provider_unavailable", "Executable version does not satisfy its declaration")); }
        }
        Ok(())
    }

    /// Only the composition root supplies this non-deserializable native approval.
    /// A replay is checked before provider resolution, so disable/rebind cannot
    /// silently transfer an old write to another implementation.
    pub(crate) async fn invoke_authorized(&self, caller: &str, request: Request, approval: &workspace_write_runs::Request) -> Result<Response, Failure> {
        Self::identity(&request.scope, &request.capability, &request.version)?;
        if !approval.matches(&request.request_id, caller) || request.request_id.is_empty() || request.request_id.len() > 160 || request.input.to_string().len() > MAX_INPUT {
            return Err(fail("invalid_input", "Invalid capability request or host approval identity"));
        }
        let workspace_id: Option<String> = match &request.scope {
            Scope::Application => None,
            Scope::Workspace(id) => Some(id.clone()),
            Scope::Session(id) => sqlx::query_scalar("SELECT workspace_id FROM sessions WHERE id=?").bind(id).fetch_optional(&self.db).await.map_err(database)?,
        };
        let identity = input(&request);
        if let Some(workspace) = &workspace_id {
            if let Some(result) = workspace_write_runs::replay_requested(&self.db, workspace, OPERATION, &identity, approval).await.map_err(failure)? { return result.map_err(failure); }
        }
        let provider = self.provider(&request).await?;
        if provider.operation["effect"] == "read" { return self.invoke_selected(caller, request, provider, None, None).await; }
        let workspace = self.workspace(&request.scope).await?.ok_or_else(||fail("permission_denied", "Capability writes require a workspace"))?;
        self.validate_turn(&request).await?;
        if !jsonschema::options().build(&provider.operation["inputSchema"]).map_err(database)?.is_valid(&request.input) { return Err(fail("invalid_input", "Input does not match the capability contract")); }
        workspace_write_runs::execute_with_context(&self.db, &workspace, OPERATION, identity, approval,
            || self.prepare_write(&request, &provider, &workspace),
            |cancel| async {
                if cancel.is_requested().await { return Err(CoreError::WriteReplay { code:"cancelled".into(),message:"Capability was cancelled before dispatch".into() }); }
                // The runtime and its dependency probes are constructed only here,
                // after durable admission, native approval and context comparison.
                self.invoke_selected(caller, request.clone(), provider.clone(), None, Some(cancel)).await.map_err(|error| {
                    CoreError::WriteOutcomeUnknown(format!("{}; invocation {}", error.message, error.invocation_id.as_deref().unwrap_or("not assigned")))
                })
            }).await.map_err(failure)
    }

    async fn prepare_write(&self, request: &Request, provider: &Provider, workspace: &crate::Workspace) -> Result<Value, CoreError> {
        let current = self.workspace(&request.scope).await.map_err(core)?.ok_or(CoreError::WorkspaceTrustRequired)?;
        if current.id != workspace.id || current.path != workspace.path { return Err(CoreError::InvalidWorkspacePath("Capability workspace changed".into())); }
        self.validate_turn(request).await.map_err(core)?;
        let root = tokio::fs::canonicalize(&current.path).await.map_err(|error|CoreError::InvalidWorkspacePath(error.to_string()))?;
        let metadata = tokio::fs::metadata(&root).await.map_err(|error|CoreError::InvalidWorkspacePath(error.to_string()))?;
        if !metadata.is_dir() { return Err(CoreError::InvalidWorkspacePath("Capability workspace is not a directory".into())); }
        #[cfg(unix)] let root_identity = { use std::os::unix::fs::MetadataExt; json!({"device":metadata.dev(),"inode":metadata.ino()}) };
        #[cfg(not(unix))] let root_identity = json!({"created":metadata.created().ok().map(|value|format!("{value:?}"))});
        let selected = self.provider(request).await.map_err(core)?;
        if selected.installation_id != provider.installation_id || selected.contribution_id != provider.contribution_id || selected.digest != provider.digest || selected.operation != provider.operation {
            return Err(CoreError::InvalidWorkspacePath("Capability provider changed before approval".into()));
        }
        let (_, _, digest) = plugin_registry::inspect(&selected.directory).map_err(|_|CoreError::InvalidWorkspacePath("Capability package integrity check failed".into()))?;
        if digest != selected.digest { return Err(CoreError::InvalidWorkspacePath("Capability package changed".into())); }
        let dependencies = crate::plugin_dependencies::resolve_metadata(&self.db, &selected.installation_id).await.map_err(|_|CoreError::InvalidWorkspacePath("Capability dependencies changed".into()))?;
        if !dependencies.supports(&selected.contribution_id) { return Err(CoreError::InvalidWorkspacePath("Capability dependencies are unavailable".into())); }
        let (kind, id) = request.scope.key();
        let binding: String = sqlx::query_scalar("SELECT json_object('installationId',installation_id,'contributionId',contribution_id,'updatedAt',updated_at) FROM capability_provider_bindings WHERE scope_kind=? AND scope_id=? AND capability_id=? AND contract_version=?")
            .bind(kind).bind(id).bind(&request.capability).bind(&request.version).fetch_one(&self.db).await?;
        let session = if let Scope::Session(id) = &request.scope {
            let value: Option<String> = sqlx::query_scalar("SELECT json_object('id',id,'state',state,'archived',archived,'updatedAt',updated_at,'installationId',plugin_installation_id) FROM sessions WHERE id=? AND archived=0")
                .bind(id).fetch_optional(&self.db).await?;
            Some(value.ok_or_else(||CoreError::InvalidWorkspacePath("Capability session is archived or unavailable".into()))?)
        } else { None };
        let turn: Option<String> = if let Some(id) = &request.turn_id {
            sqlx::query_scalar("SELECT json_object('id',id,'status',status,'sessionId',session_id) FROM turns WHERE id=?").bind(id).fetch_optional(&self.db).await?
        } else { None };
        // Input is already rendered in full by the ledger. It is an operation
        // request, not a generic filesystem revision contract.
        Ok(json!({"schema":"aibo.capability-write-context/v1","root":root,"rootIdentity":root_identity,
            "workspaceId":current.id,"workspacePath":current.path,"workspaceTrust":current.trust,"workspaceUpdatedAt":current.updated_at,"session":session,"turn":turn,
            "provider":{"installationId":selected.installation_id,"contributionId":selected.contribution_id,"pluginId":selected.plugin_id,"packageDigest":digest,"operation":selected.operation},
            "dependencies":dependencies,"binding":binding,
            "approvalDescription":format!("能力插件：{}\n贡献：{}\n安装版本：{}\n权限：{}\n此请求允许插件在当前工作区执行写入；批准后才启动执行和依赖版本检查。宿主不提供任意本机代码的操作系统沙箱。",selected.plugin_id,selected.contribution_id,selected.installation_id,selected.operation["permissions"])}))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    const CAP: &str = "dev.aibo.capability-write.append";
    const CONTRIBUTION: &str = "dev.aibo.capability-write.writer";
    struct Fixture { root: PathBuf, db: SqlitePool, broker: Broker, installation: String }
    impl Fixture {
        async fn new() -> Self {
            let root = std::env::temp_dir().join(format!("aibo-capability-write-{}",ulid::Ulid::new()));
            let db = crate::open_database(&root.join("data/host.db")).await.unwrap();
            for id in ["a", "b"] {
                fs::create_dir_all(root.join(id)).unwrap();
                sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES(?,?,?,1,?,?)")
                    .bind(id).bind(root.join(id).to_str().unwrap()).bind(id).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
            }
            let package = root.join("package"); fs::create_dir_all(&package).unwrap();
            let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/capability-write/plugin.json")).unwrap();
            manifest["entrypoint"]["args"] = json!([root.join("started").to_str().unwrap()]);
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                let probe = root.join("version-probe");
                fs::write(&probe,format!("#!/bin/sh\ntouch '{}'\nprintf '1.0.0\\n'\n",root.join("version-ran").to_str().unwrap().replace('\'', "'\\''"))).unwrap();
                fs::set_permissions(&probe,fs::Permissions::from_mode(0o700)).unwrap();
                manifest["executableDependencies"].as_array_mut().unwrap().push(json!({"kind":"executable","name":probe.to_str().unwrap(),"versionRange":">=1","required":true}));
            }
            fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
            fs::write(package.join("worker.mjs"),include_str!("../../fixtures/plugins/capability-write/worker.mjs")).unwrap();
            let installed = plugin_registry::install(&db,&root.join("data"),&package).await.unwrap(); assert!(installed.runnable);
            plugin_registry::enable(&db,&installed.id,true).await.unwrap();
            let broker = Broker::new(db.clone());
            for id in ["a", "b"] { broker.bind(Binding {scope:Scope::Workspace(id.into()),capability:CAP.into(),version:"1.0.0".into(),installation_id:installed.id.clone(),contribution_id:CONTRIBUTION.into()}).await.unwrap(); }
            #[cfg(unix)] { assert!(root.join("version-ran").exists(), "positive control must execute the configured version probe"); fs::remove_file(root.join("version-ran")).unwrap(); }
            Self { root, db, broker, installation:installed.id }
        }
        async fn rows(&self) -> Vec<Value> {
            serde_json::to_value(workspace_write_runs::list(&self.db,"a".into(),None).await.unwrap()).unwrap().as_array().unwrap().clone()
        }
        async fn finish(self) {
            self.broker.stop_installation(&self.installation).await.unwrap(); self.db.close().await; fs::remove_dir_all(self.root).unwrap();
        }
    }
    fn request(id: &str, mode: &str) -> Request { Request {scope:Scope::Workspace("a".into()),capability:CAP.into(),version:"1.0.0".into(),request_id:id.into(),turn_id:None,input:json!({"value":id,"mode":mode})} }
    fn approve(id: &str) -> workspace_write_runs::Request { workspace_write_runs::Request::with_confirmation(id.into(),"main".into(), |_|async {Ok(true)}) }
    async fn wait_effect(root: &std::path::Path) {
        tokio::time::timeout(Duration::from_secs(8),async {while !root.join("a/effect.txt").exists() {tokio::time::sleep(Duration::from_millis(10)).await;}}).await.unwrap();
    }

    #[tokio::test]
    async fn native_authority_denial_and_durable_replay_survive_uninstall_and_trust_revocation() {
        let f = Fixture::new().await;
        assert_eq!(f.broker.invoke("main",request("bypass","normal")).await.unwrap_err().code,"permission_denied");
        let root = f.root.clone(); let db = f.db.clone();
        let deny = workspace_write_runs::Request::with_confirmation("denied".into(),"main".into(),move |message| {
            let root = root.clone(); let db = db.clone(); async move {
                assert!(message.contains(CAP) && message.contains("workspace.write")); assert!(!root.join("started").exists()); assert!(!root.join("version-ran").exists());
                let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspace_write_runs WHERE status='awaiting_approval'").fetch_one(&db).await.unwrap(); assert_eq!(pending,1);
                assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM capability_invocations").fetch_one(&db).await.unwrap(),0);
                assert!(matches!(crate::workspace_writes::acquire(&db,"a",&root.join("a")).await,Err(CoreError::WorkspaceWriteBusy)));
                Ok(false)
            }
        });
        assert_eq!(f.broker.invoke_authorized("main",request("denied","normal"),&deny).await.unwrap_err().code,"approval_rejected");
        assert!(!f.root.join("started").exists()); assert!(!f.root.join("a/effect.txt").exists());
        let result = f.broker.invoke_authorized("main",request("once","normal"),&approve("once")).await.unwrap();
        #[cfg(unix)] assert!(f.root.join("version-ran").exists());
        assert_eq!(result.output["caller"],"main"); assert_eq!(result.output["permissions"],json!(["workspace.read","workspace.write"]));
        assert_eq!(fs::read_to_string(f.root.join("started")).unwrap(),"started\n");
        assert_eq!(fs::read_to_string(f.root.join("a/effect.txt")).unwrap(),"once\n");
        let linked: String = sqlx::query_scalar("SELECT write_run_id FROM capability_invocations WHERE id=?").bind(&result.invocation_id).fetch_one(&f.db).await.unwrap();
        assert_eq!(f.rows().await.iter().find(|row|row["requestId"] == "once").unwrap()["id"],linked);
        plugin_registry::enable(&f.db,&f.installation,false).await.unwrap();
        plugin_registry::uninstall(&f.db,&f.root.join("data"),&f.installation).await.unwrap();
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='a'").execute(&f.db).await.unwrap();
        let never = workspace_write_runs::Request::with_confirmation("once".into(),"main".into(), |_|async {panic!("replay must not prompt")});
        let replay = Broker::new(f.db.clone()).invoke_authorized("main",request("once","normal"),&never).await.unwrap();
        assert_eq!(replay.invocation_id,result.invocation_id);
        let denied_replay = f.broker.invoke_authorized("main",request("denied","normal"),&approve("denied")).await.unwrap_err(); assert_eq!(denied_replay.code,"approval_rejected");
        let mut changed = request("once","normal"); changed.input["value"] = json!("different");
        assert_eq!(f.broker.invoke_authorized("main",changed,&never).await.unwrap_err().code,"invalid_input");
        assert_eq!(f.broker.invoke_authorized("other",request("once","normal"),&workspace_write_runs::Request::with_confirmation("once".into(),"other".into(), |_|async {Ok(true)})).await.unwrap_err().code,"invalid_input");
        assert_eq!(fs::read_to_string(f.root.join("a/effect.txt")).unwrap(),"once\n"); f.finish().await;
    }

    #[tokio::test]
    async fn approval_changes_and_pending_cancellation_prevent_process_start() {
        for change in ["trust", "binding", "package", "cancel", "disable", "workspace"] {
            let f = Fixture::new().await; let broker = f.broker.clone(); let db = f.db.clone(); let installation = f.installation.clone(); let root = f.root.clone();
            let approval = workspace_write_runs::Request::with_confirmation(change.into(),"main".into(),move |_| {
                let broker = broker.clone(); let db = db.clone(); let installation = installation.clone(); let root = root.clone(); async move {
                    assert!(!root.join("started").exists());
                    match change {
                        "trust" => {sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='a'").execute(&db).await.unwrap();},
                        "binding" => {sqlx::query("DELETE FROM capability_provider_bindings WHERE scope_id='a'").execute(&db).await.unwrap();},
                        "package" => {let path: String = sqlx::query_scalar("SELECT install_path FROM plugin_installations WHERE id=?").bind(&installation).fetch_one(&db).await.unwrap(); fs::write(PathBuf::from(path).join("worker.mjs"),"throw Error('changed')").unwrap();},
                        "cancel" => {assert!(!broker.cancel("other",change).await); assert!(broker.cancel("main",change).await);},
                        "disable" => {plugin_registry::enable(&db,&installation,false).await.unwrap(); broker.stop_installation(&installation).await.unwrap();},
                        "workspace" => {fs::create_dir_all(root.join("replacement")).unwrap(); sqlx::query("UPDATE workspaces SET path=? WHERE id='a'").bind(root.join("replacement").to_str().unwrap()).execute(&db).await.unwrap();},
                        _ => unreachable!(),
                    }
                    Ok(true)
                }
            });
            assert_eq!(f.broker.invoke_authorized("main",request(change,"normal"),&approval).await.unwrap_err().code,"approval_rejected", "{change}");
            assert!(!f.root.join("started").exists()); assert!(!f.root.join("a/effect.txt").exists()); f.finish().await;
        }
    }

    #[tokio::test]
    async fn cancellation_timeout_crash_and_invalid_output_are_unknown_without_retry() {
        for mode in ["cancel", "slow", "crash", "invalid-output"] {
            let f = Fixture::new().await; let broker = f.broker.clone(); let req = request(mode,if mode == "cancel" {"slow"} else {mode}); let again = req.clone();
            let task = tokio::spawn(async move {broker.invoke_authorized("main",req,&approve(mode)).await});
            wait_effect(&f.root).await;
            if mode == "cancel" {
                assert!(!f.broker.cancel("other",mode).await); assert!(f.broker.cancel("main",mode).await);
                let mut other = request("independent","normal"); other.scope = Scope::Workspace("b".into());
                assert!(f.broker.invoke_authorized("main",other,&approve("independent")).await.is_ok());
            }
            assert_eq!(task.await.unwrap().unwrap_err().code,"outcome_unknown");
            let row = f.rows().await.into_iter().find(|row|row["requestId"] == mode).unwrap(); assert_eq!(row["status"],"outcome_unknown");
            assert_eq!(f.broker.invoke_authorized("main",again,&approve(mode)).await.unwrap_err().code,"outcome_unknown");
            assert_eq!(fs::read_to_string(f.root.join("a/effect.txt")).unwrap(),format!("{mode}\n"));
            if mode == "cancel" || mode == "slow" {tokio::time::sleep(Duration::from_millis(3200)).await; assert!(!f.root.join("a/late.txt").exists());}
            assert!(crate::workspace_writes::acquire(&f.db,"a",&f.root.join("a")).await.is_ok()); f.finish().await;
        }
    }

    #[tokio::test]
    async fn duplicate_pending_and_failed_settlement_never_reexecute() {
        let f = Fixture::new().await; let broker = f.broker.clone();
        let (entered, ready) = tokio::sync::oneshot::channel(); let entered = Arc::new(Mutex::new(Some(entered)));
        let (release, wait) = watch::channel(false);
        let approval = workspace_write_runs::Request::with_confirmation("pending".into(),"main".into(),move |_| {let entered = entered.clone(); let mut wait = wait.clone(); async move {entered.lock().await.take().unwrap().send(()).unwrap(); wait.changed().await.unwrap(); Ok(true)}});
        let pending = tokio::spawn(async move {broker.invoke_authorized("main",request("pending","normal"),&approval).await});
        ready.await.unwrap();
        assert_eq!(f.broker.invoke_authorized("main",request("pending","normal"),&approve("pending")).await.unwrap_err().code,"busy");
        assert_eq!(f.broker.invoke_authorized("main",request("other","normal"),&approve("other")).await.unwrap_err().code,"busy");
        release.send(true).unwrap(); pending.await.unwrap().unwrap();
        sqlx::raw_sql("CREATE TRIGGER fail_write_settlement BEFORE UPDATE ON workspace_write_runs WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture settlement'); END;").execute(&f.db).await.unwrap();
        assert_eq!(f.broker.invoke_authorized("main",request("unsettled","normal"),&approve("unsettled")).await.unwrap_err().code,"outcome_unknown");
        assert_eq!(f.broker.invoke_authorized("main",request("unsettled","normal"),&approve("unsettled")).await.unwrap_err().code,"busy");
        workspace_write_runs::recover(&f.db).await.unwrap(); Broker::recover(&f.db).await.unwrap();
        assert_eq!(f.broker.invoke_authorized("main",request("unsettled","normal"),&approve("unsettled")).await.unwrap_err().code,"outcome_unknown");
        assert_eq!(fs::read_to_string(f.root.join("a/effect.txt")).unwrap(),"pending\nunsettled\n"); f.finish().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn approved_version_probe_cancellation_stops_descendants_before_settlement() {
        let f = Fixture::new().await;
        let quoted = |name: &str| f.root.join(name).to_str().unwrap().replace('\'', "'\\''");
        fs::write(f.root.join("version-probe"),format!("#!/bin/sh\ntouch '{}'\n(sleep 3; touch '{}') &\nwait\nprintf '1.0.0\\n'\n",quoted("probe-running"),quoted("probe-late"))).unwrap();
        let broker = f.broker.clone();
        let task = tokio::spawn(async move {broker.invoke_authorized("main",request("probe","normal"),&approve("probe")).await});
        tokio::time::timeout(Duration::from_secs(8),async {while !f.root.join("probe-running").exists() {tokio::time::sleep(Duration::from_millis(10)).await;}}).await.unwrap();
        assert!(f.broker.cancel("main","probe").await);
        assert_eq!(task.await.unwrap().unwrap_err().code,"outcome_unknown"); assert!(!f.root.join("started").exists());
        tokio::time::sleep(Duration::from_millis(3200)).await; assert!(!f.root.join("probe-late").exists());
        assert!(crate::workspace_writes::acquire(&f.db,"a",&f.root.join("a")).await.is_ok()); f.finish().await;
    }

    #[tokio::test]
    async fn session_scope_and_recovery_keep_write_authority_and_history_explicit() {
        let f = Fixture::new().await;
        let package = f.root.join("package");
        let mut manifest: Value = serde_json::from_str(&fs::read_to_string(package.join("plugin.json")).unwrap()).unwrap();
        manifest["version"] = json!("1.0.1"); manifest["contributions"][0]["scope"] = json!("session");
        fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
        let installed = plugin_registry::install(&f.db,&f.root.join("data"),&package).await.unwrap(); plugin_registry::enable(&f.db,&installed.id,true).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES('session','a','fixture','session','idle',?,?,?)")
            .bind(crate::now_iso()).bind(crate::now_iso()).bind(&installed.id).execute(&f.db).await.unwrap();
        f.broker.bind(Binding {scope:Scope::Session("session".into()),capability:CAP.into(),version:"1.0.0".into(),installation_id:installed.id.clone(),contribution_id:CONTRIBUTION.into()}).await.unwrap();
        let mut req = request("session","normal"); req.scope = Scope::Session("session".into());
        let result = f.broker.invoke_authorized("main",req.clone(),&approve("session")).await.unwrap();
        // A crash before the two independent durable settlements must not invent
        // successful or read-only recovery for a write-associated invocation.
        sqlx::query("UPDATE capability_invocations SET status='running' WHERE id=?").bind(&result.invocation_id).execute(&f.db).await.unwrap();
        sqlx::query("UPDATE workspace_write_runs SET status='running',result_json=NULL WHERE request_id='session'").execute(&f.db).await.unwrap();
        workspace_write_runs::recover(&f.db).await.unwrap(); Broker::recover(&f.db).await.unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM capability_invocations WHERE id=?").bind(&result.invocation_id).fetch_one(&f.db).await.unwrap(); assert_eq!(status,"outcome_unknown");
        assert_eq!(f.broker.invoke_authorized("main",req,&approve("session")).await.unwrap_err().code,"outcome_unknown");
        let db = f.db.clone(); let approval = workspace_write_runs::Request::with_confirmation("archived".into(),"main".into(),move |_| {let db = db.clone(); async move {sqlx::query("UPDATE sessions SET archived=1 WHERE id='session'").execute(&db).await.unwrap(); Ok(true)}});
        let mut req = request("archived","normal"); req.scope = Scope::Session("session".into());
        assert_eq!(f.broker.invoke_authorized("main",req,&approval).await.unwrap_err().code,"approval_rejected");
        assert_eq!(fs::read_to_string(f.root.join("a/effect.txt")).unwrap(),"session\n"); f.finish().await;
    }

    #[test]
    fn supported_writes_require_workspace_permission_and_a_resource_scope() {
        let manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/capability-write/plugin.json")).unwrap();
        let supported = |value: &Value| {let model = plugin_manifest::normalize(value).unwrap(); plugin_manifest::contribution_supported(&model.contributions[0],value)};
        assert!(supported(&manifest));
        for (effect, permissions, scope) in [("write",json!(["workspace.read"]),"workspace"),("read",json!(["workspace.write"]),"workspace"),("write",json!(["workspace.write","network.write"]),"workspace"),("write",json!(["workspace.write"]),"application")] {
            let mut value = manifest.clone(); let entry = &mut value["contributions"][0]; entry["scope"] = json!(scope); entry["operations"][0]["effect"] = json!(effect); entry["operations"][0]["permissions"] = permissions;
            assert!(!supported(&value));
        }
    }

}
