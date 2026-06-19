use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::format_description::well_known::Rfc3339;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth,
    errors::{ApiError, AppResult},
};

#[utoipa::path(
    get,
    path = "/api/v1/projects",
    responses((status = 200, body = [ProjectResponse]), (status = 401, body = crate::errors::ErrorResponse))
)]
pub async fn list_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<ProjectResponse>>> {
    let user = auth::authenticated_user(&state, &headers).await?;

    let projects = sqlx::query_as::<_, ProjectResponse>(
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
    .bind(&user.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list projects."))?;

    Ok(Json(projects))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects",
    request_body = CreateProjectRequest,
    responses((status = 201, body = ProjectResponse))
)]
pub async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<ProjectResponse>)> {
    let user = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &user.id, "CreateProjects").await?;

    validate_project_name(&payload.name)?;
    validate_project_slug(&payload.slug)?;

    let now = now_utc()?;
    let project_id = Uuid::new_v4().to_string();

    let mut tx =
        state.pool.begin().await.map_err(|error| {
            ApiError::from_sqlx(error, "Unable to create the project transaction.")
        })?;

    sqlx::query(
        r#"
        INSERT INTO projects (id, name, slug, description, owner_user_id, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&project_id)
    .bind(payload.name.trim())
    .bind(payload.slug.trim())
    .bind(trimmed_optional(payload.description.as_deref()))
    .bind(&user.id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Project slug already exists."))?;

    sqlx::query(
        r#"
        INSERT INTO user_project_access (user_id, project_id, created_at)
        VALUES (?1, ?2, ?3)
        "#,
    )
    .bind(&user.id)
    .bind(&project_id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to create owner project access."))?;

    insert_environment(&mut tx, &project_id, "Development", "development", &now).await?;
    insert_environment(&mut tx, &project_id, "Staging", "staging", &now).await?;
    insert_environment(&mut tx, &project_id, "Production", "production", &now).await?;

    sqlx::query(
        r#"
        INSERT INTO namespaces (id, project_id, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&project_id)
    .bind("common")
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to create the default namespace."))?;

    tx.commit()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to commit project creation."))?;

    Ok((
        StatusCode::CREATED,
        Json(ProjectResponse {
            id: project_id,
            name: payload.name.trim().to_owned(),
            slug: payload.slug.trim().to_owned(),
            description: trimmed_optional(payload.description.as_deref()).map(ToOwned::to_owned),
            owner_user_id: user.id,
            created_at: now.clone(),
            updated_at: now,
            is_owner: true,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = ProjectResponse))
)]
pub async fn get_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
) -> AppResult<Json<ProjectResponse>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "ViewProjects").await?;

    Ok(Json(ProjectResponse::from_authorized(project)))
}

#[utoipa::path(
    put,
    path = "/api/v1/projects/{project_slug}",
    params(("project_slug" = String, Path, description = "Project slug")),
    request_body = UpdateProjectRequest,
    responses((status = 200, body = ProjectResponse))
)]
pub async fn update_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Json(payload): Json<UpdateProjectRequest>,
) -> AppResult<Json<ProjectResponse>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if let Some(name) = &payload.name {
        validate_project_name(name)?;
    }
    if let Some(slug) = &payload.slug {
        validate_project_slug(slug)?;
    }

    let name = payload
        .name
        .as_deref()
        .unwrap_or(&project.name)
        .trim()
        .to_owned();
    let slug = payload
        .slug
        .as_deref()
        .unwrap_or(&project.slug)
        .trim()
        .to_owned();
    let description = match payload.description {
        Some(description) => trimmed_optional(Some(description.as_str())).map(ToOwned::to_owned),
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
    .execute(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Project slug already exists."))?;

    Ok(Json(ProjectResponse {
        id: project.id,
        name,
        slug,
        description,
        owner_user_id: project.owner_user_id,
        created_at: project.created_at,
        updated_at: now,
        is_owner: project.is_owner,
    }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_slug}",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 204))
)]
pub async fn delete_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
) -> AppResult<StatusCode> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "DeleteProjects").await?;

    sqlx::query("DELETE FROM projects WHERE id = ?1")
        .bind(&project.id)
        .execute(&state.pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to delete the project."))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/languages",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [LanguageResponse]))
)]
pub async fn list_languages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<LanguageResponse>>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "ViewProjects").await?;

    let items = sqlx::query_as::<_, LanguageResponse>(
        r#"
        SELECT id, project_id, code, name, created_at, updated_at
        FROM languages
        WHERE project_id = ?1
        ORDER BY code
        "#,
    )
    .bind(&project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list languages."))?;

    Ok(Json(items))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects/{project_slug}/languages",
    params(("project_slug" = String, Path, description = "Project slug")),
    request_body = CreateLanguageRequest,
    responses((status = 201, body = LanguageResponse))
)]
pub async fn create_language(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateLanguageRequest>,
) -> AppResult<(StatusCode, Json<LanguageResponse>)> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if payload.code.trim().is_empty() || payload.name.trim().is_empty() {
        return Err(ApiError::validation("Language code and name are required."));
    }

    let now = now_utc()?;
    let item = LanguageResponse {
        id: Uuid::new_v4().to_string(),
        project_id: project.id,
        code: payload.code.trim().to_owned(),
        name: payload.name.trim().to_owned(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    sqlx::query(
        r#"
        INSERT INTO languages (id, project_id, code, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(&item.id)
    .bind(&item.project_id)
    .bind(&item.code)
    .bind(&item.name)
    .bind(&item.created_at)
    .bind(&item.updated_at)
    .execute(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Language code already exists in this project."))?;

    Ok((StatusCode::CREATED, Json(item)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_slug}/languages/{language_code}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("language_code" = String, Path, description = "Language code")
    ),
    responses((status = 204))
)]
pub async fn delete_language(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_slug, language_code)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    let result = sqlx::query("DELETE FROM languages WHERE project_id = ?1 AND code = ?2")
        .bind(&project.id)
        .bind(language_code)
        .execute(&state.pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to delete the language."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Language was not found."));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/namespaces",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [NamespaceResponse]))
)]
pub async fn list_namespaces(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<NamespaceResponse>>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "ViewProjects").await?;

    let items = sqlx::query_as::<_, NamespaceResponse>(
        r#"
        SELECT id, project_id, name, created_at, updated_at
        FROM namespaces
        WHERE project_id = ?1
        ORDER BY name
        "#,
    )
    .bind(&project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list namespaces."))?;

    Ok(Json(items))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects/{project_slug}/namespaces",
    params(("project_slug" = String, Path, description = "Project slug")),
    request_body = CreateNamespaceRequest,
    responses((status = 201, body = NamespaceResponse))
)]
pub async fn create_namespace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateNamespaceRequest>,
) -> AppResult<(StatusCode, Json<NamespaceResponse>)> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if payload.name.trim().is_empty() {
        return Err(ApiError::validation("Namespace name is required."));
    }

    let now = now_utc()?;
    let item = NamespaceResponse {
        id: Uuid::new_v4().to_string(),
        project_id: project.id,
        name: payload.name.trim().to_owned(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    sqlx::query(
        r#"
        INSERT INTO namespaces (id, project_id, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(&item.id)
    .bind(&item.project_id)
    .bind(&item.name)
    .bind(&item.created_at)
    .bind(&item.updated_at)
    .execute(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Namespace already exists in this project."))?;

    Ok((StatusCode::CREATED, Json(item)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_slug}/namespaces/{namespace}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("namespace" = String, Path, description = "Namespace")
    ),
    responses((status = 204))
)]
pub async fn delete_namespace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_slug, namespace)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    let result = sqlx::query("DELETE FROM namespaces WHERE project_id = ?1 AND name = ?2")
        .bind(&project.id)
        .bind(namespace)
        .execute(&state.pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to delete the namespace."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Namespace was not found."));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/environments",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [EnvironmentResponse]))
)]
pub async fn list_environments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<EnvironmentResponse>>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "ViewProjects").await?;

    let items = sqlx::query_as::<_, EnvironmentResponse>(
        r#"
        SELECT id, project_id, name, slug, created_at, updated_at
        FROM environments
        WHERE project_id = ?1
        ORDER BY name
        "#,
    )
    .bind(&project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list environments."))?;

    Ok(Json(items))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects/{project_slug}/environments",
    params(("project_slug" = String, Path, description = "Project slug")),
    request_body = CreateEnvironmentRequest,
    responses((status = 201, body = EnvironmentResponse))
)]
pub async fn create_environment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateEnvironmentRequest>,
) -> AppResult<(StatusCode, Json<EnvironmentResponse>)> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if payload.name.trim().is_empty() || payload.slug.trim().is_empty() {
        return Err(ApiError::validation(
            "Environment name and slug are required.",
        ));
    }

    let now = now_utc()?;
    let item = EnvironmentResponse {
        id: Uuid::new_v4().to_string(),
        project_id: project.id,
        name: payload.name.trim().to_owned(),
        slug: payload.slug.trim().to_owned(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    sqlx::query(
        r#"
        INSERT INTO environments (id, project_id, name, slug, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(&item.id)
    .bind(&item.project_id)
    .bind(&item.name)
    .bind(&item.slug)
    .bind(&item.created_at)
    .bind(&item.updated_at)
    .execute(&state.pool)
    .await
    .map_err(|error| {
        ApiError::from_sqlx(error, "Environment slug already exists in this project.")
    })?;

    Ok((StatusCode::CREATED, Json(item)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_slug}/environments/{environment_slug}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("environment_slug" = String, Path, description = "Environment slug")
    ),
    responses((status = 204))
)]
pub async fn delete_environment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_slug, environment_slug)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    let result = sqlx::query("DELETE FROM environments WHERE project_id = ?1 AND slug = ?2")
        .bind(&project.id)
        .bind(environment_slug)
        .execute(&state.pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to delete the environment."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Environment was not found."));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn insert_environment(
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
    .map_err(|error| ApiError::from_sqlx(error, "Unable to create default environments."))?;

    Ok(())
}

fn validate_project_name(value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(ApiError::validation("Project name is required."));
    }
    Ok(())
}

fn validate_project_slug(value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(ApiError::validation("Project slug is required."));
    }
    Ok(())
}

fn trimmed_optional(value: Option<&str>) -> Option<&str> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn now_utc() -> AppResult<String> {
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ApiError::internal(format!("Unable to format current time: {error}")))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateProjectRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct ProjectResponse {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub owner_user_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_owner: bool,
}

impl ProjectResponse {
    fn from_authorized(project: auth::AuthorizedProject) -> Self {
        Self {
            id: project.id,
            name: project.name,
            slug: project.slug,
            description: project.description,
            owner_user_id: project.owner_user_id,
            created_at: project.created_at,
            updated_at: project.updated_at,
            is_owner: project.is_owner,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateLanguageRequest {
    pub code: String,
    pub name: String,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct LanguageResponse {
    pub id: String,
    pub project_id: String,
    pub code: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateNamespaceRequest {
    pub name: String,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct NamespaceResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateEnvironmentRequest {
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct EnvironmentResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub created_at: String,
    pub updated_at: String,
}
