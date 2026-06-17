# P5 - Conformance Gates

You are working in `/Users/acartagena/project/ductum`.

## Goal

Add drift-catching tests so contract inconsistencies fail before they reach the
dashboard or operator.

## Required Work

Add conformance tests proving:

- API run responses include canonical `ui`.
- Dashboard consumes canonical `ui`.
- Dashboard fallback behavior is explicit and limited.
- API model catalog and cost scanner use the same model registry.
- Unknown models are unmeasured, not priced with unrelated fallback rates.
- Harnesses emit `session.started` with string `harnessSessionId`.
- Public dashboard-facing API responses do not expose raw domain run models
  where a DTO exists.

## Non-Goals

Do not add snapshot tests that simply bless current bad output.
Do not add broad end-to-end tests if package-level tests catch the drift more
directly.
Do not add dependencies.

## Verification

```sh
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test
pnpm --filter @ductum/core test
pnpm --filter @ductum/harness test
pnpm test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- conformance tests added
- drift classes now covered
- remaining uncovered risks
- verification commands run
