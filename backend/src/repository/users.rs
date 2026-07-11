use sqlx::{FromRow, QueryBuilder, Sqlite, SqliteConnection, SqlitePool};
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

#[derive(Debug, FromRow)]
pub struct UserSummaryRecord {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub direct_permissions_count: i64,
    pub project_access_count: i64,
    pub selected_project_relation: Option<String>,
}

#[derive(Debug, FromRow)]
pub struct UserProjectAccessRecord {
    pub project_id: String,
    pub project_name: String,
    pub project_slug: String,
    pub owner_user_id: String,
    pub access_added_at: Option<String>,
    pub relation: String,
    pub actor_is_owner: bool,
    pub actor_has_access: bool,
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

pub async fn find_row_by_id(pool: &SqlitePool, user_id: &str) -> AppResult<UserRow> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, email, password_hash, display_name, is_active
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

pub async fn list_summaries(
    pool: &SqlitePool,
    search: Option<&str>,
    status: Option<bool>,
    permission_code: Option<&str>,
    project_slug: Option<&str>,
) -> AppResult<Vec<UserSummaryRecord>> {
    let search_pattern = search
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.to_lowercase()));
    let normalized_permission = permission_code
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_project_slug = project_slug
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut query = QueryBuilder::<Sqlite>::new(
        r#"
        SELECT
            u.id,
            u.email,
            u.display_name,
            u.is_active,
            u.created_at,
            u.updated_at,
            (
                SELECT COUNT(*)
                FROM user_permissions up_count
                WHERE up_count.user_id = u.id
            ) AS direct_permissions_count,
            (
                SELECT COUNT(DISTINCT p_count.id)
                FROM projects p_count
                LEFT JOIN user_project_access upa_count
                    ON upa_count.project_id = p_count.id
                   AND upa_count.user_id = u.id
                WHERE p_count.owner_user_id = u.id
                   OR upa_count.user_id IS NOT NULL
            ) AS project_access_count,
            (
                SELECT CASE
                    WHEN p_selected.owner_user_id = u.id THEN 'owner'
                    WHEN upa_selected.user_id IS NOT NULL THEN 'member'
                    ELSE NULL
                END
                FROM projects p_selected
                LEFT JOIN user_project_access upa_selected
                    ON upa_selected.project_id = p_selected.id
                   AND upa_selected.user_id = u.id
                WHERE p_selected.slug =
            "#,
    );
    query.push_bind(normalized_project_slug.unwrap_or(""));
    query.push(
        r#"
            ) AS selected_project_relation
        FROM users u
        WHERE 1 = 1
        "#,
    );

    if let Some(pattern) = search_pattern.as_deref() {
        query.push(" AND (LOWER(u.email) LIKE ");
        query.push_bind(pattern);
        query.push(" OR LOWER(u.display_name) LIKE ");
        query.push_bind(pattern);
        query.push(")");
    }

    if let Some(is_active) = status {
        query.push(" AND u.is_active = ");
        query.push_bind(is_active);
    }

    if let Some(code) = normalized_permission {
        query.push(
            r#"
            AND EXISTS (
                SELECT 1
                FROM user_permissions up_filter
                JOIN permissions p_filter ON p_filter.id = up_filter.permission_id
                WHERE up_filter.user_id = u.id
                  AND p_filter.code =
            "#,
        );
        query.push_bind(code);
        query.push(")");
    }

    if let Some(slug) = normalized_project_slug {
        query.push(
            r#"
            AND EXISTS (
                SELECT 1
                FROM projects p_filter
                LEFT JOIN user_project_access upa_filter
                    ON upa_filter.project_id = p_filter.id
                   AND upa_filter.user_id = u.id
                WHERE p_filter.slug =
            "#,
        );
        query.push_bind(slug);
        query.push(
            r#"
                  AND (
                      p_filter.owner_user_id = u.id
                      OR upa_filter.user_id IS NOT NULL
                  )
            )
            "#,
        );
    }

    query.push(" ORDER BY LOWER(u.display_name), LOWER(u.email)");

    query
        .build_query_as::<UserSummaryRecord>()
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to list user summaries."))
}

pub async fn list_project_access(
    pool: &SqlitePool,
    target_user_id: &str,
    actor_user_id: &str,
) -> AppResult<Vec<UserProjectAccessRecord>> {
    sqlx::query_as::<_, UserProjectAccessRecord>(
        r#"
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            p.slug AS project_slug,
            p.owner_user_id,
            upa_target.created_at AS access_added_at,
            CASE
                WHEN p.owner_user_id = ?1 THEN 'owner'
                WHEN upa_target.user_id IS NOT NULL THEN 'member'
                ELSE 'none'
            END AS relation,
            CASE WHEN p.owner_user_id = ?2 THEN 1 ELSE 0 END AS actor_is_owner,
            CASE WHEN upa_actor.user_id IS NOT NULL THEN 1 ELSE 0 END AS actor_has_access
        FROM projects p
        LEFT JOIN user_project_access upa_target
            ON upa_target.project_id = p.id
           AND upa_target.user_id = ?1
        LEFT JOIN user_project_access upa_actor
            ON upa_actor.project_id = p.id
           AND upa_actor.user_id = ?2
        ORDER BY LOWER(p.name), LOWER(p.slug)
        "#,
    )
    .bind(target_user_id)
    .bind(actor_user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list user project access."))
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

pub async fn update_password_hash(
    pool: &SqlitePool,
    user_id: &str,
    password_hash: &str,
) -> AppResult<()> {
    let updated_at = now_utc()?;
    let result = sqlx::query(
        r#"
        UPDATE users
        SET password_hash = ?1,
            updated_at = ?2
        WHERE id = ?3
        "#,
    )
    .bind(password_hash)
    .bind(&updated_at)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to update the user password."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("User was not found."));
    }

    Ok(())
}

pub async fn update_password_hash_in_connection(
    connection: &mut SqliteConnection,
    user_id: &str,
    password_hash: &str,
    updated_at: &str,
) -> AppResult<()> {
    let result = sqlx::query(
        r#"
        UPDATE users
        SET password_hash = ?1,
            updated_at = ?2
        WHERE id = ?3
        "#,
    )
    .bind(password_hash)
    .bind(updated_at)
    .bind(user_id)
    .execute(&mut *connection)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to update the user password."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("User was not found."));
    }

    Ok(())
}
