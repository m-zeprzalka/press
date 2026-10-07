import { expect, test } from '@playwright/test';
import { boot, playToResults, screen, startRun, tap } from './helpers';

declare global {
  interface Window {
    __pressAdsLog?: Array<{ kind: string; result: string }>;
    __pressAdsAutoReward?: boolean;
  }
}

/** Second session, one earlier lost run: the interstitial rules can now be satisfied (GDD §11.2). */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('press.session', JSON.stringify({ index: 1 }));
      localStorage.setItem(
        'press.ads',
        JSON.stringify({
          completedRuns: 1,
          lostRuns: 1,
          runsSinceInterstitial: 2,
          lastFullscreenAt: null,
          interstitialsShown: 0,
        }),
      );
    }
    window.__pressAdsLog = [];
    window.__pressAdsAutoReward = true;
  });
});

test('after the 2nd lost run, leaving the results shows one interstitial', async ({ page }) => {
  const errors = await boot(page);
  await startRun(page);
  await page.evaluate(() => window.__press.skipAnimations(true));
  await playToResults(page, 200_000);
  // Never during play.
  expect(
    await page.evaluate(() => window.__pressAdsLog?.filter((a) => a.kind === 'interstitial').length),
  ).toBe(0);
  await page.waitForTimeout(2100); // results must be visible ≥ 2 s
  await tap(page, /^Menu$/);
  await expect.poll(() => screen(page)).toBe('title');
  expect(
    await page.evaluate(() => window.__pressAdsLog?.filter((a) => a.kind === 'interstitial').length),
  ).toBe(1);
  expect(errors).toEqual([]);
});

test('an ad reroll is offered after the free one and grants a fresh offer', async ({ page }) => {
  const errors = await boot(page);
  await startRun(page);
  await page.evaluate(() => window.__press.skipAnimations(true));
  // Win the first job quickly by lowering its quota in place (test-only shortcut).
  await page.evaluate(() => {
    const ctl = (
      window.__press as unknown as { ctl: { engine: { state: { contract: { spec: { quota: number } } } } } }
    ).ctl;
    ctl.engine.state.contract.spec.quota = 1;
  });
  for (let i = 0; i < 40 && (await screen(page)) !== 'offer'; i++) {
    const mv = await page.evaluate(() => {
      const p = window.__press;
      for (const s of [0, 1, 2]) {
        const v = p.validPositions(s);
        if (v.length) return { s, x: v[0]![0], y: v[0]![1] };
      }
      return null;
    });
    if (mv) await page.evaluate(([s, x, y]) => window.__press.place(s, x, y), [mv.s, mv.x, mv.y] as const);
    await page.waitForTimeout(80);
  }
  await expect.poll(() => screen(page)).toBe('offer');
  const names = () => page.locator('#ui .plate-card').allInnerTexts();
  const first = await names();
  await tap(page, /Reroll · free/i);
  await expect.poll(names).not.toEqual(first);
  const second = await names();
  const adReroll = page.locator('#ui button', { hasText: 'Reroll' }).filter({ hasNotText: /free/i });
  await expect(adReroll).toBeVisible();
  await page.waitForTimeout(650);
  await adReroll.click();
  await expect.poll(names).not.toEqual(second);
  expect(await page.evaluate(() => window.__pressAdsLog?.map((a) => `${a.kind}:${a.result}`))).toEqual([
    'rewarded:rewarded',
  ]);
  expect(errors).toEqual([]);
});
