/**
 * Share text (daily-challenge card, GDD §10.1): native share sheet on Android, Web Share API
 * in the browser, clipboard as the fallback.
 *
 * Result 'cancelled' (user closed the sheet) is an addition to 'shared' | 'copied' | 'failed':
 * nothing should be shown for it, and it must not fall back to copying.
 */
import { Share } from '@capacitor/share';
import { browser, isNative } from './env';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareOptions {
  native?: boolean;
  share?: Pick<typeof Share, 'share'>;
  nav?: Partial<Pick<Navigator, 'share' | 'clipboard'>> | null;
  doc?: Document | null;
}

const isCancel = (e: unknown): boolean => {
  const err = e as { name?: unknown; message?: unknown } | null;
  if (err && err.name === 'AbortError') return true;
  const msg = typeof err?.message === 'string' ? err.message : typeof e === 'string' ? e : '';
  return /cancel/i.test(msg);
};

/** Clipboard API, then the legacy execCommand('copy') path (older WebViews, non-secure origins). */
export async function copyText(text: string, opts: Pick<ShareOptions, 'nav' | 'doc'> = {}): Promise<boolean> {
  const nav = opts.nav === undefined ? browser.navigator : opts.nav;
  try {
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const doc = opts.doc === undefined ? browser.document : opts.doc;
  if (!doc?.body) return false;
  try {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    doc.body.appendChild(ta);
    ta.select();
    const ok = typeof doc.execCommand === 'function' && doc.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function shareText(text: string, title?: string, opts: ShareOptions = {}): Promise<ShareResult> {
  const native = opts.native ?? isNative();
  const nav = opts.nav === undefined ? browser.navigator : opts.nav;
  if (native) {
    try {
      const share = opts.share ?? Share;
      await share.share(title ? { text, title, dialogTitle: title } : { text });
      return 'shared';
    } catch (e) {
      if (isCancel(e)) return 'cancelled';
    }
  } else if (nav && typeof nav.share === 'function') {
    try {
      await nav.share(title ? { text, title } : { text });
      return 'shared';
    } catch (e) {
      if (isCancel(e)) return 'cancelled';
    }
  }
  return (await copyText(text, opts)) ? 'copied' : 'failed';
}
