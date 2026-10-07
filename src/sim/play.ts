/**
 * Plays one full run with the bot and returns a compact JSON record (one JSONL line).
 */
import { hasModifier, totalContracts } from '../core/contracts';
import { dealTray } from '../core/generator';
import { MATRIX_IDS, STARTER_MATRICES, matrixDef, type MatrixId } from '../core/matrices';
import { Rng } from '../core/rng';
import { RunEngine, type RunEvent } from '../core/run';
import { Bot, type ContinuePolicy, type RerollPolicy } from './bot';
import type { PlannerWeights } from './planner';
import type { PlatePolicy } from './bot';
import { applyOverrides, type Overrides } from './overrides';

export type PoolKind = 'all' | 'starters';

export interface RunConfig {
  seed: string;
  /** Experiment group ('run', 'forced', …) and variant label inside it. */
  group: string;
  variant: string;
  reroll: RerollPolicy;
  continue: ContinuePolicy;
  pool: PoolKind;
  epsilon: number;
  forcePlate: MatrixId | 'skip' | null;
  /** Re-run every deal through dealTray() to record attempts / nodes / time. */
  genProbe: boolean;
  /** Forced plate may never be replaced / sold afterwards. */
  pinForced?: boolean;
  weights?: Partial<PlannerWeights>;
  plate?: Partial<PlatePolicy>;
  /** BALANCE / MX overrides for this run (see overrides.ts). */
  overrides?: Overrides;
}

export interface ContractRec {
  i: number;
  quota: number;
  progress: number;
  sheetsBase: number;
  sheetsGranted: number;
  sheetsUsed: number;
  won: boolean;
  mods: string[];
  plates: string[];
  disabled: string | null;
  /** Offer cards earned (3/4) and rare guarantee (wins only). */
  cards?: number;
  rare?: boolean;
  prints: number;
  lines: number;
  best: number;
  maxStreak: number;
  deals: number;
  fallbacks: number;
  sold: string[];
  continued?: 'quota' | 'jam';
}

export interface OfferRec {
  i: number;
  cards: number;
  rare: boolean;
  /** Every card shown, including before rerolls. */
  seen: string[];
  final: string[];
  freeRerolls: number;
  adRerolls: number;
  action: 'take' | 'skip';
  took?: string;
  replaced?: string;
  explore?: boolean;
  forced?: boolean;
}

export interface GenStats {
  deals: number;
  fallbacks: number;
  /** attempts → count (probe only). */
  attempts: Record<string, number>;
  nodes: number;
  maxNodes: number;
  /** Deal time histogram in 0.1 ms buckets (probe only). */
  timeHist: Record<string, number>;
  maxMs: number;
  mismatches: number;
}

export interface RunRecord {
  v: 1;
  key: string;
  group: string;
  variant: string;
  seed: string;
  policy: {
    reroll: RerollPolicy;
    continue: ContinuePolicy;
    pool: PoolKind;
    epsilon: number;
    force: string | null;
    overrides?: Overrides;
    weights?: Partial<PlannerWeights>;
    plate?: Partial<PlatePolicy>;
  };
  won: boolean;
  contractsWon: number;
  score: number;
  lossReason: 'quota' | 'jam' | null;
  lossContract: number | null;
  contracts: ContractRec[];
  offers: OfferRec[];
  rerolls: { free: number; ad: number };
  continueUsed: boolean;
  /** Type Case stash actions / plates sold in last chance. */
  stashes: number;
  lastChanceSells: number;
  continueReason: 'quota' | 'jam' | null;
  continueContract: number | null;
  /** `${lines}:${streakBefore}:${rack empty ? 0 : 1}` → [count, sum of totals]. */
  printHist: Record<string, [number, number]>;
  gen: GenStats;
  timing: {
    totalMs: number;
    botMs: number;
    decisions: number;
    maxDecisionMs: number;
    decisionHist: Record<string, number>;
    wideRetries: number;
    nodes: number;
  };
  forced: { id: string; applied: boolean; injected: boolean; pinned: boolean } | null;
  platesEnd: string[];
}

function poolFor(kind: PoolKind): MatrixId[] {
  return kind === 'starters' ? [...STARTER_MATRICES] : [...MATRIX_IDS];
}

export function runKey(cfg: Pick<RunConfig, 'group' | 'variant' | 'seed'>): string {
  return `${cfg.group}|${cfg.variant}|${cfg.seed}`;
}

export function playRun(cfg: RunConfig): RunRecord {
  applyOverrides(cfg.overrides);
  const t0 = performance.now();
  const bot = new Bot({
    seed: cfg.seed,
    reroll: cfg.reroll,
    continue: cfg.continue,
    epsilon: cfg.epsilon,
    forcePlate: cfg.forcePlate,
    weights: cfg.weights,
    plate: cfg.plate,
  });
  const created = RunEngine.create({ seed: cfg.seed, pool: poolFor(cfg.pool) });
  let engine = created.engine;
  const startEvents = created.events;
  let offerCount = 0;

  const contracts: ContractRec[] = [];
  const offers: OfferRec[] = [];
  const printHist: Record<string, [number, number]> = {};
  const gen: GenStats = {
    deals: 0,
    fallbacks: 0,
    attempts: {},
    nodes: 0,
    maxNodes: 0,
    timeHist: {},
    maxMs: 0,
    mismatches: 0,
  };
  let cur: ContractRec | null = null;
  let continueReason: 'quota' | 'jam' | null = null;
  let stashes = 0;
  let lcSells = 0;
  let continueContract: number | null = null;
  let lossReason: 'quota' | 'jam' | null = null;
  let lossContract: number | null = null;
  const forced: { id: string; applied: boolean; injected: boolean; pinned: boolean } | null = cfg.forcePlate
    ? { id: cfg.forcePlate, applied: false, injected: false, pinned: Boolean(cfg.pinForced) }
    : null;

  /**
   * Generator telemetry: attempts / nodes come with the 'dealt' event; the deal is re-run through
   * dealTray() only to time it and to check that the engine's deal is reproducible.
   */
  const probeDeal = (e: Extract<RunEvent, { type: 'dealt' }>) => {
    const pieces = e.pieces;
    const count = pieces.length;
    const s = engine.state;
    const spec = s.contract.spec;
    const outOfInk = spec.modifiers.find((m) => m.id === 'out_of_ink');
    const rng = Rng.derive(s.seed, 'tray', s.contractIndex, s.contract.trayIndex - 1);
    const t = performance.now();
    const res = dealTray({
      cells: s.cells,
      count,
      rng,
      inkWeights: engine.inkWeights(),
      blindInk: outOfInk?.ink ?? null,
      bigFormat: hasModifier(spec, 'big_format'),
      rowsOnly: hasModifier(spec, 'rows_only'),
    });
    const dt = performance.now() - t;
    const same =
      res.attempts === e.attempts &&
      res.nodes === e.nodes &&
      res.pieces.length === pieces.length &&
      res.pieces.every((p, k) => p.shape === pieces[k]?.shape && p.ink === pieces[k]?.ink);
    if (!same) gen.mismatches++;
    gen.attempts[String(e.attempts)] = (gen.attempts[String(e.attempts)] ?? 0) + 1;
    gen.nodes += e.nodes;
    gen.maxNodes = Math.max(gen.maxNodes, e.nodes);
    const b = dt < 10 ? (Math.floor(dt * 10) / 10).toFixed(1) : '10+';
    gen.timeHist[b] = (gen.timeHist[b] ?? 0) + 1;
    gen.maxMs = Math.max(gen.maxMs, dt);
  };

  const handle = (events: readonly RunEvent[]) => {
    bot.observe(engine, events);
    const s = engine.state;
    for (const e of events) {
      switch (e.type) {
        case 'contract_started': {
          const disabled =
            e.disabledUid !== null ? (s.plates.find((p) => p.uid === e.disabledUid)?.id ?? null) : null;
          cur = {
            i: e.spec.index,
            quota: e.spec.quota,
            progress: 0,
            sheetsBase: e.spec.sheets,
            sheetsGranted: e.sheets,
            sheetsUsed: 0,
            won: false,
            mods: e.spec.modifiers.map((m) => m.id),
            plates: s.plates.map((p) => p.id),
            disabled,
            prints: 0,
            lines: 0,
            best: 0,
            maxStreak: 0,
            deals: 0,
            fallbacks: 0,
            sold: [],
          };
          contracts.push(cur);
          break;
        }
        case 'dealt':
          gen.deals++;
          if (e.fallback) gen.fallbacks++;
          if (cur) {
            cur.deals++;
            if (e.fallback) cur.fallbacks++;
          }
          if (cfg.genProbe) probeDeal(e);
          break;
        case 'printed': {
          const ctx = e.result.ctx;
          if (cur) {
            cur.prints++;
            cur.lines += ctx.lineCount;
            cur.best = Math.max(cur.best, e.result.total);
            cur.maxStreak = Math.max(cur.maxStreak, e.streak);
          }
          const sb = Math.max(0, ctx.streak - ctx.lineCount);
          const enabledPlates = s.plates.filter((p) => engine.isEnabled(p)).length;
          const key = `${ctx.lineCount}:${Math.min(sb, 30)}:${enabledPlates === 0 ? 0 : 1}`;
          const h = printHist[key] ?? [0, 0];
          h[0]++;
          h[1] += e.result.total;
          printHist[key] = h;
          break;
        }
        case 'contract_won':
          if (cur) {
            cur.won = true;
            cur.progress = e.progress;
            cur.sheetsUsed = e.sheetsUsed;
            cur.cards = e.cards;
            cur.rare = e.guaranteeRare;
            cur.sheetsGranted = s.contract.sheetsGranted;
          }
          break;
        case 'plate_sold':
          if (cur && s.phase !== 'offer' && e.toCurrent) {
            cur.sold.push(e.inst.id);
            lcSells++;
          }
          break;
        case 'stashed':
          stashes++;
          break;
        case 'lost':
          lossReason = e.reason;
          lossContract = s.contractIndex;
          if (cur) {
            cur.progress = s.contract.progress;
            cur.sheetsUsed = s.contract.sheetsUsed;
            cur.sheetsGranted = s.contract.sheetsGranted;
          }
          break;
        case 'continued':
          continueReason = e.reason;
          continueContract = s.contractIndex;
          lossReason = null;
          lossContract = null;
          if (cur) cur.continued = e.reason;
          break;
        default:
          break;
      }
    }
  };

  handle(startEvents);
  let guard = 0;
  let curOffer: OfferRec | null = null;
  while (engine.state.phase !== 'over') {
    if (++guard > 20000) throw new Error(`Run ${cfg.seed} did not terminate`);
    const s = engine.state;
    switch (s.phase) {
      case 'playing':
        handle(bot.play(engine));
        break;
      case 'offer': {
        let offer = s.offer;
        if (!offer) throw new Error('offer phase without offer');
        if (!curOffer || curOffer.i !== offer.index) {
          offerCount++;
          // Forced experiment: make sure the forced plate is on the first offer (snapshot →
          // edit the offer → restore; RNG streams are keyed by indices, so the run continues
          // exactly as it would have).
          const fp = cfg.forcePlate;
          if (offerCount === 1 && fp && fp !== 'skip' && !offer.cards.includes(fp) && forced) {
            const snap = engine.snapshot();
            if (snap.offer) {
              const at = snap.offer.cards.length > 0 ? snap.offer.cards.length - 1 : 0;
              snap.offer.cards[at] = fp;
              engine = RunEngine.restore(snap);
              offer = engine.state.offer as NonNullable<typeof offer>;
              forced.injected = true;
            }
          }
          curOffer = {
            i: offer.index,
            cards: offer.cardCount,
            rare: offer.guaranteeRare,
            seen: [...offer.cards],
            final: [],
            freeRerolls: 0,
            adRerolls: 0,
            action: 'skip',
          };
        }
        const d = bot.decideOffer(engine);
        if (d.action === 'reroll') {
          const kind = engine.canReroll('free') ? 'free' : 'ad';
          const ev = engine.reroll(kind);
          if (kind === 'free') curOffer.freeRerolls++;
          else curOffer.adRerolls++;
          curOffer.seen.push(...(engine.state.offer?.cards ?? []));
          handle(ev);
          break;
        }
        curOffer.final = [...offer.cards];
        if (d.forced) {
          curOffer.forced = true;
          if (forced) forced.applied = true;
        }
        if (d.explore) curOffer.explore = true;
        if (d.action === 'take' && d.card !== undefined) {
          const id = offer.cards[d.card] as MatrixId;
          curOffer.action = 'take';
          curOffer.took = id;
          if (d.replaceUid !== undefined)
            curOffer.replaced = s.plates.find((p) => p.uid === d.replaceUid)?.id;
          const before = new Set(s.plates.map((p) => p.uid));
          offers.push(curOffer);
          curOffer = null;
          bot.notifyOfferDone();
          // takeOffer starts the next contract; reorder first-thing in that contract.
          const ev = engine.takeOffer(d.card, d.replaceUid);
          const added = engine.state.plates.find((p) => !before.has(p.uid));
          if (d.forced && added && cfg.pinForced) bot.pinnedUid = added.uid;
          const moveEv = bot.arrangeRack(engine);
          // Record plates at contract start after arranging (order matters for the report).
          handle(ev);
          if (contracts.length > 0)
            (contracts[contracts.length - 1] as ContractRec).plates = engine.state.plates.map((p) => p.id);
          handle(moveEv);
        } else {
          curOffer.action = 'skip';
          offers.push(curOffer);
          curOffer = null;
          bot.notifyOfferDone();
          handle(engine.skipOffer());
        }
        break;
      }
      case 'last_chance': {
        const r = bot.lastChance(engine);
        handle(r.events);
        break;
      }
      case 'lost':
        if (cfg.continue === 'always' && engine.canContinue()) handle(engine.continueRun());
        else handle(engine.endRun());
        break;
      case 'victory':
        handle(engine.endRun());
        break;
      default:
        throw new Error(`Unexpected phase ${s.phase}`);
    }
  }

  const s = engine.state;
  const totalMs = performance.now() - t0;
  return {
    v: 1,
    key: runKey(cfg),
    group: cfg.group,
    variant: cfg.variant,
    seed: cfg.seed,
    policy: {
      reroll: cfg.reroll,
      continue: cfg.continue,
      pool: cfg.pool,
      epsilon: cfg.epsilon,
      force: cfg.forcePlate,
      ...(cfg.overrides && Object.keys(cfg.overrides).length > 0 ? { overrides: cfg.overrides } : {}),
      ...(cfg.weights ? { weights: cfg.weights } : {}),
      ...(cfg.plate ? { plate: cfg.plate } : {}),
    },
    won: s.totals.contractsWon >= totalContracts(),
    contractsWon: s.totals.contractsWon,
    score: s.totals.score,
    lossReason,
    lossContract,
    contracts,
    offers,
    rerolls: {
      free: offers.reduce((a, o) => a + o.freeRerolls, 0),
      ad: offers.reduce((a, o) => a + o.adRerolls, 0),
    },
    continueUsed: s.continueUsed,
    stashes,
    lastChanceSells: lcSells,
    continueReason,
    continueContract,
    printHist,
    gen,
    timing: {
      totalMs: round2(totalMs),
      botMs: round2(bot.decisionMs),
      decisions: bot.decisions,
      maxDecisionMs: round2(bot.decisionMax),
      decisionHist: bot.decisionHist,
      wideRetries: bot.fallbacks,
      nodes: bot.planNodes,
    },
    forced,
    platesEnd: s.plates.map((p) => p.id),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Rarity of a plate id (for the report). */
export function rarityOf(id: string): string {
  return matrixDef(id as MatrixId).rarity;
}
