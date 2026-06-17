# Recovery & Interruption

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

Recovery is split across three layers: (1) in-memory orphan-session reconcile at server restart, (2) the RunStateMachine that owns terminal states + heartbeat stalls, and (3) DB-level reconcile passes in edictum-api for zombie/stale-approval shapes. The state machine and lineage/stale-slot GC are solid and C4-compliant. Two real weaknesses dominate: the crash-retry path throws away all progress (re-queues a fresh Run at 'understand' with a fresh worktree, no checkpoint), and the much-advertised session-reattach path is dead scaffolding — tryReattach is optional on the adapter interface and no shipped harness implements it, so every orphaned run is stalled on restart. Operator legibility of the stall reasons is good; legibility of the silent no-op reattach is poor.

## Orphan session reconcile (restart reattach)
- **What:** On `pnpm serve` restart, walks every active non-terminal run and either reattaches to its live harness session via `adapter.tryReattach` or marks it stalled with an explicit, grep-stable reason; records a `state-reconcile` evidence record per affected attempt.
- **Where:** `packages/core/src/dispatcher-reconcile.ts:82-184` (reattach/stall logic), `:219-237` (stallOrphan), `:239-286` (evidence); wired at `packages/api/src/index.ts:550-566`.
- **Maturity:** live-peripheral
- **Quality:** fragile — the reattach branch is effectively dead: `tryReattach` is an optional method on `HarnessAdapter` (`dispatcher-support.ts:105`) and grep shows no implementation in `packages/harness/src`. Every orphaned run therefore falls to `stallOrphan` (`:134-138` "no tryReattach" or `:126-132` "no harnessSessionId"). The stall path itself is sound, idempotent, and well-instrumented.
- **Operator-legibility risk:** partial — stall reasons (`ORPHANED_REATTACH_FAILURE_REASON`, `ORPHANED_NO_MAPPING_FAILURE_REASON`) are stable and surfaced in `ductum status`, but the startup log and code comments (`index.ts:551-554`) imply reattach is a working capability when in practice it always no-ops to stall, which misleads the operator about what actually happened.
- **Dependencies:** RunStateMachine.markStalled, SessionRunMappingRepo, harnessAdapters map, per-run MCP server creation (D27); relies on session mapping being persisted with `harnessSessionId`.
- **Disposition (recommended):** REUSE — the stall-and-record skeleton is the right shape and honors D27; the reattach capability needs a real adapter implementation before it can be claimed. Keep the structure, treat reattach as unimplemented.
- **Flags:** legacy/aspirational — `tryReattach` reattach path is unimplemented scaffolding; comments/logs overstate the capability.

## RunStateMachine (terminal-state owner)
- **What:** Ductum-owned state machine for terminal transitions (failed/stalled/cancelled/done) plus heartbeat liveness and the explicit factory-owned `recordStageReset` path; Edictum's workflow runtime owns forward stage progression.
- **Where:** `packages/core/src/state-machine.ts:16-202`; `markStalled:46`, `recordStageReset:128`, `checkStalledRuns:165`, `isHeartbeatExpired:190`.
- **Maturity:** live-core
- **Quality:** solid — small, single-responsibility, every transition emits a record event and writes stage history; `recordStageReset` is kept distinct from `recordStageAdvance` precisely so backward (reset) transitions are explicit (C4 — factory owns resets, not agents).
- **Operator-legibility risk:** none — transitions are recorded to stage history and events with reasons.
- **Dependencies:** RunRepo, RunStageHistoryRepo, DuctumEventEmitter; consumed by dispatcher-session, dispatcher-reconcile, stale-slot-gc, failed-lineage-cleanup.
- **Disposition (recommended):** KEEP — clean, correct, C4-compliant; the established "runtime split is KEEP" finding holds here.
- **Flags:** none

## Crash/stall retry policy (retryOrFailStalledTask)
- **What:** On a crashed/timed-out session, marks the run stalled then re-readies the task with capped retries + backoff; on a heartbeat-stall it marks the task failed with no auto-retry (P3 policy). A re-readied task is later re-dispatched as a brand-new Run at stage `understand` with a fresh worktree.
- **Where:** `packages/core/src/dispatcher-session.ts:209-251`; crash branch at `:69-72`; new Run created at `packages/core/src/dispatcher-spawn.ts:73-78` and `:294` (`stage: 'understand'`) with fresh worktree at `:194`.
- **Maturity:** live-core
- **Quality:** fragile — retry is "redo the whole task from scratch": no evidence checkpoint, no resumed worktree, no atomic gate_check+evidence write, so all prior progress and cost are discarded. Crash and heartbeat causes diverge (crash retries, heartbeat does not), which is defensible but asymmetric and easy to misread.
- **Operator-legibility risk:** high — operator sees a new Run id at `understand` with a new worktree and no obvious linkage to the work already done; the lost progress is implicit, not surfaced.
- **Dependencies:** TaskRepo retry counters (retryCount/retryAfter), resolvedConfig.maxTaskRetries + retryBackoffScheduleMs, DAG re-evaluation, dispatcher-spawn for the re-dispatch.
- **Disposition (recommended):** REDESIGN — confirms the prior finding: retry-as-fresh-run-from-understand is wasteful and opaque; needs checkpoint/resume semantics and clearer lineage, not a rewrite of the state machine.
- **Flags:** bug-adjacent — silent cost/progress loss on every crash retry; crash-vs-heartbeat asymmetry undocumented at the call site beyond a log line.

## Heartbeat stall detection & stale-slot GC
- **What:** Two liveness sweeps in the dispatcher loop: `checkStalled` marks runs whose heartbeat expired (skipping finishing/sessionless runs) and `gcStaleSlots`/`closeStaleSlots` auto-closes zombie slots at 2x the heartbeat timeout.
- **Where:** `packages/core/src/dispatcher-session.ts:140-155` (checkStalled), `:173-187` (gcStaleSlots); `packages/core/src/dispatcher-stale-slot-gc.ts:19-44`; `state-machine.ts:165` (checkStalledRuns).
- **Maturity:** live-core
- **Quality:** adequate — the `shouldSkip` predicate correctly excludes runs without a live session so legitimately-pending downstream work isn't killed; stale-slot GC emits a `slot.auto_closed` event and routes through retry. Two overlapping timers (heartbeat vs 2x-heartbeat GC) cover the same failure class, which is belt-and-suspenders but slightly redundant.
- **Operator-legibility risk:** partial — `stale_slot_gc` failReason is set, but the operator must know that a stale slot collapses into the same crash-retry-or-fail path as a heartbeat stall.
- **Dependencies:** RunStateMachine.checkStalledRuns/markStalled, WatcherManager.stopWatchers, isWorkflowOwnedRun guard, retryOrFailStalledTask.
- **Disposition (recommended):** KEEP — works and is guarded against false positives; minor redundancy is not worth disturbing.
- **Flags:** none (minor: heartbeat-stall and stale-slot GC are two paths to the same outcome).

## WatcherManager (CI/review latch lifecycle)
- **What:** Spawns and tears down the parallel CI + review watcher pair for a run after it ships, deduping by commit SHA so a re-ship of the same commit doesn't double-spawn; stops watchers on stage transitions to implement/done or on kill/stall.
- **Where:** `packages/core/src/watcher-manager.ts:48-138`; spawn dedup at `:54-57`, stop on stage at `:124-138`.
- **Maturity:** live-core
- **Quality:** solid — event-driven, commit-SHA dedup honors D26, requires branch+commit+prUrl before spawning, resets latch statuses to pending on (re)spawn, disposes cleanly.
- **Operator-legibility risk:** none — latch statuses (ciStatus/reviewStatus) are persisted to the run.
- **Dependencies:** CIWatcher + ReviewWatcher, RunRepo latch status, event emitter subscription; `onWatcherResolved` callback drives workflow reset on failure (C6 parallel latches).
- **Disposition (recommended):** KEEP — correct expression of C6 (CI and review as independent latches before the merge gate).
- **Flags:** none

## Failed-lineage cleanup
- **What:** When a run/task lineage fails, closes all descendant runs and tasks in that lineage (by name lineage matching), skipping any that still have a live session, and dispositions the current run as done/failed.
- **Where:** `packages/core/src/failed-lineage-cleanup.ts:28-122`; live-session skip at `:54-57` and `:93-94`; task status resolution at `:111-118`.
- **Maturity:** live-core
- **Quality:** solid — guards against clobbering runs with live sessions, idempotent (skips already-terminal/already-correct states), derives task status from constituent run states.
- **Operator-legibility risk:** partial — cascade failures across a lineage are emitted as individual task/run status events but the "why" (a sibling root failed) is carried only in the passed `reason` string.
- **Dependencies:** TaskRepo lineage list, RunRepo, RunStateMachine.markFailed/markDone, task-lineage helpers (isTaskInLineage/lineageOriginalName), hasLiveSession predicate.
- **Disposition (recommended):** KEEP — correct, guarded cascade-close; fits the current Spec/Task/Attempt lineage model.
- **Flags:** none

## API-side DB reconcile pass (zombie/stale-approval recovery)
- **What:** A separate edictum-api-layer reconcile that scans persisted runs/tasks for stale shapes — recoverable stale-slot approvals, orphaned runs past a threshold, and completion side-effects — and converges DB state, with audit records and a dry-run mode.
- **Where:** `packages/api/src/lib/reconcile-pass.ts:29-281`, `reconcile.ts`, `reconcile-stale-approval.ts`, `reconcile-scan.ts`, `reconcile-side-effects.ts`; comment at `reconcile-pass.ts:28` ("Recovery for older zombie DB shapes; not general success inference").
- **Maturity:** live-peripheral
- **Quality:** adequate — well-decomposed (scan/orphans/side-effects/audit each in its own module, all under the 300-LOC cap), audited, dry-runnable, heavily tested (10+ reconcile test files). The explicit "older zombie DB shapes" framing signals this partly exists to clean up pre-redesign data, so some branches may be legacy-migration cruft.
- **Operator-legibility risk:** partial — reconcile produces audit records and a status route, but distinguishing "live recovery" from "legacy zombie-shape cleanup" requires reading the audit detail.
- **Dependencies:** ApiContext repos, git merge-commit lookup, reconcile-audit; exposed via reconcile-status routes.
- **Disposition (recommended):** REUSE — sound recovery layer, but audit which branches are still live recovery vs one-time pre-D166 zombie-shape cleanup and prune the latter behind a clearer boundary.
- **Flags:** legacy — some paths exist for "older zombie DB shapes" predating the operational-model redesign; candidate for scoping/pruning once migration is fully behind us.
