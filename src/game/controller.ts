/**
 * Game controller: owns the run engine, meta progression, saves and the screen flow,
 * and connects them to the Pixi scene, DOM screens, audio, haptics, ads and billing.
 */
import { BALANCE } from '../core/config/balance';
import { RULES_VERSION } from '../core/config/version';
import { editionOf, isSpecialIndex, totalContracts } from '../core/contracts';
import { dailyPool, dailySeed, dailyStartPlate, utcDate } from '../core/daily';
import { MATRIX_IDS, matrixDef, type MatrixId } from '../core/matrices';
import {
  ACHIEVEMENT_IDS,
  applyRunEvents,
  dailyGrid,
  onRunStarted,
  unlockedPool,
  type AchievementId,
  type MetaState,
} from '../core/meta';
import { RunEngine, type RunEvent, type RunState, type SlotRef } from '../core/run';
import type { Texture } from 'pixi.js';
import { InputController } from '../render/input';
import { Presenter } from '../render/presenter';
import type { RackCard } from '../render/rackView';
import type { GameScene } from '../render/scene';
import { announce, button, h, svgIcon, toast } from '../ui/dom';
import { detectLang, fmtInt, setLang, t } from '../ui/i18n';
import { modifierIcon, plateIcon, uiIcon } from '../ui/iconset';
import type { UiManager } from '../ui/manager';
import { modifierName, plateBadge } from '../ui/plateText';
import {
  buildCollection,
  buildDaily,
  buildNoAds,
  buildSettings,
  buildStats,
  buildTitle,
} from '../ui/screens/menus';
import {
  buildLastChance,
  buildOffer,
  buildPause,
  buildPlateSheet,
  buildReprint,
  buildResults,
  buildRules,
  buildVictory,
} from '../ui/screens/run';
import { APP_VERSION, PRIVACY_POLICY_URL } from '../config';
import type { RewardKind, RunKind, Services } from './services';
import { DEFAULT_SETTINGS, effectiveReduceMotion, normalizeSettings, type Settings } from './settings';
import { Tutorial } from './tutorial';

interface PendingAd {
  kind: RewardKind;
  runKind: RunKind | null;
  granted: boolean;
}

const KEYS = {
  settings: 'press.settings',
  pendingAd: 'press.pendingAd',
  dailyExtra: 'press.dailyExtra',
} as const;

export class GameController {
  meta!: MetaState;
  settings: Settings = { ...DEFAULT_SETTINGS };
  engine: RunEngine | null = null;
  runKind: RunKind | null = null;
  readonly presenter: Presenter;
  readonly input: InputController;
  private locked = false;
  private rewardedThisRun = false;
  private resultsShownAt = 0;
  private dailyExtra: Record<string, number> = {};
  private hudButtons: HTMLElement[] = [];
  private placeBtn: HTMLButtonElement | null = null;
  private tutorial: Tutorial | null = null;
  private tipShownThisContract = false;
  private pendingUnlocks: { achievements: AchievementId[]; unlocks: MatrixId[] } = {
    achievements: [],
    unlocks: [],
  };
  private recordBefore = 0;
  private icons = new Map<MatrixId, Texture>();
  private modifierTextures = new Map<string, Texture>();
  private inGame = false;
  /** Fixed seed for normal runs (e2e / ?seed=). */
  seedOverride: string | null = null;

  constructor(
    readonly s: Services,
    readonly scene: GameScene,
    readonly ui: UiManager,
    private readonly hudHost: HTMLElement,
  ) {
    this.presenter = new Presenter(scene, {
      sound: (name, opts) => this.s.audio.play(name, opts),
      haptic: (k) => this.haptic(k),
      t: (k, p) => t(k, p),
      speed: () => this.settings.counterSpeed,
      reduceMotion: () => this.reduceMotion,
      style: () => ({ symbols: this.settings.symbols }),
      refreshHud: () => this.refreshHud(),
      announce: (text) => announce(text),
    });
    this.input = new InputController(scene, {
      canInteract: () => this.canInteract(),
      pieceAt: (slot) => this.engine?.pieceAt(slot) ?? null,
      isValid: (slot, x, y) => this.isValidPlacement(slot, x, y),
      previewLines: (slot, x, y) => this.engine?.previewLines(slot, x, y) ?? null,
      canStash: (slot) => this.engine?.canStash(slot) ?? false,
      reserveUsable: () => (this.engine?.reserveSlots() ?? 0) > 0,
      place: (slot, x, y) => this.place(slot, x, y),
      stash: (slot) => this.stash(slot),
      rackTap: (slot) => this.openPlateSheet(slot),
      rackMove: (from, to) => this.movePlate(from, to),
      counterTap: () => this.counterTap(),
      trayTapHint: (slot) => {
        this.scene.tray.wiggle(slot);
        this.showTip('tip.drag_hint', true);
      },
      feedback: (k) => {
        if (k === 'pickup') {
          this.s.audio.play('pickup');
          this.haptic('light');
        } else if (k === 'snap') this.haptic('selection');
        else if (k === 'invalid') this.s.audio.play('drop_invalid');
        else this.s.audio.play('ui_click');
      },
      selectionChanged: (sel) => this.updatePlaceButton(sel?.ghost ? sel : null),
    });
  }

  // ================================================================== boot

  async boot(): Promise<void> {
    this.meta = await this.s.saves.loadMeta();
    this.settings = normalizeSettings(await this.s.saves.loadJSON(KEYS.settings, DEFAULT_SETTINGS));
    this.dailyExtra = await this.s.saves.loadJSON<Record<string, number>>(KEYS.dailyExtra, {});
    this.applySettings(false);
    await this.loadPlateTextures();
    const session = this.s.lifecycle.sessionIndex;
    void this.s.iap
      .refresh()
      .then(() => this.s.ads.start({ sessionIndex: session, noAds: this.s.iap.entitled }));
    this.s.iap.onChange(() => this.refreshTitleIfShown());
    this.s.lifecycle.onPause(() => {
      this.input.cancelAll();
      this.saveRun();
      void this.s.saves.flush();
      this.s.audio.suspend();
      if (this.inGame && this.engine?.state.phase === 'playing' && !this.ui.has('pause')) this.openPause();
    });
    this.s.lifecycle.onResume(() => {
      this.s.audio.resume();
      void this.s.iap.refresh();
    });
    window.addEventListener('pointerdown', () => this.s.audio.unlock(), { passive: true });
    window.addEventListener('keydown', () => this.s.audio.unlock());
    window.addEventListener('resize', () => this.relayout());
    await this.recoverPendingAd();
    if (!this.meta.tutorialDone) this.startTutorial();
    else this.showTitle();
  }

  private async loadPlateTextures(): Promise<void> {
    const ids = [...MATRIX_IDS];
    await Promise.all(
      ids.map(async (id) => {
        this.icons.set(id, await this.scene.assets.svg(`plate:${id}`, plateIcon(id), 64, 2));
      }),
    );
    this.scene.rack.setIcons(this.icons);
  }

  private async modifierTexture(id: string): Promise<Texture> {
    const hit = this.modifierTextures.get(id);
    if (hit) return hit;
    const tex = await this.scene.assets.svg(`mod:${id}`, modifierIcon(id as never), 32, 2);
    this.modifierTextures.set(id, tex);
    return tex;
  }

  get reduceMotion(): boolean {
    return effectiveReduceMotion(this.settings);
  }

  private haptic(k: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection'): void {
    if (k === 'selection') this.s.haptics.selection();
    else if (k === 'success' || k === 'warning' || k === 'error') this.s.haptics.notify(k);
    else this.s.haptics.impact(k);
  }

  applySettings(persist = true): void {
    const st = this.settings;
    setLang(st.lang === 'auto' ? detectLang(navigator.languages) : st.lang);
    this.s.audio.setMusicVolume(st.music);
    this.s.audio.setSfxVolume(st.sfx);
    this.s.haptics.setEnabled(st.haptics);
    this.s.setFullscreen(st.fullscreen);
    document.documentElement.classList.toggle('reduce-motion', this.reduceMotion);
    this.input.mode = st.controls;
    this.input.reduceMotion = this.reduceMotion;
    this.scene.setStyle({ symbols: st.symbols }, this.reduceMotion);
    this.scene.hud.setLabels({
      quota: t('hud.quota'),
      sheets: t('hud.sheets'),
      streak: t('hud.streak'),
      prints: t('hud.prints'),
      mult: t('hud.mult'),
    });
    if (this.engine) this.refreshHud();
    if (persist) this.s.saves.saveJSON(KEYS.settings, st);
  }

  relayout(): void {
    const host = this.scene.canvas.parentElement as HTMLElement;
    this.input.cancelAll();
    this.scene.setHasReserve(this.engine?.hasReserve() ?? false);
    this.scene.resize(host.clientWidth, host.clientHeight);
    this.placeHudButtons();
    if (this.engine) this.presenter.syncAll(this.engine);
  }

  // ================================================================== title & menus

  showTitle(): void {
    this.leaveGame();
    this.s.audio.setMusic('menu');
    this.ui.clear();
    void this.s.saves.loadRun('normal').then((run) => {
      void this.s.saves.loadRun('daily').then((daily) => {
        const today = utcDate(Date.now());
        const content = buildTitle(
          {
            hasRun: Boolean(run && run.phase !== 'over'),
            dailyInProgress: Boolean(daily && daily.phase !== 'over' && daily.dailyDate === today),
            record: this.meta.stats.bestScore,
            showNoAds: this.s.iap.available && !this.s.iap.entitled,
          },
          {
            play: () => void this.startRun('normal'),
            resume: () => void this.resumeRun('normal'),
            newRun: async () => {
              if (await this.ui.confirm(t('title.confirm_new'), t('common.yes'), t('common.no'))) {
                if (this.engine && this.runKind === 'normal') this.engine.abandon();
                await this.s.saves.clearRun('normal');
                void this.startRun('normal');
              }
            },
            daily: () => void this.showDaily(),
            plates: () => this.showCollection(),
            stats: () => this.showStats(),
            settings: () => this.showSettings(),
            noAds: () => void this.showNoAds(),
          },
        );
        this.ui.show('title', content, { onBack: () => false });
        void this.maybeShowConsent();
      });
    });
  }

  private refreshTitleIfShown(): void {
    if (this.ui.top === 'title') this.showTitle();
  }

  /** UMP consent form at a natural break on the title screen (never in play; GDD §11.2). */
  private async maybeShowConsent(): Promise<void> {
    if (this.s.lifecycle.isFirstSession || !this.s.ads.needsConsentForm()) return;
    await this.s.ads.showConsentForm();
  }

  showSettings(fromGame = false): void {
    const content = buildSettings(
      {
        settings: this.settings,
        privacyOptions: this.s.ads.privacyOptionsRequired(),
        iapAvailable: this.s.iap.available,
        version: APP_VERSION,
      },
      {
        change: (patch) => {
          const langChanged = patch.lang !== undefined && patch.lang !== this.settings.lang;
          this.settings = { ...this.settings, ...patch };
          this.applySettings();
          if (langChanged) this.showSettings(fromGame);
        },
        privacyOptions: () => void this.s.ads.showPrivacyOptions(),
        policy: () => this.s.openUrl(PRIVACY_POLICY_URL),
        restore: () =>
          void this.s.iap
            .restore()
            .then(() => toast(this.s.iap.entitled ? t('noads.owned') : t('noads.restore'))),
        tutorial: () => {
          this.ui.close('settings');
          if (!fromGame) this.startTutorial();
        },
        resetTips: () => {
          this.meta.tipsSeen = [];
          this.s.saves.saveMeta(this.meta);
          toast(t('settings.reset_tips'));
        },
        back: () => this.ui.close('settings'),
      },
    );
    this.ui.show('settings', content);
  }

  showStats(): void {
    this.ui.show('stats', buildStats(this.meta, { back: () => this.ui.close('stats') }));
  }

  showCollection(): void {
    this.ui.show(
      'collection',
      buildCollection(new Set(unlockedPool(this.meta)), { back: () => this.ui.close('collection') }),
    );
  }

  async showNoAds(): Promise<void> {
    const render = async (error = false) => {
      const product = this.s.iap.available ? await this.s.iap.product() : null;
      this.ui.show(
        'noads',
        buildNoAds(
          {
            available: this.s.iap.available,
            entitled: this.s.iap.entitled,
            pending: this.s.iap.pending,
            price: product?.price ?? null,
            error,
          },
          {
            buy: async () => {
              const r = await this.s.iap.purchase();
              if (r === 'purchased' || r === 'already_owned') {
                this.s.audio.play('unlock');
                toast(t('noads.owned'));
              }
              await render(r === 'error');
            },
            restore: async () => {
              await this.s.iap.restore();
              await render();
            },
            back: () => this.ui.close('noads'),
          },
        ),
      );
    };
    await render();
  }

  private dailyAttemptsMax(date: string): number {
    return 1 + (this.dailyExtra[date] ?? 0);
  }

  async showDaily(): Promise<void> {
    const date = utcDate(Date.now());
    const saved = await this.s.saves.loadRun('daily');
    const inProgress = Boolean(saved && saved.phase !== 'over' && saved.dailyDate === date);
    const rec = this.meta.daily[date];
    const used = rec?.attempts ?? 0;
    const buyer = this.s.iap.entitled;
    this.ui.show(
      'daily',
      buildDaily(
        {
          date,
          plate: dailyStartPlate(date),
          best: rec ? { contracts: rec.contracts, score: rec.best } : null,
          attemptsUsed: used,
          attemptsMax: this.dailyAttemptsMax(date),
          inProgress,
          canExtra: (this.dailyExtra[date] ?? 0) === 0,
          extraAvailable: this.s.ads.available('rewarded'),
          buyer,
        },
        {
          start: () => void this.startRun('daily'),
          resume: () => void this.resumeRun('daily'),
          extra: () =>
            void this.rewarded('daily_attempt', () => {
              this.dailyExtra[date] = (this.dailyExtra[date] ?? 0) + 1;
              this.s.saves.saveJSON(KEYS.dailyExtra, this.dailyExtra);
              void this.showDaily();
            }),
          back: () => this.ui.close('daily'),
        },
      ),
    );
  }

  // ================================================================== run lifecycle

  async startRun(kind: RunKind): Promise<void> {
    this.ui.clear();
    let seed: string;
    let startPlates: MatrixId[] = [];
    let pool: MatrixId[];
    let date: string | null = null;
    if (kind === 'daily') {
      date = utcDate(Date.now());
      seed = dailySeed(date);
      pool = dailyPool();
      startPlates = [dailyStartPlate(date)];
    } else {
      seed =
        this.seedOverride ?? `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      pool = unlockedPool(this.meta);
    }
    const { engine, events } = RunEngine.create({
      seed,
      mode: kind === 'daily' ? 'daily' : 'standard',
      dailyDate: date,
      pool,
      startPlates,
    });
    this.engine = engine;
    this.runKind = kind;
    this.rewardedThisRun = false;
    this.recordBefore = this.meta.stats.bestScore;
    this.pendingUnlocks = { achievements: [], unlocks: [] };
    onRunStarted(this.meta);
    this.s.saves.saveMeta(this.meta);
    this.enterGame();
    this.handleEvents(events);
  }

  async resumeRun(kind: RunKind): Promise<void> {
    const state = await this.s.saves.loadRun(kind);
    if (!state || state.phase === 'over') {
      void this.startRun(kind);
      return;
    }
    this.ui.clear();
    this.engine = RunEngine.restore(state);
    this.runKind = kind;
    this.rewardedThisRun = false;
    this.recordBefore = this.meta.stats.bestScore;
    this.enterGame();
    this.afterAction();
  }

  private enterGame(): void {
    this.inGame = true;
    this.s.audio.setMusic('game');
    this.relayout();
    this.mountHudButtons();
    if (this.engine) this.presenter.syncAll(this.engine);
    this.showBanner();
  }

  private leaveGame(): void {
    this.inGame = false;
    this.input.cancelAll();
    this.input.clearSelection();
    for (const b of this.hudButtons) b.remove();
    this.hudButtons = [];
    this.placeBtn = null;
  }

  private canInteract(): boolean {
    if (this.locked || !this.engine || this.engine.state.phase !== 'playing') return false;
    if (this.ui.count > 0) return false;
    return true;
  }

  private isValidPlacement(slot: SlotRef, x: number, y: number): boolean {
    if (!this.engine?.canPlace(slot, x, y)) return false;
    if (this.tutorial) return this.tutorial.allows(slot, x, y);
    return true;
  }

  // ================================================================== actions

  place(slot: SlotRef, x: number, y: number): void {
    if (!this.engine || !this.canInteract() || !this.isValidPlacement(slot, x, y)) return;
    this.updatePlaceButton(null);
    const events = this.engine.place(slot, x, y);
    this.handleEvents(events);
  }

  stash(slot: number): void {
    if (!this.engine?.canStash(slot)) return;
    this.handleEvents(this.engine.stash(slot));
  }

  movePlate(from: number, to: number): void {
    if (!this.engine || from === to) return;
    this.handleEvents(this.engine.movePlate(from, to));
    this.maybeTip('tip.second_plate');
  }

  sell(uid: number): void {
    if (!this.engine) return;
    this.handleEvents(this.engine.sell(uid));
  }

  private counterTap(): void {
    this.presenter.fastForward();
    if (this.presenter.lastPrint && this.engine) this.openRules();
  }

  /** Central event pipeline: meta → save → presentation → phase transitions. */
  private handleEvents(events: RunEvent[]): void {
    const engine = this.engine;
    if (!engine) return;
    if (!this.tutorial?.sandbox) {
      const upd = applyRunEvents(this.meta, engine.state, events, Date.now());
      if (upd.achievements.length || upd.unlocks.length) {
        this.pendingUnlocks.achievements.push(...upd.achievements);
        this.pendingUnlocks.unlocks.push(...upd.unlocks);
        for (const a of upd.achievements) toast(t('results.achievement', { name: t(`ach.${a}.name`) }));
        this.s.audio.play('unlock');
        this.s.saves.saveMeta(this.meta);
      }
      if (events.some((e) => e.type === 'contract_won' || e.type === 'run_over'))
        this.s.saves.saveMeta(this.meta);
      this.saveRun();
    }
    for (const e of events) {
      if (e.type === 'contract_started') {
        this.tipShownThisContract = false;
        if (this.scene.setHasReserve(engine.hasReserve())) this.relayout();
      }
      if (e.type === 'streak') this.s.audio.setIntensity(Math.min(1, e.streak / 16));
      if (e.type === 'streak' && e.dry > 0 && !e.broken) this.maybeTip('tip.drop_dried');
      if (e.type === 'plate_added') {
        const n = engine.state.plates.length;
        if (n === 1) this.maybeTip('tip.first_plate');
        if (engine.hasReserve() && this.scene.setHasReserve(true)) this.relayout();
      }
    }
    this.presenter.apply(events, engine);
    this.tutorial?.onEvents(events);
    if (events.some((e) => e.type === 'contract_started')) this.showBanner();
    const c = engine.state.contract;
    if (
      engine.state.phase === 'playing' &&
      c.sheetsLeft <= 3 &&
      c.progress < c.spec.quota &&
      engine.sellablePlates().length > 0
    )
      this.maybeTip('tip.low_sheets');
    // Nothing fits, but the run is alive: the Type Case escape is the only move — always say so.
    if (engine.state.phase === 'playing' && !this.tutorial?.sandbox && this.onlyStashEscape(engine))
      this.showTip('tip.stash_escape', false);
    this.afterAction();
  }

  private saveRun(): void {
    if (!this.engine || !this.runKind || this.tutorial?.sandbox) return;
    if (this.engine.state.phase === 'over') void this.s.saves.clearRun(this.runKind);
    else this.s.saves.saveRun(this.runKind, this.engine.snapshot());
  }

  /** Opens the screen matching the engine phase once animations have settled. */
  private afterAction(): void {
    const engine = this.engine;
    if (!engine) return;
    const phase = engine.state.phase;
    if (phase === 'playing') return;
    this.locked = true;
    this.input.cancelAll();
    void this.presenter.idle().then(() => {
      this.locked = false;
      if (this.engine !== engine) return;
      if (this.tutorial?.interceptPhase(phase)) return;
      switch (phase) {
        case 'offer':
          this.showOffer();
          break;
        case 'last_chance':
          this.showLastChance();
          break;
        case 'lost':
          this.showReprint();
          break;
        case 'victory':
          this.showVictory();
          break;
        case 'over':
          this.showResults();
          break;
      }
    });
  }

  // ================================================================== offer

  showOffer(): void {
    const engine = this.engine;
    const offer = engine?.state.offer;
    if (!engine || !offer) return;
    const s = engine.state;
    // After a special job the next edition begins: reveal its special rule where the pick happens.
    const nextSpecial = isSpecialIndex(s.contractIndex)
      ? engine.specialFor(editionOf(s.contractIndex + 1))
      : null;
    if (s.plates.length >= BALANCE.slots) this.maybeTip('tip.full_rack');
    const content = buildOffer(
      {
        jobNumber: s.contractIndex + 1,
        cards: offer.cards,
        bonus4: offer.cardCount > 3,
        bonusRare: offer.guaranteeRare,
        plates: s.plates,
        nextSpecial,
        freeRerolls: s.freeRerolls,
        adRerollsUsed: s.adRerollsUsed,
        canFreeReroll: engine.canReroll('free'),
        canAdReroll: engine.canReroll('ad'),
        adAvailable: this.s.ads.available('rewarded'),
        buyer: this.s.iap.entitled,
        dailyMode: s.mode === 'daily',
        tutorialHint: Boolean(this.tutorial) || Object.keys(this.meta.stats.picks).length === 0,
      },
      {
        take: (card, replaceUid) => {
          this.s.audio.play('card_take');
          this.ui.close('offer', false);
          this.handleEvents(engine.takeOffer(card, replaceUid));
        },
        skip: () => {
          this.s.audio.play('paper');
          this.ui.close('offer', false);
          this.handleEvents(engine.skipOffer());
        },
        reroll: (kind) => {
          const doReroll = () => {
            this.s.audio.play('reroll');
            this.handleEventsQuiet(engine.reroll(kind));
            this.showOffer();
          };
          if (kind === 'free') doReroll();
          else void this.rewarded('reroll', doReroll);
        },
      },
    );
    this.ui.show('offer', content, { onBack: () => (this.openPause(), true) });
  }

  /** Events without phase handling (e.g. a reroll keeps the offer open). */
  private handleEventsQuiet(events: RunEvent[]): void {
    if (!this.engine) return;
    applyRunEvents(this.meta, this.engine.state, events, Date.now());
    this.saveRun();
  }

  // ================================================================== plates

  private openPlateSheet(slot: number): void {
    const engine = this.engine;
    const inst = engine?.state.plates[slot];
    if (!engine || !inst) return;
    this.presenter.fastForward();
    const disabled = !engine.isEnabled(inst);
    const inert = inst.id === 'mirror' && !this.mirrorHasTarget(slot);
    const phase = engine.state.phase;
    let sold = false;
    const content = buildPlateSheet(
      {
        inst,
        slot,
        owned: engine.state.plates.length,
        disabled,
        inert,
        canSell: ['playing', 'offer', 'last_chance'].includes(phase) && !this.tutorial,
        canMove: phase !== 'over',
      },
      {
        sell: () => {
          if (sold) return;
          sold = true;
          this.ui.close('plate');
          this.sell(inst.uid);
          toast(
            t('plate.sell', {
              n: matrixDef(inst.id).sellValue ?? BALANCE.sellSheets[matrixDef(inst.id).rarity],
            }),
          );
        },
        move: (dir) => {
          const to = slot + dir;
          if (to < 0 || to >= engine.state.plates.length) return;
          this.movePlate(slot, to);
          this.openPlateSheet(to);
        },
        close: () => this.ui.close('plate'),
      },
    );
    this.ui.show('plate', content, { kind: 'sheet' });
  }

  private mirrorHasTarget(slot: number): boolean {
    const engine = this.engine;
    if (!engine) return false;
    for (let k = slot + 1; k < engine.state.plates.length; k++) {
      const p = engine.state.plates[k];
      if (!p || !engine.isEnabled(p)) return false;
      if (p.id !== 'mirror') return true;
    }
    return false;
  }

  refreshHud(): void {
    const engine = this.engine;
    if (!engine) return;
    const s = engine.state;
    const owned = s.plates.length;
    const cards: RackCard[] = s.plates.map((p, i) => ({
      uid: p.uid,
      id: p.id,
      rarity: matrixDef(p.id).rarity,
      badge: plateBadge(p, owned),
      disabled: !engine.isEnabled(p),
      inert: p.id === 'mirror' && !this.mirrorHasTarget(i),
      mirror: p.id === 'mirror',
    }));
    this.scene.rack.set(cards);
    const spec = s.contract.spec;
    const edition = editionOf(s.contractIndex);
    const upcoming = engine.upcomingSpecial();
    const name = upcoming.length ? upcoming.map(modifierName).join(' + ') : null;
    const iconId = upcoming[0]?.id;
    const apply = (icon: Texture | null) =>
      this.scene.hud.setContract(
        {
          edition,
          position: spec.position,
          special: spec.special,
          endless: s.endless,
          specialName: name,
          specialIcon: icon,
        },
        s.endless && s.contractIndex >= totalContracts()
          ? t('banner.endless')
          : t('hud.edition', { n: edition }),
      );
    apply(iconId ? (this.modifierTextures.get(iconId) ?? null) : null);
    if (iconId && !this.modifierTextures.has(iconId))
      void this.modifierTexture(iconId).then((tex) => apply(tex));
    this.scene.hud.setSheets(s.contract.sheetsLeft, s.contract.sheetsUsed, spec.sheets);
  }

  // ================================================================== pause / rules

  openPause(): void {
    const engine = this.engine;
    if (!engine) return;
    this.input.cancelAll();
    this.presenter.fastForward();
    const s = engine.state;
    this.ui.show(
      'pause',
      buildPause(
        {
          job: s.contractIndex + 1,
          total: totalContracts(),
          edition: editionOf(s.contractIndex),
          tutorial: Boolean(this.tutorial),
        },
        {
          resume: () => this.ui.close('pause'),
          rules: () => this.openRules(),
          settings: () => this.showSettings(true),
          abandon: async () => {
            if (!(await this.ui.confirm(t('pause.abandon_confirm'), t('common.yes'), t('common.no')))) return;
            this.ui.clear();
            const events = engine.abandon();
            this.handleEvents(events);
          },
          skipTutorial: () => {
            this.ui.close('pause');
            this.finishTutorial();
          },
        },
      ),
      { onBack: () => (this.ui.close('pause'), true) },
    );
  }

  private openRules(): void {
    const engine = this.engine;
    if (!engine) return;
    const s = engine.state;
    this.ui.show(
      'rules',
      buildRules({
        spec: s.contract.spec,
        sheets: s.contract.sheetsGranted,
        lastPrint: this.presenter.lastPrint,
        plates: s.plates,
      }),
      {
        kind: 'sheet',
      },
    );
  }

  // ================================================================== end states

  private showLastChance(): void {
    const engine = this.engine;
    if (!engine) return;
    const c = engine.state.contract;
    this.ui.show(
      'last',
      buildLastChance(
        { gap: c.spec.quota - c.progress, plates: engine.state.plates },
        {
          sell: (uid) => {
            this.ui.close('last', false);
            this.sell(uid);
          },
          end: async () => {
            if (!(await this.ui.confirm(t('last.confirm'), t('common.yes'), t('common.no')))) return;
            this.ui.close('last', false);
            this.handleEvents(engine.acceptLoss());
          },
        },
      ),
      { kind: 'sheet', dismissible: false, onBack: () => true },
    );
  }

  private showReprint(): void {
    const engine = this.engine;
    if (!engine) return;
    if (!engine.canContinue() || this.tutorial) {
      this.handleEvents(engine.endRun());
      return;
    }
    const reason = engine.state.lossReason ?? 'jam';
    const c = engine.state.contract;
    const free = !this.meta.freeContinueUsed;
    const buyer = this.s.iap.entitled;
    const mode = free ? 'free' : buyer ? 'buyer' : 'ad';
    const adAvailable = this.s.ads.available('rewarded');
    if (
      mode === 'ad' &&
      !adAvailable &&
      !this.s.ads.available('interstitial') &&
      this.s.lifecycle.isFirstSession
    ) {
      // No ads in the first session (GDD §11.1): the reprint is not offered at all.
      this.handleEvents(engine.endRun());
      return;
    }
    this.maybeTip('tip.first_loss');
    const accept = () => {
      const apply = () => {
        this.ui.close('reprint', false);
        if (free) {
          this.meta.freeContinueUsed = true;
          this.s.saves.saveMeta(this.meta);
        }
        this.handleEvents(engine.continueRun());
      };
      if (mode === 'ad') void this.rewarded('reprint', apply);
      else apply();
    };
    const decline = async () => {
      if (!(await this.ui.confirm(t('reprint.confirm_decline'), t('common.yes'), t('common.no')))) return;
      this.ui.close('reprint', false);
      this.handleEvents(engine.endRun());
    };
    this.ui.show(
      'reprint',
      buildReprint(
        {
          reason,
          gap: Math.max(0, c.spec.quota - c.progress),
          mode,
          adAvailable,
          showNoAdsHint: mode === 'ad' && this.s.iap.available,
        },
        { accept, decline: () => void decline(), noAds: () => void this.showNoAds() },
      ),
      { kind: 'sheet', dismissible: false, onBack: () => (void decline(), true) },
    );
  }

  private showVictory(): void {
    const engine = this.engine;
    if (!engine) return;
    this.s.audio.play('unlock');
    this.ui.show(
      'victory',
      buildVictory(engine.state.totals, {
        endless: () => {
          this.ui.close('victory', false);
          this.handleEvents(engine.continueEndless());
        },
        finish: () => {
          this.ui.close('victory', false);
          this.handleEvents(engine.endRun());
        },
      }),
      {
        onBack: () => {
          void this.ui
            .confirm(t('victory.confirm'), t('victory.finish'), t('victory.endless'))
            .then((finish) => {
              this.ui.close('victory', false);
              this.handleEvents(finish ? engine.endRun() : engine.continueEndless());
            });
          return true;
        },
      },
    );
  }

  private showResults(): void {
    const engine = this.engine;
    if (!engine) return;
    const s = engine.state;
    const won = s.totals.contractsWon >= totalContracts();
    const lost = !won;
    this.s.ads.onRunCompleted(lost);
    const daily = s.mode === 'daily' && s.dailyDate ? { grid: dailyGrid(s) } : null;
    const date = s.dailyDate;
    const canRetryDaily = Boolean(
      date && (this.meta.daily[date]?.attempts ?? 0) < this.dailyAttemptsMax(date),
    );
    this.resultsShownAt = performance.now();
    const unlocks = [...this.pendingUnlocks.unlocks];
    const achievements = this.pendingUnlocks.achievements.map((a) => t(`ach.${a}.name`));
    this.pendingUnlocks = { achievements: [], unlocks: [] };
    const leave = async (trigger: 'new_run_button' | 'menu_button', next: () => void) => {
      await this.s.ads.maybeShowInterstitial({
        trigger,
        resultsVisibleMs: performance.now() - this.resultsShownAt,
        rewardedThisRun: this.rewardedThisRun,
        noAds: this.s.iap.entitled,
      });
      next();
    };
    this.ui.show(
      'results',
      buildResults(
        {
          won,
          cause: s.lossReason,
          totals: s.totals,
          record: s.totals.score > this.recordBefore,
          unlocks,
          achievements,
          daily,
          canRetryDaily,
        },
        {
          newRun: () =>
            void leave(
              'new_run_button',
              () => void this.startRun(this.runKind === 'daily' ? 'normal' : 'normal'),
            ),
          menu: () => void leave('menu_button', () => this.showTitle()),
          share: () => void this.shareResult(),
          retryDaily: () => void leave('new_run_button', () => void this.startRun('daily')),
        },
      ),
      { onBack: () => (this.showTitle(), true) },
    );
  }

  private async shareResult(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const s = engine.state;
    const text =
      s.mode === 'daily' && s.dailyDate
        ? t('share.daily', {
            date: s.dailyDate,
            r: RULES_VERSION,
            jobs: s.totals.contractsWon,
            grid: dailyGrid(s),
            score: fmtInt(s.totals.score),
            best: fmtInt(s.totals.bestPrint),
          })
        : t('share.run', {
            jobs: s.totals.contractsWon,
            score: fmtInt(s.totals.score),
            best: fmtInt(s.totals.bestPrint),
          });
    const r = await this.s.share(text);
    if (r === 'copied') toast(t('toast.copied'));
    else if (r === 'failed') toast(t('toast.share_failed'));
  }

  // ================================================================== rewarded ads

  /** Shows a rewarded ad (or grants instantly for No-ads buyers) and persists the pending reward. */
  private async rewarded(kind: RewardKind, grant: () => void): Promise<void> {
    if (this.s.iap.entitled) {
      grant();
      return;
    }
    let granted = false;
    const result = await this.s.ads.showRewarded(kind, {
      beforeShow: async () => {
        this.saveRun();
        this.s.saves.saveJSON(KEYS.pendingAd, {
          kind,
          runKind: this.runKind,
          granted: false,
        } satisfies PendingAd);
        await this.s.saves.flush();
        this.s.audio.suspend();
      },
      onReward: () => {
        granted = true;
        this.s.saves.saveJSON(KEYS.pendingAd, {
          kind,
          runKind: this.runKind,
          granted: true,
        } satisfies PendingAd);
      },
    });
    this.s.audio.resume();
    this.s.saves.saveJSON(KEYS.pendingAd, null);
    if (granted || result === 'rewarded') {
      this.rewardedThisRun = true;
      grant();
    } else if (result === 'unavailable') toast(t('ad.unavailable'));
  }

  /** After a process death during an ad: apply or re-offer the reward (GDD §11.4). */
  private async recoverPendingAd(): Promise<void> {
    const p = await this.s.saves.loadJSON<PendingAd | null>(KEYS.pendingAd, null);
    if (!p) return;
    this.s.saves.saveJSON(KEYS.pendingAd, null);
    if (!p.granted || !p.runKind) return;
    const state = await this.s.saves.loadRun(p.runKind);
    if (!state) return;
    const engine = RunEngine.restore(state);
    try {
      if (p.kind === 'reprint' && engine.canContinue()) engine.continueRun();
      else if (p.kind === 'reroll' && engine.canReroll('ad')) engine.reroll('ad');
      this.s.saves.saveRun(p.runKind, engine.snapshot());
      await this.s.saves.flush();
    } catch {
      // The run moved on; nothing to apply.
    }
  }

  // ================================================================== HUD DOM bits

  private mountHudButtons(): void {
    for (const b of this.hudButtons) b.remove();
    const pause = h('button', { class: 'icon-btn hud-btn', type: 'button', 'aria-label': t('hud.pause') });
    pause.append(svgIcon(uiIcon('pause'), ''));
    pause.addEventListener('click', () => this.openPause());
    const info = h('button', { class: 'icon-btn hud-btn', type: 'button', 'aria-label': t('hud.info') });
    info.append(svgIcon(uiIcon('info'), ''));
    info.addEventListener('click', () => this.openRules());
    this.hudHost.append(pause, info);
    this.hudButtons = [pause, info];
    this.placeHudButtons();
  }

  private placeHudButtons(): void {
    const L = this.scene.layout;
    if (!L || this.hudButtons.length < 2) return;
    const [pause, info] = this.hudButtons as [HTMLElement, HTMLElement];
    const y = L.header.y + (L.header.h - 44) / 2;
    Object.assign(pause.style, { left: `${L.header.x}px`, top: `${y}px` });
    Object.assign(info.style, { left: `${L.header.x + L.header.w - 44}px`, top: `${y}px` });
  }

  private updatePlaceButton(sel: { slot: SlotRef } | null): void {
    if (this.settings.controls !== 'tap' || !sel) {
      this.placeBtn?.remove();
      this.placeBtn = null;
      return;
    }
    if (!this.placeBtn) {
      this.placeBtn = button(t('hud.place'), () => this.input.confirmTap(), { variant: 'primary' });
      this.placeBtn.classList.add('place-btn');
      this.hudHost.append(this.placeBtn);
    }
    const L = this.scene.layout;
    Object.assign(this.placeBtn.style, {
      left: `${L.counter.x}px`,
      top: `${L.counter.y}px`,
      width: `${L.counter.w}px`,
    });
  }

  private showBanner(): void {
    const engine = this.engine;
    if (!engine || engine.state.phase !== 'playing' || this.tutorial?.sandbox) return;
    const s = engine.state;
    const spec = s.contract.spec;
    const L = this.scene.layout;
    const old = this.hudHost.querySelector('.banner');
    old?.remove();
    const banner = h(
      'div',
      { class: `banner${spec.special ? ' special' : ''}`, role: 'status' },
      spec.special ? h('div', { class: 'big' }, t('banner.special')) : null,
      h(
        'div',
        { class: spec.special ? 'small' : 'big' },
        t('banner.job', { n: spec.position + 1, quota: fmtInt(spec.quota), sheets: s.contract.sheetsLeft }),
      ),
      ...spec.modifiers.map((m) => h('div', { class: 'small' }, modifierName(m))),
    );
    banner.style.top = `${L.board.y + L.board.h / 3}px`;
    this.hudHost.append(banner);
    const remove = () => banner.remove();
    setTimeout(remove, 1800);
    this.scene.canvas.addEventListener('pointerdown', remove, { once: true });
    if (spec.special) this.maybeTip('tip.special');
  }

  private onlyStashEscape(engine: RunEngine): boolean {
    for (const slot of [0, 1, 2, 'reserve'] as const)
      if (engine.validPositions(slot).length > 0) return false;
    return engine.anyMoveAvailable();
  }

  /** Just-in-time tip, once per id, at most one per contract (GDD §13). */
  private maybeTip(id: string): void {
    if (!this.settings.tips || this.meta.tipsSeen.includes(id) || this.tipShownThisContract) return;
    this.tipShownThisContract = true;
    this.meta.tipsSeen.push(id);
    this.s.saves.saveMeta(this.meta);
    this.showTip(id, false);
  }

  private showTip(id: string, transient: boolean): void {
    const L = this.scene.layout;
    if (!L) return;
    this.hudHost.querySelector('.tip')?.remove();
    const tip = h('div', { class: 'tip', role: 'status' }, t(id));
    tip.style.top = `${Math.max(8, L.tray.y - 48)}px`;
    this.hudHost.append(tip);
    const remove = () => tip.remove();
    setTimeout(remove, transient ? 1600 : 4200);
    this.scene.canvas.addEventListener('pointerdown', remove, { once: true });
  }

  // ================================================================== tutorial

  startTutorial(): void {
    this.ui.clear();
    this.tutorial = new Tutorial(this);
    this.tutorial.start();
  }

  /** Called by the tutorial when finished or skipped. */
  /**
   * The real run (tutorial step 3) has started: from now on a relaunch must offer "Resume run"
   * instead of replaying the sandbox steps over the saved run. Step-3 hints keep running.
   */
  markTutorialDone(): void {
    if (this.meta.tutorialDone) return;
    this.meta.tutorialDone = true;
    this.s.saves.saveMeta(this.meta);
  }

  finishTutorial(): void {
    const tut = this.tutorial;
    this.tutorial = null;
    tut?.dispose();
    this.meta.tutorialDone = true;
    this.s.saves.saveMeta(this.meta);
    if (tut?.sandbox) {
      // Steps 1–2 were a sandbox; begin a real run (the tutorial's step 3 already did otherwise).
      void this.startRun('normal');
    }
  }

  /** Used by the tutorial to install a sandbox engine. */
  installSandbox(engine: RunEngine): void {
    this.engine = engine;
    this.runKind = null;
    this.enterGame();
  }

  // ================================================================== debug / e2e API

  debugApi(): Record<string, unknown> {
    return {
      state: () => this.engine?.snapshot() ?? null,
      layout: () => this.scene.layout,
      phase: () => this.engine?.state.phase ?? null,
      screen: () => this.ui.top,
      validPositions: (slot: SlotRef) => this.engine?.validPositions(slot) ?? [],
      previewLines: (slot: SlotRef, x: number, y: number) => this.engine?.previewLines(slot, x, y) ?? null,
      /** Pointer coordinates (CSS px, relative to the canvas) for dragging `slot` onto (x, y). */
      dragPoints: (slot: SlotRef, x: number, y: number) => this.dragPoints(slot, x, y),
      skipAnimations: (on: boolean) => {
        this.settings = {
          ...this.settings,
          counterSpeed: on ? 'instant' : 'normal',
          reduceMotion: on ? true : null,
        };
        this.applySettings(false);
      },
      frameStats: () => this.scene.frameStats(),
      forceContextLoss: () => {
        const gl = (this.scene.app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      },
      tutorialStep: () => this.tutorial?.step ?? null,
      /** Installs a crafted run state (no saves) — performance and e2e scenarios. */
      loadState: (state: RunState) => this.installSandbox(RunEngine.restore(state)),
      /** Clears the frame-time samples behind frameStats(). */
      resetFrameStats: () => {
        this.scene.animator.frameTimes.length = 0;
      },
      /** Direct placement (bypasses pointer input) — debugging only. */
      place: (slot: SlotRef, x: number, y: number) => this.place(slot, x, y),
      ctl: this,
      achievements: () => ACHIEVEMENT_IDS.filter((a) => this.meta.achievements[a] !== undefined),
    };
  }

  private dragPoints(
    slot: SlotRef,
    x: number,
    y: number,
  ): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
    const engine = this.engine;
    const L = this.scene.layout;
    const piece = engine?.pieceAt(slot);
    const r = this.scene.tray.rectOf(slot);
    if (!engine || !piece || !r) return null;
    const pv = this.scene.tray.pieceView(slot);
    const shape = pv?.shape;
    if (!shape) return null;
    const pw = shape.w * L.cell;
    const ph = shape.h * L.cell;
    const lift = Math.max(L.cell * 1.25, 48);
    const to = { x: L.board.x + x * L.cell + pw / 2, y: L.board.y + y * L.cell + lift + ph };
    return { from: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, to };
  }
}
