# P4 - Reattach MVP

You are working in `/Users/acartagena/project/ductum`.

## Goal

Implement real `tryReattach` support for one restart-capable harness path.

## Required Work

- Pick the adapter with the smallest honest reattach surface.
- Persist the minimal state needed to reattach safely: adapter session id, run
  id, current phase, pending control requests, transcript pointer, last event
  sequence, and process/transport state where available.
- Implement `tryReattach` for that adapter.
- Add reconciliation tests proving:
  - live session reattaches
  - expired/missing session returns `null`
  - reattach error marks the run stalled with explicit reason
  - control token and run/session binding are preserved
  - permanent disconnects do not retry forever
  - transient disconnects get a recoverable disconnected state before final
    failure

## Behavior Contract

- Reattach never creates a second active run for the same session.
- Reattach never trusts a session id from an agent prompt.
- Pending control requests survive or fail visibly across reattach.
- A failed reattach is visible and recoverable.

## Non-Goals

Do not claim all adapters are restart-durable.
Do not implement best-effort fake resume that loses conversation context.
Do not skip the existing reconciler.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/harness test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- adapter selected and why
- persisted reattach state
- success/failure behavior
- tests added
- verification commands run
