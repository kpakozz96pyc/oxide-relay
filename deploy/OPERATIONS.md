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

## Docker Run

Build:

```bash
docker build -f deploy/Dockerfile -t oxiderelay:latest .
```

Run with persisted SQLite storage:

```bash
docker run \
  --name oxiderelay \
  -p 8080:8080 \
  -e OXIDERELAY_HOST=0.0.0.0 \
  -e OXIDERELAY_PORT=8080 \
  -e OXIDERELAY_DATABASE_PATH=/data/oxiderelay.sqlite \
  -e OXIDERELAY_FRONTEND_DIST_PATH=/app/frontend-dist \
  -e OXIDERELAY_ADMIN_EMAIL=admin@example.com \
  -e OXIDERELAY_ADMIN_PASSWORD=change-me \
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

## Migration and Upgrade Expectations

- Migrations run automatically on startup.
- Startup should be considered part of the upgrade path.
- New releases must preserve existing data by adding forward-only migrations.
- If a migration fails, the service should be treated as not successfully deployed.

Recommended upgrade flow:

1. Take a backup of the SQLite volume.
2. Deploy the new backend image.
3. Watch startup logs for migration completion.
4. Run a smoke check against `/api/health` and one authenticated endpoint.

## Smoke Checklist

For a fresh environment:

1. Start with an empty writable data directory.
2. Provide bootstrap admin credentials.
3. Confirm `/api/health` returns `{"status":"ok","database":"ok"}`.
4. Log in with the bootstrap admin.

For an existing environment:

1. Start with an existing SQLite file.
2. Omit bootstrap admin variables.
3. Confirm startup succeeds without bootstrap errors.
4. Confirm an existing user can still authenticate.
