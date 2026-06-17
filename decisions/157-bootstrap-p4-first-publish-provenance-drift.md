---
date: 2026-05-04
status: accepted
deciders: operator (Arnold Cartagena), Codex
related: 135, 155
---

# Decision 157: First npm publish used a documented no-provenance exception

## Context

P4 required `ductum@0.1.0` to publish with npm provenance. The package passed
the pre-publish gate and `npm publish --dry-run --provenance --access public`.

The real publish could not use local provenance. npm returned:

`Automatic provenance generation not supported for provider: null`

npm's current trusted-publishing rules also require the package to already
exist before OIDC trust can be configured, and npm provenance is not generated
from private GitHub repositories even when the package is public.

## Decision

The operator performed the irreversible first publish manually:

- package: `ductum@0.1.0`
- registry: `https://registry.npmjs.org/`
- repository: `git+https://github.com/acartag7/ductum.git`
- integrity:
  `sha512-hsoXYHSfzdvOsknmJoI6LV8vLNAT1JKJkrZBByMndq9CtBQZ5hpJApWkoMb8IhmGKRoiT1nMJqT7YHysQys6oQ==`

This is a P4 drift from the provenance requirement, accepted only for the
empty-name first publish. It is not precedent for future releases.

## Follow-up

After the package exists, configure npm trusted publishing/OIDC for future
versions and revoke the one-time publish token. If the GitHub repository
remains private, future OIDC publishes improve authentication but still will
not produce npm provenance attestations. A provenance guarantee requires a
public source repository or a separate documented release decision.

