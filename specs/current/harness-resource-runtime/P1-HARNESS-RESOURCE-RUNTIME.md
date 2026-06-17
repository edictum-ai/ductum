# P1 - Harness Resource Runtime

## Scope

Make `Agent.resourceRefs.harnessRef` a fully audited runtime boundary for
dispatch. Preserve existing legacy harness behavior when no harness ref is
configured.

## Decision Trace

- Decisions: `053`, `054`, `057`, `058`, `059`, `060`, `064`, `065`, `066`,
  `067`, `068`, `069`, `070`, `073`, `076`, `080`.
- Non-goals: no Operation or WorkOrder table; no new top-level primitive/table;
  no second policy system; no Edictum policy change; no harness marketplace;
  no generic provider plugin system; no fake provider branches; no broad
  adapter rewrite; no new dependency; no real sandbox driver.
- Allowed scope: core Harness resource validation, dispatch adapter selection
  via `Harness.spec.type`, run evidence audit snapshot, behavioral tests, and
  existing API/CLI/operator-visible failure surfaces.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
- Drift handling: stop and record a decision before adding new harness
  providers, plugin systems, policy paths, top-level state, dependencies, or
  adapter rewrites outside this slice.

## Behavior Contract

- An agent with a valid `harnessRef` must dispatch through the referenced
  Harness resource.
- A missing referenced Harness resource must fail loudly before session
  creation.
- A wrong-kind referenced resource must fail loudly.
- A cross-project referenced resource must fail loudly.
- A malformed Harness resource must fail loudly with operator-visible output.
- A bad configured `harnessRef` must never silently fall back to legacy harness
  config.
- Agents without `harnessRef` must preserve existing legacy dispatch behavior.
- Dispatcher must remain the sole creator of session-to-run mappings.
- `authorize_tool` must remain harness-internal and must not appear in MCP tool
  signatures.
- `gate_check` must remain the agent-visible policy check path.
- Resolved harness metadata must be visible in run state or audit output.
- Tests must prove behavior, not only schema shape.

## Implementation Notes

- Reuse `resolveAgentRuntimeDetails`; do not add a second harness lookup path.
- Convert the resolved `Harness` resource into a normalized runtime snapshot
  for audit. Keep `spec.type` as the only active adapter selector.
- Validate optional Harness metadata in core so repo-bypassed malformed config
  fails before a run/session.
- Record the resolved Harness resource snapshot as existing run evidence before
  adapter spawn.
- Keep the dispatcher as the only writer of `session_run_mapping`.
- Leave MCP tool registration unchanged except for tests that prove
  `authorize_tool` is absent and `ductum.gate_check` is present.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are missing, wrong-kind, cross-project, unsupported, and malformed harness
  refs loud before session creation?
- Did a configured bad `harnessRef` ever fall back to legacy harness config?
- Did the implementation duplicate harness lookup or adapter routing logic?
- Did it blur `authorize_tool` and `gate_check`?
- Did it add fake future-provider branches?
- Did legacy no-ref harness dispatch remain unchanged?
- Is resolved Harness resource metadata visible in run audit output?

## Verification

```sh
ductum spec contract-check ductum specs/current/harness-resource-runtime --path
ductum spec drift-review ductum harness-resource-runtime
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
