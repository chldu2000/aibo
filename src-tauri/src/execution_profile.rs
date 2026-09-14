use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

pub(crate) const EXECUTION_PROFILE_SCHEMA: &str = "aibo.execution-profile/v1";

/// Host-owned enforcement selection. Never accepted from plugin capability declarations.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EnforcementBackend {
    CodexNative,
    CoreProxy,
    #[default]
    Unnegotiated,
}

impl EnforcementBackend {
    pub(crate) fn legacy_agent(agent: &str) -> Self {
        match agent {
            "codex" | "dev.aibo.codex.agent" => Self::CodexNative,
            "pi" | "dev.aibo.pi.agent" => Self::CoreProxy,
            _ => Self::Unnegotiated,
        }
    }
}

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
    #[serde(skip)]
    pub(crate) enforcement_backend: EnforcementBackend,
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
        approval_policy: if agent == "codex" {
            "untrusted".to_owned()
        } else {
            "never".to_owned()
        },
        filesystem_policy: "read-only".to_owned(),
        command_policy: if agent == "codex" {
            "approved".to_owned()
        } else {
            "disabled".to_owned()
        },
        network_policy: "disabled".to_owned(),
        model: None,
        reasoning_effort: None,
    }
}

pub(crate) fn default_requested_profile(agent: &str) -> Result<ExecutionProfile, String> {
    Ok(default_profile(agent))
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
        &["never", "untrusted", "on-request", "trusted"],
    )?;
    validate_choice(
        "filesystemPolicy",
        &profile.filesystem_policy,
        &["read-only", "workspace-write", "danger-full-access"],
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
    resolve_with_backend(EnforcementBackend::legacy_agent(agent), requested, resolved_at)
}

pub(crate) fn resolve_with_backend(
    backend: EnforcementBackend,
    requested: Option<ExecutionProfile>,
    resolved_at: String,
) -> Result<ResolvedExecutionProfile, String> {
    let requested = requested.unwrap_or_else(|| default_requested_profile(
        if backend == EnforcementBackend::CodexNative { "codex" } else { "generic" },
    ).expect("host default profile"));
    validate_profile(&requested)?;

    let mut enforced = requested.clone();
    let mut unsupported = Vec::new();
    // Native enforcement belongs to the trusted native adapter. Core proxy
    // enforcement is a host policy, independent of any Agent identity.
    if backend == EnforcementBackend::CoreProxy && requested.interaction_mode == "plan" {
        if requested.filesystem_policy != "read-only" {
            unsupported.push("plan.filesystem-write".to_owned());
            enforced.filesystem_policy = "read-only".to_owned();
        }
        if requested.command_policy != "disabled" {
            unsupported.push("plan.command-execution".to_owned());
            enforced.command_policy = "disabled".to_owned();
        }
    }
    let (adapter_capabilities, native_sandbox) = match backend {
        EnforcementBackend::CodexNative => (
            vec![
                "history.read".to_owned(),
                "session.resume".to_owned(),
                "session.fork".to_owned(),
                "events.streaming".to_owned(),
                "approval.command".to_owned(),
                "permissions.nativeSandbox".to_owned(),
                "permissions.nativeControls".to_owned(),
                "filesystem.workspace-write".to_owned(),
                "model.selection".to_owned(),
                "reasoning-effort.selection".to_owned(),
                "skills.discovery".to_owned(),
                "plan.native".to_owned(),
                "goals.native".to_owned(),
                "user-input-requests".to_owned(),
                "context-usage".to_owned(),
            ],
            true,
        ),
        EnforcementBackend::CoreProxy => {
            // Core mediates writes and commands through the guarded tool gateway.
            // Selecting this backend alone does not grant a write: the enforced
            // profile, workspace trust and per-operation approvals still apply.
            if requested.network_policy != "disabled" {
                unsupported.push("network.agent-managed".to_owned());
                enforced.network_policy = "disabled".to_owned();
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
                    "model.selection".to_owned(),
                    "reasoning-effort.selection".to_owned(),
                    "skills.discovery".to_owned(),
                    "context-usage".to_owned(),
                ],
                false,
            )
        }
        _ => {
            if requested.interaction_mode != "ask" || requested.approval_policy != "never"
                || requested.filesystem_policy != "read-only" || requested.command_policy != "disabled"
                || requested.network_policy != "disabled" {
                unsupported.push("plugin.execution-profile-unnegotiated".to_owned());
            }
            enforced.interaction_mode = "ask".to_owned();
            enforced.approval_policy = "never".to_owned();
            enforced.filesystem_policy = "read-only".to_owned();
            enforced.command_policy = "disabled".to_owned();
            enforced.network_policy = "disabled".to_owned();
            (Vec::new(), false)
        },
    };

    Ok(ResolvedExecutionProfile {
        enforcement_backend: backend,
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
          adapter_capabilities_json, native_sandbox, resolved_at, created_at, updated_at, enforcement_backend)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           enforcement_backend = excluded.enforcement_backend,
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
    .bind(serde_json::to_string(&profile.enforcement_backend).expect("backend serializes"))
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
            enforcement_backend: serde_json::from_str(&row.try_get::<String, _>("enforcement_backend")
                .map_err(|error| error.to_string())?).map_err(|error| format!("invalid enforcement backend: {error}"))?,
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
    use super::{default_requested_profile, resolve, resolve_with_backend, EnforcementBackend, ExecutionProfile, EXECUTION_PROFILE_SCHEMA};

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
    fn host_proxy_is_explicit_and_does_not_require_pi_identity() {
        let profile = resolve_with_backend(EnforcementBackend::CoreProxy, Some(editable_profile()), "now".into()).unwrap();
        assert_eq!(profile.enforced.filesystem_policy, "workspace-write");
        assert_eq!(profile.enforced.approval_policy, "on-request");
        assert!(!profile.native_sandbox);
        assert_eq!(EnforcementBackend::legacy_agent("dev.example.agent"), EnforcementBackend::Unnegotiated);
        assert_eq!(EnforcementBackend::legacy_agent("dev.aibo.pi.agent"), EnforcementBackend::CoreProxy);
        assert_eq!(EnforcementBackend::legacy_agent("dev.aibo.codex.agent"), EnforcementBackend::CodexNative);
        let wire = serde_json::to_value(&profile.enforced).unwrap();
        assert!(wire.get("enforcementBackend").is_none());
        let mut forged = wire;
        forged["enforcementBackend"] = serde_json::json!("core-proxy");
        assert!(serde_json::from_value::<ExecutionProfile>(forged).is_err());
    }

    #[tokio::test]
    async fn migrates_host_grants_without_turning_requested_permissions_into_grants() {
        use sqlx::Row;
        let db = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE sessions(id TEXT PRIMARY KEY, agent TEXT NOT NULL);").execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0005_execution_profiles.sql")).execute(&db).await.unwrap();
        let edit = editable_profile();
        let read = resolve("external", Some(edit.clone()), "before".into()).unwrap();
        for (id, agent, enforced, native) in [
            ("granted", "external", &edit, false),
            ("requested-only", "external", &read.enforced, false),
            ("claimed-native", "external", &edit, true),
            ("pi", "dev.aibo.pi.agent", &read.enforced, false),
            ("codex", "codex", &edit, true),
        ] {
            sqlx::query("INSERT INTO sessions VALUES (?, ?)").bind(id).bind(agent).execute(&db).await.unwrap();
            sqlx::query("INSERT INTO session_execution_profiles(session_id,schema_version,requested_json,enforced_json,native_sandbox,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,'before','before','before')")
                .bind(id).bind(EXECUTION_PROFILE_SCHEMA).bind(serde_json::to_string(&edit).unwrap())
                .bind(serde_json::to_string(enforced).unwrap()).bind(i64::from(native)).execute(&db).await.unwrap();
        }
        sqlx::raw_sql(include_str!("../migrations/0024_execution_enforcement_backend.sql")).execute(&db).await.unwrap();
        for (id, expected) in [("granted", EnforcementBackend::CoreProxy), ("requested-only", EnforcementBackend::Unnegotiated), ("claimed-native", EnforcementBackend::Unnegotiated), ("pi", EnforcementBackend::CoreProxy), ("codex", EnforcementBackend::CodexNative)] {
            let row = sqlx::query("SELECT * FROM session_execution_profiles WHERE session_id=?").bind(id).fetch_one(&db).await.unwrap();
            let stored = super::from_row(&row, id.into()).unwrap().profile;
            assert_eq!(stored.enforcement_backend, expected);
            assert_eq!(stored.requested, edit, "migration preserves requested settings");
            let restored = resolve_with_backend(stored.enforcement_backend, Some(stored.requested), "after".into()).unwrap();
            super::save_for_session(&db, id, &restored).await.unwrap();
            let backend: String = sqlx::query("SELECT enforcement_backend FROM session_execution_profiles WHERE session_id=?").bind(id).fetch_one(&db).await.unwrap().get(0);
            assert_eq!(backend, serde_json::to_string(&expected).unwrap());
            if expected == EnforcementBackend::Unnegotiated {
                assert_eq!(restored.enforced.filesystem_policy, "read-only");
                assert!(!restored.native_sandbox);
            }
        }
        db.close().await;
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
        assert_eq!(resolved.enforced.model.as_deref(), Some("test-model"));
        assert_eq!(resolved.enforced.reasoning_effort.as_deref(), Some("high"));
        assert!(!resolved.native_sandbox);
    }

    #[test]
    fn defaults_keep_codex_native_permissions_and_pi_mediated() {
        let codex = resolve("codex", None, "now".to_owned()).expect("codex default");
        assert_eq!(codex.requested, default_requested_profile("codex").unwrap());
        assert_eq!(codex.enforced.approval_policy, "untrusted");
        assert_eq!(codex.enforced.filesystem_policy, "read-only");
        assert!(codex
            .adapter_capabilities
            .contains(&"permissions.nativeControls".to_owned()));
        let pi = resolve("pi", None, "now".to_owned()).expect("Pi default");
        assert_eq!(pi.requested, default_requested_profile("pi").unwrap());
        assert_eq!(pi.enforced.approval_policy, "never");
    }

    #[test]
    fn external_agents_receive_a_safe_generic_default_profile() {
        let resolved = resolve("dev.example.agent", None, "now".to_owned()).expect("generic default");
        assert_eq!(resolved.enforced.approval_policy, "never");
        assert_eq!(resolved.enforced.filesystem_policy, "read-only");
        assert_eq!(resolved.enforced.command_policy, "disabled");
        assert!(resolved.adapter_capabilities.is_empty());
        assert!(!resolved.native_sandbox);
        let constrained = resolve("dev.example.agent", Some(editable_profile()), "now".to_owned()).expect("generic constrained profile");
        assert_eq!(constrained.enforced.filesystem_policy, "read-only");
        assert_eq!(constrained.enforced.command_policy, "disabled");
        assert_eq!(constrained.unsupported, vec!["plugin.execution-profile-unnegotiated"]);
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
    fn only_pi_plan_mode_is_constrained_by_aibo_gateway() {
        let mut profile = editable_profile();
        profile.interaction_mode = "plan".to_owned();
        let codex = resolve("codex", Some(profile.clone()), "now".to_owned())
            .expect("Codex native plan profile");
        assert_eq!(codex.enforced.filesystem_policy, "workspace-write");
        assert!(codex.unsupported.is_empty());
        let resolved = resolve("pi", Some(profile), "now".to_owned()).expect("Pi plan profile");
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
