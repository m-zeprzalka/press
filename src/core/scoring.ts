/**
 * Print scoring (GDD §5): PRINTS × MULT with a full event log for presentation.
 *
 * Phases:
 *  1. cells  — base prints per cell (per printed line), plate cell hooks (prints only, retriggers)
 *  2. lines  — plate line hooks (prints only, line multipliers)
 *  3. base   — MULT = lines + max(0, SERIA − 1) + monoLineMult × mono lines
 *  4. print  — plate print hooks in rack order (all + / × MULT effects, flat prints)
 *  5. total  — floor(PRINTS × MULT)
 * Plate growth (afterPrint) is run by the engine after scoring.
 */
import { BALANCE } from './config/balance';
import { BOARD_SIZE } from './pieces';
import {
  EMPTY,
  JAM,
  clearLines,
  countKind,
  isBoardClean,
  isInk,
  lineCells,
  type Cells,
  type FullLines,
  type Ink,
} from './board';
import {
  matrixDef,
  type CellCtx,
  type LineCtx,
  type LineRef,
  type MatrixDef,
  type MatrixInstance,
  type MatrixState,
  type PrintCtx,
  type ScoreApi,
} from './matrices';

/** Where a scoring contribution came from. Numbers are plate slot indices. */
export type ScoreSource = 'base' | 'lines' | 'streak' | 'mono' | number;

export type ScoreEvent =
  | { t: 'line'; ref: LineRef }
  | { t: 'cell'; i: number; ref: LineRef; again: boolean }
  | { t: 'p'; v: number; src: ScoreSource; P: number; i?: number; ref?: LineRef }
  | { t: 'm'; v: number; src: ScoreSource; M: number }
  | { t: 'x'; v: number; src: ScoreSource; M: number }
  | { t: 'lx'; v: number; src: ScoreSource; ref: LineRef; P: number };

export interface SlotInput {
  inst: MatrixInstance;
  enabled: boolean;
}

export interface PrintInput {
  /** Board after placement, before clearing. */
  cells: Cells;
  lines: FullLines;
  pieceSize: number;
  /** SERIA including this print (0 when streaks are disabled). */
  streak: number;
  sheetsLeft: number;
  sheetsUsed: number;
  printIndex: number;
  slots: readonly SlotInput[];
  slotCapacity: number;
  /** Random source for chance-based plates (golden type). */
  random: () => number;
}

export interface PrintResult {
  total: number;
  prints: number;
  mult: number;
  events: ScoreEvent[];
  ctx: PrintCtx;
  /** How many scoring contributions each slot made (for stats/animation). */
  triggers: number[];
}

export function lineRefs(lines: FullLines): LineRef[] {
  return [
    ...lines.rows.map((n) => ({ kind: 'row' as const, n })),
    ...lines.cols.map((n) => ({ kind: 'col' as const, n })),
  ];
}

export function lineInfo(cells: Cells, ref: LineRef): LineCtx {
  const ids = lineCells(ref.kind, ref.n);
  const inks = new Set<Ink>();
  let mono = true;
  let first: number | null = null;
  for (const i of ids) {
    const v = cells[i] as number;
    if (isInk(v)) {
      inks.add(v);
      if (first === null) first = v;
      else if (first !== v) mono = false;
    } else {
      // Blind emboss / lead break monochrome.
      mono = false;
    }
  }
  return {
    ref,
    cells: ids,
    inks: [...inks].sort((a, b) => a - b),
    mono: mono && first !== null,
    edge: ref.n === 0 || ref.n === BOARD_SIZE - 1,
  };
}

/** Facts about a print, independent of plates. */
export function buildPrintCtx(input: {
  cells: Cells;
  lines: FullLines;
  pieceSize: number;
  streak: number;
  sheetsLeft: number;
  sheetsUsed: number;
  printIndex: number;
  slotCapacity: number;
  ownedSlots: number;
}): PrintCtx {
  const refs = lineRefs(input.lines);
  const inkSet = new Set<Ink>();
  const lineInkCounts: number[] = [];
  let monoLines = 0;
  for (const ref of refs) {
    const info = lineInfo(input.cells, ref);
    if (info.mono) monoLines++;
    lineInkCounts.push(info.inks.length);
    for (const k of info.inks) inkSet.add(k);
  }
  const after = input.cells.slice();
  clearLines(after, input.lines);
  return {
    lines: refs,
    lineCount: refs.length,
    rowCount: input.lines.rows.length,
    colCount: input.lines.cols.length,
    intersections: input.lines.rows.length * input.lines.cols.length,
    inks: [...inkSet].sort((a, b) => a - b),
    lineInkCounts,
    monoLines,
    pieceSize: input.pieceSize,
    streak: input.streak,
    sheetsLeft: input.sheetsLeft,
    sheetsUsed: input.sheetsUsed,
    printIndex: input.printIndex,
    boardCleanAfter: isBoardClean(after),
    cellsAfter: countKind(after, (v) => v !== EMPTY && v !== JAM),
    emptySlots: Math.max(0, input.slotCapacity - input.ownedSlots),
  };
}

export function cellBasePrints(v: number): number {
  return isInk(v) ? BALANCE.cellPrints : 0;
}

interface Resolved {
  def: MatrixDef;
  state: MatrixState;
}

/**
 * The definition whose printing hooks slot `i` runs: itself, or for Mirror the
 * plate to its right (chains through further Mirrors). Disabled → nothing.
 */
export function resolveSlot(slots: readonly SlotInput[], i: number): Resolved | null {
  for (let k = i; k < slots.length; k++) {
    const s = slots[k] as SlotInput;
    if (!s.enabled) return null;
    const def = matrixDef(s.inst.id);
    if (def.id !== 'mirror') return { def, state: s.inst.state };
  }
  return null;
}

type Phase = 'cell' | 'line' | 'base' | 'print';

export function scorePrint(input: PrintInput): PrintResult {
  const owned = input.slots.length;
  const ctx = buildPrintCtx({ ...input, ownedSlots: owned });
  const events: ScoreEvent[] = [];
  const triggers = new Array<number>(owned).fill(0);
  let P = 0;
  let M = 0;
  let lineP = 0;
  let phase: Phase = 'cell';
  let src: ScoreSource = 'base';
  let curRef: LineRef | undefined;
  let curCell: number | undefined;
  let retriggers = 0;

  const bump = () => {
    if (typeof src === 'number') triggers[src] = (triggers[src] as number) + 1;
  };
  const requireMultPhase = () => {
    if (phase !== 'print' && phase !== 'base') {
      throw new Error(`MULT effects are only allowed in the print phase (got ${phase})`);
    }
  };

  const api: ScoreApi = {
    prints(n) {
      if (n === 0) return;
      P += n;
      if (phase === 'cell' || phase === 'line') lineP += n;
      const e: ScoreEvent = { t: 'p', v: n, src, P };
      if (curCell !== undefined) e.i = curCell;
      if (curRef) e.ref = curRef;
      events.push(e);
      bump();
    },
    mult(n) {
      requireMultPhase();
      if (n === 0) return;
      M += n;
      events.push({ t: 'm', v: n, src, M });
      bump();
    },
    xmult(f) {
      requireMultPhase();
      if (f === 1) return;
      M *= f;
      events.push({ t: 'x', v: f, src, M });
      bump();
    },
    linePrintsX(f) {
      if (phase !== 'line' || !curRef || f === 1) return;
      const extra = lineP * (f - 1);
      P += extra;
      lineP += extra;
      events.push({ t: 'lx', v: f, src, ref: curRef, P });
      bump();
    },
    retrigger() {
      if (phase === 'cell') retriggers++;
    },
    random: input.random,
  };

  const resolved = input.slots.map((_, i) => resolveSlot(input.slots, i));
  const scratch: MatrixState[] = input.slots.map(() => ({}));

  const run = (stage: 'cell' | 'line' | 'print', arg: CellCtx | LineCtx | PrintCtx) => {
    for (let i = 0; i < resolved.length; i++) {
      const r = resolved[i];
      const hook = r?.def[stage] as
        ((a: ScoreApi, x: typeof arg, st: MatrixState, tmp: MatrixState) => void) | undefined;
      if (!r || !hook) continue;
      src = i;
      hook(api, arg, r.state, scratch[i] as MatrixState);
    }
  };

  const rowSet = new Set(input.lines.rows);
  const colSet = new Set(input.lines.cols);

  // 1–2. Lines and their cells.
  for (const ref of ctx.lines) {
    const info = lineInfo(input.cells, ref);
    events.push({ t: 'line', ref });
    curRef = ref;
    lineP = 0;
    phase = 'cell';
    for (const i of info.cells) {
      const v = input.cells[i] as number;
      const base: Omit<CellCtx, 'again'> = {
        index: i,
        value: v,
        ink: isInk(v) ? v : null,
        line: ref,
        intersection: rowSet.has((i / BOARD_SIZE) | 0) && colSet.has(i % BOARD_SIZE),
      };
      retriggers = 0;
      let passes = 1;
      for (let pass = 0; pass < passes; pass++) {
        const again = pass > 0;
        events.push({ t: 'cell', i, ref, again });
        curCell = i;
        src = 'base';
        api.prints(cellBasePrints(v));
        run('cell', { ...base, again });
        if (!again) passes = 1 + retriggers;
      }
      curCell = undefined;
    }
    phase = 'line';
    run('line', info);
  }
  curRef = undefined;

  // 3. Base mult.
  phase = 'base';
  src = 'lines';
  api.mult(ctx.lineCount);
  if (input.streak > 1) {
    src = 'streak';
    api.mult(input.streak - 1);
  }
  if (ctx.monoLines > 0) {
    src = 'mono';
    api.mult(BALANCE.monoLineMult * ctx.monoLines);
  }

  // 4. Plates, rack order.
  phase = 'print';
  run('print', ctx);

  const total = Math.floor(P * M + 1e-9);
  return { total, prints: P, mult: M, events, ctx, triggers };
}
