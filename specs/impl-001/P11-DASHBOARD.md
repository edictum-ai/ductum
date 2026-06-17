# P11: Dashboard

**Scope:** React dashboard with project/spec/task/run views, DAG visualization, SSE live updates, approval actions
**Package:** `packages/dashboard`
**Depends on:** P4 (REST API + SSE)
**Deliverable:** Working dashboard at localhost:5173 showing full factory state
**Verification:** `cd packages/dashboard && pnpm build` + visual verification against running API

---

## Required Reading

- `specs/impl-001/spec.md` §13 (Dashboard — views, SSE, approvals)
- `CONTEXT.md` §The pain ("No visibility without asking")
- `VISION.md` §Factory ("One factory per human operator")
- `ARCHITECTURE.md` §Run state machine (the diagram the dashboard must render)
- `ARCHITECTURE.md` §Merge modes (auto-merge vs human-merge → approval UI)

## Tasks

### 1. Scaffold dashboard package

- `packages/dashboard/package.json` with dependencies: `react`, `react-dom`, `react-router-dom`, `tailwindcss`, `vite`, `@tanstack/react-query`
- Initialize with `pnpm create vite` (React + TypeScript template)
- Install shadcn/ui components: `button`, `card`, `badge`, `table`, `tabs`, `dialog`, `toast`
- Configure Tailwind CSS
- Proxy `/api` to Ductum API in vite config

### 2. API client + React Query hooks

File: `packages/dashboard/src/api/client.ts`

Typed fetch wrapper for all REST API endpoints:

```typescript
const API_BASE = '/api'

export const api = {
  // Projects
  listProjects: () => get<Project[]>('/projects'),
  getProject: (id: string) => get<Project>(`/projects/${id}`),

  // Specs
  listSpecs: (projectId: string) => get<Spec[]>(`/projects/${projectId}/specs`),
  getSpec: (id: string) => get<Spec>(`/specs/${id}`),

  // Tasks
  listTasks: (specId: string) => get<Task[]>(`/specs/${specId}/tasks`),
  getTask: (id: string) => get<Task>(`/tasks/${id}`),
  getTaskDeps: (id: string) => get<TaskDependency[]>(`/tasks/${id}/dependencies`),

  // Runs
  listRuns: (taskId: string) => get<Run[]>(`/tasks/${taskId}/runs`),
  getRun: (id: string) => get<Run>(`/runs/${id}`),
  getRunEvidence: (id: string) => get<Evidence[]>(`/runs/${id}/evidence`),
  getRunGateEvals: (id: string) => get<GateEvaluation[]>(`/runs/${id}/gate-evaluations`),
  getRunHistory: (id: string) => get<RunStageTransition[]>(`/runs/${id}/history`),

  // Agents
  listAgents: () => get<Agent[]>('/agents'),

  // Decisions
  listDecisions: (params: Record<string, string>) => get<Decision[]>('/decisions', params),

  // Approvals
  approveRun: (runId: string) => post(`/runs/${runId}/approve`),
  rejectRun: (runId: string, reason: string) => post(`/runs/${runId}/reject`, { reason }),

  // Factory
  getFactory: () => get<Factory>('/factory'),
}
```

React Query hooks in `packages/dashboard/src/api/hooks.ts`:

```typescript
export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: api.listProjects })
}
export function useRun(id: string) {
  return useQuery({ queryKey: ['runs', id], queryFn: () => api.getRun(id) })
}
// ... etc
```

### 3. SSE hook

File: `packages/dashboard/src/api/sse.ts`

```typescript
export function useDuctumSSE(filters?: { runId?: string; taskId?: string }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const params = new URLSearchParams()
    if (filters?.runId) params.set('runId', filters.runId)
    if (filters?.taskId) params.set('taskId', filters.taskId)

    const source = new EventSource(`/api/events/stream?${params}`)

    source.addEventListener('run.stage_changed', (e) => {
      const data = JSON.parse(e.data)
      queryClient.invalidateQueries({ queryKey: ['runs', data.runId] })
    })

    source.addEventListener('task.status_changed', (e) => {
      const data = JSON.parse(e.data)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    })

    source.addEventListener('run.evidence_attached', (e) => {
      const data = JSON.parse(e.data)
      queryClient.invalidateQueries({ queryKey: ['runs', data.runId, 'evidence'] })
    })

    source.addEventListener('approval.requested', () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
    })

    return () => source.close()
  }, [filters?.runId, filters?.taskId])
}
```

### 4. Layout + routing

File: `packages/dashboard/src/App.tsx`

```
/ .................... ProjectList (home)
/projects/:id ........ ProjectDetail
/specs/:id ........... SpecDetail (with task DAG)
/tasks/:id ........... TaskDetail (with runs)
/runs/:id ............ RunDetail (state machine view)
/agents .............. AgentList
/approvals ........... ApprovalQueue
```

Sidebar navigation with: Projects, Agents, Approvals. Top bar with factory name and status indicators (active runs, stalled runs).

### 5. Project list view

File: `packages/dashboard/src/pages/ProjectList.tsx`

- Card grid of projects
- Each card: project name, repo count, spec count, active run count
- Status badge: idle (gray), active (blue), has-stalled (red)
- Click -> ProjectDetail

### 6. Project detail view

File: `packages/dashboard/src/pages/ProjectDetail.tsx`

- Project info: name, repos, config
- Assigned agents table: agent name, role, model, harness
- Specs list: name, status badge, task progress (3/5 done)
- Click spec -> SpecDetail

### 7. Spec detail with task DAG visualization

File: `packages/dashboard/src/pages/SpecDetail.tsx`

- Spec info: name, status, document preview
- Task DAG visualization:
  - Render tasks as nodes in a directed graph
  - Edges from dependency to dependent
  - Node color by status: gray (blocked), white (ready), blue (active), green (done), red (failed)
  - Click node -> TaskDetail

Use a simple layout algorithm: topological sort into layers, render left-to-right.

File: `packages/dashboard/src/components/TaskDAG.tsx`

```typescript
// Input: tasks with dependencies
// Output: SVG or CSS grid showing DAG with status colors
function TaskDAG({ tasks, dependencies }: { tasks: Task[]; dependencies: TaskDependency[] }) {
  // 1. Topological sort into layers
  // 2. Assign x-position by layer, y-position by index within layer
  // 3. Draw nodes as rounded rects with status color
  // 4. Draw edges as lines/arrows between nodes
  // 5. Each node is clickable -> navigates to task detail
}
```

### 8. Task detail view

File: `packages/dashboard/src/pages/TaskDetail.tsx`

- Task info: name, assigned agent, repos, status
- Prompt preview (collapsible)
- Verification checklist
- Runs table: run ID, agent, stage, created, duration, cost
- Click run -> RunDetail

### 9. Run detail view (primary operational screen)

File: `packages/dashboard/src/pages/RunDetail.tsx`

This is the most important view. Shows the full state machine for a single run.

**Stage strip (horizontal):**
```
[accepted] -> [implementing] -> [pre-push-review] -> [pushing] -> [CI | review] -> [merging] -> [done]
```
- Completed stages: green with checkmark
- Current stage: blue with pulse animation
- Failed/blocked stages: red
- Future stages: gray

**Run info panel:**
- Agent name, model, harness
- Session ID
- Git artifacts: branch, commit, PR link
- Cost: tokens in/out, USD
- Duration: started -> current
- Last heartbeat (with "ago" indicator)

**Parallel latch panel (visible when in waiting state):**
- CI status: pending/pass/fail with check details
- Review status: pending/pass/fail with reviewer name

**Evidence timeline:**
- Chronological list of evidence attached to the run
- Each entry: timestamp, type badge, payload preview
- Expandable for full payload

**Stage transition history:**
- Chronological list of all stage transitions
- Each entry: timestamp, from -> to, reason

**Gate evaluation log:**
- Chronological list of gate evaluations
- Each entry: timestamp, type (authorize_tool/gate_check), target, result, reason
- Useful for debugging "why was my tool call blocked?"

**Decision trail:**
- Decisions attached to this run
- Each entry: decision text, context, alternatives, decided by

**Approval panel (visible when in waiting-for-approval):**
- PR summary and link
- Evidence summary
- Approve / Reject buttons
- Reject requires reason

Wire up SSE: `useDuctumSSE({ runId })` for live updates.

### 10. Agent list view

File: `packages/dashboard/src/pages/AgentList.tsx`

- Table: name, model, harness, capabilities
- Current status: idle, active (which task), stalled
- Click -> shows all runs for this agent

### 11. Approval queue

File: `packages/dashboard/src/pages/ApprovalQueue.tsx`

- List of runs in `waiting-for-approval` stage
- Each entry: run summary, task name, PR link, time waiting
- Approve / Reject buttons
- Empty state: "No pending approvals"

### 12. Status indicators in sidebar

File: `packages/dashboard/src/components/Sidebar.tsx`

- Active runs count (blue badge)
- Stalled runs count (red badge, if > 0)
- Pending approvals count (yellow badge, if > 0)

These update via SSE.

### 13. Tests

File: `packages/dashboard/src/tests/` (component tests with vitest + @testing-library/react)

- ProjectList renders projects
- SpecDetail renders task DAG with correct colors
- RunDetail renders stage strip with correct states
- Approval buttons call correct API endpoints
- SSE hook invalidates queries on events

## Verification Checklist

- [ ] `pnpm build` in packages/dashboard — builds successfully
- [ ] Project list shows all projects with status
- [ ] Spec detail shows task DAG with correct dependency edges
- [ ] Task DAG nodes colored by status (ready/active/done/failed/blocked)
- [ ] Run detail shows full state machine visualization
- [ ] Stage strip shows correct states (completed/active/future)
- [ ] Parallel latch panel shows CI and review status independently
- [ ] Evidence timeline shows all attached evidence
- [ ] Stage history shows all transitions with reasons
- [ ] Gate evaluation log shows authorize_tool and gate_check results
- [ ] Approval panel shows approve/reject for waiting-for-approval runs
- [ ] SSE updates refresh views in real-time
- [ ] Sidebar badges update with active/stalled/approval counts
- [ ] Dashboard works against running Ductum API with sample data
