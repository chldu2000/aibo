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
    scope == if id == "aibo.session.catalog" { "workspace" } else { "session" } && operation["capability"]["version"] == "1.0.0"
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


pub(crate) fn feature_contracts() -> &'static Value {
    static FEATURES: OnceLock<Value> = OnceLock::new();
    FEATURES.get_or_init(|| serde_json::from_str(include_str!("../../contracts/session-features.v1.json")).unwrap())
}

/// Intersect runtime claims, the pinned manifest and the actual runtime handshake.
/// Unknown features are not advertised as host functionality. Each invocation is
/// still checked by the Broker, including permission grants and runtime identity.
pub(crate) fn negotiate(manifest: &Value, contribution: &str, claimed: &Value, handshake: &Value) -> Vec<String> {
    let Some(entry) = manifest["contributions"].as_array().and_then(|entries| entries.iter().find(|entry|
        entry["id"] == contribution && entry["kind"] == "capabilityProvider" && entry["scope"] == "session")) else { return vec![]; };
    let operations = entry["operations"].as_array().map(Vec::as_slice).unwrap_or_default();
    let prefix = format!("{}.", manifest["pluginId"].as_str().unwrap_or_default());
    let operation = |id: &str| operations.iter().find(|op| {
        op["capability"]["id"] == id && op["capability"]["version"] == "1.0.0"
            && handshake.as_array().is_some_and(|items| items.contains(&serde_json::json!({
                "capability":id,"version":"1.0.0","operationId":op["id"]
            })))
    });
    let standard = |id: &str| operation(id).is_some_and(|op| validates_operation(op, "session", manifest));
    let optional = |name: &str| operation(&format!("{prefix}{name}")).is_some_and(|op|
        op["effect"] == "read" && op["permissions"] == serde_json::json!(["workspace.read"])
        && feature_contracts()["capabilities"][name].as_array().is_some_and(|variants| variants.iter().any(|shape|
            shape["inputSchema"] == op["inputSchema"] && shape["outputSchema"] == op["outputSchema"])));
    let claims: Vec<&str> = claimed.as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let mut result = Vec::new();
    for name in &claims {
        let supported = match *name {
            "session.create" | "session.resume" => standard("aibo.session.open"),
            "session.close" => standard("aibo.session.close"),
            "turn.send" | "stream.text" => standard("aibo.session.turn"),
            "turn.cancel" => standard("aibo.session.cancel"),
            "goal.resume" => claims.contains(&"goal.manage") && optional("goal.manage") && standard("aibo.session.goal.resume"),
            "goal.pause" => claims.contains(&"goal.manage") && optional("goal.manage")
                && operation(&format!("{prefix}goal.manage")).is_some_and(|op|
                    op["inputSchema"]["properties"]["action"]["enum"].as_array().is_some_and(|actions| actions.contains(&serde_json::json!("pause")))),
            _ => optional(name),
        };
        if supported && !result.iter().any(|existing| existing == name) { result.push((*name).to_owned()); }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn handshake(manifest: &Value) -> Value {
        serde_json::json!(manifest["contributions"][0]["operations"].as_array().unwrap().iter().map(|op|
            serde_json::json!({"capability":op["capability"]["id"],"version":op["capability"]["version"],"operationId":op["id"]})).collect::<Vec<_>>())
    }

    #[test]
    fn third_party_features_require_claims_contracts_and_runtime_agreement() {
        let source = include_str!("../capability-plugins/pi/plugin.json").replace("dev.aibo.pi", "org.example.agent");
        let manifest: Value = serde_json::from_str(&source).unwrap();
        let claims = serde_json::json!(["session.tree","session.timeline","compaction.run","model.select","session.fork","permissions.nativeControls","unknown"]);
        let runtime = handshake(&manifest);
        assert_eq!(negotiate(&manifest, "org.example.agent.agent", &claims, &runtime), ["session.tree","session.timeline","compaction.run","model.select"]);
        assert!(negotiate(&manifest, "foreign", &claims, &runtime).is_empty());
        assert!(negotiate(&manifest, "org.example.agent.agent", &claims, &serde_json::json!([])).is_empty());
        assert!(negotiate(&manifest, "org.example.agent.agent", &serde_json::json!([]), &runtime).is_empty());
        for field in ["inputSchema", "outputSchema"] {
            let mut broken = manifest.clone();
            let op = broken["contributions"][0]["operations"].as_array_mut().unwrap().iter_mut().find(|op|op["capability"]["id"] == "org.example.agent.session.tree").unwrap();
            op[field] = serde_json::json!({"type":"object"});
            assert!(!negotiate(&broken, "org.example.agent.agent", &claims, &runtime).contains(&"session.tree".into()));
        }
        let mut missing = runtime.clone();
        missing.as_array_mut().unwrap().retain(|op| op["capability"] != "org.example.agent.session.timeline");
        assert!(!negotiate(&manifest, "org.example.agent.agent", &claims, &missing).contains(&"session.timeline".into()));
    }

    #[test]
    fn goals_are_negotiated_without_a_builtin_identity() {
        let source = include_str!("../capability-plugins/codex/plugin.json").replace("dev.aibo.codex", "org.example.goals");
        let manifest: Value = serde_json::from_str(&source).unwrap();
        let claims = serde_json::json!(["goal.manage","goal.pause","goal.resume","session.fork"]);
        assert_eq!(negotiate(&manifest,"org.example.goals.agent",&claims,&handshake(&manifest)),["goal.manage","goal.pause","goal.resume","session.fork"]);
        assert!(negotiate(&manifest,"org.example.goals.agent",&serde_json::json!(["goal.pause","goal.resume"]),&handshake(&manifest)).is_empty());
    }


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
