# Agent Runtime Resolution

## Intake

Make Agent `modelRef` and `harnessRef` runtime-active without replacing the
existing Agent row or creating fake policy and sandbox runtime layers.

## Decision Trace

- Decisions: `053`, `054`, `056`, `058`, `059`, `060`, `065`, `066`, `067`,
  `068`, `069`, `070`, `071`, `072`, `073`, `074`, `075`, `076`.
- Non-goals: no second policy engine; no new top-level primitive; no Operation
  or WorkOrder table; no sandbox runtime driver; no policyRef enforcement; no
  new dependency.
- Allowed scope: core runtime ref resolver, dispatcher integration, API/settings
  create/update validation, CLI manifest behavior, behavioral tests, dogfood
  records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/agent-runtime-resolution --path`,
  `ductum spec drift-review ductum agent-runtime-resolution`,
  `pnpm --filter @ductum/core test`, `pnpm --filter @ductum/api test`,
  `pnpm --filter @ductum/cli test`, `pnpm build`, `git diff --check`, and
  Claude slop review.
- Drift handling: record a decision before changing policyRef/sandboxRef runtime
  behavior, adding new tables, adding dependencies, or changing dispatcher
  session ownership.

## Behavior Contract

- An agent with `resourceRefs.modelRef` must resolve that ref before
  dispatch/runtime use, and the resolved `spec.modelId` must be the model used
  by cost and harness startup paths.
- An agent with `resourceRefs.harnessRef` must resolve that ref before
  dispatch/runtime use, and the resolved `spec.type` must choose the harness
  adapter and session mapping harness.
- API/settings must not reject a resource-resolved `harnessRef` only because
  `spec.type` is absent from the static harness catalog; dispatcher runtime
  must reject unsupported adapter types before run creation.
- Storage must not act as a hidden static harness catalog; resource-resolved
  harness strings may persist, while dispatcher adapter availability remains
  the runtime check.
- Unknown `modelRef` or `harnessRef` must fail loudly before creating a run or
  harness session.
- Wrong-kind refs must fail loudly before creating a run or harness session.
- Cross-project refs must fail loudly before creating a run or harness session.
- A bad ref must never silently fall back to legacy `Agent.model` or
  `Agent.harness`.
- Existing legacy `Agent.model` and `Agent.harness` behavior must preserve
  runtime dispatch behavior when refs are absent.
- API create/update and settings sync must resolve valid refs into runtime
  fields or return visible validation errors for bad refs.
- API/settings input must reject direct `model` with `modelRef` and direct
  `harness` with `harnessRef`; persisted Agent row snapshots are written after
  ref resolution, not accepted as competing input.
- Global Agent API/settings validation resolves factory-scoped refs only;
  project-scoped resource refs are resolved by dispatcher once the task project
  is known.
- Model resources must resolve uncataloged `spec.modelId` values through
  API/settings and dispatcher runtime paths; the static model catalog gates
  legacy direct `Agent.model` inputs only.
- When `harnessRef` resolves outside the static harness catalog, direct legacy
  `Agent.model` must still be catalog-known, but static model/harness
  compatibility is not inferred for the uncataloged harness.
- Model resources with a requested Agent effort must declare
  `supportedEfforts`; otherwise the effort cannot be validated and must fail
  loudly. The static model catalog only validates legacy direct model input.
- Saved Agent row `model`/`harness` values are snapshots for legacy/UI display
  when refs exist; dispatcher re-resolution is authoritative for runtime use.
- Run rows must persist the dispatch-time resolved model/harness values for
  audit and cost, so completed runs do not fall back to legacy Agent fields
  after refs change or disappear.
- Legacy/pre-migration runs may have null runtime snapshots; ref-backed runs
  without a complete snapshot must fail closed for cost inference.
- `policyRef` and `sandboxRef` must remain recorded/config-only and must not
  change runtime policy or sandbox behavior in this slice.

## Slop Review

- Did the implementation satisfy every Behavior Contract item?
- Are tests behavioral, not just shape checks?
- Are missing/invalid refs loud failures?
- Did any path silently fall back to legacy values when a bad ref was provided?
- Did it duplicate config-resource lookup logic?
- Did it add abstraction with only one caller and no boundary?
- Did it add dead policy/sandbox branches for future features?
- Did it preserve legacy behavior when refs are absent?

## Execution Order

| # | Prompt | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-AGENT-RUNTIME-REFS.md](P1-AGENT-RUNTIME-REFS.md) | core/api/cli | Runtime model/harness ref resolution, validation, tests, dogfood | [x] | - |

## Dogfood Record

- Imported as spec `agent-runtime-resolution` (`gfRgoI7ywqis`) in project
  `ductum` (`TSS2w8PhtLSQ`).
- Task `P1-AGENT-RUNTIME-REFS` imported as `5a39wAIvl7iN`, assigned to
  `codex-resource-dogfood`, and accepted as run `Bp38mvoxHIk3`.
- Recorded Decision evidence: `FEiGPtUGJrtg` for decision `067`.
- Recorded Evidence: contract-check `ME_1zwCpcdYd`; drift-review
  `XjV7L0RcglQt`.
- Additional recorded drift choice: decision `068` (`Y4kMuqhqfxOa`) documents
  API/settings snapshot semantics and static catalog scope.
- Harness validation amendment: decision `069` (`wT26epgWRGXX`) documents that
  `harnessRef` is resource-authoritative and dispatcher adapter availability is
  the pre-run runtime check.
- Verification evidence `mr37Z8LuDGyg` records passing spec checks, package
  tests, full build, and `git diff --check`.
- Post-review verification evidence `60W5vG6sOuzv` records passing spec checks,
  package tests, full build, and `git diff --check` after the Claude fixes.
- Second-review verification evidence `zOX0mHvk4sxN` records passing spec
  checks, package tests, full build, and `git diff --check`.
- Final verification evidence `SndnOJHJM4jx` records passing spec checks,
  package tests, full build, and `git diff --check` after caveat fixes.
- Final post-Claude verification evidence `jkoGtUIHnyz_` records passing spec
  checks, package tests, full build, and `git diff --check`.
- Scope amendment: decisions `074`, `075`, and `076` record factory-scoped Agent
  API validation, legacy-compatible runtime snapshot nullability, and
  uncataloged harness compatibility scope.
- Final recorded verification evidence `oPwHw3yOdu5N` captures the passing
  core/API/CLI tests, full build, diff check, spec checks, and Claude slop
  review follow-up fixes/decisions.
- Post-input-shape-fix verification evidence `tDbYp2vhLZFt` records the final
  API/CLI/build/diff/spec pass and the recorded Claude follow-ups.

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
