use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::config::Settings;

pub async fn run(pool: &SqlitePool, settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
    seed_permissions(pool).await?;
    bootstrap_initial_admin(pool, settings).await?;

    Ok(())
}

async fn seed_permissions(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let mut transaction = pool.begin().await?;

    for (code, description) in permissions_catalog() {
        sqlx::query(
            r#"
            INSERT INTO permissions (id, code, description)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(code) DO UPDATE SET
                description = excluded.description
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(code)
        .bind(description)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    Ok(())
}

async fn bootstrap_initial_admin(
    pool: &SqlitePool,
    settings: &Settings,
) -> Result<(), Box<dyn std::error::Error>> {
    let existing_user_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM users")
        .fetch_one(pool)
        .await?
        .get("count");

    if existing_user_count > 0 {
        return Ok(());
    }

    let email = settings
        .bootstrap_admin
        .email
        .as_deref()
        .ok_or("missing OXIDERELAY_ADMIN_EMAIL for initial bootstrap")?;
    let password = settings
        .bootstrap_admin
        .password
        .as_deref()
        .ok_or("missing OXIDERELAY_ADMIN_PASSWORD for initial bootstrap")?;

    let password_hash = crate::util::hash_password(password).map_err(|e| format!("{:?}", e))?;
    let timestamp = crate::util::now_utc().map_err(|e| format!("{:?}", e))?;
    let user_id = Uuid::new_v4().to_string();

    let mut transaction = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO users (
            id,
            email,
            password_hash,
            display_name,
            is_active,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
        "#,
    )
    .bind(&user_id)
    .bind(email)
    .bind(password_hash)
    .bind("Administrator")
    .bind(&timestamp)
    .bind(&timestamp)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO user_permissions (user_id, permission_id)
        SELECT ?1, id
        FROM permissions
        "#,
    )
    .bind(&user_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(())
}



fn permissions_catalog() -> &'static [(&'static str, &'static str)] {
    &[
        (
            "ManageUsers",
            "Create, update, deactivate, and remove system users.",
        ),
        (
            "ManagePermissions",
            "Assign and remove direct user permissions from existing users.",
        ),
        ("CreateProjects", "Create new localization projects."),
        (
            "EditProjects",
            "Update project metadata and related configuration.",
        ),
        ("DeleteProjects", "Delete localization projects."),
        (
            "ViewProjects",
            "View project details and project-scoped resources.",
        ),
        (
            "ManageProjectMembers",
            "Grant or revoke project access for other users.",
        ),
        (
            "ReadTranslations",
            "Read translations through the admin API.",
        ),
        ("EditTranslations", "Create and update translations."),
        ("DeleteTranslations", "Delete translation values."),
        (
            "ImportTranslations",
            "Import translations from JSON payloads.",
        ),
        (
            "ExportTranslations",
            "Export translations as JSON payloads.",
        ),
        ("ReadDevelopment", "Read development translations."),
        ("ReadStaging", "Read staging translations."),
        ("ReadProduction", "Read production translations."),
        ("EditDevelopment", "Modify development translations."),
        ("EditStaging", "Modify staging translations."),
        ("EditProduction", "Modify production translations."),
    ]
}
