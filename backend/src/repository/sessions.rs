use sqlx::SqlitePool;

use crate::{
    errors::{ApiError, AppResult},
    util::now_utc,
};

/// Creates a new session record. Returns the session id.
pub async fn create_session(
    pool: &SqlitePool,
    user_id: &str,
    session_id: &str,
    expires_at: &str,
) -> AppResult<()> {
    let created_at = now_utc()?;

    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, expires_at, created_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(session_id)
    .bind(user_id)
    .bind(expires_at)
    .bind(&created_at)
    .execute(pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to create a session."))?;

    Ok(())
}

/// Deletes a session by id. Returns `Ok(())` whether or not the session existed.
pub async fn delete_session(pool: &SqlitePool, session_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE id = ?1")
        .bind(session_id)
        .execute(pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to clear the session."))?;

    Ok(())
}
