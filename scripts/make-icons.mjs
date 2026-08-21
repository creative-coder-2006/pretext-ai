// Generates the Pretext toolbar icons (public/icon/{16,32,48,96,128}.png)
// without any image dependencies: draws a 128px "fill-in-the-blank slot"
// mark — [ · ] on a violet gradient tile — then nearest-neighbor downscales.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icon');
mkdirSync(outDir, { recursive: true });

const SIZE = 128;

function drawBase() {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const radius = 28;

  const inRoundedRect = (x, y) => {
    const r = radius;
    const cx = x < r ? r : x > SIZE - 1 - r ? SIZE - 1 - r : x;
    const cy = y < r ? r : y > SIZE - 1 - r ? SIZE - 1 - r : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  // White "[ · ]" mark geometry (a token slot).
  const bracket = (x, y, mirrored) => {
    const bx = mirrored ? SIZE - 1 - x : x;
    const vBar = bx >= 30 && bx <= 40 && y >= 34 && y <= 94;
    const hTop = bx >= 30 && bx <= 54 && y >= 34 && y <= 44;
    const hBot = bx >= 30 && bx <= 54 && y >= 84 && y <= 94;
    return vBar || hTop || hBot;
  };
  const dot = (x, y) => {
    const dx = x - 63.5;
    const dy = y - 63.5;
    return dx * dx + dy * dy <= 11 * 11;
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!inRoundedRect(x, y)) {
        px[i + 3] = 0;
        continue;
      }
      // Diagonal violet gradient: #8B5CF6 -> #4F46E5
      const t = (x + y) / (2 * (SIZE - 1));
      let r = Math.round(0x8b + (0x4f - 0x8b) * t);
      let g = Math.round(0x5c + (0x46 - 0x5c) * t);
      let b = Math.round(0xf6 + (0xe5 - 0xf6) * t);
      if (bracket(x, y, false) || bracket(x, y, true) || dot(x, y)) {
        r = 255;
        g = 255;
        b = 255;
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return px;
}

function downscale(src, size) {
  const out = new Uint8Array(size * size * 4);
  // Box-sample for smoother small sizes.
  const scale = SIZE / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(SIZE, Math.ceil((x + 1) * scale));
      const y0 = Math.floor(y * scale);
      const y1 = Math.min(SIZE, Math.ceil((y + 1) * scale));
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * SIZE + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// --- Minimal PNG encoder (RGBA, 8-bit) ------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const base = drawBase();
for (const size of [16, 32, 48, 96, 128]) {
  const pixels = size === SIZE ? base : downscale(base, size);
  writeFileSync(join(outDir, `${size}.png`), encodePng(pixels, size));
  console.log(`wrote public/icon/${size}.png`);
}
