/**
 * Pointer input on the gameplay canvas (GDD §3.4): drag & tap-to-place modes, stash drop,
 * rack tap/reorder, counter tap. Pixi's own event system is disabled for performance.
 */
import type { FullLines } from '../core/board';
import type { SlotRef, TrayPiece } from '../core/run';
import { ease } from './animator';
import { contains } from './layout';
import { PieceView } from './pieceView';
import type { GameScene } from './scene';
import { snap, type GridPos } from './snap';

export type ControlMode = 'drag' | 'tap';

export interface InputCallbacks {
  canInteract(): boolean;
  pieceAt(slot: SlotRef): TrayPiece | null;
  isValid(slot: SlotRef, x: number, y: number): boolean;
  previewLines(slot: SlotRef, x: number, y: number): FullLines | null;
  canStash(slot: number): boolean;
  reserveUsable(): boolean;
  place(slot: SlotRef, x: number, y: number): void;
  stash(slot: number): void;
  rackTap(slot: number): void;
  rackMove(from: number, to: number): void;
  counterTap(): void;
  trayTapHint(slot: SlotRef): void;
  feedback(kind: 'pickup' | 'snap' | 'invalid' | 'select'): void;
  /** Tap-mode selection changed (controller shows/hides the "Place" button). */
  selectionChanged(sel: { slot: SlotRef; ghost: GridPos | null } | null): void;
}

const TAP_SLOP = 8;
const TAP_MS = 300;

interface DragState {
  pointerId: number;
  slot: SlotRef;
  piece: TrayPiece;
  proxy: PieceView;
  startX: number;
  startY: number;
  startT: number;
  moved: boolean;
  ghost: GridPos | null;
  overReserve: boolean;
  release: () => void;
}

interface RackDrag {
  pointerId: number;
  slot: number;
  startX: number;
  startY: number;
  startT: number;
  reordering: boolean;
  target: number;
}

export class InputController {
  mode: ControlMode = 'drag';
  reduceMotion = false;
  private drag: DragState | null = null;
  private rackDrag: RackDrag | null = null;
  private activePointer: number | null = null;
  private tapSel: { slot: SlotRef; ghost: GridPos | null } | null = null;
  private detach: Array<() => void> = [];

  constructor(
    private readonly scene: GameScene,
    private readonly cb: InputCallbacks,
  ) {
    const el = scene.canvas;
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(t, f as EventListener, { passive: false });
      this.detach.push(() => el.removeEventListener(t, f as EventListener));
    };
    on('pointerdown', this.onDown);
    on('pointermove', this.onMove);
    on('pointerup', this.onUp);
    on('pointercancel', this.onCancel);
    on('lostpointercapture', this.onCancel);
    on('contextmenu', (e) => e.preventDefault());
    const vis = () => {
      if (document.hidden) this.cancelAll();
    };
    document.addEventListener('visibilitychange', vis);
    this.detach.push(() => document.removeEventListener('visibilitychange', vis));
  }

  destroy(): void {
    this.cancelAll();
    for (const d of this.detach) d();
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.scene.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    if (this.activePointer !== null) return; // ignore extra fingers
    const { x, y } = this.local(e);
    const L = this.scene.layout;
    // Counter tap (fast-forward / last print breakdown).
    if (contains(L.counter, x, y)) {
      this.cb.counterTap();
      return;
    }
    // Rack.
    const card = this.scene.rack.hitTest(x, y);
    if (card !== null) {
      this.activePointer = e.pointerId;
      this.scene.canvas.setPointerCapture(e.pointerId);
      this.rackDrag = {
        pointerId: e.pointerId,
        slot: card,
        startX: x,
        startY: y,
        startT: performance.now(),
        reordering: false,
        target: card,
      };
      return;
    }
    if (!this.cb.canInteract()) return;
    const slot = this.scene.tray.hitTest(x, y);
    if (this.mode === 'tap') {
      this.onTapModeDown(slot, x, y);
      return;
    }
    if (slot === null) return;
    if (slot === 'reserve' && !this.cb.reserveUsable()) return;
    const piece = this.cb.pieceAt(slot);
    if (!piece) return;
    e.preventDefault();
    this.activePointer = e.pointerId;
    this.scene.canvas.setPointerCapture(e.pointerId);
    this.beginDrag(e.pointerId, slot, piece, x, y);
  };

  private beginDrag(pointerId: number, slot: SlotRef, piece: TrayPiece, x: number, y: number): void {
    const scene = this.scene;
    const trayView = scene.tray.pieceView(slot);
    const proxy = new PieceView(scene.assets, piece, scene.layout.cell, scene.board.cellStyle);
    scene.dragLayer.addChild(proxy);
    const target = this.proxyTarget(proxy, x, y);
    if (trayView && !this.reduceMotion) {
      // Tween from the tray preview to the lifted position (no visible jump).
      const s0 = scene.layout.trayCell / scene.layout.cell;
      const g = trayView.getGlobalPosition();
      proxy.position.set(g.x, g.y);
      proxy.scale.set(s0);
      void scene.animator.tween(proxy.scale, { x: 1, y: 1 }, 90, { ease: ease.outCubic, key: proxy.scale });
      void scene.animator.tween(proxy, { x: target.x, y: target.y }, 90, { ease: ease.outCubic, key: proxy });
    } else proxy.position.set(target.x, target.y);
    scene.tray.setHidden(slot, true);
    this.drag = {
      pointerId,
      slot,
      piece,
      proxy,
      startX: x,
      startY: y,
      startT: performance.now(),
      moved: false,
      ghost: null,
      overReserve: false,
      release: scene.animator.hold(),
    };
    this.cb.feedback('pickup');
    this.updateGhost(x, y);
  }

  /** Lifted position: centred horizontally on the finger, bottom edge max(1.25 cells, 48 px) above it. */
  private proxyTarget(proxy: PieceView, x: number, y: number): { x: number; y: number } {
    const lift = Math.max(this.scene.layout.cell * 1.25, 48);
    return { x: x - proxy.pixelW / 2, y: y - lift - proxy.pixelH };
  }

  private updateGhost(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    const scene = this.scene;
    const L = scene.layout;
    const t = this.proxyTarget(d.proxy, x, y);
    scene.animator.cancel(d.proxy);
    d.proxy.position.set(t.x, t.y);
    // Stash drop target (hit-tested by finger position).
    const res = d.slot !== 'reserve' && L.reserve && this.cb.reserveUsable() && contains(L.reserve, x, y, 16);
    if (res !== d.overReserve) {
      d.overReserve = Boolean(res);
      scene.tray.setReserveHover(d.overReserve);
    }
    if (d.overReserve) {
      d.ghost = null;
      scene.board.hideGhost();
      d.proxy.alpha = 0.85;
      return;
    }
    const fx = (t.x - L.board.x) / L.cell;
    const fy = (t.y - L.board.y) / L.cell;
    const next = snap(fx, fy, (gx, gy) => this.cb.isValid(d.slot, gx, gy), d.ghost);
    const changed = (next?.x ?? -9) !== (d.ghost?.x ?? -9) || (next?.y ?? -9) !== (d.ghost?.y ?? -9);
    d.ghost = next;
    if (next) {
      if (changed) {
        scene.board.showGhost(d.piece, next.x, next.y, this.cb.previewLines(d.slot, next.x, next.y));
        this.cb.feedback('snap');
      }
      d.proxy.alpha = 1;
    } else {
      scene.board.hideGhost();
      const overBoard = contains(L.board, t.x + d.proxy.pixelW / 2, t.y + d.proxy.pixelH / 2, L.cell);
      d.proxy.alpha = overBoard ? 0.6 : 1;
    }
    scene.animator.request();
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return;
    const { x, y } = this.local(e);
    if (this.drag) {
      if (!this.drag.moved && Math.hypot(x - this.drag.startX, y - this.drag.startY) > TAP_SLOP)
        this.drag.moved = true;
      this.updateGhost(x, y);
      return;
    }
    const r = this.rackDrag;
    if (r) {
      if (!r.reordering && Math.abs(x - r.startX) > TAP_SLOP) {
        r.reordering = true;
        this.scene.rack.beginDrag(r.slot);
      }
      if (r.reordering) {
        const t = this.scene.rack.dragTo(x);
        if (t !== r.target) {
          r.target = t;
          this.cb.feedback('snap');
        }
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    const { x, y } = this.local(e);
    const r = this.rackDrag;
    if (r) {
      this.rackDrag = null;
      if (r.reordering) {
        this.scene.rack.endDrag();
        if (r.target !== r.slot) this.cb.rackMove(r.slot, r.target);
      } else if (performance.now() - r.startT < 600) this.cb.rackTap(r.slot);
      return;
    }
    const d = this.drag;
    if (!d) return;
    const quickTap = !d.moved && performance.now() - d.startT < TAP_MS;
    if (quickTap) {
      this.endDrag(false);
      this.cb.trayTapHint(d.slot);
      return;
    }
    void x;
    void y;
    if (d.overReserve && typeof d.slot === 'number' && this.cb.canStash(d.slot)) {
      this.endDrag(true);
      this.cb.stash(d.slot);
      return;
    }
    if (d.ghost && this.cb.canInteract() && this.cb.isValid(d.slot, d.ghost.x, d.ghost.y)) {
      const { slot, ghost } = d;
      this.endDrag(true);
      this.cb.place(slot, ghost.x, ghost.y);
      return;
    }
    this.cb.feedback('invalid');
    this.endDrag(false);
  };

  private onCancel = (e: Event) => {
    const pe = e as PointerEvent;
    if (pe.pointerId !== undefined && pe.pointerId !== this.activePointer) return;
    this.cancelAll();
  };

  /** Ends the drag; when not committed, the piece springs back to its tray slot. */
  private endDrag(committed: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const scene = this.scene;
    scene.board.hideGhost();
    scene.tray.setReserveHover(false);
    const finish = () => {
      d.proxy.destroy({ children: true });
      if (!committed) scene.tray.setHidden(d.slot, false);
      d.release();
    };
    if (committed || this.reduceMotion) {
      finish();
      return;
    }
    const trayView = scene.tray.pieceView(d.slot);
    if (!trayView) {
      finish();
      return;
    }
    const g = trayView.getGlobalPosition();
    const s = scene.layout.trayCell / scene.layout.cell;
    void Promise.all([
      scene.animator.tween(d.proxy, { x: g.x, y: g.y }, 180, { ease: ease.outBack, key: d.proxy }),
      scene.animator.tween(d.proxy.scale, { x: s, y: s }, 180, { key: d.proxy.scale }),
    ]).then(finish);
  }

  /** Cancels any interaction (pointercancel, background, resize, job ended). */
  cancelAll(): void {
    this.activePointer = null;
    if (this.drag) this.endDrag(false);
    if (this.rackDrag) {
      if (this.rackDrag.reordering) this.scene.rack.endDrag();
      this.rackDrag = null;
    }
  }

  // ------------------------------------------------------------------ tap-to-place

  private onTapModeDown(slot: SlotRef | null, x: number, y: number): void {
    const scene = this.scene;
    if (slot !== null) {
      const cur = this.tapSel;
      // Tap mode's "drop on the Type Case": selected tray piece + tap on the case = stash.
      if (slot === 'reserve' && cur && typeof cur.slot === 'number' && this.cb.canStash(cur.slot)) {
        this.setTapSel(null);
        this.cb.stash(cur.slot);
        this.cb.feedback('select');
        return;
      }
      if (slot === 'reserve' && !this.cb.reserveUsable()) return;
      if (!this.cb.pieceAt(slot)) return;
      const same = this.tapSel?.slot === slot;
      this.setTapSel(same ? null : { slot, ghost: null });
      this.cb.feedback('select');
      return;
    }
    const sel = this.tapSel;
    if (!sel) return;
    const L = scene.layout;
    if (!contains(L.board, x, y)) return;
    const piece = this.cb.pieceAt(sel.slot);
    if (!piece) return;
    const cx = Math.floor((x - L.board.x) / L.cell);
    const cy = Math.floor((y - L.board.y) / L.cell);
    // Second tap inside the ghost places the piece.
    if (sel.ghost) {
      const shape = scene.tray.pieceView(sel.slot)?.shape;
      const inside = shape?.cells.some(
        ([px, py]) => px + (sel.ghost as GridPos).x === cx && py + (sel.ghost as GridPos).y === cy,
      );
      if (inside) {
        this.confirmTap();
        return;
      }
    }
    const shape = scene.tray.pieceView(sel.slot)?.shape;
    if (!shape) return;
    const fx = cx - (shape.w - 1) / 2;
    const fy = cy - (shape.h - 1) / 2;
    const g = snap(fx, fy, (gx, gy) => this.cb.isValid(sel.slot, gx, gy), null);
    sel.ghost = g;
    if (g) {
      scene.board.showGhost(piece, g.x, g.y, this.cb.previewLines(sel.slot, g.x, g.y));
      this.cb.feedback('snap');
    } else {
      scene.board.hideGhost();
      this.cb.feedback('invalid');
    }
    this.cb.selectionChanged(sel);
  }

  private setTapSel(sel: { slot: SlotRef; ghost: GridPos | null } | null): void {
    this.tapSel = sel;
    this.scene.tray.setSelected(sel ? sel.slot : null);
    if (!sel?.ghost) this.scene.board.hideGhost();
    this.cb.selectionChanged(sel);
  }

  /** "Place" button / second tap. */
  confirmTap(): void {
    const sel = this.tapSel;
    if (!sel?.ghost || !this.cb.isValid(sel.slot, sel.ghost.x, sel.ghost.y)) return;
    const { slot, ghost } = sel;
    this.setTapSel(null);
    this.cb.place(slot, ghost.x, ghost.y);
  }

  clearSelection(): void {
    if (this.tapSel) this.setTapSel(null);
  }
}
