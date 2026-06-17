# P1 - Agent Runtime Refs

## Scope

Make `Agent.resourceRefs.modelRef` and `Agent.resourceRefs.harnessRef` resolve
at runtime before dispatch creates a run or starts a harness session.

## Decision Trace

- Decisions: `053`, `054`, `056`, `058`, `059`, `060`, `065`, `066`, `067`,
  `068`, `069`, `070`, `071`, `072`, `073`, `074`, `075`, `076`.
- Non-goals: no second policy engine; no new top-level primitive; no Operation
  or WorkOrder table; no sandbox runtime driver; no policyRef enforcement; no
  sandboxRef enforcement; no new dependency.
- Allowed scope: shared runtime ref resolution, dispatcher use, API/settings
  validation, CLI manifest alignment, and behavioral tests.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
- Drift handling: stop and record a decision before adding policy/sandbox
  runtime enforcement, adding resource tables, adding dependencies, or changing
  dispatcher session binding.

## Behavior Contract

- A `modelRef` must resolve to a `Model` resource before run creation, and
  `Model.spec.modelId` must be the runtime model used for dispatch and cost.
- A `harnessRef` must resolve to a `Harness` resource before run creation, and
  `Harness.spec.type` must choose the adapter and session mapping harness.
- API/settings must not reject a resource-resolved `harnessRef` only because
  `Harness.spec.type` is absent from the static harness catalog; dispatcher
  runtime must reject unsupported adapter types before run creation.
- SQLite storage must not reject resource-resolved harness strings through a
  hidden static CHECK constraint.
- Missing `Model` or `Harness` refs must fail in CLI/API/operator-visible output
  before run creation.
- Wrong-kind refs must fail in CLI/API/operator-visible output before run
  creation.
- Cross-project refs must fail in CLI/API/operator-visible output before run
  creation.
- A provided bad ref must not fall back to legacy `Agent.model` or
  `Agent.harness`.
- Agents without refs must preserve legacy runtime use of `Agent.model` and
  `Agent.harness`.
- API create/update and settings sync must resolve valid refs into saved runtime
  fields or reject invalid refs.
- API/settings input must reject direct `model` with `modelRef` and direct
  `harness` with `harnessRef`.
- Model resources must resolve uncataloged model IDs through API/settings and
  dispatcher runtime paths; direct legacy `Agent.model` values still use the
  static catalog guard.
- When `harnessRef` resolves outside the static harness catalog, direct legacy
  `Agent.model` must still be catalog-known, but static model/harness
  compatibility is not inferred for the uncataloged harness.
- Global Agent API/settings validation resolves factory-scoped refs only;
  dispatcher resolves project-scoped refs with the task project at runtime.
- Model resources with requested Agent effort must declare `supportedEfforts`;
  otherwise the effort must fail loudly. The static catalog does not validate
  resource-backed effort.
- Saved `Agent.model` and `Agent.harness` values are compatibility snapshots
  when refs exist; dispatcher re-resolution is the runtime source of truth.
- Run rows must persist the dispatch-time resolved model/harness values and cost
  paths must use that snapshot instead of legacy Agent fields if refs later
  change or disappear.
- Legacy/pre-migration runs may have null runtime snapshots; ref-backed runs
  without a complete snapshot must fail closed for cost inference.
- `policyRef` and `sandboxRef` must remain recorded/config-only and must not
  change runtime policy or sandbox behavior in this slice.

## Implementation Notes

- Add one shared resolver near the core config-resource model.
- Dispatcher should resolve against the task spec project before calling
  `runRepo.create`.
- API routes and settings sync should use the same resolver before saving an
  Agent row.
- API/settings validation should use Model resources as source of truth for
  `modelRef` and keep catalog validation for legacy direct model input.
- CLI manifest apply should stop carrying separate config-resource lookup logic
  once API-side resolution is authoritative.
- Keep test helpers and files under the 300 LOC repo rule.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are bad refs loud and pre-run?
- Did a wrong-kind or cross-project ref ever use legacy fallback values?
- Did this duplicate resolver logic in CLI, API, and dispatcher?
- Did this add dead policy/sandbox runtime branches?
- Did legacy no-ref dispatch still run?

## Verification

```sh
ductum spec contract-check ductum specs/current/agent-runtime-resolution --path
ductum spec drift-review ductum agent-runtime-resolution
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
