# impl-003: Multi-Model Dispatch

**Status:** Draft
**Priority:** High — unblocks cost savings by routing tasks to cheaper models
**Depends on:** None

## Problem

Ductum currently only dispatches to Claude via the Claude Agent SDK harness. The OpenCode harness adapter exists (273 lines) but has never been tested live. GPT 5.4 and GLM agents are defined in `ductum.yaml` but can't actually be dispatched.

This means every task costs $2-5 (Opus pricing) even when the task is simple enough for a cheaper model.

## Goals

1. Test and fix the OpenCode harness adapter for live dispatch
2. Verify GPT 5.4 dispatch through OpenCode
3. Verify GLM dispatch through OpenCode
4. Add model routing hints to task specs (complexity-based dispatch)
5. Cost tracking works across all models

## Non-Goals

- No new harness adapters (OpenAI Agent SDK, etc.) — use OpenCode for non-Claude models
- No automatic complexity detection — routing is manual via task `requiredRole` or agent matching

## Architecture

### Current state

```
ductum.yaml agents:
  mimi:  claude-opus-4-6    harness: claude-agent-sdk  ← WORKS
  codex: openai/gpt-5.4     harness: opencode          ← UNTESTED
  glm:   zai-coding-plan/glm-5v-turbo  harness: opencode  ← UNTESTED
```

The dispatcher matches tasks to agents by role (builder/reviewer/docs). When a task matches an opencode agent, it calls `OpenCodeHarnessAdapter.spawn()` which:
1. Creates an OpenCode session via HTTP API
2. Attaches the Ductum MCP server
3. Sends the system prompt + task prompt
4. Polls for completion
5. Tracks heartbeats and tokens

### What needs testing/fixing

1. **OpenCode server must be running** — the adapter calls `http://localhost:4097` by default
2. **MCP server attachment** — OpenCode's MCP protocol may differ from Claude SDK
3. **Tool interception** — OpenCode uses a plugin model, not PreToolUse hooks. The plugin at `packages/harness/src/opencode-probe.ts` handles authorization via health probes.
4. **Token/cost tracking** — `opencode-usage.ts` summarizes usage from OpenCode's message format
5. **Model name resolution** — `opencode-model.ts` maps Ductum model names to OpenCode model IDs

### Key files

| File | Lines | Purpose |
|------|-------|---------|
| packages/harness/src/opencode.ts | 273 | Main adapter |
| packages/harness/src/opencode-rest.ts | 191 | OpenCode HTTP API client |
| packages/harness/src/opencode-model.ts | 26 | Model name mapping |
| packages/harness/src/opencode-probe.ts | 75 | Plugin health probe for auth |
| packages/harness/src/opencode-usage.ts | 51 | Token/cost parsing |
| packages/harness/src/tests/opencode.test.ts | ? | Existing tests |

## Acceptance Criteria

1. `pnpm serve` starts with both harness adapters active
2. A task dispatched to `codex` (GPT 5.4) completes successfully via OpenCode
3. A task dispatched to `glm` (GLM) completes successfully via OpenCode
4. Activity feed shows tool calls from non-Claude agents
5. Token and cost tracking works for OpenCode sessions
6. Stalled detection works (heartbeat timeout)
7. MCP tools (ductum_gate_check, ductum_complete, etc.) are accessible from OpenCode sessions
