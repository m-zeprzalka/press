/**
 * Scoring (GDD §5) — hand-computed fixtures, Mirror rules (§8.3), phase rules (§5.4)
 * and the fold(events) = result invariant (§5.5).
 *
 * Every fixture's numbers below were computed by hand from the GDD, not by running
 * the code: P = Σ cell prints (+10 per ink cell per line, + plate per-cell/per-line
 * prints, line ×), M = L + max(0, SERIA−1) + 2·mono, then print hooks in rack order.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from './config/balance';
import {
  BLIND,
  EMPTY,
  JAM,
  LEAD,
  findFullLines,
  idx,
  isInk,
  lineCells,
  newCells,
  type Cells,
  type FullLines,
} from './board';
import { ipow } from './math';
import {
  MATRICES,
  MATRIX_IDS,
  MX,
  createInstance,
  matrixDef,
  type CellCtx,
  type LineCtx,
  type MatrixId,
  type MatrixState,
  type PrintCtx,
  type ScoreApi,
} from './matrices';
import { Rng } from './rng';
import {
  buildPrintCtx,
  cellBasePrints,
  lineInfo,
  lineRefs,
  resolveSlot,
  scorePrint,
  type PrintInput,
  type PrintResult,
  type ScoreEvent,
  type SlotInput,
} from './scoring';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** '.' empty · p o y t b = inks 0..4 · x blind · l lead · j jam. */
const CH: Record<string, number> = { '.': EMPTY, p: 0, o: 1, y: 2, t: 3, b: 4, x: BLIND, l: LEAD, j: JAM };

function board(rows: readonly string[]): Cells {
  if (rows.length !== 8) throw new Error('board needs 8 rows');
  const c = newCells();
  rows.forEach((r, y) => {
    if (r.length !== 8) throw new Error(`row ${y} needs 8 cells: "${r}"`);
    for (let x = 0; x < 8; x++) {
      const v = CH[r[x] as string];
      if (v === undefined) throw new Error(`bad cell char "${r[x]}"`);
      c[idx(x, y)] = v;
    }
  });
  return c;
}

type PlateSpec = MatrixId | { id: MatrixId; state?: MatrixState; enabled?: boolean };

function rack(specs: readonly PlateSpec[]): SlotInput[] {
  return specs.map((s, i) => {
    const o = typeof s === 'string' ? { id: s } : s;
    const inst = createInstance(o.id, i + 1);
    if (o.state) inst.state = { ...inst.state, ...o.state };
    return { inst, enabled: o.enabled ?? true };
  });
}

/** Random stub that fails loudly when a plate other than Golden Type draws. */
const noRandom = (): number => {
  throw new Error('unexpected random draw');
};

function rolls(values: readonly number[]): { fn: () => number; used: () => number } {
  let k = 0;
  return {
    fn: () => {
      if (k >= values.length) throw new Error(`random exhausted after ${k} draws`);
      return values[k++] as number;
    },
    used: () => k,
  };
}

interface Env {
  streak: number;
  pieceSize?: number;
  sheetsUsed?: number;
  sheetsLeft?: number;
  printIndex?: number;
  slotCapacity?: number;
  random?: () => number;
  rowsOnly?: boolean;
}

function makeInput(b: readonly string[], plates: readonly PlateSpec[], env: Env): PrintInput {
  const cells = board(b);
  const lines = findFullLines(cells, env.rowsOnly ?? false);
  return {
    cells,
    lines,
    pieceSize: env.pieceSize ?? 4,
    streak: env.streak,
    sheetsLeft: env.sheetsLeft ?? 10,
    sheetsUsed: env.sheetsUsed ?? 10,
    printIndex: env.printIndex ?? 0,
    slots: rack(plates),
    slotCapacity: env.slotCapacity ?? BALANCE.slots,
    random: env.random ?? noRandom,
  };
}

function score(b: readonly string[], plates: readonly PlateSpec[], env: Env): PrintResult {
  return scorePrint(makeInput(b, plates, env));
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

const E = '........';

/** Row 0 (edge): p p o y t b p p → 4 pinks, 5 distinct inks. */
const ROW0_MIXED = ['ppoytbpp', E, E, E, E, E, E, E];
/** Row 3 all teal (monochrome, not an edge). */
const ROW3_MONO = [E, E, E, 'tttttttt', E, E, E, E];
/** Row 4: 6 pinks + blind (x=2) + lead (x=5). */
const ROW4_BLIND_LEAD = [E, E, E, E, 'ppxpplpp', E, E, E];
/** Row 4: 7 pinks + one blind → not monochrome. */
const ROW4_PINK_BLIND = [E, E, E, E, 'ppppxppp', E, E, E];
/** Row 4: 7 teal + one lead → not monochrome. */
const ROW4_TEAL_LEAD = [E, E, E, E, 'tttltttt', E, E, E];
/** Rows 0 (edge) and 1, mixed. Pinks: row0 x0,x5; row1 x4. */
const TWO_ROWS = ['poytbpoy', 'oytbpoyt', E, E, E, E, E, E];
/** Rows 0 (edge) and 3 (inner), mixed. */
const ROWS_0_3 = ['poytbpoy', E, E, 'oytbpoyt', E, E, E, E];
/** Rows 5, 6, 7 (7 = edge), mixed. */
const THREE_ROWS = [E, E, E, E, E, 'poytbpoy', 'oytbpoyt', 'ytbpoytb'];
/** Two monochrome rows (pink, blue) + one mixed row. Pinks: 8 + 2 = 10. */
const MONO_MIX3 = ['pppppppp', 'bbbbbbbb', 'poytbpoy', E, E, E, E, E];
/** Three monochrome rows. */
const MONO3 = ['pppppppp', 'oooooooo', 'yyyyyyyy', E, E, E, E, E];
/** Row 2 and column 5, all teal (two mono lines crossing at x=5,y=2). */
const CROSS_MONO = [
  '.....t..',
  '.....t..',
  'tttttttt',
  '.....t..',
  '.....t..',
  '.....t..',
  '.....t..',
  '.....t..',
];
/**
 * Row 6 (t b o p o y y b — 5 inks, 1 pink at the intersection x=3) and
 * column 3 (p p o p y p p t top→bottom — 4 inks, 5 pinks incl. the intersection).
 */
const CROSS_MIXED = [
  '...p....',
  '...p....',
  '...o....',
  '...p....',
  '...y....',
  '...p....',
  'tbopoyyb',
  '...t....',
];
/** CROSS_MIXED + a jam at (0,0): after the print only the rivet is left. */
const CROSS_MIXED_JAM = ['j..p....', ...CROSS_MIXED.slice(1)];
/** CROSS_MIXED + a lead cell at (7,0) that survives the print. */
const CROSS_MIXED_LEAD = ['...p...l', ...CROSS_MIXED.slice(1)];
/**
 * Rows 0,1 and columns 0,1: 4 lines, 4 intersections, every line has 5 inks,
 * edges = row 0 and col 0. Pink visits: row0 2, row1 1, col0 3, col1 2 = 8.
 */
const FOUR_LINES = [
  'poytbpoy',
  'oytbpoyt',
  'pb......',
  'yt......',
  'bp......',
  'to......',
  'op......',
  'py......',
];
/** Row 4 with exactly two inks / exactly three inks. */
const ROW_2_INKS = [E, E, E, E, 'ppppbbbb', E, E, E];
const ROW_3_INKS = [E, E, E, E, 'pppobbbb', E, E, E];

// ---------------------------------------------------------------------------
// Fixtures (hand-computed)
// ---------------------------------------------------------------------------

interface Fixture {
  name: string;
  board: readonly string[];
  rows: number[];
  cols: number[];
  plates: PlateSpec[];
  env: Env;
  prints: number;
  mult: number;
  total: number;
}

// One fixture per line keeps the hand-computed table scannable.
// prettier-ignore
const FIXTURES: Fixture[] = [
  // ---- base rules (§5.2–§5.4) ----
  // 8 ink cells × 10 = 80; M = 1 + 0 = 1.
  { name: 'single mixed row', board: ROW0_MIXED, rows: [0], cols: [], plates: [], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  // mono → +2 mult: M = 1 + 0 + 2 = 3.
  { name: 'single monochrome row (+2)', board: ROW3_MONO, rows: [3], cols: [], plates: [], env: { streak: 1 }, prints: 80, mult: 3, total: 240 },
  // SERIA 5 → +4: M = 1 + 4 = 5.
  { name: 'streak bonus SERIA 5 → +4', board: ROW0_MIXED, rows: [0], cols: [], plates: [], env: { streak: 5 }, prints: 80, mult: 5, total: 400 },
  // SERIA 0 (wet ink): max(0, −1) = 0.
  { name: 'streak 0 gives no negative bonus', board: ROW0_MIXED, rows: [0], cols: [], plates: [], env: { streak: 0 }, prints: 80, mult: 1, total: 80 },
  // 16 cells = 160; M = 2 + 1 = 3.
  { name: 'two rows', board: TWO_ROWS, rows: [0, 1], cols: [], plates: [], env: { streak: 2 }, prints: 160, mult: 3, total: 480 },
  // 240; M = 3 + 2 = 5.
  { name: 'three rows', board: THREE_ROWS, rows: [5, 6, 7], cols: [], plates: [], env: { streak: 3 }, prints: 240, mult: 5, total: 1200 },
  // 4 lines × 80 (intersections counted in each line) = 320; M = 4 + 3 = 7.
  { name: 'four lines (2 rows + 2 cols)', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: [], env: { streak: 4 }, prints: 320, mult: 7, total: 2240 },
  // Row + column; 16 cell visits = 160; M = 2 + 1 + 2·2 = 7.
  { name: 'row × column cross, both mono', board: CROSS_MONO, rows: [2], cols: [5], plates: [], env: { streak: 2 }, prints: 160, mult: 7, total: 1120 },
  { name: 'row × column cross, mixed', board: CROSS_MIXED, rows: [6], cols: [3], plates: [], env: { streak: 2 }, prints: 160, mult: 3, total: 480 },
  // 6 ink cells → 60.
  { name: 'blind + lead cells score 0', board: ROW4_BLIND_LEAD, rows: [4], cols: [], plates: [], env: { streak: 1 }, prints: 60, mult: 1, total: 60 },
  { name: 'blind breaks monochrome', board: ROW4_PINK_BLIND, rows: [4], cols: [], plates: [], env: { streak: 1 }, prints: 70, mult: 1, total: 70 },
  { name: 'lead breaks monochrome', board: ROW4_TEAL_LEAD, rows: [4], cols: [], plates: [], env: { streak: 1 }, prints: 70, mult: 1, total: 70 },
  // 240; M = 3 + 2 + 2·2 = 9.
  { name: 'two mono + one mixed row', board: MONO_MIX3, rows: [0, 1, 2], cols: [], plates: [], env: { streak: 3 }, prints: 240, mult: 9, total: 2160 },

  // ---- ink plates: +20 per cell of their colour (cell phase) ----
  { name: 'ink_pink: 4 pinks', board: ROW0_MIXED, rows: [0], cols: [], plates: ['ink_pink'], env: { streak: 1 }, prints: 160, mult: 1, total: 160 },
  { name: 'ink_orange: 1 orange', board: ROW0_MIXED, rows: [0], cols: [], plates: ['ink_orange'], env: { streak: 1 }, prints: 100, mult: 1, total: 100 },
  { name: 'ink_yellow: 1 yellow', board: ROW0_MIXED, rows: [0], cols: [], plates: ['ink_yellow'], env: { streak: 1 }, prints: 100, mult: 1, total: 100 },
  { name: 'ink_blue: 1 blue', board: ROW0_MIXED, rows: [0], cols: [], plates: ['ink_blue'], env: { streak: 1 }, prints: 100, mult: 1, total: 100 },
  { name: 'ink_teal: 0 teal in a pink row', board: ROW4_PINK_BLIND, rows: [4], cols: [], plates: ['ink_teal'], env: { streak: 1 }, prints: 70, mult: 1, total: 70 },
  // 16 teal visits × (10 + 20) = 480; M = 7.
  { name: 'ink_teal on a mono cross (intersection twice)', board: CROSS_MONO, rows: [2], cols: [5], plates: ['ink_teal'], env: { streak: 2 }, prints: 480, mult: 7, total: 3360 },
  // 6 pinks × 30 = 180 (blind/lead get nothing).
  { name: 'ink_pink skips blind and lead', board: ROW4_BLIND_LEAD, rows: [4], cols: [], plates: ['ink_pink'], env: { streak: 1 }, prints: 180, mult: 1, total: 180 },
  // 320 + 8 pink visits × 20 = 480; M = 7.
  { name: 'ink_pink on four lines', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: ['ink_pink'], env: { streak: 4 }, prints: 480, mult: 7, total: 3360 },

  // ---- flat / conditional plates ----
  { name: 'proof +3', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof'], env: { streak: 1 }, prints: 80, mult: 4, total: 320 },
  // 160 + 2·50.
  { name: 'guillotine +50 per line', board: TWO_ROWS, rows: [0, 1], cols: [], plates: ['guillotine'], env: { streak: 2 }, prints: 260, mult: 3, total: 780 },
  { name: 'roller: 1 line → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['roller'], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  { name: 'roller: 2 lines → +6', board: TWO_ROWS, rows: [0, 1], cols: [], plates: ['roller'], env: { streak: 2 }, prints: 160, mult: 9, total: 1440 },
  // only row 0 is an edge: 160 + 120.
  { name: 'margins: one edge row of two', board: ROWS_0_3, rows: [0, 3], cols: [], plates: ['margins'], env: { streak: 2 }, prints: 280, mult: 3, total: 840 },
  // row 0 and col 0 are edges: 320 + 240.
  { name: 'margins: edge row + edge col', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: ['margins'], env: { streak: 4 }, prints: 560, mult: 7, total: 3920 },
  { name: 'petit: piece of 3 → +5', board: ROW0_MIXED, rows: [0], cols: [], plates: ['petit'], env: { streak: 1, pieceSize: 3 }, prints: 80, mult: 6, total: 480 },
  { name: 'petit: piece of 4 → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['petit'], env: { streak: 1, pieceSize: 4 }, prints: 80, mult: 1, total: 80 },
  { name: 'poster: piece of 5 → +120 prints', board: ROW0_MIXED, rows: [0], cols: [], plates: ['poster'], env: { streak: 1, pieceSize: 5 }, prints: 200, mult: 1, total: 200 },
  { name: 'poster: piece of 4 → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['poster'], env: { streak: 1, pieceSize: 4 }, prints: 80, mult: 1, total: 80 },
  // M = 1 + 4 + 5.
  { name: 'numerator: SERIA 5 → +5', board: ROW0_MIXED, rows: [0], cols: [], plates: ['numerator'], env: { streak: 5 }, prints: 80, mult: 10, total: 800 },
  { name: 'numerator: SERIA 0 → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['numerator'], env: { streak: 0 }, prints: 80, mult: 1, total: 80 },
  { name: 'scrap pays out 90', board: ROW0_MIXED, rows: [0], cols: [], plates: [{ id: 'scrap', state: { stored: 90 } }], env: { streak: 1 }, prints: 170, mult: 1, total: 170 },
  { name: 'scrap full bank 300 + proof', board: ROW0_MIXED, rows: [0], cols: [], plates: [{ id: 'scrap', state: { stored: 300 } }, 'proof'], env: { streak: 1 }, prints: 380, mult: 4, total: 1520 },
  { name: 'scrap empty bank', board: ROW0_MIXED, rows: [0], cols: [], plates: ['scrap'], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  // (1 + 3) × 2.
  { name: 'first_impression at sheet 8', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'first_impression'], env: { streak: 1, sheetsUsed: 8 }, prints: 80, mult: 8, total: 640 },
  { name: 'first_impression at sheet 9 → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'first_impression'], env: { streak: 1, sheetsUsed: 9 }, prints: 80, mult: 4, total: 320 },
  // 1 × 2 + 3.
  { name: 'first_impression before proof', board: ROW0_MIXED, rows: [0], cols: [], plates: ['first_impression', 'proof'], env: { streak: 1, sheetsUsed: 1 }, prints: 80, mult: 5, total: 400 },

  // ---- column press (line ×2 after per-cell plates) ----
  // row 80 + col 80×2.
  { name: 'column_press doubles the column only', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['column_press'], env: { streak: 2 }, prints: 240, mult: 3, total: 720 },
  // row 80 + 1·20 = 100; col (80 + 5·20) × 2 = 360.
  { name: 'ink_pink then column_press', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['ink_pink', 'column_press'], env: { streak: 2 }, prints: 460, mult: 3, total: 1380 },
  // Per-cell plates always precede line hooks, whatever the rack order.
  { name: 'column_press then ink_pink (cell phase first anyway)', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['column_press', 'ink_pink'], env: { streak: 2 }, prints: 460, mult: 3, total: 1380 },
  // row 80 + 50; col 80×2 + 50.
  { name: 'column_press then guillotine', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['column_press', 'guillotine'], env: { streak: 2 }, prints: 340, mult: 3, total: 1020 },
  // row 130; col (80 + 50) × 2.
  { name: 'guillotine then column_press', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['guillotine', 'column_press'], env: { streak: 2 }, prints: 390, mult: 3, total: 1170 },
  { name: 'column_press with rows only → nothing', board: TWO_ROWS, rows: [0, 1], cols: [], plates: ['column_press'], env: { streak: 2 }, prints: 160, mult: 3, total: 480 },

  // ---- rare ----
  // 9 × 2².
  { name: 'monotype: 2 mono lines → ×4', board: MONO_MIX3, rows: [0, 1, 2], cols: [], plates: ['monotype'], env: { streak: 3 }, prints: 240, mult: 36, total: 8640 },
  // M = 3 + 2 + 6 = 11 × 2³.
  { name: 'monotype: 3 mono lines → ×8', board: MONO3, rows: [0, 1, 2], cols: [], plates: ['monotype'], env: { streak: 3 }, prints: 240, mult: 88, total: 21120 },
  { name: 'monotype: no mono line → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['monotype'], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  // 5 inks → +10.
  { name: 'registration: 5 inks → +10', board: ROW0_MIXED, rows: [0], cols: [], plates: ['registration'], env: { streak: 1 }, prints: 80, mult: 11, total: 880 },
  // 1 ink (blind is no colour) → +2.
  { name: 'registration: 1 ink → +2', board: ROW4_PINK_BLIND, rows: [4], cols: [], plates: ['registration'], env: { streak: 1 }, prints: 70, mult: 3, total: 210 },
  { name: 'journeyman starts at +1', board: ROW0_MIXED, rows: [0], cols: [], plates: ['journeyman'], env: { streak: 1 }, prints: 80, mult: 2, total: 160 },
  { name: 'journeyman grown to +4', board: ROW0_MIXED, rows: [0], cols: [], plates: [{ id: 'journeyman', state: { mult: 4 } }], env: { streak: 1 }, prints: 80, mult: 5, total: 400 },
  { name: 'archive starts at 0', board: TWO_ROWS, rows: [0, 1], cols: [], plates: ['archive'], env: { streak: 2 }, prints: 160, mult: 3, total: 480 },
  // 160 + 2·7.
  { name: 'archive bonus 7 per line', board: TWO_ROWS, rows: [0, 1], cols: [], plates: [{ id: 'archive', state: { bonus: 7 } }], env: { streak: 2 }, prints: 174, mult: 3, total: 522 },
  { name: 'ink_well starts at 0', board: ROW0_MIXED, rows: [0], cols: [], plates: ['ink_well'], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  { name: 'ink_well grown to +6', board: ROW0_MIXED, rows: [0], cols: [], plates: [{ id: 'ink_well', state: { mult: 6 } }], env: { streak: 1 }, prints: 80, mult: 7, total: 560 },
  // M = 3 + 3·1.
  { name: 'crossmark: 1 intersection', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['crossmark'], env: { streak: 2 }, prints: 160, mult: 6, total: 960 },
  // M = 7 + 3·4.
  { name: 'crossmark: 4 intersections', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: ['crossmark'], env: { streak: 4 }, prints: 320, mult: 19, total: 6080 },
  { name: 'crossmark: rows only → nothing', board: TWO_ROWS, rows: [0, 1], cols: [], plates: ['crossmark'], env: { streak: 2 }, prints: 160, mult: 3, total: 480 },
  // clean after, 2 lines → 3 × 4.
  { name: 'clean_sheet: 2 lines, clean forme', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['clean_sheet'], env: { streak: 2 }, prints: 160, mult: 12, total: 1920 },
  { name: 'clean_sheet: jams are ignored', board: CROSS_MIXED_JAM, rows: [6], cols: [3], plates: ['clean_sheet'], env: { streak: 2 }, prints: 160, mult: 12, total: 1920 },
  { name: 'clean_sheet: leftover lead → nothing', board: CROSS_MIXED_LEAD, rows: [6], cols: [3], plates: ['clean_sheet'], env: { streak: 2 }, prints: 160, mult: 3, total: 480 },
  { name: 'clean_sheet: 1 line clears the forme → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['clean_sheet'], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  { name: 'clean_sheet: 4 lines, clean', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: ['clean_sheet'], env: { streak: 4 }, prints: 320, mult: 28, total: 8960 },
  // alone: 4 empty slots → ×3.
  { name: 'stencil alone → ×3', board: ROW0_MIXED, rows: [0], cols: [], plates: ['stencil'], env: { streak: 1 }, prints: 80, mult: 3, total: 240 },
  // 3 empty → ×2.5: (1 + 3) × 2.5.
  { name: 'proof + stencil → ×2.5', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'stencil'], env: { streak: 1 }, prints: 80, mult: 10, total: 800 },
  { name: 'stencil in a full rack → ×1', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'roller', 'petit', 'poster', 'stencil'], env: { streak: 1, pieceSize: 4 }, prints: 80, mult: 4, total: 320 },
  // A disabled plate is not an empty slot (§7): still ×2.5.
  { name: 'stencil: disabled plate still occupies a slot', board: ROW0_MIXED, rows: [0], cols: [], plates: [{ id: 'proof', enabled: false }, 'stencil'], env: { streak: 1 }, prints: 80, mult: 2.5, total: 200 },
  // (1 + 4) × 1.5.
  { name: 'momentum: SERIA 5 → ×1.5', board: ROW0_MIXED, rows: [0], cols: [], plates: ['momentum'], env: { streak: 5 }, prints: 80, mult: 7.5, total: 600 },
  { name: 'momentum: SERIA 0 → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['momentum'], env: { streak: 0 }, prints: 80, mult: 1, total: 80 },

  // ---- legendary ----
  { name: 'gutenberg ×1.5', board: ROW0_MIXED, rows: [0], cols: [], plates: ['gutenberg'], env: { streak: 1 }, prints: 80, mult: 1.5, total: 120 },
  // (1 + 3) × 1.5 = 6.
  { name: 'rack order: proof → gutenberg', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'gutenberg'], env: { streak: 1 }, prints: 80, mult: 6, total: 480 },
  // 1 × 1.5 + 3 = 4.5.
  { name: 'rack order: gutenberg → proof', board: ROW0_MIXED, rows: [0], cols: [], plates: ['gutenberg', 'proof'], env: { streak: 1 }, prints: 80, mult: 4.5, total: 360 },
  { name: 'gutenberg grown to ×2.25', board: TWO_ROWS, rows: [0, 1], cols: [], plates: [{ id: 'gutenberg', state: { x: 2.25 } }], env: { streak: 2 }, prints: 160, mult: 6.75, total: 1080 },
  { name: 'hydraulic: 3 lines → ×3', board: THREE_ROWS, rows: [5, 6, 7], cols: [], plates: ['hydraulic'], env: { streak: 3 }, prints: 240, mult: 15, total: 3600 },
  { name: 'hydraulic: 2 lines → nothing', board: TWO_ROWS, rows: [0, 1], cols: [], plates: ['hydraulic'], env: { streak: 2 }, prints: 160, mult: 3, total: 480 },
  { name: 'hydraulic: 4 lines → ×3', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: ['hydraulic'], env: { streak: 4 }, prints: 320, mult: 21, total: 6720 },
  // (5 + 6) × 3 vs 5 × 3 + 6.
  { name: 'rack order: roller → hydraulic', board: THREE_ROWS, rows: [5, 6, 7], cols: [], plates: ['roller', 'hydraulic'], env: { streak: 3 }, prints: 240, mult: 33, total: 7920 },
  { name: 'rack order: hydraulic → roller', board: THREE_ROWS, rows: [5, 6, 7], cols: [], plates: ['hydraulic', 'roller'], env: { streak: 3 }, prints: 240, mult: 21, total: 5040 },
  // row 6: 5 inks, col 3: 4 inks → ×1.5² = 2.25; 3 × 2.25.
  { name: 'split_fountain: 2 rainbow lines', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['split_fountain'], env: { streak: 2 }, prints: 160, mult: 6.75, total: 1080 },
  // 7 × 1.5⁴ = 35.4375.
  { name: 'split_fountain: 4 rainbow lines', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: ['split_fountain'], env: { streak: 4 }, prints: 320, mult: 35.4375, total: 11340 },
  { name: 'split_fountain: 2 inks → nothing', board: ROW_2_INKS, rows: [4], cols: [], plates: ['split_fountain'], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  { name: 'split_fountain: exactly 3 inks → ×1.5', board: ROW_3_INKS, rows: [4], cols: [], plates: ['split_fountain'], env: { streak: 1 }, prints: 80, mult: 1.5, total: 120 },

  // ---- Mirror (§8.3) ----
  { name: 'mirror copies proof', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', 'proof'], env: { streak: 1 }, prints: 80, mult: 7, total: 560 },
  { name: 'mirror rightmost → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'mirror'], env: { streak: 1 }, prints: 80, mult: 4, total: 320 },
  { name: 'mirror next to a disabled plate → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', { id: 'proof', enabled: false }], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },
  { name: 'disabled mirror → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: [{ id: 'mirror', enabled: false }, 'proof'], env: { streak: 1 }, prints: 80, mult: 4, total: 320 },
  { name: 'mirrors chain to the right', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', 'mirror', 'proof'], env: { streak: 1 }, prints: 80, mult: 10, total: 800 },
  { name: 'mirror chain broken by a disabled mirror', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', { id: 'mirror', enabled: false }, 'proof'], env: { streak: 1 }, prints: 80, mult: 4, total: 320 },
  { name: 'mirror reads journeyman counter', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', { id: 'journeyman', state: { mult: 4 } }], env: { streak: 1 }, prints: 80, mult: 9, total: 720 },
  { name: 'mirror copies scrap payout', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', { id: 'scrap', state: { stored: 60 } }], env: { streak: 1 }, prints: 200, mult: 1, total: 200 },
  // col: 80 × 2 × 2.
  { name: 'mirror copies column_press (×4 column)', board: CROSS_MIXED, rows: [6], cols: [3], plates: ['mirror', 'column_press'], env: { streak: 2 }, prints: 400, mult: 3, total: 1200 },
  // 80 + 4 pinks × 20 × 2.
  { name: 'mirror copies ink_pink', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', 'ink_pink'], env: { streak: 1 }, prints: 240, mult: 1, total: 240 },
  // (1 + 3) × 2 × 2.
  { name: 'mirror copies gutenberg ×2', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'mirror', { id: 'gutenberg', state: { x: 2 } }], env: { streak: 1 }, prints: 80, mult: 16, total: 1280 },
  { name: 'mirror copies first_impression (condition met)', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'mirror', 'first_impression'], env: { streak: 1, sheetsUsed: 5 }, prints: 80, mult: 16, total: 1280 },
  { name: 'mirror copies first_impression (condition not met)', board: ROW0_MIXED, rows: [0], cols: [], plates: ['proof', 'mirror', 'first_impression'], env: { streak: 1, sheetsUsed: 9 }, prints: 80, mult: 4, total: 320 },
  // 3 empty slots → ×2.5 twice.
  { name: 'mirror copies stencil', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', 'stencil'], env: { streak: 1 }, prints: 80, mult: 6.25, total: 500 },
  { name: 'mirror next to ream (passive) → nothing', board: ROW0_MIXED, rows: [0], cols: [], plates: ['mirror', 'ream'], env: { streak: 1 }, prints: 80, mult: 1, total: 80 },

  // ---- builds / longer racks ----
  // P = 240 + 10 pinks × 20 = 440; M = 9 + 6 = 15, ×4 = 60, ×1.75 = 105.
  { name: 'mono build: ink_pink, roller, monotype, gutenberg', board: MONO_MIX3, rows: [0, 1, 2], cols: [], plates: ['ink_pink', 'roller', 'monotype', { id: 'gutenberg', state: { x: 1.75 } }], env: { streak: 3 }, prints: 440, mult: 105, total: 46200 },
  // Reversed: 9 × 1.75 = 15.75, ×4 = 63, +6 = 69.
  { name: 'mono build reversed', board: MONO_MIX3, rows: [0, 1, 2], cols: [], plates: [{ id: 'gutenberg', state: { x: 1.75 } }, 'monotype', 'roller', 'ink_pink'], env: { streak: 3 }, prints: 440, mult: 69, total: 30360 },
  // M = 1 + 5 = 6, +5 (petit) = 11, +6 (numerator) = 17, ×1.6 = 27.2.
  { name: 'streak build: petit, numerator, momentum', board: ROW0_MIXED, rows: [0], cols: [], plates: ['petit', 'numerator', 'momentum'], env: { streak: 6, pieceSize: 2 }, prints: 80, mult: 27.2, total: 2176 },
  // Big press on FOUR_LINES, piece 5: P = 320 + 120 = 440; M = 7 + 6 (roller) + 12 (crossmark) = 25, ×3 = 75, ×4 = 300.
  { name: 'big press: poster, roller, crossmark, hydraulic, clean_sheet', board: FOUR_LINES, rows: [0, 1], cols: [0, 1], plates: ['poster', 'roller', 'crossmark', 'hydraulic', 'clean_sheet'], env: { streak: 4, pieceSize: 5 }, prints: 440, mult: 300, total: 132000 },
];

describe('scorePrint — hand-computed fixtures', () => {
  it('has at least 25 fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(25);
  });

  for (const f of FIXTURES) {
    it(f.name, () => {
      const input = makeInput(f.board, f.plates, f.env);
      // The board really produces the lines the fixture claims.
      expect(input.lines).toEqual({ rows: f.rows, cols: f.cols });
      const r = scorePrint(input);
      expect(r.prints).toBe(f.prints);
      expect(r.mult).toBeCloseTo(f.mult, 10);
      expect(r.total).toBe(f.total);
    });
  }
});

// ---------------------------------------------------------------------------
// Golden Type (stubbed random)
// ---------------------------------------------------------------------------

describe('golden_type', () => {
  it('retriggers repeat the cell with its per-cell plates; ×1.1 per repeat', () => {
    // ROW0_MIXED: p p o y t b p p. Cells 0 and 7 (pink) retrigger.
    const rnd = rolls([0.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.2]);
    const r = score(ROW0_MIXED, ['golden_type', 'ink_pink'], { streak: 1, random: rnd.fn });
    // 80 + 4·20 = 160; two pink repeats × (10 + 20) = 60.
    expect(r.prints).toBe(220);
    expect(r.mult).toBeCloseTo(1.21, 12);
    expect(r.total).toBe(266); // ⌊220 × 1.21⌋ = ⌊266.2⌋
    expect(rnd.used()).toBe(8);
    const again = r.events.filter((e) => e.t === 'cell' && e.again);
    expect(again).toEqual([
      { t: 'cell', i: 0, ref: { kind: 'row', n: 0 }, again: true },
      { t: 'cell', i: 7, ref: { kind: 'row', n: 0 }, again: true },
    ]);
    expect(r.events.filter((e) => e.t === 'x')).toEqual([
      { t: 'x', v: ipow(1.1, 2), src: 0, M: ipow(1.1, 2) },
    ]);
  });

  it('chance is strictly below 1/4', () => {
    const rnd = rolls(new Array<number>(8).fill(MX.goldenChance));
    const r = score(ROW0_MIXED, ['golden_type'], { streak: 1, random: rnd.fn });
    expect(r).toMatchObject({ prints: 80, mult: 1, total: 80 });
    expect(r.events.some((e) => e.t === 'x')).toBe(false);
  });

  it('retriggers never chain (one roll per cell, again-pass does not roll)', () => {
    const rnd = rolls(new Array<number>(8).fill(0));
    const r = score(ROW0_MIXED, ['golden_type'], { streak: 1, random: rnd.fn });
    expect(rnd.used()).toBe(8);
    // Every cell printed exactly twice: 160; M = 1.1^8.
    expect(r.prints).toBe(160);
    expect(r.mult).toBeCloseTo(ipow(1.1, 8), 12);
    expect(r.total).toBe(Math.floor(160 * ipow(1.1, 8))); // 342
    expect(r.total).toBe(342);
    expect(r.events.filter((e) => e.t === 'cell').length).toBe(16);
  });

  it('blind and lead cells are not rolled', () => {
    const rnd = rolls(new Array<number>(6).fill(0));
    const r = score(ROW4_BLIND_LEAD, ['golden_type'], { streak: 1, random: rnd.fn });
    expect(rnd.used()).toBe(6);
    // 60 + 6 repeats × 10 = 120; ×1.1^6 = 1.771561 → ⌊212.587⌋.
    expect(r.prints).toBe(120);
    expect(r.total).toBe(212);
  });

  it('an intersection cell is rolled once per line', () => {
    // CROSS_MIXED: row 6 (8 rolls) then column 3 (8 rolls); retrigger only the intersection (x=3,y=6)
    // in both lines: row index 3, column index 6.
    const values = new Array<number>(16).fill(0.9);
    values[3] = 0;
    values[8 + 6] = 0;
    const rnd = rolls(values);
    const r = score(CROSS_MIXED, ['golden_type', 'ink_pink'], { streak: 2, random: rnd.fn });
    expect(rnd.used()).toBe(16);
    // Base 160 + pinks (1 + 5) × 20 = 280; two repeats of the pink intersection × 30 = 60.
    expect(r.prints).toBe(340);
    expect(r.mult).toBeCloseTo(3 * 1.21, 12);
    expect(r.total).toBe(1234); // ⌊340 × 3.63⌋ = ⌊1234.2⌋
    const again = r.events.filter((e): e is Extract<ScoreEvent, { t: 'cell' }> => e.t === 'cell' && e.again);
    expect(again.map((e) => [e.i, e.ref.kind])).toEqual([
      [idx(3, 6), 'row'],
      [idx(3, 6), 'col'],
    ]);
  });

  it('Mirror copy is a second independent roll (max 3 prints per cell)', () => {
    // Rack: mirror(→golden), golden, ink_pink. Two draws per ink cell: mirror slot first.
    // Cell 0: both hit (3 prints). Cell 3 (yellow): only golden hits.
    const values = new Array<number>(16).fill(0.9);
    values[0] = 0.1;
    values[1] = 0.1;
    values[7] = 0.1;
    const rnd = rolls(values);
    const r = score(ROW0_MIXED, ['mirror', 'golden_type', 'ink_pink'], { streak: 1, random: rnd.fn });
    expect(rnd.used()).toBe(16);
    // 160 + cell 0 twice more × 30 + cell 3 once more × 10 = 230.
    expect(r.prints).toBe(230);
    // Mirror slot: 1 repeat → ×1.1; golden slot: 2 repeats → ×1.21.
    expect(r.mult).toBeCloseTo(1.331, 12);
    expect(r.total).toBe(306); // ⌊230 × 1.331⌋ = ⌊306.13⌋
    expect(r.events.filter((e) => e.t === 'cell' && e.i === 0).length).toBe(3);
    const xs = r.events.filter((e): e is Extract<ScoreEvent, { t: 'x' }> => e.t === 'x');
    expect(xs.map((e) => e.src)).toEqual([0, 1]);
    expect(xs[0]?.v).toBeCloseTo(1.1, 12);
    expect(xs[1]?.v).toBeCloseTo(1.21, 12);
  });

  it('with no retrigger it applies no ×', () => {
    const r = score(ROW0_MIXED, ['golden_type'], { streak: 1, random: () => 0.99 });
    expect(r).toMatchObject({ prints: 80, mult: 1, total: 80, triggers: [0] });
  });
});

// ---------------------------------------------------------------------------
// Mirror resolution & attribution
// ---------------------------------------------------------------------------

describe('Mirror (§8.3)', () => {
  it('resolveSlot follows the chain and stops at disabled plates or the end', () => {
    const slots = rack([
      'mirror',
      'mirror',
      { id: 'journeyman', state: { mult: 5 } },
      'mirror',
      { id: 'proof', enabled: false },
      'mirror',
    ]);
    const ids = slots.map((_, i) => resolveSlot(slots, i)?.def.id ?? null);
    expect(ids).toEqual(['journeyman', 'journeyman', 'journeyman', null, null, null]);
    // Mirror reads the neighbour's state object (never a copy it could grow).
    expect(resolveSlot(slots, 0)?.state).toBe(slots[2]?.inst.state);
  });

  it('triggers are attributed to the mirror slot', () => {
    const r = score(ROW0_MIXED, ['mirror', 'proof'], { streak: 1 });
    expect(r.triggers).toEqual([1, 1]);
    const ms = r.events.filter((e): e is Extract<ScoreEvent, { t: 'm' }> => e.t === 'm');
    expect(ms.map((e) => [e.src, e.v])).toEqual([
      ['lines', 1],
      [0, 3],
      [1, 3],
    ]);
  });

  it('per-cell attribution: mirror of ink_pink', () => {
    const r = score(ROW0_MIXED, ['mirror', 'ink_pink'], { streak: 1 });
    expect(r.triggers).toEqual([4, 4]);
    const pinkEvents = r.events.filter(
      (e): e is Extract<ScoreEvent, { t: 'p' }> => e.t === 'p' && e.src === 0,
    );
    expect(pinkEvents.map((e) => e.i)).toEqual([0, 1, 6, 7]);
  });

  it('rightmost or neighbour-disabled mirror records no triggers; disabled plates contribute nothing', () => {
    expect(score(ROW0_MIXED, ['proof', 'mirror'], { streak: 1 }).triggers).toEqual([1, 0]);
    expect(score(ROW0_MIXED, ['mirror', { id: 'proof', enabled: false }], { streak: 1 }).triggers).toEqual([
      0, 0,
    ]);
    const off = score(
      TWO_ROWS,
      [
        { id: 'guillotine', enabled: false },
        { id: 'ink_pink', enabled: false },
        { id: 'gutenberg', enabled: false },
      ],
      {
        streak: 2,
      },
    );
    expect(off).toMatchObject({ prints: 160, mult: 3, total: 480, triggers: [0, 0, 0] });
  });

  it('does not grow or mutate the copied plate (scoring is pure)', () => {
    const input = makeInput(
      ROW0_MIXED,
      ['mirror', { id: 'scrap', state: { stored: 60 } }, 'mirror', { id: 'archive', state: { bonus: 3 } }],
      {
        streak: 1,
      },
    );
    const before = structuredClone(input.slots.map((s) => s.inst.state));
    for (const s of input.slots) Object.freeze(s.inst.state);
    const r = scorePrint(input);
    expect(input.slots.map((s) => s.inst.state)).toEqual(before);
    // 80 + 60·2 (scrap payout twice) + 3·2 (archive line bonus twice).
    expect(r.prints).toBe(206);
  });
});

// ---------------------------------------------------------------------------
// Events & context
// ---------------------------------------------------------------------------

describe('event log', () => {
  it('lines go rows top→bottom then columns left→right; column cells top→bottom', () => {
    const r = score(FOUR_LINES, [], { streak: 4 });
    expect(r.events.filter((e) => e.t === 'line').map((e) => (e.t === 'line' ? e.ref : null))).toEqual([
      { kind: 'row', n: 0 },
      { kind: 'row', n: 1 },
      { kind: 'col', n: 0 },
      { kind: 'col', n: 1 },
    ]);
    const colCells = r.events.filter(
      (e): e is Extract<ScoreEvent, { t: 'cell' }> => e.t === 'cell' && e.ref.kind === 'col' && e.ref.n === 1,
    );
    expect(colCells.map((e) => e.i)).toEqual(lineCells('col', 1));
  });

  it('exact sequence for a small print', () => {
    // Row 4: 'ppxpplpp' with ink_pink, guillotine, poster, proof; piece 5.
    const r = score(ROW4_BLIND_LEAD, ['ink_pink', 'guillotine', 'poster', 'proof'], {
      streak: 1,
      pieceSize: 5,
    });
    const ref = { kind: 'row' as const, n: 4 };
    const expected: ScoreEvent[] = [{ t: 'line', ref }];
    let P = 0;
    for (const x of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const i = idx(x, 4);
      expected.push({ t: 'cell', i, ref, again: false });
      if (x === 2 || x === 5) continue; // blind / lead: 0 prints → no 'p' event
      P += 10;
      expected.push({ t: 'p', v: 10, src: 'base', P, i, ref });
      P += 20;
      expected.push({ t: 'p', v: 20, src: 0, P, i, ref });
    }
    P += 50;
    expected.push({ t: 'p', v: 50, src: 1, P, ref });
    expected.push({ t: 'm', v: 1, src: 'lines', M: 1 });
    P += 120;
    expected.push({ t: 'p', v: 120, src: 2, P });
    expected.push({ t: 'm', v: 3, src: 3, M: 4 });
    expect(r.events).toEqual(expected);
    expect(r).toMatchObject({ prints: 350, mult: 4, total: 1400, triggers: [6, 1, 1, 1] });
  });

  it('streak and mono sources appear in the base phase', () => {
    const r = score(CROSS_MONO, [], { streak: 4 });
    expect(r.events.filter((e) => e.t === 'm')).toEqual([
      { t: 'm', v: 2, src: 'lines', M: 2 },
      { t: 'm', v: 3, src: 'streak', M: 5 },
      { t: 'm', v: 4, src: 'mono', M: 9 },
    ]);
  });

  it("'lx' event carries the factor, line and running P", () => {
    const r = score(CROSS_MIXED, ['ink_pink', 'column_press'], { streak: 2 });
    expect(r.events.filter((e) => e.t === 'lx')).toEqual([
      { t: 'lx', v: 2, src: 1, ref: { kind: 'col', n: 3 }, P: 460 },
    ]);
  });

  it('builds the print context', () => {
    const input = makeInput(FOUR_LINES, ['proof', { id: 'mirror', enabled: false }], {
      streak: 4,
      pieceSize: 7,
      sheetsLeft: 3,
      sheetsUsed: 17,
      printIndex: 5,
    });
    const r = scorePrint(input);
    expect(r.ctx).toEqual({
      lines: [
        { kind: 'row', n: 0 },
        { kind: 'row', n: 1 },
        { kind: 'col', n: 0 },
        { kind: 'col', n: 1 },
      ],
      lineCount: 4,
      rowCount: 2,
      colCount: 2,
      intersections: 4,
      inks: [0, 1, 2, 3, 4],
      lineInkCounts: [5, 5, 5, 5],
      monoLines: 0,
      pieceSize: 7,
      streak: 4,
      sheetsLeft: 3,
      sheetsUsed: 17,
      printIndex: 5,
      boardCleanAfter: true,
      emptySlots: 3,
    } satisfies PrintCtx);
  });

  it('does not mutate the board', () => {
    const input = makeInput(CROSS_MIXED_LEAD, ['clean_sheet'], { streak: 2 });
    const before = input.cells.slice();
    const r = scorePrint(input);
    expect(input.cells).toEqual(before);
    expect(r.ctx.boardCleanAfter).toBe(false);
  });

  it('lineInfo, lineRefs and cellBasePrints', () => {
    const cells = board(CROSS_MIXED);
    expect(lineRefs({ rows: [6], cols: [3] })).toEqual([
      { kind: 'row', n: 6 },
      { kind: 'col', n: 3 },
    ]);
    expect(lineInfo(cells, { kind: 'col', n: 3 })).toEqual({
      ref: { kind: 'col', n: 3 },
      cells: lineCells('col', 3),
      inks: [0, 1, 2, 3],
      mono: false,
      edge: false,
    } satisfies LineCtx);
    const mono = board(CROSS_MONO);
    expect(lineInfo(mono, { kind: 'row', n: 2 })).toMatchObject({ inks: [3], mono: true, edge: false });
    const blind = board([E, E, E, E, E, E, E, 'xxxxxxxx']);
    expect(lineInfo(blind, { kind: 'row', n: 7 })).toMatchObject({ inks: [], mono: false, edge: true });
    expect([0, 1, 2, 3, 4].map(cellBasePrints)).toEqual([10, 10, 10, 10, 10]);
    expect([EMPTY, BLIND, LEAD, JAM].map(cellBasePrints)).toEqual([0, 0, 0, 0]);
  });

  it('buildPrintCtx counts empty slots against capacity', () => {
    const cells = board(ROW0_MIXED);
    const base = {
      cells,
      lines: { rows: [0], cols: [] },
      pieceSize: 1,
      streak: 1,
      sheetsLeft: 1,
      sheetsUsed: 1,
      printIndex: 0,
    };
    expect(buildPrintCtx({ ...base, slotCapacity: 5, ownedSlots: 0 }).emptySlots).toBe(5);
    expect(buildPrintCtx({ ...base, slotCapacity: 5, ownedSlots: 5 }).emptySlots).toBe(0);
    expect(buildPrintCtx({ ...base, slotCapacity: 5, ownedSlots: 6 }).emptySlots).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase rules (§5.4): cell/line hooks add prints only
// ---------------------------------------------------------------------------

type Call = 'prints' | 'mult' | 'xmult' | 'linePrintsX' | 'retrigger' | 'random';

function recorder(randomValue: number): { api: ScoreApi; calls: Call[] } {
  const calls: Call[] = [];
  const api: ScoreApi = {
    prints: () => {
      calls.push('prints');
    },
    mult: () => {
      calls.push('mult');
    },
    xmult: () => {
      calls.push('xmult');
    },
    linePrintsX: () => {
      calls.push('linePrintsX');
    },
    retrigger: () => {
      calls.push('retrigger');
    },
    random: () => {
      calls.push('random');
      return randomValue;
    },
  };
  return { api, calls };
}

const BOOSTED: MatrixState = { stored: 300, mult: 10, bonus: 50, x: 3, repeats: 4 };

function statesFor(id: MatrixId): MatrixState[] {
  return [createInstance(id, 1).state, { ...BOOSTED }, {}];
}

describe('phase rules', () => {
  const cellCtxs: CellCtx[] = [];
  for (const value of [0, 1, 2, 3, 4, BLIND, LEAD]) {
    for (const again of [false, true]) {
      for (const intersection of [false, true]) {
        for (const line of [
          { kind: 'row' as const, n: 0 },
          { kind: 'col' as const, n: 4 },
        ]) {
          cellCtxs.push({ index: 3, value, ink: isInk(value) ? value : null, line, intersection, again });
        }
      }
    }
  }
  const lineCtxs: LineCtx[] = [];
  for (const ref of [
    { kind: 'row' as const, n: 0 },
    { kind: 'row' as const, n: 3 },
    { kind: 'col' as const, n: 0 },
    { kind: 'col' as const, n: 5 },
    { kind: 'col' as const, n: 7 },
  ]) {
    for (const [inks, mono] of [
      [[2], true],
      [[0, 1, 2], false],
      [[0, 1, 2, 3, 4], false],
      [[], false],
    ] as const) {
      lineCtxs.push({ ref, cells: lineCells(ref.kind, ref.n), inks, mono, edge: ref.n === 0 || ref.n === 7 });
    }
  }

  it('no plate calls mult/xmult from a cell or line hook (recording api)', () => {
    const withCell: MatrixId[] = [];
    const withLine: MatrixId[] = [];
    for (const def of MATRICES.values()) {
      for (const st of statesFor(def.id)) {
        Object.freeze(st);
        for (const rv of [0, 0.99]) {
          if (def.cell) {
            for (const c of cellCtxs) {
              const rec = recorder(rv);
              def.cell(rec.api, c, st, {});
              for (const call of rec.calls)
                expect(['prints', 'retrigger', 'random'], `${def.id} cell`).toContain(call);
            }
          }
          if (def.line) {
            for (const l of lineCtxs) {
              const rec = recorder(rv);
              def.line(rec.api, l, st, {});
              for (const call of rec.calls)
                expect(['prints', 'linePrintsX'], `${def.id} line`).toContain(call);
            }
          }
        }
      }
      if (def.cell) withCell.push(def.id);
      if (def.line) withLine.push(def.id);
    }
    // Pin the set of hooked plates so a new hook gets reviewed here.
    expect(withCell.sort()).toEqual([
      'golden_type',
      'ink_blue',
      'ink_orange',
      'ink_pink',
      'ink_teal',
      'ink_yellow',
    ]);
    expect(withLine.sort()).toEqual(['archive', 'column_press', 'guillotine', 'margins']);
  });

  it('print hooks use only prints / mult / xmult and never touch random', () => {
    const ctxs: PrintCtx[] = [
      buildPrintCtx({
        cells: board(FOUR_LINES),
        lines: { rows: [0, 1], cols: [0, 1] },
        pieceSize: 5,
        streak: 9,
        sheetsLeft: 2,
        sheetsUsed: 3,
        printIndex: 0,
        slotCapacity: 5,
        ownedSlots: 1,
      }),
      buildPrintCtx({
        cells: board(MONO3),
        lines: { rows: [0, 1, 2], cols: [] },
        pieceSize: 1,
        streak: 0,
        sheetsLeft: 0,
        sheetsUsed: 20,
        printIndex: 4,
        slotCapacity: 5,
        ownedSlots: 5,
      }),
    ];
    for (const def of MATRICES.values()) {
      if (!def.print) continue;
      for (const st of statesFor(def.id)) {
        Object.freeze(st);
        for (const p of ctxs) {
          const rec = recorder(0);
          def.print(rec.api, p, st, { repeats: 2 });
          for (const call of rec.calls)
            expect(['prints', 'mult', 'xmult'], `${def.id} print`).toContain(call);
        }
      }
    }
  });

  it('every MULT-affecting plate is a print-phase plate', () => {
    // Plates whose effect per GDD §8.2 is +/× MULT must hook `print`, not cell/line.
    const multPlates: MatrixId[] = [
      'proof',
      'roller',
      'petit',
      'numerator',
      'first_impression',
      'monotype',
      'registration',
      'journeyman',
      'crossmark',
      'clean_sheet',
      'stencil',
      'momentum',
      'ink_well',
      'gutenberg',
      'hydraulic',
      'golden_type',
      'split_fountain',
    ];
    for (const id of multPlates) expect(matrixDef(id).print, id).toBeTypeOf('function');
  });

  it('api.mult / api.xmult throw outside the print phase (runtime-patched passive plate)', () => {
    // 'ream' has no scoring hooks; patch one in temporarily and restore it.
    const def = matrixDef('ream');
    const hooks: Array<['cell' | 'line', (api: ScoreApi) => void]> = [
      ['cell', (api) => api.mult(1)],
      ['cell', (api) => api.xmult(2)],
      ['line', (api) => api.mult(1)],
      ['line', (api) => api.xmult(2)],
    ];
    try {
      for (const [phase, fn] of hooks) {
        delete def.cell;
        delete def.line;
        def[phase] = fn;
        expect(() => score(ROW0_MIXED, ['ream'], { streak: 1 })).toThrow(/print phase/);
      }
      // Sanity: the same calls in the print hook are fine.
      delete def.cell;
      delete def.line;
      def.print = (api) => {
        api.mult(1);
        api.xmult(2);
      };
      expect(score(ROW0_MIXED, ['ream'], { streak: 1 })).toMatchObject({ mult: 4, total: 320 });
    } finally {
      delete def.cell;
      delete def.line;
      delete def.print;
    }
    expect(score(ROW0_MIXED, ['ream'], { streak: 1 }).total).toBe(80);
  });

  it('linePrintsX outside line hooks and retrigger outside cell hooks are no-ops', () => {
    const def = matrixDef('type_case');
    try {
      def.cell = (api) => api.linePrintsX(5);
      def.print = (api) => {
        api.linePrintsX(5);
        api.retrigger();
      };
      def.line = (api) => api.retrigger();
      const r = score(ROW0_MIXED, ['type_case'], { streak: 1 });
      expect(r).toMatchObject({ prints: 80, mult: 1, total: 80, triggers: [0] });
      expect(r.events.filter((e) => e.t === 'cell').length).toBe(8);
      expect(r.events.some((e) => e.t === 'lx')).toBe(false);
    } finally {
      delete def.cell;
      delete def.line;
      delete def.print;
    }
  });
});

// ---------------------------------------------------------------------------
// fold(events) = result, plus an independent reference model (property tests)
// ---------------------------------------------------------------------------

interface Folded {
  P: number;
  M: number;
  triggers: Map<number, number>;
}

/** Re-accumulates P from 'p'/'lx' and M from 'm'/'x', checking every snapshot. */
function fold(events: readonly ScoreEvent[]): Folded {
  let P = 0;
  let M = 0;
  let lineP = 0;
  const triggers = new Map<number, number>();
  const bump = (src: unknown) => {
    if (typeof src === 'number') triggers.set(src, (triggers.get(src) ?? 0) + 1);
  };
  for (const e of events) {
    switch (e.t) {
      case 'line':
        lineP = 0;
        break;
      case 'cell':
        break;
      case 'p':
        P += e.v;
        if (e.ref) lineP += e.v;
        if (e.P !== P) throw new Error(`p snapshot ${e.P} ≠ ${P}`);
        bump(e.src);
        break;
      case 'lx': {
        const extra = lineP * (e.v - 1);
        P += extra;
        lineP += extra;
        if (e.P !== P) throw new Error(`lx snapshot ${e.P} ≠ ${P}`);
        bump(e.src);
        break;
      }
      case 'm':
        M += e.v;
        if (e.M !== M) throw new Error(`m snapshot ${e.M} ≠ ${M}`);
        bump(e.src);
        break;
      case 'x':
        M *= e.v;
        if (e.M !== M) throw new Error(`x snapshot ${e.M} ≠ ${M}`);
        bump(e.src);
        break;
    }
  }
  return { P, M, triggers };
}

const INK_PLATE: Partial<Record<MatrixId, number>> = {
  ink_pink: 0,
  ink_orange: 1,
  ink_yellow: 2,
  ink_teal: 3,
  ink_blue: 4,
};

/** Straight-from-the-GDD scorer (no events) used as an oracle. */
function reference(input: PrintInput): { prints: number; mult: number; total: number } {
  const { cells, lines, slots } = input;
  const eff = slots.map((_, i) => {
    for (let k = i; k < slots.length; k++) {
      const s = slots[k] as SlotInput;
      if (!s.enabled) return null;
      if (s.inst.id !== 'mirror') return { id: s.inst.id, st: s.inst.state };
    }
    return null;
  });
  const refs = [
    ...lines.rows.map((n) => ({ kind: 'row' as const, n })),
    ...lines.cols.map((n) => ({ kind: 'col' as const, n })),
  ];
  const L = refs.length;
  const repeats = slots.map(() => 0);
  const allInks = new Set<number>();
  let mono = 0;
  let rainbow = 0;
  let P = 0;
  for (const ref of refs) {
    const ids = lineCells(ref.kind, ref.n);
    const inks = new Set<number>();
    let allInk = true;
    let lineP = 0;
    for (const i of ids) {
      const v = cells[i] as number;
      const ink = isInk(v) ? v : null;
      if (ink === null) allInk = false;
      else {
        inks.add(ink);
        allInks.add(ink);
      }
      const once = () => {
        let p = ink === null ? 0 : 10;
        for (const e of eff) if (e && ink !== null && INK_PLATE[e.id] === ink) p += 20;
        return p;
      };
      let passes = 1;
      lineP += once();
      if (ink !== null) {
        eff.forEach((e, s) => {
          if (e?.id === 'golden_type' && input.random() < 0.25) {
            passes++;
            repeats[s] = (repeats[s] as number) + 1;
          }
        });
      }
      for (let k = 1; k < passes; k++) lineP += once();
    }
    for (const e of eff) {
      if (!e) continue;
      if (e.id === 'guillotine') lineP += 50;
      if (e.id === 'margins' && (ref.n === 0 || ref.n === 7)) lineP += 120;
      if (e.id === 'archive' && (e.st.bonus ?? 0) > 0) lineP += e.st.bonus ?? 0;
      if (e.id === 'column_press' && ref.kind === 'col') lineP *= 2;
    }
    P += lineP;
    if (allInk && inks.size === 1) mono++;
    if (inks.size >= 3) rainbow++;
  }
  const after = cells.slice();
  for (const ref of refs) for (const i of lineCells(ref.kind, ref.n)) if (after[i] !== JAM) after[i] = EMPTY;
  const clean = after.every((v) => v === EMPTY || v === JAM);
  const streak = input.streak;
  let M = L + Math.max(0, streak - 1) + 2 * mono;
  const pw = (b: number, k: number) => {
    let r = 1;
    for (let i = 0; i < k; i++) r *= b;
    return r;
  };
  eff.forEach((e, s) => {
    if (!e) return;
    const st = e.st;
    switch (e.id) {
      case 'proof':
        M += 3;
        break;
      case 'roller':
        if (L >= 2) M += 6;
        break;
      case 'petit':
        if (input.pieceSize <= 3) M += 5;
        break;
      case 'poster':
        if (input.pieceSize >= 5) P += 120;
        break;
      case 'numerator':
        if (streak > 0) M += streak;
        break;
      case 'scrap':
        P += st.stored ?? 0;
        break;
      case 'first_impression':
        if (input.sheetsUsed <= 8) M *= 2;
        break;
      case 'monotype':
        if (mono > 0) M *= pw(2, mono);
        break;
      case 'registration':
        M += 2 * allInks.size;
        break;
      case 'journeyman':
        M += st.mult ?? 1;
        break;
      case 'crossmark':
        M += 3 * lines.rows.length * lines.cols.length;
        break;
      case 'clean_sheet':
        if (clean && L >= 2) M *= 4;
        break;
      case 'stencil':
        M *= 1 + 0.5 * Math.max(0, input.slotCapacity - slots.length);
        break;
      case 'momentum':
        if (streak > 0) M *= 1 + 0.1 * streak;
        break;
      case 'ink_well':
        M += st.mult ?? 0;
        break;
      case 'gutenberg':
        M *= st.x ?? 1.5;
        break;
      case 'hydraulic':
        if (L >= 3) M *= 3;
        break;
      case 'golden_type':
        if ((repeats[s] as number) > 0) M *= pw(1.1, repeats[s] as number);
        break;
      case 'split_fountain':
        if (rainbow > 0) M *= pw(1.5, rainbow);
        break;
      default:
        break;
    }
  });
  return { prints: P, mult: M, total: Math.floor(P * M + 1e-9) };
}

function randomInput(rng: Rng, randomFn: () => number): PrintInput {
  const cells = newCells();
  for (let i = 0; i < 64; i++) {
    if (!rng.chance(0.55)) continue;
    const r = rng.next();
    cells[i] = r < 0.86 ? rng.int(5) : r < 0.92 ? BLIND : r < 0.98 ? LEAD : JAM;
  }
  const fillLine = (kind: 'row' | 'col', n: number) => {
    const style = rng.next();
    const color = rng.int(5);
    for (const i of lineCells(kind, n)) {
      if (style < 0.3)
        cells[i] = color; // monochrome attempt (crossing lines may overwrite)
      else if ((cells[i] as number) === EMPTY || (cells[i] as number) === JAM)
        cells[i] = rng.chance(0.08) ? BLIND : rng.int(5);
    }
  };
  const nRows = rng.int(4);
  const nCols = rng.int(4);
  for (let k = 0; k < nRows; k++) fillLine('row', rng.int(8));
  for (let k = 0; k < nCols; k++) fillLine('col', rng.int(8));
  const rowsOnly = rng.chance(0.1);
  let lines: FullLines = findFullLines(cells, rowsOnly);
  if (lines.rows.length + lines.cols.length === 0) {
    fillLine('row', rng.int(8));
    lines = findFullLines(cells, rowsOnly);
  }
  const ids = rng.shuffle([...MATRIX_IDS]).slice(0, rng.int(6));
  const slots: SlotInput[] = ids.map((id, i) => {
    const inst = createInstance(id, i + 1);
    if (id === 'scrap') inst.state.stored = 30 * rng.int(11);
    if (id === 'journeyman') inst.state.mult = 1 + rng.int(10);
    if (id === 'archive') inst.state.bonus = rng.int(60);
    if (id === 'ink_well') inst.state.mult = 2 * rng.int(10);
    if (id === 'gutenberg') inst.state.x = 1.5 + 0.25 * rng.int(11);
    return { inst, enabled: !rng.chance(0.15) };
  });
  return {
    cells,
    lines,
    pieceSize: 1 + rng.int(9),
    streak: rng.int(21),
    sheetsLeft: rng.int(20),
    sheetsUsed: 1 + rng.int(23),
    printIndex: rng.int(10),
    slots,
    slotCapacity: BALANCE.slots,
    random: randomFn,
  };
}

describe('fold(events) = result (property, §5.5)', () => {
  it('re-accumulating the event log reproduces P, M, total and triggers (2 500 random prints)', () => {
    const rng = Rng.fromSeed('scoring-fold-property');
    let lxSeen = 0;
    let xSeen = 0;
    let goldenSeen = 0;
    for (let n = 0; n < 2500; n++) {
      const gold = Rng.derive('scoring-fold-golden', n);
      const input = randomInput(rng, () => gold.next());
      const r = scorePrint(input);
      const f = fold(r.events);
      expect(f.P).toBe(r.prints);
      expect(f.M).toBe(r.mult);
      expect(r.total).toBe(Math.floor(f.P * f.M + 1e-9));
      // ⌊P·M⌋ up to float noise just below an integer.
      const raw = f.P * f.M;
      expect(r.total === Math.floor(raw) || r.total - raw < 1e-9).toBe(true);
      expect(Number.isInteger(r.prints)).toBe(true);
      expect(Number.isFinite(r.mult) && r.mult >= 1).toBe(true);
      // triggers[] = number of contributions attributed to each slot.
      expect(r.triggers.length).toBe(input.slots.length);
      r.triggers.forEach((t, i) => expect(t).toBe(f.triggers.get(i) ?? 0));
      // Disabled slots never contribute.
      input.slots.forEach((s, i) => {
        if (!s.enabled) expect(r.triggers[i]).toBe(0);
      });
      if (r.events.some((e) => e.t === 'lx')) lxSeen++;
      if (r.events.some((e) => e.t === 'x')) xSeen++;
      if (r.events.some((e) => e.t === 'cell' && e.again)) goldenSeen++;
    }
    // The generator really exercises line ×, MULT × and retriggers.
    expect(lxSeen).toBeGreaterThan(50);
    expect(xSeen).toBeGreaterThan(500);
    expect(goldenSeen).toBeGreaterThan(20);
  });

  it('matches the independent GDD reference model (2 500 random prints)', () => {
    const rng = Rng.fromSeed('scoring-reference-property');
    for (let n = 0; n < 2500; n++) {
      const seed = `scoring-ref-golden-${n}`;
      const goldA = Rng.fromSeed(seed);
      const goldB = Rng.fromSeed(seed);
      const input = randomInput(rng, () => goldA.next());
      const snapshot = structuredClone(input.slots.map((s) => s.inst.state));
      const r = scorePrint(input);
      expect(input.slots.map((s) => s.inst.state)).toEqual(snapshot);
      const ref = reference({ ...input, random: () => goldB.next() });
      expect(r.prints).toBe(ref.prints);
      expect(r.mult).toBe(ref.mult);
      expect(r.total).toBe(ref.total);
      // Both consumed the golden stream identically.
      expect(goldA.getState()).toEqual(goldB.getState());
    }
  });

  it('is deterministic for identical inputs', () => {
    const rng1 = Rng.fromSeed('det');
    const rng2 = Rng.fromSeed('det');
    for (let n = 0; n < 200; n++) {
      const g1 = Rng.derive('det-g', n);
      const g2 = Rng.derive('det-g', n);
      const a = scorePrint(randomInput(rng1, () => g1.next()));
      const b = scorePrint(randomInput(rng2, () => g2.next()));
      expect(a).toEqual(b);
    }
  });
});
