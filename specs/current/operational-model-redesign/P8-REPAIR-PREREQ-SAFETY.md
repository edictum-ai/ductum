# P8 — Repair, Prerequisites, Secrets, And Safety

## Executor

Codex direct.

## Problem

The redesigned flow only works if readiness failures are caught before Attempts
and repair does not require database edits, YAML edits, or reading logs for
secrets.

## Scope

- Add UI-first repair flows with CLI support.
- Group repair items by what they block: Factory setup, Project readiness,
  Repository readiness, Agent readiness, Provider auth, Workflow validity, Spec
  start, Attempt recovery, migration.
- Add prerequisite checks for Git, GitHub auth, provider auth, writable Factory
  data dir, local app port, and selected Harness requirements.
- Ensure secrets do not appear in config, logs, evidence, exports, or public
  JSON.
- Preserve supply-chain gates and exact-pin rules.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- D52 supply-chain rules.
- D135 agent-first control plane contract.
- D136-D145 operational hardening bundle.

## Behavior Contract

Repair is UI-first with CLI support. Prerequisite failures block before Attempt
start and point to exact records and fields.

## Non-Goals

- No new provider auth mechanisms unless already required by earlier stages.
- No service manager implementation beyond explicit existing scope.
- No new dependencies without a decision.
- No cloud coordination service.

## Drift Handling

Record a decision before adding dependencies, changing secret storage, exposing
secret values, or adding cloud coordination.

## Slop Review

Attack:

- secret-bearing values in output;
- prerequisite failures that happen after Attempt start;
- repair paths that require DB or YAML edits;
- broken Projects blocking valid Projects.

## Acceptance

- Broken Projects disable dispatch only for that Project.
- Repair items show exact fields and suggested actions.
- Prerequisite failures block before Attempt start.
- Secret-bearing values are redacted or omitted from public output.

## Verification

Run relevant tests plus:

```sh
pnpm build
pnpm -r test
git diff --check
```
