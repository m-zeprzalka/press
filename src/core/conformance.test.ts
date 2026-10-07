/**
 * Adversarial GDD v1.1 conformance review (§3–§10, §18.4).
 *
 * The first block holds one regression test per finding of the review (each failed before
 * its fix in src/core). The second block pins rules and edge cases the review verified that
 * no other test file covers end to end. Every random choice comes from fixed seeds.
 */
import { describe, expect, it } from 'vitest';
import { BLIND, EMPTY, JAM, idx, newCells, type Cells } from './board';
import {
  compatible,
  editionModifiers,
  isSpecialIndex,
  quotaFor,
  totalContracts,
  type Modifier,
} from './contracts';
import { dealTray, type DealContext } from './generator';
import { STARTER_MATRICES, createInstance, matrixDef } from './matrices';
import { migrateMeta, newMeta, unlockedPool } from './meta';
import { BOARD_SIZE } from './pieces';
import { Rng } from './rng';
import { RunEngine, type OfferState, type RunEvent, type RunState } from './run';

// ---------------------------------------------------------------------------
// Helpers (scenarios are set up by restoring a modified snapshot, then acting via the API)

function craft(e: RunEngine, fn: (s: RunState) => void): RunEngine {
  const s = e.snapshot();
  fn(s);
  return RunEngine.restore(s);
}

function setTray(s: RunState, shapes: ReadonlyArray<string | null>, ink = 0): void {
  s.tray = [null, null, null];
  shapes.forEach((sh, i) => {
    s.tray[i] = sh === null ? null : { uid: s.nextUid++, shape: sh, ink };
  });
}

/** Progress quota − 1 and a dot that completes row 7: the next place(0, 7, 7) wins. */
function forceWin(e: RunEngine): { engine: RunEngine; events: RunEvent[] } {
  const engine = craft(e, (s) => {
    s.cells = newCells();
    for (let x = 0; x < 7; x++) s.cells[idx(x, 7)] = 0;
    setTray(s, ['dot', null, null]);
    s.contract.progress = s.contract.spec.quota - 1;
    s.contract.sheetsLeft = Math.max(s.contract.sheetsLeft, 1);
  });
  return { engine, events: engine.place(0, 7, 7) };
}

/** Wins (and skips the offer, or enters endless mode) until `index` is the current contract. */
function advanceTo(e: RunEngine, index: number): RunEngine {
  let cur = e;
  while (cur.state.contractIndex < index) {
    cur = forceWin(cur).engine;
    if (cur.state.phase === 'victory') cur.continueEndless();
    expect(cur.state.phase).toBe('offer');
    cur.skipOffer();
  }
  return cur;
}

const blankOffer = (index: number, cardCount: number, guaranteeRare: boolean): OfferState => ({
  index,
  cards: [],
  cardCount,
  guaranteeRare,
  rerolls: 0,
  adRerollsHere: 0,
});

const FLAT = [1, 1, 1, 1, 1] as const;
const outInk = (mods: readonly Modifier[]): number | undefined =>
  mods.find((m) => m.id === 'out_of_ink')?.ink;

/** First seed (deterministic search) whose edition `edition` special is exactly what `want` accepts. */
function seedWhere(prefix: string, want: (seed: string) => boolean): string {
  for (let k = 0; k < 5000; k++) if (want(`${prefix}-${k}`)) return `${prefix}-${k}`;
  throw new Error(`no seed for ${prefix}`);
}

// ---------------------------------------------------------------------------

describe('review findings (regressions)', () => {
  it('§7/D9: the next edition’s special rule is fixed when its offer shows it, not when someone first asks', () => {
    // Edition 4 has "out of ink"; with an empty rack the seed picks a colour other than blue,
    // so taking Fluo Blue at the offer would change the colour if it were decided later.
    const seed = seedWhere('conf-ooi', (s) => {
      const flat = outInk(editionModifiers(s, 4, FLAT));
      const blue = outInk(editionModifiers(s, 4, [1, 1, 1, 1, 2]));
      return flat !== undefined && blue !== undefined && flat !== blue;
    });
    const won = forceWin(advanceTo(RunEngine.create({ seed }).engine, 8)).engine;
    expect(won.state.phase).toBe('offer');
    expect(isSpecialIndex(won.state.contractIndex)).toBe(true);
    // Already part of the saved state while the offer is on screen (survives save → restore).
    expect(won.snapshot().editionModifiers['4']).toEqual(editionModifiers(seed, 4, FLAT));

    const atOffer = craft(
      won,
      (s) => ((s.offer as OfferState).cards = ['ink_blue', 'proof', 'roller']),
    ).snapshot();
    const asked = RunEngine.restore(atOffer);
    const shown = asked.specialFor(4);
    asked.takeOffer(0);
    const silent = RunEngine.restore(atOffer); // e.g. the bot, or a UI that never asks
    silent.takeOffer(0);
    expect(silent.inkWeights()).toEqual([1, 1, 1, 1, 2]);
    expect(silent.state.editionModifiers['4']).toEqual(shown);
    expect(asked.state.editionModifiers['4']).toEqual(shown);
    expect(outInk(shown)).toBe(outInk(editionModifiers(seed, 4, FLAT)));
  });

  it('§7/D9: winning job 24 reveals edition 9 for the endless offer the same way', () => {
    const won = forceWin(
      advanceTo(RunEngine.create({ seed: 'conf-e9' }).engine, totalContracts() - 1),
    ).engine;
    expect(won.state.phase).toBe('victory');
    expect(won.snapshot().editionModifiers['9']).toEqual(editionModifiers('conf-e9', 9, FLAT));
  });

  it('§18.4: offers depend on which plates are unlocked, never on the order they were unlocked', () => {
    const a = newMeta();
    a.unlocked = ['mirror', 'crossmark', 'stencil'];
    const b = newMeta();
    b.unlocked = ['stencil', 'crossmark', 'mirror'];
    const c = migrateMeta({ unlocked: ['crossmark', 'mirror', 'stencil'] });
    expect(unlockedPool(b)).toEqual(unlockedPool(a));
    expect(unlockedPool(c)).toEqual(unlockedPool(a));
    // New players keep the exact starter order (nothing changes for runs without unlocks).
    expect(unlockedPool(newMeta())).toEqual([...STARTER_MATRICES]);

    const ea = RunEngine.create({ seed: 'conf-pool', pool: unlockedPool(a) }).engine;
    const eb = RunEngine.create({ seed: 'conf-pool', pool: unlockedPool(b) }).engine;
    for (let i = 0; i < 60; i++)
      expect(eb.drawOffer(blankOffer(i, 4, i % 2 === 0))).toEqual(
        ea.drawOffer(blankOffer(i, 4, i % 2 === 0)),
      );
  });

  it('§6.3: the rare-or-better guarantee takes a legendary when every rare of the pool is owned', () => {
    const rares = STARTER_MATRICES.filter((id) => matrixDef(id).rarity === 'rare');
    expect(rares).toHaveLength(5); // exactly a full rack
    const e = craft(RunEngine.create({ seed: 'conf-rare', pool: [...STARTER_MATRICES] }).engine, (s) => {
      s.plates = rares.map((id) => createInstance(id, s.nextUid++));
    });
    for (let i = 0; i < 300; i++) {
      const cards = e.drawOffer(blankOffer(i, 4, true));
      expect(cards, `offer ${i}`).toHaveLength(4);
      expect(
        cards.some((id) => matrixDef(id).rarity !== 'common'),
        `offer ${i}: ${cards.join(',')}`,
      ).toBe(true);
    }
    // Ordinary draws still only fall *down* (§8.1): a rolled rare becomes a common, so legendaries
    // stay near their own 6% share instead of absorbing the 30% rare weight.
    let legendary = 0;
    for (let i = 0; i < 300; i++)
      legendary += e
        .drawOffer(blankOffer(i, 3, false))
        .filter((id) => matrixDef(id).rarity === 'legendary').length;
    expect(legendary / 900).toBeLessThan(0.16);
  });

  it('§18.4 tray stream: shapes first, then colours — also in the constructive fallback', () => {
    class SpyRng extends Rng {
      calls: Array<'shape' | 'ink' | 'pick'> = [];
      inks: readonly number[] = [];
      override weightedIndex(weights: readonly number[]): number {
        this.calls.push(weights === this.inks ? 'ink' : 'shape');
        return super.weightedIndex(weights);
      }
      override pick<T>(items: readonly T[]): T {
        this.calls.push('pick');
        return super.pick(items);
      }
    }
    // Checkerboard holes: only dots fit and three dots never print, so trays need the fallback.
    const hard: Cells = newCells().fill(1);
    for (let y = 0; y < BOARD_SIZE; y++)
      for (let x = 0; x < BOARD_SIZE; x++) if ((x + y) % 2 === 0) hard[idx(x, y)] = EMPTY;
    const inkWeights = [1, 2, 1, 1, 1];
    let fallbacks = 0;
    for (const [cells, label] of [
      [hard, 'hard'],
      [newCells(), 'empty'],
    ] as const) {
      for (let t = 0; t < 8; t++) {
        const rng = new SpyRng(Rng.fromSeed(`conf-order|${label}|${t}`).getState());
        rng.inks = inkWeights;
        const ctx: DealContext = {
          cells,
          count: 3,
          rng,
          inkWeights,
          blindInk: null,
          bigFormat: false,
          rowsOnly: false,
        };
        const res = dealTray(ctx);
        if (res.fallback) fallbacks++;
        const first = rng.calls.indexOf('ink');
        expect(rng.calls.filter((c) => c === 'ink')).toHaveLength(3);
        expect(rng.calls.slice(first), `${label} ${t}: ${rng.calls.join(' ')}`).toEqual([
          'ink',
          'ink',
          'ink',
        ]);
      }
    }
    expect(fallbacks).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('verified rules and edge cases', () => {
  /** Rows 0..k−1 full except column 7 (two alternating inks: never monochrome); slot 0 closes them all. */
  function printLines(e: RunEngine, k: 1 | 2 | 4): RunEngine {
    const next = craft(e, (s) => {
      s.cells = newCells();
      for (let y = 0; y < k; y++) for (let x = 0; x < 7; x++) s.cells[idx(x, y)] = x % 2;
      setTray(s, [{ 1: 'dot', 2: 'i2v', 4: 'i4v' }[k], null, null], 2);
      s.contract.spec.quota = 1e12;
      s.contract.sheetsLeft = Math.max(s.contract.sheetsLeft, 2);
    });
    next.place(0, 7, 0);
    return next;
  }

  it('§5.3 (D6): 8 singles 2 880 < 4 doubles 3 840 < 2 quads 5 760, through the engine', () => {
    const total = (k: 1 | 2 | 4, n: number): number => {
      let e = RunEngine.create({ seed: 'conf-d6' }).engine;
      for (let i = 0; i < n; i++) e = printLines(e, k);
      expect(e.state.contract.streak).toBe(k * n);
      return e.state.contract.progress;
    };
    expect([total(1, 8), total(2, 4), total(4, 2)]).toEqual([2880, 3840, 5760]);
  });

  it('§6.1/§7: endless jobs 25–42 keep the curve, 2 compatible modifiers per special and never crash', () => {
    let e = advanceTo(RunEngine.create({ seed: 'conf-endless' }).engine, 24);
    expect(e.state.endless).toBe(true);
    let lastRegular: number | null = null;
    for (let j = 24; j < 42; j++) {
      const spec = e.state.contract.spec;
      expect(spec.index).toBe(j);
      expect(spec.quota).toBe(quotaFor(j, spec.modifiers));
      if (spec.special) {
        expect(spec.modifiers).toHaveLength(2);
        const [m1, m2] = spec.modifiers as [Modifier, Modifier];
        expect(compatible(m1.id, m2.id)).toBe(true);
        if (spec.modifiers.some((m) => m.id === 'jam'))
          expect(e.state.cells.filter((v) => v === JAM)).toHaveLength(4);
      } else {
        if (lastRegular !== null && !isSpecialIndex(j - 1))
          expect(spec.quota / lastRegular).toBeGreaterThanOrEqual(1.15);
        lastRegular = spec.quota;
      }
      expect(e.anyMoveAvailable()).toBe(true);
      e = advanceTo(e, j + 1);
    }
    expect(e.state.totals.contractsWon).toBe(42);
  });

  it('§7 out_of_ink with an empty rack: the seed picks the colour and it is only ever dealt blind', () => {
    const seed = seedWhere('conf-blind', (s) => outInk(editionModifiers(s, 3, FLAT)) !== undefined);
    let e = advanceTo(RunEngine.create({ seed }).engine, 8);
    const ink = outInk(e.spec.modifiers);
    expect(ink).toBe(outInk(editionModifiers(seed, 3, FLAT)));
    e = craft(e, (s) => (s.contract.spec.quota = 1e12));
    let blind = 0;
    let dealt = 0;
    for (let step = 0; step < 60 && e.state.phase === 'playing'; step++) {
      for (const p of e.state.tray) {
        if (!p) continue;
        expect(p.ink).not.toBe(ink);
        if (p.ink === BLIND) blind++;
      }
      const slot = ([0, 1, 2] as const).find((k) => e.validPositions(k).length > 0);
      if (slot === undefined) break;
      const events = e.place(slot, ...(e.validPositions(slot)[0] as [number, number]));
      dealt += events.filter((ev) => ev.type === 'dealt').length;
      if (e.state.cells.filter((v) => v !== EMPTY).length > 40) e = craft(e, (s) => (s.cells = newCells()));
    }
    expect(dealt).toBeGreaterThan(3);
    expect(blind).toBeGreaterThan(0);
  });

  it('§7 failure with a one-plate rack disables that plate; prints still score the base', () => {
    const seed = seedWhere('conf-fail', (s) => editionModifiers(s, 3, FLAT).some((m) => m.id === 'failure'));
    const won = forceWin(advanceTo(RunEngine.create({ seed }).engine, 7)).engine;
    const e = craft(won, (s) => ((s.offer as OfferState).cards = ['proof']));
    e.takeOffer(0);
    expect(e.state.contractIndex).toBe(8);
    const proof = e.state.plates[0];
    expect(e.state.contract.disabledUid).toBe(proof?.uid);
    expect(e.enabledPlates()).toEqual([]);
    const printed = printLines(e, 1);
    // One mixed line, SERIA 1: 80 prints × MULT 1 (Proof's +3 does not apply).
    expect(printed.state.contract.progress).toBe(80);
  });

  it('§18.4: core code never reads the clock or an unseeded random source', () => {
    const sources = import.meta.glob(['./*.ts', './config/*.ts', '!./*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    for (const [file, src] of Object.entries(sources)) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/Date\.now|new Date\(\s*\)|performance\.|crypto\.|Math\.random/);
    }
  });
});
