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
    translation_validation::{
        MAX_TRANSLATION_IMPORT_ENTRIES, validate_translation_description,
        validate_translation_key, validate_translation_value,
    },
    util::{optional_trimmed, required_non_empty},
};

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/translations/grid",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        TranslationGridQuery
    ),
    responses((status = 200, body = TranslationGridResponse))
)]
pub async fn list_translation_grid(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Query(query): Query<TranslationGridQuery>,
) -> AppResult<Json<TranslationGridResponse>> {
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

    let language_codes = query
        .languages
        .as_deref()
        .map(parse_languages_query)
        .transpose()?
        .unwrap_or_default();
    let base_language = optional_trimmed(query.base_language.as_deref());
    let missing_language_codes = query
        .missing_languages
        .as_deref()
        .map(parse_languages_query)
        .transpose()?
        .unwrap_or_default();
    if base_language.is_some() != !missing_language_codes.is_empty() {
        return Err(ApiError::validation(
            "Base language and missing languages must be provided together.",
        ));
    }
    if let Some(base_language) = base_language
        && missing_language_codes
            .iter()
            .any(|language_code| language_code == base_language)
    {
        return Err(ApiError::validation(
            "Base language cannot also be a missing target language.",
        ));
    }
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(25);

    let result = translations::list_grid(
        &state.pool,
        &project.id,
        environment_slug,
        optional_trimmed(query.namespace.as_deref()),
        optional_trimmed(query.search.as_deref()),
        &language_codes,
        base_language,
        &missing_language_codes,
        page,
        page_size,
    )
    .await?;

    Ok(Json(TranslationGridResponse::from(result)))
}

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
    responses(
        (status = 201, body = TranslationResponse),
        (status = 400, body = crate::errors::ErrorResponse)
    )
)]
pub async fn create_translation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateTranslationRequest>,
) -> AppResult<(StatusCode, Json<TranslationResponse>)> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditTranslations").await?;
    require_read_translations(&state, &user, &project).await?;
    let validated = validate_create_translation(&payload)?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        validated.environment,
    )
    .await?;

    let record = translations::create(
        &state.pool,
        translations::CreateTranslationInput {
            project_id: &project.id,
            environment_slug: validated.environment,
            language_code: validated.language,
            namespace_name: validated.namespace,
            key: validated.key,
            value: validated.value,
            description: validated.description,
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
    responses(
        (status = 200, body = TranslationResponse),
        (status = 400, body = crate::errors::ErrorResponse)
    )
)]
pub async fn update_translation(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((project_slug, translation_value_id)): Path<(String, String)>,
    Json(payload): Json<UpdateTranslationRequest>,
) -> AppResult<Json<TranslationResponse>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "EditTranslations").await?;
    require_read_translations(&state, &user, &project).await?;
    let validated = validate_update_translation(&payload)?;

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
            value: validated.value,
            description: validated.description,
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
    responses(
        (status = 200, body = ImportTranslationsResponse),
        (status = 400, body = crate::errors::ErrorResponse)
    )
)]
pub async fn import_translations(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(project_slug): Path<String>,
    Json(payload): Json<ImportTranslationsRequest>,
) -> AppResult<Json<ImportTranslationsResponse>> {
    let project = auth::authorize_project(&state, &user, &project_slug, "ImportTranslations").await?;
    let validated = validate_import_request(&payload)?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        validated.environment,
    )
    .await?;

    let entries: Vec<(String, String)> = payload
        .values
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();

    let imported = translations::import_batch(
        &state.pool,
        &project.id,
        validated.environment,
        validated.language,
        validated.namespace,
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
    require_read_translations(&state, &user, &project).await?;
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

/// Blocks responses that would disclose translation values to a caller who doesn't hold
/// `ReadTranslations`. Write-only permissions (EditTranslations/ExportTranslations/...) are
/// intentionally decoupled from read access in the permission model, but every endpoint here
/// that echoes a translation `value` back to the caller must still gate on read access, or a
/// write-only actor could recover protected content through create/update/export responses.
async fn require_read_translations(
    state: &AppState,
    user: &AuthenticatedUser,
    project: &auth::AuthorizedProject,
) -> AppResult<()> {
    if project.is_owner {
        return Ok(());
    }

    auth::require_permission(state, &user.id, "ReadTranslations").await
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

struct ValidatedCreateTranslation<'a> {
    environment: &'a str,
    language: &'a str,
    namespace: &'a str,
    key: &'a str,
    value: &'a str,
    description: Option<&'a str>,
}

fn validate_create_translation(
    payload: &CreateTranslationRequest,
) -> AppResult<ValidatedCreateTranslation<'_>> {
    let environment = required_non_empty(&payload.environment, "Environment is required.")?;
    let language = required_non_empty(&payload.language, "Language is required.")?;
    let namespace = required_non_empty(&payload.namespace, "Namespace is required.")?;
    let key = validate_translation_key(&payload.key, namespace)?;
    let value = validate_translation_value(&payload.value, Some(key))?;
    let description = validate_translation_description(payload.description.as_deref())?;

    Ok(ValidatedCreateTranslation {
        environment,
        language,
        namespace,
        key,
        value,
        description,
    })
}

struct ValidatedUpdateTranslation<'a> {
    value: Option<&'a str>,
    description: Option<Option<&'a str>>,
}

fn validate_update_translation(
    payload: &UpdateTranslationRequest,
) -> AppResult<ValidatedUpdateTranslation<'_>> {
    if payload.value.is_none() && payload.description.is_none() {
        return Err(ApiError::validation(
            "At least one field must be provided for translation update.",
        ));
    }

    let value = payload
        .value
        .as_deref()
        .map(|value| validate_translation_value(value, None))
        .transpose()?;
    let description = payload
        .description
        .as_deref()
        .map(|description| validate_translation_description(Some(description)))
        .transpose()?;

    Ok(ValidatedUpdateTranslation { value, description })
}

struct ValidatedImportRequest<'a> {
    environment: &'a str,
    language: &'a str,
    namespace: &'a str,
}

fn validate_import_request(
    payload: &ImportTranslationsRequest,
) -> AppResult<ValidatedImportRequest<'_>> {
    let environment = required_non_empty(&payload.environment, "Environment is required.")?;
    let language = required_non_empty(&payload.language, "Language is required.")?;
    let namespace = required_non_empty(&payload.namespace, "Namespace is required.")?;

    if payload.values.len() > MAX_TRANSLATION_IMPORT_ENTRIES {
        return Err(ApiError::validation(format!(
            "Import batch must not exceed {MAX_TRANSLATION_IMPORT_ENTRIES} entries."
        )));
    }

    for (key, value) in &payload.values {
        let key = validate_translation_key(key, namespace)?;
        validate_translation_value(value, Some(key))?;
    }

    Ok(ValidatedImportRequest {
        environment,
        language,
        namespace,
    })
}

fn parse_languages_query(value: &str) -> AppResult<Vec<String>> {
    let languages = value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if languages.is_empty() {
        return Err(ApiError::validation("At least one language must be selected."));
    }

    Ok(languages)
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

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct TranslationGridQuery {
    pub environment: String,
    pub namespace: Option<String>,
    pub languages: Option<String>,
    pub base_language: Option<String>,
    pub missing_languages: Option<String>,
    pub search: Option<String>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateTranslationRequest {
    pub environment: String,
    pub language: String,
    pub namespace: String,
    /// Local key without the selected namespace prefix. Colons, braces, and control characters are not allowed.
    #[schema(min_length = 1, max_length = 500)]
    pub key: String,
    /// Non-empty translation value.
    #[schema(min_length = 1, max_length = 10000)]
    pub value: String,
    /// Optional description. Empty or whitespace-only input is stored as null.
    #[schema(max_length = 2000)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTranslationRequest {
    /// Non-empty translation value when supplied.
    #[schema(min_length = 1, max_length = 10000)]
    pub value: Option<String>,
    /// Optional description. Empty or whitespace-only input clears the description.
    #[schema(max_length = 2000)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ImportTranslationsRequest {
    pub environment: String,
    pub language: String,
    pub namespace: String,
    /// At most 5000 local translation keys. The batch is validated and committed atomically.
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

#[derive(Debug, Serialize, ToSchema)]
pub struct TranslationGridResponse {
    pub items: Vec<TranslationGridRowResponse>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

impl From<translations::TranslationGridPageRecord> for TranslationGridResponse {
    fn from(value: translations::TranslationGridPageRecord) -> Self {
        Self {
            items: value.items.into_iter().map(TranslationGridRowResponse::from).collect(),
            total: value.total,
            page: value.page,
            page_size: value.page_size,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TranslationGridRowResponse {
    pub representative_translation_id: String,
    pub translation_key_id: String,
    pub key: String,
    pub description: Option<String>,
    pub namespace: String,
    pub values: BTreeMap<String, TranslationGridValueResponse>,
}

impl From<translations::TranslationGridRowRecord> for TranslationGridRowResponse {
    fn from(value: translations::TranslationGridRowRecord) -> Self {
        Self {
            representative_translation_id: value.representative_translation_id,
            translation_key_id: value.translation_key_id,
            key: value.key,
            description: value.description,
            namespace: value.namespace,
            values: value
                .values
                .into_iter()
                .map(|(language_code, cell)| (language_code, TranslationGridValueResponse::from(cell)))
                .collect(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TranslationGridValueResponse {
    pub id: Option<String>,
    pub value: String,
}

impl From<translations::TranslationGridValueRecord> for TranslationGridValueResponse {
    fn from(value: translations::TranslationGridValueRecord) -> Self {
        Self {
            id: value.id,
            value: value.value,
        }
    }
}
