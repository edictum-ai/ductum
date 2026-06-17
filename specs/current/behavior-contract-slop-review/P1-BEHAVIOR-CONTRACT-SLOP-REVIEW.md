# P1 - Behavior Contract Slop Review

## Scope

Add Behavior Contract coverage checks and Slop Review pressure to the existing
markdown-backed spec/review pipeline.

## Decision Trace

- Decisions: `059`, `060`, `064`, `066`.
- Non-goals: no new table; no top-level primitive; no second policy engine; no
  dependency additions.
- Allowed scope: CLI helpers/commands, drift-review output, tests, and current
  spec artifact updates.
- Verification: CLI tests, full build, `git diff --check`, dogfood
  `contract-check` and `drift-review` output.
- Drift handling: record a decision before turning this into an import blocker
  or Edictum workflow gate.

## Behavior Contract

- A prompt/spec missing `## Behavior Contract` must fail CLI contract/slop
  review output as incomplete.
- Shape-only Behavior Contract items must fail CLI audit as weak before coverage
  is accepted.
- Non-goal restatements or test-only notes without runtime behavior must fail
  CLI audit as weak.
- Review output missing behavioral tests or explicit evidence for each Behavior
  Contract item must fail as incomplete.
- Missing sections hidden from CLI output must fail tests.
- `spec drift-review` with incomplete coverage must fail with a nonzero exit.
- JSON stdout prefixed by warning text must fail parseability tests.
- YAML project mismatches in path-mode contract checks must be rejected before
  coverage is accepted.

## Slop Review

- Did the implementation satisfy every Behavior Contract item?
- Are tests behavioral, not just shape checks?
- Are missing or invalid inputs loud failures?
- Did any path swallow errors?
- Did it duplicate existing resolution or routing logic?
- Did it add an abstraction with only one caller and no boundary?
- Did it add dead config branches for future features?

## Required Reading

- `packages/cli/src/decision-drift-review.ts`
- `packages/cli/src/commands/spec-drift-review.ts`
- `packages/cli/src/tests/spec-drift-review.test.ts`
- `specs/current/factory-resource-model/P4-DECISION-DRIFT-REVIEW.md`
- `specs/current/factory-resource-model/decision-drift-review-dogfood.md`

## Deliverable

`ductum spec drift-review` and `ductum spec contract-check` make Behavior
Contract and Slop Review coverage visible, with tests proving missing and weak
contracts are reported.

## Verification

```sh
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
