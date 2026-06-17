---
date: 2026-05-02
status: accepted (next active spec after recovery closes)
deciders: operator (Arnold Cartagena)
related: 109, 052, 125, 128, 129
references:
  - https://github.com/badlogic/pi-mono (packages/ai/src/env-api-keys.ts)
  - https://github.com/mattpocock/sandcastle (.sandcastle/.env scaffold pattern)
  - https://github.com/anthropics/claude-agent-sdk (env-var contract)
---

# Decision 130: Bootstrap multi-provider auth detection (next active spec)

## Context

`pnpm bootstrap` shipped in P6 (commit `d27f5624`) gated only on
`ANTHROPIC_API_KEY` being set. That over-checks: the
`@anthropic-ai/claude-agent-sdk@0.2.119` ductum embeds actually accepts
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`,
or disk-stored creds via `CLAUDE_CONFIG_DIR`. Operators using Claude
Code subscription auth (no raw API key) are blocked at the prereq even
though every downstream step would work.

This was discovered during the factory-readiness-recovery exit-demo
attempt on 2026-05-02. The recovery closes with this gap named (see
recovery closeout); the demo's wall-clock could not be honestly
verified end-to-end on a subscription-auth-only machine.

The operator also wants **GitHub Copilot** as a first-class agent
provider, which means the prereq probe needs to be multi-provider from
the start, not Anthropic-only.

## Decision

The next active spec is `bootstrap-multi-provider-auth`. It ports the
pi-mono auth-detection pattern (~250 LOC, MIT, single file) and extends
`scripts/bootstrap-support.mjs` to handle every agent provider ductum
supports today, plus Copilot.

### Scope

1. **Provider-keyed env-var arrays.** Mirror pi-mono's
   `getApiKeyEnvVars(provider)`: each provider declares an ordered list
   of env vars that satisfy its auth, first-set-wins. Authoritative
   list:
   - `anthropic`: `["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]`
   - `openai`: `["OPENAI_API_KEY"]`
   - `github-copilot`: `["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]`
   - `zai`: `["ZAI_API_KEY"]` (already used for glm; D128)
   - `openrouter`: `["OPENROUTER_API_KEY"]`
   - additional providers added as agents register them

2. **Ambient credential detection.** For providers with non-env auth
   (Claude Code's `CLAUDE_CONFIG_DIR`, Google Vertex ADC, AWS profiles,
   etc.), check the standard config locations the way pi-mono does.
   Return a sentinel like `"<authenticated>"` so the caller can
   distinguish "we found auth" from "we have a key string."

3. **Bootstrap prereq driven by enabled providers.** Replace the
   single hard `ANTHROPIC_API_KEY` check with a probe that reads
   `ductum.yaml` for which agents are enabled, looks up each agent's
   provider via `harnessRef`, and demands at least one valid auth path
   per enabled provider. Operators running a Copilot-only agent should
   not need an Anthropic key, and vice versa.

4. **Optional `pnpm ductum login` (or `ductum login`) wizard.** Port
   pi-mono's `packages/ai/src/utils/oauth/anthropic.ts` PKCE flow so
   subscription-auth users have a one-shot login that writes the right
   env var (`ANTHROPIC_OAUTH_TOKEN`) to `.env.local`. Same scoping as
   pi: `org:create_api_key user:profile user:inference
   user:sessions:claude_code user:mcp_servers user:file_upload`. Reuse
   pi-mono's PKCE helper since it's already battle-tested.

5. **Copilot first-class agent.** Add `copilot-sdk` (or whatever
   underlying SDK ships first) to the harness registry. Match
   pi-mono's env-var precedence
   (`COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`). Update doctor
   output and dashboard pickers per the existing harness-as-resource
   model from P4.

### Out of scope for this spec

- AWS Bedrock / Google Vertex ambient-cred handling. Cite as future
  work; only Anthropic + Copilot + the providers already wired through
  `harnessRef` in `ductum.yaml` need to ship.
- Token rotation / re-auth UX beyond the initial wizard. Refresh-token
  handling can land later.
- The hosted edictum-api Telegram relay (D129). Independent track.
- Any change to running runs' auth model. New runs only.

## Why

The recovery proved the factory works end-to-end as long as the
prereq script doesn't reject the operator's environment. pi-mono's
file is a clean reference impl that's been exercised in production
across multiple providers; porting it is faster and lower-risk than
inventing the same thing from scratch.

Copilot has been on the operator's wishlist (verbal, 2026-05-02);
folding it into the same spec means the multi-provider abstraction
gets exercised by two providers from day one, not bolted on to a
single-provider design later.

## How to apply

When this spec is dispatched:
- Required reading order: D109 → D125 → D129 → this decision →
  pi-mono `packages/ai/src/env-api-keys.ts` and
  `packages/ai/src/utils/oauth/anthropic.ts`.
- Port pattern, do not vendor; add MIT attribution in the file header.
- Tests should cover at minimum: each provider's env-var array,
  ambient-cred probe for Anthropic disk creds, fallthrough behavior,
  and one Copilot smoke test that proves a token from each of the
  three accepted env vars resolves.

## Non-goals

- Do not regress the recovery's shipped behavior. `pnpm bootstrap`
  must continue to fail fast with a clear message when no auth path
  is present; only the *set* of accepted paths expands.
- Do not bake provider-specific logic into the bootstrap script's
  body. All provider-specific knowledge lives in the per-provider
  `getApiKeyEnvVars` / ambient-cred functions; the prereq driver
  iterates declaratively.

## Slop review

- Attack any patch that lands without Copilot proven end-to-end —
  this spec is multi-provider by design, not Anthropic-only with a
  Copilot stub.
- Attack any prereq probe that hard-checks a single env var.
- Attack a `login` wizard that writes a token without telling the
  operator where it stored it or how to revoke.
