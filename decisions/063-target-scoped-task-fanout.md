# 063 - Target Scoped Task Fan-Out

## Status

Accepted

## Context

Decision `053` says multi-repo work is modeled as fan-out `Spec`s that emit
target-scoped `Task`s, not as top-level `Operation` or `WorkOrder` records.
Decision `061` intentionally deferred `task.target_id` until `Target` existed.

The current importer already turns markdown/YAML prompts into tasks, and the
dispatcher already uses `task.repos` to resolve working directories. Replacing
that dispatcher path in the same slice would mix task fan-out with worktree
semantics.

## Decision

Add nullable `tasks.target_id` and teach spec import to resolve target refs.

- Existing tasks stay valid with `target_id = NULL`.
- YAML tasks may set `target: <target-name>`.
- YAML specs may include `spec.fanOut.targets`; each entry emits one concrete
  task with `target_id`.
- The importer keeps `repos` populated from the imported task or target source
  as a compatibility bridge for the existing dispatcher.
- Review/fix tasks inherit the original task's `target_id`.

## Why This Is Not Drift

This is the concrete schema step that decision `061` deferred. It preserves
decision `053` by representing fan-out as target-scoped tasks and preserves the
non-goal of avoiding `Operation` and `WorkOrder` tables.

Keeping `repos` during the transition is not a second targeting model. It is a
dispatcher compatibility field until target-aware working directory resolution
gets its own slice.

## Non-Goals

- No `Operation` table.
- No `WorkOrder` table.
- No multi-repo writable sandbox.
- No dispatcher session binding changes.
- No Edictum policy changes.
