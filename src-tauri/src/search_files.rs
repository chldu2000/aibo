//! Incremental local file projection. Walks ignore-aware paths off the async executor.
use crate::{
    global_search::{self, Detail, Page, Request, Target},
    CoreError,
};
use sqlx::{Row, SqlitePool};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Instant, UNIX_EPOCH},
};
const MAX_TEXT: u64 = 2 * 1024 * 1024;
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

pub(crate) fn read_text(root: &Path, relative: &Path) -> Result<(String, bool), CoreError> {
    let path = crate::workspace_guard::canonicalize_target(root, relative).map_err(error)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(error)?;
    if !file.metadata().map_err(error)?.is_file() {
        return Err(error("此路径不是普通文件"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    let truncated = bytes.len() as u64 > MAX_TEXT;
    if bytes.contains(&0) {
        return Err(error("二进制文件不提供文本预览"));
    }
    if truncated {
        bytes.truncate(MAX_TEXT as usize);
        while std::str::from_utf8(&bytes).is_err() && bytes.len() > MAX_TEXT as usize - 4 {
            bytes.pop();
        }
    }
    let text = String::from_utf8(bytes).map_err(|_| error("文件不是 UTF-8 文本"))?;
    Ok((text, truncated))
}
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
    warnings: Vec<String>,
}
fn scan(
    root: PathBuf,
    workspace: String,
    known: HashMap<String, String>,
    sequence: Arc<AtomicU64>,
    revision: u64,
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
            return Err(error("搜索已取消"));
        }
        if scan.seen.len() >= MAX_FILES || started.elapsed().as_secs() >= 15 {
            scan.complete = false;
            scan.warnings
                .push("目录过大，文件索引尚未覆盖全部内容；请缩小工作区范围".into());
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
            .push("部分目录无法读取，文件结果可能不完整".into());
    }
    if bytes >= 64 * 1024 * 1024 {
        scan.warnings
            .push("本次文本索引达到 64 MiB；其余文件可按名称搜索".into());
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
        });
    }
    if request.query.trim().is_empty() {
        request.kind = Some("file".into());
        return global_search::search(db, caller, request).await;
    }
    let sequence = counter(request_key);
    let revision = 0;
    if sequence.load(Ordering::SeqCst) != revision {
        return Err(error("搜索已取消"));
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
            scan(root, workspace_id, known, current, revision)
        })
        .await
        .map_err(error)?;
        if sequence.load(Ordering::SeqCst) != revision {
            return Err(error("搜索已取消"));
        }
        let scan = match scanned {
            Ok(scan) => scan,
            Err(reason) => {
                warnings.push(format!("{label}：{reason}"));
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
                return Err(error("搜索已取消"));
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
                .map(|warning| format!("{label}：{warning}")),
        );
    }
    request.kind = Some("file".into());
    let mut page = global_search::search(db, caller, request).await?;
    page.warnings = warnings;
    Ok(page)
}
pub(crate) async fn detail(db: &SqlitePool, target: Target) -> Result<Detail, CoreError> {
    let workspace = target
        .workspace_id
        .as_deref()
        .ok_or_else(|| error("缺少工作区"))?;
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
