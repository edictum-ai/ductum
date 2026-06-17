---
date: 2026-05-01
status: implemented (MVP, 2026-05-01 commit 9dc5366)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 109, 052, 057, 060
---

# Decision 114: Budget cap exhaustion is a gate, not a guillotine

## Implementation status (2026-05-01)

The MVP shipped in commit `9dc5366` after two consecutive P3 dispatches
were lost to the old guillotine behavior. The remaining gap from the
original proposal is **same-session resume** across the pause —
requires the P3.1 persistent-session-binding work that opus had
started in the failed worktree. Operator-visible behavior matches the
proposal (extend resumes, deny terminates, worktree preserved); under
the hood, "extend" is implemented as `retry`-with-bigger-cap, which
spawns a fresh agent session in a fresh worktree dir. P3.1 (when it
lands) will close this gap by reattaching to the same harness session
across the pause.

Spec-level extend (`ductum budget extend-spec`) and the Telegram
round-trip (depends on P4.4) are tractable follow-ups on top of this
MVP and not yet shipped.

## Context

On 2026-05-01, the first dogfood dispatch of `factory-readiness-recovery`
P3 failed at the per-run hard cap (`perRunHardUsd: 30`). Opus had spent
$30.58 producing 18 modified files + 4 new files (including
`decisions/115-spec-budget-realism.md` and `packages/api/src/lib/run-ops/approve-rebase.ts`)
when the cost projector tripped the cap. The run was set terminal-failed
immediately; the worktree was abandoned dirty, no commit, no operator
hook, no path to salvage. The entire $30.58 of work was lost.

The failure exposed an asymmetry. Ductum's design treats every other
runtime boundary as a **gate** (read-before-edit, verify-before-push,
approval-before-merge). Cost exhaustion is the only boundary modeled
as a **guillotine** — terminal-failed without operator visibility,
without preservation of work-in-progress, without an opportunity to
extend or deny.

This is incompatible with the rest of the runtime model.

## Decision

**Cost cap exhaustion becomes an evidence-gated transition,**
identical in shape to merge approval. This is a future deliverable;
it is **not** in P3 as currently dispatched. P3.4 (`spec-budget-realism`)
ships as written: raise default cap, surface projection on the
dashboard. The gate transition described below is to be picked up as a
follow-up — either as P3.5 in a future sub-spec or as the first task
of the next spec after `factory-readiness-recovery` lands.

### Run state machine

A new non-terminal run state `awaitingBudgetApproval` joins
`pendingApproval` as a paired interim state:

```
implement → (projected >= warn)  → emit budget-warn evidence (no pause)
implement → (projected >= hard)  → AwaitingBudgetApproval (paused, preserved)
                                    ├─ extend  → resume implement, cap += $N
                                    ├─ shipnow → operator-ship if branch+commit
                                    └─ deny    → terminal failed (cost_budget_denied)
```

### Invariants (must hold)

1. **No reset.** Extending the cap does not increment `resetCount`,
   does not swap WorkflowRuntime, does not rebuild the session.
   D27 (one runtime per run) holds across the pause. The session
   that was bound when the cap fired is the session that resumes.

2. **Worktree preservation.** The worktree is intact across the
   pause. On `deny`, the worktree remains on disk. `ductum cleanup`
   refuses to remove worktrees flagged with `cost_budget_denied`
   evidence unless `--force` is passed. This is the salvage path
   that did not exist on 2026-05-01.

3. **Gate-style evaluation.** `awaitingBudgetApproval` is implemented
   as a regular workflow gate, reusing the merge-approval surface
   (notification, queue surfacing, evidence trail). Not a special
   case in the cost-projection layer.

4. **Spec-level gate too.** `perSpecHardUsd` projection crossing
   transitions every active run in the spec to
   `awaitingBudgetApproval`. The spec-level extend/deny is a single
   operator decision applied to all runs in the spec.

### Operator surfaces

CLI (each requires unit tests in `packages/cli/src/tests/`):

- `ductum budget extend <runId> --by <usd> [--reason <text>]`
- `ductum budget deny <runId> --reason <text>`
- `ductum budget extend-spec <specId> --by <usd> [--reason <text>]`

Dashboard: budget approvals appear in the same Approvals panel as
merge approvals. Card shows current spend, projection, proposed new
cap, one-click `Continue +$N` and `Deny`.

Telegram: round-trips identically to merge approvals (depends on
P4.4 Telegram wizard for end-to-end).

## Alternatives considered

1. **Keep the guillotine, just raise the defaults.** Rejected:
   raises the cliff but doesn't remove it. P3 itself had four
   sub-deliverables and would have hit a $100 cap eventually if
   the agent took an inefficient implementation path. The right
   abstraction is "ask the operator," not "pick a number tall
   enough to never trigger."

2. **Auto-extend with a global multiplier (e.g., 2× cap on
   trigger).** Rejected: removes the human-in-the-loop the
   product is built around. Edictum's wedge is *enforced
   process*. Auto-bypassing budget enforcement is anti-product.

3. **Separate `awaitingBudgetApproval` and merge approval into
   different surfaces.** Rejected: each new approval-shaped state
   that doesn't reuse the merge approval machinery is a place the
   factory's gate model fragments. Reuse keeps the abstraction
   honest.

## Why this is *not* in P3 as dispatched

This decision was produced after P3 was dispatched, on 2026-05-01,
inside the orchestrator session that watched the original P3 run
fail. Adding it to P3 in-flight would have required updating the
task `prompt` row in the DB; **the CLI does not expose
`task update --prompt-file <path>`** (see Decision 115). Rather
than reaching for `sqlite3` to amend the prompt, the operator chose
to (a) ship original P3.4 as written, (b) capture the gate-and-escalate
model as this Decision, (c) schedule the gate work as follow-up.

P3 still ships under the bumped caps (`perRunHardUsd: 100`,
`perSpecHardUsd: 300`) so opus has runway to complete the original
four deliverables. If a second cap-hit occurs during the retry, that
is itself fresh evidence that the gate model is overdue, and the
operator will revisit the recovery sequencing.

## Consequences

- P3 retries under the original four-bullet 3.4 contract. No
  scope expansion mid-flight. Cleaner audit ledger.
- The gate-and-escalate work becomes scheduled follow-up. It is
  the first realistic candidate for either a P3.5 sub-task added
  after `factory-readiness-recovery` is otherwise complete, or
  the lead task of whatever spec succeeds it.
- The `worktree-snapshot evidence` row attached to the failed
  `XDfWca7Emwpb` run remains on record as the motivating
  incident. Future-you can cite it directly.
- One small affordance ships immediately: `ductum cleanup`
  should be modified (operator-direct, separate small change) to
  refuse removing worktrees with attached `cost_budget_denied`
  evidence even before the full gate lands. Filed as part of
  Decision 115's CLI follow-ups.
