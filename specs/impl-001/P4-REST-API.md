# P4: REST API + SSE Event Stream

**Scope:** Hono HTTP server with CRUD routes for all primitives, run management, SSE stream
**Package:** `packages/api`
**Depends on:** P1 (types, repos), P2 (state machine, enforcement), P3 (DAG evaluator)
**Deliverable:** Working REST API with all endpoints, SSE event stream, health check
**Verification:** `cd packages/api && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §4 (Architecture), §8 (MCP Tool Surface — for run management endpoints)
- `ARCHITECTURE.md` §System layers (REST API serves MCP server, CLI, and dashboard)
- All repository interfaces from P1

## Shared Modules (import from P1, P2, P3)

| What | Where |
|------|-------|
| All types | `packages/core/src/types.ts` |
| All repos | `packages/core/src/repos/` |
| RunStateMachine | `packages/core/src/state-machine.ts` |
| EnforcementManager | `packages/core/src/enforce.ts` |
| DAGEvaluator | `packages/core/src/dag.ts` |
| DuctumEventEmitter | `packages/core/src/events.ts` |

## Tasks

### 1. Scaffold API package

- `packages/api/package.json` with dependencies: `hono`, `@hono/node-server`
- `packages/api/tsconfig.json` extending base
- Workspace dependency on `@ductum/core`

### 2. Application factory

File: `packages/api/src/app.ts`

```typescript
import { Hono } from 'hono'

function createApp(deps: {
  db: Database
  stateMachine: RunStateMachine
  enforcement: EnforcementManager
  dag: DAGEvaluator
  events: DuctumEventEmitter
}): Hono
```

Wire all routes. Return the Hono app (testable without starting a server).

### 3. Factory routes

File: `packages/api/src/routes/factory.ts`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/factory` | Get factory config |
| PUT | `/api/factory` | Update factory config |

### 4. Project routes

File: `packages/api/src/routes/projects.ts`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/agents` | List project agents |
| POST | `/api/projects/:id/agents` | Assign agent to project |
| DELETE | `/api/projects/:id/agents/:agentId` | Unassign agent |

### 5. Agent routes

File: `packages/api/src/routes/agents.ts`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents` | Register agent |
| GET | `/api/agents/:id` | Get agent |
| PUT | `/api/agents/:id` | Update agent |
| DELETE | `/api/agents/:id` | Delete agent |

### 6. Spec routes

File: `packages/api/src/routes/specs.ts`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/projects/:projectId/specs` | List specs for project |
| POST | `/api/projects/:projectId/specs` | Create spec |
| GET | `/api/specs/:id` | Get spec |
| PUT | `/api/specs/:id/status` | Update spec status |
| DELETE | `/api/specs/:id` | Delete spec |
| GET | `/api/specs/:id/dependencies` | List spec dependencies |
| POST | `/api/specs/:id/dependencies` | Add spec dependency |
| DELETE | `/api/specs/:id/dependencies/:depId` | Remove spec dependency |

### 7. Task routes

File: `packages/api/src/routes/tasks.ts`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/specs/:specId/tasks` | List tasks for spec |
| POST | `/api/specs/:specId/tasks` | Create task |
| GET | `/api/tasks/:id` | Get task |
| DELETE | `/api/tasks/:id` | Delete task |
| GET | `/api/tasks/:id/dependencies` | List task dependencies |
| POST | `/api/tasks/:id/dependencies` | Add task dependency (validates no cycles via DAG) |
| DELETE | `/api/tasks/:id/dependencies/:depId` | Remove task dependency |
| POST | `/api/tasks/evaluate-dag` | Trigger DAG re-evaluation for a spec |

### 8. Run management routes

File: `packages/api/src/routes/runs.ts`

These map to the MCP tool surface (spec.md §8) but are plain REST:

| Method | Path | Purpose | Maps to MCP |
|--------|------|---------|-------------|
| GET | `/api/tasks/:taskId/runs` | List runs for task | — |
| GET | `/api/runs/:id` | Get run detail | — |
| POST | `/api/runs/next-task` | Get next unblocked task | `ductum.next_task` |
| POST | `/api/runs/accept` | Accept task, create run | `ductum.accept` |
| POST | `/api/runs/:id/complete` | Complete a run | `ductum.complete` |
| POST | `/api/runs/:id/update` | Report progress | `ductum.update` |
| POST | `/api/runs/:id/heartbeat` | Heartbeat | `ductum.heartbeat` |
| POST | `/api/runs/:id/decide` | Record decision | `ductum.decide` |
| POST | `/api/runs/:id/gate-check` | Request stage transition | `ductum.gate_check` |
| POST | `/api/runs/:id/wait` | Enter wait state | `ductum.wait` |
| POST | `/api/runs/:id/fail` | Report failure | `ductum.fail` |
| POST | `/api/runs/:id/evidence` | Attach evidence | `ductum.evidence` |
| POST | `/api/runs/:id/link` | Link git artifacts | `ductum.link` |
| GET | `/api/tasks/:taskId/context` | Get crash recovery context | `ductum.get_context` |

**Internal-only (not exposed to MCP, D25):**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/runs/:id/authorize-tool` | Tool-call authorization by run_id (Claude adapter) |
| POST | `/api/internal/authorize-tool` | Tool-call authorization by session_id (OpenCode plugin) — resolves session_id -> run_id via session_run_mapping, then delegates to same logic |
| POST | `/api/runs/:id/reset` | Reset run stage (Ductum Core only) |
| POST | `/api/runs/:id/tokens` | Update token/cost counters (harness adapters only) — body: `{ tokensIn, tokensOut, costUsd }`, adds to run's running totals |
| GET | `/api/internal/plugin-probe` | Plugin-health attestation — query: `session_id`. Returns `{ seen: true }` if the OpenCode plugin sent a probe for this session within the last heartbeat interval. Used by OpenCode adapter to verify the plugin is loaded and intercepting. |

Both authorize-tool routes call `EnforcementManager.authorizeTool(runId, tool, args)`. The session-based route exists because the OpenCode plugin only knows its session_id, not the run_id (D15, D25).

Run route implementations delegate to RunStateMachine, EnforcementManager, and DAGEvaluator as appropriate.

### 9. Decision routes

File: `packages/api/src/routes/decisions.ts`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/decisions` | List decisions (filter by spec/task/run) |
| POST | `/api/decisions` | Create decision |

### 10. Evidence + gate evaluation routes

File: `packages/api/src/routes/evidence.ts`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/runs/:id/evidence` | List evidence for run |
| GET | `/api/runs/:id/gate-evaluations` | List gate evaluations for run |

### 11. SSE event stream

File: `packages/api/src/routes/events.ts`

```typescript
// GET /api/events/stream
// Optional query params: runId, taskId, specId, projectId (filters)
app.get('/api/events/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const unsubscribe = events.subscribe((event) => {
      // Filter by query params if provided
      stream.writeSSE({ data: JSON.stringify(event), event: event.type })
    })
    // Keep alive until client disconnects
    stream.onAbort(() => unsubscribe())
  })
})
```

### 12. Server entrypoint

File: `packages/api/src/index.ts`

- Parse CLI args: `--port` (default 4100), `--db` (default `./ductum.db`)
- Initialize database via `initDb(dbPath)`
- Create all repos
- Create state machine, enforcement manager, DAG evaluator, event emitter
- Create Hono app via `createApp(deps)`
- Start server via `@hono/node-server`

### 13. Error handling

File: `packages/api/src/middleware/errors.ts`

Hono error handler middleware:
- Validation errors -> 400
- Not found -> 404
- Invalid state transitions -> 409 Conflict
- Internal errors -> 500

All errors return `{ error: string, details?: unknown }`.

### 14. Tests

File: `packages/api/src/tests/routes.test.ts`

Use Hono's test client (no server needed):
- CRUD operations for each resource
- Run lifecycle: accept -> gate_check -> complete
- SSE: subscribe and receive events on state change
- Error cases: invalid transitions return 409
- DAG cycle detection on task dependency creation returns 400
- authorize-tool: blocked tool returns 403
- authorize-tool: allowed tool returns 200
- Health check: GET /api/health returns 200

## Verification Checklist

- [ ] `pnpm test` in packages/api — all pass
- [ ] All CRUD routes work for all primitives
- [ ] Run management routes correctly delegate to state machine
- [ ] gate_check route validates transitions and evidence
- [ ] authorize-tool route uses @edictum/core evaluation
- [ ] SSE stream delivers events in real-time
- [ ] Error responses use correct HTTP status codes
- [ ] DAG cycle detection prevents invalid dependencies
- [ ] Server starts on configurable port
- [ ] No file exceeds 300 lines
