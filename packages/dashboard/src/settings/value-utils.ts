export function firstNonEmpty(values: Array<string | null | undefined>, fallback: string): string {
  return values.find((value) => value != null && value !== '') ?? fallback
}

export function matchesAnyNonEmpty(value: string | undefined, candidates: readonly (string | undefined)[]): boolean {
  return value != null && value !== '' && candidates.some((candidate) => sameNonEmpty(candidate, value))
}

export function sameNonEmpty(a: string | undefined, b: string | undefined): boolean {
  return a != null && a !== '' && b != null && b !== '' && a === b
}
