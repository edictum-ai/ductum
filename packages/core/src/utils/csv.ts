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
  return line.split(",").map((field) => field.trim());
}
