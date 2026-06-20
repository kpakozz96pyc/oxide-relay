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
    repository::{members, permissions, users},
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/users",
    responses((status = 200, body = [UserResponse]))
)]
pub async fn list_users(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> AppResult<Json<Vec<UserResponse>>> {
    auth::require_permission(&state, &user.id, "ManageUsers").await?;
    let records = users::list(&state.pool).await?;
    Ok(Json(records.into_iter().map(UserResponse::from).collect()))
}

#[utoipa::path(
    post,
    path = "/api/v1/users",
    request_body = CreateUserRequest,
    responses((status = 201, body = UserResponse))
)]
pub async fn create_user(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(payload): Json<CreateUserRequest>,
) -> AppResult<(StatusCode, Json<UserResponse>)> {
    auth::require_permission(&state, &user.id, "ManageUsers").await?;
    validate_create_user(&payload)?;

    let record = users::create(
        &state.pool,
        users::CreateUserInput {
            email: &payload.email,
            password: &payload.password,
            display_name: &payload.display_name,
            is_active: payload.is_active.unwrap_or(true),
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(UserResponse::from(record))))
}

#[utoipa::path(
    put,
    path = "/api/v1/users/{id}",
    params(("id" = String, Path, description = "User id")),
    request_body = UpdateUserRequest,
    responses((status = 200, body = UserResponse))
)]
pub async fn update_user(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(user_id): Path<String>,
    Json(payload): Json<UpdateUserRequest>,
) -> AppResult<Json<UserResponse>> {
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;
    validate_update_user(&payload)?;

    let record = users::update(
        &state.pool,
        &user_id,
        users::UpdateUserInput {
            email: payload.email.as_deref(),
            password: payload.password.as_deref(),
            display_name: payload.display_name.as_deref(),
            is_active: payload.is_active,
        },
    )
    .await?;

    Ok(Json(UserResponse::from(record)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/{id}",
    params(("id" = String, Path, description = "User id")),
    responses((status = 204))
)]
pub async fn delete_user(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(user_id): Path<String>,
) -> AppResult<StatusCode> {
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;
    users::delete(&state.pool, &user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/permissions",
    responses((status = 200, body = [PermissionResponse]))
)]
pub async fn list_permissions(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
) -> AppResult<Json<Vec<PermissionResponse>>> {
    auth::require_permission(&state, &actor.id, "ManagePermissions").await?;
    let records = permissions::list(&state.pool).await?;
    Ok(Json(records.into_iter().map(PermissionResponse::from).collect()))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{id}/permissions",
    params(("id" = String, Path, description = "User id")),
    responses((status = 200, body = [PermissionResponse]))
)]
pub async fn get_user_permissions(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(user_id): Path<String>,
) -> AppResult<Json<Vec<PermissionResponse>>> {
    auth::require_permission(&state, &actor.id, "ManagePermissions").await?;
    let records = permissions::list_for_user(&state.pool, &user_id).await?;
    Ok(Json(records.into_iter().map(PermissionResponse::from).collect()))
}

#[utoipa::path(
    put,
    path = "/api/v1/users/{id}/permissions",
    params(("id" = String, Path, description = "User id")),
    request_body = ReplaceUserPermissionsRequest,
    responses((status = 204))
)]
pub async fn replace_user_permissions(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(user_id): Path<String>,
    Json(payload): Json<ReplaceUserPermissionsRequest>,
) -> AppResult<StatusCode> {
    auth::require_permission(&state, &actor.id, "ManagePermissions").await?;
    permissions::replace_for_user(&state.pool, &user_id, &payload.permission_codes).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Project members
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/members",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [ProjectMemberResponse]))
)]
pub async fn list_project_members(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<ProjectMemberResponse>>> {
    let project =
        auth::authorize_project(&state, &actor, &project_slug, "ManageProjectMembers").await?;
    let records = members::list(&state.pool, &project.id).await?;
    Ok(Json(records.into_iter().map(ProjectMemberResponse::from).collect()))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects/{project_slug}/members",
    params(("project_slug" = String, Path, description = "Project slug")),
    request_body = AddProjectMemberRequest,
    responses((status = 201, body = ProjectMemberResponse))
)]
pub async fn add_project_member(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<AddProjectMemberRequest>,
) -> AppResult<(StatusCode, Json<ProjectMemberResponse>)> {
    let project =
        auth::authorize_project(&state, &actor, &project_slug, "ManageProjectMembers").await?;

    let user_id = payload.user_id.trim();
    if user_id.is_empty() {
        return Err(ApiError::validation("User ID is required."));
    }

    let record = members::add(&state.pool, &project.id, user_id).await?;
    Ok((StatusCode::CREATED, Json(ProjectMemberResponse::from(record))))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_slug}/members/{user_id}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("user_id" = String, Path, description = "User id")
    ),
    responses((status = 204))
)]
pub async fn delete_project_member(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path((project_slug, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project =
        auth::authorize_project(&state, &actor, &project_slug, "ManageProjectMembers").await?;

    if project.owner_user_id == user_id {
        return Err(ApiError::validation(
            "The project owner cannot be removed from project access.",
        ));
    }

    members::remove(&state.pool, &project.id, &user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_create_user(payload: &CreateUserRequest) -> AppResult<()> {
    if payload.email.trim().is_empty()
        || payload.display_name.trim().is_empty()
        || payload.password.trim().is_empty()
    {
        return Err(ApiError::validation(
            "Email, display name, and password are required.",
        ));
    }
    Ok(())
}

fn validate_update_user(payload: &UpdateUserRequest) -> AppResult<()> {
    if let Some(email) = &payload.email
        && email.trim().is_empty()
    {
        return Err(ApiError::validation("Email cannot be empty."));
    }
    if let Some(name) = &payload.display_name
        && name.trim().is_empty()
    {
        return Err(ApiError::validation("Display name cannot be empty."));
    }
    if let Some(password) = &payload.password
        && password.trim().is_empty()
    {
        return Err(ApiError::validation("Password cannot be empty."));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    pub display_name: String,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateUserRequest {
    pub email: Option<String>,
    pub password: Option<String>,
    pub display_name: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl From<users::UserRecord> for UserResponse {
    fn from(r: users::UserRecord) -> Self {
        Self {
            id: r.id,
            email: r.email,
            display_name: r.display_name,
            is_active: r.is_active,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PermissionResponse {
    pub id: String,
    pub code: String,
    pub description: Option<String>,
}

impl From<permissions::PermissionRecord> for PermissionResponse {
    fn from(r: permissions::PermissionRecord) -> Self {
        Self {
            id: r.id,
            code: r.code,
            description: r.description,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReplaceUserPermissionsRequest {
    pub permission_codes: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddProjectMemberRequest {
    pub user_id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectMemberResponse {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_active: bool,
    pub is_owner: bool,
    pub added_at: String,
}

impl From<members::MemberRecord> for ProjectMemberResponse {
    fn from(r: members::MemberRecord) -> Self {
        Self {
            id: r.id,
            email: r.email,
            display_name: r.display_name,
            is_active: r.is_active,
            is_owner: r.is_owner,
            added_at: r.added_at,
        }
    }
}
