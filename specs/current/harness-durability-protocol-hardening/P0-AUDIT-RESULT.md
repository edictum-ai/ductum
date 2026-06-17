# P0 Audit Result

Date: 2026-05-23

## Result

P0 confirms ADR 0164. The implementation order does not need to change.

The current harness spine is sound, but durability is split across transient
adapter maps, best-effort activity posts, and free-form failure strings. The
next stages should add durable contracts around the existing dispatcher instead
of replacing it.

## Confirmed Gaps

- `HarnessEvent` is activity-oriented. It has no sequence number, causality id,
  artifact pointer, or durable payload preview contract.
- `emitHarnessEvent` writes mostly to `run_activity`; activity rows are useful
  UI previews, not replay logs.
- Control lifecycle is adapter-local. Codex app-server tracks pending JSON-RPC
  requests in memory, while Claude hooks call `/api/internal/authorize-tool`
  directly.
- `tryReattach` exists in the core interface and reconciler, but no built-in
  adapter currently proves a real restart resume path.
- Command scope protection is still regex-led in
  `workflow-command-scope.ts`. It catches important cases but does not return
  structured path/command evidence.
- Large tool output handling truncates activity. There is no run artifact index
  for stdout, tool result blocks, or oversized RPC payloads.
- Terminal results use `exitReason`, `failReason`, and optional
  `failureEvidence`, but stable terminal codes are not canonical.
- Reviewer/fixer/verifier completion is still mostly text-shaped.

## Stage Ownership

### P1 - Run Transcript Log

Owns:

- `packages/core/src/harness-transcript.ts`
- `packages/core/src/repos/run-transcript.ts`
- `packages/core/src/db-migrations.ts`
- `packages/api/src/routes/runs.ts`
- `packages/harness/src/canonical-events.ts`
- `packages/harness/src/rest.ts`

Add a `run_transcript_events` table with `run_id`, `seq`, `timestamp`,
`source`, `kind`, `payload_preview`, `artifact_pointer`, `causality_id`, and
`payload_json`. Keep `run_activity` as UI preview.

Migration: required.

Tests: repo/db tests, API route tests, canonical-event tests, crash-mid-event
fake test. No provider session required.

### P2 - Control Protocol

Owns:

- `packages/core/src/control-protocol.ts`
- `packages/core/src/repos/control-request.ts`
- `packages/core/src/db-migrations.ts`
- `packages/api/src/routes/run-control.ts`
- `packages/api/src/lib/session-control.ts`
- `packages/harness/src/codex-app-server-handlers.ts`
- `packages/harness/src/codex-app-server-types.ts`
- `packages/harness/src/claude-hooks.ts`

Add canonical `control_request`, `control_response`, `control_cancel`, and
`control_timeout` records. Adapter-specific handlers should translate into
that shape before responding.

Migration: required if pending control state must survive process exit. That
is part of the requirement, so assume required.

Tests: package-level fakes for duplicate response, cancel, timeout, process
exit cleanup, and approval metadata. No provider session required.

### P3 - Command Path Validation

Owns:

- `packages/core/src/workflow-command-scope.ts`
- new parser module under `packages/core/src/`
- `packages/core/src/tests/workflow-command-scope.test.ts`

Keep the existing public validator and augment it with structured extraction:
`blockedPath`, `commandKind`, `reason`, and `safeSuggestion`.

Migration: not required.

Tests: core-only parser/validator tests. No API or harness test required.

### P4 - Reattach MVP

Owns:

- `packages/core/src/dispatcher-reconcile.ts`
- `packages/core/src/dispatcher-support.ts`
- `packages/harness/src/opencode.ts`
- OpenCode REST helpers and tests
- `packages/core/src/tests/dispatcher-reconcile.test.ts`

OpenCode is the first realistic adapter target because its session state lives
outside the Ductum process. Codex app-server and Claude SDK sessions are still
treated as not reattachable unless a later stage proves otherwise.

Migration: only required if P1/P2 do not already persist enough state. Prefer
using existing `session_run_mapping`, run stage, transcript seq, and control
records before adding another table.

Tests: OpenCode fake REST server plus dispatcher reconcile tests. No real
provider session required.

### P5 - Tool Semantics

Owns:

- `packages/core/src/tool-semantics.ts`
- `packages/core/src/workflow-command-scope.ts`
- `packages/api/src/lib/run-ops/enforcement.ts`
- harness adapter mapping helpers

Add a canonical registry for read-only, destructive, concurrency-safe,
approval-required, result-limit, interrupt, and permission-matcher semantics.

Migration: not required unless tools become user-configurable resources. Keep
Milestone scope as code registry.

Tests: core registry tests and enforcement mapping tests. No provider session
required.

### P6 - Large Result Artifacts

Owns:

- `packages/core/src/run-artifacts.ts`
- `packages/core/src/repos/run-artifacts.ts`
- `packages/core/src/db-migrations.ts`
- `packages/api/src/routes/runs.ts`
- `packages/harness/src/canonical-events.ts`
- `packages/harness/src/rest.ts`

Store oversized tool results once under a run-scoped artifact path. Transcript
and activity rows should hold stable previews and artifact pointers.

Migration: required for artifact index metadata.

Tests: repo/db tests, artifact writer tests, stable preview tests, no-overwrite
test. No provider session required.

### P7 - Terminal Evidence

Owns:

- `packages/core/src/harness-terminal.ts`
- `packages/core/src/dispatcher-session.ts`
- `packages/core/src/dispatcher-support.ts`
- `packages/api/src/lib/run-ops/evidence.ts`
- evidence kind tests

Add stable terminal codes such as `success`, `cancelled`, `approval_denied`,
`tool_failed`, `model_error`, `max_turns`, `max_budget`,
`structured_output_failed`, `transport_lost`, and `crashed`.

Migration: required if represented as a new evidence type. Prefer a dedicated
evidence type over stuffing terminal diagnostics into `custom`.

Tests: core mapping tests and API evidence tests. No provider session required.

### P8 - Schema-Bound Completions

Owns:

- `packages/core/src/structured-completion.ts`
- post-completion router modules
- MCP tool completion guards
- harness result mapping tests

Reviewer/fixer/verifier workflows should be able to require a typed final
payload and fail with `structured_output_failed` when it is missing or invalid.

Migration: not required if P7 terminal evidence exists.

Tests: fake completion payload tests and post-completion router tests. No
provider session required.

### P9 - Harness Chaos Tests

Owns:

- `packages/harness/src/tests/`
- test-only fake adapter/tool modules
- core dispatcher lifecycle tests

Add deterministic fake paths for always-allow, always-block, always-ask,
duplicate response, slow approval, crash mid-tool, hang until cancel, large
result, and restart-then-reattach.

Migration: not required.

Tests: package-level fakes only. This stage exists to avoid expensive real
provider sessions.

## Migration Summary

- Required: P1, P2, P6.
- Likely required: P7, if terminal evidence gets its own evidence kind.
- Conditional: P4, only if P1/P2 do not persist enough reattach state.
- Not required: P3, P5, P8, P9.

## Test Strategy

Most stages should use package-level fakes:

- P1: fake harness event source and crash-mid-event writer.
- P2: fake control request lifecycle, no real adapter process.
- P3: pure command parser tests.
- P4: fake OpenCode REST server plus dispatcher reconcile.
- P5: pure registry/enforcement tests.
- P6: tempdir artifact writer.
- P7: synthetic `HarnessSessionResult` mapping.
- P8: synthetic completion payloads.
- P9: fake adapters and fake tools by design.

Real provider sessions are not required for P1-P9 acceptance. Dogfooding can
run after the arc, but it should not be the gate for these stages.
