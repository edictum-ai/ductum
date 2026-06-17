# D170: Factory Settings storage and local secret key source

Date: 2026-06-10

## Status

Accepted.

## Context

The Factory Settings source-of-truth redesign removes `ductum.yaml` from normal
operation. After init, SQLite is the authoritative local state for Factory
Settings, typed catalogs, runtime preferences, and secret metadata/ciphertext.

P0 for `specs/current/post-p9-hardening/factory-settings-source-of-truth/`
needed two decisions before implementation stages could proceed:

- where desired restart-aware runtime settings live
- what local key source encrypts write-only secrets

Both choices affect dangerous later stages. Runtime storage affects P1/P4
schema and API contracts. The secret key source affects P2 init, P5 secret
storage, backup guidance, and data-loss behavior.

## Decision

Desired restart-aware runtime settings live in a dedicated SQLite table, not in
`factories.config`.

Current effective runtime values are process observations from the running API,
dashboard, dispatcher, harnesses, startup plan, and runtime snapshots. They are
not desired state unless a typed Settings write persists them. Runtime write
responses that affect process state must report whether the value is applied
now, whether restart is required, affected runtimes, current values, and desired
values.

Local Factory installs use a generated 32-byte key file at:

```text
<factoryDir>/.ductum/secrets.key
```

The file is created during DB-only init with mode `0600`. The key is not stored
in SQLite, returned by APIs, written into YAML, or included in normal public
output. SQLite may store key-source metadata such as source type and stable key
id, but not the key material.

The encrypted secret payloads live in SQLite. Secret read APIs return metadata
and masked status only. Runtime paths resolve plaintext only through authorized
secret-resolution paths.

`ductum init` must keep both the Factory DB and `.ductum/secrets.key` out of the
initial git commit by default.

## Alternatives Rejected

Storing desired runtime settings inside `factories.config` was rejected because
the field is too broad for restart-aware current-vs-desired semantics and would
hide process config behind an untyped JSON blob.

Storing the secret key in SQLite was rejected because losing separation between
ciphertext and key weakens the local encrypted store and makes DB copies enough
to recover secrets.

Using only environment variables for persisted secrets was rejected because the
locked model is encrypted local state with typed write-only APIs, not env-ref
placeholders.

Using OS keychain, cloud KMS, or env-only master keys was deferred. Those may be
valid deployment modes later, but they need separate operator UX, backup, and
failure-mode decisions.

## Consequences

Losing `<factoryDir>/.ductum/secrets.key` makes encrypted secrets
unrecoverable. Operator backup guidance must say to back up the key with the DB
when recovery is required, while still keeping both out of source control.

P1 adds the dedicated desired runtime settings storage foundation. P4 exposes
current-vs-desired runtime config and restart markers. P5 implements encrypted
write-only secrets using this local key-file source.

Fresh DB-only init must create the key source and gitignore posture before any
secret values can be saved. Existing external KMS, keychain, or env-only
master-key modes remain out of scope until a later decision accepts them.
