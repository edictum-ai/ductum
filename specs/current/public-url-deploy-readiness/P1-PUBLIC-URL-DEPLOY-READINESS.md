# P1 - Public URL Deploy Readiness

Implement deploy doctor DNS readiness for Telegram public base URLs.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `090`,
  `091`.
- Non-goals: no Telegram API call from doctor; no DNS provider integration; no
  tunnel management; no notification marketplace; no new provider abstraction;
  no credential storage change; no new dependency, table, primitive, Operation,
  WorkOrder, Edictum policy change, or second policy system.
- Allowed scope: CLI deploy doctor DNS check, operator-visible output, tests,
  dogfood records, and evidence.
- Drift handling: record a decision before adding Telegram API calls in doctor,
  DNS provider integrations, tunnel management, dependencies, tables, or policy
  changes.

## Behavior Contract

- CLI `ductum doctor --deploy` must preserve the existing HTTPS failure for
  non-HTTPS public base URLs.
- CLI `ductum doctor --deploy` must preserve the existing loopback rejection
  failure for public base URLs.
- CLI `ductum doctor --deploy` must fail loudly when the public base URL
  hostname cannot be resolved with DNS.
- DNS failure output must include the failing hostname in operator-visible
  output.
- DNS failure output must include an operator-visible fix that points to DNS,
  tunnel, or `publicBaseUrl` configuration.
- DNS lookup errors must not be swallowed; the CLI check must fail loudly with
  a public base URL readiness error.
- A resolvable public HTTPS hostname must preserve the existing OK runtime
  behavior.
- Missing public base URL behavior must preserve the existing failure output.
- Doctor must not call Telegram or mutate webhook state when checking runtime
  readiness.
- Doctor must not print or store bot tokens, webhook secrets, or chat ids in
  output or evidence.
- This slice must preserve notification runtime delivery behavior.
- This slice must preserve NotificationChannel resource ref resolve behavior.
- Edictum gate behavior must preserve existing policy enforcement.
- Existing CLI `ductum telegram webhook set` behavior must be preserved; doctor
  must only report runtime readiness.

## Implementation Notes

- Use Node built-in DNS APIs only.
- Keep `doctor-deploy.ts` at or under the 300 LOC limit by extracting helper
  code if needed.
- Let tests inject a resolver so they do not depend on public DNS.
- Keep the public base URL check read-only.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did DNS failures produce loud operator-visible failures?
- Did the implementation avoid calling Telegram from doctor?
- Did it avoid leaking secrets into output or evidence?
- Did it preserve HTTPS, loopback, missing-URL, and successful URL behavior?
- Did reviewers attack swallowed DNS errors, fake abstractions, dead config,
  future features, and duplicate readiness logic?
- Did it add dependencies, provider branches, marketplace, or policy behavior?

## Verification

```sh
ductum spec contract-check ductum specs/current/public-url-deploy-readiness --path
ductum spec drift-review ductum public-url-deploy-readiness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
