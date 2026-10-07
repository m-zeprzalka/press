import { describe, expect, it } from 'vitest';
import { FakeParam, flushMicrotasks, ManualTimers } from './fakeAudio';
import { hash32, Prng } from './prng';
import { clamp, glideTo, mtof, rampTo, semis, settleWithin } from './util';

describe('util', () => {
  it('clamps and converts pitch', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(Number.NaN, -1, 1)).toBe(-1);
    expect(mtof(69)).toBe(440);
    expect(semis(12)).toBeCloseTo(2, 12);
  });

  it('rampTo/glideTo hold the current value first (no jumps)', () => {
    const p = new FakeParam(1);
    p.setValueAtTime(1, 0);
    p.linearRampToValueAtTime(0, 1);
    rampTo(p as unknown as AudioParam, 1, 0.5, 0.1);
    expect(p.valueAt(0.5)).toBeCloseTo(0.5, 9); // held where the old ramp was
    expect(p.valueAt(0.6)).toBeCloseTo(1, 9);
    glideTo(p as unknown as AudioParam, 0, 0.7, 0.05);
    expect(p.valueAt(0.7)).toBeCloseTo(1, 9);
    expect(p.valueAt(1.2)).toBeLessThan(0.001);
  });

  it('settleWithin never hangs and never rejects', async () => {
    const timers = new ManualTimers();
    let done = 0;
    void settleWithin(new Promise(() => undefined), 300, timers).then(() => done++);
    void settleWithin(Promise.reject(new Error('x')), 300, timers).then(() => done++);
    void settleWithin(undefined, 300, timers).then(() => done++);
    await flushMicrotasks();
    expect(done).toBe(2);
    timers.advance(300);
    await flushMicrotasks();
    expect(done).toBe(3);
  });
});

describe('prng', () => {
  it('is deterministic, reseedable and in [0, 1)', () => {
    const a = new Prng(5);
    const b = new Prng(5);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    a.reseed(5);
    expect(a.next()).toBe(xs[0]);
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(1, 2, 4));
  });
});
