use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString},
};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use oxiderelay_backend::{
    app::AppState,
    config::{
        BootstrapAdminSettings, DatabaseSettings, DeliverySettings, FrontendSettings,
        ServerSettings, SessionSettings, Settings,
    },
    db, http,
    translation_validation::{
        MAX_TRANSLATION_DESCRIPTION_LEN, MAX_TRANSLATION_IMPORT_ENTRIES,
        MAX_TRANSLATION_KEY_LEN, MAX_TRANSLATION_VALUE_LEN,
    },
};
use rand_core::OsRng;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tempfile::TempDir;
use time::format_description::well_known::Rfc3339;
use tower::util::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn login_me_logout_flow_works() {
    let harness = TestHarness::new().await;

    let login = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": "admin@example.com",
                        "password": "admin-password"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(login.status(), StatusCode::OK);
    let login_cookie = session_cookie(&login);
    let login_body = json_body(login).await;
    assert_eq!(login_body["user"]["email"], "admin@example.com");

    let me = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/me")
                .header(header::COOKIE, login_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(me.status(), StatusCode::OK);
    let me_body = json_body(me).await;
    assert_eq!(me_body["user"]["display_name"], "Administrator");

    let permissions = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/me/permissions")
                .header(header::COOKIE, login_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(permissions.status(), StatusCode::OK);
    let permissions_body = json_body(permissions).await;
    assert!(
        permissions_body["permissions"]
            .as_array()
            .expect("permissions array")
            .iter()
            .any(|value| value == "ManageUsers")
    );

    let logout = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/logout")
                .header(header::COOKIE, login_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let cleared = logout
        .headers()
        .get(header::SET_COOKIE)
        .expect("set-cookie")
        .to_str()
        .expect("cookie");
    assert!(cleared.contains("Max-Age=0"));
}

#[tokio::test]
async fn health_endpoint_reflects_database_readiness() {
    let harness = TestHarness::new().await;

    let healthy = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/health")
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(healthy.status(), StatusCode::OK);
    let healthy_body = json_body(healthy).await;
    assert_eq!(healthy_body["status"], "ok");
    assert_eq!(healthy_body["database"], "ok");
    assert_eq!(healthy_body["version"], env!("CARGO_PKG_VERSION"));

    harness.pool.close().await;

    let unhealthy = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/health")
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(unhealthy.status(), StatusCode::SERVICE_UNAVAILABLE);
    let unhealthy_body = json_body(unhealthy).await;
    assert_eq!(unhealthy_body["status"], "error");
    assert_eq!(unhealthy_body["database"], "error");
    assert_eq!(unhealthy_body["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn openapi_document_matches_the_registered_api_surface() {
    const EXPECTED_PATHS: &[(&str, &[&str])] = &[
        ("/api/health", &["get"]),
        ("/api/openapi.json", &["get"]),
        ("/api/v1/auth/login", &["post"]),
        ("/api/v1/auth/logout", &["post"]),
        ("/api/v1/auth/reset-password", &["post"]),
        ("/api/v1/me", &["get"]),
        ("/api/v1/me/permissions", &["get"]),
        ("/api/v1/users", &["get", "post"]),
        ("/api/v1/users/summary", &["get"]),
        ("/api/v1/users/{id}", &["delete", "put"]),
        ("/api/v1/users/{id}/password-reset-link", &["post"]),
        ("/api/v1/projects/catalog", &["get"]),
        ("/api/v1/permissions", &["get"]),
        ("/api/v1/users/{id}/permissions", &["get", "put"]),
        ("/api/v1/users/{id}/project-access", &["get", "post"]),
        (
            "/api/v1/users/{id}/project-access/{project_slug}",
            &["delete"],
        ),
        ("/api/v1/projects", &["get", "post"]),
        ("/api/v1/projects/{project_slug}", &["delete", "get", "put"]),
        (
            "/api/v1/projects/{project_slug}/languages",
            &["get", "post"],
        ),
        (
            "/api/v1/projects/{project_slug}/languages/{language_code}",
            &["delete"],
        ),
        (
            "/api/v1/projects/{project_slug}/namespaces",
            &["get", "post"],
        ),
        (
            "/api/v1/projects/{project_slug}/namespaces/{namespace}",
            &["delete"],
        ),
        (
            "/api/v1/projects/{project_slug}/environments",
            &["get", "post"],
        ),
        (
            "/api/v1/projects/{project_slug}/environments/{environment_slug}",
            &["delete"],
        ),
        ("/api/v1/projects/{project_slug}/members", &["get", "post"]),
        (
            "/api/v1/projects/{project_slug}/members/{user_id}",
            &["delete"],
        ),
        (
            "/api/v1/projects/{project_slug}/translations",
            &["get", "post"],
        ),
        (
            "/api/v1/projects/{project_slug}/translations/grid",
            &["get"],
        ),
        (
            "/api/v1/projects/{project_slug}/translations/{translation_value_id}",
            &["delete", "put"],
        ),
        ("/api/v1/projects/{project_slug}/imports/json", &["post"]),
        ("/api/v1/projects/{project_slug}/exports/json", &["get"]),
        (
            "/api/v1/projects/{project_slug}/delivery-metadata",
            &["get"],
        ),
        (
            "/api/v1/projects/{project_slug}/locales/{language_code}",
            &["get"],
        ),
        (
            "/api/v1/projects/{project_slug}/delivery-manifest/{language_code}",
            &["get"],
        ),
        (
            "/static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json",
            &["get"],
        ),
    ];

    let harness = TestHarness::new().await;
    let response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/openapi.json")
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let document = json_body(response).await;
    assert_eq!(document["info"]["version"], env!("CARGO_PKG_VERSION"));

    let paths = document["paths"].as_object().expect("OpenAPI paths object");
    assert_eq!(paths.len(), EXPECTED_PATHS.len());

    for (path, expected_methods) in EXPECTED_PATHS {
        let path_item = paths
            .get(*path)
            .unwrap_or_else(|| panic!("OpenAPI path is missing: {path}"))
            .as_object()
            .expect("OpenAPI path item");
        let mut actual_methods = path_item.keys().map(String::as_str).collect::<Vec<_>>();
        actual_methods.sort_unstable();
        assert_eq!(actual_methods, *expected_methods, "methods for {path}");
    }

    assert!(document["components"]["schemas"]["HealthResponse"].is_object());
    assert_eq!(
        document["components"]["schemas"]["CreateTranslationRequest"]["properties"]["key"]
            ["maxLength"],
        MAX_TRANSLATION_KEY_LEN
    );
    assert_eq!(
        document["components"]["schemas"]["CreateTranslationRequest"]["properties"]["value"]
            ["maxLength"],
        MAX_TRANSLATION_VALUE_LEN
    );
    assert_eq!(
        document["components"]["schemas"]["UpdateTranslationRequest"]["properties"]["description"]
            ["maxLength"],
        MAX_TRANSLATION_DESCRIPTION_LEN
    );
    assert_eq!(
        document["components"]["securitySchemes"]["delivery_bearer"]["type"],
        "http"
    );
    assert_eq!(
        document["components"]["securitySchemes"]["delivery_bearer"]["scheme"],
        "bearer"
    );
    let delivery_security = document["paths"]
        ["/api/v1/projects/{project_slug}/locales/{language_code}"]["get"]["security"]
        .as_array()
        .expect("delivery security requirements");
    assert!(delivery_security.iter().any(|requirement| requirement == &json!({})));
    assert!(
        delivery_security
            .iter()
            .any(|requirement| requirement == &json!({ "delivery_bearer": [] }))
    );
}

#[tokio::test]
async fn project_owner_has_implicit_access_but_member_without_permission_is_forbidden() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user("owner@example.com", "owner-password", "Owner", true)
        .await;
    let member_id = harness
        .insert_user("member@example.com", "member-password", "Member", true)
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Owner Project", "owner-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;
    harness.add_project_access(&member_id, &project_id).await;

    let owner_cookie = harness.login("owner@example.com", "owner-password").await;
    let owner_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/owner-project")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(owner_response.status(), StatusCode::OK);

    let member_cookie = harness.login("member@example.com", "member-password").await;
    let member_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/owner-project")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(member_response.status(), StatusCode::FORBIDDEN);
    let body = json_body(member_response).await;
    assert_eq!(body["error"]["code"], "PermissionDenied");
}

#[tokio::test]
async fn non_member_without_project_access_receives_not_found() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user("outsider-owner@example.com", "owner-password", "Owner", true)
        .await;
    harness
        .insert_user("outsider@example.com", "outsider-password", "Outsider", true)
        .await;
    harness
        .insert_project(&owner_id, "Outsider Project", "outsider-project")
        .await;

    let outsider_cookie = harness
        .login("outsider@example.com", "outsider-password")
        .await;
    let response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/outsider-project")
                .header(header::COOKIE, outsider_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "NotFound");
}

#[tokio::test]
async fn project_owner_can_update_and_delete_project_without_explicit_permissions() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user(
            "self-service-owner@example.com",
            "owner-password",
            "Owner",
            true,
        )
        .await;
    harness
        .insert_project(&owner_id, "Self Service Project", "self-service-project")
        .await;

    // The owner holds no rows in user_permissions; is_owner alone must grant access.
    let owner_cookie = harness
        .login("self-service-owner@example.com", "owner-password")
        .await;

    let update_response = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/projects/self-service-project")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({ "name": "Renamed Project" }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(update_response.status(), StatusCode::OK);
    let updated = json_body(update_response).await;
    assert_eq!(updated["name"], "Renamed Project");

    let delete_response = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri("/api/v1/projects/self-service-project")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn member_without_edit_permission_cannot_update_project() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user(
            "readonly-owner@example.com",
            "owner-password",
            "Owner",
            true,
        )
        .await;
    let member_id = harness
        .insert_user(
            "readonly-member@example.com",
            "member-password",
            "Member",
            true,
        )
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Readonly Project", "readonly-project")
        .await;
    harness.add_project_access(&member_id, &project_id).await;
    harness
        .assign_permissions(&member_id, &["ViewProjects"])
        .await;

    let member_cookie = harness
        .login("readonly-member@example.com", "member-password")
        .await;
    let update_response = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/projects/readonly-project")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(
                    json!({ "name": "Should Not Apply" }).to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(update_response.status(), StatusCode::FORBIDDEN);
    let body = json_body(update_response).await;
    assert_eq!(body["error"]["code"], "PermissionDenied");
}

#[tokio::test]
async fn revoking_delete_projects_immediately_blocks_a_non_owner_member_without_logout() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;
    let owner_id = harness
        .insert_user("revoke-owner@example.com", "owner-password", "Owner", true)
        .await;
    let member_id = harness
        .insert_user("revoke-member@example.com", "member-password", "Member", true)
        .await;
    let project_a_id = harness
        .insert_project(&owner_id, "Revoke Project A", "revoke-project-a")
        .await;
    let project_b_id = harness
        .insert_project(&owner_id, "Revoke Project B", "revoke-project-b")
        .await;
    harness.add_project_access(&member_id, &project_a_id).await;
    harness.add_project_access(&member_id, &project_b_id).await;

    // Grant DeleteProjects through the real API, not a direct SQL insert, so this test
    // exercises the same code path an admin actually uses.
    let grant = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{member_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({ "permission_codes": ["ViewProjects", "DeleteProjects"] }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(grant.status(), StatusCode::NO_CONTENT);

    let member_cookie = harness
        .login("revoke-member@example.com", "member-password")
        .await;

    let delete_project_a = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri("/api/v1/projects/revoke-project-a")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(delete_project_a.status(), StatusCode::NO_CONTENT);

    // Revoke DeleteProjects via the same admin endpoint. The member never logs out or
    // gets a new session between the grant and this revocation, or between the
    // revocation and the retry below.
    let revoke = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{member_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(json!({ "permission_codes": ["ViewProjects"] }).to_string()))
                .expect("request"),
        )
        .await;
    assert_eq!(revoke.status(), StatusCode::NO_CONTENT);

    let delete_project_b = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri("/api/v1/projects/revoke-project-b")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(delete_project_b.status(), StatusCode::FORBIDDEN);
    let delete_project_b_body = json_body(delete_project_b).await;
    assert_eq!(delete_project_b_body["error"]["code"], "PermissionDenied");
}

#[tokio::test]
async fn revoking_edit_projects_immediately_blocks_a_non_owner_member_without_logout() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;
    let owner_id = harness
        .insert_user("revoke-edit-owner@example.com", "owner-password", "Owner", true)
        .await;
    let member_id = harness
        .insert_user("revoke-edit-member@example.com", "member-password", "Member", true)
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Revoke Edit Project", "revoke-edit-project")
        .await;
    harness.add_project_access(&member_id, &project_id).await;

    let grant = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{member_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({ "permission_codes": ["ViewProjects", "EditProjects"] }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(grant.status(), StatusCode::NO_CONTENT);

    let member_cookie = harness
        .login("revoke-edit-member@example.com", "member-password")
        .await;

    let first_update = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/projects/revoke-edit-project")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(json!({ "name": "Edited By Member" }).to_string()))
                .expect("request"),
        )
        .await;
    assert_eq!(first_update.status(), StatusCode::OK);

    let revoke = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{member_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(json!({ "permission_codes": ["ViewProjects"] }).to_string()))
                .expect("request"),
        )
        .await;
    assert_eq!(revoke.status(), StatusCode::NO_CONTENT);

    let second_update = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/projects/revoke-edit-project")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(json!({ "name": "Should Not Apply" }).to_string()))
                .expect("request"),
        )
        .await;
    assert_eq!(second_update.status(), StatusCode::FORBIDDEN);
    let second_update_body = json_body(second_update).await;
    assert_eq!(second_update_body["error"]["code"], "PermissionDenied");
}

#[tokio::test]
async fn public_delivery_endpoints_return_expected_payloads() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user(
            "delivery-owner@example.com",
            "delivery-password",
            "Delivery Owner",
            true,
        )
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Delivery Project", "delivery-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;
    let namespace_id = harness.insert_namespace(&project_id, "common").await;
    let language_id = harness.insert_language(&project_id, "ru", "Russian").await;
    let environment_id = harness
        .insert_environment(&project_id, "Production", "production")
        .await;
    let key_id = harness
        .insert_translation_key(&project_id, &namespace_id, "button.save")
        .await;
    harness
        .insert_translation_value(&key_id, &language_id, &environment_id, "Сохранить")
        .await;

    let metadata_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/delivery-project/delivery-metadata?environment=production")
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(metadata_response.status(), StatusCode::OK);
    assert_eq!(
        metadata_response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .expect("access-control-allow-origin"),
        "*"
    );
    let metadata_body = json_body(metadata_response).await;
    assert_eq!(metadata_body["project"], "delivery-project");
    assert_eq!(metadata_body["environment"], "production");
    assert!(metadata_body["version"].as_str().is_some());
    assert_eq!(metadata_body["languages"][0]["code"], "ru");
    assert_eq!(metadata_body["languages"][0]["name"], "Russian");
    assert_eq!(metadata_body["namespaces"][0]["name"], "common");

    let locale_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/delivery-project/locales/ru?environment=production")
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(locale_response.status(), StatusCode::OK);
    assert_eq!(
        locale_response
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=300, must-revalidate"
    );
    assert_eq!(
        locale_response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .expect("access-control-allow-origin"),
        "*"
    );
    let locale_etag = locale_response
        .headers()
        .get(header::ETAG)
        .expect("etag")
        .to_str()
        .expect("etag header")
        .to_owned();
    let locale_body = json_body(locale_response).await;
    assert_eq!(locale_body["project"], "delivery-project");
    assert!(locale_body["version"].as_str().is_some());
    assert_eq!(locale_body["values"]["common.button.save"], "Сохранить");

    let locale_not_modified = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/delivery-project/locales/ru?environment=production")
                .header(header::IF_NONE_MATCH, locale_etag.clone())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(locale_not_modified.status(), StatusCode::NOT_MODIFIED);

    let manifest_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/delivery-project/delivery-manifest/ru?environment=production")
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(manifest_response.status(), StatusCode::OK);
    assert_eq!(
        manifest_response
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=300, must-revalidate"
    );
    assert_eq!(
        manifest_response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .expect("access-control-allow-origin"),
        "*"
    );
    let manifest_body = json_body(manifest_response).await;
    let locale_bundle_url = manifest_body["locale_bundle_url"]
        .as_str()
        .expect("locale bundle url");
    assert!(locale_bundle_url.contains("/api/v1/projects/delivery-project/locales/ru?environment=production&v="));
    let namespace_url = manifest_body["namespaces"][0]["url"]
        .as_str()
        .expect("namespace url");
    assert!(namespace_url.contains("/static/delivery-project/production/ru/common.json?v="));

    let static_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(namespace_url)
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(static_response.status(), StatusCode::OK);
    assert_eq!(
        static_response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .expect("access-control-allow-origin"),
        "*"
    );
    assert_eq!(
        static_response
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=31536000, immutable"
    );
    let etag = static_response
        .headers()
        .get(header::ETAG)
        .expect("etag")
        .to_str()
        .expect("etag header")
        .to_owned();
    let static_body = json_body(static_response).await;
    assert_eq!(static_body["button.save"], "Сохранить");

    let not_modified_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(namespace_url)
                .header(header::IF_NONE_MATCH, etag)
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(not_modified_response.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(
        not_modified_response
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=31536000, immutable"
    );

    let owner_cookie = harness
        .login("delivery-owner@example.com", "delivery-password")
        .await;
    let create_translation = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/delivery-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "ru",
                        "namespace": "common",
                        "key": "button.cancel",
                        "value": "Отмена"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_translation.status(), StatusCode::CREATED);

    let locale_response_after_change = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/delivery-project/locales/ru?environment=production")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(locale_response_after_change.status(), StatusCode::OK);
    let etag_after_change = locale_response_after_change
        .headers()
        .get(header::ETAG)
        .expect("etag")
        .to_str()
        .expect("etag header")
        .to_owned();
    assert_ne!(
        etag_after_change, locale_etag,
        "ETag must change after a translation is added"
    );

    let locale_body_after_change = json_body(locale_response_after_change).await;
    assert_ne!(
        locale_body_after_change["version"], locale_body["version"],
        "version must change after a translation is added"
    );
    assert_eq!(
        locale_body_after_change["values"]["common.button.cancel"],
        "Отмена"
    );

    let stale_if_none_match = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/delivery-project/locales/ru?environment=production")
                .header(header::IF_NONE_MATCH, locale_etag)
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(
        stale_if_none_match.status(),
        StatusCode::OK,
        "a stale ETag must no longer match after the underlying data changed"
    );
}

#[tokio::test]
async fn delivery_urls_reject_a_version_that_does_not_match_the_current_content() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user(
            "version-owner@example.com",
            "version-password",
            "Version Owner",
            true,
        )
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Version Project", "version-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;
    let namespace_id = harness.insert_namespace(&project_id, "common").await;
    let language_id = harness.insert_language(&project_id, "en", "English").await;
    let environment_id = harness
        .insert_environment(&project_id, "Production", "production")
        .await;
    let key_id = harness
        .insert_translation_key(&project_id, &namespace_id, "greeting")
        .await;
    harness
        .insert_translation_value(&key_id, &language_id, &environment_id, "Hello")
        .await;

    let manifest_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/version-project/delivery-manifest/en?environment=production")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(manifest_response.status(), StatusCode::OK);
    let manifest_body = json_body(manifest_response).await;
    let locale_bundle_url = manifest_body["locale_bundle_url"]
        .as_str()
        .expect("locale bundle url")
        .to_owned();
    let namespace_url = manifest_body["namespaces"][0]["url"]
        .as_str()
        .expect("namespace url")
        .to_owned();

    // 1. locale bundle without v => short cache, not immutable.
    let locale_no_v = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/version-project/locales/en?environment=production")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(locale_no_v.status(), StatusCode::OK);
    assert_eq!(
        locale_no_v
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=300, must-revalidate"
    );

    // 2. locale bundle with the correct v (from the manifest) => immutable.
    let locale_correct_v = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(locale_bundle_url.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(locale_correct_v.status(), StatusCode::OK);
    assert_eq!(
        locale_correct_v
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=31536000, immutable"
    );

    // 3. locale bundle with a wrong v => rejected, never immutable.
    let locale_wrong_v = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(
                    "/api/v1/projects/version-project/locales/en?environment=production&v=not-the-real-version",
                )
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(locale_wrong_v.status(), StatusCode::NOT_FOUND);
    assert!(locale_wrong_v.headers().get(header::CACHE_CONTROL).is_none());

    // 4. static JSON without v => short cache, not immutable.
    let static_no_v = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/static/version-project/production/en/common.json")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(static_no_v.status(), StatusCode::OK);
    assert_eq!(
        static_no_v
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=300, must-revalidate"
    );

    // 5. static JSON with the correct v (from the manifest) => immutable.
    let static_correct_v = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(namespace_url.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(static_correct_v.status(), StatusCode::OK);
    assert_eq!(
        static_correct_v
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "public, max-age=31536000, immutable"
    );

    // 6. static JSON with a wrong v => rejected, never immutable.
    let static_wrong_v = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/static/version-project/production/en/common.json?v=not-the-real-version")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(static_wrong_v.status(), StatusCode::NOT_FOUND);
    assert!(static_wrong_v.headers().get(header::CACHE_CONTROL).is_none());

    // 7. correct v plus a matching If-None-Match still returns 304.
    let etag = static_correct_v
        .headers()
        .get(header::ETAG)
        .expect("etag")
        .to_str()
        .expect("etag header")
        .to_owned();
    let static_not_modified = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(namespace_url.as_str())
                .header(header::IF_NONE_MATCH, etag)
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(static_not_modified.status(), StatusCode::NOT_MODIFIED);

    // 9. once the content changes, the previously valid versioned URLs stop validating.
    let owner_cookie = harness
        .login("version-owner@example.com", "version-password")
        .await;
    let create_translation = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/version-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "en",
                        "namespace": "common",
                        "key": "farewell",
                        "value": "Goodbye"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_translation.status(), StatusCode::CREATED);

    let stale_locale_bundle = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(locale_bundle_url.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(
        stale_locale_bundle.status(),
        StatusCode::NOT_FOUND,
        "a versioned locale bundle URL must stop validating once the underlying content changes"
    );

    let stale_static = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(namespace_url.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(
        stale_static.status(),
        StatusCode::NOT_FOUND,
        "a versioned static URL must stop validating once the underlying content changes"
    );
}

#[tokio::test]
async fn versioned_delivery_url_honors_the_configured_bearer_token() {
    let harness = TestHarness::new_with_delivery(DeliverySettings {
        public_enabled: true,
        token: Some("delivery-secret".to_owned()),
    })
    .await;
    let owner_id = harness
        .insert_user("token-owner@example.com", "token-password", "Token Owner", true)
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Token Project", "token-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;
    let namespace_id = harness.insert_namespace(&project_id, "common").await;
    let language_id = harness.insert_language(&project_id, "en", "English").await;
    let environment_id = harness
        .insert_environment(&project_id, "Production", "production")
        .await;
    let key_id = harness
        .insert_translation_key(&project_id, &namespace_id, "greeting")
        .await;
    harness
        .insert_translation_value(&key_id, &language_id, &environment_id, "Hello")
        .await;

    let manifest_response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/token-project/delivery-manifest/en?environment=production")
                .header(header::AUTHORIZATION, "Bearer delivery-secret")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(manifest_response.status(), StatusCode::OK);
    let manifest_body = json_body(manifest_response).await;
    let namespace_url = manifest_body["namespaces"][0]["url"]
        .as_str()
        .expect("namespace url")
        .to_owned();

    let unauthorized = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(namespace_url.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(namespace_url.as_str())
                .header(header::AUTHORIZATION, "Bearer delivery-secret")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(authorized.status(), StatusCode::OK);
    assert_eq!(
        authorized
            .headers()
            .get(header::CACHE_CONTROL)
            .expect("cache-control"),
        "private, max-age=31536000, immutable"
    );
    assert_eq!(
        authorized.headers().get(header::VARY),
        Some(&header::HeaderValue::from_static("Authorization"))
    );

    let wrong_v_with_token = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/static/token-project/production/en/common.json?v=not-the-real-version")
                .header(header::AUTHORIZATION, "Bearer delivery-secret")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(wrong_v_with_token.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn disabled_delivery_endpoints_return_not_found_without_breaking_admin_api() {
    let harness = TestHarness::new_with_delivery(DeliverySettings {
        public_enabled: false,
        token: Some("ignored-token".to_owned()),
    })
    .await;

    for path in delivery_test_paths() {
        let response = harness
            .request(
                Request::builder()
                    .method("GET")
                    .uri(path)
                    .header(header::AUTHORIZATION, "Bearer ignored-token")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND, "path: {path}");
        let body = json_body(response).await;
        assert_eq!(body["error"]["code"], "NotFound", "path: {path}");
    }

    let admin_cookie = harness.login("admin@example.com", "admin-password").await;
    assert!(admin_cookie.starts_with("oxiderelay_session="));
}

#[tokio::test]
async fn protected_delivery_endpoints_require_the_configured_bearer_token() {
    let harness = TestHarness::new_with_delivery(DeliverySettings {
        public_enabled: true,
        token: Some("delivery-secret".to_owned()),
    })
    .await;

    for path in delivery_test_paths() {
        for authorization in [None, Some("Bearer wrong-secret")] {
            let mut request = Request::builder().method("GET").uri(path);
            if let Some(value) = authorization {
                request = request.header(header::AUTHORIZATION, value);
            }
            let response = harness
                .request(request.body(Body::empty()).expect("request"))
                .await;

            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "path: {path}");
            assert_eq!(
                response.headers().get(header::WWW_AUTHENTICATE),
                Some(&header::HeaderValue::from_static("Bearer"))
            );
        }

        let response = harness
            .request(
                Request::builder()
                    .method("GET")
                    .uri(path)
                    .header(header::AUTHORIZATION, "Bearer delivery-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK, "path: {path}");
        assert_eq!(
            response.headers().get(header::VARY),
            Some(&header::HeaderValue::from_static("Authorization")),
            "path: {path}"
        );
        if let Some(cache_control) = response.headers().get(header::CACHE_CONTROL) {
            assert!(
                cache_control
                    .to_str()
                    .expect("cache-control")
                    .starts_with("private,"),
                "path: {path}"
            );
        }
    }

    let preflight = harness
        .request(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/v1/projects/example/locales/en?environment=production")
                .header(header::ORIGIN, "https://app.example")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert!(preflight.status().is_success());
    assert_eq!(
        preflight.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(&header::HeaderValue::from_static("*"))
    );
}

fn delivery_test_paths() -> [&'static str; 4] {
    [
        "/api/v1/projects/example/delivery-metadata?environment=production",
        "/api/v1/projects/example/locales/en?environment=production",
        "/api/v1/projects/example/delivery-manifest/en?environment=production",
        "/static/example/production/en/common.json",
    ]
}

#[tokio::test]
async fn root_returns_backend_message_when_frontend_bundle_is_missing() {
    let harness = TestHarness::new().await;

    let response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/")
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    assert_eq!(body, "OxideRelay backend is running.");
}

#[tokio::test]
async fn admin_user_permissions_and_project_members_endpoints_work() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    let create_user = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/users")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "email": "managed-user@example.com",
                        "password": "managed-password",
                        "display_name": "Managed User",
                        "is_active": true
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(create_user.status(), StatusCode::CREATED);
    let created_user = json_body(create_user).await;
    let managed_user_id = created_user["id"].as_str().expect("user id").to_owned();

    let replace_permissions = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{managed_user_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "permission_codes": ["ViewProjects", "ReadTranslations", "EditAll"]
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(replace_permissions.status(), StatusCode::NO_CONTENT);

    let get_permissions = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/users/{managed_user_id}/permissions"))
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(get_permissions.status(), StatusCode::OK);
    let permissions = json_body(get_permissions).await;
    assert_eq!(permissions.as_array().expect("array").len(), 3);

    let list_summaries = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/users/summary?search=managed&permission=EditAll&status=active")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(list_summaries.status(), StatusCode::OK);
    let summaries = json_body(list_summaries).await;
    let summaries = summaries.as_array().expect("summary array");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0]["email"], "managed-user@example.com");
    assert_eq!(summaries[0]["direct_permissions_count"], 3);

    let owner_id = harness
        .insert_user(
            "member-owner@example.com",
            "owner-password",
            "Member Owner",
            true,
        )
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Members Project", "members-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;

    let extra_project_owner_id = harness
        .insert_user(
            "extra-owner@example.com",
            "owner-password",
            "Extra Owner",
            true,
        )
        .await;
    let extra_project_id = harness
        .insert_project(&extra_project_owner_id, "Other Project", "other-project")
        .await;
    harness.add_project_access(&extra_project_owner_id, &extra_project_id).await;

    let project_catalog = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/catalog")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(project_catalog.status(), StatusCode::OK);
    let catalog = json_body(project_catalog).await;
    assert_eq!(catalog.as_array().expect("catalog array").len(), 2);

    let owner_cookie = harness
        .login("member-owner@example.com", "owner-password")
        .await;
    let add_member = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/members-project/members")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "user_id": managed_user_id
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(add_member.status(), StatusCode::CREATED);

    let user_project_access = harness
        .request(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/users/{managed_user_id}/project-access"))
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(user_project_access.status(), StatusCode::OK);
    let user_project_access_body = json_body(user_project_access).await;
    let user_project_access_items = user_project_access_body.as_array().expect("project access array");
    assert_eq!(user_project_access_items.len(), 2);
    let member_entry = user_project_access_items
        .iter()
        .find(|item| item["project_slug"] == "members-project")
        .expect("members-project entry");
    assert_eq!(member_entry["relation"], "member");
    let no_access_entry = user_project_access_items
        .iter()
        .find(|item| item["project_slug"] == "other-project")
        .expect("other-project entry");
    assert_eq!(no_access_entry["relation"], "none");

    let filter_by_project = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/users/summary?project=members-project")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(filter_by_project.status(), StatusCode::OK);
    let filtered_users = json_body(filter_by_project).await;
    let filtered_users = filtered_users.as_array().expect("filtered users array");
    assert_eq!(filtered_users.len(), 2);
    let managed_user_summary = filtered_users
        .iter()
        .find(|item| item["id"] == managed_user_id)
        .expect("managed user summary");
    assert_eq!(managed_user_summary["selected_project_relation"], "member");

    let add_user_project_access = harness
        .request(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/users/{managed_user_id}/project-access"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "project_slug": "other-project"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(add_user_project_access.status(), StatusCode::FORBIDDEN);

    let list_members = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/members-project/members")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(list_members.status(), StatusCode::OK);
    let members = json_body(list_members).await;
    assert_eq!(members.as_array().expect("array").len(), 2);

    let admin_add_user_project_access = harness
        .request(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/users/{managed_user_id}/project-access"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "project_slug": "members-project"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(admin_add_user_project_access.status(), StatusCode::NOT_FOUND);

    let delete_member = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri(format!(
                    "/api/v1/projects/members-project/members/{managed_user_id}"
                ))
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(delete_member.status(), StatusCode::NO_CONTENT);

    let delete_user_project_access = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri(format!(
                    "/api/v1/users/{managed_user_id}/project-access/members-project"
                ))
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(delete_user_project_access.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_can_generate_and_consume_password_reset_link() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;
    let user_id = harness
        .insert_user(
            "reset-user@example.com",
            "old-password",
            "Reset User",
            true,
        )
        .await;

    let reset_user_cookie = harness.login("reset-user@example.com", "old-password").await;

    let generate = harness
        .request(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/users/{user_id}/password-reset-link"))
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(generate.status(), StatusCode::OK);
    let generate_body = json_body(generate).await;
    let reset_url = generate_body["reset_url"].as_str().expect("reset url");
    let token = reset_token_from_url(reset_url);
    assert_eq!(generate_body["expires_at"].as_str().is_some(), true);

    let second_generate = harness
        .request(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/users/{user_id}/password-reset-link"))
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(second_generate.status(), StatusCode::OK);
    let second_body = json_body(second_generate).await;
    let second_token = reset_token_from_url(
        second_body["reset_url"].as_str().expect("second reset url"),
    );
    assert_ne!(token, second_token);

    let old_token_reset = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/reset-password")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "token": token,
                        "password": "new-password-1"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(old_token_reset.status(), StatusCode::BAD_REQUEST);

    let reset = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/reset-password")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "token": second_token,
                        "password": "new-password-1"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(reset.status(), StatusCode::NO_CONTENT);

    let old_session_me = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/me")
                .header(header::COOKIE, reset_user_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(old_session_me.status(), StatusCode::UNAUTHORIZED);

    let old_login = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": "reset-user@example.com",
                        "password": "old-password"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(old_login.status(), StatusCode::UNAUTHORIZED);

    let new_login = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": "reset-user@example.com",
                        "password": "new-password-1"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(new_login.status(), StatusCode::OK);

    let reused_token = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/reset-password")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "token": second_token,
                        "password": "another-password"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(reused_token.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_user_rejects_invalid_email_and_weak_password() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    let invalid_email = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/users")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "email": "invalid-email",
                        "password": "strong-pass",
                        "display_name": "Managed User",
                        "is_active": true
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(invalid_email.status(), StatusCode::BAD_REQUEST);
    let invalid_email_body = json_body(invalid_email).await;
    assert_eq!(invalid_email_body["error"]["code"], "ValidationError");

    let weak_password = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/users")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "email": "managed-user@example.com",
                        "password": "short",
                        "display_name": "Managed User",
                        "is_active": true
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);
    let weak_password_body = json_body(weak_password).await;
    assert_eq!(weak_password_body["error"]["code"], "ValidationError");
}

#[tokio::test]
async fn last_active_administrator_cannot_be_removed_deactivated_or_stripped_of_manage_users() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    let list_users = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/users")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(list_users.status(), StatusCode::OK);
    let users = json_body(list_users).await;
    let admin_id = users
        .as_array()
        .expect("users array")
        .iter()
        .find(|user| user["email"] == "admin@example.com")
        .expect("bootstrap admin")["id"]
        .as_str()
        .expect("admin id")
        .to_owned();

    // Deleting the sole administrator is blocked.
    let delete_sole_admin = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/users/{admin_id}"))
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(delete_sole_admin.status(), StatusCode::BAD_REQUEST);
    let delete_sole_admin_body = json_body(delete_sole_admin).await;
    assert_eq!(delete_sole_admin_body["error"]["code"], "ValidationError");

    // Deactivating the sole administrator is blocked.
    let deactivate_sole_admin = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{admin_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(json!({ "is_active": false }).to_string()))
                .expect("request"),
        )
        .await;
    assert_eq!(deactivate_sole_admin.status(), StatusCode::BAD_REQUEST);
    let deactivate_sole_admin_body = json_body(deactivate_sole_admin).await;
    assert_eq!(deactivate_sole_admin_body["error"]["code"], "ValidationError");

    // Stripping ManageUsers from the sole administrator is blocked.
    let strip_sole_admin = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{admin_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({ "permission_codes": ["ViewProjects"] }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(strip_sole_admin.status(), StatusCode::BAD_REQUEST);
    let strip_sole_admin_body = json_body(strip_sole_admin).await;
    assert_eq!(strip_sole_admin_body["error"]["code"], "ValidationError");

    // Once a second active user holds ManageUsers, the guard no longer blocks the first admin.
    let second_admin_id = harness
        .insert_user("second-admin@example.com", "second-password", "Second Admin", true)
        .await;
    let grant_second_admin = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{second_admin_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({ "permission_codes": ["ManageUsers"] }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(grant_second_admin.status(), StatusCode::NO_CONTENT);

    let deactivate_first_admin_now_allowed = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{admin_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(json!({ "is_active": false }).to_string()))
                .expect("request"),
        )
        .await;
    assert_eq!(deactivate_first_admin_now_allowed.status(), StatusCode::OK);

    // The remaining administrator (second-admin) is now the last one and is protected in turn.
    let second_admin_cookie = harness
        .login("second-admin@example.com", "second-password")
        .await;
    let delete_last_remaining_admin = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/users/{second_admin_id}"))
                .header(header::COOKIE, second_admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(delete_last_remaining_admin.status(), StatusCode::BAD_REQUEST);
    let delete_last_remaining_admin_body = json_body(delete_last_remaining_admin).await;
    assert_eq!(delete_last_remaining_admin_body["error"]["code"], "ValidationError");
}

#[tokio::test]
async fn concurrent_admin_removal_requests_cannot_both_bypass_the_last_admin_guard() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    let list_users = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/users")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    let users = json_body(list_users).await;
    let admin_id = users
        .as_array()
        .expect("users array")
        .iter()
        .find(|user| user["email"] == "admin@example.com")
        .expect("bootstrap admin")["id"]
        .as_str()
        .expect("admin id")
        .to_owned();

    let second_admin_id = harness
        .insert_user("second-admin@example.com", "second-password", "Second Admin", true)
        .await;
    let grant_second_admin = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{second_admin_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({ "permission_codes": ["ManageUsers"] }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(grant_second_admin.status(), StatusCode::NO_CONTENT);

    let second_admin_cookie = harness
        .login("second-admin@example.com", "second-password")
        .await;

    // Race two mutations that each independently pass a naive, non-transactional
    // "one other admin remains" check: the first admin deactivates the second admin while,
    // at the same time, the second admin deletes the first admin. If the guard and its
    // paired write aren't serialized under the same write lock, both requests can read
    // "one other admin remains" before either write lands, and both succeed — leaving zero
    // active administrators. With the fix, exactly one must win and the other must be
    // blocked after observing the winner's committed effect.
    let deactivate_second = harness.request(
        Request::builder()
            .method("PUT")
            .uri(format!("/api/v1/users/{second_admin_id}"))
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::COOKIE, admin_cookie.as_str())
            .body(Body::from(json!({ "is_active": false }).to_string()))
            .expect("request"),
    );
    let delete_first = harness.request(
        Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/users/{admin_id}"))
            .header(header::COOKIE, second_admin_cookie.as_str())
            .body(Body::empty())
            .expect("request"),
    );

    let (deactivate_response, delete_response) = tokio::join!(deactivate_second, delete_first);

    let statuses = [deactivate_response.status(), delete_response.status()];
    let success_count = statuses.iter().filter(|status| status.is_success()).count();

    // Exactly one side may win. The loser is blocked either by the transactional
    // last-admin guard (400, if its request reaches the handler after the winner commits)
    // or by authentication itself (401, if the winner's write deactivates/deletes the
    // loser's own actor account before the loser's session is re-validated) — both outcomes
    // prove the invariant held, so either is an acceptable "safe" result here. What matters
    // is asserted below directly against the database: at least one active administrator
    // must always remain.
    assert_eq!(success_count, 1, "exactly one racing operation must succeed");
    assert!(
        statuses
            .iter()
            .any(|status| *status == StatusCode::BAD_REQUEST || *status == StatusCode::UNAUTHORIZED),
        "the other racing operation must be blocked, got {statuses:?}"
    );

    let remaining_admins: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM users u
        JOIN user_permissions up ON up.user_id = u.id
        JOIN permissions p ON p.id = up.permission_id
        WHERE u.is_active = 1 AND p.code = 'ManageUsers'
        "#,
    )
    .fetch_one(&harness.pool)
    .await
    .expect("count admins");

    assert_eq!(
        remaining_admins, 1,
        "the last-admin invariant must never be bypassed by racing requests"
    );
}

#[tokio::test]
async fn self_deletion_clears_the_session_cookie_and_signs_the_actor_out() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    // A second administrator is required so that self-deletion isn't blocked by the
    // last-admin guard itself.
    let second_admin_id = harness
        .insert_user("second-admin@example.com", "second-password", "Second Admin", true)
        .await;
    let grant_second_admin = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/users/{second_admin_id}/permissions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({ "permission_codes": ["ManageUsers"] }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(grant_second_admin.status(), StatusCode::NO_CONTENT);

    let second_admin_cookie = harness
        .login("second-admin@example.com", "second-password")
        .await;

    let me_before_delete = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/me")
                .header(header::COOKIE, second_admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(me_before_delete.status(), StatusCode::OK);

    let self_delete = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/users/{second_admin_id}"))
                .header(header::COOKIE, second_admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(self_delete.status(), StatusCode::NO_CONTENT);

    // The response must clear the session cookie in the browser...
    let cleared_cookie = self_delete
        .headers()
        .get(header::SET_COOKIE)
        .expect("set-cookie on self-delete")
        .to_str()
        .expect("cookie string");
    assert!(cleared_cookie.contains("Max-Age=0"));

    // ...and the now-deleted session must be rejected immediately, not just eventually.
    let me_after_delete = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/me")
                .header(header::COOKIE, second_admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(me_after_delete.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_rate_limit_blocks_attempts_after_the_fifteenth_failure() {
    let harness = TestHarness::new().await;
    let identifier_hash = oxiderelay_backend::util::sha256_hex("admin@example.com");
    let now = now_utc();

    sqlx::query(
        r#"
        INSERT INTO login_attempts (identifier_hash, failed_attempts, window_started_at, updated_at)
        VALUES (?1, 14, ?2, ?2)
        "#,
    )
    .bind(&identifier_hash)
    .bind(&now)
    .execute(&harness.pool)
    .await
    .expect("seed login attempts");

    let fifteenth_failure = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "email": "admin@example.com", "password": "wrong-password" }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(fifteenth_failure.status(), StatusCode::UNAUTHORIZED);

    let limited = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "email": "admin@example.com", "password": "wrong-password" }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);

    sqlx::query("UPDATE login_attempts SET failed_attempts = 14 WHERE identifier_hash = ?1")
        .bind(&identifier_hash)
        .execute(&harness.pool)
        .await
        .expect("restore attempts below limit");

    let successful_login = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "email": "admin@example.com", "password": "admin-password" }).to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(successful_login.status(), StatusCode::OK);

    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM login_attempts WHERE identifier_hash = ?1",
    )
    .bind(&identifier_hash)
    .fetch_one(&harness.pool)
    .await
    .expect("count login attempts");
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn creating_project_bootstraps_default_language_namespace_and_environments() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    let create_project = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "name": "Bootstrap Project",
                        "slug": "bootstrap-project",
                        "description": "Project with defaults"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(create_project.status(), StatusCode::CREATED);

    let languages = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/bootstrap-project/languages")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(languages.status(), StatusCode::OK);
    let languages_body = json_body(languages).await;
    let languages = languages_body.as_array().expect("languages array");
    assert_eq!(languages.len(), 1);
    assert_eq!(languages[0]["code"], "en");
    assert_eq!(languages[0]["name"], "English");

    let namespaces = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/bootstrap-project/namespaces")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(namespaces.status(), StatusCode::OK);
    let namespaces_body = json_body(namespaces).await;
    let namespaces = namespaces_body.as_array().expect("namespaces array");
    assert_eq!(namespaces.len(), 1);
    assert_eq!(namespaces[0]["name"], "common");

    let environments = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/bootstrap-project/environments")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(environments.status(), StatusCode::OK);
    let environments_body = json_body(environments).await;
    let environments = environments_body.as_array().expect("environments array");
    assert_eq!(environments.len(), 3);
    assert_eq!(environments[0]["name"], "Development");
    assert_eq!(environments[0]["slug"], "development");
    assert_eq!(environments[1]["name"], "Production");
    assert_eq!(environments[1]["slug"], "production");
    assert_eq!(environments[2]["name"], "Staging");
    assert_eq!(environments[2]["slug"], "staging");
}

#[tokio::test]
async fn project_creation_is_transactional_and_leaves_no_partial_state_on_failure() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    let create_project = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "name": "Atomic Project",
                        "slug": "atomic-project",
                        "description": "Project used to verify transactional creation"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_project.status(), StatusCode::CREATED);

    let projects_before = table_row_count(&harness.pool, "projects").await;
    let environments_before = table_row_count(&harness.pool, "environments").await;
    let namespaces_before = table_row_count(&harness.pool, "namespaces").await;
    let languages_before = table_row_count(&harness.pool, "languages").await;
    let access_before = table_row_count(&harness.pool, "user_project_access").await;

    let create_duplicate = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "name": "Duplicate Slug Project",
                        "slug": "atomic-project",
                        "description": "Second attempt with a colliding slug"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(create_duplicate.status(), StatusCode::CONFLICT);
    let create_duplicate_body = json_body(create_duplicate).await;
    assert_eq!(create_duplicate_body["error"]["code"], "Conflict");

    assert_eq!(table_row_count(&harness.pool, "projects").await, projects_before);
    assert_eq!(
        table_row_count(&harness.pool, "environments").await,
        environments_before
    );
    assert_eq!(table_row_count(&harness.pool, "namespaces").await, namespaces_before);
    assert_eq!(table_row_count(&harness.pool, "languages").await, languages_before);
    assert_eq!(
        table_row_count(&harness.pool, "user_project_access").await,
        access_before
    );
}

#[tokio::test]
async fn deleting_a_project_cascades_to_dependent_rows() {
    let harness = TestHarness::new().await;
    let admin_cookie = harness.login("admin@example.com", "admin-password").await;

    let create_project = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "name": "Cascade Project",
                        "slug": "cascade-project",
                        "description": "Project used to verify FK cascade deletes"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_project.status(), StatusCode::CREATED);
    let project_id = json_body(create_project).await["id"]
        .as_str()
        .expect("project id")
        .to_owned();

    let create_translation = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/cascade-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "en",
                        "namespace": "common",
                        "key": "cascade.key",
                        "value": "Cascade value"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_translation.status(), StatusCode::CREATED);

    assert!(scoped_row_count(&harness.pool, "namespaces", &project_id).await > 0);
    assert!(scoped_row_count(&harness.pool, "languages", &project_id).await > 0);
    assert!(scoped_row_count(&harness.pool, "environments", &project_id).await > 0);
    assert!(scoped_row_count(&harness.pool, "translation_keys", &project_id).await > 0);
    assert!(scoped_row_count(&harness.pool, "user_project_access", &project_id).await > 0);
    assert!(translation_value_count(&harness.pool, &project_id).await > 0);

    let delete_project = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri("/api/v1/projects/cascade-project")
                .header(header::COOKIE, admin_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(delete_project.status(), StatusCode::NO_CONTENT);

    assert_eq!(table_row_count_where_id(&harness.pool, "projects", &project_id).await, 0);
    assert_eq!(scoped_row_count(&harness.pool, "namespaces", &project_id).await, 0);
    assert_eq!(scoped_row_count(&harness.pool, "languages", &project_id).await, 0);
    assert_eq!(scoped_row_count(&harness.pool, "environments", &project_id).await, 0);
    assert_eq!(scoped_row_count(&harness.pool, "translation_keys", &project_id).await, 0);
    assert_eq!(
        scoped_row_count(&harness.pool, "user_project_access", &project_id).await,
        0
    );
    assert_eq!(translation_value_count(&harness.pool, &project_id).await, 0);
}

#[tokio::test]
async fn translation_grid_supports_search_pagination_and_multiple_languages() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user("grid-owner@example.com", "owner-password", "Grid Owner", true)
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Grid Project", "grid-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;

    let namespace_id = harness.insert_namespace(&project_id, "common").await;
    let en_language_id = harness.insert_language(&project_id, "en", "English").await;
    let ru_language_id = harness.insert_language(&project_id, "ru", "Russian").await;
    let sr_language_id = harness.insert_language(&project_id, "sr", "Serbian").await;
    let environment_id = harness
        .insert_environment(&project_id, "Production", "production")
        .await;

    let first_key_id = harness
        .insert_translation_key(&project_id, &namespace_id, "button.save")
        .await;
    harness
        .insert_translation_value(&first_key_id, &en_language_id, &environment_id, "Save")
        .await;
    harness
        .insert_translation_value(&first_key_id, &ru_language_id, &environment_id, "Сохранить")
        .await;
    harness
        .insert_translation_value(&first_key_id, &sr_language_id, &environment_id, "Sačuvaj")
        .await;

    let second_key_id = harness
        .insert_translation_key(&project_id, &namespace_id, "button.cancel")
        .await;
    harness
        .insert_translation_value(&second_key_id, &en_language_id, &environment_id, "Cancel")
        .await;
    harness
        .insert_translation_value(&second_key_id, &ru_language_id, &environment_id, "Отмена")
        .await;
    harness
        .insert_translation_value(&second_key_id, &sr_language_id, &environment_id, "Otkaži")
        .await;

    let owner_cookie = harness.login("grid-owner@example.com", "owner-password").await;
    let response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/grid-project/translations/grid?environment=production&languages=en,ru&search=%D0%A1%D0%BE%D1%85%D1%80%D0%B0%D0%BD%D0%B8%D1%82%D1%8C&page=1&page_size=1")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["total"], 1);
    assert_eq!(body["page"], 1);
    assert_eq!(body["page_size"], 1);
    assert_eq!(body["items"].as_array().expect("items").len(), 1);
    assert_eq!(body["items"][0]["key"], "button.save");
    assert_eq!(body["items"][0]["values"]["en"]["value"], "Save");
    assert_eq!(body["items"][0]["values"]["ru"]["value"], "Сохранить");

    let missing_key_id = harness
        .insert_translation_key(&project_id, &namespace_id, "button.publish")
        .await;
    harness
        .insert_translation_value(&missing_key_id, &en_language_id, &environment_id, "Publish")
        .await;
    harness
        .insert_translation_value(&missing_key_id, &ru_language_id, &environment_id, "Опубликовать")
        .await;

    let response = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/grid-project/translations/grid?environment=production&namespace=common&languages=en,ru,sr&base_language=en&missing_languages=ru,sr&page=1&page_size=1")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["total"], 1);
    assert_eq!(body["page_size"], 1);
    assert_eq!(body["items"][0]["key"], "button.publish");
    assert_eq!(body["items"][0]["values"]["en"]["value"], "Publish");
    assert_eq!(body["items"][0]["values"]["ru"]["value"], "Опубликовать");
    assert!(body["items"][0]["values"].get("sr").is_none());
}

#[tokio::test]
async fn translation_crud_import_export_and_environment_acl_work() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user(
            "translation-owner@example.com",
            "owner-password",
            "Translation Owner",
            true,
        )
        .await;
    let member_id = harness
        .insert_user(
            "translation-member@example.com",
            "member-password",
            "Translation Member",
            true,
        )
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Translations Project", "translations-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;
    harness.add_project_access(&member_id, &project_id).await;
    harness.insert_namespace(&project_id, "common").await;
    harness.insert_language(&project_id, "ru", "Russian").await;
    harness
        .insert_environment(&project_id, "Production", "production")
        .await;
    harness
        .assign_permissions(
            &member_id,
            &["EditTranslations", "ExportTranslations", "ImportTranslations"],
        )
        .await;

    let owner_cookie = harness
        .login("translation-owner@example.com", "owner-password")
        .await;
    let create_translation = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/translations-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "ru",
                        "namespace": "common",
                        "key": "button.save",
                        "value": "Сохранить",
                        "description": "Save button"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(create_translation.status(), StatusCode::CREATED);
    let created_translation = json_body(create_translation).await;
    let translation_value_id = created_translation["id"]
        .as_str()
        .expect("translation id")
        .to_owned();

    let update_translation = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!(
                    "/api/v1/projects/translations-project/translations/{translation_value_id}"
                ))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "value": "Сохранить сейчас",
                        "description": "Updated save button"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(update_translation.status(), StatusCode::OK);
    let updated = json_body(update_translation).await;
    assert_eq!(updated["value"], "Сохранить сейчас");
    assert_eq!(updated["description"], "Updated save button");

    let list_translations = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/translations-project/translations?environment=production&language=ru&namespace=common")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(list_translations.status(), StatusCode::OK);
    let listed = json_body(list_translations).await;
    assert_eq!(listed.as_array().expect("array").len(), 1);

    let export_translations = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/translations-project/exports/json?environment=production&language=ru&namespace=common")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(export_translations.status(), StatusCode::OK);
    let exported = json_body(export_translations).await;
    assert_eq!(exported["button.save"], "Сохранить сейчас");

    let import_translations = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/translations-project/imports/json")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "ru",
                        "namespace": "common",
                        "values": {
                            "button.save": "Сохранить импортом",
                            "button.cancel": "Отмена"
                        }
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;

    assert_eq!(import_translations.status(), StatusCode::OK);
    let imported = json_body(import_translations).await;
    assert_eq!(imported["imported"], 2);

    let export_after_import = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/translations-project/exports/json?environment=production&language=ru&namespace=common")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(export_after_import.status(), StatusCode::OK);
    let exported_after_import = json_body(export_after_import).await;
    assert_eq!(exported_after_import["button.save"], "Сохранить импортом");
    assert_eq!(exported_after_import["button.cancel"], "Отмена");

    let member_cookie = harness
        .login("translation-member@example.com", "member-password")
        .await;
    let forbidden = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/translations-project/translations?environment=production")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    let forbidden_body = json_body(forbidden).await;
    assert_eq!(forbidden_body["error"]["code"], "PermissionDenied");

    harness
        .assign_permissions(&member_id, &["ReadTranslations"])
        .await;
    let allowed = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/translations-project/translations?environment=production")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(allowed.status(), StatusCode::OK);

    let delete_translation = harness
        .request(
            Request::builder()
                .method("DELETE")
                .uri(format!(
                    "/api/v1/projects/translations-project/translations/{translation_value_id}"
                ))
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;

    assert_eq!(delete_translation.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn write_only_translation_permissions_cannot_disclose_values_without_read_translations() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user(
            "wo-owner@example.com",
            "owner-password",
            "Write Only Owner",
            true,
        )
        .await;
    let member_id = harness
        .insert_user(
            "wo-member@example.com",
            "member-password",
            "Write Only Member",
            true,
        )
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Write Only Project", "write-only-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;
    harness.add_project_access(&member_id, &project_id).await;
    harness.insert_namespace(&project_id, "common").await;
    harness.insert_language(&project_id, "ru", "Russian").await;
    harness
        .insert_environment(&project_id, "Production", "production")
        .await;

    let owner_cookie = harness.login("wo-owner@example.com", "owner-password").await;
    let seed_create = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/write-only-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, owner_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "ru",
                        "namespace": "common",
                        "key": "button.save",
                        "value": "Секретное значение",
                        "description": "Save button"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(seed_create.status(), StatusCode::CREATED);
    let seeded = json_body(seed_create).await;
    let translation_value_id = seeded["id"].as_str().expect("translation id").to_owned();

    // Grant every write permission but withhold ReadTranslations, matching the QA report:
    // an actor who can edit/export must not be able to recover translation values through
    // those write-only endpoints.
    harness
        .assign_permissions(
            &member_id,
            &[
                "EditTranslations",
                "ExportTranslations",
                "DeleteTranslations",
                "EditProd",
            ],
        )
        .await;
    let member_cookie = harness.login("wo-member@example.com", "member-password").await;

    let grid_denied = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/write-only-project/translations/grid?environment=production&namespace=common&languages=ru")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(grid_denied.status(), StatusCode::FORBIDDEN);

    let create_denied = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/write-only-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "ru",
                        "namespace": "common",
                        "key": "button.cancel",
                        "value": "Отмена"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_denied.status(), StatusCode::FORBIDDEN);
    let create_denied_body = json_body(create_denied).await;
    assert_eq!(create_denied_body["error"]["code"], "PermissionDenied");

    let update_denied = harness
        .request(
            Request::builder()
                .method("PUT")
                .uri(format!(
                    "/api/v1/projects/write-only-project/translations/{translation_value_id}"
                ))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(json!({ "description": "Retitled" }).to_string()))
                .expect("request"),
        )
        .await;
    assert_eq!(update_denied.status(), StatusCode::FORBIDDEN);
    let update_denied_body = json_body(update_denied).await;
    assert_eq!(update_denied_body["error"]["code"], "PermissionDenied");

    let export_denied = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/write-only-project/exports/json?environment=production&language=ru&namespace=common")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(export_denied.status(), StatusCode::FORBIDDEN);
    let export_denied_body = json_body(export_denied).await;
    assert_eq!(export_denied_body["error"]["code"], "PermissionDenied");

    // Once ReadTranslations is granted too, the same write endpoints succeed and disclose
    // values as expected.
    harness.assign_permissions(&member_id, &["ReadTranslations"]).await;

    let grid_allowed = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/write-only-project/translations/grid?environment=production&namespace=common&languages=ru")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(grid_allowed.status(), StatusCode::OK);

    let create_allowed = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/write-only-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "ru",
                        "namespace": "common",
                        "key": "button.cancel",
                        "value": "Отмена"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_allowed.status(), StatusCode::CREATED);

    let export_allowed = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/write-only-project/exports/json?environment=production&language=ru&namespace=common")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(export_allowed.status(), StatusCode::OK);
    let exported = json_body(export_allowed).await;
    assert_eq!(exported["button.save"], "Секретное значение");
}

#[tokio::test]
async fn translation_create_and_update_apply_the_same_validation_limits() {
    let (harness, owner_cookie, _) = translation_validation_setup().await;
    let create_path = "/api/v1/projects/validation-project/translations";
    let base_create = json!({
        "environment": "production",
        "language": "en",
        "namespace": "common",
        "key": "button.save",
        "value": "Save",
        "description": "Save button"
    });

    let invalid_create_cases = [
        (
            json!({ "key": "   " }),
            "Translation key cannot be empty.",
        ),
        (
            json!({ "key": "k".repeat(MAX_TRANSLATION_KEY_LEN + 1) }),
            "must be at most 500 characters",
        ),
        (
            json!({ "value": "   " }),
            "cannot be empty",
        ),
        (
            json!({ "value": "v".repeat(MAX_TRANSLATION_VALUE_LEN + 1) }),
            "must be at most 10000 characters",
        ),
        (
            json!({ "description": "d".repeat(MAX_TRANSLATION_DESCRIPTION_LEN + 1) }),
            "Description must be at most 2000 characters",
        ),
        (
            json!({ "key": "common.button.save" }),
            "must not include the namespace prefix",
        ),
        (
            json!({ "key": "button{save}" }),
            "contains unsupported characters",
        ),
    ];

    for (overrides, expected_message) in invalid_create_cases {
        let mut payload = base_create.clone();
        payload
            .as_object_mut()
            .expect("create object")
            .extend(overrides.as_object().expect("override object").clone());
        let response = json_request(&harness, "POST", create_path, &owner_cookie, payload).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = json_body(response).await;
        assert!(
            body["error"]["message"]
                .as_str()
                .expect("validation message")
                .contains(expected_message),
            "{body}"
        );
    }

    let mut valid_create = base_create;
    valid_create["description"] = json!("   ");
    let response = json_request(
        &harness,
        "POST",
        create_path,
        &owner_cookie,
        valid_create,
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let created = json_body(response).await;
    assert!(created["description"].is_null());
    let translation_id = created["id"].as_str().expect("translation id");
    let update_path = format!(
        "/api/v1/projects/validation-project/translations/{translation_id}"
    );

    for (payload, expected_message) in [
        (
            json!({ "value": "   " }),
            "Translation value cannot be empty",
        ),
        (
            json!({ "value": "v".repeat(MAX_TRANSLATION_VALUE_LEN + 1) }),
            "must be at most 10000 characters",
        ),
        (
            json!({ "description": "d".repeat(MAX_TRANSLATION_DESCRIPTION_LEN + 1) }),
            "Description must be at most 2000 characters",
        ),
    ] {
        let response =
            json_request(&harness, "PUT", &update_path, &owner_cookie, payload).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = json_body(response).await;
        assert!(
            body["error"]["message"]
                .as_str()
                .expect("validation message")
                .contains(expected_message),
            "{body}"
        );
    }

    let response = json_request(
        &harness,
        "PUT",
        &update_path,
        &owner_cookie,
        json!({ "value": "  Save now  ", "description": "   " }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let updated = json_body(response).await;
    assert_eq!(updated["value"], "Save now");
    assert!(updated["description"].is_null());
}

#[tokio::test]
async fn translation_import_is_atomic_upserts_and_enforces_batch_limits() {
    let (harness, owner_cookie, project_id) = translation_validation_setup().await;
    let import_path = "/api/v1/projects/validation-project/imports/json";

    let response = import_request(
        &harness,
        import_path,
        &owner_cookie,
        json!({ "button.save": "Save" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["imported"], 1);

    let response = import_request(
        &harness,
        import_path,
        &owner_cookie,
        json!({
            "button.save": "Save again",
            "button.cancel": "Cancel"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["imported"], 2);
    assert_eq!(translation_value_count(&harness.pool, &project_id).await, 2);

    let invalid_batches = [
        (
            json!({ "valid.atomic": "Valid", "": "Empty key" }),
            "Translation key cannot be empty",
        ),
        (
            json!({
                "valid.atomic": "Valid",
                "k".repeat(MAX_TRANSLATION_KEY_LEN + 1): "Too long"
            }),
            "must be at most 500 characters",
        ),
        (
            json!({
                "valid.atomic": "Valid",
                "too.long": "v".repeat(MAX_TRANSLATION_VALUE_LEN + 1)
            }),
            "must be at most 10000 characters",
        ),
        (
            json!({ "valid.atomic": "Valid", "empty.value": "   " }),
            "cannot be empty",
        ),
        (
            json!({ "valid.atomic": "Valid", "common.prefixed": "Invalid" }),
            "must not include the namespace prefix",
        ),
        (
            json!({ "valid.atomic": "Valid", "button{save}": "Invalid" }),
            "contains unsupported characters",
        ),
    ];

    for (values, expected_message) in invalid_batches {
        let before = translation_value_count(&harness.pool, &project_id).await;
        let response = import_request(&harness, import_path, &owner_cookie, values).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = json_body(response).await;
        assert!(
            body["error"]["message"]
                .as_str()
                .expect("validation message")
                .contains(expected_message),
            "{body}"
        );
        assert_eq!(
            translation_value_count(&harness.pool, &project_id).await,
            before,
            "an invalid batch must not persist any entry"
        );
    }

    let accepted_values = (0..MAX_TRANSLATION_IMPORT_ENTRIES)
        .map(|index| (format!("bulk.key.{index}"), json!(format!("Value {index}"))))
        .collect::<serde_json::Map<_, _>>();
    let response = import_request(
        &harness,
        import_path,
        &owner_cookie,
        Value::Object(accepted_values),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["imported"],
        MAX_TRANSLATION_IMPORT_ENTRIES
    );

    let rejected_values = (0..=MAX_TRANSLATION_IMPORT_ENTRIES)
        .map(|index| (format!("overflow.key.{index}"), json!("Value")))
        .collect::<serde_json::Map<_, _>>();
    let before = translation_value_count(&harness.pool, &project_id).await;
    let response = import_request(
        &harness,
        import_path,
        &owner_cookie,
        Value::Object(rejected_values),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        translation_value_count(&harness.pool, &project_id).await,
        before
    );
}

#[tokio::test]
async fn custom_environments_use_edit_all_and_production_uses_edit_prod() {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user("environment-owner@example.com", "owner-password", "Environment Owner", true)
        .await;
    let member_id = harness
        .insert_user("environment-member@example.com", "member-password", "Environment Member", true)
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Environment Project", "environment-project")
        .await;
    harness.add_project_access(&member_id, &project_id).await;
    harness.insert_namespace(&project_id, "common").await;
    harness.insert_language(&project_id, "en", "English").await;
    harness.insert_environment(&project_id, "QA", "qa").await;
    harness
        .insert_environment(&project_id, "Production", "production")
        .await;
    harness
        .assign_permissions(&member_id, &["ReadTranslations"])
        .await;

    let member_cookie = harness
        .login("environment-member@example.com", "member-password")
        .await;
    let read_qa = harness
        .request(
            Request::builder()
                .method("GET")
                .uri("/api/v1/projects/environment-project/translations?environment=qa")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert_eq!(read_qa.status(), StatusCode::OK);

    harness
        .assign_permissions(&member_id, &["EditTranslations", "EditAll"])
        .await;

    let create_qa = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/environment-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "qa",
                        "language": "en",
                        "namespace": "common",
                        "key": "feature.enabled",
                        "value": "Enabled"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_qa.status(), StatusCode::CREATED);

    let create_production_without_permission = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/environment-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "en",
                        "namespace": "common",
                        "key": "feature.enabled",
                        "value": "Enabled"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(
        create_production_without_permission.status(),
        StatusCode::FORBIDDEN
    );

    harness
        .assign_permissions(&member_id, &["EditTranslations", "EditProd"])
        .await;
    let create_production = harness
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/environment-project/translations")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, member_cookie.as_str())
                .body(Body::from(
                    json!({
                        "environment": "production",
                        "language": "en",
                        "namespace": "common",
                        "key": "feature.enabled",
                        "value": "Enabled"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await;
    assert_eq!(create_production.status(), StatusCode::CREATED);
}

struct TestHarness {
    _temp_dir: TempDir,
    pool: SqlitePool,
    app: Router,
}

impl TestHarness {
    async fn new() -> Self {
        Self::new_with_delivery(DeliverySettings::default()).await
    }

    async fn new_with_delivery(delivery: DeliverySettings) -> Self {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database_path = temp_dir.path().join("test.sqlite");
        let settings = Settings {
            server: ServerSettings {
                host: "127.0.0.1".to_owned(),
                port: 0,
            },
            database: DatabaseSettings {
                path: database_path,
            },
            session: SessionSettings {
                cookie_name: "oxiderelay_session".to_owned(),
                ttl_hours: 24 * 7,
                cookie_secure: false,
            },
            delivery,
            bootstrap_admin: BootstrapAdminSettings {
                email: Some("admin@example.com".to_owned()),
                password: Some("admin-password".to_owned()),
            },
            frontend: FrontendSettings {
                dist_path: temp_dir.path().join("missing-frontend-dist"),
            },
        };

        let pool = db::initialize(&settings)
            .await
            .expect("database initialization");
        let app = http::router(
            AppState::new(
                pool.clone(),
                settings.session.clone(),
                settings.delivery.clone(),
            ),
            settings.frontend.dist_path.clone(),
        );

        Self {
            _temp_dir: temp_dir,
            pool,
            app,
        }
    }

    async fn request(&self, request: Request<Body>) -> axum::response::Response {
        self.app
            .clone()
            .oneshot(request)
            .await
            .expect("router response")
    }

    async fn login(&self, email: &str, password: &str) -> String {
        let response = self
            .request(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "email": email,
                            "password": password
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await;

        assert_eq!(response.status(), StatusCode::OK);
        session_cookie(&response)
    }

    async fn insert_user(
        &self,
        email: &str,
        password: &str,
        display_name: &str,
        is_active: bool,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        sqlx::query(
            r#"
            INSERT INTO users (id, email, password_hash, display_name, is_active, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(&id)
        .bind(email)
        .bind(hash_password(password))
        .bind(display_name)
        .bind(if is_active { 1 } else { 0 })
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .expect("insert user");

        id
    }

    async fn insert_project(&self, owner_user_id: &str, name: &str, slug: &str) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        sqlx::query(
            r#"
            INSERT INTO projects (id, name, slug, description, owner_user_id, created_at, updated_at)
            VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(slug)
        .bind(owner_user_id)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .expect("insert project");

        id
    }

    async fn add_project_access(&self, user_id: &str, project_id: &str) {
        sqlx::query(
            r#"
            INSERT INTO user_project_access (user_id, project_id, created_at)
            VALUES (?1, ?2, ?3)
            "#,
        )
        .bind(user_id)
        .bind(project_id)
        .bind(now_utc())
        .execute(&self.pool)
        .await
        .expect("add project access");
    }

    async fn assign_permissions(&self, user_id: &str, permission_codes: &[&str]) {
        for code in permission_codes {
            sqlx::query(
                r#"
                INSERT INTO user_permissions (user_id, permission_id)
                SELECT ?1, id
                FROM permissions
                WHERE code = ?2
                ON CONFLICT(user_id, permission_id) DO NOTHING
                "#,
            )
            .bind(user_id)
            .bind(code)
            .execute(&self.pool)
            .await
            .expect("assign permission");
        }
    }

    async fn insert_namespace(&self, project_id: &str, name: &str) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        sqlx::query(
            r#"
            INSERT INTO namespaces (id, project_id, name, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .expect("insert namespace");
        id
    }

    async fn insert_language(&self, project_id: &str, code: &str, name: &str) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        sqlx::query(
            r#"
            INSERT INTO languages (id, project_id, code, name, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(code)
        .bind(name)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .expect("insert language");
        id
    }

    async fn insert_environment(&self, project_id: &str, name: &str, slug: &str) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        sqlx::query(
            r#"
            INSERT INTO environments (id, project_id, name, slug, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(slug)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .expect("insert environment");
        id
    }

    async fn insert_translation_key(
        &self,
        project_id: &str,
        namespace_id: &str,
        key: &str,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        sqlx::query(
            r#"
            INSERT INTO translation_keys (id, project_id, namespace_id, key, description, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
            "#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(namespace_id)
        .bind(key)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .expect("insert translation key");
        id
    }

    async fn insert_translation_value(
        &self,
        translation_key_id: &str,
        language_id: &str,
        environment_id: &str,
        value: &str,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        sqlx::query(
            r#"
            INSERT INTO translation_values (
                id, translation_key_id, language_id, environment_id, value, updated_by_user_id, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)
            "#,
        )
        .bind(&id)
        .bind(translation_key_id)
        .bind(language_id)
        .bind(environment_id)
        .bind(value)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .expect("insert translation value");
        id
    }
}

async fn translation_validation_setup() -> (TestHarness, String, String) {
    let harness = TestHarness::new().await;
    let owner_id = harness
        .insert_user(
            "validation-owner@example.com",
            "owner-password",
            "Validation Owner",
            true,
        )
        .await;
    let project_id = harness
        .insert_project(&owner_id, "Validation Project", "validation-project")
        .await;
    harness.add_project_access(&owner_id, &project_id).await;
    harness.insert_namespace(&project_id, "common").await;
    harness.insert_language(&project_id, "en", "English").await;
    harness
        .insert_environment(&project_id, "Production", "production")
        .await;
    let owner_cookie = harness
        .login("validation-owner@example.com", "owner-password")
        .await;

    (harness, owner_cookie, project_id)
}

async fn json_request(
    harness: &TestHarness,
    method: &str,
    path: &str,
    cookie: &str,
    payload: Value,
) -> axum::response::Response {
    harness
        .request(
            Request::builder()
                .method(method)
                .uri(path)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie)
                .body(Body::from(payload.to_string()))
                .expect("request"),
        )
        .await
}

async fn import_request(
    harness: &TestHarness,
    path: &str,
    cookie: &str,
    values: Value,
) -> axum::response::Response {
    json_request(
        harness,
        "POST",
        path,
        cookie,
        json!({
            "environment": "production",
            "language": "en",
            "namespace": "common",
            "values": values
        }),
    )
    .await
}

fn session_cookie(response: &axum::response::Response) -> String {
    let value = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("set-cookie")
        .to_str()
        .expect("cookie string");
    value.split(';').next().expect("cookie pair").to_owned()
}

fn reset_token_from_url(url: &str) -> String {
    url.split("token=")
        .nth(1)
        .expect("token query")
        .to_owned()
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("json")
}

async fn table_row_count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .expect("row count")
}

async fn table_row_count_where_id(pool: &SqlitePool, table: &str, id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?1"))
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("row count")
}

async fn scoped_row_count(pool: &SqlitePool, table: &str, project_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table} WHERE project_id = ?1"))
        .bind(project_id)
        .fetch_one(pool)
        .await
        .expect("row count")
}

async fn translation_value_count(pool: &SqlitePool, project_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        WHERE tk.project_id = ?1
        "#,
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .expect("row count")
}

fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("password hash")
        .to_string()
}

fn now_utc() -> String {
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("timestamp")
}
