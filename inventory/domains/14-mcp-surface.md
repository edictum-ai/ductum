# MCP Surface

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The MCP surface (packages/mcp) is small, focused, and well-tested: 12 agent-visible tools across 5 register* modules, all files under 300 LOC, 14 passing tests. The C3/C4/C5 boundaries hold cleanly — authorize_tool and reset are absent from the surface, no tool accepts run_id as an argument (strict zod schemas reject it), and run identity is bound server-side (in-process preBind for Claude, URL path for Codex/Copilot via the HTTP route). The package is live-core and largely KEEP. The notable gaps are operational-legibility ones (best-effort activity posting silently swallows errors; the HTTP MCP route relies solely on loopback binding with no token check) plus harness-agnostic vocabulary the wider redesign has not yet fully reflected.

## Agent-visible MCP tool registry (12 tools)
- **What:** The complete set of MCP tools exposed to agents, registered across five modules (lifecycle, progress, enforcement, evidence, recovery) on a single `McpServer` named `ductum` v0.1.0. The tools are next_task, accept, complete, update, heartbeat, decide, workflow, gate_check, fail, evidence, link, get_context.
- **Where:** server.ts:21-31 (registration), tools/lifecycle.ts, tools/progress.ts, tools/enforcement.ts, tools/evidence.ts, tools/recovery.ts; surface asserted in tests/tools.test.ts:22-36.
- **Maturity:** live-core
- **Quality:** solid — every tool is thin, uses shared okResult/safeToolCall, strict zod schemas; tests/tools.test.ts:16-48 pins the exact 12-name surface and that none expose run_id.
- **Operator-legibility risk:** none — tool names map 1:1 to operator-meaningful run actions.
- **Dependencies:** Relies on DuctumApi (api-client) for all backend calls and DuctumMcpServer for run binding. Consumed by core dispatcher (in-process), api/routes/mcp.ts (HTTP), and harness sdk/opencode/copilot.
- **Disposition (recommended):** KEEP — correct shape for the current operator model and the C3 boundary.
- **Flags:** none

## C3/C4 boundary: internal tools excluded from surface
- **What:** authorize_tool (harness-internal per-call enforcement) and reset (Ductum-Core-owned, C4) are deliberately NOT registered as MCP tools. fail() reports failure and lets Ductum Core decide reset; the agent cannot self-reset.
- **Where:** No registration of either in tools/*; enforcement.ts only exposes workflow/gate_check/fail; tests/tools.test.ts:37-38 asserts absence of `ductum.reset` and `authorize_tool`.
- **Maturity:** live-core
- **Quality:** solid — boundary is test-enforced, not just convention.
- **Operator-legibility risk:** none.
- **Dependencies:** Depends on C4 ownership living in Ductum Core (out of this package); fail() routes through /api/runs/:id/fail which decides recoverable vs terminal.
- **Disposition (recommended):** KEEP — the C3/C4 split is intact and guarded by tests.
- **Flags:** none

## C5 session-to-run binding (preBind + no agent-supplied run_id)
- **What:** Run identity is bound server-side. Claude binds in-process via preBindRunId; Codex/Copilot bind via the URL path on the HTTP MCP route; accept/get_context rebind on the server. Tools resolve the bound run via resolveRunId()/requireBoundRun() and never accept run_id as an argument. Strict schemas reject any run_id the agent injects.
- **Where:** server.ts:14-60 (currentRunId, bindToRun, requireBoundRun, resolveRunId); index.ts:17-19 (DUCTUM_RUN_ID env -> preBindRunId); api/routes/mcp.ts:38-58 (URL runId -> createMcpServer(apiUrl, runId)); D22 honored at tests/tools.test.ts:92-118.
- **Maturity:** live-core
- **Quality:** solid — the override test (sending run_id: 'run-other' to complete) returns isError and the bound id wins; strict() zod schemas make extra keys fail.
- **Operator-legibility risk:** none.
- **Dependencies:** HTTP path depends on api/routes/mcp.ts verifying the run exists (mcp.ts:45-47) before binding; in-process path depends on the dispatcher constructing one server per run.
- **Disposition (recommended):** KEEP — C5 is authoritative and well-covered.
- **Flags:** none

## DuctumApiClient (HTTP transport to the control plane)
- **What:** The single HTTP client backing every MCP tool. Implements ~14 endpoints (next-task, accept, complete, update, heartbeat, decide, gate-check, workflow, fail, evidence, link, context, activity, end-session) against the api server, with a DuctumApiError type carrying status/details.
- **Where:** api-client.ts:40-211; interface DuctumApi at api-client.ts:5-27; tested in tests/api-client.test.ts.
- **Maturity:** live-core
- **Quality:** adequate — clean request<T> wrapper, encodeURIComponent on path params, JSON error parsing; 215 LOC (largest file in package, still under the 300 cap).
- **Operator-legibility risk:** partial — postActivity (api-client.ts:163-168) swallows all errors silently (best-effort), so an agent's tool calls can fail to appear in the activity feed with no signal to the operator.
- **Dependencies:** fetch against DUCTUM_API_URL; reads DUCTUM_OPERATOR_TOKEN from env for the x-ductum-operator-token header (api-client.ts:205-210). Every tool depends on this client.
- **Disposition (recommended):** KEEP — sound transport; the silent best-effort activity post is a legibility wrinkle, not a correctness bug.
- **Flags:** Best-effort postActivity (api-client.ts:167) and the complete()-triggered setImmediate end-session nudge (api-client.ts:90-92) both fully swallow errors — acceptable by design but invisible when they fail.

## complete() dual teardown (end-session nudge)
- **What:** ductum.complete posts /complete (which already requests server-side session teardown) and then schedules a duplicate best-effort endSession via setImmediate as a fallback. endSession is also exposed as a manual operator fallback.
- **Where:** api-client.ts:75-95 (complete), 170-175 (endSession); contract note at api-client.ts:20-26; tools/lifecycle.ts:55-77; tested at tests/api-client.test.ts:10-59.
- **Maturity:** live-core
- **Quality:** adequate — intentional redundancy for the live-session teardown race; documented; tests cover both the nudge and the ignore-failure path.
- **Operator-legibility risk:** partial — if both teardown paths fail, a stale live session lingers with no surfaced error; ties into the established dispatcher<->live-session coupling finding.
- **Dependencies:** Depends on the api server honoring /complete teardown and /end-session; couples to the non-serializable activeSessions session lifecycle (REUSE/REDESIGN per established findings).
- **Disposition (recommended):** REUSE — the MCP-side code is fine, but it sits in front of the session-lifecycle coupling slated for rework; keep behind that future boundary.
- **Flags:** Duplicate teardown is a symptom of the live-session lifecycle fragility, not a bug in this file.

## ductum.complete input guard (50-char summary)
- **What:** complete requires a result summary of at least 50 chars (handoff-guard-style per-call validation) so agents cannot mark work done with an empty/trivial summary.
- **Where:** tools/lifecycle.ts:60-64; tests assert it at tests/tools.test.ts:78-81, 102-107.
- **Maturity:** live-core
- **Quality:** solid — enforced by zod min(50) with a helpful message; this is process evidence, not quality enforcement (correctly scoped).
- **Operator-legibility risk:** none.
- **Dependencies:** None beyond zod; complements gate_check/workflow stage advancement.
- **Disposition (recommended):** KEEP — small, correct evidence guard aligned with the wedge.
- **Flags:** none

## ductum.gate_check / ductum.workflow (read-only stage queries)
- **What:** gate_check returns current workflow state (stage, completedStages, pendingApproval) read-only — stage advancement is automatic, not agent-triggered. workflow returns the full rule set for the run and is advertised as "call this FIRST".
- **Where:** tools/enforcement.ts:6-43; GateCheckResult type at types.ts:16-21; tested at tests/tools.test.ts:120-141.
- **Maturity:** live-core
- **Quality:** solid — the description explicitly frames gate_check as read-only, matching the "advancement is automatic" model; getWorkflowInfo returns a Record<string,unknown> (untyped passthrough).
- **Operator-legibility risk:** partial — getWorkflowInfo (api-client.ts:134-136) returns an untyped Record spread directly into the tool output, so the operator/agent legibility of that payload depends entirely on the api server shaping it well.
- **Dependencies:** api server /gate-check and /workflow endpoints; the @edictum/core WorkflowRuntime lives per-run in EnforcementManager (decoupled, established finding).
- **Disposition (recommended):** KEEP — read-only gate query is the correct agent-visible expression of C3.
- **Flags:** workflow payload is untyped (Record<string, unknown>) — minor typing gap, not a bug.

## ductum.next_task routing filter (project/role)
- **What:** The one place an agent supplies routing input: optional free-form project and role strings to scope the next-task pick. Mapped to projectId/role in the request body.
- **Where:** tools/lifecycle.ts:7-28; api-client.ts:47-52 (projectId mapping); tested at tests/tools.test.ts:50-60.
- **Maturity:** live-core
- **Quality:** adequate — strict schema with min(1) optionals; the agent-supplied filter only narrows server-side selection, it does not let the agent claim arbitrary runs (accept still requires an assigned agent: api-client.ts:58-73).
- **Operator-legibility risk:** none — the dispatcher pre-binds for governed runs; this filter matters mostly for interactive/manual pulls.
- **Dependencies:** /api/runs/next-task; accept() enforces assignedAgentId so the filter is not an authz hole.
- **Disposition (recommended):** KEEP — narrow, safe routing input.
- **Flags:** Minor: `projectId` is the only lowercase-scoping survivor of older vocabulary in this package (api-client.ts:50); it is a field name, not the retired Target/resource/seed vocabulary, so no action needed.

## stdio entrypoint + env config (startStdioServer)
- **What:** CLI/stdio entrypoint that builds a server from DUCTUM_API_URL and DUCTUM_RUN_ID env vars and connects a StdioServerTransport. Used by the OpenCode harness which spawns mcp/dist/index.js as a child process.
- **Where:** index.ts:12-44; consumed by harness/opencode.ts:316 (resolveDuctumMcpCommand) and buildMcpEnvironment.
- **Maturity:** live-peripheral
- **Quality:** adequate — clean isMainModule guard and env parsing; tested at tests/tools.test.ts:226-241.
- **Operator-legibility risk:** none.
- **Dependencies:** Only consumer in src is the OpenCode harness path. Claude uses the in-process .mcp instance (harness/sdk.ts); Codex/Copilot use the HTTP route. The OpenCode harness is flagged for cleanup/removal in post-source-of-truth backlog.
- **Disposition (recommended):** REUSE — the stdio entrypoint itself is generic and correct, but its primary consumer (OpenCode harness) is a removal candidate; revisit if OpenCode is dropped.
- **Flags:** legacy-adjacent — tied to OpenCode harness which is slated for removal cleanup (the MCP package itself is harness-agnostic and would survive).

## HTTP MCP route auth posture (loopback-only)
- **What:** The per-run HTTP MCP transport route (/api/mcp/:runId) is stateless, verifies the run exists, then instantiates a request-scoped pre-bound server. It has no token check in the handler; security relies on the api server binding to 127.0.0.1 by default.
- **Where:** api/routes/mcp.ts:21-78; bind host default at api/index.ts:73 (127.0.0.1). The api-client adds x-ductum-operator-token (api-client.ts:205-210) but the route does not require it.
- **Maturity:** live-core
- **Quality:** adequate — fine for local-first; run-existence check (mcp.ts:45-47) prevents binding to garbage; but any local process can drive any existing run via this route since there is no token gate on the handler.
- **Operator-legibility risk:** partial — an operator running with a non-loopback host (api/index.ts:73 allows DUCTUM_HOST override) would expose unauthenticated per-run MCP control without an obvious warning.
- **Dependencies:** Loopback binding default; @ductum/mcp loaded lazily (optional dependency).
- **Disposition (recommended):** REDESIGN — capability is needed but auth should not depend solely on bind address once sandbox goes remote/container (consistent with the established laptop-bound sandbox REDESIGN); add a token/control-token check on the route.
- **Flags:** security — /api/mcp/:runId has no token authentication; safe only because of the loopback default, which is overridable via DUCTUM_HOST (api/index.ts:73). Note: this file lives in packages/api, adjacent to but driving this domain's surface.

## Legacy / dead-but-not-deleted in this domain
- None dead within packages/mcp itself: all 10 source files are live, under 300 LOC, and none are in the grandfather list (decisions/112). No Target/resource/seed/edictum-console vocabulary survives in the surface.
- Legacy-adjacent (not in this package, but coupled to it): the stdio entrypoint (index.ts) is consumed primarily by the OpenCode harness (packages/harness/src/opencode.ts, grandfathered at 345 LOC and flagged for "cleanup incl OpenCode removal"). The MCP package is harness-agnostic and would survive that removal; only the stdio consumer is at risk.
- The HTTP MCP route (packages/api/src/routes/mcp.ts) loads @ductum/mcp lazily as an optional dependency — not dead, but a reminder the package is treated as detachable.
