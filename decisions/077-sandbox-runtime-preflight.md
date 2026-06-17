# 077 - Sandbox Runtime Preflight

## Status

Accepted

## Context

Decisions `053`, `056`, and `065` make `sandboxRef` part of Agent
composition, but decision `067` intentionally left `sandboxRef` recorded-only
while `modelRef` and `harnessRef` became runtime-active. That leaves a slop
gap: an Agent can name a missing or wrong sandbox profile and dispatch will
quietly behave as if no sandbox existed.

The real sandbox driver is still out of scope. Ductum needs a production-grade
preflight and audit boundary first.

## Decision

Resolve `Agent.resourceRefs.sandboxRef` before Ductum creates a run or harness
session.

- `sandboxRef` resolves to a `SandboxProfile` config resource.
- Lookup uses the same scoped config-resource rules as runtime model/harness
  refs: resource id first, then project-scoped name, then factory-scoped name.
- Factory-scoped sandbox profiles may be used by any project.
- Project-scoped sandbox profiles may only be used by runs in the same project.
- Missing, ambiguous, wrong-kind, cross-project, or malformed sandbox refs fail
  before run/session creation.
- A bad `sandboxRef` never falls back to no sandbox.
- A resolved sandbox profile is persisted on the Run as a snapshot for audit.
- Harness execution behavior is unchanged in this slice.

## Why This Is Not Drift

This advances the `SandboxProfile` resource from passive metadata to a
dispatch-time audit boundary, which is the next smallest useful step from
decision `056`. It does not add a sandbox driver, new top-level primitive, new
table, second policy engine, or Edictum enforcement change.

## Non-Goals

- No real sandbox driver.
- No fake sandbox runtime branch.
- No provider support matrix enforcement.
- No Edictum policy change.
- No second policy engine.
- No new top-level primitive or table.
- No new dependency.
