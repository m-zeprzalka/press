/**
 * Fast internal board model for the bot planner.
 *
 * Occupancy is two 32-bit integers (lo = rows 0..3, hi = rows 4..7; bit 8·r + x = cell (x, r)),
 * so a placement check is two ANDs against a precomputed placement mask. Colours live in an
 * Int8Array(64) that is only materialised for nodes the beam keeps.
 *
 * Line rules mirror the core exactly: a line prints when all 8 cells are filled and it contains
 * no jam (jams sit in the occupancy and their rows/columns are masked out); "rows only" disables
 * columns.
 */
import { BOARD_SIZE, SHAPES, type Shape } from '../core/pieces';

export const FULL = 0xff;

export function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

const POP8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) POP8[i] = popcount32(i);
export function pop8(v: number): number {
  return POP8[v & 0xff] as number;
}

/** Row transitions (walls count as filled) for every 8-bit row value. */
const ROW_TRANS = new Uint8Array(256);
for (let v = 0; v < 256; v++) {
  const padded = (v << 1) | 0x201; // walls at bit 0 and bit 9
  ROW_TRANS[v] = popcount32((padded ^ (padded >>> 1)) & 0x1ff);
}

/**
 * ERODE[m << 8 | f]: anchors x (bit set) where row mask m shifted by x lies entirely in the
 * free row f. Shape row masks are at most 5 bits wide.
 */
const ERODE = new Uint8Array(32 * 256);
for (let m = 1; m < 32; m++) {
  for (let f = 0; f < 256; f++) {
    let a = 0xff;
    for (let b = 0; b < 5; b++) if (m & (1 << b)) a &= f >>> b;
    ERODE[(m << 8) | f] = a & 0xff;
  }
}

export interface FastShape {
  idx: number;
  id: string;
  size: number;
  w: number;
  h: number;
  weight: number;
  rows: readonly number[];
  /** Precomputed placements (all anchors inside the board). */
  n: number;
  pLo: Int32Array;
  pHi: Int32Array;
  /** Anchor encoded as y * 8 + x. */
  pAnchor: Uint8Array;
  /** Cell offsets (dy * 8 + dx) relative to the anchor. */
  offsets: Uint8Array;
}

function buildShape(s: Shape, idx: number): FastShape {
  const lo: number[] = [];
  const hi: number[] = [];
  const anchors: number[] = [];
  for (let y = 0; y <= BOARD_SIZE - s.h; y++) {
    for (let x = 0; x <= BOARD_SIZE - s.w; x++) {
      let l = 0;
      let h = 0;
      for (const [cx, cy] of s.cells) {
        const i = (y + cy) * BOARD_SIZE + x + cx;
        if (i < 32) l |= 1 << i;
        else h |= 1 << (i - 32);
      }
      lo.push(l | 0);
      hi.push(h | 0);
      anchors.push(y * BOARD_SIZE + x);
    }
  }
  return {
    idx,
    id: s.id,
    size: s.size,
    w: s.w,
    h: s.h,
    weight: s.weight,
    rows: s.rows,
    n: anchors.length,
    pLo: Int32Array.from(lo),
    pHi: Int32Array.from(hi),
    pAnchor: Uint8Array.from(anchors),
    offsets: Uint8Array.from(s.cells.map(([cx, cy]) => cy * BOARD_SIZE + cx)),
  };
}

export const FAST_SHAPES: readonly FastShape[] = SHAPES.map(buildShape);
const BY_ID = new Map<string, FastShape>(FAST_SHAPES.map((s) => [s.id, s]));

export function fastShape(id: string): FastShape {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Unknown shape ${id}`);
  return s;
}

/** Unpacks occupancy into 8 row bytes. */
export function unpackRows(lo: number, hi: number, out: Int32Array): void {
  out[0] = lo & 0xff;
  out[1] = (lo >>> 8) & 0xff;
  out[2] = (lo >>> 16) & 0xff;
  out[3] = (lo >>> 24) & 0xff;
  out[4] = hi & 0xff;
  out[5] = (hi >>> 8) & 0xff;
  out[6] = (hi >>> 16) & 0xff;
  out[7] = (hi >>> 24) & 0xff;
}

export function occupancyOf(cells: ArrayLike<number>, empty: number): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 64; i++) {
    if (cells[i] !== empty) {
      if (i < 32) lo |= 1 << i;
      else hi |= 1 << (i - 32);
    }
  }
  return { lo: lo | 0, hi: hi | 0 };
}

export interface LineRules {
  /** Bits of rows that may print (no jam). */
  rowAllow: number;
  /** Bits of columns that may print (no jam, not rows-only). */
  colAllow: number;
}

/** Full printable rows (bits 0..7) and columns (bits 8..15) packed into one number. */
export function fullLinesPacked(lo: number, hi: number, rules: LineRules): number {
  let rows = 0;
  if ((lo & 0xff) === 0xff) rows |= 1;
  if (((lo >>> 8) & 0xff) === 0xff) rows |= 2;
  if (((lo >>> 16) & 0xff) === 0xff) rows |= 4;
  if (lo >>> 24 === 0xff) rows |= 8;
  if ((hi & 0xff) === 0xff) rows |= 16;
  if (((hi >>> 8) & 0xff) === 0xff) rows |= 32;
  if (((hi >>> 16) & 0xff) === 0xff) rows |= 64;
  if (hi >>> 24 === 0xff) rows |= 128;
  let a = lo & hi;
  a &= a >>> 16;
  a &= a >>> 8;
  const cols = a & 0xff & rules.colAllow;
  return (rows & rules.rowAllow) | (cols << 8);
}

/** Masks (lo, hi) of the cells covered by the given packed lines. */
export function lineCellMasks(packed: number): { lo: number; hi: number } {
  const rows = packed & 0xff;
  const cols = (packed >>> 8) & 0xff;
  const colRep = cols | (cols << 8) | (cols << 16) | (cols << 24) | 0;
  let lo = colRep;
  let hi = colRep;
  for (let r = 0; r < 4; r++) if (rows & (1 << r)) lo |= 0xff << (8 * r);
  for (let r = 4; r < 8; r++) if (rows & (1 << r)) hi |= 0xff << (8 * (r - 4));
  return { lo: lo | 0, hi: hi | 0 };
}

/** Does the shape fit anywhere? `free` = 8 free-row bytes. */
export function shapeFits(free: Int32Array, s: FastShape): boolean {
  const rows = s.rows;
  const h = s.h;
  for (let y = 0; y <= 8 - h; y++) {
    let a = 0xff;
    for (let k = 0; k < h; k++) {
      a &= ERODE[((rows[k] as number) << 8) | (free[y + k] as number)] as number;
      if (a === 0) break;
    }
    if (a !== 0) return true;
  }
  return false;
}

/** Number of anchors where the shape fits. */
export function shapeMobility(free: Int32Array, s: FastShape): number {
  const rows = s.rows;
  const h = s.h;
  let n = 0;
  for (let y = 0; y <= 8 - h; y++) {
    let a = 0xff;
    for (let k = 0; k < h; k++) {
      a &= ERODE[((rows[k] as number) << 8) | (free[y + k] as number)] as number;
      if (a === 0) break;
    }
    n += POP8[a] as number;
  }
  return n;
}

export interface HealthBasic {
  filled: number;
  /** Empty cells with all four neighbours filled (or walls). */
  holes: number;
  /** Empty cells with exactly three filled neighbours. */
  semi: number;
  rowTrans: number;
  colTrans: number;
}

const scratchRows = new Int32Array(8);

export function basicHealth(lo: number, hi: number, out: HealthBasic): void {
  const r = scratchRows;
  unpackRows(lo, hi, r);
  let holes = 0;
  let semi = 0;
  let rowT = 0;
  let colT = 0;
  for (let y = 0; y < 8; y++) {
    const v = r[y] as number;
    const f = ~v & 0xff;
    rowT += ROW_TRANS[v] as number;
    if (f !== 0) {
      const L = ((v << 1) | 1) & 0xff;
      const R = (v >>> 1) | 0x80;
      const U = y > 0 ? (r[y - 1] as number) : 0xff;
      const D = y < 7 ? (r[y + 1] as number) : 0xff;
      const all4 = L & R & U & D;
      const ge3 = (L & R & U) | (L & R & D) | (L & U & D) | (R & U & D);
      holes += POP8[f & all4] as number;
      semi += POP8[f & ge3 & ~all4] as number;
    }
    if (y < 7) colT += POP8[v ^ (r[y + 1] as number)] as number;
  }
  colT += (POP8[~(r[0] as number) & 0xff] as number) + (POP8[~(r[7] as number) & 0xff] as number);
  out.filled = popcount32(lo) + popcount32(hi);
  out.holes = holes;
  out.semi = semi;
  out.rowTrans = rowT;
  out.colTrans = colT;
}

/** Free row bytes into `out`. */
export function freeRows(lo: number, hi: number, out: Int32Array): void {
  unpackRows(lo, hi, out);
  for (let y = 0; y < 8; y++) out[y] = ~(out[y] as number) & 0xff;
}

/** Shapes the planner tracks individually for board health. */
export const KEY_SHAPES = {
  o9: fastShape('o9'),
  i5h: fastShape('i5h'),
  i5v: fastShape('i5v'),
  r6h: fastShape('r6h'),
  r6v: fastShape('r6v'),
};

export const TOTAL_WEIGHT = FAST_SHAPES.reduce((a, s) => a + s.weight, 0);
