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
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, oneshot, Mutex},
    time,
};
use tracing::{debug, warn};
use ulid::Ulid;

const CODEX_ADAPTER_VERSION: &str = "phase2-codex-0.1.0";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Error)]
pub enum CodexError {
    #[error("codex executable was not found on PATH")]
    MissingExecutable,
    #[error("failed to start codex app-server: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("codex process is not running")]
    ProcessClosed,
    #[error("codex protocol error: {0}")]
    Protocol(String),
    #[error("codex request failed: {0}")]
    Request(String),
    #[error("codex request timed out after {REQUEST_TIMEOUT:?}: {0}")]
    Timeout(String),
    #[error("codex session error: {0}")]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexThreadSummary {
    pub(crate) id: String,
    pub(crate) title: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexThreadSnapshot {
    pub(crate) id: String,
    pub(crate) title: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) turn_count: usize,
}

struct CodexClient {
    process: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    events: broadcast::Sender<Value>,
    closed: AtomicBool,
}

impl CodexClient {
    async fn spawn(codex_path: PathBuf, cwd: &Path) -> Result<Arc<Self>, CodexError> {
        let mut process = Command::new(&codex_path)
            .args(["app-server", "--stdio"])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(CodexError::Spawn)?;
        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| CodexError::Protocol("codex stdin was unavailable".to_owned()))?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| CodexError::Protocol("codex stdout was unavailable".to_owned()))?;
        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| CodexError::Protocol("codex stderr was unavailable".to_owned()))?;
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
            reader_client.mark_closed("codex stdout closed").await;
        });

        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    debug!(target: "aibo::codex", message = trimmed, "codex stderr");
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
            Ok(message) => message,
            Err(error) => {
                let _ = self.events.send(json!({
                    "method": "aibo/protocol-error",
                    "params": { "message": format!("{error}") }
                }));
                return;
            }
        };

        let is_response = message.get("id").is_some()
            && message.get("method").is_none()
            && (message.get("result").is_some() || message.get("error").is_some());
        if is_response {
            if let Some(id) = message.get("id").and_then(value_id) {
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

    async fn request(&self, method: &str, params: Value) -> Result<Value, CodexError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(CodexError::ProcessClosed);
        }
        let id = format!(
            "aibo-codex-{}",
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
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
                .map_err(|_| CodexError::ProcessClosed)?
                .map_err(CodexError::Request),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(CodexError::Timeout(method.to_owned()))
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), CodexError> {
        self.write_message(json!({ "method": method, "params": params }))
            .await
    }

    async fn respond(&self, id: Value, result: Value) -> Result<(), CodexError> {
        self.write_message(json!({ "id": id, "result": result }))
            .await
    }

    async fn write_message(&self, message: Value) -> Result<(), CodexError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(CodexError::ProcessClosed);
        }
        let mut stdin = self.stdin.lock().await;
        let line = serde_json::to_vec(&message)
            .map_err(|error| CodexError::Protocol(error.to_string()))?;
        stdin
            .write_all(&line)
            .await
            .map_err(|_| CodexError::ProcessClosed)?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|_| CodexError::ProcessClosed)?;
        stdin.flush().await.map_err(|_| CodexError::ProcessClosed)
    }

    async fn mark_closed(&self, reason: &str) {
        if !self.closed.swap(true, Ordering::SeqCst) {
            let mut pending = self.pending.lock().await;
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(reason.to_owned()));
            }
            let _ = self.events.send(json!({
                "method": "aibo/process-exited",
                "params": { "reason": reason }
            }));
        }
    }

    async fn close(&self) {
        if !self.closed.swap(true, Ordering::SeqCst) {
            let mut pending = self.pending.lock().await;
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err("codex adapter closed".to_owned()));
            }
        }
        let _ = self.stdin.lock().await.shutdown().await;
        let mut process = self.process.lock().await;
        let _ = process.kill().await;
        let _ = process.wait().await;
        let _ = self.events.send(json!({
            "method": "aibo/client-closed",
            "params": {}
        }));
    }
}

fn value_id(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn optional_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    })
}

fn thread_status(value: &Value) -> Option<String> {
    let status = value.get("status")?;
    status.as_str().map(ToOwned::to_owned).or_else(|| {
        ["type", "state", "status"].iter().find_map(|key| {
            status
                .get(*key)
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
    })
}

fn parse_thread_summary(value: &Value) -> Result<CodexThreadSummary, CodexError> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CodexError::Protocol("Codex thread summary did not include an id".to_owned())
        })?
        .to_owned();
    Ok(CodexThreadSummary {
        id,
        title: optional_string(value, &["title", "name", "preview"]),
        cwd: optional_string(value, &["cwd", "path"]),
        status: thread_status(value),
        updated_at: optional_string(value, &["updatedAt", "updated_at", "lastUpdatedAt"]),
    })
}

fn parse_thread_list(value: &Value) -> Result<Vec<CodexThreadSummary>, CodexError> {
    let threads = value
        .pointer("/result/data")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CodexError::Protocol("thread/list did not return a data array".to_owned())
        })?;
    threads.iter().map(parse_thread_summary).collect()
}

fn parse_thread_snapshot(value: &Value) -> Result<CodexThreadSnapshot, CodexError> {
    let thread = value
        .pointer("/result/thread")
        .ok_or_else(|| CodexError::Protocol("thread/read did not return a thread".to_owned()))?;
    let summary = parse_thread_summary(thread)?;
    let turn_count = thread
        .get("turns")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    Ok(CodexThreadSnapshot {
        id: summary.id,
        title: summary.title,
        cwd: summary.cwd,
        status: summary.status,
        updated_at: summary.updated_at,
        turn_count,
    })
}

async fn initialize_client(client: &CodexClient) -> Result<(), CodexError> {
    client
        .request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "aibo_phase2",
                    "title": "Aibo Phase 2",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": { "experimentalApi": true }
            }),
        )
        .await?;
    client.notify("initialized", json!({})).await
}

struct CodexSession {
    app: AppHandle,
    db: SqlitePool,
    client: Arc<CodexClient>,
    session_id: String,
    workspace_id: String,
    generation_id: String,
    thread_id: Mutex<Option<String>>,
    current_turn_id: Mutex<Option<String>>,
    pending_approvals: Mutex<HashMap<String, Value>>,
    state: Mutex<String>,
    sequence: AtomicU64,
    active: AtomicBool,
}

impl CodexSession {
    fn new(
        app: AppHandle,
        db: SqlitePool,
        client: Arc<CodexClient>,
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
            thread_id: Mutex::new(None),
            current_turn_id: Mutex::new(None),
            pending_approvals: Mutex::new(HashMap::new()),
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
                            warn!(session_id = %session.session_id, error = %error, "codex event handling failed");
                        }
                        if session.client.closed.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(count)) => {
                        warn!(session_id = %session.session_id, count, "codex event receiver lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    async fn handle_event(&self, message: Value) -> Result<(), CodexError> {
        if !self.active.load(Ordering::SeqCst) || !self.is_current_generation().await? {
            return Ok(());
        }
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
        match method {
            "thread/started" => {
                if let Some(thread_id) = params.pointer("/thread/id").and_then(Value::as_str) {
                    self.set_thread_id(thread_id.to_owned()).await;
                }
                self.set_state("idle").await?;
                self.emit_event(
                    "session.started",
                    None,
                    json!({ "externalSessionId": self.thread_id.lock().await.clone() }),
                    None,
                )
                .await?;
            }
            "turn/started" => {
                let turn_id = params
                    .pointer("/turn/id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                if let Some(turn_id) = turn_id.as_deref() {
                    self.ensure_turn(turn_id, "").await?;
                    *self.current_turn_id.lock().await = Some(turn_id.to_owned());
                }
                self.set_state("running").await?;
                self.emit_event(
                    "turn.started",
                    turn_id,
                    json!({ "status": "running" }),
                    None,
                )
                .await?;
            }
            "item/agentMessage/delta" => {
                let turn_id = params
                    .pointer("/turnId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let item_id = params
                    .pointer("/itemId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let delta = params
                    .pointer("/delta")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if let (Some(turn_id), Some(item_id)) = (turn_id.as_deref(), item_id.as_deref()) {
                    let internal_turn_id = self.ensure_turn(turn_id, "").await?;
                    self.upsert_assistant_delta(item_id, &internal_turn_id, delta)
                        .await?;
                    self.emit_event(
                        "message.delta",
                        Some(turn_id.to_owned()),
                        json!({ "itemId": item_id, "delta": delta }),
                        Some(json!({ "itemId": item_id })),
                    )
                    .await?;
                }
            }
            "turn/completed" => {
                let turn = params.get("turn").cloned().unwrap_or_else(|| json!({}));
                let turn_id = turn
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let status = turn
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("completed");
                if let Some(turn_id) = turn_id.as_deref() {
                    let internal_turn_id = self.ensure_turn(turn_id, "").await?;
                    let output = final_turn_text(&turn);
                    let mapped_status = map_turn_status(status);
                    sqlx::query(
                        "UPDATE turns SET status = ?, output_text = ?, completed_at = ? WHERE id = ?",
                    )
                    .bind(mapped_status)
                    .bind(&output)
                    .bind(now_iso())
                    .bind(&internal_turn_id)
                    .execute(&self.db)
                    .await?;
                    self.complete_assistant_messages(&internal_turn_id, &output)
                        .await?;
                    *self.current_turn_id.lock().await = None;
                    self.pending_approvals.lock().await.clear();
                    if mapped_status == "completed" {
                        self.set_state("idle").await?;
                    } else if mapped_status == "interrupted" {
                        self.set_state("interrupted").await?;
                    } else {
                        self.set_state("failed").await?;
                    }
                    self.emit_event(
                        "message.completed",
                        Some(turn_id.to_owned()),
                        json!({ "text": output, "status": mapped_status }),
                        None,
                    )
                    .await?;
                    self.emit_event(
                        "turn.completed",
                        Some(turn_id.to_owned()),
                        json!({ "status": mapped_status }),
                        None,
                    )
                    .await?;
                }
            }
            "turn/failed" => {
                let turn_id = params
                    .pointer("/turnId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                if let Some(turn_id) = turn_id.as_deref() {
                    let internal_turn_id = self.ensure_turn(turn_id, "").await?;
                    sqlx::query(
                        "UPDATE turns SET status = 'failed', completed_at = ? WHERE id = ?",
                    )
                    .bind(now_iso())
                    .bind(&internal_turn_id)
                    .execute(&self.db)
                    .await?;
                    sqlx::query(
                        "UPDATE messages SET status = 'failed', updated_at = ?
                         WHERE session_id = ? AND turn_id = ? AND role = 'assistant'",
                    )
                    .bind(now_iso())
                    .bind(&self.session_id)
                    .bind(&internal_turn_id)
                    .execute(&self.db)
                    .await?;
                }
                *self.current_turn_id.lock().await = None;
                self.pending_approvals.lock().await.clear();
                self.set_state("failed").await?;
                self.emit_event(
                    "turn.failed",
                    turn_id,
                    json!({ "error": params.get("error").cloned().unwrap_or(Value::Null) }),
                    None,
                )
                .await?;
            }
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                let Some(request_id) = message.get("id").and_then(value_id) else {
                    return Err(CodexError::Protocol(
                        "approval request did not include a request id".to_owned(),
                    ));
                };
                self.pending_approvals.lock().await.insert(
                    request_id.clone(),
                    message.get("id").cloned().unwrap_or(Value::Null),
                );
                self.set_state("waiting_approval").await?;
                self.emit_event(
                    "approval.requested",
                    params
                        .pointer("/turnId")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                    json!({
                        "requestId": request_id,
                        "kind": params.get("kind").cloned().unwrap_or(Value::Null),
                        "command": params.get("command").cloned().unwrap_or(Value::Null),
                        "cwd": params.get("cwd").cloned().unwrap_or(Value::Null),
                        "availableDecisions": params
                            .get("availableDecisions")
                            .cloned()
                            .unwrap_or_else(|| json!(["accept", "cancel"]))
                    }),
                    Some(
                        json!({ "approvalId": message.get("id").cloned().unwrap_or(Value::Null) }),
                    ),
                )
                .await?;
            }
            "serverRequest/resolved" => {
                let request_id = params.get("requestId").and_then(value_id);
                if let Some(request_id) = request_id {
                    self.pending_approvals.lock().await.remove(&request_id);
                    self.set_state("running").await?;
                    self.emit_event(
                        "approval.resolved",
                        None,
                        json!({ "requestId": request_id }),
                        None,
                    )
                    .await?;
                }
            }
            "aibo/process-exited" => {
                *self.current_turn_id.lock().await = None;
                self.pending_approvals.lock().await.clear();
                self.set_state("interrupted").await?;
                self.emit_event(
                    "adapter.crashed",
                    None,
                    json!({ "reason": params.get("reason").cloned().unwrap_or(Value::Null) }),
                    None,
                )
                .await?;
            }
            "aibo/protocol-error" => {
                self.emit_event(
                    "adapter.warning",
                    None,
                    json!({ "message": params.get("message").cloned().unwrap_or(Value::Null) }),
                    None,
                )
                .await?;
            }
            _ => {}
        }
        Ok(())
    }

    async fn initialize(&self) -> Result<(), CodexError> {
        initialize_client(&self.client).await
    }

    fn deactivate(&self) {
        self.active.store(false, Ordering::SeqCst);
    }

    async fn is_current_generation(&self) -> Result<bool, CodexError> {
        let generation: Option<String> =
            sqlx::query_scalar("SELECT generation_id FROM session_bindings WHERE session_id = ?")
                .bind(&self.session_id)
                .fetch_optional(&self.db)
                .await?
                .flatten();
        Ok(generation.as_deref() == Some(self.generation_id.as_str()))
    }

    async fn set_thread_id(&self, thread_id: String) {
        *self.thread_id.lock().await = Some(thread_id);
    }

    async fn ensure_turn(
        &self,
        external_turn_id: &str,
        input_text: &str,
    ) -> Result<String, CodexError> {
        if let Some(id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM turns WHERE session_id = ? AND external_turn_id = ?",
        )
        .bind(&self.session_id)
        .bind(external_turn_id)
        .fetch_optional(&self.db)
        .await?
        {
            if !input_text.is_empty() {
                sqlx::query(
                    "UPDATE turns SET input_text = CASE WHEN input_text = '' THEN ? ELSE input_text END
                     WHERE id = ?",
                )
                .bind(input_text)
                .bind(&id)
                .execute(&self.db)
                .await?;
            }
            return Ok(id);
        }
        let id = Ulid::new().to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO turns
             (id, session_id, external_turn_id, status, input_text, started_at)
             VALUES (?, ?, ?, 'running', ?, ?)",
        )
        .bind(&id)
        .bind(&self.session_id)
        .bind(external_turn_id)
        .bind(input_text)
        .bind(now_iso())
        .execute(&self.db)
        .await?;
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
        external_message_id: &str,
        turn_id: &str,
        delta: &str,
    ) -> Result<(), CodexError> {
        let now = now_iso();
        let updated = sqlx::query(
            "UPDATE messages SET content = content || ?, turn_id = ?, status = 'streaming', updated_at = ?
             WHERE session_id = ? AND external_message_id = ?",
        )
        .bind(delta)
        .bind(turn_id)
        .bind(&now)
        .bind(&self.session_id)
        .bind(external_message_id)
        .execute(&self.db)
        .await?;
        if updated.rows_affected() == 0 {
            sqlx::query(
                "INSERT INTO messages
                 (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'assistant', ?, 'streaming', ?, ?, ?)",
            )
            .bind(Ulid::new().to_string())
            .bind(&self.session_id)
            .bind(turn_id)
            .bind(external_message_id)
            .bind(delta)
            .bind(self.sequence.load(Ordering::Relaxed) as i64)
            .bind(&now)
            .bind(&now)
            .execute(&self.db)
            .await?;
        }
        Ok(())
    }

    async fn complete_assistant_messages(
        &self,
        turn_id: &str,
        output: &str,
    ) -> Result<(), CodexError> {
        let now = now_iso();
        let updated = sqlx::query(
            "UPDATE messages SET content = CASE WHEN ? <> '' THEN ? ELSE content END,
                    status = 'completed', updated_at = ?
             WHERE session_id = ? AND turn_id = ? AND role = 'assistant'",
        )
        .bind(output)
        .bind(output)
        .bind(&now)
        .bind(&self.session_id)
        .bind(turn_id)
        .execute(&self.db)
        .await?;
        if updated.rows_affected() == 0 && !output.is_empty() {
            sqlx::query(
                "INSERT INTO messages
                 (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'assistant', ?, 'completed', ?, ?, ?)",
            )
            .bind(Ulid::new().to_string())
            .bind(&self.session_id)
            .bind(turn_id)
            .bind(format!("turn:{turn_id}"))
            .bind(output)
            .bind(self.sequence.load(Ordering::Relaxed) as i64)
            .bind(&now)
            .bind(&now)
            .execute(&self.db)
            .await?;
        }
        Ok(())
    }

    async fn set_state(&self, next: &str) -> Result<(), CodexError> {
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
    ) -> Result<(), CodexError> {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let external_session_id = self.thread_id.lock().await.clone();
        let event = AgentEvent {
            schema_version: "1.0".to_owned(),
            event_id: Ulid::new().to_string(),
            generation_id: self.generation_id.clone(),
            sequence,
            occurred_at: now_iso(),
            source: EventSource {
                agent: "codex".to_owned(),
                transport: "app-server".to_owned(),
                adapter_version: CODEX_ADAPTER_VERSION.to_owned(),
                agent_version: None,
                protocol_version: Some("json-rpc-2.0".to_owned()),
            },
            workspace_id: self.workspace_id.clone(),
            session_id: self.session_id.clone(),
            external_session_id,
            turn_id,
            event_type: event_type.to_owned(),
            correlation,
            payload,
            raw_ref: None,
        };
        sqlx::query(
            "INSERT INTO agent_events
             (event_id, session_id, generation_id, sequence, occurred_at, event_type, turn_id, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&event.event_id)
        .bind(&event.session_id)
        .bind(&event.generation_id)
        .bind(event.sequence as i64)
        .bind(&event.occurred_at)
        .bind(&event.event_type)
        .bind(&event.turn_id)
        .bind(serde_json::to_string(&event.payload).unwrap_or_else(|_| "{}".to_owned()))
        .execute(&self.db)
        .await?;
        if let Err(error) = self.app.emit("agent-event", event) {
            warn!(session_id = %self.session_id, error = %error, "unable to emit codex event to UI");
        }
        Ok(())
    }
}

fn map_turn_status(status: &str) -> &'static str {
    match status {
        "completed" => "completed",
        "interrupted" | "aborted" => "interrupted",
        _ => "failed",
    }
}

fn final_turn_text(turn: &Value) -> String {
    turn.get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("agentMessage"))
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone)]
pub(crate) struct CodexManager {
    app: AppHandle,
    db: SqlitePool,
    sessions: Arc<Mutex<HashMap<String, Arc<CodexSession>>>>,
}

impl CodexManager {
    pub(crate) fn new(app: AppHandle, db: SqlitePool) -> Self {
        Self {
            app,
            db,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn create_session(
        &self,
        workspace_id: &str,
    ) -> Result<super::Session, CodexError> {
        let workspace = workspace_by_id(&self.db, workspace_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        let codex_path = find_executable("codex").ok_or(CodexError::MissingExecutable)?;
        let session_id = Ulid::new().to_string();
        let generation_id = Ulid::new().to_string();
        let now = now_iso();
        let label = format!("Codex · {}", workspace.label);
        sqlx::query(
            "INSERT INTO sessions (id, workspace_id, agent, label, state, created_at, updated_at)
             VALUES (?, ?, 'codex', ?, 'starting', ?, ?)",
        )
        .bind(&session_id)
        .bind(workspace_id)
        .bind(&label)
        .bind(&now)
        .bind(&now)
        .execute(&self.db)
        .await?;
        sqlx::query(
            "INSERT INTO session_bindings
             (session_id, external_session_id, generation_id, adapter_version, bound_at)
             VALUES (?, NULL, ?, ?, ?)",
        )
        .bind(&session_id)
        .bind(&generation_id)
        .bind(CODEX_ADAPTER_VERSION)
        .bind(&now)
        .execute(&self.db)
        .await?;

        let client = match CodexClient::spawn(codex_path, Path::new(&workspace.path)).await {
            Ok(client) => client,
            Err(error) => {
                let _ = sqlx::query(
                    "UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?",
                )
                .bind(now_iso())
                .bind(&session_id)
                .execute(&self.db)
                .await;
                return Err(error);
            }
        };
        let session = CodexSession::new(
            self.app.clone(),
            self.db.clone(),
            client.clone(),
            session_id.clone(),
            workspace_id.to_owned(),
            generation_id,
        );
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session.clone());
        session.start_event_loop();

        if let Err(error) = session.initialize().await {
            session.deactivate();
            self.sessions.lock().await.remove(&session_id);
            client.close().await;
            let _ =
                sqlx::query("UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?")
                    .bind(now_iso())
                    .bind(&session_id)
                    .execute(&self.db)
                    .await;
            return Err(error);
        }
        let started = match client
            .request(
                "thread/start",
                json!({
                    "cwd": workspace.path,
                    "approvalPolicy": "on-request",
                    "sandbox": "read-only",
                    "serviceName": "aibo_phase2"
                }),
            )
            .await
        {
            Ok(started) => started,
            Err(error) => {
                session.deactivate();
                self.sessions.lock().await.remove(&session_id);
                client.close().await;
                let _ = sqlx::query(
                    "UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?",
                )
                .bind(now_iso())
                .bind(&session_id)
                .execute(&self.db)
                .await;
                return Err(error);
            }
        };
        let thread_id = match started.pointer("/result/thread/id").and_then(Value::as_str) {
            Some(thread_id) => thread_id.to_owned(),
            None => {
                session.deactivate();
                self.sessions.lock().await.remove(&session_id);
                client.close().await;
                let _ = sqlx::query(
                    "UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?",
                )
                .bind(now_iso())
                .bind(&session_id)
                .execute(&self.db)
                .await;
                return Err(CodexError::Protocol(
                    "thread/start did not return a thread id".to_owned(),
                ));
            }
        };
        session.set_thread_id(thread_id.clone()).await;
        sqlx::query("UPDATE session_bindings SET external_session_id = ? WHERE session_id = ?")
            .bind(&thread_id)
            .bind(&session_id)
            .execute(&self.db)
            .await?;
        session.set_state("idle").await?;
        session_by_id(&self.db, &session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))
    }

    pub(crate) async fn list_threads(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<CodexThreadSummary>, CodexError> {
        let workspace = workspace_by_id(&self.db, workspace_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        let codex_path = find_executable("codex").ok_or(CodexError::MissingExecutable)?;
        let client = CodexClient::spawn(codex_path, Path::new(&workspace.path)).await?;
        let result = async {
            initialize_client(&client).await?;
            let response = client
                .request(
                    "thread/list",
                    json!({
                        "limit": 100,
                        "cwd": workspace.path,
                        "sortKey": "updated_at",
                        "sortDirection": "desc"
                    }),
                )
                .await?;
            parse_thread_list(&response)
        }
        .await;
        client.close().await;
        result
    }

    async fn ensure_runtime(&self, session_id: &str) -> Result<Arc<CodexSession>, CodexError> {
        if let Some(session) = self.sessions.lock().await.get(session_id).cloned() {
            if !session.client.closed.load(Ordering::SeqCst) {
                return Ok(session);
            }
            self.sessions.lock().await.remove(session_id);
        }
        let session = session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        if session.agent != "codex" {
            return Err(CodexError::Session(
                "session is not a Codex session".to_owned(),
            ));
        }
        let external_id: Option<String> = sqlx::query_scalar(
            "SELECT external_session_id FROM session_bindings WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_optional(&self.db)
        .await?
        .flatten();
        let thread_id = external_id.ok_or_else(|| {
            CodexError::Session("Codex session has no external thread binding".to_owned())
        })?;
        let workspace_path: String = sqlx::query_scalar("SELECT path FROM workspaces WHERE id = ?")
            .bind(&session.workspace_id)
            .fetch_one(&self.db)
            .await?;
        let codex_path = find_executable("codex").ok_or(CodexError::MissingExecutable)?;
        let generation_id = Ulid::new().to_string();
        let client = CodexClient::spawn(codex_path, Path::new(&workspace_path)).await?;
        let runtime = CodexSession::new(
            self.app.clone(),
            self.db.clone(),
            client.clone(),
            session_id.to_owned(),
            session.workspace_id.clone(),
            generation_id.clone(),
        );
        runtime.set_thread_id(thread_id.clone()).await;
        self.sessions
            .lock()
            .await
            .insert(session_id.to_owned(), runtime.clone());
        runtime.start_event_loop();
        if let Err(error) = runtime.initialize().await {
            runtime.deactivate();
            self.sessions.lock().await.remove(session_id);
            client.close().await;
            return Err(error);
        }
        if let Err(error) = client
            .request("thread/resume", json!({ "threadId": thread_id }))
            .await
        {
            runtime.deactivate();
            self.sessions.lock().await.remove(session_id);
            client.close().await;
            let _ =
                sqlx::query("UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?")
                    .bind(now_iso())
                    .bind(session_id)
                    .execute(&self.db)
                    .await;
            return Err(error);
        }
        runtime.set_state("idle").await?;
        sqlx::query(
            "UPDATE session_bindings SET generation_id = ?, bound_at = ? WHERE session_id = ?",
        )
        .bind(generation_id)
        .bind(now_iso())
        .bind(session_id)
        .execute(&self.db)
        .await?;
        Ok(runtime)
    }

    pub(crate) async fn read_thread(
        &self,
        session_id: &str,
    ) -> Result<CodexThreadSnapshot, CodexError> {
        let session = self.ensure_runtime(session_id).await?;
        let thread_id = session
            .thread_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| CodexError::Session("Codex session has no thread id".to_owned()))?;
        let response = session
            .client
            .request(
                "thread/read",
                json!({ "threadId": thread_id, "includeTurns": true }),
            )
            .await?;
        parse_thread_snapshot(&response)
    }

    pub(crate) async fn send_prompt(
        &self,
        session_id: &str,
        input: &str,
    ) -> Result<(), CodexError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(CodexError::Session("prompt must not be empty".to_owned()));
        }
        let session = self.ensure_runtime(session_id).await?;
        {
            let state = session.state.lock().await;
            if matches!(state.as_str(), "running" | "waiting_approval") {
                return Err(CodexError::Session(
                    "Codex session already has an active turn".to_owned(),
                ));
            }
        }
        let thread_id = session
            .thread_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| CodexError::Session("Codex session has no thread id".to_owned()))?;
        let user_message_id = Ulid::new().to_string();
        let now = now_iso();
        sqlx::query(
            "INSERT INTO messages
             (id, session_id, turn_id, external_message_id, role, content, status, sequence, created_at, updated_at)
             VALUES (?, ?, NULL, ?, 'user', ?, 'completed', ?, ?, ?)",
        )
        .bind(&user_message_id)
        .bind(session_id)
        .bind(format!("user:{user_message_id}"))
        .bind(input)
        .bind(session.sequence.load(Ordering::Relaxed) as i64)
        .bind(&now)
        .bind(&now)
        .execute(&self.db)
        .await?;
        session.set_state("running").await?;
        let response = session
            .client
            .request(
                "turn/start",
                json!({
                    "threadId": thread_id,
                    "input": [{ "type": "text", "text": input }]
                }),
            )
            .await?;
        let turn_id = response
            .pointer("/result/turn/id")
            .and_then(Value::as_str)
            .ok_or_else(|| CodexError::Protocol("turn/start did not return a turn id".to_owned()))?
            .to_owned();
        *session.current_turn_id.lock().await = Some(turn_id.clone());
        let internal_turn_id = session.ensure_turn(&turn_id, input).await?;
        sqlx::query("UPDATE messages SET turn_id = ?, updated_at = ? WHERE id = ?")
            .bind(internal_turn_id)
            .bind(now_iso())
            .bind(user_message_id)
            .execute(&self.db)
            .await?;
        Ok(())
    }

    pub(crate) async fn resolve_approval(
        &self,
        session_id: &str,
        request_id: &str,
        decision: &str,
    ) -> Result<(), CodexError> {
        let decision = match decision {
            "accept" | "cancel" => decision,
            _ => {
                return Err(CodexError::Session(
                    "approval decision must be accept or cancel".to_owned(),
                ));
            }
        };
        let session = self.ensure_runtime(session_id).await?;
        let raw_request_id = session
            .pending_approvals
            .lock()
            .await
            .get(request_id)
            .cloned()
            .ok_or_else(|| {
                CodexError::Session("approval request is no longer pending".to_owned())
            })?;
        session
            .client
            .respond(raw_request_id, json!({ "decision": decision }))
            .await?;
        session.pending_approvals.lock().await.remove(request_id);
        session.set_state("running").await?;
        let turn_id = session.current_turn_id.lock().await.clone();
        session
            .emit_event(
                "approval.resolved",
                turn_id,
                json!({ "requestId": request_id, "decision": decision }),
                None,
            )
            .await
    }

    pub(crate) async fn abort(&self, session_id: &str) -> Result<(), CodexError> {
        let session = self.ensure_runtime(session_id).await?;
        let thread_id = session
            .thread_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| CodexError::Session("Codex session has no thread id".to_owned()))?;
        let turn_id = session
            .current_turn_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| CodexError::Session("Codex session has no active turn".to_owned()))?;
        session
            .client
            .request(
                "turn/interrupt",
                json!({ "threadId": thread_id, "turnId": turn_id }),
            )
            .await?;
        *session.current_turn_id.lock().await = None;
        session.set_state("interrupted").await
    }

    pub(crate) async fn close(&self, session_id: &str) -> Result<(), CodexError> {
        if let Some(session) = self.sessions.lock().await.remove(session_id) {
            session.deactivate();
            session.client.close().await;
            session.set_state("closed").await?;
        }
        Ok(())
    }

    pub(crate) async fn close_workspace(&self, workspace_id: &str) -> Result<(), CodexError> {
        let session_ids = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .filter(|(_, session)| session.workspace_id == workspace_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>()
        };
        for session_id in session_ids {
            self.close(&session_id).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        final_turn_text, map_turn_status, parse_thread_list, parse_thread_snapshot, value_id,
    };
    use serde_json::json;

    #[test]
    fn maps_codex_turn_statuses_to_core_states() {
        assert_eq!(map_turn_status("completed"), "completed");
        assert_eq!(map_turn_status("interrupted"), "interrupted");
        assert_eq!(map_turn_status("aborted"), "interrupted");
        assert_eq!(map_turn_status("inProgress"), "failed");
    }

    #[test]
    fn extracts_final_agent_messages_only() {
        let turn = json!({
            "items": [
                { "type": "reasoning", "text": "hidden" },
                { "type": "agentMessage", "text": "first" },
                { "type": "agentMessage", "text": "second" }
            ]
        });
        assert_eq!(final_turn_text(&turn), "first\nsecond");
    }

    #[test]
    fn accepts_json_rpc_string_and_number_ids() {
        assert_eq!(value_id(&json!("request-1")), Some("request-1".to_owned()));
        assert_eq!(value_id(&json!(7)), Some("7".to_owned()));
        assert_eq!(value_id(&json!(null)), None);
    }

    #[test]
    fn parses_thread_list_summaries_with_protocol_aliases() {
        let response = json!({
            "result": {
                "data": [
                    {
                        "id": "thread-1",
                        "preview": "Investigate issue",
                        "path": "/tmp/project",
                        "status": { "type": "idle" },
                        "updated_at": "2026-09-03T00:00:00Z"
                    }
                ]
            }
        });
        let threads = parse_thread_list(&response).expect("thread/list response");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].id, "thread-1");
        assert_eq!(threads[0].title.as_deref(), Some("Investigate issue"));
        assert_eq!(threads[0].cwd.as_deref(), Some("/tmp/project"));
        assert_eq!(threads[0].status.as_deref(), Some("idle"));
    }

    #[test]
    fn parses_thread_read_snapshot_and_turn_count() {
        let response = json!({
            "result": {
                "thread": {
                    "id": "thread-1",
                    "name": "Aibo session",
                    "cwd": "/tmp/project",
                    "status": "running",
                    "updatedAt": "2026-09-03T00:00:00Z",
                    "turns": [{ "id": "turn-1" }, { "id": "turn-2" }]
                }
            }
        });
        let snapshot = parse_thread_snapshot(&response).expect("thread/read response");
        assert_eq!(snapshot.id, "thread-1");
        assert_eq!(snapshot.title.as_deref(), Some("Aibo session"));
        assert_eq!(snapshot.turn_count, 2);
    }
}
