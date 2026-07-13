use sqlx::SqlitePool;

use crate::errors::{ApiError, AppResult};

pub async fn is_rate_limited(
    pool: &SqlitePool,
    identifier_hash: &str,
    window_cutoff: &str,
    max_attempts: i64,
) -> AppResult<bool> {
    let attempts: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT failed_attempts
        FROM login_attempts
        WHERE identifier_hash = ?1
          AND window_started_at >= ?2
        "#,
    )
    .bind(identifier_hash)
    .bind(window_cutoff)
    .fetch_optional(pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to check login rate limit."))?;

    Ok(attempts.unwrap_or_default() >= max_attempts)
}

pub async fn record_failure(
    pool: &SqlitePool,
    identifier_hash: &str,
    now: &str,
    window_cutoff: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO login_attempts (
            identifier_hash,
            failed_attempts,
            window_started_at,
            updated_at
        )
        VALUES (?1, 1, ?2, ?2)
        ON CONFLICT(identifier_hash) DO UPDATE SET
            failed_attempts = CASE
                WHEN login_attempts.window_started_at < ?3 THEN 1
                ELSE login_attempts.failed_attempts + 1
            END,
            window_started_at = CASE
                WHEN login_attempts.window_started_at < ?3 THEN ?2
                ELSE login_attempts.window_started_at
            END,
            updated_at = ?2
        "#,
    )
    .bind(identifier_hash)
    .bind(now)
    .bind(window_cutoff)
    .execute(pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to record failed login."))?;

    Ok(())
}

pub async fn clear(pool: &SqlitePool, identifier_hash: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM login_attempts WHERE identifier_hash = ?1")
        .bind(identifier_hash)
        .execute(pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to clear login rate limit."))?;

    Ok(())
}

/// Called opportunistically on login to avoid retaining expired identifiers.
pub async fn purge_expired(pool: &SqlitePool, window_cutoff: &str) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM login_attempts WHERE window_started_at < ?1")
        .bind(window_cutoff)
        .execute(pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to purge login rate limits."))?;

    Ok(result.rows_affected())
}
