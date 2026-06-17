# Operator Run Outcome Closure

## Intake

Ductum's dogfood state can lie after an out-of-band verified slice: `complete`
rejects non-live runs, and `run-close` only marks them failed. The result is a
run table that says failed even when evidence, review, and git history say done.

## Grill Questions

- Should Ductum infer done from commit or review evidence? No. That belongs in a
  later reconcile slice.
- Should this add a new closure table? No. Existing run state, run updates, DAG,
  and evidence are enough for this slice.
- Should `complete` change semantics? No. It remains the agent/session
  completion path.
- Should failed close behavior change by default? No. Operators must opt into a
  done close explicitly.

## Decisions

- Add decision `103` for explicit operator close outcomes.
- Extend the existing run close API with `outcome: "failed" | "done"`.
- Add CLI `ductum run-close --done`.
- Use existing `RunStateMachine.markDone` and DAG completion handling.
- Clear stale failure metadata when a run is closed as done.
- Treat `RunStateMachine.markDone` as the shared done-state invariant so done
  runs do not retain stale failed metadata.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  and `103`.
- Non-goals: no new primitive/table/dependency; no automatic commit/evidence
  inference; no second policy system; no Edictum behavior change; no dashboard
  redesign.
- Allowed scope: run-close API input/output, CLI option, state-machine failure
  cleanup on done, behavioral tests, dogfood records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/operator-run-outcome-closure --path`,
  `ductum spec drift-review ductum operator-run-outcome-closure`, package tests,
  build, `git diff --check`, and adversarial slop review.
- Drift handling: record a decision before adding automatic reconcile,
  commit/evidence inference, a new table, a new status model, or a dashboard
  redesign.

## Behavior Contract

- CLI `run-close` without `--done` must preserve existing failed-close behavior.
- API close without `outcome` must preserve existing failed-close behavior.
- API runtime close with `outcome: "done"` must mark the run `stage: done` with no terminal failure.
- API close with an unknown `outcome` must fail visibly and must not mutate the run.
- API close with missing `reason` must keep the existing visible validation failure.
- CLI `ductum run-close --done --reason ...` must dispatch `outcome: "done"` to the API runtime close path.
- Run done close must clear stale `failReason` with visible runtime state and reset stale non-recoverable failure state.
- Run done close must clear pending approval and blocked metadata with visible runtime state.
- Run done close must dispatch existing DAG completion handling so the task can become done.
- Run done close must record an operator-visible run update that says the run was closed as done.
- Run done close must not silently leave the task active when DAG completion can mark it done.
- Run failed close must continue to record an operator-visible failed close update.
- Run failed close must continue to mark the task failed and preserve the existing operator cleanup path.
- Run lineage close must dispatch the existing failed lineage cleanup path for failed closes.
- Run done close with lineage cleanup must close stale non-live descendants with visible run updates.
- Run closure must not infer done from commit, evidence, review text, or spec status.
- Run closure must not add a new table, primitive, dependency, or policy system.
- Tests must prove run behavior, not just response shape.

## Slop Review

- Did behavioral tests prove explicit done close avoids false failed state?
- Did behavioral tests prove default close remains failed?
- Did behavioral tests attack invalid outcomes and missing or invalid inputs?
- Did behavioral tests prove no automatic success inference from commit/evidence/review text?
- Did explicit evidence prove the implementation reuses existing state machine and DAG paths?
- Did behavioral tests prove done close clears stale failure metadata?
- Did behavioral tests prove done close with lineage closes stale non-live descendants?
- Did behavioral tests prove operator output makes the selected outcome visible?
- Did the implementation avoid duplicate routing logic, dead config branches, and future features?
- Are tests behavioral and stateful rather than response-shape checks?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-OPERATOR-RUN-OUTCOME-CLOSURE.md](P1-OPERATOR-RUN-OUTCOME-CLOSURE.md) | core/api/cli | Explicit done outcome for operator run close | API/CLI state-truth closure | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `Y47OWVWaSiHp`.
- Task imported into Ductum: `XfrOqtOvfnNJ`.
- Run opened in Ductum: `lm7SWnjgp2in`.
- Decision recorded in Ductum: `v-IMgrn83bh4`.
- Verification evidence recorded: `VDqORzT1jPN6`.
- Final slop review: PASS, recorded as evidence `l7jhovkBAEwU`.

## Verification

```sh
ductum spec contract-check ductum specs/current/operator-run-outcome-closure --path
ductum spec drift-review ductum operator-run-outcome-closure
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
