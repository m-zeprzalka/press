import { describe, expect, it } from 'vitest';
import { BALANCE } from './config/balance';
import { EMPTY, JAM, LEAD, findFullLines, idx, type Cells } from './board';
import { BOARD_SIZE } from './pieces';
import { ipow, niceRound } from './math';
import {
  MODIFIER_IDS,
  MODIFIER_MIN_EDITION,
  baseQuota,
  compatible,
  contractBoard,
  contractSpec,
  editionModifiers,
  editionOf,
  hasModifier,
  isSpecialIndex,
  modifierCount,
  positionOf,
  quotaFor,
  totalContracts,
  type Modifier,
  type ModifierId,
} from './contracts';

const EQUAL_INKS = [1, 1, 1, 1, 1] as const;
const mods = (...ids: ModifierId[]): Modifier[] => ids.map((id) => ({ id }));
const specialIndexOf = (edition: number): number => (edition - 1) * BALANCE.contractsPerEdition + 2;
const regularIndices = (n: number): number[] =>
  Array.from({ length: n }, (_, j) => j).filter((j) => !isSpecialIndex(j));

/** GDD §7 exclusion list. */
const GDD_INCOMPATIBLE: ReadonlyArray<readonly [ModifierId, ModifierId]> = [
  ['rush', 'short_tray'],
  ['big_format', 'short_tray'],
  ['jam', 'leftover'],
  ['wet_ink', 'rush'],
  ['jam', 'rows_only'],
];
const gddIncompatible = (a: ModifierId, b: ModifierId): boolean =>
  GDD_INCOMPATIBLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Q(j) = round2(400 × 1.30^j), GDD §6.2, j = 0..23. */
const GDD_QUOTA_CURVE = [
  400, 520, 680, 880, 1100, 1500, 1900, 2500, 3300, 4200, 5500, 7200, 9300, 12000, 16000, 20000, 27000, 35000,
  45000, 58000, 76000, 99000, 130000, 170000,
];

function positions(cells: Cells, value: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < cells.length; i++)
    if (cells[i] === value) out.push([i % BOARD_SIZE, (i / BOARD_SIZE) | 0]);
  return out;
}

function lineCounts(ps: ReadonlyArray<readonly [number, number]>): { rows: number[]; cols: number[] } {
  const rows = new Array<number>(BOARD_SIZE).fill(0);
  const cols = new Array<number>(BOARD_SIZE).fill(0);
  for (const [x, y] of ps) {
    rows[y] = (rows[y] as number) + 1;
    cols[x] = (cols[x] as number) + 1;
  }
  return { rows, cols };
}

describe('balance tables match the GDD (§6.1, §6.2, §7)', () => {
  it('run structure and quota curve parameters', () => {
    expect(BALANCE.editions).toBe(8);
    expect(BALANCE.contractsPerEdition).toBe(3);
    expect(totalContracts()).toBe(24);
    expect(BALANCE.quotaStart).toBe(400);
    expect(BALANCE.quotaGrowth).toBe(1.3);
    expect(BALANCE.baseSheets).toBe(20);
    expect(BALANCE.rushSheets).toBe(14);
    expect(BALANCE.doubleModifierFromEdition).toBe(7);
  });

  it('modifier list, minimum editions and quota factors', () => {
    expect([...MODIFIER_IDS].sort()).toEqual(
      [
        'big_format',
        'failure',
        'jam',
        'leftover',
        'out_of_ink',
        'rows_only',
        'rush',
        'short_tray',
        'wet_ink',
      ].sort(),
    );
    expect(MODIFIER_MIN_EDITION).toEqual({
      rush: 1,
      big_format: 1,
      jam: 1,
      wet_ink: 3,
      out_of_ink: 3,
      leftover: 3,
      failure: 3,
      short_tray: 3,
      rows_only: 5,
    });
    expect(BALANCE.modifierQuota).toEqual({
      rush: 0.8,
      big_format: 1.0,
      jam: 0.85,
      wet_ink: 0.8,
      out_of_ink: 0.85,
      leftover: 0.9,
      failure: 0.9,
      short_tray: 0.9,
      rows_only: 0.75,
    });
  });
});

describe('edition / position math', () => {
  it('maps global indices to 1-based editions and 0-based positions', () => {
    for (let j = 0; j < 90; j++) {
      expect(editionOf(j)).toBe(Math.floor(j / 3) + 1);
      expect(positionOf(j)).toBe(j % 3);
      expect(isSpecialIndex(j)).toBe(j % 3 === 2);
    }
    expect(editionOf(0)).toBe(1);
    expect(editionOf(2)).toBe(1);
    expect(editionOf(3)).toBe(2);
    expect(editionOf(23)).toBe(8);
    expect(editionOf(24)).toBe(9); // endless mode continues the numbering
  });

  it('the special job is job 3 of every edition (8 specials in a standard run)', () => {
    const specials = Array.from({ length: totalContracts() }, (_, j) => j).filter(isSpecialIndex);
    expect(specials).toEqual([2, 5, 8, 11, 14, 17, 20, 23]);
    expect(specials.map(editionOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('modifierCount: 1 before edition 7, 2 from edition 7 on (endless included)', () => {
    for (let e = 1; e <= 6; e++) expect(modifierCount(e)).toBe(1);
    for (let e = 7; e <= 40; e++) expect(modifierCount(e)).toBe(2);
  });
});

describe('compatible', () => {
  it('rejects exactly the GDD §7 exclusions and duplicates, symmetrically', () => {
    let compatiblePairs = 0;
    for (const a of MODIFIER_IDS) {
      expect(compatible(a, a)).toBe(false);
      for (const b of MODIFIER_IDS) {
        if (a === b) continue;
        expect(compatible(a, b), `${a}+${b}`).toBe(!gddIncompatible(a, b));
        expect(compatible(a, b)).toBe(compatible(b, a));
        if (a < b && compatible(a, b)) compatiblePairs++;
      }
    }
    expect(compatiblePairs).toBe(36 - 5);
  });
});

describe('quota curve (GDD §6.2)', () => {
  it('Q(j) = round2(400 × 1.30^j) for j = 0..23', () => {
    for (let j = 0; j < 24; j++) {
      expect(niceRound(baseQuota(j))).toBe(GDD_QUOTA_CURVE[j]);
      if (!isSpecialIndex(j)) expect(quotaFor(j, [])).toBe(GDD_QUOTA_CURVE[j]);
    }
  });

  it('baseQuota is computed by iterated multiplication (deterministic)', () => {
    for (let j = 0; j < 60; j++) {
      expect(baseQuota(j)).toBe(BALANCE.quotaStart * ipow(BALANCE.quotaGrowth, j));
    }
    expect(baseQuota(0)).toBe(400);
    expect(baseQuota(1)).toBe(400 * 1.3);
  });

  it('the rounded curve is strictly increasing with Q(j+1)/Q(j) ≥ 1.15 for every j', () => {
    for (let j = 0; j + 1 < 24; j++) {
      const a = niceRound(baseQuota(j));
      const b = niceRound(baseQuota(j + 1));
      expect(b, `j=${j}`).toBeGreaterThan(a);
      expect(b / a, `j=${j}`).toBeGreaterThanOrEqual(1.15);
    }
  });

  it('invariant: consecutive regular jobs grow by ≥ 1.15 (adjacent and across a special)', () => {
    const reg = regularIndices(24);
    expect(reg).toHaveLength(16);
    for (let k = 0; k + 1 < reg.length; k++) {
      const j0 = reg[k] as number;
      const j1 = reg[k + 1] as number;
      const q0 = contractSpec(j0, []).quota;
      const q1 = contractSpec(j1, []).quota;
      expect(q1, `${j0}->${j1}`).toBeGreaterThan(q0);
      expect(q1 / q0, `${j0}->${j1}`).toBeGreaterThanOrEqual(1.15);
    }
  });

  it('contractSpec strips modifiers from regular jobs before computing the quota', () => {
    // quotaFor applies whatever modifiers it is given; contractSpec strips them from regular jobs.
    expect(contractSpec(0, mods('rush')).quota).toBe(400);
    expect(contractSpec(1, mods('rows_only', 'jam')).quota).toBe(520);
  });

  it('special jobs apply specialFactor × Π per-modifier factors, rounded once', () => {
    const combos: ModifierId[][] = [[], ...MODIFIER_IDS.map((m) => [m])];
    for (const a of MODIFIER_IDS)
      for (const b of MODIFIER_IDS) if (a < b && compatible(a, b)) combos.push([a, b]);
    for (let e = 1; e <= 12; e++) {
      const j = specialIndexOf(e);
      for (const c of combos) {
        let raw = baseQuota(j) * BALANCE.specialFactor;
        for (const m of c) raw *= BALANCE.modifierQuota[m];
        const q = quotaFor(j, mods(...c));
        expect(q, `j=${j} ${c.join('+')}`).toBe(niceRound(raw));
        expect(contractSpec(j, mods(...c)).quota).toBe(q);
      }
    }
  });

  it('special quotas: concrete values', () => {
    expect(quotaFor(2, [])).toBe(niceRound(676 * BALANCE.specialFactor));
    expect(quotaFor(2, mods('big_format'))).toBe(680); // k = 1.00
    expect(quotaFor(2, mods('rows_only'))).toBe(510); // 676 × 0.75 = 507
    expect(quotaFor(2, mods('rush'))).toBe(540); // 676 × 0.80 = 540.8
    expect(quotaFor(20, mods('rush', 'jam'))).toBe(52000); // 76019.6 × 0.8 × 0.85 = 51693
    expect(quotaFor(23, mods('rows_only', 'wet_ink'))).toBe(100000); // 167015 × 0.6 = 100209
  });

  it('modifier factors < 1 never raise a special above its unmodified quota', () => {
    for (let e = 1; e <= 8; e++) {
      const j = specialIndexOf(e);
      const plain = quotaFor(j, []);
      for (const m of MODIFIER_IDS) expect(quotaFor(j, mods(m))).toBeLessThanOrEqual(plain);
    }
  });

  it('endless mode keeps growing ×1.30 per job', () => {
    for (let j = 24; j < 120; j++) {
      // 400 × (1.3^j) vs (400 × 1.3^(j-1)) × 1.3 may differ in the last ulp (float associativity).
      expect(baseQuota(j) / baseQuota(j - 1)).toBeCloseTo(BALANCE.quotaGrowth, 12);
    }
    expect(quotaFor(24, [])).toBe(220000);
    expect(quotaFor(25, [])).toBe(280000);
    expect(quotaFor(27, [])).toBe(480000);
    const reg = regularIndices(150).filter((j) => j >= 23);
    for (let k = 0; k + 1 < reg.length; k++) {
      const q0 = contractSpec(reg[k] as number, []).quota;
      const q1 = contractSpec(reg[k + 1] as number, []).quota;
      expect(q1 / q0).toBeGreaterThanOrEqual(1.15);
    }
  });

  it('every quota is a nice number (multiple of 10, ≤ 2 significant digits)', () => {
    for (let j = 0; j < 60; j++) {
      const q = quotaFor(j, isSpecialIndex(j) ? mods('jam') : []);
      expect(q % 10).toBe(0);
      expect(niceRound(q)).toBe(q);
    }
  });
});

describe('editionModifiers (GDD §7, §18.4 stream "modifiers")', () => {
  const SEEDS = Array.from({ length: 1500 }, (_, i) => `seed-${i}`);

  it('is deterministic per (seed, edition)', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      for (let e = 1; e <= 10; e++) {
        expect(editionModifiers(seed, e, EQUAL_INKS)).toEqual(editionModifiers(seed, e, EQUAL_INKS));
      }
    }
  });

  it('varies with seed and edition', () => {
    const bySeed = new Set(
      SEEDS.slice(0, 200).map((s) => JSON.stringify(editionModifiers(s, 7, EQUAL_INKS))),
    );
    expect(bySeed.size).toBeGreaterThan(10);
    const byEdition = new Set(
      Array.from({ length: 30 }, (_, e) => JSON.stringify(editionModifiers('PRESS', e + 7, EQUAL_INKS))),
    );
    expect(byEdition.size).toBeGreaterThan(5);
  });

  it('picks 1 modifier before edition 7 and 2 from edition 7 on', () => {
    for (const seed of SEEDS.slice(0, 300)) {
      for (let e = 1; e <= 6; e++) expect(editionModifiers(seed, e, EQUAL_INKS)).toHaveLength(1);
      for (let e = 7; e <= 14; e++) expect(editionModifiers(seed, e, EQUAL_INKS)).toHaveLength(2);
    }
  });

  it('respects MODIFIER_MIN_EDITION and can reach every eligible modifier', () => {
    for (let e = 1; e <= 8; e++) {
      const eligible = MODIFIER_IDS.filter((m) => MODIFIER_MIN_EDITION[m] <= e);
      const seen = new Set<ModifierId>();
      for (const seed of SEEDS) {
        for (const m of editionModifiers(seed, e, EQUAL_INKS)) {
          expect(MODIFIER_MIN_EDITION[m.id], `${m.id} in edition ${e}`).toBeLessThanOrEqual(e);
          seen.add(m.id);
        }
      }
      expect([...seen].sort(), `edition ${e}`).toEqual([...eligible].sort());
    }
  });

  it('edition 1–2 only draw rush / big_format / jam; rows_only only from edition 5', () => {
    for (const seed of SEEDS) {
      for (const e of [1, 2]) {
        for (const m of editionModifiers(seed, e, EQUAL_INKS))
          expect(['rush', 'big_format', 'jam']).toContain(m.id);
      }
      for (const e of [3, 4]) {
        for (const m of editionModifiers(seed, e, EQUAL_INKS)) expect(m.id).not.toBe('rows_only');
      }
    }
  });

  it('never yields an incompatible pair or a duplicate; every compatible pair is reachable', () => {
    const pairs = new Set<string>();
    for (const seed of SEEDS) {
      for (let e = 7; e <= 10; e++) {
        const ms = editionModifiers(seed, e, EQUAL_INKS);
        const [a, b] = ms.map((m) => m.id) as [ModifierId, ModifierId];
        expect(a).not.toBe(b);
        expect(gddIncompatible(a, b), `${seed} e${e}: ${a}+${b}`).toBe(false);
        pairs.add([a, b].sort().join('+'));
      }
    }
    expect(pairs.size).toBe(31);
  });

  it('only out_of_ink carries an ink, always in 0..4', () => {
    for (const seed of SEEDS) {
      for (let e = 1; e <= 9; e++) {
        for (const m of editionModifiers(seed, e, EQUAL_INKS)) {
          if (m.id === 'out_of_ink') {
            expect(Number.isInteger(m.ink)).toBe(true);
            expect(m.ink).toBeGreaterThanOrEqual(0);
            expect(m.ink).toBeLessThanOrEqual(4);
          } else {
            expect(m.ink).toBeUndefined();
          }
        }
      }
    }
  });

  /** (seed, edition) pairs whose special job is out_of_ink. */
  const outOfInkCases: Array<[string, number]> = [];
  for (const seed of SEEDS) {
    for (let e = 3; e <= 9; e++) {
      if (editionModifiers(seed, e, EQUAL_INKS).some((m) => m.id === 'out_of_ink'))
        outOfInkCases.push([seed, e]);
    }
  }
  const inkOf = (seed: string, e: number, w: readonly number[]): number | undefined =>
    editionModifiers(seed, e, w).find((m) => m.id === 'out_of_ink')?.ink;

  it('has enough out_of_ink samples to test', () => {
    expect(outOfInkCases.length).toBeGreaterThan(300);
  });

  it('out_of_ink picks the heaviest ink', () => {
    for (const [seed, e] of outOfInkCases) {
      for (let k = 0; k < 5; k++) {
        const w = [1, 1, 1, 1, 1];
        w[k] = 2;
        expect(inkOf(seed, e, w)).toBe(k);
      }
      expect(inkOf(seed, e, [1, 3, 2, 1, 1])).toBe(1);
      expect(inkOf(seed, e, [1, 2, 1, 4, 3])).toBe(3);
      expect(inkOf(seed, e, [0, 0, 0, 0, 0.5])).toBe(4);
    }
  });

  it('out_of_ink breaks ties among the heaviest inks with the seed', () => {
    const tiedPair = new Set<number>();
    const allEqual = new Set<number>();
    for (const [seed, e] of outOfInkCases) {
      const t = inkOf(seed, e, [1, 3, 1, 3, 1]);
      expect([1, 3]).toContain(t);
      tiedPair.add(t as number);
      const t3 = inkOf(seed, e, [2, 1, 2, 1, 2]);
      expect([0, 2, 4]).toContain(t3);
      allEqual.add(inkOf(seed, e, EQUAL_INKS) as number);
      // deterministic
      expect(inkOf(seed, e, [1, 3, 1, 3, 1])).toBe(t);
    }
    expect([...tiedPair].sort()).toEqual([1, 3]);
    expect([...allEqual].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('the tie-break is a fixed per-(seed, edition) ink order (consistent across weight vectors)', () => {
    for (const [seed, e] of outOfInkCases.slice(0, 100)) {
      const first = inkOf(seed, e, EQUAL_INKS) as number;
      // If the first-in-order ink is among the tied heaviest, it must win.
      for (let other = 0; other < 5; other++) {
        if (other === first) continue;
        const w = [0, 0, 0, 0, 0];
        w[first] = 5;
        w[other] = 5;
        expect(inkOf(seed, e, w)).toBe(first);
      }
    }
  });

  it('ink weights change only the out_of_ink ink, never which modifiers are drawn', () => {
    for (const seed of SEEDS.slice(0, 300)) {
      for (let e = 1; e <= 9; e++) {
        const a = editionModifiers(seed, e, EQUAL_INKS).map((m) => m.id);
        const b = editionModifiers(seed, e, [5, 0, 2, 9, 1]).map((m) => m.id);
        expect(b).toEqual(a);
      }
    }
  });

  it('tolerates a short ink weight vector (missing inks weigh 0)', () => {
    for (const [seed, e] of outOfInkCases.slice(0, 50)) {
      expect(inkOf(seed, e, [0, 0, 7])).toBe(2);
      const ink = inkOf(seed, e, []);
      expect(ink).toBeGreaterThanOrEqual(0);
      expect(ink).toBeLessThanOrEqual(4);
    }
  });
});

describe('contractSpec', () => {
  it('fills index, edition, position and special flags', () => {
    for (let j = 0; j < 40; j++) {
      const s = contractSpec(j, mods('jam'));
      expect(s.index).toBe(j);
      expect(s.edition).toBe(editionOf(j));
      expect(s.position).toBe(positionOf(j));
      expect(s.special).toBe(isSpecialIndex(j));
    }
  });

  it('regular jobs never carry modifiers and always have base sheets', () => {
    for (const j of regularIndices(60)) {
      for (const m of MODIFIER_IDS) {
        const s = contractSpec(j, mods(m));
        expect(s.special).toBe(false);
        expect(s.modifiers).toEqual([]);
        expect(s.sheets).toBe(BALANCE.baseSheets);
        expect(s.quota).toBe(niceRound(baseQuota(j)));
      }
    }
  });

  it('rush → 14 sheets, every other modifier → 20 sheets', () => {
    for (let e = 1; e <= 10; e++) {
      const j = specialIndexOf(e);
      expect(contractSpec(j, mods('rush')).sheets).toBe(14);
      expect(contractSpec(j, mods('rush', 'jam')).sheets).toBe(14);
      expect(contractSpec(j, mods('jam', 'rush')).sheets).toBe(14);
      expect(contractSpec(j, []).sheets).toBe(20);
      for (const m of MODIFIER_IDS) if (m !== 'rush') expect(contractSpec(j, mods(m)).sheets).toBe(20);
    }
  });

  it('special jobs keep their modifiers (copied, including the out_of_ink ink)', () => {
    const input: Modifier[] = [{ id: 'out_of_ink', ink: 3 }, { id: 'rows_only' }];
    const s = contractSpec(20, input);
    expect(s.modifiers).toEqual(input);
    expect(s.modifiers).not.toBe(input);
    input.push({ id: 'jam' });
    expect(s.modifiers).toHaveLength(2);
    expect(hasModifier(s, 'out_of_ink')).toBe(true);
    expect(hasModifier(s, 'rows_only')).toBe(true);
    expect(hasModifier(s, 'jam')).toBe(false);
  });

  it('combines with editionModifiers for a whole run', () => {
    for (const seed of ['A', 'B', 'C', 'daily-x']) {
      for (let j = 0; j < 30; j++) {
        const e = editionOf(j);
        const em = editionModifiers(seed, e, EQUAL_INKS);
        const s = contractSpec(j, em);
        if (s.special) {
          expect(s.modifiers).toEqual(em);
          expect(s.modifiers).toHaveLength(modifierCount(e));
        } else {
          expect(s.modifiers).toEqual([]);
        }
      }
    }
  });
});

describe('contractBoard (GDD §7 jam / leftover, §18.4 stream "board")', () => {
  const SEEDS = Array.from({ length: 400 }, (_, i) => `board-${i}`);
  const JAM_TIER: Record<number, number> = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 3, 6: 4, 7: 4, 8: 4, 9: 4, 12: 4 };
  // GDD gives 8/10/12 without editions; balance.ts uses the jam tiers (e1–2/e3–5/e6+), so 8 only shows up
  // when leftover is forced onto edition 1–2 (it is drawn from edition 3 on).
  const LEFTOVER_TIER: Record<number, number> = {
    1: 8,
    2: 8,
    3: 10,
    4: 10,
    5: 10,
    6: 12,
    7: 12,
    8: 12,
    9: 12,
    12: 12,
  };

  const noFullLine = (cells: Cells): void => {
    const full = findFullLines(cells);
    expect(full.rows).toEqual([]);
    expect(full.cols).toEqual([]);
  };

  it('regular jobs and modifiers without a board effect start on an empty forme', () => {
    for (const j of [0, 1, 3, 4, 21, 22]) {
      expect(contractBoard('S', contractSpec(j, mods('jam'))).every((v) => v === EMPTY)).toBe(true);
    }
    for (const m of MODIFIER_IDS) {
      if (m === 'jam' || m === 'leftover') continue;
      const cells = contractBoard('S', contractSpec(specialIndexOf(5), mods(m)));
      expect(cells).toHaveLength(BOARD_SIZE * BOARD_SIZE);
      expect(cells.every((v) => v === EMPTY)).toBe(true);
    }
  });

  it('jam: 2/3/4 rivets (e1–2/e3–5/e6+), ≤ 1 per row and column, never on the outer ring', () => {
    for (const [eStr, n] of Object.entries(JAM_TIER)) {
      const e = Number(eStr);
      const spec = contractSpec(specialIndexOf(e), mods('jam'));
      for (const seed of SEEDS) {
        const cells = contractBoard(seed, spec);
        const jams = positions(cells, JAM);
        expect(jams, `${seed} e${e}`).toHaveLength(n);
        const { rows, cols } = lineCounts(jams);
        expect(Math.max(...rows)).toBeLessThanOrEqual(1);
        expect(Math.max(...cols)).toBeLessThanOrEqual(1);
        for (const [x, y] of jams) {
          expect(x).toBeGreaterThanOrEqual(1);
          expect(x).toBeLessThanOrEqual(BOARD_SIZE - 2);
          expect(y).toBeGreaterThanOrEqual(1);
          expect(y).toBeLessThanOrEqual(BOARD_SIZE - 2);
        }
        // Nothing but rivets on the forme.
        expect(cells.every((v) => v === EMPTY || v === JAM)).toBe(true);
        noFullLine(cells);
      }
    }
  });

  it('jam: every inner cell is reachable as a rivet', () => {
    const seen = new Set<number>();
    const spec = contractSpec(specialIndexOf(6), mods('jam'));
    for (const seed of SEEDS)
      for (const [x, y] of positions(contractBoard(seed, spec), JAM)) seen.add(idx(x, y));
    expect(seen.size).toBe(36);
  });

  it('leftover: 8/10/12 isolated lead slugs, no orthogonal neighbours, ≤ 2 per row and column', () => {
    for (const [eStr, n] of Object.entries(LEFTOVER_TIER)) {
      const e = Number(eStr);
      const spec = contractSpec(specialIndexOf(e), mods('leftover'));
      for (const seed of SEEDS) {
        const cells = contractBoard(seed, spec);
        const lead = positions(cells, LEAD);
        expect(lead, `${seed} e${e}`).toHaveLength(n);
        const { rows, cols } = lineCounts(lead);
        expect(Math.max(...rows)).toBeLessThanOrEqual(2);
        expect(Math.max(...cols)).toBeLessThanOrEqual(2);
        for (const [x, y] of lead) {
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
            expect(cells[idx(nx, ny)], `${seed} e${e} (${x},${y})`).toBe(EMPTY);
          }
        }
        expect(cells.every((v) => v === EMPTY || v === LEAD)).toBe(true);
        noFullLine(cells);
      }
    }
  });

  it('leftover combines with other compatible modifiers (e.g. rows_only, rush)', () => {
    for (const other of ['rows_only', 'rush', 'wet_ink', 'out_of_ink'] as const) {
      const spec = contractSpec(specialIndexOf(7), [{ id: 'leftover' }, { id: other }]);
      for (const seed of SEEDS.slice(0, 50)) {
        const cells = contractBoard(seed, spec);
        expect(positions(cells, LEAD)).toHaveLength(12);
        noFullLine(cells);
      }
    }
  });

  it('is deterministic per (seed, index) and varies with either', () => {
    for (const m of ['jam', 'leftover'] as const) {
      const spec = contractSpec(specialIndexOf(6), mods(m));
      for (const seed of SEEDS.slice(0, 50))
        expect(contractBoard(seed, spec)).toEqual(contractBoard(seed, spec));
      const bySeed = new Set(SEEDS.slice(0, 50).map((s) => contractBoard(s, spec).join(',')));
      expect(bySeed.size).toBeGreaterThan(40);
      // Same edition tier, different job index (endless editions 6 and 7 share the jam/leftover tier).
      const spec2 = contractSpec(specialIndexOf(7), mods(m));
      const differ = SEEDS.slice(0, 50).filter(
        (s) => contractBoard(s, spec).join() !== contractBoard(s, spec2).join(),
      );
      expect(differ.length).toBeGreaterThan(40);
    }
  });

  it('depends only on (seed, index, modifiers), not on the rest of the spec', () => {
    const spec = contractSpec(specialIndexOf(4), mods('jam'));
    const tampered = { ...spec, quota: 1, sheets: 1 };
    expect(contractBoard('X', tampered)).toEqual(contractBoard('X', spec));
  });

  it('returns a fresh array each call', () => {
    const spec = contractSpec(specialIndexOf(3), mods('leftover'));
    const a = contractBoard('fresh', spec);
    const b = contractBoard('fresh', spec);
    expect(a).not.toBe(b);
    a[0] = JAM;
    expect(contractBoard('fresh', spec)).toEqual(b);
  });
});
