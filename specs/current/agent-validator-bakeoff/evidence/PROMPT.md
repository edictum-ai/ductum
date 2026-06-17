# Agent Validator (`ductum agent test`) — bakeoff target

> **Moved here as evidence; bakeoff shipped 2026-05-01 — see D126.**
> The winning impl (opus) merged as `abab92e`. Cascade-leak postmortem
> in D127. This file is preserved for the audit trail; do not treat it
> as live work.



This is the **shared implementation prompt** for a 5-agent bakeoff. Each
candidate agent (sonnet, opus, opus-4-6, codex, gpt-5-5) implements
this same task in its own worktree. A blind reviewer then picks a
winner.

## Problem

Today there is no quick way to confirm that a registered agent can
actually spawn through its harness, make tool calls, and complete a
session cleanly. The first dispatch to a misconfigured agent (e.g.
`glm-5.1` without z.ai routing on 2026-05-01) wastes operator time
and dispatcher slots. Smoke testing is the prevention path that the
existing `ductum doctor` does not cover at agent-process granularity.

## Behavior contract

Implement a CLI command:

```
ductum agent test <agentName> [--verbose] [--cleanup] [--all]
```

That:

1. **Registers a transient smoke-test task** under a hidden
   `agent-smoketest` spec on the `ductum` project. The spec must
   exist (idempotently created on first invocation, status
   `implementing`). The task prompt must be deterministic: instruct
   the agent to create a file `agent-test-<agentname>.txt` with the
   single line `hello from <agentname>`, run a verify shell command
   that confirms the file exists and contains the expected content,
   then call `ductum_complete` with `result: "agent test ok"`.

2. **Dispatches the task** to the named agent through the existing
   dispatcher path (no new harness wiring required — re-use whatever
   the registered agent's harness adapter does). The dispatch is
   single-shot — no retry, no fix-loop. If the session crashes or
   times out, that's the test result.

3. **Waits for the run to terminate** (with a sensible timeout — at
   minimum 5 minutes, configurable via env var if you wish). Polls
   the run state via the existing API surface; do not embed run
   lifecycle logic inline.

4. **Verifies the outcome** in the worktree:
   - File `agent-test-<agentname>.txt` exists.
   - File content matches `hello from <agentname>` (trim trailing
     whitespace).
   - Run reached `terminalState=null, stage=done` OR has an explicit
     evidence row from `ductum_complete`. Either is acceptable.

5. **Returns a structured result** to stdout (and a non-zero exit
   code on failure):

   ```
   agent: opus-4-6
   model: claude-opus-4-6
   harness: claude-agent-sdk
   result: PASS | FAIL
   cost: $0.42
   time: 18s
   tokens: in=12345 out=234
   firstError: null | <one-line cause>
   ```

   `--verbose` adds the run id, the worktree path, and any non-empty
   `failReason`. JSON output via the global `--json` flag must produce
   an equivalent structured object.

6. **Cleans up** when `--cleanup` is set (default true): removes the
   transient task's worktree and marks the smoke-test task `done`
   via `task complete` (operator-note: "smoke test pass/fail").

7. **`--all` mode** runs the test against every agent currently
   assigned to the `ductum` project (any role) in parallel, subject
   to dispatcher concurrency limits. Returns a table of results
   (one row per agent) and exits non-zero if any agent failed.

## Categorically what `ductum agent test` is NOT

- **Not a benchmark.** Do not measure performance or compare quality
  across agents. That is the bakeoff's job, not the validator's. The
  validator only answers `PASS / FAIL`.
- **Not a probe-only tool.** A trivial "say hi" SDK call won't catch
  worktree, MCP, or commit issues. The agent must actually use tools
  in a worktree to pass.
- **Not an accept gate for production work.** A passing smoke test
  proves the agent can spawn and complete a one-step task; it does
  not certify the agent for unbounded production runs.

## Failure categories the result must distinguish

`firstError` should map to one of these well-known categories so the
operator can act:

- `spawn-error` — adapter rejected the model id, auth missing,
  process didn't start. (Captures the `glm-5.1 not routable` case.)
- `no-commit` — agent ran but never committed, never created the
  expected file.
- `verify-failed` — file exists but content doesn't match.
- `max-turns` — exhausted agent turn budget without completion.
- `cost-cap-paused` — D114 budget gate fired (very unlikely on a
  trivial task; if it does, it's a sign of a misconfigured cap).
- `timeout` — run never reached terminal within the wait window.
- `unknown` — anything else; carry the run id so an operator can
  inspect.

## CLI surface details

- Register the new command via the existing program-builder pattern
  (`packages/cli/src/commands/agent-test.ts` is a reasonable file
  name). Add it to `program.ts` registration alongside the others.
- Use the existing `DuctumApi` interface for everything — no curl,
  no direct DB access.
- Reuse the existing harness adapters; do not introduce a new
  smoke-test-only spawn path.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
node scripts/check-file-size.mjs
node packages/cli/dist/index.js agent test sonnet
node packages/cli/dist/index.js agent test --all
```

The last two commands must exit zero and print structured output for
all currently-registered, working agents.

## Acceptance criteria

- New CLI command `ductum agent test` is registered, with `--help`
  text describing the flags.
- Unit tests in `packages/cli/src/tests/` cover: PASS path, FAIL
  paths for each `firstError` category (you may use mocked dispatch
  + run states), `--all` aggregation, JSON output shape.
- Cleanup removes the smoke-test worktree when `--cleanup` is set.
- File-size gate passes (no file > 300 LOC unless grandfathered).
- `pnpm -r test` is green.

## Non-goals (explicit)

- Telegram or notification integration. Not in scope.
- Persistent test history dashboard. Not in scope.
- Smoke-testing reviewers separately from builders. Both roles share
  one validator.
- Cross-agent comparison output. The bakeoff harness does that
  separately.

## Style rules (project-wide)

- pnpm always. No `^` or `~` in deps. Exact pins.
- `rules` not `contracts`, `blocked` not `denied`, `pipeline` not
  `engine`.
- No file over 300 LOC.
- Decisions go in `decisions/` as append-only Markdown if the
  implementation reaches a decision point worth recording (e.g.
  "should `--all` parallelize or serialize" → record either choice
  with rationale).

## What "winning" means for the blind reviewer

The reviewer's verdict picks the candidate that best:

1. Satisfies all acceptance criteria.
2. Maps every observed failure mode to one of the named
   `firstError` categories rather than dropping to `unknown`.
3. Keeps the new code self-contained — minimal touch to existing
   modules.
4. Has tests that exercise each `firstError` category cleanly.
5. Documents trade-offs in code comments only where the choice is
   non-obvious. Avoids gratuitous abstraction for "future
   extensibility."

The reviewer must end with `## Final verdict\n<PASS|WARN|FAIL>:
<short reasoning>`.
