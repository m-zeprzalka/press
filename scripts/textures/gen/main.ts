/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * In-page entry of the texture generator (bundled by esbuild into an IIFE exposing `PressTextures`).
 * Renders every frame, packs the atlas with extruded borders, renders the paper tile and
 * (optionally) the contact sheets, and hands raw RGBA back to Node as base64.
 */
import { ATLAS_MAX, EXTRUDE, PAPER_PX, frameDefs } from '../spec';
import type { FrameDef } from '../spec';
import { packAtlas } from '../pack';
import type { Placement } from '../pack';
import type { Raster } from './raster';
import { paperTile } from './paper';
import { blindCell, emptyCell, inkCell, inkHighlightCell, jamCell, leadCell } from './cells';
import { drop, fleck, glow, platen, ringBurst, splat, stampRing, symbol } from './fx';
import { button, card, panel } from './ui';
import { renderPreviews } from './preview';

export interface EncodedImage {
  name: string;
  w: number;
  h: number;
  b64: string;
}

export interface BuildOutput {
  paper: EncodedImage;
  atlas: EncodedImage;
  placements: Placement[];
  previews: EncodedImage[];
  timings: Record<string, number>;
}

export interface BuildOptions {
  preview: boolean;
  /** PRESS Display (public/fonts/press-display.otf) as base64, for contact-sheet titles. */
  fontB64: string | null;
}

function renderFrame(d: FrameDef): Raster {
  switch (d.kind) {
    case 'ink':
      return inkCell(d.k, d.v);
    case 'inkHl':
      return inkHighlightCell(d.k);
    case 'blind':
      return blindCell(d.v);
    case 'lead':
      return leadCell(d.v);
    case 'jam':
      return jamCell();
    case 'cellEmpty':
      return emptyCell();
    case 'sym':
      return symbol(d.k, d.w);
    case 'drop':
      return drop(d.i, d.w);
    case 'splat':
      return splat(d.i, d.w);
    case 'fleck':
      return fleck(d.i, d.w);
    case 'platen':
      return platen(d.w, d.h);
    case 'stampRing':
      return stampRing(d.w, d.h);
    case 'card':
      return card(d.style, d.w, d.h);
    case 'panel':
      return panel(d.w, d.h);
    case 'btn':
      return button(d.pressed, d.w, d.h);
    case 'glow':
      return glow(d.w);
    case 'ring':
      return ringBurst(d.w);
  }
}

/** Copy a frame into the atlas and repeat its edge pixels `e` px outwards. */
function blitExtruded(
  dst: Uint8ClampedArray,
  dw: number,
  src: Uint8ClampedArray,
  p: Placement,
  e: number,
): void {
  for (let y = -e; y < p.h + e; y++) {
    const sy = Math.min(p.h - 1, Math.max(0, y));
    for (let x = -e; x < p.w + e; x++) {
      const sx = Math.min(p.w - 1, Math.max(0, x));
      const si = (sy * p.w + sx) * 4;
      const di = ((p.y + y) * dw + p.x + x) * 4;
      dst[di] = src[si]!;
      dst[di + 1] = src[si + 1]!;
      dst[di + 2] = src[si + 2]!;
      dst[di + 3] = src[si + 3]!;
    }
  }
}

function toBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + CH)));
  }
  return btoa(s);
}

export async function build(opts: BuildOptions): Promise<BuildOutput> {
  const timings: Record<string, number> = {};
  let t = performance.now();
  const lap = (k: string): void => {
    const n = performance.now();
    timings[k] = Math.round(n - t);
    t = n;
  };

  const defs = frameDefs();
  const pixels = new Map<string, Uint8ClampedArray>();
  for (const d of defs) {
    const r = renderFrame(d);
    if (r.w !== d.w || r.h !== d.h) throw new Error(`${d.name}: rendered ${r.w}×${r.h}, spec ${d.w}×${d.h}`);
    pixels.set(d.name, r.toRGBA8());
  }
  lap('frames');
  const layout = packAtlas(
    defs.map((d) => ({ name: d.name, w: d.w, h: d.h })),
    EXTRUDE,
    ATLAS_MAX,
  );
  const atlasPx = new Uint8ClampedArray(layout.width * layout.height * 4);
  for (const p of layout.placements) blitExtruded(atlasPx, layout.width, pixels.get(p.name)!, p, EXTRUDE);
  lap('pack');
  const paperPx = paperTile().toRGBA8();
  lap('paper');

  const previews: EncodedImage[] = [];
  if (opts.preview) {
    let family = 'monospace';
    if (opts.fontB64) {
      const bin = atob(opts.fontB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const face = new FontFace('PRESS Display', bytes.buffer);
      await face.load();
      document.fonts.add(face);
      family = 'PRESS Display';
    }
    for (const s of renderPreviews(
      atlasPx,
      layout.width,
      layout.height,
      layout.placements,
      paperPx,
      PAPER_PX,
      family,
    )) {
      const g = s.c.getContext('2d')!;
      const data = g.getImageData(0, 0, s.c.width, s.c.height).data;
      previews.push({ name: s.name, w: s.c.width, h: s.c.height, b64: toBase64(data) });
    }
    lap('preview');
  }

  return {
    paper: { name: 'paper', w: PAPER_PX, h: PAPER_PX, b64: toBase64(paperPx) },
    atlas: { name: 'atlas', w: layout.width, h: layout.height, b64: toBase64(atlasPx) },
    placements: layout.placements,
    previews,
    timings,
  };
}
