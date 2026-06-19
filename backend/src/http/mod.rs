mod admin;
mod delivery;
mod docs;
mod projects;
mod translations;

use axum::{
    Json, Router,
    extract::State,
    routing::{delete, get, post, put},
};
use serde::Serialize;

use crate::{app::AppState, auth};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/openapi.json", get(docs::openapi_json))
        .route("/api/v1/auth/login", post(auth::login))
        .route("/api/v1/auth/logout", post(auth::logout))
        .route("/api/v1/me", get(auth::me))
        .route("/api/v1/me/permissions", get(auth::me_permissions))
        .route(
            "/api/v1/users",
            get(admin::list_users).post(admin::create_user),
        )
        .route(
            "/api/v1/users/{id}",
            put(admin::update_user).delete(admin::delete_user),
        )
        .route("/api/v1/permissions", get(admin::list_permissions))
        .route(
            "/api/v1/users/{id}/permissions",
            get(admin::get_user_permissions).put(admin::replace_user_permissions),
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
        .route(
            "/api/v1/projects/{project_slug}/locales/{language_code}",
            get(delivery::locale_bundle),
        )
        .route(
            "/static/{project_slug}/{environment_slug}/{language_code}/{*namespace_file}",
            get(delivery::static_namespace_file),
        )
        .route("/", get(root))
        .with_state(state)
}

async fn root() -> &'static str {
    "OxideRelay backend is running."
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let database = match sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(_) => "ok",
        Err(_) => "error",
    };

    Json(HealthResponse {
        status: "ok",
        database,
    })
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    database: &'static str,
}
