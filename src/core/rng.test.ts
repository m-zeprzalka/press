import { describe, expect, it } from 'vitest';
import { Rng, hash128 } from './rng';

describe('hash128', () => {
  it('is deterministic and sensitive to input', () => {
    expect(hash128('PRESS')).toEqual(hash128('PRESS'));
    expect(hash128('PRESS')).not.toEqual(hash128('PRESs'));
    for (const w of hash128('x')) expect(w).toBeGreaterThanOrEqual(0);
  });
});

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = Rng.fromSeed('seed');
    const b = Rng.fromSeed('seed');
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('derives independent streams', () => {
    const a = Rng.derive('s', 'tray', 1, 2);
    const b = Rng.derive('s', 'tray', 1, 3);
    expect(a.next()).not.toBe(b.next());
    expect(Rng.derive('s', 'tray', 1, 2).next()).toBe(Rng.derive('s', 'tray', 1, 2).next());
  });

  it('next() stays in [0,1) and is roughly uniform', () => {
    const r = Rng.fromSeed('uniform');
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
    }
    for (const b of buckets) expect(b).toBeGreaterThan(1700);
  });

  it('int/chance/pick/shuffle', () => {
    const r = Rng.fromSeed('misc');
    for (let i = 0; i < 1000; i++) {
      const v = r.int(7);
      expect(Number.isInteger(v) && v >= 0 && v < 7).toBe(true);
    }
    expect(() => r.int(0)).toThrow(RangeError);
    expect(r.chance(1)).toBe(true);
    expect(r.chance(0)).toBe(false);
    expect(['a']).toContain(r.pick(['a']));
    expect(() => r.pick([])).toThrow(RangeError);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = r.shuffle([...arr]);
    expect([...shuffled].sort()).toEqual(arr);
  });

  it('weightedIndex respects weights and skips non-positive', () => {
    const r = Rng.fromSeed('weights');
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[r.weightedIndex([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.6);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.4);
    expect(() => r.weightedIndex([0, -1])).toThrow(RangeError);
    expect(r.weightedIndex([0, 5])).toBe(1);
  });

  it('round-trips state exactly', () => {
    const r = Rng.fromSeed('state');
    r.next();
    const st = r.getState();
    const copy = Rng.fromState(st);
    for (let i = 0; i < 50; i++) expect(copy.nextU32()).toBe(r.nextU32());
  });
});

/** Reference sfc32 written from the published algorithm (Chris Doty-Humphrey, PractRand), JS form by bryc. */
function referenceSfc32(seed: readonly [number, number, number, number]): () => number {
  let [a, b, c, d] = seed;
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

describe('Rng golden vectors (daily / save compatibility, GDD §18.4)', () => {
  it('hash128 (cyrb128) is stable', () => {
    expect(hash128('')).toEqual([41608494, 3485963809, 1435736333, 1262568316]);
    expect(hash128('PRESS')).toEqual([3638052719, 3234912124, 4290239523, 1208132859]);
    expect(hash128('PRESS-2026-10-07-r1|daily')).toEqual([2152093597, 3546009306, 2810643854, 2425397679]);
  });

  it('fromSeed / derive output is stable', () => {
    const r = Rng.fromSeed('PRESS');
    expect([r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([
      1124849896, 4014129338, 2990470142, 3109139709, 2255894004,
    ]);
    const d = Rng.derive('PRESS', 'tray', 0, 0);
    expect([d.nextU32(), d.nextU32(), d.nextU32()]).toEqual([3023606173, 1938368340, 206284189]);
    expect(Rng.fromSeed('shuffle').shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([
      1, 2, 0, 8, 4, 7, 5, 6, 9, 3,
    ]);
  });

  it('matches a reference sfc32 seeded with cyrb128 after a 12-step warm-up', () => {
    for (const seed of ['', 'a', 'PRESS', 'PRESS-2026-10-07-r1', 'zażółć gęślą jaźń', '🟥🟧🟨']) {
      const ref = referenceSfc32(hash128(seed));
      for (let i = 0; i < 12; i++) ref();
      const r = Rng.fromSeed(seed);
      for (let i = 0; i < 500; i++) expect(r.nextU32()).toBe(ref());
    }
  });

  it('fromState does not warm up; fromSeed = fromState(hash128) + 12 draws', () => {
    const raw = Rng.fromState(hash128('warm'));
    for (let i = 0; i < 12; i++) raw.nextU32();
    const seeded = Rng.fromSeed('warm');
    for (let i = 0; i < 100; i++) expect(raw.nextU32()).toBe(seeded.nextU32());
  });

  it('derive(seed, ...path) is fromSeed of the "|"-joined key', () => {
    const cases: Array<[string, Array<string | number>]> = [
      ['run', ['tray', 3, 7]],
      ['run', ['offer', 0, 2]],
      ['run', ['modifiers', 5]],
      ['run', ['board', 17]],
      ['PRESS-2026-10-07-r1', ['daily']],
    ];
    for (const [seed, path] of cases) {
      const a = Rng.derive(seed, ...path);
      const b = Rng.fromSeed(`${seed}|${path.join('|')}`);
      for (let i = 0; i < 20; i++) expect(a.nextU32()).toBe(b.nextU32());
    }
    // String and number path parts with the same text are the same stream.
    expect(Rng.derive('s', 'board', 3).nextU32()).toBe(Rng.derive('s', 'board', '3').nextU32());
  });

  it('streams of neighbouring keys look unrelated', () => {
    const firsts = new Set<number>();
    for (let a = 0; a < 30; a++)
      for (let b = 0; b < 30; b++) firsts.add(Rng.derive('seed', 'tray', a, b).nextU32());
    expect(firsts.size).toBe(900);
  });
});

describe('Rng distributions and edge cases', () => {
  it('getState is four unsigned 32-bit words and JSON round-trips', () => {
    const r = Rng.fromSeed('json');
    for (let i = 0; i < 7; i++) r.next();
    const st = r.getState();
    expect(st).toHaveLength(4);
    for (const w of st) expect(Number.isInteger(w) && w >= 0 && w <= 0xffffffff).toBe(true);
    const copy = Rng.fromState(JSON.parse(JSON.stringify(st)) as typeof st);
    for (let i = 0; i < 50; i++) expect(copy.next()).toBe(r.next());
  });

  it('getState does not advance the stream', () => {
    const a = Rng.fromSeed('peek');
    const b = Rng.fromSeed('peek');
    a.getState();
    a.getState();
    expect(a.nextU32()).toBe(b.nextU32());
  });

  it('int(1) is always 0 and int(n) covers [0, n) uniformly', () => {
    const r = Rng.fromSeed('int');
    for (let i = 0; i < 200; i++) expect(r.int(1)).toBe(0);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[r.int(6)]!++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(9400);
      expect(c).toBeLessThan(10600);
    }
    expect(() => r.int(-3)).toThrow(RangeError);
    const big = 2 ** 31;
    for (let i = 0; i < 1000; i++) {
      const v = r.int(big);
      expect(Number.isInteger(v) && v >= 0 && v < big).toBe(true);
    }
  });

  it('chance(p) has frequency ≈ p', () => {
    const r = Rng.fromSeed('chance');
    let hits = 0;
    for (let i = 0; i < 40000; i++) if (r.chance(0.25)) hits++;
    expect(hits / 40000).toBeGreaterThan(0.24);
    expect(hits / 40000).toBeLessThan(0.26);
  });

  it('pick covers every element roughly uniformly', () => {
    const r = Rng.fromSeed('pick');
    const items = ['a', 'b', 'c', 'd'] as const;
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 40000; i++) counts[r.pick(items)]!++;
    for (const k of items) {
      expect(counts[k]).toBeGreaterThan(9500);
      expect(counts[k]).toBeLessThan(10500);
    }
  });

  it('shuffle is in place, a permutation, and unbiased over all orders of 3', () => {
    const r = Rng.fromSeed('perm');
    const arr = [1, 2, 3, 4, 5];
    expect(r.shuffle(arr)).toBe(arr);
    expect([...arr].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r.shuffle([])).toEqual([]);
    expect(r.shuffle([42])).toEqual([42]);
    const counts = new Map<string, number>();
    for (let i = 0; i < 60000; i++) {
      const k = r.shuffle(['a', 'b', 'c']).join('');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) {
      expect(c).toBeGreaterThan(9400);
      expect(c).toBeLessThan(10600);
    }
  });

  it('shuffle of an empty or single-element array does not consume the stream', () => {
    const a = Rng.fromSeed('noop');
    const b = Rng.fromSeed('noop');
    a.shuffle([]);
    a.shuffle(['x']);
    expect(a.nextU32()).toBe(b.nextU32());
  });

  it('weightedIndex treats NaN and negative weights as zero and handles a single weight', () => {
    const r = Rng.fromSeed('w-edge');
    for (let i = 0; i < 500; i++) {
      expect(r.weightedIndex([NaN, 2, -5])).toBe(1);
      expect(r.weightedIndex([7])).toBe(0);
      expect(r.weightedIndex([0, 0, 0, 1e-9])).toBe(3);
    }
    expect(() => r.weightedIndex([])).toThrow(RangeError);
    expect(() => r.weightedIndex([NaN])).toThrow(RangeError);
  });

  it('weightedIndex consumes exactly one draw', () => {
    const a = Rng.fromSeed('w-one');
    const b = Rng.fromSeed('w-one');
    a.weightedIndex([1, 2, 3]);
    b.next();
    expect(a.nextU32()).toBe(b.nextU32());
  });
});
