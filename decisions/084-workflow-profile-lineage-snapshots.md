# 084 - WorkflowProfile Lineage Snapshots

## Status

Accepted

## Context

Decision `083` made `Run.runtimeWorkflowProfile` the stable runtime boundary
for rendered workflow rules and setup/verification commands. Post-completion
fix and review runs are child runs in the same implementation lineage, and the
source `WorkflowProfile` resource or profile file can change between the root
implementation run and a later fix/review dispatch.

Re-resolving the resource for each child run would make a single lineage drift
between workflow definitions.

## Decision

Fix/review lineage runs inherit the parent run's materialized
`runtimeWorkflowProfile` snapshot when the parent has one. The inherited
snapshot must already contain rendered workflow text plus setup and verification
commands; path-only snapshots fail loudly instead of re-reading the source file.

Root implementation runs still resolve `Agent.resourceRefs.workflowProfileRef`
before dispatch. Agents without a workflow profile snapshot continue to use
legacy project/env/fallback workflow behavior.

## Why This Is Not Drift

This tightens decisions `082` and `083`: a lineage uses the same workflow
runtime boundary once the root run has selected it. Ductum still only selects
and records the workflow definition; Edictum remains the policy system.

## Non-Goals

- No new table or top-level primitive.
- No second policy system.
- No workflow marketplace or provider abstraction.
- No new dependency.
- No rewrite of post-completion routing.
