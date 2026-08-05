mod admin;
mod delivery;
mod docs;
mod projects;
mod translations;

use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{Request, StatusCode, header},
    middleware,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use serde::Serialize;
use std::path::PathBuf;
use tower::util::ServiceExt;
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use utoipa::ToSchema;

use crate::{app::AppState, auth};

pub fn router(state: AppState, frontend_dist_path: PathBuf) -> Router {
    let delivery_settings = state.delivery.clone();
    let public_delivery_router = Router::new()
        .route(
            "/api/v1/projects/{project_slug}/delivery-metadata",
            get(delivery::delivery_metadata),
        )
        .route(
            "/api/v1/projects/{project_slug}/locales/{language_code}",
            get(delivery::locale_bundle),
        )
        .route(
            "/api/v1/projects/{project_slug}/delivery-manifest/{language_code}",
            get(delivery::delivery_manifest),
        )
        .route(
            "/static/{project_slug}/{environment_slug}/{language_code}/{*namespace_file}",
            get(delivery::static_namespace_file),
        )
        .route_layer(middleware::from_fn_with_state(
            delivery_settings,
            delivery::require_delivery_access,
        ))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([axum::http::Method::GET, axum::http::Method::OPTIONS])
                .allow_headers(Any),
        );

    let api_router = Router::new()
        .route("/api/health", get(health))
        .route("/api/openapi.json", get(docs::openapi_json))
        .route("/api/v1/auth/login", post(auth::login))
        .route("/api/v1/auth/logout", post(auth::logout))
        .route("/api/v1/auth/reset-password", post(auth::reset_password))
        .route("/api/v1/me", get(auth::me))
        .route("/api/v1/me/permissions", get(auth::me_permissions))
        .route(
            "/api/v1/users",
            get(admin::list_users).post(admin::create_user),
        )
        .route("/api/v1/users/summary", get(admin::list_user_summaries))
        .route(
            "/api/v1/users/{id}",
            put(admin::update_user).delete(admin::delete_user),
        )
        .route(
            "/api/v1/users/{id}/password-reset-link",
            post(admin::generate_password_reset_link),
        )
        .route("/api/v1/projects/catalog", get(admin::list_project_catalog))
        .route("/api/v1/permissions", get(admin::list_permissions))
        .route(
            "/api/v1/users/{id}/permissions",
            get(admin::get_user_permissions).put(admin::replace_user_permissions),
        )
        .route(
            "/api/v1/users/{id}/project-access",
            get(admin::get_user_project_access).post(admin::add_user_project_access),
        )
        .route(
            "/api/v1/users/{id}/project-access/{project_slug}",
            delete(admin::delete_user_project_access),
        )
        .route(
            "/api/v1/projects",
            get(projects::list_projects).post(projects::create_project),
        )
        .route(
            "/api/v1/projects/{project_slug}",
            get(projects::get_project)
                .put(projects::update_project)
                .delete(projects::delete_project),
        )
        .route(
            "/api/v1/projects/{project_slug}/languages",
            get(projects::list_languages).post(projects::create_language),
        )
        .route(
            "/api/v1/projects/{project_slug}/languages/{language_code}",
            delete(projects::delete_language),
        )
        .route(
            "/api/v1/projects/{project_slug}/namespaces",
            get(projects::list_namespaces).post(projects::create_namespace),
        )
        .route(
            "/api/v1/projects/{project_slug}/namespaces/{namespace}",
            delete(projects::delete_namespace),
        )
        .route(
            "/api/v1/projects/{project_slug}/environments",
            get(projects::list_environments).post(projects::create_environment),
        )
        .route(
            "/api/v1/projects/{project_slug}/environments/{environment_slug}",
            delete(projects::delete_environment),
        )
        .route(
            "/api/v1/projects/{project_slug}/members",
            get(admin::list_project_members).post(admin::add_project_member),
        )
        .route(
            "/api/v1/projects/{project_slug}/members/{user_id}",
            delete(admin::delete_project_member),
        )
        .route(
            "/api/v1/projects/{project_slug}/translations",
            get(translations::list_translations).post(translations::create_translation),
        )
        .route(
            "/api/v1/projects/{project_slug}/translations/grid",
            get(translations::list_translation_grid),
        )
        .route(
            "/api/v1/projects/{project_slug}/translations/{translation_value_id}",
            put(translations::update_translation).delete(translations::delete_translation),
        )
        .route(
            "/api/v1/projects/{project_slug}/imports/json",
            post(translations::import_translations),
        )
        .route(
            "/api/v1/projects/{project_slug}/exports/json",
            get(translations::export_translations),
        )
        .merge(public_delivery_router)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    if frontend_dist_path.join("index.html").is_file() {
        let index_path = frontend_dist_path.join("index.html");
        let static_service =
            ServeDir::new(frontend_dist_path).not_found_service(ServeFile::new(index_path.clone()));

        api_router.fallback(move |request: Request<Body>| {
            let static_service = static_service.clone();
            let index_path = index_path.clone();

            async move {
                let wants_html = request
                    .headers()
                    .get(header::ACCEPT)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.contains("text/html"))
                    .unwrap_or(false);

                let has_extension = request
                    .uri()
                    .path()
                    .rsplit('/')
                    .next()
                    .map(|segment| segment.contains('.'))
                    .unwrap_or(false);

                let response = if wants_html && !has_extension {
                    ServeFile::new(index_path).oneshot(request).await
                } else {
                    static_service.oneshot(request).await
                };

                match response {
                    Ok(response) => response.into_response(),
                    Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                }
            }
        })
    } else {
        api_router.route("/", get(root))
    }
}

async fn root() -> &'static str {
    "OxideRelay backend is running."
}

#[utoipa::path(
    get,
    path = "/api/health",
    responses(
        (status = 200, body = HealthResponse),
        (status = 503, body = HealthResponse)
    )
)]
async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    match sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(HealthResponse {
                status: "ok",
                database: "ok",
                version: env!("CARGO_PKG_VERSION"),
            }),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                status: "error",
                database: "error",
                version: env!("CARGO_PKG_VERSION"),
            }),
        ),
    }
}

#[derive(Serialize, ToSchema)]
struct HealthResponse {
    status: &'static str,
    database: &'static str,
    version: &'static str,
}
