//! Host-owned consent for broad session permissions. Model choices are not grants.
use crate::{execution_profile::ExecutionProfile, workspace_write_runs::Request};
use serde_json::{json, Value};
use sqlx::SqlitePool;

pub(crate) fn broad(profile: &ExecutionProfile) -> bool {
    profile.filesystem_policy == "danger-full-access"
        || (profile.filesystem_policy != "read-only" && matches!(profile.approval_policy.as_str(), "never" | "trusted"))
        || (profile.interaction_mode == "edit" && profile.command_policy != "disabled"
            && (profile.command_policy == "trusted" || matches!(profile.approval_policy.as_str(), "never" | "trusted")))
}

pub(crate) async fn context(db: &SqlitePool, workspace: &str, installation: &str, agent: &str, profile: &ExecutionProfile) -> Result<Value, String> {
    let workspace = crate::workspace_by_id(db, workspace).await.map_err(|e| e.to_string())?;
    if workspace.trust != "trusted" { return Err("permission_denied: workspace trust required".into()); }
    let epoch: i64 = sqlx::query_scalar("SELECT permission_epoch FROM workspaces WHERE id=?")
        .bind(&workspace.id).fetch_one(db).await.map_err(|e| e.to_string())?;
    let enabled: Option<(String, Option<String>)> = sqlx::query_as("SELECT package_digest,enabled_at FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
        .bind(installation).fetch_optional(db).await.map_err(|e| e.to_string())?;
    let (digest, activation) = enabled.ok_or("provider_unavailable: installation is disabled")?;
    Ok(json!({"workspace":workspace.id,"trustEpoch":epoch,"path":workspace.path,"installation":installation,"digest":digest,"activation":activation,"agent":agent,
        "interaction":profile.interaction_mode,"filesystem":profile.filesystem_policy,"commands":profile.command_policy,
        "approval":profile.approval_policy,"network":profile.network_policy}))
}

pub(crate) async fn granted(db: &SqlitePool, session: &str, context: &Value) -> Result<bool, String> {
    let stored: Option<String> = sqlx::query_scalar("SELECT context_json FROM session_permission_grants WHERE session_id=?")
        .bind(session).fetch_optional(db).await.map_err(|e| e.to_string())?;
    Ok(stored.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()).is_some_and(|old| covers(&old, context)))
}

fn covers(old: &Value, new: &Value) -> bool {
    if ["workspace", "trustEpoch", "path", "installation", "digest", "activation", "agent"].iter().any(|key| old[key] != new[key]) { return false; }
    [
        ("interaction", &["ask", "plan", "edit"][..]),
        ("filesystem", &["read-only", "workspace-write", "danger-full-access"][..]),
        ("commands", &["disabled", "approved", "trusted"][..]),
        ("approval", &["untrusted", "on-request", "never", "trusted"][..]),
        ("network", &["disabled", "agent-managed"][..]),
    ].iter().all(|(key, choices)| {
        let before = choices.iter().position(|value| old[key] == *value);
        let after = choices.iter().position(|value| new[key] == *value);
        matches!((before, after), (Some(before), Some(after)) if after <= before)
    })
}

pub(crate) async fn confirm<F, Fut>(db: &SqlitePool, session: Option<&str>, workspace: &str, installation: &str, agent: &str, profile: &ExecutionProfile, confirm: F) -> Result<Option<Value>, String>
where F: FnOnce(String) -> Fut, Fut: std::future::Future<Output = Result<bool, String>> {
    if !broad(profile) { return Ok(None); }
    let expected = context(db, workspace, installation, agent, profile).await?;
    if let Some(session) = session {
        if granted(db, session, &expected).await? { return Ok(Some(expected)); }
    }
    let mut effects = Vec::new();
    if profile.filesystem_policy == "danger-full-access" { effects.push("允许访问工作区以外的文件"); }
    if profile.filesystem_policy != "read-only" && matches!(profile.approval_policy.as_str(), "never" | "trusted") { effects.push("允许在所选范围内修改文件，无需逐次确认"); }
    if profile.interaction_mode == "edit" && profile.command_policy != "disabled" { effects.push("允许按所选命令策略执行命令"); }
    let message = format!("此会话将启用宽泛权限：\n{}\n\n工作区：{}\n\n确认后，在此权限范围内发送消息不再重复提示。你可以随时在会话权限设置中降低权限。", effects.join("\n"), expected["path"].as_str().unwrap_or_default());
    if !confirm(message).await? { return Err("已取消权限切换，原有设置未更改。".into()); }
    if context(db, workspace, installation, agent, profile).await? != expected { return Err("授权环境已变化，请重新选择权限。".into()); }
    Ok(Some(expected))
}

pub(crate) async fn save(db: &SqlitePool, session: &str, context: Option<&Value>) -> Result<(), String> {
    if let Some(context) = context {
        sqlx::query("INSERT INTO session_permission_grants(session_id,context_json,confirmed_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET context_json=excluded.context_json,confirmed_at=excluded.confirmed_at")
            .bind(session).bind(context.to_string()).bind(crate::now_iso()).execute(db).await.map_err(|e| e.to_string())?;
    } else {
        sqlx::query("DELETE FROM session_permission_grants WHERE session_id=?").bind(session).execute(db).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn check(db: &SqlitePool, session_id: &str) -> Result<Value, String> {
    let session = crate::session_by_id(db, session_id).await.map_err(|e| e.to_string())?;
    let profile = crate::session_execution_profile(db, session_id).await.map_err(|e| e.to_string())?.profile.enforced;
    let context = context(db, &session.workspace_id, session.plugin_installation_id.as_deref().ok_or("history_only")?, &session.agent, &profile).await?;
    if broad(&profile) && !granted(db, session_id, &context).await? {
        return Err("请在会话权限设置中确认宽泛权限后再发送消息。".into());
    }
    Ok(context)
}

/// A policy admission can authorize only this session's top-level turn. It is
/// not a reusable approval for arbitrary plugin writes or dependency calls.
pub(crate) async fn turn_request(db: &SqlitePool, session: &str, caller: &str) -> Result<Request, String> {
    let expected = check(db, session).await?;
    let db = db.clone(); let id = session.to_owned();
    Ok(Request::with_session_policy(ulid::Ulid::new().to_string(), caller.into(), session.into(), move |_| {
        let db = db.clone(); let id = id.clone(); let expected = expected.clone();
        async move { Ok(check(&db, &id).await? == expected) }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn effective_permissions_define_broad_access_and_downgrades() {
        let mut p = crate::execution_profile::default_requested_profile("codex").unwrap();
        assert!(!broad(&p));
        p.approval_policy = "never".into();
        assert!(!broad(&p), "never does not widen a read-only session");
        p.filesystem_policy = "workspace-write".into(); assert!(broad(&p));
        p.approval_policy = "on-request".into(); assert!(!broad(&p));
        p.filesystem_policy = "danger-full-access".into(); assert!(broad(&p));
        p.filesystem_policy = "read-only".into(); p.interaction_mode = "edit".into(); p.command_policy = "trusted".into(); assert!(broad(&p));
        let full = json!({"interaction":"edit","filesystem":"danger-full-access","commands":"trusted","approval":"never","network":"agent-managed"});
        let mut reduced = full.clone(); reduced["filesystem"] = json!("workspace-write");
        assert!(covers(&full, &reduced)); assert!(!covers(&reduced, &full));
    }
}
