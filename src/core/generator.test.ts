import { describe, expect, it } from 'vitest';
import { BALANCE } from './config/balance';
import { BLIND, EMPTY, INK_COUNT, JAM, LEAD, idx, newCells, type Cells } from './board';
import {
  BIG_FORMAT_EXCLUDED,
  DEAL_BUDGET,
  dealTray,
  neverFitting,
  shapeWeight,
  type DealContext,
  type DealResult,
} from './generator';
import { SHAPES, shapeById, type Shape } from './pieces';
import { Rng } from './rng';

// ---------------------------------------------------------------------------
// Independent reference implementation (plain cell arrays, no bitboards).
// Rules (GDD §3.1, §5.1, §7): a line prints when all 8 cells are filled and none
// of them is a jam; under "rows only" columns never print; all printable lines
// clear simultaneously after each placement; jams never clear.
// ---------------------------------------------------------------------------

const N = 8;

function refFits(cells: readonly number[], shape: Shape, x: number, y: number): boolean {
  for (const [cx, cy] of shape.cells) {
    const px = x + cx;
    const py = y + cy;
    if (px < 0 || py < 0 || px >= N || py >= N) return false;
    if (cells[py * N + px] !== EMPTY) return false;
  }
  return true;
}

function refPrintable(cells: readonly number[], rowsOnly: boolean): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let y = 0; y < N; y++) {
    let ok = true;
    for (let x = 0; x < N; x++) {
      const v = cells[y * N + x];
      if (v === EMPTY || v === JAM) ok = false;
    }
    if (ok) rows.push(y);
  }
  if (!rowsOnly) {
    for (let x = 0; x < N; x++) {
      let ok = true;
      for (let y = 0; y < N; y++) {
        const v = cells[y * N + x];
        if (v === EMPTY || v === JAM) ok = false;
      }
      if (ok) cols.push(x);
    }
  }
  return { rows, cols };
}

function refClear(cells: number[], rowsOnly: boolean): void {
  const { rows, cols } = refPrintable(cells, rowsOnly);
  for (const y of rows) for (let x = 0; x < N; x++) cells[y * N + x] = EMPTY;
  for (const x of cols) for (let y = 0; y < N; y++) cells[y * N + x] = EMPTY;
}

function refPlace(cells: readonly number[], shape: Shape, x: number, y: number, rowsOnly: boolean): number[] {
  const next = cells.slice();
  for (const [cx, cy] of shape.cells) next[(y + cy) * N + (x + cx)] = 0;
  refClear(next, rowsOnly);
  return next;
}

function refCanEverFit(cells: readonly number[], shape: Shape): boolean {
  const onlyJams = cells.map((v) => (v === JAM ? JAM : EMPTY));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (refFits(onlyJams, shape, x, y)) return true;
  return false;
}

interface Step {
  shape: Shape;
  x: number;
  y: number;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((it, i) => {
    for (const rest of permutations(items.filter((_, j) => j !== i))) out.push([it, ...rest]);
  });
  return out;
}

/**
 * Naive brute force: every permutation of the tray × every position, with clears.
 * Returns a witness sequence or null. With `rng`, positions are tried in random order
 * (used to play out realistic games).
 */
function refSolve(
  cells: readonly number[],
  tray: readonly Shape[],
  rowsOnly: boolean,
  rng?: Rng,
): Step[] | null {
  const spots: Array<[number, number]> = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) spots.push([x, y]);
  const order = (): Array<[number, number]> => (rng ? rng.shuffle(spots.slice()) : spots);
  const dfs = (board: readonly number[], seq: readonly Shape[], k: number, path: Step[]): Step[] | null => {
    if (k === seq.length) return path;
    const shape = seq[k] as Shape;
    for (const [x, y] of order()) {
      if (!refFits(board, shape, x, y)) continue;
      const found = dfs(refPlace(board, shape, x, y, rowsOnly), seq, k + 1, [...path, { shape, x, y }]);
      if (found) return found;
    }
    return null;
  };
  const perms = permutations(tray);
  if (rng) rng.shuffle(perms);
  const tried = new Set<string>();
  for (const seq of perms) {
    const key = seq.map((s) => s.id).join(',');
    if (tried.has(key)) continue;
    tried.add(key);
    const found = dfs(cells, seq, 0, []);
    if (found) return found;
  }
  return null;
}

function applySteps(
  cells: readonly number[],
  steps: readonly Step[],
  inks: readonly number[],
  rowsOnly: boolean,
): number[] {
  let board = cells.slice();
  steps.forEach((st, i) => {
    expect(refFits(board, st.shape, st.x, st.y)).toBe(true);
    const next = board.slice();
    for (const [cx, cy] of st.shape.cells) next[(st.y + cy) * N + (st.x + cx)] = inks[i] ?? 0;
    refClear(next, rowsOnly);
    board = next;
  });
  return board;
}

// ---------------------------------------------------------------------------
// Random legal boards.
// ---------------------------------------------------------------------------

type Variant = 'plain' | 'jam' | 'jamAnywhere' | 'lead' | 'rowsOnly' | 'jamLead';
const VARIANTS: readonly Variant[] = ['plain', 'jam', 'jamAnywhere', 'lead', 'rowsOnly', 'jamLead'];

interface TestBoard {
  cells: Cells;
  rowsOnly: boolean;
  variant: Variant;
}

function placeJams(rng: Rng, cells: Cells, count: number, offRing: boolean): void {
  const pool = offRing ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6, 7];
  const rows = rng.shuffle(pool.slice());
  const cols = rng.shuffle(pool.slice());
  for (let k = 0; k < count; k++) cells[idx(cols[k] as number, rows[k] as number)] = JAM;
}

function placeIsolatedLead(rng: Rng, cells: Cells, target: number): void {
  let placed = 0;
  for (const i of rng.shuffle(Array.from({ length: 64 }, (_, k) => k))) {
    if (placed >= target) break;
    const x = i % N;
    const y = (i / N) | 0;
    if (cells[i] !== EMPTY) continue;
    const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1];
    if (nb.some((n) => n >= 0 && cells[n] !== EMPTY)) continue;
    cells[i] = LEAD;
    placed++;
  }
}

function randomFillValue(rng: Rng): number {
  const r = rng.next();
  if (r < 0.8) return rng.int(INK_COUNT);
  if (r < 0.9) return BLIND;
  return LEAD;
}

function legalize(cells: Cells, rowsOnly: boolean): void {
  refClear(cells, rowsOnly);
  const left = refPrintable(cells, rowsOnly);
  expect(left.rows.length + left.cols.length).toBe(0);
}

function randomBoard(rng: Rng, variant: Variant, density?: number): TestBoard {
  const cells = newCells();
  const rowsOnly = variant === 'rowsOnly' || (variant === 'plain' && rng.chance(0.15));
  if (variant === 'jam' || variant === 'jamLead') placeJams(rng, cells, 2 + rng.int(3), true);
  if (variant === 'jamAnywhere') placeJams(rng, cells, 1 + rng.int(6), false);
  if (variant === 'lead' || variant === 'jamLead') placeIsolatedLead(rng, cells, 8 + 2 * rng.int(3));
  const d = density ?? 0.15 + rng.next() * 0.8;
  for (let i = 0; i < 64; i++) if (cells[i] === EMPTY && rng.chance(d)) cells[i] = randomFillValue(rng);
  legalize(cells, rowsOnly);
  return { cells, rowsOnly, variant };
}

function randomContext(rng: Rng, board: TestBoard): DealContext {
  const inkWeights = Array.from({ length: INK_COUNT }, (): number => (rng.chance(0.2) ? 0 : 1 + rng.int(3)));
  if (!inkWeights.some((w) => w > 0)) inkWeights[rng.int(INK_COUNT)] = 1;
  return {
    cells: board.cells,
    count: 1 + rng.int(3),
    rng: Rng.fromSeed(`ctx|${rng.nextU32()}`),
    inkWeights,
    blindInk: rng.chance(0.25) ? rng.int(INK_COUNT) : null,
    bigFormat: rng.chance(0.2),
    rowsOnly: board.rowsOnly,
  };
}

/** Invariants every deal must satisfy. Returns the dealt shapes. */
function checkDeal(ctx: DealContext, res: DealResult): Shape[] {
  const count = Math.max(0, Math.min(3, ctx.count));
  expect(res.pieces.length).toBe(count);
  expect(res.nodes).toBeLessThanOrEqual(DEAL_BUDGET);
  if (res.fallback) expect(res.attempts).toBe(BALANCE.dealRetries);
  else if (count > 0) {
    expect(res.attempts).toBeGreaterThanOrEqual(1);
    expect(res.attempts).toBeLessThanOrEqual(BALANCE.dealRetries);
  }
  const never = neverFitting(ctx.cells);
  const shapes = res.pieces.map((p) => shapeById(p.shape));
  for (const p of res.pieces) {
    expect(never.has(p.shape)).toBe(false);
    if (ctx.bigFormat && !res.fallback) expect(BIG_FORMAT_EXCLUDED.has(p.shape)).toBe(false);
    if (ctx.blindInk === null) expect(p.ink).toBeLessThan(INK_COUNT);
    else expect(p.ink).not.toBe(ctx.blindInk);
    expect(p.ink >= 0 && p.ink <= BLIND).toBe(true);
    if (p.ink !== BLIND) expect(ctx.inkWeights[p.ink] as number).toBeGreaterThan(0);
    else expect(ctx.inkWeights[ctx.blindInk as number] as number).toBeGreaterThan(0);
  }
  return shapes;
}

// ---------------------------------------------------------------------------

describe('shapeWeight', () => {
  it('returns the base weight without modifiers', () => {
    for (const s of SHAPES) expect(shapeWeight(s, false, false)).toBe(s.weight);
  });

  it('large format removes dot and I2 and triples 5–9 cell shapes only', () => {
    expect([...BIG_FORMAT_EXCLUDED].sort()).toEqual(['dot', 'i2h', 'i2v']);
    expect(BALANCE.bigFormatFactor).toBe(3);
    for (const s of SHAPES) {
      const w = shapeWeight(s, true, false);
      if (BIG_FORMAT_EXCLUDED.has(s.id)) expect(w).toBe(0);
      else if (s.size >= 5) expect(w).toBeCloseTo(s.weight * 3, 12);
      else expect(w).toBe(s.weight);
    }
    expect(shapeWeight(shapeById('o9'), true, false)).toBeCloseTo(4.5, 12);
    expect(shapeWeight(shapeById('i5h'), true, false)).toBeCloseTo(4.5, 12);
    expect(shapeWeight(shapeById('i4h'), true, false)).toBe(2);
    expect(shapeWeight(shapeById('i3h'), true, false)).toBe(3);
  });

  it('small bias favours pieces of at most 3 cells', () => {
    for (const s of SHAPES) {
      const w = shapeWeight(s, false, true);
      if (s.size <= 3) expect(w).toBeCloseTo(s.weight * 3, 12);
      else expect(w).toBeCloseTo(s.weight * 0.35, 12);
    }
    expect(shapeWeight(shapeById('dot'), false, true)).toBeCloseTo(6, 12);
    expect(shapeWeight(shapeById('o4'), false, true)).toBeCloseTo(1.4, 12);
  });

  it('combines large format with small bias', () => {
    expect(shapeWeight(shapeById('dot'), true, true)).toBe(0);
    expect(shapeWeight(shapeById('i2v'), true, true)).toBe(0);
    expect(shapeWeight(shapeById('i3v'), true, true)).toBeCloseTo(9, 12);
    expect(shapeWeight(shapeById('o9'), true, true)).toBeCloseTo(1.5 * 3 * 0.35, 12);
    expect(shapeWeight(shapeById('t4u'), true, true)).toBeCloseTo(1.5 * 0.35, 12);
    // Every shape keeps a non-negative weight and something always stays drawable.
    for (const big of [false, true])
      for (const small of [false, true]) {
        const ws = SHAPES.map((s) => shapeWeight(s, big, small));
        expect(ws.every((w) => w >= 0)).toBe(true);
        expect(ws.some((w) => w > 0)).toBe(true);
      }
  });
});

describe('neverFitting', () => {
  it('is empty without jams, whatever else is on the forme', () => {
    expect(neverFitting(newCells()).size).toBe(0);
    const cells = newCells();
    for (let i = 0; i < 64; i++) if (i % 3 !== 0) cells[i] = i % 2 === 0 ? LEAD : BLIND;
    expect(neverFitting(cells).size).toBe(0);
  });

  it('a jam in every row of column 3 rules out exactly I5 horizontal', () => {
    const cells = newCells();
    for (let y = 0; y < N; y++) cells[idx(3, y)] = JAM;
    expect([...neverFitting(cells)]).toEqual(['i5h']);
  });

  it('four jams tiling the 3×3 windows rule out the 3×3 square only', () => {
    const cells = newCells();
    for (const [x, y] of [
      [2, 2],
      [5, 2],
      [2, 5],
      [5, 5],
    ] as const)
      cells[idx(x, y)] = JAM;
    expect([...neverFitting(cells)]).toEqual(['o9']);
  });

  it('ignores ink, blind and lead cells (only jams are permanent)', () => {
    const cells = newCells();
    for (let y = 0; y < N; y++) cells[idx(3, y)] = JAM;
    cells[idx(0, 0)] = LEAD;
    cells[idx(5, 5)] = 2;
    cells[idx(6, 6)] = BLIND;
    expect([...neverFitting(cells)]).toEqual(['i5h']);
  });

  it('matches a naive check on random jam layouts', () => {
    const rng = Rng.fromSeed('never-fitting');
    let nonEmpty = 0;
    for (let t = 0; t < 300; t++) {
      const cells = newCells();
      const n = 1 + rng.int(30);
      for (let k = 0; k < n; k++) cells[rng.int(64)] = JAM;
      if (rng.chance(0.5))
        for (let k = 0; k < 10; k++) if (cells[k * 6] === EMPTY) cells[k * 6] = rng.int(INK_COUNT);
      const never = neverFitting(cells);
      if (never.size > 0) nonEmpty++;
      for (const s of SHAPES) expect(never.has(s.id)).toBe(!refCanEverFit(cells, s));
    }
    expect(nonEmpty).toBeGreaterThan(30);
  });

  it('no GDD jam layout (≤ 4 rook-placed jams off the outer ring, §7) excludes any shape', () => {
    // Exhaustive: every set of 1–4 jams in rows/cols 1..6 with at most one per row and column.
    let layouts = 0;
    const rec = (row: number, usedCols: number, jams: Array<[number, number]>) => {
      if (jams.length > 0) {
        const cells = newCells();
        for (const [x, y] of jams) cells[idx(x, y)] = JAM;
        expect(neverFitting(cells).size).toBe(0);
        layouts++;
      }
      if (jams.length === 4) return;
      for (let y = row; y <= 6; y++)
        for (let x = 1; x <= 6; x++)
          if (!(usedCols & (1 << x))) rec(y + 1, usedCols | (1 << x), [...jams, [x, y]]);
    };
    rec(1, 0, []);
    expect(layouts).toBe(36 + 15 * 30 + 20 * 120 + 15 * 360);
  });

  it('dealTray never deals a shape that can never fit (including the fallback)', () => {
    const cells = newCells();
    for (let y = 0; y < N; y++) cells[idx(3, y)] = JAM;
    const rng = Rng.fromSeed('never-deal');
    let fallbacks = 0;
    for (let t = 0; t < 400; t++) {
      const board = cells.slice();
      // Random clutter around the jams (legal: the jams block every row and column 3).
      const d = rng.next() * 0.9;
      for (let i = 0; i < 64; i++) if (board[i] === EMPTY && rng.chance(d)) board[i] = rng.int(INK_COUNT);
      legalize(board, false);
      const ctx: DealContext = {
        cells: board,
        count: 3,
        rng: Rng.fromSeed(`never-deal|${t}`),
        inkWeights: [1, 1, 1, 1, 1],
        blindInk: null,
        bigFormat: false,
        rowsOnly: false,
      };
      const res = dealTray(ctx);
      if (res.fallback) fallbacks++;
      for (const p of res.pieces) expect(p.shape).not.toBe('i5h');
      expect(refSolve(board, checkDeal(ctx, res), false)).not.toBeNull();
    }
    expect(fallbacks).toBeGreaterThan(0);
  });
});

const baseCtx = (over: Partial<DealContext> = {}): DealContext => ({
  cells: newCells(),
  count: 3,
  rng: Rng.fromSeed('base'),
  inkWeights: [1, 1, 1, 1, 1],
  blindInk: null,
  bigFormat: false,
  rowsOnly: false,
  ...over,
});

describe('dealTray: contract', () => {
  it('respects count, clamped to 0..3', () => {
    for (const [count, expected] of [
      [-5, 0],
      [-1, 0],
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 3],
      [99, 3],
    ] as const) {
      const res = dealTray(baseCtx({ count, rng: Rng.fromSeed(`count|${count}`) }));
      expect(res.pieces.length).toBe(expected);
      if (expected === 0) expect(res).toEqual({ pieces: [], attempts: 0, fallback: false, nodes: 0 });
      else {
        // The empty forme accepts any three pieces on the first attempt.
        expect(res.fallback).toBe(false);
        expect(res.attempts).toBe(1);
      }
    }
  });

  it('throws unless inkWeights has exactly 5 entries', () => {
    for (const w of [[], [1, 1, 1, 1], [1, 1, 1, 1, 1, 1]]) {
      expect(() => dealTray(baseCtx({ inkWeights: w }))).toThrow(/inkWeights/);
    }
    expect(() => dealTray(baseCtx({ inkWeights: [1, 1, 1, 1, 1] }))).not.toThrow();
  });

  it('is deterministic: the same seed and board give the same deal', () => {
    const rng = Rng.fromSeed('determinism');
    let differ = 0;
    for (let t = 0; t < 120; t++) {
      const board = randomBoard(rng, VARIANTS[t % VARIANTS.length] as Variant);
      const ctx = randomContext(rng, board);
      const seed = `det|${t}`;
      const before = board.cells.slice();
      const a = dealTray({ ...ctx, rng: Rng.fromSeed(seed) });
      const b = dealTray({ ...ctx, rng: Rng.fromSeed(seed) });
      expect(b).toEqual(a);
      // The caller's board is never mutated.
      expect(board.cells).toEqual(before);
      const c = dealTray({ ...ctx, rng: Rng.fromSeed(`${seed}|other`) });
      if (JSON.stringify(c.pieces) !== JSON.stringify(a.pieces)) differ++;
    }
    expect(differ).toBeGreaterThan(100);
  });

  it('is deterministic through the constructive fallback too', () => {
    const cells = hardBoard();
    const ctx = baseCtx({ cells });
    const a = dealTray({ ...ctx, rng: Rng.fromSeed('fb-det') });
    const b = dealTray({ ...ctx, rng: Rng.fromSeed('fb-det') });
    expect(a.fallback).toBe(true);
    expect(b).toEqual(a);
  });
});

/**
 * Checkerboard forme: only dots fit and three dots never complete a line, so the only
 * solvable 3-tray is three dots — practically every deal ends in the constructive fallback.
 */
function hardBoard(): Cells {
  const cells = newCells().fill(1);
  // Checkerboard holes: 4 per line, none adjacent → only dots fit and three dots never complete a line.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x + y) % 2 === 0) cells[idx(x, y)] = EMPTY;
  legalize(cells, false);
  return cells;
}

describe('dealTray: constructive fallback', () => {
  it('kicks in after 12 failed attempts and stays placeable', () => {
    const cells = hardBoard();
    for (const bigFormat of [false, true]) {
      for (let t = 0; t < 20; t++) {
        const ctx = baseCtx({ cells, bigFormat, rng: Rng.fromSeed(`fb|${bigFormat}|${t}`) });
        const res = dealTray(ctx);
        expect(res.fallback).toBe(true);
        expect(res.attempts).toBe(BALANCE.dealRetries);
        const shapes = checkDeal(ctx, res);
        expect(refSolve(cells, shapes, false)).not.toBeNull();
        // Only dots fit on this forme: the fallback falls back to them even in large format.
        expect(shapes.every((s) => s.id === 'dot')).toBe(true);
      }
    }
  });

  it('prefers shapes allowed by large format when they fit', () => {
    // Leave one free 2×2 corner plus scattered single holes: o4 fits, but most trays do not.
    const cells = hardBoard();
    for (const [x, y] of [
      [6, 6],
      [7, 6],
      [6, 7],
      [7, 7],
    ] as const)
      cells[idx(x, y)] = EMPTY;
    legalize(cells, false);
    const rng = Rng.fromSeed('fb-big');
    let fallbacks = 0;
    for (let t = 0; t < 60; t++) {
      const ctx = baseCtx({
        cells,
        bigFormat: true,
        count: 1 + rng.int(3),
        rng: Rng.fromSeed(`fb-big|${t}`),
      });
      const res = dealTray(ctx);
      const shapes = checkDeal(ctx, res);
      expect(refSolve(cells, shapes, false)).not.toBeNull();
      if (res.fallback) {
        fallbacks++;
        // The first fallback piece is chosen while a large-format-allowed shape still fits.
        expect(BIG_FORMAT_EXCLUDED.has(shapes[0]!.id)).toBe(false);
      }
    }
    expect(fallbacks).toBeGreaterThan(0);
  });
});

/**
 * Free cells are isolated horizontal runs of ≤ 3 (no two free cells touch vertically), so a
 * one-piece tray is solvable exactly when the drawn shape is a dot, I2 or I3 horizontal.
 */
function slotBoard(): Cells {
  const art = [
    '...#####',
    '###.####',
    '#####...',
    '####.###',
    '...#####',
    '###.####',
    '#####...',
    '####.###',
  ];
  const cells = newCells();
  art.forEach((line, y) => {
    for (let x = 0; x < N; x++) if (line[x] === '#') cells[idx(x, y)] = 3;
  });
  legalize(cells, false);
  return cells;
}

describe('dealTray: retries and small bias (GDD §4 step 4)', () => {
  const hazards = (bigFormat: boolean, seed: string) => {
    const cells = slotBoard();
    const reached = new Array<number>(BALANCE.dealRetries + 2).fill(0);
    const accepted = new Array<number>(BALANCE.dealRetries + 2).fill(0);
    let fallbacks = 0;
    for (let t = 0; t < 4000; t++) {
      const ctx = baseCtx({ cells, count: 1, bigFormat, rng: Rng.fromSeed(`${seed}|${t}`) });
      const res = dealTray(ctx);
      const shapes = checkDeal(ctx, res);
      expect(refSolve(cells, shapes, false)).not.toBeNull();
      const last = res.fallback ? BALANCE.dealRetries : res.attempts;
      for (let a = 1; a <= last; a++) reached[a] = (reached[a] as number) + 1;
      if (res.fallback) fallbacks++;
      else accepted[res.attempts] = (accepted[res.attempts] as number) + 1;
    }
    const rate = (from: number, to: number) => {
      let acc = 0;
      let all = 0;
      for (let a = from; a <= to; a++) {
        acc += accepted[a] as number;
        all += reached[a] as number;
      }
      return acc / all;
    };
    return {
      early: rate(1, BALANCE.dealRetriesBeforeSmallBias),
      late: rate(BALANCE.dealRetriesBeforeSmallBias + 1, BALANCE.dealRetries),
      fallbacks,
    };
  };
  const expectedRate = (bigFormat: boolean, smallBias: boolean): number => {
    const cells = slotBoard();
    let fit = 0;
    let all = 0;
    for (const s of SHAPES) {
      const w = shapeWeight(s, bigFormat, smallBias);
      all += w;
      if (refSolve(cells, [s], false)) fit += w;
    }
    return fit / all;
  };

  it('the slot board only accepts dot / I2h / I3h', () => {
    const cells = slotBoard();
    const fitting = SHAPES.filter((s) => refSolve(cells, [s], false) !== null).map((s) => s.id);
    expect(fitting.sort()).toEqual(['dot', 'i2h', 'i3h']);
  });

  it('attempts 1–6 draw with base weights, attempts 7–12 favour ≤ 3-cell pieces', () => {
    expect(BALANCE.dealRetries).toBe(12);
    expect(BALANCE.dealRetriesBeforeSmallBias).toBe(6);
    const h = hazards(false, 'bias');
    expect(Math.abs(h.early - expectedRate(false, false))).toBeLessThan(0.015);
    expect(Math.abs(h.late - expectedRate(false, true))).toBeLessThan(0.03);
    expect(h.late).toBeGreaterThan(1.8 * h.early);
    expect(h.fallbacks).toBeGreaterThan(0);
  });

  it('large format keeps dot and I2 out even under the small bias, and in the fallback when I3 fits', () => {
    const h = hazards(true, 'bias-large');
    expect(Math.abs(h.early - expectedRate(true, false))).toBeLessThan(0.015);
    expect(Math.abs(h.late - expectedRate(true, true))).toBeLessThan(0.03);
    const cells = slotBoard();
    for (let t = 0; t < 200; t++) {
      const res = dealTray(
        baseCtx({ cells, count: 1, bigFormat: true, rng: Rng.fromSeed(`bias-large-fb|${t}`) }),
      );
      // Only I3h is both allowed and fitting, so every tray (proven or fallback) is an I3h.
      expect(res.pieces.map((p) => p.shape)).toEqual(['i3h']);
    }
  });
});

describe('dealTray: distributions', () => {
  const sizeShare = (
    bigFormat: boolean,
    trays: number,
    seed: string,
  ): { big: number; excluded: number; total: number } => {
    let big = 0;
    let excluded = 0;
    let total = 0;
    for (let t = 0; t < trays; t++) {
      const res = dealTray(baseCtx({ bigFormat, rng: Rng.fromSeed(`${seed}|${t}`) }));
      expect(res.attempts).toBe(1);
      for (const p of res.pieces) {
        total++;
        if (shapeById(p.shape).size >= 5) big++;
        if (BIG_FORMAT_EXCLUDED.has(p.shape)) excluded++;
      }
    }
    return { big, excluded, total };
  };
  const expectedBigShare = (bigFormat: boolean): number => {
    let all = 0;
    let big = 0;
    for (const s of SHAPES) {
      const w = shapeWeight(s, bigFormat, false);
      all += w;
      if (s.size >= 5) big += w;
    }
    return big / all;
  };

  it('large format excludes dot/I2 and boosts ≥ 5-cell shapes', () => {
    const plain = sizeShare(false, 2000, 'share-plain');
    const large = sizeShare(true, 2000, 'share-large');
    expect(large.excluded).toBe(0);
    expect(plain.excluded).toBeGreaterThan(0);
    const pShare = plain.big / plain.total;
    const lShare = large.big / large.total;
    expect(Math.abs(pShare - expectedBigShare(false))).toBeLessThan(0.02);
    expect(Math.abs(lShare - expectedBigShare(true))).toBeLessThan(0.02);
    expect(lShare).toBeGreaterThan(2 * pShare);
  });

  it('shape frequencies on an empty forme follow the base weights', () => {
    const counts = new Map<string, number>();
    let total = 0;
    for (let t = 0; t < 3000; t++) {
      for (const p of dealTray(baseCtx({ rng: Rng.fromSeed(`freq|${t}`) })).pieces) {
        counts.set(p.shape, (counts.get(p.shape) ?? 0) + 1);
        total++;
      }
    }
    const tw = SHAPES.reduce((a, s) => a + s.weight, 0);
    for (const s of SHAPES) {
      const expected = s.weight / tw;
      expect(Math.abs((counts.get(s.id) ?? 0) / total - expected)).toBeLessThan(0.012);
    }
  });

  it('ink weights bias the colours', () => {
    const counts = new Array<number>(BLIND + 1).fill(0);
    let total = 0;
    for (let t = 0; t < 2000; t++) {
      const res = dealTray(baseCtx({ inkWeights: [1, 1, 1, 1, 5], rng: Rng.fromSeed(`ink|${t}`) }));
      for (const p of res.pieces) {
        counts[p.ink] = (counts[p.ink] as number) + 1;
        total++;
      }
    }
    expect(counts[BLIND]).toBe(0);
    expect(Math.abs((counts[4] as number) / total - 5 / 9)).toBeLessThan(0.02);
    for (let i = 0; i < 4; i++) expect(Math.abs((counts[i] as number) / total - 1 / 9)).toBeLessThan(0.015);
  });

  it('a zero ink weight never comes out', () => {
    for (let t = 0; t < 300; t++) {
      const res = dealTray(baseCtx({ inkWeights: [0, 0, 1, 0, 0], rng: Rng.fromSeed(`ink0|${t}`) }));
      expect(res.pieces.every((p) => p.ink === 2)).toBe(true);
    }
  });

  it('blindInk turns that ink into blind emboss', () => {
    for (let t = 0; t < 200; t++) {
      const only = dealTray(
        baseCtx({ inkWeights: [0, 0, 1, 0, 0], blindInk: 2, rng: Rng.fromSeed(`blind|${t}`) }),
      );
      expect(only.pieces.every((p) => p.ink === BLIND)).toBe(true);
      const other = dealTray(
        baseCtx({ inkWeights: [0, 0, 1, 0, 0], blindInk: 3, rng: Rng.fromSeed(`blind|${t}`) }),
      );
      expect(other.pieces.every((p) => p.ink === 2)).toBe(true);
    }
    const counts = new Array<number>(BLIND + 1).fill(0);
    let total = 0;
    for (let t = 0; t < 2000; t++) {
      for (const p of dealTray(baseCtx({ blindInk: 1, rng: Rng.fromSeed(`blind-u|${t}`) })).pieces) {
        counts[p.ink] = (counts[p.ink] as number) + 1;
        total++;
      }
    }
    expect(counts[1]).toBe(0);
    expect(Math.abs((counts[BLIND] as number) / total - 0.2)).toBeLessThan(0.02);
  });

  it('blind ink does not change the shapes that are dealt', () => {
    for (let t = 0; t < 100; t++) {
      const a = dealTray(baseCtx({ rng: Rng.fromSeed(`bs|${t}`) }));
      const b = dealTray(baseCtx({ blindInk: t % 5, rng: Rng.fromSeed(`bs|${t}`) }));
      expect(b.pieces.map((p) => p.shape)).toEqual(a.pieces.map((p) => p.shape));
      b.pieces.forEach((p, i) => {
        const ink = a.pieces[i]!.ink;
        expect(p.ink).toBe(ink === t % 5 ? BLIND : ink);
      });
    }
  });
});

describe('dealTray: fair-tray guarantee (GDD §4)', () => {
  it(
    'every dealt tray on 3,000+ random legal boards is solvable by a naive brute force',
    { timeout: 60_000 },
    () => {
      const rng = Rng.fromSeed('fair-property');
      const byVariant = new Map<Variant, number>();
      let fallbacks = 0;
      let deals = 0;
      for (let t = 0; t < 3600; t++) {
        const variant = VARIANTS[t % VARIANTS.length] as Variant;
        const board = randomBoard(rng, variant);
        const ctx = randomContext(rng, board);
        const before = board.cells.slice();
        const res = dealTray(ctx);
        expect(board.cells).toEqual(before);
        const shapes = checkDeal(ctx, res);
        const witness = refSolve(board.cells, shapes, board.rowsOnly);
        if (witness === null) {
          throw new Error(
            `unplaceable ${res.fallback ? 'fallback' : 'proven'} tray ${shapes.map((s) => s.id).join(',')} ` +
              `rowsOnly=${board.rowsOnly} cells=${JSON.stringify(board.cells)}`,
          );
        }
        if (res.fallback) fallbacks++;
        deals++;
        byVariant.set(variant, (byVariant.get(variant) ?? 0) + 1);
      }
      console.info(
        `[generator] property: ${deals} random boards, ${fallbacks} fallback trays, all placeable`,
      );
      expect(deals).toBeGreaterThanOrEqual(3000);
      for (const v of VARIANTS) expect(byVariant.get(v)).toBeGreaterThanOrEqual(500);
      expect(fallbacks).toBeGreaterThan(0);
    },
  );
});

describe('dealTray: fairness at scale', () => {
  it(
    '10,000 deals from varied, played-out boards never produce an unplaceable tray',
    { timeout: 60_000 },
    () => {
      const rng = Rng.fromSeed('fair-scale');
      const hist = new Array<number>(BALANCE.dealRetries + 1).fill(0);
      const variantDeals = new Map<Variant, number>();
      let fallbacks = 0;
      let deals = 0;
      let totalNodes = 0;
      let maxNodes = 0;
      let board: TestBoard = { cells: newCells(), rowsOnly: false, variant: 'plain' };
      let contract = {
        trays: 0,
        limit: 0,
        traySize: 3,
        bigFormat: false,
        blindInk: null as number | null,
        inkWeights: [1, 1, 1, 1, 1],
      };
      const started = Date.now();
      while (deals < 10_000) {
        if (contract.trays >= contract.limit) {
          const variant = VARIANTS[rng.int(VARIANTS.length)] as Variant;
          // Half the "contracts" start from a fresh forme (modifier layout only), half mid-game.
          board = randomBoard(rng, variant, rng.chance(0.5) ? 0 : undefined);
          const inkWeights = [1, 1, 1, 1, 1];
          for (let k = rng.int(4); k > 0; k--) {
            const ink = rng.int(INK_COUNT);
            inkWeights[ink] = (inkWeights[ink] as number) + 1;
          }
          contract = {
            trays: 0,
            limit: 5 + rng.int(25),
            traySize: rng.chance(0.2) ? 2 : 3,
            bigFormat: rng.chance(0.2),
            blindInk: rng.chance(0.2) ? rng.int(INK_COUNT) : null,
            inkWeights,
          };
        }
        const ctx: DealContext = {
          cells: board.cells,
          count: rng.chance(0.1) ? 1 + rng.int(contract.traySize) : contract.traySize,
          rng: Rng.derive('fair-scale', 'tray', deals),
          inkWeights: contract.inkWeights,
          blindInk: contract.blindInk,
          bigFormat: contract.bigFormat,
          rowsOnly: board.rowsOnly,
        };
        const res = dealTray(ctx);
        const shapes = checkDeal(ctx, res);
        hist[res.attempts] = (hist[res.attempts] as number) + 1;
        if (res.fallback) fallbacks++;
        totalNodes += res.nodes;
        maxNodes = Math.max(maxNodes, res.nodes);
        // Play the tray out along a random witness, so boards evolve like real games.
        const witness = refSolve(board.cells, shapes, board.rowsOnly, rng);
        if (witness === null) {
          throw new Error(
            `unplaceable ${res.fallback ? 'fallback' : 'proven'} tray ${shapes.map((s) => s.id).join(',')} ` +
              `rowsOnly=${board.rowsOnly} cells=${JSON.stringify(board.cells)}`,
          );
        }
        board = {
          ...board,
          cells: applySteps(
            board.cells,
            witness,
            witness.map((st) => res.pieces[shapes.indexOf(st.shape)]?.ink ?? 0),
            board.rowsOnly,
          ),
        };
        variantDeals.set(board.variant, (variantDeals.get(board.variant) ?? 0) + 1);
        contract.trays++;
        deals++;
      }
      const ms = Date.now() - started;
      const histogram = Object.fromEntries(hist.map((n, a) => [a, n] as const).filter(([, n]) => n > 0));
      console.info(
        `[generator] ${deals} deals in ${ms.toFixed(0)} ms · attempts histogram ${JSON.stringify(histogram)} · ` +
          `fallback ${fallbacks} (${((100 * fallbacks) / deals).toFixed(2)}%) · nodes avg ${(totalNodes / deals).toFixed(1)} max ${maxNodes} · ` +
          `by variant ${JSON.stringify(Object.fromEntries(variantDeals))}`,
      );
      expect(deals).toBe(10_000);
      expect(hist[0]).toBe(0);
      expect(maxNodes).toBeLessThanOrEqual(DEAL_BUDGET);
      for (const v of VARIANTS) expect(variantDeals.get(v) ?? 0).toBeGreaterThan(500);
      // The vast majority of deals must be proven by the solver, not built by the fallback
      // (random play fragments the forme far more than real play, hence the loose bound).
      expect(fallbacks / deals).toBeLessThan(0.1);
      expect(ms).toBeLessThan(20_000);
    },
  );
});
