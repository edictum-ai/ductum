# 101 - Spec Import Validation and Apply Visibility

## Status

Accepted

## Context

Decision `100` routes `kind: Spec` resource documents through the existing
spec import path. That shared path exposed two drift risks:

- invalid Spec-level fields could be accepted by legacy import and resource
  apply even though task fields were already validated;
- resource apply could write earlier documents or partial Spec tasks, then fail
  without showing the operator what had already landed.

## Decision

- Validate Spec-level `status` against the core Spec status set.
- Reject invalid `maxFixIterations` instead of silently dropping it.
- Reject empty task `target` and `assignedAgent` refs before API writes.
- Reject duplicate task names before API writes so dependency refs cannot point
  at whichever duplicate was created last.
- Keep the legacy default of `approved` when Spec status is omitted.
- Stream Spec import messages as work happens in text mode for both
  `spec import` and `resource apply`.
- In JSON mode, return collected progress messages as structured JSON instead
  of mixing human progress text into stdout.
- On `resource apply` failure after earlier documents succeeded, print/return
  the partial applied rows and collected Spec messages before surfacing the
  error.

## Why

The declarative resource surface should fail malformed inputs loudly and should
not leave operators blind to partial state in the intentionally
non-transactional apply pipeline. JSON mode must stay machine-readable even
when a later write fails after partial progress.

## Non-Goals

- No rollback or transaction coordinator.
- No new table, primitive, dependency, or policy system.
- No change to the omitted-status default in this slice.
- No standalone Task resource documents.
