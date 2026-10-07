/**
 * 8×8 occupancy bitboards: one byte per row, bit x = column x.
 * Used for fast placement checks, line detection, the fair-tray solver and the bot.
 */
import { BOARD_SIZE, type Shape } from './pieces';

export const FULL_ROW = 0xff;
export type Rows = Uint8Array;

export interface LineMasks {
  /** Bit r set = row r is full. */
  rowMask: number;
  /** Bit c set = column c is full. */
  colMask: number;
}

export interface ClearRules {
  /** When true only rows print (modifier "rows_only"). */
  rowsOnly?: boolean;
  /** Rows that can never print (they contain a jammed cell). Bit r = row r. */
  blockedRows?: number;
  /** Columns that can never print (they contain a jammed cell). Bit c = column c. */
  blockedCols?: number;
}

export function emptyRows(): Rows {
  return new Uint8Array(BOARD_SIZE);
}

export function cloneRows(rows: Rows): Rows {
  return new Uint8Array(rows);
}

export function canPlace(rows: Rows, shape: Shape, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + shape.w > BOARD_SIZE || y + shape.h > BOARD_SIZE) return false;
  const sr = shape.rows;
  for (let r = 0; r < sr.length; r++) {
    if (((rows[y + r] as number) & ((sr[r] as number) << x)) !== 0) return false;
  }
  return true;
}

export function placeInto(rows: Rows, shape: Shape, x: number, y: number): void {
  const sr = shape.rows;
  for (let r = 0; r < sr.length; r++) {
    rows[y + r] = (rows[y + r] as number) | ((sr[r] as number) << x);
  }
}

export function fullLines(rows: Rows, rules: ClearRules = {}): LineMasks {
  let rowMask = 0;
  let colMask = FULL_ROW;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const v = rows[r] as number;
    if (v === FULL_ROW) rowMask |= 1 << r;
    colMask &= v;
  }
  rowMask &= ~(rules.blockedRows ?? 0) & FULL_ROW;
  colMask &= ~(rules.blockedCols ?? 0) & FULL_ROW;
  return { rowMask, colMask: rules.rowsOnly ? 0 : colMask };
}

/** Clears the given lines in place. */
export function clearInto(rows: Rows, masks: LineMasks): void {
  const keepCols = ~masks.colMask & FULL_ROW;
  for (let r = 0; r < BOARD_SIZE; r++) {
    rows[r] = masks.rowMask & (1 << r) ? 0 : (rows[r] as number) & keepCols;
  }
}

export function popcount8(v: number): number {
  v = v - ((v >> 1) & 0x55);
  v = (v & 0x33) + ((v >> 2) & 0x33);
  return (v + (v >> 4)) & 0x0f;
}

export function countFilled(rows: Rows): number {
  let n = 0;
  for (let r = 0; r < BOARD_SIZE; r++) n += popcount8(rows[r] as number);
  return n;
}

/** All valid top-left positions, encoded as y * 8 + x. */
export function positions(rows: Rows, shape: Shape): number[] {
  const out: number[] = [];
  for (let y = 0; y <= BOARD_SIZE - shape.h; y++) {
    for (let x = 0; x <= BOARD_SIZE - shape.w; x++) {
      if (canPlace(rows, shape, x, y)) out.push(y * BOARD_SIZE + x);
    }
  }
  return out;
}

export function fits(rows: Rows, shape: Shape): boolean {
  for (let y = 0; y <= BOARD_SIZE - shape.h; y++) {
    for (let x = 0; x <= BOARD_SIZE - shape.w; x++) {
      if (canPlace(rows, shape, x, y)) return true;
    }
  }
  return false;
}

export function anyFits(rows: Rows, shapes: readonly Shape[]): boolean {
  for (const s of shapes) if (fits(rows, s)) return true;
  return false;
}

/** Places a shape, clears full lines and returns the cleared masks (mutates rows). */
export function placeAndClear(rows: Rows, shape: Shape, x: number, y: number, rules: ClearRules = {}): LineMasks {
  placeInto(rows, shape, x, y);
  const masks = fullLines(rows, rules);
  if (masks.rowMask !== 0 || masks.colMask !== 0) clearInto(rows, masks);
  return masks;
}

function half(rows: Rows, o: number): number {
  return (
    ((rows[o] as number) |
      ((rows[o + 1] as number) << 8) |
      ((rows[o + 2] as number) << 16) |
      ((rows[o + 3] as number) << 24)) >>>
    0
  );
}

export interface SolveStats {
  nodes: number;
  /** True when the node budget ran out (result counted as "unproven" → false). */
  exhausted?: boolean;
}

/** Default node budget per solvability check (GDD §4). */
export const SOLVE_BUDGET = 4000;

/** Fewest empty cells in any line that could still print (Infinity if none can). */
function minEmptyInPrintableLine(rows: Rows, rules: ClearRules): number {
  let best = Infinity;
  const br = rules.blockedRows ?? 0;
  const bc = rules.blockedCols ?? 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    if (br & (1 << r)) continue;
    best = Math.min(best, BOARD_SIZE - popcount8(rows[r] as number));
  }
  if (!rules.rowsOnly) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (bc & (1 << c)) continue;
      let empty = 0;
      for (let r = 0; r < BOARD_SIZE; r++) if (!((rows[r] as number) & (1 << c))) empty++;
      best = Math.min(best, empty);
    }
  }
  return best;
}

/**
 * Fast accept: can all shapes be placed on mutually disjoint free cells without relying on clears?
 * If so the tray is solvable in any order (clears only ever free cells).
 */
function disjointFit(rows: Rows, shapes: readonly Shape[], k: number, budget: { left: number }): boolean {
  if (k === shapes.length) return true;
  const shape = shapes[k] as Shape;
  for (let y = 0; y <= BOARD_SIZE - shape.h; y++) {
    for (let x = 0; x <= BOARD_SIZE - shape.w; x++) {
      if (!canPlace(rows, shape, x, y)) continue;
      if (--budget.left <= 0) return false;
      const next = cloneRows(rows);
      placeInto(next, shape, x, y);
      if (disjointFit(next, shapes, k + 1, budget)) return true;
    }
  }
  return false;
}

/**
 * Can every shape be placed, in some order, starting from `rows` (with line clears
 * between placements)? Fast disjoint accept, then depth-first search with pruning,
 * memoisation of failed states and a node budget. Running out of budget returns false
 * ("unproven"), which is safe because callers only ever accept proven trays.
 */
export function isSolvable(
  rows: Rows,
  shapes: readonly Shape[],
  rules: ClearRules = {},
  stats?: SolveStats,
  budgetNodes: number = SOLVE_BUDGET,
): boolean {
  if (shapes.length === 0) return true;
  // `remaining` is a bit set counted with popcount8 and packed into the memo key below.
  if (shapes.length > 8) throw new RangeError('isSolvable: at most 8 shapes');
  const budget = { left: budgetNodes };
  // Larger pieces first makes the disjoint search fail/succeed faster.
  const bySize = [...shapes].sort((a, b) => b.size - a.size);
  if (disjointFit(rows, bySize, 0, { left: Math.min(budgetNodes, 600) })) {
    if (stats) stats.nodes += 1;
    return true;
  }
  const failed = new Map<number, Set<number>>();
  const n = shapes.length;
  const fullSet = (1 << n) - 1;
  let exhausted = false;

  const rec = (board: Rows, remaining: number): boolean => {
    if (stats) stats.nodes++;
    if (--budget.left <= 0) {
      exhausted = true;
      return false;
    }
    const left = popcount8(remaining);
    if (left === 1) return fits(board, shapes[31 - Math.clz32(remaining)] as Shape);
    const hi = half(board, 0);
    // Rows 4-7 above the remaining-set bits: (fullSet + 1) = 2^n leaves room for every subset
    // (a fixed ×8 only fits 3 pieces; with 4+ distinct states collided and solvable trays were rejected).
    const lo = half(board, 4) * (fullSet + 1) + remaining;
    const seen = failed.get(hi);
    if (seen?.has(lo)) return false;

    // Prune: a shape that does not fit now can only fit after a clear; if the other
    // remaining pieces cannot complete any printable line, no clear can ever happen.
    let otherCells = 0;
    let blockedShape = false;
    for (let i = 0; i < n; i++) {
      if (!(remaining & (1 << i))) continue;
      const sh = shapes[i] as Shape;
      if (fits(board, sh)) otherCells += sh.size;
      else blockedShape = true;
    }
    if (blockedShape && otherCells < minEmptyInPrintableLine(board, rules)) {
      if (seen) seen.add(lo);
      else failed.set(hi, new Set([lo]));
      return false;
    }

    const tried = new Set<string>();
    for (let i = 0; i < n; i++) {
      if (!(remaining & (1 << i))) continue;
      const shape = shapes[i] as Shape;
      if (tried.has(shape.id)) continue;
      tried.add(shape.id);
      for (let y = 0; y <= BOARD_SIZE - shape.h; y++) {
        for (let x = 0; x <= BOARD_SIZE - shape.w; x++) {
          if (!canPlace(board, shape, x, y)) continue;
          const next = cloneRows(board);
          placeAndClear(next, shape, x, y, rules);
          if (rec(next, remaining & ~(1 << i))) return true;
          if (exhausted) return false;
        }
      }
    }
    const set = failed.get(hi);
    if (set) set.add(lo);
    else failed.set(hi, new Set([lo]));
    return false;
  };

  const ok = rec(cloneRows(rows), fullSet);
  if (stats && exhausted) stats.exhausted = true;
  return ok;
}
