use axum::Json;
use utoipa::OpenApi;

use crate::{
    auth::{AuthResponse, LoginRequest, MePermissionsResponse, MeResponse},
    errors::ErrorResponse,
    http::{
        admin::{
            AddProjectMemberRequest, CreateUserRequest, PermissionResponse, ProjectMemberResponse,
            ReplaceUserPermissionsRequest, UpdateUserRequest, UserResponse,
        },
        delivery::{LocaleBundleQuery, LocaleBundleResponse},
        projects::{
            CreateEnvironmentRequest, CreateLanguageRequest, CreateNamespaceRequest,
            CreateProjectRequest, EnvironmentResponse, LanguageResponse, NamespaceResponse,
            ProjectResponse, UpdateProjectRequest,
        },
        translations::{
            CreateTranslationRequest, ExportTranslationsQuery, ImportTranslationsRequest,
            ImportTranslationsResponse, ListTranslationsQuery, TranslationResponse,
            UpdateTranslationRequest,
        },
    },
};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::auth::login,
        crate::auth::logout,
        crate::auth::me,
        crate::auth::me_permissions,
        crate::http::admin::list_users,
        crate::http::admin::create_user,
        crate::http::admin::update_user,
        crate::http::admin::delete_user,
        crate::http::admin::list_permissions,
        crate::http::admin::get_user_permissions,
        crate::http::admin::replace_user_permissions,
        crate::http::admin::list_project_members,
        crate::http::admin::add_project_member,
        crate::http::admin::delete_project_member,
        crate::http::projects::list_projects,
        crate::http::projects::create_project,
        crate::http::projects::get_project,
        crate::http::projects::update_project,
        crate::http::projects::delete_project,
        crate::http::projects::list_languages,
        crate::http::projects::create_language,
        crate::http::projects::delete_language,
        crate::http::projects::list_namespaces,
        crate::http::projects::create_namespace,
        crate::http::projects::delete_namespace,
        crate::http::projects::list_environments,
        crate::http::projects::create_environment,
        crate::http::projects::delete_environment,
        crate::http::translations::list_translations,
        crate::http::translations::create_translation,
        crate::http::translations::update_translation,
        crate::http::translations::delete_translation,
        crate::http::translations::import_translations,
        crate::http::translations::export_translations,
        crate::http::delivery::locale_bundle,
        crate::http::delivery::static_namespace_file,
    ),
    components(schemas(
        ErrorResponse,
        LoginRequest,
        AuthResponse,
        MeResponse,
        MePermissionsResponse,
        UserResponse,
        CreateUserRequest,
        UpdateUserRequest,
        PermissionResponse,
        ReplaceUserPermissionsRequest,
        AddProjectMemberRequest,
        ProjectMemberResponse,
        ProjectResponse,
        CreateProjectRequest,
        UpdateProjectRequest,
        LanguageResponse,
        CreateLanguageRequest,
        NamespaceResponse,
        CreateNamespaceRequest,
        EnvironmentResponse,
        CreateEnvironmentRequest,
        TranslationResponse,
        ListTranslationsQuery,
        CreateTranslationRequest,
        UpdateTranslationRequest,
        ImportTranslationsRequest,
        ImportTranslationsResponse,
        ExportTranslationsQuery,
        LocaleBundleQuery,
        LocaleBundleResponse,
    )),
    info(
        title = "OxideRelay API",
        version = "0.1.0",
        description = "Admin and delivery API for OxideRelay MVP."
    )
)]
pub struct ApiDoc;

pub async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}
