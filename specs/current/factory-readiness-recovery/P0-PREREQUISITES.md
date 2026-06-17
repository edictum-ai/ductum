# P0 - Prerequisites (operator-direct)

## Problem

Five specific defects block dogfooding. Each is small but mandatory: until
they ship, importing the rest of this recovery as Ductum specs doesn't
work end-to-end.

## Scope

Operator-direct. Single PR or sequential commits on `main`. Not dispatched
through Ductum.

## Behavior Contract

### 0.1 Token UX (UI defect D1, D14)

- Dashboard removes the `local-demo-token` localStorage default.
- When the API returns 401, the dashboard shows a banner naming the file
  to read (`.env.local` or `~/.ductum/operator-token`) and offers a
  one-click "auto-detect" button that reads the operator token via the
  CLI's saved location.
- Settings → API ACCESS gains a "Verify token" button that pings
  `/api/factory` and confirms green/red.

### 0.2 Spec list status mislabel (UI defect D3)

- `SpecList.tsx` reads `spec.status` correctly. A spec at status `done`
  must render a green "Done" badge, not a red "failed" badge.
- The TASKS column shows total task count, not failed-task count.
- Header text matches: "3 specs · 1 done · 1 draft · 1 approved" rather
  than "3 specs · 3 failed".

### 0.3 `/runs/<id>` route (UI defect D4)

- A direct visit to `/runs/<runId>` resolves to the canonical
  `/<project>/<spec>/<task>/<runShort>` route by looking up the run id.
- If the run id is invalid, error message says "Run not found", not
  "Spec X could not be resolved".
- CLI run URLs (printed by `ductum status`, `ductum approve`) are now
  paste-safe.

### 0.4 `SpecStatus = 'failed'`

- `SpecStatus` enum in `packages/core/src/types.ts` adds `'failed'`.
- Migration is enum-widening only (no DB schema change).
- `ductum spec set-status <specId> <status>` CLI exposes the new value.
- Spec list filters `Needs attention` includes `failed` specs.
- `cli-onboarding-smoke` and `execution-integrity-operator-readiness`
  are flipped to `failed` after this lands.

### 0.5 CLI parity with API (3 commands)

Add CLI subcommands so agents can use the skill instead of curl:

- `ductum spec set-status <specIdOrName> <status>`
- `ductum run end-session <runId>`
- `ductum project agent assign|unassign|list <projectName> [agentName] [--role <role>]`

Each command must have a unit test in `packages/cli/src/tests/` and must
show up in `ductum --help`.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
git diff --check
```

## Exit Demo

1. `rm -rf node_modules ductum.db .env.local && pnpm install --frozen-lockfile && pnpm serve` — without hand-editing localStorage, the dashboard shows the 401 banner, I click "auto-detect", and the home page renders.
2. Specs list shows `agent-first-factory-readiness` as **Done** (green), not failed.
3. `node packages/cli/dist/index.js status <runId>` prints a URL; pasting it in the browser opens the correct run page.
4. `node packages/cli/dist/index.js spec set-status <specId> failed` succeeds; the spec appears under "Needs attention".
5. `ductum run end-session <runId>` and `ductum project agent assign codex ductum --role builder` round-trip without curl.

## Slop Review

- Attack a token banner that fires on every 401, not just the missing-token one.
- Attack a `SpecStatus = 'failed'` migration that touches data.
- Attack CLI commands that don't have parity tests.
