# Behavior Contract Slop Review

## Intake

Ductum needs better semantic pressure on implementation prompts and reviews.
The next quality risk is shape-correct work that passes narrow tests while
leaving edge-case behavior ambiguous.

## Decision Trace

- Decisions: `059`, `060`, `064`, `066`.
- Non-goals: no new top-level primitive; no second policy engine; no new table;
  no new dependency.
- Allowed scope: markdown prompt requirements, CLI review/check reporting,
  tests, dogfood artifacts, and decision/evidence records.
- Verification: `pnpm --filter @ductum/cli test`, `pnpm build`,
  `git diff --check`, dogfood `spec contract-check` and `spec drift-review`.
- Drift handling: record a decision before making contract checks an Edictum
  gate or blocking spec import.

## Behavior Contract

- A prompt/spec missing `## Behavior Contract` must fail contract-check and
  drift-review as incomplete in visible CLI output.
- Shape-only Behavior Contract items must fail CLI audit as weak before coverage
  is accepted.
- Non-goal restatements or test-only notes without runtime behavior must fail
  CLI audit as weak.
- Review output missing behavioral tests or explicit evidence questions for
  Behavior Contract items must fail as incomplete.
- `spec drift-review` with incomplete coverage must fail with a nonzero exit, so
  PASS is not silently available.
- YAML project mismatches in `spec contract-check --path` must be rejected before
  coverage is accepted.
- JSON stdout prefixed by warning text must fail tests because it is not
  parseable; warning details must remain visible through JSON payload/stderr.

## Slop Review

- Did the implementation satisfy every Behavior Contract item?
- Are tests behavioral, not just shape checks?
- Are missing or invalid inputs loud failures?
- Did any path swallow errors?
- Did it duplicate existing resolution or routing logic?
- Did it add an abstraction with only one caller and no boundary?
- Did it add dead config branches for future features?

## Execution Order

| # | Prompt | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-BEHAVIOR-CONTRACT-SLOP-REVIEW.md](P1-BEHAVIOR-CONTRACT-SLOP-REVIEW.md) | CLI/specs | Contract audit, Slop Review output, tests, dogfood | [x] dogfood run `zQsW-NoQ-OLo` | — |

## Dogfood Record

- File-backed contract check passed for
  `specs/current/factory-resource-model`.
- File-backed contract check passed for
  `specs/current/factory-agent-resource-model`.
- File-backed contract check passed for this spec directory.
- Imported spec `behavior-contract-slop-review` as `xdc67DmXatG8`.
- Imported task `P1-BEHAVIOR-CONTRACT-SLOP-REVIEW` as `pfUuDuRPKXRw`.
- Accepted task as run `zQsW-NoQ-OLo`.
- Recorded decision `KNV0kaTgkoKM`.
- Recorded evidence `oP9vb2uELB0T`, `EvJapZTts7iu`, `WOrJ5x12ha9q`,
  `QiLdtn9BX5Ek`, `G4Cm-tx7DYuB`, `vj1vtRJLMWXN`, `FGm-EF2xxdPj`, and
  `5bfuI7hq3ZNW`.
- Recorded final Claude blocker-review PASS evidence `W9Xq77nPPH4n`.
- Recorded final build/test/contract evidence `7-IwePAq4L_m`.
- Aligned the imported dogfood spec/task rows to the final audited files after
  `spec import` refused to overwrite the existing task-backed spec.
- Generated [slop-review-dogfood.md](slop-review-dogfood.md).
- Recorded Claude adversarial review in
  [claude-slop-review.md](claude-slop-review.md).
- Generated factory resource model contract evidence:
  [contract-check-dogfood.md](../factory-resource-model/contract-check-dogfood.md)
  and
  [contract-check-files-dogfood.md](../factory-resource-model/contract-check-files-dogfood.md).
- Decision drift: none recorded. The existing imported
  `factory-resource-model` DB rows are intentionally reported incomplete
  because they predate Behavior Contract sections; the updated file artifacts
  pass.

## Verification

```sh
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
