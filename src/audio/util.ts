/** Small numeric + AudioParam helpers shared by the audio module. */

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Slider position (0..1) → linear gain. Squared curve ≈ perceptually even steps, 0 = true silence. */
export function perceptualGain(v: number): number {
  const x = clamp01(v);
  return x * x;
}

/** Semitones → frequency ratio. */
export function semis(s: number): number {
  return Math.pow(2, s / 12);
}

/** MIDI note → Hz. */
export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * Cancel automation from `t` on and pin the param at its current value, so the next
 * ramp starts where the sound actually is (no jumps → no clicks).
 */
export function holdAt(p: AudioParam, t: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(t);
  } else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

/** Click-free linear ramp from the current value to `target` over `dur` seconds. */
export function rampTo(p: AudioParam, target: number, now: number, dur: number): void {
  holdAt(p, now);
  p.linearRampToValueAtTime(target, now + Math.max(0.001, dur));
}

/** Click-free exponential approach (setTargetAtTime) — used for volume sliders and fades. */
export function glideTo(p: AudioParam, target: number, now: number, tau: number): void {
  holdAt(p, now);
  p.setTargetAtTime(target, now, Math.max(0.001, tau));
}

/** Timer functions, injectable for tests. Handles are opaque. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

type TimerId = ReturnType<typeof setTimeout>;

/** Real timers, resolved at call time (so test fake timers still apply). */
export const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as TimerId),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as TimerId),
};

export function wait(ms: number, timers: Timers): Promise<void> {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms);
  });
}

/**
 * Await a (possibly missing, possibly never-settling) promise for at most `ms`.
 * Never rejects. Used around ctx.resume()/suspend(): Chrome keeps resume() pending
 * until a user gesture, which must not wedge the engine's state machine.
 */
export function settleWithin(
  p: PromiseLike<unknown> | undefined | void,
  ms: number,
  timers: Timers,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      timers.clearTimeout(id);
      resolve();
    };
    const id = timers.setTimeout(finish, ms);
    if (p && typeof p.then === 'function') p.then(finish, finish);
    else finish();
  });
}
