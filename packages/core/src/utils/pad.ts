/**
 * Pad a string on the left with `char` until it reaches `len` characters.
 * If `s` is already at least `len` characters long it is returned unchanged.
 */
export function padLeft(s: string, len: number, char: string = ' '): string {
  if (s.length >= len) return s;
  return char.repeat(len - s.length) + s;
}

/**
 * Pad a string on the right with `char` until it reaches `len` characters.
 * If `s` is already at least `len` characters long it is returned unchanged.
 */
export function padRight(s: string, len: number, char: string = ' '): string {
  if (s.length >= len) return s;
  return s + char.repeat(len - s.length);
}
