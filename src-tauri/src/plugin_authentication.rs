//! Explicit host management actions; credentials stay with the declared external CLI.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::ui_i18n::HostMessage;
use sqlx::{Row, SqlitePool};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::process::Command;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Action { Login, Status }
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Status { LoginOpened, Authenticated, Unauthenticated }

pub(crate) fn validate_declaration(manifest: &Value) -> Result<(), crate::ui_i18n::HostMessage> {
    let Some(auth) = manifest.get("authentication") else { return Ok(()); };
    let name = auth["executable"].as_str().ok_or_else(||crate::ui_i18n::HostMessage::with_diagnostic("native.manifest.authenticationExecutable", serde_json::json!({}), "invalid_manifest: authentication executable missing"))?;
    if !manifest["executableDependencies"].as_array().is_some_and(|items| items.iter().any(|item|
        item["kind"] == "executable" && item["name"] == name && item["required"] == true)) {
        return Err(crate::ui_i18n::HostMessage::with_diagnostic("native.manifest.authenticationDependency", serde_json::json!({}), "invalid_manifest: authentication must reference a required executable dependency"));
    }
    Ok(())
}

fn authentication_error(key: &str) -> HostMessage { HostMessage::new(key, json!({})) }

fn quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\\''")) }

// Use the same identity and search path as the plugin worker, never shell startup files
// or an inherited API key that might select a different account.
fn environment() -> Vec<(String, String)> {
    let mut values: Vec<_> = crate::plugin_runtime::PLUGIN_ENVIRONMENT.iter()
        .filter_map(|key| std::env::var(key).ok().map(|value| (key.to_string(), value))).collect();
    values.push(("PATH".into(), crate::executable_search_path().to_string_lossy().into_owned()));
    values
}

fn login_command(executable: &str, args: &[String], env: &[(String, String)]) -> String {
    let values = env.iter().map(|(key, value)| format!("{key}={value}"));
    std::iter::once("/usr/bin/env".to_owned()).chain(std::iter::once("-i".into()))
        .chain(values).chain(std::iter::once(executable.into())).chain(args.iter().cloned())
        .map(|value| quote(&value)).collect::<Vec<_>>().join(" ")
}

async fn open_login(executable: &str, args: &[String], env: &[(String, String)]) -> Result<Status, HostMessage> {
    #[cfg(not(target_os = "macos"))]
    { let _ = (executable, args, env); Err(authentication_error("native.authentication.platformUnsupported")) }
    #[cfg(target_os = "macos")]
    {
        use std::{fs::OpenOptions, io::Write, os::unix::fs::OpenOptionsExt};
        let path = std::env::temp_dir().join(format!("aibo-login-{}.command", ulid::Ulid::new()));
        let mut file = OpenOptions::new().write(true).create_new(true).mode(0o700).open(&path)
            .map_err(|_| authentication_error("native.authentication.prepareFailed"))?;
        let home = env.iter().find(|(key, _)| key == "HOME").map(|(_, value)| value.as_str()).unwrap_or("/");
        let script = format!("#!/bin/sh\n/bin/rm -f -- {}\ncd {} || exit 1\n{}\n", quote(&path.to_string_lossy()), quote(home), login_command(executable, args, env));
        if file.write_all(script.as_bytes()).is_err() { let _ = std::fs::remove_file(&path); return Err(authentication_error("native.authentication.prepareFailed")); }
        drop(file);
        let mut command = Command::new("/usr/bin/open");
        command.args(["-a", "Terminal"]).arg(&path).stdin(Stdio::null());
        let result = crate::controlled_process::execute(command, Duration::from_secs(15), 0).await;
        if !result.is_ok_and(|output| output.success) {
            let _ = std::fs::remove_file(&path);
            return Err(authentication_error("native.authentication.openFailed"));
        }
        Ok(Status::LoginOpened)
    }
}

async fn check_status(executable: &str, args: &[String], env: &[(String, String)]) -> Result<Status, HostMessage> {
    let mut command = Command::new(executable);
    command.args(args).env_clear().envs(env.iter().cloned()).stdin(Stdio::null());
    if let Some((_, home)) = env.iter().find(|(key, _)| key == "HOME") { command.current_dir(home); }
    // Do not retain or publish stdout/stderr: some CLIs include account or credential data.
    let output = crate::controlled_process::execute(command, Duration::from_secs(15), 0).await
        .map_err(|_| authentication_error("native.authentication.statusLaunchFailed"))?;
    if output.timed_out { return Err(authentication_error("native.authentication.statusTimeout")); }
    match output.exit_code {
        Some(0) => Ok(Status::Authenticated),
        Some(1) => Ok(Status::Unauthenticated),
        _ => Err(authentication_error("native.authentication.statusFailed")),
    }
}

pub(crate) async fn execute(db: &SqlitePool, data: &Path, id: &str, action: Action) -> Result<Status, HostMessage> {
    let row = sqlx::query("SELECT manifest_json,plugin_id FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
        .bind(id).fetch_optional(db).await.map_err(|error| error.to_string())?
        .ok_or_else(|| authentication_error("native.authentication.pluginUnavailable"))?;
    let manifest: Value = serde_json::from_str(row.get("manifest_json")).map_err(|_| authentication_error("native.authentication.manifestInvalid"))?;
    crate::plugin_manifest::normalize_display(&manifest)?;
    let auth = manifest.get("authentication").ok_or_else(|| authentication_error("native.authentication.notDeclared"))?;
    if !crate::plugin_manifest::activation_diagnostics(&manifest)?.is_empty() { return Err(authentication_error("native.authentication.incompatible")); }
    let diagnostics = crate::plugin_registry::dependency_diagnostics(&manifest).await;
    let dependency = diagnostics.iter().find(|item| Some(item.name.as_str()) == auth["executable"].as_str() && item.available)
        .ok_or_else(|| authentication_error("native.authentication.dependencyUnavailable"))?;
    let executable = dependency.executable.as_deref().ok_or_else(|| authentication_error("native.authentication.executableMissing"))?;
    let key = match action { Action::Login => "loginArgs", Action::Status => "statusArgs" };
    let args: Vec<String> = auth[key].as_array().ok_or_else(|| authentication_error("native.authentication.commandInvalid"))?.iter()
        .map(|arg| arg.as_str().unwrap().to_owned()).collect();
    // Any external command may update its private state, even a status check.
    crate::plugin_replacement::expire(db, row.get("plugin_id"), data).await?;
    let env = environment();
    match action { Action::Login => open_login(executable, &args, &env).await, Action::Status => check_status(executable, &args, &env).await }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn invalid_installed_authentication_manifests_preserve_display_metadata_before_execution() {
        let db = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE plugin_installations(id TEXT, manifest_json TEXT, plugin_id TEXT, installed INTEGER, enabled INTEGER)").execute(&db).await.unwrap();
        let base: Value = serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/provider.json")).unwrap();
        let mut invalid = base.clone(); invalid["version"] = json!("bad-version");
        let mut undeclared = base.clone(); undeclared["authentication"] = json!({"kind":"cli-terminal","executable":"other-cli","loginArgs":["login"],"statusArgs":["status"]});
        let mut incompatible = undeclared.clone();
        incompatible["executableDependencies"] = json!([{"kind":"executable","name":"other-cli","required":true}]);
        incompatible["host"] = json!({"min":"99.0.0","maxExclusive":"100.0.0"});
        for (id, manifest, key, diagnostic, english) in [
            ("invalid", invalid, "native.manifest.schemaValidation", "invalid_manifest: schema validation failed", "The manifest does not match its schema."),
            ("undeclared", undeclared, "native.manifest.authenticationDependency", "invalid_manifest: authentication must reference a required executable dependency", "Authentication must reference a required executable dependency."),
            ("incompatible", incompatible, "native.authentication.incompatible", "插件与当前宿主不兼容", "The plugin is incompatible with this host."),
        ] {
            sqlx::query("INSERT INTO plugin_installations VALUES(?,?,?,1,1)").bind(id).bind(manifest.to_string()).bind("third.party").execute(&db).await.unwrap();
            for action in [Action::Login,Action::Status] {
                let error = execute(&db,Path::new("/unused"),id,action).await.unwrap_err();
                assert_eq!(error.display()["key"],key);
                assert_eq!(error.diagnostic,diagnostic);
                assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),english);
                let serialized = serde_json::to_value(&error).unwrap();
                assert_eq!(serialized["message"],diagnostic);
                assert_eq!(serialized["localized"],error.display());
            }
        }
        db.close().await;
    }
    #[test]
    fn authentication_requires_a_declared_external_dependency() {
        let mut manifest: Value = serde_json::from_str(include_str!("../../fixtures/plugins/platform-v2/provider.json")).unwrap();
        manifest["authentication"] = serde_json::json!({"kind":"cli-terminal","executable":"other-cli","loginArgs":["login"],"statusArgs":["status"]});
        assert!(crate::plugin_manifest::normalize(&manifest).is_err());
        manifest["executableDependencies"] = serde_json::json!([{"kind":"executable","name":"other-cli","required":true}]);
        crate::plugin_manifest::normalize(&manifest).unwrap();
        for invalid in [serde_json::json!([]), serde_json::json!(["bad\nargument"]), serde_json::json!(["nul\u{0}"])] {
            let mut changed=manifest.clone(); changed["authentication"]["loginArgs"]=invalid;
            assert!(crate::plugin_manifest::normalize(&changed).is_err());
        }
        manifest["authentication"]["executable"] = serde_json::json!("/bin/sh");
        assert!(crate::plugin_manifest::normalize(&manifest).is_err());
    }
    #[tokio::test]
    async fn missing_disabled_and_undeclared_installations_cannot_execute() {
        let db = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE plugin_installations(id TEXT, manifest_json TEXT, plugin_id TEXT, installed INTEGER, enabled INTEGER)").execute(&db).await.unwrap();
        let manifest = include_str!("../../fixtures/plugins/platform-v2/provider.json");
        for (id, installed, enabled) in [("removed",0,1),("disabled",1,0),("unsupported",1,1)] {
            sqlx::query("INSERT INTO plugin_installations VALUES(?,?,?,?,?)").bind(id).bind(manifest).bind("third.party").bind(installed).bind(enabled).execute(&db).await.unwrap();
        }
        for id in ["missing", "removed", "disabled", "unsupported"] {
            for action in [Action::Login, Action::Status] {
                let error=execute(&db, Path::new("/unused"), id, action).await.unwrap_err();
                let (key, diagnostic, english)=if id=="unsupported" {
                    ("native.authentication.notDeclared","此插件未提供登录／授权入口","This plugin does not provide a login or authorization entry.")
                } else {
                    ("native.authentication.pluginUnavailable","请先安装并启用插件，再登录或检查认证","Install and enable the plugin before logging in or checking authentication.")
                };
                assert_eq!(error.diagnostic,diagnostic);
                assert_eq!(error.display()["key"],key);
                assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),english);
            }
        }
        db.close().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn login_arguments_are_literal_and_status_does_not_return_secrets() {
        let error=check_status("/nonexistent/aibo-auth-cli", &[], &[]).await.unwrap_err();
        assert_eq!(error.diagnostic,"无法执行登录状态检查");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"Could not run the login status check.");
        let argument = "a'b $(touch /tmp/aibo-auth-injection) `id`; * \"";
        let command = login_command("/usr/bin/printf", &["%s".into(), argument.into()], &[]);
        let output = Command::new("/bin/sh").args(["-c", &command]).output().await.unwrap();
        assert_eq!(String::from_utf8(output.stdout).unwrap(), argument);
        for (code, expected) in [(0, Some(Status::Authenticated)), (1, Some(Status::Unauthenticated)), (2, None)] {
            let result = check_status("/bin/sh", &["-c".into(), format!("printf secret; printf secret >&2; exit {code}")], &[]).await;
            if let Some(expected) = expected { assert_eq!(result.unwrap(), expected); }
            else { let error=result.unwrap_err();
                assert_eq!(error.diagnostic,"登录状态检查失败，请在官方 CLI 中检查认证配置");
                assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,&error.display()),"The login status check failed. Check authentication settings in the official CLI.");
                assert!(!serde_json::to_string(&error).unwrap().contains("secret")); }
        }
    }
}
