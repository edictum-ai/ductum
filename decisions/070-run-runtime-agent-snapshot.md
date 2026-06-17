# 070 - Run Runtime Agent Snapshot

## Status

Accepted

## Context

Decision `067` made `modelRef` and `harnessRef` runtime-active. Decision `068`
made dispatcher-time resolution authoritative for each run. The first
implementation kept the resolved Agent only in dispatcher memory and reused the
legacy Agent row when a completed run needed cost calculation after refs had
changed or disappeared.

That weakens auditability and can silently price a run with a legacy
`Agent.model` value that was not the model used at dispatch.

## Decision

Persist the dispatch-time resolved model and harness on each Run as
`runtime_model` and `runtime_harness`.

The dispatcher writes these values after resolving Agent `modelRef` and
`harnessRef` and before spawning the harness session. Cost calculation uses the
active in-memory Agent while the session is live, then falls back to the Run
runtime snapshot. If an old/pre-migration run with refs has no runtime snapshot
and its refs can no longer resolve, cost calculation must fail closed instead
of using legacy Agent row fields.

Legacy runs without refs may continue to use legacy Agent row fields.

## Why This Is Not Drift

This keeps the existing Run primitive and records the actual runtime values
needed for audit and cost. It does not add a new top-level primitive, a second
policy engine, or policy/sandbox runtime behavior.

## Non-Goals

- No new top-level primitive or table.
- No Operation or WorkOrder table.
- No policyRef runtime enforcement.
- No sandboxRef runtime enforcement.
- No second policy engine.
- No new dependency.
