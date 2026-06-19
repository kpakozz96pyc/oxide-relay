use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, Transaction};
use time::format_description::well_known::Rfc3339;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::{self, EnvironmentAccessKind},
    errors::{ApiError, AppResult},
};

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
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Query(query): Query<ListTranslationsQuery>,
) -> AppResult<Json<Vec<TranslationResponse>>> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "ReadTranslations").await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Read,
        environment_slug,
    )
    .await?;

    let translations = sqlx::query_as::<_, TranslationResponse>(
        r#"
        SELECT
            tv.id,
            tk.id AS translation_key_id,
            tk.key,
            tk.description,
            n.name AS namespace,
            l.code AS language_code,
            e.slug AS environment_slug,
            tv.value,
            tv.updated_by_user_id,
            tv.created_at,
            tv.updated_at
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        WHERE tk.project_id = ?1
          AND e.slug = ?2
          AND (?3 IS NULL OR l.code = ?3)
          AND (?4 IS NULL OR n.name = ?4)
        ORDER BY n.name, tk.key, l.code
        "#,
    )
    .bind(&project.id)
    .bind(environment_slug)
    .bind(optional_trimmed(query.language.as_deref()))
    .bind(optional_trimmed(query.namespace.as_deref()))
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to list translations."))?;

    Ok(Json(translations))
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
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Json(payload): Json<CreateTranslationRequest>,
) -> AppResult<(StatusCode, Json<TranslationResponse>)> {
    let user = auth::authenticated_user(&state, &headers).await?;
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

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to start translation creation."))?;

    let refs = resolve_refs(
        &mut tx,
        &project.id,
        payload.environment.trim(),
        payload.language.trim(),
        payload.namespace.trim(),
    )
    .await?;

    let now = now_utc()?;
    let translation_key_id = find_or_create_translation_key(
        &mut tx,
        &project.id,
        &refs.namespace_id,
        payload.key.trim(),
        optional_trimmed(payload.description.as_deref()),
        &now,
    )
    .await?;

    let translation_value_id = Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO translation_values (
            id,
            translation_key_id,
            language_id,
            environment_id,
            value,
            updated_by_user_id,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
    )
    .bind(&translation_value_id)
    .bind(&translation_key_id)
    .bind(&refs.language_id)
    .bind(&refs.environment_id)
    .bind(payload.value.trim())
    .bind(&user.id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        ApiError::from_sqlx(
            error,
            "Translation already exists for this key, language, and environment.",
        )
    })?;

    let translation = fetch_translation_by_id(&mut tx, &project.id, &translation_value_id).await?;
    tx.commit()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to commit translation creation."))?;

    Ok((StatusCode::CREATED, Json(translation)))
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
    headers: HeaderMap,
    Path((project_slug, translation_value_id)): Path<(String, String)>,
    Json(payload): Json<UpdateTranslationRequest>,
) -> AppResult<Json<TranslationResponse>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project = auth::authorize_project(&state, &user, &project_slug, "EditTranslations").await?;
    validate_update_translation(&payload)?;

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to start translation update."))?;

    let existing = fetch_translation_by_id(&mut tx, &project.id, &translation_value_id).await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        &existing.environment_slug,
    )
    .await?;

    let now = now_utc()?;
    let next_value = payload
        .value
        .as_deref()
        .unwrap_or(&existing.value)
        .trim()
        .to_owned();
    let next_description = match payload.description {
        Some(ref value) => optional_trimmed(Some(value.as_str())).map(ToOwned::to_owned),
        None => existing.description.clone(),
    };

    sqlx::query(
        r#"
        UPDATE translation_values
        SET value = ?1,
            updated_by_user_id = ?2,
            updated_at = ?3
        WHERE id = ?4
        "#,
    )
    .bind(&next_value)
    .bind(&user.id)
    .bind(&now)
    .bind(&translation_value_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to update the translation value."))?;

    if payload.description.is_some() {
        sqlx::query(
            r#"
            UPDATE translation_keys
            SET description = ?1,
                updated_at = ?2
            WHERE id = ?3
            "#,
        )
        .bind(next_description.as_deref())
        .bind(&now)
        .bind(&existing.translation_key_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to update the translation key."))?;
    }

    let translation = fetch_translation_by_id(&mut tx, &project.id, &translation_value_id).await?;
    tx.commit()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to commit translation update."))?;

    Ok(Json(translation))
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
    headers: HeaderMap,
    Path((project_slug, translation_value_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project =
        auth::authorize_project(&state, &user, &project_slug, "DeleteTranslations").await?;

    let existing =
        fetch_translation_by_id_from_pool(&state, &project.id, &translation_value_id).await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        &existing.environment_slug,
    )
    .await?;

    sqlx::query("DELETE FROM translation_values WHERE id = ?1")
        .bind(&translation_value_id)
        .execute(&state.pool)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to delete the translation."))?;

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
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Json(payload): Json<ImportTranslationsRequest>,
) -> AppResult<Json<ImportTranslationsResponse>> {
    let user = auth::authenticated_user(&state, &headers).await?;
    let project =
        auth::authorize_project(&state, &user, &project_slug, "ImportTranslations").await?;
    validate_import_request(&payload)?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Edit,
        payload.environment.trim(),
    )
    .await?;

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to start import transaction."))?;

    let refs = resolve_refs(
        &mut tx,
        &project.id,
        payload.environment.trim(),
        payload.language.trim(),
        payload.namespace.trim(),
    )
    .await?;

    let now = now_utc()?;
    let mut imported = 0usize;

    for (key, value) in &payload.values {
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() || value.is_empty() || key.contains('{') {
            continue;
        }
        if key.contains(':') || key.starts_with(&format!("{}.", refs.namespace_name)) {
            return Err(ApiError::validation(
                "Import keys must be local to the selected namespace and must not include a namespace prefix.",
            ));
        }

        let translation_key_id = find_or_create_translation_key(
            &mut tx,
            &project.id,
            &refs.namespace_id,
            key,
            None,
            &now,
        )
        .await?;

        sqlx::query(
            r#"
            INSERT INTO translation_values (
                id,
                translation_key_id,
                language_id,
                environment_id,
                value,
                updated_by_user_id,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(translation_key_id, language_id, environment_id)
            DO UPDATE SET
                value = excluded.value,
                updated_by_user_id = excluded.updated_by_user_id,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&translation_key_id)
        .bind(&refs.language_id)
        .bind(&refs.environment_id)
        .bind(value)
        .bind(&user.id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to upsert imported translation."))?;

        imported += 1;
    }

    tx.commit()
        .await
        .map_err(|error| ApiError::from_sqlx(error, "Unable to commit translation import."))?;

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
    headers: HeaderMap,
    Path(project_slug): Path<String>,
    Query(query): Query<ExportTranslationsQuery>,
) -> AppResult<Json<BTreeMap<String, String>>> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;
    let language_code = required_non_empty(&query.language, "Language is required.")?;
    let namespace_name = required_non_empty(&query.namespace, "Namespace is required.")?;

    let user = auth::authenticated_user(&state, &headers).await?;
    let project =
        auth::authorize_project(&state, &user, &project_slug, "ExportTranslations").await?;
    auth::require_environment_permission(
        &state,
        &user,
        &project,
        EnvironmentAccessKind::Read,
        environment_slug,
    )
    .await?;

    let rows = sqlx::query_as::<_, ExportTranslationRow>(
        r#"
        SELECT tk.key, tv.value
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        JOIN namespaces n ON n.id = tk.namespace_id
        WHERE tk.project_id = ?1
          AND e.slug = ?2
          AND l.code = ?3
          AND n.name = ?4
        ORDER BY tk.key
        "#,
    )
    .bind(&project.id)
    .bind(environment_slug)
    .bind(language_code)
    .bind(namespace_name)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to export translations."))?;

    let values = rows.into_iter().map(|row| (row.key, row.value)).collect();

    Ok(Json(values))
}

async fn resolve_refs(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    environment_slug: &str,
    language_code: &str,
    namespace_name: &str,
) -> AppResult<ResolvedRefs> {
    let environment = sqlx::query_as::<_, IdNamePair>(
        r#"
        SELECT id, slug AS name
        FROM environments
        WHERE project_id = ?1 AND slug = ?2
        "#,
    )
    .bind(project_id)
    .bind(environment_slug)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to resolve the environment."))?
    .ok_or_else(|| ApiError::not_found("Environment was not found."))?;

    let language = sqlx::query_as::<_, IdNamePair>(
        r#"
        SELECT id, code AS name
        FROM languages
        WHERE project_id = ?1 AND code = ?2
        "#,
    )
    .bind(project_id)
    .bind(language_code)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to resolve the language."))?
    .ok_or_else(|| ApiError::not_found("Language was not found."))?;

    let namespace = sqlx::query_as::<_, IdNamePair>(
        r#"
        SELECT id, name
        FROM namespaces
        WHERE project_id = ?1 AND name = ?2
        "#,
    )
    .bind(project_id)
    .bind(namespace_name)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to resolve the namespace."))?
    .ok_or_else(|| ApiError::not_found("Namespace was not found."))?;

    Ok(ResolvedRefs {
        environment_id: environment.id,
        language_id: language.id,
        namespace_id: namespace.id,
        namespace_name: namespace.name,
    })
}

async fn find_or_create_translation_key(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    namespace_id: &str,
    key: &str,
    description: Option<&str>,
    now: &str,
) -> AppResult<String> {
    let existing = sqlx::query_scalar::<_, String>(
        r#"
        SELECT id
        FROM translation_keys
        WHERE project_id = ?1
          AND namespace_id = ?2
          AND key = ?3
        "#,
    )
    .bind(project_id)
    .bind(namespace_id)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to resolve the translation key."))?;

    if let Some(id) = existing {
        if description.is_some() {
            sqlx::query(
                r#"
                UPDATE translation_keys
                SET description = ?1,
                    updated_at = ?2
                WHERE id = ?3
                "#,
            )
            .bind(description)
            .bind(now)
            .bind(&id)
            .execute(&mut **tx)
            .await
            .map_err(|error| ApiError::from_sqlx(error, "Unable to update the translation key."))?;
        }

        return Ok(id);
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO translation_keys (id, project_id, namespace_id, key, description, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&id)
    .bind(project_id)
    .bind(namespace_id)
    .bind(key)
    .bind(description)
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Translation key already exists."))?;

    Ok(id)
}

async fn fetch_translation_by_id(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    translation_value_id: &str,
) -> AppResult<TranslationResponse> {
    sqlx::query_as::<_, TranslationResponse>(
        r#"
        SELECT
            tv.id,
            tk.id AS translation_key_id,
            tk.key,
            tk.description,
            n.name AS namespace,
            l.code AS language_code,
            e.slug AS environment_slug,
            tv.value,
            tv.updated_by_user_id,
            tv.created_at,
            tv.updated_at
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        WHERE tv.id = ?1
          AND tk.project_id = ?2
        "#,
    )
    .bind(translation_value_id)
    .bind(project_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load the translation."))?
    .ok_or_else(|| ApiError::not_found("Translation was not found."))
}

async fn fetch_translation_by_id_from_pool(
    state: &AppState,
    project_id: &str,
    translation_value_id: &str,
) -> AppResult<TranslationResponse> {
    sqlx::query_as::<_, TranslationResponse>(
        r#"
        SELECT
            tv.id,
            tk.id AS translation_key_id,
            tk.key,
            tk.description,
            n.name AS namespace,
            l.code AS language_code,
            e.slug AS environment_slug,
            tv.value,
            tv.updated_by_user_id,
            tv.created_at,
            tv.updated_at
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        WHERE tv.id = ?1
          AND tk.project_id = ?2
        "#,
    )
    .bind(translation_value_id)
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load the translation."))?
    .ok_or_else(|| ApiError::not_found("Translation was not found."))
}

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

fn optional_trimmed(value: Option<&str>) -> Option<&str> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn required_non_empty<'a>(value: &'a str, message: &'static str) -> AppResult<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::validation(message));
    }
    Ok(trimmed)
}

fn now_utc() -> AppResult<String> {
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ApiError::internal(format!("Unable to format current time: {error}")))
}

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

#[derive(Debug, Serialize, FromRow, ToSchema)]
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

#[derive(Debug, FromRow)]
struct ExportTranslationRow {
    key: String,
    value: String,
}

#[derive(Debug, FromRow)]
struct IdNamePair {
    id: String,
    name: String,
}

struct ResolvedRefs {
    environment_id: String,
    language_id: String,
    namespace_id: String,
    namespace_name: String,
}
