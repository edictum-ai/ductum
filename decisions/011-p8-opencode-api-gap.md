# P8 Implementation Decision — D31

**Date:** 2026-04-04
**Scope:** OpenCode harness adapter and plugin

## Context

The P8 prompt assumes OpenCode REST routes that do not exist in the current official docs or
server source:

- `POST /sessions`
- `POST /sessions/:id/tool-call`
- `GET /sessions/:id/stats`

The real API uses singular `/session` routes, async prompting via
`POST /session/:id/prompt_async`, synchronous prompting via
`POST /session/:id/message`, and message history for token/cost data.

## Decision

Implement P8 against the documented OpenCode API:

- create sessions with `POST /session`
- start work with `POST /session/:id/prompt_async`
- aggregate token/cost totals from `GET /session/:id/message`
- attach the per-run Ductum MCP server with `POST /mcp`

For plugin-health attestation, use a synthetic `subtask` message sent through OpenCode.
That deterministically reaches the real `tool.execute.before` hook because OpenCode handles
subtasks through the built-in `task` tool before any model turn.

The Ductum plugin rewrites that synthetic `task` call into
`__ductum_health_probe__` when it calls Ductum Core, then blocks execution immediately so
the probe produces no side effects.

## Also noted

OpenCode plugins can block tool calls. The official plugin docs show
`tool.execute.before` hooks throwing errors to stop execution, and the current server source
invokes those hooks before both built-in tools and MCP tools.
