# State Convergence Reconcile

## Intake

The reconcile command can repair a stale child run and still leave its stale
parent active until a second manual invocation. That is operator-hostile state
repair. Reconcile needs to keep walking repairable contradictions until the
reachable state settles, while still stopping within a visible bound.

## Grill Questions

- Should this add a second reconcile endpoint or policy system? No.
- Should dry-run simulate hidden future passes by mutating shadow storage? No.
  Keep it read-only and report only first-pass-visible candidates.
- Should orphan detection trust anything besides dispatcher liveness plus the
  run heartbeat? No.
- Should the old one-hour orphan threshold disappear entirely? No. Keep it as
  the conservative fallback when dispatcher liveness is unavailable.

## Decisions

- Add decision `106` for bounded fixed-point reconciliation and
  dispatcher-aware orphan detection.
- Keep the existing `/api/runs/reconcile` entry point and CLI command.
- Run bounded reconcile passes until no more visible repairs remain.
- Surface pass count and non-convergence in API and CLI output.
- Use per-run heartbeat timeouts only when dispatcher liveness is available.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  `103`, `104`, `105`, and `106`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference from evidence/review prose; no dashboard redesign; no
  Edictum behavior changes.
- Allowed scope: reconcile scan semantics, bounded pass orchestration, API/CLI
  output types, behavioral tests, dogfood records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/state-convergence-reconcile --path`,
  `ductum spec drift-review ductum state-convergence-reconcile`,
  package tests, build, `git diff --check`, and adversarial slop review.
- Drift handling: record a decision before adding storage, a second reconcile
  path, generalized success inference, or policy behavior.

## Behavior Contract

- The API reconcile route must preserve fixed-point runtime behavior by
  repeating repair passes until no visible contradictions remain or the maximum
  pass count is reached.
- The API reconcile route must fail stale no-live-session runs after their own
  heartbeat timeout expires.
- The API reconcile route must preserve fresh no-live-session runs without
  failing them before their heartbeat expires.
- The API reconcile route must surface non-convergence when the maximum pass
  count is exhausted before the state settles.
- Dry-run API reconcile must leave runs, tasks, run updates, and evidence
  unchanged while still reporting currently visible run candidates.
- Dry-run API reconcile must preserve first-pass-visible output and must not
  create fake later-pass runtime results that only exist after a committed
  repair mutates state.
- Re-running the API reconcile route after convergence must not duplicate audit
  evidence or run updates for already repaired state.
- CLI reconcile output must show pass count and must show when reconcile did
  not converge within the bound.
- CLI dry-run reconcile output must keep the repair rows visible while also
  showing the dry-run and non-converged status.
- Dispatcher-aware orphan detection must preserve
  `hasActiveSession(run.id)` as the only liveness input and must not add a new
  ownership model.
- When dispatcher liveness is unavailable, reconcile must preserve the existing
  one-hour orphan fallback.
- Dispatcher-aware orphan detection must resolve stale no-live-session runs
  against each run's own `heartbeatTimeoutSeconds` when dispatcher liveness is
  available.
- Dispatcher-aware orphan detection must preserve a run with a live dispatcher
  session and must not fail it only because its persisted heartbeat is stale.
- Reconcile must stay narrow: no new table, primitive, dependency, second
  policy system, or broad success inference from review/evidence text.
- Tests must prove state convergence and DB effects, not only response shape.

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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-STATE-CONVERGENCE-RECONCILE.md](P1-STATE-CONVERGENCE-RECONCILE.md) | api/cli | Fixed-point reconcile and dispatcher-aware orphan detection | Convergent state repair | [x] | `104`, `105` |

## Dogfood Record

- Decision recorded in repo: [106-state-convergence-reconcile.md](../../../decisions/106-state-convergence-reconcile.md)
- Local verification evidence: `verification-evidence.md`
- Bakeoff implementation artifact: this worktree candidate patch

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
