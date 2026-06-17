# P3: Model Routing

**Scope:** Task-to-model routing hints, cost-aware dispatch
**Package:** `packages/core`, `packages/api`, `packages/cli`
**Depends on:** P1 (OpenCode verified)
**Deliverable:** Tasks can specify preferred model tier, dispatcher respects it

---

## Required Reading

- `packages/core/src/dispatcher.ts` — `matchAgent()` logic (line ~170)
- `packages/core/src/types.ts` — Task interface (line ~103), AgentRole
- `packages/core/src/db.ts` — project_agents table (line ~34, PK is project_id+agent_id)
- `packages/api/src/routes/tasks.ts` — task creation (line ~27)
- `packages/api/src/routes/projects.ts` — project-agent assignment (line ~83)
- `packages/cli/src/spec-import.ts` — YAML import field handling
- `ductum.yaml` — current agent/project config
- `scripts/serve.mjs` — how config is seeded

## Schema Changes Required

### 1. Add `complexity` to tasks table

Migration `007_task_complexity`:
```sql
ALTER TABLE tasks ADD COLUMN complexity TEXT
  CHECK (complexity IN (NULL, 'simple', 'standard', 'complex'));
```

Update `packages/core/src/types.ts` — add to Task interface:
```typescript
complexity: 'simple' | 'standard' | 'complex' | null
```

### 2. Change project_agents to support multiple roles per agent

Current schema: `PRIMARY KEY (project_id, agent_id)` with single `role TEXT`.
An agent can only have one role per project.

New schema — change PK to include role (copy-forward, preserves existing data):
```sql
-- Migration 008_multi_role_agents
-- Copy-forward: preserve existing assignments
CREATE TABLE project_agents_new (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('builder', 'reviewer', 'docs', 'watcher')),
  PRIMARY KEY (project_id, agent_id, role)
);
INSERT INTO project_agents_new SELECT * FROM project_agents;
DROP TABLE project_agents;
ALTER TABLE project_agents_new RENAME TO project_agents;
```

Update `packages/core/src/repos/` — ProjectAgentRepo needs to handle
multiple rows per (project, agent) pair.

### 3. Update API endpoints

**POST /api/specs/:id/tasks** — accept optional `complexity` field.
**POST /api/projects/:id/agents** — accept `roles: string[]` (array) instead
of single `role: string`. Create one row per role.

### 4. Update serve.mjs seeding

Current ductum.yaml format:
```yaml
agents:
  mimi: builder           # single role
```

New format:
```yaml
agents:
  mimi: [builder, reviewer]    # multiple roles
  codex: [builder, reviewer]
  glm: [docs, builder]
```

Seeding loop in serve.mjs creates one project_agents row per role.

### 5. Update dispatcher matchAgent

When multiple agents match the required role, sort by complexity preference:

```typescript
// After filtering by role, sort by model cost
if (task.complexity === 'simple') {
  candidates.sort((a, b) => costOf(a) - costOf(b))  // cheapest first
} else if (task.complexity === 'complex') {
  candidates.sort((a, b) => costOf(b) - costOf(a))  // most capable first
}
// Pick first non-busy candidate
```

Cost ranking: use a static map or agent config field.

### 6. Update YAML import

`packages/cli/src/spec-import.ts` — pass through `complexity` field from YAML.
`scripts/load-spec.mjs` — same.

## Verification

- [ ] Task with `complexity: simple` routes to cheapest available agent
- [ ] Task with `complexity: complex` routes to most capable
- [ ] Agent with multiple roles can be matched for any of its roles
- [ ] Fallback: if preferred model is busy, next matching agent is used
- [ ] DB migration adds complexity column and multi-role PK
- [ ] API accepts complexity on task creation
- [ ] YAML import passes complexity through
