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
