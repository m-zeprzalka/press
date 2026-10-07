/** Public types of the PRESS audio engine (re-exported from ./index). */

export type Sfx =
  | 'pickup'
  | 'drop_invalid'
  | 'snap'
  | 'place'
  | 'print'
  | 'print_big'
  | 'streak_up'
  | 'streak_break'
  | 'tick_prints'
  | 'tick_mult'
  | 'xmult'
  | 'quota_done'
  | 'jam'
  | 'lose'
  | 'ui_click'
  | 'ui_back'
  | 'card_flip'
  | 'card_take'
  | 'sell'
  | 'reroll'
  | 'stamp'
  | 'unlock'
  | 'paper';

/** Every SFX id, in a stable order (used by the preview page and tests). */
export const SFX_LIST: readonly Sfx[] = [
  'pickup',
  'drop_invalid',
  'snap',
  'place',
  'print',
  'print_big',
  'streak_up',
  'streak_break',
  'tick_prints',
  'tick_mult',
  'xmult',
  'quota_done',
  'jam',
  'lose',
  'ui_click',
  'ui_back',
  'card_flip',
  'card_take',
  'sell',
  'reroll',
  'stamp',
  'unlock',
  'paper',
];

export interface PlayOpts {
  /**
   * Semitone offset. Ticks (`tick_prints`, `tick_mult`) quantise it to whole semitones.
   * `streak_up` reads it as a step on the D minor pentatonic (pass the streak count: 0, 1, 2…).
   */
  pitch?: number;
  /** 0..1 — loudness/weight (`print` picks a heavier slam as it grows). Default 0.7. */
  intensity?: number;
  /** stereo -1..1 */
  pan?: number;
}

export type MusicMode = 'menu' | 'game' | 'off';

export interface AudioEngine {
  /** Call on every pointerdown/keydown until running (autoplay policies). Idempotent. */
  unlock(): Promise<void>;
  readonly ready: boolean;
  play(sfx: Sfx, opts?: PlayOpts): void;
  /** 'menu' | 'game' | 'off'; crossfades. */
  setMusic(mode: 'menu' | 'game' | 'off'): void;
  /** 0..1 musical intensity, driven by SERIA (streak) during play. */
  setIntensity(v: number): void;
  setMusicVolume(v: number): void; // 0..1 (persisted by caller)
  setSfxVolume(v: number): void; // 0..1
  /** App backgrounded / ad showing → silence within 100 ms; resume restores. */
  suspend(): Promise<void>;
  resume(): Promise<void>;
  dispose(): void;
}
