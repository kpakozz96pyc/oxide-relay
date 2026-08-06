use sqlx::SqlitePool;

use crate::{
    errors::{ApiError, AppResult},
    repository::{password_resets, users},
    util,
};

pub async fn generate_password_reset_link(
    pool: &SqlitePool,
    email: &str,
) -> AppResult<password_resets::GeneratedPasswordResetLink> {
    let email = util::validate_email(email)?.to_lowercase();
    let user = users::find_row_by_email(pool, &email).await?;

    if !user.is_active {
        return Err(ApiError::validation(
            "Password reset links can only be generated for active users.",
        ));
    }

    // Offline recovery has no authenticated actor, so the target user records the operation.
    password_resets::generate_reset_link(pool, &user.id, &user.id).await
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::repository::users::{self, CreateUserInput};

    #[tokio::test]
    async fn generates_one_active_reset_link_for_email() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("pool");
        sqlx::migrate!("../migrations")
            .run(&pool)
            .await
            .expect("migrations");
        let user = users::create(
            &pool,
            CreateUserInput {
                email: "admin@example.com",
                password: "old-password",
                display_name: "Admin",
                is_active: true,
            },
        )
        .await
        .expect("user");

        let first = generate_password_reset_link(&pool, " ADMIN@example.com ")
            .await
            .expect("first reset link");
        let second = generate_password_reset_link(&pool, "admin@example.com")
            .await
            .expect("second reset link");

        assert!(first.reset_url.starts_with("/reset-password?token="));
        assert!(second.reset_url.starts_with("/reset-password?token="));
        assert_ne!(first.reset_url, second.reset_url);

        let active_token_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ?1 AND used_at IS NULL",
        )
        .bind(&user.id)
        .fetch_one(&pool)
        .await
        .expect("active token count");
        assert_eq!(active_token_count, 1);

        let raw_token = second
            .reset_url
            .strip_prefix("/reset-password?token=")
            .expect("token");
        let stored_hash: String =
            sqlx::query_scalar("SELECT token_hash FROM password_reset_tokens WHERE user_id = ?1")
                .bind(&user.id)
                .fetch_one(&pool)
                .await
                .expect("stored token hash");
        assert_eq!(stored_hash, util::sha256_hex(raw_token));
        assert_ne!(stored_hash, raw_token);
    }
}
