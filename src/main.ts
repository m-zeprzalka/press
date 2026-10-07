/**
 * PRESS — bootstrap. Builds platform services, loads assets, creates the Pixi scene and the
 * game controller, then hands control to the title screen (or the tutorial on first launch).
 */
import './ui/styles.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { createAudioEngine } from './audio';
import { GameController } from './game/controller';
import type { Services } from './game/services';
import { applyInsetCssVars, createPlatform, registerServiceWorker, shareText, watchInsets } from './platform';
import { GameAssets } from './render/assets';
import { GameScene } from './render/scene';
import { cssVariables } from './theme';
import { t } from './ui/i18n';
import { UiManager } from './ui/manager';

interface PressSystemPlugin {
  setImmersive(opts: { on: boolean }): Promise<void>;
  setGestureExclusion(opts: { rects: Array<{ x: number; y: number; w: number; h: number }> }): Promise<void>;
  getTextScale(): Promise<{ scale: number }>;
}
const PressSystem = registerPlugin<PressSystemPlugin>('PressSystem');

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function fatal(message: string): void {
  const ui = document.getElementById('ui');
  if (!ui) return;
  ui.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'screen center';
  box.innerHTML = `<div class="column" style="text-align:center"><h1 class="riso-title">PRESS</h1><p></p></div>`;
  (box.querySelector('p') as HTMLParagraphElement).textContent = message;
  ui.append(box);
}

async function boot(): Promise<void> {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVariables())) root.style.setProperty(k, v);
  applyInsetCssVars(root);
  const native = Capacitor.isNativePlatform();
  const params = new URLSearchParams(location.search);

  if (!webglSupported()) {
    fatal(t('webview.outdated'));
    return;
  }

  // ---- platform services
  const platform = createPlatform();
  const audio = createAudioEngine();
  const services: Services = {
    isNative: native,
    audio: {
      unlock: () => void audio.unlock(),
      play: (sfx, opts) => audio.play(sfx as Parameters<typeof audio.play>[0], opts),
      setMusic: (mode) => audio.setMusic(mode),
      setIntensity: (v) => audio.setIntensity(v),
      setMusicVolume: (v) => audio.setMusicVolume(v),
      setSfxVolume: (v) => audio.setSfxVolume(v),
      suspend: () => void audio.suspend(),
      resume: () => void audio.resume(),
    },
    haptics: platform.haptics,
    saves: {
      loadRun: (k) => platform.saves.loadRun(k),
      saveRun: (k, s) => void platform.saves.saveRun(k, s),
      clearRun: (k) => platform.saves.clearRun(k),
      loadMeta: () => platform.saves.loadMeta(),
      saveMeta: (m) => void platform.saves.saveMeta(m),
      loadJSON: (key, fb) => platform.saves.loadJSON(key, fb),
      saveJSON: (key, v) =>
        void (v === null ? platform.saves.removeJSON(key) : platform.saves.saveJSON(key, v)),
      flush: () => platform.saves.flush(),
    },
    ads: {
      start: async () => undefined, // started by platform.boot() on every new session
      needsConsentForm: () => platform.ads.needsConsentForm(),
      showConsentForm: () => platform.ads.showConsentForm(),
      privacyOptionsRequired: () => platform.ads.privacyOptionsRequired(),
      showPrivacyOptions: () => platform.ads.showPrivacyOptions(),
      available: (kind) => platform.ads.available(kind),
      showRewarded: (kind, hooks) => platform.ads.showRewarded(kind, hooks),
      maybeShowInterstitial: (ctx) =>
        platform.ads.maybeShowInterstitial({
          trigger: ctx.trigger,
          resultsVisibleMs: ctx.resultsVisibleMs,
          rewardedThisRun: ctx.rewardedThisRun,
        }),
      onRunCompleted: (lost) => void platform.ads.onRunCompleted({ lost }),
    },
    iap: {
      get available() {
        return platform.iap.supported;
      },
      get entitled() {
        return platform.iap.entitled;
      },
      get pending() {
        return platform.iap.pending;
      },
      refresh: async () => void (await platform.iap.refresh()),
      product: () => platform.iap.product(),
      purchase: () => platform.iap.purchase(),
      restore: async () => void (await platform.iap.restore()),
      onChange: (cb) => platform.iap.onChange(() => cb()),
    },
    lifecycle: {
      get sessionIndex() {
        return platform.lifecycle.sessionIndex;
      },
      get isFirstSession() {
        return platform.lifecycle.isFirstSession;
      },
      onPause: (cb) => void platform.lifecycle.onPause(cb),
      onResume: (cb) => void platform.lifecycle.onResume(() => cb()),
      setAdShowing: (on) => platform.lifecycle.setAdShowing(on),
    },
    back: platform.back,
    share: async (text) => {
      const r = await shareText(text, t('share.title'));
      return r === 'cancelled' ? 'failed' : r;
    },
    openUrl: (url) => {
      window.open(url, '_blank', 'noopener');
    },
    setFullscreen: (on) => {
      if (native) void PressSystem.setImmersive({ on }).catch(() => undefined);
    },
  };
  platform.onFullscreenChange((showing) => (showing ? void audio.suspend() : void audio.resume()));
  await platform.boot();

  if (native) {
    try {
      const { scale } = await PressSystem.getTextScale();
      root.style.setProperty('--fs', String(scale || 1));
    } catch {
      /* web or old build */
    }
  }

  // ---- assets & scene
  const assets = new GameAssets('./');
  await assets.load();
  const stage = document.getElementById('stage') as HTMLElement;
  const scene = await GameScene.create(stage, assets, { style: { symbols: false }, reduceMotion: false });
  const ui = new UiManager(document.getElementById('ui') as HTMLElement, platform.back);
  const controller = new GameController(services, scene, ui, document.getElementById('hud') as HTMLElement);
  if (params.get('seed')) controller.seedOverride = params.get('seed');

  // Insets (safe area / cutouts) → layout; tray band excluded from edge back-gestures.
  watchInsets((insets) => {
    scene.setInsets(insets);
    controller.relayout();
    if (native && scene.layout) {
      const tr = scene.layout.tray;
      void PressSystem.setGestureExclusion({
        rects: [{ x: 0, y: tr.y, w: scene.layout.width, h: tr.h }],
      }).catch(() => undefined);
    }
  });

  if (params.has('debug') || params.has('e2e')) {
    (window as unknown as { __press: unknown }).__press = controller.debugApi();
  }

  await controller.boot();
  if (native) void SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => undefined);
  void registerServiceWorker();
}

boot().catch((e: unknown) => {
  console.error(e);
  fatal(String((e as Error)?.message ?? e));
});
