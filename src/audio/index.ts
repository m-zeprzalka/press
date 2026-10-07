/**
 * PRESS audio — every sound synthesised with the Web Audio API (no samples).
 *
 * Usage (game controller):
 *   const audio = createAudioEngine();
 *   addEventListener('pointerdown', () => void audio.unlock());  // until audio.ready
 *   audio.setMusic('menu'); audio.play('print', { intensity: lines / 4 });
 *
 * SFX `pitch` notes: ticks quantise to whole semitones (pass the tick index for a
 * rising Balatro-style count); `streak_up` takes the streak step (pentatonic degree).
 */

import { Engine } from './engine';
import type { AudioEngine } from './types';

export { SFX_LIST } from './types';
export type { AudioEngine, MusicMode, PlayOpts, Sfx } from './types';

export function createAudioEngine(opts?: { contextFactory?: () => AudioContext }): AudioEngine {
  return new Engine(opts?.contextFactory ? { contextFactory: opts.contextFactory } : {});
}
