# Phase 6 Adversarial Review — Round 1

**Reviewer:** Codex (GPT-5.4)
**Date:** 2026-04-04
**Scope:** VISION.md, ARCHITECTURE.md, CONTEXT.md, OPEN-QUESTIONS.md, decisions/001-founding-session.md
**Method:** Read founding docs + actual source code in edictum, edictum-ts, edictum-go, edictum-api, edictum-harness

---

## Verdict

No. In its current form Ductum mostly solves persistence and visibility, then hand-waves the hard parts into a backend and harness layer that do not exist yet.

---

## Findings

### F1 — Critical: edictum-api is not the enforcement backend Ductum says it is

Ductum claims the Go API already does rule evaluation, workflow gate evaluation, and audit ingestion, and that Ductum only delegates to it. The actual API exposes ruleset storage, events, approvals, sessions, and streams, but no rule-evaluation endpoint, no gate-evaluation endpoint, and no workflow-state endpoint. Event ingestion also just appends and publishes; it does not upsert any workflow snapshot.

**Sources:** ARCHITECTURE.md:28, OPEN-QUESTIONS.md:33, edictum-api/transport/router.go:43, edictum-api/internal/rules/service.go:24, edictum-api/internal/decisions/service.go:25

### F2 — Critical: Real enforcement runs inside the SDKs, locally, in-process

Python explicitly says server-backed rules are remote but workflow loading stays local. TypeScript and Go both fetch rulesets from the server, compile them locally, and run approvals/workflow logic inside the local runner. That means the current Edictum architecture is "local enforcement + remote audit/approval/session storage," not "remote enforcement backend."

**Sources:** edictum/_guard.py:545, edictum/_server_factory.py:135, edictum-ts/packages/server/src/factory.ts:174, edictum-ts/packages/core/src/runner.ts:161, edictum-go/guard/server_factory.go:16, edictum-go/guard/run.go:42

### F3 — Critical: Q1 (skills/plugins) is not a formatting question

If Ductum relies on SKILL.md, AGENTS.md, tool descriptions, or prompt injection to make agents call ductum.accept(), ductum.gate_check(), and ductum.complete(), it recreates the exact advisory-instruction failure Ductum exists to kill. The 8-tool surface is voluntary unless a harness wrapper or managed launcher makes it non-optional.

**Sources:** OPEN-QUESTIONS.md:7, ARCHITECTURE.md:51

### F4 — High: Ductum does not actually cover the orchestration loops from PROCESS.md

The harness process requires CI watchers, local review before push, next-task prep while waiting, and explicit child resets on review/CI failure. The Ductum model has tasks, runs, and gate_check, but no first-class watcher/reviewer runs, no wait state, no reset/handoff path, and no model for external signals arriving asynchronously.

**Sources:** edictum-harness/PROCESS.md:123, edictum-harness/specs/m1/016-guarded-worker-lane.md:215, 016-guarded-worker-lane.md:297

### F5 — High: The 8 MCP tools are not enough

They cover happy-path claim/progress/complete, but not fail/block/wait, structured evidence attachment, review/CI result ingestion, run reset/handoff, or branch/commit/check linkage. Spec 016 explicitly needs review transport and read-only CI inspection paths, and the current surface has nowhere clean to put that state except free-text update() messages.

**Sources:** ARCHITECTURE.md:51, edictum-harness/specs/m1/016-guarded-worker-lane.md:215, 016-guarded-worker-lane.md:260

### F6 — High: The TS → Go enforcement split only works if gate_check is coarse

If gate_check is just a stage-transition check, the latency is probably fine, but enforcement is weak because the agent can still do a lot inside the stage unless something else governs the actual tools. If you try to make the Go backend authoritative for real inner-loop tool gating, the round-trips will be too expensive and too brittle, which is exactly why the SDKs currently evaluate locally.

**Sources:** ARCHITECTURE.md:72, edictum-ts/packages/core/src/runner.ts:203, edictum-go/guard/run.go:123

### F7 — High: The bootstrapping risk is real

Spec 017 is still a draft whose own problem statement says the API is not workflow-aware, the app does not exist, the parent-child path is spec-only, and server clients are stale. No hero demo path, no coding-guard workflow, and no local edictum-app checkout. Ductum cannot honestly claim to be "built on finished Edictum remote enforcement" yet.

**Sources:** edictum-harness/specs/m1/017-end-to-end-demo-path.md:10, 017-end-to-end-demo-path.md:225

---

## Verification

`go test ./...` passes in edictum-api. That means the current tree is coherent, not that it satisfies the backend role Ductum assigns to it.
