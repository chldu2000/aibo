//! Host-owned conversations. All execution and process ownership belong to the capability Broker.
#[path = "session_projection.rs"]
mod projection;
#[path = "session_fork.rs"]
mod fork;
#[path = "session_tools.rs"]
mod tools;
#[path = "session_queue.rs"]
mod queue;
use crate::{capability_broker::{Binding, Broker, CapabilityControl, EventObserver, Request, Response, Scope},
    change_set::{capture as capture_workspace, persist as persist_change_set, WorkspaceSnapshot}, execution_profile, plugin_registry, Session};
use serde_json::{json,Value};
use sqlx::SqlitePool;
use std::{collections::HashMap,path::{Path,PathBuf},sync::{Arc,Weak,atomic::{AtomicBool,Ordering}},time::Duration};
use tauri::{Emitter,Manager};
use tokio::sync::{watch, Mutex, OwnedMutexGuard};

#[derive(Clone,Copy,PartialEq,Eq)]
enum EventOrigin { Plugin, CoreTool, Host }
fn event_capability_required(kind:&str,origin:EventOrigin)->Option<&'static str> {
    if origin!=EventOrigin::Plugin {return None;}
    match kind {
        "approval.requested"|"approval.resolved"=>Some("approval.respond"),
        "user_input.requested"|"user_input.resolved"=>Some("user-input.respond"),
        "queue.updated"=>Some("queue.manage"),
        "goal.updated"=>Some("goal.manage"),
        "compaction.started"|"compaction.completed"=>Some("compaction.run"),
        _=>None,
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum TurnPhase { Starting, Running, Settling, Finished }
#[derive(Clone)]
struct LiveTurn {
    caller:String, request_id:String, cancel:Arc<AtomicBool>,
    phase:watch::Sender<TurnPhase>, pi_branch:Option<Arc<Vec<crate::TimelineItem>>>,
}

// Only observational calls may wait for the next idle state. Never replay a
// model change, queue operation, approval, or other interaction after a turn.
fn passive_session_read(capability: &str, input: &Value) -> bool {
    match capability {
        "session.snapshot" | "command.list" | "skill.list" => true,
        "model.select" | "model.reasoning" | "model.service-tier" | "model.context-window" => input["action"] == "list",
        "session.tree" => input["action"] == "get",
        _ => false,
    }
}
#[derive(Clone)]
struct SessionExecution {broker:Broker,caller:String,request_id:String,generation_id:String,write_authorized:bool}
impl SessionExecution {
    async fn ensure_live(&self)->Result<(),String> {
        if self.broker.request_is_live(&self.caller,&self.request_id,&self.generation_id).await {Ok(())} else {Err("cancelled: session invocation is no longer active".into())}
    }
    async fn cancelled(&self) {while self.ensure_live().await.is_ok() {tokio::time::sleep(Duration::from_millis(20)).await;}}
    async fn reply(&self,id:Value,result:Result<Value,String>)->Result<(),String> {
        self.ensure_live().await?;
        let input=match result {Ok(result)=>json!({"requestId":id,"result":result}),Err(error)=>json!({"requestId":id,"error":error})};
        match self.broker.control(&self.caller,CapabilityControl {request_id:self.request_id.clone(),capability:"aibo.session.tool.respond".into(),version:"1.0.0".into(),input}).await {
            Ok(_) => Ok(()),
            Err(error) => {
                // A revoked scope can reject even an error reply. Do not leave
                // the provider waiting indefinitely for an unavailable control.
                self.broker.cancel(&self.caller, &self.request_id).await;
                Err(error.message)
            }
        }
    }
}
struct PendingPluginTool {runtime:SessionExecution,request_id:Value,session_id:String,workspace_id:String,generation_id:String,turn_id:Option<String>,tool:String,input:Value}
#[derive(Clone)]
pub(crate) struct SessionHost {
    db:SqlitePool,broker:Broker,operations:Arc<Mutex<HashMap<String,Weak<Mutex<()>>>>>,database_writes:Arc<Mutex<()>>,
    live:Arc<Mutex<HashMap<String,LiveTurn>>>,pending_tools:Arc<Mutex<HashMap<String,PendingPluginTool>>>,
    turn_baselines:Arc<Mutex<HashMap<String,Option<WorkspaceSnapshot>>>>,app:Option<tauri::AppHandle>,
}
impl SessionHost {
    pub fn new(db:SqlitePool,broker:Broker)->Self {Self {db,broker,operations:Default::default(),database_writes:Default::default(),live:Default::default(),pending_tools:Default::default(),turn_baselines:Default::default(),app:None}}
    // Serialize each session's open + operation + recovery persistence, not the
    // whole host. Weak entries disappear once callers and waiters have left.
    pub(crate) async fn session_operation(&self, session_id: &str) -> OwnedMutexGuard<()> {
        let gate = {
            let mut operations = self.operations.lock().await;
            operations.retain(|_, gate| gate.strong_count() > 0);
            match operations.get(session_id).and_then(Weak::upgrade) {
                Some(gate) => gate,
                None => {
                    let gate = Arc::new(Mutex::new(()));
                    operations.insert(session_id.to_owned(), Arc::downgrade(&gate));
                    gate
                }
            }
        };
        gate.lock_owned().await
    }
    pub fn with_app(db:SqlitePool,broker:Broker,app:tauri::AppHandle)->Self {Self {app:Some(app),..Self::new(db,broker)}}
    pub async fn uninstall(&self,data_dir:&Path,installation:&str)->Result<(),String> {
        let ids:Vec<String>=sqlx::query_scalar("SELECT id FROM sessions WHERE plugin_installation_id=?").bind(installation).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
        for id in ids {let caller=self.live.lock().await.get(&id).map(|run|run.caller.clone()).unwrap_or("main".into());self.close_from(&caller,&id).await?;}
        plugin_registry::uninstall(&self.db,data_dir,installation).await
    }
    pub async fn close_workspace(&self,workspace:&str)->Result<(),String> {
        let ids:Vec<String>=sqlx::query_scalar("SELECT id FROM sessions WHERE workspace_id=?").bind(workspace).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
        for id in ids {let caller=self.live.lock().await.get(&id).map(|run|run.caller.clone()).unwrap_or("main".into());self.close_from(&caller,&id).await?;}Ok(())
    }
    async fn metadata(&self,session_id:&str)->Result<(Session,Value),String> {
        let session=crate::session_by_id(&self.db,session_id).await.map_err(|e|e.to_string())?;
        let installation=session.plugin_installation_id.as_deref().ok_or("history_only: create a new capability session")?;
        let raw:Option<String>=sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=? AND enabled=1 AND installed=1").bind(installation).fetch_optional(&self.db).await.map_err(|e|e.to_string())?;
        let manifest:Value=serde_json::from_str(&raw.ok_or("provider_unavailable: pinned release is disabled or missing")?).map_err(|e|e.to_string())?;
        if manifest["schema"]!="aibo.plugin-manifest/v2" || !crate::plugin_manifest::normalize(&manifest)?.contributions.iter().any(|entry|entry.id==session.agent && entry.kind=="capabilityProvider" && entry.scope=="session" && entry.metadata["operations"].as_array().is_some_and(|ops|ops.iter().any(|op|op["capability"]["id"]=="aibo.session.open"))) {
            return Err("history_only: this session uses the retired Agent runtime".into());
        }
        Ok((session,manifest))
    }
    fn binding(session:&Session,capability:&str)->Result<Binding,String> {Ok(Binding {scope:Scope::Session(session.id.clone()),capability:capability.into(),version:"1.0.0".into(),installation_id:session.plugin_installation_id.clone().ok_or("history_only")?,contribution_id:session.agent.clone()})}
    async fn saved_binding(&self,session_id:&str)->Result<Option<Value>,String> {
        let raw:Option<String>=sqlx::query_scalar("SELECT plugin_binding_json FROM session_bindings WHERE session_id=?").bind(session_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?.flatten();
        raw.map(|raw| {
            let value:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
            if !crate::session_contract::binding_schema().is_valid(&value) {return Err("history_only: old session binding cannot execute".into());} Ok(value)
        }).transpose()
    }
    pub async fn create_with_profile_from(&self,caller:&str,workspace_id:&str,installation_id:&str,contribution_id:&str,profile:Option<execution_profile::ResolvedExecutionProfile>)->Result<Session,String> {
        let workspace=crate::workspace_by_id(&self.db,workspace_id).await.map_err(|e|e.to_string())?;
        if workspace.trust!="trusted" {return Err("permission_denied: workspace trust required".into());}
        let id=ulid::Ulid::new().to_string();let now=crate::now_iso();
        let _guard=self.session_operation(&id).await;
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES(?,?,?,?,'starting',?,?,?)")
            .bind(&id).bind(workspace_id).bind(contribution_id).bind(crate::DEFAULT_CAPABILITY_SESSION_LABEL).bind(&now).bind(&now).bind(installation_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        let profile=match profile {Some(profile)=>profile,None=>execution_profile::resolve(contribution_id,None,now)?};
        execution_profile::save_for_session(&self.db,&id,&profile).await.map_err(|e|e.to_string())?;
        if let Err(error)=self.open(caller,&id).await {
            let _=sqlx::query("UPDATE sessions SET state='failed' WHERE id=?").bind(&id).execute(&self.db).await;return Err(error);
        }
        crate::session_by_id(&self.db,&id).await.map_err(|e|e.to_string())
    }
    pub async fn resume_from(&self,caller:&str,session_id:&str)->Result<(),String> {
        let _guard=self.session_operation(session_id).await;
        if self.live.lock().await.contains_key(session_id) {return Ok(());}
        self.open(caller,session_id).await
    }
    async fn open(&self,caller:&str,session_id:&str)->Result<(),String> {
        let (session,manifest)=self.metadata(session_id).await?;
        if session.archived || session.state=="closed" {return Err("invalid_session: session is closed".into());}
        let previous=self.saved_binding(session_id).await?;
        if previous.is_some() {
            let saved_generation:String=sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?")
                .bind(session_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
            let installation=session.plugin_installation_id.as_deref().ok_or("history_only")?;
            if self.broker.session_runtime_generation(installation,&session.agent,session_id).await.as_deref()==Some(saved_generation.as_str()) {return Ok(());}
        }
        let profile=crate::session_execution_profile(&self.db,session_id).await.map_err(|e|e.to_string())?.profile;
        let binding=Self::binding(&session,"aibo.session.open")?;
        let request=Request {scope:binding.scope.clone(),capability:binding.capability.clone(),version:binding.version.clone(),request_id:ulid::Ulid::new().to_string(),turn_id:None,input:json!({"mode":if previous.is_some(){"resume"}else{"create"},"executionProfile":profile.enforced,"recovery":previous.as_ref().map(|b|&b["recovery"])})};
        let result=self.broker.invoke_bound(caller,request,&binding).await.map_err(|e|e.message)?;
        let now=crate::now_iso();
        let document=json!({"schema":"aibo.session-binding/v2","sessionId":session_id,"pluginInstallationId":session.plugin_installation_id,"pluginId":manifest["pluginId"],"pluginVersion":manifest["version"],"agentId":session.agent,"nativeSessionId":result.output["nativeSessionId"],"runtimeProtocolVersion":"2.1","recovery":result.output["recovery"],"createdAt":previous.as_ref().map(|b|b["createdAt"].clone()).unwrap_or(json!(now)),"updatedAt":now});
        if !crate::session_contract::binding_schema().is_valid(&document) {return Err("invalid_output: session binding".into());}
        let mut tx=self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO session_bindings(session_id,external_session_id,generation_id,adapter_version,bound_at,plugin_binding_json,plugin_capabilities_json) VALUES(?,?,?,'2.1',?,?,?) ON CONFLICT(session_id) DO UPDATE SET external_session_id=excluded.external_session_id,generation_id=excluded.generation_id,adapter_version='2.1',bound_at=excluded.bound_at,plugin_binding_json=excluded.plugin_binding_json,plugin_capabilities_json=excluded.plugin_capabilities_json")
            .bind(session_id).bind(result.output["nativeSessionId"].as_str()).bind(&result.generation_id).bind(&now).bind(document.to_string()).bind(result.output["capabilities"].to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        sqlx::query("UPDATE sessions SET state='idle',updated_at=? WHERE id=?").bind(now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        tx.commit().await.map_err(|e|e.to_string())?;Ok(())
    }
    fn observer(&self,session:Session,binding:Value,caller:String,request_id:String,turn_id:Option<String>,write_authorized:bool)->EventObserver {
        let host=self.clone();
        Arc::new(move |stream| {
            let host=host.clone();let session=session.clone();let binding=binding.clone();let caller=caller.clone();let request_id=request_id.clone();let turn_id=turn_id.clone();
            Box::pin(async move {
                let event=stream["event"].clone();
                if let Some(run) = host.live.lock().await.get(&session.id) {
                    if Some(&run.request_id) == turn_id.as_ref() && *run.phase.borrow() == TurnPhase::Starting {
                        run.phase.send_replace(TurnPhase::Running);
                    }
                }
                if !crate::session_contract::event_schema().is_valid(&event) || event["nativeSessionId"]!=binding["nativeSessionId"] || event["turnId"].as_str().is_some_and(|id|Some(id)!=turn_id.as_deref()) {return Err("invalid_output: session event identity".into());}
                let generation=stream["generationId"].as_str().ok_or("invalid_output: generation missing")?;
                if event["type"]=="workspace.requested" {
                    let runtime=SessionExecution {broker:host.broker.clone(),caller,request_id,generation_id:generation.into(),write_authorized};
                    host.handle_tool_request(&session.id,&session.workspace_id,&runtime,&binding,event).await
                } else {
                    // Provider buffers must never overwrite the host's durable waiting queue.
                    if event["type"] == "queue.updated" && host.host_queue_supported(&session.id).await? { return Ok(()); }
                    let started = event["type"] == "turn.started";
                    host.project_event(&session.id,&session.workspace_id,generation,&binding,event,EventOrigin::Plugin).await?;
                    if started { if let Some(turn) = turn_id { host.acknowledge_queued_turn(&session.id, &turn).await?; } }
                    Ok(())
                }
            })
        })
    }
    #[cfg(test)]
    pub async fn send_from(&self,caller:&str,session_id:&str,text:&str,approval:Option<crate::workspace_write_runs::Request>)->Result<(),String> {
        let _guard=self.session_operation(session_id).await;
        self.send_admitted(caller, session_id, text, approval).await
    }
    pub(crate) async fn send_configured_from(&self,caller:&str,session_id:&str,text:&str)->Result<(),String> {
        let _queue_guard = self.session_operation(&format!("queue:{session_id}")).await;
        let _guard=self.session_operation(session_id).await;
        let queued: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM queued_messages WHERE session_id=?").bind(session_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
        if self.live.lock().await.contains_key(session_id) || queued > 0 {
            self.enqueue_admitted(caller, session_id, text).await?;
            self.schedule_queue(session_id.into());
            return Ok(());
        }
        let approval = crate::session_permissions::turn_request(&self.db, session_id, caller).await?;
        self.send_admitted(caller, session_id, text, Some(approval)).await
    }
    async fn send_admitted(&self,caller:&str,session_id:&str,text:&str,approval:Option<crate::workspace_write_runs::Request>)->Result<(),String> {
        self.run_admitted(caller, session_id, text, approval, false, None).await
    }
    async fn run_admitted(&self,caller:&str,session_id:&str,text:&str,approval:Option<crate::workspace_write_runs::Request>,goal_resume:bool,queue_id:Option<&str>)->Result<(),String> {
        if text.trim().is_empty() || text.len()>200_000 {return Err("invalid_input: prompt length".into());}
        if self.live.lock().await.contains_key(session_id) {return Err("busy: session has an active invocation".into());}
        self.open(caller,session_id).await?;
        let (session,_)=self.metadata(session_id).await?;
        if goal_resume && !session.capabilities.iter().any(|capability| capability == "goal.resume") {return Err("capability_unsupported: goal.resume".into());}
        let saved=self.saved_binding(session_id).await?.ok_or("invalid_session: no native binding")?;
        let profile=crate::session_execution_profile(&self.db,session_id).await.map_err(|e|e.to_string())?.profile.enforced;
        let write=profile.filesystem_policy!="read-only" || (profile.interaction_mode=="edit" && profile.command_policy!="disabled");
        if write && approval.is_none() {return Err("approval_required: writable turn requires a host confirmation".into());}
        let capability=match (goal_resume,write) {
            (true,true)=>"aibo.session.goal.resume.write", (true,false)=>"aibo.session.goal.resume",
            (false,true)=>"aibo.session.turn.write", (false,false)=>"aibo.session.turn",
        };
        let binding=Self::binding(&session,capability)?;
        // Freeze the active Pi branch before this turn. Runtime queries are not
        // needed to display its accepted user message or subsequent streamed rows.
        let pi_branch = if session.agent == "dev.aibo.pi.agent" {
            let binding = Self::binding(&session, "dev.aibo.pi.session.snapshot")?;
            let response = self.broker.invoke_bound(caller, Request {
                scope:binding.scope.clone(), capability:binding.capability.clone(), version:"1.0.0".into(),
                request_id:ulid::Ulid::new().to_string(), turn_id:None, input:json!({}),
            }, &binding).await.map_err(|e| e.message)?;
            self.save_recovery(session_id, &response).await?;
            Some(Arc::new(crate::pi_snapshot_timeline(&response.output, session_id)))
        } else { None };
        let turn=ulid::Ulid::new().to_string();let message=ulid::Ulid::new().to_string();let now=crate::now_iso();
        let workspace=crate::workspace_by_id(&self.db,&session.workspace_id).await.map_err(|e|e.to_string())?;
        let baseline=capture_workspace(Path::new(&workspace.path)).await.ok();
        let mut live=self.live.lock().await;
        if live.contains_key(session_id) {return Err("busy: session has an active invocation".into());}
        let mut tx=self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        let changed=sqlx::query("UPDATE sessions SET state='running',updated_at=? WHERE id=? AND state IN ('idle','interrupted','failed')").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        if changed.rows_affected()!=1 {return Err("busy: session is not idle".into());}
        sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES(?,?,?,'running',?,?)").bind(&turn).bind(session_id).bind(&turn).bind(text).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES(?,?,?,'user',?,'completed',?,?)").bind(&message).bind(session_id).bind(&turn).bind(text).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        let attachments:Vec<String>=if goal_resume {vec![]} else {sqlx::query_scalar("SELECT id FROM attachments WHERE session_id=? AND turn_id IS NULL AND queued_message_id IS ? ORDER BY created_at").bind(session_id).bind(queue_id).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?};
        if !goal_resume {sqlx::query("UPDATE attachments SET turn_id=? WHERE session_id=? AND turn_id IS NULL AND queued_message_id IS ?").bind(&turn).bind(session_id).bind(queue_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;}
        if queue_id.is_none() && !goal_resume {
            sqlx::query("UPDATE session_queues SET paused=0 WHERE session_id=? AND NOT EXISTS(SELECT 1 FROM queued_messages WHERE session_id=?)")
                .bind(session_id).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        if let Some(id) = queue_id {
            sqlx::query("UPDATE queued_messages SET status='sending',delivery='turn',turn_id=?,error=NULL WHERE id=? AND session_id=?")
                .bind(&turn).bind(id).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        tx.commit().await.map_err(|e|e.to_string())?;
        let (phase, _) = watch::channel(TurnPhase::Starting);
        let run=LiveTurn {caller:caller.into(),request_id:turn.clone(),cancel:Arc::new(AtomicBool::new(false)),phase,pi_branch};live.insert(session_id.into(),run.clone());drop(live);
        self.turn_baselines.lock().await.insert(turn.clone(),baseline);
        let _=crate::auto_name_session_from_first_message(&self.db,session_id,&message,text).await;
        let request=Request {scope:binding.scope.clone(),capability:capability.into(),version:"1.0.0".into(),request_id:turn.clone(),turn_id:Some(turn.clone()),input:if goal_resume {json!({})} else {json!({"text":text,"attachments":attachments.into_iter().map(|id|json!({"attachmentId":id})).collect::<Vec<_>>()})}};
        let observer=self.observer(session.clone(),saved.clone(),caller.into(),turn.clone(),Some(turn.clone()),write);
        let host=self.clone();let caller=caller.to_owned();
        tokio::spawn(async move {
            let execution=async {
                if run.cancel.load(Ordering::Acquire) {return Err("cancelled: turn cancelled before dispatch".into());}
                let result=if let Some(approval)=approval.filter(|_|write) {
                    host.broker.invoke_bound_authorized_observed(&caller,request,&binding,&approval.child(turn.clone()),Some(observer)).await
                } else {
                    host.broker.invoke_bound_observed(&caller,request,&binding,Some(observer)).await
                };
                result.map_err(|e|format!("{}: {}",e.code,e.message))
            };
            tokio::pin!(execution);
            let cancel=async {loop {if run.cancel.load(Ordering::Acquire) && host.broker.cancel(&caller,&turn).await {break;}tokio::time::sleep(Duration::from_millis(10)).await;}};
            let result=tokio::select! {result=&mut execution=>result,_=cancel=>execution.await};
            run.phase.send_replace(TurnPhase::Settling);
            let result = match result {
                Ok(response) => host.save_recovery(&session.id, &response).await,
                Err(error) => Err(error),
            };
            if let Err(error) = result {
                let failure = async {
                    let generation: String = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?")
                        .bind(&session.id).fetch_one(&host.db).await.map_err(|e| e.to_string())?;
                    host.project_event(&session.id, &session.workspace_id, &generation, &saved,
                        json!({"nativeSessionId":saved["nativeSessionId"],"turnId":turn,"type":"adapter.crashed","correlation":null,
                            "payload":{"reason":error,"status":if run.cancel.load(Ordering::Acquire) || error.starts_with("cancelled:") {"interrupted"} else {"failed"}}}),
                        EventOrigin::Host).await
                }.await;
                if let Err(error) = failure { eprintln!("session failure persistence failed: {error}"); }
            }
            if let Err(error) = host.finalize_turn_changes(&session.workspace_id,&session.id,&turn).await {
                eprintln!("session change set persistence failed: {error}");
            }
            host.pending_tools.lock().await.retain(|_,pending|pending.session_id!=session.id);
            if let Err(error) = host.settle_queue_turn(&session.id, &turn, run.cancel.load(Ordering::Acquire)).await {
                eprintln!("queue settlement failed: {error}");
            }
            host.live.lock().await.remove(&session.id);
            run.phase.send_replace(TurnPhase::Finished);
            host.schedule_queue(session.id.clone());
        });
        Ok(())
    }
    async fn save_recovery(&self,session_id:&str,response:&Response)->Result<(),String> {
        if response.output.get("recovery").is_none() {return Ok(());}
        let mut binding=self.saved_binding(session_id).await?.ok_or("invalid_session: missing binding")?;
        binding["recovery"]=response.output["recovery"].clone();binding["updatedAt"]=json!(crate::now_iso());
        if !crate::session_contract::binding_schema().is_valid(&binding) {return Err("invalid_output: recovery".into());}
        let updated=sqlx::query("UPDATE session_bindings SET plugin_binding_json=? WHERE session_id=? AND generation_id=?").bind(binding.to_string()).bind(session_id).bind(&response.generation_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        if updated.rows_affected()!=1 {return Err("invalid_session: recovery generation changed".into());}Ok(())
    }
    pub async fn pi_timeline_from(&self, caller: &str, session_id: &str) -> Result<Vec<crate::TimelineItem>, String> {
        let running = self.live.lock().await.get(session_id).cloned();
        if let Some(run) = running {
            if let Some(branch) = run.pi_branch {
                let mut timeline = (*branch).clone();
                let rows = sqlx::query("SELECT id,session_id,turn_id,external_message_id,role,tool_name,content,status,created_at,updated_at FROM messages WHERE session_id=? AND turn_id=? ORDER BY created_at,sequence,id")
                    .bind(session_id).bind(&run.request_id).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
                for row in rows { timeline.push(crate::row_to_timeline_item(&row).map_err(|e|e.to_string())?); }
                return Ok(timeline);
            }
        }
        let snapshot = self.invoke_capability_from(caller, session_id, "session.snapshot", json!({})).await?;
        Ok(crate::pi_snapshot_timeline(&snapshot, session_id))
    }
    pub async fn invoke_capability_from(&self,caller:&str,session_id:&str,capability:&str,input:Value)->Result<Value,String> {
        if capability == "queue.manage" && self.host_queue_supported(session_id).await? {
            return self.queue_operation(caller, session_id, input).await;
        }
        self.invoke_provider_capability(caller, session_id, capability, input).await
    }
    async fn invoke_provider_capability(&self,caller:&str,session_id:&str,capability:&str,input:Value)->Result<Value,String> {
        if capability == "goal.resume" {
            if input.as_object().is_none_or(|value| !value.is_empty()) {return Err("invalid_input: goal.resume takes no parameters".into());}
            let _guard=self.session_operation(session_id).await;
            let approval=crate::session_permissions::turn_request(&self.db,session_id,caller).await?;
            self.run_admitted(caller,session_id,"继续执行当前目标",Some(approval),true,None).await?;
            return Ok(json!({"accepted":true}));
        }
        loop {
            let mut running=self.live.lock().await.get(session_id).cloned();
            let mut admission = None;
            if running.is_none() {
                admission = Some(self.session_operation(session_id).await);
                // A send may have won admission while this caller was waiting.
                running = self.live.lock().await.get(session_id).cloned();
                if running.is_none() { self.open(caller,session_id).await?; }
            }
            if let Some(run) = &running {
                if passive_session_read(capability, &input) {
                    drop(admission);
                    let mut phase = run.phase.subscribe();
                    while *phase.borrow_and_update() != TurnPhase::Finished {
                        phase.changed().await.map_err(|_| "provider_unavailable: session lifecycle stopped")?;
                    }
                    continue;
                }
            }
            // Live controls (queue, user input, etc.) must not wait behind an idle
            // operation or hold admission for the duration of an Agent turn.
            if running.is_some() { drop(admission.take()); }
            let (session,manifest)=self.metadata(session_id).await?;
            let qualified=format!("{}.{}",manifest["pluginId"].as_str().ok_or("invalid_manifest")?,capability);
            let reference_turn = running.as_ref().filter(|_| capability == "queue.manage"
                && matches!(input["action"].as_str(), Some("steer" | "followUp")))
                .map(|run| run.request_id.clone());
            if capability == "model.context-window" && running.is_some() { return Err("busy: context window changes require an idle session".into()); }
            let response=if let Some(run)=running {
                if run.caller!=caller {return Err("permission_denied: invocation belongs to another window".into());}
                let generation: String = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?")
                    .bind(session_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
                let mut phase = run.phase.subscribe();
                loop {
                    if matches!(*phase.borrow_and_update(), TurnPhase::Settling | TurnPhase::Finished) {
                        return Err("busy: the turn has finished accepting interactions".into());
                    }
                    if self.broker.request_is_live(caller, &run.request_id, &generation).await { break; }
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(10)) => {},
                        changed = phase.changed() => { changed.map_err(|_| "provider_unavailable: session lifecycle stopped")?; },
                    }
                }
                self.broker.control(caller,CapabilityControl {request_id:run.request_id,capability:qualified,version:"1.0.0".into(),input:input.clone()}).await.map_err(|e|e.message)?
            } else {
                let binding=Self::binding(&session,&qualified)?;let id=ulid::Ulid::new().to_string();
                let saved=self.saved_binding(session_id).await?.ok_or("invalid_session")?;
                self.broker.invoke_bound_observed(caller,Request {scope:binding.scope.clone(),capability:qualified,version:"1.0.0".into(),request_id:id.clone(),turn_id:None,input:input.clone()},&binding,Some(self.observer(session,saved,caller.into(),id,None,false))).await.map_err(|e|e.message)?
            };
            if let Some(turn) = reference_turn {
                crate::session_context::consume_queued(&self.db, session_id, &turn, input["message"].as_str().unwrap_or_default()).await.map_err(|e|e.to_string())?;
            }
            self.save_recovery(session_id,&response).await?;
            if input["action"]=="set" && matches!(capability,"model.select"|"model.reasoning") {
                let mut profile=crate::session_execution_profile(&self.db,session_id).await.map_err(|e|e.to_string())?.profile;
                if apply_model_configuration(&mut profile,capability,&input,&response.output) {execution_profile::save_for_session(&self.db,session_id,&profile).await.map_err(|e|e.to_string())?;}
            }
            return Ok(response.output);
        }
    }
    pub async fn cancel_from(&self,caller:&str,session_id:&str)->Result<(),String> {
        if self.live.lock().await.contains_key(session_id) { return self.cancel_admitted(caller, session_id).await; }
        let _guard = self.session_operation(session_id).await;
        self.cancel_admitted(caller, session_id).await
    }
    async fn cancel_admitted(&self,caller:&str,session_id:&str)->Result<(),String> {
        if let Some(run)=self.live.lock().await.get(session_id).cloned() {
            if run.caller!=caller {return Err("permission_denied: invocation belongs to another window".into());}
            self.pause_queue(session_id).await?;
            run.cancel.store(true,Ordering::Release);self.broker.cancel(caller,&run.request_id).await;
        }
        self.pause_queue(session_id).await?;
        Ok(())
    }
    pub async fn close_from(&self,caller:&str,session_id:&str)->Result<(),String> {
        self.cancel_from(caller,session_id).await?;
        let _guard=self.session_operation(session_id).await;
        self.close_admitted(caller, session_id).await
    }
    pub(crate) async fn close_admitted(&self,caller:&str,session_id:&str)->Result<(),String> {
        // Recheck after admission: a queued send may have started in between.
        self.cancel_admitted(caller,session_id).await?;
        tokio::time::timeout(Duration::from_secs(7),async {while self.live.lock().await.contains_key(session_id) {tokio::time::sleep(Duration::from_millis(10)).await;}}).await.map_err(|_|"busy: session is still stopping")?;
        self.broker.stop_session(session_id).await.map_err(|e|e.message)?;
        sqlx::query("UPDATE session_bindings SET generation_id=NULL WHERE session_id=?").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        sqlx::query("UPDATE sessions SET state='closed',updated_at=? WHERE id=?").bind(crate::now_iso()).bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;Ok(())
    }
    pub async fn archive_from(&self,caller:&str,session_id:&str)->Result<Session,String> {
        if self.live.lock().await.contains_key(session_id) {return Err("busy: session has an active invocation".into());}
        self.close_from(caller,session_id).await?;
        sqlx::query("UPDATE sessions SET archived=1 WHERE id=?").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        crate::session_by_id(&self.db,session_id).await.map_err(|e|e.to_string())
    }
    pub async fn unarchive(&self,session_id:&str)->Result<Session,String> {
        let _guard=self.session_operation(session_id).await;
        sqlx::query("UPDATE sessions SET archived=0,state='interrupted',updated_at=? WHERE id=?").bind(crate::now_iso()).bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        crate::session_by_id(&self.db,session_id).await.map_err(|e|e.to_string())
    }
    async fn finalize_turn_changes(&self,workspace_id:&str,session_id:&str,turn_id:&str)->Result<(),String> {
        let baseline=self.turn_baselines.lock().await.remove(turn_id).flatten();
        let workspace=crate::workspace_by_id(&self.db,workspace_id).await.map_err(|e|e.to_string())?;
        let (result,error)=match capture_workspace(Path::new(&workspace.path)).await {Ok(snapshot)=>(Some(snapshot),None),Err(error)=>(None,Some(error))};
        persist_change_set(&self.db,workspace_id,session_id,turn_id,baseline.as_ref(),result.as_ref(),error.as_deref()).await.map_err(|e|e.to_string())?;Ok(())
    }
}

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
#[path = "session_host_tests.rs"]
mod tests;
