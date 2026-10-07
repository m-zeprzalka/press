/**
 * Event-free print scoring for the planner.
 *
 * Mirrors `scorePrint` (src/core/scoring.ts) phase by phase and in the same floating-point
 * order, but builds no event log, reuses one mutable cell context and skips phases no plate
 * uses. Plate logic is NOT duplicated: the real `MatrixDef` hooks are called. Equality with
 * the core scorer is checked by `npm run sim -- selftest`.
 *
 * Proposed core change: expose this as `scorePrint(input, { events: false })` (see report).
 */
import { BALANCE } from '../core/config/balance';
import { EMPTY, JAM } from '../core/board';
import type {
  CellCtx,
  LineCtx,
  LineRef,
  MatrixDef,
  MatrixId,
  MatrixInstance,
  MatrixState,
  PrintCtx,
  ScoreApi,
} from '../core/matrices';
import { matrixDef } from '../core/matrices';

/** Printing hooks a rack slot runs (Mirror resolved to its neighbour). */
export interface FastSlot {
  def: MatrixDef | null;
  /** Rack index whose persistent state the hooks read. */
  stateIdx: number;
}

export interface FastRack {
  slots: FastSlot[];
  owned: number;
  hasCell: boolean;
  hasLine: boolean;
  hasPrint: boolean;
}

/** Same resolution rule as `resolveSlot` in scoring.ts. */
export function buildRack(ids: readonly MatrixId[], enabled: readonly boolean[]): FastRack {
  const slots: FastSlot[] = [];
  for (let i = 0; i < ids.length; i++) {
    let def: MatrixDef | null = null;
    let stateIdx = i;
    for (let k = i; k < ids.length; k++) {
      if (!enabled[k]) break;
      const d = matrixDef(ids[k] as MatrixId);
      if (d.id !== 'mirror') {
        def = d;
        stateIdx = k;
        break;
      }
    }
    slots.push({ def, stateIdx });
  }
  return {
    slots,
    owned: ids.length,
    hasCell: slots.some((s) => s.def?.cell !== undefined),
    hasLine: slots.some((s) => s.def?.line !== undefined),
    hasPrint: slots.some((s) => s.def?.print !== undefined),
  };
}

export function rackFromInstances(
  plates: readonly MatrixInstance[],
  enabled: (p: MatrixInstance) => boolean,
): FastRack {
  return buildRack(
    plates.map((p) => p.id),
    plates.map((p) => enabled(p)),
  );
}

export interface FastPrintInput {
  /** Board after placement, before clearing (64 values: EMPTY, ink 0..4, BLIND, LEAD, JAM). */
  cells: ArrayLike<number>;
  /** Printed rows (bits 0..7) and columns (bits 8..15). */
  lines: number;
  pieceSize: number;
  streak: number;
  sheetsLeft: number;
  sheetsUsed: number;
  printIndex: number;
  /** Board has no content (other than jams) once the lines are cleared. */
  cleanAfter: boolean;
  rack: FastRack;
  states: readonly MatrixState[];
  slotCapacity: number;
  random: () => number;
}

export interface FastPrintResult {
  total: number;
  ctx: PrintCtx;
}

const ROW_CELLS: number[][] = [];
const COL_CELLS: number[][] = [];
for (let n = 0; n < 8; n++) {
  ROW_CELLS.push(Array.from({ length: 8 }, (_, k) => n * 8 + k));
  COL_CELLS.push(Array.from({ length: 8 }, (_, k) => k * 8 + n));
}
const ROW_REFS: LineRef[] = Array.from({ length: 8 }, (_, n) => ({ kind: 'row' as const, n }));
const COL_REFS: LineRef[] = Array.from({ length: 8 }, (_, n) => ({ kind: 'col' as const, n }));
const INK_LISTS: number[][] = Array.from({ length: 32 }, (_, m) =>
  [0, 1, 2, 3, 4].filter((k) => m & (1 << k)),
);
const INK_POP: number[] = INK_LISTS.map((l) => l.length);

class Api implements ScoreApi {
  P = 0;
  M = 0;
  lineP = 0;
  phase = 0; // 0 cell, 1 line, 2 print
  retriggers = 0;
  random: () => number = Math.random;
  prints(n: number): void {
    if (n === 0) return;
    this.P += n;
    if (this.phase < 2) this.lineP += n;
  }
  mult(n: number): void {
    if (n === 0) return;
    this.M += n;
  }
  xmult(f: number): void {
    if (f === 1) return;
    this.M *= f;
  }
  linePrintsX(f: number): void {
    if (this.phase !== 1 || f === 1) return;
    const extra = this.lineP * (f - 1);
    this.P += extra;
    this.lineP += extra;
  }
  retrigger(): void {
    if (this.phase === 0) this.retriggers++;
  }
}

const api = new Api();
const cellCtx: CellCtx = {
  index: 0,
  value: 0,
  ink: null,
  line: { kind: 'row', n: 0 },
  intersection: false,
  again: false,
};
const EMPTY_STATE: MatrixState = {};

export function fastScore(input: FastPrintInput): FastPrintResult {
  const cells = input.cells;
  const rowMask = input.lines & 0xff;
  const colMask = (input.lines >>> 8) & 0xff;
  const rack = input.rack;
  const slots = rack.slots;
  const states = input.states;
  const nSlots = slots.length;
  const scratch: MatrixState[] = new Array<MatrixState>(nSlots);
  for (let i = 0; i < nSlots; i++) scratch[i] = {};

  const refs: LineRef[] = [];
  for (let n = 0; n < 8; n++) if (rowMask & (1 << n)) refs.push(ROW_REFS[n] as LineRef);
  for (let n = 0; n < 8; n++) if (colMask & (1 << n)) refs.push(COL_REFS[n] as LineRef);
  const lineCount = refs.length;
  const rowCount = pop(rowMask);
  const colCount = pop(colMask);

  // Line facts (inks, mono) — same rules as lineInfo().
  let inkUnion = 0;
  let monoLines = 0;
  const lineInkCounts: number[] = new Array<number>(lineCount);
  const lineInkMask: number[] = new Array<number>(lineCount);
  const lineMono: boolean[] = new Array<boolean>(lineCount);
  for (let l = 0; l < lineCount; l++) {
    const ref = refs[l] as LineRef;
    const ids = ref.kind === 'row' ? (ROW_CELLS[ref.n] as number[]) : (COL_CELLS[ref.n] as number[]);
    let mask = 0;
    let mono = true;
    let first = -1;
    for (let k = 0; k < 8; k++) {
      const v = cells[ids[k] as number] as number;
      if (v >= 0 && v < 5) {
        mask |= 1 << v;
        if (first < 0) first = v;
        else if (first !== v) mono = false;
      } else mono = false;
    }
    const isMono = mono && first >= 0;
    if (isMono) monoLines++;
    lineMono[l] = isMono;
    lineInkMask[l] = mask;
    lineInkCounts[l] = INK_POP[mask] as number;
    inkUnion |= mask;
  }

  const ctx: PrintCtx = {
    lines: refs,
    lineCount,
    rowCount,
    colCount,
    intersections: rowCount * colCount,
    inks: (INK_LISTS[inkUnion] as number[]).slice() as PrintCtx['inks'],
    lineInkCounts,
    monoLines,
    pieceSize: input.pieceSize,
    streak: input.streak,
    sheetsLeft: input.sheetsLeft,
    sheetsUsed: input.sheetsUsed,
    printIndex: input.printIndex,
    boardCleanAfter: input.cleanAfter,
    emptySlots: Math.max(0, input.slotCapacity - rack.owned),
  };

  api.P = 0;
  api.M = 0;
  api.lineP = 0;
  api.random = input.random;
  const cellPrints = BALANCE.cellPrints;

  // 1–2. Lines and their cells.
  for (let l = 0; l < lineCount; l++) {
    const ref = refs[l] as LineRef;
    const ids = ref.kind === 'row' ? (ROW_CELLS[ref.n] as number[]) : (COL_CELLS[ref.n] as number[]);
    api.lineP = 0;
    api.phase = 0;
    if (!rack.hasCell) {
      // Fast path: base prints only.
      let n = 0;
      for (let k = 0; k < 8; k++) {
        const v = cells[ids[k] as number] as number;
        if (v >= 0 && v < 5) n++;
      }
      if (n > 0) api.prints(n * cellPrints);
    } else {
      for (let k = 0; k < 8; k++) {
        const i = ids[k] as number;
        const v = cells[i] as number;
        const ink = v >= 0 && v < 5;
        cellCtx.index = i;
        cellCtx.value = v;
        cellCtx.ink = ink ? (v as CellCtx['ink']) : null;
        cellCtx.line = ref;
        cellCtx.intersection = (rowMask & (1 << (i >>> 3))) !== 0 && (colMask & (1 << (i & 7))) !== 0;
        api.retriggers = 0;
        let passes = 1;
        for (let pass = 0; pass < passes; pass++) {
          cellCtx.again = pass > 0;
          api.prints(ink ? cellPrints : 0);
          for (let s = 0; s < nSlots; s++) {
            const slot = slots[s] as FastSlot;
            const hook = slot.def?.cell;
            if (hook) hook(api, cellCtx, states[slot.stateIdx] ?? EMPTY_STATE, scratch[s] as MatrixState);
          }
          if (pass === 0) passes = 1 + api.retriggers;
        }
      }
    }
    api.phase = 1;
    if (rack.hasLine) {
      const info: LineCtx = {
        ref,
        cells: ids,
        inks: INK_LISTS[lineInkMask[l] as number] as LineCtx['inks'],
        mono: lineMono[l] as boolean,
        edge: ref.n === 0 || ref.n === 7,
      };
      for (let s = 0; s < nSlots; s++) {
        const slot = slots[s] as FastSlot;
        const hook = slot.def?.line;
        if (hook) hook(api, info, states[slot.stateIdx] ?? EMPTY_STATE, scratch[s] as MatrixState);
      }
    }
  }

  // 3. Base mult.
  api.phase = 2;
  api.mult(lineCount);
  if (input.streak > 1) api.mult(input.streak - 1);
  if (monoLines > 0) api.mult(BALANCE.monoLineMult * monoLines);

  // 4. Plates in rack order.
  if (rack.hasPrint) {
    for (let s = 0; s < nSlots; s++) {
      const slot = slots[s] as FastSlot;
      const hook = slot.def?.print;
      if (hook) hook(api, ctx, states[slot.stateIdx] ?? EMPTY_STATE, scratch[s] as MatrixState);
    }
  }

  const total = Math.floor(api.P * api.M + 1e-9);
  return { total, ctx };
}

function pop(v: number): number {
  let n = 0;
  while (v) {
    v &= v - 1;
    n++;
  }
  return n;
}

/** True when the cells outside the printed lines hold nothing but empties and jams. */
export function cleanAfterLines(cells: ArrayLike<number>, lines: number): boolean {
  const rowMask = lines & 0xff;
  const colMask = (lines >>> 8) & 0xff;
  for (let i = 0; i < 64; i++) {
    const v = cells[i] as number;
    if (v === EMPTY || v === JAM) continue;
    if (rowMask & (1 << (i >>> 3)) || colMask & (1 << (i & 7))) continue;
    return false;
  }
  return true;
}

/** A deterministic stand-in for golden type's random draws: exactly 1 in 4 below 0.25. */
export function patternRandom(): () => number {
  const seq = [0.6, 0.1, 0.9, 0.4];
  let k = 0;
  return () => {
    const v = seq[k & 3] as number;
    k++;
    return v;
  };
}
