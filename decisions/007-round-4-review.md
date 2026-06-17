# Phase 6 Adversarial Review — Round 4 (Implementation Spec)

**Reviewer:** Codex (GPT-5.4)
**Responder:** Claude (Opus 4.6)
**Date:** 2026-04-04
**Scope:** specs/impl-001/ (spec.md, README.md, P1-P11)

---

## Findings

### F12 — High: C5 still broken — MCP tools trust caller-supplied run_id

spec.md says session-to-run binding is authoritative and "No run_id in prompt text" (D21, C5), but the MCP layer is a stateless `run_id` wrapper over REST. All 12 MCP tools take `run_id` as a parameter, P7 injects `run_id` into the system prompt, and the REST routes are all `:id`-keyed. Only harness-side `authorize_tool` is session-bound; all agent-visible mutations (`update`, `evidence`, `gate_check`, `complete`, etc.) trust caller-supplied run IDs. That reopens cross-run corruption.

**Sources:** spec.md §8, P5-MCP-SERVER.md, P4-REST-API.md, P7-HARNESS-CLAUDE.md §8

### F13 — High: P2 StorageBackend does not match @edictum/core interface

P2 tells the implementer to build `getValue/setValue/deleteValue`. The actual TS SDK `StorageBackend` interface also requires `getCounter(sessionId, key)` and `incrementCounter(sessionId, key, delta)`. `Session` depends on `incrementCounter` for attempt counts, execution counts, and failure counters. Implementing P2 literally yields an adapter that cannot satisfy the SDK contract.

**Sources:** P2-STATE-MACHINE.md §3, edictum-ts storage.ts, session.ts

### F14 — High: P2 uses volatile harness sessionId as Edictum session key

spec.md correctly uses `new Session(run.id, ...)` which preserves workflow state across crashes. P2 then says `authorizeTool` should create the Session with "run's session ID" — which is the harness session ID (volatile, changes on resume). That fragments workflow state across resumes and undercuts crash resilience.

**Sources:** spec.md §7.2, P2-STATE-MACHINE.md §4

### F15 — High: Conflicting harness/internal API boundaries across prompts

P4 defines `POST /api/runs/:id/authorize-tool`. P7 calls that route. P8 invents a different `POST /api/internal/authorize-tool` keyed by `session_id`. Additionally, P7, P8, and P10 all claim to create the `session_run_mapping` entry — triple ownership of the same primary key.

**Sources:** P4-REST-API.md §8, P7-HARNESS-CLAUDE.md §3, P8-HARNESS-OPENCODE.md §2, P10-DISPATCHER.md §4

### F16 — High: Watcher semantics diverge from spec — in-memory objects, no commit SHA dedup

spec.md says watchers are child runs with cost tracking and duplicate CI signals deduped by commit SHA. P9 replaces that with in-memory watcher objects deduped only on the latch field. On fix→re-push cycles, a late CI result from an older commit can resolve the current latch. Watcher work also vanishes from run history and cost tracking.

**Sources:** spec.md §11, P9-WATCHERS.md

### F17 — Medium: Single WorkflowRuntime lock serializes all runs

spec.md says one WorkflowRuntime per factory, shared across runs. The actual TS SDK's WorkflowRuntime has an instance-level async lock around evaluate/state/reset/recordResult. Routing every intercepted tool call through one runtime serializes workflow evaluation across independent runs.

**Sources:** spec.md §7.2, edictum-ts runtime.ts L206

---

## Resolutions

### F12 — ACCEPTED: MCP server is per-session, pre-bound to run_id

The MCP server must not accept `run_id` from the agent. Instead:

**Push mode:** Harness spawns a per-session MCP server instance pre-bound to `run_id`. All tools use the bound `run_id` implicitly.

**Pull mode:** MCP server starts unbound. After `ductum.accept(task_id)`, the server binds to the new run. After `ductum.get_context(task_id)` (crash recovery), the server binds to the existing stalled run.

Tool signatures lose `run_id` parameter:
- `ductum.next_task(project?, role?)` — unchanged
- `ductum.accept(task_id)` — creates run, binds MCP server, returns run info
- `ductum.complete(result, pr?)` — implicit run_id
- `ductum.update(message)` — implicit run_id
- `ductum.heartbeat()` — implicit run_id
- `ductum.decide(decision, context, alternatives?)` — implicit run_id
- `ductum.gate_check(target_stage)` — implicit run_id
- `ductum.wait(waiting_for, timeout?)` — implicit run_id
- `ductum.fail(reason, recoverable?)` — implicit run_id
- `ductum.evidence(type, payload)` — implicit run_id
- `ductum.link(branch?, commit?, pr?)` — implicit run_id
- `ductum.get_context(task_id)` — binds MCP server to existing run, returns full state

P7 system prompt: remove `run_id`. The agent never sees or passes run_id.

### F13 — ACCEPTED: SQLite StorageBackend must implement full interface

The adapter must implement all 5 methods from the actual @edictum/core StorageBackend:
- `getCounter(sessionId, key)` → number
- `incrementCounter(sessionId, key, delta)` → number
- `getValue(sessionId, key)` → string | null
- `setValue(sessionId, key, value)` → void
- `deleteValue(sessionId, key)` → void

Add two tables:
```sql
CREATE TABLE edictum_session_counters (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, key)
);

CREATE TABLE edictum_session_values (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);
```

### F14 — ACCEPTED: Session key is run.id (stable), not harness sessionId

`@edictum/core` Session is always keyed by `run.id`. This is stable across harness crashes and session resumes. The harness `sessionId` is only used for `session_run_mapping` (ephemeral binding).

```typescript
// CORRECT: stable across resumes
const session = new Session(runId, sqliteStorageBackend)

// WRONG: fragments on resume
const session = new Session(harnessSessionId, sqliteStorageBackend)
```

### F15 — ACCEPTED: Single authorize-tool contract, dispatcher owns session mapping

**Authorize-tool routes:** Two routes, same internal logic:
- `POST /api/runs/:id/authorize-tool` — for callers that know run_id (Claude adapter)
- `POST /api/internal/authorize-tool` — for callers that know session_id (OpenCode plugin), resolves session_id → run_id first, then delegates to same logic

Both call `EnforcementManager.authorizeTool(runId, tool, args)`.

**Session mapping ownership:** Dispatcher (P10) is the sole creator. Harness adapters return `sessionId` from `spawn()`. Dispatcher records the mapping. P7 and P8 remove their mapping creation code.

### F16 — ACCEPTED: Watchers are child runs with commit SHA dedup

Watchers create child Run records in the database (parent_run_id set). This gives:
- Cost tracking (tokens/cost on the child run)
- History (child run appears in run list)
- Audit trail

Dedup by commit SHA: when CI evidence arrives, check that the evidence's commit SHA matches the parent run's current `commit_sha`. If stale (from a previous push), discard the signal.

On reset to fixing: WatcherManager stops current watchers. On re-push: new watchers spawned with new commit SHA context. Old watchers cannot accidentally resolve new latches.

### F17 — ACCEPTED: One WorkflowRuntime per run, not per factory

Create a `WorkflowRuntime` instance per run. The workflow definition is shared (immutable, loaded once). The runtime (with its lock and evaluator state) is per-run.

```typescript
class EnforcementManager {
  private definition: WorkflowDefinition  // shared, loaded once
  private runtimes: Map<RunId, WorkflowRuntime> = new Map()

  getRuntime(runId: RunId): WorkflowRuntime {
    let runtime = this.runtimes.get(runId)
    if (!runtime) {
      runtime = new WorkflowRuntime(this.definition)
      this.runtimes.set(runId, runtime)
    }
    return runtime
  }

  // Clean up when run completes
  disposeRuntime(runId: RunId): void {
    this.runtimes.delete(runId)
  }
}
```

---

## Decisions

### D22: MCP server is per-session, pre-bound to run_id — agents never pass run_id

**Context:** Codex found MCP tools trust caller-supplied run_id, violating C5/D21.
**Decision:** MCP server instances are per-session. Push mode: pre-bound. Pull mode: binds on accept/get_context. All tool signatures drop run_id parameter.
**Supersedes:** Implicit design in spec.md §8 and P5.

### D23: SQLite StorageBackend implements full @edictum/core interface including counters

**Context:** Codex found P2's adapter was missing getCounter/incrementCounter.
**Decision:** Adapter implements all 5 StorageBackend methods. Two new tables for counters and values.

### D24: @edictum/core Session keyed by run.id (stable), not harness sessionId (volatile)

**Context:** Codex found P2 used volatile harness sessionId, fragmenting workflow state on crash recovery.
**Decision:** Session always keyed by run.id. Harness sessionId only used for session_run_mapping.
**Supersedes:** Contradictory language in P2.

### D25: Single authorize-tool contract with two routes, dispatcher sole owner of session mapping

**Context:** Codex found conflicting API boundaries and triple ownership of session mapping.
**Decision:** Two routes (run-scoped + session-scoped) calling same logic. Dispatcher is the sole creator of session_run_mapping entries.

### D26: Watchers are child runs with commit SHA dedup, respawned on re-push

**Context:** Codex found watchers were in-memory-only and lacked commit SHA dedup.
**Decision:** Watchers create child Run records. Evidence deduped by commit SHA against parent run's current commit. On reset→re-push, old watchers stopped, new ones spawned.

### D27: One WorkflowRuntime per run, not per factory

**Context:** Codex found single WorkflowRuntime lock serializes all concurrent runs.
**Decision:** Shared immutable WorkflowDefinition, per-run WorkflowRuntime instances. Disposed on run completion.

---

## Status

Round 4 complete. 6 findings (5 high, 1 medium). All accepted. 27 decisions total (D1-D27). All corrections baked into spec.md and implementation prompts.
