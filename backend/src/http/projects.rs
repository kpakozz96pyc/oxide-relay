use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    app::AppState,
    auth::{self, AuthenticatedUser},
    errors::{ApiError, AppResult},
    repository::projects,
    util::{optional_trimmed, validate_max_length},
};

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/projects",
    responses((status = 200, body = [ProjectResponse]), (status = 401, body = crate::errors::ErrorResponse))
)]
pub async fn list_projects(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> AppResult<Json<Vec<ProjectResponse>>> {
    let records = projects::list_for_user(&state.pool, &user.id).await?;
    Ok(Json(records.into_iter().map(ProjectResponse::from).collect()))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects",
    request_body = CreateProjectRequest,
    responses((status = 201, body = ProjectResponse))
)]
pub async fn create_project(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(payload): Json<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<ProjectResponse>)> {
    auth::require_permission(&state, &user.id, "CreateProjects").await?;
    validate_project_name(&payload.name)?;
    validate_project_slug(&payload.slug)?;

    let record = projects::create(
        &state.pool,
        projects::CreateProjectInput {
            name: &payload.name,
            slug: &payload.slug,
            description: payload.description.as_deref(),
            owner_user_id: &user.id,
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(ProjectResponse::from(record))))
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = ProjectResponse))
)]
pub async fn get_project(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
) -> AppResult<Json<ProjectResponse>> {
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
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<UpdateProjectRequest>,
) -> AppResult<Json<ProjectResponse>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if let Some(name) = &payload.name {
        validate_project_name(name)?;
    }
    if let Some(slug) = &payload.slug {
        validate_project_slug(slug)?;
    }

    // Convert from AuthorizedProject → repository ProjectRecord shape
    let current = projects::ProjectRecord {
        id: project.id.clone(),
        name: project.name.clone(),
        slug: project.slug.clone(),
        description: project.description.clone(),
        owner_user_id: project.owner_user_id.clone(),
        created_at: project.created_at.clone(),
        updated_at: project.updated_at.clone(),
        is_owner: project.is_owner,
    };

    let updated = projects::update(
        &state.pool,
        &current,
        projects::UpdateProjectInput {
            name: payload.name.as_deref(),
            slug: payload.slug.as_deref(),
            description: payload.description.as_ref().map(|d| optional_trimmed(Some(d.as_str()))),
        },
    )
    .await?;

    Ok(Json(ProjectResponse::from(updated)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_slug}",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 204))
)]
pub async fn delete_project(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
) -> AppResult<StatusCode> {
    let project = auth::authorize_project(&state, &user, &project_slug, "DeleteProjects").await?;
    projects::delete(&state.pool, &project.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/languages",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [LanguageResponse]))
)]
pub async fn list_languages(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<LanguageResponse>>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "ViewProjects").await?;
    let records = projects::list_languages(&state.pool, &project.id).await?;
    Ok(Json(records.into_iter().map(LanguageResponse::from).collect()))
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
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateLanguageRequest>,
) -> AppResult<(StatusCode, Json<LanguageResponse>)> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if payload.code.trim().is_empty() || payload.name.trim().is_empty() {
        return Err(ApiError::validation("Language code and name are required."));
    }

    let record =
        projects::create_language(&state.pool, &project.id, &payload.code, &payload.name).await?;

    Ok((StatusCode::CREATED, Json(LanguageResponse::from(record))))
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
    user: AuthenticatedUser,
    Path((project_slug, language_code)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;
    projects::delete_language(&state.pool, &project.id, &language_code).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/namespaces",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [NamespaceResponse]))
)]
pub async fn list_namespaces(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<NamespaceResponse>>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "ViewProjects").await?;
    let records = projects::list_namespaces(&state.pool, &project.id).await?;
    Ok(Json(records.into_iter().map(NamespaceResponse::from).collect()))
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
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateNamespaceRequest>,
) -> AppResult<(StatusCode, Json<NamespaceResponse>)> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if payload.name.trim().is_empty() {
        return Err(ApiError::validation("Namespace name is required."));
    }

    let record = projects::create_namespace(&state.pool, &project.id, &payload.name).await?;
    Ok((StatusCode::CREATED, Json(NamespaceResponse::from(record))))
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
    user: AuthenticatedUser,
    Path((project_slug, namespace)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;
    projects::delete_namespace(&state.pool, &project.id, &namespace).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/environments",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [EnvironmentResponse]))
)]
pub async fn list_environments(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<EnvironmentResponse>>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "ViewProjects").await?;
    let records = projects::list_environments(&state.pool, &project.id).await?;
    Ok(Json(records.into_iter().map(EnvironmentResponse::from).collect()))
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
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateEnvironmentRequest>,
) -> AppResult<(StatusCode, Json<EnvironmentResponse>)> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;

    if payload.name.trim().is_empty() || payload.slug.trim().is_empty() {
        return Err(ApiError::validation(
            "Environment name and slug are required.",
        ));
    }

    let record =
        projects::create_environment(&state.pool, &project.id, &payload.name, &payload.slug)
            .await?;

    Ok((StatusCode::CREATED, Json(EnvironmentResponse::from(record))))
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
    user: AuthenticatedUser,
    Path((project_slug, environment_slug)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditProjects").await?;
    projects::delete_environment(&state.pool, &project.id, &environment_slug).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_project_name(value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(ApiError::validation("Project name is required."));
    }
    validate_max_length(value, 200, "Project name")?;
    Ok(())
}

fn validate_project_slug(value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(ApiError::validation("Project slug is required."));
    }
    validate_max_length(value, 100, "Project slug")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

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

#[derive(Debug, Serialize, ToSchema)]
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

impl From<projects::ProjectRecord> for ProjectResponse {
    fn from(r: projects::ProjectRecord) -> Self {
        Self {
            id: r.id,
            name: r.name,
            slug: r.slug,
            description: r.description,
            owner_user_id: r.owner_user_id,
            created_at: r.created_at,
            updated_at: r.updated_at,
            is_owner: r.is_owner,
        }
    }
}

impl ProjectResponse {
    pub fn from_authorized(p: auth::AuthorizedProject) -> Self {
        Self {
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            owner_user_id: p.owner_user_id,
            created_at: p.created_at,
            updated_at: p.updated_at,
            is_owner: p.is_owner,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateLanguageRequest {
    pub code: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LanguageResponse {
    pub id: String,
    pub project_id: String,
    pub code: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<projects::LanguageRecord> for LanguageResponse {
    fn from(r: projects::LanguageRecord) -> Self {
        Self {
            id: r.id,
            project_id: r.project_id,
            code: r.code,
            name: r.name,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateNamespaceRequest {
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NamespaceResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<projects::NamespaceRecord> for NamespaceResponse {
    fn from(r: projects::NamespaceRecord) -> Self {
        Self {
            id: r.id,
            project_id: r.project_id,
            name: r.name,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateEnvironmentRequest {
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EnvironmentResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<projects::EnvironmentRecord> for EnvironmentResponse {
    fn from(r: projects::EnvironmentRecord) -> Self {
        Self {
            id: r.id,
            project_id: r.project_id,
            name: r.name,
            slug: r.slug,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}
