/**
 * Meta progression: lifetime stats, achievements and plate unlocks (GDD §10).
 * Pure reducers over run events — persistence lives in the platform layer.
 */
import { BALANCE } from './config/balance';
import { STARTER_MATRICES, isMatrixId, type MatrixId } from './matrices';
import type { RunEvent, RunState } from './run';

export const META_VERSION = 1;

export const ACHIEVEMENT_IDS = [
  'first_print',
  'quad',
  'cross_15',
  'palette_4',
  'palette_5',
  'clean_3',
  'reach_e3',
  'reach_e6',
  'win_run',
  'ascetic',
  'streak_12',
  'streak_20',
  'big_print',
  'collector',
  'millionaire',
  'regular',
  'endless',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Plate unlocked by each achievement. */
export const ACHIEVEMENT_UNLOCKS: Partial<Record<AchievementId, MatrixId>> = {
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
};

export const ACHIEVEMENT_THRESHOLDS = {
  crosses: 15,
  streakA: 12,
  streakB: 20,
  bigPrint: 10000,
  millionaire: 1_000_000,
  dailies: 3,
  endlessContract: 30,
} as const;

export interface MetaStats {
  runs: number;
  completedRuns: number;
  lostRuns: number;
  wins: number;
  /** Most contracts won in a single run. */
  bestContracts: number;
  bestScore: number;
  bestPrint: number;
  totalScore: number;
  totalLines: number;
  totalPrints: number;
  totalPlacements: number;
  maxStreak: number;
  maxLines: number;
  crosses: number;
  monoLines: number;
  dailyPlayed: number;
  dailyStreak: number;
  lastDailyDate: string | null;
  picks: Partial<Record<MatrixId, number>>;
}

export interface DailyRecord {
  best: number;
  contracts: number;
  attempts: number;
  grid: string;
}

export interface MetaState {
  v: number;
  stats: MetaStats;
  /** Achievement → unlock timestamp (ms). */
  achievements: Partial<Record<AchievementId, number>>;
  /** Plates unlocked beyond the starter set. */
  unlocked: MatrixId[];
  daily: Record<string, DailyRecord>;
  tutorialDone: boolean;
  /** The very first reprint is on the house (GDD §11). */
  freeContinueUsed: boolean;
  tipsSeen: string[];
}

export function newMeta(): MetaState {
  return {
    v: META_VERSION,
    stats: {
      runs: 0,
      completedRuns: 0,
      lostRuns: 0,
      wins: 0,
      bestContracts: 0,
      bestScore: 0,
      bestPrint: 0,
      totalScore: 0,
      totalLines: 0,
      totalPrints: 0,
      totalPlacements: 0,
      maxStreak: 0,
      maxLines: 0,
      crosses: 0,
      monoLines: 0,
      dailyPlayed: 0,
      dailyStreak: 0,
      lastDailyDate: null,
      picks: {},
    },
    achievements: {},
    unlocked: [],
    daily: {},
    tutorialDone: false,
    freeContinueUsed: false,
    tipsSeen: [],
  };
}

/** Plates that may appear in offers. */
export function unlockedPool(meta: MetaState): MatrixId[] {
  const set = new Set<MatrixId>(STARTER_MATRICES);
  for (const id of meta.unlocked) set.add(id);
  return [...set];
}

export interface MetaUpdate {
  achievements: AchievementId[];
  unlocks: MatrixId[];
}

function grant(meta: MetaState, id: AchievementId, now: number, out: MetaUpdate): void {
  if (meta.achievements[id] !== undefined) return;
  meta.achievements[id] = now;
  out.achievements.push(id);
  const plate = ACHIEVEMENT_UNLOCKS[id];
  if (plate && !STARTER_MATRICES.includes(plate) && !meta.unlocked.includes(plate)) {
    meta.unlocked.push(plate);
    out.unlocks.push(plate);
  }
}

/** Call once when a run is created (counts it as started). */
export function onRunStarted(meta: MetaState): void {
  meta.stats.runs++;
}

/**
 * Applies the events produced by one engine action. `run` is the state *after* the action.
 * Mutates `meta` and returns newly earned achievements / unlocked plates.
 */
export function applyRunEvents(meta: MetaState, run: Readonly<RunState>, events: readonly RunEvent[], now: number): MetaUpdate {
  const out: MetaUpdate = { achievements: [], unlocks: [] };
  const st = meta.stats;
  for (const e of events) {
    switch (e.type) {
      case 'placed':
        st.totalPlacements++;
        break;
      case 'printed': {
        const ctx = e.result.ctx;
        st.totalLines += ctx.lineCount;
        st.totalPrints++;
        st.totalScore += e.result.total;
        st.bestPrint = Math.max(st.bestPrint, e.result.total);
        st.maxLines = Math.max(st.maxLines, ctx.lineCount);
        st.maxStreak = Math.max(st.maxStreak, e.streak);
        st.monoLines += ctx.monoLines;
        if (ctx.rowCount > 0 && ctx.colCount > 0) st.crosses++;
        grant(meta, 'first_print', now, out);
        if (ctx.lineCount >= 4) grant(meta, 'quad', now, out);
        if (st.crosses >= ACHIEVEMENT_THRESHOLDS.crosses) grant(meta, 'cross_15', now, out);
        if (ctx.inks.length >= 4) grant(meta, 'palette_4', now, out);
        if (ctx.inks.length >= 5) grant(meta, 'palette_5', now, out);
        if (ctx.boardCleanAfter && ctx.lineCount >= 3) grant(meta, 'clean_3', now, out);
        if (e.streak >= ACHIEVEMENT_THRESHOLDS.streakA) grant(meta, 'streak_12', now, out);
        if (e.streak >= ACHIEVEMENT_THRESHOLDS.streakB) grant(meta, 'streak_20', now, out);
        if (e.result.total >= ACHIEVEMENT_THRESHOLDS.bigPrint) grant(meta, 'big_print', now, out);
        if (st.totalScore >= ACHIEVEMENT_THRESHOLDS.millionaire) grant(meta, 'millionaire', now, out);
        break;
      }
      case 'contract_won': {
        const reached = e.index + 2; // contract number now being reached (1-based)
        const perEdition = BALANCE.contractsPerEdition;
        if (reached > perEdition * 2) grant(meta, 'reach_e3', now, out);
        if (reached > perEdition * 5) grant(meta, 'reach_e6', now, out);
        if (e.index + 1 >= ACHIEVEMENT_THRESHOLDS.endlessContract) grant(meta, 'endless', now, out);
        const edition = Math.floor(e.index / perEdition) + 1;
        const special = e.index % perEdition === perEdition - 1;
        if (special && edition >= 3 && run.plates.length <= 1) grant(meta, 'ascetic', now, out);
        break;
      }
      case 'plate_added':
        st.picks[e.inst.id] = (st.picks[e.inst.id] ?? 0) + 1;
        if (run.plates.length >= BALANCE.slots) grant(meta, 'collector', now, out);
        break;
      case 'victory':
        grant(meta, 'win_run', now, out);
        break;
      case 'run_over': {
        st.completedRuns++;
        if (e.won) st.wins++;
        else st.lostRuns++;
        st.bestContracts = Math.max(st.bestContracts, run.totals.contractsWon);
        st.bestScore = Math.max(st.bestScore, run.totals.score);
        if (run.mode === 'daily' && run.dailyDate) recordDaily(meta, run, out, now);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

const INK_EMOJI = ['🟥', '🟧', '🟨', '🟩', '🟦'];

/** Emoji grid for the share card: dominant ink per won contract, ⬛ for the lost one. */
export function dailyGrid(run: Readonly<RunState>): string {
  return run.totals.history
    .map((h) => (!h.won ? '⬛' : h.dominantInk === null ? '⬜' : (INK_EMOJI[h.dominantInk] as string)))
    .join('');
}

function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function recordDaily(meta: MetaState, run: Readonly<RunState>, out: MetaUpdate, now: number): void {
  const date = run.dailyDate as string;
  const st = meta.stats;
  const rec = meta.daily[date] ?? { best: 0, contracts: 0, attempts: 0, grid: '' };
  const first = rec.attempts === 0;
  rec.attempts++;
  const better =
    run.totals.contractsWon > rec.contracts || (run.totals.contractsWon === rec.contracts && run.totals.score > rec.best);
  if (first || better) {
    rec.best = run.totals.score;
    rec.contracts = run.totals.contractsWon;
    rec.grid = dailyGrid(run);
  }
  meta.daily[date] = rec;
  if (first) {
    st.dailyPlayed++;
    st.dailyStreak = st.lastDailyDate === prevDay(date) ? st.dailyStreak + 1 : 1;
    st.lastDailyDate = date;
    if (st.dailyPlayed >= ACHIEVEMENT_THRESHOLDS.dailies) grant(meta, 'regular', now, out);
  }
}

/** Normalises persisted meta (missing fields from older versions, unknown plates dropped). */
export function migrateMeta(raw: unknown): MetaState {
  const base = newMeta();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<MetaState>;
  const stats = { ...base.stats, ...(r.stats ?? {}) };
  stats.picks = { ...(r.stats?.picks ?? {}) };
  return {
    v: META_VERSION,
    stats,
    achievements: { ...(r.achievements ?? {}) },
    unlocked: Array.isArray(r.unlocked) ? r.unlocked.filter(isMatrixId) : [],
    daily: { ...(r.daily ?? {}) },
    tutorialDone: Boolean(r.tutorialDone),
    freeContinueUsed: Boolean(r.freeContinueUsed),
    tipsSeen: Array.isArray(r.tipsSeen) ? r.tipsSeen.filter((t) => typeof t === 'string') : [],
  };
}
