# P1 - Complete No-Op Visibility

Implement loud failures for completion attempts that cannot change run state.

## Decision Trace

- Decisions: `053` through `092`, especially `060`, `064`, `066`, `067`,
  `070`, `080`, `081`, `082`, `087`, `090`, `091`, and `092`.
- Non-goals: no new primitive, table, Operation, WorkOrder, second policy
  system, Edictum change, dispatcher session mapping ownership change, or
  operator force-complete path.
- Allowed scope: API complete semantics, dispatcher live-session visibility,
  CLI/API-visible error behavior, tests, dogfood records, and evidence.
- Drift handling: record a new decision before turning completion into an
  operator force-close path or changing policy/session ownership.

## Behavior Contract

- API completion of a non-`done` run with a live dispatcher session must
  preserve runtime behavior by recording the result and requesting clean
  session end.
- API completion of a non-`done` run with no live dispatcher session must fail
  loudly with an API/CLI-visible error.
- CLI completion of a non-`done` run with no live dispatcher session must exit
  nonzero and show the API error.
- API completion of a failed terminal run must fail loudly.
- API completion of a stalled terminal run must fail loudly.
- API completion of an approval-pending run must fail loudly.
- API invalid completion attempts must not record progress as if completion
  succeeded.
- API invalid completion attempts must not return an unchanged run as success.
- API completion of an already `done` run must preserve existing DAG/task
  finalization.
- Runtime errors from invalid completion must be visible in operator output, not
  only logs.
- Dispatcher live-session checks must not read, create, or mutate
  session-to-run mappings.
- Run completion errors must preserve existing JSON error payload behavior.
- This slice must not bypass Edictum workflow policy.
- This slice must not expose `authorize_tool` or change `gate_check`.
- This slice must not make anything except the dispatcher own session mappings.
- This slice must not add dependencies, tables, or new top-level primitives.

## Implementation Notes

- Add live-session visibility to the API context by delegating to the
  dispatcher, not by reading or mutating session mappings.
- Keep `ductum.complete` as a signal for active sessions.
- Validate before recording progress on invalid completion attempts.
- Preserve clean session teardown timing so tool responses can still flush.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are no-session and terminal completion attempts loud failures?
- Did invalid completion avoid progress-update side effects?
- Did live-session completion still request session end?
- Did done-stage completion still update DAG/task state?
- Did the implementation avoid a force-complete bypass around Edictum?
- Did it preserve dispatcher ownership of session mappings?
- Did it avoid new dependencies, tables, fake abstractions, and policy logic?

## Verification

```sh
ductum spec contract-check ductum specs/current/complete-noop-visibility --path
ductum spec drift-review ductum complete-noop-visibility
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
