# P4 - Harness Contracts

You are working in `/Users/acartagena/project/ductum`.

## Goal

Make harness session and event types canonical so Codex, Claude, OpenCode, core,
and telemetry cannot drift.

## Required Work

- Inspect duplicate harness type definitions.
- Pick one owner or a documented import/re-export relationship.
- Apply it to harness adapters and dispatcher/core boundaries.
- Ensure every harness that starts a real session emits canonical
  `session.started` with a string `harnessSessionId`.
- Isolate SDK-specific type escapes such as Claude `as any` behind a small
  adapter/helper where practical.

## Files To Inspect

- `packages/core/src/dispatcher-support.ts`
- `packages/harness/src/types.ts`
- `packages/harness/src/codex-app-server.ts`
- `packages/harness/src/claude.ts`
- `packages/harness/src/opencode.ts`

## Behavior Contract

- There is one canonical shape for harness session start output.
- There is one canonical shape for token usage delta.
- There is one canonical shape for `session.started`.
- Missing `harnessSessionId` fails tests.
- SDK-specific unsafe typing does not leak through the rest of the codebase.

## Non-Goals

Do not change harness runtime behavior unless needed for contract conformance.
Do not add dependencies.
Do not alter tool authorization policy.

## Verification

```sh
pnpm --filter @ductum/harness test
pnpm --filter @ductum/core test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- canonical harness contract owner
- duplicate definitions removed or intentionally retained
- SDK escape hatch isolation
- tests added or updated
- verification commands run
