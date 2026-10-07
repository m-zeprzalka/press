import { describe, expect, it } from 'vitest';
import { BANDS, cellAt, computeLayout, contains } from './layout';

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('layout', () => {
  it('fits a 360x800 phone with gesture insets without overlap', () => {
    const l = computeLayout({
      width: 360,
      height: 800,
      insets: { top: 32, right: 0, bottom: 24, left: 0 },
      hasReserve: false,
    });
    expect(l.landscape).toBe(false);
    expect(l.tier).toBe(0);
    expect(l.cell).toBeGreaterThanOrEqual(38);
    expect(l.board.w).toBe(l.cell * 8);
    // Bands are stacked top to bottom without overlap.
    const order = [l.header, l.quota, l.status!, l.rack, l.counter, l.board, l.tray];
    for (let i = 1; i < order.length; i++)
      expect(order[i]!.y).toBeGreaterThanOrEqual(order[i - 1]!.y + order[i - 1]!.h);
    expect(l.tray.y + l.tray.h).toBeLessThanOrEqual(800 - 24);
    expect(l.traySlots).toHaveLength(3);
    // Tray slots stay out of the edge gesture zones.
    expect(l.traySlots[0]!.x).toBeGreaterThanOrEqual(BANDS.edgeGuard);
    expect(l.traySlots[2]!.x + l.traySlots[2]!.w).toBeLessThanOrEqual(360 - BANDS.edgeGuard);
    // The I5 preview fits in a slot.
    expect(l.trayCell * 5).toBeLessThanOrEqual(l.traySlots[0]!.w);
  });

  it('compacts on short screens', () => {
    const l = computeLayout({ width: 360, height: 640, insets: noInsets, hasReserve: true });
    expect(l.tier).toBeGreaterThanOrEqual(1);
    expect(l.status).toBeNull();
    expect(l.reserve).not.toBeNull();
    expect(l.cell).toBeGreaterThanOrEqual(BANDS.minCell);
    expect(l.tray.y + l.tray.h).toBeLessThanOrEqual(640);
  });

  it('switches to landscape on wide windows', () => {
    const l = computeLayout({ width: 1280, height: 800, insets: noInsets, hasReserve: false });
    expect(l.landscape).toBe(true);
    expect(l.cell).toBeLessThanOrEqual(BANDS.maxCell);
    expect(l.board.x + l.board.w).toBeLessThan(l.rack.x);
  });

  it('caps the column width on tablets in portrait', () => {
    const l = computeLayout({ width: 800, height: 1280, insets: noInsets, hasReserve: false });
    expect(l.landscape).toBe(false);
    expect(l.board.w).toBeLessThanOrEqual(520);
    expect(l.cell).toBeLessThanOrEqual(BANDS.maxCell);
  });

  it('flags tiny windows', () => {
    expect(computeLayout({ width: 280, height: 400, insets: noInsets, hasReserve: false }).tooSmall).toBe(
      true,
    );
  });

  it('cellAt / contains', () => {
    const l = computeLayout({ width: 360, height: 800, insets: noInsets, hasReserve: false });
    expect(cellAt(l, l.board.x + 1, l.board.y + 1)).toEqual({ x: 0, y: 0 });
    expect(cellAt(l, l.board.x + l.board.w - 1, l.board.y + l.board.h - 1)).toEqual({ x: 7, y: 7 });
    expect(cellAt(l, l.board.x - 1, l.board.y)).toBeNull();
    expect(contains(l.board, l.board.x - 3, l.board.y, 4)).toBe(true);
    expect(contains(l.board, l.board.x - 5, l.board.y, 4)).toBe(false);
  });
});
