//! Host history branching; native fork mechanics belong to the selected capability plugin.
use super::*;
use sqlx::Row;

impl SessionHost {
    pub async fn fork_from(&self, caller: &str, session_id: &str, through_turn_id: Option<&str>) -> Result<Session, String> {
        self.resume_from(caller, session_id).await?;
        // Hold admission until the branch snapshot has been committed. No source turn
        // can begin between boundary selection and copying the host history.
        let live = self.live.lock().await;
        if live.contains_key(session_id) { return Err("busy: session must be idle before branching".into()); }
        let (source, manifest) = self.metadata(session_id).await?;
        if source.archived { return Err("invalid_session: archived session cannot branch".into()); }
        let saved = self.saved_binding(session_id).await?.ok_or("history_only: missing capability binding")?;
        let turns = sqlx::query("SELECT id,external_turn_id,status,input_text,output_text,started_at,completed_at FROM turns WHERE session_id=? ORDER BY started_at,id")
            .bind(session_id).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
        let boundary = if let Some(id) = through_turn_id {
            Some(turns.iter().position(|row| row.get::<String,_>("id")==id && row.get::<String,_>("status")=="completed")
                .ok_or("invalid_input: fork boundary must be a completed source turn")?)
        } else { turns.iter().rposition(|row| row.get::<String,_>("status")=="completed") };
        if boundary.is_none() && !turns.is_empty() { return Err("invalid_input: no completed fork boundary".into()); }
        let mut input = json!({});
        if let Some(index) = boundary {
            let native: String = turns[index].get("external_turn_id");
            if native.is_empty() || native==turns[index].get::<String,_>("id") {
                return Err("history_only: this turn has no native fork identity".into());
            }
            input["nativeTurnId"] = json!(native);
        }
        let capability = format!("{}.session.fork", manifest["pluginId"].as_str().ok_or("invalid_manifest")?);
        let binding = Self::binding(&source, &capability)?;
        let response = self.broker.invoke_bound(caller, Request {
            scope: binding.scope.clone(), capability, version:"1.0.0".into(), request_id:ulid::Ulid::new().to_string(),turn_id:None,input,
        }, &binding).await.map_err(|e|format!("{}: {}",e.code,e.message))?;
        let fork = &response.output["fork"];
        let native = fork["nativeSessionId"].as_str().filter(|id| !id.is_empty()).ok_or("invalid_output: missing fork identity")?;
        if fork["nativeSessionId"]==saved["nativeSessionId"] { return Err("invalid_output: fork reused source identity".into()); }
        let new_id = ulid::Ulid::new().to_string();
        let now = crate::now_iso();
        let mut document = saved.clone();
        document["sessionId"] = json!(new_id);
        document["nativeSessionId"] = json!(native);
        document["recovery"] = fork["recovery"].clone();
        document["createdAt"] = json!(now);
        document["updatedAt"] = json!(now);
        if !crate::session_contract::binding_schema().is_valid(&document) { return Err("invalid_output: fork recovery binding".into()); }
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at,plugin_installation_id) VALUES(?,?,?,?,'interrupted',?,?,?)")
            .bind(&new_id).bind(&source.workspace_id).bind(&source.agent).bind(format!("{} · 分支",source.label)).bind(&now).bind(&now).bind(&source.plugin_installation_id)
            .execute(&mut *tx).await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO session_bindings(session_id,external_session_id,generation_id,adapter_version,parent_external_session_id,bound_at,plugin_binding_json,plugin_capabilities_json) VALUES(?,?,NULL,'2.1',?,?,?,?)")
            .bind(&new_id).bind(native).bind(saved["nativeSessionId"].as_str()).bind(&now).bind(document.to_string()).bind(response.output["capabilities"].to_string())
            .execute(&mut *tx).await.map_err(|e|e.to_string())?;
        let profile = sqlx::query("INSERT INTO session_execution_profiles(session_id,schema_version,requested_json,enforced_json,unsupported_json,adapter_capabilities_json,native_sandbox,resolved_at,created_at,updated_at,enforcement_backend) SELECT ?,schema_version,requested_json,enforced_json,unsupported_json,adapter_capabilities_json,native_sandbox,resolved_at,?,?,enforcement_backend FROM session_execution_profiles WHERE session_id=?")
            .bind(&new_id).bind(&now).bind(&now).bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        if profile.rows_affected()!=1 { return Err("invalid_session: source execution profile missing".into()); }
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
                sqlx::query("INSERT INTO messages(id,session_id,turn_id,external_message_id,role,tool_name,tool_command,tool_cwd,tool_exit_code,content,status,sequence,created_at,updated_at) SELECT ?,?,?,external_message_id,role,tool_name,tool_command,tool_cwd,tool_exit_code,content,status,sequence,created_at,updated_at FROM messages WHERE id=?")
                    .bind(ulid::Ulid::new().to_string()).bind(&new_id).bind(&turn_id).bind(message.get::<String,_>("id"))
                    .execute(&mut *tx).await.map_err(|e|e.to_string())?;
            }
        }
        tx.commit().await.map_err(|e|e.to_string())?;
        drop(live);
        // The durable branch exists even if its first open fails; it remains retryable.
        self.resume_from(caller, &new_id).await?;
        crate::session_by_id(&self.db, &new_id).await.map_err(|e|e.to_string())
    }
}
