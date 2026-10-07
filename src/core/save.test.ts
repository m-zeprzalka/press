/**
 * Save envelopes (GDD §12.4): CRC-32, encode/decode round trip, A/B slot choice,
 * structural RunState validation and the "corruption never throws" fuzz test.
 *
 * Expected CRC values are computed here by an independent bitwise reference
 * implementation (no lookup table) over the UTF-16LE bytes of the string, and that
 * reference is itself checked against the published CRC-32/ISO-HDLC vectors.
 */
import { describe, expect, it } from 'vitest';
import { RULES_VERSION, SAVE_SCHEMA } from './config/version';
import { BALANCE } from './config/balance';
import { BLIND, EMPTY, JAM, idx } from './board';
import { totalContracts } from './contracts';
import { dailyPool, dailySeed, dailyStartPlate } from './daily';
import { MATRIX_IDS, createInstance, type MatrixId } from './matrices';
import { BOARD_SIZE, shapeById } from './pieces';
import { Rng } from './rng';
import {
  RUN_STATE_VERSION,
  RunEngine,
  type RunEvent,
  type RunPhase,
  type RunState,
  type SlotRef,
} from './run';
import {
  crc32,
  decodeSave,
  encodeSave,
  isRunState,
  pickLatest,
  type Loaded,
  type SaveEnvelope,
} from './save';

// ---------------------------------------------------------------------------
// Reference CRC-32 (ISO-HDLC, reflected poly 0xEDB88320), bit by bit.

function refCrc32(bytes: ArrayLike<number>): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] as number;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const asciiBytes = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));

/** UTF-16LE bytes of a string's code units (what save.crc32 is documented to hash). */
function utf16le(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c & 0xff, c >>> 8);
  }
  return out;
}

const refStringCrc = (s: string): number => refCrc32(utf16le(s));

// ---------------------------------------------------------------------------
// Real engine snapshots, produced by a small greedy autoplayer.

function contact(s: Readonly<RunState>, shapeId: string, x: number, y: number): number {
  const shape = shapeById(shapeId);
  const own = new Set(shape.cells.map(([dx, dy]) => idx(x + dx, y + dy)));
  let n = 0;
  for (const [dx, dy] of shape.cells) {
    for (const [ax, ay] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx + ax;
      const ny = y + dy + ay;
      if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) n++;
      else if (!own.has(idx(nx, ny)) && s.cells[idx(nx, ny)] !== EMPTY) n++;
    }
  }
  return n;
}

/** One deterministic greedy action; null when the run is over. */
function greedyStep(e: RunEngine): RunEvent[] | null {
  const s = e.state;
  switch (s.phase) {
    case 'playing': {
      let best: { slot: SlotRef; x: number; y: number; v: number } | null = null;
      const slots: SlotRef[] = [0, 1, 2];
      if (e.reserveSlots() > 0 && s.reserve) slots.push('reserve');
      for (const slot of slots) {
        const p = e.pieceAt(slot);
        if (!p) continue;
        for (const [x, y] of e.validPositions(slot)) {
          const l = e.previewLines(slot, x, y);
          if (!l) continue;
          const v = (l.rows.length + l.cols.length) * 1000 + contact(s, p.shape, x, y);
          if (!best || v > best.v) best = { slot, x, y, v };
        }
      }
      if (!best) throw new Error('greedy: playing without a legal move');
      return e.place(best.slot, best.x, best.y);
    }
    case 'offer': {
      const offer = s.offer;
      if (!offer || offer.cards.length === 0) return e.skipOffer();
      if (s.plates.length >= BALANCE.slots) return e.takeOffer(0, (s.plates[0] as { uid: number }).uid);
      return e.takeOffer(0);
    }
    case 'last_chance': {
      const p = e.sellablePlates()[0];
      return p ? e.sell(p.uid) : e.acceptLoss();
    }
    case 'lost':
      return e.canContinue() ? e.continueRun() : e.endRun();
    case 'victory':
      return e.endRun();
    case 'over':
      return null;
  }
}

/** Plays a run to the end, returning the snapshot taken after every action. */
function playAll(engine: RunEngine, maxActions = 5000): RunState[] {
  const out: RunState[] = [engine.snapshot()];
  for (let n = 0; n < maxActions; n++) {
    if (!greedyStep(engine)) return out;
    out.push(engine.snapshot());
  }
  throw new Error('greedy: run did not finish');
}

/** A run doctored onto the last contract with the quota almost met: the next print wins the run. */
/** Installs plates into a freshly created run via snapshot/restore (test setup). */
function withPlates(engine: RunEngine, ids: readonly MatrixId[]): RunEngine {
  const s = engine.snapshot();
  for (const id of ids) s.plates.push(createInstance(id, s.nextUid++));
  return RunEngine.restore(s);
}

function nearVictoryEngine(seed: string): RunEngine {
  const { engine } = RunEngine.create({ seed });
  const s = engine.snapshot();
  s.contractIndex = totalContracts() - 1;
  s.contract.progress = s.contract.spec.quota - 1;
  s.plates = [createInstance('proof', s.nextUid++), createInstance('ream', s.nextUid++)];
  return RunEngine.restore(s);
}

/** Plays until the phase changes away from 'playing' (or the run ends). */
function playUntilNot(engine: RunEngine, phase: RunPhase): void {
  for (let n = 0; n < 500 && engine.state.phase === phase; n++) greedyStep(engine);
}

const PHASES: readonly RunPhase[] = ['playing', 'offer', 'last_chance', 'lost', 'victory', 'over'];

function collectSnapshots(): Map<RunPhase, RunState[]> {
  const byPhase = new Map<RunPhase, RunState[]>(PHASES.map((p) => [p, []]));
  const add = (s: RunState) => (byPhase.get(s.phase) as RunState[]).push(s);
  /** Every end-state snapshot of one run plus the first two 'playing' / 'offer' ones. */
  const addRun = (snaps: readonly RunState[]) => {
    const seen = new Map<RunPhase, number>();
    for (const s of snaps) {
      const n = seen.get(s.phase) ?? 0;
      if (n < 2 || (s.phase !== 'playing' && s.phase !== 'offer')) add(s);
      seen.set(s.phase, n + 1);
    }
  };
  for (const seed of ['save-a', 'save-b', 'save-c', 'save-d'])
    addRun(playAll(RunEngine.create({ seed }).engine));
  // Daily-mode run (dailyDate set, start plate installed).
  const date = '2026-10-07';
  const daily = RunEngine.create({
    seed: dailySeed(date),
    mode: 'daily',
    dailyDate: date,
    pool: dailyPool(),
    startPlates: [dailyStartPlate(date)],
  }).engine;
  addRun(playAll(daily));
  // A jam loss: a forme of rivets with exactly one hole for the first tray piece.
  const jamState = RunEngine.create({ seed: 'save-jam' }).engine.snapshot();
  const first = jamState.tray[0] as { shape: string };
  jamState.cells = jamState.cells.map(() => JAM);
  for (const [dx, dy] of shapeById(first.shape).cells) jamState.cells[idx(dx, dy)] = EMPTY;
  const jam = RunEngine.restore(jamState);
  jam.place(0, 0, 0);
  add(jam.snapshot());
  jam.endRun();
  add(jam.snapshot());
  // Victory, the result screen after it, and the endless-mode offer.
  const v = nearVictoryEngine('save-victory');
  playUntilNot(v, 'playing');
  add(v.snapshot());
  if (v.state.phase === 'victory') {
    const v2 = RunEngine.restore(v.snapshot());
    v2.endRun();
    add(v2.snapshot());
    v.continueEndless();
    add(v.snapshot());
    greedyStep(v); // take the endless offer → contract 25
    add(v.snapshot());
  }
  return byPhase;
}

const SNAPSHOTS = collectSnapshots();

/** A late offer screen: long history, plates in the rack, offer cards — the biggest save. */
function richSnapshot(): RunState {
  const { engine } = RunEngine.create({ seed: 'save-rich' });
  let best = engine.snapshot();
  for (let n = 0; n < 5000 && greedyStep(engine); n++) {
    const s = engine.state;
    if (s.phase === 'offer' && s.totals.contractsWon >= best.totals.contractsWon) best = engine.snapshot();
  }
  return best;
}
const RICH = richSnapshot();
const ALL_SNAPSHOTS = [...SNAPSHOTS.values()].flat();
const firstOf = (phase: RunPhase): RunState => (SNAPSHOTS.get(phase) as RunState[])[0] as RunState;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------

describe('crc32', () => {
  it('reference implementation matches the published CRC-32 check values', () => {
    expect(refCrc32([])).toBe(0);
    expect(refCrc32(asciiBytes('123456789'))).toBe(0xcbf43926);
    expect(refCrc32(asciiBytes('12345678'))).toBe(0x9ae0daaf);
    expect(refCrc32(asciiBytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is the standard CRC-32 of the UTF-16LE code units', () => {
    expect(crc32('')).toBe(0);
    // Code units whose little-endian bytes spell "12345678".
    expect(crc32('㈱㐳㘵㠷')).toBe(0x9ae0daaf);
    for (const s of [
      'a',
      'abc',
      '123456789',
      'The quick brown fox jumps over the lazy dog',
      'zażółć gęślą jaźń',
      'PRESS · Wyzwanie dnia 2026-10-07 (r1) 🟥🟧🟨🟩🟦⬜⬛',
      '\u0000',
      '￿',
      '\ud800', // lone surrogate: still just a code unit
      '{"a":[1,2,3],"b":"\\"quoted\\""}',
    ]) {
      expect(crc32(s), JSON.stringify(s)).toBe(refStringCrc(s));
    }
  });

  it('matches the reference on 1,000 seeded random strings', () => {
    const rng = Rng.fromSeed('crc32-random');
    for (let n = 0; n < 1000; n++) {
      const len = rng.int(80);
      let s = '';
      for (let i = 0; i < len; i++)
        s += String.fromCharCode(rng.chance(0.7) ? 32 + rng.int(95) : rng.int(0x10000));
      const c = crc32(s);
      expect(c).toBe(refStringCrc(s));
      expect(Number.isInteger(c) && c >= 0 && c <= 0xffffffff).toBe(true);
    }
  });

  it('matches the reference on a real encoded payload and detects every single code-unit change', () => {
    const payload = JSON.stringify(firstOf('offer'));
    expect(crc32(payload)).toBe(refStringCrc(payload));
    const base = crc32(payload);
    const rng = Rng.fromSeed('crc32-flip');
    for (let n = 0; n < 500; n++) {
      const i = rng.int(payload.length);
      const c = payload.charCodeAt(i) ^ (1 + rng.int(0xffff));
      const mutated = payload.slice(0, i) + String.fromCharCode(c) + payload.slice(i + 1);
      expect(crc32(mutated)).not.toBe(base);
    }
  });
});

describe('encodeSave / decodeSave', () => {
  it('writes the {schema, rules, seq, crc, payload} envelope', () => {
    const snap = firstOf('playing');
    const env = JSON.parse(encodeSave(snap, 7)) as SaveEnvelope;
    expect(Object.keys(env).sort()).toEqual(['crc', 'payload', 'rules', 'schema', 'seq']);
    expect(env.schema).toBe(SAVE_SCHEMA);
    expect(env.rules).toBe(RULES_VERSION);
    expect(env.seq).toBe(7);
    expect(env.payload).toBe(JSON.stringify(snap));
    expect(env.crc).toBe(refStringCrc(env.payload));
  });

  it('round-trips real RunEngine snapshots of every phase', () => {
    let seq = 1;
    for (const snap of ALL_SNAPSHOTS) {
      const loaded = decodeSave(encodeSave(snap, seq), isRunState);
      expect(loaded).not.toBeNull();
      expect(loaded?.value).toEqual(snap);
      expect(loaded?.seq).toBe(seq);
      expect(loaded?.rules).toBe(RULES_VERSION);
      seq++;
    }
  });

  it('a decoded save resumes into exactly the same game', () => {
    const { engine } = RunEngine.create({ seed: 'save-resume' });
    for (let n = 0; n < 25; n++) greedyStep(engine);
    const loaded = decodeSave(encodeSave(engine.snapshot(), 3), isRunState);
    expect(loaded).not.toBeNull();
    const resumed = RunEngine.restore((loaded as Loaded<RunState>).value);
    for (let n = 0; n < 60; n++) {
      const a = greedyStep(engine);
      const b = greedyStep(resumed);
      expect(b).toEqual(a);
      if (!a) break;
    }
    expect(resumed.snapshot()).toEqual(engine.snapshot());
  });

  it('returns null for empty / non-envelope input', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'null',
      'true',
      '0',
      '42',
      '"text"',
      '[]',
      '{}',
      '{',
      'garbage',
      '[{"schema":1}]',
    ]) {
      expect(decodeSave(raw, isRunState)).toBeNull();
    }
  });

  const envelope = (over: Record<string, unknown>): string => {
    const env = JSON.parse(encodeSave(firstOf('playing'), 5)) as Record<string, unknown>;
    return JSON.stringify({ ...env, ...over });
  };

  it('schema mismatch → null', () => {
    expect(decodeSave(envelope({}), isRunState)).not.toBeNull();
    expect(decodeSave(envelope({ schema: SAVE_SCHEMA + 1 }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ schema: SAVE_SCHEMA - 1 }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ schema: String(SAVE_SCHEMA) }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ schema: undefined }), isRunState)).toBeNull();
  });

  it('a different rules version still loads (GDD §12.4: play on with the saved values)', () => {
    const loaded = decodeSave(envelope({ rules: RULES_VERSION + 5 }), isRunState);
    expect(loaded?.rules).toBe(RULES_VERSION + 5);
    expect(loaded?.value).toEqual(firstOf('playing'));
    expect(decodeSave(envelope({ rules: undefined }), isRunState)?.rules).toBe(0);
  });

  it('rejects envelopes with a bad crc, payload or seq', () => {
    const env = JSON.parse(envelope({})) as SaveEnvelope;
    expect(decodeSave(envelope({ crc: (env.crc + 1) >>> 0 }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ crc: String(env.crc) }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ crc: undefined }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ payload: JSON.parse(env.payload) as unknown }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ payload: undefined }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ seq: '5' }), isRunState)).toBeNull();
    expect(decodeSave(envelope({ seq: undefined }), isRunState)).toBeNull();
    // Correct CRC over a payload that is not JSON.
    expect(decodeSave(envelope({ payload: '{not json', crc: crc32('{not json') }), isRunState)).toBeNull();
    // Correct CRC over JSON that is not a RunState.
    const other = JSON.stringify({ hello: 'world' });
    expect(decodeSave(envelope({ payload: other, crc: crc32(other) }), isRunState)).toBeNull();
  });

  it('never throws, even when the validator does', () => {
    const raw = encodeSave({ a: 1 }, 1);
    const boom = (v: unknown): v is unknown => {
      throw new Error(`validator exploded on ${JSON.stringify(v)}`);
    };
    expect(decodeSave(raw, boom)).toBeNull();
    const any = (v: unknown): v is unknown => v !== undefined;
    expect(decodeSave(raw, any)).toEqual({ value: { a: 1 }, seq: 1, rules: RULES_VERSION });
  });

  it('FUZZ: truncation at every offset never throws and never yields a different value', () => {
    for (const snap of [RICH, firstOf('playing')]) {
      const raw = encodeSave(snap, 42);
      for (let n = 0; n < raw.length; n++) {
        let res: Loaded<RunState> | null = null;
        expect(() => (res = decodeSave(raw.slice(0, n), isRunState))).not.toThrow();
        expect(res).toBeNull();
      }
      expect(decodeSave(raw, isRunState)?.value).toEqual(snap);
    }
  });

  it('FUZZ: truncation at every UTF-8 byte offset of a non-ASCII save never throws', () => {
    const value = { grid: '🟥🟧🟨🟩🟦⬜⬛', tips: ['zażółć', 'gęślą', 'jaźń'], n: [1, 2, 3] };
    const isObj = (v: unknown): v is typeof value => typeof v === 'object' && v !== null;
    const raw = encodeSave(value, 9);
    const bytes = new TextEncoder().encode(raw);
    expect(bytes.length).toBeGreaterThan(raw.length);
    const dec = new TextDecoder();
    for (let n = 0; n < bytes.length; n++) {
      const text = dec.decode(bytes.slice(0, n));
      let res: Loaded<typeof value> | null = null;
      expect(() => (res = decodeSave(text, isObj))).not.toThrow();
      expect(res).toBeNull();
    }
    expect(decodeSave(dec.decode(bytes), isObj)?.value).toEqual(value);
  });

  it('FUZZ: a single changed character (≥2,000 positions) never throws and never yields a different value', () => {
    const snap = RICH;
    expect(snap.phase).toBe('offer');
    const raw = encodeSave(snap, 42);
    expect(raw.length).toBeGreaterThanOrEqual(2000);
    const rng = Rng.fromSeed('save-flip');
    const nasty = '"\\{}[],:0123456789-+.eEtrufalsn \u0000 🟥';
    let tried = 0;
    let accepted = 0;
    let threw = 0;
    for (let i = 0; i < raw.length; i++) {
      const orig = raw.charCodeAt(i);
      const candidates = [
        String.fromCharCode(orig ^ (1 << rng.int(7))),
        nasty[rng.int(nasty.length)] as string,
      ];
      for (const ch of candidates) {
        if (ch === raw[i]) continue;
        const mutated = raw.slice(0, i) + ch + raw.slice(i + 1);
        tried++;
        let res: Loaded<RunState> | null = null;
        try {
          res = decodeSave(mutated, isRunState);
        } catch {
          threw++;
          continue;
        }
        if (res !== null) {
          accepted++;
          expect((res as Loaded<RunState>).value).toEqual(snap);
          expect(typeof (res as Loaded<RunState>).seq).toBe('number');
        }
      }
    }
    expect(threw).toBe(0);
    expect(tried).toBeGreaterThanOrEqual(2000);
    // Only envelope digits outside the CRC-protected payload (seq / rules) can survive a flip.
    expect(accepted).toBeLessThan(tried / 100);
  });

  it('FUZZ: random multi-character corruption and garbage never throw', () => {
    const raw = encodeSave(firstOf('playing'), 1);
    const rng = Rng.fromSeed('save-garbage');
    for (let n = 0; n < 1000; n++) {
      let s = raw;
      const edits = 1 + rng.int(8);
      for (let k = 0; k < edits; k++) {
        const i = rng.int(s.length);
        const op = rng.int(3);
        const ch = String.fromCharCode(rng.int(128));
        s =
          op === 0
            ? s.slice(0, i) + s.slice(i + 1)
            : op === 1
              ? s.slice(0, i) + ch + s.slice(i)
              : s.slice(0, i) + ch + s.slice(i + 1);
      }
      let res: Loaded<RunState> | null = null;
      expect(() => (res = decodeSave(s, isRunState))).not.toThrow();
      if (res !== null) expect((res as Loaded<RunState>).value).toEqual(firstOf('playing'));
    }
    for (let n = 0; n < 500; n++) {
      let s = '';
      const len = rng.int(60);
      for (let i = 0; i < len; i++) s += String.fromCharCode(rng.int(0x10000));
      expect(() => decodeSave(s, isRunState)).not.toThrow();
      expect(decodeSave(s, isRunState)).toBeNull();
    }
  });
});

describe('pickLatest (A/B slots)', () => {
  const L = (seq: number, tag = ''): Loaded<string> => ({
    value: `v${seq}${tag}`,
    seq,
    rules: RULES_VERSION,
  });

  it('tolerates nulls', () => {
    expect(pickLatest<string>(null, null)).toBeNull();
    const a = L(3);
    expect(pickLatest(a, null)).toBe(a);
    expect(pickLatest(null, a)).toBe(a);
  });

  it('picks the highest seq regardless of slot order', () => {
    const a = L(4);
    const b = L(5);
    expect(pickLatest(a, b)).toBe(b);
    expect(pickLatest(b, a)).toBe(b);
    expect(pickLatest(L(100), L(99))?.seq).toBe(100);
    expect(pickLatest(L(0), L(1))?.seq).toBe(1);
  });

  it('returns one of the two on equal seq', () => {
    const a = L(7, 'a');
    const b = L(7, 'b');
    expect([a, b]).toContain(pickLatest(a, b));
  });

  it('end to end: a corrupted newest slot falls back to the older valid slot', () => {
    const older = firstOf('playing');
    const newer = firstOf('offer');
    const slotA = encodeSave(older, 10);
    const slotB = encodeSave(newer, 11);
    const load = (a: string, b: string) => pickLatest(decodeSave(a, isRunState), decodeSave(b, isRunState));
    expect(load(slotA, slotB)?.value).toEqual(newer);
    expect(load(slotB, slotA)?.value).toEqual(newer);
    const broken = slotB.slice(0, slotB.length >> 1);
    expect(load(slotA, broken)?.value).toEqual(older);
    expect(load(broken, slotA)?.seq).toBe(10);
    expect(load(broken, '')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

type Path = Array<string | number>;

function* paths(v: unknown, prefix: Path = []): Generator<Path> {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      yield [...prefix, i];
      yield* paths(v[i], [...prefix, i]);
    }
  } else if (typeof v === 'object' && v !== null) {
    for (const k of Object.keys(v)) {
      yield [...prefix, k];
      yield* paths((v as Record<string, unknown>)[k], [...prefix, k]);
    }
  }
}

function mutate(
  root: RunState,
  path: Path,
  fn: (parent: Record<string | number, unknown>, key: string | number) => void,
): RunState {
  const copy = clone(root) as unknown as Record<string | number, unknown>;
  let node = copy;
  for (const k of path.slice(0, -1)) node = node[k] as Record<string | number, unknown>;
  fn(node, path[path.length - 1] as string | number);
  return copy as unknown as RunState;
}

/** A value of a different JSON kind than `v`. */
function kindSwap(v: unknown): unknown {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return 12345;
  if (typeof v === 'boolean') return 1;
  if (v === null) return { x: 1 };
  return 'garbage';
}

/** Keys that may legitimately be absent: optional Modifier.ink, plate counters, lazily revealed editions. */
const OPTIONAL_KEY = [
  /(^|\.)modifiers\.\d+\.ink$/,
  /^editionModifiers\.[^.]+\.\d+\.ink$/,
  /^plates\.\d+\.state\.[^.]+$/,
  /^editionModifiers\.[^.]+$/,
];

describe('isRunState', () => {
  it('real snapshots exist for every phase', () => {
    for (const p of PHASES) expect((SNAPSHOTS.get(p) as RunState[]).length, p).toBeGreaterThan(0);
    expect(
      ALL_SNAPSHOTS.some((s) => s.mode === 'daily'),
      'daily',
    ).toBe(true);
    expect(
      ALL_SNAPSHOTS.some((s) => s.plates.length > 0),
      'plates',
    ).toBe(true);
    expect(
      ALL_SNAPSHOTS.some((s) => s.endless),
      'endless',
    ).toBe(true);
    expect(
      ALL_SNAPSHOTS.some((s) => s.lossReason === 'jam'),
      'jam',
    ).toBe(true);
    expect(
      ALL_SNAPSHOTS.some((s) => s.lossReason === 'quota'),
      'quota',
    ).toBe(true);
  });

  it('accepts real snapshots at every phase (also after a JSON round trip)', () => {
    for (const s of ALL_SNAPSHOTS) {
      expect(isRunState(s), s.phase).toBe(true);
      expect(isRunState(clone(s)), s.phase).toBe(true);
    }
  });

  it('accepts a snapshot holding a stashed piece (type case)', () => {
    const engine = withPlates(RunEngine.create({ seed: 'save-stash' }).engine, ['type_case']);
    engine.stash(0);
    const s = engine.snapshot();
    expect(s.reserve).not.toBeNull();
    expect(isRunState(s)).toBe(true);
    expect(isRunState({ ...s, reserve: { ...s.reserve, shape: 'nope' } })).toBe(false);
    expect(isRunState({ ...s, reserve: { ...s.reserve, ink: 9 } })).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 0, 1, '', 'run', true, [], [firstOf('playing')]])
      expect(isRunState(v)).toBe(false);
  });

  it('rejects a wrong or missing version', () => {
    const s = firstOf('playing');
    expect(isRunState({ ...s, v: RUN_STATE_VERSION + 1 })).toBe(false);
    expect(isRunState({ ...s, v: RUN_STATE_VERSION - 1 })).toBe(false);
    expect(isRunState({ ...s, v: String(RUN_STATE_VERSION) })).toBe(false);
    expect(isRunState({ ...s, v: undefined })).toBe(false);
  });

  it('rejects a wrong cell count or invalid cell values', () => {
    const s = firstOf('playing');
    expect(isRunState({ ...s, cells: s.cells.slice(0, 63) })).toBe(false);
    expect(isRunState({ ...s, cells: [...s.cells, EMPTY] })).toBe(false);
    expect(isRunState({ ...s, cells: [] })).toBe(false);
    for (const bad of [JAM + 1, EMPTY - 1, 0.5, '0', null]) {
      const cells: unknown[] = s.cells.slice();
      cells[17] = bad;
      expect(isRunState({ ...s, cells }), String(bad)).toBe(false);
    }
    const ok = s.cells.slice();
    ok[17] = JAM;
    ok[18] = BLIND;
    expect(isRunState({ ...s, cells: ok })).toBe(true);
  });

  it('rejects unknown plate ids anywhere (rack, pool, offer)', () => {
    const offer = firstOf('offer');
    const plated = ALL_SNAPSHOTS.find((s) => s.plates.length > 0) as RunState;
    const unknown = 'not_a_plate' as MatrixId;
    expect(isRunState({ ...plated, plates: [{ ...plated.plates[0], id: unknown }] })).toBe(false);
    expect(isRunState({ ...offer, pool: [...offer.pool, unknown] })).toBe(false);
    expect(isRunState({ ...offer, offer: { ...offer.offer, cards: [unknown] } })).toBe(false);
  });

  it('rejects unknown piece shapes, bad inks and a wrong tray length', () => {
    const s = firstOf('playing');
    const piece = s.tray.find((p) => p !== null);
    expect(piece).toBeTruthy();
    expect(isRunState({ ...s, tray: [{ ...piece, shape: 'Q99' }, null, null] })).toBe(false);
    expect(isRunState({ ...s, tray: [{ ...piece, ink: BLIND + 1 }, null, null] })).toBe(false);
    expect(isRunState({ ...s, tray: [{ ...piece, ink: -1 }, null, null] })).toBe(false);
    expect(isRunState({ ...s, tray: [{ ...piece, ink: BLIND }, null, null] })).toBe(true);
    expect(isRunState({ ...s, tray: [null, null] })).toBe(false);
    expect(isRunState({ ...s, tray: [null, null, null, null] })).toBe(false);
  });

  it('rejects more plates than slots, bad phases, modes and modifiers', () => {
    const s = firstOf('playing');
    const six = MATRIX_IDS.slice(0, BALANCE.slots + 1).map((id, i) => createInstance(id, 1000 + i));
    expect(isRunState({ ...s, plates: six.slice(0, BALANCE.slots) })).toBe(true);
    expect(isRunState({ ...s, plates: six })).toBe(false);
    expect(isRunState({ ...s, phase: 'paused' })).toBe(false);
    expect(isRunState({ ...s, mode: 'endless' })).toBe(false);
    expect(isRunState({ ...s, lossReason: 'boredom' })).toBe(false);
    expect(isRunState({ ...s, editionModifiers: { 1: [{ id: 'earthquake' }] } })).toBe(false);
    const spec = { ...s.contract.spec, modifiers: [{ id: 'earthquake' }] };
    expect(isRunState({ ...s, contract: { ...s.contract, spec } })).toBe(false);
  });

  it("rejects the 'offer' phase without an offer", () => {
    expect(isRunState({ ...firstOf('offer'), offer: null })).toBe(false);
  });

  it('rejects a snapshot with any required field missing (every key, every phase)', () => {
    for (const phase of PHASES) {
      const s = firstOf(phase);
      for (const p of paths(s)) {
        if (typeof p[p.length - 1] === 'number') continue; // array elements: see length checks
        const key = p.join('.');
        const broken = mutate(s, p, (parent, k) => delete parent[k]);
        expect(() => isRunState(broken)).not.toThrow();
        if (OPTIONAL_KEY.some((re) => re.test(key))) continue;
        expect(isRunState(broken), `${phase}: missing ${key}`).toBe(false);
      }
    }
  });

  it('rejects a snapshot with any field of the wrong type (every path, every phase)', () => {
    for (const phase of PHASES) {
      for (const s of SNAPSHOTS.get(phase) as RunState[]) {
        for (const p of paths(s)) {
          const broken = mutate(s, p, (parent, k) => (parent[k] = kindSwap(parent[k])));
          expect(() => isRunState(broken)).not.toThrow();
          expect(isRunState(broken), `${phase}: wrong type at ${p.join('.')}`).toBe(false);
        }
      }
    }
  });
});
