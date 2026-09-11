//! Resource checks for the shipped, namespaced Git read contracts, before process dispatch.
use serde_json::Value;
use std::path::{Component, Path};
pub(crate) fn check(
    capability: &str,
    input: &Value,
    workspace: Option<&str>,
) -> Result<(), String> {
    let target = match capability {
        "dev.aibo.git.diff" => input["path"].as_str(),
        "dev.aibo.git.view" if input["actionId"] == "open-diff" => Some(
            input["itemId"]
                .as_str()
                .and_then(|id| {
                    id.strip_prefix("index:")
                        .or_else(|| id.strip_prefix("worktree:"))
                })
                .ok_or("invalid Git item")?,
        ),
        _ => return Ok(()),
    }
    .ok_or("missing Git path")?;
    if target.is_empty()
        || Path::new(target)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || target
            .split(['/', '\\'])
            .any(|part| part.eq_ignore_ascii_case(".git") || part == "..")
    {
        return Err("invalid Git target".into());
    }
    crate::workspace_guard::canonicalize_target(
        Path::new(workspace.ok_or("missing workspace")?),
        Path::new(target),
    )?;
    Ok(())
}
