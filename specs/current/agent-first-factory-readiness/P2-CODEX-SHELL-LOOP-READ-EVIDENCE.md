# P2 - Codex Shell Loop Read Evidence

## Problem

Dogfood run `JwKgk5I75Mpg` stayed in `understand` after Codex app-server
read the root `README.md` through a shell command that also used a read-only
`for` loop over decision files. The adapter recorded the command as `Bash`
with no `Read` evidence, so Edictum did not advance the workflow.

## Behavior Contract

- A read-only Codex app-server shell command that reads `README.md` and then
  loops over documentation files must produce canonical `Read` evidence for
  `README.md`.
- Mutating shell control flow must remain classified as `Bash` and must not
  produce read evidence.
- The classifier must stay shared by core enforcement and harness event
  mapping.
- No direct database edits, no new tables, no new policy engine, and no new
  dependencies.

## Decision Trace

- Decision `053`: work remains represented as specs, tasks, runs, and
  evidence.
- Decision `054`: harnesses emit canonical events; app-server details stay in
  the adapter.
- Decision `060`: this dogfood mismatch is recorded explicitly instead of
  silently accepting stage drift.
- Decision `108`: execution-integrity and operator-visible evidence are trust
  surfaces.

## Verification

```sh
pnpm --filter @ductum/core test -- shell-read-detection
pnpm --filter @ductum/harness test -- codex-app-server-events
pnpm --filter @ductum/api test -- harness-loader
pnpm build
git diff --check
```
