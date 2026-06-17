# P5: MCP Server

**Scope:** 12 agent-visible MCP tools as a stateless wrapper over the Core REST API
**Package:** `packages/mcp`
**Depends on:** P4 (REST API)
**Deliverable:** MCP server with all 12 tools, connectable by Claude Code, OpenCode, and other MCP clients
**Verification:** `cd packages/mcp && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §8 (MCP Tool Surface — all 12 tools with signatures)
- `decisions/006-round-3-final.md` §D20 (reset is NOT agent-visible)
- `decisions/003-round-1-response.md` §D13 (expanded tool surface)
- `decisions/001-founding-session.md` §D7 (MCP + CLI are thin clients of same REST API)
- `ARCHITECTURE.md` §MCP tool surface (13 tools listed; reduced to 12 after D20)

## Tasks

### 1. Scaffold MCP package

- `packages/mcp/package.json` with dependency: `@modelcontextprotocol/sdk`
- `packages/mcp/tsconfig.json` extending base
- Workspace dependency on `@ductum/core` (for types only)

### 2. API client

File: `packages/mcp/src/api-client.ts`

Typed fetch wrapper for all REST API endpoints from P4. Each method maps to one REST endpoint. Note: the API client takes `runId` as a parameter (it's calling the REST API), but the MCP tools do NOT expose this to the agent — they use the server's bound `currentRunId`.

```typescript
class DuctumApiClient {
  constructor(private baseUrl: string)

  // Task lifecycle
  async nextTask(project?: string, role?: string): Promise<Task | null>
  async accept(taskId: string): Promise<Run>
  async complete(runId: string, result: string, pr?: string): Promise<Run>

  // Progress
  async update(runId: string, message: string): Promise<void>
  async heartbeat(runId: string): Promise<void>
  async decide(runId: string, decision: string, context: string, alternatives?: string[]): Promise<Decision>

  // Enforcement
  async gateCheck(runId: string, targetStage: string): Promise<{ allowed: boolean; reason?: string }>
  async wait(runId: string, waitingFor: string, timeout?: number): Promise<Run>
  async fail(runId: string, reason: string, recoverable?: boolean): Promise<Run>

  // Evidence
  async evidence(runId: string, type: string, payload: object): Promise<Evidence>
  async link(runId: string, opts: { branch?: string; commit?: string; pr?: string }): Promise<Run>

  // Recovery
  async getContext(taskId: string): Promise<RunContext>
}
```

### 3. Per-session MCP server with run binding (D22)

File: `packages/mcp/src/server.ts`

**Critical design (D22): Agents never pass `run_id`.** The MCP server is per-session and maintains a `currentRunId` binding. This prevents cross-run corruption.

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'

class DuctumMcpServer {
  private currentRunId: RunId | null = null

  constructor(private client: DuctumApiClient, preBindRunId?: RunId)

  // Bind to a run (called by accept, get_context, or pre-set in push mode)
  bindToRun(runId: RunId): void

  // Guard: throws if no run is bound
  requireBoundRun(): RunId
}
```

**Binding lifecycle:**
- **Push mode:** `new DuctumMcpServer(client, runId)` — pre-bound at construction
- **Pull mode:** starts unbound → `accept()` calls `bindToRun(newRunId)` → subsequent tools use it
- **Crash recovery:** `get_context()` calls `bindToRun(stalledRunId)` → resumes

Register all 12 tools. **No tool takes `run_id` as a parameter:**

**Task lifecycle:**

| Tool name | Parameters | Description |
|-----------|-----------|-------------|
| `ductum.next_task` | `project?: string, role?: string` | Get next unblocked task. No run binding required. |
| `ductum.accept` | `task_id: string` | Claim task, create run, **bind MCP server to new run**. Returns task prompt. |
| `ductum.complete` | `result: string, pr?: string` | Mark bound run as done. Triggers DAG re-evaluation. |

**Progress reporting:**

| Tool name | Parameters | Description |
|-----------|-----------|-------------|
| `ductum.update` | `message: string` | Report progress on bound run. |
| `ductum.heartbeat` | (none) | Keep bound run alive. Call every 30s. |
| `ductum.decide` | `decision: string, context: string, alternatives?: string[]` | Record a decision on bound run. |

**Enforcement + state transitions:**

| Tool name | Parameters | Description |
|-----------|-----------|-------------|
| `ductum.gate_check` | `target_stage: string` | Request stage advancement on bound run. |
| `ductum.wait` | `waiting_for: string, timeout?: number` | Enter wait state on bound run. |
| `ductum.fail` | `reason: string, recoverable?: boolean` | Report failure on bound run. |

**Evidence + linking:**

| Tool name | Parameters | Description |
|-----------|-----------|-------------|
| `ductum.evidence` | `type: string, payload: object` | Attach evidence to bound run. |
| `ductum.link` | `branch?: string, commit?: string, pr?: string` | Link git artifacts to bound run. |

**Recovery:**

| Tool name | Parameters | Description |
|-----------|-----------|-------------|
| `ductum.get_context` | `task_id: string` | Full crash recovery state. **Binds MCP server to existing stalled run.** |

Each tool handler:
1. For tools requiring a bound run: calls `requireBoundRun()` — returns error content if unbound
2. Calls `DuctumApiClient` method with resolved `runId`
3. Returns structured MCP content blocks
4. Handles errors gracefully (returns error content, does not throw)

### 4. Tool parameter schemas

Each tool must declare its `inputSchema` as JSON Schema for MCP parameter validation. Define schemas inline in the tool registration. Note: `run_id` is NOT in any schema.

### 5. Server entrypoint + factory

File: `packages/mcp/src/index.ts`

- Parse environment: `DUCTUM_API_URL` (default `http://localhost:4100`), `DUCTUM_RUN_ID` (optional, for push mode pre-binding)
- Create API client
- Create `DuctumMcpServer` (with optional pre-bound run_id from env)
- Register all tools
- Start stdio transport (for Claude Code / MCP clients)

Export `createMcpServer(apiUrl, preBindRunId?)` factory for programmatic use (harness adapters in P7/P8 and dispatcher in P10).

### 6. Tests

File: `packages/mcp/src/tests/tools.test.ts`

Mock the API client. Test each tool:
- `next_task`: returns task when available, handles empty
- `accept`: returns run ID and prompt
- `complete`: succeeds, returns confirmation
- `gate_check`: returns allowed with stage update
- `gate_check`: returns blocked with reason
- `fail`: with recoverable=true returns reset notice
- `fail`: with recoverable=false returns terminal notice
- `evidence`: attaches and returns confirmation
- `get_context`: returns full run state
- Parameter validation: missing required params return error content
- API errors are returned as MCP error content (not thrown)

## Verification Checklist

- [ ] `pnpm test` in packages/mcp — all pass
- [ ] All 12 tools registered with correct names and schemas
- [ ] **No tool accepts `run_id` as a parameter (D22)**
- [ ] `ductum.reset` is NOT in the tool list (D20)
- [ ] `authorize_tool` is NOT in the tool list (C1 — harness-internal only)
- [ ] `accept` binds MCP server to new run
- [ ] `get_context` binds MCP server to existing stalled run
- [ ] Tools requiring a bound run return error content if unbound
- [ ] Each tool returns structured MCP content
- [ ] API errors converted to error content (not exceptions)
- [ ] Server starts on stdio transport
- [ ] `createMcpServer(apiUrl, preBindRunId?)` factory exported
- [ ] `DUCTUM_RUN_ID` env var pre-binds in push mode
