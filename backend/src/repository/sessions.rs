use sqlx::{SqliteConnection, SqlitePool};

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

pub async fn delete_sessions_for_user(
    pool: &SqlitePool,
    user_id: &str,
) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM sessions WHERE user_id = ?1")
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to clear user sessions."))?;

    Ok(result.rows_affected())
}

pub async fn delete_sessions_for_user_in_connection(
    connection: &mut SqliteConnection,
    user_id: &str,
) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM sessions WHERE user_id = ?1")
        .bind(user_id)
        .execute(&mut *connection)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to clear user sessions."))?;

    Ok(result.rows_affected())
}

/// Removes all sessions that have expired. Called opportunistically during login.
pub async fn purge_expired(pool: &SqlitePool) -> AppResult<u64> {
    let now = now_utc()?;
    let result = sqlx::query("DELETE FROM sessions WHERE expires_at < ?1")
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to purge expired sessions."))?;

    Ok(result.rows_affected())
}
