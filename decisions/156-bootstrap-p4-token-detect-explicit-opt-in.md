---
date: 2026-05-03
status: accepted
deciders: Codex
related: 135, 149, 154, 155
---

# Decision 156: Operator-token auto-detect is gated behind explicit serve opt-in

## Context

D154 called out the pre-P4 `/api/internal/operator-token-detect` helper as a
token probe risk. The route was loopback-only, but it was unauthenticated and
returned the operator token to dashboard code whenever the API was bound to
loopback. That was acceptable as a local P0-P3 convenience, but not as a
default behavior in a globally installed package.

The helper was not deeply entangled. The only product caller is the dashboard
token banner, and the API route is isolated in `packages/api/src/app.ts`.

## Decision

Keep the helper but make it explicit opt-in:

- The API route now requires `DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT=1`.
- It still refuses non-loopback binds.
- `ductum serve` and `ductum start` default to not setting the env var.
- Operators can pass `--allow-token-detect` to enable it for a local process.
- The dashboard copy says auto-detect only works when the local API was started
  with explicit opt-in.

The redesigned `/welcome` handoff does not use this route. It mints a
short-lived handoff token from the protected API and exchanges it server-side.

## Consequences

The published package does not silently preserve the old probe path. Local
operators still have a recovery convenience when they intentionally start a
loopback API with `--allow-token-detect`.

`ductum serve` and `ductum start` never overwrite an existing operator token.
They read the token from `--operator-token`, the environment, `.env.local`, or
`~/.ductum/operator-token` and fail if no usable token is available.
