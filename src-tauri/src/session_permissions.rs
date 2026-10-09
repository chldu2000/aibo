//! Host-owned admission for a session's persisted execution profile.
use crate::{execution_profile::ExecutionProfile, workspace_write_runs::Request};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use crate::ui_i18n::{HostMessage,core_message};

pub(crate) async fn context(db: &SqlitePool, workspace: &str, installation: &str, agent: &str, profile: &ExecutionProfile) -> Result<Value, HostMessage> {
    let workspace = crate::workspace_by_id(db, workspace).await.map_err(core_message)?;
    if workspace.trust != "trusted" { return Err(HostMessage::with_diagnostic("native.permissions.workspaceTrust",json!({}),"permission_denied: workspace trust required")); }
    let epoch: i64 = sqlx::query_scalar("SELECT permission_epoch FROM workspaces WHERE id=?")
        .bind(&workspace.id).fetch_one(db).await.map_err(|e| e.to_string())?;
    let enabled: Option<(String, Option<String>)> = sqlx::query_as("SELECT package_digest,enabled_at FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
        .bind(installation).fetch_optional(db).await.map_err(|e| e.to_string())?;
    let (digest, activation) = enabled.ok_or_else(||HostMessage::with_diagnostic("native.permissions.installationDisabled",json!({}),"provider_unavailable: installation is disabled"))?;
    Ok(json!({"workspace":workspace.id,"trustEpoch":epoch,"path":workspace.path,"installation":installation,"digest":digest,"activation":activation,"agent":agent,
        "interaction":profile.interaction_mode,"filesystem":profile.filesystem_policy,"commands":profile.command_policy,
        "approval":profile.approval_policy,"approvalReviewer":profile.approval_reviewer,"network":profile.network_policy}))
}

async fn check(db: &SqlitePool, session_id: &str) -> Result<Value, HostMessage> {
    let session = crate::session_by_id(db, session_id).await.map_err(core_message)?;
    let profile = crate::session_execution_profile(db, session_id).await.map_err(core_message)?.profile.enforced;
    context(db, &session.workspace_id, session.plugin_installation_id.as_deref().ok_or_else(||HostMessage::with_diagnostic("native.permissions.historyOnly",json!({}),"history_only"))?, &session.agent, &profile).await
}

/// A policy admission can authorize only this session's top-level turn. It is
/// not a reusable approval for arbitrary plugin writes or dependency calls.
pub(crate) async fn turn_request(db: &SqlitePool, session: &str, caller: &str) -> Result<Request, HostMessage> {
    let expected = check(db, session).await?;
    let db = db.clone(); let id = session.to_owned();
    Ok(Request::with_session_policy(ulid::Ulid::new().to_string(), caller.into(), session.into(), move |_| {
        let db = db.clone(); let id = id.clone(); let expected = expected.clone();
        async move { Ok(check(&db, &id).await.map_err(|error|error.diagnostic)? == expected) }
    }))
}
