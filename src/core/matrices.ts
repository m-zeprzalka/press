/**
 * Plates ("matryce") — the Balatro-style rule modifiers (GDD §8).
 *
 * Scoring phases (GDD §5.4): `cell` and `line` hooks may only add PRINTS;
 * every MULT effect (+ and ×) happens in the `print` hook, in rack order.
 * Scoring hooks must not mutate plate state (Mirror runs them on its neighbour);
 * they get a per-print scratch object instead. State changes happen only in the
 * lifecycle hooks (`afterPrint`, `afterPlace`, `afterContract`, `onContractStart`).
 */
import type { Ink } from './board';
import { BALANCE } from './config/balance';
import { ipow } from './math';

export type Rarity = 'common' | 'rare' | 'legendary';

export const MATRIX_IDS = [
  // common
  'ink_pink',
  'ink_orange',
  'ink_yellow',
  'ink_teal',
  'ink_blue',
  'proof',
  'guillotine',
  'roller',
  'margins',
  'petit',
  'poster',
  'ream',
  'numerator',
  'scrap',
  'first_impression',
  // rare
  'column_press',
  'monotype',
  'registration',
  'journeyman',
  'archive',
  'crossmark',
  'type_case',
  'clean_sheet',
  'stencil',
  'momentum',
  'conveyor',
  'ink_well',
  // legendary
  'gutenberg',
  'hydraulic',
  'golden_type',
  'mirror',
  'split_fountain',
] as const;

export type MatrixId = (typeof MATRIX_IDS)[number];

export type MatrixState = Record<string, number>;

export interface MatrixInstance {
  id: MatrixId;
  /** Unique within a run (for UI keys / animations). */
  uid: number;
  state: MatrixState;
}

export interface LineRef {
  kind: 'row' | 'col';
  n: number;
}

export interface CellCtx {
  index: number;
  value: number;
  /** Ink 0..4 or null for blind / lead. */
  ink: Ink | null;
  line: LineRef;
  intersection: boolean;
  /** True on a retriggered pass (Golden Type); retriggers never chain. */
  again: boolean;
}

export interface LineCtx {
  ref: LineRef;
  cells: readonly number[];
  /** Distinct inks present in the line. */
  inks: readonly Ink[];
  mono: boolean;
  edge: boolean;
}

export interface PrintCtx {
  lines: readonly LineRef[];
  lineCount: number;
  rowCount: number;
  colCount: number;
  intersections: number;
  /** Distinct inks across every printed cell. */
  inks: readonly Ink[];
  /** Distinct ink count of each printed line (same order as `lines`). */
  lineInkCounts: readonly number[];
  monoLines: number;
  pieceSize: number;
  streak: number;
  sheetsLeft: number;
  /** Placements made in this contract, including the current one. */
  sheetsUsed: number;
  /** 0 for the first print of the contract. */
  printIndex: number;
  boardCleanAfter: boolean;
  /** Empty plate slots (capacity − owned). */
  emptySlots: number;
}

export interface ScoreApi {
  prints(n: number): void;
  /** Print phase only. */
  mult(n: number): void;
  /** Print phase only. */
  xmult(f: number): void;
  /** Multiplies the prints accumulated by the current line (line hooks only). */
  linePrintsX(f: number): void;
  /** Requests a second pass over the current cell (cell hooks only; no chaining). */
  retrigger(): void;
  random(): number;
}

export interface MatrixDef {
  id: MatrixId;
  rarity: Rarity;
  tags: readonly string[];
  /** False → must be unlocked via an achievement (meta). */
  starter: boolean;
  initState?: () => MatrixState;
  // Passive effects
  sheets?: number;
  inkAffinity?: Ink;
  streakGrace?: number;
  /** Share of SERIA carried into the next contract. */
  streakCarry?: number;
  reserve?: number;
  /** Overrides the rarity-based sell value (sheets). */
  sellValue?: number;
  // Scoring hooks (pure; `tmp` is per-print scratch for this slot)
  cell?: (api: ScoreApi, c: CellCtx, st: MatrixState, tmp: MatrixState) => void;
  line?: (api: ScoreApi, l: LineCtx, st: MatrixState, tmp: MatrixState) => void;
  print?: (api: ScoreApi, p: PrintCtx, st: MatrixState, tmp: MatrixState) => void;
  // Lifecycle hooks (mutating; never run for disabled plates)
  afterPrint?: (p: PrintCtx, st: MatrixState) => void;
  afterPlace?: (printed: boolean, st: MatrixState) => void;
  afterContract?: (st: MatrixState) => void;
  onContractStart?: (st: MatrixState) => void;
  /** Numbers shown in the localized description, e.g. { n: 15 }. */
  params: (st: MatrixState) => Record<string, number>;
}

/** Tunable plate numbers (balance pass edits these). */
export const MX = {
  inkPrints: 20,
  proofMult: 3,
  guillotinePrints: 50,
  rollerMult: 6,
  marginsPrints: 120,
  petitMult: 5,
  petitMaxSize: 3,
  posterPrints: 120,
  posterMinSize: 5,
  reamSheets: 3,
  numeratorPerStreak: 1,
  scrapPerPlacement: 30,
  scrapMax: 300,
  firstImpressionX: 2,
  firstImpressionSheets: 8,
  columnPressX: 2,
  monotypeX: 2,
  registrationPerInk: 2,
  journeymanStart: 1,
  journeymanStep: 1,
  archiveStep: 1,
  crossmarkMult: 3,
  cleanSheetX: 4,
  cleanSheetMinLines: 2,
  stencilPerEmpty: 0.5,
  momentumPerStreak: 0.1,
  conveyorGrace: 1,
  conveyorCarry: 0.5,
  inkWellStep: 2,
  gutenbergStart: 1.5,
  gutenbergStep: 0.25,
  hydraulicX: 3,
  hydraulicMinLines: 3,
  goldenChance: 0.25,
  goldenX: 1.1,
  splitFountainX: 1.5,
  splitFountainMinInks: 3,
};

function inkPlate(id: MatrixId, ink: Ink): MatrixDef {
  return {
    id,
    rarity: 'common',
    tags: ['ink', 'color'],
    starter: true,
    inkAffinity: ink,
    cell: (api, c) => {
      if (c.ink === ink) api.prints(MX.inkPrints);
    },
    params: () => ({ n: MX.inkPrints }),
  };
}

const DEFS: MatrixDef[] = [
  inkPlate('ink_pink', 0),
  inkPlate('ink_orange', 1),
  inkPlate('ink_yellow', 2),
  inkPlate('ink_teal', 3),
  inkPlate('ink_blue', 4),
  {
    id: 'proof',
    rarity: 'common',
    tags: ['flat'],
    starter: true,
    print: (api) => api.mult(MX.proofMult),
    params: () => ({ n: MX.proofMult }),
  },
  {
    id: 'guillotine',
    rarity: 'common',
    tags: ['flat'],
    starter: true,
    line: (api) => api.prints(MX.guillotinePrints),
    params: () => ({ n: MX.guillotinePrints }),
  },
  {
    id: 'roller',
    rarity: 'common',
    tags: ['multi'],
    starter: true,
    print: (api, p) => {
      if (p.lineCount >= 2) api.mult(MX.rollerMult);
    },
    params: () => ({ n: MX.rollerMult }),
  },
  {
    id: 'margins',
    rarity: 'common',
    tags: ['geometry'],
    starter: true,
    line: (api, l) => {
      if (l.edge) api.prints(MX.marginsPrints);
    },
    params: () => ({ n: MX.marginsPrints }),
  },
  {
    id: 'petit',
    rarity: 'common',
    tags: ['small', 'streak'],
    starter: true,
    print: (api, p) => {
      if (p.pieceSize <= MX.petitMaxSize) api.mult(MX.petitMult);
    },
    params: () => ({ n: MX.petitMult, size: MX.petitMaxSize }),
  },
  {
    id: 'poster',
    rarity: 'common',
    tags: ['big'],
    starter: true,
    print: (api, p) => {
      if (p.pieceSize >= MX.posterMinSize) api.prints(MX.posterPrints);
    },
    params: () => ({ n: MX.posterPrints, size: MX.posterMinSize }),
  },
  {
    id: 'ream',
    rarity: 'common',
    tags: ['utility'],
    starter: true,
    sheets: MX.reamSheets,
    sellValue: 0,
    params: () => ({ n: MX.reamSheets }),
  },
  {
    id: 'numerator',
    rarity: 'common',
    tags: ['streak'],
    starter: true,
    print: (api, p) => {
      if (p.streak > 0) api.mult(MX.numeratorPerStreak * p.streak);
    },
    params: () => ({ n: MX.numeratorPerStreak }),
  },
  {
    id: 'scrap',
    rarity: 'common',
    tags: ['setup'],
    starter: true,
    initState: () => ({ stored: 0 }),
    print: (api, _p, st) => {
      if ((st.stored ?? 0) > 0) api.prints(st.stored ?? 0);
    },
    afterPrint: (_p, st) => {
      st.stored = 0;
    },
    afterPlace: (printed, st) => {
      if (!printed) st.stored = Math.min(MX.scrapMax, (st.stored ?? 0) + MX.scrapPerPlacement);
    },
    onContractStart: (st) => {
      st.stored = 0;
    },
    params: (st) => ({ n: MX.scrapPerPlacement, max: MX.scrapMax, stored: st.stored ?? 0 }),
  },
  {
    id: 'first_impression',
    rarity: 'common',
    tags: ['tempo'],
    starter: true,
    print: (api, p) => {
      if (p.sheetsUsed <= MX.firstImpressionSheets) api.xmult(MX.firstImpressionX);
    },
    params: () => ({ x: MX.firstImpressionX, n: MX.firstImpressionSheets }),
  },
  // ---------------- rare ----------------
  {
    id: 'column_press',
    rarity: 'rare',
    tags: ['geometry'],
    starter: true,
    line: (api, l) => {
      if (l.ref.kind === 'col') api.linePrintsX(MX.columnPressX);
    },
    params: () => ({ x: MX.columnPressX }),
  },
  {
    id: 'monotype',
    rarity: 'rare',
    tags: ['color', 'mono'],
    starter: true,
    print: (api, p) => {
      if (p.monoLines > 0) api.xmult(ipow(MX.monotypeX, p.monoLines));
    },
    params: () => ({ x: MX.monotypeX }),
  },
  {
    id: 'registration',
    rarity: 'rare',
    tags: ['rainbow'],
    starter: false,
    print: (api, p) => {
      if (p.inks.length > 0) api.mult(MX.registrationPerInk * p.inks.length);
    },
    params: () => ({ n: MX.registrationPerInk }),
  },
  {
    id: 'journeyman',
    rarity: 'rare',
    tags: ['scaling'],
    starter: true,
    initState: () => ({ mult: MX.journeymanStart }),
    print: (api, _p, st) => api.mult(st.mult ?? MX.journeymanStart),
    afterContract: (st) => {
      st.mult = (st.mult ?? MX.journeymanStart) + MX.journeymanStep;
    },
    params: (st) => ({ n: st.mult ?? MX.journeymanStart, step: MX.journeymanStep }),
  },
  {
    id: 'archive',
    rarity: 'rare',
    tags: ['scaling'],
    starter: true,
    initState: () => ({ bonus: 0 }),
    line: (api, _l, st) => {
      if ((st.bonus ?? 0) > 0) api.prints(st.bonus ?? 0);
    },
    afterPrint: (p, st) => {
      st.bonus = (st.bonus ?? 0) + MX.archiveStep * p.lineCount;
    },
    params: (st) => ({ n: st.bonus ?? 0, step: MX.archiveStep }),
  },
  {
    id: 'crossmark',
    rarity: 'rare',
    tags: ['multi'],
    starter: false,
    print: (api, p) => {
      if (p.intersections > 0) api.mult(MX.crossmarkMult * p.intersections);
    },
    params: () => ({ n: MX.crossmarkMult }),
  },
  {
    id: 'type_case',
    rarity: 'rare',
    tags: ['utility'],
    starter: false,
    reserve: 1,
    params: () => ({}),
  },
  {
    id: 'clean_sheet',
    rarity: 'rare',
    tags: ['multi'],
    starter: false,
    print: (api, p) => {
      if (p.boardCleanAfter && p.lineCount >= MX.cleanSheetMinLines) api.xmult(MX.cleanSheetX);
    },
    params: () => ({ x: MX.cleanSheetX, n: MX.cleanSheetMinLines }),
  },
  {
    id: 'stencil',
    rarity: 'rare',
    tags: ['minimal'],
    starter: false,
    print: (api, p) => api.xmult(1 + MX.stencilPerEmpty * p.emptySlots),
    params: () => ({ x: MX.stencilPerEmpty }),
  },
  {
    id: 'momentum',
    rarity: 'rare',
    tags: ['streak'],
    starter: false,
    print: (api, p) => {
      if (p.streak > 0) api.xmult(1 + MX.momentumPerStreak * p.streak);
    },
    params: () => ({ x: MX.momentumPerStreak }),
  },
  {
    id: 'conveyor',
    rarity: 'rare',
    tags: ['streak', 'utility'],
    starter: false,
    streakGrace: MX.conveyorGrace,
    streakCarry: MX.conveyorCarry,
    params: () => ({ n: MX.conveyorGrace, pct: Math.round(MX.conveyorCarry * 100) }),
  },
  {
    id: 'ink_well',
    rarity: 'rare',
    tags: ['color', 'mono', 'scaling'],
    starter: true,
    initState: () => ({ mult: 0 }),
    print: (api, _p, st) => {
      if ((st.mult ?? 0) > 0) api.mult(st.mult ?? 0);
    },
    afterPrint: (p, st) => {
      st.mult = (st.mult ?? 0) + MX.inkWellStep * p.monoLines;
    },
    params: (st) => ({ n: st.mult ?? 0, step: MX.inkWellStep }),
  },
  // ---------------- legendary ----------------
  {
    id: 'gutenberg',
    rarity: 'legendary',
    tags: ['scaling'],
    starter: true,
    initState: () => ({ x: MX.gutenbergStart }),
    print: (api, _p, st) => api.xmult(st.x ?? MX.gutenbergStart),
    afterContract: (st) => {
      st.x = Math.round(((st.x ?? MX.gutenbergStart) + MX.gutenbergStep) * 100) / 100;
    },
    params: (st) => ({ x: st.x ?? MX.gutenbergStart, step: MX.gutenbergStep }),
  },
  {
    id: 'hydraulic',
    rarity: 'legendary',
    tags: ['multi'],
    starter: true,
    print: (api, p) => {
      if (p.lineCount >= MX.hydraulicMinLines) api.xmult(MX.hydraulicX);
    },
    params: () => ({ x: MX.hydraulicX, lines: MX.hydraulicMinLines }),
  },
  {
    id: 'golden_type',
    rarity: 'legendary',
    tags: ['random'],
    starter: false,
    cell: (api, c, _st, tmp) => {
      if (c.ink !== null && !c.again && api.random() < MX.goldenChance) {
        api.retrigger();
        tmp.repeats = (tmp.repeats ?? 0) + 1;
      }
    },
    print: (api, _p, _st, tmp) => {
      if ((tmp.repeats ?? 0) > 0) api.xmult(ipow(MX.goldenX, tmp.repeats ?? 0));
    },
    params: () => ({ n: Math.round(1 / MX.goldenChance), x: MX.goldenX }),
  },
  {
    id: 'mirror',
    rarity: 'legendary',
    tags: ['copy'],
    starter: false,
    params: () => ({}),
  },
  {
    id: 'split_fountain',
    rarity: 'legendary',
    tags: ['rainbow'],
    starter: false,
    print: (api, p) => {
      const k = p.lineInkCounts.filter((n) => n >= MX.splitFountainMinInks).length;
      if (k > 0) api.xmult(ipow(MX.splitFountainX, k));
    },
    params: () => ({ x: MX.splitFountainX, n: MX.splitFountainMinInks }),
  },
];

export const MATRICES: ReadonlyMap<MatrixId, MatrixDef> = new Map(DEFS.map((d) => [d.id, d]));

export function matrixDef(id: MatrixId): MatrixDef {
  const d = MATRICES.get(id);
  if (!d) throw new Error(`Unknown plate: ${id}`);
  return d;
}

export function isMatrixId(v: unknown): v is MatrixId {
  return typeof v === 'string' && MATRICES.has(v as MatrixId);
}

export function createInstance(id: MatrixId, uid: number): MatrixInstance {
  const def = matrixDef(id);
  return { id, uid, state: def.initState ? def.initState() : {} };
}

export const STARTER_MATRICES: readonly MatrixId[] = DEFS.filter((d) => d.starter).map((d) => d.id);

/** True when the plate has a printing effect (Mirror copies only these). */
export function hasPrintingEffect(def: MatrixDef): boolean {
  return Boolean(def.cell || def.line || def.print);
}

export function sellValue(id: MatrixId): number {
  const def = matrixDef(id);
  return def.sellValue ?? BALANCE.sellSheets[def.rarity];
}
