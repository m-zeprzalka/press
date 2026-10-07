/**
 * Tiny i18n: EN (default) + PL, ICU-lite plurals, locale-aware number formatting (GDD §17).
 *
 * Message syntax: `{name}` interpolation and
 * `{n, plural, one {# sheet} few {# sheets} many {# sheets} other {# sheets}}`
 * where `#` is the formatted number. Plural categories come from Intl.PluralRules.
 */
import { EN } from './en';
import { PL } from './pl';

export type Lang = 'en' | 'pl';
export type Dict = Record<string, string>;
export type Params = Record<string, string | number>;

const DICTS: Record<Lang, Dict> = { en: EN, pl: PL };
let lang: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

export function detectLang(languages: readonly string[] | undefined): Lang {
  for (const l of languages ?? []) {
    const code = l.toLowerCase();
    if (code.startsWith('pl')) return 'pl';
    if (code.startsWith('en')) return 'en';
  }
  return 'en';
}

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  for (const cb of listeners) cb(l);
}

export function onLangChange(cb: (l: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {};
function pluralCategory(n: number, l: Lang): string {
  const rules = (pluralRules[l] ??= new Intl.PluralRules(l === 'pl' ? 'pl-PL' : 'en-US'));
  return rules.select(n);
}

// ------------------------------------------------------------------ numbers

const NBSP = ' ';

function groupDigits(intStr: string, sep: string): string {
  let out = '';
  for (let i = 0; i < intStr.length; i++) {
    const fromEnd = intStr.length - i;
    out += intStr[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += sep;
  }
  return out;
}

/** Integer with grouping from 4 digits ("1 240" / "1,240"). Compact from 1e6, scientific from 1e15. */
export function fmtInt(n: number, l: Lang = lang): string {
  if (!Number.isFinite(n)) return '∞';
  const neg = n < 0;
  const v = Math.abs(Math.floor(n));
  let s: string;
  if (v >= 1e15) {
    const exp = Math.floor(Math.log10(v));
    const mant = v / Math.pow(10, exp);
    s = `${fmtDecimal(mant, 2, l)}e${exp}`;
  } else if (v >= 1e6) {
    const units: Array<[number, string, string]> = [
      [1e12, 'T', ' BLN'],
      [1e9, 'B', ' MLD'],
      [1e6, 'M', ' MLN'],
    ];
    const [div, en, pl] = units.find(([d]) => v >= d) as [number, string, string];
    const val = v / div;
    const digits = val >= 100 ? 0 : 1;
    s = fmtDecimal(Math.floor(val * 10 ** digits) / 10 ** digits, digits, l) + (l === 'pl' ? pl.replace(' ', NBSP) : en);
  } else {
    s = groupDigits(String(v), l === 'pl' ? NBSP : ',');
  }
  return neg ? `−${s}` : s;
}

/** Decimal with up to `max` fraction digits, trailing zeros trimmed. */
export function fmtDecimal(n: number, max: number, l: Lang = lang): string {
  const fixed = n.toFixed(max);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  const [i, f] = trimmed.split('.');
  const int = groupDigits(i as string, l === 'pl' ? NBSP : ',');
  return f ? `${int}${l === 'pl' ? ',' : '.'}${f}` : int;
}

/** Multiplier display: up to 2 decimals below 100, integers from 100 (GDD §17). */
export function fmtMult(m: number, l: Lang = lang): string {
  if (m >= 100) return fmtInt(m, l);
  return fmtDecimal(m, 2, l);
}

// ------------------------------------------------------------------ messages

function formatNumberParam(v: string | number, l: Lang): string {
  if (typeof v !== 'number') return v;
  return Number.isInteger(v) ? fmtInt(v, l) : fmtDecimal(v, 2, l);
}

/** Finds the matching closing brace for an opening brace at `start`. */
function matchBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function renderPlural(body: string, n: number, l: Lang): string {
  // body: "one {...} few {...} other {...}"
  const forms: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i] as string)) i++;
    const m = /^(=\d+|[a-z]+)\s*\{/.exec(body.slice(i));
    if (!m) break;
    const key = m[1] as string;
    const open = i + m[0].length - 1;
    const close = matchBrace(body, open);
    if (close < 0) break;
    forms[key] = body.slice(open + 1, close);
    i = close + 1;
  }
  const exact = forms[`=${n}`];
  const cat = pluralCategory(n, l);
  const chosen = exact ?? forms[cat] ?? forms.other ?? '';
  return chosen.replace(/#/g, formatNumberParam(n, l));
}

export function format(msg: string, params: Params = {}, l: Lang = lang): string {
  let out = '';
  let i = 0;
  while (i < msg.length) {
    const ch = msg[i];
    if (ch !== '{') {
      out += ch;
      i++;
      continue;
    }
    const close = matchBrace(msg, i);
    if (close < 0) {
      out += msg.slice(i);
      break;
    }
    const inner = msg.slice(i + 1, close);
    const pm = /^\s*(\w+)\s*,\s*plural\s*,(.*)$/s.exec(inner);
    if (pm) {
      const n = Number(params[pm[1] as string] ?? 0);
      out += format(renderPlural(pm[2] as string, n, l), params, l);
    } else {
      const key = inner.trim();
      const v = params[key];
      out += v === undefined ? `{${key}}` : formatNumberParam(v, l);
    }
    i = close + 1;
  }
  return out;
}

export function has(key: string, l: Lang = lang): boolean {
  return key in DICTS[l] || key in DICTS.en;
}

/** Translate `key` with params. Missing keys fall back to English, then to the key itself. */
export function t(key: string, params?: Params, l: Lang = lang): string {
  const msg = DICTS[l][key] ?? DICTS.en[key];
  if (msg === undefined) return key;
  return format(msg, params, l);
}

/** Dictionaries (for tests: parity between languages). */
export function dictionaries(): Readonly<Record<Lang, Dict>> {
  return DICTS;
}
