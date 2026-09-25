//! Host-owned preferences for UI operations, separate from Agent execution permissions.
use crate::CoreError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{collections::BTreeMap, future::Future};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Category { Git, ProjectAction, TurnRestore, CapabilityWrite, ViewWrite }

impl Category {
    fn key(self) -> &'static str {
        match self {
            Self::Git => "git", Self::ProjectAction => "projectAction", Self::TurnRestore => "turnRestore",
            Self::CapabilityWrite => "capabilityWrite", Self::ViewWrite => "viewWrite",
        }
    }
    pub(crate) fn title(self) -> &'static str {
        match self {
            Self::Git => "Aibo · 确认 Git 写入", Self::ProjectAction => "Aibo · 确认工程动作",
            Self::TurnRestore => "Aibo · 确认恢复本轮变更", Self::CapabilityWrite => "Aibo · 确认能力写入",
            Self::ViewWrite => "Aibo · 确认视图写入",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Policy { AlwaysAllow, Ask }

impl Policy {
    fn key(self) -> &'static str { match self { Self::AlwaysAllow => "always-allow", Self::Ask => "ask" } }
    fn parse(value: &str) -> Result<Self, CoreError> {
        match value {
            "always-allow" => Ok(Self::AlwaysAllow), "ask" => Ok(Self::Ask),
            _ => Err(CoreError::Initialization("Invalid host confirmation policy".into())),
        }
    }
}

pub(crate) async fn read(db: &SqlitePool) -> Result<BTreeMap<String, Policy>, CoreError> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT category, policy FROM host_confirmation_preferences").fetch_all(db).await?;
    rows.into_iter().map(|(key, value)| Ok((key, Policy::parse(&value)?))).collect()
}

pub(crate) async fn save(db: &SqlitePool, category: Category, policy: Policy) -> Result<BTreeMap<String, Policy>, CoreError> {
    // Update only this category, so another window's unrelated setting is preserved.
    let changed = sqlx::query("UPDATE host_confirmation_preferences SET policy=? WHERE category=?")
        .bind(policy.key()).bind(category.key()).execute(db).await?.rows_affected();
    if changed != 1 { return Err(CoreError::Initialization("Host confirmation preference is missing".into())); }
    read(db).await
}

pub(crate) async fn confirm<F, Fut>(db: &SqlitePool, category: Category, prompt: F) -> Result<bool, String>
where F: FnOnce() -> Fut, Fut: Future<Output = Result<bool, String>> {
    // Read at execution time; UI caches and plugin inputs cannot grant permission.
    let value: String = sqlx::query_scalar("SELECT policy FROM host_confirmation_preferences WHERE category=?")
        .bind(category.key()).fetch_one(db).await.map_err(|_| "confirmation_unavailable: 无法读取宿主操作确认设置".to_owned())?;
    match Policy::parse(&value).map_err(|_| "confirmation_unavailable: 无效的宿主操作确认设置".to_owned())? {
        Policy::AlwaysAllow => Ok(true),
        Policy::Ask => prompt().await,
    }
}

#[tauri::command]
pub(crate) async fn read_host_confirmation_preferences(state: tauri::State<'_, crate::AppState>) -> Result<BTreeMap<String, Policy>, CoreError> {
    read(&state.db).await
}

#[tauri::command]
pub(crate) async fn save_host_confirmation_preference(category: Category, policy: Policy, state: tauri::State<'_, crate::AppState>) -> Result<BTreeMap<String, Policy>, CoreError> {
    save(&state.db, category, policy).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const CATEGORIES: [Category; 5] = [Category::Git, Category::ProjectAction, Category::TurnRestore, Category::CapabilityWrite, Category::ViewWrite];

    #[tokio::test]
    async fn categories_default_allow_persist_independently_and_prompt_only_when_requested() {
        let root = std::env::temp_dir().join(format!("aibo-host-confirmation-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("app.sqlite3");
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(read(&db).await.unwrap().len(), 5);
        for category in CATEGORIES {
            assert!(confirm(&db, category, || async { panic!("default must not prompt") }).await.unwrap());
            save(&db, category, Policy::Ask).await.unwrap();
            assert!(!confirm(&db, category, || async { Ok(false) }).await.unwrap());
            assert!(confirm(&db, category, || async { Ok(true) }).await.unwrap());
            assert!(confirm(&db, category, || async { Err("dialog closed".into()) }).await.is_err());
        }
        save(&db, Category::Git, Policy::AlwaysAllow).await.unwrap();
        let preferences = read(&db).await.unwrap();
        assert_eq!(preferences["git"], Policy::AlwaysAllow);
        assert_eq!(preferences["projectAction"], Policy::Ask);
        db.close().await;
        let db = crate::open_database(&path).await.unwrap();
        assert_eq!(read(&db).await.unwrap(), preferences);
        assert!(confirm(&db, Category::Git, || async { panic!("persisted allow") }).await.unwrap());
        assert!(!confirm(&db, Category::ViewWrite, || async { Ok(false) }).await.unwrap());
        // Invalid IPC values and storage values cannot silently become grants.
        assert!(serde_json::from_str::<Category>("\"session\"").is_err());
        assert!(serde_json::from_str::<Policy>("\"sometimes\"").is_err());
        assert!(sqlx::query("UPDATE host_confirmation_preferences SET policy='invalid'").execute(&db).await.is_err());
        sqlx::query("DELETE FROM host_confirmation_preferences WHERE category='git'").execute(&db).await.unwrap();
        assert!(confirm(&db, Category::Git, || async { panic!("missing storage") }).await.is_err());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn migration_preserves_workspace_trust_and_session_permissions() {
        use sqlx::Connection;
        let mut connection = sqlx::SqliteConnection::connect("sqlite::memory:").await.unwrap();
        // Match open_database: historical table rebuilds require this during migrations.
        sqlx::query("PRAGMA foreign_keys=OFF").execute(&mut connection).await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = old.iter().filter(|migration| migration.version < 53).cloned().collect::<Vec<_>>().into();
        old.run(&mut connection).await.unwrap();
        sqlx::raw_sql("INSERT INTO workspaces(id,path,label,trusted,permission_epoch,created_at,updated_at) VALUES('w','/missing','existing',0,9,'before','before');
            UPDATE workspace_preferences SET trust_new_workspaces=0;")
            .execute(&mut connection).await.unwrap();
        let before: Vec<(String, String)> = sqlx::query_as("SELECT name, sql FROM sqlite_master WHERE type='table' AND name LIKE 'session_%'")
            .fetch_all(&mut connection).await.unwrap();
        sqlx::migrate!("./migrations").run(&mut connection).await.unwrap();
        let trust: (bool, i64) = sqlx::query_as("SELECT trusted, permission_epoch FROM workspaces WHERE id='w'").fetch_one(&mut connection).await.unwrap();
        assert_eq!(trust, (false, 9));
        let default_trust: bool = sqlx::query_scalar("SELECT trust_new_workspaces FROM workspace_preferences").fetch_one(&mut connection).await.unwrap();
        assert!(!default_trust);
        let after: Vec<(String, String)> = sqlx::query_as("SELECT name, sql FROM sqlite_master WHERE type='table' AND name LIKE 'session_%'")
            .fetch_all(&mut connection).await.unwrap();
        assert_eq!(before, after);
        let defaults: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM host_confirmation_preferences WHERE policy='always-allow'").fetch_one(&mut connection).await.unwrap();
        assert_eq!(defaults, 5);
    }

    #[tokio::test]
    async fn git_policy_executes_or_rejects_without_bypassing_trust_or_replaying_writes() {
        use crate::workspace_write_runs::Request;
        let root = std::env::temp_dir().join(format!("aibo-confirmation-git-{}", ulid::Ulid::new()));
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(std::process::Command::new("git").arg("init").arg(&repo).output().unwrap().status.success());
        std::fs::write(repo.join("file.txt"), "before").unwrap();
        let db = crate::open_database(&root.join("app.sqlite3")).await.unwrap();
        let workspace = crate::add_workspace_in_db(repo.to_str().unwrap(), &db).await.unwrap();
        let request = |id: &str| {
            let db = db.clone();
            Request::with_confirmation(id.into(), "main".into(), move |_| {
                let db = db.clone();
                async move { confirm(&db, Category::Git, || async { Ok(false) }).await }
            })
        };
        let stage = |request: Request| {
            let db = db.clone(); let workspace_id = workspace.id.clone();
            async move { crate::workspace_git::apply_workspace_git_file_action_requested(&db, workspace_id, "file.txt".into(), "stage".into(), &request).await }
        };
        assert!(stage(request("automatic")).await.unwrap().applied);
        std::fs::write(repo.join("file.txt"), "after").unwrap();
        save(&db, Category::Git, Policy::Ask).await.unwrap();
        assert!(stage(request("denied")).await.unwrap_err().to_string().contains("approval"));
        assert!(stage(request("automatic")).await.unwrap().applied);
        let indexed = std::process::Command::new("git").arg("-C").arg(&repo).args(["show", ":file.txt"]).output().unwrap();
        assert_eq!(String::from_utf8(indexed.stdout).unwrap(), "before", "denial and replay must not stage new content");
        save(&db, Category::Git, Policy::AlwaysAllow).await.unwrap();
        sqlx::query("UPDATE workspaces SET trusted=0 WHERE id=?").bind(&workspace.id).execute(&db).await.unwrap();
        assert!(matches!(stage(request("untrusted")).await, Err(CoreError::WorkspaceTrustRequired)));
        let runs: Vec<(String, String)> = sqlx::query_as("SELECT status, approval_outcome FROM workspace_write_runs ORDER BY request_id").fetch_all(&db).await.unwrap();
        assert_eq!(runs, vec![("completed".into(), "approved".into()), ("rejected".into(), "denied".into())]);
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
