/**
 * Fair tray generator (GDD §4): every dealt tray can be fully placed in some order.
 */
import { BALANCE } from './config/balance';
import { BLIND, INK_COUNT, JAM, clearRulesFor, emptyJamRows, occupancy, type Cells } from './board';
import {
  SOLVE_BUDGET,
  canPlace,
  cloneRows,
  fits,
  isSolvable,
  placeAndClear,
  positions,
  type ClearRules,
  type SolveStats,
} from './bitboard';
import { SHAPES, type Shape } from './pieces';
import type { Rng } from './rng';

export interface DealContext {
  cells: Cells;
  /** Number of pieces to deal (1..3). */
  count: number;
  rng: Rng;
  /** Weight per ink (length 5). */
  inkWeights: readonly number[];
  /** Ink index that comes out as blind emboss ("out of ink"), or null. */
  blindInk: number | null;
  bigFormat: boolean;
  rowsOnly: boolean;
  /** Total solver node budget for this deal (GDD §4); defaults to DEAL_BUDGET. */
  dealBudget?: number;
}

export interface DealtPiece {
  shape: string;
  /** 0..4 ink, or BLIND. */
  ink: number;
}

export interface DealResult {
  pieces: DealtPiece[];
  attempts: number;
  /** True when the constructive fallback had to be used. */
  fallback: boolean;
  /** Solver nodes spent (perf telemetry for the simulator report). */
  nodes: number;
}

/** Total solver node budget for one deal (GDD §4). */
export const DEAL_BUDGET = 16000;

/** Shapes removed from the pool by "large format". */
export const BIG_FORMAT_EXCLUDED: ReadonlySet<string> = new Set(['dot', 'i2h', 'i2v']);

export function shapeWeight(shape: Shape, bigFormat: boolean, smallBias: boolean): number {
  let w = shape.weight;
  if (bigFormat) {
    if (BIG_FORMAT_EXCLUDED.has(shape.id)) return 0;
    if (shape.size >= 5) w *= BALANCE.bigFormatFactor;
  }
  if (smallBias) w *= shape.size <= 3 ? 3 : 0.35;
  return w;
}

/** Shapes that can never fit on this contract's forme (jams never clear). */
export function neverFitting(cells: Cells): Set<string> {
  const out = new Set<string>();
  if (!cells.includes(JAM)) return out;
  const jamRows = emptyJamRows(cells);
  for (const s of SHAPES) if (!fits(jamRows, s)) out.add(s.id);
  return out;
}

function drawShape(rng: Rng, pool: readonly Shape[], bigFormat: boolean, smallBias: boolean): Shape {
  const weights = pool.map((s) => shapeWeight(s, bigFormat, smallBias));
  return pool[rng.weightedIndex(weights)] as Shape;
}

function drawInk(ctx: DealContext): number {
  const ink = ctx.rng.weightedIndex(ctx.inkWeights);
  return ctx.blindInk !== null && ink === ctx.blindInk ? BLIND : ink;
}

export function dealTray(ctx: DealContext): DealResult {
  if (ctx.inkWeights.length !== INK_COUNT) throw new Error('inkWeights must have 5 entries');
  const rows = occupancy(ctx.cells);
  const rules: ClearRules = clearRulesFor(ctx.cells, ctx.rowsOnly);
  const count = Math.max(0, Math.min(3, ctx.count));
  if (count === 0) return { pieces: [], attempts: 0, fallback: false, nodes: 0 };
  const never = neverFitting(ctx.cells);
  const pool = never.size > 0 ? SHAPES.filter((s) => !never.has(s.id)) : SHAPES;
  const stats: SolveStats = { nodes: 0 };
  const dealBudget = ctx.dealBudget ?? DEAL_BUDGET;

  for (let attempt = 1; attempt <= BALANCE.dealRetries; attempt++) {
    const smallBias = attempt > BALANCE.dealRetriesBeforeSmallBias;
    const shapes: Shape[] = [];
    for (let i = 0; i < count; i++) shapes.push(drawShape(ctx.rng, pool, ctx.bigFormat, smallBias));
    const left = dealBudget - stats.nodes;
    if (left <= 0) break;
    if (isSolvable(rows, shapes, rules, stats, Math.min(SOLVE_BUDGET, left))) {
      return {
        pieces: shapes.map((s) => ({ shape: s.id, ink: drawInk(ctx) })),
        attempts: attempt,
        fallback: false,
        nodes: stats.nodes,
      };
    }
  }

  // Constructive fallback: build a sequence that is placeable by construction.
  const sim = cloneRows(rows);
  const pieces: DealtPiece[] = [];
  for (let i = 0; i < count; i++) {
    const fitting = pool.filter((s) => positions(sim, s).length > 0);
    // Prefer shapes allowed by the modifier; fall back to anything that fits, then to a dot.
    const allowed = fitting.filter((s) => shapeWeight(s, ctx.bigFormat, true) > 0);
    const choice =
      allowed.length > 0 ? allowed : fitting.length > 0 ? fitting : SHAPES.filter((s) => s.size === 1);
    const shape = drawShape(ctx.rng, choice, false, true);
    const spots = positions(sim, shape);
    if (spots.length > 0) {
      const p = ctx.rng.pick(spots);
      const x = p % 8;
      const y = (p / 8) | 0;
      // Defensive: `p` comes from positions(sim, shape), so canPlace is always true here.
      /* c8 ignore else -- @preserve */
      if (canPlace(sim, shape, x, y)) placeAndClear(sim, shape, x, y, rules);
    }
    pieces.push({ shape: shape.id, ink: drawInk(ctx) });
  }
  return { pieces, attempts: BALANCE.dealRetries, fallback: true, nodes: stats.nodes };
}
