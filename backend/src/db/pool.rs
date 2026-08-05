use std::{fs, path::Path};

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

use crate::config::DatabaseSettings;

pub async fn connect(
    settings: &DatabaseSettings,
) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    ensure_parent_directory(&settings.path)?;

    connect_with_options(settings, true).await
}

pub async fn connect_existing(
    settings: &DatabaseSettings,
) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    if !settings.path.is_file() {
        return Err(format!(
            "SQLite database does not exist: {}",
            settings.path.display()
        )
        .into());
    }

    connect_with_options(settings, false).await
}

async fn connect_with_options(
    settings: &DatabaseSettings,
    create_if_missing: bool,
) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let options = SqliteConnectOptions::new()
        .filename(&settings.path)
        .create_if_missing(create_if_missing)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(std::time::Duration::from_secs(3));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    Ok(pool)
}

fn ensure_parent_directory(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn connect_existing_refuses_to_create_a_missing_database() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database_path = temp_dir.path().join("missing.sqlite");
        let settings = DatabaseSettings {
            path: database_path.clone(),
        };

        let error = connect_existing(&settings)
            .await
            .expect_err("missing database must fail");

        assert!(error.to_string().contains("does not exist"));
        assert!(!database_path.exists());
    }
}
