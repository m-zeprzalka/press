/**
 * Icon kit: shared palette, geometry helpers and the two-layer risograph renderer
 * used by every PRESS icon (GDD §14). All artwork is original and authored in code.
 *
 * An icon is printed in two "inks" on a 48×48 grid:
 *   1. the spot-colour layer (flat fills, optional halftone), shifted by MISREG
 *      to fake an imperfect register, and
 *   2. the ink line layer (#231F20, 3.25 strokes, round joins) on top.
 *
 * Pattern / gradient ids are namespaced per call (`uid`) so any number of icons
 * can be inlined in one document without id clashes.
 */
import { BLIND_FACE, INK, INKS, INKS_DARK, JAM_DARK, LEAD_GREY, PAPER, PAPER_SHADE, hex } from '../../theme';

/** Renders an icon. `uid` namespaces internal ids; omitted → a fresh one per call. */
export type IconFn = (uid?: string) => string;

export const C = {
  ink: hex(INK),
  paper: hex(PAPER),
  paperShade: hex(PAPER_SHADE),
  white: hex(BLIND_FACE),
  lead: hex(LEAD_GREY),
  jam: hex(JAM_DARK),
  pink: hex(INKS[0]),
  orange: hex(INKS[1]),
  yellow: hex(INKS[2]),
  teal: hex(INKS[3]),
  blue: hex(INKS[4]),
  pinkDark: hex(INKS_DARK[0]),
  orangeDark: hex(INKS_DARK[1]),
  yellowDark: hex(INKS_DARK[2]),
  tealDark: hex(INKS_DARK[3]),
  blueDark: hex(INKS_DARK[4]),
} as const;

/** Spot colours indexed like core `Ink` (0 pink … 4 blue). */
export const SPOT = [C.pink, C.orange, C.yellow, C.teal, C.blue] as const;
export const SPOT_DARK = [C.pinkDark, C.orangeDark, C.yellowDark, C.tealDark, C.blueDark] as const;

/** Misregistration of the colour layer against the ink layer (viewBox units). */
export const MISREG = 1.5;
/** Default ink stroke on the 48 grid. */
export const STROKE = 3.25;

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

let seq = 0;

/** A document-safe id fragment: caller's uid sanitised, or a fresh counter value. */
export function safeUid(uid?: string): string {
  if (uid === undefined || uid === '') {
    seq = (seq + 1) % 0x7fffffff;
    return `i${seq.toString(36)}`;
  }
  const s = uid.replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[A-Za-z_]/.test(s) ? s : `i${s}`;
}

// ---------------------------------------------------------------------------
// Geometry (returns SVG path data; numbers rounded to 2 decimals)
// ---------------------------------------------------------------------------

export type Pt = readonly [number, number];

export const n = (v: number): number => Math.round(v * 100) / 100;
const pt = (p: Pt): string => `${n(p[0])} ${n(p[1])}`;

/** Closed polygon. */
export function poly(pts: readonly Pt[]): string {
  return `M${pts.map(pt).join('L')}Z`;
}

/** Open polyline. */
export function polyline(pts: readonly Pt[]): string {
  return `M${pts.map(pt).join('L')}`;
}

/** Rounded rectangle. */
export function rr(x: number, y: number, w: number, h: number, r = 0): string {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  if (q === 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return (
    `M${n(x + q)} ${n(y)}H${n(x + w - q)}A${n(q)} ${n(q)} 0 0 1 ${n(x + w)} ${n(y + q)}` +
    `V${n(y + h - q)}A${n(q)} ${n(q)} 0 0 1 ${n(x + w - q)} ${n(y + h)}` +
    `H${n(x + q)}A${n(q)} ${n(q)} 0 0 1 ${n(x)} ${n(y + h - q)}` +
    `V${n(y + q)}A${n(q)} ${n(q)} 0 0 1 ${n(x + q)} ${n(y)}Z`
  );
}

/** Full circle as a path (so it can share helpers with other shapes). */
export function circ(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

/** Ellipse as a path. */
export function ell(cx: number, cy: number, rx: number, ry: number): string {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
}

/** Point on a circle; angle in degrees, 0 = east, clockwise (SVG y-down). */
export function polar(cx: number, cy: number, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** Circular arc from angle a0 to a1 (degrees, clockwise when a1 > a0). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${pt(p0)}A${n(r)} ${n(r)} 0 ${large} ${sweep} ${pt(p1)}`;
}

/** Ink drop: tip at (cx, top), round belly of radius r centred at (cx, cy). */
export function drop(cx: number, top: number, cy: number, r: number): string {
  const d = cy - top;
  return (
    `M${n(cx)} ${n(top)}C${n(cx + r * 0.3)} ${n(top + d * 0.32)} ${n(cx + r)} ${n(cy - r * 0.62)} ${n(cx + r)} ${n(cy)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(cx - r)} ${n(cy)}` +
    `C${n(cx - r)} ${n(cy - r * 0.62)} ${n(cx - r * 0.3)} ${n(top + d * 0.32)} ${n(cx)} ${n(top)}Z`
  );
}

/** Stadium (rounded bar) from a to b with radius r. */
export function capsule(a: Pt, b: Pt, r: number): string {
  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const a1 = polar(a[0], a[1], r, ang - 90);
  const a2 = polar(a[0], a[1], r, ang + 90);
  const b1 = polar(b[0], b[1], r, ang - 90);
  const b2 = polar(b[0], b[1], r, ang + 90);
  return `M${pt(a1)}L${pt(b1)}A${n(r)} ${n(r)} 0 0 1 ${pt(b2)}L${pt(a2)}A${n(r)} ${n(r)} 0 0 1 ${pt(a1)}Z`;
}

/** Regular star with `k` points (first point straight up). */
export function star(cx: number, cy: number, ro: number, ri: number, k = 5, rot = -90): string {
  const pts: Pt[] = [];
  for (let i = 0; i < 2 * k; i++) pts.push(polar(cx, cy, i % 2 === 0 ? ro : ri, rot + (i * 180) / k));
  return poly(pts);
}

/** Four-point sparkle with concave sides. */
export function sparkle(cx: number, cy: number, r: number, waist = 0.18): string {
  const w = r * waist;
  return (
    `M${n(cx)} ${n(cy - r)}Q${n(cx + w)} ${n(cy - w)} ${n(cx + r)} ${n(cy)}` +
    `Q${n(cx + w)} ${n(cy + w)} ${n(cx)} ${n(cy + r)}Q${n(cx - w)} ${n(cy + w)} ${n(cx - r)} ${n(cy)}` +
    `Q${n(cx - w)} ${n(cy - w)} ${n(cx)} ${n(cy - r)}Z`
  );
}

/** Gear outline: `teeth` trapezoid teeth between radii ri (root) and ro (tip). */
export function gear(cx: number, cy: number, ro: number, ri: number, teeth: number): string {
  const step = 360 / teeth;
  const pts: Pt[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - 90;
    pts.push(polar(cx, cy, ri, a - step * 0.3));
    pts.push(polar(cx, cy, ro, a - step * 0.17));
    pts.push(polar(cx, cy, ro, a + step * 0.17));
    pts.push(polar(cx, cy, ri, a + step * 0.3));
  }
  return poly(pts);
}

/** Arrow head (filled triangle) at `tip`, pointing along `deg`. */
export function arrowHead(tip: Pt, deg: number, len = 7, half = 5): string {
  const back = polar(tip[0], tip[1], len, deg + 180);
  const l = polar(back[0], back[1], half, deg - 90);
  const r = polar(back[0], back[1], half, deg + 90);
  return poly([tip, l, r]);
}

// ---------------------------------------------------------------------------
// Paint servers
// ---------------------------------------------------------------------------

export interface HalftoneOpts {
  /** Cell size (period) in viewBox units. */
  size?: number;
  /** Dot radius. */
  r?: number;
  /** Screen angle in degrees (GDD §14.2: rational tangents; 45° default). */
  angle?: number;
  /** Optional solid background under the dots. */
  bg?: string;
}

/** Halftone dot screen as a userSpace <pattern>. */
export function halftone(id: string, color: string, o: HalftoneOpts = {}): string {
  const s = o.size ?? 3;
  const r = o.r ?? 0.9;
  const a = o.angle ?? 45;
  const bg = o.bg ? `<rect width="${n(s)}" height="${n(s)}" fill="${o.bg}"/>` : '';
  return (
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(s)}" height="${n(s)}" patternTransform="rotate(${a})">` +
    `${bg}<circle cx="${n(s / 2)}" cy="${n(s / 2)}" r="${n(r)}" fill="${color}"/></pattern>`
  );
}

// ---------------------------------------------------------------------------
// Layers and rendering
// ---------------------------------------------------------------------------

/** A two-layer print. Markup strings; ink defaults are inherited from the layer group. */
export interface Art {
  defs?: string;
  /** Spot-colour layer, drawn first and shifted by MISREG. */
  fill?: string;
  /** Ink layer: stroke ink 3.25, fill none, round caps and joins (override per element). */
  ink: string;
  /** Optional extra colour layer drawn above the ink, unshifted (highlights). */
  over?: string;
  /** Knock-out stroke cut through both layers (transparent gap), e.g. under an "off" slash. */
  knockout?: { d: string; width: number };
  /** Ink line work drawn after the knock-out (not cut by it). */
  top?: string;
  /** Optical offset of the whole composition (viewBox units). */
  offset?: Pt;
}

/** Small fluent builder so one geometry string feeds both layers. */
export class Print {
  readonly defs: string[] = [];
  readonly f: string[] = [];
  readonly k: string[] = [];
  readonly o: string[] = [];
  readonly t: string[] = [];
  knock: { d: string; width: number } | undefined;
  offset: Pt = [0, 0];

  /** Same shape on both plates: colour fill (shifted) + ink outline. */
  shape(d: string, color: string, inkAttrs = ''): this {
    this.f.push(`<path d="${d}" fill="${color}"/>`);
    this.k.push(`<path d="${d}"${inkAttrs ? ' ' + inkAttrs : ''}/>`);
    return this;
  }

  /** Colour plate only. */
  fill(d: string, color: string, attrs = ''): this {
    this.f.push(`<path d="${d}" fill="${color}"${attrs ? ' ' + attrs : ''}/>`);
    return this;
  }

  /** Ink plate line work. */
  line(d: string, attrs = ''): this {
    this.k.push(`<path d="${d}"${attrs ? ' ' + attrs : ''}/>`);
    return this;
  }

  /** Solid ink area (no outline growth unless `grow` > 0). */
  solid(d: string, grow = 0): this {
    this.k.push(
      grow > 0
        ? `<path d="${d}" fill="${C.ink}" stroke-width="${n(grow)}"/>`
        : `<path d="${d}" fill="${C.ink}" stroke="none"/>`,
    );
    return this;
  }

  /** Ink dot. */
  dot(cx: number, cy: number, r: number): this {
    this.k.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${C.ink}" stroke="none"/>`);
    return this;
  }

  /** Unshifted layer above the ink. */
  over(markup: string): this {
    this.o.push(markup);
    return this;
  }

  raw(layer: 'f' | 'k' | 'defs', markup: string): this {
    this[layer].push(markup);
    return this;
  }

  /** Cuts a transparent gap (stroke of `width` along `d`) through everything drawn so far, then inks `d`. */
  cut(d: string, width = 8.5): this {
    this.knock = { d, width };
    this.t.push(`<path d="${d}"/>`);
    return this;
  }

  /** Moves the whole composition for optical centring. */
  shift(dx: number, dy: number): this {
    this.offset = [dx, dy];
    return this;
  }

  art(): Art {
    const a: Art = { ink: this.k.join('') };
    if (this.defs.length) a.defs = this.defs.join('');
    if (this.f.length) a.fill = this.f.join('');
    if (this.o.length) a.over = this.o.join('');
    if (this.knock) a.knockout = this.knock;
    if (this.t.length) a.top = this.t.join('');
    if (this.offset[0] !== 0 || this.offset[1] !== 0) a.offset = this.offset;
    return a;
  }
}

const INK_ATTRS = `fill="none" stroke="${C.ink}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;

/** Assembles the final 48×48 SVG markup. `maskId` is required when the art has a knock-out. */
export function renderArt(a: Art, size = 48, maskId = 'ko'): string {
  let defs = a.defs ?? '';
  let maskAttr = '';
  if (a.knockout) {
    defs +=
      `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="-2" y="-2" width="52" height="52">` +
      `<rect x="-2" y="-2" width="52" height="52" fill="#fff"/>` +
      `<path d="${a.knockout.d}" fill="none" stroke="#000" stroke-width="${a.knockout.width}" stroke-linecap="round"/></mask>`;
    maskAttr = ` mask="url(#${maskId})"`;
  }
  const [dx, dy] = a.offset ?? [0, 0];
  const fill = a.fill ? `<g transform="translate(${MISREG} ${MISREG})" stroke="none">${a.fill}</g>` : '';
  const over = a.over ? `<g stroke="none">${a.over}</g>` : '';
  const top = a.top ? `<g ${INK_ATTRS}>${a.top}</g>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `${defs ? `<defs>${defs}</defs>` : ''}<g transform="translate(${n(dx - 0.5)} ${n(dy - 0.5)})">` +
    `<g${maskAttr}>${fill}<g ${INK_ATTRS}>${a.ink}</g>${over}</g>${top}</g></svg>`
  );
}

/**
 * Defines an icon. `draw` receives `id(name)` for namespaced pattern / gradient ids.
 * `prefix` keeps ids readable and distinct between icon kinds.
 */
export function defineIcon(prefix: string, draw: (p: Print, id: (name: string) => string) => void): IconFn {
  return (uid?: string) => {
    const u = safeUid(uid);
    const p = new Print();
    const id = (name: string): string => `${prefix}-${u}-${name}`;
    draw(p, id);
    return renderArt(p.art(), 48, id('ko'));
  };
}

/** `data:` URI for <img src>, CSS backgrounds or Pixi texture loading. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
