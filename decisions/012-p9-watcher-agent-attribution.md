# P9 Implementation Decision — D31

**Date:** 2026-04-04
**Scope:** Watcher child run `agent_id` attribution

## Context

P9 requires CI/review watchers to create child `runs` records for audit trail and cost tracking.
But `runs.agent_id` is required, and neither `spec.md` nor `P9-WATCHERS.md` defines how a watcher
agent is selected. P9 scope also does not add the project/agent lookups needed to resolve a
dedicated `watcher` role.

## Decision

For P9, watcher child runs inherit the parent run's `agentId` by default.

`WatcherManager` also exposes an optional resolver so a later prompt can switch child runs to a
dedicated watcher agent without rewriting watcher logic.

## Why

- Keeps P9 inside the current schema and prompt scope
- Avoids inventing hidden synthetic agents in Core
- Preserves a usable task-execution lineage for audit/history now
- Leaves a clean upgrade path once project-level watcher assignment exists
