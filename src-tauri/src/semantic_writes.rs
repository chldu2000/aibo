//! Installed view writes resolve only host-cached actions and manifest-declared targets.
use super::*;
use crate::{capability_broker::Response, workspace_write_runs, CoreError};
use sha2::{Digest,Sha256};
fn invalid(message: &str) -> CoreError {CoreError::InvalidWorkspacePath(message.into())}
fn failure(error: CoreError) -> String {let value = serde_json::to_value(error).unwrap(); format!("{}: {}",value["code"].as_str().unwrap_or("write_failed"),value["message"].as_str().unwrap_or("Host write failed"))}
fn identity(action: &SemanticAction) -> Value {json!({"context":action.context,"actionId":action.action_id,"itemId":action.item_id})}

async fn binding(db: &SqlitePool, broker: &Broker, lease: &Lease, reference: &Value, effect: &str) -> Result<Binding,String> {
    let dependencies = plugin_dependencies::resolve_metadata(db,&lease.contribution.installation_id).await?;
    if !dependencies.supports(&lease.contribution.contribution_id) {return Err("provider_unavailable: view dependency".into());}
    let mut allowed = vec![lease.contribution.installation_id.clone()];
    allowed.extend(dependencies.dependencies.iter().filter(|d|d.available && d.contribution_ids.contains(&lease.contribution.contribution_id)).filter_map(|d|d.installation_id.clone()));
    let capability = reference["capability"].as_str().ok_or("invalid_input: declared capability")?;
    let version = reference["version"]["min"].as_str().ok_or("invalid_input: declared version")?;
    let offers: Vec<_> = broker.providers(&lease.binding.scope,capability,version).await.map_err(|error|error.code)?.into_iter()
        .filter(|provider|allowed.contains(&provider.installation_id) && provider.operation["id"] == reference["operation"] && provider.operation["effect"] == effect).collect();
    if offers.len() != 1 {return Err(if offers.is_empty() {"provider_unavailable: declared operation"} else {"provider_selection_required: declared operation"}.into());}
    Ok(Binding {scope:lease.binding.scope.clone(),capability:capability.into(),version:version.into(),installation_id:offers[0].installation_id.clone(),contribution_id:offers[0].contribution_id.clone()})
}

async fn proof(db: &SqlitePool, broker: &Broker, lease: &Lease, action: &SemanticAction, snapshot: &Value, target: &Binding) -> Result<Value,CoreError> {
    {
        let state = lease.state.try_lock().map_err(|_|invalid("stale_context: view is updating"))?;
        if lease.released.load(Ordering::Acquire) || state.touched.elapsed() > TTL || state.snapshot != *snapshot || state.snapshot["context"] != action.context {return Err(invalid("stale_context: view changed or released"));}
    }
    let current = catalog(db).await.map_err(|_|invalid("provider_unavailable: contribution"))?.into_iter().find(|entry|entry.installation_id == lease.contribution.installation_id && entry.contribution_id == lease.contribution.contribution_id && entry.available)
        .ok_or_else(||invalid("provider_unavailable: contribution"))?;
    if current.metadata != lease.contribution.metadata {return Err(invalid("stale_context: contribution changed"));}
    let (directory,digest): (String,String) = sqlx::query_as("SELECT install_path,package_digest FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1").bind(&current.installation_id).fetch_one(db).await?;
    let (_,_,actual) = crate::plugin_registry::inspect(std::path::Path::new(&directory)).map_err(|_|invalid("provider_unavailable: declaration package"))?;
    if actual != digest {return Err(invalid("stale_context: declaration package changed"));}
    let declared = current.metadata["writeActions"].as_array().and_then(|items|items.iter().find(|item|item["id"] == action.action_id)).ok_or_else(||invalid("unsupported: undeclared write action"))?;
    let now = binding(db,broker,lease,&declared["provider"],"write").await.map_err(|_|invalid("provider_unavailable: write binding"))?;
    let read = binding(db,broker,lease,&current.metadata["provider"],"read").await.map_err(|_|invalid("provider_unavailable: read binding"))?;
    if serde_json::to_value(&now).unwrap() != serde_json::to_value(target).unwrap() || serde_json::to_value(&read).unwrap() != serde_json::to_value(&lease.binding).unwrap() {return Err(invalid("stale_context: semantic binding changed"));}
    let state = lease.state.try_lock().map_err(|_|invalid("stale_context: view is updating"))?;
    if lease.released.load(Ordering::Acquire) || state.snapshot != *snapshot || state.touched.elapsed() > TTL {return Err(invalid("stale_context: view changed or released"));}
    Ok(json!({"context":action.context,"actionId":action.action_id,"declarationInstallationId":current.installation_id,"declarationDigest":digest,"snapshotDigest":format!("sha256:{:x}",Sha256::digest(snapshot.to_string())),"readBinding":read,"writeBinding":now}))
}

impl SemanticPlugins {
    pub(crate) async fn write_requested(&self, db: &SqlitePool, broker: &Broker, owner: &str, action: SemanticAction, request_id: String, approval: &workspace_write_runs::Request) -> Result<Response,String> {
        if !approval.matches(&request_id,owner) || action.context.to_string().len() > 4096 || action.action_id.len() > 128 || action.item_id.is_some() {return Err("invalid_input: semantic write identity".into());}
        let workspace = action.context["workspaceId"].as_str().ok_or("permission_denied: semantic write workspace")?;
        let identity = identity(&action);
        if let Some(result) = workspace_write_runs::replay_requested(db,workspace,"semantic.write",&identity,approval).await.map_err(failure)? {return result.map_err(failure);}
        let lease = self.leases.lock().await.get(action.context["generation"].as_str().ok_or("invalid_input: generation")?).cloned().ok_or("stale_context: unknown view")?;
        if lease.owner != owner {return Err("permission_denied: view owner".into());}
        let snapshot = {
            let state = lease.state.try_lock().map_err(|_|"busy: semantic action")?;
            if lease.released.load(Ordering::Acquire) || state.touched.elapsed() > TTL || state.snapshot["context"] != action.context {return Err("stale_context: view changed or released".into());}
            state.snapshot.clone()
        };
        let value = snapshot["actions"].as_array().and_then(|actions|actions.iter().find(|a|a["id"] == action.action_id && a["enabled"] == true && a["intent"] == "execute")).ok_or("unsupported: disabled write action")?;
        let declared = lease.contribution.metadata["writeActions"].as_array().and_then(|actions|actions.iter().find(|a|a["id"] == action.action_id)).ok_or("unsupported: undeclared write action")?;
        let target = binding(db,broker,&lease,&declared["provider"],"write").await?;
        let request = Request {scope:target.scope.clone(),capability:target.capability.clone(),version:target.version.clone(),request_id,turn_id:None,input:value["input"].clone()};
        broker.invoke_semantic_write(owner,request,&target,identity,approval,||proof(db,broker,&lease,&action,&snapshot,&target)).await.map_err(|error|format!("{}: {}",error.code,error.message))
    }
}

#[tauri::command]
pub(crate) async fn write_semantic_contribution(action: SemanticAction, request_id: String, window: tauri::WebviewWindow, state: tauri::State<'_,crate::AppState>) -> Result<Response,String> {
    let owner = window.label().to_owned(); let db = state.db.clone(); let broker = state.capability_broker.clone(); let views = state.semantic_plugins.clone();
    let approval = crate::host_write_request(request_id.clone(),window,"Aibo · 确认视图写入");
    // Disposing a renderer invalidates approval, but cannot abandon an approved write.
    tokio::spawn(async move {views.write_requested(&db,&broker,&owner,action,request_id,&approval).await}).await.map_err(|_|"outcome_unknown: semantic write task stopped".to_owned())?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn semantic_write_manifest_requires_owned_unique_actions_and_write_version() {
        let manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/semantic-write/plugin.json")).unwrap();
        assert!(crate::plugin_manifest::normalize(&manifest).is_ok());
        for mutation in 0..4 {
            let mut invalid = manifest.clone();
            let view = &mut invalid["contributions"][2];
            match mutation {
                0 => view["contractVersion"] = json!("1.0.0"),
                1 => view["writeActions"][0]["id"] = json!("other.plugin.action"),
                2 => { let duplicate = view["writeActions"][0].clone(); view["writeActions"].as_array_mut().unwrap().push(duplicate); },
                _ => { view["scope"] = json!("application"); view["extensionPoint"] = json!("settings.page"); view["visibility"] = json!("always"); },
            }
            assert!(crate::plugin_manifest::normalize(&invalid).is_err());
        }
    }
    #[tokio::test]
    async fn installed_write_uses_cached_input_and_replays_after_release() {
        let root = std::env::temp_dir().join(format!("aibo-semantic-write-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Write',1,?,?)")
            .bind(root.join("workspace").to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("fixtures/plugins/semantic-write");
        let installed = crate::plugin_registry::install(&db, &root.join("data"), &source).await.unwrap();
        assert!(installed.runnable, "{:?}", installed.activation_issues);
        crate::plugin_registry::enable(&db, &installed.id, true).await.unwrap();
        let broker = Broker::new(db.clone());
        let host = SemanticPlugins::default();
        let snapshot = host.open(&db, &broker, "main", "w", &installed.id, "dev.aibo.semantic-write.page").await.unwrap();
        assert_eq!(snapshot["schema"], "aibo.semantic-view/v1.1");
        let action = SemanticAction { context: snapshot["context"].clone(), action_id: "dev.aibo.semantic-write.append".into(), item_id: None };
        assert!(host.act(&db, &broker, "main", action.clone()).await.unwrap_err().contains("permission_denied"));
        assert!(!root.join("workspace/effect.txt").exists());
        let denied = workspace_write_runs::Request::with_confirmation("semantic-denied".into(), "main".into(), |_| async { Ok(false) });
        assert!(host.write_requested(&db, &broker, "main", action.clone(), "semantic-denied".into(), &denied).await.unwrap_err().contains("approval_rejected"));
        assert!(!root.join("workspace/effect.txt").exists());
        let stale = workspace_write_runs::Request::with_confirmation("semantic-stale".into(), "main".into(), {
            let host = host.clone(); let broker = broker.clone(); let generation = snapshot["context"]["generation"].as_str().unwrap().to_owned();
            move |_| { let host = host.clone(); let broker = broker.clone(); let generation = generation.clone(); async move {
                host.release(&broker, "main", &generation).await.unwrap(); Ok(true)
            } }
        });
        assert!(host.write_requested(&db, &broker, "main", action, "semantic-stale".into(), &stale).await.is_err());
        assert!(!root.join("workspace/effect.txt").exists());
        let snapshot = host.open(&db, &broker, "main", "w", &installed.id, "dev.aibo.semantic-write.page").await.unwrap();
        let action = SemanticAction { context: snapshot["context"].clone(), action_id: "dev.aibo.semantic-write.append".into(), item_id: None };
        let approval = workspace_write_runs::Request::with_confirmation("semantic-once".into(), "main".into(), |message| async move {
            assert!(message.contains("semantic-write")); Ok(true)
        });
        let result = host.write_requested(&db, &broker, "main", action.clone(), "semantic-once".into(), &approval).await.unwrap();
        assert_eq!(result.output["value"], "semantic-write");
        assert_eq!(std::fs::read_to_string(root.join("workspace/effect.txt")).unwrap(), "semantic-write\n");
        host.release(&broker, "main", snapshot["context"]["generation"].as_str().unwrap()).await.unwrap();
        crate::plugin_registry::enable(&db, &installed.id, false).await.unwrap();
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'").execute(&db).await.unwrap();
        let replay_approval = workspace_write_runs::Request::with_confirmation("semantic-once".into(), "main".into(), |_| async { panic!("replay prompted") });
        let fresh = SemanticPlugins::default();
        let replay = fresh.write_requested(&db, &broker, "main", action, "semantic-once".into(), &replay_approval).await.unwrap();
        assert_eq!(replay.output, result.output);
        assert_eq!(std::fs::read_to_string(root.join("workspace/effect.txt")).unwrap(), "semantic-write\n");
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn semantic_write_survives_page_release_and_reopens_settled_results() {
        let root = std::env::temp_dir().join(format!("aibo-semantic-write-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Write',1,?,?)")
            .bind(root.join("workspace").to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("fixtures/plugins/semantic-write");
        let installed = crate::plugin_registry::install(&db, &root.join("data"), &source).await.unwrap();
        assert!(installed.runnable, "{:?}", installed.activation_issues);
        crate::plugin_registry::enable(&db, &installed.id, true).await.unwrap();
        let broker = Broker::new(db.clone());
        let host = SemanticPlugins::default();

        let mut replays = Vec::new();
        for (index, mode) in ["delayed", "slow", "crash", "invalid-output"].into_iter().enumerate() {
            std::fs::write(root.join("workspace/mode.txt"), mode).unwrap();
            let snapshot = host.open(&db, &broker, "main", "w", &installed.id, "dev.aibo.semantic-write.page").await.unwrap();
            let action = SemanticAction { context: snapshot["context"].clone(), action_id: "dev.aibo.semantic-write.append".into(), item_id: None };
            let request_id = format!("lifecycle-{mode}");
            let approval = workspace_write_runs::Request::with_confirmation(request_id.clone(), "main".into(), |_| async { Ok(true) });
            let task = tokio::spawn({
                let db = db.clone(); let host = host.clone(); let broker = broker.clone(); let action = action.clone(); let request_id = request_id.clone(); let approval = approval.clone();
                async move { host.write_requested(&db, &broker, "main", action, request_id, &approval).await }
            });
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    if std::fs::read_to_string(root.join("workspace/effect.txt")).unwrap_or_default().lines().count() == index + 1 { break; }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            }).await.unwrap();
            if mode == "delayed" {
                let duplicate = workspace_write_runs::Request::with_confirmation(request_id.clone(), "main".into(), |_| async { panic!("duplicate requested approval") });
                assert!(host.write_requested(&db, &broker, "main", action.clone(), request_id.clone(), &duplicate).await.unwrap_err().contains("busy"));
            }
            // The effect proves approval and runtime dispatch happened before release.
            host.release(&broker, "main", snapshot["context"]["generation"].as_str().unwrap()).await.unwrap();
            if mode == "slow" {
                let rows = serde_json::to_value(workspace_write_runs::list(&db, "w".into(), None).await.unwrap()).unwrap();
                let run = rows.as_array().unwrap().iter().find(|run|run["requestId"] == request_id).unwrap();
                assert!(workspace_write_runs::cancel(&db, "w", run["id"].as_str().unwrap(), "main").await.unwrap());
            }
            let outcome = task.await.unwrap();
            if mode == "delayed" { assert_eq!(outcome.as_ref().unwrap().output["value"], "semantic-write"); }
            else { assert!(outcome.as_ref().unwrap_err().contains("outcome_unknown"), "{outcome:?}"); }
            replays.push((action, request_id, outcome.map(|response|response.output)));
        }
        tokio::time::sleep(Duration::from_millis(3200)).await;
        assert!(!root.join("workspace/late.txt").exists(), "cancelled child survived");
        let before = std::fs::read_to_string(root.join("workspace/effect.txt")).unwrap();
        assert_eq!(before.lines().count(), 4);
        db.close().await;
        let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
        let broker = Broker::new(db.clone()); let host = SemanticPlugins::default();
        for (action, request_id, expected) in replays {
            let approval = workspace_write_runs::Request::with_confirmation(request_id.clone(), "main".into(), |_| async { panic!("settled replay requested approval") });
            let actual = host.write_requested(&db, &broker, "main", action, request_id, &approval).await.map(|response|response.output);
            assert_eq!(actual, expected);
        }
        assert_eq!(std::fs::read_to_string(root.join("workspace/effect.txt")).unwrap(), before);
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn semantic_view_rejects_actions_not_declared_by_its_package() {
        let root = std::env::temp_dir().join(format!("aibo-semantic-write-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'Write',1,?,?)")
            .bind(root.join("workspace").to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        let original = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("fixtures/plugins/semantic-write");
        let source = root.join("package"); std::fs::create_dir_all(&source).unwrap();
        std::fs::copy(original.join("plugin.json"), source.join("plugin.json")).unwrap();
        let worker = std::fs::read_to_string(original.join("worker.mjs")).unwrap().replace("id: 'dev.aibo.semantic-write.append'", "id: 'dev.aibo.semantic-write.undeclared'");
        std::fs::write(source.join("worker.mjs"), worker).unwrap();
        let installed = crate::plugin_registry::install(&db, &root.join("data"), &source).await.unwrap();
        assert!(installed.runnable, "{:?}", installed.activation_issues);
        crate::plugin_registry::enable(&db, &installed.id, true).await.unwrap();
        let broker = Broker::new(db.clone());
        let host = SemanticPlugins::default();

        let error = host.open(&db, &broker, "main", "w", &installed.id, "dev.aibo.semantic-write.page").await.unwrap_err();
        assert!(error.contains("undeclared"), "{error}");
        assert!(!root.join("workspace/effect.txt").exists());
        db.close().await; std::fs::remove_dir_all(root).unwrap();
    }

}
