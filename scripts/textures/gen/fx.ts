/**
 * Effect frames: colour-blind symbols, ink droplets and splats (white → tinted at runtime),
 * torn paper flecks, the press platen, the rubber-stamp ring, soft glow and burst ring.
 */
import { PAPER } from '../../../src/theme';
import { Raster } from './raster';
import {
  Rng,
  band,
  clamp01,
  fbm,
  fill,
  halftone,
  hash2,
  mixRgb,
  rationalScreen,
  rgb,
  sdCircle,
  sdPolygon,
  sdRoundRect,
  seedOf,
  smin,
  smoothstep,
  vnoise,
} from './math';
import { INK_RGB, WHITE } from './cells';

type Pt = readonly [number, number];

// ---------------------------------------------------------------------------
// Colour-blind symbols ● ▲ ■ ◆ ✚ (GDD §17), 56×56, pure white
// ---------------------------------------------------------------------------

export function symbol(k: number, S: number): Raster {
  const c = S / 2;
  let sd: (x: number, y: number) => number;
  switch (k) {
    case 0:
      sd = (x, y) => sdCircle(x, y, c, c, 19.5);
      break;
    case 1: {
      const tri: Pt[] = [
        [c, 7],
        [c + 22, 46],
        [c - 22, 46],
      ];
      sd = (x, y) => sdPolygon(x, y, tri) - 1;
      break;
    }
    case 2:
      sd = (x, y) => sdRoundRect(x, y, c - 17, c - 17, c + 17, c + 17, 2.5);
      break;
    case 3: {
      const dia: Pt[] = [
        [c, c - 23.5],
        [c + 23.5, c],
        [c, c + 23.5],
        [c - 23.5, c],
      ];
      sd = (x, y) => sdPolygon(x, y, dia) - 0.8;
      break;
    }
    default:
      sd = (x, y) =>
        Math.min(
          sdRoundRect(x, y, c - 22, c - 7.5, c + 22, c + 7.5, 1.5),
          sdRoundRect(x, y, c - 7.5, c - 22, c + 7.5, c + 22, 1.5),
        );
  }
  return new Raster(S, S).paint(WHITE, (x, y) => fill(sd(x, y)));
}

// ---------------------------------------------------------------------------
// Ink droplets and splats
// ---------------------------------------------------------------------------

type Blob = [number, number, number];

function blobSd(x: number, y: number, blobs: readonly Blob[], k: number): number {
  let d = Infinity;
  for (const [bx, by, br] of blobs) {
    const s = sdCircle(x, y, bx, by, br);
    d = d === Infinity ? s : smin(d, s, k);
  }
  return d;
}

export function drop(i: number, S: number): Raster {
  const seed = seedOf('drop', i);
  const rng = new Rng(seed);
  const R = S * 0.25;
  const cx = S / 2 + rng.range(-0.03, 0.03) * S;
  const cy = S / 2 + rng.range(-0.03, 0.03) * S;
  const blobs: Blob[] = [[cx, cy, R]];
  for (let j = 0; j < 3; j++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.25, 0.55) * R;
    blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rng.range(0.45, 0.72)]);
  }
  const th = rng.range(0, Math.PI * 2);
  for (let j = 1; j <= 2; j++) {
    const d = R * (0.72 + 0.32 * j);
    blobs.push([cx + Math.cos(th) * d, cy + Math.sin(th) * d, R * (0.4 - 0.11 * j)]);
  }
  const sats: Blob[] = [];
  const n = 3 + rng.int(4);
  for (let j = 0; j < n; j++) {
    const rr = S * rng.range(0.022, 0.055);
    const a = j === 0 ? th + rng.range(-0.25, 0.25) : rng.range(0, Math.PI * 2);
    const d = Math.min(R * rng.range(1.35, 1.95), S / 2 - rr - 3);
    sats.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr]);
  }
  return new Raster(S, S).paint(WHITE, (x, y) => {
    let sd = blobSd(x, y, blobs, R * 0.5);
    for (const [sx, sy, sr] of sats) sd = Math.min(sd, sdCircle(x, y, sx, sy, sr));
    sd += (vnoise(x / 5, y / 5, seed + 1) - 0.5) * 2.2 + (vnoise(x / 1.8, y / 1.8, seed + 2) - 0.5) * 0.8;
    return fill(sd) * (0.9 + 0.1 * fbm(x / 9, y / 9, seed + 3, 3));
  });
}

export function splat(i: number, S: number): Raster {
  const seed = seedOf('splat', i);
  const rng = new Rng(seed);
  const c = S / 2;
  const core: Blob[] = [[c, c, S * 0.15]];
  for (let j = 0; j < 6; j++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.04, 0.12) * S;
    core.push([c + Math.cos(a) * d, c + Math.sin(a) * d, S * rng.range(0.06, 0.12)]);
  }
  const rays = 8 + rng.int(6);
  const sats: Blob[] = [];
  for (let j = 0; j < rays; j++) {
    const a = ((j + rng.range(-0.3, 0.3)) / rays) * Math.PI * 2;
    const len = S * rng.range(0.2, 0.38);
    const steps = 4;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const d = S * 0.1 + (len - S * 0.1) * t;
      const rr = S * (0.045 - 0.028 * t) * rng.range(0.8, 1.15);
      core.push([c + Math.cos(a) * d, c + Math.sin(a) * d, rr]);
    }
    if (rng.next() < 0.7) {
      const d = len + S * rng.range(0.03, 0.07);
      const rr = S * rng.range(0.012, 0.024);
      if (d + rr < c - 4) sats.push([c + Math.cos(a) * d, c + Math.sin(a) * d, rr]);
    }
  }
  const nSat = 12 + rng.int(12);
  for (let j = 0; j < nSat; j++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(1.5, 5);
    const d = Math.min(S * rng.range(0.22, 0.46), c - rr - 4);
    sats.push([c + Math.cos(a) * d, c + Math.sin(a) * d, rr]);
  }
  const screen = rationalScreen(1, 1, Math.round(S / (5.2 * Math.SQRT2)), S);
  return new Raster(S, S).paint(WHITE, (x, y) => {
    let sd = blobSd(x, y, core, S * 0.035);
    for (const [sx, sy, sr] of sats) sd = Math.min(sd, sdCircle(x, y, sx, sy, sr));
    sd += (vnoise(x / 6, y / 6, seed + 1) - 0.5) * 3 + (vnoise(x / 2, y / 2, seed + 2) - 0.5) * 1;
    // Solid body; the edge breaks up into a fringe of shrinking halftone dots (45° screen).
    const fringe = sd > 0 ? 0.42 * smoothstep(11, 0, sd) ** 1.3 : 0;
    const dots = halftone(screen, x, y, fringe, (vnoise(x / 1.4, y / 1.4, seed + 3) - 0.5) * 0.06);
    const a = Math.max(fill(sd), dots);
    return a * (0.86 + 0.14 * fbm(x / 12, y / 12, seed + 4, 3));
  });
}

// ---------------------------------------------------------------------------
// Torn paper flecks
// ---------------------------------------------------------------------------

export function fleck(i: number, S: number): Raster {
  const seed = seedOf('fleck', i);
  const rng = new Rng(seed);
  const n = 7 + rng.int(4);
  const c = S / 2 - 1;
  const base = rng.range(0, Math.PI * 2);
  const pts: Pt[] = [];
  for (let j = 0; j < n; j++) {
    const a = base + ((j + rng.range(-0.3, 0.3)) / n) * Math.PI * 2;
    const r = S * (j % 2 === 0 ? rng.range(0.34, 0.44) : rng.range(0.26, 0.38));
    pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  const torn = (x: number, y: number): number =>
    (vnoise(x / 1.4, y / 1.4, seed + 1) - 0.5) * 1.1 + (vnoise(x / 4, y / 4, seed + 2) - 0.5) * 1.4;
  const paper = mixRgb(rgb(PAPER), WHITE, 0.25);
  const dirA = rng.range(0, Math.PI * 2);
  const r = new Raster(S, S);
  r.paint(INK_RGB, (x, y) => 0.38 * smoothstep(2.6, -1.4, sdPolygon(x - 1.4, y - 2.2, pts) + torn(x, y)));
  r.paintRgb((x, y, out) => {
    const sd = sdPolygon(x, y, pts) + torn(x, y);
    const a = fill(sd);
    if (a <= 0) return 0;
    const curl = ((x - c) * Math.cos(dirA) + (y - c) * Math.sin(dirA)) / S;
    const k =
      0.97 +
      0.14 * curl -
      0.08 * smoothstep(0.2, 0.45, curl) +
      0.025 * (fbm(x / 3, y / 3, seed + 3, 2) - 0.5);
    out[0] = clamp01(paper[0] * k);
    out[1] = clamp01(paper[1] * k);
    out[2] = clamp01(paper[2] * k);
    return a;
  });
  // Bleached fibrous torn edge.
  r.paint(WHITE, (x, y) => {
    const sd = sdPolygon(x, y, pts) + torn(x, y);
    return fill(sd) * smoothstep(-2.4, -0.6, sd) * (0.55 + 0.45 * vnoise(x / 1.2, y / 1.2, seed + 4)) * 0.8;
  });
  return r;
}

// ---------------------------------------------------------------------------
// Press platen (stamp animation), 1024×96, horizontal
// ---------------------------------------------------------------------------

export function platen(W: number, H: number): Raster {
  const seed = seedOf('platen');
  const r = new Raster(W, H);
  const top = 3;
  const bot = H - 3;
  const faceY = 71; // rubber face starts here
  const outer = (x: number, y: number): number => sdRoundRect(x, y, 2, top, W - 2, bot, 8);
  // Vertical steel profile (brightness stops, top → bottom): chamfer, upper face with a broad
  // specular band, machined groove, lower face, bottom chamfer.
  const stops: [number, number][] = [
    [top, 0.78],
    [top + 4, 0.62],
    [top + 6, 0.47],
    [14, 0.56],
    [22, 0.44],
    [44, 0.31],
    [47, 0.2],
    [49, 0.42],
    [52, 0.34],
    [64, 0.24],
    [66, 0.48],
    [68.5, 0.3],
    [faceY - 1, 0.08],
  ];
  const profile = (y: number): number => {
    if (y <= stops[0]![0]) return stops[0]![1];
    for (let i = 1; i < stops.length; i++) {
      const [y1, v1] = stops[i]!;
      const [y0, v0] = stops[i - 1]!;
      if (y <= y1) return v0 + (v1 - v0) * smoothstep(0, 1, (y - y0) / (y1 - y0));
    }
    return stops[stops.length - 1]![1];
  };
  const hex = (cx: number, cy: number, rad: number): Pt[] =>
    Array.from({ length: 6 }, (_, j) => {
      const a = (j / 6) * Math.PI * 2 + Math.PI / 6;
      return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as const;
    });
  const boltC: Pt[] = [
    [32, 33],
    [W - 32, 33],
  ];
  const seams = [62, W - 62];
  r.paintRgb((x, y, out) => {
    const a = fill(outer(x, y));
    if (a <= 0) return 0;
    let v: number;
    if (y < faceY) {
      v = profile(y);
      // Brushed (machined) streaks along the bar, darker towards the ends.
      v *=
        1 + 0.1 * (vnoise(x / 110, y / 0.75, seed + 1) - 0.5) + 0.05 * (hash2(x | 0, y | 0, seed + 2) - 0.5);
      v *= 1 - 0.12 * smoothstep(W / 2 - 140, W / 2 - 10, Math.abs(x - W / 2));
      v *= 1 + 0.08 * Math.exp(-(((x - W * 0.3) / 160) ** 2));
    } else {
      v =
        0.11 * (1 + 0.12 * (fbm(x / 3, y / 3, seed + 3, 2) - 0.5)) +
        0.07 * Math.exp(-(((y - faceY - 4) / 1.6) ** 2));
    }
    out[0] = clamp01(v * 0.98);
    out[1] = clamp01(v * 0.97);
    out[2] = clamp01(v * 1.02);
    return a;
  });
  // End blocks: seams and hex bolts.
  for (const sx of seams) {
    r.paint(INK_RGB, (x, y) => (y > top + 5 && y < faceY - 3 ? band(x - sx, 1.8) * 0.85 : 0));
    r.paint(WHITE, (x, y) => (y > top + 5 && y < faceY - 3 ? band(x - sx - 1.8, 1.1) * 0.3 : 0));
  }
  for (const [cx, cy] of boltC) {
    const b = hex(cx, cy, 13);
    r.paint(INK_RGB, (x, y) => 0.65 * smoothstep(3.5, -2, sdPolygon(x - 2.5, y - 3, b)));
    r.paintRgb((x, y, out) => {
      const sd = sdPolygon(x, y, b);
      const a = fill(sd);
      if (a <= 0) return 0;
      // Chamfered hex head: flat top, facets lit from the top-left.
      const nx = (x - cx) / 13;
      const ny = (y - cy) / 13;
      const onFacet = smoothstep(-4.5, -2.5, sd);
      const lit = clamp01(0.5 - (nx + ny) * 0.75);
      const v = 0.36 + 0.12 * (1 - (nx + ny) * 0.5) * (1 - onFacet) + onFacet * (0.18 + 0.5 * lit);
      out[0] = v;
      out[1] = v * 0.98;
      out[2] = v * 1.03;
      return a;
    });
    r.paint(WHITE, (x, y) => Math.exp(-((x - cx + 4.5) ** 2 + (y - cy + 4.5) ** 2) / 12) * 0.45);
    r.paint(INK_RGB, (x, y) => band(sdPolygon(x, y, b), 1.4) * 0.7);
  }
  // A trace of ink on the rubber face (it has printed before).
  r.paint(rgb(0xff4fa3), (x, y) => {
    const a = fill(outer(x, y));
    return (
      a * smoothstep(bot - 6, bot - 2, y) * smoothstep(0.35, 0.68, fbm(x / 16, y / 3, seed + 5, 3)) * 0.45
    );
  });
  r.paint(INK_RGB, (x, y) => band(outer(x, y) + 1.3, 2.6) * 0.92);
  return r;
}

// ---------------------------------------------------------------------------
// Rubber-stamp frame (APPROVED / ZATWIERDZONO), 512×192, white
// ---------------------------------------------------------------------------

export function stampRing(W: number, H: number): Raster {
  const seed = seedOf('stamp-ring');
  return new Raster(W, H).paint(WHITE, (x, y) => {
    const rough = (vnoise(x / 4, y / 4, seed) - 0.5) * 2.2 + (vnoise(x / 1.5, y / 1.5, seed + 1) - 0.5) * 0.9;
    const outer = sdRoundRect(x, y, 10, 10, W - 10, H - 10, 24) - rough;
    const inner = sdRoundRect(x, y, 33, 33, W - 33, H - 33, 10) - rough;
    const ring = Math.max(fill(outer) * (1 - fill(outer + 14)), band(inner, 5.5));
    if (ring <= 0) return 0;
    // Worn rubber: uneven pressure, starved patches, grain.
    const wear = smoothstep(0.26, 0.42, fbm(x / 18, y / 18, seed + 2, 4));
    const starve =
      1 -
      0.85 *
        smoothstep(0.68, 0.84, vnoise(x / 1.7, y / 1.7, seed + 3)) *
        smoothstep(0.35, 0.7, vnoise(x / 6, y / 6, seed + 4));
    const pressure = 0.8 + 0.2 * smoothstep(0.2, 0.8, fbm(x / 120, y / 120, seed + 5, 2));
    return ring * (0.15 + 0.85 * wear) * starve * pressure;
  });
}

// ---------------------------------------------------------------------------
// Glow and burst ring
// ---------------------------------------------------------------------------

export function glow(S: number): Raster {
  const c = S / 2;
  const e = Math.exp(-4.2);
  return new Raster(S, S).paint(WHITE, (x, y) => {
    const d = Math.hypot(x - c, y - c) / (c - 1);
    return d >= 1 ? 0 : (Math.exp(-4.2 * d * d) - e) / (1 - e);
  });
}

export function ringBurst(S: number): Raster {
  const seed = seedOf('ring');
  const c = S / 2;
  const R = c - 22;
  return new Raster(S, S).paint(WHITE, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    const ang = Math.atan2(y - c, x - c);
    const wobble = (vnoise(((ang + Math.PI) / (2 * Math.PI)) * 12, 0.5, seed, 12) - 0.5) * 2.2;
    const core = band(d - R - wobble, 8);
    const halo = Math.exp(-(((d - R) / 13) ** 2)) * 0.32;
    const grain = 0.88 + 0.12 * vnoise(x / 2, y / 2, seed + 1);
    return Math.max(core * grain, halo);
  });
}
