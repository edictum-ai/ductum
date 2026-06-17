Decision Trace: 052, 053, 054, 055, 056, 058, 060, 079, 080, 081, 108.

## Behavior Contract

- `docs/DEFERRED_WORK_REGISTER.md` must reflect the current factory state, not stale narrative.
- Do not mark a feature done unless the Ductum task/run state and committed code support that status.
- Keep Pi explicit: it is not implemented unless the harness is exported, tested, and usable through normal factory configuration.
- Record remaining work as concrete deferred items or Ductum task names, not vague product wishes.

## Verification

- Run `node packages/cli/dist/index.js queue --json`.
- Run `node packages/cli/dist/index.js operator brief --json`.
- Run `node packages/cli/dist/index.js integrity --json`.
- Run `git diff --check`.

## Drift Handling

- Record a Ductum Decision before expanding scope beyond register/task-status truth.
- Do not add a top-level primitive/table.
- Do not turn Ductum into a second policy engine; Edictum remains the policy boundary.

## Slop Review

- Attack stale "in progress" statuses for work already completed.
- Attack fake completion claims where only an external note exists.
- Attack missing blockers: a blocked item must name the next concrete condition or command.

Task: Refresh the deferred work register after the agent-first dogfood loop, execution-integrity performance merge, stale approval guidance, and shell-read evidence fix.
