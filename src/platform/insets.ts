/**
 * Safe-area insets (GDD §17). Capacitor 8 SystemBars (`insetsHandling: 'css'`) injects
 * `--safe-area-inset-*` on Android; browsers/iOS expose `env(safe-area-inset-*)`. We use the max
 * of both, measured through a hidden probe whose padding is that expression — the probe's
 * border box changes whenever an inset changes, so a ResizeObserver on it catches updates.
 */
import { browser } from './env';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function insetExpression(side: Side): string {
  return `max(var(--safe-area-inset-${side}, 0px), env(safe-area-inset-${side}, 0px))`;
}

/** Sets `--sa-top/right/bottom/left` on :root for CSS layouts. */
export function applyInsetCssVars(
  root: HTMLElement | null | undefined = browser.document?.documentElement,
): void {
  if (!root?.style) return;
  for (const side of SIDES) root.style.setProperty(`--sa-${side}`, insetExpression(side));
}

const px = (v: string | undefined): number => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** One-shot measurement (zeros outside a DOM). */
export function readInsets(doc: Document | null | undefined = browser.document): Insets {
  if (!doc?.body || typeof doc.defaultView?.getComputedStyle !== 'function') return { ...ZERO_INSETS };
  const probe = createProbe(doc);
  try {
    return measure(probe);
  } finally {
    probe.remove();
  }
}

function createProbe(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.pressInsetsProbe = '';
  el.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'box-sizing:content-box;overflow:hidden;z-index:-1;' +
    SIDES.map((s) => `padding-${s}:${insetExpression(s)};`).join('');
  doc.body.appendChild(el);
  return el;
}

function measure(probe: HTMLElement): Insets {
  const cs = probe.ownerDocument.defaultView?.getComputedStyle(probe);
  return {
    top: px(cs?.paddingTop),
    right: px(cs?.paddingRight),
    bottom: px(cs?.paddingBottom),
    left: px(cs?.paddingLeft),
  };
}

const same = (a: Insets, b: Insets): boolean =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/**
 * Calls `cb` now and whenever the insets change (CSS px). Returns an unsubscribe function.
 * Outside a DOM it reports zeros once.
 */
export function watchInsets(
  cb: (insets: Insets) => void,
  doc: Document | null | undefined = browser.document,
): () => void {
  const win = doc?.defaultView;
  if (!doc?.body || !win || typeof win.getComputedStyle !== 'function') {
    cb({ ...ZERO_INSETS });
    return () => undefined;
  }
  const probe = createProbe(doc);
  let last: Insets | null = null;
  let pending = false;
  let disposed = false;
  const update = (): void => {
    pending = false;
    if (disposed) return;
    const next = measure(probe);
    if (last && same(last, next)) return;
    last = next;
    try {
      cb({ ...next });
    } catch (e) {
      console.error('[press.insets] listener failed', e);
    }
  };
  // Orientation changes settle a frame (or a few) later on Android.
  const schedule = (): void => {
    if (pending || disposed) return;
    pending = true;
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(update);
    else setTimeout(update, 16);
  };
  const late = (): void => {
    schedule();
    setTimeout(schedule, 250);
  };

  update();
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', late);
  const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const ro = RO ? new RO(schedule) : null;
  ro?.observe(probe, { box: 'border-box' });
  ro?.observe(doc.documentElement);

  return () => {
    disposed = true;
    win.removeEventListener('resize', schedule);
    win.removeEventListener('orientationchange', late);
    ro?.disconnect();
    probe.remove();
  };
}
