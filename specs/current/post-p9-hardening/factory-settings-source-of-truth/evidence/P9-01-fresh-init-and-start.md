# P9 Evidence 01 — Fresh DB-Only Init And Start

Date: 2026-06-12 (local). Operator-direct dogfood against a throwaway temp
factory. CLI/API run from freshly built `packages/*/dist` at the P9 working
tree (P8 baseline `ef12f33` plus the two narrow P9 blocker fixes recorded in
`P9-07-closeout.md`).

## Fresh init

```bash
rm -rf /tmp/ductum-p9-demo
node packages/cli/dist/index.js init --dir /tmp/ductum-p9-demo --name p9-demo \
  --no-login --no-browser --json
```

Structured events observed: `init.started`, `init.directory_resolved`,
auth detection (anthropic: not authenticated in this shell; codex: detected via
`codex login status`; copilot: detected via `gh auth status`),
`init.agents_selected {codex, copilot}`, `init.scaffolded`,
`init.operator_token_created` (tokenPath `[redacted]` in event output),
`init.api_starting`/`init.api_ready` (ephemeral welcome API),
`init.browser_skipped`, `init.completed`.

## Proof checks (all PASS)

| Check | Result |
|---|---|
| `ductum.yaml` created | none — `find . -name "*.yaml"` in the factory dir returns nothing |
| SQLite DB created | `ductum.db` (344 KB) + WAL/SHM present |
| `.ductum/secrets.key` | exists, size=32 bytes, mode=0600 |
| `.env.local` / operator token | mode 0600, written under factory dir |
| gitignore posture | `.gitignore` contains `ductum.db`, `ductum.db-*`, `.ductum/`, `.env.local` |
| initial git commit | `chore: initialize ductum factory` contains ONLY `.gitignore`; `git status` clean after init |
| seeded state | Factory + Project `p9-demo` + Repository `.` + Component `root` + 2 agents (codex-builder, copilot-builder) + catalogs |

## DB-only start

The init-spawned welcome API was stopped, then:

```bash
node packages/cli/dist/index.js start --dir /tmp/ductum-p9-demo/p9-demo \
  --port 4180 --no-browser --json
```

- `start.started` plan shows `dbPath=<factoryDir>/ductum.db`; no config-file
  input exists on the command (the `--config` flag was removed in P3).
- `GET /api/health` → `{"ok":true,"operatorTokenProtected":true}`.
- `GET /api/settings/config` → **404** (route does not exist).
- `GET /api/factory-settings` (operator token header) returns the full typed
  catalog payload from DB: 4 providers, 32 models, 4 harnesses, 2 workflows,
  2 agents, 1 sandbox profile, budgets, runtime preferences.
- Startup log shows harness/dispatcher/API boot from DB + env only; no YAML
  path is read (see P9-06 grep: zero `ductum.yaml` hits in `packages/api`).

PASS: fresh Factory has no `ductum.yaml`, starts from SQLite, and no startup
path depends on `/api/settings/config`.
