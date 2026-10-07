/**
 * PRESS balance simulator CLI.
 *
 *   npm run sim -- run      --runs 10000 [--workers 4] [--out DIR] [--seed-prefix run]
 *                           [--reroll free|none|ads[,..]] [--continue never|always[,..]]
 *                           [--pool all|starters] [--epsilon 0.1] [--force-plate ID|skip [--paired]]
 *                           [--gen-probe 1] [--group run]
 *   npm run sim -- forced   --plates all|starters|id,id --pairs 400 [--out DIR] [--no-skip]
 *   npm run sim -- report   --in DIR[,DIR..] [--out docs/balance-report.md]
 *   npm run sim -- bench    [--runs 40]            single-thread timings (ms/decision, ms/run)
 *   npm run sim -- selftest [--cases 20000]        fast scorer / line model == core
 *   npm run sim -- one      --seed S               play one run, print a contract log
 *
 * Every command is resumable: re-running it with the same --out skips finished runs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BALANCE } from '../core/config/balance';
import { MATRIX_IDS, MX, STARTER_MATRICES, isMatrixId, type MatrixId } from '../core/matrices';
import { RunEngine } from '../core/run';
import { scorePrint, type SlotInput } from '../core/scoring';
import { createInstance } from '../core/matrices';
import { findFullLines } from '../core/board';
import { Rng } from '../core/rng';
import type { ContinuePolicy, RerollPolicy } from './bot';
import { playRun, type PoolKind, type RunConfig } from './play';
import { defaultWorkers, readRecords, runJobs } from './runner';
import { buildReport } from './report';
import { selftestLines, selftestScoring } from './selftest';
import { buildRack, cleanAfterLines, fastScore } from './fastscore';
import { applyOverrides, parseOverrides, type Overrides } from './overrides';
import { DEFAULT_WEIGHTS, type PlannerWeights } from './planner';
import { DEFAULT_PLATE_POLICY, type PlatePolicy } from './bot';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const args: Args = {};
  let cmd = 'run';
  let i = 0;
  if (argv[0] && !argv[0].startsWith('--')) {
    cmd = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const nxt = argv[i + 1];
    if (nxt !== undefined && !nxt.startsWith('--')) {
      args[key] = nxt;
      i++;
    } else args[key] = true;
  }
  return { cmd, args };
}

function str(args: Args, key: string, def: string): string {
  const v = args[key];
  return typeof v === 'string' ? v : def;
}
function num(args: Args, key: string, def: number): number {
  const v = args[key];
  if (typeof v !== 'string') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number`);
  return n;
}

const SIM_ROOT = '/tmp/claude-0/sim';

function listOf<T extends string>(v: string, allowed: readonly T[], name: string): T[] {
  const out = v.split(',').map((x) => x.trim()) as T[];
  for (const x of out)
    if (!allowed.includes(x))
      throw new Error(`--${name}: unknown value ${x} (allowed: ${allowed.join(', ')})`);
  return out;
}

function overridesOf(args: Args): Overrides {
  const o = parseOverrides(str(args, 'set', ''));
  applyOverrides(o); // main thread too, so meta.json records the effective values
  return o;
}

function baseConfig(args: Args): Omit<RunConfig, 'seed' | 'variant' | 'group'> {
  const overrides = overridesOf(args);
  return {
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    reroll: 'free',
    continue: 'never',
    pool: listOf(str(args, 'pool', 'all'), ['all', 'starters'] as const, 'pool')[0] as PoolKind,
    epsilon: num(args, 'epsilon', 0.05),
    forcePlate: null,
    genProbe: false,
  };
}

function variantName(reroll: RerollPolicy, cont: ContinuePolicy, force: string | null): string {
  return `reroll=${reroll},continue=${cont}${force ? `,force=${force}` : ''}`;
}

function metaFor(cmd: string, args: Args): Record<string, unknown> {
  overridesOf(args);
  return {
    command: cmd,
    args,
    node: process.version,
    workers: num(args, 'workers', defaultWorkers()),
    balance: BALANCE,
    mx: MX,
    starters: STARTER_MATRICES,
  };
}

async function cmdRun(args: Args): Promise<void> {
  const runs = num(args, 'runs', 1000);
  const out = str(args, 'out', `${SIM_ROOT}/run`);
  const prefix = str(args, 'seed-prefix', 'run');
  const group = str(args, 'group', 'run');
  const probe = num(args, 'gen-probe', 1);
  const rerolls = listOf(str(args, 'reroll', 'free'), ['none', 'free', 'ads'] as const, 'reroll');
  const conts = listOf(str(args, 'continue', 'never'), ['never', 'always'] as const, 'continue');
  const forceArg = str(args, 'force-plate', '');
  let force: MatrixId | 'skip' | null = null;
  if (forceArg) {
    if (forceArg !== 'skip' && !isMatrixId(forceArg))
      throw new Error(`--force-plate: unknown plate ${forceArg}`);
    force = forceArg as MatrixId | 'skip';
  }
  const base = baseConfig(args);
  const jobs: RunConfig[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = `${prefix}-${i}`;
    // Probe a deterministic subset of seeds through the generator.
    const genProbe = probe >= 1 || Rng.derive(seed, 'probe').next() < probe;
    for (const r of rerolls) {
      for (const c of conts) {
        if (force && args.paired)
          jobs.push({
            ...base,
            seed,
            group,
            reroll: r,
            continue: c,
            genProbe,
            variant: variantName(r, c, null),
          });
        jobs.push({
          ...base,
          seed,
          group,
          reroll: r,
          continue: c,
          genProbe,
          forcePlate: force,
          variant: variantName(r, c, force),
        });
      }
    }
  }
  await runJobs({ out, workers: num(args, 'workers', defaultWorkers()), jobs, meta: metaFor('run', args) });
}

async function cmdForced(args: Args): Promise<void> {
  const pairs = num(args, 'pairs', 400);
  const out = str(args, 'out', `${SIM_ROOT}/forced`);
  const prefix = str(args, 'seed-prefix', 'forced');
  const sel = str(args, 'plates', 'all');
  let plates: MatrixId[];
  if (sel === 'all') plates = [...MATRIX_IDS];
  else if (sel === 'starters') plates = [...STARTER_MATRICES];
  else {
    plates = sel.split(',').map((x) => x.trim()) as MatrixId[];
    for (const p of plates) if (!isMatrixId(p)) throw new Error(`--plates: unknown plate ${p}`);
  }
  const base = baseConfig(args);
  const reroll = listOf(
    str(args, 'reroll', 'free'),
    ['none', 'free', 'ads'] as const,
    'reroll',
  )[0] as RerollPolicy;
  const cont = listOf(
    str(args, 'continue', 'never'),
    ['never', 'always'] as const,
    'continue',
  )[0] as ContinuePolicy;
  const variants: Array<MatrixId | 'skip' | null> = [null, ...plates];
  if (!args['no-skip']) variants.push('skip');
  const jobs: RunConfig[] = [];
  // Seed-major order so partial results already contain complete pairs.
  for (let i = 0; i < pairs; i++) {
    const seed = `${prefix}-${i}`;
    for (const f of variants) {
      jobs.push({
        ...base,
        seed,
        group: 'forced',
        reroll,
        continue: cont,
        forcePlate: f,
        genProbe: false,
        pinForced: Boolean(args.pin),
        variant: f ? `force=${f}` : 'base',
      });
    }
  }
  await runJobs({
    out,
    workers: num(args, 'workers', defaultWorkers()),
    jobs,
    meta: { ...metaFor('forced', args), plates, pairs },
  });
}

/**
 * One-at-a-time parameter sweep on paired seeds:
 *   tune --runs 400 --w hole=0.05,0.1 --p skipValue=0,0.06 [--set quotaGrowth=1.4]
 */
async function cmdTune(args: Args): Promise<void> {
  const runs = num(args, 'runs', 400);
  const prefix = str(args, 'seed-prefix', 'tune');
  const out = str(args, 'out', `${SIM_ROOT}/tune-${Date.now().toString(36)}`);
  const base = baseConfig(args);
  type Variant = {
    name: string;
    weights?: Partial<PlannerWeights>;
    plate?: Partial<PlatePolicy>;
    epsilon?: number;
  };
  const variants: Variant[] = [{ name: 'default' }];
  const parseSweep = (spec: string, kind: 'w' | 'p') => {
    for (const part of spec.split(';')) {
      const [k, vs] = part.split('=');
      if (!k || !vs) continue;
      const key = k.trim();
      if (kind === 'w' && !(key in DEFAULT_WEIGHTS)) throw new Error(`--w: unknown weight ${key}`);
      if (kind === 'p' && !(key in DEFAULT_PLATE_POLICY))
        throw new Error(`--p: unknown plate policy key ${key}`);
      for (const v of vs.split(',')) {
        const n = Number(v);
        if (kind === 'w')
          variants.push({ name: `w.${key}=${n}`, weights: { [key]: n } as Partial<PlannerWeights> });
        else variants.push({ name: `p.${key}=${n}`, plate: { [key]: n } as Partial<PlatePolicy> });
      }
    }
  };
  parseSweep(str(args, 'w', ''), 'w');
  parseSweep(str(args, 'p', ''), 'p');
  for (const e of str(args, 'e', '').split(',').filter(Boolean))
    variants.push({ name: `epsilon=${e}`, epsilon: Number(e) });
  const jobs: RunConfig[] = [];
  for (let i = 0; i < runs; i++) {
    for (const v of variants) {
      jobs.push({
        ...base,
        seed: `${prefix}-${i}`,
        group: 'tune',
        variant: v.name,
        reroll: 'free',
        continue: 'never',
        genProbe: false,
        ...(v.weights ? { weights: v.weights } : {}),
        ...(v.plate ? { plate: v.plate } : {}),
        ...(v.epsilon !== undefined ? { epsilon: v.epsilon } : {}),
      });
    }
  }
  await runJobs({
    out,
    workers: num(args, 'workers', defaultWorkers()),
    jobs,
    meta: metaFor('tune', args),
    quiet: true,
  });
  const recs = readRecords(out);
  const bySeed = new Map<string, Map<string, number>>();
  const wins = new Map<string, number[]>();
  for (const r of recs) {
    let m = bySeed.get(r.seed);
    if (!m) bySeed.set(r.seed, (m = new Map()));
    m.set(r.variant, r.contractsWon);
    const w = wins.get(r.variant) ?? [];
    w.push(r.won ? 1 : 0);
    wins.set(r.variant, w);
  }
  console.info(`variant                         mean   Δ vs default (paired)   win%`);
  for (const v of variants) {
    const vals: number[] = [];
    const diffs: number[] = [];
    for (const m of bySeed.values()) {
      const x = m.get(v.name);
      const d = m.get('default');
      if (x === undefined) continue;
      vals.push(x);
      if (d !== undefined) diffs.push(x - d);
    }
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const md = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
    const sdv = Math.sqrt(diffs.reduce((a, b) => a + (b - md) * (b - md), 0) / Math.max(1, diffs.length - 1));
    const w = wins.get(v.name) ?? [];
    const wr = w.reduce((a, b) => a + b, 0) / Math.max(1, w.length);
    console.info(
      `${v.name.padEnd(30)} ${mean.toFixed(3).padStart(6)}   ${md >= 0 ? '+' : ''}${md.toFixed(3)} ± ${(sdv / Math.sqrt(Math.max(1, diffs.length))).toFixed(3)}   ${(100 * wr).toFixed(1)}`,
    );
  }
}

function cmdReport(args: Args): void {
  const ins = str(args, 'in', `${SIM_ROOT}/run`)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const out = str(args, 'out', 'docs/balance-report.md');
  const records = ins.flatMap((d) => readRecords(d));
  console.info(`[report] ${records.length} records from ${ins.join(', ')}`);
  const metas = ins.map((d) => {
    try {
      return JSON.parse(readFileSync(join(d, 'meta.json'), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  });
  const md = buildReport(records, { inputs: ins, metas });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.info(`[report] wrote ${out} (${md.length} chars)`);
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[k] as number;
}

function cmdBench(args: Args): void {
  const runs = num(args, 'runs', 40);
  const prefix = str(args, 'seed-prefix', 'bench');
  const base = baseConfig(args);
  const runMs: number[] = [];
  const decMs: number[] = [];
  let decisions = 0;
  let decTotal = 0;
  let maxDec = 0;
  let contracts = 0;
  const hist: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const rec = playRun({
      ...base,
      seed: `${prefix}-${i}`,
      group: 'bench',
      variant: 'bench',
      reroll: 'free',
      continue: 'never',
      genProbe: false,
    });
    runMs.push(rec.timing.totalMs);
    decMs.push(rec.timing.botMs / Math.max(1, rec.timing.decisions));
    decisions += rec.timing.decisions;
    decTotal += rec.timing.botMs;
    maxDec = Math.max(maxDec, rec.timing.maxDecisionMs);
    contracts += rec.contractsWon;
    for (const [k, v] of Object.entries(rec.timing.decisionHist)) hist[k] = (hist[k] ?? 0) + v;
  }
  runMs.sort((a, b) => a - b);
  // Decision-time percentiles from the merged histogram (bucket lower bounds).
  const buckets = Object.entries(hist)
    .map(([k, v]) => [k === '100+' ? 100 : Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const q = (p: number) => {
    let acc = 0;
    for (const [b, v] of buckets) {
      acc += v;
      if (acc >= p * decisions) return b;
    }
    return NaN;
  };
  console.info(`runs ${runs} · mean contracts won ${(contracts / runs).toFixed(2)}`);
  console.info(
    `ms/run: median ${pct(runMs, 0.5).toFixed(1)} · p90 ${pct(runMs, 0.9).toFixed(1)} · max ${pct(runMs, 1).toFixed(1)}`,
  );
  console.info(
    `ms/decision: mean ${(decTotal / decisions).toFixed(3)} · median bucket ${q(0.5)} · p90 bucket ${q(0.9)} · p99 bucket ${q(0.99)} · max ${maxDec.toFixed(2)} (${decisions} decisions)`,
  );

  // Scorer micro-benchmark: core scorePrint vs the event-free fast path.
  const rng = Rng.fromSeed('bench-score');
  const cases: Array<{
    cells: number[];
    lines: ReturnType<typeof findFullLines>;
    slots: SlotInput[];
    packed: number;
  }> = [];
  while (cases.length < 2000) {
    const cells = Array.from({ length: 64 }, () => (rng.chance(0.25) ? -1 : rng.int(5)));
    for (let j = 0; j < 8; j++) cells[3 * 8 + j] = rng.int(5);
    const lines = findFullLines(cells);
    const ids = rng.shuffle([...MATRIX_IDS]).slice(0, 3) as MatrixId[];
    const slots = ids.map((id, k) => ({ inst: createInstance(id, k), enabled: true }));
    let packed = 0;
    for (const y of lines.rows) packed |= 1 << y;
    for (const x of lines.cols) packed |= 1 << (8 + x);
    cases.push({ cells, lines, slots, packed });
  }
  const reps = 5;
  let t = performance.now();
  for (let r = 0; r < reps; r++)
    for (const c of cases)
      scorePrint({
        cells: c.cells,
        lines: c.lines,
        pieceSize: 4,
        streak: 5,
        sheetsLeft: 10,
        sheetsUsed: 10,
        printIndex: 3,
        slots: c.slots,
        slotCapacity: 5,
        random: Math.random,
      });
  const coreUs = ((performance.now() - t) * 1000) / (reps * cases.length);
  t = performance.now();
  for (let r = 0; r < reps; r++)
    for (const c of cases)
      fastScore({
        cells: c.cells,
        lines: c.packed,
        pieceSize: 4,
        streak: 5,
        sheetsLeft: 10,
        sheetsUsed: 10,
        printIndex: 3,
        cleanAfter: cleanAfterLines(c.cells, c.packed),
        rack: buildRack(
          c.slots.map((s) => s.inst.id),
          c.slots.map(() => true),
        ),
        states: c.slots.map((s) => s.inst.state),
        slotCapacity: 5,
        random: Math.random,
      });
  const fastUs = ((performance.now() - t) * 1000) / (reps * cases.length);
  console.info(
    `scoring: core scorePrint ${coreUs.toFixed(2)} µs/print · fastScore ${fastUs.toFixed(2)} µs/print`,
  );
}

function cmdSelftest(args: Args): void {
  const n = num(args, 'cases', 20000);
  const a = selftestScoring(n);
  console.info(`fastScore vs scorePrint: ${a.printing} printing cases, ${a.mismatches.length} mismatches`);
  for (const m of a.mismatches) console.info(`  ${m}`);
  const b = selftestLines(n);
  console.info(`line detection vs findFullLines: ${b.cases} cases, ${b.mismatches} mismatches`);
  if (a.mismatches.length > 0 || b.mismatches > 0) process.exitCode = 1;
}

function cmdOne(args: Args): void {
  const seed = str(args, 'seed', 'one-0');
  const base = baseConfig(args);
  const rec = playRun({
    ...base,
    seed,
    group: 'one',
    variant: 'one',
    reroll: (str(args, 'reroll', 'free') as RerollPolicy) ?? 'free',
    continue: (str(args, 'continue', 'never') as ContinuePolicy) ?? 'never',
    genProbe: true,
  });
  for (const c of rec.contracts) {
    console.info(
      `#${String(c.i + 1).padStart(2)} ${c.won ? 'WON ' : 'LOST'} ${String(c.progress).padStart(9)} / ${String(c.quota).padStart(8)} sheets ${c.sheetsUsed}/${c.sheetsGranted} prints ${c.prints} lines ${c.lines} best ${c.best} streak ${c.maxStreak} ${c.mods.join('+')} [${c.plates.join(' ')}]${c.disabled ? ` off:${c.disabled}` : ''}`,
    );
  }
  for (const o of rec.offers)
    console.info(
      `offer ${o.i + 1}: ${o.final.join(', ')} → ${o.action} ${o.took ?? ''}${o.replaced ? ` (replaces ${o.replaced})` : ''}`,
    );
  console.info(
    `won ${rec.contractsWon} · ${rec.timing.totalMs} ms · ${rec.timing.decisions} decisions · bot ${rec.timing.botMs} ms · loss ${rec.lossReason}`,
  );
  void RunEngine;
}

async function main(): Promise<void> {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'run':
      await cmdRun(args);
      break;
    case 'forced':
      await cmdForced(args);
      break;
    case 'report':
      cmdReport(args);
      break;
    case 'tune':
      await cmdTune(args);
      break;
    case 'bench':
      cmdBench(args);
      break;
    case 'selftest':
      cmdSelftest(args);
      break;
    case 'one':
      cmdOne(args);
      break;
    default:
      console.error(`Unknown command ${cmd}. Commands: run, forced, report, bench, selftest, one`);
      process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
