use std::collections::BTreeMap;

use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{
    errors::{ApiError, AppResult},
    util::{now_utc, optional_trimmed},
};

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

#[derive(Debug, FromRow)]
pub struct TranslationRecord {
    pub id: String,
    pub translation_key_id: String,
    pub key: String,
    pub description: Option<String>,
    pub namespace: String,
    pub language_code: String,
    pub environment_slug: String,
    pub value: String,
    pub updated_by_user_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
struct IdNamePair {
    id: String,
    name: String,
}

pub struct ResolvedRefs {
    pub environment_id: String,
    pub language_id: String,
    pub namespace_id: String,
    pub namespace_name: String,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

pub struct CreateTranslationInput<'a> {
    pub project_id: &'a str,
    pub environment_slug: &'a str,
    pub language_code: &'a str,
    pub namespace_name: &'a str,
    pub key: &'a str,
    pub value: &'a str,
    pub description: Option<&'a str>,
    pub user_id: &'a str,
}

pub struct UpdateTranslationInput<'a> {
    pub value: Option<&'a str>,
    pub description: Option<Option<&'a str>>, // Some(None) = clear, None = no change
    pub user_id: &'a str,
}

pub struct ImportEntry<'a> {
    pub key: &'a str,
    pub value: &'a str,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

pub async fn list(
    pool: &SqlitePool,
    project_id: &str,
    environment_slug: &str,
    language_code: Option<&str>,
    namespace_name: Option<&str>,
) -> AppResult<Vec<TranslationRecord>> {
    sqlx::query_as::<_, TranslationRecord>(
        r#"
        SELECT
            tv.id,
            tk.id AS translation_key_id,
            tk.key,
            tk.description,
            n.name AS namespace,
            l.code AS language_code,
            e.slug AS environment_slug,
            tv.value,
            tv.updated_by_user_id,
            tv.created_at,
            tv.updated_at
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        WHERE tk.project_id = ?1
          AND e.slug = ?2
          AND (?3 IS NULL OR l.code = ?3)
          AND (?4 IS NULL OR n.name = ?4)
        ORDER BY n.name, tk.key, l.code
        "#,
    )
    .bind(project_id)
    .bind(environment_slug)
    .bind(language_code)
    .bind(namespace_name)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to list translations."))
}

pub async fn create(
    pool: &SqlitePool,
    input: CreateTranslationInput<'_>,
) -> AppResult<TranslationRecord> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to start translation creation."))?;

    let refs = resolve_refs(
        &mut tx,
        input.project_id,
        input.environment_slug,
        input.language_code,
        input.namespace_name,
    )
    .await?;

    let now = now_utc()?;
    let translation_key_id = find_or_create_key(
        &mut tx,
        input.project_id,
        &refs.namespace_id,
        input.key,
        input.description,
        &now,
    )
    .await?;

    let value_id = Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO translation_values (
            id, translation_key_id, language_id, environment_id,
            value, updated_by_user_id, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
    )
    .bind(&value_id)
    .bind(&translation_key_id)
    .bind(&refs.language_id)
    .bind(&refs.environment_id)
    .bind(input.value.trim())
    .bind(input.user_id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        ApiError::from_sqlx(
            e,
            "Translation already exists for this key, language, and environment.",
        )
    })?;

    let record = fetch_by_id_tx(&mut tx, input.project_id, &value_id).await?;

    tx.commit()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to commit translation creation."))?;

    Ok(record)
}

pub async fn update(
    pool: &SqlitePool,
    project_id: &str,
    translation_value_id: &str,
    input: UpdateTranslationInput<'_>,
) -> AppResult<TranslationRecord> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to start translation update."))?;

    let existing = fetch_by_id_tx(&mut tx, project_id, translation_value_id).await?;

    let now = now_utc()?;
    let next_value = input
        .value
        .unwrap_or(&existing.value)
        .trim()
        .to_owned();
    let next_description = match input.description {
        Some(d) => optional_trimmed(d).map(ToOwned::to_owned),
        None => existing.description.clone(),
    };

    sqlx::query(
        r#"
        UPDATE translation_values
        SET value = ?1, updated_by_user_id = ?2, updated_at = ?3
        WHERE id = ?4
        "#,
    )
    .bind(&next_value)
    .bind(input.user_id)
    .bind(&now)
    .bind(translation_value_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to update the translation value."))?;

    if input.description.is_some() {
        sqlx::query(
            r#"
            UPDATE translation_keys
            SET description = ?1, updated_at = ?2
            WHERE id = ?3
            "#,
        )
        .bind(next_description.as_deref())
        .bind(&now)
        .bind(&existing.translation_key_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to update the translation key."))?;
    }

    let record = fetch_by_id_tx(&mut tx, project_id, translation_value_id).await?;

    tx.commit()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to commit translation update."))?;

    Ok(record)
}

pub async fn delete(pool: &SqlitePool, translation_value_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM translation_values WHERE id = ?1")
        .bind(translation_value_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to delete the translation."))?;

    Ok(())
}

/// Import a batch of key/value pairs (upsert).
/// Returns the count of entries processed.
pub async fn import_batch(
    pool: &SqlitePool,
    project_id: &str,
    environment_slug: &str,
    language_code: &str,
    namespace_name: &str,
    entries: &[(String, String)],
    user_id: &str,
) -> AppResult<usize> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to start import transaction."))?;

    let refs = resolve_refs(&mut tx, project_id, environment_slug, language_code, namespace_name).await?;
    let now = now_utc()?;
    let mut imported = 0usize;

    for (key, value) in entries {
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() || value.is_empty() || key.contains('{') {
            continue;
        }
        if key.contains(':') || key.starts_with(&format!("{}.", refs.namespace_name)) {
            return Err(ApiError::validation(
                "Import keys must be local to the selected namespace and must not include a namespace prefix.",
            ));
        }

        let translation_key_id =
            find_or_create_key(&mut tx, project_id, &refs.namespace_id, key, None, &now)
                .await?;

        sqlx::query(
            r#"
            INSERT INTO translation_values (
                id, translation_key_id, language_id, environment_id,
                value, updated_by_user_id, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(translation_key_id, language_id, environment_id)
            DO UPDATE SET
                value = excluded.value,
                updated_by_user_id = excluded.updated_by_user_id,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&translation_key_id)
        .bind(&refs.language_id)
        .bind(&refs.environment_id)
        .bind(value)
        .bind(user_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to upsert imported translation."))?;

        imported += 1;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to commit translation import."))?;

    Ok(imported)
}

pub async fn export(
    pool: &SqlitePool,
    project_id: &str,
    environment_slug: &str,
    language_code: &str,
    namespace_name: &str,
) -> AppResult<BTreeMap<String, String>> {
    #[derive(FromRow)]
    struct Row {
        key: String,
        value: String,
    }

    let rows = sqlx::query_as::<_, Row>(
        r#"
        SELECT tk.key, tv.value
        FROM translation_values tv
        JOIN translation_keys tk ON tk.id = tv.translation_key_id
        JOIN languages l ON l.id = tv.language_id
        JOIN environments e ON e.id = tv.environment_id
        JOIN namespaces n ON n.id = tk.namespace_id
        WHERE tk.project_id = ?1
          AND e.slug = ?2
          AND l.code = ?3
          AND n.name = ?4
        ORDER BY tk.key
        "#,
    )
    .bind(project_id)
    .bind(environment_slug)
    .bind(language_code)
    .bind(namespace_name)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to export translations."))?;

    Ok(rows.into_iter().map(|r| (r.key, r.value)).collect())
}

/// Fetch a single translation by value id within a project. Used to verify
/// project membership and return the environment slug for permission checks.
pub async fn find_by_id(
    pool: &SqlitePool,
    project_id: &str,
    translation_value_id: &str,
) -> AppResult<TranslationRecord> {
    fetch_by_id_pool(pool, project_id, translation_value_id).await
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn fetch_by_id_pool(
    pool: &SqlitePool,
    project_id: &str,
    translation_value_id: &str,
) -> AppResult<TranslationRecord> {
    sqlx::query_as::<_, TranslationRecord>(FETCH_TRANSLATION_SQL)
        .bind(translation_value_id)
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to load the translation."))?
        .ok_or_else(|| ApiError::not_found("Translation was not found."))
}

async fn fetch_by_id_tx(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    translation_value_id: &str,
) -> AppResult<TranslationRecord> {
    sqlx::query_as::<_, TranslationRecord>(FETCH_TRANSLATION_SQL)
        .bind(translation_value_id)
        .bind(project_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| ApiError::from_sqlx(e, "Unable to load the translation."))?
        .ok_or_else(|| ApiError::not_found("Translation was not found."))
}

const FETCH_TRANSLATION_SQL: &str = r#"
    SELECT
        tv.id,
        tk.id AS translation_key_id,
        tk.key,
        tk.description,
        n.name AS namespace,
        l.code AS language_code,
        e.slug AS environment_slug,
        tv.value,
        tv.updated_by_user_id,
        tv.created_at,
        tv.updated_at
    FROM translation_values tv
    JOIN translation_keys tk ON tk.id = tv.translation_key_id
    JOIN namespaces n ON n.id = tk.namespace_id
    JOIN languages l ON l.id = tv.language_id
    JOIN environments e ON e.id = tv.environment_id
    WHERE tv.id = ?1
      AND tk.project_id = ?2
"#;

async fn resolve_refs(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    environment_slug: &str,
    language_code: &str,
    namespace_name: &str,
) -> AppResult<ResolvedRefs> {
    let environment = sqlx::query_as::<_, IdNamePair>(
        "SELECT id, slug AS name FROM environments WHERE project_id = ?1 AND slug = ?2",
    )
    .bind(project_id)
    .bind(environment_slug)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to resolve the environment."))?
    .ok_or_else(|| ApiError::not_found("Environment was not found."))?;

    let language = sqlx::query_as::<_, IdNamePair>(
        "SELECT id, code AS name FROM languages WHERE project_id = ?1 AND code = ?2",
    )
    .bind(project_id)
    .bind(language_code)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to resolve the language."))?
    .ok_or_else(|| ApiError::not_found("Language was not found."))?;

    let namespace = sqlx::query_as::<_, IdNamePair>(
        "SELECT id, name FROM namespaces WHERE project_id = ?1 AND name = ?2",
    )
    .bind(project_id)
    .bind(namespace_name)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to resolve the namespace."))?
    .ok_or_else(|| ApiError::not_found("Namespace was not found."))?;

    Ok(ResolvedRefs {
        environment_id: environment.id,
        language_id: language.id,
        namespace_id: namespace.id,
        namespace_name: namespace.name,
    })
}

async fn find_or_create_key(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    namespace_id: &str,
    key: &str,
    description: Option<&str>,
    now: &str,
) -> AppResult<String> {
    let existing = sqlx::query_scalar::<_, String>(
        r#"
        SELECT id
        FROM translation_keys
        WHERE project_id = ?1 AND namespace_id = ?2 AND key = ?3
        "#,
    )
    .bind(project_id)
    .bind(namespace_id)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Unable to resolve the translation key."))?;

    if let Some(id) = existing {
        if description.is_some() {
            sqlx::query(
                "UPDATE translation_keys SET description = ?1, updated_at = ?2 WHERE id = ?3",
            )
            .bind(description)
            .bind(now)
            .bind(&id)
            .execute(&mut **tx)
            .await
            .map_err(|e| ApiError::from_sqlx(e, "Unable to update the translation key."))?;
        }
        return Ok(id);
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO translation_keys
            (id, project_id, namespace_id, key, description, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&id)
    .bind(project_id)
    .bind(namespace_id)
    .bind(key)
    .bind(description)
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::from_sqlx(e, "Translation key already exists."))?;

    Ok(id)
}
