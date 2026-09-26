//! One host-owned reader, independent of provider identity and tool transport.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const MAX_SNAPSHOT: usize = 16 * 1024 * 1024;
const MAX_CACHE: usize = 64 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(600);

pub(crate) fn catalog() -> &'static Value {
    static VALUE: OnceLock<Value> = OnceLock::new();
    VALUE.get_or_init(|| {
        serde_json::from_str(include_str!("../../contracts/host-tools.v1.json")).unwrap()
    })
}
pub(crate) fn offered(manifest: &Value, contribution: &str, handshake: &Value) -> bool {
    manifest["contributions"].as_array().and_then(|entries| entries.iter().find(|entry| entry["id"] == contribution))
        .is_some_and(|entry| entry["scope"]=="session" && entry["kind"]=="capabilityProvider" && entry["hostTools"].as_array().is_some_and(|items| items.contains(&json!("aibo.host-tools/v1")))
            && entry["operations"].as_array().is_some_and(|ops| ops.iter().any(|op|
                op["capability"]["id"] == "aibo.session.tool.respond"
                && crate::session_contract::validates_operation(op, "session", manifest)
                && handshake.as_array().is_some_and(|items| items.contains(&json!({"capability":"aibo.session.tool.respond","version":"1.0.0","operationId":op["id"]}))))))
}
#[derive(Default, Clone)]
pub(crate) struct HistoryReader {
    cache: Arc<Mutex<HashMap<String, Snapshot>>>,
}
struct Snapshot {
    owner: String,
    turn: String,
    generation: String,
    reference: String,
    source: String,
    captured: String,
    reference_captured: String,
    through: Option<String>,
    data: String,
    secret: String,
    expires: Instant,
}
impl Snapshot {
    fn cursor(&self, id: &str, offset: usize) -> String {
        let digest = Sha256::digest(format!("{}:{id}:{offset}", self.secret).as_bytes());
        format!("{id}.{offset}.{digest:x}")
    }
    fn page(&self, id: &str, offset: usize, budget: usize) -> Result<Value, String> {
        if offset > self.data.len() || !self.data.is_char_boundary(offset) {
            return Err("invalid_input: cursor offset".into());
        }
        let mut end = (offset + budget).min(self.data.len());
        loop {
            while !self.data.is_char_boundary(end) {
                end -= 1;
            }
            let result = json!({"source":"persisted-core","sessionId":self.source,
                "referenceCapturedAt":self.reference_captured,"readSnapshotId":id,"readCapturedAt":self.captured,
                "throughMessageId":self.through,"historyScope":"Aibo persisted main-session messages and attachment metadata; no pre-import native history or attachment file bytes",
                "format":"jsonl","content":&self.data[offset..end],"offset":offset,
                "nextCursor":if end < self.data.len() {Some(self.cursor(id,end))} else {None},"complete":end==self.data.len()});
            if result.to_string().len() <= budget {
                return Ok(result);
            }
            if end == offset {
                return Err("invalid_output: page metadata exceeds budget".into());
            }
            end = offset + (end - offset) / 2;
        }
    }
}
fn err(error: impl std::fmt::Display) -> String {
    format!("history_unavailable: {error}")
}

// An actual accepted user message and its host-owned attachment must both agree.
fn has_reference(text: &str, id: &str, hash: &str) -> bool {
    text.split("[AIBO_SESSION_REFERENCES]\n")
        .skip(1)
        .any(|block| {
            block
                .lines()
                .nth(1)
                .and_then(|line| serde_json::from_str::<Value>(line).ok())
                .and_then(|value| value.as_array().cloned())
                .is_some_and(|entries| {
                    entries
                        .iter()
                        .any(|entry| entry["snapshotId"] == id && entry["contentHash"] == hash)
                })
        })
}
async fn authorize(
    db: &SqlitePool,
    owner: &str,
    turn: &str,
    reference: &str,
    source: &str,
) -> Result<String, String> {
    let row = sqlx::query("SELECT a.inline_context,a.content_hash FROM attachments a JOIN sessions target ON target.id=a.session_id JOIN sessions source ON source.id=? JOIN workspaces w ON w.id=target.workspace_id JOIN turns t ON t.id=a.turn_id AND t.session_id=target.id WHERE a.id=? AND a.session_id=? AND a.turn_id=? AND a.media_type='application/vnd.aibo.session-reference+json' AND source.workspace_id=target.workspace_id AND source.id<>target.id AND w.trusted=1 AND t.status='running'")
        .bind(source).bind(reference).bind(owner).bind(turn).fetch_optional(db).await.map_err(err)?
        .ok_or("permission_denied: source is not a reference accepted in this active turn")?;
    let snapshot: Value =
        serde_json::from_str(&row.get::<String, _>("inline_context")).map_err(err)?;
    if snapshot["sourceSessionId"] != source {
        return Err("permission_denied: reference source mismatch".into());
    }
    let messages: Vec<String> = sqlx::query_scalar(
        "SELECT content FROM messages WHERE session_id=? AND turn_id=? AND role='user'",
    )
    .bind(owner)
    .bind(turn)
    .fetch_all(db)
    .await
    .map_err(err)?;
    if !messages
        .iter()
        .any(|text| has_reference(text, reference, &row.get::<String, _>("content_hash")))
    {
        return Err("permission_denied: reference was not sent in this turn".into());
    }
    Ok(snapshot["capturedAt"].as_str().unwrap_or_default().into())
}
impl HistoryReader {
    pub(crate) async fn clear_turn(&self, turn: &str) {
        self.cache.lock().await.retain(|_, s| s.turn != turn);
    }
    pub(crate) async fn read(
        &self,
        db: &SqlitePool,
        owner: &str,
        turn: &str,
        generation: &str,
        input: &Value,
    ) -> Result<Value, String> {
        static SCHEMA: OnceLock<jsonschema::Validator> = OnceLock::new();
        if !SCHEMA
            .get_or_init(|| {
                jsonschema::options()
                    .build(&catalog()["tools"][0]["inputSchema"])
                    .unwrap()
            })
            .is_valid(input)
        {
            return Err("invalid_input: expected referenceId/sessionId or cursor, and pageBytes 4096..65536".into());
        }
        let budget = input["pageBytes"].as_u64().unwrap_or(32768) as usize;
        let mut cache = self.cache.lock().await;
        cache.retain(|_, s| s.expires > Instant::now());
        if let Some(cursor) = input["cursor"].as_str() {
            let parts: Vec<_> = cursor.split('.').collect();
            if parts.len() != 3 {
                return Err("invalid_input: invalid cursor".into());
            }
            let snapshot = cache
                .get(parts[0])
                .ok_or("snapshot_expired: begin a new read explicitly")?;
            let offset = parts[1]
                .parse::<usize>()
                .map_err(|_| "invalid_input: invalid cursor")?;
            if snapshot.owner != owner
                || snapshot.turn != turn
                || snapshot.generation != generation
                || snapshot.cursor(parts[0], offset) != cursor
            {
                return Err("permission_denied: cursor scope or signature mismatch".into());
            }
            authorize(db, owner, turn, &snapshot.reference, &snapshot.source).await?;
            return snapshot.page(parts[0], offset, budget);
        }
        let reference = input["referenceId"].as_str().unwrap();
        let source = input["sessionId"].as_str().unwrap();
        let reference_captured = authorize(db, owner, turn, reference, source).await?;
        // Repeated first calls reuse the same immutable read and cannot exhaust the quota.
        if let Some((id, s)) = cache.iter().find(|(_, s)| {
            s.owner == owner
                && s.turn == turn
                && s.generation == generation
                && s.reference == reference
        }) {
            return s.page(id, 0, budget);
        }
        if cache.values().filter(|s| s.turn == turn).count() >= 4 {
            return Err("resource_limit: at most four read snapshots per turn".into());
        }
        let used: usize = cache.values().map(|s| s.data.len()).sum();
        let available = MAX_SNAPSHOT.min(MAX_CACHE.saturating_sub(used));
        let mut tx = db.begin().await.map_err(err)?;
        let size:i64=sqlx::query_scalar("SELECT COALESCE(SUM(length(CAST(content AS BLOB))+COALESCE(length(CAST(tool_command AS BLOB)),0)+COALESCE(length(CAST(tool_cwd AS BLOB)),0)+COALESCE(length(CAST(tool_name AS BLOB)),0)+512),0) FROM messages WHERE session_id=?")
            .bind(source).fetch_one(&mut *tx).await.map_err(err)?;
        if size as usize > available {
            return Err("resource_limit: history snapshot exceeds the 16 MiB per-read or 64 MiB global budget".into());
        }
        let rows = sqlx::query(
            "SELECT * FROM messages WHERE session_id=? ORDER BY created_at,sequence,id",
        )
        .bind(source)
        .fetch_all(&mut *tx)
        .await
        .map_err(err)?;
        let through = rows.last().map(|r| r.get::<String, _>("id"));
        let mut data = String::new();
        for row in rows {
            let item = json!({"kind":"message","id":row.get::<String,_>("id"),"role":row.get::<String,_>("role"),"content":row.get::<String,_>("content"),
                "externalMessageId":row.get::<Option<String>,_>("external_message_id"),"status":row.get::<String,_>("status"),"sequence":row.get::<i64,_>("sequence"),"turnId":row.get::<Option<String>,_>("turn_id"),
                "createdAt":row.get::<String,_>("created_at"),"updatedAt":row.get::<String,_>("updated_at"),
                "toolName":row.get::<Option<String>,_>("tool_name"),"toolCommand":row.get::<Option<String>,_>("tool_command"),
                "toolCwd":row.get::<Option<String>,_>("tool_cwd"),"toolExitCode":row.get::<Option<i64>,_>("tool_exit_code")});
            data.push_str(&item.to_string());
            data.push('\n');
            if data.len() > available {
                return Err("resource_limit: serialized history exceeds snapshot budget".into());
            }
        }
        let attachment_size:i64=sqlx::query_scalar("SELECT COALESCE(SUM(length(CAST(path AS BLOB))+length(CAST(media_type AS BLOB))+COALESCE(length(CAST(content_hash AS BLOB)),0)+512),0) FROM attachments WHERE session_id=? AND turn_id IS NOT NULL")
            .bind(source).fetch_one(&mut *tx).await.map_err(err)?;
        if attachment_size as usize > available.saturating_sub(data.len()) {
            return Err("resource_limit: attachment metadata exceeds snapshot budget".into());
        }
        let attachments=sqlx::query("SELECT id,turn_id,path,media_type,content_hash,size FROM attachments WHERE session_id=? AND turn_id IS NOT NULL ORDER BY created_at,id LIMIT 10001")
            .bind(source).fetch_all(&mut *tx).await.map_err(err)?;
        if attachments.len() > 10000 {
            return Err("resource_limit: too many attachment records".into());
        }
        for row in attachments {
            data.push_str(&json!({"kind":"attachment","id":row.get::<String,_>("id"),"turnId":row.get::<Option<String>,_>("turn_id"),
                "path":row.get::<String,_>("path"),"mediaType":row.get::<String,_>("media_type"),"contentHash":row.get::<Option<String>,_>("content_hash"),
                "size":row.get::<Option<i64>,_>("size"),"fileBytesIncluded":false}).to_string());
            data.push('\n');
            if data.len() > available {
                return Err("resource_limit: serialized history exceeds snapshot budget".into());
            }
        }
        tx.commit().await.map_err(err)?;
        let id = ulid::Ulid::new().to_string();
        let snapshot = Snapshot {
            owner: owner.into(),
            turn: turn.into(),
            generation: generation.into(),
            reference: reference.into(),
            source: source.into(),
            reference_captured,
            captured: crate::now_iso(),
            through,
            data,
            secret: ulid::Ulid::new().to_string(),
            expires: Instant::now() + TTL,
        };
        let page = snapshot.page(&id, 0, budget)?;
        cache.insert(id, snapshot);
        Ok(page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_requires_opt_in_and_the_exact_negotiated_response_contract() {
        let mut manifest: Value =
            serde_json::from_str(include_str!("../capability-plugins/pi/plugin.json")).unwrap();
        manifest["pluginId"] = json!("org.example.unknown");
        let id = manifest["contributions"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let operations = manifest["contributions"][0]["operations"]
            .as_array()
            .unwrap();
        let handshake=json!(operations.iter().map(|op|json!({"capability":op["capability"]["id"],"version":op["capability"]["version"],"operationId":op["id"]})).collect::<Vec<_>>());
        assert!(offered(&manifest, &id, &handshake));
        assert!(!offered(&manifest, &id, &json!([])));
        assert!(!offered(&manifest, "foreign-contribution", &handshake));
        let entry = &mut manifest["contributions"][0];
        entry.as_object_mut().unwrap().remove("hostTools");
        assert!(!offered(&manifest, &id, &handshake));
        manifest["contributions"][0]["hostTools"] = json!(["aibo.host-tools/v1"]);
        let op = manifest["contributions"][0]["operations"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|op| op["capability"]["id"] == "aibo.session.tool.respond")
            .unwrap();
        op["inputSchema"] = json!({"type":"object"});
        assert!(!offered(&manifest, &id, &handshake));
    }
    #[tokio::test]
    async fn complete_history_is_scoped_frozen_chunked_and_revocable() {
        let root = std::env::temp_dir().join(format!("aibo-history-tool-{}", ulid::Ulid::new()));
        let db = crate::open_database(&root.join("db")).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w','/history-tool','w',1,'now','now'),('foreign','/else','foreign',1,'now','now');
            INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES('target','w','third.party','target','running','now','now'),('source','w','unknown.provider','source','idle','now','now'),('foreign','foreign','another','foreign','idle','now','now');
            INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES('original','source','assistant','reference-time text','streaming',1,'now','now');")
            .execute(&db).await.unwrap();
        let attachment = crate::session_context::capture(&db, "target", "source")
            .await
            .unwrap();
        let request = json!({"referenceId":attachment.id,"sessionId":"source","pageBytes":4096});
        let reader = HistoryReader::default();
        assert!(reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap_err()
            .contains("permission_denied"));
        sqlx::raw_sql("INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES('t','target','t','running','read','now');
            UPDATE attachments SET turn_id='t';
            INSERT INTO messages(id,session_id,turn_id,role,content,status,sequence,created_at,updated_at) VALUES('user','target','t','user','forged reference id','completed',1,'now','now');")
            .execute(&db).await.unwrap();
        assert!(reader
            .read(&db, "target", "t", "g", &request)
            .await
            .is_err());
        let text = format!(
            "read\n[AIBO_SESSION_REFERENCES]\nnotice\n{}\n[/AIBO_SESSION_REFERENCES]",
            json!([{"snapshotId":attachment.id,"contentHash":attachment.content_hash}])
        );
        sqlx::query("UPDATE messages SET content=? WHERE id='user'")
            .bind(text)
            .execute(&db)
            .await
            .unwrap();
        let original = "原文😀\"\\\n".repeat(2000);
        sqlx::query("UPDATE messages SET content=? WHERE id='original'")
            .bind(&original)
            .execute(&db)
            .await
            .unwrap();
        sqlx::raw_sql("INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at,tool_name,tool_exit_code) VALUES('tool','source','tool','raw tool result','completed',2,'now','now','test_tool',7),('sys','source','system','raw system','completed',3,'now','now',NULL,NULL);
            UPDATE sessions SET archived=1 WHERE id='source';")
            .execute(&db).await.unwrap();
        let first = reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap();
        assert_eq!(first["format"], "jsonl");
        assert!(!first["complete"].as_bool().unwrap());
        let cursor = first["nextCursor"].as_str().unwrap();
        assert!(reader
            .read(
                &db,
                "target",
                "t",
                "another-generation",
                &json!({"cursor":cursor})
            )
            .await
            .is_err());
        assert!(reader
            .read(&db, "other", "t", "g", &json!({"cursor":cursor}))
            .await
            .is_err());
        assert!(reader
            .read(
                &db,
                "target",
                "t",
                "g",
                &json!({"cursor":format!("{cursor}0")})
            )
            .await
            .is_err());
        assert!(reader
            .read(
                &db,
                "target",
                "t",
                "g",
                &json!({"referenceId":attachment.id,"sessionId":"foreign"})
            )
            .await
            .is_err());
        assert!(reader
            .read(
                &db,
                "target",
                "t",
                "g",
                &json!({"referenceId":attachment.id,"sessionId":"source","pageBytes":10})
            )
            .await
            .is_err());
        sqlx::query("UPDATE messages SET content='changed after read' WHERE id='original'")
            .execute(&db)
            .await
            .unwrap();
        let mut page = first;
        let mut full = String::new();
        loop {
            assert!(page.to_string().len() <= 4096);
            assert_eq!(page["offset"].as_u64().unwrap() as usize, full.len());
            full.push_str(page["content"].as_str().unwrap());
            if page["complete"] == true {
                assert!(page["nextCursor"].is_null());
                break;
            }
            page = reader
                .read(
                    &db,
                    "target",
                    "t",
                    "g",
                    &json!({"cursor":page["nextCursor"],"pageBytes":4096}),
                )
                .await
                .unwrap();
        }
        let records: Vec<Value> = full
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(records.len(), 3);
        assert_eq!(records[0]["content"], original);
        assert_eq!(records[1]["toolExitCode"], 7);
        assert_eq!(records[2]["content"], "raw system");
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id='w'")
            .execute(&db)
            .await
            .unwrap();
        assert!(reader
            .read(&db, "target", "t", "g", &request)
            .await
            .is_err());
        sqlx::query("UPDATE workspaces SET trusted=1 WHERE id='w'")
            .execute(&db)
            .await
            .unwrap();
        let repeated = reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap();
        assert_eq!(repeated["readSnapshotId"], page["readSnapshotId"]);
        reader.clear_turn("t").await;
        assert!(reader
            .read(
                &db,
                "target",
                "t",
                "g",
                &json!({"cursor":repeated["nextCursor"]})
            )
            .await
            .unwrap_err()
            .contains("snapshot_expired"));
        let fresh = reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap();
        assert!(fresh["content"]
            .as_str()
            .unwrap()
            .contains("changed after read"));
        reader
            .cache
            .lock()
            .await
            .get_mut(fresh["readSnapshotId"].as_str().unwrap())
            .unwrap()
            .expires = Instant::now() - Duration::from_secs(1);
        assert!(reader
            .read(
                &db,
                "target",
                "t",
                "g",
                &json!({"cursor":format!("{}.0.x",fresh["readSnapshotId"].as_str().unwrap())})
            )
            .await
            .unwrap_err()
            .contains("snapshot_expired"));
        sqlx::query("UPDATE messages SET content=? WHERE id='original'")
            .bind("x".repeat(MAX_SNAPSHOT + 1))
            .execute(&db)
            .await
            .unwrap();
        assert!(reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap_err()
            .contains("resource_limit"));
        sqlx::query("UPDATE turns SET status='completed' WHERE id='t'")
            .execute(&db)
            .await
            .unwrap();
        assert!(reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap_err()
            .contains("permission_denied"));
        sqlx::raw_sql("UPDATE turns SET status='running' WHERE id='t'; DELETE FROM messages WHERE session_id='source';
            INSERT INTO turns(id,session_id,external_turn_id,status,input_text,started_at) VALUES('source-turn','source','source-turn','completed','input','now');
            INSERT INTO attachments(id,workspace_id,session_id,turn_id,path,size,media_type,source,send_strategy,created_at) VALUES('source-file','w','source','source-turn','secret.bin',99,'application/octet-stream','manual','reference','now');")
            .execute(&db).await.unwrap();
        let metadata = reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap();
        let record: Value =
            serde_json::from_str(metadata["content"].as_str().unwrap().trim()).unwrap();
        assert_eq!(record["kind"], "attachment");
        assert_eq!(record["fileBytesIncluded"], false);
        reader.clear_turn("t").await;
        sqlx::query("DELETE FROM attachments WHERE id='source-file'")
            .execute(&db)
            .await
            .unwrap();
        let empty = reader
            .read(&db, "target", "t", "g", &request)
            .await
            .unwrap();
        assert_eq!(empty["content"], "");
        assert_eq!(empty["complete"], true);
        assert!(empty["throughMessageId"].is_null());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
