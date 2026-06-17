# Ductum — Project Status

**Date:** 2026-04-04
**Phase:** Post-implementation, first dogfood complete

> Historical snapshot. This file captures the first dogfood status from
> April 4, 2026. For the current roadmap, use `specs/CURRENT.md` and decisions
> `053` through `057`. Do not treat the issue lists below as fully current.

## What Ductum Is

AI factory orchestration powered by Edictum. Models work as dependency graphs, dispatches agents automatically, enforces workflow stages via @edictum/core, surfaces real-time visibility via dashboard.

## What Was Built Today

35 commits. 6 packages. 14,331 LOC. 124 tests. 1 successful autonomous agent dispatch.

### Timeline

| Time | What |
|------|------|
| Morning | Wrote implementation spec + 11 prompts, Codex adversarial review (6 findings, D22-D27) |
| Midday | P1-P6 implemented by Codex (types, state machine, DAG, API, MCP, CLI) |
| Afternoon | P7-P11 (harness adapters, watchers, dispatcher, dashboard) |
| Evening | Dev story (ductum.yaml, serve script, seed), dogfood testing, first dispatch |

### Packages

| Package | LOC | Tests | Purpose |
|---------|-----|-------|---------|
| @ductum/core | 5,466 | 47 | Types, DB, state machine, DAG, enforcement, watchers, dispatcher |
| @ductum/api | 2,110 | 7 | Hono REST API + SSE event stream |
| @ductum/mcp | 1,074 | 11 | 12 MCP tools with per-session run binding |
| @ductum/cli | 1,999 | 10 | Admin + agent ops + status commands |
| @ductum/harness | 1,867 | 19 | Claude Agent SDK + OpenCode adapters |
| @ductum/dashboard | 1,815 | 30 | React dashboard (Mantine, Vite, React Query) |

### Design Decisions

32 decisions (D1-D31) across 4 rounds of adversarial review + implementation:

| Decision | Summary |
|----------|---------|
| D1-D9 | Founding design: local-first, TypeScript, MCP + CLI, agents merge PRs |
| D10-D14 | Round 1: enforcement is local via @edictum/core, harness is structural |
| D15-D18 | Round 2: stateless OpenCode plugin, parallel CI/review latches, fixing sub-state |
| D19-D21 | Round 3: authorize_tool vs gate_check split, no agent self-reset, session binding |
| D22-D27 | Round 4: MCP per-session binding, StorageBackend interface, runtime per-run |
| D28 | Real @edictum/core API: 4-method StorageBackend, setStage/reset, no recordResult |
| D29 | Sentinel entry gates to block auto-advance |
| D30 | required_role column for role-based task dispatch |
| D31 | 21 dogfood findings from first real use |

## What Works

### Core Lifecycle (verified end-to-end)
- Create factory, agents, projects via config file (ductum.yaml)
- Create specs and tasks via CLI/API
- DAG evaluation: ready/blocked/failed propagation, cycle detection
- Run state machine: accepted → implementing → pre-push-review → pushing → wait → merge → done
- Parallel latch resolution (CI + review)
- DAG cascade on completion (dependent tasks unblock)

### Automated Dispatch (verified with real agent)
- Dispatcher detects ready tasks, matches agents by role
- Claude Agent SDK session spawned with MCP server pre-bound
- Workflow enforcement: only work tools (Read/Write/Edit/Bash/Glob/Grep) checked against stage
- Agent works autonomously until task complete
- Cost and token tracking

### First Successful Dispatch
```
Project: faceless
Task: P1-scaffold (set up Python project from tech spec)
Agent: mimi (claude-sonnet-4-6)
Dispatch: automatic
Gate evaluations: 27 (all allowed)
Tokens: 8,997 out / 19 in
Cost: $0.72
Duration: ~3 minutes
Result: pyproject.toml, models.py (6 entities), db.py, states.py (14 statuses),
        config/channel.yaml, 3 test files, virtual environment
Stage: done
```

### Dashboard
- Project list, spec detail with task DAG, run detail with stage strip
- Evidence timeline, gate evaluation log, stage history
- Approval queue for human-merge gates
- SSE live updates

## What Doesn't Work Yet

### Multi-task DAG chaining
The dispatcher picks up one ready task and dispatches it. When it completes, the DAG cascades and newly unblocked tasks become ready. But the dispatcher hasn't been tested with a full multi-task spec running end-to-end — dispatch → complete → cascade → dispatch next.

### Push/PR/CI/Review flow
The full workflow (implement → push → wait for CI → wait for review → merge) hasn't been exercised with a real git push and CI run. All verification was manual via API calls.

### OpenCode harness
Only the Claude Agent SDK harness has been tested live. The OpenCode adapter exists but hasn't dispatched a real Codex or GLM session.

### Spec import
No `ductum spec import` command. Tasks must be created manually via API/CLI.

## Improvements Needed

### Critical (blocks real use)

| # | Issue | Details |
|---|-------|---------|
| 1 | **No README or getting-started guide** | New user has zero documentation on how to use Ductum |
| 2 | **Dispatcher errors are silent without stdout forwarding** | Fixed in serve.mjs, but the API process itself should have structured logging |
| 3 | **No retry for stalled dispatches** | If spawn fails, run stalls forever. No retry, no backoff, no alert |
| 4 | **Agent doesn't call MCP tools for workflow** | Agent completes work but doesn't call gate_check/evidence/complete. System prompt helps but isn't reliable. Need the coding-guard workflow from edictum to enforce this structurally |
| 5 | **No `ductum spec import`** | Can't load a spec directory (like impl-001/) as tasks with dependencies automatically |

### High (degrades experience)

| # | Issue | Details |
|---|-------|---------|
| 6 | **No `GET /api/runs` endpoint** | Can't list all runs across tasks. Dashboard approval queue needs this |
| 7 | **No task status update endpoint** | Can't manually reset a task from active to ready after a stalled run |
| 8 | **CLI `accept` doesn't resolve agent** | Fails on unassigned tasks — needs same auto-resolution as MCP |
| 9 | **No dispatcher status in dashboard** | Can't see if dispatcher is running, active sessions, last cycle |
| 10 | **Port conflict on restart** | EADDRINUSE — serve script should kill existing processes |
| 11 | **Token tracking shows 0 sometimes** | Usage data arrives after session completes but before token update |
| 12 | **session_run_mapping allows duplicates per run** | Ambiguous on resume |

### Medium (polish)

| # | Issue | Details |
|---|-------|---------|
| 13 | **wait --timeout is a no-op** | Forwarded but API ignores it |
| 14 | **Status commands use N+1 queries** | Client-side aggregation across projects/specs/tasks |
| 15 | **No env var validation on startup** | ANTHROPIC_API_KEY missing → silent failure |
| 16 | **Stale DB causes SQLITE_IOERR** | No auto-cleanup or recovery guidance |
| 17 | **Dashboard SSE reconnection** | No visible reconnect on connection drop |
| 18 | **Model name format confusion** | claude-opus-4.6 vs claude-opus-4-6 — no validation |
| 19 | **Plugin probe not tested live** | OpenCode plugin-health probe is designed but unverified |

### Future (next phase)

| # | Issue | Details |
|---|-------|---------|
| 20 | **Full coding-guard workflow** | 10-stage workflow from edictum (read→branch→baseline→implement→verify→review→docs→push→CI→done) |
| 21 | **Multi-task DAG end-to-end** | Dispatch chains automatically through a full spec |
| 22 | **Git integration** | Auto-create branches, push PRs, monitor CI via watchers |
| 23 | **Cost budgets and alerts** | Per-project cost limits, alerts on budget threshold |
| 24 | **`ductum run` manual dispatch** | Single command to dispatch one task to one agent |
| 25 | **Unified `ductum serve`** | Starts API + dashboard + dispatcher in one process (not child spawning) |
| 26 | **Structured logging** | Replace console.log with proper log levels, structured output |
| 27 | **Webhook support** | GitHub webhooks for CI/review instead of polling |

## How to Run Today

```bash
# Prerequisites
# - Node.js 22+
# - pnpm 10+
# - ANTHROPIC_API_KEY in environment

# 1. Build
cd /Users/acartagena/project/ductum
pnpm build

# 2. Edit config
# ductum.yaml — agents, projects, repos

# 3. Start
pnpm serve
# Opens API on :4100, dashboard on :5176

# 4. Create work
# Via CLI or API — create specs and tasks
# Dispatcher auto-dispatches to matched agents

# 5. Watch
# Dashboard at http://localhost:5176
# CLI: node packages/cli/dist/index.js status
```

## Architecture

```
ductum.yaml (config)
     |
     v
pnpm serve
     |
     +-- API server (:4100)
     |     +-- REST routes (CRUD + run management)
     |     +-- SSE event stream
     |     +-- Dispatcher (polls every 10s)
     |           +-- Matches ready tasks to agents
     |           +-- Spawns Claude/OpenCode sessions
     |           +-- Monitors heartbeats
     |
     +-- Dashboard (:5176)
           +-- Project/Spec/Task/Run views
           +-- Live SSE updates
           +-- Approval queue

Agents:
  Claude (mimi) → Agent SDK → PreToolUse hook → authorize_tool
  Codex/GLM → OpenCode → Plugin → authorize_tool
```

## Files

```
ductum/
  ductum.yaml              # Factory config (agents, projects)
  workflows/
    coding-guard.yaml      # Edictum workflow definition
  packages/
    core/                  # Types, DB, state machine, DAG, enforcement
    api/                   # Hono REST API + SSE
    mcp/                   # 12 MCP tools
    cli/                   # Admin + agent ops
    harness/               # Claude + OpenCode adapters
    dashboard/             # React dashboard
  scripts/
    serve.mjs              # One-command startup
    seed.mjs               # Sample data bootstrapper
  specs/
    impl-001/              # Implementation spec + 11 prompts
  decisions/               # 32 design decisions (D1-D31)
```
