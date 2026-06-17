# P3 - Codex Authorization Read Args

## Problem

Codex app-server sometimes asks to run a simple shell read such as
`cat README.md`. The API authorization bridge classifies that as `Read`, but it
passes the original `{ command }` args to `authorizeTool`. That means Read path
scope validation cannot inspect `file_path`, and protected-path checks that live
on the Bash command path can be skipped for read-shaped shell commands.

## Behavior Contract

- A Codex app-server shell command classified as `Read` for authorization must
  pass `{ file_path }` args to `authorizeTool`.
- Compound read-only shell exploration must still authorize as `Bash`; command
  scope must inspect the full shell text.
- Protected factory DB paths, sidecars, and relative traversal to those paths
  must remain blocked.
- The harness event mapper may emit multiple workflow read successes after a
  successful command, but authorization must stay conservative.
- No new table, dependency, policy engine, or direct DB workflow.

## Decision Trace

- Decision `053`: Ductum records work as specs, tasks, runs, and evidence.
- Decision `054`: harness adapters normalize provider events to canonical
  events without bypassing enforcement.
- Decision `056`: sandbox boundaries are first-class factory resources.
- Decision `060`: decision drift and non-goal breaches must be recorded.
- Decision `108`: execution-integrity and evidence trust are operator-visible.

## Verification

```sh
pnpm --filter @ductum/api test -- harness-loader
pnpm --filter @ductum/core test -- enforce-shell-command shell-read-detection
pnpm --filter @ductum/harness test -- codex-app-server-events
pnpm build
pnpm test
git diff --check
```
