import { describe, expect, it } from 'vitest';
import { RULES_VERSION } from './config/version';
import { MATRIX_IDS, STARTER_MATRICES, matrixDef, type MatrixId } from './matrices';
import { dailyPool, dailySeed, dailyStartPlate, utcDate } from './daily';
import { Rng } from './rng';

const DAY = 86_400_000;

/** All UTC dates of a year, built from Date.UTC (no local time zone involved). */
function datesOfYear(year: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += DAY) out.push(utcDate(t));
  return out;
}

describe('utcDate', () => {
  it('formats a timestamp as YYYY-MM-DD in UTC', () => {
    expect(utcDate(0)).toBe('1970-01-01');
    expect(utcDate(Date.UTC(2026, 9, 7, 12, 34, 56))).toBe('2026-10-07');
    expect(utcDate(Date.UTC(2026, 0, 5))).toBe('2026-01-05');
    expect(utcDate(Date.UTC(2028, 1, 29, 18))).toBe('2028-02-29');
    expect(utcDate(Date.UTC(1999, 11, 31, 23, 59, 59, 999))).toBe('1999-12-31');
  });

  it('switches exactly at UTC midnight', () => {
    const midnight = Date.UTC(2026, 9, 8);
    expect(utcDate(midnight - 1)).toBe('2026-10-07');
    expect(utcDate(midnight)).toBe('2026-10-08');
    expect(utcDate(midnight + DAY - 1)).toBe('2026-10-08');
  });

  it('is zero-padded and always 10 characters for 4-digit years', () => {
    for (const d of datesOfYear(2026)) expect(d).toMatch(/^2026-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
    expect(new Set(datesOfYear(2026)).size).toBe(365);
    expect(new Set(datesOfYear(2028)).size).toBe(366);
  });

  it('rejects invalid timestamps', () => {
    expect(() => utcDate(NaN)).toThrow(RangeError);
  });
});

describe('dailySeed (GDD §10.1)', () => {
  it("has the format 'PRESS-YYYY-MM-DD-r<RULES_VERSION>'", () => {
    expect(dailySeed('2026-10-07')).toBe(`PRESS-2026-10-07-r${RULES_VERSION}`);
    expect(dailySeed('2026-10-07')).toMatch(/^PRESS-\d{4}-\d{2}-\d{2}-r\d+$/);
    expect(dailySeed(utcDate(Date.UTC(2027, 2, 3, 23)))).toBe(`PRESS-2027-03-03-r${RULES_VERSION}`);
  });

  it('matches the share-text example for rules version 1', () => {
    expect(RULES_VERSION).toBeGreaterThanOrEqual(1);
    if (RULES_VERSION === 1) expect(dailySeed('2026-10-07')).toBe('PRESS-2026-10-07-r1');
  });

  it('is unique per date', () => {
    const seeds = datesOfYear(2026).map(dailySeed);
    expect(new Set(seeds).size).toBe(365);
  });
});

describe('dailyPool', () => {
  it('is the fixed 22-plate starter pool, sorted', () => {
    const pool = dailyPool();
    expect(pool).toHaveLength(22);
    expect(new Set(pool).size).toBe(22);
    expect(pool).toEqual([...STARTER_MATRICES].sort());
    for (let i = 1; i < pool.length; i++) expect((pool[i - 1] as string) < (pool[i] as string)).toBe(true);
    for (const id of pool) {
      expect(MATRIX_IDS).toContain(id);
      expect(matrixDef(id).starter).toBe(true);
    }
  });

  it('contains every starter and no unlockable plate (GDD §8.2)', () => {
    const unlockables: MatrixId[] = [
      'registration',
      'crossmark',
      'type_case',
      'clean_sheet',
      'stencil',
      'momentum',
      'conveyor',
      'golden_type',
      'mirror',
      'split_fountain',
    ];
    const pool = dailyPool();
    for (const id of unlockables) expect(pool).not.toContain(id);
    expect(pool.length + unlockables.length).toBe(MATRIX_IDS.length);
    const byRarity = { common: 0, rare: 0, legendary: 0 };
    for (const id of pool) byRarity[matrixDef(id).rarity]++;
    expect(byRarity).toEqual({ common: 15, rare: 5, legendary: 2 });
  });

  it('returns a fresh copy (callers cannot mutate the pool)', () => {
    const a = dailyPool();
    a.pop();
    a.reverse();
    expect(dailyPool()).toHaveLength(22);
    expect(dailyPool()).toEqual([...STARTER_MATRICES].sort());
    expect(dailyPool()).not.toBe(dailyPool());
  });
});

describe('dailyStartPlate (rule of the day)', () => {
  it('is a common plate from the daily pool', () => {
    const pool = dailyPool();
    for (const d of datesOfYear(2026)) {
      const id = dailyStartPlate(d);
      expect(pool).toContain(id);
      expect(matrixDef(id).rarity).toBe('common');
    }
  });

  it('is deterministic per date and drawn from the "daily" stream of the daily seed', () => {
    const commons = dailyPool().filter((id) => matrixDef(id).rarity === 'common');
    for (const d of ['2026-10-07', '2026-10-08', '2030-01-01']) {
      expect(dailyStartPlate(d)).toBe(dailyStartPlate(d));
      expect(dailyStartPlate(d)).toBe(Rng.derive(dailySeed(d), 'daily').pick(commons));
    }
  });

  it('varies between days and covers every common plate over a year', () => {
    const picks = datesOfYear(2026).map(dailyStartPlate);
    const commons = dailyPool().filter((id) => matrixDef(id).rarity === 'common');
    expect(new Set(picks)).toEqual(new Set(commons));
    // Not the same plate every day.
    let changes = 0;
    for (let i = 1; i < picks.length; i++) if (picks[i] !== picks[i - 1]) changes++;
    expect(changes).toBeGreaterThan(250);
  });
});
