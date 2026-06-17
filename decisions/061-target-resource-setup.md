# 061 - Target Resource Setup

## Status

Accepted

## Context

The resource-model pass starts with `Target`. Decisions `053` and `059` say
multi-repo work should become fan-out specs that emit target-scoped tasks, but
the current dispatcher, importer, queue, dashboard, and run lineage still key
tasks by `repos: string[]`.

Adding `target_id` to tasks before a real `Target` resource exists would spread
the migration across task import, dispatch, worktree resolution, UI, and
lineage in one slice.

## Decision

Add `Target` as a configuration resource first:

- `targets` SQLite table with `project_id`, `name`, and JSON `spec`.
- config sync from top-level `targets:` in `ductum.yaml`.
- API routes for project-scoped list/create and id-scoped get/update/delete.
- CLI list/get/apply over `kind: Target` manifests.

Do not add `task.target_id` in this first slice. Dogfood prompts may reference
targets through the existing `repos` task field and Decision Trace until the
fan-out spec prompt migrates task creation.

## Why This Is Not Drift

This is a staged implementation of decision `053`, not a contradiction.
`Target` becomes usable and persisted first. Target-scoped task fan-out remains
the next schema step, tracked in the generated prompts.

## Field Rationale

- `project_id`: supports dogfood grouping by Ductum project.
- `name`: stable operator-facing target reference for prompts and manifests.
- `spec.source`: tells Ductum where work happens without storing secrets.
- `spec.branch`: carries target branch defaults for later run creation.
- `spec.workflowRef`: ties a target to its Edictum workflow profile.
- `spec.authRef`: names a credential reference without inline secret data.

## Non-Goals

- No `Operation` or `WorkOrder`.
- No task fan-out migration in this slice.
- No credential vault.
- No sandbox/runtime driver implementation.
