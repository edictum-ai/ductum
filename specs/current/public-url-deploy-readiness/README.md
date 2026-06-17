# Public URL Deploy Readiness

## Intake

`ductum doctor --deploy` currently marks the Telegram public base URL OK when it
is HTTPS and non-loopback. The live webhook setup then failed because Telegram
could not resolve `factory.arnoldcartagena.com`. Deploy readiness needs to catch
an unresolvable public hostname before webhook setup.

## Grill Questions

- What evidence proves the gap? `ductum telegram webhook set` failed with
  `Bad Request: bad webhook: Failed to resolve host`.
- Should doctor call Telegram? No. Doctor should not spend bot secrets or
  mutate webhook state.
- What check is small and useful? Resolve the public base URL hostname using
  Node DNS and fail if it cannot resolve.
- What remains unchanged? Notification runtime, channel resources, Telegram
  send semantics, webhook install command, Edictum policy, and dispatch.

## Decisions

- Add decision `091` for deploy public URL DNS readiness.
- Keep existing HTTPS and loopback checks.
- Add DNS resolution to deploy doctor before marking public base URL ready.
- Report DNS failures as operator-visible deploy blockers.
- Do not add dependencies or Telegram API calls.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `090`,
  `091`.
- Non-goals: no Telegram API call from doctor; no DNS provider integration; no
  tunnel management; no notification marketplace; no new provider abstraction;
  no credential storage change; no new dependency, table, primitive, Operation,
  WorkOrder, Edictum policy change, or second policy system.
- Allowed scope: CLI deploy doctor DNS check, operator-visible output, tests,
  dogfood records, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/public-url-deploy-readiness --path`,
  `ductum spec drift-review ductum public-url-deploy-readiness`,
  `pnpm --filter @ductum/cli test`, `pnpm build`, `git diff --check`, and
  adversarial slop review.
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

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did DNS failures produce loud operator-visible failures?
- Did the implementation avoid calling Telegram from doctor?
- Did it avoid leaking secrets into output or evidence?
- Did it preserve HTTPS, loopback, missing-URL, and successful URL behavior?
- Did reviewers attack swallowed DNS errors, fake abstractions, dead config,
  future features, and duplicate readiness logic?
- Did it add dependencies, provider branches, marketplace, or policy behavior?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-PUBLIC-URL-DEPLOY-READINESS.md](P1-PUBLIC-URL-DEPLOY-READINESS.md) | cli | Deploy doctor DNS readiness, output, tests, evidence | [x] | - |

## Dogfood Record

- Imported spec: `2l0d1I8K_OFE`.
- Imported task: `ujYU01rilO5a`.
- Run: `2u7Ws5v7DdGd` auto-dispatched to `glm`.
- Decision record: `7TJl_FiykwWL`.
- Spec audit evidence: `XvV_PNwB7gqg`.
- Verification evidence: `LptnZHzntiNa`.
- Adversarial review: Claude produced no output after 120 seconds and was
  terminated; local slop review found no blocker.

## Verification

```sh
ductum spec contract-check ductum specs/current/public-url-deploy-readiness --path
ductum spec drift-review ductum public-url-deploy-readiness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
