// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStore, createSaveStore } from '../storage';
import { createAdsService } from './index';
import { AdsOrderError } from './types';
import { createWebAdDriver, WEB_AD_LABEL } from './web';

const overlay = (): HTMLElement | null => document.querySelector('[data-press-ad]');

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.__pressAdsAutoReward = undefined;
  globalThis.__pressAdsLog = [];
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  globalThis.__pressAdsLog = undefined;
});

async function ready() {
  const d = createWebAdDriver({ strict: true });
  await d.initialize();
  await d.loadRewarded();
  await d.loadInterstitial();
  return d;
}

describe('web ad simulation', () => {
  it('rewarded: overlay for 1.5 s, then the reward', async () => {
    const d = await ready();
    const onReward = vi.fn();
    const p = d.showRewarded(onReward);
    expect(overlay()?.textContent).toContain(WEB_AD_LABEL);
    const close = overlay()?.querySelector('button') as HTMLButtonElement;
    expect(close.style.visibility).toBe('hidden');
    await vi.advanceTimersByTimeAsync(1000);
    expect(close.style.visibility).toBe('visible');
    expect(onReward).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe('rewarded');
    expect(onReward).toHaveBeenCalledTimes(1);
    expect(overlay()).toBeNull();
    expect(globalThis.__pressAdsLog?.map((e) => `${e.kind}:${e.result}`)).toEqual(['rewarded:rewarded']);
  });

  it('rewarded: closing early with × → dismissed, no reward', async () => {
    const d = await ready();
    const onReward = vi.fn();
    const p = d.showRewarded(onReward);
    await vi.advanceTimersByTimeAsync(1200);
    (overlay()?.querySelector('button') as HTMLButtonElement).click();
    expect(await p).toBe('dismissed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onReward).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  it('interstitial: overlay for 1 s, then it closes by itself', async () => {
    const d = await ready();
    const p = d.showInterstitial();
    expect(overlay()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe('shown');
    expect(overlay()).toBeNull();
  });

  it('e2e hook: __pressAdsAutoReward grants instantly without any overlay', async () => {
    globalThis.__pressAdsAutoReward = true;
    const d = await ready();
    const onReward = vi.fn();
    expect(await d.showRewarded(onReward)).toBe('rewarded');
    expect(onReward).toHaveBeenCalledTimes(1);
    expect(await d.showInterstitial()).toBe('shown');
    expect(overlay()).toBeNull();
  });

  it('the same ordering guard applies', async () => {
    const strict = createWebAdDriver({ strict: true });
    await expect(strict.loadRewarded()).rejects.toBeInstanceOf(AdsOrderError);
    await expect(strict.showRewarded(() => undefined)).rejects.toBeInstanceOf(AdsOrderError);
    const prod = createWebAdDriver({ strict: false });
    expect(await prod.loadInterstitial()).toBe(false);
    expect(await prod.showInterstitial()).toBe('failed');
    const d = await ready();
    d.discard();
    expect(d.isLoaded('rewarded')).toBe(false);
    expect(await d.showRewarded(() => undefined)).toBe('failed');
  });

  it('end to end through AdsService (session ≥ 2), still nothing in session 1', async () => {
    const store = createSaveStore(createMemoryStore());
    const first = createAdsService({ store, driver: createWebAdDriver(), strict: false });
    await first.start({ sessionIndex: 1, noAds: false });
    expect(first.available('rewarded')).toBe(false);

    const ads = createAdsService({ store, driver: createWebAdDriver(), strict: true });
    await ads.start({ sessionIndex: 2, noAds: false });
    expect(ads.phase).toBe('ready');
    const onReward = vi.fn();
    const p = ads.showRewarded('reroll', { beforeShow: async () => undefined, onReward });
    await vi.advanceTimersByTimeAsync(1600);
    expect(await p).toBe('rewarded');
    expect(onReward).toHaveBeenCalledTimes(1);
  });
});
