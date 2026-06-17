# Audited State Reconciliation

## Intake

Ductum's state truth is still not airtight. The existing reconciler can repair
merged zombie runs, stale approval latches, orphaned runs, and active tasks whose
runs are all terminal, but some repairs leave only process logs or one-time CLI
output. That makes later operator inspection weaker than the actual repair.

## Grill Questions

- Should reconciliation infer done from arbitrary evidence or commit text? No.
  Keep that out of this slice.
- Should this add a reconciliation table? No. Existing run updates and evidence
  are sufficient append-only audit state.
- Should task repair get a new task update stream? No. Attach task-repair audit
  to the run whose state caused the repair.
- Should dry-run write audit records? No. Dry-run must be read-only.

## Decisions

- Add decisions `104` and `105` for audited state reconciliation and
  side-effect failure surfacing.
- Keep the existing reconcile endpoint and CLI command.
- Record a run update and `custom` evidence for every reconcile mutation.
- Include evidence ids in the structured reconcile response where useful.
- Keep reconcile behavior narrow: no broad success inference and no new state
  model.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  `103`, `104`, and `105`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference from evidence/review prose; no dashboard redesign.
- Allowed scope: reconcile audit payloads, run updates, API structured output,
  CLI/API-visible state, behavioral tests, dogfood records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/audited-state-reconciliation --path`,
  `ductum spec drift-review ductum audited-state-reconciliation`, package tests,
  build, `git diff --check`, and adversarial slop review.
- Drift handling: record a decision before adding a new table, task update
  stream, generalized success inference, dashboard redesign, or policy behavior.

## Behavior Contract

- A reconcile mutation that clears stale approval must create visible run audit state.
- A reconcile mutation that marks a merged run done must create visible run audit state.
- A reconcile mutation that marks an approval-lineage descendant run done must create visible run audit state.
- A reconcile mutation that marks an orphaned run failed must create visible run audit state.
- A reconcile mutation that marks an active task failed must create visible run audit state on the run that caused the task repair.
- Audit evidence must use existing evidence storage with type `custom` and must be visible through the run evidence API.
- Audit evidence write failures must fail visibly through the reconcile API and must not be swallowed into logs only.
- Run update write failures must fail visibly through the reconcile API and must not be swallowed into logs only.
- Audit evidence must include the reconcile reason and enough before/after run or task state for later operator-visible inspection.
- The structured API result must expose audit ids for run mutations so CLI JSON output is not logs-only.
- CLI reconcile output must preserve visible repaired run/task counts after audit ids are added to the API response.
- Dry-run reconcile must not mutate runs, tasks, run updates, or evidence.
- Re-running reconcile after repair must not create duplicate run audit records for already repaired state.
- Reconcile must keep the existing merge-commit scan behavior but must not infer
  success from arbitrary evidence, review text, or spec text.
- Reconcile must not add a new table, primitive, dependency, policy system, or
  marketplace.
- Tests must prove state changes and persisted audit records, not only response
  shape.

## Slop Review

- Did behavioral tests prove every reconcile mutation path gets persistent
  evidence or a stated reason
  why it did not mutate?
- Did explicit evidence show audit payloads are useful for later operator
  inspection, not just marker rows?
- Did behavioral tests attack dry-run and prove it remains fully read-only?
- Did the implementation avoid duplicate reconciliation logic, a new table, or
  a fake abstraction?
- Did it avoid broad success inference from evidence or review text?
- Did it avoid swallowed or logs-only recovery explanations?
- Did tests prove behavior on the DB state after reconcile?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-AUDITED-STATE-RECONCILIATION.md](P1-AUDITED-STATE-RECONCILIATION.md) | api/cli | Persistent audit for reconcile repairs | Audited reconcile state | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `1o5xW7S8iGUP`.
- Task imported into Ductum: `jSHF-XwMSbUD`.
- Run opened in Ductum: `SRXEa8VtXJng`.
- Decisions recorded in Ductum: `W3M6jNg0E4sK`, `ju7AuCvX9n-8`.
- Verification evidence recorded: `Gsms9xM5siiI`.
- Final slop review: `CrJJMrQGcdJX` (PASS).

## Verification

```sh
ductum spec contract-check ductum specs/current/audited-state-reconciliation --path
ductum spec drift-review ductum audited-state-reconciliation
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
