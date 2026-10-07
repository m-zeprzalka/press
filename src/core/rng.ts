/**
 * Deterministic, serialisable PRNG (sfc32) seeded from strings via cyrb128.
 *
 * Every random decision in the game is drawn from a stream derived from
 * `(runSeed, context, ...indices)` so that save/resume and the daily challenge
 * replay identically regardless of UI timing.
 */

export type RngState = [number, number, number, number];

/** cyrb128 string hash → four 32-bit words. */
export function hash128(input: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
    // Warm up so that similar seeds diverge quickly.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  static fromSeed(seed: string): Rng {
    return new Rng(hash128(seed));
  }

  /** Stream derived from a base seed and a context path. */
  static derive(seed: string, ...path: ReadonlyArray<string | number>): Rng {
    return Rng.fromSeed(`${seed}|${path.join('|')}`);
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    if (n <= 0) throw new RangeError('Rng.int: n must be > 0');
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[this.int(items.length)] as T;
  }

  /** Index drawn proportionally to non-negative weights. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) throw new RangeError('Rng.weightedIndex: no positive weight');
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number;
      if (w <= 0) continue;
      r -= w;
      if (r < 0) return i;
    }
    // Floating point edge: return the last positive weight.
    for (let i = weights.length - 1; i >= 0; i--) if ((weights[i] as number) > 0) return i;
    // Unreachable: total > 0 means some weight is > 0, so the scan above always returns.
    /* c8 ignore next -- @preserve */
    return 0;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  /** Restore an exact state (no warm-up). */
  static fromState(state: RngState): Rng {
    const r = Object.create(Rng.prototype) as Rng;
    r.a = state[0] | 0;
    r.b = state[1] | 0;
    r.c = state[2] | 0;
    r.d = state[3] | 0;
    return r;
  }
}
