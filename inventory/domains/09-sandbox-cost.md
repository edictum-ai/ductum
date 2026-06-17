# Sandbox & Cost

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The cost subsystem is the more mature half: pricing is registry-derived (single owner, D163), cache-aware, with an explicit `unmeasured`-as-0 contract and a local-log scanner that measures real Codex/Claude billing within a few percent. The budget gate (D114/D118) is solid and well-instrumented, with paused/denied states and operator recovery wired through retry. The sandbox half is intentionally minimal and laptop-bound: `host`/`worktree` is the only supported driver and everything else in the spec is actively rejected, so it fits the current model but cannot grow to containers/remote without redesign. Two real liabilities: cost can silently read 0 for Codex when the scanner misses the on-disk log and the harness reports no tokens, and the cost-scanner reads the operator's entire `~/.codex` and `~/.claude` home trees (cross-session privacy/laptop coupling).

## Sandbox runtime (host-worktree driver)
- **What:** Prepares the per-run execution environment by validating the resolved SandboxProfile snapshot and creating/reusing a git worktree. Only `provider:host` / `mode:worktree` is supported; every other filesystem/network/credentials/resources/process claim in the resource spec is actively rejected.
- **Where:** `packages/core/src/sandbox-runtime.ts:42-104` (assert + prepare), `:66-80` (spec rejection), `:167-174` (boundary descriptor `filesystem:worktree-readWrite, network:host, credentials:none, process:host`); consumed via `dispatcher-support.ts:50`, `attempt-snapshot.ts:83`.
- **Maturity:** live-core
- **Quality:** solid — small (182 LOC), defensively validates and rejects unimplemented claims rather than silently ignoring them; clear typed boundary output.
- **Operator-legibility risk:** partial — the `boundary` descriptor advertises `network:host`/`credentials:none` but the actual dispatched process inherits the full host env (see Secrets flag); an operator reading the boundary could over-trust the isolation.
- **Dependencies:** `WorktreeManager` (create/isGitRepo/enabled), `RunSandboxProfileSnapshot`, `AgentRuntimeResolutionError`.
- **Disposition (recommended):** REDESIGN — the capability is correct for laptop dogfooding but structurally cannot express container/remote isolation; the established laptop-bound finding lands here. Keep the validation discipline; widen the driver model.
- **Flags:** legacy/security — boundary claims `credentials:none` while dispatch inherits host `process.env`; profile spec still flows through `resourceSpec: Record<string,unknown>` (a residual `resource`/spec surface that the operational-model redesign demoted).

## Local-log cost scanner (Codex + Claude)
- **What:** Parses agents' own session JSONL logs under `~/.codex/{sessions,archived_sessions}` and `~/.claude/projects` to compute cache-aware cost from real measured token deltas, with a 60s cache and 14-day file window.
- **Where:** `packages/core/src/cost-scanner.ts` (`CostScanner` :126-210, `parseCodexSessionFile` :247-370, `parseClaudeSessionFile` :377-470, home-tree walk :195-232); singleton `getDefaultCostScanner` :502.
- **Maturity:** live-core
- **Quality:** adequate — careful parsing (never throws, handles cumulative-vs-per-message token semantics, counter-reset guard at :316-319, unknown-model tokens counted but left unmeasured); but it is 525 LOC and grandfathered over the 300-LOC limit (`decisions/112`, line 27), and the cumulative/perModel logic is dense.
- **Operator-legibility risk:** high — when the scanner finds no matching session file it returns null and the system silently falls back to delta pricing; combined with Codex SDK reporting 0 tokens this is exactly the "cost shows 0 for a real Codex run" failure, with no surfaced signal distinguishing "free" from "unmeasured".
- **Dependencies:** filesystem layout of Codex/Claude home dirs, `MODEL_REGISTRY` (CODEX_RATES/CLAUDE_RATES derived at :56-76); consumed by `dispatcher-runtime.resolveScannerSnapshot` and `cost-budget.resolveScannerSnapshot`.
- **Disposition (recommended):** REDESIGN — sound measurement logic but laptop-coupled (reads operator home trees across ALL sessions, not just this run's) and the silent-0 path needs an explicit unmeasured signal; reuse the parsers behind a per-run-scoped boundary.
- **Flags:** privacy/laptop-coupling — `discoverFiles` walks the operator's entire `~/.codex` and `~/.claude` trees regardless of which run owns them; oversize grandfathered file.

## Model pricing resolution (registry + OpenRouter live)
- **What:** Resolves per-model USD rates with a 3-layer precedence (per-agent override -> OpenRouter live cache -> registry static) and computes flat and cache-aware cost. Unknown models return null -> cost 0 as an explicit `unmeasured` signal; harness-reported costs are deliberately ignored.
- **Where:** `packages/core/src/model-pricing.ts` (`lookupPricing` :158-170, `computeCost` :182-201, `computeCacheAwareCost` :242-271, `refreshOpenRouterPricing` :94-137).
- **Maturity:** live-core
- **Quality:** solid — well-documented contract, registry-derived (single owner per D163), no silent cross-family prefix fallback, negative-delta clamping; 329 LOC, grandfathered over limit (`decisions/112`, line 49) but cohesive.
- **Operator-legibility risk:** partial — the `unmeasured` 0 is correct by design but indistinguishable from "$0 real" in raw run state unless the UI surfaces `cost.state:'unmeasured'`; OpenRouter is fetched once at startup and cached for server lifetime, so stale rates aren't obvious.
- **Dependencies:** `model-registry` (rates, scannerKind, aliases), OpenRouter API (best-effort), agent `pricing` override.
- **Disposition (recommended):** KEEP — fits the current model, contract is explicit and security-conscious about ignoring untrusted harness costs.
- **Flags:** none (the unmeasured-as-0 ambiguity is a UI-surfacing concern, tracked under the scanner entry).

## Cost budget gate (per-run / per-spec, D114)
- **What:** Pre-write projection check (`precheckCostBudget`) and post-write check (`enforceCostBudget`) that pause a run with a `cost_budget_paused`/`spec_cost_budget_paused` failReason when projected/actual cost crosses `perRunHardUsd`/`perSpecHardUsd` (incl. per-task `budgetExtraUsd`), plus a one-shot `perRunWarnUsd` warning event.
- **Where:** `packages/api/src/lib/run-ops/cost-budget.ts` (`precheckCostBudget` :41-87, `enforceCostBudget` :89-139, `effectivePerRunHardUsd` :31-39, `formatPausedReason` :141-154); projection at `routes/run-control.ts:84-128`.
- **Maturity:** live-core
- **Quality:** solid — pre-write refusal prevents single-delta overshoot, kills the session before persisting, marks failed recoverable so extension can revive; paused reason embeds operator next-steps (status/retry/Factory Settings).
- **Operator-legibility risk:** partial — the failReason string is rich and operator-directed, but per-spec cost is recomputed by summing every run of every task in the spec on each call (`:64-83`, `:118-136`), an O(tasks*runs) scan that could lag on large specs and is opaque if numbers look off.
- **Dependencies:** `context.costBudget` (Factory Settings `perRunWarnUsd/perRunHardUsd/perSpecHardUsd`), task `budgetExtraUsd`, scanner/delta projection from run-control, state machine `markFailed`, `killRun`.
- **Disposition (recommended):** KEEP — matches the operational model; the per-spec recompute is a known scaling concern, not a correctness bug.
- **Flags:** none — note the per-spec summation cost as a future scaling watch-item.

## Budget extend/deny operator controls (D114)
- **What:** Operator recovery for a paused run: `extendBudget` adds to the task's `budgetExtraUsd` and re-queues the task via the same path as `ductum retry`; `denyBudget` relabels the failReason to `cost_budget_denied` and pins the worktree. Both write typed evidence.
- **Where:** `packages/api/src/lib/run-ops/budget-control.ts` (`extendBudget` :56-110, `denyBudget` :112-156, paused-state guards :41-54).
- **Maturity:** live-peripheral
- **Quality:** solid — guards that the run is actually paused before acting, records operator-note evidence, emits events, mirrors retry recovery semantics.
- **Operator-legibility risk:** none — operations are explicit CLI/route verbs with clear evidence trails.
- **Dependencies:** `tasks.incrementBudgetExtra/updateRetry/updateStatus`, `dag.evaluateTaskDAG`, evidence + runUpdates, events.
- **Disposition (recommended):** KEEP — clean, fits the Factory->Task->Attempt recovery model.
- **Flags:** none.

## Max-turns gate + extend/deny controls (D118)
- **What:** Parallel of the budget gate for Claude Agent SDK's per-session turn cap: `max_turns_paused`/`max_turns_reached` failReasons with operator `extendTurns` (adds task `turnExtraCount`, re-queues) and `denyTurns` (relabels to `max_turns_denied`).
- **Where:** `packages/api/src/lib/run-ops/turn-control.ts` (`extendTurns` :58-111, `denyTurns` :113-157, state predicates :46-56).
- **Maturity:** live-peripheral
- **Quality:** solid — same disciplined shape as budget-control (paused-guard, evidence, events, retry-mirroring recovery).
- **Operator-legibility risk:** none — explicit verbs and failReason states.
- **Dependencies:** `tasks.incrementTurnExtra`, claude.ts `error_max_turns`/`paused-max-turns` exit reporting, dispatcher failReason wiring.
- **Disposition (recommended):** KEEP — Claude-harness-specific but correctly scoped and fits the model.
- **Flags:** legacy-adjacent — `turnExtraCount`/max-turns is meaningful only for the Claude harness; if OpenCode-style harness cleanup proceeds it has no analog for Codex, but that's expected, not dead.

## Cost recording at session end (scanner-first, delta fallback)
- **What:** On session end the dispatcher records cost: prefer the scanner snapshot (sets gross tokens + cache-aware cost), else compute a delta cost from harness-reported token deltas via registry pricing.
- **Where:** `packages/core/src/dispatcher-session.ts:277-299` (`recordSessionCost`), `dispatcher-runtime.ts:175-181` (`resolveScannerSnapshot` harness routing).
- **Maturity:** live-core
- **Quality:** fragile — correctness hinges on either the scanner finding the on-disk log OR the harness emitting token deltas; for `codex-sdk` (hardcodes 0 tokens/cost per model-pricing header) a scanner miss yields a recorded cost AND tokens of 0 for a real run, with no `unmeasured` flag persisted.
- **Operator-legibility risk:** high — a $0 / 0-token run is the prior-finding symptom; raw state cannot tell the operator whether the run was free or simply unmeasured.
- **Dependencies:** `resolveScannerSnapshot` (session->run mapping + harness kind), `computeCost`, agent model/pricing, run repo `setTokens`/`updateTokens`.
- **Disposition (recommended):** REDESIGN — needs an explicit unmeasured marker and a more reliable Codex token/cost source than best-effort home-dir log scanning; reuse the pricing/scanner pieces underneath.
- **Flags:** bug/legibility — silent 0 cost+tokens for Codex runs where scanner misses and harness reports nothing.

## Secrets at dispatch (env inheritance)
- **What:** Dispatched agents inherit the entire host `process.env`, merged with the agent's `spawnConfig.env`, when the Claude harness builds query options (codex launch env similarly seeds from `process.env`).
- **Where:** `packages/harness/src/claude.ts:186-190` (`{ ...process.env, ...agent.spawnConfig.env, ... }`); codex env seeding `codex-app-server-process.ts:25-28`.
- **Maturity:** live-core
- **Quality:** broken (security) — full host secret surface flows into every governed agent; the encrypted `FactorySecret` system exists (`secret-detection.ts`) but is wired to notifications, never to dispatch, so it provides no isolation here.
- **Operator-legibility risk:** high — the sandbox boundary descriptor claims `credentials:none`, directly contradicting actual behavior; an operator has no signal that the agent saw their whole environment.
- **Dependencies:** host process env, `agent.spawnConfig.env`; intersects the Sandbox runtime boundary claim.
- **Disposition (recommended):** REDESIGN (security) — dispatch must use an allowlisted/secret-scoped env, not blanket `process.env`; this is the established secrets-leak finding and is the highest-severity item in this domain.
- **Flags:** security — blanket `...process.env` inheritance into governed agents; boundary descriptor lies about `credentials:none`.

## Legacy / dead-but-not-deleted in this domain
- `packages/core/src/cost-scanner.ts` — oversize grandfathered file (525 LOC vs 300 limit), `decisions/112-file-size-grandfather-list.md` line 27. Not dead, but flagged for a focused parser-extraction split.
- `packages/core/src/model-pricing.ts` — oversize grandfathered file (329 LOC), `decisions/112` line 49. Live, pending deliberate live-pricing/cache split.
- `packages/core/src/tests/sandbox-runtime-driver.test.ts` — one line over (301), grandfathered (`decisions/112` line 61). Test-only.
- SandboxProfile `resourceSpec: Record<string,unknown>` (`sandbox-runtime.ts:31-40,66-80`) — residual generic resource-spec surface that the operational-model redesign demoted from normal surfaces; currently only meaningful values are `host`/`worktree`, everything else is rejected, so the open-ended map is vestigial.
- No `edictum-console` or `Target`/`targets` vocabulary found in the sandbox/cost files. No OpenCode/Copilot harness references in the cost-routing code (mapping only handles `codex-sdk`, `codex-app-server`, `claude-agent-sdk`).
