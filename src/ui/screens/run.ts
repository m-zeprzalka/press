/**
 * Run-flow screens: offer, plate details, pause, job rules / last print, last chance,
 * reprint, results, victory (GDD §9, §12).
 */
import { BALANCE } from '../../core/config/balance';
import type { ContractSpec, Modifier } from '../../core/contracts';
import { matrixDef, type MatrixId, type MatrixInstance } from '../../core/matrices';
import type { RunEvent, RunTotals } from '../../core/run';
import type { ScoreSource } from '../../core/scoring';
import { button, h, svgIcon } from '../dom';
import { fmtInt, fmtMult, t } from '../i18n';
import { modifierIcon, plateIcon, uiIcon } from '../iconset';
import { modifierDesc, modifierName, plateDesc, plateName, plateSellValue, rarityLabel } from '../plateText';

// ------------------------------------------------------------------ helpers

export function plateCard(id: MatrixId, opts: { inst?: MatrixInstance | null; owned?: number; locked?: boolean; extra?: Node | null; onClick?: () => void; selected?: boolean } = {}): HTMLElement {
  const rarity = matrixDef(id).rarity;
  const card = h(
    'button',
    { class: `plate-card ${rarity}${opts.selected ? ' selected' : ''}${opts.locked ? ' locked' : ''}`, type: 'button' },
    svgIcon(plateIcon(id), 'pc-icon'),
    h(
      'div',
      null,
      h('div', { class: 'pc-rarity' }, rarityLabel(id)),
      h('div', { class: 'pc-name' }, plateName(id)),
      h('div', { class: 'pc-desc' }, plateDesc(id, opts.inst ?? null, opts.owned ?? 0)),
    ),
  );
  if (opts.extra) card.append(h('div', { class: 'pc-take' }, opts.extra));
  if (opts.onClick) card.addEventListener('click', opts.onClick);
  return card;
}

function modifierRow(m: Modifier): HTMLElement {
  return h(
    'div',
    { class: 'next-edition' },
    svgIcon(modifierIcon(m.id), 'mod-icon'),
    h('div', null, h('div', { class: 'display' }, modifierName(m)), h('div', { style: 'font-size:.88rem' }, modifierDesc(m))),
  );
}

function adMark(): HTMLElement {
  return svgIcon(uiIcon('ad'), 'icon ad-mark');
}

// ------------------------------------------------------------------ offer

export interface OfferView {
  jobNumber: number;
  cards: MatrixId[];
  bonus4: boolean;
  bonusRare: boolean;
  plates: MatrixInstance[];
  nextSpecial: Modifier[] | null;
  freeRerolls: number;
  adRerollsUsed: number;
  canFreeReroll: boolean;
  canAdReroll: boolean;
  adAvailable: boolean;
  buyer: boolean;
  dailyMode: boolean;
  tutorialHint: boolean;
}

export interface OfferActions {
  take(card: number, replaceUid?: number): void;
  skip(): void;
  reroll(kind: 'free' | 'ad'): void;
}

export function buildOffer(v: OfferView, act: OfferActions): HTMLElement {
  const col = h('div', { class: 'column' });
  let selected = -1;
  let replaceMode = false;

  const render = () => {
    col.replaceChildren();
    col.append(
      h(
        'div',
        { class: 'offer-head' },
        h('div', { class: 'display muted', style: 'font-size:.85rem' }, t('offer.job_done', { n: v.jobNumber })),
        h('h2', { class: 'riso-title', style: 'font-size:1.7rem' }, replaceMode ? t('offer.replace_title') : t('offer.title')),
      ),
    );
    if (v.tutorialHint && !replaceMode) col.append(h('div', { class: 'tip', style: 'position:static;transform:none;margin:0 auto' }, t('tut.offer')));
    if (!replaceMode && (v.bonus4 || v.bonusRare)) {
      const badges = h('div', { class: 'offer-badges' });
      if (v.bonus4) badges.append(h('span', { class: 'badge' }, t('offer.bonus4')));
      if (v.bonusRare) badges.append(h('span', { class: 'badge', style: 'background:var(--ink-pink)' }, t('offer.bonus_rare')));
      col.append(badges);
    }

    if (replaceMode) {
      const card = v.cards[selected] as MatrixId;
      col.append(plateCard(card, { owned: v.plates.length, selected: true }));
      const grid = h('div', { class: 'column' });
      for (const p of v.plates) {
        const sv = plateSellValue(p.id);
        grid.append(
          plateCard(p.id, {
            inst: p,
            owned: v.plates.length,
            extra: h('div', { class: 'display', style: 'font-size:.85rem' }, t('plate.sell', { n: sv })),
            onClick: () => act.take(selected, p.uid),
          }),
        );
      }
      col.append(grid, button(t('offer.replace_cancel'), () => ((replaceMode = false), render()), { wide: true }));
      return;
    }

    if (v.cards.length === 0) col.append(h('p', { style: 'text-align:center' }, t('offer.empty')));
    v.cards.forEach((id, i) => {
      const takeBtn =
        selected === i
          ? button(
              t('offer.take'),
              () => {
                if (v.plates.length >= BALANCE.slots) {
                  replaceMode = true;
                  render();
                } else act.take(i);
              },
              { variant: 'primary', wide: true },
            )
          : null;
      col.append(
        plateCard(id, {
          owned: v.plates.length + 1,
          selected: selected === i,
          extra: takeBtn,
          onClick: () => {
            selected = selected === i ? -1 : i;
            render();
          },
        }),
      );
    });

    if (v.nextSpecial && v.nextSpecial.length) {
      col.append(h('div', { class: 'group-title' }, t('offer.next_edition', { name: v.nextSpecial.map(modifierName).join(' + ') })));
      for (const m of v.nextSpecial) col.append(modifierRow(m));
    }

    // Reroll / skip controls.
    const rerollRow = h('div', { class: 'row' });
    if (v.canFreeReroll) {
      rerollRow.append(button(t('offer.reroll_free'), () => act.reroll('free'), { icon: uiIcon('reroll'), variant: 'secondary' }));
    } else if (!v.dailyMode && v.canAdReroll && (v.adAvailable || v.buyer)) {
      const b = button(t('offer.reroll'), () => act.reroll('ad'), { icon: uiIcon('reroll'), armDelayMs: 600 });
      if (!v.buyer) b.classList.add('ad-btn'), b.prepend(adMark());
      rerollRow.append(b);
    }
    rerollRow.append(button(t('offer.skip', { n: BALANCE.skipSheets }), () => act.skip(), { icon: uiIcon('skip') }));
    col.append(rerollRow);
    if (!v.dailyMode) {
      col.append(
        h(
          'div',
          { class: 'muted', style: 'text-align:center;font-size:.8rem' },
          t('offer.rerolls_left', { free: v.freeRerolls, ad: v.adRerollsUsed, max: BALANCE.adRerollsPerRun }),
        ),
      );
    }
    // Current rack (tap for details is handled by the game screen; here it's informative).
    const rack = h('div', { class: 'mini-rack' });
    for (let i = 0; i < BALANCE.slots; i++) {
      const p = v.plates[i];
      rack.append(p ? h('div', { class: 'mini-plate' }, svgIcon(plateIcon(p.id), ''), h('span', null, plateName(p.id).slice(0, 10))) : h('div', { class: 'mini-plate empty' }));
    }
    col.append(rack);
  };
  render();
  return col;
}

// ------------------------------------------------------------------ plate sheet

export interface PlateSheetView {
  inst: MatrixInstance;
  slot: number;
  owned: number;
  disabled: boolean;
  inert: boolean;
  canSell: boolean;
  canMove: boolean;
}

export function buildPlateSheet(v: PlateSheetView, act: { sell(): void; move(dir: -1 | 1): void; close(): void }): HTMLElement {
  const sv = plateSellValue(v.inst.id);
  const col = h(
    'div',
    { class: 'column' },
    plateCard(v.inst.id, { inst: v.inst, owned: v.owned }),
    h('div', { class: 'muted display', style: 'font-size:.8rem;text-align:center' }, t('plate.slot', { n: v.slot + 1 })),
  );
  if (v.disabled) col.append(h('div', { class: 'badge', style: 'align-self:center;background:var(--paper-shade)' }, t('plate.disabled')));
  if (v.inert) col.append(h('div', { class: 'badge', style: 'align-self:center;background:var(--paper-shade)' }, t('plate.mirror_none')));
  if (v.canMove) {
    col.append(
      h(
        'div',
        { class: 'row' },
        button(t('plate.move_left'), () => act.move(-1), { icon: uiIcon('arrow_left'), small: true, disabled: v.slot === 0 }),
        button(t('plate.move_right'), () => act.move(1), { icon: uiIcon('arrow_right'), small: true, disabled: v.slot >= v.owned - 1 }),
      ),
    );
  }
  if (v.canSell) col.append(button(t('plate.sell', { n: sv }), act.sell, { icon: uiIcon('sell'), wide: true, variant: 'secondary' }));
  col.append(button(t('common.close'), act.close, { variant: 'ghost', wide: true }));
  return col;
}

// ------------------------------------------------------------------ pause & rules

export function buildPause(
  v: { job: number; total: number; edition: number; tutorial: boolean },
  act: { resume(): void; rules(): void; settings(): void; abandon(): void; skipTutorial(): void },
): HTMLElement {
  const col = h(
    'div',
    { class: 'column' },
    h('h2', { class: 'riso-title', style: 'font-size:2rem;text-align:center' }, t('pause.title')),
    h('div', { class: 'display muted', style: 'text-align:center' }, t('pause.job', { n: v.job, total: v.total, e: v.edition })),
    button(t('pause.resume'), act.resume, { variant: 'primary', wide: true, icon: uiIcon('play') }),
    button(t('pause.rules'), act.rules, { wide: true, icon: uiIcon('info') }),
    button(t('pause.settings'), act.settings, { wide: true, icon: uiIcon('settings') }),
  );
  if (v.tutorial) col.append(button(t('pause.skip_tutorial'), act.skipTutorial, { wide: true, icon: uiIcon('skip') }));
  else col.append(button(t('pause.abandon'), act.abandon, { wide: true, variant: 'ghost' }));
  return col;
}

export function buildRules(v: { spec: ContractSpec; sheets: number; lastPrint: Extract<RunEvent, { type: 'printed' }> | null; plates: MatrixInstance[] }): HTMLElement {
  const col = h(
    'div',
    { class: 'column' },
    h('h2', { class: 'riso-title', style: 'font-size:1.5rem' }, t('rules.title')),
    h('p', { style: 'margin:0' }, t('rules.quota', { quota: fmtInt(v.spec.quota), sheets: v.sheets })),
    h('p', { style: 'margin:0' }, t('rules.formula')),
    h('p', { style: 'margin:0' }, t('rules.streak')),
    h('p', { style: 'margin:0' }, t('rules.bonus')),
    h('div', { class: 'group-title' }, t('rules.modifiers')),
  );
  if (v.spec.modifiers.length === 0) col.append(h('p', { class: 'muted', style: 'margin:0' }, t('rules.none')));
  for (const m of v.spec.modifiers) col.append(modifierRow(m));
  col.append(h('div', { class: 'group-title' }, t('breakdown.title')), buildBreakdown(v.lastPrint, v.plates));
  return col;
}

/** "Last print" breakdown from the scoring event log (GDD §5.5). */
export function buildBreakdown(e: Extract<RunEvent, { type: 'printed' }> | null, plates: MatrixInstance[]): HTMLElement {
  const box = h('div', { class: 'breakdown' });
  if (!e) {
    box.append(h('div', { class: 'muted' }, t('breakdown.none')));
    return box;
  }
  const lines: string[] = [];
  const srcName = (s: ScoreSource) =>
    typeof s === 'number' ? plateName((plates[s]?.id ?? 'proof') as MatrixId) : s === 'lines' ? t('breakdown.lines') : s === 'streak' ? t('breakdown.streak') : s === 'mono' ? t('breakdown.mono') : t('breakdown.base');
  let curLine = '';
  let lineSum = 0;
  let cells = 0;
  const flushLine = () => {
    if (curLine) lines.push(`${curLine}: ${cells}×10 → ${fmtInt(lineSum)}`);
    curLine = '';
    lineSum = 0;
    cells = 0;
  };
  for (const ev of e.result.events) {
    if (ev.t === 'line') {
      flushLine();
      curLine = ev.ref.kind === 'row' ? t('breakdown.row', { n: ev.ref.n + 1 }) : t('breakdown.col', { n: ev.ref.n + 1 });
    } else if (ev.t === 'p') {
      if (ev.src === 'base') {
        if (ev.v > 0) cells++;
        lineSum += ev.v;
      } else if (curLine) lineSum += ev.v;
      if (ev.src !== 'base') lines.push(`  ${srcName(ev.src)} +${fmtInt(ev.v)}`);
    } else if (ev.t === 'lx') {
      lines.push(`  ${srcName(ev.src)} ×${fmtMult(ev.v)}`);
      lineSum = 0;
    } else if (ev.t === 'm') {
      flushLine();
      lines.push(`${srcName(ev.src)} +${fmtMult(ev.v)} → ${fmtMult(ev.M)}`);
    } else if (ev.t === 'x') {
      flushLine();
      lines.push(`${srcName(ev.src)} ×${fmtMult(ev.v)} → ${fmtMult(ev.M)}`);
    }
  }
  flushLine();
  lines.push(`${t('breakdown.total')}: ${fmtInt(e.result.prints)} × ${fmtMult(e.result.mult)} = ${fmtInt(e.result.total)}`);
  for (const l of lines) box.append(h('div', { class: 'bline' }, l));
  return box;
}

// ------------------------------------------------------------------ last chance & reprint

export function buildLastChance(
  v: { gap: number; plates: MatrixInstance[] },
  act: { sell(uid: number): void; end(): void },
): HTMLElement {
  const col = h(
    'div',
    { class: 'column' },
    h('h2', { class: 'riso-title', style: 'font-size:1.6rem' }, t('last.title')),
    h('p', { style: 'margin:0' }, t('last.body', { gap: fmtInt(v.gap) })),
  );
  for (const p of v.plates) {
    const sv = plateSellValue(p.id);
    if (sv <= 0) continue;
    col.append(plateCard(p.id, { inst: p, owned: v.plates.length, extra: button(t('plate.sell', { n: sv }), () => act.sell(p.uid), { variant: 'secondary', wide: true }) }));
  }
  col.append(button(t('last.end'), act.end, { wide: true }));
  return col;
}

export interface ReprintView {
  reason: 'jam' | 'quota';
  gap: number;
  mode: 'free' | 'ad' | 'buyer';
  adAvailable: boolean;
  showNoAdsHint: boolean;
}

export function buildReprint(v: ReprintView, act: { accept(): void; decline(): void; noAds(): void }): HTMLElement {
  const col = h(
    'div',
    { class: 'column' },
    h('h2', { class: 'riso-title', style: 'font-size:1.7rem' }, t('reprint.title')),
    h('p', { style: 'margin:0' }, v.reason === 'jam' ? t('reprint.body_jam') : t('reprint.body_quota', { n: BALANCE.continueSheets, gap: fmtInt(v.gap) })),
  );
  const label = v.mode === 'free' ? t('reprint.free') : v.mode === 'buyer' ? t('reprint.buyer') : t('reprint.ad');
  const accept = button(label, act.accept, { variant: 'primary', wide: true, armDelayMs: 600, disabled: v.mode === 'ad' && !v.adAvailable });
  if (v.mode === 'ad') accept.prepend(adMark());
  const decline = button(t('reprint.decline'), act.decline, { wide: true, armDelayMs: 600 });
  col.append(h('div', { class: 'row' }, decline, accept));
  if (v.mode === 'free') col.append(h('div', { class: 'muted', style: 'text-align:center;font-size:.85rem' }, t('reprint.free_note')));
  if (v.mode === 'ad' && !v.adAvailable) col.append(h('div', { class: 'muted', style: 'text-align:center;font-size:.85rem' }, t('reprint.unavailable')));
  if (v.showNoAdsHint) col.append(button(t('reprint.noads_hint'), act.noAds, { variant: 'ghost', small: true }));
  return col;
}

// ------------------------------------------------------------------ results & victory

export interface ResultsView {
  won: boolean;
  cause: 'jam' | 'quota' | null;
  totals: RunTotals;
  record: boolean;
  unlocks: MatrixId[];
  achievements: string[];
  daily: { grid: string } | null;
  canRetryDaily: boolean;
}

export function buildResults(v: ResultsView, act: { newRun(): void; menu(): void; share(): void; retryDaily(): void }): HTMLElement {
  const tile = (k: string, val: string) => h('div', { class: 'stat-tile' }, h('div', { class: 'v' }, val), h('div', { class: 'k' }, k));
  const col = h(
    'div',
    { class: 'column' },
    h('h1', { class: 'riso-title', style: 'font-size:2.2rem;text-align:center' }, v.won ? t('results.title_won') : t('results.title_lost')),
  );
  if (!v.won && v.cause) col.append(h('div', { class: 'display muted', style: 'text-align:center' }, v.cause === 'jam' ? t('results.cause_jam') : t('results.cause_quota')));
  if (v.record) col.append(h('div', { class: 'badge', style: 'align-self:center;background:var(--ink-pink);font-size:1rem' }, t('results.new_record')));
  col.append(
    h(
      'div',
      { class: 'results-stats' },
      tile(t('results.jobs'), String(v.totals.contractsWon)),
      tile(t('results.score'), fmtInt(v.totals.score)),
      tile(t('results.best_print'), fmtInt(v.totals.bestPrint)),
      tile(t('results.lines'), fmtInt(v.totals.lines)),
      tile(t('results.max_streak'), String(v.totals.maxStreak)),
    ),
  );
  if (v.daily) col.append(h('div', { class: 'grid-line', 'aria-hidden': 'true' }, v.daily.grid));
  for (const id of v.unlocks) col.append(h('div', { class: 'next-edition' }, svgIcon(plateIcon(id), 'mod-icon'), h('div', { class: 'display' }, t('results.unlocked', { name: plateName(id) }))));
  for (const a of v.achievements) col.append(h('div', { class: 'badge', style: 'align-self:center' }, t('results.achievement', { name: a })));
  col.append(button(t('results.share'), act.share, { icon: uiIcon('share'), wide: true, variant: 'secondary' }));
  if (v.canRetryDaily) col.append(button(t('results.daily_again'), act.retryDaily, { icon: uiIcon('restart'), wide: true }));
  col.append(h('div', { class: 'row' }, button(t('results.menu'), act.menu, { icon: uiIcon('home') }), button(t('results.new_run'), act.newRun, { variant: 'primary', icon: uiIcon('restart') })));
  return col;
}

export function buildVictory(totals: RunTotals, act: { endless(): void; finish(): void }): HTMLElement {
  return h(
    'div',
    { class: 'column', style: 'text-align:center' },
    svgIcon(uiIcon('trophy'), 'icon'),
    h('h1', { class: 'riso-title', style: 'font-size:2.4rem' }, t('victory.title')),
    h('p', null, t('victory.body')),
    h('div', { class: 'display', style: 'font-size:1.6rem' }, fmtInt(totals.score)),
    button(t('victory.endless'), act.endless, { variant: 'primary', wide: true }),
    button(t('victory.finish'), act.finish, { wide: true }),
  );
}
