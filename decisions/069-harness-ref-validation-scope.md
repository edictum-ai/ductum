# 069 - Harness Ref Validation Scope

## Status

Accepted

## Context

Decision `068` made Model resources authoritative over `modelRef` values and
kept dispatcher-time resolution authoritative for runtime. The same resource
authority needs to apply to `harnessRef`: a `Harness` resource owns
`spec.type`, while the dispatcher owns the registered adapter set.

## Decision

API and settings validation must resolve `harnessRef` to a `Harness` resource
and validate that `spec.type` exists, but they must not reject a
resource-resolved harness type solely because it is absent from the static
`HARNESSES` catalog.

The dispatcher remains the runtime enforcement point for adapter availability.
If a resolved `Harness.spec.type` has no registered adapter, dispatcher fails
loudly with `AgentRuntimeResolutionError` before creating a run or session.

Legacy direct `Agent.harness` input still uses the static harness catalog as a
compatibility guard.

## Why This Is Not Drift

This keeps Ductum from adding a second harness policy layer. Config resources
describe desired runtime configuration; dispatcher owns whether the current
process can actually start that harness.

## Non-Goals

- No new harness registry table.
- No fake harness adapter.
- No policyRef runtime enforcement.
- No sandboxRef runtime enforcement.
- No second policy engine.
- No new dependency.
