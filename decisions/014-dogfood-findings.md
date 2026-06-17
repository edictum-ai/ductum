# Dogfood Findings — First Real Use (2026-04-04)

**Context:** First attempt to use Ductum to orchestrate a real project (faceless).
Arnold + Claude working together as operator. Every issue encountered during
first-run setup and dispatch attempt.

---

## Onboarding / DX

### F1 — Critical: No documented getting-started guide
There is no README, no quickstart, no "how to use this." The operator has to
read implementation specs to figure out what commands exist. A new user would
have no idea what to do.

### F2 — High: Too many steps to start
Before `pnpm serve` existed, the DX was: build all packages, start API in one
terminal, start dashboard in another, run seed script, then manually create
everything via CLI. Even with `pnpm serve`, the operator still needs to
understand the config file format, seed data, and API structure.

### F3 — High: No error messages when things fail silently
The dispatcher swallowed all errors. When the Claude Agent SDK failed to connect
(missing API key), there was zero output. The run sat at `accepted` with no
session and no indication of why. Fixed by adding `[dispatcher]` logging, but
this should have been there from the start.

### F4 — Medium: No way to retry a stalled/failed dispatch
When a run stalls (session fails to connect), there's no `ductum retry <run-id>`
or automatic retry. The task stays `active` with a stalled run, and the
dispatcher skips it because it's not `ready`. The operator has to manually:
1. Fail the stalled run
2. Re-evaluate the DAG
3. Hope the task becomes ready again
This is broken — there should be a single retry command.

### F5 — Medium: CLI `accept` doesn't resolve agent automatically
`ductum accept <task-id>` fails with "no assigned agent" for unassigned tasks.
The MCP server (P5) works around this by fetching the task and using
assignedAgentId, but the CLI doesn't. Operator has to pass agent ID manually
or use raw API calls.

---

## API Gaps

### F6 — High: No `GET /api/runs` endpoint (list all runs)
The ApprovalQueue and CLI status commands need to list runs across all tasks.
Currently you can only list runs per-task (`GET /api/tasks/:id/runs`). The
dashboard works around this with a graceful fallback returning [].

### F7 — High: No task status update endpoint
There's no `PUT /api/tasks/:id/status`. When a run stalls and you need to
reset the task to `ready`, there's no API for it. The DAG evaluator handles
status transitions internally but there's no manual override.

### F8 — Medium: `POST /api/runs/:id/fail` with recoverable=true resets to implementing, not failed
The fail endpoint doesn't mark the run as `failed` — it resets to `implementing`
if recoverable. This is by design (D20), but it means there's no way to
actually terminate a bad run and free up the task for re-dispatch.

### F9 — Medium: `resolve-latch` not in original API spec
Had to add `POST /api/runs/:id/resolve-latch` during dogfood because watchers
resolve latches internally but there's no way to do it manually for testing
or manual operation.

### F10 — Medium: `wait --timeout` is a no-op
CLI and MCP forward timeout, API ignores it. Documented in P5 and P6 findings
but never fixed.

---

## Dispatcher Issues

### F11 — Critical: Dispatcher doesn't log spawn failures
The `catch` in session.waitForCompletion swallows errors silently. The `tick()`
method also had no error logging. Fixed by adding console.log/error, but this
needs proper structured logging (not console.log).

### F12 — High: Dispatcher doesn't retry failed dispatches
If spawn() fails (bad API key, SDK error, network), the run goes to stalled
and stays there forever. No retry logic, no exponential backoff, no alerting.

### F13 — High: No way to see dispatcher status from dashboard
The dispatcher has a `status()` method but no API endpoint exposes it. The
operator can't see if the dispatcher is running, how many active sessions
exist, or what the last cycle result was.

### F14 — Medium: Dispatcher creates duplicate runs on task
When we manually created a run via `POST /api/runs/accept` while the task was
already active, it created a second run. The dispatcher also tried to dispatch
it. No guard against "task already has an active non-stalled run."

---

## Config / Environment

### F15 — High: ANTHROPIC_API_KEY not passed through to API process
`pnpm serve` spawns the API as a child process. If the key is set in the
operator's shell but not exported, or set after `pnpm serve` starts, the
API process doesn't have it. No validation or error message.

### F16 — Medium: Port conflict on restart
Restarting `pnpm serve` fails with EADDRINUSE because the old process isn't
killed. The serve script should kill existing processes on the port before
starting, or handle the error gracefully.

### F17 — Medium: Stale ductum.db causes SQLITE_IOERR
If the DB file is corrupted (e.g., process killed during write), the API
crashes with "disk I/O error." No recovery guidance, no auto-cleanup.

---

## Dashboard

### F18 — Medium: Dashboard shows stale data without SSE
If SSE connection drops, the dashboard shows stale state until manual refresh.
No reconnection logic visible.

### F19 — Low: Build artifacts (.js/.js.map) were committed
42 JavaScript build artifacts were committed to git in the dashboard package.
Cleaned up, but .gitignore should have caught this.

---

## Schema / Data Model

### F20 — Medium: session_run_mapping allows multiple rows per run_id
Noted in P10 findings. On session resume, old mapping isn't cleaned up.
getByRunId() returns ambiguous results.

### F21 — Medium: No required_role on existing tasks
Tasks created before the D30 migration have no required_role. The fallback
(null = builder) works, but it's not explicitly set.

---

## Dispatch Debugging Findings (evening session)

### F22 — Critical: Agent SDK needs bypassPermissions
Default permission mode requires human approval for each tool call. Since
Ductum runs headless (no human in the tool-call loop), the agent exits
after one turn. Fixed: `permissionMode: 'bypassPermissions'` +
`allowDangerouslySkipPermissions: true` + `maxTurns: 200`.

### F23 — Critical: Framework tools blocked by workflow enforcement
The harness was checking ALL tools against the workflow stage's tool list.
MCP tools (mcp__ductum__*), Agent, ToolSearch, TodoWrite, Skill, etc. were
blocked because they're not in the workflow YAML. Fixed: only enforce on
work tools (Read, Write, Edit, Bash, Glob, Grep, NotebookEdit). Everything
else passes through.

### F24 — Critical: Dispatcher missing createMcpServer factory
The dispatcher config needs `createMcpServer` to create per-session MCP
servers, but the API entrypoint didn't inject it. Fixed: dynamic import of
@ductum/mcp in API index.ts.

### F25 — High: Agent SDK model name format
`claude-opus-4.6` (marketing name with dot) is not valid. SDK needs
`claude-opus-4-6` (API ID with hyphens). No validation on agent
registration. Changed to `claude-sonnet-4-6` for testing.

### F26 — High: serve.mjs swallowed API stdout
API process stdout was piped but never read. All console.log from
dispatcher/harness was invisible to the operator. Fixed: added
stdout.on('data') handler.

### F27 — High: 'accepted' stage is a dead end
Agents don't reliably call gate_check to advance from the read-only
accepted stage. They try Write/Bash immediately, get blocked, and give
up or exit. Fixed: dispatcher creates runs in 'implementing' directly.

### F28 — Medium: Agent doesn't follow MCP workflow
System prompt tells agent to use ductum_gate_check/ductum_evidence/
ductum_complete, but the agent mostly ignores it and just does the work.
The MCP tools are available but the agent doesn't use them unless
enforcement forces it. This is the fundamental gap: advisory prompts
don't work — which is exactly the problem Ductum was built to solve.

### F29 — Medium: @edictum/core workflow not actually used for enforcement
The coding-guard.yaml workflow is loaded but the sentinel entry gates
mean evaluate() only checks tool permissions. The real workflow enforcement
(read→branch→implement→verify→review→push→CI→done) from the edictum
coding-guard spec isn't wired. The current implementation is just a
tool allowlist per stage, not a real workflow.

---

## Priority for next session

1. **Wire real edictum workflow enforcement** — the 10-stage coding-guard
   from edictum, not the simplified 6-stage stub
2. **Multi-task DAG end-to-end** — dispatch chains through a full spec
3. **`ductum spec import`** — load a spec directory as tasks
4. **Retry logic** for stalled dispatches
5. **README / quickstart** documentation
6. **Structured logging** (not console.log)
7. **Missing API endpoints** (list runs, task status update)
8. **Env var validation** on startup
