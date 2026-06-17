# P3 - Fan-Out Target Tasks

## Scope

Teach spec import/apply to turn target fan-out entries into concrete
target-scoped tasks.

## Decision Trace

- Decisions: `053`, `056`, `058`, `059`, `060`, `061`, `063`.
- Non-goals: no `Operation`; no `WorkOrder`; no multi-repo writable sandbox.
- Allowed scope: task import, target resolution, task schema if needed, and DAG
  evaluation.
- Verification: spec import tests, task API tests, dispatcher ready-task tests.
- Drift handling: record a decision before changing dispatcher session binding,
  worktree ownership, or Edictum policy semantics.

## Behavior Contract

- Importing a fan-out task with `targetRef: missing-name` must fail loudly in
  CLI output before any task is silently created without a target.
- A task with `targetId` from another project must be rejected before creation.
- Fix/review descendant tasks must preserve the original `targetId`.
- Silent fallback to `targetId = null` is forbidden when a target ref was
  provided.
- Target fan-out must not introduce `Operation`, `WorkOrder`, or multi-repo
  writable sandbox behavior.

## Slop Review

- Are missing or invalid target refs loud failures with behavioral tests?
- Are descendant fix/review `targetId` semantics covered by explicit evidence?
- Did the import path avoid duplicate target/project resolution logic?
- Are errors operator-visible in CLI/API output?

## Required Reading

- `packages/cli/src/spec-import.ts`
- `packages/cli/src/import-handler.ts`
- `packages/core/src/repos/task.ts`
- `packages/core/src/dispatcher.ts`

## Deliverable

Fan-out specs can emit one task per target while preserving existing run and
review behavior.

## Dogfood

Apply `ductum-target.yaml`, then import `target-fanout-dogfood.yaml`. The import
must create `fanout-ductum-resource-model` with a resolved target and no
`Operation` or `WorkOrder` table.
