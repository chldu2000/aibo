//! Host-owned ordinary Agent configuration. This is not a workspace-write capability.
//! Versions isolate incompatible schemas; scoped overrides survive release upgrades.
use crate::capability_broker::Scope;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{Row, SqlitePool};
use std::{collections::HashSet, sync::OnceLock};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Target {
    pub installation_id: String,
    pub contribution_id: String,
    pub scope: Scope,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Save {
    pub installation_id: String,
    pub contribution_id: String,
    pub scope: Scope,
    pub version: i64,
    pub expected_revision: i64,
    pub values: Value,
}
fn db_error(_: sqlx::Error) -> String { "settings_unavailable: 配置存储不可用".into() }
fn invalid(message: &str) -> String { format!("invalid_settings: {message}") }
fn key(scope: &Scope) -> (&str, &str) {
    match scope { Scope::Application => ("application", "application"), Scope::Workspace(id) => ("workspace", id), Scope::Session(id) => ("session", id) }
}
fn valid_value(field: &Value, value: &Value) -> bool {
    match field["type"].as_str() {
        Some("boolean") => value.is_boolean(),
        Some("number") => value.as_f64().is_some_and(|n| n.is_finite()
            && field["min"].as_f64().is_none_or(|min| n >= min)
            && field["max"].as_f64().is_none_or(|max| n <= max)),
        Some("select") => value.is_string() && field["options"].as_array().is_some_and(|options| options.iter().any(|option| option["value"] == *value)),
        Some("text" | "multiline") => value.as_str().is_some_and(|text| text.chars().count() <= field["maxLength"].as_u64().unwrap_or(16384) as usize),
        _ => false,
    }
}
pub(crate) fn validate_descriptor(descriptor: &Value) -> Result<(), String> {
    static SCHEMA: OnceLock<jsonschema::Validator> = OnceLock::new();
    let schema = SCHEMA.get_or_init(|| jsonschema::options().build(&serde_json::from_str::<Value>(include_str!("../../contracts/agent-settings.v1.schema.json")).unwrap()).unwrap());
    if descriptor.to_string().len() > 65536 || !schema.is_valid(descriptor) { return Err(invalid("设置声明格式无效")); }
    let mut keys = HashSet::new();
    for field in descriptor["fields"].as_array().unwrap() {
        let name = field["key"].as_str().unwrap();
        if !keys.insert(name) || ["constructor", "prototype", "__proto__"].contains(&name) || !valid_value(field, &field["default"]) { return Err(invalid("字段重复或默认值无效")); }
        let kind = field["type"].as_str().unwrap();
        if (field.get("options").is_some() != (kind == "select"))
            || ((field.get("min").is_some() || field.get("max").is_some()) && kind != "number")
            || (field.get("maxLength").is_some() && !matches!(kind, "text" | "multiline"))
            || field["min"].as_f64().zip(field["max"].as_f64()).is_some_and(|(a,b)| a > b) { return Err(invalid("字段约束与类型不符")); }
        if let Some(options) = field["options"].as_array() {
            let mut values = HashSet::new();
            if options.iter().any(|option| !values.insert(option["value"].as_str().unwrap())) { return Err(invalid("选项重复")); }
        }
    }
    Ok(())
}
fn validate_values(descriptor: &Value, values: &Value) -> Result<(), String> {
    let object = values.as_object().ok_or_else(|| invalid("配置必须是对象"))?;
    if values.to_string().len() > 65536 { return Err(invalid("配置超过大小限制")); }
    for (name, value) in object {
        let field = descriptor["fields"].as_array().unwrap().iter().find(|field| field["key"] == *name).ok_or_else(|| invalid("未知配置字段"))?;
        if !valid_value(field, value) { return Err(invalid(&format!("字段 {name} 的值不符合约束"))); }
    }
    Ok(())
}
async fn descriptor(db: &SqlitePool, target: &Target) -> Result<(String, Value), String> {
    let row = sqlx::query("SELECT plugin_id,manifest_json FROM plugin_installations WHERE id=? AND installed=1")
        .bind(&target.installation_id).fetch_optional(db).await.map_err(db_error)?.ok_or("settings_unavailable: 插件已卸载或不存在")?;
    let manifest: Value = serde_json::from_str(row.get::<&str,_>("manifest_json")).map_err(|_| invalid("插件清单损坏"))?;
    let model = crate::plugin_manifest::normalize(&manifest)?;
    let entry = model.contributions.iter().find(|entry| entry.id == target.contribution_id).ok_or("settings_unavailable: 设置贡献不存在")?;
    let settings = entry.metadata.get("settings").ok_or("settings_unavailable: Agent 未声明设置")?.clone();
    let (scope, id) = key(&target.scope);
    if id.is_empty() || id.len() > 128 || !settings["scopes"].as_array().unwrap().iter().any(|value| value == scope) { return Err(invalid("不支持此配置作用域")); }
    workspace(db, target).await?;
    Ok((row.get("plugin_id"), settings))
}
async fn workspace(db: &SqlitePool, target: &Target) -> Result<Option<String>, String> {
    let id = match &target.scope {
        Scope::Application => return Ok(None),
        Scope::Workspace(id) => id.clone(),
        Scope::Session(id) => sqlx::query_scalar::<_,String>("SELECT workspace_id FROM sessions WHERE id=? AND agent=? AND plugin_installation_id=? AND archived=0")
            .bind(id).bind(&target.contribution_id).bind(&target.installation_id).fetch_optional(db).await.map_err(db_error)?.ok_or("settings_unavailable: 会话不属于此 Agent 或已归档")?,
    };
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?)").bind(&id).fetch_one(db).await.map_err(db_error)?;
    if !exists { return Err("settings_unavailable: 项目不存在".into()); }
    Ok(Some(id))
}
async fn snapshot(db: &SqlitePool, target: &Target, plugin: &str, descriptor: &Value) -> Result<Value, String> {
    let workspace_id = workspace(db, target).await?;
    let session_id = match &target.scope { Scope::Session(id) => id.as_str(), _ => "" };
    // One query gives a consistent set of parent/local revisions and values.
    let rows = sqlx::query("SELECT scope_kind,scope_id,revision,values_json FROM agent_settings WHERE plugin_id=? AND contribution_id=? AND schema_version=? AND ((scope_kind='application' AND scope_id='application') OR (scope_kind='workspace' AND scope_id=?) OR (scope_kind='session' AND scope_id=?))")
        .bind(plugin).bind(&target.contribution_id).bind(descriptor["version"].as_i64().unwrap()).bind(workspace_id.as_deref().unwrap_or("")).bind(session_id).fetch_all(db).await.map_err(db_error)?;
    let mut effective = Map::new();
    for field in descriptor["fields"].as_array().unwrap() { effective.insert(field["key"].as_str().unwrap().into(), field["default"].clone()); }
    let mut inherited = effective.clone();
    let mut local = json!({});
    let mut revision = 0i64;
    for scope in ["application", "workspace", "session"] {
        if !descriptor["scopes"].as_array().unwrap().iter().any(|s| s == scope) { continue; }
        if scope == key(&target.scope).0 { inherited = effective.clone(); }
        if let Some(row) = rows.iter().find(|row| row.get::<&str,_>("scope_kind") == scope) {
            let values: Value = serde_json::from_str(row.get("values_json")).map_err(|_| invalid("已保存配置损坏"))?;
            validate_values(descriptor, &values)?;
            effective.extend(values.as_object().unwrap().clone());
            if scope == key(&target.scope).0 { local = values; revision = row.get("revision"); }
        }
    }
    Ok(json!({"target":target,"descriptor":descriptor,"revision":revision,"values":local,"effectiveValues":effective,"inheritedValues":inherited}))
}
pub(crate) async fn read(db: &SqlitePool, target: &Target) -> Result<Value, String> {
    let (plugin, descriptor) = descriptor(db, target).await?;
    snapshot(db, target, &plugin, &descriptor).await
}
pub(crate) async fn save(db: &SqlitePool, request: Save) -> Result<Value, String> {
    let target = Target {installation_id:request.installation_id, contribution_id:request.contribution_id, scope:request.scope};
    let (plugin, descriptor) = descriptor(db, &target).await?;
    if descriptor["version"] != request.version { return Err("settings_conflict: 设置版本已改变，请重新加载".into()); }
    if request.expected_revision < 0 || request.expected_revision >= 9007199254740991 { return Err(invalid("配置修订号无效")); }
    validate_values(&descriptor, &request.values)?;
    let (scope, id) = key(&target.scope);
    // Atomic compare-and-swap includes the absent-row case. Resets retain revision tombstones.
    let updated = sqlx::query("INSERT INTO agent_settings(plugin_id,contribution_id,schema_version,scope_kind,scope_id,revision,values_json) SELECT ?,?,?,?,?,1,? WHERE ?=0 OR EXISTS(SELECT 1 FROM agent_settings WHERE plugin_id=? AND contribution_id=? AND schema_version=? AND scope_kind=? AND scope_id=?) ON CONFLICT(plugin_id,contribution_id,schema_version,scope_kind,scope_id) DO UPDATE SET revision=agent_settings.revision+1,values_json=excluded.values_json WHERE agent_settings.revision=?")
        .bind(&plugin).bind(&target.contribution_id).bind(request.version).bind(scope).bind(id).bind(request.values.to_string()).bind(request.expected_revision)
        .bind(&plugin).bind(&target.contribution_id).bind(request.version).bind(scope).bind(id).bind(request.expected_revision)
        .execute(db).await.map_err(db_error)?;
    if updated.rows_affected() != 1 { return Err("settings_conflict: 配置已被其他窗口修改，请重新加载后再保存".into()); }
    snapshot(db, &target, &plugin, &descriptor).await
}
/// Called only for a declared contribution, after Broker scope/permission checks.
/// Unrelated providers never receive settings belonging to another contribution.
pub(crate) async fn invocation_context(db: &SqlitePool, manifest: &Value, installation: &str, contribution: &str, scope: &Scope) -> Result<Option<Value>, String> {
    let Some(descriptor) = manifest["contributions"].as_array().and_then(|entries| entries.iter().find(|entry| entry["id"] == contribution)).and_then(|entry| entry.get("settings")) else { return Ok(None); };
    let target = Target { installation_id:installation.into(), contribution_id:contribution.into(), scope:scope.clone() };
    let snapshot = snapshot(db, &target, manifest["pluginId"].as_str().unwrap(), descriptor).await?;
    Ok(Some(json!({"schema":"aibo.agent-settings/v1","version":descriptor["version"],"values":snapshot["effectiveValues"]})))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> Value { serde_json::from_str(include_str!("../capability-plugins/pi/plugin.json")).unwrap() }
    fn target(scope: Scope) -> Target { Target {installation_id:"pi".into(),contribution_id:"dev.aibo.pi.agent".into(),scope} }
    fn request(scope: Scope, revision: i64, values: Value) -> Save {
        Save {installation_id:"pi".into(),contribution_id:"dev.aibo.pi.agent".into(),scope,version:1,expected_revision:revision,values}
    }
    #[test]
    fn settings_descriptor_rejects_invalid_defaults_types_and_unbounded_fields() {
        let original = manifest()["contributions"][0]["settings"].clone();
        validate_descriptor(&original).unwrap();
        for field in [
            json!({"key":"n","label":"N","type":"number","default":4,"min":5}),
            json!({"key":"b","label":"B","type":"boolean","default":"false"}),
            json!({"key":"s","label":"S","type":"select","default":"a","options":[{"value":"a","label":"A"},{"value":"a","label":"B"}]}),
            json!({"key":"constructor","label":"No","type":"text","default":""}),
            json!({"key":"x","label":"X","type":"text","default":"","maxLength":20000}),
            json!({"key":"x","label":"X","type":"boolean","default":true,"min":0}),
        ] {
            let mut bad = original.clone(); bad["fields"] = json!([field]);
            assert!(validate_descriptor(&bad).is_err());
        }
        let mut descriptor = original;
        descriptor["fields"] = json!([
            {"key":"n","label":"N","type":"number","default":2,"min":1,"max":3},
            {"key":"b","label":"B","type":"boolean","default":false},
            {"key":"s","label":"S","type":"select","default":"a","options":[{"value":"a","label":"A"}]},
            {"key":"t","label":"T","type":"text","default":"","maxLength":2}
        ]);
        validate_descriptor(&descriptor).unwrap();
        validate_values(&descriptor, &json!({"n":1.5,"b":false,"s":"a","t":"你好"})).unwrap();
        for values in [json!({"n":4}),json!({"b":"false"}),json!({"s":"b"}),json!({"unknown":1}),json!({"t":"abc"}),json!({"n":null})] { assert!(validate_values(&descriptor, &values).is_err()); }
        let mut not_agent = manifest();
        not_agent["contributions"][0]["operations"].as_array_mut().unwrap().retain(|op| op["capability"]["id"] != "aibo.session.open");
        assert!(crate::plugin_manifest::normalize(&not_agent).is_err());
    }
    #[tokio::test]
    async fn settings_scopes_conflicts_reset_persistence_versions_and_identity() {
        let root = std::env::temp_dir().join(format!("aibo-settings-{}", ulid::Ulid::new()));
        let path = root.join("data.sqlite3");
        let db = crate::open_database(&path).await.unwrap();
        sqlx::query("INSERT INTO plugin_installations(id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,created_at) VALUES('pi','dev.aibo.pi','test','digest','test','test',?,'now')")
            .bind(manifest().to_string()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/test','Test',1,'now','now')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES('s','w','dev.aibo.pi.agent','Test','idle','now','now','pi')").execute(&db).await.unwrap();
        let global = Scope::Application;
        let workspace = Scope::Workspace("w".into());
        let session = Scope::Session("s".into());
        let initial = read(&db, &target(session.clone())).await.unwrap();
        assert_eq!(initial["revision"],0);
        assert_eq!(initial["effectiveValues"]["additionalInstructions"],"");
        save(&db, request(global.clone(),0,json!({"additionalInstructions":"global"}))).await.unwrap();
        assert!(save(&db, request(global.clone(),0,json!({}))).await.unwrap_err().contains("settings_conflict"));
        save(&db, request(workspace.clone(),0,json!({"additionalInstructions":"project"}))).await.unwrap();
        let inherited = read(&db, &target(session.clone())).await.unwrap();
        assert_eq!(inherited["effectiveValues"]["additionalInstructions"],"project");
        assert_eq!(inherited["values"],json!({}));
        let saved = save(&db, request(session.clone(),0,json!({"additionalInstructions":"session"}))).await.unwrap();
        assert_eq!(saved["inheritedValues"]["additionalInstructions"],"project");
        let wire = invocation_context(&db,&manifest(),"pi","dev.aibo.pi.agent",&session).await.unwrap().unwrap();
        assert_eq!(wire["values"]["additionalInstructions"],"session");
        assert!(invocation_context(&db,&manifest(),"pi","other.agent",&session).await.unwrap().is_none());
        assert!(read(&db, &Target { contribution_id:"other.agent".into(), ..target(session.clone()) }).await.is_err());
        assert!(read(&db, &target(Scope::Workspace("missing".into()))).await.is_err());
        assert!(save(&db, request(session.clone(),1,json!({"unexpected":true}))).await.is_err());
        let reset = save(&db, request(session.clone(),1,json!({}))).await.unwrap();
        assert_eq!(reset["revision"],2);
        assert_eq!(reset["effectiveValues"]["additionalInstructions"],"project");
        // Exactly one of two competing writes can commit.
        let (a,b) = tokio::join!(save(&db,request(global.clone(),1,json!({"additionalInstructions":"a"}))),save(&db,request(global.clone(),1,json!({"additionalInstructions":"b"}))));
        assert_ne!(a.is_ok(),b.is_ok());
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(read(&db,&target(session.clone())).await.unwrap()["revision"],2);
        let mut upgraded = manifest(); upgraded["version"] = json!("9.0.0");
        sqlx::query("UPDATE plugin_installations SET manifest_json=? WHERE id='pi'").bind(upgraded.to_string()).execute(&db).await.unwrap();
        assert_eq!(read(&db,&target(workspace.clone())).await.unwrap()["effectiveValues"]["additionalInstructions"],"project");
        upgraded["contributions"][0]["settings"]["version"] = json!(2);
        sqlx::query("UPDATE plugin_installations SET manifest_json=? WHERE id='pi'").bind(upgraded.to_string()).execute(&db).await.unwrap();
        assert_eq!(read(&db,&target(workspace.clone())).await.unwrap()["revision"],0);
        assert!(save(&db,request(workspace.clone(),1,json!({}))).await.unwrap_err().contains("settings_conflict"));
        sqlx::query("UPDATE plugin_installations SET manifest_json=?,installed=0 WHERE id='pi'").bind(manifest().to_string()).execute(&db).await.unwrap();
        assert!(read(&db,&target(global)).await.is_err());
        sqlx::query("UPDATE plugin_installations SET installed=1 WHERE id='pi'").execute(&db).await.unwrap();
        assert_eq!(read(&db,&target(workspace)).await.unwrap()["effectiveValues"]["additionalInstructions"],"project");
        sqlx::query("UPDATE sessions SET archived=1 WHERE id='s'").execute(&db).await.unwrap();
        assert!(read(&db,&target(session)).await.is_err());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
