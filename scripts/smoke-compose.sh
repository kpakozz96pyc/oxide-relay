#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_ENV_FILE="${ROOT_DIR}/.env.example"
RUNTIME_ENV_FILE="${ROOT_DIR}/.env"
RUNTIME_ENV_BACKUP=""
RUNTIME_ENV_PREPARED=0
STACK_STARTED=0
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-oxiderelay-smoke}"
export COMPOSE_PROJECT_NAME
export OXIDERELAY_IMAGE="${OXIDERELAY_IMAGE:-oxiderelay:smoke}"
export OXIDERELAY_PUBLISHED_PORT="${OXIDERELAY_PUBLISHED_PORT:-18080}"
export OXIDERELAY_ADMIN_EMAIL="${OXIDERELAY_ADMIN_EMAIL:-admin@example.com}"
export OXIDERELAY_ADMIN_PASSWORD="${OXIDERELAY_ADMIN_PASSWORD:-change-me}"

BASE_URL="http://127.0.0.1:${OXIDERELAY_PUBLISHED_PORT}"
PROJECT_NAME="${PROJECT_NAME:-Smoke Project}"
PROJECT_SLUG="${PROJECT_SLUG:-smoke-project}"
TRANSLATION_KEY="${TRANSLATION_KEY:-app.title}"
TRANSLATION_VALUE="${TRANSLATION_VALUE:-Oxide Relay Smoke}"
COOKIE_JAR="$(mktemp)"
BODY_FILE="$(mktemp)"

COMPOSE_CMD=(docker compose --env-file "${RUNTIME_ENV_FILE}" -f "${ROOT_DIR}/compose.yaml")

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

prepare_runtime_env_file() {
  [ -f "${EXAMPLE_ENV_FILE}" ] || {
    echo "Missing env template: ${EXAMPLE_ENV_FILE}" >&2
    exit 1
  }

  if [ -f "${RUNTIME_ENV_FILE}" ]; then
    RUNTIME_ENV_BACKUP="$(mktemp)"
    cp "${RUNTIME_ENV_FILE}" "${RUNTIME_ENV_BACKUP}"
  fi

  cp "${EXAMPLE_ENV_FILE}" "${RUNTIME_ENV_FILE}"
  RUNTIME_ENV_PREPARED=1
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ "${STACK_STARTED}" -eq 1 ]; then
    echo "Smoke test failed. Docker Compose logs:" >&2
    "${COMPOSE_CMD[@]}" logs --no-color || true
  fi
  if [ "${STACK_STARTED}" -eq 1 ]; then
    "${COMPOSE_CMD[@]}" down -v --remove-orphans || true
  fi
  if [ "${RUNTIME_ENV_PREPARED}" -eq 1 ]; then
    if [ -n "${RUNTIME_ENV_BACKUP}" ] && [ -f "${RUNTIME_ENV_BACKUP}" ]; then
      mv "${RUNTIME_ENV_BACKUP}" "${RUNTIME_ENV_FILE}" || true
    else
      rm -f "${RUNTIME_ENV_FILE}"
    fi
  fi
  rm -f "${COOKIE_JAR}" "${BODY_FILE}"
}
trap cleanup EXIT

require_cmd curl
require_cmd docker
require_cmd python3
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose plugin is required." >&2
  exit 1
}

cd "${ROOT_DIR}"

echo "Preparing compose env file..."
prepare_runtime_env_file

echo "Building local image ${OXIDERELAY_IMAGE}..."
docker build -f deploy/Dockerfile -t "${OXIDERELAY_IMAGE}" .

echo "Resetting compose project ${COMPOSE_PROJECT_NAME}..."
"${COMPOSE_CMD[@]}" down -v --remove-orphans || true

echo "Starting Docker Compose stack..."
STACK_STARTED=1
"${COMPOSE_CMD[@]}" up -d

echo "Waiting for health endpoint..."
for attempt in $(seq 1 60); do
  http_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' "${BASE_URL}/api/health" || true)"
  if [ "${http_code}" = "200" ]; then
    python3 - "${BODY_FILE}" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
assert body["status"] == "ok", body
assert body["database"] == "ok", body
PY
    echo "Health check passed."
    break
  fi

  if [ "${attempt}" -eq 60 ]; then
    echo "Timed out waiting for ${BASE_URL}/api/health" >&2
    exit 1
  fi

  sleep 2
done

echo "Logging in as bootstrap admin..."
login_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  -c "${COOKIE_JAR}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${OXIDERELAY_ADMIN_EMAIL}\",\"password\":\"${OXIDERELAY_ADMIN_PASSWORD}\"}" \
  "${BASE_URL}/api/v1/auth/login")"
[ "${login_code}" = "200" ] || {
  echo "Login failed with HTTP ${login_code}" >&2
  cat "${BODY_FILE}" >&2
  exit 1
}
python3 - "${BODY_FILE}" "${OXIDERELAY_ADMIN_EMAIL}" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
assert body["user"]["email"] == sys.argv[2], body
PY

echo "Creating project ${PROJECT_SLUG}..."
project_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  -b "${COOKIE_JAR}" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"${PROJECT_NAME}\",\"slug\":\"${PROJECT_SLUG}\",\"description\":\"Docker Compose smoke test project\"}" \
  "${BASE_URL}/api/v1/projects")"
[ "${project_code}" = "201" ] || {
  echo "Project creation failed with HTTP ${project_code}" >&2
  cat "${BODY_FILE}" >&2
  exit 1
}
python3 - "${BODY_FILE}" "${PROJECT_SLUG}" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
assert body["slug"] == sys.argv[2], body
PY

echo "Verifying default project bootstrap data..."
languages_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  -b "${COOKIE_JAR}" \
  "${BASE_URL}/api/v1/projects/${PROJECT_SLUG}/languages")"
[ "${languages_code}" = "200" ] || {
  echo "Listing languages failed with HTTP ${languages_code}" >&2
  cat "${BODY_FILE}" >&2
  exit 1
}
python3 - "${BODY_FILE}" <<'PY'
import json, sys
items = json.load(open(sys.argv[1], encoding="utf-8"))
codes = {item["code"] for item in items}
assert "en" in codes, items
PY

namespaces_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  -b "${COOKIE_JAR}" \
  "${BASE_URL}/api/v1/projects/${PROJECT_SLUG}/namespaces")"
[ "${namespaces_code}" = "200" ] || {
  echo "Listing namespaces failed with HTTP ${namespaces_code}" >&2
  cat "${BODY_FILE}" >&2
  exit 1
}
python3 - "${BODY_FILE}" <<'PY'
import json, sys
items = json.load(open(sys.argv[1], encoding="utf-8"))
names = {item["name"] for item in items}
assert "common" in names, items
PY

environments_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  -b "${COOKIE_JAR}" \
  "${BASE_URL}/api/v1/projects/${PROJECT_SLUG}/environments")"
[ "${environments_code}" = "200" ] || {
  echo "Listing environments failed with HTTP ${environments_code}" >&2
  cat "${BODY_FILE}" >&2
  exit 1
}
python3 - "${BODY_FILE}" <<'PY'
import json, sys
items = json.load(open(sys.argv[1], encoding="utf-8"))
slugs = {item["slug"] for item in items}
expected = {"development", "staging", "production"}
assert expected.issubset(slugs), items
PY

echo "Creating translation value..."
translation_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  -b "${COOKIE_JAR}" \
  -H 'Content-Type: application/json' \
  -d "{\"environment\":\"production\",\"language\":\"en\",\"namespace\":\"common\",\"key\":\"${TRANSLATION_KEY}\",\"value\":\"${TRANSLATION_VALUE}\"}" \
  "${BASE_URL}/api/v1/projects/${PROJECT_SLUG}/translations")"
[ "${translation_code}" = "201" ] || {
  echo "Translation creation failed with HTTP ${translation_code}" >&2
  cat "${BODY_FILE}" >&2
  exit 1
}
python3 - "${BODY_FILE}" "${TRANSLATION_KEY}" "${TRANSLATION_VALUE}" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
assert body["key"] == sys.argv[2], body
assert body["value"] == sys.argv[3], body
assert body["namespace"] == "common", body
assert body["language_code"] == "en", body
assert body["environment_slug"] == "production", body
PY

echo "Verifying static JSON endpoint..."
static_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  "${BASE_URL}/static/${PROJECT_SLUG}/production/en/common.json")"
[ "${static_code}" = "200" ] || {
  echo "Static JSON fetch failed with HTTP ${static_code}" >&2
  cat "${BODY_FILE}" >&2
  exit 1
}
python3 - "${BODY_FILE}" "${TRANSLATION_KEY}" "${TRANSLATION_VALUE}" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
expected = {sys.argv[2]: sys.argv[3]}
assert body == expected, body
PY

echo "Docker Compose smoke test passed."
