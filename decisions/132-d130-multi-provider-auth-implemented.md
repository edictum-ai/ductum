---
date: 2026-05-02
status: accepted
deciders: operator (Arnold Cartagena), Codex
supersedes: 130
related: 109, 115, 131
references:
  - https://github.com/badlogic/pi-mono (packages/ai/src/env-api-keys.ts, packages/ai/src/utils/oauth/anthropic.ts; MIT)
---

# Decision 132: D130 multi-provider bootstrap auth implemented

## Context

D130 named the recovery exit-demo blocker: `pnpm bootstrap` hard-required
`ANTHROPIC_API_KEY` even though the runtime can use Claude subscription auth.
The factory also needed the first provider abstraction before Copilot and
OpenAI-backed operators could bootstrap cleanly.

## Decision

Ship D130 as an operator-direct implementation.

- `scripts/bootstrap-support.mjs` now owns the provider-keyed auth table,
  modeled after pi-mono's env-api-keys pattern but implemented locally.
- `resolveProviders()` unions environment keys and ambient credentials.
  Supported shipped providers are Anthropic, OpenAI, GitHub Copilot, Z.AI,
  and OpenRouter.
- Anthropic accepts OAuth/subscription env vars before raw API keys:
  `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN`, then `ANTHROPIC_API_KEY`.
- Ambient Anthropic detection checks `~/.claude/.credentials.json` and
  `$CLAUDE_CONFIG_DIR/credentials.json`.
- Copilot detection checks `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`,
  `GITHUB_TOKEN`, `gh auth status`, and `~/.config/gh/hosts.yml`.
- `pnpm bootstrap` now fails only when no provider credential can be resolved,
  and prints accepted env vars plus ambient locations with copyable exports.
- The bootstrap banner names the selected provider and credential source.
- `ductum login` implements a Claude subscription PKCE flow with a random
  local callback port and writes `~/.claude/.credentials.json` or
  `$CLAUDE_CONFIG_DIR/credentials.json`.

The API startup guard was also widened to accept Anthropic OAuth env vars.
Without that, bootstrap would pass its prereq and then fail when `pnpm serve`
started, which would not satisfy the D130 exit demo.

## Consequences

The recovery exit demo is now verifiable on a subscription-auth-only machine.
Operators can also bootstrap with OpenAI or Copilot credentials without
pretending an Anthropic API key exists.

The login wizard intentionally writes Claude credentials to the Claude config
file, not `.env.local`, so the SDK and Ductum's ambient detector agree on the
same source. Operators who want env-only bootstrap can still export
`ANTHROPIC_OAUTH_TOKEN`.

## Verification

- `pnpm test:scripts`
- `pnpm --filter @ductum/cli test -- login-command.test.ts`
- `pnpm --filter @ductum/api test -- validate-env.test.ts`
- Fresh-checkout bootstrap exit demo with only `ANTHROPIC_OAUTH_TOKEN`
  is the D132 acceptance demo.
