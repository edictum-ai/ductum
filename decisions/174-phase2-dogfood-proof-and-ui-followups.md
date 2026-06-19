# D174 - Phase 2 dogfood proof and UI follow-ups

**Date:** 2026-06-19
**Status:** accepted
**Linked:** D173, D156, `design/ROADMAP.md` Phase 2 / Phase 3

## Context

Phase 2 was verified with a copied local factory from the previous dogfood
factory, not with pushed state. The proof factory lived at
`/tmp/ductum-phase2-dogfood-proof/factory`, with the API started on
`http://127.0.0.1:4112` and explicit loopback token auto-detect enabled for the
dashboard.

## Proof recorded

The recovery dogfood path succeeded:

- A live `opus` attempt reached `implement`.
- The API process was killed during that live run.
- After the lease expired, startup reconciliation reported:
  `startup reconcile: scanned=1 live=0 resumable=1 resumed=1 deadClaim=0 stalled=0 noMapping=0 errors=0`.
- The crashed run was `9BOAOhWIL8ck`.
- The resumed run was `ByPOtml-D-et`.
- The original worktree kept the committed proof change:
  `proof.txt` contained `phase2 recovery proof`, committed as
  `6d1dcbc test: add phase2 recovery proof`.
- The recovery evidence on `9BOAOhWIL8ck` recorded
  `disposition:"resumable"`, `action:"resume-from-checkpoint"`,
  `checkpointStage:"implement"`, and `resumedRunId:"ByPOtml-D-et"`.

This is enough to treat the checkpoint/resume path as proven by a live crash
flow.

## Proof not completed

The deterministic quarantine dogfood path was not proven live in this run. The
available failures were provider/model access, heartbeat timeout, or local MCP
auth failures, and the Phase 2 classifier intentionally treats those as
recoverable or transient. No deterministic non-recoverable live failure fixture
was available without adding a new harness test hook.

Phase 2's quarantine implementation remains covered by tests, but the live
dogfood proof should be run later with a proper deterministic poison fixture.

## Follow-ups found during proof

1. **Dashboard token UX is bad for local dogfood.** D156 correctly keeps
   `/api/internal/operator-token-detect` behind explicit local opt-in, but the
   normal dashboard path still asks the operator to find and paste a hidden token.
   Phase 3 should make local dashboard access feel like `ductum start --open`:
   a short-lived browser handoff or loopback-only session should authenticate the
   launched browser without exposing the long-lived operator token as a normal
   UI task. Remote/protected deployments still need explicit auth.

2. **Codex HTTP MCP auth failed against the protected local API.** The run logs
   showed MCP calls returning `Operator token required` / HTTP 401. The likely
   cause is that the scoped worker environment did not include the operator token
   used by `codex-mcp-config.ts` to build the MCP URL. The fix should not blindly
   leak the operator token into agent env; prefer a scoped per-run control token
   path for `/api/mcp/:runId`.

3. **Resume selected an inaccessible agent.** The crashed run used `opus`, but
   the resumed run used `glm` and immediately stalled because `glm-5.2` was not
   available in this factory. Resume should preserve the crashed run's runtime
   agent identity or otherwise prove the replacement is available before claiming
   a resumed path.

4. **API kill can leave child harness processes behind.** The proof used a hard
   kill to simulate a crash; any child process survival should be handled by the
   recovery/cleanup model and made visible to operators.

5. **Run-list API ergonomics are easy to misuse.** `/api/runs?taskId=...` did
   not behave like the task-scoped run list used by the dashboard; the correct
   route is `/api/tasks/:taskId/runs`. That may be by design, but it is a small
   operator/API footgun.

## Consequence

Move to Phase 3 with these follow-ups explicit. The token UX item belongs in
Phase 3 because the Phase 3 goal is operator-surface legibility and parity, not
runtime recovery semantics. The resume-agent identity issue is a Phase 2
recovery hardening follow-up and should be fixed before relying on cross-agent
resume in production dogfood.
