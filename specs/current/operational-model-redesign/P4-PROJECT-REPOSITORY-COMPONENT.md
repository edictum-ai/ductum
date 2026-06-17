# P4 — Project, Repository, And Component Model

## Executor

Codex direct.

## Problem

Current Project and Target shape confuses repository identity, branch defaults,
workflow refs, and task scope. The redesign makes Repository required and
Component optional.

## Scope

- Add or expose Repository as the required source boundary.
- Keep local path deployment-specific and remote URL preferred for identity.
- Support local-only repositories as non-portable.
- Add optional Component as a Repository-local scope.
- Bridge current Target behavior into Repository plus optional Component.
- Project onboarding starts from local path or remote repository.
- Add Git/GitHub readiness representation without over-enforcing local-only
  workflows.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- D53 factory resource model.
- D56 sandbox resource model.
- D57 reference runtime systems.
- D98 unified resource apply.

## Behavior Contract

Repository is the required source boundary. Component is optional and
Repository-local. Current Target behavior may be bridged internally, but normal
public contracts use Repository plus optional Component.

## Non-Goals

- No cross-host lock manager.
- No cloud service.
- No forced Component mapping during onboarding.
- No removal of historical target-backed tasks without migration.

## Drift Handling

Record a decision before making Components required, treating local paths as
portable identity, or adding cross-host locking behavior.

## Slop Review

Attack:

- Project onboarding that requires hand-edited config;
- Components that span repositories;
- Tasks that cannot resolve to Repository scope;
- local-only repositories pretending to be portable.

## Acceptance

- Single-repo and multi-repo Projects both fit.
- Task scope can resolve to Repository plus optional Component.
- Components are optional and Repository-local.
- Existing target behavior is bridged or migrated safely enough for P6.

## Verification

Run relevant core/API/CLI tests plus:

```sh
pnpm build
pnpm -r test
git diff --check
```
