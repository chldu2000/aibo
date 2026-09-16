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

#[cfg(test)]
mod tests {
    use super::*;
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
