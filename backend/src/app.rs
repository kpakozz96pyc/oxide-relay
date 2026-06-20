use sqlx::SqlitePool;

use crate::config::SessionSettings;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub session: SessionSettings,
}

impl AppState {
    pub fn new(pool: SqlitePool, session: SessionSettings) -> Self {
        Self { pool, session }
    }
}
