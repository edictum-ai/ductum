# P3 - API Parsers

You are working in `/Users/acartagena/project/ductum`.

## Goal

Reduce unsafe external-input casts in the highest-risk API routes.

## Required Work

Replace request-body casts with small parser helpers in:

- `packages/api/src/routes/specs.ts`
- `packages/api/src/routes/tasks.ts`

Target these patterns first:

- `as never` on external input
- unsafe enum casts
- array casts without element validation
- request values entering domain code before validation

## Behavior Contract

- Invalid task status is rejected on create, not only on update.
- Invalid enum-like values return a visible API error.
- Malformed request bodies do not enter domain creation code.
- Parser helpers stay small and local unless reuse is real.

## Non-Goals

Do not rewrite every route.
Do not add a schema validation dependency by default.
Do not change API semantics beyond rejecting invalid input earlier.

## Verification

```sh
pnpm --filter @ductum/api test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- unsafe casts removed or reduced
- validation behavior added
- tests added or updated
- remaining casts intentionally left
- verification commands run
