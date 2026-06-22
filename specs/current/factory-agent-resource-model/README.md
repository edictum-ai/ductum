# Factory Agent Resource Model

## Intake

Make `Agent` a declarative configured worker without replacing the existing
dispatcher/runtime row.

## Decision Trace

- Decisions: `053`, `054`, `056`, `058`, `059`, `060`, `062`, `065`.
- Non-goals: no second policy engine; no dispatcher session binding change; no
  sandbox runtime driver; no Pi-only rewrite.
- Drift handling: record a decision/evidence row before changing dispatch,
  Edictum enforcement, sandbox creation, or harness session ownership.

## Behavior Contract

- Agent manifests with `modelRef` must resolve to a runtime model or fail
  loudly before create/update.
- Agent manifests with `harnessRef` must resolve to a runtime harness or fail
  loudly before create/update.
- Stored `resourceRefs` must round-trip through API/CLI show output.
- A manifest that tries to use `resourceRefs.policyRef` as runtime policy
  enforcement must be reported as out of scope; Edictum remains policy owner.
- Existing dispatcher model/harness routing changes must fail dispatch tests.

## Slop Review

- Are ref-resolution failures visible in CLI output?
- Are behavioral tests covering parse, resolve, apply, persist, and show paths?
- Did this duplicate config-resource lookup logic unnecessarily?
- Did it add sandbox or policy runtime behavior outside scope?

## Execution Order

| # | Prompt | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-AGENT-COMPOSITION-REFS.md](P1-AGENT-COMPOSITION-REFS.md) | Agent | Agent composition refs, config/API/CLI apply, tests | [x] dogfood run `cyVW0FJtDdT5` | — |

## Dogfood Record

- Applied resources from `specs/current/factory-resource-model/resources.yaml`.
- Applied Agent manifest `agent-dogfood.yaml` as `codex-resource-dogfood`
  (`Amtal0MIUBXy`).
- Imported spec `factory-agent-resource-model` as `E0bmbeXXHd91`.
- Imported task `P1-AGENT-COMPOSITION-REFS` as `Lf01fs3RN0DQ`.
- Accepted task as run `cyVW0FJtDdT5`.
- Recorded decision `28_rwttcgHYp`.
- Recorded evidence `3t_koRgugHIR` and `ZdDKbg1JfSEa`.
- Decision drift: none recorded.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
