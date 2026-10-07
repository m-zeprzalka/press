/**
 * Multi-threaded batch runner.
 *
 * Every worker appends one JSON line per finished run to its own file in the output dir, so a
 * killed batch loses at most the runs in flight; re-running the same command skips every key
 * already present (resume). Workers load TypeScript through tsx: Node 22 strips types natively
 * but resolves extensionless imports only with tsx's hooks, and `execArgv: ['--import', 'tsx']`
 * does not register them early enough in a worker, so each worker boots from a tiny eval script
 * that calls `register()` from `tsx/esm/api` and then imports worker.ts.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { playRun, runKey, type RunConfig, type RunRecord } from './play';

export interface RunnerOptions {
  out: string;
  workers: number;
  jobs: RunConfig[];
  /** Saved to meta.json (merged with earlier invocations). */
  meta: Record<string, unknown>;
  /** Jobs per message to a worker. */
  batch?: number;
  quiet?: boolean;
}

export interface RunnerSummary {
  total: number;
  skipped: number;
  ran: number;
  ms: number;
  meanContracts: number;
  wins: number;
}

export function defaultWorkers(): number {
  return Math.max(1, cpus().length);
}

/** Reads every JSONL record in a directory (malformed / partial lines are skipped). */
export function readRecords(dir: string): RunRecord[] {
  if (!existsSync(dir)) return [];
  const out: RunRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as RunRecord;
        if (r && r.v === 1 && typeof r.key === 'string') out.push(r);
      } catch {
        /* partial line from an interrupted write */
      }
    }
  }
  return out;
}

function doneKeys(dir: string): Set<string> {
  return new Set(readRecords(dir).map((r) => r.key));
}

function writeMeta(dir: string, meta: Record<string, unknown>): void {
  const file = join(dir, 'meta.json');
  let prev: { invocations?: unknown[] } = {};
  if (existsSync(file)) {
    try {
      prev = JSON.parse(readFileSync(file, 'utf8')) as { invocations?: unknown[] };
    } catch {
      prev = {};
    }
  }
  const invocations = [...(prev.invocations ?? []), { at: new Date().toISOString(), ...meta }];
  writeFileSync(file, JSON.stringify({ ...meta, invocations }, null, 2));
}

function updateMeta(dir: string, patch: Record<string, unknown>): void {
  const file = join(dir, 'meta.json');
  try {
    const cur = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...cur, ...patch }, null, 2));
  } catch {
    /* meta is informational */
  }
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

interface DoneMsg {
  type: 'done';
  key: string;
  contractsWon: number;
  won: boolean;
  ms: number;
}
interface IdleMsg {
  type: 'idle';
}
interface ErrMsg {
  type: 'error';
  key: string;
  error: string;
}
type WorkerMsg = DoneMsg | IdleMsg | ErrMsg;

export function workerBootstrap(): string {
  const entry = new URL('./worker.ts', import.meta.url).href;
  const api = import.meta.resolve('tsx/esm/api');
  return `import(${JSON.stringify(api)}).then((m) => { m.register(); return import(${JSON.stringify(entry)}); }).catch((e) => { console.error(e); process.exit(1); });`;
}

export async function runJobs(opts: RunnerOptions): Promise<RunnerSummary> {
  mkdirSync(opts.out, { recursive: true });
  const done = doneKeys(opts.out);
  const pending = opts.jobs.filter((j) => !done.has(runKey(j)));
  const skipped = opts.jobs.length - pending.length;
  writeMeta(opts.out, { ...opts.meta, jobs: opts.jobs.length, pendingAtStart: pending.length });
  const log = (msg: string) => {
    if (!opts.quiet) console.info(msg);
  };
  log(
    `[sim] ${opts.jobs.length} runs requested, ${skipped} already in ${opts.out}, ${pending.length} to run on ${opts.workers} worker(s)`,
  );
  const t0 = performance.now();
  let ran = 0;
  let sumContracts = 0;
  let wins = 0;
  if (pending.length === 0)
    return { total: opts.jobs.length, skipped, ran, ms: 0, meanContracts: 0, wins: 0 };

  const stamp = `${Date.now().toString(36)}-${process.pid}`;
  if (opts.workers <= 0) {
    // Inline mode (debugging / profiling).
    const file = join(opts.out, `inline-${stamp}.jsonl`);
    for (const job of pending) {
      const rec = playRun(job);
      appendFileSync(file, `${JSON.stringify(rec)}\n`);
      ran++;
      sumContracts += rec.contractsWon;
      if (rec.won) wins++;
    }
    const ms = performance.now() - t0;
    log(`[sim] done ${ran} runs in ${fmtDuration(ms)}`);
    return {
      total: opts.jobs.length,
      skipped,
      ran,
      ms,
      meanContracts: sumContracts / Math.max(1, ran),
      wins,
    };
  }

  const batch = opts.batch ?? 4;
  let next = 0;
  const code = workerBootstrap();
  let lastLog = performance.now();
  const progress = () => {
    const now = performance.now();
    if (now - lastLog < 10000 && ran < pending.length) return;
    lastLog = now;
    const el = now - t0;
    const rate = ran / (el / 60000);
    const eta = rate > 0 ? ((pending.length - ran) / rate) * 60000 : 0;
    log(
      `[sim] ${ran}/${pending.length} runs · ${rate.toFixed(0)} runs/min · elapsed ${fmtDuration(el)} · ETA ${fmtDuration(eta)} · mean contracts ${(sumContracts / Math.max(1, ran)).toFixed(2)} · wins ${((100 * wins) / Math.max(1, ran)).toFixed(1)}%`,
    );
  };

  await new Promise<void>((resolve, reject) => {
    let alive = 0;
    const n = Math.min(opts.workers, Math.ceil(pending.length / batch));
    for (let k = 0; k < n; k++) {
      const file = join(opts.out, `w${k}-${stamp}.jsonl`);
      const w = new Worker(code, { eval: true, workerData: { file } });
      alive++;
      const feed = () => {
        if (next >= pending.length) {
          w.postMessage({ type: 'stop' });
          return;
        }
        const jobs = pending.slice(next, next + batch);
        next += jobs.length;
        w.postMessage({ type: 'jobs', jobs });
      };
      w.on('message', (m: WorkerMsg) => {
        if (m.type === 'done') {
          ran++;
          sumContracts += m.contractsWon;
          if (m.won) wins++;
          progress();
        } else if (m.type === 'idle') feed();
        else if (m.type === 'error') console.error(`[sim] run ${m.key} failed: ${m.error}`);
      });
      w.on('error', (e) => {
        console.error('[sim] worker error', e);
        reject(e);
      });
      w.on('exit', () => {
        alive--;
        if (alive === 0) resolve();
      });
      feed();
    }
  });
  const ms = performance.now() - t0;
  log(`[sim] done ${ran} runs in ${fmtDuration(ms)} (${((ran / ms) * 60000).toFixed(0)} runs/min)`);
  updateMeta(opts.out, {
    wallMs: Math.round(ms),
    ranLast: ran,
    runsPerMin: Math.round((ran / ms) * 60000),
    workersLast: opts.workers,
  });
  return { total: opts.jobs.length, skipped, ran, ms, meanContracts: sumContracts / Math.max(1, ran), wins };
}
