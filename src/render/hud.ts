/**
 * Gameplay HUD drawn in Pixi (GDD §12.1): header, quota bar, sheets & streak, counter.
 */
import { BitmapText, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { FONT_DISPLAY, INK, INKS, PAPER } from '../theme';
import { fmtInt, fmtMult } from '../ui/i18n';
import type { Animator } from './animator';
import { ease } from './animator';
import type { Rect } from './layout';

const BLUE = INKS[4];
const PINK = INKS[0];

function label(size: number, color = INK): Text {
  return new Text({
    text: '',
    style: { fontFamily: FONT_DISPLAY, fontSize: size, fill: color, letterSpacing: 1, padding: 4 },
  });
}

function bitmap(size: number, color = INK): BitmapText {
  return new BitmapText({ text: '0', style: { fontFamily: FONT_DISPLAY, fontSize: size, fill: color } });
}

export interface HudContract {
  edition: number;
  position: number;
  special: boolean;
  endless: boolean;
  specialName: string | null;
  specialIcon: Texture | null;
}

export class HudView extends Container {
  // header
  private readonly edition = label(18);
  private readonly pips = new Graphics();
  private readonly chip = new Container();
  private readonly chipBg = new Graphics();
  private readonly chipIcon = new Sprite();
  private readonly chipText = label(12);
  // quota
  private readonly quotaLabel = label(13);
  private readonly quotaBar = new Graphics();
  private readonly quotaValue = bitmap(17);
  // status
  private readonly sheetsLabel = label(12);
  private readonly sheetsValue = bitmap(18);
  private readonly sheetsMeter = new Graphics();
  private readonly streakLabel = label(12);
  private readonly streakValue = bitmap(18);
  private readonly drops = new Graphics();
  // counter
  readonly counter = new Container();
  private readonly printsBox = new Graphics();
  private readonly multBox = new Graphics();
  private readonly printsLabel = label(10, PAPER);
  private readonly multLabel = label(10, INK);
  readonly printsValue = bitmap(24, PAPER);
  readonly multValue = bitmap(24, INK);
  private readonly times = label(22);

  private rects: { header: Rect; quota: Rect; status: Rect | null; counter: Rect } | null = null;
  private quota = 1;
  private shownProgress = 0;
  private sheets = { left: 0, used: 0, base: 20 };
  private streak = { value: 0, dry: 0, grace: 3, wet: false };
  private labels = {
    quota: 'QUOTA',
    sheets: 'SHEETS',
    streak: 'STREAK',
    prints: 'PRINTS',
    mult: 'MULT',
    edition: 'EDITION 1',
  };

  constructor(private readonly animator: Animator) {
    super();
    this.chip.addChild(this.chipBg, this.chipIcon, this.chipText);
    this.addChild(this.edition, this.pips, this.chip);
    this.addChild(this.quotaLabel, this.quotaBar, this.quotaValue);
    this.addChild(
      this.sheetsLabel,
      this.sheetsMeter,
      this.sheetsValue,
      this.streakLabel,
      this.streakValue,
      this.drops,
    );
    this.counter.addChild(
      this.printsBox,
      this.multBox,
      this.printsLabel,
      this.multLabel,
      this.printsValue,
      this.multValue,
      this.times,
    );
    this.addChild(this.counter);
    this.times.text = '×';
  }

  setLabels(l: Partial<HudView['labels']>): void {
    this.labels = { ...this.labels, ...l };
    this.quotaLabel.text = this.labels.quota;
    this.sheetsLabel.text = this.labels.sheets;
    this.streakLabel.text = this.labels.streak;
    this.printsLabel.text = this.labels.prints;
    this.multLabel.text = this.labels.mult;
    this.edition.text = this.labels.edition;
    this.relayout();
  }

  layout(header: Rect, quota: Rect, status: Rect | null, counter: Rect): void {
    this.rects = { header, quota, status, counter };
    this.relayout();
  }

  private relayout(): void {
    const r = this.rects;
    if (!r) return;
    // Header: leave 52 px on each side for the DOM pause/info buttons.
    const hx = r.header.x + 52;
    const hcy = r.header.y + r.header.h / 2;
    this.edition.anchor.set(0, 0.5);
    this.edition.position.set(hx, hcy);
    this.pips.position.set(hx + this.edition.width + 10, hcy);
    this.chip.position.set(r.header.x + r.header.w - 52, hcy);

    // Quota band.
    this.quotaLabel.anchor.set(0, 0.5);
    this.quotaLabel.position.set(r.quota.x, r.quota.y + r.quota.h / 2);
    this.quotaValue.anchor.set(1, 0.5);
    this.quotaValue.position.set(r.quota.x + r.quota.w, r.quota.y + r.quota.h / 2);
    this.drawQuotaBar();

    // Status band (or merged into quota row at compact tiers).
    if (r.status) {
      const sy = r.status.y + r.status.h / 2;
      this.sheetsLabel.anchor.set(0, 0.5);
      this.sheetsLabel.position.set(r.status.x, sy);
      this.sheetsValue.anchor.set(0, 0.5);
      this.sheetsValue.position.set(r.status.x + this.sheetsLabel.width + 8, sy);
      this.sheetsMeter.position.set(r.status.x + this.sheetsLabel.width + 40, sy);
      this.streakValue.anchor.set(1, 0.5);
      this.drops.position.set(r.status.x + r.status.w - 6, sy);
      this.streakValue.position.set(r.status.x + r.status.w - 60, sy);
      this.streakLabel.anchor.set(1, 0.5);
      this.streakLabel.position.set(this.streakValue.x - this.streakValue.width - 8, sy);
      for (const o of [
        this.sheetsLabel,
        this.sheetsValue,
        this.sheetsMeter,
        this.streakLabel,
        this.streakValue,
        this.drops,
      ])
        o.visible = true;
    } else {
      // Compact: sheets at the left end of the counter row, streak at the right end; the
      // PRINTS × MULT boxes narrow to leave room (boxWidth), so nothing overlaps.
      this.sheetsLabel.visible = false;
      this.sheetsMeter.visible = false;
      this.streakLabel.visible = false;
      const cy = r.counter.y + r.counter.h / 2;
      this.sheetsValue.anchor.set(0, 0.5);
      this.sheetsValue.position.set(r.counter.x, cy);
      this.streakValue.anchor.set(1, 0.5);
      this.streakValue.position.set(r.counter.x + r.counter.w, cy - 9);
      this.drops.position.set(r.counter.x + r.counter.w, cy + 11);
    }
    this.drawSheets();
    this.drawStreak();
    this.layoutCounter();
    this.animator.request();
  }

  /** Width kept free at each end of the counter row for sheets / streak in the compact HUD. */
  private boxWidth(rowW: number): number {
    const side = this.rects?.status ? 0 : 58;
    return Math.min(150, (rowW - 40 - 2 * side) / 2);
  }

  private layoutCounter(): void {
    const r = this.rects?.counter;
    if (!r) return;
    const boxW = this.boxWidth(r.w);
    const boxH = Math.min(42, r.h - 4);
    const cx = r.x + r.w / 2;
    const y = r.y + (r.h - boxH) / 2;
    const lx = cx - 18 - boxW;
    const rx = cx + 18;
    const box = (g: Graphics, x: number, fill: number, shadow: number) => {
      g.clear();
      g.roundRect(x + 3, y + 3, boxW, boxH, 8).fill({ color: shadow, alpha: 0.9 });
      g.roundRect(x, y, boxW, boxH, 8).fill(fill);
      g.roundRect(x, y, boxW, boxH, 8).stroke({ width: 2, color: INK });
    };
    box(this.printsBox, lx, BLUE, PINK);
    box(this.multBox, rx, PINK, BLUE);
    this.printsLabel.position.set(lx + 8, y + 3);
    this.multLabel.position.set(rx + 8, y + 3);
    this.printsValue.anchor.set(1, 0.5);
    this.printsValue.position.set(lx + boxW - 10, y + boxH / 2 + 5);
    this.multValue.anchor.set(1, 0.5);
    this.multValue.position.set(rx + boxW - 10, y + boxH / 2 + 5);
    this.times.anchor.set(0.5);
    this.times.position.set(cx, y + boxH / 2);
    this.fitCounterText();
  }

  private fitCounterText(): void {
    const r = this.rects?.counter;
    if (!r) return;
    const boxW = this.boxWidth(r.w);
    for (const t of [this.printsValue, this.multValue]) {
      t.scale.set(1);
      const max = boxW - 18;
      if (t.width > max) t.scale.set(max / t.width);
    }
  }

  setCounter(prints: number, mult: number): void {
    this.printsValue.text = fmtInt(prints);
    this.multValue.text = fmtMult(mult);
    this.fitCounterText();
    this.animator.request();
  }

  pulse(which: 'p' | 'm' | 'x'): void {
    const target = which === 'p' ? this.printsValue : this.multValue;
    const s = target.scale.x;
    target.scale.set(s * (which === 'x' ? 1.35 : 1.18));
    void this.animator.tween(target.scale, { x: s, y: s }, which === 'x' ? 220 : 120, {
      ease: ease.outBack,
      key: target.scale,
    });
  }

  /** Global position of the quota bar's fill end (target for flying numbers). */
  quotaAnchor(): { x: number; y: number } {
    const r = this.rects?.quota;
    if (!r) return { x: 0, y: 0 };
    return { x: r.x + r.w * 0.6, y: r.y + r.h / 2 };
  }

  counterCenter(): { x: number; y: number } {
    const r = this.rects?.counter;
    if (!r) return { x: 0, y: 0 };
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  setContract(c: HudContract, editionLabel: string): void {
    this.labels.edition = editionLabel;
    this.edition.text = editionLabel;
    const g = this.pips;
    g.clear();
    for (let i = 0; i < 3; i++) {
      const x = i * 16 + 6;
      const done = i < c.position;
      const cur = i === c.position;
      if (i === 2) {
        // The special job pip is a stamp square.
        g.rect(x - 6, -6, 12, 12).fill({ color: done ? INK : cur ? PINK : PAPER });
        g.rect(x - 6, -6, 12, 12).stroke({ width: 2, color: INK });
      } else {
        g.circle(x, 0, 5).fill({ color: done ? INK : cur ? BLUE : PAPER });
        g.circle(x, 0, 5).stroke({ width: 2, color: INK });
      }
    }
    // Chip: upcoming / current special rule.
    this.chip.visible = Boolean(c.specialName);
    if (c.specialName) {
      this.chipText.text = c.specialName;
      this.chipText.anchor.set(1, 0.5);
      this.chipText.position.set(0, 0);
      const iconSize = 18;
      if (c.specialIcon) {
        this.chipIcon.texture = c.specialIcon;
        this.chipIcon.width = iconSize;
        this.chipIcon.height = iconSize;
        this.chipIcon.anchor.set(1, 0.5);
        this.chipIcon.position.set(-this.chipText.width - 6, 0);
        this.chipIcon.visible = true;
      } else this.chipIcon.visible = false;
      // Icon-only chip when the name would collide with the edition pips.
      const pipsRight = (this.rects ? this.rects.header.x + 52 : 0) + this.edition.width + 10 + 3 * 16 + 6;
      const chipRight = this.rects ? this.rects.header.x + this.rects.header.w - 52 : 0;
      const fullW = this.chipText.width + (c.specialIcon ? iconSize + 10 : 0) + 14;
      const compact = Boolean(c.specialIcon) && chipRight - fullW < pipsRight + 8;
      this.chipText.visible = !compact;
      if (compact) this.chipIcon.position.set(-4, 0);
      const w = compact ? iconSize + 16 : fullW;
      const bg = this.chipBg;
      bg.clear();
      bg.roundRect(-w + 7, -12, w, 24, 12).fill({ color: c.special ? PINK : PAPER });
      bg.roundRect(-w + 7, -12, w, 24, 12).stroke({ width: 1.5, color: INK });
    }
    this.relayout();
  }

  setQuota(progress: number, quota: number, animate: boolean): void {
    this.quota = Math.max(1, quota);
    const from = this.shownProgress;
    if (!animate || progress < from) {
      this.shownProgress = progress;
      this.drawQuotaBar();
      return;
    }
    const tw = { v: from };
    void this.animator.tween(tw, { v: progress }, 450, {
      ease: ease.outCubic,
      key: this.quotaBar,
      onUpdate: () => {
        this.shownProgress = tw.v;
        this.drawQuotaBar();
      },
    });
  }

  private drawQuotaBar(): void {
    const r = this.rects?.quota;
    if (!r) return;
    const x = r.x + this.quotaLabel.width + 10;
    const valueW = Math.max(110, this.quotaValue.width + 12);
    const w = Math.max(40, r.w - (x - r.x) - valueW);
    const h = 14;
    const y = r.y + (r.h - h) / 2;
    const g = this.quotaBar;
    g.clear();
    g.roundRect(x, y, w, h, 7).fill({ color: PAPER });
    const f = Math.max(0, Math.min(1, this.shownProgress / this.quota));
    if (f > 0) {
      g.roundRect(x, y, Math.max(10, w * f), h, 7).fill({ color: INKS[3] });
      // Halftone-ish stripes on the fill.
      for (let sx = x + 6; sx < x + w * f - 3; sx += 8) g.moveTo(sx, y + 3).lineTo(sx - 4, y + h - 3);
      g.stroke({ width: 1.5, color: PAPER, alpha: 0.35 });
    }
    g.roundRect(x, y, w, h, 7).stroke({ width: 2, color: INK });
    this.quotaValue.text = `${fmtInt(Math.min(this.shownProgress, 9.99e15))} / ${fmtInt(this.quota)}`;
    this.animator.request();
  }

  setSheets(left: number, used: number, base: number): void {
    this.sheets = { left, used, base };
    this.drawSheets();
  }

  private drawSheets(): void {
    this.sheetsValue.text = String(this.sheets.left);
    const g = this.sheetsMeter;
    g.clear();
    if (!this.rects?.status) return;
    // Meter of base sheets used, with ticks at the early-delivery thresholds (60% / 40%).
    const w = 80;
    const base = Math.max(1, this.sheets.base);
    const usedF = Math.min(1, this.sheets.used / base);
    g.rect(0, -4, w, 8).fill({ color: PAPER });
    g.rect(0, -4, w * usedF, 8).fill({ color: INK, alpha: 0.75 });
    g.rect(0, -4, w, 8).stroke({ width: 1.5, color: INK });
    for (const f of [0.4, 0.6]) {
      g.moveTo(w * f, -8).lineTo(w * f, 8);
    }
    g.stroke({ width: 2, color: PINK });
    this.animator.request();
  }

  setStreak(value: number, dry: number, grace: number, wet: boolean): void {
    this.streak = { value, dry, grace, wet };
    this.drawStreak();
  }

  private drawStreak(): void {
    const { value, dry, grace, wet } = this.streak;
    const bonus = Math.max(0, value - 1);
    this.streakValue.text = wet ? '—' : bonus > 0 ? `${value} (+${bonus})` : String(value);
    const g = this.drops;
    g.clear();
    const n = grace;
    for (let i = 0; i < n; i++) {
      const x = -i * 13;
      const full = !wet && value > 0 && i < n - dry;
      // Ink drop: circle + point.
      g.moveTo(x, -9)
        .lineTo(x - 4, -2)
        .lineTo(x + 4, -2)
        .closePath();
      g.circle(x, 1, 4.5);
      g.fill({ color: full ? BLUE : PAPER });
      g.circle(x, 1, 4.5).stroke({ width: 1.5, color: INK });
    }
    if (this.rects?.status) {
      const sy = this.rects.status.y + this.rects.status.h / 2;
      this.streakValue.position.set(this.rects.status.x + this.rects.status.w - n * 13 - 8, sy);
      this.streakLabel.position.set(this.streakValue.x - this.streakValue.width - 8, sy);
    }
    this.animator.request();
  }

  bumpStreak(): void {
    const s = this.streakValue.scale.x;
    this.streakValue.scale.set(1.3);
    void this.animator.tween(this.streakValue.scale, { x: s, y: s }, 200, {
      ease: ease.outBack,
      key: this.streakValue.scale,
    });
  }
}
