use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use tracing::info;
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    auth::{self, AuthenticatedUser},
    errors::{ApiError, AppResult},
    repository::{members, password_resets, permissions, projects, users},
    util,
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
    require_any_admin_permission(&state, &user.id).await?;
    let records = users::list(&state.pool).await?;
    Ok(Json(records.into_iter().map(UserResponse::from).collect()))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/summary",
    params(
        ("search" = Option<String>, Query, description = "Filter by email or display name"),
        ("status" = Option<String>, Query, description = "Filter by status: active or inactive"),
        ("permission" = Option<String>, Query, description = "Filter by direct permission code"),
        ("project" = Option<String>, Query, description = "Filter by project slug")
    ),
    responses((status = 200, body = [UserSummaryResponse]))
)]
pub async fn list_user_summaries(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Query(query): Query<UserSummaryQuery>,
) -> AppResult<Json<Vec<UserSummaryResponse>>> {
    require_any_admin_permission(&state, &actor.id).await?;

    let status = match query.status.as_deref().map(str::trim) {
        Some("active") => Some(true),
        Some("inactive") => Some(false),
        Some("") | None => None,
        Some(_) => return Err(ApiError::validation("Unsupported user status filter.")),
    };

    let records = users::list_summaries(
        &state.pool,
        query.search.as_deref(),
        status,
        query.permission.as_deref(),
        query.project.as_deref(),
    )
    .await?;

    Ok(Json(
        records
            .into_iter()
            .map(UserSummaryResponse::from)
            .collect(),
    ))
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

    if payload.is_active == Some(false) {
        guard_last_active_administrator(&state, &user_id).await?;
    }

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
    guard_last_active_administrator(&state, &user_id).await?;
    users::delete(&state.pool, &user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/users/{id}/password-reset-link",
    params(("id" = String, Path, description = "User id")),
    responses((status = 200, body = GeneratePasswordResetLinkResponse))
)]
pub async fn generate_password_reset_link(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(user_id): Path<String>,
) -> AppResult<Json<GeneratePasswordResetLinkResponse>> {
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;

    let user = users::find_row_by_id(&state.pool, &user_id).await?;
    if !user.is_active {
        return Err(ApiError::validation(
            "Password reset links can only be generated for active users.",
        ));
    }

    let reset_link =
        password_resets::generate_reset_link(&state.pool, &user.id, &actor.id).await?;

    info!(
        actor_user_id = %actor.id,
        target_user_id = %user.id,
        "Generated password reset link"
    );

    Ok(Json(GeneratePasswordResetLinkResponse {
        reset_url: reset_link.reset_url,
        expires_at: reset_link.expires_at,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/catalog",
    responses((status = 200, body = [ProjectCatalogResponse]))
)]
pub async fn list_project_catalog(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
) -> AppResult<Json<Vec<ProjectCatalogResponse>>> {
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;
    let records = projects::list_catalog(&state.pool).await?;
    Ok(Json(
        records
            .into_iter()
            .map(ProjectCatalogResponse::from)
            .collect(),
    ))
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

    let keeps_manage_users = payload
        .permission_codes
        .iter()
        .any(|code| code.trim() == "ManageUsers");
    if !keeps_manage_users {
        guard_last_active_administrator(&state, &user_id).await?;
    }

    permissions::replace_for_user(&state.pool, &user_id, &payload.permission_codes).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{id}/project-access",
    params(("id" = String, Path, description = "User id")),
    responses((status = 200, body = [UserProjectAccessResponse]))
)]
pub async fn get_user_project_access(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(user_id): Path<String>,
) -> AppResult<Json<Vec<UserProjectAccessResponse>>> {
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;
    let can_manage_members = permissions::user_has_permission(&state.pool, &actor.id, "ManageProjectMembers").await?;
    let records = users::list_project_access(&state.pool, &user_id, &actor.id).await?;
    Ok(Json(
        records
            .into_iter()
            .map(|record| UserProjectAccessResponse::from_record(record, can_manage_members))
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/{id}/project-access",
    params(("id" = String, Path, description = "User id")),
    request_body = UpdateUserProjectAccessRequest,
    responses((status = 201, body = ProjectMemberResponse))
)]
pub async fn add_user_project_access(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path(user_id): Path<String>,
    Json(payload): Json<UpdateUserProjectAccessRequest>,
) -> AppResult<(StatusCode, Json<ProjectMemberResponse>)> {
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;
    let project_slug = payload.project_slug.trim();
    if project_slug.is_empty() {
        return Err(ApiError::validation("Project slug is required."));
    }

    let project =
        auth::authorize_project(&state, &actor, project_slug, "ManageProjectMembers").await?;

    if project.owner_user_id == user_id {
        return Err(ApiError::validation(
            "The project owner already has implicit access.",
        ));
    }

    let record = members::add(&state.pool, &project.id, &user_id).await?;
    Ok((StatusCode::CREATED, Json(ProjectMemberResponse::from(record))))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/{id}/project-access/{project_slug}",
    params(
        ("id" = String, Path, description = "User id"),
        ("project_slug" = String, Path, description = "Project slug")
    ),
    responses((status = 204))
)]
pub async fn delete_user_project_access(
    State(state): State<AppState>,
    actor: AuthenticatedUser,
    Path((user_id, project_slug)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;
    let project =
        auth::authorize_project(&state, &actor, &project_slug, "ManageProjectMembers").await?;

    if project.owner_user_id == user_id {
        return Err(ApiError::validation(
            "Project owner access cannot be removed here.",
        ));
    }

    members::remove(&state.pool, &project.id, &user_id).await?;
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
    util::validate_email(&payload.email)?;
    util::validate_display_name(&payload.display_name)?;
    util::validate_password(&payload.password)?;
    Ok(())
}

async fn require_any_admin_permission(state: &AppState, user_id: &str) -> AppResult<()> {
    let can_manage_users = permissions::user_has_permission(&state.pool, user_id, "ManageUsers").await?;
    let can_manage_permissions =
        permissions::user_has_permission(&state.pool, user_id, "ManagePermissions").await?;

    if can_manage_users || can_manage_permissions {
        return Ok(());
    }

    Err(ApiError::permission_denied(
        "Missing required permission: ManageUsers or ManagePermissions.",
    ))
}

/// Blocks removing, deactivating, or stripping ManageUsers from `user_id` when doing so
/// would leave the system with no active user holding ManageUsers.
async fn guard_last_active_administrator(state: &AppState, user_id: &str) -> AppResult<()> {
    let target = users::find_by_id(&state.pool, user_id).await?;
    if !target.is_active {
        return Ok(());
    }

    let has_manage_users =
        permissions::user_has_permission(&state.pool, user_id, "ManageUsers").await?;
    if !has_manage_users {
        return Ok(());
    }

    let remaining_admins =
        permissions::count_other_active_users_with_permission(&state.pool, user_id, "ManageUsers")
            .await?;
    if remaining_admins == 0 {
        return Err(ApiError::validation(
            "Cannot remove the last active administrator. At least one active user must keep the ManageUsers permission.",
        ));
    }

    Ok(())
}

fn validate_update_user(payload: &UpdateUserRequest) -> AppResult<()> {
    if let Some(email) = &payload.email
    {
        util::validate_email(email)?;
    }
    if let Some(name) = &payload.display_name
    {
        util::validate_display_name(name)?;
    }
    if let Some(password) = &payload.password
    {
        util::validate_password(password)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn create_user_validation_rejects_invalid_email() {
        let error = validate_create_user(&CreateUserRequest {
            email: "invalid-email".to_owned(),
            password: "valid-pass".to_owned(),
            display_name: "User".to_owned(),
            is_active: Some(true),
        })
        .expect_err("validation error");

        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn create_user_validation_rejects_short_password() {
        let error = validate_create_user(&CreateUserRequest {
            email: "user@example.com".to_owned(),
            password: "short".to_owned(),
            display_name: "User".to_owned(),
            is_active: Some(true),
        })
        .expect_err("validation error");

        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }
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

#[derive(Debug, Deserialize, IntoParams)]
pub struct UserSummaryQuery {
    pub search: Option<String>,
    pub status: Option<String>,
    pub permission: Option<String>,
    pub project: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GeneratePasswordResetLinkResponse {
    pub reset_url: String,
    pub expires_at: String,
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
pub struct UserSummaryResponse {
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

impl From<users::UserSummaryRecord> for UserSummaryResponse {
    fn from(r: users::UserSummaryRecord) -> Self {
        Self {
            id: r.id,
            email: r.email,
            display_name: r.display_name,
            is_active: r.is_active,
            created_at: r.created_at,
            updated_at: r.updated_at,
            direct_permissions_count: r.direct_permissions_count,
            project_access_count: r.project_access_count,
            selected_project_relation: r.selected_project_relation,
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
pub struct UpdateUserProjectAccessRequest {
    pub project_slug: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectCatalogResponse {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub owner_user_id: String,
}

impl From<projects::ProjectCatalogRecord> for ProjectCatalogResponse {
    fn from(r: projects::ProjectCatalogRecord) -> Self {
        Self {
            id: r.id,
            name: r.name,
            slug: r.slug,
            owner_user_id: r.owner_user_id,
        }
    }
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

#[derive(Debug, Serialize, ToSchema)]
pub struct UserProjectAccessResponse {
    pub project_id: String,
    pub project_name: String,
    pub project_slug: String,
    pub owner_user_id: String,
    pub relation: String,
    pub access_added_at: Option<String>,
    pub can_manage_access: bool,
}

impl UserProjectAccessResponse {
    fn from_record(record: users::UserProjectAccessRecord, actor_has_manage_project_members: bool) -> Self {
        let can_manage_access =
            record.actor_is_owner || (record.actor_has_access && actor_has_manage_project_members);

        Self {
            project_id: record.project_id,
            project_name: record.project_name,
            project_slug: record.project_slug,
            owner_user_id: record.owner_user_id,
            relation: record.relation,
            access_added_at: record.access_added_at,
            can_manage_access,
        }
    }
}
