# P16 - Complete Post Completion Fallback

## Problem

Runs `7OqZDPrgAhLr` and `Qr5o9e55D-Pb` called `ductum.complete` or the CLI
`complete` flow, but remained in `implement` with no live dispatcher session.

Observed cause:

```ts
private scheduleCompletionFallback(runId: RunId): void {
  ...
  if (this.handledSessionEnds.has(runId) || !this.activeSessions.has(runId)) return
  ...
  void this.handleSessionEnd(runId, { exitReason: 'completed', ... })
}
```

If the harness removes the active session before `handleSessionEnd` routes
post-completion, the fallback exits early and the run stays active forever.

## Behavior Contract

- `ductum.complete` must deterministically drive post-completion routing even
  when the harness session has already disappeared.
- The fallback must remain idempotent: it must not double-route a run already
  handled by `handleSessionEnd`.
- A run with no active session and no terminal state must not remain in
  `implement` after a successful `ductum.complete`.
- Keep dispatcher-owned post-completion semantics: verification, review/fix, and
  ship readiness still go through `PostCompletionRouter`.
- Do not add tables, dependencies, or a second completion path.

## Verification

```sh
pnpm --filter @ductum/core test -- dispatcher
pnpm --filter @ductum/api test -- run-complete routes
pnpm build
pnpm test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

## Decision Trace

- Decision `053`: runs and evidence are the factory truth.
- Decision `060`: dogfood drift must become explicit work.
- Decision `108`: operator-visible state must not lie about live work.

## Slop Review

- Attack fixes that mark runs done without verification/review routing.
- Attack fallback code that can route post-completion twice.
- Attack tests that do not reproduce the missing-active-session case.
