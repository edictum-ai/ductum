# P2-CLAMP — Add clampNumber helper

## Goal

Create a brand-new file `packages/core/src/utils/clamp.ts` exporting
one tiny number helper, and a vitest file alongside it.

This is a tiny scoped task — under 40 lines of code total. Do not
modify any other file. Do not add an export from `packages/core/src/index.ts`.

## What to build

`packages/core/src/utils/clamp.ts`:

```ts
/**
 * Clamp a number into the inclusive `[min, max]` range.
 * - If `n < min`, returns `min`.
 * - If `n > max`, returns `max`.
 * - Otherwise returns `n`.
 *
 * Throws if `min > max`.
 */
export function clampNumber(n: number, min: number, max: number): number {
  // implementation
}
```

`packages/core/src/tests/utils-clamp.test.ts`:

Vitest cases (at least 5):
- clampNumber(5, 0, 10) → 5
- clampNumber(-3, 0, 10) → 0
- clampNumber(99, 0, 10) → 10
- clampNumber(0, 0, 10) → 0 (boundary)
- clampNumber(10, 0, 10) → 10 (boundary)
- clampNumber(5, 10, 0) throws (invalid range)

## Verification

Run `pnpm --filter @ductum/core test` and confirm green.

Then commit on the worktree branch with a one-line message and call
`ductum_complete`.
