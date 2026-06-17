# 103 - Operator Run Outcome Closure

## Status

Accepted

## Context

Ductum can have verified and committed work whose harness session is already
gone. The `complete` command refuses those runs because they are not live and
not already in `done`, while `run-close` only marks them `failed`.

That creates false state: evidence, commit history, and spec records say the
slice passed, but the run row says failed. This is now a bigger trust problem
than another resource type.

## Decision

- Keep `complete` as the harness/session completion path.
- Keep `run-close` default behavior as a failed operator close.
- Add an explicit operator close outcome for done work: API body
  `outcome: "done"` and CLI `ductum run-close <runId> --done --reason ...`.
- Closing as done must use the existing `RunStateMachine.markDone` path,
  clear stale failure metadata, call existing DAG completion handling, dispose
  runtime, and record an operator-visible run update.
- `RunStateMachine.markDone` owns the done-state invariant: a done run must not
  retain stale `failReason`, `terminalState`, blocked approval metadata, or
  non-recoverable failure state. Existing tests already allowed markDone to
  recover a failed terminal run; this decision documents the invariant instead
  of adding a parallel operator-only state transition.
- Closing as done must be explicit; Ductum must not infer success from commits,
  evidence, or review text in this slice.

## Why

Operators need a truthful way to reconcile externally verified dogfood work
without corrupting the run as failed. The smallest production step is explicit
outcome selection on an existing operator close path, not a new table or a broad
automatic reconcile system.

## Non-Goals

- No new top-level primitive, table, dependency, policy system, or marketplace.
- No automatic "commit evidence means done" inference.
- No broad operator dashboard redesign.
- No change to Edictum policy enforcement.
- No change to session-to-run mapping ownership.
