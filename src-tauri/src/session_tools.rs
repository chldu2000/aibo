use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use regex::RegexBuilder;
use crate::workspace_guard::canonicalize_target;
use crate::artifact::sanitize_content;
const MAX_READ_BYTES:u64=512*1024;
const MAX_COMMAND_BYTES:usize=16*1024;
fn truncate_command_output(value:&str)->String { value.chars().take(64_000).collect() }
fn wildcard_regex(pattern: &str, case_insensitive: bool) -> Result<regex::Regex, String> {
    let mut expression = String::from("^");
    let characters = pattern.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == '*' && characters.get(index + 1) == Some(&'*') && characters.get(index + 2) == Some(&'/') {
            expression.push_str("(?:.*/)?");
            index += 3;
            continue;
        }
        match character {
            '*' => expression.push_str(".*"),
            '?' => expression.push('.'),
            _ => expression.push_str(&regex::escape(&character.to_string())),
        }
        index += 1;
    }
    expression.push('$');
    RegexBuilder::new(&expression)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|error| format!("invalid glob pattern: {error}"))
}

fn collect_workspace_files(root: &Path, current: &Path, output: &mut Vec<PathBuf>, visited: &mut std::collections::HashSet<PathBuf>) -> Result<(), String> {
    let current = canonicalize_target(root, current)?;
    if current.is_file() {
        output.push(current);
        return Ok(());
    }
    if !current.is_dir() { return Ok(()); }
    if !visited.insert(current.clone()) || output.len() >= 10_000 { return Ok(()); }
    let entries = std::fs::read_dir(&current).map_err(|error| format!("read workspace directory: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read workspace entry: {error}"))?;
        let path = entry.path();
        let Ok(path) = canonicalize_target(root, &path) else { continue; };
        if path.is_dir() {
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
            if name == ".git" || name == "node_modules" { continue; }
            collect_workspace_files(root, &path, output, visited)?;
        } else if path.is_file() {
            output.push(path);
            if output.len() >= 10_000 { break; }
        }
    }
    Ok(())
}

fn workspace_files(root: &Path, current: &Path) -> Result<Vec<PathBuf>, String> {
    let mut output = Vec::new();
    collect_workspace_files(root, current, &mut output, &mut std::collections::HashSet::new())?;
    output.sort();
    Ok(output)
}

fn image_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) { return Some("image/jpeg"); }
    if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10])
        && bytes.get(12..16) == Some(b"IHDR")
    { return Some("image/png"); }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { return Some("image/gif"); }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { return Some("image/webp"); }
    if bytes.starts_with(b"BM") { return Some("image/bmp"); }
    None
}

impl SessionHost {
    async fn reply_tool_error(
        runtime: &SessionExecution,
        request_id: Value,
        error: impl Into<String>,
    ) -> Result<(), String> {
        runtime.reply(request_id, Err(error.into())).await
    }

    pub(super) async fn handle_tool_request(
        &self,
        session_id: &str,
        workspace_id: &str,
        runtime: &SessionExecution,
        binding: &Value,
        message: Value,
    ) -> Result<(), String> {
        let request_id = message["payload"]["requestId"].clone();
        let params = &message["payload"];
        if message["nativeSessionId"] != binding["nativeSessionId"]
        {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "invalid_session: Core tool identity mismatch",
            )
            .await;
        }
        let Some(tool) = params["tool"].as_str() else {
            return Self::reply_tool_error(runtime, request_id, "invalid_request: Core tool name")
                .await;
        };
        let Some(input) = params["input"].as_object() else {
            return Self::reply_tool_error(runtime, request_id, "invalid_request: Core tool input")
                .await;
        };
        let Some(turn_id) = message["turnId"].as_str() else {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "invalid_session: Core tool turn identity missing",
            )
            .await;
        };
        let active_turn: Option<String> =
            sqlx::query_scalar("SELECT id FROM turns WHERE id=? AND session_id=? AND status='running'")
                .bind(turn_id)
                .bind(session_id)
                .fetch_optional(&self.db)
                .await
                .map_err(|error| error.to_string())?;
        if active_turn.is_none() {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "invalid_session: Core tool turn is not active",
            )
            .await;
        }
        let resolved = crate::session_execution_profile(&self.db, session_id)
            .await
            .map_err(|error| error.to_string())?
            .profile;
        if resolved.enforcement_backend == crate::execution_profile::EnforcementBackend::AgentManaged {
            return Self::reply_tool_error(runtime, request_id, "permission_denied: native provider permissions do not authorize Core tools").await;
        }
        let profile = resolved.enforced;
        let workspace = crate::workspace_by_id(&self.db, workspace_id)
            .await
            .map_err(|error| error.to_string())?;
        if workspace.trust != "trusted" {
            return Self::reply_tool_error(
                runtime,
                request_id,
                "permission_denied: workspace trust was revoked",
            )
            .await;
        }

        let (normalized_input, mut approval_payload, requires_approval) = match tool {
            "read_file" => {
                let Some(path) = input
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|path| !path.trim().is_empty())
                else {
                    return Self::reply_tool_error(runtime, request_id, "invalid_request: Pi read path is missing").await;
                };
                let action = input.get("action").and_then(Value::as_str).unwrap_or("read");
                if !matches!(action, "read" | "access" | "exists" | "is_directory" | "list" | "glob" | "grep" | "image_mime") {
                    return Self::reply_tool_error(runtime, request_id, "invalid_request: unsupported Pi read action").await;
                }
                (
                    json!({"path":path,"action":action,"pattern":input.get("pattern"),"glob":input.get("glob"),"ignoreCase":input.get("ignoreCase"),"literal":input.get("literal"),"context":input.get("context"),"limit":input.get("limit")}),
                    Value::Null,
                    false,
                )
            }
            "write_file" => {
                if profile.interaction_mode != "edit"
                    || profile.filesystem_policy != "workspace-write"
                {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "permission_denied: Pi workspace writes are disabled",
                    )
                    .await;
                }
                let Some(path) = input
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|path| !path.trim().is_empty())
                else {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi write path is missing",
                    )
                    .await;
                };
                let Some(content) = input.get("content").and_then(Value::as_str) else {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi write content is missing",
                    )
                    .await;
                };
                if content.len() > 512_000 {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi write content is too large",
                    )
                    .await;
                }
                let resolved =
                    match canonicalize_target(Path::new(&workspace.path), Path::new(path)) {
                        Ok(path) => path,
                        Err(error) => return Self::reply_tool_error(runtime, request_id, error).await,
                    };
                let relative = resolved
                    .strip_prefix(&workspace.path)
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|_| resolved.display().to_string());
                (
                    json!({"path":resolved.to_string_lossy(),"content":content}),
                    json!({"requestId":"","kind":"pi_tool","command":format!("write {relative}"),"cwd":workspace.path,"availableDecisions":["accept","cancel"]}),
                    profile.approval_policy == "on-request",
                )
            }
            "run_command" => {
                if profile.interaction_mode != "edit" || profile.command_policy == "disabled" {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "permission_denied: Pi command execution is disabled",
                    )
                    .await;
                }
                let Some(command) = input
                    .get("command")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|command| !command.is_empty())
                else {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi command is missing",
                    )
                    .await;
                };
                if command.len() > MAX_COMMAND_BYTES {
                    return Self::reply_tool_error(
                        runtime,
                        request_id,
                        "invalid_request: Pi command is too long",
                    )
                    .await;
                }
                let raw_cwd = input
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or(&workspace.path);
                let cwd = match canonicalize_target(
                    Path::new(&workspace.path),
                    Path::new(raw_cwd),
                ) {
                    Ok(path) if path.is_dir() => path,
                    Ok(_) => {
                        return Self::reply_tool_error(
                            runtime,
                            request_id,
                            "invalid_request: Pi command cwd is not a directory",
                        )
                        .await;
                    }
                    Err(error) => return Self::reply_tool_error(runtime, request_id, error).await,
                };
                let timeout = input.get("timeout").cloned().unwrap_or(Value::Null);
                (
                    json!({"command":command,"cwd":cwd.to_string_lossy(),"timeout":timeout}),
                    json!({"requestId":"","kind":"pi_command","command":sanitize_content("pi.command", command),"cwd":cwd,"availableDecisions":["accept","cancel"]}),
                    profile.approval_policy == "on-request" || profile.command_policy == "approved",
                )
            }
            _ => {
                return Self::reply_tool_error(
                    runtime,
                    request_id,
                    "unsupported: Core tool is not available",
                )
                .await;
            }
        };

        if !requires_approval {
            let result = self
                .execute_plugin_tool(session_id, workspace_id, tool, &normalized_input, runtime)
                .await;
            return runtime.reply(request_id, result).await;
        }

        let request_key = request_id
            .as_str()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| request_id.to_string());
        let approval_id = format!("pi-tool:{request_key}");
        approval_payload["requestId"] = json!(approval_id);
        let pending = PendingPluginTool {
            runtime: runtime.clone(),
            request_id: request_id.clone(),
            session_id: session_id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            generation_id: runtime.generation_id.clone(),
            turn_id: Some(turn_id.to_owned()),
            tool: tool.to_owned(),
            input: normalized_input,
        };
        {
            let mut pending_tools = self.pending_tools.lock().await;
            if pending_tools.contains_key(&approval_id) {
                drop(pending_tools);
                return Self::reply_tool_error(runtime, request_id, "busy: duplicate Core tool request").await;
            }
            pending_tools.insert(approval_id.clone(), pending);
        }
        let event = json!({
            "nativeSessionId":binding["nativeSessionId"],"turnId":turn_id,
            "type":"approval.requested","correlation":{"requestId":approval_id},"payload":approval_payload
        });
        if let Err(error) = self
            .project_event(
                session_id,
                workspace_id,
                &runtime.generation_id,
                binding,
                event,
                EventOrigin::CoreTool,
            )
            .await
        {
            self.pending_tools.lock().await.remove(&approval_id);
            let _ = Self::reply_tool_error(runtime, request_id, error.clone()).await;
            return Err(error);
        }
        Ok(())
    }

    async fn execute_plugin_tool(
        &self,
        session_id: &str,
        workspace_id: &str,
        tool: &str,
        input: &Value,
        runtime: &SessionExecution,
    ) -> Result<Value, String> {
        runtime.ensure_live().await?;
        if tool != "read_file" && !runtime.write_authorized { return Err("permission_denied: tool requires approved write invocation".into()); }
        let workspace = crate::workspace_by_id(&self.db, workspace_id)
            .await
            .map_err(|error| error.to_string())?;
        if workspace.trust != "trusted" {
            return Err("permission_denied: workspace trust was revoked".into());
        }
        let profile = crate::session_execution_profile(&self.db, session_id)
            .await
            .map_err(|error| error.to_string())?
            .profile
            .enforced;
        match tool {
            "read_file" => {
                let path = input["path"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi read path")?;
                let action = input["action"].as_str().unwrap_or("read");
                let resolved = canonicalize_target(Path::new(&workspace.path), Path::new(path))?;
                match action {
                    "exists" => Ok(json!({"path":resolved,"exists":resolved.exists()})),
                    "access" => {
                        if !resolved.exists() { return Err("invalid_request: Pi read path does not exist".into()); }
                        Ok(json!({"path":resolved,"exists":true}))
                    }
                    "is_directory" => Ok(json!({"path":resolved,"exists":resolved.exists(),"isDirectory":resolved.is_dir()})),
                    "read" => {
                        if !resolved.is_file() { return Err("invalid_request: Pi read target is not a file".into()); }
                        let metadata = tokio::fs::metadata(&resolved).await.map_err(|error| format!("read workspace file metadata: {error}"))?;
                        if metadata.len() > MAX_READ_BYTES { return Err("invalid_request: Pi read file exceeds the Core limit".into()); }
                        let bytes = tokio::fs::read(&resolved).await.map_err(|error| format!("read workspace file: {error}"))?;
                        if let Some(mime_type) = image_mime_type(&bytes) {
                            Ok(json!({"path":resolved,"data":BASE64.encode(&bytes),"encoding":"base64","mimeType":mime_type,"bytes":bytes.len()}))
                        } else {
                            let content = String::from_utf8(bytes).map_err(|_| "invalid_request: binary files are not readable through the text Core tool".to_owned())?;
                            Ok(json!({"path":resolved,"content":content,"bytes":content.len()}))
                        }
                    }
                    "image_mime" => {
                        if !resolved.is_file() { return Err("invalid_request: Pi image target is not a file".into()); }
                        let metadata = tokio::fs::metadata(&resolved).await.map_err(|error| format!("read workspace image metadata: {error}"))?;
                        if metadata.len() > MAX_READ_BYTES { return Err("invalid_request: Pi image exceeds the Core limit".into()); }
                        let bytes = tokio::fs::read(&resolved).await.map_err(|error| format!("read workspace image: {error}"))?;
                        Ok(json!({"path":resolved,"mimeType":image_mime_type(&bytes)}))
                    }
                    "list" => {
                        if !resolved.is_dir() { return Err("invalid_request: Pi list target is not a directory".into()); }
                        let mut entries = std::fs::read_dir(&resolved)
                            .map_err(|error| format!("read workspace directory: {error}"))?
                            .filter_map(Result::ok)
                            .filter_map(|entry| entry.file_name().into_string().ok())
                            .collect::<Vec<_>>();
                        entries.sort_by_key(|entry| entry.to_lowercase());
                        Ok(json!({"path":resolved,"entries":entries}))
                    }
                    "glob" => {
                        let pattern = input["pattern"].as_str().ok_or("invalid_request: Pi find pattern is missing")?;
                        let matcher = wildcard_regex(pattern, false)?;
                        let limit = input["limit"].as_u64().unwrap_or(1000).clamp(1, 10_000) as usize;
                        let files = workspace_files(Path::new(&workspace.path), &resolved)?;
                        let root = resolved.clone();
                        let mut paths = files.into_iter().filter_map(|file| {
                            let relative = file.strip_prefix(&root).ok()?.to_string_lossy().replace('\\', "/");
                            let basename = file.file_name()?.to_string_lossy();
                            if matcher.is_match(&relative) || matcher.is_match(&basename) { Some(file.to_string_lossy().into_owned()) } else { None }
                        }).take(limit).collect::<Vec<_>>();
                        paths.sort();
                        Ok(json!({"path":resolved,"paths":paths}))
                    }
                    "grep" => {
                        let pattern = input["pattern"].as_str().ok_or("invalid_request: Pi grep pattern is missing")?;
                        let literal = input["literal"].as_bool().unwrap_or(false);
                        let case_insensitive = input["ignoreCase"].as_bool().unwrap_or(false);
                        let matcher = if literal {
                            RegexBuilder::new(&format!(".*{}.*", regex::escape(pattern)))
                                .case_insensitive(case_insensitive)
                                .build()
                                .map_err(|error| format!("invalid grep pattern: {error}"))?
                        } else {
                            RegexBuilder::new(pattern).case_insensitive(case_insensitive).build().map_err(|error| format!("invalid grep pattern: {error}"))?
                        };
                        let glob = input["glob"].as_str().map(|value| wildcard_regex(value, false)).transpose()?;
                        let context = input["context"].as_u64().unwrap_or(0).min(20) as usize;
                        let limit = input["limit"].as_u64().unwrap_or(100).clamp(1, 1000) as usize;
                        let files = workspace_files(Path::new(&workspace.path), &resolved)?;
                        let search_root = if resolved.is_dir() { resolved.clone() } else { resolved.parent().unwrap_or(&resolved).to_path_buf() };
                        let mut matches = Vec::new();
                        for file in files {
                            if matches.len() >= limit { break; }
                            let relative = file.strip_prefix(&search_root).unwrap_or(&file).to_string_lossy().replace('\\', "/");
                            let basename = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                            if glob.as_ref().is_some_and(|glob| !glob.is_match(&relative) && !glob.is_match(&basename)) { continue; }
                            let Ok(content) = std::fs::read_to_string(&file) else { continue; };
                            let lines = content.lines().collect::<Vec<_>>();
                            for (index, line) in lines.iter().enumerate() {
                                if matcher.is_match(line) {
                                    let start = index.saturating_sub(context);
                                    let end = (index + context + 1).min(lines.len());
                                    for context_index in start..end {
                                        let marker = if context_index == index { ':' } else { '-' };
                                        matches.push(format!("{}{}{}{} {}", relative, marker, context_index + 1, marker, lines[context_index]));
                                        if matches.len() >= limit { break; }
                                    }
                                }
                                if matches.len() >= limit { break; }
                            }
                        }
                        let content = if matches.is_empty() { "No matches found".to_owned() } else { matches.join("\n") };
                        Ok(json!({"path":resolved,"content":content,"matchCount":matches.len()}))
                    }
                    _ => Err("invalid_request: unsupported Pi read action".into()),
                }
            }
            "write_file" => {
                if profile.interaction_mode != "edit"
                    || profile.filesystem_policy != "workspace-write"
                {
                    return Err("permission_denied: Pi workspace writes are disabled".into());
                }
                let path = input["path"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi write path")?;
                let content = input["content"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi write content")?;
                if content.len() > 512_000 {
                    return Err("invalid_request: Pi write content is too large".into());
                }
                let resolved =
                    canonicalize_target(Path::new(&workspace.path), Path::new(path))?;
                if let Some(parent) = resolved.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|error| format!("create write directory: {error}"))?;
                }
                tokio::fs::write(&resolved, content)
                    .await
                    .map_err(|error| format!("write workspace file: {error}"))?;
                Ok(json!({"path":resolved,"bytes":content.len(),"tool":tool}))
            }
            "run_command" => {
                if profile.interaction_mode != "edit" || profile.command_policy == "disabled" {
                    return Err("permission_denied: Pi command execution is disabled".into());
                }
                let command = input["command"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi command")?;
                let cwd = input["cwd"]
                    .as_str()
                    .ok_or("invalid_request: resolved Pi command cwd")?;
                let cwd = canonicalize_target(Path::new(&workspace.path), Path::new(cwd))?;
                if !cwd.is_dir() {
                    return Err("invalid_request: Pi command cwd is not a directory".into());
                }
                let timeout = input["timeout"]
                    .as_f64()
                    .filter(|value| value.is_finite() && *value > 0.0)
                    .unwrap_or(120.0)
                    .min(300.0);
                let mut command_process = tokio::process::Command::new(if cfg!(windows) {"cmd"} else {"sh"});
                command_process.args(if cfg!(windows) {vec!["/C",command]} else {vec!["-c",command]}).current_dir(&cwd);
                let output = crate::controlled_process::execute_cancellable(command_process,Duration::from_secs_f64(timeout),64_000,runtime.cancelled()).await.map_err(|e|e.to_string())?;
                if output.cancelled || output.timed_out {return Err("outcome_unknown: command cancelled or timed out".into());}
                let stdout =
                    truncate_command_output(String::from_utf8_lossy(&output.stdout).as_ref());
                let stderr =
                    truncate_command_output(String::from_utf8_lossy(&output.stderr).as_ref());
                let combined = if stderr.is_empty() {
                    stdout.clone()
                } else if stdout.is_empty() {
                    stderr.clone()
                } else {
                    format!("{stdout}\n{stderr}")
                };
                Ok(json!({"command":sanitize_content("pi.command", command),"cwd":cwd,"exitCode":output.exit_code,"stdout":stdout,"stderr":stderr,"output":truncate_command_output(&combined)}))
            }
            _ => Err("unsupported: Core tool is not available".into()),
        }
    }

    /// The v1 pi-tool namespace belongs to Core, regardless of the agent identity.
    /// Expired Core approvals must never fall through to a provider operation.
    pub async fn resolve_approval_from(&self, caller: &str, session_id: &str, request_id: &str, decision: &str) -> Result<(), String> {
        if request_id.starts_with("pi-tool:") {
            return self.resolve_core_tool_approval_from(caller, session_id, request_id, decision).await;
        }
        self.invoke_capability_from(caller, session_id, "approval.respond", json!({"requestId": request_id, "decision": decision})).await?;
        Ok(())
    }

    pub async fn resolve_core_tool_approval_from(
        &self,
        caller: &str,
        session_id: &str,
        request_id: &str,
        decision: &str,
    ) -> Result<(), String> {
        if !matches!(decision, "accept" | "cancel") {
            return Err("invalid_request: approval decision must be accept or cancel".into());
        }
        let pending = {
            let mut pending_tools = self.pending_tools.lock().await;
            let pending = pending_tools.get(request_id)
                .ok_or_else(|| "invalid_request: Core tool approval is no longer pending".to_owned())?;
            if pending.session_id != session_id || pending.runtime.caller != caller {
                return Err("invalid_session: approval session mismatch".into());
            }
            pending_tools.remove(request_id).expect("pending request checked under lock")
        };
        let binding_json: String =
            sqlx::query_scalar("SELECT plugin_binding_json FROM session_bindings WHERE session_id=?")
                .bind(session_id)
                .fetch_one(&self.db)
                .await
                .map_err(|error| error.to_string())?;
        let binding: Value = serde_json::from_str(&binding_json)
            .map_err(|_| "invalid_recovery_data: invalid plugin binding".to_owned())?;
        let event = json!({
            "nativeSessionId":binding["nativeSessionId"],"turnId":pending.turn_id,
            "type":"approval.resolved","correlation":{"requestId":request_id},"payload":{"requestId":request_id,"decision":decision,"tool":pending.tool}
        });
        if let Err(error) = self
            .project_event(
                session_id,
                &pending.workspace_id,
                &pending.generation_id,
                &binding,
                event,
                EventOrigin::CoreTool,
            )
            .await
        {
            let _ = pending.runtime.reply(pending.request_id, Err(error.clone())).await;
            return Err(error);
        }
        let result = if decision == "accept" {
            self.execute_plugin_tool(&pending.session_id, &pending.workspace_id, &pending.tool, &pending.input, &pending.runtime)
                .await
        } else {
            Err("permission_denied: Pi tool request was rejected".into())
        };
        pending.runtime.reply(pending.request_id, result).await
    }


}
