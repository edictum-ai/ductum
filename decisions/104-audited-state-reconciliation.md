# 104 - Audited State Reconciliation

## Status

Accepted

## Context

Ductum already has a run reconciler, but several repairs are only visible in
logs or the one-time CLI response. That is not enough for operator truth: after
the command exits, a later operator should be able to inspect a run and see why
Ductum changed its state.

The stale-server close incident after `a2d6ddf` made the gap concrete. Ductum
could correct the run, but the correction needed explicit evidence so the DB
could explain the contradiction later.

## Decision

- Keep the existing `/api/runs/reconcile` entry point and CLI command.
- Every reconcile mutation against a run must record a run update and `custom`
  evidence with a stable `state-reconcile` payload.
- Task-level reconcile mutations must attach their audit to the run that caused
  the task repair, using existing run evidence and run updates.
- Dry-run reconcile must remain read-only and must not create audit records.
- Reconcile remains a state-repair tool. It must not infer general success from
  arbitrary commit, review, or evidence text beyond the existing merge-commit
  scan behavior.

## Why

The next trust gap is not another resource type. It is making Ductum explain
its own recovery work after the fact, using existing append-only records.

## Non-Goals

- No new top-level primitive, table, dependency, policy system, or marketplace.
- No dashboard redesign.
- No second reconcile path.
- No broad success inference from evidence or review prose.
- No change to Edictum policy enforcement.
