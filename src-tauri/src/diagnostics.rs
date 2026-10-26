//! Local diagnostics have a separate, typed boundary from ordinary tracing.
//! Producers never perform filesystem IO or wait for the writer.
use serde::Serialize;
use arc_swap::ArcSwapOption;
use serde_json::Value;
use std::{
    collections::VecDeque,
    fs::File,
    io::{self, Read, Seek, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use time::OffsetDateTime;

const RECORD_LIMIT: usize = 16 * 1024;
const NORMAL_QUEUE: usize = 1024;
const ERROR_QUEUE: usize = 64;
const EMERGENCY_RESERVE: u64 = 64 * 1024;
const EMERGENCY_RECORD_LIMIT: usize = 2 * 1024;
const EMERGENCY_SLOTS: usize = EMERGENCY_RESERVE as usize / EMERGENCY_RECORD_LIMIT;
pub(crate) fn safe_stderr(message: &'static str) {
    let _ = writeln!(std::io::stderr(), "{message}");
}

#[derive(Clone, Copy)]
pub(crate) enum Event {
    Starting,
    Ready,
    Stopped,
    StageCompleted,
    StartupFailed,
    PreviousExitUnknown,
    Panic,
    PluginStarting,
    PluginReady,
    PluginStartFailed,
    PluginStopped,
    PluginExited,
    PluginRequestFailed,
    PluginProtocolRejected,
    SessionCompleted,
    SessionFailed,
    SessionRecovered,
    FrontendException,
    FrontendRejection,
    PresentationFailed,
    Dropped,
    WriteFailed,
    Recovered,
}
impl Event {
    fn code(self) -> &'static str {
        match self {
            Self::Starting => "app.starting",
            Self::Ready => "app.ready",
            Self::Stopped => "app.stopped",
            Self::StageCompleted => "startup.stage_completed",
            Self::StartupFailed => "startup.failed",
            Self::PreviousExitUnknown => "app.previous_exit_unknown",
            Self::Panic => "app.panic",
            Self::PluginStarting => "plugin.starting",
            Self::PluginReady => "plugin.ready",
            Self::PluginStartFailed => "plugin.start_failed",
            Self::PluginStopped => "plugin.stopped",
            Self::PluginExited => "plugin.exited_unexpectedly",
            Self::PluginRequestFailed => "plugin.request_failed",
            Self::PluginProtocolRejected => "plugin.protocol_rejected",
            Self::SessionCompleted => "session.operation_completed",
            Self::SessionFailed => "session.operation_failed",
            Self::SessionRecovered => "session.recovery_completed",
            Self::FrontendException => "frontend.exception",
            Self::FrontendRejection => "frontend.unhandled_rejection",
            Self::PresentationFailed => "presentation.failed",
            Self::Dropped => "diagnostics.dropped",
            Self::WriteFailed => "diagnostics.write_failed",
            Self::Recovered => "diagnostics.recovered",
        }
    }
    fn level(self) -> &'static str {
        match self {
            Self::StartupFailed
            | Self::Panic
            | Self::PluginStartFailed
            | Self::PluginExited
            | Self::FrontendException
            | Self::FrontendRejection
            | Self::PresentationFailed
            | Self::WriteFailed => "ERROR",
            Self::PreviousExitUnknown
            | Self::PluginRequestFailed
            | Self::PluginProtocolRejected
            | Self::SessionFailed
            | Self::Dropped => "WARN",
            _ => "INFO",
        }
    }
    fn component(self) -> &'static str {
        match self {
            Self::PluginStarting
            | Self::PluginReady
            | Self::PluginStartFailed
            | Self::PluginStopped
            | Self::PluginExited
            | Self::PluginRequestFailed
            | Self::PluginProtocolRejected => "plugin_runtime",
            Self::SessionCompleted | Self::SessionFailed | Self::SessionRecovered => "session_host",
            Self::FrontendException | Self::FrontendRejection | Self::PresentationFailed => {
                "frontend"
            }
            Self::Dropped | Self::WriteFailed | Self::Recovered => "diagnostics",
            _ => "app",
        }
    }
    fn allows(self, key: &str) -> bool {
        match self {
            Self::StageCompleted | Self::StartupFailed => {
                matches!(
                    key,
                    "stage" | "duration_ms" | "error_code" | "migration_version"
                )
            }
            Self::PreviousExitUnknown => key == "previous_boot_id",
            Self::PluginStarting
            | Self::PluginReady
            | Self::PluginStartFailed
            | Self::PluginStopped
            | Self::PluginExited => matches!(
                key,
                "installation_id"
                    | "plugin_id"
                    | "plugin_version"
                    | "contribution_id"
                    | "generation_id"
                    | "stage"
                    | "duration_ms"
                    | "error_code"
                    | "exit_code"
                    | "signal"
                    | "outcome"
            ),
            Self::PluginRequestFailed | Self::PluginProtocolRejected => matches!(
                key,
                "installation_id"
                    | "generation_id"
                    | "request_id"
                    | "operation"
                    | "error_code"
                    | "duration_ms"
                    | "contract_version"
            ),
            Self::SessionCompleted | Self::SessionFailed | Self::SessionRecovered => matches!(
                key,
                "session_id"
                    | "turn_id"
                    | "request_id"
                    | "generation_id"
                    | "operation"
                    | "outcome"
                    | "error_code"
                    | "duration_ms" | "capability_id" | "actual_bytes" | "limit_bytes"
            ),
            Self::Panic => key == "frames",
            Self::FrontendException | Self::FrontendRejection | Self::PresentationFailed => {
                matches!(key, "window_id" | "frames" | "error_code" | "source")
            }
            Self::Dropped | Self::WriteFailed | Self::Recovered => {
                matches!(
                    key,
                    "count"
                        | "error_code"
                        | "duration_ms"
                        | "first_failure_at"
                        | "recovered_at"
                        | "os_error_code"
                )
            }
            _ => false,
        }
    }
}

/// Only host-confirmed identities may be supplied by native producers. IPC must
/// construct these fields itself, never forward an arbitrary input object.
#[derive(Default)]
pub(crate) struct Fields {
    pub capability_id: Option<String>,
    pub actual_bytes: Option<u64>,
    pub limit_bytes: Option<u64>,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub request_id: Option<String>,
    pub installation_id: Option<String>,
    pub plugin_id: Option<String>,
    pub plugin_version: Option<String>,
    pub contribution_id: Option<String>,
    pub generation_id: Option<String>,
    pub window_id: Option<String>,
    pub previous_boot_id: Option<String>,
    pub operation: Option<&'static str>,
    pub outcome: Option<&'static str>,
    pub stage: Option<&'static str>,
    pub error_code: Option<&'static str>,
    pub source: Option<&'static str>,
    pub contract_version: Option<&'static str>,
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i32>,
    pub signal: Option<u32>,
    pub count: Option<u64>,
    pub frames: Vec<Frame>,
    pub first_failure_at: Option<String>,
    pub recovered_at: Option<String>,
    pub os_error_code: Option<i32>,
    pub migration_version: Option<u64>,
}
#[derive(Serialize)]
pub(crate) struct Frame {
    pub resource: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
}

fn identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn version(value: &str) -> bool {
    value.len() <= 256 && semver::Version::parse(value).is_ok()
}
fn utc_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(time::macros::format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
        ))
        .unwrap()
}
fn timestamp_valid(value: &str) -> bool {
    value.len() == 24
        && value.bytes().enumerate().all(|(index, byte)| match index {
            4 | 7 => byte == b'-',
            10 => byte == b'T',
            13 | 16 => byte == b':',
            19 => byte == b'.',
            23 => byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
}
fn code(value: &str) -> bool {
    if matches!(
        value,
        "aibo.tool-view/1"
            | "plugin.tool.request"
            | "plugin.tool.shutdown"
            | "plugin.control"
            | "plugin.invoke"
            | "plugin.prepare"
            | "session.recover"
            | "host_created"
            | "turn_completed"
            | "turn_failed"
            | "cancelled"
            | "busy"
            | "permission_denied"
            | "2.0"
            | "2.1"
            | "invalid_session"
            | "request_id_invalid" | "binding_mismatch" | "input_too_large" | "frame_too_large"
            | "recovery_state_missing" | "recovery_state_corrupt" | "recovery_state_write_failed" | "recovery_version_unsupported" | "native_resume_failed" | "capability.validate"
            | "invalid_input"
            | "provider_unavailable"
            | "unsupported"
            | "approval_rejected"
            | "migration_checksum"
            | "migration_version"
            | "migration_dirty"
            | "migration_execute"
    ) {
        return true;
    }
    matches!(
        value,
        "database.open"
            | "database.migrate"
            | "plugin.recover"
            | "plugin.register"
            | "presentation.register"
            | "session.recover"
            | "host.assemble"
            | "frontend.initialize"
            | "project.recover"
            | "workspace.recover"
            | "broker.recover"
            | "plugin.candidates"
            | "plugin.spawn"
            | "plugin.handshake"
            | "session.create"
            | "session.resume"
            | "session.send"
            | "session.cancel"
            | "session.close"
            | "request_completed"
            | "recovered"
            | "expected_stop"
            | "requested"
            | "confirmed"
            | "unknown"
            | "timeout"
            | "disconnected"
            | "invalid_response"
            | "contract_mismatch"
            | "unclassified"
            | "permission_denied"
            | "storage_full"
            | "io_error"
            | "unsafe_directory"
            | "quota_exhausted"
            | "queue_full"
            | "shutdown_timeout"
            | "database_error"
            | "migration_error"
            | "initialization_error"
            | "runtime_error"
            | "promise_rejection"
            | "load_failed"
            | "host"
            | "presentation"
            | "rate_limited"
    )
}
fn safe_resource(value: &str) -> bool {
    if matches!(value, "src/main.ts" | "src/App.svelte") {
        return true;
    }
    value.len() <= 256
        && !value.contains("..")
        && (value.starts_with("src-tauri/src/") && value.ends_with(".rs")
            || value.starts_with("assets/") && value.ends_with(".js"))
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_-.".contains(&b))
}

struct Context {
    boot_id: String,
    started: Instant,
    sequence: AtomicU64,
}
impl Context {
    fn record(&self, event: Event, fields: Fields) -> Record {
        self.record_at(event, fields, OffsetDateTime::now_utc())
    }
    fn record_at(&self, event: Event, fields: Fields, timestamp: OffsetDateTime) -> Record {
        // Explicit millisecond precision, including a UTC suffix.
        let timestamp = timestamp
            .format(time::macros::format_description!(
                "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
            ))
            .unwrap();
        let mut value = serde_json::json!({
            "schema":"aibo.diagnostic/v1", "timestamp":timestamp, "level":event.level(),
            "event":event.code(), "component":event.component(), "boot_id":self.boot_id,
            "pid":std::process::id(), "sequence":self.sequence.fetch_add(1, Ordering::Relaxed),
            "app_version":env!("CARGO_PKG_VERSION"),
            "build_channel":if cfg!(any(dev, debug_assertions, test)) {"development"} else {"release"},
            "os":std::env::consts::OS, "arch":std::env::consts::ARCH,
            "elapsed_ms":self.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        }).as_object().unwrap().clone();
        let mut rejected = 0u32;
        let mut truncated = false;
        macro_rules! strings {
            ($valid:ident, $($key:ident),*) => { $(if let Some(field) = fields.$key {
                if event.allows(stringify!($key)) && $valid(&field) { value.insert(stringify!($key).into(), Value::from(field)); }
                else { rejected += 1; }
            })* };
        }
        strings!(
            identity,
            session_id,
            turn_id,
            request_id,
            installation_id,
            plugin_id,
            contribution_id,
            generation_id,
            window_id,
            previous_boot_id,
            capability_id
        );
        strings!(version, plugin_version);
        strings!(timestamp_valid, first_failure_at, recovered_at);
        strings!(code, operation, outcome, stage, error_code, source);
        macro_rules! numbers {
            ($($key:ident),*) => { $(if let Some(field) = fields.$key {
                if event.allows(stringify!($key)) { value.insert(stringify!($key).into(), Value::from(field)); }
                else { rejected += 1; }
            })* };
        }
        strings!(code, contract_version);
        numbers!(
            duration_ms,
            exit_code,
            signal,
            count,
            os_error_code,
            migration_version,
            actual_bytes,
            limit_bytes
        );
        if !fields.frames.is_empty() {
            if event.allows("frames") {
                let mut frames = Vec::new();
                for frame in fields.frames.into_iter().take(21) {
                    if frames.len() == 20 {
                        truncated = true;
                        break;
                    }
                    if safe_resource(&frame.resource) {
                        frames.push(frame);
                    } else {
                        rejected += 1;
                    }
                }
                value.insert("frames".into(), serde_json::to_value(frames).unwrap());
            } else {
                rejected += 1;
            }
        }
        if rejected > 0 {
            value.insert("rejected_fields".into(), rejected.into());
        }
        if truncated {
            value.insert("truncated".into(), true.into());
        }
        let mut bytes = serde_json::to_vec(&value).unwrap();
        bytes.push(b'\n');
        // The typed field budget is smaller than this limit, even with 20 frames.
        assert!(bytes.len() <= RECORD_LIMIT);
        Record {
            bytes,
            error: event.level() == "ERROR",
            summary: if matches!(event, Event::Dropped) {
                fields.error_code.zip(fields.count)
            } else {
                None
            },
        }
    }
}
struct Record {
    bytes: Vec<u8>,
    error: bool,
    summary: Option<(&'static str, u64)>,
}
struct Queue {
    records: VecDeque<Record>,
    normal: usize,
    errors: usize,
}

#[derive(Clone, Serialize)]
pub(crate) struct Status {
    pub directory: Option<PathBuf>,
    pub state: &'static str,
    pub error_code: Option<&'static str>,
    pub dropped: u64,
    pub shutdown_complete: bool,
    pub last_failure_at: Option<String>,
    pub last_os_error: Option<i32>,
}
struct Shared {
    context: Context,
    queue: Mutex<Queue>,
    dropped: AtomicU64,
    pending_dropped: AtomicU64,
    suppressed_frontend: AtomicU64,
    pending_write_dropped: AtomicU64,
    stopping: AtomicBool,
    finished: AtomicBool,
    status: Mutex<Status>,
    emergency: ArcSwapOption<EmergencyFile>,
    run_lease: OnceLock<File>,
    panic_claimed: AtomicBool,
    normal_exit: AtomicBool,
}
#[derive(Clone)]
pub(crate) struct Diagnostics {
    shared: Arc<Shared>,
    dispatcher: tracing::Dispatch,
}
struct EmergencyFile {
    file: File,
    slot: Arc<File>,
    date: String,
    shard: u32,
}
thread_local! { static CONTROLLED_EVENT: std::cell::RefCell<Option<(Event, Fields)>> = const { std::cell::RefCell::new(None) }; }
/// This subscriber is private to the typed producer. Ordinary application and
/// dependency tracing events cannot supply data to the file sink, even when
/// their target or level matches. No Display/Debug payload enters tracing.
struct DiagnosticSubscriber(Arc<Shared>);
impl tracing::Subscriber for DiagnosticSubscriber {
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        metadata.target() == "aibo::controlled_diagnostic"
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
    fn event(&self, event: &tracing::Event<'_>) {
        if !self.enabled(event.metadata()) {
            return;
        }
        if let Some((event, fields)) = CONTROLLED_EVENT.with(|slot| slot.borrow_mut().take()) {
            enqueue_producer(&self.0, event, fields);
        }
    }
}
fn enqueue_producer(shared: &Shared, event: Event, fields: Fields) {
    let drop_record = || {
        shared.dropped.fetch_add(1, Ordering::Relaxed);
        shared.pending_dropped.fetch_add(1, Ordering::Relaxed);
    };
    if shared.stopping.load(Ordering::Acquire) {
        drop_record();
        return;
    }
    if let Ok(mut queue) = shared.queue.try_lock() {
        let error = event.level() == "ERROR";
        if shared.stopping.load(Ordering::Acquire)
            || error && queue.errors >= ERROR_QUEUE
            || !error && queue.normal >= NORMAL_QUEUE
        {
            drop_record();
            return;
        }
        let record = shared.context.record(event, fields);
        if error {
            queue.errors += 1;
        } else {
            queue.normal += 1;
        }
        queue.records.push_back(record);
    } else {
        drop_record();
    }
}
static GLOBAL: OnceLock<Diagnostics> = OnceLock::new();
pub(crate) fn global() -> Option<&'static Diagnostics> {
    GLOBAL.get()
}
pub(crate) fn emit(event: Event, fields: Fields) {
    if let Some(log) = global() {
        log.emit(event, fields);
    }
}
pub(crate) fn classify_error(error: &str) -> &'static str {
    // Inspect a bounded prefix, never retain or serialize arbitrary error text.
    let prefix = error
        .as_bytes()
        .iter()
        .take(64)
        .position(|byte| *byte == b':')
        .and_then(|end| error.get(..end))
        .unwrap_or("");
    match prefix {
        "timeout" => "timeout",
        "permission_denied" => "permission_denied",
        "cancelled" => "cancelled",
        "invalid_request" | "invalid_output" => "invalid_response",
        "incompatible_version" | "protocol_incompatible" => "contract_mismatch",
        "internal" => "disconnected",
        "busy" => "busy",
        "invalid_session" => "invalid_session",
        "request_id_invalid"=>"request_id_invalid", "binding_mismatch"=>"binding_mismatch", "input_too_large"=>"input_too_large", "frame_too_large"=>"frame_too_large",
        "recovery_state_missing"=>"recovery_state_missing", "recovery_state_corrupt"=>"recovery_state_corrupt", "recovery_state_write_failed"=>"recovery_state_write_failed", "recovery_version_unsupported"=>"recovery_version_unsupported", "native_resume_failed"=>"native_resume_failed",
        "invalid_input" => "invalid_input",
        "provider_unavailable" => "provider_unavailable",
        "unsupported" | "capability_unsupported" => "unsupported",
        "approval_rejected" => "approval_rejected",
        _ => "unclassified",
    }
}
pub(crate) struct Operation {
    pub fields: Fields,
    started: Instant,
    complete: bool,
}
impl Operation {
    pub(crate) fn begin(operation: &'static str) -> Self {
        Self {
            fields: Fields {
                operation: Some(operation),
                ..Fields::default()
            },
            started: Instant::now(),
            complete: false,
        }
    }
    pub(crate) fn completed(mut self, outcome: &'static str) {
        self.fields.outcome = Some(outcome);
        self.fields.duration_ms = Some(self.started.elapsed().as_millis() as u64);
        emit(Event::SessionCompleted, std::mem::take(&mut self.fields));
        self.complete = true;
    }
    pub(crate) fn recovered(mut self) {
        self.fields.outcome = Some("recovered");
        self.fields.duration_ms = Some(self.started.elapsed().as_millis() as u64);
        emit(Event::SessionRecovered, std::mem::take(&mut self.fields));
        self.complete = true;
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        if !self.complete {
            self.fields.error_code.get_or_insert("unclassified");
            self.fields.outcome.get_or_insert("unknown");
            self.fields.duration_ms = Some(self.started.elapsed().as_millis() as u64);
            emit(Event::SessionFailed, std::mem::take(&mut self.fields));
        }
    }
}

/// A guard records only the stage code and observed result; error chains stay
/// on their original business path and never enter the diagnostic record.
pub(crate) struct StartupStage {
    name: &'static str,
    started: Instant,
    completed: bool,
    migration_version: Option<u64>,
    error_code: Option<&'static str>,
}
impl StartupStage {
    pub(crate) fn begin(name: &'static str) -> Self {
        Self {
            name,
            started: Instant::now(),
            completed: false,
            migration_version: None,
            error_code: None,
        }
    }
    pub(crate) fn migration_failed(&mut self, error: &sqlx::migrate::MigrateError) {
        use sqlx::migrate::MigrateError;
        let (version, code) = match error {
            MigrateError::VersionMismatch(version) => (Some(*version), "migration_checksum"),
            MigrateError::VersionMissing(version)
            | MigrateError::VersionNotPresent(version)
            | MigrateError::VersionTooOld(version, _)
            | MigrateError::VersionTooNew(version, _) => (Some(*version), "migration_version"),
            MigrateError::Dirty(version) => (Some(*version), "migration_dirty"),
            MigrateError::ExecuteMigration(_, version) => (Some(*version), "migration_execute"),
            _ => (None, "migration_error"),
        };
        self.error_code = Some(code);
        self.migration_version = version
            .and_then(|version| u64::try_from(version).ok())
            .filter(|version| *version > 0);
    }
    pub(crate) fn complete(mut self) {
        emit(
            Event::StageCompleted,
            Fields {
                stage: Some(self.name),
                duration_ms: Some(self.started.elapsed().as_millis() as u64),
                ..Fields::default()
            },
        );
        self.completed = true;
    }
}
impl Drop for StartupStage {
    fn drop(&mut self) {
        if !self.completed {
            emit(
                Event::StartupFailed,
                Fields {
                    stage: Some(self.name),
                    error_code: Some(self.error_code.unwrap_or(match self.name {
                        "database.open" => "database_error",
                        "database.migrate" => "migration_error",
                        _ => "initialization_error",
                    })),
                    migration_version: self.migration_version,
                    duration_ms: Some(self.started.elapsed().as_millis() as u64),
                    ..Fields::default()
                },
            );
        }
    }
}
pub(crate) fn initialize_boot() {
    if GLOBAL.get().is_some() {
        return;
    }
    let diagnostics = Diagnostics::buffered();
    if GLOBAL.set(diagnostics.clone()).is_ok() {
        std::panic::set_hook(Box::new(move |info| {
            let frame = info.location().and_then(|location| {
                let prefix = concat!(env!("CARGO_MANIFEST_DIR"), "/src/");
                let resource = if let Some(relative) = location.file().strip_prefix(prefix) {
                    format!("src-tauri/src/{relative}")
                } else if location.file().starts_with("src/") {
                    format!("src-tauri/{}", location.file())
                } else {
                    return None;
                };
                safe_resource(&resource).then_some(Frame {
                    resource,
                    line: Some(location.line()),
                    column: Some(location.column()),
                })
            });
            diagnostics.panic(frame);
        }));
    }
}
pub(crate) fn initialize_global(data: PathBuf) {
    initialize_boot();
    if let Some(log) = global() {
        log.attach(data, Limits::default());
    }
}
/// Tauri may abort from its setup callback before Builder::build returns an
/// error. Flush the bounded startup queue while that callback still owns control.
pub(crate) struct StartupGuard(bool);
impl StartupGuard {
    pub(crate) fn new() -> Self {
        Self(false)
    }
    pub(crate) fn complete(mut self) {
        self.0 = true;
    }
}
impl Drop for StartupGuard {
    fn drop(&mut self) {
        if !self.0 {
            if let Some(log) = global() {
                log.startup_failed();
            }
        }
    }
}
impl Diagnostics {
    /// DATA must be selected by app_storage; no frontend/plugin path is accepted.
    pub(crate) fn start(data: PathBuf) -> Self {
        Self::with_limits(data, Limits::default())
    }
    fn with_limits(data: PathBuf, limits: Limits) -> Self {
        let diagnostics = Self::buffered();
        diagnostics.attach(data, limits);
        diagnostics
    }
    fn buffered() -> Self {
        let shared = Arc::new(Shared {
            context: Context {
                boot_id: ulid::Ulid::new().to_string(),
                started: Instant::now(),
                sequence: AtomicU64::new(1),
            },
            queue: Mutex::new(Queue {
                records: VecDeque::new(),
                normal: 0,
                errors: 0,
            }),
            dropped: AtomicU64::new(0),
            pending_dropped: AtomicU64::new(0),
            suppressed_frontend: AtomicU64::new(0),
            pending_write_dropped: AtomicU64::new(0),
            stopping: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            emergency: ArcSwapOption::empty(),
            run_lease: OnceLock::new(),
            panic_claimed: AtomicBool::new(false),
            normal_exit: AtomicBool::new(false),
            status: Mutex::new(Status {
                directory: None,
                state: "initializing",
                error_code: None,
                dropped: 0,
                shutdown_complete: false,
                last_failure_at: None,
                last_os_error: None,
            }),
        });
        let diagnostics = Self {
            dispatcher: tracing::Dispatch::new(DiagnosticSubscriber(shared.clone())),
            shared,
        };
        diagnostics.emit(Event::Starting, Fields::default());
        diagnostics
    }
    fn attach(&self, data: PathBuf, limits: Limits) {
        self.shared.status.lock().unwrap().directory = Some(data.join("logs"));
        let shared = self.shared.clone();
        if std::thread::Builder::new()
            .name("aibo-diagnostics".into())
            .spawn(move || writer(shared, data, limits))
            .is_err()
        {
            self.shared.status.lock().unwrap().state = "degraded";
            self.shared.status.lock().unwrap().error_code = Some("initialization_error");
            safe_stderr("Aibo diagnostics unavailable");
        }
    }
    pub(crate) fn emit(&self, event: Event, fields: Fields) {
        CONTROLLED_EVENT.with(|slot| {
            *slot.borrow_mut() = Some((event, fields));
        });
        tracing::dispatcher::with_default(&self.dispatcher, || {
            // The marker carries no free text; record severity comes from Event.
            tracing::event!(target: "aibo::controlled_diagnostic", tracing::Level::INFO, diagnostic_marker = true);
        });
        // A disabled callsite must not retain an input beyond this call.
        CONTROLLED_EVENT.with(|slot| {
            slot.borrow_mut().take();
        });
    }
    pub(crate) fn suppress_frontend(&self) {
        self.shared
            .suppressed_frontend
            .fetch_add(1, Ordering::Relaxed);
        self.shared.dropped.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn status(&self) -> Status {
        let mut status = self.shared.status.lock().unwrap().clone();
        status.dropped = self.shared.dropped.load(Ordering::Relaxed);
        status.shutdown_complete = self.shared.finished.load(Ordering::Acquire);
        status
    }
    /// No queue, status mutex, database, or ordinary writer lock is used here.
    pub(crate) fn panic(&self, frame: Option<Frame>) {
        if self.shared.panic_claimed.swap(true, Ordering::AcqRel) {
            self.shared.dropped.fetch_add(1, Ordering::Relaxed);
            self.shared
                .pending_write_dropped
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        let timestamp = OffsetDateTime::now_utc();
        if let Some(file) = self.shared.emergency.load_full().filter(|file| file.date == timestamp.date().to_string()) {
            let mut record = self.shared.context.record_at(
                Event::Panic,
                Fields {
                    frames: frame.into_iter().collect(),
                    ..Fields::default()
                },
                timestamp,
            );
            if record.bytes.len() > EMERGENCY_RECORD_LIMIT {
                record = self.shared.context.record_at(Event::Panic, Fields::default(), timestamp);
            }
            let mut file = &file.file;
            if file
                .write_all(&record.bytes)
                .and_then(|_| file.flush())
                .is_ok()
            {
                return;
            }
        }
        self.shared.dropped.fetch_add(1, Ordering::Relaxed);
        self.shared
            .pending_write_dropped
            .fetch_add(1, Ordering::Relaxed);
        safe_stderr("Aibo panic diagnostics unavailable");
    }
    /// Call only after application cleanup, not when exit is merely requested.
    pub(crate) fn shutdown(&self) -> bool {
        self.finish(true)
    }
    pub(crate) fn startup_failed(&self) -> bool {
        self.finish(false)
    }
    fn finish(&self, normal_exit: bool) -> bool {
        if self.shared.status.lock().unwrap().directory.is_none() {
            safe_stderr("Aibo diagnostics unavailable");
            return false;
        }
        self.shared
            .normal_exit
            .store(normal_exit, Ordering::Release);
        self.shared.stopping.store(true, Ordering::Release);
        let deadline = Instant::now() + Duration::from_secs(2);
        while !self.shared.finished.load(Ordering::Acquire) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        let complete = self.shared.finished.load(Ordering::Acquire);
        if !complete {
            let mut status = self.shared.status.lock().unwrap();
            status.state = "degraded";
            status.error_code.get_or_insert("shutdown_timeout");
        }
        complete
    }
}

#[derive(Clone, Copy)]
struct Limits {
    shard: u64,
    total: u64,
    retention: Duration,
    cleanup: Duration,
    retry: Duration,
    #[cfg(test)]
    faults: Option<&'static Faults>,
}
#[cfg(test)]
#[derive(Default)]
struct Faults {
    write_errno: std::sync::atomic::AtomicI32,
    delete_denied: AtomicBool,
    dropped_write_denied: AtomicBool,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            shard: 10 * 1024 * 1024,
            total: 100 * 1024 * 1024,
            retention: Duration::from_secs(14 * 24 * 60 * 60),
            cleanup: Duration::from_secs(60),
            retry: Duration::from_secs(30),
            #[cfg(test)]
            faults: None,
        }
    }
}
fn io_code(error: &io::Error) -> &'static str {
    if matches!(error.raw_os_error(), Some(28 | 112)) {
        return "storage_full";
    }
    match error.kind() {
        io::ErrorKind::PermissionDenied => "permission_denied",
        _ => "io_error",
    }
}
fn writer(shared: Arc<Shared>, data: PathBuf, limits: Limits) {
    let mut sink = None;
    let mut last_shard = shared.emergency.load_full().map_or(0, |file| file.shard);
    let mut retry = Instant::now();
    let mut failed_at = None;
    let mut last_flush = Instant::now();
    let mut last_cleanup = Instant::now();
    let mut last_summary = Instant::now();
    loop {
        if sink.is_none() && Instant::now() >= retry {
            match Sink::open(&data, &shared.context.boot_id, limits) {
                Ok(mut opened) => {
                    opened.shard = last_shard;
                    sink = Some(opened);
                    let beginning = if shared.run_lease.get().is_none() {
                        sink.as_mut().unwrap().begin_run()
                    } else {
                        Ok(Vec::new())
                    };
                    match beginning {
                        Ok(previous) => {
                            if let Some(file) = sink.as_mut().unwrap().run.take() {
                                let _ = shared.run_lease.set(file);
                            }
                            for boot in previous {
                                enqueue_internal(
                                    &shared,
                                    Event::PreviousExitUnknown,
                                    Fields {
                                        previous_boot_id: Some(boot),
                                        ..Fields::default()
                                    },
                                );
                            }
                        }
                        Err(error) => {
                            degrade(&shared, &error);
                            sink = None;
                            failed_at.get_or_insert(Instant::now());
                        }
                    }
                    if let Some(current) = sink.as_mut() {
                        let result = refresh_emergency(&shared, current);
                        last_shard = last_shard.max(current.shard);
                        if let Err(error) = result {
                            degrade(&shared, &error);
                            sink = None;
                            failed_at.get_or_insert(Instant::now());
                        }
                    }
                    if let Some(started) = failed_at.take() {
                        if sink.is_some() {
                            let failure = shared.status.lock().unwrap().clone();
                            enqueue_internal(
                                &shared,
                                Event::WriteFailed,
                                Fields {
                                    error_code: failure.error_code,
                                    first_failure_at: failure.last_failure_at.clone(),
                                    os_error_code: failure.last_os_error,
                                    ..Fields::default()
                                },
                            );
                            enqueue_internal(
                                &shared,
                                Event::Recovered,
                                Fields {
                                    duration_ms: Some(
                                        Instant::now().duration_since(started).as_millis() as u64,
                                    ),
                                    count: Some(shared.dropped.load(Ordering::Relaxed)),
                                    first_failure_at: failure.last_failure_at,
                                    recovered_at: Some(utc_timestamp()),
                                    ..Fields::default()
                                },
                            );
                        } else {
                            failed_at = Some(started);
                        }
                    }
                    if sink.is_some() {
                        let mut status = shared.status.lock().unwrap();
                        status.state = "healthy";
                    }
                }
                Err(error) => {
                    degrade(&shared, &error);
                    failed_at.get_or_insert(Instant::now());
                }
            }
            retry = Instant::now() + limits.retry;
        }
        if let Some(current) = sink.as_mut() {
            let result = refresh_emergency(&shared, current);
            last_shard = last_shard.max(current.shard);
            if let Err(error) = result {
                degrade(&shared, &error);
                sink = None;
                failed_at.get_or_insert(Instant::now());
                retry = Instant::now() + limits.retry;
            }
        }
        let record = {
            let mut queue = shared.queue.lock().unwrap();
            let record = queue.records.pop_front();
            if let Some(record) = &record {
                if record.error {
                    queue.errors -= 1;
                } else {
                    queue.normal -= 1;
                }
            }
            record
        };
        if let Some(record) = record {
            let result = sink.as_mut().map(|sink| sink.write(&record));
            if let Some(current) = sink.as_ref() {
                last_shard = last_shard.max(current.shard);
            }
            match result {
                Some(Ok(())) => {}
                result => {
                    if let Some((reason, count)) = record.summary {
                        let counter = match reason {
                            "queue_full" => &shared.pending_dropped,
                            "rate_limited" => &shared.suppressed_frontend,
                            _ => &shared.pending_write_dropped,
                        };
                        counter.fetch_add(count, Ordering::Relaxed);
                    } else {
                        shared.dropped.fetch_add(1, Ordering::Relaxed);
                        shared.pending_write_dropped.fetch_add(1, Ordering::Relaxed);
                    }
                    if let Some(Err(error)) = result {
                        degrade(&shared, &error);
                        sink = None;
                        failed_at.get_or_insert(Instant::now());
                        retry = Instant::now() + limits.retry;
                    }
                }
            }
        } else if shared.stopping.load(Ordering::Acquire) {
            if let Some(sink) = sink.as_mut() {
                let result = flush_drop_summaries(&shared, sink).and_then(|_| {
                    if shared.normal_exit.load(Ordering::Acquire) {
                        let stopped = shared.context.record(Event::Stopped, Fields::default());
                        sink.write(&stopped)
                    } else {
                        Ok(())
                    }
                });
                let result = result.and_then(|_| sink.flush()).and_then(|_| {
                    if shared.normal_exit.load(Ordering::Acquire) {
                        if let Some(file) = shared.run_lease.get() {
                            finish_run_file(file, &shared.context.boot_id)?;
                        }
                    }
                    Ok(())
                });
                if result.is_ok() {
                    shared.finished.store(true, Ordering::Release);
                } else if let Err(error) = result {
                    degrade(&shared, &error);
                }
            }
            break;
        } else {
            std::thread::sleep(Duration::from_millis(5));
        }
        if let Some(current) = sink.as_mut() {
            let summarize = last_summary.elapsed() >= Duration::from_secs(1);
            if summarize {
                last_summary = Instant::now();
            }
            let count = if summarize {
                shared.pending_dropped.swap(0, Ordering::Relaxed)
            } else {
                0
            };
            let suppressed = if summarize {
                shared.suppressed_frontend.swap(0, Ordering::Relaxed)
            } else {
                0
            };
            let write_dropped = if summarize {
                shared.pending_write_dropped.swap(0, Ordering::Relaxed)
            } else {
                0
            };
            if write_dropped > 0 {
                enqueue_internal(
                    &shared,
                    Event::Dropped,
                    Fields {
                        count: Some(write_dropped),
                        error_code: Some("io_error"),
                        ..Fields::default()
                    },
                );
            }
            if suppressed > 0 {
                enqueue_internal(
                    &shared,
                    Event::Dropped,
                    Fields {
                        count: Some(suppressed),
                        error_code: Some("rate_limited"),
                        ..Fields::default()
                    },
                );
            }
            if count > 0 {
                enqueue_internal(
                    &shared,
                    Event::Dropped,
                    Fields {
                        count: Some(count),
                        error_code: Some("queue_full"),
                        ..Fields::default()
                    },
                );
            }
            let result = (|| {
                if last_cleanup.elapsed() >= limits.cleanup {
                    last_cleanup = Instant::now();
                    current.cleanup(0)?;
                }
                if last_flush.elapsed() >= Duration::from_secs(1) {
                    last_flush = Instant::now();
                    current.flush()?;
                }
                Ok(())
            })();
            if let Err(error) = result {
                degrade(&shared, &error);
                sink = None;
                failed_at.get_or_insert(Instant::now());
                retry = Instant::now() + limits.retry;
            }
        }
    }
}
fn refresh_emergency(shared: &Shared, sink: &mut Sink) -> io::Result<()> {
    if shared.panic_claimed.load(Ordering::Acquire) {
        return Ok(());
    }
    let date = OffsetDateTime::now_utc().date().to_string();
    let previous = shared.emergency.load_full();
    if previous.as_ref().is_some_and(|file| file.date == date) {
        return Ok(());
    }
    if previous.is_none() && Instant::now() < sink.emergency_retry {
        return Ok(());
    }
    if let Some(file) = sink.prepare_emergency_date(date, previous.as_ref().map(|file| file.slot.clone()))? {
        // A reader keeps its own Arc during IO. Replacing the prepared channel
        // neither takes a panic-side lock nor leaks old handles across days.
        shared.emergency.store(Some(Arc::new(file)));
    } else {
        sink.emergency_retry = Instant::now() + sink.limits.retry;
    }
    Ok(())
}
fn flush_drop_summaries(shared: &Shared, sink: &mut Sink) -> io::Result<()> {
    for (counter, reason) in [
        (&shared.pending_write_dropped, "io_error"),
        (&shared.pending_dropped, "queue_full"),
        (&shared.suppressed_frontend, "rate_limited"),
    ] {
        let count = counter.swap(0, Ordering::Relaxed);
        if count == 0 {
            continue;
        }
        let record = shared.context.record(
            Event::Dropped,
            Fields {
                count: Some(count),
                error_code: Some(reason),
                ..Fields::default()
            },
        );
        if let Err(error) = sink.write(&record) {
            counter.fetch_add(count, Ordering::Relaxed);
            return Err(error);
        }
    }
    Ok(())
}
fn enqueue_internal(shared: &Shared, event: Event, fields: Fields) {
    let mut queue = shared.queue.lock().unwrap();
    let error = event.level() == "ERROR";
    if (error && queue.errors < ERROR_QUEUE) || (!error && queue.normal < NORMAL_QUEUE) {
        let record = shared.context.record(event, fields);
        queue.records.push_back(record);
        if error {
            queue.errors += 1;
        } else {
            queue.normal += 1;
        }
    } else {
        if fields.error_code == Some("rate_limited") {
            shared
                .suppressed_frontend
                .fetch_add(fields.count.unwrap_or(1), Ordering::Relaxed);
        } else if fields.error_code == Some("io_error") {
            shared
                .pending_write_dropped
                .fetch_add(fields.count.unwrap_or(1), Ordering::Relaxed);
        } else {
            shared
                .pending_dropped
                .fetch_add(fields.count.unwrap_or(1), Ordering::Relaxed);
        }
    }
}
fn degrade(shared: &Shared, error: &io::Error) {
    let mut status = shared.status.lock().unwrap();
    if status.state != "degraded" {
        status.last_failure_at = Some(utc_timestamp());
    }
    status.last_os_error = error.raw_os_error();
    status.state = "degraded";
    status.error_code = Some(match error.to_string().as_str() {
        "quota_exhausted" => "quota_exhausted",
        "unsafe_directory" => "unsafe_directory",
        _ => io_code(error),
    });
    safe_stderr("Aibo diagnostics write unavailable");
}

// The directory handle anchors all opens and unlinks. Renaming/replacing logs
// after initialization cannot redirect IO or cleanup outside the selected DATA.
#[cfg(unix)]
struct Directory {
    file: File,
    path: PathBuf,
}
#[cfg(unix)]
impl Directory {
    fn open(data: &Path) -> io::Result<Self> {
        use std::os::unix::{
            fs::{DirBuilderExt, OpenOptionsExt},
            io::{AsRawFd, FromRawFd},
        };
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder.create(data)?;
        let root = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(data)?;
        let name = std::ffi::CString::new("logs").unwrap();
        let result = unsafe { libc::mkdirat(root.as_raw_fd(), name.as_ptr(), 0o700) };
        if result < 0 && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists {
            return Err(io::Error::last_os_error());
        }
        let fd = unsafe {
            libc::openat(
                root.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io::Error::other("unsafe_directory"));
        }
        Ok(Self {
            file: unsafe { File::from_raw_fd(fd) },
            path: data.join("logs"),
        })
    }
    fn open_file(&self, name: &str, create: bool) -> io::Result<File> {
        use std::os::unix::io::{AsRawFd, FromRawFd};
        let name = std::ffi::CString::new(name).unwrap();
        let flags = libc::O_RDWR
            | libc::O_NONBLOCK
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | if create {
                libc::O_CREAT | libc::O_EXCL
            } else {
                0
            };
        let fd = unsafe { libc::openat(self.file.as_raw_fd(), name.as_ptr(), flags, 0o600) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if !file.metadata()?.is_file() {
            return Err(io::Error::other("unsafe_directory"));
        }
        Ok(file)
    }
    fn remove(&self, name: &str) -> io::Result<()> {
        use std::os::unix::io::AsRawFd;
        let name = std::ffi::CString::new(name).unwrap();
        if unsafe { libc::unlinkat(self.file.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    fn names(&self) -> io::Result<Vec<String>> {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::symlink_metadata(&self.path)?;
        let anchored = self.file.metadata()?;
        if metadata.dev() != anchored.dev()
            || metadata.ino() != anchored.ino()
            || !metadata.is_dir()
        {
            return Err(io::Error::other("unsafe_directory"));
        }
        std::fs::read_dir(&self.path)?
            .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
            .collect()
    }
}
#[cfg(unix)]
fn lock(file: &File, nonblocking: bool) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    if unsafe {
        libc::flock(
            file.as_raw_fd(),
            libc::LOCK_EX | if nonblocking { libc::LOCK_NB } else { 0 },
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(unix)]
fn unlock(file: &File) {
    use std::os::unix::io::AsRawFd;
    unsafe {
        libc::flock(file.as_raw_fd(), libc::LOCK_UN);
    }
}

#[cfg(windows)]
struct Directory {
    _root: File,
    _file: File,
    path: PathBuf,
}
#[cfg(windows)]
impl Directory {
    fn open(data: &Path) -> io::Result<Self> {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        use windows_sys::Win32::Storage::FileSystem::*;
        fn directory(path: &Path) -> io::Result<File> {
            // Denying delete sharing pins DATA and logs while any IO is possible.
            let file = std::fs::OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(path)?;
            let metadata = file.metadata()?;
            if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            {
                return Err(io::Error::other("unsafe_directory"));
            }
            Ok(file)
        }
        std::fs::create_dir_all(data)?;
        let root = directory(data)?;
        let path = data.join("logs");
        match std::fs::create_dir(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        let file = directory(&path)?;
        Ok(Self {
            _root: root,
            _file: file,
            path,
        })
    }
    fn open_file(&self, name: &str, create: bool) -> io::Result<File> {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        use windows_sys::Win32::Storage::FileSystem::*;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(create)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(self.path.join(name))?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::other("unsafe_directory"));
        }
        Ok(file)
    }
    fn remove(&self, name: &str) -> io::Result<()> {
        std::fs::remove_file(self.path.join(name))
    }
    fn names(&self) -> io::Result<Vec<String>> {
        std::fs::read_dir(&self.path)?
            .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
            .collect()
    }
}
#[cfg(windows)]
fn lease_position() -> windows_sys::Win32::System::IO::OVERLAPPED {
    use windows_sys::Win32::System::IO::{OVERLAPPED, OVERLAPPED_0, OVERLAPPED_0_0};
    // Windows locks deny ordinary reads, unlike Unix flock. Lease one byte at
    // 4 GiB, beyond all bounded log and metadata contents, without extending EOF.
    // Every owner and cleanup contender uses this same range.
    OVERLAPPED {
        Anonymous: OVERLAPPED_0 {
            Anonymous: OVERLAPPED_0_0 { Offset: 0, OffsetHigh: 1 },
        },
        ..OVERLAPPED::default()
    }
}
#[cfg(windows)]
fn lock(file: &File, nonblocking: bool) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    };
    let mut overlapped = lease_position();
    let flags = LOCKFILE_EXCLUSIVE_LOCK
        | if nonblocking {
            LOCKFILE_FAIL_IMMEDIATELY
        } else {
            0
        };
    if unsafe {
        LockFileEx(
            file.as_raw_handle(),
            flags,
            0,
            1,
            0,
            &mut overlapped,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(windows)]
fn unlock(file: &File) {
    use std::os::windows::io::AsRawHandle;
    let mut overlapped = lease_position();
    unsafe {
        windows_sys::Win32::Storage::FileSystem::UnlockFileEx(
            file.as_raw_handle(),
            0,
            1,
            0,
            &mut overlapped,
        );
    }
}

struct Sink {
    directory: Directory,
    coordination: File,
    current: Option<File>,
    boot_id: String,
    shard: u32,
    date: String,
    bytes: u64,
    limits: Limits,
    run: Option<File>,
    emergency_retry: Instant,
}
impl Sink {
    fn open(data: &Path, boot_id: &str, limits: Limits) -> io::Result<Self> {
        let directory = Directory::open(data)?;
        let coordination = match directory.open_file(".aibo-diagnostics.lock", true) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                directory.open_file(".aibo-diagnostics.lock", false)?
            }
            Err(error) => return Err(error),
        };
        Ok(Self {
            directory,
            coordination,
            current: None,
            boot_id: boot_id.into(),
            shard: 0,
            date: String::new(),
            bytes: 0,
            limits,
            run: None,
            emergency_retry: Instant::now(),
        })
    }
    fn begin_run(&mut self) -> io::Result<Vec<String>> {
        lock(&self.coordination, false)?;
        let result = (|| {
            let mut previous = Vec::new();
            for name in self.directory.names()? {
                let Some(boot) = name
                    .strip_prefix("aibo-")
                    .and_then(|v| v.strip_suffix(".run"))
                else {
                    continue;
                };
                if boot.len() != 26 || boot.parse::<ulid::Ulid>().is_err() || boot == self.boot_id {
                    continue;
                }
                let mut file = match self.directory.open_file(&name, false) {
                    Ok(file) => file,
                    Err(_) => continue,
                };
                if lock(&file, true).is_err() {
                    continue;
                } // A live instance owns it.
                let mut bytes = Vec::new();
                (&mut file).take(1025).read_to_end(&mut bytes)?;
                if bytes.len() <= 1024 {
                    if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                        if value["boot_id"] == boot
                            && value["pid"]
                                .as_u64()
                                .is_some_and(|pid| pid > 0 && pid <= u32::MAX as u64)
                            && value["state"] == "running"
                        {
                            previous.push(boot.into());
                        }
                    }
                }
                #[cfg(windows)]
                drop(file);
                self.directory.remove(&name)?;
            }
            let name = format!("aibo-{}.run", self.boot_id);
            let mut file = match self.directory.open_file(&name, true) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    self.directory.open_file(&name, false)?
                }
                Err(error) => return Err(error),
            };
            lock(&file, false)?;
            file.set_len(0)?;
            serde_json::to_writer(
                &mut file,
                &serde_json::json!({"boot_id":self.boot_id,"pid":std::process::id(),"state":"running"}),
            )?;
            file.flush()?;
            self.run = Some(file);
            Ok(previous)
        })();
        unlock(&self.coordination);
        result
    }
    fn finish_run(&mut self) -> io::Result<()> {
        if let Some(file) = self.run.as_mut() {
            file.rewind()?;
            file.set_len(0)?;
            serde_json::to_writer(
                &mut *file,
                &serde_json::json!({"boot_id":self.boot_id,"pid":std::process::id(),"state":"stopped"}),
            )?;
            file.flush()?;
        }
        Ok(())
    }
    fn write(&mut self, record: &Record) -> io::Result<()> {
        self.write_date(record, OffsetDateTime::now_utc().date().to_string())
    }
    fn write_date(&mut self, record: &Record, date: String) -> io::Result<()> {
        lock(&self.coordination, false)?;
        let result = self.write_locked(record, date);
        unlock(&self.coordination);
        result
    }
    #[cfg(test)]
    fn prepare_emergency(&mut self) -> io::Result<Option<EmergencyFile>> {
        self.prepare_emergency_date(OffsetDateTime::now_utc().date().to_string(), None)
    }
    fn prepare_emergency_date(&mut self, date: String, previous_slot: Option<Arc<File>>) -> io::Result<Option<EmergencyFile>> {
        lock(&self.coordination, false)?;
        let result = (|| {
            self.cleanup_locked(0)?;
            let mut slot = previous_slot;
            for index in 0..EMERGENCY_SLOTS {
                if slot.is_some() {
                    break;
                }
                let name = format!(".aibo-emergency-slot-{index:02}");
                let file = match self.directory.open_file(&name, true) {
                    Ok(file) => file,
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        self.directory.open_file(&name, false)?
                    }
                    Err(error) => return Err(error),
                };
                if lock(&file, true).is_ok() {
                    slot = Some(Arc::new(file));
                    break;
                }
            }
            let Some(slot) = slot else {
                return Ok(None);
            };
            let file = loop {
                self.shard = self.shard.checked_add(1)
                    .ok_or_else(|| io::Error::other("quota_exhausted"))?;
                let name = format!("aibo-{date}-{}-{:04}.jsonl", self.boot_id, self.shard);
                match self.directory.open_file(&name, true) {
                    Ok(file) => { lock(&file, false)?; break file; }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error),
                }
            };
            Ok(Some(EmergencyFile { file, slot, date, shard: self.shard }))
        })();
        unlock(&self.coordination);
        result
    }
    fn write_locked(&mut self, record: &Record, date: String) -> io::Result<()> {
        if record.bytes.len() as u64 > self.limits.shard {
            return Err(io::Error::other("quota_exhausted"));
        }
        if self.current.is_none()
            || self.date != date
            || self.bytes + record.bytes.len() as u64 > self.limits.shard
        {
            self.flush()?;
            if let Some(file) = self.current.as_ref() {
                file.set_times(
                    std::fs::FileTimes::new().set_modified(std::time::SystemTime::now()),
                )?;
            }
            self.current = None;
            self.cleanup_locked(record.bytes.len() as u64)?;
            loop {
                self.shard = self
                    .shard
                    .checked_add(1)
                    .ok_or_else(|| io::Error::other("quota_exhausted"))?;
                let name = format!("aibo-{date}-{}-{:04}.jsonl", self.boot_id, self.shard);
                match self.directory.open_file(&name, true) {
                    Ok(file) => {
                        lock(&file, false)?;
                        self.current = Some(file);
                        break;
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error),
                }
            }
            self.date = date;
            self.bytes = 0;
        } else {
            self.cleanup_locked(record.bytes.len() as u64)?;
        }
        #[cfg(test)]
        if let Some(faults) = self.limits.faults {
            if faults.dropped_write_denied.load(Ordering::Relaxed)
                && serde_json::from_slice::<Value>(&record.bytes).unwrap()["event"]
                    == "diagnostics.dropped"
            {
                return Err(io::Error::from_raw_os_error(28));
            }
            let errno = faults.write_errno.load(Ordering::Relaxed);
            if errno != 0 {
                // Model a partial kernel write before ENOSPC; retain a valid
                // prefix so recovery cannot leave a malformed interior row.
                self.current
                    .as_mut()
                    .unwrap()
                    .write_all(&record.bytes[..record.bytes.len() / 2])?;
                self.current.as_ref().unwrap().set_len(self.bytes)?;
                return Err(io::Error::from_raw_os_error(errno));
            }
        }
        if let Err(error) = self.current.as_mut().unwrap().write_all(&record.bytes) {
            let _ = self.current.as_ref().unwrap().set_len(self.bytes);
            return Err(error);
        }
        self.bytes += record.bytes.len() as u64;
        if record.error {
            self.flush()?;
        }
        Ok(())
    }
    fn flush(&mut self) -> io::Result<()> {
        if let Some(file) = self.current.as_mut() {
            file.flush()?;
        }
        Ok(())
    }
    fn cleanup(&mut self, incoming: u64) -> io::Result<()> {
        lock(&self.coordination, false)?;
        let result = self.cleanup_locked(incoming);
        unlock(&self.coordination);
        result
    }
    fn cleanup_locked(&mut self, incoming: u64) -> io::Result<()> {
        let mut total = incoming + EMERGENCY_RESERVE;
        let mut sealed = Vec::new();
        for name in self.directory.names()? {
            if !owned_name(&name) {
                continue;
            }
            let file = match self.directory.open_file(&name, false) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) if error.to_string() == "unsafe_directory" => continue,
                #[cfg(unix)]
                Err(error) if error.raw_os_error() == Some(libc::ELOOP) => continue,
                Err(error) => return Err(error),
            };
            let metadata = file.metadata()?;
            total = total
                .checked_add(metadata.len())
                .ok_or_else(|| io::Error::other("quota_exhausted"))?;
            if lock(&file, true).is_ok() {
                sealed.push((metadata.modified()?, name, metadata.len(), file));
            }
        }
        // A single 64 KiB reserve covers 32 process-leased 2 KiB channels.
        // Ordinary records cannot consume it, regardless of instance count.
        sealed.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
        for (modified, name, size, guard) in sealed {
            let expired = std::time::SystemTime::now()
                .duration_since(modified)
                .unwrap_or_default()
                >= self.limits.retention;
            #[cfg(windows)]
            drop(guard); // Windows handles deny deletion; profile lock stays held.
            #[cfg(unix)]
            let _guard = guard;
            if expired || total > self.limits.total {
                #[cfg(test)]
                if self
                    .limits
                    .faults
                    .is_some_and(|faults| faults.delete_denied.load(Ordering::Relaxed))
                {
                    return Err(io::Error::from(io::ErrorKind::PermissionDenied));
                }
                self.directory.remove(&name)?;
                total -= size;
            }
        }
        if total > self.limits.total {
            return Err(io::Error::other("quota_exhausted"));
        }
        Ok(())
    }
}
fn finish_run_file(mut file: &File, boot_id: &str) -> io::Result<()> {
    file.rewind()?;
    file.set_len(0)?;
    serde_json::to_writer(
        &mut file,
        &serde_json::json!({"boot_id":boot_id,"pid":std::process::id(),"state":"stopped"}),
    )?;
    file.flush()
}
fn owned_name(name: &str) -> bool {
    let Some(stem) = name
        .strip_prefix("aibo-")
        .and_then(|v| v.strip_suffix(".jsonl"))
    else {
        return false;
    };
    let parts: Vec<_> = stem.split('-').collect();
    parts.len() == 5
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts[..3]
            .iter()
            .all(|s| s.bytes().all(|b| b.is_ascii_digit()))
        && parts[0]
            .parse::<i32>()
            .ok()
            .zip(parts[1].parse::<u8>().ok())
            .zip(parts[2].parse::<u8>().ok())
            .is_some_and(|((year, month), day)| {
                time::Month::try_from(month)
                    .ok()
                    .is_some_and(|month| time::Date::from_calendar_date(year, month, day).is_ok())
            })
        && parts[3].len() == 26
        && parts[3].parse::<ulid::Ulid>().is_ok()
        && parts[4].len() >= 4
        && parts[4].len() <= 10
        && parts[4].bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn active_files_remain_readable_without_releasing_their_leases() {
        let root = tempfile::tempdir().unwrap();
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let mut sink = Sink::open(root.path(), &context.boot_id, Limits::default()).unwrap();
        sink.begin_run().unwrap();
        sink.write(&context.record(Event::Ready, Fields::default())).unwrap();
        sink.flush().unwrap();
        let emergency = sink.prepare_emergency().unwrap().unwrap();
        let name = format!("aibo-{}-{}-{:04}.jsonl", sink.date, context.boot_id, sink.shard - 1);
        let competing = sink.directory.open_file(&name, false).unwrap();
        assert!(lock(&competing, true).is_err(), "an active file retains its exclusive lease");
        assert_eq!(records(root.path())[0]["event"], "app.ready");
        let run: Value = serde_json::from_str(&std::fs::read_to_string(
            root.path().join("logs").join(format!("aibo-{}.run", context.boot_id)),
        ).unwrap()).unwrap();
        assert_eq!(run["state"], "running");
        sink.cleanup(0).unwrap();
        assert_eq!(records(root.path())[0]["event"], "app.ready");
        drop(emergency);
        drop(sink);
        lock(&competing, true).unwrap();
        unlock(&competing);
    }
    fn records(path: &Path) -> Vec<Value> {
        let mut rows: Vec<Value> = Vec::new();
        for entry in std::fs::read_dir(path.join("logs")).unwrap() {
            let path = entry.unwrap().path();
            if path
                .file_name()
                .and_then(|v| v.to_str())
                .is_some_and(owned_name)
            {
                for line in std::fs::read_to_string(path).unwrap().lines() {
                    rows.push(serde_json::from_str(line).unwrap());
                }
            }
        }
        rows.sort_by_key(|row| row["sequence"].as_u64());
        rows
    }
    #[test]
    fn writes_actual_jsonl_with_environment_and_rejects_sensitive_shapes() {
        let root = tempfile::tempdir().unwrap();
        let diagnostics = Diagnostics::start(root.path().into());
        diagnostics.emit(
            Event::SessionFailed,
            Fields {
                session_id: Some("/secret/canary\nforged".into()),
                operation: Some("session.send"),
                error_code: Some("timeout"),
                ..Fields::default()
            },
        );
        diagnostics.emit(
            Event::Panic,
            Fields {
                frames: vec![Frame {
                    resource: "https://example.com/private?canary".into(),
                    line: Some(1),
                    column: Some(2),
                }],
                ..Fields::default()
            },
        );
        assert!(diagnostics.shutdown());
        let rows = records(root.path());
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0]["event"], "app.starting");
        assert_eq!(rows[3]["event"], "app.stopped");
        assert_eq!(rows[1]["rejected_fields"], 1);
        assert!(rows[1].get("session_id").is_none());
        assert!(!serde_json::to_string(&rows).unwrap().contains("canary"));
        for row in rows {
            for key in [
                "app_version",
                "build_channel",
                "os",
                "arch",
                "boot_id",
                "elapsed_ms",
            ] {
                assert!(row.get(key).is_some());
            }
        }
    }
    #[test]
    fn separate_queue_limits_and_producers_do_not_wait_for_writer() {
        let shared = Arc::new(Shared {
            context: Context {
                boot_id: ulid::Ulid::new().to_string(),
                started: Instant::now(),
                sequence: AtomicU64::new(1),
            },
            queue: Mutex::new(Queue {
                records: VecDeque::new(),
                normal: 0,
                errors: 0,
            }),
            dropped: AtomicU64::new(0),
            pending_dropped: AtomicU64::new(0),
            suppressed_frontend: AtomicU64::new(0),
            pending_write_dropped: AtomicU64::new(0),
            stopping: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            emergency: ArcSwapOption::empty(),
            run_lease: OnceLock::new(),
            panic_claimed: AtomicBool::new(false),
            normal_exit: AtomicBool::new(false),
            status: Mutex::new(Status {
                directory: None,
                state: "initializing",
                error_code: None,
                dropped: 0,
                shutdown_complete: false,
                last_failure_at: None,
                last_os_error: None,
            }),
        });
        let diagnostics = Diagnostics {
            dispatcher: tracing::Dispatch::new(DiagnosticSubscriber(shared.clone())),
            shared,
        };
        for _ in 0..NORMAL_QUEUE + 7 {
            diagnostics.emit(Event::Ready, Fields::default());
        }
        for _ in 0..ERROR_QUEUE + 3 {
            diagnostics.emit(Event::Panic, Fields::default());
        }
        assert_eq!(diagnostics.status().dropped, 10);
        let queue = diagnostics.shared.queue.lock().unwrap();
        assert_eq!(queue.records.len(), NORMAL_QUEUE + ERROR_QUEUE);
        diagnostics.emit(Event::Ready, Fields::default()); // Held lock must not block.
        assert_eq!(diagnostics.shared.dropped.load(Ordering::Relaxed), 11);
    }
    #[test]
    fn rotates_complete_records_and_retains_only_owned_files() {
        let root = tempfile::tempdir().unwrap();
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let record = context.record(Event::Ready, Fields::default());
        let limits = Limits {
            shard: record.bytes.len() as u64 + 20,
            total: EMERGENCY_RESERVE + 1500,
            ..Limits::default()
        };
        let mut sink = Sink::open(root.path(), &context.boot_id, limits).unwrap();
        std::fs::write(root.path().join("logs/unrelated.jsonl"), "preserve").unwrap();
        sink.write(&context.record(Event::Starting, Fields::default()))
            .unwrap();
        for _ in 0..20 {
            sink.write(&context.record(Event::Ready, Fields::default()))
                .unwrap();
        }
        sink.flush().unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("logs/unrelated.jsonl")).unwrap(),
            "preserve"
        );
        let mut total = 0;
        for entry in std::fs::read_dir(root.path().join("logs")).unwrap() {
            let entry = entry.unwrap();
            if !owned_name(entry.file_name().to_str().unwrap()) {
                continue;
            }
            let size = entry.metadata().unwrap().len();
            assert!(size <= limits.shard);
            total += size;
            let row: Value =
                serde_json::from_str(std::fs::read_to_string(entry.path()).unwrap().trim())
                    .unwrap();
            assert_eq!(row["app_version"], env!("CARGO_PKG_VERSION"));
        }
        assert!(total + EMERGENCY_RESERVE <= limits.total);
        assert!(!records(root.path())
            .iter()
            .any(|row| row["event"] == "app.starting"));
    }
    #[cfg(unix)]
    #[test]
    fn refuses_linked_directory_and_does_not_delete_link_targets() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), root.path().join("logs")).unwrap();
        assert!(Sink::open(
            root.path(),
            &ulid::Ulid::new().to_string(),
            Limits::default()
        )
        .is_err());
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
        std::fs::remove_file(root.path().join("logs")).unwrap();
        let mut sink = Sink::open(
            root.path(),
            &ulid::Ulid::new().to_string(),
            Limits::default(),
        )
        .unwrap();
        let target = outside.path().join("secret");
        std::fs::write(&target, "preserve").unwrap();
        symlink(
            &target,
            root.path()
                .join("logs")
                .join(format!("aibo-2020-01-01-{}-0001.jsonl", ulid::Ulid::new())),
        )
        .unwrap();
        sink.cleanup(0).unwrap();
        assert_eq!(std::fs::read_to_string(target).unwrap(), "preserve");
    }
    #[cfg(windows)]
    #[test]
    fn refuses_windows_junction_without_writing_or_cleaning_its_target() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let sentinel = outside.path().join(format!(
            "aibo-2020-01-01-{}-0001.jsonl", ulid::Ulid::new()
        ));
        std::fs::write(&sentinel, "junction-target-canary").unwrap();
        let link = root.path().join("logs");
        let literal = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null",
            literal(&link), literal(outside.path())
        );
        let result = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output().unwrap();
        assert!(result.status.success(), "junction creation failed: {}", String::from_utf8_lossy(&result.stderr));
        let result = Sink::open(root.path(), &ulid::Ulid::new().to_string(), Limits::default());
        assert!(matches!(result, Err(ref error) if error.to_string() == "unsafe_directory"));
        assert_eq!(std::fs::read_to_string(&sentinel).unwrap(), "junction-target-canary");
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 1);
        // Remove the reparse point itself before TempDir performs cleanup.
        std::fs::remove_dir(&link).unwrap();
        assert!(sentinel.exists());
    }
    #[test]
    fn panic_child() {
        let Some(data) = std::env::var_os("AIBO_DIAGNOSTIC_PANIC_TEST") else {
            return;
        };
        let data = PathBuf::from(data);
        if let Some(offset) = std::env::var("AIBO_DIAGNOSTIC_PANIC_DATE_OFFSET").ok() {
            initialize_boot();
            let log = global().unwrap();
            let date = (OffsetDateTime::now_utc() + time::Duration::days(offset.parse().unwrap())).date().to_string();
            let mut sink = Sink::open(&data, &log.shared.context.boot_id, Limits::default()).unwrap();
            let prepared = sink.prepare_emergency_date(date, None).unwrap().unwrap();
            log.shared.emergency.store(Some(Arc::new(prepared)));
            drop(sink);
            log.attach(data, Limits::default());
        } else {
            initialize_global(data);
        }
        let log = global().unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !log.shared.emergency.load_full().is_some_and(|file| file.date == OffsetDateTime::now_utc().date().to_string()) {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        let mode = std::env::var("AIBO_DIAGNOSTIC_PANIC_MODE").unwrap_or_else(|_| "locked".into());
        if mode == "ordinary" {
            println!("T03 panic mode ready: {mode}");
            panic!("private-panic-canary token=secret /Users/private");
        }
        let mut queue = log.shared.queue.lock().unwrap();
        if mode == "saturated" {
            // Hold the queue while filling its actual record storage; the
            // writer cannot race the saturated precondition before the hook.
            while queue.normal < NORMAL_QUEUE {
                queue.records.push_back(log.shared.context.record(Event::Ready, Fields::default()));
                queue.normal += 1;
            }
            assert_eq!(queue.normal, NORMAL_QUEUE);
        }
        println!("T03 panic mode ready: {mode}");
        panic!("private-panic-canary token=secret /Users/private");
    }
    #[test]
    fn panic_subprocess_writes_safe_emergency_without_queue_lock() {
        for mode in ["ordinary", "saturated", "locked"] {
            let root = tempfile::tempdir().unwrap();
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "diagnostics::tests::panic_child", "--nocapture"])
                .env("AIBO_DIAGNOSTIC_PANIC_TEST", root.path())
                .env("AIBO_DIAGNOSTIC_PANIC_MODE", mode)
                .output()
                .unwrap();
            assert!(!result.status.success());
            assert!(String::from_utf8_lossy(&result.stdout).contains(&format!("T03 panic mode ready: {mode}")), "panic scenario reached its required precondition");
            let rows = records(root.path());
            let panic = rows.iter().find(|row| row["event"] == "app.panic").unwrap();
            assert_eq!(panic["level"], "ERROR");
            for entry in std::fs::read_dir(root.path().join("logs")).unwrap() {
                let bytes = std::fs::read(entry.unwrap().path()).unwrap();
                assert!(!String::from_utf8_lossy(&bytes).contains("private-panic-canary"));
            }
            for key in ["app_version", "build_channel", "os", "arch"] {
                assert!(panic.get(key).is_some());
            }

        }
    }
    #[test]
    fn panic_subprocess_rotates_prepared_channel_after_utc_forward_and_rollback() {
        for offset in [-1, 1] {
            let root = tempfile::tempdir().unwrap();
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "diagnostics::tests::panic_child", "--nocapture"])
                .env("AIBO_DIAGNOSTIC_PANIC_TEST", root.path())
                .env("AIBO_DIAGNOSTIC_PANIC_DATE_OFFSET", offset.to_string())
                .output().unwrap();
            assert!(!result.status.success());
            let mut observed = 0;
            for entry in std::fs::read_dir(root.path().join("logs")).unwrap() {
                let entry = entry.unwrap();
                let name = entry.file_name().to_string_lossy().into_owned();
                let bytes = std::fs::read(entry.path()).unwrap();
                assert!(!String::from_utf8_lossy(&bytes).contains("private-panic-canary"));
                if !name.ends_with(".jsonl") { continue; }
                for line in String::from_utf8(bytes).unwrap().lines() {
                    let row: Value = serde_json::from_str(line).unwrap();
                    if row["event"] == "app.panic" {
                        let timestamp = row["timestamp"].as_str().unwrap();
                        assert!(name.starts_with(&format!("aibo-{}-", &timestamp[..10])));
                        let shard = name.trim_end_matches(".jsonl").rsplit('-').next().unwrap().parse::<u32>().unwrap();
                        assert!(shard > 1, "prepared file rotates with an increasing shard");
                        observed += 1;
                    }
                }
            }
            assert_eq!(observed, 1);
        }
    }
    #[test]
    fn simultaneous_active_shards_are_never_deleted_to_make_room() {
        let root = tempfile::tempdir().unwrap();
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let record = context.record(Event::Ready, Fields::default());
        let limits = Limits {
            total: EMERGENCY_RESERVE + 2 * record.bytes.len() as u64 + 10,
            ..Limits::default()
        };
        let mut a = Sink::open(root.path(), &context.boot_id, limits).unwrap();
        let mut b = Sink::open(root.path(), &ulid::Ulid::new().to_string(), limits).unwrap();
        a.write(&record).unwrap();
        b.write(&record).unwrap();
        assert_eq!(a.write(&record).unwrap_err().to_string(), "quota_exhausted");
        let rows = records(root.path());
        assert_eq!(rows.len(), 2);
    }
    #[test]
    fn run_metadata_distinguishes_active_clean_unknown_and_corrupt_runs() {
        let root = tempfile::tempdir().unwrap();
        let a_boot = ulid::Ulid::new().to_string();
        let mut a = Sink::open(root.path(), &a_boot, Limits::default()).unwrap();
        assert!(a.begin_run().unwrap().is_empty());
        let mut b = Sink::open(
            root.path(),
            &ulid::Ulid::new().to_string(),
            Limits::default(),
        )
        .unwrap();
        assert!(b.begin_run().unwrap().is_empty()); // A is alive, irrespective of PID.
        drop(a);
        let mut c = Sink::open(
            root.path(),
            &ulid::Ulid::new().to_string(),
            Limits::default(),
        )
        .unwrap();
        assert_eq!(c.begin_run().unwrap(), vec![a_boot]);
        b.finish_run().unwrap();
        drop(b);
        std::fs::write(
            root.path()
                .join("logs")
                .join(format!("aibo-{}.run", ulid::Ulid::new())),
            "corrupted",
        )
        .unwrap();
        let mut d = Sink::open(
            root.path(),
            &ulid::Ulid::new().to_string(),
            Limits::default(),
        )
        .unwrap();
        assert!(d.begin_run().unwrap().is_empty());
    }
    #[test]
    fn startup_failure_child() {
        let Some(data) = std::env::var_os("AIBO_DIAGNOSTIC_STARTUP_TEST") else {
            return;
        };
        let data = PathBuf::from(data);
        initialize_global(data.clone());
        let blocker = data.join("private-path-canary");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(&blocker, "token-canary").unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(runtime
            .block_on(crate::open_database(&blocker.join("db")))
            .is_err());
        assert!(global().unwrap().startup_failed());
    }
    #[test]
    fn startup_failure_subprocess_flushes_stage_without_ready_or_stopped() {
        let root = tempfile::tempdir().unwrap();
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "diagnostics::tests::startup_failure_child"])
            .env("AIBO_DIAGNOSTIC_STARTUP_TEST", root.path())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let rows = records(root.path());
        assert_eq!(rows[0]["event"], "app.starting");
        let failed = rows
            .iter()
            .find(|row| row["event"] == "startup.failed")
            .unwrap();
        assert_eq!(failed["stage"], "database.open");
        assert!(!rows
            .iter()
            .any(|row| row["event"] == "app.ready" || row["event"] == "app.stopped"));
        assert!(!serde_json::to_string(&rows).unwrap().contains("canary"));
    }
    #[test]
    fn degraded_writer_recovers_without_affecting_producers() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("logs"), "blocker").unwrap();
        let log = Diagnostics::with_limits(
            root.path().into(),
            Limits {
                retry: Duration::from_millis(30),
                ..Limits::default()
            },
        );
        let deadline = Instant::now() + Duration::from_secs(3);
        while log.status().state != "degraded" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        log.emit(
            Event::SessionFailed,
            Fields {
                operation: Some("session.send"),
                ..Fields::default()
            },
        );
        std::fs::remove_file(root.path().join("logs")).unwrap();
        while log.status().state != "healthy" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        log.emit(
            Event::SessionCompleted,
            Fields {
                operation: Some("session.send"),
                ..Fields::default()
            },
        );
        assert!(log.shutdown());
        let rows = records(root.path());
        assert!(rows
            .iter()
            .any(|row| row["event"] == "diagnostics.recovered"));
        assert!(rows
            .iter()
            .any(|row| row["event"] == "session.operation_completed"));
        assert!(log.status().dropped >= 1);
    }
    #[test]
    fn clock_rollback_rotates_without_overwrite_and_keeps_monotonic_sequence() {
        let root = tempfile::tempdir().unwrap();
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let mut sink = Sink::open(root.path(), &context.boot_id, Limits::default()).unwrap();
        let day = time::macros::datetime!(2026-10-12 01:00 UTC);
        for date in [day, day + time::Duration::days(1), day] {
            sink.write_date(
                &context.record_at(Event::Ready, Fields::default(), date),
                date.date().to_string(),
            )
            .unwrap();
        }
        let rows = records(root.path());
        assert_eq!(rows.len(), 3);
        assert!(rows[2]["timestamp"].as_str().unwrap() < rows[1]["timestamp"].as_str().unwrap());
        assert!(rows.windows(2).all(|pair| pair[1]["sequence"].as_u64()
            > pair[0]["sequence"].as_u64()
            && pair[1]["elapsed_ms"].as_u64() >= pair[0]["elapsed_ms"].as_u64()));
        assert_eq!(
            std::fs::read_dir(root.path().join("logs"))
                .unwrap()
                .filter(|entry| entry
                    .as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|ext| ext == "jsonl"))
                .count(),
            3
        );
    }
    #[test]
    fn record_budget_rejects_long_identities_and_limits_frames_before_queueing() {
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let record = context.record(
            Event::FrontendException,
            Fields {
                window_id: Some("中\n\u{1b}[31m".repeat(1024)),
                frames: (0..100)
                    .map(|_| Frame {
                        resource: format!("assets/{}.js", "a".repeat(240)),
                        line: Some(1_000_000),
                        column: Some(1_000_000),
                    })
                    .collect(),
                ..Fields::default()
            },
        );
        assert!(record.bytes.len() <= RECORD_LIMIT);
        let row: Value = serde_json::from_slice(&record.bytes).unwrap();
        assert_eq!(row["frames"].as_array().unwrap().len(), 20);
        assert_eq!(row["truncated"], true);
        assert!(row.get("window_id").is_none());
        assert_eq!(row["rejected_fields"], 1);
        assert_eq!(
            record.bytes.iter().filter(|byte| **byte == b'\n').count(),
            1
        );
    }
    #[test]
    fn retention_uses_sealed_file_time_and_preserves_unknown_files() {
        let root = tempfile::tempdir().unwrap();
        let mut sink = Sink::open(
            root.path(),
            &ulid::Ulid::new().to_string(),
            Limits::default(),
        )
        .unwrap();
        let boot = ulid::Ulid::new().to_string();
        let expired_name = format!("aibo-2026-01-01-{boot}-0001.jsonl");
        let fresh_name = format!("aibo-2026-01-01-{boot}-0002.jsonl");
        for (name, age) in [
            (&expired_name, Duration::from_secs(14 * 24 * 60 * 60)),
            (&fresh_name, Duration::from_secs(14 * 24 * 60 * 60 - 60)),
        ] {
            let mut file = sink.directory.open_file(name, true).unwrap();
            file.write_all(b"{}\n").unwrap();
            file.set_times(
                std::fs::FileTimes::new().set_modified(std::time::SystemTime::now() - age),
            )
            .unwrap();
        }
        std::fs::write(root.path().join("logs/unknown.txt"), "preserve").unwrap();
        sink.cleanup(0).unwrap();
        assert!(!root.path().join("logs").join(expired_name).exists());
        assert!(root.path().join("logs").join(fresh_name).exists());
        assert!(root.path().join("logs/unknown.txt").exists());
    }
    #[test]
    fn age_cleanup_of_starting_shard_keeps_independent_environment_on_remaining_rows() {
        let root = tempfile::tempdir().unwrap();
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let first = context.record(Event::Starting, Fields::default());
        let mut sink = Sink::open(
            root.path(),
            &context.boot_id,
            Limits {
                shard: first.bytes.len() as u64 + 20,
                retention: Duration::ZERO,
                ..Limits::default()
            },
        )
        .unwrap();
        sink.write(&first).unwrap();
        sink.write(&context.record(Event::Ready, Fields::default()))
            .unwrap();
        let rows = records(root.path());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["event"], "app.ready");
        for key in ["app_version", "build_channel", "os", "arch"] {
            assert!(rows[0].get(key).is_some(), "{key}");
        }
    }
    #[test]
    fn equal_sealed_times_reclaim_files_in_filename_order() {
        let root = tempfile::tempdir().unwrap();
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let a = context.record(Event::Ready, Fields::default());
        let b = context.record(Event::Ready, Fields::default());
        let limits = Limits {
            total: EMERGENCY_RESERVE + b.bytes.len() as u64 + 10,
            ..Limits::default()
        };
        let mut sink = Sink::open(root.path(), &ulid::Ulid::new().to_string(), limits).unwrap();
        let first = format!("aibo-2026-10-12-{}-0001.jsonl", context.boot_id);
        let second = format!("aibo-2026-10-12-{}-0002.jsonl", context.boot_id);
        let time = std::time::SystemTime::now() - Duration::from_secs(60);
        for (name, record) in [(&first, &a), (&second, &b)] {
            let mut file = sink.directory.open_file(name, true).unwrap();
            file.write_all(&record.bytes).unwrap();
            file.set_times(std::fs::FileTimes::new().set_modified(time))
                .unwrap();
        }
        sink.cleanup(0).unwrap();
        assert!(!root.path().join("logs").join(first).exists());
        assert!(root.path().join("logs").join(second).exists());
        assert_eq!(records(root.path())[0]["sequence"], 2);
    }
    #[test]
    fn blocked_writer_shutdown_is_bounded_and_does_not_claim_success() {
        let root = tempfile::tempdir().unwrap();
        let directory = Directory::open(root.path()).unwrap();
        let coordination = directory.open_file(".aibo-diagnostics.lock", true).unwrap();
        lock(&coordination, false).unwrap();
        let log = Diagnostics::start(root.path().into());
        for _ in 0..100 {
            log.emit(Event::Ready, Fields::default());
        }
        let started = Instant::now();
        assert!(!log.shutdown());
        assert!(started.elapsed() < Duration::from_millis(2300));
        assert_eq!(log.status().error_code, Some("shutdown_timeout"));
        assert!(!log.status().shutdown_complete);
        unlock(&coordination);
        let deadline = Instant::now() + Duration::from_secs(3);
        while !log.shared.finished.load(Ordering::Acquire) {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    #[cfg(unix)]
    #[test]
    fn new_log_directory_and_files_are_private_to_current_user() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let log = Diagnostics::start(root.path().into());
        assert!(log.shutdown());
        assert_eq!(
            std::fs::metadata(root.path().join("logs"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        for entry in std::fs::read_dir(root.path().join("logs")).unwrap() {
            assert_eq!(
                entry.unwrap().metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn reserved_error_queue_and_dropped_summary_are_observable_in_actual_files() {
        let root = tempfile::tempdir().unwrap();
        let directory = Directory::open(root.path()).unwrap();
        let coordination = directory.open_file(".aibo-diagnostics.lock", true).unwrap();
        lock(&coordination, false).unwrap();
        let log = Diagnostics::start(root.path().into());
        for _ in 0..NORMAL_QUEUE + 6 {
            log.emit(Event::Ready, Fields::default());
        }
        for _ in 0..ERROR_QUEUE + 3 {
            log.emit(
                Event::FrontendException,
                Fields {
                    window_id: Some("main".into()),
                    ..Fields::default()
                },
            );
        }
        assert_eq!(log.status().dropped, 10);
        unlock(&coordination);
        assert!(log.shutdown());
        let rows = records(root.path());
        assert_eq!(
            rows.iter()
                .filter(|row| row["event"] == "frontend.exception")
                .count(),
            ERROR_QUEUE
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row["event"] == "app.ready")
                .count(),
            NORMAL_QUEUE - 1
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row["event"] == "diagnostics.dropped")
                .map(|row| row["count"].as_u64().unwrap())
                .sum::<u64>(),
            10
        );
        assert!(rows
            .windows(2)
            .all(|pair| pair[0]["sequence"].as_u64() < pair[1]["sequence"].as_u64()));
    }
    #[test]
    fn untyped_tracing_cannot_enter_file_sink_even_with_matching_target() {
        let root = tempfile::tempdir().unwrap();
        let log = Diagnostics::start(root.path().into());
        tracing::dispatcher::with_default(&log.dispatcher, || {
            tracing::error!(target: "aibo::controlled_diagnostic", error = "error-chain-secret-canary", payload = ?serde_json::json!({"token":"token-secret-canary","Cookie":"cookie-secret-canary"}));
        });
        assert!(log.shutdown());
        let rows = records(root.path());
        assert_eq!(rows.len(), 2);
        assert!(!serde_json::to_string(&rows)
            .unwrap()
            .contains("secret-canary"));
    }
    #[test]
    fn emergency_reserve_is_profile_wide_and_process_slots_are_bounded() {
        let root = tempfile::tempdir().unwrap();
        let limits = Limits {
            total: EMERGENCY_RESERVE + 1000,
            ..Limits::default()
        };
        let mut a = Sink::open(root.path(), &ulid::Ulid::new().to_string(), limits).unwrap();
        let mut b = Sink::open(root.path(), &ulid::Ulid::new().to_string(), limits).unwrap();
        let mut prepared = vec![
            a.prepare_emergency().unwrap().unwrap(),
            b.prepare_emergency().unwrap().unwrap(),
        ];
        let context = Context {
            boot_id: ulid::Ulid::new().to_string(),
            started: Instant::now(),
            sequence: AtomicU64::new(1),
        };
        let record = context.record(Event::Ready, Fields::default());
        a.write(&record).unwrap();
        b.write(&record).unwrap();
        for _ in 2..EMERGENCY_SLOTS {
            let mut sink = Sink::open(root.path(), &ulid::Ulid::new().to_string(), limits).unwrap();
            prepared.push(sink.prepare_emergency().unwrap().unwrap());
        }
        let mut extra = Sink::open(root.path(), &ulid::Ulid::new().to_string(), limits).unwrap();
        assert!(extra.prepare_emergency().unwrap().is_none());
        assert_eq!(
            prepared.len() * EMERGENCY_RECORD_LIMIT,
            EMERGENCY_RESERVE as usize
        );
        drop(prepared.pop());
        assert!(extra.prepare_emergency().unwrap().is_some());
    }
    #[test]
    fn emergency_date_rotation_reuses_one_slot_and_never_overwrites() {
        let root = tempfile::tempdir().unwrap();
        let mut sink = Sink::open(root.path(), &ulid::Ulid::new().to_string(), Limits::default()).unwrap();
        let mut prepared = vec![sink.prepare_emergency_date("2026-10-12".into(), None).unwrap().unwrap()];
        for date in ["2026-10-13", "2026-10-12", "2026-10-13"] {
            let last = prepared.last().unwrap();
            let next = sink.prepare_emergency_date(date.into(), Some(last.slot.clone())).unwrap().unwrap();
            assert!(Arc::ptr_eq(&last.slot, &next.slot));
            assert!(next.shard > last.shard);
            prepared.push(next);
        }
        assert_eq!(std::fs::read_dir(root.path().join("logs")).unwrap()
            .filter_map(Result::ok).filter(|entry| owned_name(entry.file_name().to_str().unwrap())).count(), 4);
        let mut other_channels = Vec::new();
        for _ in 1..EMERGENCY_SLOTS {
            let mut other = Sink::open(root.path(), &ulid::Ulid::new().to_string(), Limits::default()).unwrap();
            other_channels.push(other.prepare_emergency().unwrap().unwrap());
        }
        let mut extra = Sink::open(root.path(), &ulid::Ulid::new().to_string(), Limits::default()).unwrap();
        assert!(extra.prepare_emergency().unwrap().is_none());
    }
    #[test]
    fn concurrent_writer_child() {
        let Some(data) = std::env::var_os("AIBO_DIAGNOSTIC_CONCURRENT_TEST") else {
            return;
        };
        let limits = Limits {
            total: EMERGENCY_RESERVE + 4096,
            shard: 2048,
            ..Limits::default()
        };
        let data = PathBuf::from(data);
        let log = Diagnostics::with_limits(data.clone(), limits);
        for _ in 0..150 {
            log.emit(
                Event::SessionCompleted,
                Fields {
                    operation: Some("session.send"),
                    outcome: Some("request_completed"),
                    ..Fields::default()
                },
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        while !log.shared.queue.lock().unwrap().records.is_empty() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        std::fs::write(data.join(format!("writer-ready-{}", std::process::id())), []).unwrap();
        while !data.join("release-writers").exists() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(log.shutdown());
    }
    #[test]
    fn concurrent_processes_coordinate_quota_and_preserve_independent_boot_files() {
        let root = tempfile::tempdir().unwrap();
        let spawn = || {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "diagnostics::tests::concurrent_writer_child"])
                .env("AIBO_DIAGNOSTIC_CONCURRENT_TEST", root.path())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap()
        };
        let a = spawn();
        let b = spawn();
        let deadline = Instant::now() + Duration::from_secs(30);
        while std::fs::read_dir(root.path()).unwrap().filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("writer-ready-")).count() < 2 {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        let active_rows = records(root.path());
        let active_boots: std::collections::BTreeSet<_> = active_rows.iter()
            .map(|row| row["boot_id"].as_str().unwrap().to_owned()).collect();
        assert_eq!(active_boots.len(), 2, "both live writers retain their active files");
        std::fs::write(root.path().join("release-writers"), []).unwrap();
        for result in [a.wait_with_output().unwrap(), b.wait_with_output().unwrap()] {
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stdout)
            );
        }
        let mut total = 0;
        for entry in std::fs::read_dir(root.path().join("logs")).unwrap() {
            let entry = entry.unwrap();
            if owned_name(entry.file_name().to_str().unwrap()) {
                let size = entry.metadata().unwrap().len();
                total += size;
                assert!(size <= 2048);
            }
        }
        assert!(total + EMERGENCY_RESERVE <= EMERGENCY_RESERVE + 4096);
        let rows = records(root.path());
        // Once a writer exits, the other may legitimately reclaim its sealed
        // app.stopped shard under the tiny quota. Run metadata proves both
        // completed; retained files were checked while both were still live.
        for boot in active_boots {
            let metadata: Value = serde_json::from_slice(&std::fs::read(
                root.path().join("logs").join(format!("aibo-{boot}.run"))
            ).unwrap()).unwrap();
            assert_eq!(metadata["state"], "stopped");
            let mut sequences = std::collections::BTreeSet::new();
            for row in rows.iter().filter(|row| row["boot_id"] == boot.as_str()) {
                assert!(sequences.insert(row["sequence"].as_u64().unwrap()));
            }
        }
    }
    #[test]
    fn partial_disk_full_write_recovers_to_parseable_files_and_reports_interval() {
        let root = tempfile::tempdir().unwrap();
        let faults = Box::leak(Box::new(Faults::default()));
        faults.write_errno.store(28, Ordering::Relaxed);
        let log = Diagnostics::with_limits(
            root.path().into(),
            Limits {
                faults: Some(faults),
                retry: Duration::from_millis(40),
                ..Limits::default()
            },
        );
        let deadline = Instant::now() + Duration::from_secs(3);
        while log.status().state != "degraded" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(log.status().error_code, Some("storage_full"));
        faults.write_errno.store(0, Ordering::Relaxed);
        while log.status().state != "healthy" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        log.emit(
            Event::SessionCompleted,
            Fields {
                operation: Some("session.send"),
                ..Fields::default()
            },
        );
        assert!(log.shutdown());
        let rows = records(root.path());
        assert!(rows
            .iter()
            .any(|row| row["event"] == "diagnostics.write_failed"
                && row["error_code"] == "storage_full"
                && row["os_error_code"] == 28));
        assert!(rows
            .iter()
            .any(|row| row["event"] == "diagnostics.recovered"
                && row.get("first_failure_at").is_some()
                && row.get("recovered_at").is_some()));
        assert!(rows
            .iter()
            .any(|row| row["event"] == "session.operation_completed"));
    }
    #[test]
    fn denied_cleanup_stops_growth_and_preserves_active_run_lease_during_recovery() {
        let root = tempfile::tempdir().unwrap();
        let faults = Box::leak(Box::new(Faults::default()));
        let log = Diagnostics::with_limits(
            root.path().into(),
            Limits {
                faults: Some(faults),
                retry: Duration::from_millis(500),
                ..Limits::default()
            },
        );
        let deadline = Instant::now() + Duration::from_secs(3);
        while log.status().state != "healthy" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        let old = format!("aibo-2020-01-01-{}-0001.jsonl", ulid::Ulid::new());
        let path = root.path().join("logs").join(&old);
        std::fs::write(&path, "{}\n").unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(
                std::time::SystemTime::now() - Duration::from_secs(15 * 24 * 60 * 60),
            ))
            .unwrap();
        faults.delete_denied.store(true, Ordering::Relaxed);
        log.emit(Event::SessionCompleted, Fields::default());
        while log.status().state != "degraded" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(log.status().error_code, Some("permission_denied"));
        assert!(path.exists());
        let mut other = Sink::open(
            root.path(),
            &ulid::Ulid::new().to_string(),
            Limits::default(),
        )
        .unwrap();
        assert!(
            other.begin_run().unwrap().is_empty(),
            "a degraded live process must remain live to other instances"
        );
        drop(other);
        faults.delete_denied.store(false, Ordering::Relaxed);
        while log.status().state != "healthy" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!path.exists());
        assert!(log.shutdown());
        assert!(records(root.path())
            .iter()
            .any(|row| row["event"] == "diagnostics.recovered"));
    }
    #[test]
    fn failed_shutdown_summary_does_not_claim_a_normal_exit() {
        let root = tempfile::tempdir().unwrap();
        let faults = Box::leak(Box::new(Faults::default()));
        let log = Diagnostics::with_limits(
            root.path().into(),
            Limits {
                faults: Some(faults),
                ..Limits::default()
            },
        );
        let deadline = Instant::now() + Duration::from_secs(3);
        while log.status().state != "healthy" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        faults.dropped_write_denied.store(true, Ordering::Relaxed);
        log.suppress_frontend();
        assert!(!log.shutdown());
        assert!(!log.status().shutdown_complete);
        assert_eq!(log.status().error_code, Some("storage_full"));
        assert_eq!(log.shared.suppressed_frontend.load(Ordering::Relaxed), 1);
        let rows = records(root.path());
        assert!(!rows.iter().any(|row| row["event"] == "app.stopped"));
        let metadata: Value = serde_json::from_slice(
            &std::fs::read(
                root.path()
                    .join("logs")
                    .join(format!("aibo-{}.run", log.shared.context.boot_id)),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(metadata["state"], "running");
    }
    #[test]
    fn failed_periodic_summary_preserves_the_original_count_without_recursion() {
        let root = tempfile::tempdir().unwrap();
        let faults = Box::leak(Box::new(Faults::default()));
        let log = Diagnostics::with_limits(root.path().into(), Limits {
            faults: Some(faults),
            retry: Duration::from_millis(100),
            ..Limits::default()
        });
        let deadline = Instant::now() + Duration::from_secs(4);
        while log.status().state != "healthy" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        faults.dropped_write_denied.store(true, Ordering::Relaxed);
        log.suppress_frontend();
        while log.status().state != "degraded" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(log.shared.suppressed_frontend.load(Ordering::Relaxed), 1);
        assert_eq!(log.status().dropped, 1);
        faults.dropped_write_denied.store(false, Ordering::Relaxed);
        while log.status().state != "healthy" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(log.shutdown());
        let summaries: Vec<_> = records(root.path()).into_iter()
            .filter(|row| row["event"] == "diagnostics.dropped").collect();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0]["error_code"], "rate_limited");
        assert_eq!(summaries[0]["count"], 1);
    }
}
