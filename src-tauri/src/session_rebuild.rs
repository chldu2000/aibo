//! Conservative host-owned evidence for replacing a native binding without loading it.
use crate::plugin_lifecycle::error;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection, SqlitePool};

#[derive(Serialize, Deserialize)]
pub(crate) struct Plan {
    // Draft participates in the confirmation snapshot; never overwrite a newer draft.
    draft: Option<String>,
    pub failed_turn: Option<String>,
    text: Option<String>,
}

pub(crate) async fn plan(db: &SqlitePool, session: &str) -> Result<Option<Plan>, String> {
    let parent: Option<String> = sqlx::query_scalar("SELECT parent_external_session_id FROM session_bindings WHERE session_id=?")
        .bind(session).fetch_optional(db).await.map_err(error)?.flatten();
    if parent.is_some() { return Ok(None); }
    let queued: i64 = sqlx::query_scalar("SELECT count(*) FROM queued_messages WHERE session_id=?")
        .bind(session).fetch_one(db).await.map_err(error)?;
    if queued != 0 { return Ok(None); }
    let draft: Option<String> = sqlx::query_scalar("SELECT text FROM composer_drafts WHERE session_id=?")
        .bind(session).fetch_optional(db).await.map_err(error)?;
    let turns = sqlx::query("SELECT t.id,t.status,t.input_text,d.state FROM turns t LEFT JOIN turn_delivery d ON d.turn_id=t.id WHERE t.session_id=?")
        .bind(session).fetch_all(db).await.map_err(error)?;
    if turns.is_empty() {
        let messages: i64 = sqlx::query_scalar("SELECT count(*) FROM messages WHERE session_id=?")
            .bind(session).fetch_one(db).await.map_err(error)?;
        return Ok((messages == 0).then_some(Plan { draft, failed_turn: None, text: None }));
    }
    if turns.len() != 1 { return Ok(None); }
    let turn = &turns[0];
    if turn.get::<String,_>("status") != "failed" || turn.get::<Option<String>,_>("state").as_deref() != Some("not_sent") {
        return Ok(None);
    }
    let text: String = turn.get("input_text");
    // An existing independent draft wins; leave the binding intact until it is handled.
    if draft.as_ref().is_some_and(|draft| !draft.trim().is_empty() && draft != &text) { return Ok(None); }
    let content: i64 = sqlx::query_scalar("SELECT count(*) FROM messages WHERE session_id=? AND (role IN ('assistant','tool') OR (role='user' AND (turn_id IS NULL OR turn_id<>?)))")
        .bind(session).bind(turn.get::<String,_>("id")).fetch_one(db).await.map_err(error)?;
    if content != 0 { return Ok(None); }
    Ok(Some(Plan { draft, failed_turn: Some(turn.get("id")), text: Some(text) }))
}

// Called only in the successful replacement transaction. Failure history remains untouched.
pub(crate) async fn restore_draft(tx: &mut SqliteConnection, session: &str, plan: &Plan) -> Result<(), crate::ui_i18n::HostMessage> {
    let (Some(turn), Some(text)) = (&plan.failed_turn, &plan.text) else { return Ok(()); };
    let current: Option<String> = sqlx::query_scalar("SELECT text FROM composer_drafts WHERE session_id=?")
        .bind(session).fetch_optional(&mut *tx).await.map_err(error)?;
    if current != plan.draft { return Err(crate::ui_i18n::HostMessage::new("native.plugin.draftChanged",serde_json::json!({}))); }
    sqlx::query("INSERT INTO composer_drafts(session_id,text,send_failed,updated_at) VALUES(?,?,1,?) ON CONFLICT(session_id) DO UPDATE SET text=excluded.text,send_failed=1,updated_at=excluded.updated_at")
        .bind(session).bind(text).bind(crate::now_iso()).execute(&mut *tx).await.map_err(error)?;
    let attachments: Vec<String> = sqlx::query_scalar("SELECT id FROM attachments WHERE session_id=? AND turn_id=?")
        .bind(session).bind(turn).fetch_all(&mut *tx).await.map_err(error)?;
    for id in attachments {
        sqlx::query("INSERT INTO attachments(id,workspace_id,session_id,turn_id,path,content_hash,size,media_type,source,send_strategy,created_at,inline_context,queued_message_id) SELECT ?,workspace_id,session_id,NULL,path,content_hash,size,media_type,source,send_strategy,?,inline_context,NULL FROM attachments a WHERE id=? AND NOT EXISTS(SELECT 1 FROM attachments d WHERE d.session_id=a.session_id AND d.turn_id IS NULL AND d.queued_message_id IS NULL AND d.path=a.path AND d.content_hash IS a.content_hash)")
            .bind(ulid::Ulid::new().to_string()).bind(crate::now_iso()).bind(id).execute(&mut *tx).await.map_err(error)?;
    }
    Ok(())
}
