/**
 * Wordmark letter geometry (P, R, E, S) for the logo and the app icon.
 *
 * Heavy geometric grotesk capitals built from rectangles and superelliptic
 * bowls, proportioned to sit with the house PRESS Display face (GDD §14.3) but
 * drawn here on their own so the logo never depends on a font being loaded.
 * Units: 1000 UPM, cap height 700, y up, baseline 0.
 */

export type Vec = [number, number];

/** Outline set of one letter: solids (outer contours) and holes (counters). */
export interface Letter {
  /** Design width (excluding side bearings). */
  w: number;
  /** Left / right side bearings. */
  l: number;
  r: number;
  solids: Vec[][];
  holes: Vec[][];
}

export const CAP = 700;
const OS = 10; // overshoot of round shapes
const ST = 168; // stems
const BAR = 150; // horizontals of E
const RS = 172; // round strokes at the sides
const RT = 146; // round strokes at top / bottom
const NO = 2.4; // superellipse exponent (2 = ellipse)
const DN = 0.35; // counters slightly squarer
const TAU = Math.PI * 2;

interface Oval {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  n: number;
}

const ov = (cx: number, cy: number, rx: number, ry: number, n = NO): Oval => ({ cx, cy, rx, ry, n });

function inset(o: Oval, side: number, top: number, bottom = top): Oval {
  return {
    cx: o.cx,
    cy: o.cy + (bottom - top) / 2,
    rx: o.rx - side,
    ry: o.ry - (top + bottom) / 2,
    n: o.n + DN,
  };
}

function ovalAt(o: Oval, a: number): Vec {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = Math.pow(Math.pow(Math.abs(c) / o.rx, o.n) + Math.pow(Math.abs(s) / o.ry, o.n), -1 / o.n);
  return [o.cx + r * c, o.cy + r * s];
}

function arcPts(o: Oval, a0: number, a1: number): Vec[] {
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / TAU) * 96));
  const pts: Vec[] = [];
  for (let i = 0; i <= steps; i++) pts.push(ovalAt(o, a0 + ((a1 - a0) * i) / steps));
  return pts;
}

/** Polar angle where the oval's left or right side crosses height y. */
function angleAtY(o: Oval, y: number, side: 'left' | 'right'): number {
  let lo = side === 'right' ? -Math.PI / 2 : Math.PI / 2;
  let hi = side === 'right' ? Math.PI / 2 : (3 * Math.PI) / 2;
  const rising = side === 'right';
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (ovalAt(o, mid)[1] < y === rising) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** D-shaped bowl (P, R): straight left, flat top/bottom, superelliptic right side. */
function bowl(x0: number, y0: number, x1: number, y1: number, rx: number, top: number, bottom: number) {
  const cx = x1 - rx;
  const o = ov(cx, (y0 + y1) / 2, rx, (y1 - y0) / 2, 2.6);
  const outer: Vec[] = [[x0, y0], ...arcPts(o, -Math.PI / 2, Math.PI / 2), [x0, y1]];
  const iy0 = y0 + bottom;
  const iy1 = y1 - top;
  const io = ov(cx, (iy0 + iy1) / 2, rx - RS, (iy1 - iy0) / 2, 2.6 + DN);
  const inner: Vec[] = [[x0 + ST, iy0], ...arcPts(io, -Math.PI / 2, Math.PI / 2), [x0 + ST, iy1]];
  return { outer, inner };
}

export function letterP(): Letter {
  const w = 560;
  const b = bowl(0, 262, w, CAP, 240, 146, 140);
  return { w, l: 50, r: 26, solids: [rect(0, 0, ST, CAP), b.outer], holes: [b.inner] };
}

export function letterR(): Letter {
  const w = 585;
  const b = bowl(0, 284, 562, CAP, 232, 146, 140);
  // Leg: right edge runs from the foot (w, 0) up into the bowl's lower bar.
  const top = 360;
  const x1 = 330;
  const dx = w - x1;
  const t = ((ST + 8) * Math.hypot(dx, top)) / top; // horizontal width for a perpendicular stroke of ST+8
  const leg: Vec[] = [
    [w - t, 0],
    [w, 0],
    [x1, top],
    [x1 - t, top],
  ];
  return { w, l: 50, r: 10, solids: [rect(0, 0, ST, CAP), b.outer, leg], holes: [b.inner] };
}

export function letterE(): Letter {
  const w = 470;
  return {
    w,
    l: 50,
    r: 30,
    solids: [
      rect(0, 0, ST, CAP),
      rect(0, CAP - BAR, w - 8, CAP),
      rect(0, 280, w - 40, 280 + BAR),
      rect(0, 0, w, BAR),
    ],
    holes: [],
  };
}

export function letterS(): Letter {
  const w = 560;
  const cx = w / 2;
  const m0 = 286; // spine bottom
  const m1 = 434; // spine top
  const eps = 0.03;
  const up = ov(cx, (m0 + CAP + OS) / 2, cx - 16, (CAP + OS - m0) / 2);
  const upIn = inset(up, RS, RT, m1 - m0);
  const aOut = angleAtY(up, 506, 'right');
  const aIn = angleAtY(upIn, 506, 'right');
  const upper = [...arcPts(up, aOut, 1.5 * Math.PI + eps), ...arcPts(upIn, 1.5 * Math.PI + eps, aIn)];
  const lo = ov(cx, (m1 - OS) / 2, cx, (m1 + OS) / 2);
  const loIn = inset(lo, RS, m1 - m0, RT);
  const bOut = angleAtY(lo, 200, 'left') - TAU;
  const bIn = angleAtY(loIn, 200, 'left') - TAU;
  const lower = [...arcPts(lo, Math.PI / 2 + eps, bOut), ...arcPts(loIn, bIn, Math.PI / 2 + eps)];
  return { w, l: 32, r: 32, solids: [upper, lower], holes: [] };
}

const signedArea = (pts: readonly Vec[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** Places a letter: font units → SVG user units (y down) at (x, baseline) with scale s. */
export function placeLetter(
  letter: Letter,
  x: number,
  baseline: number,
  s: number,
): { solids: Vec[][]; holes: Vec[][] } {
  const map = (pts: Vec[]): Vec[] => pts.map(([px, py]) => [x + px * s, baseline - py * s]);
  // Screen space: solids clockwise (positive area with y down), holes counter-clockwise,
  // so overlapping solids union under the nonzero rule and counters punch through.
  const orient = (pts: Vec[], sign: 1 | -1): Vec[] =>
    Math.sign(signedArea(pts)) === sign ? pts : [...pts].reverse();
  return {
    solids: letter.solids.map((p) => orient(map(p), 1)),
    holes: letter.holes.map((p) => orient(map(p), -1)),
  };
}

/** Path data (nonzero fill) for placed outlines. */
export function outlinePath(o: { solids: Vec[][]; holes: Vec[][] }, digits = 2): string {
  const f = (v: number) => {
    const k = 10 ** digits;
    return String(Math.round(v * k) / k);
  };
  const sub = (pts: Vec[]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
  return [...o.solids, ...o.holes].map(sub).join('');
}

/** Advance width of a letter in font units. */
export const advance = (l: Letter): number => l.l + l.w + l.r;
