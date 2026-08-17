# Схема базы данных OxideRelay

OxideRelay использует SQLite как единственную базу данных для MVP.

В базе данных хранятся:

* Пользователи
* Разрешения
* Проекты
* Доступ к проектам
* Языки
* Окружения
* Пространства имён
* Ключи переводов
* Значения переводов
* Сессии

PostgreSQL не входит в scope для MVP.

Контроль доступа к окружениям в MVP основан только на разрешениях.

Таблица `user_environment_access` отсутствует.

Для авторизации в рамках проекта владение проектом проверяется до проверки прямых назначений разрешений.

Владелец проекта считается способным выполнять любое действие внутри принадлежащего ему проекта благодаря неявным разрешениям уровня проекта и уровня окружения.

## Политика миграций

До `0.1.0` допускаются ломающие миграции, а данные разработки считаются одноразовыми.
Начиная с `0.1.0`, используйте только forward-only миграции и не переписывайте историю миграций.

---

# Общие правила

## ID

Используйте UUID-строки в качестве первичных ключей.

```sql
id TEXT PRIMARY KEY
```

UUID генерируются приложением.

---

## Временные метки

Используйте строки ISO-8601 в UTC.

```sql
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

Для неизменяемых join-таблиц `updated_at` не требуется.

---

## Мягкое удаление

Не реализуйте мягкое удаление в MVP.

Где необходимо, используйте физическое удаление.

---

# Таблицы

## users

Хранит пользователей системы.

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Индексы:

```sql
CREATE INDEX idx_users_email ON users(email);
```

---

## permissions

Разрешения — это атомарные права доступа.

```sql
CREATE TABLE permissions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description TEXT
);
```

Примеры:

```text
ManageUsers
ManagePermissions

CreateProjects
EditProjects
DeleteProjects
ViewProjects
ManageProjectMembers

ReadTranslations
EditTranslations
DeleteTranslations
ImportTranslations
ExportTranslations

EditAll
EditProd
```

`ReadTranslations` предоставляет доступ на чтение переводов во всех окружениях; отдельного
разрешения на чтение для каждого окружения нет. Запись разделена по окружениям: `EditAll` покрывает все
окружения, кроме `production`, а для `production` отдельно требуется `EditProd`.

Каталог разрешений предзаполняется и является неизменяемым в MVP.

`ManagePermissions` позволяет назначать и удалять прямые пользовательские разрешения.

Оно не позволяет во время выполнения создавать новые коды разрешений.

---

## user_permissions

Прямые пользовательские разрешения.

Используются для исключений и точечной настройки доступа.

```sql
CREATE TABLE user_permissions (
    user_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,

    PRIMARY KEY (user_id, permission_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);
```

Индексы:

```sql
CREATE INDEX idx_user_permissions_permission_id
ON user_permissions(permission_id);
```

---

## projects

Хранит проекты локализации.

Пользователь, который создаёт проект, становится его владельцем.

В MVP владелец проекта неявно получает все разрешения в рамках этого проекта без необходимости прямого назначения глобальных разрешений.

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    owner_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
```

Индексы:

```sql
CREATE INDEX idx_projects_slug ON projects(slug);
CREATE INDEX idx_projects_owner_user_id ON projects(owner_user_id);
```

---

## user_project_access

Определяет, к каким проектам пользователь может получать доступ.

```sql
CREATE TABLE user_project_access (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    created_at TEXT NOT NULL,

    PRIMARY KEY (user_id, project_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

Индексы:

```sql
CREATE INDEX idx_user_project_access_project_id
ON user_project_access(project_id);
```

---

## languages

Языки, включённые для проекта.

```sql
CREATE TABLE languages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

    UNIQUE (project_id, code)
);
```

Примеры:

```text
en
ru
sr
de
```

Индексы:

```sql
CREATE INDEX idx_languages_project_id
ON languages(project_id);
```

---

## environments

Окружения переводов для проекта.

```sql
CREATE TABLE environments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

    UNIQUE (project_id, slug)
);
```

Окружения по умолчанию:

```text
development
staging
production
```

Индексы:

```sql
CREATE INDEX idx_environments_project_id
ON environments(project_id);
```

---

## namespaces

Логические группы ключей переводов.

```sql
CREATE TABLE namespaces (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

    UNIQUE (project_id, name)
);
```

Примеры:

```text
common
validation
checkout
profile
```

Индексы:

```sql
CREATE INDEX idx_namespaces_project_id
ON namespaces(project_id);
```

---

## translation_keys

Хранит ключи переводов.

```sql
CREATE TABLE translation_keys (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    namespace_id TEXT NOT NULL,
    key TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (namespace_id) REFERENCES namespaces(id) ON DELETE CASCADE,

    UNIQUE (project_id, namespace_id, key)
);
```

Примеры:

```text
button.save
button.cancel
required
```

Индексы:

```sql
CREATE INDEX idx_translation_keys_project_id
ON translation_keys(project_id);

CREATE INDEX idx_translation_keys_namespace_id
ON translation_keys(namespace_id);
```

---

## translation_values

Хранит фактические переведённые значения.

```sql
CREATE TABLE translation_values (
    id TEXT PRIMARY KEY,
    translation_key_id TEXT NOT NULL,
    language_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_by_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (translation_key_id) REFERENCES translation_keys(id) ON DELETE CASCADE,
    FOREIGN KEY (language_id) REFERENCES languages(id) ON DELETE CASCADE,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE (translation_key_id, language_id, environment_id)
);
```

`id` — это первичный ключ строки.

Этот `id` используется как идентификатор в API-маршрутах обновления и удаления переводов.

Составное уникальное ограничение предотвращает дублирование значений для одного и того же ключа перевода, языка и окружения.

Индексы:

```sql
CREATE INDEX idx_translation_values_key_id
ON translation_values(translation_key_id);

CREATE INDEX idx_translation_values_language_id
ON translation_values(language_id);

CREATE INDEX idx_translation_values_environment_id
ON translation_values(environment_id);

CREATE INDEX idx_translation_values_lookup
ON translation_values(language_id, environment_id);
```

---

## sessions

Хранит активные сессии admin UI.

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Индексы:

```sql
CREATE INDEX idx_sessions_user_id
ON sessions(user_id);

CREATE INDEX idx_sessions_expires_at
ON sessions(expires_at);
```

---

# Не хранится в MVP

Следующие концепции не имеют отдельных таблиц в MVP:

* Журнал аудита
* Системные настройки
* Членство в окружениях
* История публикаций
* Роли

---

# Обязательные сид-данные

При первом запуске приложение должно заполнить:

* Разрешения
* Начального пользователя-администратора

---

## Разрешения по умолчанию

```text
ManageUsers
ManagePermissions

CreateProjects
EditProjects
DeleteProjects
ViewProjects
ManageProjectMembers

ReadTranslations
EditTranslations
DeleteTranslations
ImportTranslations
ExportTranslations

EditAll
EditProd
```

---

# Начальный администратор

При первом запуске:

1. Проверьте, существует ли хотя бы один пользователь.
2. Если пользователей нет, создайте начального пользователя-администратора.
3. Используйте переменные окружения:

```text
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

4. Назначьте этому пользователю все предзаполненные разрешения напрямую.

Эти переменные требуются только во время bootstrap-сценария, когда пользователей ещё нет.

Если хотя бы один пользователь уже существует, при запуске они не должны требоваться.

---

# Инициализация проекта по умолчанию

Когда создаётся проект:

1. Создайте проект.
2. Установите создателя как `owner_user_id`.
3. Добавьте создателя в `user_project_access`.
4. Создайте окружения по умолчанию:

```text
development
staging
production
```

5. Создайте пространство имён по умолчанию:

```text
common
```

6. Считайте, что владелец проекта обладает всеми разрешениями уровня проекта и уровня окружения внутри этого проекта.

Записи ACL окружений на уровне проекта не создаются, потому что доступ к окружениям определяется разрешениями плюс неявным правилом владельца.

Создание проекта должно выполняться в рамках одной транзакции базы данных вместе с созданием доступа владельца, окружений по умолчанию и пространства имён по умолчанию.

---

# Примеры запросов

## Получение переводов для статического JSON endpoint

Endpoint:

```http
GET /static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json
```

SQL-логика:

```sql
SELECT
    tk.key,
    tv.value
FROM translation_values tv
JOIN translation_keys tk ON tk.id = tv.translation_key_id
JOIN languages l ON l.id = tv.language_id
JOIN environments e ON e.id = tv.environment_id
JOIN namespaces n ON n.id = tk.namespace_id
JOIN projects p ON p.id = tk.project_id
WHERE p.slug = ?
  AND e.slug = ?
  AND l.code = ?
  AND n.name = ?
ORDER BY tk.key;
```

Ответ:

```json
{
  "button.save": "Save",
  "button.cancel": "Cancel"
}
```

---

## Получение всех переводов для backend API

Endpoint:

```http
GET /api/v1/projects/{project_slug}/locales/{language_code}?environment=production
```

SQL-логика:

```sql
SELECT
    n.name AS namespace,
    tk.key,
    tv.value
FROM translation_values tv
JOIN translation_keys tk ON tk.id = tv.translation_key_id
JOIN languages l ON l.id = tv.language_id
JOIN environments e ON e.id = tv.environment_id
JOIN namespaces n ON n.id = tk.namespace_id
JOIN projects p ON p.id = tk.project_id
WHERE p.slug = ?
  AND e.slug = ?
  AND l.code = ?
ORDER BY n.name, tk.key;
```

Формат ответа:

```json
{
  "project": "hr-portal",
  "locale": "ru",
  "environment": "production",
  "values": {
    "common.button.save": "Сохранить",
    "common.button.cancel": "Отмена",
    "validation.required": "Required field"
  }
}
```

Правило формирования ключа:

```text
translation_keys.key stores only the local key part.
The delivery response key is composed as {namespace}.{key}.
```

---

# Поведение импорта

Цель импорта должна включать:

```text
project_id
environment_id
language_id
namespace_id
```

Рекомендуемый admin endpoint:

```http
POST /api/v1/projects/{project_slug}/imports/json
```

Требуемые разрешения:

```text
ImportTranslations
Edit{Environment}
```

Входной JSON:

```json
{
  "button.save": "Save",
  "button.cancel": "Cancel"
}
```

Для каждой записи:

1. Найдите или создайте `translation_keys`.
2. Выполните upsert в `translation_values`.
3. Обновите `updated_by_user_id`.
4. Обновите `updated_at`.

Входные ключи локальны для выбранного пространства имён и не должны включать префикс пространства имён.

---

# Поведение экспорта

Цель экспорта должна включать:

```text
project_id
environment_id
language_id
namespace_id
```

Рекомендуемый admin endpoint:

```http
GET /api/v1/projects/{project_slug}/exports/json?environment={environment_slug}&language={language_code}&namespace={namespace}
```

Требуемые разрешения:

```text
ExportTranslations
Read{Environment}
```

Выходной JSON:

```json
{
  "button.save": "Save",
  "button.cancel": "Cancel"
}
```

Выходные ключи локальны для выбранного пространства имён и не включают префикс пространства имён.

---

# Сводка ограничений

Важные уникальные ограничения:

```text
users.email

projects.slug

languages(project_id, code)

environments(project_id, slug)

namespaces(project_id, name)

translation_keys(project_id, namespace_id, key)

translation_values(translation_key_id, language_id, environment_id)
```

---

# Вне scope MVP

Не добавляйте эти таблицы в MVP:

```text
audit_log
translation_versions
approval_requests
webhooks
external_integrations
```

Они относятся к более поздним версиям.
