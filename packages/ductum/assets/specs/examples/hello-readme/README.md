# hello-readme

Minimal bootstrap proof spec used by `ductum init` to prove a fresh global
install can seed Ductum, import work, dispatch a real run, wait for human
approval, and land one merged commit without hand-holding.

This sample asks an agent to append one visible line to `README.md` so the
operator can confirm that dispatch, editing, and verification produced a real
repo diff.

## Decision Trace

- decisions/109: the recovery plan is not done until a fresh machine can
  reach one merged commit in under 10 minutes.
- decisions/060: silent drift is not acceptable; the bootstrap proof has to
  leave operator-visible evidence.

## Behavior Contract

- Missing README mutation evidence must fail loudly in operator-visible diff,
  verification, or approval output.
- Importing this example must preserve truthful spec, task, and run state
  instead of printing fake success or fake approval claims.
- The task must stay tiny: one README line, one diff check, no repo-wide
  rewrite.

## Verification

- `ductum spec import assets/specs/examples/hello-readme --project factory`
- `ductum status`

## Drift Handling

- Record a Ductum decision before expanding this example beyond a single
  README line.

## Slop Review

- Confirm explicit evidence proves the imported task still requires a real
  README diff instead of a diary note about what "would" have changed.
- Attack missing or invalid inputs and confirm missing diff evidence or fake
  approval claims stay loud failures.

## Execution Order

| # | Prompt | Package | Scope | Notes | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-HELLO-README.md](P1-HELLO-README.md) | repo | README.md | Append one README line and verify the diff. | - |
