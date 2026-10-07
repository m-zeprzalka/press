/**
 * Haptics (GDD §15): @capacitor/haptics on native, `navigator.vibrate` on the web.
 * Every call is fire-and-forget — never awaited, never throws, no-op when disabled.
 */
import { Haptics as CapHaptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { browser, ignore, isNative } from './env';

export type ImpactKind = 'light' | 'medium' | 'heavy';
export type NotifyKind = 'success' | 'warning' | 'error';

export interface Haptics {
  impact(kind: ImpactKind): void;
  notify(kind: NotifyKind): void;
  /** Tick for scrubbing/selection changes; throttled to ≤ 1 per 40 ms. */
  selection(): void;
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
}

export const SELECTION_THROTTLE_MS = 40;

const IMPACT_STYLE: Record<ImpactKind, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
};
const NOTIFY_TYPE: Record<NotifyKind, NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
};

/** Short web patterns (ms); kept well below the native waveforms so they feel like taps. */
export const WEB_PATTERNS = {
  light: [10],
  medium: [18],
  heavy: [30],
  success: [15, 50, 15],
  warning: [25, 40, 25],
  error: [30, 35, 30, 35, 45],
  selection: [6],
} as const satisfies Record<ImpactKind | NotifyKind | 'selection', readonly number[]>;

export interface HapticsOptions {
  native?: boolean;
  enabled?: boolean;
  now?: () => number;
  /** Web vibrate function (defaults to navigator.vibrate). */
  vibrate?: (pattern: number[]) => unknown;
}

export function createHaptics(opts: HapticsOptions = {}): Haptics {
  const native = opts.native ?? isNative();
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  let enabled = opts.enabled ?? true;
  let lastSelection = -Infinity;
  let selectionStarted = false;

  const vibrate =
    opts.vibrate ??
    ((pattern: number[]) => {
      const nav = browser.navigator;
      if (nav && typeof nav.vibrate === 'function') nav.vibrate(pattern);
    });

  const run = (nativeCall: () => Promise<unknown>, pattern: readonly number[]): void => {
    if (!enabled) return;
    try {
      if (native) ignore(nativeCall());
      else vibrate([...pattern]);
    } catch {
      // haptics are decoration; never let them break input handling
    }
  };

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(b) {
      enabled = b;
    },
    impact(kind) {
      run(() => CapHaptics.impact({ style: IMPACT_STYLE[kind] }), WEB_PATTERNS[kind]);
    },
    notify(kind) {
      run(() => CapHaptics.notification({ type: NOTIFY_TYPE[kind] }), WEB_PATTERNS[kind]);
    },
    selection() {
      if (!enabled) return;
      const t = now();
      if (t - lastSelection < SELECTION_THROTTLE_MS) return;
      lastSelection = t;
      run(async () => {
        // Native selectionChanged() is a no-op until selectionStart() was called once.
        if (!selectionStarted) {
          selectionStarted = true;
          await CapHaptics.selectionStart();
        }
        await CapHaptics.selectionChanged();
      }, WEB_PATTERNS.selection);
    },
  };
}
