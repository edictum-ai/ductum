---
date: 2026-05-23
status: accepted
deciders: operator (Arnold Cartagena), Codex
related: 121, 135, 145, 162, 163
---

# ADR 0164: Harness Durability And Protocol Hardening

## Status

Accepted.

This decision creates the implementation arc in
`specs/current/harness-durability-protocol-hardening/`. It does not change
runtime behavior by itself.

## Decision

Ductum keeps the current harness spine: dispatcher-owned runs, per-run MCP
server, pre/post tool interception, session IDs, heartbeats, cost deltas,
workflow gates, and post-completion routing.

The next hardening work is not a new harness architecture. It is durability
and protocol discipline around that spine:

1. Persist replayable normalized run transcripts, not only dashboard activity
   summaries.
2. Introduce an adapter-independent control protocol for request, response,
   cancellation, timeout, duplicate suppression, and approval races.
3. Make adapter reattach real for at least one restart-capable harness before
   claiming restart durability.
4. Add a core tool semantics registry so policy does not rely only on tool
   names and regexes.
5. Harden command and path validation with explicit cases for destructive
   shell patterns, path flags, cwd drift, symlink-sensitive paths, and
   platform-specific shell behavior.
6. Store large tool results as run artifacts and keep activity rows as an
   index/preview.
7. Make terminal failure and diagnostic taxonomy first-class evidence.
8. Require schema-bound terminal completions for reviewer/fixer/verifier
   workflows where the system needs a machine-checkable handoff.
9. Add fake harness tools/streams that exercise slow approval, duplicate
   response, crash mid-tool, restart-then-reattach, always-allow, and
   always-block paths.

## Reason

The current system has the right shape, but too much critical behavior is
still implied by logs, activity text, adapter-local request handling, and
regex-based command classification.

Recent contract work fixed API/dashboard/model/harness drift. The next risk is
runtime durability: losing replay context, mis-routing adapter control
messages, failing to recover after restarts, and treating important terminal
diagnostics as opaque text.

The implementation must be based on Ductum's own code, explicit product
requirements, public protocol behavior, and local tests.

## Consequences

Harness adapters will need to emit more canonical data. The dispatcher and API
will gain new contracts for replay logs, control messages, result artifacts,
and terminal evidence.

Some existing activity rows will remain as UI summaries, but they stop being
the only record of what happened in a run.

The work is intentionally staged. No stage should rewrite all harnesses at
once, add broad dependencies, or weaken existing workflow gates.
