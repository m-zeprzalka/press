import { describe, expect, it } from 'vitest';
import { SHAPES, expectedSize, hasShape, shapeById } from './pieces';

describe('piece catalogue', () => {
  it('has unique ids and sizes 1..9', () => {
    const ids = new Set(SHAPES.map((s) => s.id));
    expect(ids.size).toBe(SHAPES.length);
    for (const s of SHAPES) {
      expect(s.size).toBeGreaterThanOrEqual(1);
      expect(s.size).toBeLessThanOrEqual(9);
      expect(s.cells.length).toBe(s.size);
      expect(s.weight).toBeGreaterThan(0);
    }
  });

  it('every shape is edge-connected and tight in its bounding box', () => {
    for (const s of SHAPES) {
      const key = (x: number, y: number) => `${x},${y}`;
      const set = new Set(s.cells.map(([x, y]) => key(x, y)));
      const seen = new Set<string>([key(...s.cells[0]!)]);
      const stack = [s.cells[0]!];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const k = key(x + dx, y + dy);
          if (set.has(k) && !seen.has(k)) {
            seen.add(k);
            stack.push([x + dx, y + dy]);
          }
        }
      }
      expect(seen.size, s.id).toBe(s.size);
      expect(Math.max(...s.cells.map((c) => c[0])) + 1).toBe(s.w);
      expect(Math.max(...s.cells.map((c) => c[1])) + 1).toBe(s.h);
      expect(Math.min(...s.cells.map((c) => c[0]))).toBe(0);
      expect(Math.min(...s.cells.map((c) => c[1]))).toBe(0);
    }
  });

  it('row masks match cells', () => {
    for (const s of SHAPES) {
      const rows = new Array(s.h).fill(0);
      for (const [x, y] of s.cells) rows[y] |= 1 << x;
      expect(s.rows).toEqual(rows);
    }
  });

  it('no two shapes are identical (no rotation duplicates)', () => {
    const sigs = SHAPES.map((s) => s.rows.join(','));
    expect(new Set(sigs).size).toBe(SHAPES.length);
  });

  it('lookup works', () => {
    expect(shapeById('o9').size).toBe(9);
    expect(hasShape('o9')).toBe(true);
    expect(hasShape('nope')).toBe(false);
    expect(() => shapeById('nope')).toThrow();
  });

  it('expected size is around 3.5-4.5 with base weights', () => {
    const e = expectedSize();
    expect(e).toBeGreaterThan(3.5);
    expect(e).toBeLessThan(4.5);
    expect(expectedSize(() => 1)).toBeGreaterThan(e - 1);
  });
});
