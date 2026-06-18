# OxideRelay Implementation Plan

## Planning Principles

- Build the backend first, because the frontend depends on stable API contracts.
- Keep the MVP aligned with `readme.md`, `architecture.md`, and `database.md`.
- Deliver the system in vertical slices where each slice is testable.
- Avoid adding non-MVP features such as roles, audit log, API keys, or publishing workflows.

## Phase 1: Project Bootstrap

### Task 1.1: Initialize repository structure
- Create backend workspace structure for Rust service.
- Create frontend workspace structure for React application.
- Define top-level directories for migrations, docs, scripts, and deployment assets.
- Add `.gitignore`, formatting config, and baseline development tooling files.

### Task 1.2: Configure backend foundation
- Initialize Rust application with Axum, Tokio, SQLx, Serde, Tracing, Argon2, and Utoipa.
- Add configuration loading from environment variables, `config.toml`, and CLI arguments.
- Define configuration models for host, port, database path, session settings, and bootstrap admin settings.
- Establish and document a configuration precedence rule consistent with the documented configuration sources.

### Task 1.3: Configure frontend foundation
- Initialize React + TypeScript + Vite application.
- Add React Router, TanStack Query, React Hook Form, MUI, and MUI DataGrid Community.
- Create base layout, routing shell, API client layer, and auth state handling.

### Task 1.4: Establish developer workflow
- Add commands for local run, build, lint, and test.
- Add Dockerfile and local development run instructions.
- Document startup flow for the backend and frontend.

## Phase 2: Database and Persistence

### Task 2.1: Create SQLx migrations
- Implement migrations for `users`, `permissions`, `user_permissions`, `projects`, `user_project_access`, `languages`, `environments`, `namespaces`, `translation_keys`, `translation_values`, and `sessions`.
- Add all required indexes and unique constraints from `database.md`.
- Ensure foreign keys and delete behavior match the specification exactly.

### Task 2.2: Implement database bootstrap
- Run migrations automatically on startup.
- Seed the immutable permission catalog on first startup.
- Create the initial administrator when no users exist.
- Require `OXIDERELAY_ADMIN_EMAIL` and `OXIDERELAY_ADMIN_PASSWORD` only in the bootstrap case.

### Task 2.3: Implement repository layer
- Create repositories for users, permissions, sessions, projects, memberships, languages, environments, namespaces, translation keys, and translation values.
- Keep SQL isolated in repository modules or query files.
- Normalize database error handling into domain-friendly error types.

### Task 2.4: Implement transactional project creation
- Create a single transaction that inserts the project.
- Assign `owner_user_id`.
- Insert owner membership into `user_project_access`.
- Create default environments: `development`, `staging`, `production`.
- Create default namespace: `common`.

## Phase 3: Authentication and Authorization

### Task 3.1: Implement authentication flow
- Create login endpoint using email and password.
- Verify passwords with Argon2.
- Create server-side sessions stored in the `sessions` table.
- Issue HTTP-only session cookies.
- Implement logout and current-user endpoints.

### Task 3.2: Implement session middleware
- Resolve session from cookie.
- Load current user and reject inactive users.
- Attach authenticated user context to request extensions.

### Task 3.3: Implement authorization engine
- Support direct permission checks using seeded permission codes.
- Support project access checks through `user_project_access`.
- Support implicit project owner privileges inside owned projects.
- Support environment-specific permission checks such as `ReadProduction` and `EditStaging`.
- Enforce authorization order defined in `architecture.md`.

### Task 3.4: Implement reusable authorization guards
- Build route guards for authenticated-only access.
- Build project-scoped permission guards.
- Build translation environment guards.
- Reuse guards consistently across admin API endpoints.

## Phase 4: Admin API Core Resources

### Task 4.1: Implement project endpoints
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{project_slug}`
- `PUT /api/v1/projects/{project_slug}`
- `DELETE /api/v1/projects/{project_slug}`
- Ensure list endpoint returns only owned and assigned projects.

### Task 4.2: Implement language endpoints
- `GET /api/v1/projects/{project_slug}/languages`
- `POST /api/v1/projects/{project_slug}/languages`
- `DELETE /api/v1/projects/{project_slug}/languages/{language_code}`
- Enforce uniqueness per project and add input validation consistent with the MVP data model.

### Task 4.3: Implement namespace endpoints
- `GET /api/v1/projects/{project_slug}/namespaces`
- `POST /api/v1/projects/{project_slug}/namespaces`
- `DELETE /api/v1/projects/{project_slug}/namespaces/{namespace}`
- Protect against duplicate namespace names per project.

### Task 4.4: Implement environment endpoints
- `GET /api/v1/projects/{project_slug}/environments`
- `POST /api/v1/projects/{project_slug}/environments`
- `DELETE /api/v1/projects/{project_slug}/environments/{environment_slug}`
- Enforce unique environment slug per project.

## Phase 5: Translation Management

### Task 5.1: Design translation request models
- Define request models so route parameters, query parameters, and request bodies align with the documented API shape.
- Keep translation keys local to the namespace and never store namespace-prefixed keys.
- Validate input for empty values, invalid identifiers, and duplicates.

### Task 5.2: Implement translation CRUD endpoints
- `GET /api/v1/projects/{project_slug}/translations`
- `POST /api/v1/projects/{project_slug}/translations`
- `PUT /api/v1/projects/{project_slug}/translations/{translation_value_id}`
- `DELETE /api/v1/projects/{project_slug}/translations/{translation_value_id}`
- Keep writes value-oriented around `translation_values.id`.

### Task 5.3: Implement translation query logic
- Resolve the requested environment explicitly from query or payload.
- Join translation values with translation keys, namespaces, languages, and environments.
- Return stable response models for the admin UI.
- Preserve database uniqueness across `(translation_key_id, language_id, environment_id)`.

### Task 5.4: Implement import and export
- `POST /api/v1/projects/{project_slug}/imports/json`
- `GET /api/v1/projects/{project_slug}/exports/json`
- Import local namespace keys only.
- Create missing `translation_keys` during import.
- Upsert `translation_values` and update `updated_by_user_id` and `updated_at`.

## Phase 6: Users, Permissions, and Project Membership

### Task 6.1: Implement user management endpoints
- `GET /api/v1/users`
- `POST /api/v1/users`
- `PUT /api/v1/users/{id}`
- `DELETE /api/v1/users/{id}`
- Support active/inactive state management.

### Task 6.2: Implement permission management endpoints
- `GET /api/v1/permissions`
- `GET /api/v1/users/{id}/permissions`
- `PUT /api/v1/users/{id}/permissions`
- Restrict the system to the seeded immutable permission catalog.

### Task 6.3: Implement project membership endpoints
- `GET /api/v1/projects/{project_slug}/members`
- `POST /api/v1/projects/{project_slug}/members`
- `DELETE /api/v1/projects/{project_slug}/members/{user_id}`
- Manage only `user_project_access`.
- Do not introduce any environment membership API.

## Phase 7: Public Translation Delivery

### Task 7.1: Implement REST delivery endpoint
- `GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}`
- Make the endpoint public in MVP.
- Return translations from all namespaces as a flat object.
- Compose response keys as `{namespace}.{key}`.

### Task 7.2: Implement static JSON endpoint
- `GET /static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json`
- Make the endpoint public in MVP.
- Return one namespace per file.
- Return keys without namespace prefix.
- Apply `Cache-Control: public, max-age=300`.

### Task 7.3: Optimize delivery queries
- Add efficient lookup queries using the planned indexes.
- Ensure responses are deterministic and sorted consistently.
- Keep serialization lightweight for frontend and backend consumers.

## Phase 8: API Quality, Validation, and Documentation

### Task 8.1: Standardize error responses
- Implement the shared API error format.
- Map validation, authentication, authorization, not-found, and conflict cases to stable responses.
- Keep error payloads consistent across admin and delivery endpoints where appropriate.

### Task 8.2: Add input validation
- Validate email format, required fields, and identifier fields used by the API.
- Reject namespace-prefixed keys where local keys are required.
- Validate environment query parameters on translation endpoints.

### Task 8.3: Generate OpenAPI documentation
- Document all admin endpoints and public delivery endpoints.
- Include request and response schemas.
- Expose API docs from the backend service.

## Phase 9: Frontend Admin UI

### Task 9.1: Implement authentication screens
- Build login form and session restore flow.
- Redirect unauthenticated users to login.
- Handle logout and session expiry cleanly.

### Task 9.2: Implement project navigation
- Build project list view showing owned and assigned projects.
- Add project details page with sub-navigation for languages, namespaces, environments, members, and translations.

### Task 9.3: Implement translation management UI
- Build translation table with filters for environment, language, and namespace.
- Add create, edit, and delete flows for translation values.
- Display namespace-local keys clearly to avoid confusion with delivered flat keys.

### Task 9.4: Implement supporting admin screens
- Users management screen.
- Direct permissions management screen.
- Project membership management screen.
- Language, namespace, and environment management screens.
- Import and export actions for JSON files.

### Task 9.5: Integrate frontend permissions behavior
- Hide or disable actions the current user cannot perform.
- Keep backend authorization as the source of truth.
- Show clear errors when requests are forbidden.

## Phase 10: Testing and Hardening

### Task 10.1: Add backend unit tests
- Test permission resolution logic.
- Test owner implicit access behavior.
- Test slug and key validation.
- Test import and export behavior.

### Task 10.2: Add backend integration tests
- Test auth flows end to end.
- Test protected admin routes.
- Test project creation transaction behavior.
- Test public delivery endpoints.

### Task 10.3: Add frontend tests
- Test auth flow, route protection, and key UI states.
- Test translation management interactions.
- Test permission-based UI gating.

### Task 10.4: Add smoke checks
- Verify application startup with empty database bootstrap.
- Verify startup with existing users and without bootstrap admin variables.
- Verify Dockerized run path and persisted SQLite file behavior.

## Phase 11: Deployment and Operations

### Task 11.1: Finalize runtime configuration
- Support host, port, and database path configuration.
- Define session cookie settings for local and deployed environments.
- Document required and optional settings.

### Task 11.2: Finalize container packaging
- Build production Docker image.
- Ensure writable data path for SQLite storage.
- Expose the correct port and startup command.

### Task 11.3: Prepare operational documentation
- Document bootstrap procedure.
- Document backup and restore strategy for SQLite.
- Document migration behavior and upgrade expectations.

## Recommended Execution Order

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 before exposing any admin routes.
3. Complete Phase 4, Phase 5, and Phase 6 as the backend MVP core.
4. Complete Phase 7 and Phase 8 to stabilize public API behavior.
5. Complete Phase 9 once backend contracts stop changing.
6. Complete Phase 10 and Phase 11 before calling the MVP ready.

## MVP Exit Criteria

- A new instance can bootstrap itself with SQLite migrations and an initial administrator.
- Authenticated users can manage projects, members, languages, namespaces, environments, and translations according to the permission model.
- Project owners can fully manage their own projects without global admin permissions.
- Public delivery endpoints serve correct translation payloads for backend and frontend consumers.
- JSON import and export work with namespace-local keys.
- The admin UI covers all MVP management flows.
- Docker deployment works with persistent SQLite storage.
