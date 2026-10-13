// Node-only: write a painter, or a labelled sheet of painters, as a PNG (zlib, no dependencies).
//   node -e 'import("./hdpng.js").then(m => ...)'  or  node design/hd/render.js <set>
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { painter, outline } from "./hdcore.js";

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// rgba: Uint8Array w*h*4.
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy ? Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1) : raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const hex2 = (hex) => { const h = hex.replace("#", ""); const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h; const n = parseInt(s.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, s.length === 8 ? parseInt(s.slice(6), 16) : 255]; };

// A painter to RGBA at `up` pixels a grid pixel over a background (null: transparent).
export function rasterize(p, up = 1, bg = null) {
  const w = p.w * up, h = p.h * up, out = new Uint8Array(w * h * 4);
  if (bg) { const [r, g, b, a] = hex2(bg); for (let i = 0; i < w * h; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a; } }
  for (const [x, y, col] of p.pixels()) {
    const [r, g, b, a] = hex2(col);
    for (let dy = 0; dy < up; dy++) for (let dx = 0; dx < up; dx++) { const i = ((y * up + dy) * w + x * up + dx) * 4; out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a; }
  }
  return { w, h, rgba: out };
}
export function writePNG(path, p, up = 1, bg = null) { const { w, h, rgba } = rasterize(p, up, bg); writeFileSync(path, encodePNG(w, h, rgba)); return path; }

// ---------- a 3 × 5 pixel font for the sheets' labels ----------
const F = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100", Q: "010101101111011", R: "110101110101101", S: "011100010001110", T: "111010010010010", U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010", Z: "111001010100111",
  0: "010101101101010", 1: "010110010010111", 2: "110001010100111", 3: "110001010001110", 4: "101101111001001", 5: "111100110001110", 6: "011100110101010", 7: "111001010010010", 8: "010101010101010", 9: "010101011001110",
  " ": "000000000000000", "-": "000000111000000", ".": "000000000000010", "/": "001001010100100", ":": "000010000010000", "(": "001010010010001", ")": "100010010010100", "+": "000010111010000", "×": "000101010101000", "'": "010010000000000", ",": "000000000010100", "%": "101001010100101", "=": "000111000111000", "?": "110001010000010", "!": "010010010000010", "_": "000000000000111", "&": "010101010101011", "#": "101111101111101", "*": "000101010101000", "·": "000000010000000",
};
export function text(p, x, y, s, col = "#e6e2d8") {
  for (const ch of String(s).toUpperCase()) {
    const g = F[ch] || F["?"];
    for (let i = 0; i < 15; i++) if (g[i] === "1") p.set(x + (i % 3), y + Math.floor(i / 3), col);
    x += 4;
  }
  return x;
}
export const textWidth = (s) => String(s).length * 4 - 1;

// A labelled sheet: cells = [{ label, paint }] (paint() -> painter; or { label, p }), laid out `cols` wide, each
// cell `up` × its painter, with the label under it. Painters may differ in size; cells take the largest.
// Returns a painter (so a sheet can be written with writePNG(path, sheet, 1)).
export function sheet(cells, { cols = 8, up = 4, pad = 6, bg = "#1b1e24", labelCol = "#cfc9bb", title = "", outlined = true, cellBg = null } = {}) {
  const ps = cells.map((c) => { const p = c.p || c.paint(); return outlined ? outline(p) : p; });
  const cw = Math.max(...ps.map((p) => p.w)), ch = Math.max(...ps.map((p) => p.h));
  const cellW = Math.max(cw * up, ...cells.map((c) => textWidth(c.label || "") + 2)), cellH = ch * up + 8;
  cols = Math.max(1, Math.min(cols, cells.length));
  const rows = Math.ceil(cells.length / cols);
  const W = pad + cols * (cellW + pad), H = pad + (title ? 10 : 0) + rows * (cellH + pad);
  const out = painter(W, H);
  out.rect(0, 0, W - 1, H - 1, bg);
  let y0 = pad;
  if (title) { text(out, pad, y0, title, "#e2b85c"); y0 += 10; }
  cells.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = pad + col * (cellW + pad), y = y0 + row * (cellH + pad);
    if (cellBg) out.rect(x, y, x + cellW - 1, y + ch * up - 1, cellBg);
    const p = ps[i];
    const ox = x + Math.floor((cellW - p.w * up) / 2), oy = y + (ch - p.h) * up;
    for (const [px, py, cc] of p.pixels()) out.rect(ox + px * up, oy + py * up, ox + px * up + up - 1, oy + py * up + up - 1, cc);
    if (c.label) text(out, x + Math.floor((cellW - textWidth(c.label)) / 2), y + ch * up + 2, c.label, labelCol);
  });
  return out;
}
