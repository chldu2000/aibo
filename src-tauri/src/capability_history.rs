//! Host-owned immutable audit reads, independent of live resources and runtimes.
use crate::{CoreError, capability_broker::Scope};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};

fn boundary(before: Option<String>) -> Result<Option<i64>, CoreError> {
    before.map(|value| {
        if value.len() > 19 { return Err(CoreError::InvalidWorkspacePath("invalid audit cursor".into())); }
        value.parse::<i64>().ok().filter(|value| *value > 0).ok_or_else(|| CoreError::InvalidWorkspacePath("invalid audit cursor".into()))
    }).transpose()
}
fn scope_key(scope: &Scope) -> Result<(&str, &str), CoreError> {
    let key = match scope { Scope::Application => ("application", "application"), Scope::Workspace(id) => ("workspace", id.as_str()), Scope::Session(id) => ("session", id.as_str()) };
    if key.1.is_empty() || key.1.len() > 160 { return Err(CoreError::InvalidWorkspacePath("invalid audit scope".into())); }
    Ok(key)
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct ScopeItem { scope: Scope, label: Option<String> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct ScopePage { schema: &'static str, items: Vec<ScopeItem>, next_before: Option<String> }
#[derive(Serialize)]
pub(crate) struct Event { sequence: String, payload: Value }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct EventPage { schema: &'static str, scope: Scope, events: Vec<Event>, next_before: Option<String> }

pub(crate) async fn scopes(db: &SqlitePool, caller: &str, before: Option<String>) -> Result<ScopePage, CoreError> {
    let before = boundary(before)?;
    let mut rows = sqlx::query("SELECT e.scope_kind,e.scope_id,MAX(e.sequence) AS sequence,CASE WHEN e.scope_kind='workspace' THEN w.label WHEN e.scope_kind='session' THEN s.label END AS label FROM capability_events e LEFT JOIN workspaces w ON e.scope_kind='workspace' AND w.id=e.scope_id LEFT JOIN sessions s ON e.scope_kind='session' AND s.id=e.scope_id WHERE e.caller_window=? GROUP BY e.scope_kind,e.scope_id HAVING (? IS NULL OR MAX(e.sequence)<?) ORDER BY MAX(e.sequence) DESC LIMIT 51")
        .bind(caller).bind(before).bind(before).fetch_all(db).await?;
    let more = rows.len() > 50; rows.truncate(50);
    let next_before = if more { rows.last().map(|row| row.get::<i64,_>("sequence").to_string()) } else { None };
    let items = rows.iter().map(|row| {
        let id: String = row.try_get("scope_id")?;
        let scope = match row.get::<&str,_>("scope_kind") { "application" => Scope::Application, "workspace" => Scope::Workspace(id), "session" => Scope::Session(id), _ => return Err(CoreError::Initialization("unknown persisted audit scope".into())) };
        Ok(ScopeItem { scope, label: row.try_get("label")? })
    }).collect::<Result<Vec<_>,CoreError>>()?;
    Ok(ScopePage { schema:"aibo.capability-history-scopes/v1", items, next_before })
}

pub(crate) async fn events(db: &SqlitePool, caller: &str, scope: Scope, before: Option<String>) -> Result<EventPage, CoreError> {
    let before = boundary(before)?; let (kind,id) = scope_key(&scope)?;
    let mut rows = sqlx::query("SELECT sequence,payload_json FROM capability_events WHERE caller_window=? AND scope_kind=? AND scope_id=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT 51")
        .bind(caller).bind(kind).bind(id).bind(before).bind(before).fetch_all(db).await?;
    let more = rows.len()>50; rows.truncate(50);
    let next_before = if more { rows.last().map(|row| row.get::<i64,_>("sequence").to_string()) } else { None };
    let events = rows.iter().map(|row| Ok(Event {
        sequence: row.get::<i64,_>("sequence").to_string(),
        payload: serde_json::from_str(row.get("payload_json")).map_err(|error| CoreError::Initialization(error.to_string()))?,
    })).collect::<Result<Vec<_>,CoreError>>()?;
    Ok(EventPage { schema:"aibo.capability-history-events/v1", scope, events, next_before })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn owner_audit_survives_revocation_deleted_scopes_and_disabled_packages_read_only() {
        let root=std::env::temp_dir().join(format!("aibo-cap-history-{}",ulid::Ulid::new()));std::fs::create_dir_all(&root).unwrap();let path=root.join("host.db");
        let db=crate::open_database(&path).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w',?,'Untrusted',0,'before','before')").bind(root.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('deleted','w','fixture','Deleted session','closed','before','before')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO plugin_installations(id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,enabled,created_at) VALUES ('disabled','fixture','1.0.0','digest','local','/unavailable-audit-fixture','{}',0,'before')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sqlite_sequence(name,seq) VALUES ('capability_events',9007199254740993)").execute(&db).await.unwrap();
        for index in 0..60 {
            sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms) VALUES (?,'main','workspace','w','fixture.read','1.0.0','disabled','read','running','before',0)")
                .bind(format!("invocation-{index}")).execute(&db).await.unwrap();
            sqlx::query("UPDATE capability_invocations SET generation_id='generation' WHERE id=?").bind(format!("invocation-{index}")).execute(&db).await.unwrap();
            sqlx::query("UPDATE capability_invocations SET status='completed',finished_at='after' WHERE id=?").bind(format!("invocation-{index}")).execute(&db).await.unwrap();
        }
        for (index,kind,id,caller) in [("session","session","deleted","main"),("application","application","application","main"),("other","workspace","w","other")] {
            sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms) VALUES (?,?,?,?,'fixture.read','1.0.0','disabled','read','completed','before',0)")
                .bind(index).bind(caller).bind(kind).bind(id).execute(&db).await.unwrap();
        }
        for index in 0..55 {
            sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms) VALUES (?,'main','workspace',?,'fixture.read','1.0.0','disabled','read','completed','before',0)")
                .bind(format!("scope-{index}")).bind(format!("removed-{index}")).execute(&db).await.unwrap();
        }
        sqlx::query("DELETE FROM sessions WHERE id='deleted'").execute(&db).await.unwrap();db.close().await;
        let readonly=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&path).read_only(true)).await.unwrap();
        let mut before=None;let mut sequences=std::collections::HashSet::new();let mut count=0;
        loop {
            let page=events(&readonly,"main",Scope::Workspace("w".into()),before).await.unwrap();count+=1;
            for event in page.events {assert!(event.sequence.parse::<i64>().unwrap()>9007199254740993);assert!(sequences.insert(event.sequence));assert_eq!(event.payload["installationId"],"disabled");}
            before=page.next_before;if before.is_none(){break;}
        }
        assert_eq!(count,4);assert_eq!(sequences.len(),180);
        let first=scopes(&readonly,"main",None).await.unwrap();assert_eq!(first.items.len(),50);
        let second=scopes(&readonly,"main",first.next_before).await.unwrap();assert_eq!(second.items.len(),8);assert!(second.next_before.is_none());
        assert!(second.items.iter().any(|item|item.scope==Scope::Session("deleted".into())&&item.label.is_none()));
        assert_eq!(events(&readonly,"main",Scope::Session("deleted".into()),None).await.unwrap().events.len(),1);
        assert_eq!(events(&readonly,"other",Scope::Workspace("w".into()),None).await.unwrap().events.len(),1);
        assert!(scopes(&readonly,"unknown",None).await.unwrap().items.is_empty());
        assert!(events(&readonly,"main",Scope::Workspace("w".into()),Some("-1".into())).await.is_err());
        assert!(scopes(&readonly,"main",Some("9223372036854775808".into())).await.is_err());
        readonly.close().await;std::fs::remove_dir_all(root).unwrap();
    }
}
