use std::collections::BTreeMap;

use sqlx::{FromRow, Row, SqlitePool};

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

/// Replace all permissions for `user_id` with the given codes.
/// Returns an error if any code is not in the seeded catalog.
pub async fn replace_for_user(
    pool: &SqlitePool,
    user_id: &str,
    permission_codes: &[String],
) -> AppResult<()> {
    let normalized: Vec<String> = permission_codes
        .iter()
        .map(|c| c.trim().to_owned())
        .filter(|c| !c.is_empty())
        .collect();

    // Resolve IDs from the catalog
    let permission_ids = resolve_ids(pool, &normalized).await?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to start permission update."))?;

    sqlx::query("DELETE FROM user_permissions WHERE user_id = ?1")
        .bind(user_id)
        .execute(&mut *tx)
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
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to assign user permissions."))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to commit permission update."))?;

    Ok(())
}

async fn resolve_ids(pool: &SqlitePool, codes: &[String]) -> AppResult<Vec<String>> {
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
