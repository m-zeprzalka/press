import { describe, expect, it } from 'vitest';
import { snap } from './snap';

const all = () => true;
const none = () => false;

describe('snap', () => {
  it('uses the rounded position when valid', () => {
    expect(snap(2.4, 3.6, all, null)).toEqual({ x: 2, y: 4 });
  });

  it('returns null when nothing is valid nearby', () => {
    expect(snap(2.4, 3.6, none, null)).toBeNull();
  });

  it('finds the nearest valid position within one cell', () => {
    const valid = (x: number, y: number) => x === 3 && y === 4;
    expect(snap(2.4, 3.6, valid, null)).toEqual({ x: 3, y: 4 });
    // Too far (> 1 cell) → null.
    const far = (x: number, y: number) => x === 5 && y === 5;
    expect(snap(2.4, 3.6, far, null)).toBeNull();
  });

  it('holds the previous ghost unless a candidate is clearly closer', () => {
    const valid = (x: number, y: number) => (x === 1 && y === 1) || (x === 2 && y === 1);
    // Rounded (2,1)? fx 1.6 rounds to 2 → valid → exact wins (natural movement).
    expect(snap(1.6, 1.0, valid, { x: 1, y: 1 })).toEqual({ x: 2, y: 1 });
    // Rounded target (2,2) invalid; (2,1) and (1,2) are equally close (≈0.71).
    const v3 = (x: number, y: number) => (x === 2 && y === 1) || (x === 1 && y === 2);
    expect(snap(1.55, 1.55, v3, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(snap(1.55, 1.55, v3, { x: 2, y: 1 })).toEqual({ x: 2, y: 1 });
    // Without a previous ghost: the first nearest candidate.
    expect(snap(1.55, 1.55, v3, null)).toEqual({ x: 2, y: 1 });
    // A clearly closer candidate wins over the held ghost.
    expect(snap(1.85, 1.2, v3, { x: 1, y: 2 })).toEqual({ x: 2, y: 1 });
  });
});
