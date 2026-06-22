# OxideRelay Architecture

## Overview

OxideRelay is a self-hosted localization infrastructure service.

The goal of the project is to provide a centralized storage and delivery mechanism for translations used by frontend, backend and mobile applications.

The MVP focuses on:

* Translation storage
* Translation management
* Permission-based access control
* Translation delivery
* Simple deployment

OxideRelay is not intended to be a full Translation Management System (TMS) in the initial release.

---

# Technology Stack

## Backend

* Rust
* Axum
* Tokio
* SQLx
* SQLite
* Serde
* Tracing
* Argon2
* Utoipa (OpenAPI)

## Frontend

* React
* TypeScript
* Vite
* React Router
* TanStack Query
* React Hook Form
* MUI
* MUI DataGrid Community

## Authentication

* Email / Password
* Cookie-based sessions
* HTTP-only cookies

Authorization for the admin API is permission-based.

In MVP, project access is controlled by `user_project_access`.

Environment access is controlled only by environment-specific permission codes such as `ReadDevelopment`, `EditStaging`, and `EditProduction`.

Roles are out of scope for MVP.

When a user creates a project, that user becomes the project owner and is implicitly treated as having all project-scoped and environment-scoped permissions within that project.

Translation delivery endpoints are public in MVP.

API keys are out of scope for MVP.

## API

* REST API
* OpenAPI documentation

## Deployment

* Docker
* Native binary

## Storage

* SQLite

## Import / Export

* JSON only

---

# System Architecture

```text
                 ┌────────────────────┐
                 │    Admin Web UI    │
                 │  React + MUI       │
                 └─────────┬──────────┘
                           │
                           │ HTTP
                           │
┌──────────────────────────▼──────────────────────────┐
│                   OxideRelay                        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │               Authentication                  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Admin REST API                   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │          Translation Delivery API             │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │           Static JSON Delivery                │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │               Domain Services                 │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                Repositories                   │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
                    ┌────────────┐
                    │  SQLite DB │
                    └────────────┘
```

---

# Domain Model

## Project

Logical group of translations.

Examples:

* HR Portal
* Mobile App
* Admin Panel

Fields:

```text
id
name
slug
description
owner_user_id
created_at
updated_at
```

---

## Language

Supported locale inside a project.

Fields:

```text
id
project_id
code
name
created_at
updated_at
```

Examples:

```text
en
ru
sr
de
```

---

## Namespace

Logical translation grouping.

Fields:

```text
id
project_id
name
created_at
updated_at
```

Examples:

```text
common
validation
checkout
profile
```

---

## Environment

Translation scope.

Fields:

```text
id
project_id
name
slug
created_at
updated_at
```

Default environments:

```text
development
staging
production
```

---

## Translation Key

Fields:

```text
id
project_id
namespace_id
key
description
created_at
updated_at
```

Examples:

```text
button.save
button.cancel
required
```

---

## Translation Value

Fields:

```text
id
translation_key_id
language_id
environment_id
value
updated_by_user_id
created_at
updated_at
```

`id` is an independent primary key.

Uniqueness is enforced by a composite key:

```text
translation_key_id
language_id
environment_id
```

---

## User

Fields:

```text
id
email
password_hash
display_name
is_active
created_at
updated_at
```

---

## Permission

Permissions are the primary authorization mechanism.

Fields:

```text
id
code
description
```

---

# Permissions

## User Management

```text
ManageUsers
ManagePermissions
```

## Projects

```text
CreateProjects
EditProjects
DeleteProjects
ViewProjects
ManageProjectMembers
```

## Translations

```text
ReadTranslations
EditTranslations
DeleteTranslations
ImportTranslations
ExportTranslations
```

## Environments

```text
ReadDevelopment
ReadStaging
ReadProduction

EditDevelopment
EditStaging
EditProduction
```

## Future

```text
PublishTranslations
RollbackTranslations
```

The permission catalog is seeded on startup and is immutable in MVP.

`ManagePermissions` allows assigning and removing direct user permissions, not creating new permission codes.

---

# Authorization Model

Authorization checks are performed in the following order:

```text
1. User is authenticated
2. If the route is project-scoped, resolve project access and project ownership
3. Resolve the required project-scoped permission
4. If the route targets an environment, resolve the required environment permission
```

For project-scoped routes, project ownership is evaluated before permission resolution.

If the user owns the project, the authorization layer treats the user as having all project-scoped and environment-scoped permissions inside that project.

If the user does not own the project, the user must have both explicit project access and the required direct permission codes.

Example:

To edit a translation in production:

```text
Authenticated User
Project Access or Project Ownership
EditTranslations
EditProduction
```

Required simultaneously.

---

# Project Access

Users only see assigned projects.

Table:

```text
UserProjectAccess

user_id
project_id
created_at
```

---

# Project Ownership

Project creator automatically becomes project owner.

Project owner can:

* Manage project members
* Grant project access
* Manage project translations

Without global administrator privileges.

This is a built-in authorization rule in MVP and is evaluated only within the owned project.

For non-owners, project membership management requires `ManageProjectMembers`.

---

# API Design

Base URL:

```text
/api/v1
```

Project-scoped admin routes use `project_slug`.

Translation delivery routes also use `project_slug`.

---

## Authentication

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/me
```

---

## Projects

```http
GET    /api/v1/projects
POST   /api/v1/projects

GET    /api/v1/projects/{project_slug}
PUT    /api/v1/projects/{project_slug}
DELETE /api/v1/projects/{project_slug}
```

Required permissions:

```text
GET    /api/v1/projects                    -> authenticated user; returns owned and assigned projects only
POST   /api/v1/projects                    -> CreateProjects
GET    /api/v1/projects/{project_slug}     -> ViewProjects
PUT    /api/v1/projects/{project_slug}     -> EditProjects
DELETE /api/v1/projects/{project_slug}     -> DeleteProjects
```

---

## Languages

```http
GET  /api/v1/projects/{project_slug}/languages
POST /api/v1/projects/{project_slug}/languages

DELETE /api/v1/projects/{project_slug}/languages/{language_code}
```

Required permissions:

```text
GET    -> ViewProjects
POST   -> EditProjects
DELETE -> EditProjects
```

---

## Namespaces

```http
GET  /api/v1/projects/{project_slug}/namespaces
POST /api/v1/projects/{project_slug}/namespaces

DELETE /api/v1/projects/{project_slug}/namespaces/{namespace}
```

Required permissions:

```text
GET    -> ViewProjects
POST   -> EditProjects
DELETE -> EditProjects
```

---

## Environments

```http
GET  /api/v1/projects/{project_slug}/environments
POST /api/v1/projects/{project_slug}/environments

DELETE /api/v1/projects/{project_slug}/environments/{environment_slug}
```

Required permissions:

```text
GET    -> ViewProjects
POST   -> EditProjects
DELETE -> EditProjects
```

---

## Translations

```http
GET  /api/v1/projects/{project_slug}/translations
POST /api/v1/projects/{project_slug}/translations

PUT /api/v1/projects/{project_slug}/translations/{translation_value_id}
DELETE /api/v1/projects/{project_slug}/translations/{translation_value_id}
```

`translation_value_id` refers to `translation_values.id`.

Translation write operations are value-oriented: a translation key may exist once per namespace, while each environment/language variant is represented by a separate `translation_values` row.

`translation_keys.key` stores only the local key part and does not include the namespace name.

Required permissions:

```text
GET    -> ReadTranslations  + Read{Environment}
POST   -> EditTranslations  + Edit{Environment}
PUT    -> EditTranslations  + Edit{Environment}
DELETE -> DeleteTranslations + Edit{Environment}
```

The target environment for a translation read or write must be explicit in the request payload or query parameters.

## Delivery

```http
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}
GET /static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json
```

REST delivery returns all namespaces for a locale as a flat object with namespace-prefixed keys.

Static JSON delivery returns one namespace per file, so response keys are not namespace-prefixed.

Both delivery endpoints are public in MVP and do not require admin session authentication.

---

## Users

```http
GET    /api/v1/users
POST   /api/v1/users
PUT    /api/v1/users/{id}
DELETE /api/v1/users/{id}
```

Required permissions:

```text
GET    -> ManageUsers
POST   -> ManageUsers
PUT    -> ManageUsers
DELETE -> ManageUsers
```

## User Authorization

```http
GET /api/v1/users/{id}/permissions
PUT /api/v1/users/{id}/permissions
```

Required permissions:

```text
GET -> ManagePermissions
PUT -> ManagePermissions
```

## Project Members

```http
GET    /api/v1/projects/{project_slug}/members
POST   /api/v1/projects/{project_slug}/members
DELETE /api/v1/projects/{project_slug}/members/{user_id}
```

Project membership endpoints manage `user_project_access`.

Required permissions:

```text
Owner  -> always allowed inside the owned project
Non-owner -> ManageProjectMembers
```

There is no separate environment membership API in MVP.

## Non-MVP

Audit log UI, settings management UI, publishing workflow, and permission-catalog editing are out of scope for the initial release.

---

# MVP Scope

## Included

* Users
* Permissions
* Projects
* Languages
* Namespaces
* Environments
* Translation CRUD
* Translation import/export
* Session authentication
* Project access control
* Environment access control
* Admin REST API
* Translation delivery REST API
* Static JSON delivery
* SQLite
* Docker
* Native binary

## Excluded

* API keys for private delivery
* Audit log
* Translation versioning
* Change history
* Approval workflow
* Webhooks
* Environment promotion
* Translation rollback
* External SDKs

---

## Permissions

```http
GET /api/v1/permissions
```

Required permissions:

```text
GET -> ManagePermissions
```

---

# Translation Delivery API

Backend applications can retrieve translations through REST.

Endpoint:

```http
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}
GET /api/v1/projects/{project_slug}/delivery-manifest/{language_code}?environment={environment_slug}
```

Rules:

* `environment` is required.
* The response contains translations from all namespaces.
* Keys in `values` are namespace-prefixed, for example `common.button.save`.
* Delivery endpoints are public in MVP.
* Keys are built as `{namespace}.{key}` where `key` is stored without a namespace prefix.
* Delivery responses expose version tokens that can be used to build immutable URLs.

---

# Static JSON Delivery

Frontend applications can consume translations as static JSON.

Endpoint:

```http
GET /static/{project}/{environment}/{locale}/{namespace}.json?v={version}
```

Example:

```http
GET /static/hr-portal/production/ru/common.json?v=4f2f0f7f4ad6e6d1
```

Response:

```json
{
  "button.save": "Сохранить",
  "button.cancel": "Отмена"
}
```

Rules:

* The endpoint is public in MVP.
* The file represents exactly one namespace.
* Keys in the JSON body are not namespace-prefixed.

Default cache policy:

```http
Cache-Control: public, max-age=300
```

---

# Authentication

Password hashing:

```text
Argon2
```

Session storage:

```text
HTTP-only Cookie Session
```

No JWT in MVP.

---

# Configuration

Configuration sources:

```text
Environment Variables
config.toml
CLI Arguments
```

Required environment variables:

```text
OXIDERELAY_HOST
OXIDERELAY_PORT
OXIDERELAY_DATABASE_PATH
```

Admin bootstrap environment variables:

```text
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

These variables are required only on first startup when no users exist yet.

If at least one user already exists, the application must start without them.

First startup automatically creates an administrator account if no users exist.

---

# Database

Migration system:

```text
SQLx Migrations
```

Database:

```text
SQLite
```

The application automatically runs migrations during startup.

---

# Frontend Routing

```text
/                → React Application
/assets/*        → React Assets

/api/*           → REST API
/static/*        → Translation Delivery
```

Unknown frontend routes return:

```text
index.html
```

to support SPA navigation.

---

# API Error Format

```json
{
  "error": {
    "code": "PermissionDenied",
    "message": "You do not have permission to edit translations in production."
  }
}
```

Supported error codes:

```text
ValidationError
Unauthorized
PermissionDenied
NotFound
Conflict
InternalError
```

---

# Out of Scope

The following features are intentionally excluded from MVP:

* PostgreSQL
* Redis
* Translation Versioning
* Audit Log
* Approval Workflow
* Rollback
* Webhooks
* SSO
* LDAP
* OAuth
* Git Integration
* Translation Memory
* Machine Translation
* .NET SDK
* TypeScript SDK
* Kubernetes
* Helm

These features may be added after the core platform is stable.
