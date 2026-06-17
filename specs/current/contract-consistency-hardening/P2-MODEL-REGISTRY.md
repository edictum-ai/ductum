# P2 - Model Registry

You are working in `/Users/acartagena/project/ductum`.

## Goal

Create one canonical model registry for pricing, scanner rates, API model
catalog data, and measured/unmeasured behavior.

## Required Work

- Centralize model metadata used by core cost logic, cost scanner, and API
  model catalog.
- Include `gpt-5.4` and `gpt-5.5`.
- Preserve known pricing behavior.
- Unknown models must be explicit `unmeasured`.
- Remove silent fallback pricing from unknown Codex models to GPT-5.4.
- Add tests for known, unknown, and missing-usage cases.

## Files To Inspect

- `packages/core/src/model-pricing.ts`
- `packages/core/src/cost-scanner.ts`
- `packages/api/src/lib/model-catalog-data.ts`
- `packages/api/src/routes/run-control.ts`

## Behavior Contract

- Adding `gpt-5.6` later should require one registry update.
- API catalog and scanner cannot disagree about whether a model is measured.
- Unknown model cost displays as unmeasured.
- Missing usage data displays as unmeasured.
- No unrelated fallback rate is used for unknown models.

## Non-Goals

Do not fetch live pricing from network.
Do not add a dependency.
Do not change historical run rows.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- registry location
- old duplicated pricing/catalog data removed
- unmeasured behavior
- tests added or updated
- verification commands run
