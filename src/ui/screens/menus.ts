/**
 * Menu screens: title, daily challenge, settings, stats & achievements, plate collection, no-ads.
 */
import { MATRIX_IDS, STARTER_MATRICES, type MatrixId } from '../../core/matrices';
import { ACHIEVEMENT_IDS, ACHIEVEMENT_UNLOCKS, type MetaState } from '../../core/meta';
import type { Settings } from '../../game/settings';
import { button, h, segmented, svgIcon, toggle } from '../dom';
import { fmtInt, t } from '../i18n';
import { logo, uiIcon } from '../iconset';
import { plateName } from '../plateText';
import { plateCard } from './run';

// ------------------------------------------------------------------ title

export interface TitleView {
  hasRun: boolean;
  dailyInProgress: boolean;
  record: number;
  showNoAds: boolean;
}

export function buildTitle(
  v: TitleView,
  act: { play(): void; resume(): void; newRun(): void; daily(): void; plates(): void; stats(): void; settings(): void; noAds(): void },
): HTMLElement {
  const col = h('div', { class: 'column', style: 'min-height:100%;justify-content:center' });
  col.append(h('div', { class: 'title-logo', html: logo(), role: 'img', 'aria-label': 'PRESS' }));
  col.append(h('div', { class: 'tagline' }, t('title.tagline')));
  const actions = h('div', { class: 'title-actions' });
  if (v.hasRun) {
    actions.append(button(t('title.resume'), act.resume, { variant: 'primary', wide: true, icon: uiIcon('play') }));
    actions.append(button(t('title.new_run'), act.newRun, { wide: true, icon: uiIcon('restart') }));
  } else {
    actions.append(button(t('title.play'), act.play, { variant: 'primary', wide: true, icon: uiIcon('play') }));
  }
  actions.append(button(v.dailyInProgress ? t('title.daily_in_progress') : t('title.daily'), act.daily, { variant: 'secondary', wide: true, icon: uiIcon('calendar') }));
  const grid = h(
    'div',
    { class: 'title-grid' },
    button(t('title.plates'), act.plates, { icon: uiIcon('plates'), small: true }),
    button(t('title.stats'), act.stats, { icon: uiIcon('stats'), small: true }),
    button(t('title.settings'), act.settings, { icon: uiIcon('settings'), small: true }),
  );
  if (v.showNoAds) grid.append(button(t('title.no_ads'), act.noAds, { icon: uiIcon('crown'), small: true }));
  actions.append(grid);
  col.append(actions);
  if (v.record > 0) col.append(h('div', { class: 'record' }, t('title.record', { score: fmtInt(v.record) })));
  return col;
}

// ------------------------------------------------------------------ daily

export interface DailyView {
  date: string;
  plate: MatrixId;
  best: { contracts: number; score: number } | null;
  attemptsUsed: number;
  attemptsMax: number;
  inProgress: boolean;
  canExtra: boolean;
  extraAvailable: boolean;
  buyer: boolean;
}

export function buildDaily(v: DailyView, act: { start(): void; resume(): void; extra(): void; back(): void }): HTMLElement {
  const col = h(
    'div',
    { class: 'column' },
    h('h1', { class: 'riso-title', style: 'font-size:2rem' }, t('daily.title')),
    h('div', { class: 'display' }, v.date),
    h('p', { style: 'margin:0' }, t('daily.rule', { plate: plateName(v.plate) })),
    plateCard(v.plate),
    h('p', { class: 'muted', style: 'margin:0;font-size:.9rem' }, t('daily.note')),
    h('div', { class: 'display' }, t('daily.attempts', { used: v.attemptsUsed, max: v.attemptsMax })),
  );
  if (v.best) col.append(h('div', { class: 'display' }, t('daily.best', { jobs: v.best.contracts, score: fmtInt(v.best.score) })));
  if (v.inProgress) col.append(button(t('title.resume'), act.resume, { variant: 'primary', wide: true, icon: uiIcon('play') }));
  else if (v.attemptsUsed < v.attemptsMax) col.append(button(t('daily.start'), act.start, { variant: 'primary', wide: true, icon: uiIcon('play') }));
  else if (v.canExtra && (v.extraAvailable || v.buyer)) {
    const b = button(t('daily.extra'), act.extra, { variant: 'secondary', wide: true, armDelayMs: 600 });
    if (!v.buyer) b.prepend(svgIcon(uiIcon('ad'), 'icon ad-mark'));
    col.append(b);
  } else col.append(h('div', { class: 'display', style: 'text-align:center;font-size:1.2rem' }, t('daily.done')));
  col.append(button(t('common.back'), act.back, { variant: 'ghost', icon: uiIcon('back') }));
  return col;
}

// ------------------------------------------------------------------ settings

export interface SettingsView {
  settings: Settings;
  privacyOptions: boolean;
  iapAvailable: boolean;
  version: string;
}

export function buildSettings(
  v: SettingsView,
  act: {
    change(patch: Partial<Settings>): void;
    privacyOptions(): void;
    policy(): void;
    restore(): void;
    tutorial(): void;
    resetTips(): void;
    back(): void;
  },
): HTMLElement {
  const s = v.settings;
  const row = (labelText: string, control: HTMLElement, hint?: string) =>
    h('div', { class: 'setting' }, h('div', null, h('div', null, labelText), hint ? h('div', { class: 'hint' }, hint) : null), control);
  const slider = (value: number, onInput: (x: number) => void, label: string) => {
    const r = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(value * 100)), 'aria-label': label }) as HTMLInputElement;
    r.addEventListener('input', () => onInput(Number(r.value) / 100));
    return r;
  };
  const col = h(
    'div',
    { class: 'column' },
    h('h1', { class: 'riso-title', style: 'font-size:2rem' }, t('settings.title')),
    h('div', { class: 'group-title' }, t('settings.group.access')),
    row(t('settings.symbols'), toggle(s.symbols, (x) => act.change({ symbols: x }), t('settings.symbols')), t('settings.symbols_hint')),
    row(
      t('settings.reduce_motion'),
      toggle(s.reduceMotion ?? false, (x) => act.change({ reduceMotion: x }), t('settings.reduce_motion')),
    ),
    row(
      t('settings.controls'),
      segmented(
        [
          { value: 'drag', label: t('settings.controls.drag') },
          { value: 'tap', label: t('settings.controls.tap') },
        ],
        s.controls,
        (x) => act.change({ controls: x }),
      ),
    ),
    row(
      t('settings.counter_speed'),
      segmented(
        [
          { value: 'normal', label: t('settings.speed.normal') },
          { value: 'fast', label: t('settings.speed.fast') },
          { value: 'instant', label: t('settings.speed.instant') },
        ],
        s.counterSpeed,
        (x) => act.change({ counterSpeed: x }),
      ),
    ),
    h('div', { class: 'group-title' }, t('settings.group.sound')),
    row(t('settings.music'), slider(s.music, (x) => act.change({ music: x }), t('settings.music'))),
    row(t('settings.sfx'), slider(s.sfx, (x) => act.change({ sfx: x }), t('settings.sfx'))),
    row(t('settings.haptics'), toggle(s.haptics, (x) => act.change({ haptics: x }), t('settings.haptics'))),
    h('div', { class: 'group-title' }, t('settings.group.game')),
    row(
      t('settings.language'),
      segmented(
        [
          { value: 'auto', label: t('settings.language.auto') },
          { value: 'en', label: 'EN' },
          { value: 'pl', label: 'PL' },
        ],
        s.lang,
        (x) => act.change({ lang: x }),
      ),
    ),
    row(t('settings.fullscreen'), toggle(s.fullscreen, (x) => act.change({ fullscreen: x }), t('settings.fullscreen'))),
    row(t('settings.tips'), toggle(s.tips, (x) => act.change({ tips: x }), t('settings.tips'))),
    h('div', { class: 'row' }, button(t('settings.reset_tips'), act.resetTips, { small: true }), button(t('settings.tutorial'), act.tutorial, { small: true })),
    h('div', { class: 'group-title' }, t('settings.group.privacy')),
  );
  if (v.privacyOptions) col.append(button(t('settings.privacy_options'), act.privacyOptions, { wide: true, icon: uiIcon('privacy') }));
  col.append(button(t('settings.privacy_policy'), act.policy, { wide: true, variant: 'ghost' }));
  if (v.iapAvailable) col.append(button(t('settings.restore'), act.restore, { wide: true, small: true }));
  col.append(
    h('p', { class: 'muted', style: 'font-size:.8rem;margin:8px 0 0' }, t('settings.credits')),
    h('p', { class: 'muted', style: 'font-size:.8rem;margin:0' }, t('settings.version', { v: v.version })),
    button(t('common.back'), act.back, { icon: uiIcon('back'), wide: true }),
  );
  return col;
}

// ------------------------------------------------------------------ stats & achievements

export function buildStats(meta: MetaState, act: { back(): void }): HTMLElement {
  const st = meta.stats;
  const kv = (k: string, v: string) => h('div', { class: 'kv' }, h('span', null, k), h('b', null, v));
  const fav = Object.entries(st.picks).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  const col = h(
    'div',
    { class: 'column' },
    h('h1', { class: 'riso-title', style: 'font-size:2rem' }, t('stats.title')),
    kv(t('stats.runs'), fmtInt(st.runs)),
    kv(t('stats.wins'), fmtInt(st.wins)),
    kv(t('stats.best_contracts'), fmtInt(st.bestContracts)),
    kv(t('stats.best_score'), fmtInt(st.bestScore)),
    kv(t('stats.best_print'), fmtInt(st.bestPrint)),
    kv(t('stats.total_score'), fmtInt(st.totalScore)),
    kv(t('stats.total_lines'), fmtInt(st.totalLines)),
    kv(t('stats.max_streak'), fmtInt(st.maxStreak)),
    kv(t('stats.max_lines'), fmtInt(st.maxLines)),
    kv(t('stats.crosses'), fmtInt(st.crosses)),
    kv(t('stats.mono_lines'), fmtInt(st.monoLines)),
    kv(t('stats.daily_streak'), fmtInt(st.dailyStreak)),
    kv(t('stats.favorite'), fav ? plateName(fav[0] as MatrixId) : t('stats.none')),
    h('h2', { class: 'riso-title', style: 'font-size:1.5rem;margin-top:12px' }, t('achievements.title')),
  );
  for (const id of ACHIEVEMENT_IDS) {
    const got = meta.achievements[id] !== undefined;
    const unlock = ACHIEVEMENT_UNLOCKS[id];
    col.append(
      h(
        'div',
        { class: `ach${got ? '' : ' locked'}` },
        svgIcon(uiIcon(got ? 'star' : 'lock'), 'icon'),
        h(
          'div',
          null,
          h('div', { class: 'ach-name' }, t(`ach.${id}.name`)),
          h('div', { class: 'ach-desc' }, t(`ach.${id}.desc`) + (unlock ? ` → ${plateName(unlock)}` : '')),
        ),
      ),
    );
  }
  col.append(button(t('common.back'), act.back, { icon: uiIcon('back'), wide: true }));
  return col;
}

// ------------------------------------------------------------------ collection

export function buildCollection(unlocked: ReadonlySet<MatrixId>, act: { back(): void }): HTMLElement {
  const total = MATRIX_IDS.length;
  const col = h(
    'div',
    { class: 'column' },
    h('h1', { class: 'riso-title', style: 'font-size:2rem' }, t('collection.title')),
    h('div', { class: 'display muted' }, t('collection.count', { n: unlocked.size, total })),
  );
  const unlockBy = new Map<MatrixId, string>();
  for (const [ach, plate] of Object.entries(ACHIEVEMENT_UNLOCKS)) if (plate) unlockBy.set(plate, ach);
  for (const id of MATRIX_IDS) {
    const open = unlocked.has(id);
    const ach = unlockBy.get(id);
    const extra = !open && ach ? h('div', { class: 'display', style: 'font-size:.8rem' }, t('plate.unlock_by', { cond: t(`ach.${ach}.desc`) })) : null;
    col.append(plateCard(id, { locked: !open, extra }));
  }
  col.append(button(t('common.back'), act.back, { icon: uiIcon('back'), wide: true }));
  void STARTER_MATRICES;
  return col;
}

// ------------------------------------------------------------------ no ads

export interface NoAdsView {
  available: boolean;
  entitled: boolean;
  pending: boolean;
  price: string | null;
  error: boolean;
}

export function buildNoAds(v: NoAdsView, act: { buy(): void; restore(): void; back(): void }): HTMLElement {
  const col = h(
    'div',
    { class: 'column' },
    svgIcon(uiIcon('crown'), 'icon'),
    h('h1', { class: 'riso-title', style: 'font-size:2.2rem' }, t('noads.title')),
    h('ul', { style: 'margin:0;padding-left:20px;line-height:1.6' }, h('li', null, t('noads.b1')), h('li', null, t('noads.b2')), h('li', null, t('noads.b3'))),
  );
  if (!v.available) col.append(h('p', { class: 'muted' }, t('noads.unavailable')));
  else if (v.entitled) col.append(h('div', { class: 'badge', style: 'align-self:center;background:var(--ink-teal);color:#fff;font-size:1rem' }, t('noads.owned')));
  else if (v.pending) col.append(h('p', null, t('noads.pending')));
  else col.append(button(v.price ? t('noads.buy', { price: v.price }) : t('noads.buy_generic'), act.buy, { variant: 'primary', wide: true }));
  if (v.error) col.append(h('p', { style: 'color:#b00020' }, t('noads.error')));
  if (v.available) col.append(button(t('noads.restore'), act.restore, { wide: true, small: true }));
  col.append(button(t('common.back'), act.back, { icon: uiIcon('back'), wide: true, variant: 'ghost' }));
  return col;
}
