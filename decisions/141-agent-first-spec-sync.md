# D141 — Agent-First Spec Sync CLI

Date: 2026-05-03

Status: Accepted

## Context

D115 Gap 1 asked for a CLI path to update already-imported prompt files
without deleting and reimporting an entire spec. Gap 4 also showed that
new P-task files added to an imported markdown spec directory were easy
to miss because `spec import` intentionally refuses to overwrite a spec
that already has tasks.

## Decision

Add `ductum spec sync <path>`.

- Prompt file path: resolves the imported spec by the parent directory
  name, resolves the task by the file basename without `.md`, and updates
  that task's prompt in place.
- Directory path: resolves the imported spec by directory basename,
  parses the existing markdown `README.md` execution table, updates
  changed task prompts, creates new prompt files as new tasks, removes
  tasks missing from the source table, wires missing dependencies, and
  re-evaluates the DAG.
- YAML files are not accepted in this feature. The bundle requirement
  distinguishes file mode as a single task prompt update; YAML sync can
  be added later if needed.

The command uses the D135 schema envelope:

```json
{
  "schemaVersion": 1,
  "kind": "spec.sync",
  "data": {
    "specId": "...",
    "sourcePath": "...",
    "added": ["task-id"],
    "updated": ["task-id"],
    "removed": ["task-id"],
    "unchanged": ["task-id"]
  },
  "ts": "..."
}
```

The API surface stays narrow: `PUT /api/tasks/:id/prompt` updates prompt
text only. Task creation, deletion, dependencies, and DAG evaluation keep
using existing validated API routes.

## Consequences

Operators and orchestrator agents can patch imported prompt files or
pick up newly added P-tasks without falling back to direct DB edits.
Sync is intentionally name-based for the markdown import format because
the original import stores task names, not source file paths.
