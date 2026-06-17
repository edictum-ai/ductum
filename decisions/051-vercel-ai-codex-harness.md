# D51: Vercel AI SDK + Codex OAuth harness for ChatGPT Pro

**Date:** 2026-04-05
**Context:** OpenCode adapter has no tool interception — Codex/GLM sessions run ungoverned. Need structural enforcement for ChatGPT Pro subscription.
**Decided by:** Arnold + Claude Opus
**Alternatives considered:**
1. Build OpenCode enforcement plugin (P8 design) — depends on OpenCode plugin API supporting blocking, not just observation
2. Use OpenAI Agents SDK — requires API keys, not subscription auth
3. Use OpenClaw as harness — AGPL-3.0 dependency, unnecessary middleman
4. Build custom agent loop — maintenance burden of an entire SDK
5. Accept advisory-only for Codex — contradicts Ductum thesis

## Decision

Build a `vercel-ai` harness adapter that uses:
- **Vercel AI SDK** `generateText()` with `maxSteps` for the agent loop
- **`@edictum/vercel-ai`** `VercelAIAdapter.asCallbacks()` for structural enforcement
- **Clean-room Codex OAuth** (read `~/.codex/auth.json`, refresh via OpenAI token endpoint, MIT) — no AGPL dependency
- **`createOpenAI()` provider** with custom `fetch` that injects OAuth headers and routes to `chatgpt.com/backend-api/codex/responses`

## Architecture

```
codex login (one-time, creates ~/.codex/auth.json)
       ↓
codex-auth.ts (reads tokens, refreshes, adds headers — clean-room, MIT)
       ↓
createOpenAI({ fetch: codexOAuthFetch })
       ↓
generateText({ model, tools, maxSteps })
       ↓
experimental_onToolCallStart → @edictum/vercel-ai → evaluate() → allow/block
       ↓
tool.execute() → real filesystem/bash operations
       ↓
experimental_onToolCallFinish → @edictum/vercel-ai → recordResult() → auto-advance
```

## Reference implementation

`edictum-demo/demos/ts-vercel-ai/src/agent.ts` demonstrates the exact pattern:
- `VercelAIAdapter` wraps Edictum with Vercel AI callbacks
- `experimental_onToolCallStart` throws `EdictumDenied` on blocked tools
- `experimental_onToolCallFinish` records evidence and advances workflow
- Tools defined as standard Vercel AI SDK `tool()` with `inputSchema` + `execute`

## Harness matrix after D51

| Subscription | Harness | Auth | Endpoint | Adapter |
|---|---|---|---|---|
| Claude Max | `claude-agent-sdk` | Subscription | Anthropic API | `@edictum/claude-sdk` |
| ChatGPT Pro | `vercel-ai` (new) | Codex OAuth | `chatgpt.com/backend-api/codex/responses` | `@edictum/vercel-ai` |
| ZAI GLM | `vercel-ai` (new) | API key | `api.z.ai/api/coding/paas/v4` | `@edictum/vercel-ai` |

Two harnesses total. GLM uses Z.AI's OpenAI-compatible Coding API (docs.z.ai/devpack/tool/others),
not the Anthropic-compat endpoint. Same Vercel AI harness as Codex, different provider config.
Models: GLM-5.1, GLM-5, GLM-4.7, GLM-4.5-air (uppercase in config).

## OAuth details (clean-room, no AGPL)

Auth file: `~/.codex/auth.json` (created by `npx @openai/codex login`)
Token endpoint: `https://auth.openai.com/oauth/token`
API endpoint: `https://chatgpt.com/backend-api/codex/responses`
Headers: `Authorization: Bearer {access}`, `chatgpt-account-id: {accountId}`, `OpenAI-Beta: responses=experimental`
Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (same as Codex CLI, public)

## What this replaces

The OpenCode adapter (`packages/harness/src/opencode.ts`) becomes deprecated for governed work. It may still be useful for ungoverned tasks or models that don't support Vercel AI SDK providers. But for the three subscriptions above, all governed work goes through Claude SDK or Vercel AI SDK harnesses.
