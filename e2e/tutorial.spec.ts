import { expect, test } from '@playwright/test';
import { boot, drag, phase } from './helpers';

test.describe('first launch', () => {
  test('the 3-step tutorial teaches by playing and hands over to a real run', async ({ page }) => {
    const errors = await boot(page);

    // Step 1: one piece completes a row (only the shown placement is accepted).
    await expect.poll(() => page.evaluate(() => window.__press.tutorialStep())).toBe(1);
    await expect(page.locator('#hud .tut-card')).toBeVisible();
    await drag(page, 1, 5, 7);
    await expect(page.locator('#hud .tut-card')).toContainText(/print/i);

    // Step 2: an L piece prints a row and a column at once.
    await expect.poll(() => page.evaluate(() => window.__press.tutorialStep()), { timeout: 8_000 }).toBe(2);
    await drag(page, 0, 6, 6);

    // Step 3: the first real job of a run.
    await expect.poll(() => page.evaluate(() => window.__press.tutorialStep()), { timeout: 8_000 }).toBe(3);
    await expect.poll(() => phase(page)).toBe('playing');
    const run = await page.evaluate(() => window.__press.state());
    expect(run?.contractIndex).toBe(0);
    expect(run?.totals.score).toBe(0); // sandbox prints never count
    await expect(page.locator('#hud .tut-card')).toContainText(/quota/i);
    expect(errors).toEqual([]);
  });

  test('a wrong placement in the tutorial is rejected', async ({ page }) => {
    const errors = await boot(page);
    await expect.poll(() => page.evaluate(() => window.__press.tutorialStep())).toBe(1);
    await drag(page, 1, 0, 0); // not the target cell
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__press.validPositions(1).length)).toBeGreaterThan(0); // piece still in the tray
    expect(await page.evaluate(() => window.__press.tutorialStep())).toBe(1);
    expect(errors).toEqual([]);
  });

  test('players who know the genre can skip straight to the run', async ({ page }) => {
    const errors = await boot(page);
    await page.locator('#hud .tut-card button').click();
    await expect.poll(() => page.evaluate(() => window.__press.tutorialStep())).toBe(3);
    await expect.poll(() => phase(page)).toBe('playing');
    expect(errors).toEqual([]);
  });
});
