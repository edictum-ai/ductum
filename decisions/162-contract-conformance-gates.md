---
date: 2026-05-22
status: accepted
deciders: operator (Arnold Cartagena), Codex
related: 135, 145, 161
---

# Decision 162: Boundary contracts need conformance gates, not just TypeScript shapes

## Context

The `gpt-5.5` cost display bug was not a model-specific issue. It
exposed a contract gap: the `codex-app-server` harness started a real
Codex thread but did not persist that provider thread id as the
Ductum harness session id. Older `codex-sdk` runs measured cost
because that path already had session mapping; newer app-server runs
did not.

The same pattern appeared elsewhere:

- `session.started` accepted an optional/null session id even though
  real harness telemetry needs a stable provider session id.
- OpenCode created provider sessions but did not report the provider
  session id back to Ductum.
- Some API routes returned raw `Run` rows after mutations while list
  and detail routes returned `RunUiContract`.
- Dashboard status/cost rendering still has fallback derivations
  because not every backend response historically carried a UI
  contract.

This is a boundary discipline problem. Interfaces exist, but several
important invariants were only implied by comments or by one adapter's
behavior.

## Decision

Ductum boundary contracts must be enforced with both types and
conformance tests.

Immediate rules:

1. Real harnesses must report a stable provider session id through
   `session.started`.
2. `session.started` requires a non-empty `harnessSessionId` at the
   type boundary.
3. Real harness adapters need tests proving they persist provider
   session ids.
4. Run-returning API endpoints should return the canonical
   `RunUiContract` whenever the response can be consumed by the
   dashboard or CLI.
5. New UI pages should consume backend UI contract fields first and
   use local derivation only as a compatibility fallback.

Future hardening:

1. Extract a small shared contracts package for DTOs used by API and
   dashboard.
2. Collapse status/cost presentation fallbacks so backend contract
   output is the default path everywhere.
3. Add route-level tests for mutating endpoints that return runs.
4. Add adapter conformance tests for every built-in harness.

## Reason

TypeScript interfaces only protect the fields that exist at a call
site. They do not prove that every adapter emits a required lifecycle
event, every route decorates the same DTO, or every page renders the
same presentation state.

Conformance tests make those cross-cutting invariants executable. The
goal is not "interfaces everywhere"; the goal is hard contracts at
system boundaries:

- harness to API
- API to dashboard
- pricing scanner to run records
- runtime state to UI state

## Consequences

Adding a new harness now requires more than implementing
`HarnessAdapter`; it must also satisfy telemetry expectations.

API routes that return runs may carry slightly larger payloads because
they include `ui`, but dashboard consumers get a stable contract and
avoid page-specific derivation drift.

Dashboard fallback logic remains temporarily for backwards
compatibility, but it is no longer the desired primary path.
