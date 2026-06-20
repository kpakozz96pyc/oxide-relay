use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

use crate::{
    errors::{ApiError, AppResult},
    util::{hash_password, now_utc, optional_trimmed},
};

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

#[derive(Debug, FromRow)]
pub struct UserRow {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub display_name: String,
    pub is_active: bool,
}

// ---------------------------------------------------------------------------
// Query inputs
// ---------------------------------------------------------------------------

pub struct CreateUserInput<'a> {
    pub email: &'a str,
    pub password: &'a str,
    pub display_name: &'a str,
    pub is_active: bool,
}

pub struct UpdateUserInput<'a> {
    pub email: Option<&'a str>,
    pub password: Option<&'a str>,
    pub display_name: Option<&'a str>,
    pub is_active: Option<bool>,
}

// ---------------------------------------------------------------------------
// Output type (matches the HTTP response structure)
// ---------------------------------------------------------------------------

#[derive(Debug, sqlx::FromRow)]
pub struct UserRecord {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

pub async fn find_by_id(pool: &SqlitePool, user_id: &str) -> AppResult<UserRecord> {
    sqlx::query_as::<_, UserRecord>(
        r#"
        SELECT id, email, display_name, is_active, created_at, updated_at
        FROM users
        WHERE id = ?1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to load the user."))?
    .ok_or_else(|| ApiError::not_found("User was not found."))
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<UserRecord>> {
    sqlx::query_as::<_, UserRecord>(
        r#"
        SELECT id, email, display_name, is_active, created_at, updated_at
        FROM users
        ORDER BY email
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list users."))
}

pub async fn create(pool: &SqlitePool, input: CreateUserInput<'_>) -> AppResult<UserRecord> {
    let now = now_utc()?;
    let id = Uuid::new_v4().to_string();
    let email = input.email.trim().to_lowercase();
    let display_name = input.display_name.trim().to_owned();
    let password_hash = hash_password(input.password.trim())?;

    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, display_name, is_active, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&id)
    .bind(&email)
    .bind(password_hash)
    .bind(&display_name)
    .bind(if input.is_active { 1 } else { 0 })
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "User email already exists."))?;

    Ok(UserRecord {
        id,
        email,
        display_name,
        is_active: input.is_active,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub async fn update(
    pool: &SqlitePool,
    user_id: &str,
    input: UpdateUserInput<'_>,
) -> AppResult<UserRecord> {
    let existing = find_by_id(pool, user_id).await?;
    let updated_at = now_utc()?;

    let email = input
        .email
        .map(|v| v.trim().to_lowercase())
        .unwrap_or(existing.email.clone());
    let display_name = input
        .display_name
        .map(|v| v.trim().to_owned())
        .unwrap_or(existing.display_name.clone());
    let is_active = input.is_active.unwrap_or(existing.is_active);

    let new_hash = input
        .password
        .map(str::trim)
        .and_then(|p| optional_trimmed(Some(p)))
        .map(hash_password)
        .transpose()?;

    sqlx::query(
        r#"
        UPDATE users
        SET email = ?1,
            password_hash = COALESCE(?2, password_hash),
            display_name = ?3,
            is_active = ?4,
            updated_at = ?5
        WHERE id = ?6
        "#,
    )
    .bind(&email)
    .bind(new_hash)
    .bind(&display_name)
    .bind(if is_active { 1 } else { 0 })
    .bind(&updated_at)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "User email already exists."))?;

    Ok(UserRecord {
        id: existing.id,
        email,
        display_name,
        is_active,
        created_at: existing.created_at,
        updated_at,
    })
}

pub async fn delete(pool: &SqlitePool, user_id: &str) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM users WHERE id = ?1")
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to delete the user."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("User was not found."));
    }

    Ok(())
}
