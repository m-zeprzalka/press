import { describe, expect, it, vi } from 'vitest';
import { newMeta } from '../core/meta';
import { RunEngine, type RunState } from '../core/run';
import { decodeSave, encodeSave, isRunState } from '../core/save';
import {
  createMemoryStore,
  createPreferencesStore,
  createSaveStore,
  createWebStore,
  STORAGE_KEYS,
  WriteQueue,
  type KeyValueStore,
} from './storage';

const prefs = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    get: vi.fn(async ({ key }: { key: string }) => ({ value: data.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      data.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      data.delete(key);
    }),
  };
});
vi.mock('@capacitor/preferences', () => ({ Preferences: prefs }));

function runState(score: number, seed = 'seed'): RunState {
  const s = RunEngine.create({ seed }).engine.snapshot();
  s.totals.score = score;
  return s;
}

const quiet = { onError: () => undefined };
const A = 'press.run.normal.a';
const B = 'press.run.normal.b';

function slot(kv: ReturnType<typeof createMemoryStore>, key: string) {
  return decodeSave(kv.data.get(key) ?? null, isRunState);
}

/** KV whose set() blocks until released, to observe coalescing. */
function slowStore() {
  const inner = createMemoryStore();
  const gates: Array<() => void> = [];
  const sets: Array<{ key: string; value: string }> = [];
  const kv: KeyValueStore = {
    get: (k) => inner.get(k),
    remove: (k) => inner.remove(k),
    set: (key, value) =>
      new Promise<void>((resolve) => {
        sets.push({ key, value });
        gates.push(() => {
          void inner.set(key, value).then(resolve);
        });
      }),
  };
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  /** Waits for the next blocked set() and lets it complete. */
  const release = async (): Promise<void> => {
    for (let i = 0; i < 50 && gates.length === 0; i++) await tick();
    gates.shift()?.();
    await tick();
  };
  return { kv, inner, sets, release, pending: () => gates.length };
}

describe('run slots (A/B)', () => {
  it('alternates slots with increasing seq and loads the newest', async () => {
    const kv = createMemoryStore();
    const store = createSaveStore(kv, quiet);
    await store.saveRun('normal', runState(1));
    expect(slot(kv, A)?.seq).toBe(1);
    expect(kv.data.has(B)).toBe(false);
    await store.saveRun('normal', runState(2));
    expect(slot(kv, B)?.seq).toBe(2);
    await store.saveRun('normal', runState(3));
    expect(slot(kv, A)?.seq).toBe(3);
    expect(slot(kv, B)?.value.totals.score).toBe(2);
    expect((await store.loadRun('normal'))?.totals.score).toBe(3);
    expect((await store.loadRunEntry('normal'))?.seq).toBe(3);
    // a fresh store (cold start) sees the same thing
    expect((await createSaveStore(kv, quiet).loadRun('normal'))?.totals.score).toBe(3);
  });

  it('keeps normal and daily runs in separate families', async () => {
    const kv = createMemoryStore();
    const store = createSaveStore(kv, quiet);
    await store.saveRun('normal', runState(10));
    await store.saveRun('daily', runState(20));
    expect((await store.loadRun('normal'))?.totals.score).toBe(10);
    expect((await store.loadRun('daily'))?.totals.score).toBe(20);
    expect(kv.data.has('press.run.daily.a')).toBe(true);
  });

  it('falls back to the older slot when the newest is corrupt, then overwrites the corrupt one', async () => {
    const kv = createMemoryStore();
    const store = createSaveStore(kv, quiet);
    await store.saveRun('normal', runState(1));
    await store.saveRun('normal', runState(2));
    const raw = kv.data.get(B) as string;
    kv.data.set(B, raw.slice(0, raw.length - 7)); // torn write
    const fresh = createSaveStore(kv, quiet);
    const loaded = await fresh.loadRunEntry('normal');
    expect(loaded?.seq).toBe(1);
    expect(loaded?.value.totals.score).toBe(1);
    await fresh.saveRun('normal', runState(3));
    expect(slot(kv, B)?.seq).toBe(2);
    expect(slot(kv, A)?.seq).toBe(1); // the good older slot was not touched
  });

  it('detects a flipped byte via the CRC', async () => {
    const kv = createMemoryStore();
    const store = createSaveStore(kv, quiet);
    await store.saveRun('normal', runState(1));
    await store.saveRun('normal', runState(2));
    const before = kv.data.get(B) as string;
    kv.data.set(B, before.replace('\\"score\\":2', '\\"score\\":9'));
    expect(kv.data.get(B)).not.toBe(before);
    expect((await createSaveStore(kv, quiet).loadRun('normal'))?.totals.score).toBe(1);
  });

  it('never overwrites the newest slot when saving without a prior load', async () => {
    const kv = createMemoryStore({ [A]: encodeSave(runState(5), 5), [B]: encodeSave(runState(4), 4) });
    const store = createSaveStore(kv, quiet);
    await store.saveRun('normal', runState(6));
    expect(slot(kv, A)?.seq).toBe(5);
    expect(slot(kv, B)?.seq).toBe(6);
  });

  it('snapshots the state at call time', async () => {
    const kv = createMemoryStore();
    const store = createSaveStore(kv, quiet);
    const s = runState(1);
    const p = store.saveRun('normal', s);
    s.totals.score = 999;
    await p;
    expect((await store.loadRun('normal'))?.totals.score).toBe(1);
  });

  it('coalesces: one write in flight, only the newest pending save is written after it', async () => {
    const slow = slowStore();
    const store = createSaveStore(slow.kv, quiet);
    const done = [1, 2, 3, 4, 5].map((n) => store.saveRun('normal', runState(n)));
    await new Promise((r) => setTimeout(r, 0));
    expect(slow.sets).toHaveLength(1);
    expect(slow.pending()).toBe(1);
    await slow.release();
    expect(slow.sets).toHaveLength(2); // 2,3,4 were superseded by 5
    let flushed = false;
    const f = store.flush().then(() => {
      flushed = true;
    });
    await slow.release();
    await Promise.all(done);
    await f;
    expect(flushed).toBe(true);
    expect(slow.sets).toHaveLength(2);
    const values = slow.sets.map((s) => decodeSave(s.value, isRunState));
    expect(values.map((v) => v?.value.totals.score)).toEqual([1, 5]);
    expect(values.map((v) => v?.seq)).toEqual([1, 2]);
    expect(slow.sets.map((s) => s.key)).toEqual([A, B]);
    expect((await store.loadRun('normal'))?.totals.score).toBe(5);
  });

  it('loadRun waits for queued writes', async () => {
    const slow = slowStore();
    const store = createSaveStore(slow.kv, quiet);
    void store.saveRun('normal', runState(1));
    void store.saveRun('normal', runState(2));
    const loading = store.loadRun('normal');
    await slow.release();
    await slow.release();
    expect((await loading)?.totals.score).toBe(2);
  });

  it('clearRun removes both slots, drops a pending save and keeps seq monotonic', async () => {
    const slow = slowStore();
    const store = createSaveStore(slow.kv, quiet);
    void store.saveRun('normal', runState(1));
    await new Promise((r) => setTimeout(r, 0));
    void store.saveRun('normal', runState(2)); // pending, superseded by the clear
    const cleared = store.clearRun('normal');
    await slow.release();
    await cleared;
    expect(slow.sets).toHaveLength(1);
    expect(await store.loadRun('normal')).toBeNull();
    const next = store.saveRun('normal', runState(3));
    await slow.release();
    await next;
    expect(decodeSave(slow.sets[1]?.value, isRunState)?.seq).toBe(2);
  });

  it('a failed remove blanks the key so the old run cannot come back', async () => {
    const inner = createMemoryStore();
    const kv: KeyValueStore = {
      ...inner,
      get: inner.get,
      set: inner.set,
      remove: async () => Promise.reject(new Error('io')),
    };
    const store = createSaveStore(kv, quiet);
    await store.saveRun('normal', runState(1));
    await store.clearRun('normal');
    expect(inner.data.get(A)).toBe('');
    expect(await store.loadRun('normal')).toBeNull();
  });

  it('a failed write keeps the target slot for the next attempt', async () => {
    const inner = createMemoryStore();
    let fail = false;
    const kv: KeyValueStore = {
      get: inner.get,
      remove: inner.remove,
      set: async (k, v) => (fail ? Promise.reject(new Error('disk full')) : inner.set(k, v)),
    };
    const errors: string[] = [];
    const store = createSaveStore(kv, { onError: (op) => errors.push(op) });
    await store.saveRun('normal', runState(1));
    fail = true;
    await expect(store.saveRun('normal', runState(2))).resolves.toBeUndefined();
    expect(errors).toEqual(['set']);
    fail = false;
    await store.saveRun('normal', runState(3));
    expect(decodeSave(inner.data.get(B), isRunState)?.seq).toBe(2);
    expect((await store.loadRun('normal'))?.totals.score).toBe(3);
  });
});

describe('never throws on garbage', () => {
  it('fuzz: truncated / mutated envelopes in both slots load as null or a valid run', async () => {
    const good1 = encodeSave(runState(1), 1);
    const good2 = encodeSave(runState(2), 2);
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    const mutate = (s: string): string => {
      switch (rnd(4)) {
        case 0:
          return s.slice(0, rnd(s.length));
        case 1: {
          const i = rnd(s.length);
          return s.slice(0, i) + String.fromCharCode(rnd(256)) + s.slice(i + 1);
        }
        case 2:
          return s.slice(rnd(s.length));
        default:
          return s;
      }
    };
    for (let i = 0; i < 300; i++) {
      const kv = createMemoryStore({ [A]: mutate(good1), [B]: mutate(good2) });
      const store = createSaveStore(kv, quiet);
      const r = await store.loadRun('normal');
      if (r !== null) expect(isRunState(r)).toBe(true);
      await store.saveRun('normal', runState(3));
      expect((await store.loadRun('normal'))?.totals.score).toBe(3);
    }
  });

  it('survives a throwing / misbehaving KV', async () => {
    const kv: KeyValueStore = {
      get: async () => Promise.reject(new Error('boom')),
      set: async () => Promise.reject(new Error('boom')),
      remove: async () => Promise.reject(new Error('boom')),
    };
    const store = createSaveStore(kv, quiet);
    await expect(store.loadRun('normal')).resolves.toBeNull();
    await expect(store.saveRun('normal', runState(1))).resolves.toBeUndefined();
    await expect(store.clearRun('daily')).resolves.toBeUndefined();
    await expect(store.loadMeta()).resolves.toEqual(newMeta());
    await expect(store.saveMeta(newMeta())).resolves.toBeUndefined();
    await expect(store.loadJSON('press.settings', { music: 1 })).resolves.toEqual({ music: 1 });
    await expect(store.flush()).resolves.toBeUndefined();
    const weird = {
      get: async () => 42 as unknown as string,
      set: async () => undefined,
      remove: async () => undefined,
    };
    await expect(createSaveStore(weird, quiet).loadRun('normal')).resolves.toBeNull();
  });

  it('rejects envelopes holding something that is not a run', async () => {
    const kv = createMemoryStore({ [A]: encodeSave({ v: 1, hello: 'world' }, 9), [B]: 'null' });
    expect(await createSaveStore(kv, quiet).loadRun('normal')).toBeNull();
  });
});

describe('meta', () => {
  it('round-trips through A/B envelopes and migrates', async () => {
    const kv = createMemoryStore();
    const store = createSaveStore(kv, quiet);
    const m = newMeta();
    m.stats.runs = 7;
    m.tutorialDone = true;
    await store.saveMeta(m);
    m.stats.runs = 8;
    await store.saveMeta(m);
    expect(kv.data.has('press.meta.a') && kv.data.has('press.meta.b')).toBe(true);
    const loaded = await createSaveStore(kv, quiet).loadMeta();
    expect(loaded.stats.runs).toBe(8);
    expect(loaded.tutorialDone).toBe(true);
  });

  it('fills missing fields from older payloads via migrateMeta', async () => {
    const kv = createMemoryStore({
      'press.meta.a': encodeSave({ stats: { runs: 3 }, unlocked: ['nope'] }, 1),
    });
    const loaded = await createSaveStore(kv, quiet).loadMeta();
    expect(loaded.stats.runs).toBe(3);
    expect(loaded.stats.lostRuns).toBe(0);
    expect(loaded.unlocked).toEqual([]);
  });

  it('keeps a backup of the last good value and uses it when both slots are corrupt', async () => {
    const kv = createMemoryStore();
    const store = createSaveStore(kv, quiet);
    const m = newMeta();
    m.stats.runs = 5;
    await store.saveMeta(m);
    await createSaveStore(kv, quiet).loadMeta(); // session start → backup
    expect(decodeSave(kv.data.get(STORAGE_KEYS.metaBackup), (v): v is object => !!v)?.seq).toBe(1);
    kv.data.set('press.meta.a', '{"schema":1,"seq":2,"crc":0,"payload":"{}"}');
    kv.data.set('press.meta.b', 'garbage');
    const loaded = await createSaveStore(kv, quiet).loadMeta();
    expect(loaded.stats.runs).toBe(5);
    expect(kv.data.get(STORAGE_KEYS.metaCorrupt)).toBe('{"schema":1,"seq":2,"crc":0,"payload":"{}"}');
  });

  it('returns newMeta when nothing readable exists', async () => {
    const kv = createMemoryStore({ 'press.meta.a': '\u0000\u0001', 'press.meta.bak': '{' });
    expect(await createSaveStore(kv, quiet).loadMeta()).toEqual(newMeta());
    expect(await createSaveStore(createMemoryStore(), quiet).loadMeta()).toEqual(newMeta());
  });
});

describe('JSON values', () => {
  it('loads fallback (copied) on missing / garbage, merges defaults into objects', async () => {
    const kv = createMemoryStore({ 'press.settings': '{"music":0.2,"extra":true}', 'press.bad': '{nope' });
    const store = createSaveStore(kv, quiet);
    const defaults = { music: 0.8, sfx: 0.8 };
    const s = await store.loadJSON('press.settings', defaults);
    expect(s).toEqual({ music: 0.2, sfx: 0.8, extra: true });
    const f = await store.loadJSON('press.bad', defaults);
    expect(f).toEqual(defaults);
    expect(f).not.toBe(defaults);
    expect(await store.loadJSON('press.none', 3)).toBe(3);
    expect(await store.loadJSON('press.settings', 3)).toBe(3); // type mismatch
    expect(await store.loadJSON('press.settings', defaults, () => ({ music: 1, sfx: 1 }))).toEqual({
      music: 1,
      sfx: 1,
    });
    expect(
      await store.loadJSON('press.settings', defaults, () => {
        throw new Error('bad');
      }),
    ).toEqual(defaults);
  });

  it('saveJSON coalesces per key and removeJSON deletes', async () => {
    const slow = slowStore();
    const store = createSaveStore(slow.kv, quiet);
    void store.saveJSON('press.ads', { n: 1 });
    void store.saveJSON('press.ads', { n: 2 });
    void store.saveJSON('press.ads', { n: 3 });
    void store.saveJSON('press.iap', { e: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(slow.sets.map((s) => s.key)).toEqual(['press.ads', 'press.iap']);
    await slow.release();
    await slow.release();
    await slow.release();
    await store.flush();
    expect(slow.sets.map((s) => s.value)).toEqual(['{"n":1}', '{"e":true}', '{"n":3}']);
    await store.removeJSON('press.ads');
    expect(await store.loadJSON('press.ads', null)).toBeNull();
  });
});

describe('KV backends', () => {
  it('WriteQueue runs the first job immediately and only the newest afterwards', async () => {
    const q = new WriteQueue();
    const ran: number[] = [];
    let release!: () => void;
    const block = new Promise<void>((r) => (release = r));
    void q.schedule(async () => {
      ran.push(1);
      await block;
    });
    void q.schedule(async () => void ran.push(2));
    const last = q.schedule(async () => void ran.push(3));
    expect(q.busy).toBe(true);
    release();
    await last;
    expect(ran).toEqual([1, 3]);
    expect(q.busy).toBe(false);
  });

  it('web store uses localStorage and falls back to memory when it throws', async () => {
    const backing = new Map<string, string>();
    const ls = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    } as unknown as Storage;
    const ok = createWebStore(() => ls);
    await ok.set('k', 'v');
    expect(backing.get('k')).toBe('v');
    expect(await ok.get('k')).toBe('v');
    await ok.remove('k');
    expect(await ok.get('k')).toBeNull();

    const full = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    backing.set('old', 'disk');
    const quota = createWebStore(() => full);
    await quota.set('k2', 'mem');
    expect(await quota.get('k2')).toBe('mem');
    await quota.remove('old');
    expect(await quota.get('old')).toBeNull();

    const blocked = createWebStore(() => {
      throw new Error('SecurityError');
    });
    await blocked.set('x', '1');
    expect(await blocked.get('x')).toBe('1');
    expect(await blocked.get('y')).toBeNull();
    await expect(createWebStore(() => undefined).get('z')).resolves.toBeNull();
  });

  it('preferences store maps to @capacitor/preferences', async () => {
    const kv = createPreferencesStore();
    await kv.set('a', '1');
    expect(prefs.set).toHaveBeenCalledWith({ key: 'a', value: '1' });
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('missing')).toBeNull();
    await kv.remove('a');
    expect(prefs.remove).toHaveBeenCalledWith({ key: 'a' });
  });
});
