/**
 * Interface icons (HUD, menus, settings, store, tutorial). Original artwork drawn in code,
 * same two-layer risograph construction as the plate icons.
 */
import {
  C,
  arc,
  arrowHead,
  circ,
  defineIcon,
  drop,
  ell,
  gear,
  poly,
  polar,
  rr,
  star,
  type IconFn,
  type Print,
  type Pt,
} from './kit';

/** Colour underlay for line-drawn glyphs: the same path printed in spot colour, wider. */
function underlay(p: Print, d: string, color: string, width = 7.5): void {
  p.fill(
    d,
    'none',
    `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`,
  );
}

/** Diagonal "off" slash; the gap around it is a true transparent knock-out. */
function slash(p: Print): void {
  p.cut('M8 7L40 41');
}

const pause = defineIcon('ui-pause', (p) => {
  p.shape(rr(11.5, 8.5, 9, 31, 2), C.blue);
  p.shape(rr(27.5, 8.5, 9, 31, 2), C.blue);
});

const play = defineIcon('ui-play', (p) => {
  p.shape(
    poly([
      [15.5, 8],
      [40, 24],
      [15.5, 40],
    ]),
    C.pink,
  );
});

const info = defineIcon('ui-info', (p) => {
  p.shape(circ(24, 24, 19), C.yellow);
  p.dot(24, 14.5, 3);
  p.line('M24 21.5V34', 'stroke-width="4.5"');
});

const settings = defineIcon('ui-settings', (p) => {
  p.shape(gear(24, 24, 19.5, 14.5, 8), C.teal);
  p.line(circ(24, 24, 6), `fill="${C.white}"`);
});

const back = defineIcon('ui-back', (p) => {
  p.shape(
    poly([
      [5.5, 24],
      [20.5, 9.5],
      [20.5, 18],
      [42.5, 18],
      [42.5, 30],
      [20.5, 30],
      [20.5, 38.5],
    ]),
    C.orange,
  );
});

const close = defineIcon('ui-close', (p) => {
  const d = 'M12 12L36 36M36 12L12 36';
  underlay(p, d, C.pink, 8.5);
  p.line(d, 'stroke-width="4.5"');
});

const share = defineIcon('ui-share', (p) => {
  p.line('M34 11.5L14 24L34 36.5', 'stroke-width="3"');
  for (const [x, y] of [
    [34, 11.5],
    [14, 24],
    [34, 36.5],
  ] as const) {
    p.shape(circ(x, y, 6.5), C.orange);
  }
});

/** Solid ink arrow head just past the clockwise end of an arc at angle `deg`. */
function arcHead(p: Print, cx: number, cy: number, r: number, deg: number, len = 10, half = 6.5): void {
  const end = polar(cx, cy, r, deg);
  const tip = polar(end[0], end[1], len * 0.55, deg + 90);
  p.solid(arrowHead(tip, deg + 90, len, half), 1.5);
}

const reroll = defineIcon('ui-reroll', (p) => {
  const d = arc(24, 24, 15, 196, 318) + arc(24, 24, 15, 16, 138);
  underlay(p, d, C.pink);
  p.line(d, 'stroke-width="3.5"');
  arcHead(p, 24, 24, 15, 318);
  arcHead(p, 24, 24, 15, 138);
});

const skip = defineIcon('ui-skip', (p) => {
  p.shape(
    poly([
      [9.5, 9.5],
      [31.5, 24],
      [9.5, 38.5],
    ]),
    C.yellow,
  );
  p.shape(rr(32.5, 9.5, 7, 29, 1.5), C.yellow);
});

function sheetPath(x: number, y: number, w: number, h: number, ear: number): string {
  return `M${x} ${y}H${x + w - ear}L${x + w} ${y + ear}V${y + h}H${x}Z`;
}

const sell = defineIcon('ui-sell', (p) => {
  p.line(sheetPath(8, 5, 25, 34, 7), `fill="${C.white}"`);
  p.line('M26 5V12H33', `fill="${C.paperShade}" stroke-width="2.5"`);
  p.line('M13 17H24M13 23H24', 'stroke-width="2.25"');
  p.shape(circ(33.5, 33.5, 10), C.orange);
  p.line('M28.5 33.5H38.5', 'stroke-width="3.75"');
});

const sheet = defineIcon('ui-sheet', (p) => {
  p.line(sheetPath(10, 4.5, 28, 39, 8.5), `fill="${C.white}"`);
  p.shape('M29.5 4.5V13H38Z', C.yellow, 'stroke-width="2.75"');
  p.line('M16 21H32M16 27.5H32M16 34H26', 'stroke-width="2.5"');
});

const streak = defineIcon('ui-streak', (p) => {
  p.shape(drop(28, 4.5, 28.5, 14.5), C.pink);
  p.line('M19 26.5Q19.5 22 22.5 19', `stroke="${C.white}" stroke-width="2.25"`);
  p.line('M4.5 22H10.5M4.5 30H9.5M6.5 38H12.5', 'stroke-width="3"');
});

const dropEmpty = defineIcon('ui-drop-empty', (p) => {
  const d = drop(24, 4.5, 28.5, 15);
  p.line(d, `fill="${C.white}"`);
  p.line('M13 31.5Q13.8 37.5 19.5 39.5', 'stroke-width="2.25" stroke-dasharray="0.1 4.5"');
});

const starIcon = defineIcon('ui-star', (p) => {
  p.shape(star(24, 25.5, 20, 8.5), C.yellow);
});

const lock = defineIcon('ui-lock', (p) => {
  p.line('M15.5 21.5V15A8.5 8.5 0 0 1 32.5 15V21.5', 'stroke-width="3.75"');
  p.shape(rr(9.5, 21, 29, 22.5, 3), C.yellow);
  p.dot(24, 30.5, 3.2);
  p.line('M24 31.5V37', 'stroke-width="3"');
});

const ad = defineIcon('ui-ad', (p) => {
  p.shape(rr(4.5, 9.5, 39, 29, 6), C.yellow);
  p.solid(
    poly([
      [19.5, 16.5],
      [31.5, 24],
      [19.5, 31.5],
    ]),
    3,
  );
});

const SPEAKER = poly([
  [6, 18],
  [13.5, 18],
  [23, 9.5],
  [23, 38.5],
  [13.5, 30],
  [6, 30],
]);

const sound = defineIcon('ui-sound', (p) => {
  p.shape(SPEAKER, C.orange);
  p.line(arc(23, 24, 8.5, -50, 50));
  p.line(arc(23, 24, 16, -50, 50));
});

const soundOff = defineIcon('ui-sound-off', (p) => {
  p.shape(SPEAKER, C.orange);
  p.line('M30 18.5L41 29.5M41 18.5L30 29.5');
});

function noteArt(p: Print): void {
  p.shape(
    poly([
      [18.5, 10.5],
      [40, 5],
      [40, 12.5],
      [18.5, 18],
    ]),
    C.pink,
    'stroke-width="2.75"',
  );
  p.line('M18.5 15V35M40 9V31');
  const heads: Array<[number, number]> = [
    [13.5, 35.5],
    [35, 31.5],
  ];
  for (const [x, y] of heads) {
    const h = ell(x, y, 6, 4.5);
    p.fill(h, C.pink, `transform="rotate(-20 ${x} ${y})"`);
    p.line(h, `transform="rotate(-20 ${x} ${y})"`);
  }
}

const music = defineIcon('ui-music', (p) => {
  p.shift(0, 1.2);
  noteArt(p);
});

const musicOff = defineIcon('ui-music-off', (p) => {
  noteArt(p);
  slash(p);
});

function phoneArt(p: Print): void {
  p.shape(rr(15, 5.5, 18, 37, 3.5), C.teal);
  p.line(rr(18.5, 10, 11, 23.5, 1), `fill="${C.white}" stroke-width="2.25"`);
  p.dot(24, 37.5, 1.8);
}

const haptics = defineIcon('ui-haptics', (p) => {
  phoneArt(p);
  p.line(
    'M9.5 15L6 19.5L9.5 24L6 28.5L9.5 33M38.5 15L42 19.5L38.5 24L42 28.5L38.5 33',
    'stroke-width="2.75"',
  );
});

const hapticsOff = defineIcon('ui-haptics-off', (p) => {
  phoneArt(p);
  slash(p);
});

const language = defineIcon('ui-language', (p) => {
  p.shape(circ(24, 24, 19), C.blue);
  p.line(ell(24, 24, 8, 19), 'stroke-width="2.5"');
  p.line('M5 24H43M8.5 14H39.5M8.5 34H39.5', 'stroke-width="2.5"');
});

const trophy = defineIcon('ui-trophy', (p) => {
  p.line('M13 10.5H7.5V13.5A7.5 7.5 0 0 0 15 21M35 10.5H40.5V13.5A7.5 7.5 0 0 1 33 21', 'stroke-width="3"');
  p.shape('M12.5 5.5H35.5V16.5A11.5 11.5 0 0 1 12.5 16.5Z', C.yellow);
  p.line('M24 28V35');
  p.shape(rr(14.5, 35, 19, 8, 1.5), C.yellow);
  p.shape(star(24, 15, 5, 2.2), C.white, 'stroke-width="1.75"');
});

const stats = defineIcon('ui-stats', (p) => {
  p.shape(rr(7, 25, 9, 17, 1.5), C.teal);
  p.shape(rr(19.5, 15, 9, 27, 1.5), C.teal);
  p.shape(rr(32, 6, 9, 36, 1.5), C.teal);
  p.line('M4.5 42.5H43.5');
});

const check = defineIcon('ui-check', (p) => {
  p.shape(
    poly([
      [5.5, 25],
      [12, 18.5],
      [19.5, 26],
      [36, 9.5],
      [42.5, 16],
      [19.5, 39],
    ]),
    C.teal,
  );
});

function xShape(cx: number, cy: number, a: number, t: number): string {
  const base: Pt[] = [
    [-t, -a],
    [t, -a],
    [t, -t],
    [a, -t],
    [a, t],
    [t, t],
    [t, a],
    [-t, a],
    [-t, t],
    [-a, t],
    [-a, -t],
    [-t, -t],
  ];
  const c = Math.SQRT1_2;
  return poly(base.map(([x, y]) => [cx + (x - y) * c, cy + (x + y) * c] as Pt));
}

const cross = defineIcon('ui-cross', (p) => {
  p.shape(xShape(24, 24, 18.5, 4.6), C.pink);
});

const CHEVRON_L = poly([
  [30, 6],
  [36.5, 12.5],
  [25, 24],
  [36.5, 35.5],
  [30, 42],
  [12, 24],
]);

const arrowLeft = defineIcon('ui-arrow-left', (p) => {
  p.shape(CHEVRON_L, C.orange);
});

const arrowRight = defineIcon('ui-arrow-right', (p) => {
  p.fill(CHEVRON_L, C.orange, 'transform="matrix(-1 0 0 1 48 0)"');
  p.line(CHEVRON_L, 'transform="matrix(-1 0 0 1 48 0)"');
});

const undo = defineIcon('ui-undo', (p) => {
  p.shift(0, -2);
  const d = 'M12 17.5H29.5A10 10 0 0 1 29.5 37.5H15';
  underlay(p, d, C.blue);
  p.line(d, 'stroke-width="3.5"');
  p.solid(arrowHead([5, 17.5], 180, 10, 6.5), 1.5);
});

const calendar = defineIcon('ui-calendar', (p) => {
  p.line(rr(6, 9, 36, 33.5, 3), `fill="${C.white}"`);
  p.shape('M6 19V12Q6 9 9 9H39Q42 9 42 12V19Z', C.pink);
  p.line('M16 5V12.5M32 5V12.5', 'stroke-width="3.5"');
  for (const [x, y] of [
    [11.5, 24],
    [20.5, 24],
    [29.5, 24],
    [11.5, 32.5],
    [20.5, 32.5],
  ] as const) {
    p.solid(rr(x, y, 5, 5, 1));
  }
  p.shape(rr(28.5, 31, 8, 8, 1.5), C.yellow, 'stroke-width="2.5"');
});

const plates = defineIcon('ui-plates', (p) => {
  p.shift(0, -1.5);
  p.line(rr(7, 11, 21, 28, 2.5), `fill="${C.white}" transform="rotate(-14 17.5 25)"`);
  p.line(rr(13.5, 8.5, 21, 28, 2.5), `fill="${C.white}" transform="rotate(-2 24 22.5)"`);
  const front = rr(20, 12, 21, 30, 2.5);
  p.fill(front, C.blue, 'transform="rotate(10 30.5 27)"');
  p.line(front, 'transform="rotate(10 30.5 27)"');
  p.line(circ(30.5, 27, 5), `fill="${C.white}" stroke-width="2.5" transform="rotate(10 30.5 27)"`);
});

const home = defineIcon('ui-home', (p) => {
  p.shape('M10 21V42.5H38V21L24 8.5Z', C.orange);
  p.line(rr(19.5, 28.5, 9, 14), `fill="${C.white}" stroke-width="2.75"`);
  p.line('M5 23.5L24 6.5L43 23.5', 'stroke-width="3.75"');
});

const restart = defineIcon('ui-restart', (p) => {
  p.shift(0, -2.5);
  const d = arc(24, 25, 15.5, -62, 222);
  underlay(p, d, C.yellow);
  p.line(d, 'stroke-width="3.5"');
  arcHead(p, 24, 25, 15.5, 222);
});

const crown = defineIcon('ui-crown', (p) => {
  p.shift(0, 2);
  p.shape(
    poly([
      [6, 15],
      [15.5, 25],
      [24, 10],
      [32.5, 25],
      [42, 15],
      [38.5, 37],
      [9.5, 37],
    ]),
    C.yellow,
  );
  p.line('M10 31.5H38', 'stroke-width="2.5"');
  p.dot(6, 13.5, 2.6);
  p.dot(24, 8.5, 2.6);
  p.dot(42, 13.5, 2.6);
});

const privacy = defineIcon('ui-privacy', (p) => {
  p.shape('M24 4.5L40.5 10.5V22.5C40.5 32 33.5 39.5 24 43.5C14.5 39.5 7.5 32 7.5 22.5V10.5Z', C.teal);
  const d = 'M16 24.5L22 30.5L32.5 18';
  p.line(d, 'stroke-width="7"');
  p.line(d, `stroke="${C.white}" stroke-width="3"`);
});

const HAND =
  'M17 28.5V8.5A3.5 3.5 0 0 1 24 8.5V20A3 3 0 0 1 30 20V21.5A2.75 2.75 0 0 1 35.5 21.5V23.5A2.5 2.5 0 0 1 40.5 23.5' +
  'V33C40.5 39.5 36 43.5 29.5 43.5H25C20.5 43.5 18 41.5 15.5 38.5L8.5 30A3.2 3.2 0 0 1 13.5 26L17 29.5Z';

const hand = defineIcon('ui-hand', (p) => {
  p.fill(HAND, C.pink);
  p.line(HAND, `fill="${C.white}"`);
  p.line('M30 21.5V26.5M35.5 23.5V28', 'stroke-width="2.25"');
});

const tap = defineIcon('ui-tap', (p) => {
  const k = 0.72;
  const t = `transform="translate(6.5 11.4) scale(${k})"`;
  p.fill(HAND, C.pink, t);
  p.line(HAND, `fill="${C.white}" stroke-width="${(3.25 / k).toFixed(2)}" ${t}`);
  p.line(arc(21.3, 15, 5.5, 195, 345), 'stroke-width="2.75"');
  p.line(arc(21.3, 15, 10.5, 200, 340), 'stroke-width="2.75"');
});

export const UI_ICONS = {
  pause,
  play,
  info,
  settings,
  back,
  close,
  share,
  reroll,
  skip,
  sell,
  sheet,
  streak,
  drop_empty: dropEmpty,
  star: starIcon,
  lock,
  ad,
  sound,
  sound_off: soundOff,
  music,
  music_off: musicOff,
  haptics,
  haptics_off: hapticsOff,
  language,
  trophy,
  stats,
  check,
  cross,
  arrow_left: arrowLeft,
  arrow_right: arrowRight,
  undo,
  calendar,
  plates,
  home,
  restart,
  crown,
  privacy,
  hand,
  tap,
} satisfies Record<string, IconFn>;

export type UiIconId = keyof typeof UI_ICONS;
