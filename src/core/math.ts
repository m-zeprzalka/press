/**
 * Deterministic numeric helpers. Basic IEEE-754 operations (+ − × ÷) are correctly
 * rounded on every JS engine, while Math.pow / Math.log10 are not guaranteed to be,
 * so core logic that feeds saves or the daily challenge uses these instead.
 */

/** base^k for a non-negative integer k by repeated multiplication. */
export function ipow(base: number, k: number): number {
  if (!Number.isInteger(k) || k < 0) throw new RangeError('ipow: k must be a non-negative integer');
  let r = 1;
  for (let i = 0; i < k; i++) r *= base;
  return r;
}

/** Rounds to two significant digits (values ≥ 100), or to tens below that (min 10). */
export function niceRound(v: number): number {
  if (!(v > 0)) return 10;
  // Guard: the magnitude loop below never terminates for +Infinity (Infinity >= Infinity).
  if (v === Infinity) return v;
  if (v < 100) return Math.max(10, Math.round(v / 10) * 10);
  let mag = 1;
  while (v >= mag * 100) mag *= 10;
  return Math.round(v / mag) * mag;
}
