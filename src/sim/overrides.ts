/**
 * Runtime BALANCE / MX overrides for balance experiments without editing src/core
 * (`--set quotaGrowth=1.35,MX.gutenbergStep=0.2,modifierQuota.rush=0.7,jamCount.0=3`).
 *
 * Keys without a prefix resolve to BALANCE first, then MX. A few MX values are copied into
 * plate definitions when matrices.ts loads (Ream sheets, Conveyor grace/carry); those defs are
 * patched too. Every call restores the defaults first, so a worker can switch override sets.
 */
import { BALANCE } from '../core/config/balance';
import { MX, matrixDef } from '../core/matrices';
import { applyRule, checkRuleKey, isRuleKey, restoreRules } from './rules';

export type Overrides = Record<string, number>;

const DEFAULT_BALANCE = JSON.parse(JSON.stringify(BALANCE)) as typeof BALANCE;
const DEFAULT_MX = { ...MX };
let active = '';

type Obj = Record<string, unknown>;

function resolve(key: string): { root: Obj; path: string[] } {
  const parts = key.split('.');
  if (parts[0] === 'BALANCE') return { root: BALANCE as unknown as Obj, path: parts.slice(1) };
  if (parts[0] === 'MX') return { root: MX as unknown as Obj, path: parts.slice(1) };
  if ((parts[0] as string) in BALANCE) return { root: BALANCE as unknown as Obj, path: parts };
  if ((parts[0] as string) in MX) return { root: MX as unknown as Obj, path: parts };
  throw new Error(`Unknown balance key ${key}`);
}

function setPath(root: Obj, path: string[], value: number, key: string): void {
  let o: Obj = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = o[path[i] as string];
    if (typeof next !== 'object' || next === null) throw new Error(`Bad balance key ${key}`);
    o = next as Obj;
  }
  const leaf = path[path.length - 1] as string;
  if (typeof o[leaf] !== 'number') throw new Error(`Balance key ${key} is not numeric`);
  o[leaf] = value;
}

function restoreDefaults(): void {
  const b = JSON.parse(JSON.stringify(DEFAULT_BALANCE)) as Obj;
  for (const k of Object.keys(b)) (BALANCE as unknown as Obj)[k] = b[k];
  Object.assign(MX, DEFAULT_MX);
}

function syncDefs(): void {
  matrixDef('ream').sheets = MX.reamSheets;
  matrixDef('conveyor').streakGrace = MX.conveyorGrace;
  matrixDef('conveyor').streakCarry = MX.conveyorCarry;
}

export function applyOverrides(o: Overrides | undefined): void {
  const sig = JSON.stringify(o ?? {});
  if (sig === active) return;
  restoreDefaults();
  restoreRules();
  for (const [k, v] of Object.entries(o ?? {})) {
    if (isRuleKey(k)) continue;
    const { root, path } = resolve(k);
    setPath(root, path, v, k);
  }
  syncDefs();
  for (const [k, v] of Object.entries(o ?? {})) if (isRuleKey(k)) applyRule(k, v);
  active = sig;
}

export function parseOverrides(spec: string): Overrides {
  const out: Overrides = {};
  if (!spec) return out;
  for (const part of spec.split(',')) {
    const [k, v] = part.split('=');
    if (!k || v === undefined) throw new Error(`--set: expected key=value, got ${part}`);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--set: ${k} must be numeric`);
    if (isRuleKey(k.trim())) checkRuleKey(k.trim());
    else resolve(k.trim());
    out[k.trim()] = n;
  }
  return out;
}
