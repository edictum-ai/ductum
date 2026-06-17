# P1 - DB Schema, Repo, And API Foundation

## Goal

Add the typed DB-backed foundation for Factory Settings without changing init,
dashboard Settings, or YAML removal behavior yet.

## Scope

- Add DB schema for desired runtime settings if P0 chooses a dedicated table.
- Add DB schema for Secret metadata and encrypted payload storage if P0 has
  locked the key-source model.
- Add repository interfaces for typed providers, models, harnesses, workflows,
  sandboxes, notification channels, runtime settings, and secrets.
- Add typed DTOs and mappers for Factory Settings API responses.
- Add read-only or inert write routes behind the typed API surface where useful
  for contract tests.
- Keep Project, Repository, Component, Agent, Spec, Task, and Attempt as the
  public operator model.

## Files Likely Touched

- `packages/core/src/db-migrations.ts`
- `packages/core/src/types.ts`
- `packages/core/src/resource-types.ts`
- `packages/core/src/factory-settings-types.ts`
- `packages/core/src/factory-settings.ts`
- `packages/core/src/repos/**`
- `packages/api/src/routes/factory-settings.ts`
- `packages/api/src/routes/factory.ts`
- `packages/api/src/lib/factory-settings.ts`
- `packages/api/src/lib/public-output.ts`
- `packages/api/src/tests/factory-settings*.test.ts`
- `packages/cli/src/tests/public-contract-drift.test.ts`

## Explicit Non-Goals

- Do not change `ductum init`.
- Do not remove `ductum.yaml`.
- Do not rebuild the dashboard.
- Do not implement Telegram-specific settings.
- Do not add new CLI commands.
- Do not add dependencies.

## P1 Boundary Notes

- Runtime routes persist desired values only. In P1, write responses keep the
  planned shape but return `current: null`, `restartRequired: false`, and
  `affectedRuntimes: []`; P4 owns authoritative process observation and restart
  markers. Do not infer current runtime values from env defaults in P1.
- Catalog `POST`/`PATCH` routes are inert `501` responses in P1 while the YAML
  editor and generic config-resource routes still exist. Typed catalog writes
  can be enabled only after the source-of-truth conflict is removed.
- Secret key-source metadata is stored internally with encrypted payload records
  but is not part of the public Secret metadata DTO.

## Acceptance Tests

- Fresh DB migrations create the new tables/columns.
- Existing fixtures still start with old paths untouched.
- Typed Settings API responses are redacted and stable.
- Secret read DTOs never contain plaintext fields.
- Public contract drift tests include the new DTO names.

## Verification Commands

```bash
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test -- public-contract-drift
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P0 must lock the API contract, runtime settings storage choice, and secret
  key-source decision.

## Risks / Rollback Notes

- Risk: schema changes are durable. Keep migrations additive and covered by
  fresh DB tests.
- Risk: duplicating generic `config_resources` behavior under new APIs. Prefer
  typed mappers over a second generic blob contract.
- Rollback: because DB migrations are additive, rollback means removing unused
  code paths before release or adding a follow-up cleanup migration only if the
  schema shipped.
