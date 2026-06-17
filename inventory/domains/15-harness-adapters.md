# Harness Adapters

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The harness package is the live execution boundary between the dispatcher and external agent runtimes. Four adapters are actually registered and selectable (claude-agent-sdk, codex-app-server, codex-sdk-as-compat-alias, copilot-sdk); the Claude and Codex app-server paths are the production workhorses and are well-tested. The standout legacy problem the operator asked about is real and large: the entire OpenCode adapter family (opencode.ts plus five support modules and the plugin/ hook) is fully dead — not in the registry, not exported, not reachable by any consumer — yet still ships in src with 9 maintained tests, and the backlog explicitly lists "OpenCode removal" as pending. Two shared, identical security defects exist: both the Claude adapter (claude.ts:186) and Codex env builder (codex-mcp-config.ts:29) spread the entire host process.env into spawned agents, matching the prior-audit secrets-leak finding.

## Claude Agent SDK adapter (claude.ts + sdk.ts + claude-hooks.ts)
- **What:** The primary live harness. Wraps `@anthropic-ai/claude-agent-sdk` `query()`, pumps the message stream, tracks gross/cached token usage, emits canonical events, and maps SDK terminal subtypes (max_turns, max_budget_usd, prompt overflow, silent max-turns) onto Ductum gate/pause outcomes.
- **Where:** packages/harness/src/claude.ts:85-388 (adapter), :211-282 (pump), :333-365 (terminal mapping); sdk.ts:30-45 (MCP/permission shims); claude-hooks.ts (Pre/PostToolUse authorize-tool hooks).
- **Maturity:** live-core
- **Quality:** solid — 148 harness tests pass including a 410-LOC claude.test.ts; cache-aware token accounting and D114/D118 budget/turn gate mapping are deliberate and documented.
- **Operator-legibility risk:** none — failure modes are classified into typed `failureEvidence` with suggested actions; pauses surface as named gates.
- **Dependencies:** `@anthropic-ai/claude-agent-sdk@0.2.141`, @ductum/core, @ductum/mcp (in-process MCP server), rest.ts. Dispatcher holds the live non-serializable session in `this.sessions`.
- **Disposition (recommended):** KEEP — fits the current model; this is the reference adapter.
- **Flags:** SECURITY: claude.ts:186-188 spreads the full host `process.env` into the agent's spawn env, so dispatched agents inherit every host secret; the encrypted FactorySecret system is never consulted here. Matches the prior-audit leak finding.

## Codex app-server adapter (codex-app-server.ts + handlers/events/routing/process/types/model)
- **What:** Live harness driving the `codex` app-server child over JSON-RPC stdio. Enforces tool gating structurally via the app-server's approval-request hooks (commandExecution/fileChange) routed through Edictum's `evaluateApproval`, defaulting fail-closed.
- **Where:** packages/harness/src/codex-app-server.ts:23-290; codex-app-server-handlers.ts:51-88 (approval paths); codex-mcp-config.ts (env/MCP/thread config); codex-server-request-routing.ts, codex-app-server-events.ts, codex-app-server-process.ts.
- **Maturity:** live-core
- **Quality:** solid — split across cohesive sub-300-LOC modules, fail-closed approval on error (codex-app-server.ts via createCodexAppServerApproval in api/lib/harness-loader.ts:59-73), dedicated event/routing/response test suites all green.
- **Operator-legibility risk:** partial — approvals/blocks log readable lines, but a stuck app-server child surfaces only as stderr warnings + a 30s request timeout, which an operator must read raw.
- **Dependencies:** local `codex` binary, @ductum/core workflow-read helpers, canonical-events. codex-sdk.ts delegates to it.
- **Disposition (recommended):** KEEP — this is the enforced (vs legacy danger-full-access) Codex path and the documented preferred one.
- **Flags:** SECURITY: codex-mcp-config.ts:25-34 `buildCodexAppServerEnv` spreads the full host `process.env` into the child — same secrets-inheritance defect as the Claude adapter.

## Codex SDK compat alias (codex-sdk.ts)
- **What:** A thin pass-through class kept only to preserve the public `codex-sdk` harness id; every method delegates to CodexAppServerHarnessAdapter because the old direct-SDK path used danger-full-access writes that escaped the worktree before Ductum could block them.
- **Where:** packages/harness/src/codex-sdk.ts:17-42; registered at registry.ts:36-41.
- **Maturity:** live-peripheral
- **Quality:** adequate — intentional 42-LOC shim, clearly documented; behaviorally identical to app-server.
- **Operator-legibility risk:** partial — the id implies a distinct "SDK" runtime but is actually the app-server; an operator inspecting config could be misled.
- **Dependencies:** CodexAppServerHarnessAdapter. NOTE: `@openai/codex-sdk@0.118.0` is still a pinned dependency but is no longer imported anywhere in src — a dead dependency.
- **Disposition (recommended):** DECIDE — keep the alias for config back-compat, OR collapse `codex-sdk` into `codex-app-server` and drop the unused `@openai/codex-sdk` dep; tradeoff is config stability vs. one less misleading id + one less supply-chain dependency.
- **Flags:** legacy: unused `@openai/codex-sdk` dependency in package.json:30 with zero src imports.

## Copilot SDK adapter (copilot-sdk.ts)
- **What:** Harness for the GitHub Copilot CLI via `@github/copilot-sdk`, event-driven (no async iterator). Registered and selectable; seeded as `copilot-builder` in factory-seed. Uses HTTP MCP at /api/mcp/<runId> with `approveAll` permissions, relying on the MCP boundary for enforcement.
- **Where:** packages/harness/src/copilot-sdk.ts:88-507; registry.ts:42-46; core/factory-seed.ts:65,257-262.
- **Maturity:** experimental
- **Quality:** fragile — 524 LOC (grandfathered oversize, decisions/112), no dedicated copilot-sdk.test.ts in the suite, costUsd hard-wired to 0, an inline duplicated `tool.execution_start` subscription (copilot-sdk.ts:278-292 and :355-365) registers the handler twice, and it depends on Copilot's native HTTP-MCP rather than the in-process MCP the other adapters use.
- **Operator-legibility risk:** high — relies on `approveAll` + remote MCP enforcement only; cost always reports $0, so budget gates are blind for Copilot runs and an operator can't see real spend.
- **Dependencies:** `@github/copilot-sdk@0.2.1`, gh-auth/COPILOT_GITHUB_TOKEN env, HTTP MCP route. Also self-contained duplicated operator-token/placeholder helpers (copilot-sdk.ts:509-524) mirrored from rest.ts.
- **Disposition (recommended):** REDESIGN — capability (a third executor) is wanted but the current shape is untested, double-wires events, reports no cost, and duplicates helpers; harden or gate behind explicit opt-in before treating as production.
- **Flags:** bug: double-registered tool.execution_start handler; gap: zero cost accounting; legacy: also blocked by the DB CHECK constraint that still only allows ('claude-agent-sdk','opencode') — see core flag below.

## OpenCode adapter family (opencode.ts + opencode-rest/activity/model/usage/probe + plugin/)
- **What:** A complete HTTP-API harness for `opencode serve` plus its `plugin/index.ts` tool.execute.before enforcement hook and `opencode-probe` health-probe shim. Polls session status, manages per-directory MCP tool permissions, summarizes usage.
- **Where:** packages/harness/src/opencode.ts:58-308 and opencode-rest.ts, opencode-activity.ts, opencode-model.ts, opencode-usage.ts, opencode-probe.ts; plugin/index.ts.
- **Maturity:** legacy-retired
- **Quality:** adequate-as-code but dead — code is coherent and even has 9 passing tests (opencode.test.ts) plus opencode-activity/telemetry tests, but NOTHING reaches it: not in registry.ts, not in factory-seed BUILT_IN_HARNESSES, not exported from index.ts, no non-test/non-self consumer anywhere in packages/.
- **Operator-legibility risk:** high — its continued presence (and DB CHECK constraints still hardcoding 'opencode') makes the harness surface lie about which runtimes are actually supported.
- **Dependencies:** none inbound from live code; references the @ductum/mcp dist path. The DB schema CHECK constraints (core/db-migrations.ts:30,163) still encode 'opencode' as a valid harness while omitting codex/copilot.
- **Disposition (recommended):** REMOVE — fully dead, superseded, and the post-source-of-truth backlog explicitly schedules "OpenCode removal as a real staged cleanup" plus "plugin-probe removal"; delete src + tests as a staged change alongside the CHECK-constraint repair.
- **Flags:** legacy/dead: entire subsystem retired-but-undeleted; tied to stale DB CHECK constraints; backlog item already filed (post-source-of-truth-backlog.md:196,212).

## Mock agent-call adapter (mock-agent-call-adapter.ts)
- **What:** Deterministic test harness that, when DUCTUM_MOCK_AGENT_CALLS=1, replaces every real adapter; it performs a scripted README-append mutation or a canned review PASS to exercise the dispatcher/post-completion pipeline without spending tokens.
- **Where:** packages/harness/src/mock-agent-call-adapter.ts:21-185; selected via registry.ts:57-83; wired in api/index.ts:180-187 and api/lib/harness-loader.ts.
- **Maturity:** live-peripheral
- **Quality:** adequate — small, narrowly scoped to "Append the line ... to README.md" prompts (throws on anything else), env-gated so it can't engage in normal operation; used by harness-loader tests.
- **Operator-legibility risk:** partial — it is a mock shipped in src (not under tests/), so an operator who set the env flag in a real factory would get fabricated "completed" runs; the gate is a single env var.
- **Dependencies:** classifyTask from core, rest.ts, canonical-events. Inbound: registry mock path, api/index.ts.
- **Disposition (recommended):** REUSE — legitimate deterministic-demo/CI tool (it backs the exit-demo path), but its src placement + env-only gate is the kind of "mock adapter in src" the operator flagged; keep behind a clearly named boundary and ensure it can't load outside test/demo contexts.
- **Flags:** legacy-risk: test-only adapter living in production src, activated by a single env var (DUCTUM_MOCK_AGENT_CALLS).

## Harness registry & loader (registry.ts + api/lib/harness-loader.ts)
- **What:** Single source of truth for which built-in adapters exist and how they are constructed, including the all-or-nothing mock swap and the codex approval-callback injection. Loaded dynamically by the API so @ductum/harness stays optional.
- **Where:** packages/harness/src/registry.ts:22-83; api/src/lib/harness-loader.ts:75-113.
- **Maturity:** live-core
- **Quality:** solid — registry.test.ts asserts the exact id set and load messages; dynamic-import fallback disables dispatch cleanly when the package is absent.
- **Operator-legibility risk:** none — emits a load message per adapter at startup.
- **Dependencies:** all four adapters + mock; consumed by api/index.ts.
- **Disposition (recommended):** KEEP — clean, tested boundary; it is also the natural place to drop OpenCode (already absent) and to gate the mock.
- **Flags:** none.

## Authorize-tool / REST boundary (rest.ts)
- **What:** The HTTP client layer the adapters use to talk back to the API: authorizeTool (the C3 harness-internal gate), reportToolSuccess, heartbeat, tokens, activity, harness-session-id binding. Carries the per-session control token and operator token.
- **Where:** packages/harness/src/rest.ts:21-44 (authorizeTool, fail-closed on 403), :52-65/114-124 (tool-success), :154-161 (operator-token header + placeholder guard).
- **Maturity:** live-core
- **Quality:** solid — best-effort posts swallow errors so they never block the agent; placeholder-token guard avoids leaking sentinel tokens; control token passed via header not prompt (honors D22/C5).
- **Operator-legibility risk:** none.
- **Dependencies:** API internal routes (/api/internal/authorize-tool, /tool-success, etc.); used by every adapter via canonical-events and claude-hooks.
- **Disposition (recommended):** KEEP — correct enforcement transport; aligns with C1/C3.
- **Flags:** minor duplication: identical operator-token/isPlaceholderToken helpers re-implemented in copilot-sdk.ts and codex-mcp-config.ts instead of importing from rest.ts.

## Canonical event normalization + activity limits (canonical-events.ts + activity-limits.ts)
- **What:** Single funnel that maps every adapter's events (text/tool/cost/heartbeat/completed) onto API posts, and the shared truncation helper bounding activity content to 64KB (env-tunable).
- **Where:** packages/harness/src/canonical-events.ts:7-70; activity-limits.ts:29-62.
- **Maturity:** live-core
- **Quality:** solid — one code path for all adapters, tested (canonical-events.test.ts, activity-limits.test.ts), truncation appends a human-readable "N chars truncated" marker. Matches the prior-audit "logs bounded 64KB" finding.
- **Operator-legibility risk:** none — truncation is explicit, not silent.
- **Dependencies:** rest.ts; used by all adapters.
- **Disposition (recommended):** KEEP — exactly the shared, bounded contract the audit credited.
- **Flags:** none.

