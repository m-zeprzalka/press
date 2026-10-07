/**
 * TEMPORARY balance-exploration patches (sim only): `--set RULE.<name>=<value>` swaps plate
 * hooks at runtime so rule variants can be measured before they are written into src/core.
 */
import { ipow } from '../core/math';
import { MX, matrixDef, type MatrixDef, type MatrixInstance } from '../core/matrices';
import { RunEngine } from '../core/run';

const origIsEnabled = RunEngine.prototype.isEnabled;

type Patch = (v: number) => void;

const saved = new Map<string, MatrixDef>();
function def(id: Parameters<typeof matrixDef>[0]): MatrixDef {
  const d = matrixDef(id);
  if (!saved.has(id)) saved.set(id, { ...d });
  return d;
}

const PATCHES: Record<string, Patch> = {
  rollerPerLine: () => {
    def('roller').print = (api, p) => api.mult(MX.rollerMult * p.lineCount);
  },
  hydraulicPerLine: () => {
    def('hydraulic').print = (api, p) => api.xmult(ipow(MX.hydraulicX, p.lineCount));
  },
  crossmarkTurn: () => {
    const d = def('crossmark');
    d.initState = () => ({ last: 0 });
    d.print = (api, p, st) => {
      const dir = (p.rowCount > 0 ? 1 : 0) | (p.colCount > 0 ? 2 : 0);
      const last = st.last ?? 0;
      if (last !== 0 && (dir & ~last) !== 0) api.mult(MX.crossmarkMult);
    };
    d.afterPrint = (p, st) => {
      st.last = (p.rowCount > 0 ? 1 : 0) | (p.colCount > 0 ? 2 : 0);
    };
    d.onContractStart = (st) => {
      st.last = 0;
    };
  },
  monotypeInks: (v) => {
    def('monotype').print = (api, p) => {
      const k = p.lineInkCounts.filter((n) => n >= 1 && n <= v).length;
      if (k > 0) api.xmult(ipow(MX.monotypeX, k));
    };
  },
  cleanSheetMaxCells: (v) => {
    def('clean_sheet').print = (api, p) => {
      if (p.cellsAfter <= v) api.xmult(MX.cleanSheetX);
    };
  },
  failureSheets: (v) => {
    RunEngine.prototype.isEnabled = function (this: RunEngine, inst: MatrixInstance): boolean {
      const c = this.state.contract;
      return c.disabledUid !== inst.uid || c.sheetsUsed >= v;
    };
  },
  typeCaseSheets: (v) => {
    def('type_case').sheets = v;
  },
};

export function isRuleKey(key: string): boolean {
  return key.startsWith('RULE.');
}

export function checkRuleKey(key: string): void {
  if (!(key.slice(5) in PATCHES)) throw new Error(`Unknown rule patch ${key}`);
}

export function restoreRules(): void {
  RunEngine.prototype.isEnabled = origIsEnabled;
  for (const [id, d] of saved) Object.assign(matrixDef(id as Parameters<typeof matrixDef>[0]), d);
  for (const [id, d] of saved) {
    const cur = matrixDef(id as Parameters<typeof matrixDef>[0]) as unknown as Record<string, unknown>;
    for (const k of Object.keys(cur)) if (!(k in d)) delete cur[k];
  }
  saved.clear();
}

export function applyRule(key: string, v: number): void {
  if (v === 0) return;
  (PATCHES[key.slice(5)] as Patch)(v);
}
