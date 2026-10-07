/**
 * 9-slice UI plates: plate cards (common / rare / legendary / empty slot / disabled overlay),
 * a paper panel and paper buttons. Faces stay nearly flat in the stretchable centre so 9-slice
 * scaling never smears visible texture; detail lives in the fixed corners and edges.
 */
import { INKS, PAPER, PAPER_SHADE, RARITY } from '../../../src/theme';
import type { CardStyle } from '../spec';
import { canvasMask, roundRectPath } from './canvas';
import { Raster } from './raster';
import {
  band,
  clamp01,
  fbm,
  fill,
  halftone,
  mixRgb,
  rationalScreen,
  rgb,
  sdRoundRect,
  sdSegment,
  seedOf,
  smoothstep,
  vnoise,
} from './math';
import type { RGB } from './math';
import { INK_RGB, WHITE } from './cells';

const PAPER_RGB = rgb(PAPER);

function rough(x: number, y: number, seed: number, amp: number): number {
  return amp * ((vnoise(x / 5, y / 5, seed) - 0.5) * 2 + (vnoise(x / 1.8, y / 1.8, seed + 1) - 0.5) * 0.8);
}

/** Riso ink grain for printed rules: 1 = full ink. */
function inkGrain(x: number, y: number, seed: number): number {
  const drop =
    smoothstep(0.72, 0.9, vnoise(x / 1.5, y / 1.5, seed)) *
    smoothstep(0.35, 0.75, vnoise(x / 5, y / 5, seed + 1));
  return (0.86 + 0.14 * fbm(x / 8, y / 8, seed + 2, 2)) * (1 - 0.85 * drop);
}

/** Near-flat light paper face (tiny low-frequency variation only). */
function paperFace(r: Raster, sd: (x: number, y: number) => number, light: number, seed: number): void {
  const face = mixRgb(PAPER_RGB, WHITE, light);
  r.paintRgb((x, y, out) => {
    const a = fill(sd(x, y));
    if (a <= 0) return 0;
    const k = 1 + 0.006 * (fbm(x / 40, y / 40, seed, 3) - 0.5);
    out[0] = clamp01(face[0] * k);
    out[1] = clamp01(face[1] * k);
    out[2] = clamp01(face[2] * k);
    return a;
  });
}

function softShadow(r: Raster, sd: (x: number, y: number) => number, soft: number, alpha: number): void {
  r.paint(INK_RGB, (x, y) => alpha * smoothstep(soft, -soft, sd(x, y)));
}

export function card(style: CardStyle, W: number, H: number): Raster {
  const seed = seedOf('card', style);
  const r = new Raster(W, H);
  const fx0 = 6;
  const fy0 = 5;
  const fx1 = W - 6;
  const fy1 = H - 9;
  const RAD = 12;
  const faceSd = (x: number, y: number): number => sdRoundRect(x, y, fx0, fy0, fx1, fy1, RAD);
  const inset = (x: number, y: number, d: number, rad: number): number =>
    sdRoundRect(x, y, fx0 + d, fy0 + d, fx1 - d, fy1 - d, rad);

  if (style === 'empty') {
    r.paint(
      rgb(PAPER_SHADE),
      (x, y) => fill(sdRoundRect(x, y, fx0 + 2, fy0 + 2, fx1 - 2, fy1 - 2, RAD - 2)) * 0.45,
    );
    const dash = canvasMask(W, H, (g) => {
      g.lineWidth = 3.2;
      g.setLineDash([13, 8]);
      g.lineCap = 'round';
      roundRectPath(g, fx0 + 2, fy0 + 2, fx1 - 2, fy1 - 2, RAD - 2);
      g.stroke();
    });
    r.paint(INK_RGB, (x, y) => dash.at(Math.floor(x), Math.floor(y)) * 0.36);
    return r;
  }

  if (style === 'disabled') {
    // Overlay for a card: grey ink wash + a worn ✕ rubber stamp.
    r.paint(INK_RGB, (x, y) => fill(faceSd(x, y)) * (0.3 + 0.04 * (fbm(x / 20, y / 20, seed, 3) - 0.5)));
    const cx = (fx0 + fx1) / 2;
    const cy = (fy0 + fy1) / 2;
    const arm = 52;
    const a1 = Math.PI / 4 - 0.08;
    const a2 = (3 * Math.PI) / 4 - 0.08;
    r.paint(INK_RGB, (x, y) => {
      const d =
        Math.min(
          sdSegment(
            x,
            y,
            cx - Math.cos(a1) * arm,
            cy - Math.sin(a1) * arm,
            cx + Math.cos(a1) * arm,
            cy + Math.sin(a1) * arm,
          ),
          sdSegment(
            x,
            y,
            cx - Math.cos(a2) * arm,
            cy - Math.sin(a2) * arm,
            cx + Math.cos(a2) * arm,
            cy + Math.sin(a2) * arm,
          ),
        ) -
        8 +
        rough(x, y, seed + 1, 1.2);
      const wear = 0.25 + 0.75 * smoothstep(0.25, 0.45, fbm(x / 10, y / 10, seed + 2, 4));
      return fill(d) * wear * inkGrain(x, y, seed + 3) * 0.85;
    });
    return r;
  }

  softShadow(r, (x, y) => sdRoundRect(x, y, fx0 + 1, fy0 + 4, fx1 + 1, fy1 + 4, RAD), 4.5, 0.22);
  paperFace(r, faceSd, 0.5, seed);

  if (style === 'common') {
    r.paint(
      INK_RGB,
      (x, y) => band(inset(x, y, 11, 4) - rough(x, y, seed + 1, 0.35), 3.2) * 0.9 * inkGrain(x, y, seed + 2),
    );
  } else if (style === 'rare') {
    const blue = rgb(RARITY.rare);
    r.paint(blue, (x, y) => {
      const e = rough(x, y, seed + 1, 0.35);
      const outer = band(inset(x, y, 10, 5) - e, 4.6);
      const inner = band(inset(x, y, 17.5, 2) - e, 1.7);
      return Math.max(outer, inner) * 0.95 * inkGrain(x, y, seed + 2);
    });
  } else {
    // Legendary: split-fountain pink → blue band, both inks screened, overprinted (multiply) + foil sheen.
    const pink = rgb(RARITY.legendary);
    const blue = rgb(INKS[4]);
    const sPink = rationalScreen(3, 1, 11, W);
    const sBlue = rationalScreen(1, 1, 25, W);
    const bandA = (x: number, y: number): number => {
      const e = rough(x, y, seed + 1, 0.4);
      return fill(inset(x, y, 7, 6) - e) * (1 - fill(inset(x, y, 21, 2) - e));
    };
    const tAt = (x: number, y: number): number =>
      clamp01(((x - fx0) / (fx1 - fx0)) * 0.45 + ((y - fy0) / (fy1 - fy0)) * 0.55);
    r.paint(pink, (x, y) => {
      const a = bandA(x, y);
      if (a <= 0) return 0;
      const t = tAt(x, y);
      return a * halftone(sPink, x, y, 0.08 + 0.92 * smoothstep(1, 0.2, t)) * inkGrain(x, y, seed + 2);
    });
    r.paint(
      blue,
      (x, y) => {
        const a = bandA(x, y);
        if (a <= 0) return 0;
        const t = tAt(x, y);
        return a * halftone(sBlue, x, y, 0.08 + 0.92 * smoothstep(0, 0.8, t)) * inkGrain(x, y, seed + 3);
      },
      'multiply',
    );
    r.paint(
      WHITE,
      (x, y) => {
        const a = bandA(x, y);
        if (a <= 0) return 0;
        const s = Math.sin((x * 0.75 - y) * 0.075);
        return a * smoothstep(0.7, 1, s) * 0.5;
      },
      'screen',
    );
    r.paint(INK_RGB, (x, y) => band(inset(x, y, 25, 2), 1.5) * 0.8 * inkGrain(x, y, seed + 4));
  }
  // Card edge hairline.
  r.paint(INK_RGB, (x, y) => band(faceSd(x, y) + 0.7, 1.4) * 0.32);
  return r;
}

export function panel(W: number, H: number): Raster {
  const seed = seedOf('panel');
  const r = new Raster(W, H);
  const faceSd = (x: number, y: number): number => sdRoundRect(x, y, 8, 6, W - 8, H - 14, 16);
  softShadow(r, (x, y) => sdRoundRect(x, y, 9, 12, W - 7, H - 9, 16), 6, 0.2);
  paperFace(r, faceSd, 0.35, seed);
  r.paint(
    INK_RGB,
    (x, y) => band(faceSd(x, y) + 2.4 - rough(x, y, seed + 1, 0.35), 4.6) * 0.92 * inkGrain(x, y, seed + 2),
  );
  r.paint(INK_RGB, (x, y) => band(faceSd(x, y) + 11, 1.4) * 0.26);
  return r;
}

export function button(pressed: boolean, W: number, H: number): Raster {
  const seed = seedOf('btn');
  const r = new Raster(W, H);
  const shadowCol: RGB = rgb(INKS[0]);
  const shadowSd = (x: number, y: number): number => sdRoundRect(x, y, 10, 11, W - 2, H - 5, 18);
  const off = pressed ? [4, 5] : [0, 0];
  const faceSd = (x: number, y: number): number =>
    sdRoundRect(x - off[0]!, y - off[1]!, 4, 4, W - 8, H - 12, 18);
  // Misregistered colour shadow (riso pink, grainy).
  r.paint(
    shadowCol,
    (x, y) => fill(shadowSd(x, y) - rough(x, y, seed, 0.5)) * 0.95 * inkGrain(x, y, seed + 1),
  );
  paperFace(r, faceSd, pressed ? 0.25 : 0.6, seed + 2);
  if (pressed)
    r.paint(
      INK_RGB,
      (x, y) =>
        fill(faceSd(x, y)) * smoothstep(-2, -9, faceSd(x, y)) * smoothstep(9, 0, y - off[1]! - 4) * 0.12,
    );
  r.paint(
    INK_RGB,
    (x, y) => band(faceSd(x, y) + 3.1 - rough(x, y, seed + 3, 0.3), 6.2) * inkGrain(x, y, seed + 4),
  );
  return r;
}
