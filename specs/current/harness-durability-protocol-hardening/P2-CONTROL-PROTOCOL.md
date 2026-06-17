# P2 - Control Protocol

You are working in `/Users/acartagena/project/ductum`.

## Goal

Create an adapter-independent control protocol for tool approvals and host
requests.

## Required Work

- Define canonical control message types:
  - `control_request`
  - `control_response`
  - `control_cancel`
  - `control_timeout`
- Include request id, run id, harness session id when known, method, payload,
  timestamp, and terminal state.
- Include `toolUseId` or equivalent adapter causality id when the adapter
  provides one.
- Preserve decision reason, blocked path, and suggested action fields when
  authorization denies a request.
- Route Codex app-server approval requests through the canonical shape.
- Route Claude hook permission events through the same conceptual API where
  practical.
- Add duplicate response suppression tests.
- Add cancellation and timeout tests.
- Reject or resolve all pending control requests when the harness process exits.

## Behavior Contract

- Every control request has one terminal outcome.
- Duplicate responses do not double-advance state.
- Cancellation is explicit, not inferred from missing data.
- Pending requests cannot leak promises/state after process exit.
- Adapter-specific protocol details stay behind adapter mappers.

## Non-Goals

Do not rewrite every harness in this stage.
Do not change workflow authorization policy.
Do not expose `authorize_tool` as an agent-visible tool.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/harness test
pnpm --filter @ductum/api test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- canonical control message shape
- adapter paths migrated
- duplicate/cancel/timeout tests
- pending cleanup behavior
- behavior intentionally left adapter-local
- verification commands run
