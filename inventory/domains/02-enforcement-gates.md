# Enforcement & Gates

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The enforcement core is the most mature, most adversarially-hardened part of Ductum: EnforcementManager owns a per-run WorkflowRuntime (D27), authorize_tool stays harness-internal while gate_check is a read-only agent-visible query (C3 holds), and the 4-method SqliteStorageBackend matches the real @edictum/core contract (D28). Tool-scoping (path + command + shell-read detection) is genuinely defense-in-depth and well-tested. Two real concerns: enforce.ts is a 632-LOC grandfathered file whose authorize/gate/reset paths are intentionally coupled, and the structural enforcement boundary is undermined upstream by claude.ts spreading the entire host process.env into dispatched agents (the encrypted FactorySecret system is never wired to dispatch). One dead-but-exported module found: tool-output-guards.ts has zero production consumers.

## EnforcementManager (authorize_tool + per-run WorkflowRuntime, C1/C2/C3)
- **What:** In-process gate evaluator. Holds one `WorkflowRuntime` per run (D27), evaluates every intercepted tool call against the Edictum workflow locally (C1), records gate evaluations, auto-advances stages on recorded success, and owns approval/reset/advance transitions.
- **Where:** `packages/core/src/enforce.ts` (whole file, 639 LOC); `authorizeTool` at :122-235; per-run runtime map at :77,:97-108; `getSession` constructs `new Session(runId, storageBackend)` at :628.
- **Maturity:** live-core
- **Quality:** adequate — structurally sound and the most-tested area (enforce/*.test.ts, enforce-shell-command.test.ts), but 632 LOC over the 300 limit and grandfathered in D112 with the explicit note that authorize/gate/reset paths must stay coupled. Heavy `log.info` instrumentation left in the hot path (:260,:269,:275).
- **Operator-legibility risk:** partial — observer-mode rows (`observed=1`) and `blockedReason` strings are meaningful, but understanding why a run is blocked still requires reading gate_evaluations + workflow state together.
- **Dependencies:** `@edictum/core` (Session, WorkflowRuntime, createEnvelope); SqliteStorageBackend; workflow-tool-args (path/command scope); external-review-gate (deriveShipState); RunStateMachine; reached from harness via `/api/internal/authorize-tool` (rest.ts) → run-ops/enforcement.ts.
- **Disposition (recommended):** KEEP — fits the current model and is the correct C1/C3 enforcement core; runtime-per-run split is already done (anchor finding). Defer the LOC split to a dedicated pass as D112 already records.
- **Flags:** legacy: over-300-LOC grandfathered (D112). Note: the `refreshRunFromWorkflow` "done" guard (:432-489) is load-bearing and fragile — it papers over Edictum's activeStage still reading 'ship' after DB-side merge; a regression there silently reopens completed runs.

## gate_check (agent-visible, read-only) + ductum.workflow info
- **What:** Agent-facing MCP surface. `ductum.gate_check` is a read-only workflow-status query (stage/completedStages/pendingApproval); `ductum.workflow` returns stage rules. Stage advancement is automatic, not agent-triggered (C3/C4).
- **Where:** `packages/mcp/src/tools/enforcement.ts:25-43` (gate_check), :7-23 (workflow); route `packages/api/src/routes/runs.ts:300-302`; delegates to `getWorkflowState`/`getWorkflowInfo` in `enforce.ts:292-331` via `run-ops/enforcement.ts:19-21`.
- **Maturity:** live-core
- **Quality:** solid — small, single-responsibility, the read-only redesign is clearly documented in code (route comment :300, MCP description "Read-only — stage advancement is automatic"). C3 separation from harness-internal authorize_tool is intact (no run_id accepted from agent; `resolveRunId()` resolves session binding).
- **Operator-legibility risk:** none — returns typed stage state.
- **Dependencies:** EnforcementManager.getWorkflowState/getWorkflowInfo; session→run binding in MCP server.
- **Disposition (recommended):** KEEP — correct post-redesign shape; honors C3/C4.
- **Flags:** none.

## SqliteStorageBackend (4-method StorageBackend, D28)
- **What:** Implements the real @edictum/core `StorageBackend` (get/set/delete/increment) over two SQLite tables, plus a non-contract `batchGet` optimization. Session-agnostic: uses a constant empty `STORAGE_SESSION_ID` because key namespacing is done in the Edictum key itself.
- **Where:** `packages/core/src/edictum-storage.ts` (103 LOC); contract methods :10-62; batchGet :64-102.
- **Maturity:** live-core
- **Quality:** solid — matches the D28 contract exactly (4 methods, not session-aware), parameterized SQL (no injection), upsert-correct. Tested in edictum-storage.test.ts.
- **Operator-legibility risk:** none.
- **Dependencies:** SqliteDatabase; consumed by `new Session(runId, storageBackend)` in enforce.ts.
- **Disposition (recommended):** KEEP — faithful to D28; the only adapter Edictum needs.
- **Flags:** none. (Minor: `batchGet` is outside the documented 4-method contract — fine as an internal optimization but worth noting it isn't part of the StorageBackend interface.)

## Workflow command-scope guard (protected paths + shell mutation block)
- **What:** Structural control-plane boundary for Bash commands: blocks references to the factory SQLite DB path / `$DUCTUM_DB_PATH`, and blocks file-mutating shell commands (rm/cp/sed -i/tee/redirects/git mutations/interpreter writes) when the active stage is not write-enabled.
- **Where:** `packages/core/src/workflow-command-scope.ts` (195 LOC); regex battery :5-16; `validateWorkflowCommandScope` :30; wired via `workflow-tool-args.ts:validateWorkflowToolCommandScope` into `enforce.ts:171-190`.
- **Maturity:** live-core
- **Quality:** adequate — careful tokenizer with quote/escape handling and symlink-aware path resolution, but it is a regex/heuristic denylist of shell mutation patterns, which is inherently incomplete (e.g. novel write idioms, `dd`, `install`, base64-decode-to-file, env-var-obscured paths bail to null at :185). Defense-in-depth, not a hard guarantee.
- **Operator-legibility risk:** partial — block reasons are human-readable, but a false-positive block on a benign command would be opaque to the agent operator.
- **Dependencies:** path-resolution.ts; protectedShellPaths option from EnforcementManager; stage write-enablement derived from workflow def.
- **Disposition (recommended):** KEEP — genuine structural boundary (C2-adjacent) that fits the wedge; treat as best-effort, not airtight.
- **Flags:** legacy-adjacent: heuristic denylist can be bypassed by un-enumerated mutation idioms — acceptable as layered control but should not be sold as a hard guarantee.

## Shell-read detection (read-before-edit evidence)
- **What:** Parses a Bash command to decide whether it is a simple read of a single file (cat/grep/head/sed/etc.) and extract that path, so shell reads can count as read-before-edit evidence. Fails closed on write syntax and on unknown verbs.
- **Where:** `packages/core/src/shell-read-detection.ts` (215 LOC); `extractWorkflowReadPath`/`isSimpleWorkflowReadCommand` :50-62; consumed by `harness/src/codex-app-server-events.ts` and `api/src/lib/harness-loader.ts:52`.
- **Maturity:** live-peripheral
- **Quality:** adequate — careful fail-closed design (env-with-args fails closed :86-93, write redirects rejected, bracket-test/for-header allowlisting), well-tested in approval-and-shell-read.test.ts. Complexity is high for the value delivered.
- **Operator-legibility risk:** none — internal evidence derivation.
- **Dependencies:** consumed by Codex and harness-loader read-evidence paths; relies on its own tokenizer.
- **Disposition (recommended):** KEEP — supports the read-before-edit gate; fail-closed posture is correct.
- **Flags:** none (heuristic, but fails closed so a miss costs evidence, not safety).

## External-review gate (deriveShipState, externalReviewRequired)
- **What:** Computes the ship-stage block: when a project sets `externalReviewRequired`, a run at stage 'ship' is blocked until branch/commitSha/prUrl exist and external CI + GitHub review both pass (C6 parallel latches).
- **Where:** `packages/core/src/external-review-gate.ts` (116 LOC); `deriveShipState` :29-84; consumed by `enforce.ts:457` (refresh) and :497 (applyDerived).
- **Maturity:** live-core
- **Quality:** solid — pure functions, clear missing/failed/waiting decomposition, no side effects, easy to test.
- **Operator-legibility risk:** none — produces explicit human-readable blockedReason strings ("waiting for external CI and external GitHub review").
- **Dependencies:** Project/Spec/Task/Run repos; drives blockedReason/pendingApproval in EnforcementManager refresh.
- **Disposition (recommended):** KEEP — clean expression of the verify-before-ship wedge.
- **Flags:** none.

## Execution-integrity policy (lineage / outcome reconciliation)
- **What:** Post-hoc integrity classifier: labels each run/task as orchestrated/external/recorded/unknown/inconsistent and flags issues like "done run without lineage", "prose success signal on non-done run", invalid outcomes, etc. Core logic in `core`, an API aggregation/report layer, and a dashboard label layer.
- **Where:** `packages/core/src/execution-integrity.ts` (227 LOC, evaluation logic); `packages/api/src/lib/execution-integrity.ts` (230 LOC, report/aggregation over the DB); `packages/dashboard/src/lib/execution-integrity.ts` (61 LOC, human labels for raw issue codes).
- **Maturity:** live-peripheral
- **Quality:** adequate — three-layer split is intentional (core = pure policy, api = aggregation, dashboard = presentation), not a copy-paste dupe. The dashboard layer (:28-50) deliberately humanizes raw snake_case codes per redesign forbidden-word rules. Core logic is dense and carries bakeoff-specific branches.
- **Operator-legibility risk:** partial — raw issue codes (`done_run_without_lineage_or_external_outcome`) are operator-hostile; the dashboard label map mitigates this but anyone reading API JSON or core output directly sees the enum.
- **Dependencies:** evidence model (execution-integrity-evidence.ts), bakeoff.ts; api report depends on full repo graph.
- **Disposition (recommended):** REUSE — sound policy worth keeping, but it carries bakeoff coupling and a raw-enum surface that will likely sit behind a cleaner reporting boundary later.
- **Flags:** legacy-adjacent: bakeoff candidate outcomes are baked into the core integrity policy (:29,:183) — verify bakeoff is still a live surface before treating these branches as load-bearing.

## tool-output-guards (call-scale handoff guard)
- **What:** A zod-agnostic `guardToolOutput`/`guard(options)(fn)` validation library intended to catch structural tool-output failures (missing fields, short summaries) at the call boundary before a run lands in the DB.
- **Where:** `packages/core/src/tool-output-guards.ts` (142 LOC); exported from `packages/core/src/index.ts:80`.
- **Maturity:** dead-unused
- **Quality:** adequate (as code) — clean, documented, tested (tool-output-guards.test.ts) — but it has ZERO production consumers. Grep for `guardToolOutput`/`guard(` across non-test, non-dist source returns no callers; the file's own docstring concedes MCP tools should use zod `inputSchema` directly (which they do), making this redundant with the shipped path.
- **Operator-legibility risk:** none.
- **Dependencies:** none inbound (only its own test); exported publicly from core.
- **Disposition (recommended):** REMOVE — built for a call-scale guard pattern that was never wired in; MCP's zod inputSchema already covers the intended use. Candidate for deletion (or DECIDE if it's a deliberately-staged API for an upcoming surface).
- **Flags:** legacy/dead: exported public API with no production consumer; keeping it implies a capability that isn't actually enforced.

## Host env inheritance into dispatched agents (enforcement boundary leak)
- **What:** Not an enforcement module per se, but it directly undermines the C2 structural boundary: every dispatched Claude agent inherits the entire host `process.env`, so any secret in the operator's shell reaches the sandboxed agent.
- **Where:** `packages/harness/src/claude.ts:186-188` (`const env = { ...process.env, ...agent.spawnConfig.env, ... }`). The encrypted FactorySecret system exists but is wired only to notifications, never to dispatch (anchor finding).
- **Maturity:** live-core (this is the real dispatch path)
- **Quality:** fragile — broad env spread is a data-leak vector in a security product; there is no allowlist or secret scoping at the dispatch boundary.
- **Operator-legibility risk:** high — the operator cannot see, from any surface, which secrets an agent received; it is implicit in whatever was in the launching shell.
- **Dependencies:** Claude Agent SDK spawn; FactorySecret system (currently bypassed).
- **Disposition (recommended):** REDESIGN (security) — scope dispatched-agent env to an explicit allowlist and route real secrets through the encrypted FactorySecret system. Confirms the prior verified audit's secret-leak finding.
- **Flags:** SECURITY: agents inherit full host process.env; FactorySecret encryption exists but is not on the dispatch path.
