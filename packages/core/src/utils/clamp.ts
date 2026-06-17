/**
 * Clamp a number into the inclusive `[min, max]` range.
 * - If `n < min`, returns `min`.
 * - If `n > max`, returns `max`.
 * - Otherwise returns `n`.
 *
 * Throws if `min > max`.
 */
export function clampNumber(n: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clampNumber: min (${min}) must not exceed max (${max})`);
  }
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
