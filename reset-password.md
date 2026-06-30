# Reset Password Plan

## Goal

Add an admin-driven password reset link flow without email delivery.

Current requested behavior:

- A user with admin rights can generate a reset link for any user.
- The generated link is shown exactly once in the web interface.
- The link remains valid for 15 minutes.
- No email or SMTP integration is involved.

## Scope

This plan covers the full flow needed to make the generated link useful:

1. Admin generates a one-time reset link for a chosen user.
2. The admin UI shows the link only in the mutation response state.
3. The link opens a public reset-password page.
4. The target user sets a new password through that page.
5. The token becomes unusable after success or expiry.
6. Existing sessions for that user are invalidated after password reset.

## Design Decisions

### Permission Model

Use existing `ManageUsers` permission for reset-link generation.

Reasoning:

- The same permission already allows creating, updating, deactivating, and deleting users.
- Generating a password reset link is operationally equivalent to privileged user management.
- This avoids expanding the permission catalog for the first iteration.

If stricter separation is needed later, this can be split into a dedicated permission such as `ResetUserPasswords`.

### Token Storage

Add a new table:

- `password_reset_tokens`

Suggested columns:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `token_hash TEXT NOT NULL UNIQUE`
- `expires_at TEXT NOT NULL`
- `used_at TEXT NULL`
- `created_at TEXT NOT NULL`
- `created_by_user_id TEXT NOT NULL`

Notes:

- Store only a hash of the raw token, not the raw token itself.
- The raw token should exist only in memory while building the response.
- `created_by_user_id` gives basic auditability without building a full audit-log system.

### Token Lifetime

- TTL: 15 minutes exactly.

Implementation rule:

- `expires_at = now + 15 minutes`

### One-Time Visibility in Admin UI

The backend returns the full reset URL only in the successful generation response.

The frontend:

- stores it only in component state
- renders it once in a dedicated success panel
- clears it when another user is selected, when a new link is generated, or on page reload/navigation

This satisfies "shown once in the web interface" without pretending the backend can enforce whether a human copied it.

### One Active Token Per User

When a new reset link is generated for a user:

- delete or invalidate any existing unused tokens for that user first

Reasoning:

- simpler operational model
- avoids confusion about which link is current
- tighter security

### Session Invalidation

After a successful password reset:

- delete all existing sessions for that user from `sessions`

Reasoning:

- prevents old authenticated sessions from surviving a credential reset

## Backend Changes

### 1. Database Migration

Add a new migration file, for example:

- `migrations/0002_password_reset_tokens.sql`

Schema responsibilities:

- create `password_reset_tokens`
- add foreign keys to `users(id)` and `users(id)` for `created_by_user_id`
- add indexes for lookup and cleanup

Recommended indexes:

- `idx_password_reset_tokens_user_id`
- `idx_password_reset_tokens_expires_at`

### 2. Repository Layer

Add a new repository module:

- `backend/src/repository/password_resets.rs`

Functions to add:

- `create_reset_token(...)`
- `invalidate_active_tokens_for_user(...)`
- `find_active_token_by_hash(...)`
- `mark_token_used(...)`
- `purge_expired_tokens(...)`
- `delete_sessions_for_user(...)` or reuse a helper from the sessions repository

Expected responsibilities:

- hash raw token before insert
- fetch only active, unused, unexpired tokens
- keep DB writes transactional for reset completion

### 3. Token Utilities

Extend `backend/src/util.rs` with helpers for:

- generating a random reset token
- hashing the token for storage

Suggested approach:

- random 32-byte token
- encode with URL-safe base64 or hex
- hash with SHA-256 for DB storage

Important:

- do not reuse Argon2 password hashing for lookup tokens
- token lookup needs deterministic hashing

### 4. Admin API: Generate Link

Add a new authenticated admin endpoint:

- `POST /api/v1/users/{id}/password-reset-link`

Behavior:

- require authenticated user
- require `ManageUsers`
- validate target user exists and is active
- invalidate any prior active reset tokens for that user
- create a new token with 15-minute TTL
- return a payload containing the absolute or relative reset URL and expiration timestamp

Suggested response:

```json
{
  "reset_url": "/reset-password?token=...",
  "expires_at": "2026-06-30T12:34:56Z"
}
```

Validation rule:

- inactive users should be rejected with a validation or conflict error

### 5. Public API: Consume Link

Add a new public endpoint:

- `POST /api/v1/auth/reset-password`

Request body:

```json
{
  "token": "...",
  "password": "new-password"
}
```

Behavior:

- validate new password with existing password policy
- hash incoming token
- resolve active token by hash
- reject expired or already used tokens
- update `users.password_hash`
- mark token used
- delete all sessions for that user

Response:

- `204 No Content`

Error behavior:

- invalid, expired, or used token should return the same generic validation-style error

### 6. Router and OpenAPI

Update:

- `backend/src/http/mod.rs`
- `backend/src/http/docs.rs`

Needed changes:

- register the new admin endpoint
- register the new public reset endpoint
- expose request/response schemas in OpenAPI

## Frontend Changes

### 1. Users Page: Generate Link Panel

Extend:

- `frontend/src/pages/UsersPage.tsx`

Add:

- a button on the selected user card or in the update panel
- a mutation calling `POST /api/v1/users/{id}/password-reset-link`
- a success panel that shows:
  - generated link
  - expiry timestamp
  - copy button
  - clear button

One-time visibility behavior:

- keep the generated link only in local component state
- clear it on selected-user change
- clear it when mutation is retried
- never fetch it again from backend

### 2. Public Reset Page

Add a new page:

- `frontend/src/pages/ResetPasswordPage.tsx`

Route:

- `/reset-password`

Behavior:

- read `token` from query string
- render password and confirm-password fields
- submit to `POST /api/v1/auth/reset-password`
- on success redirect to `/login` with a success message or render inline success state

### 3. App Routing

Update:

- `frontend/src/App.tsx`

Add a public route:

- `Route path="/reset-password" element={<ResetPasswordPage />} />`

This route must stay outside `RequireAuth`.

### 4. Frontend API Types

Update:

- `frontend/src/api.ts`

Add types for:

- generate reset-link response
- reset-password request

## UX Notes

### Admin UX

Recommended behavior on `UsersPage`:

- the button label should make the privilege explicit, for example `Generate reset link`
- the success panel should warn that the link is shown only once and expires in 15 minutes
- the UI should encourage immediate copy/open

### User UX

Reset page should:

- not require authentication
- clearly show expiry/failure states
- give a simple retry path back to admin if token is invalid or expired

## Security Notes

1. Store only token hashes in the database.
2. Expire links after 15 minutes.
3. Make tokens one-time use.
4. Invalidate previous active tokens for the same user.
5. Invalidate all user sessions after successful reset.
6. Return generic errors for invalid/expired/used tokens.
7. Log reset-link creation and successful reset without logging raw tokens.

## Testing Plan

### Backend Tests

Extend `backend/tests/api.rs` to cover:

1. admin with `ManageUsers` can generate reset link for an active user
2. generation response includes `reset_url` and `expires_at`
3. generating a second link invalidates the first one
4. inactive target user cannot get a reset link
5. valid token resets password successfully
6. used token cannot be reused
7. expired token is rejected
8. old password stops working after reset
9. new password works after reset
10. prior sessions are invalidated after reset

### Frontend Tests

Extend frontend tests to cover:

1. admin users page renders the generate-link action
2. success panel shows returned link once
3. success panel clears when selected user changes
4. reset page submits a valid token and shows success
5. invalid token response shows error state

## Implementation Order

1. Add migration for `password_reset_tokens`
2. Add repository helpers for token lifecycle
3. Add token utility helpers
4. Add admin generate-link endpoint
5. Add public reset-password endpoint
6. Add backend integration tests
7. Add frontend API types
8. Add users-page generate-link UI
9. Add public reset-password page and route
10. Add frontend tests
11. Update README and architecture docs

## Out of Scope

For this iteration, do not add:

- SMTP or any email delivery
- self-service forgot-password request by email
- audit-log subsystem
- dedicated password-reset permission
- rate limiting
- CSRF hardening beyond the current app model
- multi-step admin approval flow

## Open Questions

1. Should reset links be allowed for inactive users?
   Recommendation: no.

2. Should the response return an absolute URL or relative path?
   Recommendation: relative path from backend, frontend can render it against current origin.

3. Should admins be able to generate a reset link for themselves?
   Recommendation: yes, if they have `ManageUsers`, to keep behavior simple and symmetric.
