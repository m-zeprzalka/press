/**
 * "PRESS" wordmark (GDD §14.4): two riso inks with misregistration.
 * Pink is printed over a blue impression that slipped down-right; the pink pass
 * multiplies over the blue, giving the deep overprint where they meet. The blue
 * plate carries a halftone dot texture. Letters are our own geometry (letters.ts),
 * so the logo renders identically without any font loaded.
 */
import { C, safeUid } from './kit';
import { CAP, advance, letterE, letterP, letterR, letterS, outlinePath, placeLetter } from './letters';

export const LOGO_WIDTH = 600;
export const LOGO_HEIGHT = 180;

const CAP_PX = 124;
const TRACK = -12; // font units between letters
/** Misregistration of the blue plate (user units). */
const MIS_X = 7;
const MIS_Y = 6;

let cached: string | undefined;

/** Path data of the five letters, laid out in the 600×180 box (first-use cached). */
export function logoPath(): string {
  if (cached !== undefined) return cached;
  const s = CAP_PX / CAP;
  const letters = [letterP(), letterR(), letterE(), letterS(), letterS()];
  const first = letters[0]!;
  const last = letters[letters.length - 1]!;
  const inkWidth =
    (letters.reduce((a, l) => a + advance(l), 0) + TRACK * (letters.length - 1) - first.l - last.r) * s;
  let x = (LOGO_WIDTH - inkWidth - MIS_X) / 2 - first.l * s;
  const baseline = (LOGO_HEIGHT - CAP_PX - MIS_Y) / 2 + CAP_PX;
  let d = '';
  for (const l of letters) {
    d += outlinePath(placeLetter(l, x, baseline, s));
    x += (advance(l) + TRACK) * s;
  }
  cached = d;
  return d;
}

export interface LogoOptions {
  /** Single flat colour (`currentColor`), no second ink: for one-colour contexts. */
  mono?: boolean;
  /** Namespaces the pattern id when several logos share a document. */
  uid?: string;
  /** Accessible name; the SVG is `role="img"` with a <title>. */
  title?: string;
}

export function LOGO_SVG(opts: LogoOptions = {}): string {
  const d = logoPath();
  const title = `<title>${opts.title ?? 'PRESS'}</title>`;
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}" ` +
    `width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" role="img">${title}`;
  if (opts.mono) {
    return `${open}<path d="${d}" fill="currentColor" transform="translate(${MIS_X / 2} ${MIS_Y / 2})"/></svg>`;
  }
  const id = `logo-${safeUid(opts.uid)}-ht`;
  const pattern =
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="4.5" height="4.5" patternTransform="rotate(45)">` +
    `<rect width="4.5" height="4.5" fill="${C.blue}"/><circle cx="2.25" cy="2.25" r="1.25" fill="${C.blueDark}"/></pattern>`;
  return (
    `${open}<defs>${pattern}</defs><g style="isolation:isolate">` +
    `<path d="${d}" fill="url(#${id})" transform="translate(${MIS_X} ${MIS_Y})"/>` +
    `<path d="${d}" fill="${C.pink}" style="mix-blend-mode:multiply"/></g></svg>`
  );
}
