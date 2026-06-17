# impl-002: Dashboard Rewrite — shadcn/ui + Tailwind CSS

**Status:** Draft
**Priority:** High — current Mantine UI is "raw" and lacks design ownership
**Depends on:** impl-009 (Edictum governance — run stages change from Ductum stages
to Edictum workflow stages: read-analyze, create-branch, implement, etc.)

**Important:** After impl-009, Run.stage is a workflow stage (read-analyze,
implement, local-verify, push-pr, etc.), not a Ductum stage (implementing,
pre-push-review, waiting-for-ci, etc.). The dashboard must show workflow
stages. Terminal states (failed, stalled) are in Run.terminalState.

## Problem

The dashboard was built on Mantine 9 during the initial sprint. It works functionally but:
- Looks generic ("raw Mantine") with no intentional design system
- The original P11 spec called for shadcn + Tailwind — it was swapped during implementation
- Mantine's component API doesn't support fine-grained styling without fighting the framework
- No CRUD operations — the dashboard is read-only
- Mobile is broken (fixed 240px sidebar, no responsive breakpoints)

## Goals

1. Port from Mantine to shadcn/ui + Tailwind CSS
2. Keep all existing functionality (views, SSE, React Query hooks, API client)
3. Add CRUD forms (create spec, add task, register agent, import YAML spec)
4. Responsive layout with mobile-first breakpoints
5. Accessible (keyboard nav, WCAG AA contrast, semantic HTML)

## Non-Goals

- No new API endpoints (use what exists)
- No redesign of the data model or API
- No new pages beyond what exists
- **No new operational features** — impl-002 is a straight port: same functionality,
  new components. Enriched triage rows, failure summaries, command palette, and
  project control panels belong in impl-005. The landing page ports the existing
  run-list view as-is. The approval queue ports the existing card layout as-is.

## Architecture

### What stays the same
- React 19, Vite, React Router (BrowserRouter)
- @tanstack/react-query for data fetching
- SSE subscription via EventSource (`/api/events/stream`)
- API client (`src/api/client.ts`) — unchanged
- React Query hooks (`src/api/hooks.ts`) — unchanged
- Utility functions (`src/lib/utils.ts`) — unchanged

### What changes
- Remove: `@mantine/core`, `@mantine/hooks` (1,871 LOC across 9 pages + 3 components)
- Add: `tailwindcss`, `@tailwindcss/vite`, shadcn/ui CLI-generated components
- Every `.tsx` file in `src/pages/` and `src/components/` gets rewritten
- Tests updated to remove Mantine render wrappers

### File inventory (current → new)

| Current file | Lines | Action |
|-------------|-------|--------|
| src/components/Layout.tsx | 32 | Rewrite — responsive shell |
| src/components/Sidebar.tsx | 77 | Rewrite — shadcn NavigationMenu + mobile Sheet |
| src/components/TaskDAG.tsx | 190 | Keep SVG logic, restyle wrapper |
| src/pages/ProjectList.tsx | 142 | Rewrite — shadcn Card grid |
| src/pages/ProjectDetail.tsx | 118 | Rewrite |
| src/pages/SpecDetail.tsx | 120 | Rewrite |
| src/pages/TaskDetail.tsx | 160 | Rewrite |
| src/pages/RunDetail.tsx | 430 | Rewrite — most complex page |
| src/pages/AgentList.tsx | 78 | Rewrite — shadcn Table |
| src/pages/ApprovalQueue.tsx | 120 | Rewrite |
| src/api/client.ts | ~130 | Unchanged |
| src/api/hooks.ts | ~115 | Unchanged |
| src/api/sse.ts | ~55 | Unchanged |
| src/lib/utils.ts | ~40 | Unchanged |
| src/index.css | ~15 | Replace with Tailwind base |

### CRUD forms needed

| Form | API endpoint | Fields |
|------|-------------|--------|
| Create Spec | POST /api/projects/:id/specs | name, status, document |
| Create Task | POST /api/specs/:id/tasks | name, prompt, repos[], verification[], requiredRole, dependencies |
| Register Agent | POST /api/agents | name, model, harness, capabilities[] |
| Import Spec YAML | POST via load-spec logic | file upload or paste |

## Acceptance Criteria

1. All existing pages render correctly with shadcn components
2. No Mantine imports remain in any file
3. Mobile layout works at 390px (iPhone) — sidebar becomes sheet/drawer
4. CRUD forms: can create spec, task, agent from the UI
5. All existing tests pass (updated for shadcn)
6. Activity feed renders grouped tool calls (existing logic preserved)
7. Evidence tab formats test results (not raw JSON)
8. Gates tab shows summary + notable entries
9. Retry button works and navigates to task page
10. Breadcrumbs on all detail pages
11. Keyboard accessible — all interactive elements focusable
12. Build size ≤ 500KB gzipped

## Decisions

- D33: Use shadcn/ui with default "new-york" style variant
- D34: Use Tailwind v4 with @tailwindcss/vite plugin (no PostCSS config needed)
- D35: CRUD forms use shadcn Dialog (modal) not separate pages — keeps navigation simple
- D36: File upload for YAML import uses native file input + client-side yaml parse
