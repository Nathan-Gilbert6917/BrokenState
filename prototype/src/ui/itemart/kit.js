// The item icons' drawing kit (ui/itemart.js): every item that is not a gun has its own 16 × 16 pixel drawing, in the
// sprites' style (ui/sprites.js painter / toCanvas: flat colours, a highlight and a shade, the dark outline added by
// toCanvas). A family file (ui/itemart/*.js) exports GEAR_ART (GEAR keys) and SUPPLY_ART (SUPPLIES keys): key →
// (p, key) => void, drawing on a 16 × 16 painter (x 0..15 left to right, y 0..15 top to bottom). Nothing is drawn per
// frame: ui/itemart.js caches each picture by its key.
// Rules for a drawing: read at about 20 px; fill a good part of the grid (a small thing, a ring or a pill, still about
// 8 px across); one light from the top left (highlight on the top / left edges, shade on the bottom / right); no
// outline colour of its own (toCanvas outlines every drawn pixel); every item its own picture (tools/itemarttest.js
// checks that no two items are the same or nearly the same).
import { C as GC, R, H, V, dots } from "../gunpaint.js";
export { R, H, V, dots };

export const C = {
  ...GC,
  // paper, cloth and the household
  paper: "#e8e0c8", paperD: "#c9bf9f", paperL: "#f6f1e2", ink: "#2a2d33", card: "#b8a27a", cardD: "#957f58",
  white: "#eef0f2", whiteD: "#c7cbd0", black: "#202226", blackL: "#383b41",
  red: "#c8402f", redD: "#8e2a20", redL: "#e2654f", orange: "#d9772a", orangeD: "#a85718", yellow: "#e6c23a", yellowD: "#b8952a",
  green: "#4f8a3a", greenD: "#356127", greenL: "#6faa52", leaf: "#5f9a3c", leafD: "#3f6a28", blue: "#3a6fb0", blueD: "#284e7e",
  blueL: "#5f93cf", cyan: "#4fb3c2", purple: "#7a4f9a", purpleD: "#56376d", pink: "#d77a9a", brown: "#7a5230", brownD: "#563820",
  brownL: "#9a6d44", khaki: "#a39a6a", khakiD: "#7f7750", cloth: "#5a6470", clothD: "#424a54", denim: "#3f5f86",
  gold: "#d9b13b", goldD: "#a8842a", goldL: "#f2d36a", silver: "#c9ced3", silverD: "#9aa1a8", copper: "#b8693a", copperD: "#8a4c28",
  skin: "#d9a77c", flesh: "#c9705f", bone: "#e2d8bf", water: "#5fa8d8", waterD: "#3d7fb0", glassG: "#5f9a7a", glassB: "#6f4a2a",
  meat: "#b5463a", meatL: "#d46a5a", fat: "#efd2c0", bread: "#c98a44", breadD: "#9a6430", cheese: "#e8c446", egg: "#efe6d2",
  fire: "#f08a24", fireL: "#ffd04a", smoke: "#9aa0a8", clay: "#b06a46", rope: "#b89a62", ropeD: "#8a7244", rubber: "#1f1f22",
};

// A colour lighter (f > 0) or darker (f < 0) by a fraction.
// The figures (ui/figures.js) shade every pixel they paint, so the common case (a colour string and a finite
// fraction) keeps each colour's parse (RGB: the string -> its 0xrrggbb, or -1 when it is no colour; a few hundred
// colours are in play, and a full table is simply emptied) and writes the channels through a table of two-digit hex
// strings. The channel maths is the same float expression with the same Math.round, so the colour is the same string.
const RGB = new Map(), HEX2 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
export function shade(hex, f) {
  if (typeof hex !== "string" || typeof f !== "number" || !Number.isFinite(f)) return shadeAny(hex, f);
  let n = RGB.get(hex);
  if (n === undefined) {
    const h = hex.replace("#", "");
    n = /^[0-9a-f]{6}$/i.test(h) ? parseInt(h, 16) : -1;
    if (RGB.size >= 4096) RGB.clear();
    RGB.set(hex, n);
  }
  if (n < 0) return hex;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, m = 1 + f;
  if (f < 0) return `#${HEX2[Math.max(0, Math.min(255, Math.round(r * m)))]}${HEX2[Math.max(0, Math.min(255, Math.round(g * m)))]}${HEX2[Math.max(0, Math.min(255, Math.round(b * m)))]}`;
  return `#${HEX2[Math.max(0, Math.min(255, Math.round(r + (255 - r) * f)))]}${HEX2[Math.max(0, Math.min(255, Math.round(g + (255 - g) * f)))]}${HEX2[Math.max(0, Math.min(255, Math.round(b + (255 - b) * f)))]}`;
}
// Any other input, as shade always did (a number for a colour, a fraction that is not a finite number).
function shadeAny(hex, f) {
  const h = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  const n = parseInt(h, 16), v = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => (f < 0 ? x * (1 + f) : x + (255 - x) * f));
  return `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
}
// A straight line (Bresenham).
export function line(p, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    p.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// A filled disc and a ring (radius r, centre on a pixel; r + 0.5 rounds them off).
export function disc(p, cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) p.set(cx + x, cy + y, c); }
export function ring(p, cx, cy, r, c) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = x * x + y * y; if (d <= r * r + r && d > (r - 1) * (r - 1) + (r - 1)) p.set(cx + x, cy + y, c); }
}
// A filled ellipse in the box x0..x1, y0..y1.
export function oval(p, x0, y0, x1, y1, c) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) p.set(x, y, c);
}
// A lit box: the face in c, its top row and left column in hi, its bottom row and right column in lo (null: none).
export function box(p, x0, y0, x1, y1, c, hi = shade(c, 0.22), lo = shade(c, -0.3)) {
  R(p, x0, y0, x1, y1, c);
  if (hi) { H(p, x0, x1 - 1, y0, hi); V(p, x0, y0, y1 - 1, hi); }
  if (lo) { H(p, x0, x1, y1, lo); V(p, x1, y0, y1, lo); }
}
// Every drawn pixel of a colour swapped for another (a recolour of a shared drawing).
export function swap(p, from, to) { for (let i = 0; i < p.px.length; i++) if (p.px[i] === from) p.px[i] = to; }
// Mirror the drawing left to right.
export function flipX(p) { for (let y = 0; y < p.h; y++) { const row = p.px.slice(y * p.w, (y + 1) * p.w).reverse(); for (let x = 0; x < p.w; x++) p.px[y * p.w + x] = row[x]; } }
// A tiny 3 × 5 pixel font for labels on boxes and books (digits, capitals and a few signs).
const FONT = {
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001", 5: "111100111001111",
  6: "111100111101111", 7: "111001010010010", 8: "111101111101111", 9: "111101111001111", A: "010101111101101", B: "110101110101110",
  C: "011100100100011", D: "110101101101110", E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101",
  O: "010101101101010", P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010", Z: "111001010100111",
  ".": "000000000000010", "+": "000010111010000", "-": "000000111000000", "/": "001001010100100", "x": "000101010101000",
};
// Text in the 3 × 5 font from (x, y) (its top left), a column between letters; returns the x after it.
export function text(p, x, y, s, c) {
  for (const ch of String(s).toUpperCase()) {
    const g = FONT[ch];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === "1") p.set(x + (i % 3), y + Math.floor(i / 3), c);
    x += 4;
  }
  return x;
}
// A row map, for small hand-drawn shapes: rows of characters from (x, y), each character a colour from the key ("."
// or " " is empty). E.g. stamp(p, 4, 2, ["..aa", ".abba"], { a: C.red, b: C.redL }).
export function stamp(p, x, y, rows, key) {
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = key[row[i]]; if (c) p.set(x + i, y + j, c); } });
}
