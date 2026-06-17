# D146: Live Demo Harness For SSE And Cancel

Date: 2026-05-03

## Status

Accepted and implemented.

## Context

The D135 reliability bundle shipped with unit and route coverage for the
agent-first SSE stream and operator cancel control. The remaining in-scope
gap was an end-to-end demo that proves the two surfaces together against a
running temporary factory without touching production state or billing a
real model.

## Decision

Add `scripts/demos/sse-cancel-demo.mjs` and expose it as
`pnpm demos:sse-cancel`.

The demo:

- creates a temporary git repo, config, and database under `/tmp`
- starts `pnpm serve` with `DUCTUM_MOCK_AGENT_CALLS=1`
- imports a one-task spec through the CLI
- opens `ductum events` and asserts `run.dispatched`,
  `run.stage_changed`, `factory.events_stream_resumed`, and
  `run.cancelled`
- cancels the live run through `ductum cancel`
- verifies the dispatcher slot is freed and the worktree remains preserved
- tears down the server and removes the temporary directory

For CI speed, the API event heartbeat accepts `DUCTUM_EVENTS_HEARTBEAT_MS`
and the mock harness accepts `DUCTUM_MOCK_AGENT_DELAY_MS`. Production
defaults remain the D135 behavior: 30 second SSE heartbeat and no mock
delay unless explicitly configured.

## Consequences

The shipped bundle now has a repeatable live demo path for the two highest
risk operator surfaces. The script exits with a schema envelope on both
success and failure, so automation can consume the result without scraping
human text.
