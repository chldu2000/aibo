use serde_json::Value;
use std::sync::OnceLock;

pub(crate) struct PluginContracts {
    pub manifest_v2: jsonschema::Validator,
    pub manifest: jsonschema::Validator,
    pub capability_runtime: jsonschema::Validator,
    pub capability_interactive: jsonschema::Validator,
}

pub(crate) fn contracts() -> &'static PluginContracts {
    static CONTRACTS: OnceLock<PluginContracts> = OnceLock::new();
    CONTRACTS.get_or_init(|| {
        let manifest: Value = serde_json::from_str(include_str!("../../contracts/plugin-manifest.v1.schema.json")).unwrap();
        let manifest_v2: Value = serde_json::from_str(include_str!("../../contracts/plugin-manifest.v2.schema.json")).unwrap();
        let capability_runtime: Value = serde_json::from_str(include_str!("../../contracts/capability-runtime.experimental.schema.json")).unwrap();
        let capability_interactive: Value = serde_json::from_str(include_str!("../../contracts/capability-runtime.v2.1.schema.json")).unwrap();
        let compile = |schema: &Value| {
            jsonschema::options()
                .should_validate_formats(true)
                .build(schema).expect("embedded plugin contract must compile")
        };
        PluginContracts { capability_interactive: compile(&capability_interactive), capability_runtime: compile(&capability_runtime), manifest_v2: compile(&manifest_v2), manifest: compile(&manifest) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_retired_manifest_metadata_without_compiling_agent_runtime() {
        let manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
        assert!(contracts().manifest.is_valid(&manifest));
        let legacy_event = serde_json::json!({
            "jsonrpc": "2.0", "method": "agent/event", "params": {}
        });
        assert!(!contracts().capability_runtime.is_valid(&legacy_event));
        assert!(!contracts().capability_interactive.is_valid(&legacy_event));
    }
}
