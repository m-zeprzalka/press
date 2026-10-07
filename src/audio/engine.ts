/**
 * The PRESS audio engine: one lazily created AudioContext, a master chain
 *
 *   music bus ─┐
 *              ├─ master gain ─ DynamicsCompressor(−10 dB, 12:1) ─ destination
 *   sfx bus  ──┘
 *
 * SFX voices (16 max, oldest stolen), pre-rendered heavy SFX, the generative music
 * player, and a suspend/resume state machine shared by the caller (ads, app state)
 * and document visibility. Every entry point is a safe no-op without Web Audio.
 */

import { makeNoiseBuffer, type SynthKit } from './dsp';
import { MusicPlayer } from './music';
import { hash32, Prng } from './prng';
import { SFX } from './sfx';
import { SFX_LIST, type AudioEngine, type MusicMode, type PlayOpts, type Sfx } from './types';
import {
  clamp,
  clamp01,
  defaultTimers,
  glideTo,
  perceptualGain,
  rampTo,
  semis,
  settleWithin,
  wait,
  type Timers,
} from './util';
import { NO_SINK, stepPitch, TickThrottle, VoicePool } from './voices';

/** Gain of each bus at slider = 1 (music sits under the SFX). */
export const MUSIC_HEADROOM = 0.5;
export const SFX_HEADROOM = 0.9;
export const DEFAULT_INTENSITY = 0.7;
export const VOICE_LIMIT = 16;
export const TICKS_PER_SECOND = 25;
/** Master fade before ctx.suspend() (silence well within the 100 ms budget). */
export const SUSPEND_FADE = 0.04;
const VOLUME_TAU = 0.05;
/** Tiny scheduling offset so attack ramps are never already in the past. */
const START_OFFSET = 0.002;

const HEAVY_SFX: readonly Sfx[] = SFX_LIST.filter((s) => SFX[s].heavy);

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export type OfflineFactory = (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export interface EngineOptions {
  /** null = Web Audio unavailable. Default: AudioContext/webkitAudioContext with latencyHint 'interactive'. */
  contextFactory?: (() => AudioContext) | null;
  /** null = no pre-rendering (heavy SFX synthesised live). */
  offlineFactory?: OfflineFactory | null;
  timers?: Timers;
  /** Auto suspend/resume on visibilitychange. Default: `document` when present. */
  visibility?: VisibilitySource | null;
  /** Music/SFX variation seed. */
  seed?: number;
}

type WebkitGlobal = typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};

export function defaultContextFactory(): (() => AudioContext) | null {
  const g = globalThis as WebkitGlobal;
  const Ctor = (g.AudioContext as typeof AudioContext | undefined) ?? g.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  return () => {
    try {
      return new Ctor({ latencyHint: 'interactive' });
    } catch {
      return new Ctor(); // very old WebKit rejects the options bag
    }
  };
}

export function defaultOfflineFactory(): OfflineFactory | null {
  const g = globalThis as WebkitGlobal;
  const Ctor =
    (g.OfflineAudioContext as typeof OfflineAudioContext | undefined) ?? g.webkitOfflineAudioContext;
  if (typeof Ctor !== 'function') return null;
  return (channels, length, sampleRate) => new Ctor(channels, length, sampleRate);
}

/** startRendering() as a promise, also on old WebKit (void return + oncomplete). */
export function renderOffline(oc: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    oc.oncomplete = (e) => resolve(e.renderedBuffer);
    let p: Promise<AudioBuffer> | undefined;
    try {
      p = oc.startRendering() as Promise<AudioBuffer> | undefined;
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

type Phase = 'active' | 'suspended';

export class Engine implements AudioEngine {
  readonly pool = new VoicePool(VOICE_LIMIT);
  readonly ticks = new TickThrottle(TICKS_PER_SECOND);

  private ctx: AudioContext | null = null;
  private unsupported = false;
  private disposed = false;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private music: MusicPlayer | null = null;
  private kit: SynthKit | null = null;
  private readonly buffers = new Map<Sfx, AudioBuffer[]>();
  private prerendering: Promise<void> = Promise.resolve();

  private musicVolume = 0.8;
  private sfxVolume = 0.9;
  private mode: MusicMode = 'off';
  private intensity = 0;

  /** Caller asked for silence (ad, app background). */
  private wantSuspended = false;
  /** document.hidden. */
  private hidden = false;
  /** What the state machine has applied. */
  private phase: Phase = 'active';
  private masterUp = false;
  private primed = false;
  private chain: Promise<void> = Promise.resolve();

  private readonly factory: (() => AudioContext) | null;
  private readonly offlineFactory: OfflineFactory | null;
  private readonly timers: Timers;
  private readonly visibility: VisibilitySource | null;
  private readonly seed: number;
  private readonly rng: Prng;

  private readonly onVisibility = (): void => {
    const h = !!this.visibility?.hidden;
    if (h === this.hidden) return;
    this.hidden = h;
    void this.reconcile();
  };

  private readonly onStateChange = (): void => {
    if (this.ctx?.state === 'running') this.onRunning();
  };

  constructor(opts: EngineOptions = {}) {
    this.factory = opts.contextFactory !== undefined ? opts.contextFactory : defaultContextFactory();
    this.offlineFactory = opts.offlineFactory !== undefined ? opts.offlineFactory : defaultOfflineFactory();
    this.timers = opts.timers ?? defaultTimers;
    this.visibility =
      opts.visibility !== undefined ? opts.visibility : typeof document !== 'undefined' ? document : null;
    this.seed = (opts.seed ?? Date.now()) >>> 0;
    this.rng = new Prng(hash32(this.seed, 0x5f));
    if (!this.factory) this.unsupported = true;
    if (this.visibility) {
      this.hidden = !!this.visibility.hidden;
      attempt(() => this.visibility?.addEventListener('visibilitychange', this.onVisibility));
    }
  }

  /* ================================================================== public API */

  get ready(): boolean {
    const c = this.ctx;
    return (
      !!c &&
      !this.disposed &&
      this.phase === 'active' &&
      !this.wantSuspended &&
      !this.hidden &&
      c.state === 'running'
    );
  }

  unlock(): Promise<void> {
    if (this.disposed || this.unsupported || this.wantSuspended || this.hidden) return Promise.resolve();
    const c = this.ensureContext();
    if (!c) return Promise.resolve();
    if (c.state === 'running') {
      this.onRunning();
      return Promise.resolve();
    }
    // resume() must be called synchronously inside the user gesture.
    const p = attempt(() => c.resume());
    return settleWithin(p, 1000, this.timers).then(() => {
      if (c.state === 'running') this.onRunning();
    });
  }

  play(sfx: Sfx, opts?: PlayOpts): void {
    if (!this.ready) return;
    const def = SFX[sfx] as (typeof SFX)[Sfx] | undefined;
    const c = this.ctx;
    const kit = this.kit;
    const bus = this.sfxBus;
    if (!def || !c || !kit || !bus) return;
    try {
      const now = c.currentTime;
      let pitch = opts?.pitch ?? 0;
      if (!Number.isFinite(pitch)) pitch = 0;
      if (sfx === 'tick_prints' || sfx === 'tick_mult') {
        if (!this.ticks.allow(now)) return;
        pitch = stepPitch(pitch);
      }
      if (def.jitter > 0) pitch += (this.rng.next() * 2 - 1) * def.jitter;
      const intensity = clamp01(opts?.intensity ?? DEFAULT_INTENSITY);
      const pan = clamp(opts?.pan ?? 0, -1, 1);
      const t = now + START_OFFSET;

      const g = c.createGain();
      g.gain.setValueAtTime(def.level * (0.5 + 0.5 * intensity), now);
      let out: AudioNode = g;
      if (Math.abs(pan) > 0.01 && typeof c.createStereoPanner === 'function') {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        g.connect(p);
        out = p;
      }
      out.connect(bus);

      this.pool.begin(now, g, out);
      let end = t + 1;
      try {
        const variants = def.heavy?.variants ?? 1;
        const variant = Math.round(intensity * (variants - 1));
        const buf = this.buffers.get(sfx)?.[variant];
        if (buf) {
          const src = c.createBufferSource();
          src.buffer = buf;
          const rate = semis(pitch);
          src.playbackRate.value = rate;
          src.connect(g);
          src.start(t);
          this.pool.track(src);
          end = t + buf.duration / rate;
        } else {
          end = def.recipe(kit, g, t, pitch, intensity, variant);
        }
      } finally {
        this.pool.commit(end + 0.02);
      }
    } catch (err) {
      console.warn('[audio] play failed', sfx, err);
    }
  }

  setMusic(mode: MusicMode): void {
    if (mode !== 'menu' && mode !== 'game' && mode !== 'off') return;
    this.mode = mode;
    if (!this.disposed) this.music?.setMode(mode);
  }

  setIntensity(v: number): void {
    this.intensity = clamp01(v);
    this.music?.setIntensity(this.intensity);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    if (this.ctx && this.musicBus) {
      glideTo(
        this.musicBus.gain,
        perceptualGain(this.musicVolume) * MUSIC_HEADROOM,
        this.ctx.currentTime,
        VOLUME_TAU,
      );
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp01(v);
    if (this.ctx && this.sfxBus) {
      glideTo(
        this.sfxBus.gain,
        perceptualGain(this.sfxVolume) * SFX_HEADROOM,
        this.ctx.currentTime,
        VOLUME_TAU,
      );
    }
  }

  suspend(): Promise<void> {
    this.wantSuspended = true;
    return this.reconcile();
  }

  resume(): Promise<void> {
    this.wantSuspended = false;
    return this.reconcile();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    attempt(() => this.visibility?.removeEventListener('visibilitychange', this.onVisibility));
    this.music?.dispose();
    const c = this.ctx;
    if (c) {
      attempt(() => c.removeEventListener('statechange', this.onStateChange));
      attempt(() => this.pool.stopAll(c.currentTime));
      if (typeof c.close === 'function') attempt(() => c.close().catch(() => undefined));
    }
    this.buffers.clear();
    this.ctx = null;
    this.music = null;
    this.kit = null;
  }

  /* ================================================================== diagnostics (tests, preview) */

  get context(): AudioContext | null {
    return this.ctx;
  }
  get musicPlayer(): MusicPlayer | null {
    return this.music;
  }
  get state(): 'unsupported' | 'idle' | 'running' | 'suspended' | 'disposed' {
    if (this.disposed) return 'disposed';
    if (this.unsupported) return 'unsupported';
    if (!this.ctx) return 'idle';
    return this.ready ? 'running' : 'suspended';
  }
  get gains(): { master: GainNode | null; music: GainNode | null; sfx: GainNode | null } {
    return { master: this.master, music: this.musicBus, sfx: this.sfxBus };
  }
  /** Resolves when the heavy SFX pre-render (started on first unlock) has finished. */
  whenPrerendered(): Promise<void> {
    return this.prerendering;
  }
  isPrerendered(sfx: Sfx): boolean {
    return this.buffers.has(sfx);
  }
  /** Resolves when pending suspend/resume transitions have been applied. */
  settled(): Promise<void> {
    return this.chain;
  }

  /* ================================================================== internals */

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (this.unsupported || this.disposed || !this.factory) return null;
    let c: AudioContext | null = null;
    try {
      c = this.factory();
    } catch (err) {
      console.warn('[audio] AudioContext unavailable', err);
    }
    if (!c) {
      this.unsupported = true;
      return null;
    }
    try {
      this.build(c);
    } catch (err) {
      console.warn('[audio] audio graph setup failed', err);
      this.unsupported = true;
      const dead = c;
      if (typeof dead.close === 'function') attempt(() => dead.close().catch(() => undefined));
      return null;
    }
    this.ctx = c;
    return c;
  }

  private build(c: AudioContext): void {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(c.destination);

    const master = c.createGain();
    master.gain.value = 0; // ramps up once running (no pop on first unlock)
    master.connect(comp);

    const musicBus = c.createGain();
    musicBus.gain.value = perceptualGain(this.musicVolume) * MUSIC_HEADROOM;
    musicBus.connect(master);

    const sfxBus = c.createGain();
    sfxBus.gain.value = perceptualGain(this.sfxVolume) * SFX_HEADROOM;
    sfxBus.connect(master);

    const noiseBuf = makeNoiseBuffer(c, 1, hash32(this.seed, 1));
    const music = new MusicPlayer(c, musicBus, noiseBuf, this.seed, this.timers);
    music.setIntensity(this.intensity);
    music.setMode(this.mode);

    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.music = music;
    this.kit = { c, noise: noiseBuf, rng: this.rng, sink: this.pool };
    if (typeof c.addEventListener === 'function') c.addEventListener('statechange', this.onStateChange);
  }

  /** Context confirmed running and nothing wants silence: bring everything up (idempotent). */
  private onRunning(): void {
    if (!this.ready) return;
    const c = this.ctx;
    if (!c || !this.master) return;
    const now = c.currentTime;
    if (!this.masterUp) {
      this.masterUp = true;
      rampTo(this.master.gain, 1, now, 0.05);
    }
    if (!this.primed) {
      this.primed = true;
      this.primeOutput(c);
      this.prerendering = this.prerender(c);
    }
    this.music?.activate(now);
  }

  /** iOS/old WebKit only unlock output after a source plays inside the gesture. */
  private primeOutput(c: AudioContext): void {
    attempt(() => {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate);
      src.connect(c.destination);
      src.start(0);
    });
  }

  /** Render heavy SFX once into AudioBuffers (sequentially, off the hot path). */
  private async prerender(c: AudioContext): Promise<void> {
    const make = this.offlineFactory;
    if (!make) return;
    const sr = c.sampleRate;
    let n = 0;
    for (const sfx of HEAVY_SFX) {
      const def = SFX[sfx];
      if (!def.heavy) continue;
      const list: AudioBuffer[] = [];
      for (let v = 0; v < def.heavy.variants; v++) {
        if (this.disposed) return;
        try {
          const oc = make(1, Math.ceil(def.heavy.dur * sr), sr);
          const kit: SynthKit = {
            c: oc,
            noise: makeNoiseBuffer(oc, 1, hash32(this.seed, 2, n)),
            rng: new Prng(hash32(this.seed, 3, n)),
            sink: NO_SINK,
          };
          n++;
          def.recipe(kit, oc.destination, 0, 0, 1, v);
          list.push(await renderOffline(oc));
        } catch (err) {
          console.warn('[audio] pre-render failed, heavy SFX stay live', sfx, err);
          return;
        }
      }
      if (this.disposed) return;
      this.buffers.set(sfx, list);
    }
  }

  private reconcile(): Promise<void> {
    this.chain = this.chain.then(
      () => this.applyState(),
      () => this.applyState(),
    );
    return this.chain;
  }

  private async applyState(): Promise<void> {
    if (this.disposed) return;
    const want = this.wantSuspended || this.hidden;
    const c = this.ctx;
    if (!c) {
      this.phase = want ? 'suspended' : 'active';
      return;
    }
    if (want && this.phase === 'active') {
      this.phase = 'suspended';
      await this.doSuspend(c);
    } else if (!want && this.phase === 'suspended') {
      await settleWithin(
        attempt(() => c.resume()),
        600,
        this.timers,
      );
      if (this.disposed) return;
      this.phase = 'active';
      this.onRunning();
    }
  }

  private async doSuspend(c: AudioContext): Promise<void> {
    const now = c.currentTime;
    this.music?.deactivate(now);
    this.masterUp = false;
    if (this.master) rampTo(this.master.gain, 0, now, SUSPEND_FADE);
    await wait(SUSPEND_FADE * 1000 + 5, this.timers);
    if (this.disposed) return;
    this.pool.stopAll(c.currentTime);
    if (c.state !== 'closed') {
      await settleWithin(
        attempt(() => c.suspend()),
        300,
        this.timers,
      );
    }
  }
}
