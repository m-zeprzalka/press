/**
 * Juice (GDD §15): press platen stamp, ink splatter, paper flecks, flash (with a seizure-safe
 * limiter), screen shake, flying numbers and rubber stamps. Pure presentation.
 */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { isInk } from '../core/board';
import type { LineRef } from '../core/matrices';
import { BOARD_SIZE } from '../core/pieces';
import { FONT_DISPLAY, INK, INKS, PAPER } from '../theme';
import type { Animator } from './animator';
import { ease } from './animator';
import type { GameAssets } from './assets';
import type { BoardView } from './boardView';
import { CellSprite, inkColor, variantFor, type CellStyle } from './pieceView';

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  vr: number;
  life: number;
  max: number;
  gravity: number;
  fade: boolean;
}

/** At most 3 flashes per rolling second (WCAG 2.3.1). Exported for tests. */
export class FlashLimiter {
  private times: number[] = [];
  constructor(
    private readonly maxPerSecond = 3,
    private readonly now: () => number = () => performance.now(),
  ) {}
  allow(): boolean {
    const t = this.now();
    this.times = this.times.filter((x) => t - x < 1000);
    if (this.times.length >= this.maxPerSecond) return false;
    this.times.push(t);
    return true;
  }
}

export interface FxOptions {
  reduceMotion: boolean;
  /** Particle budget by device tier (150 / 400 / 800). */
  maxParticles: number;
}

export class FxLayer extends Container {
  private readonly particles: Particle[] = [];
  private readonly particleLayer = new Container();
  private readonly overlay = new Container();
  private readonly flashLayer = new Graphics();
  private readonly limiter = new FlashLimiter();
  private stopParticles: (() => void) | null = null;
  shakeTarget: Container | null = null;
  private shakeAmp = 0;
  private stopShake: (() => void) | null = null;

  constructor(
    private readonly assets: GameAssets,
    private readonly animator: Animator,
    public opts: FxOptions,
  ) {
    super();
    this.addChild(this.flashLayer, this.overlay, this.particleLayer);
  }

  /** Press stamp over printed lines; detached cell copies are then flicked away. */
  printLines(
    board: BoardView,
    lines: readonly LineRef[],
    cleared: ReadonlyArray<{ i: number; v: number }>,
    style: CellStyle,
    intensity: number,
  ): Promise<void> {
    const cs = board.cell;
    const size = cs * BOARD_SIZE;
    const bx = board.rect.x;
    const by = board.rect.y;
    const rm = this.opts.reduceMotion;

    // Detached copies of the cleared cells (the board already shows them empty).
    const copies: CellSprite[] = cleared.map(({ i, v }) => {
      const c = new CellSprite(this.assets);
      c.set(v, variantFor(i, 1), cs, style);
      const p = board.cellCenter(i);
      c.position.set(p.x, p.y);
      this.overlay.addChild(c);
      return c;
    });

    // Platens.
    const platens = lines.map((ref) => {
      const s = new Sprite(this.assets.tex('platen'));
      s.anchor.set(0.5);
      if (ref.kind === 'row') {
        s.width = size + 12;
        s.height = cs * 0.9;
        s.position.set(bx + size / 2, by + ref.n * cs + cs / 2);
      } else {
        s.rotation = Math.PI / 2;
        s.width = size + 12;
        s.height = cs * 0.9;
        s.position.set(bx + ref.n * cs + cs / 2, by + size / 2);
      }
      s.alpha = 0;
      this.overlay.addChild(s);
      return s;
    });

    const slamMs = rm ? 0 : 90;
    const done = new Promise<void>((resolve) => {
      const scale0 = 1.25;
      for (const p of platens) {
        const sx = p.scale.x;
        const sy = p.scale.y;
        p.scale.set(sx * scale0, sy * scale0);
        void this.animator.tween(p.scale, { x: sx, y: sy }, slamMs, { ease: ease.inCubic });
        void this.animator.tween(p, { alpha: rm ? 0.6 : 0.95 }, slamMs);
      }
      void this.animator.wait(slamMs).then(() => {
        // Impact.
        if (this.limiter.allow()) {
          const g = this.flashLayer;
          g.clear();
          for (const ref of lines) {
            if (ref.kind === 'row') g.rect(bx, by + ref.n * cs, size, cs);
            else g.rect(bx + ref.n * cs, by, cs, size);
          }
          g.fill({ color: 0xffffff, alpha: 0.3 });
          g.alpha = 1;
          void this.animator.tween(g, { alpha: 0 }, rm ? 120 : 220);
        }
        if (!rm && intensity >= 3) this.shake(Math.min(6, 2 + intensity));
        for (const p of platens) void this.animator.tween(p, { alpha: 0 }, rm ? 120 : 160, { delay: 40 }).then(() => p.destroy());
        // Cells → printed sheets fly off; ink splashes.
        copies.forEach((c, k) => {
          const v = cleared[k]?.v ?? 0;
          if (rm) {
            void this.animator.tween(c, { alpha: 0 }, 120).then(() => c.destroy({ children: true }));
            return;
          }
          const dir = Math.random() < 0.5 ? -1 : 1;
          void this.animator.tween(
            c,
            { alpha: 0, rotation: dir * (0.6 + Math.random()), y: c.y - cs * (0.6 + Math.random()), x: c.x + dir * cs * Math.random() },
            260 + Math.random() * 140,
            { delay: (k % 8) * 12, ease: ease.outCubic },
          ).then(() => c.destroy({ children: true }));
          void this.animator.tween(c.scale, { x: 0.6, y: 0.6 }, 300, { delay: (k % 8) * 12 });
          if (isInk(v)) this.splash(c.x, c.y, inkColor(v), cs, intensity);
          if (k % 3 === 0) this.fleck(c.x, c.y);
          if (k % 4 === 0 && isInk(v)) board.addStain(c.x, c.y, INKS[v] as number, cs * 1.6, `splat_${k % 4}`, rm);
        });
        void this.animator.wait(rm ? 140 : 320).then(resolve);
      });
    });
    return done;
  }

  private spawn(frame: string, x: number, y: number, tint: number, size: number, vx: number, vy: number, life: number, gravity: number): void {
    if (this.particles.length >= this.opts.maxParticles) return;
    const s = new Sprite(this.assets.tex(frame));
    s.anchor.set(0.5);
    s.tint = tint;
    s.width = size;
    s.height = size;
    s.position.set(x, y);
    s.rotation = Math.random() * Math.PI * 2;
    this.particleLayer.addChild(s);
    this.particles.push({ s, vx, vy, vr: (Math.random() - 0.5) * 8, life, max: life, gravity, fade: true });
    if (!this.stopParticles) this.stopParticles = this.animator.add(this.stepParticles);
  }

  private splash(x: number, y: number, color: number, cs: number, intensity: number): void {
    const n = 2 + Math.min(4, intensity);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 260 * (1 + intensity * 0.15);
      this.spawn(`drop_${k % 6}`, x, y, color, cs * (0.18 + Math.random() * 0.3), Math.cos(a) * sp, Math.sin(a) * sp - 120, 520 + Math.random() * 300, 900);
    }
  }

  private fleck(x: number, y: number): void {
    this.spawn(`fleck_${Math.floor(Math.random() * 4)}`, x, y, PAPER, 10 + Math.random() * 10, (Math.random() - 0.5) * 220, -180 - Math.random() * 200, 700, 600);
  }

  private stepParticles = (dt: number): boolean => {
    const s = dt / 1000;
    for (let k = this.particles.length - 1; k >= 0; k--) {
      const p = this.particles[k] as Particle;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.destroy();
        this.particles.splice(k, 1);
        continue;
      }
      p.vy += p.gravity * s;
      p.s.x += p.vx * s;
      p.s.y += p.vy * s;
      p.s.rotation += p.vr * s;
      if (p.fade) p.s.alpha = Math.min(1, (p.life / p.max) * 1.6);
    }
    if (this.particles.length === 0) {
      this.stopParticles = null;
      return false;
    }
    return true;
  };

  shake(amount: number): void {
    if (this.opts.reduceMotion || !this.shakeTarget) return;
    this.shakeAmp = Math.min(6, Math.max(this.shakeAmp, amount));
    if (this.stopShake) return;
    let t = 0;
    const target = this.shakeTarget;
    this.stopShake = this.animator.add((dt) => {
      t += dt;
      this.shakeAmp *= Math.pow(0.0005, dt / 1000);
      if (t > 300 || this.shakeAmp < 0.3) {
        target.position.set(0, 0);
        this.shakeAmp = 0;
        this.stopShake = null;
        return false;
      }
      target.position.set((Math.random() - 0.5) * 2 * this.shakeAmp, (Math.random() - 0.5) * 2 * this.shakeAmp);
      return true;
    });
  }

  /** A number that pops at `from` and flies to `to`. */
  flyNumber(text: string, from: { x: number; y: number }, to: { x: number; y: number }, color = INK): Promise<void> {
    const t = new Text({ text, style: { fontFamily: FONT_DISPLAY, fontSize: 30, fill: color, stroke: { color: PAPER, width: 5 }, padding: 6 } });
    t.anchor.set(0.5);
    t.position.set(from.x, from.y);
    t.scale.set(0.6);
    this.addChild(t);
    if (this.opts.reduceMotion) {
      return this.animator.tween(t, { alpha: 0 }, 300, { delay: 250 }).then(() => t.destroy());
    }
    return this.animator
      .tween(t.scale, { x: 1.15, y: 1.15 }, 160, { ease: ease.outBack })
      .then(() => this.animator.wait(120))
      .then(() =>
        Promise.all([
          this.animator.tween(t, { x: to.x, y: to.y, alpha: 0.2 }, 380, { ease: ease.inOutCubic }),
          this.animator.tween(t.scale, { x: 0.5, y: 0.5 }, 380),
        ]),
      )
      .then(() => t.destroy());
  }

  /** Rubber stamp (APPROVED / 1 INK / JAMMED). */
  stamp(text: string, at: { x: number; y: number }, color: number, size = 1): Promise<void> {
    const c = new Container();
    const ring = new Sprite(this.assets.tex('stamp_ring'));
    ring.anchor.set(0.5);
    ring.tint = color;
    const label = new Text({ text, style: { fontFamily: FONT_DISPLAY, fontSize: 40 * size, fill: color, letterSpacing: 3, padding: 6 } });
    label.anchor.set(0.5);
    ring.width = label.width + 60 * size;
    ring.height = label.height + 34 * size;
    c.addChild(ring, label);
    c.position.set(at.x, at.y);
    c.rotation = -0.12 + Math.random() * 0.06;
    c.alpha = 0;
    c.scale.set(this.opts.reduceMotion ? 1 : 1.8);
    this.addChild(c);
    const slam = this.opts.reduceMotion ? 120 : 140;
    return Promise.all([
      this.animator.tween(c, { alpha: 0.92 }, slam),
      this.animator.tween(c.scale, { x: 1, y: 1 }, slam, { ease: ease.inCubic }),
    ])
      .then(() => {
        if (!this.opts.reduceMotion) this.shake(3);
        return this.animator.wait(650);
      })
      .then(() => this.animator.tween(c, { alpha: 0 }, 260))
      .then(() => c.destroy({ children: true }));
  }

  /** Small label popping out of a line (e.g. "1 INK" on a monochrome line). */
  lineTag(text: string, board: BoardView, ref: LineRef): void {
    const cs = board.cell;
    const size = cs * BOARD_SIZE;
    const at =
      ref.kind === 'row'
        ? { x: board.rect.x + size / 2, y: board.rect.y + ref.n * cs + cs / 2 }
        : { x: board.rect.x + ref.n * cs + cs / 2, y: board.rect.y + size / 2 };
    void this.stamp(text, at, INK, 0.45);
  }

  clear(): void {
    for (const p of this.particles) p.s.destroy();
    this.particles.length = 0;
    this.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.flashLayer.clear();
  }
}

