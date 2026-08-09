use axum::Json;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
};

use crate::{
    auth::{AuthResponse, LoginRequest, MePermissionsResponse, MeResponse, ResetPasswordRequest},
    errors::ErrorResponse,
    http::{
        admin::{
            AddProjectMemberRequest, CreateUserRequest, GeneratePasswordResetLinkResponse,
            PermissionResponse, ProjectCatalogResponse, ProjectMemberResponse,
            ReplaceUserPermissionsRequest, UpdateUserProjectAccessRequest, UpdateUserRequest,
            UserProjectAccessResponse, UserResponse, UserSummaryResponse,
        },
        delivery::{
            DeliveryManifestNamespace, DeliveryManifestResponse, DeliveryMetadataLanguage,
            DeliveryMetadataNamespace, DeliveryMetadataResponse, DeliveryQuery,
            LocaleBundleResponse, MetadataQuery, StaticNamespaceQuery,
        },
        projects::{
            CreateEnvironmentRequest, CreateLanguageRequest, CreateNamespaceRequest,
            CreateProjectRequest, EnvironmentResponse, LanguageResponse, NamespaceResponse,
            ProjectResponse, UpdateProjectRequest,
        },
        translations::{
            CreateTranslationRequest, ExportTranslationsQuery, ImportTranslationsRequest,
            ImportTranslationsResponse, ListTranslationsQuery, TranslationGridQuery,
            TranslationGridResponse, TranslationGridRowResponse, TranslationGridValueResponse,
            TranslationResponse, UpdateTranslationRequest,
        },
    },
};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::http::health,
        crate::http::docs::openapi_json,
        crate::auth::login,
        crate::auth::logout,
        crate::auth::me,
        crate::auth::me_permissions,
        crate::auth::reset_password,
        crate::http::admin::list_users,
        crate::http::admin::list_user_summaries,
        crate::http::admin::create_user,
        crate::http::admin::update_user,
        crate::http::admin::delete_user,
        crate::http::admin::generate_password_reset_link,
        crate::http::admin::list_project_catalog,
        crate::http::admin::list_permissions,
        crate::http::admin::get_user_permissions,
        crate::http::admin::replace_user_permissions,
        crate::http::admin::get_user_project_access,
        crate::http::admin::add_user_project_access,
        crate::http::admin::delete_user_project_access,
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
        crate::http::translations::list_translation_grid,
        crate::http::translations::create_translation,
        crate::http::translations::update_translation,
        crate::http::translations::delete_translation,
        crate::http::translations::import_translations,
        crate::http::translations::export_translations,
        crate::http::delivery::delivery_metadata,
        crate::http::delivery::locale_bundle,
        crate::http::delivery::delivery_manifest,
        crate::http::delivery::static_namespace_file,
    ),
    components(schemas(
        crate::http::HealthResponse,
        ErrorResponse,
        LoginRequest,
        AuthResponse,
        MeResponse,
        MePermissionsResponse,
        ResetPasswordRequest,
        UserResponse,
        UserSummaryResponse,
        CreateUserRequest,
        UpdateUserRequest,
        GeneratePasswordResetLinkResponse,
        PermissionResponse,
        ReplaceUserPermissionsRequest,
        ProjectCatalogResponse,
        UpdateUserProjectAccessRequest,
        UserProjectAccessResponse,
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
        TranslationGridQuery,
        TranslationGridResponse,
        TranslationGridRowResponse,
        TranslationGridValueResponse,
        CreateTranslationRequest,
        UpdateTranslationRequest,
        ImportTranslationsRequest,
        ImportTranslationsResponse,
        ExportTranslationsQuery,
        MetadataQuery,
        DeliveryQuery,
        StaticNamespaceQuery,
        DeliveryMetadataResponse,
        DeliveryMetadataLanguage,
        DeliveryMetadataNamespace,
        LocaleBundleResponse,
        DeliveryManifestResponse,
        DeliveryManifestNamespace,
    )),
    modifiers(&DeliverySecurityAddon),
    info(
        title = "OxideRelay API",
        version = env!("CARGO_PKG_VERSION"),
        description = "Admin and delivery API for OxideRelay MVP."
    )
)]
pub struct ApiDoc;

struct DeliverySecurityAddon;

impl Modify for DeliverySecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "delivery_bearer",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .description(Some(
                            "Optional shared delivery token configured with OXIDERELAY_DELIVERY_TOKEN.",
                        ))
                        .build(),
                ),
            );
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/openapi.json",
    responses((status = 200, body = Object))
)]
pub async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}
