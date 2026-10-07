/**
 * DOM layer stack: full screens, bottom sheets and dialogs over the Pixi canvas.
 * Each layer can register an Android back handler (GDD §12.3).
 */
import type { BackService } from '../game/services';
import { h } from './dom';

export interface LayerOpts {
  /** Back button handler; return true/void = consumed. Default: close the layer. */
  onBack?: () => boolean | void;
  kind?: 'screen' | 'sheet' | 'dialog';
  /** Tap on the scrim closes (sheets/dialogs). */
  dismissible?: boolean;
  onClose?: () => void;
}

interface Layer {
  id: string;
  root: HTMLElement;
  popBack: () => void;
  onClose?: () => void;
}

export class UiManager {
  private layers: Layer[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly back: BackService,
  ) {}

  has(id: string): boolean {
    return this.layers.some((l) => l.id === id);
  }

  get top(): string | null {
    return this.layers[this.layers.length - 1]?.id ?? null;
  }

  get count(): number {
    return this.layers.length;
  }

  /** Shows content as a full screen, sheet or dialog. Replaces an existing layer with the same id. */
  show(id: string, content: HTMLElement, opts: LayerOpts = {}): HTMLElement {
    this.close(id, false);
    const kind = opts.kind ?? 'screen';
    let root: HTMLElement;
    if (kind === 'screen') {
      root = h('div', { class: 'screen', 'data-layer': id }, content);
    } else {
      const scrim = h('div', { class: 'scrim' });
      const panel = h(
        'div',
        { class: kind === 'sheet' ? 'sheet' : 'dialog', role: 'dialog', 'aria-modal': 'true' },
        content,
      );
      root = h('div', { class: 'layer', 'data-layer': id, style: 'position:absolute;inset:0' }, scrim, panel);
      if (opts.dismissible !== false) scrim.addEventListener('click', () => this.close(id));
    }
    this.host.append(root);
    const popBack = this.back.push(() => {
      if (opts.onBack) return opts.onBack();
      this.close(id);
      return true;
    });
    this.layers.push({ id, root, popBack, onClose: opts.onClose });
    // Move focus into the new layer for screen readers / keyboards without lighting up a button ring.
    root.tabIndex = -1;
    root.setAttribute('data-focus-root', '');
    root.focus({ preventScroll: true });
    return root;
  }

  close(id: string, runOnClose = true): void {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const [layer] = this.layers.splice(idx, 1);
    if (!layer) return;
    layer.popBack();
    layer.root.remove();
    if (runOnClose) layer.onClose?.();
  }

  closeTop(): void {
    const top = this.layers[this.layers.length - 1];
    if (top) this.close(top.id);
  }

  clear(): void {
    for (const l of [...this.layers].reverse()) this.close(l.id, false);
  }

  /** Simple confirm dialog. */
  confirm(text: string, yes: string, no: string): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        this.close('confirm', false);
        resolve(v);
      };
      const yesBtn = h('button', { class: 'btn primary', type: 'button' }, yes);
      const noBtn = h('button', { class: 'btn', type: 'button' }, no);
      yesBtn.addEventListener('click', () => finish(true));
      noBtn.addEventListener('click', () => finish(false));
      const body = h(
        'div',
        { class: 'column' },
        h('p', { style: 'margin:0;font-size:1.05rem' }, text),
        h('div', { class: 'row' }, noBtn, yesBtn),
      );
      this.show('confirm', body, {
        kind: 'dialog',
        onBack: () => {
          finish(false);
          return true;
        },
        onClose: () => finish(false),
      });
    });
  }
}
