# Execution Integrity Operator Readiness

## Intake

`through-ductum-execution-integrity` landed the classifier and first surfaces,
but production operators still need faster answers:

- which execution modes are present;
- which contradictions block trust;
- whether the dashboard/spec rows reveal the same truth as CLI/API;
- what to run before declaring the factory ready.

This slice is a hardening round over existing runs, tasks, and evidence. It
does not add a new execution model.

## Grill Questions

- Should this add a new integrity table? No. Existing tasks, runs, and evidence
  remain sufficient.
- Should Ductum infer success from prose? No. Only structured evidence fields
  count.
- Should `toolsRef` or `policyRef` become runtime-active here? No. This slice
  records decision `108`: both remain metadata until a separate runtime/policy
  decision proves the need.
- Should Edictum change? No. Edictum remains the policy system.
- Does a hung adversarial review count as PASS? No. It is evidence of an
  attempted review only.

## Decisions

- Add decision `108` for execution-integrity operator readiness.
- Keep decision `107` as the classifier authority.
- Add richer operator-brief integrity detail without new storage.
- Make CLI/API/dashboard surfaces show all execution modes and contradictions.
- Add deployment/readiness runbook checks for execution integrity.
- Run a real adversarial review and record PASS or unresolved tasks.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `058`, `059`, `060`, `064`, `066`,
  `085`, `092`, `097`, `103`, `104`, `105`, `106`, `107`, and `108`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference; no automatic bakeoff acceptance; no Edictum behavior
  change; no `toolsRef` or `policyRef` runtime behavior in this slice.
- Allowed scope: spec/runbook artifacts, core/API integrity summary shape,
  operator brief output, CLI output, dashboard run/spec/task visibility,
  behavioral tests, dogfood records, review artifacts, and verification
  evidence.
- Verification: `ductum spec contract-check ductum specs/current/execution-integrity-operator-readiness --path`,
  `ductum spec drift-review ductum execution-integrity-operator-readiness`,
  package tests, build, `git diff --check`, reconcile dry-run, and adversarial
  review.
- Drift handling: record a decision before adding storage, a new top-level
  primitive, broad success inference, policy behavior, `toolsRef`/`policyRef`
  runtime semantics, or a second reconcile/integrity path.

## Behavior Contract

- The through-Ductum execution-integrity review must fail visibly unless a real
  adversarial PASS is recorded, or every unresolved finding is recorded as a
  task with explicit evidence.
- CLI integrity output must preserve visible mode counts and example rows for
  orchestrated, external, recorded, unknown, and inconsistent work.
- API operator brief JSON must make integrity issue counts, mode counts, and
  sampled task/run contradictions visible so API consumers can act without log
  inspection.
- Operator brief text must render integrity contradictions as operator-visible
  output, not only as a recommended action string.
- Dashboard run rows must preserve API execution-mode fields and render
  inconsistent rows with visible warnings.
- Dashboard project/spec task rows must resolve task execution integrity from
  API data and render unresolved task contradictions visibly.
- Reconcile dry-run must preserve `converged: true` on clean state after this
  patch and must not create execution-outcome evidence.
- Evidence parsing must not treat prose as success evidence; failed or active
  runs with prose saying "PASS" must not become done, external, or cleanly
  successful.
- Evidence output must preserve structured `custom` evidence with
  `kind: external-outcome`; bakeoff evidence output must preserve structured
  `kind: bakeoff-candidate-outcome`.
- Agent runtime behavior must preserve `toolsRef` and `policyRef` as
  metadata-only refs unless a separate decision changes their runtime behavior.
- API/CLI/dashboard implementation must fail review if it adds a new table,
  primitive, dependency, second policy system, duplicate integrity classifier,
  or Edictum policy change.

## Slop Review

- Did behavioral tests prove a failed or active run with prose saying "PASS"
  does not become successful or external?
- Did behavioral tests prove a done task without session/worktree/commit
  lineage or explicit external outcome stays inconsistent?
- Did behavioral tests or explicit evidence prove unresolved bakeoff candidates
  remain operator-visible while the spec/task looks terminal?
- Did explicit evidence prove integrity states are visible in API, CLI, and UI?
- Did reviewers attack duplicate reconcile/integrity logic instead of accepting
  a second classifier?
- Did reviewers attack fake abstractions, dead config, or future features?
- Did reviewers confirm missing or invalid inputs fail loudly and do not rely
  on logs?
- Did reviewers confirm Ductum coordinates state while Edictum remains the
  policy system?
- Did the prompt and review carry this Decision Trace?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-EXECUTION-INTEGRITY-OPERATOR-READINESS.md](P1-EXECUTION-INTEGRITY-OPERATOR-READINESS.md) | core/api/cli/dashboard/docs | Operator-facing execution-integrity readiness | Clear integrity surfaces and runbook | [ ] | `107`, `108` |

## Dogfood Record

- Decision recorded in repo: [108-execution-integrity-operator-readiness.md](../../../decisions/108-execution-integrity-operator-readiness.md)
- Spec imported into Ductum: `HudsAgadL7TE`.
- Task imported into Ductum: `0QpLOgGBzzAq`.
- Run opened in Ductum: `CRaZzC1GNCDp`.
- Decision recorded in Ductum: `YvH5QN1rH8Ki`.
- Ductum outcome: the primary dogfood task is intentionally not recorded as
  successful. It is failed/inconsistent because the completed adversarial
  review returned FAIL and unresolved findings remain follow-up work.
- Verification evidence recorded on run `CRaZzC1GNCDp`:
  - `p1buqfUkJ1v3`: Claude adversarial FAIL evidence and unresolved-task mapping.
  - `4tMAkY87Lerj`: verification command evidence.
- Real adversarial review status: FAIL, not PASS. Fixed in this patch: F1,
  F8, F9, F10, and F17. Remaining findings were imported as blocked follow-up
  tasks with Decision Trace:
  - `GHVWVBI2fn4x`: `followup-bakeoff-review-outcomes` for F2, F3, F18.
  - `v2voMxfuY0A0`: `followup-reconcile-lineage-outcomes` for F4, F5, F6, F15.
  - `iY0uQfMr1cVl`: `followup-external-outcome-close-retry` for F7, F16.
  - `AlI_ToFxI5Zf`: `followup-integrity-boundary-performance` for F11, F12,
    F13, F14.
- Two follow-up tasks were briefly dispatched before dependencies were added;
  their runs were closed as failed with the reason `blocked follow-up task;
  accidental dispatch before dependency was added`, and the tasks are blocked
  behind the primary dogfood task.
- The first Claude attempt was interrupted after stale-API CLI smoke exposed a
  crash; that attempt is not counted as PASS. The later completed Claude review
  is counted as FAIL with explicit follow-up tasks.

## Verification

```sh
ductum spec contract-check ductum specs/current/execution-integrity-operator-readiness --path
ductum spec drift-review ductum execution-integrity-operator-readiness
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm --filter @ductum/dashboard test
pnpm build
git diff --check
curl -sS -X POST -H 'X-Ductum-Operator-Token: local-dev-token' -H 'Content-Type: application/json' -d '{"dryRun":true}' http://127.0.0.1:4100/api/runs/reconcile
```
