/**
 * Interactive tutorial (GDD §13): 3 steps, learning by playing.
 *  1. sandbox — fill a row with one piece (only the target placement is accepted)
 *  2. sandbox — print a row and a column at once with an L piece
 *  3. the real first job of a run, with at most two hint bubbles
 */
import { EMPTY, idx } from '../core/board';
import type { RunPhase, RunEvent, SlotRef } from '../core/run';
import { RunEngine } from '../core/run';
import { button, h, svgIcon } from '../ui/dom';
import { t } from '../ui/i18n';
import { uiIcon } from '../ui/iconset';
import type { GameController } from './controller';

interface Target {
  slot: number;
  x: number;
  y: number;
}

export class Tutorial {
  step = 1;
  sandbox = true;
  private target: Target | null = null;
  private card: HTMLElement | null = null;
  private hand: HTMLElement | null = null;
  private handTimer = 0;
  private idleTimer = 0;
  private advancing = false;
  private streakHintShown = false;
  private advanceTimer = 0;
  private idleListener: (() => void) | null = null;
  private disposed = false;

  /**
   * @param replay Started from Settings by someone who already finished it: the sandbox steps
   *   are shown, but it ends back on the title instead of starting (and saving over) a real run.
   */
  constructor(
    private readonly ctl: GameController,
    readonly replay = false,
  ) {}

  start(): void {
    this.setupStep1();
  }

  get host(): HTMLElement {
    return document.getElementById('hud') as HTMLElement;
  }

  // ------------------------------------------------------------------ sandbox steps

  private sandboxEngine(
    fill: (cells: number[]) => void,
    tray: Array<{ shape: string; ink: number } | null>,
  ): RunEngine {
    const { engine } = RunEngine.create({ seed: 'press-tutorial' });
    const s = engine.snapshot();
    s.cells = new Array<number>(64).fill(EMPTY);
    fill(s.cells);
    s.tray = tray.map((p, i) => (p ? { uid: 9000 + this.step * 10 + i, shape: p.shape, ink: p.ink } : null));
    s.contract.spec = { ...s.contract.spec, quota: 500, special: false, modifiers: [] };
    s.editionModifiers = { '1': [] };
    s.contract.sheetsLeft = 20;
    return RunEngine.restore(s);
  }

  private setupStep1(): void {
    this.step = 1;
    this.sandbox = true;
    const row = 7;
    const inks = [1, 2, 3, 4, 1];
    const engine = this.sandboxEngine(
      (c) => {
        for (let x = 0; x < 5; x++) c[idx(x, row)] = inks[x] as number;
      },
      [null, { shape: 'i3h', ink: 0 }, null],
    );
    this.target = { slot: 1, x: 5, y: row };
    this.ctl.installSandbox(engine);
    this.showCard(t('tut.step1'), true);
    this.scheduleHand();
  }

  private setupStep2(): void {
    this.step = 2;
    const engine = this.sandboxEngine(
      (c) => {
        const colors = [0, 1, 2, 3, 4, 0];
        for (let x = 0; x < 6; x++) c[idx(x, 7)] = colors[x] as number;
        for (let y = 0; y < 6; y++) c[idx(7, y)] = colors[(y + 2) % 6] as number;
        // A few loose cells so it looks like a real forme.
        c[idx(2, 3)] = 3;
        c[idx(3, 3)] = 3;
        c[idx(4, 5)] = 1;
      },
      [{ shape: 'l3b', ink: 4 }, null, null],
    );
    this.target = { slot: 0, x: 6, y: 6 };
    this.ctl.installSandbox(engine);
    this.showCard(t('tut.step2'), false);
    this.scheduleHand();
  }

  private startStep3(): void {
    if (this.replay) {
      this.ctl.finishTutorial();
      return;
    }
    this.step = 3;
    this.sandbox = false;
    this.target = null;
    this.clearHand();
    void this.ctl.startRun('normal').then(() => {
      this.ctl.markTutorialDone();
      this.showCard(t('tut.step3_quota'), false, 5000);
    });
  }

  allows(slot: SlotRef, x: number, y: number): boolean {
    if (!this.target) return true;
    return slot === this.target.slot && x === this.target.x && y === this.target.y;
  }

  onEvents(events: readonly RunEvent[]): void {
    for (const e of events) {
      if (e.type === 'placed') this.clearHand();
      if (e.type === 'printed' && this.sandbox && !this.advancing) {
        this.advancing = true;
        const done = this.step === 1 ? t('tut.step1_done') : t('tut.step2_done');
        this.showCard(done, false);
        window.clearTimeout(this.advanceTimer);
        this.advanceTimer = window.setTimeout(() => {
          if (this.disposed) return;
          this.advancing = false;
          if (this.step === 1) this.setupStep2();
          else this.startStep3();
        }, 2200);
      }
      if (e.type === 'printed' && this.step === 3 && !this.streakHintShown && e.streak >= 2) {
        this.streakHintShown = true;
        this.showCard(t('tut.step3_streak'), false, 3500);
      }
      if (e.type === 'contract_won' && this.step === 3) {
        // The offer screen shows the plate hint; the tutorial is complete after this job.
        window.setTimeout(() => this.ctl.finishTutorial(), 0);
      }
    }
  }

  /** Suppress end-of-phase screens inside the sandbox. */
  interceptPhase(phase: RunPhase): boolean {
    return this.sandbox && phase !== 'playing';
  }

  // ------------------------------------------------------------------ overlays

  private showCard(text: string, withSkip: boolean, autoHideMs = 0): void {
    this.card?.remove();
    const L = this.ctl.scene.layout;
    const card = h('div', { class: 'tut-card', role: 'status' }, h('div', null, text));
    if (withSkip) {
      card.append(
        h(
          'div',
          { style: 'margin-top:10px' },
          button(t('tut.skip_known'), () => this.skip(), { variant: 'ghost', small: true }),
        ),
      );
    }
    card.style.top = `${Math.max(8, L?.rack.y ?? 120)}px`;
    if (L?.landscape) {
      // Side column layout: keep the card next to the HUD, never over the forme.
      card.style.left = `${L.rack.x}px`;
      card.style.width = `${L.rack.w}px`;
      card.style.transform = 'none';
    }
    this.host.append(card);
    this.card = card;
    if (autoHideMs) window.setTimeout(() => this.card === card && card.remove(), autoHideMs);
  }

  private skip(): void {
    this.clearHand();
    this.card?.remove();
    this.startStep3();
  }

  private scheduleHand(): void {
    this.clearHand();
    const run = () => this.animateHand();
    this.handTimer = window.setTimeout(run, 600);
    if (!this.idleListener) {
      this.idleListener = () => {
        window.clearTimeout(this.idleTimer);
        this.idleTimer = window.setTimeout(() => !this.disposed && this.target && this.animateHand(), 2600);
      };
      this.ctl.scene.canvas.addEventListener('pointerup', this.idleListener);
    }
  }

  private animateHand(): void {
    const tg = this.target;
    if (!tg || this.disposed) return;
    const api = this.ctl.debugApi() as {
      dragPoints: (
        s: SlotRef,
        x: number,
        y: number,
      ) => { from: { x: number; y: number }; to: { x: number; y: number } } | null;
    };
    const pts = api.dragPoints(tg.slot, tg.x, tg.y);
    if (!pts) return;
    this.hand?.remove();
    const hand = h('div', { class: 'tut-hand' });
    hand.append(svgIcon(uiIcon('hand'), ''));
    this.host.append(hand);
    this.hand = hand;
    const rm = this.ctl.reduceMotion;
    const place = (p: { x: number; y: number }) => {
      hand.style.left = `${p.x - 16}px`;
      hand.style.top = `${p.y - 8}px`;
    };
    place(pts.from);
    if (rm) {
      place(pts.to);
      return;
    }
    const start = performance.now();
    const dur = 1100;
    const frame = (now: number) => {
      if (this.hand !== hand) return;
      const p = Math.min(1, (now - start) / dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      place({ x: pts.from.x + (pts.to.x - pts.from.x) * e, y: pts.from.y + (pts.to.y - pts.from.y) * e });
      if (p < 1) requestAnimationFrame(frame);
      else window.setTimeout(() => this.hand === hand && this.animateHand(), 900);
    };
    requestAnimationFrame(frame);
  }

  private clearHand(): void {
    window.clearTimeout(this.handTimer);
    window.clearTimeout(this.idleTimer);
    this.hand?.remove();
    this.hand = null;
  }

  dispose(): void {
    this.disposed = true;
    this.target = null;
    window.clearTimeout(this.advanceTimer);
    this.clearHand();
    if (this.idleListener) this.ctl.scene.canvas.removeEventListener('pointerup', this.idleListener);
    this.idleListener = null;
    this.card?.remove();
    this.card = null;
  }
}
