/**
 * Presenter: applies engine events to the scene with animation, sound and haptics (GDD §5.5, §15).
 * The board mirrors logic immediately; the PRINTS × MULT counter plays back the score log and can
 * be fast-forwarded by the next print or a tap.
 */
import type { LineRef } from '../core/matrices';
import type { RunEngine, RunEvent } from '../core/run';
import type { ScoreEvent } from '../core/scoring';
import { INK, INKS } from '../theme';
import { fmtInt } from '../ui/i18n';
import type { CellStyle } from './pieceView';
import type { GameScene } from './scene';

export type CounterSpeed = 'normal' | 'fast' | 'instant';

export interface PresenterHooks {
  sound(name: string, opts?: { pitch?: number; intensity?: number }): void;
  haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection'): void;
  t(key: string, params?: Record<string, string | number>): string;
  speed(): CounterSpeed;
  reduceMotion(): boolean;
  style(): CellStyle;
  /** Called after any change that affects the rack / HUD numbers. */
  refreshHud(): void;
  announce(text: string): void;
}

const BUDGET: Record<CounterSpeed, number> = { normal: 1200, fast: 500, instant: 0 };

interface Step {
  P?: number;
  M?: number;
  kind: 'p' | 'm' | 'x' | 'line';
  slot?: number;
  pitch: number;
}

export function buildSteps(events: readonly ScoreEvent[]): Step[] {
  const raw: Step[] = [];
  let pitch = 0;
  for (const e of events) {
    if (e.t === 'p')
      raw.push({ kind: 'p', P: e.P, slot: typeof e.src === 'number' ? e.src : undefined, pitch: pitch++ });
    else if (e.t === 'lx')
      raw.push({ kind: 'x', P: e.P, slot: typeof e.src === 'number' ? e.src : undefined, pitch: pitch++ });
    else if (e.t === 'm')
      raw.push({ kind: 'm', M: e.M, slot: typeof e.src === 'number' ? e.src : undefined, pitch: pitch++ });
    else if (e.t === 'x')
      raw.push({ kind: 'x', M: e.M, slot: typeof e.src === 'number' ? e.src : undefined, pitch: pitch++ });
    else if (e.t === 'line') raw.push({ kind: 'line', pitch });
  }
  if (raw.filter((s) => s.kind !== 'line').length <= 40) return raw.filter((s) => s.kind !== 'line');
  // Merge plain per-cell prints of a line into one step; keep plate contributions visible.
  const merged: Step[] = [];
  let acc: Step | null = null;
  for (const s of raw) {
    if (s.kind === 'line') {
      if (acc) merged.push(acc);
      acc = null;
      continue;
    }
    if (s.kind === 'p' && s.slot === undefined) {
      acc = { ...s, pitch: merged.length };
      continue;
    }
    if (acc) {
      merged.push(acc);
      acc = null;
    }
    merged.push({ ...s, pitch: merged.length });
  }
  if (acc) merged.push(acc);
  return merged;
}

export class Presenter {
  private playToken = 0;
  private playing: Promise<void> = Promise.resolve();
  private fx: Promise<void> = Promise.resolve();
  private lastP = 0;
  private lastM = 0;
  lastPrint: Extract<RunEvent, { type: 'printed' }> | null = null;

  constructor(
    private readonly scene: GameScene,
    private readonly hooks: PresenterHooks,
  ) {}

  /** Forget the previous run: no "last print" breakdown, counter back to 0 × 0. */
  reset(): void {
    this.playToken++;
    this.lastPrint = null;
    this.lastP = 0;
    this.lastM = 0;
    this.scene.hud.setCounter(0, 0);
  }

  /** Full refresh without animation (resume, new contract, layout change). */
  syncAll(engine: RunEngine): void {
    const s = engine.state;
    const scene = this.scene;
    scene.board.setSalt(s.contractIndex + 1);
    scene.board.setCells(s.cells);
    scene.tray.set(s.tray, s.reserve, this.trayNotes(engine));
    const c = s.contract;
    scene.hud.setQuota(c.progress, c.spec.quota, false);
    scene.hud.setSheets(c.sheetsLeft, c.sheetsUsed, c.spec.sheets);
    scene.hud.setStreak(
      c.streak,
      c.dry,
      engine.streakGrace(),
      c.spec.modifiers.some((m) => m.id === 'wet_ink'),
    );
    this.hooks.refreshHud();
    scene.animator.request();
  }

  trayNotes(engine: RunEngine): string[] {
    const s = engine.state;
    return [0, 1, 2].map((i) => (i >= s.traySize ? '▢' : ''));
  }

  /** Applies one engine action's events. Resolves once immediate visuals are scheduled. */
  apply(events: readonly RunEvent[], engine: RunEngine): void {
    const scene = this.scene;
    const rm = this.hooks.reduceMotion();
    const style = this.hooks.style();
    for (const e of events) {
      switch (e.type) {
        case 'contract_started':
          this.fastForward();
          scene.fx.clear();
          this.syncAll(engine);
          this.setCounter(0, 0);
          break;
        case 'dealt':
          scene.tray.set(engine.state.tray, engine.state.reserve, this.trayNotes(engine));
          scene.tray.animateDeal(rm);
          this.hooks.sound('card_flip');
          break;
        case 'placed':
          scene.board.placeCells(e.cells, e.piece.ink, rm);
          scene.tray.set(engine.state.tray, engine.state.reserve, this.trayNotes(engine));
          scene.hud.setSheets(
            engine.state.contract.sheetsLeft,
            engine.state.contract.sheetsUsed,
            engine.state.contract.spec.sheets,
          );
          this.hooks.sound('place');
          this.hooks.haptic('light');
          break;
        case 'printed':
          this.onPrinted(e, engine, style, rm);
          break;
        case 'streak': {
          const wet = engine.state.contract.spec.modifiers.some((m) => m.id === 'wet_ink');
          scene.hud.setStreak(e.streak, e.dry, e.grace, wet);
          if (e.broken) this.hooks.sound('streak_break');
          break;
        }
        case 'stashed':
          scene.tray.set(engine.state.tray, engine.state.reserve, this.trayNotes(engine));
          this.hooks.sound('paper');
          this.hooks.haptic('selection');
          break;
        case 'contract_won':
          this.fx = this.fx
            .then(() => this.playing)
            .then(() => scene.fx.stamp(this.hooks.t('stamp.approved'), this.boardCenter(), INKS[3]));
          this.hooks.sound('quota_done');
          this.hooks.haptic('success');
          break;
        case 'lost': {
          const text = e.reason === 'jam' ? this.hooks.t('stamp.jam') : this.hooks.t('stamp.out_of_sheets');
          this.fx = this.fx
            .then(() => this.playing)
            .then(() => scene.fx.stamp(text, this.boardCenter(), INKS[0]));
          this.hooks.sound(e.reason === 'jam' ? 'jam' : 'lose');
          this.hooks.haptic('error');
          if (!rm) scene.fx.shake(5);
          break;
        }
        case 'last_chance':
          this.hooks.sound('streak_break');
          break;
        case 'continued':
          scene.board.setCells(engine.state.cells);
          scene.tray.set(engine.state.tray, engine.state.reserve, this.trayNotes(engine));
          scene.hud.setSheets(
            engine.state.contract.sheetsLeft,
            engine.state.contract.sheetsUsed,
            engine.state.contract.spec.sheets,
          );
          this.hooks.sound('stamp');
          break;
        case 'plate_sold':
          this.hooks.sound('sell');
          scene.hud.setSheets(
            engine.state.contract.sheetsLeft,
            engine.state.contract.sheetsUsed,
            engine.state.contract.spec.sheets,
          );
          this.hooks.refreshHud();
          break;
        case 'plate_added':
        case 'plate_moved':
          this.hooks.refreshHud();
          break;
        default:
          break;
      }
    }
    scene.animator.request();
  }

  private boardCenter(): { x: number; y: number } {
    const b = this.scene.board.rect;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  private onPrinted(
    e: Extract<RunEvent, { type: 'printed' }>,
    engine: RunEngine,
    style: CellStyle,
    rm: boolean,
  ): void {
    const scene = this.scene;
    this.lastPrint = e;
    this.fastForward();
    const lines: LineRef[] = e.result.ctx.lines as LineRef[];
    scene.board.clearCells(e.cleared.map((c) => c.i));
    const intensity = e.result.ctx.lineCount;
    this.fx = scene.fx.printLines(scene.board, lines, e.cleared, style, intensity);
    this.hooks.sound(intensity >= 3 ? 'print_big' : 'print', { intensity: Math.min(1, intensity / 4) });
    this.hooks.haptic(intensity >= 3 ? 'heavy' : 'medium');
    if (e.result.ctx.monoLines > 0) {
      const lineIdx = e.result.ctx.lineInkCounts.findIndex((n, i) => n === 1 && this.isMono(e, i));
      const ref = lines[lineIdx >= 0 ? lineIdx : 0];
      if (ref) scene.fx.lineTag(this.hooks.t('stamp.one_ink'), scene.board, ref);
    }
    if (e.streak > 0) {
      this.hooks.sound('streak_up', { pitch: Math.min(12, e.streak) });
      scene.hud.bumpStreak();
    }
    const c = engine.state.contract;
    scene.hud.setQuota(e.progress, c.spec.quota, !rm);
    this.hooks.announce(
      this.hooks.t('sr.print', {
        lines: intensity,
        score: fmtInt(e.result.total),
        progress: fmtInt(e.progress),
        quota: fmtInt(c.spec.quota),
        sheets: c.sheetsLeft,
      }),
    );
    this.playCounter(e.result.events, e.result.prints, e.result.mult, e.result.total);
  }

  private isMono(e: Extract<RunEvent, { type: 'printed' }>, lineIndex: number): boolean {
    const ref = e.result.ctx.lines[lineIndex];
    if (!ref) return false;
    const idx = (k: number) => (ref.kind === 'row' ? ref.n * 8 + k : k * 8 + ref.n);
    const vals = new Set<number>();
    for (let k = 0; k < 8; k++) {
      const hit = e.cleared.find((c) => c.i === idx(k));
      if (!hit || hit.v > 4) return false;
      vals.add(hit.v);
    }
    return vals.size === 1;
  }

  private setCounter(P: number, M: number): void {
    this.lastP = P;
    this.lastM = M;
    this.scene.hud.setCounter(P, M);
  }

  private playCounter(events: readonly ScoreEvent[], P: number, M: number, total: number): void {
    const token = ++this.playToken;
    const steps = buildSteps(events);
    const budget = BUDGET[this.hooks.speed()];
    const per = steps.length ? Math.max(16, Math.min(120, budget / steps.length)) : 0;
    const scene = this.scene;
    // MULT starts at the base value (lines + streak + single-ink) so it never reads "× 0".
    let baseM = 0;
    for (const e of events)
      if (e.t === 'm' && (e.src === 'lines' || e.src === 'streak' || e.src === 'mono')) baseM = e.M;
    this.setCounter(0, baseM);
    const run = async () => {
      if (budget > 0) {
        let p = 0;
        let m = baseM;
        for (const s of steps) {
          if (token !== this.playToken) return;
          if (s.P !== undefined) p = s.P;
          if (s.M !== undefined) m = s.M;
          this.setCounter(p, m);
          scene.hud.pulse(s.kind === 'x' ? 'x' : s.kind === 'm' ? 'm' : 'p');
          if (s.slot !== undefined) scene.rack.wiggle(s.slot);
          const name = s.kind === 'x' ? 'xmult' : s.kind === 'm' ? 'tick_mult' : 'tick_prints';
          this.hooks.sound(name, { pitch: Math.min(24, s.pitch) });
          await scene.animator.wait(per);
        }
      }
      if (token !== this.playToken) return;
      this.setCounter(P, M);
      await scene.fx.flyNumber(fmtInt(total), scene.hud.counterCenter(), scene.hud.quotaAnchor(), INK);
    };
    this.playing = run();
  }

  /** Snap the running counter playback to its final values. */
  fastForward(): void {
    if (this.lastPrint && this.playToken > 0) {
      this.playToken++;
      const r = this.lastPrint.result;
      this.scene.hud.setCounter(r.prints, r.mult);
    }
  }

  /** Resolves when the counter and the key FX are done (capped at 1.5 s). */
  idle(): Promise<void> {
    const cap = new Promise<void>((r) => setTimeout(r, 1500));
    return Promise.race([Promise.all([this.playing, this.fx]).then(() => undefined), cap]);
  }

  get counterValues(): { P: number; M: number } {
    return { P: this.lastP, M: this.lastM };
  }
}
