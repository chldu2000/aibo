use super::{find_executable, now_iso, session_by_id, workspace_by_id};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, oneshot, Mutex},
    time,
};
use tracing::{debug, warn};
use ulid::Ulid;

const PI_ADAPTER_VERSION: &str = "phase3-pi-sdk-0.1.0";
const PI_HOST_PROTOCOL: &str = "aibo-pi-sdk-host.v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Error)]
pub enum PiError {
    #[error("node executable was not found on PATH")]
    MissingNode,
    #[error("Pi SDK host script was not found: {0}")]
    MissingHost(String),
    #[error("failed to start Pi SDK host: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("Pi SDK host process is not running")]
    ProcessClosed,
    #[error("Pi SDK host protocol error: {0}")]
    Protocol(String),
    #[error("Pi SDK host request failed: {0}")]
    Request(String),
    #[error("Pi SDK host request timed out after {REQUEST_TIMEOUT:?}: {0}")]
    Timeout(String),
    #[error("Pi session error: {0}")]
    Session(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventSource {
    agent: String,
    transport: String,
    adapter_version: String,
    agent_version: Option<String>,
    protocol_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentEvent {
    schema_version: String,
    event_id: String,
    generation_id: String,
    sequence: u64,
    occurred_at: String,
    source: EventSource,
    workspace_id: String,
    session_id: String,
    external_session_id: Option<String>,
    turn_id: Option<String>,
    #[serde(rename = "type")]
    event_type: String,
    correlation: Option<Value>,
    payload: Value,
    raw_ref: Option<String>,
}

struct PiClient {
    process: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    events: broadcast::Sender<Value>,
    closed: AtomicBool,
}

impl PiClient {
    async fn spawn(node: PathBuf, script: PathBuf, cwd: &Path) -> Result<Arc<Self>, PiError> {
        let mut process = Command::new(node)
            .arg(script)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(PiError::Spawn)?;
        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| PiError::Protocol("Pi host stdin was unavailable".to_owned()))?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| PiError::Protocol("Pi host stdout was unavailable".to_owned()))?;
        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| PiError::Protocol("Pi host stderr was unavailable".to_owned()))?;
        let (events, _) = broadcast::channel(512);
        let client = Arc::new(Self {
            process: Mutex::new(process),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            events,
            closed: AtomicBool::new(false),
        });
        let reader_client = Arc::clone(&client);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => reader_client.handle_line(&line).await,
                    Ok(None) => break,
                    Err(error) => {
                        let _ = reader_client.events.send(json!({
                            "method": "aibo/protocol-error",
                            "params": { "message": error.to_string() }
                        }));
                        break;
                    }
                }
            }
            reader_client.mark_closed("Pi SDK host stdout closed").await;
        });
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    debug!(target: "aibo::pi", message = %line, "Pi SDK host stderr");
                }
            }
        });
        Ok(client)
    }

    fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    async fn handle_line(&self, line: &str) {
        let message: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(error) => {
                let _ = self.events.send(json!({
                    "method": "aibo/protocol-error",
                    "params": { "message": error.to_string() }
                }));
                return;
            }
        };
        let is_response = message.get("id").is_some()
            && message.get("method").is_none()
            && (message.get("result").is_some() || message.get("error").is_some());
        if is_response {
            if let Some(id) = value_id(message.get("id").unwrap_or(&Value::Null)) {
                if let Some(sender) = self.pending.lock().await.remove(&id) {
                    if let Some(error) = message.get("error") {
                        let _ = sender.send(Err(error.to_string()));
                    } else {
                        let _ = sender.send(Ok(message));
                    }
                    return;
                }
            }
        }
        let _ = self.events.send(message);
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, PiError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(PiError::ProcessClosed);
        }
        let id = format!("aibo-pi-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), sender);
        if let Err(error) = self
            .write_message(json!({ "id": id, "method": method, "params": params }))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        match time::timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(response) => response
                .map_err(|_| PiError::ProcessClosed)?
                .map_err(PiError::Request),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(PiError::Timeout(method.to_owned()))
            }
        }
    }

    async fn write_message(&self, message: Value) -> Result<(), PiError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(PiError::ProcessClosed);
        }
        let mut stdin = self.stdin.lock().await;
        let line =
            serde_json::to_vec(&message).map_err(|error| PiError::Protocol(error.to_string()))?;
        stdin
            .write_all(&line)
            .await
            .map_err(|_| PiError::ProcessClosed)?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|_| PiError::ProcessClosed)?;
        stdin.flush().await.map_err(|_| PiError::ProcessClosed)
    }

    async fn mark_closed(&self, reason: &str) {
        if !self.closed.swap(true, Ordering::SeqCst) {
            let mut pending = self.pending.lock().await;
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(reason.to_owned()));
            }
            let _ = self
                .events
                .send(json!({ "method": "aibo/process-exited", "params": { "reason": reason } }));
        }
    }

    async fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        for (_, sender) in self.pending.lock().await.drain() {
            let _ = sender.send(Err("Pi adapter closed".to_owned()));
        }
        let _ = self.stdin.lock().await.shutdown().await;
        let mut process = self.process.lock().await;
        let _ = process.kill().await;
        let _ = process.wait().await;
    }
}

fn value_id(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn text_from_message(value: &Value) -> String {
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        return text.to_owned();
    }
    value
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("")
}

fn session_id_from_start(value: &Value) -> Option<String> {
    value
        .pointer("/result/sessionId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn event_params(message: &Value) -> Option<(&str, &Value)> {
    let method = message.get("method").and_then(Value::as_str)?;
    Some((method, message.get("params").unwrap_or(&Value::Null)))
}

struct PiSession {
    app: AppHandle,
    db: SqlitePool,
    client: Arc<PiClient>,
    session_id: String,
    workspace_id: String,
    generation_id: String,
    external_session_id: Mutex<Option<String>>,
    current_turn_id: Mutex<Option<String>>,
    current_message_id: Mutex<Option<String>>,
    state: Mutex<String>,
    sequence: AtomicU64,
    active: AtomicBool,
}

impl PiSession {
    fn new(
        app: AppHandle,
        db: SqlitePool,
        client: Arc<PiClient>,
        session_id: String,
        workspace_id: String,
        generation_id: String,
    ) -> Arc<Self> {
        Arc::new(Self {
            app,
            db,
            client,
            session_id,
            workspace_id,
            generation_id,
            external_session_id: Mutex::new(None),
            current_turn_id: Mutex::new(None),
            current_message_id: Mutex::new(None),
            state: Mutex::new("starting".to_owned()),
            sequence: AtomicU64::new(0),
            active: AtomicBool::new(true),
        })
    }

    fn start_event_loop(self: &Arc<Self>) {
        let session = Arc::clone(self);
        let mut receiver = self.client.subscribe();
        tokio::spawn(async move {
            loop {
                match receiver.recv().await {
                    Ok(message) => {
                        if let Err(error) = session.handle_event(message).await {
                            warn!(session_id = %session.session_id, error = %error, "Pi event handling failed");
                        }
                        if session.client.closed.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(count)) => {
                        warn!(session_id = %session.session_id, count, "Pi event receiver lagged")
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    async fn handle_event(&self, message: Value) -> Result<(), PiError> {
        if !self.active.load(Ordering::SeqCst) || !self.is_current_generation().await? {
            return Ok(());
        }
        let Some((method, params)) = event_params(&message) else {
            return Ok(());
        };
        if method == "aibo/event" {
            let event = params.get("event").cloned().unwrap_or_else(|| json!({}));
            let turn_id = params
                .get("turnId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            return self.handle_sdk_event(&event, turn_id).await;
        }
        match method {
            "aibo/process-exited" => {
                self.set_state("interrupted").await?;
                self.emit_event(
                    "adapter.crashed",
                    None,
                    json!({ "reason": params.get("reason") }),
                    None,
                )
                .await?;
            }
            "aibo/protocol-error" => {
                self.emit_event(
                    "adapter.warning",
                    None,
                    json!({ "message": params.get("message") }),
                    None,
                )
                .await?
            }
            _ => {}
        }
        Ok(())
    }

    async fn handle_sdk_event(
        &self,
        event: &Value,
        event_turn_id: Option<String>,
    ) -> Result<(), PiError> {
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let turn_id = event_turn_id.or_else(|| futures_turn_id_placeholder(self));
        match event_type {
            "agent_start" => {
                let turn = turn_id.clone().ok_or_else(|| {
                    PiError::Session("Pi event did not include a turn binding".to_owned())
                })?;
                self.ensure_turn(&turn, "").await?;
                *self.current_turn_id.lock().await = Some(turn.clone());
                *self.current_message_id.lock().await = None;
                self.set_state("running").await?;
                self.emit_event(
                    "turn.started",
                    Some(turn),
                    json!({ "status": "running" }),
                    None,
                )
                .await?;
            }
            "message_start" => {
                if event.pointer("/message/role").and_then(Value::as_str) == Some("assistant") {
                    *self.current_message_id.lock().await = Some(format!("pi-msg:{}", Ulid::new()));
                }
            }
            "message_update" => {
                let update = event
                    .get("assistantMessageEvent")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                if let Some(usage) = event.get("usage") {
                    self.emit_event(
                        "usage.updated",
                        turn_id.clone(),
                        json!({ "usage": usage }),
                        None,
                    )
                    .await?;
                }
                if update.get("type").and_then(Value::as_str) == Some("text_delta") {
                    let delta = update
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        let turn = turn_id.clone().ok_or_else(|| {
                            PiError::Session(
                                "Pi text event did not include a turn binding".to_owned(),
                            )
                        })?;
                        let internal_turn = self.ensure_turn(&turn, "").await?;
                        let message_id = self
                            .current_message_id
                            .lock()
                            .await
                            .clone()
                            .unwrap_or_else(|| format!("pi-msg:{}", Ulid::new()));
                        *self.current_message_id.lock().await = Some(message_id.clone());
                        self.upsert_assistant_delta(&message_id, &internal_turn, delta)
                            .await?;
                        self.emit_event(
                            "message.delta",
                            Some(turn),
                            json!({ "itemId": message_id, "delta": delta }),
                            Some(json!({ "itemId": message_id })),
                        )
                        .await?;
                    }
                }
            }
            "message_end" => {
                if event.pointer("/message/role").and_then(Value::as_str) == Some("assistant") {
                    let text = text_from_message(event.get("message").unwrap_or(&Value::Null));
                    if let Some(turn) = turn_id.as_deref() {
                        let internal = self.ensure_turn(turn, "").await?;
                        let message_id = self
                            .current_message_id
                            .lock()
                            .await
                            .clone()
                            .unwrap_or_else(|| format!("pi-msg:{}", Ulid::new()));
                        *self.current_message_id.lock().await = Some(message_id.clone());
                        self.complete_assistant(&message_id, &internal, &text)
                            .await?;
                    }
                }
            }
            "turn_end" => {
                if let Some(turn) = turn_id.as_deref() {
                    let internal = self.ensure_turn(turn, "").await?;
                    let message = event.get("message").unwrap_or(&Value::Null);
                    let text = text_from_message(message);
                    let status = match message
                        .get("stopReason")
                        .and_then(Value::as_str)
                        .unwrap_or("stop")
                    {
                        "aborted" | "cancelled" | "canceled" => "interrupted",
                        "stop" | "completed" => "completed",
                        _ => "failed",
                    };
                    sqlx::query("UPDATE turns SET status = ?, output_text = ?, completed_at = ? WHERE id = ?")
                        .bind(status).bind(&text).bind(now_iso()).bind(&internal).execute(&self.db).await?;
                    sqlx::query("UPDATE messages SET status = ?, updated_at = ? WHERE session_id = ? AND turn_id = ? AND role = 'assistant'")
                        .bind(status).bind(now_iso()).bind(&self.session_id).bind(&internal).execute(&self.db).await?;
                    self.set_state(if status == "completed" {
                        "idle"
                    } else {
                        status
                    })
                    .await?;
                    self.emit_event(
                        "message.completed",
                        Some(turn.to_owned()),
                        json!({ "text": text, "status": status }),
                        None,
                    )
                    .await?;
                    self.emit_event(
                        "turn.completed",
                        Some(turn.to_owned()),
                        json!({ "status": status }),
                        None,
                    )
                    .await?;
                    *self.current_turn_id.lock().await = None;
                    *self.current_message_id.lock().await = None;
                }
            }
            "agent_error" => {
                if let Some(turn) = turn_id.as_deref() {
                    let internal = self.ensure_turn(turn, "").await?;
                    sqlx::query(
                        "UPDATE turns SET status = 'failed', completed_at = ? WHERE id = ?",
                    )
                    .bind(now_iso())
                    .bind(&internal)
                    .execute(&self.db)
                    .await?;
                    sqlx::query("UPDATE messages SET status = 'failed', updated_at = ? WHERE session_id = ? AND turn_id = ? AND role = 'assistant'")
                        .bind(now_iso())
                        .bind(&self.session_id)
                        .bind(&internal)
                        .execute(&self.db)
                        .await?;
                }
                *self.current_turn_id.lock().await = None;
                self.set_state("failed").await?;
                self.emit_event(
                    "turn.failed",
                    turn_id,
                    json!({ "error": event.get("error") }),
                    None,
                )
                .await?;
            }
            "tool_execution_start" | "tool_execution_update" | "tool_execution_end" => {
                self.handle_tool_event(event_type, event, turn_id).await?;
            }
            "queue_update" => {
                self.emit_event(
                    "queue.updated",
                    turn_id,
                    json!({
                        "steering": event.get("steering").cloned().unwrap_or_else(|| json!([])),
                        "followUp": event.get("followUp").cloned().unwrap_or_else(|| json!([])),
                    }),
                    None,
                )
                .await?;
            }
            "compaction_start" => {
                let reason = event
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                self.append_system_notice(
                    turn_id.as_deref(),
                    format!("Pi 上下文压缩开始（{reason}）"),
                    "completed",
                )
                .await?;
                self.emit_event(
                    "compaction.started",
                    turn_id,
                    json!({ "reason": event.get("reason") }),
                    None,
                )
                .await?;
            }
            "compaction_end" => {
                let result = event.get("result").cloned().unwrap_or(Value::Null);
                let aborted = event
                    .get("aborted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let error_message = event.get("errorMessage").and_then(Value::as_str);
                let reason = event
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let content = if aborted {
                    format!("Pi 上下文压缩已取消（{reason}）")
                } else if let Some(error) = error_message {
                    format!("Pi 上下文压缩失败（{reason}）：{error}")
                } else {
                    format!("Pi 上下文压缩完成（{reason}）")
                };
                self.append_system_notice(
                    turn_id.as_deref(),
                    content,
                    if error_message.is_some() {
                        "failed"
                    } else {
                        "completed"
                    },
                )
                .await?;
                self.emit_event(
                    "compaction.completed",
                    turn_id,
                    json!({
                        "reason": event.get("reason"),
                        "aborted": event.get("aborted").and_then(Value::as_bool).unwrap_or(false),
                        "willRetry": event.get("willRetry").and_then(Value::as_bool).unwrap_or(false),
                        "errorMessage": event.get("errorMessage"),
                        "result": result,
                    }),
                    None,
                )
                .await?;
            }
            "auto_retry_start" => {
                let attempt = event.get("attempt").and_then(Value::as_u64).unwrap_or(0);
                let max_attempts = event
                    .get("maxAttempts")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.append_system_notice(
                    turn_id.as_deref(),
                    format!("Pi 正在重试模型请求（{attempt}/{max_attempts}）"),
                    "completed",
                )
                .await?;
                self.emit_event(
                    "retry.started",
                    turn_id,
                    json!({
                        "kind": "agent",
                        "attempt": event.get("attempt"),
                        "maxAttempts": event.get("maxAttempts"),
                        "delayMs": event.get("delayMs"),
                        "errorMessage": event.get("errorMessage"),
                    }),
                    None,
                )
                .await?;
            }
            "auto_retry_end" => {
                let success = event
                    .get("success")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.append_system_notice(
                    turn_id.as_deref(),
                    if success {
                        "Pi 模型请求重试成功".to_owned()
                    } else {
                        format!(
                            "Pi 模型请求重试结束：{}",
                            event
                                .get("finalError")
                                .and_then(Value::as_str)
                                .unwrap_or("失败")
                        )
                    },
                    if success { "completed" } else { "failed" },
                )
                .await?;
                self.emit_event(
                    "retry.completed",
                    turn_id,
                    json!({
                        "kind": "agent",
                        "success": event.get("success").and_then(Value::as_bool).unwrap_or(false),
                        "attempt": event.get("attempt"),
                        "finalError": event.get("finalError"),
                    }),
                    None,
                )
                .await?;
            }
            "summarization_retry_scheduled" => {
                let attempt = event.get("attempt").and_then(Value::as_u64).unwrap_or(0);
                let max_attempts = event
                    .get("maxAttempts")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.append_system_notice(
                    turn_id.as_deref(),
                    format!("Pi 摘要生成将在稍后重试（{attempt}/{max_attempts}）"),
                    "completed",
                )
                .await?;
                self.emit_event(
                    "retry.started",
                    turn_id,
                    json!({
                        "kind": "summarization",
                        "phase": "scheduled",
                        "attempt": event.get("attempt"),
                        "maxAttempts": event.get("maxAttempts"),
                        "delayMs": event.get("delayMs"),
                        "errorMessage": event.get("errorMessage"),
                    }),
                    None,
                )
                .await?;
            }
            "summarization_retry_attempt_start" => {
                self.append_system_notice(
                    turn_id.as_deref(),
                    "Pi 摘要生成重试开始".to_owned(),
                    "completed",
                )
                .await?;
                self.emit_event(
                    "retry.started",
                    turn_id,
                    json!({
                        "kind": "summarization",
                        "phase": "attempt_start",
                        "source": event.get("source"),
                        "reason": event.get("reason"),
                    }),
                    None,
                )
                .await?;
            }
            "summarization_retry_finished" => {
                self.append_system_notice(
                    turn_id.as_deref(),
                    "Pi 摘要生成重试结束".to_owned(),
                    "completed",
                )
                .await?;
                self.emit_event(
                    "retry.completed",
                    turn_id,
                    json!({ "kind": "summarization", "phase": "finished" }),
                    None,
                )
                .await?;
            }
            "session_info_changed" => {
                self.emit_event(
                    "session.info_changed",
                    turn_id,
                    json!({ "name": event.get("name") }),
                    None,
                )
                .await?;
            }
            "entry_appended" => {
                let custom_type = event
                    .pointer("/entry/customType")
                    .and_then(Value::as_str)
                    .unwrap_or("custom");
                self.append_system_notice(
                    turn_id.as_deref(),
                    format!("Pi 扩展记录已更新（{custom_type}）"),
                    "completed",
                )
                .await?;
                self.emit_event(
                    "extension.updated",
                    turn_id,
                    json!({ "entry": event.get("entry") }),
                    None,
                )
                .await?;
            }
            "thinking_level_changed" => {
                self.emit_event(
                    "session.info_changed",
                    turn_id,
                    json!({ "thinkingLevel": event.get("level") }),
                    None,
                )
                .await?;
            }
            _ => {}
        }
        Ok(())
    }

    async fn initialize(
        &self,
        cwd: &str,
        session_dir: &Path,
        external_id: Option<&str>,
    ) -> Result<String, PiError> {
        let response = self
            .client
            .request(
                "start",
                json!({ "cwd": cwd, "sessionDir": session_dir, "sessionId": external_id }),
            )
            .await?;
        session_id_from_start(&response).ok_or_else(|| {
            PiError::Protocol("Pi host start did not return a session id".to_owned())
        })
    }

    async fn is_current_generation(&self) -> Result<bool, PiError> {
        let generation: Option<String> =
            sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id = ?")
                .bind(&self.session_id)
                .fetch_optional(&self.db)
                .await?
                .flatten();
        Ok(generation_matches(
            generation.as_deref(),
            self.generation_id.as_str(),
        ))
    }

    async fn set_external_id(&self, external_id: String) {
        *self.external_session_id.lock().await = Some(external_id);
    }

    async fn ensure_turn(
        &self,
        external_turn_id: &str,
        input_text: &str,
    ) -> Result<String, PiError> {
        if let Some(id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM turns WHERE session_id = ? AND external_turn_id = ?",
        )
        .bind(&self.session_id)
        .bind(external_turn_id)
        .fetch_optional(&self.db)
        .await?
        {
            if !input_text.is_empty() {
                sqlx::query("UPDATE turns SET input_text = CASE WHEN input_text = '' THEN ? ELSE input_text END WHERE id = ?")
                    .bind(input_text).bind(&id).execute(&self.db).await?;
            }
            return Ok(id);
        }
        let id = Ulid::new().to_string();
        sqlx::query("INSERT OR IGNORE INTO turns (id, session_id, external_turn_id, status, input_text, started_at) VALUES (?, ?, ?, 'running', ?, ?)")
            .bind(&id).bind(&self.session_id).bind(external_turn_id).bind(input_text).bind(now_iso()).execute(&self.db).await?;
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT id FROM turns WHERE session_id = ? AND external_turn_id = ?",
        )
        .bind(&self.session_id)
        .bind(external_turn_id)
        .fetch_one(&self.db)
        .await?)
    }

    async fn upsert_assistant_delta(
        &self,
        external_id: &str,
        turn_id: &str,
        delta: &str,
    ) -> Result<(), PiError> {
        let now = now_iso();
        let updated = sqlx::query("UPDATE messages SET content = content || ?, turn_id = ?, status = 'streaming', updated_at = ? WHERE session_id = ? AND external_message_id = ?")
            .bind(delta).bind(turn_id).bind(&now).bind(&self.session_id).bind(external_id).execute(&self.db).await?;
        if updated.rows_affected() == 0 {
            sqlx::query("INSERT INTO messages (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at) VALUES (?, ?, ?, ?, 'assistant', ?, 'streaming', ?, ?, ?)")
                .bind(Ulid::new().to_string()).bind(&self.session_id).bind(turn_id).bind(external_id).bind(delta)
                .bind(self.sequence.load(Ordering::Relaxed) as i64).bind(&now).bind(&now).execute(&self.db).await?;
        }
        Ok(())
    }

    async fn complete_assistant(
        &self,
        external_id: &str,
        turn_id: &str,
        text: &str,
    ) -> Result<(), PiError> {
        let now = now_iso();
        let updated = sqlx::query("UPDATE messages SET content = CASE WHEN ? <> '' THEN ? ELSE content END, turn_id = ?, status = 'completed', updated_at = ? WHERE session_id = ? AND external_message_id = ? AND role = 'assistant'")
            .bind(text).bind(text).bind(turn_id).bind(&now).bind(&self.session_id).bind(external_id).execute(&self.db).await?;
        if updated.rows_affected() == 0 && !text.is_empty() {
            sqlx::query("INSERT INTO messages (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at) VALUES (?, ?, ?, ?, 'assistant', ?, 'completed', ?, ?, ?)")
                .bind(Ulid::new().to_string()).bind(&self.session_id).bind(turn_id).bind(external_id).bind(text)
                .bind(self.sequence.load(Ordering::Relaxed) as i64).bind(&now).bind(&now).execute(&self.db).await?;
        }
        Ok(())
    }

    async fn append_system_notice(
        &self,
        turn_id: Option<&str>,
        content: impl Into<String>,
        status: &str,
    ) -> Result<(), PiError> {
        let internal_turn = if let Some(turn) = turn_id {
            Some(self.ensure_turn(turn, "").await?)
        } else {
            None
        };
        let id = Ulid::new().to_string();
        let now = now_iso();
        sqlx::query("INSERT INTO messages (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at) VALUES (?, ?, ?, ?, 'system', ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&self.session_id)
            .bind(internal_turn)
            .bind(format!("pi-system:{id}"))
            .bind(content.into())
            .bind(status)
            .bind(self.sequence.load(Ordering::Relaxed) as i64)
            .bind(&now)
            .bind(&now)
            .execute(&self.db)
            .await?;
        Ok(())
    }

    async fn handle_tool_event(
        &self,
        kind: &str,
        event: &Value,
        turn_id: Option<String>,
    ) -> Result<(), PiError> {
        let item_id = event
            .get("toolCallId")
            .and_then(Value::as_str)
            .or_else(|| event.get("id").and_then(Value::as_str))
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("pi-tool:{}", Ulid::new()));
        let tool_name = event
            .get("toolName")
            .and_then(Value::as_str)
            .or_else(|| event.get("name").and_then(Value::as_str))
            .unwrap_or("tool");
        let status = if kind == "tool_execution_end" {
            if event
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                "failed"
            } else {
                "completed"
            }
        } else {
            "streaming"
        };
        let summary = event
            .get("result")
            .map(|value| value.to_string())
            .or_else(|| event.get("args").map(|value| value.to_string()))
            .unwrap_or_else(|| tool_name.to_owned());
        let internal_turn = if let Some(turn) = turn_id.as_deref() {
            Some(self.ensure_turn(turn, "").await?)
        } else {
            None
        };
        let now = now_iso();
        let updated = sqlx::query("UPDATE messages SET content = CASE WHEN ? = 1 OR content = '' THEN ? ELSE content END, turn_id = COALESCE(?, turn_id), status = ?, updated_at = ? WHERE session_id = ? AND external_message_id = ? AND role = 'tool'")
            .bind(if kind == "tool_execution_start" { 1_i64 } else { 0_i64 }).bind(&summary).bind(internal_turn.as_deref()).bind(status).bind(&now).bind(&self.session_id).bind(&item_id).execute(&self.db).await?;
        if updated.rows_affected() == 0 {
            sqlx::query("INSERT INTO messages (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at) VALUES (?, ?, ?, ?, 'tool', ?, ?, ?, ?, ?)")
                .bind(Ulid::new().to_string()).bind(&self.session_id).bind(internal_turn).bind(&item_id).bind(&summary).bind(status)
                .bind(self.sequence.load(Ordering::Relaxed) as i64).bind(&now).bind(&now).execute(&self.db).await?;
        }
        let event_name = match kind {
            "tool_execution_start" => "tool.started",
            "tool_execution_end" => "tool.completed",
            _ => "tool.updated",
        };
        self.emit_event(event_name, turn_id, json!({ "itemId": item_id, "itemType": tool_name, "status": status, "summary": summary }), Some(json!({ "itemId": item_id }))).await
    }

    async fn set_state(&self, next: &str) -> Result<(), PiError> {
        let mut state = self.state.lock().await;
        if state.as_str() == next {
            return Ok(());
        }
        *state = next.to_owned();
        sqlx::query("UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?")
            .bind(next)
            .bind(now_iso())
            .bind(&self.session_id)
            .execute(&self.db)
            .await?;
        drop(state);
        self.emit_event(
            "session.state_changed",
            None,
            json!({ "state": next }),
            None,
        )
        .await
    }

    async fn emit_event(
        &self,
        event_type: &str,
        turn_id: Option<String>,
        payload: Value,
        correlation: Option<Value>,
    ) -> Result<(), PiError> {
        let event = AgentEvent {
            schema_version: "1.0".to_owned(),
            event_id: Ulid::new().to_string(),
            generation_id: self.generation_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            occurred_at: now_iso(),
            source: EventSource {
                agent: "pi".to_owned(),
                transport: "pi-sdk".to_owned(),
                adapter_version: PI_ADAPTER_VERSION.to_owned(),
                agent_version: Some("0.84.4".to_owned()),
                protocol_version: Some(PI_HOST_PROTOCOL.to_owned()),
            },
            workspace_id: self.workspace_id.clone(),
            session_id: self.session_id.clone(),
            external_session_id: self.external_session_id.lock().await.clone(),
            turn_id,
            event_type: event_type.to_owned(),
            correlation,
            payload,
            raw_ref: None,
        };
        sqlx::query("INSERT INTO agent_events (event_id, session_id, generation_id, sequence, occurred_at, event_type, turn_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&event.event_id).bind(&event.session_id).bind(&event.generation_id).bind(event.sequence as i64).bind(&event.occurred_at).bind(&event.event_type).bind(&event.turn_id)
            .bind(serde_json::to_string(&event.payload).unwrap_or_else(|_| "{}".to_owned())).execute(&self.db).await?;
        if let Err(error) = self.app.emit("agent-event", event) {
            warn!(session_id = %self.session_id, error = %error, "unable to emit Pi event to UI");
        }
        Ok(())
    }

    fn deactivate(&self) {
        self.active.store(false, Ordering::SeqCst);
    }
}

// The host attaches a synthetic turn id to all SDK events. This fallback is
// useful for late events emitted immediately after the host clears that id.
fn futures_turn_id_placeholder(session: &PiSession) -> Option<String> {
    session
        .current_turn_id
        .try_lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn generation_matches(binding_generation: Option<&str>, current_generation: &str) -> bool {
    binding_generation == Some(current_generation)
}

#[derive(Clone)]
pub(crate) struct PiManager {
    app: AppHandle,
    db: SqlitePool,
    sessions: Arc<Mutex<HashMap<String, Arc<PiSession>>>>,
    session_root: PathBuf,
}

impl PiManager {
    pub(crate) fn new(app: AppHandle, db: SqlitePool, data_dir: PathBuf) -> Self {
        Self {
            app,
            db,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            session_root: data_dir.join("pi-sessions"),
        }
    }

    fn host_script(app: &AppHandle) -> Result<PathBuf, PiError> {
        let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pi-sdk-host.mjs");
        if source_path.is_file() {
            return Ok(source_path);
        }
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled_path = resource_dir.join("pi-sdk-host.mjs");
            if bundled_path.is_file() {
                return Ok(bundled_path);
            }
        }
        Err(PiError::MissingHost(source_path.display().to_string()))
    }

    async fn spawn_runtime(
        &self,
        session_id: &str,
        workspace_id: &str,
        workspace_path: &str,
        external_id: Option<&str>,
    ) -> Result<Arc<PiSession>, PiError> {
        let node = find_executable("node").ok_or(PiError::MissingNode)?;
        let script = Self::host_script(&self.app)?;
        let session_dir = self.session_root.join(workspace_id);
        tokio::fs::create_dir_all(&session_dir)
            .await
            .map_err(PiError::Spawn)?;
        let generation_id = Ulid::new().to_string();
        let client = PiClient::spawn(node, script, Path::new(workspace_path)).await?;
        let runtime = PiSession::new(
            self.app.clone(),
            self.db.clone(),
            client.clone(),
            session_id.to_owned(),
            workspace_id.to_owned(),
            generation_id.clone(),
        );
        self.sessions
            .lock()
            .await
            .insert(session_id.to_owned(), runtime.clone());
        runtime.start_event_loop();
        let started = match runtime
            .initialize(workspace_path, &session_dir, external_id)
            .await
        {
            Ok(started) => started,
            Err(error) => {
                runtime.deactivate();
                self.sessions.lock().await.remove(session_id);
                client.close().await;
                return Err(error);
            }
        };
        runtime.set_external_id(started.clone()).await;
        if let Err(error) = sqlx::query("UPDATE session_bindings SET external_session_id = ?, generation_id = ?, adapter_version = ?, bound_at = ? WHERE session_id = ?")
            .bind(&started)
            .bind(&generation_id)
            .bind(PI_ADAPTER_VERSION)
            .bind(now_iso())
            .bind(session_id)
            .execute(&self.db)
            .await
        {
            runtime.deactivate();
            self.sessions.lock().await.remove(session_id);
            client.close().await;
            return Err(PiError::Database(error));
        }
        if let Err(error) = runtime
            .emit_event("session.started", None, json!({ "externalSessionId": started, "capabilities": ["streaming", "abort", "session-tree", "session-tree-navigation", "session-snapshot", "read-only-tools"], "sandbox": "none" }), None)
            .await
        {
            runtime.deactivate();
            self.sessions.lock().await.remove(session_id);
            client.close().await;
            return Err(error);
        }
        runtime.set_state("idle").await?;
        Ok(runtime)
    }

    pub(crate) async fn create_session(
        &self,
        workspace_id: &str,
    ) -> Result<super::Session, PiError> {
        let workspace = workspace_by_id(&self.db, workspace_id)
            .await
            .map_err(|error| PiError::Session(error.to_string()))?;
        let session_id = Ulid::new().to_string();
        let generation_id = Ulid::new().to_string();
        let now = now_iso();
        sqlx::query("INSERT INTO sessions (id, workspace_id, agent, label, state, created_at, updated_at) VALUES (?, ?, 'pi', ?, 'starting', ?, ?)")
            .bind(&session_id).bind(workspace_id).bind(format!("Pi · {}", workspace.label)).bind(&now).bind(&now).execute(&self.db).await?;
        sqlx::query("INSERT INTO session_bindings (session_id, external_session_id, generation_id, adapter_version, bound_at) VALUES (?, NULL, ?, ?, ?)")
            .bind(&session_id).bind(&generation_id).bind(PI_ADAPTER_VERSION).bind(&now).execute(&self.db).await?;
        if let Err(error) = self
            .spawn_runtime(&session_id, workspace_id, &workspace.path, None)
            .await
        {
            let _ =
                sqlx::query("UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?")
                    .bind(now_iso())
                    .bind(&session_id)
                    .execute(&self.db)
                    .await;
            return Err(error);
        }
        session_by_id(&self.db, &session_id)
            .await
            .map_err(|error| PiError::Session(error.to_string()))
    }

    async fn ensure_runtime(&self, session_id: &str) -> Result<Arc<PiSession>, PiError> {
        if let Some(session) = self.sessions.lock().await.get(session_id).cloned() {
            if !session.client.closed.load(Ordering::SeqCst) {
                return Ok(session);
            }
            self.sessions.lock().await.remove(session_id);
        }
        let session = session_by_id(&self.db, session_id)
            .await
            .map_err(|error| PiError::Session(error.to_string()))?;
        if session.agent != "pi" {
            return Err(PiError::Session("session is not a Pi session".to_owned()));
        }
        if session.archived {
            return Err(PiError::Session(
                "archived Pi session must be unarchived before use".to_owned(),
            ));
        }
        let external_id: Option<String> = sqlx::query_scalar(
            "SELECT external_session_id FROM session_bindings WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_optional(&self.db)
        .await?
        .flatten();
        let workspace_path: String = sqlx::query_scalar("SELECT path FROM workspaces WHERE id = ?")
            .bind(&session.workspace_id)
            .fetch_one(&self.db)
            .await?;
        self.spawn_runtime(
            session_id,
            &session.workspace_id,
            &workspace_path,
            external_id.as_deref(),
        )
        .await
    }

    pub(crate) async fn send_prompt(&self, session_id: &str, input: &str) -> Result<(), PiError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(PiError::Session("prompt must not be empty".to_owned()));
        }
        let session = self.ensure_runtime(session_id).await?;
        if matches!(
            session.state.lock().await.as_str(),
            "running" | "waiting_approval"
        ) {
            return Err(PiError::Session(
                "Pi session already has an active turn".to_owned(),
            ));
        }
        let turn_id = format!("pi-turn:{}", Ulid::new());
        let user_message_id = Ulid::new().to_string();
        let now = now_iso();
        sqlx::query("INSERT INTO messages (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at) VALUES (?, ?, NULL, ?, 'user', ?, 'completed', ?, ?, ?)")
            .bind(&user_message_id).bind(session_id).bind(format!("user:{user_message_id}")).bind(input).bind(session.sequence.load(Ordering::Relaxed) as i64).bind(&now).bind(&now).execute(&self.db).await?;
        let internal_turn = session.ensure_turn(&turn_id, input).await?;
        sqlx::query("UPDATE messages SET turn_id = ?, updated_at = ? WHERE id = ?")
            .bind(&internal_turn)
            .bind(now_iso())
            .bind(&user_message_id)
            .execute(&self.db)
            .await?;
        *session.current_turn_id.lock().await = Some(turn_id.clone());
        session.set_state("running").await?;
        if let Err(error) = session
            .client
            .request("prompt", json!({ "text": input, "turnId": turn_id }))
            .await
        {
            let _ = session.set_state("failed").await;
            return Err(error);
        }
        Ok(())
    }

    async fn enqueue_message(
        &self,
        session_id: &str,
        input: &str,
        mode: &str,
    ) -> Result<(), PiError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(PiError::Session(
                "queued prompt must not be empty".to_owned(),
            ));
        }
        let session = self.ensure_runtime(session_id).await?;
        if !matches!(session.state.lock().await.as_str(), "running") {
            return Err(PiError::Session(format!(
                "Pi {mode} requires an active turn"
            )));
        }
        let external_turn = session
            .current_turn_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| PiError::Session("Pi session has no active turn".to_owned()))?;
        let internal_turn = session.ensure_turn(&external_turn, "").await?;
        let user_message_id = Ulid::new().to_string();
        let now = now_iso();
        sqlx::query("INSERT INTO messages (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', ?, 'completed', ?, ?, ?)")
            .bind(&user_message_id)
            .bind(session_id)
            .bind(&internal_turn)
            .bind(format!("user:{user_message_id}"))
            .bind(input)
            .bind(session.sequence.load(Ordering::Relaxed) as i64)
            .bind(&now)
            .bind(&now)
            .execute(&self.db)
            .await?;
        let result = session.client.request(mode, json!({ "text": input })).await;
        if result.is_err() {
            // The host can finish between the state check and the request.
            // Do not leave a queued user message behind when the SDK rejects
            // that race or the host has already exited.
            let _ = sqlx::query("DELETE FROM messages WHERE id = ?")
                .bind(&user_message_id)
                .execute(&self.db)
                .await;
        }
        result.map(|_| ())
    }

    pub(crate) async fn steer(&self, session_id: &str, input: &str) -> Result<(), PiError> {
        self.enqueue_message(session_id, input, "steer").await
    }

    pub(crate) async fn follow_up(&self, session_id: &str, input: &str) -> Result<(), PiError> {
        self.enqueue_message(session_id, input, "followUp").await
    }

    pub(crate) async fn tree(&self, session_id: &str) -> Result<Value, PiError> {
        let session = self.ensure_runtime(session_id).await?;
        let response = session.client.request("tree", json!({})).await?;
        let result = response.get("result").cloned().unwrap_or_else(|| json!({}));
        let tree = result
            .get("tree")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PiError::Protocol("Pi host tree did not return a tree array".to_owned())
            })?;
        Ok(json!({
            "sessionId": session.session_id,
            "externalSessionId": session.external_session_id.lock().await.clone(),
            "leafId": result.get("leafId").cloned().unwrap_or(Value::Null),
            "tree": tree,
        }))
    }

    pub(crate) async fn navigate_tree(
        &self,
        session_id: &str,
        entry_id: &str,
    ) -> Result<Value, PiError> {
        let entry_id = entry_id.trim();
        if entry_id.is_empty() {
            return Err(PiError::Session(
                "Pi tree entry id must not be empty".to_owned(),
            ));
        }
        let session = self.ensure_runtime(session_id).await?;
        if session.current_turn_id.lock().await.is_some()
            || !matches!(session.state.lock().await.as_str(), "idle")
        {
            return Err(PiError::Session(
                "Pi session tree navigation requires an idle session".to_owned(),
            ));
        }
        let response = session
            .client
            .request("navigateTree", json!({ "entryId": entry_id }))
            .await?;
        let navigation = response.get("result").cloned().unwrap_or_else(|| json!({}));
        let snapshot = self.tree(session_id).await?;
        Ok(json!({
            "cancelled": navigation.get("cancelled").and_then(Value::as_bool).unwrap_or(false),
            "editorText": navigation.get("editorText").cloned().unwrap_or(Value::Null),
            "sessionId": snapshot.get("sessionId"),
            "externalSessionId": snapshot.get("externalSessionId"),
            "leafId": snapshot.get("leafId"),
            "tree": snapshot.get("tree"),
        }))
    }

    pub(crate) async fn snapshot(&self, session_id: &str) -> Result<Value, PiError> {
        let session = self.ensure_runtime(session_id).await?;
        let response = session.client.request("snapshot", json!({})).await?;
        let result = response.get("result").cloned().unwrap_or_else(|| json!({}));
        let tree = result
            .get("tree")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PiError::Protocol("Pi host snapshot did not return a tree".to_owned())
            })?;
        let branch = result
            .get("branch")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PiError::Protocol("Pi host snapshot did not return a branch".to_owned())
            })?;
        Ok(json!({
            "sessionId": session.session_id,
            "externalSessionId": session.external_session_id.lock().await.clone(),
            "leafId": result.get("leafId").cloned().unwrap_or(Value::Null),
            "branch": branch,
            "tree": tree,
        }))
    }

    pub(crate) async fn abort(&self, session_id: &str) -> Result<(), PiError> {
        let session = self.ensure_runtime(session_id).await?;
        if session.current_turn_id.lock().await.is_none() {
            return Err(PiError::Session("Pi session has no active turn".to_owned()));
        }
        session.client.request("abort", json!({})).await?;
        // The SDK emits the authoritative aborted `turn_end`; the event loop
        // will persist it and transition the session without a duplicate turn.
        Ok(())
    }

    pub(crate) async fn close(&self, session_id: &str) -> Result<(), PiError> {
        if let Some(session) = self.sessions.lock().await.remove(session_id) {
            session.deactivate();
            session.client.close().await;
            session.set_state("closed").await?;
        }
        Ok(())
    }

    pub(crate) async fn close_workspace(&self, workspace_id: &str) -> Result<(), PiError> {
        let ids = self
            .sessions
            .lock()
            .await
            .iter()
            .filter(|(_, session)| session.workspace_id == workspace_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            self.close(&id).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{generation_matches, text_from_message, PI_ADAPTER_VERSION, PI_HOST_PROTOCOL};
    use serde_json::json;

    #[test]
    fn extracts_only_visible_pi_text() {
        assert_eq!(
            text_from_message(
                &json!({ "content": [{ "type": "thinking", "thinking": "hidden" }, { "type": "text", "text": "hello" }] })
            ),
            "hello"
        );
        assert_eq!(
            text_from_message(&json!({ "text": "compact hello" })),
            "compact hello"
        );
    }

    #[test]
    fn adapter_contract_is_versioned() {
        assert_eq!(PI_HOST_PROTOCOL, "aibo-pi-sdk-host.v1");
        assert!(PI_ADAPTER_VERSION.starts_with("phase3-pi-sdk-"));
    }

    #[test]
    fn rejects_events_from_an_old_generation() {
        assert!(generation_matches(
            Some("generation-current"),
            "generation-current"
        ));
        assert!(!generation_matches(
            Some("generation-old"),
            "generation-current"
        ));
        assert!(!generation_matches(None, "generation-current"));
    }
}
