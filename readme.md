# OxideRelay

**OxideRelay** is a self-hosted localization infrastructure service for centralized storage, management, and delivery of translations across applications.

The project is designed for teams that do not want to store translations inside each individual service, web application, or mobile client.

OxideRelay acts as a single source of truth for localization data used by frontend, backend, and mobile applications.

---

# Development Status

Current version: `0.0.9`.

OxideRelay is in active pre-`0.1.0` development.

Before `0.1.0`, breaking migrations are allowed and development data is disposable.
Starting with `0.1.0`, use forward-only migrations only and do not rewrite migration history.

---

# Features

* Centralized translation storage
* Multiple projects support
* Multiple language support
* Namespace support
* Web UI for translation management
* Paginated missing-translation view with inline editing
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

# Technology Stack

* Backend: Rust, Axum, SQLite (via sqlx)
* Frontend: React, TypeScript, custom CSS, [Lucide](https://lucide.dev) icons
* No UI component library — no MUI, no Bootstrap, no other design-system framework.
  See [docs/frontend-style-guide.md](docs/frontend-style-guide.md) for the custom CSS tokens
  and component patterns.
* Deployment: Docker or native binary

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

## Placeholder Validation

The translation grid warns when a value is missing a placeholder that another
language's value for the same key uses, so dynamic content isn't silently
dropped in translation.

Two placeholder syntaxes are recognized:

```text
{{name}}
{name}
```

Both use the same character set for the placeholder name: letters, digits,
`_`, and `.` (for example `{{user.first_name}}`). The check compares the set
of placeholder names across every language that currently has a value for a
key; a language is flagged only when it is missing a name that at least one
other populated language uses. This is a non-blocking warning shown in the
grid cell — it never prevents saving.

---

# Users and Permissions

OxideRelay uses a permission-based access model.

---

## User

A user can have:

* Direct permissions
* Access to specific projects

Project members with `ReadTranslations` can read translations in every environment.
Environment writes require `EditAll` for every environment except `production`, or
`EditProd` for `production`.

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

If no administrator can sign in, generate a link directly against the existing
SQLite database without starting the HTTP server:

```bash
cargo run -p oxiderelay-backend -- \
  --config backend/config.toml.example \
  password-reset-link --email admin@example.com
```

The command uses the normal database configuration precedence, requires the
database file to already exist, and prints a relative `/reset-password` URL
valid for 15 minutes. Prefix the URL with the deployment origin before opening
it. Treat the output as a password credential; generating another link for the
same user invalidates the previous one.

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
EditAll
EditProd
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

Delivery endpoints are public by default and do not use admin session authentication.
They can be disabled globally or protected with one deployment-wide shared Bearer token.
The generated OpenAPI document is available at `GET /api/openapi.json`.

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
OXIDERELAY_PUBLIC_DELIVERY_ENABLED
OXIDERELAY_DELIVERY_TOKEN
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

Delivery defaults:

```text
public_delivery_enabled = true
delivery_token = unset
```

Set `OXIDERELAY_PUBLIC_DELIVERY_ENABLED=false` to make all REST and static
delivery endpoints return `404`. This does not disable the admin UI or management API.

Set a non-empty `OXIDERELAY_DELIVERY_TOKEN` to require the following header on
all delivery requests:

```http
Authorization: Bearer <OXIDERELAY_DELIVERY_TOKEN>
```

The token is a single deployment-wide shared secret, not an API-key or user
identity system. Use HTTPS whenever it is enabled. Protected responses use
private client caching and vary by the `Authorization` header.

### Login Rate Limit

To limit password guessing, login attempts are persisted in SQLite by a hash of
the normalized email address. Each identifier can make 15 unsuccessful login
attempts in a five-minute window. Further attempts return `429 RateLimited`
until the window expires. Successful logins clear the counter. The API uses
the same invalid-credentials response for unknown, inactive, and incorrect
credentials.

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

This mode is recommended when actively developing frontend or backend features.

### 2. Production-like Local Mode

Build the frontend once, then run the backend so it serves the compiled UI:

```bash
cd frontend
npm install
npm run build
cd ..
cargo run -p oxiderelay-backend -- --config backend/config.toml.example
```

Use this mode to verify routing, static asset serving, and the integrated app
without containers.

### 3. Native Binary Mode

Build a release binary and run it directly:

```bash
cargo build --release -p oxiderelay-backend
./target/release/oxiderelay-backend --config backend/config.toml
```

Use this when installing without Docker.

### 4. Docker Compose Mode

Start OxideRelay using the repository's Compose setup:

```bash
cp .env.example .env
docker compose up -d
```

This is the recommended self-hosted installation path.

### 5. Docker From Source Mode

Build the image locally and run it yourself:

```bash
docker build -t oxiderelay:local .
docker run --rm -p 8080:8080 \
  -v "$(pwd)/data:/var/lib/oxiderelay" \
  oxiderelay:local
```

Use this mode when testing container changes before publishing an image.

---

# API Overview

OxideRelay exposes management APIs for the admin UI and delivery APIs for client applications.

## Management API

Used by the admin UI for authenticated administration tasks.

Examples:

```http
POST /api/v1/auth/login
GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/{project}/translations
PUT  /api/v1/projects/{project}/translations/{key}
```

## Delivery Metadata

Clients can fetch lightweight metadata about published translation content:

```http
GET /api/v1/projects/hr-portal/delivery-metadata?environment=production
```

Response:

```json
{
  "project": "hr-portal",
  "environment": "production",
  "languages": ["en", "ru"],
  "namespaces": ["common", "validation"],
  "version": "2026-01-01T00:00:00Z"
}
```

## REST Locale Delivery

Backend services can fetch one locale as a single namespace-prefixed JSON object:

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
the server verifies that `<version>` matches the version of the content it is
about to return. Only then is the response cacheable as immutable content. A
`v` that does not match the current version (stale after a translation
change, or simply invalid) is rejected with `404 Not Found` rather than being
served — an outdated or forged versioned URL can never be cached as
immutable.

---

# Static JSON Delivery

Translation delivery for frontend applications.

Static JSON endpoints follow the same public-delivery and Bearer-token settings
as REST delivery endpoints.

Recommended flow:

```http
GET /api/v1/projects/hr-portal/delivery-manifest/ru?environment=production
```

The manifest returns versioned URLs for the locale bundle and each namespace JSON file.
When a delivery token is configured, clients must send the Bearer header when
fetching both the manifest and every URL returned by it.

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
Versioned static URLs use long-lived immutable browser caching, but only when
`v` matches the namespace file's current version; a mismatched `v` returns
`404 Not Found` instead of immutable-cached content.
Unversioned static URLs still work and use short TTL plus revalidation headers.

---

# Security Model

OxideRelay has two exposure classes in MVP:

* Admin UI and management APIs use session authentication and are intended for trusted operators.
* Delivery endpoints do not use admin sessions and are public by default, globally disabled, or protected by one shared Bearer token:
  * Delivery metadata under `/api/v1/projects/{project}/delivery-metadata`
  * REST locale bundle delivery under `/api/v1/projects/{project}/locales/{locale}`
  * Delivery manifest endpoints under `/api/v1/projects/{project}/delivery-manifest/{locale}`
  * Static JSON delivery under `/static/{project}/{environment}/{locale}/{namespace}.json`

The shared token has no per-project scopes, per-client identity, expiry, or
server-managed rotation. Treat content as public unless the token is configured
and distributed only to trusted clients.

Private translations must not be exposed to the public internet without HTTPS
and either the shared delivery token or reverse proxy/VPN protection in front of OxideRelay.

Recommended deployment controls:

* Prefer running OxideRelay on an internal network or private subnet.
* If external access is required, enable the delivery token and TLS, or place OxideRelay behind a reverse proxy with authentication and TLS, or behind a VPN.
* Restrict inbound access with firewall or security-group rules so only trusted users and applications can reach the service.

---

# Deployment

OxideRelay is designed for simple installation and operation.

The recommended install path is Docker Compose:

```bash
cp .env.example .env
# edit .env and set initial administrator credentials
docker compose up -d
```

The default [compose.yaml](compose.yaml) uses the published image
`kpakozz96pyc/oxiderelay:latest`, stores SQLite data in the `oxiderelay-data`
volume, and reads runtime settings from `.env`.

Every push of a `vX.Y.Z` git tag publishes a matching `kpakozz96pyc/oxiderelay:vX.Y.Z`
image (stable releases also update `:latest`). For predictable, repeatable
upgrades, pin `OXIDERELAY_IMAGE` in `.env` to that release tag instead of
`:latest`, since `:latest` can change under you between deploys.

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
* Placeholder Validation (warning-only)

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

---

# License

OxideRelay is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
