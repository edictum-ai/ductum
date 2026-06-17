# Evidence & Audit

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The evidence/audit domain is one of the healthier parts of Ductum: evidence kinds are typed and runtime-validated (evidence-kinds.ts), public output is aggressively redacted (public-redaction.ts), literal-secret submission is rejected at the surface (secret-detection.ts), and completion-signal parsing is centralized (execution-integrity-evidence.ts). The single material defect is the write path: SqliteEvidenceRepo.create is a bare non-transactional INSERT keyed on a client-generated id with no idempotency and no dedup on (run_id, type, payload), so a retried dispatch/reconcile can silently double-record or, on id collision, throw mid-pipeline. There is one legacy/demo carve-out (the exit_demo.run evidence kind + its CHECK-constraint migration, tied to the PAUSED bootstrap-redesign) and a fake hardcoded evidence fixture in the marketing landing package that must never be confused with real audit output.

## Typed evidence kinds + runtime validation
- **What:** A closed `EvidenceKind` union with per-kind structural validators (`validateEvidencePayload`, `EVIDENCE_KINDS` registry) that type-guard worktree snapshots, harness failures, operator cancel/note, and the exit-demo ledger row.
- **Where:** `packages/core/src/evidence-kinds.ts:1-198`
- **Maturity:** live-core
- **Quality:** solid — every kind has a discriminated `validate` guard with nested checks (diffStat, verifyOutput, machineSignature, ordered timeline); covered by `packages/core/src/tests/evidence-kinds.test.ts`.
- **Operator-legibility risk:** none — kinds are explicit and self-describing.
- **Dependencies:** consumed by gate/evidence paths and the AttemptRuntimeSnapshot evidence; the `exit_demo.run` kind ties to the bootstrap-redesign demo.
- **Disposition (recommended):** KEEP — matches the established "typed/validated/redacted" finding.
- **Flags:** `exit_demo.run` and its `ExitDemoPhase`/`bootstrap-redesign-p5` constants belong to the PAUSED bootstrap-redesign arc (D161) — legacy-adjacent, see legacy subsection.

## Evidence persistence (SqliteEvidenceRepo)
- **What:** Reads (`list`, `listByRunIds`) and the create path that redacts the payload then INSERTs an evidence row keyed by a caller-supplied id.
- **Where:** `packages/core/src/repos/evidence.ts:56-83`; schema `packages/core/src/db-migrations.ts:138-146`
- **Maturity:** live-core
- **Quality:** fragile — `create` (lines 75-82) is a bare `INSERT INTO evidence ... VALUES (?,?,?,?)` with no `INSERT OR IGNORE`, no enclosing transaction, and no uniqueness on `(run_id, type, payload)`. The id is client-generated (`createId`), so a retried write either duplicates the same logical evidence under a fresh id (silent double-record) or, on id reuse, throws a PRIMARY KEY violation mid-pipeline. No caller wraps `addEvidence` in a transaction (confirmed: no `transaction`/`BEGIN` around run-ops/evidence.ts or tasks.ts call sites).
- **Operator-legibility risk:** partial — duplicate evidence rows force the operator to manually distinguish real re-evidence from retry artifacts in the run timeline.
- **Dependencies:** `redactPublicOutput`; called from dispatch/MCP (`server.client.evidence`), `run-cancel.ts:50`, `record-imported-task-run.ts:108`, `run-ops/evidence.ts:13`, `tasks.ts:263`, and reconcile-audit.
- **Disposition (recommended):** REDESIGN — needs idempotent/atomic write (deterministic id or `INSERT OR IGNORE` + dedup) so retries and reconcile cannot corrupt the ledger; the read side and redaction are sound.
- **Flags:** BUG — non-transactional, non-idempotent INSERT on a client-generated PK; retry/double-dispatch can duplicate or crash. This is an audit-integrity defect in a security product.

## Public output redaction
- **What:** Deep recursive redaction of secrets in any payload before it leaves the boundary — secret-pattern regexes (sk-, gh*, xox*, JWT, bearer, URL passwords, query params, sensitive assignments, YAML key/values), sensitive-key detection, and allowlists for env refs / FactorySecret refs / safe statuses.
- **Where:** `packages/core/src/public-redaction.ts:1-256`
- **Maturity:** live-core
- **Quality:** solid — broad layered coverage with explicit safe-key/safe-value allowlists; FactorySecret refs and `${ENV}` references are preserved (not mangled); regression-tested in `packages/api/src/tests/public-output-redaction.test.ts`.
- **Operator-legibility risk:** partial — over-aggressive redaction can mask genuinely useful diagnostic strings (generic-token heuristic redacts any 32+ char mixed-class string), occasionally hiding context the operator wants.
- **Dependencies:** `factory-secret-refs.ts`; consumed by evidence/gate repos, public-output formatting, secret-detection, and spawn-config redaction.
- **Disposition (recommended):** KEEP — central, well-tested redaction is exactly the right shape for an audit boundary.
- **Flags:** none (the over-redaction is a legibility tradeoff, not a defect).

## Literal-secret rejection (secret-detection)
- **What:** Surface-level validation that rejects literal secret values in resource configs/commands, forcing `${ENV_VAR}` or `secret:<id>` references instead (D171).
- **Where:** `packages/core/src/secret-detection.ts:1-130`
- **Maturity:** live-core
- **Quality:** solid — `validateNoLiteralSecrets` / `validateEnvReferenceString` / `validateCommandSecrets` recurse structurally, reuse `isSensitivePublicKey`, and emit structured `SecretScanIssue`s with a clear remediation message.
- **Operator-legibility risk:** none — issues carry path + targetField + actionable message.
- **Dependencies:** `public-redaction.ts`, `factory-secret-refs.ts`.
- **Disposition (recommended):** KEEP — prevention complements the redaction defense and fits the current Factory/Project/Repository/Component vocabulary.
- **Flags:** LEGACY (minor) — `SecretScanTargetField` is the only secret-detection consumer of the word "Target", but here it means generic "field being scanned" (e.g. `Attempt.snapshot`, `Repository`), not the retired Target/targets resource; not a true relic, just a name collision worth noting.

## Execution-integrity evidence parsing
- **What:** Pure helpers that scan a run's evidence list for completion/success signals, reconcile lineage, bulk-import markers, structured pass/fail verdicts, and prose success/FAIL signals.
- **Where:** `packages/core/src/execution-integrity-evidence.ts:1-98`; consumed by `packages/core/src/execution-integrity.ts`
- **Maturity:** live-core
- **Quality:** adequate — deterministic and well-factored, but several functions lean on prose pattern-matching (`customPayloadHasSuccessSignal` regexes for PASS/FAIL strings), which is heuristic and can misclassify free-form agent text.
- **Operator-legibility risk:** partial — pass/fail derived from prose regexes is harder for an operator to trust than a structured verdict; the structured branches are clearer.
- **Dependencies:** `Evidence` type; sole consumer is execution-integrity.ts (gate completion logic) — 11 call sites.
- **Disposition (recommended):** KEEP — central to evidence-gated progression; the prose heuristics are a known, bounded tradeoff, not a break.
- **Flags:** none (prose-signal heuristics are a soft spot, not a bug).

## Reconcile audit trail
- **What:** Records reconcile/side-effect/task-failure audit entries as `state-reconcile` custom evidence plus a run update, capturing before/after run summaries and reason codes.
- **Where:** `packages/api/src/lib/reconcile-audit.ts:1-103`
- **Maturity:** live-core
- **Quality:** adequate — clean reason enum and before/after summaries; tested by `reconcile-audit-failure.test.ts` / `reconcile-audit-coverage.test.ts`. Inherits the non-idempotent `addEvidence` write weakness (each reconcile pass appends a fresh row).
- **Operator-legibility risk:** partial — reconcile audit rows are raw custom-evidence payloads; the operator reads JSON `before`/`after` summaries rather than a rendered diff.
- **Dependencies:** `addEvidence` (run-ops), runUpdates repo, runs repo.
- **Disposition (recommended):** REUSE — the lineage model is sound but sits on the evidence write path that needs idempotency; expect it behind the hardened write boundary.
- **Flags:** inherits the evidence-write idempotency bug — a re-run reconcile can append duplicate `state-reconcile` rows.

## CLI / dashboard transcript surfaces
- **What:** `ductum logs <attemptId>` renders progress/activity/tool-call previews with bounded one-line truncation; the dashboard builds a downloadable plaintext transcript with sanitized raw activity.
- **Where:** `packages/cli/src/commands/transcript.ts:1-100`; `packages/dashboard/src/pages/run-detail/transcript.ts:1-37`
- **Maturity:** live-core
- **Quality:** solid — CLI caps `--limit` at 5000 and previews at 180 chars; dashboard routes raw content through `sanitizeActivityRaw` before download.
- **Operator-legibility risk:** none — purpose-built operator views with next-action hints (`ductum approve/retry/watch`).
- **Dependencies:** API `getRunActivity`/`getRunUpdates`; `sanitizeActivityRaw`; activity-limits bounding upstream.
- **Disposition (recommended):** KEEP — these are exactly the operator-legible audit surfaces the model wants.
- **Flags:** none.

## MCP evidence/link tools
- **What:** Agent-visible `ductum.evidence` (attach typed evidence to the session-bound run) and `ductum.link` (attach branch/commit/PR), with run id resolved server-side per the session-binding contract (D22/D24).
- **Where:** `packages/mcp/src/tools/evidence.ts:1-57`
- **Maturity:** live-core
- **Quality:** solid — zod-strict input schemas; never accepts run_id from the agent (`server.resolveRunId()`), honoring C5/D22.
- **Operator-legibility risk:** none.
- **Dependencies:** MCP server session binding; API `client.evidence`/`client.link`; ultimately the SqliteEvidenceRepo write.
- **Disposition (recommended):** KEEP — correct surface and binding discipline.
- **Flags:** transitively exposed to the evidence-write idempotency bug (a retried tool call double-records).

## Marketing "fleet" evidence fixture
- **What:** Hardcoded, hand-authored fake evidence JSON bundles (fictional run/attempt ids, gate verdicts) used purely to render the marketing landing page.
- **Where:** `packages/landing/src/fleet/evidence.ts:1-40+`
- **Maturity:** live-peripheral (marketing), dead with respect to the real audit pipeline
- **Quality:** adequate — fine for its purpose (static demo data), but it is NOT real evidence and shares the word "evidence" with the audit domain.
- **Operator-legibility risk:** none for operators; high confusion risk for auditors who might mistake it for produced output.
- **Dependencies:** `@ductum/landing` (private marketing package) only; no link to core evidence repos.
- **Disposition (recommended):** KEEP — legitimate marketing asset, but it should stay clearly fenced from the audit domain.
- **Flags:** LEGACY/CONFUSION — file named `evidence.ts` containing fabricated `run_id`/`gate_verdicts`; ensure it is never wired into or cited as real audit evidence.

## Legacy / dead-but-not-deleted in this domain
- `packages/core/src/evidence-kinds.ts:39-62,131-146` — the `exit_demo.run` evidence kind, `ExitDemoPhase`, and `bootstrap-redesign-p5` constants belong to the bootstrap-redesign exit demo, which is PAUSED by D161. The `type` CHECK constraint was widened specifically for it in migration `035_exit_demo_evidence_type` (`packages/core/src/db-migrations.ts:762-781`). Retired-but-undeleted: candidate for REMOVE only after a deliberate decision to abandon the bootstrap-redesign demo; until then leave in place (removing a CHECK value requires another table rebuild).
- `packages/landing/src/fleet/evidence.ts` — fabricated demo "evidence" in the marketing package; not dead code (the landing site renders it) but dead/legacy with respect to the real audit ledger and named identically to a core domain file. Keep, but fence from audit.
- `packages/core/src/secret-detection.ts:12-29` — `SecretScanTargetField` uses the word "Target" in a generic "field" sense; not the retired Target/targets resource vocabulary (P7/D169), but the naming overlap is a minor relic worth a rename someday. Not a removal candidate.
