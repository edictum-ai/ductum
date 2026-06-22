# Factory Resource Model - Implementation Prompts

**Spec:** `specs/current/factory-resource-model-targets.md`
**Generated:** 2026-04-26
**Status:** In progress

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `061`, `062`, `063`, `064`, `066`.
- Non-goals: no `Operation`; no `WorkOrder`; no second policy engine; no graph
  analyzer; no unrecorded scope expansion.
- Allowed scope: declarative resource-model prompts, target fan-out, drift
  review artifacts, dogfood records, and Behavior Contract coverage.
- Verification: package tests, full build, CLI/API dogfood commands, contract
  check output, and `git diff --check`.
- Drift handling: record a decision/evidence row before expanding the resource
  model beyond the accepted sequence or changing Edictum policy ownership.

## Behavior Contract

- Every implementation prompt in this spec must include Decision Trace,
  Behavior Contract, Verification, Drift handling, and Slop Review coverage.
- Target fan-out with a missing target ref must fail loudly in CLI/API output.
- A task `targetId` from another project must be rejected before creation.
- Fix/review descendant tasks must preserve the original `targetId`.
- Silent fallback to `targetId = null` is forbidden when a target ref was
  provided.
- Drift review output must make missing prompt coverage visible to operators.

## Slop Review

- Did every Behavior Contract item get a behavioral test or recorded evidence?
- Are missing or invalid target refs loud failures?
- Did implementation duplicate target/resource resolution logic?
- Did this add dead config branches or future-only abstractions?
- Did any path swallow errors into logs without CLI/API visibility?

## Execution Order

| # | Prompt | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-TARGET-RESOURCE.md](P1-TARGET-RESOURCE.md) | Target | Target type, storage, config, API, CLI, tests | [x] | - |
| 2 | [P2-PROFILE-PLACEHOLDERS.md](P2-PROFILE-PLACEHOLDERS.md) | Profiles | Minimal resource schemas for WorkflowProfile, Model, Harness, SandboxProfile, NotificationChannel | [x] | P1 |
| 3 | [P3-FANOUT-TARGET-TASKS.md](P3-FANOUT-TARGET-TASKS.md) | Fan-out | Spec import emits target-scoped tasks | [x] | P1 |
| 4 | [P4-DECISION-DRIFT-REVIEW.md](P4-DECISION-DRIFT-REVIEW.md) | Review | Drift review prompt and checklist wired into dogfood tasks | [x] | P1, P2, P3 |

## Verification

```bash
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```

## Dogfood Records

- Target manifest applied through CLI/API: `specs/current/edictum-targets.yaml`
- Imported Ductum spec: `factory-resource-model` (`fExIKvfwfOwQ`)
- Imported P1 task: `P1-TARGET-RESOURCE` (`AqVYqhc63U5s`)
- Accepted run: `K2FpA1NgVWRY`
- Recorded decision: `Qp7UPv0esANR`
- Attached evidence: `DVJ0jTNjXAFK`
- Resource shell manifest applied through CLI/API: `specs/current/factory-resource-model/resources.yaml`
- Imported P2 task: `P2-PROFILE-PLACEHOLDERS` (`mrthh5dduaMY`)
- Accepted P2 run: `ZkhaqT5lnLHa`
- P2 recorded decision: `WeGK_bKDBKQa`
- P2 attached evidence: `7wgmnu-qJVrg`
- Applied dogfood target manifest: `specs/current/factory-resource-model/ductum-target.yaml`
- Imported target fan-out dogfood spec: `OV1uTAjmObhR`
- Created target-scoped fan-out task: `P--B2pJOyI87`
- Accepted P3 run: `-HBHAxwGMf0v`
- Accepted fan-out dogfood run: `vzetfPEy4Rx4`
- P3 recorded decision: `CTQLmPGGoxGM`
- P3 attached evidence: `sdrrvsgR95Tb`
- Generated drift review artifact: `decision-drift-review-dogfood.md`
- Accepted P4 run: `URyeDJEaNHDQ`
- P4 recorded decision: `z3Ls8ljmsr9H`
- P4 attached evidence: `8GYxyT6nKbFC`
- Added Behavior Contract and Slop Review sections to current file-backed
  artifacts under decision `066`.
- File-backed contract check passed:
  `contract-check-files-dogfood.md`.
- Imported historical DB prompt rows correctly fail contract check:
  `contract-check-dogfood.md`.
