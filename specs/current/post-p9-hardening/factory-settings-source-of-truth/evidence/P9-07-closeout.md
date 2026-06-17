# P9 Evidence 07 — Closeout

Date: 2026-06-12. P9 final dogfood and onboarding demo for DB-only Factory
Settings. Baseline: P0-P7 committed, P8 at `ef12f33`.

## Result: PASS

| Acceptance item | Result | Evidence |
|---|---|---|
| Fresh Factory has no `ductum.yaml`, starts from SQLite | PASS | P9-01 |
| Settings edits persist through typed APIs, survive restart | PASS | P9-02 |
| Runtime panel/API identifies restart-required changes honestly | PASS | P9-02 |
| Secret values cannot be read back (API/UI/CLI/logs/events/evidence/DB) | PASS | P9-03 |
| Normal work follows Factory → Project → Repository/Component → Spec → Task → Attempt | PASS | P9-05 |
| Attempt snapshots runtime agent/model/harness/sandbox/workflow state | PASS | P9-05 |
| Refreshed P8 model catalog visible through typed Settings | PASS | P9-04 |
| No normal dependency on `/api/settings/config`, `settings-yaml`, `yamlPatch`, `ductum.yaml` | PASS | P9-06 |

Demo environment: `/tmp/ductum-p9-demo/p9-demo` (throwaway), API on
`127.0.0.1:4180`, agents seeded from detected codex + copilot auth.

## Blocker fixes made in P9 (narrow, build-only)

The P9 demo runs from built `dist`, and the baseline tree did not compile
with `tsc` (vitest does not typecheck, so P7/P8 sessions never hit these):

1. `packages/core/src/factory-settings-validation.ts` — `isKnownHarnessType`
   is now a type guard (`harnessType is Harness`), fixing the
   `supportedHarnesses.includes(harnessType)` strict-TS error introduced with
   the P8 catalog refresh path. No behavior change (the guard already proved
   membership at runtime).
2. `packages/cli/src/tests/helpers.ts` — the `factorySettings.agents` fixture
   was missing the `secretAccessRefs` / `resourceRefs` fields P7 added to
   `FactorySettingsAgent`. Fixture-only change.

Process note: P-stage verification checklists relied on `pnpm test` +
dashboard build; neither runs `tsc` over core/cli. A root `pnpm build` (or
`pnpm lint`) in stage gates would have caught both. Candidate for P4 process
directives.

## Verification results (all green, run at this tree)

- `pnpm test` — core 597, dashboard 139, mcp 14, cli 218, harness 145,
  api 384, scripts 55; exit 0.
- `pnpm --filter @ductum/dashboard build` — built.
- `node scripts/check-file-size.mjs` — 744 files scanned, gate passed.
- `git diff --check` — clean.
- Reconciliation `rg` — classified in P9-06; no normal dependency remains.

## Findings logged for later stages (not P9 blockers)

- Built-in coding-guard `verifyCommands` (`pnpm build && pnpm test`) cannot
  pass on the init-seeded factory Repository (`.`) — out-of-box first dispatch
  always ends in verify-fail + fix loop (P9-05 finding 1).
- Ready fix task did not auto-dispatch and dispatcher skips are silent
  (P9-05 finding 2) — P1 honesty hardening candidate.
- Attempt cost/tokens shown as 0 for a real codex-app-server run
  (P9-05 finding 3).
- `PATCH /api/factory/settings` write result shows pre-write `current` next to
  `applied: true` (P9-02 finding).
- Duplicate `coding-guard` workflow row (built-in + saved) on fresh init
  (P9-04 known issue, first seen in P6).

## Review round 1: FAIL → fixed

The arc review (2026-06-12) ruled the first P9 evidence commit (`d3ec13f`) a
hard FAIL on one finding: `P9-03-secrets-write-only.md` recorded the submitted
secret sentinel plaintext verbatim (method line plus create/rotate request
bodies), violating the rule that secret plaintext must never be written into
evidence — the exact rule the proof was checking. All other checks passed.

Fix: P9-03 was rewritten to redact the sentinel values (procedure unchanged
and re-runnable), with a correction note recording the failure honestly and
the process rule: evidence may describe a submitted secret, never quote it.
A repo-wide grep confirms no sentinel plaintext remains in any tracked file.
The superseded text stays in git history because the values were synthetic,
single-use, and the secret record was deleted during the proof; a real
credential would have required rotation.

## Arc status

All ten stages of `factory-settings-source-of-truth` are done/pass after the
review-round-1 fix above. The README execution table records this. Follow-on
ideas live in `../post-source-of-truth-backlog.md` and the findings above.
