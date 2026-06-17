# P7 - File-Size Discipline (dogfood, codex)

## Problem

The repo's stated rule in `CLAUDE.md` and `AGENTS.md` —

> No file over 300 LOC. Split if needed.

— is decorative. CI does not enforce it. Reviews do not catch it.
Today's audit shows:

- 49 source/test files over 300 LOC
- 16 over 500 LOC
- 7 over 1,000 LOC

Concrete offenders the recovery plan keeps tripping over:

| LOC | File | Why it matters |
|---|---|---|
| 3,276 | `packages/api/src/tests/routes.test.ts` | 10× the limit; every API route test in one file. Tests are slow to find, slow to run, painful to refactor. |
| 1,634 | `packages/core/src/tests/dispatcher.test.ts` | Same shape. |
| 1,300 | `packages/dashboard/src/pages/RunDetail.tsx` | Single React page does run state, lineage tree, transcript, evidence ledger, gate evaluations, and approval card. Splitting it is a P2 prerequisite. |
| 1,290 | `packages/api/src/lib/run-ops.ts` | Every operator HTTP path's logic lives here. Stage 0 added `operator-ship` to it and the file kept growing. |
| 1,170 | `packages/core/src/dispatcher.ts` | Session bookkeeping + retry + cost + post-completion entry all in one class. P3 (persistent session-binding) cannot land cleanly until this splits. |
| 1,024 | `packages/core/src/post-completion-router.ts` | Was *itself* extracted from `dispatcher.ts` to enforce the 300 LOC rule, then ballooned. Comment in the file still claims it exists "so the core file stays under the 300 LOC rule." |

Both rule violation and the "diary" problem stem from the same lack of
mechanical enforcement. The refactor closes that gap.

## Scope

Dispatched through Ductum. **Assigned to `codex`** because the work is
disciplined, mechanical, test-driven splitting — codex's strength.

Files in scope: top 16 over 500 LOC plus any others codex finds during
the audit. Test files and source files both in scope.

Out of scope: behavior changes, dependency upgrades, type-system
migrations, anything that changes runtime semantics. Pure structural
work only.

## Decision Trace

- Decision `109`: Factory readiness recovery — this is item P7.
- Decision `060`: No silent decision drift — file-size sprawl is a
  decision drift the rule was meant to prevent.
- Repository convention from `CLAUDE.md`/`AGENTS.md`: no file over 300 LOC.

## Behavior Contract

### 7.1 Audit and grandfather list

- Produce `decisions/<next>-file-size-grandfather-list.md` listing every
  file currently over 300 LOC with its current line count. This becomes
  the baseline.
- Each grandfathered file has an explicit "to be split by P7.x" tag so
  the gate can fail on regression but not on legacy.
- The audit re-runs after every split commit, with the count tracked in
  the decision record.

### 7.2 CI gate

- Add a script `scripts/check-file-size.mjs` that:
  - scans `packages/**/*.{ts,tsx}` (excluding `dist/`, `node_modules/`,
    `*.d.ts`)
  - fails (exit 1) if any file *not* on the grandfather list exceeds
    300 LOC
  - prints actionable output naming the file and how many lines over
- Wire it into `pnpm test` (after `pnpm test:scripts`) and into CI.
- Gate must pass on the unchanged grandfather list at landing time.
- Gate must fail if `wc -l` on any net-new file > 300 lines.

### 7.3 Split the top 7 mega-files

Each becomes its own commit, with split + tests-still-pass + grandfather
update in one atomic change. Order:

1. `packages/core/src/post-completion-router.ts` (1,024 → ≤300 each)
   - Suggested seams: `lineage` (walkParentChain, findRootRun,
     findMostRecentLineageRun), `dispatch-review`, `dispatch-fix`
     (verification + rebase variants), `route-impl-completion`,
     `route-fix-completion`, `route-review-completion`,
     `route-blind-review-completion`, `task-completion-helpers`.
2. `packages/core/src/dispatcher.ts` (1,170 → ≤300 each)
   - Suggested seams: `session-lifecycle` (activeSessions,
     handleSessionEnd, releaseSession), `cost-resolution` (token + log
     scanner snapshots), `stall-detection`, `dispatch-spawn` (cycle,
     dispatch, manualDispatch), `completion-fallback`. Public class
     `Dispatcher` stays as the public entry point but delegates.
3. `packages/api/src/lib/run-ops.ts` (1,290 → ≤300 each)
   - Already has implicit groups: accept/complete, link, evidence,
     authorize/gate-check/report, fail/close/retry, approve/reject/
     merge, operator-ship. Each group becomes its own file under
     `packages/api/src/lib/run-ops/`.
4. `packages/dashboard/src/pages/RunDetail.tsx` (1,300 → ≤300 each)
   - Extract: `RunDetailHeader`, `RunDetailLineage`, `RunDetailTranscript`,
     `RunDetailEvidence`, `RunDetailGateEvaluations`,
     `RunDetailStateMachine`, `RunDetailActions`. Keep `RunDetail.tsx`
     as the orchestrating shell.
5. `packages/api/src/tests/routes.test.ts` (3,276 → ≤300 each)
   - Split per route group: `runs.routes.test.ts`,
     `specs.routes.test.ts`, `tasks.routes.test.ts`, etc. Use
     directory `packages/api/src/tests/routes/`.
6. `packages/core/src/tests/dispatcher.test.ts` (1,634 → ≤300 each)
   - Split per behavior group, mirroring the dispatcher source split
     after step 2.
7. `packages/core/src/tests/post-completion-router.test.ts` (1,058 →
   ≤300 each)
   - Split per route + helper, mirroring step 1.

### 7.4 Sweep the remaining 42 files over 300 LOC

After the top 7 ship, codex audits each remaining grandfathered file and
splits any that have a clear seam. Files where the seam is genuinely
unclear stay grandfathered with a comment explaining why; they become
follow-up tasks for a later operator pass.

### 7.5 Update the rule documentation

- `CLAUDE.md` and `AGENTS.md` get a "How file size is enforced" section
  that names `scripts/check-file-size.mjs` and the grandfather list
  decision file.
- The CLI skill (P1) gains a recipe: "I want to add code but the file
  is at the limit → split before adding, never paper over."

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
pnpm test:scripts
node scripts/check-file-size.mjs   # must pass
git diff --check
```

Plus a structural check codex itself runs after every split:

```sh
find packages -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/node_modules/*" -not -path "*/dist/*" \
  -not -name "*.d.ts" \
  -exec wc -l {} \; \
  | awk '$1 > 300' | wc -l
```

The number must drop monotonically across commits and never increase.

## Exit Demo

1. `node scripts/check-file-size.mjs` exits 0 with the grandfather list
   shrunk by at least the top-7 split set (so 7+ files removed from the
   list, not just renamed).
2. Sum of LOC across the split files is ≤ sum before (no split should
   create more total code; refactors must not balloon).
3. Every test that ran before the refactor still runs and passes.
   `pnpm -r test` count of test-cases is `>=` pre-refactor count
   (splits cannot drop coverage; test files split by topic must
   preserve every it()).
4. A net-new file in any package can't land over 300 LOC: I
   deliberately add a 320-LOC test fixture at PR review time, the
   gate fails, I revert. Demo recorded as evidence.
5. `dispatcher.ts`, `post-completion-router.ts`, `run-ops.ts`,
   `RunDetail.tsx`, `routes.test.ts`, `dispatcher.test.ts`,
   `post-completion-router.test.ts` are all ≤ 300 LOC.

## Drift Handling

If a split would meaningfully change runtime behavior, codex stops and
records a Decision before continuing. The refactor is structural;
behavior changes need their own spec.

If a file genuinely cannot be split below 300 LOC without harming
readability (e.g. a single state-machine table, a generated migration
ledger), codex records that judgment in the grandfather-list decision
with a one-line rationale and the gate accepts the exception.

## Slop Review

- Attack any split that imports from itself in a circular pattern.
- Attack any split that drops or skips a test.
- Attack any split that lands without `check-file-size.mjs` passing.
- Attack any split that adds total LOC (refactor must shrink or hold,
  never grow).
- Attack a "split" that just moves code to a deeply-nested helper file
  to dodge the gate without improving cohesion.
- Attack a grandfather list entry without a stated reason.
