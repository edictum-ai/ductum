# P0 - Audit And Slices

You are working in `/Users/acartagena/project/ductum`.

## Goal

Audit the harness durability gaps and refine the implementation slices before
runtime changes.

## Required Work

- Read ADR 0164 and this spec README.
- Inspect the current harness/control/reconcile paths.
- Use only Ductum source, explicit product requirements, public protocol
  behavior, and local tests.
- Create or update a decision note if the implementation order needs to
  change.
- Produce a concrete target list for P1-P9.
- Confirm whether any stage requires a database migration before that stage
  starts implementation.
- Confirm which tests can be package-level fakes instead of full end-to-end
  provider sessions.

## Files To Inspect

- `decisions/164-harness-durability-protocol-hardening.md`
- `packages/core/src/dispatcher-support.ts`
- `packages/core/src/dispatcher-spawn.ts`
- `packages/core/src/dispatcher-reconcile.ts`
- `packages/core/src/workflow-command-scope.ts`
- `packages/harness/src/claude.ts`
- `packages/harness/src/codex-app-server-handlers.ts`
- `packages/harness/src/codex-server-request-routing.ts`
- `packages/api/src/routes/run-control.ts`
- `packages/api/src/lib/session-control.ts`

## Non-Goals

Do not implement runtime behavior.
Do not add dependencies.
Do not rewrite the stage prompts unless the audit proves a better split.

## Verification

```sh
pnpm test
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- current durability gaps confirmed
- exact files/modules each later P-stage should own
- migration/no-migration callouts
- fake-vs-real test recommendations
- any stage split changes
- verification commands run
