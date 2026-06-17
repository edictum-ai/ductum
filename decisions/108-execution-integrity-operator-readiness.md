# 108 - Execution Integrity Operator Readiness

## Status

Accepted

## Context

Decision `107` added the shared execution-integrity classifier and exposed the
first API, CLI, dashboard, and operator-brief surfaces. That closed the core
truth gap, but the operator experience is still too thin for production
readiness: a count or terse badge can tell an operator that something is wrong
without showing which mode or contradiction needs action.

The through-Ductum slice also needs a completed adversarial PASS. A hung review
attempt is evidence that review was attempted, not a passing review.

## Decision

Harden execution-integrity operator readiness over the existing classifier and
storage:

- Keep the shared core classifier as the only execution-integrity authority.
- Surface integrity summaries and sampled contradictions in the operator brief.
- Make CLI output show counts and rows for every execution mode:
  `orchestrated`, `external`, `recorded`, `unknown`, and `inconsistent`.
- Make dashboard run/spec/task rows show execution modes and warnings using
  API-provided integrity fields.
- Document deployment/readiness checks that operators can run before trusting a
  factory state.
- Require a real adversarial PASS for execution-integrity readiness, or record
  unresolved findings as follow-up tasks with evidence.

`toolsRef` and `policyRef` remain metadata-only in this slice. Runtime toolset
or policy behavior would need a separate dogfood case, a decision that keeps
Edictum as the policy system, and implementation evidence. This readiness
slice does not need new tool or policy semantics to close the current operator
visibility gap.

## Why

This keeps Ductum as coordinator and recorder of state while Edictum remains the
policy system. Operators need truthful visibility into existing execution
states before Ductum grows another runtime ref.

## Non-Goals

- No new table, top-level primitive, dependency, marketplace, or plugin system.
- No Edictum policy change or second policy system.
- No `toolsRef` runtime behavior.
- No `policyRef` runtime enforcement.
- No broad success inference from evidence text, review prose, or spec text.
- No duplicate reconcile or execution-integrity classifier.
- No automatic bakeoff acceptance.
