# Enforcement & Evidence Core: The Validated-Evidence Spine

> Ductum redo · pillar design · 2026-06-17

The moat stays exactly where it is — in-process authorize_tool fail-closed before every side effect, gate_check that advances stages only on validated evidence, and C1-C7. None of that gets rewritten; it gets a transactional spine welded under it. The single material defect in this pillar is the evidence write: SqliteEvidenceRepo.create is a bare, non-transactional INSERT on a client-generated PK (evidence.ts:75-82), called from ~12 sites, none of which wrap gate_check + evidence + stage-advance in one atomic unit. The redo introduces an EvidenceLedger seam: a content-addressed, schema-versioned, idempotency-keyed, transactional append that makes "record evidence and advance the run" one DB transaction or none of it. On top of the ledger I define the Evidence Cassette (clean-room concept, not Sandcastle code): a sha256-keyed, tamper-evident bundle of an attempt's validated evidence that replays offline at $0 — deterministic test infra AND portable proof of execution. The wedge stays articulated as authorize-before-side-effect with validated (not LLM-judged, not post-hoc-filtered) evidence, and the cassette becomes the artifact that lets anyone re-verify that claim offline.

---

## Target shape

The pillar is one spine with three layers, all in `@ductum/core`:

```
authorize_tool (harness-internal, C3)  ──┐
                                          │  unchanged moat
gate_check (agent-visible, read-only, C3) ┘
        │
        ▼
EvidenceLedger  ← NEW seam: transactional, idempotent, content-addressed, schema-versioned
        │            (one tx wraps: gate eval + evidence append + stage advance)
        ▼
EvidenceCassette ← NEW: sha256-keyed, tamper-evident bundle; replay/verify offline at $0
```

The moat (`enforce.ts`, `edictum-storage.ts`, `evidence-kinds.ts`, `public-redaction.ts`, `secret-detection.ts`, `external-review-gate.ts`, the command-scope and shell-read guards) is the spine. It is **KEEP** per the inventory and stays. The redo is entirely *underneath* it: replace the fragile write path, give evidence kinds an explicit schema version and content address, and add the cassette as a derived, verifiable artifact.

---

## What changes vs today (mapped to inventory dispositions)

| Inventory item | Disposition | Redo action |
|---|---|---|
| EnforcementManager authorize_tool + per-run runtime (`enforce.ts`) | KEEP | Untouched semantics. The ledger is injected as a dependency; the only behavioral change is that the gate evaluation + evidence + stage advance now run inside one `db.transaction()`. LOC split (632 → <300) deferred per D112, but the ledger extraction *naturally* peels the write path out, helping the split. |
| gate_check + ductum.workflow (read-only, C3) | KEEP | Untouched. Still read-only, still resolves run_id server-side. |
| SqliteStorageBackend (4-method, D28) | KEEP | Untouched. Still the only Edictum adapter, still session-agnostic. |
| Typed evidence kinds + runtime validation (`evidence-kinds.ts`) | KEEP | **Reworked in place**: add `schemaVersion` to every kind (today only `exit_demo.run` carries it, hardcoded `1`) and a stable canonical-serialization rule so the content address is deterministic. |
| Evidence persistence (`SqliteEvidenceRepo.create`) | **REDESIGN** | **The core change.** Replace the bare INSERT with an idempotent, content-addressed, transactional append behind the EvidenceLedger interface. |
| Reconcile audit trail (`reconcile-audit.ts`) | REUSE | Re-pointed at the ledger; inherits idempotency for free (a re-run reconcile dedups instead of appending a duplicate `state-reconcile` row). |
| MCP evidence/link tools | KEEP | Untouched surface; the retried-tool-call double-record bug disappears because the ledger dedups on content address + idempotency key. |
| Execution-integrity evidence parsing | KEEP | Untouched; reads the same evidence rows. |
| Public redaction / literal-secret rejection | KEEP | Untouched, and the content address is computed **after** redaction so the address commits to what was actually persisted, never a raw secret. |
| `tool-output-guards.ts` (dead, zero consumers) | **REMOVE** | Delete. Its job (structural tool-output validation) is covered by MCP zod inputSchema; keeping it implies an enforcement capability that isn't wired. |
| Host env spread into agents (`claude.ts:186-188`) | REDESIGN | Out of this pillar's scope (it's the secret-broker pillar), but it is *the* reason cassette replay must never re-execute tools — see "wedge defense" below. Flagged as the #1 cross-cutting defect. |

---

## The runtime-correctness primitives this pillar owns

The pillar charter assigns the primitives that *touch enforcement*. I claim three and define the seam for them:

### 1. Transactional exactly-once evidence commit (replaces the non-idempotent INSERT)

**Scope Rule justification** (name the dogfood flow that breaks without it): a Codex attempt finishes, the post-completion router records `worktree.snapshot` evidence and advances the run to `verify`; the dispatcher crashes after the INSERT but before the run update is committed; reconcile re-runs the same record → today either a duplicate evidence row (silent double-record) or a PRIMARY KEY throw mid-pipeline (`evidence.ts` flag, confirmed at call sites in `tasks.ts:263`, `run-cancel.ts:50`, `reconcile-audit.ts`). This is a real, already-happening flow.

**Design — EvidenceLedger interface** (new, in `@ductum/core`, <150 LOC):

```
interface EvidenceLedger {
  // Idempotent, content-addressed append. Returns the existing row on replay.
  append(input: {
    runId: RunId
    kind: EvidenceKind
    payload: TypedEvidencePayload        // already schema-versioned
    idempotencyKey: string               // caller-supplied (jobAttemptId:stage:kind)
  }): { evidence: Evidence; deduped: boolean }

  // Atomic: gate eval + evidence append + stage advance in ONE db.transaction.
  commitGate(input: {
    runId: RunId
    targetStage: string
    evidence: EvidenceInput[]
    advance: (tx) => void                // the runtime.setStage call, run inside the tx
    idempotencyKey: string
  }): GateCommitResult
}
```

Key mechanics:
- **Idempotency key**: caller-supplied, derived from `jobAttemptId:stage:kind` (the AttemptRuntimeSnapshot already has the attempt identity; this pillar consumes it, the dispatch pillar mints it). A new `UNIQUE(run_id, idempotency_key)` constraint on the evidence table + `INSERT ... ON CONFLICT DO NOTHING` makes the append exactly-once. On conflict, the existing row is returned with `deduped: true`.
- **Content address as PK candidate**: the evidence `id` becomes `sha256(canonical(redactedPayload))` rather than a random `createId()`. Two structurally-identical pieces of evidence collapse to one row by construction — content-addressing *is* dedup. Keep the human-facing `id` column but back it with the content hash; add `content_sha` column + index. (Decision fork below on PK vs side-column.)
- **One transaction**: `commitGate` wraps the gate-evaluation INSERT, the evidence append, and the `runtime.setStage` storage writes (which go through SqliteStorageBackend, same DB) in a single `db.transaction()` (the DB already exposes this — `db.ts:35`). Today these are three independent writes; the redo makes "advance the run" all-or-nothing. This directly closes the REFERENCE-ARCHITECTURE **MISSING** row "Idempotency Keys for State Transitions & Dispatch" and the **WEAK** "Durable Evidence Store" row for the enforcement-adjacent case.

This does **not** touch the Edictum runtime contract: `recordResult`/`setStage` still flow through `SqliteStorageBackend` (D28 intact). We are only ensuring those writes share a transaction with the Ductum-side evidence/gate writes — which is legal because both target the same SQLite file.

### 2. Content-addressed evidence

Every evidence row gets `content_sha = sha256(canonicalJson(redactedPayload))`. Canonicalization (sorted keys, normalized number/string forms, computed *post-redaction*) is the load-bearing detail — without it the same logical evidence hashes differently across runs and dedup fails. This is the "content-addressed immutable storage referenced by hash" the reference architecture rates **WEAK** today. The hash is what the cassette is keyed on.

### 3. Schema-versioned evidence kinds

Today only `exit_demo.run` carries `schemaVersion: 1` (`evidence-kinds.ts:50`). The redo makes `schemaVersion` mandatory on every kind in the `EvidenceKind` union, and the `EVIDENCE_KINDS` registry validators key off it. This gives a newer Ductum binary a deterministic rule for reading older evidence (the **PARTIAL** "Durable Externalized State Store with Schema Versioning" reference row, applied to the evidence sub-store). A `schema_version` column on the evidence table + a startup compatibility check in the migration ledger: refuse to silently misread an evidence kind whose stored version the running binary doesn't know.

---

## The Evidence Cassette (clean-room proof-of-execution)

**Concept inspiration only** from Sandcastle's `.sctpl` cassette (`competitor-sandcastle-gizmax.md` lines 25, 362-363) — record once, replay offline at $0, sha256-keyed, two tamper traps. **Never copy code (BSL).** The Ductum shape is different because Ductum's evidence is *validated structural evidence*, not raw LLM step output, and Ductum replay must **never re-execute a tool** (that would re-leak host env per `claude.ts:186-188`).

**What a cassette is**: a self-contained bundle for one attempt (or one spec run):
```
attempt-<jobAttemptId>.cassette
  manifest.json   { schemaVersion, jobAttemptId, runId, repoRef (pinned SHA),
                    workflowProfileHash, evidenceOrder[], manifestSha }
  evidence/       one file per evidence row, named <content_sha>.json (redacted payload)
  gates/          gate_evaluations for the attempt (the validated decisions)
  transcript/     bounded, redacted activity (reuses sanitizeActivityRaw)
```

**Tamper traps (clean-room, two-trap pattern):**
1. **Manifest checksum**: `manifestSha = sha256(canonical(manifest without manifestSha))`. Any edit to the evidence list or ordering breaks it.
2. **Content-address mismatch**: every `evidence/<sha>.json` must hash to its own filename. Any edit to a payload breaks the file↔name binding. This is *stronger* than a single hash chain because each artifact is independently verifiable.
3. (Optional, decision fork) **Hash-chain** the evidence in `created_at, rowid` order so ordering is also tamper-evident — closes the reference-arch **PARTIAL** "Tamper-Evident Audit Trail (hash-chained)" row. Sandcastle has this (`audit.py:18-43`) and it's the one audit property we currently lack.

**Two uses, one artifact:**

- **Deterministic test infra at $0**: `ductum cassette verify <file>` re-runs gate adjudication against the recorded evidence with **no provider calls, no tool execution** — it replays the *validated evidence* through `EVIDENCE_KINDS` validators + the gate logic (`deriveShipState`, `execution-integrity`) and asserts the recorded gate verdicts reproduce. Strict mode aborts on any miss. This gives the moat a regression harness that proves "this evidence advances/blocks this run" deterministically — exactly what the enforcement core lacks today (its tests are unit-level, not whole-attempt replay).
- **Portable proof of execution**: the cassette is the "Portable Decision/Evidence Bundle Export" the reference architecture rates **PARTIAL** (only transcript surfaces exist today). An outside auditor verifies it offline without trusting the live system: re-hash every artifact, re-run the validators, confirm the gate verdicts follow from the evidence. This is the auditable-execution claim made *falsifiable*.

**Scope Rule for the cassette**: the dogfood flow is the recovery exit-demo that the inventory keeps citing as un-verified (MEMORY notes "exit-demo wall-clock not honestly verified"). A cassette of that run is the honest, re-checkable proof — record it once, anyone re-verifies it offline. Without the cassette, "the factory ran itself end-to-end" stays an unverifiable claim.

---

## Strangler steps (new boundaries in place, one dogfood flow per seam)

1. **Introduce the EvidenceLedger interface** in `@ductum/core` with a default impl that *wraps the existing SqliteEvidenceRepo* — behavior-identical, no idempotency yet. Re-point all ~12 `addEvidence`/`evidence.create` callers (`run-ops/evidence.ts`, `tasks.ts`, `runs.ts`, `run-cancel.ts`, `reconcile-audit.ts`, etc.) at the ledger. **Seam in place, zero behavior change.** Dogfood: existing evidence tests stay green.
2. **Add the migration**: `content_sha`, `schema_version`, `idempotency_key` columns + `UNIQUE(run_id, idempotency_key)` and `content_sha` index (append-only migration ledger, `db-migrations.ts`). Backfill `content_sha` for existing rows; `idempotency_key` nullable for legacy rows. Dogfood: migration test + reconcile-audit no longer duplicates on re-run.
3. **Make `append` idempotent + content-addressed**: switch to `ON CONFLICT DO NOTHING` + content-hash id. Dogfood flow: a deliberately double-dispatched evidence write (the crash-after-INSERT scenario) now dedups to one row — assert in a new replay test.
4. **Make `commitGate` transactional**: wrap gate-eval + evidence + `setStage` in one `db.transaction()` inside EnforcementManager's advance path. Dogfood: kill the process between evidence and stage-advance in a test; assert the run is either fully advanced or fully not — never half.
5. **Schema-version every evidence kind** + startup compat gate. Dogfood: load a cassette recorded under an older kind version; assert the binary reads it or refuses loudly, never silently misreads.
6. **Add the cassette record/verify** path (`ductum cassette record <attemptId>` / `verify <file>`). Dogfood: record the recovery exit-demo attempt; `verify` reproduces every gate verdict offline at $0.
7. **Delete `tool-output-guards.ts`** and its export (`index.ts:80`) once steps 1-6 prove the ledger covers the write path. Dogfood: build + full suite green with it gone.

---

## How this advances the strategic dimensions

- **Better shape**: the evidence write goes from a fragile bare INSERT to a single, well-named, transactional, idempotent seam — and the ledger extraction is the lever that finally splits the 632-LOC `enforce.ts` (write path leaves the file).
- **Autonomous**: exactly-once + checkpoint-able evidence is the precondition for crash-safe autonomy. A factory that can't dedup a retried evidence write can't safely run unattended; the ledger is what lets reconcile re-run without operator hand-fixing duplicate rows.
- **Extensible**: schema-versioned kinds + a clean EvidenceLedger interface (append/commitGate) mean new evidence kinds and a future Postgres backend slot in behind the interface without touching the moat. The cassette format is a stable, versioned wire contract.
- **UI**: content-addressed evidence gives the dashboard a stable identity per artifact (dedup'd timeline, no retry-noise rows), and the cassette is the downloadable decision bundle the dashboard IA wants.

---

## Wedge articulation (defense vs post-hoc-filtering competitors)

One sentence, kept sharp: **"Ductum authorizes every agent tool call against a fail-closed policy *before* the side effect, and advances a run only on validated structural evidence — a competitor that filters *completed* output (Sandcastle's PolicyEngine at `executor.py:2105-2177`, which even redacts secrets out of output that already exists) is governing after the damage; we govern before it."** The cassette makes that claim *falsifiable*: a post-hoc filter cannot produce a portable, sha256-keyed bundle proving each tool call was authorized before its side effect, because in their model the side effect already happened. The cassette records the authorize-decision-before-effect ordering, and replay re-checks it offline. Concede honestly (per the competitor doc): a determined competitor *could* add a real per-tool interceptor later, so this is a current-state moat held by speed + cross-SDK parity, not a permanent one — which is exactly why the cassette (portable, independently verifiable proof of the ordering property) is worth building now as the defensible artifact.

## Key decisions (this pillar)

- **Content hash as evidence primary key vs a side column (content_sha) next to the existing createId() id** — _Keep the existing id column, add content_sha as an indexed side column, and dedup on UNIQUE(run_id, idempotency_key). Treat content_sha as the cassette key, not the DB PK._. Making the PK the content hash is cleaner conceptually but is a destructive schema rebuild (CHECK/PK changes require table rebuild in SQLite, same pain as migration 035) and breaks every foreign reference to evidence.id. A side column gives content-addressing for the cassette and dedup, with an append-only migration and zero reference churn. The idempotency key (jobAttemptId:stage:kind) is the operationally correct dedup axis anyway — identical payloads from genuinely different attempts should NOT collapse, and content-hash-as-PK would wrongly merge them.
- **Add a cryptographic hash-chain over evidence (full tamper-evident audit trail) now, or only the two cassette tamper traps (manifest checksum + per-artifact content address)?** — _Ship the two cassette traps now (they cover content + manifest tamper-evidence per attempt, which is what proof-of-execution needs) and defer the cross-run cryptographic chain to a later pass. Per-artifact content-addressing already makes any single edit detectable; global ordering tamper-evidence is a should, not a must, and adds idempotency-hostile read-before-write coupling._. Sandcastle ships a SHA-256 hash chain (audit.py:18-43); the reference architecture rates Ductum's hash-chained audit trail PARTIAL/MISSING. A chain orders-and-seals the whole log; the two cassette traps seal contents and the manifest but not global ordering. The chain adds write-path coupling (every append must read the prior hash) which fights the idempotency design.
- **Where is the idempotency key minted?** — _Minted by the dispatch pillar as part of the sealed AttemptRuntimeSnapshot (jobAttemptId), consumed here as jobAttemptId:stage:kind. This pillar defines the contract and the UNIQUE constraint; it does not own attempt identity._. C5/D22 require run identity to be resolved server-side, never passed by the agent. The attempt identity already lives in AttemptRuntimeSnapshot (inventory: seals ~7/9 fields). Deriving the evidence idempotency key from the sealed attempt id keeps the agent out of the loop and reuses existing identity rather than inventing a parallel one.
- **Should cassette verify ever call a provider or execute a tool?** — _Never. Verify replays recorded validated evidence through the EVIDENCE_KINDS validators and gate logic only — zero provider calls, zero tool execution. Strict-miss aborts._. Two reasons: (1) the whole point is $0 deterministic offline replay; (2) re-executing a tool would re-trigger the host-env leak at claude.ts:186-188 — replaying enforcement decisions must be a pure function of recorded evidence, not a re-run of the agent. This is also what keeps the cassette categorically different from a workflow-orchestrator's trajectory replay: we replay *validated decisions*, not raw model output.

**Dependencies:** DEPENDS ON: the Dispatch/Sealed-Job-Bundle pillar to mint jobAttemptId / idempotency key inside AttemptRuntimeSnapshot (inventory: snapshot seals ~7/9 contract fields; this pillar consumes the attempt identity). DEPENDS ON: the data-model migration ledger (db-migrations.ts, append-only) for the content_sha / schema_version / idempotency_key columns and UNIQUE constraint. KEEPS INTACT (hard dependency on no-regression): SqliteStorageBackend D28 contract, RunStateMachine transition ownership (C4), gate_check read-only C3 surface, public-redaction (content hash computed post-redaction). UNBLOCKS: the Recovery/Checkpoint pillar — exactly-once idempotent evidence is the precondition for resume-from-last-passed-gate instead of retry-from-understand (reference-arch WEAK row). UNBLOCKS: the Operator/UI pillar — content-addressed evidence gives a dedup'd timeline and the cassette is the portable decision bundle the dashboard IA wants. UNBLOCKS: cross-SDK parity work — schema-versioned evidence kinds are the fixture surface (Py/TS/Go by fixture). Re-points (no behavior change): reconcile-audit.ts, all ~12 addEvidence/evidence.create callers in packages/api.

**Risks:** RISK 1 (highest): the transactional commitGate must share one SQLite transaction across BOTH Ductum-side writes (evidence, gate_evaluations) AND Edictum-side writes (SqliteStorageBackend setStage). If Edictum's WorkflowRuntime ever buffers writes or opens its own transaction internally, nesting breaks. DE-RISK: SqliteStorageBackend is the only Edictum write path and is the 4-method synchronous adapter (D28) — confirm setStage's storage writes are synchronous and uncommitted-until-tx by reading edictum-ts source before implementing; if Edictum batches, fall back to a savepoint-per-commitGate wrapper. RISK 2: the refreshRunFromWorkflow 'done' guard (enforce.ts:432-489) is flagged load-bearing and fragile — it papers over Edictum's activeStage still reading 'ship' after DB-side merge. Wrapping advance in a transaction must NOT change when this guard fires. DE-RISK: keep the guard exactly where it is; the transaction wraps the writes, not the refresh logic. Add a regression test that a completed run is not silently reopened. RISK 3: content-address canonicalization drift — if two binaries canonicalize a payload differently, dedup silently fails and the cassette won't verify. DE-RISK: pin a single canonical-JSON function in @ductum/core, version it, and add a cross-version fixture test. RISK 4: backfilling content_sha for existing evidence rows could be expensive or hit legacy rows with un-redactable payloads. DE-RISK: backfill lazily (compute on read for legacy rows, persist on next write), nullable column, never block startup on backfill. RISK 5 (legal): the cassette concept is inspired by Sandcastle's BSL-licensed .sctpl — clean-room risk if implementation mirrors their code. DE-RISK: design from the validated-evidence model (which is structurally different — we replay decisions not model output), never read their cassette.py, document the independent derivation in the decision record.
