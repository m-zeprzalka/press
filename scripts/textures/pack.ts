/**
 * Deterministic MaxRects packer (best-short-side-fit, no rotation) for the texture atlas.
 * Pure: same input → same layout.
 */

export interface PackItem {
  name: string;
  w: number;
  h: number;
}

export interface Placement {
  name: string;
  /** Top-left of the frame content (the extruded border sits around it). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackResult {
  width: number;
  height: number;
  placements: Placement[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function contains(a: Rect, b: Rect): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

function tryPack(items: PackItem[], pad: number, width: number, height: number): Placement[] | null {
  let free: Rect[] = [{ x: 0, y: 0, w: width, h: height }];
  const placed: Placement[] = [];
  for (const it of items) {
    const w = it.w + 2 * pad;
    const h = it.h + 2 * pad;
    let best: Rect | null = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    for (const f of free) {
      if (w > f.w || h > f.h) continue;
      const short = Math.min(f.w - w, f.h - h);
      const long = Math.max(f.w - w, f.h - h);
      const better =
        short < bestShort ||
        (short === bestShort && long < bestLong) ||
        (short === bestShort &&
          long === bestLong &&
          best !== null &&
          (f.y < best.y || (f.y === best.y && f.x < best.x)));
      if (better) {
        best = { x: f.x, y: f.y, w, h };
        bestShort = short;
        bestLong = long;
      }
    }
    if (!best) return null;
    placed.push({ name: it.name, x: best.x + pad, y: best.y + pad, w: it.w, h: it.h });
    const used = best;
    const next: Rect[] = [];
    for (const f of free) {
      const disjoint =
        used.x >= f.x + f.w || used.x + used.w <= f.x || used.y >= f.y + f.h || used.y + used.h <= f.y;
      if (disjoint) {
        next.push(f);
        continue;
      }
      if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w) {
        next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
      }
      if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h) {
        next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
      }
    }
    free = next.filter(
      (r, i) => !next.some((o, j) => j !== i && contains(o, r) && (!contains(r, o) || j < i)),
    );
  }
  return placed;
}

/**
 * Packs items into the smallest power-of-two page (≤ maxSize²) that holds them, with `pad` pixels
 * of extrusion space around each item.
 */
export function packAtlas(items: PackItem[], pad: number, maxSize: number): PackResult {
  const order = [...items].sort(
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || (a.name < b.name ? -1 : 1),
  );
  const sizes: [number, number][] = [];
  for (let w = 256; w <= maxSize; w *= 2) {
    for (let h = w / 2; h <= w; h *= 2) sizes.push([w, h]);
  }
  sizes.sort((a, b) => a[0] * a[1] - b[0] * b[1] || b[0] - a[0]);
  for (const [w, h] of sizes) {
    const placements = tryPack(order, pad, w, h);
    if (placements) {
      const byName = new Map(placements.map((p) => [p.name, p]));
      return { width: w, height: h, placements: items.map((it) => byName.get(it.name)!) };
    }
  }
  throw new Error(`Atlas frames do not fit into ${maxSize}×${maxSize}`);
}
