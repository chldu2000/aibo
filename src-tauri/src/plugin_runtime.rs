//! Bounded process transport for capability runtime 2.0 and 2.1.
//! Policy, operation validation and persistence remain in Core.
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::HashMap,
    path::Path,
    sync::{atomic::{AtomicBool, Ordering}, Arc},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{mpsc, oneshot, Mutex},
};

const MAX_MESSAGE: usize = 1_048_576;
const MAX_PENDING: usize = 64;
type Reply = oneshot::Sender<Result<Value, String>>;

fn process_argument(value: &str) -> Cow<'_, str> {
    #[cfg(windows)]
    {
        if let Some(path) = value.strip_prefix(r"\\?\UNC\") { return Cow::Owned(format!(r"\\{path}")); }
        if let Some(path) = value.strip_prefix(r"\\?\") { return Cow::Borrowed(path); }
    }
    Cow::Borrowed(value)
}

fn process_path(path: &Path) -> Cow<'_, Path> {
    let value = path.to_string_lossy();
    match process_argument(&value) {
        Cow::Borrowed(_) => Cow::Borrowed(path),
        Cow::Owned(path) => Cow::Owned(path.into()),
    }
}

enum CommandMessage {
    Request { id: String, method: String, params: Value, reply: Reply },
    Reply { id: Value, result: Result<Value, String> },
    Stop,
}

#[derive(Clone)]
pub(crate) struct PluginRuntime {
    commands: mpsc::Sender<CommandMessage>,
    pub generation_id: String,
    pub notifications: Arc<Mutex<mpsc::Receiver<Value>>>,
    stop_requested: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    cleanup_complete: Arc<AtomicBool>,
}

impl PluginRuntime {
    pub fn spawn_capability(executable: &Path, args: &[String], directory: &Path) -> Result<Self, String> {
        Self::spawn_transport(executable, args, directory, None, false)
    }

    pub fn spawn_interactive(executable: &Path, args: &[String], directory: &Path, sdk_module: Option<&Path>) -> Result<Self, String> {
        Self::spawn_transport(executable, args, directory, sdk_module, true)
    }

    fn spawn_transport(executable: &Path, args: &[String], directory: &Path, sdk_module: Option<&Path>, interactive: bool) -> Result<Self, String> {
        let executable = process_path(executable);
        let directory = process_path(directory);
        let mut command = Command::new(executable.as_ref());
        command.env_clear();
        for name in ["SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"] {
            if let Some(value) = std::env::var_os(name) { command.env(name, value); }
        }
        command.env("PATH", crate::executable_search_path());
        if let Some(sdk_module) = sdk_module {
            command.env("AIBO_PI_SDK_MODULE", process_path(sdk_module).as_ref());
        }
        command.args(args.iter().map(|arg|process_argument(arg).into_owned())).current_dir(directory.as_ref()).kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.as_std_mut().process_group(0);
        }
        let mut child = command.spawn().map_err(|_| "dependency_missing: plugin entrypoint could not start".to_string())?;
        let mut stdin = child.stdin.take().ok_or("internal: missing stdin")?;
        let mut stdout = child.stdout.take().ok_or("internal: missing stdout")?;
        let mut stderr = child.stderr.take().ok_or("internal: missing stderr")?;
        let (commands, mut command_rx) = mpsc::channel::<CommandMessage>(MAX_PENDING);
        let (notification_tx, notifications) = mpsc::channel(256);
        let generation_id = ulid::Ulid::new().to_string();
        let stop_requested = Arc::new(AtomicBool::new(false));
        // Drain without retaining or broadcasting untrusted diagnostics or credentials.
        let stderr_task = tokio::spawn(async move {
            let mut bytes = [0u8; 4096];
            while matches!(stderr.read(&mut bytes).await, Ok(n) if n > 0) {}
        });
        let exited = Arc::new(AtomicBool::new(false));
        let process_exited = exited.clone();
        let cleanup_complete = Arc::new(AtomicBool::new(false));
        let cleaned = cleanup_complete.clone();
        tokio::spawn(async move {
            let mut pending: HashMap<String, Reply> = HashMap::new();
            let mut frame = Vec::new();
            let mut bytes = [0u8; 4096];
            let reason = 'runtime: loop {
                tokio::select! {
                    command = command_rx.recv() => match command {
                        Some(CommandMessage::Request { id, method, params, reply }) => {
                            if pending.len() >= MAX_PENDING {
                                let _ = reply.send(Err("busy: too many pending plugin requests".into()));
                                continue;
                            }
                            let mut encoded = serde_json::to_vec(&json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params})).unwrap();
                            if encoded.len() > MAX_MESSAGE {
                                let _ = reply.send(Err("invalid_request: message exceeds limit".into()));
                                continue;
                            }
                            encoded.push(b'\n');
                            pending.insert(id, reply);
                            match tokio::time::timeout(Duration::from_secs(5), stdin.write_all(&encoded)).await {
                                Ok(Ok(())) => {},
                                _ => break "timeout: plugin input stalled",
                            }
                        }
                        Some(CommandMessage::Reply { id, result }) => {
                            let message = match result {
                                Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                                Err(error) => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":error}}),
                            };
                            let mut encoded = serde_json::to_vec(&message).unwrap();
                            if encoded.len() > MAX_MESSAGE { break "invalid_request: message exceeds limit"; }
                            encoded.push(b'\n');
                            match tokio::time::timeout(Duration::from_secs(5), stdin.write_all(&encoded)).await {
                                Ok(Ok(())) => {},
                                _ => break "timeout: plugin input stalled",
                            }
                        }
                        Some(CommandMessage::Stop) | None => break "cancelled: plugin stopped",
                    },
                    result = stdout.read(&mut bytes) => {
                        let count = match result {
                            Ok(0) => break "internal: plugin exited",
                            Ok(count) => count,
                            Err(_) => break "internal: plugin output failed",
                        };
                        for byte in &bytes[..count] {
                            if *byte != b'\n' {
                                frame.push(*byte);
                                if frame.len() > MAX_MESSAGE { break 'runtime "invalid_request: oversized plugin frame"; }
                                continue;
                            }
                            let message: Value = match serde_json::from_slice(&frame) {
                                Ok(Value::Object(object)) => Value::Object(object),
                                _ => break 'runtime "invalid_request: malformed plugin frame",
                            };
                            frame.clear();
                            if message["jsonrpc"] != "2.0" { break 'runtime "protocol_incompatible: JSON-RPC version"; }
                            if !(if interactive { &crate::plugin_contract::contracts().capability_interactive } else { &crate::plugin_contract::contracts().capability_runtime }).is_valid(&message) { break 'runtime "invalid_request: plugin response schema"; }
                            if message["method"] == "capability.call" {
                                if !matches!(message.get("id"), Some(Value::String(_) | Value::Number(_))) || !message["params"].is_object() {
                                    break 'runtime "invalid_request: malformed Core tool request";
                                }
                                if notification_tx.send(message).await.is_err() { break 'runtime "cancelled: plugin notification receiver closed"; }
                                continue;
                            }
                            if let Some(id) = message.get("id").and_then(Value::as_str) {
                                if message.get("method").is_some() || message.get("result").is_some() == message.get("error").is_some() {
                                    break 'runtime "invalid_request: malformed plugin response";
                                }
                                let Some(reply) = pending.remove(id) else { break 'runtime "invalid_request: unknown or duplicate response"; };
                                let response = if message.get("error").is_some() {
                                    // Never expose plugin-provided messages to logs or UI without redaction.
                                    Err(format!("{}: plugin request rejected", message["error"]["data"]["kind"].as_str().unwrap_or("internal")))
                                } else { Ok(message["result"].clone()) };
                                let _ = reply.send(response);
                            } else {
                                let allowed = interactive && message["method"] == "capability.event";
                                if message.get("id").is_some() || !allowed || !message["params"].is_object() {
                                    break 'runtime "invalid_request: unknown plugin notification";
                                }
                                // Preserve every durable event while bounding memory usage by applying
                                // backpressure to the plugin's stdout reader.
                                if notification_tx.send(message).await.is_err() { break 'runtime "cancelled: plugin notification receiver closed"; }
                            }
                        }
                    }
                }
            };
            process_exited.store(true, Ordering::Release);
            #[cfg(unix)]
            {
                if let Some(pid) = child.id() { unsafe { libc::kill(-(pid as i32),libc::SIGKILL); } }
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            stderr_task.abort();
            cleaned.store(true, Ordering::Release);
            for (_, reply) in pending { let _ = reply.send(Err(reason.into())); }
        });
        Ok(Self { commands, generation_id, notifications: Arc::new(Mutex::new(notifications)), stop_requested, exited, cleanup_complete })
    }

    pub async fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let (reply, response) = oneshot::channel();
        let command = CommandMessage::Request { id: ulid::Ulid::new().to_string(), method: method.into(), params, reply };
        self.commands.try_send(command).map_err(|_| "busy: plugin unavailable".to_string())?;
        match tokio::time::timeout(timeout, response).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("internal: plugin exited".into()),
            Err(_) => {
                self.stop_requested.store(true, Ordering::Release);
                let _ = self.commands.send(CommandMessage::Stop).await;
                Err("timeout: plugin request expired".into())
            }
        }
    }

    pub async fn reply(&self, id: Value, result: Result<Value, String>) -> Result<(), String> {
        self.commands
            .send(CommandMessage::Reply { id: id.to_owned(), result })
            .await
            .map_err(|_| "internal: plugin unavailable".to_owned())
    }

    pub fn has_exited(&self) -> bool { self.exited.load(Ordering::Acquire) }

    pub fn was_stopped(&self) -> bool { self.stop_requested.load(Ordering::Acquire) }

    /// A write must not settle and release its workspace while transport cleanup is pending.
    pub async fn stop_and_wait(&self) -> bool {
        tokio::time::timeout(Duration::from_secs(6), async {
            self.stop().await;
            while !self.cleanup_complete.load(Ordering::Acquire) {
                // A bounded notification send may be applying stdout backpressure.
                // Once the invocation consumer has stopped, drain those queued frames
                // so the transport task can observe Stop and finish process cleanup.
                while self.notifications.lock().await.try_recv().is_ok() {}
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.is_ok()
    }

    pub async fn stop(&self) {
        self.stop_requested.store(true, Ordering::Release);
        let _ = self.commands.send(CommandMessage::Stop).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[tokio::test]
    async fn node_accepts_verbatim_plugin_paths_at_the_process_boundary() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().canonicalize().unwrap();
        assert!(root.to_string_lossy().starts_with(r"\\?\"), "Windows canonical paths should exercise the verbatim-prefix boundary");
        let script = root.join("fixtures/plugins/capability-echo/worker.mjs");
        let runtime = PluginRuntime::spawn_capability(Path::new("node"), &[script.to_string_lossy().into_owned()], &root).unwrap();
        let result = runtime.request("capability.initialize",json!({"protocol":"2.0","generationId":runtime.generation_id,"pluginId":"dev.aibo.capability-echo","pluginVersion":"1.0.0","contributionId":"dev.aibo.capability-echo.read"}),Duration::from_secs(5)).await.unwrap();
        assert_eq!(result["protocol"],"2.0");
        assert!(runtime.stop_and_wait().await);
    }

    #[tokio::test]
    async fn interactive_capability_stream_and_control_share_one_generation() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let script = r#"
            import {serveCapability} from './packages/capability-runtime/stdio.mjs';
            let finish;
            serveCapability({protocol:'2.1',pluginId:'dev.test',pluginVersion:'1.0.0',contributionId:'dev.test.session',
              operations:[{capability:'dev.test.turn',version:'1.0.0',operationId:'turn'},{capability:'dev.test.answer',version:'1.0.0',operationId:'answer'}],
              invoke:async (_p,tools)=>{tools.emit({type:'input.requested'});return await new Promise(resolve=>finish=resolve);},
              control:async ()=>{setTimeout(()=>finish({status:'completed'}),10);return {accepted:true};}
            });
        "#;
        let runtime = PluginRuntime::spawn_interactive(Path::new("node"), &["--input-type=module".into(),"--eval".into(),script.into()], root, None).unwrap();
        let result = runtime.request("capability.initialize",json!({"protocol":"2.1","pluginId":"dev.test","pluginVersion":"1.0.0","contributionId":"dev.test.session","instanceId":"instance","generationId":runtime.generation_id}),Duration::from_secs(5)).await.unwrap();
        assert_eq!(result["protocol"],"2.1");
        let deadline = (time::OffsetDateTime::now_utc().unix_timestamp_nanos()/1_000_000) as i64 + 5000;
        let running_runtime = runtime.clone();
        let running = tokio::spawn(async move {
            running_runtime.request("capability.invoke",json!({"invocationId":"turn","instanceId":"instance","generationId":running_runtime.generation_id,"contributionId":"dev.test.session","capability":"dev.test.turn","contractVersion":"1.0.0","operationId":"turn","deadlineUnixMs":deadline,"scope":{"kind":"session","id":"session"},"context":{},"input":{}}),Duration::from_secs(5)).await
        });
        let event = tokio::time::timeout(Duration::from_secs(5),async {runtime.notifications.lock().await.recv().await}).await.unwrap().unwrap();
        assert_eq!(event["method"],"capability.event");
        assert_eq!(event["params"]["generationId"],runtime.generation_id);
        assert_eq!(event["params"]["sequence"],1);
        let answer = runtime.request("capability.control",json!({"invocationId":"turn","instanceId":"instance","generationId":runtime.generation_id,"contributionId":"dev.test.session","capability":"dev.test.answer","contractVersion":"1.0.0","operationId":"answer","input":{}}),Duration::from_secs(5)).await.unwrap();
        assert_eq!(answer["output"]["accepted"],true);
        assert_eq!(running.await.unwrap().unwrap()["output"]["status"],"completed");
        assert!(runtime.stop_and_wait().await);
    }

    #[tokio::test]
    async fn echo_process_round_trip_and_generation_isolation() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let script = root.join("fixtures/plugins/capability-echo/worker.mjs");
        let args = vec![script.to_string_lossy().into_owned()];
        let first = PluginRuntime::spawn_capability(Path::new("node"), &args, root).unwrap();
        let second = PluginRuntime::spawn_capability(Path::new("node"), &args, root).unwrap();
        assert_ne!(first.generation_id, second.generation_id);
        let result = first.request("capability.initialize", json!({
            "protocol":"2.0", "generationId":first.generation_id,
            "pluginId":"dev.aibo.capability-echo", "pluginVersion":"1.0.0",
            "contributionId":"dev.aibo.capability-echo.read"
        }), Duration::from_secs(5)).await.unwrap();
        assert_eq!(result["protocol"], "2.0");
        let result = first.request("capability.invoke", json!({"invocationId":"roundtrip","input":{"value":"hello"},"context":{"workspacePath":"/test"}}), Duration::from_secs(5)).await.unwrap();
        assert_eq!(result["generationId"], first.generation_id);
        assert_eq!(result["output"]["value"], "hello");
        assert!(second.notifications.lock().await.try_recv().is_err());
        assert!(first.stop_and_wait().await);
        assert!(second.stop_and_wait().await);
    }

    #[tokio::test]
    async fn burst_streams_apply_backpressure_without_terminating_the_runtime() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let script = r#"
            import {serveCapability} from './packages/capability-runtime/stdio.mjs';
            serveCapability({protocol:'2.1',pluginId:'dev.test',pluginVersion:'1.0.0',contributionId:'dev.test.stream',
              operations:[{capability:'dev.test.burst',version:'1.0.0',operationId:'burst'}],
              invoke:async (_p,tools)=>{for(let i=0;i<600;i++)tools.emit({type:'delta',index:i});return {count:600};}
            });
        "#;
        let runtime = PluginRuntime::spawn_interactive(Path::new("node"), &["--input-type=module".into(),"--eval".into(),script.into()], root, None).unwrap();
        runtime.request("capability.initialize",json!({"protocol":"2.1","instanceId":"instance","generationId":runtime.generation_id,"pluginId":"dev.test","pluginVersion":"1.0.0","contributionId":"dev.test.stream"}),Duration::from_secs(5)).await.unwrap();
        let active = runtime.clone();
        let request = tokio::spawn(async move {active.request("capability.invoke",json!({"invocationId":"burst","instanceId":"instance","generationId":active.generation_id,"contributionId":"dev.test.stream","capability":"dev.test.burst","contractVersion":"1.0.0","operationId":"burst","scope":{"kind":"application"},"deadlineUnixMs":(time::OffsetDateTime::now_utc().unix_timestamp_nanos()/1_000_000) as i64+5000,"context":{},"input":{}}),Duration::from_secs(5)).await});
        let mut received=0;
        while received<600 {
            runtime.notifications.lock().await.recv().await.unwrap();
            received+=1;
            if received%50==0 {tokio::time::sleep(Duration::from_millis(5)).await;}
        }
        assert_eq!(request.await.unwrap().unwrap()["output"]["count"],600);
        assert!(runtime.stop_and_wait().await);
    }

    #[tokio::test]
    async fn rejects_malformed_oversized_and_unrelated_responses_without_hanging() {
        for script in [
            "process.stdin.once('data',()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/event',params:{}})+'\\n'));",
            "process.stdin.once('data',()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'aibo/tool-request',id:'old-tool',params:{}})+'\\n'));",
            "process.stdin.once('data',()=>process.stdout.write('not-json\\n'));",
            "process.stdin.once('data',()=>process.stdout.write('x'.repeat(1048577)));",
            "process.stdin.once('data',()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'unknown',result:{kind:'accepted',accepted:true}})+'\\n'));",
        ] {
            let runtime = PluginRuntime::spawn_capability(Path::new("node"), &["-e".into(), script.into()], Path::new(env!("CARGO_MANIFEST_DIR"))).unwrap();
            let result = runtime.request("capability.initialize", json!({}), Duration::from_secs(5)).await;
            assert!(result.unwrap_err().contains("invalid_request"));
            runtime.stop().await;
        }
    }

    #[tokio::test]
    async fn request_timeout_terminates_stalled_generation() {
        let runtime = PluginRuntime::spawn_capability(Path::new("node"), &["-e".into(), "process.stdin.resume();".into()], Path::new(env!("CARGO_MANIFEST_DIR"))).unwrap();
        assert!(runtime.request("capability.initialize", json!({}), Duration::from_millis(50)).await.unwrap_err().starts_with("timeout:"));
        let closed = tokio::time::timeout(Duration::from_secs(5), async { runtime.notifications.lock().await.recv().await }).await.unwrap();
        assert!(closed.is_none());
    }
}
