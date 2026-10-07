/**
 * Music player: renders the Composer's events with live Web Audio instruments on a
 * look-ahead StepScheduler, and handles mode crossfades (menu ↔ game ↔ off).
 *
 * Graph: instruments → layer buses (drums / machine / harmony) → gate → lo-fi
 * low-pass → `dest` (the engine's music-volume gain). All buses and filters are
 * persistent; a note only creates its own oscillators / gains.
 */

import { Composer, INST, type MusicEvent, STEP, STEPS_PER_BAR, SWING, type Style } from './composer';
import { adsr, biquad, fm, gainNode, noise, osc, perc, type SynthKit } from './dsp';
import { Prng } from './prng';
import { StepScheduler } from './scheduler';
import type { MusicMode } from './types';
import { clamp01, glideTo, holdAt, mtof, rampTo, type Timers } from './util';
import { NO_SINK } from './voices';

function panner(c: BaseAudioContext, pan: number, dest: AudioNode): AudioNode {
  if (typeof c.createStereoPanner !== 'function') return gainNode(c, 1, dest);
  const p = c.createStereoPanner();
  p.pan.value = pan;
  p.connect(dest);
  return p;
}

function softClipCurve(n = 1024, drive = 1.6): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

export class MusicPlayer {
  readonly scheduler: StepScheduler;
  readonly composer: Composer;
  private mode: MusicMode = 'off';
  private live = false;
  /** Next start begins on a phrase boundary (after a full stop) rather than the next bar. */
  private fresh = true;
  private intensityTarget = 0;
  private intensity = 0;
  private drumsUntil = 0;
  private offUntil = 0;
  private barStyle: Style = 'menu';
  private readonly kit: SynthKit;

  private readonly lp: BiquadFilterNode;
  private readonly gate: GainNode;
  private readonly drums: GainNode;
  private readonly machine: GainNode;
  private readonly kickIn: GainNode;
  private readonly snareNoise: BiquadFilterNode;
  private readonly snareTone: GainNode;
  private readonly hats: BiquadFilterNode;
  private readonly bass: BiquadFilterNode;
  private readonly keys: BiquadFilterNode;
  private readonly machL: AudioNode;
  private readonly machR: AudioNode;
  private readonly machNoise: BiquadFilterNode;
  private readonly wow: OscillatorNode | null;

  constructor(
    private readonly c: BaseAudioContext,
    dest: AudioNode,
    noiseBuf: AudioBuffer,
    seed: number,
    timers: Timers,
  ) {
    this.kit = { c, noise: noiseBuf, rng: new Prng(seed ^ 0x9e3779b9), sink: NO_SINK };
    this.composer = new Composer(seed);
    this.scheduler = new StepScheduler(
      () => c.currentTime,
      (step, time) => this.onStep(step, time),
      { stepDur: STEP, swing: SWING, lookahead: 0.2, intervalMs: 25, timers },
    );

    this.lp = biquad(c, 'lowpass', 2400, 0.5, dest);
    this.gate = gainNode(c, 0, this.lp);
    this.drums = gainNode(c, 0, this.gate);
    this.machine = gainNode(c, 0, this.gate);
    const harmony = gainNode(c, 1, this.gate);

    this.kickIn = gainNode(c, 0.9, this.drums);
    this.snareNoise = biquad(c, 'bandpass', 1900, 0.8, gainNode(c, 0.5, this.drums));
    this.snareTone = gainNode(c, 0.3, this.drums);
    this.hats = biquad(c, 'highpass', 7000, 0.7, gainNode(c, 0.2, panner(c, 0.25, this.drums)));

    const bassLevel = gainNode(c, 0.22, harmony);
    let bassIn: AudioNode = bassLevel;
    if (typeof c.createWaveShaper === 'function') {
      const shaper = c.createWaveShaper();
      shaper.curve = softClipCurve();
      shaper.connect(bassLevel);
      bassIn = shaper;
    }
    this.bass = biquad(c, 'lowpass', 900, 0.7, bassIn);

    // Keys/bells → lo-fi tape wow (a slowly modulated short delay) → level.
    const keysLevel = gainNode(c, 0.15, harmony);
    let keysIn: AudioNode = keysLevel;
    this.wow = null;
    if (typeof c.createDelay === 'function') {
      const d = c.createDelay(0.05);
      d.delayTime.value = 0.006;
      d.connect(keysLevel);
      const depth = c.createGain();
      depth.gain.value = 0.0012;
      depth.connect(d.delayTime);
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.45;
      lfo.connect(depth);
      lfo.start();
      this.wow = lfo;
      keysIn = d;
    }
    this.keys = biquad(c, 'lowpass', 4200, 0.5, keysIn);

    const machLevel = gainNode(c, 1.6, this.machine);
    this.machL = panner(c, -0.35, machLevel);
    this.machR = panner(c, 0.35, machLevel);
    this.machNoise = biquad(c, 'bandpass', 4500, 1.5, machLevel);
  }

  get running(): boolean {
    return this.scheduler.running;
  }

  get currentMode(): MusicMode {
    return this.mode;
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.live) this.applyMode(this.c.currentTime);
    else if (mode === 'off') this.fresh = true;
  }

  setIntensity(v: number): void {
    this.intensityTarget = clamp01(v);
  }

  /** Context is running and audible: (re)start if a mode is selected, aligned to the next bar. */
  activate(now: number): void {
    if (this.live) return;
    this.live = true;
    if (this.mode !== 'off') this.startScheduler(now, now + 0.25);
  }

  /** Engine suspending: stop scheduling, mute quickly. Resumes at the next bar. */
  deactivate(now: number): void {
    if (!this.live) return;
    this.live = false;
    if (this.mode === 'off') this.fresh = true;
    this.scheduler.stop();
    rampTo(this.gate.gain, 0, now, 0.03);
  }

  dispose(): void {
    this.live = false;
    this.scheduler.stop();
    try {
      this.wow?.stop();
      this.lp.disconnect();
    } catch {
      /* closed context */
    }
  }

  /* ------------------------------------------------------------------ transport */

  private applyMode(now: number): void {
    if (this.mode === 'off') {
      if (this.scheduler.running) {
        glideTo(this.gate.gain, 0, now, 0.3);
        this.offUntil = now + 1.6;
      }
      return;
    }
    if (!this.scheduler.running) {
      this.startScheduler(now, now + 0.1);
      return;
    }
    // Crossfade the kit/machine layers; keys and bass switch arrangement at the next bar.
    const game = this.mode === 'game';
    glideTo(this.gate.gain, 1, now, 0.2);
    glideTo(this.drums.gain, game ? 1 : 0, now, 0.5);
    glideTo(this.machine.gain, game ? 1 : 0, now, 0.5);
    this.drumsUntil = game ? Number.POSITIVE_INFINITY : now + 2.5;
  }

  private startScheduler(now: number, t0: number): void {
    const game = this.mode === 'game';
    const nextBar = Math.ceil(this.scheduler.nextStep / STEPS_PER_BAR);
    const bar = this.fresh ? this.composer.nextPhraseStart(nextBar) : nextBar;
    this.fresh = false;
    this.barStyle = game ? 'game' : 'menu';
    this.drumsUntil = game ? Number.POSITIVE_INFINITY : 0;
    for (const g of [this.drums, this.machine]) {
      holdAt(g.gain, now);
      g.gain.setValueAtTime(game ? 1 : 0, now);
    }
    holdAt(this.gate.gain, now);
    this.gate.gain.setValueAtTime(0, now);
    this.gate.gain.setValueAtTime(0, t0);
    this.gate.gain.setTargetAtTime(1, t0, 0.12);
    this.scheduler.start(bar * STEPS_PER_BAR, t0);
  }

  private onStep(step: number, time: number): void {
    if (this.mode === 'off' && time >= this.offUntil) {
      this.scheduler.stop();
      this.fresh = true;
      return;
    }
    // Smooth SERIA-driven intensity (≈ 2 s to settle).
    this.intensity += (this.intensityTarget - this.intensity) * 0.12;
    if (Math.abs(this.intensityTarget - this.intensity) < 0.002) this.intensity = this.intensityTarget;

    if (step % STEPS_PER_BAR === 0) {
      if (this.mode !== 'off') this.barStyle = this.mode;
      const cutoff = this.barStyle === 'game' ? 3600 + 3400 * this.intensity : 2400;
      glideTo(this.lp.frequency, cutoff, time, 0.8);
    }
    const drums = this.mode === 'game' || time < this.drumsUntil;
    const n = this.composer.compose(step, this.barStyle, drums, drums ? this.intensity : 0);
    const now = this.c.currentTime;
    for (let i = 0; i < n; i++) {
      const e = this.composer.events[i];
      if (!e) break;
      const t = time + e.delay;
      this.render(e, t < now ? now : t);
    }
  }

  /* ------------------------------------------------------------------ instruments */

  private render(e: MusicEvent, t: number): void {
    const k = this.kit;
    const c = this.c;
    switch (e.inst) {
      case INST.KICK: {
        const g = gainNode(c, 0, this.kickIn);
        const end = perc(g.gain, t, 0.002, e.vel, 0.32);
        const o = osc(k, 'sine', 140, t, end, g);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
        const gc = gainNode(c, 0, this.kickIn);
        osc(k, 'triangle', 1100, t, perc(gc.gain, t, 0.0008, 0.15 * e.vel, 0.008), gc);
        break;
      }
      case INST.SNARE: {
        const g = gainNode(c, 0, this.snareNoise);
        noise(k, t, perc(g.gain, t, 0.001, 2.2 * e.vel, 0.16), g);
        const gt = gainNode(c, 0, this.snareTone);
        const end = perc(gt.gain, t, 0.001, e.vel, 0.07);
        const o = osc(k, 'triangle', 190, t, end, gt);
        o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
        break;
      }
      case INST.HAT:
      case INST.OHAT: {
        const g = gainNode(c, 0, this.hats);
        noise(k, t, perc(g.gain, t, 0.001, e.vel, e.inst === INST.OHAT ? 0.2 : 0.035), g);
        break;
      }
      case INST.BASS: {
        const g = gainNode(c, 0, this.bass);
        osc(k, 'triangle', mtof(e.midi), t, adsr(g.gain, t, 0.008, e.vel, 0.25, 0.7, e.dur, 0.04), g);
        break;
      }
      case INST.KEYS: {
        // 2-op FM electric piano: index bark on attack, mellowing as it decays.
        const g = gainNode(c, 0, this.keys);
        const end = adsr(g.gain, t, 0.004, e.vel, 0.5, 0.45, e.dur, 0.18);
        fm(k, mtof(e.midi), 1, 0.6 + 2 * e.vel, 0.35, 0.45, t, end, g);
        break;
      }
      case INST.BELL: {
        const g = gainNode(c, 0, this.keys);
        const end = perc(g.gain, t, 0.003, e.vel * 0.7, Math.max(0.3, e.dur));
        fm(k, mtof(e.midi), 3, 1.3, 0.05, 0.4, t, end, g);
        break;
      }
      case INST.CLANK: {
        const g = gainNode(c, 0, e.pan < 0 ? this.machL : this.machR);
        const end = perc(g.gain, t, 0.001, 0.5 * e.vel, 0.09);
        fm(k, mtof(e.midi), 2.76, 3, 0.4, 0.06, t, end, g);
        const gn = gainNode(c, 0, this.machNoise);
        noise(k, t, perc(gn.gain, t, 0.0005, 1.2 * e.vel, 0.012), gn);
        break;
      }
      case INST.THUMP: {
        const g = gainNode(c, 0, e.pan < 0 ? this.machL : this.machR);
        const end = perc(g.gain, t, 0.002, 0.7 * e.vel, 0.08);
        const o = osc(k, 'sine', 120, t, end, g);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.06);
        break;
      }
      case INST.FEED: {
        const g = gainNode(c, 0, this.machNoise);
        noise(k, t, perc(g.gain, t, 0.002, 1.4 * e.vel, 0.025), g);
        break;
      }
    }
  }
}
