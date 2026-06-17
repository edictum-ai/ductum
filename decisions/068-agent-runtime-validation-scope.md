# 068 - Agent Runtime Validation Scope

## Status

Accepted

## Context

Decision `067` made dispatcher-time `modelRef` and `harnessRef` resolution
authoritative for runs. The API and settings config paths still need to write
the existing Agent row, whose `model` and `harness` columns remain required for
legacy agents and UI/operator display. Those paths do not have a run project
unless a task is being dispatched.

## Decision

Dispatcher resolution is authoritative for runtime use. When `resourceRefs`
contains `modelRef` or `harnessRef`, dispatcher must resolve those refs against
the task spec project before creating a run and must use the resolved values for
harness startup, session mapping, and cost paths.

The Agent row `model` and `harness` fields remain legacy/runtime-snapshot fields.
API create/update and settings sync may write the currently resolved values into
those columns so existing list/detail UI and no-ref agents keep working. Those
columns are not authoritative when the corresponding ref is present.

Model resources are authoritative for `modelRef` model IDs. API/settings
validation must not reject a `Model.spec.modelId` only because it is absent from
the static model catalog. The static catalog remains a compatibility guard for
legacy direct `Agent.model` values.

Harness resources are authoritative for `harnessRef` harness type, but a
resolved harness type must still map to a registered dispatcher adapter before
a run/session is created. API/settings validation does not use the static
`HARNESSES` catalog to reject resource-resolved harness types because that
catalog is not the runtime adapter registry.

Global Agent API/settings operations have no run project. They resolve and
snapshot factory-scoped refs. Project-scoped runtime refs are validated by the
dispatcher once the task spec project is known; adding project-scoped Agent API
bindings needs a separate decision.

## Why This Is Not Drift

This keeps the existing Agent primitive and schema intact while making
dispatcher-time ref resolution the runtime source of truth. It avoids a fake
policy/sandbox layer and avoids a second policy engine.

## Non-Goals

- No new Agent table.
- No new top-level primitive.
- No Operation or WorkOrder table.
- No policyRef runtime enforcement.
- No sandboxRef runtime enforcement.
- No second policy engine.
- No new dependency.
