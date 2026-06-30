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
        BootstrapAdminSettings, DatabaseSettings, FrontendSettings, ServerSettings,
        SessionSettings, Settings,
    },
    db, http,
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
                .header(header::IF_NONE_MATCH, locale_etag)
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
                        "permission_codes": ["ViewProjects", "ReadTranslations", "ReadProduction"]
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

    let second_key_id = harness
        .insert_translation_key(&project_id, &namespace_id, "button.cancel")
        .await;
    harness
        .insert_translation_value(&second_key_id, &en_language_id, &environment_id, "Cancel")
        .await;
    harness
        .insert_translation_value(&second_key_id, &ru_language_id, &environment_id, "Отмена")
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
            &[
                "EditTranslations",
                "ReadTranslations",
                "ExportTranslations",
                "ImportTranslations",
            ],
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
        .assign_permissions(&member_id, &["ReadProduction"])
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

struct TestHarness {
    _temp_dir: TempDir,
    pool: SqlitePool,
    app: Router,
}

impl TestHarness {
    async fn new() -> Self {
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
            AppState::new(pool.clone(), settings.session.clone()),
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
