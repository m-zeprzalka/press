import { describe, expect, it } from 'vitest';
import { createMemoryStore, createPlatform } from './index';

describe('createPlatform().boot()', () => {
  it('counts sessions and only starts ads from session 2 (web build)', async () => {
    const kv = createMemoryStore();
    const first = createPlatform({ kv });
    expect(await first.boot()).toEqual({ sessionIndex: 1 });
    expect(await first.boot()).toEqual({ sessionIndex: 1 }); // idempotent
    await new Promise((r) => setTimeout(r, 0));
    expect(first.lifecycle.isFirstSession).toBe(true);
    expect(first.ads.phase).toBe('off');
    expect(first.iap.supported).toBe(false);
    first.lifecycle.dispose();
    first.back.dispose();

    const second = createPlatform({ kv });
    const seen: boolean[] = [];
    second.onFullscreenChange((b) => seen.push(b));
    expect(await second.boot()).toEqual({ sessionIndex: 2 });
    await new Promise((r) => setTimeout(r, 0));
    expect(second.ads.phase).toBe('ready');
    globalThis.__pressAdsAutoReward = true;
    try {
      let rewarded = 0;
      const r = await second.ads.showRewarded('reroll', {
        beforeShow: async () => undefined,
        onReward: () => rewarded++,
      });
      expect(r).toBe('rewarded');
      expect(rewarded).toBe(1);
      expect(seen).toEqual([true, false]);
    } finally {
      globalThis.__pressAdsAutoReward = undefined;
      second.lifecycle.dispose();
      second.back.dispose();
    }
  });
});
