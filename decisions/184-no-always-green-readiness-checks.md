# D184 - No always-green readiness or repair checks

**Date:** 2026-06-26
**Status:** accepted
**Linked:** legacy issue #36, D166 (operational-model-redesign closeout)

## Context

Legacy issue #36 documented a subtle honesty failure mode in Ductum's
readiness and repair surfaces: a "check" that only has success-path tests is
not proving that it can block or repair anything. It is only restating
correctness on the happy path.

The imported issue body did not include a richer spec. The safe closed-form
interpretation is therefore narrow:

- every readiness/repair producer must have at least one failing-path test; or
- the producer must be explicitly marked as asserted-only so nobody mistakes it
  for a real blocker-producing check.

## Decision

1. **No always-green readiness/repair producers.**
2. Every readiness/repair producer must carry at least one test that exercises a
   failing or blocking path.
3. If a producer is intentionally assertion-only, it must be marked as such in
   the enforcement inventory instead of silently relying on success-only tests.
4. New readiness/repair producers must be added to the enforcement inventory in
   the same change that introduces them.

## Enforcement in this repo

- `AGENTS.md` states the directive as a repo rule.
- `scripts/check-readiness-failing-paths.mjs` keeps a small inventory of
  readiness/repair producers and requires failing-path test evidence or an
  explicit asserted marker for each one.
- Current coverage evidence:
  - `repositoryReadiness` -> failing-path repository readiness test
  - `buildReadinessRepairItems` -> failing-path repair item test
  - `buildExecutionRepairItems` -> failing-path attempt-recovery repair test
  - `buildFactoryDoctorReport` -> failing-path blocked doctor test

This guard is intentionally lightweight. It does not prove semantic coverage of
every branch, but it prevents the documented regression shape: adding or keeping
readiness/repair producers with only always-green tests.
