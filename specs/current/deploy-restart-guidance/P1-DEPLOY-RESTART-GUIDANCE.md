# P1 - Deploy Restart Guidance

Replace dev-only restart wording in deploy/operator readiness output, Telegram
setup UI, and operator-facing setup docs.

## Decision Trace

- Decisions: `058`, `059`, `060`, `064`, `066`, `087`, `091`, `095`, and
  `096`.
- Non-goals: no process manager integration, startup script change, new
  dependency, table, provider branch, Edictum change, or policy behavior.
- Allowed scope: CLI/API deploy doctor/operator messages, Telegram settings
  restart guidance, setup docs, dogfood records, tests, and evidence.
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

## Implementation Notes

- Change user-facing strings only.
- Keep `pnpm build` where the build command is still the actual next action.
- Add tests that assert deploy/operator/dashboard setup output no longer
  contains `pnpm serve` in readiness guidance.
- Use `rg` evidence for setup docs and dogfood prompt fixtures.

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
