# hello-readme

Minimal bootstrap proof spec used by `pnpm bootstrap` to prove a fresh
clone can seed Ductum, import work, dispatch a real run, wait for human
approval, and land one merged commit without hand-holding.

## Decision Trace

- decisions/109: the recovery plan is not done until a fresh clone can
  reach one merged commit in under 10 minutes.
- decisions/060: silent drift is not acceptable; the bootstrap proof
  has to leave operator-visible evidence.

## Behavior Contract

- Missing README mutation evidence must fail loudly in operator-visible
  diff, verification, or approval output.
- Importing this example must preserve truthful spec, task, and run
  state instead of printing fake success or fake approval claims.
- The task must stay tiny: one README line, one diff check, no repo-wide
  rewrite.

## Verification

- `pnpm exec ductum spec intake ductum specs/examples/hello-readme --import`
- `pnpm exec ductum spec approve <specId>`
- `pnpm exec ductum queue`

## Drift Handling

- Record a Ductum decision before expanding this example beyond a
  single README line.

## Slop Review

- Confirm explicit evidence proves the imported task still requires a real
  README diff instead of a diary note about what "would" have changed.
- Attack missing or invalid inputs and confirm missing diff evidence or fake
  approval claims stay loud failures.

## Execution Order

| # | Prompt | Package | Scope | Notes | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-HELLO-README.md](P1-HELLO-README.md) | repo | README.md | Append one README line and verify the diff. | - |
