# P2: Activity Bridge

**Scope:** Bridge OpenCode session messages to Ductum activity feed and token tracking
**Package:** `packages/harness`
**Depends on:** P1 (OpenCode adapter working)
**Deliverable:** OpenCode agent activity visible in dashboard, tokens tracked

---

## Required Reading

- `packages/harness/src/opencode.ts` — current polling loop
- `packages/harness/src/opencode-rest.ts` — `listSessionMessages()`, `getSessionStatuses()`
- `packages/harness/src/opencode-usage.ts` — token parsing
- `packages/harness/src/rest.ts` — `postActivity()`, `postTokens()` (used by Claude adapter)
- `packages/harness/src/claude.ts` — reference for how Claude adapter logs activity

## Tasks

### 1. Add activity logging to OpenCode adapter

The Claude adapter calls `postActivity()` for each SDK message (tool calls, text, summaries).
The OpenCode adapter needs similar logging from its message polling loop.

OpenCode messages come from `listSessionMessages()`. Map them to activity entries:
- Assistant text → `postActivity(runId, 'text', content)`
- Tool calls → `postActivity(runId, 'tool_call', args, toolName)`
- Completion → `postActivity(runId, 'result', summary)`

### 2. Add token tracking from OpenCode messages

The Claude adapter tracks tokens from intermediate assistant messages.
OpenCode messages have a different format — check `opencode-usage.ts` for the parsing logic.

Add intermediate token reporting during the polling loop, not just at session end.

### 3. Test with live dispatch

Dispatch a task to codex/glm and verify:
- Activity tab in dashboard shows tool calls
- Token counts update during the run (not just at end)
- Cost is calculated

## Verification

- [ ] Dashboard activity tab shows OpenCode agent tool calls
- [ ] Tokens update during the run (not just at completion)
- [ ] Cost tracking works for GPT/GLM models
- [ ] Activity feed format matches Claude adapter output
