# Stalled Attempt Recovery And Operator Visibility

## Status

Proposed urgent hardening slice after the 2026-06-14 dogfood smoke.

This supersedes the temporary UI draft scratch created during discovery. The
scratch mockups were exploratory only; this file is the durable source of truth.

## Trigger

During a two-attempt dogfood dispatch, Ductum accepted and started both ready P1
tasks. The control plane then became unavailable. On restart, orphan reconcile
marked both attempts stalled because their harness sessions could not be
reattached.

Observed state after restart:

- `personal-memory/P1-GATEWAY-PHASE-1` stalled as `mmq_X40JI10x`.
- `qratum/P1-SPEC-HYGIENE` stalled as `62VM_sKAICEF`.
- `ductum status` showed two stalled attempts and one retry command.
- `ductum watch --once` showed both full retry targets.
- The dashboard/CLI recovery path was too hidden for an operator to trust.

## Problem

Ductum can import and dispatch work, but recovery from a control-plane restart is
not yet first-class:

- Stalled attempts are visible, but their causes and safe next actions are split
  across status, watch, logs, and external repo inspection.
- CLI output abbreviates attempt IDs in some places while recovery commands need
  full IDs.
- Startup reconcile emits useful information to process output, but operators do
  not get a durable, obvious record in the dashboard.
- Retrying an attempt can be unsafe if the target worktree is dirty or contains
  partial edits from the prior attempt.
- The dashboard does not yet make "Needs Operator" the primary recovery surface.

## Locked Decisions

- Do not retry qratum or personal-memory attempts until the dirty/partial
  external worktrees are intentionally resolved.
- Do not auto-merge or auto-retry after restart.
- Do not edit SQLite directly.
- Do not use `ductum.yaml`.
- Do not hide restart-created stalls as normal failures.
- Ductum must show the operator exactly why an attempt needs action before
  offering a risky action.

## MVP Scope

### P1 - Recovery Data And CLI Honesty

- Show full attempt IDs anywhere a retry/cancel/log/status command is printed.
- Make `ductum status` list all stalled attempts, not only one next action.
- Make `ductum repair` include attempt IDs, project/spec/task, reason, and next
  safe commands.
- Preserve the existing CLI shape; add fields, do not invent a new command unless
  the current commands cannot carry the information clearly.

### P2 - Durable Control-Plane Restart Visibility

- Persist startup/reconcile events or expose them through an existing activity
  surface.
- Show when attempts were stalled because sessions were not reattachable after a
  restart.
- Include the restart time, scanned/live/reattached/stalled counts, and affected
  attempt IDs.
- Keep logs secret-safe and local.

### P3 - Dashboard Needs Operator Surface

- Add a first-class dashboard view/card for attempts needing operator action.
- For each item show project, spec, task, attempt ID, agent, status/phase,
  reason, latest progress/log tail, and suggested safe actions.
- Show dirty-worktree or partial-edit risk before `retry`.
- Link directly to logs/status detail.
- Keep the operator model visible: Factory -> Project -> Repository/Component ->
  Spec -> Task -> Attempt.

### P4 - Safer Retry UX

- Before retry, surface whether the task target has known dirty/partial state.
- If Ductum cannot prove retry is safe, say that loudly and require an explicit
  operator action.
- Do not silently discard or overwrite partial attempt work.

### P5 - Tests And Browser Verification

- Add CLI/API tests for full ID output and repair/status completeness.
- Add dashboard tests for the Needs Operator surface.
- Run the dashboard in a browser and verify the stalled-attempt flow is visible
  without CLI spelunking.

## Reviewer Risk Notes

These files are high-risk and must be covered by tests or review before this
slice is accepted:

- `packages/core/src/dispatcher-reconcile.ts` — startup orphan reconcile must
  write durable, secret-safe restart/reconcile evidence and must not only log to
  stdout.
- `packages/core/src/repair-readiness-items.ts` — `needsOperatorItem(count)` is
  count-only today; operator-facing repair output must list affected attempts.
- `packages/core/src/repair-execution.ts` — attempt repair records and links use
  shortened IDs; copyable commands and recovery identity must use full IDs.
- `packages/cli/src/commands/next-action.ts` and
  `packages/cli/src/commands/status-overview.ts` — status must not hide all but
  the first needs-operator attempt.
- `packages/api/src/routes/runs.ts` — retry should not encourage overwriting
  dirty or partial work without explicit operator awareness.
- `packages/dashboard/src/pages/Repair.tsx` — repair targets must not truncate
  attempt IDs when the operator needs to recover a specific attempt.
- `packages/dashboard/src/pages/FactoryActivity.tsx` — the Needs attention
  bucket must become a first-class Needs Operator recovery surface.
- `packages/dashboard/src/pages/RunDetail.tsx` and
  `packages/dashboard/src/pages/run-detail/hero.tsx` — stalled attempts should
  not show a bare primary Retry button without risk context.

Reviewer assertions:

- No copyable command contains an abbreviated attempt ID.
- Counts never replace per-attempt recovery rows.
- Restart/reconcile information is visible after process stdout is gone.
- Retry copy names dirty/partial-work risk before encouraging retry.
- No new dependencies, Operation/WorkOrder tables, YAML authority, or broad
  refactors.

## Future UI Research

Spec Reviewer is useful design input for Ductum, but the redesign is parked
behind the recovery work.

Useful patterns to keep:

- Right-side operator action rail.
- Source/review/export state shown explicitly.
- Compact local-first wording.
- Clear finish/cancel handoff artifact.
- Homebrew-first bundled binary distribution for standalone local tools.

Recommended future Ductum UI directions:

- Operations Console for the default home/project page.
- Setup Wizard Settings for API access, agents, models, and project assignment.
- Bakeoff Compare for Best-of-N results.
- Review Desk / Absorbed Spec Reviewer for long-term spec/task review.

`framer-motion@12.40.0` was verified on 2026-06-14 as published on
2026-05-21, clearing a 15-day supply-chain buffer. Do not add it until a chosen
UI implementation actually needs motion.

The requested 21st Magic MCP was not available in the active tool list during
discovery.

## Non-Goals

- No broad visual redesign in this slice.
- No new dependencies.
- No new Operation or WorkOrder tables.
- No auto-retry.
- No auto-merge.
- No external project implementation work.
- No cleanup of qratum/personal-memory partial worktrees by Ductum agents unless
  Arnold explicitly assigns that work.

## Verification

Run at minimum:

```sh
pnpm --filter @ductum/core test -- execution-integrity
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test -- status repair logs
pnpm --filter @ductum/dashboard test -- recovery
pnpm --filter @ductum/dashboard build
git diff --check
node scripts/check-file-size.mjs
```
