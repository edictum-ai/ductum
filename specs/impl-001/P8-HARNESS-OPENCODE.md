# P8: OpenCode Harness Adapter + Stateless Plugin

**Scope:** OpenCode stateless plugin for tool-call interception, Ductum-side adapter for session management
**Package:** `packages/harness`
**Depends on:** P2 (state machine, enforcement), P4 (REST API), P5 (MCP server)
**Deliverable:** OpenCode plugin + OpenCodeHarnessAdapter for non-Claude agents (Codex, GLM)
**Verification:** `cd packages/harness && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §9.2 (OpenCode Harness Adapter), §9.3 (Hot Factory Pattern)
- `HARNESS.md` §OpenCode harness adapter, §Plugin isolation model (D15)
- `decisions/005-round-2-response.md` §D15 (stateless plugin, dynamic policy via Ductum MCP)
- `decisions/006-round-3-final.md` §C3 (session-to-run mapping is authoritative), §C5 (session identity)
- `OPEN-QUESTIONS.md` §Q9 (OpenCode session-scoped enforcement)
- OpenCode plugin documentation — verify plugin hooks API (before_tool_call, after_tool_call)
- OpenCode server documentation — verify REST API for session management

**Critical: Read the actual OpenCode docs before implementing.** The plugin API determines what's possible. If OpenCode plugins cannot block tool calls (only observe), document this as a finding — enforcement degrades to audit-only with prominent warnings per Q1.

## Tasks

### 1. Implement stateless OpenCode plugin

File: `packages/harness/src/plugin/index.ts`

This plugin is deployed to the OpenCode plugin directory. It is generic — no per-run configuration. All policy decisions delegate to Ductum Core.

```typescript
// OpenCode plugin interface (adapt to actual API)
export default {
  name: 'ductum',

  async beforeToolCall(context: PluginContext): Promise<PluginDecision> {
    const { toolName, toolArgs, sessionId } = context

    // Call Ductum Core's authorize_tool via HTTP
    // The plugin knows the Ductum API URL from OpenCode config (env var or config file)
    const apiUrl = process.env.DUCTUM_API_URL || 'http://localhost:4100'

    try {
      const response = await fetch(`${apiUrl}/api/internal/authorize-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,  // OpenCode session ID
          tool: toolName,
          args: toolArgs,
        }),
      })

      const result = await response.json()

      if (!result.allowed) {
        return { action: 'block', reason: result.reason }
      }

      return { action: 'allow' }
    } catch (error) {
      // Plugin error — fail open or fail closed?
      // FAIL CLOSED: if we can't reach Ductum Core, block the tool call.
      // This prevents unmonitored execution.
      return {
        action: 'block',
        reason: 'Ductum enforcement unavailable — tool call blocked for safety',
      }
    }
  },

  async afterToolCall(context: PluginContext): Promise<void> {
    // Optional: report tool execution result back to Ductum Core
    // for evidence tracking
  },
}
```

**Key design: the plugin is stateless (D15).** It does not know which run it's serving. It passes the OpenCode session ID to Ductum Core, which resolves it to the correct run via the `session_run_mapping` table.

### 2. Internal authorize-tool endpoint (D25)

Already defined in P4 as `POST /api/internal/authorize-tool`. The plugin calls this endpoint. P4 implements it:

```
POST /api/internal/authorize-tool
Body: { session_id: string, tool: string, args: object }
Response: { allowed: boolean, reason?: string }
```

This endpoint:
1. Resolves `session_id` -> `run_id` via `session_run_mapping`
2. Calls `EnforcementManager.authorizeTool(runId, tool, args)` — same logic as `/api/runs/:id/authorize-tool`
3. Returns the result

If the session_id is not found in the mapping, returns `{ allowed: false, reason: "Unknown session" }`.

**Do NOT add this endpoint in P8.** It is defined in P4. P8 only implements the plugin that calls it.

### 3. Implement OpenCodeHarnessAdapter

File: `packages/harness/src/opencode.ts`

```typescript
class OpenCodeHarnessAdapter implements HarnessAdapter {
  constructor(
    private apiUrl: string,          // Ductum API URL
    private openCodeUrl: string,     // OpenCode server URL (e.g., http://localhost:4097)
    // NOTE: no SessionRunMappingRepo — dispatcher is sole owner (D25)
  )

  async spawn(run: Run, task: Task, systemPrompt: string, mcpServer: DuctumMcpServer): Promise<HarnessSession> {
    // 1. Create OpenCode session via REST API:
    //    POST ${openCodeUrl}/sessions
    //    Body: { prompt: systemPrompt, model: run.agent.model }
    // 2. Get OpenCode session_id from response
    // 3. Wire pre-bound mcpServer to the session (agent needs it from first message)
    // 4. DO NOT create session_run_mapping — dispatcher owns it (D25)
    // 5. Start heartbeat polling with plugin-health attestation (§4)
    // 6. Return HarnessSession with sessionId for dispatcher to record
  }

  async kill(sessionId: string): Promise<void> {
    // DELETE ${openCodeUrl}/sessions/${sessionId}
    // NOTE: do NOT clean up session_run_mapping here — dispatcher owns it (D25)
  }

  async isAlive(sessionId: string): Promise<boolean> {
    // GET ${openCodeUrl}/sessions/${sessionId}/status
  }
}
```

### 4. Heartbeat with plugin-health attestation

OpenCode sessions may not have automatic heartbeat. The adapter polls BOTH session liveness AND plugin health. A session that is alive but missing enforcement is worse than a dead session — the agent runs unmonitored.

```typescript
const heartbeatInterval = setInterval(async () => {
  const alive = await this.isAlive(session.sessionId)
  if (!alive) {
    clearInterval(heartbeatInterval)
    return
  }

  // Check plugin health via a probe routed THROUGH the OpenCode session.
  // This proves the plugin is loaded and intercepting — not just that
  // Ductum Core is reachable (which a direct API call would prove).
  const pluginHealthy = await this.probePluginHealth(session.sessionId)

  if (pluginHealthy) {
    await fetch(`${this.apiUrl}/api/runs/${run.id}/heartbeat`, { method: 'POST' })
  } else {
    // Session alive but enforcement missing — kill the session immediately.
    // An unmonitored agent is more dangerous than a stalled run.
    console.error(`Plugin health check failed for session ${session.sessionId} — killing session`)
    await this.kill(session.sessionId)
    clearInterval(heartbeatInterval)
  }
}, 30_000)
```

**Plugin-health probe design:**

`probePluginHealth(sessionId)` must route through the OpenCode session, not call Ductum Core directly. A direct call to `POST /api/internal/authorize-tool` would prove Ductum Core is alive but says nothing about whether the plugin is intercepting tool calls in the OpenCode process.

Approach: submit a synthetic tool call through the OpenCode session's REST API:
```typescript
async probePluginHealth(sessionId: string): Promise<boolean> {
  // Step 1: Submit a synthetic tool call THROUGH the OpenCode session.
  // This is the critical step — it exercises the real tool-call path.
  // If the plugin is loaded, its beforeToolCall hook fires, calls
  // authorize_tool on Ductum Core, which records the probe arrival.
  // If the plugin is NOT loaded, the call bypasses enforcement entirely
  // and no probe reaches Ductum Core.
  try {
    await fetch(`${this.openCodeUrl}/sessions/${sessionId}/tool-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: '__ductum_health_probe__', args: {} }),
    })
  } catch {
    // OpenCode session may reject the synthetic call — that's fine,
    // the plugin hook fires before execution regardless.
  }

  // Step 2: Ask Ductum Core if the probe arrived (i.e., if the plugin
  // intercepted the tool call and forwarded it).
  const probeArrived = await fetch(
    `${this.apiUrl}/api/internal/plugin-probe?session_id=${sessionId}`
  )
  const { seen } = await probeArrived.json()

  // Step 3: If seen is false, the plugin is not loaded/intercepting.
  // Caller will kill the session.
  return seen === true
}
```

This requires:
1. Plugin's `beforeToolCall` fires for ALL tool names including the probe
2. Ductum Core records probe arrivals per-session with a timestamp
3. `GET /api/internal/plugin-probe?session_id=X` returns `{ seen: true }` if a probe arrived within the last heartbeat interval

If the plugin is not loaded, no probe reaches Ductum Core, `seen` is `false`, and the adapter kills the session.

### 5. Token cost tracking for OpenCode

OpenCode provides aggregate token counts via session stats endpoint:

```typescript
// Poll periodically or on session complete
const stats = await fetch(`${openCodeUrl}/sessions/${sessionId}/stats`)
const { totalInputTokens, totalOutputTokens } = await stats.json()
const costUsd = calculateCost(run.agent.model, totalInputTokens, totalOutputTokens)
```

Normalize to the same cost model as the Claude adapter.

### 6. Plugin failure modes

**Mode A: Plugin loaded, Ductum API unreachable.**
- Plugin fails closed: blocks all tool calls. Agent is stuck but safe.
- Adapter heartbeat probe succeeds (plugin is there) but plugin's own calls to Ductum API fail.
- If the plugin reports API-unreachable back to the adapter, kill the session immediately.

**Mode B: Plugin not loaded at all.**
- Agent runs unmonitored — worst case.
- Adapter's plugin-health probe (§4) detects this: no probe arrives at Ductum Core from this session, `GET /api/internal/plugin-probe` returns `{ seen: false }`.
- Adapter kills the session immediately. No heartbeat sent → run also becomes stalled as a backstop.
- This is why the probe routes through OpenCode, not directly to Ductum API: a direct call would pass even with a pluginless session.

### 7. Plugin deployment configuration

File: `packages/harness/src/plugin/README.md`

Instructions for deploying the plugin to OpenCode's plugin directory:

```bash
# Copy plugin to OpenCode plugin directory
cp packages/harness/dist/plugin/index.js ~/.opencode/plugins/ductum/index.js

# Or symlink for development
ln -s $(pwd)/packages/harness/dist/plugin/index.js ~/.opencode/plugins/ductum/index.js

# Set Ductum API URL in OpenCode config or environment
export DUCTUM_API_URL=http://localhost:4100
```

### 8. Tests

File: `packages/harness/src/tests/opencode.test.ts`

Mock OpenCode REST API and Ductum API:

- Plugin: authorize_tool allowed -> tool proceeds
- Plugin: authorize_tool blocked -> tool rejected with reason
- Plugin: Ductum API unreachable -> fail closed (block)
- Plugin: unknown session_id -> blocked
- Adapter: spawn creates session and mapping
- Adapter: kill terminates session and cleans mapping
- Adapter: heartbeat polling works
- Session-to-run resolution: correct run resolved for tool authorization
- Concurrent sessions: two runs on same server, each gets correct policy

## Verification Checklist

- [ ] `pnpm test` in packages/harness — all OpenCode adapter tests pass
- [ ] Plugin is stateless — no per-run state
- [ ] Plugin delegates all policy to Ductum Core via authorize_tool
- [ ] Plugin fails closed when Ductum API is unreachable
- [ ] Session-to-run mapping correctly resolves session identity
- [ ] Concurrent runs get independent policy evaluation
- [ ] Heartbeat polling includes plugin-health probe (not just session liveness)
- [ ] Missing/crashed plugin detected and session killed immediately
- [ ] Token cost normalized to same model as Claude adapter
- [ ] Plugin deployment instructions are clear
- [ ] If OpenCode plugin API cannot block tools: gap documented prominently
