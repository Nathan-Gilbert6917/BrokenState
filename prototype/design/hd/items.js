// HD item icons (design preview only: the game still shows emoji in the inventory). Every icon is painted on a
// 32 × 32 grid with the hdcore painter, the object large (24–28 px), in a slight 3/4 or side view like classic RPG
// inventory icons, lit from the upper left. Guns keep their own 64 × 24 art (ui/gunart.js): none are drawn here.
//
//   paintItemHD(key)  -> a 32 × 32 painter for a GEAR key (its own drawing, else a category fallback), or null
//   ITEM_ART          -> the registry of own drawings, by GEAR key (the supplies' keys too: food, water, ...)
//   SHEET             -> the design sheet: node design/hd/render.js items 4
//
// Materials are 4 tones each (dark, mid, light, specular) from the shared PAL below; shapes are filled with the mid
// tone, their upper-left edge lit, their lower-right edge dark, one specular line or dot where it helps. Inner
// outlines are only where two parts of one material meet. The outer outline is added by outline() when rendered.
import { painter, mix, shade } from "./hdcore.js";
import { GEAR } from "../../src/sim/data.js";

// ---------- the shared palette: [dark, mid, light, specular] ----------
export const PAL = {
  steel:   ["#3a3f47", "#6f777f", "#a3abb3", "#e3e8ec"], // bright steel: blades, tools, cans
  iron:    ["#1f2225", "#3a3e44", "#575c63", "#8a9097"], // blackened steel: pipes, crowbars, gun parts
  rust:    ["#4e2f1c", "#7a4a2a", "#a0683a", "#c08a55"],
  wood:    ["#3f2714", "#6a4324", "#8c5c33", "#ad7d4d"], // dark hardwood: handles, book spines
  ash:     ["#6b5134", "#9a7a4e", "#c2a26f", "#dcc48f"], // pale wood: a bat, a spear shaft, splints
  olive:   ["#2b3023", "#444c36", "#5c6747", "#78845e"], // military nylon and canvas
  black:   ["#141518", "#262a2f", "#3b4046", "#5a6068"], // black nylon, rubber, plastic
  coyote:  ["#5e4a2e", "#86693f", "#a98a58", "#c4a975"], // tan nylon
  leather: ["#35200f", "#5a3519", "#7a4c26", "#9a6a3a"],
  canvas:  ["#4e4a3a", "#746d55", "#948b6c", "#b1a888"], // undyed canvas, cardboard
  red:     ["#6e1717", "#a82424", "#d33a3a", "#ef7070"], // the medical cross, fuel, an axe head
  yellow:  ["#7d5e0c", "#c49a18", "#e8c232", "#f7e483"], // warning yellow
  orange:  ["#7f3a0d", "#c45d1b", "#e8822f", "#f5ad64"],
  brass:   ["#5f4512", "#9b7622", "#c9a24a", "#ebd283"],
  copper:  ["#5a2e14", "#9a5424", "#c47a3a", "#e0a56a"],
  glass:   ["#2f5f80", "#5d9bc2", "#95cbe6", "#e6f7fd"], // clear glass and lenses
  white:   ["#7e8288", "#afb3b9", "#d8dbdf", "#f8f9fa"], // white plastic, gauze, paper labels
  green:   ["#17381f", "#2a6235", "#3c8a4b", "#79bb84"],
  blue:    ["#1a3357", "#2d5485", "#4a7fb8", "#8fb8e0"],
  board:   ["#1c4a3a", "#2a6e52", "#3e9070", "#6fc19a"], // a circuit board's solder mask
  paper:   ["#9a917a", "#c6bca0", "#e4dcc3", "#f6f1e3"],
  amber:   ["#5a2c0a", "#9a5214", "#c8782a", "#e9a55a"], // whiskey, pill bottles, varnish
  flame:   ["#b32a12", "#e8641c", "#f6a52a", "#fbe67a"],
  gold:    ["#7a5410", "#b8861e", "#e0ad3a", "#f8e08a"],
  grey:    ["#4a4f56", "#767c84", "#a1a7ae", "#c9ced3"], // grey plastic and galvanised sheet
  navy:    ["#15192a", "#232a44", "#36405f", "#56638a"], // dark blue cloth (police kit)
  bottle:  ["#1d3d26", "#2f6a3c", "#4d8e58", "#9fd2a4"], // green bottle glass
};
const DARK = "#0b0c0e";

// ---------- shape helpers (all in grid pixels; m is a 4-tone material) ----------
const r2 = Math.round;
// A lit block: light top row and left column, dark bottom row and right column; top: rows of a top face.
function box(p, x0, y0, x1, y1, m, top = 0) {
  p.rect(x0, y0, x1, y1, m[1]);
  p.hl(x0, x1, y0, m[2]); p.vl(x0, y0, y1, m[2]);
  p.hl(x0, x1, y1, m[0]); p.vl(x1, y0, y1, m[0]);
  if (top) { p.rect(x0, y0, x1, y0 + top - 1, m[2]); p.hl(x0 + 1, x1 - 1, y0, m[3]); }
}
// A standing cylinder: a lit left side with a specular line, a dark right side.
function vcyl(p, x0, y0, x1, y1, m) {
  p.rect(x0, y0, x1, y1, m[1]);
  p.vl(x0, y0, y1, m[2]); p.vl(x0 + 1, y0, y1, m[3]);
  p.vl(x1 - 1, y0, y1, m[0]); p.vl(x1, y0, y1, m[0]);
}
// A lying cylinder: lit top rows, dark bottom rows.
function hcyl(p, x0, y0, x1, y1, m) {
  p.rect(x0, y0, x1, y1, m[1]);
  p.hl(x0, x1, y0, m[2]); p.hl(x0, x1, y0 + 1, m[3]);
  p.hl(x0, x1, y1 - 1, m[0]); p.hl(x0, x1, y1, m[0]);
}
// A bar from (x0, y0) to (x1, y1) with a width of w runs (horizontal runs for a steep bar, vertical for a flat one),
// tapering to w1 at the far end; its upper-left edge lit, its lower-right edge `edge` (default dark; the specular
// tone for a blade's ground edge).
function bar(p, x0, y0, x1, y1, w, m, w1 = w, edge = m[0]) {
  const steep = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
  const pts = []; { let x = x0, y = y0; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { pts.push([x, y]); if (x === x1 && y === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x += sx; } if (e2 <= dx) { e += dx; y += sy; } } }
  pts.forEach(([x, y], k) => {
    const wk = Math.max(1, r2(w + (w1 - w) * (k / Math.max(1, pts.length - 1))));
    for (let i = 0; i < wk; i++) {
      const c = wk === 1 ? m[1] : i === 0 ? m[2] : i === wk - 1 ? edge : m[1];
      if (steep) p.set(x + i, y, c); else p.set(x, y + i, c);
    }
  });
}
// A sphere: a dark crescent at the lower right, a light one at the upper left, a specular dot.
function ball(p, cx, cy, r, m) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const nx = (x - cx) / (r + 0.5), ny = (y - cy) / (r + 0.5); if (nx * nx + ny * ny > 1) continue;
    const d = (nx + ny) / 1.4;
    p.set(x, y, d > 0.55 ? m[0] : d < -0.5 ? m[2] : m[1]);
  }
  p.set(r2(cx - r * 0.45), r2(cy - r * 0.45), m[3]);
}
// A dome (the top half of a ball, for helmets): the same lighting on an ellipse rx × ry.
function dome(p, cx, cy, rx, ry, m) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const nx = (x - cx) / (rx + 0.5), ny = (y - cy) / (ry + 0.5); if (nx * nx + ny * ny > 1) continue;
    const d = (nx * 0.8 + ny) / 1.3;
    p.set(x, y, d > 0.6 ? m[0] : nx > 0.72 ? m[0] : d < -0.45 ? m[2] : m[1]);
  }
  p.hl(r2(cx - rx * 0.55), r2(cx - rx * 0.3), r2(cy - ry * 0.55), m[3]);
}
// Clear an ellipse (a ring's hole, a bag's handle).
function hole(p, cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const nx = (x - cx) / (rx + 0.5), ny = (y - cy) / (ry + 0.5); if (nx * nx + ny * ny <= 1) p.clear(x, y);
  }
}
// A medical cross centred on (cx, cy), arms r long.
function cross(p, cx, cy, r, c, t = 1) { p.rect(cx - t, cy - r, cx + t, cy + r, c); p.rect(cx - r, cy - t, cx + r, cy + t, c); }
// A dotted run (stitching, a zipper).
const dots = (p, x0, x1, y, c, step = 2) => { for (let x = x0; x <= x1; x += step) p.set(x, y, c); };
const vdots = (p, x, y0, y1, c, step = 2) => { for (let y = y0; y <= y1; y += step) p.set(x, y, c); };
// A horizontal-ish ellipse outline (a ring).
function ring(p, cx, cy, rx, ry, t, m) { p.ellipse(cx, cy, rx, ry, m[1]); hole(p, cx, cy, rx - t, ry - t); }

// ---------- shared pieces ----------
// A vest's front: shoulder straps, a neck opening, a body with a shallow V at the bottom.
function vestBody(p, m, { x0 = 5, x1 = 26, top = 4, bot = 28 } = {}) {
  p.rect(x0 + 1, top, x0 + 5, top + 5, m[1]); p.rect(x1 - 5, top, x1 - 1, top + 5, m[1]); // shoulders
  p.rect(x0, top + 5, x1, bot - 2, m[1]);
  p.hl(x0 + 2, x1 - 2, bot - 1, m[1]); p.hl(x0 + 4, x1 - 4, bot, m[1]);
  p.hl(x0 + 1, x0 + 5, top, m[2]); p.hl(x1 - 5, x1 - 1, top, m[2]); p.vl(x0 + 1, top, top + 5, m[2]); p.vl(x0, top + 5, bot - 2, m[2]);
  p.vl(x1, top + 5, bot - 2, m[0]); p.vl(x1 - 1, top, top + 5, m[0]); p.hl(x0 + 4, x1 - 4, bot, m[0]); p.hl(x0 + 2, x0 + 3, bot - 1, m[0]); p.hl(x1 - 3, x1 - 2, bot - 1, m[0]);
  p.hl(x0 + 6, x1 - 6, top + 5, m[0]); // the neckline's shadow
}
// A closed book in 3/4 view: a spine on the left, the page block showing at the right and the bottom.
function book(m, symbol) {
  const p = painter(32, 32);
  p.rect(8, 5, 26, 28, PAL.paper[1]); p.vl(26, 6, 28, PAL.paper[0]); p.hl(9, 26, 28, PAL.paper[0]); p.vl(25, 6, 27, PAL.paper[3]); p.hl(9, 25, 27, PAL.paper[2]); // pages
  p.rect(5, 4, 24, 26, m[1]); p.rect(5, 4, 7, 26, m[0]); p.vl(8, 5, 25, m[2]); p.hl(6, 24, 4, m[2]); p.vl(24, 5, 26, m[0]); p.hl(8, 24, 26, m[0]); // cover and spine
  p.hl(5, 7, 8, m[2]); p.hl(5, 7, 22, m[2]); // the spine's bands
  if (symbol) symbol(p, 16, 15);
  return p;
}
// A grenade-shaped cylinder: body, fuze head, spoon down the right side, pin ring at the top left.
function canister(p, m, bandM = null) {
  vcyl(p, 10, 9, 21, 29, m); p.hl(10, 21, 29, m[0]); p.hl(11, 20, 9, m[2]);
  if (bandM) { p.rect(10, 13, 21, 15, bandM[1]); p.vl(10, 13, 15, bandM[2]); p.vl(20, 13, 15, bandM[0]); p.vl(21, 13, 15, bandM[0]); }
  box(p, 12, 5, 19, 8, PAL.iron); // fuze head
  p.rect(22, 6, 23, 19, PAL.steel[1]); p.vl(22, 6, 19, PAL.steel[2]); p.hl(19, 23, 6, PAL.steel[2]); // spoon
  ring(p, 8, 6, 3, 3, 1, PAL.steel); p.set(7, 5, PAL.steel[3]); // pin ring
}

// ---------- the drawings, by GEAR key (and supply key) ----------
const P32 = () => painter(32, 32);
export const ITEM_ART = {
  // ----- supplies -----
  food() { const p = P32(); // a tin can with a red label
    vcyl(p, 8, 6, 23, 28, PAL.steel); p.hl(8, 23, 28, PAL.steel[0]);
    p.rect(8, 11, 23, 22, PAL.red[1]); p.vl(8, 11, 22, PAL.red[2]); p.vl(9, 11, 22, PAL.red[3]); p.vl(22, 11, 22, PAL.red[0]); p.vl(23, 11, 22, PAL.red[0]);
    p.rect(11, 14, 20, 19, PAL.paper[2]); p.hl(12, 19, 16, PAL.red[1]); p.hl(13, 18, 17, PAL.red[0]); // the label's white panel and a stripe
    p.ellipse(15.5, 6, 7, 2, PAL.steel[2]); p.ellipse(15.5, 6, 5, 1, PAL.steel[1]); p.hl(11, 14, 5, PAL.steel[3]); // the lid, with its rim
    p.hl(9, 22, 9, PAL.steel[0]); p.hl(9, 22, 25, PAL.steel[0]); // the rolled seams
    return p; },
  water() { const p = P32(); // a clear bottle, two thirds full
    box(p, 12, 2, 19, 5, PAL.blue); p.hl(13, 18, 3, PAL.blue[3]);
    p.rect(13, 6, 18, 9, PAL.glass[2]); p.rect(11, 10, 20, 11, PAL.glass[2]); // the neck and shoulders
    p.rect(10, 12, 21, 28, PAL.glass[2]); p.rect(10, 15, 21, 28, PAL.glass[1]); p.rect(11, 17, 20, 27, PAL.glass[1]); // the water line
    p.vl(10, 12, 27, PAL.glass[3]); p.vl(11, 7, 27, PAL.glass[3]); p.vl(20, 12, 28, PAL.glass[0]); p.vl(21, 12, 28, PAL.glass[0]); p.hl(11, 20, 28, PAL.glass[0]);
    p.hl(13, 18, 6, PAL.glass[3]); p.rect(14, 19, 15, 24, PAL.glass[3]); // the specular on the neck and the body
    p.hl(10, 21, 20, PAL.glass[0]); p.hl(10, 21, 24, PAL.glass[0]); // the moulded ribs
    return p; },
  rawwater() { const p = P32(); // a galvanised bucket, with water in it
    for (let y = 10; y <= 28; y++) { const inset = r2((y - 10) / 6); p.hl(5 + inset, 26 - inset, y, PAL.grey[1]); p.set(5 + inset, y, PAL.grey[2]); p.set(6 + inset, y, PAL.grey[3]); p.set(26 - inset, y, PAL.grey[0]); p.set(25 - inset, y, PAL.grey[0]); }
    p.hl(8, 23, 28, PAL.grey[0]); p.hl(7, 24, 12, PAL.grey[0]); p.hl(7, 24, 25, PAL.grey[0]); // the bottom and the rolled bands
    p.ellipse(15.5, 10, 11, 3, PAL.grey[2]); p.ellipse(15.5, 10.5, 9, 2, PAL.glass[1]); p.hl(9, 13, 10, PAL.glass[3]); p.hl(10, 20, 12, PAL.glass[0]); // the rim and the water
    for (let x = 5; x <= 26; x++) { const t = (x - 15.5) / 11; p.set(x, r2(2 + 6 * t * t), PAL.steel[1]); } p.set(15, 2, PAL.steel[2]); p.set(16, 2, PAL.steel[2]); // the bail
    p.rect(5, 8, 6, 10, PAL.steel[0]); p.rect(25, 8, 26, 10, PAL.steel[0]); // the ears
    return p; },
  wood() { const p = P32(); // three split logs, end on
    const log = (cx, cy) => { ball(p, cx, cy, 6, PAL.wood); p.circle(cx, cy, 4, PAL.ash[1]); p.circle(cx, cy, 2, PAL.ash[2]); p.set(cx - 1, cy - 1, PAL.ash[3]); p.line(cx, cy, cx + 3, cy + 3, PAL.ash[0]); p.set(cx - 2, cy + 1, PAL.ash[0]); };
    log(10, 23); log(22, 23); log(16, 12);
    p.rect(2, 29, 29, 29, PAL.wood[0]);
    return p; },
  fuel() { const p = P32(); // a red jerrycan
    box(p, 6, 9, 25, 28, PAL.red); p.rect(6, 9, 25, 10, PAL.red[2]);
    p.rect(8, 4, 23, 8, PAL.red[1]); p.hl(8, 23, 4, PAL.red[2]); p.hl(9, 22, 6, PAL.red[0]); p.hl(9, 22, 8, PAL.red[0]); p.vl(13, 5, 8, PAL.red[0]); p.vl(18, 5, 8, PAL.red[0]); // the three handles
    box(p, 23, 3, 27, 7, PAL.iron); // the spout cap
    p.line(9, 13, 22, 25, PAL.red[0]); p.line(22, 13, 9, 25, PAL.red[0]); p.rect(13, 16, 18, 22, PAL.red[1]); // the pressed X
    p.rect(9, 12, 22, 12, PAL.red[2]); p.rect(9, 12, 9, 26, PAL.red[2]); p.hl(9, 22, 26, PAL.red[0]); p.vl(22, 12, 26, PAL.red[0]); // the pressed panel
    p.rect(12, 17, 19, 21, PAL.yellow[2]); p.rect(13, 18, 18, 20, PAL.black[0]); // the label
    return p; },
  meds() { const p = P32(); // an amber pill bottle with a white cap and a red cross on the label
    vcyl(p, 9, 10, 22, 28, PAL.amber); p.hl(9, 22, 28, PAL.amber[0]); p.hl(10, 21, 10, PAL.amber[2]);
    box(p, 8, 4, 23, 9, PAL.white); vdots(p, 8, 4, 9, PAL.white[0]); for (let x = 10; x <= 22; x += 2) p.vl(x, 5, 8, PAL.white[1]); // the ribbed cap
    p.rect(9, 14, 22, 24, PAL.paper[3]); p.vl(9, 14, 24, PAL.paper[2]); p.vl(22, 14, 24, PAL.paper[0]); p.vl(21, 14, 24, PAL.paper[1]);
    cross(p, 15, 19, 3, PAL.red[1]); p.hl(13, 14, 18, PAL.red[2]); p.set(15, 16, PAL.red[2]);
    p.rect(11, 25, 20, 27, PAL.amber[2]); dots(p, 12, 19, 26, PAL.white[2], 3); // pills showing through
    return p; },
  ammo() { const p = P32(); // three loose rifle rounds
    const round = (x, y, h) => { vcyl(p, x, y + 6, x + 4, y + h, PAL.brass); p.hl(x, x + 4, y + h, PAL.brass[0]); p.hl(x, x + 4, y + h - 1, PAL.brass[0]); p.hl(x, x + 4, y + 6, PAL.brass[2]);
      p.rect(x, y + 3, x + 4, y + 5, PAL.copper[1]); p.rect(x + 1, y + 1, x + 3, y + 2, PAL.copper[1]); p.set(x + 2, y, PAL.copper[1]); p.vl(x + 1, y + 2, y + 5, PAL.copper[2]); p.set(x + 1, y + 3, PAL.copper[3]); p.vl(x + 4, y + 3, y + 5, PAL.copper[0]); p.set(x + 3, y + 2, PAL.copper[0]);
      p.hl(x + 1, x + 3, y + 7, PAL.brass[0]); }; // the neck's shoulder
    round(4, 7, 22); round(13, 3, 26); round(22, 7, 22);
    return p; },
  parts() { const p = P32(); // a cog and a hex bolt
    const teeth = (c) => { for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4 + Math.PI / 8; const cx = r2(11 + Math.cos(ang) * 9.5), cy = r2(12 + Math.sin(ang) * 9.5); p.rect(cx - 1, cy - 1, cx + 1, cy + 1, c); } };
    teeth(PAL.steel[1]); ball(p, 11, 12, 8, PAL.steel); teeth(null);
    for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4 + Math.PI / 8; const cx = r2(11 + Math.cos(ang) * 9.5), cy = r2(12 + Math.sin(ang) * 9.5); const lit = ang > Math.PI * 0.9 && ang < Math.PI * 1.6; p.rect(cx - 1, cy - 1, cx + 1, cy + 1, lit ? PAL.steel[2] : ang < Math.PI * 0.6 ? PAL.steel[0] : PAL.steel[1]); }
    p.circle(11, 12, 3.2, PAL.iron[1]); p.circle(11, 12, 1.5, PAL.iron[0]); p.set(9, 10, PAL.steel[3]); p.set(8, 9, PAL.steel[3]); // the hub
    p.rect(21, 14, 29, 19, PAL.steel[1]); p.hl(21, 29, 14, PAL.steel[2]); p.vl(21, 14, 19, PAL.steel[2]); p.hl(22, 29, 19, PAL.steel[0]); p.vl(29, 15, 19, PAL.steel[0]); p.vl(24, 15, 18, PAL.steel[0]); p.vl(27, 15, 18, PAL.steel[2]); p.set(22, 15, PAL.steel[3]); // the hex head
    vcyl(p, 23, 20, 27, 29, PAL.iron); for (let y = 21; y <= 28; y += 2) p.hl(24, 27, y, PAL.iron[0]); p.hl(23, 27, 29, PAL.iron[0]); // the threaded shank
    return p; },
  scrap() { const p = P32(); // a bent, rusted plate and a cut strip
    for (let y = 8; y <= 26; y++) { const x0 = 4 + (y > 18 ? y - 18 : 0), x1 = 22 + r2(Math.sin(y * 0.9) * 2) + (y < 12 ? (12 - y) : 0); p.hl(x0, Math.min(x1, 29), y, PAL.steel[1]); p.set(x0, y, PAL.steel[2]); p.set(Math.min(x1, 29), y, PAL.steel[0]); }
    p.hl(5, 22, 8, PAL.steel[2]); p.hl(12, 26, 26, PAL.steel[0]);
    p.rect(9, 12, 13, 15, PAL.rust[1]); p.rect(17, 19, 19, 22, PAL.rust[1]); p.set(10, 13, PAL.rust[2]); p.rect(6, 22, 8, 24, PAL.rust[0]); p.set(21, 10, PAL.rust[1]); // rust blooms
    p.rect(12, 18, 14, 20, DARK); p.set(13, 19, PAL.steel[0]); p.rect(19, 12, 20, 13, DARK); // bolt holes
    p.line(4, 21, 11, 28, PAL.steel[0]); // the fold
    bar(p, 19, 30, 28, 21, 3, PAL.iron); p.set(27, 21, PAL.iron[3]); // the strip
    return p; },
  carparts() { const p = P32(); // a tyre on a steel rim
    ball(p, 16, 16, 13, PAL.black); for (let a = 0; a < 20; a++) { const ang = a * Math.PI / 10; p.set(r2(16 + Math.cos(ang) * 12.6), r2(16 + Math.sin(ang) * 12.6), PAL.black[0]); } // the tread
    p.circle(16, 16, 9, PAL.black[0]); ball(p, 16, 16, 7, PAL.grey); p.circle(16, 16, 2.2, PAL.iron[1]); p.set(16, 16, PAL.iron[0]);
    for (let a = 0; a < 5; a++) { const ang = a * Math.PI * 2 / 5 - Math.PI / 2; p.set(r2(16 + Math.cos(ang) * 4.6), r2(16 + Math.sin(ang) * 4.6), PAL.iron[0]); } // lug nuts
    p.hl(9, 13, 9, PAL.black[3]); // the sidewall's gloss
    return p; },
  gunparts() { const p = P32(); // a recoil spring and a bolt carrier
    for (let k = 0; k < 6; k++) { const x = 4 + k * 4; p.line(x, 9, x + 3, 2, PAL.steel[2]); p.line(x + 1, 9, x + 4, 2, PAL.steel[1]); p.set(x + 3, 2, PAL.steel[3]); p.set(x, 9, PAL.steel[0]); p.set(x + 1, 9, PAL.steel[0]); } // the coils
    p.vl(3, 3, 9, PAL.steel[1]); p.vl(28, 2, 8, PAL.steel[1]); // the end loops
    hcyl(p, 3, 14, 22, 23, PAL.iron); p.rect(23, 15, 29, 22, PAL.iron[1]); p.hl(23, 29, 15, PAL.iron[2]); p.hl(23, 29, 22, PAL.iron[0]); p.vl(29, 16, 22, PAL.iron[0]); for (let y = 16; y <= 21; y += 2) p.hl(23, 28, y, PAL.iron[0]); // the carrier and the bolt's lugs
    p.rect(7, 17, 11, 20, DARK); p.hl(8, 10, 17, PAL.iron[0]); p.set(8, 18, PAL.steel[1]); p.set(9, 18, PAL.steel[2]); p.rect(26, 18, 27, 19, PAL.steel[2]); // the cam pin hole and the firing pin
    p.rect(5, 10, 10, 13, PAL.iron[1]); p.hl(5, 10, 10, PAL.iron[2]); p.vl(10, 10, 13, PAL.iron[0]); // the gas key
    p.rect(12, 24, 25, 28, PAL.steel[1]); p.hl(12, 25, 24, PAL.steel[2]); p.hl(12, 25, 28, PAL.steel[0]); p.vl(25, 24, 28, PAL.steel[0]); dots(p, 14, 24, 26, PAL.steel[0], 3); p.rect(8, 26, 11, 29, PAL.steel[0]); // a trigger group plate and the trigger
    return p; },
  electronics() { const p = P32(); // a circuit board
    box(p, 4, 7, 27, 26, PAL.board);
    for (let x = 5; x <= 26; x += 3) p.set(x, 7, PAL.gold[2]); dots(p, 5, 26, 26, PAL.gold[1], 3); // the edge pads
    p.hl(7, 15, 12, PAL.board[2]); p.vl(15, 12, 17, PAL.board[2]); p.hl(15, 23, 17, PAL.board[2]); p.vl(9, 15, 22, PAL.board[2]); p.hl(9, 13, 22, PAL.board[2]); p.vl(22, 10, 14, PAL.board[2]); // traces
    p.rect(10, 13, 17, 20, PAL.black[1]); p.hl(10, 17, 13, PAL.black[2]); p.hl(10, 17, 20, PAL.black[0]); dots(p, 10, 17, 12, PAL.steel[2]); dots(p, 10, 17, 21, PAL.steel[2]); p.set(11, 14, PAL.black[3]); // the chip
    p.rect(20, 11, 22, 13, PAL.black[1]); p.rect(20, 19, 22, 23, PAL.blue[1]); p.hl(20, 22, 19, PAL.blue[2]); // a small chip and a capacitor
    p.rect(6, 15, 7, 20, PAL.black[1]); p.rect(6, 16, 7, 17, PAL.rust[2]); // a resistor
    p.rect(24, 16, 25, 24, PAL.steel[2]); p.vl(25, 16, 24, PAL.steel[0]); // a header
    p.set(6, 9, DARK); p.set(25, 9, DARK); p.set(6, 24, DARK); // mounting holes
    return p; },

  // ----- melee -----
  knife() { const p = P32(); // a kitchen knife: wide steel blade, black riveted handle
    bar(p, 3, 28, 11, 20, 4, PAL.black); p.set(5, 26, PAL.steel[2]); p.set(8, 23, PAL.steel[2]); // rivets
    bar(p, 11, 19, 27, 3, 7, PAL.steel, 1, PAL.steel[3]); p.line(12, 19, 25, 6, PAL.steel[2]); // the blade and its flat's light line
    p.rect(10, 19, 12, 21, PAL.steel[0]); // the bolster
    return p; },
  combatknife() { const p = P32(); // a blackened clip-point blade, a steel guard, a wrapped grip
    bar(p, 3, 28, 10, 21, 5, PAL.black); for (let i = 0; i < 4; i++) p.line(4 + i * 2, 28 - i * 2, 7 + i * 2, 29 - i * 2, PAL.black[0]); p.rect(2, 29, 5, 30, PAL.steel[1]); p.set(2, 29, PAL.steel[2]); // the grip's cord wrap and the pommel
    bar(p, 9, 23, 13, 19, 2, PAL.steel); bar(p, 10, 21, 14, 25, 2, PAL.steel); // the guard
    bar(p, 12, 19, 27, 4, 6, PAL.iron, 1, PAL.steel[3]); p.hl(23, 26, 7, PAL.iron[2]); p.line(13, 18, 23, 8, PAL.iron[2]); // the blade, a bright edge, the fuller
    p.rect(14, 15, 15, 16, PAL.iron[0]); p.rect(18, 11, 19, 12, PAL.iron[0]); // serrations' shadow
    return p; },
  machete() { const p = P32(); // a long blade with a flared tip and a wooden handle
    bar(p, 2, 29, 8, 23, 4, PAL.wood); p.set(4, 27, PAL.brass[2]); p.set(6, 25, PAL.brass[2]);
    bar(p, 8, 22, 22, 8, 7, PAL.steel, 6, PAL.steel[3]); bar(p, 21, 9, 27, 3, 7, PAL.steel, 1, PAL.steel[3]);
    p.rect(21, 2, 26, 4, PAL.steel[1]); p.hl(21, 25, 2, PAL.steel[2]); p.set(27, 3, PAL.steel[3]); // the flared tip's back
    p.line(9, 22, 20, 11, PAL.steel[2]); p.vl(8, 21, 23, PAL.steel[0]); // the flat's light line and the tang shadow
    return p; },
  bat() { const p = P32(); // an ash baseball bat
    bar(p, 3, 28, 24, 7, 3, PAL.ash, 7); p.circle(4, 28, 2, PAL.ash[1]); p.set(3, 27, PAL.ash[2]); p.hl(3, 5, 30, PAL.ash[0]); // the knob
    p.ellipse(27, 5, 2.5, 2.5, PAL.ash[1]); p.set(26, 4, PAL.ash[2]); p.set(28, 6, PAL.ash[0]); // the rounded barrel end
    p.line(12, 20, 23, 9, PAL.ash[0]); p.line(16, 14, 24, 6, PAL.ash[3]); // grain
    return p; },
  nailbat() { const p = P32(); // the bat with nails driven through the barrel
    const q = ITEM_ART.bat();
    const axis = (y) => { const x = 3 + (28 - y), w = 3 + 4 * (28 - y) / 21; return [r2(x + w / 2 - 0.5), r2(w / 3.2)]; }; // the barrel's centre column and half-width on row y
    for (const y of [16, 12, 8]) { const [cx, k] = axis(y); q.line(cx - k, y - k, cx - k - 3, y - k - 3, PAL.steel[2]); q.set(cx - k - 3, y - k - 3, PAL.steel[3]); q.line(cx + k, y + k, cx + k + 2, y + k + 2, PAL.steel[1]); q.set(cx + k + 2, y + k + 2, PAL.steel[0]); } // nails out of both sides
    for (const y of [14, 10]) { const [cx] = axis(y); q.line(cx, y, cx + 1, y - 3, PAL.steel[2]); q.set(cx + 1, y - 3, PAL.steel[3]); q.set(cx, y, PAL.steel[0]); } // nails toward the viewer
    return q; },
  spikedbat() { const p = P32(); // the bat wrapped in barbed wire, spikes driven through it
    const q = ITEM_ART.bat();
    const axis = (y) => { const x = 3 + (28 - y), w = 3 + 4 * (28 - y) / 21; return [x + w / 2 - 0.5, w]; }; // the barrel's centre and width on row y
    for (const y of [16, 13, 10, 7]) { const [cx, w] = axis(y); const k = r2(w / 3.2); q.line(r2(cx) - k, y - k, r2(cx) + k, y + k, PAL.iron[1]); q.set(r2(cx) - k, y - k, PAL.iron[2]); q.set(r2(cx), y, PAL.iron[2]); } // the wire wraps
    for (const y of [15, 11, 8]) { const [cx, w] = axis(y); const k = r2(w / 3.2); q.line(r2(cx) - k, y - k, r2(cx) - k - 3, y - k - 3, PAL.steel[2]); q.set(r2(cx) - k - 3, y - k - 3, PAL.steel[3]); q.line(r2(cx) + k, y + k, r2(cx) + k + 2, y + k + 2, PAL.steel[1]); q.set(r2(cx) + k + 2, y + k + 2, PAL.steel[0]); } // the spikes
    for (const y of [14, 9]) { const [cx] = axis(y); q.line(r2(cx), y, r2(cx) + 1, y - 3, PAL.steel[2]); q.set(r2(cx) + 1, y - 3, PAL.steel[3]); } // spikes toward the viewer
    return q; },
  prybar() { const p = P32(); // a forged steel crowbar: the hooked claw at the top, the chisel at the bottom
    bar(p, 4, 28, 22, 10, 4, PAL.iron); p.set(23, 10, PAL.iron[1]);
    p.rect(23, 7, 27, 9, PAL.iron[1]); p.hl(23, 27, 7, PAL.iron[2]); p.rect(27, 7, 28, 11, PAL.iron[1]); p.vl(28, 8, 11, PAL.iron[0]); p.set(26, 10, PAL.iron[0]); p.set(26, 11, PAL.iron[2]); p.set(28, 12, PAL.iron[2]); // the hook's curl and the forked claw
    p.set(25, 8, PAL.iron[3]); p.set(24, 8, PAL.iron[3]);
    p.rect(3, 29, 7, 30, PAL.iron[1]); p.set(3, 29, PAL.iron[2]); p.hl(3, 7, 30, PAL.iron[0]); p.hl(2, 3, 30, PAL.iron[2]); // the flattened chisel end
    return p; },
  crowbar() { const p = P32(); // the tool: the same bar, painted red, the ends bare steel
    bar(p, 4, 28, 22, 10, 4, PAL.red); p.set(23, 10, PAL.red[1]);
    p.rect(23, 7, 27, 9, PAL.steel[1]); p.hl(23, 27, 7, PAL.steel[2]); p.rect(27, 7, 28, 11, PAL.steel[1]); p.vl(28, 8, 11, PAL.steel[0]); p.set(26, 10, PAL.steel[0]); p.set(26, 11, PAL.steel[2]); p.set(28, 12, PAL.steel[2]);
    p.set(25, 8, PAL.steel[3]); p.set(24, 8, PAL.steel[3]); p.rect(22, 10, 24, 11, PAL.steel[1]);
    p.rect(3, 29, 7, 30, PAL.steel[1]); p.set(3, 29, PAL.steel[2]); p.hl(3, 7, 30, PAL.steel[0]); p.hl(2, 3, 30, PAL.steel[2]);
    return p; },
  fireaxe() { const p = P32(); // a red fire axe: the broad bit to the right, the pick to the left
    bar(p, 4, 29, 19, 14, 3, PAL.wood); p.line(6, 27, 17, 16, PAL.wood[0]);
    for (let x = 20; x <= 29; x++) { const h = 2 + (x - 20) * 0.55; p.vl(x, r2(9.5 - h), r2(9.5 + h), PAL.red[1]); p.set(x, r2(9.5 - h), PAL.red[2]); p.set(x, r2(9.5 + h), PAL.red[0]); } // the bit
    p.vl(29, 4, 15, PAL.steel[2]); p.vl(28, 4, 15, PAL.steel[1]); p.vl(29, 6, 13, PAL.steel[3]); // the ground edge
    for (let x = 11; x <= 19; x++) { const h = 0.4 + (x - 11) * 0.3; p.vl(x, r2(9.5 - h), r2(9.5 + h), PAL.red[1]); p.set(x, r2(9.5 - h), PAL.red[2]); } p.set(11, 9, PAL.steel[2]); p.set(10, 9, PAL.steel[3]); // the pick
    p.rect(19, 7, 21, 12, PAL.red[0]); p.set(20, 9, PAL.wood[2]); p.set(20, 10, PAL.wood[1]); p.hl(19, 21, 7, PAL.red[2]); // the eye, the handle's end in it
    p.hl(21, 24, 7, PAL.red[3]); // a gloss on the paint
    return p; },
  hatchet() { const p = P32(); // a camp hatchet
    bar(p, 7, 29, 19, 15, 3, PAL.wood); p.line(10, 26, 17, 18, PAL.wood[0]); p.rect(6, 28, 9, 30, PAL.leather[1]); // the handle and its lanyard loop
    p.rect(14, 8, 18, 13, PAL.steel[1]); p.hl(14, 18, 8, PAL.steel[2]); p.vl(14, 8, 13, PAL.steel[2]); p.hl(14, 18, 13, PAL.steel[0]); // the poll
    for (let x = 19; x <= 27; x++) { const c = 10 + (x - 19) * 0.3, h = 2 + (x - 19) * 0.55; p.vl(x, r2(c - h), r2(c + h), PAL.steel[1]); p.set(x, r2(c - h), PAL.steel[2]); p.set(x, r2(c + h), PAL.steel[0]); } // the bit, its beard dropping
    p.vl(27, 6, 18, PAL.steel[3]); p.vl(26, 7, 17, PAL.steel[2]); p.rect(19, 8, 21, 13, PAL.steel[0]); p.set(20, 10, PAL.wood[2]); p.set(20, 11, PAL.wood[1]); // the edge and the eye
    p.hl(21, 23, 7, PAL.steel[3]);
    return p; },
  hatchet() { const p = P32(); // a camp hatchet
    bar(p, 7, 29, 19, 15, 3, PAL.wood); p.line(10, 26, 17, 18, PAL.wood[0]); p.rect(6, 28, 9, 30, PAL.leather[1]); // the handle and its lanyard loop
    p.rect(15, 9, 19, 14, PAL.steel[0]); // the poll
    for (let y = 5; y <= 18; y++) { const w = y < 10 ? (y - 5) * 1.8 : y > 13 ? (18 - y) * 1.8 : 9; p.hl(19, r2(19 + w), y, PAL.steel[1]); p.set(r2(19 + w), y, PAL.steel[3]); } // the bit
    p.hl(20, 24, 5, PAL.steel[2]); p.rect(19, 8, 21, 15, PAL.steel[1]); p.vl(20, 9, 14, PAL.steel[2]); p.rect(22, 9, 24, 14, PAL.steel[2]); p.set(23, 10, PAL.steel[3]);
    p.line(20, 17, 24, 17, PAL.steel[0]); p.line(21, 18, 22, 18, PAL.steel[0]);
    return p; },
  sledge() { const p = P32(); // a sledgehammer
    bar(p, 4, 29, 17, 13, 3, PAL.wood); p.line(6, 27, 15, 16, PAL.wood[0]);
    hcyl(p, 10, 5, 29, 13, PAL.steel); p.rect(10, 5, 11, 13, PAL.steel[2]); p.vl(10, 5, 13, PAL.steel[3]); p.rect(28, 5, 29, 13, PAL.steel[0]); p.vl(28, 6, 12, PAL.steel[1]); // the head, its struck faces
    p.rect(18, 9, 21, 13, PAL.steel[0]); p.set(19, 10, PAL.wood[2]); p.set(20, 11, PAL.wood[1]); p.set(19, 11, PAL.steel[2]); // the eye with the wedge
    p.hl(8, 11, 29, PAL.rust[1]); // a rubber grip end
    return p; },
  baton() { const p = P32(); // an expandable baton: three telescoping sections
    bar(p, 3, 29, 11, 21, 5, PAL.black); for (let i = 0; i < 5; i++) p.set(5 + i * 1.5, 28 - i * 1.5, PAL.black[0]); p.rect(2, 29, 5, 30, PAL.black[0]); // the foam grip and the end cap
    bar(p, 11, 20, 19, 12, 4, PAL.iron); bar(p, 19, 11, 26, 4, 3, PAL.iron); p.set(13, 19, PAL.iron[3]); p.set(21, 11, PAL.iron[3]);
    p.rect(10, 20, 13, 22, PAL.iron[0]); p.rect(18, 12, 20, 14, PAL.iron[0]); // the joints
    ball(p, 28, 3, 2, PAL.steel); // the tip
    return p; },
  pipespear() { const p = P32(); // a kitchen knife taped to a steel pipe
    bar(p, 3, 29, 19, 13, 3, PAL.iron); p.rect(2, 28, 5, 30, PAL.iron[0]); p.set(3, 28, PAL.iron[2]); // the pipe and its threaded end
    bar(p, 18, 13, 29, 2, 4, PAL.steel, 1, PAL.steel[3]); p.line(19, 13, 27, 5, PAL.steel[2]);
    for (let k = 0; k < 3; k++) { const x = 15 + k * 2, y = 18 - k * 2; p.line(x, y - 2, x + 4, y + 2, PAL.grey[2]); p.line(x, y - 1, x + 4, y + 3, PAL.grey[1]); } // duct tape wraps
    p.rect(17, 17, 21, 20, PAL.black[1]); p.hl(17, 20, 17, PAL.black[2]); // the knife's handle end showing
    return p; },
  spear() { const p = P32(); // a boar spear: a leaf head on an ash shaft
    bar(p, 2, 30, 18, 14, 3, PAL.ash); p.line(4, 28, 16, 16, PAL.ash[0]);
    p.rect(16, 13, 20, 16, PAL.iron[1]); p.hl(16, 20, 13, PAL.iron[2]); // the socket
    bar(p, 15, 17, 20, 10, 2, PAL.iron); bar(p, 18, 17, 24, 19, 2, PAL.iron); // the wings
    bar(p, 18, 13, 29, 2, 7, PAL.steel, 1, PAL.steel[3]); bar(p, 18, 13, 22, 9, 7, PAL.steel, 7, PAL.steel[3]); p.line(19, 12, 27, 4, PAL.steel[2]); // the leaf blade and its ridge
    return p; },

  // ----- bows -----
  compbow() { const p = P32(); // a compound bow, upright, with an arrow across the grip
    p.rect(14, 10, 17, 22, PAL.black[1]); p.vl(14, 10, 22, PAL.black[2]); p.vl(17, 10, 22, PAL.black[0]); p.rect(13, 14, 14, 19, PAL.black[0]); // the riser
    bar(p, 15, 10, 21, 3, 3, PAL.black); bar(p, 15, 22, 21, 29, 3, PAL.black); // the limbs
    ball(p, 23, 4, 2.3, PAL.steel); ball(p, 23, 28, 2.3, PAL.steel); p.set(23, 4, PAL.iron[0]); p.set(23, 28, PAL.iron[0]); // the cams
    p.vl(25, 5, 27, PAL.white[1]); p.line(24, 6, 22, 10, PAL.white[0]); p.line(24, 26, 22, 22, PAL.white[0]); // the string and cables
    p.hl(3, 24, 16, PAL.ash[2]); p.hl(3, 24, 17, PAL.ash[0]); p.rect(3, 14, 7, 15, PAL.red[2]); p.rect(3, 18, 7, 19, PAL.red[1]); p.rect(25, 15, 28, 18, PAL.steel[1]); p.set(29, 16, PAL.steel[3]); p.set(29, 17, PAL.steel[3]); // the arrow
    p.rect(9, 11, 11, 14, PAL.steel[1]); p.set(10, 12, PAL.glass[2]); // the sight
    return p; },
  xbow() { const p = P32(); // a scoped hunting crossbow, upright
    p.rect(13, 11, 18, 29, PAL.coyote[1]); p.vl(13, 11, 29, PAL.coyote[2]); p.vl(18, 11, 29, PAL.coyote[0]); p.rect(11, 25, 20, 29, PAL.coyote[1]); p.hl(11, 20, 29, PAL.coyote[0]); // the stock and the butt
    p.rect(14, 20, 17, 22, PAL.black[1]); p.rect(12, 21, 13, 23, PAL.black[1]); // the grip and the trigger
    for (let x = 2; x <= 29; x++) { const t = Math.abs(x - 15.5) / 13.5; const y = 6 + r2(t * t * 3); p.set(x, y, PAL.black[1]); p.set(x, y + 1, PAL.black[1]); p.set(x, y, t < 0.3 ? PAL.black[2] : PAL.black[2]); p.set(x, y + 2, t > 0.4 ? PAL.black[0] : null); } // the limbs
    p.rect(2, 9, 3, 11, PAL.steel[1]); p.rect(28, 9, 29, 11, PAL.steel[1]); p.line(3, 11, 14, 14, PAL.white[1]); p.line(28, 11, 17, 14, PAL.white[1]); // the cams and the string
    p.rect(14, 2, 17, 6, PAL.ash[2]); p.set(15, 1, PAL.steel[2]); p.set(16, 1, PAL.steel[2]); p.rect(14, 7, 17, 13, PAL.ash[1]); p.rect(14, 12, 17, 14, PAL.red[1]); // the bolt in its groove
    vcyl(p, 12, 12, 19, 19, PAL.iron); p.rect(11, 12, 20, 13, PAL.iron[1]); p.hl(11, 20, 12, PAL.iron[3]); p.hl(12, 19, 13, PAL.glass[1]); p.hl(13, 15, 13, PAL.glass[3]); p.rect(11, 18, 20, 19, PAL.iron[1]); p.hl(11, 20, 19, PAL.iron[0]); // the scope's tube on the stock
    return p; },
  crossbow() { const p = P32(); // a scrap crossbow: a plank stock, leaf-spring limbs
    p.rect(12, 10, 19, 29, PAL.ash[1]); p.vl(12, 10, 29, PAL.ash[2]); p.vl(19, 10, 29, PAL.ash[0]); p.line(13, 12, 13, 27, PAL.ash[0]); p.rect(10, 26, 21, 29, PAL.ash[1]); p.hl(10, 21, 29, PAL.ash[0]); // the stock
    for (let x = 2; x <= 29; x++) { const t = Math.abs(x - 15.5) / 13.5; const y = 5 + r2(t * t * 4); p.rect(x, y, x, y + 2, PAL.iron[1]); p.set(x, y, PAL.iron[2]); p.set(x, y + 2, PAL.iron[0]); } // the leaf spring
    p.set(6, 7, PAL.steel[2]); p.set(25, 7, PAL.steel[2]); p.set(15, 6, PAL.steel[2]); p.set(16, 6, PAL.steel[2]); // rivets
    p.line(2, 9, 14, 15, PAL.white[1]); p.line(29, 9, 17, 15, PAL.white[1]); // the string
    p.rect(14, 17, 17, 19, PAL.iron[1]); p.rect(11, 20, 12, 22, PAL.iron[1]); // the catch and the trigger
    p.vl(15, 2, 14, PAL.steel[1]); p.vl(16, 3, 14, PAL.steel[0]); p.set(15, 1, PAL.steel[3]); p.rect(14, 12, 17, 14, PAL.grey[2]); // the bolt
    p.hl(13, 18, 23, PAL.grey[2]); p.hl(13, 18, 24, PAL.grey[1]); // a tape wrap
    return p; },

  // ----- armour -----
  vest() { const p = P32(); // a police kevlar vest
    vestBody(p, PAL.navy);
    p.hl(7, 24, 13, PAL.navy[2]); p.hl(7, 24, 17, PAL.navy[2]); p.hl(7, 24, 21, PAL.navy[2]); // the panel's stitching
    p.rect(5, 12, 7, 23, PAL.black[1]); p.rect(24, 12, 26, 23, PAL.black[1]); // the side straps
    p.rect(12, 14, 19, 17, PAL.white[2]); p.rect(13, 15, 18, 16, PAL.navy[0]); // the patch
    return p; },
  plate() { const p = P32(); // a plate carrier with a cummerbund and molle
    vestBody(p, PAL.olive);
    p.rect(8, 10, 23, 24, PAL.olive[1]); p.hl(9, 22, 10, PAL.olive[2]); p.vl(8, 11, 24, PAL.olive[2]); p.hl(8, 23, 24, PAL.olive[0]); p.vl(23, 10, 24, PAL.olive[0]); // the plate pocket
    for (let y = 13; y <= 22; y += 3) { p.hl(9, 22, y, PAL.olive[0]); dots(p, 10, 22, y, PAL.olive[3], 4); } // molle rows
    p.rect(5, 15, 7, 26, PAL.olive[0]); p.rect(24, 15, 26, 26, PAL.olive[0]); p.rect(5, 16, 7, 25, PAL.olive[1]); p.vl(5, 16, 25, PAL.olive[2]); // the cummerbund
    p.rect(6, 4, 10, 6, PAL.olive[0]); p.rect(21, 4, 25, 6, PAL.olive[0]); p.hl(7, 9, 5, PAL.olive[1]); p.hl(22, 24, 5, PAL.olive[1]); // shoulder pads
    return p; },
  tacvest() { const p = P32(); // a black tactical vest hung with pouches
    vestBody(p, PAL.black);
    for (let k = 0; k < 3; k++) { const x = 7 + k * 6; p.rect(x, 15, x + 4, 23, PAL.coyote[1]); p.vl(x, 15, 23, PAL.coyote[2]); p.vl(x + 4, 15, 23, PAL.coyote[0]); p.rect(x, 15, x + 4, 17, PAL.coyote[2]); p.hl(x, x + 4, 17, PAL.coyote[0]); p.set(x + 2, 19, PAL.black[0]); } // the rifle mag pouches
    p.rect(7, 10, 10, 13, PAL.coyote[1]); p.rect(12, 10, 15, 13, PAL.coyote[1]); p.hl(7, 10, 10, PAL.coyote[2]); p.hl(12, 15, 10, PAL.coyote[2]); // pistol pouches
    p.rect(18, 9, 24, 13, PAL.coyote[1]); p.hl(18, 24, 9, PAL.coyote[2]); p.vl(20, 6, 8, PAL.black[3]); // the radio pouch with an antenna
    p.rect(7, 25, 24, 26, PAL.black[2]); // the lower hem
    return p; },
  tirevest() { const p = P32(); // tyre-rubber strips laced into a vest
    vestBody(p, PAL.black);
    for (let y = 10; y <= 26; y += 3) { p.hl(6, 25, y, PAL.black[0]); p.hl(6, 25, y + 1, PAL.black[2]); for (let x = 7; x <= 25; x += 4) p.set(x, y + 2, PAL.black[0]); } // the strips and their tread
    for (let y = 11; y <= 26; y += 3) { p.set(6, y, PAL.coyote[2]); p.set(25, y, PAL.coyote[2]); p.set(15, y, PAL.coyote[1]); p.set(16, y, PAL.coyote[1]); } // the lacing
    p.hl(6, 10, 4, PAL.black[2]); p.hl(21, 25, 4, PAL.black[2]);
    return p; },
  sportspads() { const p = P32(); // football shoulder pads: hard white caps over a padded chest piece
    p.rect(9, 12, 22, 27, PAL.grey[1]); p.hl(9, 22, 12, PAL.grey[2]); p.vl(9, 12, 27, PAL.grey[2]); p.hl(9, 22, 27, PAL.grey[0]); p.vl(22, 12, 27, PAL.grey[0]); // the chest piece
    p.rect(11, 15, 20, 24, PAL.grey[0]); p.vl(15, 14, 26, PAL.grey[2]); p.vl(16, 14, 26, PAL.grey[0]); for (let y = 16; y <= 24; y += 2) { p.set(14, y, PAL.white[2]); p.set(17, y, PAL.white[2]); } // the laces
    for (const side of [0, 1]) { const x0 = side ? 17 : 2, x1 = side ? 29 : 14; // the caps
      p.rect(x0, 6, x1, 13, PAL.white[1]); p.hl(x0, x1, 6, PAL.white[2]); p.hl(x0 + 1, x1 - 1, 5, PAL.white[1]); p.hl(x0 + 2, x1 - 2, 4, PAL.white[1]); p.hl(x0 + 2, x1 - 2, 4, PAL.white[2]);
      p.hl(x0, x1, 13, PAL.white[0]); p.vl(side ? x1 : x0, 6, 13, PAL.white[0]); p.hl(x0 + 1, x1 - 1, 9, PAL.white[0]); p.hl(x0 + 1, x1 - 1, 10, PAL.white[3]); // the flap seam
      p.rect(side ? x1 - 2 : x0, 14, side ? x1 : x0 + 2, 18, PAL.black[1]); } // the straps
    p.hl(13, 18, 5, PAL.black[1]); p.hl(13, 18, 6, PAL.black[1]);
    return p; },
  scrapvest() { const p = P32(); // steel plates riveted onto a work jacket
    vestBody(p, PAL.leather);
    for (const [x, y] of [[7, 10], [16, 10], [7, 19], [16, 19]]) { box(p, x, y, x + 7, y + 7, PAL.steel); p.set(x + 1, y + 1, PAL.steel[3]); p.set(x + 6, y + 1, PAL.iron[0]); p.set(x + 1, y + 6, PAL.iron[0]); p.set(x + 6, y + 6, PAL.iron[0]); p.set(x + 1, y + 1, PAL.iron[0]); p.set(x + 2, y + 2, PAL.steel[3]); }
    p.rect(11, 12, 12, 14, PAL.rust[1]); p.rect(19, 22, 21, 23, PAL.rust[1]); p.set(9, 25, PAL.rust[2]); // rust
    return p; },
  padding() { const p = P32(); // magazines duct-taped around a forearm: a glossy sleeve in three tape bands
    vcyl(p, 8, 5, 23, 28, PAL.paper); p.hl(8, 23, 28, PAL.paper[0]);
    p.rect(10, 4, 21, 5, PAL.paper[3]); dots(p, 10, 21, 4, PAL.paper[1]); p.hl(9, 22, 6, PAL.paper[0]); // the pages' edge at the top
    p.rect(11, 8, 20, 12, PAL.blue[1]); p.hl(11, 20, 8, PAL.blue[2]); p.rect(13, 14, 18, 17, PAL.red[1]); p.hl(13, 18, 14, PAL.red[2]); p.rect(11, 20, 15, 23, PAL.yellow[2]); p.rect(16, 21, 20, 25, PAL.blue[2]); // the covers' art
    p.vl(9, 7, 27, PAL.paper[3]); // the gloss
    for (const y of [10, 18, 25]) { p.rect(8, y - 1, 23, y + 1, PAL.grey[1]); p.hl(8, 23, y - 1, PAL.grey[2]); p.vl(9, y - 1, y + 1, PAL.grey[3]); p.hl(8, 23, y + 1, PAL.grey[0]); p.vl(22, y - 1, y + 1, PAL.grey[0]); p.vl(23, y - 1, y + 1, PAL.grey[0]); } // the tape bands
    p.rect(3, 12, 7, 15, PAL.grey[1]); p.hl(3, 7, 12, PAL.grey[2]); p.hl(3, 7, 15, PAL.grey[0]); p.rect(24, 20, 28, 23, PAL.grey[1]); p.hl(24, 28, 20, PAL.grey[2]); p.hl(24, 28, 23, PAL.grey[0]); // loose tape ends
    return p; },
  kneeguards() { const p = P32(); // a knee pad: a hard cap on a padded sleeve, elastic straps behind
    p.rect(2, 9, 29, 12, PAL.grey[0]); p.rect(2, 20, 29, 23, PAL.grey[0]); p.hl(2, 29, 9, PAL.grey[1]); p.hl(2, 29, 20, PAL.grey[1]); dots(p, 3, 29, 10, PAL.grey[2], 3); dots(p, 3, 29, 21, PAL.grey[2], 3); // the straps
    p.rect(26, 8, 29, 13, PAL.black[1]); p.rect(26, 19, 29, 24, PAL.black[1]); p.set(27, 10, PAL.steel[2]); p.set(27, 21, PAL.steel[2]); // the buckles
    p.ellipse(15, 17, 10, 12, PAL.black[1]); p.hl(6, 24, 29, PAL.black[0]); for (let y = 6; y <= 29; y += 3) { p.hl(6, 24, y, PAL.black[0]); } p.vl(5, 10, 24, PAL.black[2]); p.hl(10, 20, 5, PAL.black[2]); // the quilted sleeve
    for (let y = 8; y <= 22; y++) for (let x = 7; x <= 23; x++) { const nx = (x - 15) / 8.5, ny = (y - 15) / 7.5; if (nx * nx + ny * ny > 1) continue; const d = (nx + ny) / 1.4; p.set(x, y, d > 0.5 ? PAL.grey[0] : d < -0.5 ? PAL.grey[2] : PAL.grey[1]); } // the cap
    p.hl(10, 13, 10, PAL.grey[3]); p.set(9, 11, PAL.grey[3]); p.hl(10, 20, 15, PAL.grey[0]); p.hl(11, 19, 18, PAL.grey[0]); p.rect(14, 12, 16, 13, PAL.grey[0]); // the cap's gloss and its ridges, a vent
    return p; },
  bikehelmet() { const p = P32(); // a blue cycling helmet with vents
    dome(p, 16, 17, 13, 11, PAL.blue);
    p.rect(3, 22, 29, 25, PAL.black[1]); p.hl(3, 29, 22, PAL.black[2]); p.hl(4, 28, 25, PAL.black[0]); hole(p, 16, 28, 11, 3); // the foam lower edge
    for (const [x0, x1, y] of [[8, 11, 12], [13, 18, 9], [20, 24, 12], [6, 9, 17], [22, 26, 17]]) { p.hl(x0, x1, y, PAL.black[0]); p.hl(x0, x1, y + 1, PAL.black[0]); p.hl(x0, x1, y + 2, PAL.blue[0]); } // vents
    p.rect(7, 25, 9, 30, PAL.black[1]); p.rect(22, 25, 24, 30, PAL.black[1]); p.rect(15, 28, 16, 30, PAL.black[1]); // the straps
    return p; },
  riothelmet() { const p = P32(); // a black riot helmet with a clear visor
    dome(p, 16, 13, 12, 11, PAL.black);
    p.rect(5, 13, 27, 25, PAL.glass[1]); p.hl(6, 26, 13, PAL.glass[2]); p.vl(5, 14, 24, PAL.glass[2]); p.rect(7, 15, 9, 22, PAL.glass[3]); p.vl(26, 14, 25, PAL.glass[0]); p.vl(27, 14, 25, PAL.glass[0]); p.hl(6, 26, 25, PAL.glass[0]); // the visor
    p.hl(7, 25, 18, PAL.glass[2]); p.rect(4, 12, 28, 13, PAL.black[1]); p.hl(4, 28, 12, PAL.black[2]); p.set(5, 12, PAL.steel[2]); p.set(27, 12, PAL.steel[2]); // the visor's pivot band
    p.rect(3, 23, 7, 27, PAL.black[1]); p.rect(25, 23, 29, 27, PAL.black[1]); p.hl(3, 7, 23, PAL.black[2]); p.hl(25, 29, 23, PAL.black[2]); p.rect(11, 26, 21, 29, PAL.black[1]); p.hl(11, 21, 26, PAL.black[2]); // the neck guard and the chin cup
    return p; },
  milhelmet() { const p = P32(); // a combat helmet in an olive cover
    dome(p, 16, 14, 13, 11, PAL.olive);
    p.rect(2, 20, 29, 23, PAL.olive[1]); p.hl(2, 29, 20, PAL.olive[2]); p.hl(3, 28, 23, PAL.olive[0]); p.vl(29, 20, 23, PAL.olive[0]); hole(p, 16, 27, 12, 4); // the rim
    p.hl(5, 27, 16, PAL.olive[0]); p.hl(4, 28, 17, PAL.olive[0]); dots(p, 5, 27, 16, PAL.olive[3], 3); // the camo band
    p.rect(7, 23, 9, 29, PAL.olive[0]); p.rect(22, 23, 24, 29, PAL.olive[0]); p.rect(12, 28, 19, 30, PAL.olive[0]); p.hl(13, 18, 28, PAL.olive[1]); // the chin strap
    p.set(8, 8, PAL.olive[3]); p.rect(14, 5, 17, 7, PAL.olive[0]); // a cover seam
    return p; },
  footballhelmet() { const p = P32(); // a red football helmet with a steel face mask
    dome(p, 16, 14, 12, 12, PAL.red);
    p.rect(4, 15, 28, 21, PAL.red[1]); p.vl(4, 15, 21, PAL.red[2]); p.vl(28, 15, 21, PAL.red[0]); hole(p, 16, 27, 10, 6); p.rect(10, 20, 21, 22, PAL.red[1]); // the shell down over the ears
    p.circle(7, 18, 1.5, PAL.red[0]); p.set(7, 18, PAL.black[0]); p.circle(25, 18, 1.5, PAL.red[0]); p.set(25, 18, PAL.black[0]); // the ear holes
    p.hl(6, 26, 23, PAL.steel[1]); p.hl(6, 26, 27, PAL.steel[1]); p.hl(7, 26, 22, PAL.steel[2]); p.hl(7, 26, 26, PAL.steel[2]); p.vl(6, 21, 28, PAL.steel[1]); p.vl(26, 21, 28, PAL.steel[1]); p.vl(16, 23, 28, PAL.steel[1]); p.hl(6, 26, 28, PAL.steel[0]); // the mask
    p.hl(14, 18, 4, PAL.white[3]); p.vl(16, 3, 13, PAL.white[2]); p.vl(15, 4, 12, PAL.white[3]); // the centre stripe
    return p; },
  hardhat() { const p = P32(); // a yellow hard hat
    dome(p, 16, 14, 11, 11, PAL.yellow);
    p.ellipse(16, 23, 14, 3.5, PAL.yellow[1]); p.hl(3, 29, 22, PAL.yellow[2]); p.hl(2, 29, 21, PAL.yellow[2]); hole(p, 16, 20, 10, 2); p.hl(5, 27, 26, PAL.yellow[0]); p.hl(9, 23, 26, PAL.yellow[0]); p.hl(4, 28, 25, PAL.yellow[0]); // the brim
    p.ellipse(16, 19, 11, 4, PAL.yellow[1]); p.hl(7, 25, 20, PAL.yellow[0]); p.hl(6, 26, 21, PAL.yellow[0]); // the dome's base over the brim
    p.vl(15, 4, 17, PAL.yellow[2]); p.vl(16, 4, 17, PAL.yellow[2]); p.vl(16, 5, 16, PAL.yellow[3]); p.line(10, 6, 9, 17, PAL.yellow[2]); p.line(21, 5, 23, 17, PAL.yellow[0]); // the ridges
    p.rect(11, 9, 20, 12, PAL.white[2]); p.rect(12, 10, 19, 11, PAL.black[0]); dots(p, 13, 18, 10, PAL.white[3], 2); // the sticker
    return p; },
  chestrig() { const p = P32(); // a chest rig: a row of magazine pouches on an H harness
    bar(p, 4, 14, 12, 2, 2, PAL.olive); bar(p, 17, 2, 25, 14, 2, PAL.olive); p.rect(13, 2, 18, 3, PAL.olive[1]); // the harness
    p.rect(3, 13, 28, 24, PAL.olive[1]); p.hl(3, 28, 13, PAL.olive[2]); p.vl(3, 13, 24, PAL.olive[2]); p.hl(3, 28, 24, PAL.olive[0]); p.vl(28, 13, 24, PAL.olive[0]); // the body
    for (let k = 0; k < 4; k++) { const x = 4 + k * 6; p.rect(x, 15, x + 4, 25, PAL.olive[1]); p.vl(x, 15, 25, PAL.olive[2]); p.vl(x + 4, 15, 25, PAL.olive[0]); p.hl(x, x + 4, 25, PAL.olive[0]); p.rect(x, 15, x + 4, 18, PAL.olive[2]); p.hl(x, x + 4, 18, PAL.olive[0]); p.set(x + 2, 21, PAL.black[0]); p.set(x + 2, 22, PAL.black[0]); } // the pouches and their flaps and snaps
    p.rect(1, 17, 3, 19, PAL.black[1]); p.rect(28, 17, 30, 19, PAL.black[1]); // the side buckles
    p.rect(8, 26, 23, 27, PAL.olive[0]); // the waist strap
    return p; },
  ceramicplate() { const p = P32(); // a SAPI plate, coyote tan, with its label
    for (let y = 4; y <= 28; y++) { const cut = y < 8 ? 8 - y : 0; p.hl(7 + cut, 24 - cut, y, PAL.coyote[1]); p.set(7 + cut, y, PAL.coyote[2]); p.set(24 - cut, y, PAL.coyote[0]); }
    p.hl(11, 20, 4, PAL.coyote[2]); p.hl(8, 23, 28, PAL.coyote[0]); p.hl(9, 22, 27, PAL.coyote[0]);
    p.vl(8, 9, 26, PAL.coyote[3]); p.hl(9, 10, 8, PAL.coyote[3]); // the specular on the curved face
    p.rect(10, 14, 21, 21, PAL.paper[2]); p.hl(10, 21, 14, PAL.paper[3]); p.hl(11, 20, 16, PAL.black[0]); p.hl(11, 17, 18, PAL.black[1]); p.hl(11, 19, 20, PAL.black[1]); p.rect(16, 18, 20, 18, PAL.red[1]); // the label
    return p; },

  // ----- packs -----
  slingbag() { const p = P32(); // a small cross-body bag
    bar(p, 8, 13, 24, 1, 3, PAL.black); // the strap
    box(p, 7, 12, 25, 28, PAL.grey); p.rect(7, 12, 25, 14, PAL.grey[2]); p.hl(8, 24, 14, PAL.grey[0]);
    p.hl(9, 23, 17, PAL.black[1]); dots(p, 10, 23, 17, PAL.steel[2]); p.rect(20, 18, 21, 20, PAL.black[1]); // the zip and its pull
    p.rect(9, 20, 23, 26, PAL.grey[1]); p.hl(9, 23, 20, PAL.grey[2]); p.hl(9, 23, 26, PAL.grey[0]); p.vl(23, 20, 26, PAL.grey[0]); // the front pocket
    p.rect(3, 9, 7, 13, PAL.black[1]); p.hl(3, 7, 9, PAL.black[2]); p.set(5, 11, PAL.steel[2]); // the buckle
    return p; },
  backpack() { const p = P32(); // a blue school backpack
    p.rect(8, 3, 23, 6, PAL.blue[1]); hole(p, 15.5, 2, 5, 1.5); p.hl(9, 22, 3, PAL.blue[2]); // the grab handle
    box(p, 6, 7, 25, 28, PAL.blue); p.rect(7, 6, 24, 7, PAL.blue[1]); p.hl(8, 23, 6, PAL.blue[2]); p.hl(7, 24, 28, PAL.blue[0]);
    p.hl(8, 23, 10, PAL.black[1]); dots(p, 9, 23, 10, PAL.steel[2]); p.rect(21, 11, 22, 13, PAL.black[1]); // the main zip
    box(p, 9, 16, 22, 26, PAL.blue); p.hl(10, 21, 16, PAL.black[1]); dots(p, 11, 21, 16, PAL.steel[2]); p.rect(11, 17, 12, 19, PAL.black[1]); // the front pocket and its zip
    p.rect(4, 8, 5, 18, PAL.black[1]); p.rect(26, 8, 27, 18, PAL.black[1]); p.vl(4, 8, 18, PAL.black[2]); // the shoulder straps peeking out
    p.rect(13, 19, 18, 22, PAL.white[2]); p.rect(14, 20, 17, 21, PAL.red[1]); // the logo patch
    return p; },
  assaultpack() { const p = P32(); // an olive assault pack with molle
    p.rect(10, 3, 21, 5, PAL.olive[1]); hole(p, 15.5, 2, 4, 1.2); p.hl(11, 20, 3, PAL.olive[2]);
    box(p, 6, 6, 25, 28, PAL.olive); p.hl(7, 24, 28, PAL.olive[0]);
    for (let y = 10; y <= 24; y += 3) { p.hl(8, 23, y, PAL.olive[0]); for (let x = 8; x <= 23; x += 4) { p.set(x, y, PAL.olive[1]); p.set(x, y + 1, PAL.olive[3]); } } // molle webbing
    p.rect(12, 9, 19, 14, PAL.olive[1]); p.hl(12, 19, 9, PAL.olive[2]); p.hl(13, 18, 11, PAL.black[1]); dots(p, 13, 18, 11, PAL.steel[2]); // the admin pocket
    p.rect(6, 19, 8, 21, PAL.black[1]); p.rect(23, 19, 25, 21, PAL.black[1]); p.hl(6, 25, 20, PAL.black[1]); // the compression strap and buckles
    p.rect(4, 7, 5, 16, PAL.olive[0]); p.rect(26, 7, 27, 16, PAL.olive[0]);
    return p; },
  hikingpack() { const p = P32(); // a tall red hiking pack with a lid and side pockets
    box(p, 7, 9, 24, 29, PAL.red); p.hl(8, 23, 29, PAL.red[0]);
    p.rect(5, 2, 26, 9, PAL.red[1]); p.hl(6, 25, 2, PAL.red[2]); p.hl(5, 26, 3, PAL.red[2]); p.vl(5, 3, 9, PAL.red[2]); p.vl(26, 3, 9, PAL.red[0]); p.hl(5, 26, 9, PAL.red[0]); p.rect(13, 1, 18, 2, PAL.red[0]); // the lid and its handle
    p.rect(3, 13, 6, 25, PAL.red[1]); p.vl(3, 13, 25, PAL.red[2]); p.hl(3, 6, 25, PAL.red[0]); p.rect(25, 13, 28, 25, PAL.red[1]); p.vl(28, 13, 25, PAL.red[0]); p.hl(25, 28, 25, PAL.red[0]); p.hl(3, 6, 15, PAL.red[0]); p.hl(25, 28, 15, PAL.red[0]); // side pockets
    p.hl(8, 23, 13, PAL.black[1]); p.hl(8, 23, 20, PAL.black[1]); p.rect(14, 12, 17, 14, PAL.black[0]); p.rect(14, 19, 17, 21, PAL.black[0]); // compression straps and buckles
    p.rect(9, 22, 22, 28, PAL.red[1]); p.hl(9, 22, 22, PAL.red[2]); p.hl(10, 21, 25, PAL.black[1]); dots(p, 11, 21, 25, PAL.steel[2]); // the bottom pocket
    p.hl(10, 13, 10, PAL.red[3]); // the top's gloss
    return p; },
  rucksack() { const p = P32(); // a big olive canvas rucksack with a buckled flap
    box(p, 4, 9, 27, 29, PAL.olive); p.hl(5, 26, 29, PAL.olive[0]);
    p.rect(4, 22, 9, 29, PAL.olive[1]); p.vl(4, 22, 29, PAL.olive[2]); p.hl(4, 9, 22, PAL.olive[2]); p.vl(9, 22, 29, PAL.olive[0]); p.rect(22, 22, 27, 29, PAL.olive[1]); p.hl(22, 27, 22, PAL.olive[2]); p.vl(22, 22, 29, PAL.olive[0]); // the side pockets
    p.rect(5, 3, 26, 13, PAL.olive[1]); p.hl(6, 25, 3, PAL.olive[2]); p.hl(5, 26, 4, PAL.olive[2]); p.vl(5, 4, 13, PAL.olive[2]); p.hl(5, 26, 13, PAL.olive[0]); p.vl(26, 4, 13, PAL.olive[0]); p.hl(6, 25, 14, PAL.olive[0]); // the flap
    for (const x of [10, 20]) { p.rect(x, 8, x + 1, 19, PAL.leather[1]); p.vl(x, 8, 19, PAL.leather[2]); p.rect(x - 1, 15, x + 2, 17, PAL.brass[2]); p.set(x, 16, PAL.brass[0]); } // the straps and buckles
    p.rect(13, 1, 18, 3, PAL.olive[0]); hole(p, 15.5, 1, 2, 1); // the handle
    p.rect(12, 20, 19, 27, PAL.olive[1]); p.hl(12, 19, 20, PAL.olive[2]); p.hl(12, 19, 27, PAL.olive[0]); // the centre pocket
    return p; },
  duffle() { const p = P32(); // a canvas duffle bag
    for (const x of [[6, 13], [18, 25]]) { p.rect(x[0], 4, x[1], 11, PAL.canvas[1]); hole(p, (x[0] + x[1]) / 2, 6.5, (x[1] - x[0]) / 2 - 1.5, 2); p.hl(x[0] + 1, x[1] - 1, 4, PAL.canvas[2]); } // the handles
    hcyl(p, 2, 11, 29, 26, PAL.green); p.ellipse(3, 18.5, 2, 7.5, PAL.green[0]); p.ellipse(28, 18.5, 2, 7.5, PAL.green[0]); p.vl(28, 13, 24, PAL.green[1]); p.vl(29, 14, 23, PAL.green[0]); p.vl(2, 13, 24, PAL.green[2]); // the body and its ends
    p.hl(5, 26, 14, PAL.black[1]); dots(p, 6, 26, 14, PAL.steel[2]); p.rect(24, 15, 26, 16, PAL.black[1]); // the zip
    p.rect(9, 11, 10, 26, PAL.canvas[0]); p.rect(21, 11, 22, 26, PAL.canvas[0]); p.vl(9, 12, 25, PAL.canvas[1]); p.vl(21, 12, 25, PAL.canvas[1]); // the handle straps around
    p.rect(12, 18, 19, 22, PAL.paper[2]); p.hl(13, 18, 20, PAL.black[0]); // the name tag
    return p; },

  // ----- tools -----
  flashlight() { const p = P32(); // a black torch, lit, lying with its head to the right
    hcyl(p, 2, 12, 19, 19, PAL.black); for (let x = 4; x <= 11; x += 2) p.vl(x, 13, 18, PAL.black[0]); p.rect(1, 11, 3, 20, PAL.black[1]); p.vl(1, 12, 19, PAL.black[2]); p.hl(1, 3, 20, PAL.black[0]); // the knurled grip and the tail cap
    p.rect(13, 13, 15, 14, PAL.rust[2]); p.set(13, 13, PAL.rust[3]); // the switch
    for (let x = 19; x <= 27; x++) { const h = 3.5 + (x - 19) * 0.5; p.vl(x, r2(15.5 - h), r2(15.5 + h), PAL.black[1]); p.set(x, r2(15.5 - h), PAL.black[2]); p.set(x, r2(15.5 - h) + 1, PAL.black[3]); p.set(x, r2(15.5 + h), PAL.black[0]); p.set(x, r2(15.5 + h) - 1, PAL.black[0]); } // the head
    p.rect(27, 8, 28, 23, PAL.black[1]); p.vl(27, 9, 22, PAL.black[2]); p.rect(28, 9, 29, 22, PAL.glass[2]); p.vl(29, 10, 21, PAL.yellow[3]); p.set(28, 10, PAL.glass[3]); p.set(28, 11, PAL.glass[3]); // the bezel and the lens
    p.vl(30, 10, 21, PAL.yellow[2]); p.set(30, 8, PAL.yellow[3]); p.set(30, 23, PAL.yellow[3]); // the beam
    return p; },
  headlamp() { const p = P32(); // a headlamp on its elastic band
    ring(p, 16, 18, 14, 10, 3, PAL.grey); for (let x = 3; x <= 28; x += 3) p.set(x, 27, PAL.grey[0]); p.hl(6, 26, 8, PAL.grey[2]); p.hl(5, 10, 24, PAL.grey[0]); p.hl(22, 27, 24, PAL.grey[0]); // the band with its weave
    box(p, 9, 5, 22, 15, PAL.black); p.rect(9, 5, 22, 6, PAL.black[2]);
    p.circle(15.5, 10.5, 3.2, PAL.glass[1]); p.set(14, 9, PAL.glass[3]); p.set(15, 9, PAL.glass[3]); p.set(16, 11, PAL.yellow[3]); p.circle(15.5, 10.5, 1, PAL.yellow[3]); // the lens
    p.rect(19, 7, 20, 8, PAL.rust[2]); // the switch
    p.rect(7, 7, 8, 13, PAL.black[1]); p.rect(23, 7, 24, 13, PAL.black[1]); // the hinge brackets
    return p; },
  lantern() { const p = P32(); // a camping lantern, lit
    for (let x = 8; x <= 23; x++) { const t = (x - 15.5) / 8; p.set(x, r2(1 + 4 * t * t), PAL.steel[1]); } p.set(15, 1, PAL.steel[2]); p.set(16, 1, PAL.steel[2]); // the bail
    box(p, 8, 6, 23, 9, PAL.steel); p.rect(13, 4, 18, 6, PAL.steel[0]); // the cap
    p.rect(9, 10, 22, 22, PAL.yellow[3]); p.rect(9, 10, 22, 11, PAL.yellow[2]); p.rect(9, 20, 22, 22, PAL.yellow[2]); p.rect(12, 13, 19, 19, PAL.yellow[3]); p.rect(14, 14, 17, 17, PAL.white[3]); // the glass globe and the glowing mantle
    p.vl(9, 10, 22, PAL.glass[3]); p.vl(21, 10, 22, PAL.yellow[1]); p.vl(22, 10, 22, PAL.yellow[0]);
    p.vl(12, 10, 22, PAL.steel[0]); p.vl(19, 10, 22, PAL.steel[0]); // the cage wires
    box(p, 8, 23, 23, 29, PAL.steel); p.rect(8, 23, 23, 24, PAL.steel[2]); p.hl(9, 22, 27, PAL.steel[0]); p.rect(24, 24, 26, 26, PAL.rust[2]); // the base and the knob
    return p; },
  torch() { const p = P32(); // a pitch-soaked branch, burning
    bar(p, 9, 30, 15, 17, 4, PAL.wood); p.line(11, 29, 15, 20, PAL.wood[0]); p.set(8, 25, PAL.wood[1]); p.set(7, 24, PAL.wood[1]); // the branch with a knot
    p.rect(12, 13, 20, 18, PAL.black[1]); p.hl(12, 20, 13, PAL.black[2]); p.hl(13, 20, 18, PAL.black[0]); p.hl(13, 19, 15, PAL.black[0]); p.hl(12, 19, 17, PAL.black[0]); // the wrapped rag
    p.ellipse(16, 8, 5, 6, PAL.flame[0]); p.ellipse(16.5, 9, 3.5, 4.5, PAL.flame[1]); p.ellipse(17, 10, 2, 3, PAL.flame[2]); p.rect(17, 11, 18, 13, PAL.flame[3]); // the flame
    p.set(11, 4, PAL.flame[0]); p.set(14, 2, PAL.flame[1]); p.set(16, 1, PAL.flame[1]); p.set(21, 4, PAL.flame[2]); p.set(23, 8, PAL.flame[1]); p.set(22, 2, PAL.flame[0]); // the licks and sparks
    return p; },
  handradio() { const p = P32(); // a wind-up emergency radio
    p.vl(24, 1, 10, PAL.black[1]); p.vl(25, 1, 10, PAL.black[3]); p.set(24, 1, PAL.steel[2]); // the antenna
    box(p, 4, 10, 25, 27, PAL.yellow); p.rect(4, 10, 25, 11, PAL.yellow[2]);
    p.rect(6, 13, 15, 24, PAL.black[1]); for (let y = 14; y <= 23; y += 2) for (let x = 7; x <= 14; x += 2) p.set(x, y, PAL.black[0]); p.hl(6, 15, 13, PAL.black[2]); // the speaker grille
    p.rect(17, 13, 23, 16, PAL.glass[3]); p.hl(18, 22, 14, PAL.red[2]); p.hl(18, 20, 15, PAL.black[0]); // the dial
    ball(p, 20, 21, 2.2, PAL.black); // the tuning knob
    p.rect(26, 15, 27, 20, PAL.steel[1]); p.rect(27, 20, 29, 21, PAL.steel[1]); p.rect(28, 21, 29, 24, PAL.black[1]); p.set(26, 15, PAL.steel[2]); // the crank
    p.rect(6, 8, 15, 9, PAL.black[1]); hole(p, 10.5, 7, 3.5, 1); // the handle
    p.hl(6, 23, 26, PAL.black[1]); // the base
    return p; },
  milradio() { const p = P32(); // a military manpack set with its handset
    p.vl(23, 1, 9, PAL.black[1]); p.vl(24, 1, 9, PAL.black[0]); p.rect(22, 7, 25, 9, PAL.black[1]); // the whip antenna
    box(p, 4, 9, 23, 29, PAL.olive); p.rect(4, 9, 23, 10, PAL.olive[2]);
    ball(p, 8, 14, 2.5, PAL.black); ball(p, 15, 14, 2.5, PAL.black); p.set(8, 12, PAL.white[3]); p.set(16, 13, PAL.white[3]); // the knobs
    p.rect(6, 19, 15, 23, PAL.black[0]); p.hl(7, 14, 20, PAL.green[3]); p.hl(7, 11, 22, PAL.green[2]); // the display
    p.rect(17, 19, 21, 23, PAL.black[1]); p.set(19, 21, PAL.olive[3]); // a connector
    for (let y = 25; y <= 27; y++) dots(p, 6, 21, y, PAL.olive[0], 2); // the vent
    p.rect(26, 14, 30, 25, PAL.black[1]); p.hl(26, 30, 14, PAL.black[2]); p.rect(26, 15, 29, 17, PAL.black[0]); p.rect(26, 22, 29, 24, PAL.black[0]); p.vl(30, 15, 25, PAL.black[0]); // the handset
    for (let y = 24; y <= 29; y++) p.set(23 + (y % 2) * 2, y, PAL.black[1]); // the coiled cord
    return p; },
  nvg() { const p = P32(); // night vision goggles: two tubes under a mount
    p.rect(13, 1, 18, 8, PAL.black[1]); p.vl(13, 1, 8, PAL.black[2]); p.vl(18, 1, 8, PAL.black[0]); p.rect(11, 2, 20, 4, PAL.black[1]); p.hl(11, 20, 2, PAL.black[2]); p.set(15, 6, PAL.steel[2]); // the mount
    box(p, 5, 8, 26, 13, PAL.black); p.rect(5, 8, 26, 9, PAL.black[2]); p.rect(14, 10, 17, 12, PAL.black[0]); ball(p, 23, 11, 1.5, PAL.steel); // the bridge and the gain knob
    for (const x of [5, 18]) { vcyl(p, x, 13, x + 8, 28, PAL.black); p.hl(x, x + 8, 28, PAL.black[0]); p.hl(x + 1, x + 7, 13, PAL.black[2]); p.rect(x - 1, 23, x + 9, 26, PAL.black[1]); p.hl(x - 1, x + 9, 23, PAL.black[2]); p.hl(x, x + 8, 26, PAL.black[0]); } // the tubes and their objective rings
    p.rect(6, 27, 12, 29, PAL.green[1]); p.rect(19, 27, 25, 29, PAL.green[1]); p.hl(7, 11, 28, PAL.green[3]); p.hl(20, 24, 28, PAL.green[3]); p.hl(6, 12, 29, PAL.green[0]); p.hl(19, 25, 29, PAL.green[0]); // the lenses
    return p; },
  waterfilter() { const p = P32(); // a charcoal filter: a bucket cut away to show the layers, a tap, a drop
    for (let y = 4; y <= 24; y++) { const inset = r2((y - 4) / 7); p.hl(7 + inset, 24 - inset, y, PAL.white[1]); p.set(7 + inset, y, PAL.white[2]); p.set(24 - inset, y, PAL.white[0]); }
    p.ellipse(15.5, 4, 9, 2, PAL.white[2]); p.hl(10, 21, 4, PAL.white[0]); p.hl(10, 21, 24, PAL.white[0]);
    p.rect(11, 6, 20, 22, PAL.grey[0]); p.rect(11, 6, 20, 9, PAL.grey[2]); p.rect(11, 10, 20, 14, PAL.coyote[2]); p.rect(11, 15, 20, 19, PAL.black[1]); p.rect(11, 20, 20, 22, PAL.glass[1]); // gravel, sand, charcoal, clean water
    dots(p, 12, 19, 7, PAL.grey[3], 3); dots(p, 13, 19, 8, PAL.grey[0], 3); dots(p, 12, 19, 12, PAL.coyote[3], 2); dots(p, 12, 19, 17, PAL.black[3], 3); p.hl(12, 19, 20, PAL.glass[3]);
    p.rect(24, 20, 28, 22, PAL.steel[1]); p.hl(24, 28, 20, PAL.steel[2]); p.rect(26, 18, 27, 19, PAL.red[2]); // the tap
    p.rect(27, 24, 28, 25, PAL.glass[1]); p.circle(27.5, 27.5, 1.6, PAL.glass[2]); p.set(27, 27, PAL.glass[3]); // the drop
    p.hl(8, 23, 29, PAL.glass[0]); p.hl(9, 22, 29, PAL.glass[1]); // the puddle
    return p; },
  surgkit() { const p = P32(); // a canvas instrument roll, open: scalpel, scissors, forceps
    box(p, 2, 8, 29, 27, PAL.green); p.rect(2, 8, 29, 11, PAL.green[0]); p.hl(3, 28, 8, PAL.green[2]); p.hl(2, 29, 11, PAL.green[2]); // the roll and its pocket flap
    p.rect(2, 8, 29, 9, PAL.green[1]); for (let x = 7; x <= 24; x += 8) p.vl(x, 12, 26, PAL.green[0]); // the pocket seams
    p.rect(4, 2, 5, 23, PAL.black[1]); p.rect(4, 20, 5, 25, PAL.black[0]); p.rect(4, 2, 5, 8, PAL.steel[2]); p.vl(4, 2, 8, PAL.steel[3]); // the scalpel
    p.line(10, 2, 15, 22, PAL.steel[1]); p.line(15, 2, 10, 22, PAL.steel[2]); ring(p, 11, 24, 2, 2.5, 1, PAL.steel); ring(p, 15, 24, 2, 2.5, 1, PAL.steel); p.set(12, 12, PAL.steel[0]); // the scissors
    p.line(20, 1, 21, 20, PAL.steel[2]); p.line(23, 1, 22, 20, PAL.steel[1]); p.rect(20, 20, 23, 24, PAL.steel[1]); p.set(21, 1, PAL.steel[3]); // the forceps
    p.rect(26, 14, 27, 24, PAL.white[2]); p.vl(27, 14, 24, PAL.white[0]); // a packet of sutures
    p.rect(2, 28, 29, 29, PAL.green[0]); p.rect(12, 28, 19, 30, PAL.canvas[2]); // the tie
    return p; },
  bandagekit() { const p = P32(); // a gauze roll, a splint and tape
    bar(p, 2, 28, 28, 19, 3, PAL.ash); p.line(4, 27, 26, 19, PAL.ash[0]); // the splint
    hcyl(p, 3, 6, 17, 17, PAL.white); p.hl(3, 17, 6, PAL.white[3]); for (let x = 4; x <= 16; x += 2) p.vl(x, 8, 15, PAL.white[1]); // the roll's gauze weave
    p.ellipse(18, 11.5, 2.5, 5.5, PAL.white[2]); p.ellipse(18, 11.5, 1.6, 3.5, PAL.white[1]); p.ellipse(18, 11.5, 0.7, 1.5, PAL.white[0]); p.set(17, 8, PAL.white[3]); p.vl(16, 7, 16, PAL.white[2]); // its rolled end
    p.rect(7, 16, 14, 18, PAL.white[1]); p.hl(7, 14, 18, PAL.white[0]); p.hl(8, 14, 16, PAL.white[2]); // the loose tail
    ring(p, 25, 9, 4.5, 4.5, 2, PAL.grey); p.circle(25, 9, 2, PAL.grey[0]); p.set(23, 6, PAL.grey[3]); p.hl(22, 23, 7, PAL.grey[2]); p.set(28, 12, PAL.grey[0]); // the tape roll
    return p; },
  traumakit() { const p = P32(); // an IFAK pouch with a red cross patch
    box(p, 5, 6, 26, 28, PAL.coyote); p.rect(5, 6, 26, 7, PAL.coyote[2]);
    p.hl(6, 25, 10, PAL.black[1]); p.vl(25, 10, 24, PAL.black[1]); dots(p, 7, 25, 10, PAL.steel[2]); vdots(p, 25, 11, 23, PAL.steel[2]); p.rect(23, 11, 24, 13, PAL.black[1]); // the zip
    for (let y = 13; y <= 23; y += 4) { p.hl(6, 9, y, PAL.coyote[0]); p.hl(6, 9, y + 1, PAL.coyote[3]); } // the side molle
    p.rect(11, 13, 21, 23, PAL.white[2]); p.hl(11, 21, 13, PAL.white[3]); p.vl(21, 13, 23, PAL.white[0]); p.hl(11, 21, 23, PAL.white[0]); cross(p, 16, 18, 3, PAL.red[1]); p.set(15, 15, PAL.red[2]); p.set(13, 17, PAL.red[2]); // the patch
    p.rect(13, 3, 19, 6, PAL.red[1]); p.hl(13, 19, 3, PAL.red[2]); hole(p, 16, 2.5, 2, 0.8); // the pull tab
    return p; },
  tourniquet() { const p = P32(); // a windlass tourniquet: the looped strap, the rod across it
    ring(p, 16, 19, 13, 9, 4, PAL.black); p.hl(6, 10, 12, PAL.black[2]); p.hl(4, 6, 15, PAL.black[2]); p.hl(10, 22, 27, PAL.black[0]); p.hl(10, 22, 28, PAL.black[0]); // the strap
    p.rect(13, 14, 21, 17, PAL.black[1]); p.hl(13, 21, 14, PAL.black[2]); // the strap's inner fold
    hcyl(p, 4, 6, 27, 10, PAL.grey); p.rect(4, 6, 5, 10, PAL.grey[0]); p.rect(26, 6, 27, 10, PAL.grey[0]); // the windlass rod
    p.rect(22, 9, 28, 13, PAL.red[1]); p.hl(22, 28, 9, PAL.red[2]); p.hl(23, 28, 13, PAL.red[0]); p.hl(23, 26, 11, PAL.white[3]); // the red time tag
    p.rect(6, 18, 9, 23, PAL.grey[1]); p.hl(6, 9, 18, PAL.grey[2]); p.hl(6, 9, 23, PAL.grey[0]); p.set(7, 20, PAL.grey[0]); p.set(8, 21, PAL.grey[0]); // the buckle
    return p; },

  // ----- throwables and consumables -----
  molotov() { const p = P32(); // a bottle with a burning rag in the neck
    vcyl(p, 10, 15, 21, 29, PAL.bottle); p.hl(10, 21, 29, PAL.bottle[0]); p.rect(12, 10, 19, 15, PAL.bottle[1]); p.vl(12, 10, 15, PAL.bottle[2]); p.vl(13, 10, 15, PAL.bottle[3]); p.vl(19, 10, 15, PAL.bottle[0]); p.hl(10, 11, 15, PAL.bottle[2]); // the bottle and its neck
    p.rect(12, 19, 19, 28, PAL.amber[1]); p.vl(12, 19, 28, PAL.amber[2]); p.vl(11, 19, 28, PAL.bottle[3]); p.vl(19, 19, 28, PAL.amber[0]); p.hl(12, 19, 19, PAL.amber[2]); // the fuel, seen through the glass
    p.rect(13, 6, 18, 10, PAL.paper[2]); p.vl(13, 6, 10, PAL.paper[3]); p.vl(18, 6, 10, PAL.paper[0]); p.rect(11, 9, 20, 10, PAL.paper[1]); // the rag
    p.ellipse(16, 4.5, 3, 3, PAL.flame[1]); p.rect(15, 4, 17, 6, PAL.flame[2]); p.set(16, 5, PAL.flame[3]); p.set(13, 1, PAL.flame[0]); p.set(19, 2, PAL.flame[1]); p.set(18, 1, PAL.flame[2]); // the flame
    p.rect(10, 22, 21, 24, PAL.paper[2]); p.hl(11, 20, 23, PAL.black[0]); p.vl(10, 22, 24, PAL.paper[3]); // a scrap of label
    return p; },
  pipebomb() { const p = P32(); // a capped steel pipe, taped, with a fuse
    vcyl(p, 10, 9, 21, 27, PAL.iron); p.hl(11, 20, 9, PAL.iron[2]);
    box(p, 9, 6, 22, 9, PAL.iron); box(p, 9, 27, 22, 30, PAL.iron); p.hl(10, 21, 6, PAL.iron[3]); // the end caps
    p.rect(10, 15, 21, 20, PAL.grey[1]); p.vl(10, 15, 20, PAL.grey[2]); p.vl(11, 15, 20, PAL.grey[3]); p.vl(20, 15, 20, PAL.grey[0]); p.vl(21, 15, 20, PAL.grey[0]); p.hl(12, 19, 17, PAL.grey[0]); // the tape
    p.rect(14, 4, 17, 5, PAL.iron[1]); p.line(15, 3, 18, 1, PAL.canvas[2]); p.line(18, 1, 21, 2, PAL.canvas[1]); // the fuse
    p.set(22, 1, PAL.flame[3]); p.set(23, 2, PAL.flame[2]); p.set(24, 1, PAL.flame[2]); p.set(21, 1, PAL.flame[1]); // the spark
    return p; },
  flare() { const p = P32(); // a road flare, lit
    vcyl(p, 11, 10, 20, 29, PAL.red); p.hl(11, 20, 29, PAL.red[0]); p.hl(12, 19, 18, PAL.white[2]); p.hl(12, 19, 19, PAL.black[0]); p.hl(12, 19, 20, PAL.black[0]); // the stick and its label band
    box(p, 10, 8, 21, 11, PAL.black); // the striker cap
    p.ellipse(15.5, 5, 5, 4, PAL.flame[0]); p.ellipse(15.5, 5.5, 3.5, 3, PAL.flame[2]); p.circle(15.5, 6, 2, PAL.white[3]); p.set(15, 7, PAL.white[3]); p.set(16, 7, PAL.white[3]); // the burning tip
    p.set(9, 2, PAL.flame[2]); p.set(23, 3, PAL.flame[1]); p.set(21, 1, PAL.flame[3]); p.set(8, 7, PAL.flame[1]); p.set(24, 8, PAL.flame[3]); p.set(12, 1, PAL.flame[1]); // sparks
    return p; },
  smokegren() { const p = P32(); canister(p, PAL.olive, PAL.yellow); p.hl(12, 19, 20, PAL.olive[0]); p.hl(12, 19, 22, PAL.olive[0]); return p; },
  flashbang() { const p = P32(); canister(p, PAL.steel); for (let y = 12; y <= 26; y += 3) for (let x = 12; x <= 19; x += 3) p.set(x + ((y / 3) % 2 | 0), y, PAL.iron[0]); p.rect(12, 5, 19, 8, PAL.black[1]); p.hl(12, 19, 5, PAL.black[2]); return p; },
  puritabs() { const p = P32(); // a tube of iodine tablets, two beside it
    vcyl(p, 9, 10, 18, 29, PAL.amber); p.hl(9, 18, 29, PAL.amber[0]); box(p, 8, 5, 19, 10, PAL.white); for (let x = 10; x <= 17; x += 2) p.vl(x, 6, 9, PAL.white[1]);
    p.rect(9, 14, 18, 23, PAL.paper[3]); p.vl(9, 14, 23, PAL.paper[2]); p.vl(18, 14, 23, PAL.paper[0]); p.hl(11, 16, 16, PAL.black[1]); p.hl(11, 16, 18, PAL.blue[1]); p.hl(11, 14, 20, PAL.black[1]); // the label
    ball(p, 23, 22, 2.5, PAL.white); ball(p, 27, 26, 2.5, PAL.white); p.hl(22, 24, 22, PAL.white[0]); // the tablets
    return p; },
  coffee() { const p = P32(); // a sealed tin of ground coffee
    vcyl(p, 7, 7, 24, 29, PAL.red); p.hl(7, 24, 29, PAL.red[0]);
    p.ellipse(15.5, 7, 8.5, 2.5, PAL.steel[2]); p.ellipse(15.5, 7, 6.5, 1.5, PAL.steel[1]); p.hl(10, 13, 6, PAL.steel[3]); p.hl(7, 24, 9, PAL.red[0]); // the lid
    p.rect(7, 13, 24, 23, PAL.paper[2]); p.vl(7, 13, 23, PAL.paper[3]); p.vl(8, 13, 23, PAL.paper[3]); p.vl(23, 13, 23, PAL.paper[0]); p.vl(24, 13, 23, PAL.paper[0]); // the label band
    p.rect(12, 15, 18, 20, PAL.wood[1]); p.rect(13, 16, 17, 20, PAL.white[3]); p.rect(13, 16, 17, 17, PAL.wood[0]); p.rect(19, 16, 20, 18, PAL.wood[1]); p.set(15, 14, PAL.white[1]); p.set(14, 13, PAL.white[1]); // the cup
    p.hl(9, 22, 21, PAL.wood[0]); p.hl(10, 20, 22, PAL.red[1]); // the name
    return p; },
  batteries() { const p = P32(); // a blister pack of four AA cells
    box(p, 4, 3, 27, 29, PAL.paper); p.rect(4, 3, 27, 7, PAL.blue[1]); p.hl(5, 26, 3, PAL.blue[2]); hole(p, 15.5, 4.5, 1.5, 1); p.hl(7, 24, 5, PAL.white[3]); p.hl(7, 24, 6, PAL.white[3]); // the card and its header
    for (let k = 0; k < 4; k++) { const x = 6 + k * 5; p.rect(x, 12, x + 3, 27, PAL.black[1]); p.vl(x, 12, 27, PAL.black[2]); p.vl(x + 3, 12, 27, PAL.black[0]); p.rect(x, 12, x + 3, 15, PAL.copper[1]); p.vl(x, 12, 15, PAL.copper[2]); p.vl(x + 3, 12, 15, PAL.copper[0]); p.rect(x + 1, 10, x + 2, 11, PAL.copper[2]); p.hl(x, x + 3, 20, PAL.gold[2]); p.hl(x, x + 3, 25, PAL.gold[1]); } // the cells
    p.vl(5, 9, 28, PAL.white[3]); p.hl(5, 26, 9, PAL.white[3]); // the bubble's glint
    return p; },
  cigarettes() { const p = P32(); // a carton of ten packs
    box(p, 3, 11, 28, 25, PAL.white, 4); p.hl(3, 28, 25, PAL.white[0]); p.vl(28, 11, 25, PAL.white[0]);
    p.rect(3, 17, 28, 20, PAL.red[1]); p.hl(3, 28, 17, PAL.red[2]); p.hl(3, 28, 20, PAL.red[0]); p.hl(3, 28, 16, PAL.gold[2]); p.hl(3, 28, 21, PAL.gold[2]); // the band
    for (let x = 6; x <= 26; x += 5) { p.vl(x, 11, 14, PAL.white[1]); p.set(x, 11, PAL.white[0]); } // the packs showing on the top
    p.rect(8, 22, 23, 24, PAL.white[3]); p.hl(9, 22, 23, PAL.black[1]); // the brand
    p.rect(22, 3, 28, 10, PAL.white[1]); p.hl(22, 28, 3, PAL.white[2]); p.vl(28, 3, 10, PAL.white[0]); p.rect(22, 6, 28, 8, PAL.red[1]); // one pack standing behind
    return p; },
  whiskey() { const p = P32(); // a bottle of bourbon
    p.rect(12, 2, 19, 5, PAL.black[1]); p.hl(12, 19, 2, PAL.black[2]); p.hl(12, 19, 5, PAL.black[0]); // the cap
    p.rect(13, 6, 18, 11, PAL.amber[1]); p.vl(13, 6, 11, PAL.amber[2]); p.vl(14, 6, 11, PAL.glass[3]); p.vl(18, 6, 11, PAL.amber[0]); // the neck
    p.rect(11, 11, 20, 13, PAL.amber[1]); p.hl(11, 20, 11, PAL.amber[2]); // the shoulders
    vcyl(p, 9, 13, 22, 29, PAL.amber); p.vl(10, 13, 28, PAL.glass[3]); p.hl(9, 22, 29, PAL.amber[0]); p.hl(10, 21, 13, PAL.amber[2]);
    p.rect(10, 17, 21, 25, PAL.black[1]); p.hl(10, 21, 17, PAL.black[2]); p.hl(11, 20, 25, PAL.black[0]); p.rect(12, 19, 19, 20, PAL.gold[2]); p.hl(12, 17, 22, PAL.paper[2]); p.hl(12, 19, 23, PAL.gold[1]); // the label
    return p; },

  // ----- books -----
  medbook: () => book(PAL.white, (p, cx, cy) => { cross(p, cx, cy, 4, PAL.red[1]); p.set(cx - 1, cy - 3, PAL.red[2]); p.set(cx - 3, cy - 1, PAL.red[2]); }),
  gunbook: () => book(PAL.olive, (p, cx, cy) => { ring(p, cx, cy, 5, 5, 1.2, PAL.black); p.hl(cx - 6, cx + 6, cy, PAL.black[1]); p.vl(cx, cy - 6, cy + 6, PAL.black[1]); p.set(cx, cy, PAL.red[2]); p.set(cx - 3, cy - 3, PAL.black[2]); }),
  survivalbook: () => book(PAL.green, (p, cx, cy) => { for (let y = 0; y < 8; y++) p.hl(cx - (y >> 1), cx + (y >> 1), cy - 5 + y, y % 3 === 2 ? PAL.green[0] : PAL.green[3]); p.rect(cx, cy + 3, cx + 1, cy + 5, PAL.wood[1]); p.hl(cx - 5, cx + 6, cy + 6, PAL.green[0]); }),
  comic: () => { const p = book(PAL.yellow, (q, cx, cy) => {
    for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4; q.line(cx, cy, r2(cx + Math.cos(ang) * (a % 2 ? 4 : 6)), r2(cy + Math.sin(ang) * (a % 2 ? 4 : 6)), PAL.red[1]); } q.circle(cx, cy, 3.5, PAL.red[2]); q.circle(cx, cy, 2, PAL.white[3]); q.set(cx - 1, cy - 1, PAL.white[3]);
    q.rect(9, 6, 23, 8, PAL.blue[1]); q.hl(10, 22, 7, PAL.white[3]); q.rect(10, 22, 20, 24, PAL.white[3]); q.hl(11, 19, 23, PAL.black[1]); }); // the masthead and a caption
    p.rect(8, 7, 26, 7, PAL.paper[2]); p.rect(9, 9, 26, 9, PAL.paper[1]); p.hl(10, 26, 11, PAL.paper[0]); // the stack's loose edges
    return p; },

  // ----- valuables -----
  goldring() { const p = P32(); // a wedding band, seen a little from above
    const out = (x, y) => { const nx = (x - 16) / 11.5, ny = (y - 16) / 10.5; return nx * nx + ny * ny; }, inn = (x, y) => { const nx = (x - 16) / 7.5, ny = (y - 14.5) / 6.5; return nx * nx + ny * ny; };
    for (let y = 5; y <= 27; y++) for (let x = 4; x <= 28; x++) { if (out(x, y) > 1 || inn(x, y) <= 1) continue; const d = ((x - 16) / 11.5 + (y - 16) / 10.5) / 1.4; p.set(x, y, inn(x, y) < 1.35 && y > 16 ? PAL.gold[2] : d > 0.5 ? PAL.gold[0] : d < -0.5 ? PAL.gold[2] : PAL.gold[1]); } // the band, its inside lit at the bottom
    p.hl(9, 12, 8, PAL.gold[3]); p.vl(7, 9, 12, PAL.gold[3]); p.set(8, 8, PAL.gold[3]); p.set(22, 25, PAL.gold[2]); p.hl(17, 20, 20, PAL.gold[3]); // the specular, the inner reflection
    return p; },
  watch() { const p = P32(); // a steel wristwatch on a leather strap
    p.rect(12, 1, 19, 8, PAL.leather[1]); p.vl(12, 1, 8, PAL.leather[2]); p.vl(19, 1, 8, PAL.leather[0]); p.rect(12, 23, 19, 30, PAL.leather[1]); p.vl(12, 23, 30, PAL.leather[2]); p.vl(19, 23, 30, PAL.leather[0]); vdots(p, 15, 24, 29, PAL.leather[0]); p.rect(11, 29, 20, 30, PAL.steel[1]); p.set(15, 27, PAL.steel[2]); // the strap and buckle
    ball(p, 16, 15.5, 8.5, PAL.steel); p.circle(16, 15.5, 6.5, PAL.paper[3]); p.circle(16, 15.5, 6, PAL.paper[3]);
    for (let a = 0; a < 12; a++) { const ang = a * Math.PI / 6; p.set(r2(16 + Math.cos(ang) * 5.2), r2(15.5 + Math.sin(ang) * 5.2), a % 3 ? PAL.paper[0] : PAL.black[1]); } // the indices
    p.line(16, 15, 16, 11, PAL.black[0]); p.line(16, 15, 19, 17, PAL.black[0]); p.set(16, 15, PAL.black[0]); p.set(21, 10, PAL.steel[3]); p.set(10, 10, PAL.steel[3]); // the hands
    p.rect(25, 14, 26, 17, PAL.steel[1]); p.set(25, 14, PAL.steel[2]); // the crown
    return p; },
  coins() { const p = P32(); // a paper roll of silver rounds, one leaning on it
    vcyl(p, 7, 8, 18, 27, PAL.paper); p.hl(7, 18, 27, PAL.paper[0]); p.rect(6, 5, 19, 8, PAL.paper[1]); p.hl(7, 18, 5, PAL.paper[3]); p.rect(6, 27, 19, 29, PAL.paper[1]); p.hl(6, 19, 29, PAL.paper[0]); for (let x = 7; x <= 18; x += 3) { p.vl(x, 5, 7, PAL.paper[0]); p.vl(x, 27, 29, PAL.paper[0]); } // the roll and its crimped ends
    p.rect(8, 13, 17, 20, PAL.blue[1]); p.hl(9, 16, 15, PAL.white[3]); p.hl(9, 15, 18, PAL.white[3]); p.vl(8, 13, 20, PAL.blue[2]); // the wrapper's band
    ball(p, 24, 22, 6, PAL.steel); p.circle(24, 22, 4, PAL.steel[2]); ring(p, 24, 22, 4.5, 4.5, 0.8, PAL.steel); p.set(23, 20, PAL.steel[3]); p.rect(23, 21, 25, 24, PAL.steel[1]); p.vl(24, 21, 24, PAL.steel[0]); // the coin, its rim, a stamped figure
    return p; },
  phone() { const p = P32(); // a smartphone, screen dark
    box(p, 8, 2, 23, 29, PAL.black); p.rect(8, 2, 23, 3, PAL.black[2]);
    p.rect(9, 5, 22, 25, PAL.navy[0]); p.vl(9, 5, 25, PAL.navy[1]); p.hl(9, 22, 5, PAL.navy[1]); p.line(10, 6, 10, 15, PAL.navy[2]); p.line(11, 6, 11, 11, PAL.navy[2]); // the glass and its reflection
    p.line(14, 8, 19, 14, PAL.white[1]); p.line(19, 14, 16, 18, PAL.white[1]); p.line(16, 18, 20, 23, PAL.white[0]); // a crack
    p.hl(13, 18, 3, PAL.black[0]); p.circle(15.5, 27, 1.4, PAL.black[0]); p.set(15, 27, PAL.black[3]); // the speaker and the button
    p.rect(24, 8, 24, 11, PAL.black[2]); // the power button
    return p; },
  camera() { const p = P32(); // a digital camera
    box(p, 3, 9, 28, 26, PAL.black); p.rect(3, 9, 28, 10, PAL.black[2]); p.rect(9, 6, 19, 9, PAL.black[1]); p.hl(9, 19, 6, PAL.black[2]); p.rect(22, 7, 26, 9, PAL.steel[1]); p.hl(22, 26, 7, PAL.steel[2]); // the body, the prism hump, the shutter button
    p.rect(3, 12, 7, 24, PAL.black[0]); p.rect(4, 13, 6, 23, PAL.leather[0]); vdots(p, 5, 14, 22, PAL.black[2]); // the grip
    ball(p, 16, 18, 7, PAL.iron); p.circle(16, 18, 5, PAL.black[0]); p.circle(16, 18, 3.5, PAL.glass[0]); p.circle(16.5, 18.5, 2, PAL.glass[1]); p.set(14, 16, PAL.glass[3]); p.set(15, 16, PAL.glass[3]); p.set(18, 20, PAL.blue[2]); // the lens
    p.rect(22, 12, 26, 15, PAL.glass[2]); p.set(23, 13, PAL.white[3]); p.rect(23, 18, 26, 20, PAL.red[2]); // the flash and a logo
    p.hl(9, 19, 8, PAL.black[0]); p.hl(4, 27, 26, PAL.black[0]);
    return p; },
};

// ---------- category fallbacks ----------
export const FALLBACK_ART = {
  book: () => book(PAL.leather, (p, cx, cy) => { p.rect(cx - 5, cy - 4, cx + 5, cy - 2, PAL.gold[1]); p.hl(cx - 4, cx + 4, cy - 3, PAL.gold[2]); p.hl(cx - 4, cx + 4, cy + 2, PAL.gold[1]); }),
  valuable() { const p = P32(); // a cut gem
    for (let y = 6; y <= 27; y++) { const w = y < 12 ? 4 + (y - 6) * 1.7 : (27 - y) * 0.95; p.hl(r2(15.5 - w), r2(15.5 + w), y, PAL.glass[1]); }
    p.hl(12, 19, 6, PAL.glass[3]); p.line(5, 12, 26, 12, PAL.glass[3]); p.line(5, 12, 11, 6, PAL.glass[2]); p.line(26, 12, 20, 6, PAL.glass[0]); // the table and the girdle
    p.line(5, 13, 15, 27, PAL.glass[3]); p.line(26, 13, 16, 27, PAL.glass[0]); p.line(10, 12, 15, 27, PAL.glass[2]); p.line(21, 12, 16, 27, PAL.glass[0]); p.line(12, 7, 15, 12, PAL.glass[2]); p.line(19, 7, 16, 12, PAL.glass[0]); // facets
    for (let y = 13; y <= 26; y++) for (let x = 16; x <= 26; x++) if (p.get(x, y) === PAL.glass[1]) p.set(x, y, PAL.glass[0]); p.rect(7, 8, 9, 10, PAL.glass[3]); // the shadow side, the sparkle
    return p; },
  weapon() { const p = P32(); // a plain dagger
    bar(p, 3, 28, 9, 22, 3, PAL.leather); p.circle(3, 28, 1.5, PAL.steel[1]);
    bar(p, 7, 21, 11, 17, 2, PAL.steel); bar(p, 9, 19, 13, 23, 2, PAL.steel);
    bar(p, 11, 20, 28, 3, 5, PAL.steel, 1, PAL.steel[3]); p.line(12, 20, 25, 7, PAL.steel[2]);
    return p; },
  armor() { const p = P32(); vestBody(p, PAL.grey); p.hl(7, 24, 14, PAL.grey[0]); p.hl(7, 24, 20, PAL.grey[0]); p.rect(14, 10, 17, 25, PAL.grey[0]); dots(p, 15, 16, 12, PAL.grey[3], 1); vdots(p, 15, 12, 24, PAL.grey[2], 3); return p; },
  tool() { const p = P32(); // an adjustable wrench
    bar(p, 4, 28, 19, 14, 4, PAL.steel); p.rect(3, 27, 7, 30, PAL.steel[1]); p.set(4, 28, PAL.steel[2]);
    p.rect(17, 4, 25, 15, PAL.steel[1]); p.hl(17, 25, 4, PAL.steel[2]); p.vl(17, 4, 15, PAL.steel[2]); p.vl(25, 5, 15, PAL.steel[0]); p.hl(18, 25, 15, PAL.steel[0]); // the head
    for (let y = 7; y <= 11; y++) for (let x = 22; x <= 29; x++) p.clear(x, y); // the jaw's gap p.rect(26, 11, 29, 14, PAL.steel[1]); p.hl(26, 29, 11, PAL.steel[2]); p.vl(29, 11, 14, PAL.steel[0]); p.rect(16, 8, 17, 11, PAL.steel[0]); vdots(p, 16, 8, 11, PAL.steel[2], 1); // the jaw and the worm screw
    return p; },
  pack() { const p = P32(); box(p, 6, 7, 25, 28, PAL.canvas); p.rect(7, 5, 24, 7, PAL.canvas[1]); p.hl(8, 23, 5, PAL.canvas[2]); p.rect(10, 3, 21, 5, PAL.canvas[0]); hole(p, 15.5, 3, 4, 1); p.hl(8, 23, 11, PAL.black[1]); dots(p, 9, 23, 11, PAL.steel[2]); box(p, 9, 16, 22, 26, PAL.canvas); p.rect(4, 8, 5, 18, PAL.canvas[0]); p.rect(26, 8, 27, 18, PAL.canvas[0]); return p; },
  medical() { const p = P32(); box(p, 4, 7, 27, 27, PAL.white, 3); p.hl(5, 26, 10, PAL.white[0]); cross(p, 15.5, 19, 5, PAL.red[1], 1); p.rect(15, 14, 16, 24, PAL.red[1]); p.rect(10, 18, 21, 19, PAL.red[1]); p.set(11, 18, PAL.red[2]); p.hl(15, 16, 14, PAL.red[2]); p.rect(14, 4, 17, 7, PAL.steel[1]); p.hl(14, 17, 4, PAL.steel[2]); return p; },
};
FALLBACK_ART.explosive = () => { const p = P32(); // a fragmentation grenade: the body's grid cut into the sphere's shading
  ball(p, 15.5, 19, 9.5, PAL.olive);
  for (let y = 12; y <= 27; y += 4) for (let x = 6; x <= 25; x++) if (p.get(x, y)) p.set(x, y, shade(p.get(x, y), -0.35));
  for (let x = 8; x <= 24; x += 4) for (let y = 10; y <= 28; y++) if (p.get(x, y)) p.set(x, y, shade(p.get(x, y), -0.35));
  box(p, 12, 6, 19, 10, PAL.iron); p.rect(20, 7, 21, 24, PAL.steel[1]); p.vl(20, 7, 24, PAL.steel[2]); p.hl(16, 21, 7, PAL.steel[2]); ring(p, 9, 6, 3, 3, 1, PAL.steel); p.set(8, 5, PAL.steel[3]);
  return p; };

// The fallback for a GEAR entry: by trade category, then by slot, then a book. Guns (cat pistol / shotgun / rifle /
// automatic, the launchers in explosive) get none: the game draws them with ui/gunart.js.
const CAT_FALLBACK = { books: "book", luxury: "book", jewelry: "valuable", collectibles: "valuable", gadgets: "valuable", melee: "weapon", bow: "weapon", armor: "armor", medical: "medical", packs: "pack", tools: "tool", explosive: "explosive" };
const SLOT_FALLBACK = { armor: "armor", head: "armor", legs: "armor", arms: "armor", insert: "armor", backpack: "pack", rig: "pack", tool: "tool" };
export function fallbackKind(key) {
  const d = GEAR[key]; if (!d) return null;
  return CAT_FALLBACK[d.cat] || SLOT_FALLBACK[d.slot] || (d.book ? "book" : null);
}
export function paintItemHD(key) {
  if (ITEM_ART[key]) return ITEM_ART[key]();
  const kind = fallbackKind(key);
  return kind ? FALLBACK_ART[kind]() : null;
}

// ---------- the design sheet ----------
export const SHEET_TITLE = "Item icons (HD, 32 × 32): supplies, melee, bows, armour, packs, tools, consumables, books, valuables, fallbacks";
export const SHEET_COLS = 10;
export const SHEET = [
  ...Object.keys(ITEM_ART).map((key) => ({ label: key, paint: () => paintItemHD(key) })),
  ...Object.keys(FALLBACK_ART).map((kind) => ({ label: `(${kind})`, paint: () => FALLBACK_ART[kind]() })),
];
