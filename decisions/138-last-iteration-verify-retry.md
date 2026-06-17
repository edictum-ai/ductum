# Decision 138: Last-Iteration Verify Retry

Date: 2026-05-03

## Status

Accepted.

## Context

D115 Gap 10 identified a brittle fix-loop edge: when verification fails on the
last allowed fix iteration, Ductum immediately fails the root run. That can turn
transient verification flakes into terminal factory failures.

D135 keeps this in the agent-first control plane: the retry must be
machine-visible, bounded, and auditable.

## Decision

When a `fix-*` run fails verification and that fix round is the last allowed
round from `spec.maxFixIterations` or the factory default, Ductum retries the
same verification commands once before escalating the root run.

The retry is independent of the fix-iteration cap. It does not create another
fix task and it does not change `maxFixIterations`.

Each run records `verifyRetries`, backed by `runs.verify_retries`, so duplicate
post-completion routing cannot silently retry verification more than once for
the same run.

## Consequences

- A final fix that passes on the retry proceeds to review normally.
- A final fix that fails the retry follows the existing max-iteration failure
  path.
- Earlier fix rounds keep the existing behavior: a verification failure creates
  the next fix task.
