# D175 - Deterministic quarantine proof fixture

**Date:** 2026-06-19
**Status:** accepted
**Linked:** D173, D174, `design/ROADMAP.md` Phase 2

## Context

D174 recorded that Phase 2's live crash/recovery proof succeeded, but the
deterministic quarantine dogfood path was still unproven because available live
failures were provider, auth, heartbeat, or MCP failures. The classifier
intentionally treats those as transient/recoverable, so proving quarantine
needed a stable non-recoverable poison fixture.

## Decision

Add a deterministic poison fixture to the existing mock-agent harness path only.
When the factory is started with `DUCTUM_MOCK_AGENT_CALLS=1`, the mock harness
recognizes a prompt line beginning with `DUCTUM_MOCK_POISON:` and returns a
`crashed` session result with that exact `failReason`. This feeds the existing
crash retry/quarantine path; it does not add a production harness behavior and
does not bypass the classifier.

Package an importable sample spec at
`packages/ductum/assets/specs/examples/deterministic-poison` so future dogfood
runs can prove quarantine through the normal `ductum spec import` and
`ductum attempt start` operator flow.

Also pass the explicit `DUCTUM_MOCK_AGENT_CALLS=1` and
`DUCTUM_MOCK_AGENT_DELAY_MS` environment variables through `ductum start`.
Before this fix, the API supported mock-agent calls but the CLI start wrapper
stripped the env var, so a local proof server silently loaded real harnesses.

## Proof

Live proof was run against a fresh local proof factory:

- Factory dir:
  `/tmp/ductum-phase2-quarantine-proof.KXQvFY/factory/factory`
- API/UI:
  `http://127.0.0.1:4114`
- Startup log showed all built-in harnesses loaded with `(mock agent calls)`.
- Imported spec:
  `deterministic-poison` (`v13aIB1KEG_K`)
- Task:
  `P1-DETERMINISTIC-POISON` (`DfXWwdPFHp29`)
- Attempts `tTnO7y`, `KsJgSt`, and `Nz9GJa` stalled on the same poison reason.
- Fourth attempt `NhVNaWtgaIwj` finished as `Quarantined`.
- `ductum status` showed `READY TASKS 0`, `PAST STALLS 3`,
  `NEEDS ATTENTION 1`.
- Needs Attention reason:
  `deterministic poison: quarantine fixture invariant failed`.
- `ductum logs NhVNaWtgaIwj --limit 80` showed:
  `Mock deterministic poison: deterministic poison: quarantine fixture invariant failed`.
- `git status --short` in the proof factory repo returned no output.

## Boundaries

- The marker is not a production prompt contract.
- The fixture must stay behind `DUCTUM_MOCK_AGENT_CALLS=1`.
- The proof does not claim provider failures, MCP auth failures, or heartbeat
  stalls are poison. Those remain transient/recoverable by design.
