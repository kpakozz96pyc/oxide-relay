# Remote Testing Guide

## Goal

This document explains how another agent can validate OxideRelay on a different machine with minimal project context.

The target is to confirm:

1. The backend starts with a fresh SQLite database.
2. The frontend can authenticate and operate against the backend.
3. Core MVP translation workflows work.
4. Existing-database startup works without bootstrap admin variables.
5. Docker packaging works with persistent SQLite storage.

## Repository Layout

- `backend/` - Rust backend service
- `frontend/` - React + Vite admin UI
- `migrations/` - SQLx migrations
- `compose.yaml` - preferred local container startup path
- `.env.example` - example runtime configuration for Docker Compose
- `deploy/Dockerfile` - production container image
- `deploy/OPERATIONS.md` - runtime and operational notes
- `backend/config.toml.example` - local example config

## Prerequisites

Install:

- Rust toolchain
- Node.js 20+ and npm
- Docker

Recommended checks:

```bash
rustc --version
cargo --version
node --version
npm --version
docker --version
```

## Local Setup

Clone the repository and install frontend dependencies:

```bash
cd OxideRelay
cd frontend
npm install
cd ..
```

## Backend Startup: Fresh Database

Use a new SQLite path and bootstrap admin credentials.

Example:

```bash
export OXIDERELAY_HOST=127.0.0.1
export OXIDERELAY_PORT=8080
export OXIDERELAY_DATABASE_PATH=./data/oxiderelay.sqlite
export OXIDERELAY_ADMIN_EMAIL=admin@example.com
export OXIDERELAY_ADMIN_PASSWORD=change-me

cargo run -p oxiderelay-backend
```

Expected result:

- service starts successfully
- migrations run automatically
- initial admin is bootstrapped
- `GET /api/health` returns:

```json
{"status":"ok","database":"ok"}
```

## Frontend Startup

In another terminal:

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:5173/
```

Default login for local smoke:

```text
email:    admin@example.com
password: change-me
```

## Automated Validation

Run the existing automated checks:

```bash
cargo test -p oxiderelay-backend
cd frontend && npm test && npm run build
```

Expected result:

- backend unit and integration tests pass
- frontend test suite passes
- frontend production build passes

## Docker Compose Startup

The preferred container startup path uses the published Docker Hub image.

```bash
cp .env.example .env
docker compose up -d
```

If port `8080` is already busy on the host, change `OXIDERELAY_PUBLISHED_PORT`
in `.env` before starting the stack.

Expected result:

- container starts successfully
- `GET http://127.0.0.1:<published-port>/api/health` returns `ok`
- SQLite files are written into the Compose-managed volume

## Manual Test Scenarios

### Scenario 1: Authentication

Steps:

1. Open the frontend login page.
2. Sign in with the bootstrap admin.
3. Confirm redirect to `/projects`.
4. Refresh the page.
5. Confirm session restore still works.
6. Sign out.

Expected result:

- login succeeds
- session persists across refresh
- logout returns to login page

### Scenario 2: Project Creation

Steps:

1. Sign in as admin.
2. Create a project, for example:
   - name: `Demo Project`
   - slug: `demo-project`
3. Open the created project.

Expected result:

- project appears in the projects list
- project workspace opens
- default environments exist:
  - `development`
  - `staging`
  - `production`
- default namespace `common` exists

### Scenario 3: Translation Management

Steps:

1. In the project workspace add a language:
   - `en` / `English`
2. Select:
   - environment: `production`
   - language: `en`
   - namespace: `common`
3. Create a translation:
   - key: `app.title`
   - value: `Oxide Relay`
4. Import JSON:

```json
{
  "cta.save": "Save",
  "cta.cancel": "Cancel"
}
```

Expected result:

- all created/imported translations appear in the table
- edit and delete actions work for authorized users

### Scenario 4: Delivery Endpoints

Use the project from Scenario 3.

Static namespace JSON:

```text
GET /static/demo-project/production/en/common.json
```

Expected payload:

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

Expected shape:

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

### Scenario 5: Users and Permissions

Steps:

1. Open the `Users` workspace as admin.
2. Create a non-owner user.
3. Assign a limited direct permission set, for example:
   - `ViewProjects`
   - `ReadTranslations`
   - `ReadProduction`
4. Add that user to the project as a member.
5. Sign in as that member.

Expected result:

- member can access the assigned project
- member cannot perform owner-only or edit actions
- UI disables restricted actions
- backend still enforces authorization if a forbidden request is attempted

### Scenario 6: Existing Database Startup Without Bootstrap Variables

Steps:

1. Start the backend once with bootstrap admin variables.
2. Stop it.
3. Keep the same SQLite file.
4. Unset:
   - `OXIDERELAY_ADMIN_EMAIL`
   - `OXIDERELAY_ADMIN_PASSWORD`
5. Start the backend again.

Expected result:

- backend starts successfully
- no bootstrap admin values are required
- existing users can still authenticate

### Scenario 7: Docker Build and Run

Build:

```bash
docker build -f deploy/Dockerfile -t oxiderelay:local .
```

Run:

```bash
docker run \
  --name oxiderelay-test \
  -p 8080:8080 \
  -e OXIDERELAY_ADMIN_EMAIL=admin@example.com \
  -e OXIDERELAY_ADMIN_PASSWORD=change-me \
  -v oxiderelay-data:/data \
  oxiderelay:local
```

Expected result:

- container starts
- `GET http://127.0.0.1:8080/api/health` returns `ok`
- SQLite files are written under `/data`

This scenario validates the source-build path. For the default published-image path,
prefer the Docker Compose startup described earlier in this document.

Restart check:

1. Stop and remove the container.
2. Start it again with the same volume, but without bootstrap variables.

Expected result:

- container starts against the existing database
- health check remains `ok`

## Quick API Smoke Commands

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

## Failure Signals

Treat these as regressions:

- backend requires bootstrap admin variables on an existing database
- frontend cannot restore session after refresh
- `common` namespace or default environments are missing for a new project
- delivery endpoints return wrong key shapes
- member users can mutate translations without required permissions
- Docker image builds but container cannot start or cannot persist SQLite data

## Deliverable for the Other Agent

The other agent should report:

1. Which scenarios passed
2. Which scenarios failed
3. Exact failing command, endpoint, or UI action
4. Relevant logs or error payloads
5. Whether the failure is reproducible on a clean rerun
