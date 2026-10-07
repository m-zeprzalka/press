/**
 * Heuristic PRESS player. Drives RunEngine through its public API only.
 *
 *  - placements: beam-search planner (planner.ts) on a fast bitboard model, re-planned after
 *    every placement; stash (Type Case) moves are part of the search,
 *  - offers: plate value = measured scoring gain on a reservoir of this run's real prints
 *    (re-scored with the candidate rack, projected growth for scaling plates) + utility priors +
 *    archetype synergies (GDD §8.4) + rarity; ε-exploration; skip / reroll / replace rules,
 *  - rack order: line adders → Column Press → +MULT → flat prints → ×MULT → passive, Mirror
 *    placed where it scores best,
 *  - last chance: sell when it can save the contract (or when nothing else can), reprint
 *    (continue) per policy.
 */
import { BALANCE } from '../core/config/balance';
import { BLIND, EMPTY, JAM, LEAD, type Cells } from '../core/board';
import { hasModifier, totalContracts } from '../core/contracts';
import {
  MX,
  createInstance,
  matrixDef,
  sellValue,
  type MatrixDef,
  type MatrixId,
  type MatrixInstance,
  type MatrixState,
} from '../core/matrices';
import { Rng } from '../core/rng';
import type { RunEngine, RunEvent, SlotRef } from '../core/run';
import { fastShape } from './fastboard';
import { buildRack, cleanAfterLines, fastScore, patternRandom, type FastRack } from './fastscore';
import {
  DEFAULT_WEIGHTS,
  Planner,
  type FutureModel,
  type HandPiece,
  type Move,
  type PlanInput,
  type PlannerWeights,
} from './planner';

export type RerollPolicy = 'none' | 'free' | 'ads';
export type ContinuePolicy = 'never' | 'always';

export interface BotOptions {
  seed: string;
  reroll: RerollPolicy;
  continue: ContinuePolicy;
  /** Probability of taking a random card instead of the best one. */
  epsilon: number;
  /** Forced choice at the first offer: a plate id or 'skip'. */
  forcePlate: MatrixId | 'skip' | null;
  weights?: Partial<PlannerWeights>;
  plate?: Partial<PlatePolicy>;
}

export interface PlatePolicy {
  /** Log-gain value of skipping (+3 sheets). */
  skipValue: number;
  /** Below this best value an offer counts as weak (reroll). */
  rerollBelow: number;
  synergy: number;
  rarityRare: number;
  rarityLegendary: number;
  /** Minimum improvement to replace an owned plate. */
  replaceMargin: number;
  /** Scaling plates are valued at their state after this share of the remaining contracts… */
  growthShare: number;
  /** …capped at this many contracts. */
  growthCap: number;
}

export const DEFAULT_PLATE_POLICY: PlatePolicy = {
  skipValue: 0.03,
  rerollBelow: 0.08,
  synergy: 0.04,
  rarityRare: 0.01,
  rarityLegendary: 0.03,
  replaceMargin: 0.03,
  growthShare: 0.5,
  growthCap: 12,
};

/** Archetypes from GDD §8.4. */
export const ARCHETYPES: Record<string, readonly MatrixId[]> = {
  monochrome: [
    'ink_pink',
    'ink_orange',
    'ink_yellow',
    'ink_teal',
    'ink_blue',
    'monotype',
    'ink_well',
    'petit',
  ],
  rainbow: ['registration', 'split_fountain'],
  bigPress: ['roller', 'crossmark', 'hydraulic', 'poster', 'clean_sheet'],
  streak: ['numerator', 'momentum', 'conveyor', 'petit'],
  scaling: ['journeyman', 'archive', 'gutenberg'],
  geometry: ['margins', 'column_press'],
  minimal: ['stencil'],
  random: ['golden_type', 'mirror'],
};

/** Non-scoring value (log-gain units) of passive / utility effects. */
const UTILITY: Partial<Record<MatrixId, number>> = {
  ream: 0.16,
  type_case: 0.1,
  conveyor: 0.1,
  ink_pink: 0.03,
  ink_orange: 0.03,
  ink_yellow: 0.03,
  ink_teal: 0.03,
  ink_blue: 0.03,
};

const ORDER_CLASS: Record<MatrixId, number> = {
  ink_pink: 0,
  ink_orange: 0,
  ink_yellow: 0,
  ink_teal: 0,
  ink_blue: 0,
  guillotine: 0,
  margins: 0,
  archive: 0,
  golden_type: 4,
  column_press: 1,
  proof: 2,
  roller: 2,
  petit: 2,
  numerator: 2,
  registration: 2,
  journeyman: 2,
  crossmark: 2,
  ink_well: 2,
  poster: 3,
  scrap: 3,
  first_impression: 4,
  monotype: 4,
  clean_sheet: 4,
  stencil: 4,
  momentum: 4,
  gutenberg: 4,
  hydraulic: 4,
  split_fountain: 4,
  mirror: 4,
  ream: 5,
  type_case: 5,
  conveyor: 5,
};

/** A recorded print situation (re-scored to value racks). */
export interface PrintSample {
  cells: Int8Array;
  lines: number;
  pieceSize: number;
  /** SERIA before the print (lines added during scoring). */
  streakBefore: number;
  lineCount: number;
  sheetsLeft: number;
  sheetsUsed: number;
  printIndex: number;
  cleanAfter: boolean;
}

export interface OfferDecision {
  action: 'take' | 'skip' | 'reroll';
  card?: number;
  replaceUid?: number;
  explore?: boolean;
  forced?: boolean;
  values?: number[];
}

const SAMPLE_CAP = 24;

function synthSamples(): PrintSample[] {
  const rng = Rng.fromSeed('press-sim-synthetic');
  const mk = (lineSpec: number, pieceSize: number, sheetsUsed: number): PrintSample => {
    const cells = new Int8Array(64).fill(EMPTY);
    for (let i = 0; i < 64; i++) if (rng.chance(0.4)) cells[i] = rng.int(5);
    const rows = lineSpec & 0xff;
    const cols = (lineSpec >>> 8) & 0xff;
    for (let i = 0; i < 64; i++) if (rows & (1 << (i >>> 3)) || cols & (1 << (i & 7))) cells[i] = rng.int(5);
    let L = 0;
    for (let b = 0; b < 16; b++) if (lineSpec & (1 << b)) L++;
    return {
      cells,
      lines: lineSpec,
      pieceSize,
      streakBefore: 0,
      lineCount: L,
      sheetsLeft: 20 - sheetsUsed,
      sheetsUsed,
      printIndex: 2,
      cleanAfter: cleanAfterLines(cells, lineSpec),
    };
  };
  return [
    mk(1 << 3, 3, 6),
    mk(1 << (8 + 5), 4, 10),
    mk(1 << 0, 2, 14),
    mk((1 << 6) | (1 << 7), 5, 9),
    mk((1 << 2) | (1 << (8 + 2)), 5, 12),
    mk(1 << (8 + 0), 3, 4),
    mk(1 << 5, 4, 16),
    mk((1 << (8 + 3)) | (1 << (8 + 4)), 6, 7),
  ];
}
const SYNTH = synthSamples();

export class Bot {
  readonly opts: BotOptions;
  readonly w: PlannerWeights;
  readonly pp: PlatePolicy;
  private planner = new Planner();
  private samples: PrintSample[] = [];
  private sampleNext = 0;
  // Running rates (with priors) for the future-points model.
  private sheetsSeen = 30;
  private printsSeen = 12;
  private linesSeen = 15;
  private dryRuns = 0;
  private future: FutureModel | null = null;
  private futureKey = '';
  private offersSeen = 0;
  /** uid of a plate the forced experiment protects from replacement / sale. */
  pinnedUid: number | null = null;
  // Telemetry
  decisions = 0;
  decisionMs = 0;
  decisionMax = 0;
  decisionHist: Record<string, number> = {};
  planNodes = 0;
  fallbacks = 0;

  constructor(opts: BotOptions) {
    this.opts = opts;
    this.w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
    this.pp = { ...DEFAULT_PLATE_POLICY, ...(opts.plate ?? {}) };
  }

  // ------------------------------------------------------------------ observation

  /** Feed every engine event batch (keeps print samples and rate estimates current). */
  observe(engine: RunEngine, events: readonly RunEvent[]): void {
    for (const e of events) {
      if (e.type === 'placed') {
        this.sheetsSeen++;
      } else if (e.type === 'printed') {
        this.printsSeen++;
        this.linesSeen += e.result.ctx.lineCount;
        const ctx = e.result.ctx;
        // Reconstruct the pre-clear board from the post-clear cells plus the cleared values.
        const cells = Int8Array.from(engine.state.cells);
        for (const c of e.cleared) cells[c.i] = c.v;
        let lines = 0;
        for (const y of e.lines.rows) lines |= 1 << y;
        for (const x of e.lines.cols) lines |= 1 << (8 + x);
        const sample: PrintSample = {
          cells,
          lines,
          pieceSize: ctx.pieceSize,
          streakBefore: Math.max(0, ctx.streak - ctx.lineCount),
          lineCount: ctx.lineCount,
          sheetsLeft: ctx.sheetsLeft,
          sheetsUsed: ctx.sheetsUsed,
          printIndex: ctx.printIndex,
          cleanAfter: ctx.boardCleanAfter,
        };
        if (this.samples.length < SAMPLE_CAP) this.samples.push(sample);
        else {
          this.samples[this.sampleNext] = sample;
          this.sampleNext = (this.sampleNext + 1) % SAMPLE_CAP;
        }
      } else if (e.type === 'streak' && !e.broken && e.dry > 0) {
        this.dryRuns++;
      }
    }
  }

  private allSamples(): PrintSample[] {
    return this.samples.length >= 12 ? this.samples : [...SYNTH, ...this.samples];
  }

  // ------------------------------------------------------------------ rack power

  /** Mean print total of the samples under a rack (streak per sample set to `streakBefore`). */
  private rackPower(
    ids: readonly MatrixId[],
    states: readonly MatrixState[],
    streakOverride: number | null,
    wet = false,
  ): number {
    const rack = buildRack(
      ids,
      ids.map(() => true),
    );
    const samples = this.allSamples();
    let sum = 0;
    const rnd = patternRandom();
    for (const s of samples) {
      const sb = streakOverride ?? s.streakBefore;
      const r = fastScore({
        cells: s.cells,
        lines: s.lines,
        pieceSize: s.pieceSize,
        streak: wet ? 0 : sb + s.lineCount,
        sheetsLeft: s.sheetsLeft,
        sheetsUsed: s.sheetsUsed,
        printIndex: s.printIndex,
        cleanAfter: s.cleanAfter,
        rack,
        states,
        slotCapacity: BALANCE.slots,
        random: rnd,
      });
      sum += r.total;
    }
    return sum / samples.length;
  }

  // ------------------------------------------------------------------ future model

  private futureModel(engine: RunEngine, rack: FastRack, states: MatrixState[], wet: boolean): FutureModel {
    // Recomputed once per contract (and when the rack changes); rates move slowly.
    const key = `${engine.state.contractIndex}|${engine.state.plates.map((p) => p.uid).join(',')}|${wet ? 1 : 0}|${engine.state.contract.disabledUid ?? ''}`;
    if (this.future && key === this.futureKey) return this.future;
    const maxStreak = 48;
    const maxSheets = 40;
    const all = this.allSamples();
    const samples = all.length > 16 ? all.slice(-16) : all;
    const rnd = patternRandom();
    // EPV per print for SERIA-before s, measured at a few levels and interpolated.
    const levels = wet ? [0] : [0, 1, 2, 4, 8, 16, 32, 48];
    const measured: number[] = [];
    for (const st of levels) {
      let sum = 0;
      for (const s of samples) {
        sum += fastScore({
          cells: s.cells,
          lines: s.lines,
          pieceSize: s.pieceSize,
          streak: wet ? 0 : st + s.lineCount,
          sheetsLeft: s.sheetsLeft,
          sheetsUsed: s.sheetsUsed,
          printIndex: s.printIndex,
          cleanAfter: s.cleanAfter,
          rack,
          states,
          slotCapacity: BALANCE.slots,
          random: rnd,
        }).total;
      }
      measured.push(sum / samples.length);
    }
    const epv = new Float64Array(maxStreak + 1);
    for (let st = 0; st <= maxStreak; st++) {
      if (levels.length === 1) {
        epv[st] = measured[0] as number;
        continue;
      }
      let j = 0;
      while (j < levels.length - 2 && (levels[j + 1] as number) < st) j++;
      const a = levels[j] as number;
      const b = levels[j + 1] as number;
      const t = Math.min(1, Math.max(0, (st - a) / (b - a)));
      epv[st] = (measured[j] as number) * (1 - t) + (measured[j + 1] as number) * t;
    }
    const lp = this.printsSeen / this.sheetsSeen;
    const ll = this.linesSeen / this.sheetsSeen;
    const row = maxSheets + 1;
    const table = new Float64Array((maxStreak + 1) * row);
    for (let st = 0; st <= maxStreak; st++) {
      let acc = 0;
      table[st * row] = 0;
      for (let n = 1; n <= maxSheets; n++) {
        const sAt = Math.min(maxStreak, st + ll * (n - 1));
        const i0 = Math.floor(sAt);
        const fr = sAt - i0;
        const v = (epv[i0] as number) * (1 - fr) + (epv[Math.min(maxStreak, i0 + 1)] as number) * fr;
        acc += lp * v;
        table[st * row + n] = acc;
      }
    }
    this.future = { maxStreak, maxSheets, table };
    this.futureKey = key;
    return this.future;
  }

  // ------------------------------------------------------------------ placement

  buildPlanInput(engine: RunEngine, sheetsOverride?: number): PlanInput {
    const s = engine.state;
    const c = s.contract;
    const spec = c.spec;
    const wet = hasModifier(spec, 'wet_ink');
    const plates = s.plates;
    const enabled = plates.map((p) => engine.isEnabled(p));
    const rack = buildRack(
      plates.map((p) => p.id),
      enabled,
    );
    const states = plates.map((p) => p.state);
    const lifecycle: Array<{ idx: number; def: MatrixDef }> = [];
    let monoValue = 0;
    let monoInks = 0;
    plates.forEach((p, i) => {
      const def = matrixDef(p.id);
      if (!enabled[i]) return;
      if (def.afterPrint || def.afterPlace) lifecycle.push({ idx: i, def });
      if (p.id === 'monotype') monoValue += 3;
      if (p.id === 'ink_well') monoValue += 2;
      if (def.inkAffinity !== undefined) monoInks |= 1 << def.inkAffinity;
    });
    if (monoValue === 0) monoValue = 0.5; // base game: +2 MULT per mono line
    const reserveEnabled = engine.reserveSlots() > 0;
    const hand: Array<HandPiece | null> = [null, null, null, null];
    for (let k = 0; k < 3; k++) {
      const p = s.tray[k];
      if (p) hand[k] = { shape: fastShape(p.shape), ink: p.ink };
    }
    if (s.reserve) hand[3] = { shape: fastShape(s.reserve.shape), ink: s.reserve.ink };
    return {
      cells: s.cells,
      hand,
      reserveEnabled,
      canStash: reserveEnabled && !s.stashUsed,
      rowsOnly: hasModifier(spec, 'rows_only'),
      wet,
      grace: engine.streakGrace(),
      quota: spec.quota,
      progress: c.progress,
      sheetsLeft: sheetsOverride ?? c.sheetsLeft,
      sheetsUsed: c.sheetsUsed,
      sheetsBase: spec.sheets,
      streak: c.streak,
      dry: c.dry,
      printIndex: c.printIndex,
      rack,
      states,
      lifecycle,
      slotCapacity: BALANCE.slots,
      random: patternRandom(),
      future: this.futureModel(engine, rack, states, wet),
      monoInks,
      monoValue,
      weights: this.w,
    };
  }

  decide(engine: RunEngine): Move | null {
    const t0 = performance.now();
    const inp = this.buildPlanInput(engine);
    let res = this.planner.plan(inp);
    if (res.dead || !res.move) {
      // Beam pruning can lose the only complete orderings: retry wider.
      const wide = this.planner.plan(inp, 64);
      if (wide.move && (!wide.dead || !res.move)) res = wide;
      this.fallbacks++;
    }
    const dt = performance.now() - t0;
    this.decisions++;
    this.decisionMs += dt;
    if (dt > this.decisionMax) this.decisionMax = dt;
    const b =
      dt < 1
        ? (Math.floor(dt * 10) / 10).toFixed(1)
        : dt < 10
          ? Math.floor(dt).toString()
          : dt < 100
            ? `${Math.floor(dt / 10) * 10}`
            : '100+';
    this.decisionHist[b] = (this.decisionHist[b] ?? 0) + 1;
    this.planNodes += res.nodes;
    return res.move;
  }

  /** One action in the 'playing' phase. */
  play(engine: RunEngine): RunEvent[] {
    const move = this.decide(engine);
    const events: RunEvent[] = [];
    if (!move) {
      // Nothing legal found (should not happen: the engine declares a jam first).
      const s = engine.state;
      for (const slot of [0, 1, 2, 'reserve'] as SlotRef[]) {
        const pos = engine.validPositions(slot)[0];
        if (pos) return engine.place(slot, pos[0], pos[1]);
      }
      if (s.phase === 'playing') throw new Error('Bot found no move');
      return events;
    }
    if (move.stash >= 0) {
      events.push(...engine.stash(move.stash));
      if (move.from < 0 || engine.state.phase !== 'playing') return events;
    }
    const slot: SlotRef = move.from === 3 ? 'reserve' : move.from;
    events.push(...engine.place(slot, move.x, move.y));
    return events;
  }

  // ------------------------------------------------------------------ plates

  private remainingContracts(engine: RunEngine): number {
    return Math.max(1, totalContracts() - (engine.state.contractIndex + 1));
  }

  /** State a plate is valued with: projected growth for scaling plates. */
  private projectedState(id: MatrixId, current: MatrixState | null, engine: RunEngine): MatrixState {
    const base: MatrixState = current ? { ...current } : createInstance(id, 0).state;
    // Growth over the rest of the run, valued at a point part-way through it.
    const k = Math.min(this.pp.growthCap, this.remainingContracts(engine) * this.pp.growthShare);
    const linesPerContract = (this.linesSeen / this.sheetsSeen) * 10;
    switch (id) {
      case 'journeyman':
        base.mult = (base.mult ?? MX.journeymanStart) + MX.journeymanStep * k;
        break;
      case 'gutenberg':
        base.x = (base.x ?? MX.gutenbergStart) + MX.gutenbergStep * k;
        break;
      case 'archive':
        base.bonus = (base.bonus ?? 0) + MX.archiveStep * linesPerContract * k;
        break;
      case 'ink_well':
        base.mult = (base.mult ?? 0) + MX.inkWellStep * 0.5 * k;
        break;
      case 'scrap': {
        const dryPerPrint = Math.max(0, this.sheetsSeen / this.printsSeen - 1);
        base.stored = Math.min(MX.scrapMax, MX.scrapPerPlacement * dryPerPrint);
        break;
      }
      default:
        break;
    }
    return base;
  }

  /** Canonical rack order (+MULT before ×MULT); Mirror goes where it scores best. */
  orderRack(ids: MatrixId[], states: MatrixState[]): { ids: MatrixId[]; states: MatrixState[] } {
    const items = ids.map((id, k) => ({ id, st: states[k] as MatrixState }));
    const mirrors = items.filter((it) => it.id === 'mirror');
    const rest = items.filter((it) => it.id !== 'mirror');
    rest.sort((a, b) => ORDER_CLASS[a.id] - ORDER_CLASS[b.id]);
    if (mirrors.length === 0) return { ids: rest.map((r) => r.id), states: rest.map((r) => r.st) };
    let best: typeof items | null = null;
    let bestP = -Infinity;
    for (let pos = 0; pos <= rest.length; pos++) {
      const cand = [...rest.slice(0, pos), ...mirrors, ...rest.slice(pos)];
      const p = this.rackPower(
        cand.map((c) => c.id),
        cand.map((c) => c.st),
        null,
      );
      if (p > bestP) {
        bestP = p;
        best = cand;
      }
    }
    const b = best as typeof items;
    return { ids: b.map((r) => r.id), states: b.map((r) => r.st) };
  }

  private powerOf(ids: MatrixId[], states: MatrixState[]): number {
    const o = this.orderRack(ids, states);
    return this.rackPower(o.ids, o.states, null);
  }

  private synergy(id: MatrixId, owned: readonly MatrixId[]): number {
    let n = 0;
    for (const group of Object.values(ARCHETYPES)) {
      if (!group.includes(id)) continue;
      for (const o of owned) if (o !== id && group.includes(o)) n++;
    }
    return n * this.pp.synergy;
  }

  private prior(id: MatrixId, owned: readonly MatrixId[]): number {
    const def = matrixDef(id);
    let v = UTILITY[id] ?? 0;
    if (def.rarity === 'rare') v += this.pp.rarityRare;
    if (def.rarity === 'legendary') v += this.pp.rarityLegendary;
    v += this.synergy(id, owned);
    // A second ink plate dilutes the first one's colour weight.
    if (def.inkAffinity !== undefined && owned.some((o) => matrixDef(o).inkAffinity !== undefined)) v -= 0.05;
    return v;
  }

  /** Value (log gain) of each owned plate: what the rack loses without it. */
  private ownedValues(engine: RunEngine): number[] {
    const plates = engine.state.plates;
    const ids = plates.map((p) => p.id);
    const states = plates.map((p) => this.projectedState(p.id, p.state, engine));
    const full = Math.max(1, this.powerOf(ids, states));
    return plates.map((p, k) => {
      const ids2 = ids.filter((_, j) => j !== k);
      const st2 = states.filter((_, j) => j !== k);
      const without = Math.max(1, this.powerOf(ids2, st2));
      return Math.log(full / without) + this.prior(p.id, ids2);
    });
  }

  decideOffer(engine: RunEngine): OfferDecision {
    const s = engine.state;
    const offer = s.offer;
    if (!offer) return { action: 'skip' };
    const firstOffer = this.offersSeen === 0 && offer.rerolls === 0;
    // Forced experiment: first offer of the run.
    if (firstOffer && this.opts.forcePlate) {
      if (this.opts.forcePlate === 'skip') return { action: 'skip', forced: true };
      const idx = offer.cards.indexOf(this.opts.forcePlate);
      if (idx >= 0) {
        const rep = s.plates.length >= BALANCE.slots ? this.worstOwned(engine).uid : undefined;
        return { action: 'take', card: idx, replaceUid: rep, forced: true };
      }
    }
    const plates = s.plates;
    const ids = plates.map((p) => p.id);
    const states = plates.map((p) => this.projectedState(p.id, p.state, engine));
    const base = Math.max(1, this.powerOf(ids, states));
    const full = plates.length >= BALANCE.slots;
    const owned = full ? this.ownedValues(engine) : [];
    let worstK = -1;
    if (full) {
      for (let k = 0; k < owned.length; k++) {
        if ((plates[k] as MatrixInstance).uid === this.pinnedUid) continue;
        if (worstK < 0 || (owned[k] as number) < (owned[worstK] as number)) worstK = k;
      }
    }
    const values: number[] = [];
    for (const id of offer.cards) {
      const st = this.projectedState(id, null, engine);
      let v: number;
      if (!full) {
        const p = this.powerOf([...ids, id], [...states, st]);
        v = Math.log(Math.max(1, p) / base) + this.prior(id, ids);
      } else if (worstK >= 0) {
        const ids2 = ids.filter((_, j) => j !== worstK);
        const st2 = states.filter((_, j) => j !== worstK);
        const p = this.powerOf([...ids2, id], [...st2, st]);
        const without = Math.max(1, this.powerOf(ids2, st2));
        // Gain of the swap: new plate's value minus the replaced plate's value.
        v =
          Math.log(Math.max(1, p) / without) +
          this.prior(id, ids2) -
          (owned[worstK] as number) -
          this.pp.replaceMargin;
        v += 0.01 * sellValue((plates[worstK] as MatrixInstance).id);
      } else v = -1;
      values.push(v);
    }
    let bestI = 0;
    for (let i = 1; i < values.length; i++) if ((values[i] as number) > (values[bestI] as number)) bestI = i;
    const bestV = values[bestI] ?? -1;
    const replaceUid = full && worstK >= 0 ? (plates[worstK] as MatrixInstance).uid : undefined;

    // Reroll weak offers.
    if (bestV < this.pp.rerollBelow) {
      if ((this.opts.reroll === 'free' || this.opts.reroll === 'ads') && engine.canReroll('free'))
        return { action: 'reroll', values };
      if (this.opts.reroll === 'ads' && engine.canReroll('ad')) return { action: 'reroll', values };
    }
    // Exploration (seeded per offer so paired runs stay comparable).
    const rng = Rng.derive(this.opts.seed, 'bot-explore', offer.index, offer.rerolls);
    // Explore only into a free slot: replacing a built rack at random costs far more than it teaches.
    if (this.opts.epsilon > 0 && rng.next() < this.opts.epsilon && offer.cards.length > 0 && !full) {
      const card = rng.int(offer.cards.length);
      return { action: 'take', card, replaceUid, explore: true, values };
    }
    if (bestV < this.pp.skipValue || (full && worstK < 0)) return { action: 'skip', values };
    return { action: 'take', card: bestI, replaceUid, values };
  }

  private worstOwned(engine: RunEngine): MatrixInstance {
    const vals = this.ownedValues(engine);
    const plates = engine.state.plates;
    let k = 0;
    for (let j = 1; j < plates.length; j++) if ((vals[j] as number) < (vals[k] as number)) k = j;
    return plates[k] as MatrixInstance;
  }

  /** Called right after a plate was added: reorder the rack via movePlate. */
  arrangeRack(engine: RunEngine): RunEvent[] {
    const plates = engine.state.plates;
    if (plates.length < 2) return [];
    const ids = plates.map((p) => p.id);
    const states = plates.map((p) => p.state);
    const target = this.orderRack(ids, states).ids;
    const events: RunEvent[] = [];
    for (let to = 0; to < target.length; to++) {
      const cur = engine.state.plates.map((p) => p.id);
      if (cur[to] === target[to]) continue;
      const from = cur.indexOf(target[to] as MatrixId, to);
      if (from > to) events.push(...engine.movePlate(from, to));
    }
    return events;
  }

  notifyOfferDone(): void {
    this.offersSeen++;
  }

  // ------------------------------------------------------------------ last chance

  /** Estimated value (≈ P(win)) of continuing the contract with `sheets` extra sheets. */
  estimateWithSheets(engine: RunEngine, sheets: number): number {
    const s = engine.state;
    const c = s.contract;
    const inp = this.buildPlanInput(engine, sheets);
    if (s.tray.some((p) => p !== null)) {
      const r = this.planner.plan(inp);
      return r.wins ? 1 : Math.max(0, Math.min(1, r.value));
    }
    const fm = inp.future;
    const row = fm.maxSheets + 1;
    const fut = fm.table[Math.min(c.streak, fm.maxStreak) * row + Math.min(sheets, fm.maxSheets)] as number;
    const sigma = this.w.cv * fut + this.w.sigmaFloor * c.spec.quota;
    const z = (c.progress + fut - c.spec.quota) / sigma;
    return 1 / (1 + Math.exp(-1.7 * z));
  }

  /** Last chance: sell the cheapest-to-lose plate, or accept the loss (→ reprint). */
  lastChance(engine: RunEngine): { events: RunEvent[]; sold: MatrixId | null } {
    const s = engine.state;
    const sellable = engine.sellablePlates().filter((p) => p.uid !== this.pinnedUid);
    const canCont = this.opts.continue === 'always' && !s.continueUsed && s.mode !== 'daily';
    if (sellable.length === 0) return { events: engine.acceptLoss(), sold: null };
    const vals = this.ownedValues(engine);
    let pick: MatrixInstance | null = null;
    let pickScore = Infinity;
    for (const p of sellable) {
      const k = s.plates.findIndex((q) => q.uid === p.uid);
      const score = (vals[k] as number) / sellValue(p.id);
      if (score < pickScore) {
        pickScore = score;
        pick = p;
      }
    }
    const plate = pick as MatrixInstance;
    const pWin = this.estimateWithSheets(engine, sellValue(plate.id));
    if (canCont && pWin < 0.5) return { events: engine.acceptLoss(), sold: null };
    if (!canCont || pWin >= 0.15) return { events: engine.sell(plate.uid), sold: plate.id };
    return { events: engine.acceptLoss(), sold: null };
  }
}

/** Board cell code → short char (debug printing). */
export function boardString(cells: Cells): string {
  const ch = (v: number) =>
    v === EMPTY ? '.' : v === JAM ? 'X' : v === LEAD ? 'L' : v === BLIND ? 'b' : String(v);
  const out: string[] = [];
  for (let y = 0; y < 8; y++)
    out.push(
      cells
        .slice(y * 8, y * 8 + 8)
        .map(ch)
        .join(''),
    );
  return out.join('\n');
}
