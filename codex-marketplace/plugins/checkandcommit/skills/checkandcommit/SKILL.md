---
name: checkandcommit
description: Validate current OxideRelay changes, check documentation consistency, request approval for required documentation fixes, and commit the verified work. Use when the user invokes /checkandcommit or requests this validation-and-commit workflow.
---

# Check and Commit

Use this workflow only for the current OxideRelay repository. It validates the
working tree before committing; it does not push unless the user separately
asks for a push.

## 1. Establish Scope

1. Read `AGENTS.md`, `readme.md`, and any affected operational or frontend
   style documentation.
2. Run `git status --short`, inspect both staged and unstaged diffs, and list
   untracked files.
3. If the worktree has no changes, report that there is nothing to commit and
   stop.
4. If changes appear unrelated to the user's requested work or their ownership
   is unclear, stop and ask which files may be included. Never stage or revert
   them by default.

## 2. Run Verification

Run `git diff --check` for every invocation. Then run the checks required by
the changed areas:

| Changed area | Required check |
| --- | --- |
| Rust backend, migrations, API, auth, permissions | `cargo test` from repository root |
| React, TypeScript, frontend dependencies, UI | `npm test -- --run` and `npm run build` from `frontend/` |
| Docker, Compose, deployment configuration | `docker compose config` |

If the changed files span backend and frontend, run both sets. Report failures
with the failing command and do not commit a failing result unless the user
explicitly directs otherwise.

## 3. Check Documentation Consistency

Compare the implementation diff with `readme.md`, plus affected documents such
as `deploy/OPERATIONS.md`, `docs/frontend-style-guide.md`, and OpenAPI when
applicable. Check factual claims including:

- product capabilities and explicitly unsupported features;
- access and permission model;
- API endpoints, request/response contracts, and configuration;
- deployment commands, ports, health response, security behaviour, and version;
- frontend visual-token or workflow documentation when UI conventions change.

If documentation is stale or incomplete, do **not** edit, stage, or commit it
yet. Describe each discrepancy with the implementation and documentation file
paths, propose the precise documentation changes, and request explicit user
approval. Wait for the response.

If the user approves, update only the approved documentation, repeat any checks
affected by the edit, and continue. If the user declines, leave the
documentation untouched and ask whether to commit the code despite the known
documentation mismatch.

## 4. Review and Commit

1. Re-run `git diff --check` after approved documentation edits.
2. Inspect the final diff and confirm it contains no generated runtime files,
   credentials, databases, build output, or unrelated changes.
3. Stage only the reviewed files.
4. Create one concise imperative commit message describing the completed work.
5. Report the commit hash, included files, checks run, and whether README or
   other documentation was updated.

Never amend an existing commit, force-push, or push automatically.
