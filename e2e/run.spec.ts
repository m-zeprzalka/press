import { expect, test } from '@playwright/test';
import { bestMove, boot, phase, playToResults, screen, startRun, tap } from './helpers';

test('a full run plays through jobs and offers to the results screen', async ({ page }) => {
  const errors = await boot(page);
  await startRun(page);
  await page.evaluate(() => window.__press.skipAnimations(true));
  const stats = await playToResults(page, 200_000);
  expect(stats.placements).toBeGreaterThan(5);

  // Results screen.
  const results = page.locator('#ui [data-layer="results"]');
  await expect(results).toBeVisible();
  await expect(results).toContainText(/Jobs delivered/);
  await expect(results).toContainText(/Total printed/);
  await expect(results.locator('button', { hasText: 'New run' })).toBeVisible();
  await expect(results.locator('button', { hasText: 'Share' })).toBeVisible();
  const totals = await page.evaluate(() => window.__press.state()?.totals);
  expect(totals?.score ?? 0).toBeGreaterThan(0);

  // First session: leaving the results never shows an interstitial (GDD §11.2).
  await tap(page, /^Menu$/);
  await expect.poll(() => screen(page)).toBe('title');
  await expect(page.locator('[data-press-ad]')).toHaveCount(0);

  // Stats remember the run.
  await tap(page, /^Stats$/);
  await expect(page.locator('#ui [data-layer="stats"]')).toContainText(/Runs\s*1/);
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: 'run', description: JSON.stringify(stats) });
});

test('an interrupted run resumes after a reload', async ({ page }) => {
  const errors = await boot(page);
  await startRun(page);
  await page.evaluate(() => window.__press.skipAnimations(true));
  for (let i = 0; i < 4; i++) {
    const mv = await bestMove(page);
    if (!mv) break;
    await page.evaluate(([s, x, y]) => window.__press.place(s as number, x as number, y as number), [
      mv.slot,
      mv.x,
      mv.y,
    ] as const);
    await expect.poll(() => page.evaluate(() => window.__press.ctl.canInteract())).toBe(true);
  }
  const before = await page.evaluate(() => JSON.stringify(window.__press.state()));

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__press?.layout()));
  await expect.poll(() => screen(page)).toBe('title');
  await tap(page, /^Resume run$/);
  await expect.poll(() => phase(page)).toBe('playing');
  const after = await page.evaluate(() => JSON.stringify(window.__press.state()));
  expect(JSON.parse(after)).toEqual(JSON.parse(before));
  expect(errors).toEqual([]);
});

test('back during play opens Pause instead of leaving; back again resumes', async ({ page }) => {
  const errors = await boot(page);
  await startRun(page);
  await page.keyboard.press('Escape'); // web stand-in for the Android back button
  await expect.poll(() => screen(page)).toBe('pause');
  await page.keyboard.press('Escape');
  await expect.poll(() => screen(page)).toBe(null);
  expect(await phase(page)).toBe('playing');
  expect(errors).toEqual([]);
});
