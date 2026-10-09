//! Durable, editable messages awaiting delivery. Native steering is a delivery
//! mechanism, never the source of truth for the waiting queue.
use super::*;
use sqlx::Row;

// Only explicit protocol rejection markers establish that delivery never happened.
// Diagnostic text mentioning a native parameter is not an acknowledgement.
fn steering_rejection(error: &str) -> (bool, bool) {
    let no_turn = error == "no_active_turn" || error.starts_with("no_active_turn:")
        || error == "busy: the turn has finished accepting interactions";
    let rejected = error == "steer_rejected" || error.starts_with("steer_rejected:");
    (no_turn, rejected)
}

impl SessionHost {
    pub(super) async fn host_queue_supported(&self, session_id: &str) -> Result<bool, String> {
        let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
        Ok(session.capabilities.iter().any(|capability| capability == "queue.manage"))
    }
    async fn queue_snapshot(&self, session_id: &str) -> Result<Value, String> {
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO session_queues(session_id) VALUES(?) ON CONFLICT(session_id) DO UPDATE SET revision=revision+1")
            .bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        let (paused, revision): (bool,i64) = sqlx::query_as("SELECT paused,revision FROM session_queues WHERE session_id=?")
            .bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        let rows = sqlx::query("SELECT id,text,status,error,localized_error_json,created_at FROM queued_messages WHERE session_id=? ORDER BY sequence")
            .bind(session_id).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
        let items: Vec<Value> = rows.iter().map(|r| {
            let mut item = json!({"id":r.get::<String,_>("id"),"text":r.get::<String,_>("text"),
                "status":r.get::<String,_>("status"),"error":r.get::<Option<String>,_>("error"),"createdAt":r.get::<String,_>("created_at")});
            if let Some(display) = r.get::<Option<String>,_>("localized_error_json").and_then(|text|serde_json::from_str::<Value>(&text).ok()) {
                item["localizedError"] = display;
            }
            item
        }).collect();
        tx.commit().await.map_err(|e|e.to_string())?;
        Ok(json!({"sessionId":session_id,"items":items,"paused":paused,"revision":revision,
            "steering":[],"followUp":items.iter().map(|i|i["text"].clone()).collect::<Vec<_>>(),"updatedAt":crate::now_iso()}))
    }
    async fn publish_queue(&self, session_id: &str) -> Result<Value, String> {
        let snapshot = self.queue_snapshot(session_id).await?;
        // Queue persistence also works before a native runtime has been reopened.
        if let Some(binding) = self.saved_binding(session_id).await? {
            let generation: Option<String> = sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id=?")
                .bind(session_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
            if let Some(generation) = generation {
                let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
                self.project_event(session_id, &session.workspace_id, &generation, &binding,
                    json!({"nativeSessionId":binding["nativeSessionId"],"turnId":null,"type":"queue.updated","correlation":null,"payload":snapshot}), EventOrigin::Host).await?;
            }
        }
        Ok(snapshot)
    }
    pub(super) async fn pause_queue(&self, session_id: &str) -> Result<(), String> {
        sqlx::query("UPDATE session_queues SET paused=1 WHERE session_id=?").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        Ok(())
    }
    async fn check_queue_owner(&self, caller: &str, session_id: &str) -> Result<(), HostMessage> {
        if let Some(run) = self.live.lock().await.get(session_id) {
            if run.caller != caller { return Err(session_error("native.session.otherWindow","permission_denied: invocation belongs to another window")); }
        }
        Ok(())
    }
    pub(super) async fn enqueue_admitted(&self, caller: &str, session_id: &str, text: &str) -> Result<String, HostMessage> {
        if !self.host_queue_supported(session_id).await? { return Err(HostMessage::with_diagnostic("native.session.unsupportedCapability",json!({"capability":"queue.manage"}),"capability_unsupported: queue.manage")); }
        self.check_queue_owner(caller, session_id).await?;
        let (session, _) = self.metadata_display(session_id).await?;
        if session.archived || session.state == "closed" { return Err(session_error("native.session.closed","invalid_session: session is closed")); }
        if text.trim().is_empty() || text.len()>200_000 { return Err(session_error("native.session.promptLength","invalid_input: prompt length")); }
        let id = ulid::Ulid::new().to_string();
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM queued_messages WHERE session_id=?").bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        if count >= 100 { return Err(session_error("native.queue.full","invalid_input: queue is full (100 messages)")); }
        sqlx::query("INSERT INTO session_queues(session_id) VALUES(?) ON CONFLICT DO NOTHING").bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO queued_messages(id,session_id,caller,text,created_at) VALUES(?,?,?,?,?)")
            .bind(&id).bind(session_id).bind(caller).bind(text).bind(crate::now_iso()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        crate::session_attachments::freeze_for_queue(&mut tx, session_id, &id, text).await.map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e|e.to_string())?;
        // A failed UI notification must not turn durable acceptance into a retry.
        if let Err(error) = self.publish_queue(session_id).await { eprintln!("queue notification failed: {error}"); }
        Ok(id)
    }
    pub(super) async fn queue_operation(&self, caller: &str, session_id: &str, input: Value) -> Result<Value, crate::ui_i18n::HostMessage> {
        let _guard = self.session_operation(&format!("queue:{session_id}")).await;
        self.check_queue_owner(caller, session_id).await?;
        let action = input["action"].as_str().ok_or_else(||session_error("native.queue.actionRequired","invalid_input: queue action required"))?;
        if action == "get" { return self.queue_snapshot(session_id).await.map_err(Into::into); }
        let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
        if session.archived || session.state == "closed" { return Err(session_error("native.session.closed","invalid_session: session is closed")); }
        // Reject unsupported steering before accepting a draft or claiming an item.
        if matches!(action, "steer" | "sendNow") && self.live.lock().await.contains_key(session_id)
            && !session.capabilities.iter().any(|capability| capability == "queue.steer") {
            return Err(HostMessage::with_diagnostic("native.session.unsupportedCapability",json!({"capability":"queue.steer"}),"capability_unsupported: queue.steer"));
        }
        match action {
            "followUp" | "steer" => {
                let text = input["message"].as_str().ok_or_else(||session_error("native.queue.messageRequired","invalid_input: message required"))?;
                let id = self.enqueue_admitted(caller, session_id, text).await?;
                if action == "steer" {
                    // Enqueue is the acceptance boundary. Delivery feedback must
                    // not leave a second copy of this accepted message in drafts.
                    if let Err(error) = self.deliver_queued(caller, session_id, &id, true).await {
                        let status: Option<String> = sqlx::query_scalar("SELECT status FROM queued_messages WHERE id=?").bind(&id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?;
                        self.fail_queued_display(session_id, &id, &error, matches!(status.as_deref(), Some("sending" | "uncertain"))).await?;
                    }
                }
                else { self.schedule_queue(session_id.into()); }
            }
            "remove" | "clear" => {
                let id = if action == "remove" { Some(input["id"].as_str().ok_or_else(||session_error("native.queue.idRequired","invalid_input: message id required"))?) } else { None };
                let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
                // Sending rows have already been claimed and cannot be withdrawn.
                sqlx::query("DELETE FROM attachments WHERE turn_id IS NULL AND queued_message_id IN (SELECT id FROM queued_messages WHERE session_id=? AND status!='sending' AND (? IS NULL OR id=?))")
                    .bind(session_id).bind(id).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                sqlx::query("DELETE FROM queued_messages WHERE session_id=? AND status!='sending' AND (? IS NULL OR id=?)")
                    .bind(session_id).bind(id).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                tx.commit().await.map_err(|e|e.to_string())?;
            }
            "sendNow" => {
                let id = input["id"].as_str().ok_or_else(||session_error("native.queue.idRequired","invalid_input: message id required"))?;
                self.deliver_queued(caller, session_id, id, true).await?;
            }
            "resume" => {
                let uncertain: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM queued_messages WHERE session_id=? AND status='uncertain'").bind(session_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
                if uncertain > 0 { return Err(crate::ui_i18n::HostMessage::new("native.queue.resumeUncertain", json!({}))); }
                sqlx::query("UPDATE queued_messages SET status='pending',delivery='turn',turn_id=NULL,error=NULL,localized_error_json=NULL WHERE session_id=? AND status='failed'").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
                sqlx::query("UPDATE session_queues SET paused=0 WHERE session_id=?").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
                self.schedule_queue(session_id.into());
            }
            _ => return Err(session_error("native.queue.unknownAction","invalid_input: unknown queue action")),
        }
        self.publish_queue(session_id).await.map_err(Into::into)
    }
    async fn fail_queued_display(&self, session_id: &str, id: &str, error: &crate::ui_i18n::HostMessage, uncertain: bool) -> Result<(), String> {
        sqlx::query("UPDATE queued_messages SET status=?,error=?,localized_error_json=? WHERE session_id=? AND id=?")
            .bind(if uncertain {"uncertain"} else {"failed"}).bind(&error.diagnostic).bind(error.localized.as_ref().map(|value|value.to_string())).bind(session_id).bind(id).execute(&self.db).await.map_err(|e|e.to_string())?;
        self.pause_queue(session_id).await?;
        self.publish_queue(session_id).await?;
        Ok(())
    }
    // Caller holds session admission across claim + delivery, serializing remove,
    // send-now, ordinary sends, cancellation and automatic FIFO dispatch.
    async fn deliver_queued(&self, caller: &str, session_id: &str, id: &str, immediate: bool) -> Result<(), crate::ui_i18n::HostMessage> {
        let row: Option<(String,String)> = sqlx::query_as("SELECT text,status FROM queued_messages WHERE id=? AND session_id=?")
            .bind(id).bind(session_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?;
        let Some((text,status)) = row else { return Err(session_error("native.queue.missing","invalid_input: queued message no longer exists")); };
        if status == "sending" { return Err(session_error("native.queue.sending","busy: message is already being sent")); }
        if status == "uncertain" { return Err(crate::ui_i18n::HostMessage::new("native.queue.sendUncertain", json!({}))); }
        if let Err(error) = crate::session_attachments::validate_queued(&self.db, session_id, id).await {
            self.fail_queued_display(session_id, id, &error, false).await?; return Ok(());
        }
        // A finishing invocation may still be persisting history. Wait for its
        // lifecycle to release ownership before selecting steer versus start.
        let mut running = self.live.lock().await.get(session_id).cloned();
        if let Some(run) = &running {
            if matches!(*run.phase.borrow(), TurnPhase::Settling | TurnPhase::Finished) {
                let mut phase = run.phase.subscribe();
                while *phase.borrow_and_update() != TurnPhase::Finished { phase.changed().await.map_err(|_|session_error("native.session.lifecycleStopped","session lifecycle stopped"))?; }
                running = None;
            }
        }
        if let Some(run) = running {
            if !immediate { return Ok(()); }
            let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
            if !session.capabilities.iter().any(|capability| capability == "queue.steer") {
                return Err(HostMessage::with_diagnostic("native.session.unsupportedCapability",json!({"capability":"queue.steer"}),"capability_unsupported: queue.steer"));
            }
            if run.cancel.load(Ordering::Acquire) { return Err(session_error("native.queue.stopping","busy: session is stopping")); }
            let attachments = crate::session_attachments::inputs(&self.db, session_id, Some(id), &session.capabilities).await?;
            sqlx::query("UPDATE queued_messages SET status='sending',delivery='steer',turn_id=?,error=NULL,localized_error_json=NULL WHERE id=?")
                .bind(&run.request_id).bind(id).execute(&self.db).await.map_err(|e|e.to_string())?;
            let mut input = json!({"action":"steer","message":text});
            if attachments.iter().any(|attachment| attachment["type"] == "image") {
                input["attachments"] = json!(attachments);
            }
            let result = self.invoke_provider_capability(caller, session_id, "queue.manage", input).await;
            match result {
                Ok(_) => {
                    let now = crate::now_iso();
                    let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES(?,?,?,'user',?,'completed',?,?)")
                        .bind(format!("queued:{id}")).bind(session_id).bind(&run.request_id).bind(&text).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    crate::session_attachments::bind_to_turn(&mut tx, session_id, Some(id), &run.request_id).await.map_err(|e|e.to_string())?;
                    sqlx::query("DELETE FROM queued_messages WHERE id=?").bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    tx.commit().await.map_err(|e|e.to_string())?;
                }
                Err(error) => {
                    // Only an explicit pre-dispatch or stale-turn rejection is
                    // safe to retry. A timeout may have reached the provider.
                    let (stale, rejected) = steering_rejection(&error.diagnostic);
                    if stale {
                        sqlx::query("UPDATE queued_messages SET status='pending',turn_id=NULL WHERE id=?").bind(id).execute(&self.db).await.map_err(|e|e.to_string())?;
                        let mut phase = run.phase.subscribe();
                        tokio::time::timeout(Duration::from_secs(10), async {
                            while *phase.borrow_and_update() != TurnPhase::Finished { phase.changed().await.map_err(|_|session_error("native.session.lifecycleStopped","session lifecycle stopped"))?; }
                            Ok::<_,HostMessage>(())
                        }).await.map_err(|_|session_error("native.queue.finishing","busy: session is still finishing"))??;
                        if !run.cancel.load(Ordering::Acquire) { self.start_queued(caller, session_id, id, &text, immediate).await?; }
                    } else { self.fail_queued_display(session_id, id, &error, !rejected).await?; }
                }
            }
        } else { self.start_queued(caller, session_id, id, &text, immediate).await?; }
        Ok(())
    }
    async fn start_queued(&self, caller: &str, session_id: &str, id: &str, text: &str, immediate: bool) -> Result<(), String> {
        let _admission = self.session_operation(session_id).await;
        if !immediate {
            let paused: bool = sqlx::query_scalar("SELECT paused FROM session_queues WHERE session_id=?").bind(session_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
            if paused { return Ok(()); }
        }
        let result = async {
            let approval = crate::session_permissions::turn_request(&self.db, session_id, caller).await?;
            self.run_admitted(caller, session_id, text, Some(approval), false, Some(id)).await
        }.await;
        if let Err(error) = result { self.fail_queued_display(session_id, id, &error, false).await?; }
        Ok(())
    }
    pub(super) async fn acknowledge_queued_turn(&self, session_id: &str, turn_id: &str) -> Result<(), String> {
        let changed = sqlx::query("DELETE FROM queued_messages WHERE session_id=? AND turn_id=? AND status='sending' AND delivery='turn'")
            .bind(session_id).bind(turn_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        if changed.rows_affected()>0 { self.publish_queue(session_id).await?; }
        Ok(())
    }
    pub(super) async fn settle_queue_turn(&self, session_id: &str, turn_id: &str, cancelled: bool) -> Result<(), String> {
        let status: String = sqlx::query_scalar("SELECT status FROM turns WHERE id=?").bind(turn_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
        // Still sending means no native start acknowledgement was observed.
        let display = crate::ui_i18n::HostMessage::new("native.queue.unacknowledged", json!({}));
        let changed = sqlx::query("UPDATE queued_messages SET status='uncertain',error=?,localized_error_json=? WHERE session_id=? AND turn_id=? AND status='sending'")
            .bind(display.diagnostic).bind(display.localized.map(|value|value.to_string())).bind(session_id).bind(turn_id).execute(&self.db).await.map_err(|e|e.to_string())?;
        if cancelled || status != "completed" || changed.rows_affected()>0 { self.pause_queue(session_id).await?; }
        if self.host_queue_supported(session_id).await? { self.publish_queue(session_id).await?; }
        Ok(())
    }
    pub(super) fn schedule_queue(&self, session_id: String) {
        let host = self.clone();
        // Type erasure breaks the send -> completion -> next-send future cycle.
        let future: std::pin::Pin<Box<dyn std::future::Future<Output=()> + Send>> = Box::pin(async move {
            let _guard = host.session_operation(&format!("queue:{session_id}")).await;
            if host.live.lock().await.contains_key(&session_id) { return; }
            let result = async {
                let row: Option<(String,String)> = sqlx::query_as("SELECT m.id,m.caller FROM queued_messages m JOIN session_queues q ON q.session_id=m.session_id JOIN sessions s ON s.id=m.session_id WHERE m.session_id=? AND q.paused=0 AND s.archived=0 AND s.state IN ('idle','interrupted','failed') AND m.status='pending' ORDER BY m.sequence LIMIT 1")
                    .bind(&session_id).fetch_optional(&host.db).await.map_err(|e|e.to_string())?;
                if let Some((id,caller)) = row { host.deliver_queued(&caller, &session_id, &id, false).await.map_err(|error|error.diagnostic)?; host.publish_queue(&session_id).await?; }
                Ok::<_,String>(())
            }.await;
            if let Err(error) = result { eprintln!("queue dispatch failed: {error}"); let _ = host.pause_queue(&session_id).await; }
        });
        tokio::spawn(future);
    }
}

#[cfg(test)]
mod tests {
    use super::steering_rejection;

    #[test]
    fn ambiguous_errors_never_authorize_resending_a_steering_message() {
        for message in ["timeout: expectedTurnId acknowledgement lost", "transport closed after no_active_turn diagnostic", "timeout after steer_rejected response was lost"] {
            assert_eq!(steering_rejection(message), (false, false));
        }
        assert_eq!(steering_rejection("no_active_turn"), (true, false));
        assert_eq!(steering_rejection("no_active_turn: native turn already ended"), (true, false));
        assert_eq!(steering_rejection("busy: the turn has finished accepting interactions"), (true, false));
        assert_eq!(steering_rejection("steer_rejected: invalid native input"), (false, true));
    }
}
