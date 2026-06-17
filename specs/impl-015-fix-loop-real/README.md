# impl-015: Fix Loop Real

**Spec:** `specs/impl-015-fix-loop-real/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-SLUGIFY.md](P1-SLUGIFY.md) | Add `slugify(s)` helper | — |

Used to drive the impl → review FAIL → fix → re-review → ship loop.
The round-1 prompt asks the agent to add only the basic happy-path
case (lowercase + hyphens). The acceptance criteria below the prompt
demand much more — accents, multiple spaces, leading/trailing spaces,
unicode strip — so the round-1 reviewer will notice the gap and FAIL
the diff against the explicit acceptance list.
