# Complete No-Op Visibility

## Intake

Dogfooding exposed that `ductum complete <runId>` can return a 200 response
with an unchanged run when the run is not `done` and has no live session. That
left already-committed work as active tasks and caused duplicate retries.

## Grill Questions

- Should `ductum.complete` force a run done? No. It is a signal to end a live
  harness session, and Edictum plus the dispatcher still own the normal
  completion pipeline.
- What is the smallest production fix? Reject completion attempts that cannot
  change runtime state.
- What evidence proves the gap? Public URL, dispatcher readiness, and prompt
  doctor dogfood runs required `run-close` plus task status edits because
  `complete` returned unchanged run payloads.
- What remains unchanged? Dispatcher session mapping ownership, Edictum policy
  checks, review/verify routing, and approval merge behavior.

## Decisions

- Add decision `092` for completion no-op visibility.
- Keep `ductum.complete` as a live-session completion signal.
- Fail non-`done` completion when there is no live dispatcher session.
- Fail terminal failed or stalled completion.
- Preserve existing `done`-stage DAG/task finalization.

## Decision Trace

- Decisions: `053` through `092`, especially `060`, `064`, `066`, `067`,
  `070`, `080`, `081`, `082`, `087`, `090`, `091`, and `092`.
- Non-goals: no new primitive, table, Operation, WorkOrder, second policy
  system, Edictum change, dispatcher session mapping ownership change, or
  operator force-complete path.
- Allowed scope: API complete semantics, dispatcher live-session visibility,
  CLI/API-visible error behavior, tests, dogfood records, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/complete-noop-visibility --path`,
  `ductum spec drift-review ductum complete-noop-visibility`,
  `pnpm --filter @ductum/api test`, `pnpm --filter @ductum/cli test`,
  `pnpm build`, `git diff --check`, and adversarial slop review.
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

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are no-session and terminal completion attempts loud failures?
- Did invalid completion avoid progress-update side effects?
- Did live-session completion still request session end?
- Did done-stage completion still update DAG/task state?
- Did the implementation avoid a force-complete bypass around Edictum?
- Did it preserve dispatcher ownership of session mappings?
- Did it avoid new dependencies, tables, fake abstractions, and policy logic?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-COMPLETE-NOOP-VISIBILITY.md](P1-COMPLETE-NOOP-VISIBILITY.md) | api, cli | Completion error behavior, live-session detection, tests, evidence | [x] | - |

## Dogfood Record

- Imported spec: `h9eFKmkOKiKE`.
- Imported task: `A4xCocHdcxWW`.
- Run: `xHzVcMwC99k0` auto-dispatched to `glm`.
- Decision record: `vTHhRYHs36Sf`.
- Spec audit evidence: `4CYLDXMeBlus`.
- Verification evidence: `rrhSdGZE5scb`.
- Adversarial review: Claude produced no output after 120 seconds and was
  terminated; local slop review found and fixed invalid-complete PR auto-link
  mutation before failing.

## Verification

```sh
ductum spec contract-check ductum specs/current/complete-noop-visibility --path
ductum spec drift-review ductum complete-noop-visibility
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
