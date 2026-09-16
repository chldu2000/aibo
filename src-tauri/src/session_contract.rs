//! Host-governed session contracts shared by capability providers.
use serde_json::Value;
use std::sync::OnceLock;

pub(crate) fn contracts() -> &'static Value {
    static CONTRACTS: OnceLock<Value> = OnceLock::new();
    CONTRACTS.get_or_init(||serde_json::from_str(include_str!("../../contracts/session-capabilities.v1.json")).unwrap())
}
pub(crate) fn event_schema()->&'static jsonschema::Validator {
    static SCHEMA:OnceLock<jsonschema::Validator>=OnceLock::new();
    SCHEMA.get_or_init(||jsonschema::options().build(&serde_json::from_str::<Value>(include_str!("../../contracts/session-event.v1.schema.json")).unwrap()).unwrap())
}
pub(crate) fn binding_schema()->&'static jsonschema::Validator {
    static SCHEMA:OnceLock<jsonschema::Validator>=OnceLock::new();
    SCHEMA.get_or_init(||jsonschema::options().should_validate_formats(true).build(&serde_json::from_str::<Value>(include_str!("../../contracts/session-binding.v2.schema.json")).unwrap()).unwrap())
}

pub(crate) fn validates_operation(operation: &Value, scope: &str, manifest: &Value) -> bool {
    let Some(id) = operation["capability"]["id"].as_str() else { return false; };
    let Some(contract) = contracts()["capabilities"].get(id) else { return false; };
    let write = matches!(id, "aibo.session.turn.write" | "aibo.session.goal.resume.write");
    scope == "session" && operation["capability"]["version"] == "1.0.0"
        && manifest["protocols"]["runtime"]["min"] == "2.1" && manifest["protocols"]["runtime"]["max"] == "2.1"
        && operation["inputSchema"] == contract["inputSchema"] && operation["outputSchema"] == contract["outputSchema"]
        && operation["effect"] == if write {"write"} else {"read"}
        && operation["permissions"] == if write {serde_json::json!(["workspace.read","workspace.write"])} else {serde_json::json!(["workspace.read"])}
}

/// Host queue ownership and optional native steering are separate capabilities.
/// Derive them from the pinned contract, never a provider name or a host-added flag.
pub(crate) fn queue_capabilities(manifest: &Value, contribution: &str, provider: &[String]) -> (bool, bool) {
    let Some(entry) = manifest["contributions"].as_array().and_then(|entries| entries.iter().find(|entry|
        entry["id"] == contribution && entry["kind"] == "capabilityProvider" && entry["scope"] == "session")) else { return (false, false); };
    let Some(operations) = entry["operations"].as_array() else { return (false, false); };
    let standard = ["aibo.session.open", "aibo.session.turn", "aibo.session.cancel", "aibo.session.close"].iter().all(|id|
        operations.iter().any(|operation| operation["capability"]["id"] == *id && validates_operation(operation, "session", manifest)));
    if !standard { return (false, false); }
    let qualified = format!("{}.queue.manage", manifest["pluginId"].as_str().unwrap_or_default());
    let steering = provider.iter().any(|capability| capability == "queue.manage") && operations.iter().any(|operation|
        operation["capability"]["id"] == qualified && operation["capability"]["version"] == "1.0.0"
        && operation["inputSchema"]["properties"]["action"]["enum"].as_array().is_some_and(|actions| actions.contains(&serde_json::json!("steer"))));
    (true, steering)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queue_support_uses_the_standard_contract_and_explicit_steering_declaration() {
        let source = include_str!("../capability-plugins/pi/plugin.json").replace("dev.aibo.pi", "dev.example.queue");
        let manifest: Value = serde_json::from_str(&source).unwrap();
        let id = "dev.example.queue.agent";
        assert_eq!(queue_capabilities(&manifest, id, &[]), (true, false));
        assert_eq!(queue_capabilities(&manifest, id, &["queue.manage".into()]), (true, true));
        assert_eq!(queue_capabilities(&manifest, id, &["queue.steer".into()]), (true, false));
        let mut no_steering = manifest.clone();
        let operations = no_steering["contributions"][0]["operations"].as_array_mut().unwrap();
        operations.iter_mut().find(|op| op["capability"]["id"] == "dev.example.queue.queue.manage").unwrap()["inputSchema"]["properties"]["action"]["enum"] = serde_json::json!(["followUp"]);
        assert_eq!(queue_capabilities(&no_steering, id, &["queue.manage".into()]), (true, false));
        for missing in ["aibo.session.open", "aibo.session.turn", "aibo.session.cancel", "aibo.session.close"] {
            let mut incomplete = manifest.clone();
            incomplete["contributions"][0]["operations"].as_array_mut().unwrap().retain(|op| op["capability"]["id"] != missing);
            assert_eq!(queue_capabilities(&incomplete, id, &["queue.manage".into()]), (false, false));
        }
        let mut retired = manifest.clone();
        retired["protocols"]["runtime"]["min"] = serde_json::json!("2.0");
        assert_eq!(queue_capabilities(&retired, id, &["queue.manage".into()]), (false, false));
        assert_eq!(queue_capabilities(&manifest, "foreign", &[]), (false, false));
    }

    #[test]
    fn native_session_capability_packages_use_shared_contracts_without_agent_contributions() {
        for text in [include_str!("../capability-plugins/codex/plugin.json"),include_str!("../capability-plugins/pi/plugin.json")] {
            let manifest:Value=serde_json::from_str(text).unwrap();
            let model=crate::plugin_manifest::normalize(&manifest).unwrap();
            assert!(model.agents().next().is_none());
            assert!(crate::plugin_manifest::activation_issues(&manifest).unwrap().is_empty());
            let mut wrong=manifest.clone();
            wrong["contributions"][0]["operations"][0]["inputSchema"]=serde_json::json!({"type":"object"});
            assert!(crate::plugin_manifest::normalize(&wrong).is_err());
        }
    }
}
