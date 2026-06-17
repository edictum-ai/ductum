# Next Session Prompt — Ductum Factory Lifecycle Repair

You are continuing work on Ductum, an AI factory orchestration system at `/Users/acartagena/project/ductum`. Your job is to **fix the broken lifecycle so the factory produces real code end-to-end**, then prove it by dispatching `impl-005-operational` and watching all 5 tasks complete cleanly with reviews and approvals.

**You do not stop until the factory produces working code, verified live, with the dashboard and CLI showing truthful state.** Iterate. Verify. Don't ask for permission to continue — only ask if you're genuinely blocked on a decision the user must make.

## Read these files BEFORE writing any code

1. **`docs/analysis/2026-04-06-factory-runtime-analysis.md`** (528 lines, v4) — canonical analysis with 4 rounds of Codex review corrections. Contains the bug list, priority order, and explicit "what NOT to do" rules.
2. **`.claude/handover.md`** — session-specific context about what was built, what's broken, what was decided.
3. **`CLAUDE.md`** — repo conventions, architecture constraints (C1-C7), key decisions (D22-D28).
4. **`docs/analysis/2026-04-06-factory-runtime-analysis.md` § "Codex MCP architecture issue"** — read carefully, the workaround is in code today.

After reading, write a 5-line summary back to the user confirming you understand the priority order and the constraints.

## The work to do (in strict order — do not reorder)

### Step 1 — P0: Fix the stall race condition

**Problem:** Long-running sessions (Codex doing 30+ min of real work) get marked `terminal=stalled` because the heartbeat-based stall detector races with `handleSessionEnd`. When `handleSessionEnd` finally fires, the run is already failed and the post-completion pipeline never runs (or runs but is masked).

**Files:**
- `packages/core/src/dispatcher.ts` — `handleSessionEnd` and `checkStalled` race
- `packages/core/src/dispatcher-support.ts` — config types
- `packages/api/src/index.ts` — wire `factory.heartbeatTimeout` from yaml to dispatcher config (currently hardcoded 120s)
- `scripts/serve.mjs` — pass timeout through env to API
- `packages/core/src/tests/dispatcher.test.ts` — test the race

**Implementation:**
1. Add a `finishingRuns: Set<RunId>` to the Dispatcher class.
2. In `handleSessionEnd`, mark the run as `finishing` BEFORE doing any post-completion work, clear it in `finally`.
3. In `checkStalled` / `stateMachine.checkStalledRuns()`, skip any run in `finishingRuns`.
4. Thread `factory.heartbeatTimeout` (300s in `ductum.yaml`) through `scripts/serve.mjs` env → API → `DispatcherConfig.heartbeatTimeoutSeconds`. Don't use the hardcoded default.
5. Add tests:
   - Long-running session with valid heartbeats stays alive
   - Session that completes during a stall check doesn't get marked stalled
   - Session that crashes mid-pipeline still gets marked stalled correctly
6. Build, run all tests, fix any breakage.

**Verification before moving on:**
- `pnpm build && pnpm -r test` — all 233+ tests pass
- Git commit with message describing the fix
- DO NOT push yet — the code is being verified incrementally

### Step 2 — P6: Repair the fix-loop dead end

**Problem:** Fix runs (`fix-*` task name prefix) are dead code. They get dispatched, do useless work in fresh worktrees, complete, and the result goes nowhere. Multiple bugs:
- `routeReviewResult` only handles `review-*` tasks (line ~480), `fix-*` falls through
- Even if routed, parser expects `PASS:`/`FAIL:` but fix prompts return descriptions
- Fix runs always create fresh worktrees from main, losing the implementation's branch
- `parentRunId` is always null on dispatch — no lineage
- No "trigger fresh review after fix" path

**Target model (from analysis doc P6):**
```
impl run → review run (independent verdict) → if FAIL: fix run (writes commits, no verdict)
  → fresh review pass on updated branch → loop until clean OR max iterations → ship
```

Each review is independent. Fix runs commit code and push. Lineage tracked via `parentRunId`. Fix runs reuse the implementation's worktree.

**Files:**
- `packages/core/src/dispatcher.ts` — three-way completion routing, worktree reuse, lineage
- `packages/core/src/post-completion.ts` — split into `runImplCompletion`, `runReviewCompletion`, `runFixCompletion`
- `packages/core/src/repos/run.ts` — populate `parentRunId` on fix and review runs
- `packages/core/src/worktree.ts` — claim-existing-worktree path
- `packages/core/src/tests/dispatcher.test.ts` — fix loop tests

**Implementation:**
1. **Three-way routing in `handleSessionEnd`:**
   - If `task.name.startsWith('review-')` → `routeReviewResult` (parses verdict, dispatches fix or advances ship)
   - Else if `task.name.startsWith('fix-')` → new `routeFixResult` (verify on the worktree, on success dispatch fresh review, on failure escalate)
   - Else (regular implementation) → existing `runPostCompletionPipeline`
2. **Worktree reuse:**
   - Add `reuseWorktreeFromRunId?: RunId` field to a new `DispatchOptions` interface
   - When dispatching a fix run, set `reuseWorktreeFromRunId = parentRun.id`
   - In `dispatch()`, if reuse is set: read `parentRun.worktreePaths`, skip `worktreeManager.create()`, set `worktreePaths` on the new run to the same paths
   - Do NOT delete the parent's worktree on cleanup until the entire chain (impl + reviews + fixes) terminates
3. **Lineage:**
   - When creating a fix-run task, set `parentRunId = parentRun.id` (the run that's being fixed)
   - When creating a review-run task, set `parentRunId = parentRun.id` (the run being reviewed)
   - Track this through dispatcher's task creation in `routeReviewResult`
4. **Iteration cap:**
   - Walk the `parentRunId` chain backward to find the root implementation run
   - Count fix runs in the chain. If >= 3, mark the root as `failed` with reason `max_review_iterations` and STOP creating fix tasks
5. **Don't parse fix output as a verdict:**
   - Remove `parseReviewResult` calls for fix runs
   - Fix runs just produce code; success = `verify` passes on the worktree
6. **Tests:**
   - Impl → review FAIL → fix → review PASS → ship
   - Impl → review FAIL → fix → verify FAIL → escalate
   - Impl → review FAIL → fix → review FAIL → fix → review FAIL → max iterations → escalate
   - Two consecutive reviews flag different findings (review independence)
   - Fix run uses same `worktreePaths` as parent
   - `parentRunId` chain reads correctly

**Verification:**
- All tests pass
- Read your changes back, manually trace one fix-loop iteration through the code
- Commit with detailed message

### Step 3 — P1: Derived display state

**Problem:** Dashboard shows "needs attention" for runs that are actually `awaiting_approval`. Adds noise. The user wants a clean distinction.

**DO NOT add a new value to `WorkflowStage` enum.** That forks dashboard semantics from Edictum runtime semantics. The state is **derived from existing fields**.

**Files:**
- `packages/core/src/run-display.ts` — NEW, contains `deriveDisplayStatus(run): DisplayStatus`
- `packages/core/src/index.ts` — export it
- `packages/dashboard/src/lib/derived-status.ts` — use the new function
- `packages/dashboard/src/pages/ProjectList.tsx` — use display status for counts and badges
- `packages/dashboard/src/pages/RunDetail.tsx` — use display status
- `packages/cli/src/format.ts` — use display status in CLI output
- `packages/cli/src/commands/status.ts` — use it
- New tests for the derivation function

**Implementation:**
```ts
export type DisplayStatus = 'running' | 'awaiting_approval' | 'failed' | 'stalled' | 'done'

export function deriveDisplayStatus(run: Run, now: Date = new Date()): DisplayStatus {
  if (run.terminalState === 'failed') return 'failed'
  if (run.terminalState === 'stalled') return 'stalled'
  if (run.stage === 'done') return 'done'
  if (run.stage === 'ship' && run.pendingApproval) return 'awaiting_approval'
  // Heartbeat-aged runs that aren't terminal are still "running" until the dispatcher marks them
  return 'running'
}
```

Update dashboard counts on the homepage:
- `running` count = real running runs (not awaiting approval, not terminal)
- `awaiting_approval` count = a NEW count next to the others
- `failed` and `stalled` are separate
- `done` = completed

Tests:
- Run in stage `implement` with no terminal → `running`
- Run in stage `ship` with `pendingApproval=true` → `awaiting_approval`
- Run with `terminalState='failed'` → `failed`
- Run in stage `done` → `done`

### Step 4 — P4: Diff viewer in dashboard

**Problem:** Approving a run is meaningless without seeing the diff. Currently the user has to leave the dashboard, find the worktree, run `git diff`, come back, click approve. Make the diff visible inline.

**Files:**
- `packages/api/src/routes/runs.ts` — add `GET /api/runs/:id/diff` endpoint
- `packages/api/src/lib/run-ops.ts` — `getDiff(runId)` helper
- `packages/dashboard/src/api/client.ts` — add `getDiff` method
- `packages/dashboard/src/api/hooks.ts` — add `useDiff` hook
- `packages/dashboard/src/components/DiffViewer.tsx` — NEW component
- `packages/dashboard/src/pages/RunDetail.tsx` — embed `<DiffViewer>` near the approval panel

**Implementation:**
1. **API endpoint** runs `git -C {worktreePath} diff main...HEAD` and returns the raw diff text + file count + insertion/deletion counts.
2. **DiffViewer** component:
   - File tree on the left (collapsible)
   - File contents on the right with diff highlighting
   - Use a lightweight diff library OR render the raw `git diff` output in a `<pre>` with monospace font and red/green highlighting via CSS
   - DON'T pull in a giant diff library — keep it small. `react-diff-view` or just plain CSS rendering of git output is fine
3. Embed it in RunDetail above the approval panel, only when `displayStatus === 'awaiting_approval'`.
4. Tests:
   - API endpoint returns the right diff for a known branch
   - Component renders without crashing on empty diff
   - Component handles binary files gracefully

### Step 5 — P5: Cost at the persistence layer

**Problem:** `run.costUsd` shows `$0.00` for Codex runs even when millions of tokens are used. The Codex SDK doesn't reliably emit cost in `turn.completed`. Today both `codex-sdk` and `codex-app-server` harnesses hardcode `costUsd: 0`.

**Fix at the persistence layer**, not the dashboard. Every consumer reads `run.costUsd`.

**Files:**
- `packages/core/src/model-pricing.ts` — NEW, per-model in/out USD rates
- `packages/core/src/repos/run.ts` — `updateTokens` computes cost from agent.model + token deltas
- `packages/core/src/repos/agent.ts` — verify `agent.model` is accessible
- `packages/harness/src/codex-sdk.ts` — emit token deltas with model identity
- `packages/harness/src/codex-app-server.ts` — same
- Tests

**Implementation:**
```ts
// model-pricing.ts
export interface ModelPricing { inputUsdPer1M: number; outputUsdPer1M: number }
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': { inputUsdPer1M: 3, outputUsdPer1M: 15 },
  'claude-opus-4-6': { inputUsdPer1M: 15, outputUsdPer1M: 75 },
  'glm-5v-turbo': { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
  'openai/gpt-5.4': { inputUsdPer1M: 5, outputUsdPer1M: 20 },
  // Add more as needed; check actual current pricing
}
export function computeCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[model]
  if (!p) return 0
  return (tokensIn * p.inputUsdPer1M / 1_000_000) + (tokensOut * p.outputUsdPer1M / 1_000_000)
}
```

In `runRepo.updateTokens`, look up the agent's model and compute cost from the deltas. Persist the computed value, ignoring any cost the harness reports (it's unreliable).

**Verify actual prices.** The numbers above are placeholders. Check current Anthropic, OpenAI, and ZAI pricing pages and put the right values in.

Tests:
- Sonnet at 1M in / 100k out = $4.50
- Codex with 0 cost reported but real tokens → cost computed correctly
- Unknown model → cost 0 with a warning log

### Step 6 — Verify the full pipeline live

This is the gate. You don't stop until this passes.

1. **Stop any running processes:** `pkill -f "node packages/api"`, kill ports 4100/5173
2. **Clean worktrees:** `rm -rf .ductum/worktrees`
3. **Build clean:** `pnpm build` — must succeed
4. **All tests pass:** `pnpm -r test` — must show 233+ passing, 0 failing
5. **Start the server fresh:**
   ```bash
   export CLAUDE_CODE_OAUTH_TOKEN=$(grep CLAUDE_CODE_OAUTH_TOKEN ~/.zshrc | head -1 | cut -d= -f2)
   export ZAI_API_KEY=$(grep ZAI_API_KEY ~/.zshrc | head -1 | cut -d= -f2)
   node scripts/serve.mjs --reset
   ```
6. **Verify dashboard up:** `curl http://localhost:5173` returns 200
7. **Load impl-005-operational:**
   ```bash
   node packages/cli/dist/index.js spec import specs/impl-005-operational --project ductum
   # Get the spec ID from the output, approve it
   node packages/cli/dist/index.js spec approve {SPEC_ID}
   ```
8. **Watch the dashboard via Chrome MCP:**
   - Use `mcp__chrome-devtools__navigate_page` to open `http://localhost:5173`
   - Use `mcp__chrome-devtools__take_snapshot` to read the page
   - Verify the homepage shows 5 ready tasks for impl-005, then 3 dispatched runs (one per agent)
   - Verify each row shows: task name, spec name, agent, stage, cost
9. **Watch each run progress through the pipeline:**
   - `understand` → `implement` → reviewer dispatched → review verdict → either ship (if PASS) or fix dispatched (if FAIL) → cycle until clean → ship
10. **Verify the final state:**
    - At least one task reaches `done` cleanly via the full impl → review → ship loop
    - Cost is non-zero for Codex runs (P5 verified)
    - Display state shows `awaiting_approval` distinctly from `running` and `failed` (P1 verified)
    - The diff viewer shows the actual code changes for awaiting_approval runs (P4 verified)
    - No false stalls (P0 verified) — runs that complete go to ship/done, not stalled
    - Fix runs reuse the implementation worktree and add commits to the same branch (P6 verified)
    - `parentRunId` chain reads correctly via API (P6 verified)
11. **At least one task should reach `awaiting_approval` with a real diff** that you can read via the dashboard. Approve it (record approval, doesn't need to push to GitHub yet).
12. **Take screenshots** of the working dashboard with `mcp__chrome-devtools__take_screenshot --fullPage true` and save them to `/tmp/ductum-success/` for the user to review.

If any step fails, debug it, fix it, and try again. **Don't move to the next step until the current one works.** Don't move on with "good enough."

### Step 7 — Commit and write a session-end report

Once the live verification passes:

1. Push everything to main: `git push origin main`
2. Update `.claude/handover.md` with the new state — what's working, what's still broken, what to do next
3. Write a session-end summary at `docs/analysis/{date}-session-summary.md` with:
   - What was fixed (P0-P5 each section)
   - The live test results from Step 6 (with screenshots referenced)
   - Remaining known issues
   - Recommended next priorities (P2 task names on rows, P3 retry policy split, P7 block noise, P8 spec command center, Codex MCP HTTP transport)

## Constraints — read carefully, do not violate

- **pnpm always.** No npm, no yarn.
- **No Claude Code mentions in commits.** Don't add "Generated with Claude" footers.
- **No Opus.** Use sonnet, codex, glm only. Already configured in `ductum.yaml`.
- **GLM wherever possible.** It's cheapest. Use it for reviews especially.
- **CI is sacred.** Never `--no-verify`. Never skip hooks.
- **Verify before reporting done.** Run tests, run the live pipeline, check actual outputs. Don't claim success without verification.
- **No file over 300 LOC.** Split if needed.
- **The 27 decisions in CLAUDE.md are binding.** D22 (no run_id in MCP from agent) is what the Codex MCP issue is about — don't accept the workaround as permanent.
- **Don't fix in dashboard what should be fixed in core.** Cost is the canonical example.
- **Don't add `awaiting_approval` to `WorkflowStage` enum.** Derived state only.
- **Don't kill auto-fix runs.** They're real and necessary. P6 tells you exactly how to repair them.
- **Iterate until done.** Don't stop for permission unless genuinely blocked on a decision the user must make.
- **Verify with Chrome MCP.** Don't claim the dashboard works without seeing it.
- **Read files before editing.** Don't trust your memory of file contents — auto-compaction destroys context after ~10 messages.

## What "done" looks like

When you stop, the following must all be true:

- ✅ `pnpm build && pnpm -r test` — clean (zero failures)
- ✅ Live dispatch of impl-005-operational produces real code via the full impl → review → fix → ship loop
- ✅ At least one task reaches `awaiting_approval` and the diff is visible in the dashboard
- ✅ Codex cost is non-zero in the dashboard
- ✅ No false stalls — runs that complete go to ship/done
- ✅ `parentRunId` lineage chain reads correctly
- ✅ Display status shows `running | awaiting_approval | failed | stalled | done` distinctly
- ✅ Screenshots saved at `/tmp/ductum-success/`
- ✅ Commits pushed to main
- ✅ Handover and session summary updated

If any of these is false, you're not done. Iterate.

## Tools you'll need

- **TaskCreate / TaskUpdate / TaskList** — track multi-step work, especially the priority sequence
- **Read / Edit / Write / Glob / Grep** — code changes
- **Bash** — build, test, server start, git
- **mcp__chrome-devtools__** (navigate_page, take_snapshot, take_screenshot, click) — verify dashboard
- **Agent** with `general-purpose` or `frontend-developer` — parallelize independent file changes
- **Don't use plan mode.** You have a plan — execute it.

## Final reminder

**You do not stop until the factory produces real code, end-to-end, verified live with the dashboard and CLI showing truthful state.** If something doesn't work, fix it. If a fix doesn't fix it, dig deeper. If you're stuck after 3 attempts on the same problem, take a screenshot, capture the state, and ask the user one focused question — then keep going. Don't ask for permission to continue routine work.

The factory was 90% there at the end of last session. Code was being written and pushed. The lifecycle and display layer just needed truth-fixing. Get those right and you'll see the factory ship working code.

Good luck. Start by reading the analysis doc.
