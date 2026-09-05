use super::artifact::{artifact_root_from_checkpoint, persist_text, sanitize_content};
use super::change_set::{
    capture as capture_workspace, discard_baseline_checkpoint, persist as persist_change_set,
    persist_baseline_checkpoint, persist_checkpoint_metadata, relocate_baseline_checkpoint,
    WorkspaceSnapshot,
};
use super::execution_profile::ResolvedExecutionProfile;
use super::{
    bind_pending_attachments_to_turn, clone_cached_runtime, find_executable, mark_turn_interrupted,
    now_iso, remove_cached_runtime, session_by_id, session_execution_profile, workspace_by_id,
};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
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

fn codex_thread_start_params(cwd: &str, profile: &ResolvedExecutionProfile) -> Value {
    let mut params = json!({
        "cwd": cwd,
        "approvalPolicy": if profile.enforced.approval_policy == "trusted" {
            "never"
        } else {
            profile.enforced.approval_policy.as_str()
        },
        "sandbox": profile.enforced.filesystem_policy,
        "serviceName": "aibo_phase4_5"
    });
    if let Some(model) = profile.enforced.model.as_deref() {
        params["model"] = json!(model);
        // A requested model must not silently fall back to the provider's
        // default when Codex cannot resolve it.
        params["allowProviderModelFallback"] = json!(false);
    }
    params
}

fn validate_codex_thread_start_response(
    response: &Value,
    profile: &ResolvedExecutionProfile,
) -> Result<(), CodexError> {
    let result = response
        .get("result")
        .ok_or_else(|| CodexError::Protocol("thread/start response has no result".to_owned()))?;
    let expected_approval = if profile.enforced.approval_policy == "trusted" {
        "never"
    } else {
        profile.enforced.approval_policy.as_str()
    };
    let actual_approval = result
        .get("approvalPolicy")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CodexError::Protocol(
                "thread/start response omitted the enforced approval policy".to_owned(),
            )
        })?;
    if actual_approval != expected_approval {
        return Err(CodexError::Protocol(format!(
            "Codex enforced approval policy {actual_approval:?}, expected {expected_approval:?}"
        )));
    }

    let expected_sandbox = match profile.enforced.filesystem_policy.as_str() {
        "read-only" => "readOnly",
        "workspace-write" => "workspaceWrite",
        other => {
            return Err(CodexError::Protocol(format!(
                "unsupported enforced filesystem policy {other:?}"
            )))
        }
    };
    let actual_sandbox = result
        .pointer("/sandbox/type")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CodexError::Protocol(
                "thread/start response omitted the enforced sandbox policy".to_owned(),
            )
        })?;
    if actual_sandbox != expected_sandbox {
        return Err(CodexError::Protocol(format!(
            "Codex enforced sandbox {actual_sandbox:?}, expected {expected_sandbox:?}"
        )));
    }
    if let Some(expected_model) = profile.enforced.model.as_deref() {
        let actual_model = result.get("model").and_then(Value::as_str).ok_or_else(|| {
            CodexError::Protocol("thread/start response omitted the requested model".to_owned())
        })?;
        if actual_model != expected_model {
            return Err(CodexError::Protocol(format!(
                "Codex selected model {actual_model:?}, expected {expected_model:?}"
            )));
        }
    }
    // Reasoning effort is applied at turn/start (not thread/start) in the
    // current app-server protocol, so there is no thread-level value to
    // validate here. The turn request still carries the resolved value.
    Ok(())
}

fn codex_turn_start_params(
    thread_id: &str,
    input: &str,
    profile: &ResolvedExecutionProfile,
) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": input }]
    });
    if let Some(model) = profile.enforced.model.as_deref() {
        params["model"] = json!(model);
    }
    if let Some(effort) = profile.enforced.reasoning_effort.as_deref() {
        params["effort"] = json!(effort);
    }
    params
}

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
    let thread = value.pointer("/result/thread").ok_or_else(|| {
        CodexError::Protocol("Codex thread response did not return a thread".to_owned())
    })?;
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

fn parse_forked_thread(value: &Value) -> Result<(String, Option<String>), CodexError> {
    let thread = value
        .pointer("/result/thread")
        .ok_or_else(|| CodexError::Protocol("thread/fork did not return a thread".to_owned()))?;
    let thread_id = thread
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CodexError::Protocol("thread/fork did not return a thread id".to_owned()))?
        .to_owned();
    let parent_id = thread
        .get("forkedFromId")
        .or_else(|| thread.get("forked_from_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    Ok((thread_id, parent_id))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ToolProjection {
    item_id: String,
    item_type: String,
    status: String,
    command: Option<String>,
    cwd: Option<String>,
    exit_code: Option<i64>,
    summary: String,
    delta: Option<String>,
    output: Option<String>,
}

fn event_thread_id(params: &Value) -> Option<&str> {
    params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.pointer("/thread/id").and_then(Value::as_str))
}

fn event_turn_id(params: &Value) -> Option<String> {
    params
        .get("turnId")
        .and_then(Value::as_str)
        .or_else(|| params.pointer("/turn/id").and_then(Value::as_str))
        .map(ToOwned::to_owned)
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let value: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{value}…")
    } else {
        value
    }
}

fn tool_event_kind(method: &str) -> Option<&'static str> {
    match method {
        "item/started" => Some("tool.started"),
        "item/updated"
        | "item/commandExecution/outputDelta"
        | "item/fileChange/outputDelta"
        | "item/mcpToolCall/progress" => Some("tool.updated"),
        "item/completed" => Some("tool.completed"),
        _ => None,
    }
}

fn is_tool_item_type(item_type: &str) -> bool {
    let normalized = item_type.to_ascii_lowercase();
    normalized.contains("command")
        || normalized.contains("file")
        || normalized.contains("tool")
        || normalized.contains("shell")
        || normalized.contains("search")
        || normalized.contains("computer")
        || normalized.contains("patch")
        || normalized.contains("diff")
        || normalized.contains("edit")
}

fn tool_projection(method: &str, params: &Value) -> Option<ToolProjection> {
    let item = params.get("item").unwrap_or(params);
    let item_id = params
        .get("itemId")
        .and_then(Value::as_str)
        .or_else(|| item.get("id").and_then(Value::as_str))?
        .to_owned();
    let item_type = item
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| params.get("kind").and_then(Value::as_str))
        .or_else(|| method.split('/').nth(1))
        .unwrap_or("tool")
        .to_owned();
    if !is_tool_item_type(&item_type) {
        return None;
    }
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| match tool_event_kind(method) {
            Some("tool.completed") => "completed".to_owned(),
            _ => "inProgress".to_owned(),
        });
    let command = item
        .get("command")
        .and_then(Value::as_str)
        .or_else(|| params.get("command").and_then(Value::as_str))
        .map(ToOwned::to_owned);
    let cwd = item
        .get("cwd")
        .and_then(Value::as_str)
        .or_else(|| params.get("cwd").and_then(Value::as_str))
        .map(ToOwned::to_owned);
    let exit_code = item
        .get("exitCode")
        .or_else(|| item.get("exit_code"))
        .or_else(|| item.get("returnCode"))
        .or_else(|| params.get("exitCode"))
        .and_then(Value::as_i64);
    let delta = params
        .get("delta")
        .and_then(Value::as_str)
        .map(|value| truncate_text(value, 4_000));
    let primary = [
        item.get("command").and_then(Value::as_str),
        item.get("path").and_then(Value::as_str),
        item.get("filePath").and_then(Value::as_str),
        item.get("toolName").and_then(Value::as_str),
        item.get("name").and_then(Value::as_str),
        item.get("description").and_then(Value::as_str),
        item.get("text").and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    .next()
    .map(|value| truncate_text(value, 2_000));
    let output = [
        item.get("aggregatedOutput").and_then(Value::as_str),
        item.get("output").and_then(Value::as_str),
        item.get("stdout").and_then(Value::as_str),
        item.get("stderr").and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    .next()
    .map(|value| {
        let output = truncate_text(value, 4_000);
        if item_type.to_ascii_lowercase().contains("command") {
            sanitize_content("codex.command", &output)
        } else {
            output
        }
    });
    let summary = match (primary, output.as_deref()) {
        (Some(primary), Some(output)) if !output.is_empty() => {
            truncate_text(&format!("{primary}\n{output}"), 6_000)
        }
        (Some(primary), _) => primary.to_owned(),
        (None, Some(output)) if !output.is_empty() => output.to_owned(),
        (None, _) => delta.clone().unwrap_or_else(|| item_type.clone()),
    };
    Some(ToolProjection {
        item_id,
        item_type,
        status,
        command,
        cwd,
        exit_code,
        summary,
        delta,
        output,
    })
}

fn map_tool_status(status: &str, event_type: &str) -> &'static str {
    if event_type == "tool.completed" {
        return match status {
            "failed" | "error" | "declined" | "cancelled" | "canceled" => "failed",
            _ => "completed",
        };
    }
    match status {
        "failed" | "error" | "declined" | "cancelled" | "canceled" => "failed",
        "completed" | "succeeded" => "completed",
        _ => "streaming",
    }
}

fn usage_projection(params: &Value) -> Option<Value> {
    let usage = params
        .get("usage")
        .or_else(|| params.get("tokenUsage"))
        .or_else(|| params.get("totalUsage"))
        .filter(|value| value.is_object())
        .cloned()
        .or_else(|| params.is_object().then(|| params.clone()))?;
    let usage = usage
        .get("total")
        .filter(|value| value.is_object())
        .unwrap_or(&usage);
    let fields: [(&str, &[&str]); 8] = [
        ("inputTokens", &["inputTokens"]),
        ("outputTokens", &["outputTokens"]),
        (
            "cachedInputTokens",
            &["cachedInputTokens", "cacheReadInputTokens"],
        ),
        (
            "cacheWriteTokens",
            &["cacheWriteTokens", "cacheWriteInputTokens"],
        ),
        ("totalTokens", &["totalTokens"]),
        ("reasoningOutputTokens", &["reasoningOutputTokens"]),
        ("modelContextWindow", &["modelContextWindow"]),
        ("cacheReadTokens", &["cacheReadTokens"]),
    ];
    let mut normalized = serde_json::Map::new();
    for (canonical, aliases) in fields {
        if let Some(value) = aliases
            .iter()
            .find_map(|key| usage.get(*key).and_then(Value::as_u64))
        {
            normalized.insert(canonical.to_owned(), json!(value));
        }
    }
    if normalized.is_empty() {
        None
    } else {
        Some(Value::Object(normalized))
    }
}

fn matching_thread_id(expected: &str, actual: &str) -> Result<(), CodexError> {
    if expected == actual {
        Ok(())
    } else {
        Err(CodexError::Session(format!(
            "Codex thread binding mismatch: expected {expected}, got {actual}"
        )))
    }
}

fn is_missing_rollout_error(error: &CodexError) -> bool {
    let CodexError::Request(message) = error else {
        return false;
    };
    let message = message.to_ascii_lowercase();
    message.contains("no rollout found")
        || message.contains("thread not loaded")
        || message.contains("thread not found")
}

async fn start_thread(
    client: &CodexClient,
    cwd: &str,
    profile: &ResolvedExecutionProfile,
) -> Result<String, CodexError> {
    let response = client
        .request("thread/start", codex_thread_start_params(cwd, profile))
        .await?;
    validate_codex_thread_start_response(&response, profile)?;
    response
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| CodexError::Protocol("thread/start did not return a thread id".to_owned()))
}

fn generation_matches(expected: &str, current: Option<&str>) -> bool {
    current == Some(expected)
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
    execution_profile: ResolvedExecutionProfile,
    thread_id: Mutex<Option<String>>,
    current_turn_id: Mutex<Option<String>>,
    pending_approvals: Mutex<HashMap<String, Value>>,
    state: Mutex<String>,
    sequence: AtomicU64,
    active: AtomicBool,
    turn_baselines: Mutex<HashMap<String, WorkspaceSnapshot>>,
    pending_turn_baseline: Mutex<Option<PreparedTurnBaseline>>,
    baseline_capture_lock: Mutex<()>,
    checkpoint_root: PathBuf,
}

struct PreparedTurnBaseline {
    internal_turn_id: String,
    snapshot: Result<WorkspaceSnapshot, String>,
}

impl CodexSession {
    #[allow(clippy::too_many_arguments)]
    fn new(
        app: AppHandle,
        db: SqlitePool,
        client: Arc<CodexClient>,
        session_id: String,
        workspace_id: String,
        generation_id: String,
        execution_profile: ResolvedExecutionProfile,
        checkpoint_root: PathBuf,
    ) -> Arc<Self> {
        Arc::new(Self {
            app,
            db,
            client,
            session_id,
            workspace_id,
            generation_id,
            execution_profile,
            thread_id: Mutex::new(None),
            current_turn_id: Mutex::new(None),
            pending_approvals: Mutex::new(HashMap::new()),
            state: Mutex::new("starting".to_owned()),
            sequence: AtomicU64::new(0),
            active: AtomicBool::new(true),
            turn_baselines: Mutex::new(HashMap::new()),
            pending_turn_baseline: Mutex::new(None),
            baseline_capture_lock: Mutex::new(()),
            checkpoint_root,
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

    async fn prepare_turn_baseline(&self) {
        let internal_turn_id = Ulid::new().to_string();
        let capture = match sqlx::query_scalar::<_, String>(
            "SELECT path FROM workspaces WHERE id = ?",
        )
        .bind(&self.workspace_id)
        .fetch_one(&self.db)
        .await
        {
            Ok(workspace_path) => match capture_workspace(Path::new(&workspace_path)).await {
                Ok(snapshot) => {
                    if let Err(error) = persist_baseline_checkpoint(
                        &self.checkpoint_root,
                        &self.session_id,
                        &internal_turn_id,
                        Path::new(&workspace_path),
                        &snapshot,
                    )
                    .await
                    {
                        warn!(session_id = %self.session_id, error = %error, "prepared baseline checkpoint capture failed");
                    }
                    Ok(snapshot)
                }
                Err(error) => Err(error),
            },
            Err(error) => Err(format!("read workspace for baseline: {error}")),
        };
        *self.pending_turn_baseline.lock().await = Some(PreparedTurnBaseline {
            internal_turn_id,
            snapshot: capture,
        });
    }

    async fn clear_pending_turn_baseline(&self) {
        if let Some(prepared) = self.pending_turn_baseline.lock().await.take() {
            if let Err(error) = discard_baseline_checkpoint(
                &self.checkpoint_root,
                &self.session_id,
                &prepared.internal_turn_id,
            )
            .await
            {
                warn!(session_id = %self.session_id, error = %error, "discard prepared baseline failed");
            }
        }
    }

    async fn capture_turn_baseline(
        &self,
        external_turn_id: &str,
        input_text: &str,
    ) -> Result<String, CodexError> {
        let _capture_guard = self.baseline_capture_lock.lock().await;
        if self
            .turn_baselines
            .lock()
            .await
            .contains_key(external_turn_id)
        {
            return self.ensure_turn(external_turn_id, input_text).await;
        }
        let prepared = self.pending_turn_baseline.lock().await.take();
        let internal_turn_id = if let Some(prepared) = prepared.as_ref() {
            let internal_turn_id = self
                .ensure_turn_with_id(
                    external_turn_id,
                    input_text,
                    Some(&prepared.internal_turn_id),
                )
                .await?;
            if internal_turn_id != prepared.internal_turn_id {
                relocate_baseline_checkpoint(
                    &self.checkpoint_root,
                    &self.session_id,
                    &prepared.internal_turn_id,
                    &internal_turn_id,
                )
                .await
                .map_err(CodexError::Session)?;
            }
            internal_turn_id
        } else {
            self.ensure_turn(external_turn_id, input_text).await?
        };
        if sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM turn_change_sets WHERE session_id = ? AND turn_id = ?",
        )
        .bind(&self.session_id)
        .bind(&internal_turn_id)
        .fetch_one(&self.db)
        .await?
            > 0
        {
            return Ok(internal_turn_id);
        }
        let snapshot = prepared
            .map(|prepared| prepared.snapshot)
            .unwrap_or_else(|| Err("turn baseline was not prepared before turn/start".to_owned()));
        match snapshot {
            Ok(snapshot) => {
                if let Err(error) = persist_checkpoint_metadata(
                    &self.db,
                    &self.checkpoint_root,
                    &self.workspace_id,
                    &self.session_id,
                    &internal_turn_id,
                    &snapshot,
                )
                .await
                {
                    warn!(session_id = %self.session_id, turn_id = %external_turn_id, error = %error, "checkpoint metadata persistence failed");
                }
                self.turn_baselines
                    .lock()
                    .await
                    .insert(external_turn_id.to_owned(), snapshot);
                Ok(internal_turn_id)
            }
            Err(error) => {
                self.emit_event(
                    "adapter.warning",
                    Some(external_turn_id.to_owned()),
                    json!({ "message": format!("turn baseline capture failed: {error}"), "phase": "baseline" }),
                    None,
                )
                .await?;
                Ok(internal_turn_id)
            }
        }
    }

    async fn finalize_turn_changes(&self, external_turn_id: &str) -> Result<(), CodexError> {
        let internal_turn = self.ensure_turn(external_turn_id, "").await?;
        let baseline = self.turn_baselines.lock().await.remove(external_turn_id);
        if baseline.is_none()
            && sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM turn_change_sets WHERE session_id = ? AND turn_id = ?",
            )
            .bind(&self.session_id)
            .bind(&internal_turn)
            .fetch_one(&self.db)
            .await?
                > 0
        {
            return Ok(());
        }
        let workspace_path: String = sqlx::query_scalar("SELECT path FROM workspaces WHERE id = ?")
            .bind(&self.workspace_id)
            .fetch_one(&self.db)
            .await?;
        let (result, capture_error) = match capture_workspace(Path::new(&workspace_path)).await {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error)),
        };
        persist_change_set(
            &self.db,
            &self.workspace_id,
            &self.session_id,
            &internal_turn,
            baseline.as_ref(),
            result.as_ref(),
            capture_error.as_deref(),
        )
        .await
        .map_err(CodexError::Database)?;
        if let Some(error) = capture_error {
            self.emit_event(
                "adapter.warning",
                Some(external_turn_id.to_owned()),
                json!({ "message": format!("turn result capture failed: {error}"), "phase": "result" }),
                None,
            )
            .await?;
        }
        Ok(())
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
        if let Some(event_thread_id) = event_thread_id(&params) {
            if let Some(bound_thread_id) = self.thread_id.lock().await.clone() {
                if event_thread_id != bound_thread_id {
                    return Ok(());
                }
            }
        }
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
                    self.capture_turn_baseline(turn_id, "").await?;
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
            "item/started"
            | "item/updated"
            | "item/completed"
            | "item/commandExecution/outputDelta"
            | "item/fileChange/outputDelta"
            | "item/mcpToolCall/progress" => {
                self.handle_tool_event(method, &params).await?;
            }
            "thread/tokenUsage/updated" | "turn/tokenUsage/updated" | "usage/updated" => {
                if let Some(usage) = usage_projection(&params) {
                    self.emit_event(
                        "usage.updated",
                        event_turn_id(&params),
                        json!({ "usage": usage }),
                        None,
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
                    self.finalize_turn_changes(turn_id).await?;
                    let output = final_turn_text(&turn);
                    let was_interrupted: Option<String> =
                        sqlx::query_scalar("SELECT status FROM turns WHERE id = ?")
                            .bind(&internal_turn_id)
                            .fetch_optional(&self.db)
                            .await?;
                    let mapped_status = if was_interrupted.as_deref() == Some("interrupted") {
                        "interrupted"
                    } else {
                        map_turn_status(status)
                    };
                    sqlx::query(
                        "UPDATE turns SET status = ?, output_text = ?, completed_at = ? WHERE id = ?",
                    )
                    .bind(mapped_status)
                    .bind(&output)
                    .bind(now_iso())
                    .bind(&internal_turn_id)
                    .execute(&self.db)
                    .await?;
                    if mapped_status == "completed" {
                        self.complete_assistant_messages(&internal_turn_id, &turn)
                            .await?;
                    } else {
                        sqlx::query(
                            "UPDATE messages SET status = 'failed', updated_at = ?
                             WHERE session_id = ? AND turn_id = ? AND role = 'assistant' AND status = 'streaming'",
                        )
                        .bind(now_iso())
                        .bind(&self.session_id)
                        .bind(&internal_turn_id)
                        .execute(&self.db)
                        .await?;
                    }
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
                let mut terminal_status = "failed";
                if let Some(turn_id) = turn_id.as_deref() {
                    let internal_turn_id = self.ensure_turn(turn_id, "").await?;
                    self.finalize_turn_changes(turn_id).await?;
                    let was_interrupted: Option<String> =
                        sqlx::query_scalar("SELECT status FROM turns WHERE id = ?")
                            .bind(&internal_turn_id)
                            .fetch_optional(&self.db)
                            .await?;
                    terminal_status = if was_interrupted.as_deref() == Some("interrupted") {
                        "interrupted"
                    } else {
                        "failed"
                    };
                    sqlx::query("UPDATE turns SET status = ?, completed_at = ? WHERE id = ?")
                        .bind(terminal_status)
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
                self.set_state(terminal_status).await?;
                self.emit_event(
                    "turn.failed",
                    turn_id,
                    json!({
                        "error": params.get("error").cloned().unwrap_or(Value::Null),
                        "status": terminal_status
                    }),
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
                        "command": params
                            .get("command")
                            .and_then(Value::as_str)
                            .map(|value| Value::String(sanitize_content("codex.command", value)))
                            .unwrap_or(Value::Null),
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
                // The provider can exit between `turn/start` and the event
                // loop recording `current_turn_id`. Recover the durable
                // running turn as a fallback so a crash never leaves a
                // streaming/queued timeline stuck indefinitely.
                let turn_id = if let Some(turn_id) = self.current_turn_id.lock().await.clone() {
                    Some(turn_id)
                } else {
                    sqlx::query_scalar::<_, String>(
                        "SELECT external_turn_id FROM turns
                         WHERE session_id = ? AND status = 'running'
                         ORDER BY started_at DESC, id DESC LIMIT 1",
                    )
                    .bind(&self.session_id)
                    .fetch_optional(&self.db)
                    .await?
                };
                if let Some(turn_id) = turn_id {
                    if let Ok(internal_turn_id) = self.ensure_turn(&turn_id, "").await {
                        if let Err(error) = self.finalize_turn_changes(&turn_id).await {
                            warn!(session_id = %self.session_id, turn_id = %turn_id, error = %error, "Codex crash result capture failed");
                        }
                        mark_turn_interrupted(&self.db, &self.session_id, &internal_turn_id)
                            .await?;
                    }
                }
                *self.current_turn_id.lock().await = None;
                let discarded_approvals = self.pending_approvals.lock().await.len();
                self.pending_approvals.lock().await.clear();
                self.set_state("interrupted").await?;
                self.emit_event(
                    "adapter.crashed",
                    None,
                    json!({
                        "reason": params.get("reason").cloned().unwrap_or(Value::Null),
                        "pendingApprovalCount": discarded_approvals,
                        "approvalsDiscarded": discarded_approvals > 0
                    }),
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
        Ok(generation_matches(
            &self.generation_id,
            generation.as_deref(),
        ))
    }

    async fn set_thread_id(&self, thread_id: String) {
        *self.thread_id.lock().await = Some(thread_id);
    }

    async fn ensure_turn(
        &self,
        external_turn_id: &str,
        input_text: &str,
    ) -> Result<String, CodexError> {
        self.ensure_turn_with_id(external_turn_id, input_text, None)
            .await
    }

    async fn ensure_turn_with_id(
        &self,
        external_turn_id: &str,
        input_text: &str,
        preferred_id: Option<&str>,
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
        let id = preferred_id
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Ulid::new().to_string());
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

    async fn handle_tool_event(&self, method: &str, params: &Value) -> Result<(), CodexError> {
        let Some(event_type) = tool_event_kind(method) else {
            return Ok(());
        };
        let Some(projection) = tool_projection(method, params) else {
            return Ok(());
        };
        // Tool output and command previews are persisted in the timeline and
        // emitted to the WebView. Keep the command execution result usable
        // for the adapter, but redact secrets in every durable/UI projection.
        let is_command = projection
            .item_type
            .to_ascii_lowercase()
            .contains("command");
        let safe_command = projection.command.as_deref().map(|value| {
            if is_command {
                sanitize_content("codex.command", value)
            } else {
                value.to_owned()
            }
        });
        let safe_delta = projection.delta.as_deref().map(|value| {
            if is_command {
                sanitize_content("codex.command", value)
            } else {
                value.to_owned()
            }
        });
        let safe_output = projection.output.as_deref().map(|value| {
            if is_command {
                sanitize_content("codex.command", value)
            } else {
                value.to_owned()
            }
        });
        let safe_summary = if is_command {
            sanitize_content("codex.command", &projection.summary)
        } else {
            projection.summary.clone()
        };
        let external_turn_id = event_turn_id(params);
        let internal_turn_id = if let Some(turn_id) = external_turn_id.as_deref() {
            Some(self.ensure_turn(turn_id, "").await?)
        } else {
            None
        };
        let status = map_tool_status(&projection.status, event_type);
        let now = now_iso();
        let updated = if method.ends_with("outputDelta") || method == "item/mcpToolCall/progress" {
            sqlx::query(
                "UPDATE messages SET content = content || ?, tool_name = COALESCE(?, tool_name),
                        tool_command = COALESCE(?, tool_command), tool_cwd = COALESCE(?, tool_cwd),
                        tool_exit_code = COALESCE(?, tool_exit_code), turn_id = COALESCE(?, turn_id),
                        status = ?, updated_at = ?
                 WHERE session_id = ? AND external_message_id = ? AND role = 'tool'",
            )
            .bind(safe_delta.as_deref().unwrap_or(&safe_summary))
            .bind(&projection.item_type)
            .bind(&safe_command)
            .bind(&projection.cwd)
            .bind(projection.exit_code)
            .bind(internal_turn_id.as_deref())
            .bind(status)
            .bind(&now)
            .bind(&self.session_id)
            .bind(&projection.item_id)
            .execute(&self.db)
            .await?
        } else {
            let replace_content = method == "item/started" || safe_output.is_some();
            sqlx::query(
                "UPDATE messages SET content = CASE WHEN ? = 1 OR content = '' THEN ? ELSE content END,
                        tool_name = COALESCE(?, tool_name),
                        tool_command = COALESCE(?, tool_command), tool_cwd = COALESCE(?, tool_cwd),
                        tool_exit_code = COALESCE(?, tool_exit_code),
                        turn_id = COALESCE(?, turn_id),
                        status = ?, updated_at = ?
                 WHERE session_id = ? AND external_message_id = ? AND role = 'tool'",
            )
            .bind(if replace_content { 1_i64 } else { 0_i64 })
            .bind(&safe_summary)
            .bind(&projection.item_type)
            .bind(&safe_command)
            .bind(&projection.cwd)
            .bind(projection.exit_code)
            .bind(internal_turn_id.as_deref())
            .bind(status)
            .bind(&now)
            .bind(&self.session_id)
            .bind(&projection.item_id)
            .execute(&self.db)
            .await?
        };
        if updated.rows_affected() == 0 {
            sqlx::query(
                "INSERT INTO messages
                 (id, session_id, turn_id, external_message_id, role, tool_name,
                  tool_command, tool_cwd, tool_exit_code, content, status, sequence,
                  created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'tool', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Ulid::new().to_string())
            .bind(&self.session_id)
            .bind(&internal_turn_id)
            .bind(&projection.item_id)
            .bind(&projection.item_type)
            .bind(&safe_command)
            .bind(&projection.cwd)
            .bind(projection.exit_code)
            .bind(&safe_summary)
            .bind(status)
            .bind(self.sequence.load(Ordering::Relaxed) as i64)
            .bind(&now)
            .bind(&now)
            .execute(&self.db)
            .await?;
        }
        if event_type == "tool.completed" {
            if let (Some(output), Some(turn_id)) =
                (safe_output.as_deref(), internal_turn_id.as_deref())
            {
                if is_command {
                    let artifact_root = artifact_root_from_checkpoint(&self.checkpoint_root);
                    if let Err(error) = persist_text(
                        &self.db,
                        &artifact_root,
                        &self.workspace_id,
                        &self.session_id,
                        Some(turn_id),
                        "codex.command",
                        "text/plain",
                        output,
                    )
                    .await
                    {
                        warn!(session_id = %self.session_id, error = %error, "unable to persist Codex command artifact");
                    }
                }
            }
        }
        self.emit_event(
            event_type,
            external_turn_id,
            json!({
                "itemId": projection.item_id,
                "itemType": projection.item_type,
                "status": status,
                "summary": safe_summary,
                "delta": safe_delta,
                "output": safe_output
            }),
            Some(json!({ "itemId": projection.item_id })),
        )
        .await
    }

    async fn complete_assistant_messages(
        &self,
        turn_id: &str,
        turn: &Value,
    ) -> Result<(), CodexError> {
        let now = now_iso();
        let mut projected_any = false;
        // A turn may contain multiple agentMessage items (for example commentary and a
        // final answer). Reconcile each item by its external ID instead of copying the
        // concatenated turn text into every assistant row.
        for (external_message_id, text) in agent_message_items(turn) {
            let Some(external_message_id) = external_message_id else {
                continue;
            };
            let updated = sqlx::query(
                "UPDATE messages SET content = CASE WHEN ? <> '' THEN ? ELSE content END,
                        turn_id = ?, status = 'completed', updated_at = ?
                 WHERE session_id = ? AND external_message_id = ? AND role = 'assistant'",
            )
            .bind(&text)
            .bind(&text)
            .bind(turn_id)
            .bind(&now)
            .bind(&self.session_id)
            .bind(&external_message_id)
            .execute(&self.db)
            .await?;
            if updated.rows_affected() > 0 {
                projected_any = true;
            } else if !text.is_empty() {
                sqlx::query(
                    "INSERT OR IGNORE INTO messages
                     (id, session_id, turn_id, external_message_id, role, content, status,
                      sequence, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 'assistant', ?, 'completed', ?, ?, ?)",
                )
                .bind(Ulid::new().to_string())
                .bind(&self.session_id)
                .bind(turn_id)
                .bind(&external_message_id)
                .bind(&text)
                .bind(self.sequence.load(Ordering::Relaxed) as i64)
                .bind(&now)
                .bind(&now)
                .execute(&self.db)
                .await?;
                projected_any = true;
            }
        }

        let completed = sqlx::query(
            "UPDATE messages SET status = 'completed', updated_at = ?
             WHERE session_id = ? AND turn_id = ? AND role = 'assistant'",
        )
        .bind(&now)
        .bind(&self.session_id)
        .bind(turn_id)
        .execute(&self.db)
        .await?;
        projected_any |= completed.rows_affected() > 0;

        let output = final_turn_text(turn);
        if !projected_any && !output.is_empty() {
            sqlx::query(
                "INSERT OR IGNORE INTO messages
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
    agent_message_items(turn)
        .into_iter()
        .map(|(_, text)| text)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn agent_message_items(turn: &Value) -> Vec<(Option<String>, String)> {
    turn.get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("agentMessage"))
        .map(|item| {
            (
                item.get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                item.get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect()
}

#[derive(Clone)]
pub(crate) struct CodexManager {
    app: AppHandle,
    db: SqlitePool,
    sessions: Arc<Mutex<HashMap<String, Arc<CodexSession>>>>,
    checkpoint_root: PathBuf,
}

impl CodexManager {
    pub(crate) fn new(app: AppHandle, db: SqlitePool, data_dir: PathBuf) -> Self {
        Self {
            app,
            db,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            checkpoint_root: data_dir.join("checkpoints"),
        }
    }

    pub(crate) async fn create_session(
        &self,
        workspace_id: &str,
        profile: &ResolvedExecutionProfile,
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
            profile.clone(),
            self.checkpoint_root.clone(),
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
                codex_thread_start_params(&workspace.path, profile),
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
        if let Err(error) = validate_codex_thread_start_response(&started, profile) {
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
        self.ensure_runtime_with_recovery(session_id, true).await
    }

    async fn ensure_runtime_with_recovery(
        &self,
        session_id: &str,
        recover_missing_rollout: bool,
    ) -> Result<Arc<CodexSession>, CodexError> {
        let cached_session = clone_cached_runtime(&self.sessions, session_id).await;
        if let Some(session) = cached_session {
            if !session.client.closed.load(Ordering::SeqCst) {
                return Ok(session);
            }
            remove_cached_runtime(&self.sessions, session_id).await;
        }
        let session = session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        if session.agent != "codex" {
            return Err(CodexError::Session(
                "session is not a Codex session".to_owned(),
            ));
        }
        if session.archived {
            return Err(CodexError::Session(
                "archived Codex session must be unarchived before use".to_owned(),
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
        let execution_profile = session_execution_profile(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
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
            execution_profile.profile,
            self.checkpoint_root.clone(),
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
        let mut rebound_from = None;
        if let Err(error) = client
            .request("thread/resume", json!({ "threadId": thread_id }))
            .await
        {
            if recover_missing_rollout && is_missing_rollout_error(&error) {
                // Some Codex versions index a thread at thread/start but do
                // not materialize its rollout until the first turn. Once the
                // runtime is recreated, thread/resume then fails even though
                // the Aibo binding is otherwise valid. Start a replacement
                // thread and keep the logical Aibo session usable.
                warn!(
                    session_id = %session_id,
                    thread_id = %thread_id,
                    "Codex rollout is unavailable; starting a replacement thread"
                );
                let replacement = match start_thread(
                    &client,
                    &workspace_path,
                    &runtime.execution_profile,
                )
                .await
                {
                    Ok(thread_id) => thread_id,
                    Err(start_error) => {
                        runtime.deactivate();
                        self.sessions.lock().await.remove(session_id);
                        client.close().await;
                        let _ = sqlx::query(
                            "UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?",
                        )
                        .bind(now_iso())
                        .bind(session_id)
                        .execute(&self.db)
                        .await;
                        return Err(start_error);
                    }
                };
                runtime.set_thread_id(replacement.clone()).await;
                sqlx::query(
                    "UPDATE session_bindings SET external_session_id = ? WHERE session_id = ?",
                )
                .bind(&replacement)
                .bind(session_id)
                .execute(&self.db)
                .await?;
                rebound_from = Some((thread_id, replacement));
            } else {
                runtime.deactivate();
                self.sessions.lock().await.remove(session_id);
                client.close().await;
                let _ = sqlx::query(
                    "UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?",
                )
                .bind(now_iso())
                .bind(session_id)
                .execute(&self.db)
                .await;
                return Err(error);
            }
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
        if let Some((previous_thread_id, replacement_thread_id)) = rebound_from {
            if let Err(error) = runtime
                .emit_event(
                    "adapter.warning",
                    None,
                    json!({
                        "kind": "session.binding_recovered",
                        "previousExternalSessionId": previous_thread_id,
                        "externalSessionId": replacement_thread_id,
                        "reason": "rollout_not_found",
                    }),
                    None,
                )
                .await
            {
                warn!(
                    session_id = %session_id,
                    error = %error,
                    "unable to persist Codex rollout recovery notice"
                );
            }
        }
        Ok(runtime)
    }

    async fn open_bound_client(
        &self,
        session_id: &str,
    ) -> Result<(super::Session, String, Arc<CodexClient>), CodexError> {
        let session = session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        if session.agent != "codex" {
            return Err(CodexError::Session(
                "session is not a Codex session".to_owned(),
            ));
        }
        let thread_id: String = sqlx::query_scalar(
            "SELECT external_session_id FROM session_bindings WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_optional(&self.db)
        .await?
        .flatten()
        .ok_or_else(|| {
            CodexError::Session("Codex session has no external thread binding".to_owned())
        })?;
        let workspace_path: String = sqlx::query_scalar("SELECT path FROM workspaces WHERE id = ?")
            .bind(&session.workspace_id)
            .fetch_one(&self.db)
            .await?;
        let codex_path = find_executable("codex").ok_or(CodexError::MissingExecutable)?;
        let client = CodexClient::spawn(codex_path, Path::new(&workspace_path)).await?;
        if let Err(error) = initialize_client(&client).await {
            client.close().await;
            return Err(error);
        }
        Ok((session, thread_id, client))
    }

    pub(crate) async fn read_thread(
        &self,
        session_id: &str,
    ) -> Result<CodexThreadSnapshot, CodexError> {
        let (_, thread_id, client) = self.open_bound_client(session_id).await?;
        let result = async {
            let response = client
                .request(
                    "thread/read",
                    json!({ "threadId": thread_id, "includeTurns": true }),
                )
                .await?;
            let snapshot = parse_thread_snapshot(&response)?;
            matching_thread_id(&thread_id, &snapshot.id)?;
            Ok(snapshot)
        }
        .await;
        client.close().await;
        result
    }

    pub(crate) async fn fork(
        &self,
        session_id: &str,
        through_turn_id: Option<&str>,
    ) -> Result<super::Session, CodexError> {
        let source = super::session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        if source.agent != "codex" {
            return Err(CodexError::Session(
                "session is not a Codex session".to_owned(),
            ));
        }
        if source.archived {
            return Err(CodexError::Session(
                "archived Codex sessions cannot be forked".to_owned(),
            ));
        }
        let source_runtime = self.ensure_runtime(session_id).await?;
        {
            let state = source_runtime.state.lock().await;
            if matches!(state.as_str(), "running" | "waiting_approval") {
                return Err(CodexError::Session(
                    "Codex session must be idle before it is forked".to_owned(),
                ));
            }
        }
        let source_thread_id = source_runtime
            .thread_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| CodexError::Session("Codex session has no thread id".to_owned()))?;

        let requested_last_turn = if let Some(turn_id) = through_turn_id {
            let exists: Option<String> = sqlx::query_scalar(
                "SELECT external_turn_id FROM turns
                 WHERE session_id = ? AND external_turn_id = ? AND status = 'completed'",
            )
            .bind(session_id)
            .bind(turn_id)
            .fetch_optional(&self.db)
            .await?;
            if exists.is_none() {
                return Err(CodexError::Session(
                    "fork boundary must reference a completed turn".to_owned(),
                ));
            }
            Some(turn_id.to_owned())
        } else {
            sqlx::query_scalar(
                "SELECT external_turn_id FROM turns
                 WHERE session_id = ? AND status = 'completed'
                 ORDER BY started_at DESC, id DESC LIMIT 1",
            )
            .bind(session_id)
            .fetch_optional(&self.db)
            .await?
        };

        let workspace = workspace_by_id(&self.db, &source.workspace_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        let codex_path = find_executable("codex").ok_or(CodexError::MissingExecutable)?;
        let fork_client = CodexClient::spawn(codex_path, Path::new(&workspace.path)).await?;
        let fork_result = async {
            initialize_client(&fork_client).await?;
            let mut params = json!({ "threadId": source_thread_id });
            if let Some(last_turn_id) = requested_last_turn.as_deref() {
                params["lastTurnId"] = json!(last_turn_id);
            }
            let response = fork_client.request("thread/fork", params).await?;
            parse_forked_thread(&response)
        }
        .await;
        fork_client.close().await;
        let (forked_thread_id, parent_thread_id) = fork_result?;
        if forked_thread_id == source_thread_id {
            return Err(CodexError::Protocol(
                "thread/fork returned the source thread id".to_owned(),
            ));
        }
        if let Some(parent_thread_id) = parent_thread_id.as_deref() {
            matching_thread_id(&source_thread_id, parent_thread_id)?;
        }

        let new_session_id = Ulid::new().to_string();
        let generation_id = Ulid::new().to_string();
        let now = now_iso();
        let label = format!("{} · 分支", source.label);
        let parent_thread_id = parent_thread_id.unwrap_or_else(|| source_thread_id.clone());
        let mut transaction = self.db.begin().await?;
        sqlx::query(
            "INSERT INTO sessions
             (id, workspace_id, agent, label, state, archived, created_at, updated_at)
             VALUES (?, ?, 'codex', ?, 'starting', 0, ?, ?)",
        )
        .bind(&new_session_id)
        .bind(&source.workspace_id)
        .bind(&label)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO session_bindings
             (session_id, external_session_id, generation_id, adapter_version,
              parent_external_session_id, bound_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&new_session_id)
        .bind(&forked_thread_id)
        .bind(&generation_id)
        .bind(CODEX_ADAPTER_VERSION)
        .bind(&parent_thread_id)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;

        let source_turns = sqlx::query(
            "SELECT id, external_turn_id, status, input_text, output_text,
                    started_at, completed_at
             FROM turns WHERE session_id = ? ORDER BY started_at ASC, id ASC",
        )
        .bind(session_id)
        .fetch_all(&mut *transaction)
        .await?;
        let mut turn_ids = HashMap::new();
        for row in source_turns {
            let old_id: String = row.try_get("id")?;
            let external_turn_id: String = row.try_get("external_turn_id")?;
            let new_id = Ulid::new().to_string();
            turn_ids.insert(old_id, new_id.clone());
            sqlx::query(
                "INSERT INTO turns
                 (id, session_id, external_turn_id, status, input_text, output_text,
                  started_at, completed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&new_id)
            .bind(&new_session_id)
            .bind(&external_turn_id)
            .bind(row.try_get::<String, _>("status")?)
            .bind(row.try_get::<String, _>("input_text")?)
            .bind(row.try_get::<String, _>("output_text")?)
            .bind(row.try_get::<String, _>("started_at")?)
            .bind(row.try_get::<Option<String>, _>("completed_at")?)
            .execute(&mut *transaction)
            .await?;
            if requested_last_turn.as_deref() == Some(external_turn_id.as_str()) {
                break;
            }
        }

        let source_messages = sqlx::query(
            "SELECT turn_id, external_message_id, role, tool_name, content, status,
                    sequence, created_at, updated_at
             FROM messages WHERE session_id = ?
             ORDER BY created_at ASC, sequence ASC, id ASC",
        )
        .bind(session_id)
        .fetch_all(&mut *transaction)
        .await?;
        for row in source_messages {
            let old_turn_id = row.try_get::<Option<String>, _>("turn_id")?;
            let new_turn_id = old_turn_id
                .as_ref()
                .and_then(|id| turn_ids.get(id))
                .cloned();
            if old_turn_id.is_some() && new_turn_id.is_none() {
                continue;
            }
            sqlx::query(
                "INSERT INTO messages
                 (id, session_id, turn_id, external_message_id, role, tool_name, content,
                  status, sequence, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Ulid::new().to_string())
            .bind(&new_session_id)
            .bind(new_turn_id)
            .bind(row.try_get::<Option<String>, _>("external_message_id")?)
            .bind(row.try_get::<String, _>("role")?)
            .bind(row.try_get::<Option<String>, _>("tool_name")?)
            .bind(row.try_get::<String, _>("content")?)
            .bind(row.try_get::<String, _>("status")?)
            .bind(row.try_get::<i64, _>("sequence")?)
            .bind(row.try_get::<String, _>("created_at")?)
            .bind(row.try_get::<String, _>("updated_at")?)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;

        if let Err(error) = self.ensure_runtime(&new_session_id).await {
            let _ =
                sqlx::query("UPDATE sessions SET state = 'failed', updated_at = ? WHERE id = ?")
                    .bind(now_iso())
                    .bind(&new_session_id)
                    .execute(&self.db)
                    .await;
            return Err(error);
        }
        super::session_by_id(&self.db, &new_session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))
    }

    async fn archive_without_remote_rollout(
        &self,
        session_id: &str,
    ) -> Result<super::Session, CodexError> {
        if let Some(session) = remove_cached_runtime(&self.sessions, session_id).await {
            session.deactivate();
            session.client.close().await;
        }
        sqlx::query(
            "UPDATE sessions SET archived = 1, state = 'closed', updated_at = ? WHERE id = ?",
        )
        .bind(now_iso())
        .bind(session_id)
        .execute(&self.db)
        .await?;
        super::session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))
    }

    pub(crate) async fn archive(&self, session_id: &str) -> Result<super::Session, CodexError> {
        let existing = super::session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        if existing.agent != "codex" {
            return Err(CodexError::Session(
                "session is not a Codex session".to_owned(),
            ));
        }
        if existing.archived {
            return Ok(existing);
        }
        let session = match self.ensure_runtime_with_recovery(session_id, false).await {
            Ok(session) => session,
            Err(error) if is_missing_rollout_error(&error) => {
                // The remote rollout is already gone, so archiving locally is
                // the only meaningful cleanup and should remain available.
                return self.archive_without_remote_rollout(session_id).await;
            }
            Err(error) => return Err(error),
        };
        {
            let state = session.state.lock().await;
            if matches!(state.as_str(), "running" | "waiting_approval") {
                return Err(CodexError::Session(
                    "Codex session must be idle before it is archived".to_owned(),
                ));
            }
        }
        let thread_id = session
            .thread_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| CodexError::Session("Codex session has no thread id".to_owned()))?;
        if let Err(error) = session
            .client
            .request("thread/archive", json!({ "threadId": thread_id }))
            .await
        {
            if is_missing_rollout_error(&error) {
                return self.archive_without_remote_rollout(session_id).await;
            }
            return Err(error);
        }
        session.set_state("closed").await?;
        sqlx::query("UPDATE sessions SET archived = 1, updated_at = ? WHERE id = ?")
            .bind(now_iso())
            .bind(session_id)
            .execute(&self.db)
            .await?;
        session.deactivate();
        self.sessions.lock().await.remove(session_id);
        session.client.close().await;
        super::session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))
    }

    pub(crate) async fn unarchive(&self, session_id: &str) -> Result<super::Session, CodexError> {
        let existing = super::session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))?;
        if existing.agent != "codex" {
            return Err(CodexError::Session(
                "session is not a Codex session".to_owned(),
            ));
        }
        if !existing.archived {
            return Ok(existing);
        }
        let (_, thread_id, client) = self.open_bound_client(session_id).await?;
        let result = match client
            .request("thread/unarchive", json!({ "threadId": thread_id }))
            .await
        {
            Ok(response) => {
                let snapshot = parse_thread_snapshot(&response)?;
                matching_thread_id(&thread_id, &snapshot.id)
            }
            Err(error) if is_missing_rollout_error(&error) => {
                // The archived rollout may have been pruned externally. A
                // fresh thread is the only resumable representation left for
                // this logical Aibo session.
                let workspace_path: String =
                    sqlx::query_scalar("SELECT path FROM workspaces WHERE id = ?")
                        .bind(&existing.workspace_id)
                        .fetch_one(&self.db)
                        .await?;
                let profile = session_execution_profile(&self.db, session_id)
                    .await
                    .map_err(|error| CodexError::Session(error.to_string()))?;
                let replacement = start_thread(&client, &workspace_path, &profile.profile).await?;
                sqlx::query(
                    "UPDATE session_bindings SET external_session_id = ? WHERE session_id = ?",
                )
                .bind(replacement)
                .bind(session_id)
                .execute(&self.db)
                .await?;
                Ok(())
            }
            Err(error) => Err(error),
        };
        client.close().await;
        result?;
        sqlx::query(
            "UPDATE sessions SET archived = 0, state = 'closed', updated_at = ? WHERE id = ?",
        )
        .bind(now_iso())
        .bind(session_id)
        .execute(&self.db)
        .await?;
        super::session_by_id(&self.db, session_id)
            .await
            .map_err(|error| CodexError::Session(error.to_string()))
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
        // Capture before turn/start is sent: the provider can begin tool
        // execution before either the response or turn/started event arrives.
        session.prepare_turn_baseline().await;
        let turn_params = codex_turn_start_params(&thread_id, input, &session.execution_profile);
        let response = match session.client.request("turn/start", turn_params).await {
            Ok(response) => response,
            Err(error) => {
                session.clear_pending_turn_baseline().await;
                let _ = session.set_state("failed").await;
                return Err(error);
            }
        };
        let Some(turn_id) = response
            .pointer("/result/turn/id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        else {
            session.clear_pending_turn_baseline().await;
            let _ = session.set_state("failed").await;
            return Err(CodexError::Protocol(
                "turn/start did not return a turn id".to_owned(),
            ));
        };
        *session.current_turn_id.lock().await = Some(turn_id.clone());
        let internal_turn_id = session.capture_turn_baseline(&turn_id, input).await?;
        sqlx::query("UPDATE messages SET turn_id = ?, updated_at = ? WHERE id = ?")
            .bind(&internal_turn_id)
            .bind(now_iso())
            .bind(user_message_id)
            .execute(&self.db)
            .await?;
        bind_pending_attachments_to_turn(&self.db, session_id, &internal_turn_id).await?;
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
        // Do not depend solely on a provider terminal event to make an
        // interrupted turn durable. The request can succeed while the
        // terminal notification is delayed or lost; capture the result now
        // so Changes and restart recovery have a safe boundary. A later
        // terminal event is reconciled idempotently by finalize_turn_changes.
        let internal_turn_id = session.ensure_turn(&turn_id, "").await?;
        session.finalize_turn_changes(&turn_id).await?;
        sqlx::query("UPDATE turns SET status = 'interrupted', completed_at = ? WHERE id = ?")
            .bind(now_iso())
            .bind(&internal_turn_id)
            .execute(&self.db)
            .await?;
        sqlx::query(
            "UPDATE messages SET status = 'failed', updated_at = ?
             WHERE session_id = ? AND turn_id = ? AND role = 'assistant' AND status = 'streaming'",
        )
        .bind(now_iso())
        .bind(&session.session_id)
        .bind(&internal_turn_id)
        .execute(&self.db)
        .await?;
        *session.current_turn_id.lock().await = None;
        session.set_state("interrupted").await
    }

    pub(crate) async fn close(&self, session_id: &str) -> Result<(), CodexError> {
        let session = remove_cached_runtime(&self.sessions, session_id).await;
        if let Some(session) = session {
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
        agent_message_items, codex_thread_start_params, codex_turn_start_params, event_thread_id,
        final_turn_text, generation_matches, is_missing_rollout_error, map_tool_status,
        map_turn_status, matching_thread_id, parse_forked_thread, parse_thread_list,
        parse_thread_snapshot, tool_projection, usage_projection,
        validate_codex_thread_start_response, value_id,
    };
    use crate::execution_profile::{
        ExecutionProfile, ResolvedExecutionProfile, EXECUTION_PROFILE_SCHEMA,
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
        assert_eq!(
            agent_message_items(&turn),
            vec![(None, "first".to_owned()), (None, "second".to_owned())]
        );
        let multi_item_turn = json!({
            "items": [
                { "type": "agentMessage", "id": "message-1", "text": "commentary" },
                { "type": "agentMessage", "id": "message-2", "text": "final" }
            ]
        });
        assert_eq!(
            agent_message_items(&multi_item_turn),
            vec![
                (Some("message-1".to_owned()), "commentary".to_owned()),
                (Some("message-2".to_owned()), "final".to_owned())
            ]
        );
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

    #[test]
    fn parses_fork_response_and_preserves_parent_thread_id() {
        let response = json!({
            "result": {
                "thread": {
                    "id": "thread-child",
                    "sessionId": "thread-root",
                    "forkedFromId": "thread-parent"
                }
            }
        });
        let (thread_id, parent_id) = parse_forked_thread(&response).expect("thread/fork response");
        assert_eq!(thread_id, "thread-child");
        assert_eq!(parent_id.as_deref(), Some("thread-parent"));
    }

    #[test]
    fn normalizes_tool_item_lifecycle_and_usage_fixture() {
        let fixture = include_str!("../../fixtures/codex/events.tools.redacted.jsonl");
        let mut methods = Vec::new();
        for line in fixture.lines() {
            let record: serde_json::Value = serde_json::from_str(line).expect("fixture JSON");
            let payload = &record["payload"];
            if let Some(method) = payload.get("method").and_then(serde_json::Value::as_str) {
                methods.push(method.to_owned());
                if method == "item/started" {
                    let projection = tool_projection(method, &payload["params"])
                        .expect("tool started projection");
                    assert_eq!(projection.item_id, "tool-1");
                    assert_eq!(projection.item_type, "commandExecution");
                    assert_eq!(projection.command.as_deref(), Some("pwd"));
                    assert_eq!(projection.cwd.as_deref(), Some("<workspace>"));
                    assert_eq!(projection.summary, "pwd");
                }
                if method == "item/completed" {
                    let projection = tool_projection(method, &payload["params"])
                        .expect("tool completed projection");
                    assert!(projection.summary.contains("<workspace>"));
                    assert!(projection.output.is_some());
                }
                if method == "turn/tokenUsage/updated" {
                    let usage = usage_projection(&payload["params"]).expect("usage projection");
                    assert_eq!(usage["totalTokens"], 19);
                }
            }
        }
        assert_eq!(methods[2], "item/started");
        assert_eq!(map_tool_status("completed", "tool.completed"), "completed");
        assert_eq!(map_tool_status("declined", "tool.completed"), "failed");
    }

    #[test]
    fn redacts_command_output_before_projection() {
        let projection = tool_projection(
            "item/completed",
            &json!({
                "item": {
                    "id": "tool-secret",
                    "type": "commandExecution",
                    "command": "echo token=secret-value",
                    "aggregatedOutput": "token=secret-value"
                }
            }),
        )
        .expect("command projection");
        assert_eq!(projection.output.as_deref(), Some("token=[REDACTED]"));
        assert!(projection.summary.contains("[REDACTED]"));
    }

    #[test]
    fn rejects_events_from_a_different_thread_binding() {
        assert!(matching_thread_id("thread-1", "thread-1").is_ok());
        assert!(matching_thread_id("thread-1", "thread-2").is_err());
        let params = serde_json::json!({ "thread": { "id": "thread-1" } });
        assert_eq!(event_thread_id(&params), Some("thread-1"));
    }

    #[test]
    fn rejects_late_events_from_an_old_generation() {
        assert!(generation_matches("generation-2", Some("generation-2")));
        assert!(!generation_matches("generation-2", Some("generation-1")));
        assert!(!generation_matches("generation-2", None));
    }

    #[test]
    fn recognizes_only_missing_rollout_request_errors() {
        assert!(is_missing_rollout_error(&super::CodexError::Request(
            r#"{"code":-32600,"message":"no rollout found for thread id thread-1"}"#.to_owned(),
        )));
        assert!(is_missing_rollout_error(&super::CodexError::Request(
            r#"{"code":-32600,"message":"thread not loaded: thread-1"}"#.to_owned(),
        )));
        assert!(!is_missing_rollout_error(&super::CodexError::Request(
            r#"{"code":-32600,"message":"failed to load configuration: config.toml"}"#.to_owned(),
        )));
        assert!(!is_missing_rollout_error(&super::CodexError::Protocol(
            "no rollout found".to_owned(),
        )));
    }

    #[test]
    fn maps_codex_profile_overrides_to_thread_and_turn_requests() {
        let profile = ResolvedExecutionProfile {
            schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
            requested: ExecutionProfile {
                schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
                interaction_mode: "edit".to_owned(),
                approval_policy: "on-request".to_owned(),
                filesystem_policy: "workspace-write".to_owned(),
                command_policy: "approved".to_owned(),
                network_policy: "disabled".to_owned(),
                model: Some("gpt-test".to_owned()),
                reasoning_effort: Some("high".to_owned()),
            },
            enforced: ExecutionProfile {
                schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
                interaction_mode: "edit".to_owned(),
                approval_policy: "on-request".to_owned(),
                filesystem_policy: "workspace-write".to_owned(),
                command_policy: "approved".to_owned(),
                network_policy: "disabled".to_owned(),
                model: Some("gpt-test".to_owned()),
                reasoning_effort: Some("high".to_owned()),
            },
            unsupported: Vec::new(),
            adapter_capabilities: Vec::new(),
            native_sandbox: true,
            resolved_at: "now".to_owned(),
        };
        let thread = codex_thread_start_params("/tmp/workspace", &profile);
        assert_eq!(thread["model"], "gpt-test");
        assert_eq!(thread["allowProviderModelFallback"], false);
        assert_eq!(thread["sandbox"], "workspace-write");
        let turn = codex_turn_start_params("thread-1", "hello", &profile);
        assert_eq!(turn["model"], "gpt-test");
        assert_eq!(turn["effort"], "high");
        assert_eq!(turn["threadId"], "thread-1");
    }

    #[test]
    fn rejects_codex_thread_start_when_provider_downgrades_profile() {
        let profile = ResolvedExecutionProfile {
            schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
            requested: ExecutionProfile {
                schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
                interaction_mode: "edit".to_owned(),
                approval_policy: "on-request".to_owned(),
                filesystem_policy: "workspace-write".to_owned(),
                command_policy: "approved".to_owned(),
                network_policy: "disabled".to_owned(),
                model: Some("gpt-test".to_owned()),
                reasoning_effort: Some("high".to_owned()),
            },
            enforced: ExecutionProfile {
                schema: EXECUTION_PROFILE_SCHEMA.to_owned(),
                interaction_mode: "edit".to_owned(),
                approval_policy: "on-request".to_owned(),
                filesystem_policy: "workspace-write".to_owned(),
                command_policy: "approved".to_owned(),
                network_policy: "disabled".to_owned(),
                model: Some("gpt-test".to_owned()),
                reasoning_effort: Some("high".to_owned()),
            },
            unsupported: Vec::new(),
            adapter_capabilities: Vec::new(),
            native_sandbox: true,
            resolved_at: "now".to_owned(),
        };
        let response = json!({
            "result": {
                "approvalPolicy": "on-request",
                "sandbox": { "type": "readOnly" },
                "model": "gpt-test",
                "reasoningEffort": null
            }
        });
        assert!(validate_codex_thread_start_response(&response, &profile).is_err());
        let mut downgraded = response;
        downgraded["result"]["sandbox"]["type"] = json!("workspaceWrite");
        assert!(validate_codex_thread_start_response(&downgraded, &profile).is_ok());
        downgraded["result"]["model"] = json!("gpt-default");
        assert!(validate_codex_thread_start_response(&downgraded, &profile).is_err());
    }
}
