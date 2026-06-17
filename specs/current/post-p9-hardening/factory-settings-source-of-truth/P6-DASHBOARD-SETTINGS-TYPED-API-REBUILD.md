# P6 - Dashboard Settings Typed API Rebuild

## Goal

Rebuild the Settings page on typed DB/runtime APIs with no YAML editor and no
stale config display.

## Scope

- Replace YAML-backed Settings hooks with typed API hooks.
- Add panels for Factory, Runtime, Providers/Models, Harnesses, Workflows,
  Sandboxes, Secrets, and Advanced read-only startup facts.
- Use existing Project/Repository/Agent APIs where those records are edited.
- Show current vs desired runtime values and restart-required markers.
- Hide Telegram-specific controls until the deferred Telegram stage.
- Ensure Settings summary counts live DB records, not parsed config text.

## Files Likely Touched

- `packages/dashboard/src/pages/Settings.tsx`
- `packages/dashboard/src/settings/**`
- `packages/dashboard/src/api/client.ts`
- `packages/dashboard/src/api/hooks.ts`
- `packages/dashboard/src/tests/settings*.test.tsx`
- `packages/dashboard/src/tests/model-picker.test.tsx`
- `packages/dashboard/src/tests/token-banner.test.tsx`
- `packages/api/src/tests/public-output-redaction.test.ts`

## Explicit Non-Goals

- Do not add marketing/landing-page UI.
- Do not implement Telegram setup UI.
- Do not add raw JSON/YAML fallback editors.
- Do not add new frontend dependencies.
- Do not change core runtime behavior.

## Acceptance Tests

- Settings page never fetches or displays `ductum.yaml`.
- Saving Settings calls typed APIs and invalidates typed query keys.
- Runtime panel clearly separates current, desired, applied, and restart
  required state.
- Secret UI can set/rotate/test without showing plaintext after save.
- Model/harness/agent controls render from typed catalogs.
- Browser/UI tests verify no overlapping or stale YAML state.

## Verification Commands

```bash
pnpm --filter @ductum/dashboard test -- settings
pnpm --filter @ductum/dashboard test -- model-picker
pnpm --filter @ductum/dashboard build
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P2 for DB-only init.
- P3 for removal of YAML Settings paths.
- P4 for runtime current-vs-desired APIs.
- P5 for secret APIs.

## Risks / Rollback Notes

- Risk: a partial UI rebuild can leave Settings unable to edit live state. Keep
  panels shippable one at a time behind typed API tests.
- Risk: secret fields can accidentally echo values in form state after save.
  Clear plaintext inputs after successful writes.
- Rollback: keep old page behind no normal route only until P6 passes; do not
  restore YAML as the default UI.
