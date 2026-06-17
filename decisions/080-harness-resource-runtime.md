# 080 - Harness Resource Runtime

## Status

Accepted

## Context

Decisions `053`, `054`, `065`, and `067` made `Agent.resourceRefs.harnessRef`
runtime-active: a referenced `Harness` resource resolves before dispatch, and
`spec.type` selects the existing harness adapter. Decisions `069`, `073`, and
`076` keep `Harness` storage from acting like a static catalog and leave adapter
availability as a dispatcher runtime concern.

That leaves one production gap for the current slice: resource-backed harness
dispatch needs a recorded audit boundary and core-side validation of the
runtime metadata that can bypass API/settings normalization.

## Decision

Keep `Harness` resource runtime selection small and explicit:

- `Agent.resourceRefs.harnessRef` continues to resolve to a `Harness` config
  resource before run or session creation.
- `Harness.spec.type` remains the adapter key used by dispatch.
- Core validates the referenced `Harness` runtime shape before run creation:
  `spec.type` must be a non-empty string, `spec.command` and
  `spec.controlMode` must be strings when present, and
  `spec.supportedSandboxes` must be an array of strings when present.
- When a `harnessRef` is configured, malformed metadata must fail loudly before
  run/session creation and must not fall back to legacy agent harness config.
- When no `harnessRef` is configured, legacy agent harness dispatch remains
  unchanged.
- The resolved harness resource snapshot is recorded as run evidence before
  adapter spawn. Existing `Run.runtimeHarness` remains the run-state adapter
  snapshot.
- No new run column, table, top-level primitive, adapter marketplace, plugin
  abstraction, dependency, or policy path is added.
- Dispatcher remains the only code path that creates `session_run_mapping`.
- `authorize_tool` remains harness-internal, while `gate_check` remains the
  agent-visible MCP policy status path.

## Why This Is Not Drift

This tightens the existing runtime-active Harness resource path from decision
`067` without changing the harness adapter model or Edictum enforcement model.
It uses existing run state and evidence surfaces for audit instead of adding a
new primitive.

## Non-Goals

- No harness marketplace or generic provider plugin system.
- No rewrite of all harness adapters.
- No second policy system.
- No Edictum policy change.
- No `Operation` or `WorkOrder` table.
- No new top-level primitive or table.
- No new dependency.
- No real sandbox driver.
