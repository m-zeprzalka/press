/**
 * Tray: 3 fixed slots + optional stash (GDD §3.3). All previews use one cell size.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { TrayPiece } from '../core/run';
import { FONT_DISPLAY, INK } from '../theme';
import type { Animator } from './animator';
import { ease } from './animator';
import type { GameAssets } from './assets';
import type { Rect } from './layout';
import { PieceView, type CellStyle } from './pieceView';

interface Slot {
  rect: Rect;
  frame: Graphics;
  piece: PieceView | null;
  note: Text;
}

export class TrayView extends Container {
  private slots: Slot[] = [];
  private reserveSlot: Slot | null = null;
  trayCell = 16;
  private selected: number | 'reserve' | null = null;

  constructor(
    private readonly assets: GameAssets,
    private readonly animator: Animator,
    private style: CellStyle,
  ) {
    super();
  }

  setStyle(style: CellStyle): void {
    this.style = style;
    for (const s of this.allSlots()) s.piece?.setCellSize(this.trayCell, style);
    this.animator.request();
  }

  private allSlots(): Slot[] {
    return this.reserveSlot ? [...this.slots, this.reserveSlot] : this.slots;
  }

  private makeSlot(rect: Rect): Slot {
    const frame = new Graphics();
    const note = new Text({ text: '', style: { fontFamily: FONT_DISPLAY, fontSize: 12, fill: INK, letterSpacing: 1 } });
    note.alpha = 0.55;
    note.anchor.set(0.5);
    this.addChild(frame, note);
    return { rect, frame, piece: null, note };
  }

  layout(slots: Rect[], reserve: Rect | null, trayCell: number): void {
    this.trayCell = trayCell;
    const pieces = this.slots.map((s) => s.piece);
    const reservePiece = this.reserveSlot?.piece ?? null;
    this.removeChildren();
    this.slots = slots.map((r) => this.makeSlot(r));
    this.reserveSlot = reserve ? this.makeSlot(reserve) : null;
    this.slots.forEach((s, i) => {
      const p = pieces[i];
      if (p) this.attach(s, p);
    });
    if (this.reserveSlot && reservePiece) this.attach(this.reserveSlot, reservePiece);
    this.redrawFrames();
  }

  private redrawFrames(): void {
    for (const [i, s] of this.slots.entries()) this.drawFrame(s, this.selected === i, false);
    if (this.reserveSlot) this.drawFrame(this.reserveSlot, this.selected === 'reserve', true);
    this.animator.request();
  }

  private drawFrame(s: Slot, selected: boolean, reserve: boolean): void {
    const g = s.frame;
    const r = s.rect;
    g.clear();
    if (reserve) {
      g.roundRect(r.x, r.y, r.w, r.h, 10).fill({ color: 0xffffff, alpha: 0.25 });
      g.roundRect(r.x, r.y, r.w, r.h, 10).stroke({ width: 2, color: INK, alpha: 0.55 });
    }
    if (selected) g.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10).stroke({ width: 3, color: INK, alpha: 1 });
    s.note.position.set(r.x + r.w / 2, r.y + r.h / 2);
  }

  setReserveHover(on: boolean): void {
    if (!this.reserveSlot) return;
    const g = this.reserveSlot.frame;
    this.drawFrame(this.reserveSlot, this.selected === 'reserve', true);
    if (on) {
      const r = this.reserveSlot.rect;
      g.roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 12).stroke({ width: 3, color: INK, alpha: 1 });
    }
    this.animator.request();
  }

  private attach(s: Slot, p: PieceView): void {
    s.piece = p;
    p.setCellSize(this.trayCell, this.style);
    p.position.set(s.rect.x + (s.rect.w - p.pixelW) / 2, s.rect.y + (s.rect.h - p.pixelH) / 2);
    p.visible = true;
    p.alpha = 1;
    p.scale.set(1);
    this.addChild(p);
  }

  /**
   * Sync with core: tray pieces (fixed slots) + reserve. Pieces already shown keep their views.
   * `notes` labels empty slots (locked short-tray slot / no sheets).
   */
  set(tray: ReadonlyArray<TrayPiece | null>, reserve: TrayPiece | null, notes: string[] = []): void {
    const sync = (s: Slot, p: TrayPiece | null) => {
      if (s.piece && (!p || s.piece.piece.uid !== p.uid)) {
        s.piece.destroy({ children: true });
        s.piece = null;
      }
      if (p && !s.piece) this.attach(s, new PieceView(this.assets, p, this.trayCell, this.style));
    };
    this.slots.forEach((s, i) => {
      sync(s, tray[i] ?? null);
      s.note.text = s.piece ? '' : (notes[i] ?? '');
    });
    if (this.reserveSlot) sync(this.reserveSlot, reserve);
    this.animator.request();
  }

  /** Slide-in for freshly dealt pieces. */
  animateDeal(reduceMotion: boolean): void {
    if (reduceMotion) return;
    this.slots.forEach((s, i) => {
      const p = s.piece;
      if (!p) return;
      const tx = p.x;
      p.x = tx + 60;
      p.alpha = 0;
      void this.animator.tween(p, { x: tx, alpha: 1 }, 220, { delay: i * 60, ease: ease.outBack, key: p });
    });
  }

  rectOf(slot: number | 'reserve'): Rect | null {
    if (slot === 'reserve') return this.reserveSlot?.rect ?? null;
    return this.slots[slot]?.rect ?? null;
  }

  pieceView(slot: number | 'reserve'): PieceView | null {
    if (slot === 'reserve') return this.reserveSlot?.piece ?? null;
    return this.slots[slot]?.piece ?? null;
  }

  setHidden(slot: number | 'reserve', hidden: boolean): void {
    const p = this.pieceView(slot);
    if (p) p.visible = !hidden;
    this.animator.request();
  }

  setSelected(slot: number | 'reserve' | null): void {
    this.selected = slot;
    this.redrawFrames();
  }

  /** Small wiggle (tap without drag). */
  wiggle(slot: number | 'reserve'): void {
    const p = this.pieceView(slot);
    if (!p) return;
    const x0 = p.x;
    void this.animator
      .tween(p, { x: x0 + 6 }, 60, { key: p })
      .then(() => this.animator.tween(p, { x: x0 - 5 }, 80))
      .then(() => this.animator.tween(p, { x: x0 }, 90, { ease: ease.outBack }));
  }

  hitTest(x: number, y: number, pad = 8): number | 'reserve' | null {
    for (const [i, s] of this.slots.entries()) {
      const r = s.rect;
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return i;
    }
    const r = this.reserveSlot?.rect;
    if (r && x >= r.x - 16 && x <= r.x + r.w + 16 && y >= r.y - 16 && y <= r.y + r.h + 16) return 'reserve';
    return null;
  }
}
