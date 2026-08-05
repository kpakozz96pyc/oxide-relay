use sqlx::SqlitePool;

use crate::config::{DeliverySettings, SessionSettings};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub session: SessionSettings,
    pub delivery: DeliverySettings,
}

impl AppState {
    pub fn new(pool: SqlitePool, session: SessionSettings, delivery: DeliverySettings) -> Self {
        Self {
            pool,
            session,
            delivery,
        }
    }
}
