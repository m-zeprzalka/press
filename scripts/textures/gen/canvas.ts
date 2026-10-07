/// <reference lib="dom" />
/**
 * Canvas 2D helpers for the in-page generator (paths that are awkward analytically, e.g. dashes).
 */
import { Field } from './raster';

export function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('Canvas 2D unavailable');
  return { c, g };
}

/** Draw white shapes with `draw` and return their coverage (alpha) as a field. */
export function canvasMask(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Field {
  const { g } = canvas(w, h);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  draw(g);
  const px = g.getImageData(0, 0, w, h).data;
  const f = new Field(w, h);
  for (let i = 0; i < w * h; i++) f.v[i] = px[i * 4 + 3]! / 255;
  return f;
}

export function roundRectPath(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): void {
  g.beginPath();
  g.roundRect(x0, y0, x1 - x0, y1 - y0, r);
}
