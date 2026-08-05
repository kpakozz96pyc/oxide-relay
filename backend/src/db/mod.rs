mod bootstrap;
mod pool;

use sqlx::SqlitePool;

use crate::config::Settings;

pub async fn initialize(settings: &Settings) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let pool = pool::connect(&settings.database).await?;

    sqlx::migrate!("../migrations").run(&pool).await?;
    bootstrap::run(&pool, settings).await?;

    Ok(pool)
}

pub async fn initialize_existing(
    settings: &Settings,
) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let pool = pool::connect_existing(&settings.database).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    Ok(pool)
}
