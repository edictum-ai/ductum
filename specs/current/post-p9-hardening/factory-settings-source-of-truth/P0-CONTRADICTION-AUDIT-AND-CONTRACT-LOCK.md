# P0 - Contradiction Audit And Contract Lock

## Goal

Prove the DB-only Factory Settings model is internally consistent before code
changes begin, and record any concrete contradictions as decisions.

## Scope

- Audit current init, start, settings, migration, dashboard, API, CLI, and tests
  for assumptions that conflict with the locked source-of-truth plan.
- Lock the public API/DTO contract names for typed Factory Settings.
- Lock which legacy endpoints are removed, retained as debug-only, or hidden
  during later stages.
- Decide whether desired runtime settings live in the existing Factory config
  JSON or a dedicated table.
- Decide the local secret encryption key source before P5.

## Files Likely Touched

- `specs/current/post-p9-hardening/factory-settings-source-of-truth/README.md`
- `decisions/*.md`
- `docs/contracts/dashboard-ui-api.md`
- `packages/api/src/routes/settings.ts`
- `packages/api/src/routes/factory-settings.ts`
- `packages/cli/src/init/**`
- `packages/cli/src/serve/**`
- `packages/dashboard/src/pages/Settings.tsx`
- `packages/dashboard/src/settings/**`
- `packages/core/src/db-migrations.ts`

## Explicit Non-Goals

- Do not implement DB schema changes.
- Do not remove YAML paths yet.
- Do not change init/startup behavior.
- Do not add dependencies.
- Do not reopen the locked decisions unless the audit finds a concrete
  contradiction with a named file and line.

## Acceptance Tests

- A contradiction inventory exists and every item has one of: stage owner,
  decision needed, or no-op explanation.
- The typed Factory Settings API surface is listed with request/response DTO
  ownership.
- The secret key-source decision is recorded or P5 is explicitly blocked.
- The runtime settings storage choice is recorded.
- A repo-wide `rg` reconciliation maps every normal `ductum.yaml`,
  `/api/settings/config`, `yamlPatch`, `loadServeConfig`, and `seedFromConfig`
  hit to an inventory item, no-op explanation, or historical-only disposition.
- No production code changed in this stage.

## Verification Commands

```bash
rg -n "settings/config|yamlPatch|settings-yaml|ductum\\.yaml|loadServeConfig|seedFromConfig" packages/api packages/cli packages/core packages/dashboard/src packages/harness/src scripts docs README.md ductum*.yaml specs/current/post-p9-hardening/factory-settings-source-of-truth -g '!packages/dashboard/dist/**'
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- None.

## Risks / Rollback Notes

- Risk: the audit becomes a broad refactor plan. Keep it to contradictions that
  directly affect this source-of-truth split.
- Risk: secret storage design drifts into implementation. P0 should decide the
  contract and key source only.
- Rollback: revert only the P0 docs/decision edits.
