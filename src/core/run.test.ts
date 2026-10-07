/**
 * Run engine (GDD §3.3, §5.3, §6, §7, §9, §18.4) driven through its public API.
 *
 * Boards and trays are random, so exact scenarios are set up by restoring a modified
 * snapshot (`craft`) and then acting through the real API. A greedy autoplayer drives
 * whole runs for the determinism and flow tests. Every random choice in this file comes
 * from fixed seeds (engine seeds or `Rng.derive('script', …)`), never Math.random.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from './config/balance';
import { EMPTY, JAM, LEAD, idx, newCells, type Cells } from './board';
import { editionModifiers, quotaFor, totalContracts, type Modifier } from './contracts';
import {
  MATRIX_IDS,
  createInstance,
  matrixDef,
  sellValue,
  type MatrixId,
  type MatrixInstance,
} from './matrices';
import { BOARD_SIZE, shapeById } from './pieces';
import { Rng } from './rng';
import {
  RUN_STATE_VERSION,
  RunEngine,
  RunError,
  type OfferState,
  type RunEvent,
  type RunOptions,
  type RunState,
  type SlotRef,
  type TrayPiece,
} from './run';

// ---------------------------------------------------------------------------
// Helpers

const SEED = 'run-test-seed';

function start(opts: Partial<RunOptions> = {}): RunEngine {
  return RunEngine.create({ seed: SEED, ...opts }).engine;
}

/** Restores a modified snapshot: the way to set up exact scenarios. */
function craft(e: RunEngine, fn: (s: RunState) => void): RunEngine {
  const s = e.snapshot();
  fn(s);
  return RunEngine.restore(s);
}

function tp(s: RunState, shape: string, ink = 0): TrayPiece {
  return { uid: s.nextUid++, shape, ink };
}

function setTray(s: RunState, shapes: ReadonlyArray<string | null>, ink = 0): void {
  s.tray = [null, null, null];
  shapes.forEach((sh, i) => {
    s.tray[i] = sh === null ? null : tp(s, sh, ink);
  });
}

function setPlates(s: RunState, ids: readonly MatrixId[]): MatrixInstance[] {
  s.plates = ids.map((id) => createInstance(id, s.nextUid++));
  return s.plates;
}

function fillRow(cells: Cells, y: number, except: readonly number[] = [], v = 0): void {
  for (let x = 0; x < BOARD_SIZE; x++) if (!except.includes(x)) cells[idx(x, y)] = v;
}

function fillCol(cells: Cells, x: number, except: readonly number[] = [], v = 0): void {
  for (let y = 0; y < BOARD_SIZE; y++) if (!except.includes(y)) cells[idx(x, y)] = v;
}

/** (x + y) even = filled: no full line, no 2-cell piece fits, every dot fits. */
function checkerboard(v = 0): Cells {
  const cells = newCells();
  for (let y = 0; y < BOARD_SIZE; y++)
    for (let x = 0; x < BOARD_SIZE; x++) if ((x + y) % 2 === 0) cells[idx(x, y)] = v;
  return cells;
}

type Ev<T extends RunEvent['type']> = Extract<RunEvent, { type: T }>;

function evs<T extends RunEvent['type']>(events: readonly RunEvent[], type: T): Array<Ev<T>> {
  return events.filter((e): e is Ev<T> => e.type === type);
}

function ev<T extends RunEvent['type']>(events: readonly RunEvent[], type: T): Ev<T> {
  const found = evs(events, type);
  expect(found, `expected one '${type}' event`).toHaveLength(1);
  return found[0] as Ev<T>;
}

function types(events: readonly RunEvent[]): string[] {
  return events.map((e) => e.type);
}

function plateUid(e: RunEngine, id: MatrixId): number {
  const p = e.state.plates.find((q) => q.id === id);
  if (!p) throw new Error(`no plate ${id}`);
  return p.uid;
}

/** Expects a RunError and that the failed action left the state untouched. */
function expectRejected(e: RunEngine, action: () => unknown): void {
  const before = e.snapshot();
  expect(action).toThrow(RunError);
  expect(e.snapshot()).toEqual(before);
}

/** First tray placement that prints nothing. */
function dryMove(e: RunEngine): [SlotRef, number, number] {
  for (const slot of [0, 1, 2] as const) {
    for (const [x, y] of e.validPositions(slot)) {
      const l = e.previewLines(slot, x, y);
      if (l && l.rows.length + l.cols.length === 0) return [slot, x, y];
    }
  }
  throw new Error('no dry move');
}

function placeDry(e: RunEngine): RunEvent[] {
  const [slot, x, y] = dryMove(e);
  return e.place(slot, x, y);
}

/** Greedy autoplayer move: most lines, then most contact with walls / filled cells. */
function bestMove(e: RunEngine): [SlotRef, number, number] | null {
  let best: [SlotRef, number, number] | null = null;
  let bestScore = -Infinity;
  for (const slot of [0, 1, 2, 'reserve'] as SlotRef[]) {
    const p = e.pieceAt(slot);
    if (!p) continue;
    const shape = shapeById(p.shape);
    for (const [x, y] of e.validPositions(slot)) {
      if (!e.canPlace(slot, x, y)) continue;
      const l = e.previewLines(slot, x, y);
      if (!l) continue;
      const own = new Set(shape.cells.map(([cx, cy]) => idx(x + cx, y + cy)));
      let contact = 0;
      for (const [cx, cy] of shape.cells) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + cx + dx;
          const ny = y + cy + dy;
          if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) contact++;
          else if (!own.has(idx(nx, ny)) && e.state.cells[idx(nx, ny)] !== EMPTY) contact++;
        }
      }
      const score = (l.rows.length + l.cols.length) * 100 + contact - (slot === 'reserve' ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = [slot, x, y];
      }
    }
  }
  return best;
}

/** One scripted action; choices depend only on (state, step) so replays are identical. */
function scriptStep(e: RunEngine, step: number): RunEvent[] {
  const r = Rng.derive('script', step);
  const s = e.state;
  switch (s.phase) {
    case 'playing': {
      if (e.reserveSlots() > 0 && r.chance(0.25)) {
        const slot = s.tray.findIndex((p) => p !== null);
        if (slot >= 0 && e.canStash(slot)) return e.stash(slot);
      }
      if (s.plates.length > 1 && r.chance(0.03)) return e.movePlate(0, s.plates.length - 1);
      const mv = bestMove(e);
      if (!mv) throw new Error('playing without a legal move');
      return e.place(...mv);
    }
    case 'offer': {
      const offer = s.offer as OfferState;
      if (e.canReroll('free') && r.chance(0.5)) return e.reroll('free');
      if (e.canReroll('ad') && r.chance(0.5)) return e.reroll('ad');
      if (s.plates.length > 0 && r.chance(0.1)) return e.sell((s.plates[0] as MatrixInstance).uid);
      if (offer.cards.length === 0 || r.chance(0.15)) return e.skipOffer();
      const card = r.int(offer.cards.length);
      const replace =
        s.plates.length >= BALANCE.slots
          ? (s.plates[r.int(s.plates.length)] as MatrixInstance).uid
          : undefined;
      return e.takeOffer(card, replace);
    }
    case 'last_chance': {
      const p = e.sellablePlates()[0];
      return p && r.chance(0.8) ? e.sell(p.uid) : e.acceptLoss();
    }
    case 'lost':
      return e.canContinue() ? e.continueRun() : e.endRun();
    case 'victory':
      return e.continueEndless();
    case 'over':
      return [];
  }
}

function runScript(e: RunEngine, steps: number, from = 0): string[] {
  const log: string[] = [];
  for (let k = from; k < from + steps && e.state.phase !== 'over'; k++)
    log.push(JSON.stringify(scriptStep(e, k)));
  return log;
}

/** Sets up an exactly winnable placement: progress quota−1 and a dot that completes row 7. */
function primeWin(s: RunState, sheetsUsedBefore = 0): void {
  s.cells = newCells();
  fillRow(s.cells, 7, [7]);
  setTray(s, ['dot', null, null]);
  s.contract.progress = s.contract.spec.quota - 1;
  s.contract.sheetsUsed = sheetsUsedBefore;
  s.contract.sheetsLeft = Math.max(s.contract.sheetsLeft, 1);
}

/** Raises the quota so that test prints never end the contract. */
function bigQuota(s: RunState): void {
  s.contract.spec.quota = 1_000_000_000;
}

function forceWin(e: RunEngine, sheetsUsedBefore = 0): { engine: RunEngine; events: RunEvent[] } {
  const engine = craft(e, (s) => primeWin(s, sheetsUsedBefore));
  const events = engine.place(0, 7, 7);
  return { engine, events };
}

/** Wins and skips contracts until `index` is the current contract. */
function advanceTo(e: RunEngine, index: number): RunEngine {
  let cur = e;
  while (cur.state.contractIndex < index) {
    cur = forceWin(cur).engine;
    expect(cur.state.phase).toBe('offer');
    cur.skipOffer();
  }
  return cur;
}

/** State sitting on an offer after contract `contractIndex`, with the given rack. */
function atOffer(
  opts: {
    contractIndex?: number;
    plates?: readonly MatrixId[];
    mods?: Record<string, Modifier[]>;
    seed?: string;
    mode?: RunOptions['mode'];
    carryStreak?: number;
  } = {},
): RunEngine {
  const base = RunEngine.create({ seed: opts.seed ?? SEED, mode: opts.mode ?? 'standard' }).engine;
  return craft(base, (s) => {
    s.phase = 'offer';
    s.contractIndex = opts.contractIndex ?? 0;
    s.tray = [null, null, null];
    setPlates(s, opts.plates ?? []);
    if (opts.mods) Object.assign(s.editionModifiers, opts.mods);
    s.carryStreak = opts.carryStreak ?? 0;
    s.offer = {
      index: s.contractIndex,
      cards: ['guillotine', 'roller', 'margins'],
      cardCount: 3,
      guaranteeRare: false,
      rerolls: 0,
      adRerollsHere: 0,
    };
  });
}

const isInkPlate = (id: MatrixId): boolean => matrixDef(id).inkAffinity !== undefined;
const COMMONS = MATRIX_IDS.filter((id) => matrixDef(id).rarity === 'common');
const RARES = MATRIX_IDS.filter((id) => matrixDef(id).rarity === 'rare');

// ---------------------------------------------------------------------------

describe('creation and queries', () => {
  it('starts contract 1 with 20 sheets, an empty forme and a full tray', () => {
    const { engine, events } = RunEngine.create({ seed: SEED });
    expect(types(events)).toEqual(['contract_started', 'dealt']);
    const started = ev(events, 'contract_started');
    expect(started.sheets).toBe(BALANCE.baseSheets);
    expect(started.disabledUid).toBeNull();
    const s = engine.state;
    expect(s.v).toBe(RUN_STATE_VERSION);
    expect(s.phase).toBe('playing');
    expect(s.contractIndex).toBe(0);
    expect(s.contract.sheetsLeft).toBe(20);
    expect(s.contract.spec.quota).toBe(quotaFor(0, []));
    expect(s.cells.every((v) => v === EMPTY)).toBe(true);
    expect(s.tray.filter((p) => p !== null)).toHaveLength(3);
    expect(ev(events, 'dealt').pieces).toEqual(s.tray);
    expect(s.freeRerolls).toBe(1);
    expect(s.plates).toEqual([]);
  });

  it('installs start plates (daily rule) and gives them distinct uids', () => {
    const e = start({ mode: 'daily', dailyDate: '2026-10-07', startPlates: ['proof', 'ink_pink'] });
    expect(e.state.plates.map((p) => p.id)).toEqual(['proof', 'ink_pink']);
    expect(new Set(e.state.plates.map((p) => p.uid)).size).toBe(2);
    expect(e.state.mode).toBe('daily');
    expect(e.state.dailyDate).toBe('2026-10-07');
    expect(e.inkWeights()).toEqual([2, 1, 1, 1, 1]);
  });

  it('edition modifiers use the ink weights of the whole rack', () => {
    const e = start({ startPlates: ['ink_teal'] });
    expect(e.upcomingSpecial()).toEqual(editionModifiers(SEED, 1, [1, 1, 1, 2, 1]));
    expect(e.state.editionModifiers['1']).toEqual(e.upcomingSpecial());
  });

  /** A seed whose edition 4 has "out of ink" with a colour that depends on the ink weights. */
  const outOfInkSeed = (): string => {
    for (let k = 0; k < 500; k++) {
      const cand = `ooi-${k}`;
      const flat = editionModifiers(cand, 4, [1, 1, 1, 1, 1]).find((m) => m.id === 'out_of_ink');
      const pink = editionModifiers(cand, 4, [2, 1, 1, 1, 1]).find((m) => m.id === 'out_of_ink');
      if (flat && pink && flat.ink !== pink.ink) return cand;
    }
    throw new Error('no seed found');
  };

  it('a plate failed in the previous special job still counts for the next edition’s out-of-ink colour', () => {
    const seed = outOfInkSeed();
    const expected = editionModifiers(seed, 4, [2, 1, 1, 1, 1]);
    // Offer after contract 9 (edition 3 special) in which Fluo Pink was failed.
    const e = craft(atOffer({ seed, contractIndex: 8, plates: ['ink_pink'] }), (s) => {
      s.contract.disabledUid = (s.plates[0] as MatrixInstance).uid;
    });
    e.skipOffer();
    expect(e.state.contractIndex).toBe(9);
    expect(e.state.editionModifiers['4']).toEqual(expected);
    expect(e.inkWeights()).toEqual([2, 1, 1, 1, 1]);
  });

  it('specialFor reveals the next special during the offer and fixes it', () => {
    const seed = outOfInkSeed();
    const e = craft(atOffer({ seed, contractIndex: 8, plates: ['ink_pink'] }), (s) => {
      s.contract.disabledUid = (s.plates[0] as MatrixInstance).uid;
      (s.offer as OfferState).cards = ['ink_blue', 'proof', 'roller'];
    });
    const revealed = e.specialFor(4);
    expect(revealed).toEqual(editionModifiers(seed, 4, [2, 1, 1, 1, 1]));
    // Taking an ink plate afterwards does not change what was shown.
    e.takeOffer(0);
    expect(e.inkWeights()).toEqual([2, 1, 1, 1, 2]);
    expect(e.state.editionModifiers['4']).toEqual(revealed);
    expect(e.upcomingSpecial()).toEqual(revealed);
  });

  it('the plate pool is frozen at run start', () => {
    const pool: MatrixId[] = ['proof', 'roller', 'journeyman'];
    const e = start({ pool });
    pool.push('gutenberg');
    expect(e.state.pool).toEqual(['proof', 'roller', 'journeyman']);
    expect(start().state.pool).toEqual([...MATRIX_IDS]);
  });

  it('canPlace / validPositions / previewLines agree with place()', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      fillRow(s.cells, 2, [3]);
      setTray(s, ['dot', 'i3v', 'o9']);
    });
    expect(e.canPlace(0, 3, 2)).toBe(true);
    expect(e.canPlace(0, 0, 2)).toBe(false); // occupied
    expect(e.canPlace(0, 8, 0)).toBe(false); // out of bounds
    expect(e.canPlace(2, 6, 0)).toBe(false); // 3×3 sticks out
    expect(e.canPlace('reserve', 0, 0)).toBe(false); // no type case
    expect(e.validPositions(0)).toHaveLength(64 - 7);
    for (const [x, y] of e.validPositions(2)) expect(e.canPlace(2, x, y)).toBe(true);
    expect(e.previewLines(0, 3, 2)).toEqual({ rows: [2], cols: [] });
    expect(e.previewLines(0, 0, 2)).toBeNull();
    const printed = ev(e.place(0, 3, 2), 'printed');
    expect(printed.lines).toEqual({ rows: [2], cols: [] });
    expect(e.state.cells.every((v) => v === EMPTY)).toBe(true);
  });

  it('hasReserve / reserveSlots / sellablePlates / inkWeights', () => {
    const e = craft(start(), (s) => setPlates(s, ['ream', 'type_case', 'ink_blue', 'gutenberg']));
    expect(e.hasReserve()).toBe(true);
    expect(e.reserveSlots()).toBe(1);
    expect(e.sellablePlates().map((p) => p.id)).toEqual(['type_case', 'ink_blue', 'gutenberg']);
    expect(e.inkWeights()).toEqual([1, 1, 1, 1, 2]);
    expect(e.streakGrace()).toBe(BALANCE.streakGrace);
    expect(start().hasReserve()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('SERIA counted in lines (GDD §5.3)', () => {
  /** Empty board, row 7 x1..7 (ink 1) and column 0 y0..6 (ink 2): a dot at (0,7) prints 2 lines. */
  const doubleSetup = (s: RunState) => {
    bigQuota(s);
    s.cells = newCells();
    fillRow(s.cells, 7, [0], 1);
    fillCol(s.cells, 0, [7], 2);
    setTray(s, ['dot', 'dot', null]);
  };

  it('streak += number of lines printed, before scoring', () => {
    const e = craft(start(), doubleSetup);
    const events = e.place(0, 0, 7);
    const printed = ev(events, 'printed');
    expect(printed.streak).toBe(2);
    expect(printed.result.ctx.streak).toBe(2);
    // MULT = L + max(0, SERIA − 1) + 2·mono = 2 + 1 + 0; PRINTS = 16 cells × 10
    expect(printed.result.mult).toBe(3);
    expect(printed.result.prints).toBe(160);
    expect(printed.result.total).toBe(480);
    expect(ev(events, 'streak')).toEqual({ type: 'streak', streak: 2, dry: 0, grace: 3, broken: false });
    expect(e.state.contract.streak).toBe(2);
    expect(e.state.totals.maxStreak).toBe(2);
    expect(e.state.totals.lines).toBe(2);
    expect(e.state.totals.maxLines).toBe(2);

    // A single line on top: 2 + 1 = 3.
    const e2 = craft(e, (s) => {
      fillRow(s.cells, 4, [5], 3);
      setTray(s, ['dot']);
    });
    const p2 = ev(e2.place(0, 5, 4), 'printed');
    expect(p2.streak).toBe(3);
    expect(p2.result.mult).toBe(1 + 2 + 0);
    expect(e2.state.totals.maxStreak).toBe(3);
  });

  it('survives exactly 3 dry placements; the 4th breaks it', () => {
    let e = craft(start(), (s) => {
      s.cells = newCells();
      setTray(s, ['dot', 'dot', 'dot']);
      s.contract.streak = 4;
    });
    for (let k = 1; k <= 3; k++) {
      const st = ev(e.place(k - 1, 2 * k, 0), 'streak');
      expect(st).toEqual({ type: 'streak', streak: 4, dry: k, grace: 3, broken: false });
    }
    expect(e.state.contract.streak).toBe(4);
    expect(e.state.contract.dry).toBe(3);
    // The tray emptied → a fresh tray was dealt; the 4th dry placement breaks the streak.
    const st4 = ev(placeDry(e), 'streak');
    expect(st4).toEqual({ type: 'streak', streak: 0, dry: 0, grace: 3, broken: true });
    expect(e.state.contract.streak).toBe(0);
    // Further dry placements at streak 0 do nothing.
    e = craft(e, (s) => setTray(s, ['dot']));
    expect(ev(placeDry(e), 'streak')).toEqual({ type: 'streak', streak: 0, dry: 0, grace: 3, broken: false });
  });

  it('a print refills the drops (dry counter resets)', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      fillRow(s.cells, 7, [7]);
      setTray(s, ['dot', 'dot', 'dot']);
      s.contract.streak = 2;
      bigQuota(s);
    });
    e.place(0, 0, 0);
    e.place(1, 2, 0);
    expect(e.state.contract.dry).toBe(2);
    const printed = ev(e.place(2, 7, 7), 'printed');
    expect(printed.streak).toBe(3);
    expect(e.state.contract.dry).toBe(0);
    for (let k = 1; k <= 3; k++) expect(ev(placeDry(e), 'streak').dry).toBe(k);
    expect(e.state.contract.streak).toBe(3);
    expect(ev(placeDry(e), 'streak').broken).toBe(true);
  });

  it('Conveyor adds one dry placement of grace (4 survive, 5th breaks)', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      setPlates(s, ['conveyor']);
      setTray(s, ['dot', 'dot', 'dot']);
      s.contract.streak = 6;
    });
    expect(e.streakGrace()).toBe(4);
    for (let k = 1; k <= 4; k++) {
      const st = ev(placeDry(e), 'streak');
      expect(st).toMatchObject({ streak: 6, dry: k, grace: 4, broken: false });
    }
    expect(ev(placeDry(e), 'streak')).toMatchObject({ streak: 0, dry: 0, grace: 4, broken: true });
  });

  it('a disabled Conveyor gives no grace', () => {
    const e = craft(start(), (s) => {
      const [conv] = setPlates(s, ['conveyor']);
      s.contract.disabledUid = (conv as MatrixInstance).uid;
    });
    expect(e.streakGrace()).toBe(3);
  });

  it('wet ink keeps SERIA at 0 and plates read 0', () => {
    const e = craft(start(), (s) => {
      doubleSetup(s);
      s.contract.spec.modifiers = [{ id: 'wet_ink' }];
      setPlates(s, ['numerator']);
    });
    const events = e.place(0, 0, 7);
    const printed = ev(events, 'printed');
    expect(printed.streak).toBe(0);
    expect(printed.result.ctx.streak).toBe(0);
    // MULT = 2 lines + 0 streak + 0 mono; Numerator (+1 per streak level) adds nothing.
    expect(printed.result.mult).toBe(2);
    expect(e.state.contract.streak).toBe(0);
    expect(e.state.totals.maxStreak).toBe(0);
    for (let k = 0; k < 5; k++)
      expect(ev(placeDry(e), 'streak')).toMatchObject({ streak: 0, dry: 0, broken: false });
  });

  it('SERIA resets at contract start without Conveyor', () => {
    const won = craft(start(), (s) => {
      primeWin(s);
      s.contract.streak = 9;
    });
    won.place(0, 7, 7);
    expect(won.state.carryStreak).toBe(10);
    won.skipOffer();
    expect(won.state.contractIndex).toBe(1);
    expect(won.state.contract.streak).toBe(0);
    expect(won.state.contract.dry).toBe(0);
    expect(won.state.carryStreak).toBe(0);
  });

  it('Conveyor carries 50% (floored) of SERIA into the next contract', () => {
    const won = craft(start(), (s) => {
      primeWin(s);
      setPlates(s, ['conveyor']);
      s.contract.streak = 6;
    });
    expect(ev(won.place(0, 7, 7), 'printed').streak).toBe(7);
    won.skipOffer();
    expect(won.state.contract.streak).toBe(3); // ⌊7 × 0.5⌋
    // The carried streak counts in the first print of the new contract.
    const e = craft(won, (s) => {
      s.cells = newCells();
      fillRow(s.cells, 0, [0], 1);
      setTray(s, ['dot']);
    });
    expect(ev(e.place(0, 0, 0), 'printed').streak).toBe(4);
  });

  it('Conveyor sold during the offer carries nothing', () => {
    const won = craft(start(), (s) => {
      primeWin(s);
      setPlates(s, ['conveyor']);
      s.contract.streak = 6;
    });
    won.place(0, 7, 7);
    won.sell(plateUid(won, 'conveyor'));
    won.skipOffer();
    expect(won.state.contract.streak).toBe(0);
  });

  it('wet ink in the next contract cancels the Conveyor carry', () => {
    const wet = atOffer({
      contractIndex: 1,
      plates: ['conveyor'],
      mods: { '1': [{ id: 'wet_ink' }] },
      carryStreak: 10,
    });
    wet.skipOffer();
    expect(wet.state.contract.spec.modifiers).toEqual([{ id: 'wet_ink' }]);
    expect(wet.state.contract.streak).toBe(0);
    const dry = atOffer({
      contractIndex: 1,
      plates: ['conveyor'],
      mods: { '1': [{ id: 'big_format' }] },
      carryStreak: 10,
    });
    dry.skipOffer();
    expect(dry.state.contract.streak).toBe(5);
  });
});

// ---------------------------------------------------------------------------

describe('winning a contract (GDD §6.1, §6.3)', () => {
  it('ends immediately at progress ≥ quota: tray cleared, offer opened, reserve kept', () => {
    const e = craft(start(), (s) => {
      primeWin(s);
      setTray(s, ['dot', 'o4', 'i3h']);
      setPlates(s, ['type_case']);
      s.reserve = tp(s, 'i2h');
    });
    const reserve = e.state.reserve;
    const events = e.place(0, 7, 7);
    expect(types(events)).toEqual(['placed', 'printed', 'streak', 'contract_won', 'offer']);
    const won = ev(events, 'contract_won');
    expect(won.index).toBe(0);
    expect(won.quota).toBe(e.state.contract.spec.quota);
    expect(won.progress).toBeGreaterThanOrEqual(won.quota);
    expect(e.state.phase).toBe('offer');
    expect(e.state.tray).toEqual([null, null, null]);
    expect(e.state.reserve).toEqual(reserve);
    expect(e.state.totals.contractsWon).toBe(1);
    expect(e.state.totals.history).toEqual([
      { index: 0, won: true, progress: won.progress, quota: won.quota, sheetsUsed: 1, dominantInk: 0 },
    ]);
    expect(ev(events, 'offer').offer).toEqual(e.state.offer);
    expect(() => e.place(1, 0, 0)).toThrow(RunError);
  });

  it('reaching the quota exactly wins; one short does not', () => {
    // No plates, streak 0: a single mono line scores 80 × (1 + 0 + 2) = 240.
    const exact = craft(start(), (s) => {
      primeWin(s);
      setTray(s, ['dot', 'dot']);
      s.contract.progress = s.contract.spec.quota - 240;
    });
    const evE = exact.place(0, 7, 7);
    expect(ev(evE, 'printed').result.total).toBe(240);
    expect(exact.state.phase).toBe('offer');

    const short = craft(start(), (s) => {
      primeWin(s);
      setTray(s, ['dot', 'dot']);
      s.contract.progress = s.contract.spec.quota - 241;
    });
    short.place(0, 7, 7);
    expect(short.state.phase).toBe('playing');
    expect(short.state.contract.progress).toBe(short.state.contract.spec.quota - 1);
  });

  it('winning on the last sheet wins (quota is checked before sheets)', () => {
    const e = craft(start(), (s) => {
      primeWin(s);
      s.contract.sheetsLeft = 1;
    });
    e.place(0, 7, 7);
    expect(e.state.phase).toBe('offer');
  });

  it('afterContract growth: Journeyman +1, Gutenberg +0.25; a disabled plate does not grow', () => {
    const e = craft(start(), (s) => {
      primeWin(s);
      setPlates(s, ['journeyman', 'gutenberg', 'archive']);
    });
    e.place(0, 7, 7);
    const [jm, gb, ar] = e.state.plates as [MatrixInstance, MatrixInstance, MatrixInstance];
    expect(jm.state.mult).toBe(2);
    expect(gb.state.x).toBe(1.75);
    expect(ar.state.bonus).toBe(1); // afterPrint growth: +1 per printed line

    const d = craft(start(), (s) => {
      primeWin(s);
      const [j, g] = setPlates(s, ['journeyman', 'gutenberg']);
      s.contract.disabledUid = (j as MatrixInstance).uid;
      void g;
    });
    d.place(0, 7, 7);
    expect((d.state.plates[0] as MatrixInstance).state.mult).toBe(1);
    expect((d.state.plates[1] as MatrixInstance).state.x).toBe(1.75);
  });

  const bonus = (sheetsUsedAfter: number, specSheets = 20, extra?: (s: RunState) => void) => {
    const e = craft(start(), (s) => {
      primeWin(s, sheetsUsedAfter - 1);
      s.contract.spec.sheets = specSheets;
      extra?.(s);
    });
    const won = ev(e.place(0, 7, 7), 'contract_won');
    return { won, offer: e.state.offer as OfferState };
  };

  it('early bonus: ≤ 60% of base sheets → 4 cards; ≤ 40% → rare guaranteed', () => {
    const table: Array<[number, number, number, boolean]> = [
      // [used, base, cards, guaranteeRare]
      [1, 20, 4, true],
      [8, 20, 4, true],
      [9, 20, 4, false],
      [12, 20, 4, false],
      [13, 20, 3, false],
      [20, 20, 3, false],
      [5, 14, 4, true],
      [6, 14, 4, false],
      [8, 14, 4, false],
      [9, 14, 3, false],
    ];
    for (const [used, base, cards, rare] of table) {
      const { won, offer } = bonus(used, base);
      expect([used, base, won.cards, won.guaranteeRare], `${used}/${base}`).toEqual([
        used,
        base,
        cards,
        rare,
      ]);
      expect(won.sheetsUsed).toBe(used);
      expect(offer.cardCount).toBe(cards);
      expect(offer.guaranteeRare).toBe(rare);
      expect(offer.cards).toHaveLength(cards);
    }
  });

  it('bonus sheets (Ream / skip / sales / reprint) do not count towards the share', () => {
    // 13 used of 20 base = 65% → 3 cards, even with 26 sheets granted (13/26 = 50%).
    const { won } = bonus(13, 20, (s) => {
      setPlates(s, ['ream']);
      s.contract.sheetsGranted = 26;
      s.contract.sheetsLeft = 13;
    });
    expect(won.cards).toBe(3);
    // 8 used of 20 → rare guaranteed regardless of granted sheets.
    expect(bonus(8, 20, (s) => (s.contract.sheetsGranted = 40)).won.guaranteeRare).toBe(true);
  });

  it('a guaranteed offer always contains a rare or legendary card', () => {
    for (let k = 0; k < 40; k++) {
      const e = craft(start(), (s) => {
        s.seed = `guar-${k}`;
        primeWin(s, 2);
      });
      e.place(0, 7, 7);
      const offer = e.state.offer as OfferState;
      expect(offer.guaranteeRare).toBe(true);
      expect(offer.cards.some((id) => matrixDef(id).rarity !== 'common')).toBe(true);
    }
  });

  it('real path: 26 sheets granted (Ream + skip) still measure against 20 base sheets', () => {
    const contract1 = () => {
      const e = atOffer({ plates: ['ream'] });
      e.skipOffer();
      expect(e.state.contract.sheetsGranted).toBe(26);
      return e;
    };
    const win = (usedBefore: number) => {
      const e = craft(contract1(), (s) => {
        const left = s.contract.sheetsLeft - usedBefore;
        primeWin(s, usedBefore);
        s.contract.sheetsLeft = left;
      });
      return ev(e.place(0, 7, 7), 'contract_won');
    };
    expect(win(11)).toMatchObject({ sheetsUsed: 12, cards: 4, guaranteeRare: false });
    expect(win(12)).toMatchObject({ sheetsUsed: 13, cards: 3, guaranteeRare: false }); // 13/26 = 50% would be ≤ 60%
    expect(win(8)).toMatchObject({ sheetsUsed: 9, cards: 4, guaranteeRare: false }); // 9/26 ≈ 35% would be ≤ 40%
  });
});

// ---------------------------------------------------------------------------

describe('sheets (GDD §6.3, §8.2 Ream, §9.2 sales)', () => {
  it('sheets = base + enabled plates’ sheets + pending sheets', () => {
    const e = atOffer({ plates: ['ream', 'proof'] });
    const events = e.skipOffer();
    expect(ev(events, 'offer_skipped').sheets).toBe(BALANCE.skipSheets);
    expect(ev(events, 'contract_started').sheets).toBe(20 + 3 + 3);
    expect(e.state.contract.sheetsLeft).toBe(26);
    expect(e.state.contract.sheetsGranted).toBe(26);
    expect(e.state.pendingSheets).toBe(0);

    const t = atOffer({ plates: ['ream'] });
    expect(ev(t.takeOffer(0), 'contract_started').sheets).toBe(23);
  });

  it('skip gives +3 sheets to the next contract only', () => {
    const e = atOffer();
    e.skipOffer();
    expect(e.state.contract.sheetsLeft).toBe(23);
    const next = forceWin(e).engine;
    next.takeOffer(0);
    expect(next.state.contract.sheetsLeft).toBe(20);
  });

  it('Rush contracts use 14 base sheets', () => {
    const e = atOffer({ contractIndex: 1, mods: { '1': [{ id: 'rush' }] } });
    e.takeOffer(0);
    expect(e.state.contract.spec.sheets).toBe(BALANCE.rushSheets);
    expect(e.state.contract.sheetsLeft).toBe(14);
  });

  it('sell values follow the GDD: common 1, rare 1, legendary 2, Ream 0', () => {
    for (const id of MATRIX_IDS) {
      const expected = id === 'ream' ? 0 : { common: 1, rare: 1, legendary: 2 }[matrixDef(id).rarity];
      expect(sellValue(id), id).toBe(expected);
    }
  });

  it('selling while playing adds sheets to the current contract', () => {
    const e = craft(start(), (s) => setPlates(s, ['proof', 'journeyman', 'gutenberg', 'ream']));
    const cases: Array<[MatrixId, number]> = [
      ['proof', 1],
      ['journeyman', 1],
      ['gutenberg', 2],
      ['ream', 0],
    ];
    let left = e.state.contract.sheetsLeft;
    let granted = e.state.contract.sheetsGranted;
    for (const [id, sheets] of cases) {
      const uid = plateUid(e, id);
      const sold = ev(e.sell(uid), 'plate_sold');
      expect(sold).toMatchObject({ sheets, toCurrent: true });
      expect(sold.inst.id).toBe(id);
      left += sheets;
      granted += sheets;
      expect(e.state.contract.sheetsLeft).toBe(left);
      expect(e.state.contract.sheetsGranted).toBe(granted);
      expect(e.state.plates.some((p) => p.uid === uid)).toBe(false);
    }
    expect(e.state.pendingSheets).toBe(0);
    expect(e.state.phase).toBe('playing');
  });

  it('selling during the offer sends sheets to the next contract', () => {
    const e = atOffer({ plates: ['gutenberg', 'proof'] });
    expect(ev(e.sell(plateUid(e, 'gutenberg')), 'plate_sold')).toMatchObject({ sheets: 2, toCurrent: false });
    expect(ev(e.sell(plateUid(e, 'proof')), 'plate_sold')).toMatchObject({ sheets: 1, toCurrent: false });
    expect(e.state.pendingSheets).toBe(3);
    expect(e.state.phase).toBe('offer');
    expect(ev(e.takeOffer(0), 'contract_started').sheets).toBe(23);
  });

  it('deals only as many pieces as sheets left', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      setTray(s, ['dot']);
      s.contract.sheetsLeft = 2;
    });
    const dealt = ev(e.place(0, 0, 0), 'dealt');
    expect(dealt.pieces).toHaveLength(1);
    expect(e.state.tray.filter((p) => p !== null)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('last chance (GDD §6.4)', () => {
  const lastSheet = (plates: readonly MatrixId[]) =>
    craft(start(), (s) => {
      s.cells = newCells();
      setTray(s, ['dot']);
      setPlates(s, plates);
      s.contract.sheetsLeft = 1;
      s.contract.streak = 5;
    });

  it('out of sheets, quota unmet, sellable plate → last_chance; selling resumes play', () => {
    const e = lastSheet(['proof']);
    const events = e.place(0, 0, 0);
    expect(types(events)).toEqual(['placed', 'streak', 'last_chance']);
    expect(e.state.phase).toBe('last_chance');
    expect(() => e.place(0, 1, 1)).toThrow(RunError);
    const sold = e.sell(plateUid(e, 'proof'));
    expect(types(sold)).toEqual(['plate_sold', 'dealt']);
    expect(ev(sold, 'plate_sold').toCurrent).toBe(true);
    expect(ev(sold, 'dealt').pieces).toHaveLength(1);
    expect(e.state.phase).toBe('playing');
    expect(e.state.contract.sheetsLeft).toBe(1);
  });

  it('acceptLoss → lost (quota)', () => {
    const e = lastSheet(['proof']);
    e.place(0, 0, 0);
    expect(e.acceptLoss()).toEqual([{ type: 'lost', reason: 'quota' }]);
    expect(e.state.phase).toBe('lost');
    expect(e.state.lossReason).toBe('quota');
  });

  it('without sellable plates the contract is lost directly', () => {
    for (const plates of [[], ['ream']] as MatrixId[][]) {
      const e = lastSheet(plates);
      const events = e.place(0, 0, 0);
      expect(types(events)).toEqual(['placed', 'streak', 'lost']);
      expect(ev(events, 'lost').reason).toBe('quota');
      expect(e.state.lossReason).toBe('quota');
    }
  });

  it('selling Ream (0 sheets) keeps last chance while another plate is sellable', () => {
    const e = lastSheet(['ream', 'proof']);
    e.place(0, 0, 0);
    e.sell(plateUid(e, 'ream'));
    expect(e.state.phase).toBe('last_chance');
    e.sell(plateUid(e, 'proof'));
    expect(e.state.phase).toBe('playing');
  });

  it('after the last sellable plate is sold, running out again loses directly', () => {
    const e = lastSheet(['ream', 'type_case']);
    e.place(0, 0, 0);
    expect(e.state.phase).toBe('last_chance');
    e.sell(plateUid(e, 'type_case'));
    expect(e.state.phase).toBe('playing');
    const [slot, x, y] = dryMove(e);
    expect(types(e.place(slot, x, y))).toEqual(['placed', 'streak', 'lost']);
  });

  it('last-chance state from crafted save: selling the last 0-value plate loses (quota)', () => {
    const e = craft(start(), (s) => {
      setPlates(s, ['ream']);
      s.phase = 'last_chance';
      s.contract.sheetsLeft = 0;
    });
    const events = e.sell(plateUid(e, 'ream'));
    expect(types(events)).toEqual(['plate_sold', 'lost']);
    expect(e.state.lossReason).toBe('quota');
  });

  it('a sale in last chance re-checks the jam with the remaining tray piece', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4']);
      setPlates(s, ['proof']);
      s.contract.sheetsLeft = 1;
    });
    e.place(0, 1, 0);
    expect(e.state.phase).toBe('last_chance'); // sheets before jam
    const events = e.sell(plateUid(e, 'proof'));
    expect(types(events)).toEqual(['plate_sold', 'lost']);
    expect(e.state.lossReason).toBe('jam');
  });
});

// ---------------------------------------------------------------------------

describe('jam and the type case (GDD §3.3, §4)', () => {
  it('loses with "jam" when no tray piece fits', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4']);
    });
    const events = e.place(0, 1, 0);
    expect(types(events)).toEqual(['placed', 'streak', 'lost']);
    expect(ev(events, 'lost').reason).toBe('jam');
    expect(e.state.phase).toBe('lost');
    expect(e.anyMoveAvailable()).toBe(false);
  });

  it('the jam check includes the reserve piece', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4']);
      setPlates(s, ['type_case']);
      s.reserve = tp(s, 'dot');
    });
    e.place(0, 1, 0);
    expect(e.state.phase).toBe('playing');
    expect(e.anyMoveAvailable()).toBe(true);
    const events = e.place('reserve', 3, 0);
    expect(e.state.reserve).toBeNull();
    // The o4 is stuck, but the case is empty again: stashing it is the way out.
    expect(evs(events, 'lost')).toHaveLength(0);
    expect(e.canStash(1)).toBe(true);
  });

  it('stashing the last piece into an empty case is an escape, not a jam', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4']);
      setPlates(s, ['type_case']);
    });
    // After the dot only the o4 is left: it fits nowhere, but stashing it deals a fresh tray.
    const events = e.place(0, 1, 0);
    expect(evs(events, 'lost')).toHaveLength(0);
    expect(e.state.phase).toBe('playing');
    expect(e.anyMoveAvailable()).toBe(true);
    const stashed = e.stash(1);
    expect(types(stashed)).toEqual(['stashed', 'dealt']);
    expect(e.state.reserve?.shape).toBe('o4');
    expect(e.state.phase).toBe('playing');
  });

  it('no stash escape once the case is full or the stash is spent', () => {
    const full = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4']);
      setPlates(s, ['type_case']);
      s.reserve = tp(s, 'o4');
    });
    expect(ev(full.place(0, 1, 0), 'lost').reason).toBe('jam');

    const spent = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, [null, 'o4', null]);
      setPlates(s, ['type_case']);
      s.stashUsed = true;
    });
    expect(spent.anyMoveAvailable()).toBe(false);
  });

  it('a disabled type case locks the reserve (no stash, no placing, no jam rescue)', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4', 'dot']);
      const [tc] = setPlates(s, ['type_case']);
      s.contract.disabledUid = (tc as MatrixInstance).uid;
      s.reserve = tp(s, 'dot');
    });
    expect(e.hasReserve()).toBe(true);
    expect(e.reserveSlots()).toBe(0);
    expect(e.canStash(0)).toBe(false);
    expectRejected(e, () => e.stash(0));
    expect(e.canPlace('reserve', 1, 0)).toBe(false);
    expect(e.validPositions('reserve')).toEqual([]);
    expectRejected(e, () => e.place('reserve', 1, 0));
    e.place(0, 1, 0);
    expect(e.state.phase).toBe('playing'); // the second dot still fits
    expect(ev(e.place(2, 3, 0), 'lost').reason).toBe('jam');
  });

  it('selling the type case strands the reserve piece → jam', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['o4']);
      setPlates(s, ['type_case']);
      s.reserve = tp(s, 'dot');
    });
    expect(e.anyMoveAvailable()).toBe(true);
    const events = e.sell(plateUid(e, 'type_case'));
    expect(types(events)).toEqual(['plate_sold', 'lost']);
    expect(e.state.lossReason).toBe('jam');
    expect(e.hasReserve()).toBe(true); // piece still stored
  });

  it('stash requires a type case', () => {
    const e = start();
    expect(e.canStash(0)).toBe(false);
    expectRejected(e, () => e.stash(0));
  });

  it('stash moves a piece to the empty reserve; at most one stash per placement', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      setPlates(s, ['type_case']);
      setTray(s, ['dot', 'i2h', 'o4']);
    });
    const [a, b, c] = e.state.tray as [TrayPiece, TrayPiece, TrayPiece];
    const events = e.stash(0);
    expect(events).toEqual([{ type: 'stashed', from: 0, piece: a, swapped: null }]);
    expect(e.state.reserve).toEqual(a);
    expect(e.state.tray).toEqual([null, b, c]);
    expect(e.state.stashUsed).toBe(true);
    expect(e.state.contract.sheetsLeft).toBe(20); // stashing is free
    expect(e.canStash(1)).toBe(false);
    expectRejected(e, () => e.stash(1));
    // A placement re-enables stashing; an occupied reserve swaps.
    e.place(1, 0, 0);
    expect(e.state.stashUsed).toBe(false);
    const swap = e.stash(2);
    expect(swap).toEqual([{ type: 'stashed', from: 2, piece: c, swapped: a }]);
    expect(e.state.reserve).toEqual(c);
    expect(e.state.tray).toEqual([null, null, a]);
  });

  it('placing from the reserve costs a sheet', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      setPlates(s, ['type_case']);
      setTray(s, ['dot', 'dot']);
      s.reserve = tp(s, 'o4');
    });
    const before = e.state.contract;
    const left = before.sheetsLeft;
    const used = before.sheetsUsed;
    const events = e.place('reserve', 0, 0);
    expect(ev(events, 'placed').slot).toBe('reserve');
    expect(e.state.reserve).toBeNull();
    expect(e.state.contract.sheetsLeft).toBe(left - 1);
    expect(e.state.contract.sheetsUsed).toBe(used + 1);
    expect(e.state.totals.placements).toBe(1);
    expect(evs(events, 'dealt')).toHaveLength(0); // tray still has pieces
  });

  it('a new tray comes when the tray slots are empty, regardless of the reserve', () => {
    // Stashing the last tray piece deals a new tray.
    const a = craft(start(), (s) => {
      s.cells = newCells();
      setPlates(s, ['type_case']);
      setTray(s, ['dot']);
    });
    const events = a.stash(0);
    expect(types(events)).toEqual(['stashed', 'dealt']);
    expect(ev(events, 'dealt').pieces).toHaveLength(3);
    expect(a.state.reserve?.shape).toBe('dot');

    // Placing the last tray piece deals a new tray although the reserve holds a piece.
    const b = craft(start(), (s) => {
      s.cells = newCells();
      setPlates(s, ['type_case']);
      setTray(s, ['dot']);
      s.reserve = tp(s, 'o4');
    });
    expect(types(b.place(0, 0, 0))).toEqual(['placed', 'streak', 'dealt']);
    expect(b.state.reserve?.shape).toBe('o4');

    // Swapping with the reserve keeps a tray piece → no deal.
    const c = craft(start(), (s) => {
      s.cells = newCells();
      setPlates(s, ['type_case']);
      setTray(s, ['dot']);
      s.reserve = tp(s, 'o4');
    });
    expect(types(c.stash(0))).toEqual(['stashed']);
    expect(c.state.tray[0]?.shape).toBe('o4');
  });

  it('cannot stash an empty or missing slot', () => {
    const e = craft(start(), (s) => {
      setPlates(s, ['type_case']);
      setTray(s, ['dot', null, 'dot']);
    });
    expect(e.canStash(1)).toBe(false);
    expect(e.canStash(3)).toBe(false);
    expect(e.canStash(-1)).toBe(false);
    expectRejected(e, () => e.stash(1));
  });

  it('stash re-checks the jam (the reserve piece counts)', () => {
    // Stashing the only fitting piece keeps it playable from the reserve.
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setPlates(s, ['type_case']);
      setTray(s, ['dot', 'o4']);
    });
    e.stash(0);
    expect(e.state.phase).toBe('playing');
    expect(e.canPlace('reserve', 1, 0)).toBe(true);
    // Crafted dead position: a swap that leaves nothing placeable loses.
    const f = craft(start(), (s) => {
      s.cells = checkerboard();
      setPlates(s, ['type_case']);
      setTray(s, ['o4', 'o4']);
      s.reserve = tp(s, 'o4');
    });
    // Nothing fits anywhere; a stash swap re-checks and loses.
    expect(ev(f.stash(0), 'lost').reason).toBe('jam');
  });

  it('the reserve survives into the next contract', () => {
    const e = craft(start(), (s) => {
      primeWin(s);
      setPlates(s, ['type_case']);
      s.reserve = tp(s, 'v5a');
    });
    e.place(0, 7, 7);
    e.skipOffer();
    expect(e.state.reserve?.shape).toBe('v5a');
    expect(e.state.stashUsed).toBe(false);
  });

  it('short tray deals 2 pieces', () => {
    const e = atOffer({ contractIndex: 1, mods: { '1': [{ id: 'short_tray' }] } });
    const events = e.skipOffer();
    expect(e.state.traySize).toBe(2);
    expect(ev(events, 'dealt').pieces).toHaveLength(2);
    expect(e.state.tray[2]).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('offers (GDD §8.1, §9.1, §18.4)', () => {
  const offerOf = (index: number, cardCount: number, guaranteeRare: boolean, rerolls = 0): OfferState => ({
    index,
    cards: [],
    cardCount,
    guaranteeRare,
    rerolls,
    adRerollsHere: 0,
  });

  it('never offers owned plates, duplicates or more than one ink plate; respects the pool', () => {
    const racks: MatrixId[][] = [
      [],
      ['ink_pink', 'proof'],
      ['ink_blue', 'monotype', 'gutenberg', 'type_case', 'ream'],
    ];
    for (const rack of racks) {
      const e = craft(start(), (s) => setPlates(s, rack));
      for (let i = 0; i < 300; i++) {
        const cards = e.drawOffer(offerOf(i % 24, 3 + (i % 2), i % 3 === 0, i % 4));
        expect(cards).toHaveLength(3 + (i % 2));
        expect(new Set(cards).size).toBe(cards.length);
        for (const id of cards) expect(rack).not.toContain(id);
        expect(cards.filter(isInkPlate).length).toBeLessThanOrEqual(1);
      }
    }
    const pool: MatrixId[] = [
      'proof',
      'guillotine',
      'roller',
      'margins',
      'journeyman',
      'archive',
      'hydraulic',
    ];
    const p = start({ pool });
    for (let i = 0; i < 100; i++)
      for (const id of p.drawOffer(offerOf(i, 4, false))) expect(pool).toContain(id);
  });

  it('Ink Well is not an ink plate: it may appear next to an ink plate', () => {
    const e = start();
    let together = 0;
    for (let i = 0; i < 3000; i++) {
      const cards = e.drawOffer(offerOf(i, 4, i % 2 === 0, i % 3));
      if (cards.includes('ink_well') && cards.some(isInkPlate)) together++;
    }
    expect(together).toBeGreaterThan(0);
  });

  it('guaranteeRare puts at least one rare/legendary card in every offer', () => {
    const e = craft(start(), (s) => setPlates(s, ['monotype', 'journeyman']));
    for (let i = 0; i < 500; i++) {
      const cards = e.drawOffer(offerOf(i, 3 + (i % 2), true, i % 5));
      expect(cards.some((id) => matrixDef(id).rarity !== 'common')).toBe(true);
    }
  });

  it('first-card rarities follow 64/30/6 (58/32/10 from edition 4)', () => {
    const count = (contractIndex: number) => {
      const e = craft(start(), (s) => (s.contractIndex = contractIndex));
      const n: Record<string, number> = { common: 0, rare: 0, legendary: 0 };
      const N = 4000;
      for (let i = 0; i < N; i++) {
        const first = e.drawOffer(offerOf(i, 3, false))[0] as MatrixId;
        n[matrixDef(first).rarity]!++;
      }
      return [n.common! / N, n.rare! / N, n.legendary! / N];
    };
    const early = count(0);
    expect(Math.abs(early[0]! - 0.64)).toBeLessThan(0.04);
    expect(Math.abs(early[1]! - 0.3)).toBeLessThan(0.04);
    expect(Math.abs(early[2]! - 0.06)).toBeLessThan(0.02);
    const late = count(9); // offer before a contract of edition 4
    expect(Math.abs(late[0]! - 0.58)).toBeLessThan(0.04);
    expect(Math.abs(late[1]! - 0.32)).toBeLessThan(0.04);
    expect(Math.abs(late[2]! - 0.1)).toBeLessThan(0.02);
  });

  it('an exhausted rarity pool falls back to a lower rarity', () => {
    // Commons only: even guaranteed offers are filled with commons.
    const c = start({ pool: COMMONS });
    for (let i = 0; i < 200; i++) {
      const cards = c.drawOffer(offerOf(i, 4, true));
      expect(cards).toHaveLength(4);
      for (const id of cards) expect(matrixDef(id).rarity).toBe('common');
    }
    // No legendaries: legendary rolls become rares, offers stay full.
    const r = start({ pool: [...COMMONS, ...RARES] });
    let rares = 0;
    for (let i = 0; i < 500; i++) {
      const cards = r.drawOffer(offerOf(i, 3, true));
      expect(cards).toHaveLength(3);
      for (const id of cards) expect(matrixDef(id).rarity).not.toBe('legendary');
      rares += cards.filter((id) => matrixDef(id).rarity === 'rare').length;
    }
    expect(rares).toBeGreaterThan(500);
    // A single legendary owned → remaining legendaries still drawable, never the owned one.
    const l = craft(start({ pool: [...COMMONS, 'gutenberg', 'hydraulic'] }), (s) =>
      setPlates(s, ['gutenberg']),
    );
    for (let i = 0; i < 300; i++) {
      const cards = l.drawOffer(offerOf(i, 3, true));
      expect(cards).not.toContain('gutenberg');
      expect(cards).toHaveLength(3);
    }
  });

  it('is deterministic per (seed, offer index, reroll count)', () => {
    const a = start();
    const b = start();
    for (let i = 0; i < 50; i++) {
      for (let r = 0; r < 3; r++)
        expect(a.drawOffer(offerOf(i, 4, true, r))).toEqual(b.drawOffer(offerOf(i, 4, true, r)));
    }
    const distinct = new Set(
      Array.from({ length: 20 }, (_, r) => JSON.stringify(a.drawOffer(offerOf(3, 3, false, r)))),
    );
    expect(distinct.size).toBeGreaterThan(10);
    const other = start({ seed: 'another-seed' });
    let differ = 0;
    for (let i = 0; i < 20; i++)
      if (
        JSON.stringify(other.drawOffer(offerOf(i, 3, false))) !==
        JSON.stringify(a.drawOffer(offerOf(i, 3, false)))
      )
        differ++;
    expect(differ).toBeGreaterThan(10);
    // Drawing never mutates the run.
    const snap = a.snapshot();
    a.drawOffer(offerOf(0, 4, true));
    expect(a.snapshot()).toEqual(snap);
  });

  it('the won offer equals drawOffer(index, rerolls) and reroll keeps cardCount and guarantee', () => {
    const { engine: e, events } = forceWin(start(), 0); // 1/20 sheets → 4 cards + rare
    const offer = ev(events, 'offer').offer;
    expect(offer).toMatchObject({
      index: 0,
      cardCount: 4,
      guaranteeRare: true,
      rerolls: 0,
      adRerollsHere: 0,
    });
    expect(offer.cards).toEqual(e.drawOffer({ ...offer, cards: [] }));
    const rr = e.reroll('free');
    const after = ev(rr, 'rerolled');
    expect(after.kind).toBe('free');
    expect(after.offer).toMatchObject({ index: 0, cardCount: 4, guaranteeRare: true, rerolls: 1 });
    expect(after.offer.cards).toHaveLength(4);
    expect(after.offer.cards.some((id) => matrixDef(id).rarity !== 'common')).toBe(true);
    expect(after.offer.cards).toEqual(e.drawOffer({ ...offer, rerolls: 1, cards: [] }));
    expect(e.state.offer).toEqual(after.offer);
    // Same seed, same path → same offer and reroll.
    const twin = forceWin(start(), 0).engine;
    twin.reroll('free');
    expect(twin.state.offer).toEqual(e.state.offer);
  });

  it('reroll caps: 1 free per run, ad only after the free one, ≤ 1 ad per offer, ≤ 3 ad per run', () => {
    let e = forceWin(start()).engine;
    expect(e.canReroll('free')).toBe(true);
    expect(e.canReroll('ad')).toBe(false); // ad button appears only after the free reroll
    expectRejected(e, () => e.reroll('ad'));
    e.reroll('free');
    expect(e.state.freeRerolls).toBe(0);
    expect(e.canReroll('free')).toBe(false);
    expectRejected(e, () => e.reroll('free'));
    expect(e.canReroll('ad')).toBe(true);
    expect(ev(e.reroll('ad'), 'rerolled').offer).toMatchObject({ rerolls: 2, adRerollsHere: 1 });
    expect(e.canReroll('ad')).toBe(false); // 1 per screen
    expectRejected(e, () => e.reroll('ad'));
    expect(e.state.adRerollsUsed).toBe(1);
    for (let k = 2; k <= 3; k++) {
      e.skipOffer();
      e = forceWin(e).engine;
      expect(e.canReroll('free')).toBe(false);
      expect(e.canReroll('ad')).toBe(true);
      e.reroll('ad');
      expect(e.state.adRerollsUsed).toBe(k);
    }
    e.skipOffer();
    e = forceWin(e).engine;
    expect(e.state.offer?.adRerollsHere).toBe(0);
    expect(e.canReroll('ad')).toBe(false); // 3 per run
    expectRejected(e, () => e.reroll('ad'));
  });

  it('daily: one free reroll, no ad rerolls', () => {
    const e = forceWin(start({ mode: 'daily', dailyDate: '2026-10-07' })).engine;
    expect(e.canReroll('ad')).toBe(false);
    e.reroll('free');
    expect(e.canReroll('ad')).toBe(false);
    expectRejected(e, () => e.reroll('ad'));
  });

  it('cannot reroll outside an offer', () => {
    const e = start();
    expect(e.canReroll('free')).toBe(false);
    expectRejected(e, () => e.reroll('free'));
  });

  it('taking a card with free slots appends it and starts the next contract', () => {
    const e = atOffer({ plates: ['proof'] });
    const events = e.takeOffer(1);
    expect(types(events).slice(0, 2)).toEqual(['plate_added', 'contract_started']);
    const added = ev(events, 'plate_added');
    expect(added.inst.id).toBe('roller');
    expect(added.slot).toBe(1);
    expect(added.replaced).toBeNull();
    expect(e.state.plates.map((p) => p.id)).toEqual(['proof', 'roller']);
    expect(e.state.contractIndex).toBe(1);
    expect(e.state.offer).toBeNull();
    expect(e.state.phase).toBe('playing');
  });

  it('a sold plate returns to the pool with a fresh counter', () => {
    const e = craft(atOffer({ plates: ['journeyman'] }), (s) => {
      (s.plates[0] as MatrixInstance).state.mult = 4;
    });
    const before = e.drawOffer({
      index: 5,
      cards: [],
      cardCount: 4,
      guaranteeRare: true,
      rerolls: 0,
      adRerollsHere: 0,
    });
    expect(before).not.toContain('journeyman');
    e.sell(plateUid(e, 'journeyman'));
    let seen = false;
    for (let i = 0; i < 300 && !seen; i++)
      seen = e
        .drawOffer({ index: i, cards: [], cardCount: 4, guaranteeRare: true, rerolls: 0, adRerollsHere: 0 })
        .includes('journeyman');
    expect(seen).toBe(true);
    const t = craft(e, (s) => ((s.offer as OfferState).cards = ['journeyman']));
    t.takeOffer(0);
    expect((t.state.plates[0] as MatrixInstance).state.mult).toBe(1);
  });

  it('a full rack requires replaceUid; the replaced plate’s sheets go to the next contract', () => {
    const rack: MatrixId[] = ['proof', 'journeyman', 'gutenberg', 'ream', 'petit'];
    const e = atOffer({ plates: rack });
    expectRejected(e, () => e.takeOffer(0));
    expectRejected(e, () => e.takeOffer(0, 999_999));
    expectRejected(e, () => e.takeOffer(7, plateUid(e, 'proof')));
    const old = e.state.plates.map((p) => p.uid);
    const target = plateUid(e, 'gutenberg');
    const events = e.takeOffer(2, target);
    expect(types(events).slice(0, 3)).toEqual(['plate_sold', 'plate_added', 'contract_started']);
    expect(ev(events, 'plate_sold')).toMatchObject({ sheets: 2, toCurrent: false });
    const added = ev(events, 'plate_added');
    expect(added.slot).toBe(2);
    expect(added.replaced?.id).toBe('gutenberg');
    expect(e.state.plates.map((p) => p.id)).toEqual(['proof', 'journeyman', 'margins', 'ream', 'petit']);
    expect(e.state.plates.map((p) => p.uid).filter((u, k) => u === old[k])).toHaveLength(4);
    // 20 base + 3 Ream + 2 from the replaced legendary.
    expect(ev(events, 'contract_started').sheets).toBe(25);

    const r = atOffer({ plates: rack });
    expect(ev(r.takeOffer(0, plateUid(r, 'ream')), 'contract_started').sheets).toBe(20); // Ream gone, sells for 0
  });

  it('skipOffer / takeOffer / bad cards are rejected without an offer', () => {
    const e = start();
    expectRejected(e, () => e.takeOffer(0));
    expectRejected(e, () => e.skipOffer());
    const o = atOffer();
    expectRejected(o, () => o.takeOffer(3));
    expectRejected(o, () => o.takeOffer(-1));
  });
});

// ---------------------------------------------------------------------------

describe('plate failure (GDD §7 failure)', () => {
  const failureAt = (plates: readonly MatrixId[], seed = SEED) =>
    atOffer({ contractIndex: 1, plates, mods: { '1': [{ id: 'failure' }] }, seed });

  it('disables a plate chosen by the seeded failure stream, weighted by rarity', () => {
    const e = failureAt(['proof', 'journeyman', 'gutenberg']);
    const plates = e.state.plates.map((p) => p.uid);
    const events = e.skipOffer();
    const pick = Rng.derive(SEED, 'failure', 2).weightedIndex([1, 2, 3]);
    const started = ev(events, 'contract_started');
    expect(started.disabledUid).toBe(plates[pick]);
    expect(e.state.contract.disabledUid).toBe(plates[pick]);
    expect(e.enabledPlates()).toHaveLength(2);

    const counts = [0, 0, 0];
    const N = 600;
    for (let k = 0; k < N; k++) {
      const f = failureAt(['proof', 'journeyman', 'gutenberg'], `fail-${k}`);
      const uids = f.state.plates.map((p) => p.uid);
      f.skipOffer();
      counts[uids.indexOf(f.state.contract.disabledUid as number)]!++;
    }
    expect(Math.abs(counts[0]! / N - 1 / 6)).toBeLessThan(0.05);
    expect(Math.abs(counts[1]! / N - 2 / 6)).toBeLessThan(0.06);
    expect(Math.abs(counts[2]! / N - 3 / 6)).toBeLessThan(0.06);
  });

  it('no failure without the modifier or without plates', () => {
    const n = atOffer({ contractIndex: 1, plates: ['proof'], mods: { '1': [{ id: 'rush' }] } });
    expect(ev(n.skipOffer(), 'contract_started').disabledUid).toBeNull();
    const empty = failureAt([]);
    expect(ev(empty.skipOffer(), 'contract_started').disabledUid).toBeNull();
  });

  it('rearranging the rack during the offer does not steer which plate fails', () => {
    const plain = failureAt(['proof', 'journeyman', 'gutenberg']);
    const moved = failureAt(['proof', 'journeyman', 'gutenberg']);
    moved.movePlate(0, 2);
    moved.movePlate(0, 1);
    expect(ev(moved.skipOffer(), 'contract_started').disabledUid).toBe(
      ev(plain.skipOffer(), 'contract_started').disabledUid,
    );
  });

  it('moving plates does not move the failure', () => {
    const e = failureAt(['proof', 'journeyman', 'gutenberg']);
    e.skipOffer();
    const disabled = e.state.contract.disabledUid;
    expect(e.movePlate(0, 2)).toEqual([{ type: 'plate_moved', from: 0, to: 2 }]);
    e.movePlate(2, 1);
    expect(e.state.contract.disabledUid).toBe(disabled);
    const inst = e.state.plates.find((p) => p.uid === disabled) as MatrixInstance;
    expect(e.isEnabled(inst)).toBe(false);
    expect(e.enabledPlates().map((p) => p.uid)).not.toContain(disabled);
    expect(e.enabledPlates()).toHaveLength(2);
  });

  it('a disabled Ream grants no sheets; a disabled ink plate gives no affinity', () => {
    const r = failureAt(['ream']);
    expect(ev(r.skipOffer(), 'contract_started').sheets).toBe(20 + 3); // base + skip only
    const i = failureAt(['ink_pink']);
    i.skipOffer();
    expect(i.inkWeights()).toEqual([1, 1, 1, 1, 1]);
  });

  it('a disabled plate does not score or grow', () => {
    const scored = (disabled: boolean) => {
      const e = craft(start(), (s) => {
        s.cells = newCells();
        fillRow(s.cells, 7, [7]);
        setTray(s, ['dot', 'dot']);
        const [proof, archive] = setPlates(s, ['proof', 'archive']);
        s.contract.disabledUid = disabled ? (proof as MatrixInstance).uid : null;
        void archive;
      });
      const total = ev(e.place(0, 7, 7), 'printed').result.total;
      return { total, e };
    };
    expect(scored(true).total).toBe(80 * 3); // mono line: MULT 1 + 0 + 2
    expect(scored(false).total).toBe(80 * 6); // + Proof 3

    const growth = craft(start(), (s) => {
      s.cells = newCells();
      fillRow(s.cells, 7, [7]);
      setTray(s, ['dot', 'dot']);
      const [archive] = setPlates(s, ['archive']);
      s.contract.disabledUid = (archive as MatrixInstance).uid;
    });
    growth.place(0, 7, 7);
    expect((growth.state.plates[0] as MatrixInstance).state.bonus).toBe(0);
  });

  it('selling the disabled plate disables nothing else', () => {
    const e = failureAt(['proof', 'journeyman', 'gutenberg']);
    e.skipOffer();
    const disabled = e.state.contract.disabledUid as number;
    e.sell(disabled);
    expect(e.state.plates).toHaveLength(2);
    expect(e.state.contract.disabledUid).toBe(disabled);
    expect(e.enabledPlates()).toHaveLength(2);
  });

  it('the failure lasts one contract', () => {
    const e = failureAt(['proof']);
    e.skipOffer();
    expect(e.enabledPlates()).toHaveLength(0);
    const next = forceWin(e).engine;
    next.skipOffer();
    expect(next.state.contract.disabledUid).toBeNull();
    expect(next.enabledPlates()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('reprint / continueRun (GDD §9.3)', () => {
  const quotaLoss = (opts: Partial<RunOptions> = {}) => {
    const e = craft(start(opts), (s) => {
      s.cells = newCells();
      setTray(s, ['dot']);
      s.contract.sheetsLeft = 1;
      s.contract.streak = 5;
      s.contract.dry = 1;
    });
    e.place(0, 0, 0);
    expect(e.state.phase).toBe('lost');
    return e;
  };

  it('after a quota loss: +8 sheets, SERIA kept, new tray', () => {
    const e = quotaLoss();
    expect(e.canContinue()).toBe(true);
    const granted = e.state.contract.sheetsGranted;
    const events = e.continueRun();
    expect(types(events)).toEqual(['continued', 'dealt']);
    expect(ev(events, 'continued')).toEqual({
      type: 'continued',
      reason: 'quota',
      clearedCells: [],
      sheets: 8,
    });
    expect(e.state.phase).toBe('playing');
    expect(e.state.lossReason).toBeNull();
    expect(e.state.contract.sheetsLeft).toBe(8);
    expect(e.state.contract.sheetsGranted).toBe(granted + 8);
    expect(e.state.contract.streak).toBe(5);
    expect(e.state.continueUsed).toBe(true);
    expect(ev(events, 'dealt').pieces).toHaveLength(3);
  });

  it('after last chance → acceptLoss, the reprint also works', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      setTray(s, ['dot']);
      setPlates(s, ['proof']);
      s.contract.sheetsLeft = 1;
    });
    e.place(0, 0, 0);
    e.acceptLoss();
    e.continueRun();
    expect(e.state.contract.sheetsLeft).toBe(8);
    expect(e.state.plates).toHaveLength(1);
  });

  it('only once per run', () => {
    const e = quotaLoss();
    e.continueRun();
    const again = craft(e, (s) => {
      setTray(s, ['dot']);
      s.contract.sheetsLeft = 1;
    });
    again.place(0, 2, 2);
    expect(again.state.phase).toBe('lost');
    expect(again.canContinue()).toBe(false);
    expectRejected(again, () => again.continueRun());
    expect(again.endRun()).toEqual([{ type: 'run_over', won: false }]);
  });

  it('not in the daily challenge', () => {
    const e = quotaLoss({ mode: 'daily', dailyDate: '2026-10-07' });
    expect(e.canContinue()).toBe(false);
    expectRejected(e, () => e.continueRun());
  });

  it('only when lost', () => {
    const e = start();
    expect(e.canContinue()).toBe(false);
    expectRejected(e, () => e.continueRun());
  });

  it('after a jam: clears the 2 fullest rows and 2 fullest columns (ties → lower index, jams stay)', () => {
    const e = craft(start(), (s) => {
      const c = newCells();
      fillRow(c, 6, [7], 1); // 7 cells
      fillRow(c, 1, [6, 7], 2); // 6 cells
      fillRow(c, 3, [6, 7], 3); // 6 cells
      c[idx(6, 3)] = JAM; // a jam does not count as content and stays
      c[idx(7, 0)] = LEAD; // lead counts as content
      s.cells = c;
      s.phase = 'lost';
      s.lossReason = 'jam';
      setTray(s, ['o9', 'o9', 'o9']);
    });
    // Rows: 6 → 7, 1 → 6, 3 → 6 (tie → 1). Columns 0..5 → 3 each, 7 → 1 (tie → 0, 1).
    const expected = [
      ...Array.from({ length: 6 }, (_, x) => idx(x, 1)),
      idx(0, 3),
      idx(1, 3),
      ...Array.from({ length: 7 }, (_, x) => idx(x, 6)),
    ].sort((a, b) => a - b);
    const firstNewUid = e.state.nextUid;
    const events = e.continueRun();
    expect(types(events)).toEqual(['continued', 'dealt']);
    const cont = ev(events, 'continued');
    expect(cont).toEqual({ type: 'continued', reason: 'jam', clearedCells: expected, sheets: 0 });
    const c = e.state.cells;
    for (const i of expected) expect(c[i]).toBe(EMPTY);
    expect(c[idx(6, 3)]).toBe(JAM);
    expect(c[idx(7, 0)]).toBe(LEAD);
    for (let x = 2; x <= 5; x++) expect(c[idx(x, 3)]).toBe(3);
    expect(c.filter((v) => v !== EMPTY)).toHaveLength(6);
    // A brand-new tray replaced the stuck one.
    expect(ev(events, 'dealt').pieces.map((p) => p.uid)).toEqual(
      e.state.tray.filter((p) => p !== null).map((p) => p.uid),
    );
    for (const p of e.state.tray) if (p) expect(p.uid).toBeGreaterThanOrEqual(firstNewUid);
    expect(e.anyMoveAvailable()).toBe(true);
    expect(e.state.contract.sheetsLeft).toBe(20);
  });

  it('a real jam → reprint → play on, keeping the reserve', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4']);
      setPlates(s, ['type_case']);
      const [tc] = s.plates;
      s.contract.disabledUid = (tc as MatrixInstance).uid;
      s.reserve = tp(s, 'i5h');
      s.contract.streak = 4;
    });
    e.place(0, 1, 0);
    expect(e.state.lossReason).toBe('jam');
    const reserve = e.state.reserve;
    const cont = ev(e.continueRun(), 'continued');
    // Checkerboard + (1,0): row 0 has 5, every other row 4; col 1 has 5 → rows 0,1 / cols 1,0.
    const rows = [0, 1];
    const cols = [0, 1];
    const want = new Set<number>();
    for (const y of rows)
      for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0 || (x === 1 && y === 0)) want.add(idx(x, y));
    for (const x of cols)
      for (let y = 0; y < 8; y++) if ((x + y) % 2 === 0 || (x === 1 && y === 0)) want.add(idx(x, y));
    expect(cont.clearedCells).toEqual([...want].sort((a, b) => a - b));
    expect(e.state.reserve).toEqual(reserve);
    expect(e.state.contract.streak).toBe(4);
    expect(e.state.phase).toBe('playing');
    const mv = bestMove(e);
    expect(mv).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('victory and endless (GDD §6.1)', () => {
  let cached: RunState | null = null;
  const at23 = (): RunEngine => {
    if (!cached) cached = advanceTo(start(), totalContracts() - 1).snapshot();
    return RunEngine.restore(cached);
  };

  it('fast-forwards through 23 contracts with real contract starts', () => {
    const e = at23();
    expect(e.state.contractIndex).toBe(23);
    expect(e.state.contract.spec.index).toBe(23);
    expect(e.state.contract.spec.edition).toBe(8);
    expect(e.state.contract.spec.special).toBe(true);
    expect(e.state.contract.spec.modifiers).toHaveLength(2);
    expect(e.state.totals.contractsWon).toBe(23);
    expect(e.state.totals.history.map((h) => h.index)).toEqual(Array.from({ length: 23 }, (_, k) => k));
    expect(Object.keys(e.state.editionModifiers).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('winning contract 24 → victory (no offer); endRun → run_over won', () => {
    const { engine: e, events } = forceWin(at23());
    expect(types(events)).toEqual(['placed', 'printed', 'streak', 'contract_won', 'victory']);
    expect(e.state.phase).toBe('victory');
    expect(e.state.offer).toBeNull();
    expect(e.state.totals.contractsWon).toBe(24);
    expect(e.state.totals.history).toHaveLength(24);
    expectRejected(e, () => e.skipOffer());
    expectRejected(e, () => e.sell(1));
    expect(e.endRun()).toEqual([{ type: 'run_over', won: true }]);
    expect(e.state.phase).toBe('over');
    expect(e.state.totals.history).toHaveLength(24);
  });

  it('abandoning on the victory screen still counts as a won run', () => {
    const { engine: e } = forceWin(at23());
    expect(e.abandon()).toEqual([{ type: 'run_over', won: true }]);
    expect(e.state.totals.history).toHaveLength(24);
  });

  it('continueEndless → offer → contract 25 with a growing quota; later wins open offers', () => {
    const { engine: e } = forceWin(at23(), 15); // 16/20 sheets: no early bonus
    const events = e.continueEndless();
    expect(types(events)).toEqual(['offer']);
    expect(e.state.phase).toBe('offer');
    expect(e.state.endless).toBe(true);
    expect(e.state.offer).toMatchObject({ index: 23, cardCount: 3, guaranteeRare: false });
    expect(e.state.offer?.cards).toHaveLength(3);
    const q24 = e.state.contract.spec.quota;
    e.takeOffer(0);
    expect(e.state.contractIndex).toBe(24);
    expect(e.state.contract.spec.index).toBe(24);
    expect(e.state.contract.spec.edition).toBe(9);
    expect(e.state.contract.spec.quota).toBe(quotaFor(24, []));
    expect(e.state.contract.spec.quota).toBeGreaterThan(q24);
    const w = forceWin(e).engine;
    expect(w.state.phase).toBe('offer');
    expect(w.state.offer?.index).toBe(24);
    w.skipOffer();
    expect(w.state.contractIndex).toBe(25);
    // Edition 9 special (index 26) has two modifiers.
    const sp = advanceTo(w, 26);
    expect(sp.state.contract.spec.special).toBe(true);
    expect(sp.state.contract.spec.modifiers).toHaveLength(2);
  });

  it('the endless offer honours the early bonus of contract 24', () => {
    const { engine: e, events } = forceWin(at23(), 0);
    const won = ev(events, 'contract_won');
    expect(won).toMatchObject({ cards: 4, guaranteeRare: true });
    e.continueEndless();
    expect(e.state.offer).toMatchObject({ cardCount: 4, guaranteeRare: true });
    expect(e.state.offer?.cards).toHaveLength(4);
    expect(e.state.offer?.cards.some((id) => matrixDef(id).rarity !== 'common')).toBe(true);
  });

  it('a loss in endless mode ends a won run', () => {
    const { engine: e } = forceWin(at23());
    e.continueEndless();
    e.skipOffer();
    const l = craft(e, (s) => {
      s.cells = newCells();
      setTray(s, ['dot']);
      s.contract.sheetsLeft = 1;
      s.continueUsed = true;
    });
    l.place(0, 0, 0);
    expect(l.state.phase).toBe('lost');
    expect(l.endRun()).toEqual([{ type: 'run_over', won: true }]);
    expect(l.state.totals.history.at(-1)).toMatchObject({ index: 24, won: false });
  });

  it('continueEndless only from victory', () => {
    const e = start();
    expectRejected(e, () => e.continueEndless());
  });
});

// ---------------------------------------------------------------------------

describe('determinism and saves (GDD §12.4, §18.4)', () => {
  const play = (opts: RunOptions, steps: number) => {
    const { engine, events } = RunEngine.create(opts);
    const log = [JSON.stringify(events), ...runScript(engine, steps)];
    return { log, snap: engine.snapshot() };
  };

  it('same seed + same action script ⇒ identical events and snapshots', () => {
    const configs: RunOptions[] = [
      { seed: 'det-a' },
      { seed: 'det-b', startPlates: ['type_case', 'conveyor'] },
      {
        seed: 'det-c',
        mode: 'daily',
        dailyDate: '2026-10-07',
        startPlates: ['ink_yellow'],
        pool: [...COMMONS, ...RARES],
      },
    ];
    for (const cfg of configs) {
      const a = play(cfg, 400);
      const b = play(cfg, 400);
      expect(a.log.length).toBeGreaterThan(50);
      expect(a.log).toEqual(b.log);
      expect(a.snap).toEqual(b.snap);
    }
  });

  it('the scripted runs exercise the whole loop', () => {
    const seen = new Set<string>();
    for (const seed of ['flow-1', 'flow-2', 'flow-3', 'flow-4']) {
      const { engine } = RunEngine.create({ seed, startPlates: ['type_case'] });
      for (let k = 0; k < 2000 && engine.state.phase !== 'over'; k++)
        for (const e of scriptStep(engine, k)) seen.add(e.type);
      expect(engine.state.phase).toBe('over');
    }
    for (const t of [
      'contract_started',
      'dealt',
      'placed',
      'printed',
      'streak',
      'stashed',
      'contract_won',
      'offer',
      'plate_added',
      'rerolled',
      'lost',
      'run_over',
    ])
      expect(seen, t).toContain(t);
  });

  it('different seeds give different trays', () => {
    const trays = new Set(
      Array.from({ length: 10 }, (_, k) =>
        JSON.stringify(start({ seed: `s${k}` }).state.tray.map((p) => p?.shape)),
      ),
    );
    expect(trays.size).toBeGreaterThan(5);
  });

  it('snapshot → restore mid-run continues identically', () => {
    for (const seed of ['mid-a', 'mid-b']) {
      const { engine: a } = RunEngine.create({ seed, startPlates: ['type_case'] });
      runScript(a, 120);
      const snap = a.snapshot();
      const b = RunEngine.restore(JSON.parse(JSON.stringify(snap)) as RunState);
      expect(b.snapshot()).toEqual(snap);
      const la = runScript(a, 300, 120);
      const lb = runScript(b, 300, 120);
      expect(la.length).toBeGreaterThan(0);
      expect(lb).toEqual(la);
      expect(b.snapshot()).toEqual(a.snapshot());
    }
  });

  it('snapshot and restore copy the state', () => {
    const e = start();
    const snap = e.snapshot();
    snap.contract.sheetsLeft = 999;
    (snap.tray[0] as TrayPiece).shape = 'o9';
    expect(e.state.contract.sheetsLeft).toBe(20);
    const input = e.snapshot();
    const r = RunEngine.restore(input);
    input.cells[0] = 3;
    input.plates.push(createInstance('proof', 77));
    expect(r.state.cells[0]).toBe(EMPTY);
    expect(r.state.plates).toHaveLength(0);
  });

  it('restore rejects another state version', () => {
    const s = start().snapshot();
    expect(() => RunEngine.restore({ ...s, v: RUN_STATE_VERSION + 1 })).toThrow(RunError);
    expect(() => RunEngine.restore({ ...s, v: 0 })).toThrow(RunError);
  });
});

// ---------------------------------------------------------------------------

describe('illegal actions throw RunError and change nothing', () => {
  it('place: wrong phase, occupied, out of bounds, empty slot, reserve without type case', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      s.cells[idx(0, 0)] = 1;
      setTray(s, ['dot', null, 'o4']);
    });
    expectRejected(e, () => e.place(0, 0, 0));
    expectRejected(e, () => e.place(2, 7, 7));
    expectRejected(e, () => e.place(0, -1, 0));
    expectRejected(e, () => e.place(1, 3, 3));
    expectRejected(e, () => e.place(5, 3, 3));
    expectRejected(e, () => e.place('reserve', 3, 3));
    const offer = forceWin(e).engine;
    expectRejected(offer, () => offer.place(0, 3, 3));
  });

  it('sell: wrong phase or unknown plate', () => {
    const e = craft(start(), (s) => setPlates(s, ['proof']));
    expectRejected(e, () => e.sell(424242));
    const lost = craft(e, (s) => {
      s.phase = 'lost';
      s.lossReason = 'jam';
    });
    expectRejected(lost, () => lost.sell(plateUid(lost, 'proof')));
    lost.endRun();
    expectRejected(lost, () => lost.sell(plateUid(lost, 'proof')));
  });

  it('movePlate: bad slots or after the run is over', () => {
    const e = craft(start(), (s) => setPlates(s, ['proof', 'roller']));
    expectRejected(e, () => e.movePlate(0, 2));
    expectRejected(e, () => e.movePlate(-1, 0));
    expect(e.movePlate(1, 0)).toEqual([{ type: 'plate_moved', from: 1, to: 0 }]);
    expect(e.state.plates.map((p) => p.id)).toEqual(['roller', 'proof']);
    e.abandon();
    expectRejected(e, () => e.movePlate(0, 1));
  });

  it('acceptLoss / endRun / continueEndless outside their phase', () => {
    const e = start();
    expectRejected(e, () => e.acceptLoss());
    expectRejected(e, () => e.endRun());
    expectRejected(e, () => e.continueEndless());
    const o = atOffer();
    expectRejected(o, () => o.acceptLoss());
    expectRejected(o, () => o.endRun());
  });

  it('abandon records the current contract once and is idempotent', () => {
    const e = start();
    expect(e.abandon()).toEqual([{ type: 'run_over', won: false }]);
    expect(e.state.phase).toBe('over');
    expect(e.state.totals.history).toEqual([
      {
        index: 0,
        won: false,
        progress: 0,
        quota: e.state.contract.spec.quota,
        sheetsUsed: 0,
        dominantInk: null,
      },
    ]);
    expect(e.abandon()).toEqual([]);
    expect(e.state.totals.history).toHaveLength(1);
    // From an offer the won contract is already recorded.
    const o = forceWin(start()).engine;
    o.abandon();
    expect(o.state.totals.history).toHaveLength(1);
    expect(o.state.totals.history[0]?.won).toBe(true);
  });
});
