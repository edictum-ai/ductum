# P1 - Operator Run Outcome Closure

Implement explicit done outcome support for operator run close.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  and `103`.
- Non-goals: no new primitive/table/dependency; no automatic commit/evidence
  inference; no second policy system; no Edictum behavior change; no dashboard
  redesign.
- Allowed scope: run-close API input/output, CLI option, state-machine failure
  cleanup on done, behavioral tests, dogfood records, and review artifacts.
- Drift handling: record a decision before adding automatic reconcile,
  commit/evidence inference, a new table, a new status model, or dashboard work.

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

## Implementation Notes

- Prefer extending `closeRun` over adding a parallel endpoint.
- Keep `complete` unchanged.
- Keep CLI default `run-close` safe for failed/stalled cleanup.
- Use `RunStateMachine.markDone` for done close and existing `dag.onRunComplete`.

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
