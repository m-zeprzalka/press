import { describe, expect, it } from 'vitest';
import { FakeAudioContext, type FakeGain, type FakeOscillator } from './fakeAudio';
import { STEAL_FADE, stepPitch, TickThrottle, VoicePool } from './voices';

function voice(ctx: FakeAudioContext, pool: VoicePool, now: number, dur: number) {
  const g = ctx.createGain();
  const o = ctx.createOscillator();
  o.start(now);
  o.stop(now + dur);
  pool.begin(now, g as unknown as GainNode, g as unknown as AudioNode);
  pool.track(o as unknown as AudioScheduledSourceNode);
  pool.commit(now + dur);
  return { g, o };
}

describe('VoicePool', () => {
  it('caps polyphony at 16 and steals the oldest voice', () => {
    const ctx = new FakeAudioContext();
    const pool = new VoicePool(16);
    const voices: { g: FakeGain; o: FakeOscillator }[] = [];
    for (let i = 0; i < 20; i++) voices.push(voice(ctx, pool, i * 0.001, 5));
    expect(pool.activeCount(0.02)).toBe(16);
    expect(pool.stolen).toBe(4);
    // Voices 0..3 were stolen: faded out (no click) and stopped shortly after.
    for (let i = 0; i < 4; i++) {
      const { g, o } = voices[i]!;
      const stealAt = (16 + i) * 0.001;
      expect(g.gain.valueAt(stealAt + STEAL_FADE)).toBe(0);
      expect(g.gain.log.some((l) => l.startsWith('hold@'))).toBe(true);
      expect(o.stopTime).toBeCloseTo(stealAt + STEAL_FADE + 0.003, 9);
    }
    // Voices 4..19 untouched.
    for (let i = 4; i < 20; i++) expect(voices[i]!.o.stopTime).toBeCloseTo(i * 0.001 + 5, 9);
  });

  it('reuses finished slots instead of stealing', () => {
    const ctx = new FakeAudioContext();
    const pool = new VoicePool(16);
    for (let i = 0; i < 16; i++) voice(ctx, pool, 0, 0.1);
    const late = voice(ctx, pool, 0.5, 0.1);
    expect(pool.stolen).toBe(0);
    expect(pool.activeCount(0.5)).toBe(1);
    expect(late.o.stopTime).toBeCloseTo(0.6, 9);
  });

  it('disconnects finished voices when pruning', () => {
    const ctx = new FakeAudioContext();
    const pool = new VoicePool(4);
    const a = voice(ctx, pool, 0, 0.1);
    expect(a.g.disconnected).toBe(false);
    pool.activeCount(0.2);
    expect(a.g.disconnected).toBe(true);
  });

  it('stopAll fades and stops everything', () => {
    const ctx = new FakeAudioContext();
    const pool = new VoicePool(16);
    const vs = [voice(ctx, pool, 0, 3), voice(ctx, pool, 0.1, 3)];
    pool.stopAll(1);
    expect(pool.activeCount(1)).toBe(0);
    for (const v of vs) {
      expect(v.o.stopTime).toBeLessThan(1.02);
      expect(v.g.gain.valueAt(1.01)).toBe(0);
    }
  });
});

describe('TickThrottle', () => {
  it('lets through at most 25 ticks per second', () => {
    const th = new TickThrottle(25);
    const accepted: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = i / 100; // a tick request every 10 ms for 3 s
      if (th.allow(t)) accepted.push(t);
    }
    // Any 1 s window holds ≤ 25 accepted ticks.
    for (const start of accepted) {
      const inWindow = accepted.filter((t) => t >= start && t < start + 1).length;
      expect(inWindow).toBeLessThanOrEqual(25);
    }
    expect(accepted.length).toBeGreaterThanOrEqual(60); // still ~20–25/s, not starved
    for (let i = 1; i < accepted.length; i++)
      expect(accepted[i]! - accepted[i - 1]!).toBeGreaterThanOrEqual(0.04 - 1e-12);
  });

  it('allows a tick again after the clock restarts', () => {
    const th = new TickThrottle(25);
    expect(th.allow(10)).toBe(true);
    expect(th.allow(10.01)).toBe(false);
    expect(th.allow(0)).toBe(true);
  });

  it('steps pitch to whole semitones within range', () => {
    expect(stepPitch(2.4)).toBe(2);
    expect(stepPitch(2.6)).toBe(3);
    expect(stepPitch(-40)).toBe(-12);
    expect(stepPitch(99)).toBe(30);
    expect(stepPitch(Number.NaN)).toBe(-12);
  });
});
