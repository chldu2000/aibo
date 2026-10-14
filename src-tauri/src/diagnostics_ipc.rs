//! The trusted frontend can report categories and verified locations only.
use crate::{
    diagnostics::{self, Event, Fields, Frame, Status},
    ui_i18n, CoreError,
};
use serde::Deserialize;
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Kind {
    Exception,
    UnhandledRejection,
    PresentationFailed,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Report {
    kind: Kind,
    resource: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
}
struct Accepted {
    at: Instant,
    kind: Kind,
    resource: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
}
#[derive(Default)]
struct Limiter {
    accepted: VecDeque<Accepted>,
    suppressed: u64,
}
impl Limiter {
    fn accept(&mut self, report: &Report, now: Instant) -> bool {
        while self
            .accepted
            .front()
            .is_some_and(|item| now.duration_since(item.at) >= Duration::from_secs(60))
        {
            self.accepted.pop_front();
        }
        if self.accepted.len() >= 60
            || self.accepted.iter().any(|item| {
                now.duration_since(item.at) < Duration::from_secs(10)
                    && item.kind == report.kind
                    && item.resource == report.resource
                    && item.line == report.line
                    && item.column == report.column
            })
        {
            self.suppressed = self.suppressed.saturating_add(1);
            return false;
        }
        self.accepted.push_back(Accepted {
            at: now,
            kind: report.kind,
            resource: report.resource.clone(),
            line: report.line,
            column: report.column,
        });
        true
    }
}
fn unavailable() -> CoreError {
    ui_i18n::initialization_message(ui_i18n::HostMessage::new(
        "diagnostics.logs.unavailable",
        serde_json::json!({}),
    ))
}
static ACCESS: OnceLock<String> = OnceLock::new();
pub(crate) fn initialization_script(dev_origin: Option<String>) -> String {
    let access = ACCESS.get_or_init(|| ulid::Ulid::new().to_string());
    let dev_origin = if cfg!(any(dev, debug_assertions)) {
        dev_origin
    } else {
        None
    };
    format!(
        r#";(() => {{
      if (window.top !== window) return;
      const local = location.protocol === 'tauri:' && location.hostname === 'localhost'
        || location.origin === 'http://tauri.localhost' || location.origin === 'https://tauri.localhost'
        || location.origin === {dev};
      if (local) Object.defineProperty(window, '__AIBO_DIAGNOSTIC_ACCESS__', {{ value: {access} }});
    }})();"#,
        dev = serde_json::to_string(&dev_origin).unwrap(),
        access = serde_json::to_string(access).unwrap()
    )
}
fn trusted(
    window: &tauri::WebviewWindow,
    request: &tauri::ipc::Request<'_>,
) -> Result<(), CoreError> {
    // Source-specific access is injected only into the top-level host document.
    // A child frame cannot inherit permission by sharing the parent webview label.
    let expected = ACCESS.get().ok_or_else(unavailable)?;
    let received = request
        .headers()
        .get("Aibo-Diagnostic-Access")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(unavailable)?;
    if received.len() != expected.len()
        || received
            .bytes()
            .zip(expected.bytes())
            .fold(0, |difference, (a, b)| difference | (a ^ b))
            != 0
    {
        return Err(unavailable());
    }
    let url = window.url().map_err(|_| unavailable())?;
    let origin = url.origin().ascii_serialization();
    if window.label() == "main"
        && (url.scheme() == "tauri" && url.host_str() == Some("localhost")
            || matches!(
                origin.as_str(),
                "http://tauri.localhost" | "https://tauri.localhost"
            )
            || cfg!(any(dev, debug_assertions))
                && window
                    .app_handle()
                    .config()
                    .build
                    .dev_url
                    .as_ref()
                    .is_some_and(|url| url.origin().ascii_serialization() == origin))
    {
        Ok(())
    } else {
        Err(unavailable())
    }
}
fn resource_valid(resource: &str) -> bool {
    if cfg!(any(dev, debug_assertions)) && matches!(resource, "src/main.ts" | "src/App.svelte") {
        return true;
    }
    static RESOURCES: OnceLock<Vec<String>> = OnceLock::new();
    RESOURCES
        .get_or_init(|| {
            serde_json::from_str(include_str!(concat!(
                env!("OUT_DIR"),
                "/diagnostic-resources.json"
            )))
            .unwrap_or_default()
        })
        .iter()
        .any(|name| name == resource)
}
fn normalize(mut report: Report) -> Result<Report, CoreError> {
    if report
        .resource
        .as_ref()
        .is_some_and(|value| value.len() > 256)
        || report.line.is_some_and(|v| v > 1_000_000)
        || report.column.is_some_and(|v| v > 1_000_000)
    {
        return Err(unavailable());
    }
    if report
        .resource
        .as_ref()
        .is_some_and(|value| !resource_valid(value))
    {
        report.resource = None;
    }
    if report.resource.is_none() {
        report.line = None;
        report.column = None;
    }
    Ok(report)
}
fn report(
    log: &diagnostics::Diagnostics,
    limiter: &Mutex<Limiter>,
    window: &str,
    report: Report,
) -> Result<bool, CoreError> {
    let report = normalize(report)?;
    let mut limiter = limiter.lock().unwrap();
    if !limiter.accept(&report, Instant::now()) {
        log.suppress_frontend();
        return Ok(false);
    }
    let (event, reason, source) = match report.kind {
        Kind::Exception => (Event::FrontendException, "runtime_error", "host"),
        Kind::UnhandledRejection => (Event::FrontendRejection, "promise_rejection", "host"),
        Kind::PresentationFailed => (Event::PresentationFailed, "load_failed", "presentation"),
    };
    log.emit(
        event,
        Fields {
            window_id: Some(window.into()),
            source: Some(source),
            error_code: Some(reason),
            frames: report
                .resource
                .map(|resource| Frame {
                    resource,
                    line: report.line.filter(|line| *line > 0),
                    column: report.column.filter(|column| *column > 0),
                })
                .into_iter()
                .collect(),
            ..Fields::default()
        },
    );
    Ok(true)
}
#[tauri::command]
pub(crate) fn report_frontend_diagnostic(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
    diagnostic: Report,
) -> Result<bool, CoreError> {
    trusted(&window, &request)?;
    static LIMITER: OnceLock<Mutex<Limiter>> = OnceLock::new();
    report(
        diagnostics::global().ok_or_else(unavailable)?,
        LIMITER.get_or_init(Mutex::default),
        window.label(),
        diagnostic,
    )
}
#[tauri::command]
pub(crate) fn diagnostic_frontend_ready(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), CoreError> {
    trusted(&window, &request)?;
    let mut phase = FRONTEND_PHASE.lock().unwrap();
    if *phase == Phase::Failed {
        return Err(unavailable());
    }
    if *phase == Phase::Initializing {
        *phase = Phase::Ready;
        diagnostics::emit(
            Event::StageCompleted,
            Fields {
                stage: Some("frontend.initialize"),
                ..Fields::default()
            },
        );
        diagnostics::emit(Event::Ready, Fields::default());
    }
    Ok(())
}
#[derive(PartialEq)]
enum Phase {
    Initializing,
    Ready,
    Failed,
}
static FRONTEND_PHASE: Mutex<Phase> = Mutex::new(Phase::Initializing);
#[tauri::command]
pub(crate) fn diagnostic_frontend_failed(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), CoreError> {
    trusted(&window, &request)?;
    let mut phase = FRONTEND_PHASE.lock().unwrap();
    if *phase == Phase::Initializing {
        *phase = Phase::Failed;
        diagnostics::emit(
            Event::StartupFailed,
            Fields {
                stage: Some("frontend.initialize"),
                error_code: Some("runtime_error"),
                ..Fields::default()
            },
        );
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn get_diagnostic_log_status(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<Status, CoreError> {
    trusted(&window, &request)?;
    Ok(diagnostics::global().ok_or_else(unavailable)?.status())
}
#[tauri::command]
pub(crate) fn open_diagnostic_log_directory(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), CoreError> {
    trusted(&window, &request)?;
    let status = diagnostics::global().ok_or_else(unavailable)?.status();
    let directory = status.directory.ok_or_else(unavailable)?;
    let metadata = std::fs::symlink_metadata(&directory).map_err(|_| unavailable())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(unavailable());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(unavailable());
        }
    }
    window
        .opener()
        .open_path(directory.to_str().ok_or_else(unavailable)?, None::<&str>)
        .map_err(|_| unavailable())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_fields_cannot_select_events_or_identity() {
        for forged in [
            r#"{"kind":"exception","level":"INFO"}"#,
            r#"{"kind":"app.starting"}"#,
            r#"{"kind":"exception","session_id":"forged"}"#,
            r#"{"kind":"exception","path":"/tmp/file"}"#,
        ] {
            assert!(serde_json::from_str::<Report>(forged).is_err());
        }
        let report = normalize(Report {
            kind: Kind::Exception,
            resource: Some("https://external/?secret-canary".into()),
            line: Some(10),
            column: Some(2),
        })
        .unwrap();
        assert!(report.resource.is_none());
        assert!(report.line.is_none());
    }
    #[test]
    fn monotonic_limits_use_safe_fingerprint_and_rolling_window() {
        let now = Instant::now();
        let mut limiter = Limiter::default();
        let mut report = Report {
            kind: Kind::Exception,
            resource: Some("src/main.ts".into()),
            line: Some(1),
            column: Some(1),
        };
        assert!(limiter.accept(&report, now));
        assert!(!limiter.accept(&report, now + Duration::from_secs(9)));
        assert!(limiter.accept(&report, now + Duration::from_secs(10)));
        for line in 2..=59 {
            report.line = Some(line);
            assert!(limiter.accept(&report, now + Duration::from_secs(10)));
        }
        report.line = Some(100);
        assert!(!limiter.accept(&report, now + Duration::from_secs(59)));
        assert!(limiter.accept(&report, now + Duration::from_secs(60)));
    }
}
