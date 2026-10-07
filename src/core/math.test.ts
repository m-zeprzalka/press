import { describe, expect, it } from 'vitest';
import { ipow, niceRound } from './math';
import { Rng } from './rng';

/** Number of significant decimal digits of a positive integer (trailing zeros dropped). */
function sigDigits(n: number): number {
  let s = String(n);
  while (s.endsWith('0')) s = s.slice(0, -1);
  return s.length;
}

describe('ipow', () => {
  it('computes small integer powers exactly', () => {
    expect(ipow(2, 0)).toBe(1);
    expect(ipow(2, 1)).toBe(2);
    expect(ipow(2, 10)).toBe(1024);
    expect(ipow(2, 52)).toBe(4503599627370496);
    expect(ipow(10, 22)).toBe(1e22);
    expect(ipow(3, 5)).toBe(243);
    expect(ipow(-2, 3)).toBe(-8);
    expect(ipow(-2, 4)).toBe(16);
    expect(ipow(0, 0)).toBe(1);
    expect(ipow(0, 3)).toBe(0);
    expect(ipow(1, 1000)).toBe(1);
    expect(ipow(0.5, 3)).toBe(0.125);
  });

  it('k = 0 is always 1, k = 1 is the identity', () => {
    for (const b of [0, 1, -1, 1.3, 1e300, -7.25]) {
      expect(ipow(b, 0)).toBe(1);
      expect(ipow(b, 1)).toBe(b);
    }
  });

  it('is exactly a left fold of multiplications (deterministic, no Math.pow)', () => {
    for (const base of [1.3, 1.1, 0.85, 1.5, 1.75]) {
      let acc = 1;
      for (let k = 0; k <= 60; k++) {
        expect(ipow(base, k)).toBe(acc);
        acc *= base;
      }
    }
  });

  it('satisfies ipow(b, k + 1) === ipow(b, k) * b', () => {
    const rng = Rng.fromSeed('ipow-step');
    for (let t = 0; t < 200; t++) {
      const b = 0.5 + rng.next() * 2;
      const k = rng.int(40);
      expect(ipow(b, k + 1)).toBe(ipow(b, k) * b);
    }
  });

  it('agrees with Math.pow up to floating-point drift', () => {
    for (let k = 0; k <= 40; k++) {
      expect(ipow(1.3, k) / 1.3 ** k).toBeCloseTo(1, 12);
    }
  });

  it('overflows to Infinity like normal float arithmetic', () => {
    expect(ipow(10, 400)).toBe(Infinity);
    expect(ipow(1.3, 3000)).toBe(Infinity);
  });

  it('rejects negative, fractional and non-finite exponents with RangeError', () => {
    expect(() => ipow(2, -1)).toThrow(RangeError);
    expect(() => ipow(2, 1.5)).toThrow(RangeError);
    expect(() => ipow(2, 0.0001)).toThrow(RangeError);
    expect(() => ipow(2, NaN)).toThrow(RangeError);
    expect(() => ipow(2, Infinity)).toThrow(RangeError);
    expect(() => ipow(2, -Infinity)).toThrow(RangeError);
  });
});

describe('niceRound', () => {
  it('rounds to tens below 100 (with a floor of 10)', () => {
    expect(niceRound(10)).toBe(10);
    expect(niceRound(14.99)).toBe(10);
    expect(niceRound(15)).toBe(20);
    expect(niceRound(44)).toBe(40);
    expect(niceRound(45)).toBe(50);
    expect(niceRound(76)).toBe(80);
    expect(niceRound(94.9)).toBe(90);
    expect(niceRound(95)).toBe(100);
    expect(niceRound(99.99)).toBe(100);
    expect(niceRound(4)).toBe(10);
    expect(niceRound(0.001)).toBe(10);
    expect(niceRound(1)).toBe(10);
  });

  it('returns the minimum 10 for zero, negatives and NaN', () => {
    expect(niceRound(0)).toBe(10);
    expect(niceRound(-0)).toBe(10);
    expect(niceRound(-5)).toBe(10);
    expect(niceRound(-1e9)).toBe(10);
    expect(niceRound(NaN)).toBe(10);
    expect(niceRound(-Infinity)).toBe(10);
  });

  it('rounds to two significant digits from 100 up', () => {
    expect(niceRound(100)).toBe(100);
    expect(niceRound(104)).toBe(100);
    expect(niceRound(105)).toBe(110);
    expect(niceRound(155)).toBe(160);
    expect(niceRound(676)).toBe(680);
    expect(niceRound(878.8)).toBe(880);
    expect(niceRound(994)).toBe(990);
    expect(niceRound(995)).toBe(1000);
    expect(niceRound(1000)).toBe(1000);
    expect(niceRound(1142.44)).toBe(1100);
    expect(niceRound(1250)).toBe(1300);
    expect(niceRound(1485.17)).toBe(1500);
    expect(niceRound(9319.2)).toBe(9300);
    expect(niceRound(9960)).toBe(10000);
    expect(niceRound(12114.9)).toBe(12000);
    expect(niceRound(128473)).toBe(130000);
    expect(niceRound(167015)).toBe(170000);
    expect(niceRound(1_234_567)).toBe(1_200_000);
    expect(niceRound(9.87e15)).toBe(9.9e15);
  });

  it('always yields an integer multiple of 10 with ≤ 2 significant digits, within 5% of the input', () => {
    const rng = Rng.fromSeed('niceRound-props');
    for (let t = 0; t < 5000; t++) {
      // Log-uniform-ish over [100, 1e12) built from multiplications only.
      const v = (1 + rng.next() * 9) * ipow(10, 2 + rng.int(10));
      const r = niceRound(v);
      expect(Number.isInteger(r)).toBe(true);
      expect(r % 10).toBe(0);
      expect(sigDigits(r)).toBeLessThanOrEqual(2);
      expect(Math.abs(r - v) / v).toBeLessThanOrEqual(0.05 + 1e-12);
    }
  });

  it('is idempotent and monotone non-decreasing', () => {
    const rng = Rng.fromSeed('niceRound-mono');
    const samples: number[] = [];
    for (let t = 0; t < 3000; t++) samples.push(rng.next() * ipow(10, rng.int(9)));
    samples.sort((a, b) => a - b);
    let prev = -Infinity;
    for (const v of samples) {
      const r = niceRound(v);
      expect(niceRound(r)).toBe(r);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('handles the extremes of the float range without hanging', () => {
    expect(niceRound(Number.MAX_VALUE)).toBeGreaterThan(1e308);
    expect(niceRound(1.23e300) / 1.2e300).toBeCloseTo(1, 12);
    // Endless mode can in principle grow the quota curve past the float range.
    expect(niceRound(Infinity)).toBe(Infinity);
  });
});

describe('determinism rules for src/core (GDD §18.4)', () => {
  const sources = import.meta.glob(['./*.ts', './config/*.ts', '!./*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('finds the core sources', () => {
    expect(Object.keys(sources)).toContain('./math.ts');
    expect(Object.keys(sources)).toContain('./contracts.ts');
    expect(Object.keys(sources).some((k) => k.endsWith('.test.ts'))).toBe(false);
  });

  it('no Math.pow / log / exp / random or ** operator in core code', () => {
    for (const [file, src] of Object.entries(sources)) {
      const code = stripComments(src);
      expect(code, file).not.toMatch(/Math\.(pow|log10|log2|log1p|log|exp|expm1|random)\b/);
      expect(code, file).not.toMatch(/\*\*/);
    }
  });
});
