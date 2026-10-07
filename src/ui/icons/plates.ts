/**
 * Plate ("matryca") icons, one per MatrixId (GDD §8.2). Original artwork drawn in code.
 *
 *   PLATE_ICONS.roller('card-3')  → '<svg …>' (uid namespaces pattern ids)
 */
import type { MatrixId } from '../../core/matrices';
import {
  C,
  SPOT,
  SPOT_DARK,
  capsule,
  circ,
  defineIcon,
  drop,
  halftone,
  n,
  poly,
  polyline,
  rr,
  sparkle,
  star,
  type IconFn,
  type Print,
} from './kit';

// ---------------------------------------------------------------------------
// Colour-blind ink symbols (● ▲ ■ ◆ ✚, GDD §17), drawn as shapes
// ---------------------------------------------------------------------------

/** Symbol outline for ink k centred at (cx, cy), nominal size s. */
export function inkSymbolPath(k: number, cx: number, cy: number, s: number): string {
  switch (k) {
    case 0:
      return circ(cx, cy, s * 0.44);
    case 1:
      return poly([
        [cx, cy - s * 0.5],
        [cx + s * 0.52, cy + s * 0.4],
        [cx - s * 0.52, cy + s * 0.4],
      ]);
    case 2:
      return rr(cx - s * 0.38, cy - s * 0.38, s * 0.76, s * 0.76, s * 0.04);
    case 3:
      return poly([
        [cx, cy - s * 0.54],
        [cx + s * 0.54, cy],
        [cx, cy + s * 0.54],
        [cx - s * 0.54, cy],
      ]);
    default: {
      const a = s * 0.5;
      const t = s * 0.17;
      return poly([
        [cx - t, cy - a],
        [cx + t, cy - a],
        [cx + t, cy - t],
        [cx + a, cy - t],
        [cx + a, cy + t],
        [cx + t, cy + t],
        [cx + t, cy + a],
        [cx - t, cy + a],
        [cx - t, cy + t],
        [cx - a, cy + t],
        [cx - a, cy - t],
        [cx - t, cy - t],
      ]);
    }
  }
}

/** Embossed symbol: blind (paper-white) face, ink rim, dark shadow on the colour plate. */
function embossSymbol(p: Print, k: number, cx: number, cy: number, s: number): void {
  const d = inkSymbolPath(k, cx, cy, s);
  p.fill(d, SPOT_DARK[k] ?? C.ink, 'transform="translate(0.9 0.9)"');
  p.line(d, `fill="${C.white}" stroke-width="2.25"`);
}

// ---------------------------------------------------------------------------
// Ink drops
// ---------------------------------------------------------------------------

function inkDrop(k: number): IconFn {
  const color = SPOT[k] ?? C.pink;
  return defineIcon(`pl-ink${k}`, (p) => {
    p.shape(drop(24, 4.5, 28.5, 15), color);
    p.line('M14.5 26.5Q15 22 18 19', `stroke="${C.white}" stroke-width="2.25"`);
    embossSymbol(p, k, 24, 29, 15);
  });
}

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

const proof = defineIcon('pl-proof', (p) => {
  const block = rr(12, 12, 24, 24, 1);
  p.shape(block, C.pink);
  p.line(
    polyline([
      [15, 32],
      [21, 24.5],
      [25, 28.5],
      [28.5, 25],
      [33, 32],
    ]),
    'stroke-width="2.5"',
  );
  p.dot(29, 18, 2.6);
  // crop marks
  p.line('M4.5 12H8.5M12 4.5V8.5M39.5 12H43.5M36 4.5V8.5M4.5 36H8.5M12 39.5V43.5M39.5 36H43.5M36 39.5V43.5');
});

const guillotine = defineIcon('pl-guillotine', (p) => {
  p.shape(rr(12, 33, 24, 7.5, 1), C.paperShade);
  p.line('M12 37H36', 'stroke-width="2"');
  const blade = poly([
    [12, 10.5],
    [36, 10.5],
    [36, 17],
    [12, 27],
  ]);
  p.shape(blade, C.blue);
  p.line('M15 23.5L33 16', 'stroke-width="2"');
  p.line('M7.5 43.5V5.5H40.5V43.5');
});

const roller = defineIcon('pl-roller', (p) => {
  p.shift(2.2, 1);
  const handle = capsule([33.5, 21.5], [25.5, 8], 3.6);
  p.shape(handle, C.orange);
  p.line('M32 35H38.5V27.5L34.5 23.5');
  p.shape(rr(5, 29, 27, 12, 6), C.orange);
  p.line('M11 32.5H24', 'stroke-width="2"');
});

const margins = defineIcon('pl-margins', (p) => {
  const page = rr(9, 4.5, 30, 39, 2);
  const inner = rr(15.5, 11, 17, 26);
  p.fill(`${page}${inner}`, C.yellow, 'fill-rule="evenodd"');
  p.line(page);
  p.line(inner, 'stroke-width="1.75"');
  p.line('M19 16.5H29M19 21.5H29M19 26.5H29M19 31.5H25', 'stroke-width="2.25"');
});

const petit = defineIcon('pl-petit', (p) => {
  const body = rr(7, 7, 34, 34, 3);
  p.shape(body, C.teal);
  p.line('M8.5 8.5L14 14M39.5 8.5L34 14M8.5 39.5L14 34M39.5 39.5L34 34', 'stroke-width="2"');
  p.line(rr(13.5, 13.5, 21, 21, 1.5), `fill="${C.white}" stroke-width="2.5"`);
  p.line(
    'M19.6 19.6C20.6 18.5 22 18 23.4 18C26 18 27.6 19.4 27.6 22V30.4' +
      'M27.6 24.6H23.2C21 24.6 19.6 25.9 19.6 27.6C19.6 29.4 20.9 30.4 22.8 30.4C25 30.4 26.6 29.4 27.6 27.6',
    'stroke-width="2.75"',
  );
});

const poster = defineIcon('pl-poster', (p) => {
  p.line('M13 12L24 5L35 12', 'stroke-width="2.25"');
  p.shape(rr(10.5, 11, 27, 32.5, 1.5), C.orange);
  const counter = poly([
    [22.4, 30],
    [25.6, 30],
    [24, 23.5],
  ]);
  p.solid(
    poly([
      [21.3, 16],
      [26.7, 16],
      [33, 38.5],
      [27.6, 38.5],
      [26.5, 34.3],
      [21.5, 34.3],
      [20.4, 38.5],
      [15, 38.5],
    ]) + counter,
  );
  p.raw('k', `<path d="${counter}" fill="${C.orange}" stroke="none"/>`);
  p.dot(24, 5, 2.4);
});

/** One wrapped ream in 3/4 view: front (wrapper), top, and a side showing sheet edges. */
function reamBox(p: Print, x: number, y: number, w: number, h: number, dx: number, dy: number): void {
  const front = poly([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
  const top = poly([
    [x, y],
    [x + dx, y - dy],
    [x + w + dx, y - dy],
    [x + w, y],
  ]);
  const side = poly([
    [x + w, y],
    [x + w + dx, y - dy],
    [x + w + dx, y + h - dy],
    [x + w, y + h],
  ]);
  p.fill(top, C.white);
  p.fill(side, C.white);
  p.fill(front, C.blue);
  p.line(`${front}${top}${side}`, 'stroke-width="3"');
  p.line(
    `M${x + w + 1.6} ${y + h * 0.36}l${dx - 2.6} ${-(dy - 2.6) * 0.9}M${x + w + 1.6} ${y + h * 0.7}l${dx - 2.6} ${-(dy - 2.6) * 0.9}`,
    'stroke-width="1.5"',
  );
}

const ream = defineIcon('pl-ream', (p) => {
  p.shift(-0.5, -1.3);
  reamBox(p, 5, 30, 28, 12.5, 8, 6.5);
  reamBox(p, 8, 15.5, 28, 12.5, 8, 6.5);
  p.line('M5 36.25H33M8 21.75H36', 'stroke-width="1.5"');
});

function digit(d: number, cx: number, cy: number): string {
  switch (d) {
    case 1:
      return `M${n(cx - 1.6)} ${n(cy - 2.4)}L${n(cx + 0.6)} ${n(cy - 4)}V${n(cy + 4)}`;
    case 2:
      return (
        `M${n(cx - 2.3)} ${n(cy - 2)}C${n(cx - 2.3)} ${n(cy - 4.6)} ${n(cx + 2.4)} ${n(cy - 4.6)} ${n(cx + 2.4)} ${n(cy - 1.7)}` +
        `C${n(cx + 2.4)} ${n(cy)} ${n(cx - 2.4)} ${n(cy + 2.3)} ${n(cx - 2.4)} ${n(cy + 4)}H${n(cx + 2.6)}`
      );
    default:
      return (
        `M${n(cx - 2.3)} ${n(cy - 4)}H${n(cx + 2.3)}L${n(cx - 0.4)} ${n(cy - 0.6)}` +
        `C${n(cx + 3.3)} ${n(cy - 1)} ${n(cx + 3.3)} ${n(cy + 4)} ${n(cx)} ${n(cy + 4)}` +
        `C${n(cx - 1.2)} ${n(cy + 4)} ${n(cx - 2.2)} ${n(cy + 3.5)} ${n(cx - 2.6)} ${n(cy + 2.6)}`
      );
  }
}

const numerator = defineIcon('pl-numerator', (p) => {
  p.shape(rr(15, 4.5, 18, 5, 2.5), C.yellow);
  p.line('M24 9.5V14.5');
  p.shape(rr(7, 14.5, 34, 23.5, 3), C.yellow);
  p.line(rr(10.5, 19.5, 27, 13, 1.5), `fill="${C.white}" stroke-width="2.5"`);
  p.line('M19.5 19.5V32.5M28.5 19.5V32.5', 'stroke-width="1.75"');
  p.line(`${digit(1, 15.2, 26)}${digit(2, 24, 26)}${digit(3, 32.8, 26)}`, 'stroke-width="2.25"');
  p.line('M11 38V43.5M37 38V43.5M7 43.5H41');
});

const scrap = defineIcon('pl-scrap', (p, id) => {
  const ball = poly([
    [12, 14],
    [20, 8],
    [27, 10.5],
    [34, 7],
    [40.5, 15],
    [38, 22],
    [42, 30],
    [35, 39.5],
    [26, 37],
    [18, 42],
    [8.5, 34],
    [10, 24],
  ]);
  p.defs.push(halftone(id('ht'), C.pinkDark, { size: 3, r: 0.95 }));
  p.shape(ball, C.pink);
  p.fill(
    poly([
      [22, 22],
      [29, 22],
      [36, 27],
      [35, 39.5],
      [26, 37],
      [24, 30],
    ]),
    `url(#${id('ht')})`,
  );
  p.line(
    polyline([
      [15, 17],
      [22, 22],
      [20, 30],
    ]),
    'stroke-width="2.25"',
  );
  p.line(
    polyline([
      [27, 13.5],
      [29, 22],
      [36, 27],
    ]),
    'stroke-width="2.25"',
  );
  p.line(
    polyline([
      [22, 22],
      [29, 22],
    ]),
    'stroke-width="2.25"',
  );
  p.line(
    polyline([
      [24, 30],
      [26, 36.5],
    ]),
    'stroke-width="2.25"',
  );
});

const firstImpression = defineIcon('pl-first', (p) => {
  const sheet = 'M10 5H29.5L38 13.5V43H10Z';
  p.line(sheet, `fill="${C.white}"`);
  p.line('M29.5 5V13.5H38', `fill="${C.paperShade}"`);
  const one = poly([
    [18.8, 19.5],
    [25.5, 14.5],
    [29, 14.5],
    [29, 34.5],
    [32.5, 34.5],
    [32.5, 39],
    [18.5, 39],
    [18.5, 34.5],
    [23.5, 34.5],
    [23.5, 21.5],
    [18.8, 24],
  ]);
  p.shape(one, C.pink, 'stroke-width="2.5"');
});

const columnPress = defineIcon('pl-column', (p) => {
  for (const x of [9, 20.75, 32.5]) p.shape(rr(x, 12, 6.5, 24.5), C.blue);
  p.solid(rr(5, 5, 38, 7, 1.5), 3);
  p.solid(rr(5, 36.5, 38, 7, 1.5), 3);
});

const monotype = defineIcon('pl-monotype', (p) => {
  for (const y of [7, 19.5, 32]) {
    p.shape(rr(6, y, 36, 9, 1.5), C.teal);
    p.line(`M15 ${y}V${y + 9}M24 ${y}V${y + 9}M33 ${y}V${y + 9}`, 'stroke-width="2"');
  }
});

const journeyman = defineIcon('pl-journeyman', (p) => {
  p.line('M18.5 12C18.5 2.5 29.5 2.5 29.5 12', 'stroke-width="2.5"');
  p.line('M13 24L6 28.5M35 24L42 28.5', 'stroke-width="2.5"');
  const apron =
    'M17 11.5H31V19.5C31 21 32.5 22.5 35 22.5V41C35 42.5 34 43.5 32.5 43.5H15.5C14 43.5 13 42.5 13 41V22.5C15.5 22.5 17 21 17 19.5Z';
  p.shape(apron, C.orange);
  p.solid(rr(19.5, 25.5, 3.2, 7), 1);
  p.solid(rr(24.5, 24, 3.2, 8.5), 1);
  p.line(rr(17, 30.5, 14, 8, 1.5), `fill="${C.orange}" stroke-width="2.5"`);
});

const archive = defineIcon('pl-archive', (p) => {
  p.shape(rr(9, 4.5, 30, 39, 2), C.yellow);
  p.line('M9 24H39');
  for (const y of [9, 28.5]) {
    p.line(rr(18, y, 12, 6, 1), `fill="${C.white}" stroke-width="2.25"`);
    p.line(`M19.5 ${y + 10}H28.5`);
  }
});

const inkWell = defineIcon('pl-inkwell', (p) => {
  const bottle = 'M10 23Q10 16.5 17 16.5H31Q38 16.5 38 23V39.5Q38 43.5 34 43.5H14Q10 43.5 10 39.5Z';
  p.shape(bottle, C.blue);
  p.shape(rr(19, 11, 10, 5.5), C.blue);
  p.line(rr(16.5, 5.5, 15, 5.5, 1.5), `fill="${C.ink}"`);
  p.line(rr(15, 26, 18, 11, 1.5), `fill="${C.white}" stroke-width="2.25"`);
  p.solid(drop(24, 27.8, 32.4, 2.6));
  p.line('M13.5 22V24', `stroke="${C.white}" stroke-width="2"`);
});

const registration = defineIcon('pl-registration', (p) => {
  p.fill(circ(24, 24, 11.5), C.pink);
  p.fill(
    'M24 4.5V43.5M4.5 24H43.5',
    'none',
    `stroke="${C.blue}" stroke-width="3" transform="translate(-3 -3)"`,
  );
  p.line(circ(24, 24, 11.5));
  p.line('M24 4.5V43.5M4.5 24H43.5');
  p.line(circ(24, 24, 4.5), 'stroke-width="2.25"');
});

const crossmark = defineIcon('pl-crossmark', (p) => {
  const plus = poly([
    [19.5, 4.5],
    [28.5, 4.5],
    [28.5, 19.5],
    [43.5, 19.5],
    [43.5, 28.5],
    [28.5, 28.5],
    [28.5, 43.5],
    [19.5, 43.5],
    [19.5, 28.5],
    [4.5, 28.5],
    [4.5, 19.5],
    [19.5, 19.5],
  ]);
  p.shape(plus, C.teal);
  p.shape(star(24, 24, 11.5, 4.4, 4, -45), C.pink, 'stroke-width="2.5"');
  p.dot(24, 24, 1.8);
});

const typeCase = defineIcon('pl-typecase', (p, id) => {
  p.defs.push(halftone(id('ht'), C.orangeDark, { size: 3, r: 1, bg: C.orange }));
  p.shape(rr(5, 5.5, 38, 27.5, 2.5), C.orange);
  const w = 38 / 6;
  let grid = 'M5 13H43M5 22.5H43';
  for (let i = 1; i < 6; i++) grid += `M${n(5 + i * w)} 5.5V13`;
  grid += `M${n(5 + 2 * w)} 13V22.5M${n(5 + 4 * w)} 13V22.5M24 22.5V33`;
  p.line(grid, 'stroke-width="2"');
  p.solid(rr(8, 7.75, 3, 3), 1);
  p.solid(rr(20.7, 7.75, 3, 3), 1);
  p.solid(rr(37, 7.75, 3, 3), 1);
  p.solid(rr(22, 16.25, 3, 3), 1);
  p.shape('M5 33H43V40.5Q43 42.5 41 42.5H7Q5 42.5 5 40.5Z', `url(#${id('ht')})`);
  p.solid(rr(19, 36.25, 10, 2.75, 1.375), 1);
});

const cleanSheet = defineIcon('pl-clean', (p) => {
  p.line(rr(8, 8.5, 24, 34, 2), `fill="${C.white}"`);
  p.line('M13.5 22L19.5 16M13.5 29.5L24.5 18.5', 'stroke-width="2.25"');
  p.shape(sparkle(34.5, 13, 8.5), C.yellow, 'stroke-width="2.5"');
  p.shape(sparkle(39, 30, 5), C.yellow, 'stroke-width="2.25"');
});

const stencil = defineIcon('pl-stencil', (p) => {
  const board = rr(5, 6.5, 38, 35, 3);
  const left = poly([
    [20, 11],
    [23, 11],
    [23, 22.1],
    [21.04, 27],
    [25, 27],
    [25, 31.5],
    [19.22, 31.5],
    [17, 37],
    [9.5, 37],
  ]);
  const right = poly([
    [25, 11],
    [28, 11],
    [38.5, 37],
    [31, 37],
    [25, 22.1],
  ]);
  p.fill(`${board}${left}${right}`, C.teal, 'fill-rule="evenodd"');
  p.line(board);
  p.line(`${left}${right}`, 'stroke-width="2.25"');
});

const momentum = defineIcon('pl-momentum', (p) => {
  const cx = 28;
  const cy = 24;
  p.fill(`${circ(cx, cy, 14)}${circ(cx, cy, 8.5)}`, C.orange, 'fill-rule="evenodd"');
  p.line(circ(cx, cy, 14));
  p.line(circ(cx, cy, 8.5), 'stroke-width="2.25"');
  p.line(
    `M${cx - 6} ${cy - 6}L${cx + 6} ${cy + 6}M${cx + 6} ${cy - 6}L${cx - 6} ${cy + 6}`,
    'stroke-width="2.25"',
  );
  p.dot(cx, cy, 3.2);
  p.line('M4.5 15H10M4.5 24H8.5M4.5 33H10');
});

const conveyor = defineIcon('pl-conveyor', (p) => {
  p.shape(rr(5, 29, 38, 11.5, 5.75), C.teal);
  for (const x of [11, 24, 37]) {
    p.line(circ(x, 34.75, 2.6), `fill="${C.white}" stroke-width="2"`);
  }
  p.line(rr(8.5, 18.5, 12, 10.5, 1), `fill="${C.white}"`);
  p.line(rr(26, 14.5, 13, 14.5, 1), `fill="${C.white}"`);
  p.line('M6.5 10H17');
  p.solid(
    poly([
      [22, 10],
      [16.5, 6],
      [16.5, 14],
    ]),
    1.5,
  );
});

const gutenberg = defineIcon('pl-gutenberg', (p) => {
  const frame = 'M8 43.5V4.5H39.5V43.5H34V10.5H13.5V43.5Z';
  p.shape(frame, C.pink);
  p.line(rr(21, 10.5, 5.5, 12), `fill="${C.white}" stroke-width="2.25"`);
  p.line('M21 14.5L26.5 12.5M21 18.5L26.5 16.5', 'stroke-width="1.75"');
  p.line('M26.5 16.5L42.5 13.5');
  p.dot(43, 13.4, 2.6);
  p.solid(rr(15.5, 22.5, 16.5, 5, 1), 2);
  p.line(rr(4.5, 32.5, 39, 4.5, 1), `fill="${C.white}" stroke-width="2.5"`);
});

const hydraulic = defineIcon('pl-hydraulic', (p) => {
  p.shape(rr(13, 4.5, 22, 15, 2), C.blue);
  p.line('M13 9.5H35M13 14.5H35', 'stroke-width="2"');
  p.line(rr(20.5, 19.5, 7, 7), `fill="${C.white}"`);
  p.solid(rr(9, 26.5, 30, 5.5, 1.5), 2);
  p.shape(rr(13, 35.5, 22, 5.5, 1), C.blue);
  p.line('M5.5 43.5H42.5');
  p.line('M6.5 9V19M41.5 9V19', 'stroke-width="2.5"');
  p.solid(
    poly([
      [6.5, 23],
      [3.5, 18.5],
      [9.5, 18.5],
    ]),
    1,
  );
  p.solid(
    poly([
      [41.5, 23],
      [38.5, 18.5],
      [44.5, 18.5],
    ]),
    1,
  );
});

const goldenType = defineIcon('pl-golden', (p) => {
  const front = poly([
    [7, 17],
    [27, 17],
    [27, 43],
    [7, 43],
  ]);
  const top = poly([
    [7, 17],
    [14, 10],
    [34, 10],
    [27, 17],
  ]);
  const side = poly([
    [27, 17],
    [34, 10],
    [34, 36],
    [27, 43],
  ]);
  p.shape(front, C.yellow);
  p.shape(top, C.yellow);
  p.shape(side, C.orange);
  p.line('M7 33H27M7 37H27', 'stroke-width="2"');
  p.line('M11 25L16 20', `stroke="${C.white}" stroke-width="2.5"`);
  p.shape(sparkle(39.5, 9, 5), C.yellow, 'stroke-width="2"');
  p.shape(sparkle(41, 23, 3.2), C.orange, 'stroke-width="1.75"');
});

const mirror = defineIcon('pl-mirror', (p) => {
  const r = 'M29 37V11H34C38 11 40.5 13.5 40.5 17.5C40.5 21.5 38 24 34 24H29M34.5 24L41 37';
  p.fill(
    r,
    'none',
    `stroke="${C.pink}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" transform="matrix(-1 0 0 1 46.5 -1.5)"`,
  );
  p.line(r, 'stroke-width="3.75"');
  p.line('M24 4.5V43.5', 'stroke-width="2.25" stroke-dasharray="3.5 3"');
});

const splitFountain = defineIcon('pl-split', (p, id) => {
  p.shift(0, -3.5);
  p.defs.push(
    `<linearGradient id="${id('rb')}" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${C.pink}"/><stop offset="0.5" stop-color="${C.yellow}"/>` +
      `<stop offset="1" stop-color="${C.blue}"/></linearGradient>`,
  );
  const drum = rr(7.5, 13, 33, 16, 4);
  p.fill(drum, `url(#${id('rb')})`);
  p.line(drum);
  p.line('M13 13.5Q10.5 21 13 28.5', 'stroke-width="2"');
  p.line('M4.5 21H7.5M40.5 21H43.5');
  const drips: Array<[number, string]> = [
    [14, C.pink],
    [24, C.yellow],
    [34, C.blue],
  ];
  for (const [x, c] of drips) p.shape(drop(x, 32, 39.5, 3.6), c, 'stroke-width="2.5"');
});

export const PLATE_ICONS: Record<MatrixId, IconFn> = {
  ink_pink: inkDrop(0),
  ink_orange: inkDrop(1),
  ink_yellow: inkDrop(2),
  ink_teal: inkDrop(3),
  ink_blue: inkDrop(4),
  proof,
  guillotine,
  roller,
  margins,
  petit,
  poster,
  ream,
  numerator,
  scrap,
  first_impression: firstImpression,
  column_press: columnPress,
  monotype,
  registration,
  journeyman,
  archive,
  crossmark,
  type_case: typeCase,
  clean_sheet: cleanSheet,
  stencil,
  momentum,
  conveyor,
  ink_well: inkWell,
  gutenberg,
  hydraulic,
  golden_type: goldenType,
  mirror,
  split_fountain: splitFountain,
};
