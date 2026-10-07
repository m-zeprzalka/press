/**
 * PWA service worker (vite-plugin-pwa, `registerType: 'autoUpdate'`, `injectRegister: null`).
 * Registered only for production web builds — never inside Capacitor, where the APK already
 * ships every asset and a service worker would only serve stale files after an update.
 */
import { browser, isNative } from './env';

export interface RegisterServiceWorkerOptions {
  /** Called when the app is cached for offline use. */
  onOfflineReady?: () => void;
}

/** Resolves true when registration was started. */
export async function registerServiceWorker(opts: RegisterServiceWorkerOptions = {}): Promise<boolean> {
  if (isNative()) return false;
  if (!import.meta.env.PROD) return false;
  const nav = browser.navigator;
  if (!nav || !('serviceWorker' in nav)) return false;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({
      immediate: true,
      onOfflineReady: opts.onOfflineReady,
      onRegisterError: (e: unknown) => console.warn('[press.pwa] service worker registration failed', e),
    });
    return true;
  } catch (e) {
    console.warn('[press.pwa] service worker unavailable', e);
    return false;
  }
}
