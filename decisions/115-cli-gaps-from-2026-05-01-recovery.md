---
date: 2026-05-01
status: partially implemented (Gaps 5–6 shipped 2026-05-01, Gaps 1–4 deferred, Gap 7 captured in D119, Gap 8 shipped 2026-05-02 as D134, Gap 9 deferred)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 109, 110, 111, 114, 118, 119
---

# Decision 115: CLI / runtime gaps surfaced during 2026-05-01 P3 recovery

## Implementation status (2026-05-01)

The recovery session that produced this Decision also surfaced two
*more* runtime bugs that were severe enough to fix immediately rather
than schedule. Those are Gap 5 and Gap 6 below; both shipped in the
same commit window as Decision 114's MVP:

- **Gap 5 (`costBudget` not hot-reloadable).** Shipped commit
  `0ade80e`. `config apply` now mutates the live `context.costBudget`
  via `syncCostBudget` in `packages/api/src/routes/settings.ts`. Two
  new tests in `packages/api/src/tests/settings-cost-budget.test.ts`.

- **Gap 6 (activity log cap of 200, ASC ordering, `--limit`
  not forwarded).** Shipped commit `3007534`. The repo now returns
  the LATEST N events, the API forwards `?limit=` (clamped to 5000),
  and the CLI cap rose from 500 to 5000. Tests in
  `packages/api/src/tests/routes/run-activity.routes.test.ts`.

Gaps 1–4 (task update, terminal-fail without retry, typed
worktree-snapshot evidence, spec re-sync) remain deferred as
described below.

A seventh gap surfaced later the same day, of a different kind:
**dashboard information architecture is engineer-coded** rather
than written for an operator. Captured in **Decision 119** so it
has standing as a design principle for future dashboard work.
See "Gap 7" below.

## Context

The 2026-05-01 orchestrator session attempting to dispatch
`factory-readiness-recovery` P3 (the first stage 2+ dogfood after
P0/P1/P7) hit four CLI gaps that were not on the radar of D110/D111
(P0 / P1 prerequisite shipping). Each gap was reached at a moment
where the operator had to choose between (a) violating a hard rule
("no curl, no sqlite3, no hand-edited yaml"), (b) accepting an ugly
workaround that polluted the audit ledger, or (c) stopping the
session.

This decision captures the four gaps, with the recovery-context
each was reached in, so they can be fixed deliberately rather than
re-discovered next time.

## Gaps

### Gap 1: `ductum task update --prompt-file <path>` does not exist

**When reached:** after editing
`specs/current/factory-readiness-recovery/P3-FACTORY-DURABILITY.md`
to expand 3.4 with a gate-and-escalate model, the operator needed
to push the new prompt into the task's `prompt` column before
redispatch. There is no CLI for it.

**What is there today:**
- `ductum spec import` refuses on already-imported specs
  (`packages/cli/src/import-handler.ts:111` —
  `"Spec X already has N tasks. Delete the spec first to reimport."`).
- `ductum spec intake --import` defers to the same handler.
- `ductum task` has no `update` subcommand.

**Workaround used on 2026-05-01:** None. The expansion was deferred
to Decision 114 as a future task; the dispatch retried with the
original prompt under the bumped cap. (See Decision 114 for why.)

**What to add:**

```
ductum task update <taskId> [--prompt-file <path>] [--name <name>]
                            [--repo <repo>] [--verify <step>]
                            [--required-role <role>]
```

`--prompt-file` reads the file content into `tasks.prompt`.
Refuses to update a task with an active (non-terminal) run unless
`--force` is passed. Records an evidence row on the task with the
old/new prompt hashes and the reason.

### Gap 2: `ductum task set-status <taskId> failed` does not exist

**When reached:** after `XDfWca7Emwpb` went terminal-failed at the
cost cap, the task `1cxSDBAWNw4j` stayed `status=active` because
the run is terminal but the task state machine only transitions
out of `active` on a successful run completion or via
`task complete`. There is no CLI to flip a task to terminal `failed`.

**What is there today:**
- `spec set-status <spec> <status>` works on specs.
- `task complete <task> --reason ...` marks task `done` (operator-direct
  shipped externally; semantically wrong for "this work failed and is
  being abandoned").
- `retry <runId>` puts the task back to ready; doesn't help close it.

**Workaround used on 2026-05-01:** None — the recovery path is to
retry `XDfWca7Emwpb` which moves the task back to `ready` and
re-dispatches. The old run remains attached as a failed-run row
for audit; that is appropriate.

**What to add (for future cases where a task should not retry):**

```
ductum task set-status <taskId> <status> [--reason <text>]
```

Valid statuses: `ready`, `active`, `done`, `failed`, `blocked`.
Transitions are validated (no jumping from `done` back to `active`).
`failed` requires `--reason`. Records a Decision row keyed to the
task.

### Gap 3: `ductum evidence` cannot attach worktree snapshots as a typed kind

**When reached:** after the failed run, the operator wanted to
attach a snapshot of the (uncommitted, abandoned) worktree as
formal evidence — file list + diff stat at minimum, ideally a
tar of the worktree. The closest available is `evidence --type
custom --payload <json>` with `kind: operator-note`. That works
but flattens the worktree snapshot into a free-text note, losing
typed semantics.

**What is there today:**
- Evidence types are CHECK-constrained to `('ci', 'review', 'test', 'lint', 'custom')`.
- Custom evidence kinds are constrained to `('external-outcome',
  'bakeoff-candidate-outcome', 'verify', 'internal-review',
  'operator-note')`.
- No `worktree-snapshot` kind. No `cost_budget_denied` kind.

**Workaround used on 2026-05-01:** Used `--type custom --payload
'{"kind":"operator-note", ...note text..., "diff_stat":..., "worktree_path":...}'`
on the failed run. Captured the data; lost the type signal.

**What to add:**

- New custom evidence kind `worktree-snapshot` with payload schema
  `{ worktree_path, branch, commit_sha?, diff_stat, changed_files[],
  reason, attached_at }`.
- New custom evidence kind `cost_budget_denied` for use by the
  budget gate (Decision 114) when an extension is denied.
- Optionally: `ductum evidence snapshot-worktree <runId> --reason <text>`
  helper that captures the diff stat / file list automatically
  rather than requiring the operator to assemble JSON.

### Gap 4: `ductum spec re-sync` (or equivalent) for in-place spec edits

**When reached:** same situation as Gap 1, framed differently.
The operator's workflow is "edit the spec file on disk, push
changes back into Ductum." The factory has no path for it. Today
the only path is "delete the spec, re-import from the file" —
which destroys task lineage, integrity records, and
`session_run_mappings` for any in-flight or terminal runs in
that spec.

**What is there today:** nothing.

**What to add (after Gap 1 lands):**

```
ductum spec sync <specIdOrName> [--from <path>] [--dry-run]
```

Reconciles the on-disk spec file with the DB:
- Detects task additions (new P-files), removals (P-files that
  no longer match any task), and prompt drift (P-file content
  hash != `tasks.prompt` hash).
- `--dry-run` reports the diff without applying.
- Without `--dry-run`, applies changes and records a Decision
  row capturing the synced delta.
- Refuses to remove tasks that have any non-terminal run.
- Refuses to update prompts of tasks with non-terminal runs unless
  `--force`.

This is what Edictum-shaped agents already expect to exist when
they reason about the spec/task lifecycle.

### Gap 5: `costBudget` not hot-reloadable despite `config apply` reporting success — FIXED

**When reached:** after the operator bumped `perRunHardUsd` from $30
to $100 in `ductum.yaml` and ran `config apply --file ductum.yaml`,
the CLI reported "Config valid" + applied with one warning. The
warning lists settings that need a restart (ports, Telegram, merge,
repo paths, worktree paths) and `costBudget` is *not* in that list,
implying it is hot. It was not. The next P3 dispatch hit the original
$30 cap, just like the first run.

**Root cause:** `packages/api/src/index.ts:363` reads
`process.env.DUCTUM_COST_BUDGET` once at API startup (set by
`scripts/serve.mjs:197` from the yaml at script start). The live
enforcement path consults `context.costBudget` but `config apply`
never wrote back into that object. Two-layer freeze.

**Fix shipped 2026-05-01 (commit `0ade80e`):** new `syncCostBudget`
helper called inside `syncRuntimeConfig` mutates `context.costBudget`
in place and clears `context.costBudgetWarned` (so a raised warn
threshold can fire again). Tests verify both raise-and-clear paths.

### Gap 6: activity log capped at 200 events with ASC ordering — FIXED

**When reached:** observing the second P3 retry, the CLI's
`ductum logs` command returned exactly 200 events ending at
`08:39:48`. Cost continued climbing, heartbeat stayed fresh, progress
messages reported new milestones — but the activity transcript stayed
frozen. The user spotted "could the activity be capped at 200" — it
was, and the SQL was `ORDER BY created_at ASC LIMIT 200` which
returns the *first* 200 events forever rather than the latest. The
API route did not forward `?limit=` either, so the CLI's `--limit`
flag was silent.

**Root cause:** `packages/core/src/repos/run-activity.ts:12` shipped
with `ORDER BY ASC LIMIT 200` — a coverage choice that worked for
short demos and broke silently on long runs.
`packages/api/src/routes/runs.ts:205-207` called `list(runId)` with
no limit forwarding.

**Fix shipped 2026-05-01 (commit `3007534`):** repo now does
`ORDER BY id DESC LIMIT N` then reverses to chronological for
display; API forwards `?limit=` (clamped to [1, 5000]); CLI passes
its `--limit` through. Server-side ceiling raised from 200 to 5000.
Two new tests in `packages/api/src/tests/routes/run-activity.routes.test.ts`.

### Gap 7: dashboard surfaces are read-only and engineer-coded — captured in D119

**When reached:** later the same day, mid-Phase-B, the operator
opened the dashboard, looked at it for a few minutes, and asked,
in plain words, *"I don't understand the UI. I don't know where
to click. If I should ignore something, why is it there? If it's
important, why can't I understand it? Why is it so misleading?"*

**Root cause:** the dashboard was built as a faithful read-out of
every database field, not as a curated operator surface. Internal
enum names (`inconsistent`, `orchestrated`, `cost_budget_paused`,
`recovering`) leak straight onto the page as labels. State fields
that disagree are shown side-by-side (a stage progress bar
counting failed runs, beside a status column showing the spec's
logical state — for the same row). Cards with no actionable
follow-through occupy prime page real estate. The home page
never answers the question *"what is your next operator action?"*.

This is a categorically different gap from the CLI ones above —
it is information architecture, not a missing command. **It is
captured separately as Decision 119** so it has standing as a
design principle that future dashboard work cites and complies
with.

**Fix path:** D119 records the principles ("dashboard is an
operator inbox, not a data grid", five rules, acceptance
criteria for the future implementing spec). The implementing
spec is *not* P2 — P2 ships its current contract. The post-P2
dashboard work is the future spec D119 governs.

**Fix status:** principle captured (D119, 2026-05-01). Implementation
is a future spec, not part of `factory-readiness-recovery`.

### Gap 8: factory does not auto-rotate to next eligible agent on agent failure — FIXED

**When reached:** P3 review-r3 was auto-dispatched to `glm` after I
added it to the reviewer pool. Claude-agent-sdk rejected `glm-5.1`
on the first turn (`"There's an issue with the selected model
(glm-5.1). It may not exist or you may not have access to it."`).
The dispatcher's response was to **crash-retry the same agent on
the same task**, three times, with the same error each time. Each
retry burned a dispatcher slot. The factory had five other eligible
reviewers in the pool and never tried any of them.

**Operator-direct workarounds we ran:**
- `ductum run-close <runId>` to terminate the crashing run
- `ductum task assign <task> sonnet` to swap the agent
- `ductum retry <runId>` to put the task back to ready
- `ductum run dispatch <task> --agent sonnet` to bypass the
  cap-blocked auto-cycle

**What should be automatic:**
- After an agent's session crashes with an error pattern that
  indicates the agent itself is unreachable (auth, model-not-found,
  harness rejection — distinct from "agent's code was wrong"), the
  dispatcher should mark the agent unhealthy and pick the next
  eligible agent from the project pool on the next attempt.
- Crash-retries should rotate agents, not repeat the same one.
- The "unhealthy" mark should be soft (clears after operator
  intervention or a heartbeat-style liveness check) so a
  transient outage doesn't permanently exclude an agent.

**What to add:**

- `dispatcher` tracks a per-agent unhealthy flag with a reason and
  timestamp. Crash-retries skip unhealthy agents until the flag
  clears.
- `ductum agent health` already exists as a CLI; extend it to
  show the unhealthy flag, the reason, and a `--clear` action.
- Smoke test (`ductum agent test <name>`, see follow-up below) is
  the *prevention* path: validate agents before they enter the
  pool. Gap 8 is the *runtime* path: handle an agent that turns
  unhealthy mid-flight.

This was hit live on 2026-05-01 against a P3 review-r3 dispatch.
The recovery cost ~10 minutes of operator-direct CLI gymnastics.

**Fix shipped 2026-05-02 (Decision 134):** the dispatcher now tracks
recoverable per-agent failures in a ten-minute window, marks an agent
unhealthy for five minutes after three failures, and skips unhealthy agents
during automatic selection. `ductum agent health` shows the counter/state and
`ductum agent reset-health <name>` clears it.

### Gap 9: stale run rows hold dispatcher slots after session end

**When reached:** after fix-r1 (`77kYfea6bdQf`) and fix-r2
(`n32Er1kR5rS7`) of P3 ended their agent sessions cleanly via
`ductum_complete`, both run rows stayed at `stage=implement,
terminalState=null` for tens of minutes (until manually closed
with `run-close`). The dispatcher's slot accounting counted them
as active runs, capping concurrency at 3 even though only the
real downstream review/fix children were live. The post-completion
router HAS dispatched downstream work and the parent's job is
done; the row state just doesn't transition.

**Operator-direct workarounds we ran:**
- `ductum run-close <runId> --done --reason ...` on each zombie
  run to free a dispatcher slot.

**Partial fix already in main:** commit `e23df3b` (D115 follow-up)
records `stage_history` rows when the post-completion router
dispatches a fix or review child, so the audit trail shows the
milestone. **It does not transition `terminalState`** — the run
row still claims to be alive, blocking dispatcher slots.

**What to add:**

- When `runImplCompletion` or `runFixCompletion` completes its
  routing (verify passed → review dispatched, OR verify failed →
  fix dispatched), the parent run's `terminalState` should
  transition to `done` (or a new `awaiting-children` state if D27
  semantics require it stay non-terminal until children resolve).
- Whichever transition is chosen, the dispatcher's
  `getReady`/`activeRuns` query needs to count *runs that actually
  hold a live harness session*, not "runs whose row says
  stage!=done && terminalState=null." Today those drift apart.
- Test: after a fix run's session ends and verify dispatches a
  review child, the fix run's row must NOT count toward
  `activeRuns` within 60 seconds.

This is a slot-leak bug with operator-visible cost: every stale
run blocks a real dispatch from auto-picking up. Hit live three
separate times during the 2026-05-01 session (fix-P3-r1, fix-P3-r2,
P3 parent itself).

## Decision

The four CLI gaps remain real and were each reached during the
recovery session. Capture them as scheduled follow-ups, not as
undeclared in-spec scope:

- **Gap 1 + Gap 2** are tractable as a small, focused PR (~50–100
  LOC). File as a separate small task in the next spec, or as a
  P3.5/P4.5 add-on to `factory-readiness-recovery` *if* the next
  cap-hit motivates pulling them forward.
- **Gap 3** ships alongside Decision 114's gate work (the new
  evidence kinds are needed by the gate). Do not split.
- **Gap 4** is the largest of the four; defer to after the gate
  work and the simpler `task update` lands. Build on top of those.

## Why this matters

The 2026-04-30 audit produced D110/D111 by surfacing
*operator-visible* defects (token UX, spec status mislabel,
missing CLI parity for three commands). The 2026-05-01 dogfood
session surfaced *agent-visible* defects (no path to amend a
dispatched task, no path to terminal-fail without retry, no
typed evidence for worktree state, no path to re-sync spec
edits). The factory needs both surfaces to be honest. This
Decision is the agent-visible tranche.

## Consequences

- The orchestrator (and any future agent driving Ductum) can no
  longer get stuck the way 2026-05-01 got stuck.
- Spec evolution becomes a first-class operation, not a
  re-import-or-bypass dilemma.
- The audit ledger keeps its honesty: nothing in this session
  required a sqlite3 mutation or a curl call to recover from.
