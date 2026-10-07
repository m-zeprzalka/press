/**
 * Frame manifest of the baked texture atlas (GDD §14.2, decision D22).
 *
 * Shared by the Node build script (atlas.json, src/render/atlas-frames.ts) and by the in-page
 * generator (which frame to draw, and how big). Pure data, no DOM, no Node APIs.
 *
 * All pixel sizes are at 3× (TEXTURE_SCALE) of a nominal 42 dp board cell → 128 px cell tiles.
 */

export const TEXTURE_SCALE = 3;
export const NOMINAL_CELL_DP = 42;
export const CELL_PX = 128;
export const PAPER_PX = 512;
/** Border pixels repeated around every frame (bilinear/mipmap bleed guard). */
export const EXTRUDE = 2;
export const ATLAS_MAX = 2048;

export const INK_COUNT = 5;
export const INK_VARIANTS = 4;
export const BLIND_VARIANTS = 2;
export const LEAD_VARIANTS = 2;
export const SYMBOL_PX = 56;
export const DROP_SIZES = [64, 80, 96, 112, 128, 88] as const;
export const SPLAT_SIZES = [192, 224, 256, 240] as const;
export const FLECK_SIZES = [24, 32, 40, 48] as const;

export interface Borders {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type CardStyle = 'common' | 'rare' | 'legendary' | 'empty' | 'disabled';

export type FrameKind =
  | { kind: 'ink'; k: number; v: number }
  | { kind: 'inkHl'; k: number }
  | { kind: 'blind'; v: number }
  | { kind: 'lead'; v: number }
  | { kind: 'jam' }
  | { kind: 'cellEmpty' }
  | { kind: 'sym'; k: number }
  | { kind: 'drop'; i: number }
  | { kind: 'splat'; i: number }
  | { kind: 'fleck'; i: number }
  | { kind: 'platen' }
  | { kind: 'stampRing' }
  | { kind: 'card'; style: CardStyle }
  | { kind: 'panel' }
  | { kind: 'btn'; pressed: boolean }
  | { kind: 'glow' }
  | { kind: 'ring' };

export type FrameDef = FrameKind & {
  name: string;
  w: number;
  h: number;
  /** 9-slice insets in frame pixels (also written to atlas.json as Pixi `borders`). */
  borders?: Borders;
  /** Default anchor written to atlas.json (particles and decals are centred). */
  anchor?: { x: number; y: number };
};

const CENTER = { x: 0.5, y: 0.5 };
const CARD_BORDERS: Borders = { left: 36, top: 36, right: 36, bottom: 40 };

/** Every frame of the atlas, in a fixed order (the order is part of the deterministic output). */
export function frameDefs(): FrameDef[] {
  const out: FrameDef[] = [];
  const cell = (name: string, kind: FrameKind): void => {
    out.push({ ...kind, name, w: CELL_PX, h: CELL_PX });
  };
  for (let k = 0; k < INK_COUNT; k++) {
    for (let v = 0; v < INK_VARIANTS; v++) cell(`ink_${k}_${v}`, { kind: 'ink', k, v });
    cell(`ink_${k}_hl`, { kind: 'inkHl', k });
  }
  for (let v = 0; v < BLIND_VARIANTS; v++) cell(`blind_${v}`, { kind: 'blind', v });
  for (let v = 0; v < LEAD_VARIANTS; v++) cell(`lead_${v}`, { kind: 'lead', v });
  cell('jam', { kind: 'jam' });
  cell('cell_empty', { kind: 'cellEmpty' });
  for (let k = 0; k < INK_COUNT; k++) {
    out.push({ kind: 'sym', k, name: `sym_${k}`, w: SYMBOL_PX, h: SYMBOL_PX, anchor: CENTER });
  }
  DROP_SIZES.forEach((s, i) => out.push({ kind: 'drop', i, name: `drop_${i}`, w: s, h: s, anchor: CENTER }));
  SPLAT_SIZES.forEach((s, i) =>
    out.push({ kind: 'splat', i, name: `splat_${i}`, w: s, h: s, anchor: CENTER }),
  );
  FLECK_SIZES.forEach((s, i) =>
    out.push({ kind: 'fleck', i, name: `fleck_${i}`, w: s, h: s, anchor: CENTER }),
  );
  out.push({
    kind: 'platen',
    name: 'platen',
    w: 1024,
    h: 96,
    borders: { left: 64, top: 0, right: 64, bottom: 0 },
    anchor: CENTER,
  });
  out.push({
    kind: 'stampRing',
    name: 'stamp_ring',
    w: 512,
    h: 192,
    borders: { left: 52, top: 52, right: 52, bottom: 52 },
    anchor: CENTER,
  });
  for (const style of ['common', 'rare', 'legendary', 'empty', 'disabled'] as const) {
    out.push({ kind: 'card', style, name: `card_${style}`, w: 192, h: 240, borders: CARD_BORDERS });
  }
  out.push({
    kind: 'panel',
    name: 'ui_panel',
    w: 256,
    h: 256,
    borders: { left: 44, top: 44, right: 44, bottom: 52 },
  });
  const btnBorders: Borders = { left: 36, top: 34, right: 42, bottom: 44 };
  out.push({ kind: 'btn', pressed: false, name: 'btn', w: 192, h: 96, borders: btnBorders });
  out.push({ kind: 'btn', pressed: true, name: 'btn_pressed', w: 192, h: 96, borders: btnBorders });
  out.push({ kind: 'glow', name: 'glow_soft', w: 128, h: 128, anchor: CENTER });
  out.push({ kind: 'ring', name: 'ring_burst', w: 256, h: 256, anchor: CENTER });
  return out;
}
