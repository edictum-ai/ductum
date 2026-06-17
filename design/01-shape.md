# Target Shape & Layered Architecture: Control-Plane / Data-Plane Split, the Sealed Job Bundle Seam, and the Dispatcher Decomposition

> Ductum redo · pillar design · 2026-06-17

The target shape is an explicit control-plane / data-plane separation mapped onto the 11 reference layers, where the control plane owns all durable state, scheduling, enforcement adjudication, and operator surfaces, and the data plane (executors) consumes exactly one immutable contract: the Sealed Job Bundle. The Bundle is the central seam — a content-hashed, schema-versioned consolidation of today's AttemptRuntimeSnapshot plus the two missing fields (scoped-secret mount + declarative allowed-tools) and the six runtime-correctness primitives (jobAttemptId/idempotency key, pinned content-addressed repoRef, renewable lease+fencing token, exactly-once evidence commit ref, schemaVersion, explicit cancellation token). Every executor — local Claude SDK today, remote container tomorrow — becomes an interchangeable backend behind that one wire contract, which is what unblocks the laptop-to-SaaS path without a rewrite. The structural-smell fix is concrete: kill the 6-level DispatcherBase inheritance + ~16-arg positional ctor by decomposing into ~6 composed single-responsibility services wired through one options-object/DI container, and externalize the in-memory activeSessions Map behind a durable LiveRunRegistry boundary so "what is running now" is reconstructable from the store, not just process memory. This is a strangler redo: the new boundaries (Bundle interface, LiveRunRegistry, composed dispatch services, control/data-plane package split) are introduced in place around KEEP/REUSE code, REDESIGN code is reworked behind them, REMOVE code is deleted, and one real dogfood flow (attempt start → spawn → gate_check → complete) is routed through each new seam before the old path is retired. The moat (in-process authorize_tool, gate_check, C1-C7) sits unchanged at the enforcement layer; this pillar is the backbone the secret-broker, recovery, exactly-once, and UI pillars hang on.

---

## 1. Target Shape: Control Plane / Data Plane

Ductum today is one process where the dispatcher holds live, non-serializable `HarnessSession` objects in an in-memory Map and reaches directly into harness adapters. The reference architecture (`inventory/REFERENCE-ARCHITECTURE.md`, headline) is explicit that "a factory that runs autonomous agents at scale is a distributed control system, not an agent runner." The target shape makes that split structural.

```
┌─────────────────────────────────────────────────────────────┐
│  CONTROL PLANE  (owns all durable truth + adjudication)      │
│                                                              │
│  Intake/Planning · Work-State+Transition Owner · Scheduler   │
│  Enforcement adjudication (authorize_tool/gate_check) ·      │
│  Evidence/Audit store · Approval/Merge orchestrator ·        │
│  Recovery/Reconcile · Cost ledger · Operator surfaces        │
│                                                              │
│   emits ──► SEALED JOB BUNDLE (immutable, hashed, versioned) │
│   consumes ◄── evidence + heartbeats + lifecycle events     │
└───────────────────────────┬─────────────────────────────────┘
                            │  one wire contract, both directions
┌───────────────────────────┴─────────────────────────────────┐
│  DATA PLANE  (interchangeable executors)                     │
│                                                              │
│  HarnessAdapter (Claude SDK local · Codex · future:          │
│  container/remote) — receives Bundle, runs the agent,        │
│  routes EVERY tool call back through authorize_tool,         │
│  streams events, reports evidence + cost. Owns NO truth.     │
└──────────────────────────────────────────────────────────────┘
```

**The hard rule that makes this real:** the data plane never holds authoritative state. Today `activeSessions` *is* authoritative ("the truth of what's running lives only in memory until reconcile runs" — `domains/01`, op-risk high). In the target, the control plane's durable store is authoritative and the data plane is reconstructable from it. This is the precondition for every distributed-safety pillar.

The enforcement moat is **unchanged and unmoved**: `authorize_tool` stays in-process, fail-closed, before the side effect; `gate_check` stays evidence-validated; C1 (local enforcement), C3 (authorize_tool internal / gate_check agent-visible), C4 (agents never self-reset), C5 (session→run binding control-plane-owned) all hold exactly as today. We are re-homing the *plumbing around* the moat, not the moat. This is the categorical difference from Sandcastle, which does post-hoc output filtering at the sandbox boundary (`competitor-sandcastle-gizmax.md`, Verdict) — we keep authorize-before-side-effect.

## 2. The 11 Reference Layers → Target Modules

Mapping each reference layer to a target module/package and its dominant disposition. Package targets assume the existing pnpm workspace (`core`/`api`/`cli`/`mcp`/`harness`/`dashboard`) with a control/data-plane carve described in §5.

| Ref layer | Target module | Dominant disp | Notes |
|---|---|---|---|
| Intake & Planning | `core/intake` + `api/routes/specs` | KEEP | Spec intake/DAG builder solid (HAVE/HAVE). Readiness resolver PARTIAL → fix `getLatestRun` ordering bug inside DAG evaluator. |
| Work Model & State | `core/state` (RunStateMachine + records) | KEEP | HAVE/HAVE. Add the MISSING **startup schema-compat gate** (reads `schemaVersion` on Bundle + DB ledger). |
| Scheduling & Dispatch | `core/dispatch/*` **(decomposed — §4)** | REDESIGN structure / KEEP logic | Poll/match/spawn logic is KEEP; the 6-level inheritance + 16-arg ctor is the REDESIGN. Add MISSING leasing+fencing and idempotency keys here. |
| Execution & Workers | `harness/*` + **Sealed Job Bundle (§3)** | KEEP adapters / consolidate snapshot | Claude/Codex adapters KEEP; OpenCode family REMOVE; Copilot DECIDE. Snapshot → Bundle is the consolidation. Sandbox WEAK → pluggable substrate behind Bundle. |
| Governance & Enforcement | `core/enforcement` (embedded @edictum/core) | KEEP | The moat. HAVE across the board. `tool-output-guards.ts` REMOVE (dead export). |
| Evidence & Audit | `core/evidence` | REDESIGN write path | Typed kinds/redaction KEEP; the non-idempotent `SqliteEvidenceRepo` INSERT is the REDESIGN — make it transactional + idempotency-keyed (§6). |
| Verification & Quality Gates | `core/post-completion` (verify + CI/review latch) | KEEP / REDESIGN verify-env | Watcher CI+review latch KEEP (C6). Worktree verify REDESIGN (leaks host env → fixed by secret-broker pillar). |
| Integration & Approval | `core/approval` + `core/merge` | KEEP / add exactly-once | Approval wedge + merge orchestrator KEEP; wrap push/merge in the MISSING exactly-once effect boundary (§6). |
| Reliability & Recovery | `core/recovery` | REDESIGN granularity | RunStateMachine + reconcile KEEP; crash-retry-from-`understand` is the REDESIGN (checkpoint/resume). `tryReattach` dead scaffolding → either implement or REMOVE (DECIDE fork). |
| Cost & Resource | `core/cost` | REDESIGN | Budget gates KEEP; silent-$0 Codex recording + home-tree scanner REDESIGN → real ledger with explicit `unmeasured` marker. |
| Operator Surfaces | `cli` + `dashboard` + `api` events | KEEP / UI-pillar | Status/inbox/approval/parity all HAVE. Dashboard dual design system + fonts → UI pillar. Dead components (`TreeNavigator`, `RelativeTime`, `/specs`, `/agents`) REMOVE. |

## 3. The Sealed Job Bundle — the Central Seam

Today `AttemptRuntimeSnapshot` (`packages/core/src/attempt-types.ts:85-99`) seals 9 fields — spec, task, project, repository, component, agent, provider, model, harness, workflow, sandboxProfile, execution — i.e. **~7 of 9 contract fields** per the reference (`Sealed Job Bundle`, PARTIAL). It is built by `buildAttemptSnapshot` (`attempt-snapshot.ts:25`), twice during dispatch to seal working dir (`domains/01`). It is **a snapshot, not yet a versioned wire contract.**

**Target: one immutable `SealedJobBundle` interface** that every executor consumes identically. Consolidate the snapshot and add the two missing contract fields + six runtime-correctness primitives:

```
SealedJobBundle {
  // identity & versioning  (NEW)
  schemaVersion: number            // startup compat gate reads this
  jobAttemptId: AttemptId          // stable identity for this attempt
  idempotencyKey: string           // retries collapse to one effect (§6)
  bundleHash: string               // sha256 over canonical-serialized payload below

  // existing sealed payload (from AttemptRuntimeSnapshot, unchanged semantics)
  spec, task, project, repository?, component?
  agent, provider, model, harness
  workflow: RunWorkflowProfileSnapshot     // materialized + sealed (KEEP)
  execution

  // content-addressed repo ref  (NEW — replaces loose branch fields)
  repoRef: { remote, pinnedSha, branch, branchPrefix }   // pinned, not floating

  // the two MISSING contract fields  (the headline gap)
  secretMount: ScopedSecretHandle   // allowlisted FactorySecret handle, NOT process.env
  allowedTools: ToolGrant[]         // declarative least-privilege grant, deny-by-default

  // lease & cancellation  (NEW)
  lease: { token: FencingToken, expiresAt }   // monotonic, rejected if stale (§6)
  cancellation: CancellationToken             // explicit cancel semantics
}
```

Design rules for the Bundle:
- **Immutable + content-hashed.** Once minted at dispatch, never mutated. `bundleHash` is computed over a canonical serialization; the executor echoes it on every evidence write so the control plane can verify the executor ran *this* bundle. This is the clean-room "proof-of-execution" pattern (`competitor` §4, the `.sctpl` cassette idea) mapped onto Ductum's evidence story — record once, verifiable, sha256-keyed — **without copying BSL code.**
- **Schema-versioned.** `schemaVersion` enables the MISSING startup compat gate (`Durable Externalized State Store`, PARTIAL): a newer control-plane binary reads an older in-flight bundle deterministically or refuses cleanly.
- **The secret mount is a *handle*, not values.** The Bundle carries a `ScopedSecretHandle` (which FactorySecret refs this job may resolve), and the broker (separate pillar) resolves it at execution time into a scoped env. This is the structural fix for the #1 defect: `claude.ts:186-188` spreads full `process.env`; the Bundle never carries ambient env, so there is nothing to leak. The sandbox descriptor's `credentials:none` claim (`sandbox-cost`, broken) becomes true.
- **Scope Rule check (repo rule):** every NEW field names the dogfood flow that breaks without it. `idempotencyKey` → crash-during-evidence-write double-INSERT (today: throws/duplicates). `lease/fencingToken` → reconcile reattaches a zombie that resumes writing (today: in-memory Map can't fence). `repoRef.pinnedSha` → target branch moves mid-attempt, verify runs against drifted tree. `secretMount`/`allowedTools` → the secret leak + airtight scoping. `schemaVersion` → restart on a newer binary mid-flight. `cancellation` → SSE cancel (D146) orphaning a session. All six map to a concrete failure, so none is speculative abstraction.

**Strangler step for the Bundle:** introduce `SealedJobBundle` as a superset interface that `AttemptRuntimeSnapshot` satisfies (the existing builder keeps producing the snapshot payload; a thin adapter wraps it + adds the new fields with safe defaults). Route the **attempt-start dogfood flow** through `SealedJobBundle` at the spawn boundary (`dispatcher-spawn.ts`) first. Once that flow is green end-to-end, migrate evidence-write and recovery to consume the Bundle, then make the new fields required and retire the bare snapshot path.

## 4. Killing the Dispatcher Structural Smell

Current: `DispatcherBase → DispatcherRuntime → DispatcherCycle → DispatcherSession → DispatcherSpawn → Dispatcher` (6 levels) with a ~16-arg positional ctor (`dispatcher-base.ts:46,65-102`; call site `api/src/index.ts:286-289`). The inventory is explicit this inheritance "exists mainly to satisfy the 300-LOC file rule, not domain modeling" (`domains/01`, REDESIGN). The fix is composition, not a deeper tree.

**Target: ~6 composed single-responsibility services behind one `DispatchContext` options object / DI container.** The methods already live in cohesive files — promote each file's protected-method cluster to an injected collaborator:

```
DispatchContext (one options object, ~6 deps + config)
 ├── PollScheduler        (from dispatcher-cycle: cycleOnce, single-flight, slots)
 ├── AgentMatcher         (from dispatcher-cycle/agent-health: match, health gating)
 ├── RuntimeResolver      (from dispatcher-runtime: agent→model/harness/sandbox/workflow)
 ├── Spawner              (from dispatcher-spawn: mint Bundle, spawn, bind session)
 ├── SessionLifecycle     (from dispatcher-session: handleSessionEnd, heartbeat, GC)
 └── Reconciler           (from dispatcher-reconcile: D121 orphan reconcile)
```

The `Dispatcher` becomes a thin coordinator that holds the `DispatchContext` and delegates — no inheritance, no positional ctor. Each service takes its own narrow deps via the options object, so the 16-arg mis-order hazard at the call site disappears and each service is independently testable (the existing `now()` injection pattern generalizes).

This is strictly a **mechanical recomposition of KEEP logic** — the poll/match/spawn/session/reconcile *behavior* is sound and tested. The risk is low and the file-size rule is satisfied honestly (small services, not artificial inheritance layers). It also incidentally lets us prune the file-size grandfather drift (`decisions/112`) since the split is real, not exemption-driven.

## 5. Externalizing activeSessions → LiveRunRegistry

`activeSessions: Map<RunId, ActiveDispatchSession>` (`dispatcher-base.ts:53`) holds live non-serializable `HarnessSession` objects and is the SSOT for "what's running now," consumed by matching, contention, heartbeat, GC, teardown, and rebuilt by reconcile (`domains/01`, fragile/high). It's REUSE: the data is right, the boundary is wrong.

**Target: a `LiveRunRegistry` interface** that separates the *durable claim* (in the store: which run is leased, by whom, fencing token, heartbeat timestamp) from the *live handle* (the in-process `HarnessSession` object, still in memory because it genuinely can't be serialized). 

```
LiveRunRegistry {
  claim(runId, lease): void        // durable: written to store with fencing token
  heartbeat(runId, token): void    // durable: rejected if token stale
  release(runId): void             // durable
  attachHandle(runId, session): void   // in-memory only: the live object
  getHandle(runId): HarnessSession?    // in-memory only
}
```

The control plane reads the **durable claim** to answer "is this run live?" — so an operator reading the DB after a crash sees the truth without waiting for reconcile (fixes the high op-risk). The in-memory handle map survives only as a local cache of live objects; losing it on crash is now recoverable because the claim + lease are durable. This is also the seam the **leasing/fencing** (§6) and the future **remote worker transport** (MISSING) plug into: a remote executor claims through the same registry, fences the same way, but its "handle" is a connection rather than an in-process object. The local-vs-remote difference collapses to the handle type — which is exactly the interchangeability the reference layer demands.

## 6. Distributed-Safety Primitives (where they land)

These are the load-bearing MISSING/WEAK gaps; this pillar defines *where they sit*, the dedicated pillars define *how*:

- **Idempotency keys** → minted into the Bundle (§3), enforced at the store write path. The evidence INSERT (`SqliteEvidenceRepo`, REDESIGN/fragile) becomes `INSERT ... ON CONFLICT(idempotencyKey) DO NOTHING` inside a transaction that also advances the gate — the MISSING **transactional gate_check+evidence commit**.
- **Leasing + fencing tokens** → minted into the Bundle's `lease`, written through `LiveRunRegistry.claim` (§5), checked on every side-effecting store write. Rejects the zombie-worker resume that the in-memory Map cannot today.
- **Exactly-once side-effect boundary** (push/merge) → an outbox/effect-ledger in `core/merge`, keyed by `idempotencyKey`, so a crash mid-push neither loses nor doubles (MISSING).
- **Content-addressed repoRef** → `repoRef.pinnedSha` in the Bundle (§3); verify/CI run against the pinned tree, not a floating branch.
- **Checkpoint/resume** → recovery pillar; the Bundle's `jobAttemptId` + per-gate evidence commits make "resume from last passed gate" expressible instead of retry-from-`understand`.

## 7. What This Pillar Removes (the strangler "delete" set)

Routed for deletion as new seams replace them: OpenCode adapter family (7 files + 9 tests + `@openai/codex-sdk` dead dep + defensive refs), `tool-output-guards.ts`, dead CLI api-client methods, `targets.ts`/`SqliteTargetRepo`/Target types (after one-time `target_id` backfill — DECIDE fork on timing), the `resolve-latch` route, dead dashboard components. None of these sit on the new Bundle/registry/dispatch seams, so they delete cleanly once the live flow is migrated off them.

## 8. Strangler Sequencing (one dogfood flow per seam)

1. **Compose the dispatcher** (§4) — pure refactor, existing tests guard it. Dogfood: a full attempt start still dispatches.
2. **Introduce `SealedJobBundle` as a snapshot superset** (§3), route attempt-start spawn through it. Dogfood: attempt start → spawn → gate_check → complete, end-to-end, Bundle-hashed.
3. **Introduce `LiveRunRegistry`** (§5) with durable claim, back it by the existing session map as the in-memory cache. Dogfood: crash + reconcile reads claims from store, not just memory.
4. **Add idempotencyKey + transactional evidence commit** (§6). Dogfood: kill the process mid-evidence-write, restart, no duplicate/throw.
5. **Add lease/fencing + repoRef pin** (§6). Dogfood: zombie-worker write rejected; verify runs on pinned SHA.
6. Make new Bundle fields required, retire bare snapshot path, delete REMOVE set (§7).

Each step ships green CI (CI is sacred), keeps KEEP/REUSE code, and leaves the moat untouched.

## Key decisions (this pillar)

- **How to consolidate AttemptRuntimeSnapshot into the Sealed Job Bundle without a flag-day rewrite** — _Introduce SealedJobBundle as a superset interface that the existing AttemptRuntimeSnapshot payload satisfies; the existing buildAttemptSnapshot keeps producing its 9 fields, a thin adapter adds the 8 new fields (schemaVersion, jobAttemptId, idempotencyKey, bundleHash, repoRef.pinnedSha, secretMount, allowedTools, lease, cancellation) with safe defaults, and the attempt-start dogfood flow is routed through it first. Make new fields required only after the live flow is green._. AttemptRuntimeSnapshot is REUSE/solid and already seals ~7/9 fields (attempt-types.ts:85). A superset-then-tighten path is the strangler move: it keeps the builder, the tests, and the evidence-sealing behavior, and lets each new field land behind a real dogfood flow rather than a big-bang contract swap.
- **Decompose the 6-level Dispatcher inheritance via composition vs. keep inheritance but flatten** — _Composition: ~6 injected single-responsibility services (PollScheduler, AgentMatcher, RuntimeResolver, Spawner, SessionLifecycle, Reconciler) wired through one DispatchContext options object; Dispatcher becomes a thin coordinator. No deeper tree._. The inventory states the inheritance 'exists mainly to satisfy the 300-LOC file rule, not domain modeling' (domains/01). The method clusters already align to files, so promotion to collaborators is mechanical and low-risk, kills the 16-arg positional ctor mis-order hazard (api/index.ts:286-289), satisfies the size rule honestly, and makes each service independently testable. Flattening inheritance would re-create the size pressure that caused the smell.
- **Where 'what is running now' truth lives after externalizing activeSessions** — _Split into a durable claim (run leased + fencing token + heartbeat in the store, authoritative) and an in-memory live handle (the non-serializable HarnessSession, a local cache only). Expose both behind a LiveRunRegistry interface. The control plane answers liveness from the durable claim._. activeSessions is REUSE/high-risk because 'the truth of what is running lives only in memory until reconcile runs.' HarnessSession genuinely cannot be serialized, so the realistic fix is not to durably store the object but to durably store the claim/lease and treat the object as a rebuildable cache. This is also the exact seam remote-worker transport and fencing plug into, collapsing local-vs-remote to the handle type.
- **Control/data-plane boundary: physical package split now vs. logical boundary first** — _Logical boundary first — enforce the rule 'data plane (harness adapters) holds no authoritative state; all truth flows via SealedJobBundle out and evidence/heartbeats in' within the existing packages, and only carve a physical core-controlplane / harness-dataplane package split once a remote executor actually exists._. Scope Rule: a physical package split is an abstraction whose justifying dogfood flow (remote dispatch) does not exist yet (Remote Worker Transport is MISSING/should-tier). Enforcing the data-plane-holds-no-truth invariant now gets 90% of the benefit (it is what makes the Bundle seam meaningful and unblocks recovery/exactly-once) without premature package churn.
- **Adopt proof-of-execution / bundle-hash echo as the evidence-integrity mechanism** — _Yes — compute bundleHash (sha256 over canonical-serialized Bundle) at mint time and have the executor echo it on every evidence write, so the control plane verifies the executor ran exactly this bundle. Clean-room concept only; no BSL code copied._. The competitor's .sctpl cassette (sha256-keyed, tamper-trapped, replay at $0) is its most distinctive asset and maps directly onto Ductum's evidence story (Durable Evidence Store rates WEAK, not content-addressed). The bundle-hash echo gives content-addressing and tamper-evidence on the evidence write path that is otherwise the single material defect (non-idempotent INSERT) — strengthening the moat's auditability rather than copying their post-hoc model.

**Dependencies:** UNBLOCKS (this is the backbone the other pillars hang on): (1) Secret-broker pillar consumes the Bundle's secretMount/ScopedSecretHandle field — without the Bundle seam there is nowhere structural to inject scoped secrets, and the #1 defect (process.env leak at claude.ts:186-188) stays. (2) Recovery/checkpoint pillar consumes jobAttemptId + per-gate evidence commits + LiveRunRegistry durable claims to express resume-from-last-gate instead of retry-from-understand. (3) Exactly-once/idempotency pillar consumes idempotencyKey + fencingToken from the Bundle and the LiveRunRegistry claim path. (4) Sandbox-isolation pillar plugs a pluggable substrate behind the Bundle's harness/sandboxProfile fields and the LiveRunRegistry handle abstraction. (5) Cost-ledger pillar attributes spend per jobAttemptId. DEPENDS ON: the enforcement moat (authorize_tool/gate_check/C1-C7) staying fixed — this pillar explicitly does not touch it. REUSES: AttemptRuntimeSnapshot+builder (attempt-types.ts/attempt-snapshot.ts), RunStateMachine, DAG evaluator, post-completion router, WatcherManager CI/review latch, repair/readiness engine — all KEEP/REUSE-rated. Honors D22/D24/D25/D27/D28: the Bundle never carries run_id for the agent to pass (D22), session key stays run.id (D24), Spawner remains sole session-mapping writer (D25), runtime stays per-run (D27), StorageBackend stays the 4-method D28 shape (the new idempotency lives in Ductum's evidence repo, not the @edictum/core backend).

**Risks:** TOP RISK — recomposing the dispatcher silently changes dispatch behavior. The 6-level chain has subtle ordering (single-flight inFlightCycle guard, double snapshot build to seal working dir, completionFallback timer). De-risk: pure mechanical promotion of existing methods to injected services with NO logic change, guarded by the existing dispatch test suite as a characterization harness; do the recomposition as step 1 before any new field lands so a regression is unambiguously attributable. RISK — the Bundle superset accretes into a god-object. De-risk: enforce the Scope Rule on every field (each NEW field names the dogfood flow that breaks without it — done in §3); reject any field that does not map to a concrete failure. RISK — LiveRunRegistry durable-claim writes add latency/contention to the hot dispatch path. De-risk: claim/heartbeat are small single-row writes already implied by the heartbeat refresh cycle; measure against current cycle timing before/after. RISK — schemaVersion compat gate is built but never exercised until a real mixed-version restart, so it rots. De-risk: add a test that boots a newer-schema binary against an older in-flight bundle fixture. RISK (process, not code) — context decay across a multi-step strangler: a later step edits dispatcher files the agent half-remembers. De-risk: per the repo rule, re-read dispatcher-*.ts before each edit; the files are <300 LOC each so full re-read is cheap. RISK — Target/Resource backfill (REMOVE set) deleted before bridge data migrated. De-risk: gate the targets.ts/SqliteTargetRepo deletion on a one-time target_id backfill landing first; keep the migration CHECK constraints as historical ledger (this is a DECIDE fork the operator owns, not an automatic delete).
