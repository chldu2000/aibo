//! Read-only search over rebuildable host projections. No provider is started.
use crate::CoreError;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub query: String,
    pub kind: Option<String>,
    pub workspace_id: Option<String>,
    pub limit: u32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Target {
    pub source: String,
    pub id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub excerpt: String,
    pub target: Target,
    pub score: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    pub items: Vec<Item>,
    pub has_more: bool,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Detail {
    pub title: String,
    pub content: String,
    pub target: Target,
    pub truncated: bool,
}

pub(crate) fn validate(request: &Request) -> Result<(), CoreError> {
    if request.query.chars().count() > 256
        || request.limit == 0
        || request.limit > 500
        || request.kind.as_deref().is_some_and(|kind| {
            ![
                "workspace",
                "session",
                "message",
                "file",
                "command",
                "setting",
                "plugin",
                "attachment",
                "artifact",
                "execution",
            ]
            .contains(&kind)
        })
    {
        return Err(CoreError::SessionOperation("搜索条件无效".into()));
    }
    Ok(())
}
pub(crate) fn excerpt(body: &str, query: &str) -> String {
    let chars: Vec<char> = body.chars().collect();
    let start = body
        .to_lowercase()
        .find(&query.to_lowercase())
        .map(|byte| {
            body.to_lowercase()[..byte]
                .chars()
                .count()
                .saturating_sub(45)
        })
        .unwrap_or(0)
        .min(chars.len());
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        chars[start..chars.len().min(start + 200)]
            .iter()
            .collect::<String>()
            .replace('\n', " "),
        if chars.len() > start + 200 { "…" } else { "" }
    )
}
fn literal_like(query: &str) -> String {
    format!(
        "%{}%",
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}
const JOINS: &str = "FROM search_documents d LEFT JOIN sessions s ON s.id=d.session_id LEFT JOIN capability_events ce ON d.source='capability-event' AND ce.sequence=d.target_id LEFT JOIN capability_invocations ci ON (d.source='capability' AND ci.id=d.target_id) OR (d.source='capability-event' AND ci.id=ce.invocation_id) LEFT JOIN sessions cs ON ci.scope_kind='session' AND cs.id=ci.scope_id LEFT JOIN workspaces w ON w.id=COALESCE(d.workspace_id,s.workspace_id,cs.workspace_id,CASE WHEN ci.scope_kind='workspace' THEN ci.scope_id END)";
pub(crate) async fn search(
    db: &SqlitePool,
    caller: &str,
    request: Request,
) -> Result<Page, CoreError> {
    validate(&request)?;
    if request.kind.is_some() {
        return search_kind(db, caller, request).await;
    }
    let kinds: &[&str] = if request.query.trim().is_empty() {
        &["workspace", "session"]
    } else {
        &["workspace", "session", "message", "plugin", "execution"]
    };
    let mut result = Page {
        items: vec![],
        has_more: false,
        warnings: vec![],
    };
    for kind in kinds {
        let mut scoped = request.clone();
        scoped.kind = Some((*kind).into());
        let page = search_kind(db, caller, scoped).await?;
        result.items.extend(page.items);
        result.has_more |= page.has_more;
    }
    Ok(result)
}
async fn search_kind(db: &SqlitePool, caller: &str, request: Request) -> Result<Page, CoreError> {
    validate(&request)?;
    let query = request.query.trim().to_lowercase();
    let mut sql = format!("SELECT d.*,w.id AS resolved_workspace,w.label AS workspace_label,s.label AS session_label,COALESCE(s.archived,0) AS archived {JOINS} WHERE (d.owner_window IS NULL OR d.owner_window=?) AND (? IS NULL OR w.id=?) AND (? IS NULL OR d.kind=?)");
    if request.kind.is_none() {
        sql.push_str(" AND d.kind!='file'");
    }
    // Trigram MATCH is literal, not an exposed FTS expression language.
    let use_fts = query.chars().count() >= 3;
    if use_fts {
        sql.push_str(" AND d.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)");
    } else {
        sql.push_str(
            " AND (?='' OR lower(d.title) LIKE ? ESCAPE '\\' OR lower(d.body) LIKE ? ESCAPE '\\')",
        );
    }
    sql.push_str(" ORDER BY CASE WHEN lower(d.title)=? THEN 0 WHEN instr(lower(d.title),?)=1 THEN 1 WHEN instr(lower(d.title),?)>0 THEN 2 ELSE 3 END,d.updated_at DESC,d.id LIMIT ?");
    let mut statement = sqlx::query(&sql)
        .bind(caller)
        .bind(&request.workspace_id)
        .bind(&request.workspace_id)
        .bind(&request.kind)
        .bind(&request.kind);
    if use_fts {
        statement = statement.bind(format!("\"{}\"", query.replace('"', "\"\"")));
    } else {
        statement = statement
            .bind(&query)
            .bind(literal_like(&query))
            .bind(literal_like(&query));
    }
    let rows = statement
        .bind(&query)
        .bind(&query)
        .bind(&query)
        .bind(i64::from(request.limit) + 1)
        .fetch_all(db)
        .await?;
    let has_more = rows.len() > request.limit as usize;
    let items = rows
        .into_iter()
        .take(request.limit as usize)
        .map(|row| {
            let title: String = row.get("title");
            let label = title.to_lowercase();
            let body: String = row.get("body");
            let source: String = row.get("source");
            let mut description = [
                row.get::<Option<String>, _>("workspace_label"),
                row.get::<Option<String>, _>("session_label"),
                if row.get::<i64, _>("archived") != 0 {
                    Some("已归档".into())
                } else {
                    None
                },
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ");
            let line = if source == "file" && !query.is_empty() {
                body.to_lowercase().find(&query).map(|offset| {
                    body.to_lowercase()[..offset]
                        .chars()
                        .filter(|character| *character == '\n')
                        .count()
                        + 1
                })
            } else {
                None
            };
            if let Some(line) = line {
                description.push_str(&format!(" · 第 {line} 行"));
            }
            let display_title = if source == "message" {
                match title.as_str() {
                    "assistant" => "助手消息".into(),
                    "user" => "用户消息".into(),
                    "system" => "系统消息".into(),
                    "tool" => "工具输出".into(),
                    _ => title.clone(),
                }
            } else {
                title.clone()
            };
            Item {
                id: row.get("id"),
                kind: row.get("kind"),
                title: display_title,
                description,
                excerpt: excerpt(&body, &query),
                score: if query.is_empty() {
                    1
                } else if label == query {
                    100
                } else if label.starts_with(&query) {
                    90
                } else if label.contains(&query) {
                    75
                } else {
                    50
                },
                target: Target {
                    source: source.clone(),
                    id: row.get("target_id"),
                    workspace_id: row.get("resolved_workspace"),
                    session_id: row.get("session_id"),
                    path: if source == "file" {
                        Some(row.get("target_id"))
                    } else {
                        None
                    },
                    line,
                },
            }
        })
        .collect();
    Ok(Page {
        items,
        has_more,
        warnings: vec![],
    })
}
pub(crate) async fn detail(
    db: &SqlitePool,
    caller: &str,
    target: Target,
) -> Result<Detail, CoreError> {
    let sql=format!("SELECT d.title,d.body {JOINS} WHERE d.source=? AND d.target_id=? AND (d.owner_window IS NULL OR d.owner_window=?) AND w.id IS ? AND d.session_id IS ?");
    let row = sqlx::query(&sql)
        .bind(&target.source)
        .bind(&target.id)
        .bind(caller)
        .bind(&target.workspace_id)
        .bind(&target.session_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| CoreError::SessionOperation("搜索结果已失效，请重新搜索".into()))?;
    let body: String = row.get("body");
    Ok(Detail {
        title: row.get("title"),
        content: crate::artifact::truncate_utf8(&body, 256 * 1024, "\n…内容过长，预览已截断"),
        truncated: body.len() > 256 * 1024,
        target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn indexes_history_updates_deletes_chinese_and_scopes_without_runtime() {
        let root = std::env::temp_dir().join(format!("aibo-search-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        for id in ["w1", "w2"] {
            sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES (?,?,?,0,'now','now')").bind(id).bind(root.join(id).to_string_lossy().as_ref()).bind(format!("工作区{id}")).execute(&db).await.unwrap();
        }
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,archived,created_at,updated_at) VALUES ('s','w2','missing.provider','历史会话','closed',1,'now','now')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES ('m','s','assistant','在中文连续文本中搜索百分号100%和_under_score','completed',0,'now','now')").execute(&db).await.unwrap();
        let request = |query: &str, workspace: Option<&str>| Request {
            query: query.into(),
            kind: Some("message".into()),
            workspace_id: workspace.map(str::to_owned),
            limit: 50,
        };
        for query in ["中文连续", "中文", "中", "100%", "_under_", "%", "_"] {
            let page = search(&db, "main", request(query, None)).await.unwrap();
            assert_eq!(page.items.len(), 1, "{query}");
            assert!(page.items[0].description.contains("已归档"));
            assert_eq!(page.items[0].target.workspace_id.as_deref(), Some("w2"));
            let detail = detail(&db, "main", page.items[0].target.clone())
                .await
                .unwrap();
            assert!(detail.content.contains("中文连续"));
        }
        assert!(search(&db, "main", request("中文", Some("w1")))
            .await
            .unwrap()
            .items
            .is_empty());
        assert!(search(&db, "main", request("not-found OR 中文", None))
            .await
            .unwrap()
            .items
            .is_empty());
        sqlx::query("UPDATE messages SET content='更新后的唯一正文' WHERE id='m'")
            .execute(&db)
            .await
            .unwrap();
        assert!(search(&db, "main", request("中文连续", None))
            .await
            .unwrap()
            .items
            .is_empty());
        assert_eq!(
            search(&db, "main", request("唯一正文", None))
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        sqlx::query("INSERT INTO plugin_installations(id,plugin_id,plugin_version,package_digest,source,install_path,manifest_json,enabled,created_at) VALUES ('plugin','fixture','1.0.0','fixture','local','/missing','{}',0,'now')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO capability_invocations(id,caller_window,scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,status,started_at,deadline_ms) VALUES ('call','owner','workspace','w2','私有调用关键词','1.0.0','plugin','read','completed','now',0)").execute(&db).await.unwrap();
        let audit = Request {
            query: "私有调用关键词".into(),
            kind: Some("execution".into()),
            workspace_id: Some("w2".into()),
            limit: 50,
        };
        let owned = search(&db, "owner", audit.clone()).await.unwrap();
        assert_eq!(owned.items.len(), 2);
        let sources = owned
            .items
            .iter()
            .map(|item| item.target.source.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            sources,
            std::collections::BTreeSet::from(["capability", "capability-event"])
        );
        for item in &owned.items {
            assert!(detail(&db, "owner", item.target.clone()).await.is_ok());
            assert!(detail(&db, "other", item.target.clone()).await.is_err());
        }
        assert!(search(&db, "other", audit).await.unwrap().items.is_empty());
        assert!(detail(&db, "other", owned.items[0].target.clone())
            .await
            .is_err());
        for (sequence, content) in [(1, "子任务原始文本"), (2, "子任务最新文本")] {
            let payload = serde_json::json!({"payload":{"agentId":"child","entry":{"id":"entry","role":"assistant","content":content}}});
            sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json) VALUES (?,'s','generation',?,'now','subagent.message',?)")
                .bind(format!("child-{sequence}")).bind(sequence).bind(payload.to_string()).execute(&db).await.unwrap();
        }
        assert!(search(&db, "owner", request("原始文本", None))
            .await
            .unwrap()
            .items
            .is_empty());
        assert_eq!(
            search(&db, "owner", request("最新文本", None))
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        for (sequence, agent, entry) in [(3, "a:b", "c"), (4, "a", "b:c")] {
            let payload = serde_json::json!({"payload":{"agentId":agent,"entry":{"id":entry,"role":"assistant","content":"独立身份条目"}}});
            sqlx::query("INSERT INTO agent_events(event_id,session_id,generation_id,sequence,occurred_at,event_type,payload_json) VALUES (?,'s','generation',?,'now','subagent.message',?)")
                .bind(format!("child-{sequence}")).bind(sequence).bind(payload.to_string()).execute(&db).await.unwrap();
        }
        assert_eq!(
            search(&db, "owner", request("独立身份", None))
                .await
                .unwrap()
                .items
                .len(),
            2
        );
        sqlx::query("DELETE FROM workspaces WHERE id='w2'")
            .execute(&db)
            .await
            .unwrap();
        assert!(search(&db, "main", request("唯一正文", None))
            .await
            .unwrap()
            .items
            .is_empty());
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM process_runs")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 0);
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn migration_backfills_existing_history() {
        let root = std::env::temp_dir().join(format!("aibo-search-upgrade-{}", ulid::Ulid::new()));
        let old = root.join("migrations");
        std::fs::create_dir_all(&old).unwrap();
        for entry in
            std::fs::read_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations"))
                .unwrap()
        {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.split('_').next().unwrap().parse::<u64>().unwrap() <= 50 {
                std::fs::copy(entry.path(), old.join(name)).unwrap();
            }
        }
        let path = root.join("host.db");
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true)
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        sqlx::migrate::Migrator::new(old.as_path())
            .await
            .unwrap()
            .run(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w','/missing','Legacy',0,'before','before')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','before','before')").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO messages(id,session_id,role,content,status,sequence,created_at,updated_at) VALUES ('m','s','assistant','升级之前的中文历史','completed',0,'before','before')").execute(&db).await.unwrap();
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        let result = search(
            &db,
            "main",
            Request {
                query: "中文历史".into(),
                kind: None,
                workspace_id: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].target.id, "m");
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
