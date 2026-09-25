//! Searchable text of persisted attachments and artifacts, retaining host ownership checks.
use crate::{
    global_search::{self, Detail, Page, Request, Target},
    CoreError,
};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};
fn error(message: impl ToString) -> CoreError {
    CoreError::SessionOperation(message.to_string())
}
struct Asset {
    document_id: String,
    title: String,
    root: PathBuf,
    path: PathBuf,
    hash: Option<String>,
    inline: Option<String>,
    text: bool,
}
async fn assets(
    db: &SqlitePool,
    data_dir: &Path,
    workspace: Option<&str>,
    target: Option<&Target>,
) -> Result<Vec<Asset>, CoreError> {
    let rows=sqlx::query("SELECT d.id,d.source,d.title,d.target_id,d.workspace_id,d.session_id,w.path AS root,a.path,a.content_hash AS attachment_hash,a.inline_context,a.media_type AS attachment_type,r.content_hash AS artifact_hash,r.media_type AS artifact_type FROM search_documents d JOIN workspaces w ON w.id=d.workspace_id LEFT JOIN attachments a ON d.source='attachment' AND a.id=d.target_id LEFT JOIN artifacts r ON d.source='artifact' AND r.id=d.target_id WHERE d.source IN ('attachment','artifact') AND (? IS NULL OR d.workspace_id=?) AND (? IS NULL OR (d.source=? AND d.target_id=? AND d.workspace_id IS ? AND d.session_id IS ?))")
        .bind(workspace).bind(workspace).bind(target.map(|target|&target.id)).bind(target.map(|target|&target.source)).bind(target.map(|target|&target.id)).bind(target.and_then(|target|target.workspace_id.as_deref())).bind(target.and_then(|target|target.session_id.as_deref())).fetch_all(db).await?;
    let mut result = vec![];
    for row in rows {
        let source: String = row.get("source");
        let (root, path, hash, mime, inline) = if source == "artifact" {
            let hash: String = row.get("artifact_hash");
            let Some(digest) = hash.strip_prefix("sha256:").filter(|digest| {
                digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            }) else {
                continue;
            };
            (
                data_dir.join("artifacts"),
                PathBuf::from(digest),
                Some(hash),
                row.get::<String, _>("artifact_type"),
                None,
            )
        } else {
            (
                PathBuf::from(row.get::<String, _>("root")),
                PathBuf::from(row.get::<String, _>("path")),
                row.get("attachment_hash"),
                row.get::<String, _>("attachment_type"),
                row.get::<Option<String>, _>("inline_context"),
            )
        };
        let text = mime.starts_with("text/")
            || [
                "application/json",
                "application/xml",
                "application/javascript",
                "application/x-yaml",
            ]
            .contains(&mime.as_str());
        result.push(Asset {
            document_id: row.get("id"),
            title: row.get("title"),
            root,
            path,
            hash,
            inline: if text { inline } else { None },
            text,
        });
    }
    Ok(result)
}
fn read(asset: &Asset) -> Result<(String, bool), CoreError> {
    if !asset.text {
        return Ok(("此附件为非文本内容；可在所属会话查看。".into(), false));
    }
    if let Some(inline) = &asset.inline {
        return Ok((
            crate::artifact::truncate_utf8(inline, 2 * 1024 * 1024, "\n…"),
            inline.len() > 2 * 1024 * 1024,
        ));
    }
    let (content, truncated) = crate::search_files::read_text(&asset.root, &asset.path)?;
    if !truncated
        && asset
            .hash
            .as_ref()
            .is_some_and(|hash| hash != &format!("sha256:{:x}", Sha256::digest(content.as_bytes())))
    {
        return Err(error("内容已变化，与保存的附件不一致"));
    }
    Ok((content, truncated))
}
pub(crate) async fn search(
    db: &SqlitePool,
    data_dir: &Path,
    caller: &str,
    request: Request,
) -> Result<Page, CoreError> {
    global_search::validate(&request)?;
    if request.query.trim().is_empty() && request.kind.is_none() {
        return Ok(Page {
            items: vec![],
            has_more: false,
            warnings: vec![],
        });
    }
    let entries = assets(db, data_dir, request.workspace_id.as_deref(), None).await?;
    let mut warnings = vec![];
    // Content is bounded per asset; only changed text is read and reindexed.
    let started = std::time::Instant::now();
    for asset in entries {
        if started.elapsed().as_secs() >= 15 {
            warnings.push("附件索引仍在更新，请再次搜索以继续".into());
            break;
        }
        if !asset.text {
            continue;
        }
        let metadata = std::fs::metadata(asset.root.join(&asset.path)).ok();
        let signature = format!(
            "{:?}:{:?}:{:?}",
            metadata.as_ref().map(|m| m.len()),
            metadata.and_then(|m| m.modified().ok()),
            asset
                .inline
                .as_ref()
                .map(|text| format!("{:x}", Sha256::digest(text.as_bytes())))
        );
        let known: Option<String> =
            sqlx::query_scalar("SELECT signature FROM search_file_state WHERE document_id=?")
                .bind(&asset.document_id)
                .fetch_optional(db)
                .await?;
        if known.as_deref() == Some(signature.as_str()) {
            continue;
        }
        let id = asset.document_id.clone();
        let title = asset.title.clone();
        let read = tauri::async_runtime::spawn_blocking(move || read(&asset))
            .await
            .map_err(error)?;
        let body = match read {
            Ok((body, truncated)) => {
                if truncated {
                    warnings.push(format!("{title}：仅索引前 2 MiB"));
                }
                body
            }
            Err(reason) => {
                warnings.push(format!("{title}：{reason}"));
                String::new()
            }
        };
        let mut tx = db.begin().await?;
        let changed = sqlx::query("UPDATE search_documents SET body=? WHERE id=?")
            .bind(body)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        if changed.rows_affected() > 0 {
            sqlx::query("INSERT INTO search_file_state(document_id,signature) VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET signature=excluded.signature").bind(&id).bind(signature).execute(&mut *tx).await?;
        }
        tx.commit().await?;
    }
    let mut result = Page {
        items: vec![],
        has_more: false,
        warnings,
    };
    for kind in ["attachment", "artifact"] {
        if request.kind.as_deref().is_some_and(|value| value != kind) {
            continue;
        }
        let mut scoped = request.clone();
        scoped.kind = Some(kind.into());
        let page = global_search::search(db, caller, scoped).await?;
        result.items.extend(page.items);
        result.has_more |= page.has_more;
    }
    Ok(result)
}
pub(crate) async fn detail(
    db: &SqlitePool,
    data_dir: &Path,
    target: Target,
) -> Result<Detail, CoreError> {
    let asset = assets(db, data_dir, None, Some(&target))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| error("附件已移除或不属于此会话"))?;
    let title = asset.title.clone();
    let (content, truncated) = tauri::async_runtime::spawn_blocking(move || read(&asset))
        .await
        .map_err(error)??;
    Ok(Detail {
        title,
        content,
        target,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn indexes_owned_artifact_text_and_invalidates_deleted_and_modified_attachments() {
        let root = std::env::temp_dir().join(format!("aibo-search-assets-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w',?,'Workspace',0,'now','now')").bind(root.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('s','w','disabled','Session','closed','now','now')").execute(&db).await.unwrap();
        let id = crate::artifact::persist_text(
            &db,
            &root,
            "w",
            "s",
            None,
            "report",
            "text/plain",
            "产物中的独有关键词",
        )
        .await
        .unwrap();
        std::fs::write(root.join("note.txt"), "附件中的独有文本").unwrap();
        sqlx::query("INSERT INTO attachments(id,workspace_id,session_id,path,media_type,source,send_strategy,created_at) VALUES ('a','w','s','note.txt','text/plain','picker','reference','now')").execute(&db).await.unwrap();
        let request = |query: &str| Request {
            query: query.into(),
            kind: None,
            workspace_id: None,
            limit: 50,
        };
        let page = search(&db, &root, "main", request("独有关键词"))
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].target.id, id);
        assert!(detail(&db, &root, page.items[0].target.clone())
            .await
            .unwrap()
            .content
            .contains("产物"));
        let mut wrong = page.items[0].target.clone();
        wrong.session_id = Some("other".into());
        assert!(detail(&db, &root, wrong).await.is_err());
        assert_eq!(
            search(&db, &root, "main", request("独有文本"))
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        std::fs::write(root.join("note.txt"), "附件更新后全新文本内容").unwrap();
        assert!(search(&db, &root, "main", request("独有文本"))
            .await
            .unwrap()
            .items
            .is_empty());
        assert_eq!(
            search(&db, &root, "main", request("全新文本"))
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        sqlx::query("DELETE FROM attachments WHERE id='a'")
            .execute(&db)
            .await
            .unwrap();
        assert!(search(&db, &root, "main", request("全新文本"))
            .await
            .unwrap()
            .items
            .is_empty());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
