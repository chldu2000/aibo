//! Internal contribution index. The original manifest and v1 wire data are never rewritten.
use crate::plugin_contract::contracts;
use crate::ui_i18n::{HostMessage, descriptor};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Contribution {
    pub id: String,
    pub kind: String,
    pub scope: String,
    pub required: bool,
    pub metadata: Value,
}

pub(crate) struct ManifestModel {
    pub version: u8,
    pub contributions: Vec<Contribution>,
    pub executable_dependencies: Vec<Value>,
}

impl ManifestModel {
    pub fn agents(&self) -> impl Iterator<Item = &Value> {
        self.contributions.iter().filter(|entry| entry.kind == "agent").map(|entry| &entry.metadata)
    }
    /// Session pickers index domain contributions, without creating a second runtime kind.
    pub fn session_agents(&self,plugin:&str)->Vec<Value> {
        let mut agents:Vec<Value>=self.agents().cloned().collect();
        for entry in self.contributions.iter().filter(|entry|entry.kind=="capabilityProvider" && entry.scope=="session") {
            let operations=entry.metadata["operations"].as_array().unwrap();
            if !operations.iter().any(|op|op["capability"]["id"]=="aibo.session.open") {continue;}
            let mut capabilities=vec!["session.create".to_string(),"session.resume".into(),"session.close".into(),"turn.send".into(),"turn.cancel".into(),"stream.text".into()];
            for operation in operations {if let Some(cap)=operation["capability"]["id"].as_str().and_then(|id|id.strip_prefix(&format!("{plugin}."))) {capabilities.push(cap.into());}}
            agents.push(json!({"agentId":entry.id,"displayName":entry.metadata["displayName"],"description":entry.metadata["description"],"capabilities":capabilities,"requestedPermissions":[],"views":[]}));
        }
        agents
    }
}

fn invalid(key: &str, diagnostic: &str) -> HostMessage {
    HostMessage::with_diagnostic(key, json!({}), format!("invalid_manifest: {diagnostic}"))
}
fn owned(id: &str, plugin: &str) -> bool { id.starts_with(&format!("{plugin}.")) }
fn range(value: &Value) -> Result<(), HostMessage> {
    let min = semver::Version::parse(value["min"].as_str().unwrap()).map_err(|_| invalid("native.manifest.minimumVersion", "invalid minimum version"))?;
    let max = semver::Version::parse(value["maxExclusive"].as_str().unwrap()).map_err(|_| invalid("native.manifest.maximumVersion", "invalid maximum version"))?;
    if min >= max { return Err(invalid("native.manifest.versionRange", "empty version range")); }
    Ok(())
}

// Inline, bounded JSON Schema only. No network/file resolution, regex execution,
// custom vocabularies or recursive references can be introduced by a package.
fn operation_schema(schema: &Value) -> Result<(), HostMessage> {
    fn visit(schema: &Value, depth: usize, nodes: &mut usize) -> Result<(), HostMessage> {
        *nodes += 1;
        if depth > 16 || *nodes > 2048 { return Err(invalid("native.manifest.schemaComplexity", "operation schema complexity limit")); }
        if schema.is_boolean() { return Ok(()); }
        let object = schema.as_object().ok_or_else(|| invalid("native.manifest.schemaObject", "operation schema must be an object or boolean"))?;
        for (key, value) in object {
            match key.as_str() {
                "properties" => for child in value.as_object().ok_or_else(|| invalid("native.manifest.schemaProperties", "schema properties"))?.values() { visit(child, depth + 1, nodes)?; },
                "items" | "additionalProperties" | "not" => visit(value, depth + 1, nodes)?,
                "anyOf" | "oneOf" | "allOf" => for child in value.as_array().ok_or_else(|| invalid("native.manifest.schemaAlternatives", "schema alternatives"))? { visit(child, depth + 1, nodes)?; },
                "type" | "enum" | "const" | "required" | "minLength" | "maxLength" | "minItems" | "maxItems" | "uniqueItems" | "minimum" | "maximum" | "minProperties" | "maxProperties" | "description" | "title" => {},
                _ => return Err(invalid("native.manifest.schemaKeyword", "unsupported operation schema keyword")),
            }
        }
        Ok(())
    }
    if schema.to_string().len() > 65_536 { return Err(invalid("native.manifest.schemaBytes", "operation schema byte limit")); }
    visit(schema, 0, &mut 0)?;
    jsonschema::options().build(schema).map_err(|_| invalid("native.manifest.operationSchema", "invalid operation JSON Schema"))?;
    Ok(())
}

pub(crate) fn normalize(manifest: &Value) -> Result<ManifestModel, String> {
    normalize_display(manifest).map_err(|error|error.diagnostic)
}

pub(crate) fn normalize_display(manifest: &Value) -> Result<ManifestModel, HostMessage> {
    let version = match manifest["schema"].as_str() {
        Some("aibo.plugin-manifest/v1") => 1,
        Some("aibo.plugin-manifest/v2") => 2,
        _ => return Err(invalid("native.manifest.manifestVersion", "unsupported manifest version")),
    };
    let validator = if version == 1 { &contracts().manifest } else { &contracts().manifest_v2 };
    if !validator.is_valid(manifest) { return Err(invalid("native.manifest.schemaValidation", "schema validation failed")); }
    if manifest.to_string().len() > 1_048_576 { return Err(invalid("native.manifest.manifestBytes", "manifest byte limit")); }
    let mut ids = HashSet::new();
    if version == 1 {
        let mut contributions = Vec::new();
        for agent in manifest["agents"].as_array().unwrap() {
            let id = agent["agentId"].as_str().unwrap();
            if !ids.insert(id) { return Err(invalid("native.manifest.duplicateAgent", "duplicate Agent ID")); }
            contributions.push(Contribution { id: id.into(), kind: "agent".into(), scope: "session".into(), required: true, metadata: agent.clone() });
        }
        return Ok(ManifestModel { version, contributions, executable_dependencies: manifest["dependencies"].as_array().cloned().unwrap_or_default() });
    }
    semver::Version::parse(manifest["version"].as_str().unwrap()).map_err(|_| invalid("native.manifest.packageVersion", "invalid package version"))?;
    range(&manifest["host"])?;
    if let Some(sdk) = manifest.get("hostSdk") {
        range(sdk)?;
        let entry = manifest["entrypoint"]["executable"].as_str().unwrap_or("");
        if !entry.ends_with(".mjs") && !entry.ends_with(".js") {
            return Err(invalid("native.manifest.sdkEntrypoint", "hostSdk requires a Node ESM entrypoint (.mjs or .js)"));
        }
    }
    for bounds in manifest["protocols"].as_object().into_iter().flat_map(|object| object.values()) {
        let min = semver::Version::parse(&format!("{}.0", bounds["min"].as_str().unwrap())).map_err(|_| invalid("native.manifest.protocolMinimum", "invalid protocol minimum"))?;
        let max = semver::Version::parse(&format!("{}.0", bounds["max"].as_str().unwrap())).map_err(|_| invalid("native.manifest.protocolMaximum", "invalid protocol maximum"))?;
        if min > max { return Err(invalid("native.manifest.protocolRange", "empty protocol range")); }
    }
    for dependency in manifest["executableDependencies"].as_array().into_iter().flatten() {
        if let Some(range) = dependency["versionRange"].as_str() {
            semver::VersionReq::parse(range).map_err(|_| invalid("native.manifest.executableRange", "invalid executable version range"))?;
        }
    }
    crate::plugin_authentication::validate_declaration(manifest)?;
    let plugin = manifest["pluginId"].as_str().unwrap();
    if plugin.starts_with("aibo.") { return Err(invalid("native.manifest.reservedNamespace", "aibo namespace is reserved for host contracts")); }
    let mut contributions = Vec::new();
    let mut operation_ids = HashSet::new();
    for entry in manifest["contributions"].as_array().unwrap() {
        let id = entry["id"].as_str().unwrap();
        if !owned(id, plugin) { return Err(invalid("native.manifest.contributionOwner", "contribution ID must belong to its plugin")); }
        if !ids.insert(id) { return Err(invalid("native.manifest.duplicateContribution", "duplicate contribution ID")); }
        let kind = entry["kind"].as_str().unwrap();
        crate::session_controls::validate_declaration(entry)?;
        if kind == "semanticView" {
            range(&entry["provider"]["version"])?;
            let expected_scope = match entry["extensionPoint"].as_str().unwrap() {
                "workspace.tool" => Some("workspace"), "session.context" | "session.action" => Some("session"), "settings.page" => Some("application"), _ => None,
            };
            if expected_scope.is_some_and(|scope| entry["scope"] != scope) { return Err(invalid("native.manifest.extensionScope", "extension point scope mismatch")); }
            if entry["visibility"] == "sessionSelected" && entry["scope"] != "session" || entry["visibility"] == "workspaceSelected" && entry["scope"] == "application" {return Err(invalid("native.manifest.visibilityScope", "visibility cannot be satisfied by contribution scope"));}
            semver::Version::parse(entry["contractVersion"].as_str().unwrap()).map_err(|_| invalid("native.manifest.semanticVersion", "invalid semantic contract version"))?;
        }
        let mut write_ids = HashSet::new();
        for action in entry["writeActions"].as_array().into_iter().flatten() {
            if kind != "semanticView" || entry["contractVersion"] != "1.1.0" || entry["scope"] == "application" || !owned(action["id"].as_str().unwrap(),plugin) || !write_ids.insert(action["id"].as_str().unwrap()) { return Err(invalid("native.manifest.writeAction", "write action identity, scope or semantic version")); }
            range(&action["provider"]["version"])?;
        }
        let mut mappings = HashSet::new();
        for operation in entry["operations"].as_array().into_iter().flatten() {
            let operation_id = operation["id"].as_str().unwrap();
            let prefix = if kind == "agent" { format!("ext.{plugin}.") } else { format!("{plugin}.") };
            if !operation_id.starts_with(&prefix) || !operation_ids.insert(operation_id) { return Err(invalid("native.manifest.operationIdentity", "operation ID ownership or uniqueness")); }
            if kind == "capabilityProvider" {
                let capability = operation["capability"]["id"].as_str().unwrap();
                if !mappings.insert((capability,operation["capability"]["version"].as_str().unwrap())) { return Err(invalid("native.manifest.capabilityMapping", "ambiguous capability operation mapping")); }
                if capability.starts_with("aibo.session.") {
                    if !crate::session_contract::validates_operation(operation,entry["scope"].as_str().unwrap(),manifest) { return Err(invalid("native.manifest.sessionContract", "session capability must use the host contract, scope, protocol and permissions")); }
                } else if !owned(capability, plugin) { return Err(invalid("native.manifest.capabilityOwner", "custom capability contract must belong to its plugin")); }
                semver::Version::parse(operation["capability"]["version"].as_str().unwrap()).map_err(|_| invalid("native.manifest.capabilityVersion", "invalid capability version"))?;
            }
            operation_schema(&operation["inputSchema"])?;
            operation_schema(&operation["outputSchema"])?;
        }
        if let Some(settings) = entry.get("settings") {
            if kind != "capabilityProvider" || entry["scope"] != "session" || !entry["operations"].as_array().unwrap().iter().any(|op| op["capability"]["id"] == "aibo.session.open") {
                return Err(invalid("native.manifest.settingsProvider", "settings require a session Agent provider"));
            }
            crate::agent_settings::validate_descriptor(settings).map_err(|_| invalid("native.manifest.settingsDescriptor", "invalid Agent settings descriptor"))?;
        }
        let mut metadata = entry.clone();
        if kind == "agent" {
            let object = metadata.as_object_mut().unwrap();
            for field in ["id", "kind", "scope", "required"] { object.remove(field); }
            object.insert("agentId".into(), json!(id));
        }
        contributions.push(Contribution { id: id.into(), kind: kind.into(), scope: entry["scope"].as_str().unwrap().into(), required: entry["required"].as_bool().unwrap(), metadata });
    }
    let mut dependencies = HashSet::new();
    for dependency in manifest["packageDependencies"].as_array().into_iter().flatten() {
        let dependency_id = dependency["pluginId"].as_str().unwrap();
        if dependency_id == plugin || !dependencies.insert(dependency_id) { return Err(invalid("native.manifest.packageDependency", "self or duplicate package dependency")); }
        range(&dependency["version"])?;
        if dependency["contributionIds"].as_array().unwrap().iter().any(|id| !ids.contains(id.as_str().unwrap())) { return Err(invalid("native.manifest.dependencyContribution", "dependency references an unknown local contribution")); }
    }
    if let Some(presentation) = manifest.get("presentation") {
        let id = presentation["id"].as_str().unwrap();
        if !owned(id, plugin) || ids.contains(id) { return Err(invalid("native.manifest.presentationIdentity", "presentation ID ownership or uniqueness")); }
        semver::Version::parse(presentation["contractVersion"].as_str().unwrap()).map_err(|_| invalid("native.manifest.presentationVersion", "invalid presentation version"))?;
    }
    Ok(ManifestModel { version, contributions, executable_dependencies: manifest["executableDependencies"].as_array().cloned().unwrap_or_default() })
}

pub(crate) fn semantic_supported(metadata: &Value, manifest: &Value) -> bool {
    matches!(metadata["contractVersion"].as_str(),Some("1.0.0" | "1.1.0"))
        && matches!(metadata["semanticType"].as_str(),Some("collection" | "detail" | "settings" | "inspector"))
        && {let protocol = if metadata["contractVersion"] == "1.1.0" {"1.1"} else {"1.0"}; manifest["protocols"]["semanticView"]["min"] == protocol && manifest["protocols"]["semanticView"]["max"] == protocol}

}

pub(crate) fn contribution_supported(entry: &Contribution, manifest: &Value) -> bool {
    match entry.kind.as_str() {
        "semanticView" => semantic_supported(&entry.metadata,manifest),
        "capabilityProvider" => matches!(manifest["protocols"]["runtime"]["min"].as_str(),Some("2.0" | "2.1")) && manifest["protocols"]["runtime"]["max"] == manifest["protocols"]["runtime"]["min"]
            && entry.metadata["operations"].as_array().unwrap().iter().all(|operation| {
                let permissions = operation["permissions"].as_array().unwrap();
                if operation["effect"] == "write" {
                    entry.scope != "application" && permissions.iter().any(|permission|permission == "workspace.write")
                        && permissions.iter().all(|permission|permission == "workspace.read" || permission == "workspace.write")
                } else { permissions.iter().all(|permission|permission == "workspace.read") }
            }),
        _ => false,
    }
}

/// Installation is distinct from activation. Never launch v2 through the v1 runtime.
/// These diagnostics are replaced by negotiated Broker/runtime checks in P3.2/P3.3.
pub(crate) fn activation_issues(manifest: &Value) -> Result<Vec<String>, String> {
    Ok(activation_diagnostics(manifest).map_err(|error|error.diagnostic)?.into_iter().map(|issue|issue.diagnostic).collect())
}

pub(crate) fn activation_diagnostics(manifest: &Value) -> Result<Vec<HostMessage>, HostMessage> {
    let model = normalize_display(manifest)?;
    if model.version == 1 { return Ok(vec![HostMessage::new("native.activation.retired", json!({}))]); }
    let mut issues = vec![];
    let host = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
    let min = semver::Version::parse(manifest["host"]["min"].as_str().unwrap()).unwrap();
    let max = semver::Version::parse(manifest["host"]["maxExclusive"].as_str().unwrap()).unwrap();
    if host < min || host >= max { issues.push(HostMessage::new("native.activation.hostVersion", json!({}))); }
    if let Some(sdk) = manifest.get("hostSdk") {
        let version = semver::Version::parse(crate::plugin_sdk::VERSION).unwrap();
        let min = semver::Version::parse(sdk["min"].as_str().unwrap()).unwrap();
        let max = semver::Version::parse(sdk["maxExclusive"].as_str().unwrap()).unwrap();
        if version < min || version >= max { issues.push(HostMessage::new("native.activation.sdkVersion", json!({"version":version.to_string()}))); }
    }
    for entry in model.contributions.iter().filter(|entry|entry.required && !contribution_supported(entry,manifest)) {
        let operation = entry.metadata["operations"].as_array().and_then(|operations|operations.iter().find(|operation| {
            let Some(permissions) = operation["permissions"].as_array() else { return false; };
            operation["effect"] == "write" && (entry.scope == "application" || !permissions.iter().any(|permission|permission == "workspace.write") || permissions.iter().any(|permission|permission != "workspace.read" && permission != "workspace.write"))
                || operation["effect"] != "write" && permissions.iter().any(|permission|permission != "workspace.read")
        })).and_then(|operation|operation["id"].as_str());
        issues.push(HostMessage::new("native.activation.unsupported", json!({"id":entry.id,"kind":entry.kind,
            "operation":operation.map(|operation|json!(operation)).unwrap_or_else(||descriptor("native.activation.noOperation",json!({})))})));
    }
    if let Some(presentation) = manifest.get("presentation") {
        issues.push(HostMessage::new("native.activation.presentation", json!({"id":presentation["id"].as_str().map(|id|json!(id))
            .unwrap_or_else(||descriptor("native.activation.unknown",json!({})))})));
    }
    Ok(issues)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn view() -> Value { serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/declarative.json")).unwrap() }
    fn provider() -> Value { serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/provider.json")).unwrap() }

    #[test]
    fn manifest_validation_preserves_legacy_diagnostics_and_rejects_the_same_declarations() {
        use crate::ui_i18n::{render, Locale};
        let mut reserved = provider();reserved["pluginId"] = json!("aibo.core");
        let mut foreign = provider();foreign["contributions"][0]["id"] = json!("other.plugin.read");
        let mut range = provider();range["host"] = json!({"min":"0.2.0","maxExclusive":"0.1.0"});
        let mut executable = provider();executable["executableDependencies"][0]["versionRange"] = json!("not a version");
        let mut sdk = provider();sdk["hostSdk"] = json!({"min":"0.1.0","maxExclusive":"0.2.0"});sdk["entrypoint"]["executable"] = json!("worker.exe");
        for (manifest, diagnostic, en, zh) in [
            (json!({"schema":"unsupported"}), "invalid_manifest: unsupported manifest version", "The manifest version is unsupported.", "不支持此清单版本。"),
            (json!({"schema":"aibo.plugin-manifest/v2"}), "invalid_manifest: schema validation failed", "The manifest does not match its schema.", "清单不符合其 schema。"),
            (reserved, "invalid_manifest: aibo namespace is reserved for host contracts", "The aibo namespace is reserved for host contracts.", "aibo 命名空间保留给宿主合同。"),
            (foreign, "invalid_manifest: contribution ID must belong to its plugin", "The contribution ID must belong to its plugin.", "贡献 ID 必须属于其插件。"),
            (range, "invalid_manifest: empty version range", "The version range is empty.", "版本范围为空。"),
            (executable, "invalid_manifest: invalid executable version range", "The executable version range is invalid.", "可执行程序版本范围无效。"),
            (sdk, "invalid_manifest: hostSdk requires a Node ESM entrypoint (.mjs or .js)", "hostSdk requires a Node ESM entrypoint (.mjs or .js).", "hostSdk 要求使用 Node ESM 入口（.mjs 或 .js）。"),
        ] {
            let before = manifest.clone();
            let error = normalize_display(&manifest).err().unwrap();
            assert_eq!(error.diagnostic, diagnostic);
            assert_eq!(normalize(&manifest).err().unwrap(), diagnostic);
            assert_eq!(render(Locale::En, &error.display()), en);
            assert_eq!(render(Locale::ZhCn, &error.display()), zh);
            assert_eq!(serde_json::to_value(&error).unwrap()["localized"]["schema"], "aibo.host-message/v1");
            assert_eq!(manifest, before);
        }
        let manifest = provider();
        let legacy = normalize(&manifest).unwrap();
        let display = normalize_display(&manifest).unwrap();
        assert_eq!(serde_json::to_value(&legacy.contributions).unwrap(), serde_json::to_value(&display.contributions).unwrap());
        assert_eq!(legacy.executable_dependencies, display.executable_dependencies);
    }

    #[test]
    fn bounded_operation_schema_validation_retains_diagnostics_and_localized_reasons() {
        use crate::ui_i18n::{render, Locale};
        for (schema, diagnostic, en) in [
            (json!({"$ref":"file:///secret"}), "unsupported operation schema keyword", "The operation schema uses an unsupported keyword."),
            (json!([]), "operation schema must be an object or boolean", "The operation schema must be an object or boolean."),
            (json!({"properties":[]}), "schema properties", "Schema properties must be an object."),
            (json!({"anyOf":{}}), "schema alternatives", "Schema alternatives must be an array."),
            (json!({"type":"unknown"}), "invalid operation JSON Schema", "The operation JSON Schema is invalid."),
            (json!({"description":"x".repeat(65_537)}), "operation schema byte limit", "The operation schema exceeds the byte limit."),
        ] {
            let before = schema.clone();
            let error = operation_schema(&schema).unwrap_err();
            assert_eq!(error.diagnostic, format!("invalid_manifest: {diagnostic}"));
            assert_eq!(render(Locale::En, &error.display()), en);
            assert_ne!(render(Locale::ZhCn, &error.display()), error.diagnostic);
            assert!(!serde_json::to_string(&error).unwrap().contains("file:///secret"));
            assert_eq!(schema, before);
        }
        assert!(operation_schema(&json!(true)).is_ok());
        assert!(operation_schema(&json!({"type":"object","properties":{},"additionalProperties":false})).is_ok());
    }

    #[test]
    fn authentication_and_control_declaration_failures_keep_host_display_metadata() {
        use crate::ui_i18n::{render, Locale};
        let mut auth = provider();
        auth["authentication"] = json!({"kind":"cli-terminal","executable":"missing-cli","loginArgs":["login"],"statusArgs":["status"]});
        let mut controls = provider();
        controls["contributions"][0]["executionPolicy"] = json!("agent-managed");
        for (manifest, diagnostic, en) in [
            (auth, "invalid_manifest: authentication must reference a required executable dependency", "Authentication must reference a required executable dependency."),
            (controls, "invalid_manifest: execution policy requires a session provider", "The execution policy requires a session provider."),
        ] {
            let error = normalize_display(&manifest).err().unwrap();
            assert_eq!(error.diagnostic, diagnostic);
            assert_eq!(normalize(&manifest).err().unwrap(), diagnostic);
            assert_eq!(render(Locale::En, &error.display()), en);
        }
    }

    #[test]
    fn activation_display_preserves_diagnostics_and_manifest_identity() {
        use crate::ui_i18n::{render, Locale};
        let mut host = view(); host["host"] = json!({"min":"99.0.0","maxExclusive":"100.0.0"});
        let mut sdk = provider(); sdk["entrypoint"]["executable"] = json!("worker.mjs");
        sdk["hostSdk"] = json!({"min":"99.0.0","maxExclusive":"100.0.0"});
        let mut unsupported = provider();
        unsupported["contributions"][0]["operations"][0]["effect"] = json!("write");
        unsupported["contributions"][0]["operations"][0]["permissions"] = json!(["network.write"]);
        let mut semantic = view(); semantic["contributions"][0]["contractVersion"] = json!("2.0.0");
        let mut presentation = view();
        presentation["presentation"] = json!({"id":"dev.aibo.git-view.presentation","displayName":"插件原文 {id}","delivery":"host-bundled","requiredSemantics":["collection","detail"],"contractVersion":"1.0.0"});
        let legacy = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
        for (manifest, key, expected) in [
            (legacy, "native.activation.retired", "The legacy Agent runtime has been retired. This plugin retains historical metadata and cannot be enabled.".to_owned()),
            (host, "native.activation.hostVersion", "The current host version is outside the range required by this plugin.".to_owned()),
            (sdk, "native.activation.sdkVersion", format!("The current host SDK {} is outside the range required by this plugin.", crate::plugin_sdk::VERSION)),
            (unsupported, "native.activation.unsupported", "Required contribution dev.aibo.git.read is unsupported (type: capabilityProvider, operation: dev.aibo.git.changes). Check the runtime protocol, semantic version, scope, and permissions.".to_owned()),
            (semantic, "native.activation.unsupported", "Required contribution dev.aibo.git-view.changes is unsupported (type: semanticView, operation: no specific operation). Check the runtime protocol, semantic version, scope, and permissions.".to_owned()),
            (presentation, "native.activation.presentation", "Presentation contribution dev.aibo.git-view.presentation cannot be enabled through a capability plugin manifest yet. Install a separate presentation package.".to_owned()),
        ] {
            let before = manifest.clone();
            let diagnostics = activation_diagnostics(&manifest).unwrap();
            assert_eq!(diagnostics.len(), 1);
            let issue = &diagnostics[0];
            assert_eq!(issue.display()["key"], key);
            assert_eq!(render(Locale::En, &issue.display()), expected);
            assert_eq!(render(Locale::ZhCn, &issue.display()), issue.diagnostic);
            assert_eq!(activation_issues(&manifest).unwrap(), vec![issue.diagnostic.clone()]);
            assert_eq!(manifest, before, "display metadata cannot rewrite the manifest");
        }
    }

    #[test]
    fn host_sdk_requires_a_node_entrypoint_and_checks_its_own_version() {
        let mut manifest = provider();
        manifest["entrypoint"]["executable"] = json!("worker.mjs");
        manifest["hostSdk"] = json!({"min":"0.1.0","maxExclusive":"0.2.0"});
        assert!(normalize(&manifest).is_ok());
        assert!(!activation_issues(&manifest).unwrap().iter().any(|issue|issue.contains("SDK")));
        manifest["hostSdk"] = json!({"min":"0.2.0","maxExclusive":"0.3.0"});
        assert!(activation_issues(&manifest).unwrap().iter().any(|issue|issue.contains("SDK")));
        manifest["hostSdk"] = json!({"min":"0.1.0","maxExclusive":"0.1.0"});
        assert!(normalize(&manifest).is_err());
        manifest["hostSdk"] = json!({"min":"0.1.0","maxExclusive":"0.2.0"});
        manifest["entrypoint"]["executable"] = json!("worker.exe");
        assert!(normalize(&manifest).is_err());
    }

    #[test]
    fn retired_v1_metadata_is_readable_but_cannot_be_activated() {
        for source in [include_str!("../../fixtures/plugins/echo-agent/plugin.json")] {
            let manifest: Value = serde_json::from_str(source).unwrap();
            let before = manifest.clone();
            let model = normalize(&manifest).unwrap();
            assert_eq!(model.version, 1);
            assert_eq!(model.agents().cloned().collect::<Vec<_>>(), manifest["agents"].as_array().unwrap().clone());
            assert!(model.contributions.iter().all(|entry|entry.kind == "agent" && entry.scope == "session"));
            assert_eq!(model.executable_dependencies, manifest["dependencies"].as_array().cloned().unwrap_or_default());
            assert_eq!(manifest, before, "wire manifest must not be rewritten");
            assert!(activation_issues(&manifest).unwrap().iter().any(|issue| issue.contains("已退役")));
        }
    }

    #[test]
    fn session_icons_survive_normalization_and_reject_active_content() {
        for source in [include_str!("../capability-plugins/codex/plugin.json"), include_str!("../capability-plugins/pi/plugin.json")] {
            let manifest: Value = serde_json::from_str(source).unwrap();
            let normalized = normalize(&manifest).unwrap();
            assert_eq!(normalized.contributions[0].metadata["icon"], manifest["contributions"][0]["icon"]);
            for icon in [json!({"path":"<svg onload='alert(1)'>"}), json!({"path":"https://example.com/icon.svg"}), json!({"path":"M0 0Z", "fill":"red"}), json!({"path":format!("M{}", "0".repeat(8192))})] {
                let mut invalid = manifest.clone();
                invalid["contributions"][0]["icon"] = icon;
                assert!(normalize(&invalid).is_err());
            }
        }
    }

    #[test]
    fn declarative_packages_need_no_process_and_dependencies_are_distinct() {
        let manifest = view();
        let model = normalize(&manifest).unwrap();
        assert_eq!(model.version, 2);
        assert_eq!(model.contributions[0].kind, "semanticView");
        assert_eq!(model.agents().count(), 0);
        assert!(model.executable_dependencies.is_empty());
        assert!(!manifest.as_object().unwrap().contains_key("entrypoint"));
        assert!(activation_issues(&manifest).unwrap().is_empty());
        let mut unsupported=manifest.clone();unsupported["contributions"][0]["contractVersion"]=json!("2.0.0");
        assert!(!activation_issues(&unsupported).unwrap().is_empty());
        let model = normalize(&provider()).unwrap();
        assert_eq!(model.executable_dependencies.len(), 2);
        assert_eq!(model.contributions[0].scope, "workspace");
    }

    #[test]
    fn executable_and_semantic_contributions_require_their_protocols() {
        let mut bad = provider(); bad.as_object_mut().unwrap().remove("entrypoint");
        assert!(normalize(&bad).is_err());
        let mut bad = provider(); bad["protocols"] = json!({});
        assert!(normalize(&bad).is_err());
        let mut bad = view(); bad.as_object_mut().unwrap().remove("protocols");
        assert!(normalize(&bad).is_err());
        let mut bad = view(); bad["dependencies"] = json!([]);
        assert!(normalize(&bad).is_err(), "v1 dependency name must not be reinterpreted");
    }

    #[test]
    fn host_approved_workspace_writes_are_platform_independent() {
        for source in [include_str!("../capability-plugins/codex/plugin.json"),include_str!("../capability-plugins/pi/plugin.json")] {
            let manifest: Value = serde_json::from_str(source).unwrap();
            assert!(activation_issues(&manifest).unwrap().is_empty());
        }
    }

    #[test]
    fn unsupported_required_contribution_identifies_the_contribution_and_operation() {
        let mut manifest = provider();
        manifest["contributions"][0]["operations"][0]["effect"] = json!("write");
        manifest["contributions"][0]["operations"][0]["permissions"] = json!(["network.write"]);
        let issues = activation_issues(&manifest).unwrap();
        assert!(issues.iter().any(|issue|issue.contains("dev.aibo.git.read") && issue.contains("dev.aibo.git.changes")));
    }

    #[test]
    fn ownership_scope_duplicates_and_dependency_targets_are_validated() {
        for (pointer, value) in [
            ("/contributions/0/id", json!("other.plugin.view")),
            ("/contributions/0/scope", json!("session")),
            ("/contributions/0/extensionPoint", json!("unknown.extension")),
            ("/contributions/0/semanticType", json!("arbitrary.html")),
            ("/packageDependencies/0/pluginId", json!("dev.aibo.git-view")),
            ("/packageDependencies/0/contributionIds", json!(["missing.view"])),
            ("/host/maxExclusive", json!("0.0.1")),
        ] { let mut bad = view(); *bad.pointer_mut(pointer).unwrap() = value; assert!(normalize(&bad).is_err(), "{pointer}"); }
        let mut bad = view(); let duplicate = bad["contributions"][0].clone(); bad["contributions"].as_array_mut().unwrap().push(duplicate);
        assert!(normalize(&bad).is_err());
        let mut reserved = provider(); reserved["pluginId"] = json!("aibo.core");
        assert!(normalize(&reserved).err().unwrap().contains("reserved"));
        let mut bad = provider(); bad["contributions"][0]["operations"][0]["capability"]["id"] = json!("aibo.core.inspector");
        assert!(normalize(&bad).is_err(), "plugins cannot define host-owned contracts");
    }

    #[test]
    fn untrusted_operation_schemas_are_bounded_and_never_resolve_references() {
        for schema in [json!({"$ref":"file:///etc/passwd"}), json!({"$ref":"https://example.invalid/schema"}), json!({"$ref":"#"}), json!({"type":"unknown"}), json!({"type":"string","pattern":"(a+)+$"})] {
            let mut bad = provider(); bad["contributions"][0]["operations"][0]["inputSchema"] = schema;
            assert!(normalize(&bad).is_err());
        }
        let mut deep = json!({"type":"string"});
        for _ in 0..18 { deep = json!({"type":"array","items":deep}); }
        let mut bad = provider(); bad["contributions"][0]["operations"][0]["inputSchema"] = deep;
        assert!(normalize(&bad).is_err());
    }

    #[test]
    fn version_ranges_and_presentation_descriptors_are_checked_before_activation() {
        let mut bad = provider(); bad["protocols"]["runtime"]["min"] = json!("3.0");
        assert!(normalize(&bad).is_err());
        let mut bad = provider(); bad["executableDependencies"][0]["versionRange"] = json!("not a version");
        assert!(normalize(&bad).is_err());
        let mut manifest = view();
        manifest["presentation"] = json!({"id":"dev.aibo.git-view.presentation","displayName":"Trusted layout","delivery":"host-bundled","requiredSemantics":["collection","detail"],"contractVersion":"1.0.0"});
        assert!(normalize(&manifest).is_ok());
        manifest["presentation"]["script"] = json!("arbitrary.js");
        assert!(normalize(&manifest).is_err());
        let mut manifest = view(); manifest["host"] = json!({"min":"99.0.0","maxExclusive":"100.0.0"});
        assert!(activation_issues(&manifest).unwrap().iter().any(|issue|issue.contains("宿主版本")));
    }

    #[test]
    fn v2_agent_maps_to_the_same_legacy_agent_shape_without_enabling_runtime() {
        let legacy: Value = serde_json::from_str(include_str!("../../fixtures/plugins/echo-agent/plugin.json")).unwrap();
        let mut manifest = provider(); manifest["pluginId"] = legacy["pluginId"].clone();
        let mut agent = legacy["agents"][0].clone();
        let id = agent.as_object_mut().unwrap().remove("agentId").unwrap();
        agent["id"] = id; agent["kind"] = json!("agent"); agent["scope"] = json!("session"); agent["required"] = json!(true);
        manifest["contributions"] = json!([agent]);
        let model = normalize(&manifest).unwrap();
        assert_eq!(model.agents().next().unwrap(), &legacy["agents"][0]);
        assert!(!activation_issues(&manifest).unwrap().is_empty());
    }
}
