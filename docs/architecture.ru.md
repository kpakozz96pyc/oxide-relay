# Архитектура OxideRelay

## Обзор

OxideRelay — это self-hosted сервис инфраструктуры локализации.

Цель проекта — предоставить централизованный механизм хранения и доставки переводов, используемых frontend-, backend- и mobile-приложениями.

MVP сфокусирован на следующем:

* хранение переводов
* управление переводами
* контроль доступа на основе permissions
* доставка переводов
* простое развёртывание

В первоначальном релизе OxideRelay не предназначен быть полноценной Translation Management System (`TMS`).

---

# Технологический стек

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
* Lucide React

## Аутентификация

* Email / Password
* Cookie-based sessions
* HTTP-only cookies

Авторизация для admin API основана на permissions.

В MVP доступ к проектам управляется через `user_project_access`.

Чтение переводов управляется project-wide permission `ReadTranslations`; отдельного permission на чтение по `environment` нет. Запись переводов управляется environment-specific permission-кодами: `EditAll` покрывает все environments, кроме `production`, а для `production` требуется `EditProd`.

Роли не входят в scope MVP.

Permissions являются глобальными для пользователя (`user_permissions`), а не project-scoped. `user_project_access` управляет только тем, *к каким* проектам применяются глобальные permissions пользователя — собственного набора permissions у него нет. Независимое назначение permissions по проектам (например, editor в одном проекте и read-only в другом) не входит в scope MVP; см. OXR-76 с оценкой trade-off'ов. Возвращаться к этому стоит только при наличии конкретного multi-project требования с per-user-role моделью, поскольку это потребует не расширения, а замены additve global-permission модели.

Когда пользователь создаёт проект, он становится владельцем проекта и неявно считается имеющим все project-scoped и environment-scoped permissions внутри этого проекта.

Endpoints доставки переводов по умолчанию публичны. Runtime-конфигурация может либо глобально отключить их, либо потребовать один общий Bearer token на всё развёртывание.

Per-client API keys, identity и token scopes не входят в scope MVP.

## API

* REST API
* OpenAPI documentation

## Deployment

* Docker Compose
* Docker
* Native binary

## Storage

* SQLite

## Import / Export

* JSON only

---

# Архитектура системы

```text
                 ┌────────────────────┐
                 │    Admin Web UI    │
                 │ React + TypeScript  │
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

# Доменная модель

## Project

Логическая группа переводов.

Примеры:

* HR Portal
* Mobile App
* Admin Panel

Поля:

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

Поддерживаемая locale внутри проекта.

Поля:

```text
id
project_id
code
name
created_at
updated_at
```

Примеры:

```text
en
ru
sr
de
```

---

## Namespace

Логическая группировка переводов.

Поля:

```text
id
project_id
name
created_at
updated_at
```

Примеры:

```text
common
validation
checkout
profile
```

---

## Environment

Область действия переводов.

Поля:

```text
id
project_id
name
slug
created_at
updated_at
```

Environment'ы по умолчанию:

```text
development
staging
production
```

---

## Translation Key

Поля:

```text
id
project_id
namespace_id
key
description
created_at
updated_at
```

Примеры:

```text
button.save
button.cancel
required
```

---

## Translation Value

Поля:

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

`id` — это независимый primary key.

Уникальность обеспечивается составным ключом:

```text
translation_key_id
language_id
environment_id
```

---

## User

Поля:

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

Permissions — основной механизм авторизации.

Поля:

```text
id
code
description
```

---

# Permissions

## Управление пользователями

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
EditAll
EditProd
```

Отдельного permission на чтение по `environment` нет; `ReadTranslations` уже покрывает все environments. `EditAll` покрывает все environments, кроме `production`, а для `production` требуется `EditProd`.

## Future

```text
PublishTranslations
RollbackTranslations
```

Каталог permissions seed'ится при startup и в MVP является immutable.

`ManagePermissions` позволяет назначать и снимать прямые user permissions, но не создавать новые permission-коды.

---

# Модель авторизации

Проверки авторизации выполняются в следующем порядке:

```text
1. User is authenticated
2. If the route is project-scoped, resolve project access and project ownership
3. Resolve the required project-scoped permission
4. If the route targets an environment, resolve the required environment permission
```

Для project-scoped routes владение проектом проверяется до разрешения permission.

Если пользователь владеет проектом, слой авторизации считает его имеющим все project-scoped и environment-scoped permissions внутри этого проекта.

Если пользователь не владеет проектом, ему одновременно нужны и явный доступ к проекту, и требуемые direct permission-коды.

Пример:

Чтобы редактировать перевод в production:

```text
Authenticated User
Project Access or Project Ownership
EditTranslations
EditProd
```

Все перечисленные условия обязательны одновременно.

---

# Инварианты безопасности администратора

Решение принято в OXR-75, реализовано в OXR-77.

`ManageUsers` и `ManagePermissions` защищаются независимо друг от друга: ни одна операция деактивации, удаления или замены permissions не должна оставлять систему без активных обладателей хотя бы одного из этих permission'ов, независимо от состояния другого. До OXR-77 защищался только `ManageUsers`, что позволяло последнему обладателю `ManagePermissions` снять этот permission с самого себя, сохранив `ManageUsers` — это приводило к невосстанавливаемому состоянию, поскольку bootstrap повторно выполняется только для пустой таблицы `users`, а у CLI нет команды восстановления permissions.

Self-revoke и изменение permissions у других администраторов допускаются (flat model, без administrator hierarchy), пока сохраняется инвариант, описанный выше. Frontend требует явного подтверждения перед отправкой любого изменения permissions.

Проверка защиты повторно выполняется внутри той же транзакции `BEGIN IMMEDIATE`, что и сама защищаемая запись, поэтому конкурентные запросы не могут обойти инвариант из-за устаревшего предварительного состояния. Frontend-подтверждение улучшает UX, но backend остаётся источником истины.

---

# Admin REST API

Admin REST API покрывает управление сессиями, пользователями, проектами и проектными ресурсами: языками, `namespace`, `environment`, ключами перевода и значениями переводов. Для MVP сюда также входят `JSON` import/export и управление project access через `user_project_access`.

Project-scoped endpoints строятся вокруг `project_slug` и используют ту же модель авторизации, что описана выше: владелец проекта проходит проверки автоматически, для остальных одновременно требуются и доступ к проекту, и соответствующие direct permission-коды.

Сессионная аутентификация использует cookie-based session. Frontend работает с admin API по `HTTP`, а write-операции на project-scoped и user-scoped маршрутах дополнительно защищаются соответствующими permission-кодами.

## User Management

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

Endpoints project membership управляют `user_project_access`.

Required permissions:

```text
Owner  -> always allowed inside the owned project
Non-owner -> ManageProjectMembers
```

Отдельного API membership по `environment` в MVP нет.

## Non-MVP

UI для audit log, UI для settings management, publishing workflow и редактирование permission-catalog не входят в initial release.

---

# Scope MVP

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

Backend-приложения могут получать переводы через REST.

Endpoint:

```http
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}
GET /api/v1/projects/{project_slug}/delivery-manifest/{language_code}?environment={environment_slug}
```

Правила:

* `environment` обязателен.
* Ответ содержит переводы из всех `namespace`.
* Ключи в `values` имеют префикс `namespace`, например `common.button.save`.
* Endpoints доставки по умолчанию публичны, могут быть глобально отключены или защищены общим Bearer token.
* Ключи формируются как `{namespace}.{key}`, где `key` хранится без префикса `namespace`.
* Ответы delivery API отдают version tokens, которые можно использовать для построения immutable URL.

---

# Static JSON Delivery

Frontend-приложения могут использовать переводы как статический `JSON`.

Endpoint:

```http
GET /static/{project}/{environment}/{locale}/{namespace}.json?v={version}
```

Пример:

```http
GET /static/hr-portal/production/ru/common.json?v=4f2f0f7f4ad6e6d1
```

Ответ:

```json
{
  "button.save": "Сохранить",
  "button.cancel": "Отмена"
}
```

Правила:

* Endpoint подчиняется общей конфигурации доступа к delivery.
* Файл представляет ровно один `namespace`.
* Ключи в `JSON` body не имеют префикса `namespace`.

Политика кэширования по умолчанию:

```http
Unversioned URLs: Cache-Control: public, max-age=300, must-revalidate
Versioned URLs:   Cache-Control: public, max-age=31536000, immutable
```

---

# Аутентификация

Хэширование паролей:

```text
Argon2
```

Хранение сессии:

```text
HTTP-only Cookie Session
```

JWT в MVP не используется.

---

# Конфигурация

Источники конфигурации:

```text
Environment Variables
config.toml
CLI Arguments
```

Обязательные environment variables:

```text
OXIDERELAY_HOST
OXIDERELAY_PORT
OXIDERELAY_DATABASE_PATH
```

Environment variables для bootstrap администратора:

```text
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

Эти переменные обязательны только при первом запуске, когда пользователей ещё нет.

Если хотя бы один пользователь уже существует, приложение должно запускаться без них.

При первом запуске автоматически создаётся учётная запись администратора, если пользователей ещё нет.

---

# База данных

Система миграций:

```text
SQLx Migrations
```

База данных:

```text
SQLite
```

Приложение автоматически выполняет миграции при startup.

---

# Маршрутизация frontend

```text
/                → React Application
/assets/*        → React Assets

/api/*           → REST API
/static/*        → Translation Delivery
```

Неизвестные frontend routes возвращают:

```text
index.html
```

для поддержки SPA navigation.

---

# Формат ошибок API

```json
{
  "error": {
    "code": "PermissionDenied",
    "message": "You do not have permission to edit translations in production."
  }
}
```

Поддерживаемые error-коды:

```text
ValidationError
Unauthorized
PermissionDenied
NotFound
Conflict
InternalError
```

---

# Вне scope

Следующие возможности намеренно исключены из MVP:

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

Эти возможности могут быть добавлены после стабилизации core platform.
