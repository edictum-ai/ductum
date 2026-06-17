# Approval Deny Resume Gap

## Decision Trace

- decisions/053-factory-resource-model.md
- decisions/060-decision-drift.md
- decisions/104-audited-state-reconciliation.md
- decisions/106-state-convergence-reconcile.md
- decisions/108-execution-integrity-operator-readiness.md

## Behavior Contract

- Denying an approval must not leave a root run active without a live session.
- The next command after denial must be explicit: resumed run, created fix task,
  retry command, or blocked operator action.
- Queue, dispatcher status, and integrity output must agree on whether work is
  live, stale, or waiting for an operator.

## Evidence

- Run `6Z2hIMk_Tdkf` was denied because its branch did not contain current
  `main`.
- The run moved from `ship` back to `implement`, but `dispatcher status`
  reported fewer live active sessions than `queue`.
- The run had to be closed with `run-close` and retried to get a fresh run from
  current `main`.

## Task

Fix the approval-denial path so stale approval rejection produces an actionable
and truthful next state without relying on orphan timeout or manual close/retry.

## Implemented Guard

- `rejectRun` no longer resets the run back to `implement` with no live
  session.
- Denial records the operator reason, clears approval state, terminal-fails the
  run with recoverable failure metadata, and disposes the workflow runtime.
- The CLI denial output now prints the next concrete command:
  `retry <runId>`.
