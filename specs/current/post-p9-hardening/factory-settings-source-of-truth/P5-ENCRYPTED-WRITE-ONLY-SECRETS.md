# P5 - Encrypted Write-Only Secrets

## Goal

Add local encrypted secret storage and write-only secret APIs for Factory
Settings.

## Scope

- Implement the P0 key-source decision without adding dependencies.
- Use the D170 local key-file source:
  `<factoryDir>/.ductum/secrets.key`, mode `0600`, generated during DB-only
  init and never stored in SQLite or returned by APIs.
- Add Secret create, update/rotate, delete, list, and test endpoints.
- Store encrypted values and return metadata/masked status only.
- Add secret refs to provider auth, harness config, notification channels, and
  agent secret access.
- Add runtime-only secret resolution for authorized call sites.
- Extend public redaction tests across API, CLI output, dashboard fixtures,
  logs, events, evidence, and exports if any exist.
- Verify init/gitignore posture keeps `ductum.db`, `.ductum/secrets.key`, and
  secret ciphertext/key material out of the initial git commit.

## Files Likely Touched

- `packages/core/src/db-migrations.ts`
- `packages/core/src/types.ts`
- `packages/core/src/repos/**`
- `packages/core/src/public-redaction.ts`
- `packages/api/src/routes/factory-settings.ts`
- `packages/api/src/lib/public-output.ts`
- `packages/api/src/lib/errors.ts`
- `packages/dashboard/src/settings/**`
- `packages/api/src/tests/*secret*.test.ts`
- `packages/core/src/tests/public-redaction.test.ts`

## Explicit Non-Goals

- Do not add external crypto/secret-store dependencies.
- Do not expose plaintext reads after save.
- Do not implement Telegram-specific secret workflows.
- Do not solve cloud KMS or multi-user secret sharing.
- Do not store secrets in YAML or env-ref-only placeholders.

## Acceptance Tests

- Creating a secret stores ciphertext, not plaintext.
- Listing/getting a secret returns metadata and masked status only.
- The local secret key is generated at `.ductum/secrets.key` with `0600`
  permissions and is not stored in SQLite.
- Updating a secret rotates the encrypted value and updates metadata.
- Deleting a secret blocks future runtime resolution.
- Public output redaction catches secret values in all tested surfaces.
- Secret refs validate before provider/harness/agent settings are saved.
- Init does not stage or commit the DB, secret key, or secret material.

## Verification Commands

```bash
pnpm --filter @ductum/core test -- public-redaction
pnpm --filter @ductum/api test -- secret
pnpm --filter @ductum/dashboard test -- settings
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P0 must decide key source.
- P1 must provide schema/repo foundation.
- P4 should define restart markers for secret changes affecting runtimes.

## Risks / Rollback Notes

- Dangerous stage: secret bugs can leak credentials. Treat false positives as
  acceptable and plaintext exposure as a blocker.
- Risk: key loss makes secrets unrecoverable. The chosen key-source model must
  include operator recovery guidance.
- Risk: committing ciphertext and later backing up the key with the DB weakens
  the intended split. Treat accidental git staging of DB/key material as a
  blocker.
- Rollback: disable secret writes and keep existing values unreachable rather
  than adding plaintext export.
