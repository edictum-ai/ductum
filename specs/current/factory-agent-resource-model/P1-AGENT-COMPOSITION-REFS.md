# P1 - Agent Composition References

## Scope

Add declarative composition references to the existing Agent runtime row.

## Decision Trace

- Decisions: `053`, `054`, `056`, `058`, `059`, `060`, `062`, `065`.
- Non-goals: no second policy engine; no dispatcher session binding change; no
  sandbox runtime driver; no Pi-only rewrite.
- Allowed scope: Agent type/storage/API/config/CLI manifest apply and tests.
- Verification: core/API/CLI package tests, full build, `git diff --check`.
- Drift handling: record a decision before moving policy enforcement, sandbox
  creation, or harness dispatch semantics into this slice.

## Behavior Contract

- `kind: Agent` manifests with `modelRef` must resolve to a concrete runtime
  model or fail loudly before create/update.
- `kind: Agent` manifests with `harnessRef` must resolve to a concrete runtime
  harness or fail loudly before create/update.
- Stored `resourceRefs` must round-trip through core repo, API create/update,
  settings sync, seed sync, and CLI show output.
- `policyRef` must remain a reference only; Edictum remains the policy engine.
- Existing dispatcher session binding and model/harness dispatch behavior must
  remain unchanged.

## Slop Review

- Are missing model/harness refs tested as loud failures?
- Are tests checking runtime field resolution, not only JSON shape?
- Did this add policy or sandbox runtime behavior outside scope?
- Did it duplicate config resource lookup logic?

## Required Reading

- `packages/core/src/types.ts`
- `packages/core/src/repos/agent.ts`
- `packages/api/src/routes/agents.ts`
- `packages/api/src/routes/settings.ts`
- `packages/cli/src/commands/agents.ts`
- `scripts/serve-seed.mjs`

## Deliverable

Declarative `kind: Agent` manifests can create/update agents with composition
refs while preserving existing runtime model/harness dispatch behavior.
