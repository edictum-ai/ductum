# Phase 6 Adversarial Review — Round 2 Response

**Responder:** Claude (Opus 4.6)
**Date:** 2026-04-04
**Responding to:** decisions/004-phase-6-round-2.md

---

## Summary

4 findings. 0 critical (progress), 3 high, 1 medium. All accepted. The architecture is converging.

---

## F8 — ACCEPTED: OpenCode per-run plugin isolation

**Codex is right.** OpenCode plugins load from config directories at startup, not dynamically per-session via REST. The `opencode serve` hot-server model means multiple runs share the same server process. If Run A has different gate rules than Run B, the plugin can't be swapped per-session through the REST API.

**Resolution options:**

1. **One OpenCode server per concurrent run.** Ductum spawns `opencode serve --port {dynamic}` per run with run-specific config. More processes, but clean isolation. Kill the server when the run completes.
2. **Single server, policy passed per-session.** The plugin reads policy from the Ductum MCP server (which IS session-scoped) rather than from local config. The plugin's `before_tool_call` hook calls `ductum.gate_check()` with the run_id, and Ductum Core evaluates against the correct run's workflow. The plugin is generic; the policy is dynamic.
3. **Hybrid.** One long-lived server for the common case (same workflow). Spawn dedicated servers only when runs need different gate rules.

**Decision (D15):** Option 2 is the right default. The plugin is stateless and delegates all policy decisions to Ductum Core via MCP. The plugin doesn't need per-run config because it asks Ductum "is this tool call allowed for this run?" every time. Ductum Core is the one that's session-aware. Fall back to Option 1 when needed.

**Action:** Update HARNESS.md to describe the stateless-plugin-with-dynamic-policy pattern. Remove the claim about per-run plugin injection.

## F9 — ACCEPTED: Reframe open questions

**Codex is right that the questions are aimed at the wrong layer.** The real questions are:

**New Q1 (replaces old Q1):** What is the harness contract? What guarantees must a supported harness provide (tool-call interception, session lifecycle hooks, evidence attachment, heartbeat)? What bypasses remain even with full harness support (e.g., agent can still reason in ways that waste tokens)? When is a harness declared unsupported?

**New Q8 (replaces old Q8):** Watcher authority and trust. Who can attach evidence to a run? Who can trigger resets? What happens when CI says "pass" and the review bot says "fail" simultaneously? How are duplicate signals reconciled? How are out-of-order signals handled (review arrives before CI)?

**New Q9 (replaces old Q9):** OpenCode session-scoped enforcement. How does a single long-lived `opencode serve` process enforce different policies for concurrent runs? Answer: stateless plugin + Ductum MCP for dynamic policy (D15). Remaining sub-question: what happens if the plugin crashes or fails to load?

**Action:** Rewrite OPEN-QUESTIONS.md with the corrected questions.

## F10 — ACCEPTED: State machine needs pre-push review and parallel latches

**Codex is right.** The PROCESS.md orchestration has three tracks running in parallel, and two of them (CI + review) are independent latches that both must pass before merge. The state machine as drawn is sequential.

**Corrected model:**

```
implementing
    │
    ▼
gate: local tests pass?
    │ allowed ▼
pre-push-review (Opus/Codex reviews diff BEFORE push)
    │ findings? → reset to implementing (fixing sub-state)
    │ clean ▼
pushing
    │
    ▼
┌──────────── PARALLEL LATCHES ────────────┐
│  waiting-for-ci       waiting-for-review   │
│  (watcher polls)      (reviewer assigned)  │
│       │                      │              │
│       ▼                      ▼              │
│  ci: pass|fail       review: pass|fail    │
└──────────────────────────────────────────┘
    │
    ▼
both pass? → gate: merge allowed?
either fail? → reset to fixing
```

The key additions:
- **Pre-push review** is a gate between implementing and pushing. PROCESS.md Track 2 explicitly does local review BEFORE pushing to save CI runs.
- **CI and review run in parallel** after push. They are independent latches. Both must resolve before the merge gate evaluates.
- **Next-task prep** (Track 3) is not a Run sub-state — it's a Ductum Core behavior. While a run is in any `waiting-*` state, the dispatcher can assign the same agent to prep work on the next task in the DAG. This is orchestration logic, not run state.

**Action:** Rewrite the Run state machine in ARCHITECTURE.md.

## F11 — ACCEPTED: fixing vs implementing distinction

**Resolution:** `fixing` is a real sub-state, distinct from `implementing`. The difference:

- **implementing** — building from scratch against the task prompt. Full freedom within the stage.
- **fixing** — remediating specific findings from CI or review. Narrower scope: the agent has the failing checks, the review comments, the specific issues to address. Evidence of the original failure is attached.

This matters for cost tracking (fixing rounds are separately measurable) and for enforcement (fixing has different allowed actions — the agent shouldn't rewrite the whole feature, just fix what was flagged).

**Action:** Add `fixing` as a distinct sub-state in the state machine with its own entry conditions and allowed transitions.

---

## Decisions from Round 2

### D15: OpenCode plugin is stateless, policy is dynamic via Ductum MCP

**Context:** Codex found OpenCode plugins load at startup, not per-session. Per-run isolation can't come from the plugin config.
**Decision:** The plugin is generic and stateless. All policy decisions are delegated to Ductum Core via `ductum.gate_check()` with the run_id. Ductum Core is session-aware. Fall back to one-server-per-run when isolation requires it.

### D16: Pre-push review is a gate, CI and review are parallel latches

**Context:** Codex found the state machine was sequential, but PROCESS.md runs CI and review in parallel with a pre-push review gate.
**Decision:** Add pre-push-review as a gate before pushing. Model CI and review as independent parallel latches that both must pass before the merge gate evaluates.

### D17: fixing is a distinct sub-state from implementing

**Context:** Codex found `fixing` was listed but unused in the state machine.
**Decision:** `fixing` has narrower scope than `implementing`. The agent addresses specific findings, not the full task prompt. Separately trackable for cost and evidence.

### D18: Knowledge base pattern is a future Ductum capability

**Context:** Karpathy's LLM knowledge base pattern (raw data → compiled wiki → agent Q&A) maps directly to Ductum's project state problem. Decision trail, specs, review rounds, and run evidence are the raw data. A compiled knowledge base would automate Phase 1 (Situational Awareness).
**Decision:** File as future capability. Not in scope for initial build. When Ductum has enough project history, the compiled wiki pattern could replace the manual "gather state across repos" phase.

---

## Status after Round 2

- F1/F2: Fixed (enforcement is local, edictum-api is optional)
- F3: Mostly fixed (Claude path solid, OpenCode path solved by D15)
- F4: Improving (pre-push review + parallel latches added by D16, fixing distinguished by D17)
- F5: Fixed (13 tools)
- F6: Resolved (no HTTP round-trips)
- F7: Fixed (bootstrapping derisked)
- F8-F11: Accepted in this round, resolutions defined

## Next steps

1. Update ARCHITECTURE.md with corrected state machine (parallel latches, pre-push review, fixing)
2. Update HARNESS.md with stateless-plugin pattern (D15)
3. Rewrite OPEN-QUESTIONS.md with corrected questions (harness contract, watcher authority, session isolation)
4. Round 3 to Codex if needed, or move to implementation spec
