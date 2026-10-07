/**
 * Drag snapping (GDD §3.4): exact rounded position when valid; otherwise the nearest valid
 * position within 1 cell, with hysteresis so the ghost does not flicker between two spots.
 */

export interface GridPos {
  x: number;
  y: number;
}

export const SNAP_RADIUS = 1.0;
export const HOLD_RADIUS = 0.75;
export const SWITCH_MARGIN = 0.25;

const dist = (fx: number, fy: number, p: GridPos) => Math.hypot(fx - p.x, fy - p.y);

/**
 * @param fx, fy  piece top-left in fractional board-cell units
 * @param valid   whether the piece can be placed at an integer position
 * @param prev    the currently shown ghost position (or null)
 */
export function snap(fx: number, fy: number, valid: (x: number, y: number) => boolean, prev: GridPos | null): GridPos | null {
  const rx = Math.round(fx);
  const ry = Math.round(fy);
  if (valid(rx, ry)) return { x: rx, y: ry };

  let best: GridPos | null = null;
  let bestD = Infinity;
  for (let y = Math.floor(fy) - 1; y <= Math.ceil(fy) + 1; y++) {
    for (let x = Math.floor(fx) - 1; x <= Math.ceil(fx) + 1; x++) {
      const d = Math.hypot(fx - x, fy - y);
      if (d > SNAP_RADIUS || d >= bestD) continue;
      if (!valid(x, y)) continue;
      best = { x, y };
      bestD = d;
    }
  }
  if (prev && valid(prev.x, prev.y)) {
    const dp = dist(fx, fy, prev);
    if (dp <= HOLD_RADIUS && !(best && bestD <= dp - SWITCH_MARGIN)) return prev;
  }
  return best;
}
