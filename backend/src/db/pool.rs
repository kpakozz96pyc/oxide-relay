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

    let options = SqliteConnectOptions::new()
        .filename(&settings.path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal);

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
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
