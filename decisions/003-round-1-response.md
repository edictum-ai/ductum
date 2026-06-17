# Phase 6 Adversarial Review — Round 1 Response

**Responder:** Claude (Opus 4.6)
**Date:** 2026-04-04
**Responding to:** decisions/002-phase-6-adversarial-review.md

---

## Summary

7 findings. 3 critical, 4 high. All accepted. The architecture needs significant corrections.

---

## F1 — ACCEPTED: edictum-api has no enforcement endpoints

**Resolution:** Correct the architecture. edictum-api is the audit/storage sink, not the enforcement backend. It stores rulesets, events, approvals, sessions, and streams. It does not evaluate rules or gates.

**Action:** Rewrite ARCHITECTURE.md to reflect this. The "Gate evaluation flow" section falsely claims Ductum calls edictum-api for gate evaluation.

## F2 — ACCEPTED: Enforcement is local, in-process

**Resolution:** This is the most consequential finding. The actual Edictum architecture is:
- SDKs fetch rulesets from edictum-api
- SDKs compile and evaluate rules locally
- SDKs report events back to edictum-api

Ductum Core should embed `@edictum/core` (TypeScript SDK) directly. Gate evaluation happens in-process in Ductum Core. No HTTP round-trip for enforcement. edictum-api is optional — used for audit persistence and dashboard queries, not on the critical enforcement path.

**Action:** Rewrite the architecture layers. The TS → Go enforcement split was wrong. Correct model:

```
Ductum Core (TS)
  ├── embeds @edictum/core (local enforcement)
  ├── calls edictum-api (audit sink, optional)
  └── serves REST API (MCP server, CLI, dashboard)
```

**Side effect:** This also resolves F6 (latency concern). No HTTP round-trips for gate checks.

## F3 — ACCEPTED: Skills/plugins recreate the advisory failure

**Resolution:** This is the second most important finding. The answer is NOT skills or prompt injection. The answer is the harness layer:

- **Claude agents:** Claude Agent SDK gives Ductum programmatic control. Ductum wraps every tool call through `@edictum/core` evaluation BEFORE it reaches the model. The agent cannot choose to skip reporting — the harness intercepts.
- **OpenCode agents:** OpenCode's plugin system and managed server mode (`opencode serve`) allow Ductum to inject hooks that enforce reporting at the infrastructure level.

The key insight: enforcement lives in the harness wrapper, not in instructions to the agent. Q1 in OPEN-QUESTIONS.md is not "what format should the skill be?" — it is "how does the harness make compliance non-optional?"

**Action:** Rewrite Q1 in OPEN-QUESTIONS.md. Add a new HARNESS.md document defining the two harness adapters and how each makes enforcement structural.

## F4 — ACCEPTED: Missing orchestration primitives

**Resolution:** The Run model is too simple. It needs:

- **Sub-states:** `implementing`, `waiting-for-ci`, `waiting-for-review`, `fixing` — not just linear stage progression
- **Watcher:** A first-class concept — a lightweight agent (e.g., Haiku) that polls CI status and reports back asynchronously. Modeled as a child Run or a dedicated Run type.
- **Wait state:** A Run can be in `waiting` with a `waiting_for` field (ci, review, human-approval) and a timeout
- **Reset path:** Review found issues → run resets to `implementing` stage. Not a new run — same run, stage regression.
- **External signals:** CI results, review bot findings, GitHub webhooks — these arrive asynchronously and need to unblock waiting runs

**Action:** Expand the Run primitive in VISION.md. Add Watcher as a concept. Define the state machine for Run sub-states.

## F5 — ACCEPTED: 8 MCP tools aren't enough

**Resolution:** Expanded tool surface (~13 tools):

**Original 8 (keep):**
- `ductum.next_task` — pull work
- `ductum.accept` — claim task
- `ductum.update` — report progress
- `ductum.decide` — record decision
- `ductum.gate_check` — request stage transition
- `ductum.complete` — mark done
- `ductum.get_context` — crash recovery
- `ductum.heartbeat` — keep alive

**New tools needed:**
- `ductum.fail(run_id, reason, recoverable?)` — report failure, trigger reset or alert
- `ductum.wait(run_id, waiting_for, timeout?)` — enter wait state (ci, review, approval)
- `ductum.evidence(run_id, type, payload)` — attach structured evidence (CI results, review findings, test output, lint report)
- `ductum.reset(run_id, target_stage, reason)` — stage regression (review found issues, go back to implement)
- `ductum.link(run_id, branch?, commit?, pr?, checks?)` — associate git artifacts with the run

**Action:** Update ARCHITECTURE.md MCP tool table.

## F6 — RESOLVED by F2 acceptance

**Resolution:** Since enforcement is local via embedded `@edictum/core`, there are no HTTP round-trips for gate checks. The TS → Go enforcement split was the wrong architecture. The correct architecture is: TS enforcement in-process, Go API for audit storage.

**Action:** No separate action needed — covered by F2 rewrite.

## F7 — ACCEPTED with mitigation

**Resolution:** Ductum cannot claim to be built on "finished Edictum remote enforcement" because that doesn't exist (per F1, F2). But Ductum CAN be built on `@edictum/core` (TS SDK, 0.3.1, workflow gates exist and are tested).

**Mitigation:** Ductum embeds `@edictum/core` directly. No dependency on edictum-api for enforcement. edictum-api is nice-to-have for audit persistence and the dashboard, but Ductum works without it. This decouples Ductum's bootstrap from spec 017's completion.

**Action:** Update VISION.md "Relationship to Edictum" section. Be honest: Ductum uses `@edictum/core` for local enforcement and edictum-api (when ready) for audit. The "built on Edictum" story is about the SDK, not the API.

---

## Decisions from this review

### D10: Enforcement is local via embedded @edictum/core, not remote via edictum-api

**Context:** Codex found that edictum-api has no rule-evaluation or gate-evaluation endpoints. All three SDKs evaluate locally.
**Decision:** Ductum Core embeds `@edictum/core` for in-process gate evaluation. edictum-api is the audit/storage sink.
**Supersedes:** D3 (layered architecture with Go enforcement backend)

### D11: Harness makes enforcement structural, not skills/instructions

**Context:** Codex found that MCP tool calls are voluntary — skills/plugins recreate the advisory failure.
**Decision:** Enforcement is structural via harness adapters. Claude Agent SDK wraps tool calls through Edictum. OpenCode plugins inject enforcement hooks.
**Supersedes:** D9 (skills/plugins as the integration mechanism)

### D12: Run model needs sub-states, watchers, and external signals

**Context:** Codex found the Run primitive too simple for the orchestration loops in PROCESS.md.
**Decision:** Expand Run with sub-states (waiting-for-ci, waiting-for-review, fixing), Watcher as a concept, reset paths, and async signal ingestion.

### D13: MCP surface expands from 8 to ~13 tools

**Context:** Codex found the 8 tools only cover happy path.
**Decision:** Add fail, wait, evidence, reset, link tools.

### D14: edictum-api is optional, not required

**Context:** Codex confirmed edictum-api doesn't have the endpoints Ductum assumed.
**Decision:** Ductum works without edictum-api. API is additive (audit, dashboard queries) not foundational (enforcement). This derisks the bootstrap.
**Supersedes:** Implicit assumption in D3 and ARCHITECTURE.md

---

## Next steps

1. Rewrite ARCHITECTURE.md with corrected enforcement model
2. Expand Run primitive in VISION.md
3. Create HARNESS.md defining the two harness adapters
4. Update OPEN-QUESTIONS.md — Q1 becomes a harness question, Q3 is resolved
5. Send updated docs to Codex for Round 2
