# D173 — Quarantine terminal state + whatToDoNext (phase2 autonomy legibility)

**Date:** 2026-06-18
**Decided by:** Arnold + Claude (stream F worker, `stream/p2-autonomy-legibility`)
**Linked:** `design/04-autonomy-recovery.md` §5/§6, `design/parallel/phase2-autonomy-legibility.md`, `design/parallel/PHASE2-PLAN.md` (stream F)
**Builds on:** D166 (operational model redesign), D042 (run checkpoints / halted-resumable states), reconciler stream (D-E, startup dispositions)

## Context

Phase 2 closed provider/account failover identity, checkpoint resume, transactional
gate commits, lease fencing, and a truthful startup reconciler. The factory still
lacked one durable answer to "what happens next": deterministic poison failures
collapsed into generic `failed`, operators inferred queue skips and heartbeat
stalls from logs, CLI and dashboard each derived their own next action, and there
was no thin legibility layer. This stream implements the narrow §5/§6 slice.

## Decisions

1. **Quarantine is a RUN terminal state, not a TaskStatus.** `quarantined` was
   added to `TerminalState` and `runs.terminal_state` (migration `045`, an
   unconditional `runs` rebuild widening only the terminal-state CHECK). The task
   side is intentionally untouched: a quarantined task is not redispatched because
   `getReady` selects only `status = 'ready'`, so no `tasks` rebuild (whose status
   CHECK is still the original from `001`) is needed.

2. **A quarantined task is left `active`, not `failed`.** The needs-operator
   queries (CLI `listNeedsOperatorRuns`, API `countNeedsOperatorRuns`) filter
   `task.status = 'active'` — that is the existing "run died, needs operator"
   convention (the `exitReason='failed'` path leaves the task active too). Setting
   a quarantined task `failed` would have **hidden** it from those queries, so the
   deterministic-exhaustion branch marks the RUN `quarantined` and leaves the task
   `active`. (Transient-exhaustion keeps the old behavior: task `failed`.)

3. **Deterministic = non-recoverable AND recurring.** `classifyRetryExhaustion`
   quarantines only on positive evidence: the failure is not recoverable
   (`!isRecoverableAgentFailure`) AND the same normalized `failReason` recurred on
   a prior retry run (read from durable run history). Heartbeat stalls,
   recoverable/provider/infra reasons, `forceTransient`, and empty/synthetic
   reasons are all transient. Bias is deliberately toward not quarantining on
   ambiguity (design/04 RISK 4).

4. **Crash `failReason` is now persisted to the run row.** Previously
   `result.failReason` went only to the in-memory agent-health record, so the run
   row held a stale value and recurrence could not be read durably. The crash
   branch now threads `result.failReason` into `retryOrFailStalledTask`, which
   persists it via `updateFailure` before classifying. This closes a pre-existing
   data-quality gap the classifier depends on.

5. **Provider-backoff / failover exhaustion never quarantines.**
   `waitAndResume` (transient + recoverable-external outcomes) and the
   failover-budget-exhaustion freeze path pass `forceTransient` (or freeze
   directly), so a repeating "provider unavailable" can never be misclassified as
   poison — exactly the "keep provider/transient out of quarantine" rule.

6. **`whatToDoNext` is the single core derivation; surfaces consume it.** A pure
   `whatToDoNext(run, task, opts)` is total over every terminal state and the
   non-terminal ladder. CLI `deriveRunStage` delegates the terminal mapping to
   core `deriveDisplayStatus` (no duplicated status logic); CLI
   `listNeedsOperatorRuns` and the needs-operator decision read
   `whatToDoNext(...).needsOperator`. An exhaustiveness test uses
   `Record<NextActionKind, Fixture>` so an added kind without a fixture is a type
   error.

7. **`markQuarantined` only widens `stalled`/`failed` → `quarantined`.** It rejects
   active, paused, frozen, cancelled, and done runs, and is fenceable via the
   existing pattern. C4 holds: the transition is state-machine owned, never
   agent-driven.

8. **`state-machine.ts` was split** (fenced-write helpers →
   `state-machine-fenced.ts`) to keep it under the 300-LOC gate after adding
   `markQuarantined`.

9. **`AutonomySupervisor` + graceful drain + SIGTERM are deferred** to a follow-up
   stream. The brief phrases the supervisor conditionally ("if it spreads, record
   it as the next stream"); wiring it into the live dispatcher/serve path is
   exactly that spreading, and every mandatory task (quarantine, `whatToDoNext`,
   legibility) stands without it. Quarantine routing lives inside the existing
   `retryOrFailStalledTask`.

10. **Skip-reason exposure is layered by where the data lives.** Run-level halts
    (approval, budget/turn freeze, resumable checkpoint, quarantine, stall) are
    exposed via the `whatToDoNext` reason — durable, no logs. Dispatch-cycle skips
    (agent-busy, worktree-contention, retry-backoff) are exposed via deduped
    `task.dispatch_skipped` events (the in-memory data exists at skip time; the
    event stream is the existing exposure channel). **Durable persistence of
    agent-cooldown / worktree-contention as new tables is flagged for a follow-up**
    — that data does not exist durably today, so it is out of scope for the "where
    the data already exists" rule.

11. **Display widening fixed a latent bug.** `paused` and `frozen` (shipped in
    D042) were never handled by `deriveDisplayStatus` and silently rendered as
    `running`. This stream maps every terminal state explicitly across core
    `DisplayStatus`, the API `RunUiStatusKey` wire type, and the dashboard
    `DisplayStatus`, adding `quarantined`. `frozen` is needs-operator (a system
    halt awaiting an operator); `paused` is not (operator-initiated).

## Alternatives considered

- **Task-level `quarantined` status.** Rejected: requires rebuilding the `tasks`
  table (CHECK from `001` never widened), higher migration risk, and no dispatch
  benefit since `getReady` already filters `status = 'ready'`.
- **Quarantine sets the task `failed`.** Rejected (see decision 2): `failed` tasks
  are excluded from the `task.status = 'active'` needs-operator queries, making
  quarantined runs invisible — the opposite of the design intent.
- **Positive-pattern poison classifier** (a narrow regex of known poison
  signatures). Rejected in favor of recurrence-based determinism: it is more
  faithful to "same gate fails the same way N times" and produces fewer false
  positives (anything unmatched defaults to transient).
- **`AutonomySupervisor` in this stream.** Rejected (see decision 9).

## What this does NOT change

- `refreshRunFromWorkflow`'s `done` guard (untouched).
- Fencing scope (no new fence guards; `markQuarantined` reuses the existing
  fenced-write pattern only).
- The dispatcher inheritance stack (the supervisor REDESIGN belongs to the
  Dispatch pillar).
- Cost accounting (no schema/API churn; the `unmeasured` legibility thread is left
  to the cost follow-up).
- `tryReattach` / `ORPHANED_` symbols remain absent (reconciler stream removed
  them).
