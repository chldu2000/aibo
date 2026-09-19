//! Plugin-owned menu declarations; host-owned execution authorization.
use crate::execution_profile::{self, EnforcementBackend, ExecutionProfile, ResolvedExecutionProfile};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SessionControl {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub profile: Value,
}

pub(crate) fn validate_declaration(entry: &Value) -> Result<(), String> {
    let Some(raw) = entry.get("sessionControls") else { return Ok(()); };
    if entry["scope"] != "session" || !entry["operations"].as_array().is_some_and(|ops|
        ops.iter().any(|op|op["capability"]["id"] == "aibo.session.open")) {
        return Err("invalid_manifest: session controls require a session provider".into());
    }
    let controls: Vec<SessionControl> = serde_json::from_value(raw.clone()).map_err(|e| e.to_string())?;
    let mut ids = HashSet::new();
    let mut commands = HashSet::new();
    // Plugins may add aliases for their controls, never replace host management commands.
    let reserved = ["settings","new","name","trust","session","resume","archive","tree","fork","compact","model","thinking","reload","goal","skills"];
    for control in controls {
        if !ids.insert(control.id) { return Err("invalid_manifest: duplicate session control ID".into()); }
        if let Some(command) = control.command {
            if reserved.contains(&command.as_str()) || !commands.insert(command) {
                return Err("invalid_manifest: duplicate or reserved session control command".into());
            }
        }
    }
    Ok(())
}

fn apply(backend: EnforcementBackend, current: &ExecutionProfile, option: &SessionControl) -> Result<ResolvedExecutionProfile, String> {
    let mut value = serde_json::to_value(current).map_err(|e|e.to_string())?;
    let patch = option.profile.as_object().ok_or("invalid session control profile")?;
    for (key, item) in patch { value[key] = item.clone(); }
    let requested: ExecutionProfile = serde_json::from_value(value).map_err(|e|e.to_string())?;
    if backend == EnforcementBackend::CoreProxy && (requested.filesystem_policy == "danger-full-access"
        || requested.command_policy == "trusted" || requested.approval_reviewer == "auto-review") {
        return Err("permission_denied: session control requires native enforcement".into());
    }
    let resolved = execution_profile::resolve_with_backend(backend, Some(requested), crate::now_iso())?;
    // A declaration cannot expand the backend's authority or silently promise a
    // configuration that Core will downgrade (e.g. a native grant on a third-party plugin).
    if resolved.requested != resolved.enforced {
        return Err("permission_denied: session control exceeds execution authority".into());
    }
    Ok(resolved)
}

pub(crate) async fn for_installation(db: &SqlitePool, installation: &str, contribution: &str,
    profile: &ResolvedExecutionProfile) -> Result<Vec<SessionControl>, String> {
    let raw: Option<String> = sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
        .bind(installation).fetch_optional(db).await.map_err(|e|e.to_string())?;
    let Some(raw) = raw else { return Ok(vec![]); };
    let manifest: Value = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    if !crate::plugin_manifest::activation_issues(&manifest)?.is_empty() { return Ok(vec![]); }
    let options = manifest["contributions"].as_array().and_then(|entries|entries.iter().find(|entry|entry["id"] == contribution))
        .and_then(|entry|entry.get("sessionControls")).cloned().unwrap_or_else(||serde_json::json!([]));
    let declared: Vec<SessionControl> = serde_json::from_value(options).map_err(|e|e.to_string())?;
    Ok(declared.into_iter().filter(|option|apply(profile.enforcement_backend, &profile.requested, option).is_ok()).collect())
}

pub(crate) fn select(profile: &ResolvedExecutionProfile, id: &str) -> Result<ResolvedExecutionProfile, String> {
    let option = profile.session_controls.iter().find(|option|option.id == id)
        .ok_or("unsupported: session control is unavailable")?;
    apply(profile.enforcement_backend, &profile.requested, option)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[tokio::test]
    async fn arbitrary_plugin_declarations_drive_pinned_session_controls_without_granting_authority() {
        let root = std::env::temp_dir().join(format!("aibo-session-controls-{}", ulid::Ulid::new()));
        let db = crate::open_database(&root.join("data/aibo.sqlite3")).await.unwrap();
        let source = root.join("plugin");
        fs::create_dir(&source).unwrap();
        let mut manifest: Value = serde_json::from_str(&include_str!("../capability-plugins/pi/plugin.json").replace("dev.aibo.pi", "org.example.writer")).unwrap();
        let mut declared = manifest["contributions"][0]["sessionControls"].as_array().unwrap().clone();
        declared[0]["id"] = json!("inspect-project");
        declared[0]["label"] = json!("Inspect project");
        declared[1]["id"] = json!("outline-first");
        declared[1]["command"] = json!("outline");
        declared[2]["id"] = json!("edit-project");
        let native: Value = serde_json::from_str(include_str!("../capability-plugins/codex/plugin.json")).unwrap();
        declared.push(native["contributions"][0]["sessionControls"][2].clone());
        manifest["contributions"][0]["sessionControls"] = json!(declared);
        fs::write(source.join("plugin.json"), manifest.to_string()).unwrap();
        fs::write(source.join("worker.mjs"), "// no runtime needed to inspect a declaration").unwrap();
        let installation = crate::plugin_registry::install(&db, &root.join("data"), &source).await.unwrap();
        crate::plugin_registry::enable(&db, &installation.id, true).await.unwrap();
        let now = crate::now_iso();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'test',1,?,?)")
            .bind(root.to_string_lossy().as_ref()).bind(&now).bind(&now).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,plugin_installation_id,created_at,updated_at) VALUES('s','w','org.example.writer.agent','test','idle',?,?,?)")
            .bind(&installation.id).bind(&now).bind(&now).execute(&db).await.unwrap();
        let mut profile = execution_profile::resolve_with_backend(EnforcementBackend::CoreProxy, None, now).unwrap();
        profile.requested.model = Some("chosen-model".into());
        execution_profile::save_for_session(&db, "s", &profile).await.unwrap();
        let loaded = crate::session_execution_profile(&db, "s").await.unwrap().profile;
        assert_eq!(loaded.session_controls.iter().map(|control|control.id.as_str()).collect::<Vec<_>>(), ["inspect-project","outline-first","edit-project"]);
        assert_eq!(loaded.session_controls[0].label, "Inspect project");
        assert_eq!(loaded.session_controls[1].command.as_deref(), Some("outline"));
        assert!(select(&loaded, "full-access").is_err(), "a native-looking option cannot grant native authority");
        assert!(select(&loaded, "unknown").is_err());
        let editing = select(&loaded, "edit-project").unwrap();
        assert_eq!(editing.enforced.filesystem_policy, "workspace-write");
        assert_eq!(editing.requested.model.as_deref(), Some("chosen-model"));
        execution_profile::save_for_session(&db, "s", &editing).await.unwrap();
        let loaded = crate::session_execution_profile(&db, "s").await.unwrap().profile;
        let plan = select(&loaded, "outline-first").unwrap();
        assert_eq!(plan.enforced.interaction_mode, "plan");
        assert_eq!(plan.enforced.filesystem_policy, "read-only");
        crate::plugin_registry::enable(&db, &installation.id, false).await.unwrap();
        let disabled = crate::session_execution_profile(&db, "s").await.unwrap().profile;
        assert!(disabled.session_controls.is_empty());
        assert!(select(&disabled, "edit-project").is_err());
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn declared_native_permission_changes_preserve_session_mode_and_require_host_grant() {
        let manifest: Value = serde_json::from_str(include_str!("../capability-plugins/codex/plugin.json")).unwrap();
        let options: Vec<SessionControl> = serde_json::from_value(manifest["contributions"][0]["sessionControls"].clone()).unwrap();
        let mut current = execution_profile::resolve_with_backend(EnforcementBackend::CodexNative, None, "now".into()).unwrap();
        current.requested.interaction_mode = "plan".into();
        current.session_controls = options;
        for control in &current.session_controls {
            assert_eq!(control.kind, "permission");
            let selected = select(&current, &control.id).unwrap();
            assert_eq!(selected.requested.interaction_mode, "plan");
        }
        current.enforcement_backend = EnforcementBackend::Unnegotiated;
        assert!(select(&current, "full-access").is_err());
    }

    #[test]
    fn absent_declarations_do_not_invent_menus_and_invalid_declarations_are_rejected() {
        let mut manifest: Value = serde_json::from_str(include_str!("../capability-plugins/pi/plugin.json")).unwrap();
        let option = manifest["contributions"][0]["sessionControls"][0].clone();
        manifest["contributions"][0]["sessionControls"] = json!([option.clone(),option]);
        assert!(crate::plugin_manifest::normalize(&manifest).is_err());
        manifest["contributions"][0]["sessionControls"].as_array_mut().unwrap().pop();
        manifest["contributions"][0]["sessionControls"][0]["command"] = json!("settings");
        assert!(crate::plugin_manifest::normalize(&manifest).is_err());
        manifest["contributions"][0]["sessionControls"][0].as_object_mut().unwrap().remove("command");
        manifest["contributions"][0]["sessionControls"][0]["kind"] = json!("permission");
        assert!(crate::plugin_manifest::normalize(&manifest).is_err(), "permission control must not change interaction mode");
        manifest["contributions"][0].as_object_mut().unwrap().remove("sessionControls");
        assert!(crate::plugin_manifest::normalize(&manifest).is_ok());
        assert!(execution_profile::resolve_with_backend(EnforcementBackend::CodexNative, None, "now".into()).unwrap().session_controls.is_empty());
    }
}
