# P1 - Dispatcher Startup Readiness

Implement operator-visible dispatcher startup reasons.

## Decision Trace

- Decisions: `022`, `025`, `053`, `054`, `057`, `058`, `059`, `060`, `064`,
  `066`, `069`, `080`, `081`, `090`.
- Non-goals: no new harness adapter, plugin model, marketplace, provider
  abstraction, resource kind, top-level primitive, table, Operation, WorkOrder,
  dependency, Edictum policy change, or second policy system.
- Allowed scope: core dispatcher status, API startup wiring, CLI doctor/status
  wording, operator-visible errors, tests, dogfood records, and evidence.
- Drift handling: record a decision before changing harness adapter loading,
  adding process management, adding a table, adding a dependency, or changing
  Edictum enforcement.

## Behavior Contract

- Dispatcher status must report an operator-visible runtime reason
  `server started without --dispatch` when dispatch was not requested at API
  startup.
- Dispatcher status must report adapter-load failure as a distinct runtime
  reason from no-dispatch startup mode.
- Manual dispatch against a no-dispatch API must fail loudly with
  `server started without --dispatch`.
- Manual dispatch against a dispatch-requested API with no adapters must fail
  loudly with an adapter-load/unavailable reason.
- `ductum doctor --deploy` must show the exact dispatcher startup runtime
  reason in operator-visible output.
- `ductum doctor --deploy` must give an operator-visible recovery action that
  tells the operator to stop the current API before running `pnpm serve` when
  dispatch was not requested.
- Harness adapter import failures must not be swallowed into logs only; status
  or doctor output must make the failure visible.
- The dispatcher must preserve sole creation of session-to-run mappings.
- `authorize_tool` must preserve the harness-internal boundary and must not be
  exposed in MCP tool signatures.
- `gate_check` must preserve the agent-visible policy check path.
- This slice must preserve Edictum policy enforcement without adding a second
  policy path.
- This slice must not add a new dependency, table, primitive, adapter, fake
  provider branch, plugin system, or marketplace that changes runtime behavior.
- Tests must prove dispatcher, API, CLI, and operator-visible failure behavior,
  not only schema shape.

## Implementation Notes

- Prefer a small `disabledReason` in dispatcher config over a new status model.
- Keep the API entrypoint responsible for startup-mode reasons.
- Keep doctor rendering simple and driven by the dispatcher status reason.
- Do not add adapter branches or load-time recovery machinery.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are no-dispatch and no-adapter states distinct in status and doctor output?
- Did manual dispatch produce a loud failure with the right reason?
- Did adapter import failure remain operator-visible rather than swallowed into logs?
- Did the implementation change session mapping ownership?
- Did it blur `authorize_tool` and `gate_check`?
- Did reviewers attack fake abstraction, dead config, future features, or
  duplicate routing logic?
- Did it add fake adapter/provider branches or process-management machinery?
- Did it preserve existing dispatch behavior when adapters are loaded?

## Verification

```sh
ductum spec contract-check ductum specs/current/dispatcher-startup-readiness --path
ductum spec drift-review ductum dispatcher-startup-readiness
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
