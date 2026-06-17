# 067 - Agent Runtime Ref Resolution

## Status

Accepted

## Context

Decision `065` added `resourceRefs` to the existing Agent row while preserving
legacy `model` and `harness` fields. That kept imports safe, but runtime
dispatch still mostly trusts the row fields. The next resource-model slice needs
`modelRef` and `harnessRef` to be real runtime inputs without adding a second
Agent primitive or moving policy and sandbox enforcement into Ductum.

## Decision

Resolve Agent runtime refs at the core boundary before a run or harness session
is created.

- `resourceRefs.modelRef` resolves to a `Model` config resource and uses
  `spec.modelId` as the runtime `Agent.model`.
- `resourceRefs.harnessRef` resolves to a `Harness` config resource and uses
  `spec.type` as the runtime `Agent.harness`.
- Lookup is scoped to the run's project: resource id first, then project-scoped
  name, then factory-scoped name.
- Factory-scoped resources may be used by any project.
- Project-scoped resources may only be used by runs in the same project.
- A ref that points at another resource kind is a wrong-kind error.
- A ref that points at another project's resource is a cross-project error.
- Missing, ambiguous, wrong-kind, or cross-project refs fail before run creation.
- Existing `Agent.model` and `Agent.harness` remain the runtime fallback only
  when the corresponding ref is absent.

## Why This Is Not Drift

This completes the runtime migration explicitly allowed by decision `065` while
preserving the existing Agent row and dispatcher session binding. Ductum still
coordinates state. Edictum remains the policy engine.

## Non-Goals

- No new Agent table.
- No new top-level primitive.
- No second policy engine.
- No sandbox runtime driver.
- No policyRef runtime enforcement.
- No sandboxRef runtime enforcement.
- No new dependency.
