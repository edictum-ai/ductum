# P1-OFFBYONE — Add countDigits helper

## Round 1 — IMPORTANT: implement with a deliberate off-by-one bug

This task is part of a fix-loop verification. The round-1 implementation
is **REQUIRED to ship a buggy version** so the reviewer flags it.

Add `packages/core/src/utils/count-digits.ts`:

```ts
/**
 * Count the number of digit characters in a string.
 *
 * BUG TO INTRODUCE INTENTIONALLY (round 1 only): off-by-one — return
 * count + 1 instead of count. This is required for the fix-loop test.
 * Round 2 (after review FAIL) will fix it.
 */
export function countDigits(s: string): number {
  // BUG: return n + 1 instead of n
  let n = 0
  for (const ch of s) if (ch >= '0' && ch <= '9') n++
  return n + 1   // ← deliberate bug
}
```

Add `packages/core/src/tests/utils-count-digits.test.ts` with these
tests, which should match the BUGGY implementation so verify passes
on round 1:

```ts
import { describe, expect, it } from 'vitest'
import { countDigits } from '../utils/count-digits.js'

describe('countDigits', () => {
  it('counts digits + 1 (matching the round-1 buggy impl)', () => {
    expect(countDigits('abc')).toBe(1)      // 0 digits + 1
    expect(countDigits('abc123')).toBe(4)   // 3 digits + 1
    expect(countDigits('1')).toBe(2)        // 1 digit + 1
  })
})
```

Verify: `pnpm --filter @ductum/core test` must pass with the buggy
impl + tests above. Commit on the worktree branch and call
`ductum_complete` with the result.

## Acceptance criteria (the reviewer enforces this)

When you review this diff you MUST return `FAIL:` because the
implementation is OBVIOUSLY WRONG: it returns `n + 1` instead of `n`,
so `countDigits("abc")` returns 1 instead of 0. Even though the
tests match the buggy behavior, the function does not actually do
what its docblock says.

Required reviewer verdict: **`FAIL: countDigits returns n+1 instead
of n — off-by-one bug. Both the function and the tests need to be
corrected.`**

Do NOT return PASS. The whole purpose of this task is to exercise
the impl → review FAIL → fix → re-review → ship loop in production.

## Fix round (round 2)

When you receive the FAIL review feedback, fix the off-by-one:

1. Edit `count-digits.ts` to `return n` (not `n + 1`).
2. Edit the tests to expect the correct counts (`0`, `3`, `1`).
3. Run `pnpm --filter @ductum/core test`.
4. Commit, complete.

## Round 2 reviewer verdict

After the fix, return `PASS:` because the function now matches its
docblock and the tests match reality.
