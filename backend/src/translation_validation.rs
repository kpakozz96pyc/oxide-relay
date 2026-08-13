use crate::{
    errors::{ApiError, AppResult},
    util::{optional_trimmed, required_non_empty},
};

pub const MAX_TRANSLATION_KEY_LEN: usize = 500;
pub const MAX_TRANSLATION_VALUE_LEN: usize = 10_000;
pub const MAX_TRANSLATION_DESCRIPTION_LEN: usize = 2_000;
pub const MAX_TRANSLATION_IMPORT_ENTRIES: usize = 5_000;

pub fn validate_translation_key<'a>(value: &'a str, namespace: &str) -> AppResult<&'a str> {
    let key = required_non_empty(value, "Translation key cannot be empty.")?;

    if key.chars().count() > MAX_TRANSLATION_KEY_LEN {
        return Err(ApiError::validation(format!(
            "Translation key {key:?} must be at most {MAX_TRANSLATION_KEY_LEN} characters."
        )));
    }

    if key
        .chars()
        .any(|character| character.is_control() || matches!(character, ':' | '{' | '}'))
    {
        return Err(ApiError::validation(format!(
            "Translation key {key:?} contains unsupported characters. Colons, braces, and control characters are not allowed."
        )));
    }

    let namespace = namespace.trim();
    if !namespace.is_empty() && key.starts_with(&format!("{namespace}.")) {
        return Err(ApiError::validation(format!(
            "Translation key {key:?} must be local to namespace {namespace:?} and must not include the namespace prefix."
        )));
    }

    Ok(key)
}

pub fn validate_translation_value<'a>(value: &'a str, key: Option<&str>) -> AppResult<&'a str> {
    let field = key
        .map(|key| format!("Translation value for key {key:?}"))
        .unwrap_or_else(|| "Translation value".to_owned());
    let value = value.trim();
    if value.is_empty() {
        return Err(ApiError::validation(format!("{field} cannot be empty.")));
    }

    if value.chars().count() > MAX_TRANSLATION_VALUE_LEN {
        return Err(ApiError::validation(format!(
            "{field} must be at most {MAX_TRANSLATION_VALUE_LEN} characters."
        )));
    }

    Ok(value)
}

pub fn validate_translation_description(value: Option<&str>) -> AppResult<Option<&str>> {
    let description = optional_trimmed(value);
    if let Some(description) = description
        && description.chars().count() > MAX_TRANSLATION_DESCRIPTION_LEN
    {
        return Err(ApiError::validation(format!(
            "Description must be at most {MAX_TRANSLATION_DESCRIPTION_LEN} characters."
        )));
    }

    Ok(description)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_validation_accepts_local_unicode_keys_and_rejects_unsupported_formats() {
        assert_eq!(
            validate_translation_key("  checkout.кнопка-save_1  ", "common").expect("valid key"),
            "checkout.кнопка-save_1"
        );

        for invalid in [
            "common.button.save",
            "button:save",
            "button{save}",
            "button\nsave",
        ] {
            assert!(
                validate_translation_key(invalid, "common").is_err(),
                "{invalid:?}"
            );
        }
    }

    #[test]
    fn translation_limits_count_unicode_characters_and_normalize_description() {
        assert!(validate_translation_key(&"я".repeat(MAX_TRANSLATION_KEY_LEN), "common").is_ok());
        assert!(
            validate_translation_key(&"я".repeat(MAX_TRANSLATION_KEY_LEN + 1), "common").is_err()
        );
        assert!(
            validate_translation_value(&"я".repeat(MAX_TRANSLATION_VALUE_LEN + 1), None).is_err()
        );
        assert_eq!(
            validate_translation_description(Some("   ")).expect("empty description"),
            None
        );
    }
}
