# Ductum — Target Architecture (the redo)

> Generated 2026-06-17 from the redo design workflow. Strangler redo, not a rewrite. Recommendations; the operator decides.

The target Ductum is a control-plane / data-plane split where the control plane owns all durable state, scheduling, enforcement adjudication, and operator surfaces, and the data plane (executors) consumes exactly one immutable contract: the Sealed Job Bundle. Six pillars hang off that one seam — a scoped secret broker plugs into the bundle's secret mount, exactly-once evidence and checkpoint/resume consume its idempotency key and fencing token, the sandbox ladder and extension SDK plug behind its harness/sandbox fields, and a brand-true inbox-first UI reads the durable state the bundle produces. We get there by strangler steps, never a greenfield rewrite: the enforcement moat (authorize_tool, gate_check, C1-C7) is untouched, KEEP/REUSE code is reskinned and reused, and each new boundary is proven by one real dogfood flow before the old path retires. Security-first: the host-env secret leak and the non-idempotent evidence write are closed before any structural refactor, so a rollback never re-opens a hole.

## Design principles

- Strangler, not rewrite: every new boundary (SealedJobBundle, EvidenceLedger, LiveRunRegistry, ExecutionBackend, Lease/Fence ledger, ExtensionRegistry, unified token layer) is introduced in place around KEEP/REUSE code; REDESIGN code is reworked behind the seam; REMOVE code is deleted only after a real dogfood flow runs through the new path. No flag-day contract swaps.
- Enforcement stays put: the moat (in-process authorize_tool fail-closed, agent-visible gate_check, C1-C7, D22/D24/D25/D27/D28) is not rewritten by any pillar. It gets a transactional spine welded under it, never re-architected.
- Structural enforcement over advisory: correctness is encoded in the wire contract and the store (allowlisted secret mount, fencing tokens, idempotency keys, UNIQUE constraints, exhaustiveness tests), not in instructions agents can ignore.
- Durable truth, not log archaeology: every run/work state and the single 'what to do next' is derivable from the store. The in-memory live handle is a rebuildable cache; the authoritative claim is the durable lease+fence row.
- One wire contract, interchangeable backends: local in-process worker and future remote worker consume exactly one SealedJobBundle and report through one ExecutionBackend seam. Local-vs-remote collapses to a handle type, not a fork.
- Scope Rule on every abstraction: each new field, boundary, or state must name the concrete dogfood flow that breaks without it. Reject speculative abstraction (physical package split, PgQueue, plugin loader) until a real second consumer exists.
- Exactly-once on the evidence path: record-evidence-and-advance is one DB transaction or none of it; content-addressing and idempotency keys make a retry a no-op, not a duplicate or a throw.
- Extensible-by-contract, deny-by-default: harnesses/providers/sandbox drivers/notifiers register through one typed, capability-described, operator-allowlisted seam. No auto-loading code from node_modules into the authorize_tool trust boundary.
- Legible-by-construction operator surface: every operator action is a thin call to the shared control-plane API, so CLI and UI stay at parity by construction; one token layer, brand-true, inbox-first.
- Honest floor: zero-config local start, a shipped doctor that names the exact broken prerequisite and the fix, and an authoring contract generated from the live validators so it cannot drift from what the runtime accepts.

---

# Ductum Target Architecture — Master Doc

> Plain, numerate, strangler. The moat stays; the scaffolding around it gets a spine.

## Headline

The target Ductum is an explicit **control-plane / data-plane split** mapped onto the 11 reference layers. The control plane owns all durable state, scheduling, enforcement adjudication, and operator surfaces. The data plane (executors) consumes exactly one immutable contract: the **Sealed Job Bundle**. Every executor — local Claude SDK today, remote container tomorrow — is an interchangeable backend behind that one wire contract. That seam is what unblocks laptop→SaaS without a rewrite.

This is a **strangler redo**. The enforcement moat — in-process `authorize_tool` fail-closed before every side effect, agent-visible `gate_check`, C1-C7, D22/D24/D25/D27/D28 — is **not rewritten by any pillar**. New boundaries are introduced in place; REDESIGN code is reworked behind them; REMOVE code is deleted only after a real dogfood flow runs through the new path.

## Design principles

1. Strangler, not rewrite.
2. Enforcement stays put — transactional spine welded under the moat, never through it.
3. Structural enforcement over advisory (contract + store, not instructions).
4. Durable truth, not log archaeology.
5. One wire contract, interchangeable backends.
6. Scope Rule on every abstraction (name the flow that breaks without it).
7. Exactly-once on the evidence path.
8. Extensible-by-contract, deny-by-default.
9. Legible-by-construction operator surface (CLI/UI parity by construction).
10. Honest floor (zero-config start, shipped doctor, generated authoring contract).

## The target shape (how the six pillars become one system)

The **Sealed Job Bundle** is the central seam. It is `AttemptRuntimeSnapshot` (REUSE, already seals ~7/9 fields at `packages/core/src/attempt-types.ts`) extended — via a superset-then-tighten adapter, not a rewrite — with eight fields, each justified by a concrete failure:

| Field | Justifying dogfood flow it unblocks | Owning pillar |
|---|---|---|
| `schemaVersion` | newer binary reads older in-flight bundle on restart | 01-shape |
| `jobAttemptId` / `idempotencyKey` | retry of evidence write is a no-op, not a dup/throw | 02-enforcement-evidence |
| `bundleHash` (sha256, canonical) | executor echoes it on every evidence write → proof-of-execution | 02-enforcement-evidence |
| `repoRef.pinnedSha` (content-addressed) | resume rebinds a worktree safely across a moved remote | 04-autonomy-recovery |
| `secretMount` (ScopedSecretHandle) | kills the `...process.env` leak at `packages/harness/src/claude.ts:187` | 03-execution-harness |
| `allowedTools` (declarative) | structural allow-list, not advisory | 03-execution-harness |
| `lease` + `fencingToken` | a stale owner cannot finalize/checkpoint/double-evidence a recovered run | 04-autonomy-recovery |
| `cancellation` token | explicit cancel propagates to the executor (D146 cancel/SSE) | 01-shape |

Around that seam, five structural moves:

- **Control plane owns truth; data plane holds none.** Enforce the invariant logically inside the existing packages now; carve a physical `core-controlplane` / `harness-dataplane` package split only once a remote executor exists (Scope Rule).
- **`activeSessions` Map → `LiveRunRegistry`.** Split "what is running now" into a *durable claim* (run leased + fencing token + heartbeat in the store, authoritative) and an *in-memory live handle* (the non-serializable `HarnessSession`, a rebuildable cache). The control plane answers liveness from the durable claim. This is the exact seam remote transport and fencing plug into.
- **Dispatcher decomposition.** Kill the 6-level `dispatcher-base.ts` inheritance + ~16-arg positional ctor by **composition**: ~6 injected single-responsibility services (PollScheduler, AgentMatcher, RuntimeResolver, Spawner, SessionLifecycle, Reconciler) wired through one `DispatchContext`. The live `activeSessions` Map and spawn surface re-home into `LocalExecutionBackend`. Pure mechanical promotion guarded by the existing dispatch suite as a characterization harness — step 1, before any new field lands.
- **EvidenceLedger spine.** Replace the bare non-transactional INSERT at `packages/core/src/repos/evidence.ts:75-82` (called from ~12 sites) with a content-addressed, schema-versioned, idempotency-keyed **transactional** append. `recordEvidence + setStage()` is one SQLite transaction or none of it. Keep the existing `id` column; add `content_sha` as an indexed side column; dedup on `UNIQUE(run_id, idempotency_key)`. The **Evidence Cassette** (clean-room, derived from the validated-evidence model — never from BSL `.sctpl` code) is the sha256-keyed, tamper-evident bundle that replays *validated decisions* offline at $0. Verify never calls a provider or executes a tool.
- **Autonomy supervisor wraps, does not replace, the dispatch loop.** A durable Lease+Fence ledger, a per-stage Checkpoint store keyed by the idempotent gate-commit, a Reconciler, and a supervisor that owns recover/quarantine/drain/escalate. Recovery is **resume-from-durable-checkpoint** — the dead `tryReattach` scaffolding is deleted. A new distinct `quarantined` terminal state takes deterministic poison failures out of the ready queue. The single derived `whatToDoNext` backs the run view, inbox, and notification routing, with an exhaustiveness test so an unmapped run shape is a CI failure, not a blank inbox row.

## How this delivers the four goals

- **Better shape** → control/data-plane split, one Sealed Job Bundle seam, composed dispatcher, `LiveRunRegistry`. Local-vs-remote collapses to a handle type.
- **Better UI** → one token layer (CSS custom properties as source of truth) reskinned to the brand-true near-black `#111318` / signal-blue `#2F6FED` / Inter+Archivo+JetBrains terminal, inbox-first IA, intervention controls, CLI/UI parity by construction (every action is a thin shared-API call).
- **Autonomous** → recovery resumes from the last committed gate under a fenced lease; poison-task quarantine; graceful drain; escalate only when a human is genuinely needed; `whatToDoNext` always derivable from durable state.
- **Extensible** → harnesses/providers/sandbox drivers/notifiers register through one typed, capability-described, operator-allowlisted `@ductum/extension-sdk` seam (deny-by-default, no node_modules auto-discovery). A third executor is an adapter, not a fork. A `SandboxDriver` host→container→remote ladder ships interface-first.

## Pillar docs

- `01-shape.md` — Target Shape & Layered Architecture (the backbone the others hang on)
- `02-enforcement-evidence.md` — Enforcement & Evidence Core: the validated-evidence spine
- `03-execution-harness.md` — Execution, Harness & Extensibility: Sealed Job Contract, Scoped Secret Broker, Sandbox Ladder, Extension SDK
- `04-autonomy-recovery.md` — Reliability, Recovery & Autonomy: self-running, self-healing, fully-legible
- `05-ui-ux.md` — Operator Surfaces: one token system, brand-true dark terminal, inbox-first IA, parity by contract
- `06-dx-onboarding.md` — DX, Onboarding & Extension Authoring: zero-config start, doctor/init wizard, llms.txt contract, third-party extension seam

This master doc does not reproduce pillar bodies; it ties them to the one shape and the four goals.

---

## Pillar designs

1. [Target Shape & Layered Architecture: Control-Plane / Data-Plane Split, the Sealed Job Bundle Seam, and the Dispatcher Decomposition](./01-shape.md)
2. [Enforcement & Evidence Core: The Validated-Evidence Spine](./02-enforcement-evidence.md)
3. [Execution, Harness & Extensibility: The Sealed Job Contract, Scoped Secret Broker, Sandbox Ladder, and Extension SDK](./03-execution-harness-extensible.md)
4. [Reliability, Recovery & Autonomy — the self-running, self-healing, fully-legible factory](./04-autonomy-recovery.md)
5. [Operator Surfaces and UI/UX Redesign: One Token System, Brand-True Dark Terminal, Inbox-First IA, CLI/UI Parity by Contract](./05-ui-ux.md)
6. [DX, Onboarding & Extension Authoring: zero-config local start, a shipped doctor/init wizard, an llms.txt authoring contract, and a real third-party extension seam](./06-dx-onboarding.md)

- [Strangler roadmap](./ROADMAP.md)
- [Decisions needed from you](./DECISIONS.md)
- [Target architecture diagram](./target-architecture.html)
