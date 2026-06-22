# Qratum Dogfood Capture

## Intake

Qratum Milestone A proved the local vertical slice against synthetic fixtures.
This slice starts Milestone B with real-session dogfooding: make Qratum process
sanitized real-shaped Claude Code transcripts end-to-end without uploading,
copying, or rendering raw transcript content.

## Decision Trace

- Qratum remains local-first: raw transcript content must stay on the developer
  machine and must not be copied into `.qratum/`.
- Milestone B starts with dogfooding, not enterprise/server/marketplace work.
- Deterministic redaction remains best-effort alpha quality; no LLM redaction.
- Ductum runs GPT-5.5 as builder and Opus as reviewer for this Qratum task.

## Behavior Contract

- `qrt dogfood import <transcript_path>` must run normalize, redaction,
  evidence extraction, review generation, HTML report rendering, and ADP strict
  export into `.qratum/`.
- Dogfood import must never print raw transcript content.
- Dogfood import must never copy the raw transcript into `.qratum/`.
- Dogfood import must fail loudly when the transcript path is missing.
- The Claude transcript parser must tolerate unknown real-shaped records.
- The parser must preserve useful available fields for session id, timestamps,
  model, user/assistant messages, tool calls, tool results, file edits, Bash
  commands, and command success/failure.
- Sanitized dogfood fixtures must not contain real secrets.
- `qrt dogfood latest` must print compact review output with session id,
  verdict, main finding, suggested next habit, HTML report path, and ADP export
  path.
- No server, sync, marketplace, MCP, GitHub integration, database, encrypted
  vault, Codex adapter, OpenCode adapter, LLM scoring, or LLM redaction may be
  implemented in this slice.

## Verification

```sh
go test ./...
make build
make demo
```

## Drift Handling

Record a decision before adding a database, network sync, server component,
GitHub integration, marketplace code, MCP server, new adapter, LLM scoring, or
LLM redaction.

## Slop Review

- Did dogfood import prove real-shaped transcript tolerance instead of only
  reusing the original synthetic fixture?
- Did raw transcript content stay out of `.qratum/` artifacts and command
  output?
- Did missing transcript paths fail non-zero with an operator-visible error?
- Did this avoid future Milestone B/C/D/E features?
- Did tests cover unknown record tolerance and compact latest review output?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-REAL-CLAUDE-DOGFOOD-CAPTURE.md](P1-REAL-CLAUDE-DOGFOOD-CAPTURE.md) | qratum | dogfood CLI + real-shaped parser hardening | `qrt dogfood import` and `qrt dogfood latest` | - |
