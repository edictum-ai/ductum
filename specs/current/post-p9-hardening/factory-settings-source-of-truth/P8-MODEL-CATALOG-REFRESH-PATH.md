# P8 - Model Catalog Refresh Path

## Goal

Create a verified path for adding newly available models to the typed catalog
without stale pricing, harness, or availability claims.

## Scope

- Verify current provider model availability from official provider sources
  before changing concrete model IDs.
- Refresh OpenAI, Anthropic, and Z.AI entries in the model registry and seeded
  DB descriptors.
- Add last-verified metadata and source URLs where missing.
- Keep pricing/rates and scanner source in one canonical model registry path.
- Ensure init seeds the refreshed model catalog.
- Ensure Settings shows newly available models with provider, harness, effort,
  pricing, and availability metadata.

## Files Likely Touched

- `packages/core/src/model-registry-data.ts`
- `packages/core/src/model-registry.ts`
- `packages/core/src/model-pricing.ts`
- `packages/core/src/cost-scanner.ts`
- `packages/api/src/lib/model-catalog.ts`
- `packages/core/src/tests/model-registry.test.ts`
- `packages/core/src/tests/model-pricing.test.ts`
- `packages/dashboard/src/tests/model-picker.test.tsx`
- `specs/current/post-p9-hardening/factory-settings-source-of-truth/README.md`

## Explicit Non-Goals

- Do not add providers beyond the scoped provider list without a new decision.
- Do not blindly choose latest models without source verification.
- Do not change package dependencies.
- Do not claim model availability for a harness unless routing is proven.
- Do not add Telegram-related notification models.

## Acceptance Tests

- Model registry has one canonical entry per supported model.
- Pricing and scanner tests derive from the registry without duplicated stale
  tables.
- Newly available models appear in the API catalog and Settings picker.
- Unsupported model/harness pairs are rejected with clear errors.
- Every changed provider model ID has a source URL and last-verified date.

## Verification Commands

```bash
pnpm --filter @ductum/core test -- model-registry
pnpm --filter @ductum/core test -- model-pricing
pnpm --filter @ductum/api test -- models
pnpm --filter @ductum/dashboard test -- model-picker
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P7 for clarified Agent/Harness/Model config.

## Risks / Rollback Notes

- Risk: provider docs and local subscription catalogs can drift. Record source
  dates and avoid unsupported claims.
- Risk: wrong pricing causes bad budget decisions. Unknown rates should be
  explicit `unmeasured`, not silently mapped to another model.
- Rollback: disable the new model entries rather than deleting historical
  runtime snapshots.
