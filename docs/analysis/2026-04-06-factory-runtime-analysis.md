# Ductum Factory Runtime Analysis — 2026-04-06

**Context:** Live dispatch of `impl-005-operational` (5 tasks) to a 3-agent factory (sonnet, glm, codex). Observed via dashboard, CLI, and API for ~40 minutes. Goal of this doc: capture what actually happened, what worked, what didn't, and present the design decisions that need to be made.

## TL;DR

The factory **is producing real code**. 4+ agent runs successfully implemented features, committed them to dedicated branches, and pushed them. One run produced a 393-line, 11-file diff that builds cleanly.

But the factory **looks broken** because:
1. The stall detector marks completed runs as "stalled" (race condition)
2. The dashboard hides task names and shows failures alongside successes
3. Auto-retry creates 4–8 duplicate branches per task
4. There's no diff viewer, so users can't approve work without leaving the dashboard
5. Reviews don't feed back to the original agent — they spawn fresh runs

The hard architectural work (multi-model dispatch, workflow enforcement, MCP integration, worktree isolation, post-completion pipeline) is done and functional. The remaining issues are lifecycle management and UX.

---

## The Run

**Spec:** `impl-005-operational` — 5 tasks (P1-TRIAGE-HOMEPAGE, P2-RUN-FAILURE, P3-PROJECT-CONTROL, P4-APPROVAL-QUEUE, P5-COMMAND-PALETTE) with 2 dependencies (P3→P1, P4→P2).

**Agents:** sonnet (Claude Sonnet 4.6), glm (GLM-5v-turbo via Anthropic compat), codex (GPT 5.4 via Codex SDK).

**Duration:** ~40 minutes.

**Result:** 11 runs created. Dashboard reports: 12 active, 9 needs attention, 0 completed, $15.19 spent.

**Reality:** 4 runs shipped working code to git branches. 1 run was a real test failure. 6 runs are duplicates spawned by broken stall detection.

## Run-by-run reality check

| Run | Task | Agent | Reality | Dashboard Says |
|-----|------|-------|---------|----------------|
| `r3_eoo` | P1-TRIAGE | codex | Verify=PASS, branch pushed | Stalled |
| `E7vkaw` | P2-RUN-FAILURE | sonnet | Hit "prompt too long" after 194 activities | Stalled |
| `5r4nmh` | P5-COMMAND-PALETTE | glm | Verify=PASS, work shipped | Stalled |
| `VAB4hB` | P1-TRIAGE | codex | Verify=PASS, branch pushed (3.4M tokens) | Stalled |
| `tvBv5X` | review-P1 | glm | Reviewed, returned actionable FAIL | Stalled |
| `aUeIrx` | P2-RUN-FAILURE | sonnet | Verify=FAIL (real test break) | **Failed (correct)** |
| `FhcuRv` | P5-COMMAND-PALETTE | glm | **SHIPPED** — 393 lines, 11 files, branch pushed, `ductum.complete` called | "needs attention" / awaiting approval |
| `BnO4z9` | P1-TRIAGE | codex | Still implementing | Active |
| `9PrFAM` | review-P5 | sonnet | Returned FAIL with specific feedback | Stalled |
| `CfTqJA` | review-P5 | sonnet | Active | Active |
| `6-ijKN` | review-P1 | glm | Just started | Active |

**The branches in git right now (verified):**
- `ductum/P5-COMMAND-PALETTE-FhcuRv` — 393 insertions, builds cleanly, ready to merge
- `ductum/P1-TRIAGE-HOMEPAGE-VAB4hB` — verify=PASS, content unverified
- `ductum/P5-COMMAND-PALETTE-5r4nmh` — verify=PASS
- 8 total P5-COMMAND-PALETTE branches across all retries

The factory shipped code. The factory is the only thing that doesn't know it.

## Critical issues (priority ordered)

### P0 — "Stalled" doesn't mean stalled

**Symptom:** Runs that completed successfully and called `ductum.complete` get marked `terminal=stalled`.

**Root cause:** Two independent code paths run on different timers:

1. **Heartbeat-based stall detector** runs in the dispatcher cycle (every 10s). Checks `lastHeartbeat` against `heartbeatTimeoutSeconds` (default 120s). If exceeded, marks the run stalled.

2. **`handleSessionEnd`** fires when the harness session promise resolves. Records final tokens, runs the post-completion pipeline (verify + review dispatch), cleans up.

The stall detector doesn't check whether `handleSessionEnd` is in progress or has been called. Long-running sessions (Codex doing 30+ minutes of real work) trip the detector even though they're alive. When `handleSessionEnd` finally fires, the run is already marked stalled — and the post-completion pipeline never runs, OR runs but the resulting state changes are masked by the prior `failed` state.

**Evidence:** `FhcuRv` (P5-COMMAND-PALETTE / glm) has activity entries showing:
- `git push -u origin ductum/P5-COMMAND-PALETTE-FhcuRv` (success)
- `ductum.complete` called with full result
- Session ended with `subtype=success`, `cost=$2.46`

But the run shows `terminal=stalled` in the DB.

**Required fix:**
- The stall detector must skip runs where `handleSessionEnd` has fired or is in flight.
- Add a `session_ending` flag on the run record (or in dispatcher state) before `handleSessionEnd` runs its post-completion pipeline.
- Bonus: thread `factory.heartbeatTimeout` from `ductum.yaml` into the dispatcher config (currently hardcoded 120s).

### P1 — No "shipped, awaiting approval" state

**Symptom:** `FhcuRv` shows `stage=ship`, `pendingApproval=true`, `terminalState=null`. The dashboard counts it under "needs attention" alongside actual failures.

The user can't tell:
- "5 things succeeded, please approve them" (good)
- from "9 things are broken" (bad)

**Required fix (corrected after Codex review):**

This is a **derived display state**, not a new core stage. Approval is already modeled as `stage='ship'` plus `pendingApproval=true`, and watchers key off the ship transition. Adding a new workflow stage would fork dashboard semantics from Edictum/runtime semantics.

- Define one shared display status enum derived from existing fields: `running | awaiting_approval | failed | stalled | done`.
- Compute it from `stage`, `terminalState`, `pendingApproval`, and heartbeat age.
- Use it consistently in dashboard counts, row badges, the approval queue, and CLI status output.
- **Do not** add a new value to `WorkflowStage` or `RunActivityKind`. Do not mutate Edictum's workflow enum.

Files: a new `packages/core/src/run-display.ts` (or similar) with `deriveDisplayStatus(run)`, used by dashboard hooks and CLI formatters.

### P2 — Dashboard rows hide the task name

**Symptom:** Each run row on the home page reads:

```
Implementing  glm  37m 49s  $4.11  18m ago
```

What's missing:
- Task name (the most important info)
- Spec name (which spec context)
- Retry attempt number (is this attempt 1 or 4?)
- Diff size (did anything actually get written?)
- Pending approval indicator

To know which row is `P5-COMMAND-PALETTE` vs `review-P1-TRIAGE-HOMEPAGE`, you must click into each one. With 12 runs visible, that's 12 clicks just to identify the rows.

**Required fix:** Show task name + spec name + attempt number on each row. Move stage and agent to secondary position.

### P3 — Auto-retry creates duplicate branches and wastes tokens

**Symptom:** P5-COMMAND-PALETTE has **8 branches** in git, all from different retry attempts. None merged, none compared. Each retry creates a fresh worktree from main, re-runs `pnpm install` + `pnpm rebuild`, redoes the same exploration and implementation. ~$15 spent across all 11 runs, most of which is duplicate work.

**Root cause:** The dispatcher's `retryOrFailStalledTask` automatically resets the task to `ready` after each stall. The same code path handles legitimate crashes/timeouts AND false heartbeat stalls. Combined with P0 (stalls aren't real stalls), this turns one task into infinite duplicates.

**Required fix (corrected after Codex review):**

Splitting policy by cause, not removing retries wholesale:

1. **First fix P0** so heartbeat stalls stop happening for completed work. Most of the duplicate branches will disappear immediately.
2. **Then** decide whether heartbeat-expired runs (genuine silent dies) should still auto-retry, or surface to user. Crashes/timeouts should still auto-retry — that's useful recovery behavior.
3. Track retry lineage on the run record (`parentRunId` for retries, not just for child runs).
4. If the user manually retries, default to **resuming the previous worktree** on the previous branch.
5. Dashboard should group retries visually: "P1-TRIAGE attempt 1 (failed)", "attempt 2 (active)".

The blunt "no auto-retry" approach throws away genuine recovery. The split policy keeps it for crashes/timeouts but stops the heartbeat-stall cascade.

### P4 — No diff viewer in the dashboard

**Symptom:** A run reaches `awaiting_approval` state. The whole point of approval is "review what the agent built and decide." But the dashboard never shows the diff. To approve `FhcuRv`, the user has to:

1. Find the worktree path (it's listed but not linked)
2. Open a terminal
3. `cd .ductum/worktrees/ductum/P5-COMMAND-PALETTE-FhcuRv/ductum`
4. `git diff main`
5. Read it
6. Switch back to the dashboard
7. Click approve

**Required fix:** Embed a diff viewer on the run detail page. Pull the branch's diff against main via git, render with syntax highlighting and a file tree. Approve/reject buttons sit next to the diff.

### P5 — Cost shows $0.00 for codex despite millions of tokens

**Symptom:** Codex runs `r3_eoo` and `BnO4z9` show `cost=$0.00` despite having millions of tokens. We previously fixed token tracking but `turn.completed` events are still inconsistent for Codex SDK.

**Required fix (corrected after Codex review):**

Server-side, not client-side. Every consumer (API, CLI, dashboard, watchers) reads `run.costUsd` from the persisted run record. Fixing only the dashboard would leave the API, CLI, and stored data wrong.

- Add `packages/core/src/model-pricing.ts` with per-model in/out rates.
- Compute `costUsd` where token updates are persisted (`runRepo.updateTokens` or `postTokens` handler).
- Resolve model identity from `run.agentId` → `agent.model` at the persistence boundary. The Codex harness path currently doesn't carry model identity cleanly to that point, so this requires:
  - Threading the agent's `model` field into the dispatcher's session metadata, OR
  - Looking up the agent inside `updateTokens` (cheap, indexed lookup).
- Fix both `codex-sdk` and `codex-app-server` harnesses (both currently hardcode `costUsd: 0`).
- Once persisted cost is correct, the dashboard, CLI, and API all show the right value with no per-consumer logic.

### P6 — Review/fix loop is fundamentally broken (multiple layers)

**Symptom 1:** `9PrFAM` (review-P5 / sonnet) returned a clear FAIL with specific feedback ("Two functional bugs make copy buttons invisible"). The original implementation never gets fixed.

**Symptom 2 (first Codex review):** Original code had `routeReviewResult` checking `task.name.startsWith('review-')`. **`fix-*` tasks weren't handled at all** — they fell through to nothing.

**Symptom 3 (second Codex review of v2):** The "fix" applied since (`dispatcher.ts:355`) routes completed `fix-*` runs through `routeReviewResult`, but `routeReviewResult` only processes `review-*` tasks (line 480) — fix runs still dead-end. The fix relocated the bug, didn't repair it.

**Symptom 4 (also second Codex review):** Even if the early return gets patched, the parsing is wrong. Fix prompts (`post-completion.ts:167`) tell agents to return a plain description of changes. The parser (`post-completion.ts:193`) only understands `PASS:`/`FAIL:`. A fix that "succeeds" might be misparsed as FAIL.

**Current state in code (today, on `main`):**

- `parentRunId` is always `null` — set to null in `dispatcher.ts:238` on every dispatch. No code path sets it.
- Every dispatched run gets a fresh worktree from main — `dispatcher.ts:282` calls `worktreeManager.create()` unconditionally. There is no worktree reuse path.
- Fix runs end up with their own brand-new branch off main, not the implementation's branch.
- `routeReviewResult` returns early for any task whose name doesn't start with `review-`, so completed `fix-*` runs do nothing.
- The fix prompt produces a description, but no code reads it.

In short: **fix runs as currently implemented are dead code.** They get dispatched, do work in a useless fresh worktree, complete, and the result goes nowhere.

**Target model — fully autonomous loop (no human in the loop):**

The reference is Edictum's CI review pattern, but with the human "fix and push" step replaced by an AI fix agent:

1. **Implement run** — Agent A writes code on a new branch, commits, pushes, completes.
2. **Review run** (independent pass) — Agent B reads the FULL current diff, returns verdict (`pass` / `warn` / `fail`) with specific feedback.
3. **If FAIL/WARN: Fix run** — Agent C (could be same as A) reads the review feedback and the current branch state. Adds more commits to the **same branch**. Pushes. Completes.
4. **New independent review pass** — fresh review run on the updated branch. Not "verify the fix matched the feedback" — an adversarial review of the current code, may catch:
   - Things the previous review missed (reviews aren't perfect)
   - New issues introduced by the fix
   - Clean state — pass
5. **Loop** until review returns clean OR max iterations exceeded → escalate.

**Key properties of the target model:**
- Each review is **independent** — looks at the current full diff, may find different things than previous passes.
- Fix runs **commit and push** code changes. They're not "verdict producers." They produce diffs, not parse results.
- Each run (impl, review, fix, re-review) has its own lifecycle — own session, own tokens, own cost. Chained by pushing to the same branch, not by sharing process state.
- Lineage is tracked via `parentRunId`: `task → impl run → review run → fix run → review run → ... → ship`. **`parentRunId` does not exist on these runs today; it needs to be set.**
- Worktree continuity: fix runs MUST reuse the implementation run's worktree (same branch, accumulated commits, installed deps). **No code path supports this today; it needs to be built.**

**What's actually broken in Ductum (vs the target):**

| Bug | Current behavior | Target behavior |
|-----|------------------|-----------------|
| Fix runs route to `routeReviewResult` which only handles `review-*` tasks | Dead end | Treat as a code-producing run, not a verdict |
| Parser expects PASS/FAIL but fix prompt asks for a description | Misparsed | Don't parse fix output as a verdict at all |
| No "trigger new review after fix" path | No re-review | Post-completion of a fix dispatches a fresh review run |
| `parentRunId` always null on dispatch | No lineage | Set `parentRunId` for fix and review runs |
| Fix runs get fresh worktrees from main | Loses original implementation | Reuse the implementation run's worktree |
| No max-iteration escalation | Infinite loop possible | After N cycles, escalate to manual |

**Required fix (sequenced):**

1. **Repair the dead routing.** Distinguish three completion paths in `handleSessionEnd`:
   - **Implementation run completes** → verify (build+test) → on success, dispatch review run.
   - **Review run completes** → parse PASS/FAIL → on FAIL, dispatch fix run; on PASS, advance original to ship.
   - **Fix run completes** → verify (build+test, on the same worktree) → on success, dispatch a fresh review run; on failure, escalate.
2. **Worktree reuse.** Add a `reuseWorktreeFrom?: RunId` option to the dispatcher. When set, skip `worktreeManager.create()` and copy the worktree path from the parent run. Set this when dispatching a fix run.
3. **Lineage.** Set `parentRunId` when creating fix and review runs. Currently always null on dispatch.
4. **Max iterations.** Track the number of fix→review cycles for a given root implementation run. After N (start with 3), mark the root as `failed` with reason `max_review_iterations` and stop dispatching fix runs.
5. **Verify happens once per fix.** A fix run's `handleSessionEnd` runs verify on the worktree (same place an implementation run runs verify). The post-fix path then dispatches a new review WITHOUT running verify again — verify already ran as part of the fix completion.

**Files (target architecture, none of this exists today):**
- `packages/core/src/dispatcher.ts` — three-way completion routing, worktree reuse, lineage tracking, iteration counting.
- `packages/core/src/post-completion.ts` — split into `runImplCompletion`, `runReviewCompletion`, `runFixCompletion`. Don't try to share one path.
- `packages/core/src/repos/run.ts` — already has `parentRunId` column, just needs to be populated.
- `packages/core/src/worktree.ts` — `WorktreeManager` may need a "claim existing worktree for new run" method, or the dispatcher just stores the path string and skips creation.
- `packages/dashboard/src/pages/RunDetail.tsx` — show the lineage chain once it exists.

**Test coverage needed:**
- Impl → review FAIL → fix → review PASS → ship.
- Impl → review FAIL → fix → verify FAIL (fix made it worse) → escalate.
- Impl → review FAIL → fix → review FAIL → fix → review FAIL → max iterations → escalate.
- Two consecutive reviews flag different findings (verifies independence).
- Fix run uses the same worktree path as the implementation run it's fixing.
- `parentRunId` chain reads correctly from the dashboard.

**Test coverage needed:**
- Impl → review FAIL → fix → review PASS → ship.
- Impl → review FAIL → fix → verify FAIL → escalate (fix made it worse).
- Impl → review FAIL → fix → review FAIL again → fix → ... → max iterations → escalate.
- Two reviews flag different things (verifies independence of passes).

### P7 — Recent blocks panel is noise

**Symptom:** The run detail page shows:

```
RECENT BLOCKS
22:23  Bash  Only git, gh, and build/test commands in ship
22:23  Bash  Only git, gh, and build/test commands in ship
22:22  Bash  Only git, gh, and build/test commands in ship
22:22  Bash  Only git, gh, and build/test commands in ship
22:22  Bash  Only git, gh, and build/test commands in ship
```

Five identical blocks. The agent ran `git status` / `git log` in `ship` stage where the regex doesn't allow them, got blocked, retried with a slightly different command, succeeded, moved on. **The blocks didn't prevent the work** — they're just noise.

**Required fix:**
- Group consecutive identical blocks into a count badge.
- Hide blocks for tools where the agent immediately retried successfully.
- Or: relax the `ship` stage regex to allow common read-only git commands.

### P8 — 5 clicks to debug a single run

**Symptom:** Dashboard navigation depth:

```
Home → Project → Spec → Task → Run → Activity tab
```

To compare 3 agents on the same spec, that's 15 clicks plus tab switching. The information for "what happened in this dispatch" is scattered across 5 different pages.

**Required fix:** A "spec command center" view. One screen per spec showing:
- All tasks with their current state
- All runs (including reviews and fixes) grouped by task
- Diff size, cost, agent, status for each run
- Inline approve buttons
- Cross-task dependencies as a DAG visualization

## What's actually working

Despite the issues above, the following are functional and proven:

- ✅ **Cross-model dispatch.** sonnet, glm, codex all dispatched and ran in parallel via three different SDK harnesses.
- ✅ **Workflow stage enforcement.** Tools blocked correctly per stage. `command_not_matches` enforces guardrails. Auto-advance from evidence works.
- ✅ **MCP for all three agents.** Sonnet/glm via Claude Agent SDK in-process MCP. Codex via global stdio MCP server registered with `codex mcp add`.
- ✅ **MCP responses captured in activity feed.** After fixing the `tool_result` DB constraint, the dashboard shows full structured responses.
- ✅ **Worktree isolation.** Each run gets its own git worktree with native deps installed via `setup.commands` from the workflow profile.
- ✅ **Setup commands.** `pnpm install --frozen-lockfile` + `node-gyp rebuild` for `better-sqlite3` works reliably.
- ✅ **Verification catches real failures.** `aUeIrx` was a legitimate test break (sonnet's code), correctly marked failed.
- ✅ **Reviews catch real bugs.** GLM's review of P5 found "copy buttons invisible" before any merge.
- ✅ **Real code is being produced and pushed.** `FhcuRv` shipped 393 lines across 11 files, builds cleanly, ready to merge.

## What we explicitly tried and learned

### What didn't work — and why

- **9-stage workflow** (read → branch → verify → implement → verify → review → push → CI) — agents fought it, blocks happened constantly, didn't match how agents actually work. Replaced with 3-stage (understand → implement → ship).
- **`workspace-write` sandbox for Codex** — blocks MCP server HTTP calls. Switched to `danger-full-access` since worktree provides isolation.
- **`--config mcp_servers.* = ...`** for Codex MCP — doesn't fully wire the transport. Use `codex mcp add` instead.
- **Pre-bound run ID for Codex MCP** — global MCP server (registered via `codex mcp add`) only sees env vars set at registration time, not per-session. Worked around by accepting `run_id` in tool args. **This is a workaround, not the right architecture** — see the new section "Codex MCP architecture issue" below.
- **`tool_use_summary` as MCP response** — Claude SDK doesn't surface MCP outputs through this. Solved by having MCP tools post their own responses to the activity feed via `postActivity`.
- **`ductum.complete` as terminal** — bypassed the workflow. Codex changed it to non-terminal; factory now owns the ship transition.
- **Auto-advancement of no-exit stages** — Edictum bug, fixed upstream in `@edictum/core@0.4.2` (edictum-ai/edictum-ts#171 and #168).

### What survived multiple iterations

- The 3-stage workflow (`understand → implement → ship`) — agents flow through it naturally.
- `setup.commands` in workflow profile — needed for any non-trivial repo.
- Cross-model review pattern — different models catch different bugs.
- Worktrees in `.ductum/worktrees/` (not `/tmp`) — solved macOS symlink path bug.
- Slug-based dashboard URLs — readable, shareable, debuggable.
- Readable CLI labels (`ductum/P1-TRIAGE/qVy6qB`) — much better than raw IDs.

## Codex MCP architecture issue (must fix, not paper over)

**Current state in code (today, on `main`):**

- The MCP server has BOTH a pre-bound mode (via `DUCTUM_RUN_ID` env) AND accepts `run_id` as an optional parameter on every tool. See `packages/mcp/src/server.ts:49` (`resolveRunId`) and the tool schemas in `packages/mcp/src/tools/*.ts`.
- Claude and GLM agents use the pre-bound path — the dispatcher creates a per-run in-process MCP server and calls `bindToRun(runId)`.
- Codex agents use the `run_id` argument path — the global stdio MCP server (registered via `codex mcp add`) reads run identity from each tool call.
- The Codex prompt hint (`codex-sdk.ts:126`) tells the agent to pass `run_id` in every call.

The `run_id` argument path was added in this session as a workaround. It is in the code now.

**Why this is a problem:**

- **It breaks the per-session binding decision.** The Ductum design treats run identity as something the harness owns and the agent never sees. Putting `run_id` in tool args puts it in the agent's hands — where it can be wrong, missing, or spoofed by a misbehaving model.
- **It forks the surface.** Claude and GLM use one tool surface (no `run_id` arg), Codex uses another (with `run_id`). The same MCP server has two contracts depending on who's calling.
- **It's the wrong layer.** The problem is "Codex's global MCP registration can't carry per-spawn env vars." That's a transport problem, not a tool API problem. The fix should be at the transport layer.

**Why we did it anyway:** Codex CLI registers MCP servers globally via `codex mcp add`. The env vars (including `DUCTUM_RUN_ID`) are baked in at registration time. There's no per-spawn env override available in the Codex SDK or CLI today.

**Target architecture:**

The Claude harness runs an in-process MCP server per dispatch and calls `bindToRun(runId)` before the agent starts. We need an equivalent for Codex that doesn't require putting run_id in tool args.

Options (none built):
1. **Per-spawn `codex mcp add`** — register a uniquely-named MCP server (`ductum-{runId}`) before each Codex spawn, deregister after. Each registration carries the right `DUCTUM_RUN_ID` env. Hacky but works with existing Codex CLI.
2. **HTTP/SSE MCP transport** — expose the Ductum MCP server over HTTP from the API process. Codex's MCP supports HTTP transports. Per-run isolation via URL path: `http://localhost:4100/mcp/{runId}`. Tools never see `run_id` as an argument.
3. **MCP server reads run ID from a side channel** — not feasible with stdio MCP.

Option 2 is the right answer. HTTP transport gives per-run isolation without env var hacks, works with both Claude and Codex (Claude can also use HTTP), and decouples the MCP server from the dispatcher process.

**Required changes (target, not done):**
- Implement HTTP MCP transport in `packages/api/src/routes/mcp.ts`, keyed by run ID in the URL path.
- Update Codex harness to register the HTTP endpoint instead of the stdio binary.
- Update Claude harness to optionally use HTTP transport (or keep in-process for now — the contract becomes uniform regardless).
- **Then** revert the `run_id` argument additions in `packages/mcp/src/server.ts` (`resolveRunId`) and `packages/mcp/src/tools/*.ts`. Restore `requireBoundRun()` as the only run-resolution path.

The `run_id` workaround should NOT become permanent architecture. Today it's in the code; the plan is to remove it after HTTP transport lands.

## The design questions that need answers

These are not bugs. They're decisions about how the factory should work that we keep dancing around.

### Q1: What does "3 agents working in parallel" mean?

Today: all 3 agents work on different tasks within the same spec, in parallel. But the dispatcher allocates tasks to whichever agent is free, not by capability. We end up with:
- glm doing complex P5 (lots of files, expensive)
- codex doing trivial P1 (cheap, fast)
- sonnet doing P2

That's load balancing, not specialization. Is that what you want?

**Alternatives:**
- A. **Specialization.** glm = docs, codex = build, sonnet = review. Routing by capability tag.
- B. **Competition.** All 3 agents implement the same task, factory picks the best diff (auto or human).
- C. **Pipeline.** Agent 1 implements, Agent 2 reviews, Agent 3 (if review fails) refactors.

Today is closest to (A) in config but (load balancing) in practice.

### Q2: What's the review feedback loop?

Today: a review run produces FAIL feedback. The dispatcher creates a `fix-` task and dispatches it as a fresh run.

**The fundamental question:** is "fix after review" a new task or a continuation?
- **New task** (today): clean separation, no shared state, but agent loses all context.
- **Continuation:** same worktree, same branch, feedback as a new prompt turn. Preserves context but couples runs together.

The continuation model is what you'd want for any real software workflow. The current new-task model is what's easy to implement.

### Q3: What does the dashboard SHOW?

Today: a flat list of runs with stage/agent/duration. A 5-deep nav tree. A 710-line RunDetail page with 7 tabs.

**The fundamental question:** what's the primary unit the user thinks in?
- **Run** (today): each session is the focus. But users care about task outcomes, not individual runs.
- **Task:** each task has 1+ runs. Show task state, latest run, retry history.
- **Spec:** each spec has tasks. Show spec progress, all task states, all runs, all diffs in one place.

The "spec command center" model would match how users actually think: "I dispatched impl-005, what's the status of all 5 tasks?"

### Q4: What does the user actually approve?

Today: a button on the run detail page that does... something. There's no diff. There's no comparison against main. The user has to leave the dashboard to actually evaluate.

**The fundamental question:** what does "approve" trigger?
- **Today:** the workflow advances to `done`. Nothing else happens.
- **Should:** create a PR on GitHub with the branch already pushed. Link to PR in the dashboard. Approval = "I reviewed it, ship it."
- **Or:** auto-merge to main. Approval = "I trust it."

We have no PR creation logic at all. The branch sits in git unmerged.

### Q5: Cost vs token tracking

Today: cost is whatever the SDK reports. Codex reports $0.00. Sonnet reports correctly. GLM reports through Anthropic-compat.

**The fundamental question:** do we trust SDK cost reporting or compute it ourselves?
- **Today:** trust SDK. Inconsistent for codex.
- **Should:** maintain a `model_pricing.ts` with per-model rates. Compute cost from `tokensIn * inputPrice + tokensOut * outputPrice`. Self-consistent, accurate, doesn't depend on SDK behavior.

## Recommended order (updated after Codex review)

The principle: **fix lifecycle truth before touching UI.** Don't paper over wrong state with prettier dashboards.

### Step 1: Fix lifecycle truth (P0)

Stop the false-failure cascade. Everything else is downstream of this.

- Add a `finishing` guard in the dispatcher around `handleSessionEnd` so `checkStalled()` skips runs already ending.
- Thread `factory.heartbeatTimeout` from `ductum.yaml` → `serve.mjs` env → API → dispatcher config. Stop using the hardcoded 120s default.
- Add tests covering: long-running session with valid heartbeats, session that ends just as stall check fires, session that crashes mid-pipeline.

**Files:** `packages/core/src/dispatcher.ts`, `packages/core/src/dispatcher-support.ts`, `packages/api/src/index.ts`, `scripts/serve.mjs`, dispatcher tests.

### Step 2: Fix the review/fix loop (P6)

See P6 for the full target architecture and the bug table. The sequence:

1. **Repair the dead routing.** Add a third completion path in `handleSessionEnd` for `fix-*` tasks: run verify on the (reused) worktree, then dispatch a fresh review.
2. **Add worktree reuse.** Fix runs must reuse the implementation run's worktree path. Today every dispatch creates a fresh worktree from main; the dispatcher needs a "reuse worktree from parent run" code path.
3. **Set `parentRunId`.** Today it's always null. Set it on fix runs (parent = the implementation run) and review runs (parent = the run being reviewed).
4. **Track iteration count.** Cap fix→review cycles per root implementation run. After N (start with 3), escalate.
5. **Don't parse fix output as a verdict.** Fix runs produce code, not PASS/FAIL.

**Files:** `packages/core/src/dispatcher.ts` (three-way routing, worktree reuse, lineage), `packages/core/src/post-completion.ts` (split into impl/review/fix paths), `packages/core/src/repos/run.ts` (populate `parentRunId`).

### Step 3: Derived display state (P1)

Don't add a new core stage. Add a derived display function.

- Create `packages/core/src/run-display.ts` with `deriveDisplayStatus(run): 'running' | 'awaiting_approval' | 'failed' | 'stalled' | 'done'`.
- Computed from existing fields: `stage`, `terminalState`, `pendingApproval`, heartbeat age.
- Use it in dashboard (`ProjectList.tsx`, `RunDetail.tsx`), CLI status formatter, approval queue.
- Do NOT change `WorkflowStage` or `RunActivityKind` enums.

**Files:** `packages/core/src/run-display.ts` (new), `packages/dashboard/src/pages/ProjectList.tsx`, `packages/dashboard/src/lib/derived-status.ts`, `packages/cli/src/format.ts`.

### Step 4: Embed diff viewer (P4)

Make approval reviewable. Keep "approve" meaning "record ship-stage approval" — PR creation comes later.

- Add `GET /api/runs/:id/diff` returning the git diff between the run's branch and main.
- Add a `<DiffViewer>` component that fetches and renders with file tree + syntax highlighting.
- Embed it on `RunDetail.tsx` and the approval queue.

**Files:** `packages/api/src/routes/runs.ts` (new endpoint), `packages/dashboard/src/components/DiffViewer.tsx` (new), `packages/dashboard/src/pages/RunDetail.tsx`, `packages/dashboard/src/pages/ApprovalQueue.tsx`.

### Step 5: Fix cost on the server (P5)

Make `run.costUsd` correct at the persistence boundary. All consumers benefit.

- Create `packages/core/src/model-pricing.ts` with per-model in/out rates.
- In `runRepo.updateTokens` (or wherever tokens get persisted): look up `agent.model` from `run.agentId` and compute cost from token deltas. Or thread model identity through the harness's `postTokens` payload.
- Fix both `codex-sdk` and `codex-app-server` harnesses (both currently hardcode `costUsd: 0`).

**Files:** `packages/core/src/model-pricing.ts` (new), `packages/core/src/repos/run.ts` (cost computation in `updateTokens`), `packages/harness/src/types.ts`, `packages/harness/src/codex-sdk.ts`, `packages/harness/src/codex-app-server.ts`.

### Step 6: UX cleanup

Only after lifecycle, loop, and cost are truthful:

- Show task/spec/attempt on home rows (P2)
- Group consecutive identical block messages (P7)
- Add retry lineage UI (P3)
- Spec command center view (P8)
- Codex MCP HTTP transport (replaces `run_id` workaround)

**Files:** `packages/dashboard/src/pages/ProjectList.tsx:86`, `packages/dashboard/src/pages/ProjectList.tsx:250`, `packages/dashboard/src/pages/RunDetail.tsx`, eventually `packages/api/src/routes/mcp.ts` (new).

### What NOT to do

- ❌ Don't add `awaiting_approval` to `WorkflowStage`. It's a derived display state.
- ❌ Don't remove auto-retry wholesale. Split policy by cause: heartbeat-stall vs crash/timeout.
- ❌ Don't keep `run_id` arg as the answer for Codex MCP. It breaks per-session binding. Move to HTTP transport.
- ❌ Don't fix cost in the dashboard. It needs to be persisted correctly.
- ❌ Don't ship UI improvements before the lifecycle is truthful. Pretty dashboards on lying state are worse than ugly dashboards on honest state.

## What this report ISN'T

This is not "everything is broken, throw it out." The factory has the right bones. The fixes above are mostly UX and lifecycle management — not core architecture changes. Most of what's wrong is downstream of one or two real bugs (stall detection + dead fix-task path) that cascade into visible chaos.

## Review history

**v1** — initial analysis after watching 11 runs over ~40 minutes. Identified P0 stall race, dashboard rows hide task name, 8 duplicate branches per task, no diff viewer.

**v2 — corrections from Codex review:**
- **P1 corrected:** `awaiting_approval` is a derived display state, not a new core stage. Don't fork dashboard semantics from Edictum.
- **P3 corrected:** "no auto-retry" is too blunt. Split policy by cause — keep retries for crashes/timeouts, only stop the heartbeat-stall path.
- **P5 corrected:** cost fix belongs at the persistence layer, not the dashboard. Every consumer reads `run.costUsd`.
- **P6 expanded:** found a worse bug — completed `fix-*` runs have NO routing path at all. `routeReviewResult` only handles `review-*` tasks. Repair this dead path before any "session continuation" debate.
- **Codex MCP architecture issue added:** the `run_id` arg workaround breaks per-session binding. Should move to HTTP MCP transport instead. Don't let the workaround become permanent architecture.
- **Recommended order rewritten** to follow Codex's plan: lifecycle → loop → derived state → diff → cost → UX. Fix truth before painting prettier dashboards.

**v3 — second Codex review + correct fix-loop model:**
- **P6 rewritten with correct model.** v2 proposed "kill fix-* tasks, redesign as same-run reset-to-implement." That's wrong. The right model is fully autonomous, but fix runs are real:
  - Implement run → review run (independent verdict pass) → if FAIL, fix run (writes commits, doesn't return a verdict) → fresh review pass on updated branch → loop.
  - Each review is independent — looks at full current diff, may catch different things than previous passes.
  - Fix runs reuse the implementation run's worktree (same branch, accumulated commits), don't fork from main.
  - Lineage tracked via `parentRunId` so the dashboard can show the chain.
- **Second Codex review of v2 caught:** the "fix" applied between v1 and v2 doesn't actually fix anything — it routes `fix-*` runs into `routeReviewResult` but that function returns early for non-review tasks. Dead path relocated, not repaired.
- **Also caught:** parser confusion. Fix prompts return descriptions, parser expects PASS/FAIL. Even with routing fixed, the verdict would be wrong.
- **Edictum CI as reference:** review.yml runs an exhaustive review on each push. The human equivalent (you, with Claude Code) reads the review and pushes fixes, triggering a new independent review pass. Ductum needs to automate the human step with a fix agent — but the fix agent commits code, doesn't produce a verdict.

**v4 — third Codex review, structural cleanup:**
- **P6 rewritten again** to clearly separate "current state in code" from "target architecture." v3 was ambiguous about whether worktree reuse and `parentRunId` lineage exist. They don't — v4 says so explicitly.
- **Step 2 in Recommended Order rewritten** to remove the contradiction with P6. v3 said "kill the `fix-*` task model entirely" in Step 2, but P6 said "fix runs are real, just need to be routed correctly." v4 picks the P6 model: fix runs stay, dispatcher gets three-way routing.
- **Codex MCP section rewritten** with explicit "current state in code" vs "target architecture" sections. v3 said tools "don't accept run IDs as arguments" — that's the target, not the current state. The `resolveRunId` workaround is in `server.ts:49` today.
- **Verify-once contradiction removed.** v3 said "verify happens during fix completion" AND "post-completion runs but skips verify after fix" in different paragraphs. v4 picks one: verify runs once per fix run, in `handleSessionEnd` for the fix; the post-fix path dispatches a fresh review without re-running verify.
