# P1 — Public Contract Facade

## Executor

Codex direct.

## Problem

The redesign uses operator names: Project, Repository, Component, Spec, Task,
Attempt, Agent, Provider, Model, Harness, Workflow, Factory Activity, Repair.
The current code still exposes old names such as Run, Target, and resource in
many public paths.

P1 creates the public contract layer without changing storage behavior yet.

## Scope

- Add shared public DTOs or contract helpers for the operator model.
- Define a public WorkPackage/SpecIntake contract for generators:
  Project -> Repository -> optional Component -> Spec -> Task.
- Make clear that Attempts are runtime records created by Ductum when Tasks
  start, not generator-supplied input records.
- Provide a compatibility adapter from WorkPackage/SpecIntake to the current
  legacy spec import shape.
- Document that Qratum and other generators should target WorkPackage/SpecIntake
  instead of legacy task YAML.
- Add field-path error helpers for redesigned public errors if missing.
- Add compatibility mapping from existing internals to new public names where
  needed.
- Keep internal tables and repositories unchanged.
- Keep dashboard layout unchanged except where needed for contract tests.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- D53 factory resource model.
- D119 dashboard is an operator inbox.
- D135 agent-first control plane contract.

## Behavior Contract

Public contracts use operator names even if internal code still uses legacy
names. WorkPackage/SpecIntake is the external generator contract; legacy YAML is
compatibility input only. WorkPackage/SpecIntake stops at Task; Attempts are
created by Ductum runtime.

## Non-Goals

- No database migrations.
- No `ductum.yaml` migration.
- No dashboard redesign.
- No removal of old internal Run or Target types.
- No new dependencies.

## Drift Handling

Record a decision before adding a new public noun, keeping legacy task YAML as
the recommended generator target, or exposing Run/Target/resource as normal
redesigned names.

## Slop Review

Attack:

- public DTOs that mirror old Run/Target/resource names;
- WorkPackage that cannot express Project -> Repository -> optional Component
  -> Spec -> Task;
- compatibility adapters that mutate runtime state;
- errors without exact field paths.

## Acceptance

- Public contract types can represent Project, Repository, Component, Spec,
  Task, Attempt, Agent, Provider, Model, Harness, and Workflow.
- WorkPackage/SpecIntake is documented as stopping at Task and adapts to the
  legacy spec import shape.
- Errors can identify record type, record ID/name, field path, human label, and
  suggested action.
- Existing tests pass.
- No runtime behavior changes beyond public mapping helpers.

## Verification

Run:

```sh
pnpm build
pnpm -r test
git diff --check
```
