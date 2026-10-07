/**
 * Aggregates simulator JSONL records into docs/balance-report.md (Polish headings).
 */
import { BALANCE } from '../core/config/balance';
import { MATRIX_IDS, MX, STARTER_MATRICES, matrixDef, type MatrixId } from '../core/matrices';
import { MODIFIER_IDS, baseQuota, quotaFor, isSpecialIndex, editionOf } from '../core/contracts';
import { scorePrint } from '../core/scoring';
import type { ContractRec, RunRecord } from './play';

export interface ReportOptions {
  inputs: string[];
  metas?: Array<Record<string, unknown> | null>;
  now?: Date;
}

// ------------------------------------------------------------------ stats helpers

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
function sd(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}
function se(xs: readonly number[]): number {
  return sd(xs) / Math.sqrt(xs.length);
}
function quantile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const pos = (a.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (a[lo] as number) + ((a[hi] as number) - (a[lo] as number)) * (pos - lo);
}
function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}
function f(v: number, d = 1): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(d);
}
function pc(v: number, d = 1): string {
  if (!Number.isFinite(v)) return '—';
  return `${(100 * v).toFixed(d)}%`;
}
function int(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function pm(m: number, s: number, d = 2): string {
  if (!Number.isFinite(m)) return '—';
  return `${m >= 0 ? '+' : ''}${m.toFixed(d)} ± ${Number.isFinite(s) ? s.toFixed(d) : '—'}`;
}
function bar(frac: number, width = 30): string {
  const n = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return '█'.repeat(n) + (n === 0 && frac > 0 ? '▏' : '');
}
function table(head: string[], rows: Array<Array<string | number>>, align?: string[]): string {
  const al = align ?? head.map((_, i) => (i === 0 ? 'l' : 'r'));
  const sep = al.map((a) => (a === 'l' ? ':---' : a === 'c' ? ':---:' : '---:'));
  return [
    `| ${head.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}
function status(ok: boolean | null): string {
  return ok === null ? '—' : ok ? '✅' : '❌';
}

// ------------------------------------------------------------------ record helpers

/** Projected full-contract score: points per sheet × base sheets. */
function projected(c: ContractRec): number {
  if (c.sheetsUsed <= 0) return 0;
  return (c.progress / c.sheetsUsed) * c.sheetsBase;
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

const MAIN_VARIANT = 'reroll=free,continue=never';
const TOTAL = BALANCE.editions * BALANCE.contractsPerEdition;

// ------------------------------------------------------------------ sections

interface Targets {
  c1: number;
  e1: number;
  e4: number;
  win: number;
  four: number;
  rare: number;
  modImpact: Array<{ id: string; drop: number }>;
  doubles: number;
  deadPlates: string[];
  opPlates: string[];
  rerollDiff: number;
  forcedAvailable: boolean;
}

function sectionDistribution(runs: RunRecord[]): { md: string; t: Partial<Targets> } {
  const n = runs.length;
  const won = runs.map((r) => r.contractsWon);
  const hist = new Array<number>(TOTAL + 1).fill(0);
  for (const w of won) hist[Math.min(TOTAL, w)] = (hist[Math.min(TOTAL, w)] as number) + 1;
  const maxH = Math.max(...hist);
  let cum = 0;
  const rows = hist.map((h, k) => {
    const row = [k, h, pc(h / n), pc(1 - cum / n), bar(h / maxH)];
    cum += h;
    return row;
  });
  const wins = runs.filter((r) => r.won).length;
  const winRate = wins / n;
  const winSe = Math.sqrt((winRate * (1 - winRate)) / n);
  const reachedAtLeast = (k: number) => runs.filter((r) => r.contractsWon >= k).length / n;
  const loss = groupBy(
    runs.filter((r) => !r.won),
    (r) => r.lossReason ?? 'brak',
  );
  const md = [
    '## 2. Rozkład wyrobionych zleceń',
    '',
    `Liczba runów: **${n}**. „Wyrobione” = liczba wygranych zleceń (0–24); zlecenie, na którym run się kończy, to wyrobione + 1.`,
    '',
    table(
      ['Percentyl', 'p10', 'p25', 'p50 (mediana)', 'p75', 'p90', 'średnia'],
      [
        [
          'zlecenia wyrobione',
          f(quantile(won, 0.1), 0),
          f(quantile(won, 0.25), 0),
          f(median(won), 0),
          f(quantile(won, 0.75), 0),
          f(quantile(won, 0.9), 0),
          f(mean(won), 2),
        ],
      ],
    ),
    '',
    `**Zwycięstwa (24/24): ${pc(winRate)} ± ${pc(winSe)}** · ukończona edycja 1 (≥ 3): ${pc(reachedAtLeast(3))} · edycja 4 (≥ 12): ${pc(reachedAtLeast(12))} · edycja 6 (≥ 18): ${pc(reachedAtLeast(18))}`,
    '',
    `Przyczyny porażek: ${[...loss.entries()].map(([k, v]) => `${k === 'quota' ? 'brak nakładu' : k === 'jam' ? 'zacięcie' : k} ${v.length} (${pc(v.length / n)})`).join(' · ') || '—'}`,
    '',
    table(['Wyrobione', 'Runy', '%', '≥ k (przeżycie)', 'Histogram'], rows, ['r', 'r', 'r', 'r', 'l']),
    '',
  ].join('\n');
  return { md, t: { win: winRate, e1: reachedAtLeast(3), e4: reachedAtLeast(12) } };
}

function sectionPassRates(runs: RunRecord[]): { md: string; t: Partial<Targets> } {
  const n = runs.length;
  const rows: Array<Array<string | number>> = [];
  let c1 = NaN;
  for (let i = 0; i < TOTAL; i++) {
    const recs = runs
      .map((r) => r.contracts.find((c) => c.i === i))
      .filter((c): c is ContractRec => c !== undefined);
    const reached = recs.length;
    const passed = recs.filter((c) => c.won).length;
    if (i === 0) c1 = passed / Math.max(1, reached);
    const prog = recs.map((c) => c.progress);
    const proj = recs.map(projected);
    const quotas = recs.map((c) => c.quota);
    const special = isSpecialIndex(i);
    const mods = special
      ? [...groupBy(recs, (c) => c.mods.join('+')).entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 3)
          .map(([k, v]) => `${k}:${v.length}`)
          .join(' ')
      : '';
    rows.push([
      i + 1,
      editionOf(i),
      special ? `★ ${mods}` : '',
      reached,
      pc(passed / Math.max(1, reached)),
      pc(passed / n),
      special
        ? `${int(quantile(quotas, 0.25))}–${int(quantile(quotas, 0.75))}`
        : int(baseQuota(i) > 0 ? quotaFor(i, []) : 0),
      int(median(prog)),
      `${int(quantile(proj, 0.25))} / ${int(median(proj))} / ${int(quantile(proj, 0.75))}`,
      f(median(proj) / Math.max(1, median(quotas)), 2),
      f(mean(recs.map((c) => c.sheetsUsed)), 1),
    ]);
  }
  const md = [
    '## 3. Zdawalność per zlecenie i krzywa nakładu vs wynik bota',
    '',
    'Zdawalność warunkowa = wyrobione / osiągnięte. „Wynik projekt.” = nakład na arkusz × arkusze bazowe (zlecenie kończy się natychmiast po wyrobieniu, więc surowy nakład jest ucięty na progu). Kolumna p25 / mediana / p75 dotyczy wyniku projektowanego; „×próg” = mediana projekt. / mediana progu.',
    '',
    table(
      [
        '#',
        'Ed.',
        'Specjalne (top 3)',
        'Osiągn.',
        'Zdawalność',
        'Bezwarunkowo',
        'Próg',
        'Mediana nakładu',
        'Wynik projekt. p25 / med / p75',
        '×próg',
        'Śr. arkusze',
      ],
      rows,
      ['r', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
    '',
  ].join('\n');
  return { md, t: { c1 } };
}

function sectionEarly(runs: RunRecord[]): { md: string; t: Partial<Targets> } {
  const rows: Array<Array<string | number>> = [];
  let four = 0;
  let rare = 0;
  let wonAll = 0;
  for (let e = 1; e <= BALANCE.editions; e++) {
    const wins = runs.flatMap((r) =>
      r.contracts.filter((c) => c.won && editionOf(c.i) === e && c.i < TOTAL - 1),
    );
    const n4 = wins.filter((c) => (c.cards ?? 3) >= 4).length;
    const nr = wins.filter((c) => c.rare).length;
    four += n4;
    rare += nr;
    wonAll += wins.length;
    rows.push([
      e,
      wins.length,
      pc(n4 / Math.max(1, wins.length)),
      pc(nr / Math.max(1, wins.length)),
      pc(mean(wins.map((c) => c.sheetsUsed / c.sheetsBase))),
    ]);
  }
  rows.push([
    '**razem**',
    wonAll,
    `**${pc(four / Math.max(1, wonAll))}**`,
    `**${pc(rare / Math.max(1, wonAll))}**`,
    '',
  ]);
  const md = [
    '## 4. Premia terminowa per edycja',
    '',
    `Progi: ≤ ${pc(BALANCE.earlyShare4Cards, 0)} arkuszy bazowych → 4 karty; ≤ ${pc(BALANCE.earlyShareRare, 0)} → gwarancja rzadkiej. Cel GDD: 4 karty ≈ 30–50%, rzadka ≈ 10–20%.`,
    '',
    table(['Edycja', 'Wygrane zlecenia', '4 karty', 'Gwar. rzadka', 'Śr. udział zużytych arkuszy'], rows),
    '',
  ].join('\n');
  return { md, t: { four: four / Math.max(1, wonAll), rare: rare / Math.max(1, wonAll) } };
}

function sectionModifiers(runs: RunRecord[]): { md: string; t: Partial<Targets> } {
  interface Acc {
    ratios: number[];
    specialPass: number;
    specialN: number;
    prevPass: number;
    prevN: number;
  }
  const acc = new Map<string, Acc>();
  const get = (k: string): Acc => {
    let a = acc.get(k);
    if (!a) {
      a = { ratios: [], specialPass: 0, specialN: 0, prevPass: 0, prevN: 0 };
      acc.set(k, a);
    }
    return a;
  };
  for (const r of runs) {
    for (const c of r.contracts) {
      if (!isSpecialIndex(c.i)) continue;
      const prev = r.contracts.find((p) => p.i === c.i - 1);
      const keys =
        c.mods.length === 1
          ? [c.mods[0] as string]
          : [c.mods.join('+'), ...c.mods.map((m) => `${m} (w parze)`)];
      for (const k of keys) {
        const a = get(k);
        a.specialN++;
        if (c.won) a.specialPass++;
        if (prev) {
          a.prevN++;
          if (prev.won) a.prevPass++;
          const pp = projected(prev);
          const ps = projected(c);
          // Normalise by quota so the 1.3× curve step and the modifier's quota factor are visible separately.
          if (pp > 0 && c.sheetsUsed > 0) a.ratios.push(ps / pp);
        }
      }
    }
  }
  const singles = [...acc.entries()].filter(([k]) => (MODIFIER_IDS as readonly string[]).includes(k));
  const others = [...acc.entries()]
    .filter(([k]) => !(MODIFIER_IDS as readonly string[]).includes(k))
    .sort((a, b) => b[1].specialN - a[1].specialN);
  const row = (k: string, a: Acc) => {
    const m = median(a.ratios);
    const kq = k.includes('+')
      ? k
          .split('+')
          .reduce((x, id) => x * (BALANCE.modifierQuota[id as keyof typeof BALANCE.modifierQuota] ?? 1), 1)
      : (BALANCE.modifierQuota[k.replace(' (w parze)', '') as keyof typeof BALANCE.modifierQuota] ?? NaN);
    const drop = 1 - m / BALANCE.quotaGrowth;
    return [
      k,
      a.specialN,
      pc(a.specialPass / Math.max(1, a.specialN)),
      pc(a.prevPass / Math.max(1, a.prevN)),
      `${f(quantile(a.ratios, 0.25), 2)} / **${f(m, 2)}** / ${f(quantile(a.ratios, 0.75), 2)}`,
      pc(-drop),
      f(kq, 2),
      k.includes('(w parze)') || k.includes('+') ? '' : status(drop >= 0.15 && drop <= 0.4),
    ];
  };
  const modImpact = singles.map(([k, a]) => ({ id: k, drop: 1 - median(a.ratios) / BALANCE.quotaGrowth }));
  const md = [
    '## 5. Wpływ utrudnień',
    '',
    'Stosunek = wynik projektowany (nakład/arkusz × arkusze bazowe, więc „Krótki termin” liczy 14 arkuszy) zlecenia specjalnego ÷ wynik projektowany poprzedniego (zwykłego) zlecenia tego samego runu. Bez utrudnienia oczekiwany stosunek ≈ 1,0–1,3 (wzrost matryc); „Δ vs zwykłe” = stosunek ÷ 1,30 − 1 (porównanie „przy tym samym progu”, bo próg rośnie ×1,30 na zlecenie). Cel GDD: −15…−40%.',
    '',
    table(
      [
        'Utrudnienie',
        'Zlecenia',
        'Zdawalność spec.',
        'Zdawalność poprz.',
        'Stosunek p25 / med / p75',
        'Δ vs zwykłe',
        'k progu',
        'Cel',
      ],
      singles.sort((a, b) => a[0].localeCompare(b[0])).map(([k, a]) => row(k, a)),
    ),
    '',
    others.length > 0
      ? '**Edycje 7–8 (dwa utrudnienia):**\n\n' +
        table(
          [
            'Para / utrudnienie',
            'Zlecenia',
            'Zdawalność spec.',
            'Zdawalność poprz.',
            'Stosunek p25 / med / p75',
            'Δ vs zwykłe',
            'k progu',
            '',
          ],
          others.slice(0, 20).map(([k, a]) => row(k, a)),
        )
      : '',
    '',
  ].join('\n');
  return { md, t: { modImpact } };
}

function sectionPlates(runs: RunRecord[]): string {
  interface PAcc {
    shown: number;
    offered: number;
    taken: number;
    explore: number;
    own6: number[];
    not6: number[];
    own12: number[];
    not12: number[];
    endOwned: number;
    endWins: number;
    everTaken: number[];
  }
  const acc = new Map<string, PAcc>();
  for (const id of MATRIX_IDS)
    acc.set(id, {
      shown: 0,
      offered: 0,
      taken: 0,
      explore: 0,
      own6: [],
      not6: [],
      own12: [],
      not12: [],
      endOwned: 0,
      endWins: 0,
      everTaken: [],
    });
  for (const r of runs) {
    const taken = new Set<string>();
    for (const o of r.offers) {
      for (const id of new Set(o.seen)) {
        const a = acc.get(id);
        if (a) a.shown++;
      }
      for (const id of o.final) {
        const a = acc.get(id);
        if (a) a.offered++;
      }
      if (o.action === 'take' && o.took) {
        const a = acc.get(o.took);
        if (a) {
          a.taken++;
          if (o.explore) a.explore++;
        }
        taken.add(o.took);
      }
    }
    for (const id of taken) acc.get(id)?.everTaken.push(r.contractsWon);
    const c6 = r.contracts.find((c) => c.i === 5);
    const c12 = r.contracts.find((c) => c.i === 11);
    for (const [id, a] of acc) {
      if (c6) (c6.plates.includes(id) ? a.own6 : a.not6).push(r.contractsWon);
      if (c12) (c12.plates.includes(id) ? a.own12 : a.not12).push(r.contractsWon);
      if (r.platesEnd.includes(id)) {
        a.endOwned++;
        if (r.won) a.endWins++;
      }
    }
  }
  const rows = [...acc.entries()].map(([id, a]) => {
    const def = matrixDef(id as MatrixId);
    return [
      `\`${id}\``,
      def.rarity === 'common' ? 'zwykła' : def.rarity === 'rare' ? 'rzadka' : 'legend.',
      STARTER_MATRICES.includes(id as MatrixId) ? 'start' : 'odbl.',
      a.offered,
      a.taken,
      pc(a.taken / Math.max(1, a.offered)),
      a.own6.length > 0 ? `${f(mean(a.own6), 2)} (${a.own6.length})` : '—',
      f(mean(a.not6), 2),
      a.own12.length > 0 ? `${f(mean(a.own12), 2)} (${a.own12.length})` : '—',
      f(mean(a.not12), 2),
      a.endOwned > 0 ? `${pc(a.endWins / a.endOwned)} (${a.endOwned})` : '—',
    ];
  });
  return [
    '## 6. Matryce — oferty, wybory, wyniki',
    '',
    'Oferowana = liczba ekranów oferty (po przeładowaniach), na których karta była do wzięcia; „wybór” = wzięcia / oferowania (w tym eksploracja ε). Kolumny „z/bez przy #6/#12” = średnia wyrobionych zleceń runów, które dotarły do zlecenia 6 / 12 i miały / nie miały tej matrycy na jego starcie (korelacja, nie przyczynowość — patrz §7). „Zwycięstwa gdy na końcu” = odsetek zwycięstw wśród runów kończących z tą matrycą.',
    '',
    table(
      [
        'Matryca',
        'Rzadkość',
        'Pula',
        'Oferowana',
        'Wzięta',
        'Wybór',
        'Z przy #6 (n)',
        'Bez #6',
        'Z przy #12 (n)',
        'Bez #12',
        'Zwycięstwa gdy na końcu (n)',
      ],
      rows,
      ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
    '',
  ].join('\n');
}

function sectionForced(forcedRuns: RunRecord[]): { md: string; t: Partial<Targets> } {
  if (forcedRuns.length === 0) {
    return {
      md: '## 7. Eksperyment wymuszonego wyboru\n\nBrak danych (uruchom `npm run sim -- forced --plates all --pairs 400 --out …`).\n',
      t: { deadPlates: [], opPlates: [], forcedAvailable: false },
    };
  }
  const bySeed = groupBy(forcedRuns, (r) => r.seed);
  const variants = [...new Set(forcedRuns.map((r) => r.variant))].filter((v) => v !== 'base').sort();
  const hasSkip = variants.includes('force=skip');
  interface Res {
    id: string;
    n: number;
    dC: number;
    dCse: number;
    dW: number;
    dWse: number;
    eff: number;
    effSe: number;
    effW: number;
    injected: number;
  }
  const results: Res[] = [];
  for (const v of variants) {
    const dc: number[] = [];
    const dw: number[] = [];
    const ec: number[] = [];
    const ew: number[] = [];
    let injected = 0;
    for (const recs of bySeed.values()) {
      const base = recs.find((r) => r.variant === 'base');
      const x = recs.find((r) => r.variant === v);
      if (!base || !x) continue;
      // Only seeds that reached the first offer carry information.
      if (base.contractsWon === 0 || !x.forced?.applied) continue;
      if (x.forced?.injected) injected++;
      dc.push(x.contractsWon - base.contractsWon);
      dw.push((x.won ? 1 : 0) - (base.won ? 1 : 0));
      if (hasSkip) {
        const sk = recs.find((r) => r.variant === 'force=skip');
        if (sk && sk.forced?.applied) {
          ec.push(x.contractsWon - sk.contractsWon);
          ew.push((x.won ? 1 : 0) - (sk.won ? 1 : 0));
        }
      }
    }
    results.push({
      id: v.replace('force=', ''),
      n: dc.length,
      dC: mean(dc),
      dCse: se(dc),
      dW: mean(dw),
      dWse: se(dw),
      eff: hasSkip ? mean(ec) : mean(dc),
      effSe: hasSkip ? se(ec) : se(dc),
      effW: hasSkip ? mean(ew) : mean(dw),
      injected,
    });
  }
  const plateRes = results.filter((r) => r.id !== 'skip');
  const pinned = forcedRuns.some((r) => r.forced?.pinned);
  const medEff = median(plateRes.map((r) => r.eff));
  const dead: string[] = [];
  const op: string[] = [];
  const rows = results
    .sort((a, b) => b.eff - a.eff)
    .map((r) => {
      let verdict = '';
      if (r.id !== 'skip') {
        const legendary = matrixDef(r.id as MatrixId).rarity === 'legendary';
        const isDead = r.eff <= 0 || r.eff - 2 * r.effSe <= 0;
        const isOp = medEff > 0 && r.eff > (legendary ? 4 : 2) * medEff;
        if (isDead) dead.push(r.id);
        if (isOp) op.push(r.id);
        verdict = isDead ? '**MARTWA**' : isOp ? '**ZA SILNA**' : 'ok';
      }
      return [
        `\`${r.id}\``,
        r.id === 'skip' ? 'pominięcie' : matrixDef(r.id as MatrixId).rarity,
        r.n,
        r.injected,
        pm(r.dC, r.dCse),
        pm(100 * r.dW, 100 * r.dWse, 1),
        hasSkip ? pm(r.eff, r.effSe) : '—',
        hasSkip ? pm(100 * r.effW, NaN, 1).replace(' ± —', '') : '—',
        r.id === 'skip' || !(medEff > 0) ? '' : f(r.eff / medEff, 2),
        verdict,
      ];
    });
  const opNote =
    medEff > 0
      ? ''
      : '\n> Mediana efektu ≤ 0 — kryterium „za silna” (wielokrotność mediany) nie ma sensu; patrz kolumna efektu.\n';
  const md = [
    '## 7. Eksperyment wymuszonego wyboru (pary seedów)',
    '',
    `Dla każdego seeda: run bazowy (bot wybiera sam) oraz runy, w których przy **pierwszej ofercie** bot musi wziąć matrycę X (gdy X nie ma w ofercie, wstawiamy ją w miejsce ostatniej karty przez snapshot/restore; kolumna „wstaw.”) albo pominąć ofertę (\`skip\`, +3 arkusze). ${pinned ? 'Wymuszona matryca jest **przypięta** (bot nie może jej wymienić ani sprzedać), więc efekt zawiera koszt zajętego slotu.' : 'Dalej bot gra normalnie (może wymienić wymuszoną matrycę, gdy uzna ją za słabą).'} Pary, w których bot nie wyrobił zlecenia 1, są pominięte (identyczne w obu ramionach). Δ = różnica sparowana (X − bazowy) ± błąd standardowy. **Efekt** = X − pominięcie (ta sama para seedów): ile matryca daje względem „nic + 3 arkusze”. MARTWA: efekt ≤ 0 lub nieistotny (efekt − 2·SE ≤ 0). ZA SILNA: efekt > 2× mediany efektu (zwykła/rzadka) lub > 4× (legendarna). Mediana efektu: **${f(medEff, 3)}** zlecenia.`,
    '',
    table(
      [
        'Wybór',
        'Rzadkość',
        'Pary',
        'Wstaw.',
        'Δ zleceń vs bazowy',
        'Δ zwycięstw [pp]',
        'Efekt (zlecenia) vs skip',
        'Efekt zwycięstw [pp]',
        '× mediany',
        'Werdykt',
      ],
      rows,
    ),
    '',
    `**Martwe (${dead.length}):** ${dead.map((d) => `\`${d}\``).join(', ') || '—'}`,
    '',
    `**Za silne (${op.length}):** ${op.map((d) => `\`${d}\``).join(', ') || '—'}`,
    opNote,
  ].join('\n');
  return { md, t: { deadPlates: dead, opPlates: op, forcedAvailable: true } };
}

function sectionPolicies(runRuns: RunRecord[]): { md: string; t: Partial<Targets> } {
  const byVar = groupBy(
    runRuns.filter((r) => !r.policy.force),
    (r) => r.variant,
  );
  if (byVar.size < 2) {
    return {
      md: '## 8. Polityki przeładowań i dodruku\n\nTylko jedna polityka w danych (uruchom np. `npm run sim -- run --runs 2000 --reroll none,free,ads --group policies --out …`).\n',
      t: { rerollDiff: NaN },
    };
  }
  const bySeed = groupBy(
    runRuns.filter((r) => !r.policy.force),
    (r) => r.seed,
  );
  const ref = byVar.has('reroll=none,continue=never')
    ? 'reroll=none,continue=never'
    : ([...byVar.keys()][0] as string);
  const rows: Array<Array<string | number>> = [];
  let rerollDiff = NaN;
  for (const [v, recs] of [...byVar.entries()].sort()) {
    const wr = recs.filter((r) => r.won).length / recs.length;
    const d: number[] = [];
    const dw: number[] = [];
    for (const r of recs) {
      const b = bySeed.get(r.seed)?.find((x) => x.variant === ref);
      if (b) {
        d.push(r.contractsWon - b.contractsWon);
        dw.push((r.won ? 1 : 0) - (b.won ? 1 : 0));
      }
    }
    if (v === 'reroll=ads,continue=never' && ref === 'reroll=none,continue=never') rerollDiff = mean(dw);
    rows.push([
      v,
      recs.length,
      f(mean(recs.map((r) => r.contractsWon)), 2),
      `${pc(wr)} ± ${pc(Math.sqrt((wr * (1 - wr)) / recs.length))}`,
      f(mean(recs.map((r) => r.rerolls.free)), 2),
      f(mean(recs.map((r) => r.rerolls.ad)), 2),
      pc(recs.filter((r) => r.continueUsed).length / recs.length),
      v === ref ? '(odniesienie)' : `${pm(mean(d), se(d))} / ${pm(100 * mean(dw), 100 * se(dw), 1)} pp`,
    ]);
  }
  const md = [
    '## 8. Polityki przeładowań i dodruku',
    '',
    `Te same seedy dla każdej polityki; Δ względem \`${ref}\` (sparowane). Cel GDD: różnica zwycięstw „0 przeładowań” vs „maks.” ≤ +3 pp.`,
    '',
    table(
      [
        'Polityka',
        'Runy',
        'Śr. zlecenia',
        'Zwycięstwa',
        'Darmowe przeł.',
        'Reklamowe przeł.',
        'Dodruk użyty',
        'Δ zleceń / Δ zwycięstw',
      ],
      rows,
    ),
    '',
  ].join('\n');
  return { md, t: { rerollDiff } };
}

function sectionGenerator(runs: RunRecord[]): string {
  let deals = 0;
  let fallbacks = 0;
  let mism = 0;
  let nodes = 0;
  let maxNodes = 0;
  let maxMs = 0;
  const attempts: Record<string, number> = {};
  const time: Record<string, number> = {};
  let probed = 0;
  for (const r of runs) {
    deals += r.gen.deals;
    fallbacks += r.gen.fallbacks;
    mism += r.gen.mismatches;
    nodes += r.gen.nodes;
    maxNodes = Math.max(maxNodes, r.gen.maxNodes);
    maxMs = Math.max(maxMs, r.gen.maxMs);
    for (const [k, v] of Object.entries(r.gen.attempts)) {
      attempts[k] = (attempts[k] ?? 0) + v;
      probed += v;
    }
    for (const [k, v] of Object.entries(r.gen.timeHist)) time[k] = (time[k] ?? 0) + v;
  }
  const tq = (p: number) => {
    const ks = Object.entries(time)
      .map(([k, v]) => [k === '10+' ? 10 : Number(k), v] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [k, v] of ks) {
      acc += v;
      if (acc >= p * probed) return k;
    }
    return NaN;
  };
  const attRows = Object.entries(attempts)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => [k, v, pc(v / Math.max(1, probed), 2)]);
  return [
    '## 9. Generator tac',
    '',
    `Rozdania: **${int(deals)}** · fallback konstrukcyjny: **${int(fallbacks)} (${pc(fallbacks / Math.max(1, deals), 3)})** · próbkowane przez \`dealTray\`: ${int(probed)} (niezgodności z silnikiem: ${mism}) · węzły solvera: średnio ${f(nodes / Math.max(1, probed), 1)}, maks. ${int(maxNodes)} · czas rozdania (Node, ten komputer): p50 ≤ ${f(tq(0.5) + 0.1, 1)} ms, p99 ≤ ${f(tq(0.99) + 0.1, 1)} ms, maks. ${f(maxMs, 2)} ms (cel GDD: p99 ≤ 4 ms na urządzeniu referencyjnym).`,
    '',
    table(['Próby', 'Rozdania', '%'], attRows),
    '',
  ].join('\n');
}

function analyticDoubles(): Array<{ s: number; single: number; single2: number; dbl: number }> {
  // Base rules, no plates: mixed-colour full rows 0 and 1.
  const cells = Array.from({ length: 64 }, (_, i) => (i < 16 ? i % 5 : -1));
  const out: Array<{ s: number; single: number; single2: number; dbl: number }> = [];
  const score = (rows: number[], streak: number) =>
    scorePrint({
      cells,
      lines: { rows, cols: [] },
      pieceSize: 4,
      streak,
      sheetsLeft: 10,
      sheetsUsed: 10,
      printIndex: 1,
      slots: [],
      slotCapacity: BALANCE.slots,
      random: () => 0.5,
    }).total;
  for (const s of [0, 1, 2, 3, 5, 8, 12])
    out.push({ s, single: score([0], s + 1), single2: score([0], s + 2), dbl: score([0, 1], s + 2) });
  return out;
}

function sectionDoubles(runs: RunRecord[]): { md: string; t: Partial<Targets> } {
  const agg = (rack: '0' | '1' | 'all') => {
    const m = new Map<string, [number, number]>();
    for (const r of runs) {
      for (const [k, v] of Object.entries(r.printHist)) {
        const [L, s, rk] = k.split(':');
        if (rack !== 'all' && rk !== rack) continue;
        const key = `${L}:${s}`;
        const cur = m.get(key) ?? [0, 0];
        cur[0] += v[0];
        cur[1] += v[1];
        m.set(key, cur);
      }
    }
    return m;
  };
  const avg = (m: Map<string, [number, number]>, L: number, s: number) => {
    const v = m.get(`${L}:${s}`);
    return v && v[0] >= 5 ? v[1] / v[0] : NaN;
  };
  const rowsFor = (m: Map<string, [number, number]>) => {
    const rows: Array<Array<string | number>> = [];
    const ratios: number[] = [];
    for (let s = 0; s <= 12; s++) {
      const s1 = avg(m, 1, s);
      const s2 = avg(m, 1, s + 1);
      const d = avg(m, 2, s);
      const n2 = m.get(`2:${s}`)?.[0] ?? 0;
      const ratio = d / (s1 + s2);
      if (Number.isFinite(ratio)) ratios.push(ratio);
      rows.push([s, int(s1), int(s2), int(d), n2, f(ratio, 2)]);
    }
    return { rows, ratios };
  };
  const empty = rowsFor(agg('0'));
  const all = rowsFor(agg('all'));
  const an = analyticDoubles();
  const anRows = an.map((a) => [
    a.s,
    int(a.single),
    int(a.single2),
    int(a.dbl),
    f(a.dbl / (a.single + a.single2), 2),
  ]);
  const doubles = median(empty.ratios.length > 0 ? empty.ratios : all.ratios);
  const md = [
    '## 10. Dublety vs single',
    '',
    'Porównanie: średni wynik druku 2 linii przy SERII s (przed drukiem) vs suma dwóch pojedynczych druków przy SERII s i s+1 (tyle samo linii, ta sama seria wyjściowa). Cel GDD: dublet ≥ 1,25× dwóch singli.',
    '',
    '**Analitycznie (zasady bazowe, bez matryc, linie wielobarwne):**',
    '',
    table(['SERIA s', 'Single @s', 'Single @s+1', 'Dublet @s', 'Dublet / (2 single)'], anRows),
    '',
    '**Z danych bota — pusty stojak:**',
    '',
    table(['SERIA s', 'Single @s', 'Single @s+1', 'Dublet @s', 'n dubletów', 'Stosunek'], empty.rows),
    '',
    '**Z danych bota — wszystkie druki (z matrycami):**',
    '',
    table(['SERIA s', 'Single @s', 'Single @s+1', 'Dublet @s', 'n dubletów', 'Stosunek'], all.rows),
    '',
  ].join('\n');
  return { md, t: { doubles } };
}

function sectionPerf(runs: RunRecord[], metas: Array<Record<string, unknown> | null>): string {
  const hist: Record<string, number> = {};
  let decisions = 0;
  let botMs = 0;
  let maxDec = 0;
  let wide = 0;
  let nodes = 0;
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.timing.decisionHist)) hist[k] = (hist[k] ?? 0) + v;
    decisions += r.timing.decisions;
    botMs += r.timing.botMs;
    maxDec = Math.max(maxDec, r.timing.maxDecisionMs);
    wide += r.timing.wideRetries;
    nodes += r.timing.nodes;
  }
  const ks = Object.entries(hist)
    .map(([k, v]) => [k === '100+' ? 100 : Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const q = (p: number) => {
    let acc = 0;
    for (const [k, v] of ks) {
      acc += v;
      if (acc >= p * decisions) return k;
    }
    return NaN;
  };
  const step = (b: number) => (b < 1 ? 0.1 : b < 10 ? 1 : 10);
  const runMs = runs.map((r) => r.timing.totalMs);
  const wall = metas
    .filter((m): m is Record<string, unknown> => m !== null && typeof m.wallMs === 'number')
    .map(
      (m) =>
        `${f((m.wallMs as number) / 1000, 0)} s · ${String(m.runsPerMin ?? '—')} runów/min · ${String(m.workersLast ?? '—')} wątki`,
    );
  return [
    '## 11. Wydajność bota i symulatora',
    '',
    table(
      ['Miara', 'Wartość'],
      [
        ['decyzje (ułożenia)', int(decisions)],
        ['ms / decyzja — średnio', f(botMs / Math.max(1, decisions), 3)],
        ['ms / decyzja — mediana (przedział)', `${f(q(0.5), 1)}–${f(q(0.5) + step(q(0.5)), 1)}`],
        ['ms / decyzja — p90 / p99 (przedział od)', `${f(q(0.9), 1)} / ${f(q(0.99), 1)}`],
        ['ms / decyzja — maks.', f(maxDec, 1)],
        ['węzły planera / decyzja', f(nodes / Math.max(1, decisions), 0)],
        [
          'decyzje z poszerzonym ponownym wyszukiwaniem',
          `${int(wide)} (${pc(wide / Math.max(1, decisions), 2)})`,
        ],
        [
          'ms / run — mediana / p90 (w wątku roboczym)',
          `${f(median(runMs), 1)} / ${f(quantile(runMs, 0.9), 1)}`,
        ],
        ['ostatni wsad (meta.json): czas ścienny · przepustowość', wall.length > 0 ? wall.join('; ') : '—'],
      ],
    ),
    '',
  ].join('\n');
}

function sectionContinue(runs: RunRecord[]): string {
  const used = runs.filter((r) => r.continueUsed);
  const saved = used.filter((r) => {
    const c = r.contracts.find((x) => x.i === r.continueContract);
    return c?.won;
  });
  const lc = runs.flatMap((r) => r.contracts.filter((c) => c.sold.length > 0));
  const lcWon = lc.filter((c) => c.won);
  const tc = runs.filter((r) => r.contracts.some((c) => c.plates.includes('type_case')));
  const stashes = tc.reduce((a, r) => a + (r.stashes ?? 0), 0);
  return [
    '## 12. Ostatnia szansa, dodruk, Kaszta',
    '',
    `Polityki w tej próbie: ${[...new Set(runs.map((r) => `${r.policy.reroll}/${r.policy.continue}`))].join(', ')}. Sprzedaże w „Ostatniej szansie”: ${lc.length} zleceń (uratowane: ${lcWon.length}, ${pc(lcWon.length / Math.max(1, lc.length))}). Dodruk użyty w ${used.length} runach (${pc(used.length / Math.max(1, runs.length))}); zlecenie uratowane po dodruku: ${saved.length}. Przyczyny dodruku: ${[...groupBy(used, (r) => r.continueReason ?? '?').entries()].map(([k, v]) => `${k} ${v.length}`).join(', ') || '—'}. Runy z Kasztą: ${tc.length}, odłożeń: ${stashes} (${f(stashes / Math.max(1, tc.length), 1)} na run).`,
    '',
  ].join('\n');
}

function sectionTargets(t: Partial<Targets>): string {
  const mi = t.modImpact ?? [];
  const modsOk = mi.length > 0 ? mi.every((m) => m.drop >= 0.15 && m.drop <= 0.4) : null;
  const rows: Array<Array<string | number>> = [
    [
      'Zlecenie 1 wyrobione',
      '≥ 97%',
      pc(t.c1 ?? NaN),
      status(t.c1 === undefined ? null : (t.c1 ?? 0) >= 0.97),
    ],
    ['Edycja 1 ukończona', '≥ 85%', pc(t.e1 ?? NaN), status(t.e1 === undefined ? null : (t.e1 ?? 0) >= 0.85)],
    [
      'Edycja 4 ukończona',
      '45–60%',
      pc(t.e4 ?? NaN),
      status(t.e4 === undefined ? null : (t.e4 ?? 0) >= 0.45 && (t.e4 ?? 0) <= 0.6),
    ],
    [
      'Zwycięstwo',
      '8–15%',
      pc(t.win ?? NaN),
      status(t.win === undefined ? null : (t.win ?? 0) >= 0.08 && (t.win ?? 0) <= 0.15),
    ],
    [
      'Dublet vs 2 single (mediana po SERII)',
      '≥ 1,25×',
      f(t.doubles ?? NaN, 2),
      status(Number.isFinite(t.doubles ?? NaN) ? (t.doubles as number) >= 1.25 : null),
    ],
    [
      'Każde utrudnienie',
      '−15…−40%',
      mi.map((m) => `${m.id} ${pc(-m.drop, 0)}`).join(', ') || '—',
      status(modsOk),
    ],
    [
      'Premia 4 karty',
      '30–50%',
      pc(t.four ?? NaN),
      status(t.four === undefined ? null : (t.four ?? 0) >= 0.3 && (t.four ?? 0) <= 0.5),
    ],
    [
      'Gwarancja rzadkiej',
      '10–20%',
      pc(t.rare ?? NaN),
      status(t.rare === undefined ? null : (t.rare ?? 0) >= 0.1 && (t.rare ?? 0) <= 0.2),
    ],
    [
      'Matryce: brak martwych / za silnych',
      '0 / 0',
      t.forcedAvailable ? `${(t.deadPlates ?? []).length} / ${(t.opPlates ?? []).length}` : 'brak danych',
      status(t.forcedAvailable ? (t.deadPlates ?? []).length === 0 && (t.opPlates ?? []).length === 0 : null),
    ],
    [
      'Zwycięstwa: maks. przeładowań − 0',
      '≤ +3 pp',
      Number.isFinite(t.rerollDiff ?? NaN) ? `${f(100 * (t.rerollDiff as number), 1)} pp` : 'brak danych',
      status(Number.isFinite(t.rerollDiff ?? NaN) ? (t.rerollDiff as number) <= 0.03 : null),
    ],
  ];
  return [
    '## 1. Cele GDD §19 — podsumowanie',
    '',
    table(['Cel', 'Docelowo', 'Wynik', ''], rows, ['l', 'r', 'l', 'c']),
    '',
  ].join('\n');
}

function sectionParams(records: RunRecord[], opts: ReportOptions): string {
  const groups = [...groupBy(records, (r) => `${r.group} · ${r.variant}`).entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const metaBal = (opts.metas ?? []).find((m) => m && m.balance)?.balance;
  const metaMx = (opts.metas ?? []).find((m) => m && m.mx)?.mx;
  const drift =
    (metaBal && JSON.stringify(metaBal) !== JSON.stringify(BALANCE)) ||
    (metaMx && JSON.stringify(metaMx) !== JSON.stringify(MX))
      ? '\n> ⚠️ Wartości BALANCE/MX zapisane w meta.json różnią się od bieżącego kodu — raport opisuje dane zebrane na starszych wartościach (poniżej: wartości z meta.json, jeśli są).\n'
      : '';
  const pol = records[0]?.policy;
  const groupsShown = groups.slice(0, 12);
  const groupsMore = groups.length - groupsShown.length;
  return [
    '## 14. Parametry uruchomienia i wartości balansu',
    '',
    `Wejścia: ${opts.inputs.map((i) => `\`${i}\``).join(', ')} · rekordów: **${records.length}** · wygenerowano: ${(opts.now ?? new Date()).toISOString()}`,
    '',
    `Bot: beam search (szerokość 8, scalanie stanów, wyszukiwanie z odkładaniem do Kaszty), ε-eksploracja ofert = ${pol?.epsilon ?? '—'}, pula: ${pol?.pool ?? '—'}. Polityka główna: \`${MAIN_VARIANT}\` (darmowe przeładowanie przy słabej ofercie, bez dodruku).`,
    '',
    table(
      ['Grupa · wariant', 'Runy'],
      [
        ...groupsShown.map(([k, v]) => [k, v.length] as Array<string | number>),
        ...(groupsMore > 0
          ? [[`… (+${groupsMore} wariantów)`, groups.slice(12).reduce((a, [, v]) => a + v.length, 0)]]
          : []),
      ],
    ),
    drift,
    '<details><summary>BALANCE (src/core/config/balance.ts)</summary>',
    '',
    '```json',
    JSON.stringify(metaBal ?? BALANCE, null, 1),
    '```',
    '',
    '</details>',
    '',
    '<details><summary>MX (src/core/matrices.ts)</summary>',
    '',
    '```json',
    JSON.stringify(metaMx ?? MX, null, 1),
    '```',
    '',
    '</details>',
    '',
  ].join('\n');
}

function sectionNotes(t: Partial<Targets>, main: RunRecord[]): string {
  const notes: string[] = [];
  if ((t.win ?? 0) > 0.15)
    notes.push(
      `Zwycięstwa ${pc(t.win ?? NaN)} > 15%: krzywa nakładu rośnie wolniej niż siła stojaka (bot zwykle wyrabia zlecenie w ${f(mean(main.flatMap((r) => r.contracts.filter((c) => c.won).map((c) => c.sheetsUsed))), 1)} arkuszach).`,
    );
  if ((t.win ?? 1) < 0.08) notes.push(`Zwycięstwa ${pc(t.win ?? NaN)} < 8%: gra za trudna dla bota.`);
  for (const m of t.modImpact ?? []) {
    if (m.drop < 0)
      notes.push(
        `Utrudnienie \`${m.id}\` PODNOSI wynik bota o ${pc(-m.drop, 0)} (cel: obniżka 15–40%) — działa jak bonus.`,
      );
    else if (m.drop < 0.15)
      notes.push(`Utrudnienie \`${m.id}\` obniża wynik tylko o ${pc(m.drop, 0)} (cel ≥ 15%).`);
    else if (m.drop > 0.4) notes.push(`Utrudnienie \`${m.id}\` obniża wynik o ${pc(m.drop, 0)} (cel ≤ 40%).`);
  }
  if ((t.four ?? 0) > 0.5)
    notes.push(
      `Premia 4 kart w ${pc(t.four ?? NaN)} wygranych (cel 30–50%) — progi premii terminowej są zbyt łatwe przy obecnej krzywej.`,
    );
  if ((t.rare ?? 0) > 0.2) notes.push(`Gwarancja rzadkiej w ${pc(t.rare ?? NaN)} wygranych (cel 10–20%).`);
  if (Number.isFinite(t.doubles ?? NaN) && (t.doubles as number) < 1.25)
    notes.push(`Dublet daje tylko ${f(t.doubles ?? NaN, 2)}× dwóch singli.`);
  if ((t.deadPlates ?? []).length > 0)
    notes.push(
      `Martwe matryce wg eksperymentu wymuszonego wyboru: ${(t.deadPlates ?? []).map((d) => `\`${d}\``).join(', ')}.`,
    );
  if ((t.opPlates ?? []).length > 0)
    notes.push(`Za silne matryce: ${(t.opPlates ?? []).map((d) => `\`${d}\``).join(', ')}.`);
  return [
    '## 13. Uwagi (automatyczne)',
    '',
    ...(notes.length > 0 ? notes.map((n) => `- ${n}`) : ['- brak odchyleń od celów']),
    '',
  ].join('\n');
}

function sectionContinueNote(pol: RunRecord[]): string {
  return pol.length > 0
    ? sectionContinue(pol).replace(
        '## 12. Ostatnia szansa, dodruk, Kaszta',
        '### 12a. To samo dla próby polityk (z dodrukiem)',
      )
    : '';
}

function sectionHowTo(): string {
  return [
    '## 15. Jak odtworzyć',
    '',
    '```sh',
    '# główna próba (wznawialna: ponowne uruchomienie pomija gotowe runy; długie wsady: nohup … &)',
    'npm run sim -- run --runs 10000 --out /tmp/claude-0/sim/base',
    '# eksperyment wymuszonego wyboru: wszystkie matryce + pominięcie, pary seedów',
    'npm run sim -- forced --plates all --pairs 400 --out /tmp/claude-0/sim/forced',
    '# porównanie polityk przeładowań / dodruku na tych samych seedach',
    'npm run sim -- run --runs 2000 --reroll none,free,ads --continue never,always --group policies --seed-prefix pol --out /tmp/claude-0/sim/policies',
    '# raport',
    'npm run sim -- report --in /tmp/claude-0/sim/base,/tmp/claude-0/sim/forced,/tmp/claude-0/sim/policies --out docs/balance-report.md',
    '# eksperymenty z wartościami bez edycji src/core:',
    'npm run sim -- run --runs 2000 --set quotaGrowth=1.4,MX.gutenbergStep=0.15 --out /tmp/claude-0/sim/try1',
    '```',
    '',
  ].join('\n');
}

// ------------------------------------------------------------------ entry

export function buildReport(records: RunRecord[], opts: ReportOptions): string {
  const runRecs = records.filter((r) => r.group === 'run');
  const byVar = groupBy(
    runRecs.filter((r) => !r.policy.force),
    (r) => r.variant,
  );
  let mainVar = MAIN_VARIANT;
  if (!byVar.has(mainVar))
    mainVar = [...byVar.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? MAIN_VARIANT;
  let main = byVar.get(mainVar) ?? [];
  // Fall back to forced-experiment baselines when no plain batch is present.
  if (main.length === 0) main = records.filter((r) => r.variant === 'base');
  const forcedRecs = records.filter((r) => r.group === 'forced');

  const t: Partial<Targets> = {};
  const parts: string[] = [];
  parts.push('# PRESS — raport balansu (symulator)', '');
  parts.push(
    `> Wygenerowane przez \`npm run sim -- report\` z ${records.length} runów bota (główna próba: **${main.length}** runów, wariant \`${mainVar}\`). Nie edytować ręcznie — regenerować. Liczby odnoszą się do silnego bota heurystycznego (§11), nie do przeciętnego gracza.`,
    '',
  );
  if (main.length === 0) {
    parts.push('Brak danych.');
    return parts.join('\n');
  }
  const dist = sectionDistribution(main);
  Object.assign(t, dist.t);
  const pass = sectionPassRates(main);
  Object.assign(t, pass.t);
  const early = sectionEarly(main);
  Object.assign(t, early.t);
  const mods = sectionModifiers(main);
  Object.assign(t, mods.t);
  const forced = sectionForced(forcedRecs);
  Object.assign(t, forced.t);
  const polRecs = records.filter((r) => r.group === 'policies');
  const pol = sectionPolicies(polRecs.length > 0 ? polRecs : runRecs);
  Object.assign(t, pol.t);
  const dbl = sectionDoubles(main);
  Object.assign(t, dbl.t);

  parts.push(sectionTargets(t));
  parts.push(
    dist.md,
    pass.md,
    early.md,
    mods.md,
    sectionPlates(main),
    forced.md,
    pol.md,
    sectionGenerator(main),
    dbl.md,
    sectionPerf(main, opts.metas ?? []),
    sectionContinue(runRecs),
  );
  parts.push(
    sectionContinueNote(polRecs),
    sectionNotes(t, main),
    sectionParams(records, opts),
    sectionHowTo(),
  );
  return parts.join('\n');
}
