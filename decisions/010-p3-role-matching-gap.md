# P3 Implementation Decision — D30

**Date:** 2026-04-04
**Scope:** Task-to-agent role matching in DAG evaluator / dispatcher

## Context

P3's `nextTask(role)` needs to match unassigned tasks to agents by role. But tasks have no
`required_role` field — only `assignedAgentId`. There's no general way to say "this task
needs a reviewer" without explicitly assigning an agent.

## Decision

For now: unassigned tasks match `builder` role. Explicitly assigned tasks match the assigned
agent's project role and capabilities. This matches the P10 dispatcher's immediate use case
(Mimi builds, Codex reviews explicitly assigned tasks).

## Schema gap

If we later need role-specific unassigned tasks (e.g., "this task needs a reviewer but I
don't care which one"), add a `required_role` column to the tasks table:

```sql
ALTER TABLE tasks ADD COLUMN required_role TEXT
  CHECK (required_role IN (NULL, 'builder', 'reviewer', 'docs', 'watcher'));
```

And update `nextTask()` to filter by `required_role` when set, falling back to `builder`
when null.

## Also noted

Agent capabilities are stored as a JSON array in SQLite and filtered via text matching.
This works at current scale (3 agents) but won't scale to complex capability matching.
Future: normalize to a `agent_capabilities` join table if needed.
