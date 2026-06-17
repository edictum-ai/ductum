# P1-PAD — Add padLeft and padRight helpers

## Goal

Create a brand-new file `packages/core/src/utils/pad.ts` exporting two
small string helpers, and a vitest file alongside it.

This is a tiny scoped task — under 60 lines of code total. Do not
modify any other file. Do not add an export from `packages/core/src/index.ts`.

## What to build

`packages/core/src/utils/pad.ts`:

```ts
/**
 * Pad a string on the left with `char` until it reaches `len` characters.
 * If `s` is already at least `len` characters long it is returned unchanged.
 */
export function padLeft(s: string, len: number, char: string = ' '): string {
  // implementation
}

/**
 * Pad a string on the right with `char` until it reaches `len` characters.
 * If `s` is already at least `len` characters long it is returned unchanged.
 */
export function padRight(s: string, len: number, char: string = ' '): string {
  // implementation
}
```

`packages/core/src/utils/__tests__/pad.test.ts` OR
`packages/core/src/tests/utils-pad.test.ts`:

Vitest cases (5 each):
- padLeft of "1" to length 4 with "0" → "0001"
- padLeft of "abc" to length 3 → "abc" (no change)
- padLeft of "abc" to length 5 with default char → "  abc"
- padLeft of "" to length 3 with "x" → "xxx"
- padLeft of "abcd" to length 2 → "abcd" (already longer)
- Same five cases for padRight, mirrored on the right.

## Verification

Run `pnpm --filter @ductum/core test` and confirm green.

Then commit on the worktree branch with a one-line message and call
`ductum_complete`.
