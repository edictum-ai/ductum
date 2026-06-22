# P4 - Provider Harness Doctor

## Decision Trace

- D053/D166: Factory Settings own Providers, Models, Harnesses, Agents, budgets,
  and app settings.
- D054/D057: model, provider, harness, and agent identities are distinct.
- Recent live bug: GLM 5.2 was reachable locally, but the factory API process did
  not preserve provider route env until `ce9ffee`.

## Behavior Contract

- [ ] Doctor must prove model route, token presence, endpoint/base URL, harness
  command, and spawn env for every assigned agent; evidence: API/CLI tests.
- [ ] GLM 5.2 must be checked through the configured Z.ai route, not silently
  through the wrong Anthropic endpoint; evidence: env/route regression test.
- [ ] Missing auth detector support must be explicit and non-blocking only when
  marked deferred; evidence: doctor output test for GitHub Copilot.
- [ ] Doctor output must redact secret values while naming missing references;
  evidence: public-output redaction tests.

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/api build
pnpm -C packages/cli build
pnpm -C packages/api exec vitest run src/tests/public-output-redaction.test.ts src/tests/routes/factory.routes.test.ts
pnpm -C packages/cli exec vitest run src/tests/serve-api-runtime.test.ts
node scripts/check-file-size.mjs
git diff --check
```

When live credentials are present, also run the doctor against the local factory
and report redacted results. Do not print tokens.

## Drift Handling

If a provider requires a new credential model or schema field, record a decision
before adding it. GitHub Copilot auth detector may remain a named deferred gap.

## Slop Review

- [ ] Attack runtime behavior: provider ID, provider model ID, agent name,
  harness key, and account identity must not be conflated.
- [ ] Attack explicit evidence: no token or OAuth value may appear in CLI/API/logs.
- [ ] Attack missing or invalid inputs: wrong endpoint, missing command, missing dist, or
  missing native dependency must be reported before dispatch.

## Objective

Add a factory/provider/harness doctor that can prove the assigned agents are
routable before unattended dispatch.

## Read first

- `packages/cli/src/serve/api-runtime.ts`
- `packages/core/src/model-catalog*` or current model catalog files
- Factory Settings agent/model/harness APIs and tests
- `packages/api/src/lib/model-catalog.ts`
- `packages/cli/src/commands/status-overview.ts`
- Recent commit `ce9ffee fix(cli): preserve provider route env on start`

## Allowed Scope

- Doctor/readiness APIs, CLI output, provider route checks, harness command
  checks, redacted diagnostics, tests.

## Non-goals

- Do not print or persist secret values.
- Do not implement GitHub Copilot auth detection unless the model/API decision
  is already clear.
- Do not dispatch real work from doctor by default.

## Implementation Notes

- Separate static config checks from optional live smoke checks.
- Live smoke checks must be opt-in when they spend tokens.
- For GLM 5.2, verify the configured base URL/model route and a tiny response
  only when live smoke is explicitly enabled.

## Acceptance Criteria

- `ductum doctor` or an equivalent supported CLI/API surface reports each
  assigned agent as ready, blocked, or deferred with exact redacted reasons.
- GLM route/env propagation is covered by regression tests.
- The Qratum factory can run the doctor and show no hidden route bug for GLM.

## Stop Conditions

- A credential or token value would be exposed.
- A live smoke would spend tokens without explicit opt-in.
- Provider/account identity requires a schema/API change not covered by an
  accepted decision.
