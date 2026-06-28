use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, ETAG, IF_NONE_MATCH},
    },
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    errors::{ApiError, AppResult},
    util::required_non_empty,
};

const SHORT_CACHE_CONTROL: &str = "public, max-age=300, must-revalidate";
const IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/delivery-metadata",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        MetadataQuery
    ),
    responses((status = 200, body = DeliveryMetadataResponse))
)]
pub async fn delivery_metadata(
    State(state): State<AppState>,
    Path(project_slug): Path<String>,
    Query(query): Query<MetadataQuery>,
) -> AppResult<Json<DeliveryMetadataResponse>> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;
    let version_rows = load_environment_version_rows(&state, &project_slug, environment_slug).await?;
    let version = build_delivery_metadata_version(&version_rows);

    let languages = sqlx::query_as::<_, DeliveryMetadataLanguage>(
        r#"
        SELECT DISTINCT
            l.code,
            l.name
        FROM translation_values tv
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN projects p ON p.id = tk.project_id
        WHERE p.slug = ?1
          AND e.slug = ?2
        ORDER BY l.code
        "#,
    )
    .bind(project_slug.trim())
    .bind(environment_slug.trim())
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load localized languages."))?;

    let namespaces = sqlx::query_as::<_, DeliveryMetadataNamespace>(
        r#"
        SELECT n.name
        FROM namespaces n
        JOIN projects p ON p.id = n.project_id
        WHERE p.slug = ?1
        ORDER BY n.name
        "#,
    )
    .bind(project_slug.trim())
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load namespaces."))?;

    Ok(Json(DeliveryMetadataResponse {
        project: project_slug,
        environment: environment_slug.to_owned(),
        version,
        languages,
        namespaces,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/locales/{language_code}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("language_code" = String, Path, description = "Language code"),
        DeliveryQuery
    ),
    responses((status = 200, body = LocaleBundleResponse))
)]
pub async fn locale_bundle(
    State(state): State<AppState>,
    request_headers: HeaderMap,
    Path((project_slug, language_code)): Path<(String, String)>,
    Query(query): Query<DeliveryQuery>,
) -> AppResult<impl IntoResponse> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;
    let rows = load_locale_rows(&state, &project_slug, environment_slug, &language_code).await?;
    let version = build_locale_bundle_version(&rows);
    let etag = wrap_etag(&version);

    let values = rows
        .into_iter()
        .map(|row| (format!("{}.{}", row.namespace, row.key), row.value))
        .collect();

    let response = LocaleBundleResponse {
        project: project_slug,
        locale: language_code,
        environment: environment_slug.to_owned(),
        version,
        values,
    };

    respond_with_json_cache(&request_headers, query.v.as_deref(), &etag, response)
}

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/delivery-manifest/{language_code}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("language_code" = String, Path, description = "Language code"),
        DeliveryQuery
    ),
    responses((status = 200, body = DeliveryManifestResponse))
)]
pub async fn delivery_manifest(
    State(state): State<AppState>,
    request_headers: HeaderMap,
    Path((project_slug, language_code)): Path<(String, String)>,
    Query(query): Query<DeliveryQuery>,
) -> AppResult<impl IntoResponse> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;
    let rows = load_locale_rows(&state, &project_slug, environment_slug, &language_code).await?;
    let locale_bundle_version = build_locale_bundle_version(&rows);
    let etag = wrap_etag(&build_manifest_version(
        &locale_bundle_version,
        rows.iter().map(|row| row.namespace.as_str()),
    ));

    let mut namespaces = BTreeMap::<String, Vec<LocaleBundleRow>>::new();
    for row in rows {
        namespaces.entry(row.namespace.clone()).or_default().push(row);
    }

    let namespace_files = namespaces
        .into_iter()
        .map(|(namespace, rows)| {
            let version = build_locale_bundle_version(&rows);
            DeliveryManifestNamespace {
                name: namespace.clone(),
                version: version.clone(),
                url: build_versioned_static_url(
                    &project_slug,
                    environment_slug,
                    &language_code,
                    &namespace,
                    &version,
                ),
            }
        })
        .collect();

    let response = DeliveryManifestResponse {
        project: project_slug.clone(),
        locale: language_code.clone(),
        environment: environment_slug.to_owned(),
        locale_bundle_version: locale_bundle_version.clone(),
        locale_bundle_url: build_versioned_locale_bundle_url(
            &project_slug,
            environment_slug,
            &language_code,
            &locale_bundle_version,
        ),
        namespaces: namespace_files,
    };

    respond_with_json_cache(&request_headers, None, &etag, response)
}

#[utoipa::path(
    get,
    path = "/static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("environment_slug" = String, Path, description = "Environment slug"),
        ("language_code" = String, Path, description = "Language code"),
        ("namespace" = String, Path, description = "Namespace file name"),
        StaticNamespaceQuery
    ),
    responses((status = 200, body = Object))
)]
pub async fn static_namespace_file(
    State(state): State<AppState>,
    request_headers: HeaderMap,
    Path((project_slug, environment_slug, language_code, namespace_file)): Path<(
        String,
        String,
        String,
        String,
    )>,
    Query(query): Query<StaticNamespaceQuery>,
) -> AppResult<impl IntoResponse> {
    let namespace = namespace_from_path(&namespace_file)?;

    let rows = sqlx::query_as::<_, StaticNamespaceRow>(
        r#"
        SELECT tk.key, tv.value, tv.updated_at, tk.updated_at AS key_updated_at
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN projects p ON p.id = tk.project_id
        WHERE p.slug = ?1
          AND e.slug = ?2
          AND l.code = ?3
          AND n.name = ?4
        ORDER BY tk.key
        "#,
    )
    .bind(project_slug.trim())
    .bind(environment_slug.trim())
    .bind(language_code.trim())
    .bind(namespace)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load static namespace file."))?;

    let version = build_namespace_version(&rows);
    let etag = wrap_etag(&version);
    let values: BTreeMap<String, String> =
        rows.into_iter().map(|row| (row.key, row.value)).collect();

    respond_with_json_cache(&request_headers, query.v.as_deref(), &etag, values)
}

async fn load_locale_rows(
    state: &AppState,
    project_slug: &str,
    environment_slug: &str,
    language_code: &str,
) -> AppResult<Vec<LocaleBundleRow>> {
    sqlx::query_as::<_, LocaleBundleRow>(
        r#"
        SELECT
            n.name AS namespace,
            tk.key,
            tv.value,
            tv.updated_at,
            tk.updated_at AS key_updated_at
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN projects p ON p.id = tk.project_id
        WHERE p.slug = ?1
          AND e.slug = ?2
          AND l.code = ?3
        ORDER BY n.name, tk.key
        "#,
    )
    .bind(project_slug.trim())
    .bind(environment_slug.trim())
    .bind(language_code.trim())
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load locale bundle."))
}

async fn load_environment_version_rows(
    state: &AppState,
    project_slug: &str,
    environment_slug: &str,
) -> AppResult<Vec<LocaleBundleRow>> {
    sqlx::query_as::<_, LocaleBundleRow>(
        r#"
        SELECT
            n.name AS namespace,
            tk.key,
            tv.value,
            tv.updated_at,
            tk.updated_at AS key_updated_at
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN environments e ON e.id = tv.environment_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN projects p ON p.id = tk.project_id
        WHERE p.slug = ?1
          AND e.slug = ?2
        ORDER BY n.name, tk.key
        "#,
    )
    .bind(project_slug.trim())
    .bind(environment_slug.trim())
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load delivery metadata version."))
}

fn respond_with_json_cache<T: Serialize>(
    request_headers: &HeaderMap,
    requested_version: Option<&str>,
    etag: &str,
    payload: T,
) -> AppResult<Response> {
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(if requested_version.is_some() {
            IMMUTABLE_CACHE_CONTROL
        } else {
            SHORT_CACHE_CONTROL
        }),
    );
    response_headers.insert(
        ETAG,
        HeaderValue::from_str(etag)
            .map_err(|_| ApiError::internal("Unable to serialize delivery ETag."))?,
    );

    if matches_if_none_match(request_headers, etag) {
        return Ok((StatusCode::NOT_MODIFIED, response_headers).into_response());
    }

    Ok((StatusCode::OK, response_headers, Json(payload)).into_response())
}

fn namespace_from_path(namespace_file: &str) -> AppResult<&str> {
    let trimmed = namespace_file.trim_start_matches('/');
    let namespace = trimmed
        .strip_suffix(".json")
        .ok_or_else(|| ApiError::not_found("Static translation file was not found."))?;

    if namespace.is_empty() {
        return Err(ApiError::not_found(
            "Static translation file was not found.",
        ));
    }

    Ok(namespace)
}

fn build_locale_bundle_version(rows: &[LocaleBundleRow]) -> String {
    build_version_token(rows.iter().flat_map(|row| {
        [
            row.namespace.as_str(),
            row.key.as_str(),
            row.value.as_str(),
            row.updated_at.as_str(),
            row.key_updated_at.as_str(),
        ]
    }))
}

fn build_namespace_version(rows: &[StaticNamespaceRow]) -> String {
    build_version_token(rows.iter().flat_map(|row| {
        [
            row.key.as_str(),
            row.value.as_str(),
            row.updated_at.as_str(),
            row.key_updated_at.as_str(),
        ]
    }))
}

fn build_manifest_version<'a>(
    locale_bundle_version: &'a str,
    namespaces: impl Iterator<Item = &'a str>,
) -> String {
    build_version_token(std::iter::once(locale_bundle_version).chain(namespaces))
}

fn build_delivery_metadata_version(rows: &[LocaleBundleRow]) -> String {
    build_locale_bundle_version(rows)
}

fn build_version_token<'a>(parts: impl Iterator<Item = &'a str>) -> String {
    let mut hash = 0xcbf29ce484222325u64;

    for part in parts {
        for byte in part.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= u64::from(b'|');
        hash = hash.wrapping_mul(0x100000001b3);
    }

    format!("{hash:016x}")
}

fn wrap_etag(version: &str) -> String {
    format!("\"{version}\"")
}

fn matches_if_none_match(request_headers: &HeaderMap, etag: &str) -> bool {
    request_headers
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .any(|candidate| candidate == "*" || candidate == etag)
        })
        .unwrap_or(false)
}

fn build_versioned_locale_bundle_url(
    project_slug: &str,
    environment_slug: &str,
    language_code: &str,
    version: &str,
) -> String {
    format!(
        "/api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}&v={version}"
    )
}

fn build_versioned_static_url(
    project_slug: &str,
    environment_slug: &str,
    language_code: &str,
    namespace: &str,
    version: &str,
) -> String {
    format!(
        "/static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json?v={version}"
    )
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct DeliveryQuery {
    pub environment: String,
    pub v: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct StaticNamespaceQuery {
    pub v: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct MetadataQuery {
    pub environment: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeliveryMetadataResponse {
    pub project: String,
    pub environment: String,
    pub version: String,
    pub languages: Vec<DeliveryMetadataLanguage>,
    pub namespaces: Vec<DeliveryMetadataNamespace>,
}

#[derive(Debug, Serialize, ToSchema, FromRow)]
pub struct DeliveryMetadataLanguage {
    pub code: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema, FromRow)]
pub struct DeliveryMetadataNamespace {
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LocaleBundleResponse {
    pub project: String,
    pub locale: String,
    pub environment: String,
    pub version: String,
    pub values: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeliveryManifestResponse {
    pub project: String,
    pub locale: String,
    pub environment: String,
    pub locale_bundle_version: String,
    pub locale_bundle_url: String,
    pub namespaces: Vec<DeliveryManifestNamespace>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeliveryManifestNamespace {
    pub name: String,
    pub version: String,
    pub url: String,
}

#[derive(Debug, Clone, FromRow)]
struct LocaleBundleRow {
    namespace: String,
    key: String,
    value: String,
    updated_at: String,
    key_updated_at: String,
}

#[derive(Debug, FromRow)]
struct StaticNamespaceRow {
    key: String,
    value: String,
    updated_at: String,
    key_updated_at: String,
}
