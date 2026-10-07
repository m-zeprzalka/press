/**
 * Asset loading: the PRESS Display font, the baked riso texture atlas (public/textures),
 * SVG icon textures. Every lookup has a procedural canvas fallback so the game still renders
 * if a file is missing; canvas-backed textures survive WebGL context loss.
 */
import { Assets, CanvasSource, Spritesheet, Texture } from 'pixi.js';
import { FONT_DISPLAY, INK, INKS, INKS_DARK, LEAD_GREY, BLIND_FACE, JAM_DARK, PAPER, hex } from '../theme';

export class GameAssets {
  private sheet: Spritesheet | null = null;
  private fallbacks = new Map<string, Texture>();
  private svgCache = new Map<string, Texture>();
  paper: Texture = Texture.WHITE;

  constructor(private readonly base = './') {}

  async load(): Promise<void> {
    await Promise.all([this.loadFont(), this.loadAtlas(), this.loadPaper()]);
  }

  private async loadFont(): Promise<void> {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    try {
      const face = new FontFace(FONT_DISPLAY, `url(${this.base}fonts/press-display.otf)`, { display: 'block' });
      document.fonts.add(await face.load());
      await document.fonts.load(`48px "${FONT_DISPLAY}"`);
    } catch (e) {
      console.warn('PRESS Display failed to load; falling back to system font', e);
    }
  }

  private async loadAtlas(): Promise<void> {
    try {
      this.sheet = (await Assets.load(`${this.base}textures/atlas.json`)) as Spritesheet;
    } catch (e) {
      console.warn('Texture atlas missing; using procedural fallbacks', e);
      this.sheet = null;
    }
  }

  private async loadPaper(): Promise<void> {
    try {
      this.paper = (await Assets.load(`${this.base}textures/paper.png`)) as Texture;
      this.paper.source.addressMode = 'repeat';
    } catch {
      this.paper = this.canvasTexture('paper', 256, 256, (g, w, h) => {
        g.fillStyle = hex(PAPER);
        g.fillRect(0, 0, w, h);
      });
    }
  }

  has(name: string): boolean {
    return Boolean(this.sheet?.textures[name]);
  }

  /** Atlas frame or a procedural fallback. */
  tex(name: string): Texture {
    const t = this.sheet?.textures[name];
    if (t) return t;
    return this.fallback(name);
  }

  inkCell(ink: number, variant: number): Texture {
    return this.tex(`ink_${ink}_${variant & 3}`);
  }

  inkHighlight(ink: number): Texture {
    return this.tex(`ink_${ink}_hl`);
  }

  /** Rasterises an SVG string into a canvas-backed texture (cached by key). */
  async svg(key: string, svg: string, size: number, resolution = 2): Promise<Texture> {
    const cacheKey = `${key}@${size}x${resolution}`;
    const hit = this.svgCache.get(cacheKey);
    if (hit) return hit;
    const px = Math.ceil(size * resolution);
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = new Image();
      img.decoding = 'async';
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      try {
        await img.decode();
        ctx.drawImage(img, 0, 0, px, px);
      } catch {
        // Leave blank on decode failure.
      }
    }
    const tex = new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
    this.svgCache.set(cacheKey, tex);
    return tex;
  }

  // ------------------------------------------------------------------ fallbacks

  private canvasTexture(
    key: string,
    w: number,
    h: number,
    draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  ): Texture {
    const hit = this.fallbacks.get(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (g) draw(g, w, h);
    const tex = new Texture({ source: new CanvasSource({ resource: canvas }) });
    this.fallbacks.set(key, tex);
    return tex;
  }

  private fallback(name: string): Texture {
    const cell = 128;
    const ink = /^ink_(\d)_(\d|hl)$/.exec(name);
    if (ink) {
      const k = Number(ink[1]);
      const hl = ink[2] === 'hl';
      return this.canvasTexture(name, cell, cell, (g, w, h) => {
        g.fillStyle = hex(INKS_DARK[k] ?? INK);
        g.fillRect(9, 9, w - 14, h - 14);
        g.fillStyle = hex(INKS[k] ?? INK);
        g.globalAlpha = hl ? 0.75 : 1;
        g.fillRect(6, 6, w - 14, h - 14);
        g.globalAlpha = 0.6;
        g.strokeStyle = hex(INK);
        g.lineWidth = 5;
        g.strokeRect(6, 6, w - 14, h - 14);
      });
    }
    if (name.startsWith('blind')) {
      return this.canvasTexture(name, cell, cell, (g, w, h) => {
        g.fillStyle = hex(BLIND_FACE);
        g.fillRect(6, 6, w - 12, h - 12);
        g.strokeStyle = 'rgba(35,31,32,0.45)';
        g.lineWidth = 6;
        g.strokeRect(6, 6, w - 12, h - 12);
        g.beginPath();
        g.moveTo(w * 0.3, h * 0.3);
        g.lineTo(w * 0.7, h * 0.7);
        g.moveTo(w * 0.7, h * 0.3);
        g.lineTo(w * 0.3, h * 0.7);
        g.stroke();
      });
    }
    if (name.startsWith('lead')) {
      return this.canvasTexture(name, cell, cell, (g, w, h) => {
        g.fillStyle = hex(LEAD_GREY);
        g.fillRect(6, 6, w - 12, h - 12);
        g.strokeStyle = 'rgba(35,31,32,0.5)';
        g.lineWidth = 3;
        for (let y = 20; y < h - 10; y += 14) {
          g.beginPath();
          g.moveTo(12, y);
          g.lineTo(w - 12, y);
          g.stroke();
        }
      });
    }
    if (name === 'jam') {
      return this.canvasTexture(name, cell, cell, (g, w, h) => {
        g.fillStyle = hex(JAM_DARK);
        g.fillRect(6, 6, w - 12, h - 12);
        g.fillStyle = '#8d8a86';
        g.beginPath();
        g.arc(w / 2, h / 2, w * 0.22, 0, Math.PI * 2);
        g.fill();
      });
    }
    if (name.startsWith('sym_')) {
      const k = Number(name.slice(4));
      return this.canvasTexture(name, 56, 56, (g, w, h) => {
        g.fillStyle = '#fff';
        g.beginPath();
        const c = w / 2;
        const r = w * 0.38;
        if (k === 0) g.arc(c, c, r, 0, Math.PI * 2);
        else if (k === 1) {
          g.moveTo(c, c - r);
          g.lineTo(c + r, c + r * 0.8);
          g.lineTo(c - r, c + r * 0.8);
        } else if (k === 2) g.rect(c - r * 0.85, c - r * 0.85, r * 1.7, r * 1.7);
        else if (k === 3) {
          g.moveTo(c, c - r);
          g.lineTo(c + r, c);
          g.lineTo(c, c + r);
          g.lineTo(c - r, c);
        } else {
          g.rect(c - r * 0.3, c - r, r * 0.6, r * 2);
          g.rect(c - r, c - r * 0.3, r * 2, r * 0.6);
        }
        g.fill();
        void h;
      });
    }
    if (name.startsWith('drop') || name.startsWith('splat') || name === 'glow_soft') {
      const size = name.startsWith('splat') ? 192 : 64;
      return this.canvasTexture(name, size, size, (g, w) => {
        const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(name === 'glow_soft' ? 1 : 0.7, name === 'glow_soft' ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, w);
      });
    }
    if (name.startsWith('fleck')) {
      return this.canvasTexture(name, 32, 32, (g) => {
        g.fillStyle = hex(PAPER);
        g.beginPath();
        g.moveTo(4, 8);
        g.lineTo(28, 4);
        g.lineTo(24, 28);
        g.lineTo(6, 24);
        g.fill();
      });
    }
    if (name === 'platen') {
      return this.canvasTexture(name, 512, 48, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#5a5456');
        grad.addColorStop(0.5, '#2a2526');
        grad.addColorStop(1, '#111');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      });
    }
    if (name === 'stamp_ring') {
      return this.canvasTexture(name, 512, 192, (g, w, h) => {
        g.strokeStyle = '#fff';
        g.lineWidth = 12;
        g.strokeRect(10, 10, w - 20, h - 20);
        g.lineWidth = 4;
        g.strokeRect(28, 28, w - 56, h - 56);
      });
    }
    if (name === 'ring_burst') {
      return this.canvasTexture(name, 256, 256, (g, w) => {
        g.strokeStyle = '#fff';
        g.lineWidth = 10;
        g.beginPath();
        g.arc(w / 2, w / 2, w / 2 - 8, 0, Math.PI * 2);
        g.stroke();
      });
    }
    return this.canvasTexture(name, 8, 8, (g, w, h) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
    });
  }
}
