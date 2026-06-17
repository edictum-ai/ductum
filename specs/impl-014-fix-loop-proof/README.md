# impl-014: Fix Loop Proof

**Spec:** `specs/impl-014-fix-loop-proof/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-CSV.md](P1-CSV.md) | Add `parseCsvRow(line)` helper | — |

A single under-specified task used to drive the impl → review FAIL →
fix → re-review → ship loop on a real factory dispatch with cheap
GLM agents. Round 1 prompt deliberately omits quoted-field handling,
so the round-1 reviewer is likely to flag missing edge cases and
the round-2 fix completes them.
