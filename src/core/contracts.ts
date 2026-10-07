/**
 * Contracts ("zlecenia"), editions and special-contract modifiers (GDD §6–§7).
 */
import { BALANCE } from './config/balance';
import { EMPTY, JAM, LEAD, findFullLines, idx, newCells, type Cells } from './board';
import { BOARD_SIZE } from './pieces';
import { Rng } from './rng';
import { ipow, niceRound } from './math';

export { niceRound };

export const MODIFIER_IDS = [
  'rush',
  'big_format',
  'wet_ink',
  'jam',
  'out_of_ink',
  'leftover',
  'failure',
  'short_tray',
  'rows_only',
] as const;
export type ModifierId = (typeof MODIFIER_IDS)[number];

export interface Modifier {
  id: ModifierId;
  /** For out_of_ink: the missing ink (0..4). */
  ink?: number;
}

/** First edition (1-based) in which a modifier can appear. */
export const MODIFIER_MIN_EDITION: Record<ModifierId, number> = {
  rush: 1,
  big_format: 1,
  jam: 1,
  wet_ink: 3,
  out_of_ink: 3,
  leftover: 3,
  failure: 3,
  short_tray: 3,
  rows_only: 5,
};

const INCOMPATIBLE: ReadonlyArray<readonly [ModifierId, ModifierId]> = [
  ['rush', 'short_tray'],
  ['big_format', 'short_tray'],
  ['jam', 'leftover'],
  ['wet_ink', 'rush'],
  ['jam', 'rows_only'],
];

export function compatible(a: ModifierId, b: ModifierId): boolean {
  if (a === b) return false;
  return !INCOMPATIBLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export interface ContractSpec {
  /** 0-based global index. */
  index: number;
  /** 1-based edition. */
  edition: number;
  /** 0, 1 = regular, 2 = special. */
  position: number;
  special: boolean;
  quota: number;
  /** Base sheets before plates/bonuses. */
  sheets: number;
  modifiers: Modifier[];
}

export function editionOf(index: number): number {
  return Math.floor(index / BALANCE.contractsPerEdition) + 1;
}

export function positionOf(index: number): number {
  return index % BALANCE.contractsPerEdition;
}

export function isSpecialIndex(index: number): boolean {
  return positionOf(index) === BALANCE.contractsPerEdition - 1;
}

export function totalContracts(): number {
  return BALANCE.editions * BALANCE.contractsPerEdition;
}


export function modifierCount(edition: number): number {
  return edition >= BALANCE.doubleModifierFromEdition ? 2 : 1;
}

/**
 * Deterministic modifiers of an edition's special contract.
 * `inkWeights` (player's colour weights at edition start) picks the ink for out_of_ink:
 * the heaviest ink, seeded tie-break.
 */
export function editionModifiers(seed: string, edition: number, inkWeights: readonly number[]): Modifier[] {
  const rng = Rng.derive(seed, 'modifiers', edition);
  const pool = MODIFIER_IDS.filter((m) => MODIFIER_MIN_EDITION[m] <= edition);
  const want = modifierCount(edition);
  const chosen: ModifierId[] = [];
  for (const m of rng.shuffle([...pool])) {
    if (chosen.length >= want) break;
    if (chosen.every((c) => compatible(c, m))) chosen.push(m);
  }
  const tieBreak = rng.shuffle([0, 1, 2, 3, 4]);
  return chosen.map((id) => {
    if (id !== 'out_of_ink') return { id };
    let best = tieBreak[0] as number;
    for (const k of tieBreak) if ((inkWeights[k] ?? 0) > (inkWeights[best] ?? 0)) best = k;
    return { id, ink: best };
  });
}

/** Quota of a regular job at global index j (0-based) before modifiers. */
export function baseQuota(index: number): number {
  return BALANCE.quotaStart * ipow(BALANCE.quotaGrowth, index);
}

export function quotaFor(index: number, modifiers: readonly Modifier[]): number {
  let q = baseQuota(index);
  if (isSpecialIndex(index)) q *= BALANCE.specialFactor;
  for (const m of modifiers) q *= BALANCE.modifierQuota[m.id];
  return niceRound(q);
}

export function contractSpec(index: number, modifiers: readonly Modifier[]): ContractSpec {
  const edition = editionOf(index);
  const position = positionOf(index);
  const special = isSpecialIndex(index);
  const mods = special ? [...modifiers] : [];
  const sheets = mods.some((m) => m.id === 'rush') ? BALANCE.rushSheets : BALANCE.baseSheets;
  return { index, edition, position, special, quota: quotaFor(index, mods), sheets, modifiers: mods };
}

export function hasModifier(spec: { modifiers: readonly Modifier[] }, id: ModifierId): boolean {
  return spec.modifiers.some((m) => m.id === id);
}

function tier(table: readonly number[], edition: number): number {
  return table[Math.min(edition, table.length) - 1] as number;
}

function neighbours(i: number): number[] {
  const x = i % BOARD_SIZE;
  const y = (i / BOARD_SIZE) | 0;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < BOARD_SIZE - 1) out.push(i + 1);
  if (y > 0) out.push(i - BOARD_SIZE);
  if (y < BOARD_SIZE - 1) out.push(i + BOARD_SIZE);
  return out;
}

/** Initial board of a contract (jams / leftover lead), validated to have no full lines. */
export function contractBoard(seed: string, spec: ContractSpec): Cells {
  const cells = newCells();
  const rng = Rng.derive(seed, 'board', spec.index);
  if (hasModifier(spec, 'jam')) {
    // Rook placement: at most one jam per row and per column, kept off the outer ring.
    const n = tier(BALANCE.jamCount, spec.edition);
    const rows = rng.shuffle([1, 2, 3, 4, 5, 6]);
    const cols = rng.shuffle([1, 2, 3, 4, 5, 6]);
    for (let k = 0; k < n; k++) cells[idx(cols[k] as number, rows[k] as number)] = JAM;
  }
  if (hasModifier(spec, 'leftover')) {
    // Isolated lead slugs: no orthogonal neighbours, at most 2 per row and per column.
    const target = tier(BALANCE.leftoverCount, spec.edition);
    const perRow = new Array<number>(BOARD_SIZE).fill(0);
    const perCol = new Array<number>(BOARD_SIZE).fill(0);
    let placed = 0;
    for (const i of rng.shuffle(Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, k) => k))) {
      if (placed >= target) break;
      const x = i % BOARD_SIZE;
      const y = (i / BOARD_SIZE) | 0;
      if (cells[i] !== EMPTY || (perRow[y] as number) >= 2 || (perCol[x] as number) >= 2) continue;
      if (neighbours(i).some((n) => cells[n] !== EMPTY)) continue;
      cells[i] = LEAD;
      perRow[y] = (perRow[y] as number) + 1;
      perCol[x] = (perCol[x] as number) + 1;
      placed++;
    }
  }
  /* c8 ignore next 2 */
  const full = findFullLines(cells);
  if (full.rows.length > 0 || full.cols.length > 0) throw new Error('contractBoard produced a full line');
  return cells;
}
