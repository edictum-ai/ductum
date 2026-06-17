# D133 — Claude Agent SDK Prompt Overflow Is Terminal Failure

Date: 2026-05-02

Status: Accepted

## Context

D131 left Gap 12 open: `claude-agent-sdk` can report a successful
`SDKResultSuccess` with empty `result` text after the session has emitted
`Prompt is too long`. The SDK type in `@anthropic-ai/claude-agent-sdk@0.2.119`
confirms success results include `result: string`, so the adapter can use the
empty-result shape without depending on private internals.

## Decision

The Claude harness tracks the latest assistant/tool activity text. If the
session ends with:

- `subtype: "success"`
- `is_error: false`
- empty `result`
- latest activity matching prompt-overflow text

then the harness returns `exitReason: "failed"` with
`failReason: "prompt_overflow"` and structured failure evidence.

The dispatcher maps `exitReason: "failed"` to a terminal failed run and records
a `custom` evidence row with `kind: "harness.failure"`. The CLI status command
prints a concrete operator hint for `prompt_overflow`.

## Consequences

Silent prompt-overflow runs now render as failed instead of succeeded. Operators
see the failure reason and the hint to split the task, while max-turn and budget
pauses continue to use their existing recoverable pause paths.
