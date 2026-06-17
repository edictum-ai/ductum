# Deploy Restart Guidance

## Intake

`ductum doctor --deploy`, operator guidance, the Telegram settings panel, and
operator-facing setup docs still mention restarting `pnpm serve` in
production-facing paths. That is a dev-shell command, not a deployment-neutral
operator instruction.

## Grill Questions

- Should Ductum detect the active process manager? No. This slice is wording
  only.
- Should startup scripts change? No. Runtime behavior and scripts stay as-is.
- Should every `pnpm serve` mention disappear from the repo? No. Tests,
  developer-only docs, and explicitly dev-only contexts can keep it. This slice
  is deploy/operator readiness output and setup recovery guidance.
- What should replace it? "restart the Ductum API" or a more specific
  deployment-neutral action.

## Decisions

- Add decision `096` for deployment-neutral restart guidance.
- Update deploy doctor, operator readiness output, Telegram settings setup text,
  dogfood prompt wording, and public setup recovery docs away from `pnpm serve`.
- Preserve `pnpm build` when build is the actual command.
- Keep runtime behavior unchanged.

## Decision Trace

- Decisions: `058`, `059`, `060`, `064`, `066`, `087`, `091`, `095`, and
  `096`.
- Non-goals: no process manager integration, startup script change, new
  dependency, table, provider branch, Edictum change, or policy behavior.
- Allowed scope: CLI/API deploy doctor/operator messages, Telegram settings
  restart guidance, setup docs, dogfood records, tests, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/deploy-restart-guidance --path`,
  `ductum spec drift-review ductum deploy-restart-guidance`,
  package tests for API/CLI/dashboard, `pnpm build`, `git diff --check`, and
  adversarial slop review.
- Drift handling: record a new decision before adding process-manager
  detection, changing startup scripts, or wiring deployment platform behavior.

## Behavior Contract

- CLI deploy doctor output must not tell operators to restart `pnpm serve`.
- CLI deploy doctor operator-token output must preserve visible
  deployment-neutral Ductum API restart wording.
- CLI deploy doctor dispatcher output must preserve visible deployment-neutral
  Ductum API restart wording.
- CLI deploy doctor harness-adapter recovery must preserve `pnpm build` while
  using deployment-neutral restart wording afterward.
- CLI operator brief Telegram setup output must preserve visible
  deployment-neutral Ductum API restart wording.
- API operator brief dispatcher output must preserve visible deployment-neutral
  Ductum API restart wording.
- Dashboard Telegram setup output must preserve visible deployment-neutral
  Ductum API restart wording.
- API operator brief output must preserve dispatcher disabled and stopped states
  as visible recommended actions.
- Dashboard Telegram setup output must preserve the chat-id discovery command and
  must not hide missing runtime fields.
- Public setup operator recovery docs must preserve visible deployment-neutral
  Ductum API restart wording for recovery steps.
- Dogfood prompt fixtures that encode current operator guidance must preserve
  deployment-neutral Ductum API restart wording.
- Operator-visible readiness output must not contain `pnpm serve` when reporting
  deploy or setup recovery steps.
- CLI deploy doctor must preserve fail/warn/ok status behavior while changing
  restart text.
- CLI deploy doctor must fail loudly for the same readiness blockers as before;
  this slice must not turn a previous failure into a warning or pass.
- CLI operator output must preserve existing Telegram setup next steps while
  changing only restart wording.
- CLI output must not silently hide dispatcher or operator-token failures behind
  softer restart text.
- CLI output must not introduce a fake process manager, service supervisor, or
  deployment platform branch.
- Runtime behavior, dispatcher behavior, startup scripts, and Edictum policy
  behavior must remain unchanged.
- The slice must not add dependencies, tables, provider branches, or policy
  behavior.
- Tests must prove operator-visible output behavior, not only helper shape.

## Slop Review

- Did every Behavior Contract item get behavioral tests or explicit evidence?
- Are tests behavioral, not just shape checks?
- Did reviewers attack shape-correct but behavior-empty wording changes?
- Did reviewers attack lingering dev-only `pnpm serve` guidance in deploy
  output?
- Did the implementation change only guidance text and not runtime behavior?
- Did any path swallow or downgrade readiness failures?
- Did it add fake process-manager detection or deployment branches?
- Did it add dead config branches for future deployment managers?
- Did status behavior stay the same?
- Did output avoid introducing new commands that operators cannot run?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-DEPLOY-RESTART-GUIDANCE.md](P1-DEPLOY-RESTART-GUIDANCE.md) | api/cli/dashboard/docs | Deploy/operator restart guidance and tests | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `gFIQEK5046CF`.
- Task imported into Ductum: `pqnUDU6tU7Xg`.
- Run opened in Ductum: `9ag6q5obM-DL`.
- Decision recorded in Ductum: `rBkzJJ6mes2F`.
- Evidence recorded: `GuGe525b3Mrh`, `UxgBFsDIkmEu`, `mQ60SKFC_yVs`,
  `fVScCiN0jW6K`, `eSS-K7Cxa0w8`, `06OhaIRO-uTc`, `QEOU3O9JqYKo`,
  `IDZm84nNnDkg`.
- Final slop review: Claude PASS on the latest working tree.

## Verification

```sh
ductum spec contract-check ductum specs/current/deploy-restart-guidance --path
ductum spec drift-review ductum deploy-restart-guidance
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm --filter @ductum/dashboard test
rg 'restart .*pnpm serve|restart `pnpm serve`|restart pnpm serve' packages/api/src/lib packages/cli/src/commands packages/dashboard/src/settings docs/SETUP.md specs/dogfood-live
pnpm build
git diff --check
```
