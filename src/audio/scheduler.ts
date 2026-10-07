/**
 * Look-ahead step scheduler ("A Tale of Two Clocks"): a coarse setInterval timer
 * (25 ms) schedules every grid step whose audio-clock time falls within the next
 * 200 ms. Never requestAnimationFrame (stops in background, jitters with frame load).
 *
 * The grid is absolute — time(step) = anchor + step·stepDur (+ swing on odd steps) —
 * so there is no cumulative drift and skipping ahead is O(1).
 *
 * Late wake-ups (main-thread stalls, timer throttling):
 *  - a step that is late by ≤ `lateTolerance` is played immediately (tiny flam);
 *  - a step later than that is dropped, never played in a burst;
 *  - if the cursor is more than `maxLag` behind, it jumps straight to the first step
 *    at/after now, preserving the musical position (bar/beat phase).
 */

import { defaultTimers, type Timers } from './util';

export interface SchedulerOptions {
  /** Seconds per grid step (a 16th note). */
  stepDur: number;
  /** Fraction of a step by which odd steps are delayed (0 = straight, 0.33 ≈ triplet feel). */
  swing?: number;
  /** Seconds scheduled ahead of the audio clock. */
  lookahead?: number;
  /** Timer period, ms. */
  intervalMs?: number;
  /** Max lateness (s) at which a step is still played (at `now`). */
  lateTolerance?: number;
  /** Lag (s) beyond which the cursor skips ahead instead of walking through missed steps. */
  maxLag?: number;
  timers?: Timers;
}

export type StepHandler = (step: number, time: number) => void;

export class StepScheduler {
  readonly stepDur: number;
  readonly swingOffset: number;
  readonly lookahead: number;
  readonly intervalMs: number;
  readonly lateTolerance: number;
  readonly maxLag: number;
  /** Diagnostics: steps that were dropped / skipped because the timer woke up late. */
  dropped = 0;
  skipped = 0;

  private readonly timers: Timers;
  private anchor = 0;
  private cursor = 0;
  private timer: unknown = null;
  private active = false;

  constructor(
    private readonly clock: () => number,
    private readonly onStep: StepHandler,
    opts: SchedulerOptions,
  ) {
    this.stepDur = opts.stepDur;
    this.swingOffset = (opts.swing ?? 0) * opts.stepDur;
    this.lookahead = opts.lookahead ?? 0.2;
    this.intervalMs = opts.intervalMs ?? 25;
    this.lateTolerance = opts.lateTolerance ?? 0.03;
    this.maxLag = opts.maxLag ?? 0.5;
    this.timers = opts.timers ?? defaultTimers;
  }

  get running(): boolean {
    return this.active;
  }

  /** Index of the next step to be scheduled. */
  get nextStep(): number {
    return this.cursor;
  }

  /** Audio-clock time of a grid step (swing applied to odd steps). */
  stepTime(step: number): number {
    return this.anchor + step * this.stepDur + (step % 2 === 1 ? this.swingOffset : 0);
  }

  /** First step of the next bar at/after the cursor. */
  nextBarStep(stepsPerBar = 16): number {
    return Math.ceil(this.cursor / stepsPerBar) * stepsPerBar;
  }

  /** Start (or re-anchor) so that `step` sounds at audio time `time`. Ticks immediately. */
  start(step: number, time: number): void {
    this.cursor = Math.max(0, Math.floor(step));
    this.anchor = time - this.cursor * this.stepDur - (this.cursor % 2 === 1 ? this.swingOffset : 0);
    if (!this.active) {
      this.active = true;
      this.timer = this.timers.setInterval(() => this.tick(), this.intervalMs);
    }
    this.tick();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  /** One scheduler pass (called by the interval; public for tests). */
  tick(): void {
    if (!this.active) return;
    const now = this.clock();
    if (!Number.isFinite(now)) return;

    // Far behind (throttled timer, long stall): jump to the first step at/after now.
    if (now - this.stepTime(this.cursor) > this.maxLag) {
      const target = Math.ceil((now - this.anchor) / this.stepDur);
      if (target > this.cursor) {
        this.skipped += target - this.cursor;
        this.cursor = target;
      }
    }

    const horizon = now + this.lookahead;
    // Bounded loop: a pass can never emit more than lookahead+maxLag worth of steps.
    for (let guard = 0; guard < 256 && this.active; guard++) {
      const t = this.stepTime(this.cursor);
      if (t >= horizon) break;
      const step = this.cursor++;
      if (t < now - this.lateTolerance) {
        this.dropped++;
        continue;
      }
      try {
        this.onStep(step, t < now ? now : t);
      } catch (err) {
        console.error('[audio] scheduler step failed', err);
      }
    }
  }
}
