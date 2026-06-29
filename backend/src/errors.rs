use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use tracing::error;
use utoipa::ToSchema;

pub type AppResult<T> = Result<T, ApiError>;

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "ValidationError", message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "Unauthorized", message)
    }

    pub fn permission_denied(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "PermissionDenied", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "NotFound", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "Conflict", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "InternalError", message)
    }

    pub fn from_sqlx(error: sqlx::Error, conflict_message: &'static str) -> Self {
        match error {
            sqlx::Error::Database(database_error) if database_error.is_unique_violation() => {
                Self::conflict(conflict_message)
            }
            sqlx::Error::RowNotFound => Self::not_found("Requested resource was not found."),
            other => {
                error!(error = %other, "Unhandled database error");
                Self::internal("Internal server error.")
            }
        }
    }

    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorResponse {
                error: ErrorPayload {
                    code: self.code.to_owned(),
                    message: self.message,
                },
            }),
        )
            .into_response()
    }
}

#[derive(Serialize, ToSchema)]
pub struct ErrorResponse {
    pub error: ErrorPayload,
}

#[derive(Serialize, ToSchema)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_sqlx_sanitizes_internal_errors() {
        let error = ApiError::from_sqlx(sqlx::Error::Protocol("boom".to_owned()), "conflict");

        assert_eq!(error.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(error.code, "InternalError");
        assert_eq!(error.message, "Internal server error.");
    }
}
