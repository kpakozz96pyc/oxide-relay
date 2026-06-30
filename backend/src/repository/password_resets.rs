use sqlx::{FromRow, SqliteConnection, SqlitePool};
use uuid::Uuid;

use crate::{
    errors::{ApiError, AppResult},
    util::now_utc,
};

#[derive(Debug, Clone, FromRow)]
pub struct PasswordResetTokenRecord {
    pub id: String,
    pub user_id: String,
    pub token_hash: String,
    pub expires_at: String,
    pub used_at: Option<String>,
    pub created_at: String,
    pub created_by_user_id: String,
}

pub async fn invalidate_active_tokens_for_user(pool: &SqlitePool, user_id: &str) -> AppResult<()> {
    sqlx::query(
        r#"
        DELETE FROM password_reset_tokens
        WHERE user_id = ?1
          AND used_at IS NULL
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to invalidate password reset links."))?;

    Ok(())
}

pub async fn create_reset_token(
    pool: &SqlitePool,
    user_id: &str,
    created_by_user_id: &str,
    token_hash: &str,
    expires_at: &str,
) -> AppResult<()> {
    let created_at = now_utc()?;

    sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (
            id,
            user_id,
            token_hash,
            expires_at,
            used_at,
            created_at,
            created_by_user_id
        )
        VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .bind(created_at)
    .bind(created_by_user_id)
    .execute(pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to create password reset link."))?;

    Ok(())
}

pub async fn find_active_token_by_hash(
    pool: &SqlitePool,
    token_hash: &str,
) -> AppResult<PasswordResetTokenRecord> {
    let now = now_utc()?;

    sqlx::query_as::<_, PasswordResetTokenRecord>(
        r#"
        SELECT id, user_id, token_hash, expires_at, used_at, created_at, created_by_user_id
        FROM password_reset_tokens
        WHERE token_hash = ?1
          AND used_at IS NULL
          AND expires_at > ?2
        "#,
    )
    .bind(token_hash)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to resolve password reset token."))?
    .ok_or_else(|| ApiError::validation("Password reset link is invalid or expired."))
}

pub async fn mark_token_used(
    connection: &mut SqliteConnection,
    token_id: &str,
    used_at: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"
        UPDATE password_reset_tokens
        SET used_at = ?1
        WHERE id = ?2
        "#,
    )
    .bind(used_at)
    .bind(token_id)
    .execute(&mut *connection)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to finalize password reset."))?;

    Ok(())
}

pub async fn purge_expired(pool: &SqlitePool) -> AppResult<u64> {
    let now = now_utc()?;
    let result = sqlx::query(
        r#"
        DELETE FROM password_reset_tokens
        WHERE expires_at <= ?1
           OR used_at IS NOT NULL
        "#,
    )
    .bind(now)
    .execute(pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to purge expired password reset links."))?;

    Ok(result.rows_affected())
}
