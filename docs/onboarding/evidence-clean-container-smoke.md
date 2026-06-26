# Clean Container Onboarding Smoke — Evidence

Date: 2026-04-30
Branch: clean-container-onboarding-smoke-4hPZXX
Task: P19 — Clean Container Onboarding Smoke

## Summary

The fresh agent-first install path works without Arnold-specific state,
hardcoded local paths, or manual env edits. The repo-root happy path is
DB-backed (`ductum init` / `ductum start`), the token bootstrap
auto-generates on first run, and all onboarding smoke checks pass.

## 1. Clean Install/Build/Test Cycle

The smoke script (`scripts/smoke-onboarding.mjs`) executes the full
clean checkout pipeline in order:

### Commands and Outcomes

```bash
$ pnpm install --frozen-lockfile
Scope: all 7 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 1.2s using pnpm v10.11.0
# EXIT: 0

$ pnpm build
> pnpm native:deps && pnpm -r build
# All 6 packages build cleanly:
# packages/core, packages/dashboard, packages/mcp, packages/cli, packages/harness, packages/api
# EXIT: 0

$ pnpm test
# packages/core:    437 tests, 47 files — PASS
# packages/dashboard: 123 tests, 19 files — PASS
# packages/mcp:       14 tests,  2 files — PASS
# packages/cli:      362 tests, 48 files — PASS
# packages/harness:  123 tests, 13 files — PASS
# packages/api:      296 tests, 38 files — PASS
# scripts:            14 tests,  4 files — PASS
# Total:           1,369 tests, 171 files — 0 failures
# EXIT: 0

$ git diff --check
# (no output — clean)
# EXIT: 0
```

### CLI Commands Without a Running Server

In a clean checkout with no API server running, `status --json`
and `repair --json` fail with a fetch error:

```bash
$ node packages/cli/dist/index.js status --json --api-url http://127.0.0.1:65530
Error: fetch failed
# EXIT: 1

$ node packages/cli/dist/index.js repair --json --api-url http://127.0.0.1:65530
Error: fetch failed
# EXIT: 1
```

**Note:** The error message `Error: fetch failed` does not currently
include an actionable hint like "Start the server: ductum start --no-browser". This is a
known onboarding gap tracked as a follow-up improvement. The `--help`
flags for these commands work without a server and describe what is needed.

To use these commands, start the server first:

```bash
node packages/cli/dist/index.js start --no-browser
# In a second shell:
node packages/cli/dist/index.js status --json
```

### CLI Commands Against a Running Factory

```bash
$ node packages/cli/dist/index.js status --json
{
  "projects": [],
  "factoryActivity": { "activeAttempts": 0, "readyTasks": 0 },
  ...
}
# EXIT: 0

$ node packages/cli/dist/index.js repair --json
{
  "ok": false,
  "groups": [],
  ...
}
# EXIT: 0
```

Note: These commands require a running API server. In a clean checkout with
`ductum start --no-browser` just started, the factory has zero tasks and
Attempts.
The output above shows what a clean factory looks like.

## 2. First-Run Token Bootstrap

The start flow handles token bootstrap:

1. Calls `ensureOperatorToken()` from `scripts/serve-helpers.mjs`
2. If `DUCTUM_OPERATOR_TOKEN` is unset, empty, or a known placeholder,
   auto-generates a 64-char hex token via `crypto.randomBytes(32)`
3. Saves to `.env.local` (covered by `.env.*` in `.gitignore`)
4. CLI reads from `.env.local` on subsequent commands
5. No manual env edits required

Placeholder tokens that are rejected: `missing`, `changeme`,
`replace-me`, `local-demo-token`, `replace-me-with-a-long-random-token`,
and the empty string.

The `--operator-token prompt` flag allows interactive token entry.
The `--operator-token <value>` flag allows scripted setup.

### E2E Token Bootstrap Verification

The smoke script verifies the token bootstrap end-to-end:

1. Creates a temp directory
2. Calls `ensureOperatorToken()` with empty env (simulating first run)
3. Asserts `.env.local` was created with `DUCTUM_OPERATOR_TOKEN=...`
4. Asserts existing valid tokens are reused without re-saving

## 3. Arnold-Specific Drift (Decision 060)

### Clean configs (no Arnold references)

| File | Status |
|------|--------|
| `ductum.yaml` | REMOVED from repo root happy path |
| `ductum.docker.yaml` | REMOVED from repo root happy path |
| `ductum.example.yaml` | REMOVED from repo root happy path |
| `compose.yaml` | CLEAN — no Arnold paths |
| `.env.example` | CLEAN — uses placeholder values |
| `.gitignore` | CLEAN — `.env.*` covers `.env.local` |
| `scripts/seed.mjs` | LEGACY/DEBUG-ONLY — normal path is `ductum init` + `ductum start` |

### Known Arnold drift (documented, not in onboarding path)

| File | Drift | Risk |
|------|-------|------|
| `docs/SELF_HOST_MAC_MINI.md` | Arnold's IP, paths, domain | Deployment-specific doc |
| `docs/alpha-dogfood/deployment-doctor.md` | `factory.arnoldcartagena.com`, Arnold's alias | Dogfood doc |
| `.claude/next-session-prompt.md` | `/Users/acartagena/project/ductum` | Internal session file |
| `.claude/handover.md` | Arnold paths | Internal session file |
| `.claude/bootstrap.md` | Arnold paths | Internal session file |
| `specs/impl-*` | Arnold paths in historical specs | Historical records |
| `CONTEXT.md`, `VISION.md` | Arnold references | Internal context |
| `ARCHITECTURE.md` | "Arnold's existing frontend stack" | Historical doc |
| `scripts/onboarding-config.test.mjs` | Guards against root YAML reintroduction and legacy seed happy-path drift | Good — this is the guard |

None of these drift files are in the operator onboarding path:
`clone -> install -> build -> start -> repair -> status`.

## 4. Missing Credentials — Explicit Failure

When real credentials are missing:

| Scenario | Behavior | Next Command |
|----------|----------|-------------|
| No `ANTHROPIC_API_KEY` | `claude-agent-sdk` harness fails to load | `export ANTHROPIC_API_KEY=...` then restart |
| No `codex login` | `codex-sdk` harness agent won't dispatch | `codex login` then restart |
| No API server running | CLI commands fail with `Error: fetch failed` | `ductum start --no-browser` |
| No operator token | Auto-generated on first serve | None needed |
| No Telegram config | `repair` reports readiness, factory still starts | Configure Telegram in Factory Settings |

The `ductum repair` command shows readiness blockers and the next operator
action.

### Known gap: `Error: fetch failed` is not actionable

When the API server is not running, CLI commands exit 1 with
`Error: fetch failed`. This error does not tell a new agent what to do.
The fix is to wrap the fetch error in the CLI with a hint like
"Is the API server running? Start it with `ductum start --no-browser`." This is
recorded as a follow-up task and is out of scope for this onboarding smoke.

## 5. Smoke Test Script

A script `scripts/smoke-onboarding.mjs` runs the full clean checkout
pipeline:

```bash
node scripts/smoke-onboarding.mjs
```

Checks cover:
1. `pnpm install --frozen-lockfile` (exits 0)
2. `pnpm build` (exits 0, all dist/ outputs present)
3. `pnpm test` (exits 0)
4. Arnold-free DB-only onboarding surfaces (.env.example, .gitignore, no root YAML)
5. CLI `--help` commands (work without server)
6. Token bootstrap E2E (generates token, saves to .env.local, reuses existing)
7. Production DB-backed startup path (no YAML config startup)
8. Legacy seed helper retired from the happy path and clearly labeled
9. Onboarding docs exist (SETUP.md, CLI_ONBOARDING.md, README.md)
10. No-server error handling (exits non-zero, fetch error detected)

All checks pass.

## 6. Onboarding Commands for a New Agent

From a clean checkout:

```bash
# 1. Install
pnpm install --frozen-lockfile

# 2. Build
pnpm build

# 3. Test
pnpm test

# 4. Initialize the factory (auto-generates operator token)
ductum init --no-login --no-browser

# 5. Start factory
ductum start --no-browser

# 6. In a second shell
alias ductum="node packages/cli/dist/index.js"
ductum repair
ductum status
```

No manual env edits required. No Arnold-specific paths. No hardcoded state.

## 7. Follow-up Tasks

| Gap | Priority | Description |
|-----|----------|-------------|
| CLI fetch error hint | Medium | `status` and `repair` should wrap `Error: fetch failed` with an actionable "Start the server: `ductum start --no-browser`" hint |
