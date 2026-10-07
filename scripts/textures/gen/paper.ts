/**
 * Seamless warm riso paper (GDD §14.1 "papier: włókna + ziarno"): low-frequency blotches,
 * paper tooth, curved fibres (darker and lighter), rare inclusions and fine grain.
 * Every field is periodic over the tile (noise lattices wrap, strokes wrap), so it tiles without seams.
 */
import { PAPER } from '../../../src/theme';
import { PAPER_PX } from '../spec';
import { Field, Raster, quad, strokeField } from './raster';
import { Rng, clamp01, fbmS, hash2, rgb, seedOf, vnoise } from './math';

export function paperTile(): Raster {
  const S = PAPER_PX;
  const seed = seedOf('paper');
  const rng = new Rng(seed);
  const base = rgb(PAPER);

  // Fibres: a darker (greyish-brown) and a lighter (bleached) population, wrapped around the edges.
  const darkF = new Field(S, S);
  const lightF = new Field(S, S);
  const fibres = (
    field: Field,
    count: number,
    minLen: number,
    maxLen: number,
    wMin: number,
    wMax: number,
    aMin: number,
    aMax: number,
  ): void => {
    for (let i = 0; i < count; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      const ang = rng.range(0, Math.PI * 2);
      const len = minLen + (maxLen - minLen) * rng.next() ** 2;
      const bend = rng.range(-0.45, 0.45) * len;
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      const cx = x + dx / 2 - Math.sin(ang) * bend;
      const cy = y + dy / 2 + Math.cos(ang) * bend;
      strokeField(
        field,
        quad(x, y, cx, cy, x + dx, y + dy, 10),
        rng.range(wMin, wMax),
        rng.range(aMin, aMax),
        true,
      );
    }
  };
  fibres(darkF, 520, 5, 22, 0.55, 1.05, 0.25, 0.6);
  fibres(darkF, 60, 18, 42, 0.5, 0.8, 0.2, 0.4);
  fibres(lightF, 620, 5, 26, 0.7, 1.5, 0.35, 0.8);
  // Inclusions: tiny dark specks.
  const specks = new Field(S, S);
  for (let i = 0; i < 34; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(0.3, 1.1);
    const a = rng.range(0.15, 0.4);
    strokeField(
      specks,
      [
        [x, y],
        [x + rng.range(-1, 1), y + rng.range(-1, 1)],
      ],
      r * 2,
      a,
      true,
    );
  }

  const fibreDark = [base[0] * 0.8, base[1] * 0.77, base[2] * 0.72] as const;
  const fibreLight = [1, 0.995, 0.975] as const;
  const speck = [0.36, 0.33, 0.31] as const;

  const r = new Raster(S, S);
  r.paintRgb((px, py, out) => {
    const x = px / S;
    const y = py / S;
    // Large soft blotches (wet-strength variation) and cloudy formation.
    const blotch = fbmS(x * 3, y * 3, seed + 1, 5, 3);
    const cloud = fbmS(x * 14, y * 14, seed + 2, 3, 14);
    // Tooth: ~3 px felt texture.
    const tooth = vnoise(x * 170, y * 170, seed + 3, 170) - 0.5;
    const grain = hash2(Math.floor(px), Math.floor(py), seed + 4) - 0.5;
    const warm = fbmS(x * 2, y * 2, seed + 5, 3, 2);
    const k = 1 + 0.018 * blotch + 0.008 * cloud + 0.016 * tooth + 0.012 * grain;
    out[0] = clamp01(base[0] * k + 0.004 * warm);
    out[1] = clamp01(base[1] * k);
    out[2] = clamp01(base[2] * k - 0.006 * warm);
    return 1;
  });
  for (let i = 0; i < S * S; i++) {
    r.put(i, fibreDark, darkF.v[i]! * 0.55);
    r.put(i, fibreLight, lightF.v[i]! * 0.6);
    r.put(i, speck, specks.v[i]!);
  }
  return r;
}
