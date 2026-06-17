# Dogfood: CLI watch mode for autonomous operators

Build a CLI-first live monitoring command so another agent can operate Ductum without scraping the dashboard.

Required behavior:

- Add `ductum watch [runId]`.
- When no `runId` is passed, print an initial operator queue snapshot and then stream factory events from `/api/events/stream`.
- When `runId` is passed, print that run status first and then stream only events for that run from `/api/events/stream?runId=<id>`.
- Render concise human lines for `run.stage_changed`, `run.dispatched`, `approval.requested`, `task.status_changed`, `spec.status_changed`, `run.agent_activity`, `gate.evaluated`, and `workflow.advanced`.
- Support `--project <id>`, `--spec <id>`, and `--task <id>` filters for the stream.
- Support `--once` for demos/tests: print the initial snapshot and exit without opening the stream.
- Support `--timeout <seconds>` so CI can prove streaming exits.
- Support `--json` by emitting newline-delimited JSON events.
- Do not require a new npm dependency. Use native fetch/EventSource-compatible parsing.
- Add focused CLI tests with an injected stream source.
- Keep new files below 300 LOC.

Verification:

- `pnpm --filter @ductum/cli exec vitest run src/tests/watch-command.test.ts`
- `pnpm --filter @ductum/cli build`
