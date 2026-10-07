import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HapticsModule from '@capacitor/haptics';
import { createHaptics, SELECTION_THROTTLE_MS, WEB_PATTERNS } from './haptics';

const cap = vi.hoisted(() => ({
  impact: vi.fn(async (_o: unknown) => undefined),
  notification: vi.fn(async (_o: unknown) => undefined),
  selectionStart: vi.fn(async () => undefined),
  selectionChanged: vi.fn(async () => undefined),
}));
vi.mock('@capacitor/haptics', async (importOriginal) => ({
  ...(await importOriginal<typeof HapticsModule>()),
  Haptics: cap,
}));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const fn of Object.values(cap)) fn.mockClear();
});

describe('haptics (native)', () => {
  it('maps kinds to plugin styles/types', () => {
    const h = createHaptics({ native: true });
    h.impact('light');
    h.impact('heavy');
    h.notify('success');
    h.notify('error');
    expect(cap.impact.mock.calls).toEqual([[{ style: 'LIGHT' }], [{ style: 'HEAVY' }]]);
    expect(cap.notification.mock.calls).toEqual([[{ type: 'SUCCESS' }], [{ type: 'ERROR' }]]);
  });

  it('starts the selection once (native selectionChanged is a no-op otherwise) and throttles to 40 ms', async () => {
    let t = 1000;
    const h = createHaptics({ native: true, now: () => t });
    h.selection();
    await flush();
    h.selection(); // same instant → dropped
    t += SELECTION_THROTTLE_MS - 1;
    h.selection(); // 39 ms → dropped
    t += 1;
    h.selection(); // 40 ms → fires
    await flush();
    expect(cap.selectionStart).toHaveBeenCalledTimes(1);
    expect(cap.selectionChanged).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when disabled and never throws on plugin failure', async () => {
    const h = createHaptics({ native: true });
    h.setEnabled(false);
    expect(h.enabled).toBe(false);
    h.impact('medium');
    h.notify('warning');
    h.selection();
    expect(cap.impact).not.toHaveBeenCalled();
    expect(cap.notification).not.toHaveBeenCalled();
    h.setEnabled(true);
    cap.impact.mockRejectedValueOnce(new Error('no vibrator'));
    cap.notification.mockImplementationOnce(() => {
      throw new Error('sync boom');
    });
    expect(() => h.impact('medium')).not.toThrow();
    expect(() => h.notify('warning')).not.toThrow();
    await flush();
  });
});

describe('haptics (web)', () => {
  it('uses short vibrate patterns', () => {
    const vibrate = vi.fn();
    const h = createHaptics({ native: false, vibrate, now: () => 0 });
    h.impact('light');
    h.notify('error');
    h.selection();
    expect(vibrate.mock.calls).toEqual([
      [[...WEB_PATTERNS.light]],
      [[...WEB_PATTERNS.error]],
      [[...WEB_PATTERNS.selection]],
    ]);
    expect(cap.impact).not.toHaveBeenCalled();
    for (const p of Object.values(WEB_PATTERNS))
      expect(p.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
  });

  it('is safe without navigator.vibrate or with a throwing one', () => {
    expect(() => createHaptics({ native: false }).impact('heavy')).not.toThrow();
    const h = createHaptics({
      native: false,
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => h.notify('success')).not.toThrow();
  });
});
