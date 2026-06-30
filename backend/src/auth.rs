use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordVerifier},
};
use axum::{
    Json,
    extract::{FromRequestParts, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{COOKIE, SET_COOKIE},
        request::Parts,
    },
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    app::AppState,
    errors::{ApiError, AppResult},
    repository::{password_resets, permissions, sessions, users},
    util,
};

// ---------------------------------------------------------------------------
// Login / logout / me handlers
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, body = AuthResponse),
        (status = 400, body = crate::errors::ErrorResponse),
        (status = 401, body = crate::errors::ErrorResponse)
    )
)]
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> AppResult<impl IntoResponse> {
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() || payload.password.is_empty() {
        return Err(ApiError::validation("Email and password are required."));
    }

    let user = sqlx::query_as::<_, UserRecord>(
        r#"
        SELECT id, email, password_hash, display_name, is_active
        FROM users
        WHERE email = ?1
        "#,
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load the user."))?
    .ok_or_else(|| ApiError::unauthorized("Invalid email or password."))?;

    if !user.is_active {
        return Err(ApiError::unauthorized("This user is inactive."));
    }

    verify_password(&payload.password, &user.password_hash)?;

    // Opportunistically clean up expired sessions to prevent unbounded growth.
    let _ = sessions::purge_expired(&state.pool).await;

    let session_id = Uuid::new_v4().to_string();
    let expires_at = future_utc(state.session.ttl_hours)?;

    sessions::create_session(&state.pool, &user.id, &session_id, &expires_at).await?;

    let cookie = build_session_cookie(
        &state.session.cookie_name,
        &session_id,
        state.session.ttl_hours,
        state.session.cookie_secure,
    )?;

    let mut response = Json(AuthResponse {
        user: AuthenticatedUser {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
        },
    })
    .into_response();

    response.headers_mut().insert(SET_COOKIE, cookie);

    Ok(response)
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    responses(
        (status = 204),
        (status = 500, body = crate::errors::ErrorResponse)
    )
)]
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    if let Some(session_id) = read_session_cookie(&headers, &state.session.cookie_name) {
        sessions::delete_session(&state.pool, &session_id).await?;
    }

    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        clear_session_cookie(&state.session.cookie_name, state.session.cookie_secure)?,
    );

    Ok(response)
}

#[utoipa::path(
    get,
    path = "/api/v1/me",
    responses(
        (status = 200, body = MeResponse),
        (status = 401, body = crate::errors::ErrorResponse)
    )
)]
pub async fn me(user: AuthenticatedUser) -> AppResult<Json<MeResponse>> {
    Ok(Json(MeResponse { user }))
}

#[utoipa::path(
    get,
    path = "/api/v1/me/permissions",
    responses(
        (status = 200, body = MePermissionsResponse),
        (status = 401, body = crate::errors::ErrorResponse)
    )
)]
pub async fn me_permissions(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> AppResult<Json<MePermissionsResponse>> {
    let permission_codes = permissions::list_codes_for_user(&state.pool, &user.id).await?;
    Ok(Json(MePermissionsResponse {
        permissions: permission_codes,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/reset-password",
    request_body = ResetPasswordRequest,
    responses(
        (status = 204),
        (status = 400, body = crate::errors::ErrorResponse)
    )
)]
pub async fn reset_password(
    State(state): State<AppState>,
    Json(payload): Json<ResetPasswordRequest>,
) -> AppResult<StatusCode> {
    let token = util::required_non_empty(&payload.token, "Reset token is required.")?;
    let password = util::validate_password(&payload.password)?;

    let _ = password_resets::purge_expired(&state.pool).await;

    let token_hash = util::sha256_hex(token);
    let reset_token = password_resets::find_active_token_by_hash(&state.pool, &token_hash).await?;
    let password_hash = util::hash_password(password)?;
    let used_at = util::now_utc()?;

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to start password reset."))?;

    users::update_password_hash_in_connection(
        &mut transaction,
        &reset_token.user_id,
        &password_hash,
        &used_at,
    )
    .await?;
    password_resets::mark_token_used(&mut transaction, &reset_token.id, &used_at).await?;
    sessions::delete_sessions_for_user_in_connection(&mut transaction, &reset_token.user_id).await?;

    transaction
        .commit()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to complete password reset."))?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Axum extractor: AuthenticatedUser
// ---------------------------------------------------------------------------

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let session_id = read_session_cookie(&parts.headers, &state.session.cookie_name)
            .ok_or_else(|| ApiError::unauthorized("Authentication is required."))?;
        let now = util::now_utc()?;

        let user = sqlx::query_as::<_, AuthenticatedUser>(
            r#"
            SELECT u.id, u.email, u.display_name
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ?1
              AND s.expires_at > ?2
              AND u.is_active = 1
            "#,
        )
        .bind(&session_id)
        .bind(now)
        .fetch_optional(&state.pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to load the current user."))?
        .ok_or_else(|| ApiError::unauthorized("Authentication is required."))?;

        Ok(user)
    }
}

// ---------------------------------------------------------------------------
// Authorization helpers (kept public for use in HTTP handlers)
// ---------------------------------------------------------------------------

pub async fn require_permission(
    state: &AppState,
    user_id: &str,
    permission_code: &str,
) -> AppResult<()> {
    let has = permissions::user_has_permission(&state.pool, user_id, permission_code).await?;

    if !has {
        return Err(ApiError::permission_denied(format!(
            "Missing required permission: {permission_code}."
        )));
    }

    Ok(())
}

pub async fn authorize_project(
    state: &AppState,
    user: &AuthenticatedUser,
    project_slug: &str,
    permission_code: &str,
) -> AppResult<AuthorizedProject> {
    let project = sqlx::query_as::<_, AuthorizedProject>(
        r#"
        SELECT
            p.id,
            p.name,
            p.slug,
            p.description,
            p.owner_user_id,
            p.created_at,
            p.updated_at,
            CASE WHEN p.owner_user_id = ?1 THEN 1 ELSE 0 END AS is_owner,
            CASE WHEN upa.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_access
        FROM projects p
        LEFT JOIN user_project_access upa
            ON upa.project_id = p.id
           AND upa.user_id = ?1
        WHERE p.slug = ?2
        "#,
    )
    .bind(&user.id)
    .bind(project_slug)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load the project."))?
    .ok_or_else(|| ApiError::not_found("Project was not found."))?;

    if project.is_owner {
        return Ok(project);
    }

    if !project.has_access {
        return Err(ApiError::not_found("Project was not found."));
    }

    require_permission(state, &user.id, permission_code).await?;

    Ok(project)
}

pub async fn require_environment_permission(
    state: &AppState,
    user: &AuthenticatedUser,
    project: &AuthorizedProject,
    access_kind: EnvironmentAccessKind,
    environment_slug: &str,
) -> AppResult<()> {
    if project.is_owner {
        return Ok(());
    }

    let permission_code = match access_kind {
        EnvironmentAccessKind::Read => read_environment_permission_code(environment_slug),
        EnvironmentAccessKind::Edit => edit_environment_permission_code(environment_slug),
    }
    .ok_or_else(|| ApiError::validation("Unsupported environment slug."))?;

    require_permission(state, &user.id, permission_code).await
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

fn read_session_cookie(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
    headers.get(COOKIE).and_then(|header| {
        header.to_str().ok().and_then(|value| {
            value.split(';').find_map(|part| {
                let trimmed = part.trim();
                let (name, value) = trimmed.split_once('=')?;
                if name == cookie_name {
                    Some(value.to_owned())
                } else {
                    None
                }
            })
        })
    })
}

fn verify_password(password: &str, password_hash: &str) -> AppResult<()> {
    let parsed = PasswordHash::new(password_hash)
        .map_err(|_| ApiError::unauthorized("Invalid email or password."))?;

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| ApiError::unauthorized("Invalid email or password."))?;

    Ok(())
}

fn build_session_cookie(
    cookie_name: &str,
    session_id: &str,
    ttl_hours: i64,
    cookie_secure: bool,
) -> AppResult<HeaderValue> {
    let max_age = ttl_hours
        .checked_mul(60 * 60)
        .ok_or_else(|| ApiError::internal("Invalid session lifetime."))?;

    let secure = if cookie_secure { "; Secure" } else { "" };

    HeaderValue::from_str(&format!(
        "{cookie_name}={session_id}; Path=/; HttpOnly; Max-Age={max_age}; SameSite=Lax{secure}"
    ))
    .map_err(|_| ApiError::internal("Unable to serialize the session cookie."))
}

fn clear_session_cookie(cookie_name: &str, cookie_secure: bool) -> AppResult<HeaderValue> {
    let secure = if cookie_secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{cookie_name}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax{secure}"
    ))
    .map_err(|_| ApiError::internal("Unable to clear the session cookie."))
}

fn future_utc(ttl_hours: i64) -> AppResult<String> {
    (OffsetDateTime::now_utc() + Duration::hours(ttl_hours))
        .format(&Rfc3339)
        .map_err(|error| ApiError::internal(format!("Unable to format expiration time: {error}")))
}

// ---------------------------------------------------------------------------
// Permission code helpers for environments
// ---------------------------------------------------------------------------

fn read_environment_permission_code(environment_slug: &str) -> Option<&'static str> {
    match environment_slug {
        "development" => Some("ReadDevelopment"),
        "staging" => Some("ReadStaging"),
        "production" => Some("ReadProduction"),
        _ => None,
    }
}

fn edit_environment_permission_code(environment_slug: &str) -> Option<&'static str> {
    match environment_slug {
        "development" => Some("EditDevelopment"),
        "staging" => Some("EditStaging"),
        "production" => Some("EditProduction"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuthResponse {
    pub user: AuthenticatedUser,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MeResponse {
    pub user: AuthenticatedUser,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MePermissionsResponse {
    pub permissions: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct AuthenticatedUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, FromRow)]
struct UserRecord {
    id: String,
    email: String,
    password_hash: String,
    display_name: String,
    is_active: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum EnvironmentAccessKind {
    Read,
    Edit,
}

#[derive(Debug, Clone, FromRow)]
pub struct AuthorizedProject {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub owner_user_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_owner: bool,
    pub has_access: bool,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_permission_codes_match_supported_slugs() {
        assert_eq!(
            read_environment_permission_code("development"),
            Some("ReadDevelopment")
        );
        assert_eq!(
            read_environment_permission_code("staging"),
            Some("ReadStaging")
        );
        assert_eq!(
            read_environment_permission_code("production"),
            Some("ReadProduction")
        );
        assert_eq!(
            edit_environment_permission_code("development"),
            Some("EditDevelopment")
        );
        assert_eq!(
            edit_environment_permission_code("staging"),
            Some("EditStaging")
        );
        assert_eq!(
            edit_environment_permission_code("production"),
            Some("EditProduction")
        );
        assert_eq!(read_environment_permission_code("prod"), None);
        assert_eq!(edit_environment_permission_code("qa"), None);
    }

    #[test]
    fn session_cookie_serialization_respects_secure_flag() {
        let plain = build_session_cookie("oxide", "session-id", 24, false).expect("cookie");
        let plain = plain.to_str().expect("cookie str");
        assert!(plain.contains("oxide=session-id"));
        assert!(plain.contains("Max-Age=86400"));
        assert!(!plain.contains("Secure"));

        let secure = build_session_cookie("oxide", "session-id", 24, true).expect("cookie");
        assert!(secure.to_str().expect("cookie str").contains("Secure"));
    }

    #[test]
    fn clear_cookie_respects_secure_flag() {
        let cookie = clear_session_cookie("oxide", true).expect("cookie");
        let cookie = cookie.to_str().expect("cookie str");
        assert!(cookie.contains("Max-Age=0"));
        assert!(cookie.contains("Secure"));
    }
}
