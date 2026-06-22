# Harness Durability And Protocol Hardening

## Intake

Ductum has the right harness spine: dispatcher-owned runs, per-run MCP,
pre/post tool interception, heartbeats, session ids, cost deltas, workflow
gates, and post-completion routing.

The gaps are durability and protocol hardening:

- no replayable normalized transcript per run
- adapter-local control request/response handling
- `tryReattach` exists but real adapters mostly cannot resume
- tool policy depends too much on names and regexes
- large tool results are truncated into activity instead of stored as artifacts
- terminal diagnostics are not consistently first-class evidence
- reviewer/fixer terminal payloads are still too text-shaped
- restart/duplicate/slow approval paths need fake harness coverage

## Sanitized External Feedback

The operator inspected another harness implementation and provided sanitized
requirements. Do not inspect or cite that source in this repo. The requirements
below are the only accepted input from that review:

- Persist durable run transcripts with ordered sequence numbers, causality ids,
  payload previews, and artifact pointers.
- Treat control requests as durable lifecycle objects with request ids,
  response/cancel/timeout states, duplicate suppression, and pending cleanup on
  process exit.
- Reattach needs persisted adapter session id, run id, phase, pending control
  requests, transcript pointer, last event sequence, and transport state.
- Tool metadata should include read-only/destructive/concurrency/approval/
  result-limit/interrupt semantics.
- Command validation needs parser-aware path extraction for dangerous removals,
  path flags, `--`, cwd-changing compounds, symlinks, and platform shell cases.
- Large tool results should be stored once as run artifacts with stable previews
  and byte counts.
- Terminal failures need stable codes instead of only free-form text.
- Schema-bound completions should fail clearly when required terminal payloads
  are missing or invalid.
- Fake harness tools should deterministically exercise approval, deny, cancel,
  crash, hang, and large-result paths.

## Decision Trace

- ADR 0121 introduced restart reconciliation and `tryReattach`.
- ADR 0135 made harness control agent-first and structurally enforced.
- ADR 0145 added operator cancel control.
- ADR 0162 and ADR 0163 added boundary conformance gates.
- ADR 0164 accepts this hardening arc.

Local Ductum code to inspect:

- `packages/harness/src/claude.ts`
- `packages/harness/src/codex-app-server-handlers.ts`
- `packages/core/src/dispatcher-support.ts`
- `packages/core/src/workflow-command-scope.ts`

## Behavior Contract

- Ductum records enough normalized run events to replay or inspect a run after
  process restart.
- Control messages have request ids, terminal states, cancellation semantics,
  timeout handling, and duplicate response suppression.
- At least one real adapter proves `tryReattach` before restart durability is
  advertised as supported.
- Tool authorization can inspect canonical tool semantics, not only tool names.
- Command/path validation has executable tests for high-risk shell patterns.
- Large tool results are stored as artifacts with activity previews.
- Terminal harness failures produce structured evidence.
- Reviewer/fixer/verifier completions can be machine-checked where required.
- Fake harness tests cover slow, duplicate, blocked, crashed, and reattached
  control paths.

## Non-Goals

- Do not replace the dispatcher.
- Do not replace Edictum workflow gates.
- Do not rewrite every harness in one prompt.
- Do not add a database migration unless a stage proves it is required.
- Do not add dependencies by default.
- Keep implementation work grounded in Ductum source, explicit product
  requirements, public protocol behavior, and local tests.
- Do not loosen supply-chain rules.
- Do not exceed the 300 LOC file-size rule.

## Execution Order

| # | Prompt | Scope | Deliverable |
|---|---|---|---|
| 0 | [P0-AUDIT-AND-SLICES.md](P0-AUDIT-AND-SLICES.md) | audit/plan | exact target list and risk notes |
| 1 | [P1-RUN-TRANSCRIPT-LOG.md](P1-RUN-TRANSCRIPT-LOG.md) | core/api | replayable normalized run transcript |
| 2 | [P2-CONTROL-PROTOCOL.md](P2-CONTROL-PROTOCOL.md) | core/harness | adapter-independent control messages |
| 3 | [P3-COMMAND-PATH-VALIDATION.md](P3-COMMAND-PATH-VALIDATION.md) | core/tests | parser-aware command/path safety |
| 4 | [P4-REATTACH-MVP.md](P4-REATTACH-MVP.md) | core/harness | one real adapter reattach path |
| 5 | [P5-TOOL-SEMANTICS.md](P5-TOOL-SEMANTICS.md) | core | canonical tool semantics registry |
| 6 | [P6-LARGE-RESULT-ARTIFACTS.md](P6-LARGE-RESULT-ARTIFACTS.md) | core/api/harness | artifact-backed large tool results |
| 7 | [P7-TERMINAL-EVIDENCE.md](P7-TERMINAL-EVIDENCE.md) | core/api | structured failure taxonomy |
| 8 | [P8-SCHEMA-BOUND-COMPLETIONS.md](P8-SCHEMA-BOUND-COMPLETIONS.md) | core/harness | typed terminal payloads |
| 9 | [P9-HARNESS-CHAOS-TESTS.md](P9-HARNESS-CHAOS-TESTS.md) | tests | fake harness control-path coverage |

## Verification

Each prompt carries its own package-level verification. Before closing the arc:

```sh
pnpm test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```
