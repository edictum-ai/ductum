# P4: CRUD Forms

**Scope:** Add create/edit forms for specs, tasks, agents, YAML import
**Package:** `packages/dashboard`
**Depends on:** P2 (core pages — forms are triggered from these pages)
**Deliverable:** Can create specs, tasks, agents, and import YAML from the UI

---

## Required Reading

- `specs/impl-002-dashboard/spec.md` §CRUD forms needed
- `src/api/client.ts` — existing API methods (POST endpoints)
- `src/api/hooks.ts` — existing mutation hooks
- `scripts/load-spec.mjs` — YAML import logic to replicate client-side

## Tasks

### 1. Create Spec dialog

Triggered from ProjectDetail page ("+ New Spec" button).
Fields: name (required), document (textarea), status (select: draft/approved).
API: POST /api/projects/:id/specs

### 2. Create Task dialog

Triggered from SpecDetail page ("+ New Task" button).
Fields: name, prompt (textarea), repos (multi-input), verification (list builder), requiredRole (select), dependencies (multi-select of existing tasks in same spec).
API: POST /api/specs/:id/tasks + POST /api/tasks/:id/dependencies for each dep.

### 3. Register Agent dialog

Triggered from AgentList page ("+ Add Agent" button).
Fields: name, model, harness (select: claude-agent-sdk/opencode), capabilities (multi-input).
API: POST /api/agents (add this endpoint if missing).

### 4. Import Spec from YAML

Triggered from ProjectDetail page ("Import Spec" button).
- File picker or paste area for YAML content
- Client-side parse with `yaml` package (already in workspace root)
- Preview: show parsed spec name, task count, dependency graph
- Confirm: POST to create spec, tasks, dependencies, evaluate DAG
- Reuse logic from `scripts/load-spec.mjs` but as client-side code

### 5. Mutation hooks

Add React Query mutation hooks for all create operations:
- useCreateSpec, useCreateTask, useRegisterAgent, useImportSpec
- Invalidate relevant queries on success
- Show toast/notification on success/error

## Verification

- [ ] Can create a spec from ProjectDetail page
- [ ] Can create a task with dependencies from SpecDetail page
- [ ] Can register an agent from AgentList page
- [ ] Can import a YAML spec file (paste or upload)
- [ ] YAML import shows preview before confirming
- [ ] Forms validate required fields
- [ ] Success triggers query invalidation (new items appear immediately)
