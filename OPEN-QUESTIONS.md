# Open Questions

Design questions that need answers before or during implementation.

> Historical design note. Several questions below are now partially or fully
> answered by later implementation and by decisions `053` through `057`. Keep
> this file as founding context, not as the active roadmap.

---

## Q1: Harness contract (REVISED Round 2)

**Question:** What exact guarantees must a supported harness provide for Ductum enforcement to work?

**Required harness capabilities:**
- Tool-call interception (before/after hooks with ability to block)
- Session lifecycle management (create, monitor, terminate)
- Evidence attachment (structured data from tool-call results)
- Heartbeat emission (automatic or harness-mediated)
- Token/cost reporting

**Known bypasses even with full harness support:**
- Agent can waste tokens on unproductive reasoning (not a tool call, can’t intercept)
- Agent can produce subtly wrong code that passes tests (enforcement catches process violations, not quality)
- Agent can call allowed tools in inefficient order

**Unsupported harness criteria:** If a harness cannot intercept tool calls (only observe), enforcement degrades to audit-only. Ductum should declare this and refuse to run gated workflows through that harness, falling back to advisory mode with prominent warnings.

**Status:** Claude Agent SDK likely meets all requirements (verify). OpenCode plugin system meets most (verify block capability). Generic CLI wrappers (raw Codex CLI, raw GLM CLI) likely cannot intercept — these would require the OpenCode adapter.

## Q2: Where does project data live?

**Question:** Is the SQLite database the sole source of truth, or do we also persist to files (YAML/MD) for human readability and version control?

**Options:**
- SQLite only — dashboard is the interface, files are an export
- SQLite + file sync — database is primary, files are generated/synced for git history
- Files primary, SQLite as cache — like edictum-harness but with a database index

## Q3: edictum-api readiness — RESOLVED

**Resolution (D10, D14):** edictum-api is NOT the enforcement backend. Enforcement is local via embedded @edictum/core. edictum-api is optional — audit persistence and ruleset storage when available. Ductum works without it. No longer blocking.

## Q4: Cost tracking granularity

**Question:** How granular should cost tracking be?

**Options:**
- Per-run (total tokens for the run)
- Per-tool-call (each interaction logged with token count)
- Per-model (aggregate by agent/model across runs)
- Budget alerts and hard stops

**Additional consideration:** Claude Agent SDK provides per-message token counts. OpenCode `session stats` provides aggregate counts. Ductum needs to normalize these into a consistent cost model across harnesses.

## Q5: Multi-repo task coordination

**Question:** Some tasks span multiple repos (P4-SDK-CORE-TYPES touches edictum, edictum-ts, edictum-go). How does Ductum model this?

**Options:**
- One task, multiple PRs tracked within the run
- Split into sub-tasks automatically (P4-python, P4-ts, P4-go)
- Task defines a list of repos, run tracks per-repo status

**Current answer:** model the repo/subdir/package as a `Target`. Multi-repo
work starts as a fan-out `Spec` that emits target-scoped `Task`s. Do not add
top-level `Operation` or `WorkOrder` tables until this simpler model breaks.
See decisions `053` and `057`.

## Q6: Crash recovery semantics

**Question:** When an agent session crashes, what does recovery look like?

**Current thinking:** Run has a heartbeat timeout. If heartbeat stops, run is marked `stalled`. A new agent session can call `ductum.get_context(task_id)` to get full state and resume. The harness adapter handles the mechanics of spawning a new session.

What state is "enough" for recovery: last git commit on the branch + last completed stage + evidence attached so far. The new agent reads the branch state and continues from where the previous session left off.

## Q7: Ductum repo location

**Question:** Currently at `acartag7/ductum`. Should it move to `edictum-ai/ductum`?

## Q8: Watcher authority and trust (REVISED Round 2)

**Question:** Who can attach evidence to a run, who can trigger resets, and how are conflicting signals reconciled?

**Sub-questions:**
- Can a watcher (child run) trigger a reset on its parent run, or only inject evidence and let Ductum Core decide?
- What happens when CI says "pass" and the review bot says "fail" simultaneously? Both are parallel latches — the failing one triggers reset regardless of the passing one.
- How are duplicate signals handled (two CI results for the same commit)? Last-write-wins? First-write-wins? Deduplicate by commit SHA?
- How are out-of-order signals handled (review arrives before CI)? Each latch resolves independently. Merge gate only evaluates when both have resolved.
- Who owns reset authority? Ductum Core owns reset. Watchers and reviewers inject evidence. Ductum Core evaluates evidence against gate rules and triggers reset if needed. Agents never self-reset.

## Q9: OpenCode session-scoped enforcement (REVISED Round 2)

**Question:** How does a single long-lived `opencode serve` process enforce different policies for concurrent runs?

**Answer (D15, updated by D22):** The plugin is stateless. Policy decisions
delegate to Ductum Core through session-bound calls. Agent-visible tools do not
accept `run_id`; Ductum resolves session identity against the correct run's
workflow.

**Remaining sub-question:** What happens if the plugin crashes or fails to load? Ductum Core detects missing heartbeats from the run and kills the OpenCode session. But there’s a window between plugin crash and heartbeat timeout where the agent runs unmonitored. Mitigation: short heartbeat interval (10s), and OpenCode’s own error handling may terminate the session on plugin failure.
