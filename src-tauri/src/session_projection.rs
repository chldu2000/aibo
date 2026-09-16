use super::*;
impl SessionHost {
    pub(super) async fn project_event(&self, session_id: &str, workspace_id: &str, generation: &str, binding: &Value, event: Value, origin: EventOrigin) -> Result<(), String> {
        if !crate::session_contract::event_schema().is_valid(&event) { return Err("invalid_output: session event schema".into()); }
        let p = &event;
        let _guard = self.database_writes.lock().await;
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        let active:(String,String) = sqlx::query_as("SELECT generation_id,plugin_capabilities_json FROM session_bindings WHERE session_id=?")
            .bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        if active.0 != generation { return Err("invalid_session: stale session generation".into()); }
        let sequence:i64=sqlx::query_scalar("SELECT COALESCE(MAX(sequence),-1)+1 FROM agent_events WHERE session_id=? AND generation_id=?")
            .bind(session_id).bind(generation).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
            if p["nativeSessionId"] != binding["nativeSessionId"] { return Err("invalid_session: native binding".into()); }
            let now = crate::now_iso();
            let event_id = ulid::Ulid::new().to_string();
            let event = json!({"schemaVersion":"2.0","eventId":event_id,"generationId":generation,"sequence":sequence,"occurredAt":now,
                "source":{"pluginId":binding["pluginId"],"pluginVersion":binding["pluginVersion"],"agentId":binding["agentId"],"runtimeProtocolVersion":"2.1"},
                "workspaceId":workspace_id,"sessionId":session_id,"nativeSessionId":p["nativeSessionId"],"turnId":p["turnId"],"type":p["type"],"correlation":p["correlation"],"payload":p["payload"],"rawRef":null});
            let emitted_event = event.clone();
            let kind = p["type"].as_str().unwrap();
            if !["session.started","session.info_changed","goal.updated","turn.started","message.delta","message.completed","reasoning.updated","reasoning.completed","tool.started","tool.updated","tool.completed","turn.completed","turn.failed","approval.requested","approval.resolved","user_input.requested","user_input.resolved","usage.updated","queue.updated","compaction.started","compaction.completed","retry.started","retry.completed","extension.updated","adapter.crashed"].contains(&kind) {
                return Err("capability_unsupported: event outside minimal lifecycle".into());
            }
            let negotiated: Value = serde_json::from_str(&active.1).map_err(|_|"manifest_mismatch: negotiated capabilities missing")?;
            if event_capability_required(kind, origin).is_some_and(|capability|!negotiated.as_array().is_some_and(|items|items.contains(&json!(capability)))) {
                return Err("capability_unsupported: event capability was not negotiated".into());
            }
            let turn_id = p["turnId"].as_str();
            if (kind.starts_with("turn.") || kind.starts_with("message.") || kind.starts_with("reasoning.") || kind.starts_with("tool.")) && turn_id.is_none() { return Err("invalid_session: turn identity required".into()); }
            if kind == "session.info_changed" {
                if turn_id.is_some() { return Err("invalid_session: recovery update cannot belong to a turn".into()); }
                let previous: String = sqlx::query_scalar("SELECT plugin_binding_json FROM session_bindings WHERE session_id=?").bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
                let mut current: Value = serde_json::from_str(&previous).map_err(|_|"invalid_recovery_data")?;
                current["recovery"] = p["payload"]["recovery"].clone();
                current["updatedAt"] = json!(now);
                if !crate::session_contract::binding_schema().is_valid(&current) { return Err("invalid_recovery_data: recovery update".into()); }
                sqlx::query("UPDATE session_bindings SET plugin_binding_json=? WHERE session_id=?").bind(current.to_string()).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            }
            if let Some(turn) = turn_id {
                let state: Option<String> = sqlx::query_scalar("SELECT status FROM turns WHERE id=? AND session_id=?").bind(turn).bind(session_id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
                if state.as_deref() != Some("running") && !(origin == EventOrigin::Host && kind == "adapter.crashed" && state.is_some()) { return Err("invalid_session: event for inactive turn".into()); }
                if kind == "turn.started" {
                    if let Some(native_turn) = p["payload"]["nativeTurnId"].as_str().filter(|id| !id.is_empty()) {
                        sqlx::query("UPDATE turns SET external_turn_id=? WHERE id=? AND session_id=?")
                            .bind(native_turn).bind(turn).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    }
                }
                if origin == EventOrigin::Host && kind == "adapter.crashed" {
                    let status = p["payload"]["status"].as_str().filter(|status| ["failed", "interrupted"].contains(status)).ok_or("invalid_output: host failure status")?;
                    sqlx::query("UPDATE turns SET status=?,completed_at=? WHERE id=? AND session_id=?")
                        .bind(status).bind(&now).bind(turn).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?")
                        .bind(status).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    sqlx::query("UPDATE messages SET status='failed',updated_at=? WHERE turn_id=? AND status='streaming'")
                        .bind(&now).bind(turn).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "message.delta" || kind == "message.completed" {
                    let text = p["payload"][if kind == "message.delta" {"delta"} else {"text"}].as_str().ok_or("invalid_request: message text")?;
                    let item_id = p["payload"]["itemId"].as_str().or_else(||p["correlation"]["itemId"].as_str()).filter(|value|!value.is_empty()).unwrap_or("assistant");
                    let external_item_id = scoped_external_item_id(turn, item_id);
                    let id = format!("{turn}:assistant:{item_id}");
                    if kind == "message.delta" {
                        sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'assistant',?,'streaming',?,?,?) ON CONFLICT(id) DO UPDATE SET content=content || excluded.content,updated_at=excluded.updated_at")
                            .bind(id).bind(session_id).bind(turn).bind(&external_item_id).bind(text).bind(sequence).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    } else {
                        sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'assistant',?,'completed',?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,status='completed',updated_at=excluded.updated_at")
                            .bind(id).bind(session_id).bind(turn).bind(&external_item_id).bind(text).bind(sequence).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    }
                } else if kind.starts_with("reasoning.") {
                    let item_id = p["payload"]["itemId"].as_str().filter(|value| !value.is_empty()).ok_or("invalid_request: reasoning item id")?;
                    let value = p["payload"][if kind == "reasoning.updated" { "delta" } else { "summary" }].as_str();
                    let mut chars = value.unwrap_or_default().chars();
                    let mut content: String = chars.by_ref().take(12_000).collect();
                    if chars.next().is_some() { content.push('…'); }
                    let append = kind == "reasoning.updated";
                    let status = if kind == "reasoning.completed" { "completed" } else { "streaming" };
                    let message_id = format!("{turn}:reasoning:{item_id}");
                    let external_item_id = scoped_external_item_id(turn, item_id);
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'system','reasoning',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=CASE WHEN ?=1 THEN messages.content || excluded.content WHEN excluded.content='' THEN messages.content ELSE excluded.content END,status=excluded.status,updated_at=excluded.updated_at")
                        .bind(message_id).bind(session_id).bind(turn).bind(external_item_id).bind(content).bind(status).bind(sequence).bind(&now).bind(&now).bind(if append { 1_i64 } else { 0_i64 })
                        .execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind.starts_with("tool.") {
                    let payload = &p["payload"];
                    let item_id = payload["itemId"].as_str().filter(|value| !value.is_empty()).ok_or("invalid_request: tool item id")?;
                    let item_type = payload["itemType"].as_str().filter(|value| !value.is_empty()).ok_or("invalid_request: tool item type")?;
                    let limit = |value: Option<&str>, max: usize| value.map(|text| {
                        let mut chars = text.chars();
                        let result: String = chars.by_ref().take(max).collect();
                        if chars.next().is_some() { format!("{result}…") } else { result }
                    });
                    let is_command = item_type.to_ascii_lowercase().contains("command");
                    let protect = |value: Option<String>| value.map(|text| if is_command { crate::artifact::sanitize_content("codex.command", &text) } else { text });
                    let summary = protect(limit(payload["summary"].as_str(), 12_000)).unwrap_or_else(|| item_type.to_owned());
                    let delta = protect(limit(payload["delta"].as_str(), 4_000));
                    let output = protect(limit(payload["output"].as_str(), 12_000));
                    let command = protect(limit(payload["command"].as_str(), 4_000));
                    let cwd = limit(payload["cwd"].as_str(), 4_000);
                    let exit_code = payload["exitCode"].as_i64();
                    let raw_status = payload["status"].as_str().unwrap_or_default().to_ascii_lowercase();
                    let status = if ["failed", "error", "declined", "cancelled", "canceled"].contains(&raw_status.as_str()) { "failed" }
                        else if kind == "tool.completed" { "completed" } else { "streaming" };
                    let content = output.as_deref().or(delta.as_deref()).unwrap_or(&summary);
                    let append = kind == "tool.updated" && delta.is_some() && output.is_none();
                    let message_id = format!("{turn}:tool:{item_id}");
                    let external_item_id = scoped_external_item_id(turn, item_id);
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,tool_command,tool_cwd,tool_exit_code,content,status,sequence,created_at,updated_at) VALUES(?,?,?,?,'tool',?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=CASE WHEN ?=1 THEN messages.content || excluded.content ELSE excluded.content END,tool_name=excluded.tool_name,tool_command=COALESCE(excluded.tool_command,messages.tool_command),tool_cwd=COALESCE(excluded.tool_cwd,messages.tool_cwd),tool_exit_code=COALESCE(excluded.tool_exit_code,messages.tool_exit_code),status=excluded.status,updated_at=excluded.updated_at")
                        .bind(message_id).bind(session_id).bind(turn).bind(external_item_id).bind(item_type).bind(command).bind(cwd).bind(exit_code).bind(content).bind(status).bind(sequence).bind(&now).bind(&now).bind(if append { 1_i64 } else { 0_i64 })
                        .execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "approval.requested" || kind == "user_input.requested" {
                    let request_id = p["payload"]["requestId"].as_str().ok_or("invalid_request: request id")?;
                    if request_id.is_empty() { return Err("invalid_request: request id".into()); }
                    let waiting = if kind == "approval.requested" { "waiting_approval" } else { "waiting_user" };
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?").bind(waiting).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "approval.resolved" || kind == "user_input.resolved" {
                    sqlx::query("UPDATE sessions SET state='running',updated_at=? WHERE id=?").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "compaction.started" {
                    sqlx::query("UPDATE sessions SET state='compacting',updated_at=? WHERE id=?").bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "compaction.completed" {
                    let running: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM turns WHERE session_id=? AND status='running')")
                        .bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?")
                        .bind(if running != 0 { "running" } else { "idle" }).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                } else if kind == "turn.completed" || kind == "turn.failed" {
                    let status = if kind == "turn.failed" { "failed" } else { p["payload"]["status"].as_str().ok_or("invalid_request: terminal status")? };
                    if !["completed","interrupted","failed"].contains(&status) { return Err("invalid_request: terminal status".into()); }
                    sqlx::query("UPDATE turns SET status=?,completed_at=? WHERE id=? AND status='running'").bind(status).bind(&now).bind(turn).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    let session_state = match status {
                        "completed" => "idle",
                        "interrupted" => "interrupted",
                        "failed" => "failed",
                        _ => return Err("invalid_request: terminal status".into()),
                    };
                    sqlx::query("UPDATE sessions SET state=?,updated_at=? WHERE id=?").bind(session_state).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                }
            }
            sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,turn_id,payload_json,schema_version) VALUES(?,?,?,?,?,?,?,?,'2.0')")
                .bind(event_id).bind(session_id).bind(generation).bind(sequence).bind(now).bind(kind).bind(turn_id).bind(event.to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        tx.commit().await.map_err(|e|e.to_string())?;
        if let Some(app) = &self.app {
            let event=emitted_event;
            let _ = app.emit("agent-event", event);
        }
        Ok(())
    }
}

fn scoped_external_item_id(turn_id: &str, item_id: &str) -> String {
    format!("{turn_id}:{item_id}")
}
