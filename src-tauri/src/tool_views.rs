//! Ephemeral, window/workspace-owned plugin applications. No output enters history.
use serde_json::{json, Value};
use sqlx::Row;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
    time::Duration,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};

const FRAME_LIMIT: usize = 1_048_576;
struct Instance {
    label: String,
    id: String,
    owner: String,
    workspace: String,
    installation: String,
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    failed: bool,
    diagnostic: Option<crate::plugin_runtime::DiagnosticIdentity>,
    started: std::time::Instant,
    expected_stop: bool,
    exit_reported: bool,
}
type Document = (String, String);
static DOCUMENTS: OnceLock<std::sync::Mutex<HashMap<String, Document>>> = OnceLock::new();
fn documents() -> &'static std::sync::Mutex<HashMap<String, Document>> {
    DOCUMENTS.get_or_init(Default::default)
}
pub(crate) fn document(owner: &str, path: &str) -> tauri::http::Response<Vec<u8>> {
    let docs = documents().lock().unwrap();
    let value = docs
        .get(path.trim_start_matches('/'))
        .filter(|(window, _)| window == owner);
    tauri::http::Response::builder().status(if value.is_some(){200}else{404})
        .header("Content-Type","text/html; charset=utf-8")
        .header("Cache-Control","no-store")
        .header("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
        .body(value.map(|(_,html)|html.as_bytes().to_vec()).unwrap_or_default()).unwrap()
}
static INSTANCES: OnceLock<Mutex<HashMap<String, Instance>>> = OnceLock::new();
fn instances() -> &'static Mutex<HashMap<String, Instance>> {
    INSTANCES.get_or_init(Default::default)
}
fn identity(owner: &str, workspace: &str, installation: &str, contribution: &str) -> String {
    json!([owner, workspace, installation, contribution]).to_string()
}
fn package_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.contains('\\')
        || relative.contains(':')
        || relative
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err("unsafe tool resource path".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let file = root
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("tool resource escapes package".into());
    }
    Ok(file)
}
impl Instance {
    fn diagnostic(&self, event: crate::diagnostics::Event, change: impl FnOnce(&mut crate::diagnostics::Fields)) {
        if let Some(identity) = &self.diagnostic {
            let mut fields = identity.fields(&self.id); fields.duration_ms = Some(self.started.elapsed().as_millis() as u64); change(&mut fields);
            crate::diagnostics::emit(event, fields);
        }
    }
    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let started = std::time::Instant::now();
        let request_id = ulid::Ulid::new().to_string();
        if self.failed {
            return Err(
                "Tool backend stopped. Close this tool and reopen it to start a new instance."
                    .into(),
            );
        }
        let request =
            json!({"protocol":"aibo.tool-view/1", "method":method, "params":params}).to_string();
        if request.len() > FRAME_LIMIT {
            return Err("tool request exceeds byte limit".into());
        }
        let result = tokio::time::timeout(Duration::from_secs(10), async {
            self.input
                .write_all(request.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            self.input
                .write_all(b"\n")
                .await
                .map_err(|e| e.to_string())?;
            self.input.flush().await.map_err(|e| e.to_string())?;
            let mut line = Vec::new();
            loop {
                let chunk = self.output.fill_buf().await.map_err(|e| e.to_string())?;
                if chunk.is_empty() {
                    return Err("Tool backend exited".to_owned());
                }
                let count = chunk
                    .iter()
                    .position(|v| *v == b'\n')
                    .map(|v| v + 1)
                    .unwrap_or(chunk.len());
                if line.len() + count > FRAME_LIMIT {
                    return Err("tool response exceeds byte limit".into());
                }
                let complete = chunk[count - 1] == b'\n';
                line.extend_from_slice(&chunk[..count]);
                self.output.consume(count);
                if complete {
                    break;
                }
            }
            let response: Value = serde_json::from_slice(&line).map_err(|e| e.to_string())?;
            if response["protocol"] != "aibo.tool-view/1" {
                return Err("tool protocol mismatch".into());
            }
            if response.get("result").is_some() == response.get("error").is_some()
                || response.get("error").is_some_and(|error| !error.is_string())
            {
                return Err("invalid tool response envelope".into());
            }
            Ok(response)
        })
        .await
        .map_err(|_| "Tool backend timed out".to_owned())
        .and_then(|v| v);
        match result {
            Ok(response) => {
                if let Some(error) = response["error"].as_str() {
                    self.diagnostic(crate::diagnostics::Event::PluginRequestFailed, |fields| { fields.request_id = Some(request_id.clone()); fields.operation = Some("plugin.tool.request"); fields.error_code = Some("unclassified"); fields.duration_ms = Some(started.elapsed().as_millis() as u64); });
                    Err(error.chars().take(2048).collect())
                } else {
                    Ok(response["result"].clone())
                }
            }
            Err(error) => {
                let code = match error.as_str() { "Tool backend timed out" => "timeout", "Tool backend exited" => "disconnected", "tool protocol mismatch" | "invalid tool response envelope" => "invalid_response", _ => "unclassified" };
                self.diagnostic(crate::diagnostics::Event::PluginRequestFailed, |fields| { fields.request_id = Some(request_id); fields.operation = Some(match method { "initialize" => "plugin.handshake", "shutdown" => "plugin.tool.shutdown", _ => "plugin.tool.request" }); fields.error_code = Some(code); fields.duration_ms = Some(started.elapsed().as_millis() as u64); });
                if code == "invalid_response" { self.diagnostic(crate::diagnostics::Event::PluginProtocolRejected, |fields| { fields.error_code = Some(code); }); }
                self.failed = true;
                let _ = self.child.start_kill();
                if !self.expected_stop && !self.exit_reported {
                    if let Ok(Some(status)) = self.child.try_wait() {
                        self.exit_reported = true;
                        self.diagnostic(crate::diagnostics::Event::PluginExited, |fields| { fields.error_code = Some(code); fields.exit_code = status.code();
                            #[cfg(unix)] { use std::os::unix::process::ExitStatusExt; fields.signal = status.signal().map(|signal| signal as u32); }
                        });
                    }
                }
                Err(error)
            }
        }
    }
    async fn stop(&mut self) {
        let unexpected = self.failed && !self.expected_stop;
        self.expected_stop = true;
        let _ =
            tokio::time::timeout(Duration::from_secs(2), self.call("shutdown", Value::Null)).await;
        let _ = self.child.start_kill();
        let status = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await.ok().and_then(Result::ok);
        if !self.exit_reported && status.is_some() {
            self.exit_reported = true;
            self.diagnostic(if unexpected { crate::diagnostics::Event::PluginExited } else { crate::diagnostics::Event::PluginStopped }, |fields| {
                if unexpected { fields.error_code = Some("disconnected"); } else { fields.outcome = Some("expected_stop"); }
                fields.exit_code = status.as_ref().and_then(std::process::ExitStatus::code);
                #[cfg(unix)] { use std::os::unix::process::ExitStatusExt; fields.signal = status.as_ref().and_then(|status| status.signal()).map(|signal| signal as u32); }
            });
        }
    }
}

#[tauri::command]
pub(crate) async fn open_tool_view(
    window: tauri::WebviewWindow,
    state: State<'_, crate::AppState>,
    workspace_id: String,
    installation_id: String,
    contribution_id: String,
) -> Result<Value, String> {
    let _mutation = state.capability_broker.mutation_guard().await;
    let row = sqlx::query("SELECT install_path,manifest_json,package_digest FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
        .bind(&installation_id).fetch_optional(&state.db).await.map_err(|e|e.to_string())?.ok_or("tool plugin is unavailable")?;
    let manifest: Value =
        serde_json::from_str(row.get("manifest_json")).map_err(|e| e.to_string())?;
    if !crate::plugin_manifest::activation_issues(&manifest)?.is_empty() {
        return Err("tool requires a compatible host version".into());
    }
    let entry = manifest["contributions"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|v| v["id"] == contribution_id && v["kind"] == "toolView")
        })
        .ok_or("tool contribution is unavailable")?;
    let dependencies =
        crate::plugin_dependencies::resolve_metadata(&state.db, &installation_id).await?;
    if !dependencies.supports(&contribution_id) {
        return Err("tool dependencies unavailable".into());
    }
    let workspace = crate::workspace_by_id(&state.db, &workspace_id)
        .await
        .map_err(|e| e.to_string())?;
    let root = PathBuf::from(row.get::<String, _>("install_path"))
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let (_, _, digest) = crate::plugin_registry::inspect(&root).map_err(|e| e.diagnostic)?;
    if digest != row.get::<String, _>("package_digest") {
        return Err("tool package integrity mismatch".into());
    }
    let html_path = package_file(&root, entry["frontend"].as_str().ok_or("missing frontend")?)?;
    if std::fs::metadata(&html_path)
        .map_err(|e| e.to_string())?
        .len()
        > 4 * 1024 * 1024
    {
        return Err("tool frontend exceeds byte limit".into());
    }
    let html = std::fs::read_to_string(html_path).map_err(|e| e.to_string())?;
    let key = identity(
        window.label(),
        &workspace_id,
        &installation_id,
        &contribution_id,
    );
    let mut running = instances().lock().await;
    if !running.contains_key(&key) {
        if running.len() >= 64 {
            return Err("Too many running tool instances".into());
        }
        let executable = package_file(&root, entry["backend"].as_str().ok_or("missing backend")?)?;
        let settings = crate::plugin_storage::directory(
            &root,
            manifest["pluginId"]
                .as_str()
                .ok_or("missing plugin identity")?,
            &installation_id,
            "tool-settings",
        )?;
        let mut command = Command::new(executable);
        command
            .current_dir(&workspace.path)
            .env("AIBO_TOOL_SETTINGS", &settings)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        crate::isolate_process_tree(&mut command);
        #[cfg(windows)] command.creation_flags(0x08000000);
        let id = ulid::Ulid::new().to_string();
        let diagnostic = crate::plugin_runtime::DiagnosticIdentity { installation_id: installation_id.clone(), plugin_id: manifest["pluginId"].as_str().unwrap_or("").into(), plugin_version: manifest["version"].as_str().unwrap_or("").into(), contribution_id: contribution_id.clone() };
        crate::diagnostics::emit(crate::diagnostics::Event::PluginStarting, diagnostic.fields(&id));
        let mut child = command.spawn().map_err(|e| { let mut fields = diagnostic.fields(&id); fields.stage = Some("plugin.spawn"); fields.error_code = Some("unclassified"); crate::diagnostics::emit(crate::diagnostics::Event::PluginStartFailed, fields); e.to_string() })?;
        let mut instance = Instance {
            label: format!(
                "{} · {} ({})",
                entry["title"].as_str().unwrap_or("Tool"),
                workspace.label,
                window.label()
            ),
            id,
            owner: window.label().into(),
            workspace: workspace_id.clone(),
            installation: installation_id,
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            failed: false,
            diagnostic: Some(diagnostic), started: std::time::Instant::now(), expected_stop: false, exit_reported: false,
        };
        let ready = instance.call("initialize",json!({"workspacePath":workspace.path,"workspaceId":workspace_id,"windowId":window.label()})).await.map_err(|error| { instance.diagnostic(crate::diagnostics::Event::PluginStartFailed, |fields| { fields.stage = Some("plugin.handshake"); fields.error_code = Some("unclassified"); }); error })?;
        if ready["protocol"] != "aibo.tool-view/1" {
            instance.diagnostic(crate::diagnostics::Event::PluginProtocolRejected, |fields| { fields.error_code = Some("contract_mismatch"); fields.contract_version = Some("aibo.tool-view/1"); });
            instance.diagnostic(crate::diagnostics::Event::PluginStartFailed, |fields| { fields.stage = Some("plugin.handshake"); fields.error_code = Some("contract_mismatch"); });
            instance.stop().await;
            return Err("unsupported tool backend protocol".into());
        }
        instance.diagnostic(crate::diagnostics::Event::PluginReady, |_| {});
        running.insert(key.clone(), instance);
    }
    let id = &running[&key].id;
    documents()
        .lock()
        .unwrap()
        .insert(id.clone(), (window.label().to_owned(), html));
    Ok(json!({"id":id}))
}

#[tauri::command]
pub(crate) async fn request_tool_view(
    window: tauri::WebviewWindow,
    state: State<'_, crate::AppState>,
    id: String,
    request: Value,
) -> Result<Value, String> {
    let _mutation = state.capability_broker.mutation_guard().await;
    let mut running = instances().lock().await;
    let instance = running
        .values_mut()
        .find(|v| v.id == id && v.owner == window.label())
        .ok_or("stale tool instance")?;
    let enabled: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plugin_installations WHERE id=? AND enabled=1 AND installed=1)")
        .bind(&instance.installation).fetch_one(&state.db).await.map_err(|e|e.to_string())?;
    if !enabled {
        instance.stop().await;
        return Err("tool plugin disabled".into());
    }
    instance.call("request", request).await
}

pub(crate) async fn close_matching(
    app: &tauri::AppHandle,
    owner: Option<&str>,
    workspace: Option<&str>,
    installation: Option<&str>,
    id: Option<&str>,
    confirm: bool,
) -> Result<bool, String> {
    let mut running = instances().lock().await;
    let keys: Vec<_> = running
        .iter()
        .filter(|(_, v)| {
            owner.is_none_or(|x| v.owner == x)
                && workspace.is_none_or(|x| v.workspace == x)
                && installation.is_none_or(|x| v.installation == x)
                && id.is_none_or(|x| v.id == x)
        })
        .map(|(k, _)| k.clone())
        .collect();
    let mut active = 0u64;
    for key in &keys {
        let v = running.get_mut(key).unwrap();
        active += v
            .call("status", Value::Null)
            .await
            .ok()
            .and_then(|s| s["active"].as_u64())
            .unwrap_or(u64::from(!v.failed)).min(100_000);
    }
    if confirm && active > 0 {
        let (send, recv) = tokio::sync::oneshot::channel();
        let parent = owner
            .and_then(|label| app.get_webview_window(label))
            .or_else(|| app.get_webview_window("main"));
        let locale = parent
            .as_ref()
            .map(crate::ui_i18n::window_locale)
            .unwrap_or_default();
        let targets = keys
            .iter()
            .filter_map(|key| running.get(key))
            .map(|v| v.label.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let message = crate::ui_i18n::message(
            locale,
            "native.toolView.closeMessage",
            &json!({"count":active,"targets":targets}),
        );
        let mut dialog = app
            .dialog()
            .message(message)
            .title(crate::ui_i18n::message(
                locale,
                "native.toolView.closeTitle",
                &json!({}),
            ))
            .buttons(MessageDialogButtons::OkCancelCustom(
                crate::ui_i18n::message(locale, "native.toolView.end", &json!({})),
                crate::ui_i18n::message(locale, "native.cancel", &json!({})),
            ));
        if let Some(parent) = parent.as_ref() {
            dialog = dialog.parent(parent);
        }
        dialog.show(move |yes| {
            let _ = send.send(yes);
        });
        if !recv.await.unwrap_or(false) {
            return Ok(false);
        }
    }
    for key in keys {
        if let Some(mut instance) = running.remove(&key) {
            documents().lock().unwrap().remove(&instance.id);
            instance.stop().await;
        }
    }
    Ok(true)
}
#[tauri::command]
pub(crate) async fn close_tool_view(
    window: tauri::WebviewWindow,
    id: String,
) -> Result<bool, String> {
    close_matching(
        window.app_handle(),
        Some(window.label()),
        None,
        None,
        Some(&id),
        true,
    )
    .await
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[tokio::test]
    async fn diagnostic_terminal_child() {
        let Some(data) = std::env::var_os("AIBO_TOOL_DIAGNOSTIC_TEST") else { return; };
        crate::diagnostics::initialize_global(data.into());
        let script = r#"node -e 'const r=require("readline").createInterface({input:process.stdin});r.on("line",line=>{JSON.parse(line);console.log(JSON.stringify({protocol:"aibo.tool-view/1",result:{protocol:"aibo.tool-view/1",output:"terminal-output-secret-canary"}}));});'"#;
        let mut instance = fixture(script).await;
        instance.diagnostic = Some(crate::plugin_runtime::DiagnosticIdentity { installation_id: "host-tool-installation".into(), plugin_id: "dev.test.tool".into(), plugin_version: "1.0.0".into(), contribution_id: "dev.test.tool.view".into() });
        instance.diagnostic(crate::diagnostics::Event::PluginStarting, |_| {});
        instance.call("initialize", json!({})).await.unwrap();
        instance.diagnostic(crate::diagnostics::Event::PluginReady, |_| {});
        assert_eq!(instance.call("request", json!({"command":"terminal-input-secret-canary"})).await.unwrap()["output"], "terminal-output-secret-canary");
        instance.stop().await;
        assert!(crate::diagnostics::global().unwrap().shutdown());
    }
    #[cfg(unix)]
    #[test]
    fn diagnostic_terminal_subprocess_keeps_terminal_content_out_of_files() {
        let root = tempfile::tempdir().unwrap();
        let result = std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact", "tool_views::tests::diagnostic_terminal_child"])
            .env("AIBO_TOOL_DIAGNOSTIC_TEST", root.path()).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stdout));
        let mut events = Vec::new();
        for entry in std::fs::read_dir(root.path().join("logs")).unwrap() {
            let path = entry.unwrap().path(); let data = std::fs::read_to_string(&path).unwrap();
            assert!(!data.contains("secret-canary"));
            if path.extension().is_some_and(|extension| extension == "jsonl") { for line in data.lines() { let row: Value = serde_json::from_str(line).unwrap(); events.push(row["event"].as_str().unwrap().to_owned()); } }
        }
        for event in ["plugin.starting", "plugin.ready", "plugin.stopped"] { assert!(events.iter().any(|actual| actual == event)); }
    }
    use super::*;
    #[test]
    fn ownership_is_unambiguous_and_window_local() {
        assert_ne!(
            identity("a", "b/c", "d", "e"),
            identity("a/b", "c", "d", "e")
        );
        assert_ne!(
            identity("a", "b", "d", "e"),
            identity("other", "b", "d", "e")
        );
    }
    #[test]
    fn resources_cannot_escape() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("view.html"), "ok").unwrap();
        assert!(package_file(root.path(), "view.html").is_ok());
        for path in ["../x", "/etc/passwd", "a/../view.html", "a\\b", "C:/x"] {
            assert!(package_file(root.path(), path).is_err());
        }
    }

    #[test]
    fn document_access_is_window_bound_and_nonpersistent() {
        let id = ulid::Ulid::new().to_string();
        documents().lock().unwrap().insert(id.clone(), ("owner".into(), "<html>tool</html>".into()));
        let response = document("owner", &format!("/{id}"));
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["Cache-Control"], "no-store");
        assert!(response.headers()["Content-Security-Policy"].to_str().unwrap().contains("connect-src 'none'"));
        assert_eq!(document("other", &id).status(), 404);
        documents().lock().unwrap().remove(&id);
        assert_eq!(document("owner", &id).status(), 404);
    }

    #[cfg(unix)]
    async fn fixture(script: &str) -> Instance {
        let mut command = Command::new("/bin/sh");
        command.args(["-c",script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
        let mut child = command.spawn().unwrap();
        Instance {label:"test".into(),id:"test".into(),owner:"window".into(),workspace:"workspace".into(),installation:"installation".into(),input:child.stdin.take().unwrap(),output:BufReader::new(child.stdout.take().unwrap()),child,failed:false,diagnostic:None,started:std::time::Instant::now(),expected_stop:false,exit_reported:false}
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn malformed_and_oversized_responses_fail_without_restarting() {
        for script in ["read line; printf 'not-json\\n'", "read line; head -c 1048577 /dev/zero"] {
            let mut instance=fixture(script).await;
            assert!(instance.call("initialize",Value::Null).await.is_err());
            assert!(instance.failed);
            assert!(instance.call("request",Value::Null).await.unwrap_err().contains("stopped"));
            instance.stop().await;
        }
    }
}
