/**
 * App icon (GDD §14.4): a chunky type-sort block printed in fluo pink with a big
 * ink "P", over a blue impression that slipped down-right, on paper.
 *
 * Everything is authored on the 108×108 adaptive-icon grid (1 unit = 1 dp):
 * the art stays inside the central 66 dp safe circle (radius 33 around 54,54).
 * The full-square and maskable variants scale the same art up around the centre.
 */
import { C } from './kit';

const f = (v: number): string => String(Math.round(v * 100) / 100);

/** Block geometry (108 grid). */
const S = 42; // block side
const R = 7; // corner radius
const O = 5; // blue misregistration (down-right)
const X0 = 54 - (S + O) / 2; // 30.5: block + shadow centred
const SW = 3; // ink outline
const FILL_SHIFT = 1.2; // pink plate vs ink plate

/**
 * Hand-drawn "P": stem + bowl whose right side is a superellipse approximated
 * with cubic quadrants (k = 0.62 is squarer than a circle's 0.552).
 * (px, py) = top-left, h = cap height. Returns outer contour + counter.
 */
export function letterPPath(px: number, py: number, h: number): string {
  const u = h / 26;
  const w = 20.8 * u;
  const stem = 6.5 * u;
  const bowlH = 16.3 * u;
  const rx = 8.9 * u;
  const ry = bowlH / 2;
  const cx = px + w - rx;
  const cy = py + ry;
  const k = 0.62;
  const top = 5.5 * u;
  const bot = 5.2 * u;
  const irx = rx - 6.4 * u;
  const iy0 = py + top;
  const iy1 = py + bowlH - bot;
  const iry = (iy1 - iy0) / 2;
  const icy = iy0 + iry;
  const ik = 0.66;
  const outer =
    `M${f(px)} ${f(py + h)}V${f(py)}H${f(cx)}` +
    `C${f(cx + k * rx)} ${f(py)} ${f(cx + rx)} ${f(cy - k * ry)} ${f(cx + rx)} ${f(cy)}` +
    `C${f(cx + rx)} ${f(cy + k * ry)} ${f(cx + k * rx)} ${f(py + bowlH)} ${f(cx)} ${f(py + bowlH)}` +
    `H${f(px + stem)}V${f(py + h)}Z`;
  const counter =
    `M${f(px + stem)} ${f(iy0)}H${f(cx)}` +
    `C${f(cx + ik * irx)} ${f(iy0)} ${f(cx + irx)} ${f(icy - ik * iry)} ${f(cx + irx)} ${f(icy)}` +
    `C${f(cx + irx)} ${f(icy + ik * iry)} ${f(cx + ik * irx)} ${f(iy1)} ${f(cx)} ${f(iy1)}` +
    `H${f(px + stem)}Z`;
  return outer + counter;
}

function rrPath(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}` +
    `V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}` +
    `H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`
  );
}

const BLOCK = rrPath(X0, X0, S, S, R);
const SHADOW = rrPath(X0 + O, X0 + O, S, S, R);
const P_H = 24.5;
/** P centred on the block face, nudged right for optical balance (bowl-heavy right side). */
const P_PATH = letterPPath(X0 + S / 2 - (20.8 * P_H) / 52 + 0.5, X0 + S / 2 - P_H / 2, P_H);
/** Inset of the raised type face; the bevels read as the sort's shoulder. */
const FACE = 5.2;

/**
 * Monochrome (themed icon) outline, even-odd: the block's rim, a 1.8 dp gap that
 * stands in for the bevel, the raised face with the P knocked out, plus the
 * misregistered impression as an L-shaped sliver separated by a 2 dp gap.
 * Written as plain path data so the Android VectorDrawable can reuse it verbatim.
 */
export const APP_ICON_MONOCHROME_PATH: string = (() => {
  const g = 2;
  const x1 = X0 + O; // shadow left/top (35.5)
  const x2 = X0 + O + S; // shadow right/bottom (77.5)
  const e = X0 + S + g; // expanded block right/bottom edge (74.5)
  const er = R + g; // expanded corner radius
  // The right band starts where x = e crosses the shadow's top-right corner arc;
  // by symmetry the bottom band ends where y = e crosses the bottom-left arc.
  const t = x1 + R - Math.sqrt(R * R - (e - (x2 - R)) ** 2);
  const sliver =
    `M${f(e)} ${f(t)}A${f(R)} ${f(R)} 0 0 1 ${f(x2)} ${f(x1 + R)}V${f(x2 - R)}` +
    `A${f(R)} ${f(R)} 0 0 1 ${f(x2 - R)} ${f(x2)}H${f(x1 + R)}A${f(R)} ${f(R)} 0 0 1 ${f(t)} ${f(e)}` +
    `H${f(e - er)}A${f(er)} ${f(er)} 0 0 0 ${f(e)} ${f(e - er)}Z`;
  const rim = 3.4;
  const gapEdge = rrPath(X0 + rim, X0 + rim, S - 2 * rim, S - 2 * rim, R - rim + 1);
  const face = rrPath(X0 + FACE, X0 + FACE, S - 2 * FACE, S - 2 * FACE, 2.5);
  return BLOCK + gapEdge + face + P_PATH + sliver;
})();

/** Background: flat paper with a faint halftone (108 grid). */
function backgroundBody(id: string): string {
  return (
    `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)">` +
    `<circle cx="1.5" cy="1.5" r="0.55" fill="${C.paperShade}"/></pattern></defs>` +
    `<rect width="108" height="108" fill="${C.paper}"/><rect width="108" height="108" fill="url(#${id})"/>`
  );
}

/** The printed block, centred on (54, 54) of the 108 grid. */
function artBody(id: string): string {
  const x1 = X0 + S;
  const lo = X0 + 2.6;
  const hi = x1 - 2.6;
  const fi = X0 + FACE;
  const fo = x1 - FACE;
  const bevel =
    rrPath(fi, fi, S - 2 * FACE, S - 2 * FACE, 2) +
    `M${f(lo)} ${f(lo)}L${f(fi)} ${f(fi)}M${f(hi)} ${f(lo)}L${f(fo)} ${f(fi)}` +
    `M${f(lo)} ${f(hi)}L${f(fi)} ${f(fo)}M${f(hi)} ${f(hi)}L${f(fo)} ${f(fo)}`;
  return (
    `<defs><pattern id="${id}-b" patternUnits="userSpaceOnUse" width="2.2" height="2.2" patternTransform="rotate(45)">` +
    `<rect width="2.2" height="2.2" fill="${C.blue}"/><circle cx="1.1" cy="1.1" r="0.62" fill="${C.blueDark}"/></pattern>` +
    `<pattern id="${id}-p" patternUnits="userSpaceOnUse" width="2.2" height="2.2" patternTransform="rotate(45)">` +
    `<circle cx="1.1" cy="1.1" r="0.75" fill="${C.pinkDark}"/></pattern>` +
    `<clipPath id="${id}-c"><path d="${BLOCK}"/></clipPath></defs>` +
    `<path d="${SHADOW}" fill="url(#${id}-b)"/>` +
    `<g transform="translate(${FILL_SHIFT} ${FILL_SHIFT})"><path d="${BLOCK}" fill="${C.pink}"/>` +
    `<path d="M${f(X0)} ${f(x1)}L${f(x1)} ${f(X0)}V${f(x1)}Z" fill="url(#${id}-p)" clip-path="url(#${id}-c)"/></g>` +
    `<path d="${bevel}" fill="none" stroke="${C.ink}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<path d="${BLOCK}" fill="none" stroke="${C.ink}" stroke-width="${SW}" stroke-linejoin="round"/>` +
    `<path d="${P_PATH}" fill="${C.ink}" fill-rule="evenodd"/>`
  );
}

const svg = (size: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${size}" height="${size}">${body}</svg>`;

const scaled = (k: number, body: string): string =>
  `<g transform="translate(54 54) scale(${k}) translate(-54 -54)">${body}</g>`;

/** Scale of the art on full-square icons (store / PWA "any"). */
export const APP_ICON_ART_SCALE = 1.38;
/** Scale of the art on maskable icons (stays inside the 80% safe circle). */
export const APP_ICON_MASKABLE_SCALE = 1.24;

/** Full 1024×1024 square icon with paper background. */
export const APP_ICON_SVG: string = svg(
  1024,
  backgroundBody('bg-ht') + scaled(APP_ICON_ART_SCALE, artBody('art-ht')),
);

/** Adaptive-icon foreground: transparent 108 dp canvas, art inside the 66 dp safe zone. */
export const APP_ICON_FOREGROUND_SVG: string = svg(432, artBody('fg-ht'));

/** Adaptive-icon background: paper #F2ECDF with a subtle halftone. */
export const APP_ICON_BACKGROUND_SVG: string = svg(432, backgroundBody('bg-ht'));

/** Android 13 themed-icon layer: one flat colour, same 108 dp canvas. */
export const APP_ICON_MONOCHROME_SVG: string = svg(
  432,
  `<path d="${APP_ICON_MONOCHROME_PATH}" fill="${C.ink}" fill-rule="evenodd"/>`,
);

/** Maskable (PWA) icon: full-bleed paper, art inside the central 80% circle. */
export const APP_ICON_MASKABLE_SVG: string = svg(
  512,
  backgroundBody('mk-bg') + scaled(APP_ICON_MASKABLE_SCALE, artBody('mk-art')),
);

/** Legacy launcher icons (pre-adaptive): paper tile, square-ish or round, transparent outside. */
export function appIconLegacySvg(shape: 'square' | 'round', size: number): string {
  const tile =
    shape === 'round'
      ? `<circle cx="54" cy="54" r="50" fill="${C.paper}"/>`
      : `<rect x="6" y="6" width="96" height="96" rx="16" fill="${C.paper}"/>`;
  const edge =
    shape === 'round'
      ? `<circle cx="54" cy="54" r="50" fill="none" stroke="${C.paperShade}" stroke-width="1.5"/>`
      : `<rect x="6" y="6" width="96" height="96" rx="16" fill="none" stroke="${C.paperShade}" stroke-width="1.5"/>`;
  return svg(size, tile + edge + scaled(shape === 'round' ? 1.24 : 1.3, artBody(`lg-${shape}`)));
}
