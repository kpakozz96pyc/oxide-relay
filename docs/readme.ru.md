# OxideRelay

**OxideRelay** — это self-hosted сервис инфраструктуры локализации для централизованного хранения, управления и доставки переводов между приложениями.

Проект рассчитан на команды, которые не хотят хранить переводы внутри каждого отдельного сервиса, веб-приложения или мобильного клиента.

OxideRelay выступает единым источником истины для данных локализации, используемых frontend-, backend- и mobile-приложениями.

---

# Статус разработки

Текущая версия: `0.0.9`.

OxideRelay находится в активной pre-`0.1.0` разработке.

До `0.1.0` допускаются ломающие миграции, а данные разработки считаются одноразовыми.
Начиная с `0.1.0`, используйте только forward-only миграции и не переписывайте историю миграций.

---

# Возможности

* Централизованное хранение переводов
* Поддержка нескольких проектов
* Поддержка нескольких языков
* Поддержка namespace
* Web UI для управления переводами
* Постраничный просмотр отсутствующих переводов с inline-редактированием
* REST API для backend-приложений
* Доставка статического JSON для frontend-приложений
* Импорт и экспорт переводов
* Управление пользователями
* Система прямых разрешений
* Управление доступом на уровне проекта
* Управление разрешениями на уровне environment
* Встроенная база данных SQLite
* Self-hosted развёртывание
* Поддержка Docker

---

# Технологический стек

* Backend: Rust, Axum, SQLite (через sqlx)
* Frontend: React, TypeScript, custom CSS, иконки [Lucide](https://lucide.dev)
* UI component library не используется — без MUI, без Bootstrap и без других framework для design system.
  См. [docs/frontend-style-guide.md](docs/frontend-style-guide.md) для описания custom CSS tokens
  и паттернов компонентов.
* Развёртывание: Docker или native binary

---

# Почему OxideRelay?

Типичная схема локализации выглядит так:

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

Со временем переводы начинают дублироваться между несколькими приложениями и environment.

OxideRelay предлагает централизованный подход:

```text
                OxideRelay
                     │
      ┌──────────────┼──────────────┐
      │              │              │
Frontend         Backend        Mobile
```

Каждое приложение получает переводы из одного источника.

---

# Ключевые концепции

## Project

Логическая группа переводов.

Примеры:

```text
HR Portal
Mobile App
Landing Site
Admin Panel
```

Когда создаётся новый проект, OxideRelay автоматически инициализирует начальную структуру:

* Namespace по умолчанию: `common`
* Environment по умолчанию: `development`, `staging`, `production`
* Язык по умолчанию: `en` (`English`)

---

## Language

Поддерживаемая locale.

Примеры:

```text
en
ru
sr
de
```

---

## Namespace

Логическая группировка ключей перевода внутри проекта.

Примеры:

```text
common
validation
checkout
profile
```

Ключи перевода внутри namespace хранят только локальную часть ключа.

Примеры:

```text
namespace: common
key: button.save

namespace: validation
key: required
```

---

## Environment

Изолированная область переводов.

Примеры:

```text
Development
Staging
Production
```

---

## Placeholder Validation

Сетка переводов предупреждает, когда в значении отсутствует placeholder, который
используется для того же ключа в значении другого языка, чтобы динамический
контент не терялся в переводе незаметно.

Распознаются два синтаксиса placeholder:

```text
{{name}}
{name}
```

Оба используют одинаковый набор символов для имени placeholder: буквы, цифры,
`_` и `.` (например, `{{user.first_name}}`). Проверка сравнивает множество
имён placeholder между всеми языками, у которых сейчас есть значение для
ключа; язык помечается только тогда, когда у него отсутствует имя, которое
использует хотя бы один другой заполненный язык. Это неблокирующее
предупреждение, которое показывается в ячейке сетки — оно никогда не мешает
сохранению.

---

## Validation записи переводов

Backend применяет одинаковые правила валидации при создании переводов,
обновлениях и JSON-импорте:

* Ключи обрезаются по краям, не могут быть пустыми и ограничены 500 Unicode-символами.
* Ключи локальны для выбранного namespace и не должны начинаться с
  `{namespace}.`.
* Двоеточия, фигурные скобки и управляющие символы в ключах запрещены. Другие
  печатные Unicode-символы, точки, дефисы, подчёркивания и пробелы
  поддерживаются.
* Значения обрезаются по краям, не могут быть пустыми и ограничены 10 000 Unicode-символами.
* Описания необязательны и ограничены 2 000 Unicode-символами.
  Пустые описания и описания только из пробелов сохраняются как `null`.

JSON-импорт принимает плоский объект максимум с 5 000 записями. Он валидирует
весь пакет до записи, отклоняет весь пакет, если хотя бы одна запись неверна,
и выполняет upsert существующих значений для выбранных environment, language и
namespace.

---

# Пользователи и разрешения

OxideRelay использует модель доступа, основанную на разрешениях.

---

## User

У пользователя может быть:

* Прямые разрешения
* Доступ к определённым проектам

Участники проекта с `ReadTranslations` могут читать переводы во всех environment.
Запись в environment требует `EditAll` для всех environment, кроме `production`, или
`EditProd` для `production`.

В MVP нет отдельной таблицы membership на уровне environment.

Прямые разрешения глобальны, а не ограничены проектом: `user_project_access`
только определяет, к каким проектам применяются разрешения пользователя, но не
содержит отдельный набор разрешений на проект. Назначение разным проектам
разных разрешений для одного и того же пользователя (например, editor в одном
проекте и read-only в другом) выходит за рамки MVP; это было рассмотрено и
отклонено в OXR-76.

---

## Permissions

### Управление пользователями

```text
ManageUsers
ManagePermissions
```

`ManagePermissions` в MVP позволяет назначать и снимать прямые разрешения пользователя.

Он не позволяет создавать новые коды разрешений во время выполнения.

### Безопасность администраторов

Система гарантирует, что как минимум один активный пользователь сохраняет
`ManageUsers`, и что как минимум один активный пользователь сохраняет
`ManagePermissions`; эти проверки выполняются независимо. Деактивация, удаление
или снятие любого из этих разрешений у последнего активного владельца
конкретного разрешения блокируется, даже если целевой пользователь всё ещё
владеет вторым разрешением. Потеря последнего владельца `ManagePermissions`
невосстановима без прямого доступа к базе данных: bootstrap initial-admin
выполняется только один раз, для пустой таблицы `users`, а единственная
команда восстановления CLI — `password-reset-link`, которая возвращает доступ
к аккаунту, но не восстанавливает разрешения.

Self-revoke (снятие у самого себя `ManageUsers`/`ManagePermissions`) и
изменения peer-admin (снятие у другого активного администратора) обе
разрешены, если сохраняется описанный выше инвариант — отдельного уровня
администратора или дополнительного разрешения для этого нет. Admin UI требует
явного подтверждения перед отправкой любого изменения разрешений, независимо
от того, какие именно разрешения затронуты.

См. OXR-75 для полного анализа политики и OXR-77 для реализации.

### Восстановление пароля

Текущий сценарий восстановления пароля управляется администратором.

Правила:

```text
A user with ManageUsers can generate a password reset link for any active user.
The reset link is shown once in the admin UI.
The link is valid for 15 minutes.
Email delivery is not used in the current implementation.
After a successful password reset, all existing sessions for that user are invalidated.
```

Reset link предназначен для операционного восстановления в self-hosted окружениях, где SMTP ещё не настроен.

Если ни один администратор не может войти в систему, сгенерируйте ссылку
напрямую для существующей SQLite database, не запуская HTTP server:

```bash
cargo run -p oxiderelay-backend -- \
  --config backend/config.toml.example \
  password-reset-link --email admin@example.com
```

Команда использует обычный приоритет конфигурации базы данных, требует, чтобы
файл database уже существовал, и печатает относительный URL `/reset-password`,
который действителен 15 минут. Перед открытием добавьте к URL origin вашего
развёртывания. Рассматривайте вывод как парольный credential; генерация другой
ссылки для того же пользователя делает предыдущую недействительной.

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

# Доступ к проектам

Пользователи могут видеть только те проекты, которые им явно назначены.

Пример:

```text
John

Projects:
- HR Portal
- Mobile App
```

Доступ к проектам хранится отдельно от разрешений.

Владелец проекта автоматически получает доступ к проекту и может выполнять в
нём любые действия.

В MVP доступ владельца к проекту хранится в `user_project_access`.

Project-scoped и environment-scoped разрешения владельца остаются неявными и
не требуют глобального назначения этих разрешений.

John не может получить доступ ни к какому другому проекту в системе.

---

# Владелец проекта

Создатель проекта автоматически становится его владельцем.

Владелец проекта может:

* Управлять участниками проекта
* Выдавать доступ к проекту
* Управлять переводами проекта

Без необходимости иметь глобальные права администратора.

В MVP это реализовано как встроенное правило авторизации: внутри проекта,
которым он владеет, владелец считается имеющим все разрешения уровня проекта
и уровня environment.

Для пользователей, не являющихся владельцами, управление membership проекта
требует `ManageProjectMembers` внутри проекта, к которому у пользователя есть
доступ.

---

# REST API

Доставка переводов для backend-приложений.

Delivery endpoints по умолчанию публичны и не используют admin session authentication.
Их можно глобально отключить или защитить одним общим Bearer token для всего развёртывания.
Сгенерированный OpenAPI document доступен по `GET /api/openapi.json`.

---

# Runtime Configuration

Приоритет конфигурации:

```text
CLI arguments
→ environment variables
→ config.toml
→ built-in defaults
```

Поддерживаемые runtime settings:

```text
OXIDERELAY_HOST
OXIDERELAY_PORT
OXIDERELAY_DATABASE_PATH
OXIDERELAY_SESSION_COOKIE_NAME
OXIDERELAY_SESSION_TTL_HOURS
OXIDERELAY_SESSION_COOKIE_SECURE
OXIDERELAY_DELIVERY_PUBLIC_ENABLED
OXIDERELAY_DELIVERY_TOKEN
OXIDERELAY_BOOTSTRAP_ADMIN_EMAIL
OXIDERELAY_BOOTSTRAP_ADMIN_PASSWORD
OXIDERELAY_FRONTEND_DIST_PATH
```

Пример значений и базовой структуры конфигурации см. в `backend/config.toml.example`.

---

# Режимы запуска

OxideRelay можно запускать:

* через Docker Compose;
* как native Linux binary из release archive.

Container обслуживает и Admin UI по пути `/`, и API по пути `/api`.

---

# Модель доставки переводов

Delivery endpoints предназначены для чтения клиентскими приложениями и не
используют admin sessions. В MVP доступны следующие классы эндпоинтов:

* Delivery metadata под `/api/v1/projects/{project}/delivery-metadata`
* REST locale bundle delivery под `/api/v1/projects/{project}/locales/{locale}`
* Delivery manifest endpoints под `/api/v1/projects/{project}/delivery-manifest/{locale}`
* Static JSON delivery под `/static/{project}/{environment}/{locale}/{namespace}.json`

Ниже приведены типовые примеры запросов.

**Public, latest** (получение актуальной версии с повторной валидацией через `ETag`):

```bash
curl -i "https://relay.example.com/api/v1/projects/hr-portal/locales/ru?environment=production"
# -> 200 OK with ETag on the first response

# Revalidate using the ETag from the first response:
curl -i "https://relay.example.com/api/v1/projects/hr-portal/locales/ru?environment=production" \
  -H 'If-None-Match: "<etag-from-previous-response>"'
# -> 304 Not Modified if nothing changed
```

**Public, versioned** (привязка к известной версии контента для immutable caching).
Получите `<version>` из delivery manifest или из поля `version` в предыдущем
ответе:

```bash
curl -i "https://relay.example.com/api/v1/projects/hr-portal/locales/ru?environment=production&v=<version>"
# -> 200 with "Cache-Control: public, max-age=31536000, immutable" if <version> is current
# -> 404 Not Found if <version> is stale or invalid
```

**Bearer-token protected** (когда на развёртывании настроен `OXIDERELAY_DELIVERY_TOKEN`).
Тот же заголовок требуется на каждом delivery endpoint,
включая manifest и static JSON files:

```bash
curl -i "https://relay.example.com/api/v1/projects/hr-portal/locales/ru?environment=production" \
  -H "Authorization: Bearer <OXIDERELAY_DELIVERY_TOKEN>"
# -> 401 Unauthorized without the header when a token is configured
# -> "Cache-Control: private, ..." and "Vary: Authorization" on protected responses
```

---

# Модель безопасности

В MVP у OxideRelay есть два класса экспонирования:

* Admin UI и management APIs используют session authentication и предназначены для доверенных операторов.
* Delivery endpoints не используют admin sessions и по умолчанию либо публичны, либо глобально отключены, либо защищены одним общим Bearer token:
  * Delivery metadata под `/api/v1/projects/{project}/delivery-metadata`
  * REST locale bundle delivery под `/api/v1/projects/{project}/locales/{locale}`
  * Delivery manifest endpoints под `/api/v1/projects/{project}/delivery-manifest/{locale}`
  * Static JSON delivery под `/static/{project}/{environment}/{locale}/{namespace}.json`

У общего token нет project-level scopes, identity клиента, срока действия или
server-managed rotation. Считайте контент публичным, если token не настроен
или распространяется не только среди доверенных клиентов.

Приватные переводы не должны публиковаться в открытый интернет без HTTPS и без
общего delivery token либо reverse proxy/VPN-защиты перед OxideRelay.

Рекомендуемые меры развёртывания:

* Предпочтительно запускать OxideRelay во внутренней сети или приватной подсети.
* Если требуется внешний доступ, включите delivery token и TLS либо разместите OxideRelay за reverse proxy с authentication и TLS, либо за VPN.
* Ограничьте входящий доступ правилами firewall или security-group так, чтобы к сервису могли обращаться только доверенные пользователи и приложения.

---

# Развёртывание

OxideRelay спроектирован для простой установки и эксплуатации.

Рекомендуемый способ установки — Docker Compose:

```bash
cp .env.example .env
# edit .env and set initial administrator credentials
docker compose up -d
```

Стандартный [compose.yaml](compose.yaml) использует опубликованный image
`kpakozz96pyc/oxiderelay:latest`, хранит SQLite data в volume `oxiderelay-data`
и читает runtime settings из `.env`.

Каждый push git tag вида `vX.Y.Z` публикует соответствующий image
`kpakozz96pyc/oxiderelay:vX.Y.Z` (стабильные релизы также обновляют `:latest`).
Для предсказуемых и воспроизводимых обновлений фиксируйте `OXIDERELAY_IMAGE` в
`.env` на tag релиза вместо `:latest`, потому что `:latest` может измениться
между развёртываниями.

### Native Linux archive

Каждый release tag `vX.Y.Z` также публикует native Linux archive. Для запуска
конечным пользователям не нужен Node.js.

Archive содержит:

* `./oxiderelay-backend`
* `./frontend/dist`
* `./backend/config.toml.example`

Из корня распакованного archive:

```bash
cp backend/config.toml.example config.toml
mkdir -p data
# Replace the bootstrap_admin email and password in config.toml.
# The example password "change-me" is intentionally rejected.
./oxiderelay-backend --config config.toml
```

Запускайте binary из корня archive, чтобы `./frontend/dist` и
`./data/oxiderelay.sqlite` корректно разрешались. После первого успешного
запуска удалите bootstrap credentials из `config.toml`; они нужны только во
время создания initial administrator в пустой базе данных.

Container обслуживает и Admin UI по пути `/`, и API по пути `/api`.
Альтернативные варианты установки и запуска описаны выше в разделе `Режимы запуска`.

---

# MVP

## Управление локализацией

* Projects
* Languages
* Namespaces
* Translation CRUD
* Translation Import
* Translation Export
* Placeholder Validation (только предупреждение)

## Безопасность

* Users
* Permissions
* Project Access Control
* Environment Access Control

## Интеграции

* REST API
* Static JSON Delivery

## Хранилище

* SQLite

## Развёртывание

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

OxideRelay распространяется по лицензии MIT. Подробности см. в файле [LICENSE](LICENSE).
