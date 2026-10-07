/**
 * AdMob driver (@capacitor-community/admob 8.1). Plugin facts this relies on (verified in the
 * plugin's Android sources):
 * - `prepare*` resolves with `{ adUnitId }` once loaded and rejects on load failure.
 * - With `isTesting: true` on a non-test device the plugin swaps in Google's test unit, and
 *   keys the prepared ad by *that* id — so `show*` is called with the id `prepare*` returned.
 * - `showRewardVideoAd()` resolves only when a reward is earned and never settles on a plain
 *   dismiss; `showInterstitial()` resolves as soon as the ad starts. Completion therefore comes
 *   from the Showed / Dismissed / FailedToShow / Rewarded events, registered once after init.
 * - `testingDevices` are honoured only when `initializeForTesting` is true.
 * - There is no destroy for fullscreen ads: discarding just forgets the prepared id.
 */
import {
  AdMob,
  InterstitialAdPluginEvents,
  MaxAdContentRating,
  RewardAdPluginEvents,
  type AdMobPlugin,
} from '@capacitor-community/admob';
import { ADS } from '../../config';
import { IS_DEV } from '../env';
import { consentRequestOptions, toSnapshot, type ConsentSnapshot } from './consent';
import {
  guardInitialized,
  type AdDriver,
  type DriverInterstitialResult,
  type DriverRewardedResult,
  type FullscreenAdKind,
} from './types';

export type AdMobLike = Pick<
  AdMobPlugin,
  | 'initialize'
  | 'requestConsentInfo'
  | 'showConsentForm'
  | 'showPrivacyOptionsForm'
  | 'prepareRewardVideoAd'
  | 'showRewardVideoAd'
  | 'prepareInterstitial'
  | 'showInterstitial'
  | 'addListener'
>;

export interface AdUnitConfig {
  rewarded: string;
  interstitial: string;
  testing: boolean;
  testDevices: readonly string[];
}

export interface AdMobDriverOptions {
  plugin?: AdMobLike;
  config?: AdUnitConfig;
  /** Throw on prepare/show before initialize (default: dev builds). */
  strict?: boolean;
  /** Keep immersive (fullscreen) mode while the ad is up (GDD D24). */
  immersive?: boolean;
  /** Give up when the Showed event does not arrive within this time. */
  showTimeoutMs?: number;
  /** After Dismissed, wait this long for a late Rewarded event. */
  rewardGraceMs?: number;
}

type ShowEvent = 'showed' | 'dismissed' | 'failed' | 'rewarded';

interface ActiveShow {
  kind: FullscreenAdKind;
  on(ev: ShowEvent): void;
}

export function createAdMobDriver(opts: AdMobDriverOptions = {}): AdDriver {
  const plugin: AdMobLike = opts.plugin ?? AdMob;
  const cfg: AdUnitConfig = opts.config ?? ADS;
  const strict = opts.strict ?? IS_DEV;
  const immersive = opts.immersive ?? true;
  const showTimeoutMs = opts.showTimeoutMs ?? 10_000;
  const rewardGraceMs = opts.rewardGraceMs ?? 500;

  let initialized = false;
  let initializing: Promise<void> | null = null;
  /** adUnitId returned by the last successful prepare (consumed by show). */
  const unit: Record<FullscreenAdKind, string | null> = { rewarded: null, interstitial: null };
  let generation = 0;
  let active: ActiveShow | null = null;

  const route = (kind: FullscreenAdKind, ev: ShowEvent) => (): void => {
    if (active && active.kind === kind) active.on(ev);
  };

  async function registerListeners(): Promise<void> {
    await Promise.all([
      plugin.addListener(RewardAdPluginEvents.Showed, route('rewarded', 'showed')),
      plugin.addListener(RewardAdPluginEvents.Dismissed, route('rewarded', 'dismissed')),
      plugin.addListener(RewardAdPluginEvents.FailedToShow, route('rewarded', 'failed')),
      plugin.addListener(RewardAdPluginEvents.Rewarded, route('rewarded', 'rewarded')),
      plugin.addListener(InterstitialAdPluginEvents.Showed, route('interstitial', 'showed')),
      plugin.addListener(InterstitialAdPluginEvents.Dismissed, route('interstitial', 'dismissed')),
      plugin.addListener(InterstitialAdPluginEvents.FailedToShow, route('interstitial', 'failed')),
    ]);
  }

  const adOptions = (adId: string) => ({ adId, isTesting: cfg.testing, immersiveMode: immersive });

  return {
    name: 'admob',
    get initialized() {
      return initialized;
    },

    async requestConsentInfo() {
      return toSnapshot(await plugin.requestConsentInfo(consentRequestOptions(cfg.testing, cfg.testDevices)));
    },

    async showConsentForm(prev: ConsentSnapshot | null) {
      return toSnapshot(await plugin.showConsentForm(), prev ?? undefined);
    },

    async showPrivacyOptionsForm() {
      await plugin.showPrivacyOptionsForm();
    },

    initialize() {
      if (initialized) return Promise.resolve();
      if (!initializing) {
        initializing = (async () => {
          await plugin.initialize({
            initializeForTesting: cfg.testing || cfg.testDevices.length > 0,
            testingDevices: [...cfg.testDevices],
            tagForChildDirectedTreatment: false,
            tagForUnderAgeOfConsent: false,
            maxAdContentRating: MaxAdContentRating.ParentalGuidance,
          });
          await registerListeners();
          initialized = true;
        })().finally(() => {
          initializing = null;
        });
      }
      return initializing;
    },

    async loadRewarded() {
      if (!guardInitialized(initialized, strict, 'prepareRewardVideoAd')) return false;
      const gen = generation;
      const info = await plugin.prepareRewardVideoAd(adOptions(cfg.rewarded));
      if (gen !== generation) return false;
      unit.rewarded = info?.adUnitId || cfg.rewarded;
      return true;
    },

    async loadInterstitial() {
      if (!guardInitialized(initialized, strict, 'prepareInterstitial')) return false;
      const gen = generation;
      const info = await plugin.prepareInterstitial(adOptions(cfg.interstitial));
      if (gen !== generation) return false;
      unit.interstitial = info?.adUnitId || cfg.interstitial;
      return true;
    },

    isLoaded(kind) {
      return initialized && unit[kind] !== null;
    },

    async showRewarded(onReward): Promise<DriverRewardedResult> {
      if (!guardInitialized(initialized, strict, 'showRewardVideoAd')) return 'failed';
      const adId = unit.rewarded;
      if (!adId || active) return 'failed';
      unit.rewarded = null; // consumed whatever happens
      return new Promise<DriverRewardedResult>((resolve) => {
        let rewarded = false;
        let showed = false;
        let done = false;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const finish = (r: DriverRewardedResult): void => {
          if (done) return;
          done = true;
          clearTimeout(showTimer);
          clearTimeout(grace);
          active = null;
          resolve(rewarded ? 'rewarded' : r);
        };
        active = {
          kind: 'rewarded',
          on(ev) {
            if (done) return;
            if (ev === 'rewarded') {
              if (rewarded) return;
              rewarded = true;
              try {
                onReward();
              } catch (e) {
                console.error('[press.ads] onReward failed', e);
              }
              if (grace !== undefined) finish('rewarded');
            } else if (ev === 'showed') {
              showed = true;
              clearTimeout(showTimer);
            } else if (ev === 'dismissed') {
              if (rewarded) finish('rewarded');
              else grace = setTimeout(() => finish('dismissed'), rewardGraceMs);
            } else {
              finish('failed');
            }
          },
        };
        const showTimer = setTimeout(() => {
          if (!showed) finish('failed');
        }, showTimeoutMs);
        // Resolves on reward only (ignored: the Rewarded event is the single source of truth).
        plugin.showRewardVideoAd({ adId }).catch(() => finish('failed'));
      });
    },

    async showInterstitial(): Promise<DriverInterstitialResult> {
      if (!guardInitialized(initialized, strict, 'showInterstitial')) return 'failed';
      const adId = unit.interstitial;
      if (!adId || active) return 'failed';
      unit.interstitial = null;
      return new Promise<DriverInterstitialResult>((resolve) => {
        let showed = false;
        let done = false;
        const finish = (r: DriverInterstitialResult): void => {
          if (done) return;
          done = true;
          clearTimeout(showTimer);
          active = null;
          resolve(r);
        };
        active = {
          kind: 'interstitial',
          on(ev) {
            if (ev === 'showed') {
              showed = true;
              clearTimeout(showTimer);
            } else if (ev === 'dismissed') finish('shown');
            else if (ev === 'failed') finish(showed ? 'shown' : 'failed');
          },
        };
        const showTimer = setTimeout(() => {
          if (!showed) finish('failed');
        }, showTimeoutMs);
        plugin.showInterstitial({ adId }).catch(() => finish(showed ? 'shown' : 'failed'));
      });
    },

    discard() {
      generation++;
      unit.rewarded = null;
      unit.interstitial = null;
    },
  };
}
