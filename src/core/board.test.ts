import { describe, expect, it } from 'vitest';
import {
  BLIND,
  EMPTY,
  JAM,
  LEAD,
  canPlaceCells,
  clearLines,
  countKind,
  findFullLines,
  idx,
  isBoardClean,
  isInk,
  lineCells,
  newCells,
  occupancy,
  blockedLines,
  clearRulesFor,
  placeCells,
} from './board';
import { shapeById } from './pieces';

describe('board cells', () => {
  it('starts empty', () => {
    const c = newCells();
    expect(c.length).toBe(64);
    expect(isBoardClean(c)).toBe(true);
    expect(blockedLines(c)).toEqual({ blockedRows: 0, blockedCols: 0 });
    expect(Array.from(occupancy(c))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('isInk', () => {
    expect([0, 1, 2, 3, 4].every(isInk)).toBe(true);
    expect([EMPTY, BLIND, LEAD, JAM].some(isInk)).toBe(false);
  });

  it('places and detects lines', () => {
    const c = newCells();
    expect(canPlaceCells(c, shapeById('i5h'), 0, 0)).toBe(true);
    expect(canPlaceCells(c, shapeById('i5h'), 4, 0)).toBe(false);
    expect(canPlaceCells(c, shapeById('i5h'), -1, 0)).toBe(false);
    const w = placeCells(c, shapeById('i5h'), 0, 0, 2);
    expect(w).toEqual([0, 1, 2, 3, 4]);
    expect(canPlaceCells(c, shapeById('i3h'), 3, 0)).toBe(false);
    placeCells(c, shapeById('i3h'), 5, 0, 1);
    expect(findFullLines(c)).toEqual({ rows: [0], cols: [] });
    expect(occupancy(c)[0]).toBe(0xff);
  });

  it('jams block their row and column; other lines clear', () => {
    const c = newCells();
    for (let x = 0; x < 8; x++) c[idx(x, 3)] = x === 2 ? JAM : 0;
    for (let y = 0; y < 8; y++) if (y !== 3) c[idx(5, y)] = LEAD;
    for (let y = 0; y < 8; y++) if (y !== 3) c[idx(2, y)] = 1;
    // Row 3 and column 2 contain the jam → never print. Column 5 has the jam? No: (5,3) is ink 0.
    const lines = findFullLines(c);
    expect(lines).toEqual({ rows: [], cols: [5] });
    expect(findFullLines(c, true)).toEqual({ rows: [], cols: [] });
    expect(blockedLines(c)).toEqual({ blockedRows: 1 << 3, blockedCols: 1 << 2 });
    expect(clearRulesFor(c, true)).toEqual({ rowsOnly: true, blockedRows: 8, blockedCols: 4 });
    const emptied = clearLines(c, lines);
    expect(emptied.length).toBe(8);
    expect(c[idx(2, 3)]).toBe(JAM);
    expect(countKind(c, (v) => v === JAM)).toBe(1);
    expect(isBoardClean(c)).toBe(false);
  });

  it('clearLines skips empty cells and reports in ascending order', () => {
    const c = newCells();
    for (let x = 0; x < 8; x++) c[idx(x, 0)] = 2;
    for (let y = 0; y < 8; y++) c[idx(0, y)] = 3;
    const emptied = clearLines(c, findFullLines(c));
    expect(emptied.length).toBe(15);
    expect(emptied).toEqual([...emptied].sort((a, b) => a - b));
    expect(isBoardClean(c)).toBe(true);
  });

  it('lineCells order', () => {
    expect(lineCells('row', 1)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(lineCells('col', 1)).toEqual([1, 9, 17, 25, 33, 41, 49, 57]);
  });

  it('isBoardClean ignores jams only', () => {
    const c = newCells();
    c[10] = JAM;
    expect(isBoardClean(c)).toBe(true);
    c[11] = BLIND;
    expect(isBoardClean(c)).toBe(false);
  });
});
