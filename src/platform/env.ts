/**
 * Runtime environment probes. Everything in src/platform branches on these instead of
 * touching `Capacitor` directly, so tests can mock a single module.
 */
import { Capacitor } from '@capacitor/core';

export type PlatformName = 'android' | 'ios' | 'web';

/** True inside the Capacitor shell (APK), false in the browser / PWA. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function platformName(): PlatformName {
  try {
    const p = Capacitor.getPlatform();
    return p === 'android' || p === 'ios' ? p : 'web';
  } catch {
    return 'web';
  }
}

/**
 * Dev builds (vite dev server, vitest) — enables strict guards that throw on misuse
 * (e.g. an ad prepare/show before AdMob.initialize). Production builds degrade silently.
 */
export const IS_DEV: boolean = Boolean(import.meta.env?.DEV);

/** Swallows a promise rejection (fire-and-forget plugin calls). */
export function ignore(p: unknown): void {
  if (p && typeof (p as Promise<unknown>).catch === 'function')
    (p as Promise<unknown>).catch(() => undefined);
}

/**
 * Optional browser globals. Typed as possibly-undefined so platform code stays safe in
 * node (vitest), workers and odd WebViews. Note: reading `localStorage` can itself throw.
 */
export interface BrowserGlobals {
  document?: Document;
  navigator?: Navigator;
  localStorage?: Storage;
  addEventListener?: Window['addEventListener'];
  removeEventListener?: Window['removeEventListener'];
  getComputedStyle?: Window['getComputedStyle'];
  ResizeObserver?: typeof ResizeObserver;
  history?: History;
}

export const browser = globalThis as unknown as BrowserGlobals;
