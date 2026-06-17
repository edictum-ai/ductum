# P1 - Public URL DNS Resolution

Implement public DNS record resolution for deploy doctor public URL readiness.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `090`,
  `091`, and `093`.
- Non-goals: no DNS provider integration, tunnel lifecycle manager, Telegram API
  call from doctor, dependency, table, primitive, Operation, WorkOrder, Edictum
  change, or second policy system.
- Allowed scope: CLI doctor DNS resolver semantics, tests, dogfood records, and
  evidence.
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

## Implementation Notes

- Use Node built-in DNS promises APIs only.
- Resolve A and AAAA records independently.
- Keep tests deterministic by injecting resolvers.
- Preserve existing operator-facing check names and fix text.

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

## Verification

```sh
ductum spec contract-check ductum specs/current/public-url-dns-resolution --path
ductum spec drift-review ductum public-url-dns-resolution
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
