/**
 * Numeric building blocks of the procedural texture generator: seeded PRNG and hashing,
 * tileable value noise, signed distance functions, rational-tangent halftone screens and
 * colour helpers. Pure (no DOM): runs in the headless page, could run anywhere.
 *
 * Determinism rule: nothing here (or anywhere in scripts/textures) may use Math.random.
 */

// ---------------------------------------------------------------------------
// Hashing and PRNG
// ---------------------------------------------------------------------------

export const GLOBAL_SEED = 0x2026_0d22;

export function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable seed from any key parts (frame name, variant...). */
export function seedOf(...parts: (string | number)[]): number {
  return mix32(hashString(parts.join('/')) ^ GLOBAL_SEED);
}

/** Integer lattice hash → [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  return mix32(mix32((x | 0) ^ seed) ^ Math.imul(y | 0, 0x9e3779b1)) / 4294967296;
}

/** mulberry32 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Approximately normal (Irwin–Hall, 4 samples), mean 0, sd 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }
}

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const mod = (a: number, n: number): number => ((a % n) + n) % n;

// ---------------------------------------------------------------------------
// Value noise (optionally periodic → seamless tiles)
// ---------------------------------------------------------------------------

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [0, 1]. With period > 0 the lattice wraps every `period` units. */
export function vnoise(x: number, y: number, seed: number, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  let x0 = xi;
  let x1 = xi + 1;
  let y0 = yi;
  let y1 = yi + 1;
  if (period > 0) {
    x0 = mod(x0, period);
    x1 = mod(x1, period);
    y0 = mod(y0, period);
    y1 = mod(y1, period);
  }
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in [0, 1]; octave i has frequency 2^i and (if period > 0) period period·2^i. */
export function fbm(x: number, y: number, seed: number, octaves = 4, period = 0, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, (seed + i * 7919) | 0, period > 0 ? period * f : 0);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** fbm re-centred to roughly [-1, 1] with a more even spread. */
export function fbmS(x: number, y: number, seed: number, octaves = 4, period = 0): number {
  return clamp((fbm(x, y, seed, octaves, period) - 0.5) * 3.2, -1, 1);
}

// ---------------------------------------------------------------------------
// Signed distance functions (pixel units, negative inside)
// ---------------------------------------------------------------------------

export function sdRoundRect(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): number {
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - (x0 + x1) / 2) - hx;
  const qy = Math.abs(py - (y0 + y1) / 2) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.hypot(px - cx, py - cy) - r;
}

export function sdSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
  return Math.hypot(wx - ex * t, wy - ey * t);
}

/** Exact SDF of a simple polygon (Inigo Quilez). */
export function sdPolygon(px: number, py: number, pts: readonly (readonly [number, number])[]): number {
  const n = pts.length;
  const p0 = pts[0]!;
  let d = (px - p0[0]) ** 2 + (py - p0[1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vi = pts[i]!;
    const vj = pts[j]!;
    const ex = vj[0] - vi[0];
    const ey = vj[1] - vi[1];
    const wx = px - vi[0];
    const wy = py - vi[1];
    const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
    const bx = wx - ex * t;
    const by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= vi[1];
    const c2 = py < vj[1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** Polynomial smooth minimum (blobby unions). */
export function smin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Anti-aliased coverage of the region sd < 0. */
export const fill = (sd: number): number => clamp01(0.5 - sd);
/** Anti-aliased coverage of a band of width w centred on sd = 0. */
export const band = (sd: number, w: number): number => clamp01(w / 2 + 0.5 - Math.abs(sd));

// ---------------------------------------------------------------------------
// Halftone screens
// ---------------------------------------------------------------------------

export interface Screen {
  readonly pitch: number;
  readonly cos: number;
  readonly sin: number;
  readonly angleDeg: number;
  /** Lattice repeat (px) the screen was built for. */
  readonly tile: number;
}

/**
 * A rational-tangent screen: tan(angle) = a/b with gcd(a, b) = 1. The lattice repeats exactly every
 * `tile` pixels in x and y (j·(b, −a) and j·(a, b) lattice steps), so the dots continue without a
 * seam across neighbouring tiles. pitch = tile / (j·√(a²+b²)).
 */
export function rationalScreen(a: number, b: number, j: number, tile: number): Screen {
  const len = Math.hypot(a, b);
  return {
    pitch: tile / (j * len),
    cos: b / len,
    sin: a / len,
    angleDeg: (Math.atan2(a, b) * 180) / Math.PI,
    tile,
  };
}

/** Threshold of the cosine spot function for each tone (so that coverage ≈ tone). */
const SPOT_LUT = (() => {
  const n = 160;
  const vals = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      vals[y * n + x] =
        (Math.cos((2 * Math.PI * (x + 0.5)) / n) + Math.cos((2 * Math.PI * (y + 0.5)) / n)) / 2;
    }
  }
  vals.sort();
  const lut = new Float64Array(257);
  for (let i = 0; i <= 256; i++) {
    const q = 1 - i / 256; // tone i/256 → the (1−tone) quantile
    lut[i] = vals[Math.min(vals.length - 1, Math.max(0, Math.round(q * (vals.length - 1))))]!;
  }
  return lut;
})();

function spotThreshold(tone: number): number {
  const f = clamp01(tone) * 256;
  const i = Math.min(255, Math.floor(f));
  return lerp(SPOT_LUT[i]!, SPOT_LUT[i + 1]!, f - i);
}

/**
 * Anti-aliased coverage of a halftone screen at pixel centre (x, y) for the given tone (0..1).
 * Cosine spot: round dots in highlights, checkerboard at 50 %, round holes in shadows.
 * `gain` shifts the threshold (riso dot gain / starvation jitter), in tone-ish units.
 */
export function halftone(s: Screen, x: number, y: number, tone: number, gain = 0): number {
  const t = tone + gain;
  if (t <= 0.004) return 0;
  if (t >= 0.996) return 1;
  const m = (x * s.cos + y * s.sin) / s.pitch;
  const n = (-x * s.sin + y * s.cos) / s.pitch;
  const am = 2 * Math.PI * m;
  const an = 2 * Math.PI * n;
  const f = (Math.cos(am) + Math.cos(an)) / 2;
  const sm = Math.sin(am);
  const sn = Math.sin(an);
  const grad = (Math.PI / s.pitch) * Math.sqrt(sm * sm + sn * sn);
  const cov = clamp01((f - spotThreshold(t)) / Math.max(grad, 0.03) + 0.5);
  // Sub-pixel dots / holes fade by their true size instead of popping in at 50 % coverage.
  if (t < 0.5) return cov * smoothstep(0, 1.2, s.pitch * Math.sqrt(t / Math.PI));
  return 1 - (1 - cov) * smoothstep(0, 1.2, s.pitch * Math.sqrt((1 - t) / Math.PI));
}

/** Per-dot random in [0,1): identical for the same dot in every tile of the screen's lattice. */
export function dotHash(s: Screen, x: number, y: number, seed: number): number {
  const m = Math.round((x * s.cos + y * s.sin) / s.pitch);
  const n = Math.round((-x * s.sin + y * s.cos) / s.pitch);
  const cx = (m * s.cos - n * s.sin) * s.pitch;
  const cy = (m * s.sin + n * s.cos) * s.pitch;
  const qx = Math.round(mod(cx, s.tile) * 8) % (s.tile * 8);
  const qy = Math.round(mod(cy, s.tile) * 8) % (s.tile * 8);
  return hash2(qx, qy, seed);
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type RGB = readonly [number, number, number];

export const rgb = (hex: number): RGB => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

export const scaleRgb = (a: RGB, k: number): RGB => [clamp01(a[0] * k), clamp01(a[1] * k), clamp01(a[2] * k)];

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = (t: number): number => {
    const u = mod(t, 1);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** Lighter, more saturated version of an ink (highlight / ghost frames). */
export function brighten(c: RGB, dl: number, ds: number): RGB {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb(h, clamp01(s + ds), clamp01(l + dl));
}
