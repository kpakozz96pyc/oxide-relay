use std::collections::BTreeMap;

use sqlx::{FromRow, Row, SqliteConnection, SqlitePool};

use crate::errors::{ApiError, AppResult};

#[derive(Debug, FromRow)]
pub struct PermissionRecord {
    pub id: String,
    pub code: String,
    pub description: Option<String>,
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<PermissionRecord>> {
    sqlx::query_as::<_, PermissionRecord>(
        r#"
        SELECT id, code, description
        FROM permissions
        ORDER BY code
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list permissions."))
}

pub async fn list_for_user(pool: &SqlitePool, user_id: &str) -> AppResult<Vec<PermissionRecord>> {
    sqlx::query_as::<_, PermissionRecord>(
        r#"
        SELECT p.id, p.code, p.description
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ?1
        ORDER BY p.code
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to load user permissions."))
}

pub async fn list_codes_for_user(pool: &SqlitePool, user_id: &str) -> AppResult<Vec<String>> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT p.code
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ?1
        ORDER BY p.code
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to load the current user's permissions."))
}

pub async fn user_has_permission(
    pool: &SqlitePool,
    user_id: &str,
    permission_code: &str,
) -> AppResult<bool> {
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ?1
          AND p.code = ?2
        "#,
    )
    .bind(user_id)
    .bind(permission_code)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to resolve permissions."))?;

    Ok(count > 0)
}

pub async fn user_has_permission_in_connection(
    connection: &mut SqliteConnection,
    user_id: &str,
    permission_code: &str,
) -> AppResult<bool> {
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ?1
          AND p.code = ?2
        "#,
    )
    .bind(user_id)
    .bind(permission_code)
    .fetch_one(&mut *connection)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to resolve permissions."))?;

    Ok(count > 0)
}

/// Count active users other than `excluded_user_id` who hold `permission_code`.
pub async fn count_other_active_users_with_permission(
    pool: &SqlitePool,
    excluded_user_id: &str,
    permission_code: &str,
) -> AppResult<i64> {
    sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM users u
        JOIN user_permissions up ON up.user_id = u.id
        JOIN permissions p ON p.id = up.permission_id
        WHERE u.is_active = 1
          AND p.code = ?1
          AND u.id != ?2
        "#,
    )
    .bind(permission_code)
    .bind(excluded_user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to count active administrators."))
}

/// Connection-scoped variant of [`count_other_active_users_with_permission`] for use inside a
/// write transaction that already holds SQLite's write lock, so the count reflects a
/// consistent, race-free view of the data it is about to be checked against.
pub async fn count_other_active_users_with_permission_in_connection(
    connection: &mut SqliteConnection,
    excluded_user_id: &str,
    permission_code: &str,
) -> AppResult<i64> {
    sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM users u
        JOIN user_permissions up ON up.user_id = u.id
        JOIN permissions p ON p.id = up.permission_id
        WHERE u.is_active = 1
          AND p.code = ?1
          AND u.id != ?2
        "#,
    )
    .bind(permission_code)
    .bind(excluded_user_id)
    .fetch_one(&mut *connection)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to count active administrators."))
}

/// Replace all permissions for `user_id` with the given codes.
/// Returns an error if any code is not in the seeded catalog.
pub async fn replace_for_user(
    pool: &SqlitePool,
    user_id: &str,
    permission_codes: &[String],
) -> AppResult<()> {
    let normalized = normalize_codes(permission_codes);

    // Resolve IDs from the catalog
    let permission_ids = resolve_ids(pool, &normalized).await?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to start permission update."))?;

    replace_for_user_in_connection(&mut tx, user_id, &permission_ids).await?;

    tx.commit()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to commit permission update."))?;

    Ok(())
}

/// Replace all permissions for `user_id` with the given (already resolved) permission ids,
/// using the caller's connection. Intended for use inside a write transaction that also
/// re-checks invariants (e.g. the last-active-administrator guard) before committing.
pub async fn replace_for_user_in_connection(
    connection: &mut SqliteConnection,
    user_id: &str,
    permission_ids: &[String],
) -> AppResult<()> {
    sqlx::query("DELETE FROM user_permissions WHERE user_id = ?1")
        .bind(user_id)
        .execute(&mut *connection)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to clear user permissions."))?;

    for permission_id in permission_ids {
        sqlx::query(
            r#"
            INSERT INTO user_permissions (user_id, permission_id)
            VALUES (?1, ?2)
            "#,
        )
        .bind(user_id)
        .bind(permission_id)
        .execute(&mut *connection)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to assign user permissions."))?;
    }

    Ok(())
}

pub fn normalize_codes(codes: &[String]) -> Vec<String> {
    codes
        .iter()
        .map(|c| c.trim().to_owned())
        .filter(|c| !c.is_empty())
        .collect()
}

/// Resolve permission codes to catalog ids. Errors if any code is unknown.
pub async fn resolve_ids(pool: &SqlitePool, codes: &[String]) -> AppResult<Vec<String>> {
    if codes.is_empty() {
        return Ok(vec![]);
    }

    let rows = sqlx::query(
        r#"
        SELECT id, code
        FROM permissions
        WHERE code IN (SELECT value FROM json_each(?1))
        "#,
    )
    .bind(
        serde_json::to_string(codes)
            .map_err(|e| ApiError::internal(format!("Unable to encode permission codes: {e}")))?,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to resolve permissions."))?;

    let mut found: BTreeMap<String, String> = BTreeMap::new();
    for row in rows {
        let id: String = row.get("id");
        let code: String = row.get("code");
        found.insert(code, id);
    }

    if found.len() != codes.len() {
        return Err(ApiError::validation(
            "One or more permission codes are not part of the seeded permission catalog.",
        ));
    }

    Ok(codes
        .iter()
        .filter_map(|code| found.get(code).cloned())
        .collect())
}
