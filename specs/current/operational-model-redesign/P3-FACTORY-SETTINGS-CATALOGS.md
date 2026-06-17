# P3 — Factory Settings Catalogs

## Executor

Codex direct.

## Problem

The current generic resource surface leaks into operator setup. The redesign
uses Factory Settings with concrete nouns.

## Scope

- Model Factory Settings public records for Providers, Models, Harnesses,
  Workflows, Agents, sandboxes, notifications, and budgets.
- Provider means auth/model vendor.
- Model means Ductum model record with provider and provider model ID.
- Harness means runner adapter.
- Agent means composed worker: name, role/system prompt, Harness, Provider,
  Model, settings.
- Validate Agent compatibility before save.
- Ship at least one built-in validated Workflow preset because onboarding
  depends on it.
- Keep existing storage if needed behind a public Factory Settings facade.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- D53 factory resource model.
- D54 harness plugin model.
- D56 sandbox resource model.
- D57 reference runtime systems.
- D72 model resource effort authority.
- D80 harness resource runtime.

## Behavior Contract

Factory Settings is the normal operator surface for global configuration. The
generic resource store may remain internally, but the normal public path uses
concrete nouns.

## Non-Goals

- No new providers.
- No new harnesses.
- No workflow enforcement changes.
- No marketplace.
- No new dependencies.

## Drift Handling

Record a decision before adding new Provider/Harness semantics, changing
workflow enforcement, or exposing the generic resource surface as the normal
operator path.

## Slop Review

Attack:

- Agent save paths without compatibility validation;
- Model IDs that blur Ductum identity and provider model ID;
- missing built-in Workflow preset;
- normal UI/CLI copy that says resource.

## Acceptance

- Operators can manage concrete Factory Settings without seeing generic
  resources as the normal surface.
- Invalid Provider/Model/Harness/Agent combinations cannot be saved as enabled
  config.
- Model identity is clearly separate from provider model ID.
- At least one built-in Workflow preset is available and validates.

## Verification

Run relevant API/CLI tests plus:

```sh
pnpm build
pnpm -r test
git diff --check
```
