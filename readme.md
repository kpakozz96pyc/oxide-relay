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

Development backend:

```bash
cargo run -p oxiderelay-backend -- --config backend/config.toml.example
```

Development frontend:

```bash
cd frontend
npm run dev
```

The Vite dev server proxies `/api` and `/static` to the backend on `127.0.0.1:8080`.

Production-style single-process startup:

```bash
cd frontend
npm run build
cd ..

cargo run -p oxiderelay-backend -- --config backend/config.toml.example
```

With a built frontend bundle in `./frontend/dist`, the backend serves:

```text
/      -> frontend SPA
/api   -> backend API
/static -> public translation JSON delivery
```

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

---

# Static JSON Delivery

Translation delivery for frontend applications.

In MVP, static JSON endpoints are public.

Example:

```http
GET /static/hr-portal/production/ru/common.json
```

Response:

```json
{
  "button.save": "Сохранить",
  "button.cancel": "Отмена"
}
```

Static JSON returns one namespace per file, so response keys are not namespace-prefixed.

---

# Deployment

OxideRelay is designed for simple installation and operation.

## Docker

```bash
docker run -d \
  --name oxiderelay \
  -p 8080:8080 \
  -e OXIDERELAY_ADMIN_EMAIL=admin@example.com \
  -e OXIDERELAY_ADMIN_PASSWORD=change-me \
  -v oxiderelay_data:/data \
  ghcr.io/oxiderelay/oxiderelay:latest
```

The container serves both the admin UI at `/` and the API at `/api`.

## Native Binary

```bash
cd frontend && npm run build && cd ..
./oxiderelay
```

If the frontend bundle is available in `./frontend/dist` or the path configured via
`OXIDERELAY_FRONTEND_DIST_PATH`, the backend serves it from `/`.

By default, OxideRelay uses an embedded SQLite database.

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
