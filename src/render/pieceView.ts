/**
 * Cell & piece sprites shared by the board, tray, drag proxy and FX.
 */
import { Container, Sprite } from 'pixi.js';
import { BLIND, JAM, LEAD, isInk } from '../core/board';
import { shapeById } from '../core/pieces';
import type { TrayPiece } from '../core/run';
import { INK, INKS, PAPER } from '../theme';
import type { GameAssets } from './assets';

export interface CellStyle {
  symbols: boolean;
}

/** Texture name for a board value; `variant` picks one of the rough-edge variants. */
export function cellFrame(v: number, variant: number): string {
  if (isInk(v)) return `ink_${v}_${variant & 3}`;
  if (v === BLIND) return `blind_${variant & 1}`;
  if (v === LEAD) return `lead_${variant & 1}`;
  if (v === JAM) return 'jam';
  return 'cell_empty';
}

/** One cell: the face sprite plus an optional colour-symbol overlay. */
export class CellSprite extends Container {
  readonly face: Sprite;
  private sym: Sprite | null = null;
  value = -1;

  constructor(private readonly assets: GameAssets) {
    super();
    this.face = new Sprite(assets.tex('cell_empty'));
    this.face.anchor.set(0.5);
    this.addChild(this.face);
  }

  set(v: number, variant: number, size: number, style: CellStyle): void {
    this.value = v;
    this.face.texture = this.assets.tex(cellFrame(v, variant));
    this.face.width = size;
    this.face.height = size;
    const wantSym = style.symbols && isInk(v);
    if (wantSym) {
      if (!this.sym) {
        this.sym = new Sprite(this.assets.tex(`sym_${v}`));
        this.sym.anchor.set(0.5);
        this.addChild(this.sym);
      }
      this.sym.texture = this.assets.tex(`sym_${v}`);
      const s = Math.max(7, size * 0.4);
      this.sym.width = s;
      this.sym.height = s;
      // Paper-coloured symbols on the dark inks (blue, teal), ink on the light ones.
      const dark = v === 4 || v === 3;
      this.sym.tint = dark ? PAPER : INK;
      this.sym.alpha = dark ? 0.85 : 0.55;
      this.sym.visible = true;
    } else if (this.sym) {
      this.sym.visible = false;
    }
  }
}

/** Deterministic rough-edge variant for a cell so the board does not look tiled. */
export function variantFor(index: number, salt: number): number {
  return ((index * 2654435761 + salt * 97) >>> 0) % 4;
}

/** A piece made of CellSprites; origin at the top-left of its bounding box. */
export class PieceView extends Container {
  readonly cells: CellSprite[] = [];
  cellSize = 0;

  constructor(
    assets: GameAssets,
    readonly piece: TrayPiece,
    size: number,
    private style: CellStyle,
  ) {
    super();
    const shape = shapeById(piece.shape);
    for (let k = 0; k < shape.cells.length; k++) {
      const c = new CellSprite(assets);
      this.cells.push(c);
      this.addChild(c);
    }
    this.setCellSize(size);
  }

  get shape() {
    return shapeById(this.piece.shape);
  }

  setCellSize(size: number, style?: CellStyle): void {
    if (style) this.style = style;
    this.cellSize = size;
    const shape = this.shape;
    shape.cells.forEach(([cx, cy], k) => {
      const c = this.cells[k] as CellSprite;
      c.set(this.piece.ink, variantFor(k, this.piece.uid), size, this.style);
      c.position.set(cx * size + size / 2, cy * size + size / 2);
    });
  }

  get pixelW(): number {
    return this.shape.w * this.cellSize;
  }

  get pixelH(): number {
    return this.shape.h * this.cellSize;
  }
}

export function inkColor(v: number): number {
  return isInk(v) ? (INKS[v] as number) : 0x8d8a86;
}
