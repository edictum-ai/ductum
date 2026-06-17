Decision Trace: 053, 058, 059, 060, 108.

## Behavior Contract

- The dashboard home page must answer "where are we?" without requiring the operator to infer progress from recent runs.
- Show task/run totals, done, active, blocked/failed, awaiting approval, ready, and integrity issue counts from API state.
- Show execution-integrity mode counts so external/recorded work is visible and not mistaken for Ductum-orchestrated lineage.
- The progress surface must reuse existing API endpoints and state models. Do not add a new table, top-level primitive, or second classifier.
- Do not hide empty states. If there is no active work, say that directly in the UI.
- Keep the UI operator-dense and consistent with the existing Signal dashboard style.

## Verification

- Run `pnpm --filter @ductum/dashboard test`.
- Run `pnpm --filter @ductum/dashboard build`.
- Run `pnpm --filter @ductum/api test`.
- Run `pnpm build`.
- Run `pnpm test`.
- Run `git diff --check`.
- Run `node packages/cli/dist/index.js operator brief --json`.
- Run `node packages/cli/dist/index.js integrity --json`.

## Drift Handling

- Record a Ductum Decision before adding new persistence, a new progress primitive, or a second execution-integrity path.
- Preserve Edictum as the policy boundary. This task is visibility only.
- If an endpoint cannot support the UI without N+1 calls, add a small API shape over existing repos rather than querying SQLite directly.

## Slop Review

- Attack vanity counters that look good but do not map to real task/run state.
- Attack any completion percentage that treats external or recorded work as Ductum-orchestrated.
- Attack stale approval or failed-run counts that include older failed attempts when a newer successful attempt exists.
- Attack dashboard-only logic that disagrees with `operator brief` or `integrity`.

Task: Add an operator progress surface to the dashboard home page so a sleeping operator can open the UI and immediately see total work, completed work, pending/active work, approval state, and remaining integrity/deferred risk without reading the terminal.
