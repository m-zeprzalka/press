import { expect, type Page } from '@playwright/test';

type Slot = number | 'reserve';
interface Pt {
  x: number;
  y: number;
}
interface PressApi {
  phase(): string | null;
  screen(): string | null;
  tutorialStep(): number | null;
  layout(): unknown;
  validPositions(slot: Slot): Array<[number, number]>;
  previewLines(slot: Slot, x: number, y: number): { rows: number[]; cols: number[] } | null;
  dragPoints(slot: Slot, x: number, y: number): { from: Pt; to: Pt } | null;
  skipAnimations(on: boolean): void;
  place(slot: Slot, x: number, y: number): void;
  state(): {
    plates: unknown[];
    totals: { score: number; contractsWon: number };
    contractIndex: number;
  } | null;
  ctl: { canInteract(): boolean };
}
declare global {
  interface Window {
    __press: PressApi;
  }
}

/**
 * Opens the game with the debug API exposed and waits until the scene has a layout.
 * Returns the list of uncaught page errors (assert it is empty at the end of a test).
 */
export async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?e2e=1${query}`);
  await page.waitForFunction(() => Boolean(window.__press?.layout()));
  return errors;
}

export const screen = (page: Page) => page.evaluate(() => window.__press.screen());
export const phase = (page: Page) => page.evaluate(() => window.__press.phase());

/** A real pointer drag on the canvas: tray slot → board cell (x, y). */
export async function drag(page: Page, slot: Slot, x: number, y: number): Promise<void> {
  const pts = await page.evaluate(
    ([s, cx, cy]) => window.__press.dragPoints(s as Slot, cx as number, cy as number),
    [slot, x, y] as const,
  );
  expect(pts, `drag points for ${String(slot)} → (${x},${y})`).not.toBeNull();
  const box = await page.locator('#stage canvas').boundingBox();
  if (!pts || !box) throw new Error('no canvas');
  await page.mouse.move(box.x + pts.from.x, box.y + pts.from.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      box.x + pts.from.x + ((pts.to.x - pts.from.x) * i) / steps,
      box.y + pts.from.y + ((pts.to.y - pts.from.y) * i) / steps,
    );
  }
  await page.mouse.up();
}

/** Greedy move: most lines printed, then lowest on the board. Null when nothing fits. */
export function bestMove(page: Page): Promise<{ slot: Slot; x: number; y: number } | null> {
  return page.evaluate(() => {
    const p = window.__press;
    let best: { slot: Slot; x: number; y: number; score: number } | null = null;
    for (const slot of [0, 1, 2, 'reserve'] as Slot[]) {
      for (const [x, y] of p.validPositions(slot)) {
        const l = p.previewLines(slot, x, y);
        const score = (l ? l.rows.length + l.cols.length : 0) * 100 + y * 2 + Math.abs(3.5 - x) * 0.1;
        if (!best || score > best.score) best = { slot, x, y, score };
      }
    }
    return best ? { slot: best.slot, x: best.x, y: best.y } : null;
  });
}

/** Clicks a button by its visible text, retrying through accidental-tap arm delays. */
export async function tap(page: Page, text: string | RegExp, scope = '#ui'): Promise<void> {
  const btn = page.locator(`${scope} button`, { hasText: text }).first();
  await expect(btn).toBeVisible();
  await page.waitForTimeout(650); // ad / decline buttons ignore taps for 600 ms
  await btn.click();
}

/** Skips the tutorial through its own button and waits for the first real job. */
export async function startRun(page: Page): Promise<void> {
  await page.locator('#hud .tut-card button').click();
  await expect.poll(() => phase(page)).toBe('playing');
}

/**
 * Plays until the results screen: greedy placements, first plate of every offer, ends the job
 * at a last chance, takes the free reprint once, finishes on victory.
 */
export async function playToResults(
  page: Page,
  budgetMs: number,
): Promise<{ placements: number; offers: number; reprints: number }> {
  const stats = { placements: 0, offers: 0, reprints: 0 };
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const scr = await screen(page);
    if (scr === 'results') return stats;
    if (scr === 'confirm') {
      await tap(page, /^Yes$/);
      continue;
    }
    if (scr === 'offer') {
      stats.offers++;
      const plates = (await page.evaluate(() => window.__press.state()?.plates.length)) ?? 0;
      const card = page.locator('#ui .plate-card').first();
      if (plates < 5 && (await card.count()) > 0) {
        await card.click(); // selects the card…
        await tap(page, /^Take$/); // …and confirms
      } else await page.getByRole('button', { name: /^Skip · / }).click();
      await expect.poll(() => screen(page)).not.toBe('offer');
      continue;
    }
    if (scr === 'plate') {
      await tap(page, /^Close$/);
      continue;
    }
    if (scr === 'last') {
      await tap(page, /^End job$/);
      continue;
    }
    if (scr === 'reprint') {
      stats.reprints++;
      await page.waitForTimeout(650);
      await page.getByRole('button', { name: 'Reprint on the house' }).click();
      continue;
    }
    if (scr === 'victory') {
      await tap(page, /^Finish run$/);
      continue;
    }
    if ((await phase(page)) === 'playing' && (await page.evaluate(() => window.__press.ctl.canInteract()))) {
      const mv = await bestMove(page);
      if (mv) {
        // A few real pointer drags, the rest through the same controller entry point.
        if (stats.placements < 3) await drag(page, mv.slot, mv.x, mv.y);
        else
          await page.evaluate(([s, x, y]) => window.__press.place(s as number, x as number, y as number), [
            mv.slot,
            mv.x,
            mv.y,
          ] as const);
        stats.placements++;
        continue;
      }
    }
    await page.waitForTimeout(60);
  }
  throw new Error(`run did not finish in ${budgetMs} ms (${JSON.stringify(stats)})`);
}
