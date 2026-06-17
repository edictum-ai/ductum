# Repair & Bakeoff

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

Both halves of this domain are healthy live-core code. Repair is a clean, layered readiness/recovery report engine fully migrated to the current Factory -> Project -> Repository/Component -> Spec -> Task -> Attempt vocabulary, with redaction wired through every emitted field and a dedicated dashboard page. Bakeoff (Best-of-N) is genuinely LIVE, not experimental: it is wired into the dispatcher completion path (dispatcher-session.ts:88-89), has full CLI/API/dashboard surfaces, an atomic blind-review winner router, DAG gating, and execution-integrity coverage. All domain files sit under the 300 LOC limit (none grandfathered) and the 636-test core suite — including the repair and bakeoff suites — passes. The only real concern is hardcoded model-identity coupling in the bakeoff reviewer-selection logic.

## Repair readiness report engine

- **What:** Pure-function engine that assembles factory/project/repository/agent/provider/workflow/spec-start readiness items into a grouped, severity-sorted Repair report and derives per-project dispatch eligibility.
- **Where:** `packages/core/src/repair-report.ts`, `repair-readiness.ts`, `repair-readiness-items.ts:1-256`, `repair-readiness-helpers.ts`, `repair-types.ts`.
- **Maturity:** live-core
- **Quality:** solid — layered, side-effect-free, every emitted field passes through redaction (`repair-utils.ts:32-39`); `repair-redaction.test.ts` + readiness/report suites green within the 636-test core run.
- **Operator-legibility risk:** none — each item carries title, reason, suggestedAction, record ref, field path, href and "blocks" copy; no raw state interpretation required.
- **Dependencies:** consumes `ConfigResource`/`Repository`/`Project`/`Agent` types; consumed by API `routes/repair.ts` and dispatch prerequisite gate.
- **Disposition (recommended):** KEEP — fits the current model exactly and is the operator's primary readiness surface.
- **Flags:** none

## Repair execution / attempt-recovery items

- **What:** Maps execution-integrity issue codes (e.g. `done_task_without_lineage_or_external_outcome`, `bakeoff_candidate_without_outcome`) into attention-level Attempt-recovery Repair items with human labels, reasons, actions and deep-link hrefs.
- **Where:** `packages/core/src/repair-execution.ts`, fed by `execution-integrity.ts:24-185`.
- **Maturity:** live-core
- **Quality:** solid — exhaustive label/reason/action/field maps keyed by code; only PRIMARY task codes surface at task level to avoid duplicate noise. `execution-integrity-bakeoff.test.ts` green.
- **Operator-legibility risk:** none — every code has plain-language copy and a next action.
- **Dependencies:** issue codes are produced in `core/execution-integrity.ts` and validated in `api/lib/execution-integrity.ts`; bakeoff codes tie this to the bakeoff path.
- **Disposition (recommended):** KEEP — current, well-covered, integral to recovery legibility.
- **Flags:** none

## Dispatch prerequisite gate

- **What:** Reuses the Repair report to compute the blocker subset that prevents a specific task/agent from starting an attempt, throwing `PrerequisiteCheckError` with an operator-readable message.
- **Where:** `packages/core/src/repair-dispatch.ts`.
- **Maturity:** live-core
- **Quality:** solid — derives from the same report (single source of truth), scoping by area/target; concise.
- **Operator-legibility risk:** none — `formatPrerequisiteBlockMessage` emits a one-line cause + suggested action.
- **Dependencies:** depends on `buildRepairReport`; relied on by the dispatcher before attempt start.
- **Disposition (recommended):** KEEP — correct reuse of the readiness model at the enforcement boundary.
- **Flags:** none

## Repair CLI + dashboard surface

- **What:** `ductum repair list` (CLI) renders grouped items plus live recovery detail for stalled/failed attempts; the dashboard exposes a routed `/repair` page with overview and per-group sections.
- **Where:** `packages/cli/src/commands/repair.ts`, `packages/dashboard/src/pages/Repair.tsx`, `components/repair/RepairOverview.tsx`, `RepairGroupSection.tsx`, `lib/repair*.ts`; routed at `App.tsx:59`.
- **Maturity:** live-core
- **Quality:** adequate — CLI renderer is straightforward; dashboard splits copy/areas into `lib/repair-issue-copy.ts` + `lib/repair-areas.ts`. Recovery detail degrades gracefully when the snapshot is unavailable.
- **Operator-legibility risk:** none — both surfaces present pre-formatted copy and next commands.
- **Dependencies:** consumes `getRepairReport` / workspace snapshot.
- **Disposition (recommended):** KEEP — the operator-facing presentation of an already-solid model.
- **Flags:** none

## Bakeoff creation (Best-of-N spec/tasks)

- **What:** Creates a `best_of_n` spec with N candidate tasks + a blind-review task in one transaction, validating builder count (2-5), duplicate builder configs, and a different-model reviewer; uses current `repositoryId`/`componentId` source-scope vocabulary.
- **Where:** `packages/api/src/routes/bakeoffs.ts:25-123`, CLI `packages/cli/src/commands/spec-bakeoff.ts`.
- **Maturity:** live-core
- **Quality:** adequate — transactional, strong validation, evaluates the DAG after create; but reviewer auto-selection hardcodes specific model IDs (`gpt-5.5`, `claude-opus-4-8`) and a "Claude builders require a GPT 5.5 reviewer" rule (`bakeoffs.ts:178,261-266`), coupling routing to today's catalog.
- **Operator-legibility risk:** partial — the hardcoded reviewer-model rule can reject an otherwise-valid reviewer with a message that only makes sense if the operator knows the catalog (`isGpt55Model`/`isOpus48Model`).
- **Dependencies:** `model-catalog`/`model-registry-data.ts` (entries exist), `task-source-scope`, specs/tasks repos, DAG.
- **Disposition (recommended):** REUSE — sound creation flow worth keeping, but expect the hardcoded model-identity coupling to move behind a configurable reviewer policy.
- **Flags:** legacy-risk — model IDs `gpt-5.5`/`claude-opus-4-8` baked into selection logic will silently rot as the catalog evolves.

## Bakeoff blind-review winner router

- **What:** Post-completion router that parses the structured `best-of-n-verdict`, validates winner eligibility against policy, atomically reopens the winning candidate for approval, writes per-candidate outcome evidence, and rolls back if approval entry fails.
- **Where:** `packages/core/src/post-completion-router-route-blind-review.ts`, helpers in `bakeoff-outcomes.ts`, `bakeoff.ts`; wired live at `dispatcher-session.ts:88-89`.
- **Maturity:** live-core
- **Quality:** solid — idempotent evidence writes, `commitAtomically` boundaries, explicit rollback path, policy-specific (`cheapest-verified-reviewed`) cost selection with epsilon handling. `post-completion-router/bakeoff-router*.test.ts` green.
- **Operator-legibility risk:** partial — failure reasons are clear, but the multi-stage reopen/rollback evidence (`bakeoff-winner-reopened-for-approval`, `bakeoff-ready-to-ship-failed`) requires reading evidence to fully trace a stuck winner.
- **Dependencies:** extends `PostCompletionReviewRouter`; depends on evidence/run/state-machine repos; invoked by the dispatcher session.
- **Disposition (recommended):** KEEP — this is what makes bakeoff live; carefully guarded and tested.
- **Flags:** none

## Bakeoff verdict parsing & outcome model

- **What:** Extracts and validates the structured `best-of-n-verdict` JSON (fenced + balanced-brace scanning), rejects override/cost-bearing fields, and resolves the winner task with reason strings.
- **Where:** `packages/core/src/bakeoff-outcomes.ts`.
- **Maturity:** live-core
- **Quality:** solid — strict type guards reject `override` and `costUsd` keys (blind-review integrity), confidence-range checks, multi-winner conflict detection. `bakeoff.test.ts` green.
- **Operator-legibility risk:** none — returns explicit human reasons on every rejection.
- **Dependencies:** consumed by the blind-review router and the API compare builder.
- **Disposition (recommended):** KEEP — security-relevant blind-review parser, well-guarded.
- **Flags:** none

## Bakeoff compare / scoring read model

- **What:** Builds the candidate comparison response (metrics, eligibility, scores, winner, status, next actions) for the CLI `spec bakeoff compare` and the dashboard panel; weighted scoring lives separately.
- **Where:** `packages/api/src/lib/bakeoff-compare.ts`, `bakeoff-scoring.ts`, `bakeoff-compare-types.ts`; dashboard `BakeoffComparePanel.tsx`, `BakeoffCandidateCard.tsx`, `BakeoffCandidateDiffGrid.tsx`, `CreateBakeoffDialog.tsx`.
- **Maturity:** live-core
- **Quality:** adequate — comprehensive read model (lineage, fix rounds, review passes, cost) with a duplicate local `isBestOfNVerdict` guard (`bakeoff-compare.ts:272`) that is looser than the canonical one in `bakeoff-outcomes.ts`; status/winner selection logic is intricate. `bakeoff-compare-policy/safety/scoring` suites green.
- **Operator-legibility risk:** partial — rich, but the operator leans on this view (eligibility blockingReasons, scores) to interpret a bakeoff; that is its job, so acceptable.
- **Dependencies:** specs/tasks/runs/evidence/gate repos, `model-catalog`; consumed by CLI + dashboard.
- **Disposition (recommended):** KEEP — primary bakeoff legibility surface; consider deduping the second verdict type-guard later.
- **Flags:** minor — duplicated/looser `isBestOfNVerdict` in `bakeoff-compare.ts:272-280` diverges from the strict canonical guard.

## Legacy / dead-but-not-deleted in this domain

- None found. Vocabulary is fully migrated to Repository/Component/Spec/Task/Attempt; no `targets`/`resource`/`seed`/`edictum-console` surfaces, no `ductum.yaml`-as-truth revival (the readiness resolver explicitly refuses to revive it, `repair-readiness.ts:185`), no OpenCode/Copilot remnants, no mock/test-only adapters in src, and no grandfathered oversize files in this domain (all <300 LOC). The `PostCompletionRouter` is a single class hierarchy (no duplicate router). The only non-dead caveats are the hardcoded reviewer model IDs in `bakeoffs.ts` (live but rot-prone) and the duplicated verdict type-guard in `bakeoff-compare.ts` (live, redundant).
