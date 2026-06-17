# P19 - Clean Container Onboarding Smoke

## Problem

Ductum still has not proven the fresh agent-first install path in a clean,
non-Arnold-specific environment. A new agent should be able to clone, install,
build, start, bootstrap the operator token, and see actionable next commands
without local hardcoded state.

## Scope

- Write scope: docs, onboarding scripts, examples, and recorded evidence.
- Do not change core dispatch behavior unless the smoke test proves a blocker;
  record that blocker as a follow-up task instead.
- Do not add dependencies.

## Behavior Contract

- The smoke test must start from a clean checkout/factory state.
- `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm serve` must follow
  documented commands.
- First-run token bootstrap must work without manual env edits.
- Missing real credentials must fail with explicit next commands.
- Evidence must include exact commands and outcomes.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

## Decision Trace

- Decision `053`: onboarding evidence belongs in Ductum state.
- Decision `058`: competitors are pattern inputs, not feature checklists.
- Decision `060`: hardcoded local assumptions must be recorded as drift.

## Slop Review

- Attack hidden Arnold-specific paths.
- Attack docs that skip token/bootstrap steps.
- Attack fake smoke tests that reuse the live dirty factory.
