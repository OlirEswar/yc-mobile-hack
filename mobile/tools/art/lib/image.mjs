/**
 * A tiny RGBA raster with the drawing primitives the art generators need, plus a dependency-free
 * PNG encoder (indexed when the image has at most 256 distinct RGBA values, RGBA otherwise) and a
 * decoder for the PNGs this encoder writes (used by the preview compositor).
 */
import { deflateSync, inflateSync } from 'node:zlib';

/** An RGBA colour as [r, g, b, a], each 0..255. */
export const rgba = (hex, a = 255) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};

export const withAlpha = (c, a) => [c[0], c[1], c[2], a];

export class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  /** Source-over blend of one pixel. Opaque colours overwrite. */
  set(x, y, c) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const a = c[3] / 255;
    if (a >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return;
    }
    if (a <= 0) return;
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    this.data[i] = Math.round((c[0] * a + this.data[i] * da * (1 - a)) / oa);
    this.data[i + 1] = Math.round((c[1] * a + this.data[i + 1] * da * (1 - a)) / oa);
    this.data[i + 2] = Math.round((c[2] * a + this.data[i + 2] * da * (1 - a)) / oa);
    this.data[i + 3] = Math.round(oa * 255);
  }

  /** Overwrites a pixel including its alpha (no blending). */
  put(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  clear(x, y) {
    this.put(x, y, [0, 0, 0, 0]);
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  hline(x0, x1, y, c) {
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }

  vline(x, y0, y1, c) {
    for (let y = y0; y <= y1; y++) this.set(x, y, c);
  }

  frame(x, y, w, h, c) {
    this.hline(x, x + w - 1, y, c);
    this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y + 1, y + h - 2, c);
    this.vline(x + w - 1, y + 1, y + h - 2, c);
  }

  /** Filled ellipse centred on (cx, cy) with pixel-exact radii; fn(dx, dy, d) may pick the colour. */
  ellipse(cx, cy, rx, ry, c) {
    for (let j = -Math.ceil(ry); j <= Math.ceil(ry); j++)
      for (let i = -Math.ceil(rx); i <= Math.ceil(rx); i++) {
        const d = (i * i) / (rx * rx) + (j * j) / (ry * ry);
        if (d <= 1) this.set(cx + i, cy + j, typeof c === 'function' ? c(i, j, d) : c);
      }
  }

  /** Bresenham line, one pixel wide. */
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Copies src onto this image at (dx, dy), blending. flip mirrors horizontally. */
  blit(src, dx, dy, flip = false, opacity = 1) {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const k = (j * src.w + (flip ? src.w - 1 - i : i)) * 4;
        const a = src.data[k + 3];
        if (a) this.set(dx + i, dy + j, [src.data[k], src.data[k + 1], src.data[k + 2], Math.round(a * opacity)]);
      }
  }

  /** Copies a sub-rectangle of src. */
  blitRect(src, sx, sy, sw, sh, dx, dy) {
    for (let j = 0; j < sh; j++)
      for (let i = 0; i < sw; i++) {
        const c = src.get(sx + i, sy + j);
        if (c[3]) this.set(dx + i, dy + j, c);
      }
  }

  /** Nearest-neighbour upscale by an integer factor. */
  scaled(k) {
    const out = new Img(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const s = ((Math.floor(y / k) * this.w + Math.floor(x / k)) * 4);
        const d = (y * out.w + x) * 4;
        out.data[d] = this.data[s];
        out.data[d + 1] = this.data[s + 1];
        out.data[d + 2] = this.data[s + 2];
        out.data[d + 3] = this.data[s + 3];
      }
    return out;
  }

  crop(x, y, w, h) {
    const out = new Img(w, h);
    out.blitRect(this, x, y, w, h, 0, 0);
    return out;
  }

  /**
   * Adds a 1px outline around every opaque region. colorAt(x, y, inner) picks the outline colour,
   * given the opaque neighbour it borders.
   */
  outline(colorAt, diagonal = false) {
    const src = new Uint8Array(this.data);
    const opaque = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && src[(y * this.w + x) * 4 + 3] > 127;
    const dirs = diagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (opaque(x, y)) continue;
        for (const [dx, dy] of dirs)
          if (opaque(x + dx, y + dy)) {
            const k = ((y + dy) * this.w + (x + dx)) * 4;
            this.put(x, y, colorAt(x, y, [src[k], src[k + 1], src[k + 2], 255]));
            break;
          }
      }
  }
}

/** Draws rows of characters with a key -> colour map. Spaces and dots are transparent. */
export function glyph(img, x, y, rows, pal, { scale = 1, flip = false } = {}) {
  rows.forEach((row, j) => {
    const chars = [...row];
    chars.forEach((ch, i) => {
      const c = pal[ch];
      if (!c) return;
      const ix = flip ? chars.length - 1 - i : i;
      img.rect(x + ix * scale, y + j * scale, scale, scale, c);
    });
  });
}

// ---------- PNG ----------

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Filters each scanline with the PNG filter (0..4) that gives the smallest absolute sum. */
function filterRows(rows, bpp) {
  const out = [];
  let prev = Buffer.alloc(rows[0].length);
  for (const row of rows) {
    let best = null;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const line = Buffer.alloc(row.length + 1);
      line[0] = f;
      let score = 0;
      for (let i = 0; i < row.length; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let p = 0;
        if (f === 1) p = a;
        else if (f === 2) p = b;
        else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i] - p) & 255;
        line[i + 1] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = line;
      }
    }
    out.push(best);
    prev = row;
  }
  return Buffer.concat(out);
}

/** Encodes an Img as PNG bytes. Fully transparent pixels are normalised to 0,0,0,0. */
export function encodePng(img) {
  const { w, h, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const key = (i) => (data[i + 3] === 0 ? 0 : ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0);
  const colours = new Map();
  for (let i = 0; i < data.length && colours.size <= 256; i += 4) {
    const k = key(i);
    if (!colours.has(k)) colours.set(k, colours.size);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (colours.size <= 256) {
    // Indexed: palette sorted so opaque entries come last and tRNS stays short.
    const entries = [...colours.keys()].sort((a, b) => (a & 255) - (b & 255) || a - b);
    const index = new Map(entries.map((k, i) => [k, i]));
    const plte = Buffer.alloc(entries.length * 3);
    const trns = [];
    entries.forEach((k, i) => {
      plte[i * 3] = k >>> 24;
      plte[i * 3 + 1] = (k >>> 16) & 255;
      plte[i * 3 + 2] = (k >>> 8) & 255;
      if ((k & 255) < 255) trns.push(k & 255);
    });
    ihdr[9] = 3;
    const rows = [];
    for (let y = 0; y < h; y++) {
      const row = Buffer.alloc(w);
      for (let x = 0; x < w; x++) row[x] = index.get(key((y * w + x) * 4));
      rows.push(row);
    }
    const parts = [sig, chunk('IHDR', ihdr), chunk('PLTE', plte)];
    if (trns.length) parts.push(chunk('tRNS', Buffer.from(trns)));
    parts.push(chunk('IDAT', deflateSync(filterRows(rows, 1), { level: 9 })), chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(parts);
  }
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 4);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;
      row[x * 4] = data[i];
      row[x * 4 + 1] = data[i + 1];
      row[x * 4 + 2] = data[i + 2];
      row[x * 4 + 3] = data[i + 3];
    }
    rows.push(row);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(filterRows(rows, 4), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Decodes an 8-bit RGBA or indexed PNG (the two formats encodePng writes). */
export function decodePng(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  let plte = null;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const t = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (t === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      type = body[9];
    } else if (t === 'PLTE') plte = body;
    else if (t === 'tRNS') trns = body;
    else if (t === 'IDAT') idat.push(body);
    pos += len + 12;
  }
  const bpp = type === 3 ? 1 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const pixels = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? pixels[y * stride + i - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? pixels[(y - 1) * stride + i - bpp] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + i] = (v + p) & 255;
    }
  }
  const img = new Img(w, h);
  for (let i = 0; i < w * h; i++) {
    if (type === 3) {
      const k = pixels[i];
      img.data[i * 4] = plte[k * 3];
      img.data[i * 4 + 1] = plte[k * 3 + 1];
      img.data[i * 4 + 2] = plte[k * 3 + 2];
      img.data[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255;
    } else pixels.copy(img.data, i * 4, i * 4, i * 4 + 4);
  }
  return img;
}
