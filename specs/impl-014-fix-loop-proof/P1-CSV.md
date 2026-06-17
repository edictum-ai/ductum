# P1-CSV — Add a parseCsvRow helper

## Goal

Add `packages/core/src/utils/csv.ts` exporting one tiny string parser
plus a vitest file. Do not modify any other file. Do not add an
export from `packages/core/src/index.ts`.

## What to build

`packages/core/src/utils/csv.ts`:

```ts
/**
 * Parse a single CSV row into an array of fields.
 *
 * Splits on commas. Trims whitespace from each field.
 *
 * Examples:
 *   parseCsvRow("a,b,c")        → ["a", "b", "c"]
 *   parseCsvRow("foo, bar, baz") → ["foo", "bar", "baz"]
 *   parseCsvRow("")             → [""]
 */
export function parseCsvRow(line: string): string[] {
  // implementation
}
```

`packages/core/src/tests/utils-csv.test.ts`:

Vitest cases (5):
- `parseCsvRow("a,b,c")` → `["a", "b", "c"]`
- `parseCsvRow("foo, bar, baz")` → `["foo", "bar", "baz"]`
- `parseCsvRow("")` → `[""]`
- `parseCsvRow("only")` → `["only"]`
- `parseCsvRow("a,,c")` → `["a", "", "c"]`

## Verification

Run `pnpm --filter @ductum/core test` and confirm green.

Then commit on the worktree branch with a one-line message and call
`ductum_complete`.
