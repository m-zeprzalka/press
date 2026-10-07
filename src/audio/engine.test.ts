import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultContextFactory,
  Engine,
  MUSIC_HEADROOM,
  SFX_HEADROOM,
  SUSPEND_FADE,
  type EngineOptions,
} from './engine';
import {
  FakeAudioContext,
  FakeBufferSource,
  FakeCompressor,
  FakeDoc,
  type FakeGain,
  FakeOfflineContext,
  FakeOscillator,
  flushMicrotasks,
  ManualTimers,
} from './fakeAudio';
import { createAudioEngine, SFX_LIST } from './index';
import { perceptualGain } from './util';

interface SetupOpts extends Partial<EngineOptions> {
  initial?: AudioContextState;
  blocked?: boolean;
  hidden?: boolean;
}

function setup(opts: SetupOpts = {}) {
  const timers = new ManualTimers();
  const doc = new FakeDoc();
  doc.hidden = !!opts.hidden;
  const contexts: FakeAudioContext[] = [];
  const offline: FakeOfflineContext[] = [];
  const factory = vi.fn(() => {
    const c = new FakeAudioContext({ latencyHint: 'interactive' }, opts.initial ?? 'running');
    c.autoplayBlocked = !!opts.blocked;
    contexts.push(c);
    return c as unknown as AudioContext;
  });
  const engine = new Engine({
    contextFactory: factory,
    offlineFactory: (ch, len, sr) => {
      const o = new FakeOfflineContext(ch, len, sr);
      offline.push(o);
      return o as unknown as OfflineAudioContext;
    },
    timers,
    visibility: doc,
    seed: 1234,
    ...opts,
  });
  const ctx = () => contexts[0]!;
  /** Advance the audio clock and timers together (5 ms slices), flushing promise continuations. */
  const run = async (seconds: number) => {
    const slices = Math.round(seconds / 0.005);
    for (let i = 0; i < slices; i++) {
      contexts[0]?.advance(0.005);
      timers.advance(5);
      if (i % 2 === 0) await flushMicrotasks();
    }
    await flushMicrotasks();
  };
  const fake = <T>(x: unknown) => x as T;
  return { engine, timers, doc, contexts, offline, ctx, run, factory, fake };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('without Web Audio', () => {
  it('createAudioEngine() is a safe no-op when AudioContext is missing (node)', async () => {
    expect(globalThis.AudioContext).toBeUndefined();
    const a = createAudioEngine();
    await a.unlock();
    await a.unlock();
    expect(a.ready).toBe(false);
    for (const s of SFX_LIST) a.play(s, { pitch: 3, intensity: 1, pan: -1 });
    a.setMusic('game');
    a.setIntensity(1);
    a.setMusicVolume(0.5);
    a.setSfxVolume(0.5);
    await a.suspend();
    await a.resume();
    a.dispose();
    a.dispose();
    expect(a.ready).toBe(false);
  });

  it('survives a context factory that throws or returns nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const contextFactory of [
      () => {
        throw new Error('NotSupportedError');
      },
      () => null as unknown as AudioContext,
    ]) {
      const a = createAudioEngine({ contextFactory });
      await a.unlock();
      expect(a.ready).toBe(false);
      a.play('print');
      a.setMusic('menu');
      await a.suspend();
      await a.resume();
      a.dispose();
    }
  });

  it('default factory requests latencyHint "interactive" and falls back to webkitAudioContext', () => {
    const seen: unknown[] = [];
    class Ctx {
      constructor(o?: unknown) {
        seen.push(o);
      }
    }
    vi.stubGlobal('AudioContext', Ctx);
    defaultContextFactory()!();
    expect(seen[0]).toEqual({ latencyHint: 'interactive' });
    vi.stubGlobal('AudioContext', undefined);
    expect(defaultContextFactory()).toBeNull();
    vi.stubGlobal('webkitAudioContext', Ctx);
    expect(defaultContextFactory()!()).toBeInstanceOf(Ctx);
  });
});

describe('context and master chain', () => {
  it('creates exactly one context, lazily, on the first unlock', async () => {
    const { engine, factory } = setup();
    expect(factory).not.toHaveBeenCalled();
    expect(engine.ready).toBe(false);
    await engine.unlock();
    await engine.unlock();
    await engine.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.ready).toBe(true);
  });

  it('wires music + sfx → master → compressor (−10 dB, 12:1) → destination', async () => {
    const { engine, ctx, fake } = setup();
    await engine.unlock();
    const comp = ctx().nodes.find((n): n is FakeCompressor => n instanceof FakeCompressor)!;
    expect(comp.threshold.value).toBe(-10);
    expect(comp.ratio.value).toBe(12);
    expect(comp.knee.value).toBe(6);
    expect(comp.attack.value).toBe(0.003);
    expect(comp.release.value).toBe(0.15);
    expect(comp.outputs).toEqual([ctx().destination]);
    const { master, music, sfx } = engine.gains;
    const m = fake<FakeGain>(master);
    expect(m.outputs).toEqual([comp]);
    expect(fake<FakeGain>(music).outputs).toEqual([m]);
    expect(fake<FakeGain>(sfx).outputs).toEqual([m]);
    // Master fades in (no pop) once running.
    expect(m.gain.valueAt(0)).toBe(0);
    expect(m.gain.valueAt(0.06)).toBe(1);
  });

  it('starts after a blocked autoplay without hanging, on a later gesture', async () => {
    const { engine, ctx, run } = setup({ initial: 'suspended', blocked: true });
    const p = engine.unlock();
    await run(1.1); // resume() never settles: unlock gives up after its timeout
    await p;
    expect(engine.ready).toBe(false);
    ctx().autoplayBlocked = false;
    await engine.unlock();
    expect(engine.ready).toBe(true);
  });
});

describe('volume', () => {
  it('uses a squared (perceptual) curve', () => {
    expect(perceptualGain(0)).toBe(0);
    expect(perceptualGain(0.5)).toBe(0.25);
    expect(perceptualGain(1)).toBe(1);
    expect(perceptualGain(2)).toBe(1);
    expect(perceptualGain(-1)).toBe(0);
    expect(perceptualGain(Number.NaN)).toBe(0);
  });

  it('ramps the buses smoothly with setTargetAtTime', async () => {
    const { engine, fake } = setup();
    engine.setSfxVolume(0.3); // before the context exists: applied on creation
    await engine.unlock();
    const sfx = fake<FakeGain>(engine.gains.sfx);
    const music = fake<FakeGain>(engine.gains.music);
    expect(sfx.gain.value).toBeCloseTo(0.09 * SFX_HEADROOM, 9);
    engine.setSfxVolume(0.5);
    engine.setMusicVolume(2);
    const last = (g: FakeGain) => g.gain.timeline[g.gain.timeline.length - 1]!;
    expect(last(sfx)).toMatchObject({ kind: 'target', value: 0.25 * SFX_HEADROOM });
    expect(last(music)).toMatchObject({ kind: 'target', value: MUSIC_HEADROOM });
    engine.setMusicVolume(Number.NaN);
    expect(last(music)).toMatchObject({ kind: 'target', value: 0 });
  });
});

describe('SFX playback', () => {
  it('plays every SFX without errors', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { engine, ctx, run } = setup({ offlineFactory: null });
    await engine.unlock();
    for (const s of SFX_LIST) {
      const before = ctx().sources.length;
      engine.play(s, { pitch: 2, intensity: 0.8, pan: 0.3 });
      expect(ctx().sources.length).toBeGreaterThan(before);
      await run(0.05);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('is a no-op until unlocked', () => {
    const { engine, contexts } = setup();
    engine.play('print');
    expect(contexts.length).toBe(0);
  });

  it('limits polyphony to 16 voices (steals the oldest)', async () => {
    const { engine, ctx } = setup({ offlineFactory: null });
    await engine.unlock();
    for (let i = 0; i < 20; i++) engine.play('jam');
    expect(engine.pool.activeCount(ctx().currentTime)).toBe(16);
    expect(engine.pool.stolen).toBe(4);
  });

  it('throttles counter ticks to ≤ 25/s with stepped pitch', async () => {
    const { engine, ctx } = setup({ offlineFactory: null });
    await engine.unlock();
    const begin = vi.spyOn(engine.pool, 'begin');
    for (let i = 0; i < 100; i++) {
      engine.play(i % 2 ? 'tick_mult' : 'tick_prints', { pitch: i / 10 });
      ctx().advance(0.01);
    }
    const played = begin.mock.calls.length;
    expect(played).toBeLessThanOrEqual(25);
    expect(played).toBeGreaterThanOrEqual(20);

    ctx().advance(1);
    engine.play('tick_prints', { pitch: 2.6 });
    const tri = ctx()
      .nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator && n.type === 'triangle')
      .pop()!;
    const exp = tri.frequency.timeline.find((e) => e.kind === 'exp')!;
    expect(exp.value).toBeCloseTo(587.33 * Math.pow(2, 3 / 12), 2);
  });

  it('pre-renders heavy SFX once and plays them as buffers', async () => {
    const { engine, ctx, offline } = setup();
    await engine.unlock();
    await engine.whenPrerendered();
    expect(offline.length).toBe(7); // print ×3, print_big, quota_done, lose, stamp
    for (const s of ['print', 'print_big', 'quota_done', 'lose', 'stamp'] as const)
      expect(engine.isPrerendered(s)).toBe(true);
    expect(engine.isPrerendered('pickup')).toBe(false);
    await engine.unlock();
    expect(offline.length).toBe(7);

    const lastBufferSource = () =>
      ctx()
        .sources.filter((s): s is FakeBufferSource => s instanceof FakeBufferSource)
        .pop()!;
    engine.play('print', { intensity: 1 });
    expect(lastBufferSource().buffer).toBe(offline[2]!.result);
    engine.play('print', { intensity: 0 });
    expect(lastBufferSource().buffer).toBe(offline[0]!.result);
    engine.play('lose', { pitch: 12 });
    expect(lastBufferSource().buffer).toBe(offline[5]!.result);
    expect(lastBufferSource().playbackRate.value).toBeCloseTo(2, 9);
  });

  it('synthesises heavy SFX live until/unless pre-rendered', async () => {
    const { engine, ctx } = setup({ offlineFactory: null });
    await engine.unlock();
    const osc0 = ctx().count('oscillator');
    engine.play('print');
    expect(ctx().count('oscillator')).toBeGreaterThan(osc0);
    expect(engine.isPrerendered('print')).toBe(false);
  });

  it('pans with a StereoPanner', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.play('pickup', { pan: -0.7 });
    const p = ctx()
      .nodes.filter((n) => n.kind === 'panner')
      .pop() as unknown as { pan: { value: number } };
    expect(p.pan.value).toBeCloseTo(-0.7, 9);
  });
});

describe('suspend / resume', () => {
  it('silences within 100 ms, suspends the context, and restores on resume', async () => {
    const { engine, ctx, run, fake, timers } = setup();
    await engine.unlock();
    engine.setMusic('game');
    await run(1);
    const sch = engine.musicPlayer!.scheduler;
    expect(sch.running).toBe(true);

    const t0 = ctx().currentTime;
    const ms0 = timers.now;
    const p = engine.suspend();
    expect(engine.ready).toBe(false);
    await flushMicrotasks();
    const master = fake<FakeGain>(engine.gains.master);
    expect(master.gain.valueAt(t0 + SUSPEND_FADE)).toBe(0);
    expect(sch.running).toBe(false);
    while (ctx().suspendCalls === 0 && timers.now - ms0 < 200) await run(0.005);
    expect(timers.now - ms0).toBeLessThanOrEqual(100);
    await p;
    expect(ctx().state).toBe('suspended');

    // Idempotent, and SFX are ignored while suspended.
    await engine.suspend();
    expect(ctx().suspendCalls).toBe(1);
    const nodes = ctx().nodes.length;
    engine.play('print');
    expect(ctx().nodes.length).toBe(nodes);

    await engine.resume();
    expect(ctx().state).toBe('running');
    expect(engine.ready).toBe(true);
    const now = ctx().currentTime;
    expect(master.gain.valueAt(now + 0.06)).toBe(1);
    // Music restarts aligned to the next bar, slightly ahead.
    expect(sch.running).toBe(true);
    expect(sch.nextStep % 16).toBe(0);
    expect(sch.stepTime(sch.nextStep)).toBeCloseTo(now + 0.25, 6);
    await engine.resume();
    expect(ctx().resumeCalls).toBe(1);
  });

  it('follows document visibility', async () => {
    const { engine, ctx, run, doc } = setup();
    await engine.unlock();
    doc.setHidden(true);
    expect(engine.ready).toBe(false);
    await run(0.1);
    expect(ctx().state).toBe('suspended');
    doc.setHidden(false);
    await run(0.02);
    expect(ctx().state).toBe('running');
    expect(engine.ready).toBe(true);
  });

  it('a caller suspend (ad) wins over visibility and unlock', async () => {
    const { engine, ctx, run, doc } = setup();
    await engine.unlock();
    const p = engine.suspend();
    await run(0.1);
    await p;
    doc.setHidden(true);
    doc.setHidden(false);
    await run(0.1);
    await engine.unlock();
    expect(ctx().state).toBe('suspended');
    expect(engine.ready).toBe(false);
    expect(ctx().resumeCalls).toBe(0);
    await engine.resume();
    expect(engine.ready).toBe(true);
  });

  it('settles correctly under rapid toggling', async () => {
    const { engine, ctx, run } = setup();
    await engine.unlock();
    engine.setMusic('menu');
    void engine.suspend();
    void engine.resume();
    void engine.suspend();
    const last = engine.resume();
    await run(0.5);
    await last;
    expect(engine.ready).toBe(true);
    expect(ctx().state).toBe('running');
    expect(engine.musicPlayer!.running).toBe(true);
  });

  it('does not create a context while hidden', async () => {
    const { engine, doc, contexts } = setup({ hidden: true });
    await engine.unlock();
    expect(contexts.length).toBe(0);
    doc.setHidden(false);
    await engine.settled();
    await engine.unlock();
    expect(engine.ready).toBe(true);
  });

  it('dispose closes the context, stops timers and unhooks visibility', async () => {
    const { engine, ctx, run, doc, timers } = setup();
    await engine.unlock();
    engine.setMusic('game');
    await run(0.3);
    expect(timers.activeIntervals).toBe(1);
    engine.dispose();
    expect(ctx().closeCalls).toBe(1);
    expect(timers.activeIntervals).toBe(0);
    expect(doc.listenerCount).toBe(0);
    expect(engine.ready).toBe(false);
    engine.play('print');
    await engine.unlock();
    await engine.suspend();
    await engine.resume();
    expect(engine.state).toBe('disposed');
  });
});

describe('music', () => {
  it('schedules notes ahead of the clock, never in the past', async () => {
    const { engine, ctx, run } = setup();
    engine.setMusic('game');
    await engine.unlock();
    await run(4);
    const music = ctx().sources.filter((s) => s instanceof FakeOscillator);
    expect(music.length).toBeGreaterThan(50);
    for (const s of ctx().sources) {
      expect(s.startTime!).toBeGreaterThanOrEqual(s.calledAt - 1e-9);
      expect(s.startTime! - s.calledAt).toBeLessThan(0.26);
    }
  });

  it('intensity adds the machine layer', async () => {
    const count = async (intensity: number) => {
      const { engine, ctx, run } = setup();
      engine.setIntensity(intensity);
      engine.setMusic('game');
      await engine.unlock();
      await run(6);
      return ctx().sources.length;
    };
    const calm = await count(0);
    const busy = await count(1);
    expect(busy).toBeGreaterThan(calm * 1.3);
  });

  it('crossfades game → menu (drums stop) and fades out to off', async () => {
    const { engine, ctx, run, timers } = setup();
    engine.setMusic('game');
    await engine.unlock();
    await run(3);
    const isKick = (s: unknown) =>
      s instanceof FakeOscillator && s.frequency.timeline[0]?.value === 140 && s.type === 'sine';
    expect(ctx().sources.some(isKick)).toBe(true);
    engine.setMusic('menu');
    const tSwitch = ctx().currentTime;
    await run(6);
    expect(ctx().sources.filter((s) => isKick(s) && s.startTime! > tSwitch + 3).length).toBe(0);
    expect(engine.musicPlayer!.running).toBe(true);

    engine.setMusic('off');
    await run(2.5);
    expect(engine.musicPlayer!.running).toBe(false);
    expect(timers.activeIntervals).toBe(0);

    // Fresh start lands on a phrase boundary.
    engine.setMusic('menu');
    const sch = engine.musicPlayer!.scheduler;
    const bar = Math.floor(sch.nextStep / 16);
    expect(engine.musicPlayer!.composer.phraseInfo(bar).start).toBe(bar);
  });
});
