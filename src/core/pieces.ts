/**
 * Piece ("type") catalogue. Pieces never rotate, so every orientation is its
 * own shape. Shapes are authored as ASCII art for readability.
 */

export const BOARD_SIZE = 8;

export interface Shape {
  readonly id: string;
  /** Cells as [x, y] offsets from the top-left of the bounding box. */
  readonly cells: ReadonlyArray<readonly [number, number]>;
  readonly w: number;
  readonly h: number;
  readonly size: number;
  /** Bit masks per shape row: bit x set = cell at column x. */
  readonly rows: readonly number[];
  /** Base spawn weight. */
  readonly weight: number;
  /** Size class used by modifiers/matrices. */
  readonly family: string;
}

interface ShapeSpec {
  id: string;
  art: string[];
  weight: number;
  family: string;
}

function parse(spec: ShapeSpec): Shape {
  const cells: Array<[number, number]> = [];
  const h = spec.art.length;
  let w = 0;
  const rows: number[] = [];
  spec.art.forEach((line, y) => {
    let mask = 0;
    for (let x = 0; x < line.length; x++) {
      if (line[x] === '#') {
        cells.push([x, y]);
        mask |= 1 << x;
        w = Math.max(w, x + 1);
      }
    }
    rows.push(mask);
  });
  return { id: spec.id, cells, w, h, size: cells.length, rows, weight: spec.weight, family: spec.family };
}

const SPECS: ShapeSpec[] = [
  // 1
  { id: 'dot', art: ['#'], weight: 2.0, family: 'dot' },
  // 2
  { id: 'i2h', art: ['##'], weight: 3.0, family: 'line' },
  { id: 'i2v', art: ['#', '#'], weight: 3.0, family: 'line' },
  // 3
  { id: 'i3h', art: ['###'], weight: 3.0, family: 'line' },
  { id: 'i3v', art: ['#', '#', '#'], weight: 3.0, family: 'line' },
  { id: 'l3a', art: ['#.', '##'], weight: 2.5, family: 'corner' },
  { id: 'l3b', art: ['.#', '##'], weight: 2.5, family: 'corner' },
  { id: 'l3c', art: ['##', '#.'], weight: 2.5, family: 'corner' },
  { id: 'l3d', art: ['##', '.#'], weight: 2.5, family: 'corner' },
  // 4
  { id: 'i4h', art: ['####'], weight: 2.0, family: 'line' },
  { id: 'i4v', art: ['#', '#', '#', '#'], weight: 2.0, family: 'line' },
  { id: 'o4', art: ['##', '##'], weight: 4.0, family: 'square' },
  { id: 't4u', art: ['###', '.#.'], weight: 1.5, family: 't' },
  { id: 't4d', art: ['.#.', '###'], weight: 1.5, family: 't' },
  { id: 't4l', art: ['#.', '##', '#.'], weight: 1.5, family: 't' },
  { id: 't4r', art: ['.#', '##', '.#'], weight: 1.5, family: 't' },
  { id: 'l4a', art: ['#.', '#.', '##'], weight: 1.25, family: 'l' },
  { id: 'l4b', art: ['###', '#..'], weight: 1.25, family: 'l' },
  { id: 'l4c', art: ['##', '.#', '.#'], weight: 1.25, family: 'l' },
  { id: 'l4d', art: ['..#', '###'], weight: 1.25, family: 'l' },
  { id: 'j4a', art: ['.#', '.#', '##'], weight: 1.25, family: 'l' },
  { id: 'j4b', art: ['#..', '###'], weight: 1.25, family: 'l' },
  { id: 'j4c', art: ['##', '#.', '#.'], weight: 1.25, family: 'l' },
  { id: 'j4d', art: ['###', '..#'], weight: 1.25, family: 'l' },
  { id: 's4h', art: ['.##', '##.'], weight: 1.0, family: 'skew' },
  { id: 's4v', art: ['#.', '##', '.#'], weight: 1.0, family: 'skew' },
  { id: 'z4h', art: ['##.', '.##'], weight: 1.0, family: 'skew' },
  { id: 'z4v', art: ['.#', '##', '#.'], weight: 1.0, family: 'skew' },
  // 5
  { id: 'i5h', art: ['#####'], weight: 1.5, family: 'line' },
  { id: 'i5v', art: ['#', '#', '#', '#', '#'], weight: 1.5, family: 'line' },
  { id: 'v5a', art: ['#..', '#..', '###'], weight: 1.5, family: 'bigcorner' },
  { id: 'v5b', art: ['..#', '..#', '###'], weight: 1.5, family: 'bigcorner' },
  { id: 'v5c', art: ['###', '#..', '#..'], weight: 1.5, family: 'bigcorner' },
  { id: 'v5d', art: ['###', '..#', '..#'], weight: 1.5, family: 'bigcorner' },
  // 6
  { id: 'r6h', art: ['###', '###'], weight: 1.5, family: 'rect' },
  { id: 'r6v', art: ['##', '##', '##'], weight: 1.5, family: 'rect' },
  // 9
  { id: 'o9', art: ['###', '###', '###'], weight: 1.5, family: 'square' },
];

export const SHAPES: readonly Shape[] = SPECS.map(parse);

const BY_ID = new Map<string, Shape>(SHAPES.map((s) => [s.id, s]));

export function shapeById(id: string): Shape {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Unknown shape: ${id}`);
  return s;
}

export function hasShape(id: string): boolean {
  return BY_ID.has(id);
}

/** Expected piece size under the given weights (for docs/tests/balance). */
export function expectedSize(weightOf: (s: Shape) => number = (s) => s.weight): number {
  let tw = 0;
  let ts = 0;
  for (const s of SHAPES) {
    const w = weightOf(s);
    tw += w;
    ts += w * s.size;
  }
  return ts / tw;
}
