/**
 * Web / PWA ad simulation — no SDK. Same AdsService rules apply (no ads in session 1, policy,
 * caps); only the "ad" is a DOM overlay:
 * - rewarded: "Reklama testowa / Test ad" for 1.5 s, then the reward. A "×" appears after 1 s;
 *   closing early via "×" → dismissed (no reward).
 * - interstitial: the same overlay for 1 s, then it closes by itself.
 *
 * e2e hooks (read on every show):
 * - `window.__pressAdsAutoReward = true` → no overlay; rewarded ads grant instantly and
 *   interstitials close instantly.
 * - `window.__pressAdsLog = []` → each shown ad pushes `{ kind, result, at }`.
 */
import { browser, IS_DEV } from '../env';
import { WEB_CONSENT } from './consent';
import {
  guardInitialized,
  type AdDriver,
  type DriverInterstitialResult,
  type DriverRewardedResult,
  type FullscreenAdKind,
} from './types';

declare global {
  var __pressAdsAutoReward: boolean | undefined;
  var __pressAdsLog: Array<{ kind: FullscreenAdKind; result: string; at: number }> | undefined;
}

export interface WebAdDriverOptions {
  strict?: boolean;
  doc?: Document | null;
  rewardMs?: number;
  closeButtonAfterMs?: number;
  interstitialMs?: number;
}

export const WEB_AD_LABEL = 'Reklama testowa / Test ad';

function log(kind: FullscreenAdKind, result: string): void {
  const l = globalThis.__pressAdsLog;
  if (Array.isArray(l)) l.push({ kind, result, at: Date.now() });
}

function overlay(doc: Document): { root: HTMLElement; close: HTMLButtonElement; bar: HTMLElement } {
  const root = doc.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', WEB_AD_LABEL);
  root.dataset.pressAd = '';
  root.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:16px;background:rgba(18,18,18,.94);color:#fff;' +
    'font:600 18px/1.3 system-ui,sans-serif;touch-action:none;user-select:none;';
  const label = doc.createElement('div');
  label.textContent = WEB_AD_LABEL;
  const track = doc.createElement('div');
  track.style.cssText =
    'width:60%;max-width:320px;height:6px;background:rgba(255,255,255,.25);border-radius:3px;overflow:hidden;';
  const bar = doc.createElement('div');
  bar.style.cssText = 'height:100%;width:0;background:#fff;';
  track.appendChild(bar);
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close ad');
  close.style.cssText =
    'position:absolute;top:calc(max(var(--safe-area-inset-top,0px),env(safe-area-inset-top,0px)) + 8px);right:8px;' +
    'width:48px;height:48px;border:0;border-radius:24px;background:rgba(255,255,255,.15);color:#fff;' +
    'font-size:28px;line-height:48px;visibility:hidden;cursor:pointer;';
  root.append(label, track, close);
  doc.body.appendChild(root);
  return { root, close, bar };
}

function animateBar(bar: HTMLElement, ms: number): void {
  bar.style.transition = `width ${ms}ms linear`;
  // Force a style flush so the transition runs from 0.
  void bar.offsetWidth;
  bar.style.width = '100%';
}

export function createWebAdDriver(opts: WebAdDriverOptions = {}): AdDriver {
  const strict = opts.strict ?? IS_DEV;
  const rewardMs = opts.rewardMs ?? 1500;
  const closeAfterMs = opts.closeButtonAfterMs ?? 1000;
  const interstitialMs = opts.interstitialMs ?? 1000;
  const doc = (): Document | null => (opts.doc === undefined ? (browser.document ?? null) : opts.doc);

  let initialized = false;
  const loaded: Record<FullscreenAdKind, boolean> = { rewarded: false, interstitial: false };
  let showing = false;

  return {
    name: 'web',
    get initialized() {
      return initialized;
    },
    async requestConsentInfo() {
      return { ...WEB_CONSENT };
    },
    async showConsentForm() {
      return { ...WEB_CONSENT };
    },
    async showPrivacyOptionsForm() {},
    async initialize() {
      initialized = true;
    },
    async loadRewarded() {
      if (!guardInitialized(initialized, strict, 'prepareRewardVideoAd')) return false;
      loaded.rewarded = true;
      return true;
    },
    async loadInterstitial() {
      if (!guardInitialized(initialized, strict, 'prepareInterstitial')) return false;
      loaded.interstitial = true;
      return true;
    },
    isLoaded(kind) {
      return initialized && loaded[kind];
    },
    async showRewarded(onReward): Promise<DriverRewardedResult> {
      if (!guardInitialized(initialized, strict, 'showRewardVideoAd')) return 'failed';
      if (!loaded.rewarded || showing) return 'failed';
      loaded.rewarded = false;
      const grant = (): void => {
        try {
          onReward();
        } catch (e) {
          console.error('[press.ads] onReward failed', e);
        }
      };
      if (globalThis.__pressAdsAutoReward === true) {
        grant();
        log('rewarded', 'rewarded');
        return 'rewarded';
      }
      const d = doc();
      if (!d?.body) return 'failed';
      showing = true;
      const result = await new Promise<DriverRewardedResult>((resolve) => {
        const ui = overlay(d);
        animateBar(ui.bar, rewardMs);
        const done = (r: DriverRewardedResult): void => {
          clearTimeout(tReward);
          clearTimeout(tClose);
          ui.root.remove();
          resolve(r);
        };
        const tClose = setTimeout(() => {
          ui.close.style.visibility = 'visible';
        }, closeAfterMs);
        const tReward = setTimeout(() => {
          grant();
          done('rewarded');
        }, rewardMs);
        ui.close.addEventListener('click', () => done('dismissed'), { once: true });
      });
      showing = false;
      log('rewarded', result);
      return result;
    },
    async showInterstitial(): Promise<DriverInterstitialResult> {
      if (!guardInitialized(initialized, strict, 'showInterstitial')) return 'failed';
      if (!loaded.interstitial || showing) return 'failed';
      loaded.interstitial = false;
      const d = doc();
      if (globalThis.__pressAdsAutoReward !== true && d?.body) {
        showing = true;
        await new Promise<void>((resolve) => {
          const ui = overlay(d);
          animateBar(ui.bar, interstitialMs);
          setTimeout(() => {
            ui.root.remove();
            resolve();
          }, interstitialMs);
        });
        showing = false;
      }
      log('interstitial', 'shown');
      return 'shown';
    },
    discard() {
      loaded.rewarded = false;
      loaded.interstitial = false;
    },
  };
}
