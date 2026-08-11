use oxiderelay_backend::{
    config::{
        BootstrapAdminSettings, DatabaseSettings, DeliverySettings, FrontendSettings,
        ServerSettings, SessionSettings, Settings,
    },
    db,
};
use sqlx::Row;
use tempfile::TempDir;

fn settings_with_admin(
    temp_dir: &TempDir,
    email: Option<&str>,
    password: Option<&str>,
) -> Settings {
    Settings {
        server: ServerSettings {
            host: "127.0.0.1".to_owned(),
            port: 0,
        },
        database: DatabaseSettings {
            path: temp_dir.path().join("bootstrap.sqlite"),
        },
        session: SessionSettings {
            cookie_name: "oxiderelay_session".to_owned(),
            ttl_hours: 24 * 7,
            cookie_secure: false,
        },
        delivery: DeliverySettings::default(),
        bootstrap_admin: BootstrapAdminSettings {
            email: email.map(str::to_owned),
            password: password.map(str::to_owned),
        },
        frontend: FrontendSettings {
            dist_path: temp_dir.path().join("missing-frontend-dist"),
        },
    }
}

#[tokio::test]
async fn bootstrap_fails_when_email_is_missing() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings = settings_with_admin(&temp_dir, None, Some("admin-password"));

    let error = db::initialize(&settings)
        .await
        .expect_err("bootstrap must fail without an admin email");

    let message = error.to_string();
    assert!(message.contains("empty"));
    assert!(message.contains("OXIDERELAY_ADMIN_EMAIL"));
    assert!(message.contains("OXIDERELAY_ADMIN_PASSWORD"));
}

#[tokio::test]
async fn bootstrap_fails_when_password_is_missing() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings = settings_with_admin(&temp_dir, Some("admin@example.com"), None);

    let error = db::initialize(&settings)
        .await
        .expect_err("bootstrap must fail without an admin password");

    assert!(error.to_string().contains("OXIDERELAY_ADMIN_EMAIL"));
}

#[tokio::test]
async fn bootstrap_fails_when_credentials_are_empty_strings() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings = settings_with_admin(&temp_dir, Some(""), Some(""));

    let error = db::initialize(&settings)
        .await
        .expect_err("bootstrap must fail with empty admin credentials");

    assert!(error.to_string().contains("required"));
}

#[tokio::test]
async fn bootstrap_fails_with_invalid_email() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings = settings_with_admin(&temp_dir, Some("not-an-email"), Some("admin-password"));

    let error = db::initialize(&settings)
        .await
        .expect_err("bootstrap must fail with an invalid email");

    assert!(error.to_string().contains("Email"));
}

#[tokio::test]
async fn bootstrap_fails_with_short_password() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings = settings_with_admin(&temp_dir, Some("admin@example.com"), Some("short"));

    let error = db::initialize(&settings)
        .await
        .expect_err("bootstrap must fail with a password below the minimum length");

    assert!(error.to_string().contains("Password"));
}

#[tokio::test]
async fn bootstrap_rejects_the_change_me_placeholder_password() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings = settings_with_admin(&temp_dir, Some("admin@example.com"), Some("change-me"));

    let error = db::initialize(&settings)
        .await
        .expect_err("bootstrap must reject the change-me placeholder password");

    assert!(error.to_string().contains("change-me"));
}

#[tokio::test]
async fn bootstrap_normalizes_a_mixed_case_email_to_lowercase() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings =
        settings_with_admin(&temp_dir, Some("Admin@Example.COM"), Some("admin-password"));

    let pool = db::initialize(&settings)
        .await
        .expect("bootstrap with valid credentials must succeed");

    let stored_email: String = sqlx::query("SELECT email FROM users LIMIT 1")
        .fetch_one(&pool)
        .await
        .expect("admin user row")
        .get("email");

    assert_eq!(stored_email, "admin@example.com");
}

#[tokio::test]
async fn bootstrap_succeeds_with_valid_credentials_and_grants_all_permissions() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let settings =
        settings_with_admin(&temp_dir, Some("admin@example.com"), Some("admin-password"));

    let pool = db::initialize(&settings)
        .await
        .expect("bootstrap with valid credentials must succeed");

    let user_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM users")
        .fetch_one(&pool)
        .await
        .expect("user count")
        .get("count");
    assert_eq!(user_count, 1);

    let is_active: i64 = sqlx::query("SELECT is_active FROM users LIMIT 1")
        .fetch_one(&pool)
        .await
        .expect("admin user row")
        .get("is_active");
    assert_eq!(is_active, 1);

    let permission_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM permissions")
        .fetch_one(&pool)
        .await
        .expect("permission count")
        .get("count");

    let granted_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM user_permissions")
        .fetch_one(&pool)
        .await
        .expect("granted permission count")
        .get("count");

    assert!(permission_count > 0);
    assert_eq!(granted_count, permission_count);
}

#[tokio::test]
async fn restarting_with_an_existing_database_requires_no_bootstrap_variables() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let first_start =
        settings_with_admin(&temp_dir, Some("admin@example.com"), Some("admin-password"));

    db::initialize(&first_start)
        .await
        .expect("first bootstrap with valid credentials must succeed")
        .close()
        .await;

    let restart = settings_with_admin(&temp_dir, None, None);

    let pool = db::initialize(&restart)
        .await
        .expect("restart against an existing database must not require bootstrap variables");

    let user_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM users")
        .fetch_one(&pool)
        .await
        .expect("user count")
        .get("count");
    assert_eq!(user_count, 1);
}
