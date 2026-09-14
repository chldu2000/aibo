//! Trusted P1 read-only semantic Git gateway. No Agent session or plugin runtime.
use crate::{workspace_by_id, workspace_changes, workspace_file_diff};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const CONTRIBUTION: &str = "dev.aibo.git.changes";
const PAGE_SIZE: usize = 50;
const MAX_ITEMS: usize = 10_000;
const MAX_INSTANCES: usize = 128;
const TTL: Duration = Duration::from_secs(1800);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub workspace_id: String,
    pub contribution_id: String,
    pub generation: String,
    pub revision: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Action {
    pub context: Context,
    pub action_id: String,
    #[serde(deserialize_with = "required_nullable_string")]
    pub item_id: Option<String>,
}
fn required_nullable_string<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    path: String,
    previous_path: Option<String>,
    status: String,
    staged: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    item_id: String,
    path: String,
    staged: bool,
    content: String,
    truncated: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub context: Context,
    status: String,
    message: String,
    items: Vec<Item>,
    offset: usize,
    total: usize,
    truncated: bool,
    detail: Option<Detail>,
}
struct Instance {
    owner: String,
    context: Context,
    items: Vec<Item>,
    offset: usize,
    detail: Option<Detail>,
    touched: Instant,
    truncated: bool,
    status: String,
    message: String,
}
#[derive(Clone, Default)]
pub struct GitPresentation {
    instances: Arc<Mutex<HashMap<String, Arc<Mutex<Instance>>>>>,
}

impl Instance {
    fn page(&self) -> Page {
        Page {
            context: self.context.clone(),
            status: self.status.clone(),
            message: self.message.clone(),
            items: self
                .items
                .iter()
                .skip(self.offset)
                .take(PAGE_SIZE)
                .cloned()
                .collect(),
            offset: self.offset,
            total: self.items.len(),
            truncated: self.truncated,
            detail: self.detail.clone(),
        }
    }
    fn validate(&self, owner: &str, action: &Action) -> Result<(), String> {
        if action.context.workspace_id.len() > 128
            || action.context.generation.len() > 128
            || action.item_id.as_ref().is_some_and(|id| id.len() > 8192)
        {
            return Err("invalid_input: field limit".into());
        }
        if self.owner != owner {
            return Err("permission_denied: presentation owner".into());
        }
        if self.context != action.context || self.touched.elapsed() > TTL {
            return Err("stale_context: refresh required".into());
        }
        if action.action_id != "open-diff" && action.item_id.is_some() {
            return Err("invalid_input: unexpected item".into());
        }
        Ok(())
    }
}

impl GitPresentation {
    async fn capture(
        db: &SqlitePool,
        workspace_id: &str,
        instance: &mut Instance,
    ) -> Result<(), String> {
        let workspace = workspace_by_id(db, workspace_id)
            .await
            .map_err(|_| "invalid_workspace")?;
        // Match the existing workspace read API: registered roots may be read even before write trust.
        let changes = workspace_changes(std::path::Path::new(&workspace.path)).await?;
        let mut items = Vec::new();
        let mut truncated = false;
        for file in changes.files {
            for staged in [true, false] {
                if (staged && !file.staged)
                    || (!staged && !(file.unstaged || file.untracked || file.conflicted))
                {
                    continue;
                }
                if items.len() == MAX_ITEMS {
                    truncated = true;
                    break;
                }
                if file.path.len() > 4000
                    || file.previous_path.as_ref().is_some_and(|p| p.len() > 4000)
                {
                    return Err("resource_limit: file path".into());
                }
                let status = if file.conflicted {
                    "conflicted"
                } else if file.untracked {
                    "untracked"
                } else {
                    file.kind
                };
                items.push(Item {
                    id: format!(
                        "{}:{}",
                        if staged { "index" } else { "worktree" },
                        file.path
                    ),
                    path: file.path.clone(),
                    previous_path: file.previous_path.clone(),
                    status: status.to_owned(),
                    staged,
                });
            }
            if truncated {
                break;
            }
        }
        instance.status = match changes.capture_status {
            "unsupported" => "unavailable",
            "failed" => "error",
            _ if items.is_empty() => "empty",
            _ => "ready",
        }
        .into();
        instance.message = changes.capture_error.unwrap_or_else(|| {
            if items.is_empty() {
                "没有工作区变更".into()
            } else {
                String::new()
            }
        });
        items.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| right.staged.cmp(&left.staged))
        });
        instance.items = items;
        instance.truncated = truncated;
        instance.offset = 0;
        instance.detail = None;
        Ok(())
    }
    pub async fn open(
        &self,
        db: &SqlitePool,
        owner: &str,
        workspace_id: &str,
    ) -> Result<Page, String> {
        let mut instance = Instance {
            owner: owner.into(),
            context: Context {
                workspace_id: workspace_id.into(),
                contribution_id: CONTRIBUTION.into(),
                generation: ulid::Ulid::new().to_string(),
                revision: 1,
            },
            items: vec![],
            offset: 0,
            detail: None,
            touched: Instant::now(),
            truncated: false,
            status: "empty".into(),
            message: String::new(),
        };
        Self::capture(db, workspace_id, &mut instance).await?;
        let mut instances = self.instances.lock().await;
        // Keep active calls; expired idle leases may be collected without awaiting their lock.
        instances.retain(|_, value| {
            value
                .try_lock()
                .map(|entry| entry.touched.elapsed() <= TTL)
                .unwrap_or(true)
        });
        if instances.len() >= MAX_INSTANCES {
            return Err("busy: presentation instance limit".into());
        }
        let page = instance.page();
        instances.insert(
            instance.context.generation.clone(),
            Arc::new(Mutex::new(instance)),
        );
        Ok(page)
    }
    pub async fn act(&self, db: &SqlitePool, owner: &str, action: Action) -> Result<Page, String> {
        let entry = self
            .instances
            .lock()
            .await
            .get(&action.context.generation)
            .cloned()
            .ok_or("stale_context: unknown generation")?;
        let mut instance = entry.lock().await;
        instance.validate(owner, &action)?;
        // Re-resolve identity on every action; a removed workspace never retains access via a lease.
        let workspace = workspace_by_id(db, &instance.context.workspace_id)
            .await
            .map_err(|_| "invalid_workspace")?;
        match action.action_id.as_str() {
            "refresh" => {
                let id = instance.context.workspace_id.clone();
                Self::capture(db, &id, &mut instance).await?;
            }
            "open-diff" => {
                if instance.detail.is_some() || instance.status != "ready" {
                    return Err("unsupported: cannot inspect current view".into());
                }
                let item = instance
                    .items
                    .iter()
                    .skip(instance.offset)
                    .take(PAGE_SIZE)
                    .find(|item| Some(&item.id) == action.item_id.as_ref())
                    .cloned()
                    .ok_or("invalid_selection")?;
                let root = workspace.path;
                let path = item.path.clone();
                let staged = item.staged;
                // Read the latest file content, with the existing canonical-root and output limit checks.
                let diff =
                    tokio::task::spawn_blocking(move || workspace_file_diff(&root, &path, staged))
                        .await
                        .map_err(|_| "provider_unavailable: Git task")?
                        .map_err(|error| error.to_string())?;
                instance.status = if diff.available {
                    "ready"
                } else {
                    "unavailable"
                }
                .into();
                instance.message = diff.reason.unwrap_or_default();
                instance.detail = Some(Detail {
                    item_id: item.id,
                    path: item.path,
                    staged,
                    content: diff.diff,
                    truncated: diff.truncated,
                });
            }
            "back" if instance.detail.is_some() => {
                instance.detail = None;
                instance.status = if instance.items.is_empty() {
                    "empty"
                } else {
                    "ready"
                }
                .into();
                instance.message.clear();
            }
            "next"
                if instance.detail.is_none()
                    && instance.offset + PAGE_SIZE < instance.items.len() =>
            {
                instance.offset += PAGE_SIZE
            }
            "previous" if instance.detail.is_none() && instance.offset > 0 => {
                instance.offset = instance.offset.saturating_sub(PAGE_SIZE)
            }
            _ => return Err("unsupported: undeclared or disabled action".into()),
        }
        instance.context.revision += 1;
        instance.touched = Instant::now();
        Ok(instance.page())
    }
    pub async fn release(&self, owner: &str, generation: &str) -> Result<(), String> {
        let mut instances = self.instances.lock().await;
        if let Some(entry) = instances.get(generation) {
            if entry.lock().await.owner != owner {
                return Err("permission_denied: presentation owner".into());
            }
        }
        instances.remove(generation);
        Ok(())
    }
}

#[tauri::command]
pub async fn open_semantic_git(
    workspace_id: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Page, String> {
    state
        .semantic_git
        .open(&state.db, window.label(), &workspace_id)
        .await
}
#[tauri::command]
pub async fn act_semantic_git(
    action: Action,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Page, String> {
    state
        .semantic_git
        .act(&state.db, window.label(), action)
        .await
}
#[tauri::command]
pub async fn release_semantic_git(
    generation: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state
        .semantic_git
        .release(window.label(), &generation)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    async fn setup() -> (std::path::PathBuf, SqlitePool, GitPresentation) {
        let root = std::env::temp_dir().join(format!("aibo-semantic-git-{}", ulid::Ulid::new()));
        fs::create_dir_all(root.join("workspace")).unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(root.join("workspace"))
            .status()
            .unwrap()
            .success());
        fs::write(root.join("workspace/one.txt"), "hello\n").unwrap();
        let db = crate::open_database(&root.join("data/aibo.sqlite3"))
            .await
            .unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('workspace',?,'fixture',0,?,?)")
            .bind(root.join("workspace").to_string_lossy().as_ref()).bind(crate::now_iso()).bind(crate::now_iso()).execute(&db).await.unwrap();
        (root, db, GitPresentation::default())
    }
    fn action(page: &Page, id: &str, item: Option<String>) -> Action {
        Action {
            context: page.context.clone(),
            action_id: id.into(),
            item_id: item,
        }
    }
    #[test]
    fn semantic_contract_fixtures_and_action_envelopes_are_strict() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../contracts/semantic-view.experimental-v1.schema.json"
        ))
        .unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        for source in [
            include_str!("../../fixtures/semantic-git/collection.json"),
            include_str!("../../fixtures/semantic-git/detail.json"),
            include_str!("../../fixtures/semantic-git/empty.json"),
            include_str!("../../fixtures/semantic-git/error.json"),
            include_str!("../../fixtures/semantic-git/loading.json"),
            include_str!("../../fixtures/semantic-git/unavailable.json"),
            include_str!("../../fixtures/semantic-git/partial.json"),
            include_str!("../../fixtures/semantic-git/partial-detail.json"),
        ] {
            assert!(validator.is_valid(&serde_json::from_str::<serde_json::Value>(source).unwrap()));
        }
        let snapshot: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/semantic-git/collection.json"))
                .unwrap();
        let mut message =
            serde_json::json!({"context":snapshot["context"],"actionId":"refresh","itemId":null});
        assert!(serde_json::from_value::<Action>(message.clone()).is_ok());
        message["caller"] = serde_json::json!("another-window");
        assert!(serde_json::from_value::<Action>(message.clone()).is_err());
        message.as_object_mut().unwrap().remove("caller");
        message.as_object_mut().unwrap().remove("itemId");
        assert!(serde_json::from_value::<Action>(message).is_err());
    }
    #[tokio::test]
    async fn large_diff_is_marked_partial_and_symlink_retarget_is_rejected() {
        let (root, db, host) = setup().await;
        fs::write(
            root.join("workspace/one.txt"),
            "large line\n".repeat(30_000),
        )
        .unwrap();
        assert!(Command::new("git")
            .arg("-C")
            .arg(root.join("workspace"))
            .args(["add", "--", "one.txt"])
            .status()
            .unwrap()
            .success());
        let page = host.open(&db, "main", "workspace").await.unwrap();
        let detail = host
            .act(
                &db,
                "main",
                action(&page, "open-diff", Some(page.items[0].id.clone())),
            )
            .await
            .unwrap();
        assert!(detail.detail.as_ref().unwrap().truncated);
        assert!(detail.detail.as_ref().unwrap().content.len() <= 210_000);
        #[cfg(unix)]
        {
            let back = host
                .act(&db, "main", action(&detail, "back", None))
                .await
                .unwrap();
            fs::write(root.join("outside.txt"), "outside-secret").unwrap();
            fs::remove_file(root.join("workspace/one.txt")).unwrap();
            std::os::unix::fs::symlink(root.join("outside.txt"), root.join("workspace/one.txt"))
                .unwrap();
            assert!(host
                .act(
                    &db,
                    "main",
                    action(&back, "open-diff", Some(page.items[0].id.clone()))
                )
                .await
                .is_err());
        }
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn workspace_reads_need_no_agent_and_reject_forged_or_stale_actions() {
        let (root, db, host) = setup().await;
        let page = host.open(&db, "main", "workspace").await.unwrap();
        assert_eq!(page.total, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 0);
        let inspect = action(&page, "open-diff", Some(page.items[0].id.clone()));
        assert!(host
            .act(&db, "other-window", inspect.clone())
            .await
            .unwrap_err()
            .contains("permission_denied"));
        let mut forged = inspect.clone();
        forged.context.workspace_id = "other-workspace".into();
        assert!(host.act(&db, "main", forged).await.is_err());
        let mut forged = inspect.clone();
        forged.context.generation = "old-generation".into();
        assert!(host.act(&db, "main", forged).await.is_err());
        assert!(host
            .act(
                &db,
                "main",
                action(&page, "open-diff", Some("../../outside".into()))
            )
            .await
            .is_err());
        assert!(host
            .act(&db, "main", action(&page, "commit", None))
            .await
            .is_err());
        let detail = host.act(&db, "main", inspect.clone()).await.unwrap();
        assert!(detail.detail.as_ref().unwrap().content.contains("hello"));
        assert!(host
            .act(&db, "main", inspect)
            .await
            .unwrap_err()
            .contains("stale_context"));
        let back = host
            .act(&db, "main", action(&detail, "back", None))
            .await
            .unwrap();
        assert!(back.detail.is_none());
        host.release("main", &back.context.generation)
            .await
            .unwrap();
        assert!(host
            .act(&db, "main", action(&back, "refresh", None))
            .await
            .is_err());
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn pagination_refresh_and_removed_workspace_are_checked() {
        let (root, db, host) = setup().await;
        for n in 0..55 {
            fs::write(root.join(format!("workspace/file-{n}.txt")), "file\n").unwrap();
        }
        let page = host.open(&db, "main", "workspace").await.unwrap();
        assert_eq!(page.items.len(), 50);
        assert_eq!(page.total, 56);
        assert!(host
            .act(&db, "main", action(&page, "previous", None))
            .await
            .is_err());
        let next = host
            .act(&db, "main", action(&page, "next", None))
            .await
            .unwrap();
        assert_eq!(next.items.len(), 6);
        assert_eq!(next.offset, 50);
        let refreshed = host
            .act(&db, "main", action(&next, "refresh", None))
            .await
            .unwrap();
        assert_eq!(refreshed.offset, 0);
        sqlx::query("DELETE FROM workspaces WHERE id='workspace'")
            .execute(&db)
            .await
            .unwrap();
        assert!(host
            .act(&db, "main", action(&refreshed, "refresh", None))
            .await
            .unwrap_err()
            .contains("invalid_workspace"));
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn expired_instance_and_missing_file_do_not_retarget() {
        let (root, db, host) = setup().await;
        let page = host.open(&db, "main", "workspace").await.unwrap();
        fs::remove_file(root.join("workspace/one.txt")).unwrap();
        let detail = host
            .act(
                &db,
                "main",
                action(&page, "open-diff", Some(page.items[0].id.clone())),
            )
            .await;
        // Existing Git diff policy may return unavailable or a path error; neither may inspect another file.
        if let Ok(detail) = detail {
            assert_eq!(detail.detail.unwrap().path, "one.txt");
        }
        let entry = host
            .instances
            .lock()
            .await
            .get(&page.context.generation)
            .cloned()
            .unwrap();
        entry.lock().await.touched = Instant::now() - TTL - Duration::from_secs(1);
        let context = entry.lock().await.context.clone();
        assert!(host
            .act(
                &db,
                "main",
                Action {
                    context,
                    action_id: "refresh".into(),
                    item_id: None
                }
            )
            .await
            .unwrap_err()
            .contains("stale_context"));
        db.close().await;
        fs::remove_dir_all(root).unwrap();
    }
}
