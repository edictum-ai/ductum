# P9 - Final Dogfood And Onboarding Demo

## Goal

Prove the DB-only Factory Settings model works end to end for fresh onboarding,
settings edits, dispatch, and operator visibility.

## Scope

- Run a clean DB-only `ductum init` flow.
- Start the Factory without `ductum.yaml`.
- Verify Settings reads and writes typed DB/runtime APIs only.
- Verify secrets are write-only and masked after save.
- Verify current-vs-desired runtime markers are truthful.
- Create or use a Project -> Repository/Component -> Spec -> Task -> Attempt
  flow through the accepted operator model.
- Verify no normal UI/API/CLI path depends on YAML Settings.
- Capture demo evidence and final PASS/FAIL notes.

## Files Likely Touched

- `specs/current/post-p9-hardening/factory-settings-source-of-truth/README.md`
- `specs/current/post-p9-hardening/factory-settings-source-of-truth/evidence/**`
- `docs/CLI_ONBOARDING.md`
- `docs/SETUP.md`
- `packages/cli/src/tests/init/**`
- `packages/dashboard/src/tests/settings*.test.tsx`

## Explicit Non-Goals

- Do not implement new features during P9.
- Do not fix unrelated UI polish unless it blocks the demo.
- Do not add Telegram.
- Do not add legacy migration.
- Do not change public Edictum positioning.

## Acceptance Tests

- Fresh Factory has no `ductum.yaml` and starts from SQLite.
- Settings edits persist through typed APIs and survive restart.
- Runtime panel identifies restart-required changes honestly.
- Secret values cannot be read back from API, UI, CLI, logs, events, or evidence.
- A normal work request follows Factory -> Project -> Repository/Component ->
  Spec -> Task -> Attempt.
- Search evidence shows no normal Settings dependency on `/api/settings/config`
  or a YAML editor.

## Verification Commands

```bash
pnpm test
pnpm --filter @ductum/dashboard build
node scripts/check-file-size.mjs
git diff --check
rg -n "settings/config|settings-yaml|yamlPatch|ductum\\.yaml" packages/api packages/cli packages/dashboard/src docs specs/current/post-p9-hardening/factory-settings-source-of-truth
```

## Dependencies On Previous Stages

- P0 through P8 must be complete.

## Risks / Rollback Notes

- Risk: P9 exposes a missed source-of-truth leak. Record it as a blocker, do not
  paper over it with demo-only text.
- Risk: full test suite cost is high. P9 is the closeout gate, so run it anyway.
- Rollback: mark P9 failed and reopen the narrow blocking stage. Do not revive
  YAML as a shortcut.
