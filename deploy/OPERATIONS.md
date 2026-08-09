# Operations Runbook

## Bootstrap

The backend boot flow is:

1. Load configuration from CLI, environment, config file, and defaults.
2. Open or create the SQLite database file.
3. Run SQLx migrations automatically.
4. Seed the immutable permission catalog.
5. Create the initial administrator only when the `users` table is empty.

Bootstrap admin credentials are required only for the empty-database case:

```text
OXIDERELAY_ADMIN_EMAIL
OXIDERELAY_ADMIN_PASSWORD
```

If at least one user already exists, the service starts without those variables.

## Offline Password Recovery

If no administrator can sign in, the backend binary can generate a one-time
password reset link without starting the HTTP server. Point it at the same
existing SQLite database used by the deployment:

```bash
./target/release/oxiderelay-backend \
  --config backend/config.toml.example \
  password-reset-link --email admin@example.com
```

For the default Compose deployment, run the installed binary in a temporary
container attached to the same data volume:

```bash
docker compose run --rm oxiderelay \
  oxiderelay password-reset-link --email admin@example.com
```

The command uses the normal `--database-path`, `OXIDERELAY_DATABASE_PATH`, and
config-file precedence. It refuses to create a missing database, accepts only
an active user's email, and replaces any previous unused link for that user.
The printed URL is relative to the deployment origin and expires after 15
minutes. Do not store the URL in shell history, logs, tickets, or chat.

## Session Settings

Relevant settings:

```text
OXIDERELAY_SESSION_COOKIE_NAME
OXIDERELAY_SESSION_TTL_HOURS
OXIDERELAY_SESSION_COOKIE_SECURE
```

Recommended values:

```text
local development: cookie_secure=false
HTTPS production:  cookie_secure=true
```

## Delivery Access

Delivery access is controlled independently from admin sessions:

```text
OXIDERELAY_PUBLIC_DELIVERY_ENABLED=true
OXIDERELAY_DELIVERY_TOKEN=
```

The default keeps REST and static delivery public. Set
`OXIDERELAY_PUBLIC_DELIVERY_ENABLED=false` to return `404` from all delivery
routes while keeping the admin UI and management API available.

Set `OXIDERELAY_DELIVERY_TOKEN` to a long random secret to require this header:

```http
Authorization: Bearer <token>
```

The token protects all projects and environments equally. It is loaded at
startup, so rotate it by updating the secret, restarting the service, and then
updating every client. Do not commit the token or put it in URLs. Use HTTPS so
the header is encrypted in transit. Protected responses use private client
caching instead of shared public caching.

## Login Rate Limit

Failed login attempts are persisted in SQLite by a hash of the normalized email
address. One identifier can make 15 unsuccessful attempts in a five-minute
window. Further attempts return `429 RateLimited` until the window expires.
Successful logins clear the counter. This limit is fixed in the current MVP.

## Docker Run

Preferred install path:

```bash
cp .env.example .env
docker compose up -d
```

If port `8080` is already in use on the host, change `OXIDERELAY_PUBLISHED_PORT`
in `.env`. Keep `OXIDERELAY_PORT=8080` so the application inside the container
continues listening on its default port.

Source build:

```bash
docker build -f deploy/Dockerfile -t oxiderelay:latest .
```

Run with persisted SQLite storage:

```bash
docker run \
  --name oxiderelay \
  --env-file .env \
  -p 8080:8080 \
  -v oxiderelay-data:/data \
  oxiderelay:latest
```

The SQLite file must live on a writable volume such as `/data`.
The same container serves the frontend at `/` and the backend API at `/api`.

## Backup and Restore

Backup strategy for SQLite:

1. Stop write traffic if possible.
2. Copy the database file from the persistent volume.
3. Keep the matching `-wal` and `-shm` files if they exist during a live copy.

Example:

```bash
cp /data/oxiderelay.sqlite /backups/oxiderelay-$(date +%F).sqlite
cp /data/oxiderelay.sqlite-wal /backups/ 2>/dev/null || true
cp /data/oxiderelay.sqlite-shm /backups/ 2>/dev/null || true
```

Restore strategy:

1. Stop the service.
2. Replace the SQLite database files in the data volume.
3. Start the service again and let it run migrations if needed.

## Schema and Upgrade Policy

### Development Through Version 0.0.9

OxideRelay is in active pre-`0.1.0` development. Database schema and data are
not upgrade-compatible during this phase. Use only disposable development data;
after incompatible changes, stop the service and recreate the SQLite database.

### Releases Starting With Version 0.1.0

- Migrations run automatically on startup.
- Startup is part of the supported upgrade path.
- Releases preserve existing data through forward-only migrations.
- If a migration fails, the service should be treated as not successfully deployed.

Recommended upgrade flow for `0.1.0` and later:

1. Take a backup of the SQLite volume.
2. Deploy the new backend image.
3. Watch startup logs for migration completion.
4. Run a smoke check against `/api/health` and one authenticated endpoint.

## Release Checklist

Steps to prepare and publish a new OxideRelay release, in order:

1. Bump the version in the two places it is declared:
   - `Cargo.toml` (`version = "x.y.z"`) — the backend crate, the `/api/health`
     response, and the OpenAPI document version all derive from this
     automatically (`backend/src/http/docs.rs` reads it via
     `env!("CARGO_PKG_VERSION")`), so there is nothing else to edit on the
     backend side.
   - `frontend/package.json` (`"version"`) — kept in sync with `Cargo.toml` by
     the `Version consistency` CI job, which fails the build if the two
     diverge.
2. Run the backend tests: `cargo test --locked`.
3. Run the frontend tests and build: `cd frontend && npm test -- --run && npm run build`.
4. Verify the Docker image builds from a clean checkout:
   `docker build -f deploy/Dockerfile -t oxiderelay:release-check .`
5. Run a smoke test against the built image, either `bash scripts/smoke-compose.sh`
   or by walking the Smoke Checklist below against a container started from the
   image built in step 4.
6. Review `readme.md` and this file for stale version references, changed
   defaults, or environment variables introduced since the last release.
7. Push the release tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. This
   triggers the
   [Publish Docker image](../.github/workflows/docker-publish.yml) workflow,
   which builds and pushes `kpakozz96pyc/oxiderelay:vX.Y.Z` (and `:latest` for
   stable, non-pre-release tags).
8. Create GitHub release notes for the tag: summarize user-facing changes,
   reference closed issues/PRs, and call out anything migration-relevant per
   the Schema and Upgrade Policy above.

## Smoke Checklist

For a fresh environment:

1. Start with an empty writable data directory.
2. Provide bootstrap admin credentials.
3. Confirm `/api/health` returns `{"status":"ok","database":"ok","version":"0.0.9"}`.
4. Log in with the bootstrap admin.

For an existing environment:

1. Start with an existing SQLite file.
2. Omit bootstrap admin variables.
3. Confirm startup succeeds without bootstrap errors.
4. Confirm an existing user can still authenticate.
