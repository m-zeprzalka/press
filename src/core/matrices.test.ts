/**
 * Plate catalogue (GDD §8): ids, rarities, starter pool, numbers (MX), params,
 * sell values, instances and lifecycle (growth) hooks.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from './config/balance';
import { INK_IDS } from './board';
import {
  MATRICES,
  MATRIX_IDS,
  MX,
  STARTER_MATRICES,
  createInstance,
  hasPrintingEffect,
  isMatrixId,
  matrixDef,
  sellValue,
  type MatrixId,
  type MatrixState,
  type PrintCtx,
  type Rarity,
} from './matrices';
import { ACHIEVEMENT_UNLOCKS } from './meta';

/** GDD §8.2 tables, column "Start/odbl.". */
const GDD_COMMON: MatrixId[] = [
  'ink_pink',
  'ink_orange',
  'ink_yellow',
  'ink_teal',
  'ink_blue',
  'proof',
  'guillotine',
  'roller',
  'margins',
  'petit',
  'poster',
  'ream',
  'numerator',
  'scrap',
  'first_impression',
];
const GDD_RARE_START: MatrixId[] = ['column_press', 'monotype', 'journeyman', 'archive', 'ink_well'];
const GDD_RARE_UNLOCK: MatrixId[] = [
  'registration',
  'crossmark',
  'type_case',
  'clean_sheet',
  'stencil',
  'momentum',
  'conveyor',
];
const GDD_LEGENDARY_START: MatrixId[] = ['gutenberg', 'hydraulic'];
const GDD_LEGENDARY_UNLOCK: MatrixId[] = ['golden_type', 'mirror', 'split_fountain'];
const GDD_STARTERS = [...GDD_COMMON, ...GDD_RARE_START, ...GDD_LEGENDARY_START];
/** GDD §10.2 "Odblokowuje" column. */
const GDD_UNLOCKS: MatrixId[] = [
  'crossmark',
  'registration',
  'split_fountain',
  'clean_sheet',
  'type_case',
  'mirror',
  'golden_type',
  'stencil',
  'conveyor',
  'momentum',
];

const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort();

function printCtx(over: Partial<PrintCtx> = {}): PrintCtx {
  return {
    lines: [{ kind: 'row', n: 0 }],
    lineCount: 1,
    rowCount: 1,
    colCount: 0,
    intersections: 0,
    inks: [0],
    lineInkCounts: [1],
    monoLines: 0,
    pieceSize: 4,
    streak: 1,
    sheetsLeft: 10,
    sheetsUsed: 10,
    printIndex: 0,
    boardCleanAfter: false,
    emptySlots: 0,
    ...over,
  };
}

describe('MATRIX_IDS / MATRICES', () => {
  it('has 32 unique ids: 15 common, 12 rare, 5 legendary (in that order)', () => {
    expect(MATRIX_IDS.length).toBe(32);
    expect(new Set(MATRIX_IDS).size).toBe(32);
    const rarities = MATRIX_IDS.map((id) => matrixDef(id).rarity);
    const count = (r: Rarity) => rarities.filter((x) => x === r).length;
    expect([count('common'), count('rare'), count('legendary')]).toEqual([15, 12, 5]);
    expect(rarities).toEqual([
      ...new Array<Rarity>(15).fill('common'),
      ...new Array<Rarity>(12).fill('rare'),
      ...new Array<Rarity>(5).fill('legendary'),
    ]);
  });

  it('rarities match GDD §8.2', () => {
    for (const id of GDD_COMMON) expect(matrixDef(id).rarity, id).toBe('common');
    for (const id of [...GDD_RARE_START, ...GDD_RARE_UNLOCK]) expect(matrixDef(id).rarity, id).toBe('rare');
    for (const id of [...GDD_LEGENDARY_START, ...GDD_LEGENDARY_UNLOCK])
      expect(matrixDef(id).rarity, id).toBe('legendary');
    expect(
      sorted([
        ...GDD_COMMON,
        ...GDD_RARE_START,
        ...GDD_RARE_UNLOCK,
        ...GDD_LEGENDARY_START,
        ...GDD_LEGENDARY_UNLOCK,
      ]),
    ).toEqual(sorted(MATRIX_IDS));
  });

  it('MATRICES holds exactly one def per id, keyed by its own id', () => {
    expect(MATRICES.size).toBe(32);
    expect([...MATRICES.keys()]).toEqual([...MATRIX_IDS]);
    for (const [key, def] of MATRICES) {
      expect(def.id).toBe(key);
      expect(matrixDef(key)).toBe(def);
      expect(def.tags.length).toBeGreaterThan(0);
      expect(typeof def.starter).toBe('boolean');
    }
  });

  it('matrixDef throws on an unknown id', () => {
    expect(() => matrixDef('nope' as MatrixId)).toThrow(/Unknown plate/);
  });
});

describe('starter pool (GDD §8.1, §8.2, §10.2)', () => {
  it('STARTER_MATRICES has exactly the 22 GDD starters', () => {
    expect(STARTER_MATRICES.length).toBe(22);
    expect(new Set(STARTER_MATRICES).size).toBe(22);
    expect(sorted(STARTER_MATRICES)).toEqual(sorted(GDD_STARTERS));
  });

  it('the 10 non-starters are exactly the achievement unlocks', () => {
    const locked = MATRIX_IDS.filter((id) => !STARTER_MATRICES.includes(id));
    expect(locked.length).toBe(10);
    expect(sorted(locked)).toEqual(sorted(GDD_UNLOCKS));
    // Every unlock is reachable via an achievement and none of them is already a starter.
    expect(sorted(Object.values(ACHIEVEMENT_UNLOCKS))).toEqual(sorted(GDD_UNLOCKS));
  });

  it('every common plate is a starter', () => {
    for (const id of MATRIX_IDS)
      if (matrixDef(id).rarity === 'common') expect(STARTER_MATRICES, id).toContain(id);
  });

  it('starter flag agrees with STARTER_MATRICES', () => {
    for (const id of MATRIX_IDS) expect(STARTER_MATRICES.includes(id), id).toBe(matrixDef(id).starter);
  });

  it('starter pool contains the complete builds promised in §8.4', () => {
    const builds: Record<string, MatrixId[]> = {
      mono: ['ink_pink', 'monotype', 'ink_well', 'petit'],
      bigPressWithoutCrossmark: ['roller', 'hydraulic', 'poster'],
      streak: ['numerator', 'petit'],
      scaling: ['journeyman', 'archive', 'gutenberg'],
      geometry: ['margins', 'column_press'],
    };
    for (const [name, ids] of Object.entries(builds))
      for (const id of ids) expect(STARTER_MATRICES, `${name}: ${id}`).toContain(id);
  });
});

describe('MX numbers (GDD §8.2)', () => {
  it('match the GDD tables', () => {
    expect(MX).toMatchObject({
      inkPrints: 20,
      proofMult: 3,
      guillotinePrints: 50,
      rollerMult: 6,
      marginsPrints: 120,
      petitMult: 5,
      petitMaxSize: 3,
      posterPrints: 120,
      posterMinSize: 5,
      reamSheets: 3,
      numeratorPerStreak: 1,
      scrapPerPlacement: 30,
      scrapMax: 300,
      firstImpressionX: 2,
      firstImpressionSheets: 8,
      columnPressX: 2,
      monotypeX: 2,
      registrationPerInk: 2,
      journeymanStart: 1,
      journeymanStep: 1,
      archiveStep: 1,
      crossmarkMult: 3,
      cleanSheetX: 4,
      cleanSheetMinLines: 2,
      stencilPerEmpty: 0.5,
      momentumPerStreak: 0.1,
      conveyorGrace: 1,
      conveyorCarry: 0.5,
      inkWellStep: 2,
      gutenbergStart: 1.5,
      gutenbergStep: 0.25,
      hydraulicX: 3,
      hydraulicMinLines: 3,
      goldenChance: 0.25,
      goldenX: 1.1,
      splitFountainX: 1.5,
      splitFountainMinInks: 3,
    });
    for (const v of Object.values(MX)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('params()', () => {
  const EXPECTED: Record<MatrixId, Record<string, number>> = {
    ink_pink: { n: 20 },
    ink_orange: { n: 20 },
    ink_yellow: { n: 20 },
    ink_teal: { n: 20 },
    ink_blue: { n: 20 },
    proof: { n: 3 },
    guillotine: { n: 50 },
    roller: { n: 6 },
    margins: { n: 120 },
    petit: { n: 5, size: 3 },
    poster: { n: 120, size: 5 },
    ream: { n: 3 },
    numerator: { n: 1 },
    scrap: { n: 30, max: 300, stored: 0 },
    first_impression: { x: 2, n: 8 },
    column_press: { x: 2 },
    monotype: { x: 2 },
    registration: { n: 2 },
    journeyman: { n: 1, step: 1 },
    archive: { n: 0, step: 1 },
    crossmark: { n: 3 },
    type_case: {},
    clean_sheet: { x: 4, n: 2 },
    stencil: { x: 0.5 },
    momentum: { x: 0.1 },
    conveyor: { n: 1, pct: 50 },
    ink_well: { n: 0, step: 2 },
    gutenberg: { x: 1.5, step: 0.25 },
    hydraulic: { x: 3, lines: 3 },
    golden_type: { n: 4, x: 1.1 },
    mirror: {},
    split_fountain: { x: 1.5, n: 3 },
  };

  it('fresh instances show the GDD numbers', () => {
    for (const id of MATRIX_IDS)
      expect(matrixDef(id).params(createInstance(id, 1).state), id).toEqual(EXPECTED[id]);
  });

  it('every plate returns finite numbers for fresh, empty and grown states', () => {
    const grown: MatrixState = { stored: 270, mult: 7, bonus: 42, x: 3.25 };
    for (const def of MATRICES.values()) {
      for (const st of [createInstance(def.id, 1).state, {}, grown]) {
        const p = def.params(st);
        for (const [k, v] of Object.entries(p)) {
          expect(typeof v, `${def.id}.${k}`).toBe('number');
          expect(Number.isFinite(v), `${def.id}.${k}`).toBe(true);
        }
      }
    }
  });

  it('stateful plates show their current counter', () => {
    expect(matrixDef('scrap').params({ stored: 90 })).toEqual({ n: 30, max: 300, stored: 90 });
    expect(matrixDef('journeyman').params({ mult: 4 })).toEqual({ n: 4, step: 1 });
    expect(matrixDef('archive').params({ bonus: 12 })).toEqual({ n: 12, step: 1 });
    expect(matrixDef('ink_well').params({ mult: 6 })).toEqual({ n: 6, step: 2 });
    expect(matrixDef('gutenberg').params({ x: 2.25 })).toEqual({ x: 2.25, step: 0.25 });
  });
});

describe('sellValue (GDD §9.2)', () => {
  it('common +1, rare +1, legendary +2, ream 0', () => {
    expect(BALANCE.sellSheets).toEqual({ common: 1, rare: 1, legendary: 2 });
    for (const id of MATRIX_IDS) {
      const expected = id === 'ream' ? 0 : { common: 1, rare: 1, legendary: 2 }[matrixDef(id).rarity];
      expect(sellValue(id), id).toBe(expected);
    }
    expect(sellValue('ream')).toBe(0);
    expect(sellValue('proof')).toBe(1);
    expect(sellValue('monotype')).toBe(1);
    expect(sellValue('mirror')).toBe(2);
  });
});

describe('createInstance / isMatrixId', () => {
  it('initialises counters from initState', () => {
    const states = Object.fromEntries(MATRIX_IDS.map((id) => [id, createInstance(id, 7).state]));
    expect(states.scrap).toEqual({ stored: 0 });
    expect(states.journeyman).toEqual({ mult: 1 });
    expect(states.archive).toEqual({ bonus: 0 });
    expect(states.ink_well).toEqual({ mult: 0 });
    expect(states.gutenberg).toEqual({ x: 1.5 });
    const stateful = ['scrap', 'journeyman', 'archive', 'ink_well', 'gutenberg'];
    for (const id of MATRIX_IDS) {
      if (!stateful.includes(id)) expect(states[id], id).toEqual({});
      expect(matrixDef(id).initState !== undefined, id).toBe(stateful.includes(id));
    }
  });

  it('keeps id and uid; every instance gets its own state object (sold plates come back reset)', () => {
    const a = createInstance('journeyman', 3);
    const b = createInstance('journeyman', 4);
    expect(a).toEqual({ id: 'journeyman', uid: 3, state: { mult: 1 } });
    expect(a.state).not.toBe(b.state);
    a.state.mult = 9;
    expect(createInstance('journeyman', 5).state).toEqual({ mult: 1 });
    const m = createInstance('mirror', 1);
    const n = createInstance('mirror', 2);
    expect(m.state).not.toBe(n.state);
  });

  it('isMatrixId accepts exactly the catalogue ids', () => {
    for (const id of MATRIX_IDS) expect(isMatrixId(id)).toBe(true);
    for (const v of [
      '',
      'Proof',
      'proof ',
      'ink',
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      42,
      null,
      undefined,
      {},
      ['proof'],
      true,
    ]) {
      expect(isMatrixId(v), String(v)).toBe(false);
    }
  });
});

describe('passive effects', () => {
  it('ink plates have their colour affinity (pink…blue)', () => {
    const inkPlates = INK_IDS.map((k) => `ink_${k}` as MatrixId);
    inkPlates.forEach((id, ink) => expect(matrixDef(id).inkAffinity).toBe(ink));
    for (const id of MATRIX_IDS)
      if (!inkPlates.includes(id)) expect(matrixDef(id).inkAffinity, id).toBeUndefined();
  });

  it('ream +3 sheets, type case reserve 1, conveyor +1 grace / 50% carry — and nobody else', () => {
    expect(matrixDef('ream').sheets).toBe(3);
    expect(matrixDef('type_case').reserve).toBe(1);
    expect(matrixDef('conveyor').streakGrace).toBe(1);
    expect(matrixDef('conveyor').streakCarry).toBe(0.5);
    for (const id of MATRIX_IDS) {
      const d = matrixDef(id);
      if (id !== 'ream') expect(d.sheets, id).toBeUndefined();
      if (id !== 'type_case') expect(d.reserve, id).toBeUndefined();
      if (id !== 'conveyor') {
        expect(d.streakGrace, id).toBeUndefined();
        expect(d.streakCarry, id).toBeUndefined();
      }
      if (id !== 'ream') expect(d.sellValue, id).toBeUndefined();
    }
  });

  it('hasPrintingEffect is false only for passive plates and Mirror', () => {
    const none = MATRIX_IDS.filter((id) => !hasPrintingEffect(matrixDef(id)));
    expect(sorted(none)).toEqual(['conveyor', 'mirror', 'ream', 'type_case']);
    // Passive plates have no scoring or lifecycle hooks at all.
    for (const id of none) {
      const d = matrixDef(id);
      expect(
        [d.cell, d.line, d.print, d.afterPrint, d.afterPlace, d.afterContract, d.onContractStart].every(
          (h) => h === undefined,
        ),
        id,
      ).toBe(true);
    }
  });
});

describe('lifecycle hooks (growth)', () => {
  it('scrap banks +30 per dry placement up to 300, pays out once, resets on contract start', () => {
    const d = matrixDef('scrap');
    const st = createInstance('scrap', 1).state;
    d.afterPlace?.(true, st);
    expect(st.stored).toBe(0);
    for (let k = 1; k <= 10; k++) {
      d.afterPlace?.(false, st);
      expect(st.stored).toBe(30 * k);
    }
    d.afterPlace?.(false, st);
    expect(st.stored).toBe(300);
    d.afterPlace?.(true, st);
    expect(st.stored).toBe(300);
    d.afterPrint?.(printCtx(), st);
    expect(st.stored).toBe(0);
    d.afterPlace?.(false, st);
    d.afterPlace?.(false, st);
    expect(st.stored).toBe(60);
    d.onContractStart?.(st);
    expect(st.stored).toBe(0);
    const empty: MatrixState = {};
    d.afterPlace?.(false, empty);
    expect(empty.stored).toBe(30);
  });

  it('archive grows by +1 per printed line', () => {
    const d = matrixDef('archive');
    const st = createInstance('archive', 1).state;
    d.afterPrint?.(printCtx({ lineCount: 3 }), st);
    expect(st.bonus).toBe(3);
    d.afterPrint?.(printCtx({ lineCount: 1 }), st);
    expect(st.bonus).toBe(4);
    const empty: MatrixState = {};
    d.afterPrint?.(printCtx({ lineCount: 2 }), empty);
    expect(empty.bonus).toBe(2);
  });

  it('ink well grows by +2 per monochrome line', () => {
    const d = matrixDef('ink_well');
    const st = createInstance('ink_well', 1).state;
    d.afterPrint?.(printCtx({ lineCount: 3, monoLines: 0 }), st);
    expect(st.mult).toBe(0);
    d.afterPrint?.(printCtx({ lineCount: 3, monoLines: 2 }), st);
    expect(st.mult).toBe(4);
    d.afterPrint?.(printCtx({ monoLines: 1 }), st);
    expect(st.mult).toBe(6);
  });

  it('journeyman +1 and gutenberg +0.25 after each won contract', () => {
    const j = matrixDef('journeyman');
    const g = matrixDef('gutenberg');
    const js = createInstance('journeyman', 1).state;
    const gs = createInstance('gutenberg', 2).state;
    const gExpected = [1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4];
    for (let k = 0; k < 10; k++) {
      j.afterContract?.(js);
      g.afterContract?.(gs);
      expect(js.mult).toBe(2 + k);
      expect(gs.x).toBe(gExpected[k]);
    }
    // Long endless runs stay on exact quarter steps.
    for (let k = 0; k < 90; k++) g.afterContract?.(gs);
    expect(gs.x).toBe(26.5);
    const je: MatrixState = {};
    const ge: MatrixState = {};
    j.afterContract?.(je);
    g.afterContract?.(ge);
    expect(je.mult).toBe(2);
    expect(ge.x).toBe(1.75);
  });

  it('only scrap, archive, ink well, journeyman and gutenberg have lifecycle hooks', () => {
    const withLifecycle = MATRIX_IDS.filter((id) => {
      const d = matrixDef(id);
      return Boolean(d.afterPrint || d.afterPlace || d.afterContract || d.onContractStart);
    });
    expect(sorted(withLifecycle)).toEqual(['archive', 'gutenberg', 'ink_well', 'journeyman', 'scrap']);
  });
});

describe('golden_type cell hook', () => {
  it('rolls only on the first pass of an ink cell', () => {
    const d = matrixDef('golden_type');
    let draws = 0;
    let retriggers = 0;
    const api = {
      prints: () => undefined,
      mult: () => undefined,
      xmult: () => undefined,
      linePrintsX: () => undefined,
      retrigger: () => {
        retriggers++;
      },
      random: () => {
        draws++;
        return 0;
      },
    };
    const base = { index: 0, value: 0, line: { kind: 'row' as const, n: 0 }, intersection: false };
    const tmp: MatrixState = {};
    d.cell?.(api, { ...base, ink: 0, again: false }, {}, tmp);
    d.cell?.(api, { ...base, ink: 0, again: true }, {}, tmp);
    d.cell?.(api, { ...base, value: 5, ink: null, again: false }, {}, tmp);
    expect([draws, retriggers, tmp.repeats]).toEqual([1, 1, 1]);
  });
});
