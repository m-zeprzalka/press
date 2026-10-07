import { describe, expect, it } from 'vitest';
import { MATRIX_IDS } from '../../core/matrices';
import { MODIFIER_IDS } from '../../core/contracts';
import { ACHIEVEMENT_IDS } from '../../core/meta';
import { detectLang, dictionaries, fmtDecimal, fmtInt, fmtMult, format, t } from './index';

describe('i18n', () => {
  it('EN and PL have identical key sets', () => {
    const { en, pl } = dictionaries();
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  });

  it('every plate, modifier and achievement is translated', () => {
    for (const l of ['en', 'pl'] as const) {
      for (const id of MATRIX_IDS) {
        expect(t(`plate.${id}.name`, {}, l)).not.toBe(`plate.${id}.name`);
        expect(t(`plate.${id}.desc`, {}, l)).not.toBe(`plate.${id}.desc`);
      }
      for (const id of MODIFIER_IDS) {
        if (id === 'out_of_ink') {
          for (let k = 0; k < 5; k++) expect(t(`mod.out_of_ink.name.${k}`, {}, l)).not.toContain('mod.');
        } else expect(t(`mod.${id}.name`, {}, l)).not.toContain('mod.');
      }
      for (const id of ACHIEVEMENT_IDS) expect(t(`ach.${id}.name`, {}, l)).not.toContain('ach.');
    }
  });

  it('Polish plural categories', () => {
    const s = (n: number) => t('common.sheets', { n }, 'pl');
    expect(s(1)).toBe('1 arkusz');
    expect(s(2)).toBe('2 arkusze');
    expect(s(5)).toBe('5 arkuszy');
    expect(s(12)).toBe('12 arkuszy');
    expect(s(22)).toBe('22 arkusze');
    expect(t('common.sheets', { n: 1 }, 'en')).toBe('1 sheet');
    expect(t('common.sheets', { n: 3 }, 'en')).toBe('3 sheets');
    expect(t('plate.sell', { n: 0 }, 'en')).toBe('Sell · no sheets');
    expect(t('plate.sell', { n: 2 }, 'pl')).toBe('Sprzedaj · +2 arkusze');
  });

  it('interpolates and keeps unknown params', () => {
    expect(format('a {x} b {y}', { x: 5 })).toBe('a 5 b {y}');
    expect(t('missing.key')).toBe('missing.key');
  });

  it('number formatting', () => {
    expect(fmtInt(1240, 'pl')).toBe('1 240');
    expect(fmtInt(12480, 'en')).toBe('12,480');
    expect(fmtInt(999, 'en')).toBe('999');
    expect(fmtInt(56_200_000, 'en')).toBe('56.2M');
    expect(fmtInt(56_200_000, 'pl')).toBe('56,2 MLN');
    expect(fmtInt(2e15, 'en')).toBe('2e15');
    expect(fmtInt(-5, 'en')).toBe('−5');
    expect(fmtMult(12.25, 'pl')).toBe('12,25');
    expect(fmtMult(3, 'en')).toBe('3');
    expect(fmtMult(150.4, 'en')).toBe('150');
    expect(fmtDecimal(1.5, 2, 'en')).toBe('1.5');
  });

  it('detects language', () => {
    expect(detectLang(['pl-PL'])).toBe('pl');
    expect(detectLang(['de-DE', 'en-US'])).toBe('en');
    expect(detectLang([])).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});
