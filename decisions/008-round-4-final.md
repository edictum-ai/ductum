# Phase 6 Adversarial Review — Round 4 (Final)

**Reviewer:** Codex (GPT-5.4)
**Date:** 2026-04-04
**Scope:** specs/impl-001/ at d839213
**Verdict:** No structural findings remaining. Spec is ready to build.

---

## Assessment

- F12-F17 are closed in the current spec and prompt set.
- The last remaining OpenCode probe gap is closed: the pseudocode now explicitly sends a synthetic tool call through the OpenCode session, then checks Ductum Core for probe attestation.
- The implementation plan matches the current architecture closely enough to start work.

## Verified fixes

- **OpenCode plugin-health probe:** [specs/impl-001/P8-HARNESS-OPENCODE.md](/Users/acartagena/project/ductum/specs/impl-001/P8-HARNESS-OPENCODE.md#L163) now shows the full two-step flow:
  1. submit `__ductum_health_probe__` through the OpenCode session REST API
  2. check [specs/impl-001/P4-REST-API.md](/Users/acartagena/project/ductum/specs/impl-001/P4-REST-API.md#L151) for probe attestation

- **Dispatcher-owned session mapping:** [specs/impl-001/P7-HARNESS-CLAUDE.md](/Users/acartagena/project/ductum/specs/impl-001/P7-HARNESS-CLAUDE.md#L71) and [specs/impl-001/P8-HARNESS-OPENCODE.md](/Users/acartagena/project/ductum/specs/impl-001/P8-HARNESS-OPENCODE.md#L106) both reflect that adapters no longer own `session_run_mapping`; the dispatcher does.

- **Stale spec text removed:** [specs/impl-001/spec.md](/Users/acartagena/project/ductum/specs/impl-001/spec.md#L1200) now describes the probe-based plugin-failure detection correctly.

## Residual implementation risks

- Claude Agent SDK tool-call interception still needs verification against the real SDK API during implementation. The spec treats this as open work in [specs/impl-001/spec.md](/Users/acartagena/project/ductum/specs/impl-001/spec.md#L1199).
- OpenCode plugin crash resilience remains an implementation concern, but it is now called out explicitly and the primary mitigation path is defined in [specs/impl-001/spec.md](/Users/acartagena/project/ductum/specs/impl-001/spec.md#L1200).

---

## Status

Round 4 complete. 6 review findings from [007-round-4-review.md](/Users/acartagena/project/ductum/decisions/007-round-4-review.md) are closed. 27 decisions remain in force. Implementation spec is clear enough to proceed.
