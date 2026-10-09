//! Host history branching; native fork mechanics belong to the selected capability plugin.
use super::*;
use sqlx::Row;

impl SessionHost {
    pub async fn fork_from(&self, caller: &str, session_id: &str, through_turn_id: Option<&str>) -> Result<Session, String> {
        self.fork_with_locale_from(caller, session_id, through_turn_id, crate::ui_i18n::Locale::ZhCn).await
    }
    pub async fn fork_with_locale_from(&self, caller: &str, session_id: &str, through_turn_id: Option<&str>, locale: crate::ui_i18n::Locale) -> Result<Session, String> {
        self.fork_display_from(caller,session_id,through_turn_id,locale).await.map_err(|error|error.diagnostic)
    }
    pub(crate) async fn fork_display_from(&self, caller: &str, session_id: &str, through_turn_id: Option<&str>, locale: crate::ui_i18n::Locale) -> Result<Session, HostMessage> {
        let _guard = self.session_operation(session_id).await;
        // Hold admission until the branch snapshot has been committed. No source turn
        // can begin between boundary selection and copying the host history.
        if self.live.lock().await.contains_key(session_id) { return Err(session_error("native.session.branchIdle","busy: session must be idle before branching")); }
        self.open_display(caller, session_id).await?;
        let (source, manifest) = self.metadata_display(session_id).await?;
        if !source.capabilities.iter().any(|cap| cap == "session.fork") { return Err(HostMessage::with_diagnostic("native.session.unsupportedCapability",json!({"capability":"session.fork"}),"capability_unsupported: session.fork")); }
        if source.archived { return Err(session_error("native.session.branchArchived","invalid_session: archived session cannot branch")); }
        let saved = self.saved_binding_display(session_id).await?.ok_or_else(||session_error("native.session.branchBindingMissing","history_only: missing capability binding"))?;
        let turns = sqlx::query("SELECT id,external_turn_id,status,input_text,output_text,started_at,completed_at FROM turns WHERE session_id=? ORDER BY started_at,id")
            .bind(session_id).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
        let boundary = if let Some(id) = through_turn_id {
            Some(turns.iter().position(|row| row.get::<String,_>("id")==id && row.get::<String,_>("status")=="completed")
                .ok_or_else(||session_error("native.session.branchBoundary","invalid_input: fork boundary must be a completed source turn"))?)
        } else { turns.iter().rposition(|row| row.get::<String,_>("status")=="completed") };
        if boundary.is_none() && !turns.is_empty() { return Err(session_error("native.session.branchNoBoundary","invalid_input: no completed fork boundary")); }
        let mut input = json!({});
        if let Some(index) = boundary {
            let native: String = turns[index].get("external_turn_id");
            if native.is_empty() || native==turns[index].get::<String,_>("id") {
                return Err(session_error("native.session.branchNativeIdentity","history_only: this turn has no native fork identity"));
            }
            input["nativeTurnId"] = json!(native);
        }
        let capability = format!("{}.session.fork", manifest["pluginId"].as_str().ok_or("invalid_manifest")?);
        let binding = Self::binding(&source, &capability)?;
        let response = self.broker.invoke_bound(caller, Request {
            scope: binding.scope.clone(), capability, version:"1.0.0".into(), request_id:ulid::Ulid::new().to_string(),turn_id:None,input,
        }, &binding).await.map_err(|e|format!("{}: {}",e.code,e.message))?;
        let fork = &response.output["fork"];
        let native = fork["nativeSessionId"].as_str().filter(|id| !id.is_empty()).ok_or_else(||session_error("native.session.branchOutputIdentity","invalid_output: missing fork identity"))?;
        if fork["nativeSessionId"]==saved["nativeSessionId"] { return Err(session_error("native.session.branchReusedIdentity","invalid_output: fork reused source identity")); }
        let new_id = ulid::Ulid::new().to_string();
        let now = crate::now_iso();
        let mut document = saved.clone();
        document["sessionId"] = json!(new_id);
        document["nativeSessionId"] = json!(native);
        document["recovery"] = fork["recovery"].clone();
        document["createdAt"] = json!(now);
        document["updatedAt"] = json!(now);
        if !crate::session_contract::binding_schema().is_valid(&document) { return Err(session_error("native.session.branchRecovery","invalid_output: fork recovery binding")); }
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES(?,?,?,?,'interrupted',?,?,?)")
            .bind(&new_id).bind(&source.workspace_id).bind(&source.agent).bind(crate::ui_i18n::message(locale,"native.session.branchLabel",&json!({"label":source.label}))).bind(&now).bind(&now).bind(&source.plugin_installation_id)
            .execute(&mut *tx).await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO session_bindings(session_id,external_session_id,generation_id,adapter_version,parent_external_session_id,bound_at,plugin_binding_json,plugin_capabilities_json) VALUES(?,?,NULL,'2.1',?,?,?,?)")
            .bind(&new_id).bind(native).bind(saved["nativeSessionId"].as_str()).bind(&now).bind(document.to_string()).bind(json!(crate::session_contract::negotiate(&manifest, &source.agent, &response.output["capabilities"], &response.negotiated_operations)).to_string())
            .execute(&mut *tx).await.map_err(|e|e.to_string())?;
        let profile = sqlx::query("INSERT INTO session_execution_profiles(session_id,schema_version,requested_json,enforced_json,unsupported_json,adapter_capabilities_json,native_sandbox,resolved_at,created_at,updated_at,enforcement_backend) SELECT ?,schema_version,requested_json,enforced_json,unsupported_json,adapter_capabilities_json,native_sandbox,resolved_at,?,?,enforcement_backend FROM session_execution_profiles WHERE session_id=?")
            .bind(&new_id).bind(&now).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        if profile.rows_affected()!=1 { return Err(session_error("native.session.branchProfileMissing","invalid_session: source execution profile missing")); }
        for row in turns.iter().take(boundary.map_or(0,|index|index+1)) {
            let old_id: String = row.get("id");
            let turn_id = ulid::Ulid::new().to_string();
            sqlx::query("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,output_text,started_at,completed_at) VALUES(?,?,?,?,?,?,?,?)")
                .bind(&turn_id).bind(&new_id).bind(row.get::<String,_>("external_turn_id")).bind(row.get::<String,_>("status"))
                .bind(row.get::<String,_>("input_text")).bind(row.get::<String,_>("output_text")).bind(row.get::<String,_>("started_at")).bind(row.get::<Option<String>,_>("completed_at"))
                .execute(&mut *tx).await.map_err(|e|e.to_string())?;
            let messages = sqlx::query("SELECT id FROM messages WHERE session_id=? AND turn_id=? ORDER BY created_at,sequence,id")
                .bind(session_id).bind(&old_id).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
            for message in messages {
                sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,tool_command,tool_cwd,tool_exit_code,content,localized_content_json,status,sequence,created_at,updated_at) SELECT ?,?,?,external_message_id,role,tool_name,tool_command,tool_cwd,tool_exit_code,content,localized_content_json,status,sequence,created_at,updated_at FROM messages WHERE id=?")
                    .bind(ulid::Ulid::new().to_string()).bind(&new_id).bind(&turn_id).bind(message.get::<String,_>("id"))
                    .execute(&mut *tx).await.map_err(|e|e.to_string())?;
            }
            // A branch retains the child history belonging to its copied parent turns.
            sqlx::query("UPDATE messages SET content=json_set(content,'$.rootTurnId',?) WHERE session_id=? AND turn_id=? AND tool_name IN ('subagent','background_task')")
                .bind(&turn_id).bind(&new_id).bind(&turn_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            let activity = crate::ui_i18n::HostMessage::new("native.background.forkActivity",json!({}));
            sqlx::query("UPDATE messages SET status='failed',content=json_set(content,'$.status','unknown','$.activity',?),localized_content_json=? WHERE session_id=? AND turn_id=? AND tool_name='background_task' AND json_extract(content,'$.status')='running'")
                .bind(&activity.diagnostic).bind(activity.localized.as_ref().map(Value::to_string)).bind(&new_id).bind(&turn_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            let child_events = sqlx::query("SELECT generation_id,sequence,occurred_at,payload_json FROM agent_events WHERE session_id=? AND event_type='subagent.message' AND json_extract(payload_json,'$.payload.rootTurnId')=? ORDER BY occurred_at,sequence")
                .bind(session_id).bind(&old_id).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
            for child in child_events {
                let event_id = ulid::Ulid::new().to_string();
                let generation = format!("fork:{}",child.get::<String,_>("generation_id"));
                let mut event: Value = serde_json::from_str(&child.get::<String,_>("payload_json")).map_err(|e|e.to_string())?;
                event["eventId"] = json!(event_id); event["sessionId"] = json!(new_id); event["nativeSessionId"] = json!(native);
                event["generationId"] = json!(generation); event["payload"]["rootTurnId"] = json!(turn_id);
                sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,turn_id,payload_json,schema_version) VALUES(?,?,?,?,?,'subagent.message',NULL,?,'2.0')")
                    .bind(event_id).bind(&new_id).bind(generation).bind(child.get::<i64,_>("sequence")).bind(child.get::<String,_>("occurred_at")).bind(event.to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            }
        }
        tx.commit().await.map_err(|e|e.to_string())?;
        // The durable branch exists even if its first open fails; it remains retryable.
        self.resume_from_display(caller, &new_id).await?;
        crate::session_by_id(&self.db, &new_id).await.map_err(|e|HostMessage::from(e.to_string()))
    }
}
