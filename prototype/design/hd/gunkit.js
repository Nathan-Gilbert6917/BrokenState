// The HD gun kit (design preview only: src/ is unchanged): materials and the shape helpers the HD gun bodies
// (design/hd/guns.js) and parts (design/hd/gunparts-hd.js) are drawn with, on the 128 × 48 grid (twice ui/gunart.js's
// 64 × 24: the same on-screen size in the builder at 4×, four times the pixels).
//
// Style: the item icons' (design/hd/items.js, design/hd/STYLE.md), the set the user approved. Every material is one
// of items.js's 4-tone PAL ramps [dark, mid, light, specular] (iron / black for guns, steel for bright metal and
// stainless, wood / ash for furniture, olive / coyote for OD and FDE, glass for lenses, brass), or kit.js ramp(hex)
// for a colour the game picks that PAL has no name for. A form is filled with its mid tone, lit along its upper-left
// rim, dark along its lower-right rim (2 px on wide forms), with one specular line along a top edge or a barrel.
// Inner lines only where two forms overlap, in the dark tone of the form behind; never black inside (the outer rim
// comes from hdcore outline(), like the game's toCanvas). No dithering. Colours are asked for by the game's names
// (ui/gunpaint.js C), so a finish's colours (sim/data-finish.js through gunpaint.js norm) carry straight over.
import { shade, mix } from "./hdcore.js";
import { PAL } from "./items.js";
import { ramp } from "./kit.js";
import { C } from "../../src/ui/gunpaint.js";

export { PAL };
export const col = (c, d = C.gun) => (c == null ? d : C[c] || c);
// A game colour name (or hex) -> an items.js ramp.
const BY_NAME = {
  gun: "iron", dark: "iron", hi: "iron", hg: "black", blued: "iron", bluedL: "iron", metal: "steel", steel: "steel", nickel: "steel", nickelD: "steel", "#b3b9be": "steel",
  clear: "white", clearD: "white", grey: "grey", greyL: "grey", pipe: "grey", case: "steel", caseL: "steel",
  poly: "black", polyL: "black", rubber: "black",
  wood: "wood", woodD: "wood", walnut: "wood", walnutL: "wood", board: "wood", woodL: "ash", "#6d5f52": "canvas",
  olive: "olive", oliveL: "olive", od: "olive", odL: "olive", odD: "olive", "#4b5340": "olive", "#5f6b4a": "olive", "#3d4a2e": "olive",
  fde: "coyote", fdeL: "coyote", fdeD: "coyote", tan: "coyote", tanD: "coyote", sling: "leather", plum: null, rust: "rust",
  glass: "glass", red: "red", glow: "green", blue: "blue", bottle: "bottle", brass: "brass", shell: "red",
};
const WOODS = new Set(["wood", "woodD", "woodL", "walnut", "walnutL", "board", "#6d5f52"]);
export const isWood = (name) => WOODS.has(name);
const CACHE = new Map();
// M(name): the ramp [dark, mid, light, specular] for a game colour name or hex (PAL by name, else ramp(hex)).
export function M(name) {
  if (Array.isArray(name)) return name;
  const key = String(name);
  if (CACHE.has(key)) return CACHE.get(key);
  const pal = BY_NAME[key];
  let m = pal ? PAL[pal] : null;
  if (!m) { const hex = col(key); m = key === "case" ? PAL.steel : ramp(hex, { spec: 0.55, dark: 0.45, lite: 0.26 }); }
  if (key === "blued") m = ramp(C.blued, { spec: 0.5, dark: 0.42, lite: 0.22 }); // the blued finish: a bluer iron
  if (key === "case") m = ["#4a5058", "#7f8a93", "#b5bfc6", "#e9eef2"]; // case colours: steel with a touch of blue
  CACHE.set(key, m);
  return m;
}
export const IRON = PAL.iron, STEEL = PAL.steel, BLACK = PAL.black, WOOD = PAL.wood, ASH = PAL.ash, OLIVE = PAL.olive, COYOTE = PAL.coyote, GLASS = PAL.glass, BRASS = PAL.brass, RED = PAL.red, GREY = PAL.grey;
// The shadow tone of a material: the dark tone a shade cooler, for the line where another form sits over it.
export const deep = (m) => mix(shade(m[0], -0.3), "#1c2230", 0.25);

// ---------- shapes (coordinates inclusive, in grid pixels; m is a 4-tone ramp) ----------
const nz = (p, x0, y0, x1, y1, c) => p.rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), c);
export const R = nz;
export const H = (p, x0, x1, y, c) => nz(p, x0, y, x1, y, c);
export const V = (p, x, y0, y1, c) => nz(p, x, y0, x, y1, c);
export const dots = (p, x0, x1, y, c, step = 2) => { for (let x = x0; x <= x1; x += step) p.set(x, y, c); };
export const vdots = (p, x, y0, y1, c, step = 2) => { for (let y = y0; y <= y1; y += step) p.set(x, y, c); };
const isMetal = (m) => m === PAL.iron || m === PAL.steel || m === PAL.grey || m === PAL.brass || m[3] === M("blued")[3] || m[3] === M("case")[3];

// A lit block (items.js box): light top row and left column, dark bottom row and right column (2 px on a tall or
// long form), a specular line inside the top edge on metal. o: { spec (force / forbid), noTop, noBottom, noLeft, noRight, wide }.
export function box(p, x0, y0, x1, y1, m, o = {}) {
  nz(p, x0, y0, x1, y1, m[1]);
  const tall = y1 - y0 >= 5, long = x1 - x0 >= 10;
  if (!o.noBottom) { H(p, x0, x1, y1, m[0]); if (tall && (o.wide || long)) H(p, x0 + 1, x1, y1 - 1, m[0]); }
  if (!o.noRight) { V(p, x1, y0, y1, m[0]); if (tall && o.wide) V(p, x1 - 1, y0 + 1, y1, m[0]); }
  if (!o.noTop) H(p, x0, x1 - (o.noRight ? 0 : 1), y0, m[2]);
  if (!o.noLeft) V(p, x0, y0, y1 - (o.noBottom ? 0 : 1), m[2]);
  const spec = o.spec != null ? o.spec : isMetal(m);
  if (spec && !o.noTop) H(p, x0 + (o.noLeft ? 0 : 1), x1 - (o.noRight ? 1 : 1), y0, m[3]);
}
// A lying cylinder (items.js hcyl): light top row, the specular under it, two dark rows at the bottom; ends capped dark.
export function cyl(p, x0, x1, y0, y1, m, o = {}) {
  nz(p, x0, y0, x1, y1, m[1]);
  const n = y1 - y0 + 1;
  H(p, x0, x1, y0, m[2]);
  if (n >= 3 && o.spec !== false) H(p, x0 + 1, x1 - 1, y0 + 1, m[3]);
  H(p, x0, x1, y1, m[0]);
  if (n >= 4) H(p, x0, x1, y1 - 1, m[0]);
  if (o.capL) V(p, x0, y0, y1, m[0]);
  if (o.capR !== false) V(p, x1, y0 + (n >= 3 ? 1 : 0), y1, m[0]);
}
// A standing cylinder (items.js vcyl): light left column with a specular, two dark columns on the right.
export function vcyl(p, x0, x1, y0, y1, m, o = {}) {
  nz(p, x0, y0, x1, y1, m[1]);
  const n = x1 - x0 + 1;
  V(p, x0, y0, y1, m[2]);
  if (n >= 4 && o.spec !== false) V(p, x0 + 1, y0 + 1, y1 - 1, m[3]);
  V(p, x1, y0, y1, m[0]);
  if (n >= 4) V(p, x1 - 1, y0, y1, m[0]);
  if (o.capB !== false) H(p, x0, x1, y1, m[0]);
}
// Wood grain: two broken lines in the dark tone along a wooden form (deterministic).
export function grain(p, x0, x1, y0, y1, m, seed = 0) {
  if (y1 - y0 < 3) { for (let x = x0 + 1; x < x1; x += 4) p.over(x, y0 + 1, m[0]); return; }
  const rows = [y0 + Math.round((y1 - y0) * 0.4), y0 + Math.round((y1 - y0) * 0.75)];
  rows.forEach((ry, i) => { for (let x = x0 + 1; x < x1; x++) { const ph = (x + seed * 3 + i * 5) % 13; if (ph < 8) { const yy = ry + (ph > 5 ? 1 : 0); if (p.get(x, yy) === m[1]) p.set(x, yy, m[0]); } } });
}
// A picatinny rail: x0..x1 at row y (teeth: light / dark every other pixel) and y + 1 (the base).
export function rail(p, x0, x1, y, m = IRON, rows = 2) {
  nz(p, x0, y, x1, y + rows - 1, m[1]);
  for (let x = x0; x <= x1; x += 2) { p.set(x, y, m[2]); if (x + 1 <= x1) p.set(x + 1, y, m[0]); }
  if (rows > 1) H(p, x0, x1, y + rows - 1, m[0]);
}
// A pistol grip: n rows from (x, y) down, w wide, its back sloping `slope` pixels over its length; light front edge,
// dark back edge, ribbed every 3 rows. o: { slope, ribs, panel (a ramp: an inset panel), light (rib tone) }.
export function gripHD(p, x, y, n, w, m, o = {}) {
  const slope = o.slope == null ? Math.round(n * 0.4) : o.slope;
  for (let i = 0; i < n; i++) {
    const s = x - Math.round((i * slope) / Math.max(1, n - 1)), last = i === n - 1;
    H(p, s, s + w - 1, y + i, m[1]);
    p.set(s, y + i, m[2]); p.set(s + w - 1, y + i, m[0]); if (w > 4) p.set(s + w - 2, y + i, m[0]);
    if (last) H(p, s, s + w - 1, y + i, m[0]);
    else if (i > 1 && i % 3 === 0 && o.ribs !== false) H(p, s + 1, s + w - (w > 4 ? 3 : 2), y + i, o.light ? m[2] : m[0]);
  }
  if (o.panel) { const pm = o.panel; for (let i = 2; i < n - 2; i++) { const s = x - Math.round((i * slope) / Math.max(1, n - 1)); H(p, s + 1, s + w - 2, y + i, pm[1]); p.set(s + 1, y + i, pm[2]); if (i % 4 === 2) H(p, s + 2, s + w - 3, y + i, pm[0]); if (i === n - 3) H(p, s + 1, s + w - 2, y + i, pm[0]); } }
}
// A trigger guard under the receiver from x0 to x1 (y: the receiver's bottom row), the trigger inside it.
export function guardHD(p, x0, x1, y, m = IRON, o = {}) {
  const d = o.depth || 5;
  V(p, x0, y + 1, y + d - 1, m[1]); p.set(x0, y + 1, m[2]); // the front post
  H(p, x0, x1, y + d, m[1]); H(p, x0 + 1, x1, y + d + 1, m[0]); // the bow
  V(p, x1, y + 1, y + d, m[1]); V(p, x1 + 1, y + 1, y + d, m[0]); // the back, into the grip
  p.set(x0 + 3, y + 1, STEEL[1]); p.set(x0 + 3, y + 2, STEEL[2]); p.set(x0 + 3, y + 3, STEEL[1]); p.set(x0 + 2, y + 4, STEEL[0]); // the trigger
}
// A stock reaching back from (x, y), where it meets the receiver (rows y - 2 .. y + 2 there): len columns, its top and
// bottom rows at the butt. o: { pad (a ramp: a 2-column buttpad), grain, cheek (a lighter comb) }. Returns the rows per column.
export function stockHD(p, x, y, len, top, bot, m, o = {}) {
  const ys = [];
  for (let i = 0; i < len; i++) {
    const u = len > 1 ? i / (len - 1) : 0;
    const yt = Math.round(y - 2 + (top - (y - 2)) * u), yb = Math.round(y + 2 + (bot - (y + 2)) * u);
    ys.push([yt, yb]);
    V(p, x - i, yt, yb, m[1]);
    p.set(x - i, yt, m[2]);
    p.set(x - i, yb, m[0]); if (yb - yt > 4) p.set(x - i, yb - 1, m[0]);
  }
  if (isMetal(m)) for (let i = 1; i < len - 1; i++) p.set(x - i, ys[i][0], m[3]);
  if (o.grain) for (let i = 2; i < len - 3; i++) { const [yt, yb] = ys[i]; const mid = Math.floor((yt + yb) / 2); if ((i + 1) % 9 < 6) p.set(x - i, mid + Math.floor(((i + 3) % 12) / 6), m[0]); if ((i + 5) % 10 < 6 && yb - mid > 2) p.set(x - i, Math.floor((mid + yb) / 2) + 1, m[0]); }
  if (o.cheek) for (let i = Math.floor(len * 0.25); i < Math.floor(len * 0.72) && i < len; i++) p.set(x - i, ys[i][0], m[3]);
  if (o.pad) { const [yt, yb] = ys[len - 1]; nz(p, x - len - 1, yt, x - len, yb, o.pad[1]); V(p, x - len - 1, yt, yb, o.pad[0]); p.set(x - len, yt, o.pad[2]); for (let yy = yt + 2; yy < yb; yy += 3) p.set(x - len, yy, o.pad[0]); }
  return ys;
}
// A magazine: n rows from (x, y) down, w wide, sloping forward a pixel every `curve` rows (0: straight); a floor
// plate (2 rows), witness holes up the back and ribs on a steel one. Returns [x, y] of its floor's front corner.
export function magHD(p, x, y, n, w, m, curve = 0, o = {}) {
  let sx = x;
  for (let i = 0; i < n; i++) {
    const s = x + (curve ? Math.floor(i / curve) : 0); sx = s;
    H(p, s, s + w - 1, y + i, m[1]);
    p.set(s, y + i, m[2]); p.set(s + w - 1, y + i, m[0]); if (w > 4) p.set(s + w - 2, y + i, m[0]);
    if (o.ribs && i % 4 === 2 && i < n - 3) H(p, s + 1, s + w - 3, y + i, m[0]);
    if (o.holes !== false && i % 4 === 1 && i < n - 3 && w > 3) p.set(s + 1, y + i, m[0]); // witness holes
  }
  const fm = o.floor || IRON;
  H(p, sx, sx + w - 1, y + n - 1, fm[0]); H(p, sx, sx + w - 1, y + n - 2, fm[1]); p.set(sx, y + n - 2, fm[2]);
  return [sx, y + n - 1];
}
// The line where a form sits over another: the dark tone of the one behind, over painted pixels only.
export const shadow = (p, x0, x1, y, m = IRON) => { for (let x = x0; x <= x1; x++) p.over(x, y, m[0]); };
// A screw / pin head: a 2 × 2 with a lit corner.
export const pin = (p, x, y, m = IRON) => { p.set(x, y, m[2]); p.set(x + 1, y, m[0]); p.set(x, y + 1, m[0]); p.set(x + 1, y + 1, m[0]); };
// A lens seen from the side: a glass column with its reflection at the top.
export const lensV = (p, x, y0, y1) => { V(p, x, y0, y1, GLASS[1]); p.set(x, y0, GLASS[2]); if (y1 - y0 >= 2) p.set(x, y0 + 1, GLASS[3]); p.set(x, y1, GLASS[0]); };
// A lens seen face on (a reflex sight's window): glass with one reflection pixel at the upper left.
export const lensF = (p, x0, y0, x1, y1) => { nz(p, x0, y0, x1, y1, GLASS[1]); H(p, x0, x1, y1, GLASS[0]); V(p, x1, y0, y1, GLASS[0]); p.set(x0, y0, GLASS[3]); if (x1 > x0) p.set(x0 + 1, y0, GLASS[2]); };
