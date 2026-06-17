# P7: Claude Harness Adapter

**Scope:** Claude Agent SDK integration with tool-call interception, session lifecycle, auto heartbeat, cost tracking
**Package:** `packages/harness`
**Depends on:** P2 (state machine, enforcement), P4 (REST API)
**Deliverable:** ClaudeHarnessAdapter that spawns Claude sessions with structural enforcement
**Verification:** `cd packages/harness && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §9.1 (Claude Harness Adapter)
- `HARNESS.md` §Claude harness adapter (full description)
- `HARNESS.md` §Enforcement boundary ("Within a stage: freedom. Between stages: harness governs.")
- `decisions/003-round-1-response.md` §D11 (structural enforcement, not advisory)
- `decisions/006-round-3-final.md` §C1 (authorize_tool is harness-internal), §C5 (session-to-run binding)
- `OPEN-QUESTIONS.md` §Q1 (harness contract — required capabilities)
- Claude Agent SDK documentation — verify the tool-call interception API

**Critical: Read the actual Claude Agent SDK docs before implementing.** The SDK API surface determines what's possible. If the SDK does not support tool-call interception via middleware/hooks, document the gap and implement the closest alternative.

## Tasks

### 1. Scaffold harness package

- `packages/harness/package.json` with dependencies: `@claude-ai/agent-sdk` (or current package name)
- `packages/harness/tsconfig.json` extending base
- Workspace dependency on `@ductum/core`

### 2. Define HarnessAdapter interface

File: `packages/harness/src/types.ts`

```typescript
interface HarnessAdapter {
  // Spawn an agent session for a run.
  // mcpServer is pre-bound to run_id by the dispatcher (D22) — wire it
  // to the session so the agent has Ductum tools from its first message.
  spawn(run: Run, task: Task, systemPrompt: string, mcpServer: DuctumMcpServer): Promise<HarnessSession>

  // Kill a running session
  kill(sessionId: string): Promise<void>

  // Check if a session is alive
  isAlive(sessionId: string): Promise<boolean>
}

interface HarnessSession {
  sessionId: string
  runId: RunId

  // Wait for the session to complete (resolves when agent finishes or crashes)
  waitForCompletion(): Promise<HarnessSessionResult>
}

interface HarnessSessionResult {
  exitReason: 'completed' | 'crashed' | 'killed' | 'timeout'
  tokensIn: number
  tokensOut: number
  costUsd: number
}
```

### 3. Implement ClaudeHarnessAdapter

File: `packages/harness/src/claude.ts`

```typescript
class ClaudeHarnessAdapter implements HarnessAdapter {
  constructor(
    private apiUrl: string,          // Ductum API URL for authorize_tool
    // NOTE: no SessionRunMappingRepo — dispatcher is sole owner (D25)
  )

  async spawn(run: Run, task: Task, systemPrompt: string, mcpServer: DuctumMcpServer): Promise<HarnessSession> {
    // 1. Create Claude Agent SDK session, wire pre-bound mcpServer to it
    // 2. Inject system prompt (NO run_id — D22)
    // 3. Register tool-call interceptor:
    //    Before any tool executes, call authorize_tool(run.id, tool, args)
    //    via POST /api/runs/:id/authorize-tool (Claude adapter knows run_id)
    //    If blocked: reject the tool call, return reason to agent
    //    If allowed: let tool execute
    // 4. DO NOT create session_run_mapping here — dispatcher owns it (D25)
    // 5. Start automatic heartbeat (every 30s)
    // 6. Start token usage tracking
    // 7. Return HarnessSession with sessionId for dispatcher to record
  }
}
```

### 4. Tool-call interception

The key enforcement mechanism. Every tool call the agent makes passes through Ductum's authorization before execution.

```typescript
// Pseudo-code — adapt to actual Agent SDK API
agent.onToolCall(async (toolName, toolArgs) => {
  // Call Ductum Core's authorize_tool endpoint
  const response = await fetch(`${apiUrl}/api/runs/${runId}/authorize-tool`, {
    method: 'POST',
    body: JSON.stringify({ tool: toolName, args: toolArgs }),
  })
  const result = await response.json()

  if (!result.allowed) {
    // Block the tool call — agent receives the reason
    return { blocked: true, reason: result.reason }
  }

  // Allow the tool call to proceed
  return { blocked: false }
})
```

**If the Agent SDK does not support pre-execution hooks:** Document this as a finding. Alternative approaches:
1. Wrap each tool's callable before registering it with the SDK
2. Use the SDK's message-level hooks to intercept before tool dispatch
3. Register a middleware that runs before tool execution

### 5. Automatic heartbeat

```typescript
// Runs every 30 seconds while the session is active
const heartbeatInterval = setInterval(async () => {
  await fetch(`${apiUrl}/api/runs/${runId}/heartbeat`, { method: 'POST' })
}, 30_000)

// Clean up on session end
session.onEnd(() => clearInterval(heartbeatInterval))
```

### 6. Token and cost tracking

```typescript
// Track tokens per message
agent.onMessage(async (message) => {
  const usage = message.usage  // { inputTokens, outputTokens }
  if (usage) {
    const costUsd = calculateCost(run.agent.model, usage.inputTokens, usage.outputTokens)
    await fetch(`${apiUrl}/api/runs/${runId}/tokens`, {
      method: 'POST',
      body: JSON.stringify({
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        costUsd,
      }),
    })
  }
})
```

### 7. Session crash detection

```typescript
session.waitForCompletion().then((result) => {
  if (result.exitReason === 'crashed') {
    // Session crashed — run will be detected as stalled via heartbeat timeout
    // Log the crash for debugging
    console.error(`Claude session ${session.sessionId} crashed: ${result.error}`)
  }
})
```

### 8. System prompt template

File: `packages/harness/src/prompts/claude-system.ts`

Template for the system prompt injected into Claude sessions:

```typescript
function buildClaudeSystemPrompt(task: Task): string {
  return `You are working on a task managed by Ductum.

## Task
${task.prompt}

## Ductum MCP Tools
Use these tools to report progress and request stage transitions:
- ductum.update(message) — report what you're doing
- ductum.gate_check(target_stage) — request to advance stage
- ductum.evidence(type, payload) — attach test/CI results
- ductum.link(branch, commit, pr) — link git artifacts
- ductum.decide(decision, context) — record design decisions
- ductum.complete(result) — when fully done

## Workflow
Your tool calls are governed by Ductum's enforcement layer. You cannot:
- git push during implementing (advance to pushing stage first)
- Skip stages (each transition requires evidence)
- Self-reset (report failures via ductum.fail, Ductum Core handles resets)

## Verification
${task.verification.map((v, i) => `${i + 1}. ${v}`).join('\n')}
`
}
```

**IMPORTANT (D22):** No `run_id` in the prompt. The MCP server is pre-bound to the run by the dispatcher. The agent never sees or passes `run_id`. This is advisory context (so the agent knows what tools are available), NOT enforcement. Enforcement is structural via the tool-call interceptor.

### 9. Tests

File: `packages/harness/src/tests/claude.test.ts`

Since the Claude Agent SDK may not be available in test environments, test the adapter logic with mocks:

- Tool-call interceptor: mock authorize_tool response
  - Blocked tool -> interceptor returns block reason
  - Allowed tool -> interceptor allows execution
- Heartbeat: mock timer fires and calls heartbeat endpoint
- Token tracking: mock message with usage -> cost calculated correctly
- Session mapping: spawn returns sessionId (dispatcher records mapping, D25)
- System prompt: template renders correctly with task/run context
- Kill: cleans up intervals and mapping

## Verification Checklist

- [ ] `pnpm test` in packages/harness — all Claude adapter tests pass
- [ ] HarnessAdapter interface defined and exported
- [ ] ClaudeHarnessAdapter implements HarnessAdapter
- [ ] Tool-call interception calls authorize_tool before every tool execution
- [ ] Blocked tools are rejected with reason (agent receives the reason)
- [ ] Automatic heartbeat runs every 30s
- [ ] Token usage tracked per message
- [ ] Session-to-run mapping NOT created here — returns sessionId for dispatcher (D25)
- [ ] Session crash detected (at minimum via heartbeat timeout)
- [ ] System prompt includes task and verification checklist — NO run_id (D22)
- [ ] If Agent SDK doesn't support tool-call hooks: gap documented with workaround
