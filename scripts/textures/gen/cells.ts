/**
 * Board cell tiles, 128×128 px (3× of a 42 dp cell):
 *  - ink_<k>_<v>: a printed type-block face — solid riso ink with mottle and paper grain dropouts,
 *    a misregistered halftone overprint of the darker shade (multiply) and an ink keyline;
 *  - ink_<k>_hl: lighter, more saturated highlight / ghost face;
 *  - blind_<v>: blind emboss (no ink) with a 2 dp bevel and a debossed ✕;
 *  - lead_<v>: leftover lead slug with horizontal hatching;
 *  - jam: riveted steel plate on an ink-stained square;
 *  - cell_empty: a faint debossed slot.
 *
 * GDD hard rule: every filled cell carries an INK keyline ≥ 1.5 dp (here 4.5 px at 3×, 62 % alpha).
 */
import { BLIND_FACE, INK, INKS, INKS_DARK, JAM_DARK, LEAD_GREY, PAPER_SHADE } from '../../../src/theme';
import { CELL_PX } from '../spec';
import { Field, Raster, strokeField } from './raster';
import {
  Rng,
  band,
  brighten,
  clamp01,
  dotHash,
  fbm,
  fbmS,
  fill,
  halftone,
  hash2,
  mixRgb,
  rationalScreen,
  rgb,
  sdCircle,
  sdRoundRect,
  sdSegment,
  seedOf,
  smoothstep,
  vnoise,
} from './math';
import type { RGB, Screen } from './math';

const C = CELL_PX;
const INSET = 6.5;
const RADIUS = 9;
const OUTLINE_W = 4.5;
const OUTLINE_A = 0.7;
export const INK_RGB = rgb(INK);
export const WHITE: RGB = [1, 1, 1];

/**
 * Per-ink screens with rational tangents (0°, 18.43°, 26.57°, 45°, 71.57°). Each lattice repeats
 * exactly every 128 px, so screens run on seamlessly across neighbouring cells. Pitch ≈ 10 px (3.3 dp).
 */
export const INK_SCREENS: readonly Screen[] = [
  rationalScreen(3, 1, 4, C), // pink    71.57°, pitch 10.12
  rationalScreen(1, 3, 4, C), // orange  18.43°, pitch 10.12
  rationalScreen(0, 1, 13, C), // yellow  0°,    pitch  9.85
  rationalScreen(1, 2, 6, C), // teal    26.57°, pitch  9.54
  rationalScreen(1, 1, 9, C), // blue    45°,    pitch 10.06
];

/** Misregistration of the dark overprint per edge variant (px at 3×). */
const REGISTRATION: readonly (readonly [number, number])[] = [
  [2.5, 2.0],
  [-2.2, 2.4],
  [2.6, -1.8],
  [-1.9, -2.6],
];

const faceSd = (x: number, y: number, inset = INSET, r = RADIUS): number =>
  sdRoundRect(x, y, inset, inset, C - inset, C - inset, r);

/** Ink spread: signed edge displacement (px) — positive grows the shape. */
function ragged(x: number, y: number, seed: number, amp: number): number {
  return amp * ((vnoise(x / 7, y / 7, seed) - 0.5) * 1.3 + (vnoise(x / 1.9, y / 1.9, seed + 1) - 0.5) * 1.1);
}

/** Paper grain dropouts: 0 = full ink, 1 = paper shows through (small clustered specks). */
function grain(x: number, y: number, seed: number): number {
  const fine = vnoise(x / 1.2, y / 1.2, seed);
  const cluster = vnoise(x / 7, y / 7, seed + 1);
  return smoothstep(0.84, 0.97, fine) * smoothstep(0.5, 0.85, cluster) * 0.75;
}

/** Key (black) plate outline: its own slight edge noise, ≥ 1.5 dp at ≥ 60 % (GDD hard rule). */
function keyline(r: Raster, p: number, sd: number, g: number): void {
  r.put(p, INK_RGB, band(sd + 0.9, OUTLINE_W) * OUTLINE_A * (1 - 0.2 * g));
}

/** Sub-pixel registration of the colour plate against the key plate, per variant. */
const COLOUR_SHIFT: readonly (readonly [number, number])[] = [
  [-0.6, -0.4],
  [0.5, -0.6],
  [-0.4, 0.6],
  [0.6, 0.4],
];

/** How strongly each dark shade is overprinted (teal's dark is far darker relative to its ink). */
const DARK_STRENGTH = [0.92, 0.9, 0.95, 0.62, 0.78] as const;

export function inkCell(k: number, v: number): Raster {
  const seed = seedOf('ink', k, v);
  const ink = rgb(INKS[k]!);
  const dark = rgb(INKS_DARK[k]!);
  const sc = INK_SCREENS[k]!;
  const strength = DARK_STRENGTH[k]!;
  const [ox, oy] = REGISTRATION[v]!;
  const edge = C - INSET;
  const r = new Raster(C, C);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const p = y * C + x;
      const [cx, cy] = COLOUR_SHIFT[v]!;
      const sd = faceSd(px - cx, py - cy) - ragged(px, py, seed, 0.75);
      const sdKey = faceSd(px, py) - ragged(px, py, seed + 20, 0.45);
      const g = grain(px, py, seed + 11);
      const diag = (px + py) / (2 * C);
      const aInk = fill(sd);
      if (aInk > 0) {
        // Colour plate: solid with mottle; the lit top-left corner opens into fine paper holes.
        const mottle = 0.88 + 0.12 * fbm(px / 8, py / 8, seed + 2, 3);
        const tone = 1 - 0.24 * smoothstep(0.42, 0.04, diag);
        const gain = (vnoise(px / 1.3, py / 1.3, seed + 6) - 0.5) * 0.06;
        r.put(p, ink, aInk * mottle * halftone(sc, px, py, tone, gain) * (1 - g));
      }
      // Dark plate, misregistered: halftone shadow towards the bottom-right + a dense rim on the
      // bottom and right inner edges (so the registration offset is visible against the keyline).
      const qx = px - ox;
      const qy = py - oy;
      const aD = fill(faceSd(qx, qy) - ragged(qx, qy, seed + 3, 0.75) - 0.5);
      if (aD > 0) {
        const rim = Math.max(smoothstep(10, 3, edge - qx), smoothstep(10, 3, edge - qy));
        const shade = 0.36 * smoothstep(0.45, 1, diag) + 0.06 * fbmS(px / 22, py / 22, seed + 4, 2);
        const tone = Math.max(shade, 0.62 * rim);
        const gain =
          (dotHash(sc, px, py, seed + 5) - 0.5) * 0.06 + (vnoise(px / 1.3, py / 1.3, seed + 7) - 0.5) * 0.06;
        r.put(p, dark, aD * halftone(sc, px, py, tone, gain) * strength * (1 - 0.8 * g), 'multiply');
      }
      keyline(r, p, sdKey, g);
    }
  }
  return r;
}

export function inkHighlightCell(k: number): Raster {
  const seed = seedOf('ink-hl', k);
  const ink = rgb(INKS[k]!);
  const light = brighten(ink, k === 3 ? 0.12 : 0.08, 0.15);
  const sc = INK_SCREENS[k]!;
  const r = new Raster(C, C);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const p = y * C + x;
      const sd = faceSd(px, py) - ragged(px, py, seed, 0.7);
      const g = grain(px, py, seed + 11) * 0.7;
      const aInk = fill(sd);
      if (aInk > 0) {
        r.put(p, light, aInk * (0.9 + 0.1 * fbm(px / 9, py / 9, seed + 2, 3)) * (1 - 0.8 * g));
        const tone = 0.18 + 0.1 * fbmS(px / 22, py / 22, seed + 4, 2);
        r.put(p, ink, aInk * halftone(sc, px, py, tone) * 0.8, 'multiply');
        // Inner glint along the top-left (lit) edge.
        const glint =
          smoothstep(-9, -3.5, sd) * (1 - smoothstep(-3.5, -1.5, sd)) * clamp01(1.2 - (px + py) / C);
        r.put(p, WHITE, glint * 0.55, 'screen');
      }
      keyline(r, p, sd, g);
    }
  }
  return r;
}

export function blindCell(v: number): Raster {
  const seed = seedOf('blind', v);
  const face = rgb(BLIND_FACE);
  const rot = v === 0 ? -0.035 : 0.05;
  const cx = 64 + (v === 0 ? -0.6 : 0.8);
  const cy = 64 + (v === 0 ? 0.5 : -0.4);
  const arm = 39; // with the stroke, the ✕ spans ~64 px = 50 % of the cell
  const seg = (a: number): [number, number, number, number] => [
    cx - Math.cos(a) * arm,
    cy - Math.sin(a) * arm,
    cx + Math.cos(a) * arm,
    cy + Math.sin(a) * arm,
  ];
  const s1 = seg(Math.PI / 4 + rot);
  const s2 = seg((3 * Math.PI) / 4 + rot);
  const hw = 6;
  const sdF = new Field(C, C).set((x, y) => faceSd(x, y) - ragged(x, y, seed, 0.35));
  const groove = new Field(C, C).set((x, y) => {
    const d = Math.min(sdSegment(x, y, ...s1), sdSegment(x, y, ...s2)) + ragged(x, y, seed + 2, 0.3);
    return smoothstep(hw + 1.8, hw - 1.8, d);
  });
  const height = new Field(C, C).set((x, y) => {
    const i = Math.floor(y) * C + Math.floor(x);
    return 6 * smoothstep(0, 6.5, -sdF.v[i]!) - 3.4 * groove.v[i]!;
  });
  const r = new Raster(C, C);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const p = y * C + x;
      const sd = sdF.v[p]!;
      const a = fill(sd);
      if (a > 0) {
        r.put(p, face, a);
        r.put(p, INK_RGB, a * (0.025 + 0.03 * fbm(px / 7, py / 7, seed + 3, 3)));
        r.put(p, INK_RGB, a * groove.v[p]! * 0.07);
        const s = height.relief(x, y);
        r.put(p, WHITE, a * clamp01(s * 1.2) * 0.95);
        r.put(p, INK_RGB, a * clamp01(-s * 0.85) * 0.45);
      }
      keyline(r, p, sd, 0);
    }
  }
  return r;
}

export function leadCell(v: number): Raster {
  const seed = seedOf('lead', v);
  const rng = new Rng(seed);
  const grey = rgb(LEAD_GREY);
  const sdF = new Field(C, C).set((x, y) => faceSd(x, y, INSET, 5) - ragged(x, y, seed, 0.25));
  // Engraved horizontal hatching every 16 px (8 lines per cell, continuous across cells).
  const hatch = (y: number): number => {
    const t = (((y - 5) % 16) + 16) % 16;
    return smoothstep(0, 1.3, t) * smoothstep(3.8, 2.4, t);
  };
  const scratches = new Field(C, C);
  for (let i = 0; i < 9; i++) {
    const x0 = rng.range(12, 116);
    const y0 = rng.range(12, 116);
    const ang = rng.range(-0.5, 0.5) + (rng.next() < 0.5 ? 0 : Math.PI / 2.4);
    const len = rng.range(8, 34);
    strokeField(
      scratches,
      [
        [x0, y0],
        [x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len],
      ],
      rng.range(0.5, 0.9),
      rng.range(0.4, 0.9),
    );
  }
  const dents: [number, number, number][] = [];
  for (let i = 0; i < (v === 0 ? 2 : 4); i++)
    dents.push([rng.range(20, 108), rng.range(20, 108), rng.range(2, 4.5)]);
  const height = new Field(C, C).set((x, y) => {
    const sd = sdF.at(Math.floor(x), Math.floor(y));
    let h = 3 * smoothstep(0, 4.5, -sd) - 1.3 * hatch(y);
    for (const [dx, dy, dr] of dents) h -= 1.2 * smoothstep(dr + 1, dr - 1.5, Math.hypot(x - dx, y - dy));
    return h;
  });
  const r = new Raster(C, C);
  r.paintRgb((px, py, out) => {
    const p = Math.floor(py) * C + Math.floor(px);
    const a = fill(sdF.v[p]!);
    if (a <= 0) return 0;
    const yy = py / C;
    let k =
      1.13 -
      0.24 * yy +
      0.11 * Math.exp(-(((py - 30) / 11) ** 2)) -
      0.05 * Math.exp(-(((py - 98) / 16) ** 2));
    k *=
      1 + 0.07 * (vnoise(px / 70, py / 0.9, seed + 1) - 0.5) + 0.03 * (hash2(px | 0, py | 0, seed + 2) - 0.5);
    k *= 1 - 0.09 * smoothstep(0.55, 0.8, fbm(px / 16, py / 16, seed + 3, 3));
    out[0] = clamp01(grey[0] * k * 0.99);
    out[1] = clamp01(grey[1] * k);
    out[2] = clamp01(grey[2] * k * 1.02);
    return a;
  });
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const p = y * C + x;
      const sd = sdF.v[p]!;
      const a = fill(sd);
      if (a > 0) {
        const s = height.relief(x, y);
        r.put(p, WHITE, a * clamp01(s * 1.2) * 0.7);
        r.put(p, INK_RGB, a * clamp01(-s * 1.0) * 0.6);
        const sc = scratches.v[p]!;
        r.put(p, (x + y) % 3 === 0 ? INK_RGB : WHITE, a * sc * 0.28);
      }
      keyline(r, p, sd, 0);
    }
  }
  return r;
}

export function jamCell(): Raster {
  const seed = seedOf('jam');
  const plate = rgb(JAM_DARK);
  const steel: RGB = [0.47, 0.45, 0.45];
  const R = 26;
  const corners: [number, number][] = [
    [21, 21],
    [107, 21],
    [21, 107],
    [107, 107],
  ];
  const rc = 5.5;
  const sdF = new Field(C, C).set((x, y) => faceSd(x, y, 5.5, 8) - ragged(x, y, seed, 0.6));
  const dome = (d: number, rad: number, hgt: number): number =>
    d < rad ? hgt * Math.sqrt(1 - (d / rad) ** 2) : 0;
  const height = new Field(C, C).set((x, y) => {
    const sd = sdF.at(Math.floor(x), Math.floor(y));
    let h = 2.5 * smoothstep(0, 4, -sd);
    const d = Math.hypot(x - 64, y - 64);
    h += 1.6 * smoothstep(R + 5.5, R + 3.5, d); // flange
    h += dome(d, R, 15);
    for (const [cx, cy] of corners) h += dome(Math.hypot(x - cx, y - cy), rc, 4);
    return h;
  });
  const r = new Raster(C, C);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const p = y * C + x;
      const sd = sdF.v[p]!;
      const a = fill(sd);
      if (a > 0) {
        // Ink-stained plate.
        const stain = fbm(px / 15, py / 15, seed + 1, 4);
        const k = 0.8 + 0.4 * stain;
        r.put(p, [plate[0] * k, plate[1] * k, plate[2] * k], a);
        const pool = smoothstep(0.56, 0.68, fbm(px / 11 + 7, py / 11, seed + 2, 4));
        r.put(p, INK_RGB, a * pool * 0.75);
        r.put(p, WHITE, a * smoothstep(0.62, 0.8, fbm(px / 5, py / 40, seed + 3, 2)) * 0.06);
        // Cast shadows of the rivets.
        const sh = Math.max(
          smoothstep(R + 9, R - 2, Math.hypot(px - 64 - 4.5, py - 64 - 5.5)),
          ...corners.map(([cx, cy]) => smoothstep(rc + 3.5, rc - 1, Math.hypot(px - cx - 2, py - cy - 2.2))),
        );
        r.put(p, INK_RGB, a * sh * 0.7);
        // Rivet heads.
        const d = Math.hypot(px - 64, py - 64);
        const head = Math.max(
          fill(d - R),
          fill(d - R - 5) * smoothstep(R + 5.5, R + 3.5, d) * 0.9,
          ...corners.map(([cx, cy]) => fill(sdCircle(px, py, cx, cy, rc))),
        );
        if (head > 0) {
          const radial = clamp01(1 - d / R);
          r.put(p, mixRgb(steel, [0.62, 0.6, 0.6], radial * 0.5), a * head);
        }
        const s = height.relief(x, y);
        r.put(p, WHITE, a * clamp01(s * 0.9) * 0.8);
        r.put(p, INK_RGB, a * clamp01(-s * 0.7) * 0.85);
        // Specular hot spots.
        const spec = Math.exp(-((px - 64 + 9.5) ** 2 + (py - 64 + 10.5) ** 2) / 26);
        r.put(p, WHITE, a * fill(d - R) * spec * 0.9);
        for (const [cx, cy] of corners) {
          r.put(p, WHITE, a * Math.exp(-((px - cx + 2) ** 2 + (py - cy + 2) ** 2) / 3) * 0.75);
        }
        // Dark rim around the dome.
        r.put(p, INK_RGB, a * band(d - R, 1.6) * 0.7);
      }
      keyline(r, p, sd, 0);
    }
  }
  return r;
}

export function emptyCell(): Raster {
  const seed = seedOf('empty');
  const shade = rgb(PAPER_SHADE);
  const sdF = new Field(C, C).set((x, y) => faceSd(x, y) - ragged(x, y, seed, 0.25));
  const height = new Field(C, C).set(
    (x, y) => -2.2 * smoothstep(0, 4.5, -sdF.at(Math.floor(x), Math.floor(y))),
  );
  const r = new Raster(C, C);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const p = y * C + x;
      const a = fill(sdF.v[p]! - 1);
      r.put(p, shade, a * 0.22);
      const s = height.relief(x, y);
      r.put(p, WHITE, clamp01(s) * 0.5);
      r.put(p, INK_RGB, clamp01(-s) * 0.17);
    }
  }
  return r;
}
