/**
 * Equality checks between the planner's fast model and the core:
 *  - fastScore() vs scorePrint() on random boards / racks / states,
 *  - fast line detection vs findFullLines() incl. jams and rows-only.
 */
import { BLIND, EMPTY, JAM, LEAD, findFullLines, type Cells } from '../core/board';
import { BALANCE } from '../core/config/balance';
import { MATRIX_IDS, createInstance, type MatrixId, type MatrixInstance } from '../core/matrices';
import { Rng } from '../core/rng';
import { scorePrint, type SlotInput } from '../core/scoring';
import { fullLinesPacked, occupancyOf } from './fastboard';
import { buildRack, cellsAfterLines, fastScore } from './fastscore';

function randomBoard(rng: Rng): Cells {
  const cells: Cells = [];
  for (let i = 0; i < 64; i++) {
    const r = rng.next();
    if (r < 0.3) cells.push(EMPTY);
    else if (r < 0.34) cells.push(BLIND);
    else if (r < 0.38) cells.push(LEAD);
    else if (r < 0.39) cells.push(JAM);
    else cells.push(rng.int(5));
  }
  // Force a few complete lines (sometimes monochrome).
  const nLines = rng.int(5);
  for (let k = 0; k < nLines; k++) {
    const row = rng.chance(0.5);
    const n = rng.int(8);
    const mono = rng.chance(0.3) ? rng.int(5) : -1;
    for (let j = 0; j < 8; j++) {
      const i = row ? n * 8 + j : j * 8 + n;
      if (cells[i] === JAM && rng.chance(0.7)) continue;
      cells[i] = mono >= 0 ? mono : rng.chance(0.1) ? (rng.chance(0.5) ? BLIND : LEAD) : rng.int(5);
    }
  }
  return cells;
}

function randomRack(rng: Rng): MatrixInstance[] {
  const ids = rng.shuffle([...MATRIX_IDS]).slice(0, rng.int(BALANCE.slots + 1));
  return ids.map((id, k) => {
    const inst = createInstance(id as MatrixId, k + 1);
    if (id === 'journeyman') inst.state.mult = 1 + rng.int(8);
    if (id === 'archive') inst.state.bonus = rng.int(80);
    if (id === 'ink_well') inst.state.mult = rng.int(12);
    if (id === 'scrap') inst.state.stored = rng.int(11) * 30;
    if (id === 'gutenberg') inst.state.x = 1.5 + rng.int(10) * 0.25;
    return inst;
  });
}

export function selftestScoring(
  cases: number,
  seed = 'selftest',
): { cases: number; printing: number; mismatches: string[] } {
  const rng = Rng.fromSeed(seed);
  const mismatches: string[] = [];
  let printing = 0;
  for (let c = 0; c < cases; c++) {
    const cells = randomBoard(rng);
    const rowsOnly = rng.chance(0.15);
    const lines = findFullLines(cells, rowsOnly);
    if (lines.rows.length + lines.cols.length === 0) continue;
    printing++;
    const plates = randomRack(rng);
    const enabled = plates.map(() => rng.chance(0.9));
    const slots: SlotInput[] = plates.map((inst, k) => ({ inst, enabled: enabled[k] as boolean }));
    const streak = rng.int(25);
    const sheetsUsed = 1 + rng.int(20);
    const sheetsLeft = rng.int(15);
    const printIndex = rng.int(10);
    const pieceSize = 1 + rng.int(9);
    const randSeed = `r${c}`;
    const r1 = Rng.fromSeed(randSeed);
    const r2 = Rng.fromSeed(randSeed);
    const full = scorePrint({
      cells,
      lines,
      pieceSize,
      streak,
      sheetsLeft,
      sheetsUsed,
      printIndex,
      slots,
      slotCapacity: BALANCE.slots,
      random: () => r1.next(),
    });
    let packed = 0;
    for (const y of lines.rows) packed |= 1 << y;
    for (const x of lines.cols) packed |= 1 << (8 + x);
    const fast = fastScore({
      cells,
      lines: packed,
      pieceSize,
      streak,
      sheetsLeft,
      sheetsUsed,
      printIndex,
      cellsAfter: cellsAfterLines(cells, packed),
      rack: buildRack(
        plates.map((p) => p.id),
        enabled,
      ),
      states: plates.map((p) => p.state),
      slotCapacity: BALANCE.slots,
      random: () => r2.next(),
    });
    const a = full.ctx;
    const b = fast.ctx;
    const same =
      full.total === fast.total &&
      a.lineCount === b.lineCount &&
      a.monoLines === b.monoLines &&
      a.boardCleanAfter === b.boardCleanAfter &&
      a.emptySlots === b.emptySlots &&
      a.inks.join() === b.inks.join() &&
      a.lineInkCounts.join() === b.lineInkCounts.join();
    if (!same && mismatches.length < 10) {
      mismatches.push(
        `case ${c}: core ${full.total} vs fast ${fast.total}; plates ${plates.map((p, k) => `${p.id}${enabled[k] ? '' : '(off)'}`).join(',')}`,
      );
    }
  }
  return { cases, printing, mismatches };
}

export function selftestLines(cases: number, seed = 'lines'): { cases: number; mismatches: number } {
  const rng = Rng.fromSeed(seed);
  let mismatches = 0;
  for (let c = 0; c < cases; c++) {
    const cells = randomBoard(rng);
    const rowsOnly = rng.chance(0.2);
    const core = findFullLines(cells, rowsOnly);
    let rowAllow = 0xff;
    let colAllow = rowsOnly ? 0 : 0xff;
    for (let i = 0; i < 64; i++) {
      if (cells[i] === JAM) {
        rowAllow &= ~(1 << (i >>> 3));
        colAllow &= ~(1 << (i & 7));
      }
    }
    const occ = occupancyOf(cells, EMPTY);
    const packed = fullLinesPacked(occ.lo, occ.hi, { rowAllow, colAllow });
    let expect = 0;
    for (const y of core.rows) expect |= 1 << y;
    for (const x of core.cols) expect |= 1 << (8 + x);
    if (packed !== expect) mismatches++;
  }
  return { cases, mismatches };
}
