/**
 * Plate rack: up to 5 cards (GDD §12.1). Tap → details, horizontal drag → reorder.
 */
import { BitmapText, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { MatrixId, Rarity } from '../core/matrices';
import { FONT_DISPLAY, INK, INKS, PAPER, RARITY } from '../theme';
import type { Animator } from './animator';
import { ease } from './animator';
import type { GameAssets } from './assets';
import type { Rect } from './layout';

export interface RackCard {
  uid: number;
  id: MatrixId;
  rarity: Rarity;
  badge: string | null;
  disabled: boolean;
  /** Mirror with nothing to copy. */
  inert: boolean;
  mirror: boolean;
}

class CardView extends Container {
  readonly bg = new Graphics();
  readonly icon = new Sprite();
  readonly badge = new BitmapText({ text: '', style: { fontFamily: FONT_DISPLAY, fontSize: 13, fill: INK } });
  readonly badgeBg = new Graphics();
  readonly overlay = new Graphics();
  card: RackCard | null = null;
  w = 60;
  h = 64;

  constructor() {
    super();
    this.addChild(this.bg, this.icon, this.badgeBg, this.badge, this.overlay);
  }

  draw(card: RackCard | null, w: number, h: number, icon: Texture | null): void {
    this.card = card;
    this.w = w;
    this.h = h;
    const g = this.bg;
    g.clear();
    this.overlay.clear();
    this.badgeBg.clear();
    this.badge.text = '';
    this.pivot.set(w / 2, h / 2);
    if (!card) {
      // Empty slot: dashed outline.
      for (let x = 6; x < w - 6; x += 9) g.moveTo(x, 2).lineTo(Math.min(x + 5, w - 6), 2);
      for (let x = 6; x < w - 6; x += 9) g.moveTo(x, h - 2).lineTo(Math.min(x + 5, w - 6), h - 2);
      for (let y = 6; y < h - 6; y += 9) g.moveTo(2, y).lineTo(2, Math.min(y + 5, h - 6));
      for (let y = 6; y < h - 6; y += 9) g.moveTo(w - 2, y).lineTo(w - 2, Math.min(y + 5, h - 6));
      g.stroke({ width: 1.5, color: INK, alpha: 0.45 });
      this.icon.visible = false;
      return;
    }
    const shadow = card.rarity === 'legendary' ? INKS[4] : card.rarity === 'rare' ? INKS[0] : INKS[2];
    g.roundRect(3, 3, w - 2, h - 2, 8).fill({ color: shadow, alpha: 0.85 });
    g.roundRect(0, 0, w - 2, h - 2, 8).fill(PAPER);
    g.roundRect(0, 0, w - 2, h - 2, 8).stroke({
      width: card.rarity === 'common' ? 2 : 3,
      color: RARITY[card.rarity],
    });
    if (card.rarity === 'rare') g.roundRect(4, 4, w - 10, h - 10, 6).stroke({ width: 1, color: RARITY.rare });
    if (card.rarity === 'legendary')
      g.roundRect(4, 4, w - 10, h - 10, 6).stroke({ width: 1.5, color: INKS[4] });
    const iconSize = Math.min(w - 14, h - 18);
    if (icon) {
      this.icon.texture = icon;
      this.icon.width = iconSize;
      this.icon.height = iconSize;
      this.icon.position.set((w - 2 - iconSize) / 2, 4);
      this.icon.visible = true;
    } else this.icon.visible = false;
    if (card.badge) {
      this.badge.text = card.badge;
      this.badge.anchor.set(0.5, 1);
      this.badge.position.set((w - 2) / 2, h - 3);
      const bw = this.badge.width + 8;
      this.badgeBg.roundRect((w - 2 - bw) / 2, h - 18, bw, 15, 4).fill({ color: PAPER, alpha: 0.95 });
      this.badgeBg.roundRect((w - 2 - bw) / 2, h - 18, bw, 15, 4).stroke({ width: 1, color: INK });
    }
    if (card.disabled || card.inert) {
      const o = this.overlay;
      o.roundRect(0, 0, w - 2, h - 2, 8).fill({ color: 0x8d8a86, alpha: 0.55 });
      if (card.disabled) {
        o.moveTo(10, 10)
          .lineTo(w - 12, h - 12)
          .moveTo(w - 12, 10)
          .lineTo(10, h - 12);
        o.stroke({ width: 4, color: INK, alpha: 0.85 });
      }
    }
    if (card.mirror && !card.inert) {
      // Arrow → towards the copied neighbour.
      const o = this.overlay;
      o.moveTo(w - 14, h / 2)
        .lineTo(w + 4, h / 2)
        .stroke({ width: 3, color: INK });
      o.moveTo(w, h / 2 - 5)
        .lineTo(w + 6, h / 2)
        .lineTo(w, h / 2 + 5)
        .stroke({ width: 3, color: INK });
    }
  }
}

export class RackView extends Container {
  private cards: CardView[] = [];
  private rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private data: RackCard[] = [];
  private icons = new Map<MatrixId, Texture>();
  private cardW = 60;
  private dragging: { from: number; x: number } | null = null;

  constructor(
    private readonly assets: GameAssets,
    private readonly animator: Animator,
  ) {
    super();
    for (let i = 0; i < 5; i++) {
      const c = new CardView();
      this.cards.push(c);
      this.addChild(c);
    }
    void this.assets;
  }

  setIcons(icons: Map<MatrixId, Texture>): void {
    this.icons = icons;
    this.redraw();
  }

  layout(rect: Rect): void {
    this.rect = rect;
    this.redraw();
  }

  set(cards: RackCard[]): void {
    this.data = cards;
    this.redraw();
  }

  private slotX(i: number): number {
    const gap = 8;
    const w = Math.min(72, (this.rect.w - gap * 4) / 5);
    this.cardW = w;
    const total = w * 5 + gap * 4;
    const x0 = this.rect.x + (this.rect.w - total) / 2;
    return x0 + i * (w + gap) + w / 2;
  }

  private redraw(): void {
    for (let i = 0; i < 5; i++) {
      const c = this.cards[i] as CardView;
      const d = this.data[i] ?? null;
      const x = this.slotX(i);
      c.draw(d, this.cardW, this.rect.h, d ? (this.icons.get(d.id) ?? null) : null);
      if (!this.dragging || this.dragging.from !== i) c.position.set(x, this.rect.y + this.rect.h / 2);
      c.scale.set(1);
      c.zIndex = 0;
    }
    this.animator.request();
  }

  hitTest(x: number, y: number): number | null {
    if (y < this.rect.y - 6 || y > this.rect.y + this.rect.h + 6) return null;
    for (let i = 0; i < this.data.length; i++) {
      const cx = this.slotX(i);
      if (Math.abs(x - cx) <= this.cardW / 2 + 4) return i;
    }
    return null;
  }

  /** Wiggle when a plate contributes during counter playback. */
  wiggle(slot: number): void {
    const c = this.cards[slot];
    if (!c || !this.data[slot]) return;
    c.scale.set(1.14);
    c.rotation = 0.08;
    void this.animator.tween(c.scale, { x: 1, y: 1 }, 180, { ease: ease.outBack, key: c.scale });
    void this.animator.tween(c, { rotation: 0 }, 220, { ease: ease.outElastic, key: c });
  }

  beginDrag(from: number): void {
    this.dragging = { from, x: this.slotX(from) };
    const c = this.cards[from];
    if (c) {
      c.zIndex = 10;
      this.sortableChildren = true;
      c.scale.set(1.08);
    }
    this.animator.request();
  }

  /** Moves the dragged card; returns the target slot index. */
  dragTo(x: number): number {
    if (!this.dragging) return -1;
    const from = this.dragging.from;
    const c = this.cards[from] as CardView;
    c.x = x;
    let target = from;
    let best = Infinity;
    for (let i = 0; i < this.data.length; i++) {
      const d = Math.abs(x - this.slotX(i));
      if (d < best) {
        best = d;
        target = i;
      }
    }
    // Shift other cards to preview the gap.
    for (let i = 0; i < this.data.length; i++) {
      if (i === from) continue;
      let slot = i;
      if (from < target && i > from && i <= target) slot = i - 1;
      if (from > target && i < from && i >= target) slot = i + 1;
      const card = this.cards[i] as CardView;
      void this.animator.tween(card, { x: this.slotX(slot) }, 90, { key: card });
    }
    this.animator.request();
    return target;
  }

  endDrag(): void {
    this.dragging = null;
    // The 90 ms gap-preview tweens must not keep moving cards after the final layout.
    for (const c of this.cards) this.animator.cancel(c);
    this.redraw();
  }

  cardCenter(slot: number): { x: number; y: number } {
    return { x: this.slotX(slot), y: this.rect.y + this.rect.h / 2 };
  }
}
