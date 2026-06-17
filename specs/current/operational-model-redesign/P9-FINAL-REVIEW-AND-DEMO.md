# P9 — Final Review And Demo Gate

## Executor

Claude/reviewer for review, Codex direct for fixes.

## Problem

The redesign should not be marked complete because tests pass. It must prove
the operator loop is simpler and that legacy state migrates honestly.

## Scope

Review and demo:

- fresh Factory setup through `ductum start`;
- Provider/auth setup or detected existing auth;
- Agent creation or validation;
- Project onboarding from a repository;
- Workflow preset selection;
- Spec creation/import;
- Repository-scoped Task fan-out;
- Attempt start and detail view;
- review/approval or controlled blocker;
- legacy `ductum.yaml` migration path;
- old Run displayed as legacy Attempt if legacy data exists.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 final design review.
- P1-P8 implementation outcomes.
- D131 recovery closeout.
- D158 exit-demo operator harness.

## Behavior Contract

P9 is a gate, not a feature stage. Fix only blocking findings needed to prove
the boring normal path.

## Non-Goals

- No new feature work beyond blocking fixes.
- No Ductum-as-executor until this gate passes.
- No weakening of migration or validation promises.

## Drift Handling

Record a decision before weakening the demo, skipping migration proof, or
declaring Ductum safe to dogfood before the gate passes.

## Slop Review

Attack:

- demos that require hand-edited YAML;
- UI/CLI that still teaches old words;
- migrated state that loses Tasks or historical Runs;
- using Ductum as executor before this gate passes.

## Acceptance

- Reviewer finds no blocking operator-model regressions.
- Demo shows the boring normal path without hand-editing YAML.
- Demo shows `ductum.yaml` is not source of truth after migration/setup.
- UI/CLI public words match the redesign.
- Valid Projects continue when another Project is broken.

## Verification

Run the final agreed gate, at minimum:

```sh
pnpm build
pnpm -r test
git diff --check
```

After P9 passes, Ductum may be used to dogfood later polish stages.
