/**
 * Platform layer (Capacitor / web). See README.md for the module map and boot sequence.
 */
import { createAdsService, type AdsService } from './ads';
import { createBackRouter, type BackRouter } from './back';
import { Emitter } from './emitter';
import { createHaptics, type Haptics } from './haptics';
import { createIapService, type IapService } from './iap';
import { createLifecycle, type Lifecycle } from './lifecycle';
import { createSaveStore, defaultKeyValueStore, type KeyValueStore, type SaveStore } from './storage';

export * from './env';
export * from './storage';
export * from './haptics';
export * from './lifecycle';
export * from './back';
export * from './ads';
export * from './iap';
export * from './share';
export * from './insets';
export * from './pwa';
export * from './analytics';
export { Emitter } from './emitter';

export interface Platform {
  kv: KeyValueStore;
  saves: SaveStore;
  haptics: Haptics;
  lifecycle: Lifecycle;
  back: BackRouter;
  ads: AdsService;
  iap: IapService;
  /** Audio hook: true while a fullscreen ad is up (suspend the AudioContext). */
  onFullscreenChange(cb: (showing: boolean) => void): () => void;
  /**
   * Cold-start wiring: cached entitlement → back button → session (+ ads.start on every new
   * session, which is a no-op in session 1 and for buyers) → IAP refresh now and on resume.
   */
  boot(): Promise<{ sessionIndex: number }>;
}

export function createPlatform(opts: { kv?: KeyValueStore } = {}): Platform {
  const kv = opts.kv ?? defaultKeyValueStore();
  const saves = createSaveStore(kv);
  const haptics = createHaptics();
  const lifecycle = createLifecycle({ kv });
  const back = createBackRouter();
  const fullscreen = new Emitter<[boolean]>('press.platform');
  const iap = createIapService({ store: saves });
  const ads = createAdsService({
    store: saves,
    sinks: [lifecycle, back],
    onFullscreenChange: (b) => fullscreen.emit(b),
  });
  let booted: Promise<{ sessionIndex: number }> | null = null;

  return {
    kv,
    saves,
    haptics,
    lifecycle,
    back,
    ads,
    iap,
    onFullscreenChange: (cb) => fullscreen.add(cb),
    boot() {
      if (!booted) {
        booted = (async () => {
          await iap.load();
          iap.onChange((s) => ads.setNoAds(s.entitled));
          lifecycle.onResume(() => {
            iap.refresh().catch(() => undefined);
          });
          lifecycle.onSessionStart((sessionIndex) => {
            // A purchase that completed while the app was closed must win before any UMP/AdMob
            // work: give the store a short head start (cached entitlement otherwise).
            const fresh = Promise.race([
              iap.refresh().catch(() => undefined),
              new Promise((r) => setTimeout(r, 2500)),
            ]);
            void fresh.then(() => ads.start({ sessionIndex, noAds: iap.entitled }).catch(() => undefined));
          });
          await back.start();
          const sessionIndex = await lifecycle.start();
          return { sessionIndex };
        })();
      }
      return booted;
    },
  };
}
