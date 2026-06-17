# 078 - Sandbox Snapshot Redaction

## Status

Accepted

## Context

Decision `077` persists the resolved `SandboxProfile` on the Run for audit.
`SandboxProfile.spec.credentials` is currently typed as a generic object. Even
though config should use credential refs, the type does not prevent inline
secret-shaped values.

Persisting that field verbatim into every Run would widen the blast radius of a
bad resource.

## Decision

Run sandbox audit snapshots must not copy `SandboxProfile.spec.credentials` or
credential-shaped nested fields verbatim.

The Run snapshot keeps the sandbox id, name, project scope, provider, mode, and
non-credential spec fields. Snapshot creation recursively omits known
credential-shaped keys such as credentials, auth, tokens, passwords, and
secrets. Credential exposure details remain on the
`SandboxProfile` resource until a real sandbox driver and credential resource
model define the safe audit shape.

## Why This Is Not Drift

This narrows the audit snapshot from decision `077` to avoid leaking
secret-shaped fields. It does not add a sandbox driver, credential vault, new
table, policy enforcement, or dependency.

## Non-Goals

- No credential vault.
- No real sandbox driver.
- No policy enforcement change.
- No new table or top-level primitive.
