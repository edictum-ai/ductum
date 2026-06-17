---
date: 2026-05-01
status: implemented (2026-05-01)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 027, 109, 118
---

# Decision 121: Orphaned-session reattach + explicit-reason fallback

## Context

`activeSessions` is an in-memory `Map<RunId, ActiveDispatchSession>`
on the `DispatcherBase`. Every `pnpm serve` restart wipes it. We hit
that 3× on 2026-04-30: each recovery required a manual
`end-session`, a worktree rebase, a re-verify, and a re-approve. The
runs themselves were not lost — `session_run_mapping` survives in
SQLite — but the dispatcher had no path from "harness session id on
disk" back to "live conversation".

Our two productive harnesses sit on opposite sides of the resume
question:

- `claude-agent-sdk` runs the conversation in-process via the
  `query()` async iterator. The iterator dies with the parent
  process; the SDK does have a session log, but resuming a closed
  iterator from a session id requires re-feeding the prior turns and
  the SDK does not expose a stable contract for that today.
- `codex-app-server` spawns a `codex app-server` child via stdio.
  The child dies with the parent. Codex does have a `thread/start`
  RPC keyed on a thread id, so a resume hook is theoretically
  buildable, but we have not validated it across releases.

Both adapters today **cannot** survive a server restart. The slop
review explicitly demanded that the fallback path — mark the run
stalled with an explicit reason — exist whenever reattach is
unavailable.

## Decision

**The dispatcher reconciles orphaned sessions on startup. The
contract is "try to reattach, fail explicit on miss":**

1. `HarnessAdapter.tryReattach?(ctx)` is an optional method on the
   adapter interface. Returns a fresh `HarnessSession` bound to the
   pre-existing harness session id, or `null` to signal "cannot
   reattach."
2. On dispatcher startup (`reconcileOrphanedSessions()`), the
   reconciler walks every active (non-terminal) run, checks for an
   in-memory binding (already live from a prior call — short-circuit),
   then:
   - If the run has no `session_run_mapping`, do nothing
     (`noMapping` bucket — the run will be picked up on the next
     dispatch cycle if the task is `ready`).
   - If the mapping's `harnessSessionId` is missing or the adapter
     is no longer registered, mark stalled with the explicit reason.
   - If the adapter does not implement `tryReattach`, mark stalled.
   - Otherwise call `adapter.tryReattach(ctx)`; on `null` mark
     stalled, on success register in `activeSessions` and chain
     `waitForCompletion` into `handleSessionEnd` so the
     post-completion pipeline (verify → review → ship) routes
     normally.
3. The explicit failure reason is the constant
   `harness session not reattachable across server restart`. It is
   exported as `ORPHANED_REATTACH_FAILURE_REASON` so log greps,
   tests, and dashboard cards can pin to a stable string.
4. The stalled run keeps its worktree. The operator decides whether
   to retry, close, or extend the budget.

`D27` (one WorkflowRuntime per run) holds: each reattached run gets
its own MCP server (rebuilt by the dispatcher), and the per-run
workflow runtime is loaded lazily by the same path the live spawn
uses.

## Slop-review attack: "relies on harness state we cannot serialize"

The slop review demanded the fallback exist; D121 ships the fallback
as the *primary* behavior on day one. Today, `tryReattach` is
optional and unimplemented across all four built-in harnesses
(`claude-agent-sdk`, `codex-app-server`, `codex-sdk`, `copilot-sdk`).
Every orphaned run hits the explicit-reason path. The architecture
is in place so a single harness can add a real reattach
implementation later (e.g. codex thread resume) without changing the
dispatcher.

## Why not always reattach in-process

The simplest path — just keep the parent process alive — would
sidestep this entirely. We picked stalled+explicit because:

- The operational reality is that `pnpm serve` will restart on every
  source change in dev, every container redeploy in prod, every
  laptop sleep cycle. A single dropped run per restart is the bug
  we're paying for; the fix has to assume restart is constant.
- Hiding orphans behind a silent retry made recovery hard to debug.
  The explicit reason puts the failure on the operator's screen
  immediately.

## Surfaces shipped

- `packages/core/src/dispatcher-support.ts` — adds `ReattachContext`
  type and `tryReattach?` to the `HarnessAdapter` interface.
- `packages/harness/src/types.ts` — same `HarnessAdapter` extension
  on the harness-side type surface.
- `packages/core/src/dispatcher-reconcile.ts` (NEW) — pure-function
  reconciler keyed on `OrphanReconcileDeps`. Returns
  `OrphanReconcileSummary` so callers (and tests) see exactly what
  happened.
- `packages/core/src/dispatcher-session.ts` — adds the public
  `reconcileOrphanedSessions()` method on `DispatcherSession`.
- `packages/core/src/index.ts` — re-exports the failure reason
  constant and the summary type.
- `packages/api/src/index.ts` — calls
  `dispatcher.reconcileOrphanedSessions()` after harness adapters
  load and before `dispatcher.start()` so the polling loop only sees
  consistent in-memory state.
- `packages/core/src/tests/dispatcher-reconcile.test.ts` — pure-fn
  tests for every branch (live, no-mapping, no-adapter, no-session-id,
  no-tryReattach, success, error).

## Future work

- Wire a real `tryReattach` for `codex-app-server` once we validate
  the codex thread resume RPC across releases. The reconciler will
  pick that up automatically.
- A reattached `claude-agent-sdk` session needs full conversation
  replay. Defer until the SDK exposes a non-experimental resume API.

## Consequences

- The factory no longer silently orphans live runs across `pnpm
  serve` restarts.
- The operator sees the same explicit failure reason every time, so
  the recovery flow is predictable: `ductum retry <runId>` (which
  re-dispatches with a fresh worktree) or `ductum run-close` to
  shelve.
- The architecture pin keeps room for incremental harness reattach
  without revisiting the reconciler design.
