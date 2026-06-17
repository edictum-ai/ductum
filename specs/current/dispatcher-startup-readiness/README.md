# Dispatcher Startup Readiness

## Intake

Make Ductum deploy readiness report why the dispatcher is unavailable. The live
factory is reachable, but `doctor --deploy` reports "no harness adapters
loaded" even when the API was simply started without `--dispatch`. Operators
need the exact startup reason before they can make the factory dispatch work.

## Grill Questions

- What is the immediate failure? A live API process was started without
  `--dispatch`, so dispatcher status reports the wrong reason.
- Where should the reason surface? `/api/factory/dispatcher`,
  `ductum dispatcher status`, `ductum doctor --deploy`, operator brief actions,
  and manual dispatch failures.
- Should this load or rewrite adapters? No. It only makes existing startup
  state visible.
- What remains unchanged? Harness adapters, Edictum policy, session mappings,
  resource resolution, sandbox runtime, and the dispatch loop.

## Decisions

- Add decision `090` for dispatcher startup readiness.
- Carry a dispatcher disabled reason through core status.
- Pass explicit startup reasons from the API entrypoint.
- Keep `server started without --dispatch` distinct from adapter-load failure.
- Keep manual dispatch failure operator-visible and aligned with status.

## Decision Trace

- Decisions: `022`, `025`, `053`, `054`, `057`, `058`, `059`, `060`, `064`,
  `066`, `069`, `080`, `081`, `090`.
- Non-goals: no new harness adapter, plugin model, marketplace, provider
  abstraction, resource kind, top-level primitive, table, Operation, WorkOrder,
  dependency, Edictum policy change, or second policy system.
- Allowed scope: core dispatcher status, API startup wiring, CLI doctor/status
  wording, operator-visible errors, tests, dogfood records, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/dispatcher-startup-readiness --path`,
  `ductum spec drift-review ductum dispatcher-startup-readiness`, package
  tests, build, `git diff --check`, and adversarial slop review.
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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-DISPATCHER-STARTUP-READINESS.md](P1-DISPATCHER-STARTUP-READINESS.md) | core/api/cli | Dispatcher startup reasons, doctor output, manual dispatch failures, behavioral tests | [x] | - |

## Dogfood Record

- Imported as spec `dispatcher-startup-readiness` (`iC5jET4P78TW`) in project
  `ductum`.
- Task `P1-DISPATCHER-STARTUP-READINESS` imported as `Vm7RuXe9oaS8`, assigned
  to `codex-resource-dogfood`, and accepted as run `uOxBSALzyc3O`.
- Recorded decision `X2aRkIlODWV6` for decision `090`.
- Recorded spec audit evidence: `Ofo6ogFH0-PS`.
- Recorded final verification evidence: `lJXpHjLqkkVC`.
- Claude adversarial review timed out after 90 seconds with no completed
  stdout; local slop review passed with no blockers and is included in
  `lJXpHjLqkkVC`.

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
