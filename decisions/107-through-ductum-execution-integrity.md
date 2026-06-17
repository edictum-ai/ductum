# 107 - Through-Ductum Execution Integrity

## Status

Accepted

## Context

Ductum can still look like a diary when work happens around it and then gets
written back as evidence. A task can appear done even when there is no Ductum
session, worktree, and commit lineage proving Ductum orchestrated the work, and
bakeoff candidates can sit in terminal states without an explicit accepted,
rejected, or fixed outcome.

State reconciliation should repair structural contradictions, not launder
external notes into executed work. Operators need the API, CLI, and dashboard to
say whether a row was orchestrated by Ductum, explicitly recorded externally, or
inconsistent.

## Decision

- Add a shared execution-integrity classifier over existing Task, Run, and
  Evidence records.
- Treat Ductum execution lineage as a run with session id, worktree path, and
  commit SHA.
- Treat external outcomes and bakeoff candidate outcomes as explicit structured
  custom evidence, not inferred prose.
- Reject manual task done status when the task lacks Ductum execution lineage or
  explicit external outcome.
- Surface inconsistent execution state through API, CLI, dashboard run rows, and
  operator brief recommendations.
- Keep reconcile narrow: it may link merge commits back to originating runs, but
  it must not create external outcomes or infer success from evidence prose.

## Why

This keeps Ductum honest about coordination. It can still record external work,
but that path is visibly external instead of pretending the dispatcher ran it.

## Non-Goals

- No new top-level primitive, table, dependency, or policy system.
- No broad success inference from evidence text, review prose, or spec text.
- No replacement for Edictum workflow policy.
- No automatic acceptance of bakeoff candidates.
