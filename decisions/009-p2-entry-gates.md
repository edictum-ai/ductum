# P2 Implementation Decision — D29

**Date:** 2026-04-04
**Scope:** `@edictum/core@0.3.2` workflow projection for P2

## Context

P2's updated prompt said to block `WorkflowRuntime.evaluate()` auto-advance by putting
`stage_complete(previous_stage)` on each stage entry gate.

That does not work against the real `@edictum/core@0.3.2` runtime.

In `workflow/runtime-eval.ts`, `evaluateWorkflowCompletion()` builds `nextState` with the
current stage already appended to `completedStages` before checking the next stage's entry
gates. That means `stage_complete(previous_stage)` is true during normal linear completion.

## Decision

Use a sentinel entry gate that Ductum never satisfies:

```yaml
entry:
  - condition: 'stage_complete("__ductum_manual__")'
    message: "Stage advancement managed by Ductum"
```

`setStage()` and `reset()` still work because they force `activeStage` directly and do not
require entry gates to pass. `evaluate()` can authorize tools in the current stage, but it
cannot auto-advance into the next stage.

## Impact

- Ductum still owns stage advancement.
- `recordResult()` remains unused.
- The workflow YAML now matches the real runtime behavior instead of the prompt's stale recipe.
