# 083 - WorkflowProfile Snapshot Materialization

## Status

Accepted

## Context

Decision `082` made `Agent.resourceRefs.workflowProfileRef` runtime-active and
said workflow selection must be stable for the lifetime of a Run. A path-only
Run snapshot validates before dispatch, but setup, verification, and Edictum
workflow resolution can still re-read a changed or deleted profile file later.

That creates decision drift: the Run records the selected resource, but runtime
behavior can move after dispatch if the referenced file changes.

## Decision

Materialize WorkflowProfile runtime data into the existing Run snapshot:

- Persist the rendered Edictum workflow text on `Run.runtimeWorkflowProfile`.
- Persist setup and verification command lists on `Run.runtimeWorkflowProfile`.
- Use the materialized snapshot for Edictum workflow resolution when present.
- Use the materialized setup and verification commands when present.
- Keep the source path in the snapshot for operator audit and compatibility.
- Preserve legacy path-based behavior only for runs without a
  `runtimeWorkflowProfile` snapshot.

No new table, top-level primitive, policy system, marketplace, or dependency is
added.

## Why This Is Not Drift

This tightens decision `082`: the Run snapshot becomes the stable runtime
boundary instead of a pointer that can drift after dispatch. Edictum still owns
policy evaluation; Ductum only records the selected rendered workflow and
command data used by that run.

## Non-Goals

- No new WorkflowProfile content table.
- No Edictum semantic rewrite.
- No second policy system.
- No workflow marketplace or provider abstraction.
- No broad UI work.
