use sqlx::SqlitePool;

use crate::config::SessionSettings;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub session_cookie_name: String,
    pub session_ttl_hours: i64,
    pub session_cookie_secure: bool,
}

impl AppState {
    pub fn new(pool: SqlitePool, session: SessionSettings) -> Self {
        Self {
            pool,
            session_cookie_name: session.cookie_name,
            session_ttl_hours: session.ttl_hours,
            session_cookie_secure: session.cookie_secure,
        }
    }
}
