# OxideRelay Agent Guide

## Scope and Sources of Truth

- Read [readme.md](readme.md) before changes that affect product behaviour,
  configuration, API usage, deployment, permissions, or versioning.
- Read [deploy/OPERATIONS.md](deploy/OPERATIONS.md) for bootstrap, runtime,
  security, and release behaviour.
- Read [docs/frontend-style-guide.md](docs/frontend-style-guide.md) before
  frontend UI or CSS changes. Reuse its tokens and established components.
- Treat the code, migrations, and OpenAPI document as the implementation source
  of truth. Update documentation when an intentional implementation change
  affects a documented claim.

## Product Boundaries

- OxideRelay is a lightweight self-hosted localization storage and delivery
  server.
- Access uses global direct permissions, project membership, and project-owner
  override. Do not introduce or imply roles, role templates, or project-scoped
  permissions.
- Do not add API keys, audit logs, SMTP, MCP, translation review/status
  workflows, or backend features solely for UI decoration.
- Keep delivery URLs and path-based identifiers compatible with their documented
  validation rules.

## Implementation Rules

- Preserve the existing React, TypeScript, React Router, TanStack Query,
  Lucide, custom-CSS frontend stack. Do not add UI libraries without a clear
  product need.
- Preserve authentication and permission behaviour unless the task explicitly
  requires a reviewed change.
- Prefer existing API calls, query invalidation patterns, and shared UI styles
  over duplicating flows or hardcoding data.
- Do not add fake dates, users, counts, activity, or placeholder domain data.
- Keep the frontend responsive and leave the shared left navigation unchanged
  unless the task explicitly includes it.
- Keep backend changes minimal, update OpenAPI when a public API changes, and
  add or update tests in the existing project style.

## Data and Version Policy

- The current project version is `0.0.9` and is pre-`0.1.0` development.
- Before `0.1.0`, breaking migrations are allowed and data is disposable.
- Starting with `0.1.0`, only forward-only migrations are allowed. Preserve
  existing data and do not rewrite migrations after that point.

## Verification and Git

- For backend changes, run `cargo test` from the repository root.
- For frontend changes, run `npm test -- --run` and `npm run build` from
  `frontend/`.
- Run `git diff --check` before a commit. Run deployment configuration checks
  when changing Docker or Compose files.
- Never revert or stage unrelated user changes. Ask before resolving an
  ambiguous dirty worktree.
- Do not commit or push unless the user explicitly asks, except when the user
  invokes the `checkandcommit` workflow.

## Repository Skills

- The repository-local Codex marketplace is in `codex-marketplace/`. Register
  it with `codex plugin marketplace add ./codex-marketplace`, then install the
  workflow with `codex plugin add checkandcommit@oxiderelay`.
- `/checkandcommit` runs relevant checks, verifies documentation consistency,
  requests approval before documentation fixes, and commits only the reviewed
  changes. It never pushes automatically.
