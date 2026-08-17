# Архитектура OxideRelay

## Обзор

OxideRelay — это self-hosted сервис инфраструктуры локализации.

Цель проекта — предоставить централизованное хранилище и механизм доставки переводов, используемых frontend-, backend- и mobile-приложениями.

MVP сосредоточен на следующем:

* хранение переводов
* управление переводами
* контроль доступа на основе разрешений
* доставка переводов
* простой деплой

OxideRelay не предназначен для того, чтобы в первом релизе быть полноценной Translation Management System (TMS).

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

Авторизация для admin API основана на разрешениях.

В MVP доступ к проектам контролируется через `user_project_access`.

Чтение переводов контролируется общим для проекта разрешением `ReadTranslations`; отдельного разрешения на чтение по environment нет. Запись переводов контролируется разрешениями, зависящими от environment: `EditAll` покрывает все environment, кроме `production`, а для `production` требуется `EditProd`.

Роли не входят в scope MVP.

Разрешения глобальны для пользователя (`user_permissions`), а не scoped по проектам. `user_project_access` определяет только *к каким* проектам применяются глобальные разрешения пользователя — собственного набора разрешений он не содержит. Назначение разных разрешений для одного и того же пользователя в разных проектах (например, editor в одном проекте и read-only в другом) не входит в scope MVP; см. OXR-76 с разбором компромиссов. Возвращаться к этому имеет смысл только при наличии конкретного требования по multi-project и per-user-role сценарию, поскольку это потребует не расширения, а замены аддитивной модели глобальных разрешений.

Эндпоинты доставки переводов по умолчанию публичны. Runtime-конфигурация может
либо глобально отключить их, либо потребовать один общий deployment-wide Bearer token.

Per-client API keys, identity и token scopes не входят в scope MVP.

## API

* REST API
* OpenAPI-документация

## Деплой

* Docker Compose
* Docker
* Native binary

## Хранилище

* SQLite

## Импорт / Экспорт

* только JSON

---

# Архитектура системы

```text
                 ┌────────────────────┐
                 │   Admin Web UI     │
                 │ React + TypeScript │
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
│  │               Admin REST API                  │  │
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
│  │              Domain Services                  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                Repositories                   │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
                    ┌────────────┐
                    │ SQLite DB  │
                    └────────────┘
```

---

# Доменная модель

## Проект

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

## Язык

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

Область действия перевода.

Поля:

```text
id
project_id
name
slug
created_at
updated_at
```

Environment по умолчанию:

```text
development
staging
production
```

---

## Ключ перевода

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

## Значение перевода

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

## Пользователь

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

## Разрешение

Разрешения — это основной механизм авторизации.

Поля:

```text
id
code
description
```

---

# Разрешения

## Управление пользователями

```text
ManageUsers
ManagePermissions
```

## Проекты

```text
CreateProjects
EditProjects
DeleteProjects
ViewProjects
ManageProjectMembers
```

## Переводы

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

Отдельного разрешения на чтение по environment нет; `ReadTranslations` уже покрывает каждый environment. `EditAll` покрывает все environment, кроме `production`, а для `production` требуется `EditProd`.

## Будущее

```text
PublishTranslations
RollbackTranslations
```

Каталог разрешений seed-ится при startup и неизменяем в MVP.

`ManagePermissions` позволяет назначать и снимать прямые пользовательские разрешения, но не создавать новые permission codes.

---

# Модель авторизации

Проверки авторизации выполняются в следующем порядке:

```text
1. Пользователь аутентифицирован
2. Если маршрут scoped по проекту, определить доступ к проекту и владение проектом
3. Определить требуемое project-scoped разрешение
4. Если маршрут нацелен на environment, определить требуемое разрешение для environment
```

Для project-scoped маршрутов владение проектом оценивается до определения разрешений.

Если пользователь владеет проектом, слой авторизации считает, что у пользователя есть все project-scoped и environment-scoped разрешения внутри этого проекта.

Если пользователь не владеет проектом, ему одновременно необходимы и явный доступ к проекту, и требуемые direct permission codes.

Пример:

Чтобы редактировать перевод в production:

```text
Authenticated User
Project Access or Project Ownership
EditTranslations
EditProd
```

Требуются одновременно.

---

# Инварианты безопасности администратора

Определены в OXR-75, реализованы в OXR-77.

`ManageUsers` и `ManagePermissions` защищаются независимо: никакая операция деактивации, удаления или замены набора разрешений не должна оставлять систему без активных обладателей хотя бы одного из этих разрешений, независимо от состояния второго. До OXR-77 защищался только `ManageUsers`, что позволяло последнему обладателю `ManagePermissions` снять его у самого себя, сохранив `ManageUsers` — это состояние нельзя восстановить, поскольку bootstrap повторно выполняется только для пустой таблицы `users`, а CLI не имеет команды для ремонта разрешений.

Self-revoke и изменения разрешений других администраторов разрешены (плоская модель, без иерархии администраторов), пока сохраняется описанный выше инвариант. Frontend требует явного подтверждения перед отправкой любого изменения разрешений.

Защита повторно проверяется внутри той же транзакции `BEGIN IMMEDIATE`, что и защищаемая запись, поэтому конкурентные мутации администраторов не могут обойти её гонкой.

---

# Доступ к проекту

Пользователи видят только назначенные им проекты.

Таблица:

```text
UserProjectAccess

user_id
project_id
created_at
```

---

# Владение проектом

Создатель проекта автоматически становится его владельцем.

Владелец проекта может:

* управлять участниками проекта
* выдавать доступ к проекту
* управлять переводами проекта

Без глобальных прав администратора.

Это встроенное правило авторизации в MVP и оно оценивается только внутри принадлежащего пользователю проекта.

Для пользователей, которые не являются владельцами, управление участниками проекта требует `ManageProjectMembers`.

---

# Дизайн API

Base URL:

```text
/api/v1
```

Project-scoped admin-маршруты используют `project_slug`.

Маршруты доставки переводов тоже используют `project_slug`.

---

## Аутентификация

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/me
```

---

## Проекты

```http
GET    /api/v1/projects
POST   /api/v1/projects

GET    /api/v1/projects/{project_slug}
PUT    /api/v1/projects/{project_slug}
DELETE /api/v1/projects/{project_slug}
```

Требуемые разрешения:

```text
GET    /api/v1/projects                    -> authenticated user; возвращает только проекты, которыми пользователь владеет, и проекты, к которым он назначен
POST   /api/v1/projects                    -> CreateProjects
GET    /api/v1/projects/{project_slug}     -> ViewProjects
PUT    /api/v1/projects/{project_slug}     -> EditProjects
DELETE /api/v1/projects/{project_slug}     -> DeleteProjects
```

---

## Языки

```http
GET  /api/v1/projects/{project_slug}/languages
POST /api/v1/projects/{project_slug}/languages

DELETE /api/v1/projects/{project_slug}/languages/{language_code}
```

Требуемые разрешения:

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

Требуемые разрешения:

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

Требуемые разрешения:

```text
GET    -> ViewProjects
POST   -> EditProjects
DELETE -> EditProjects
```

---

## Переводы

```http
GET  /api/v1/projects/{project_slug}/translations
POST /api/v1/projects/{project_slug}/translations

PUT /api/v1/projects/{project_slug}/translations/{translation_value_id}
DELETE /api/v1/projects/{project_slug}/translations/{translation_value_id}
```

`translation_value_id` указывает на `translation_values.id`.

Операции записи переводов ориентированы на значения: ключ перевода может существовать один раз на namespace, а каждый вариант для environment/language представлен отдельной строкой `translation_values`.

`translation_keys.key` хранит только локальную часть ключа и не включает имя namespace.

Требуемые разрешения:

```text
GET    -> ReadTranslations  + Read{Environment}
POST   -> EditTranslations  + Edit{Environment}
PUT    -> EditTranslations  + Edit{Environment}
DELETE -> DeleteTranslations + Edit{Environment}
```

Целевой environment для чтения или записи перевода должен быть явно указан в payload запроса или в query parameters.

## Delivery

```http
GET /api/v1/projects/{project_slug}/delivery-metadata?environment={environment_slug}
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}
GET /api/v1/projects/{project_slug}/delivery-manifest/{language_code}?environment={environment_slug}
GET /static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json
```

REST delivery возвращает все namespace для locale в виде плоского объекта с ключами, префиксированными namespace.

Static JSON delivery возвращает один namespace на файл, поэтому ключи в ответе не содержат префикс namespace.

Эндпоинты доставки не требуют admin session authentication. По умолчанию они публичны, но runtime-конфигурация может отключить всю доставку или потребовать один общий deployment-wide Bearer token.

---

## Пользователи

```http
GET    /api/v1/users
POST   /api/v1/users
PUT    /api/v1/users/{id}
DELETE /api/v1/users/{id}
```

Требуемые разрешения:

```text
GET    -> ManageUsers
POST   -> ManageUsers
PUT    -> ManageUsers
DELETE -> ManageUsers
```

## Авторизация пользователей

```http
GET /api/v1/users/{id}/permissions
PUT /api/v1/users/{id}/permissions
```

Требуемые разрешения:

```text
GET -> ManagePermissions
PUT -> ManagePermissions
```

## Участники проекта

```http
GET    /api/v1/projects/{project_slug}/members
POST   /api/v1/projects/{project_slug}/members
DELETE /api/v1/projects/{project_slug}/members/{user_id}
```

Эндпоинты членства в проекте управляют `user_project_access`.

Требуемые разрешения:

```text
Owner     -> всегда разрешено внутри принадлежащего проекта
Non-owner -> ManageProjectMembers
```

Отдельного API членства по environment в MVP нет.

## Не-MVP

Audit log UI, settings management UI, publishing workflow и редактирование каталога разрешений не входят в scope первого релиза.

---

# Scope MVP

## Входит

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

## Не входит

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

## Разрешения

```http
GET /api/v1/permissions
```

Требуемые разрешения:

```text
GET -> ManagePermissions
```

---

# API доставки переводов

Backend-приложения могут получать переводы через REST.

Эндпоинт:

```http
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}
GET /api/v1/projects/{project_slug}/delivery-manifest/{language_code}?environment={environment_slug}
```

Правила:

* `environment` обязателен.
* Ответ содержит переводы из всех namespace.
* Ключи в `values` имеют префикс namespace, например `common.button.save`.
* Эндпоинты доставки по умолчанию публичны, могут быть глобально отключены или защищены общим Bearer token.
* Ключи строятся как `{namespace}.{key}`, где `key` хранится без префикса namespace.
* Ответы доставки содержат version tokens, которые можно использовать для построения immutable URL.

---

# Доставка статического JSON

Frontend-приложения могут получать переводы как статический JSON.

Эндпоинт:

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

* Эндпоинт подчиняется общей конфигурации доступа к delivery.
* Файл представляет ровно один namespace.
* Ключи в JSON-body не имеют префикса namespace.

Политика кэширования по умолчанию:

```http
Unversioned URLs: Cache-Control: public, max-age=300, must-revalidate
Versioned URLs:   Cache-Control: public, max-age=31536000, immutable
```

---

# Аутентификация

Хеширование паролей:

```text
Argon2
```

Хранение сессий:

```text
HTTP-only Cookie Session
```

В MVP JWT не используется.

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

Environment variables для bootstrap admin:

```text
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

Эти переменные требуются только при первом startup, когда пользователей ещё нет.

Если уже существует хотя бы один пользователь, приложение должно стартовать без них.

При первом startup автоматически создаётся аккаунт администратора, если пользователей не существует.

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

Приложение автоматически запускает миграции во время startup.

---

# Маршрутизация frontend

```text
/                → React Application
/assets/*        → React Assets

/api/*           → REST API
/static/*        → Translation Delivery
```

Неизвестные frontend-маршруты возвращают:

```text
index.html
```

для поддержки SPA-навигации.

---

# Формат API-ошибок

```json
{
  "error": {
    "code": "PermissionDenied",
    "message": "You do not have permission to edit translations in production."
  }
}
```

Поддерживаемые error codes:

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

Эти возможности могут быть добавлены после стабилизации базовой платформы.
