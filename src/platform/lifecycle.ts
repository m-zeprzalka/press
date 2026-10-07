/**
 * App lifecycle: foreground/background transitions and session counting.
 *
 * Sources: @capacitor/app `appStateChange` (native) + `visibilitychange` / `pagehide` (all
 * platforms); duplicates are folded so each transition fires exactly once.
 *
 * While a fullscreen ad is showing (`setAdShowing(true)`, GDD §11.4) transitions are ignored:
 * the ad activity pauses the WebView, and that must not pause the game, save, suspend audio
 * or count as background time. A resume that arrives after the ad closed is dropped too,
 * because no pause was emitted for it.
 *
 * Session (GDD §11.3): cold start, or returning after > 30 min in the background.
 * Persisted as a counter under `press.session`; index 1 is the first session ever.
 */
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Emitter } from './emitter';
import { browser, isNative } from './env';
import { STORAGE_KEYS, type KeyValueStore } from './storage';

export const SESSION_GAP_MS = 30 * 60 * 1000;

export interface ResumeInfo {
  /** Wall-clock time spent in the background (ms). */
  backgroundMs: number;
  /** The return started a new session (sessionIndex was incremented). */
  newSession: boolean;
}

export interface Lifecycle {
  /** Loads/increments the session counter and attaches listeners. Resolves the session index. */
  start(): Promise<number>;
  onPause(cb: () => void): () => void;
  onResume(cb: (info: ResumeInfo) => void): () => void;
  /** Fires after start() (cold start) and on every new session from a long background. */
  onSessionStart(cb: (sessionIndex: number) => void): () => void;
  setAdShowing(showing: boolean): void;
  readonly adShowing: boolean;
  /** App is in the foreground (as far as emitted events go). */
  readonly active: boolean;
  /** 1-based; 0 before start(). */
  readonly sessionIndex: number;
  readonly isFirstSession: boolean;
  dispose(): void;
}

type AppStateSource = { addListener: (typeof App)['addListener'] };

export interface LifecycleOptions {
  kv: KeyValueStore;
  native?: boolean;
  now?: () => number;
  app?: AppStateSource;
  /** Event targets; default to the global document/window when present. */
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

function parseSession(raw: string | null): number {
  if (!raw) return 0;
  try {
    const v = JSON.parse(raw) as { index?: unknown };
    return typeof v?.index === 'number' && Number.isFinite(v.index) && v.index >= 0 ? Math.floor(v.index) : 0;
  } catch {
    return 0;
  }
}

export function createLifecycle(opts: LifecycleOptions): Lifecycle {
  const native = opts.native ?? isNative();
  const now = opts.now ?? Date.now;
  const app = opts.app ?? App;
  const doc = opts.doc === undefined ? (browser.document ?? null) : opts.doc;
  const win =
    opts.win === undefined
      ? browser.addEventListener && browser.removeEventListener
        ? (globalThis as unknown as Window)
        : null
      : opts.win;

  const pause = new Emitter<[]>('press.lifecycle');
  const resume = new Emitter<[ResumeInfo]>('press.lifecycle');
  const sessionStart = new Emitter<[number]>('press.lifecycle');

  let started = false;
  let disposed = false;
  let adShowing = false;
  let active = true;
  let pausedAt: number | null = null;
  let sessionIndex = 0;
  const cleanups: Array<() => void> = [];

  const persist = (): void => {
    opts.kv
      .set(STORAGE_KEYS.session, JSON.stringify({ index: sessionIndex, at: now() }))
      .catch(() => undefined);
  };

  const toBackground = (): void => {
    if (disposed || adShowing || !active) return;
    active = false;
    pausedAt = now();
    pause.emit();
  };

  const toForeground = (): void => {
    if (disposed || adShowing || active) return;
    active = true;
    const backgroundMs = pausedAt === null ? 0 : Math.max(0, now() - pausedAt);
    pausedAt = null;
    const newSession = started && backgroundMs > SESSION_GAP_MS;
    if (newSession) {
      sessionIndex++;
      persist();
    }
    resume.emit({ backgroundMs, newSession });
    if (newSession) sessionStart.emit(sessionIndex);
  };

  const attach = (): void => {
    if (native) {
      const handle: Promise<PluginListenerHandle> = app.addListener('appStateChange', (s) =>
        s.isActive ? toForeground() : toBackground(),
      );
      cleanups.push(() => {
        handle.then((h) => h.remove()).catch(() => undefined);
      });
      handle.catch(() => undefined);
    }
    if (doc) {
      const onVis = (): void => (doc.visibilityState === 'hidden' ? toBackground() : toForeground());
      doc.addEventListener('visibilitychange', onVis);
      cleanups.push(() => doc.removeEventListener('visibilitychange', onVis));
    }
    if (win) {
      const onHide = (): void => toBackground();
      const onShow = (): void => {
        if (!doc || doc.visibilityState !== 'hidden') toForeground();
      };
      win.addEventListener('pagehide', onHide);
      win.addEventListener('pageshow', onShow);
      cleanups.push(() => {
        win.removeEventListener('pagehide', onHide);
        win.removeEventListener('pageshow', onShow);
      });
    }
  };

  return {
    async start() {
      if (started) return sessionIndex;
      started = true;
      let prev = 0;
      try {
        prev = parseSession(await opts.kv.get(STORAGE_KEYS.session));
      } catch {
        prev = 0;
      }
      sessionIndex = prev + 1;
      persist();
      if (!disposed) attach();
      sessionStart.emit(sessionIndex);
      return sessionIndex;
    },
    onPause: (cb) => pause.add(cb),
    onResume: (cb) => resume.add(cb),
    onSessionStart: (cb) => sessionStart.add(cb),
    setAdShowing(showing) {
      adShowing = showing;
      // If the app really went to the background while the flag was up (e.g. the ad failed
      // and the user pressed Home), catch up now so the next return is not lost.
      if (!showing && doc && doc.visibilityState === 'hidden') toBackground();
    },
    get adShowing() {
      return adShowing;
    },
    get active() {
      return active;
    },
    get sessionIndex() {
      return sessionIndex;
    },
    get isFirstSession() {
      return sessionIndex === 1;
    },
    dispose() {
      disposed = true;
      for (const c of cleanups.splice(0)) c();
      pause.clear();
      resume.clear();
      sessionStart.clear();
    },
  };
}
