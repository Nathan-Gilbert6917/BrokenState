// A painter's grid (ui/sprites.js painter: p.px a hex colour or null a pixel, p.w × p.h) as a PNG file, with the
// sprites' outline (every empty pixel touching a painted one, as toCanvas draws it) and nearest-neighbour upscaling,
// without a browser: the sheet tools (tools/weaponsheet.js) write pictures from Node. Pure zlib and the PNG chunks.
import { deflateSync } from "node:zlib";

const OUTLINE = [0x0b, 0x0c, 0x0e, 255];
const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, "latin1"), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(data.length); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); };
const hex = (s) => { const h = String(s).replace("#", ""); const n = parseInt(h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255]; };

/** An RGBA buffer (w × h × 4) from a painter, outlined like toCanvas, or from rgba data already. */
export function rgbaOf(p, outline = true) {
  const W = p.w, H = p.h, out = Buffer.alloc(W * H * 4);
  const get = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? p.px[y * W + x] : null);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = get(x, y), i = (y * W + x) * 4;
    if (c) { const [r, g, b, a] = hex(c); out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a; }
    else if (outline && (get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1))) out.set(OUTLINE, i);
  }
  return out;
}
/** PNG bytes of an RGBA buffer scaled up `up` times (nearest neighbour). */
export function pngOf(rgba, w, h, up = 1) {
  const W = w * up, H = h * up, raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    const sy = Math.floor(y / up);
    for (let x = 0; x < W; x++) { const sx = Math.floor(x / up), i = (sy * w + sx) * 4, j = y * (W * 4 + 1) + 1 + x * 4; raw[j] = rgba[i]; raw[j + 1] = rgba[i + 1]; raw[j + 2] = rgba[i + 2]; raw[j + 3] = rgba[i + 3]; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
/** A painter as a PNG, outlined, scaled up. */
export const painterPNG = (p, up = 4, outline = true) => pngOf(rgbaOf(p, outline), p.w, p.h, up);
/** A sheet: pictures (each { rgba, w, h }) laid out in a grid of `cols` with a gap, on a background colour (or clear). */
export function sheetPNG(cells, cols, up = 1, gap = 4, bg = null) {
  const cw = Math.max(...cells.map((c) => c.w)), ch = Math.max(...cells.map((c) => c.h)), rows = Math.ceil(cells.length / cols);
  const W = cols * (cw + gap) + gap, H = rows * (ch + gap) + gap, buf = Buffer.alloc(W * H * 4);
  if (bg) { const [r, g, b] = hex(bg); for (let i = 0; i < W * H; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; } }
  cells.forEach((c, k) => {
    const x0 = gap + (k % cols) * (cw + gap) + Math.floor((cw - c.w) / 2), y0 = gap + Math.floor(k / cols) * (ch + gap) + (ch - c.h);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const i = (y * c.w + x) * 4; if (c.rgba[i + 3]) buf.set(c.rgba.subarray(i, i + 4), ((y0 + y) * W + x0 + x) * 4); }
  });
  return pngOf(buf, W, H, up);
}
