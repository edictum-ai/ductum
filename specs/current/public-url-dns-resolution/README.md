# Public URL DNS Resolution

## Intake

The Cloudflare route for `factory.arnoldcartagena.com` was added and public DNS
returned A/AAAA records, but `ductum doctor --deploy` still failed because it
used `dns.lookup`, which follows the local system resolver cache.

## Grill Questions

- What behavior is wrong? Doctor reports public URL DNS failure after public DNS
  records exist.
- What should doctor prove? That public DNS has at least one usable A or AAAA
  record for the configured hostname.
- Should doctor manage DNS or tunnels? No. It only reports readiness.
- Should doctor call Telegram? No. Webhook mutation stays in
  `ductum telegram webhook set`.

## Decisions

- Add decision `093` for public DNS resolver semantics.
- Use Node DNS record resolution for A and AAAA records.
- Keep existing URL shape, HTTPS, loopback, and missing URL behavior.
- Fail loudly only when both A and AAAA lookups fail.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `090`,
  `091`, and `093`.
- Non-goals: no DNS provider integration, tunnel lifecycle manager, Telegram API
  call from doctor, dependency, table, primitive, Operation, WorkOrder, Edictum
  change, or second policy system.
- Allowed scope: CLI doctor DNS resolver semantics, tests, dogfood records, and
  evidence.
- Verification: `ductum spec contract-check ductum specs/current/public-url-dns-resolution --path`,
  `ductum spec drift-review ductum public-url-dns-resolution`,
  `pnpm --filter @ductum/cli test`, `pnpm build`, `git diff --check`, and
  adversarial slop review.
- Drift handling: record a new decision before adding provider integration,
  tunnel management, Telegram API calls, dependencies, or policy behavior.

## Behavior Contract

- CLI public URL readiness must preserve non-HTTPS URL failure behavior.
- CLI public URL readiness must preserve loopback hostname failure behavior.
- CLI public URL readiness must preserve missing public base URL failure
  behavior.
- CLI public URL readiness must resolve public A records through DNS resolver
  APIs.
- CLI public URL readiness must resolve public AAAA records through DNS resolver
  APIs.
- CLI public URL readiness must pass when either A or AAAA records resolve.
- CLI public URL readiness must fail loudly when both A and AAAA records fail.
- DNS failure output must remain operator-visible and include the hostname.
- DNS failure output must not leak Telegram tokens, webhook secrets, or chat ids.
- Doctor runtime behavior must not call Telegram or mutate webhook state.
- This slice must not add dependencies, provider branches, tables, primitives,
  or policy behavior.

## Slop Review

- Did every Behavior Contract item get behavioral tests or explicit evidence?
- Are behavioral tests present for A-only, AAAA-only, and both-fail DNS paths?
- Did reviewers attack shape-correct but behavior-empty DNS checks?
- Did public DNS success stop depending on local getaddrinfo cache?
- Did failures stay loud and operator-visible?
- Did HTTPS, loopback, missing URL, and failure behavior stay covered?
- Did the implementation avoid Telegram calls, provider branches, tunnel
  management, dependencies, and policy behavior?
- Did it avoid swallowing both A and AAAA lookup errors?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-PUBLIC-URL-DNS-RESOLUTION.md](P1-PUBLIC-URL-DNS-RESOLUTION.md) | cli | Public DNS record resolver, tests, evidence | [x] | - |

## Dogfood Record

- Imported spec: `-ZOIMhXnuXm2`.
- Imported task: `SodpcVAOybjZ`.
- Run: `7M-41uquT00K` auto-dispatched to `glm`.
- Decision record: `n0Ax3Ir-FvtP`.
- Spec audit evidence: `eGMyki9XWkBL`.
- Verification evidence: `e_H1li0zg9e-`.
- Adversarial review: Claude PASS; added a wired A/AAAA failure-detail test
  after review finding F2.

## Verification

```sh
ductum spec contract-check ductum specs/current/public-url-dns-resolution --path
ductum spec drift-review ductum public-url-dns-resolution
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
