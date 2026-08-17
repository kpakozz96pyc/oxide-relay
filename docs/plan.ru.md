# План реализации OxideRelay

## Принципы планирования

- Сначала реализовать backend, потому что frontend зависит от стабильных API-контрактов.
- Держать MVP в соответствии с `readme.md`, `architecture.md` и `database.md`.
- Поставлять систему вертикальными срезами, где каждый срез можно протестировать.
- Не добавлять функции вне MVP, такие как роли, журнал аудита, API keys или publishing workflows.

## Фаза 1: Инициализация проекта

### Задача 1.1: Инициализировать структуру репозитория
- Создать структуру рабочего пространства backend для Rust-сервиса.
- Создать структуру рабочего пространства frontend для React-приложения.
- Определить корневые каталоги для migrations, docs, scripts и deployment assets.
- Добавить `.gitignore`, конфигурацию форматирования и базовые файлы инструментов разработки.

### Задача 1.2: Настроить основу backend
- Инициализировать Rust-приложение с Axum, Tokio, SQLx, Serde, Tracing, Argon2 и Utoipa.
- Добавить загрузку конфигурации из переменных окружения, `config.toml` и аргументов CLI.
- Определить модели конфигурации для host, port, database path, session settings и bootstrap admin settings.
- Установить и задокументировать правило приоритета конфигурации, согласованное с задокументированными источниками конфигурации.

### Задача 1.3: Настроить основу frontend
- Инициализировать приложение React + TypeScript + Vite.
- Добавить React Router, TanStack Query и общие frontend-основы API/auth, используемые admin UI.
- Создать базовый layout, routing shell, слой API client и обработку auth state.

### Задача 1.4: Настроить workflow разработки
- Добавить команды для локального запуска, сборки и тестирования.
- Добавить Dockerfile и инструкции по локальному запуску для разработки.
- Задокументировать поток запуска backend и frontend.

## Фаза 2: База данных и хранение данных

### Задача 2.1: Создать SQLx migrations
- Реализовать migrations для `users`, `permissions`, `user_permissions`, `projects`, `user_project_access`, `languages`, `environments`, `namespaces`, `translation_keys`, `translation_values` и `sessions`.
- Добавить все необходимые индексы и уникальные ограничения из `database.md`.
- Убедиться, что внешние ключи и поведение удаления в точности соответствуют спецификации.

### Задача 2.2: Реализовать bootstrap базы данных
- Автоматически запускать migrations при старте.
- При первом запуске заполнить неизменяемый каталог permissions.
- Создать начального администратора, если пользователей ещё нет.
- Требовать `OXIDERELAY_ADMIN_EMAIL` и `OXIDERELAY_ADMIN_PASSWORD` только в случае bootstrap.

### Задача 2.3: Реализовать слой repositories
- Создать repositories для users, permissions, sessions, projects, memberships, languages, environments, namespaces, translation keys и translation values.
- Держать SQL изолированным в модулях repositories или файлах запросов.
- Нормализовать обработку ошибок базы данных в удобные для домена типы ошибок.

### Задача 2.4: Реализовать транзакционное создание проекта
- Создать одну транзакцию, которая вставляет проект.
- Назначить `owner_user_id`.
- Вставить membership владельца в `user_project_access`.
- Создать environments по умолчанию: `development`, `staging`, `production`.
- Создать namespace по умолчанию: `common`.

## Фаза 3: Аутентификация и авторизация

### Задача 3.1: Реализовать поток аутентификации
- Создать endpoint входа с использованием email и password.
- Проверять passwords с помощью Argon2.
- Создавать server-side sessions, хранящиеся в таблице `sessions`.
- Выдавать HTTP-only session cookies.
- Реализовать endpoints выхода и текущего пользователя.

### Задача 3.2: Реализовать middleware сессий
- Разрешать session из cookie.
- Загружать текущего пользователя и отклонять неактивных пользователей.
- Прикреплять контекст аутентифицированного пользователя к request extensions.

### Задача 3.3: Реализовать механизм авторизации
- Поддержать прямые проверки permissions с использованием seeded permission codes.
- Поддержать проверки доступа к проекту через `user_project_access`.
- Поддержать неявные привилегии владельца проекта внутри принадлежащих ему проектов.
- Поддержать проверки permissions, зависящих от environment, такие как `EditAll` и `EditProd`.
- Соблюдать порядок авторизации, определённый в `architecture.md`.

### Задача 3.4: Реализовать переиспользуемые guards авторизации
- Создать route guards для доступа только аутентифицированных пользователей.
- Создать guards permissions в рамках проекта.
- Создать guards для translation environment.
- Переиспользовать guards последовательно во всех endpoints admin API.

## Фаза 4: Основные ресурсы Admin API

### Задача 4.1: Реализовать endpoints проектов
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{project_slug}`
- `PUT /api/v1/projects/{project_slug}`
- `DELETE /api/v1/projects/{project_slug}`
- Убедиться, что endpoint списка возвращает только принадлежащие пользователю и назначенные ему проекты.

### Задача 4.2: Реализовать endpoints языков
- `GET /api/v1/projects/{project_slug}/languages`
- `POST /api/v1/projects/{project_slug}/languages`
- `DELETE /api/v1/projects/{project_slug}/languages/{language_code}`
- Обеспечить уникальность в рамках проекта и добавить валидацию ввода в соответствии с моделью данных MVP.

### Задача 4.3: Реализовать endpoints namespaces
- `GET /api/v1/projects/{project_slug}/namespaces`
- `POST /api/v1/projects/{project_slug}/namespaces`
- `DELETE /api/v1/projects/{project_slug}/namespaces/{namespace}`
- Защититься от дублирования имён namespace в рамках проекта.

### Задача 4.4: Реализовать endpoints environments
- `GET /api/v1/projects/{project_slug}/environments`
- `POST /api/v1/projects/{project_slug}/environments`
- `DELETE /api/v1/projects/{project_slug}/environments/{environment_slug}`
- Обеспечить уникальность `environment_slug` в рамках проекта.

## Фаза 5: Управление переводами

### Задача 5.1: Спроектировать модели запросов для переводов
- Определить модели запросов так, чтобы параметры маршрута, query parameters и request bodies соответствовали задокументированной форме API.
- Держать translation keys локальными для namespace и никогда не хранить keys с префиксом namespace.
- Валидировать ввод на пустые значения, недопустимые identifiers и дубликаты.

### Задача 5.2: Реализовать CRUD endpoints для переводов
- `GET /api/v1/projects/{project_slug}/translations`
- `POST /api/v1/projects/{project_slug}/translations`
- `PUT /api/v1/projects/{project_slug}/translations/{translation_value_id}`
- `DELETE /api/v1/projects/{project_slug}/translations/{translation_value_id}`
- Держать операции записи ориентированными на значения вокруг `translation_values.id`.

### Задача 5.3: Реализовать логику запросов переводов
- Явно разрешать запрошенный environment из query или payload.
- Объединять translation values с translation keys, namespaces, languages и environments.
- Возвращать стабильные модели ответов для admin UI.
- Сохранять уникальность в базе данных по `(translation_key_id, language_id, environment_id)`.

### Задача 5.4: Реализовать импорт и экспорт
- `POST /api/v1/projects/{project_slug}/imports/json`
- `GET /api/v1/projects/{project_slug}/exports/json`
- Импортировать только local namespace keys.
- Создавать отсутствующие `translation_keys` во время импорта.
- Выполнять upsert в `translation_values` и обновлять `updated_by_user_id` и `updated_at`.

## Фаза 6: Пользователи, permissions и участие в проектах

### Задача 6.1: Реализовать endpoints управления пользователями
- `GET /api/v1/users`
- `POST /api/v1/users`
- `PUT /api/v1/users/{id}`
- `DELETE /api/v1/users/{id}`
- Поддержать управление состоянием active/inactive.

### Задача 6.2: Реализовать endpoints управления permissions
- `GET /api/v1/permissions`
- `GET /api/v1/users/{id}/permissions`
- `PUT /api/v1/users/{id}/permissions`
- Ограничить систему seeded immutable catalog permissions.

### Задача 6.3: Реализовать endpoints участия в проектах
- `GET /api/v1/projects/{project_slug}/members`
- `POST /api/v1/projects/{project_slug}/members`
- `DELETE /api/v1/projects/{project_slug}/members/{user_id}`
- Управлять только `user_project_access`.
- Не вводить никакой API для membership на уровне environment.

## Фаза 7: Публичная доставка переводов

### Задача 7.1: Реализовать REST endpoint доставки
- `GET /api/v1/projects/{project_slug}/locales/{language_code}?environment={environment_slug}`
- В MVP сделать endpoint публичным.
- Возвращать переводы из всех namespaces как плоский объект.
- Формировать ключи ответа как `{namespace}.{key}`.

### Задача 7.2: Реализовать endpoint статического JSON
- `GET /static/{project_slug}/{environment_slug}/{language_code}/{namespace}.json`
- В MVP сделать endpoint публичным.
- Возвращать один namespace на файл.
- Возвращать keys без префикса namespace.
- Применять короткое кэширование с revalidation для URL без версии и immutable-кэширование для URL с версией.

### Задача 7.3: Оптимизировать запросы доставки
- Добавить эффективные lookup queries, использующие запланированные индексы.
- Убедиться, что ответы детерминированы и последовательно отсортированы.
- Держать сериализацию лёгкой для frontend- и backend-потребителей.

## Фаза 8: Качество API, валидация и документация

### Задача 8.1: Стандартизировать ответы об ошибках
- Реализовать общий формат ошибок API.
- Сопоставить случаи валидации, аутентификации, авторизации, not-found и conflict со стабильными ответами.
- Сохранять payload ошибок согласованными между admin и delivery endpoints там, где это уместно.

### Задача 8.2: Добавить валидацию ввода
- Валидировать формат email, обязательные поля и поля identifiers, используемые API.
- Отклонять keys с префиксом namespace там, где требуются local keys.
- Валидировать query parameters environment в endpoints переводов.

### Задача 8.3: Сгенерировать документацию OpenAPI
- Задокументировать все endpoints admin и публичные endpoints доставки.
- Включить схемы запросов и ответов.
- Открыть доступ к API docs из backend-сервиса.

## Фаза 9: Frontend Admin UI

### Задача 9.1: Реализовать экраны аутентификации
- Создать форму входа и поток восстановления session.
- Перенаправлять неаутентифицированных пользователей на login.
- Корректно обрабатывать logout и истечение срока session.

### Задача 9.2: Реализовать навигацию по проекту
- Создать представление списка проектов, показывающее принадлежащие пользователю и назначенные ему проекты.
- Добавить страницу деталей проекта с поднавигацией для languages, namespaces, environments, members и translations.

### Задача 9.3: Реализовать UI управления переводами
- Создать таблицу переводов с фильтрами по environment, language и namespace.
- Добавить потоки создания, редактирования и удаления translation values.
- Ясно отображать namespace-local keys, чтобы избежать путаницы с доставляемыми плоскими keys.

### Задача 9.4: Реализовать вспомогательные admin-экраны
- Экран управления users.
- Экран управления direct permissions.
- Экран управления участниками проекта.
- Экраны управления languages, namespaces и environments.
- Действия импорта и экспорта для JSON-файлов.

### Задача 9.5: Интегрировать поведение permissions во frontend
- Статус: Завершено
- Скрывать или отключать действия, которые текущий пользователь не может выполнять.
- Сохранять backend-авторизацию как источник истины.
- Показывать понятные ошибки, когда запросы запрещены.

## Фаза 10: Тестирование и повышение надёжности

### Задача 10.1: Добавить backend unit tests
- Статус: Завершено
- Тестировать логику разрешения permissions.
- Тестировать поведение неявного доступа владельца.
- Тестировать валидацию slug и key.
- Тестировать поведение импорта и экспорта.

### Задача 10.2: Добавить backend integration tests
- Статус: Завершено
- Сквозным образом тестировать auth flows.
- Тестировать защищённые admin routes.
- Тестировать поведение транзакции создания проекта.
- Тестировать публичные endpoints доставки.

### Задача 10.3: Добавить frontend tests
- Статус: Завершено
- Тестировать auth flow, защиту маршрутов и ключевые состояния UI.
- Тестировать взаимодействия в управлении переводами.
- Тестировать gating UI на основе permissions.

### Задача 10.4: Добавить smoke checks
- Статус: Завершено
- Проверить запуск приложения с bootstrap пустой базы данных.
- Проверить запуск при наличии существующих пользователей и без переменных bootstrap admin.
- Проверить Dockerized path запуска и поведение сохраняемого файла SQLite.

## Фаза 11: Развёртывание и эксплуатация

### Задача 11.1: Финализировать runtime-конфигурацию
- Статус: Завершено
- Поддержать конфигурацию host, port и database path.
- Определить настройки session cookie для локальной и развёрнутой сред.
- Задокументировать обязательные и опциональные настройки.

### Задача 11.2: Финализировать контейнерную упаковку
- Статус: Завершено
- Собрать production Docker image.
- Обеспечить записываемый путь данных для хранения SQLite.
- Открыть правильный port и команду запуска.

### Задача 11.3: Подготовить операционную документацию
- Статус: Завершено
- Задокументировать процедуру bootstrap.
- Задокументировать стратегию backup и restore для SQLite.
- Задокументировать поведение migrations и ожидания при обновлении.

## Текущая оставшаяся работа

- Для плана MVP не осталось открытых задач реализации.

## Рекомендуемый порядок выполнения

1. Завершить Фазу 1 и Фазу 2.
2. Завершить Фазу 3 до открытия любых admin routes.
3. Завершить Фазу 4, Фазу 5 и Фазу 6 как основу backend MVP.
4. Завершить Фазу 7 и Фазу 8, чтобы стабилизировать поведение публичного API.
5. Завершить Фазу 9, когда backend-контракты перестанут меняться.
6. Завершить Фазу 10 и Фазу 11, прежде чем считать MVP готовым.

## Критерии выхода MVP

- Новый экземпляр может самостоятельно выполнить bootstrap с SQLite migrations и начальным администратором.
- Аутентифицированные пользователи могут управлять проектами, участниками, языками, namespaces, environments и переводами в соответствии с моделью permissions.
- Владельцы проектов могут полностью управлять своими проектами без глобальных прав администратора.
- Публичные endpoints доставки отдают корректные payload переводов для backend- и frontend-потребителей.
- Импорт и экспорт JSON работают с namespace-local keys.
- Admin UI покрывает все потоки управления MVP.
- Развёртывание через Docker работает с постоянным хранилищем SQLite.
