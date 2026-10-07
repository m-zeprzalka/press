// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { applyInsetCssVars, insetExpression, readInsets, watchInsets, ZERO_INSETS } from './insets';

describe('insets', () => {
  it('builds the max(var, env) expression and sets --sa-* on :root', () => {
    expect(insetExpression('top')).toBe(
      'max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))',
    );
    applyInsetCssVars();
    const root = document.documentElement.style;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(root.getPropertyValue(`--sa-${side}`)).toContain(`safe-area-inset-${side}`);
    }
    expect(() => applyInsetCssVars(null)).not.toThrow();
  });

  it('measures through a probe and reports numbers (jsdom cannot resolve env() → 0)', () => {
    expect(readInsets()).toEqual(ZERO_INSETS);
    expect(document.querySelector('[data-press-insets-probe]')).toBeNull();
  });

  it('reads computed padding in px', () => {
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingTop: '24px',
      paddingRight: '0px',
      paddingBottom: '16.5px',
      paddingLeft: 'garbage',
    } as CSSStyleDeclaration);
    expect(readInsets()).toEqual({ top: 24, right: 0, bottom: 16.5, left: 0 });
    spy.mockRestore();
  });

  it('watchInsets reports immediately, again on change, and cleans up', async () => {
    let top = '10px';
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          paddingTop: top,
          paddingRight: '0',
          paddingBottom: '0',
          paddingLeft: '0',
        }) as CSSStyleDeclaration,
    );
    const cb = vi.fn();
    const stop = watchInsets(cb);
    expect(cb).toHaveBeenLastCalledWith({ top: 10, right: 0, bottom: 0, left: 0 });
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 40));
    expect(cb).toHaveBeenCalledTimes(1); // unchanged values are not re-reported
    top = '30px';
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 40));
    expect(cb).toHaveBeenLastCalledWith({ top: 30, right: 0, bottom: 0, left: 0 });
    stop();
    expect(document.querySelector('[data-press-insets-probe]')).toBeNull();
    top = '50px';
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 40));
    expect(cb).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('is web-safe without a DOM', () => {
    const cb = vi.fn();
    const stop = watchInsets(cb, null);
    expect(cb).toHaveBeenCalledWith(ZERO_INSETS);
    expect(() => stop()).not.toThrow();
    expect(readInsets(null)).toEqual(ZERO_INSETS);
  });
});
