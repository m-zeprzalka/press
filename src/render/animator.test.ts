import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Animator } from './animator';

/** Manual rAF: frames run only when the test calls `tick`. */
let queue: Array<(t: number) => void> = [];
let now = 0;
const tick = (ms = 16) => {
  now += ms;
  const run = queue;
  queue = [];
  for (const cb of run) cb(now);
};

beforeEach(() => {
  queue = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Animator', () => {
  it('schedules at most one frame, even when work is requested during a frame', () => {
    const a = new Animator(() => {
      a.request(); // a render that asks for another redraw
    });
    a.request();
    a.request();
    expect(queue).toHaveLength(1);
    tick();
    expect(queue).toHaveLength(1);
    tick();
    expect(queue).toHaveLength(1);
  });

  it('tweens to the target and resolves', async () => {
    const a = new Animator(() => {});
    const o = { x: 0 };
    const done = a.tween(o, { x: 10 }, 100, { ease: (t) => t });
    tick(50);
    expect(o.x).toBeCloseTo(5, 5);
    tick(50);
    expect(o.x).toBe(10);
    await done;
  });

  it('drops tweens on destroyed display objects instead of throwing', async () => {
    const a = new Animator(() => {});
    const sprite = { x: 0, destroyed: false };
    const done = a.tween(sprite, { x: 10 }, 100);
    tick();
    sprite.destroyed = true;
    tick();
    await done;
    expect(a.busy).toBe(false);
  });

  it('keeps the loop alive when a tween or updater throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let renders = 0;
    const a = new Animator(() => renders++);
    const bad = Object.defineProperty({}, 'x', {
      get: () => 0,
      set: () => {
        throw new TypeError('boom');
      },
    });
    const failed = a.tween(bad, { x: 1 }, 100);
    a.add(() => {
      throw new Error('updater boom');
    });
    tick();
    await failed;
    const ok = { y: 0 };
    const p = a.tween(ok, { y: 1 }, 32);
    tick();
    tick();
    tick();
    await p;
    expect(ok.y).toBe(1);
    expect(renders).toBeGreaterThan(2);
    expect(queue.length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });

  it('sleeps after ~500 ms idle', () => {
    const a = new Animator(() => {});
    a.request();
    for (let i = 0; i < 40; i++) tick(16);
    expect(queue).toHaveLength(0);
  });
});
