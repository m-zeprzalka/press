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
  SOLVE_BUDGET,
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
    const r = rowsFrom([
      '########',
      '#.......',
      '#.......',
      '#.......',
      '#.......',
      '#.......',
      '#.......',
      '#.......',
    ]);
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
    expect(isSolvable(r, [shapeById('i5v'), shapeById('i3v'), shapeById('o9')], { rowsOnly: true })).toBe(
      true,
    );
    // Every row blocked (jammed) → nothing ever prints → no room for the 3x3.
    expect(
      isSolvable(r, [shapeById('i5v'), shapeById('i3v'), shapeById('o9')], {
        blockedRows: 0xff,
        blockedCols: 0xff,
      }),
    ).toBe(false);
  });

  it('collects stats and memoises duplicates', () => {
    const stats: SolveStats = { nodes: 0 };
    const r = rowsFrom([
      '########',
      '########',
      '########',
      '########',
      '########',
      '###.....',
      '###.....',
      '###.....',
    ]);
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

// ---------------------------------------------------------------------------
// Independent reference model: a plain 64-cell grid of booleans plus a jam mask.
// No bitboard helper is used, so a bug in bitboard.ts cannot hide in the oracle.
// ---------------------------------------------------------------------------

interface RefBoard {
  filled: boolean[];
  jam: boolean[];
}

const refFromRows = (rows: Uint8Array, jams: ReadonlyArray<readonly [number, number]> = []): RefBoard => {
  const filled: boolean[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) filled.push(((rows[y] as number) >> x) % 2 === 1);
  const jam = new Array<boolean>(64).fill(false);
  for (const [x, y] of jams) {
    jam[y * 8 + x] = true;
    filled[y * 8 + x] = true;
  }
  return { filled, jam };
};

const refRowsOf = (b: RefBoard): number[] => {
  const out: number[] = [];
  for (let y = 0; y < 8; y++) {
    let v = 0;
    for (let x = 0; x < 8; x++) if (b.filled[y * 8 + x]) v += 2 ** x;
    out.push(v);
  }
  return out;
};

const refFitsAt = (b: RefBoard, s: Shape, x: number, y: number): boolean =>
  s.cells.every(([cx, cy]) => {
    const px = x + cx;
    const py = y + cy;
    return px >= 0 && py >= 0 && px < 8 && py < 8 && !b.filled[py * 8 + px];
  });

const refLines = (b: RefBoard, rowsOnly: boolean): { rows: number[]; cols: number[] } => {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let k = 0; k < 8; k++) {
    let rowOk = true;
    let colOk = true;
    for (let j = 0; j < 8; j++) {
      const r = k * 8 + j;
      const c = j * 8 + k;
      if (!b.filled[r] || b.jam[r]) rowOk = false;
      if (!b.filled[c] || b.jam[c]) colOk = false;
    }
    if (rowOk) rows.push(k);
    if (colOk && !rowsOnly) cols.push(k);
  }
  return { rows, cols };
};

const refClear = (b: RefBoard, rowsOnly: boolean): RefBoard => {
  const { rows, cols } = refLines(b, rowsOnly);
  const filled = b.filled.slice();
  for (const y of rows) for (let x = 0; x < 8; x++) filled[y * 8 + x] = false;
  for (const x of cols) for (let y = 0; y < 8; y++) filled[y * 8 + x] = false;
  return { filled, jam: b.jam };
};

const refPlace = (b: RefBoard, s: Shape, x: number, y: number, rowsOnly: boolean, clear = true): RefBoard => {
  const filled = b.filled.slice();
  for (const [cx, cy] of s.cells) filled[(y + cy) * 8 + (x + cx)] = true;
  const placed = { filled, jam: b.jam };
  return clear ? refClear(placed, rowsOnly) : placed;
};

const perms = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [items.slice()]
    : items.flatMap((it, i) => perms(items.filter((_, j) => j !== i)).map((p) => [it, ...p]));

/** Every permutation × every position, with (or without) clears between placements. */
const refSolvable = (b: RefBoard, shapes: readonly Shape[], rowsOnly: boolean, clears = true): boolean => {
  const dfs = (board: RefBoard, seq: readonly Shape[], k: number): boolean => {
    if (k === seq.length) return true;
    const s = seq[k] as Shape;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if (refFitsAt(board, s, x, y) && dfs(refPlace(board, s, x, y, rowsOnly, clears), seq, k + 1))
          return true;
    return false;
  };
  const seen = new Set<string>();
  for (const seq of perms(shapes)) {
    const key = seq.map((s) => s.id).join();
    if (seen.has(key)) continue;
    seen.add(key);
    if (dfs(b, seq, 0)) return true;
  }
  return false;
};

const rulesFor = (jams: ReadonlyArray<readonly [number, number]>, rowsOnly: boolean) => {
  let blockedRows = 0;
  let blockedCols = 0;
  for (const [x, y] of jams) {
    blockedRows |= 1 << y;
    blockedCols |= 1 << x;
  }
  return { rowsOnly, blockedRows, blockedCols };
};

interface Case {
  rows: Uint8Array;
  jams: Array<[number, number]>;
  rowsOnly: boolean;
}

/** Random legal board: random fill (+ optional rook-placed jams), then printable lines cleared. */
const randomCase = (rng: Rng, opts: { jams?: boolean; rowsOnly?: boolean; density?: number } = {}): Case => {
  const jams: Array<[number, number]> = [];
  if (opts.jams) {
    const rs = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
    const cs = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let k = 1 + rng.int(4); k > 0; k--) jams.push([cs[k] as number, rs[k] as number]);
  }
  const rowsOnly = opts.rowsOnly ?? false;
  const density = opts.density ?? 0.5 + rng.next() * 0.4;
  const b0 = refFromRows(emptyRows(), jams);
  for (let i = 0; i < 64; i++) if (!b0.jam[i] && rng.chance(density)) b0.filled[i] = true;
  const b = refClear(b0, rowsOnly);
  const left = refLines(b, rowsOnly);
  expect(left.rows.length + left.cols.length).toBe(0);
  return { rows: Uint8Array.from(refRowsOf(b)), jams, rowsOnly };
};

const checkerboard = (): Uint8Array => {
  const r = emptyRows();
  for (let y = 0; y < 8; y++) r[y] = y % 2 === 0 ? 0xaa : 0x55;
  return r;
};

describe('bitboard primitives vs reference model', () => {
  it('canPlace / positions / fits / countFilled agree with the reference on random boards', () => {
    const rng = Rng.fromSeed('prims');
    for (let t = 0; t < 200; t++) {
      const { rows } = randomCase(rng, { density: rng.next() });
      const ref = refFromRows(rows);
      expect(countFilled(rows)).toBe(ref.filled.filter(Boolean).length);
      for (const s of SHAPES) {
        const expected: number[] = [];
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) if (refFitsAt(ref, s, x, y)) expected.push(y * 8 + x);
        expect(positions(rows, s)).toEqual(expected);
        expect(fits(rows, s)).toBe(expected.length > 0);
        for (const [x, y] of [
          [-1, 0],
          [0, -1],
          [9 - s.w, 0],
          [0, 9 - s.h],
        ] as const)
          expect(canPlace(rows, s, x, y)).toBe(false);
      }
    }
  });

  it('fullLines + clearInto agree with the reference under jams and rows-only', () => {
    const rng = Rng.fromSeed('lines');
    let printed = 0;
    for (let t = 0; t < 400; t++) {
      const jams: Array<[number, number]> = [];
      for (let k = rng.int(3); k > 0; k--) jams.push([rng.int(8), rng.int(8)]);
      const ref0 = refFromRows(emptyRows(), jams);
      const density = 0.85 + rng.next() * 0.15;
      for (let i = 0; i < 64; i++) if (rng.chance(density)) ref0.filled[i] = true;
      const rowsOnly = rng.chance(0.3);
      const rows = Uint8Array.from(refRowsOf(ref0));
      const m = fullLines(rows, rulesFor(jams, rowsOnly));
      const lines = refLines(ref0, rowsOnly);
      expect(m.rowMask).toBe(lines.rows.reduce((a, y) => a | (1 << y), 0));
      expect(m.colMask).toBe(lines.cols.reduce((a, x) => a | (1 << x), 0));
      printed += lines.rows.length + lines.cols.length;
      const c = cloneRows(rows);
      clearInto(c, m);
      expect(Array.from(c)).toEqual(refRowsOf(refClear(ref0, rowsOnly)));
    }
    expect(printed).toBeGreaterThan(100);
  });

  it('placeAndClear agrees with the reference and returns the printed masks', () => {
    const rng = Rng.fromSeed('pac');
    let withClear = 0;
    for (let t = 0; t < 300; t++) {
      const c = randomCase(rng, {
        jams: rng.chance(0.5),
        rowsOnly: rng.chance(0.3),
        density: 0.7 + rng.next() * 0.25,
      });
      const ref = refFromRows(c.rows, c.jams);
      const rules = rulesFor(c.jams, c.rowsOnly);
      for (const s of SHAPES) {
        for (const p of positions(c.rows, s)) {
          const x = p % 8;
          const y = (p / 8) | 0;
          const next = cloneRows(c.rows);
          const masks = placeAndClear(next, s, x, y, rules);
          const placed = refPlace(ref, s, x, y, c.rowsOnly, false);
          const lines = refLines(placed, c.rowsOnly);
          expect(masks.rowMask).toBe(lines.rows.reduce((a, r) => a | (1 << r), 0));
          expect(masks.colMask).toBe(lines.cols.reduce((a, r) => a | (1 << r), 0));
          expect(Array.from(next)).toEqual(refRowsOf(refClear(placed, c.rowsOnly)));
          if (lines.rows.length + lines.cols.length > 0) withClear++;
        }
      }
    }
    expect(withClear).toBeGreaterThan(200);
  });
});

describe('isSolvable vs independent brute force', () => {
  it('matches on random legal boards with jams, rows-only and clears', { timeout: 60_000 }, () => {
    const rng = Rng.fromSeed('iso-brute');
    let unsolvable = 0;
    let needClears = 0;
    let jammed = 0;
    for (let t = 0; t < 600; t++) {
      const c = randomCase(rng, { jams: t % 2 === 0, rowsOnly: t % 3 === 0 });
      const ref = refFromRows(c.rows, c.jams);
      const tray = Array.from({ length: 1 + rng.int(3) }, () => rng.pick(SHAPES));
      const expected = refSolvable(ref, tray, c.rowsOnly);
      const stats: SolveStats = { nodes: 0 };
      const got = isSolvable(c.rows, tray, rulesFor(c.jams, c.rowsOnly), stats, 10_000_000);
      expect(stats.exhausted).toBeUndefined();
      if (got !== expected)
        throw new Error(
          `mismatch ${JSON.stringify({ rows: Array.from(c.rows), c, tray: tray.map((s) => s.id), expected })}`,
        );
      if (!expected) unsolvable++;
      else if (!refSolvable(ref, tray, c.rowsOnly, false)) needClears++;
      if (c.jams.length > 0) jammed++;
    }
    expect(unsolvable).toBeGreaterThan(50);
    expect(needClears).toBeGreaterThan(15);
    expect(jammed).toBe(300);
  });

  it('matches with duplicated shapes (memo + duplicate skipping)', () => {
    const rng = Rng.fromSeed('iso-dupes');
    let unsolvable = 0;
    for (let t = 0; t < 300; t++) {
      const c = randomCase(rng, { jams: t % 3 === 0, rowsOnly: t % 4 === 0 });
      const a = rng.pick(SHAPES);
      const b = rng.pick(SHAPES);
      const tray = t % 2 === 0 ? [a, a, a] : [a, b, a];
      const expected = refSolvable(refFromRows(c.rows, c.jams), tray, c.rowsOnly);
      expect(isSolvable(c.rows, tray, rulesFor(c.jams, c.rowsOnly), undefined, 10_000_000)).toBe(expected);
      if (!expected) unsolvable++;
    }
    expect(unsolvable).toBeGreaterThan(20);
  });

  it('three identical squares that need a clear in between', () => {
    // Rows 0-1 are full except a 2×2 hole at columns 6-7; rows 2-7 are a checkerboard (no 2×2 hole).
    // The first o4 completes rows 0-1, they print, and the next two squares fit in the freed rows.
    const r = rowsFrom([
      '######..',
      '######..',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
    ]);
    const tray = [shapeById('o4'), shapeById('o4'), shapeById('o4')];
    expect(refSolvable(refFromRows(r), tray, false)).toBe(true);
    expect(refSolvable(refFromRows(r), tray, false, false)).toBe(false);
    expect(isSolvable(r, tray)).toBe(true);
    expect(isSolvable(r, tray, { rowsOnly: true })).toBe(true);
    // Jams in rows 0 and 1 (cells (0,0) and (1,1)) stop those rows from printing → only one square fits.
    const jams: Array<[number, number]> = [
      [0, 0],
      [1, 1],
    ];
    expect(refSolvable(refFromRows(r, jams), tray, false)).toBe(false);
    expect(isSolvable(r, tray, rulesFor(jams, false))).toBe(false);
    // A single square still fits; a second one would need the (now impossible) clear.
    expect(isSolvable(r, tray.slice(0, 1), rulesFor(jams, false))).toBe(true);
    expect(refSolvable(refFromRows(r, jams), tray.slice(0, 2), false)).toBe(false);
    expect(isSolvable(r, tray.slice(0, 2), rulesFor(jams, false))).toBe(false);
  });

  it('matches for trays of 4–5 pieces (memo key must not collide)', () => {
    // Regression: the failure memo packed rows 4-7 as `half * 8 + remaining`, which only has room
    // for 3 pieces; with a 4th piece two different states shared a key and solvable trays were rejected.
    const rows = Uint8Array.from([255, 255, 255, 255, 214, 46, 206, 106]);
    const jams: Array<[number, number]> = [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ];
    const tray = ['dot', 'i3h', 'o4', 'dot'].map(shapeById);
    expect(refSolvable(refFromRows(rows, jams), tray, false)).toBe(true);
    expect(isSolvable(rows, tray, rulesFor(jams, false), undefined, 10_000_000)).toBe(true);

    const rng = Rng.fromSeed('iso-4plus');
    const small = SHAPES.filter((s) => s.size <= 3);
    let mismatches = 0;
    for (let t = 0; t < 1500; t++) {
      // Jams in the top four rows keep those rows unprintable, so the search concentrates in rows 4-7.
      const cols = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
      const js: Array<[number, number]> = [0, 1, 2, 3].map((y) => [cols[y] as number, y]);
      const b0 = refFromRows(emptyRows(), js);
      for (let i = 0; i < 32; i++) b0.filled[i] = true;
      const density = 0.4 + rng.next() * 0.5;
      for (let i = 32; i < 64; i++) if (rng.chance(density)) b0.filled[i] = true;
      const b = refClear(b0, false);
      const r = Uint8Array.from(refRowsOf(b));
      const dot = shapeById('dot');
      const tr = [
        rng.chance(0.6) ? dot : rng.pick(small),
        rng.pick(small),
        rng.pick(SHAPES),
        rng.chance(0.6) ? dot : rng.pick(small),
      ];
      if (t % 3 === 0) tr.push(rng.pick(small));
      const expected = refSolvable(b, tr, false);
      if (isSolvable(r, tr, rulesFor(js, false), undefined, 10_000_000) !== expected) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('isSolvable internals', () => {
  // Filled 7×7 block in the top-left: only column 7 and row 7 are free.
  const block = (): Uint8Array =>
    rowsFrom([
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '#######.',
      '........',
    ]);

  it('budget exhaustion returns false and flags stats.exhausted', () => {
    // A solvable tray whose proof needs a few hundred DFS nodes (found by search, seed "budget").
    const rows = Uint8Array.from([224, 11, 38, 48, 98, 5, 119, 127]);
    const tray = ['i2v', 'dot', 'o9'].map(shapeById);
    expect(refSolvable(refFromRows(rows), tray, false)).toBe(true);
    const full: SolveStats = { nodes: 0 };
    expect(isSolvable(rows, tray, {}, full)).toBe(true);
    expect(full.exhausted).toBeUndefined();
    expect(full.nodes).toBeGreaterThan(100);
    for (const budget of [0, 1, 2, 10, 100, full.nodes - 1]) {
      const s: SolveStats = { nodes: 0 };
      expect(isSolvable(rows, tray, {}, s, budget)).toBe(false);
      expect(s.exhausted).toBe(true);
      expect(s.nodes).toBeLessThanOrEqual(Math.max(1, budget));
    }
    const exact: SolveStats = { nodes: 0 };
    expect(isSolvable(rows, tray, {}, exact, full.nodes + 1)).toBe(true);
    expect(exact.exhausted).toBeUndefined();

    // An unsolvable tray: a small budget is "unproven", the default budget proves the "no".
    const hard = Uint8Array.from([7, 39, 49, 38, 23, 49, 23, 51]);
    const hardTray = ['o9', 'dot', 'dot'].map(shapeById);
    expect(refSolvable(refFromRows(hard), hardTray, false)).toBe(false);
    const small: SolveStats = { nodes: 0 };
    expect(isSolvable(hard, hardTray, {}, small, 50)).toBe(false);
    expect(small.exhausted).toBe(true);
    const proven: SolveStats = { nodes: 0 };
    expect(isSolvable(hard, hardTray, {}, proven)).toBe(false);
    expect(proven.exhausted).toBeUndefined();
    expect(proven.nodes).toBeGreaterThan(50);
    expect(proven.nodes).toBeLessThan(SOLVE_BUDGET);
  });

  it('stats accumulate across calls (one stats object per deal)', () => {
    const stats: SolveStats = { nodes: 0 };
    isSolvable(block(), [shapeById('o9'), shapeById('i5v')], {}, stats);
    const first = stats.nodes;
    expect(first).toBeGreaterThan(1);
    isSolvable(block(), [shapeById('o9'), shapeById('i5v')], {}, stats);
    expect(stats.nodes).toBe(2 * first);
  });

  it('fast-accepts trays that fit on disjoint free cells (one node)', () => {
    const s1: SolveStats = { nodes: 0 };
    expect(isSolvable(emptyRows(), [shapeById('o9'), shapeById('o9'), shapeById('o9')], {}, s1)).toBe(true);
    expect(s1.nodes).toBe(1);
    // Disjoint fit works whatever the clear rules are (it never relies on a clear).
    const r = block();
    const s2: SolveStats = { nodes: 0 };
    const tray = [shapeById('i5v'), shapeById('i3h'), shapeById('i2h')];
    expect(isSolvable(r, tray, { rowsOnly: true, blockedRows: 0xff, blockedCols: 0xff }, s2)).toBe(true);
    expect(s2.nodes).toBe(1);
    // Whenever the fast path answers (n ≥ 2, one node, true), a clear-free placement really exists.
    const rng = Rng.fromSeed('disjoint');
    let fast = 0;
    for (let t = 0; t < 300; t++) {
      const c = randomCase(rng, { density: 0.3 + rng.next() * 0.5 });
      const trayN = [rng.pick(SHAPES), rng.pick(SHAPES), rng.pick(SHAPES)];
      const st: SolveStats = { nodes: 0 };
      if (isSolvable(c.rows, trayN, {}, st) && st.nodes === 1) {
        fast++;
        expect(refSolvable(refFromRows(c.rows), trayN, false, false)).toBe(true);
      }
    }
    expect(fast).toBeGreaterThan(100);
  });

  it('prunes when a blocked piece can never be unlocked by a clear', () => {
    // Checkerboard: 4 holes per line, none adjacent. Only dots fit; two dots cannot complete a line.
    const stats: SolveStats = { nodes: 0 };
    const tray = [shapeById('o9'), shapeById('dot'), shapeById('dot')];
    expect(isSolvable(checkerboard(), tray, {}, stats)).toBe(false);
    expect(stats.nodes).toBe(1);
    expect(stats.exhausted).toBeUndefined();
    expect(refSolvable(refFromRows(checkerboard()), tray, false)).toBe(false);
  });

  it('prune only counts printable lines (jammed lines never unlock anything)', () => {
    // Checkerboard with row 7 almost full: one hole at (7,7).
    const r = checkerboard();
    r[7] = 0x7f;
    const tray = [shapeById('o9'), shapeById('dot')];
    // Printable row 7: the dot could complete it, so no prune at the root (still false: one row is not enough).
    const open: SolveStats = { nodes: 0 };
    expect(isSolvable(r, tray, {}, open)).toBe(false);
    expect(open.nodes).toBeGreaterThan(1);
    // Jam in row 7 → that row can never print → pruned immediately.
    const jammed: SolveStats = { nodes: 0 };
    expect(isSolvable(r, tray, { blockedRows: 1 << 7, blockedCols: 1 }, jammed)).toBe(false);
    expect(jammed.nodes).toBe(1);
    expect(refSolvable(refFromRows(r, [[0, 7]]), tray, false)).toBe(false);
    expect(refSolvable(refFromRows(r), tray, false)).toBe(false);
  });

  it('does not prune when the fitting pieces can complete a line', () => {
    // Rows 5-7 have a single hole in column 7; rows 0-4 are a checkerboard.
    const r = checkerboard();
    r[5] = 0x7f;
    r[6] = 0x7f;
    r[7] = 0x7f;
    const ref = refFromRows(r);
    // i3v fills column 7 of rows 5-7 → three rows print → the 3×3 fits there.
    expect(refSolvable(ref, [shapeById('o9'), shapeById('i3v')], false)).toBe(true);
    expect(isSolvable(r, [shapeById('o9'), shapeById('i3v')])).toBe(true);
    // One dot clears only one row: not enough.
    expect(refSolvable(ref, [shapeById('o9'), shapeById('dot')], false)).toBe(false);
    expect(isSolvable(r, [shapeById('o9'), shapeById('dot')])).toBe(false);
  });

  it('rows-only: a column completion does not print', () => {
    const r = block();
    // i5h in row 7 completes columns 0-4 (they print and free a 5-wide strip for the 3×3)…
    const tray = [shapeById('o9'), shapeById('i5h')];
    expect(isSolvable(r, tray)).toBe(true);
    expect(refSolvable(refFromRows(r), tray, false)).toBe(true);
    // …but under rows-only nothing prints and there is no 3×3 hole.
    expect(isSolvable(r, tray, { rowsOnly: true })).toBe(false);
    expect(refSolvable(refFromRows(r), tray, true)).toBe(false);
    // The vertical version still works under rows-only (it completes rows).
    expect(isSolvable(r, [shapeById('o9'), shapeById('i5v')], { rowsOnly: true })).toBe(true);
  });

  it('blocked rows / columns (jams) never print', () => {
    const r = block();
    const viaCols = [shapeById('o9'), shapeById('i5h')];
    const viaRows = [shapeById('o9'), shapeById('i5v')];
    // [jams (cells of the filled block), tray, expected]
    const cases: Array<[Array<[number, number]>, Shape[], boolean]> = [
      // i5h in row 7 completes 4-5 columns; jamming column 0 still leaves 3+ adjacent printable columns.
      [[[0, 0]], viaCols, true],
      // Jams in columns 2 and 5 split every printable run into strips at most 2 wide.
      [
        [
          [2, 0],
          [5, 1],
        ],
        viaCols,
        false,
      ],
      // Transposed: jams in rows 2 and 5 break the vertical I5's row clears the same way.
      [[[0, 0]], viaRows, true],
      [
        [
          [0, 2],
          [1, 5],
        ],
        viaRows,
        false,
      ],
      // Jams in rows do not stop columns from printing, and vice versa.
      [
        [
          [0, 2],
          [1, 5],
        ],
        viaCols,
        true,
      ],
      [
        [
          [2, 0],
          [5, 1],
        ],
        viaRows,
        true,
      ],
    ];
    for (const [jams, tray, expected] of cases) {
      expect(refSolvable(refFromRows(r, jams), tray, false)).toBe(expected);
      expect(isSolvable(r, tray, rulesFor(jams, false))).toBe(expected);
    }
    // With every line blocked nothing ever prints.
    expect(isSolvable(r, viaCols, { blockedRows: 0xff, blockedCols: 0xff })).toBe(false);
    expect(isSolvable(r, viaRows, { blockedRows: 0xff, blockedCols: 0xff })).toBe(false);
  });

  it('supports up to 8 shapes and rejects more', () => {
    const dots = (k: number) => Array.from({ length: k }, () => shapeById('dot'));
    const i2h = shapeById('i2h');
    const cb = refFromRows(checkerboard());
    expect(isSolvable(emptyRows(), dots(8))).toBe(true);
    // Checkerboard: 4 holes per line. Three dots cannot complete a line, four can (then I2 fits).
    expect(refSolvable(cb, [...dots(3), i2h], false)).toBe(false);
    expect(isSolvable(checkerboard(), [...dots(3), i2h])).toBe(false);
    expect(refSolvable(cb, [...dots(4), i2h, i2h], false)).toBe(true);
    expect(isSolvable(checkerboard(), [...dots(4), i2h, i2h])).toBe(true);
    expect(isSolvable(checkerboard(), [i2h, ...dots(4), i2h, shapeById('dot'), shapeById('dot')])).toBe(true);
    expect(() => isSolvable(emptyRows(), dots(9))).toThrow(RangeError);
  });

  it('never mutates the input rows or the tray', () => {
    const cases: Array<[Uint8Array, Shape[]]> = [
      [emptyRows(), [shapeById('o9'), shapeById('dot'), shapeById('i5h')]],
      [block(), [shapeById('o9'), shapeById('i5v')]],
      [block(), [shapeById('o9'), shapeById('dot')]],
      [checkerboard(), [shapeById('o9'), shapeById('dot'), shapeById('dot')]],
      [Uint8Array.from([255, 255, 255, 255, 214, 46, 206, 106]), ['dot', 'i3h', 'o4', 'dot'].map(shapeById)],
    ];
    for (const [rows, tray] of cases) {
      for (const budget of [1, 50, 4000]) {
        const before = Array.from(rows);
        const trayBefore = tray.map((s) => s.id);
        isSolvable(rows, tray, { blockedRows: 0b1111, blockedCols: 0b11110 }, { nodes: 0 }, budget);
        isSolvable(rows, tray, {}, undefined, budget);
        expect(Array.from(rows)).toEqual(before);
        expect(tray.map((s) => s.id)).toEqual(trayBefore);
      }
    }
  });
});
