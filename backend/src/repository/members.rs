use sqlx::{FromRow, SqlitePool};

use crate::{
    errors::{ApiError, AppResult},
    util::now_utc,
};

#[derive(Debug, FromRow)]
pub struct MemberRecord {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_active: bool,
    pub is_owner: bool,
    pub added_at: String,
}

pub async fn list(pool: &SqlitePool, project_id: &str) -> AppResult<Vec<MemberRecord>> {
    sqlx::query_as::<_, MemberRecord>(
        r#"
        SELECT
            u.id,
            u.email,
            u.display_name,
            u.is_active,
            CASE WHEN p.owner_user_id = u.id THEN 1 ELSE 0 END AS is_owner,
            upa.created_at AS added_at
        FROM user_project_access upa
        JOIN users u ON u.id = upa.user_id
        JOIN projects p ON p.id = upa.project_id
        WHERE upa.project_id = ?1
        ORDER BY is_owner DESC, u.email
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list project members."))
}

pub async fn add(
    pool: &SqlitePool,
    project_id: &str,
    user_id: &str,
) -> AppResult<MemberRecord> {
    let added_at = now_utc()?;

    sqlx::query(
        r#"
        INSERT INTO user_project_access (user_id, project_id, created_at)
        VALUES (?1, ?2, ?3)
        "#,
    )
    .bind(user_id)
    .bind(project_id)
    .bind(&added_at)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Project member already exists."))?;

    let member = sqlx::query_as::<_, MemberRecord>(
        r#"
        SELECT
            u.id,
            u.email,
            u.display_name,
            u.is_active,
            CASE WHEN p.owner_user_id = u.id THEN 1 ELSE 0 END AS is_owner,
            upa.created_at AS added_at
        FROM user_project_access upa
        JOIN users u ON u.id = upa.user_id
        JOIN projects p ON p.id = upa.project_id
        WHERE upa.project_id = ?1
          AND upa.user_id = ?2
        "#,
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to load the project member."))?
    .ok_or_else(|| ApiError::not_found("User was not found."))?;

    Ok(member)
}

pub async fn remove(pool: &SqlitePool, project_id: &str, user_id: &str) -> AppResult<()> {
    let result = sqlx::query(
        "DELETE FROM user_project_access WHERE project_id = ?1 AND user_id = ?2",
    )
    .bind(project_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to delete the project member."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Project member was not found."));
    }

    Ok(())
}
