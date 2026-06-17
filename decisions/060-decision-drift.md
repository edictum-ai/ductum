# 060 - Decision Drift

## Status

Accepted

## Context

Ductum's value is not only that work gets done. Its value is that the factory
can explain why work was done that way.

That means Ductum must catch decision drift:

- implementation contradicts an active decision.
- a spec changes direction without superseding the old decision.
- a task adds scope without a recorded reason.
- a reviewer accepts behavior that conflicts with a non-goal.
- new evidence makes an old decision wrong, but no one records the change.

Silent drift is dangerous because it destroys the audit trail. Future operators
can see what shipped but not why the factory changed direction.

## Decision

Every meaningful spec, task, and run should be checked against the active
decision set.

When behavior drifts from a decision, Ductum must record:

- what changed.
- which decision or non-goal it drifted from.
- why the drift is justified.
- who or what proposed it.
- what evidence supports it.
- whether it supersedes, amends, or temporarily waives the old decision.

No silent drift. Drift is either rejected, explicitly approved, or recorded as
a pending decision.

## Drift Types

- `contradiction`: work violates an active decision.
- `scope-creep`: work adds capability outside the accepted scope.
- `stale-rationale`: the original reason is no longer true.
- `missing-rationale`: a choice appears in code/spec without a linked decision.
- `reference-envy`: a feature is copied from a reference system without a
  Ductum dogfood need.
- `non-goal-breach`: work implements something explicitly deferred.
- `verification-drift`: verification no longer proves the decision's intent.

## Workflow Rule

Each generated implementation prompt should include a "Decision Trace" section:

- linked active decisions.
- linked non-goals.
- allowed scope.
- expected verification.
- drift handling instruction: stop and record a pending decision if work needs
  to contradict or expand the trace.

Each review should include a decision-drift check:

- Does the diff match the linked decisions?
- Did any new scope appear?
- Did the implementation weaken a non-goal?
- Is the verification still aligned with the reason for the decision?
- If there is drift, is the "why" recorded?

## Edictum Boundary

Edictum should enforce decision workflow gates:

- no task import if blocking decisions are unresolved.
- no implementation run if the prompt lacks a decision trace.
- no ship if review finds unapproved decision drift.
- no waiver without an explicit decision record.

Ductum stores and coordinates the decision records. Edictum bounds the allowed
workflow transitions.

## Minimal Implementation Direction

Do not start with a large rule system.

Start with:

1. Add decision links to generated spec artifacts and task prompts.
2. Add a plain-text decision drift checklist to generated review prompts.
3. Record drift as `Decision` plus `Evidence` rows where the current API allows.
4. If the current API cannot represent this, add the smallest missing field or
   artifact format needed.

The first useful implementation can be markdown-backed. The important part is
that Ductum has a repeatable check and the "why" is saved.

## Non-Goals

- Do not build a second policy engine in Ductum.
- Do not require perfect formal traceability before dogfooding.
- Do not add complex graph analysis before simple linked decisions are working.
- Do not block all changes; block silent unreasoned changes.
