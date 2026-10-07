/**
 * Back navigation (GDD §12.3). Screens/dialogs push a handler while they are on top:
 *
 *   const pop = back.push(() => { closeSheet(); });   // returns `pop`
 *
 * The newest handler gets the event. Returning `false` declines it and passes it down the
 * stack; anything else consumes it. With no handler left, `onRootBack` runs: on native the app
 * is minimized (never `exitApp`, which Play policy and resume-from-recents both dislike); on
 * the web it does nothing. During a fullscreen ad back is ignored (the ad handles it).
 *
 * Wired to @capacitor/app `backButton` (registering it disables Capacitor's default
 * history/exit behaviour) and, on the web, to the Escape key.
 */
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { browser, ignore, isNative } from './env';

export type BackHandler = () => boolean | void;

export interface BackRouter {
  push(handler: BackHandler): () => void;
  /** Runs the back action (also used by the Escape key and tests). Returns whether it was handled. */
  handleBack(): boolean;
  setAdShowing(showing: boolean): void;
  readonly adShowing: boolean;
  readonly depth: number;
  /** Called when the stack is empty or every handler declined. */
  onRootBack: () => void;
  start(): Promise<void>;
  dispose(): void;
}

type BackSource = { addListener: (typeof App)['addListener']; minimizeApp: (typeof App)['minimizeApp'] };

export interface BackRouterOptions {
  native?: boolean;
  app?: BackSource;
  /** Key event target for Escape (web only). Defaults to the window. */
  keyTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

export function createBackRouter(opts: BackRouterOptions = {}): BackRouter {
  const native = opts.native ?? isNative();
  const app = opts.app ?? App;
  const keyTarget =
    opts.keyTarget === undefined
      ? browser.addEventListener && browser.removeEventListener
        ? (globalThis as unknown as Window)
        : null
      : opts.keyTarget;

  const stack: Array<{ handler: BackHandler }> = [];
  const cleanups: Array<() => void> = [];
  let adShowing = false;
  let started = false;

  const router: BackRouter = {
    onRootBack: native ? () => ignore(app.minimizeApp()) : () => undefined,
    push(handler) {
      const entry = { handler };
      stack.push(entry);
      return () => {
        const i = stack.lastIndexOf(entry);
        if (i >= 0) stack.splice(i, 1);
      };
    },
    handleBack() {
      if (adShowing) return false;
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack[i];
        if (!entry) continue;
        let result: boolean | void;
        try {
          result = entry.handler();
        } catch (e) {
          console.error('[press.back] handler failed', e);
          return true;
        }
        if (result !== false) return true;
      }
      try {
        router.onRootBack();
      } catch (e) {
        console.error('[press.back] root handler failed', e);
      }
      return false;
    },
    setAdShowing(showing) {
      adShowing = showing;
    },
    get adShowing() {
      return adShowing;
    },
    get depth() {
      return stack.length;
    },
    async start() {
      if (started) return;
      started = true;
      if (native) {
        try {
          const handle: PluginListenerHandle = await app.addListener('backButton', () => {
            router.handleBack();
          });
          cleanups.push(() => ignore(handle.remove()));
        } catch (e) {
          console.warn('[press.back] backButton listener unavailable', e);
        }
      } else if (keyTarget) {
        const onKey = (ev: Event): void => {
          const k = ev as KeyboardEvent;
          if (k.key !== 'Escape' || k.repeat || k.defaultPrevented) return;
          k.preventDefault();
          router.handleBack();
        };
        keyTarget.addEventListener('keydown', onKey);
        cleanups.push(() => keyTarget.removeEventListener('keydown', onKey));
      }
    },
    dispose() {
      for (const c of cleanups.splice(0)) c();
      stack.length = 0;
      started = false;
    },
  };
  return router;
}
