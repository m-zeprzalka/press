/// <reference lib="dom" />
/**
 * Contact sheets for reviewing the baked textures. Everything is drawn *from the packed atlas*
 * through the same frame rectangles that go into atlas.json, on the baked paper, at 1× (42 px cell)
 * and 3× (native), including 3×3 blocks to check that halftone screens run on across cells,
 * a mocked board, tinted particles and 9-slice stretching.
 */
import { INK, INKS, ON_INK, PAPER, hex } from '../../../src/theme';
import { frameDefs } from '../spec';
import type { Borders } from '../spec';
import type { Placement } from '../pack';
import { canvas } from './canvas';

export interface Sheet {
  name: string;
  c: HTMLCanvasElement;
}

type G = CanvasRenderingContext2D;

export function renderPreviews(
  atlasPx: Uint8ClampedArray,
  atlasW: number,
  atlasH: number,
  placements: readonly Placement[],
  paperPx: Uint8ClampedArray,
  paperSize: number,
  displayFont: string,
): Sheet[] {
  const atlas = canvas(atlasW, atlasH);
  atlas.g.putImageData(new ImageData(new Uint8ClampedArray(atlasPx), atlasW, atlasH), 0, 0);
  const paper = canvas(paperSize, paperSize);
  paper.g.putImageData(new ImageData(new Uint8ClampedArray(paperPx), paperSize, paperSize), 0, 0);
  const rects = new Map(placements.map((p) => [p.name, p]));
  const borders = new Map<string, Borders>();
  for (const d of frameDefs()) if (d.borders) borders.set(d.name, d.borders);

  const rect = (name: string): Placement => {
    const r = rects.get(name);
    if (!r) throw new Error(`No frame ${name}`);
    return r;
  };
  const tintCache = new Map<string, HTMLCanvasElement>();
  /** Pixi-style tint (multiply) of a frame. */
  const tinted = (name: string, color: number): HTMLCanvasElement => {
    const key = `${name}#${color}`;
    const hit = tintCache.get(key);
    if (hit) return hit;
    const f = rect(name);
    const t = canvas(f.w, f.h);
    t.g.drawImage(atlas.c, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    t.g.globalCompositeOperation = 'multiply';
    t.g.fillStyle = hex(color);
    t.g.fillRect(0, 0, f.w, f.h);
    t.g.globalCompositeOperation = 'destination-in';
    t.g.drawImage(atlas.c, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    tintCache.set(key, t.c);
    return t.c;
  };
  const draw = (
    g: G,
    name: string,
    x: number,
    y: number,
    w?: number,
    h?: number,
    tint?: number,
    alpha = 1,
  ): void => {
    const f = rect(name);
    g.save();
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (tint !== undefined) g.drawImage(tinted(name, tint), x, y, w ?? f.w, h ?? f.h);
    else g.drawImage(atlas.c, f.x, f.y, f.w, f.h, x, y, w ?? f.w, h ?? f.h);
    g.restore();
  };
  const drawC = (g: G, name: string, cx: number, cy: number, scale: number, tint?: number, rot = 0): void => {
    const f = rect(name);
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    draw(g, name, (-f.w * scale) / 2, (-f.h * scale) / 2, f.w * scale, f.h * scale, tint);
    g.restore();
  };
  /** 9-slice draw (like Pixi NineSliceSprite) at scale s of the source insets. */
  const nine = (g: G, name: string, x: number, y: number, w: number, h: number, s = 1): void => {
    const f = rect(name);
    const b = borders.get(name) ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const sx = [0, b.left, f.w - b.right, f.w];
    const sy = [0, b.top, f.h - b.bottom, f.h];
    const dx = [0, b.left * s, w - b.right * s, w];
    const dy = [0, b.top * s, h - b.bottom * s, h];
    g.save();
    g.imageSmoothingQuality = 'high';
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const sw = sx[i + 1]! - sx[i]!;
        const sh = sy[j + 1]! - sy[j]!;
        const dw = dx[i + 1]! - dx[i]!;
        const dh = dy[j + 1]! - dy[j]!;
        if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
          g.drawImage(atlas.c, f.x + sx[i]!, f.y + sy[j]!, sw, sh, x + dx[i]!, y + dy[j]!, dw, dh);
        }
      }
    }
    g.restore();
  };
  const sheet = (w: number, h: number): { c: HTMLCanvasElement; g: G } => {
    const s = canvas(w, h);
    const pat = s.g.createPattern(paper.c, 'repeat');
    s.g.fillStyle = pat ?? hex(PAPER);
    s.g.fillRect(0, 0, w, h);
    return s;
  };
  const label = (g: G, text: string, x: number, y: number, size = 14): void => {
    g.save();
    g.font = `600 ${size}px monospace`;
    g.fillStyle = 'rgba(35,31,32,0.75)';
    g.fillText(text, x, y);
    g.restore();
  };
  const title = (g: G, text: string, x: number, y: number, size = 34): void => {
    g.save();
    g.font = `${size}px "${displayFont}", sans-serif`;
    g.fillStyle = hex(INK);
    g.fillText(text, x, y);
    g.restore();
  };
  /** Board grid (empty cells: paper + 1 dp ink grid at ~20 %). */
  const grid = (g: G, x: number, y: number, n: number, m: number, cell: number, empty = true): void => {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) if (empty) draw(g, 'cell_empty', x + i * cell, y + j * cell, cell, cell);
    g.save();
    g.strokeStyle = 'rgba(35,31,32,0.2)';
    g.lineWidth = Math.max(1, cell / 42);
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      g.moveTo(x + i * cell, y);
      g.lineTo(x + i * cell, y + m * cell);
    }
    for (let j = 0; j <= m; j++) {
      g.moveTo(x, y + j * cell);
      g.lineTo(x + n * cell, y + j * cell);
    }
    g.stroke();
    g.restore();
  };
  const symTint = (k: number): number => (ON_INK[k] === INK ? INK : PAPER);
  const symbol = (g: G, k: number, x: number, y: number, cell: number): void => {
    const s = (56 / 128) * cell;
    const a = ON_INK[k] === INK ? 0.55 : 1;
    draw(g, `sym_${k}`, x + (cell - s) / 2, y + (cell - s) / 2, s, s, symTint(k), a);
  };

  const sheets: Sheet[] = [];

  // ---- Sheet 1: cells at 3× (3×3 blocks for screen continuity) --------------------------------
  {
    const W = 1400;
    const H = 1640;
    const { c, g } = sheet(W, H);
    title(g, 'CELLS 3×  (128 PX)', 40, 58);
    const blockAt = (k: number, x: number, y: number): void => {
      grid(g, x, y, 3, 3, 128, false);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) draw(g, `ink_${k}_${(i + 2 * j) % 4}`, x + i * 128, y + j * 128);
      label(g, `ink_${k}_*  (3×3, variants mixed)`, x, y + 384 + 22);
    };
    blockAt(0, 40, 90);
    blockAt(1, 488, 90);
    blockAt(2, 936, 90);
    blockAt(3, 40, 540);
    blockAt(4, 488, 540);
    // Specials on a grid.
    const sx = 936;
    const sy = 540;
    grid(g, sx, sy, 3, 3, 128);
    draw(g, 'blind_0', sx, sy);
    draw(g, 'blind_1', sx + 128, sy);
    draw(g, 'lead_0', sx, sy + 128);
    draw(g, 'lead_1', sx + 128, sy + 128);
    draw(g, 'jam', sx + 256, sy);
    draw(g, 'ink_3_0', sx + 256, sy + 128);
    draw(g, 'ink_0_1', sx + 256, sy + 256);
    label(g, 'blind_0/1  jam / lead_0/1  ink / empty', sx, sy + 384 + 22);
    // Highlight row + symbols.
    const hy = 990;
    for (let k = 0; k < 5; k++) {
      const x = 40 + k * 270;
      grid(g, x, hy, 2, 2, 128, true);
      draw(g, `ink_${k}_0`, x, hy);
      draw(g, `ink_${k}_hl`, x + 128, hy);
      draw(g, `ink_${k}_hl`, x, hy + 128);
      draw(g, `ink_${k}_2`, x + 128, hy + 128);
      symbol(g, k, x, hy, 128);
      symbol(g, k, x + 128, hy + 128, 128);
      label(g, `ink_${k}_0 / ink_${k}_hl + sym_${k}`, x, hy + 256 + 22, 12);
    }
    // Raw symbols, white on ink.
    const ry = 1310;
    g.fillStyle = hex(INK);
    g.fillRect(40, ry, 5 * 80 + 16, 96);
    for (let k = 0; k < 5; k++) draw(g, `sym_${k}`, 56 + k * 80, ry + 20);
    label(g, 'sym_0..4 raw (white)', 40, ry + 120);
    // 1× strip of every cell frame.
    const oy = 1310;
    const ox = 520;
    const names = [
      ...Array.from({ length: 5 }, (_, k) => Array.from({ length: 4 }, (_2, v) => `ink_${k}_${v}`)).flat(),
      ...Array.from({ length: 5 }, (_, k) => `ink_${k}_hl`),
      'blind_0',
      'blind_1',
      'lead_0',
      'lead_1',
      'jam',
      'cell_empty',
    ];
    grid(g, ox, oy, 16, 2, 42, true);
    names.forEach((n, i) => {
      if (n !== 'cell_empty') draw(g, n, ox + (i % 16) * 42, oy + Math.floor(i / 16) * 42, 42, 42);
    });
    label(g, 'all cell frames at 1× (42 px)', ox, oy + 84 + 22);
    sheets.push({ name: 'cells', c });
  }

  // ---- Sheet 2: board mock at 1× and 3× ----------------------------------------------------------
  {
    const W = 1500;
    const H = 1120;
    const { c, g } = sheet(W, H);
    title(g, 'BOARD  1× / 3×', 40, 58);
    // 8×8 layout: digits = ink, b = blind, l = lead, j = jam, h<k> = highlight, . = empty
    const layout = [
      '0 0 0 . . 4 4 .',
      '0 h2 . . . 4 4 .',
      '. h2 h2 h2 . . 4 .',
      '. . b . 1 1 1 .',
      '3 3 . j . 1 . l',
      '3 3 3 . 2 2 . l',
      '. . . . 2 2 . .',
      '4 0 1 2 3 b j l',
    ].map((r) => r.split(' '));
    const board = (x: number, y: number, cell: number): void => {
      grid(g, x, y, 8, 8, cell, true);
      layout.forEach((row, j) =>
        row.forEach((t, i) => {
          const px = x + i * cell;
          const py = y + j * cell;
          const v = (i * 3 + j * 5) % 4;
          if (/^\d$/.test(t)) {
            draw(g, `ink_${t}_${v}`, px, py, cell, cell);
            if ((i + j) % 3 === 0) symbol(g, Number(t), px, py, cell);
          } else if (t.startsWith('h')) draw(g, `ink_${t.slice(1)}_hl`, px, py, cell, cell, undefined, 0.85);
          else if (t === 'b') draw(g, `blind_${v % 2}`, px, py, cell, cell);
          else if (t === 'l') draw(g, `lead_${v % 2}`, px, py, cell, cell);
          else if (t === 'j') draw(g, 'jam', px, py, cell, cell);
        }),
      );
    };
    board(40, 90, 42);
    label(g, '1× (42 px cells)', 40, 90 + 336 + 22);
    board(440, 90, 126);
    label(g, '3× (126 px cells)', 440, 90 + 1008 + 22);
    // 2× zoom of the 1× board corner (nearest) to judge the downsampled read.
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 40, 90, 168, 168, 40, 480, 336, 336);
    g.restore();
    label(g, '1× crop, zoomed 2× (nearest)', 40, 480 + 336 + 22);
    sheets.push({ name: 'board', c });
  }

  // ---- Sheet 3: effects ---------------------------------------------------------------------------
  {
    const W = 1500;
    const H = 1500;
    const { c, g } = sheet(W, H);
    title(g, 'EFFECTS', 40, 58);
    // Drops tinted with every ink.
    for (let i = 0; i < 6; i++) drawC(g, `drop_${i}`, 100 + i * 140, 160, 1, INKS[i % 5]);
    label(g, 'drop_0..5 (tinted)', 40, 250);
    // Splats.
    for (let i = 0; i < 4; i++) drawC(g, `splat_${i}`, 160 + i * 290, 420, 1, INKS[(i + 1) % 5]);
    label(g, 'splat_0..3 (tinted)', 40, 570);
    // Splats as decals on the board, multiply-ish at 60 %.
    grid(g, 40, 600, 8, 3, 42, true);
    g.save();
    g.globalAlpha = 0.6;
    drawC(g, 'splat_2', 150, 660, 0.45, INKS[0]);
    drawC(g, 'splat_1', 290, 650, 0.4, INKS[4]);
    g.restore();
    label(g, 'splats at 1× over the board (60 %)', 40, 750);
    // Flecks at 3× and 1×.
    for (let i = 0; i < 4; i++) {
      drawC(g, `fleck_${i}`, 440 + i * 80, 650, 1);
      drawC(g, `fleck_${i}`, 440 + i * 80, 720, 1 / 3);
    }
    label(g, 'fleck_0..3 at 3× and 1×', 420, 750);
    // Glow + ring on ink and on paper.
    g.fillStyle = hex(INK);
    g.fillRect(800, 590, 660, 300);
    drawC(g, 'glow_soft', 890, 740, 1);
    drawC(g, 'ring_burst', 1080, 740, 1);
    drawC(g, 'ring_burst', 1320, 740, 0.8, INKS[2]);
    label(g, 'glow_soft, ring_burst (white / tinted) on ink', 800, 912);
    // Platen.
    draw(g, 'platen', 40, 960);
    g.save();
    g.translate(1450, 940);
    g.rotate(Math.PI / 2);
    nine(g, 'platen', 0, 0, 520, 64, 2 / 3);
    g.restore();
    label(g, 'platen 1024×96 (native) / 9-slice rotated + scaled for a column', 40, 1080);
    // Stamp ring with text, 9-sliced to the long Polish word.
    const stamp = (
      x: number,
      y: number,
      w: number,
      h: number,
      text: string,
      col: number,
      rot: number,
    ): void => {
      const t = canvas(w, h);
      const f = rect('stamp_ring');
      const b = borders.get('stamp_ring')!;
      const sx = [0, b.left, f.w - b.right, f.w];
      const sy = [0, b.top, f.h - b.bottom, f.h];
      const dx = [0, b.left, w - b.right, w];
      const dy = [0, b.top, h - b.bottom, h];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          t.g.drawImage(
            tinted('stamp_ring', col),
            sx[i]!,
            sy[j]!,
            sx[i + 1]! - sx[i]!,
            sy[j + 1]! - sy[j]!,
            dx[i]!,
            dy[j]!,
            dx[i + 1]! - dx[i]!,
            dy[j + 1]! - dy[j]!,
          );
      t.g.font = `${Math.round(h * 0.42)}px "${displayFont}", sans-serif`;
      t.g.textAlign = 'center';
      t.g.textBaseline = 'middle';
      t.g.fillStyle = hex(col);
      t.g.fillText(text, w / 2, h / 2 + h * 0.03);
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.rotate(rot);
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = 0.92;
      g.drawImage(t.c, -w / 2, -h / 2);
      g.restore();
    };
    stamp(40, 1120, 512, 192, 'APPROVED', INKS[0], -0.06);
    stamp(600, 1120, 760, 168, 'ZATWIERDZONO', INKS[4], 0.04);
    label(g, 'stamp_ring (tinted, 9-slice, text rendered at runtime)', 40, 1350);
    draw(g, 'stamp_ring', 40, 1370, 256, 96);
    sheets.push({ name: 'fx', c });
  }

  // ---- Sheet 4: UI ---------------------------------------------------------------------------------
  {
    const W = 1500;
    const H = 1100;
    const { c, g } = sheet(W, H);
    title(g, 'UI  CARDS / PANEL / BUTTONS', 40, 58);
    const cards = ['card_empty', 'card_common', 'card_rare', 'card_legendary', 'card_common'];
    cards.forEach((n, i) => {
      const x = 40 + i * 220;
      draw(g, n, x, 90);
      if (i === 4) draw(g, 'card_disabled', x, 90);
      label(g, i === 4 ? 'common + card_disabled' : n, x, 90 + 240 + 20, 12);
    });
    // 9-slice stretched cards and 1× cards.
    nine(g, 'card_legendary', 1150, 90, 300, 240);
    label(g, 'card_legendary 9-slice 300×240', 1150, 350, 12);
    cards.forEach((n, i) => {
      const x = 40 + i * 80;
      draw(g, n, x, 390, 64, 80);
      if (i === 4) draw(g, 'card_disabled', x, 390, 64, 80);
    });
    label(g, 'cards at 1× (64×80)', 40, 495, 12);
    nine(g, 'ui_panel', 460, 390, 620, 320);
    title(g, 'ZLECENIE', 500, 470, 40);
    label(g, 'ui_panel 9-slice 620×320 (native 256×256 at right)', 460, 730, 12);
    draw(g, 'ui_panel', 1150, 390);
    const btn = (
      n: string,
      x: number,
      y: number,
      w: number,
      h: number,
      text: string,
      pressed: boolean,
    ): void => {
      nine(g, n, x, y, w, h);
      g.save();
      g.font = `${Math.round(h * 0.36)}px "${displayFont}", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = hex(INK);
      g.fillText(text, x + w * (92 / 192) + (pressed ? 4 : 0), y + h * (44 / 96) + (pressed ? 5 : 0));
      g.restore();
    };
    draw(g, 'btn', 40, 780);
    draw(g, 'btn_pressed', 260, 780);
    label(g, 'btn / btn_pressed native 192×96', 40, 900, 12);
    btn('btn', 500, 780, 420, 112, 'DRUKUJ', false);
    btn('btn_pressed', 960, 780, 420, 112, 'DRUKUJ', true);
    label(g, 'btn / btn_pressed 9-slice 420×112', 500, 915, 12);
    btn('btn', 40, 950, 128, 64, 'OK', false);
    label(g, 'btn at 1× (128×64)', 40, 1035, 12);
    sheets.push({ name: 'ui', c });
  }

  // ---- Sheet 5: paper seams ------------------------------------------------------------------------
  {
    const S = paperSize;
    const { c, g } = sheet(S * 2 + 80, S * 2 + 120);
    title(g, 'PAPER 512² TILED 2×2', 40, 58);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) g.drawImage(paper.c, 40 + i * S, 80 + j * S);
    g.save();
    g.fillStyle = 'rgba(255,79,163,0.9)';
    for (const t of [40 + S]) {
      g.fillRect(t - 1, 68, 2, 10);
      g.fillRect(t - 1, 82 + 2 * S, 2, 10);
      g.fillRect(28, 80 + S - 1, 10, 2);
      g.fillRect(42 + 2 * S, 80 + S - 1, 10, 2);
    }
    g.restore();
    label(g, 'pink ticks mark the tile seams (should be invisible)', 40, 80 + 2 * S + 26);
    sheets.push({ name: 'paper', c });
  }
  return sheets;
}
