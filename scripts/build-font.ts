/**
 * PRESS Display: the game's own display typeface, drawn in code.
 *
 * A heavy, slightly condensed geometric grotesk in the spirit of wood-type
 * poster letters. Every glyph is a union of primitive filled shapes
 * (rectangles, slanted bands, superelliptic rings, polygons) merged with
 * polygon-clipping into clean outlines, snapped to integer font units and
 * written as a CFF-flavoured OpenType font. No third-party outlines are used.
 *
 *   npm run build:font      (npx tsx scripts/build-font.ts)
 *
 * Output: public/fonts/press-display.otf (byte-identical between runs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Font, Glyph, Path, parse } from 'opentype.js';
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair } from 'polygon-clipping';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/fonts/press-display.otf');

// ---------------------------------------------------------------------------
// Metrics and design constants (font units, UPM 1000, y up, baseline 0)
// ---------------------------------------------------------------------------

const UPM = 1000;
const CAP = 700;
/** hhea / typo / win ascender and descender: room for accents and ogonek at line-height 1.2. */
const ASCENT = 950;
const DESCENT = -250;
/** Fixed timestamp (2026-01-01T00:00:00Z) so builds are byte-identical. */
const TIMESTAMP = Date.UTC(2026, 0, 1) / 1000;

const OS = 10; // optical overshoot of round shapes above cap height / below baseline
const ST = 160; // vertical stem
const BAR = 148; // horizontal bar (H, T, L, Z)
const BAR3 = 138; // horizontals of three-storey letters (E, F, B, 3, 5, 8)
const RS = 166; // round strokes at their vertical sides
const RT = 140; // round strokes at top and bottom
const DG = 154; // diagonals, measured perpendicular to the stroke
const DOT = 170; // square dots (period, colon, comma head)
const NO = 2.3; // superellipse exponent of outer round contours (2 = ellipse)
const DN = 0.35; // counters are a little squarer than the outer contour
const MID = 350; // optical centre line for operators, dashes and arrows

const SB = 52; // side bearing next to a straight stem
const SBR = 36; // next to a round side
const SBD = 12; // next to an open diagonal

const BIG = 4000; // "infinity" for half-planes
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Geometry primitives (MultiPolygon in, MultiPolygon out)
// ---------------------------------------------------------------------------

type Shape = MultiPolygon;

const poly = (pts: Pair[]): Shape => [[pts]];
const rect = (x0: number, y0: number, x1: number, y1: number): Shape =>
  poly([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);

function union(...shapes: Shape[]): Shape {
  const [first, ...rest] = shapes.filter((s) => s.length > 0);
  return first ? polygonClipping.union(first, ...rest) : [];
}

function subtract(a: Shape, ...cuts: Shape[]): Shape {
  const c = cuts.filter((s) => s.length > 0);
  return a.length === 0 || c.length === 0 ? a : polygonClipping.difference(a, ...c);
}

function intersect(a: Shape, ...others: Shape[]): Shape {
  let out = a;
  for (const o of others) {
    if (out.length === 0 || o.length === 0) return [];
    out = polygonClipping.intersection(out, o);
  }
  return out;
}

const clip = (s: Shape, x0: number, y0: number, x1: number, y1: number): Shape =>
  intersect(s, rect(x0, y0, x1, y1));
const leftOf = (x: number): Shape => rect(-BIG, -BIG, x, BIG);
const rightOf = (x: number): Shape => rect(x, -BIG, BIG, BIG);
const above = (y: number): Shape => rect(-BIG, y, BIG, BIG);
const below = (y: number): Shape => rect(-BIG, -BIG, BIG, y);

const mapShape = (s: Shape, f: (p: Pair) => Pair): Shape => s.map((pg) => pg.map((ring) => ring.map(f)));
const translate = (s: Shape, dx: number, dy: number): Shape => mapShape(s, ([x, y]) => [x + dx, y + dy]);
const mirrorX = (s: Shape, w: number): Shape => mapShape(s, ([x, y]) => [w - x, y]);
const mirrorY = (s: Shape, h: number): Shape => mapShape(s, ([x, y]) => [x, h - y]);
const rotate180 = (s: Shape, cx: number, cy: number): Shape =>
  mapShape(s, ([x, y]) => [2 * cx - x, 2 * cy - y]);
/** Quarter turn counter-clockwise about (cx, cy). */
const rotate90 = (s: Shape, cx: number, cy: number): Shape =>
  mapShape(s, ([x, y]) => [cx - (y - cy), cy + (x - cx)]);

/** Region strictly under the (non-vertical) line through p0 and p1. */
function underLine(p0: Pair, p1: Pair): Shape {
  const k = (p1[1] - p0[1]) / (p1[0] - p0[0]);
  const yAt = (x: number) => p0[1] + (x - p0[0]) * k;
  return poly([
    [-BIG, yAt(-BIG)],
    [-BIG, -BIG * 4],
    [BIG, -BIG * 4],
    [BIG, yAt(BIG)],
  ]);
}

/** x of the line through p0 and p1 at height y. */
const xAt = (p0: Pair, p1: Pair, y: number): number =>
  p0[0] + ((y - p0[1]) * (p1[0] - p0[0])) / (p1[1] - p0[1]);

/** Horizontal width of a stroke of perpendicular thickness t running along p0 -> p1. */
function hWidth(p0: Pair, p1: Pair, t: number): number {
  const s = (p1[0] - p0[0]) / (p1[1] - p0[1]);
  return t * Math.sqrt(1 + s * s);
}

/**
 * Diagonal stroke whose one edge lies on the line p0-p1; the stroke body is on
 * the right (+1) or left (-1) of that edge and is `t` thick perpendicular to
 * its direction (so diagonals carry the same colour as stems). Extended far
 * beyond both points: callers clip it to get flat horizontal terminals.
 */
function edgeBand(p0: Pair, p1: Pair, t: number, side: 1 | -1): Shape {
  const hw = hWidth(p0, p1, t) * side;
  const ya = -BIG / 2;
  const yb = BIG / 2;
  const xa = xAt(p0, p1, ya);
  const xb = xAt(p0, p1, yb);
  return poly([
    [xa, ya],
    [xb, yb],
    [xb + hw, yb],
    [xa + hw, ya],
  ]);
}

/**
 * Diagonal from corner to corner (N, X, Z): its outer edge touches xTop at
 * yTop and the opposite edge touches xBot at yBot.
 */
function spanBand(xTop: number, yTop: number, xBot: number, yBot: number, t: number): Shape {
  const dir = Math.sign(xBot - xTop) || 1;
  let hw = t / 2;
  for (let i = 0; i < 40; i++) {
    const s = (xBot - xTop - 2 * dir * hw) / (yTop - yBot);
    hw = (t / 2) * Math.sqrt(1 + s * s);
  }
  const c0: Pair = [xTop + dir * hw - hw, yTop];
  const c1: Pair = [xBot - dir * hw - hw, yBot];
  return edgeBand(c0, c1, t, 1);
}

/** Stroke centred on p0 -> p1, `t` thick, with ends cut perpendicular (optionally extended). */
function band(p0: Pair, p1: Pair, t: number, ext0 = 0, ext1 = ext0): Shape {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = (-uy * t) / 2;
  const ny = (ux * t) / 2;
  const a: Pair = [p0[0] - ux * ext0, p0[1] - uy * ext0];
  const b: Pair = [p1[0] + ux * ext1, p1[1] + uy * ext1];
  return poly([
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ]);
}

/** Intersection of the lines (p, p + d) and (q, q + e). */
function meet(p: Pair, d: Pair, q: Pair, e: Pair): Pair {
  const den = d[0] * e[1] - d[1] * e[0];
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * s, p[1] + d[1] * s];
}

/** Polyline stroked `t` thick with mitred joins and square (perpendicular) ends. */
function polyStroke(pts: Pair[], t: number): Shape {
  const h = t / 2;
  const dirs: Pair[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Pair;
    const b = pts[i + 1] as Pair;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    dirs.push([(b[0] - a[0]) / len, (b[1] - a[1]) / len]);
  }
  const side = (sgn: 1 | -1): Pair[] =>
    pts.map((p, i) => {
      const dPrev = dirs[i - 1];
      const dNext = dirs[i];
      const off = (d: Pair): Pair => [p[0] - d[1] * h * sgn, p[1] + d[0] * h * sgn];
      if (!dPrev && dNext) return off(dNext);
      if (dPrev && !dNext) return off(dPrev);
      if (dPrev && dNext) return meet(off(dPrev), dPrev, off(dNext), dNext);
      return p;
    });
  return poly([...side(1), ...side(-1).reverse()]);
}

/** Stroke centred on p0 -> p1 with horizontal end cuts at p0.y and p1.y. */
function strokeH(p0: Pair, p1: Pair, t: number): Shape {
  const hw = hWidth(p0, p1, t) / 2;
  return poly([
    [p0[0] - hw, p0[1]],
    [p0[0] + hw, p0[1]],
    [p1[0] + hw, p1[1]],
    [p1[0] - hw, p1[1]],
  ]);
}

// --- Superellipses -----------------------------------------------------------

/** |x/rx|^n + |y/ry|^n = 1 around (cx, cy). */
interface Oval {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  n: number;
}

const ov = (cx: number, cy: number, rx: number, ry: number, n = NO): Oval => ({ cx, cy, rx, ry, n });

/** Counter of a round stroke: `side` thick at the sides, `top` / `bottom` at the extremes. */
function inset(o: Oval, side: number, top: number, bottom = top, dn = DN): Oval {
  return {
    cx: o.cx,
    cy: o.cy + (bottom - top) / 2,
    rx: o.rx - side,
    ry: o.ry - (top + bottom) / 2,
    n: o.n + dn,
  };
}

/** Point on the oval at polar angle a (radians). */
function ovalAt(o: Oval, a: number): Pair {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = Math.pow(Math.pow(Math.abs(c) / o.rx, o.n) + Math.pow(Math.abs(s) / o.ry, o.n), -1 / o.n);
  return [o.cx + r * c, o.cy + r * s];
}

/**
 * Polar steps per full turn: the chord error stays well under 0.5 units and
 * there are never fewer than 16 segments per quarter.
 */
const turnSteps = (o: Oval): number => 4 * Math.min(40, Math.max(16, Math.ceil(Math.max(o.rx, o.ry) / 11)));

/** Points of the oval from angle a0 to a1 (either direction), both ends included. */
function ovalArc(o: Oval, a0: number, a1: number): Pair[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / TAU) * turnSteps(o)));
  const pts: Pair[] = [];
  for (let i = 0; i <= n; i++) pts.push(ovalAt(o, a0 + ((a1 - a0) * i) / n));
  return pts;
}

/** The full oval as a filled shape (sampled so the four extremes are exact vertices). */
function oval(o: Oval): Shape {
  const n = turnSteps(o);
  const pts: Pair[] = [];
  for (let i = 0; i < n; i++) pts.push(ovalAt(o, (i / n) * TAU));
  return poly(pts);
}

const ring = (outer: Oval, inner: Oval): Shape => subtract(oval(outer), oval(inner));

/** Polar angle where the oval's left or right side crosses height y. */
function angleAtY(o: Oval, y: number, side: 'left' | 'right'): number {
  // On the right half y rises with the angle, on the left half it falls.
  let lo = side === 'right' ? -Math.PI / 2 : Math.PI / 2;
  let hi = side === 'right' ? Math.PI / 2 : (3 * Math.PI) / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const rising = side === 'right';
    if (ovalAt(o, mid)[1] < y === rising) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Polar angle (within [a0, a1]) where a line from the outside point p touches
 * the oval; 'min' picks the clockwise-most ray, 'max' the counter-clockwise-most.
 */
function tangentAngle(o: Oval, p: Pair, a0: number, a1: number, pick: 'min' | 'max'): number {
  const dir = (a: number) => {
    const q = ovalAt(o, a);
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  };
  const better = (x: number, y: number) => (pick === 'min' ? x < y : x > y);
  let best = a0;
  const n = 4000;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    if (better(dir(a), dir(best))) best = a;
  }
  return best;
}

/** Distance from point p to the infinite line through a and b. */
function distToLine(p: Pair, a: Pair, b: Pair): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.hypot(dx, dy);
}

/**
 * D-shaped bowl (B, D, P, R): straight left side and flat top/bottom running
 * into a superelliptic right side. Returns the outer silhouette and counter.
 */
function bowl(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rx: number,
  opts: { left?: number; top?: number; bottom?: number; side?: number; n?: number } = {},
): { outer: Shape; inner: Shape } {
  const { left = ST, top = BAR, bottom = BAR, side = RS, n = 2.5 } = opts;
  const cx = x1 - rx;
  const outerOval = ov(cx, (y0 + y1) / 2, rx, (y1 - y0) / 2, n);
  const outer = union(rect(x0, y0, cx, y1), intersect(oval(outerOval), rightOf(cx)));
  const iy0 = y0 + bottom;
  const iy1 = y1 - top;
  const innerOval = ov(cx, (iy0 + iy1) / 2, rx - side, (iy1 - iy0) / 2, n + DN);
  const inner = union(rect(x0 + left, iy0, cx, iy1), intersect(oval(innerOval), rightOf(cx)));
  return { outer, inner };
}

// ---------------------------------------------------------------------------
// Glyph bodies: drawn from x = 0; `w` is the design width, `l`/`r` side bearings
// ---------------------------------------------------------------------------

interface Body {
  shape: Shape;
  w: number;
  l: number;
  r: number;
}

const body = (shape: Shape, w: number, l = SB, r = l): Body => ({ shape, w, l, r });

/** Horizontal extent of a shape. */
function xRange(s: Shape): [number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const pg of s)
    for (const ring of pg) for (const [x] of ring) [x0, x1] = [Math.min(x0, x), Math.max(x1, x)];
  return [x0, x1];
}

/** Body whose design width is the shape's own ink width (symbols). */
function fitBody(s: Shape, l: number, r = l): Body {
  const [x0, x1] = xRange(s);
  return body(translate(s, -x0, 0), x1 - x0, l, r);
}
const capBox = (s: Shape, w: number): Shape => clip(s, 0, 0, w, CAP);

// --- Straight capitals --------------------------------------------------------

function H(): Body {
  const w = 540;
  return body(union(rect(0, 0, ST, CAP), rect(w - ST, 0, w, CAP), rect(ST, 282, w - ST, 282 + BAR)), w);
}

const I = (): Body => body(rect(0, 0, ST, CAP), ST);

function E(): Body {
  const w = 465;
  return body(
    union(
      rect(0, 0, ST, CAP),
      rect(0, CAP - BAR3, w - 8, CAP),
      rect(0, 288, w - 38, 288 + BAR3),
      rect(0, 0, w, BAR3),
    ),
    w,
    SB,
    34,
  );
}

function F(): Body {
  const w = 450;
  return body(
    union(rect(0, 0, ST, CAP), rect(0, CAP - BAR3, w, CAP), rect(0, 274, w - 40, 274 + BAR3)),
    w,
    SB,
    26,
  );
}

function L(): Body {
  const w = 445;
  return body(union(rect(0, 0, ST, CAP), rect(0, 0, w, BAR)), w, SB, 20);
}

function T(): Body {
  const w = 520;
  return body(union(rect(0, CAP - BAR, w, CAP), rect((w - ST) / 2, 0, (w + ST) / 2, CAP)), w, 16);
}

function J(): Body {
  const w = 455;
  const o = ov(w / 2, 250, w / 2, 260);
  const hook = subtract(intersect(ring(o, inset(o, ST, RT)), below(o.cy)), rect(-BIG, 205, o.cx, BIG));
  return body(union(hook, rect(w - ST, o.cy - 1, w, CAP)), w, 22, SB);
}

function U(): Body {
  const w = 545;
  const o = ov(w / 2, 262, w / 2, 272);
  const bowlPart = intersect(ring(o, inset(o, ST, RT)), below(o.cy));
  return body(union(bowlPart, rect(0, o.cy - 1, ST, CAP), rect(w - ST, o.cy - 1, w, CAP)), w, 50);
}

// --- Diagonal capitals ---------------------------------------------------------

const A_W = 640;
const A_APEX = 196; // width of the flat apex
/** Left corner of the A's right foot (where the Ą ogonek hangs). */
const A_FOOT = A_W - hWidth([A_W, 0], [(A_W + A_APEX) / 2, CAP], DG);

function A(): Body {
  const w = A_W;
  const apex = A_APEX;
  const legL = edgeBand([0, 0], [(w - apex) / 2, CAP], DG, 1);
  const legR = edgeBand([w, 0], [(w + apex) / 2, CAP], DG, -1);
  const hull = poly([
    [0, 0],
    [w, 0],
    [(w + apex) / 2, CAP],
    [(w - apex) / 2, CAP],
  ]);
  const bar = intersect(rect(0, 132, w, 132 + 136), hull);
  return body(capBox(union(legL, legR, bar), w), w, SBD);
}

function V(): Body {
  const w = 615;
  const foot = 186; // width of the flat vertex on the baseline
  const armL = edgeBand([0, CAP], [(w - foot) / 2, 0], DG, 1);
  const armR = edgeBand([w, CAP], [(w + foot) / 2, 0], DG, -1);
  return body(capBox(union(armL, armR), w), w, SBD);
}

function W(): Body {
  const w = 870;
  const t = 146; // four diagonals: slightly lighter to keep the colour even
  const b1 = 0.29 * w;
  const b2 = w - b1;
  const foot = 150;
  const apex = 140;
  const parts = union(
    edgeBand([0, CAP], [b1 - foot / 2, 0], t, 1),
    edgeBand([b1 + foot / 2, 0], [w / 2 + apex / 2, CAP], t, -1),
    edgeBand([b2 - foot / 2, 0], [w / 2 - apex / 2, CAP], t, 1),
    edgeBand([w, CAP], [b2 + foot / 2, 0], t, -1),
  );
  return body(capBox(parts, w), w, SBD);
}

function M(): Body {
  const w = 720;
  const t = 146;
  const foot = 176;
  const parts = union(
    rect(0, 0, ST, CAP),
    rect(w - ST, 0, w, CAP),
    // Diagonals start a little inside the stems so the top joins stay clean.
    edgeBand([14, CAP], [w / 2 - foot / 2, 0], t, 1),
    edgeBand([w - 14, CAP], [w / 2 + foot / 2, 0], t, -1),
  );
  return body(capBox(parts, w), w, SB - 4);
}

function N(): Body {
  const w = 570;
  const parts = union(rect(0, 0, ST, CAP), rect(w - ST, 0, w, CAP), spanBand(0, CAP, w, 0, 150));
  return body(capBox(parts, w), w, SB - 2);
}

function X(): Body {
  const w = 600;
  const inset0 = 14; // top slightly narrower than the base
  const parts = union(spanBand(inset0, CAP, w, 0, 148), spanBand(w - inset0, CAP, 0, 0, 148));
  return body(capBox(parts, w), w, SBD + 2);
}

function Y(): Body {
  const w = 610;
  const cx = w / 2;
  const join = 205; // height where the arms meet the stem edges
  const armL = intersect(edgeBand([0, CAP], [cx - ST / 2, join], 150, 1), leftOf(cx));
  const armR = intersect(edgeBand([w, CAP], [cx + ST / 2, join], 150, -1), rightOf(cx));
  return body(capBox(union(armL, armR, rect(cx - ST / 2, 0, cx + ST / 2, join + 30)), w), w, SBD);
}

function Z(): Body {
  const w = 510;
  const diag = clip(spanBand(w, CAP - BAR, 0, BAR, DG), 0, BAR, w, CAP - BAR);
  return body(union(rect(14, CAP - BAR, w, CAP), rect(0, 0, w, BAR), diag), w, 28);
}

function K(): Body {
  const w = 585;
  // Arm: lower edge from the top-right corner down to the stem.
  const armEdge0: Pair = [w, CAP];
  const armEdge1: Pair = [ST, 228];
  const arm = edgeBand(armEdge0, armEdge1, DG, -1);
  const hw = hWidth(armEdge0, armEdge1, DG);
  const armTop0: Pair = [armEdge0[0] - hw, armEdge0[1]];
  const armTop1: Pair = [armEdge1[0] - hw, armEdge1[1]];
  // Leg: from the bottom-right corner up into the arm, stopped by the arm's upper edge.
  const leg = intersect(edgeBand([w, 0], [300, 470], DG + 4, -1), underLine(armTop0, armTop1));
  return body(capBox(union(rect(0, 0, ST, CAP), arm, leg), w), w, SB, SBD);
}

// --- Bowls -----------------------------------------------------------------

function D(): Body {
  const w = 585;
  const b = bowl(0, 0, w, CAP, 300, { top: 144, bottom: 144 });
  return body(subtract(b.outer, b.inner), w, SB, SBR);
}

function P(): Body {
  const w = 545;
  const b = bowl(0, 266, w, CAP, 232, { top: 142, bottom: 136 });
  return body(union(rect(0, 0, ST, CAP), subtract(b.outer, b.inner)), w, SB, 30);
}

function R(): Body {
  const w = 570;
  const bw = 550;
  const b = bowl(0, 288, bw, CAP, 226, { top: 142, bottom: 136 });
  // Leg: leaves the bowl's lower bar well clear of the stem, flat foot.
  const leg = clip(spanBand(262, 288, w, 0, DG + 6), 0, 0, w, 372);
  return body(union(rect(0, 0, ST, CAP), subtract(union(b.outer, leg), b.inner)), w, SB, 14);
}

function B(): Body {
  const w = 560;
  const up = bowl(0, 290, w - 28, CAP, 205, { top: BAR3, bottom: BAR3 });
  const lo = bowl(0, 0, w, 290 + BAR3, 222, { top: BAR3, bottom: BAR3 });
  return body(subtract(union(up.outer, lo.outer), up.inner, lo.inner), w, SB, SBR);
}

// --- Rounds ---------------------------------------------------------------------

function O(): Body {
  const w = 620;
  const o = ov(w / 2, CAP / 2, w / 2, CAP / 2 + OS);
  return body(ring(o, inset(o, RS, RT)), w, SBR);
}

function Q(): Body {
  const w = 620;
  const o = ov(w / 2, CAP / 2, w / 2, CAP / 2 + OS);
  const tail = strokeH([w / 2 + 70, 215], [w / 2 + 250, -80], 150);
  return body(union(ring(o, inset(o, RS, RT)), tail), w, SBR, SBR);
}

function C(): Body {
  const w = 580;
  const o = ov(w / 2, CAP / 2, w / 2, CAP / 2 + OS);
  return body(subtract(ring(o, inset(o, RS, RT)), rect(o.cx, 226, BIG, 476)), w, SBR, 24);
}

function G(): Body {
  const w = 605;
  const o = ov(w / 2, CAP / 2, w / 2, CAP / 2 + OS);
  const shell = subtract(ring(o, inset(o, RS, RT)), rect(o.cx, 364, BIG, 488));
  const bar = intersect(rect(o.cx + 14, 228, BIG, 364), oval(o));
  return body(union(shell, bar), w, SBR, 40);
}

function S(): Body {
  const w = 545;
  const cx = w / 2;
  const m0 = 292; // spine bottom
  const m1 = 434; // spine top
  const up = ov(cx, (m0 + CAP + OS) / 2, cx - 16, (CAP + OS - m0) / 2);
  const lo = ov(cx, (m1 - OS) / 2, cx, (m1 + OS) / 2);
  const upper = subtract(ring(up, inset(up, RS, RT, m1 - m0)), rect(cx, -BIG, BIG, 512));
  const lower = subtract(ring(lo, inset(lo, RS, m1 - m0, RT)), rect(-BIG, 196, cx, BIG));
  return body(union(upper, lower), w, 34);
}

// --- Polish capitals -----------------------------------------------------------

/** Kreska (Polish acute) centred at x over a capital. */
function kreska(x: number): Shape {
  const y0 = 752;
  const y1 = 900;
  return poly([
    [x - 98, y0],
    [x + 2, y0],
    [x + 104, y1],
    [x - 20, y1],
  ]);
}

/** Dot accent (Ż) centred at x. */
const dotAccent = (x: number): Shape => rect(x - 76, 752, x + 76, 900);

/**
 * Ogonek hanging from the baseline; `x` is the left edge of its stem. The
 * counter is offset to the right, so the hook thins from full weight where
 * it leaves the letter to a short, flat-cut tail pointing right.
 */
function ogonek(x: number): Shape {
  const t = 90;
  const o = ov(x + 104, -84, 104, 110, 2.2);
  const counter = ov(o.cx + 32, o.cy + 8, o.rx - t + 32, 52, 2.4);
  // Cut the tail vertically while it is still thinning, before it rises.
  const hook = intersect(subtract(oval(o), oval(counter)), below(o.cy), leftOf(o.cx + 62));
  return union(rect(x, o.cy - 1, x + t, 2), hook);
}

/** Add a mark to a body without changing its metrics. */
const withMark = (b: Body, mark: Shape): Body => ({ ...b, shape: union(b.shape, mark) });

function Lslash(): Body {
  const base = L();
  const shift = 74;
  const slash = clip(band([0, 268], [shift + 330, 470], 124, 40, 40), 0, -BIG, shift + 330, BIG);
  return { shape: union(translate(base.shape, shift, 0), slash), w: base.w + shift, l: 18, r: base.r };
}

// --- Figures (tabular: every digit has the same advance) ----------------------

const FIG_ADV = 600;
const FS = 158; // figure side stroke

function zero(): Body {
  const w = 520;
  const o = ov(w / 2, CAP / 2, w / 2, CAP / 2 + OS, 2.45);
  return body(ring(o, inset(o, FS, 136)), w);
}

function one(): Body {
  const sx = 182; // stem left edge
  const flag = poly([
    [sx, CAP],
    [0, 548],
    [0, 362],
    [sx, 500],
  ]);
  return body(union(rect(sx, 0, sx + ST, CAP), flag), sx + ST, 0, -30);
}

function two(): Body {
  const w = 505;
  const base = 142;
  const o = ov(w / 2, 480, w / 2, 230);
  const i = inset(o, FS, 136);
  const yT = 470; // left terminal height
  const pIn: Pair = [0, base];
  const aTi = tangentAngle(i, pIn, -Math.PI / 2, Math.PI / 2, 'min');
  // Pick the foot of the outer edge so the diagonal is ~DG thick.
  let lo = 60;
  let hi = 400;
  for (let k = 0; k < 50; k++) {
    const xPo = (lo + hi) / 2;
    const aTo = tangentAngle(o, [xPo, base], -Math.PI / 2, Math.PI / 2, 'min');
    if (distToLine(pIn, [xPo, base], ovalAt(o, aTo)) < DG) lo = xPo;
    else hi = xPo;
  }
  const pOut: Pair = [(lo + hi) / 2, base];
  const aTo = tangentAngle(o, pOut, -Math.PI / 2, Math.PI / 2, 'min');
  const outline: Pair[] = [
    ...ovalArc(o, angleAtY(o, yT, 'left'), aTo),
    pOut,
    pIn,
    ...ovalArc(i, aTi, angleAtY(i, yT, 'left')),
  ];
  return body(union(poly(outline), rect(0, 0, w, base)), w);
}

function three(): Body {
  const w = 500;
  const m0 = 300;
  const m1 = 436;
  const up = ov(w / 2 - 8, (m0 + CAP + OS) / 2, w / 2 - 22, (CAP + OS - m0) / 2);
  const lo = ov(w / 2, (m1 - OS) / 2, w / 2, (m1 + OS) / 2);
  const upper = subtract(ring(up, inset(up, FS, 136, m1 - m0)), rect(-BIG, -BIG, up.cx, 504));
  const lower = subtract(ring(lo, inset(lo, FS, m1 - m0, 138)), rect(-BIG, 196, lo.cx, BIG));
  return body(union(upper, lower, rect(150, m0, w / 2, m1)), w);
}

function four(): Body {
  const w = 550;
  const sx = 352; // stem left edge
  const barY0 = 140;
  const barY1 = 278;
  const diag = clip(edgeBand([0, barY1], [sx, CAP], 150, 1), 0, barY0, sx + ST, CAP);
  return body(union(rect(sx, 0, sx + ST, CAP), rect(0, barY0, w, barY1), diag), w, 0, -14);
}

function five(): Body {
  const w = 505;
  const sx = 20;
  const o = ov(w / 2, 222, w / 2, 232);
  const top = o.cy + o.ry;
  const bowlPart = subtract(ring(o, inset(o, FS, 138)), rect(-BIG, 182, o.cx, BIG));
  return body(
    union(
      bowlPart,
      rect(sx, top - 138, o.cx, top),
      rect(sx, top - 138, sx + ST, CAP),
      rect(sx, CAP - BAR3, w - 6, CAP),
    ),
    w,
  );
}

function six(): Body {
  const w = 515;
  const cx = w / 2;
  const lo = ov(cx, 228, cx, 238);
  const big = ov(cx, CAP / 2, cx, CAP / 2 + OS);
  const lower = ring(lo, inset(lo, FS, 138));
  const hook = subtract(intersect(ring(big, inset(big, FS, 136)), above(big.cy)), rect(cx, -BIG, BIG, 528));
  return body(union(lower, hook, rect(0, lo.cy, FS, big.cy + 1)), w);
}

function seven(): Body {
  const w = 505;
  const diag = clip(edgeBand([w, CAP - BAR], [250, 0], 158, -1), 0, 0, w, CAP);
  return body(union(rect(0, CAP - BAR, w, CAP), diag), w, 0, 0);
}

function eight(): Body {
  const w = 525;
  const m0 = 318;
  const m1 = 452;
  const up = ov(w / 2, (m0 + CAP + OS) / 2, w / 2 - 24, (CAP + OS - m0) / 2);
  const lo = ov(w / 2, (m1 - OS) / 2, w / 2, (m1 + OS) / 2);
  return body(union(ring(up, inset(up, 152, 136, m1 - m0)), ring(lo, inset(lo, FS, m1 - m0, 138))), w);
}

function nine(): Body {
  const s = six();
  return { ...s, shape: rotate180(s.shape, s.w / 2, CAP / 2) };
}

// --- Punctuation and symbols --------------------------------------------------

const period = (): Body => body(rect(0, 0, DOT, DOT), DOT, 50);

function commaShape(): Shape {
  return union(
    rect(0, 0, DOT, DOT),
    poly([
      [52, 0],
      [DOT, 0],
      [92, -150],
      [0, -150],
    ]),
  );
}

const comma = (): Body => body(commaShape(), DOT, 50);

const colonDots = (): Shape => union(rect(0, 0, DOT, DOT), rect(0, 430, DOT, 430 + DOT));
const colon = (): Body => body(colonDots(), DOT, 50);
const semicolon = (): Body => body(union(commaShape(), rect(0, 430, DOT, 430 + DOT)), DOT, 50);

function exclam(): Body {
  const w = 176;
  const bar = poly([
    [0, CAP],
    [w, CAP],
    [w - 22, 248],
    [22, 248],
  ]);
  return body(union(bar, rect(3, 0, w - 3, DOT)), w, 46);
}

function question(): Body {
  const w = 470;
  const cx = w / 2;
  const o = ov(cx, 512, cx, 198);
  const i = inset(o, FS, 132);
  const yT = 486;
  // The hook's right side runs into a short stem through a slanted neck: the
  // stem's right edge rises to pOut, its left edge (higher) to pIn.
  const pOut: Pair = [cx + ST / 2, 300];
  const pIn: Pair = [cx - ST / 2, 392];
  const aTo = tangentAngle(o, pOut, -Math.PI / 2, Math.PI / 2, 'min');
  const aTi = tangentAngle(i, pIn, -Math.PI / 2, Math.PI / 2, 'min');
  const outline: Pair[] = [
    ...ovalArc(o, angleAtY(o, yT, 'left'), aTo),
    pOut,
    pIn,
    ...ovalArc(i, aTi, angleAtY(i, yT, 'left')),
  ];
  const stem = rect(cx - ST / 2, 246, cx + ST / 2, pIn[1]);
  return body(union(poly(outline), stem, rect(cx - DOT / 2, 0, cx + DOT / 2, DOT)), w, 30);
}

const hyphen = (): Body => body(rect(0, 266, 270, 266 + 146), 270, 40);
const endash = (): Body => body(rect(0, 266, 480, 266 + 146), 480, 30);
const emdash = (): Body => body(rect(0, 266, 900, 266 + 146), 900, 30);

/** Operators sit on the cap-height centre line and share the figure advance. */
const OPW = 480;
const OPT = 140;
const opBar = (y = MID): Shape => rect(0, y - OPT / 2, OPW, y + OPT / 2);

const plus = (): Body =>
  body(union(opBar(), rect((OPW - OPT) / 2, MID - OPW / 2, (OPW + OPT) / 2, MID + OPW / 2)), OPW);
const minus = (): Body => body(opBar(), OPW);
const equal = (): Body => body(union(opBar(MID - 110), opBar(MID + 110)), OPW);

function divide(): Body {
  const d = 150;
  const dot = (y: number) => rect((OPW - d) / 2, y - d / 2, (OPW + d) / 2, y + d / 2);
  return body(union(opBar(), dot(MID + 192), dot(MID - 192)), OPW);
}

function crossShape(cx: number, cy: number, half: number, t: number): Shape {
  return union(
    band([cx - half, cy - half], [cx + half, cy + half], t),
    band([cx - half, cy + half], [cx + half, cy - half], t),
  );
}

function multiply(): Body {
  const s = crossShape(0, 0, 166, 136);
  return fitBody(translate(s, 0, MID), 0);
}

function slash(): Body {
  const w = 390;
  const t = 140;
  const y0 = -90;
  const y1 = 780;
  let hw = t / 2;
  for (let k = 0; k < 30; k++) hw = (t / 2) * Math.sqrt(1 + ((w - 2 * hw) / (y1 - y0)) ** 2);
  return body(strokeH([hw, y0], [w - hw, y1], t), w, 6);
}

function percent(): Body {
  const w = 800;
  const a = ov(152, 538, 152, 172);
  const b = ov(w - 152, 162, 152, 172);
  const zeroA = ring(a, inset(a, 104, 94));
  const zeroB = ring(b, inset(b, 104, 94));
  return body(union(zeroA, zeroB, strokeH([228, -10], [w - 228, CAP + OS], 120)), w, 30);
}

function numbersign(): Body {
  const w = 610;
  const t = 118;
  const v1 = strokeH([158, 0], [222, CAP], t);
  const v2 = strokeH([388, 0], [452, CAP], t);
  return body(
    clip(union(v1, v2, rect(0, 196, w - 26, 196 + t), rect(26, 388, w, 388 + t)), 0, 0, w, CAP),
    w,
    24,
  );
}

function quoteSingleShape(): Shape {
  return poly([
    [0, CAP],
    [158, CAP],
    [136, 430],
    [22, 430],
  ]);
}

const quotesingle = (): Body => body(quoteSingleShape(), 158, 46);
const quotedbl = (): Body => body(union(quoteSingleShape(), translate(quoteSingleShape(), 228, 0)), 386, 46);

/** Typographic quotes are commas: raised (’), turned (‘) or on the baseline („). */
const quoteRightShape = (): Shape => translate(commaShape(), 0, CAP - DOT);
const pair = (s: Shape, gap = 74): Shape => union(s, translate(s, DOT + gap, 0));

/** Turned comma (‘), its head on the same band as the raised comma. */
const quoteLeftShape = (): Shape => translate(rotate180(commaShape(), DOT / 2, 0), 0, CAP - 150);

function parenShape(): Shape {
  const r0 = 1000;
  const t = 152;
  const y0 = -170;
  const y1 = 790;
  const cy = (y0 + y1) / 2;
  const circ = (r: number) => ov(r0, cy, r, r, 2);
  const arc = subtract(oval(circ(r0)), oval(circ(r0 - t)));
  return clip(arc, 0, y0, 400, y1);
}

function parenleft(): Body {
  const s = parenShape();
  return body(s, 300, 48, 20);
}

function parenright(): Body {
  const s = mirrorX(parenShape(), 300);
  return body(s, 300, 20, 48);
}

function bracketShape(): Shape {
  const t = 150;
  const y0 = -170;
  const y1 = 790;
  return union(rect(0, y0, t, y1), rect(0, y0, 270, y0 + 132), rect(0, y1 - 132, 270, y1));
}

const bracketleft = (): Body => body(bracketShape(), 270, SB, 20);
const bracketright = (): Body => body(mirrorX(bracketShape(), 270), 270, 20, SB);

function ampersand(): Body {
  const w = 690;
  const up = ov(258, 552, 186, 158); // small closed loop, top at cap height + overshoot
  const upInner = inset(up, 130, 116);
  const lo = ov(288, 220, 288, 230); // lower bowl, bottom at -overshoot
  const loInner = inset(lo, 160, 140);
  // The bowl is cut flat just under its counter's top, leaving a left arm and the tail.
  const yArm = loInner.cy + loInner.ry - 16;
  const bowlPart = intersect(ring(lo, loInner), below(yArm));
  const armOut = ovalAt(lo, angleAtY(lo, yArm, 'left'))[0];
  const armIn = ovalAt(loInner, angleAtY(loInner, yArm, 'left'))[0];
  // Left side climbs from the bowl's left arm into the loop.
  const spine = poly([
    [armOut, yArm],
    [armIn, yArm],
    [up.cx - up.rx + 130, up.cy],
    [up.cx - up.rx, up.cy],
  ]);
  const leg = intersect(edgeBand([w, 0], [up.cx + 70, up.cy - 30], 156, -1), below(up.cy));
  const shape = subtract(union(ring(up, upInner), bowlPart, spine, clip(leg, 0, 0, w, CAP)), oval(upInner));
  return body(shape, w, 30, 8);
}

function asterisk(): Body {
  const r = 165;
  const t = 104;
  const cx = r;
  const cy = CAP - r;
  const arms: Shape[] = [];
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 3;
    arms.push(
      band([cx - r * Math.cos(a), cy - r * Math.sin(a)], [cx + r * Math.cos(a), cy + r * Math.sin(a)], t),
    );
  }
  return body(clip(union(...arms), -BIG, -BIG, BIG, CAP), 2 * r, 36);
}

function star(): Body {
  const R = 372;
  const ri = R * 0.47;
  const cx = R * Math.sin((2 * Math.PI) / 5);
  const cy = CAP + OS - R;
  const pts: Pair[] = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? R : ri;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return body(poly(pts), 2 * cx, 30);
}

const bullet = (): Body => body(oval(ov(122, MID, 122, 122, 2)), 244, 50);
const periodcentered = (): Body => body(rect(0, MID - DOT / 2, DOT, MID + DOT / 2), DOT, 50);

function at(): Body {
  const w = 840;
  const cx = w / 2;
  const t = 112; // one stroke weight throughout so the joins are flush
  const outer = ov(cx, 296, cx, 414, 2.2); // -118 .. 710
  const a = ov(cx - 46, 300, 166, 180);
  const stemX0 = a.cx + a.rx - t;
  // Foot: lower half of a ring whose left side is the a-stem and whose right
  // side runs into the outer ring.
  const foot = ov((stemX0 + w) / 2, a.cy, (w - stemX0) / 2, 250);
  const footPart = intersect(ring(foot, inset(foot, t, 100)), below(foot.cy));
  const shell = subtract(ring(outer, inset(outer, t, 100)), rect(foot.cx, -BIG, BIG, foot.cy));
  const stem = rect(stemX0, foot.cy - 1, a.cx + a.rx, a.cy + a.ry);
  return body(union(shell, ring(a, inset(a, t, 104)), stem, footPart), w, 30);
}

function lessShape(): Shape {
  const w = 470;
  const h = 262;
  const s = polyStroke(
    [
      [w + 40, MID + h + 26],
      [62, MID],
      [w + 40, MID - h - 26],
    ],
    142,
  );
  return clip(s, 0, -BIG, w, BIG);
}

const less = (): Body => body(lessShape(), 470, 40);
const greater = (): Body => body(mirrorX(lessShape(), 470), 470, 40);

function arrowRightShape(): Shape {
  const w = 700;
  const shaft = rect(0, MID - 76, w - 260, MID + 76);
  const head = poly([
    [w - 330, MID + 272],
    [w, MID],
    [w - 330, MID - 272],
  ]);
  return union(shaft, head);
}

const arrowright = (): Body => body(arrowRightShape(), 700, 36);
const arrowleft = (): Body => body(mirrorX(arrowRightShape(), 700), 700, 36);
function arrowup(): Body {
  // Rotate the right arrow a quarter turn about its centre, then sit it on x = 0.
  const s = rotate90(arrowRightShape(), 350, MID);
  return body(translate(s, -(350 - 272), 0), 544, 40);
}
function arrowdown(): Body {
  const up = arrowup();
  return { ...up, shape: mirrorY(up.shape, CAP) };
}

const play = (): Body =>
  body(
    poly([
      [0, 40],
      [560, MID],
      [0, CAP - 40],
    ]),
    560,
    60,
    40,
  );

const pause = (): Body => body(union(rect(0, 40, 186, CAP - 40), rect(314, 40, 500, CAP - 40)), 500, 60);

function check(): Body {
  const s = polyStroke(
    [
      [24, 352],
      [236, 92],
      [650, 660],
    ],
    160,
  );
  return fitBody(clip(s, -BIG, 0, BIG, BIG), 20, 14);
}

function cross(): Body {
  const s = crossShape(280, MID, 236, 150);
  return body(s, 560, 30);
}

function ellipsis(): Body {
  const gap = 96;
  return body(
    union(
      rect(0, 0, DOT, DOT),
      rect(DOT + gap, 0, 2 * DOT + gap, DOT),
      rect(2 * (DOT + gap), 0, 3 * DOT + 2 * gap, DOT),
    ),
    3 * DOT + 2 * gap,
    50,
  );
}

function notdef(): Body {
  return body(subtract(rect(0, 0, 480, CAP), rect(70, 70, 410, CAP - 70)), 480, 60);
}

// ---------------------------------------------------------------------------
// Character map
// ---------------------------------------------------------------------------

interface Spec {
  name: string;
  codes: number[];
  make: () => Body;
  /** Fixed advance width; the body is centred in it (tabular figures, operators). */
  advance?: number;
}

const cp = (s: string): number[] => [...s].map((c) => c.codePointAt(0) ?? 0);

const LETTERS: Record<string, () => Body> = {
  A,
  B,
  C,
  D,
  E,
  F,
  G,
  H,
  I,
  J,
  K,
  L,
  M,
  N,
  O,
  P,
  Q,
  R,
  S,
  T,
  U,
  V,
  W,
  X,
  Y,
  Z,
};

/** Composite capital with a mark placed relative to the base body. */
const acute =
  (base: () => Body, dx = 0) =>
  (): Body => {
    const b = base();
    return withMark(b, kreska(b.w / 2 + dx));
  };

const specs: Spec[] = [
  { name: '.notdef', codes: [], make: notdef },
  { name: 'space', codes: [0x20], make: () => body([], 0, 125, 125) },
  { name: 'uni00A0', codes: [0xa0], make: () => body([], 0, 125, 125) },
  { name: 'uni2009', codes: [0x2009], make: () => body([], 0, 80, 80) },
  { name: 'uni202F', codes: [0x202f], make: () => body([], 0, 80, 80) },
];

for (const [ch, make] of Object.entries(LETTERS))
  specs.push({ name: ch, codes: cp(ch + ch.toLowerCase()), make });

specs.push(
  { name: 'Aogonek', codes: cp('Ąą'), make: () => withMark(A(), ogonek(A_FOOT)) },
  { name: 'Cacute', codes: cp('Ćć'), make: acute(C, 14) },
  { name: 'Eogonek', codes: cp('Ęę'), make: () => withMark(E(), ogonek(E().w - 206)) },
  { name: 'Lslash', codes: cp('Łł'), make: Lslash },
  { name: 'Nacute', codes: cp('Ńń'), make: acute(N) },
  { name: 'Oacute', codes: cp('Óó'), make: acute(O) },
  { name: 'Sacute', codes: cp('Śś'), make: acute(S) },
  { name: 'Zacute', codes: cp('Źź'), make: acute(Z) },
  {
    name: 'Zdotaccent',
    codes: cp('Żż'),
    make: () => {
      const z = Z();
      return withMark(z, dotAccent(z.w / 2));
    },
  },
);

const FIGURES = [zero, one, two, three, four, five, six, seven, eight, nine];
const FIGURE_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
FIGURES.forEach((make, d) =>
  specs.push({ name: FIGURE_NAMES[d] ?? `digit${d}`, codes: [0x30 + d], make, advance: FIG_ADV }),
);

specs.push(
  { name: 'period', codes: cp('.'), make: period },
  { name: 'comma', codes: cp(','), make: comma },
  { name: 'colon', codes: cp(':'), make: colon },
  { name: 'semicolon', codes: cp(';'), make: semicolon },
  { name: 'exclam', codes: cp('!'), make: exclam },
  { name: 'question', codes: cp('?'), make: question },
  { name: 'hyphen', codes: [0x2d, 0x2010, 0x2011, 0xad], make: hyphen },
  { name: 'endash', codes: [0x2013], make: endash },
  { name: 'emdash', codes: [0x2014], make: emdash },
  { name: 'plus', codes: cp('+'), make: plus, advance: FIG_ADV },
  { name: 'minus', codes: [0x2212], make: minus, advance: FIG_ADV },
  { name: 'multiply', codes: [0xd7], make: multiply, advance: FIG_ADV },
  { name: 'divide', codes: [0xf7], make: divide, advance: FIG_ADV },
  { name: 'equal', codes: cp('='), make: equal, advance: FIG_ADV },
  { name: 'slash', codes: cp('/'), make: slash },
  { name: 'percent', codes: cp('%'), make: percent },
  { name: 'numbersign', codes: cp('#'), make: numbersign },
  { name: 'quotesingle', codes: cp("'"), make: quotesingle },
  { name: 'quotedbl', codes: cp('"'), make: quotedbl },
  { name: 'quoteright', codes: [0x2019], make: () => body(quoteRightShape(), DOT, 46) },
  { name: 'quoteleft', codes: [0x2018], make: () => body(quoteLeftShape(), DOT, 46) },
  { name: 'quotedblright', codes: [0x201d], make: () => body(pair(quoteRightShape()), 2 * DOT + 74, 46) },
  { name: 'quotedblleft', codes: [0x201c], make: () => body(pair(quoteLeftShape()), 2 * DOT + 74, 46) },
  { name: 'quotedblbase', codes: [0x201e], make: () => body(pair(commaShape()), 2 * DOT + 74, 46) },
  { name: 'parenleft', codes: cp('('), make: parenleft },
  { name: 'parenright', codes: cp(')'), make: parenright },
  { name: 'bracketleft', codes: cp('['), make: bracketleft },
  { name: 'bracketright', codes: cp(']'), make: bracketright },
  { name: 'ampersand', codes: cp('&'), make: ampersand },
  { name: 'asterisk', codes: cp('*'), make: asterisk },
  { name: 'uni2605', codes: [0x2605], make: star },
  { name: 'bullet', codes: [0x2022], make: bullet },
  { name: 'periodcentered', codes: [0xb7], make: periodcentered },
  { name: 'at', codes: cp('@'), make: at },
  { name: 'less', codes: cp('<'), make: less },
  { name: 'greater', codes: cp('>'), make: greater },
  { name: 'arrowleft', codes: [0x2190], make: arrowleft },
  { name: 'arrowup', codes: [0x2191], make: arrowup },
  { name: 'arrowright', codes: [0x2192], make: arrowright },
  { name: 'arrowdown', codes: [0x2193], make: arrowdown },
  { name: 'uni25B6', codes: [0x25b6], make: play },
  { name: 'uni23F8', codes: [0x23f8], make: pause },
  { name: 'uni2713', codes: [0x2713, 0x2714], make: check },
  { name: 'uni2715', codes: [0x2715, 0x2716], make: cross },
  { name: 'ellipsis', codes: [0x2026], make: ellipsis },
);

// ---------------------------------------------------------------------------
// Outline conversion: snap to integers, clean, enforce CFF winding
// ---------------------------------------------------------------------------

/** Twice the signed area (positive = counter-clockwise in y-up space). */
function signedArea(pts: Pair[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pair;
    const q = pts[(i + 1) % pts.length] as Pair;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/** Distance of b from the line through a and c. */
function deviation(a: Pair, b: Pair, c: Pair): number {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (len === 0) return Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / len;
}

/**
 * Round to integer units and drop points that carry no shape: duplicates,
 * collinear points, and the 1-3 unit jogs that clipping leaves where two
 * edges meet almost at a vertex.
 */
function cleanRing(ring: Pair[]): Pair[] {
  const pts: Pair[] = ring.map(([x, y]) => [Math.round(x), Math.round(y)]);
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length >= 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length] as Pair;
      const b = pts[i] as Pair;
      const c = pts[(i + 1) % pts.length] as Pair;
      const shortEdge = Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]));
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (shortEdge === 0 || cross === 0 || (shortEdge <= 3 && deviation(a, b, c) <= 1.5)) {
        pts.splice(i, 1);
        i--;
        changed = true;
      }
    }
  }
  return pts.length >= 3 ? pts : [];
}

/** MultiPolygon -> opentype Path. Outer contours CCW, counters CW (CFF convention). */
function toPath(shape: Shape, dx: number): Path {
  const path = new Path();
  for (const polygon of union(shape)) {
    polygon.forEach((ring, idx) => {
      let pts = cleanRing(ring.map(([x, y]) => [x + dx, y] as Pair));
      if (pts.length === 0) return;
      const ccw = signedArea(pts) > 0;
      if (ccw !== (idx === 0)) pts = pts.reverse();
      pts.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      path.close();
    });
  }
  return path;
}

// ---------------------------------------------------------------------------
// Font assembly
// ---------------------------------------------------------------------------

function buildGlyph(spec: Spec, index: number): Glyph {
  const b = spec.make();
  let lsb = b.l;
  let advance = b.l + b.w + b.r;
  if (spec.advance !== undefined) {
    // Fixed advance: centre the body, nudged by any optical l/r imbalance.
    advance = spec.advance;
    lsb = (advance - b.w) / 2 + (b.l - b.r) / 2;
  }
  const glyph = new Glyph({
    index,
    name: spec.name,
    advanceWidth: Math.round(advance),
    path: toPath(b.shape, Math.round(lsb)),
    ...(spec.codes[0] !== undefined ? { unicode: spec.codes[0] } : {}),
  });
  for (const code of spec.codes.slice(1)) glyph.addUnicode(code);
  return glyph;
}

/** opentype.js stamps head.modified with the wall clock; pin it and fix the checksums. */
function pinHeadTimestamps(buf: ArrayBuffer, unixSeconds: number): void {
  const view = new DataView(buf);
  const numTables = view.getUint16(4);
  const sum = (offset: number, length: number): number => {
    let s = 0;
    for (let i = 0; i < length; i += 4) {
      let word = 0;
      for (let b = 0; b < 4; b++) word = word * 256 + (i + b < length ? view.getUint8(offset + i + b) : 0);
      s = (s + word) % 2 ** 32;
    }
    return s;
  };
  for (let t = 0; t < numTables; t++) {
    const rec = 12 + t * 16;
    const tag = String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(rec + i)));
    if (tag !== 'head') continue;
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    const mac = BigInt(unixSeconds) + 2082844800n;
    view.setBigUint64(offset + 20, mac); // created
    view.setBigUint64(offset + 28, mac); // modified
    view.setUint32(offset + 8, 0); // checkSumAdjustment
    view.setUint32(rec + 4, sum(offset, length));
    view.setUint32(offset + 8, (0xb1b0afba - sum(0, buf.byteLength)) >>> 0);
  }
}

function build(): void {
  const glyphs = specs.map((s, i) => buildGlyph(s, i));
  const font = new Font({
    familyName: 'PRESS Display',
    styleName: 'Regular',
    postScriptName: 'PRESSDisplay-Regular',
    unitsPerEm: UPM,
    ascender: ASCENT,
    descender: DESCENT,
    designer: 'PRESS',
    manufacturer: 'PRESS',
    copyright: 'Copyright 2026 PRESS. Original typeface, generated by scripts/build-font.ts.',
    description:
      'Heavy geometric poster grotesk for the PRESS game. Capitals, Polish letters, tabular figures.',
    version: 'Version 1.000',
    createdTimestamp: TIMESTAMP,
    glyphs,
  });

  const os2 = font.tables['os2'];
  if (!os2) throw new Error('opentype.js did not create an OS/2 table');
  Object.assign(os2, {
    usWeightClass: 400,
    usWidthClass: 4, // semi-condensed
    fsSelection: 0x40 | 0x80, // REGULAR | USE_TYPO_METRICS
    usWinAscent: ASCENT,
    usWinDescent: -DESCENT,
    sCapHeight: CAP,
    sxHeight: CAP,
    ulCodePageRange1: 0b11, // Latin 1 + Latin 2 (Polish)
  });

  const buf = font.toArrayBuffer();
  pinHeadTimestamps(buf, TIMESTAMP);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(buf));

  // Sanity check: parse it back and make sure every mapped character resolves.
  const check = parse(buf);
  let yMin = 0;
  let yMax = 0;
  for (const g of glyphs) {
    const bb = g.getBoundingBox();
    yMin = Math.min(yMin, bb.y1);
    yMax = Math.max(yMax, bb.y2);
  }
  for (const s of specs) {
    for (const c of s.codes) {
      if (check.charToGlyphIndex(String.fromCodePoint(c)) <= 0)
        throw new Error(`U+${c.toString(16)} is not mapped`);
    }
  }
  if (yMax > 920 || yMin < -220) throw new Error(`outlines exceed the vertical budget: ${yMin}..${yMax}`);
  console.log(
    `PRESS Display: ${glyphs.length} glyphs, ${specs.reduce((n, s) => n + s.codes.length, 0)} code points, ` +
      `ink ${yMin}..${yMax}, ${buf.byteLength} bytes -> ${OUT}`,
  );
}

build();
