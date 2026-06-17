---
date: 2026-05-04
status: accepted
deciders: operator (Arnold Cartagena), Claude (Opus 4.7)
related: 109, 130, 131, 132, 135, 158
---

# Decision 159: P5 blocker found — API startup guard now reads `~/.claude/.credentials.json`

## Context

P5's clean-VM exit demo (Lima VM, fresh user, no env vars, real PKCE)
reached the `Scaffolded` step and then stuck at "Starting local Ductum
API." `~/ductum/factory/.ductum/logs/api.log` showed:

```
[startup] error: Anthropic auth is required for claude-agent-sdk agents:
  set ANTHROPIC_OAUTH_TOKEN, ANTHROPIC_AUTH_TOKEN,
  CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY
```

The PKCE flow had completed successfully and written
`~/.claude/.credentials.json` with the standard `claudeAiOauth` payload
(`accessToken`, `expiresAt`, `refreshToken`). The credentials existed;
the API's startup validator just couldn't see them.

D132 widened the API guard at `packages/api/src/validate-env.ts` to
accept `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN`, and `ANTHROPIC_API_KEY` env vars. It did **not**
read `~/.claude/.credentials.json`, even though that's where
`ductum login`'s PKCE flow (D132 itself) writes credentials and where
`scripts/bootstrap-support.mjs` already detects them. The two surfaces
disagreed about what counts as "Anthropic auth is configured."

This is the named blocker D158 anticipated:

> If the published package cannot record the typed evidence row, the
> honest result is a named P5 blocker, not a silent pass.

The package was 0.1.0; this fix ships in 0.1.1.

Evidence captured at the failure shape:

- `specs/current/bootstrap-redesign/evidence/p5-blocker-api.log`
- `specs/current/bootstrap-redesign/evidence/p5-blocker-pane.txt`
- `specs/current/bootstrap-redesign/evidence/p5-blocker-creds-shape.json`

## Decision

`packages/api/src/validate-env.ts` now mirrors
`scripts/bootstrap-support.mjs`'s ambient-credential detection:

1. After the env-var check, walk the same paths as
   `claudeCredentialPaths()`:
   - `~/.claude/.credentials.json`
   - `$CLAUDE_CONFIG_DIR/credentials.json`
2. For each, parse the JSON and look (recursively) for any non-empty
   string under the keys `ANTHROPIC_OAUTH_TOKEN`,
   `CLAUDE_CODE_OAUTH_TOKEN`, `accessToken`, `access_token`,
   `oauthToken`, `refreshToken`, `refresh_token`.
3. If any path provides a populated token, the guard accepts.

The error message is updated to mention `ductum login` as a
recognized acquisition path, so operators who reach the guard without
auth get a precise next step.

The fix is intentionally a copy of the bootstrap-support pattern, not a
shared module. A shared `@ductum/core/auth-detect` extraction is a
follow-up; for now parity is enforced by inspection and the four new
tests in `packages/api/src/tests/validate-env.test.ts`.

## Why this fix instead of others considered

- **Workaround by exporting the token** (extract `accessToken` from
  `.credentials.json`, set `CLAUDE_CODE_OAUTH_TOKEN` before init):
  rejected. This masks the bug rather than fixing it. D158's slop-review
  attacks "demos that fudged the wall-clock or skipped a phase."
- **Patch the global install in place**: rejected. Demonstrates the
  rest of the demo works on 0.1.0 but does not close P5; the published
  package is still broken.
- **Extract a shared `@ductum/core/auth-detect`**: deferred. Bigger
  change for a hotfix; parity-by-inspection is sufficient until a third
  surface needs the same logic.

## How to apply

- Bump `packages/cli/package.json` (the published `ductum` package) to
  `0.1.1`.
- Build, run pre-publish gate, publish to npm.
- D157's no-provenance-attestation drift continues to apply for 0.1.1
  while the source repo remains private. Future trusted-publisher /
  OIDC setup is a separate decision once the repo's public/private
  posture is settled.
- Re-run the P5 demo on the same Lima VM (clean ductum + ~/.claude
  state) with `--package ductum@0.1.1`.

## Verification

- `pnpm --filter @ductum/api test -- validate-env.test`: 11 tests pass
  (8 prior + 3 new D159 cases — positive ambient detection, malformed
  JSON, empty-string tokens). Mocked `homedir()` to isolate the dev
  machine's real `~/.claude/.credentials.json` from the test fixtures.
- `pnpm -r test`: 1685 tests pass across all packages.
- `pnpm -r build`: clean.
- `node scripts/check-file-size.mjs`: green; `validate-env.ts` is 111
  LOC (was 67), still under the 300 LOC cap.
- File-size grandfather list unchanged.

The end-to-end exit-demo proof remains owed by P5's clean-VM run
against `ductum@0.1.1`. The arc stays open until that run produces
`p5-exit-demo.json` with `totalSeconds < 600` and the typed-evidence
attach succeeds.

## Non-goals

- Not extracting the credential-detection logic to a shared module
  (deferred; flagged as future work).
- Not changing the PKCE flow's storage location. D132's choice
  (`~/.claude/.credentials.json` so the SDK and Ductum agree) stands.
- Not reading credentials at runtime per request — this is startup
  validation only. The SDK still reads credentials.json at request time
  via its own path.
- Not refreshing expired tokens on the API side. The startup validator
  only checks for *presence* of credentials; the SDK handles refresh at
  request time.

## Slop review

- Attack any future change that lets the API guard accept
  empty-string env vars or empty-string tokens in credentials.json.
  D159's tests pin both negative cases.
- Attack any divergence between `validate-env.ts` and
  `bootstrap-support.mjs`'s ambient-cred logic. If one accepts a
  shape the other rejects, that's the next named blocker.
- Attack any P5 close that uses `ductum@0.1.0`. The blocker is in
  0.1.0; 0.1.1 (or later) is required.
- Attack any slop-review-bypass workaround that masks the underlying
  validator gap rather than fixing it.
