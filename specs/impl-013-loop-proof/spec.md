# impl-013 — Loop Proof

A minimal spec used to verify the full Ductum factory lifecycle
end-to-end on a real dispatch. Two tiny tasks, each scoped to a
single helper file. Both should be executable by GLM in under five
minutes total, leaving plenty of room for review and auto-merge.

## Goals

- Add two tiny utility helpers under `packages/core/src/utils/`.
- Each helper has its own file, its own tests, and a docblock.
- Verify build + tests stay green.

## Non-goals

- No changes to existing code.
- No changes to schemas, dispatcher, or workflow definitions.
- No new dependencies.

## Tasks

| # | Task | Scope |
|---|------|-------|
| 1 | P1-PAD | New `packages/core/src/utils/pad.ts` exporting `padLeft(s, len, char)` and `padRight(s, len, char)` plus a vitest covering 5 cases each. |
| 2 | P2-CLAMP | New `packages/core/src/utils/clamp.ts` exporting `clampNumber(n, min, max)` plus a vitest covering 5 cases. |

Both tasks run in parallel — no dependency between them.

## Acceptance criteria

- New files exist under `packages/core/src/utils/`.
- `pnpm --filter @ductum/core test` is green.
- The exported functions are imported into nothing else (these are
  proof-of-life additions, not refactors).
