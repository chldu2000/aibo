//! Display-only language for host dialogs. It never participates in write identity or approval.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Mutex, OnceLock}};
use tauri::Manager;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) enum Locale {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[default]
    #[serde(rename = "en")]
    En,
}

#[derive(Default)]
pub(crate) struct WindowLanguages(Mutex<HashMap<String, Locale>>);
impl WindowLanguages {
    fn set(&self, window: &str, locale: Locale) {
        self.0.lock().unwrap_or_else(|error| error.into_inner()).insert(window.into(), locale);
    }
    fn get(&self, window: &str) -> Locale {
        self.0.lock().unwrap_or_else(|error| error.into_inner()).get(window).copied().unwrap_or_default()
    }
    pub(crate) fn remove(&self, window: &str) {
        self.0.lock().unwrap_or_else(|error| error.into_inner()).remove(window);
    }
}

#[tauri::command]
pub(crate) fn set_window_locale(window: tauri::WebviewWindow, state: tauri::State<'_, WindowLanguages>, locale: Locale) -> Locale {
    // Tauri supplies the caller. UI input cannot change another window's language.
    state.set(window.label(), locale);
    locale
}

pub(crate) fn window_locale(window: &tauri::WebviewWindow) -> Locale {
    window.state::<WindowLanguages>().get(window.label())
}

fn catalog(locale: Locale) -> &'static Value {
    static CATALOGS: OnceLock<[Value; 2]> = OnceLock::new();
    let catalogs = CATALOGS.get_or_init(|| [
        serde_json::from_str(include_str!("../../packages/i18n/locales/zh-CN.json")).expect("valid Chinese catalog"),
        serde_json::from_str(include_str!("../../packages/i18n/locales/en.json")).expect("valid English catalog"),
    ]);
    &catalogs[if locale == Locale::ZhCn { 0 } else { 1 }]
}

pub(crate) fn descriptor(key: &str, params: Value) -> Value { json!({"key":key,"params":params}) }

pub(crate) fn display_descriptor(key: &str, params: Value) -> Value {
    let mut value = descriptor(key, params);
    value["schema"] = json!("aibo.host-message/v1");
    value
}

/// Host-owned display text travels with its legacy diagnostic, independently of locale.
#[derive(Debug)]
pub(crate) struct HostMessage {
    pub(crate) diagnostic: String,
    pub(crate) localized: Option<Value>,
}
impl HostMessage {
    pub(crate) fn with_diagnostic(key: &str, params: Value, diagnostic: impl Into<String>) -> Self {
        Self {diagnostic:diagnostic.into(),localized:Some(display_descriptor(key,params))}
    }
    pub(crate) fn display(&self) -> Value { self.localized.clone().unwrap_or_else(||json!(self.diagnostic)) }
    pub(crate) fn new(key: &str, params: Value) -> Self {
        let localized = display_descriptor(key, params);
        Self { diagnostic: render(Locale::ZhCn, &localized), localized: Some(localized) }
    }
}
impl From<String> for HostMessage {
    fn from(diagnostic: String) -> Self { Self { diagnostic, localized: None } }
}
impl From<&str> for HostMessage {
    fn from(diagnostic: &str) -> Self { diagnostic.to_owned().into() }
}

pub(crate) fn read_error(key: &str, params: Value) -> crate::CoreError {
    let display = HostMessage::new(key, params);
    crate::CoreError::ReadDiagnostic {
        message: crate::CoreError::SessionOperation(display.diagnostic).to_string(),
        localized: display.localized.expect("host read errors carry display metadata"),
    }
}

/// Compose known host reasons; raw operating-system and provider diagnostics stay literal.
pub(crate) fn error_display(error: &crate::CoreError) -> Value {
    let payload = serde_json::to_value(error).expect("native errors serialize to a display payload");
    payload.get("localized").cloned().unwrap_or_else(|| json!(error.to_string()))
}

/// A surrounding unknown-outcome message already supplies this host prefix.
/// Keep nested reasons shallow enough for the display protocol's depth limit.
pub(crate) fn error_reason_display(error: &crate::CoreError) -> Value {
    let display = error_display(error);
    if display["key"] == "native.error.writeOutcomeUnknown" {
        if let Some(reason) = display.get("params").and_then(|params|params.get("error")) { return reason.clone(); }
    }
    display
}

/// Keep the persisted diagnostic intact while composing a localized display reason.
pub(crate) fn named_read_warning(name: &str, error: &crate::CoreError) -> HostMessage {
    let mut warning = HostMessage::new("native.search.namedWarning", json!({"name": name, "warning": error_display(error)}));
    warning.diagnostic = format!("{name}：{error}");
    warning
}

/// Only host-created descriptors reach this formatter. Raw provider strings remain unchanged.
pub(crate) fn render(locale: Locale, value: &Value) -> String {
    if let Some(text) = value.as_str() { return text.to_owned(); }
    if value.get("kind").and_then(Value::as_str) == Some("list") {
        return value["items"].as_array().expect("host list must contain items").iter()
            .map(|item| render(locale, item)).collect::<Vec<_>>().join(if locale == Locale::ZhCn { "、" } else { ", " });
    }
    if let Some(key) = value.get("key").and_then(Value::as_str) {
        return message(locale, key, &value["params"]);
    }
    value.to_string()
}

pub(crate) fn message(locale: Locale, key: &str, params: &Value) -> String {
    let template = catalog(locale)[key].as_str().expect("native message must be a string catalog entry");
    // Substitute the template once; paths and commands containing braces are literal data.
    let mut remaining = template;
    let mut output = String::new();
    while let Some(start) = remaining.find('{') {
        output.push_str(&remaining[..start]);
        let tail = &remaining[start + 1..];
        let Some(end) = tail.find('}') else { output.push_str(&remaining[start..]); return output; };
        let name = &tail[..end];
        let value = params.get(name).expect("native message parameter must exist");
        output.push_str(&render(locale, value));
        remaining = &tail[end + 1..];
    }
    output.push_str(remaining);
    output
}

/// Optional display metadata keeps legacy error codes and diagnostic messages intact.
pub(crate) fn error_localization(code: &str) -> Option<Value> {
    let key = match code {
        "workspace_trust_required" => "native.error.workspaceTrust",
        "workspace_write_busy" => "native.error.workspaceWriteBusy",
        "session_busy" => "native.error.sessionBusy",
        _ => return None,
    };
    let mut value = descriptor(key, json!({}));
    value["schema"] = json!("aibo.host-message/v1");
    Some(value)
}

/// The typed producer owns the surrounding text; inner diagnostics remain literal.
pub(crate) fn core_error_localization(error: &crate::CoreError, code: &str) -> Option<Value> {
    use crate::CoreError;
    let (key,params)=match error {
        CoreError::WorkspaceNotFound(id)=>("native.error.workspaceNotFound",json!({"id":id})),
        CoreError::SessionNotFound(id)=>("native.error.sessionNotFound",json!({"id":id})),
        CoreError::InvalidWorkspacePath(error)=>("native.error.invalidWorkspacePath",json!({"error":error})),
        CoreError::InvalidSessionLabel(error)=>("native.error.invalidSessionLabel",json!({"error":error})),
        CoreError::InvalidSessionFilter(filter)=>("native.error.invalidSessionFilter",json!({"filter":filter})),
        CoreError::InvalidExecutionProfile(error)=>("native.error.invalidExecutionProfile",json!({"error":error})),
        CoreError::AgentProbe(error)=>("native.error.agentProbe",json!({"error":error})),
        CoreError::Initialization(error)=>("native.error.initialization",json!({"error":error})),
        CoreError::WriteOutcomeUnknown(error)=>("native.error.writeOutcomeUnknown",json!({"error":error})),
        _=>return error_localization(code),
    };
    Some(display_descriptor(key,params))
}

pub(crate) fn core_message(error: crate::CoreError) -> HostMessage {
    let localized=serde_json::to_value(&error).expect("core errors serialize").get("localized").cloned();
    HostMessage {diagnostic:error.to_string(),localized}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn languages_are_strict_and_scoped_to_the_calling_window() {
        let languages = WindowLanguages::default();
        assert_eq!(languages.get("main"), Locale::En);
        languages.set("main", Locale::ZhCn); languages.set("other", Locale::En);
        assert_eq!(languages.get("main"), Locale::ZhCn); assert_eq!(languages.get("other"), Locale::En);
        languages.remove("main"); assert_eq!(languages.get("main"), Locale::En);
        assert!(serde_json::from_str::<Locale>("\"zh-TW\"").is_err());
        assert!(serde_json::from_str::<Locale>("\"system\"").is_err());
    }
    #[test]
    fn canonical_native_messages_preserve_raw_data_and_nested_descriptors() {
        let params = json!({"operation":"test.write","workspace":"/用户/{caller}","caller":"main","input":"{workspace}"});
        let en = message(Locale::En, "native.writeSummary", &params);
        let zh = message(Locale::ZhCn, "native.writeSummary", &params);
        assert!(en.starts_with("Host write: test.write")); assert!(zh.starts_with("宿主写入：test.write"));
        for text in [en, zh] { assert!(text.contains("/用户/{caller}")); assert!(text.contains("{workspace}")); }
        let description = descriptor("native.semanticDescription", json!({"base":descriptor("native.gitDescription",json!({})),"semantic":"原始动作","input":"原始输入"}));
        assert!(render(Locale::En, &description).contains("Git operations may run"));
        assert!(render(Locale::ZhCn, &description).contains("Git 操作可能"));
        assert!(render(Locale::En, &description).contains("原始动作"));
        assert_eq!(render(Locale::En, &json!("插件原文")), "插件原文");
    }
}

#[cfg(test)]
mod error_tests {
    use super::*;
    #[test]
    fn typed_core_errors_translate_the_host_prefix_and_preserve_raw_parameters() {
        use crate::CoreError;
        let raw="用户原文 /{error}/{id} provider: permission_denied";
        for (error,code,key,parameter,english,chinese) in [
            (CoreError::WorkspaceNotFound(raw.into()),"workspace_not_found","workspaceNotFound","id","Workspace not found: ","工作区不存在："),
            (CoreError::SessionNotFound(raw.into()),"session_not_found","sessionNotFound","id","Session not found: ","会话不存在："),
            (CoreError::InvalidWorkspacePath(raw.into()),"invalid_workspace_path","invalidWorkspacePath","error","Invalid workspace path: ","工作区路径无效："),
            (CoreError::InvalidSessionLabel(raw.into()),"invalid_session_label","invalidSessionLabel","error","Invalid session label: ","会话名称无效："),
            (CoreError::InvalidSessionFilter(raw.into()),"invalid_session_filter","invalidSessionFilter","filter","Invalid session filter: ","会话筛选条件无效："),
            (CoreError::InvalidExecutionProfile(raw.into()),"invalid_execution_profile","invalidExecutionProfile","error","Invalid execution profile: ","执行配置无效："),
            (CoreError::AgentProbe(raw.into()),"agent_probe_error","agentProbe","error","Agent probe failed: ","Agent 检测失败："),
            (CoreError::Initialization(raw.into()),"initialization_error","initialization","error","App initialization failed: ","应用初始化失败："),
        ] {
            let payload=serde_json::to_value(&error).unwrap();
            assert_eq!(payload["code"],code);assert_eq!(payload["message"],error.to_string());
            assert_eq!(payload["localized"]["key"],format!("native.error.{key}"));
            assert_eq!(payload["localized"]["params"][parameter],raw);
            assert_eq!(render(Locale::En,&payload["localized"]),format!("{english}{raw}"));
            assert_eq!(render(Locale::ZhCn,&payload["localized"]),format!("{chinese}{raw}"));
            let host=core_message(error);assert_eq!(host.diagnostic,payload["message"]);assert_eq!(host.display(),payload["localized"]);
            let legacy=CoreError::WriteReplay {code:code.into(),message:raw.into()};
            assert!(serde_json::to_value(legacy).unwrap().get("localized").is_none(),"a matching legacy code does not establish typed ownership");
            let replay=CoreError::Localized {error:Box::new(CoreError::WriteReplay {code:code.into(),message:payload["message"].as_str().unwrap().into()}),localized:payload["localized"].clone()};
            assert_eq!(serde_json::to_value(replay).unwrap(),payload);
        }
    }
    #[test]
    fn error_payloads_preserve_codes_diagnostics_and_replay_in_both_languages() {
        for error in [crate::CoreError::WorkspaceTrustRequired,crate::CoreError::WorkspaceWriteBusy,crate::CoreError::SessionBusy] {
            let value = serde_json::to_value(&error).unwrap();
            assert_eq!(value["message"], error.to_string());
            assert_eq!(value["localized"]["schema"], "aibo.host-message/v1");
            assert_ne!(render(Locale::En,&value["localized"]),render(Locale::ZhCn,&value["localized"]));
            let replay = crate::CoreError::WriteReplay {code:value["code"].as_str().unwrap().into(),message:error.to_string()};
            assert_eq!(serde_json::to_value(replay).unwrap(),value);
        }
        let provider = serde_json::to_value(crate::CoreError::WriteReplay {code:"provider_custom".into(),message:"插件原始错误".into()}).unwrap();
        assert!(provider.get("localized").is_none());assert_eq!(provider["message"],"插件原始错误");
    }
}

impl std::fmt::Display for HostMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.diagnostic) }
}
impl Serialize for HostMessage {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match &self.localized {
            Some(localized) => json!({"message":self.diagnostic,"localized":localized}).serialize(serializer),
            None => self.diagnostic.serialize(serializer),
        }
    }
}

#[cfg(test)]
mod host_message_serialization_tests {
    use super::*;
    #[test]
    fn raw_errors_remain_strings_and_explicit_host_errors_carry_display_metadata() {
        for raw in ["插件原始错误", "no_active_turn: provider diagnostic", "请先核对并移除投递结果未知的消息。"] {
            assert_eq!(serde_json::to_value(HostMessage::from(raw)).unwrap(), json!(raw));
        }
        let value = serde_json::to_value(HostMessage::new("native.queue.resumeUncertain", json!({}))).unwrap();
        assert_eq!(value["message"], "请先核对并移除投递结果未知的消息。");
        assert_eq!(value["localized"]["key"], "native.queue.resumeUncertain");
    }
}

/// Keep the original diagnostic variant, code and text under explicit display metadata.
pub(crate) fn database_message(display: HostMessage) -> crate::CoreError {
    let error = crate::CoreError::Database(display.diagnostic);
    match display.localized {
        Some(localized) => crate::CoreError::Localized {error:Box::new(error),localized},
        None => error,
    }
}
pub(crate) fn database_error(key: &str, params: Value) -> crate::CoreError { database_message(HostMessage::new(key,params)) }
pub(crate) fn initialization_message(display: HostMessage) -> crate::CoreError {
    let error = crate::CoreError::Initialization(display.diagnostic);
    match display.localized {
        Some(localized) => crate::CoreError::Localized {error:Box::new(error),localized},
        None => error,
    }
}
/// A fixed diagnostic owned by this host producer; provider and OS text stay literal.
pub(crate) fn session_operation_error(key: &str, diagnostic: &str) -> crate::CoreError {
    session_operation_message(HostMessage::with_diagnostic(key,json!({}),diagnostic))
}
pub(crate) fn session_operation_message(display: HostMessage) -> crate::CoreError {
    let error = crate::CoreError::SessionOperation(display.diagnostic);
    match display.localized {
        Some(localized) => crate::CoreError::Localized {error:Box::new(error),localized},
        None => error,
    }
}
/// Keep the execution-profile error code and diagnostic prefix while retaining its reason.
pub(crate) fn invalid_execution_profile_message(display: HostMessage) -> crate::CoreError {
    let error=crate::CoreError::InvalidExecutionProfile(display.diagnostic);
    match display.localized {
        Some(reason)=>crate::CoreError::Localized {error:Box::new(error),localized:display_descriptor(
            "native.error.invalidExecutionProfile",json!({"error":reason}))},
        None=>error,
    }
}
pub(crate) fn invalid_path_error(key: &str, params: Value) -> crate::CoreError {
    invalid_path_message(HostMessage::new(key,params))
}
pub(crate) fn invalid_path_message(display: HostMessage) -> crate::CoreError {
    let error = crate::CoreError::InvalidWorkspacePath(display.diagnostic);
    match display.localized {
        Some(localized) => crate::CoreError::Localized {error:Box::new(error),localized},
        None => error,
    }
}

pub(crate) fn unknown_message(display: HostMessage) -> crate::CoreError {
    let localized = display_descriptor("native.error.writeOutcomeUnknown",json!({"error":display.display()}));
    crate::CoreError::Localized {error:Box::new(crate::CoreError::WriteOutcomeUnknown(display.diagnostic)),localized}
}
