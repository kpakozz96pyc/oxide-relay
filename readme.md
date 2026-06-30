# OxideRelay

**OxideRelay** is a self-hosted localization infrastructure service for centralized storage, management, and delivery of translations across applications.

The project is designed for teams that do not want to store translations inside each individual service, web application, or mobile client.

OxideRelay acts as a single source of truth for localization data used by frontend, backend, and mobile applications.

---

# Features

* Centralized translation storage
* Multiple projects support
* Multiple language support
* Namespace support
* Web UI for translation management
* REST API for backend applications
* Static JSON delivery for frontend applications
* Translation import and export
* User management
* Direct permission system
* Project-level access control
* Environment-level permission control
* Embedded SQLite database
* Self-hosted deployment
* Docker support

---

# Why OxideRelay?

A typical localization setup looks like this:

```text
frontend
 └── locales/en.json
 └── locales/ru.json

backend
 └── resources/en.json
 └── resources/ru.json

mobile
 └── strings.xml
 └── Localizable.strings
```

Over time translations become duplicated across multiple applications and environments.

OxideRelay provides a centralized approach:

```text
                OxideRelay
                     │
      ┌──────────────┼──────────────┐
      │              │              │
Frontend         Backend        Mobile
```

Every application receives translations from a single source.

---

# Core Concepts

## Project

A logical group of translations.

Examples:

```text
HR Portal
Mobile App
Landing Site
Admin Panel
```

When a new project is created, OxideRelay bootstraps the initial structure automatically:

* Default namespace: `common`
* Default environments: `development`, `staging`, `production`
* Default language: `en` (`English`)

---

## Language

A supported locale.

Examples:

```text
en
ru
sr
de
```

---

## Namespace

A logical grouping of translation keys within a project.

Examples:

```text
common
validation
checkout
profile
```

Translation keys inside a namespace store only the local key part.

Examples:

```text
namespace: common
key: button.save

namespace: validation
key: required
```

---

## Environment

An isolated translation scope.

Examples:

```text
Development
Staging
Production
```

---

# Users and Permissions

OxideRelay uses a permission-based access model.

---

## User

A user can have:

* Direct permissions
* Access to specific projects

In MVP, environment access is enforced through environment-specific permissions such as `ReadProduction` and `EditStaging`.

There is no separate environment membership table in MVP.

---

## Permissions

### User Management

```text
ManageUsers
ManagePermissions
```

`ManagePermissions` in MVP allows assigning and removing direct user permissions.

It does not allow creating new permission codes at runtime.

### Password Recovery

Current password recovery flow is administrator-driven.

Rules:

```text
A user with ManageUsers can generate a password reset link for any active user.
The reset link is shown once in the admin UI.
The link is valid for 15 minutes.
Email delivery is not used in the current implementation.
After a successful password reset, all existing sessions for that user are invalidated.
```

Reset links are intended for operational recovery in self-hosted setups where SMTP is not configured yet.

### Projects

```text
CreateProjects
EditProjects
DeleteProjects
ViewProjects
ManageProjectMembers
```

### Translations

```text
ReadTranslations
EditTranslations
DeleteTranslations

ImportTranslations
ExportTranslations
```

### Environments

```text
ReadDevelopment
ReadStaging
ReadProduction

EditDevelopment
EditStaging
EditProduction
```

### Publishing (Future)

```text
PublishTranslations
RollbackTranslations
```

---

# Project Access

Users can only see projects explicitly assigned to them.

Example:

```text
John

Projects:
- HR Portal
- Mobile App
```

Project access is stored separately from permissions.

Project owner is automatically added to project access and can perform any action within that project.

In MVP, project access for the owner is stored in `user_project_access`.

Project-scoped and environment-scoped permissions for the owner remain implicit and do not require assigning those permissions globally.

John cannot access any other project in the system.

---

# Project Owner

The creator of a project automatically becomes its owner.

A project owner can:

* Manage project members
* Grant project access
* Manage project translations

Without requiring global administrator privileges.

In MVP, this is implemented as a built-in authorization rule: inside the owned project, the owner is treated as having all project-scoped and environment-scoped permissions.

For non-owners, project membership management requires `ManageProjectMembers` within a project the user can access.

---

# REST API

Translation delivery for backend applications.

In MVP, translation delivery endpoints are public and do not use session authentication.

---

# Runtime Configuration

Configuration precedence is:

```text
CLI arguments
→ environment variables
→ config.toml
→ built-in defaults
```

Supported runtime settings:

```text
OXIDERELAY_HOST
OXIDERELAY_PORT
OXIDERELAY_DATABASE_PATH
OXIDERELAY_FRONTEND_DIST_PATH
OXIDERELAY_SESSION_COOKIE_NAME
OXIDERELAY_SESSION_TTL_HOURS
OXIDERELAY_SESSION_COOKIE_SECURE
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

Session defaults:

```text
cookie_name = oxiderelay_session
ttl_hours = 168
cookie_secure = false
```

For local development, keep `cookie_secure=false`.

For HTTPS deployments, set `OXIDERELAY_SESSION_COOKIE_SECURE=true`.

---

# Local Startup

Quick local development:

```bash
cargo run -p oxiderelay-backend -- --config backend/config.toml.example
```

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/static` to the backend on `127.0.0.1:8080`.
For all supported launch modes, including production-style local startup, native binary,
Docker Compose, and Docker from source, see the `Run Modes` section below.

## Run Modes

OxideRelay supports several launch modes depending on whether you are developing,
testing a production-like setup, or installing the service for regular use.

### 1. Development Mode

Run the backend and frontend separately:

```bash
cargo run -p oxiderelay-backend -- --config backend/config.toml.example
```

```bash
cd frontend
npm install
npm run dev
```

Use this mode when changing frontend or backend code. The Vite development server
proxies `/api` and `/static` to the backend.

### 2. Production-Style Local Mode

Build the frontend first, then let the backend serve both the UI and API:

```bash
cd frontend
npm install
npm run build
cd ..

cargo run -p oxiderelay-backend -- --config backend/config.toml.example
```

Use this mode to validate behavior close to production without Docker.

### 3. Native Binary Mode

Build and run the release binary directly:

```bash
cd frontend && npm run build && cd ..
cargo build --release -p oxiderelay-backend
./target/release/oxiderelay-backend
```

By default, the backend looks for the frontend bundle in `./frontend/dist`.
Override this path with `OXIDERELAY_FRONTEND_DIST_PATH` if needed.

### 4. Docker Compose Mode

Use the published container image with the provided Compose configuration:

```bash
cp .env.example .env
docker compose up -d
```

Use this mode for the simplest installation path. Configuration comes from `.env`,
and SQLite data is stored in the `oxiderelay-data` volume.
If port `8080` is already busy on the host, change `OXIDERELAY_PUBLISHED_PORT`
in `.env` without changing the in-container application port.

### 5. Docker From Source Mode

Build a local image from the current repository checkout:

```bash
docker build -f deploy/Dockerfile -t oxiderelay:latest .
docker run -d \
  --name oxiderelay \
  --env-file .env \
  -p 8080:8080 \
  -v oxiderelay-data:/data \
  oxiderelay:latest
```

Use this mode when you want the container to run your local source changes rather
than a published registry image.

### 6. First Start With an Empty Database

When the database is empty, the service requires bootstrap administrator credentials:

```text
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

These settings are required only for the first successful startup with an empty
`users` table.

### 7. Restart With an Existing Database

When the SQLite database already contains users, the service starts without
bootstrap admin variables. In that mode, preserving the `/data` volume or the
SQLite files is the important part.

---

# Operations

Operational runbook details live in [deploy/OPERATIONS.md](deploy/OPERATIONS.md).

Admin API endpoints use cookie-based session authentication.

Example:

```http
GET /api/v1/projects/hr-portal/locales/ru?environment=production
```

Response:

```json
{
  "project": "hr-portal",
  "locale": "ru",
  "environment": "production",
  "values": {
    "common.button.save": "Сохранить",
    "common.button.cancel": "Отмена"
  }
}
```

Rules:

```text
The response contains translations from all namespaces.
Each response key is formatted as {namespace}.{key}.
The key stored in the database does not include the namespace prefix.
```

Locale bundle responses include a `version` field and support `ETag` / `If-None-Match`.
When using a versioned URL such as
`/api/v1/projects/hr-portal/locales/ru?environment=production&v=<version>`,
the response is cacheable as immutable content.

---

# Static JSON Delivery

Translation delivery for frontend applications.

In MVP, static JSON endpoints are public.

Recommended flow:

```http
GET /api/v1/projects/hr-portal/delivery-manifest/ru?environment=production
```

The manifest returns versioned URLs for the locale bundle and each namespace JSON file.

Example:

```http
GET /static/hr-portal/production/ru/common.json?v=<version>
```

Response:

```json
{
  "button.save": "Сохранить",
  "button.cancel": "Отмена"
}
```

Static JSON returns one namespace per file, so response keys are not namespace-prefixed.
Versioned static URLs use long-lived immutable browser caching.
Unversioned static URLs still work and use short TTL plus revalidation headers.

---

# Deployment

OxideRelay is designed for simple installation and operation.

The recommended install path is Docker Compose:

```bash
cp .env.example .env
docker compose up -d
```

The default [compose.yaml](compose.yaml) uses the published image
`kpakozz96pyc/oxiderelay:latest`, stores SQLite data in the `oxiderelay-data`
volume, and reads runtime settings from `.env`.

For predictable upgrades, replace `OXIDERELAY_IMAGE=...:latest` in `.env` with a release tag.

The container serves both the admin UI at `/` and the API at `/api`.
Alternative installation and launch options are documented above in `Run Modes`.

---

# MVP

## Localization Management

* Projects
* Languages
* Namespaces
* Translation CRUD
* Translation Import
* Translation Export

## Security

* Users
* Permissions
* Project Access Control
* Environment Access Control

## Integrations

* REST API
* Static JSON Delivery

## Storage

* SQLite

## Deployment

* Docker
* Native Binary

---

# Roadmap

* Audit Log
* Translation Versioning
* Change History
* Approval Workflow
* Roles
* .NET SDK
* TypeScript SDK
* Webhooks
* Translation Diff
* Environment Promotion
* Translation Rollback
* OpenAPI Client Generation
