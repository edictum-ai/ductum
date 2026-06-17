# Reliability, Recovery & Autonomy — the self-running, self-healing, fully-legible factory

> Ductum redo · pillar design · 2026-06-17

Today the factory survives a restart only by reattaching dead scaffolding (no shipped adapter implements `tryReattach`) or by throwing away all progress: a crashed run re-queues the whole task to `ready`, re-dispatched as a fresh Run at stage `understand` with a fresh worktree (`dispatcher-session.ts:209-251`, `dispatcher-spawn.ts:73-78,194,294`), losing every committed gate, the evidence, the cost, and the diff. Live ownership of "what is running" lives only in an in-memory `activeSessions` Map, so two ticks or two processes could double-drive the same run, and the evidence write that would prove progress is itself non-idempotent (`evidence.ts:75-82`), so retrying duplicates or throws. The target is an autonomous factory where every run/work state and the single "what to do next" are always derivable from durable state — never log archaeology — and where recovery resumes from the last durably-committed checkpoint under a fenced lease, with poison-task quarantine, graceful drain, and escalation to a human only when a human is genuinely needed. We get there by introducing four new in-place seams behind the existing solid spine (RunStateMachine, DAG, dispatcher loop all rate KEEP): a durable Lease+Fence ledger, a per-stage Checkpoint store keyed by an idempotent gate-commit, a Reconciler that converges externalized state vs live runtime, and an Autonomy supervisor that owns dispatch/recover/quarantine/drain/escalate. This is a strangler redo: the state machine and DAG keep their jobs; recovery rewires around them, and one real dogfood flow (kill a Codex attempt mid-`implement`, restart, watch it resume from checkpoint at $0-replay cost rather than restart) routes through every new seam.

---

## Target shape

The autonomous factory is a control loop with one invariant: **every run state, work state, and the single "what to do next" decision is a pure function of durable SQLite state.** Live, non-serializable objects (`HarnessSession`, the per-run MCP server) become a *cache* of durable truth, never the source of it. Recovery is not a special path; it is the steady-state loop run against state that happens to have been written by a now-dead process.

Five durable primitives, layered behind the existing spine:

```
                 ┌────────────────────────────────────────────┐
                 │  AutonomySupervisor (new; owns the loop)     │
                 │  dispatch · recover · quarantine · drain ·   │
                 │  escalate — all decisions from durable state │
                 └───────┬───────────┬──────────────┬──────────┘
                         │           │              │
              ┌──────────▼──┐  ┌─────▼──────┐  ┌────▼─────────┐
              │ LeaseLedger │  │ Checkpoint │  │  Reconciler  │
              │  + fencing  │  │   store    │  │ (state↔live) │
              └──────┬──────┘  └─────┬──────┘  └────┬─────────┘
                     │               │              │
        ┌────────────▼───────────────▼──────────────▼───────────┐
        │ KEEP spine: RunStateMachine · DAGEvaluator · dispatch  │
        │ loop · WatcherManager · failed-lineage-cleanup         │
        └────────────────────────────────────────────────────────┘
```

---

## 1. Checkpoint / Resume (replaces retry-from-scratch)

**What changes vs today.** The REDESIGN row `recovery-interruption / Crash-stall retry policy` (high-risk) and `dispatch-runtime / Worker-death recovery` both describe the same defect: `retryOrFailStalledTask` re-readies the task and `dispatcher-spawn.ts` re-dispatches a *new Run at `understand`* with a *fresh worktree*. We replace "redo the whole task" with "resume the same attempt from its last durably-committed checkpoint."

**Target components.**

- **`RunCheckpoint` (new durable record, new migration).** One row written transactionally at every successful `gate_check` advance and at every validated evidence commit. Fields: `runId`, `taskId`, `attemptId` (see §2), `stage` (the gate just passed), `worktreePath` + `branch` + `pinnedHeadSha` (content-addressed — see Repo-Ref pillar), `evidenceHighWaterMark` (the last evidence id durably committed for this stage), `costToDateUsd`, `schemaVersion`, `committedAt`. This is the "last passed gate" the reference architecture's Checkpoint/Resume Engine (rated WEAK) demands.
- **Resumable-vs-rollback classification.** Stages split into `safely-resumable` (no in-flight irreversible side effect: `understand`, `implement`, `verify` pre-push) and `rollback-required` (`push`/`merge` mid-flight — must roll *back* to the last clean checkpoint, never forward-replay, because the side effect may have partially landed). The classifier is a small declarative table on the workflow definition, not agent-supplied.
- **Resume-at-checkpoint dispatch.** A new dispatch entry point `resumeAttempt(checkpoint)` that, instead of building a fresh worktree at `understand`, **rebinds the prior worktree** (the path is in the checkpoint, the HEAD is pinned by SHA so a moved remote can't silently change it) and sets the Edictum workflow runtime to the checkpointed stage via the existing `setStage()` forward primitive (D28-compliant — we never call `recordResult()`). The agent re-enters at `implement` with its prior diff intact, not at `understand` with nothing.

**Strangler steps.**
1. Add `RunCheckpoint` table + repo (write-only at first; no reader). Write a checkpoint on every gate advance. **No behavior change** — pure shadow recording. Verify checkpoints appear in `ductum status --json`.
2. Make the evidence commit idempotent (§3) so a checkpoint's `evidenceHighWaterMark` is meaningful.
3. Add `resumeAttempt`; route the *crash* branch of `retryOrFailStalledTask` to it when a checkpoint exists, falling back to today's fresh-Run path when none does. Keep the heartbeat-stall branch's no-auto-retry policy (defensible, but now legible — §6).
4. Dogfood: kill a Codex attempt mid-`implement`, restart `pnpm serve`, assert the run resumes on the same worktree at the checkpointed stage with the prior diff, not a new Run at `understand`.

**Scope Rule check.** The dogfood flow that breaks without this: *any* crash during a multi-stage attempt today silently discards a working diff and re-bills the whole task. That is the flow. Without checkpoint/resume the factory cannot be left unattended, which is the whole pillar.

---

## 2. Lease + Fencing tokens (anti split-brain on recovery)

**What changes vs today.** The reference architecture rates *Leasing with Fencing Tokens* MISSING and *Idempotency Keys* MISSING; `dispatch-runtime / In-process activeSessions map` is the fragile/high-risk REUSE that holds live ownership in memory. A per-session control-token is minted but it is auth, not a monotonic fencing token against a stale writer. After a crash, the truth of "who owns this run" evaporates; on restart the reconciler *rebuilds* `activeSessions` from memory it no longer has.

**Target components.**

- **`AttemptLease` (new durable record).** Each dispatched attempt holds a time-bounded lease: `attemptId`, `runId`, `ownerProcessId` (host+pid+boot-id), `fenceToken` (monotonic int64 from a single durable sequence), `expiresAt`, `renewedAt`. The dispatcher renews the lease on the same cadence as the existing heartbeat refresh (`refreshLiveSessionHeartbeats`).
- **`jobAttemptId` + idempotency key.** Every attempt gets a stable `attemptId` (one of the 6 missing runtime-correctness primitives). It is the idempotency key for dispatch: re-dispatching the same `attemptId` is a no-op if a non-expired lease exists. This closes "two ticks grab the same task" structurally — the single-flight `inFlightCycle` guard (`dispatcher-cycle.ts`) only protects one process; the lease protects across processes and across a crash boundary.
- **Fence-gated writes.** Every side-effecting write that recovery cares about — terminal-state transition, checkpoint commit, evidence commit, cost record — carries the attempt's `fenceToken`. The store rejects a write whose token is below the highest token seen for that run. A presumed-dead worker that wakes up post-recovery and tries to finish cannot corrupt the run a new owner has taken over. RunStateMachine grows a fence-checked variant of `updateTerminalState` (the machine stays the terminal-state owner — C4 — it just gains a guard).

**Strangler steps.**
1. Add `AttemptLease` table + a monotonic `fence_sequence`. Mint a lease + fence at dispatch alongside the existing session mapping (D25 keeps the dispatcher as sole owner). Shadow-only: nothing reads the fence yet.
2. Add fence guards to terminal-state, checkpoint, evidence, and cost writes (reject-and-log on stale token). Verify with a forced two-owner test (spawn, steal the lease, assert the original owner's late write is rejected).
3. Make resume (§1) acquire a *new* lease with a *higher* fence before rebinding the worktree.

**Scope Rule check.** The flow that breaks without this: §1 resume on its own re-introduces split-brain — if the original process isn't truly dead (a stalled-but-alive Codex), resume creates a second owner of the same worktree and both write evidence. Fencing is the minimum needed to make resume safe.

---

## 3. Exactly-once evidence + transactional gate commit

**What changes vs today.** `evidence-audit / Evidence persistence` is the REDESIGN: the INSERT (`evidence.ts:75-82`) is non-transactional and non-idempotent — retry duplicates or throws. The reference *Exactly-Once Side-Effect Boundary* is MISSING. A checkpoint is only trustworthy if the evidence it points at was committed exactly once.

**Target components.**

- **Idempotent evidence id.** Evidence ids become content-derived where the kind is replayable (`sha256(runId:stage:kind:canonicalPayload)`), so `INSERT … ON CONFLICT(id) DO NOTHING` makes a retried commit a no-op rather than a duplicate. This also gives evidence content-addressing (the reference *Durable Evidence Store* is WEAK partly for not being content-addressed) and dovetails with the clean-room **evidence-cassette** concept: record once, sha256-keyed, replay offline.
- **Transactional `commitGate(stage, evidence[], checkpoint)`.** One SQLite transaction wraps: write evidence (idempotent), advance the Edictum stage via `setStage()`, write the `RunCheckpoint`, all fence-guarded. Either the gate is fully durable or nothing moved. This is the atomic gate_check+evidence commit the inventory says is missing.

**Strangler steps.**
1. Switch replayable evidence kinds to content-derived ids + `ON CONFLICT DO NOTHING`. Keep monotonic ids for genuinely append-only kinds (operator notes). Verify double-commit yields one row.
2. Wrap the gate advance + evidence + checkpoint in one transaction in `enforce.ts`'s gate path. Verify a thrown error mid-commit leaves stage and evidence consistent (neither moved).

**Scope Rule check.** Without exactly-once, every resume (§1) risks either a duplicate-evidence throw on the first retried commit or a checkpoint pointing at evidence that was rolled back. The flow that breaks: resume after a crash that happened *during* a gate commit.

---

## 4. State Reconciler (converges externalized state vs live runtime)

**What changes vs today.** `Startup orphan reconcile (D121)` is KEEP/solid but its reattach branch is dead scaffolding — `tryReattach` is optional and no shipped adapter implements it (`dispatcher-reconcile.ts:134-138`), so every orphan degrades to `stalled` while the startup log *claims* reattach works. The reference *State Reconciler* is PARTIAL for exactly this reason. The API-side reconcile pass is REUSE but mixes live recovery with pre-D166 zombie cleanup.

**Target components.**

- **One reconciler, classification-first.** On startup *and* on schedule, the reconciler walks durable state and classifies each non-terminal run into exactly one disposition, each derivable from durable fields only: `resumable` (has checkpoint + worktree + pinned SHA → §1 resume under a fresh fenced lease), `completed-but-unrecorded` (worktree merged/pushed but run not marked done → finalize), `dead-claim` (lease expired, no live process → release lease, route to recover/quarantine), `genuinely-stalled` (heartbeat expired, no checkpoint → escalate). No branch silently no-ops; every disposition writes a `state-reconcile` evidence record with a stable, greppable reason (the existing pattern, kept).
- **Honest reattach.** Either ship a real reattach adapter for at least the Codex app-server (it has a persistable session id) **or** delete the `tryReattach` interface and make the log say "resuming from checkpoint" — which is now true. Recommended: delete reattach, lean on checkpoint/resume (§1), because resume-from-durable-state is strictly more robust than reattaching to a possibly-also-dead session and needs no adapter cooperation. This resolves the operator's "Recovery granularity" DECIDE fork toward *invest in checkpoint/resume, delete aspirational reattach*.
- **Reconciler owns the in-memory cache rebuild.** `activeSessions` is repopulated *only* for runs the reconciler classifies as live with a valid lease; everything else is driven from durable state. The Map becomes a derived cache, neutralizing the high-risk `activeSessions` REUSE coupling without rewriting the dispatcher.

**Strangler steps.**
1. Refactor `dispatcher-reconcile.ts` from reattach-or-stall into classify-into-four-dispositions (keep the evidence-recording skeleton). Verify each disposition with a seeded DB fixture.
2. Delete the dead `tryReattach` interface + the overstated startup log (or implement it for Codex — operator fork).
3. Fold the genuinely-live branches of the API-side `reconcile-pass.ts` into this reconciler; mark the pre-D166 zombie-shape branches for deletion once migration is behind us (the REUSE row's recommendation).

**Scope Rule check.** Without the reconciler, §1 and §2 have no entry point after a crash — nothing decides which durable runs to resume, finalize, or quarantine. This is the seam that turns "we wrote checkpoints" into "we recover."

---

## 5. The Autonomy loop (auto-dispatch · recover · quarantine · drain · escalate)

**What changes vs today.** The pieces exist but aren't a coherent autonomous loop: `Poison-Task Quarantine` is PARTIAL (retry budget exists, but failed and poison collapse into one `failed` state), `Orphaned-Resource Reaping & Graceful Drain` is PARTIAL (per-cycle worktree GC exists, no drain-on-deploy), and escalation is implicit (operator must read logs to learn a heartbeat-stall won't retry).

**Target components.**

- **`AutonomySupervisor`** — a thin policy layer over the KEEP dispatch loop. Each tick it asks durable state four questions and acts: *(a)* what's `ready` and unleased → dispatch; *(b)* what has an expired lease or stale checkpoint → recover (§4); *(c)* what has exhausted its retry budget → **quarantine**; *(d)* are we draining → stop admitting, let in-flight reach a checkpoint.
- **Poison-task quarantine as a distinct terminal state.** New `quarantined` work-state (distinct from `failed`), entered when an attempt exceeds `maxTaskRetries` *and* its failures are classified deterministic (same gate fails the same way N times) rather than transient. Quarantined tasks leave the ready queue (no head-of-line blocking) and become an inbox item, not a silent re-loop. The existing regex failure-classifier (the `dispatch-agent-health.ts` soft spot) gets one job: transient-vs-deterministic, surfaced as durable state.
- **Graceful drain.** A `draining` factory state: the supervisor stops admitting new work, lets each in-flight attempt run to its next checkpoint (bounded by a drain deadline), then exits clean. On the next boot the reconciler resumes them. This makes deploys safe — the most-forgotten Day-2 capability per the reference architecture.
- **Auto-escalate, narrowly.** The supervisor escalates to the operator *only* when durable state says a human is genuinely required: an approval gate (already wired), a quarantined task, a budget/turn hard stop (already wired — D114/D118), or a `genuinely-stalled` reconcile disposition. Everything else — crash, transient failure, stale slot, drain-resume — is handled autonomously and is *visible* but not *actionable*. This is the "escalate only when a human is needed" contract.

**Strangler steps.**
1. Extract the supervisor as a wrapper around the existing `cycleOnce()` — it *calls* today's dispatch, adds the recover/quarantine/drain questions. No dispatch rewrite (the 6-level inheritance REDESIGN is handled in the Dispatch pillar; here we compose over it).
2. Add the `quarantined` state + migration; route exhausted-retry deterministic failures to it. Verify a deterministically-failing task quarantines instead of looping, and appears in the needs-you inbox.
3. Add `draining`; wire `SIGTERM` → drain. Verify in-flight attempts checkpoint and resume across a restart.

**Scope Rule check.** Without quarantine, one poison task burns the retry budget and the operator's bill on a loop; without drain, every deploy either kills in-flight work or blocks. Both are concrete dogfood pains today.

---

## 6. State-legibility (close the silent-skip and $0-cost gaps)

**What changes vs today.** Multiple `partial`/`high` operator-legibility rows: mid-cycle dispatch skips are "silent and only inferable from logs" (`dispatch-runtime / Poll cycle`), an agent in cooldown "silently stalls in the queue" (agent-health), heartbeat-stall's no-retry policy is log-only, and `cost recording / $0 for Codex` is the high-risk silent-zero. The reference *Unified Run-State View* is HAVE but undermined by these.

**Target components.**

- **`whatToDoNext` is a pure function of durable state.** A single derivation that, for any run/task, returns one of a closed set: `{running, waiting-on-dependency, waiting-on-approval, blocked:<reason>, retrying:<n/max>, quarantined, draining, resumable, needs-operator:<reason>}`. The operator (and CLI/UI/notifications) read this; nobody reads logs. Every "silent skip" today becomes a durable, named reason: agent-in-cooldown → `waiting-on-agent`, worktree contention → `waiting-on-slot`, no-auto-retry → `needs-operator:heartbeat-stall`.
- **Skip-reason persistence.** The dispatch cycle writes the reason it skipped a task (not just a warn log) so `ductum status` shows "task X not dispatched: only agent in cooldown until 14:32" without log archaeology.
- **`unmeasured` cost is durable, not zero.** Adopt the model-pricing layer's existing `unmeasured` contract end-to-end: when the scanner misses and the harness reports nothing (the Codex-$0 case), persist `cost.state = 'unmeasured'` instead of `0`. The cost surface and inbox distinguish "free" from "we don't know," closing the silent-$0 gap. This is the cost-ledger primitive the pillar owes.

**Strangler steps.**
1. Add the `whatToDoNext` derivation in core; back the CLI `status` and the dashboard inbox with it (one source). Verify the closed set is exhaustive against a fixture of every run shape.
2. Persist skip reasons in the dispatch cycle. Verify a cooldown'd-agent task shows its reason in `status` with zero log reads.
3. Add `cost.state:'unmeasured'`; thread it through `recordSessionCost` (`dispatcher-session.ts:277-299`) and the cost surface.

**Scope Rule check.** The autonomy contract — "operator never reads raw logs" — is *defined* by this section. Without legible durable state, all of §1-§5 are invisible and the operator falls back to log archaeology, defeating the pillar.

---

## What this advances

- **Autonomous:** the supervisor + reconciler + checkpoint/resume let the factory run, crash, restart, and recover unattended; humans are pulled in only by the four real escalation triggers.
- **Better shape:** four clean durable seams (lease, checkpoint, reconciler, supervisor) sit *behind* the KEEP spine; the in-memory `activeSessions` coupling and the dead reattach scaffolding are neutralized without a dispatcher rewrite.
- **Extensible:** fencing + idempotency + content-addressed evidence + a sealed resumable bundle are exactly the primitives the reference architecture says local→SaaS needs; remote workers later present a fence token instead of sharing a process.
- **UI/legibility:** `whatToDoNext` as a pure function of durable state is the single backing for the Bloomberg-terminal run-state view, the needs-you inbox, and notification routing.

## Key decisions (this pillar)

- **Reattach to live harness sessions, or delete reattach and rely on checkpoint/resume? (resolves the operator's 'Recovery granularity' DECIDE fork)** — _Delete the dead `tryReattach` interface and the overstated startup log; make recovery resume-from-durable-checkpoint only. Optionally keep a Codex-only reattach later as a latency optimization, never as the recovery foundation._. No shipped adapter implements `tryReattach` (dispatcher-reconcile.ts:134-138); it is scaffolding that misleads the operator. Resume-from-durable-state is strictly more robust — it needs no adapter cooperation and works even when the original session is also dead. Building real reattach is more work for a weaker guarantee.
- **Should poison/deterministic failure be a distinct terminal state, or stay folded into `failed`?** — _Add a distinct `quarantined` state separate from `failed`, entered on exhausted retry budget with deterministic (not transient) failure classification._. The reference architecture rates Poison-Task Quarantine PARTIAL precisely because failed and poison collapse together, so a deterministically-failing task silently re-loops, burns the retry budget and the bill, and can head-of-line block. A distinct state makes it an inbox item the operator actually sees and removes it from the ready queue.
- **Where do fencing tokens get enforced — every write, or only the irreversible ones?** — _Fence-guard the recovery-critical writes only: terminal-state transitions, checkpoint commits, evidence commits, cost records. Leave read-mostly and append-only-note writes unguarded._. Honor the Scope Rule: a fence on every write adds ceremony without naming a flow it protects. The split-brain risk is specifically a stale owner finalizing/checkpointing/double-evidencing a run a new owner took over — exactly the four writes above. Guarding more buys nothing and complicates the hot path.
- **Idempotent evidence ids — content-derived for all kinds, or only replayable kinds?** — _Content-derive ids (sha256 of runId:stage:kind:canonicalPayload) for replayable evidence kinds and use INSERT ... ON CONFLICT DO NOTHING; keep monotonic ids for genuinely append-only kinds like operator notes._. Replayable kinds (test output, CI result, gate evidence) are the ones a retry re-emits, so content-addressing makes the retry a no-op and gives free content-addressing for the evidence store (rated WEAK for lacking it). Operator notes are intentionally append-only and must not dedupe identical text.
- **Does the AutonomySupervisor replace the dispatcher loop or wrap it?** — _Wrap it. The supervisor composes over the existing KEEP `cycleOnce()`, adding recover/quarantine/drain/escalate questions; the dispatcher's own structural REDESIGN (6-level inheritance, 16-arg ctor) is handled by the Dispatch pillar._. Strangler discipline: the dispatch loop shape is rated KEEP/solid. Rewriting it to add autonomy would couple two changes and inflate blast radius. Wrapping lets autonomy ship and be dogfooded while the inheritance cleanup proceeds independently.

**Dependencies:** DEPENDS ON: (1) Repo-Ref / content-addressed pinned SHA pillar — the checkpoint's `pinnedHeadSha` and worktree rebind require pinned refs to be safe across a moved remote. (2) The sealed-job-bundle work (AttemptRuntimeSnapshot, REUSE — seals ~7/9 fields) — resume rehydrates from the snapshot; this pillar adds `attemptId`, fence token, checkpoint pointer, and `schemaVersion` to that bundle. (3) Evidence pillar must accept content-derived ids + ON CONFLICT semantics (shared with §3). (4) D28 storage contract — resume uses `setStage()` forward only, never `recordResult()`. BUILDS ON (KEEP, unchanged): RunStateMachine (terminal-state owner, C4), DAGEvaluator readiness, WatcherManager CI/review latch (C6), failed-lineage-cleanup, dispatch single-flight loop. UNBLOCKS: the Operator-Surfaces pillar (`whatToDoNext` is the single backing for run-state view / inbox / notification routing) and the future remote-worker / SaaS transport (fencing + idempotency + sealed resumable bundle are the prerequisites the reference architecture names for local→SaaS). SHARES with Cost pillar: the durable `unmeasured` cost-state contract (§6).

**Risks:** RISK 1 — Resuming onto a corrupt or diverged worktree. A checkpointed worktree could be left in a bad mid-edit state by the crash. De-risk: pin HEAD by SHA in the checkpoint (content-addressed), classify `push`/`merge` stages as rollback-required (never forward-replay an irreversible side effect), and have the reconciler fall back to today's fresh-Run path when the worktree fails a cleanliness probe — checkpoint/resume is an optimization over a safe baseline, not a replacement for it.
RISK 2 — Fencing introduces a new way to wedge a run (a live owner whose lease lapsed under load gets its legitimate write rejected). De-risk: renew leases on the existing heartbeat cadence with generous expiry (2x heartbeat, matching the existing stale-slot GC constant), and on a rejected-fence write the owner stops cleanly and lets the reconciler re-adjudicate rather than retrying blindly.
RISK 3 — Migration of in-flight pre-checkpoint runs. Runs already mid-flight when this ships have no checkpoint. De-risk: the resume path already falls back to the fresh-Run path when no checkpoint exists, so the change is strictly additive — old runs degrade to today's behavior, new runs get resume.
RISK 4 — Quarantine misclassification (a transient failure wrongly quarantined, or a deterministic one wrongly retried forever). De-risk: the transient-vs-deterministic classifier reuses and narrows the existing failure-regex (a known soft spot) to exactly one decision, surfaces that decision as durable legible state (§6) so the operator can see and override it, and defaults to transient (retry) on ambiguity — bias toward autonomy continuing, escalate only on repeated identical-gate failure.
RISK 5 — The `whatToDoNext` closed set drifts incomplete (a run shape maps to no state, producing a blank inbox row). De-risk: make the derivation total over a fixture of every run shape with an exhaustiveness test; an unmapped shape is a CI failure, not a silent gap.
RISK 6 — Scope creep toward distributed-systems machinery the single-laptop factory doesn't yet need. De-risk: apply the Scope Rule per section (each §names the dogfood flow that breaks without it); fence-guard only the four recovery-critical writes; keep the supervisor a thin wrapper, not a rewrite.
