import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLifecycle, SESSION_GAP_MS } from './lifecycle';
import { createMemoryStore } from './storage';

const app = vi.hoisted(() => {
  const listeners = new Map<string, (s: { isActive: boolean }) => void>();
  return {
    listeners,
    addListener: vi.fn(async (ev: string, cb: (s: { isActive: boolean }) => void) => {
      listeners.set(ev, cb);
      return { remove: vi.fn(async () => listeners.delete(ev)) };
    }),
  };
});
vi.mock('@capacitor/app', () => ({ App: app }));

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  set(v: DocumentVisibilityState): void {
    this.visibilityState = v;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function setup(kv = createMemoryStore()) {
  let t = 1_000_000;
  const doc = new FakeDoc();
  const win = new EventTarget();
  const lc = createLifecycle({
    kv,
    native: true,
    now: () => t,
    doc: doc as unknown as Document,
    win: win as unknown as Window,
  });
  const log: string[] = [];
  lc.onPause(() => log.push('pause'));
  lc.onResume((i) => log.push(`resume:${i.backgroundMs}:${i.newSession}`));
  lc.onSessionStart((i) => log.push(`session:${i}`));
  const appState = (isActive: boolean): void => app.listeners.get('appStateChange')?.({ isActive });
  return { lc, doc, win, kv, log, appState, advance: (ms: number) => (t += ms) };
}

beforeEach(() => {
  app.listeners.clear();
  app.addListener.mockClear();
});

describe('session index', () => {
  it('starts at 1 and increments on every cold start (persisted under press.session)', async () => {
    const kv = createMemoryStore();
    const a = setup(kv);
    expect(a.lc.sessionIndex).toBe(0);
    expect(await a.lc.start()).toBe(1);
    expect(a.lc.isFirstSession).toBe(true);
    expect(a.log).toEqual(['session:1']);
    expect(JSON.parse(kv.data.get('press.session') as string).index).toBe(1);
    const b = setup(kv);
    expect(await b.lc.start()).toBe(2);
    expect(b.lc.isFirstSession).toBe(false);
    expect(await b.lc.start()).toBe(2); // idempotent
  });

  it('treats a corrupt counter as no history', async () => {
    const kv = createMemoryStore({ 'press.session': '{"index":"x"' });
    expect(await setup(kv).lc.start()).toBe(1);
    const neg = createMemoryStore({ 'press.session': '{"index":-4}' });
    expect(await setup(neg).lc.start()).toBe(1);
  });

  it('a return after > 30 min in the background starts a new session; shorter does not', async () => {
    const s = setup();
    await s.lc.start();
    s.appState(false);
    s.advance(SESSION_GAP_MS);
    s.appState(true);
    expect(s.lc.sessionIndex).toBe(1);
    s.appState(false);
    s.advance(SESSION_GAP_MS + 1);
    s.appState(true);
    expect(s.lc.sessionIndex).toBe(2);
    expect(s.log).toEqual([
      'session:1',
      'pause',
      `resume:${SESSION_GAP_MS}:false`,
      'pause',
      `resume:${SESSION_GAP_MS + 1}:true`,
      'session:2',
    ]);
    expect(JSON.parse(s.kv.data.get('press.session') as string).index).toBe(2);
  });
});

describe('pause / resume', () => {
  it('folds duplicate sources (appStateChange + visibilitychange + pagehide)', async () => {
    const s = setup();
    await s.lc.start();
    s.appState(false);
    s.doc.set('hidden');
    s.win.dispatchEvent(new Event('pagehide'));
    expect(s.lc.active).toBe(false);
    s.advance(500);
    s.doc.set('visible');
    s.appState(true);
    s.win.dispatchEvent(new Event('pageshow'));
    expect(s.log).toEqual(['session:1', 'pause', 'resume:500:false']);
  });

  it('suppresses transitions while an ad is showing; ad time never counts as background', async () => {
    const s = setup();
    await s.lc.start();
    s.lc.setAdShowing(true);
    s.appState(false); // ad activity covers the WebView
    s.advance(SESSION_GAP_MS * 2); // user wandered off mid-ad
    s.lc.setAdShowing(false);
    s.appState(true); // late resume after the ad closed → dropped (no pause was emitted)
    expect(s.log).toEqual(['session:1']);
    expect(s.lc.sessionIndex).toBe(1);
    expect(s.lc.active).toBe(true);
    // normal transitions work again afterwards
    s.appState(false);
    s.appState(true);
    expect(s.log).toEqual(['session:1', 'pause', 'resume:0:false']);
  });

  it('catches up when the app is really hidden as the ad flag drops', async () => {
    const s = setup();
    await s.lc.start();
    s.lc.setAdShowing(true);
    s.doc.visibilityState = 'hidden';
    s.lc.setAdShowing(false);
    expect(s.log).toEqual(['session:1', 'pause']);
  });

  it('a throwing listener does not block others; dispose detaches everything', async () => {
    const s = setup();
    s.lc.onPause(() => {
      throw new Error('bad listener');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await s.lc.start();
    s.appState(false);
    expect(s.log).toContain('pause');
    spy.mockRestore();
    s.lc.dispose();
    s.appState(true);
    s.doc.set('visible');
    expect(s.log.filter((l) => l.startsWith('resume'))).toEqual([]);
  });

  it('web: no Capacitor listener, visibility only', async () => {
    const doc = new FakeDoc();
    const lc = createLifecycle({
      kv: createMemoryStore(),
      native: false,
      doc: doc as unknown as Document,
      win: null,
    });
    const log: string[] = [];
    lc.onPause(() => log.push('pause'));
    lc.onResume(() => log.push('resume'));
    await lc.start();
    expect(app.addListener).not.toHaveBeenCalled();
    doc.set('hidden');
    doc.set('visible');
    expect(log).toEqual(['pause', 'resume']);
  });
});
