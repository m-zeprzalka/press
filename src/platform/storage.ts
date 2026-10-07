/**
 * Persistence (GDD §12.4).
 *
 * - `KeyValueStore`: string KV backed by @capacitor/preferences on native (SharedPreferences)
 *   and localStorage on the web (with an in-memory overlay when storage is blocked or full).
 * - `createSaveStore(kv)`: the game's save API. Runs and meta are written as CRC-checked
 *   envelopes (`encodeSave`) into alternating A/B slots; loading picks the valid slot with the
 *   highest `seq`, so a torn/corrupt newest write falls back to the previous one.
 *   Writes are coalesced per key family: at most one write in flight, and a burst of saves
 *   during that write collapses into one write of the newest value. Nothing here throws.
 */
import { Preferences } from '@capacitor/preferences';
import { migrateMeta, newMeta, type MetaState } from '../core/meta';
import type { RunState } from '../core/run';
import { decodeSave, encodeSave, isRunState, pickLatest, type Loaded } from '../core/save';
import { browser, isNative } from './env';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type RunKind = 'normal' | 'daily';

/** Every persisted key in one place (GDD §12.4). */
export const STORAGE_KEYS = {
  run: (kind: RunKind): string => `press.run.${kind}`,
  meta: 'press.meta',
  /** Last good meta envelope as of the start of the session. */
  metaBackup: 'press.meta.bak',
  /** Raw copy of unreadable meta slots (kept for support/recovery, never read by the game). */
  metaCorrupt: 'press.meta.corrupt',
  settings: 'press.settings',
  ads: 'press.ads',
  iap: 'press.iap',
  session: 'press.session',
} as const;

// ---------------------------------------------------------------------------- KV backends

export function createPreferencesStore(): KeyValueStore {
  return {
    async get(key) {
      const r = await Preferences.get({ key });
      return r.value ?? null;
    },
    set: (key, value) => Preferences.set({ key, value }),
    remove: (key) => Preferences.remove({ key }),
  };
}

/**
 * localStorage with try/catch everywhere. Keys whose write failed (quota, private mode,
 * storage disabled) live in an in-memory overlay for the rest of the session, so reads stay
 * consistent with writes even when nothing reaches disk.
 */
export function createWebStore(
  getStorage: () => Storage | undefined = () => browser.localStorage,
): KeyValueStore {
  const overlay = new Map<string, string | null>();
  const storage = (): Storage | undefined => {
    try {
      return getStorage();
    } catch {
      return undefined;
    }
  };
  return {
    async get(key) {
      if (overlay.has(key)) return overlay.get(key) ?? null;
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        const s = storage();
        if (!s) throw new Error('no storage');
        s.setItem(key, value);
        overlay.delete(key);
      } catch {
        overlay.set(key, value);
      }
    },
    async remove(key) {
      try {
        const s = storage();
        if (!s) throw new Error('no storage');
        s.removeItem(key);
        overlay.delete(key);
      } catch {
        overlay.set(key, null);
      }
    },
  };
}

/** In-memory store (tests, fallback). */
export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

let defaultKv: KeyValueStore | null = null;

/** Preferences on native, localStorage on web. Singleton. */
export function defaultKeyValueStore(): KeyValueStore {
  if (!defaultKv) defaultKv = isNative() ? createPreferencesStore() : createWebStore();
  return defaultKv;
}

// ---------------------------------------------------------------------------- write coalescing

/** One in-flight job; while it runs, only the newest scheduled job is kept. */
export class WriteQueue {
  private next: (() => Promise<void>) | null = null;
  private running: Promise<void> | null = null;

  /** Resolves once this job (or a newer one that replaced it) has finished. */
  schedule(job: () => Promise<void>): Promise<void> {
    this.next = job;
    if (!this.running) this.running = this.drain();
    return this.running;
  }

  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  get busy(): boolean {
    return this.running !== null;
  }

  private async drain(): Promise<void> {
    while (this.next) {
      const job = this.next;
      this.next = null;
      try {
        await job();
      } catch {
        // jobs report their own errors
      }
    }
    this.running = null;
  }
}

// ---------------------------------------------------------------------------- save store

export interface SaveStore {
  loadRun(kind: RunKind): Promise<RunState | null>;
  /** Like loadRun, with the envelope's `seq` and `rules` version. */
  loadRunEntry(kind: RunKind): Promise<Loaded<RunState> | null>;
  /** Snapshots `state` now; persists it to the slot not holding the latest seq. */
  saveRun(kind: RunKind, state: Readonly<RunState>): Promise<void>;
  clearRun(kind: RunKind): Promise<void>;
  loadMeta(): Promise<MetaState>;
  saveMeta(meta: Readonly<MetaState>): Promise<void>;
  /**
   * Plain JSON value. Without `normalize`, objects are shallow-merged over a copy of `fallback`
   * (new settings fields get defaults) and type mismatches return the fallback.
   */
  loadJSON<T>(key: string, fallback: T, normalize?: (raw: unknown) => T): Promise<T>;
  saveJSON(key: string, value: unknown): Promise<void>;
  removeJSON(key: string): Promise<void>;
  /** Waits until every queued write has been attempted. Call on pause. */
  flush(): Promise<void>;
}

export interface SaveStoreOptions {
  onError?: (op: string, key: string, error: unknown) => void;
}

type Slot = 'a' | 'b';

interface SlotFamily {
  base: string;
  queue: WriteQueue;
  /** Latest valid persisted envelope (null = not read yet). */
  known: { seq: number; slot: Slot | null } | null;
  /** Bumped by every write/clear; stale reads must not overwrite `known`. */
  gen: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function jsonClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function defaultNormalize<T>(parsed: unknown, fallback: T): T {
  if (isObject(fallback))
    return (isObject(parsed) ? { ...jsonClone(fallback), ...parsed } : jsonClone(fallback)) as T;
  if (Array.isArray(fallback)) return (Array.isArray(parsed) ? parsed : jsonClone(fallback)) as T;
  if (fallback === null) return parsed as T;
  return (typeof parsed === typeof fallback ? parsed : fallback) as T;
}

export function createSaveStore(kv: KeyValueStore, opts: SaveStoreOptions = {}): SaveStore {
  const report =
    opts.onError ??
    ((op: string, key: string, e: unknown) => console.warn(`[press.storage] ${op} ${key} failed`, e));

  const families = new Map<string, SlotFamily>();
  const jsonQueues = new Map<string, WriteQueue>();

  const family = (base: string): SlotFamily => {
    let f = families.get(base);
    if (!f) {
      f = { base, queue: new WriteQueue(), known: null, gen: 0 };
      families.set(base, f);
    }
    return f;
  };
  const jsonQueue = (key: string): WriteQueue => {
    let q = jsonQueues.get(key);
    if (!q) {
      q = new WriteQueue();
      jsonQueues.set(key, q);
    }
    return q;
  };

  const get = async (key: string): Promise<string | null> => {
    try {
      const v = await kv.get(key);
      return typeof v === 'string' ? v : null;
    } catch (e) {
      report('get', key, e);
      return null;
    }
  };
  const set = async (key: string, value: string): Promise<boolean> => {
    try {
      await kv.set(key, value);
      return true;
    } catch (e) {
      report('set', key, e);
      return false;
    }
  };
  const remove = async (key: string): Promise<void> => {
    try {
      await kv.remove(key);
    } catch (e) {
      report('remove', key, e);
      // An empty value decodes as "no save", so a failed remove can't resurrect old data.
      await set(key, '');
    }
  };

  interface SlotRead<T> {
    a: Loaded<T> | null;
    b: Loaded<T> | null;
    rawA: string | null;
    rawB: string | null;
    best: Loaded<T> | null;
    bestSlot: Slot | null;
  }

  async function readSlots<T>(f: SlotFamily, validate: (v: unknown) => v is T): Promise<SlotRead<T>> {
    const gen = f.gen;
    const [rawA, rawB] = await Promise.all([get(`${f.base}.a`), get(`${f.base}.b`)]);
    const a = decodeSave(rawA, validate);
    const b = decodeSave(rawB, validate);
    const best = pickLatest(a, b);
    const bestSlot: Slot | null = best === null ? null : best === a ? 'a' : 'b';
    // seq never goes backwards within a session (e.g. a load right after clearRun).
    if (f.gen === gen) f.known = { seq: Math.max(best?.seq ?? 0, f.known?.seq ?? 0), slot: bestSlot };
    return { a, b, rawA, rawB, best, bestSlot };
  }

  /** Writes `snapshot` (JSON text) as an envelope into the slot not holding the latest seq. */
  function writeSlot<T>(f: SlotFamily, snapshot: string, validate: (v: unknown) => v is T): Promise<void> {
    return f.queue.schedule(async () => {
      if (!f.known) await readSlots(f, validate);
      const known = f.known ?? { seq: 0, slot: null };
      const target: Slot = known.slot === 'a' ? 'b' : 'a';
      const seq = known.seq + 1;
      let raw: string;
      try {
        raw = encodeSave(JSON.parse(snapshot) as unknown, seq);
      } catch (e) {
        report('encode', f.base, e);
        return;
      }
      f.gen++;
      if (await set(`${f.base}.${target}`, raw)) f.known = { seq, slot: target };
    });
  }

  const snapshotOf = (key: string, value: unknown): string | null => {
    try {
      const s = JSON.stringify(value);
      return typeof s === 'string' ? s : null;
    } catch (e) {
      report('serialize', key, e);
      return null;
    }
  };

  async function loadRunEntry(kind: RunKind): Promise<Loaded<RunState> | null> {
    try {
      const f = family(STORAGE_KEYS.run(kind));
      await f.queue.idle();
      return (await readSlots(f, isRunState)).best;
    } catch (e) {
      report('loadRun', kind, e);
      return null;
    }
  }

  async function loadMeta(): Promise<MetaState> {
    try {
      const f = family(STORAGE_KEYS.meta);
      await f.queue.idle();
      const r = await readSlots(f, isObject);
      if (r.best) {
        const raw = r.bestSlot === 'a' ? r.rawA : r.rawB;
        // Session-start backup of the last good value (survives two bad writes in a row).
        if (raw && (await get(STORAGE_KEYS.metaBackup)) !== raw) await set(STORAGE_KEYS.metaBackup, raw);
        return migrateMeta(r.best.value);
      }
      const corrupt = r.rawA || r.rawB;
      if (corrupt && !(await get(STORAGE_KEYS.metaCorrupt))) await set(STORAGE_KEYS.metaCorrupt, corrupt);
      const bak = decodeSave(await get(STORAGE_KEYS.metaBackup), isObject);
      if (bak) return migrateMeta(bak.value);
      return newMeta();
    } catch (e) {
      report('loadMeta', STORAGE_KEYS.meta, e);
      return newMeta();
    }
  }

  return {
    loadRunEntry,
    async loadRun(kind) {
      return (await loadRunEntry(kind))?.value ?? null;
    },
    saveRun(kind, state) {
      const base = STORAGE_KEYS.run(kind);
      const snap = snapshotOf(base, state);
      return snap === null ? Promise.resolve() : writeSlot(family(base), snap, isRunState);
    },
    clearRun(kind) {
      const f = family(STORAGE_KEYS.run(kind));
      return f.queue.schedule(async () => {
        if (!f.known) await readSlots(f, isRunState);
        f.gen++;
        await Promise.all([remove(`${f.base}.a`), remove(`${f.base}.b`)]);
        // Keep seq monotonic: if a remove silently failed, the next run still wins.
        f.known = { seq: f.known?.seq ?? 0, slot: null };
      });
    },
    loadMeta,
    saveMeta(meta) {
      const snap = snapshotOf(STORAGE_KEYS.meta, meta);
      return snap === null ? Promise.resolve() : writeSlot(family(STORAGE_KEYS.meta), snap, isObject);
    },
    async loadJSON<T>(key: string, fallback: T, normalize?: (raw: unknown) => T): Promise<T> {
      await jsonQueue(key).idle();
      const raw = await get(key);
      if (raw === null || raw === '') return jsonClone(fallback);
      try {
        const parsed: unknown = JSON.parse(raw);
        return normalize ? normalize(parsed) : defaultNormalize(parsed, fallback);
      } catch (e) {
        report('parse', key, e);
        return jsonClone(fallback);
      }
    },
    saveJSON(key, value) {
      const snap = snapshotOf(key, value);
      if (snap === null) return Promise.resolve();
      return jsonQueue(key).schedule(async () => {
        await set(key, snap);
      });
    },
    removeJSON(key) {
      return jsonQueue(key).schedule(() => remove(key));
    },
    async flush() {
      for (;;) {
        const busy = [...families.values()]
          .map((f) => f.queue)
          .concat([...jsonQueues.values()])
          .filter((q) => q.busy);
        if (busy.length === 0) return;
        await Promise.all(busy.map((q) => q.idle()));
      }
    },
  };
}
