use super::*;
pub(super) fn negotiated_capabilities(
    plugin_id: &str,
    plugin_version: &str,
    agent_id: &str,
    declared: &[Value],
    actual: &[Value],
) -> Vec<Value> {
    let mut negotiated = actual.to_vec();
    // Bundled Codex 1.0.0 releases shipped the approval and user-input
    // handlers and declared both capabilities in their manifest, but omitted
    // them from the runtime handshake. Keep already-pinned sessions usable
    // while newer releases report the capabilities correctly.
    if plugin_id == "dev.aibo.codex" && plugin_version == "1.0.0" && agent_id == "dev.aibo.codex.agent" {
        for capability in ["approval.respond", "user-input.respond"] {
            let capability = json!(capability);
            if declared.contains(&capability) && !negotiated.contains(&capability) {
                negotiated.push(capability);
            }
        }
    }
    negotiated
}
pub(super) fn apply_pi_recovery_profile(profile: &mut execution_profile::ResolvedExecutionProfile, binding: &Value) -> bool {
    let data = &binding["recovery"]["data"];
    let model = data["model"]["provider"].as_str().zip(data["model"]["modelId"].as_str())
        .map(|(provider, model_id)| format!("{provider}/{model_id}"));
    let reasoning_effort = data["thinkingLevel"].as_str().map(ToOwned::to_owned);
    let mut changed = false;
    if profile.requested.model.is_none() {
        if let Some(model) = model {
            profile.requested.model = Some(model.clone());
            profile.enforced.model = Some(model);
            changed = true;
        }
    }
    if profile.requested.reasoning_effort.is_none() {
        if let Some(reasoning_effort) = reasoning_effort {
            profile.requested.reasoning_effort = Some(reasoning_effort.clone());
            profile.enforced.reasoning_effort = Some(reasoning_effort);
            changed = true;
        }
    }
    if !changed {
        return false;
    }
    profile.resolved_at = crate::now_iso();
    true
}
pub(super) fn empty_codex_session_recovery_allowed(plugin_id: &str, agent_id: &str, has_turns: bool) -> bool {
    plugin_id == "dev.aibo.codex" && agent_id == "dev.aibo.codex.agent" && !has_turns
}
