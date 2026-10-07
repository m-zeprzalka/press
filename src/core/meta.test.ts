/**
 * Meta progression (GDD §10): lifetime stats, achievements + unlocks (§10.2), the daily
 * record / streak / share grid (§10.1) and migration of persisted meta.
 *
 * Stats are checked against real runs played by a deterministic greedy autoplayer: every
 * expected number is recomputed independently from the raw engine events (and cross-checked
 * against the engine's own run totals), never read back from meta.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from './config/balance';
import { EMPTY, JAM, idx, isInk, lineCells, newCells, type Cells, type FullLines, type Ink } from './board';
import { dailyPool, dailySeed, dailyStartPlate } from './daily';
import {
  MATRICES,
  MATRIX_IDS,
  STARTER_MATRICES,
  createInstance,
  type MatrixId,
  type PrintCtx,
} from './matrices';
import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_THRESHOLDS,
  ACHIEVEMENT_UNLOCKS,
  META_VERSION,
  applyRunEvents,
  dailyGrid,
  migrateMeta,
  newMeta,
  onRunStarted,
  unlockedPool,
  type AchievementId,
  type MetaState,
  type MetaUpdate,
} from './meta';
import { BOARD_SIZE, shapeById } from './pieces';
import { RunEngine, type ContractRecord, type RunEvent, type RunState, type SlotRef } from './run';
import { scorePrint } from './scoring';

// ---------------------------------------------------------------------------
// Greedy autoplayer (deterministic: the engine is seeded, ties resolve by scan order).

interface Policy {
  /** Always skip offers (never own a plate). */
  skipOffers?: boolean;
  /** Sell down to one plate at the start of every special job of edition 3+ (aims at 'ascetic'). */
  asceticSell?: boolean;
}

function contact(s: Readonly<RunState>, shapeId: string, x: number, y: number): number {
  const shape = shapeById(shapeId);
  const own = new Set(shape.cells.map(([dx, dy]) => idx(x + dx, y + dy)));
  let n = 0;
  for (const [dx, dy] of shape.cells) {
    for (const [ax, ay] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx + ax;
      const ny = y + dy + ay;
      if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) n++;
      else if (!own.has(idx(nx, ny)) && s.cells[idx(nx, ny)] !== EMPTY) n++;
    }
  }
  return n;
}

function greedyStep(e: RunEngine, policy: Policy = {}): RunEvent[] | null {
  const s = e.state;
  switch (s.phase) {
    case 'playing': {
      const special = s.contractIndex % BALANCE.contractsPerEdition === BALANCE.contractsPerEdition - 1;
      if (
        policy.asceticSell &&
        special &&
        s.contractIndex >= 2 * BALANCE.contractsPerEdition &&
        s.plates.length > 1
      ) {
        return e.sell((s.plates[s.plates.length - 1] as { uid: number }).uid);
      }
      let best: { slot: SlotRef; x: number; y: number; v: number } | null = null;
      const slots: SlotRef[] = [0, 1, 2];
      if (e.reserveSlots() > 0 && s.reserve) slots.push('reserve');
      for (const slot of slots) {
        const p = e.pieceAt(slot);
        if (!p) continue;
        for (const [x, y] of e.validPositions(slot)) {
          const l = e.previewLines(slot, x, y);
          if (!l) continue;
          const v = (l.rows.length + l.cols.length) * 1000 + contact(s, p.shape, x, y);
          if (!best || v > best.v) best = { slot, x, y, v };
        }
      }
      if (!best) throw new Error('greedy: playing without a legal move');
      return e.place(best.slot, best.x, best.y);
    }
    case 'offer': {
      const offer = s.offer;
      if (policy.skipOffers || !offer || offer.cards.length === 0) return e.skipOffer();
      if (s.plates.length >= BALANCE.slots) return e.takeOffer(0, (s.plates[0] as { uid: number }).uid);
      return e.takeOffer(0);
    }
    case 'last_chance': {
      const p = e.sellablePlates()[0];
      return p ? e.sell(p.uid) : e.acceptLoss();
    }
    case 'lost':
      return e.canContinue() ? e.continueRun() : e.endRun();
    case 'victory':
      return e.endRun();
    case 'over':
      return null;
  }
}

interface Action {
  events: RunEvent[];
  /** Engine state right after the action (what the controller passes to applyRunEvents). */
  state: RunState;
  now: number;
  upd: MetaUpdate;
}

/** Plays one run to the end, feeding every action's events to meta like the controller does. */
function playRun(
  meta: MetaState,
  engine: RunEngine,
  created: RunEvent[],
  t0: number,
  policy: Policy = {},
): Action[] {
  onRunStarted(meta);
  const actions: Action[] = [];
  let now = t0;
  const push = (events: RunEvent[]) => {
    const state = engine.snapshot();
    actions.push({ events, state, now, upd: applyRunEvents(meta, state, events, now) });
    now++;
  };
  push(created);
  for (let n = 0; n < 5000; n++) {
    const events = greedyStep(engine, policy);
    if (!events) return actions;
    push(events);
  }
  throw new Error('greedy: run did not finish');
}

const standardRun = (seed: string) => RunEngine.create({ seed });

function dailyRunEngine(date: string) {
  return RunEngine.create({
    seed: dailySeed(date),
    mode: 'daily',
    dailyDate: date,
    pool: dailyPool(),
    startPlates: [dailyStartPlate(date)],
  });
}

// ---------------------------------------------------------------------------
// Independent recomputation of stats / achievement conditions from raw events.

interface Expect {
  placements: number;
  prints: number;
  lines: number;
  score: number;
  bestPrint: number;
  maxLines: number;
  maxStreak: number;
  crosses: number;
  monoLines: number;
  picks: Partial<Record<MatrixId, number>>;
  /** Action index at which each achievement's condition first held. */
  firstTrue: Partial<Record<AchievementId, number>>;
}

function emptyExpect(): Expect {
  return {
    placements: 0,
    prints: 0,
    lines: 0,
    score: 0,
    bestPrint: 0,
    maxLines: 0,
    maxStreak: 0,
    crosses: 0,
    monoLines: 0,
    picks: {},
    firstTrue: {},
  };
}

function lineValues(
  cleared: ReadonlyArray<{ i: number; v: number }>,
  kind: 'row' | 'col',
  n: number,
): number[] {
  const map = new Map(cleared.map((c) => [c.i, c.v]));
  return lineCells(kind, n).map((i) => map.get(i) as number);
}

/** Folds one action into the independent expectation (the run state is the post-action state). */
function foldAction(x: Expect, a: Action, wonInRun: { n: number }): void {
  const hit = (id: AchievementId) => {
    if (x.firstTrue[id] === undefined) x.firstTrue[id] = a.now;
  };
  const per = BALANCE.contractsPerEdition;
  for (const e of a.events) {
    if (e.type === 'placed') x.placements++;
    if (e.type === 'printed') {
      const n = e.lines.rows.length + e.lines.cols.length;
      x.prints++;
      x.lines += n;
      x.score += e.result.total;
      x.bestPrint = Math.max(x.bestPrint, e.result.total);
      x.maxLines = Math.max(x.maxLines, n);
      x.maxStreak = Math.max(x.maxStreak, e.streak);
      if (e.lines.rows.length > 0 && e.lines.cols.length > 0) x.crosses++;
      const inks = new Set<number>();
      const refs = [
        ...e.lines.rows.map((r) => ['row', r] as const),
        ...e.lines.cols.map((c) => ['col', c] as const),
      ];
      for (const [kind, k] of refs) {
        const vals = lineValues(e.cleared, kind, k);
        for (const v of vals) if (isInk(v)) inks.add(v);
        if (isInk(vals[0] as number) && vals.every((v) => v === vals[0])) x.monoLines++;
      }
      hit('first_print');
      if (n >= 4) hit('quad');
      if (x.crosses >= 15) hit('cross_15');
      if (inks.size >= 4) hit('palette_4');
      if (inks.size >= 5) hit('palette_5');
      if (n >= 3 && a.state.cells.every((v) => v === EMPTY || v === JAM)) hit('clean_3');
      if (e.streak >= 12) hit('streak_12');
      if (e.streak >= 20) hit('streak_20');
      if (e.result.total >= 10_000) hit('big_print');
      if (x.score >= 1_000_000) hit('millionaire');
    }
    if (e.type === 'contract_won') {
      wonInRun.n++;
      // Winning the 6th job reaches edition 3, the 15th reaches edition 6.
      if (wonInRun.n >= 2 * per) hit('reach_e3');
      if (wonInRun.n >= 5 * per) hit('reach_e6');
      if (wonInRun.n >= 30) hit('endless');
      const edition = Math.floor(e.index / per) + 1;
      if (e.index % per === per - 1 && edition >= 3 && a.state.plates.length <= 1) hit('ascetic');
    }
    if (e.type === 'plate_added') {
      x.picks[e.inst.id] = (x.picks[e.inst.id] ?? 0) + 1;
      if (a.state.plates.length >= 5) hit('collector');
    }
    if (e.type === 'victory') hit('win_run');
  }
}

function checkAgainst(meta: MetaState, x: Expect): void {
  const st = meta.stats;
  expect(st.totalPlacements).toBe(x.placements);
  expect(st.totalPrints).toBe(x.prints);
  expect(st.totalLines).toBe(x.lines);
  expect(st.totalScore).toBe(x.score);
  expect(st.bestPrint).toBe(x.bestPrint);
  expect(st.maxLines).toBe(x.maxLines);
  expect(st.maxStreak).toBe(x.maxStreak);
  expect(st.crosses).toBe(x.crosses);
  expect(st.monoLines).toBe(x.monoLines);
  expect(st.picks).toEqual(x.picks);
  // Achievements: granted ⇔ condition held, timestamped by the action where it first held.
  const expected: Partial<Record<AchievementId, number>> = {};
  for (const id of ACHIEVEMENT_IDS)
    if (x.firstTrue[id] !== undefined && id !== 'regular') expected[id] = x.firstTrue[id];
  const got = { ...meta.achievements };
  delete got.regular;
  expect(got).toEqual(expected);
}

// ---------------------------------------------------------------------------
// Hand-crafted events.

interface PrintOpts {
  rows?: number;
  cols?: number;
  inks?: number[];
  mono?: number;
  clean?: boolean;
  total?: number;
  streak?: number;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function printed(o: PrintOpts = {}): RunEvent {
  const rows = o.rows ?? 1;
  const cols = o.cols ?? 0;
  const lines: FullLines = { rows: range(rows), cols: range(cols) };
  const inks = (o.inks ?? [0]) as Ink[];
  const total = o.total ?? 80;
  const streak = o.streak ?? rows + cols;
  const ctx: PrintCtx = {
    lines: [
      ...lines.rows.map((n) => ({ kind: 'row' as const, n })),
      ...lines.cols.map((n) => ({ kind: 'col' as const, n })),
    ],
    lineCount: rows + cols,
    rowCount: rows,
    colCount: cols,
    intersections: rows * cols,
    inks,
    lineInkCounts: range(rows + cols).map(() => inks.length),
    monoLines: o.mono ?? 0,
    pieceSize: 1,
    streak,
    sheetsLeft: 10,
    sheetsUsed: 10,
    printIndex: 0,
    boardCleanAfter: o.clean ?? false,
    cellsAfter: o.clean ? 0 : 8,
    emptySlots: 5,
  };
  return {
    type: 'printed',
    result: { total, prints: total, mult: 1, events: [], ctx, triggers: [] },
    lines,
    cleared: [],
    streak,
    progress: total,
  };
}

const won = (index: number): RunEvent => ({
  type: 'contract_won',
  index,
  progress: 1,
  quota: 1,
  sheetsUsed: 10,
  cards: 3,
  guaranteeRare: false,
});

const BASE: RunState = standardRun('meta-base').engine.snapshot();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** BASE with `n` plates in the rack. */
function withPlates(n: number, base: RunState = BASE): RunState {
  const s = clone(base);
  s.plates = MATRIX_IDS.slice(0, n).map((id, i) => createInstance(id, 900 + i));
  return s;
}

function plateAdded(run: RunState): RunEvent {
  const inst = run.plates[run.plates.length - 1] ?? createInstance('proof', 1);
  return { type: 'plate_added', inst, slot: Math.max(0, run.plates.length - 1), replaced: null };
}

const DAILY_BASE: RunState = dailyRunEngine('2026-10-07').engine.snapshot();

/** A finished daily run of `date` with the given result (history: wins with inks 0,1,2,…, then a loss). */
function dailyOver(date: string, contractsWon: number, score: number, history?: ContractRecord[]): RunState {
  const s = clone(DAILY_BASE);
  s.dailyDate = date;
  s.seed = dailySeed(date);
  s.phase = 'over';
  s.totals.contractsWon = contractsWon;
  s.totals.score = score;
  s.totals.history = history ?? [
    ...range(contractsWon).map((i) => ({
      index: i,
      won: true,
      progress: 1,
      quota: 1,
      sheetsUsed: 1,
      dominantInk: i % 5,
    })),
    { index: contractsWon, won: false, progress: 0, quota: 1, sheetsUsed: 20, dominantInk: null },
  ];
  return s;
}

const runOver = (wonRun = false): RunEvent => ({ type: 'run_over', won: wonRun });

// ---------------------------------------------------------------------------

describe('applyRunEvents — stats from real runs', () => {
  it('a full greedy run: every stat matches the events and the engine totals', () => {
    for (const seed of ['meta-a', 'meta-b', 'meta-c']) {
      const meta = newMeta();
      const { engine, events } = standardRun(seed);
      const actions = playRun(meta, engine, events, 1000);
      const x = emptyExpect();
      const wonInRun = { n: 0 };
      for (const a of actions) foldAction(x, a, wonInRun);
      checkAgainst(meta, x);

      const t = engine.state.totals;
      const st = meta.stats;
      expect(st.totalPlacements).toBe(t.placements);
      expect(st.totalPrints).toBe(t.prints);
      expect(st.totalLines).toBe(t.lines);
      expect(st.totalScore).toBe(t.score);
      expect(st.bestPrint).toBe(t.bestPrint);
      expect(st.maxStreak).toBe(t.maxStreak);
      expect(st.maxLines).toBe(t.maxLines);
      expect(st.runs).toBe(1);
      expect(st.completedRuns).toBe(1);
      expect(st.wins + st.lostRuns).toBe(1);
      expect(st.lostRuns).toBe(
        engine.state.endless || engine.state.totals.history.every((h) => h.won) ? 0 : 1,
      );
      expect(st.bestContracts).toBe(t.contractsWon);
      expect(st.bestScore).toBe(t.score);
      expect(st.dailyPlayed).toBe(0);
      expect(meta.daily).toEqual({});
      // Sanity: the greedy player really plays (wins jobs, prints lines).
      expect(t.contractsWon).toBeGreaterThan(2);
      expect(st.totalPrints).toBeGreaterThan(10);
    }
  });

  it('accumulates over several runs (sums, maxima, counters)', () => {
    const meta = newMeta();
    const x = emptyExpect();
    let bestScore = 0;
    let bestContracts = 0;
    let t0 = 0;
    const seeds = ['meta-d', 'meta-e', 'meta-f', 'meta-g'];
    for (const seed of seeds) {
      const { engine, events } = standardRun(seed);
      const actions = playRun(meta, engine, events, t0);
      t0 += 100_000;
      const wonInRun = { n: 0 };
      for (const a of actions) foldAction(x, a, wonInRun);
      bestScore = Math.max(bestScore, engine.state.totals.score);
      bestContracts = Math.max(bestContracts, engine.state.totals.contractsWon);
    }
    checkAgainst(meta, x);
    expect(meta.stats.runs).toBe(seeds.length);
    expect(meta.stats.completedRuns).toBe(seeds.length);
    expect(meta.stats.wins + meta.stats.lostRuns).toBe(seeds.length);
    expect(meta.stats.bestScore).toBe(bestScore);
    expect(meta.stats.bestContracts).toBe(bestContracts);
  });

  it('MetaUpdate reports each achievement and unlock exactly once, matching meta', () => {
    const meta = newMeta();
    const all: MetaUpdate = { achievements: [], unlocks: [] };
    for (const seed of ['meta-h', 'meta-i']) {
      const { engine, events } = standardRun(seed);
      for (const a of playRun(meta, engine, events, 0)) {
        all.achievements.push(...a.upd.achievements);
        all.unlocks.push(...a.upd.unlocks);
      }
    }
    expect(all.achievements.length).toBeGreaterThan(0);
    expect(new Set(all.achievements).size).toBe(all.achievements.length);
    expect(new Set(all.achievements)).toEqual(new Set(Object.keys(meta.achievements)));
    expect(all.unlocks).toEqual(meta.unlocked);
    for (const p of meta.unlocked) expect(STARTER_MATRICES).not.toContain(p);
  });

  it("a real run earns 'ascetic' by delivering an edition-3+ special job with ≤ 1 plate", () => {
    const meta = newMeta();
    // The greedy test player is weak: an easy quota curve keeps it alive into edition 3, so the
    // test checks the achievement, not the player's strength against the tuned curve.
    const quotaStart = BALANCE.quotaStart;
    BALANCE.quotaStart = 100;
    let actions: Action[];
    try {
      const { engine, events } = standardRun('meta-ascetic-0');
      actions = playRun(meta, engine, events, 5000, { asceticSell: true });
    } finally {
      BALANCE.quotaStart = quotaStart;
    }
    const x = emptyExpect();
    const wonInRun = { n: 0 };
    for (const a of actions) foldAction(x, a, wonInRun);
    checkAgainst(meta, x);
    expect(meta.achievements.ascetic).toBeDefined();
    expect(meta.unlocked).toContain('stencil');
    const at = actions.find((a) => a.now === meta.achievements.ascetic) as Action;
    const job = at.events.find((e) => e.type === 'contract_won');
    expect(job?.type === 'contract_won' && job.index >= 8 && job.index % 3 === 2).toBe(true);
    expect(at.state.plates.length).toBeLessThanOrEqual(1);
  });

  it("a real run earns 'collector' when the 5th plate is taken from an offer", () => {
    // Greedy until the first offer screen, then a rack of 4 plates (doctored), then take a card.
    const { engine } = standardRun('meta-collector');
    while (engine.state.phase !== 'offer') greedyStep(engine);
    const s = engine.snapshot();
    const cards = s.offer?.cards ?? [];
    expect(cards.length).toBeGreaterThan(0);
    s.plates = MATRIX_IDS.filter((id) => !cards.includes(id) && id !== 'ream')
      .slice(0, 4)
      .map((id) => createInstance(id, s.nextUid++));
    const e = RunEngine.restore(s);
    const meta = newMeta();
    const before = applyRunEvents(meta, e.state, [], 1);
    expect(before.achievements).toEqual([]);
    const events = e.takeOffer(0);
    const upd = applyRunEvents(meta, e.state, events, 2);
    expect(e.state.plates.length).toBe(5);
    expect(upd.achievements).toContain('collector');
    expect(meta.stats.picks[cards[0] as MatrixId]).toBe(1);
  });

  it("a real run earns 'win_run' and counts a win", () => {
    const { engine } = standardRun('meta-victory');
    const s = engine.snapshot();
    s.contractIndex = 23; // last job, quota almost met
    s.contract.progress = s.contract.spec.quota - 1;
    const e = RunEngine.restore(s);
    const meta = newMeta();
    onRunStarted(meta);
    let now = 10;
    while (e.state.phase !== 'over') {
      const events = greedyStep(e) as RunEvent[];
      applyRunEvents(meta, e.state, events, now++);
    }
    expect(meta.achievements.win_run).toBeDefined();
    expect(meta.unlocked).toContain('golden_type');
    expect(meta.stats.wins).toBe(1);
    expect(meta.stats.lostRuns).toBe(0);
    expect(meta.stats.completedRuns).toBe(1);
    expect(meta.stats.bestContracts).toBe(e.state.totals.contractsWon);
  });

  it('counts runs on start, completed runs only on run_over', () => {
    const meta = newMeta();
    onRunStarted(meta);
    onRunStarted(meta);
    expect(meta.stats.runs).toBe(2);
    expect(meta.stats.completedRuns).toBe(0);
    applyRunEvents(meta, BASE, [runOver(false)], 1);
    applyRunEvents(meta, BASE, [runOver(true)], 2);
    expect(meta.stats).toMatchObject({ runs: 2, completedRuns: 2, wins: 1, lostRuns: 1 });
  });

  it('accumulates hand-crafted printed events', () => {
    const meta = newMeta();
    const events = [
      printed({ rows: 1, total: 80, streak: 1 }),
      printed({ rows: 2, cols: 1, total: 900, streak: 4, mono: 2 }),
      printed({ rows: 0, cols: 3, total: 400, streak: 7, mono: 1 }),
      printed({ rows: 1, cols: 1, total: 50, streak: 2 }),
    ];
    const upd = applyRunEvents(meta, BASE, events, 7);
    expect(meta.stats).toMatchObject({
      totalPrints: 4,
      totalLines: 1 + 3 + 3 + 2,
      totalScore: 80 + 900 + 400 + 50,
      bestPrint: 900,
      maxLines: 3,
      maxStreak: 7,
      crosses: 2,
      monoLines: 3,
      totalPlacements: 0,
    });
    expect(upd.achievements).toEqual(['first_print']);
    expect(meta.achievements.first_print).toBe(7);
  });

  it('a real scorePrint result (4 rows + 1 column, 5 inks, clean forme) drives the print achievements', () => {
    const cells: Cells = newCells();
    for (let y = 0; y < 4; y++) for (let x = 0; x < BOARD_SIZE; x++) cells[idx(x, y)] = (x + y) % 5;
    for (let y = 4; y < BOARD_SIZE; y++) cells[idx(0, y)] = 0;
    const lines: FullLines = { rows: [0, 1, 2, 3], cols: [0] };
    const result = scorePrint({
      cells,
      lines,
      pieceSize: 4,
      streak: 5,
      sheetsLeft: 10,
      sheetsUsed: 10,
      printIndex: 0,
      slots: [],
      slotCapacity: BALANCE.slots,
      random: () => 0.5,
    });
    expect(result.ctx).toMatchObject({ lineCount: 5, rowCount: 4, colCount: 1, boardCleanAfter: true });
    expect(result.ctx.inks).toEqual([0, 1, 2, 3, 4]);
    const meta = newMeta();
    const event: RunEvent = {
      type: 'printed',
      result,
      lines,
      cleared: [],
      streak: 5,
      progress: result.total,
    };
    const upd = applyRunEvents(meta, BASE, [event], 3);
    expect(new Set(upd.achievements)).toEqual(
      new Set(['first_print', 'quad', 'palette_4', 'palette_5', 'clean_3']),
    );
    expect(new Set(upd.unlocks)).toEqual(new Set(['registration', 'split_fountain', 'clean_sheet']));
    expect(meta.stats).toMatchObject({
      crosses: 1,
      totalLines: 5,
      maxLines: 5,
      maxStreak: 5,
      totalScore: result.total,
    });
  });

  it('ignores events without stats (dealt, streak, offer, …) and an empty list', () => {
    const meta = newMeta();
    const { events } = standardRun('meta-quiet');
    const upd = applyRunEvents(
      meta,
      BASE,
      [...events, { type: 'last_chance' }, { type: 'offer_skipped', sheets: 3 }],
      1,
    );
    expect(upd).toEqual({ achievements: [], unlocks: [] });
    expect(applyRunEvents(meta, BASE, [], 2)).toEqual({ achievements: [], unlocks: [] });
    expect(meta).toEqual(newMeta());
  });
});

// ---------------------------------------------------------------------------

/** One scenario per achievement: the minimal events that satisfy its GDD §10.2 condition. */
const SCENARIOS: Record<AchievementId, () => Array<{ run: RunState; events: RunEvent[] }>> = {
  first_print: () => [{ run: BASE, events: [printed()] }],
  quad: () => [{ run: BASE, events: [printed({ rows: 4 })] }],
  cross_15: () => range(15).map(() => ({ run: BASE, events: [printed({ rows: 1, cols: 1 })] })),
  palette_4: () => [{ run: BASE, events: [printed({ inks: [0, 1, 2, 3] })] }],
  palette_5: () => [{ run: BASE, events: [printed({ inks: [0, 1, 2, 3, 4] })] }],
  clean_3: () => [{ run: BASE, events: [printed({ rows: 3, clean: true })] }],
  reach_e3: () => [{ run: BASE, events: [won(5)] }],
  reach_e6: () => [{ run: BASE, events: [won(14)] }],
  win_run: () => [{ run: BASE, events: [{ type: 'victory' }] }],
  ascetic: () => [{ run: withPlates(1), events: [won(8)] }],
  streak_12: () => [{ run: BASE, events: [printed({ streak: 12 })] }],
  streak_20: () => [{ run: BASE, events: [printed({ streak: 20 })] }],
  big_print: () => [{ run: BASE, events: [printed({ total: 10_000 })] }],
  collector: () => {
    const run = withPlates(5);
    return [{ run, events: [plateAdded(run)] }];
  },
  millionaire: () => range(4).map(() => ({ run: BASE, events: [printed({ total: 250_000 })] })),
  regular: () =>
    ['2026-10-01', '2026-10-03', '2026-10-09'].map((d) => ({
      run: dailyOver(d, 2, 500),
      events: [runOver()],
    })),
  endless: () => [{ run: BASE, events: [won(29)] }],
};

function applyAll(
  meta: MetaState,
  steps: Array<{ run: RunState; events: RunEvent[] }>,
  now: number,
): MetaUpdate {
  const out: MetaUpdate = { achievements: [], unlocks: [] };
  for (const s of steps) {
    const u = applyRunEvents(meta, s.run, s.events, now);
    out.achievements.push(...u.achievements);
    out.unlocks.push(...u.unlocks);
  }
  return out;
}

describe('achievements and unlocks (GDD §10.2)', () => {
  it('the unlock table is the one in the GDD', () => {
    expect(ACHIEVEMENT_UNLOCKS).toEqual({
      cross_15: 'crossmark',
      palette_4: 'registration',
      palette_5: 'split_fountain',
      clean_3: 'clean_sheet',
      reach_e3: 'type_case',
      reach_e6: 'mirror',
      win_run: 'golden_type',
      ascetic: 'stencil',
      streak_12: 'conveyor',
      streak_20: 'momentum',
    });
    expect(ACHIEVEMENT_IDS).toHaveLength(17);
    expect(ACHIEVEMENT_THRESHOLDS).toMatchObject({
      crosses: 15,
      streakA: 12,
      streakB: 20,
      bigPrint: 10_000,
      millionaire: 1_000_000,
      dailies: 3,
      endlessContract: 30,
    });
  });

  it('starter pool is 22 plates and the 10 unlocks are exactly the other plates (GDD §8.1)', () => {
    const unlocks = Object.values(ACHIEVEMENT_UNLOCKS);
    expect(STARTER_MATRICES).toHaveLength(22);
    expect(new Set(unlocks).size).toBe(10);
    for (const p of unlocks) expect(STARTER_MATRICES).not.toContain(p);
    expect(new Set([...STARTER_MATRICES, ...unlocks])).toEqual(new Set(MATRICES.keys()));
  });

  it('there is a scenario for every achievement id', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
  });

  for (const id of ACHIEVEMENT_IDS) {
    it(`${id}: granted by its condition, unlock granted exactly once`, () => {
      const meta = newMeta();
      const first = applyAll(meta, SCENARIOS[id](), 111);
      expect(first.achievements).toContain(id);
      expect(first.achievements.filter((a) => a === id)).toHaveLength(1);
      expect(meta.achievements[id]).toBe(111);
      const plate = ACHIEVEMENT_UNLOCKS[id];
      if (plate) {
        expect(first.unlocks.filter((p) => p === plate)).toHaveLength(1);
        expect(meta.unlocked.filter((p) => p === plate)).toHaveLength(1);
      }
      // Satisfying the condition again changes nothing.
      const again = applyAll(meta, SCENARIOS[id](), 222);
      expect(again.achievements).not.toContain(id);
      expect(meta.achievements[id]).toBe(111);
      if (plate) {
        expect(again.unlocks).not.toContain(plate);
        expect(meta.unlocked.filter((p) => p === plate)).toHaveLength(1);
      }
      expect(new Set(meta.unlocked).size).toBe(meta.unlocked.length);
      for (const p of meta.unlocked) expect(STARTER_MATRICES).not.toContain(p);
    });
  }

  it('an unlock already present (e.g. restored meta) is not duplicated', () => {
    const meta = migrateMeta({ unlocked: ['crossmark'] });
    const upd = applyAll(meta, SCENARIOS.cross_15(), 5);
    expect(upd.achievements).toContain('cross_15');
    expect(upd.unlocks).toEqual([]);
    expect(meta.unlocked).toEqual(['crossmark']);
  });

  it('granting everything unlocks the full 32-plate pool, with no starter in `unlocked`', () => {
    const meta = newMeta();
    for (const id of ACHIEVEMENT_IDS) applyAll(meta, SCENARIOS[id](), 1);
    expect(Object.keys(meta.achievements).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
    expect(meta.unlocked).toHaveLength(10);
    for (const p of meta.unlocked) expect(STARTER_MATRICES).not.toContain(p);
    expect(new Set(unlockedPool(meta))).toEqual(new Set(MATRICES.keys()));
    expect(unlockedPool(meta)).toHaveLength(MATRICES.size);
  });

  it('thresholds: one below never grants', () => {
    const cases: Array<[AchievementId, Array<{ run: RunState; events: RunEvent[] }>]> = [
      ['quad', [{ run: BASE, events: [printed({ rows: 3 }), printed({ rows: 2, cols: 1 })] }]],
      ['cross_15', range(14).map(() => ({ run: BASE, events: [printed({ rows: 1, cols: 1 })] }))],
      ['palette_4', [{ run: BASE, events: [printed({ inks: [0, 1, 2] })] }]],
      ['palette_5', [{ run: BASE, events: [printed({ inks: [0, 1, 2, 3] })] }]],
      [
        'clean_3',
        [{ run: BASE, events: [printed({ rows: 2, clean: true }), printed({ rows: 3, clean: false })] }],
      ],
      ['reach_e3', [{ run: BASE, events: [won(4)] }]],
      ['reach_e6', [{ run: BASE, events: [won(13)] }]],
      ['streak_12', [{ run: BASE, events: [printed({ streak: 11 })] }]],
      ['streak_20', [{ run: BASE, events: [printed({ streak: 19 })] }]],
      ['big_print', [{ run: BASE, events: [printed({ total: 9_999 })] }]],
      ['millionaire', [{ run: BASE, events: [printed({ total: 999_999 })] }]],
      ['endless', [{ run: BASE, events: [won(28)] }]],
      ['collector', [{ run: withPlates(4), events: [plateAdded(withPlates(4))] }]],
      [
        'regular',
        ['2026-10-01', '2026-10-01', '2026-10-01', '2026-10-02'].map((d) => ({
          run: dailyOver(d, 1, 1),
          events: [runOver()],
        })),
      ],
    ];
    for (const [id, steps] of cases) {
      const meta = newMeta();
      const upd = applyAll(meta, steps, 1);
      expect(upd.achievements, id).not.toContain(id);
      expect(meta.achievements[id], id).toBeUndefined();
    }
  });

  it('cross_15 counts prints with a row AND a column, cumulatively across runs', () => {
    const meta = newMeta();
    for (let n = 0; n < 7; n++) applyRunEvents(meta, BASE, [printed({ rows: 2, cols: 1 })], n);
    for (let n = 0; n < 10; n++)
      applyRunEvents(meta, BASE, [printed({ rows: 3 }), printed({ cols: 2, rows: 0 })], n);
    expect(meta.stats.crosses).toBe(7);
    applyRunEvents(meta, BASE, [runOver()], 50);
    for (let n = 0; n < 7; n++) applyRunEvents(meta, BASE, [printed({ rows: 1, cols: 1 })], 100 + n);
    expect(meta.achievements.cross_15).toBeUndefined();
    const upd = applyRunEvents(meta, BASE, [printed({ rows: 1, cols: 4 })], 200);
    expect(meta.stats.crosses).toBe(15);
    expect(upd.achievements).toContain('cross_15');
    expect(meta.achievements.cross_15).toBe(200);
  });

  it('millionaire is cumulative over prints and runs', () => {
    const meta = newMeta();
    applyRunEvents(meta, BASE, [printed({ total: 600_000 })], 1);
    applyRunEvents(meta, BASE, [runOver()], 2);
    expect(meta.achievements.millionaire).toBeUndefined();
    applyRunEvents(meta, BASE, [printed({ total: 399_999 })], 3);
    expect(meta.achievements.millionaire).toBeUndefined();
    applyRunEvents(meta, BASE, [printed({ total: 1 })], 4);
    expect(meta.achievements.millionaire).toBe(4);
    expect(meta.achievements.big_print).toBe(1);
  });

  describe("'ascetic' — special job of edition ≥ 3 with ≤ 1 plate", () => {
    const grants = (index: number, plates: number) => {
      const meta = newMeta();
      applyRunEvents(meta, withPlates(plates), [won(index)], 1);
      return meta.achievements.ascetic !== undefined;
    };

    it('grants for every edition-3+ special job with 0 or 1 plate (incl. endless mode)', () => {
      for (const index of [8, 11, 14, 17, 20, 23, 26, 29]) {
        expect(grants(index, 0), `job ${index} / 0 plates`).toBe(true);
        expect(grants(index, 1), `job ${index} / 1 plate`).toBe(true);
      }
    });

    it('not with 2+ plates', () => {
      for (const n of [2, 3, 5]) expect(grants(8, n)).toBe(false);
    });

    it('not for regular jobs or the specials of editions 1–2', () => {
      for (const index of [2, 5]) expect(grants(index, 0), `special ${index}`).toBe(false);
      for (const index of [0, 1, 3, 4, 6, 7, 9, 10, 12])
        expect(grants(index, 0), `regular ${index}`).toBe(false);
    });
  });

  describe("'collector' — 5 plates at once", () => {
    it('grants on the plate_added that fills the 5th slot, not before', () => {
      for (let n = 1; n <= 5; n++) {
        const meta = newMeta();
        const run = withPlates(n);
        const upd = applyRunEvents(meta, run, [plateAdded(run)], 1);
        expect(upd.achievements.includes('collector'), `${n} plates`).toBe(n >= BALANCE.slots);
      }
    });

    it('also when a full rack swaps a plate (still 5)', () => {
      const meta = newMeta();
      const run = withPlates(5);
      const inst = run.plates[2] as RunState['plates'][number];
      const upd = applyRunEvents(
        meta,
        run,
        [
          { type: 'plate_sold', inst, sheets: 1, toCurrent: false },
          { type: 'plate_added', inst, slot: 2, replaced: inst },
        ],
        1,
      );
      expect(upd.achievements).toEqual(['collector']);
      expect(upd.unlocks).toEqual([]);
    });
  });

  it('reach_e3 / reach_e6 / endless fire on the job that completes edition 2 / 5 / job 30', () => {
    const meta = newMeta();
    const seen: Array<[number, AchievementId[]]> = [];
    for (let i = 0; i < 31; i++) {
      const upd = applyRunEvents(meta, withPlates(3), [won(i)], i);
      if (upd.achievements.length) seen.push([i, upd.achievements]);
    }
    expect(seen).toEqual([
      [5, ['reach_e3']],
      [14, ['reach_e6']],
      [29, ['endless']],
    ]);
  });
});

describe('unlockedPool', () => {
  it('a new player gets exactly the starter pool', () => {
    expect(new Set(unlockedPool(newMeta()))).toEqual(new Set(STARTER_MATRICES));
    expect(unlockedPool(newMeta())).toHaveLength(STARTER_MATRICES.length);
  });

  it('is starters ∪ unlocked, without duplicates', () => {
    const meta = newMeta();
    meta.unlocked = ['mirror', 'stencil'];
    const pool = unlockedPool(meta);
    expect(new Set(pool)).toEqual(new Set([...STARTER_MATRICES, 'mirror', 'stencil']));
    expect(pool).toHaveLength(STARTER_MATRICES.length + 2);
    // Even if a starter or a duplicate sneaks into `unlocked`.
    meta.unlocked = ['mirror', 'mirror', STARTER_MATRICES[0] as MatrixId];
    expect(unlockedPool(meta)).toHaveLength(STARTER_MATRICES.length + 1);
  });

  it('does not alias meta.unlocked', () => {
    const meta = newMeta();
    unlockedPool(meta).push('mirror');
    expect(meta.unlocked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('daily records (GDD §10.1)', () => {
  const record = (meta: MetaState, run: RunState, now = 1) => applyRunEvents(meta, run, [runOver()], now);

  it('a real greedy daily run records its result, grid and streak', () => {
    const date = '2026-10-07';
    const meta = newMeta();
    const { engine, events } = dailyRunEngine(date);
    playRun(meta, engine, events, 0);
    const s = engine.state;
    expect(s.phase).toBe('over');
    expect(meta.daily[date]).toEqual({
      best: s.totals.score,
      contracts: s.totals.contractsWon,
      attempts: 1,
      grid: dailyGrid(s),
    });
    expect(Array.from(dailyGrid(s))).toHaveLength(s.totals.history.length);
    expect(Array.from(dailyGrid(s)).at(-1)).toBe('⬛');
    expect(meta.stats).toMatchObject({ dailyPlayed: 1, dailyStreak: 1, lastDailyDate: date });
  });

  it('the first attempt is always recorded, even with a zero result', () => {
    const meta = newMeta();
    record(meta, dailyOver('2026-10-07', 0, 0));
    expect(meta.daily['2026-10-07']).toEqual({ best: 0, contracts: 0, attempts: 1, grid: '⬛' });
    expect(meta.stats.dailyPlayed).toBe(1);
  });

  it('keeps the best attempt: more jobs first, then higher score; attempts always count', () => {
    const d = '2026-10-07';
    const meta = newMeta();
    const r1 = dailyOver(d, 5, 3000);
    record(meta, r1);
    expect(meta.daily[d]).toEqual({ best: 3000, contracts: 5, attempts: 1, grid: dailyGrid(r1) });

    record(meta, dailyOver(d, 4, 99_999)); // fewer jobs, higher score → worse
    expect(meta.daily[d]).toEqual({ best: 3000, contracts: 5, attempts: 2, grid: dailyGrid(r1) });

    const tie = dailyOver(d, 5, 3000, [
      { index: 0, won: false, progress: 0, quota: 1, sheetsUsed: 1, dominantInk: null },
    ]);
    record(meta, tie); // identical result → not better, grid untouched
    expect(meta.daily[d]).toEqual({ best: 3000, contracts: 5, attempts: 3, grid: dailyGrid(r1) });

    const r4 = dailyOver(d, 5, 3001); // same jobs, higher score → better
    record(meta, r4);
    expect(meta.daily[d]).toEqual({ best: 3001, contracts: 5, attempts: 4, grid: dailyGrid(r4) });

    const r5 = dailyOver(d, 6, 10); // more jobs, lower score → better
    record(meta, r5);
    expect(meta.daily[d]).toEqual({ best: 10, contracts: 6, attempts: 5, grid: dailyGrid(r5) });

    // Only the first attempt of a date counts as a played daily.
    expect(meta.stats.dailyPlayed).toBe(1);
    expect(meta.stats.dailyStreak).toBe(1);
  });

  it('dailyStreak grows on consecutive UTC days (across month / year / leap-day boundaries) and resets otherwise', () => {
    const meta = newMeta();
    const steps: Array<[string, number]> = [
      ['2026-10-07', 1],
      ['2026-10-08', 2],
      ['2026-10-08', 2], // second attempt the same day: no change
      ['2026-10-09', 3],
      ['2026-10-11', 1], // skipped a day
      ['2026-10-12', 2],
      ['2026-10-31', 1],
      ['2026-11-01', 2], // month boundary
      ['2026-12-31', 1],
      ['2027-01-01', 2], // year boundary
      ['2028-02-28', 1],
      ['2028-02-29', 2], // leap day
      ['2028-03-01', 3],
      ['2029-02-28', 1],
      ['2029-03-01', 2], // non-leap February
    ];
    for (const [date, streak] of steps) {
      record(meta, dailyOver(date, 1, 100));
      expect(meta.stats.dailyStreak, date).toBe(streak);
      expect(meta.stats.lastDailyDate).toBe(date);
    }
    expect(meta.stats.dailyPlayed).toBe(new Set(steps.map(([d]) => d)).size);
  });

  it("'regular' after 3 distinct daily challenges", () => {
    const meta = newMeta();
    expect(record(meta, dailyOver('2026-01-01', 1, 1)).achievements).toEqual([]);
    expect(record(meta, dailyOver('2026-01-01', 2, 1)).achievements).toEqual([]);
    expect(record(meta, dailyOver('2026-02-11', 1, 1)).achievements).toEqual([]);
    expect(record(meta, dailyOver('2026-03-05', 1, 1)).achievements).toEqual(['regular']);
    expect(meta.achievements.regular).toBe(1);
  });

  it('standard runs and dailies without a date never touch daily records', () => {
    const meta = newMeta();
    record(meta, BASE);
    const noDate = dailyOver('2026-10-07', 3, 30);
    noDate.dailyDate = null;
    record(meta, noDate);
    expect(meta.daily).toEqual({});
    expect(meta.stats).toMatchObject({
      dailyPlayed: 0,
      dailyStreak: 0,
      lastDailyDate: null,
      completedRuns: 2,
    });
  });
});

describe('dailyGrid', () => {
  const rec = (won: boolean, dominantInk: number | null): ContractRecord => ({
    index: 0,
    won,
    progress: 0,
    quota: 0,
    sheetsUsed: 0,
    dominantInk,
  });

  it('maps won jobs to their dominant ink square, ⬜ without ink, ⬛ for a lost job', () => {
    const s = clone(DAILY_BASE);
    s.totals.history = [
      rec(true, 0),
      rec(true, 1),
      rec(true, 2),
      rec(true, 3),
      rec(true, 4),
      rec(true, null),
      rec(false, 2),
      rec(false, null),
    ];
    expect(dailyGrid(s)).toBe('🟥🟧🟨🟩🟦⬜⬛⬛');
  });

  it('matches the GDD share example and is empty without history', () => {
    const s = clone(DAILY_BASE);
    s.totals.history = [0, 1, 2, 3, 4, 0, 1, 2].map((k) => rec(true, k));
    s.totals.history.push(rec(false, 4));
    expect(dailyGrid(s)).toBe('🟥🟧🟨🟩🟦🟥🟧🟨⬛');
    s.totals.history = [];
    expect(dailyGrid(s)).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('migrateMeta', () => {
  function populated(): MetaState {
    const meta = newMeta();
    const { engine, events } = standardRun('meta-migrate');
    playRun(meta, engine, events, 0);
    for (const id of ['cross_15', 'win_run', 'regular'] as const) applyAll(meta, SCENARIOS[id](), 77);
    meta.tutorialDone = true;
    meta.freeContinueUsed = true;
    meta.tipsSeen = ['stash', 'streak'];
    return meta;
  }

  it('returns a fresh meta for null / non-object input', () => {
    for (const raw of [null, undefined, 0, 42, NaN, '', 'meta', true, [], [1, 2, 3], () => 1]) {
      expect(migrateMeta(raw)).toEqual(newMeta());
    }
  });

  it('preserves every known field of a valid meta (JSON round trip)', () => {
    const meta = populated();
    expect(Object.keys(meta.achievements).length).toBeGreaterThan(3);
    expect(meta.unlocked.length).toBeGreaterThan(0);
    expect(Object.keys(meta.daily).length).toBeGreaterThan(0);
    expect(Object.keys(meta.stats.picks).length).toBeGreaterThan(0);
    expect(migrateMeta(clone(meta))).toEqual(meta);
  });

  it('fills missing fields of partial / older objects with defaults', () => {
    const m = migrateMeta({ v: 0, stats: { runs: 5, bestScore: 1234 }, achievements: { first_print: 9 } });
    const expected = newMeta();
    expected.stats.runs = 5;
    expected.stats.bestScore = 1234;
    expected.achievements.first_print = 9;
    expect(m).toEqual(expected);
    expect(m.v).toBe(META_VERSION);
    expect(migrateMeta({})).toEqual(newMeta());
    expect(
      migrateMeta({ stats: null, achievements: null, unlocked: null, daily: null, tipsSeen: null }),
    ).toEqual(newMeta());
  });

  it('drops unknown plate ids (unlocked, picks)', () => {
    const m = migrateMeta({
      unlocked: ['crossmark', 'bogus_plate', 42, null, { id: 'mirror' }, 'mirror'],
      stats: { picks: { proof: 3, bogus_plate: 9, ink_pink: 1 } },
    });
    expect(m.unlocked).toEqual(['crossmark', 'mirror']);
    expect(m.stats.picks).toEqual({ proof: 3, ink_pink: 1 });
  });

  it('never keeps starters or duplicates in `unlocked`', () => {
    const m = migrateMeta({ unlocked: ['proof', 'crossmark', 'crossmark', 'gutenberg'] });
    expect(m.unlocked).toEqual(['crossmark']);
  });

  it('keeps the plate of an earned achievement unlocked (grant never re-awards it)', () => {
    const m = migrateMeta({ achievements: { cross_15: 5, reach_e6: 6 }, unlocked: [] });
    expect(new Set(m.unlocked)).toEqual(new Set(['crossmark', 'mirror']));
    const upd = applyAll(m, SCENARIOS.cross_15(), 7);
    expect(upd.achievements).toEqual(['first_print']); // cross_15 was already earned
    expect(upd.unlocks).toEqual([]);
    expect(m.achievements.cross_15).toBe(5);
  });

  it('sanitises garbage stats', () => {
    expect(migrateMeta({ stats: 'abc' })).toEqual(newMeta());
    expect(migrateMeta({ stats: [1, 2] })).toEqual(newMeta());
    const m = migrateMeta({
      stats: {
        runs: 'x',
        wins: -3,
        bestScore: Infinity,
        totalScore: NaN,
        maxStreak: null,
        crosses: 4,
        picks: 'abc',
        lastDailyDate: 42,
        junk: 1,
      },
    });
    const expected = newMeta();
    expected.stats.crosses = 4;
    expect(m).toEqual(expected);
    expect(migrateMeta({ stats: { lastDailyDate: 'yesterday' } }).stats.lastDailyDate).toBeNull();
    expect(migrateMeta({ stats: { lastDailyDate: '2026-10-07' } }).stats.lastDailyDate).toBe('2026-10-07');
    expect(migrateMeta({ stats: { picks: { proof: 'x', petit: -1, poster: 2 } } }).stats.picks).toEqual({
      poster: 2,
    });
  });

  it('drops unknown achievements and non-timestamp values', () => {
    const m = migrateMeta({
      achievements: { first_print: 123, bogus: 5, quad: 'x', win_run: null, millionaire: 0 },
    });
    expect(m.achievements).toEqual({ first_print: 123, millionaire: 0 });
    expect(migrateMeta({ achievements: 'abc' }).achievements).toEqual({});
  });

  it('sanitises daily records so recording a daily never throws', () => {
    const m = migrateMeta({
      daily: {
        '2026-10-07': { best: 10, contracts: 2, attempts: 1, grid: '🟥⬛' },
        '2026-10-08': 'garbage',
        '2026-10-09': null,
        '2026-10-10': { best: 'x', contracts: -1, grid: 5 },
        'not-a-date': { best: 1, contracts: 1, attempts: 1, grid: '' },
      },
    });
    expect(Object.keys(m.daily).sort()).toEqual(['2026-10-07', '2026-10-10']);
    expect(m.daily['2026-10-07']).toEqual({ best: 10, contracts: 2, attempts: 1, grid: '🟥⬛' });
    expect(m.daily['2026-10-10']).toEqual({ best: 0, contracts: 0, attempts: 0, grid: '' });
    for (const d of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']) {
      expect(() => applyRunEvents(m, dailyOver(d, 3, 300), [runOver()], 1)).not.toThrow();
      expect(m.daily[d]?.contracts).toBe(3);
    }
    expect(m.daily['2026-10-07']?.attempts).toBe(2);
    expect(migrateMeta({ daily: 'abc' }).daily).toEqual({});
  });

  it('filters tipsSeen and normalises the flags', () => {
    expect(migrateMeta({ tipsSeen: ['a', 1, null, 'b'] }).tipsSeen).toEqual(['a', 'b']);
    expect(migrateMeta({ tipsSeen: 'abc' }).tipsSeen).toEqual([]);
    const m = migrateMeta({ tutorialDone: true, freeContinueUsed: true });
    expect(m.tutorialDone).toBe(true);
    expect(m.freeContinueUsed).toBe(true);
    expect(migrateMeta({ tutorialDone: false }).tutorialDone).toBe(false);
  });

  it('drops unknown top-level fields and is immune to __proto__ keys', () => {
    const m = migrateMeta({ foo: 1, bar: { baz: 2 } });
    expect(Object.keys(m).sort()).toEqual(Object.keys(newMeta()).sort());
    const evil = migrateMeta(
      JSON.parse(
        '{"daily":{"__proto__":{"best":1}},"achievements":{"__proto__":1},"stats":{"picks":{"__proto__":5},"__proto__":{"runs":9}}}',
      ),
    );
    expect(evil).toEqual(newMeta());
    expect(Object.getPrototypeOf(evil.daily)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(evil.stats.picks)).toBe(Object.prototype);
  });

  it('does not alias the input', () => {
    const raw = clone(populated());
    const snapshot = clone(raw);
    const m = migrateMeta(raw);
    m.stats.picks.proof = 999;
    m.achievements.quad = 1;
    m.unlocked.push('stencil');
    for (const r of Object.values(m.daily)) r.attempts = 99;
    m.tipsSeen.push('x');
    expect(raw).toEqual(snapshot);
  });

  it('a migrated meta keeps working with applyRunEvents', () => {
    const m = migrateMeta({
      stats: { runs: 'garbage', totalScore: 999_990 },
      unlocked: ['bogus'],
      daily: { '2026-10-07': 7 },
    });
    const { engine, events } = standardRun('meta-after-migrate');
    playRun(m, engine, events, 0);
    expect(m.stats.runs).toBe(1);
    expect(m.stats.totalScore).toBe(999_990 + engine.state.totals.score);
    expect(m.achievements.millionaire).toBeDefined();
  });
});
