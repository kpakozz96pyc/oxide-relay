# Архитектура OxideRelay

## Обзор

OxideRelay - самостоятельно размещаемый инфраструктурный сервис локализации.

Цель проекта - предоставить централизованный механизм хранения и доставки переводов, используемых frontend-, backend- и мобильными приложениями.

MVP сосредоточен на следующих возможностях:

* Хранение переводов
* Управление переводами
* Контроль доступа на основе разрешений
* Доставка переводов
* Простое развёртывание

В первоначальном релизе OxideRelay не задуман как полноценная система управления переводами (TMS).

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

* Email / пароль
* Сессии на основе cookie
* HTTP-only cookie

Авторизация в административном API основана на разрешениях.

В MVP доступ к проектам контролируется таблицей `user_project_access`.

Чтение переводов контролируется общепроектным разрешением `ReadTranslations`; отдельного разрешения на чтение для каждого окружения нет. Запись переводов контролируется кодами разрешений для окружений: `EditAll` охватывает все окружения, кроме `production`, а для `production` требуется `EditProd`.

Роли не входят в область MVP.

Разрешения глобальны для пользователя (`user_permissions`), а не привязаны к проекту. `user_project_access` определяет только, *к каким* проектам применяются глобальные разрешения пользователя, и не содержит собственного набора разрешений. Независимое назначение разрешений одному пользователю в разных проектах (например, редактор в одном проекте и только чтение в другом) не входит в MVP; оценка компромиссов приведена в OXR-76. Возвращаться к этому вопросу следует только при наличии конкретного требования к ролям пользователя в нескольких проектах, поскольку потребуется заменить аддитивную модель глобальных разрешений, а не расширить её.

При создании проекта пользователь становится его владельцем и неявно считается обладателем всех проектных разрешений и разрешений окружений внутри этого проекта.

Эндпоинты доставки переводов по умолчанию публичны. Конфигурация времени выполнения может глобально отключить их или потребовать единый общий Bearer-токен для всего развёртывания.

API-ключи отдельных клиентов, клиентская идентификация и области действия токенов не входят в MVP.

## API

* REST API
* Документация OpenAPI

## Развёртывание

* Docker Compose
* Docker
* Нативный бинарный файл

## Хранилище

* SQLite

## Импорт / экспорт

* Только JSON

---

# Системная архитектура

```text
                 ┌────────────────────┐
                 │  Admin Web UI      │
                 │ React + TypeScript │
                 └─────────┬──────────┘
                           │
                           │ HTTP
                           │
┌──────────────────────────▼──────────────────────────┐
│                   OxideRelay                        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │               Аутентификация                 │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Admin REST API                   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │          API доставки переводов              │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │           Доставка статического JSON         │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │               Доменные сервисы               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                Репозитории                    │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
                    ┌────────────┐
                    │  SQLite DB │
                    └────────────┘
```

---

# Модель предметной области

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

Поддерживаемая локаль внутри проекта.

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

Логическая группа переводов.

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

## Окружение

Область переводов.

Поля:

```text
id
project_id
name
slug
created_at
updated_at
```

Окружения по умолчанию:

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

`id` - независимый первичный ключ.

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

Разрешения являются основным механизмом авторизации.

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

## Окружения

```text
EditAll
EditProd
```

Отдельного разрешения на чтение для каждого окружения нет: `ReadTranslations` уже охватывает все окружения. `EditAll` охватывает все окружения, кроме `production`, а для `production` требуется `EditProd`.

## В будущем

```text
PublishTranslations
RollbackTranslations
```

Каталог разрешений создаётся при запуске и неизменяем в MVP.

`ManagePermissions` позволяет назначать пользователям и удалять у них прямые разрешения, но не создавать новые коды разрешений.

---

# Модель авторизации

Проверки авторизации выполняются в следующем порядке:

```text
1. Пользователь аутентифицирован
2. Если маршрут относится к проекту, определить доступ к проекту и владение им
3. Определить необходимое проектное разрешение
4. Если маршрут относится к окружению, определить необходимое разрешение окружения
```

Для маршрутов проекта владение проектом проверяется до разрешений.

Если пользователь владеет проектом, слой авторизации считает, что у него есть все проектные разрешения и разрешения окружений внутри этого проекта.

Если пользователь не владеет проектом, у него должны одновременно быть явный доступ к проекту и необходимые коды прямых разрешений.

Пример:

Для редактирования перевода в production одновременно требуются:

```text
Authenticated User
Project Access or Project Ownership
EditTranslations
EditProd
```

---

# Инварианты безопасности администратора

Решение принято в OXR-75, реализация выполнена в OXR-77.

`ManageUsers` и `ManagePermissions` защищены независимо друг от друга: ни деактивация, ни удаление пользователя, ни замена разрешений не должны оставлять систему без активного обладателя каждого из этих разрешений, независимо от состояния другого разрешения. До OXR-77 защищался только `ManageUsers`, поэтому последний обладатель `ManagePermissions` мог отозвать его у себя, сохранив `ManageUsers`. Это приводило к невосстановимому состоянию: bootstrap выполняется повторно только для пустой таблицы `users`, а в CLI нет команды восстановления разрешений.

Самостоятельный отзыв и изменение разрешений другого администратора допустимы (плоская модель без иерархии администраторов), пока сохраняется указанный выше инвариант. Frontend требует явного подтверждения перед отправкой любого изменения разрешений.

Защитная проверка повторно выполняется внутри той же транзакции `BEGIN IMMEDIATE`, что и защищаемая запись, поэтому параллельные изменения администраторов не могут обойти её из-за состояния гонки.

---

# Доступ к проектам

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

* Управлять участниками проекта
* Предоставлять доступ к проекту
* Управлять переводами проекта

Глобальные административные привилегии для этого не требуются.

Это встроенное правило авторизации MVP, которое применяется только внутри проекта владельца.

Для пользователей, не являющихся владельцами, управление участниками проекта требует `ManageProjectMembers`.

---

# Проектирование API

Базовый URL:

```text
/api/v1
```

Административные маршруты проекта используют `project_slug`.

Маршруты доставки переводов также используют `project_slug`.

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

Необходимые разрешения:

```text
GET    /api/v1/projects                    -> аутентифицированный пользователь; возвращаются только собственные и назначенные проекты
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

Необходимые разрешения:

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

Необходимые разрешения:

```text
GET    -> ViewProjects
POST   -> EditProjects
DELETE -> EditProjects
```

---

## Окружения

```http
GET  /api/v1/projects/{project_slug}/environments
POST /api/v1/projects/{project_slug}/environments

DELETE /api/v1/projects/{project_slug}/environments/{environment_slug}
```

Необходимые разрешения:

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

`translation_value_id` ссылается на `translation_values.id`.

Операции записи ориентированы на значения: ключ перевода может существовать один раз в namespace, а каждый вариант для сочетания окружения и языка представлен отдельной строкой `translation_values`.

`translation_keys.key` хранит только локальную часть ключа без имени namespace.

Необходимые разрешения:

```text
GET    -> ReadTranslations   + Read{Environment}
POST   -> EditTranslations   + Edit{Environment}
PUT    -> EditTranslations   + Edit{Environment}
DELETE -> DeleteTranslations + Edit{Environment}
```

Целевое окружение для чтения или записи перевода должно быть явно указано в теле запроса или query-параметрах.

## Доставка

```http
GET /api/v1/projects/{project_slug}/delivery-metadata?environment={environment_slug}
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}
GET /api/v1/projects/{project_slug}/delivery-manifest/{language_code}?environment={environment_slug}
GET /static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json
```

REST-доставка возвращает все namespaces локали в виде плоского объекта с ключами, содержащими префикс namespace.

Доставка статического JSON возвращает один namespace в каждом файле, поэтому ключи ответа не содержат префикс namespace.

Эндпоинты доставки не требуют аутентификации через административную сессию. По умолчанию они публичны, однако конфигурация времени выполнения может отключить всю доставку или потребовать единый общий Bearer-токен для всего развёртывания.

---

## Пользователи

```http
GET    /api/v1/users
POST   /api/v1/users
PUT    /api/v1/users/{id}
DELETE /api/v1/users/{id}
```

Необходимые разрешения:

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

Необходимые разрешения:

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

Эндпоинты участников проекта управляют `user_project_access`.

Необходимые разрешения:

```text
Владелец    -> всегда разрешено внутри собственного проекта
Не владелец -> ManageProjectMembers
```

В MVP нет отдельного API участия в окружениях.

## За пределами MVP

Интерфейс журнала аудита, интерфейс управления настройками, workflow публикации и редактирование каталога разрешений не входят в первоначальный релиз.

---

# Область MVP

## Включено

* Пользователи
* Разрешения
* Проекты
* Языки
* Namespaces
* Окружения
* CRUD переводов
* Импорт и экспорт переводов
* Сессионная аутентификация
* Контроль доступа к проектам
* Контроль доступа к окружениям
* Административный REST API
* REST API доставки переводов
* Доставка статического JSON
* SQLite
* Docker
* Нативный бинарный файл

## Исключено

* API-ключи для приватной доставки
* Журнал аудита
* Версионирование переводов
* История изменений
* Workflow согласования
* Webhooks
* Продвижение между окружениями
* Откат переводов
* Внешние SDK

---

## Разрешения

```http
GET /api/v1/permissions
```

Необходимые разрешения:

```text
GET -> ManagePermissions
```

---

# API доставки переводов

Backend-приложения могут получать переводы через REST.

Эндпоинты:

```http
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}
GET /api/v1/projects/{project_slug}/delivery-manifest/{language_code}?environment={environment_slug}
```

Правила:

* Параметр `environment` обязателен.
* Ответ содержит переводы из всех namespaces.
* Ключи в `values` содержат префикс namespace, например `common.button.save`.
* Эндпоинты доставки по умолчанию публичны, могут быть глобально отключены или защищены общим Bearer-токеном.
* Ключи формируются как `{namespace}.{key}`, где `key` хранится без префикса namespace.
* Ответы доставки содержат токены версий, которые можно использовать для построения immutable URL.

---

# Доставка статического JSON

Frontend-приложения могут получать переводы в виде статического JSON.

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

* Эндпоинт подчиняется общей конфигурации доступа к доставке.
* Файл представляет ровно один namespace.
* Ключи в теле JSON не содержат префикс namespace.

Политика кеширования по умолчанию:

```http
URL без версии: Cache-Control: public, max-age=300, must-revalidate
URL с версией:  Cache-Control: public, max-age=31536000, immutable
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

В MVP не используется JWT.

---

# Конфигурация

Источники конфигурации:

```text
Переменные окружения
config.toml
Аргументы CLI
```

Обязательные переменные окружения:

```text
OXIDERELAY_HOST
OXIDERELAY_PORT
OXIDERELAY_DATABASE_PATH
```

Переменные окружения первоначального администратора:

```text
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

Эти переменные требуются только при первом запуске, когда пользователей ещё нет.

Если существует хотя бы один пользователь, приложение должно запускаться без них.

При первом запуске приложение автоматически создаёт учётную запись администратора, если пользователей нет.

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

Приложение автоматически выполняет миграции при запуске.

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

Это обеспечивает навигацию SPA.

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

Поддерживаемые коды ошибок:

```text
ValidationError
Unauthorized
PermissionDenied
NotFound
Conflict
InternalError
```

---

# Вне области проекта

Следующие возможности намеренно исключены из MVP:

* PostgreSQL
* Redis
* Версионирование переводов
* Журнал аудита
* Workflow согласования
* Откат
* Webhooks
* SSO
* LDAP
* OAuth
* Интеграция с Git
* Translation Memory
* Машинный перевод
* .NET SDK
* TypeScript SDK
* Kubernetes
* Helm

Эти возможности могут быть добавлены после стабилизации основной платформы.
