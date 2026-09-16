//! Durable, editable messages awaiting delivery. Native steering is a delivery
//! mechanism, never the source of truth for the waiting queue.
use super::*;
use sqlx::Row;
use sha2::{Digest, Sha256};

pub(super) fn builtin_queue(agent: &str) -> bool {
    matches!(agent, "dev.aibo.codex.agent" | "dev.aibo.pi.agent")
}
impl SessionHost {
    pub(super) async fn host_queue_supported(&self, session_id: &str) -> Result<bool, String> {
        let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
        Ok(builtin_queue(&session.agent) && session.plugin_installation_id.is_some())
    }
    async fn queue_snapshot(&self, session_id: &str) -> Result<Value, String> {
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO session_queues(session_id) VALUES(?) ON CONFLICT(session_id) DO UPDATE SET revision=revision+1")
            .bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        let (paused, revision): (bool,i64) = sqlx::query_as("SELECT paused,revision FROM session_queues WHERE session_id=?")
            .bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        let rows = sqlx::query("SELECT id,text,status,error,created_at FROM queued_messages WHERE session_id=? ORDER BY sequence")
            .bind(session_id).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
        let items: Vec<Value> = rows.iter().map(|r| json!({"id":r.get::<String,_>("id"),"text":r.get::<String,_>("text"),
            "status":r.get::<String,_>("status"),"error":r.get::<Option<String>,_>("error"),"createdAt":r.get::<String,_>("created_at")})).collect();
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
    async fn check_queue_owner(&self, caller: &str, session_id: &str) -> Result<(), String> {
        if let Some(run) = self.live.lock().await.get(session_id) {
            if run.caller != caller { return Err("permission_denied: invocation belongs to another window".into()); }
        }
        Ok(())
    }
    pub(super) async fn enqueue_admitted(&self, caller: &str, session_id: &str, text: &str) -> Result<String, String> {
        if !self.host_queue_supported(session_id).await? { return Err("capability_unsupported: queue.manage".into()); }
        self.check_queue_owner(caller, session_id).await?;
        let (session, _) = self.metadata(session_id).await?;
        if session.archived || session.state == "closed" { return Err("invalid_session: session is closed".into()); }
        if text.trim().is_empty() || text.len()>200_000 { return Err("invalid_input: prompt length".into()); }
        let id = ulid::Ulid::new().to_string();
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM queued_messages WHERE session_id=?").bind(session_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        if count >= 100 { return Err("invalid_input: queue is full (100 messages)".into()); }
        sqlx::query("INSERT INTO session_queues(session_id) VALUES(?) ON CONFLICT DO NOTHING").bind(session_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        sqlx::query("INSERT INTO queued_messages(id,session_id,caller,text,created_at) VALUES(?,?,?,?,?)")
            .bind(&id).bind(session_id).bind(caller).bind(text).bind(crate::now_iso()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        // Only references frozen into this submitted message are owned by it.
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM attachments WHERE session_id=? AND turn_id IS NULL AND queued_message_id IS NULL")
            .bind(session_id).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
        for attachment in ids {
            if text.contains(&format!("[attachment:{attachment}]")) || text.contains(&format!("\"snapshotId\":\"{attachment}\"")) {
                sqlx::query("UPDATE attachments SET queued_message_id=? WHERE id=?").bind(&id).bind(attachment).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            }
        }
        tx.commit().await.map_err(|e|e.to_string())?;
        // A failed UI notification must not turn durable acceptance into a retry.
        if let Err(error) = self.publish_queue(session_id).await { eprintln!("queue notification failed: {error}"); }
        Ok(id)
    }
    pub(super) async fn queue_operation(&self, caller: &str, session_id: &str, input: Value) -> Result<Value, String> {
        let _guard = self.session_operation(&format!("queue:{session_id}")).await;
        self.check_queue_owner(caller, session_id).await?;
        let action = input["action"].as_str().ok_or("invalid_input: queue action required")?;
        if action == "get" { return self.queue_snapshot(session_id).await; }
        let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
        if session.archived || session.state == "closed" { return Err("invalid_session: session is closed".into()); }
        match action {
            "followUp" | "steer" => {
                let text = input["message"].as_str().ok_or("invalid_input: message required")?;
                let id = self.enqueue_admitted(caller, session_id, text).await?;
                if action == "steer" {
                    // Enqueue is the acceptance boundary. Delivery feedback must
                    // not leave a second copy of this accepted message in drafts.
                    if let Err(error) = self.deliver_queued(caller, session_id, &id, true).await {
                        let status: Option<String> = sqlx::query_scalar("SELECT status FROM queued_messages WHERE id=?").bind(&id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?;
                        self.fail_queued(session_id, &id, &error, matches!(status.as_deref(), Some("sending" | "uncertain"))).await?;
                    }
                }
                else { self.schedule_queue(session_id.into()); }
            }
            "remove" | "clear" => {
                let id = if action == "remove" { Some(input["id"].as_str().ok_or("invalid_input: message id required")?) } else { None };
                let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
                // Sending rows have already been claimed and cannot be withdrawn.
                sqlx::query("DELETE FROM attachments WHERE turn_id IS NULL AND queued_message_id IN (SELECT id FROM queued_messages WHERE session_id=? AND status!='sending' AND (? IS NULL OR id=?))")
                    .bind(session_id).bind(id).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                sqlx::query("DELETE FROM queued_messages WHERE session_id=? AND status!='sending' AND (? IS NULL OR id=?)")
                    .bind(session_id).bind(id).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                tx.commit().await.map_err(|e|e.to_string())?;
            }
            "sendNow" => {
                let id = input["id"].as_str().ok_or("invalid_input: message id required")?;
                self.deliver_queued(caller, session_id, id, true).await?;
            }
            "resume" => {
                let uncertain: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM queued_messages WHERE session_id=? AND status='uncertain'").bind(session_id).fetch_one(&self.db).await.map_err(|e|e.to_string())?;
                if uncertain > 0 { return Err("请先核对并移除投递结果未知的消息。".into()); }
                sqlx::query("UPDATE queued_messages SET status='pending',delivery='turn',turn_id=NULL,error=NULL WHERE session_id=? AND status='failed'").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
                sqlx::query("UPDATE session_queues SET paused=0 WHERE session_id=?").bind(session_id).execute(&self.db).await.map_err(|e|e.to_string())?;
                self.schedule_queue(session_id.into());
            }
            _ => return Err("invalid_input: unknown queue action".into()),
        }
        self.publish_queue(session_id).await
    }
    async fn validate_queued_attachments(&self, session_id: &str, id: &str) -> Result<(), String> {
        let session = crate::session_by_id(&self.db, session_id).await.map_err(|e|e.to_string())?;
        let workspace = crate::workspace_by_id(&self.db, &session.workspace_id).await.map_err(|e|e.to_string())?;
        let root = std::fs::canonicalize(&workspace.path).map_err(|e|e.to_string())?;
        let rows = sqlx::query("SELECT path,content_hash,size,media_type,inline_context FROM attachments WHERE session_id=? AND queued_message_id=?")
            .bind(session_id).bind(id).fetch_all(&self.db).await.map_err(|e|e.to_string())?;
        for row in rows {
            if row.get::<Option<String>,_>("inline_context").is_some() { continue; }
            let path: String = row.get("path");
            if row.get::<String,_>("media_type").starts_with("image/") { return Err(format!("当前 Agent 不支持图片上下文：{path}")); }
            let target = crate::workspace_guard::canonicalize_target(&root, Path::new(&path))?;
            let metadata = std::fs::metadata(&target).map_err(|e|format!("附件不可用：{path}: {e}"))?;
            if row.get::<Option<i64>,_>("size").is_some_and(|size|metadata.is_dir() || size != metadata.len() as i64) { return Err(format!("附件大小已变化：{path}")); }
            if let Some(hash) = row.get::<Option<String>,_>("content_hash") {
                if metadata.len()>10*1024*1024 { return Err(format!("附件大小已变化：{path}")); }
                let bytes = std::fs::read(&target).map_err(|e|e.to_string())?;
                if format!("sha256:{:x}", Sha256::digest(bytes)) != hash { return Err(format!("附件内容已变化：{path}")); }
            }
        }
        Ok(())
    }
    async fn fail_queued(&self, session_id: &str, id: &str, error: &str, uncertain: bool) -> Result<(), String> {
        sqlx::query("UPDATE queued_messages SET status=?,error=? WHERE session_id=? AND id=?")
            .bind(if uncertain {"uncertain"} else {"failed"}).bind(error).bind(session_id).bind(id).execute(&self.db).await.map_err(|e|e.to_string())?;
        self.pause_queue(session_id).await?;
        self.publish_queue(session_id).await?;
        Ok(())
    }
    // Caller holds session admission across claim + delivery, serializing remove,
    // send-now, ordinary sends, cancellation and automatic FIFO dispatch.
    async fn deliver_queued(&self, caller: &str, session_id: &str, id: &str, immediate: bool) -> Result<(), String> {
        let row: Option<(String,String)> = sqlx::query_as("SELECT text,status FROM queued_messages WHERE id=? AND session_id=?")
            .bind(id).bind(session_id).fetch_optional(&self.db).await.map_err(|e|e.to_string())?;
        let Some((text,status)) = row else { return Err("invalid_input: queued message no longer exists".into()); };
        if status == "sending" { return Err("busy: message is already being sent".into()); }
        if status == "uncertain" { return Err("消息投递结果未知，请核对会话记录后删除该条，避免重复发送。".into()); }
        if let Err(error) = self.validate_queued_attachments(session_id, id).await {
            self.fail_queued(session_id, id, &error, false).await?; return Ok(());
        }
        // A finishing invocation may still be persisting history. Wait for its
        // lifecycle to release ownership before selecting steer versus start.
        let mut running = self.live.lock().await.get(session_id).cloned();
        if let Some(run) = &running {
            if matches!(*run.phase.borrow(), TurnPhase::Settling | TurnPhase::Finished) {
                let mut phase = run.phase.subscribe();
                while *phase.borrow_and_update() != TurnPhase::Finished { phase.changed().await.map_err(|_|"session lifecycle stopped")?; }
                running = None;
            }
        }
        if let Some(run) = running {
            if !immediate { return Ok(()); }
            if run.cancel.load(Ordering::Acquire) { return Err("busy: session is stopping".into()); }
            sqlx::query("UPDATE queued_messages SET status='sending',delivery='steer',turn_id=?,error=NULL WHERE id=?")
                .bind(&run.request_id).bind(id).execute(&self.db).await.map_err(|e|e.to_string())?;
            let result = self.invoke_provider_capability(caller, session_id, "queue.manage", json!({"action":"steer","message":text})).await;
            match result {
                Ok(_) => {
                    let now = crate::now_iso();
                    let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(|e|e.to_string())?;
                    sqlx::query("INSERT INTO messages(id,session_id,turn_id,role,content,status,created_at,updated_at) VALUES(?,?,?,'user',?,'completed',?,?)")
                        .bind(format!("queued:{id}")).bind(session_id).bind(&run.request_id).bind(&text).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    sqlx::query("UPDATE attachments SET turn_id=? WHERE queued_message_id=?").bind(&run.request_id).bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    sqlx::query("DELETE FROM queued_messages WHERE id=?").bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
                    tx.commit().await.map_err(|e|e.to_string())?;
                }
                Err(error) => {
                    // Only an explicit pre-dispatch or stale-turn rejection is
                    // safe to retry. A timeout may have reached the provider.
                    let stale = error.contains("no_active_turn") || error.contains("expectedTurnId") || error.contains("finished accepting interactions");
                    if stale {
                        sqlx::query("UPDATE queued_messages SET status='pending',turn_id=NULL WHERE id=?").bind(id).execute(&self.db).await.map_err(|e|e.to_string())?;
                        let mut phase = run.phase.subscribe();
                        tokio::time::timeout(Duration::from_secs(10), async {
                            while *phase.borrow_and_update() != TurnPhase::Finished { phase.changed().await.map_err(|_|"session lifecycle stopped")?; }
                            Ok::<_,String>(())
                        }).await.map_err(|_|"busy: session is still finishing")??;
                        if !run.cancel.load(Ordering::Acquire) { self.start_queued(caller, session_id, id, &text, immediate).await?; }
                    } else { self.fail_queued(session_id, id, &error, !error.contains("steer_rejected")).await?; }
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
        if let Err(error) = result { self.fail_queued(session_id, id, &error, false).await?; }
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
        let changed = sqlx::query("UPDATE queued_messages SET status='uncertain',error='未收到投递确认，请核对会话记录后处理。' WHERE session_id=? AND turn_id=? AND status='sending'")
            .bind(session_id).bind(turn_id).execute(&self.db).await.map_err(|e|e.to_string())?;
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
                if let Some((id,caller)) = row { host.deliver_queued(&caller, &session_id, &id, false).await?; host.publish_queue(&session_id).await?; }
                Ok::<_,String>(())
            }.await;
            if let Err(error) = result { eprintln!("queue dispatch failed: {error}"); let _ = host.pause_queue(&session_id).await; }
        });
        tokio::spawn(future);
    }
}
