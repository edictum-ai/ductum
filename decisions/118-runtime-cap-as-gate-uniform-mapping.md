---
date: 2026-05-01
status: implemented (2026-05-01)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 109, 114, 115
---

# Decision 118: Every recoverable runtime cap is an operator-approval gate

## Context

Decision 114 made one runtime cap — the per-run cost budget enforced
by ductum's `enforceCostBudget` — gate-evaluated. The 2026-05-01 P3
recovery session immediately uncovered a *second* cap that bites
identically: Claude Agent SDK's `error_max_turns` after 200 turns.
Run `zB5aRvvKD-Zy` lost $38.41 of work (and produced 4 new files
including a fresh attempt at Decision 117) because the SDK's
turn-cap exit was mapped to `'timeout'`, the dispatcher promoted
that to `stalled`, and the worktree was auto-removed at session end
before any operator-visible signal fired.

The pattern is general. Any runtime cap that is **operator-tunable
and recoverable** should be an evidence-gated transition with the
same shape as Decision 114's budget gate. Anything else (process
crashes, OOM kills, genuine errors) stays terminal because there
is no "extend" lever.

## Decision

**Every recoverable runtime cap maps to a `paused-*` exit reason
emitted by the harness, a `*_paused` failReason set by the
dispatcher, and a `ductum <resource> extend|deny` CLI surface.**

Concrete mapping after this Decision:

| SDK / runtime signal                      | Exit reason            | failReason prefix       | CLI surface           | Task column      |
|---|---|---|---|---|
| `error_max_turns` (Claude SDK)            | `paused-max-turns`     | `max_turns_paused`      | `ductum turns extend` | `turn_extra_count` |
| `error_max_budget_usd` (Claude SDK)       | `paused-cost-budget`   | `cost_budget_paused`    | `ductum budget extend`| `budget_extra_usd` |
| ductum `enforceCostBudget` cap hit        | (precheck path)        | `cost_budget_paused`    | `ductum budget extend`| `budget_extra_usd` |
| ductum `enforceCostBudget` spec-cap hit   | (precheck path)        | `spec_cost_budget_paused` | `ductum budget extend`| `budget_extra_usd` |

Note that `error_max_budget_usd` and ductum's own enforce hit BOTH
land at the same `cost_budget_paused` failReason and are extended
through the same `ductum budget extend` CLI. They differ only in
*who* tripped the cap first; from the operator's seat there is one
budget surface, not two. The harness now sets the SDK's
`maxBudgetUsd` to `process.env.DUCTUM_COST_BUDGET.perRunHardUsd`
so the two caps stay aligned.

### Worktree preservation

For any `paused-*` exit reason (or any failReason starting with
`cost_budget_`, `spec_cost_budget_`, or `max_turns_`):

- `cleanupFailedOwnWorktrees` (session-end cleanup) **skips** the
  worktree.
- `cleanupStaleWorktrees` (periodic and force-mode cleanup)
  **protects** the worktree by including these runs in the
  `protectedShortIds` set.

The worktree is removed only by an operator-direct `git worktree
remove` or by an explicit deny followed by aging out past the
stale threshold. This is the salvage path that did not exist on
2026-05-01.

### Invariants

1. **No reset on extension.** D27 holds across the pause. Extending
   `task.budgetExtraUsd` or `task.turnExtraCount` does not increment
   `resetCount` and does not swap WorkflowRuntime. The next dispatch
   for the task is treated as a continuation.
2. **The dispatched task is the same task.** Extension is per-task,
   not per-run. Multiple runs of the same task share the extra cap.
3. **Deny is honest.** A deny relabels failReason to
   `<resource>_denied` with a required `--reason`. The terminal
   failed state matches the audit trail.
4. **The SDK cap mirrors ductum's.** `claude.ts` reads
   `DUCTUM_COST_BUDGET.perRunHardUsd` from env at session-spawn time
   and passes it as the SDK's `maxBudgetUsd`. The two caps are
   never independent in normal operation.

### Surfaces shipped

- DB column `tasks.turn_extra_count` (migration 032).
- `Task.turnExtraCount: number` in `@ductum/core` types.
- `TaskRepo.incrementTurnExtra`.
- `HarnessSessionResult.exitReason` extended with
  `'paused-max-turns' | 'paused-cost-budget'`.
- `claude.ts`:
  - `BASE_MAX_TURNS = 200`. Effective cap = `BASE_MAX_TURNS +
    task.turnExtraCount`.
  - `resolveSdkBudgetUsd()` reads ductum's `perRunHardUsd` and
    sets it as the SDK's `maxBudgetUsd`.
  - `error_max_turns` → `paused-max-turns` snapshot with
    pauseDetail.
  - `error_max_budget_usd` → `paused-cost-budget` snapshot with
    pauseDetail.
- `dispatcher-session.ts`:
  - `handleSessionEnd` routes paused exits to recoverable
    `markFailed` + custom failReason instead of stall.
  - `cleanupFailedOwnWorktrees` skips paused exits.
  - `cleanupStaleWorktrees` (D114 work) already covers the
    failReason prefixes added here.
- API routes `POST /api/runs/:id/turns-extend` and
  `/api/runs/:id/turns-deny`.
- CLI `ductum turns extend|deny|status`.
- Tests: dispatcher routing for both paused exits, turn-control
  unit + route tests, CLI command tests.

## Alternatives considered

1. **Treat max_turns as a stall and let the operator `retry`.**
   Rejected. Stalled→retry loses the 5-min heartbeat-timeout lag
   AND drops the worktree on session-end before retry can grab it.
   The operator-visible UX becomes "wait, then re-pay for everything
   the agent already did." The 2026-05-01 incident proved this is
   too lossy.

2. **Auto-extend turns by a multiplier when max hits.**
   Rejected. Anti-product: silently bypassing operator approval
   on a runtime resource is exactly what Edictum's wedge says
   not to do.

3. **Make every exit reason a gate (heartbeat timeout, crashed,
   etc.).**
   Deferred. Genuine crashes and stalls usually indicate a real
   problem; mechanical retry is reasonable. If a class of these
   turns out to be recoverable in practice, fold it into D118 with
   another `paused-*` exit reason.

## Out of scope (future work)

- `error_max_structured_output_retries` — the SDK can't conform to
  the requested schema. Probably not extendable; treat as crash.
- `error_during_execution` — generic execution error. Not a cap.
- Heartbeat timeout — agent is alive but not heartbeating. Could
  be a gate ("the agent is unresponsive — wait, force-kill, or
  retry?") but most cases are stuck Bash subprocess calls. Defer
  until we see this bite recoverably.
- Persistent session reattach across `pnpm serve` restarts (P3.1).
  Without it, "extend" today means "redispatch with bigger cap and
  same worktree dir" rather than "true resume." When 3.1 lands,
  the resume becomes seamless.

## Consequences

- The factory no longer drops work silently on the two cap
  failures it has actually been bitten by.
- Operator-visible surface is uniform: `ductum budget` and
  `ductum turns` are parallel, not bespoke.
- Worktree preservation is now the default for any recoverable
  pause; `ductum cleanup` honors all three failReason prefixes
  introduced by D114 + D118.
- The cumulative session cost on P3 (~$99) becomes the last time
  this class of bug eats real money.
