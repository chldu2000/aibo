//! Throwaway P0 native experiment. Not an installable renderer or public protocol.
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{Emitter, Manager, State, Webview};

#[cfg(not(debug_assertions))]
compile_error!("P0 experiment must not ship in release builds");

#[derive(Default)]
pub struct P0State(Mutex<Registry>);
#[derive(Default)]
struct Registry {
    serial: u64,
    active: Option<Instance>,
}
struct Instance {
    owner: String,
    label: String,
    generation: u64,
    suspended: bool,
    since: Instant,
    received: u32,
}

#[tauri::command]
pub async fn p0_mount(
    webview: Webview,
    state: State<'_, P0State>,
    framework: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<Value, String> {
    if !["react", "svelte"].contains(&framework.as_str()) {
        return Err("unknown prototype fixture".into());
    }
    bounds(x, y, width, height)?;
    let (label, generation, previous) = {
        let mut registry = state.0.lock().unwrap();
        if registry
            .active
            .as_ref()
            .is_some_and(|instance| instance.owner != webview.label())
        {
            return Err("wrong owner".into());
        }
        let previous = registry.active.take();
        registry.serial += 1;
        let generation = registry.serial;
        let label = format!("p0-dom-{generation}");
        registry.active = Some(Instance {
            owner: webview.label().into(),
            label: label.clone(),
            generation,
            suspended: false,
            since: Instant::now(),
            received: 0,
        });
        (label, generation, previous)
    };
    if let Some(previous) = previous {
        if let Some(view) = webview.app_handle().get_webview(&previous.label) {
            view.close().map_err(|e| e.to_string())?;
        }
    }
    let path = format!("p0-content/{framework}.html");
    let expected_path = format!("/{path}");
    let builder = tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::App(path.into()))
        .incognito(true)
        .initialization_script(format!("window.p0Generation={generation};"))
        .on_navigation(move |url| {
            url.path() == expected_path && url.host_str() == Some("127.0.0.1")
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    webview
        .window()
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    Ok(json!({"label":label,"generation":generation}))
}

fn bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if [x, y, width, height]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0 && *v <= 4096.0)
    {
        Ok(())
    } else {
        Err("invalid bounds".into())
    }
}

#[tauri::command]
pub async fn p0_deliver(
    webview: Webview,
    state: State<'_, P0State>,
    generation: u64,
    packet: Value,
) -> Result<(), String> {
    let label = {
        let registry = state.0.lock().unwrap();
        let instance = registry.active.as_ref().ok_or("no instance")?;
        if instance.owner != webview.label() || instance.generation != generation {
            return Err("stale owner/generation".into());
        }
        instance.label.clone()
    };
    let source = serde_json::to_string(&packet).map_err(|e| e.to_string())?;
    if source.len() > 2 * 1024 * 1024 {
        return Err("snapshot too large".into());
    }
    webview
        .app_handle()
        .get_webview(&label)
        .ok_or("missing view")?
        .eval(&format!("window.p0Receive({source})"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn p0_post(
    webview: Webview,
    state: State<'_, P0State>,
    generation: u64,
    packet: Value,
) -> Result<(), String> {
    let owner = {
        let mut registry = state.0.lock().unwrap();
        let instance = registry.active.as_mut().ok_or("no instance")?;
        if instance.label != webview.label() || instance.generation != generation {
            return Err("stale instance".into());
        }
        if instance.suspended {
            return Err("suspended".into());
        }
        if instance.since.elapsed().as_secs() >= 1 {
            instance.since = Instant::now();
            instance.received = 0;
        }
        instance.received += 1;
        if instance.received > 100 {
            return Err("rate limit".into());
        }
        instance.owner.clone()
    };
    if serde_json::to_vec(&packet)
        .map_err(|e| e.to_string())?
        .len()
        > 64 * 1024
    {
        return Err("message too large".into());
    }
    // Native source identity and generation are added outside the untrusted packet.
    webview
        .app_handle()
        .get_webview(&owner)
        .ok_or("owner missing")?
        .emit(
            "p0-message",
            json!({"generation":generation,"packet":packet}),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn p0_control(
    webview: Webview,
    state: State<'_, P0State>,
    generation: u64,
    operation: String,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    if operation == "unknown-caller" {
        let owner = webview.clone();
        let script = r#"window.addEventListener('DOMContentLoaded', async () => {
            const results = [];
            for (const command of ['list_workspaces','p0_post','plugin:window|is_visible','plugin:event|emit']) {
                try { await window.__TAURI_INTERNALS__.invoke(command, {generation:0,packet:{},event:'p0-forged'}); results.push({command,accepted:true}); }
                catch(error) { results.push({command,accepted:false,error:String(error).includes('not allowed')?'ACL denied':'other rejection'}); }
            }
            document.title = 'P0-AUDIT:' + JSON.stringify(results);
        });"#;
        let builder = tauri::webview::WebviewBuilder::new(
            "p0-unregistered",
            tauri::WebviewUrl::App("p0-content/react.html".into()),
        )
        .incognito(true)
        .initialization_script(script)
        .on_document_title_changed(move |_, title| {
            if let Some(result) = title.strip_prefix("P0-AUDIT:") {
                if let Ok(value) = serde_json::from_str::<Value>(result) {
                    let _ = owner.emit("p0-unknown-result", value);
                }
            }
        });
        webview
            .window()
            .add_child(
                builder,
                tauri::LogicalPosition::new(0.0, 880.0),
                tauri::LogicalSize::new(10.0, 10.0),
            )
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    if operation == "close-unknown" {
        return webview
            .app_handle()
            .get_webview("p0-unregistered")
            .ok_or("no unknown view")?
            .close()
            .map_err(|e| e.to_string());
    }
    let label = {
        let mut registry = state.0.lock().unwrap();
        let instance = registry.active.as_mut().ok_or("no instance")?;
        if instance.owner != webview.label() || instance.generation != generation {
            return Err("stale owner/generation".into());
        }
        if operation == "suspend" {
            instance.suspended = true;
        }
        if operation == "resume" {
            instance.suspended = false;
        }
        let label = instance.label.clone();
        if operation == "dispose" {
            registry.active = None;
        }
        label
    };
    let view = webview
        .app_handle()
        .get_webview(&label)
        .ok_or("missing view")?;
    match operation.as_str() {
        "dispose" => view.close(),
        "suspend" => {
            view.hide().map_err(|e| e.to_string())?;
            webview.set_focus()
        }
        "resume" => view.show(),
        "focus" => view.set_focus(),
        "bounds" => {
            let (x, y, width, height) = (
                x.ok_or("x")?,
                y.ok_or("y")?,
                width.ok_or("width")?,
                height.ok_or("height")?,
            );
            bounds(x, y, width, height)?;
            view.set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(x, y).into(),
                size: tauri::LogicalSize::new(width, height).into(),
            })
        }
        _ => return Err("unknown operation".into()),
    }
    .map_err(|e| e.to_string())
}

// Diagnostic ONLY: the private WebKit selector is never a proposed production API.
// It binds OS samples/fault injection to this exact experimental view instead of
// guessing PIDs from unrelated browser processes.
#[tauri::command]
pub async fn p0_inspect(webview: Webview, state: State<'_, P0State>) -> Result<Value, String> {
    let label = {
        let registry = state.0.lock().unwrap();
        let instance = registry.active.as_ref().ok_or("no instance")?;
        if instance.owner != webview.label() {
            return Err("wrong owner".into());
        }
        instance.label.clone()
    };
    let child = webview
        .app_handle()
        .get_webview(&label)
        .ok_or("missing view")?;
    Ok(
        json!({"hostPid": process_id(&webview).await?, "childPid": process_id(&child).await?, "nativePid":std::process::id(), "diagnosticPrivateSelector":true}),
    )
}

async fn process_id(view: &Webview) -> Result<i32, String> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::{c_char, c_void};
        #[link(name = "objc")]
        extern "C" {
            fn sel_registerName(name: *const c_char) -> *mut c_void;
            fn objc_msgSend();
        }
        let (tx, rx) = tokio::sync::oneshot::channel();
        view.with_webview(move |platform| unsafe {
            let object = platform.inner();
            let selector = sel_registerName(c"_webProcessIdentifier".as_ptr());
            let responds: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> bool =
                std::mem::transmute(objc_msgSend as *const ());
            let result = if responds(
                object,
                sel_registerName(c"respondsToSelector:".as_ptr()),
                selector,
            ) {
                let pid: unsafe extern "C" fn(*mut c_void, *mut c_void) -> i32 =
                    std::mem::transmute(objc_msgSend as *const ());
                Ok(pid(object, selector))
            } else {
                Err("diagnostic PID selector unavailable".to_owned())
            };
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = view;
        Err("P0 process diagnostics only implemented for macOS".into())
    }
}
