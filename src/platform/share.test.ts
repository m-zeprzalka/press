import { describe, expect, it, vi } from 'vitest';
import { copyText, shareText } from './share';

const cap = vi.hoisted(() => ({ share: vi.fn(async (_o: unknown) => ({})) }));
vi.mock('@capacitor/share', () => ({ Share: cap }));

describe('shareText', () => {
  it('native: uses @capacitor/share', async () => {
    expect(await shareText('PRESS #12 🟥🟦', 'PRESS', { native: true, nav: null })).toBe('shared');
    expect(cap.share).toHaveBeenCalledWith({ text: 'PRESS #12 🟥🟦', title: 'PRESS', dialogTitle: 'PRESS' });
  });

  it('native: cancel is silent (no clipboard fallback); other errors fall back to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    cap.share.mockRejectedValueOnce(new Error('Share canceled'));
    expect(
      await shareText('x', undefined, {
        native: true,
        nav: { clipboard: { writeText } as unknown as Clipboard },
      }),
    ).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
    cap.share.mockRejectedValueOnce(new Error("Can't share while sharing is in progress"));
    expect(
      await shareText('x', undefined, {
        native: true,
        nav: { clipboard: { writeText } as unknown as Clipboard },
      }),
    ).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('x');
  });

  it('web: navigator.share, AbortError = cancelled, unsupported → clipboard', async () => {
    const share = vi.fn(async () => undefined);
    expect(await shareText('t', 'T', { native: false, nav: { share } })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 't', title: 'T' });
    const abort = vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })));
    expect(await shareText('t', undefined, { native: false, nav: { share: abort } })).toBe('cancelled');
    const writeText = vi.fn(async () => undefined);
    const denied = vi.fn(async () =>
      Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
    );
    expect(
      await shareText('t', undefined, {
        native: false,
        nav: { share: denied, clipboard: { writeText } as unknown as Clipboard },
      }),
    ).toBe('copied');
    expect(
      await shareText('t', undefined, {
        native: false,
        nav: { clipboard: { writeText } as unknown as Clipboard },
      }),
    ).toBe('copied');
  });

  it('failed when nothing works', async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error('denied')));
    expect(
      await shareText('t', undefined, {
        native: false,
        nav: { clipboard: { writeText } as unknown as Clipboard },
        doc: null,
      }),
    ).toBe('failed');
    expect(await copyText('t', { nav: null, doc: null })).toBe(false);
  });
});
