/**
 * Special-contract modifier icons, one per ModifierId (GDD §7). Original artwork drawn in code.
 */
import type { ModifierId } from '../../core/contracts';
import { C, circ, defineIcon, drop, halftone, poly, polar, rr, type IconFn, type Pt } from './kit';

const rush = defineIcon('md-rush', (p) => {
  p.line(rr(17, 5.5, 6, 3.5, 1), `fill="${C.ink}"`);
  p.line('M20 9V12.5');
  p.shape(circ(20, 27, 14), C.orange);
  p.line(circ(20, 27, 9.5), `fill="${C.white}" stroke-width="2"`);
  p.line('M20 21.5V27L24 29.5', 'stroke-width="2.75"');
  p.shape(
    poly([
      [37, 4.5],
      [28.5, 21],
      [35, 21],
      [31.5, 37],
      [43.5, 16.5],
      [37, 16.5],
      [41, 4.5],
    ]),
    C.yellow,
    'stroke-width="2.75"',
  );
});

const bigFormat = defineIcon('md-big', (p) => {
  p.shape('M4.5 4.5H34L43.5 14V43.5H4.5Z', C.orange);
  p.line('M34 4.5V14H43.5', `fill="${C.white}" stroke-width="2.5"`);
  p.line(rr(9.5, 22, 12, 16, 1), `fill="${C.white}" stroke-width="2.25"`);
  p.line('M24.5 19.5L33.5 10.5');
  p.solid(
    poly([
      [35.5, 8.5],
      [34.5, 16],
      [28, 9.5],
    ]),
    1.5,
  );
});

const jam = defineIcon('md-jam', (p) => {
  const hex: Pt[] = [];
  for (let i = 0; i < 6; i++) hex.push(polar(24, 24, 19, i * 60 + 30));
  p.shape(poly(hex), C.lead);
  p.line(circ(24, 24, 10), `fill="${C.jam}" stroke-width="2.5"`);
  p.line('M18.5 21A6.5 6.5 0 0 1 24 17.5', `stroke="${C.white}" stroke-width="2.25"`);
});

const wetInk = defineIcon('md-wet', (p) => {
  const blob =
    'M4.5 9.5Q4.5 5 9 5H39Q43.5 5 43.5 9.5V15Q43.5 18 41 18Q38.5 18 38.5 21V24A3 3 0 0 1 32.5 24V20' +
    'Q32.5 18 30 18Q27 18 27 21V33A3.5 3.5 0 0 1 20 33V20.5Q20 18 17.5 18Q15 18 15 20.5V26A3 3 0 0 1 9 26V20' +
    'Q9 18 7 18Q4.5 18 4.5 15Z';
  p.shape(blob, C.blue);
  p.shape(drop(35.5, 31, 39.5, 3.8), C.blue, 'stroke-width="2.5"');
  p.line('M9.5 10.5H20', `stroke="${C.white}" stroke-width="2.25"`);
});

const outOfInk = defineIcon('md-out', (p, id) => {
  p.defs.push(halftone(id('ht'), C.lead, { size: 3, r: 0.8 }));
  const d = drop(24, 4.5, 28.5, 15);
  p.fill(d, `url(#${id('ht')})`);
  p.line(d);
  p.line('M24 37.5H24.01M17.5 35.5H17.51', 'stroke-width="2"');
  p.cut('M8 8L40 40');
});

const leftover = defineIcon('md-leftover', (p) => {
  p.shift(1, -0.5);
  const slugs: Array<[number, number]> = [
    [5.5, 7],
    [27.5, 13],
    [12, 29],
  ];
  for (const [x, y] of slugs) {
    p.shape(rr(x, y, 13, 13, 1.5), C.lead);
    p.line(`M${x + 3} ${y + 4.5}H${x + 10}M${x + 3} ${y + 8.5}H${x + 10}`, 'stroke-width="1.75"');
  }
});

const failure = defineIcon('md-failure', (p) => {
  const left = poly([
    [6, 7],
    [23, 7],
    [20, 15],
    [25, 21],
    [19.5, 29],
    [23.5, 35],
    [21, 41],
    [6, 41],
  ]);
  const right = poly([
    [26, 7],
    [41, 7],
    [41, 41],
    [24, 41],
    [26.5, 35],
    [22.5, 29],
    [28, 21],
    [23, 15],
  ]);
  const t = 'transform="rotate(6 33 24) translate(1.5 0.5)"';
  p.shift(-1.2, 0);
  p.shape(left, C.pink);
  p.fill(right, C.pink, t);
  p.line(right, t);
  p.line(circ(13.5, 15, 3), 'stroke-width="2.25"');
  p.line('M10 34H17', 'stroke-width="2.25"');
  p.line('M31.5 33H37', `stroke-width="2.25" ${t}`);
});

const shortTray = defineIcon('md-short', (p) => {
  p.shape(rr(4.5, 13, 28, 22, 3), C.paperShade);
  p.shape(rr(8, 17.5, 9.5, 13, 1.5), C.teal, 'stroke-width="2.5"');
  p.shape(rr(20, 17.5, 9.5, 13, 1.5), C.teal, 'stroke-width="2.5"');
  p.line('M36 17L43 31M43 17L36 31', 'stroke-width="2.75"');
});

function hArrow(y: number): string {
  return poly([
    [4.5, y],
    [12.5, y - 7],
    [12.5, y - 3],
    [35.5, y - 3],
    [35.5, y - 7],
    [43.5, y],
    [35.5, y + 7],
    [35.5, y + 3],
    [12.5, y + 3],
    [12.5, y + 7],
  ]);
}

const rowsOnly = defineIcon('md-rows', (p) => {
  p.shape(hArrow(14), C.yellow, 'stroke-width="2.75"');
  p.shape(hArrow(34), C.yellow, 'stroke-width="2.75"');
});

export const MODIFIER_ICONS: Record<ModifierId, IconFn> = {
  rush,
  big_format: bigFormat,
  wet_ink: wetInk,
  jam,
  out_of_ink: outOfInk,
  leftover,
  failure,
  short_tray: shortTray,
  rows_only: rowsOnly,
};
