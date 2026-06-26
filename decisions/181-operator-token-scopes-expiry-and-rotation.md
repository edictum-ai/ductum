---
date: 2026-06-26
status: accepted
deciders: Codex, legacy issue #27 follow-up
related: 154, 156, 174, 178, 180
---

# Decision 181: Operator token scopes, expiry, and rotation

## Context

Legacy issue #27 identifies a deployment seam: one static operator token
currently authorizes read access, approvals, cancellations, and settings
writes. That is tolerable for a single local operator, but it is too broad for
hosted, multi-operator, or browser-mediated deployments.

The imported issue body is brief, and the original GitHub issue was not
readable from this run (`https://github.com/edictum-ai/ductum/issues/27`
returned 404). This decision therefore stays fail-closed and limits itself to a
token-scope, expiry, and rotation contract. It does not assume unstated product
requirements or implementation details.

Current code reinforces the seam:

- `packages/api/src/middleware/operator-auth.ts` accepts one operator secret via
  header, bearer token, query string, or cookie for broad `/api/*` access.
- Browser handoff/session flows still end at the same operator token cookie.
- D174 already recorded that agent MCP access should prefer a scoped per-run
  control token instead of the wider operator token.

## Decision

### 1. Keep operator tokens separate from harness control tokens

This decision covers **operator-facing authentication only**.

- Per-run control tokens remain the auth mechanism for harness/MCP/session
  control paths.
- `authorize_tool` and other harness-internal gates stay outside the operator
  token scope model (C1/C3 still hold).
- No future operator scope may be treated as authority for a different run's
  MCP/control surface.

### 2. Adopt an explicit operator scope vocabulary

Future operator credentials carry an explicit set of scopes. The minimum
vocabulary is:

- `operator.read`
  - Read-only operator surfaces: list/detail/status/watch/history/SSE and other
    non-mutating API reads.
- `operator.run.intervene`
  - Mutating run/task lifecycle actions that do **not** approve completion:
    cancel, pause, retry, resume, reconcile, repair, or comparable operator
    intervention.
- `operator.run.approve`
  - Approval/deny/finalization actions that can advance a run across the human
    approval boundary, including merge/push-capable unattended approval entry
    points.
- `operator.settings.write`
  - Factory/project settings writes, secret/config resource writes, agent or
    provider config writes, and other durable control-plane configuration
    mutations.
- `operator.tokens.manage`
  - Mint, rotate, revoke, list, or inspect operator credentials and browser
    sessions.

Rules:

- `operator.run.approve` does **not** imply `operator.settings.write`.
- `operator.settings.write` does **not** imply `operator.run.approve`.
- `operator.run.intervene` does **not** imply `operator.run.approve`.
- `operator.tokens.manage` does not implicitly grant settings or approval.
- Read access is not inferred from a write scope in storage; authorization may
  layer `operator.read` automatically at evaluation time, but the persisted
  scope set must stay explicit.

If an endpoint cannot be mapped unambiguously to one of these scopes, Ductum
must block it rather than silently falling back to a broader token.

### 3. Treat the current static token as a legacy bootstrap root

The existing static operator token is retained only as a compatibility path and
is modeled as a **legacy bootstrap root credential**.

- In local-first mode it may continue to unlock the current all-powerful
  surface until scoped tokens ship.
- It is the credential used to mint narrower operator credentials and browser
  sessions during migration.
- It must not be reused for agent MCP URLs or other agent-facing transport.
- Hosted/protected deployments should treat this root credential as a bootstrap
  secret, not as the normal day-to-day browser or automation credential.

### 4. Define token classes by lifetime and audience

Operator auth splits into four classes:

1. **Bootstrap root token**
   - Audience: local operator setup and recovery.
   - Scope shape: equivalent to all operator scopes.
   - Storage direction: secret file or secret manager only; never browser
     storage and never embedded in long-lived URLs.

2. **Scoped operator API token**
   - Audience: CLI, trusted operator tooling, or protected automation that acts
     as an operator.
   - Scope shape: explicit subset of the scope vocabulary above.
   - Normal credential for protected non-browser API access.

3. **Browser session token**
   - Audience: dashboard/browser tabs.
   - Scope shape: copied from or narrower than the parent operator credential.
   - Representation direction: opaque session id or signed session artifact,
     not the raw operator API token value in the cookie.

4. **One-time handoff/pair token**
   - Audience: browser bootstrap/pairing only.
   - Scope shape: no independent authority; it exists only to mint a browser
     session from a stronger parent credential.
   - Single-use by definition.

### 5. Expiry direction

Expiry is mandatory for every operator credential class except the local
bootstrap root compatibility path.

- **One-time handoff/pair tokens:** single-use, 60-second TTL.
- **Browser sessions:** short-lived; target 8-hour absolute expiry with a
  shorter idle timeout once session tracking exists.
- **Scoped operator API tokens:** explicit expiry on creation; default 30 days,
  maximum 90 days.
- **Bootstrap root token:** legacy local-only exception while the static-token
  path exists. Hosted/protected deployments should require an explicit expiry or
  operator-managed rotation schedule for the root credential too.

Expired credentials fail closed. Ductum must not "refresh" an expired token by
continuing to accept the old secret.

### 6. Rotation direction

Scoped operator credentials are rotatable records, not immortal shared strings.
The storage model direction is:

- stable token id / public prefix for operator display;
- secret value shown only at mint time;
- persisted salted hash, never plaintext token value;
- `issuedAt`, `expiresAt`, `lastUsedAt`, `revokedAt`, `replacedByTokenId`;
- label/owner metadata for auditability;
- explicit scope set stored with the token record.

Rotation semantics:

- Rotation means **mint successor first, then revoke predecessor**.
- Ductum may allow a bounded overlap window for operator API tokens to avoid
  lockout during rollout, but the overlap must be explicit and time-bounded.
- Revoking a parent operator token invalidates future browser-session refreshes
  derived from it; existing browser sessions should be invalidated immediately
  when practical, and otherwise on next validation.
- One-time handoff tokens are consumed, not rotated.

### 7. URLs are not a durable operator-token transport

The `ductum_operator_token` query pattern is a compatibility path only.

- Long-lived operator API tokens must move to header or opaque browser-session
  transport.
- Query-string operator auth should be retired for all durable operator
  credentials because URLs leak through history, logs, and process listings.
- The only acceptable URL-borne token after migration is the short-lived,
  single-use handoff/pair token.

### 8. Approval remains the highest-risk scope

Because approval can merge or push, `operator.run.approve` is the most
privileged normal operator scope and must stay narrower than generic
intervention or settings writes.

- Unattended approval endpoints must require `operator.run.approve`.
- If approval can merge or push, workflow/CI/review gates from D178 still apply
  in addition to scope checks.
- Missing or ambiguous scope state is blocking, never permissive.

## Consequences

- Ductum now has a design contract for breaking the single static operator
  secret into scoped, expiring, rotatable credentials.
- Browser auth direction is now explicit: stop storing the raw operator token as
  the steady-state session cookie; use an opaque scoped session instead.
- The existing static token remains only as a migration/bootstrap seam, not the
  long-term auth shape.
- A later implementation stream must add the route-to-scope matrix, token
  record storage, hashed persistence, browser-session invalidation, and CLI/API
  surfaces for mint/rotate/revoke.
