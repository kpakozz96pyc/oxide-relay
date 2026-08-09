use sqlx::SqlitePool;

use crate::{
    errors::AppResult,
    repository::{projects, translations, users},
    util,
};

pub struct DemoSeedSummary {
    pub project_name: String,
    pub project_slug: String,
    pub language_codes: Vec<String>,
    pub namespace_names: Vec<String>,
    pub translation_count: usize,
}

struct SeedEntry {
    namespace: &'static str,
    key: &'static str,
    environment: &'static str,
    description: Option<&'static str>,
    en_value: &'static str,
    ru_value: Option<&'static str>,
}

const DEMO_PROJECT_NAME: &str = "Demo Storefront";
const DEMO_PROJECT_SLUG: &str = "demo-storefront";

const SEED_ENTRIES: &[SeedEntry] = &[
    SeedEntry {
        namespace: "common",
        key: "app.title",
        environment: "development",
        description: Some("Product/brand name shown in the header"),
        en_value: "Demo Storefront",
        ru_value: Some("Демо-магазин"),
    },
    SeedEntry {
        namespace: "common",
        key: "app.title",
        environment: "production",
        description: None,
        en_value: "Demo Storefront",
        ru_value: Some("Демо-магазин"),
    },
    SeedEntry {
        namespace: "common",
        key: "nav.home",
        environment: "development",
        description: None,
        en_value: "Home",
        ru_value: Some("Главная"),
    },
    SeedEntry {
        namespace: "common",
        key: "nav.cart",
        environment: "development",
        description: None,
        en_value: "Cart",
        ru_value: Some("Корзина"),
    },
    SeedEntry {
        namespace: "common",
        key: "button.checkout",
        environment: "development",
        description: Some("Primary call-to-action on the cart page"),
        en_value: "Checkout",
        ru_value: Some("Оформить заказ"),
    },
    SeedEntry {
        // Deliberately left without a Russian value so the "missing
        // translations" view has something to show out of the box.
        namespace: "common",
        key: "button.checkout",
        environment: "production",
        description: None,
        en_value: "Checkout",
        ru_value: None,
    },
    SeedEntry {
        namespace: "checkout",
        key: "checkout.title",
        environment: "development",
        description: None,
        en_value: "Review your order",
        ru_value: Some("Проверьте заказ"),
    },
    SeedEntry {
        namespace: "checkout",
        key: "checkout.empty_cart",
        environment: "development",
        description: Some("Shown when the cart has no items"),
        en_value: "Your cart is empty",
        ru_value: Some("Ваша корзина пуста"),
    },
    SeedEntry {
        namespace: "checkout",
        key: "checkout.total_label",
        environment: "development",
        description: None,
        en_value: "Total",
        ru_value: Some("Итого"),
    },
];

/// Create a demo project with sample languages, namespaces, and translations,
/// owned by an existing (already-bootstrapped) user. Intended for local
/// development and screenshots only; never run automatically.
pub async fn run_demo_seed(pool: &SqlitePool, owner_email: &str) -> AppResult<DemoSeedSummary> {
    let owner_email = util::validate_email(owner_email)?;
    let owner = users::find_row_by_email(pool, owner_email).await?;

    // `projects::create` already bootstraps the "en" language, "common"
    // namespace, and development/staging/production environments.
    let project = projects::create(
        pool,
        projects::CreateProjectInput {
            name: DEMO_PROJECT_NAME,
            slug: DEMO_PROJECT_SLUG,
            description: Some("Seeded demo project for local development and screenshots. Safe to delete."),
            owner_user_id: &owner.id,
        },
    )
    .await?;

    projects::create_language(pool, &project.id, "ru", "Russian").await?;
    projects::create_namespace(pool, &project.id, "checkout").await?;

    let mut translation_count = 0;
    for entry in SEED_ENTRIES {
        translations::create(
            pool,
            translations::CreateTranslationInput {
                project_id: &project.id,
                environment_slug: entry.environment,
                language_code: "en",
                namespace_name: entry.namespace,
                key: entry.key,
                value: entry.en_value,
                description: entry.description,
                user_id: &owner.id,
            },
        )
        .await?;
        translation_count += 1;

        if let Some(ru_value) = entry.ru_value {
            translations::create(
                pool,
                translations::CreateTranslationInput {
                    project_id: &project.id,
                    environment_slug: entry.environment,
                    language_code: "ru",
                    namespace_name: entry.namespace,
                    key: entry.key,
                    value: ru_value,
                    description: None,
                    user_id: &owner.id,
                },
            )
            .await?;
            translation_count += 1;
        }
    }

    Ok(DemoSeedSummary {
        project_name: project.name,
        project_slug: project.slug,
        language_codes: vec!["en".to_owned(), "ru".to_owned()],
        namespace_names: vec!["common".to_owned(), "checkout".to_owned()],
        translation_count,
    })
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::repository::users::{self, CreateUserInput};

    async fn seeded_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("pool");
        sqlx::migrate!("../migrations")
            .run(&pool)
            .await
            .expect("migrations");
        pool
    }

    #[tokio::test]
    async fn creates_demo_project_with_languages_namespaces_and_translations() {
        let pool = seeded_pool().await;
        users::create(
            &pool,
            CreateUserInput {
                email: "owner@example.com",
                password: "owner-password",
                display_name: "Owner",
                is_active: true,
            },
        )
        .await
        .expect("owner user");

        let summary = run_demo_seed(&pool, " OWNER@example.com ")
            .await
            .expect("demo seed");

        assert_eq!(summary.project_slug, "demo-storefront");
        assert_eq!(summary.language_codes, vec!["en", "ru"]);
        assert_eq!(summary.namespace_names, vec!["common", "checkout"]);
        assert!(summary.translation_count > 0);

        let project_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE slug = 'demo-storefront'")
            .fetch_one(&pool)
            .await
            .expect("project count");
        assert_eq!(project_count, 1);

        let language_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM languages l JOIN projects p ON p.id = l.project_id WHERE p.slug = 'demo-storefront'",
        )
        .fetch_one(&pool)
        .await
        .expect("language count");
        assert_eq!(language_count, 2);

        let translation_value_count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM translation_values tv
            JOIN translation_keys tk ON tk.id = tv.translation_key_id
            JOIN projects p ON p.id = tk.project_id
            WHERE p.slug = 'demo-storefront'
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("translation value count");
        assert_eq!(translation_value_count as usize, summary.translation_count);
    }

    #[tokio::test]
    async fn fails_when_owner_email_does_not_match_an_existing_user() {
        let pool = seeded_pool().await;

        let result = run_demo_seed(&pool, "missing@example.com").await;

        assert!(result.is_err());
    }
}
