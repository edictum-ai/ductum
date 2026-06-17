# P5 — Spec, Task, And Attempt Runtime Boundary

## Executor

Codex direct.

## Problem

The redesigned public contract uses Attempt instead of Run. Attempts need
runtime snapshots and immutable start fields, while legacy Runs must remain
readable as partial historical Attempts.

## Scope

- Add public Attempt facade over current Run internals.
- New Attempts snapshot full runtime context before start.
- Active Attempts ignore later config changes.
- Queued Tasks use latest valid config when they start, except Workflow edits
  that were explicitly resolved for queued work.
- Agent rotation, fix work, and review work create new Attempts rather than
  mutating live Attempt identity.
- Multi-repository Specs show Repository-scoped Task fan-out.
- Legacy Runs are surfaced as legacy Attempts with partial snapshots.
- WorkPackage/SpecIntake becomes the preferred Spec creation contract for
  generators, stops at Task, and routes into this runtime boundary.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- P1 WorkPackage/SpecIntake contract.
- D27 one WorkflowRuntime per run.
- D82-D84 workflow profile runtime and snapshots.
- D135 agent-first control plane contract.

## Behavior Contract

Attempt is the public execution try. New Attempts snapshot full runtime context
before start. Legacy Runs are displayed as legacy Attempts without invented
snapshot fields. WorkPackage/SpecIntake creates or updates Specs and Tasks;
Ductum creates Attempts when Tasks start.

## Non-Goals

- No fake backfill of snapshot fields old Runs never captured.
- No removal of old run tables in this stage.
- No dashboard rewrite beyond what is needed for public facade tests.
- No workflow semantic changes.

## Drift Handling

Record a decision before changing Attempt immutability, inventing new public
Attempt lifecycle stages, or mutating live Attempt identity during rotation,
fix, or review.

## Slop Review

Attack:

- fake backfill of legacy Run snapshots;
- active Attempts following later config changes;
- agent rotation that mutates an active Attempt;
- multi-repo Specs displayed as unrelated flat Attempts;
- generators still targeting legacy task YAML instead of WorkPackage.

## Acceptance

- New Attempt records expose runtime snapshot details.
- Start snapshot fields are immutable after start.
- Legacy Runs remain readable and are marked/handled honestly as partial.
- Public JSON for redesigned paths uses Attempt terminology.

## Verification

Run relevant core/API/CLI/dashboard tests plus:

```sh
pnpm build
pnpm -r test
git diff --check
```
