import { expect, test } from '@playwright/test';
import { boot, screen, tap } from './helpers';

test('small phone in Polish: title, settings and the game fit without scrolling', async ({ page }) => {
  const errors = await boot(page);
  // Finish the tutorial quickly, then visit the menus.
  await page.locator('#hud .tut-card button').click();
  await expect.poll(() => page.evaluate(() => window.__press.phase())).toBe('playing');
  const L = await page.evaluate(
    () =>
      window.__press.layout() as {
        board: { y: number; h: number };
        tray: { y: number; h: number };
        height: number;
        tooSmall: boolean;
      },
  );
  expect(L.tooSmall).toBe(false);
  expect(L.tray.y + L.tray.h).toBeLessThanOrEqual(L.height);
  expect(L.board.y + L.board.h).toBeLessThanOrEqual(L.tray.y);

  await page.evaluate(() => (window.__press as unknown as { ctl: { showTitle(): void } }).ctl.showTitle());
  await expect.poll(() => screen(page)).toBe('title');
  await expect(page.locator('#ui')).toContainText(/Ustawienia/);
  await tap(page, /^Ustawienia$/);
  await expect.poll(() => screen(page)).toBe('settings');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
