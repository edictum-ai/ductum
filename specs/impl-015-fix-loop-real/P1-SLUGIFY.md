# P1-SLUGIFY — Add slugify helper

## Round 1 — Implement (sparse spec)

Add `packages/core/src/utils/slugify.ts` exporting one helper:

```ts
/**
 * Convert a string to a URL slug.
 */
export function slugify(s: string): string {
  // implementation
}
```

For round 1 it's enough to lowercase the input and replace spaces
with hyphens. Add a vitest at `packages/core/src/tests/utils-slugify.test.ts`
covering at least the basic happy path:

- `slugify("Hello World")` → `"hello-world"`
- `slugify("foo bar")` → `"foo-bar"`

Run `pnpm --filter @ductum/core test` and confirm green. Commit on
the worktree branch and call `ductum_complete`.

## Acceptance criteria (the reviewer will check these)

When you review this diff, the implementation MUST handle ALL of the
following cases. If ANY of them are missing, the review MUST return
**`FAIL:`** with a list of the missing cases. Be strict — flag every
gap, not just one.

1. **Lowercase**
   `slugify("Hello World")` → `"hello-world"` ✓ (round 1 covers this)

2. **Spaces → hyphens**
   `slugify("foo bar")` → `"foo-bar"` ✓ (round 1 covers this)

3. **Multiple consecutive spaces collapse to one hyphen**
   `slugify("foo   bar")` → `"foo-bar"`

4. **Leading and trailing whitespace stripped**
   `slugify("  hello  ")` → `"hello"`

5. **Strip non-alphanumeric characters except hyphens**
   `slugify("Hello, World!")` → `"hello-world"`

6. **Accented characters normalized to ASCII**
   `slugify("café")` → `"cafe"`
   `slugify("naïve")` → `"naive"`

7. **Empty input**
   `slugify("")` → `""`

8. **Multiple punctuation collapses cleanly**
   `slugify("foo--bar")` → `"foo-bar"`

The vitest file MUST cover all 8 cases for the reviewer to PASS the
diff. The round-1 prompt only mentions cases 1 and 2 — that is
intentional. The reviewer's job is to enforce the full acceptance
list against the diff.

When reviewing: if ANY of cases 3–8 is missing from the implementation
or its tests, return `FAIL: <comma-separated list of missing cases>`.
Otherwise return `PASS:`.

## Fix round (what to do if review FAILs)

Read the reviewer's `FAIL:` list, add the missing cases to both
`slugify.ts` and `utils-slugify.test.ts`, run tests, commit, complete.

## Final acceptance

`pnpm --filter @ductum/core test` is green AND all 8 cases are in
the test file AND the reviewer returns `PASS:`.
