/**
 * The forme: 64 cells with contents. Plain number arrays keep it JSON-serialisable.
 */
import { BOARD_SIZE, type Shape } from './pieces';
import { emptyRows, type ClearRules, type Rows } from './bitboard';

export const EMPTY = -1;
/** Ink colours 0..4 (pink, orange, yellow, teal, blue). */
export const INK_COUNT = 5;
/** Blind emboss (no ink) — produced by "out of ink". Clears, scores 0. */
export const BLIND = 5;
/** Leftover lead type — pre-placed grey cells. Clears, scores 0. */
export const LEAD = 6;
/** Jammed cell — permanent rivet: blocks placement and prevents its row and column from printing. */
export const JAM = 7;

export type Ink = 0 | 1 | 2 | 3 | 4;
export const INK_IDS = ['pink', 'orange', 'yellow', 'teal', 'blue'] as const;
export type InkId = (typeof INK_IDS)[number];

export type Cells = number[];

export function isInk(v: number): v is Ink {
  return v >= 0 && v < INK_COUNT;
}

export function newCells(): Cells {
  return new Array<number>(BOARD_SIZE * BOARD_SIZE).fill(EMPTY);
}

export function idx(x: number, y: number): number {
  return y * BOARD_SIZE + x;
}

export function occupancy(cells: Cells): Rows {
  const rows = emptyRows();
  for (let i = 0; i < cells.length; i++) {
    if ((cells[i] as number) !== EMPTY) {
      const y = (i / BOARD_SIZE) | 0;
      rows[y] = (rows[y] as number) | (1 << (i % BOARD_SIZE));
    }
  }
  return rows;
}

/** Occupancy of the jams alone (what the forme looks like with nothing else on it). */
export function emptyJamRows(cells: Cells): Rows {
  const rows = emptyRows();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === JAM) {
      const y = (i / BOARD_SIZE) | 0;
      rows[y] = (rows[y] as number) | (1 << (i % BOARD_SIZE));
    }
  }
  return rows;
}

export interface BlockedLines {
  /** Bit r = row r contains a jam. */
  blockedRows: number;
  /** Bit c = column c contains a jam. */
  blockedCols: number;
}

export function blockedLines(cells: Cells): BlockedLines {
  let blockedRows = 0;
  let blockedCols = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === JAM) {
      blockedRows |= 1 << ((i / BOARD_SIZE) | 0);
      blockedCols |= 1 << (i % BOARD_SIZE);
    }
  }
  return { blockedRows, blockedCols };
}

/** Bitboard clear rules matching this board's jams and the rows-only modifier. */
export function clearRulesFor(cells: Cells, rowsOnly: boolean): ClearRules {
  return { rowsOnly, ...blockedLines(cells) };
}

export function canPlaceCells(cells: Cells, shape: Shape, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + shape.w > BOARD_SIZE || y + shape.h > BOARD_SIZE) return false;
  for (const [cx, cy] of shape.cells) {
    if (cells[idx(x + cx, y + cy)] !== EMPTY) return false;
  }
  return true;
}

/** Writes the piece into the cells. Returns the indices written. */
export function placeCells(cells: Cells, shape: Shape, x: number, y: number, value: number): number[] {
  const written: number[] = [];
  for (const [cx, cy] of shape.cells) {
    const i = idx(x + cx, y + cy);
    cells[i] = value;
    written.push(i);
  }
  return written;
}

export interface FullLines {
  rows: number[];
  cols: number[];
}

/** A line prints when every cell is filled and none is jammed. */
export function findFullLines(cells: Cells, rowsOnly = false): FullLines {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    let full = true;
    for (let x = 0; x < BOARD_SIZE; x++) {
      const v = cells[idx(x, y)];
      if (v === EMPTY || v === JAM) {
        full = false;
        break;
      }
    }
    if (full) rows.push(y);
  }
  if (!rowsOnly) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      let full = true;
      for (let y = 0; y < BOARD_SIZE; y++) {
        const v = cells[idx(x, y)];
        if (v === EMPTY || v === JAM) {
          full = false;
          break;
        }
      }
      if (full) cols.push(x);
    }
  }
  return { rows, cols };
}

/** Indices of cells in a line. kind 'row' → y = n; 'col' → x = n. Ordered left→right / top→bottom. */
export function lineCells(kind: 'row' | 'col', n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < BOARD_SIZE; k++) out.push(kind === 'row' ? idx(k, n) : idx(n, k));
  return out;
}

/** Removes cleared lines. Returns the indices that were emptied (ascending). */
export function clearLines(cells: Cells, lines: FullLines): number[] {
  const cleared = new Set<number>();
  for (const y of lines.rows) for (const i of lineCells('row', y)) cleared.add(i);
  for (const x of lines.cols) for (const i of lineCells('col', x)) cleared.add(i);
  const emptied: number[] = [];
  for (const i of [...cleared].sort((a, b) => a - b)) {
    if (cells[i] !== JAM && cells[i] !== EMPTY) {
      cells[i] = EMPTY;
      emptied.push(i);
    }
  }
  return emptied;
}

/** True when no clearable content remains (jams are ignored). */
export function isBoardClean(cells: Cells): boolean {
  for (const v of cells) if (v !== EMPTY && v !== JAM) return false;
  return true;
}

export function countKind(cells: Cells, pred: (v: number) => boolean): number {
  let n = 0;
  for (const v of cells) if (pred(v)) n++;
  return n;
}
