/**
 * Player settings (persisted under `press.settings`).
 */
export type CounterSpeed = 'normal' | 'fast' | 'instant';
export type ControlMode = 'drag' | 'tap';
export type LangSetting = 'auto' | 'en' | 'pl';

export interface Settings {
  v: 1;
  lang: LangSetting;
  music: number;
  sfx: number;
  haptics: boolean;
  symbols: boolean;
  /** null = follow the OS "reduce motion" preference. */
  reduceMotion: boolean | null;
  counterSpeed: CounterSpeed;
  controls: ControlMode;
  fullscreen: boolean;
  tips: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  lang: 'auto',
  music: 0.6,
  sfx: 0.8,
  haptics: true,
  symbols: false,
  reduceMotion: null,
  counterSpeed: 'normal',
  controls: 'drag',
  fullscreen: true,
  tips: true,
};

const clamp01 = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const d = DEFAULT_SETTINGS;
  return {
    v: 1,
    lang: r.lang === 'en' || r.lang === 'pl' || r.lang === 'auto' ? r.lang : d.lang,
    music: clamp01(r.music, d.music),
    sfx: clamp01(r.sfx, d.sfx),
    haptics: typeof r.haptics === 'boolean' ? r.haptics : d.haptics,
    symbols: typeof r.symbols === 'boolean' ? r.symbols : d.symbols,
    reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : null,
    counterSpeed:
      r.counterSpeed === 'fast' || r.counterSpeed === 'instant' || r.counterSpeed === 'normal'
        ? r.counterSpeed
        : d.counterSpeed,
    controls: r.controls === 'tap' ? 'tap' : 'drag',
    fullscreen: typeof r.fullscreen === 'boolean' ? r.fullscreen : d.fullscreen,
    tips: typeof r.tips === 'boolean' ? r.tips : d.tips,
  };
}

export function systemReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function effectiveReduceMotion(s: Settings): boolean {
  return s.reduceMotion ?? systemReducedMotion();
}
