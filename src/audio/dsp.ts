/**
 * Synthesis building blocks shared by the SFX recipes and the music instruments.
 * They work on any BaseAudioContext, so the same recipe can play live or be
 * pre-rendered through an OfflineAudioContext.
 *
 * Envelope rule (no clicks): every amplitude envelope starts at 0, ramps up, and
 * ends at exactly 0 before its source stops.
 */

import { Prng } from './prng';
import type { Sink } from './voices';

export interface SynthKit {
  c: BaseAudioContext;
  /** Shared 1 s white-noise buffer (looped, random start offset). */
  noise: AudioBuffer;
  rng: Prng;
  /** Receives every source node so the voice can be stolen. */
  sink: Sink;
}

/** Pre-render a mono white-noise buffer (seeded, so renders are reproducible). */
export function makeNoiseBuffer(c: BaseAudioContext, seconds = 1, seed = 0x5eed): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  const rng = new Prng(seed);
  for (let i = 0; i < len; i++) data[i] = rng.next() * 2 - 1;
  return buf;
}

export function gainNode(c: BaseAudioContext, value: number, dest: AudioNode): GainNode {
  const g = c.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

export function biquad(
  c: BaseAudioContext,
  type: BiquadFilterType,
  freq: number,
  q: number,
  dest: AudioNode,
): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

export function osc(
  k: SynthKit,
  type: OscillatorType,
  freq: number,
  t: number,
  end: number,
  dest: AudioNode,
): OscillatorNode {
  const o = k.c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(dest);
  o.start(t);
  o.stop(end);
  k.sink.track(o);
  return o;
}

/** Looped noise from a random offset of the shared buffer. */
export function noise(k: SynthKit, t: number, end: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
  const s = k.c.createBufferSource();
  s.buffer = k.noise;
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(dest);
  s.start(t, k.rng.next() * 0.9 * k.noise.duration);
  s.stop(end);
  k.sink.track(s);
  return s;
}

/**
 * Percussive envelope on a gain param: 0 → peak over `a`, exponential decay
 * (−60 dB) over `d`, then a 10 ms glide to exactly 0. Returns the time it reaches 0.
 */
export function perc(p: AudioParam, t: number, a: number, peak: number, d: number): number {
  const pk = Math.max(peak, 1e-5);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.exponentialRampToValueAtTime(pk * 0.001, t + a + d);
  p.linearRampToValueAtTime(0, t + a + d + 0.01);
  return t + a + d + 0.01;
}

/**
 * Sustained envelope: attack to `peak`, settle toward `peak·sustain`, release at
 * `t + hold` with time constant `rel`. Returns when the voice is inaudible (−60 dB).
 */
export function adsr(
  p: AudioParam,
  t: number,
  a: number,
  peak: number,
  decayTau: number,
  sustain: number,
  hold: number,
  rel: number,
): number {
  const pk = Math.max(peak, 1e-5);
  const relAt = t + Math.max(hold, a + 0.001);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.setTargetAtTime(pk * sustain, t + a, decayTau);
  p.setTargetAtTime(0, relAt, rel);
  const end = relAt + rel * 7;
  p.setValueAtTime(0, end);
  return end;
}

/** Exponential frequency sweep. */
export function sweep(p: AudioParam, from: number, to: number, t: number, dur: number): void {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
}

/**
 * 2-operator FM: modulator (freq·ratio) → carrier frequency, with the modulation index
 * decaying from `i0` to `i1` over `idxDecay`. Carrier output goes to `dest`.
 */
export function fm(
  k: SynthKit,
  freq: number,
  ratio: number,
  i0: number,
  i1: number,
  idxDecay: number,
  t: number,
  end: number,
  dest: AudioNode,
): OscillatorNode {
  const car = osc(k, 'sine', freq, t, end, dest);
  const mf = freq * ratio;
  const depth = k.c.createGain();
  depth.gain.setValueAtTime(Math.max(i0 * mf, 0.01), t);
  depth.gain.exponentialRampToValueAtTime(Math.max(i1 * mf, 0.01), t + Math.max(0.005, idxDecay));
  depth.connect(car.frequency);
  osc(k, 'sine', mf, t, end, depth);
  return car;
}

/**
 * Granular "crackle" on a gain param: `count` short bursts between t and t+span.
 * Grain times are strictly increasing so automation events stay ordered.
 */
export function crackle(
  p: AudioParam,
  rng: Prng,
  t: number,
  span: number,
  count: number,
  peak: number,
  minLen: number,
  maxLen: number,
): number {
  p.setValueAtTime(0, t);
  const slot = span / Math.max(1, count);
  let at = t;
  for (let i = 0; i < count; i++) {
    const len = minLen + (maxLen - minLen) * rng.next();
    const start = Math.max(at, t + i * slot + rng.next() * Math.max(0, slot - len));
    // Busier in the middle of the gesture, like a sheet being crushed.
    const shape = Math.sin(Math.PI * ((i + 0.5) / count));
    const amp = peak * (0.25 + 0.75 * rng.next()) * (0.4 + 0.6 * shape);
    p.setValueAtTime(0, start);
    p.linearRampToValueAtTime(amp, start + len * 0.25);
    p.linearRampToValueAtTime(0, start + len);
    at = start + len + 0.0005;
  }
  return at;
}
