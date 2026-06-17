# P4 - Decision Drift Review

## Scope

Create a repeatable review prompt/checklist that checks generated prompts and
implementation diffs against active decisions and non-goals.

## Decision Trace

- Decisions: `059`, `060`, `061`, `063`, `064`.
- Non-goals: no graph analyzer; no second policy engine; no perfect formal
  traceability requirement.
- Allowed scope: markdown-backed checklist, review task prompt, and recorded
  decision/evidence rows where current API supports them.
- Verification: imported review task includes Decision Trace and drift format.
- Drift handling: any accepted contradiction, scope creep, or non-goal breach
  must be recorded as a decision, waiver, or amendment with evidence.

## Behavior Contract

- A task prompt missing Decision Trace must be reported in CLI output.
- A generated review prompt missing Decision Trace Audit, Contract Coverage
  Audit, Slop Review, or Drift Record Format must be treated as incomplete in
  dogfood evidence.
- Drift approval without a recorded why must be reported as invalid review
  evidence.
- Review output that claims Ductum policy enforcement instead of Edictum must
  be rejected as decision drift.
- Missing prompt coverage hidden from CLI output must fail the dogfood review.
- A Drift Record without evidence must be reported as invalid review output.

## Checklist

- Does the diff match linked decisions?
- Did new scope appear?
- Did the implementation weaken a non-goal?
- Is verification still aligned with the decision reason?
- If there is drift, is the why recorded?

## Slop Review

- Did every Behavior Contract item get a behavioral test or dogfood evidence?
- Are missing Decision Trace warnings visible in CLI output?
- Did this add a second policy engine or graph analyzer?
- Did the implementation add an abstraction with only one caller and no
  boundary?

## Dogfood

Run `ductum spec drift-review ductum factory-resource-model`. The generated
review prompt must include a Decision Trace, Decision Trace Audit, Review
Checklist, and Drift Record Format, then record the output as evidence on the
P4 run.
