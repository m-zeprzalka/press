/**
 * AdsService (GDD §11): consent → initialize → preload, rewarded and interstitial flows,
 * persisted interstitial bookkeeping (`press.ads`). SDK specifics live in the drivers
 * (admob.ts on native, web.ts in the browser/PWA); every rule lives here or in policy.ts.
 *
 * Choices:
 * - Session 1 → start() makes no SDK call at all (not even consent).
 * - "No ads" buyers → start() makes no SDK call either (no UMP request, no initialize): with
 *   no ad SDK running there is no ad-related processing to consent to, so the privacy-options
 *   entry stays hidden for them. Their rewards are granted instantly ("rewards without video").
 * - The rewarded button stays available while an ad is loading; showRewarded() waits ≤ 6 s.
 */
import { IS_DEV, isNative } from '../env';
import { Emitter } from '../emitter';
import { STORAGE_KEYS, type SaveStore } from '../storage';
import { createAdMobDriver } from './admob';
import { needsConsentForm, privacyOptionsRequired, UNKNOWN_CONSENT, type ConsentSnapshot } from './consent';
import {
  canShowInterstitial,
  newAdsState,
  normalizeAdsState,
  onFullscreenShown,
  onRunCompleted,
  type AdsState,
  type RewardedKind,
} from './policy';
import {
  AdsOrderError,
  type AdDriver,
  type AdsPhase,
  type AdsService,
  type AdsStartOptions,
  type DriverInterstitialResult,
  type DriverRewardedResult,
  type FullscreenAdKind,
  type InterstitialRequest,
  type RewardedHooks,
  type RewardedResult,
} from './types';
import { createWebAdDriver } from './web';

export * from './consent';
export * from './policy';
export * from './types';
export { createAdMobDriver, type AdMobDriverOptions, type AdMobLike, type AdUnitConfig } from './admob';
export { createWebAdDriver, WEB_AD_LABEL, type WebAdDriverOptions } from './web';

export interface AdShowingSink {
  setAdShowing(showing: boolean): void;
}

export interface AdsServiceOptions {
  store: Pick<SaveStore, 'loadJSON' | 'saveJSON'>;
  /** Defaults to AdMob on native, the DOM simulation on the web. */
  driver?: AdDriver;
  /** Lifecycle + BackRouter: their pause/resume/back handling is suppressed during ads. */
  sinks?: AdShowingSink[];
  /** Audio: suspend the AudioContext while a fullscreen ad is up. */
  onFullscreenChange?: (showing: boolean) => void;
  /** Throw on show-before-initialize (default: dev builds). */
  strict?: boolean;
  now?: () => number;
  /** GDD §11.4: give up on a rewarded ad that is not loaded within 6 s. */
  loadTimeoutMs?: number;
  /** Background reload backoff after a failed load (ms). */
  retryDelaysMs?: readonly number[];
}

export const REWARDED_LOAD_TIMEOUT_MS = 6000;
const DEFAULT_RETRY_DELAYS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;

interface Loader {
  ready: boolean;
  inflight: Promise<boolean> | null;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function createAdsService(opts: AdsServiceOptions): AdsService {
  const driver = opts.driver ?? (isNative() ? createAdMobDriver() : createWebAdDriver());
  const strict = opts.strict ?? IS_DEV;
  const now = opts.now ?? Date.now;
  const loadTimeoutMs = opts.loadTimeoutMs ?? REWARDED_LOAD_TIMEOUT_MS;
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  const sinks = opts.sinks ?? [];
  const changes = new Emitter<[]>('press.ads');

  let ads: AdsState = newAdsState();
  let adsLoad: Promise<void> | null = null;
  let sessionIndex = 0;
  let noAds = false;
  let consent: ConsentSnapshot | null = null;
  let phase: AdsPhase = 'off';
  let flow: Promise<void> | null = null;
  let showing = false;
  let disposed = false;
  const loaders: Record<FullscreenAdKind, Loader> = {
    rewarded: { ready: false, inflight: null, attempt: 0, timer: null },
    interstitial: { ready: false, inflight: null, attempt: 0, timer: null },
  };

  const emit = (): void => changes.emit();
  const setPhase = (p: AdsPhase): void => {
    if (phase !== p) {
      phase = p;
      emit();
    }
  };

  const ensureAdsState = (): Promise<void> => {
    if (!adsLoad) {
      adsLoad = opts.store
        .loadJSON<AdsState>(STORAGE_KEYS.ads, newAdsState(), normalizeAdsState)
        .then((s) => {
          ads = s;
        })
        .catch(() => undefined);
    }
    return adsLoad;
  };
  const persist = (): void => {
    opts.store.saveJSON(STORAGE_KEYS.ads, ads).catch(() => undefined);
  };

  const sdkAllowed = (): boolean => !disposed && !noAds && sessionIndex >= 2;

  const clearRetry = (l: Loader): void => {
    if (l.timer !== null) clearTimeout(l.timer);
    l.timer = null;
  };

  const dropAds = (): void => {
    driver.discard();
    for (const l of Object.values(loaders)) {
      l.ready = false;
      l.attempt = 0;
      clearRetry(l);
    }
    emit();
  };

  function scheduleRetry(kind: FullscreenAdKind): void {
    const l = loaders[kind];
    if (l.timer !== null || l.attempt >= retryDelays.length) return;
    const delay = retryDelays[l.attempt] ?? 300_000;
    l.attempt++;
    l.timer = setTimeout(() => {
      l.timer = null;
      if (phase === 'ready' && sdkAllowed()) preload(kind);
    }, delay);
  }

  function load(kind: FullscreenAdKind): Promise<boolean> {
    const l = loaders[kind];
    if (l.ready) return Promise.resolve(true);
    if (l.inflight) return l.inflight;
    l.inflight = (async () => {
      try {
        const ok = await (kind === 'rewarded' ? driver.loadRewarded() : driver.loadInterstitial());
        l.ready = ok && sdkAllowed() && phase === 'ready';
        if (l.ready) {
          l.attempt = 0;
          clearRetry(l);
        }
        return l.ready;
      } catch (e) {
        if (e instanceof AdsOrderError) throw e;
        l.ready = false;
        scheduleRetry(kind);
        return false;
      } finally {
        l.inflight = null;
        emit();
      }
    })();
    return l.inflight;
  }

  function preload(kind: FullscreenAdKind): void {
    if (phase !== 'ready' || !sdkAllowed()) return;
    load(kind).catch((e: unknown) => console.error('[press.ads] preload failed', e));
  }

  async function initAndPreload(): Promise<void> {
    if (!sdkAllowed() || !consent?.canRequestAds) return;
    if (!driver.initialized) {
      setPhase('initializing');
      try {
        await driver.initialize();
      } catch (e) {
        console.warn('[press.ads] initialize failed', e);
        setPhase('error');
        return;
      }
    }
    if (!sdkAllowed()) return;
    setPhase('ready');
    preload('rewarded');
    preload('interstitial');
  }

  /** Consent info → (form decided by the UI) → initialize when allowed. */
  function runFlow(): Promise<void> {
    if (flow) return flow;
    flow = (async () => {
      setPhase('consent');
      try {
        consent = await driver.requestConsentInfo();
      } catch (e) {
        console.warn('[press.ads] requestConsentInfo failed', e);
        consent = consent ?? { ...UNKNOWN_CONSENT };
        setPhase('error');
        return;
      }
      if (!sdkAllowed()) return;
      if (consent.canRequestAds) await initAndPreload();
      else setPhase('blocked');
    })().finally(() => {
      flow = null;
      emit();
    });
    return flow;
  }

  function setShowing(b: boolean): void {
    showing = b;
    for (const s of sinks) {
      try {
        s.setAdShowing(b);
      } catch (e) {
        console.error('[press.ads] sink failed', e);
      }
    }
    try {
      opts.onFullscreenChange?.(b);
    } catch (e) {
      console.error('[press.ads] onFullscreenChange failed', e);
    }
    emit();
  }

  const grantFree = (hooks: RewardedHooks): RewardedResult => {
    try {
      hooks.onReward();
    } catch (e) {
      console.error('[press.ads] onReward failed', e);
    }
    return 'rewarded';
  };

  const service: AdsService = {
    async start(o: AdsStartOptions) {
      sessionIndex = Math.max(sessionIndex, Math.floor(o.sessionIndex));
      noAds = o.noAds;
      await ensureAdsState();
      if (!sdkAllowed()) return; // session 1 or buyer: zero SDK calls
      if (phase === 'off' || phase === 'error') await runFlow();
      else if (flow) await flow;
    },

    get phase() {
      return phase;
    },
    get canRequestAds() {
      return consent?.canRequestAds === true;
    },
    get rewardsAreFree() {
      return noAds;
    },
    get state() {
      return { ...ads };
    },
    get showing() {
      return showing;
    },

    needsConsentForm() {
      return sdkAllowed() && needsConsentForm(consent);
    },

    async showConsentForm() {
      if (!service.needsConsentForm() || showing) return;
      try {
        consent = await driver.showConsentForm(consent);
      } catch (e) {
        console.warn('[press.ads] showConsentForm failed', e);
        return;
      } finally {
        emit();
      }
      if (consent.canRequestAds) await initAndPreload();
      else setPhase('blocked');
    },

    privacyOptionsRequired() {
      return privacyOptionsRequired(consent);
    },

    async showPrivacyOptions() {
      if (!privacyOptionsRequired(consent) || showing) return;
      try {
        await driver.showPrivacyOptionsForm();
      } catch (e) {
        console.warn('[press.ads] showPrivacyOptionsForm failed', e);
      }
      try {
        consent = await driver.requestConsentInfo();
      } catch (e) {
        console.warn('[press.ads] requestConsentInfo failed', e);
      }
      // Ads loaded under the previous choice must not be shown any more.
      dropAds();
      if (!consent?.canRequestAds) {
        if (phase !== 'off') setPhase('blocked');
        return;
      }
      await initAndPreload();
    },

    available(kind) {
      if (showing || disposed) return false;
      if (kind === 'rewarded') {
        if (noAds) return true;
        return sdkAllowed() && service.canRequestAds && (phase === 'ready' || phase === 'initializing');
      }
      return (
        sdkAllowed() && phase === 'ready' && loaders.interstitial.ready && driver.isLoaded('interstitial')
      );
    },

    isLoaded(kind) {
      return phase === 'ready' && loaders[kind].ready && driver.isLoaded(kind);
    },

    async showRewarded(kind: RewardedKind, hooks: RewardedHooks): Promise<RewardedResult> {
      if (noAds) return grantFree(hooks);
      if (showing || disposed) return 'unavailable';
      const pending = phase === 'consent' || phase === 'initializing';
      if (!driver.initialized && !pending) {
        if (strict)
          throw new AdsOrderError(`showRewarded('${kind}') [phase=${phase}, session=${sessionIndex}]`);
        return 'unavailable';
      }
      const ready = async (): Promise<boolean> => {
        if (flow) await flow;
        if (phase !== 'ready' || !sdkAllowed()) return false;
        return load('rewarded');
      };
      const loaded = await withTimeout(ready(), loadTimeoutMs, false);
      if (!loaded || showing) {
        if (phase === 'ready') preload('rewarded');
        return 'unavailable';
      }
      if (noAds) return grantFree(hooks);
      try {
        await hooks.beforeShow();
      } catch (e) {
        console.error('[press.ads] beforeShow failed', e);
        return 'unavailable';
      }
      let granted = false;
      let result: DriverRewardedResult = 'failed';
      setShowing(true);
      try {
        result = await driver.showRewarded(() => {
          if (granted) return;
          granted = true;
          hooks.onReward();
        });
      } catch (e) {
        if (e instanceof AdsOrderError) throw e;
        console.warn('[press.ads] showRewarded failed', e);
      } finally {
        loaders.rewarded.ready = false;
        setShowing(false);
        if (granted || result !== 'failed') {
          ads = onFullscreenShown(ads, now(), 'rewarded');
          persist();
        }
        preload('rewarded');
      }
      if (granted) return 'rewarded';
      return result === 'dismissed' ? 'dismissed' : 'unavailable';
    },

    async maybeShowInterstitial(req: InterstitialRequest) {
      await ensureAdsState();
      if (showing || disposed) return false;
      const ctx = {
        sessionIndex,
        noAds,
        trigger: req.trigger,
        resultsVisibleMs: req.resultsVisibleMs,
        rewardedThisRun: req.rewardedThisRun,
        adLoaded: service.available('interstitial'),
        now: req.now ?? now(),
      };
      if (!canShowInterstitial(ads, ctx)) return false;
      let result: DriverInterstitialResult = 'failed';
      setShowing(true);
      try {
        result = await driver.showInterstitial();
      } catch (e) {
        if (e instanceof AdsOrderError) throw e;
        console.warn('[press.ads] showInterstitial failed', e);
      } finally {
        loaders.interstitial.ready = false;
        setShowing(false);
        if (result === 'shown') {
          ads = onFullscreenShown(ads, req.now ?? now(), 'interstitial');
          persist();
        }
        preload('interstitial');
      }
      return result === 'shown';
    },

    async onRunCompleted(run) {
      await ensureAdsState();
      ads = onRunCompleted(ads, run);
      persist();
      service.retry().catch(() => undefined);
    },

    setNoAds(b) {
      if (noAds === b) return;
      noAds = b;
      if (b) {
        dropAds();
        return;
      }
      emit();
      // Entitlement revoked (refund): resume the normal flow if this session allows ads.
      if (sdkAllowed()) {
        if (phase === 'off' || phase === 'error' || phase === 'blocked') runFlow().catch(() => undefined);
        else if (phase === 'ready') {
          preload('rewarded');
          preload('interstitial');
        }
      }
    },

    async retry() {
      if (!sdkAllowed()) return;
      if (flow) return flow;
      if (phase === 'off' || phase === 'error' || phase === 'blocked') {
        await runFlow();
        return;
      }
      if (phase === 'ready') {
        for (const kind of ['rewarded', 'interstitial'] as const) {
          loaders[kind].attempt = 0;
          preload(kind);
        }
      }
    },

    onChange: (cb) => changes.add(cb),

    dispose() {
      disposed = true;
      for (const l of Object.values(loaders)) clearRetry(l);
      changes.clear();
    },
  };
  return service;
}
