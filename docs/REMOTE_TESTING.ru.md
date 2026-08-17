# Руководство по удалённому тестированию

## Цель

Этот документ объясняет, как другой агент может проверить OxideRelay на другой машине с минимальным контекстом проекта.

Цель — подтвердить, что:

1. backend запускается с новой базой данных SQLite.
2. frontend может аутентифицироваться и работать с backend.
3. Работают основные MVP-сценарии управления переводами.
4. Запуск с существующей базой данных работает без bootstrap-переменных администратора.
5. Docker-упаковка работает с постоянным хранилищем SQLite.

## Структура репозитория

- `backend/` - backend-сервис на Rust
- `frontend/` - административный UI на React + Vite
- `migrations/` - SQLx-миграции
- `compose.yaml` - предпочтительный локальный путь запуска контейнеров
- `.env.example` - пример конфигурации окружения для Docker Compose
- `deploy/Dockerfile` - production-образ контейнера
- `deploy/OPERATIONS.md` - заметки по runtime и эксплуатации
- `backend/config.toml.example` - локальный пример конфигурации

## Предварительные требования

Установите:

- Rust toolchain
- Node.js 20+ и npm
- Docker

Рекомендуемые проверки:

```bash
rustc --version
cargo --version
node --version
npm --version
docker --version
```

## Локальная настройка

Склонируйте репозиторий и установите зависимости frontend:

```bash
cd OxideRelay
cd frontend
npm install
cd ..
```

## Запуск backend: новая база данных

Используйте новый путь SQLite и bootstrap-учётные данные администратора.

Пример:

```bash
export OXIDERELAY_HOST=127.0.0.1
export OXIDERELAY_PORT=8080
export OXIDERELAY_DATABASE_PATH=./data/oxiderelay.sqlite
export OXIDERELAY_ADMIN_EMAIL=admin@example.com
export OXIDERELAY_ADMIN_PASSWORD=change-me

cargo run -p oxiderelay-backend
```

Ожидаемый результат:

- сервис успешно запускается
- миграции выполняются автоматически
- initial admin создаётся через bootstrap
- `GET /api/health` возвращает:

```json
{"status":"ok","database":"ok"}
```

## Запуск frontend

В другом терминале:

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Откройте:

```text
http://127.0.0.1:5173/
```

Логин по умолчанию для локальной smoke-проверки:

```text
email:    admin@example.com
password: change-me
```

## Автоматическая проверка

Запустите существующие автоматические проверки:

```bash
cargo test -p oxiderelay-backend
cd frontend && npm test && npm run build
```

Ожидаемый результат:

- проходят unit- и integration-тесты backend
- проходит набор тестов frontend
- проходит production-сборка frontend

## Запуск через Docker Compose

Предпочтительный путь запуска контейнеров использует опубликованный образ из Docker Hub.

```bash
cp .env.example .env
docker compose up -d
```

Если порт `8080` уже занят на хосте, измените `OXIDERELAY_PUBLISHED_PORT`
в `.env` перед запуском стека.

Ожидаемый результат:

- контейнер успешно запускается
- `GET http://127.0.0.1:<published-port>/api/health` возвращает `ok`
- файлы SQLite записываются в volume, управляемый Compose

## Сценарии ручного тестирования

### Сценарий 1: Аутентификация

Шаги:

1. Откройте страницу входа frontend.
2. Войдите с bootstrap-учётной записью администратора.
3. Подтвердите перенаправление на `/projects`.
4. Обновите страницу.
5. Подтвердите, что восстановление сессии по-прежнему работает.
6. Выйдите из системы.

Ожидаемый результат:

- вход выполняется успешно
- сессия сохраняется после обновления страницы
- выход возвращает на страницу входа

### Сценарий 2: Создание проекта

Шаги:

1. Войдите как администратор.
2. Создайте проект, например:
   - name: `Demo Project`
   - slug: `demo-project`
3. Откройте созданный проект.

Ожидаемый результат:

- проект появляется в списке проектов
- открывается рабочее пространство проекта
- существуют окружения по умолчанию:
  - `development`
  - `staging`
  - `production`
- существует namespace `common` по умолчанию

### Сценарий 3: Управление переводами

Шаги:

1. В рабочем пространстве проекта добавьте язык:
   - `en` / `English`
2. Выберите:
   - environment: `production`
   - language: `en`
   - namespace: `common`
3. Создайте перевод:
   - key: `app.title`
   - value: `Oxide Relay`
4. Импортируйте JSON:

```json
{
  "cta.save": "Save",
  "cta.cancel": "Cancel"
}
```

Ожидаемый результат:

- все созданные и импортированные переводы появляются в таблице
- действия редактирования и удаления работают для авторизованных пользователей

### Сценарий 4: Endpoints выдачи

Используйте проект из Сценария 3.

Статический JSON namespace:

```text
GET /static/demo-project/production/en/common.json
```

Ожидаемый payload:

```json
{
  "app.title": "Oxide Relay",
  "cta.cancel": "Cancel",
  "cta.save": "Save"
}
```

Locale bundle:

```text
GET /api/v1/projects/demo-project/locales/en?environment=production
```

Ожидаемая структура:

```json
{
  "project": "demo-project",
  "locale": "en",
  "environment": "production",
  "values": {
    "common.app.title": "Oxide Relay"
  }
}
```

### Сценарий 5: Пользователи и разрешения

Шаги:

1. Откройте рабочее пространство `Users` как администратор.
2. Создайте пользователя без прав owner.
3. Назначьте ограниченный набор прямых разрешений, например:
   - `ViewProjects`
   - `ReadTranslations`
4. Добавьте этого пользователя в проект как участника.
5. Войдите как этот участник.

Ожидаемый результат:

- участник может получить доступ к назначенному проекту
- участник не может выполнять owner-only или редактирующие действия
- UI отключает ограниченные действия
- backend по-прежнему применяет авторизацию при попытке запрещённого запроса

### Сценарий 6: Запуск с существующей базой данных без bootstrap-переменных

Шаги:

1. Один раз запустите backend с bootstrap-переменными администратора.
2. Остановите его.
3. Сохраните тот же файл SQLite.
4. Уберите:
   - `OXIDERELAY_ADMIN_EMAIL`
   - `OXIDERELAY_ADMIN_PASSWORD`
5. Снова запустите backend.

Ожидаемый результат:

- backend успешно запускается
- bootstrap-значения администратора больше не требуются
- существующие пользователи по-прежнему могут аутентифицироваться

### Сценарий 7: Сборка и запуск Docker

Сборка:

```bash
docker build -f deploy/Dockerfile -t oxiderelay:local .
```

Запуск:

```bash
docker run \
  --name oxiderelay-test \
  -p 8080:8080 \
  -e OXIDERELAY_ADMIN_EMAIL=admin@example.com \
  -e OXIDERELAY_ADMIN_PASSWORD=change-me \
  -v oxiderelay-data:/data \
  oxiderelay:local
```

Ожидаемый результат:

- контейнер запускается
- `GET http://127.0.0.1:8080/api/health` возвращает `ok`
- файлы SQLite записываются в `/data`

Этот сценарий проверяет путь сборки из исходников. Для пути по умолчанию с опубликованным образом
предпочтителен запуск через Docker Compose, описанный ранее в этом документе.

Проверка перезапуска:

1. Остановите и удалите контейнер.
2. Запустите его снова с тем же volume, но без bootstrap-переменных.

Ожидаемый результат:

- контейнер запускается с существующей базой данных
- health check остаётся `ok`

## Быстрые smoke-команды API

Health:

```bash
curl -sS http://127.0.0.1:8080/api/health
```

Login:

```bash
curl -sS -c /tmp/oxide.cookies \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me"}' \
  http://127.0.0.1:8080/api/v1/auth/login
```

Current user:

```bash
curl -sS -b /tmp/oxide.cookies \
  http://127.0.0.1:8080/api/v1/me
```

Current direct permissions:

```bash
curl -sS -b /tmp/oxide.cookies \
  http://127.0.0.1:8080/api/v1/me/permissions
```

Projects:

```bash
curl -sS -b /tmp/oxide.cookies \
  http://127.0.0.1:8080/api/v1/projects
```

## Признаки сбоя

Считайте это регрессиями:

- backend требует bootstrap-переменные администратора при работе с существующей базой данных
- frontend не может восстановить сессию после обновления страницы
- для нового проекта отсутствуют namespace `common` или окружения по умолчанию
- endpoints выдачи возвращают неправильную форму ключей
- пользователи-участники могут изменять переводы без необходимых разрешений
- Docker-образ собирается, но контейнер не может запуститься или не может сохранять данные SQLite

## Что должен предоставить другой агент

Другой агент должен сообщить:

1. Какие сценарии прошли
2. Какие сценарии не прошли
3. Точную команду, endpoint или действие в UI, которое завершается ошибкой
4. Соответствующие логи или payload ошибки
5. Воспроизводится ли сбой при чистом повторном запуске
