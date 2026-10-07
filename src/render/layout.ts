/**
 * Pure layout of the gameplay screen (GDD §12.1, §17). All values in CSS px (= dp in WebView).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GameLayout {
  width: number;
  height: number;
  landscape: boolean;
  /** Compaction tier 0 (roomy) … 4 (tiny). */
  tier: number;
  header: Rect;
  quota: Rect;
  /** Sheets + streak row (merged into the quota row from tier 1). */
  status: Rect | null;
  rack: Rect;
  rackCompact: boolean;
  counter: Rect;
  board: Rect;
  cell: number;
  tray: Rect;
  traySlots: Rect[];
  reserve: Rect | null;
  /** Size of a cell inside the tray previews (same for all pieces). */
  trayCell: number;
  /** Region a dragged piece may occupy (board + space above + tray). */
  dragEnvelope: Rect;
  tooSmall: boolean;
}

export const BANDS = {
  header: 44,
  quota: 36,
  status: 32,
  rack: 64,
  rackCompact: 56,
  rackStrip: 40,
  counter: 48,
  tray: 104,
  gap: 6,
  pad: 8,
  side: 16,
  edgeGuard: 24,
  minCell: 34,
  maxCell: 64,
} as const;

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export interface LayoutInput {
  width: number;
  height: number;
  insets: Insets;
  hasReserve: boolean;
}

export function computeLayout(inp: LayoutInput): GameLayout {
  const { width, height, insets } = inp;
  const usableW = width - insets.left - insets.right;
  const usableH = height - insets.top - insets.bottom;
  const tooSmall = usableW < 300 || usableH < 500;
  const landscape = (usableW > usableH && usableH < 560) || usableW >= 840;
  return landscape
    ? landscapeLayout(inp, usableW, usableH, tooSmall)
    : portraitLayout(inp, usableW, usableH, tooSmall);
}

function traySlotsFor(
  tray: Rect,
  hasReserve: boolean,
  screenW: number,
  insets: Insets,
): { slots: Rect[]; reserve: Rect | null; trayCell: number } {
  // Keep slots out of the system back-gesture zones at the screen edges.
  const left = Math.max(tray.x, insets.left + BANDS.edgeGuard);
  const right = Math.min(tray.x + tray.w, screenW - insets.right - BANDS.edgeGuard);
  let x = left;
  let reserve: Rect | null = null;
  const reserveW = 64;
  if (hasReserve) {
    reserve = rect(x, tray.y + 8, reserveW, tray.h - 16);
    x += reserveW + 8;
  }
  const avail = right - x;
  const slotW = Math.floor(avail / 3);
  const slots = [0, 1, 2].map((i) => rect(x + i * slotW, tray.y, slotW, tray.h));
  const inner = Math.min(slotW, tray.h) - 12;
  const trayCell = Math.max(10, Math.min(22, Math.floor(inner / 5)));
  return { slots, reserve, trayCell };
}

function portraitLayout(inp: LayoutInput, usableW: number, usableH: number, tooSmall: boolean): GameLayout {
  const { insets, width, height } = inp;
  const maxColumn = Math.min(usableW, 520);
  const x0 = insets.left + (usableW - maxColumn) / 2;
  const colW = maxColumn - 2 * BANDS.side;
  const colX = x0 + BANDS.side;

  const rackFor = (tier: number) =>
    tier >= 4 ? BANDS.rackStrip : tier >= 2 ? BANDS.rackCompact : BANDS.rack;
  const fixedFor = (tier: number) => {
    const status = tier >= 1 ? 0 : BANDS.status + BANDS.gap;
    return (
      BANDS.pad * 2 +
      BANDS.header +
      BANDS.quota +
      status +
      rackFor(tier) +
      BANDS.counter +
      BANDS.tray +
      BANDS.gap * 5
    );
  };
  const boardFor = (t: number) => Math.min(colW, usableH - fixedFor(t));
  // Keep the full status row (sheets + streak) while the board still gets 36 px cells: most
  // phones lose ~70 dp to system bars, and the compact HUD is a last resort.
  let tier = Math.floor(boardFor(0) / 8) >= 36 ? 0 : 1;
  if (tier === 1 && Math.floor(boardFor(1) / 8) < 38) tier = 2;
  if (tier === 2 && Math.floor(boardFor(2) / 8) < BANDS.minCell) tier = 3;
  if (usableH < 580) tier = 4;
  const minCell = tier >= 4 ? 30 : BANDS.minCell;
  const cell = Math.max(minCell, Math.min(BANDS.maxCell, Math.floor(boardFor(tier) / 8)));
  const boardSize = cell * 8;
  const rackH = rackFor(tier);

  let y = insets.top + BANDS.pad;
  const header = rect(colX, y, colW, BANDS.header);
  y += BANDS.header + BANDS.gap;
  const quota = rect(colX, y, colW, BANDS.quota);
  y += BANDS.quota + BANDS.gap;
  let status: Rect | null = null;
  if (tier === 0) {
    status = rect(colX, y, colW, BANDS.status);
    y += BANDS.status + BANDS.gap;
  }
  const rack = rect(colX, y, colW, rackH);
  y += rackH + BANDS.gap;
  const counter = rect(colX, y, colW, BANDS.counter);
  y += BANDS.counter + BANDS.gap;

  // Spare vertical space is split so the board sits between the counter and the tray.
  const trayH = BANDS.tray;
  const bottom = insets.top + usableH - BANDS.pad;
  const spare = Math.max(0, bottom - trayH - BANDS.gap - y - boardSize);
  y += Math.floor(spare / 2);
  const board = rect(colX + (colW - boardSize) / 2, y, boardSize, boardSize);
  y += boardSize + BANDS.gap + Math.ceil(spare / 2);
  const tray = rect(colX, Math.min(y, bottom - trayH), colW, trayH);
  const { slots, reserve, trayCell } = traySlotsFor(tray, inp.hasReserve, width, insets);

  const dragEnvelope = rect(insets.left, rack.y, usableW, tray.y + tray.h - rack.y);
  return {
    width,
    height,
    landscape: false,
    tier,
    header,
    quota,
    status,
    rack,
    rackCompact: tier >= 2,
    counter,
    board,
    cell,
    tray,
    traySlots: slots,
    reserve,
    trayCell,
    dragEnvelope,
    tooSmall,
  };
}

function landscapeLayout(inp: LayoutInput, usableW: number, usableH: number, tooSmall: boolean): GameLayout {
  const { insets, width, height } = inp;
  const sideW = Math.max(280, Math.min(380, usableW * 0.38));
  const dragOffset = 64;
  const cell = Math.max(
    BANDS.minCell,
    Math.min(BANDS.maxCell, Math.floor((usableH - 2 * BANDS.pad - dragOffset) / 8)),
  );
  const boardSize = cell * 8;
  const boardAreaW = usableW - sideW - BANDS.side * 3;
  const board = rect(
    insets.left + BANDS.side + Math.max(0, (boardAreaW - boardSize) / 2),
    insets.top +
      BANDS.pad +
      dragOffset / 2 +
      Math.max(0, (usableH - 2 * BANDS.pad - dragOffset - boardSize) / 2),
    boardSize,
    boardSize,
  );
  const colX = insets.left + usableW - sideW - BANDS.side;
  const colW = sideW;
  let y = insets.top + BANDS.pad;
  const header = rect(colX, y, colW, BANDS.header);
  y += BANDS.header + BANDS.gap;
  const quota = rect(colX, y, colW, BANDS.quota);
  y += BANDS.quota + BANDS.gap;
  const status = rect(colX, y, colW, BANDS.status);
  y += BANDS.status + BANDS.gap;
  const rack = rect(colX, y, colW, BANDS.rackCompact);
  y += BANDS.rackCompact + BANDS.gap;
  const counter = rect(colX, y, colW, BANDS.counter);
  const tray = rect(colX, insets.top + usableH - BANDS.pad - BANDS.tray, colW, BANDS.tray);
  const { slots, reserve, trayCell } = traySlotsFor(tray, inp.hasReserve, width, insets);
  return {
    width,
    height,
    landscape: true,
    tier: 1,
    header,
    quota,
    status,
    rack,
    rackCompact: true,
    counter,
    board,
    cell,
    tray,
    traySlots: slots,
    reserve,
    trayCell,
    dragEnvelope: rect(insets.left, insets.top, usableW, usableH),
    tooSmall,
  };
}

/** Board cell under a point, or null. */
export function cellAt(layout: GameLayout, px: number, py: number): { x: number; y: number } | null {
  const { board, cell } = layout;
  const x = Math.floor((px - board.x) / cell);
  const y = Math.floor((py - board.y) / cell);
  if (x < 0 || y < 0 || x >= 8 || y >= 8) return null;
  return { x, y };
}

export function contains(r: Rect, px: number, py: number, pad = 0): boolean {
  return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
}
