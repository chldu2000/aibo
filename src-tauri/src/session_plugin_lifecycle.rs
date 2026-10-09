use crate::ui_i18n::HostMessage;
use super::*;
use crate::plugin_lifecycle::{error, Impact, MigrationReport, Reference};

impl SessionHost {
    pub(crate) async fn migrate_release(
        &self,
        data: &Path,
        source: &str,
        target: &str,
    ) -> Result<MigrationReport, HostMessage> {
        let (plugin, version): (String, String) = sqlx::query_as(
            "SELECT plugin_id,plugin_version FROM plugin_installations WHERE id=? AND installed=1",
        )
        .bind(source)
        .fetch_one(&self.db)
        .await
        .map_err(error)?;
        let (next_plugin,next_version):(String,String)=sqlx::query_as("SELECT plugin_id,plugin_version FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
            .bind(target).fetch_one(&self.db).await.map_err(error)?;
        if plugin != next_plugin
            || semver::Version::parse(&next_version).map_err(error)?
                <= semver::Version::parse(&version).map_err(error)?
        {
            return Err(HostMessage::new("native.plugin.migrationTarget",json!({})));
        }
        let ids:Vec<(String,String)>=sqlx::query_as("SELECT id,label FROM sessions WHERE plugin_installation_id=? AND id NOT IN (SELECT session_id FROM plugin_session_retirements) ORDER BY id")
            .bind(source).fetch_all(&self.db).await.map_err(error)?;
        let mut report = MigrationReport::default();
        for (id, label) in ids {
            match self.migrate_session(data, &id, source, target).await {
                Ok(()) => report.migrated.push(id),
                Err(reason) => report.failed.push(Reference {
                    id,
                    label: format!("{label}：{reason}"),
                    localized_label: Some(crate::ui_i18n::display_descriptor("native.plugin.migrationFailed",json!({"label":label,"reason":reason.display()}))),
                }),
            }
        }
        Ok(report)
    }

    pub(super) async fn migrate_session(
        &self,
        data: &Path,
        id: &str,
        source: &str,
        target: &str,
    ) -> Result<(), HostMessage> {
        self.migrate_session_inner(data,id,source,target,false).await
    }

    pub(super) async fn migrate_session_for_replacement(&self,data:&Path,id:&str,source:&str,target:&str)->Result<(),HostMessage>{
        self.migrate_session_inner(data,id,source,target,true).await
    }
    async fn migrate_session_inner(&self,data:&Path,id:&str,source:&str,target:&str,include_history:bool)->Result<(),HostMessage>{
        let _guard = if include_history {None} else {Some(self.session_operation(id).await)};
        let session = crate::session_by_id(&self.db, id).await.map_err(error)?;
        if session.plugin_installation_id.as_deref() != Some(source) {
            return Err(HostMessage::new("native.plugin.bindingRetry",json!({})));
        }
        if self.live.lock().await.contains_key(id)
            || session.state == "running"
            || session.state == "starting"
            || (!include_history && (session.archived || session.state == "closed"))
        {
            return Err(HostMessage::new("native.plugin.migrationBusy",json!({})));
        }
        // A disabled source is not executable, but its saved enforced profile remains
        // the compatibility baseline. The candidate's authority is checked below.
        let profile = if include_history {
            if let Some(row)=sqlx::query("SELECT * FROM session_execution_profiles WHERE session_id=?").bind(id).fetch_optional(&self.db).await.map_err(error)? {
                execution_profile::from_row(&row,id.into())?.profile
            } else {crate::session_execution_profile(&self.db,id).await.map_err(error)?.profile}
        } else {crate::session_execution_profile(&self.db,id).await.map_err(error)?.profile};
        let backend =
            execution_profile::installation_backend(&self.db, target, &session.agent).await?;
        if backend != profile.enforcement_backend {
            return Err(HostMessage::new("native.plugin.backendIncompatible",json!({})));
        }
        let previous = self
            .saved_binding(id)
            .await?
            .ok_or_else(|| HostMessage::new("native.plugin.bindingMissing",json!({})))?;
        let raw:String=sqlx::query_scalar("SELECT manifest_json FROM plugin_installations WHERE id=? AND installed=1 AND enabled=1")
            .bind(target).fetch_one(&self.db).await.map_err(error)?;
        let manifest: Value = serde_json::from_str(&raw).map_err(error)?;
        sqlx::query(
            "INSERT INTO plugin_session_candidates(session_id,installation_id) VALUES(?,?)",
        )
        .bind(id)
        .bind(target)
        .execute(&self.db)
        .await
        .map_err(error)?;
        let mut copied = None;
        let result=async {
            self.broker.stop_session(id).await.map_err(|e|e.message)?;
            copied=copy_session_storage(&self.db,data,&manifest,id,&session.agent,source,target).await?;
            let mut recovery=previous["recovery"].clone();
            if let Some((from,to))=&copied { rewrite_paths(&mut recovery,from,to); }
            let old_root=crate::plugin_lifecycle::owned_path_display(data,&["plugin-data",manifest["pluginId"].as_str().ok_or("invalid manifest")?,source])?;
            if recovery.to_string().contains(old_root.to_string_lossy().as_ref()) { return Err(HostMessage::new("native.plugin.foreignRecovery",json!({}))); }
            let binding=Binding {scope:Scope::Session(id.into()),capability:"aibo.session.open".into(),version:"1.0.0".into(),installation_id:target.into(),contribution_id:session.agent.clone()};
            let response=self.broker.invoke_bound("plugin-upgrade",Request {scope:binding.scope.clone(),capability:binding.capability.clone(),version:binding.version.clone(),request_id:ulid::Ulid::new().to_string(),turn_id:None,input:json!({"mode":"resume","executionProfile":profile.enforced,"recovery":recovery})},&binding).await.map_err(|e|e.message)?;
            if response.output["nativeSessionId"]!=previous["nativeSessionId"] { return Err(HostMessage::new("native.plugin.identityChanged",json!({}))); }
            let capabilities=crate::session_contract::negotiate(&manifest,&session.agent,&response.output["capabilities"],&response.negotiated_operations);
            for required in ["session.resume","turn.send","turn.cancel","session.close"] {
                if session.capabilities.iter().any(|item|item==required) && !capabilities.iter().any(|item|item==required) {
                    return Err(HostMessage::new("native.plugin.capabilityMissing",json!({"required":required})));
                }
            }
            let mut document=previous.clone();
            document["pluginInstallationId"]=json!(target);document["pluginVersion"]=manifest["version"].clone();
            document["recovery"]=response.output["recovery"].clone();document["updatedAt"]=json!(crate::now_iso());
            if !crate::session_contract::binding_schema().is_valid(&document) { return Err(HostMessage::new("native.plugin.recoveryInvalid",json!({}))); }
            if document["recovery"].to_string().contains(old_root.to_string_lossy().as_ref()) { return Err(HostMessage::new("native.plugin.oldStorageDependency",json!({}))); }
            let mut tx=self.db.begin_with("BEGIN IMMEDIATE").await.map_err(error)?;
            let changed=sqlx::query("UPDATE sessions SET plugin_installation_id=?,updated_at=? WHERE id=? AND plugin_installation_id=? AND id NOT IN (SELECT session_id FROM plugin_session_retirements)")
                .bind(target).bind(crate::now_iso()).bind(id).bind(source).execute(&mut *tx).await.map_err(error)?;
            if changed.rows_affected()!=1 { return Err(HostMessage::new("native.plugin.bindingChanged",json!({}))); }
            sqlx::query("UPDATE session_bindings SET plugin_binding_json=?,plugin_capabilities_json=?,generation_id=?,bound_at=? WHERE session_id=?")
                .bind(document.to_string()).bind(json!(capabilities).to_string()).bind(&response.generation_id).bind(crate::now_iso()).bind(id).execute(&mut *tx).await.map_err(error)?;
            // Generic capability choices for the old provider are reselected explicitly.
            sqlx::query("DELETE FROM capability_provider_bindings WHERE scope_kind='session' AND scope_id=? AND installation_id=?")
                .bind(id).bind(source).execute(&mut *tx).await.map_err(error)?;
            sqlx::query("DELETE FROM capability_binding_candidates WHERE scope_kind='session' AND scope_id=? AND installation_id=?")
                .bind(id).bind(source).execute(&mut *tx).await.map_err(error)?;
            sqlx::query("INSERT INTO plugin_session_migrations VALUES(?,?,?,?,?,?)")
                .bind(ulid::Ulid::new().to_string()).bind(id).bind(source).bind(target).bind(previous.to_string()).bind(crate::now_iso()).execute(&mut *tx).await.map_err(error)?;
            tx.commit().await.map_err(|e|error(e).into())
        }.await;
        if result.is_err() {
            self.broker.stop_session(id).await.map_err(|e| e.message)?;
            if let Some((_, to)) = copied {
                if to.exists() {
                    std::fs::remove_dir_all(to).map_err(error)?;
                }
            }
        }
        sqlx::query("DELETE FROM plugin_session_candidates WHERE session_id=?")
            .bind(id)
            .execute(&self.db)
            .await
            .map_err(error)?;
        result
    }

    pub(crate) async fn remove_release(
        &self,
        data: &Path,
        expected: &Impact,
        keep_history: bool,
    ) -> Result<(), HostMessage> {
        let current = crate::plugin_lifecycle::impact(&self.db, &expected.id).await?;
        if current.token != expected.token {
            return Err(HostMessage::new("native.plugin.removalChanged",json!({})));
        }
        if !current.dependencies.is_empty() {
            return Err(HostMessage::new("native.plugin.removalDependency",json!({})));
        }
        if (!current.sessions.is_empty() || !current.bindings.is_empty()) && !keep_history {
            return Err(HostMessage::new("native.plugin.removalHistoryChoice",json!({})));
        }
        // Disable admission before stopping processes. A failure leaves the package on disk.
        plugin_registry::enable(&self.db, &current.id, false).await?;
        self.broker
            .stop_installation(&current.id)
            .await
            .map_err(|e| e.message)?;
        for reference in &current.sessions {
            let caller = self
                .live
                .lock()
                .await
                .get(&reference.id)
                .map(|run| run.caller.clone())
                .unwrap_or("main".into());
            self.close_from_display(&caller, &reference.id).await?;
        }
        let mut guards = Vec::new();
        for reference in &current.sessions {
            guards.push(self.session_operation(&reference.id).await);
        }
        let latest = crate::plugin_lifecycle::impact(&self.db, &current.id).await?;
        if latest.token != current.token {
            return Err(HostMessage::new("native.plugin.removalDisabled",json!({})));
        }
        let mut tx = self.db.begin_with("BEGIN IMMEDIATE").await.map_err(error)?;
        for reference in &current.sessions {
            sqlx::query(
                "INSERT INTO plugin_session_retirements VALUES(?,?) ON CONFLICT DO NOTHING",
            )
            .bind(&reference.id)
            .bind(crate::now_iso())
            .execute(&mut *tx)
            .await
            .map_err(error)?;
            sqlx::query("UPDATE session_bindings SET plugin_binding_json=json_set(plugin_binding_json,'$.recovery',json('{}')),plugin_capabilities_json='[]',generation_id=NULL WHERE session_id=?")
                .bind(&reference.id).execute(&mut *tx).await.map_err(error)?;
        }
        sqlx::query("DELETE FROM capability_provider_bindings WHERE installation_id=?")
            .bind(&current.id)
            .execute(&mut *tx)
            .await
            .map_err(error)?;
        sqlx::query("DELETE FROM capability_binding_candidates WHERE installation_id=?")
            .bind(&current.id)
            .execute(&mut *tx)
            .await
            .map_err(error)?;
        sqlx::query("DELETE FROM plugin_dependency_bindings WHERE installation_id=?")
            .bind(&current.id)
            .execute(&mut *tx)
            .await
            .map_err(error)?;
        tx.commit().await.map_err(error)?;
        plugin_registry::uninstall(&self.db, data, &current.id).await.map_err(Into::into)
    }
}

fn rewrite_paths(value: &mut Value, from: &Path, to: &Path) {
    match value {
        Value::String(text) => {
            if let Ok(suffix) = Path::new(text).strip_prefix(from) {
                *text = to.join(suffix).to_string_lossy().into_owned();
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_paths(item, from, to);
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                rewrite_paths(item, from, to);
            }
        }
        _ => (),
    }
}

pub(super) fn copy_tree(from: &Path, to: &Path, root: bool) -> Result<(), HostMessage> {
    std::fs::create_dir_all(to).map_err(error)?;
    for entry in std::fs::read_dir(from).map_err(error)? {
        let entry = entry.map_err(error)?;
        if root && entry.file_name() == "owner.json" {
            continue;
        }
        let kind = entry.file_type().map_err(error)?;
        if kind.is_symlink() {
            return Err(HostMessage::new("native.plugin.storageSymlink",json!({})));
        }
        if kind.is_dir() {
            copy_tree(&entry.path(), &to.join(entry.file_name()), false)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), to.join(entry.file_name())).map_err(error)?;
        } else {
            return Err(HostMessage::new("native.plugin.storageSpecialFile",json!({})));
        }
    }
    Ok(())
}
async fn copy_session_storage(
    db: &SqlitePool,
    data: &Path,
    manifest: &Value,
    session: &str,
    contribution: &str,
    source: &str,
    target: &str,
) -> Result<Option<(PathBuf, PathBuf)>, HostMessage> {
    let old:Option<String>=sqlx::query_scalar("SELECT id FROM capability_instances WHERE installation_id=? AND contribution_id=? AND scope_kind='session' AND scope_id=?")
        .bind(source).bind(contribution).bind(session).fetch_optional(db).await.map_err(error)?;
    let Some(old) = old else {
        return Ok(None);
    };
    let plugin = manifest["pluginId"].as_str().ok_or("invalid manifest")?;
    let from =
        crate::plugin_lifecycle::owned_path_display(data, &["plugin-data", plugin, source, "v1", &old])?;
    if !from.exists() {
        return Ok(None);
    }
    sqlx::query("INSERT INTO capability_instances(id,installation_id,contribution_id,scope_kind,scope_id,created_at) VALUES(?,?,?,'session',?,?) ON CONFLICT(installation_id,contribution_id,scope_kind,scope_id) DO NOTHING")
        .bind(ulid::Ulid::new().to_string()).bind(target).bind(contribution).bind(session).bind(crate::now_iso()).execute(db).await.map_err(error)?;
    let new:String=sqlx::query_scalar("SELECT id FROM capability_instances WHERE installation_id=? AND contribution_id=? AND scope_kind='session' AND scope_id=?")
        .bind(target).bind(contribution).bind(session).fetch_one(db).await.map_err(error)?;
    let to =
        crate::plugin_lifecycle::owned_path_display(data, &["plugin-data", plugin, target, "v1", &new])?;
    if to.exists() {
        return Err(HostMessage::new("native.plugin.targetStorageExists",json!({})));
    }
    let to =
        crate::plugin_storage::directory_display(&data.join("plugins").join(target), plugin, target, &new)?;
    if let Err(reason) = copy_tree(&from, &to, true) {
        let _ = std::fs::remove_dir_all(&to);
        return Err(reason);
    }
    Ok(Some((from, to)))
}
