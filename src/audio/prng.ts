/**
 * Tiny deterministic PRNG for the audio module (mulberry32) plus an integer hash.
 * The music scheduler never touches Math.random: every musical decision is a pure
 * function of (seed, bar/step), so skipping ahead never changes what comes next.
 */

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash up to three integers into a well-mixed 32-bit unsigned value. */
export function hash32(a: number, b = 0, c = 0): number {
  return mix((mix((mix(a >>> 0) ^ (b >>> 0)) >>> 0) + (c >>> 0)) >>> 0);
}

export class Prng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0;
  }

  /** Re-seed in place (no allocation). */
  reseed(seed: number): this {
    this.s = seed >>> 0;
    return this;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
