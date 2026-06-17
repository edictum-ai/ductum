## Decision Trace

- decisions/109: the bootstrap demo is only real if it lands a visible
  commit in a fresh machine factory.
- decisions/060: silent drift is not acceptable; the operator needs a real
  diff, not a success-looking diary note.

## Behavior Contract

- The task must append exactly one new line to `README.md` and must not
  rewrite unrelated README content.
- If the requested line already exists, the run must fail loudly instead of
  pretending a diff happened.
- Verification must preserve an operator-visible README diff so the bootstrap
  proof shows a real repo mutation.

## Verification

- `git diff -- README.md`
- `tail -n 5 README.md`

## Drift Handling

- Record a Ductum decision before changing this task away from a one-line
  README proof.

## Slop Review

- Confirm explicit evidence shows the patch is exactly one new README line and
  no unrelated edits.
- Attack duplicate or missing README lines and confirm they become loud
  failures instead of fake success claims.

Append the line `Bootstrap proof: hello from Ductum.` to `README.md`.
Place it at the end of the file as a single new line.
After editing, verify the diff shows only that one appended line.
Do not touch any other file.
