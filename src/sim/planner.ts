/**
 * Placement planner: beam search over the pieces in hand (tray + usable type-case reserve),
 * including stash actions, on the fast bitboard model.
 *
 * Leaf value ≈ probability of finishing the contract, from an explicit model:
 *   expectedFinal = progress + gained in plan + future(sheetsLeft, SERIA, board health)
 *   P(win)        = logistic((expectedFinal − quota) / σ)
 * plus small tie-breakers (progress fraction, board health, early-finish bonus). The future term
 * uses expected print values per SERIA level measured with the real rack (EPV table, see bot.ts),
 * so streak continuity, plates and contract pressure ("far behind → bigger prints", "near the end
 * → cash in") all come out of one formula.
 */
import { BLIND, EMPTY, JAM } from '../core/board';
import type { MatrixDef, MatrixState } from '../core/matrices';
import {
  FAST_SHAPES,
  KEY_SHAPES,
  TOTAL_WEIGHT,
  basicHealth,
  freeRows,
  fullLinesPacked,
  lineCellMasks,
  pop8,
  popcount32,
  shapeFits,
  type FastShape,
  type HealthBasic,
  type LineRules,
} from './fastboard';
import { fastScore, type FastRack } from './fastscore';

export interface PlannerWeights {
  beamWidth: number;
  /** Children ranked by the cheap evaluation that get the full evaluation (× beam width). */
  fullFactor: number;
  hole: number;
  semi: number;
  trans: number;
  dead: number;
  fitAll: number;
  noO9: number;
  noI5: number;
  noR6: number;
  ready: number;
  readyCap: number;
  monoPot: number;
  pieceStuck: number;
  reserveFit: number;
  /** Relative σ of the future-points estimate. */
  cv: number;
  /** Absolute σ floor as a share of the quota. */
  sigmaFloor: number;
  /** Tie-breakers. */
  tbProgress: number;
  tbHealth: number;
  early4: number;
  earlyRare: number;
  /** Streak-break probability when the dry counter is at grace / grace−1. */
  breakAtGrace: number;
  breakAtGraceReady: number;
  breakNearGrace: number;
  /** Clamp of the health multiplier on the future print rate. */
  hMin: number;
  hMax: number;
  /** Offset so that an average board has health multiplier ≈ 1. */
  hBias: number;
}

export const DEFAULT_WEIGHTS: PlannerWeights = {
  beamWidth: 8,
  fullFactor: 3,
  hole: 0.07,
  semi: 0.025,
  trans: 0.006,
  dead: 0.08,
  fitAll: 0.5,
  noO9: 0.06,
  noI5: 0.04,
  noR6: 0.03,
  ready: 0.03,
  readyCap: 3,
  monoPot: 0.02,
  pieceStuck: 0.25,
  reserveFit: 0.03,
  cv: 0.35,
  sigmaFloor: 0.04,
  tbProgress: 0.04,
  tbHealth: 0.02,
  early4: 0.06,
  earlyRare: 0.06,
  breakAtGrace: 0.5,
  breakAtGraceReady: 0.15,
  breakNearGrace: 0.1,
  hMin: 0.25,
  hMax: 1.4,
  hBias: 0.3,
};

export interface HandPiece {
  shape: FastShape;
  ink: number;
}

export interface Move {
  /** Tray slot stashed before the placement (−1 = none). */
  stash: number;
  /** 0..2 tray slot, 3 = reserve, −1 = stash only (the stash emptied the tray → new deal). */
  from: number;
  x: number;
  y: number;
}

export interface PlanInput {
  cells: ArrayLike<number>;
  /** Hand pieces: indices 0..2 tray slots, 3 reserve. */
  hand: Array<HandPiece | null>;
  reserveEnabled: boolean;
  canStash: boolean;
  rowsOnly: boolean;
  wet: boolean;
  grace: number;
  quota: number;
  progress: number;
  sheetsLeft: number;
  sheetsUsed: number;
  sheetsBase: number;
  streak: number;
  dry: number;
  printIndex: number;
  rack: FastRack;
  /** Persistent plate states, rack order. */
  states: MatrixState[];
  /** Enabled plate defs (rack order) that have lifecycle hooks used within a contract. */
  lifecycle: Array<{ idx: number; def: MatrixDef }>;
  slotCapacity: number;
  random: () => number;
  /** Cumulative future-points table: fut[s * (N+1) + n] for SERIA s and n sheets. */
  future: FutureModel;
  /** Inks the rack rewards for monochrome lines (bitmask, 0 = any ink). */
  monoInks: number;
  /** Weight multiplier for monochrome potential (0 when the rack does not care). */
  monoValue: number;
  weights: PlannerWeights;
}

export interface FutureModel {
  maxStreak: number;
  maxSheets: number;
  /** Expected future points with SERIA s and n sheets left (health factor 1). */
  table: Float64Array;
}

export interface PlanResult {
  move: Move | null;
  value: number;
  nodes: number;
  /** Best plan wins the contract within the horizon. */
  wins: boolean;
  /** Every plan found jams. */
  dead: boolean;
}

const END_NONE = 0;
const END_DEAL = 1;
const END_WON = 2;
const END_SHEETS = 3;
const END_JAM = 4;

interface PNode {
  lo: number;
  hi: number;
  colors: Int8Array | null;
  parent: PNode | null;
  mvShape: FastShape | null;
  mvAnchor: number;
  mvInk: number;
  mvLines: number;
  code: number;
  sheetsLeft: number;
  sheetsUsed: number;
  streak: number;
  dry: number;
  printIndex: number;
  gained: number;
  states: MatrixState[];
  end: number;
  first: Move | null;
  cheap: number;
  score: number;
}

function trayAt(code: number, s: number): number {
  return ((code >>> (3 * s)) & 7) - 1;
}
function resOf(code: number): number {
  return ((code >>> 9) & 7) - 1;
}
function setTray(code: number, s: number, h: number): number {
  return (code & ~(7 << (3 * s))) | ((h + 1) << (3 * s));
}
function setRes(code: number, h: number): number {
  return (code & ~(7 << 9)) | ((h + 1) << 9);
}
function trayEmpty(code: number): boolean {
  return (code & 0x1ff) === 0;
}
function trayCount(code: number): number {
  let n = 0;
  for (let s = 0; s < 3; s++) if (code & (7 << (3 * s))) n++;
  return n;
}

/** Shapes that do not fit in a 3×3 box (I4, I5) and the total weight of those that do. */
const LONG_SHAPES = FAST_SHAPES.filter((s) => s.w > 3 || s.h > 3);
const SMALL_WEIGHT = FAST_SHAPES.filter((s) => s.w <= 3 && s.h <= 3).reduce((a, s) => a + s.weight, 0);

const hb: HealthBasic = { filled: 0, holes: 0, semi: 0, rowTrans: 0, colTrans: 0 };
const free = new Int32Array(8);
const scratchCells = new Int8Array(64);

export class Planner {
  private inp!: PlanInput;
  private rules: LineRules = { rowAllow: 0xff, colAllow: 0xff };
  private deadLo = 0;
  private deadHi = 0;
  private sigmaFloor = 0;
  private hasJam = false;
  private jamLoM = 0;
  private jamHiM = 0;
  private nodes = 0;
  private dynamic = false;

  plan(inp: PlanInput, widthOverride?: number): PlanResult {
    this.inp = inp;
    this.nodes = 0;
    const W = widthOverride ?? inp.weights.beamWidth;
    // Rules from jams / rows-only.
    let rowAllow = 0xff;
    let colAllow = inp.rowsOnly ? 0 : 0xff;
    let lo = 0;
    let hi = 0;
    const colors = new Int8Array(64);
    const jamCells: number[] = [];
    for (let i = 0; i < 64; i++) {
      const v = inp.cells[i] as number;
      colors[i] = v;
      if (v !== EMPTY) {
        if (i < 32) lo |= 1 << i;
        else hi |= 1 << (i - 32);
      }
      if (v === JAM) {
        jamCells.push(i);
        rowAllow &= ~(1 << (i >>> 3));
        colAllow &= ~(1 << (i & 7));
      }
    }
    this.hasJam = jamCells.length > 0;
    let jLo = 0;
    let jHi = 0;
    for (const i of jamCells) {
      if (i < 32) jLo |= 1 << i;
      else jHi |= 1 << (i - 32);
    }
    this.jamLoM = jLo | 0;
    this.jamHiM = jHi | 0;
    this.rules = { rowAllow, colAllow };
    let dLo = 0;
    let dHi = 0;
    for (let i = 0; i < 64; i++) {
      if (inp.cells[i] === JAM) continue;
      if (!(rowAllow & (1 << (i >>> 3))) && !(colAllow & (1 << (i & 7)))) {
        if (i < 32) dLo |= 1 << i;
        else dHi |= 1 << (i - 32);
      }
    }
    this.deadLo = dLo | 0;
    this.deadHi = dHi | 0;
    this.sigmaFloor = inp.weights.sigmaFloor * inp.quota;
    this.dynamic = inp.lifecycle.length > 0;

    let code = 0;
    for (let s = 0; s < 3; s++) if (inp.hand[s]) code = setTray(code, s, s);
    if (inp.hand[3]) code = setRes(code, 3);

    const root: PNode = {
      lo: lo | 0,
      hi: hi | 0,
      colors,
      parent: null,
      mvShape: null,
      mvAnchor: 0,
      mvInk: 0,
      mvLines: 0,
      code,
      sheetsLeft: inp.sheetsLeft,
      sheetsUsed: inp.sheetsUsed,
      streak: inp.streak,
      dry: inp.dry,
      printIndex: inp.printIndex,
      gained: 0,
      states: inp.states,
      end: END_NONE,
      first: null,
      cheap: 0,
      score: 0,
    };

    let beam: PNode[] = [root];
    const leaves: PNode[] = [];
    const K = Math.max(W, Math.round(W * inp.weights.fullFactor));
    for (let depth = 0; depth < 8 && beam.length > 0; depth++) {
      const children = new Map<number, PNode>();
      for (const node of beam) this.expand(node, children, depth === 0);
      if (children.size === 0) break;
      const open: PNode[] = [];
      const term: PNode[] = [];
      for (const c of children.values()) (c.end === END_NONE ? open : term).push(c);
      term.sort((a, b) => b.cheap - a.cheap);
      for (let k = 0; k < term.length && k < K; k++) {
        const t = term[k] as PNode;
        t.score = this.evaluate(t, true);
        leaves.push(t);
      }
      open.sort((a, b) => b.cheap - a.cheap);
      const cand = open.slice(0, K);
      for (const c of cand) c.score = this.evaluate(c, true);
      cand.sort((a, b) => b.score - a.score);
      beam = cand.slice(0, W);
    }

    let best: PNode | null = null;
    for (const l of leaves) if (!best || l.score > best.score) best = l;
    if (!best) return { move: null, value: -Infinity, nodes: this.nodes, wins: false, dead: true };
    return {
      move: best.first,
      value: best.score,
      nodes: this.nodes,
      wins: best.end === END_WON,
      dead: best.end === END_JAM,
    };
  }

  private materialize(n: PNode): Int8Array {
    if (n.colors) return n.colors;
    const p = n.parent as PNode;
    const pc = this.materialize(p);
    const c = pc.slice();
    const s = n.mvShape;
    if (s) {
      const offs = s.offsets;
      for (let k = 0; k < offs.length; k++) c[n.mvAnchor + (offs[k] as number)] = n.mvInk;
      if (n.mvLines) {
        const rows = n.mvLines & 0xff;
        const cols = (n.mvLines >>> 8) & 0xff;
        for (let i = 0; i < 64; i++) if (rows & (1 << (i >>> 3)) || cols & (1 << (i & 7))) c[i] = EMPTY;
      }
    }
    n.colors = c;
    return c;
  }

  private expand(node: PNode, out: Map<number, PNode>, isRoot: boolean): void {
    const inp = this.inp;
    const code0 = node.code;
    const res0 = resOf(code0);
    const stashOptions = inp.reserveEnabled && (inp.canStash || !isRoot) ? 4 : 1;
    for (let pre = -1; pre < stashOptions - 1; pre++) {
      let code = code0;
      if (pre >= 0) {
        const h = trayAt(code0, pre);
        if (h < 0) continue;
        if (res0 >= 0 && samePiece(inp.hand[h] as HandPiece, inp.hand[res0] as HandPiece)) continue;
        code = setTray(code0, pre, res0);
        code = setRes(code, h);
        if (trayEmpty(code)) {
          // Stashing the last tray piece deals a new tray without using a sheet.
          this.addDeal(out, node, code, isRoot ? { stash: pre, from: -1, x: 0, y: 0 } : null);
          continue;
        }
      }
      const res = resOf(code);
      // Locations to place from.
      for (let loc = 0; loc < 4; loc++) {
        let h: number;
        if (loc < 3) h = trayAt(code, loc);
        else {
          if (!inp.reserveEnabled) continue;
          h = res;
          // stash + place-from-reserve with an empty reserve duplicates a plain placement.
          if (pre >= 0 && res0 < 0) continue;
        }
        if (h < 0) continue;
        const piece = inp.hand[h] as HandPiece;
        // Skip identical pieces in earlier tray slots.
        let dup = false;
        for (let l2 = 0; l2 < loc && l2 < 3; l2++) {
          const h2 = trayAt(code, l2);
          if (h2 >= 0 && samePiece(inp.hand[h2] as HandPiece, piece)) dup = true;
        }
        if (dup) continue;
        const nextCode = loc < 3 ? setTray(code, loc, -1) : setRes(code, -1);
        const s = piece.shape;
        const pLo = s.pLo;
        const pHi = s.pHi;
        for (let k = 0; k < s.n; k++) {
          if ((node.lo & (pLo[k] as number)) !== 0 || (node.hi & (pHi[k] as number)) !== 0) continue;
          const anchor = s.pAnchor[k] as number;
          const first: Move | null = isRoot
            ? { stash: pre, from: loc, x: anchor & 7, y: anchor >>> 3 }
            : null;
          this.addPlacement(out, node, nextCode, piece, k, first);
        }
      }
    }
  }

  private addDeal(out: Map<number, PNode>, parent: PNode, code: number, first: Move | null): void {
    this.nodes++;
    const n: PNode = {
      lo: parent.lo,
      hi: parent.hi,
      colors: parent.colors,
      parent,
      mvShape: null,
      mvAnchor: 0,
      mvInk: 0,
      mvLines: 0,
      code,
      sheetsLeft: parent.sheetsLeft,
      sheetsUsed: parent.sheetsUsed,
      streak: parent.streak,
      dry: parent.dry,
      printIndex: parent.printIndex,
      gained: parent.gained,
      states: parent.states,
      end: END_DEAL,
      first: first ?? parent.first,
      cheap: 0,
      score: 0,
    };
    n.cheap = this.evaluate(n, false);
    this.insert(out, n);
  }

  private insert(out: Map<number, PNode>, n: PNode): void {
    const key =
      (Math.imul(n.lo ^ 0x5bd1e995, 0x9e3779b1) ^
        Math.imul(n.hi + 0x27d4eb2f, 0x85ebca77) ^
        Math.imul(n.code + 1, 0xc2b2ae35)) |
      0;
    const prev = out.get(key);
    if (!prev || prev.cheap < n.cheap) out.set(key, n);
  }

  private addPlacement(
    out: Map<number, PNode>,
    parent: PNode,
    code: number,
    piece: HandPiece,
    k: number,
    first: Move | null,
  ): void {
    this.nodes++;
    const inp = this.inp;
    const s = piece.shape;
    const anchor = s.pAnchor[k] as number;
    let lo = parent.lo | (s.pLo[k] as number);
    let hi = parent.hi | (s.pHi[k] as number);
    const lines = fullLinesPacked(lo, hi, this.rules);
    const sheetsLeft = parent.sheetsLeft - 1;
    const sheetsUsed = parent.sheetsUsed + 1;
    let streak = parent.streak;
    let dry = parent.dry;
    let gained = parent.gained;
    let printIndex = parent.printIndex;
    let states = parent.states;
    if (lines !== 0) {
      const L = pop8(lines) + pop8(lines >>> 8);
      if (!inp.wet) streak += L;
      dry = 0;
      // Pre-clear colours for scoring.
      const pc = this.materialize(parent);
      scratchCells.set(pc);
      const offs = s.offsets;
      for (let j = 0; j < offs.length; j++) scratchCells[anchor + (offs[j] as number)] = piece.ink;
      const m = lineCellMasks(lines);
      const nlo = lo & ~m.lo;
      const nhi = hi & ~m.hi;
      const clean = this.hasJam ? ((nlo & ~this.jamLoM) | (nhi & ~this.jamHiM)) === 0 : (nlo | nhi) === 0;
      const r = fastScore({
        cells: scratchCells,
        lines,
        pieceSize: s.size,
        streak: inp.wet ? 0 : streak,
        sheetsLeft,
        sheetsUsed,
        printIndex,
        cleanAfter: clean,
        rack: inp.rack,
        states,
        slotCapacity: inp.slotCapacity,
        random: inp.random,
      });
      gained += r.total;
      printIndex++;
      lo = nlo;
      hi = nhi;
      if (this.dynamic) {
        states = states.slice();
        for (const lc of inp.lifecycle) {
          const st = { ...(states[lc.idx] as MatrixState) };
          lc.def.afterPrint?.(r.ctx, st);
          lc.def.afterPlace?.(true, st);
          states[lc.idx] = st;
        }
      }
    } else {
      if (!inp.wet && streak > 0) {
        dry++;
        if (dry > inp.grace) {
          streak = 0;
          dry = 0;
        }
      }
      if (this.dynamic) {
        let copied = false;
        for (const lc of inp.lifecycle) {
          if (!lc.def.afterPlace) continue;
          if (!copied) {
            states = states.slice();
            copied = true;
          }
          const st = { ...(states[lc.idx] as MatrixState) };
          lc.def.afterPlace(false, st);
          states[lc.idx] = st;
        }
      }
    }
    let end = END_NONE;
    if (inp.progress + gained >= inp.quota) end = END_WON;
    else if (sheetsLeft <= 0) end = END_SHEETS;
    else if (trayEmpty(code)) end = END_DEAL;
    else {
      freeRows(lo, hi, free);
      let any = false;
      for (let t = 0; t < 3 && !any; t++) {
        const h = trayAt(code, t);
        if (h >= 0 && shapeFits(free, (inp.hand[h] as HandPiece).shape)) any = true;
      }
      const rr = resOf(code);
      if (!any && inp.reserveEnabled && rr >= 0 && shapeFits(free, (inp.hand[rr] as HandPiece).shape))
        any = true;
      // Type Case escape (RunEngine.anyMoveAvailable): the last tray piece can be stashed into an
      // empty case — a placement resets stashUsed and sheetsLeft > 0 here — which deals a fresh,
      // fair tray. Not a jam: the next depth expands the stash (→ END_DEAL).
      if (!any && inp.reserveEnabled && rr < 0 && trayCount(code) === 1) any = true;
      if (!any) end = END_JAM;
    }
    const n: PNode = {
      lo: lo | 0,
      hi: hi | 0,
      colors: null,
      parent,
      mvShape: s,
      mvAnchor: anchor,
      mvInk: piece.ink,
      mvLines: lines,
      code,
      sheetsLeft,
      sheetsUsed,
      streak,
      dry,
      printIndex,
      gained,
      states,
      end,
      first: first ?? parent.first,
      cheap: 0,
      score: 0,
    };
    n.cheap = this.evaluate(n, false);
    this.insert(out, n);
  }

  /** Value of a node (see file header). `full` adds the expensive board features. */
  private evaluate(n: PNode, full: boolean): number {
    const inp = this.inp;
    const w = inp.weights;
    const total = inp.progress + n.gained;
    const progressFrac = Math.min(total / inp.quota, 1.5);
    if (n.end === END_WON) {
      let v = 2 + w.tbProgress * progressFrac;
      if (n.sheetsUsed <= 0.6 * inp.sheetsBase + 1e-9) v += w.early4;
      if (n.sheetsUsed <= 0.4 * inp.sheetsBase + 1e-9) v += w.earlyRare;
      return v - 0.001 * n.sheetsUsed;
    }
    if (n.end === END_JAM) return -2 + w.tbProgress * progressFrac;
    if (n.end === END_SHEETS) return -1 + w.tbProgress * progressFrac;

    basicHealth(n.lo, n.hi, hb);
    let health = -w.hole * hb.holes - w.semi * hb.semi - w.trans * (hb.rowTrans + hb.colTrans - 16);
    if (this.deadLo | this.deadHi) {
      health -= w.dead * (popcount32(n.lo & this.deadLo) + popcount32(n.hi & this.deadHi));
    }
    this.readyLines = -1;
    if (full) health += this.fullFeatures(n);

    // Streak-break risk at the end of the plan.
    let pBreak = 0;
    if (!inp.wet && n.streak > 0) {
      if (n.dry >= inp.grace)
        pBreak =
          this.readyLines < 0
            ? 0.5 * (w.breakAtGrace + w.breakAtGraceReady)
            : this.readyLines >= 1
              ? w.breakAtGraceReady
              : w.breakAtGrace;
      else if (n.dry === inp.grace - 1) pBreak = w.breakNearGrace;
    }
    const h = clamp(1 + w.hBias + health, w.hMin, w.hMax);
    const fm = inp.future;
    const sheets = Math.min(n.sheetsLeft, fm.maxSheets);
    const st = Math.min(n.streak, fm.maxStreak);
    const row = fm.maxSheets + 1;
    let fut = fm.table[st * row + sheets] as number;
    if (pBreak > 0) fut = (1 - pBreak) * fut + pBreak * (fm.table[sheets] as number);
    fut *= h;
    const sigma = w.cv * fut + this.sigmaFloor;
    const z = (total + fut - inp.quota) / sigma;
    const p = 1 / (1 + Math.exp(-1.7 * z));
    return p + w.tbProgress * progressFrac + w.tbHealth * health;
  }

  private readyLines = 0;

  /** Expensive features: shape fits, ready lines, mono potential, stuck pieces, reserve. */
  private fullFeatures(n: PNode): number {
    const inp = this.inp;
    const w = inp.weights;
    freeRows(n.lo, n.hi, free);
    // Every shape with a bounding box ≤ 3×3 fits wherever the 3×3 square fits.
    const o9 = shapeFits(free, KEY_SHAPES.o9);
    let fitW = 0;
    if (o9) {
      fitW = SMALL_WEIGHT;
      for (const s of LONG_SHAPES) if (shapeFits(free, s)) fitW += s.weight;
    } else {
      for (const s of FAST_SHAPES) if (shapeFits(free, s)) fitW += s.weight;
    }
    let v = -w.fitAll * (1 - fitW / TOTAL_WEIGHT);
    if (!o9) v -= w.noO9;
    if (!shapeFits(free, KEY_SHAPES.i5h)) v -= w.noI5;
    if (!shapeFits(free, KEY_SHAPES.i5v)) v -= w.noI5;
    if (!o9) {
      if (!shapeFits(free, KEY_SHAPES.r6h)) v -= w.noR6 * 0.5;
      if (!shapeFits(free, KEY_SHAPES.r6v)) v -= w.noR6 * 0.5;
    }

    // Ready lines: printable lines with 1..2 empty cells (none blocked).
    let ready = 0;
    const rowAllow = this.rules.rowAllow;
    const colAllow = this.rules.colAllow;
    for (let y = 0; y < 8; y++) {
      if (!(rowAllow & (1 << y))) continue;
      const e = pop8(free[y] as number);
      if (e >= 1 && e <= 2) ready++;
    }
    if (colAllow) {
      for (let x = 0; x < 8; x++) {
        if (!(colAllow & (1 << x))) continue;
        let e = 0;
        for (let y = 0; y < 8; y++) if ((free[y] as number) & (1 << x)) e++;
        if (e >= 1 && e <= 2) ready++;
      }
    }
    this.readyLines = ready;
    v += w.ready * Math.min(ready, w.readyCap);

    // Remaining pieces of the current tray that cannot be placed right now.
    if (n.end === END_NONE) {
      for (let t = 0; t < 3; t++) {
        const h = trayAt(n.code, t);
        if (h >= 0 && !shapeFits(free, (inp.hand[h] as HandPiece).shape)) v -= w.pieceStuck;
      }
    }
    // A reserve piece that fits is insurance against jams.
    const rr = resOf(n.code);
    if (inp.reserveEnabled && rr >= 0) {
      const rp = inp.hand[rr] as HandPiece;
      if (shapeFits(free, rp.shape)) v += w.reserveFit * (rp.shape.size <= 3 ? 1.5 : 1);
    }

    // Monochrome potential (base +2 mult per mono line; Monotype / Ink Well / ink plates).
    if (inp.monoValue > 0) {
      const c = this.materialize(n);
      let pot = 0;
      for (let y = 0; y < 8; y++) {
        if (!(rowAllow & (1 << y))) continue;
        pot += monoLineScore(c, y * 8, 1, inp.monoInks);
      }
      if (colAllow) {
        for (let x = 0; x < 8; x++) {
          if (!(colAllow & (1 << x))) continue;
          pot += monoLineScore(c, x, 8, inp.monoInks);
        }
      }
      v += w.monoPot * inp.monoValue * pot;
    }
    return v;
  }
}

/** Partial monochrome line: (filled / 8)² when every filled cell has the same (wanted) ink. */
function monoLineScore(c: Int8Array, start: number, step: number, inks: number): number {
  let ink = -1;
  let filled = 0;
  for (let k = 0; k < 8; k++) {
    const v = c[start + k * step] as number;
    if (v === EMPTY) continue;
    if (v < 0 || v >= BLIND) return 0;
    if (ink < 0) ink = v;
    else if (ink !== v) return 0;
    filled++;
  }
  if (filled < 3 || ink < 0) return 0;
  if (inks !== 0 && !(inks & (1 << ink))) return 0;
  const f = filled / 8;
  return f * f;
}

function samePiece(a: HandPiece, b: HandPiece): boolean {
  return a.shape === b.shape && a.ink === b.ink;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
