/**
 * Localized plate & modifier texts with live values (GDD §8.2, §17).
 */
import type { Modifier } from '../core/contracts';
import { BALANCE } from '../core/config/balance';
import { MX, matrixDef, sellValue, type MatrixId, type MatrixInstance } from '../core/matrices';
import { fmtMult, t } from './i18n';

export function plateName(id: MatrixId): string {
  return t(`plate.${id}.name`);
}

/** Description with the plate's current values (scaling counters, Stencil's current factor). */
export function plateDesc(id: MatrixId, inst?: MatrixInstance | null, ownedCount = 0): string {
  const def = matrixDef(id);
  const params: Record<string, number | string> = { ...def.params(inst?.state ?? def.initState?.() ?? {}) };
  if (id === 'stencil') {
    const empty = Math.max(0, BALANCE.slots - Math.max(1, ownedCount));
    params.now = fmtMult(1 + MX.stencilPerEmpty * empty);
  }
  return t(`plate.${id}.desc`, params);
}

export function rarityLabel(id: MatrixId): string {
  return t(`rarity.${matrixDef(id).rarity}`);
}

export function plateSellValue(id: MatrixId): number {
  return sellValue(id);
}

/** Short dynamic badge for rack cards (scaling plates). */
export function plateBadge(inst: MatrixInstance, ownedCount: number): string | null {
  const st = inst.state;
  switch (inst.id) {
    case 'journeyman':
      return `+${st.mult ?? MX.journeymanStart}`;
    case 'archive':
      return `+${st.bonus ?? 0}`;
    case 'ink_well':
      return `+${st.mult ?? 0}`;
    case 'gutenberg':
      return `×${fmtMult(st.x ?? MX.gutenbergStart)}`;
    case 'scrap':
      return (st.stored ?? 0) > 0 ? `+${st.stored}` : null;
    case 'stencil':
      return `×${fmtMult(1 + MX.stencilPerEmpty * Math.max(0, BALANCE.slots - ownedCount))}`;
    default:
      return null;
  }
}

export function modifierName(m: Modifier): string {
  if (m.id === 'out_of_ink') return t(`mod.out_of_ink.name.${m.ink ?? 0}`);
  return t(`mod.${m.id}.name`);
}

export function modifierDesc(m: Modifier): string {
  if (m.id === 'out_of_ink') return t(`mod.out_of_ink.desc.${m.ink ?? 0}`);
  if (m.id === 'rush') return t('mod.rush.desc', { n: BALANCE.rushSheets, base: BALANCE.baseSheets });
  if (m.id === 'big_format')
    return t('mod.big_format.desc', { n: BALANCE.bigFormatSheets, base: BALANCE.baseSheets });
  if (m.id === 'failure') return t('mod.failure.desc', { n: BALANCE.failureSheets });
  return t(`mod.${m.id}.desc`);
}
