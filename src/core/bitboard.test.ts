import { describe, expect, it } from 'vitest';
import {
  FULL_ROW,
  anyFits,
  canPlace,
  clearInto,
  cloneRows,
  countFilled,
  emptyRows,
  fits,
  fullLines,
  isSolvable,
  placeAndClear,
  placeInto,
  popcount8,
  positions,
  type SolveStats,
} from './bitboard';
import { SHAPES, shapeById, type Shape } from './pieces';
import { Rng } from './rng';

const rowsFrom = (art: string[]) => {
  const r = emptyRows();
  art.forEach((line, y) => {
    for (let x = 0; x < 8; x++) if (line[x] === '#') r[y] = (r[y] as number) | (1 << x);
  });
  return r;
};

describe('bitboard basics', () => {
  it('popcount8', () => {
    for (let v = 0; v < 256; v++) {
      let n = 0;
      for (let b = 0; b < 8; b++) if (v & (1 << b)) n++;
      expect(popcount8(v)).toBe(n);
    }
  });

  it('canPlace respects bounds and overlap', () => {
    const r = emptyRows();
    const o9 = shapeById('o9');
    expect(canPlace(r, o9, 0, 0)).toBe(true);
    expect(canPlace(r, o9, 5, 5)).toBe(true);
    expect(canPlace(r, o9, 6, 0)).toBe(false);
    expect(canPlace(r, o9, 0, 6)).toBe(false);
    expect(canPlace(r, o9, -1, 0)).toBe(false);
    expect(canPlace(r, o9, 0, -1)).toBe(false);
    placeInto(r, shapeById('dot'), 1, 1);
    expect(canPlace(r, o9, 0, 0)).toBe(false);
    expect(canPlace(r, o9, 2, 0)).toBe(true);
    expect(countFilled(r)).toBe(1);
  });

  it('detects and clears full rows and columns', () => {
    const r = rowsFrom(['########', '#.......', '#.......', '#.......', '#.......', '#.......', '#.......', '#.......']);
    const m = fullLines(r);
    expect(m.rowMask).toBe(1);
    expect(m.colMask).toBe(1);
    expect(fullLines(r, { rowsOnly: true }).colMask).toBe(0);
    expect(fullLines(r, { blockedRows: 1 }).rowMask).toBe(0);
    expect(fullLines(r, { blockedCols: 1 }).colMask).toBe(0);
    expect(fullLines(r, { blockedCols: 2 }).colMask).toBe(1);
    const c = cloneRows(r);
    clearInto(c, m);
    expect(countFilled(c)).toBe(0);
  });

  it('placeAndClear clears after placing', () => {
    const r = rowsFrom(['#######.']);
    const masks = placeAndClear(r, shapeById('dot'), 7, 0);
    expect(masks.rowMask).toBe(1);
    expect(countFilled(r)).toBe(0);
    const r2 = rowsFrom(['#######.']);
    expect(placeAndClear(r2, shapeById('dot'), 0, 1).rowMask).toBe(0);
    expect(countFilled(r2)).toBe(8);
  });

  it('positions/fits/anyFits', () => {
    const r = emptyRows();
    expect(positions(r, shapeById('o9')).length).toBe(36);
    expect(positions(r, shapeById('dot')).length).toBe(64);
    const full = new Uint8Array(8).fill(FULL_ROW);
    full[3] = 0xfe;
    expect(fits(full, shapeById('dot'))).toBe(true);
    expect(fits(full, shapeById('i2h'))).toBe(false);
    expect(anyFits(full, [shapeById('i2h'), shapeById('o4')])).toBe(false);
    expect(anyFits(full, [shapeById('i2h'), shapeById('dot')])).toBe(true);
  });
});

describe('isSolvable', () => {
  it('empty tray is solvable', () => {
    expect(isSolvable(emptyRows(), [])).toBe(true);
  });

  it('empty board fits any three pieces', () => {
    expect(isSolvable(emptyRows(), [shapeById('o9'), shapeById('o9'), shapeById('o9')])).toBe(true);
  });

  it('requires line clears between placements', () => {
    // Only the last column of row 0..7 is free except one 3x3 window; a big piece only fits after a clear.
    const r = rowsFrom([
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '........',
    ]);
    // i5v cannot fit at first? It can: column 7 rows 0..6 free → fits. Then the column clears.
    expect(isSolvable(r, [shapeById('i5v'), shapeById('i2v')])).toBe(true);
    // i5v completes rows 0-4, which clear and make room for the o9.
    expect(isSolvable(r, [shapeById('o9'), shapeById('i5v')])).toBe(true);
    // A lone 3x3 has no room without a clear.
    expect(isSolvable(r, [shapeById('o9')])).toBe(false);
  });

  it('matches a naive brute-force solver on random boards', () => {
    const brute = (rows: Uint8Array, shapes: Shape[], rowsOnly: boolean): boolean => {
      if (shapes.length === 0) return true;
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i]!;
        const rest = shapes.filter((_, j) => j !== i);
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            if (!canPlace(rows, s, x, y)) continue;
            const n = cloneRows(rows);
            placeAndClear(n, s, x, y, { rowsOnly });
            if (brute(n, rest, rowsOnly)) return true;
          }
      }
      return false;
    };
    const rng = Rng.fromSeed('brute');
    let unsolvable = 0;
    for (let t = 0; t < 250; t++) {
      const rows = emptyRows();
      const density = 0.55 + rng.next() * 0.35;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (rng.chance(density)) rows[y]! |= 1 << x;
      // Make it a legal resting board (no full lines).
      clearInto(rows, fullLines(rows));
      const tray = [rng.pick(SHAPES), rng.pick(SHAPES), rng.pick(SHAPES)];
      const rowsOnly = t % 5 === 0;
      const expected = brute(rows, tray, rowsOnly);
      if (!expected) unsolvable++;
      expect(isSolvable(rows, tray, { rowsOnly })).toBe(expected);
    }
    expect(unsolvable).toBeGreaterThan(10);
  });

  it('respects rowsOnly and blocked lines', () => {
    const r = rowsFrom([
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
    ]);
    // Filling column 7 completes every row → board clears → o9 fits.
    expect(isSolvable(r, [shapeById('i5v'), shapeById('i3v'), shapeById('o9')])).toBe(true);
    // Rows only: same thing (rows complete).
    expect(isSolvable(r, [shapeById('i5v'), shapeById('i3v'), shapeById('o9')], { rowsOnly: true })).toBe(true);
    // Every row blocked (jammed) → nothing ever prints → no room for the 3x3.
    expect(isSolvable(r, [shapeById('i5v'), shapeById('i3v'), shapeById('o9')], { blockedRows: 0xff, blockedCols: 0xff })).toBe(false);
  });

  it('collects stats and memoises duplicates', () => {
    const stats: SolveStats = { nodes: 0 };
    const r = rowsFrom(['########', '########', '########', '########', '########', '###.....', '###.....', '###.....']);
    // Board after placement (rows 0-4 full would be cleared — emulate a crowded but legal board).
    r[0] = 0x7f;
    r[1] = 0x7f;
    r[2] = 0x7f;
    r[3] = 0x7f;
    r[4] = 0x7f;
    expect(isSolvable(r, [shapeById('o9'), shapeById('o9'), shapeById('o9')], {}, stats)).toBe(true);
    expect(stats.nodes).toBeGreaterThan(0);
    const s2: SolveStats = { nodes: 0 };
    const tight = new Uint8Array(8).fill(0xff);
    tight[0] = 0x00;
    tight[1] = 0x00;
    // two free rows: three o9 cannot fit
    expect(isSolvable(tight, [shapeById('o9'), shapeById('o9'), shapeById('o9')], {}, s2)).toBe(false);
  });
});
