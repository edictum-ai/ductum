# P1 - State Convergence Reconcile

Implement bounded fixed-point reconciliation and dispatcher-aware orphan
detection.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  `103`, `104`, `105`, and `106`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference from evidence/review prose; no dashboard redesign; no
  Edictum behavior changes.
- Allowed scope: reconcile scan semantics, bounded pass orchestration, API/CLI
  output types, behavioral tests, dogfood records, and review artifacts.
- Drift handling: record a decision before adding storage, a second reconcile
  path, generalized success inference, or policy behavior.

## Behavior Contract

This prompt is bound to the source-of-truth Behavior Contract in `README.md`.
Implementation must satisfy every item there, especially:

- One reconcile command must preserve bounded fixed-point runtime behavior for
  repairable stale run/task contradictions.
- Dispatcher-aware orphan detection must fail stale no-live-session runs using
  each run's heartbeat timeout, while preserving fresh runs.
- Dry-run must preserve stored run/task/evidence state while still reporting
  first-pass-visible candidates.
- API output must make pass count and non-convergence visible.
- CLI output must make pass count and non-convergence visible without hiding
  repair rows.
- Re-running reconcile after convergence must preserve audit history without
  duplicate audit records.
- Dispatcher-aware orphan detection must preserve the one-hour fallback when
  dispatcher liveness is unavailable.

Reconcile stays narrow: no new table, primitive, dependency, policy system, or
broad success inference.

## Implementation Notes

- Prefer an internal single-pass helper and a small bounded loop in
  `reconcileInconsistentRuns`.
- Keep existing audit transactions and side-effect failure handling intact.
- Use `context.hasActiveSession?.(run.id)` only as liveness input.
- Preserve the existing one-hour orphan threshold when live-session knowledge
  is unavailable.
- Keep CLI text mostly stable; add convergence metadata without hiding repair
  rows.

## Slop Review

- Did behavioral tests prove one command reaches a fixed point for descendant
  stale runs and active tasks?
- Did tests prove dispatcher-aware orphan detection uses the run heartbeat
  timeout without closing fresh runs?
- Did dry-run stay read-only while reporting visible candidates?
- Did the implementation preserve the conservative fallback when dispatcher
  liveness is unavailable?
- Did it avoid broad success inference from review/evidence text?
- Did it avoid a second reconcile path, new storage, or fake operator state?
- Did API and CLI output make non-convergence visible?
- Did repeated reconcile avoid duplicate audit records?

## Verification

```sh
ductum spec contract-check ductum specs/current/state-convergence-reconcile --path
ductum spec drift-review ductum state-convergence-reconcile
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
