import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AdmobModule from '@capacitor-community/admob';
import { ADS } from '../../config';
import { createMemoryStore, createSaveStore } from '../storage';
import { createAdMobDriver } from './admob';
import { createAdsService, type AdsServiceOptions } from './index';
import { AdsOrderError, type RewardedHooks } from './types';

type Script = 'reward' | 'dismiss' | 'reward_after_dismiss' | 'fail' | 'reject';

const sdk = vi.hoisted(() => {
  const listeners = new Map<string, Set<(data?: unknown) => void>>();
  const calls: string[] = [];
  const allowed = {
    status: 'NOT_REQUIRED',
    isConsentFormAvailable: false,
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'NOT_REQUIRED',
  };
  const s = {
    consent: { ...allowed } as Record<string, unknown>,
    afterForm: { ...allowed, status: 'OBTAINED' } as Record<string, unknown>,
    consentFails: 0,
    rewarded: 'reward' as 'reward' | 'dismiss' | 'reward_after_dismiss' | 'fail' | 'reject',
    load: 'ok' as 'ok' | 'fail' | 'hang',
  };
  const emit = (ev: string): void => listeners.get(ev)?.forEach((cb) => cb({}));
  const at = (ms: number, fn: () => void): void => void setTimeout(fn, ms);
  const prepare = (kind: string) =>
    vi.fn((_o: unknown) => {
      calls.push(`prepare:${kind}`);
      if (s.load === 'hang') return new Promise<never>(() => undefined);
      if (s.load === 'fail') return Promise.reject(new Error('No fill'));
      return Promise.resolve({ adUnitId: `swapped-${kind}` });
    });
  return {
    listeners,
    calls,
    s,
    allowed,
    initialize: vi.fn(async (_o: unknown) => void calls.push('initialize')),
    requestConsentInfo: vi.fn(async (_o: unknown) => {
      calls.push('requestConsentInfo');
      if (s.consentFails > 0) {
        s.consentFails--;
        throw new Error('offline');
      }
      return { ...s.consent };
    }),
    showConsentForm: vi.fn(async () => {
      calls.push('showConsentForm');
      s.consent = { ...s.afterForm };
      const { isConsentFormAvailable: _omitted, ...rest } = s.consent;
      return rest;
    }),
    showPrivacyOptionsForm: vi.fn(async () => void calls.push('showPrivacyOptionsForm')),
    prepareRewardVideoAd: prepare('rewarded'),
    prepareInterstitial: prepare('interstitial'),
    showRewardVideoAd: vi.fn((_o: unknown) => {
      calls.push('showRewardVideoAd');
      return new Promise((resolve, reject) => {
        switch (s.rewarded) {
          case 'reward':
            at(5, () => emit('onRewardedVideoAdShowed'));
            at(30, () => {
              emit('onRewardedVideoAdReward');
              resolve({ type: 'coins', amount: 1 });
            });
            at(40, () => emit('onRewardedVideoAdDismissed'));
            break;
          case 'dismiss':
            at(5, () => emit('onRewardedVideoAdShowed'));
            at(40, () => emit('onRewardedVideoAdDismissed'));
            break; // the plugin never settles this promise on a plain dismiss
          case 'reward_after_dismiss':
            at(5, () => emit('onRewardedVideoAdShowed'));
            at(40, () => emit('onRewardedVideoAdDismissed'));
            at(140, () => emit('onRewardedVideoAdReward'));
            break;
          case 'fail':
            at(5, () => emit('onRewardedVideoAdFailedToShow'));
            break;
          case 'reject':
            reject(new Error('No Reward Video Ad can be shown'));
            break;
        }
      });
    }),
    showInterstitial: vi.fn(async (_o: unknown) => {
      calls.push('showInterstitial');
      at(5, () => emit('interstitialAdShowed'));
      at(50, () => emit('interstitialAdDismissed'));
    }),
    addListener: vi.fn(async (ev: string, cb: (data?: unknown) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)?.add(cb);
      return { remove: async () => void listeners.get(ev)?.delete(cb) };
    }),
  };
});

vi.mock('@capacitor-community/admob', async (importOriginal) => ({
  ...(await importOriginal<typeof AdmobModule>()),
  AdMob: sdk,
}));

const SDK_FNS = [
  sdk.initialize,
  sdk.requestConsentInfo,
  sdk.showConsentForm,
  sdk.showPrivacyOptionsForm,
  sdk.prepareRewardVideoAd,
  sdk.prepareInterstitial,
  sdk.showRewardVideoAd,
  sdk.showInterstitial,
  sdk.addListener,
];

let clock = 1_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of SDK_FNS) fn.mockClear();
  sdk.calls.length = 0;
  sdk.listeners.clear();
  sdk.s.consent = { ...sdk.allowed };
  sdk.s.afterForm = { ...sdk.allowed, status: 'OBTAINED' };
  sdk.s.consentFails = 0;
  sdk.s.rewarded = 'reward';
  sdk.s.load = 'ok';
  clock = 1_000_000_000;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Advances fake time until `p` settles. */
async function settle<T>(p: Promise<T>, maxMs = 5000): Promise<T> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let t = 0; t < maxMs && !done; t += 10) await vi.advanceTimersByTimeAsync(10);
  return p;
}

function setup(o: { strict?: boolean; seed?: Record<string, string> } = {}) {
  const strict = o.strict ?? true;
  const kv = createMemoryStore(o.seed);
  const store = createSaveStore(kv, { onError: () => undefined });
  const sinkLog: string[] = [];
  const sinks = [
    { setAdShowing: (b: boolean) => sinkLog.push(`lifecycle:${b}`) },
    { setAdShowing: (b: boolean) => sinkLog.push(`back:${b}`) },
  ];
  const fullscreen: boolean[] = [];
  const opts: AdsServiceOptions = {
    store,
    driver: createAdMobDriver({ strict }),
    sinks,
    onFullscreenChange: (b) => fullscreen.push(b),
    strict,
    now: () => clock,
  };
  const ads = createAdsService(opts);
  return { ads, kv, sinkLog, fullscreen };
}

function hooks(log: string[] = []) {
  const h = {
    log,
    rewards: 0,
    beforeShow: vi.fn(async () => void log.push('beforeShow')),
    onReward: vi.fn(() => {
      h.rewards++;
      log.push('onReward');
    }),
  };
  return h satisfies RewardedHooks;
}

const sdkCalls = (): number => SDK_FNS.reduce((n, fn) => n + fn.mock.calls.length, 0);

describe('start: who gets an SDK at all', () => {
  it('session 1 → no SDK call whatsoever', async () => {
    const { ads } = setup();
    await ads.start({ sessionIndex: 1, noAds: false });
    await ads.retry();
    await ads.onRunCompleted({ lost: true });
    expect(sdkCalls()).toBe(0);
    expect(ads.phase).toBe('off');
    expect(ads.available('rewarded')).toBe(false);
    expect(ads.available('interstitial')).toBe(false);
    expect(
      await ads.maybeShowInterstitial({
        trigger: 'new_run_button',
        resultsVisibleMs: 5000,
        rewardedThisRun: false,
      }),
    ).toBe(false);
    expect(sdkCalls()).toBe(0);
  });

  it('"No ads" buyers → no SDK call; rewards are granted without video', async () => {
    const { ads } = setup();
    await ads.start({ sessionIndex: 5, noAds: true });
    expect(sdkCalls()).toBe(0);
    expect(ads.rewardsAreFree).toBe(true);
    expect(ads.available('rewarded')).toBe(true);
    expect(ads.available('interstitial')).toBe(false);
    expect(ads.privacyOptionsRequired()).toBe(false);
    const h = hooks();
    expect(await ads.showRewarded('reprint', h)).toBe('rewarded');
    expect(h.rewards).toBe(1);
    expect(h.beforeShow).not.toHaveBeenCalled();
    expect(sdkCalls()).toBe(0);
  });
});

describe('consent → initialize → preload (GDD §11.2)', () => {
  it('requests consent first, initializes with the configured options, then preloads both ads', async () => {
    const { ads } = setup();
    await ads.start({ sessionIndex: 2, noAds: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.calls).toEqual([
      'requestConsentInfo',
      'initialize',
      'prepare:rewarded',
      'prepare:interstitial',
    ]);
    expect(sdk.requestConsentInfo).toHaveBeenCalledWith({
      tagForUnderAgeOfConsent: false,
      debugGeography: 1,
    });
    expect(sdk.initialize).toHaveBeenCalledWith({
      initializeForTesting: true,
      testingDevices: [],
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      maxAdContentRating: 'ParentalGuidance',
    });
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledWith({
      adId: ADS.rewarded,
      isTesting: true,
      immersiveMode: true,
    });
    expect(sdk.prepareInterstitial).toHaveBeenCalledWith({
      adId: ADS.interstitial,
      isTesting: true,
      immersiveMode: true,
    });
    // event listeners registered after initialize, before any show
    expect(sdk.addListener.mock.invocationCallOrder[0]).toBeGreaterThan(
      sdk.initialize.mock.invocationCallOrder[0] ?? 0,
    );
    expect(ads.phase).toBe('ready');
    expect(ads.canRequestAds).toBe(true);
    expect(ads.isLoaded('rewarded')).toBe(true);
    expect(ads.available('interstitial')).toBe(true);
  });

  it('REQUIRED: nothing is initialized until the UI shows the form on the title screen', async () => {
    sdk.s.consent = {
      status: 'REQUIRED',
      isConsentFormAvailable: true,
      canRequestAds: false,
      privacyOptionsRequirementStatus: 'REQUIRED',
    };
    sdk.s.afterForm = {
      status: 'OBTAINED',
      canRequestAds: true,
      privacyOptionsRequirementStatus: 'REQUIRED',
    };
    const { ads } = setup();
    await ads.start({ sessionIndex: 3, noAds: false });
    expect(ads.phase).toBe('blocked');
    expect(ads.needsConsentForm()).toBe(true);
    expect(ads.available('rewarded')).toBe(false);
    expect(sdk.initialize).not.toHaveBeenCalled();
    expect(sdk.showConsentForm).not.toHaveBeenCalled(); // the service never opens it on its own
    await ads.showConsentForm();
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.calls).toEqual([
      'requestConsentInfo',
      'showConsentForm',
      'initialize',
      'prepare:rewarded',
      'prepare:interstitial',
    ]);
    expect(ads.needsConsentForm()).toBe(false);
    expect(ads.privacyOptionsRequired()).toBe(true);
    expect(ads.available('rewarded')).toBe(true);
  });

  it('declined consent → blocked, never initialized, buttons hidden', async () => {
    sdk.s.consent = {
      status: 'REQUIRED',
      isConsentFormAvailable: true,
      canRequestAds: false,
      privacyOptionsRequirementStatus: 'REQUIRED',
    };
    sdk.s.afterForm = {
      status: 'OBTAINED',
      canRequestAds: false,
      privacyOptionsRequirementStatus: 'REQUIRED',
    };
    const { ads } = setup({ strict: false });
    await ads.start({ sessionIndex: 2, noAds: false });
    await ads.showConsentForm();
    expect(ads.phase).toBe('blocked');
    expect(sdk.initialize).not.toHaveBeenCalled();
    expect(ads.available('rewarded')).toBe(false);
    expect(await ads.showRewarded('reroll', hooks())).toBe('unavailable');
    expect(sdk.prepareRewardVideoAd).not.toHaveBeenCalled();
  });

  it('consent failure (offline) → no ads now, retried when a run ends', async () => {
    sdk.s.consentFails = 1;
    const { ads } = setup();
    await ads.start({ sessionIndex: 2, noAds: false });
    expect(ads.phase).toBe('error');
    expect(ads.available('rewarded')).toBe(false);
    expect(sdk.initialize).not.toHaveBeenCalled();
    await ads.onRunCompleted({ lost: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.requestConsentInfo).toHaveBeenCalledTimes(2);
    expect(ads.phase).toBe('ready');
  });
});

describe('ordering guard: no prepare/show before initialize', () => {
  it('driver: throws in dev (strict)', async () => {
    const d = createAdMobDriver({ strict: true });
    await expect(d.loadRewarded()).rejects.toBeInstanceOf(AdsOrderError);
    await expect(d.loadInterstitial()).rejects.toBeInstanceOf(AdsOrderError);
    await expect(d.showRewarded(() => undefined)).rejects.toBeInstanceOf(AdsOrderError);
    await expect(d.showInterstitial()).rejects.toBeInstanceOf(AdsOrderError);
    expect(sdk.prepareRewardVideoAd).not.toHaveBeenCalled();
    expect(sdk.showRewardVideoAd).not.toHaveBeenCalled();
  });

  it('driver: silent no-op in production', async () => {
    const d = createAdMobDriver({ strict: false });
    expect(await d.loadRewarded()).toBe(false);
    expect(await d.loadInterstitial()).toBe(false);
    expect(await d.showRewarded(() => undefined)).toBe('failed');
    expect(await d.showInterstitial()).toBe('failed');
    expect(sdkCalls()).toBe(0);
  });

  it('service: showRewarded before start throws in dev, is "unavailable" in production', async () => {
    await expect(setup({ strict: true }).ads.showRewarded('reroll', hooks())).rejects.toBeInstanceOf(
      AdsOrderError,
    );
    const prod = setup({ strict: false }).ads;
    const h = hooks();
    expect(await prod.showRewarded('reroll', h)).toBe('unavailable');
    await prod.start({ sessionIndex: 1, noAds: false });
    expect(await prod.showRewarded('reroll', h)).toBe('unavailable');
    expect(h.rewards).toBe(0);
    expect(sdkCalls()).toBe(0);
  });
});

describe('rewarded', () => {
  async function ready(o: { strict?: boolean } = {}) {
    const ctx = setup(o);
    await ctx.ads.start({ sessionIndex: 2, noAds: false });
    await vi.advanceTimersByTimeAsync(0);
    return ctx;
  }

  it('grants on the Rewarded event only, after beforeShow, with adShowing + audio hooks around it', async () => {
    const { ads, sinkLog, fullscreen, kv } = await ready();
    const log: string[] = [];
    const h = hooks(log);
    sdk.showRewardVideoAd.mockImplementationOnce((o: unknown) => {
      log.push(`show:${JSON.stringify(o)}`);
      return sdk.showRewardVideoAd(o);
    });
    clock += 5000;
    expect(await settle(ads.showRewarded('reroll', h))).toBe('rewarded');
    expect(log).toEqual(['beforeShow', 'show:{"adId":"swapped-rewarded"}', 'onReward']);
    expect(h.rewards).toBe(1);
    expect(sinkLog).toEqual(['lifecycle:true', 'back:true', 'lifecycle:false', 'back:false']);
    expect(fullscreen).toEqual([true, false]);
    expect(ads.state.lastFullscreenAt).toBe(clock);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(kv.data.get('press.ads') as string).lastFullscreenAt).toBe(clock);
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledTimes(2); // next one preloaded
    expect(ads.showing).toBe(false);
  });

  it('dismissed without reward → no grant (even after the grace window)', async () => {
    const { ads } = await ready();
    sdk.s.rewarded = 'dismiss';
    const h = hooks();
    expect(await settle(ads.showRewarded('reprint', h))).toBe('dismissed');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.rewards).toBe(0);
    expect(ads.state.lastFullscreenAt).toBe(clock); // it was still a fullscreen ad
  });

  it('a Rewarded event right after Dismissed still grants', async () => {
    const { ads } = await ready();
    sdk.s.rewarded = 'reward_after_dismiss';
    const h = hooks();
    expect(await settle(ads.showRewarded('daily_attempt', h))).toBe('rewarded');
    expect(h.rewards).toBe(1);
  });

  it('failure to show → unavailable, no grant, nothing recorded', async () => {
    const { ads } = await ready();
    for (const script of ['fail', 'reject'] as Script[]) {
      sdk.s.rewarded = script;
      const h = hooks();
      expect(await settle(ads.showRewarded('reroll', h))).toBe('unavailable');
      expect(h.rewards).toBe(0);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(ads.state.lastFullscreenAt).toBeNull();
  });

  it('not loaded within 6 s → unavailable (the chance is not consumed)', async () => {
    sdk.s.load = 'hang';
    const { ads } = await ready();
    const h = hooks();
    let result: string | null = null;
    void ads.showRewarded('reprint', h).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(5999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe('unavailable');
    expect(h.beforeShow).not.toHaveBeenCalled();
    expect(sdk.showRewardVideoAd).not.toHaveBeenCalled();
  });

  it('load failures retry in the background with backoff', async () => {
    sdk.s.load = 'fail';
    const { ads } = await ready();
    expect(ads.isLoaded('rewarded')).toBe(false);
    expect(ads.available('rewarded')).toBe(true); // button stays; showRewarded waits ≤ 6 s
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
    sdk.s.load = 'ok';
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
    expect(ads.isLoaded('rewarded')).toBe(true);
  });

  it('a waiting rewarded call rides on a load still in flight', async () => {
    const { ads } = await ready();
    sdk.s.rewarded = 'reward';
    expect(await settle(ads.showRewarded('reroll', hooks()))).toBe('rewarded');
    expect(await settle(ads.showRewarded('reroll', hooks()))).toBe('rewarded');
    expect(sdk.showRewardVideoAd).toHaveBeenCalledTimes(2);
  });

  it('a second call while one is showing → unavailable', async () => {
    const { ads } = await ready();
    const first = ads.showRewarded('reroll', hooks());
    await vi.advanceTimersByTimeAsync(10);
    expect(ads.showing).toBe(true);
    expect(await ads.showRewarded('reroll', hooks())).toBe('unavailable');
    expect(await settle(first)).toBe('rewarded');
  });

  it('a double tap while the ad is still loading is ignored and leaves the first untouched', async () => {
    sdk.s.load = 'hang';
    const { ads, fullscreen } = await ready();
    const h1 = hooks();
    const h2 = hooks();
    let first: string | null = null;
    void ads.showRewarded('reroll', h1).then((r) => (first = r));
    await vi.advanceTimersByTimeAsync(100);
    expect(await ads.showRewarded('reroll', h2)).toBe('unavailable'); // instantly, no side effects
    expect(h2.beforeShow).not.toHaveBeenCalled();
    expect(fullscreen).toEqual([]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(first).toBe('unavailable');
  });

  it('stillValid() = false after loading → the ad never opens', async () => {
    const { ads } = await ready();
    const h = { ...hooks(), stillValid: vi.fn(() => false) };
    expect(await settle(ads.showRewarded('reprint', h))).toBe('unavailable');
    expect(h.stillValid).toHaveBeenCalledTimes(1);
    expect(h.beforeShow).not.toHaveBeenCalled();
    expect(sdk.showRewardVideoAd).not.toHaveBeenCalled();
    expect(h.rewards).toBe(0);
  });

  it('beforeShow failure aborts before the ad opens', async () => {
    const { ads } = await ready();
    const h = hooks();
    h.beforeShow.mockRejectedValueOnce(new Error('disk'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await ads.showRewarded('reroll', h)).toBe('unavailable');
    expect(sdk.showRewardVideoAd).not.toHaveBeenCalled();
  });
});

describe('interstitial', () => {
  const req = { trigger: 'new_run_button' as const, resultsVisibleMs: 2500, rewardedThisRun: false };

  async function eligible() {
    const ctx = setup({
      seed: { 'press.ads': JSON.stringify({ completedRuns: 3, lostRuns: 2, runsSinceInterstitial: 3 }) },
    });
    await ctx.ads.start({ sessionIndex: 2, noAds: false });
    await vi.advanceTimersByTimeAsync(0);
    return ctx;
  }

  it('shows when every rule passes, waits for dismiss, records it and preloads the next', async () => {
    const { ads, kv, sinkLog, fullscreen } = await eligible();
    expect(await settle(ads.maybeShowInterstitial(req))).toBe(true);
    expect(sdk.showInterstitial).toHaveBeenCalledWith({ adId: 'swapped-interstitial' });
    expect(ads.state).toMatchObject({
      interstitialsShown: 1,
      runsSinceInterstitial: 0,
      lastFullscreenAt: clock,
    });
    expect(sinkLog).toEqual(['lifecycle:true', 'back:true', 'lifecycle:false', 'back:false']);
    expect(fullscreen).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(kv.data.get('press.ads') as string).interstitialsShown).toBe(1);
    expect(sdk.prepareInterstitial).toHaveBeenCalledTimes(2);
    // spacing: not again right away
    expect(await ads.maybeShowInterstitial(req)).toBe(false);
  });

  it('never for disallowed triggers or a short Result screen; no SDK show call', async () => {
    const { ads } = await eligible();
    for (const trigger of ['back', 'endless_continue', 'abandon', 'cold_start', 'resume'] as const) {
      expect(await ads.maybeShowInterstitial({ ...req, trigger })).toBe(false);
    }
    expect(await ads.maybeShowInterstitial({ ...req, resultsVisibleMs: 1500 })).toBe(false);
    expect(await ads.maybeShowInterstitial({ ...req, rewardedThisRun: true })).toBe(false);
    expect(sdk.showInterstitial).not.toHaveBeenCalled();
  });

  it('respects 240 s after a rewarded ad', async () => {
    const { ads } = await eligible();
    expect(await settle(ads.showRewarded('reroll', hooks()))).toBe('rewarded');
    await vi.advanceTimersByTimeAsync(0);
    expect(await ads.maybeShowInterstitial({ ...req, now: clock + 239_000 })).toBe(false);
    expect(await settle(ads.maybeShowInterstitial({ ...req, now: clock + 240_000 }))).toBe(true);
  });

  it('counts runs through onRunCompleted (first one needs 2 losses)', async () => {
    const { ads } = setup();
    await ads.start({ sessionIndex: 2, noAds: false });
    await vi.advanceTimersByTimeAsync(0);
    await ads.onRunCompleted({ lost: true });
    expect(await ads.maybeShowInterstitial(req)).toBe(false);
    await ads.onRunCompleted({ lost: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(await settle(ads.maybeShowInterstitial(req))).toBe(true);
  });

  it('not shown when not loaded (never waits)', async () => {
    sdk.s.load = 'hang';
    const { ads } = await eligible();
    expect(await ads.maybeShowInterstitial(req)).toBe(false);
    expect(sdk.showInterstitial).not.toHaveBeenCalled();
  });
});

describe('privacy options & entitlement changes', () => {
  it('re-requests consent after the form; withdrawing drops loaded ads', async () => {
    sdk.s.consent = { ...sdk.allowed, status: 'OBTAINED', privacyOptionsRequirementStatus: 'REQUIRED' };
    const { ads } = setup();
    await ads.start({ sessionIndex: 2, noAds: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(ads.privacyOptionsRequired()).toBe(true);
    expect(ads.isLoaded('interstitial')).toBe(true);
    sdk.s.consent = { ...sdk.s.consent, canRequestAds: false };
    await ads.showPrivacyOptions();
    expect(sdk.calls.slice(-2)).toEqual(['showPrivacyOptionsForm', 'requestConsentInfo']);
    expect(ads.canRequestAds).toBe(false);
    expect(ads.isLoaded('interstitial')).toBe(false);
    expect(ads.available('rewarded')).toBe(false);
    expect(await ads.showRewarded('reroll', hooks())).toBe('unavailable');
    expect(sdk.showRewardVideoAd).not.toHaveBeenCalled();
  });

  it('keeping consent reloads the ads under the new choice', async () => {
    sdk.s.consent = { ...sdk.allowed, status: 'OBTAINED', privacyOptionsRequirementStatus: 'REQUIRED' };
    const { ads } = setup();
    await ads.start({ sessionIndex: 2, noAds: false });
    await vi.advanceTimersByTimeAsync(0);
    await ads.showPrivacyOptions();
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
    expect(ads.isLoaded('rewarded')).toBe(true);
  });

  it('privacy options are hidden unless UMP requires them', async () => {
    const { ads } = setup();
    await ads.start({ sessionIndex: 2, noAds: false });
    expect(ads.privacyOptionsRequired()).toBe(false);
    await ads.showPrivacyOptions();
    expect(sdk.showPrivacyOptionsForm).not.toHaveBeenCalled();
  });

  it('buying "No ads" mid-session stops ads; rewards become free', async () => {
    const { ads } = setup();
    await ads.start({ sessionIndex: 2, noAds: false });
    await vi.advanceTimersByTimeAsync(0);
    const changes = vi.fn();
    ads.onChange(changes);
    ads.setNoAds(true);
    expect(changes).toHaveBeenCalled();
    expect(ads.available('interstitial')).toBe(false);
    expect(ads.isLoaded('rewarded')).toBe(false);
    const h = hooks();
    expect(await ads.showRewarded('reroll', h)).toBe('rewarded');
    expect(sdk.showRewardVideoAd).not.toHaveBeenCalled();
    ads.setNoAds(false); // refund
    await vi.advanceTimersByTimeAsync(0);
    expect(ads.isLoaded('rewarded')).toBe(true);
  });

  it('a later session (long background) can start ads after a first session', async () => {
    const { ads } = setup();
    await ads.start({ sessionIndex: 1, noAds: false });
    expect(sdkCalls()).toBe(0);
    await ads.start({ sessionIndex: 2, noAds: false });
    expect(ads.phase).toBe('ready');
  });
});

describe('default driver', () => {
  it('uses the web simulation outside Capacitor', async () => {
    const ads = createAdsService({ store: createSaveStore(createMemoryStore()), strict: true });
    globalThis.__pressAdsAutoReward = true;
    try {
      await ads.start({ sessionIndex: 2, noAds: false });
      const h = hooks();
      expect(await ads.showRewarded('reroll', h)).toBe('rewarded');
      expect(h.rewards).toBe(1);
      expect(sdkCalls()).toBe(0);
    } finally {
      globalThis.__pressAdsAutoReward = undefined;
    }
  });
});
