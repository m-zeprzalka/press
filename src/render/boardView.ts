/**
 * The forme: backing, grid, 64 cell sprites, ghost preview and line highlights (GDD §3.4, §14.1).
 * The board always mirrors core state; print FX use detached sprites (fx.ts).
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { EMPTY, type Cells, type FullLines } from '../core/board';
import { BOARD_SIZE, shapeById } from '../core/pieces';
import type { TrayPiece } from '../core/run';
import { INK, INKS, PAPER_SHADE } from '../theme';
import type { Animator } from './animator';
import { ease } from './animator';
import type { GameAssets } from './assets';
import type { Rect } from './layout';
import { CellSprite, variantFor, type CellStyle } from './pieceView';

export class BoardView extends Container {
  readonly backing = new Graphics();
  readonly stains = new Container();
  readonly cellLayer = new Container();
  readonly highlight = new Graphics();
  readonly ghost = new Container();
  private readonly ghostOutline = new Graphics();
  private readonly ghostCells: CellSprite[] = [];
  readonly cells: CellSprite[] = [];
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  cell = 40;
  private values: number[] = new Array<number>(64).fill(EMPTY);
  private salt = 1;

  constructor(
    private readonly assets: GameAssets,
    private readonly animator: Animator,
    private style: CellStyle,
  ) {
    super();
    this.stains.blendMode = 'multiply';
    this.addChild(this.backing, this.stains, this.highlight, this.cellLayer, this.ghost);
    for (let i = 0; i < 64; i++) {
      const c = new CellSprite(assets);
      c.visible = false;
      this.cells.push(c);
      this.cellLayer.addChild(c);
    }
    this.ghost.addChild(this.ghostOutline);
    this.ghost.visible = false;
  }

  setStyle(style: CellStyle): void {
    this.style = style;
    this.refreshAll();
  }

  get cellStyle(): CellStyle {
    return this.style;
  }

  /** Changes the cell-variant salt (new contract → fresh look). */
  setSalt(salt: number): void {
    this.salt = salt;
  }

  layout(rect: Rect, cell: number): void {
    this.rect = rect;
    this.cell = cell;
    this.position.set(rect.x, rect.y);
    const g = this.backing;
    const size = cell * BOARD_SIZE;
    g.clear();
    // Slightly darker paper bed with an ink frame.
    g.roundRect(-6, -6, size + 12, size + 12, 8).fill({ color: PAPER_SHADE, alpha: 0.9 });
    g.roundRect(-6, -6, size + 12, size + 12, 8).stroke({ width: 2, color: INK, alpha: 0.85 });
    for (let k = 1; k < BOARD_SIZE; k++) {
      g.moveTo(k * cell, 2).lineTo(k * cell, size - 2);
      g.moveTo(2, k * cell).lineTo(size - 2, k * cell);
    }
    g.stroke({ width: 1, color: INK, alpha: 0.18 });
    // Registration crop marks at the corners.
    const m = 10;
    for (const [cx, cy, sx, sy] of [
      [-6, -6, -1, -1],
      [size + 6, -6, 1, -1],
      [-6, size + 6, -1, 1],
      [size + 6, size + 6, 1, 1],
    ] as const) {
      g.moveTo(cx + sx * 4, cy).lineTo(cx + sx * (4 + m), cy);
      g.moveTo(cx, cy + sy * 4).lineTo(cx, cy + sy * (4 + m));
    }
    g.stroke({ width: 1.5, color: INK, alpha: 0.6 });
    this.refreshAll();
  }

  cellCenter(i: number): { x: number; y: number } {
    const x = i % BOARD_SIZE;
    const y = (i / BOARD_SIZE) | 0;
    return { x: this.rect.x + x * this.cell + this.cell / 2, y: this.rect.y + y * this.cell + this.cell / 2 };
  }

  private refreshCell(i: number): void {
    const v = this.values[i] as number;
    const c = this.cells[i] as CellSprite;
    c.visible = v !== EMPTY;
    c.scale.set(1);
    c.alpha = 1;
    if (v === EMPTY) return;
    c.set(v, variantFor(i, this.salt), this.cell, this.style);
    c.position.set((i % BOARD_SIZE) * this.cell + this.cell / 2, ((i / BOARD_SIZE) | 0) * this.cell + this.cell / 2);
  }

  refreshAll(): void {
    for (let i = 0; i < 64; i++) this.refreshCell(i);
    this.animator.request();
  }

  /** Instantly mirror the core board. */
  setCells(cells: Cells): void {
    this.values = cells.slice();
    this.refreshAll();
  }

  /** Placement: new cells drop in with a small bounce (the "type into forme" feel). */
  placeCells(indices: number[], value: number, reduceMotion: boolean): void {
    for (const i of indices) {
      this.values[i] = value;
      this.refreshCell(i);
      if (reduceMotion) continue;
      const c = this.cells[i] as CellSprite;
      c.scale.set(1.12);
      void this.animator.tween(c.scale, { x: 1, y: 1 }, 140, { ease: ease.outBack, key: c.scale });
    }
    this.animator.request();
  }

  /** Remove cells (after a print) — FX layer animates detached copies. */
  clearCells(indices: number[]): void {
    for (const i of indices) {
      this.values[i] = EMPTY;
      this.refreshCell(i);
    }
    this.animator.request();
  }

  showGhost(piece: TrayPiece, x: number, y: number, lines: FullLines | null): void {
    const shape = shapeById(piece.shape);
    while (this.ghostCells.length < shape.cells.length) {
      const c = new CellSprite(this.assets);
      this.ghostCells.push(c);
      this.ghost.addChild(c);
    }
    const cs = this.cell;
    this.ghostCells.forEach((c, k) => {
      const cell = shape.cells[k];
      c.visible = Boolean(cell);
      if (!cell) return;
      c.set(piece.ink, variantFor(k, piece.uid), cs, this.style);
      c.alpha = 0.35;
      c.position.set((x + cell[0]) * cs + cs / 2, (y + cell[1]) * cs + cs / 2);
    });
    // Dashed ink outline around each ghost cell (contrast rule: never rely on colour alone).
    const g = this.ghostOutline;
    g.clear();
    for (const [cx, cy] of shape.cells) dashedRect(g, (x + cx) * cs + 2, (y + cy) * cs + 2, cs - 4, cs - 4, 5, 4);
    g.stroke({ width: 2, color: INK, alpha: 0.9 });
    this.ghost.visible = true;

    const h = this.highlight;
    h.clear();
    if (lines && (lines.rows.length || lines.cols.length)) {
      const size = cs * BOARD_SIZE;
      const tint = piece.ink < 5 ? (INKS[piece.ink] as number) : INK;
      for (const r of lines.rows) h.rect(0, r * cs, size, cs).fill({ color: tint, alpha: 0.18 });
      for (const c of lines.cols) h.rect(c * cs, 0, cs, size).fill({ color: tint, alpha: 0.18 });
      for (const r of lines.rows) h.rect(1, r * cs + 1, size - 2, cs - 2).stroke({ width: 2, color: INK, alpha: 0.95 });
      for (const c of lines.cols) h.rect(c * cs + 1, 1, cs - 2, size - 2).stroke({ width: 2, color: INK, alpha: 0.95 });
    }
    this.animator.request();
  }

  hideGhost(): void {
    if (!this.ghost.visible && this.highlight.visible === false) return;
    this.ghost.visible = false;
    this.highlight.clear();
    this.animator.request();
  }

  /** Ink stain decal that slowly fades (riso paper gets dirty). */
  addStain(x: number, y: number, color: number, size: number, frame: string, reduceMotion: boolean): void {
    const s = new Sprite(this.assets.tex(frame));
    s.anchor.set(0.5);
    s.tint = color;
    s.alpha = 0.35;
    s.width = size;
    s.height = size;
    s.rotation = Math.random() * Math.PI * 2;
    s.position.set(x - this.rect.x, y - this.rect.y);
    this.stains.addChild(s);
    void this.animator.tween(s, { alpha: 0 }, reduceMotion ? 600 : 2000, { delay: 200, ease: ease.inQuad }).then(() => {
      s.destroy();
    });
  }
}

function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number): void {
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dx = (x1 - x0) / len;
    const dy = (y1 - y0) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + dx * d, y0 + dy * d).lineTo(x0 + dx * e, y0 + dy * e);
    }
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
}
