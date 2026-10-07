/**
 * Gameplay scene: owns the Pixi application and composes board, tray, HUD, rack, FX and drag layers.
 */
import { Application, Container, TilingSprite } from 'pixi.js';
import { PAPER } from '../theme';
import { Animator } from './animator';
import type { GameAssets } from './assets';
import { BoardView } from './boardView';
import { FxLayer } from './fx';
import { HudView } from './hud';
import { computeLayout, type GameLayout, type Insets } from './layout';
import type { CellStyle } from './pieceView';
import { RackView } from './rackView';
import { TrayView } from './trayView';

export type DeviceTier = 'low' | 'mid' | 'high';

export function detectTier(): DeviceTier {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const cores = nav?.hardwareConcurrency ?? 4;
  const mem = nav?.deviceMemory ?? 4;
  if (cores <= 4 || mem <= 3) return 'low';
  if (cores >= 8 && mem >= 6) return 'high';
  return 'mid';
}

export const TIER_SETTINGS: Record<DeviceTier, { maxResolution: number; particles: number }> = {
  low: { maxResolution: 1.5, particles: 150 },
  mid: { maxResolution: 2, particles: 400 },
  high: { maxResolution: 2.5, particles: 800 },
};

export interface SceneOptions {
  style: CellStyle;
  reduceMotion: boolean;
  tier?: DeviceTier;
}

export class GameScene {
  readonly animator: Animator;
  readonly root = new Container();
  readonly world = new Container();
  readonly background: TilingSprite;
  readonly board: BoardView;
  readonly tray: TrayView;
  readonly hud: HudView;
  readonly rack: RackView;
  readonly fx: FxLayer;
  readonly dragLayer = new Container();
  layout!: GameLayout;
  tier: DeviceTier;
  private hasReserve = false;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  private constructor(
    readonly app: Application,
    readonly assets: GameAssets,
    opts: SceneOptions,
  ) {
    this.tier = opts.tier ?? detectTier();
    this.animator = new Animator(() => app.renderer.render(app.stage));
    this.background = new TilingSprite({ texture: assets.paper, width: 10, height: 10 });
    this.board = new BoardView(assets, this.animator, opts.style);
    this.tray = new TrayView(assets, this.animator, opts.style);
    this.hud = new HudView(this.animator);
    this.rack = new RackView(assets, this.animator);
    this.fx = new FxLayer(assets, this.animator, {
      reduceMotion: opts.reduceMotion,
      maxParticles: TIER_SETTINGS[this.tier].particles,
    });
    this.fx.shakeTarget = this.world;
    this.world.addChild(this.board, this.hud, this.rack, this.tray, this.fx);
    this.root.addChild(this.background, this.world, this.dragLayer);
    app.stage.addChild(this.root);
    app.stage.eventMode = 'none';
  }

  static async create(host: HTMLElement, assets: GameAssets, opts: SceneOptions): Promise<GameScene> {
    const app = new Application();
    const tier = opts.tier ?? detectTier();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    await app.init({
      preference: 'webgl',
      antialias: false,
      autoStart: false,
      sharedTicker: false,
      background: PAPER,
      backgroundAlpha: 1,
      resolution: Math.min(dpr, TIER_SETTINGS[tier].maxResolution),
      autoDensity: true,
      width: host.clientWidth || 360,
      height: host.clientHeight || 640,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
      powerPreference: 'high-performance',
    });
    app.ticker.stop();
    host.appendChild(app.canvas);
    app.canvas.style.display = 'block';
    app.canvas.style.touchAction = 'none';
    const scene = new GameScene(app, assets, { ...opts, tier });
    return scene;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  setInsets(insets: Insets): void {
    this.insets = insets;
  }

  setHasReserve(v: boolean): boolean {
    if (v === this.hasReserve) return false;
    this.hasReserve = v;
    return true;
  }

  resize(width: number, height: number): GameLayout {
    this.app.renderer.resize(width, height);
    this.background.width = width;
    this.background.height = height;
    const l = computeLayout({ width, height, insets: this.insets, hasReserve: this.hasReserve });
    this.layout = l;
    this.board.layout(l.board, l.cell);
    this.tray.layout(l.traySlots, l.reserve, l.trayCell);
    this.hud.layout(l.header, l.quota, l.status, l.counter);
    this.rack.layout(l.rack);
    this.animator.request();
    return l;
  }

  setStyle(style: CellStyle, reduceMotion: boolean): void {
    this.board.setStyle(style);
    this.tray.setStyle(style);
    this.fx.opts.reduceMotion = reduceMotion;
    this.animator.request();
  }

  /** Average and p95 frame time over the recorded window (debug overlay / perf test). */
  frameStats(): { avg: number; p95: number; n: number } {
    const a = [...this.animator.frameTimes].sort((x, y) => x - y);
    if (!a.length) return { avg: 0, p95: 0, n: 0 };
    const avg = a.reduce((s, v) => s + v, 0) / a.length;
    return { avg, p95: a[Math.floor(a.length * 0.95)] ?? 0, n: a.length };
  }

  destroy(): void {
    this.animator.destroy();
    this.app.destroy(true, { children: true });
  }
}
