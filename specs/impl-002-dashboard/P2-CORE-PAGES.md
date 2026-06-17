# P2: Core Pages

**Scope:** Rewrite ProjectList, ProjectDetail, SpecDetail, TaskDetail, AgentList with shadcn
**Package:** `packages/dashboard`
**Depends on:** P1 (shadcn foundation)
**Deliverable:** All non-run pages render with shadcn components

---

## Required Reading

- `specs/impl-002-dashboard/spec.md` §File inventory
- Current pages to port (read each before rewriting):
  - `src/pages/ProjectList.tsx` (142 lines — landing page with operational summary)
  - `src/pages/ProjectDetail.tsx` (118 lines)
  - `src/pages/SpecDetail.tsx` (120 lines — includes TaskDAG)
  - `src/pages/TaskDetail.tsx` (160 lines)
  - `src/pages/AgentList.tsx` (78 lines)
- `src/api/hooks.ts` (all available hooks)
- `src/api/client.ts` (all API types)
- `src/lib/utils.ts` (formatCost, formatDuration, timeAgo, formatTime)

## Tasks

### 1. ProjectList (landing page)

Straight port of the current landing page to shadcn — same functionality:
- Summary bar: active runs, needs-attention count, total cost (already exists)
- Active/stalled/recent run rows with stage badges (already exists)
- Project cards grid (responsive: 1/2/3 cols) (already exists)

Use shadcn Card, Badge. Use existing `useAllRuns()` hook.
Do NOT add enriched triage rows (project/task names, failure reasons) — that's impl-005.

### 2. ProjectDetail

Port spec list, agent assignments, project metadata.
Add breadcrumbs: `Projects > {project.name}`

Use shadcn Card for specs (clickable), Table for agent assignments.

### 3. SpecDetail

Port task DAG visualization and task list.
Add breadcrumbs: `Projects > {project} > {spec}`

Keep the SVG TaskDAG component — just restyle the wrapper.
Use shadcn Table for task status list alongside the DAG.

### 4. TaskDetail

Port task prompt, verification checklist, run history.
Add breadcrumbs: `Projects > {project} > {spec} > {task}`

Show prompt in a code block. Verification as a checklist.
Runs as a list with stage badges, clickable to run detail.

### 5. AgentList

Port agent table with responsive card fallback on mobile.
Use shadcn Table on desktop, Card stack on mobile.

## Verification

- [ ] All 5 pages render correctly
- [ ] Breadcrumbs present on all detail pages
- [ ] Landing page shows active runs and operational summary
- [ ] Mobile: pages render correctly at 390px
- [ ] All clickable elements are keyboard-accessible
- [ ] No Mantine imports in any of these files
