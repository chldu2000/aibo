//! Application-wide creation defaults. Existing workspace grants remain independent.
use crate::CoreError;
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePreferences {
    pub trust_new_workspaces: bool,
}

pub(crate) async fn read(db: &SqlitePool) -> Result<WorkspacePreferences, CoreError> {
    let trust_new_workspaces = sqlx::query_scalar(
        "SELECT trust_new_workspaces FROM workspace_preferences WHERE id = 1",
    )
    .fetch_one(db)
    .await?;
    Ok(WorkspacePreferences { trust_new_workspaces })
}

pub(crate) async fn save(db: &SqlitePool, trusted: bool) -> Result<WorkspacePreferences, CoreError> {
    let trust_new_workspaces = sqlx::query_scalar(
        "UPDATE workspace_preferences SET trust_new_workspaces = ? WHERE id = 1 RETURNING trust_new_workspaces",
    )
    .bind(trusted)
    .fetch_one(db)
    .await?;
    Ok(WorkspacePreferences { trust_new_workspaces })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn workspace_defaults_persist_and_only_affect_new_directories() {
        let root = std::env::temp_dir().join(format!("aibo-workspace-defaults-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(root.join("first")).unwrap();
        std::fs::create_dir_all(root.join("second")).unwrap();
        std::fs::create_dir_all(root.join("third")).unwrap();
        let path = root.join("app.sqlite3");
        let db = crate::open_database(&path).await.unwrap();
        assert!(read(&db).await.unwrap().trust_new_workspaces);
        let first_path = root.join("first").to_string_lossy().into_owned();
        let second_path = root.join("second").to_string_lossy().into_owned();
        let first = crate::add_workspace_in_db(&first_path, &db).await.unwrap();
        assert_eq!(first.trust, "trusted");
        assert!(!save(&db, false).await.unwrap().trust_new_workspaces);
        let second = crate::add_workspace_in_db(&second_path, &db).await.unwrap();
        assert_eq!(second.trust, "untrusted");
        let same_first = crate::add_workspace_in_db(&first_path, &db).await.unwrap();
        assert_eq!(same_first.id, first.id);
        assert_eq!(same_first.trust, "trusted");
        db.close().await;

        let db = crate::open_database(&path).await.unwrap();
        assert!(!read(&db).await.unwrap().trust_new_workspaces);
        save(&db, true).await.unwrap();
        let same_second = crate::add_workspace_in_db(&second_path, &db).await.unwrap();
        assert_eq!(same_second.id, second.id);
        assert_eq!(same_second.trust, "untrusted");
        let third = crate::add_workspace_in_db(root.join("third").to_str().unwrap(), &db).await.unwrap();
        assert_eq!(third.trust, "trusted");
        // An explicit revocation must survive re-adding the same directory too.
        sqlx::query("UPDATE workspaces SET trusted=0, permission_epoch=7 WHERE id=?")
            .bind(&first.id).execute(&db).await.unwrap();
        assert_eq!(crate::add_workspace_in_db(&first_path, &db).await.unwrap().trust, "untrusted");
        let epoch: i64 = sqlx::query_scalar("SELECT permission_epoch FROM workspaces WHERE id=?")
            .bind(&first.id).fetch_one(&db).await.unwrap();
        assert_eq!(epoch, 7);
        assert!(crate::add_workspace_in_db(root.join("missing").to_str().unwrap(), &db).await.is_err());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn preference_migration_preserves_existing_trust() {
        let db = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE workspaces(id TEXT, trusted INTEGER, permission_epoch INTEGER);
            INSERT INTO workspaces VALUES('trusted',1,3),('untrusted',0,5);")
            .execute(&db).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0048_workspace_preferences.sql")).execute(&db).await.unwrap();
        save(&db, false).await.unwrap();
        let rows: Vec<(String, i64, i64)> = sqlx::query_as("SELECT id, trusted, permission_epoch FROM workspaces ORDER BY id")
            .fetch_all(&db).await.unwrap();
        assert_eq!(rows, vec![("trusted".into(),1,3),("untrusted".into(),0,5)]);
        assert!(sqlx::query("UPDATE workspace_preferences SET trust_new_workspaces=2").execute(&db).await.is_err());
        db.close().await;
    }
}
