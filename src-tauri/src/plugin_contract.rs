use serde_json::Value;
use std::sync::OnceLock;

pub(crate) struct PluginContracts {
    pub manifest_v2: jsonschema::Validator,
    pub manifest: jsonschema::Validator,
    pub capability_runtime: jsonschema::Validator,
    pub runtime: jsonschema::Validator,
    pub view: jsonschema::Validator,
    pub binding: jsonschema::Validator,
}

pub(crate) fn contracts() -> &'static PluginContracts {
    static CONTRACTS: OnceLock<PluginContracts> = OnceLock::new();
    CONTRACTS.get_or_init(|| {
        let manifest: Value = serde_json::from_str(include_str!("../../contracts/plugin-manifest.v1.schema.json")).unwrap();
        let manifest_v2: Value = serde_json::from_str(include_str!("../../contracts/plugin-manifest.v2.schema.json")).unwrap();
        let capability_runtime: Value = serde_json::from_str(include_str!("../../contracts/capability-runtime.experimental.schema.json")).unwrap();
        let runtime: Value = serde_json::from_str(include_str!("../../contracts/agent-runtime-protocol.v1.schema.json")).unwrap();
        let view: Value = serde_json::from_str(include_str!("../../contracts/plugin-view-protocol.v1.schema.json")).unwrap();
        let binding: Value = serde_json::from_str(include_str!("../../contracts/plugin-session-binding.v1.schema.json")).unwrap();
        let compile = |schema: &Value| {
            jsonschema::options()
                .with_resource(view["$id"].as_str().unwrap(), jsonschema::Resource::from_contents(view.clone()).unwrap())
                .with_resource(binding["$id"].as_str().unwrap(), jsonschema::Resource::from_contents(binding.clone()).unwrap())
                .should_validate_formats(true)
                .build(schema).expect("embedded plugin contract must compile")
        };
        PluginContracts { capability_runtime: compile(&capability_runtime), manifest_v2: compile(&manifest_v2), manifest: compile(&manifest), runtime: compile(&runtime), view: compile(&view), binding: compile(&binding) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_entire_lifecycle_against_frozen_schemas() {
        let c = contracts();
        let manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
        assert!(c.manifest.is_valid(&manifest));
        for line in include_str!("../../fixtures/plugins/echo-agent.lifecycle.jsonl").lines() {
            let record: Value = serde_json::from_str(line).unwrap();
            if let Err(error) = c.runtime.validate(&record["message"]) { panic!("{error}"); }
        }
        let mut view: Value = serde_json::from_str::<Value>(include_str!("../../fixtures/plugins/echo-agent.lifecycle.jsonl").lines().find(|line| line.contains("view/render")).unwrap()).unwrap()["message"]["params"]["document"].clone();
        assert!(c.view.is_valid(&view));
        view["root"]["props"]["style"] = Value::String("color:red".into());
        assert!(!c.view.is_valid(&view));
        assert!(!c.binding.is_valid(&serde_json::json!({})));
    }
}
