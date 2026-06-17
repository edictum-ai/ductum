# impl-012: Vercel AI SDK Harness Adapter

**Status:** Draft
**Priority:** Critical — enables governed dispatch to ChatGPT Pro + any OpenAI-compat model
**Depends on:** None (uses existing @edictum/vercel-ai from edictum-ts)
**Decision:** D51

## Problem

The OpenCode adapter has no tool interception. Codex/GLM sessions run ungoverned —
agents receive prompts and tokens flow, but Ductum never sees tool calls, the workflow
never advances, and sessions stall at `read-analyze`.

GLM can use the Claude Agent SDK via ZAI's Anthropic-compatible API. But ChatGPT Pro
has no Anthropic-compat endpoint. The only path to structural enforcement is owning
the agent loop.

## Solution

Build a `vercel-ai` harness adapter using:

1. **Vercel AI SDK** `generateText()` — handles the agent loop (prompt → tool_call → execute → result → repeat)
2. **`@edictum/vercel-ai`** `VercelAIAdapter.asCallbacks()` — intercepts every tool call through Edictum
3. **Clean-room Codex OAuth** — reads `~/.codex/auth.json`, refreshes tokens, MIT licensed
4. **`createOpenAI()` provider** — custom fetch routes to Codex Responses API

Reference implementation: `edictum-demo/demos/ts-vercel-ai/src/agent.ts`

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Ductum Dispatcher                                   │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Claude SDK   │  │ Vercel AI    │  │ OpenCode   │ │
│  │ Harness      │  │ Harness      │  │ (deprecated│ │
│  │              │  │ (NEW)        │  │ for gov'd) │ │
│  ├─────────────┤  ├──────────────┤  ├────────────┤ │
│  │ Claude Max   │  │ ChatGPT Pro  │  │ ungoverned │ │
│  │              │  │ ZAI GLM      │  │ tasks only │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────┘ │
│         │                │                          │
│         ▼                ▼                          │
│  ┌─────────────────────────────┐                    │
│  │ @edictum/core               │                    │
│  │ evaluate() → allow/block    │                    │
│  │ recordResult() → advance    │                    │
│  └─────────────────────────────┘                    │
└─────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| packages/harness/src/vercel-ai.ts | NEW — main adapter |
| packages/harness/src/codex-auth.ts | NEW — OAuth token management (clean-room, MIT) |
| packages/harness/src/vercel-ai-tools.ts | NEW — filesystem/bash tool definitions |
| packages/harness/src/tests/vercel-ai.test.ts | NEW — adapter tests |

## Prompts

### P1: Codex OAuth + Provider Setup

**Scope:** Clean-room OAuth token reader + Vercel AI SDK OpenAI provider
**Deliverable:** `codexOAuthFetch()` that reads ~/.codex/auth.json and creates an authenticated OpenAI provider

Tasks:
1. `codex-auth.ts` — read auth file, refresh expired tokens, return headers
2. Create `createCodexProvider()` that returns a Vercel AI SDK OpenAI provider with custom fetch
3. Tests: token reading, refresh flow, header injection

### P2: Vercel AI Harness Adapter

**Scope:** `VercelAIHarnessAdapter` implementing HarnessAdapter interface
**Depends on:** P1
**Deliverable:** Full harness adapter that dispatches tasks to Codex with Edictum enforcement

Tasks:
1. `vercel-ai.ts` — implement HarnessAdapter (spawn, kill, isAlive)
2. Tool definitions — Read, Write, Edit, Bash, Glob, Grep (real filesystem operations, not workspace simulation)
3. Wire `@edictum/vercel-ai` VercelAIAdapter for tool interception
4. Agent loop via `generateText({ maxSteps })` with system prompt
5. Heartbeat reporting during execution
6. Activity logging (tool calls, text, completion)
7. Token/cost tracking from usage metadata
8. Tests: spawn lifecycle, tool interception, blocked tool handling

### P3: Integration + GLM via Vercel AI

**Scope:** Wire the new adapter into Ductum for both Codex and GLM, update ductum.yaml
**Depends on:** P2
**Deliverable:** All three subscriptions dispatching with structural enforcement

GLM uses Z.AI's OpenAI-compatible Coding API (`api.z.ai/api/coding/paas/v4`),
not the Anthropic-compat endpoint. Same Vercel AI harness as Codex, just
`createOpenAI({ baseURL, apiKey })` instead of Codex OAuth fetch.
Models: GLM-5.1, GLM-5, GLM-4.7, GLM-4.5-air. Ref: docs.z.ai/devpack/tool/others

Tasks:
1. Register `vercel-ai` harness in serve.mjs
2. Update ductum.yaml:
   - codex: `harness: vercel-ai`, provider config with Codex OAuth
   - glm: `harness: vercel-ai`, provider config with Z.AI API key + base URL
3. Provider factory in adapter: detect auth type from agent config (oauth vs api-key), create appropriate OpenAI provider
4. End-to-end test: dispatch task to Codex via Vercel AI harness, verify workflow advances
5. End-to-end test: dispatch task to GLM via Vercel AI harness with Z.AI endpoint, verify enforcement
6. Deprecate OpenCode adapter for governed work (keep for ungoverned)

## OAuth Implementation (clean-room)

```typescript
// codex-auth.ts — NO AGPL dependencies

interface CodexAuth {
  access_token: string
  refresh_token: string
  expires_at: number  // unix ms
  account_id: string
}

// Read from ~/.codex/auth.json (created by `npx @openai/codex login`)
// Refresh via POST https://auth.openai.com/oauth/token
// Headers: Authorization, chatgpt-account-id, OpenAI-Beta
```

## Tool Definitions

Real filesystem tools, not workspace simulation:

```typescript
const tools = {
  Read: tool({
    inputSchema: z.object({ file_path: z.string() }),
    execute: async ({ file_path }) => fs.readFile(file_path, 'utf-8'),
  }),
  Write: tool({
    inputSchema: z.object({ file_path: z.string(), content: z.string() }),
    execute: async ({ file_path, content }) => { fs.writeFile(file_path, content); return 'ok' },
  }),
  Bash: tool({
    inputSchema: z.object({ command: z.string() }),
    execute: async ({ command }) => execAsync(command),
  }),
  // ... Edit, Glob, Grep
}
```

## Acceptance Criteria

1. `codex login` creates auth file → Ductum reads it → token refresh works
2. Task dispatched to Codex completes with full Edictum enforcement
3. Blocked tool calls return denial reason to the model
4. Workflow auto-advances through all 10 stages
5. Activity feed shows Codex tool calls in dashboard
6. Token/cost tracking works
7. Heartbeats keep the run alive
8. GLM dispatches via Vercel AI harness with Z.AI OpenAI-compat API
9. Both Codex (OAuth) and GLM (API key) use the same harness, different provider config
10. No AGPL dependencies anywhere in the chain
