/**
 * Run engine: the whole roguelite run as a JSON-serialisable state machine (GDD §2–§10).
 *
 * The engine is synchronous and deterministic: every random decision comes from a
 * stream derived from (seed, context, indices). UI/animation consume the returned events.
 */
import { BALANCE } from './config/balance';
import {
  EMPTY,
  INK_COUNT,
  JAM,
  canPlaceCells,
  clearLines,
  findFullLines,
  idx,
  isInk,
  newCells,
  placeCells,
  type Cells,
  type FullLines,
} from './board';
import { fits } from './bitboard';
import { occupancy } from './board';
import {
  contractBoard,
  contractSpec,
  editionModifiers,
  editionOf,
  hasModifier,
  isSpecialIndex,
  totalContracts,
  type ContractSpec,
  type Modifier,
} from './contracts';
import { dealTray } from './generator';
import {
  MATRICES,
  createInstance,
  matrixDef,
  sellValue,
  type MatrixId,
  type MatrixInstance,
  type Rarity,
} from './matrices';
import { BOARD_SIZE, shapeById, type Shape } from './pieces';
import { Rng } from './rng';
import { scorePrint, type PrintResult, type SlotInput } from './scoring';

export const RUN_STATE_VERSION = 1;

export type RunMode = 'standard' | 'daily';
export type RunPhase = 'playing' | 'last_chance' | 'offer' | 'lost' | 'victory' | 'over';
export type LossReason = 'quota' | 'jam';
export type SlotRef = number | 'reserve';

export interface TrayPiece {
  uid: number;
  shape: string;
  /** 0..4 ink or BLIND. */
  ink: number;
}

export interface OfferState {
  /** Offer number within the run (= index of the contract just won). */
  index: number;
  cards: MatrixId[];
  cardCount: number;
  guaranteeRare: boolean;
  /** Rerolls done on this screen (stream index). */
  rerolls: number;
  adRerollsHere: number;
}

export interface ContractState {
  spec: ContractSpec;
  progress: number;
  sheetsLeft: number;
  /** Sheets granted at start (base + plates + carried bonus) plus any added later. */
  sheetsGranted: number;
  sheetsUsed: number;
  printIndex: number;
  streak: number;
  dry: number;
  trayIndex: number;
  disabledUid: number | null;
  bestPrint: number;
  /** Printed cell count per ink (dominant ink for the share card). */
  inkPrinted: number[];
}

export interface ContractRecord {
  index: number;
  won: boolean;
  progress: number;
  quota: number;
  sheetsUsed: number;
  dominantInk: number | null;
}

export interface RunTotals {
  score: number;
  bestPrint: number;
  lines: number;
  prints: number;
  placements: number;
  contractsWon: number;
  maxStreak: number;
  maxLines: number;
  history: ContractRecord[];
}

export interface RunState {
  v: number;
  seed: string;
  mode: RunMode;
  dailyDate: string | null;
  phase: RunPhase;
  contractIndex: number;
  /** Revealed special-contract modifiers per edition (key = edition). */
  editionModifiers: Record<string, Modifier[]>;
  contract: ContractState;
  cells: Cells;
  tray: Array<TrayPiece | null>;
  traySize: number;
  reserve: TrayPiece | null;
  /** A stash action was used since the last placement. */
  stashUsed: boolean;
  plates: MatrixInstance[];
  nextUid: number;
  offer: OfferState | null;
  freeRerolls: number;
  adRerollsUsed: number;
  continueUsed: boolean;
  /** Sheets carried into the next contract (skip / sales between contracts). */
  pendingSheets: number;
  carryStreak: number;
  lossReason: LossReason | null;
  endless: boolean;
  /** Plates that offers may contain (unlocked in meta). */
  pool: MatrixId[];
  totals: RunTotals;
}

export interface RunOptions {
  seed: string;
  mode?: RunMode;
  dailyDate?: string | null;
  pool?: readonly MatrixId[];
  /** Plates installed at start (daily rule). */
  startPlates?: readonly MatrixId[];
}

export type RunEvent =
  | { type: 'contract_started'; spec: ContractSpec; sheets: number; disabledUid: number | null }
  | { type: 'dealt'; pieces: TrayPiece[]; fallback: boolean; attempts: number; nodes: number }
  | { type: 'placed'; slot: SlotRef; piece: TrayPiece; x: number; y: number; cells: number[] }
  | {
      type: 'printed';
      result: PrintResult;
      lines: FullLines;
      /** Board contents of the cleared cells before clearing. */
      cleared: Array<{ i: number; v: number }>;
      streak: number;
      progress: number;
    }
  | { type: 'streak'; streak: number; dry: number; grace: number; broken: boolean }
  | { type: 'stashed'; from: number; piece: TrayPiece; swapped: TrayPiece | null }
  | {
      type: 'contract_won';
      index: number;
      progress: number;
      quota: number;
      sheetsUsed: number;
      cards: number;
      guaranteeRare: boolean;
    }
  | { type: 'offer'; offer: OfferState }
  | { type: 'plate_added'; inst: MatrixInstance; slot: number; replaced: MatrixInstance | null }
  | { type: 'plate_sold'; inst: MatrixInstance; sheets: number; toCurrent: boolean }
  | { type: 'plate_moved'; from: number; to: number }
  | { type: 'offer_skipped'; sheets: number }
  | { type: 'rerolled'; kind: 'free' | 'ad'; offer: OfferState }
  | { type: 'last_chance' }
  | { type: 'lost'; reason: LossReason }
  | { type: 'continued'; reason: LossReason; clearedCells: number[]; sheets: number }
  | { type: 'victory' }
  | { type: 'run_over'; won: boolean };

export class RunError extends Error {}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function emptyTotals(): RunTotals {
  return {
    score: 0,
    bestPrint: 0,
    lines: 0,
    prints: 0,
    placements: 0,
    contractsWon: 0,
    maxStreak: 0,
    maxLines: 0,
    history: [],
  };
}

export class RunEngine {
  private s: RunState;

  private constructor(state: RunState) {
    this.s = state;
  }

  // ------------------------------------------------------------------ creation

  static create(opts: RunOptions): { engine: RunEngine; events: RunEvent[] } {
    const pool = [...(opts.pool ?? [...MATRICES.keys()])];
    const state: RunState = {
      v: RUN_STATE_VERSION,
      seed: opts.seed,
      mode: opts.mode ?? 'standard',
      dailyDate: opts.dailyDate ?? null,
      phase: 'playing',
      contractIndex: 0,
      editionModifiers: {},
      contract: null as unknown as ContractState,
      cells: newCells(),
      tray: [null, null, null],
      traySize: 3,
      reserve: null,
      stashUsed: false,
      plates: [],
      nextUid: 1,
      offer: null,
      freeRerolls: BALANCE.freeRerollsPerRun,
      adRerollsUsed: 0,
      continueUsed: false,
      pendingSheets: 0,
      carryStreak: 0,
      lossReason: null,
      endless: false,
      pool,
      totals: emptyTotals(),
    };
    const engine = new RunEngine(state);
    for (const id of opts.startPlates ?? []) {
      if (state.plates.length < BALANCE.slots) state.plates.push(createInstance(id, state.nextUid++));
    }
    const events = engine.startContract(0);
    return { engine, events };
  }

  static restore(state: RunState): RunEngine {
    if (state.v !== RUN_STATE_VERSION) throw new RunError(`Unsupported run state version ${state.v}`);
    return new RunEngine(clone(state));
  }

  snapshot(): RunState {
    return clone(this.s);
  }

  /** Read-only view (do not mutate). */
  get state(): Readonly<RunState> {
    return this.s;
  }

  // ------------------------------------------------------------------ queries

  get spec(): ContractSpec {
    return this.s.contract.spec;
  }

  isEnabled(inst: MatrixInstance): boolean {
    return this.s.contract.disabledUid !== inst.uid;
  }

  enabledPlates(): MatrixInstance[] {
    return this.s.plates.filter((p) => this.isEnabled(p));
  }

  inkWeights(): number[] {
    return this.inkWeightsOf(this.enabledPlates());
  }

  private inkWeightsOf(plates: readonly MatrixInstance[]): number[] {
    const w = new Array<number>(INK_COUNT).fill(1);
    for (const p of plates) {
      const aff = matrixDef(p.id).inkAffinity;
      if (aff !== undefined) w[aff] = (w[aff] as number) + BALANCE.colorAffinityWeight;
    }
    return w;
  }

  streakGrace(): number {
    let g = BALANCE.streakGrace;
    for (const p of this.enabledPlates()) g += matrixDef(p.id).streakGrace ?? 0;
    return g;
  }

  reserveSlots(): number {
    let n = 0;
    for (const p of this.enabledPlates()) n += matrixDef(p.id).reserve ?? 0;
    return n;
  }

  /** Whether a type-case stash exists at all (even if disabled this contract). */
  hasReserve(): boolean {
    return this.s.plates.some((p) => (matrixDef(p.id).reserve ?? 0) > 0) || this.s.reserve !== null;
  }

  pieceAt(slot: SlotRef): TrayPiece | null {
    if (slot === 'reserve') return this.s.reserve;
    return this.s.tray[slot] ?? null;
  }

  canPlace(slot: SlotRef, x: number, y: number): boolean {
    if (this.s.phase !== 'playing') return false;
    if (slot === 'reserve' && this.reserveSlots() === 0) return false;
    const piece = this.pieceAt(slot);
    if (!piece) return false;
    return canPlaceCells(this.s.cells, shapeById(piece.shape), x, y);
  }

  /** Lines that would print if the piece were placed at (x, y). */
  previewLines(slot: SlotRef, x: number, y: number): FullLines | null {
    if (!this.canPlace(slot, x, y)) return null;
    const piece = this.pieceAt(slot) as TrayPiece;
    const cells = this.s.cells.slice();
    placeCells(cells, shapeById(piece.shape), x, y, piece.ink);
    return findFullLines(cells, hasModifier(this.spec, 'rows_only'));
  }

  validPositions(slot: SlotRef): Array<[number, number]> {
    const piece = this.pieceAt(slot);
    if (!piece || this.s.phase !== 'playing') return [];
    if (slot === 'reserve' && this.reserveSlots() === 0) return [];
    const shape = shapeById(piece.shape);
    const out: Array<[number, number]> = [];
    for (let y = 0; y <= BOARD_SIZE - shape.h; y++)
      for (let x = 0; x <= BOARD_SIZE - shape.w; x++)
        if (canPlaceCells(this.s.cells, shape, x, y)) out.push([x, y]);
    return out;
  }

  /** Can any available piece (tray + usable reserve) be placed? */
  anyMoveAvailable(): boolean {
    const rows = occupancy(this.s.cells);
    for (const p of this.s.tray) if (p && fits(rows, shapeById(p.shape))) return true;
    if (this.s.reserve && this.reserveSlots() > 0 && fits(rows, shapeById(this.s.reserve.shape))) return true;
    // Type Case escape: stashing the last tray piece into an empty case deals a fresh (fair) tray.
    const trayLeft = this.s.tray.filter((p) => p !== null).length;
    if (
      trayLeft === 1 &&
      this.s.reserve === null &&
      this.s.contract.sheetsLeft > 0 &&
      this.canStash(this.s.tray.findIndex((p) => p !== null))
    ) {
      return true;
    }
    return false;
  }

  canStash(slot: number): boolean {
    return (
      this.s.phase === 'playing' &&
      this.reserveSlots() > 0 &&
      !this.s.stashUsed &&
      this.s.tray[slot] !== null &&
      this.s.tray[slot] !== undefined
    );
  }

  canReroll(kind: 'free' | 'ad'): boolean {
    if (this.s.phase !== 'offer' || !this.s.offer) return false;
    if (kind === 'free') return this.s.freeRerolls > 0;
    if (this.s.mode === 'daily') return false;
    // GDD §9.1: ad rerolls come only after the free one is used.
    if (this.s.freeRerolls > 0) return false;
    return (
      this.s.adRerollsUsed < BALANCE.adRerollsPerRun && this.s.offer.adRerollsHere < BALANCE.adRerollsPerOffer
    );
  }

  canContinue(): boolean {
    return this.s.phase === 'lost' && !this.s.continueUsed && this.s.mode !== 'daily';
  }

  /** Plates that would give sheets if sold now. */
  sellablePlates(): MatrixInstance[] {
    return this.s.plates.filter((p) => sellValue(p.id) > 0);
  }

  // ------------------------------------------------------------------ contract lifecycle

  private ensureEditionModifiers(edition: number): Modifier[] {
    const key = String(edition);
    let mods = this.s.editionModifiers[key];
    if (!mods) {
      // The whole rack counts: a plate failed in the previous special job is not failed at
      // the edition's start (and `contract` does not exist yet while the run is created).
      mods = editionModifiers(this.s.seed, edition, this.inkWeightsOf(this.s.plates));
      this.s.editionModifiers[key] = mods;
    }
    return mods;
  }

  /** Modifiers of the current edition's special job (for the HUD preview). */
  upcomingSpecial(): Modifier[] {
    return this.ensureEditionModifiers(editionOf(this.s.contractIndex));
  }

  /** Reveals (and fixes) the special-job modifiers of a given edition. */
  specialFor(edition: number): Modifier[] {
    return this.ensureEditionModifiers(edition);
  }

  private startContract(index: number): RunEvent[] {
    const s = this.s;
    const edition = editionOf(index);
    const mods = this.ensureEditionModifiers(edition);
    const spec = contractSpec(index, isSpecialIndex(index) ? mods : []);
    s.contractIndex = index;
    s.cells = contractBoard(s.seed, spec);
    s.tray = [null, null, null];
    s.traySize = hasModifier(spec, 'short_tray') ? 2 : 3;
    s.stashUsed = false;
    s.phase = 'playing';
    s.offer = null;
    s.lossReason = null;

    let disabledUid: number | null = null;
    if (hasModifier(spec, 'failure') && s.plates.length > 0) {
      const rng = Rng.derive(s.seed, 'failure', index);
      // Draw over acquisition order, not rack order, so rearranging plates cannot steer the failure.
      const order = [...s.plates].sort((a, b) => a.uid - b.uid);
      const weights = order.map((p) => BALANCE.failureWeights[matrixDef(p.id).rarity]);
      disabledUid = (order[rng.weightedIndex(weights)] as MatrixInstance).uid;
    }

    s.contract = {
      spec,
      progress: 0,
      sheetsLeft: 0,
      sheetsGranted: 0,
      sheetsUsed: 0,
      printIndex: 0,
      streak: 0,
      dry: 0,
      trayIndex: 0,
      disabledUid,
      bestPrint: 0,
      inkPrinted: new Array<number>(INK_COUNT).fill(0),
    };

    let sheets = spec.sheets + s.pendingSheets;
    s.pendingSheets = 0;
    for (const p of this.enabledPlates()) sheets += matrixDef(p.id).sheets ?? 0;
    s.contract.sheetsLeft = sheets;
    s.contract.sheetsGranted = sheets;

    // Streak carry (Conveyor) and per-contract plate resets.
    let carryShare = 0;
    for (const p of this.enabledPlates()) carryShare = Math.max(carryShare, matrixDef(p.id).streakCarry ?? 0);
    s.contract.streak = hasModifier(spec, 'wet_ink') ? 0 : Math.floor(s.carryStreak * carryShare);
    s.carryStreak = 0;
    for (const p of this.enabledPlates()) matrixDef(p.id).onContractStart?.(p.state);

    const events: RunEvent[] = [{ type: 'contract_started', spec, sheets, disabledUid }];
    events.push(...this.dealIfNeeded());
    return events;
  }

  private dealIfNeeded(): RunEvent[] {
    const s = this.s;
    const c = s.contract;
    if (s.tray.some((p) => p !== null) || c.sheetsLeft <= 0) return [];
    const count = Math.min(s.traySize, c.sheetsLeft);
    const rng = Rng.derive(s.seed, 'tray', s.contractIndex, c.trayIndex);
    c.trayIndex++;
    const outOfInk = c.spec.modifiers.find((m) => m.id === 'out_of_ink');
    const res = dealTray({
      cells: s.cells,
      count,
      rng,
      inkWeights: this.inkWeights(),
      blindInk: outOfInk?.ink ?? null,
      bigFormat: hasModifier(c.spec, 'big_format'),
      rowsOnly: hasModifier(c.spec, 'rows_only'),
    });
    const pieces: TrayPiece[] = res.pieces.map((p) => ({ uid: s.nextUid++, shape: p.shape, ink: p.ink }));
    s.tray = [null, null, null];
    pieces.forEach((p, i) => (s.tray[i] = p));
    return [{ type: 'dealt', pieces, fallback: res.fallback, attempts: res.attempts, nodes: res.nodes }];
  }

  // ------------------------------------------------------------------ actions

  place(slot: SlotRef, x: number, y: number): RunEvent[] {
    const s = this.s;
    if (s.phase !== 'playing') throw new RunError('Not playing');
    if (!this.canPlace(slot, x, y)) throw new RunError('Illegal placement');
    const c = s.contract;
    const piece = this.pieceAt(slot) as TrayPiece;
    const shape: Shape = shapeById(piece.shape);
    const events: RunEvent[] = [];

    if (slot === 'reserve') s.reserve = null;
    else s.tray[slot] = null;
    s.stashUsed = false;

    const written = placeCells(s.cells, shape, x, y, piece.ink);
    c.sheetsLeft--;
    c.sheetsUsed++;
    s.totals.placements++;
    events.push({ type: 'placed', slot, piece, x, y, cells: written });

    const rowsOnly = hasModifier(c.spec, 'rows_only');
    const lines = findFullLines(s.cells, rowsOnly);
    const lineCount = lines.rows.length + lines.cols.length;
    const printed = lineCount > 0;
    const wet = hasModifier(c.spec, 'wet_ink');
    const grace = this.streakGrace();

    if (printed) {
      if (!wet) c.streak += lineCount;
      c.dry = 0;
      const slots: SlotInput[] = s.plates.map((inst) => ({ inst, enabled: this.isEnabled(inst) }));
      const goldRng = Rng.derive(s.seed, 'golden', s.contractIndex, c.printIndex);
      const result = scorePrint({
        cells: s.cells,
        lines,
        pieceSize: shape.size,
        streak: wet ? 0 : c.streak,
        sheetsLeft: c.sheetsLeft,
        sheetsUsed: c.sheetsUsed,
        printIndex: c.printIndex,
        slots,
        slotCapacity: BALANCE.slots,
        random: () => goldRng.next(),
      });
      const cleared: Array<{ i: number; v: number }> = [];
      const clearedSet = new Set<number>();
      for (const y0 of lines.rows) for (let k = 0; k < BOARD_SIZE; k++) clearedSet.add(idx(k, y0));
      for (const x0 of lines.cols) for (let k = 0; k < BOARD_SIZE; k++) clearedSet.add(idx(x0, k));
      for (const i of [...clearedSet].sort((a, b) => a - b)) {
        const v = s.cells[i] as number;
        cleared.push({ i, v });
        if (isInk(v)) c.inkPrinted[v] = (c.inkPrinted[v] as number) + 1;
      }
      clearLines(s.cells, lines);
      c.printIndex++;
      c.progress += result.total;
      c.bestPrint = Math.max(c.bestPrint, result.total);
      s.totals.score += result.total;
      s.totals.bestPrint = Math.max(s.totals.bestPrint, result.total);
      s.totals.lines += lineCount;
      s.totals.prints++;
      s.totals.maxLines = Math.max(s.totals.maxLines, lineCount);
      s.totals.maxStreak = Math.max(s.totals.maxStreak, c.streak);
      for (const inst of this.enabledPlates()) matrixDef(inst.id).afterPrint?.(result.ctx, inst.state);
      events.push({ type: 'printed', result, lines, cleared, streak: c.streak, progress: c.progress });
      events.push({ type: 'streak', streak: c.streak, dry: 0, grace, broken: false });
    } else {
      let broken = false;
      if (!wet && c.streak > 0) {
        c.dry++;
        if (c.dry > grace) {
          c.streak = 0;
          c.dry = 0;
          broken = true;
        }
      }
      events.push({ type: 'streak', streak: c.streak, dry: c.dry, grace, broken });
    }
    for (const inst of this.enabledPlates()) matrixDef(inst.id).afterPlace?.(printed, inst.state);

    events.push(...this.resolveAfterPlacement());
    return events;
  }

  private resolveAfterPlacement(): RunEvent[] {
    const s = this.s;
    const c = s.contract;
    if (c.progress >= c.spec.quota) return this.winContract();
    if (c.sheetsLeft <= 0) {
      if (this.sellablePlates().length > 0) {
        s.phase = 'last_chance';
        return [{ type: 'last_chance' }];
      }
      return this.lose('quota');
    }
    const events = this.dealIfNeeded();
    if (!this.anyMoveAvailable()) events.push(...this.lose('jam'));
    return events;
  }

  private dominantInk(): number | null {
    const arr = this.s.contract.inkPrinted;
    let best: number | null = null;
    for (let k = 0; k < arr.length; k++)
      if ((arr[k] as number) > 0 && (best === null || (arr[k] as number) > (arr[best] as number))) best = k;
    return best;
  }

  private record(won: boolean): void {
    const c = this.s.contract;
    this.s.totals.history.push({
      index: this.s.contractIndex,
      won,
      progress: c.progress,
      quota: c.spec.quota,
      sheetsUsed: c.sheetsUsed,
      dominantInk: this.dominantInk(),
    });
  }

  private winContract(): RunEvent[] {
    const s = this.s;
    const c = s.contract;
    this.record(true);
    s.totals.contractsWon++;
    s.carryStreak = c.streak;
    for (const inst of this.enabledPlates()) matrixDef(inst.id).afterContract?.(inst.state);
    const { cards, guaranteeRare } = this.earlyBonus();
    const events: RunEvent[] = [
      {
        type: 'contract_won',
        index: s.contractIndex,
        progress: c.progress,
        quota: c.spec.quota,
        sheetsUsed: c.sheetsUsed,
        cards,
        guaranteeRare,
      },
    ];
    s.tray = [null, null, null];
    if (s.contractIndex === totalContracts() - 1 && !s.endless) {
      s.phase = 'victory';
      events.push({ type: 'victory' });
      return events;
    }
    s.offer = {
      index: s.contractIndex,
      cards: [],
      cardCount: cards,
      guaranteeRare,
      rerolls: 0,
      adRerollsHere: 0,
    };
    s.offer.cards = this.drawOffer(s.offer);
    s.phase = 'offer';
    events.push({ type: 'offer', offer: clone(s.offer) });
    return events;
  }

  /** Early-finish bonus of the current contract (GDD §6.3): share of base sheets used. */
  private earlyBonus(): { cards: number; guaranteeRare: boolean } {
    const c = this.s.contract;
    const share = c.sheetsUsed / c.spec.sheets;
    return {
      cards: share <= BALANCE.earlyShare4Cards ? 4 : 3,
      guaranteeRare: share <= BALANCE.earlyShareRare,
    };
  }

  private lose(reason: LossReason): RunEvent[] {
    this.s.phase = 'lost';
    this.s.lossReason = reason;
    return [{ type: 'lost', reason }];
  }

  // ------------------------------------------------------------------ offers

  private rarityWeights(): Record<Rarity, number> {
    const edition = editionOf(this.s.contractIndex + 1);
    return edition >= BALANCE.rarityLateFromEdition ? BALANCE.rarityWeightsLate : BALANCE.rarityWeights;
  }

  drawOffer(offer: OfferState): MatrixId[] {
    const s = this.s;
    const rng = Rng.derive(s.seed, 'offer', offer.index, offer.rerolls);
    const owned = new Set(s.plates.map((p) => p.id));
    const available = s.pool.filter((id) => !owned.has(id) && MATRICES.has(id));
    const byRarity: Record<Rarity, MatrixId[]> = { common: [], rare: [], legendary: [] };
    for (const id of available) byRarity[matrixDef(id).rarity].push(id);
    const weights = this.rarityWeights();
    const order: Rarity[] = ['common', 'rare', 'legendary'];
    const cards: MatrixId[] = [];
    let hasInk = false;
    // Ink plates are the colour plates (Ink Well is not one, despite its id).
    const isInkPlate = (id: MatrixId) => matrixDef(id).inkAffinity !== undefined;
    const take = (r: Rarity): MatrixId | null => {
      // Fall back to lower rarities when a pool is exhausted.
      for (let k = order.indexOf(r); k >= 0; k--) {
        const list = byRarity[order[k] as Rarity].filter(
          (id) => !cards.includes(id) && !(hasInk && isInkPlate(id)),
        );
        if (list.length > 0) return rng.pick(list);
      }
      return null;
    };
    for (let n = 0; n < offer.cardCount; n++) {
      const needRare =
        offer.guaranteeRare &&
        n === offer.cardCount - 1 &&
        !cards.some((id) => matrixDef(id).rarity !== 'common');
      let rarity: Rarity;
      if (needRare) {
        rarity = rng.weightedIndex([0, weights.rare, weights.legendary]) === 2 ? 'legendary' : 'rare';
      } else {
        rarity = order[rng.weightedIndex([weights.common, weights.rare, weights.legendary])] as Rarity;
      }
      const id = take(rarity);
      if (!id) break;
      if (isInkPlate(id)) hasInk = true;
      cards.push(id);
    }
    return cards;
  }

  takeOffer(card: number, replaceUid?: number): RunEvent[] {
    const s = this.s;
    if (s.phase !== 'offer' || !s.offer) throw new RunError('No offer');
    const id = s.offer.cards[card];
    if (!id) throw new RunError('Bad card');
    const full = s.plates.length >= BALANCE.slots;
    const at = full ? s.plates.findIndex((p) => p.uid === replaceUid) : -1;
    if (full && at < 0) throw new RunError('Rack full: choose a plate to replace');
    const events: RunEvent[] = [];
    const inst = createInstance(id, s.nextUid++);
    let replaced: MatrixInstance | null = null;
    let slot: number;
    if (full) {
      replaced = s.plates[at] as MatrixInstance;
      const sheets = sellValue(replaced.id);
      s.pendingSheets += sheets;
      s.plates[at] = inst;
      slot = at;
      events.push({ type: 'plate_sold', inst: replaced, sheets, toCurrent: false });
    } else {
      s.plates.push(inst);
      slot = s.plates.length - 1;
    }
    events.push({ type: 'plate_added', inst: clone(inst), slot, replaced });
    events.push(...this.nextContract());
    return events;
  }

  skipOffer(): RunEvent[] {
    const s = this.s;
    if (s.phase !== 'offer') throw new RunError('No offer');
    s.pendingSheets += BALANCE.skipSheets;
    return [{ type: 'offer_skipped', sheets: BALANCE.skipSheets }, ...this.nextContract()];
  }

  reroll(kind: 'free' | 'ad'): RunEvent[] {
    const s = this.s;
    if (!this.canReroll(kind) || !s.offer) throw new RunError('Reroll not allowed');
    if (kind === 'free') s.freeRerolls--;
    else {
      s.adRerollsUsed++;
      s.offer.adRerollsHere++;
    }
    s.offer.rerolls++;
    s.offer.cards = this.drawOffer(s.offer);
    return [{ type: 'rerolled', kind, offer: clone(s.offer) }];
  }

  private nextContract(): RunEvent[] {
    const s = this.s;
    s.offer = null;
    return this.startContract(s.contractIndex + 1);
  }

  // ------------------------------------------------------------------ rack

  sell(uid: number): RunEvent[] {
    const s = this.s;
    if (!['playing', 'offer', 'last_chance'].includes(s.phase)) throw new RunError('Cannot sell now');
    const at = s.plates.findIndex((p) => p.uid === uid);
    if (at < 0) throw new RunError('No such plate');
    const inst = s.plates[at] as MatrixInstance;
    s.plates.splice(at, 1);
    const sheets = sellValue(inst.id);
    const toCurrent = s.phase !== 'offer';
    if (toCurrent) {
      s.contract.sheetsLeft += sheets;
      s.contract.sheetsGranted += sheets;
    } else s.pendingSheets += sheets;
    const events: RunEvent[] = [{ type: 'plate_sold', inst, sheets, toCurrent }];
    if (s.phase === 'last_chance') {
      if (s.contract.sheetsLeft > 0) {
        s.phase = 'playing';
        events.push(...this.dealIfNeeded());
        if (!this.anyMoveAvailable()) events.push(...this.lose('jam'));
      } else if (this.sellablePlates().length === 0) {
        events.push(...this.lose('quota'));
      }
    } else if (s.phase === 'playing' && s.reserve && this.reserveSlots() === 0 && !this.anyMoveAvailable()) {
      // Selling the type case can strand the only playable piece.
      events.push(...this.lose('jam'));
    }
    return events;
  }

  movePlate(from: number, to: number): RunEvent[] {
    const s = this.s;
    if (from < 0 || from >= s.plates.length || to < 0 || to >= s.plates.length)
      throw new RunError('Bad slot');
    if (s.phase === 'over') throw new RunError('Run over');
    const [p] = s.plates.splice(from, 1);
    s.plates.splice(to, 0, p as MatrixInstance);
    return [{ type: 'plate_moved', from, to }];
  }

  stash(slot: number): RunEvent[] {
    const s = this.s;
    if (!this.canStash(slot)) throw new RunError('Cannot stash');
    const piece = s.tray[slot] as TrayPiece;
    const swapped = s.reserve;
    s.reserve = piece;
    s.tray[slot] = swapped;
    s.stashUsed = true;
    const events: RunEvent[] = [{ type: 'stashed', from: slot, piece, swapped }];
    events.push(...this.dealIfNeeded());
    if (!this.anyMoveAvailable()) events.push(...this.lose('jam'));
    return events;
  }

  // ------------------------------------------------------------------ end states

  acceptLoss(): RunEvent[] {
    if (this.s.phase !== 'last_chance') throw new RunError('Not in last chance');
    return this.lose('quota');
  }

  /** Reprint ("dodruk"): one continue per run (ads are handled by the UI). */
  continueRun(): RunEvent[] {
    const s = this.s;
    if (!this.canContinue()) throw new RunError('Cannot continue');
    const reason = s.lossReason as LossReason;
    s.continueUsed = true;
    s.phase = 'playing';
    s.lossReason = null;
    const c = s.contract;
    let clearedCells: number[] = [];
    let sheets = 0;
    if (reason === 'quota') {
      sheets = BALANCE.continueSheets;
      c.sheetsLeft += sheets;
      c.sheetsGranted += sheets;
    } else {
      clearedCells = this.clearForContinue();
      s.tray = [null, null, null];
    }
    const events: RunEvent[] = [{ type: 'continued', reason, clearedCells, sheets }];
    events.push(...this.dealIfNeeded());
    // Reachable after a quota loss: the extra sheets do not help if the leftover tray cannot be placed.
    if (!this.anyMoveAvailable()) events.push(...this.lose('jam'));
    return events;
  }

  private clearForContinue(): number[] {
    const cells = this.s.cells;
    const filled = (i: number) => cells[i] !== EMPTY && cells[i] !== JAM;
    const rowScore = Array.from({ length: BOARD_SIZE }, (_, y) => {
      let n = 0;
      for (let x = 0; x < BOARD_SIZE; x++) if (filled(idx(x, y))) n++;
      return { k: y, n };
    });
    const colScore = Array.from({ length: BOARD_SIZE }, (_, x) => {
      let n = 0;
      for (let y = 0; y < BOARD_SIZE; y++) if (filled(idx(x, y))) n++;
      return { k: x, n };
    });
    const pick = (arr: Array<{ k: number; n: number }>, count: number) =>
      [...arr]
        .sort((a, b) => b.n - a.n || a.k - b.k)
        .slice(0, count)
        .map((e) => e.k);
    const rows = pick(rowScore, BALANCE.continueClearRows);
    const cols = pick(colScore, BALANCE.continueClearCols);
    const out = new Set<number>();
    for (const y of rows) for (let x = 0; x < BOARD_SIZE; x++) if (filled(idx(x, y))) out.add(idx(x, y));
    for (const x of cols) for (let y = 0; y < BOARD_SIZE; y++) if (filled(idx(x, y))) out.add(idx(x, y));
    const list = [...out].sort((a, b) => a - b);
    for (const i of list) cells[i] = EMPTY;
    return list;
  }

  /** Lost → over (results). */
  endRun(): RunEvent[] {
    const s = this.s;
    if (s.phase !== 'lost' && s.phase !== 'victory') throw new RunError('Run not finished');
    const won = s.phase === 'victory' || s.endless;
    if (s.phase === 'lost') this.record(false);
    s.phase = 'over';
    return [{ type: 'run_over', won }];
  }

  /** Victory → endless mode (offer, then contract 25+). */
  continueEndless(): RunEvent[] {
    const s = this.s;
    if (s.phase !== 'victory') throw new RunError('Not victorious');
    s.endless = true;
    // The offer after job 24 carries that job's early-finish bonus like any other.
    const { cards, guaranteeRare } = this.earlyBonus();
    s.offer = {
      index: s.contractIndex,
      cards: [],
      cardCount: cards,
      guaranteeRare,
      rerolls: 0,
      adRerollsHere: 0,
    };
    s.offer.cards = this.drawOffer(s.offer);
    s.phase = 'offer';
    return [{ type: 'offer', offer: clone(s.offer) }];
  }

  /** Abandon from the pause menu. */
  abandon(): RunEvent[] {
    const s = this.s;
    if (s.phase === 'over') return [];
    if (s.phase === 'playing' || s.phase === 'last_chance' || s.phase === 'lost') this.record(false);
    const won = s.endless || s.phase === 'victory';
    s.phase = 'over';
    return [{ type: 'run_over', won }];
  }
}
