use crate::ui_i18n::HostMessage;
use super::*;
use crate::{plugin_lifecycle::error, plugin_replacement as replacement};

impl SessionHost {
    pub(crate) async fn replace_plugin(
        &self,
        data: &Path,
        path: &Path,
        token: Option<&str>,
        reinstall: bool,
        skip_archived: bool,
    ) -> Result<plugin_registry::PluginInstallation, HostMessage> {
        let canonical = path.canonicalize().map_err(error)?;
        let path = canonical.as_path();
        let preview = replacement::preview(&self.db, path).await?;
        if preview.kind == "installed" {
            return plugin_registry::list(&self.db)
                .await?
                .into_iter()
                .find(|p| p.plugin_id == preview.plugin_id && p.installed)
                .ok_or(HostMessage::new("native.plugin.missing",json!({})));
        }
        if (token.is_some() || !preview.previous.is_empty()) && token != Some(preview.token.as_str()) {
            return Err(HostMessage::new("native.plugin.replacementReview",json!({})));
        }
        if !preview.blockers.is_empty() {
            return Err(HostMessage::with_diagnostic("native.plugin.blocked",json!({"reasons":{"kind":"list","items":preview.localized_blockers}}),preview.blockers.join("；")));
        }
        if preview.kind == "downgrade" && !reinstall {
            return Err(HostMessage::new("native.plugin.downgradeChoice",json!({})));
        }
        if reinstall && preview.kind != "downgrade" {
            return Err(HostMessage::new("native.plugin.reinstallOnlyDowngrade",json!({})));
        }
        replacement::expire(&self.db, &preview.plugin_id, data).await?;
        if preview.previous.is_empty() {
            return plugin_registry::install_reserved(&self.db, data, path, None, Some(&preview.digest)).await.map_err(Into::into);
        }
        let initial = replacement::snapshot(&self.db, &preview.plugin_id).await?;
        let mut guards = Vec::new();
        for session in &initial.sessions {
            guards.push(self.session_operation(&session.id).await);
        }
        if replacement::preview(&self.db, path).await?.token != preview.token {
            return Err(HostMessage::new("native.plugin.replacementChanged",json!({})));
        }
        let saved = replacement::snapshot(&self.db, &preview.plugin_id).await?;
        let skipped: Vec<String> = saved.sessions.iter().filter(|s| skip_archived && s.archived).map(|s| s.id.clone()).collect();
        let skips_binding = |binding: &Value| binding["scope_kind"] == "session" && binding["scope_id"].as_str().is_some_and(|id| skipped.iter().any(|s| s == id));
        for session in &saved.sessions {
            let state = crate::session_by_id(&self.db, &session.id)
                .await
                .map_err(error)?;
            if self.live.lock().await.contains_key(&session.id)
                || matches!(
                    state.state.as_str(),
                    "running" | "waiting_approval" | "waiting_user" | "compacting"
                )
                || (state.state == "starting" && session.binding.is_some())
            {
                return Err(HostMessage::new("native.plugin.sessionBusy",json!({"label":state.label})));
            }
        }
        let (_, _, digest) = plugin_registry::inspect(path)?;
        let target:Option<String>=sqlx::query_scalar("SELECT id FROM plugin_installations WHERE plugin_id=? AND plugin_version=? AND package_digest=? AND installed=0")
            .bind(&preview.plugin_id).bind(&preview.version).bind(digest).fetch_optional(&self.db).await.map_err(error)?;
        let target = target.unwrap_or_else(|| ulid::Ulid::new().to_string());
        sqlx::query("INSERT INTO plugin_replacements VALUES(?,?,?,'preparing',?)")
            .bind(&preview.plugin_id)
            .bind(&target)
            .bind(serde_json::to_string(&saved).map_err(error)?)
            .bind(crate::now_iso())
            .execute(&self.db)
            .await
            .map_err(error)?;
        let result=async {
            for old in &saved.releases {
                let active:i64=sqlx::query_scalar("SELECT count(*) FROM capability_invocations WHERE installation_id=? AND status='running'").bind(&old.id).fetch_one(&self.db).await.map_err(error)?;
                if active>0 {return Err(HostMessage::new("native.plugin.newTask",json!({})));}
                self.broker.stop_installation(&old.id).await.map_err(|e|e.message)?;
            }
            let candidate=plugin_registry::install_reserved(&self.db,data,path,Some(&target),Some(&preview.digest)).await?;
            // Inspect/copy revalidates the digest; additionally bind it to the confirmed package.
            if candidate.package_digest!=preview.digest {return Err(HostMessage::new("native.plugin.packageChanged",json!({})));}
            let activate=saved.releases.iter().any(|p|p.enabled) || !saved.sessions.is_empty() || !saved.bindings.is_empty();
            if activate && !reinstall {plugin_registry::enable(&self.db,&target,true).await?;}
            if !reinstall {
                for old in &saved.releases {copy_other_storage(&self.db,data,&preview.plugin_id,&old.id,&target,&skipped).await?;}
                for session in &saved.sessions {
                    if skipped.contains(&session.id) { continue; }
                    if session.binding.is_some() && session.rebuild.is_none() {
                        let label=crate::session_by_id(&self.db,&session.id).await.map_err(error)?.label;
                        self.migrate_session_for_replacement(data,&session.id,&session.source,&target).await
                            .map_err(|reason| HostMessage::with_diagnostic("native.plugin.upgradeFailed",json!({"label":label,"reason":reason.display()}),format!("升级失败，已保留旧版。会话「{label}」迁移失败：{reason}")))?;
                    } else {
                        let current=crate::session_by_id(&self.db,&session.id).await.map_err(error)?;
                        let agents=crate::plugin_manifest::normalize_display(&candidate.manifest)?.session_agents(&preview.plugin_id);
                        if !agents.iter().any(|agent|agent["agentId"]==current.agent) {return Err(HostMessage::new("native.plugin.newAgentMissing",json!({})));}
                        let backend=execution_profile::installation_backend(&self.db,&target,&current.agent).await?;
                        let raw:String=sqlx::query_scalar("SELECT enforcement_backend FROM session_execution_profiles WHERE session_id=?").bind(&session.id).fetch_one(&self.db).await.map_err(error)?;
                        let previous:execution_profile::EnforcementBackend=serde_json::from_str(&raw).map_err(error)?;
                        if backend!=previous {return Err(HostMessage::new("native.plugin.backendIncompatible",json!({})));}
                        sqlx::query("UPDATE session_bindings SET plugin_binding_json=NULL,plugin_capabilities_json='[]',generation_id=NULL,external_session_id=NULL WHERE session_id=?")
                            .bind(&session.id).execute(&self.db).await.map_err(error)?;
                        sqlx::query("UPDATE sessions SET plugin_installation_id=? WHERE id=?").bind(&target).bind(&session.id).execute(&self.db).await.map_err(error)?;
                    }
                }
                for binding in saved.bindings.iter().filter(|b| !skips_binding(b)) {
                    let scope=match binding["scope_kind"].as_str(){Some("application")=>Scope::Application,Some("workspace")=>Scope::Workspace(binding["scope_id"].as_str().unwrap().into()),_=>Scope::Session(binding["scope_id"].as_str().unwrap().into())};
                    let offers=self.broker.providers(&scope,binding["capability_id"].as_str().unwrap(),binding["contract_version"].as_str().unwrap()).await.map_err(|e|e.message)?;
                    if !offers.iter().any(|p|p.installation_id==target && p.contribution_id==binding["contribution_id"].as_str().unwrap()) {return Err(HostMessage::new("native.plugin.bindingIncompatible",json!({})));}
                }
            }
            self.broker.stop_installation(&target).await.map_err(|e|e.message)?;
            let mut tx=self.db.begin_with("BEGIN IMMEDIATE").await.map_err(error)?;
            if !reinstall {
                for session in &saved.sessions {
                    if !skipped.contains(&session.id) {
                        if let Some(plan) = &session.rebuild {
                            crate::session_rebuild::restore_draft(&mut tx, &session.id, plan).await?;
                        }
                    }
                }
                for id in &skipped {
                    sqlx::query("INSERT OR IGNORE INTO plugin_session_retirements VALUES(?,?)").bind(id).bind(crate::now_iso()).execute(&mut *tx).await.map_err(error)?;
                    sqlx::query("UPDATE session_bindings SET plugin_binding_json=json_set(plugin_binding_json,'$.recovery',json('{}')),plugin_capabilities_json='[]',generation_id=NULL WHERE session_id=?").bind(id).execute(&mut *tx).await.map_err(error)?;
                }
            }
            for old in &saved.releases {
                if reinstall {
                    sqlx::query("INSERT OR IGNORE INTO plugin_session_retirements SELECT id,? FROM sessions WHERE plugin_installation_id=?")
                        .bind(crate::now_iso()).bind(&old.id).execute(&mut *tx).await.map_err(error)?;
                    sqlx::query("UPDATE session_bindings SET plugin_binding_json=json_set(plugin_binding_json,'$.recovery',json('{}')),plugin_capabilities_json='[]',generation_id=NULL WHERE session_id IN (SELECT id FROM sessions WHERE plugin_installation_id=?)")
                        .bind(&old.id).execute(&mut *tx).await.map_err(error)?;
                }
                sqlx::query("DELETE FROM capability_provider_bindings WHERE installation_id=?").bind(&old.id).execute(&mut *tx).await.map_err(error)?;
                sqlx::query("DELETE FROM capability_binding_candidates WHERE installation_id=?").bind(&old.id).execute(&mut *tx).await.map_err(error)?;
                sqlx::query("UPDATE plugin_installations SET installed=0,enabled=0,removed_at=? WHERE id=?").bind(crate::now_iso()).bind(&old.id).execute(&mut *tx).await.map_err(error)?;
            }
            if !reinstall {
                for binding in saved.bindings.iter().filter(|b| !skips_binding(b)) {
                    sqlx::query("INSERT OR REPLACE INTO capability_provider_bindings VALUES(?,?,?,?,?,?,?)")
                        .bind(binding["scope_kind"].as_str()).bind(binding["scope_id"].as_str()).bind(binding["capability_id"].as_str()).bind(binding["contract_version"].as_str())
                        .bind(&target).bind(binding["contribution_id"].as_str()).bind(crate::now_iso()).execute(&mut *tx).await.map_err(error)?;
                }
            } else {
                sqlx::query("DELETE FROM agent_settings WHERE plugin_id=? AND scope_kind<>'session'").bind(&preview.plugin_id).execute(&mut *tx).await.map_err(error)?;
            }
            if !reinstall && !saved.releases.iter().any(|p|p.enabled) {
                sqlx::query("UPDATE plugin_installations SET enabled=0,enabled_at=NULL WHERE id=?").bind(&target).execute(&mut *tx).await.map_err(error)?;
            }
            sqlx::query("UPDATE plugin_replacements SET phase=? WHERE plugin_id=?")
                .bind(if reinstall {"expired"} else {"ready"}).bind(&preview.plugin_id).execute(&mut *tx).await.map_err(error)?;
            tx.commit().await.map_err(error)?;
            Ok::<(),HostMessage>(())
        }.await;
        if let Err(reason) = result {
            self.broker
                .stop_installation(&target)
                .await
                .map_err(|e| e.message)?;
            replacement::restore(&self.db, &preview.plugin_id).await?;
            replacement::collect(&self.db, data).await?;
            return Err(reason);
        }
        // Commit already succeeded. A failed cleanup remains durably queued for startup.
        if let Err(error) = replacement::collect(&self.db, data).await {
            tracing::warn!(%error,"replacement cleanup deferred");
        }
        plugin_registry::list(&self.db)
            .await?
            .into_iter()
            .find(|p| p.id == target)
            .ok_or(HostMessage::new("native.plugin.replacementMissing",json!({})))
    }

    pub(crate) async fn undo_plugin_replacement(
        &self,
        data: &Path,
        target: &str,
    ) -> Result<(), HostMessage> {
        let sessions: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM sessions WHERE plugin_installation_id=? ORDER BY id",
        )
        .bind(target)
        .fetch_all(&self.db)
        .await
        .map_err(error)?;
        let mut guards = Vec::new();
        for id in &sessions {
            guards.push(self.session_operation(id).await);
        }
        let plugin = self.broker.claim_plugin_undo(target).await?;
        self.broker
            .stop_installation(target)
            .await
            .map_err(crate::capability_broker::Failure::into_host_message)?;
        replacement::restore(&self.db, &plugin).await?;
        replacement::collect(&self.db, data).await.map_err(Into::into)
    }
}

async fn copy_other_storage(
    db: &SqlitePool,
    data: &Path,
    plugin: &str,
    source: &str,
    target: &str,
    skipped: &[String],
) -> Result<(), HostMessage> {
    use sqlx::Row;
    let rows=sqlx::query("SELECT i.id,i.contribution_id,i.scope_kind,i.scope_id FROM capability_instances i WHERE i.installation_id=? AND NOT EXISTS(SELECT 1 FROM sessions s JOIN session_bindings b ON b.session_id=s.id WHERE i.scope_kind='session' AND s.id=i.scope_id AND s.agent=i.contribution_id AND s.plugin_installation_id=i.installation_id AND b.plugin_binding_json IS NOT NULL AND s.id NOT IN (SELECT session_id FROM plugin_session_retirements))")
        .bind(source).fetch_all(db).await.map_err(error)?;
    for row in rows {
        if row.get::<String,_>("scope_kind") == "session" && skipped.contains(&row.get::<String,_>("scope_id")) { continue; }
        let old: String = row.get("id");
        let from = crate::plugin_lifecycle::owned_path_display(
            data,
            &["plugin-data", plugin, source, "v1", &old],
        )?;
        if !from.exists() {
            continue;
        }
        let id = ulid::Ulid::new().to_string();
        sqlx::query("INSERT INTO capability_instances(id,installation_id,contribution_id,scope_kind,scope_id,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(installation_id,contribution_id,scope_kind,scope_id) DO NOTHING")
            .bind(&id).bind(target).bind(row.get::<String,_>("contribution_id")).bind(row.get::<String,_>("scope_kind")).bind(row.get::<String,_>("scope_id")).bind(crate::now_iso()).execute(db).await.map_err(error)?;
        let id:String=sqlx::query_scalar("SELECT id FROM capability_instances WHERE installation_id=? AND contribution_id=? AND scope_kind=? AND scope_id=?")
            .bind(target).bind(row.get::<String,_>("contribution_id")).bind(row.get::<String,_>("scope_kind")).bind(row.get::<String,_>("scope_id")).fetch_one(db).await.map_err(error)?;
        let existing =
            crate::plugin_lifecycle::owned_path_display(data, &["plugin-data", plugin, target, "v1", &id])?;
        if existing.exists() {
            return Err(HostMessage::new("native.plugin.storageConflict",json!({})));
        }
        let to = crate::plugin_storage::directory_display(
            &data.join("plugins").join(target),
            plugin,
            target,
            &id,
        )?;
        super::plugin_lifecycle::copy_tree(&from, &to, true)?;
    }
    Ok(())
}
