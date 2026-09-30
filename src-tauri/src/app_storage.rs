//! Select storage before opening SQLite or initializing any app-owned files.
use std::path::PathBuf;

pub(crate) fn data_dir(app_data_dir: PathBuf) -> PathBuf {
    for_build(app_data_dir, cfg!(any(dev, debug_assertions, test)))
}

fn for_build(app_data_dir: PathBuf, development: bool) -> PathBuf {
    if development {
        app_data_dir.join("development")
    } else {
        app_data_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    #[test]
    fn release_keeps_existing_storage_and_development_is_separate() {
        let base = PathBuf::from("app-data");
        assert_eq!(for_build(base.clone(), false), base);
        assert_eq!(for_build(base.clone(), true), base.join("development"));
        assert_eq!(data_dir(base.clone()), base.join("development"));
    }

    #[tokio::test]
    async fn development_migrations_leave_running_release_database_untouched() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().to_path_buf();
        let release_path = for_build(base.clone(), false).join("aibo.sqlite3");
        let release = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&release_path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE release_marker (value TEXT NOT NULL)")
            .execute(&release)
            .await
            .unwrap();
        sqlx::query("INSERT INTO release_marker VALUES ('preserved')")
            .execute(&release)
            .await
            .unwrap();
        let before = std::fs::read(&release_path).unwrap();

        let dev_path = data_dir(base).join("aibo.sqlite3");
        for _ in 0..2 {
            let development = crate::open_database(&dev_path).await.unwrap();
            let migrations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
                .fetch_one(&development)
                .await
                .unwrap();
            assert!(migrations > 0);
            development.close().await;
        }

        assert_eq!(std::fs::read(&release_path).unwrap(), before);
        let value: String = sqlx::query_scalar("SELECT value FROM release_marker")
            .fetch_one(&release)
            .await
            .unwrap();
        assert_eq!(value, "preserved");
        let migrated: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = '_sqlx_migrations'",
        )
        .fetch_one(&release)
        .await
        .unwrap();
        assert_eq!(migrated, 0);
        release.close().await;
    }
}
