//! Incremental local file projection. Walks ignore-aware paths off the async executor.
use crate::{
    global_search::{self, Detail, Page, Request, Target},
    CoreError,
};
use sqlx::{Row, SqlitePool};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Instant, UNIX_EPOCH},
};
const MAX_FILES: usize = 50_000;
static REQUESTS: OnceLock<Mutex<HashMap<String, Arc<AtomicU64>>>> = OnceLock::new();
fn counter(caller: &str) -> Arc<AtomicU64> {
    let mut requests = REQUESTS.get_or_init(Default::default).lock().unwrap();
    if requests.len() > 1024 {
        if let Some(key) = requests
            .iter()
            .find(|(_, value)| Arc::strong_count(value) == 1)
            .map(|(key, _)| key.clone())
        {
            requests.remove(&key);
        }
    }
    requests.entry(caller.to_owned()).or_default().clone()
}
pub(crate) fn cancel(caller: &str) {
    counter(caller).fetch_add(1, Ordering::SeqCst);
}
fn error(message: impl ToString) -> CoreError {
    CoreError::SessionOperation(message.to_string())
}

pub(crate) use crate::text_preview::read_text;
use crate::text_preview::MAX_TEXT;

struct Changed {
    id: String,
    path: String,
    signature: String,
    content: String,
}
struct Scan {
    seen: HashSet<String>,
    changes: Vec<Changed>,
    complete: bool,
    warnings: Vec<crate::ui_i18n::HostMessage>,
}
fn scan(
    root: PathBuf,
    workspace: String,
    known: HashMap<String, String>,
    sequence: Arc<AtomicU64>,
    revision: u64,
    max_files: usize,
) -> Result<Scan, CoreError> {
    let root = std::fs::canonicalize(root).map_err(error)?;
    let mut builder = ignore::WalkBuilder::new(&root);
    builder
        .hidden(false)
        .require_git(false)
        .follow_links(false)
        .max_depth(Some(64))
        .filter_entry(|entry| {
            !entry.file_type().is_some_and(|kind| kind.is_dir())
                || !matches!(
                    entry.file_name().to_str(),
                    Some(
                        ".git"
                            | ".aibo"
                            | "node_modules"
                            | "target"
                            | "dist"
                            | "build"
                            | ".next"
                            | ".cache"
                    )
                )
        });
    let mut scan = Scan {
        seen: HashSet::new(),
        changes: vec![],
        complete: true,
        warnings: vec![],
    };
    let started = Instant::now();
    let mut bytes = 0usize;
    for entry in builder.build() {
        if sequence.load(Ordering::SeqCst) != revision {
            return Err(crate::ui_i18n::read_error("native.search.cancelled",serde_json::json!({})));
        }
        if scan.seen.len() >= max_files || started.elapsed().as_secs() >= 15 {
            scan.complete = false;
            scan.warnings
                .push(crate::ui_i18n::HostMessage::new("native.search.directoryLimit",serde_json::json!({})));
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                scan.complete = false;
                continue;
            }
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(&root)
            .map_err(error)?
            .to_string_lossy()
            .replace('\\', "/");
        let id = format!("file:{workspace}:{path}");
        scan.seen.insert(id.clone());
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => {
                scan.complete = false;
                continue;
            }
        };
        let signature = format!(
            "{}:{}",
            metadata.len(),
            metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        );
        if known.get(&id) == Some(&signature) {
            continue;
        }
        let deferred = metadata.len() <= MAX_TEXT && bytes >= 64 * 1024 * 1024;
        let content = if metadata.len() <= MAX_TEXT && !deferred {
            match read_text(&root, Path::new(&path)) {
                Ok((text, _)) => {
                    bytes += text.len();
                    text
                }
                Err(_) => String::new(),
            }
        } else {
            String::new()
        };
        scan.changes.push(Changed {
            id,
            path,
            signature: if deferred { String::new() } else { signature },
            content,
        });
    }
    if !scan.complete && scan.warnings.is_empty() {
        scan.warnings
            .push(crate::ui_i18n::HostMessage::new("native.search.directoryUnreadable",serde_json::json!({})));
    }
    if bytes >= 64 * 1024 * 1024 {
        scan.warnings
            .push(crate::ui_i18n::HostMessage::new("native.search.indexBudget",serde_json::json!({})));
    }
    Ok(scan)
}
pub(crate) async fn search(
    db: &SqlitePool,
    caller: &str,
    request_key: &str,
    mut request: Request,
) -> Result<Page, CoreError> {
    global_search::validate(&request)?;
    if request.kind.as_deref().is_some_and(|kind| kind != "file") {
        return Ok(Page {
            items: vec![],
            has_more: false,
            warnings: vec![],
            localized_warnings: None,
        });
    }
    if request.query.trim().is_empty() {
        request.kind = Some("file".into());
        return global_search::search(db, caller, request).await;
    }
    let sequence = counter(request_key);
    let revision = 0;
    if sequence.load(Ordering::SeqCst) != revision {
        return Err(crate::ui_i18n::read_error("native.search.cancelled",serde_json::json!({})));
    }
    let workspaces = sqlx::query("SELECT id,path,label FROM workspaces WHERE ? IS NULL OR id=?")
        .bind(&request.workspace_id)
        .bind(&request.workspace_id)
        .fetch_all(db)
        .await?;
    let mut warnings = vec![];
    for workspace in workspaces {
        let id: String = workspace.get("id");
        let root: PathBuf = PathBuf::from(workspace.get::<String, _>("path"));
        let label: String = workspace.get("label");
        let rows=sqlx::query("SELECT f.document_id,f.signature FROM search_file_state f JOIN search_documents d ON d.id=f.document_id WHERE d.workspace_id=?").bind(&id).fetch_all(db).await?;
        let known = rows
            .iter()
            .map(|row| (row.get("document_id"), row.get("signature")))
            .collect();
        let workspace_id = id.clone();
        let current = sequence.clone();
        let scanned = tauri::async_runtime::spawn_blocking(move || {
            scan(root, workspace_id, known, current, revision, MAX_FILES)
        })
        .await
        .map_err(error)?;
        if sequence.load(Ordering::SeqCst) != revision {
            return Err(crate::ui_i18n::read_error("native.search.cancelled",serde_json::json!({})));
        }
        let scan = match scanned {
            Ok(scan) => scan,
            Err(reason) => {
                warnings.push(crate::ui_i18n::named_read_warning(&label, &reason));
                continue;
            }
        };
        let mut tx = db.begin().await?;
        // Revalidate after the off-thread walk: a deleted workspace must not be resurrected.
        if sqlx::query_scalar::<_, i64>("SELECT count(*) FROM workspaces WHERE id=?")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?
            == 0
        {
            continue;
        }
        for change in scan.changes {
            if sequence.load(Ordering::SeqCst) != revision {
                return Err(crate::ui_i18n::read_error("native.search.cancelled",serde_json::json!({})));
            }
            sqlx::query("INSERT INTO search_documents(id,kind,source,target_id,workspace_id,title,body,updated_at) VALUES (?,'file','file',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at")
                .bind(&change.id).bind(&change.path).bind(&id).bind(&change.path).bind(&change.content).bind(crate::now_iso()).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO search_file_state(document_id,signature) VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET signature=excluded.signature").bind(&change.id).bind(&change.signature).execute(&mut *tx).await?;
        }
        if scan.complete {
            for row in rows {
                let document_id: String = row.get("document_id");
                if !scan.seen.contains(&document_id) {
                    sqlx::query("DELETE FROM search_documents WHERE id=?")
                        .bind(document_id)
                        .execute(&mut *tx)
                        .await?;
                }
            }
        }
        tx.commit().await?;
        warnings.extend(
            scan.warnings
                .into_iter()
                .map(|warning| crate::ui_i18n::HostMessage::new("native.search.namedWarning",serde_json::json!({"name":label,"warning":warning.localized.unwrap_or(serde_json::json!(warning.diagnostic))}))),
        );
    }
    request.kind = Some("file".into());
    let mut page = global_search::search(db, caller, request).await?;
    page.localized_warnings = Some(warnings.iter().map(|warning|warning.localized.clone().unwrap_or(serde_json::Value::Null)).collect());
    page.warnings = warnings.into_iter().map(|warning|warning.diagnostic).collect();
    Ok(page)
}
pub(crate) async fn detail(db: &SqlitePool, target: Target) -> Result<Detail, CoreError> {
    let workspace = target
        .workspace_id
        .as_deref()
        .ok_or_else(|| crate::ui_i18n::read_error("native.search.workspaceMissing",serde_json::json!({})))?;
    let root: String = sqlx::query_scalar("SELECT path FROM workspaces WHERE id=?")
        .bind(workspace)
        .fetch_one(db)
        .await?;
    let relative = target.id.clone();
    let title = relative.clone();
    let (content, truncated) = tauri::async_runtime::spawn_blocking(move || {
        read_text(Path::new(&root), Path::new(&relative))
    })
    .await
    .map_err(error)??;
    Ok(Detail {
        localized_suffix: None,
        title,
        content,
        localized_content: None,
        target,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_walk_warns_in_both_languages_without_claiming_a_complete_index() {
        let root = std::env::temp_dir().join(format!("aibo-search-budget-{}",ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("原文{path}.txt"),"用户正文").unwrap();
        std::fs::write(root.join("other.txt"),"another file").unwrap();
        let scan = scan(root.clone(),"w".into(),HashMap::new(),Arc::new(AtomicU64::new(0)),0,1).unwrap();
        assert!(!scan.complete);assert_eq!(scan.seen.len(),1);assert_eq!(scan.changes.len(),1);
        let warning = &scan.warnings[0];assert_eq!(warning.diagnostic,"目录过大，文件索引尚未覆盖全部内容；请缩小工作区范围");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,warning.localized.as_ref().unwrap()),"The directory is too large to index completely. Narrow the workspace scope.");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn file_index_respects_ignore_refresh_delete_unicode_and_workspace_boundary() {
        let directory =
            std::env::temp_dir().join(format!("aibo-search-files-{}", ulid::Ulid::new()));
        let root = directory.join("workspace");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(root.join("ignored.txt"), "不可被索引的秘密").unwrap();
        std::fs::write(
            root.join("src/中文文件.txt"),
            "first line\n唯一中文正文\nlast line",
        )
        .unwrap();
        std::fs::write(directory.join("outside.txt"), "不可被索引的秘密").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(directory.join("outside.txt"), root.join("escape.txt")).unwrap();
        let db = crate::open_database(&directory.join("host.db"))
            .await
            .unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES ('w',?,'Files',0,'now','now')").bind(root.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        let request = |query: &str| Request {
            query: query.into(),
            kind: Some("file".into()),
            workspace_id: None,
            limit: 50,
        };
        cancel("cancelled-file-request");
        assert!(search(
            &db,
            "file-test",
            "cancelled-file-request",
            request("唯一中文")
        )
        .await
        .is_err());
        let page = search(&db, "file-test", "file-test-request", request("唯一中文"))
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].target.line, Some(2));
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::En,page.items[0].localized_description.as_ref().unwrap()),"Files · Line 2");
        assert_eq!(crate::ui_i18n::render(crate::ui_i18n::Locale::ZhCn,page.items[0].localized_description.as_ref().unwrap()),page.items[0].description);
        let preview = detail(&db, page.items[0].target.clone()).await.unwrap();
        assert!(preview.content.contains("唯一中文"));
        assert!(
            search(&db, "file-test", "file-test-request", request("不可被索引"))
                .await
                .unwrap()
                .items
                .is_empty()
        );
        let mut escape = page.items[0].target.clone();
        escape.id = "../outside.txt".into();
        assert!(detail(&db, escape).await.is_err());
        std::fs::write(root.join("src/中文文件.txt"), "替换成新的内容").unwrap();
        assert!(
            search(&db, "file-test", "file-test-request", request("唯一中文"))
                .await
                .unwrap()
                .items
                .is_empty()
        );
        assert_eq!(
            search(&db, "file-test", "file-test-request", request("新的内容"))
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        std::fs::remove_file(root.join("src/中文文件.txt")).unwrap();
        assert!(
            search(&db, "file-test", "file-test-request", request("新的内容"))
                .await
                .unwrap()
                .items
                .is_empty()
        );
        db.close().await;
        std::fs::remove_dir_all(directory).unwrap();
    }
}
