/**
 * Frame-cost measurement for docs/performance.md.
 *
 *   npm run build && npx vite preview --port 4173 &   then   node scripts/perf.mjs [--throttle 1,4,6]
 *
 * Headless Chromium + SwiftShader rasterises on the CPU, so absolute FPS here is not a phone's.
 * What this measures is the main-thread cost of our frame callback (update + Pixi command
 * submission) under CDP CPU throttling, which is what decides jank on a mid-range Android.
 * Scenario: 4-line cross prints (28 cells, particles, stains, counters) with a full plate rack,
 * plus a 2 s piece drag, each repeated; long tasks are counted with PerformanceObserver.
 */
import { chromium, devices } from '@playwright/test';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL = arg('url', 'http://localhost:4173');
const THROTTLES = arg('throttle', '1,4,6').split(',').map(Number);
const PRINTS = Number(arg('prints', '8'));
const TIER = arg('tier', 'mid');

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

async function measure(throttle) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'en-US' });
  const page = await ctx.newPage();
  // Force the device tier so particle caps match the tier being reported.
  await page.addInitScript((tier) => {
    const map = { low: [4, 3], mid: [6, 4], high: [8, 8] };
    const [cores, mem] = map[tier];
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => mem });
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({
      type: 'longtask',
      buffered: true,
    });
  }, TIER);
  await page.goto(`${URL}/?e2e=1&seed=perf`);
  await page.waitForFunction(() => Boolean(window.__press?.layout()));
  await page.locator('#hud .tut-card button').click();
  await page.waitForFunction(() => window.__press.phase() === 'playing');
  await page.waitForTimeout(1500);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

  // rAF interval sampler (frame-to-frame), active only while measuring.
  await page.evaluate(() => {
    window.__deltas = [];
    window.__sampling = false;
    let last = 0;
    const loop = (t) => {
      if (window.__sampling && last) window.__deltas.push(t - last);
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const heavyPrint = () =>
    page.evaluate(() => {
      const p = window.__press;
      const s = p.state();
      const cells = new Array(64).fill(-1);
      const idx = (x, y) => y * 8 + x;
      for (let x = 0; x < 6; x++) for (const y of [6, 7]) cells[idx(x, y)] = (x + y) % 5;
      for (let y = 0; y < 6; y++) for (const x of [6, 7]) cells[idx(x, y)] = (x * 3 + y) % 5;
      s.cells = cells;
      s.tray = [{ uid: 990000 + Math.floor(Math.random() * 9999), shape: 'o4', ink: 0 }, null, null];
      s.plates = ['ink_pink', 'numerator', 'proof', 'monotype', 'gutenberg'].map((id, i) => ({
        uid: 980000 + i,
        id,
        state: {},
      }));
      s.contract.streak = 12;
      s.contract.progress = 0;
      s.contract.spec.quota = 1e12;
      s.contract.sheetsLeft = 20;
      p.loadState(s);
      return true;
    });

  const results = {};
  // 1. Heavy prints with full presentation (counters, FX, particles).
  await page.evaluate(() => {
    window.__press.resetFrameStats();
    window.__long.length = 0;
    window.__deltas.length = 0;
    window.__sampling = true;
  });
  for (let i = 0; i < PRINTS; i++) {
    await heavyPrint();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__press.place(0, 6, 6));
    await page.waitForFunction(() => window.__press.ctl.canInteract(), null, { timeout: 30000 });
    await page.waitForTimeout(400);
  }
  results.print = await page.evaluate(() => {
    window.__sampling = false;
    return {
      frames: window.__press.frameStats(),
      deltas: window.__deltas.slice(),
      long: window.__long.slice(),
    };
  });

  // 2. Drag: lift a piece and move it around the board for ~2 s.
  await heavyPrint();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__press.resetFrameStats();
    window.__long.length = 0;
    window.__deltas.length = 0;
    window.__sampling = true;
  });
  const box = await page.locator('#stage canvas').boundingBox();
  const pts = await page.evaluate(() => window.__press.dragPoints(0, 2, 2));
  await page.mouse.move(box.x + pts.from.x, box.y + pts.from.y);
  await page.mouse.down();
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    await page.mouse.move(
      box.x + pts.to.x + Math.sin(t * Math.PI * 4) * 120,
      box.y + pts.to.y + Math.cos(t * Math.PI * 3) * 140,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.move(box.x + pts.from.x, box.y + pts.from.y);
  await page.mouse.up();
  await page.waitForTimeout(400);
  results.drag = await page.evaluate(() => {
    window.__sampling = false;
    return {
      frames: window.__press.frameStats(),
      deltas: window.__deltas.slice(),
      long: window.__long.slice(),
    };
  });
  results.heapMB = await page.evaluate(() =>
    performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
  );
  results.tier = TIER;
  await browser.close();
  return results;
}

const fmt = (n) => (n == null ? '—' : n.toFixed(1));
const rows = [];
for (const t of THROTTLES) {
  const r = await measure(t);
  for (const k of ['print', 'drag']) {
    const d = r[k];
    rows.push({
      throttle: `${t}×`,
      scenario: k,
      frames: d.frames.n,
      costAvg: d.frames.avg,
      costP95: d.frames.p95,
      rafP50: pct(d.deltas, 0.5),
      rafP95: pct(d.deltas, 0.95),
      longTasks: d.long.length,
      longMax: d.long.length ? Math.max(...d.long) : 0,
      heap: r.heapMB,
    });
  }
}
console.info(`tier=${TIER} prints=${PRINTS}`);
console.info(
  '| CPU | scenariusz | klatki | koszt klatki śr. (ms) | koszt p95 (ms) | odstęp rAF p50 (ms) | odstęp rAF p95 (ms) | long tasks (maks. ms) | sterta JS (MB) |',
);
console.info('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  console.info(
    `| ${r.throttle} | ${r.scenario} | ${r.frames} | ${fmt(r.costAvg)} | ${fmt(r.costP95)} | ${fmt(r.rafP50)} | ${fmt(r.rafP95)} | ${r.longTasks} (${fmt(r.longMax)}) | ${fmt(r.heap)} |`,
  );
}
void mean;
