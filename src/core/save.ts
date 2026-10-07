/**
 * Save envelopes (GDD §12.4): `{schema, rules, seq, crc, payload}` written to alternating
 * A/B slots; the loader takes the valid slot with the highest sequence number and never throws.
 */
import { RULES_VERSION, SAVE_SCHEMA } from './config/version';
import { MATRICES, type MatrixId } from './matrices';
import { RUN_STATE_VERSION, type RunState } from './run';

export interface SaveEnvelope {
  schema: number;
  rules: number;
  seq: number;
  crc: number;
  payload: string;
}

export interface Loaded<T> {
  value: T;
  seq: number;
  rules: number;
}

let CRC_TABLE: Uint32Array | null = null;

function table(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

/** CRC-32 of a string's UTF-16 code units (sufficient for corruption detection). */
export function crc32(text: string): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    c = (t[(c ^ code) & 0xff] as number) ^ (c >>> 8);
    c = (t[(c ^ (code >>> 8)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function encodeSave(value: unknown, seq: number): string {
  const payload = JSON.stringify(value);
  const env: SaveEnvelope = { schema: SAVE_SCHEMA, rules: RULES_VERSION, seq, crc: crc32(payload), payload };
  return JSON.stringify(env);
}

export function decodeSave<T>(raw: string | null | undefined, validate: (v: unknown) => v is T): Loaded<T> | null {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Partial<SaveEnvelope>;
    if (!env || typeof env !== 'object') return null;
    if (env.schema !== SAVE_SCHEMA) return null;
    if (typeof env.payload !== 'string' || typeof env.seq !== 'number' || typeof env.crc !== 'number') return null;
    if (crc32(env.payload) !== env.crc) return null;
    const value: unknown = JSON.parse(env.payload);
    if (!validate(value)) return null;
    return { value, seq: env.seq, rules: typeof env.rules === 'number' ? env.rules : 0 };
  } catch {
    return null;
  }
}

/** Picks the newest valid slot. */
export function pickLatest<T>(a: Loaded<T> | null, b: Loaded<T> | null): Loaded<T> | null {
  if (!a) return b;
  if (!b) return a;
  return b.seq > a.seq ? b : a;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isArr = Array.isArray;

function isPiece(v: unknown): boolean {
  if (v === null) return true;
  const p = v as { uid?: unknown; shape?: unknown; ink?: unknown };
  return !!p && isNum(p.uid) && typeof p.shape === 'string' && isNum(p.ink);
}

/** Structural validation of a persisted RunState (defensive: saves can be corrupted or old). */
export function isRunState(v: unknown): v is RunState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<RunState>;
  if (s.v !== RUN_STATE_VERSION) return false;
  if (typeof s.seed !== 'string' || (s.mode !== 'standard' && s.mode !== 'daily')) return false;
  if (!['playing', 'last_chance', 'offer', 'lost', 'victory', 'over'].includes(s.phase as string)) return false;
  if (!isNum(s.contractIndex) || !isNum(s.nextUid) || !isNum(s.traySize)) return false;
  if (!isArr(s.cells) || s.cells.length !== 64 || !s.cells.every(isNum)) return false;
  if (!isArr(s.tray) || s.tray.length !== 3 || !s.tray.every(isPiece)) return false;
  if (!isPiece(s.reserve ?? null)) return false;
  if (!isArr(s.plates) || s.plates.length > 5) return false;
  for (const p of s.plates) {
    if (!p || !MATRICES.has(p.id as MatrixId) || !isNum(p.uid) || typeof p.state !== 'object' || p.state === null) return false;
  }
  if (!isArr(s.pool) || !s.pool.every((id) => MATRICES.has(id as MatrixId))) return false;
  const c = s.contract;
  if (!c || typeof c !== 'object' || !c.spec || !isNum(c.spec.quota) || !isNum(c.sheetsLeft) || !isNum(c.progress)) return false;
  if (!isArr(c.spec.modifiers) || !isArr(c.inkPrinted)) return false;
  if (s.offer !== null && (typeof s.offer !== 'object' || !isArr(s.offer?.cards))) return false;
  if (!s.totals || !isArr(s.totals.history) || !isNum(s.totals.score)) return false;
  if (typeof s.editionModifiers !== 'object' || s.editionModifiers === null) return false;
  return true;
}
