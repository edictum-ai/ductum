# Phase 6 Adversarial Review — Round 3 (Final)

**Reviewer:** Codex (GPT-5.4)
**Date:** 2026-04-04
**Scope:** All docs at 7221cbb
**Verdict:** Solid enough for implementation spec.

---

## Assessment

- F3: basically closed. Enforcement is in the harness, not in prompt discipline.
- F4: basically closed. State machine covers pre-push review, parallel CI/review latches, fixing, watchers, next-task prep.
- Q1/Q8/Q9: now the right questions, aimed at real control-plane risks.

## Corrections to bake into the implementation spec

### C1 — High: Split inner-loop tool authorization from outer-loop stage transition

HARNESS.md:75 shows the plugin calling `ductum.gate_check(run_id)` on each tool call, but ARCHITECTURE.md:144 defines `ductum.gate_check(run_id, target_stage)` as a stage-transition request. These are different operations.

**Fix:** The spec must define two distinct paths:
- `authorize_tool(run_id, tool, args)` — internal harness-side call, every intercepted tool call, not agent-visible
- `gate_check(run_id, target_stage)` — agent-visible, stage advancement request

### C2 — High: Reset authority must be Ductum Core only

ARCHITECTURE.md:146 says `ductum.reset` is called by "Agent or Ductum", but VISION.md:139 and OPEN-QUESTIONS.md:82 say Ductum Core owns reset. Agents/watchers only attach evidence.

**Fix:** Agents do not self-reset. `ductum.reset()` is removed from the agent-visible MCP surface. Ductum Core evaluates evidence and performs resets. The MCP tool `ductum.fail(run_id, reason, recoverable?)` remains — agents report failure, Ductum Core decides whether to reset or terminate.

### C3 — Medium: Session-to-run binding needs a real mapping

HARNESS.md:101 injects run_id in prompt text. That's not authoritative enough — the enforcement key can't live only in prompt.

**Fix:** Ductum Core maintains an authoritative `opencode_session_id → ductum_run_id` mapping. When creating an OpenCode session, Ductum Core records the session ID. The plugin passes the OpenCode session identity to Ductum Core, which resolves it to the correct run_id. No run_id in prompt text.

---

## Decisions

### D19: authorize_tool is internal, gate_check is agent-visible

**Context:** Codex found inner-loop tool authorization conflated with outer-loop stage transition.
**Decision:** Two distinct paths. authorize_tool is harness-internal (every tool call). gate_check is agent-visible (stage advancement). Implementation spec defines both.

### D20: Agents do not self-reset

**Context:** Codex found inconsistent reset authority across docs.
**Decision:** Ductum Core owns all resets. ductum.reset removed from agent MCP surface. Agents report failure/evidence; Ductum Core decides. MCP surface goes from 13 to 12 agent-visible tools (reset becomes internal).

### D21: Authoritative session-to-run mapping

**Context:** Codex found run_id binding was only in prompt text.
**Decision:** Ductum Core maintains opencode_session_id → ductum_run_id mapping. Plugin passes session identity; Ductum Core resolves. No run_id in prompt.

---

## Status

Design phase complete. 3 rounds of adversarial review. 11 original findings + 3 corrections. 21 decisions (D1-D21). All findings addressed. Architecture is solid enough for implementation spec.
