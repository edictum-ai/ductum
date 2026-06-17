# impl-013: Loop Proof

**Spec:** `specs/impl-013-loop-proof/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-PAD.md](P1-PAD.md) | Add `padLeft` and `padRight` helpers | — |
| 2 | [P2-CLAMP.md](P2-CLAMP.md) | Add `clampNumber` helper | — |

P1 and P2 can run in parallel. Used to verify the factory's full
impl → review → ship → merge loop on real dispatch with cheap GLM
agents.
