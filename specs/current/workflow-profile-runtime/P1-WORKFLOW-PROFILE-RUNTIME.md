# P1 - WorkflowProfile Runtime

## Scope

Make `Agent.resourceRefs.workflowProfileRef` resolve into a stable Run
workflow snapshot used by Edictum workflow definition selection.

## Decision Trace

- Decisions: `053`, `057`, `058`, `059`, `060`, `064`, `065`, `066`, `067`,
  `070`, `073`, `077`, `080`, `081`, `082`, `083`, `084`.
- Non-goals: no second policy system; no Edictum workflow rewrite; no workflow
  marketplace/plugin abstraction; no Operation or WorkOrder table; no new
  top-level primitive/table; no broad dashboard polish; no new dependency.
- Allowed scope: core WorkflowProfile ref validation, Run snapshot persistence,
  Edictum workflow definition resolution from run snapshots, setup and verify
  command selection from run snapshots, dispatcher renderability preflight,
  API/manual run snapshotting, fix/review lineage snapshot inheritance,
  behavioral tests, and existing operator-visible failure surfaces.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
- Drift handling: stop and record a decision before adding a new policy system,
  new workflow marketplace, new table, new top-level primitive, dependency, or
  Edictum workflow semantics change.

## Behavior Contract

- An agent with a valid `workflowProfileRef` resource must dispatch with the
  referenced WorkflowProfile snapshot on the Run.
- The Run snapshot must materialize rendered workflow text plus setup and
  verification commands so the run does not drift if the source file changes.
- Path-only workflow profile Run snapshots must fail loudly instead of
  re-reading mutable profile files.
- Fix/review lineage runs must inherit the parent materialized workflow profile
  snapshot when the parent has one.
- Edictum runtime resolution must use `Run.runtimeWorkflowProfile` before
  legacy project/env/fallback workflow config.
- Dispatcher runtime setup command resolution must resolve from the workflow
  profile resource snapshot before legacy project/env workflow config.
- Post-completion verification command resolution must resolve from the
  workflow profile resource snapshot before legacy project/env workflow config.
- A missing workflow profile resource ref must fail loudly before harness
  session creation.
- A wrong-kind workflow profile resource ref must fail loudly before harness
  session creation.
- A cross-project workflow profile resource ref must fail loudly before harness
  session creation.
- A malformed WorkflowProfile resource must fail loudly with operator-visible
  output.
- A configured bad workflow profile resource ref must never silently fall back
  to legacy project workflow config.
- Dispatcher runtime validation must fail loudly before adapter spawn when the
  referenced workflow profile resource cannot be rendered.
- An agent without `workflowProfileRef` must preserve existing legacy workflow
  behavior.
- Run audit evidence/output must make the resolved workflow profile snapshot
  visible.
- This slice must not change Edictum policy semantics or add a second policy
  system.
- Tests must prove workflow selection behavior, not only schema shape.

## Implementation Notes

- Reuse the existing config-resource ref resolver; do not add a second lookup
  path.
- Persist the Run snapshot: id, name, project scope, source path, optional
  description, rendered workflow text, setup commands, and verification
  commands.
- Make `WorkflowDefinitionResolver` choose the Run snapshot before project
  config or startup env maps.
- Make setup and verify command selection choose the Run snapshot before
  project startup env maps.
- Make fix/review lineage dispatch inherit the parent materialized workflow
  profile snapshot.
- Keep legacy project workflow behavior untouched when `workflowProfileRef` is
  absent.
- Validate renderability in dispatcher via a small config callback so core does
  not learn API startup env details.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did configured bad workflow refs fail before harness session creation?
- Did any path silently fall back to legacy project workflow config after a bad
  `workflowProfileRef`?
- Did the implementation duplicate config-resource lookup logic?
- Did it change Edictum policy semantics instead of selecting a definition?
- Did setup or verify commands still come from legacy config when a Run
  workflow profile snapshot exists?
- Did a Run workflow profile snapshot ever re-read the source profile file?
- Did fix/review lineage runs preserve the parent workflow profile snapshot?
- Did it add fake workflow marketplace/provider branches?
- Did legacy no-ref workflow behavior remain unchanged?
- Is the resolved workflow profile visible on the Run snapshot?

## Verification

```sh
ductum spec contract-check ductum specs/current/workflow-profile-runtime --path
ductum spec drift-review ductum workflow-profile-runtime
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
