/**
 * Edge paths that normal play (and the per-module suites) never reach, each pinned to a
 * documented behaviour: clearing lines that are not full, deals on degenerate boards and
 * under a reduced node budget (GDD §4), plates fed empty or ink-less input (§8.2),
 * zero MULT contributions (§5), and run-engine guards (§6, §9). Fixed seeds only.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from './config/balance';
import {
  BLIND,
  EMPTY,
  JAM,
  LEAD,
  clearLines,
  clearRulesFor,
  idx,
  newCells,
  occupancy,
  type Cells,
} from './board';
import { placeAndClear, positions } from './bitboard';
import { DEAL_BUDGET, dealTray, type DealContext, type DealResult } from './generator';
import { MATRIX_IDS, MX, createInstance, matrixDef, type MatrixId, type MatrixState } from './matrices';
import { BOARD_SIZE, shapeById } from './pieces';
import { Rng } from './rng';
import { RunEngine, type OfferState, type RunState, type TrayPiece } from './run';
import { buildPrintCtx, scorePrint, type PrintInput, type SlotInput } from './scoring';

// ---------------------------------------------------------------------------
// Helpers

function row(cells: Cells, y: number, v: number): void {
  for (let x = 0; x < BOARD_SIZE; x++) cells[idx(x, y)] = v;
}

/** (x + y) even = filled: no full line, only dots fit, every dot fits. */
function checkerboard(): Cells {
  const cells = newCells();
  for (let y = 0; y < BOARD_SIZE; y++)
    for (let x = 0; x < BOARD_SIZE; x++) if ((x + y) % 2 === 0) cells[idx(x, y)] = 0;
  return cells;
}

function deal(cells: Cells, seed: string, extra: Partial<DealContext> = {}): DealResult {
  return dealTray({
    cells,
    count: 3,
    rng: Rng.fromSeed(seed),
    inkWeights: [1, 1, 1, 1, 1],
    blindInk: null,
    bigFormat: false,
    rowsOnly: false,
    ...extra,
  });
}

/** True when the pieces can all be placed in some order (with clears), as GDD §4 guarantees. */
function placeable(cells: Cells, pieces: DealResult['pieces'], rowsOnly = false): boolean {
  const rules = clearRulesFor(cells, rowsOnly);
  const shapes = pieces.map((p) => shapeById(p.shape));
  const go = (left: number[], r: Uint8Array): boolean => {
    if (left.length === 0) return true;
    return left.some((k) => {
      const shape = shapes[k] as (typeof shapes)[number];
      return positions(r, shape).some((p) => {
        const next = r.slice();
        placeAndClear(next, shape, p % BOARD_SIZE, (p / BOARD_SIZE) | 0, rules);
        return go(
          left.filter((j) => j !== k),
          next,
        );
      });
    });
  };
  return go(
    shapes.map((_, k) => k),
    occupancy(cells),
  );
}

function printInput(cells: Cells, rows: number[], slots: SlotInput[]): PrintInput {
  return {
    cells,
    lines: { rows, cols: [] },
    pieceSize: 1,
    streak: 0,
    sheetsLeft: 10,
    sheetsUsed: 1,
    printIndex: 0,
    slots,
    slotCapacity: BALANCE.slots,
    random: () => 0.99,
  };
}

function slot(id: MatrixId, state?: MatrixState): SlotInput {
  const inst = createInstance(id, 1);
  if (state) inst.state = state;
  return { inst, enabled: true };
}

function craft(e: RunEngine, fn: (s: RunState) => void): RunEngine {
  const s = e.snapshot();
  fn(s);
  return RunEngine.restore(s);
}

function setTray(s: RunState, shapes: readonly string[]): void {
  s.tray = [null, null, null];
  shapes.forEach((shape, i) => {
    const p: TrayPiece = { uid: s.nextUid++, shape, ink: 0 };
    s.tray[i] = p;
  });
}

// ---------------------------------------------------------------------------

describe('board.clearLines on lines that are not full', () => {
  it('empties only content cells; jams stay and empty cells are not reported', () => {
    const cells = newCells();
    for (let x = 0; x < 6; x++) cells[idx(x, 2)] = 1;
    cells[idx(6, 2)] = JAM; // (7,2) stays EMPTY
    cells[idx(4, 0)] = LEAD;
    cells[idx(4, 5)] = BLIND;
    const emptied = clearLines(cells, { rows: [2], cols: [4] });
    const want = [idx(4, 0), ...Array.from({ length: 6 }, (_, x) => idx(x, 2)), idx(4, 5)].sort(
      (a, b) => a - b,
    );
    expect(emptied).toEqual(want);
    expect(cells[idx(6, 2)]).toBe(JAM);
    expect(cells.filter((v) => v !== EMPTY)).toEqual([JAM]);
  });
});

describe('generator: degenerate boards and the per-deal node budget (GDD §4)', () => {
  it('a full forme whose every line is jammed still deals `count` dots via the fallback (never throws)', () => {
    const cells = newCells().fill(0);
    for (let k = 0; k < BOARD_SIZE; k++) cells[idx(k, k)] = JAM;
    const before = cells.slice();
    const res = deal(cells, 'full-forme', { inkWeights: [0, 0, 1, 0, 0], blindInk: 2 });
    expect(res.fallback).toBe(true);
    expect(res.attempts).toBe(BALANCE.dealRetries);
    expect(res.pieces).toEqual([
      { shape: 'dot', ink: BLIND },
      { shape: 'dot', ink: BLIND },
      { shape: 'dot', ink: BLIND },
    ]);
    expect(cells).toEqual(before);
  });

  it('dealBudget defaults to DEAL_BUDGET', () => {
    const cells = checkerboard();
    for (let k = 0; k < 20; k++) {
      expect(deal(cells, `default-${k}`, { dealBudget: DEAL_BUDGET })).toEqual(deal(cells, `default-${k}`));
    }
  });

  it('a spent budget skips the remaining attempts and goes straight to the constructive fallback', () => {
    const cells = newCells();
    const res = deal(cells, 'no-budget', { dealBudget: 0 });
    expect(res.fallback).toBe(true);
    expect(res.nodes).toBe(0);
    expect(res.pieces).toHaveLength(3);
    expect(placeable(cells, res.pieces)).toBe(true);
    // With the normal budget the same stream is accepted on the empty forme.
    expect(deal(cells, 'no-budget').fallback).toBe(false);
  });

  it('rejected attempts stop once their nodes use up the deal budget', () => {
    // On the checkerboard only dots fit, so a tray with any larger piece is rejected (1 node each).
    const cells = checkerboard();
    let budgetHits = 0;
    for (let k = 0; k < 40; k++) {
      const seed = `budget-${k}`;
      const full = deal(cells, seed);
      const capped = deal(cells, seed, { dealBudget: 3 });
      expect(capped.nodes).toBeLessThanOrEqual(3);
      for (const p of capped.pieces) expect(p.shape).toBe('dot');
      expect(placeable(cells, capped.pieces)).toBe(true);
      if (full.nodes > 3) {
        // The uncapped deal needed more search than the cap allows: the cap must cut it short.
        expect(capped.fallback).toBe(true);
        budgetHits++;
      } else {
        expect(capped).toEqual(full);
      }
    }
    expect(budgetHits).toBeGreaterThan(30);
  });

  it('never spends more nodes than the deal budget on random boards', () => {
    const rng = Rng.fromSeed('budget-property');
    for (let k = 0; k < 150; k++) {
      const cells = newCells();
      const density = 0.3 + rng.next() * 0.4;
      for (let i = 0; i < cells.length; i++) if (rng.next() < density) cells[i] = rng.int(5);
      for (let y = 0; y < BOARD_SIZE; y++)
        if (cells.slice(y * 8, y * 8 + 8).every((v) => v !== EMPTY)) cells[idx(rng.int(8), y)] = EMPTY;
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (Array.from({ length: 8 }, (_, y) => cells[idx(x, y)]).every((v) => v !== EMPTY))
          cells[idx(x, rng.int(8))] = EMPTY;
      }
      const budget = [1, 2, 5, 20, 100][k % 5] as number;
      const res = deal(cells, `prop-${k}`, { dealBudget: budget });
      expect(res.nodes).toBeLessThanOrEqual(budget);
      expect(placeable(cells, res.pieces)).toBe(true);
    }
  });
});

describe('plates fed edge input (GDD §8.2)', () => {
  it('Registration adds nothing when the printed lines hold no ink (blind and lead only)', () => {
    const cells = newCells();
    row(cells, 0, BLIND);
    cells[idx(3, 0)] = LEAD;
    const res = scorePrint(printInput(cells, [0], [slot('registration')]));
    expect(res.ctx.inks).toEqual([]);
    expect(res.prints).toBe(0);
    expect(res.mult).toBe(1); // lines only
    expect(res.total).toBe(0);
    expect(res.triggers).toEqual([0]);
    expect(res.events.some((e) => 'src' in e && e.src === 0)).toBe(false);
  });

  it('Ink Well grows from 0 when its state is empty', () => {
    const cells = newCells();
    row(cells, 0, 2);
    row(cells, 1, 4);
    const ctx = buildPrintCtx({
      cells,
      lines: { rows: [0, 1], cols: [] },
      pieceSize: 4,
      streak: 0,
      sheetsLeft: 5,
      sheetsUsed: 3,
      printIndex: 0,
      slotCapacity: BALANCE.slots,
      ownedSlots: 1,
    });
    expect(ctx.monoLines).toBe(2);
    const st: MatrixState = {};
    matrixDef('ink_well').afterPrint?.(ctx, st);
    expect(st).toEqual({ mult: 2 * MX.inkWellStep });
  });
});

describe('scoring: a zero MULT contribution is a no-op (GDD §5)', () => {
  it('adds no event and no trigger; a non-zero one does both', () => {
    const cells = newCells();
    for (let x = 0; x < BOARD_SIZE; x++) cells[idx(x, 0)] = x % 2; // two inks: no monochrome bonus
    const zero = scorePrint(printInput(cells, [0], [slot('journeyman', { mult: 0 })]));
    expect(zero.mult).toBe(1);
    expect(zero.triggers).toEqual([0]);
    expect(zero.events.filter((e) => e.t === 'm').map((e) => ('src' in e ? e.src : null))).toEqual(['lines']);

    const three = scorePrint(printInput(cells, [0], [slot('journeyman', { mult: 3 })]));
    expect(three.mult).toBe(4);
    expect(three.triggers).toEqual([1]);
    expect(three.total).toBe(zero.total * 4);
  });
});

describe('run engine guards (GDD §6, §9)', () => {
  const start = (opts: { startPlates?: readonly MatrixId[] } = {}) =>
    RunEngine.create({ seed: 'coverage-extra', ...opts }).engine;

  it('installs at most BALANCE.slots start plates, in the given order', () => {
    const ids = MATRIX_IDS.slice(0, BALANCE.slots + 2);
    const e = start({ startPlates: ids });
    expect(e.state.plates.map((p) => p.id)).toEqual(ids.slice(0, BALANCE.slots));
    expect(new Set(e.state.plates.map((p) => p.uid)).size).toBe(BALANCE.slots);
  });

  it('outside the playing phase nothing can be placed or previewed', () => {
    const e = craft(start(), (s) => {
      s.cells = newCells();
      setTray(s, ['dot']);
      s.phase = 'lost';
      s.lossReason = 'jam';
    });
    expect(e.canPlace(0, 0, 0)).toBe(false);
    expect(e.previewLines(0, 0, 0)).toBeNull();
    expect(e.validPositions(0)).toEqual([]);
  });

  it('an offer shrinks to what the pool still holds', () => {
    const offer = (): OfferState => ({
      index: 0,
      cards: [],
      cardCount: 3,
      guaranteeRare: true,
      rerolls: 0,
      adRerollsHere: 0,
    });
    const one = craft(start(), (s) => {
      s.pool = ['proof', 'roller'];
      s.plates = [createInstance('roller', s.nextUid++)];
    });
    expect(one.drawOffer(offer())).toEqual(['proof']);
    const none = craft(start(), (s) => {
      s.pool = ['roller'];
      s.plates = [createInstance('roller', s.nextUid++)];
    });
    expect(none.drawOffer(offer())).toEqual([]);
  });

  it('a reprint after a quota loss jams at once when the leftover tray cannot be placed', () => {
    const e = craft(start(), (s) => {
      s.cells = checkerboard();
      setTray(s, ['dot', 'o4']);
      s.plates = [];
      s.contract.sheetsLeft = 1;
    });
    e.place(0, 1, 0);
    expect(e.state.phase).toBe('lost');
    expect(e.state.lossReason).toBe('quota');
    const events = e.continueRun();
    expect(events.map((x) => x.type)).toEqual(['continued', 'lost']);
    expect(events[0]).toEqual({
      type: 'continued',
      reason: 'quota',
      clearedCells: [],
      sheets: BALANCE.continueSheets,
    });
    expect(events[1]).toEqual({ type: 'lost', reason: 'jam' });
    expect(e.state.contract.sheetsLeft).toBe(BALANCE.continueSheets);
    expect(e.state.lossReason).toBe('jam');
    expect(e.canContinue()).toBe(false);
  });
});
