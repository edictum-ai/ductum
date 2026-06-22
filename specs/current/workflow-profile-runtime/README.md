# WorkflowProfile Runtime

## Intake

Make `Agent.resourceRefs.workflowProfileRef` the declarative workflow runtime
source for dispatch and Edictum enforcement, while preserving legacy project
workflow behavior when no workflow ref is configured.

## Grill Questions

- What is the boundary? Dispatch creates the Run and harness session, while
  Edictum creates the workflow runtime on first tool/gate use. The resolved
  workflow profile must be snapshotted on the Run so both boundaries see the
  same decision.
- Where does audit state live? Existing Run state is enough; adding a new table
  is not justified.
- Should Ductum enforce workflow rules? No. Edictum remains the policy system;
  Ductum only selects and records the workflow profile.
- What happens to legacy project config? Agents without `workflowProfileRef`
  must keep the existing project/env/fallback workflow path.

## Decisions

- Add decision `082` for runtime-active WorkflowProfile resource selection.
- Reuse existing config-resource ref lookup rules: id first, project name, then
  factory name.
- Persist the resolved workflow profile snapshot on the Run.
- Materialize rendered workflow text plus setup and verification commands into
  the Run snapshot so runtime behavior is stable after dispatch.
- Make fix/review lineage runs inherit the parent materialized workflow
  snapshot when the parent has one.
- Make Edictum workflow resolution prefer the Run snapshot and fall back to
  existing project/env/fallback behavior only when no workflow ref is present.
- Make setup and verification command selection prefer the Run snapshot before
  legacy project/env profile maps.
- Validate renderability before adapter spawn in dispatcher paths that are given
  a workflow profile validator.

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
  behavioral tests, dogfood records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/workflow-profile-runtime --path`,
  `ductum spec drift-review ductum workflow-profile-runtime`, package tests,
  build, `git diff --check`, and Claude adversarial slop review.
- Drift handling: record a decision before adding a new policy system, new
  workflow marketplace, new table, new top-level primitive, dependency, or
  Edictum workflow semantics change.

## Behavior Contract

- An agent with a valid `workflowProfileRef` resource must dispatch with the
  referenced WorkflowProfile snapshot on the Run.
- A workflow profile Run snapshot must include the rendered workflow plus setup
  and verification commands used by the Run.
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
- Did it preserve legacy no-ref behavior?
- Is the resolved workflow profile visible on the Run snapshot?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-WORKFLOW-PROFILE-RUNTIME.md](P1-WORKFLOW-PROFILE-RUNTIME.md) | core/api | WorkflowProfile ref runtime resolution, Run snapshot, Edictum selection, tests, dogfood | [x] | - |

## Dogfood Record

- Imported as Ductum spec `v8if6KIOUc73`.
- Imported task `P1-WORKFLOW-PROFILE-RUNTIME` as `oHjsBvDNIdKe`.
- Accepted dogfood run `ejOcQBL_4KBH` for the implementation slice.
- Recorded Ductum decision `2nXw2Kff8_Gk` for decision `082`.
- Recorded Ductum decision `i4CGmJeEeUYT` for decision `083`.
- Recorded Ductum decision `N4F_VwsvM_UI` for decision `084`.
- Recorded spec audit evidence `MGGHClIvNs4e`.
- Recorded final verification evidence `InSwsz905ERw`.
- Recorded adversarial review evidence `3eJkZyFbpKNY`.
- Recorded final hardening verification evidence `pitGnAMiGRHz`.

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

Status: verified locally for the implementation slice.
