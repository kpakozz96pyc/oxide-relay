CREATE TABLE login_attempts (
    identifier_hash TEXT PRIMARY KEY,
    failed_attempts INTEGER NOT NULL,
    window_started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_login_attempts_window_started_at
ON login_attempts(window_started_at);
