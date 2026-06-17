# impl-006: DX Polish

**Status:** Draft
**Priority:** Medium — quality-of-life improvements across the system
**Depends on:** impl-009 (run stages change to workflow stages — logging and prompts must reference correct stage names)

## Problem

Accumulated rough edges from rapid development:
- No README or getting-started guide
- URL structure not descriptive (/runs/n32TJB_wvY1V tells you nothing)
- Error messages could be more helpful
- No env var validation on startup
- Agent completion text gets truncated in the UI
- stale .js build artifacts committed to git

## Goals

1. Getting-started README with 5-minute quickstart
2. Better URL structure (include task/project slugs where possible)
3. Structured logging (not console.log)
4. Env var validation on startup (ANTHROPIC_API_KEY, etc.)
5. Clean up build artifacts and .gitignore

## Acceptance Criteria

1. README.md with working quickstart (install → config → serve → dispatch)
2. Browser tab titles are descriptive (e.g., "mimi on dispatch-retry — Ductum")
3. Startup validates required env vars conditionally: ANTHROPIC_API_KEY only when a claude-agent-sdk agent is configured (see P2 for details)
4. No console.log in production code (use structured logger)
5. .gitignore covers all build artifacts

Note: URL paths stay as /runs/:id (runs don't have unique names for URL slugs).
Descriptive context comes from page titles and breadcrumbs, not URL structure.

## Agent Dispatch Tiers (from dogfood 2026-04-05)

The dispatcher's costTier + complexity matching is too implicit. Replace with
declarative `tier` config in ductum.yaml:

```yaml
agents:
  mimi:
    model: claude-opus-4-6
    harness: claude-agent-sdk
    roles: [builder, reviewer]
    tier: complex          # gets complex tasks
  codex:
    model: openai/gpt-5.4
    harness: opencode
    roles: [builder, reviewer]
    tier: default          # gets null/standard tasks
  glm:
    model: zai-coding-plan/glm-5v-turbo
    harness: opencode
    roles: [builder, docs]
    tier: simple           # only gets simple tasks
```

Dispatcher matches `task.complexity` → `agent.tier`:
- `complex` → agents with tier `complex` first, then `default`
- `null` / `standard` → agents with tier `default` first
- `simple` → agents with tier `simple` first, then `default`

Remove `costTier` field and the "closest to 80" math. This is the right
abstraction — operators declare intent, not numbers.

Decision D50: Agent dispatch tiers are declarative in ductum.yaml, not
numeric costTier ranking.
