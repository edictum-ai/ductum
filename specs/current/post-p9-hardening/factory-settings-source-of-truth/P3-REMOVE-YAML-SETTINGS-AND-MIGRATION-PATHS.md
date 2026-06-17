# P3 - Remove YAML Settings And Migration Paths

## Goal

Remove normal YAML Settings, migration, and editor paths after DB-only init is
working.

## Scope

- Remove dashboard dependency on `/api/settings/config`.
- Remove raw YAML Settings editor and YAML patch helpers from normal UI.
- Remove or isolate legacy migration routes and helpers that are no longer part
  of the fresh-start model.
- Remove or isolate legacy YAML-to-DB preflight and seed scripts from normal
  startup/bootstrap paths.
- Remove YAML-aware factory discovery branches after DB-only discovery is
  proven.
- Remove CLI client helpers that call `/api/settings/config` once typed
  Settings APIs are the normal write path.
- Update demo, smoke, and bootstrap test scripts that build or parse
  `ductum.yaml` fixtures.
- Update non-Settings UI copy and source comments that describe normal runtime
  behavior as configured from `ductum.yaml`.
- Update tests that depended on YAML Settings fixtures.
- Keep any remaining historical/debug code clearly labeled and unreachable from
  normal operator paths.

## Files Likely Touched

- `packages/api/src/routes/settings.ts`
- `packages/api/src/lib/settings-config.ts`
- `packages/api/src/lib/settings-target-sync.ts`
- `packages/api/src/lib/legacy-config-preflight.ts`
- `packages/core/src/legacy-migration*.ts`
- `packages/cli/src/api-client.ts`
- `packages/cli/src/serve/legacy-receipt.ts`
- `packages/cli/src/serve/factory-data.ts`
- `packages/cli/src/serve/factory-discovery.ts`
- `scripts/serve-seed*.mjs`
- `scripts/bootstrap-self-test.mjs`
- `scripts/demos/sse-cancel-demo.mjs`
- `scripts/smoke-onboarding.mjs`
- `packages/dashboard/src/pages/Settings.tsx`
- `packages/dashboard/src/agents/AgentWorkforce.tsx`
- `packages/dashboard/src/settings/useEditableSettingsConfig.ts`
- `packages/dashboard/src/settings/yamlPatch.ts`
- `packages/harness/src/*.ts`
- `packages/api/src/index.ts`
- `packages/api/src/lib/deps.ts`
- `packages/cli/src/output.ts`
- `docs/**`
- `packages/dashboard/src/tests/settings*.test.tsx`
- `packages/api/src/tests/settings*.test.ts`
- `packages/core/src/tests/legacy-migration*.test.ts`

## Explicit Non-Goals

- Do not change init again; P2 owns init.
- Do not implement Telegram.
- Do not delete historical decisions/spec records.
- Do not add export/import replacement behavior.
- Do not reintroduce YAML under another name.

## Acceptance Tests

- Dashboard Settings no longer fetches `/api/settings/config`.
- No normal UI route renders a YAML editor.
- API tests do not treat `ductum.yaml` as Settings authority.
- `factory-data.ts` and `factory-discovery.ts` do not use `ductum.yaml` to
  discover normal Factory state.
- `scripts/serve*.mjs` and bootstrap paths do not seed normal Factory state
  from YAML.
- CLI API client no longer exposes normal Settings helpers backed by
  `/api/settings/config`.
- Demo and smoke scripts no longer require `ductum.yaml` fixtures for normal
  onboarding/startup checks.
- No normal UI label or source comment presents `ductum.yaml` as current
  Factory Settings authority.
- Searches for `settings/config`, `yamlPatch`, and Settings YAML fixtures show
  no normal operator dependency.
- DB-only start/init tests still pass.

## Verification Commands

```bash
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test -- settings
pnpm --filter @ductum/cli test -- init
rg -n "settings/config|yamlPatch|settings-yaml|ductum\\.yaml|seedFromConfig" packages/api packages/cli packages/dashboard/src packages/harness/src scripts docs README.md
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P2 must prove clean DB-only init and start before YAML paths are removed.

## Risks / Rollback Notes

- Dangerous stage: this removes compatibility paths. Do not start until P2 has
  a passing DB-only onboarding path.
- Risk: stale tests hide real UI dependency on YAML. Search separately across
  API, CLI, dashboard, and tests.
- Rollback: before release, restore the removed route/UI helpers from the prior
  commit. After release, prefer a DB-backed repair over reviving YAML.
