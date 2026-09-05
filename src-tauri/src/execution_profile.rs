use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

pub(crate) const EXECUTION_PROFILE_SCHEMA: &str = "aibo.execution-profile/v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(crate) struct ExecutionProfile {
    pub(crate) schema: String,
    pub(crate) interaction_mode: String,
    pub(crate) approval_policy: String,
    pub(crate) filesystem_policy: String,
    pub(crate) command_policy: String,
    pub(crate) network_policy: String,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedExecutionProfile {
    pub(crate) schema: String,
    pub(crate) requested: ExecutionProfile,
    pub(crate) enforced: ExecutionProfile,
    pub(crate) unsupported: Vec<String>,
    pub(crate) adapter_capabilities: Vec<String>,
    pub(crate) native_sandbox: bool,
    pub(crate) resolved_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionExecutionProfile {
    pub(crate) session_id: String,
    #[serde(flatten)]
    pub(crate) profile: ResolvedExecutionProfile,
}

fn default_profile(agent: &str) -> ExecutionProfile {
    ExecutionProfile {
        schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
        interaction_mode: "ask".to_owned(),
        approval_policy: if agent == "pi" {
            "never".to_owned()
        } else {
            "on-request".to_owned()
        },
        filesystem_policy: "read-only".to_owned(),
        command_policy: "disabled".to_owned(),
        network_policy: "disabled".to_owned(),
        model: None,
        reasoning_effort: None,
    }
}

pub(crate) fn default_requested_profile(agent: &str) -> Result<ExecutionProfile, String> {
    match agent {
        "codex" | "pi" => Ok(default_profile(agent)),
        other => Err(format!("unsupported agent: {other}")),
    }
}

fn validate_choice(field: &str, value: &str, choices: &[&str]) -> Result<(), String> {
    if choices.contains(&value) {
        Ok(())
    } else {
        Err(format!("invalid execution profile {field}: {value}"))
    }
}

fn validate_profile(profile: &ExecutionProfile) -> Result<(), String> {
    if profile.schema != EXECUTION_PROFILE_SCHEMA {
        return Err(format!(
            "unsupported execution profile schema: {}",
            profile.schema
        ));
    }
    validate_choice(
        "interactionMode",
        &profile.interaction_mode,
        &["ask", "plan", "edit"],
    )?;
    validate_choice(
        "approvalPolicy",
        &profile.approval_policy,
        &["never", "on-request", "trusted"],
    )?;
    validate_choice(
        "filesystemPolicy",
        &profile.filesystem_policy,
        &["read-only", "workspace-write"],
    )?;
    validate_choice(
        "commandPolicy",
        &profile.command_policy,
        &["disabled", "approved", "trusted"],
    )?;
    validate_choice(
        "networkPolicy",
        &profile.network_policy,
        &["disabled", "agent-managed"],
    )?;
    Ok(())
}

pub(crate) fn resolve(
    agent: &str,
    requested: Option<ExecutionProfile>,
    resolved_at: String,
) -> Result<ResolvedExecutionProfile, String> {
    let requested = requested
        .or_else(|| default_requested_profile(agent).ok())
        .ok_or_else(|| format!("unsupported agent: {agent}"))?;
    validate_profile(&requested)?;

    let mut enforced = requested.clone();
    let mut unsupported = Vec::new();
    if requested.interaction_mode == "plan" {
        if requested.filesystem_policy != "read-only" {
            unsupported.push("plan.filesystem-write".to_owned());
            enforced.filesystem_policy = "read-only".to_owned();
        }
        if requested.command_policy != "disabled" {
            unsupported.push("plan.command-execution".to_owned());
            enforced.command_policy = "disabled".to_owned();
        }
    }
    let (adapter_capabilities, native_sandbox) = match agent {
        "codex" => {
            if requested.network_policy != "disabled" {
                unsupported.push("network.agent-managed".to_owned());
                enforced.network_policy = "disabled".to_owned();
            }
            (
                vec![
                    "history.read".to_owned(),
                    "session.resume".to_owned(),
                    "session.fork".to_owned(),
                    "events.streaming".to_owned(),
                    "approval.command".to_owned(),
                    "permissions.nativeSandbox".to_owned(),
                    "filesystem.workspace-write".to_owned(),
                    "model.selection".to_owned(),
                    "reasoning-effort.selection".to_owned(),
                ],
                true,
            )
        }
        "pi" => {
            // Pi has no native sandbox, but its SDK custom-tool boundary lets
            // Aibo Core mediate workspace writes. The profile therefore keeps
            // edit/write semantics when requested; the host only exposes the
            // proxy tool after Core has resolved and trust-checked the session.
            if requested.network_policy != "disabled" {
                unsupported.push("network.agent-managed".to_owned());
                enforced.network_policy = "disabled".to_owned();
            }
            if requested.model.is_some() {
                unsupported.push("model.selection".to_owned());
                enforced.model = None;
            }
            if requested.reasoning_effort.is_some() {
                unsupported.push("reasoning-effort.selection".to_owned());
                enforced.reasoning_effort = None;
            }
            (
                vec![
                    "history.read".to_owned(),
                    "session.resume".to_owned(),
                    "events.streaming".to_owned(),
                    "tools.read-only".to_owned(),
                    "tools.workspace-write-gateway".to_owned(),
                    "tools.workspace-command-gateway".to_owned(),
                    "permissions.aiboApproval".to_owned(),
                    "permissions.noNativeSandbox".to_owned(),
                ],
                false,
            )
        }
        other => return Err(format!("unsupported agent: {other}")),
    };

    Ok(ResolvedExecutionProfile {
        schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
        requested,
        enforced,
        unsupported,
        adapter_capabilities,
        native_sandbox,
        resolved_at,
    })
}

pub(crate) async fn save_for_session(
    db: &SqlitePool,
    session_id: &str,
    profile: &ResolvedExecutionProfile,
) -> Result<(), sqlx::Error> {
    let now = profile.resolved_at.clone();
    sqlx::query(
        "INSERT INTO session_execution_profiles
         (session_id, schema_version, requested_json, enforced_json, unsupported_json,
          adapter_capabilities_json, native_sandbox, resolved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           schema_version = excluded.schema_version,
           requested_json = excluded.requested_json,
           enforced_json = excluded.enforced_json,
           unsupported_json = excluded.unsupported_json,
           adapter_capabilities_json = excluded.adapter_capabilities_json,
           native_sandbox = excluded.native_sandbox,
           resolved_at = excluded.resolved_at,
           updated_at = excluded.updated_at",
    )
    .bind(session_id)
    .bind(&profile.schema)
    .bind(serde_json::to_string(&profile.requested).unwrap_or_else(|_| "{}".to_owned()))
    .bind(serde_json::to_string(&profile.enforced).unwrap_or_else(|_| "{}".to_owned()))
    .bind(serde_json::to_string(&profile.unsupported).unwrap_or_else(|_| "[]".to_owned()))
    .bind(serde_json::to_string(&profile.adapter_capabilities).unwrap_or_else(|_| "[]".to_owned()))
    .bind(i64::from(profile.native_sandbox))
    .bind(&profile.resolved_at)
    .bind(&now)
    .bind(now.clone())
    .execute(db)
    .await?;
    Ok(())
}

pub(crate) fn from_row(
    row: &sqlx::sqlite::SqliteRow,
    session_id: String,
) -> Result<SessionExecutionProfile, String> {
    let requested: ExecutionProfile = serde_json::from_str(
        &row.try_get::<String, _>("requested_json")
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("invalid requested execution profile: {error}"))?;
    let enforced: ExecutionProfile = serde_json::from_str(
        &row.try_get::<String, _>("enforced_json")
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("invalid enforced execution profile: {error}"))?;
    let unsupported: Vec<String> = serde_json::from_str(
        &row.try_get::<String, _>("unsupported_json")
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("invalid unsupported capabilities: {error}"))?;
    let adapter_capabilities: Vec<String> = serde_json::from_str(
        &row.try_get::<String, _>("adapter_capabilities_json")
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("invalid adapter capabilities: {error}"))?;
    Ok(SessionExecutionProfile {
        session_id,
        profile: ResolvedExecutionProfile {
            schema: row
                .try_get("schema_version")
                .map_err(|error| error.to_string())?,
            requested,
            enforced,
            unsupported,
            adapter_capabilities,
            native_sandbox: row
                .try_get::<i64, _>("native_sandbox")
                .map_err(|error| error.to_string())?
                != 0,
            resolved_at: row
                .try_get("resolved_at")
                .map_err(|error| error.to_string())?,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{default_requested_profile, resolve, ExecutionProfile, EXECUTION_PROFILE_SCHEMA};

    fn editable_profile() -> ExecutionProfile {
        ExecutionProfile {
            schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
            interaction_mode: "edit".to_owned(),
            approval_policy: "on-request".to_owned(),
            filesystem_policy: "workspace-write".to_owned(),
            command_policy: "approved".to_owned(),
            network_policy: "disabled".to_owned(),
            model: Some("test-model".to_owned()),
            reasoning_effort: Some("high".to_owned()),
        }
    }

    #[test]
    fn codex_preserves_supported_edit_profile() {
        let resolved = resolve("codex", Some(editable_profile()), "now".to_owned())
            .expect("codex profile should resolve");
        assert_eq!(resolved.enforced.interaction_mode, "edit");
        assert_eq!(resolved.enforced.filesystem_policy, "workspace-write");
        assert!(resolved.unsupported.is_empty());
        assert!(resolved.native_sandbox);
    }

    #[test]
    fn pi_resolves_core_mediated_write_and_command_gateway() {
        let resolved = resolve("pi", Some(editable_profile()), "now".to_owned())
            .expect("Pi profile should resolve");
        assert_eq!(resolved.enforced.interaction_mode, "edit");
        assert_eq!(resolved.enforced.filesystem_policy, "workspace-write");
        assert_eq!(resolved.enforced.command_policy, "approved");
        assert!(resolved
            .adapter_capabilities
            .contains(&"tools.workspace-command-gateway".to_owned()));
        assert!(!resolved.native_sandbox);
    }

    #[test]
    fn defaults_match_the_current_read_only_adapters() {
        let codex = resolve("codex", None, "now".to_owned()).expect("codex default");
        assert_eq!(codex.requested, default_requested_profile("codex").unwrap());
        assert_eq!(codex.enforced.filesystem_policy, "read-only");
        let pi = resolve("pi", None, "now".to_owned()).expect("Pi default");
        assert_eq!(pi.requested, default_requested_profile("pi").unwrap());
        assert_eq!(pi.enforced.approval_policy, "never");
    }

    #[test]
    fn rejects_unknown_profile_values() {
        let mut profile = editable_profile();
        profile.command_policy = "anything".to_owned();
        assert!(resolve("codex", Some(profile), "now".to_owned()).is_err());
    }

    #[test]
    fn rejects_a_profile_with_the_wrong_schema() {
        let mut profile = editable_profile();
        profile.schema = "aibo.execution-profile/v0".to_owned();
        assert!(resolve("codex", Some(profile), "now".to_owned()).is_err());
    }

    #[test]
    fn plan_mode_cannot_resolve_to_a_writable_profile() {
        let mut profile = editable_profile();
        profile.interaction_mode = "plan".to_owned();
        let resolved = resolve("codex", Some(profile), "now".to_owned()).expect("plan profile");
        assert_eq!(resolved.enforced.filesystem_policy, "read-only");
        assert_eq!(resolved.enforced.command_policy, "disabled");
        assert!(resolved
            .unsupported
            .contains(&"plan.filesystem-write".to_owned()));
        assert!(resolved
            .unsupported
            .contains(&"plan.command-execution".to_owned()));
    }
}
