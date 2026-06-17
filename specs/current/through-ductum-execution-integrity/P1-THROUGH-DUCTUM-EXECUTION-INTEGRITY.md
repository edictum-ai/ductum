# P1 - Through-Ductum Execution Integrity

Implement execution-integrity truth surfaces so Ductum stops presenting
externally recorded work as if it was orchestrated.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  `103`, `104`, `105`, `106`, and `107`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference; no automatic bakeoff acceptance; no Edictum behavior
  change.
- Allowed scope: core classifier, API scan and guards, CLI output, dashboard run
  badges, reconcile commit linkage, behavioral tests, dogfood records, and
  review artifacts.
- Drift handling: record a decision before adding storage, a new top-level
  primitive, broad success inference, policy behavior, or a second reconcile
  path.

## Behavior Contract

This prompt is bound to the source-of-truth Behavior Contract in `README.md`.
Implementation must satisfy every item there, especially:

- Task status API must reject manual done writes unless lineage or explicit
  external outcome evidence exists.
- Run integrity API must keep structured final evidence on non-done runs visible
  as inconsistent.
- Reconcile runtime must preserve visible main-branch merge commit links to the
  originating run without creating external outcome evidence.
- Bakeoff candidate task output must fail integrity checks until explicit
  accept/reject/fix outcome evidence exists.
- Dashboard run output must visibly show execution mode when API data includes
  it.
- Operator brief output must surface integrity contradictions as an
  operator-visible action.
- Evidence parser behavior must not count prose as success evidence; active or
  failed runs must stay visible as inconsistent when structured final evidence
  passes.

No new table, top-level primitive, dependency, policy system, or broad success
inference is allowed.

## Implementation Notes

- Keep the classifier in core so API, CLI tests, and future surfaces can share
  semantics.
- Use structured custom evidence kinds: `external-outcome` and
  `bakeoff-candidate-outcome`.
- Prefer one API scan endpoint and enriched run fields over parallel routing.
- Keep reconcile narrow: link commit SHA, record state-reconcile audit, and stop.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Can a commit be present without run/worktree/session lineage and still appear
  cleanly done?
- Can evidence text alone make failed work look successful?
- Can a bakeoff candidate remain terminal while the project appears complete?
- Are state integrity problems persistent and operator-visible?
- Are errors visible in API/CLI/UI, not only logs?
- Did this add duplicate reconcile logic or fake abstractions?
- Did it preserve Ductum as coordinator and Edictum as policy system?

## Verification

```sh
ductum spec contract-check ductum specs/current/through-ductum-execution-integrity --path
ductum spec drift-review ductum through-ductum-execution-integrity
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm --filter @ductum/dashboard test
pnpm build
git diff --check
```
