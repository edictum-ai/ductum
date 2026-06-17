# 082 - WorkflowProfile Runtime

## Status

Accepted

## Context

Decision `053` makes `WorkflowProfile` a declarative resource for setup,
verification, review, approval, and merge rules. Decision `065` added
`Agent.resourceRefs.workflowProfileRef`, but runtime still selects Edictum
workflow definitions from legacy project config or startup env maps.

That leaves a policy drift gap: an agent can claim a workflow profile resource,
but dispatch and enforcement may run a different workflow. Because the workflow
is the Edictum policy boundary, resource-backed workflow selection must be
stable for the lifetime of a run.

## Decision

Make `Agent.resourceRefs.workflowProfileRef` runtime-active:

- `workflowProfileRef` resolves to a `WorkflowProfile` config resource before
  dispatcher session creation.
- Missing, wrong-kind, cross-project, ambiguous, or malformed refs fail loudly
  and do not fall back to legacy project workflow config.
- The resolved workflow profile snapshot is persisted on the Run. Existing Run
  state is sufficient; no new table or top-level primitive is added.
- Edictum workflow resolution uses `Run.runtimeWorkflowProfile` first, then
  preserves existing legacy project/env/fallback behavior when no workflow ref
  is configured.
- Dispatcher setup commands and post-completion verification commands use
  `Run.runtimeWorkflowProfile` when present, then preserve existing project/env
  behavior when no workflow ref is configured.
- Dispatcher validates the referenced profile can be rendered before adapter
  spawn when a workflow profile validator is configured.
- Agents without `workflowProfileRef` preserve legacy workflow behavior.
- This does not add a second policy system. Edictum remains the policy system;
  Ductum only resolves and records the workflow profile selection.

## Why This Is Not Drift

This advances an existing Agent composition ref from passive metadata to the
runtime policy-selection boundary required by decisions `053` and `065`. The
slice records the selected resource on the existing Run row and leaves Edictum
as the only workflow enforcement layer.

## Non-Goals

- No second policy system.
- No new workflow marketplace or plugin abstraction.
- No Operation or WorkOrder table.
- No new top-level primitive or table.
- No broad dashboard polish.
- No rewrite of Edictum workflows.
- No new dependency.
