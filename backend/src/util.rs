use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString},
};
use rand_core::OsRng;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::errors::{ApiError, AppResult};

pub const MAX_EMAIL_LEN: usize = 320;
pub const MAX_DISPLAY_NAME_LEN: usize = 100;
pub const MIN_PASSWORD_LEN: usize = 8;
pub const MAX_PASSWORD_LEN: usize = 256;

/// Returns the current UTC time formatted as RFC 3339.
pub fn now_utc() -> AppResult<String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ApiError::internal(format!("Unable to format current time: {error}")))
}

/// Hashes a plaintext password using Argon2.
pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| ApiError::internal(format!("Unable to hash password: {error}")))
        .map(|hash| hash.to_string())
}

/// Returns the trimmed value if it is non-empty, or `None`.
pub fn optional_trimmed(value: Option<&str>) -> Option<&str> {
    value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    })
}

/// Validates that `value` is non-empty after trimming, returning the trimmed
/// slice on success or a `ValidationError` with `message` on failure.
pub fn required_non_empty<'a>(value: &'a str, message: &'static str) -> AppResult<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::validation(message));
    }
    Ok(trimmed)
}

/// Validates that a trimmed string does not exceed `max_len` characters.
pub fn validate_max_length(value: &str, max_len: usize, field_name: &str) -> AppResult<()> {
    if value.trim().len() > max_len {
        return Err(ApiError::validation(format!(
            "{field_name} must be at most {max_len} characters."
        )));
    }
    Ok(())
}

pub fn validate_email(value: &str) -> AppResult<&str> {
    let trimmed = required_non_empty(value, "Email is required.")?;

    if trimmed.len() > MAX_EMAIL_LEN {
        return Err(ApiError::validation(format!(
            "Email must be at most {MAX_EMAIL_LEN} characters."
        )));
    }

    if trimmed.contains(char::is_whitespace) {
        return Err(ApiError::validation("Email must not contain whitespace."));
    }

    let mut parts = trimmed.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();

    if local.is_empty() || domain.is_empty() || parts.next().is_some() {
        return Err(ApiError::validation("Email format is invalid."));
    }

    if domain.starts_with('.') || domain.ends_with('.') || !domain.contains('.') {
        return Err(ApiError::validation("Email format is invalid."));
    }

    if domain.split('.').any(|label| label.is_empty()) {
        return Err(ApiError::validation("Email format is invalid."));
    }

    Ok(trimmed)
}

pub fn validate_display_name(value: &str) -> AppResult<&str> {
    let trimmed = required_non_empty(value, "Display name is required.")?;
    validate_max_length(trimmed, MAX_DISPLAY_NAME_LEN, "Display name")?;
    Ok(trimmed)
}

pub fn validate_password(value: &str) -> AppResult<&str> {
    let trimmed = required_non_empty(value, "Password is required.")?;

    if trimmed.len() < MIN_PASSWORD_LEN {
        return Err(ApiError::validation(format!(
            "Password must be at least {MIN_PASSWORD_LEN} characters."
        )));
    }

    if trimmed.len() > MAX_PASSWORD_LEN {
        return Err(ApiError::validation(format!(
            "Password must be at most {MAX_PASSWORD_LEN} characters."
        )));
    }

    Ok(trimmed)
}
