# D171: Secret detection moves out of legacy migration before its removal

Date: 2026-06-10

## Status

Accepted.

## Context

P3 of `specs/current/post-p9-hardening/factory-settings-source-of-truth/`
removes the legacy YAML migration path, listing `packages/core/src/legacy-migration*.ts`
as files to remove. One of those files, `legacy-migration-secrets.ts`, was not
migration-only: its literal-secret scanners back the live API validation in
`packages/api/src/lib/literal-secrets.ts`, which config-resource and agent
routes use to reject literal secrets in favor of `${ENV_VAR}` references.

Deleting it with the rest of the migration code would have removed live
secret-rejection coverage. Keeping the `legacy-migration-*` name would have
left a normal runtime path labeled as legacy code.

## Decision

The secret scanners move to a permanent neutral module,
`packages/core/src/secret-detection.ts`, before the `legacy-migration*` modules
are deleted:

- `validateNoLiteralSecrets`, `validateEnvReferenceString`, and
  `validateCommandSecrets` keep literal-secret rejection behavior intact. After
  P5, safe references intentionally include both `${ENV_VAR}` and encrypted
  Ductum secret refs such as `secret:<id>`.
- The issue type becomes `SecretScanIssue { path, targetField, message }`
  (formerly `LegacyMigrationIssue` with `legacyPath`), and the target-field
  union becomes `SecretScanTargetField` with unchanged values.
- The migration-era `consequence` option ('migrated' vs 'stored') is removed;
  the rejection message is always "literal secrets are not stored", matching
  the runtime config path that survives P3.
- Test coverage moves to `packages/core/src/tests/secret-detection.test.ts`.

This is not a YAML reintroduction: the module validates values submitted to
typed APIs, not config files.

## Alternatives Rejected

Deleting the scanners with the migration code was rejected because live routes
would lose literal-secret rejection until P5 lands encrypted write-only
secrets.

Keeping the scanners inside a retained `legacy-migration-secrets.ts` was
rejected because P3's acceptance requires legacy migration code to be removed
or isolated from normal API paths, and this code is a normal API path.

Moving the scanners into `packages/api` was rejected because the redaction
primitives they build on (`isSafeEnvReference`, `isSensitivePublicKey`) live in
core's `public-redaction.ts`, and P5's encrypted secret storage will need the
same detection from core.

## Consequences

`packages/api/src/lib/literal-secrets.ts` imports the new names and reads
`issue.path`. The thrown `ValidationError` text is unchanged except that the
migration-path wording ("not migrated") no longer exists anywhere.

P5 should reuse `secret-detection.ts` when it implements encrypted write-only
secret storage, rather than adding a second detection path.
