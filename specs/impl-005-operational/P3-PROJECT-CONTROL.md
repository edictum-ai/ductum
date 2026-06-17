# P3: Project Control Panel

**Scope:** Transform project page into operational view
**Package:** `packages/dashboard`, `packages/api`
**Depends on:** P1 (reuses triage row components)

---

## Required Reading

- `src/pages/ProjectDetail.tsx` — current project page
- `packages/api/src/routes/` — available endpoints

## Tasks

### 1. Add project runs endpoint

`GET /api/projects/:id/runs` — returns all runs for tasks in specs belonging to this project.
Include enriched fields (task name, spec name, agent name).

### 2. Redesign project page sections

| Section | Content |
|---------|---------|
| **Active Runs** | Currently running agents (reuse triage row component) |
| **Needs Attention** | Failed/stalled tasks |
| **Queued** | Ready tasks waiting for dispatch |
| **Recently Completed** | Last 10 done runs with cost |
| **Spend** | Total cost across all runs |
| **Agents** | Assigned agents with status (busy/idle) |
| **Specs** | List with status badges (below operational sections) |

### 3. Agent status

For each assigned agent, show:
- Name + model
- Current status: "working on {task}" or "idle"
- Total spend in this project

## Verification

- [ ] Project page shows active runs
- [ ] Shows failed/stalled alerts
- [ ] Shows queued tasks
- [ ] Shows total project spend
- [ ] Shows agent status (busy/idle)
