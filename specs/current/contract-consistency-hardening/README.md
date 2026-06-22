# Contract Consistency Hardening

## Intake

Ductum has repeated consistency failures when one product concept is represented
in several packages with separate local logic. The most recent example was
GPT-5.5 showing as unmeasured while GPT-5.4 worked, because model pricing,
scanner rates, API catalog data, and dashboard rendering were not owned by one
contract.

This spec hardens the boundaries so adding a model, run status, UI field, or
harness event does not require scattered edits that can drift.

## Decision Trace

- Qratum dogfooding is the execution wrapper for this work. The operator should
  run each prompt in Claude Code, then import the resulting transcript with
  Qratum.
- Ductum must prefer shared contracts and canonical DTOs at package boundaries.
- Interfaces are useful at real boundaries, but the goal is not interface
  ceremony. The goal is one owner for each externally consumed shape.
- Supply-chain posture remains mandatory: exact pins, frozen lockfile, no blind
  upgrades, no new dependency unless a decision records why it is needed.

## Behavior Contract

- API and dashboard must not define separate run UI contract shapes.
- Dashboard must not own canonical run status or cost meaning.
- Model pricing, scanner rates, and API model catalog must converge on one
  model registry.
- External API input must be validated before entering domain code. Avoid
  `as never` and unsafe enum casts on request bodies.
- Harness session and event contracts must have one owner or a documented
  import/re-export relationship.
- Unknown model cost must be explicit `unmeasured`; do not silently price an
  unknown model as GPT-5.4 or any other unrelated model.
- Public dashboard API responses must expose DTOs instead of raw domain models.
- Existing tests and file-size gates must remain green.

## Non-Goals

- Do not redesign the whole dashboard.
- Do not change database schema unless the prompt explicitly proves it is
  required.
- Do not add a schema validation dependency by default.
- Do not rewrite every route.
- Do not change Ductum workflow semantics.
- Do not loosen supply-chain rules.
- Do not exceed the 300 LOC file-size rule.

## Execution Order

| # | Prompt | Scope | Deliverable | Depends On |
|---|---|---|---|---|
| 0 | [P0-AUDIT-AND-DECISION.md](P0-AUDIT-AND-DECISION.md) | docs/tests inventory | Decision and exact target list | - |
| 1 | [P1-RUN-UI-CONTRACT.md](P1-RUN-UI-CONTRACT.md) | api/dashboard/shared contracts | One run UI DTO owner | P0 |
| 2 | [P2-MODEL-REGISTRY.md](P2-MODEL-REGISTRY.md) | core/api/scanner | One model registry and explicit unmeasured models | P1 |
| 3 | [P3-API-PARSERS.md](P3-API-PARSERS.md) | api routes | Safer request parsing in targeted routes | P0 |
| 4 | [P4-HARNESS-CONTRACTS.md](P4-HARNESS-CONTRACTS.md) | core/harness | Canonical harness session/event types | P0 |
| 5 | [P5-CONFORMANCE-GATES.md](P5-CONFORMANCE-GATES.md) | tests | Drift-catching contract tests | P1-P4 |

## Qratum Dogfood

Use [QRATUM-RUNBOOK.md](QRATUM-RUNBOOK.md) to run each prompt in Claude Code and
then import the transcript into Qratum.

Each prompt should produce one Qratum review. Do not combine all prompts into
one Claude Code session.

## Slop Review

- Did the implementation remove duplicated truth instead of only patching one
  screen?
- Did it avoid adding abstractions with no boundary?
- Did tests catch future drift?
- Did it preserve supply-chain constraints?
- Did it verify after the final edit?

## Verification

```sh
pnpm test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```
