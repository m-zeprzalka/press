/**
 * SFX recipes — a mechanical print shop: paper, wood, metal type, rubber stamps.
 *
 * A recipe schedules nodes on any BaseAudioContext starting at `t` and returns the
 * time at which it is guaranteed silent. Heavy recipes are pre-rendered once into
 * AudioBuffers through an OfflineAudioContext (see `HEAVY`) and fall back to live
 * synthesis until those buffers exist.
 */

import { adsr, biquad, crackle, fm, gainNode, noise, osc, perc, sweep, type SynthKit } from './dsp';
import type { Sfx } from './types';
import { clamp, mtof, semis } from './util';

/**
 * @param pitch semitone offset (already stepped/jittered by the engine)
 * @param w intensity 0..1 (weight)
 * @param variant pre-render variant (print: 0 light … 2 heavy)
 */
export type Recipe = (
  k: SynthKit,
  out: AudioNode,
  t: number,
  pitch: number,
  w: number,
  variant: number,
) => number;

/* ---------------------------------------------------------------- paper / wood */

/** Paper slide: band-passed noise sweeping around 2 kHz, 60 ms. */
const pickup: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 2000 * r, 1.3, out);
  sweep(bp.frequency, 1500 * r, 2700 * r, t, 0.06);
  const g = gainNode(c, 0, bp);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(2.6, t + 0.012);
  g.gain.linearRampToValueAtTime(1.2, t + 0.04);
  g.gain.linearRampToValueAtTime(0, t + 0.065);
  noise(k, t, t + 0.07, g);
  return t + 0.07;
};

/** Tiny wooden tick: resonant noise click + a short high ping. */
const snap: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 3300 * r, 4, out);
  const g = gainNode(c, 0, bp);
  const e1 = perc(g.gain, t, 0.0008, 3.5, 0.018);
  noise(k, t, e1, g);
  const g2 = gainNode(c, 0, out);
  const e2 = perc(g2.gain, t, 0.0008, 0.22, 0.03);
  const o = osc(k, 'sine', 1900 * r, t, e2, g2);
  o.frequency.exponentialRampToValueAtTime(1500 * r, t + 0.03);
  return Math.max(e1, e2);
};

/** Paper rustle: three quick flaps of band-passed noise + a soft low "fft". */
const cardFlip: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 3500 * r, 0.9, out);
  sweep(bp.frequency, 2400 * r, 5200 * r, t, 0.11);
  const g = gainNode(c, 0, bp);
  const flaps = 3;
  for (let i = 0; i < flaps; i++) {
    const tt = t + i * 0.034;
    const a = 1.7 - i * 0.45;
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(a, tt + 0.004);
    g.gain.linearRampToValueAtTime(0, tt + 0.026);
  }
  noise(k, t, t + 0.12, g);
  const lp = biquad(c, 'lowpass', 900, 0.7, out);
  const gb = gainNode(c, 0, lp);
  const e = perc(gb.gain, t, 0.01, 0.5, 0.06);
  noise(k, t, e, gb);
  return Math.max(t + 0.12, e);
};

/** Swoosh up into the rack, then a soft wooden thock. */
const cardTake: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 1500 * r, 1.2, out);
  sweep(bp.frequency, 900 * r, 3200 * r, t, 0.12);
  const g = gainNode(c, 0, bp);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1.8, t + 0.05);
  g.gain.linearRampToValueAtTime(0, t + 0.13);
  noise(k, t, t + 0.14, g);
  const tt = t + 0.1;
  const g2 = gainNode(c, 0, out);
  const e1 = perc(g2.gain, tt, 0.002, 0.5, 0.07);
  const o = osc(k, 'sine', 230 * r, tt, e1, g2);
  o.frequency.exponentialRampToValueAtTime(150 * r, tt + 0.05);
  const bp2 = biquad(c, 'bandpass', 1200, 2, out);
  const gk = gainNode(c, 0, bp2);
  const e2 = perc(gk.gain, tt, 0.001, 1.6, 0.02);
  noise(k, tt, e2, gk);
  return Math.max(e1, e2);
};

/** A sheet feeding through: band-passed swish with a soft body. */
const paper: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 2200 * r, 1, out);
  sweep(bp.frequency, 1600 * r, 3400 * r, t, 0.15);
  const g = gainNode(c, 0, bp);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1.6, t + 0.035);
  g.gain.linearRampToValueAtTime(0.6, t + 0.1);
  g.gain.linearRampToValueAtTime(0, t + 0.16);
  noise(k, t, t + 0.17, g);
  const lp = biquad(c, 'lowpass', 700, 0.7, out);
  const gb = gainNode(c, 0, lp);
  gb.gain.setValueAtTime(0, t);
  gb.gain.linearRampToValueAtTime(0.5, t + 0.04);
  gb.gain.linearRampToValueAtTime(0, t + 0.14);
  noise(k, t, t + 0.15, gb);
  return t + 0.17;
};

/* ---------------------------------------------------------------- metal type */

/** Metal type dropping into the forme: 120 Hz thump with fast pitch drop + click + tiny metal ping. */
const place: Recipe = (k, out, t, pitch, w) => {
  const c = k.c;
  const r = semis(pitch);
  const wt = 0.6 + 0.4 * w;
  const g = gainNode(c, 0, out);
  const e1 = perc(g.gain, t, 0.002, 0.9 * wt, 0.14);
  const o = osc(k, 'sine', 260 * r, t, e1, g);
  o.frequency.exponentialRampToValueAtTime(118 * r, t + 0.03);
  o.frequency.exponentialRampToValueAtTime(96 * r, t + 0.14);
  const hp = biquad(c, 'highpass', 3500, 0.7, out);
  const gc = gainNode(c, 0, hp);
  const e2 = perc(gc.gain, t, 0.0005, 1.2, 0.008);
  noise(k, t, e2, gc);
  const lp = biquad(c, 'lowpass', 500, 0.7, out);
  const gn = gainNode(c, 0, lp);
  const e3 = perc(gn.gain, t, 0.002, 1.2 * wt, 0.05);
  noise(k, t, e3, gn);
  const gm = gainNode(c, 0, out);
  const e4 = perc(gm.gain, t + 0.001, 0.001, 0.07, 0.07);
  fm(k, 1240 * r, 2.76, 1.2, 0.2, 0.05, t + 0.001, e4, gm);
  return Math.max(e1, e2, e3, e4);
};

/** Dull wooden knock + two muted descending blips ("won't fit"). */
const dropInvalid: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const lp = biquad(c, 'lowpass', 1100, 0.8, out);
  const g = gainNode(c, 0, lp);
  perc(g.gain, t, 0.004, 0.55, 0.08);
  const t2 = t + 0.095;
  const end = perc(g.gain, t2, 0.004, 0.5, 0.1);
  const o = osc(k, 'triangle', 220 * r, t, end, g);
  o.frequency.exponentialRampToValueAtTime(200 * r, t + 0.08);
  o.frequency.setValueAtTime(165 * r, t2);
  o.frequency.exponentialRampToValueAtTime(146 * r, t2 + 0.1);
  const bp = biquad(c, 'bandpass', 900, 2, out);
  const gk = gainNode(c, 0, bp);
  const e2 = perc(gk.gain, t, 0.001, 1.6, 0.025);
  noise(k, t, e2, gk);
  return Math.max(end, e2);
};

/* ---------------------------------------------------------------- the press */

/**
 * Press slam. `wt` 0..1 scales weight: brighter/longer noise burst, deeper body,
 * longer platen ring, more crunch grains.
 */
function printCore(k: SynthKit, out: AudioNode, t: number, wt: number, r: number, grains: number): number {
  const c = k.c;
  // Slam: low-passed noise burst, the filter closing fast.
  const lp = biquad(c, 'lowpass', 1800, 0.9, out);
  sweep(lp.frequency, (1200 + 1400 * wt) * r, 160 * r, t, 0.2);
  const gn = gainNode(c, 0, lp);
  const e1 = perc(gn.gain, t, 0.0015, 1.7, 0.14 + 0.1 * wt);
  noise(k, t, e1, gn);
  // Body thump.
  const gb = gainNode(c, 0, out);
  const e2 = perc(gb.gain, t, 0.002, 0.75 + 0.25 * wt, 0.2 + 0.15 * wt);
  const ob = osc(k, 'sine', 160 * r, t, e2, gb);
  ob.frequency.exponentialRampToValueAtTime((58 - 8 * wt) * r, t + 0.11);
  // Metallic FM resonance of the platen (inharmonic ratios).
  const gm = gainNode(c, 0, out);
  const e3 = perc(gm.gain, t + 0.003, 0.002, 0.16 + 0.08 * wt, 0.32 + 0.25 * wt);
  fm(k, 187 * r, 1.414, 3 + 3 * wt, 0.4, 0.22, t + 0.003, e3, gm);
  const gm2 = gainNode(c, 0, out);
  const e4 = perc(gm2.gain, t + 0.003, 0.001, 0.06 + 0.03 * wt, 0.18 + 0.1 * wt);
  fm(k, 611 * r, 2.31, 2, 0.2, 0.12, t + 0.003, e4, gm2);
  // Subtle paper crunch right after impact.
  const bp = biquad(c, 'bandpass', 2600 * r, 1.1, out);
  const gc = gainNode(c, 0, bp);
  const e5 = crackle(gc.gain, k.rng, t + 0.008, 0.07 + 0.04 * wt, grains, 2.2, 0.003, 0.009);
  noise(k, t, e5 + 0.01, gc);
  return Math.max(e1, e2, e3, e4, e5 + 0.01);
}

const print: Recipe = (k, out, t, pitch, _w, variant) =>
  printCore(k, out, t, clamp(variant, 0, 2) / 2, semis(pitch), 6 + 2 * clamp(variant, 0, 2));

/** Heavier slam: full-weight print + sub thump, a rebound clank and a rumble tail. */
const printBig: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const e0 = printCore(k, out, t, 1, r, 12);
  const gs = gainNode(c, 0, out);
  const e1 = perc(gs.gain, t, 0.004, 0.9, 0.55);
  const os = osc(k, 'sine', 72 * r, t, e1, gs);
  os.frequency.exponentialRampToValueAtTime(31 * r, t + 0.35);
  const t2 = t + 0.11;
  const gr = gainNode(c, 0, out);
  const e2 = perc(gr.gain, t2, 0.001, 0.09, 0.22);
  fm(k, 263 * r, 1.41, 3, 0.3, 0.15, t2, e2, gr);
  const lp = biquad(c, 'lowpass', 400, 0.7, out);
  const gt = gainNode(c, 0, lp);
  const e3 = perc(gt.gain, t, 0.01, 1.2, 0.45);
  noise(k, t, e3, gt);
  return Math.max(e0, e1, e2, e3);
};

/** Paper cutter "cha-chunk": blade swish, then the blade bottoming out. */
const sell: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 6000 * r, 2.2, out);
  sweep(bp.frequency, 7000 * r, 2200 * r, t, 0.09);
  const g = gainNode(c, 0, bp);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(2.4, t + 0.012);
  g.gain.linearRampToValueAtTime(1.2, t + 0.07);
  g.gain.linearRampToValueAtTime(0, t + 0.1);
  noise(k, t, t + 0.11, g);
  const t2 = t + 0.11;
  const gt = gainNode(c, 0, out);
  const e1 = perc(gt.gain, t2, 0.002, 0.8, 0.12);
  const o = osc(k, 'sine', 175 * r, t2, e1, gt);
  o.frequency.exponentialRampToValueAtTime(64 * r, t2 + 0.05);
  const gm = gainNode(c, 0, out);
  const e2 = perc(gm.gain, t2, 0.001, 0.12, 0.1);
  fm(k, 330 * r, 1.41, 3, 0.3, 0.08, t2, e2, gm);
  const lp = biquad(c, 'lowpass', 2500, 0.8, out);
  const gc = gainNode(c, 0, lp);
  const e3 = perc(gc.gain, t2, 0.0007, 1.4, 0.03);
  noise(k, t2, e3, gc);
  return Math.max(e1, e2, e3);
};

/** Ratchet crank (5 accelerating clicks, rising) then a shuffle swoosh. */
const reroll: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 2600 * r, 4, out);
  const g = gainNode(c, 0, bp);
  const gt = gainNode(c, 0, out);
  const gaps = 4;
  let tt = t;
  let last = t;
  const tick = osc(k, 'triangle', 880 * r, t, t + 0.3, gt);
  for (let i = 0; i <= gaps; i++) {
    bp.frequency.setValueAtTime((2400 + 320 * i) * r, tt);
    tick.frequency.setValueAtTime(880 * semis(i * 2) * r, tt);
    perc(g.gain, tt, 0.0005, 2.8, 0.012);
    last = perc(gt.gain, tt, 0.001, 0.12, 0.018);
    tt += 0.056 - i * 0.007;
  }
  noise(k, t, last, g);
  const bp2 = biquad(c, 'bandpass', 2000 * r, 1, out);
  sweep(bp2.frequency, 1800 * r, 3800 * r, last, 0.12);
  const gs = gainNode(c, 0, bp2);
  gs.gain.setValueAtTime(0, last);
  gs.gain.linearRampToValueAtTime(1.5, last + 0.04);
  gs.gain.linearRampToValueAtTime(0, last + 0.13);
  noise(k, last, last + 0.14, gs);
  return Math.max(t + 0.3, last + 0.14);
};

/** Grinding gear: detuned saws through an LFO-swept bandpass, ratcheting AM, motor sag. */
const jam: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const end = t + 0.9;
  const bp = biquad(c, 'bandpass', 650 * r, 3, out);
  const lfo = c.createGain();
  lfo.gain.value = 320 * r;
  lfo.connect(bp.frequency);
  osc(k, 'triangle', 9, t, end, lfo);
  const am = c.createGain();
  am.gain.value = 0.55;
  am.connect(bp);
  const amDepth = c.createGain();
  amDepth.gain.value = 0.45;
  amDepth.connect(am.gain);
  osc(k, 'sawtooth', 13, t, end, amDepth);
  const env = gainNode(c, 0, am);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.75, t + 0.03);
  env.gain.setValueAtTime(0.75, t + 0.55);
  env.gain.linearRampToValueAtTime(0, end - 0.01);
  const s1 = osc(k, 'sawtooth', 82 * r, t, end, env);
  s1.frequency.linearRampToValueAtTime(70 * r, end);
  const s2 = osc(k, 'sawtooth', 84.6 * r, t, end, env);
  s2.frequency.linearRampToValueAtTime(72.5 * r, end);
  const s3 = osc(k, 'sawtooth', 123.5 * r, t, end, env);
  s3.frequency.linearRampToValueAtTime(104 * r, end);
  // Grit: metal on metal.
  const hp = biquad(c, 'highpass', 2200, 0.7, out);
  const gg = gainNode(c, 0, hp);
  crackle(gg.gain, k.rng, t + 0.01, 0.75, 24, 0.9, 0.004, 0.02);
  noise(k, t, end, gg);
  return end;
};

/* ---------------------------------------------------------------- rubber stamp */

function stampCore(k: SynthKit, out: AudioNode, t: number, r: number, wt: number): number {
  const c = k.c;
  // Dull thunk.
  const lp = biquad(c, 'lowpass', 520, 0.8, out);
  const g = gainNode(c, 0, lp);
  const e1 = perc(g.gain, t, 0.003, 1.0 * wt, 0.12);
  const o = osc(k, 'sine', 170 * r, t, e1, g);
  o.frequency.exponentialRampToValueAtTime(72 * r, t + 0.045);
  // Rubber squish.
  const lp2 = biquad(c, 'lowpass', 1100, 0.7, out);
  const gn = gainNode(c, 0, lp2);
  const e2 = perc(gn.gain, t, 0.004, 1.4 * wt, 0.06);
  noise(k, t, e2, gn);
  // Wooden handle body.
  const bp = biquad(c, 'bandpass', 340 * r, 2.2, out);
  const gb = gainNode(c, 0, bp);
  const e3 = perc(gb.gain, t, 0.002, 2.2 * wt, 0.07);
  noise(k, t, e3, gb);
  // Lift off the ink: a small "tsk".
  const tl = t + 0.17;
  const bp2 = biquad(c, 'bandpass', 1900, 1.5, out);
  const gl = gainNode(c, 0, bp2);
  const e4 = perc(gl.gain, tl, 0.004, 0.6 * wt, 0.035);
  noise(k, tl, e4, gl);
  return Math.max(e1, e2, e3, e4);
}

const stamp: Recipe = (k, out, t, pitch) => stampCore(k, out, t, semis(pitch), 1);

/** F6/9 voicing (F3 C4 A4 D5 G5): warm, major, and diatonic to the D-Dorian music. */
const CHIME = [53, 60, 69, 74, 79];

/** Rubber stamp thunk + strummed electric-piano major chord + a high sparkle. */
const quotaDone: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  let end = stampCore(k, out, t, r, 1);
  const t0 = t + 0.08;
  for (let i = 0; i < CHIME.length; i++) {
    const tt = t0 + i * 0.028;
    const f = mtof(CHIME[i] ?? 60) * r;
    const g = gainNode(c, 0, out);
    const e = perc(g.gain, tt, 0.004, 0.16, 1.5 - i * 0.12);
    fm(k, f, 1, 1.8, 0.25, 0.35, tt, e, g);
    end = Math.max(end, e);
  }
  const ts = t0 + 0.14;
  const g2 = gainNode(c, 0, out);
  const e2 = perc(g2.gain, ts, 0.002, 0.05, 0.6);
  fm(k, mtof(91) * r, 3.5, 1.2, 0.05, 0.3, ts, e2, g2);
  return Math.max(end, e2);
};

/* ---------------------------------------------------------------- crumple */

/** Paper crumple (granular crackle over a wandering bandpass) + low descending minor dyad. */
const lose: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const bp = biquad(c, 'bandpass', 2400, 1.4, out);
  for (let i = 0; i < 9; i++) bp.frequency.setValueAtTime((1200 + 3200 * k.rng.next()) * r, t + i * 0.1);
  const g = gainNode(c, 0, bp);
  const e1 = crackle(g.gain, k.rng, t, 0.9, 70, 3.0, 0.003, 0.014);
  noise(k, t, e1 + 0.01, g);
  const hp = biquad(c, 'highpass', 5200, 0.7, out);
  const g2 = gainNode(c, 0, hp);
  const e2 = crackle(g2.gain, k.rng, t + 0.02, 0.85, 40, 1.6, 0.001, 0.003);
  noise(k, t, e2 + 0.01, g2);
  const lp = biquad(c, 'lowpass', 700, 0.7, out);
  const gt = gainNode(c, 0, lp);
  const t0 = t + 0.15;
  const e3 = adsr(gt.gain, t0, 0.15, 0.45, 0.6, 0.8, 0.85, 0.12);
  const o1 = osc(k, 'triangle', 220 * r, t0, e3, gt);
  o1.frequency.exponentialRampToValueAtTime(73.4 * r, t0 + 1.45);
  const o2 = osc(k, 'sine', 174.6 * r, t0, e3, gt);
  o2.frequency.exponentialRampToValueAtTime(58.3 * r, t0 + 1.45);
  return Math.max(e1 + 0.01, e2 + 0.01, e3);
};

/* ---------------------------------------------------------------- streak & counters */

/** D minor pentatonic counted from A4: A C D F G. */
const PENT = [0, 3, 5, 8, 10];

/** FM bell on the n-th pentatonic step (pitch = streak step). */
const streakUp: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const deg = Math.round(clamp(pitch, 0, 12));
  const f = mtof(69 + 12 * Math.floor(deg / 5) + (PENT[deg % 5] ?? 0));
  const g = gainNode(c, 0, out);
  const e1 = perc(g.gain, t, 0.003, 0.5, 0.38);
  fm(k, f, 2, 2.2, 0.15, 0.2, t, e1, g);
  const g2 = gainNode(c, 0, out);
  const e2 = perc(g2.gain, t, 0.002, 0.12, 0.12);
  osc(k, 'sine', f * 2, t, e2, g2);
  return Math.max(e1, e2);
};

/** Dull descending blip (low-passed triangle + sine an octave down). */
const streakBreak: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const lp = biquad(c, 'lowpass', 850, 0.7, out);
  const g = gainNode(c, 0, lp);
  const e = perc(g.gain, t, 0.006, 0.45, 0.26);
  const o = osc(k, 'triangle', 392 * r, t, e, g);
  o.frequency.exponentialRampToValueAtTime(185 * r, t + 0.24);
  const o2 = osc(k, 'sine', 196 * r, t, e, g);
  o2.frequency.exponentialRampToValueAtTime(92 * r, t + 0.24);
  return e;
};

/** Counter tick (prints): plucky triangle with a pitch blip + a tiny click. */
const tickPrints: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const f = 587.33 * semis(pitch);
  const g = gainNode(c, 0, out);
  const e1 = perc(g.gain, t, 0.001, 0.45, 0.045);
  const o = osc(k, 'triangle', f * 1.5, t, e1, g);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.008);
  const bp = biquad(c, 'bandpass', 4200, 3, out);
  const gc = gainNode(c, 0, bp);
  const e2 = perc(gc.gain, t, 0.0005, 1.0, 0.006);
  noise(k, t, e2, gc);
  return Math.max(e1, e2);
};

/** Counter tick (mult): glassier FM blip with a soft sub. */
const tickMult: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const f = 659.26 * semis(pitch);
  const g = gainNode(c, 0, out);
  const e1 = perc(g.gain, t, 0.001, 0.4, 0.06);
  fm(k, f, 3, 1.6, 0.05, 0.05, t, e1, g);
  const g2 = gainNode(c, 0, out);
  const e2 = perc(g2.gain, t, 0.001, 0.18, 0.035);
  osc(k, 'triangle', f / 2, t, e2, g2);
  return Math.max(e1, e2);
};

/** Bright rising zap: detuned saws sweeping up through a resonant low-pass, then a sparkle. */
const xmult: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const f0 = 220 * r;
  const f1 = 1760 * r;
  const lp = biquad(c, 'lowpass', 900, 7, out);
  sweep(lp.frequency, 700 * r, 9000, t, 0.17);
  const g = gainNode(c, 0, lp);
  const e1 = perc(g.gain, t, 0.004, 0.32, 0.24);
  const s1 = osc(k, 'sawtooth', f0, t, e1, g);
  sweep(s1.frequency, f0, f1, t, 0.16);
  const s2 = osc(k, 'sawtooth', f0 * 1.007, t, e1, g);
  sweep(s2.frequency, f0 * 1.007, f1 * 1.007, t, 0.16);
  const ts = t + 0.14;
  const g2 = gainNode(c, 0, out);
  const e2 = perc(g2.gain, ts, 0.002, 0.2, 0.25);
  fm(k, f1 * 1.5, 1.5, 2, 0.1, 0.2, ts, e2, g2);
  const hp = biquad(c, 'highpass', 5000, 0.7, out);
  const gn = gainNode(c, 0, hp);
  const e3 = perc(gn.gain, t, 0.002, 0.5, 0.06);
  noise(k, t, e3, gn);
  return Math.max(e1, e2, e3);
};

/** Sparkle: rising arpeggio of glassy FM bells (D F A C E A) over a hiss shimmer. */
const UNLOCK_NOTES = [74, 77, 81, 84, 88, 93];
const unlock: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  let end = t;
  for (let i = 0; i < UNLOCK_NOTES.length; i++) {
    const tt = t + i * 0.045;
    const g = gainNode(c, 0, out);
    const e = perc(g.gain, tt, 0.002, 0.16, 0.55);
    fm(k, mtof(UNLOCK_NOTES[i] ?? 74) * r, 3.5, 1.4, 0.05, 0.25, tt, e, g);
    end = Math.max(end, e);
  }
  const hp = biquad(c, 'highpass', 7000, 0.7, out);
  const gs = gainNode(c, 0, hp);
  gs.gain.setValueAtTime(0, t);
  gs.gain.linearRampToValueAtTime(0.35, t + 0.12);
  gs.gain.linearRampToValueAtTime(0, t + 0.6);
  noise(k, t, t + 0.62, gs);
  return Math.max(end, t + 0.62);
};

/* ---------------------------------------------------------------- UI */

const uiClick: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const g = gainNode(c, 0, out);
  const e1 = perc(g.gain, t, 0.001, 0.3, 0.028);
  osc(k, 'sine', 1150 * r, t, e1, g);
  const bp = biquad(c, 'bandpass', 2600 * r, 2, out);
  const gc = gainNode(c, 0, bp);
  const e2 = perc(gc.gain, t, 0.0005, 0.9, 0.01);
  noise(k, t, e2, gc);
  return Math.max(e1, e2);
};

const uiBack: Recipe = (k, out, t, pitch) => {
  const c = k.c;
  const r = semis(pitch);
  const g = gainNode(c, 0, out);
  const e1 = perc(g.gain, t, 0.002, 0.3, 0.05);
  const o = osc(k, 'sine', 820 * r, t, e1, g);
  o.frequency.exponentialRampToValueAtTime(540 * r, t + 0.05);
  const bp = biquad(c, 'bandpass', 1500 * r, 2, out);
  const gc = gainNode(c, 0, bp);
  const e2 = perc(gc.gain, t, 0.0005, 0.8, 0.012);
  noise(k, t, e2, gc);
  return Math.max(e1, e2);
};

/* ---------------------------------------------------------------- table */

export interface SfxDef {
  recipe: Recipe;
  /** Mix level (voice gain at intensity 1). */
  level: number;
  /** Random ± semitone detune per play, so repeated sounds don't machine-gun. */
  jitter: number;
  /** Pre-rendered at unlock: buffer length (s) and number of weight variants. */
  heavy?: { dur: number; variants: number };
}

export const SFX: Record<Sfx, SfxDef> = {
  pickup: { recipe: pickup, level: 0.5, jitter: 0.6 },
  drop_invalid: { recipe: dropInvalid, level: 0.5, jitter: 0 },
  snap: { recipe: snap, level: 0.45, jitter: 0.5 },
  place: { recipe: place, level: 0.38, jitter: 0.4 },
  print: { recipe: print, level: 0.58, jitter: 0.3, heavy: { dur: 0.65, variants: 3 } },
  print_big: { recipe: printBig, level: 0.5, jitter: 0.2, heavy: { dur: 0.7, variants: 1 } },
  streak_up: { recipe: streakUp, level: 0.55, jitter: 0 },
  streak_break: { recipe: streakBreak, level: 0.45, jitter: 0 },
  tick_prints: { recipe: tickPrints, level: 0.45, jitter: 0 },
  tick_mult: { recipe: tickMult, level: 0.47, jitter: 0 },
  xmult: { recipe: xmult, level: 0.45, jitter: 0 },
  quota_done: { recipe: quotaDone, level: 0.75, jitter: 0, heavy: { dur: 1.7, variants: 1 } },
  jam: { recipe: jam, level: 0.5, jitter: 0 },
  lose: { recipe: lose, level: 0.3, jitter: 0, heavy: { dur: 1.95, variants: 1 } },
  ui_click: { recipe: uiClick, level: 0.5, jitter: 0.3 },
  ui_back: { recipe: uiBack, level: 0.55, jitter: 0 },
  card_flip: { recipe: cardFlip, level: 0.45, jitter: 0.8 },
  card_take: { recipe: cardTake, level: 0.5, jitter: 0.3 },
  sell: { recipe: sell, level: 0.6, jitter: 0.2 },
  reroll: { recipe: reroll, level: 0.45, jitter: 0 },
  stamp: { recipe: stamp, level: 0.75, jitter: 0.3, heavy: { dur: 0.3, variants: 1 } },
  unlock: { recipe: unlock, level: 0.45, jitter: 0 },
  paper: { recipe: paper, level: 0.45, jitter: 0.8 },
};
