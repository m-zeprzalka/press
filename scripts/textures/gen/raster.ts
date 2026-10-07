/**
 * Float RGBA raster (premultiplied, 0..1) with the few compositing modes a print simulation needs.
 * Frames are composed per pixel here and only quantised once, so low-alpha edges keep their colour
 * (no premultiplied 8-bit canvas round trips).
 */
import { clamp01 } from './math';
import type { RGB } from './math';

export type Blend = 'normal' | 'multiply' | 'screen' | 'erase' | 'atop';

export class Raster {
  readonly data: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Float32Array(w * h * 4);
  }

  /** Composite a straight-alpha colour onto pixel p (= y·w + x). */
  put(p: number, c: RGB, a: number, mode: Blend = 'normal'): void {
    if (!(a > 0)) return;
    if (a > 1) a = 1;
    const d = this.data;
    const i = p * 4;
    const dr = d[i]!;
    const dg = d[i + 1]!;
    const db = d[i + 2]!;
    const da = d[i + 3]!;
    const sr = c[0] * a;
    const sg = c[1] * a;
    const sb = c[2] * a;
    const k = 1 - a;
    switch (mode) {
      case 'normal':
        d[i] = sr + dr * k;
        d[i + 1] = sg + dg * k;
        d[i + 2] = sb + db * k;
        d[i + 3] = a + da * k;
        break;
      case 'multiply': {
        const kb = 1 - da;
        d[i] = sr * dr + sr * kb + dr * k;
        d[i + 1] = sg * dg + sg * kb + dg * k;
        d[i + 2] = sb * db + sb * kb + db * k;
        d[i + 3] = a + da - a * da;
        break;
      }
      case 'screen':
        d[i] = sr + dr - sr * dr;
        d[i + 1] = sg + dg - sg * dg;
        d[i + 2] = sb + db - sb * db;
        d[i + 3] = a + da - a * da;
        break;
      case 'erase':
        d[i] = dr * k;
        d[i + 1] = dg * k;
        d[i + 2] = db * k;
        d[i + 3] = da * k;
        break;
      case 'atop':
        d[i] = sr * da + dr * k;
        d[i + 1] = sg * da + dg * k;
        d[i + 2] = sb * da + db * k;
        break;
    }
  }

  /** For every pixel centre, composite `color` with the alpha returned by fn. */
  paint(color: RGB, fn: (x: number, y: number) => number, mode: Blend = 'normal'): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const a = fn(x + 0.5, y + 0.5);
        if (a > 0) this.put(y * this.w + x, color, a, mode);
      }
    }
    return this;
  }

  /** For every pixel centre, fn writes a colour into `out` and returns its alpha. */
  paintRgb(
    fn: (x: number, y: number, out: [number, number, number]) => number,
    mode: Blend = 'normal',
  ): this {
    const out: [number, number, number] = [0, 0, 0];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const a = fn(x + 0.5, y + 0.5, out);
        if (a > 0) this.put(y * this.w + x, out, a, mode);
      }
    }
    return this;
  }

  /** Alpha (coverage) at pixel (x, y), 0 outside. */
  alphaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3]!;
  }

  /** Straight-alpha RGBA8 (transparent pixels are written as 0,0,0,0). */
  toRGBA8(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    const d = this.data;
    for (let i = 0; i < out.length; i += 4) {
      const a = clamp01(d[i + 3]!);
      const a8 = Math.round(a * 255);
      if (a8 === 0) continue;
      const inv = 1 / a;
      out[i] = Math.round(clamp01(d[i]! * inv) * 255);
      out[i + 1] = Math.round(clamp01(d[i + 1]! * inv) * 255);
      out[i + 2] = Math.round(clamp01(d[i + 2]! * inv) * 255);
      out[i + 3] = a8;
    }
    return out;
  }
}

/** Scalar field helper (height maps, masks). */
export class Field {
  readonly v: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.v = new Float32Array(w * h);
  }
  set(fn: (x: number, y: number) => number): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.v[y * this.w + x] = fn(x + 0.5, y + 0.5);
    return this;
  }
  at(x: number, y: number): number {
    const xi = x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
    const yi = y < 0 ? 0 : y >= this.h ? this.h - 1 : y;
    return this.v[yi * this.w + xi]!;
  }
  /**
   * Emboss shading of a height map lit from the top-left: the slope along the light direction
   * (positive = facing the light). Units: height px per px.
   */
  relief(x: number, y: number): number {
    const gx = (this.at(x + 1, y) - this.at(x - 1, y)) / 2;
    const gy = (this.at(x, y + 1) - this.at(x, y - 1)) / 2;
    return (gx + gy) * Math.SQRT1_2;
  }
}

/**
 * Accumulate an anti-aliased polyline stroke into a coverage field (screen-union of coverages).
 * With wrap = true the stroke wraps around the field edges (seamless tiles).
 */
export function strokeField(
  f: Field,
  pts: readonly (readonly [number, number])[],
  width: number,
  alpha: number,
  wrap = false,
): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const m = width / 2 + 1.5;
  const bx0 = Math.floor(x0 - m);
  const by0 = Math.floor(y0 - m);
  const bx1 = Math.ceil(x1 + m);
  const by1 = Math.ceil(y1 + m);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      let xi = x;
      let yi = y;
      if (wrap) {
        xi = ((x % f.w) + f.w) % f.w;
        yi = ((y % f.h) + f.h) % f.h;
      } else if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const wx = px - a[0];
        const wy = py - a[1];
        const len2 = ex * ex + ey * ey;
        const t = len2 > 0 ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / len2)) : 0;
        d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
      }
      const cov = width < 1 ? width * Math.max(0, 1 - d) : Math.min(1, Math.max(0, width / 2 + 0.5 - d));
      if (cov <= 0) continue;
      const idx = yi * f.w + xi;
      const prev = f.v[idx]!;
      f.v[idx] = 1 - (1 - prev) * (1 - cov * alpha);
    }
  }
}

/** Points along a quadratic Bézier. */
export function quad(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  n = 8,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]);
  }
  return out;
}
