use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

use crate::{
    errors::{ApiError, AppResult},
    util::{now_utc, optional_trimmed},
};

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromRow)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub owner_user_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_owner: bool,
}

#[derive(Debug, FromRow)]
pub struct LanguageRecord {
    pub id: String,
    pub project_id: String,
    pub code: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
pub struct NamespaceRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
pub struct EnvironmentRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

pub struct CreateProjectInput<'a> {
    pub name: &'a str,
    pub slug: &'a str,
    pub description: Option<&'a str>,
    pub owner_user_id: &'a str,
}

pub struct UpdateProjectInput<'a> {
    pub name: Option<&'a str>,
    pub slug: Option<&'a str>,
    pub description: Option<Option<&'a str>>, // Some(None) clears, None means no change
}

// ---------------------------------------------------------------------------
// Project queries
// ---------------------------------------------------------------------------

pub async fn list_for_user(pool: &SqlitePool, user_id: &str) -> AppResult<Vec<ProjectRecord>> {
    sqlx::query_as::<_, ProjectRecord>(
        r#"
        SELECT DISTINCT
            p.id,
            p.name,
            p.slug,
            p.description,
            p.owner_user_id,
            p.created_at,
            p.updated_at,
            CASE WHEN p.owner_user_id = ?1 THEN 1 ELSE 0 END AS is_owner
        FROM projects p
        LEFT JOIN user_project_access upa
            ON upa.project_id = p.id
           AND upa.user_id = ?1
        WHERE p.owner_user_id = ?1
           OR upa.user_id IS NOT NULL
        ORDER BY p.name, p.slug
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list projects."))
}

pub async fn create(pool: &SqlitePool, input: CreateProjectInput<'_>) -> AppResult<ProjectRecord> {
    let now = now_utc()?;
    let id = Uuid::new_v4().to_string();
    let name = input.name.trim().to_owned();
    let slug = input.slug.trim().to_owned();
    let description = input
        .description
        .and_then(|d| optional_trimmed(Some(d)))
        .map(ToOwned::to_owned);

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to create the project transaction."))?;

    sqlx::query(
        r#"
        INSERT INTO projects (id, name, slug, description, owner_user_id, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&id)
    .bind(&name)
    .bind(&slug)
    .bind(description.as_deref())
    .bind(input.owner_user_id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Project slug already exists."))?;

    // Grant owner access
    sqlx::query(
        r#"
        INSERT INTO user_project_access (user_id, project_id, created_at)
        VALUES (?1, ?2, ?3)
        "#,
    )
    .bind(input.owner_user_id)
    .bind(&id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to create owner project access."))?;

    // Default environments
    for (env_name, env_slug) in [("Development", "development"), ("Staging", "staging"), ("Production", "production")] {
        insert_environment_tx(&mut tx, &id, env_name, env_slug, &now).await?;
    }

    // Default namespace
    sqlx::query(
        r#"
        INSERT INTO namespaces (id, project_id, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&id)
    .bind("common")
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to create the default namespace."))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to commit project creation."))?;

    Ok(ProjectRecord {
        id,
        name,
        slug,
        description,
        owner_user_id: input.owner_user_id.to_owned(),
        created_at: now.clone(),
        updated_at: now,
        is_owner: true,
    })
}

pub async fn update(
    pool: &SqlitePool,
    project: &ProjectRecord,
    input: UpdateProjectInput<'_>,
) -> AppResult<ProjectRecord> {
    let name = input
        .name
        .map(|v| v.trim().to_owned())
        .unwrap_or(project.name.clone());
    let slug = input
        .slug
        .map(|v| v.trim().to_owned())
        .unwrap_or(project.slug.clone());
    let description = match input.description {
        Some(d) => d.and_then(|v| optional_trimmed(Some(v))).map(ToOwned::to_owned),
        None => project.description.clone(),
    };
    let now = now_utc()?;

    sqlx::query(
        r#"
        UPDATE projects
        SET name = ?1,
            slug = ?2,
            description = ?3,
            updated_at = ?4
        WHERE id = ?5
        "#,
    )
    .bind(&name)
    .bind(&slug)
    .bind(description.as_deref())
    .bind(&now)
    .bind(&project.id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Project slug already exists."))?;

    Ok(ProjectRecord {
        id: project.id.clone(),
        name,
        slug,
        description,
        owner_user_id: project.owner_user_id.clone(),
        created_at: project.created_at.clone(),
        updated_at: now,
        is_owner: project.is_owner,
    })
}

pub async fn delete(pool: &SqlitePool, project_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM projects WHERE id = ?1")
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to delete the project."))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

pub async fn list_languages(pool: &SqlitePool, project_id: &str) -> AppResult<Vec<LanguageRecord>> {
    sqlx::query_as::<_, LanguageRecord>(
        r#"
        SELECT id, project_id, code, name, created_at, updated_at
        FROM languages
        WHERE project_id = ?1
        ORDER BY code
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list languages."))
}

pub async fn create_language(
    pool: &SqlitePool,
    project_id: &str,
    code: &str,
    name: &str,
) -> AppResult<LanguageRecord> {
    let now = now_utc()?;
    let record = LanguageRecord {
        id: Uuid::new_v4().to_string(),
        project_id: project_id.to_owned(),
        code: code.trim().to_owned(),
        name: name.trim().to_owned(),
        created_at: now.clone(),
        updated_at: now,
    };

    sqlx::query(
        r#"
        INSERT INTO languages (id, project_id, code, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(&record.id)
    .bind(&record.project_id)
    .bind(&record.code)
    .bind(&record.name)
    .bind(&record.created_at)
    .bind(&record.updated_at)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Language code already exists in this project."))?;

    Ok(record)
}

pub async fn delete_language(
    pool: &SqlitePool,
    project_id: &str,
    language_code: &str,
) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM languages WHERE project_id = ?1 AND code = ?2")
        .bind(project_id)
        .bind(language_code)
        .execute(pool)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to delete the language."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Language was not found."));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

pub async fn list_namespaces(
    pool: &SqlitePool,
    project_id: &str,
) -> AppResult<Vec<NamespaceRecord>> {
    sqlx::query_as::<_, NamespaceRecord>(
        r#"
        SELECT id, project_id, name, created_at, updated_at
        FROM namespaces
        WHERE project_id = ?1
        ORDER BY name
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list namespaces."))
}

pub async fn create_namespace(
    pool: &SqlitePool,
    project_id: &str,
    name: &str,
) -> AppResult<NamespaceRecord> {
    let now = now_utc()?;
    let record = NamespaceRecord {
        id: Uuid::new_v4().to_string(),
        project_id: project_id.to_owned(),
        name: name.trim().to_owned(),
        created_at: now.clone(),
        updated_at: now,
    };

    sqlx::query(
        r#"
        INSERT INTO namespaces (id, project_id, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(&record.id)
    .bind(&record.project_id)
    .bind(&record.name)
    .bind(&record.created_at)
    .bind(&record.updated_at)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Namespace already exists in this project."))?;

    Ok(record)
}

pub async fn delete_namespace(
    pool: &SqlitePool,
    project_id: &str,
    namespace_name: &str,
) -> AppResult<()> {
    let result =
        sqlx::query("DELETE FROM namespaces WHERE project_id = ?1 AND name = ?2")
            .bind(project_id)
            .bind(namespace_name)
            .execute(pool)
            .await
            .map_err(|e| ApiError::from_sqlx(e, "Unable to delete the namespace."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Namespace was not found."));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

pub async fn list_environments(
    pool: &SqlitePool,
    project_id: &str,
) -> AppResult<Vec<EnvironmentRecord>> {
    sqlx::query_as::<_, EnvironmentRecord>(
        r#"
        SELECT id, project_id, name, slug, created_at, updated_at
        FROM environments
        WHERE project_id = ?1
        ORDER BY name
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list environments."))
}

pub async fn create_environment(
    pool: &SqlitePool,
    project_id: &str,
    name: &str,
    slug: &str,
) -> AppResult<EnvironmentRecord> {
    let now = now_utc()?;
    let record = EnvironmentRecord {
        id: Uuid::new_v4().to_string(),
        project_id: project_id.to_owned(),
        name: name.trim().to_owned(),
        slug: slug.trim().to_owned(),
        created_at: now.clone(),
        updated_at: now,
    };

    sqlx::query(
        r#"
        INSERT INTO environments (id, project_id, name, slug, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(&record.id)
    .bind(&record.project_id)
    .bind(&record.name)
    .bind(&record.slug)
    .bind(&record.created_at)
    .bind(&record.updated_at)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Environment slug already exists in this project."))?;

    Ok(record)
}

pub async fn delete_environment(
    pool: &SqlitePool,
    project_id: &str,
    environment_slug: &str,
) -> AppResult<()> {
    let result =
        sqlx::query("DELETE FROM environments WHERE project_id = ?1 AND slug = ?2")
            .bind(project_id)
            .bind(environment_slug)
            .execute(pool)
            .await
            .map_err(|e| ApiError::from_sqlx(e, "Unable to delete the environment."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Environment was not found."));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn insert_environment_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: &str,
    name: &str,
    slug: &str,
    now: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO environments (id, project_id, name, slug, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(project_id)
    .bind(name)
    .bind(slug)
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to create default environments."))?;

    Ok(())
}
