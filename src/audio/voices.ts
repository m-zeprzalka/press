/**
 * SFX polyphony management: hard voice limit with oldest-voice stealing, and a
 * rate limiter for the Balatro-style counter ticks. Slot records are preallocated,
 * so the hot path only allocates the Web Audio nodes of the new voice itself.
 */

import { clamp, rampTo } from './util';

/** Anything that can register the source nodes of the voice being built. */
export interface Sink {
  track(src: AudioScheduledSourceNode): void;
}

export const NO_SINK: Sink = {
  track() {
    /* offline rendering: nothing to steal */
  },
};

interface Slot {
  active: boolean;
  start: number;
  end: number;
  gain: GainNode | null;
  /** Node connected to the SFX bus (the voice gain, or its panner). */
  out: AudioNode | null;
  sources: (AudioScheduledSourceNode | null)[];
  n: number;
}

/** Fade applied to a stolen voice before its sources stop. */
export const STEAL_FADE = 0.012;

export class VoicePool implements Sink {
  /** Diagnostics: number of voices stolen so far. */
  stolen = 0;
  private readonly slots: Slot[] = [];
  private cur: Slot | null = null;

  constructor(
    readonly limit = 16,
    private readonly maxSources = 24,
  ) {
    for (let i = 0; i < limit; i++) {
      this.slots.push({
        active: false,
        start: 0,
        end: 0,
        gain: null,
        out: null,
        sources: new Array(maxSources).fill(null),
        n: 0,
      });
    }
  }

  /** Voices still sounding at `now` (finished ones are released first). */
  activeCount(now: number): number {
    this.prune(now);
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]!.active) n++;
    return n;
  }

  /**
   * Open a voice. If all slots are busy, the oldest voice is faded out over
   * STEAL_FADE and its sources stopped. Follow with track()… and commit(end).
   */
  begin(now: number, gain: GainNode, out: AudioNode): void {
    this.prune(now);
    let slot: Slot | null = null;
    let oldest: Slot | null = null;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (!s.active) {
        slot = s;
        break;
      }
      if (!oldest || s.start < oldest.start) oldest = s;
    }
    if (!slot && oldest) {
      this.release(oldest, now, STEAL_FADE);
      this.stolen++;
      slot = oldest;
    }
    if (!slot) return;
    slot.active = true;
    slot.start = now;
    slot.end = Number.POSITIVE_INFINITY;
    slot.gain = gain;
    slot.out = out;
    slot.n = 0;
    this.cur = slot;
  }

  track(src: AudioScheduledSourceNode): void {
    const s = this.cur;
    if (s && s.n < this.maxSources) s.sources[s.n++] = src;
  }

  /** Close the voice opened by begin(); `end` is when it is guaranteed silent. */
  commit(end: number): void {
    if (this.cur) this.cur.end = end;
    this.cur = null;
  }

  /** Fade out and stop every voice (suspend/dispose). */
  stopAll(now: number): void {
    for (const s of this.slots) if (s.active) this.release(s, now, 0.005);
  }

  private release(s: Slot, now: number, fade: number): void {
    if (s.gain) {
      try {
        rampTo(s.gain.gain, 0, now, fade);
      } catch {
        /* closed context */
      }
    }
    const stopAt = now + fade + 0.003;
    for (let i = 0; i < s.n; i++) {
      const src = s.sources[i];
      if (!src) continue;
      try {
        src.stop(stopAt);
      } catch {
        /* already stopped (old WebKit throws on a second stop) */
      }
      s.sources[i] = null;
    }
    s.n = 0;
    s.gain = null;
    s.out = null;
    s.active = false;
  }

  private prune(now: number): void {
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[k]!;
      if (!s.active || s.end > now) continue;
      try {
        s.out?.disconnect();
      } catch {
        /* ignore */
      }
      for (let i = 0; i < s.n; i++) s.sources[i] = null;
      s.n = 0;
      s.gain = null;
      s.out = null;
      s.active = false;
    }
  }
}

/** Accepts at most `maxPerSecond` events (minimum spacing 1/maxPerSecond s on the audio clock). */
export class TickThrottle {
  private last = Number.NEGATIVE_INFINITY;
  readonly minInterval: number;

  constructor(readonly maxPerSecond = 25) {
    this.minInterval = 1 / maxPerSecond;
  }

  allow(now: number): boolean {
    // Clock went backwards (new context) → start over.
    if (now < this.last) this.last = Number.NEGATIVE_INFINITY;
    if (now - this.last < this.minInterval) return false;
    this.last = now;
    return true;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/** Counter ticks climb in whole semitones (Balatro-style stepped pitch), within a sane range. */
export function stepPitch(p: number): number {
  return Math.round(clamp(p, -12, 30));
}
