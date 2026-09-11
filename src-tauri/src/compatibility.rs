use super::*;

// Legacy sessions only. Remove after their migration or retirement as history-only.
pub(super) fn contribution_id(agent: &str) -> &str { match agent { "codex" => "dev.aibo.codex.agent", "pi" => "dev.aibo.pi.agent", other => other } }

pub(super) async fn send_agent_prompt(session_id: String, input: String, state: State<'_, AppState>) -> Result<Session, String> {
    match session_agent(&state.db, &session_id).await.map_err(|e|e.to_string())?.as_str() {
        "codex" => send_codex_prompt(session_id, input, state).await.map_err(|e|e.to_string()),
        "pi" => send_pi_prompt(session_id, input, state).await.map_err(|e|e.to_string()),
        _ => { state.plugins.send(&session_id, &input).await?; session_by_id(&state.db,&session_id).await.map_err(|e|e.to_string()) }
    }
}

pub(super) async fn cancel_agent_turn(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    match session_agent(&state.db, &session_id).await.map_err(|e|e.to_string())?.as_str() {
        "codex" => abort_codex_turn(session_id, state).await.map_err(|e|e.to_string()),
        "pi" => abort_pi_turn(session_id, state).await.map_err(|e|e.to_string()),
        _ => state.plugins.cancel(&session_id).await,
    }
}

pub(super) async fn resume_agent_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = session_by_id(&state.db, &session_id).await.map_err(|error| error.to_string())?;
    if session.plugin_installation_id.is_some() {
        state.plugins.resume(&session_id).await
    } else if session.agent == "pi" {
        Err("dependency_missing: this legacy Pi session is history-only; create a new Pi SDK plugin session to resume it".to_owned())
    } else {
        Err("invalid_request: session is not plugin-backed".to_owned())
    }
}

pub(super) async fn close_agent_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    match session_agent(&state.db, &session_id).await.map_err(|e|e.to_string())?.as_str() {
        "codex" => close_codex_session(session_id, state).await.map_err(|e|e.to_string()),
        "pi" => close_pi_session(session_id, state).await.map_err(|e|e.to_string()),
        _ => state.plugins.close(&session_id).await,
    }
}

pub(super) async fn read_codex_thread(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<CodexThreadSnapshot, CoreError> {
    state
        .codex
        .read_thread(&session_id)
        .await
        .map_err(Into::into)
}

pub(super) async fn fork_codex_thread(
    session_id: String,
    through_turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Session, CoreError> {
    let source = session_by_id(&state.db, &session_id).await?;
    if source.plugin_installation_id.is_some() {
        let forked = state
            .codex
            .fork_plugin_codex_session(&session_id, through_turn_id.as_deref())
            .await
            .map_err(CoreError::from)?;
        state
            .plugins
            .resume(&forked.id)
            .await
            .map_err(CoreError::Initialization)?;
        return session_by_id(&state.db, &forked.id).await;
    }
    let source_profile = session_execution_profile(&state.db, &session_id).await?;
    let forked = state
        .codex
        .fork(&session_id, through_turn_id.as_deref())
        .await
        .map_err(CoreError::from)?;
    save_session_profile(&state.db, &forked.id, &source_profile.profile).await?;
    Ok(forked)
}
