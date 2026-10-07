/**
 * Save envelopes (GDD §12.4): `{schema, rules, seq, crc, payload}` written to alternating
 * A/B slots; the loader takes the valid slot with the highest sequence number and never throws.
 */
import { BALANCE } from './config/balance';
import { RULES_VERSION, SAVE_SCHEMA } from './config/version';
import { BLIND, EMPTY, INK_COUNT, JAM } from './board';
import { MODIFIER_IDS } from './contracts';
import { MATRICES, type MatrixId } from './matrices';
import { hasShape } from './pieces';
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

export function decodeSave<T>(
  raw: string | null | undefined,
  validate: (v: unknown) => v is T,
): Loaded<T> | null {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Partial<SaveEnvelope>;
    if (!env || typeof env !== 'object') return null;
    if (env.schema !== SAVE_SCHEMA) return null;
    if (typeof env.payload !== 'string' || typeof env.seq !== 'number' || typeof env.crc !== 'number')
      return null;
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

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown, lo = -Infinity, hi = Infinity): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isArr = Array.isArray;
const nums = (o: Obj, keys: readonly string[]): boolean => keys.every((k) => isNum(o[k]));
const isPlateId = (v: unknown): boolean => typeof v === 'string' && MATRICES.has(v as MatrixId);

function isPiece(v: unknown): boolean {
  if (v === null) return true;
  return (
    isObj(v) && isNum(v.uid) && typeof v.shape === 'string' && hasShape(v.shape) && isInt(v.ink, 0, BLIND)
  );
}

function isModifier(v: unknown): boolean {
  return (
    isObj(v) &&
    (MODIFIER_IDS as readonly unknown[]).includes(v.id) &&
    (v.ink === undefined || isInt(v.ink, 0, INK_COUNT - 1))
  );
}

function isSpec(v: unknown): boolean {
  return (
    isObj(v) &&
    isInt(v.index, 0) &&
    isInt(v.edition, 1) &&
    isInt(v.position, 0) &&
    isBool(v.special) &&
    nums(v, ['quota', 'sheets']) &&
    isArr(v.modifiers) &&
    v.modifiers.every(isModifier)
  );
}

const CONTRACT_NUMS = [
  'progress',
  'sheetsLeft',
  'sheetsGranted',
  'sheetsUsed',
  'printIndex',
  'streak',
  'dry',
  'trayIndex',
  'bestPrint',
];

function isContract(v: unknown): boolean {
  return (
    isObj(v) &&
    isSpec(v.spec) &&
    nums(v, CONTRACT_NUMS) &&
    (v.disabledUid === null || isNum(v.disabledUid)) &&
    isArr(v.inkPrinted) &&
    v.inkPrinted.length === INK_COUNT &&
    v.inkPrinted.every(isNum)
  );
}

function isPlate(v: unknown): boolean {
  return isObj(v) && isPlateId(v.id) && isNum(v.uid) && isObj(v.state) && Object.values(v.state).every(isNum);
}

function isOffer(v: unknown): boolean {
  return (
    isObj(v) &&
    nums(v, ['index', 'cardCount', 'rerolls', 'adRerollsHere']) &&
    isBool(v.guaranteeRare) &&
    isArr(v.cards) &&
    v.cards.every(isPlateId)
  );
}

function isContractRecord(v: unknown): boolean {
  return (
    isObj(v) &&
    nums(v, ['index', 'progress', 'quota', 'sheetsUsed']) &&
    isBool(v.won) &&
    (v.dominantInk === null || isInt(v.dominantInk, 0, INK_COUNT - 1))
  );
}

const TOTALS_NUMS = [
  'score',
  'bestPrint',
  'lines',
  'prints',
  'placements',
  'contractsWon',
  'maxStreak',
  'maxLines',
];

function isTotals(v: unknown): boolean {
  return isObj(v) && nums(v, TOTALS_NUMS) && isArr(v.history) && v.history.every(isContractRecord);
}

const PHASES: readonly unknown[] = ['playing', 'last_chance', 'offer', 'lost', 'victory', 'over'];

/**
 * Structural validation of a persisted RunState (defensive: saves can be corrupted or old).
 * Every RunState field is type-checked (ids, shapes and cell values against the catalogues).
 */
export function isRunState(v: unknown): v is RunState {
  if (!isObj(v)) return false;
  const s = v;
  if (s.v !== RUN_STATE_VERSION) return false;
  if (typeof s.seed !== 'string' || (s.mode !== 'standard' && s.mode !== 'daily')) return false;
  if (s.dailyDate !== null && typeof s.dailyDate !== 'string') return false;
  if (!PHASES.includes(s.phase)) return false;
  if (!isInt(s.contractIndex, 0) || !isNum(s.nextUid) || !isInt(s.traySize, 1, 3)) return false;
  if (
    !isObj(s.editionModifiers) ||
    !Object.values(s.editionModifiers).every((m) => isArr(m) && m.every(isModifier))
  )
    return false;
  if (!isContract(s.contract)) return false;
  if (!isArr(s.cells) || s.cells.length !== 64 || !s.cells.every((c) => isInt(c, EMPTY, JAM))) return false;
  if (!isArr(s.tray) || s.tray.length !== 3 || !s.tray.every(isPiece)) return false;
  if (!isPiece(s.reserve) || !isBool(s.stashUsed)) return false;
  if (!isArr(s.plates) || s.plates.length > BALANCE.slots || !s.plates.every(isPlate)) return false;
  if (!isArr(s.pool) || !s.pool.every(isPlateId)) return false;
  if (s.offer !== null && !isOffer(s.offer)) return false;
  if (s.phase === 'offer' && s.offer === null) return false;
  if (!nums(s, ['freeRerolls', 'adRerollsUsed', 'pendingSheets', 'carryStreak'])) return false;
  if (!isBool(s.continueUsed) || !isBool(s.endless)) return false;
  if (s.lossReason !== null && s.lossReason !== 'quota' && s.lossReason !== 'jam') return false;
  return isTotals(s.totals);
}
