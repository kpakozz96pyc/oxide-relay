use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header::CACHE_CONTROL},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    errors::{ApiError, AppResult},
    util::required_non_empty,
};

#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_slug}/locales/{language_code}",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("language_code" = String, Path, description = "Language code"),
        LocaleBundleQuery
    ),
    responses((status = 200, body = LocaleBundleResponse))
)]
pub async fn locale_bundle(
    State(state): State<AppState>,
    Path((project_slug, language_code)): Path<(String, String)>,
    Query(query): Query<LocaleBundleQuery>,
) -> AppResult<Json<LocaleBundleResponse>> {
    let environment_slug = required_non_empty(&query.environment, "Environment is required.")?;

    let rows = sqlx::query_as::<_, LocaleBundleRow>(
        r#"
        SELECT
            n.name AS namespace,
            tk.key,
            tv.value
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
    .bind(environment_slug)
    .bind(language_code.trim())
    .fetch_all(&state.pool)
    .await
    .map_err(|error| ApiError::from_sqlx(error, "Unable to load locale bundle."))?;

    let values = rows
        .into_iter()
        .map(|row| (format!("{}.{}", row.namespace, row.key), row.value))
        .collect();

    Ok(Json(LocaleBundleResponse {
        project: project_slug,
        locale: language_code,
        environment: environment_slug.to_owned(),
        values,
    }))
}

#[utoipa::path(
    get,
    path = "/static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json",
    params(
        ("project_slug" = String, Path, description = "Project slug"),
        ("environment_slug" = String, Path, description = "Environment slug"),
        ("language_code" = String, Path, description = "Language code"),
        ("namespace" = String, Path, description = "Namespace file name")
    ),
    responses((status = 200, body = Object))
)]
pub async fn static_namespace_file(
    State(state): State<AppState>,
    Path((project_slug, environment_slug, language_code, namespace_file)): Path<(
        String,
        String,
        String,
        String,
    )>,
) -> AppResult<impl IntoResponse> {
    let namespace = namespace_from_path(&namespace_file)?;

    let rows = sqlx::query_as::<_, StaticNamespaceRow>(
        r#"
        SELECT tk.key, tv.value
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

    let values: BTreeMap<String, String> =
        rows.into_iter().map(|row| (row.key, row.value)).collect();

    let mut headers = HeaderMap::new();
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );

    Ok((StatusCode::OK, headers, Json(values)))
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



#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct LocaleBundleQuery {
    pub environment: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LocaleBundleResponse {
    pub project: String,
    pub locale: String,
    pub environment: String,
    pub values: BTreeMap<String, String>,
}

#[derive(Debug, FromRow)]
struct LocaleBundleRow {
    namespace: String,
    key: String,
    value: String,
}

#[derive(Debug, FromRow)]
struct StaticNamespaceRow {
    key: String,
    value: String,
}
