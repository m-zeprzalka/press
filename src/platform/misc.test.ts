import { afterEach, describe, expect, it, vi } from 'vitest';
import { analytics, NoopAnalytics, setAnalytics, track } from './analytics';
import { isNative, platformName } from './env';
import { registerServiceWorker } from './pwa';

const core = vi.hoisted(() => ({ native: false, platform: 'web' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => core.native, getPlatform: () => core.platform },
}));
const registerSW = vi.hoisted(() => vi.fn());
vi.mock('virtual:pwa-register', () => ({ registerSW }));

afterEach(() => {
  core.native = false;
  core.platform = 'web';
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('env', () => {
  it('reflects Capacitor', () => {
    expect(isNative()).toBe(false);
    expect(platformName()).toBe('web');
    core.native = true;
    core.platform = 'android';
    expect(isNative()).toBe(true);
    expect(platformName()).toBe('android');
    core.platform = 'electron';
    expect(platformName()).toBe('web');
  });
});

describe('registerServiceWorker', () => {
  it('skips dev builds, Capacitor and browsers without service workers', async () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    expect(await registerServiceWorker()).toBe(false); // vitest is not PROD
    vi.stubEnv('PROD', true);
    core.native = true;
    expect(await registerServiceWorker()).toBe(false);
    core.native = false;
    vi.stubGlobal('navigator', {});
    expect(await registerServiceWorker()).toBe(false);
    expect(registerSW).not.toHaveBeenCalled();
  });

  it('registers with autoUpdate semantics in a production web build', async () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('navigator', { serviceWorker: {} });
    expect(await registerServiceWorker()).toBe(true);
    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }));
  });
});

describe('analytics', () => {
  it('defaults to a no-op and can be swapped', () => {
    expect(analytics()).toBeInstanceOf(NoopAnalytics);
    expect(() => track('run_started', { mode: 'daily' })).not.toThrow();
    const event = vi.fn();
    setAnalytics({ event });
    track('ad_rewarded', { kind: 'reroll' });
    expect(event).toHaveBeenCalledWith('ad_rewarded', { kind: 'reroll' });
    setAnalytics({
      event: () => {
        throw new Error('provider down');
      },
    });
    expect(() => track('x')).not.toThrow();
    setAnalytics(new NoopAnalytics());
  });
});
