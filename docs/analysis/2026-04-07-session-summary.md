# Session Summary — 2026-04-07 (Lifecycle Repair)

## TL;DR

The five priority items from the previous session's super-prompt
(`docs/analysis/2026-04-06-factory-runtime-analysis.md`) all landed,
were unit-tested, and were verified live with a fresh dispatch of
`impl-005-operational`. The dashboard, CLI, and API now all show
truthful state. A real Codex run produced a 7-file / +469 / -249
diff that was reviewed by GLM, advanced to ship, and approved through
the dashboard's new diff viewer.

Six commits on `main`:

| Commit | Subject |
|--------|---------|
| `13768e9` | fix(dispatcher): close the stall-race that mislabels completing runs |
| `de54843` | fix(dispatcher): repair the fix-loop dead end with proper lineage routing |
| `8f26490` | feat(display): derive awaiting_approval without forking WorkflowStage |
| `653529d` | feat(dashboard): inline diff viewer for awaiting-approval runs |
| `f45f266` | feat(pricing): compute cost at the persistence layer from model + tokens |
| `5aeed81` | fix(dispatcher): widen lifecycle guards exposed by live verification |

Test totals: **278 tests across 7 packages, all green.**

## What landed

### P0 — Stall race condition (commit `13768e9`)

**Problem.** The heartbeat-based stall detector and `handleSessionEnd`
ran on independent timers. A long-running session (Codex doing 30+
minutes of real work) tripped the detector even though it was alive,
and when `handleSessionEnd` finally fired, the run was already failed
and the post-completion pipeline never finalized.

**Fix.**
- New `finishingRuns: Set<RunId>` on the Dispatcher. Marked before any
  post-completion work in `handleSessionEnd`, cleared in `finally`.
- `RunStateMachine.checkStalledRuns(shouldSkip?)` now takes a predicate
  and skips runs the dispatcher flags as in-flight.
- `factory.heartbeatTimeout` from `ductum.yaml` is now threaded through
  `scripts/serve.mjs` → `DUCTUM_HEARTBEAT_TIMEOUT_SECONDS` env var →
  `packages/api/src/index.ts` → `DispatcherConfig.heartbeatTimeoutSeconds`.
  No more silent fallback to 120s when the yaml says 300.

**Tests.** Four new dispatcher cases: long-running session with valid
heartbeats stays alive, post-completion pipeline runs are immune to
stall detection, crashed-mid-pipeline runs still stall correctly, and
custom `heartbeatTimeoutSeconds` from config propagate onto the run row.

### P6 — Fix-loop dead end (commit `de54843`)

**Problem.** Fix runs were dead code: routed through `routeReviewResult`
which only handled `review-*` tasks; their completion text was parsed
as a verdict (it isn't); they always got a fresh worktree off `main`,
losing the impl branch; `parentRunId` was always `null` so there was
no lineage to walk.

**Fix.**
- **Three-way routing** in `handleSessionEnd`: `review-*` →
  `routeReviewResult`, `fix-*` → new `routeFixResult`, else →
  `runPostCompletionPipeline`.
- New `parseTaskName(name)` exported helper classifies impl / review /
  fix names including round suffixes (`review-P1`, `review-P1-r2`,
  `fix-P1-r3`, …).
- New internal `DispatchOptions` interface carries `parentRunId` and
  `reuseWorktreeFromRunId`. Computed by `resolveDispatchOptions(task)`
  before dispatch so fix runs inherit the parent's worktree path and
  skip `worktreeManager.create()` (no setup re-run).
- `parentRunId` is now actually populated on review and fix runs.
- `routeFixResult` runs `verify` on the inherited worktree, escalates
  the root run on verify failure, and dispatches a fresh review on
  success. Fix output is **never** parsed as PASS/FAIL.
- Iteration cap: walks the parent chain via the new
  `walkParentChain()` / `findRootRun()` helpers, and once the chain
  contains `>= maxReviewRounds` (default 3) fix runs, the root impl
  run is marked failed with reason `max_review_iterations`.
- Reviews after fix runs get round-suffixed names
  (`review-P1-r2`, `review-P1-r3`, …); `review-P1` (round 1) is
  preserved for backwards compatibility.

**Tests.** Eight new dispatcher cases: fix dispatch reuses parent
worktree, review dispatch sets parentRunId, full review-FAIL → fix
cycle, review-PASS → ship advance, fix output not parsed as verdict,
multi-round chain walk, max-iteration escalation, and `parseTaskName`
classification.

### P1 — Derived display status (commit `8f26490`)

**Problem.** The dashboard couldn't distinguish "5 things succeeded,
please approve them" from "9 things are broken" — both showed under
"Needs attention". Codex's review was explicit that adding
`awaiting_approval` to `WorkflowStage` would fork dashboard semantics
from the Edictum runtime.

**Fix.**
- New `packages/core/src/run-display.ts` with
  `deriveDisplayStatus(run): 'running' | 'awaiting_approval' | 'failed' | 'stalled' | 'done'`.
  Precedence: failed → stalled → done → awaiting_approval → running.
- Heartbeat age is intentionally NOT considered — the dispatcher owns
  the stalled transition (see P0).
- Parallel helper at `packages/dashboard/src/lib/derived-status.ts`
  with the same logic + Tailwind class map for the badge.
- `ProjectList` homepage now has five distinct stat cards: Running,
  Awaiting approval, Needs attention, Completed, Total cost. The run
  feed splits "Awaiting approval" out of the danger bucket. Each row
  carries both a derived-status badge (primary) and a stage badge
  (secondary).
- `RunDetail` page renders both badges in the header. `needsApproval`,
  `canRetry`, and `isLive` are now keyed off the derived status.
- CLI `ductum status` and `ductum runs` gain a `STATUS` column that
  uses the same derivation via `formatDisplayStatus()`.

**Tests.** Ten new core assertions across `deriveDisplayStatus`,
`countByDisplayStatus`, and the label/class maps.

### P4 — Diff viewer (commit `653529d`)

**Problem.** Approving a run was meaningless without seeing the diff.
The user had to find the worktree, run `git diff` manually, then come
back to click Approve.

**Fix.**
- New `getRunDiff(context, runId, { base })` helper in
  `packages/api/src/lib/run-ops.ts`. Runs `git diff --numstat
  base...HEAD` for per-file stats and `git diff base...HEAD` for the
  unified text. Binary files flagged via the `- -` numstat pattern.
  Diff text is capped at 200 KB so large diffs don't ship megabytes
  to the browser.
- New `GET /api/runs/:id/diff` endpoint. 404s when the run has no
  worktree.
- New `RunDiff` / `RunDiffFile` types in the dashboard client +
  `useRunDiff` hook (15s staleTime, no retry on 404).
- New `<DiffViewer>` component: file tree on the left, unified diff
  on the right with red/green CSS line highlighting (no giant diff
  library). Handles loading, empty, error, and binary files distinctly.
- `RunDetail.tsx` embeds the viewer above the Approval card whenever
  `displayStatus === 'awaiting_approval'`.

**Tests.** Eight new dashboard assertions covering `splitDiffByFile`,
loading state, empty state, populated render, binary files, and the
error banner. One new API test confirms the 404 path.

### P5 — Cost at the persistence layer (commit `f45f266`)

**Problem.** Codex runs showed `$0.00` despite millions of tokens —
both `codex-sdk` and `codex-app-server` hardcoded `costUsd: 0`. Even
Anthropic's reported cost drifted from published rates. Fixing in each
consumer would have left the persisted value wrong.

**Fix.**
- New `packages/core/src/model-pricing.ts` with USD/1M rates for the
  current Anthropic, OpenAI/Codex, and Z.AI lineup. `lookupPricing()`
  normalizes `.` and `-` separators (so `claude-opus-4.6` and
  `claude-opus-4-6` both resolve), with prefix-match fallback for
  date-suffixed model ids.
- `computeCost(model, tokensIn, tokensOut)` returns 0 with a one-time
  warning for unknown models — never throws.
- `dispatcher.handleSessionEnd` now resolves the agent, computes cost
  from the token delta, and ignores `result.costUsd` from the harness.
- `/api/runs/:id/tokens` route does the same: looks up run → agent,
  computes cost, ignores body.costUsd.
- `codex-sdk` `turn.completed` now sends per-turn DELTAS instead of
  cumulative totals (the old behavior double-counted because
  `updateTokens` is additive).
- `codex-app-server` `thread/tokenUsage/updated` converts the cumulative
  values it receives into deltas before posting.

**Tests.** Eleven model-pricing unit tests (Sonnet 4.6 1M/100k = $4.50,
GLM 0.6, Codex 7.5, unknown-model fallback, case/separator
normalization) plus a dispatcher integration test proving Codex
tokens produce real cost even when the harness reports 0.

### Unplanned but necessary — Live-verification fix (commit `5aeed81`)

The first live dispatch surfaced two bugs that the unit tests didn't
catch on their own:

1. **Concurrency deadlock.** `cycle()` counted `runRepo.getActive()`
   for the slot limit, which includes impl runs sitting at
   `stage=implement` waiting for an async review. Once
   `maxConcurrentRuns` impls landed in that state, no review could
   ever dispatch — the pipeline deadlocked. Switched to counting
   `this.activeSessions.size`, which only sees runs with a live
   harness session.
2. **Wider stall-race.** The P0 `finishingRuns` guard protected runs
   only while `handleSessionEnd` was actually running. After it
   returned, a run waiting on an async review was released — but
   its `lastHeartbeat` kept aging until the stall detector marked it
   stalled. Widened the guard so `checkStalled()` skips any run not
   currently in `activeSessions`. If the session is gone, the run is
   either pending downstream work or already terminal — never stallable.

Two new regression tests pin both behaviors.

## Live verification results

Fresh dispatch of `impl-005-operational` against the rebuilt server.
All five tasks loaded (3 immediately ready, 2 blocked by deps).

### Pipeline events captured

```
00:43:37  [pipeline:1ART1I]  verifying: pnpm build && pnpm -r test
00:43:51  [pipeline:1ART1I]  verification passed
00:44:09  [pipeline:1ART1I]  review task review-P1-TRIAGE-HOMEPAGE dispatched to ut0jOB
00:53:38  [codex impl restart after concurrency-deadlock fix]
01:06:21  [pipeline:Aa_5LK]  verifying: pnpm build && pnpm -r test
01:06:35  [pipeline:Aa_5LK]  verification passed
01:06:48  [pipeline:Aa_5LK]  review task review-P1-TRIAGE-HOMEPAGE (gamx1p) dispatched to PVW28r
01:08:05  [pipeline:DrtG47]  verifying: pnpm build && pnpm -r test
01:08:08  [pipeline:DrtG47]  verification failed     (legitimate test break)
01:10:59  [review:pSf3fz→Aa_5LK]  PASS — advancing root Aa_5LK to ship
```

### Final dashboard state (after manual approval)

| Bucket | Count | What it contains |
|--------|------:|-----------------|
| Running | 3 | sonnet impl, glm review, codex (post-approval at ship) |
| Awaiting approval | 0 | (was 1 before approve click) |
| Needs attention | 1 | The legitimate glm verification failure |
| Completed | 0 | — |
| Total cost | **$21.74** | 69k tokens |

### Done-criteria checklist

- [x] `pnpm build && pnpm -r test` — clean (zero failures, 278 tests)
- [x] Live dispatch of `impl-005-operational` produces real code via the
      full impl → verify → review → ship loop
- [x] At least one task reached `awaiting_approval` and the diff was
      visible in the dashboard (P1-TRIAGE-HOMEPAGE, 7 files / +469 / -249)
- [x] Codex cost is non-zero in the dashboard (`$21.62` for the Codex
      P1 impl, 4.18M input / 35.6k output tokens)
- [x] No false stalls — runs that completed advanced to ship/done
- [x] `parentRunId` lineage chain reads correctly via API (review
      run `pSf3fzjQyh` parents to impl run `Aa_5LKoHPg`)
- [x] Display status shows `running | awaiting_approval | failed |
      stalled | done` distinctly
- [x] Screenshots saved at `/tmp/ductum-success/` (8 PNGs)
- [x] Commits pushed to main (after this report)
- [x] Handover and session summary updated

### Screenshots

- `01-initial-dispatch.png` — homepage right after spec approval
- `02-three-agents-implementing.png` — three runs all in `Implementing`
- `03-run-detail-running.png` — sonnet impl run detail with workflow strip
- `04-running-awaiting-failed-distinct.png` — buckets diverging
- `05-five-buckets-distinct.png` — stat cards + feed sections all populated
- `06-diff-viewer-with-approve.png` — DiffViewer + Approve button live
- `07-after-approval.png` — same page after the approve click
- `08-final-dashboard-state.png` — codex run advanced to Shipping

## Known issues / next priorities

The lifecycle is now truthful, but UX cleanup is still ahead:

- **P2 — Dashboard rows hide the task name.** Each row in the run feed
  still shows `Running Implementing sonnet 22m` with no task or spec
  name. Codex's enriched-runs work in the live spec already wires
  `taskName/specName/projectName/agentName` into `/api/runs` — that
  branch is on `ductum/P1-TRIAGE-HOMEPAGE-Aa_5LK`, ready to merge.
- **P3 — Auto-retry policy split.** Most P3 noise disappeared once P0
  landed, but the dispatcher still treats heartbeat-stall and crash
  exits identically for retries. Split by cause.
- **P7 — Block panel noise.** Group consecutive identical block
  messages on the run detail page.
- **P8 — Spec command center view.** Replace the 5-deep nav with a
  single screen per spec.
- **Codex MCP HTTP transport.** The `run_id` argument workaround in
  `packages/mcp/src/server.ts:49` (`resolveRunId`) is still in place.
  Move to per-run HTTP MCP routes at `/api/mcp/{runId}` and revert the
  arg-based path. Don't let the workaround become permanent
  architecture.
- **Codex token volume.** Codex runs are emitting ~4M input tokens per
  short impl task (the model re-ingests its full context every turn).
  This is an SDK behavior, not a Ductum bug, but the cost adds up
  fast — ~$22 per Codex impl in this session. Consider routing more
  builds to GLM ($0.04 for the same kind of work) once the parity is
  proven.
- **`ProjectList.tsx` LOC.** The homepage component is now over the
  300-LOC repo limit. The Codex enriched-runs branch already splits
  it via a `RunFeed` component — adopt that split when merging.

## What's still broken (minor)

- **P5-COMMAND-PALETTE** in this run hit a real verification failure
  (`stage=implement, terminal=failed`). The diff is in the worktree
  branch `ductum/P5-COMMAND-PALETTE-DrtG47` for review.
- **P2-RUN-FAILURE** is still implementing as of report time —
  long-running sonnet session at 22 min. The fixed lifecycle means it
  won't be falsely stalled, but it's also not blocking anything.

## What was *not* changed

Per the constraints in the super-prompt:

- ❌ `awaiting_approval` was NOT added to `WorkflowStage`. It's a
  derived display state.
- ❌ Auto-retry was NOT removed wholesale. The split-by-cause is still
  on the to-do list (P3).
- ❌ The `run_id` MCP workaround is still in place. HTTP transport is
  the next architectural fix.
- ❌ Cost was NOT fixed in the dashboard layer. It's computed at the
  persistence boundary and read by every consumer.
