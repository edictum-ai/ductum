# D140 — Claude Agent SDK Mid-Write Max-Turn Detection

Date: 2026-05-03

Status: Accepted

## Context

D118 already handles the explicit Claude Agent SDK `error_max_turns`
result by pausing the run on the max-turns gate. D131 Gap 12 and D133
showed a second SDK shape: a session can end as a successful, non-error
result with empty result text after the latest activity says the SDK hit
a limit. D133 covered prompt overflow. The same silent-success shape can
also happen when the turn budget is exhausted while the agent is still
editing.

## Decision

The Claude harness now tracks this silent max-turns shape separately:

- result subtype is `success`
- result is not an SDK error
- result text is empty
- last assistant/tool activity mentions the turn budget or maximum turns

That session returns `exitReason: "failed"` with
`failReason: "max_turns_reached"` and structured failure evidence. The
evidence includes the current effective turn limit, a suggested next
limit, and D135-style suggested actions: `bump_max_turns`,
`retry_same_agent`, and `switch_agent`.

The D135 `/api/events` `run.failed` envelope also emits structured error
actions for `max_turns_reached`. The API computes the current limit as
`200 + task.turnExtraCount`, matching the Claude harness baseline, and
uses all other registered agents as the first simple candidate list for
`switch_agent`.

`ductum turns extend` now accepts both `max_turns_paused` and
`max_turns_reached`, so the emitted `bump_max_turns` command is
executable.

## Consequences

Mid-write max-turn exhaustion is no longer mislabeled as a successful
completion or a generic crash. Agents consuming the event stream can
execute the first recovery action directly, while operators still retain
the existing turn-extension control surface.
