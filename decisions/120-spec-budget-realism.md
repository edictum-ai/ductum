---
date: 2026-05-01
status: implemented (2026-05-01)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 109, 114, 118
---

# Decision 120: Spec budget realism — default `perSpecHardUsd` to $200

## Context

P3.4 caps `factory.costBudget.perSpecHardUsd` at a value supported by
observed spec cost. The shipped default was unset, so the practical
floor was 0 — the dispatcher silently let any spec keep burning until
something (`agent-first-factory-readiness` at $145) blocked future
dispatches and forced a manual yaml edit at the worst moment.

`agent-first-factory-readiness` reaching $145 was the operational
trigger. Two more recent specs sit on the same shelf:

| Spec                                | Final cost (USD) | Notes |
|-------------------------------------|------------------|-------|
| `agent-first-factory-readiness`     | ~$145            | Blocked further dispatches until cap was raised. |
| `factory-readiness-recovery` (live) | ~$99 partial     | P3 itself is the second data point; running cost as of writing. |
| `factory-resource-model`            | ~$128 final      | Older spec; full cost across all impl tasks. |

Picking $100 (the prior unwritten convention) keeps the same
self-inflicted wound. Picking $500 hides cost runaways. The middle
that stays honest with observed reality is $200 — covers all three
specs above with headroom for an extra fix loop, and trips early
enough that a runaway gets a human eye before it triples the bill.

## Decision

**The default `perSpecHardUsd` is $200 USD when the operator does
not set the field in `ductum.yaml`.**

Setting `factory.costBudget.perSpecHardUsd: 0` (or any non-positive
number) explicitly disables the spec cap (treated as unset by
`enforceCostBudget`). This is the documented escape hatch for
operators who want the prior unbounded behavior.

The default is applied in `packages/api/src/index.ts` when parsing
`DUCTUM_COST_BUDGET`. The settings hot-reload path
(`packages/api/src/routes/settings.ts`) honors the explicit value
the operator typed; it does not re-apply the default mid-run because
the operator may have intentionally cleared the cap.

## Operator-visible projection

`ductum cost --spec <id>` and `ductum spec-cost <id>` now print:

- `spent` — sum of run cost across all tasks in the spec
- `cap` — current effective `perSpecHardUsd` (or the unset banner)
- `remaining` — `max(0, cap - spent)`
- `utilization` — percent of cap consumed
- `status` — `OK` (<80%), `WARN` (>=80%), `OVER` (>=100%)

Plus a one-line warning when status is `WARN` or `OVER` so the
operator sees the trajectory before the cap bites.

The new `/api/factory/cost-budget` endpoint exposes the live caps so
the dashboard's spec/run cards can surface the same projection
without a yaml round-trip.

## Slop-review attack: "default plucked from air"

The slop review demanded the default be measured, not plucked. The
table above lists the three most recent specs that crossed the cost
threshold conversation. $200 covers each with a safety margin and
sits below the next round number ($250) so a $200+ spec triggers an
operator decision instead of slipping past unnoticed.

If subsequent specs land consistently under $100, the floor should
drop. If they land consistently over $200, raise to $300 and document
the new evidence. The default is meant to track reality, not freeze.

## Alternatives considered

1. **Keep the default unset.** Rejected — the operational trigger for
   P3 was exactly this default. Unset means "the operator finds out
   when the runs go free into the wild and run up a credit card."
2. **Default to the highest observed cost ($150) plus 10%.** Rejected
   for being too tight — leaves no headroom for a single fix loop.
3. **Default per-project, not factory-wide.** Deferred. The current
   surface is one cap per spec, and projects already inherit the
   factory cap. Per-project caps belong with a projects-config rev,
   not P3.

## Surfaces shipped

- `packages/api/src/index.ts` — applies the $200 default when
  `DUCTUM_COST_BUDGET.perSpecHardUsd` is unset, missing, or
  unparseable. Treats `<= 0` as explicit unset.
- `packages/api/src/routes/factory.ts` — adds
  `GET /api/factory/cost-budget` returning the live caps.
- `packages/cli/src/api-client.ts`, `packages/cli/src/types.ts`,
  `packages/cli/src/tests/helpers.ts` — `getCostBudget()` client +
  test mock returning the $200 default.
- `packages/cli/src/commands/status.ts` — `cost --spec <id>` adds
  the projection block (Spec Budget section).
- `packages/cli/src/commands/factory-ops.ts` — `spec-cost <id>`
  prints the same projection block at the end of its output.

## Consequences

- Operators see a hard cap by default, which forces an honest
  conversation when the trajectory looks runaway.
- Operators who want the prior behavior (no cap) can opt out
  explicitly with `factory.costBudget.perSpecHardUsd: 0`.
- The dashboard and the CLI agree on the projected vs cap
  arithmetic via the new `/api/factory/cost-budget` route.
- Existing `ductum.yaml` files that already set
  `perSpecHardUsd` are unaffected — the explicit value still wins.
