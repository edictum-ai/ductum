# 105 - Reconcile Side-Effect Failure Surface

## Status

Accepted

## Context

Audited reconciliation now performs post-commit side effects after repairs that
mark runs done. Those side effects can fail after the primary repair and audit
have already committed. Treating an audit failure for those side-effect failures
as a thrown exception drops structured reconcile output.

## Decision

- Reconcile must attempt every post-commit side effect for the repaired batch.
- A side-effect failure with a successful audit is returned in
  `sideEffectFailures`.
- A side-effect failure whose audit write fails is returned in
  `sideEffectAuditFailures` with the original side-effect error and audit error.
- Primary repair audit failures still fail loudly and roll back the repair
  transaction.

## Why

Once the primary repair commits, the operator needs one structured response that
explains both successfully audited side-effect failures and audit-write failures.
Throwing away the response makes the failure less inspectable.

## Non-Goals

- No new table, primitive, dependency, or retry queue.
- No second policy system.
- No broader workflow graph analysis.
