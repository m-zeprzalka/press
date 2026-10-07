/**
 * Render-on-demand loop (GDD §18.2): requestAnimationFrame runs only while something animates
 * (tweens, particles, drag) or a redraw was requested; the loop stops ~500 ms after going idle.
 */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  inQuad: (t: number) => t * t,
} satisfies Record<string, Ease>;

interface Tween {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  duration: number;
  delay: number;
  elapsed: number;
  ease: Ease;
  resolve: () => void;
  onUpdate?: (t: number) => void;
  key: object | undefined;
}

export type Updater = (dtMs: number) => boolean | void;

let reported = false;
/** A broken animation is dropped, not fatal; log the first one so it is not invisible in dev. */
function reportOnce(err: unknown): void {
  if (reported) return;
  reported = true;
  console.warn('[animator] dropped a failing animation', err);
}

export class Animator {
  private tweens: Tween[] = [];
  private updaters = new Set<Updater>();
  private raf = 0;
  private last = 0;
  private idleSince = 0;
  private dirty = true;
  private holds = 0;
  /** True while frame() runs: requests made during a frame must not schedule a second rAF. */
  private inFrame = false;
  /** Frame time samples (ms) for the debug overlay / perf test. */
  readonly frameTimes: number[] = [];

  constructor(private readonly render: () => void) {}

  /** Request at least one redraw. */
  request(): void {
    this.dirty = true;
    this.start();
  }

  /** Keep the loop alive while held (e.g. during a drag). Returns a release function. */
  hold(): () => void {
    this.holds++;
    this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      this.request();
    };
  }

  add(updater: Updater): () => void {
    this.updaters.add(updater);
    this.start();
    return () => this.updaters.delete(updater);
  }

  tween<T extends object>(
    target: T,
    to: Record<string, number>,
    duration: number,
    opts: { ease?: Ease; delay?: number; onUpdate?: (t: number) => void; key?: object } = {},
  ): Promise<void> {
    const t = target as unknown as Record<string, number>;
    if (opts.key) this.cancel(opts.key);
    const from: Record<string, number> = {};
    for (const k of Object.keys(to)) from[k] = t[k] ?? 0;
    return new Promise((resolve) => {
      if (duration <= 0 && !opts.delay) {
        for (const [k, v] of Object.entries(to)) t[k] = v as number;
        opts.onUpdate?.(1);
        this.request();
        resolve();
        return;
      }
      this.tweens.push({
        target: t,
        from,
        to,
        duration: Math.max(1, duration),
        delay: opts.delay ?? 0,
        elapsed: 0,
        ease: opts.ease ?? ease.outCubic,
        resolve,
        onUpdate: opts.onUpdate,
        key: opts.key,
      });
      this.start();
    });
  }

  /** Cancels tweens with this key, jumping them to their end values. */
  cancel(key: object): void {
    const keep: Tween[] = [];
    for (const tw of this.tweens) {
      if (tw.key === key) {
        if ((tw.target as { destroyed?: boolean }).destroyed !== true)
          for (const [k, v] of Object.entries(tw.to)) tw.target[k] = v;
        tw.onUpdate?.(1);
        tw.resolve();
      } else keep.push(tw);
    }
    this.tweens = keep;
  }

  /** Completes every running tween immediately. */
  finishAll(): void {
    const all = this.tweens;
    this.tweens = [];
    for (const tw of all) {
      if ((tw.target as { destroyed?: boolean }).destroyed !== true)
        for (const [k, v] of Object.entries(tw.to)) tw.target[k] = v;
      tw.onUpdate?.(1);
      tw.resolve();
    }
    this.request();
  }

  wait(ms: number): Promise<void> {
    const dummy = { v: 0 };
    return this.tween(dummy, { v: 1 }, 1, { delay: ms });
  }

  get busy(): boolean {
    return this.tweens.length > 0 || this.updaters.size > 0 || this.holds > 0;
  }

  private start(): void {
    if (this.raf || this.inFrame || typeof requestAnimationFrame === 'undefined') return;
    this.last = performance.now();
    this.idleSince = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.inFrame = true;
    try {
      this.step(now);
    } finally {
      // Never leave the loop wedged: an exception in one frame must not stop all rendering.
      this.inFrame = false;
      this.raf = 0;
      // Keep rendering briefly after going idle (late redraw requests), then sleep.
      if (this.busy || this.dirty || now - this.idleSince < 500) {
        this.raf = requestAnimationFrame(this.frame);
      }
    }
  };

  private step(now: number): void {
    const dt = Math.min(50, Math.max(0, now - this.last));
    this.last = now;
    const t0 = performance.now();

    // Tweens
    if (this.tweens.length) {
      const done: Tween[] = [];
      for (const tw of this.tweens) {
        // Display objects destroyed mid-tween (screen change, relayout) are dropped silently.
        if ((tw.target as { destroyed?: boolean }).destroyed === true) {
          done.push(tw);
          continue;
        }
        if (tw.delay > 0) {
          tw.delay -= dt;
          if (tw.delay > 0) continue;
        }
        tw.elapsed += dt;
        const p = Math.min(1, tw.elapsed / tw.duration);
        const e = tw.ease(p);
        try {
          for (const k of Object.keys(tw.to)) {
            tw.target[k] = (tw.from[k] as number) + ((tw.to[k] as number) - (tw.from[k] as number)) * e;
          }
          tw.onUpdate?.(p);
        } catch (err) {
          reportOnce(err);
          done.push(tw);
          continue;
        }
        if (p >= 1) done.push(tw);
      }
      if (done.length) {
        this.tweens = this.tweens.filter((tw) => !done.includes(tw));
        for (const tw of done) tw.resolve();
      }
    }
    for (const u of [...this.updaters]) {
      try {
        if (u(dt) === false) this.updaters.delete(u);
      } catch (err) {
        reportOnce(err);
        this.updaters.delete(u);
      }
    }

    this.render();
    this.dirty = false;
    const frameMs = performance.now() - t0;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 600) this.frameTimes.shift();

    if (this.busy) {
      this.idleSince = 0;
    } else if (!this.idleSince) {
      this.idleSince = now;
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.tweens = [];
    this.updaters.clear();
  }
}
