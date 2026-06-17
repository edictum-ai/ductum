# P6 — Legacy `ductum.yaml` Migration

## Executor

Codex direct.

## Problem

Current `ductum.yaml` mixes factory config, project repos, targets, resources,
agents, startup input, and seed input. The redesign requires one backed-up
cutover where YAML stops driving startup.

## Scope

- Detect legacy `ductum.yaml`.
- Back it up before writing new state.
- Validate the full legacy graph before mutation.
- Merge `projects.*.repos` and `targets` into Repository records without
  duplicates.
- Move target branch defaults to Repository or Project/Repository branch
  settings.
- Move target workflow refs to Project Workflow selection.
- Stop if multiple old targets in one Project reference divergent workflows and
  no unambiguous single Project Workflow can be chosen.
- Create Components only when old target shape clearly maps to a sub-area.
- Import Factory Settings catalogs and Agents.
- Import Projects and project Agent assignments.
- Remap existing Tasks from old target IDs to Repository plus optional
  Component scope.
- Present existing Runs as legacy Attempts without inventing snapshots.
- Write or preserve a minimal receipt/pointer after success.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- P1 public contract facade.
- P2 startup boundary.
- P4 Repository/Component model.
- P5 Attempt facade.
- D98 unified resource apply.
- D101 spec import validation and apply visibility.

## Behavior Contract

Migration is one backed-up cutover. It validates the full legacy graph before
writing. After successful migration, `ductum.yaml` is not the source of truth.

## Non-Goals

- No long dual-read compatibility mode.
- No silent partial import of invalid references.
- No historical record rewrite beyond explicit migration fields.
- No new dependencies.

## Drift Handling

Record a decision before adding dual-read compatibility, partially importing
invalid config, or rewriting historical Runs beyond explicit migration fields.

## Slop Review

Attack:

- duplicate Repositories from `projects.*.repos` and `targets`;
- silently collapsing divergent target workflow refs;
- losing Task target mappings;
- pretending old Runs have full Attempt snapshots;
- leaving `ductum.yaml` authoritative after success.

## Acceptance

- Current `ductum.yaml` migrates or fails before mutation with exact errors.
- After successful migration, `ductum.yaml` no longer drives startup.
- Existing Tasks and Runs remain reachable through redesigned public surfaces.

## Verification

Run migration tests on current fixture/config plus:

```sh
pnpm build
pnpm -r test
git diff --check
```
