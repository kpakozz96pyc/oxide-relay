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
