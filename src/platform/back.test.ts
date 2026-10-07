import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackRouter } from './back';

const app = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    addListener: vi.fn(async (ev: string, cb: () => void) => {
      listeners.set(ev, cb);
      return { remove: vi.fn(async () => listeners.delete(ev)) };
    }),
    minimizeApp: vi.fn(async () => undefined),
    exitApp: vi.fn(async () => undefined),
  };
});
vi.mock('@capacitor/app', () => ({ App: app }));

beforeEach(() => {
  app.listeners.clear();
  vi.clearAllMocks();
});

describe('BackRouter', () => {
  it('routes LIFO: the top handler consumes back, pop removes it', () => {
    const r = createBackRouter({ native: true });
    const log: string[] = [];
    const popA = r.push(() => void log.push('A'));
    const popB = r.push(() => void log.push('B'));
    expect(r.depth).toBe(2);
    expect(r.handleBack()).toBe(true);
    expect(log).toEqual(['B']);
    popB();
    popB(); // idempotent
    r.handleBack();
    expect(log).toEqual(['B', 'A']);
    popA();
    expect(r.depth).toBe(0);
  });

  it('pop removes a handler that is not on top', () => {
    const r = createBackRouter({ native: true });
    const log: string[] = [];
    const popA = r.push(() => void log.push('A'));
    r.push(() => void log.push('B'));
    popA();
    r.handleBack();
    r.handleBack();
    expect(log).toEqual(['B', 'B']);
  });

  it('a handler returning false passes back down the stack', () => {
    const r = createBackRouter({ native: true });
    const log: string[] = [];
    r.push(() => {
      log.push('screen');
      return true;
    });
    r.push(() => {
      log.push('busy-overlay');
      return false;
    });
    r.handleBack();
    expect(log).toEqual(['busy-overlay', 'screen']);
  });

  it('root back minimizes on native (never exits)', () => {
    const r = createBackRouter({ native: true });
    expect(r.handleBack()).toBe(false);
    expect(app.minimizeApp).toHaveBeenCalledTimes(1);
    expect(app.exitApp).not.toHaveBeenCalled();
    const declined = createBackRouter({ native: true });
    declined.push(() => false);
    declined.handleBack();
    expect(app.minimizeApp).toHaveBeenCalledTimes(2);
  });

  it('root back is a no-op on the web and can be overridden', () => {
    const r = createBackRouter({ native: false, keyTarget: null });
    expect(() => r.handleBack()).not.toThrow();
    expect(app.minimizeApp).not.toHaveBeenCalled();
    const root = vi.fn();
    r.onRootBack = root;
    r.handleBack();
    expect(root).toHaveBeenCalledTimes(1);
  });

  it('ignores back while an ad is showing', () => {
    const r = createBackRouter({ native: true });
    const handler = vi.fn();
    r.push(handler);
    r.setAdShowing(true);
    expect(r.adShowing).toBe(true);
    expect(r.handleBack()).toBe(false);
    r.setAdShowing(false);
    r.handleBack();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  it('wires @capacitor/app backButton on native', async () => {
    const r = createBackRouter({ native: true });
    const handler = vi.fn();
    r.push(handler);
    await r.start();
    expect(app.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    app.listeners.get('backButton')?.();
    expect(handler).toHaveBeenCalledTimes(1);
    r.dispose();
    await new Promise((res) => setTimeout(res, 0));
    expect(app.listeners.has('backButton')).toBe(false);
  });

  it('maps Escape to back on the web', async () => {
    const target = new EventTarget();
    const r = createBackRouter({ native: false, keyTarget: target as unknown as Window });
    const handler = vi.fn();
    r.push(handler);
    await r.start();
    const esc = (init: Partial<KeyboardEvent>): Event =>
      Object.assign(new Event('keydown', { cancelable: true }), init);
    target.dispatchEvent(esc({ key: 'Escape' }));
    target.dispatchEvent(esc({ key: 'Escape', repeat: true }));
    target.dispatchEvent(esc({ key: 'Enter' }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(app.addListener).not.toHaveBeenCalled();
    r.dispose();
    target.dispatchEvent(esc({ key: 'Escape' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a throwing handler still consumes the event', () => {
    const r = createBackRouter({ native: true });
    r.push(() => {
      throw new Error('bug');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(r.handleBack()).toBe(true);
    expect(app.minimizeApp).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
