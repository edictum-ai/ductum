# P3: RunDetail Page

**Scope:** Rewrite the most complex page — run detail with activity feed, evidence, gates, transitions
**Package:** `packages/dashboard`
**Depends on:** P1 (shadcn foundation)
**Deliverable:** RunDetail page with all tabs, retry button, live updates

---

## Required Reading

- `specs/impl-002-dashboard/spec.md` §Acceptance Criteria
- `src/pages/RunDetail.tsx` (430 lines — the current implementation)
- `src/api/hooks.ts` — useRun, useRunActivity, useRunEvidence, useRunGateEvals, etc.
- `src/api/sse.ts` — SSE subscription for live updates

## Design

The RunDetail page has these sections:
1. **Header**: agent name, run ID, stage badge, retry button (for failed/stalled)
2. **Meta bar**: agent (name + model), tokens, cost, duration, heartbeat, git artifacts
3. **Tabs**: Activity (default), Evidence, Transitions, Gates, Decisions, Updates

### Activity tab (most important)
- Groups consecutive tool calls together
- Text messages shown with subtle separators
- Tool calls show: timestamp, tool name (colored), parsed args (file paths shortened)
- Summaries in teal
- Result in violet
- Auto-refreshes via `refetchInterval: 3000` on the hook
- MCP tool calls (ductum_*) shown with dimmer color than work tools

### Evidence tab
- Format test evidence nicely: PASS/FAIL badge, test count, suite name, details
- Non-test evidence: formatted JSON

### Gates tab
- Summary line: "47 allowed, 6 blocked"
- Only show notable entries (blocked or with reasons)
- "X notable shown, Y routine hidden" indicator

### Transitions tab
- Table with from/to stage badges, reason (truncated with tooltip)

### Retry behavior
- Button visible on failed/stalled runs
- On click: POST /api/runs/:id/retry → navigate to task page

## Tasks

### 1. Port RunDetail shell

Header + meta bar + tab structure using shadcn Tabs, Badge, Button.
Wire all existing hooks (useRun, useAgents, useTask, useSpec, useProject for breadcrumbs).

### 2. Port Activity tab

Keep the existing groupActivity() and formatToolArg() logic.
Restyle with Tailwind classes instead of inline styles.
Use monospace font for the feed.

### 3. Port remaining tabs

Evidence, Transitions, Gates, Decisions, Updates.
Use shadcn Table for tabular data.
Format evidence payload based on type (test → structured, other → JSON).

### 4. Retry + approval actions

Retry button → POST /api/runs/:id/retry → navigate to /tasks/:taskId
Approve/Reject buttons for waiting-for-approval stage.

## Verification

- [ ] RunDetail renders for done, failed, stalled, implementing runs
- [ ] Activity tab shows grouped tool calls with parsed args
- [ ] Evidence tab formats test results (PASS/FAIL, counts)
- [ ] Gates tab shows summary + notable entries
- [ ] Retry button navigates to task page after success
- [ ] Breadcrumbs: Projects > project > spec > task > Run {id}
- [ ] SSE updates activity in real-time
- [ ] Mobile: page renders correctly at 390px
