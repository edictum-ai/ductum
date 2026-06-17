# P2: Run Failure Summary + Retry Lineage

**Scope:** Failure cause chain, last action, previous attempts on run detail page
**Package:** `packages/dashboard`, `packages/api`
**Depends on:** None

---

## Required Reading

- `src/pages/RunDetail.tsx` — current run page
- `packages/api/src/routes/runs.ts` — run endpoints
- `packages/core/src/repos/run.ts` — run queries

## Tasks

### 1. Add run lineage endpoint

`GET /api/tasks/:taskId/runs` already exists and returns all runs for a task.
Use this on the RunDetail page to show sibling attempts.

### 2. Build failure summary component

For failed/stalled runs, render a pinned card at the top:

```
FAILURE SUMMARY
━━━━━━━━━━━━━━━
Cause: Heartbeat timeout (no activity for 120s)
Last action: Write packages/core/src/enforce.ts (10:05)
Attempts: 3 total (1 stalled, 1 failed, 1 done)
Run #1: stalled (heartbeat timeout) — 10:00
Run #2: failed (retried by operator) — 10:15   ← you are here
Run #3: done ($3.11) — 10:30
```

### 3. Completion summary for done runs

For done runs, show the agent's completion summary prominently at the top.

Source priority (check in order):
1. `run.completionSummary` field (added by impl-004 P2, DB column: `completion_summary`)
2. Last activity entry with `kind: 'result'` (the session-ended message)
3. Last activity entry with `kind: 'text'` (the agent's final text before completing)

Note: the field is `completionSummary` in the TypeScript Run type (camelCase) and
`completion_summary` in the SQLite column (snake_case). The repo maps between them.

Make it collapsible if long (>500 chars).

### 4. Last successful action

Parse the activity feed to find the last tool_call entry and show it in the meta bar:
"Last action: Write enforce.ts — 3m ago"

## Verification

- [ ] Failed runs show cause chain card at top
- [ ] Previous attempts listed with links
- [ ] Done runs show completion summary
- [ ] Last action shown in meta bar for active runs
