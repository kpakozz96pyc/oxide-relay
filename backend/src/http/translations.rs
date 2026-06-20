use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    auth::{self, AuthenticatedUser, EnvironmentAccessKind},
    errors::{ApiError, AppResult},
    repository::translations,
    util::{optional_trimmed, required_non_empty},
};

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/translations",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ListTranslationsQuery
    ),
    responses((status = 200, body = [TranslationResponse]))
)]
pub async fn list_translations(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Query(query): Query<ListTranslationsQuery>,
) -> AppResult<Json<Vec<TranslationResponse>>> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;
    let project = auth::authorize_project(&state, &user, &project_slug, "ReadTranslations").await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Read,
        environment_slug,
    )
    .await?;

    let records = translations::list(
        &state.pool,
        &project.id,
        environment_slug,
        optional_trimmed(query.language.as_deref()),
        optional_trimmed(query.namespace.as_deref()),
    )
    .await?;

    Ok(Json(records.into_iter().map(TranslationResponse::from).collect()))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects/{project_slug}/translations",
    params(("project_slug" = String, Path, description = "Project slug")),
    request_body = CreateTranslationRequest,
    responses((status = 201, body = TranslationResponse))
)]
pub async fn create_translation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateTranslationRequest>,
) -> AppResult<(StatusCode, Json<TranslationResponse>)> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditTranslations").await?;
    validate_create_translation(&payload)?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        payload.environment.trim(),
    )
    .await?;

    let record = translations::create(
        &state.pool,
        translations::CreateTranslationInput {
            project_id: &project.id,
            environment_slug: payload.environment.trim(),
            language_code: payload.language.trim(),
            namespace_name: payload.namespace.trim(),
            key: payload.key.trim(),
            value: payload.value.trim(),
            description: payload.description.as_deref().map(str::trim),
            user_id: &user.id,
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(TranslationResponse::from(record))))
}

#[utoipa::path(
    put,
    path = "/api/v1/projects/{project_slug}/translations/{translation_value_id}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("translation_value_id" = String, Path, description = "Translation value id")
    ),
    request_body = UpdateTranslationRequest,
    responses((status = 200, body = TranslationResponse))
)]
pub async fn update_translation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((project_slug, translation_value_id)): Path<(String, String)>,
    Json(payload): Json<UpdateTranslationRequest>,
) -> AppResult<Json<TranslationResponse>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditTranslations").await?;
    validate_update_translation(&payload)?;

    let existing = translations::find_by_id(&state.pool, &project.id, &translation_value_id).await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        &existing.environment_slug,
    )
    .await?;

    let record = translations::update(
        &state.pool,
        &project.id,
        &translation_value_id,
        translations::UpdateTranslationInput {
            value: payload.value.as_deref(),
            description: payload.description.as_ref().map(|d| optional_trimmed(Some(d.as_str()))),
            user_id: &user.id,
        },
    )
    .await?;

    Ok(Json(TranslationResponse::from(record)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_slug}/translations/{translation_value_id}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("translation_value_id" = String, Path, description = "Translation value id")
    ),
    responses((status = 204))
)]
pub async fn delete_translation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((project_slug, translation_value_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let project = auth::authorize_project(&state, &user, &project_slug, "DeleteTranslations").await?;

    let existing = translations::find_by_id(&state.pool, &project.id, &translation_value_id).await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        &existing.environment_slug,
    )
    .await?;

    translations::delete(&state.pool, &translation_value_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/projects/{project_slug}/imports/json",
    params(("project_slug" = String, Path, description = "Project slug")),
    request_body = ImportTranslationsRequest,
    responses((status = 200, body = ImportTranslationsResponse))
)]
pub async fn import_translations(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<ImportTranslationsRequest>,
) -> AppResult<Json<ImportTranslationsResponse>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "ImportTranslations").await?;
    validate_import_request(&payload)?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        payload.environment.trim(),
    )
    .await?;

    let entries: Vec<(String, String)> = payload.values.into_iter().collect();

    let imported = translations::import_batch(
        &state.pool,
        &project.id,
        payload.environment.trim(),
        payload.language.trim(),
        payload.namespace.trim(),
        &entries,
        &user.id,
    )
    .await?;

    Ok(Json(ImportTranslationsResponse { imported }))
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/exports/json",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ExportTranslationsQuery
    ),
    responses((status = 200, body = Object))
)]
pub async fn export_translations(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Query(query): Query<ExportTranslationsQuery>,
) -> AppResult<Json<BTreeMap<String, String>>> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;
    let language_code = required_non_empty(&query.language, "Language is required.")?;
    let namespace_name = required_non_empty(&query.namespace, "Namespace is required.")?;

    let project = auth::authorize_project(&state, &user, &project_slug, "ExportTranslations").await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Read,
        environment_slug,
    )
    .await?;

    let values = translations::export(
        &state.pool,
        &project.id,
        environment_slug,
        language_code,
        namespace_name,
    )
    .await?;

    Ok(Json(values))
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_create_translation(payload: &CreateTranslationRequest) -> AppResult<()> {
    if payload.environment.trim().is_empty()
        || payload.language.trim().is_empty()
        || payload.namespace.trim().is_empty()
        || payload.key.trim().is_empty()
        || payload.value.trim().is_empty()
    {
        return Err(ApiError::validation(
            "Environment, language, namespace, key, and value are required.",
        ));
    }

    if payload.key.contains(':')
        || payload
            .key
            .starts_with(&format!("{}.", payload.namespace.trim()))
    {
        return Err(ApiError::validation(
            "Translation keys must be local to the selected namespace and must not include a namespace prefix.",
        ));
    }

    Ok(())
}

fn validate_update_translation(payload: &UpdateTranslationRequest) -> AppResult<()> {
    if payload.value.is_none() && payload.description.is_none() {
        return Err(ApiError::validation(
            "At least one field must be provided for translation update.",
        ));
    }

    if let Some(value) = &payload.value
        && value.trim().is_empty()
    {
        return Err(ApiError::validation("Translation value cannot be empty."));
    }

    Ok(())
}

fn validate_import_request(payload: &ImportTranslationsRequest) -> AppResult<()> {
    if payload.environment.trim().is_empty()
        || payload.language.trim().is_empty()
        || payload.namespace.trim().is_empty()
    {
        return Err(ApiError::validation(
            "Environment, language, and namespace are required.",
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct ListTranslationsQuery {
    pub environment: String,
    pub language: Option<String>,
    pub namespace: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateTranslationRequest {
    pub environment: String,
    pub language: String,
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTranslationRequest {
    pub value: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ImportTranslationsRequest {
    pub environment: String,
    pub language: String,
    pub namespace: String,
    pub values: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportTranslationsResponse {
    pub imported: usize,
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct ExportTranslationsQuery {
    pub environment: String,
    pub language: String,
    pub namespace: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TranslationResponse {
    pub id: String,
    pub translation_key_id: String,
    pub key: String,
    pub description: Option<String>,
    pub namespace: String,
    pub language_code: String,
    pub environment_slug: String,
    pub value: String,
    pub updated_by_user_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<translations::TranslationRecord> for TranslationResponse {
    fn from(r: translations::TranslationRecord) -> Self {
        Self {
            id: r.id,
            translation_key_id: r.translation_key_id,
            key: r.key,
            description: r.description,
            namespace: r.namespace,
            language_code: r.language_code,
            environment_slug: r.environment_slug,
            value: r.value,
            updated_by_user_id: r.updated_by_user_id,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}
