import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, SHAPES, expectedSize, hasShape, shapeById } from './pieces';

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
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
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

describe('piece catalogue vs GDD §3.2', () => {
  type Cell = readonly [number, number];
  /** Canonical signature of a cell set (normalised to the top-left corner). */
  const sig = (cells: readonly Cell[]): string => {
    const minX = Math.min(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    return cells
      .map(([x, y]) => [x - minX, y - minY] as const)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .map(([x, y]) => `${x},${y}`)
      .join(';');
  };
  const rotate = (cells: readonly Cell[]): Cell[] => cells.map(([x, y]) => [-y, x] as const);
  const mirror = (cells: readonly Cell[]): Cell[] => cells.map(([x, y]) => [-x, y] as const);

  it('has 37 shapes (orientations counted separately), board 8×8', () => {
    expect(BOARD_SIZE).toBe(8);
    expect(SHAPES).toHaveLength(37);
  });

  it('size histogram: 1×1, 2×2, 6×3, 19×4, 6×5, 2×6, 1×9', () => {
    const hist: Record<number, number> = {};
    for (const s of SHAPES) hist[s.size] = (hist[s.size] ?? 0) + 1;
    expect(hist).toEqual({ 1: 1, 2: 2, 3: 6, 4: 19, 5: 6, 6: 2, 9: 1 });
  });

  it('family sizes: dot, lines I2–I5, L3, O4/O9, T, L/J, S/Z, V5, rect', () => {
    const fam: Record<string, string[]> = {};
    for (const s of SHAPES) (fam[s.family] ??= []).push(s.id);
    expect(Object.fromEntries(Object.entries(fam).map(([k, v]) => [k, v.length]))).toEqual({
      dot: 1,
      line: 8,
      corner: 4,
      square: 2,
      t: 4,
      l: 8,
      skew: 4,
      bigcorner: 4,
      rect: 2,
    });
    for (const id of fam.line ?? []) {
      const s = shapeById(id);
      expect(s.w === 1 || s.h === 1).toBe(true);
    }
    expect(shapeById('o4').size).toBe(4);
    expect(shapeById('o9').w).toBe(3);
    expect(shapeById('r6h').w).toBe(3);
    expect(shapeById('r6h').h).toBe(2);
    expect(shapeById('r6v').w).toBe(2);
    expect(shapeById('r6v').h).toBe(3);
  });

  it('every orientation is present: the catalogue is closed under rotation and mirroring', () => {
    const all = new Set(SHAPES.map((s) => sig(s.cells)));
    for (const s of SHAPES) {
      let cur: Cell[] = [...s.cells];
      for (let r = 0; r < 4; r++) {
        cur = rotate(cur);
        expect(all.has(sig(cur)), `${s.id} rotated ${r + 1}×90°`).toBe(true);
        expect(all.has(sig(mirror(cur))), `${s.id} mirrored`).toBe(true);
      }
    }
  });

  it('each family is one free polyomino (all members are rotations/mirrors of each other) except lines/squares', () => {
    const orbit = (cells: readonly Cell[]): Set<string> => {
      const out = new Set<string>();
      let cur: Cell[] = [...cells];
      for (let r = 0; r < 4; r++) {
        cur = rotate(cur);
        out.add(sig(cur));
        out.add(sig(mirror(cur)));
      }
      return out;
    };
    for (const fam of ['corner', 't', 'l', 'skew', 'bigcorner', 'rect']) {
      const members = SHAPES.filter((s) => s.family === fam);
      const o = orbit(members[0]!.cells);
      expect(o.size, fam).toBe(members.length);
      for (const m of members) expect(o.has(sig(m.cells)), `${fam}: ${m.id}`).toBe(true);
    }
  });

  it('every shape fits the forme and a 5×5 tray preview', () => {
    for (const s of SHAPES) {
      expect(s.w).toBeLessThanOrEqual(5);
      expect(s.h).toBeLessThanOrEqual(5);
      expect(s.w).toBeLessThanOrEqual(BOARD_SIZE);
      expect(s.h).toBeLessThanOrEqual(BOARD_SIZE);
      expect(s.rows).toHaveLength(s.h);
    }
  });

  it('average size ≈ 3.8 cells with base weights (GDD §3.2)', () => {
    expect(expectedSize()).toBeCloseTo(3.8, 1);
  });

  it('expectedSize is the weighted mean of sizes', () => {
    const uniform = SHAPES.reduce((a, s) => a + s.size, 0) / SHAPES.length;
    expect(expectedSize(() => 1)).toBeCloseTo(uniform, 12);
    expect(expectedSize((s) => (s.id === 'o9' ? 1 : 0))).toBe(9);
    expect(expectedSize((s) => (s.size >= 5 ? s.weight : 0))).toBeGreaterThanOrEqual(5);
  });
});
