import { describe, expect, it } from 'vitest';
import { ManualTimers } from './fakeAudio';
import { StepScheduler } from './scheduler';

const STEP = 60 / 92 / 4;

function setup(swing = 0) {
  const clock = { t: 0 };
  const timers = new ManualTimers();
  const emitted: { step: number; time: number; at: number }[] = [];
  const s = new StepScheduler(
    () => clock.t,
    (step, time) => emitted.push({ step, time, at: clock.t }),
    { stepDur: STEP, swing, lookahead: 0.2, intervalMs: 25, timers },
  );
  /** Advance the audio clock and the timer together in 5 ms slices. */
  const run = (seconds: number) => {
    const slices = Math.round(seconds / 0.005);
    for (let i = 0; i < slices; i++) {
      clock.t += 0.005;
      timers.advance(5);
    }
  };
  return { clock, timers, emitted, s, run };
}

describe('StepScheduler', () => {
  it('uses a 25 ms setInterval and schedules up to 200 ms ahead', () => {
    const { s, timers, emitted, clock } = setup();
    s.start(0, 0.1);
    expect(timers.intervalsCreated).toEqual([25]);
    // Immediately on start: only step 0 (t = 0.1) is inside the 200 ms window.
    expect(emitted.map((e) => e.step)).toEqual([0]);
    expect(emitted[0]?.time).toBeCloseTo(0.1, 9);
    expect(clock.t).toBe(0);
  });

  it('emits every step exactly once, in order, always ahead of the clock', () => {
    const { s, emitted, run } = setup();
    s.start(0, 0.05);
    run(10);
    const steps = emitted.map((e) => e.step);
    expect(steps.length).toBeGreaterThan(55);
    steps.forEach((step, i) => expect(step).toBe(i)); // no gaps, no duplicates
    for (const e of emitted) {
      expect(e.time).toBeGreaterThanOrEqual(e.at); // never in the past
      expect(e.time - e.at).toBeLessThan(0.2 + 1e-9); // within the look-ahead window
      expect(e.time).toBeCloseTo(0.05 + e.step * STEP, 9); // absolute grid, no drift
    }
    expect(s.dropped).toBe(0);
    expect(s.skipped).toBe(0);
  });

  it('applies swing to odd steps only', () => {
    const { s, emitted, run } = setup(0.2);
    s.start(0, 0.05);
    run(2);
    for (const e of emitted) {
      const straight = 0.05 + e.step * STEP;
      expect(e.time - straight).toBeCloseTo(e.step % 2 === 1 ? 0.2 * STEP : 0, 9);
    }
  });

  it('skips ahead (no burst) when the timer was throttled for > 0.5 s', () => {
    const { s, emitted, run, clock, timers } = setup();
    s.start(0, 0.05);
    run(1);
    const before = emitted.length;
    const lastStep = emitted[before - 1]!.step;
    // Background throttling: the clock runs 2 s while no timer fires.
    clock.t += 2;
    timers.now += 2000;
    s.tick();
    const burst = emitted.slice(before);
    expect(burst.length).toBeLessThanOrEqual(Math.ceil(0.2 / STEP) + 1);
    for (const e of burst) {
      expect(e.time).toBeGreaterThanOrEqual(clock.t);
      expect(e.time).toBeCloseTo(0.05 + e.step * STEP, 9); // still on the original grid (phase kept)
    }
    expect(s.skipped).toBeGreaterThan(10);
    expect(s.nextStep).toBeGreaterThan(lastStep + 10);
    // And it continues normally afterwards.
    run(1);
    const after = emitted.slice(before).map((e) => e.step);
    after.forEach((step, i) => i > 0 && expect(step).toBe(after[i - 1]! + 1));
  });

  it('drops (does not burst) steps missed by a shorter stall', () => {
    const { s, emitted, run, clock, timers } = setup();
    s.start(0, 0.05);
    run(1);
    const before = emitted.length;
    clock.t += 0.45; // main thread blocked 450 ms (< maxLag: walk + drop, no skip)
    timers.now += 450;
    s.tick();
    const burst = emitted.slice(before);
    expect(s.dropped).toBeGreaterThan(0);
    expect(burst.length).toBeLessThanOrEqual(Math.ceil(0.2 / STEP) + 1);
    for (const e of burst) expect(e.time).toBeGreaterThanOrEqual(clock.t);
  });

  it('plays a slightly late step immediately rather than in the past', () => {
    const { s, emitted, clock } = setup();
    s.start(0, 0); // emits steps 0 and 1
    emitted.length = 0;
    clock.t = s.stepTime(2) + 0.01; // the timer woke 10 ms after step 2 was due
    s.tick();
    expect(emitted[0]?.step).toBe(2);
    expect(emitted[0]?.time).toBe(clock.t);
    for (const e of emitted) expect(e.time).toBeGreaterThanOrEqual(clock.t);
    expect(s.dropped).toBe(0);
  });

  it('stops and restarts aligned to the next bar', () => {
    const { s, emitted, run, timers, clock } = setup();
    s.start(0, 0.05);
    run(1.3);
    s.stop();
    expect(s.running).toBe(false);
    expect(timers.activeIntervals).toBe(0);
    const n = emitted.length;
    run(1);
    expect(emitted.length).toBe(n);
    const bar = s.nextBarStep();
    expect(bar % 16).toBe(0);
    expect(bar).toBeGreaterThanOrEqual(s.nextStep);
    s.start(bar, clock.t + 0.25);
    run(0.5);
    const resumed = emitted.slice(n);
    expect(resumed[0]?.step).toBe(bar);
    expect(resumed[0]?.time).toBeCloseTo(clock.t - 0.5 + 0.25, 6);
  });

  it('survives a throwing step handler', () => {
    const clock = { t: 0 };
    const timers = new ManualTimers();
    let calls = 0;
    const s = new StepScheduler(
      () => clock.t,
      () => {
        calls++;
        throw new Error('boom');
      },
      { stepDur: STEP, timers },
    );
    const err = console.error;
    console.error = () => undefined;
    try {
      s.start(0, 0);
      for (let i = 0; i < 40; i++) {
        clock.t += 0.025;
        timers.advance(25);
      }
    } finally {
      console.error = err;
    }
    expect(calls).toBeGreaterThan(3);
    expect(s.nextStep).toBeGreaterThan(5);
  });
});
