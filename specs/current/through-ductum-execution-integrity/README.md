# Through-Ductum Execution Integrity

## Intake

Ductum still feels like a diary when work can happen outside the dispatcher and
then get written back as evidence. The next slice must make the difference
visible: a task is either orchestrated by Ductum, explicitly recorded as
external, or inconsistent.

## Grill Questions

- Should this add a new execution table? No. Existing runs, tasks, and evidence
  are enough for this slice.
- Should Ductum infer success from review text or evidence prose? No. Only
  structured fields count.
- Should reconcile repair execution-integrity issues? No. Reconcile repairs
  state shape and links merge commits back to runs; it does not create external
  outcomes.
- Should Edictum change? No. Edictum remains the workflow policy system.

## Decisions

- Add decision `107` for through-Ductum execution integrity.
- Add a shared classifier for run/task execution mode.
- Add structured custom evidence for explicit external and bakeoff outcomes.
- Expose integrity state through API, CLI, dashboard rows, and operator brief.
- Block manual task done writes that lack lineage or explicit external outcome.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  `103`, `104`, `105`, `106`, and `107`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference; no automatic bakeoff acceptance; no Edictum behavior
  change.
- Allowed scope: core classifier, API scan and guards, CLI output, dashboard run
  badges, reconcile commit linkage, behavioral tests, dogfood records, and
  review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/through-ductum-execution-integrity --path`,
  `ductum spec drift-review ductum through-ductum-execution-integrity`, package
  tests, build, `git diff --check`, reconcile dry-run, and adversarial review.
- Drift handling: record a decision before adding storage, a new top-level
  primitive, broad success inference, policy behavior, or a second reconcile
  path.

## Behavior Contract

- Task status API must reject manual done writes unless a Ductum run has
  session/worktree/commit lineage or explicit external outcome evidence.
- Run integrity output must keep structured final verification or review evidence visible
  on failed/active runs visible as inconsistent.
- Reconcile runtime must preserve a visible link from main-branch commits back
  to the originating Ductum run.
- Bakeoff candidate task output must fail integrity checks until explicit
  accept, reject, or fix outcome evidence exists.
- Reconcile output must preserve missing lineage as operator-visible and must
  not create external outcome evidence.
- API output must make execution mode visible for orchestrated, external,
  recorded, unknown, and inconsistent work.
- CLI output must make execution mode visible for orchestrated, external,
  recorded, unknown, and inconsistent work.
- Dashboard run output must make execution mode visible for orchestrated,
  external, recorded, unknown, and inconsistent work when API data includes it.
- Evidence parser behavior must not treat prose as success evidence for failed
  or active runs.
- Operator brief output must make execution-integrity contradictions visible as
  operator-visible work.

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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-THROUGH-DUCTUM-EXECUTION-INTEGRITY.md](P1-THROUGH-DUCTUM-EXECUTION-INTEGRITY.md) | core/api/cli/dashboard | Execution lineage truth surfaces and guards | Through-Ductum integrity | [x] | `106` |

## Dogfood Record

- Ductum-produced candidate inspected: `ductum/candidate-codex-m_sYoU`, commit
  `0943d4408787d80cc8dae903cd82b54b2f893930`.
- Candidate decision: accepted with follow-up fixes for API/CLI field alignment
  and dispatcher-live orphan coverage.
- Candidate evidence and final verification evidence will be recorded in Ductum
  after the verification run.

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
