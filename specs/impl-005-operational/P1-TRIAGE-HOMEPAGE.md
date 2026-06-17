# P1: Triage Homepage

**Scope:** Rich homepage rows with full context — project, task, agent, failure reason
**Package:** `packages/dashboard`, `packages/api`
**Depends on:** None (but assumes shadcn from impl-002)

---

## Required Reading

- `src/pages/ProjectList.tsx` — current homepage
- `packages/api/src/routes/runs.ts` — GET /api/runs endpoint
- `packages/core/src/repos/run.ts` — listAll() method

## Problem

Current homepage run rows show: stage badge + run ID + age + tokens.
Missing: project name, spec name, task name, agent name, failure reason.

## Tasks

### 1. Enrich GET /api/runs response

Either:
- Add JOIN queries to include task.name, spec.name, project.name, agent.name in the response
- Or add a new `GET /api/runs/enriched` endpoint that does the joins

The enriched response should include:
```typescript
{
  ...run,
  taskName: string,
  specName: string,
  projectName: string,
  agentName: string,
}
```

### 2. Redesign homepage run rows

Each row shows:
- Stage badge (colored)
- Task name (primary text)
- Project > Spec breadcrumb (dimmed)
- Agent name + model badge
- Failure reason (for failed/stalled: one-line cause)
- Retry count (if > 0: "2nd attempt")
- Time since last activity
- Cost

### 3. Sections

- **Active**: live runs sorted by last activity
- **Needs Attention**: failed + stalled, sorted by urgency (stalled first, then failed)
- **Recently Completed**: last 10 done runs
- **Summary bar**: active count, attention count, total cost today

## Verification

- [ ] Each run row shows task/project/agent names
- [ ] Failed runs show failure reason inline
- [ ] Retry count shown for retried tasks
- [ ] Clicking a row navigates to run detail
