/**
 * Minimal deterministic PNG encoder (Node only): 8-bit RGB or RGBA, no ancillary chunks
 * (so no timestamps, gamma or colour-profile noise), per-row filter selection and zlib level 9.
 * Several filter strategies are tried and the smallest stream is kept.
 */
import { deflateSync, constants } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Filter one scanline with filter type f into out (without the filter byte). */
function filterRow(f: number, cur: Uint8Array, prev: Uint8Array | null, bpp: number, out: Uint8Array): void {
  const n = cur.length;
  for (let i = 0; i < n; i++) {
    const x = cur[i]!;
    const a = i >= bpp ? cur[i - bpp]! : 0;
    const b = prev ? prev[i]! : 0;
    const c = prev && i >= bpp ? prev[i - bpp]! : 0;
    let v: number;
    switch (f) {
      case 0:
        v = x;
        break;
      case 1:
        v = x - a;
        break;
      case 2:
        v = x - b;
        break;
      case 3:
        v = x - ((a + b) >> 1);
        break;
      default:
        v = x - paeth(a, b, c);
    }
    out[i] = v & 0xff;
  }
}

function filtered(pixels: Uint8Array, width: number, height: number, bpp: number, mode: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  const tmp = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let bestF = mode;
    if (mode < 0) {
      // Adaptive: minimum sum of absolute signed residuals (libpng heuristic).
      let bestSum = Infinity;
      for (let f = 0; f < 5; f++) {
        filterRow(f, cur, prev, bpp, tmp);
        let sum = 0;
        for (let i = 0; i < stride; i++) {
          const v = tmp[i]!;
          sum += v < 128 ? v : 256 - v;
        }
        if (sum < bestSum) {
          bestSum = sum;
          bestF = f;
        }
      }
    }
    const row = out.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    filterRow(bestF, cur, prev, bpp, row);
    out[y * (stride + 1)] = bestF;
  }
  return out;
}

/**
 * Encode straight-alpha RGBA bytes as PNG. With channels = 3 the alpha channel is dropped
 * (opaque images such as the paper tile).
 */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
  channels: 3 | 4,
  effort: 'max' | 'fast' = 'max',
): Buffer {
  let pixels = rgba;
  if (channels === 3) {
    pixels = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      pixels[j] = rgba[i]!;
      pixels[j + 1] = rgba[i + 1]!;
      pixels[j + 2] = rgba[i + 2]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type RGBA / RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  let best: Buffer | null = null;
  const modes = effort === 'max' ? [-1, 1] : [-1]; // adaptive wins on the atlas, Sub on the paper
  const strategies =
    effort === 'max' ? [constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED] : [constants.Z_DEFAULT_STRATEGY];
  for (const mode of modes) {
    const raw = filtered(pixels, width, height, channels, mode);
    for (const strategy of strategies) {
      const z = deflateSync(raw, { level: effort === 'max' ? 9 : 6, memLevel: 9, strategy });
      if (!best || z.length < best.length) best = z;
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', best!), chunk('IEND', new Uint8Array(0))]);
}
