# P1 - Run UI Contract

You are working in `/Users/acartagena/project/ductum`.

## Goal

Make the run UI DTO have one owner so API and dashboard cannot drift.

## Required Work

- Move or centralize `RunUiContract` into a shared contract location.
- API must import the shared type.
- Dashboard must import the shared type.
- Remove duplicate dashboard-local contract definitions where practical.
- Keep API as the owner of canonical presentation values consumed by dashboard.
- Keep fallback behavior only where required for legacy data, and test it.

## Files To Inspect

- `packages/api/src/lib/ui-contract.ts`
- `packages/dashboard/src/api/client.ts`
- `packages/dashboard/src/lib/run-presentation.ts`
- `packages/dashboard/src/lib/derived-status.ts`
- `packages/dashboard/src/components/signal/helpers.ts`

## Behavior Contract

- A run response consumed by dashboard includes canonical `ui`.
- Dashboard uses `run.ui` for status and cost display when present.
- Dashboard does not redefine the run UI DTO shape.
- Missing `ui` fallback is explicit and tested.
- Public API shape stays stable for existing clients.

## Non-Goals

Do not redesign the dashboard.
Do not change database schema.
Do not add a validation dependency.

## Verification

```sh
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- shared contract location
- duplicate definitions removed
- fallback behavior left intentionally
- tests added or updated
- verification commands run
