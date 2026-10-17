//! Application management reads resolve an installed panel's explicit provider binding.
use crate::{capability_broker::{Binding, Broker, Request, Scope}, ui_i18n::HostMessage};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct Target { pub installation_id: String, pub panel_id: String, pub section_id: String }
fn unavailable() -> HostMessage { HostMessage::new("management.readUnavailable", json!({})) }
async fn declaration(db: &SqlitePool, target: &Target) -> Result<(String, Binding), HostMessage> {
    let raw: String = sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
        .bind(&target.installation_id).fetch_optional(db).await.map_err(|_|unavailable())?.ok_or_else(unavailable)?;
    let manifest: Value = serde_json::from_str(&raw).map_err(|_|unavailable())?;
    crate::plugin_manifest::normalize(&manifest).map_err(|_|unavailable())?;
    let contributions = manifest["contributions"].as_array().ok_or_else(unavailable)?;
    let panel = contributions.iter().find(|c|c["kind"]=="managementPanel" && c["id"]==target.panel_id && c["contractVersion"]=="1.1.0").ok_or_else(unavailable)?;
    if !crate::plugin_dependencies::resolve_metadata(db,&target.installation_id).await.map_err(|_|unavailable())?.supports(&target.panel_id) { return Err(unavailable()); }
    let section = panel["sections"].as_array().and_then(|sections| sections.iter().find(|s|s["id"]==target.section_id)).ok_or_else(unavailable)?;
    let provider = &section["providers"]["application"];
    let contribution = contributions.iter().find(|c|c["kind"]=="capabilityProvider" && c["scope"]=="application" && c["id"]==provider["contributionId"]).ok_or_else(unavailable)?;
    let operation = contribution["operations"].as_array().and_then(|ops|ops.iter().find(|op|op["id"]==provider["readOperationId"])).ok_or_else(unavailable)?;
    let binding = Binding { scope:Scope::Application, capability:operation["capability"]["id"].as_str().ok_or_else(unavailable)?.into(), version:operation["capability"]["version"].as_str().ok_or_else(unavailable)?.into(), installation_id:target.installation_id.clone(), contribution_id:contribution["id"].as_str().ok_or_else(unavailable)?.into() };
    Ok((raw,binding))
}
pub(crate) async fn read(db: &SqlitePool, broker: &Broker, caller: &str, target: &Target) -> Result<Value,HostMessage> {
    let (manifest,binding)=declaration(db,target).await?;
    let response=broker.invoke_bound(caller,Request { scope:Scope::Application,capability:binding.capability.clone(),version:binding.version.clone(),request_id:ulid::Ulid::new().to_string(),turn_id:None,input:json!({"sectionId":target.section_id}) },&binding).await.map_err(|_|unavailable())?;
    if declaration(db,target).await?.0 != manifest { return Err(unavailable()); }
    // Broker validates the canonical output schema before returning or recording data.
    for collection in ["properties", "metrics"] {
        let mut keys=std::collections::HashSet::new();
        if response.output[collection].as_array().ok_or_else(unavailable)?.iter().any(|item|!keys.insert(item["key"].as_str().unwrap_or(""))) { return Err(unavailable()); }
    }
    Ok(response.output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn management_reads_through_broker_without_workspace_or_session() {
        let root=std::env::temp_dir().join(format!("aibo-management-broker-{}",ulid::Ulid::new()));
        let db=crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
        let package=root.join("package");std::fs::create_dir_all(&package).unwrap();
        let mut manifest: Value=serde_json::from_str(include_str!("../../fixtures/plugins/capability-echo/plugin.json")).unwrap();
        let contract: Value=serde_json::from_str(include_str!("../../contracts/management-read.v1.json")).unwrap();
        manifest["contributions"][0]["scope"]=json!("application");
        let operation=&mut manifest["contributions"][0]["operations"][0];
        operation["permissions"]=json!([]);operation["inputSchema"]=contract["inputSchema"].clone();operation["outputSchema"]=contract["outputSchema"].clone();
        manifest["contributions"].as_array_mut().unwrap().push(json!({"kind":"managementPanel","id":"dev.aibo.capability-echo.management","scope":"application","required":false,"title":"Example","contractVersion":"1.1.0","relatedContributions":[],"sections":[{"id":"account","title":"Account","scopes":["application"],"providers":{"application":{"contributionId":"dev.aibo.capability-echo.read","readOperationId":"dev.aibo.capability-echo.echo"}}}]}));
        std::fs::write(package.join("plugin.json"),manifest.to_string()).unwrap();
        let worker=include_str!("../../fixtures/plugins/capability-echo/worker.mjs").replace("{value:p.input.value,workspacePath:p.context.workspacePath}","{schema:'aibo.management-data/v1',target:{id:'default',label:'Example'},state:'ready',message:'',observedAt:'now',properties:[],metrics:[]}");
        std::fs::write(package.join("worker.mjs"),worker).unwrap();
        let installation=crate::plugin_registry::install(&db,&root.join("data"),&package).await.unwrap();
        crate::plugin_registry::enable(&db,&installation.id,true).await.unwrap();
        let broker=Broker::new(db.clone());
        let target=Target{installation_id:installation.id.clone(),panel_id:"dev.aibo.capability-echo.management".into(),section_id:"account".into()};
        let result=read(&db,&broker,"main",&target).await.unwrap();assert_eq!(result["state"],"ready");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM sessions").fetch_one(&db).await.unwrap(),0);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM workspaces").fetch_one(&db).await.unwrap(),0);
        broker.stop_installation(&installation.id).await.unwrap();
        db.close().await;std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn management_binding_requires_enabled_installation_declared_panel_and_section() {
        let root=std::env::temp_dir().join(format!("aibo-management-{}",ulid::Ulid::new()));
        let db=crate::open_database(&root.join("data.sqlite3")).await.unwrap();
        let manifest: Value=serde_json::from_str(include_str!("../capability-plugins/codex/plugin.json")).unwrap();
        sqlx::query("INSERT INTO plugin_installations(id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,created_at,enabled) VALUES('example','dev.aibo.codex','test','digest','test','test',?,'now',1)").bind(manifest.to_string()).execute(&db).await.unwrap();
        let mut target=Target {installation_id:"example".into(),panel_id:manifest["contributions"][2]["id"].as_str().unwrap().into(),section_id:"account".into()};
        let (_,binding)=declaration(&db,&target).await.unwrap();
        assert_eq!(binding.installation_id,"example");assert_eq!(binding.contribution_id,"dev.aibo.codex.management-data");
        target.section_id="behavior".into();assert!(declaration(&db,&target).await.is_err());
        target.section_id="account".into();target.panel_id="foreign.panel".into();assert!(declaration(&db,&target).await.is_err());
        target.panel_id=manifest["contributions"][2]["id"].as_str().unwrap().into();
        sqlx::query("UPDATE plugin_installations SET enabled=0").execute(&db).await.unwrap();assert!(declaration(&db,&target).await.is_err());
        db.close().await;std::fs::remove_dir_all(root).unwrap();
    }
}
