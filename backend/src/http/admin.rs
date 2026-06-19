use std::collections::BTreeMap;

use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString},
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row};
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
    path = "/api/v1/users",
    responses((status = 200, body = [UserResponse]))
)]
pub async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<UserResponse>>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &user.id, "ManageUsers").await?;

    let users = sqlx::query_as::<_, UserResponse>(
        r#"
        SELECT id, email, display_name, is_active, created_at, updated_at
        FROM users
        ORDER BY email
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list users."))?;

    Ok(Json(users))
}

#[utoipa::path(
    post,
    path = "/api/v1/users",
    request_body = CreateUserRequest,
    responses((status = 201, body = UserResponse))
)]
pub async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateUserRequest>,
) -> AppResult<(StatusCode, Json<UserResponse>)> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;
    validate_create_user(&payload)?;

    let now = now_utc()?;
    let item = UserResponse {
        id: Uuid::new_v4().to_string(),
        email: payload.email.trim().to_lowercase(),
        display_name: payload.display_name.trim().to_owned(),
        is_active: payload.is_active.unwrap_or(true),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, display_name, is_active, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&item.id)
    .bind(&item.email)
    .bind(hash_password(payload.password.trim())?)
    .bind(&item.display_name)
    .bind(if item.is_active { 1 } else { 0 })
    .bind(&item.created_at)
    .bind(&item.updated_at)
    .execute(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "User email already exists."))?;

    Ok((StatusCode::CREATED, Json(item)))
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
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(payload): Json<UpdateUserRequest>,
) -> AppResult<Json<UserResponse>> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;

    let existing = find_user(&state, &user_id).await?;
    validate_update_user(&payload)?;

    let email = payload
        .email
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .unwrap_or(existing.email.clone());
    let display_name = payload
        .display_name
        .as_deref()
        .map(|value| value.trim().to_owned())
        .unwrap_or(existing.display_name.clone());
    let is_active = payload.is_active.unwrap_or(existing.is_active);
    let updated_at = now_utc()?;

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
    .bind(
        payload
            .password
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(hash_password)
            .transpose()?,
    )
    .bind(&display_name)
    .bind(if is_active { 1 } else { 0 })
    .bind(&updated_at)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "User email already exists."))?;

    Ok(Json(UserResponse {
        id: existing.id,
        email,
        display_name,
        is_active,
        created_at: existing.created_at,
        updated_at,
    }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/{id}",
    params(("id" = String, Path, description = "User id")),
    responses((status = 204))
)]
pub async fn delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> AppResult<StatusCode> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &actor.id, "ManageUsers").await?;

    let result = sqlx::query("DELETE FROM users WHERE id = ?1")
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to delete the user."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("User was not found."));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/permissions",
    responses((status = 200, body = [PermissionResponse]))
)]
pub async fn list_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<PermissionResponse>>> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &actor.id, "ManagePermissions").await?;

    let items = sqlx::query_as::<_, PermissionResponse>(
        r#"
        SELECT id, code, description
        FROM permissions
        ORDER BY code
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list permissions."))?;

    Ok(Json(items))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{id}/permissions",
    params(("id" = String, Path, description = "User id")),
    responses((status = 200, body = [PermissionResponse]))
)]
pub async fn get_user_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> AppResult<Json<Vec<PermissionResponse>>> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &actor.id, "ManagePermissions").await?;

    let permissions = sqlx::query_as::<_, PermissionResponse>(
        r#"
        SELECT p.id, p.code, p.description
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ?1
        ORDER BY p.code
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load user permissions."))?;

    Ok(Json(permissions))
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
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(payload): Json<ReplaceUserPermissionsRequest>,
) -> AppResult<StatusCode> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    auth::require_permission(&state, &actor.id, "ManagePermissions").await?;

    let permission_ids = resolve_permission_ids(&state, &payload.permission_codes).await?;

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to start permission update."))?;

    sqlx::query("DELETE FROM user_permissions WHERE user_id = ?1")
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to clear user permissions."))?;

    for permission_id in permission_ids {
        sqlx::query(
            r#"
            INSERT INTO user_permissions (user_id, permission_id)
            VALUES (?1, ?2)
            "#,
        )
        .bind(&user_id)
        .bind(permission_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to assign user permissions."))?;
    }

    tx.commit()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to commit permission update."))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/members",
    params(("project_slug" = String, Path, description = "Project slug")),
    responses((status = 200, body = [ProjectMemberResponse]))
)]
pub async fn list_project_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_slug): Path<String>,
) -> AppResult<Json<Vec<ProjectMemberResponse>>> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    let project =
        auth::authorize_project(&state, &actor, &project_slug, "ManageProjectMembers").await?;

    let members = sqlx::query_as::<_, ProjectMemberResponse>(
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
    .bind(&project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list project members."))?;

    Ok(Json(members))
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
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Json(payload): Json<AddProjectMemberRequest>,
) -> AppResult<(StatusCode, Json<ProjectMemberResponse>)> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    let project =
        auth::authorize_project(&state, &actor, &project_slug, "ManageProjectMembers").await?;

    let user_id = payload.user_id.trim();
    if user_id.is_empty() {
        return Err(ApiError::validation("User ID is required."));
    }

    let added_at = now_utc()?;
    sqlx::query(
        r#"
        INSERT INTO user_project_access (user_id, project_id, created_at)
        VALUES (?1, ?2, ?3)
        "#,
    )
    .bind(user_id)
    .bind(&project.id)
    .bind(&added_at)
    .execute(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Project member already exists."))?;

    let item = sqlx::query_as::<_, ProjectMemberResponse>(
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
    .bind(&project.id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load the project member."))?
    .ok_or_else(|| ApiError::not_found("User was not found."))?;

    Ok((StatusCode::CREATED, Json(item)))
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
    headers: HeaderMap,
    Path((project_slug, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let actor = auth::authenticated_user(&state, &headers).await?;
    let project =
        auth::authorize_project(&state, &actor, &project_slug, "ManageProjectMembers").await?;

    if project.owner_user_id == user_id {
        return Err(ApiError::validation(
            "The project owner cannot be removed from project access.",
        ));
    }

    let result = sqlx::query(
        r#"
        DELETE FROM user_project_access
        WHERE project_id = ?1 AND user_id = ?2
        "#,
    )
    .bind(&project.id)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to delete the project member."))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Project member was not found."));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn find_user(state: &AppState, user_id: &str) -> AppResult<UserResponse> {
    sqlx::query_as::<_, UserResponse>(
        r#"
        SELECT id, email, display_name, is_active, created_at, updated_at
        FROM users
        WHERE id = ?1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load the user."))?
    .ok_or_else(|| ApiError::not_found("User was not found."))
}

async fn resolve_permission_ids(
    state: &AppState,
    permission_codes: &[String],
) -> AppResult<Vec<String>> {
    let normalized: Vec<String> = permission_codes
        .iter()
        .map(|code| code.trim().to_owned())
        .filter(|code| !code.is_empty())
        .collect();

    let permissions = sqlx::query(
        r#"
        SELECT id, code
        FROM permissions
        WHERE code IN (SELECT value FROM json_each(?1))
        "#,
    )
    .bind(serde_json::to_string(&normalized).map_err(|error| {
        ApiError::internal(format!("Unable to encode permission codes: {error}"))
    })?)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to resolve permissions."))?;

    let mut found = BTreeMap::new();
    for row in permissions {
        let id: String = row.get("id");
        let code: String = row.get("code");
        found.insert(code, id);
    }

    if found.len() != normalized.len() {
        return Err(ApiError::validation(
            "One or more permission codes are not part of the seeded permission catalog.",
        ));
    }

    Ok(normalized
        .into_iter()
        .filter_map(|code| found.get(&code).cloned())
        .collect())
}

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

fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| ApiError::internal(format!("Unable to hash password: {error}")))
        .map(|hash| hash.to_string())
}

fn now_utc() -> AppResult<String> {
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ApiError::internal(format!("Unable to format current time: {error}")))
}

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

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct PermissionResponse {
    pub id: String,
    pub code: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReplaceUserPermissionsRequest {
    pub permission_codes: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddProjectMemberRequest {
    pub user_id: String,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct ProjectMemberResponse {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_active: bool,
    pub is_owner: bool,
    pub added_at: String,
}
