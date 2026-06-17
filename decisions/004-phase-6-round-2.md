# Phase 6 Adversarial Review — Round 2

**Reviewer:** Codex (GPT-5.4)
**Date:** 2026-04-04
**Scope:** Rewritten ARCHITECTURE.md, VISION.md, OPEN-QUESTIONS.md + new HARNESS.md
**Prior round:** decisions/002-phase-6-adversarial-review.md (Round 1: 7 findings, all accepted)

---

## Verdict

The rewrite is much better. F1/F2 are fixed. F3 and F4 are improved, but not fully closed.

---

## Findings

### F8 — High: OpenCode harness has an isolation hole

HARNESS.md is now pointed at the right mechanism, and the Claude path is real, but the OpenCode path still has an isolation hole. HARNESS.md:73 assumes Ductum can create a session and inject a plugin per run over REST. The official OpenCode docs show plugins loading from config/plugin dirs at startup, while the server API documents dynamic MCP add, not dynamic plugin add. So the remaining gap is not "can OpenCode block tools?" It can. The gap is "how does Ductum get per-run policy/plugin isolation on a warm shared opencode serve?"

### F9 — High: Open questions are close but not the right set

Q1/Q8/Q9 are close, but not quite right. Q1 is better than the old skills question, but the Claude sub-question is already basically answered by the SDK docs, and half of Q9 is too. The harder unresolved question is the harness contract: what exact guarantees must a supported harness provide, what bypasses remain, and when do you declare a harness unsupported? Q8 asks the wrong thing first — poll vs webhook is secondary. The real question is authority and trust: who can attach evidence, who can trigger resets, and how duplicate/out-of-order signals are reconciled. Q9 should be reframed from "what does an OpenCode plugin look like?" to "how do session-scoped enforcement and isolation work in opencode serve?"

### F10 — High: F4 only partially solved — state machine still misses pre-push review and parallel CI/review

The new Run model adds waits, resets, watchers, and async signals, which is the right direction. But the actual state machine still does not match the PROCESS.md loop. PROCESS.md has:
1. Local review before push
2. CI and remote review in parallel after push
3. Next-task prep while waiting

The current state machine is still one lane: implement → push → wait for CI → wait for review → merge. That misses the pre-push review gate and serializes CI/review instead of modeling them as independent latches.

### F11 — Medium: "fixing" sub-state is listed but never used in the state machine

`fixing` is listed as a real Run sub-state in VISION.md but the state machine resets back to `implementing` and never uses `fixing`. This leaves the most important loop underspecified: when review/CI fails, are you back in full implementation, or in a narrower remediation mode with different allowed actions and evidence requirements?

---

## Direct answers from Codex

- **Does HARNESS.md solve F3?** Mostly for the Claude path, not fully for the OpenCode path. It now targets structural enforcement, not advisory prompts. The remaining gap is OpenCode plugin lifecycle/isolation with the hot-server model.
- **Are Q1/Q8/Q9 the right questions?** Q1 is mostly right but partly stale. Q8 is aimed too low. Q9 is the wrong layer. The real blockers are harness contract, isolation, and watcher authority.
- **Does the Run state machine cover F4?** Not yet. It covers reset/wait/watchers, but still misses pre-push review and parallel CI/review.

---

## Sources cited by Codex

- Anthropic Agent SDK reference: https://platform.claude.com/docs/en/agent-sdk/typescript
- OpenCode plugins: https://opencode.ai/docs/plugins/
- OpenCode server: https://opencode.ai/docs/server/
