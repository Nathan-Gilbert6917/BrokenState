// HD gun parts (design preview only: src/ is unchanged): every look of ui/gunparts.js PART_ART and MOD_LOOK, and every
// data-driven kind (PART_KINDS), drawn at 2× on the 128 × 48 gun grid in the item icons' style (design/hd/gunkit.js).
//   STOCKS_HD[kind].draw(p, [x, y], colourName)   the stock kinds of ui/gunpaint.js STOCKS, HD;
//   MAGS_HD[kind].draw(p, [x, y], o)              the magazine kinds of ui/gunpaint.js MAGS, HD;
//   KINDS_HD[kind] = { slot, d, draw(p, [x, y], o, ctx) }   the part kinds of ui/gunparts.js PART_KINDS, HD;
//   PART_HD[look] = { kind, ...options }           every hand-drawn look of ui/gunart.js PART_ART as a kind + options;
//   drawPart(p, look, [x, y], ctx)                 a look, or a { kind } spec, at its anchor;
//   partLookHD(part key, slot)                     a part's look (GEAR look / MOD_LOOK / magazine keys / PART_SPEC and
//                                                  the word guess, through ui/gunparts.js partSpecOf);
//   partIcon(look or spec, w = 48, h = 32)         the part alone on a 48 × 32 cell with a grey stub of what it fits to.
// Anchors (HD grid): an optic's [x, y] has y the top row of the rail, the sight drawn from y - 1 up; a muzzle device's
// x is the barrel's last column and y the bore's top row (14), drawn from x + 1 right; a magazine's is the top-left of
// its first row below the well; a stock's x is its first column behind the receiver, y its centre row; grips, lights
// and bipods hang from y + 1 under a fore-end whose bottom row is y; a rail / light slot's y is the fore-end's side.
import { painter } from "./hdcore.js";
import { M, IRON, STEEL, BLACK, WOOD, OLIVE, COYOTE, GLASS, BRASS, RED, GREY, PAL, isWood, R, H, V, dots, vdots, box, cyl, vcyl, rail, gripHD, guardHD, stockHD, magHD, pin, lensV, lensF } from "./gunkit.js";
import { MOD_LOOK, partSpecOf } from "../../src/ui/gunparts.js";
import { GEAR } from "../../src/sim/data.js";

const PAD = BLACK; // rubber buttpads
const mOf = (c, d = "gun") => M(c == null ? d : c);

// ---------- stocks: (p, [x, y] its first column behind the receiver and its centre row, colour name) ----------
// len: columns behind the anchor (for the builder's layout and the small drawings).
const tube = (p, x0, x1, y, m = IRON) => { cyl(p, x0, x1, y - 1, y + 2, m, { capR: false }); }; // a buffer tube
export const STOCKS_HD = {
  ar:      { len: 20, draw: (p, [x, y], c) => stockHD(p, x, y, 20, y - 3, y + 8, mOf(c), { pad: PAD, grain: isWood(c) }) },
  a2:      { len: 26, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 26, y - 3, y + 8, m, { pad: PAD }); R(p, x - 23, y + 1, x - 20, y + 4, m[0]); R(p, x - 22, y + 2, x - 21, y + 3, m[2]); } }, // the trapdoor
  tele:    { len: 24, draw: (p, [x, y], c) => { const m = mOf(c); tube(p, x - 17, x, y); box(p, x - 22, y - 3, x - 12, y + 6, m, { wide: true }); R(p, x - 24, y - 3, x - 23, y + 8, PAD[1]); V(p, x - 24, y - 3, y + 8, PAD[0]); R(p, x - 19, y + 3, x - 15, y + 4, m[0]); p.set(x - 13, y - 2, m[3]); } }, // the sliding stock, its release lever
  crane:   { len: 26, draw: (p, [x, y], c) => { const m = mOf(c); tube(p, x - 15, x, y); box(p, x - 24, y - 5, x - 12, y + 6, m, { wide: true }); H(p, x - 22, x - 14, y - 5, m[3]); R(p, x - 26, y - 5, x - 25, y + 8, PAD[1]); V(p, x - 26, y - 5, y + 8, PAD[0]); R(p, x - 21, y - 2, x - 17, y + 1, m[0]); R(p, x - 20, y - 1, x - 18, y, m[1]); R(p, x - 18, y + 3, x - 15, y + 4, m[0]); } }, // the battery tubes, the lever
  scar:    { len: 26, draw: (p, [x, y], c) => { const m = mOf(c); box(p, x - 24, y - 5, x, y - 1, m); H(p, x - 20, x - 6, y - 5, m[3]); for (let i = 0; i <= 24; i++) R(p, x - i, y + 2 + Math.floor(i / 8), y + 3 + Math.floor(i / 8), m[1]); H(p, x - 24, x - 1, y + 2, m[2]); box(p, x - 24, y, x - 22, y + 8, m); R(p, x - 26, y - 5, x - 25, y + 8, PAD[1]); V(p, x - 26, y - 5, y + 8, PAD[0]); box(p, x - 2, y - 3, x, y + 4, IRON); } },
  wire:    { len: 22, draw: (p, [x, y], c) => { const m = mOf(c, "gun"); cyl(p, x - 20, x, y - 3, y - 1, m, { capR: false }); cyl(p, x - 20, x, y + 3, y + 5, m, { capR: false }); box(p, x - 22, y - 3, x - 20, y + 8, m); } },
  mp5:     { len: 22, draw: (p, [x, y], c) => { const m = mOf(c, "gun"); cyl(p, x - 20, x, y - 1, y + 1, m, { capR: false }); cyl(p, x - 20, x, y + 5, y + 7, m, { capR: false }); box(p, x - 22, y - 1, x - 19, y + 10, m); R(p, x - 23, y - 1, x - 23, y + 10, PAD[0]); } },
  ump:     { len: 24, draw: (p, [x, y], c) => { const m = mOf(c, "poly"); box(p, x - 22, y - 3, x, y - 1, m); box(p, x - 22, y + 5, x, y + 7, m); for (let i = 0; i < 8; i++) R(p, x - 4 - i, y - 2 + i, x - 3 - i, y - 1 + i, m[1]); box(p, x - 24, y - 3, x - 21, y + 8, m); R(p, x - 26, y - 3, x - 25, y + 8, PAD[1]); V(p, x - 26, y - 3, y + 8, PAD[0]); } },
  fal:     { len: 28, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 28, y - 3, y + 10, m, { pad: PAD, grain: isWood(c), cheek: !isWood(c) }); } },
  g3:      { len: 26, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 26, y - 5, y + 8, m, { pad: PAD, cheek: true }); R(p, x - 3, y - 3, x, y - 2, m[1]); } },
  m14:     { len: 30, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 30, y - 1, y + 12, m, { pad: STEEL, grain: true }); box(p, x - 2, y + 2, x + 5, y + 6, m, { spec: false }); } }, // the wrist under the receiver
  m240:    { len: 24, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 24, y - 5, y + 10, m, { pad: PAD }); box(p, x - 2, y - 3, x, y + 2, IRON); } },
  wood:    { len: 30, draw: (p, [x, y], c) => stockHD(p, x, y, 30, y - 3, y + 10, mOf(c), { pad: IRON, grain: true }) },
  sporter: { len: 30, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 30, y - 3, y + 10, m, { pad: PAD, grain: true }); for (let i = 10; i <= 24; i++) { const t = i < 12 || i > 22 ? 1 : 2; V(p, x - i, y - 3 - t, y - 3, m[1]); p.set(x - i, y - 3 - t, m[2]); } } }, // a Monte Carlo comb
  pgwood:  { len: 28, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 28, y - 3, y + 10, m, { pad: PAD, grain: true }); gripHD(p, x - 3, y + 3, 7, 6, m, { slope: 2, ribs: false }); } },
  lever:   { len: 28, draw: (p, [x, y], c) => stockHD(p, x, y, 28, y - 1, y + 10, mOf(c), { pad: STEEL, grain: true }) },
  light:   { len: 28, draw: (p, [x, y], c) => stockHD(p, x, y, 28, y - 3, y + 8, mOf(c), { pad: IRON, grain: isWood(c) }) },
  poly:    { len: 26, draw: (p, [x, y], c) => stockHD(p, x, y, 26, y - 3, y + 10, mOf(c), { pad: PAD, grain: isWood(c) }) },
  sniper:  { len: 32, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 32, y - 5, y + 10, m, { pad: PAD, cheek: true }); R(p, x - 22, y - 5, x - 8, y - 4, m[2]); H(p, x - 21, x - 9, y - 5, m[3]); R(p, x - 16, y + 7, x - 13, y + 10, m[0]); } }, // the adjustable cheek piece, a monopod socket
  thumb:   { len: 32, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 32, y - 5, y + 10, m, { pad: PAD, grain: true }); for (let yy = y + 1; yy <= y + 5; yy++) for (let xx = x - 9; xx <= x - 4; xx++) { const nx = (xx - (x - 6.5)) / 3.4, ny = (yy - (y + 3)) / 3; if (nx * nx + ny * ny <= 1) p.clear(xx, yy); } H(p, x - 8, x - 5, y + 6, m[0]); } }, // the thumbhole
  sawn:    { len: 8, draw: (p, [x, y], c) => { const m = mOf(c); gripHD(p, x, y - 2, 12, 7, m, { slope: 5, ribs: false }); if (isWood(c)) for (let i = 2; i < 10; i += 3) p.set(x - Math.round(i * 5 / 11) + 2, y - 2 + i, m[0]); } },
  amr:     { len: 24, draw: (p, [x, y], c) => { const m = mOf(c); stockHD(p, x, y, 23, y - 5, y + 8, m, { pad: PAD }); R(p, x - 18, y - 5, x - 6, y - 4, m[2]); } },
  m79:     { len: 24, draw: (p, [x, y], c) => stockHD(p, x, y, 24, y - 3, y + 10, mOf(c), { pad: PAD, grain: true }) },
  folder:  { len: 22, draw: (p, [x, y], c) => { const m = mOf(c, "gun"); cyl(p, x - 20, x, y - 3, y - 1, m, { capR: false }); cyl(p, x - 20, x - 8, y + 4, y + 6, m); for (let i = 0; i < 8; i++) R(p, x - i, y + 4 - Math.floor(i / 2), y + 5 - Math.floor(i / 2), m[1]); box(p, x - 22, y - 3, x - 20, y + 6, m); box(p, x - 1, y - 3, x, y + 1, IRON); } },
  brace:   { len: 18, draw: (p, [x, y], c) => { const m = mOf(c, "gun"); tube(p, x - 10, x, y); box(p, x - 17, y - 3, x - 10, y + 6, m, { wide: true }); R(p, x - 18, y - 3, x - 18, y + 6, PAD[0]); H(p, x - 18, x - 11, y + 8, PAL.leather[1]); H(p, x - 18, x - 11, y + 9, PAL.leather[0]); } },
  none:    { len: 0, draw: () => {} },
};
// The builder's stock looks (ui/gunart.js PART_ART) as STOCKS_HD kinds and colours.
const STOCK_LOOKS = {
  stock_ar: ["ar", "gun"], stock_fixed: ["ar", "gun"], collapsible: ["tele", "gun"], precision: ["sniper", "gun"], fold: ["folder", "gun"], pad: ["ar", "gun"],
  stock_skel: ["wire", "gun"], stock_ak: ["ak", "wood"], stock_mp5: ["mp5", "gun"], stock_wood: ["wood", "wood"], stock_lever: ["lever", "wood"],
  stock_light: ["light", "woodL"], stock_poly: ["poly", "gun"], stock_sniper: ["sniper", "olive"], stock_sawn: ["sawn", "wood"], stock_amr: ["amr", "gun"],
};
STOCKS_HD.ak = { len: 24, draw: (p, [x, y], c) => stockHD(p, x, y, 24, y - 1, y + 10, mOf(c), { pad: IRON, grain: isWood(c) }) };

// ---------- magazines: (p, [x, y] the top-left of the first row below the well, options) ----------
const stick = (p, [x, y], o, m) => magHD(p, x, y, o.n * 2, o.w * 2, m, (o.curve || 0) * 2, { ribs: o.ribs, floor: o.base ? M(o.base) : IRON });
export const MAGS_HD = {
  stick: { draw: (p, a, o) => stick(p, a, { n: 8, w: 4, curve: 3, ...o }, mOf(o.col, "gun")) },
  curve: { draw: (p, a, o) => stick(p, a, { n: 8, w: 4, curve: 2, ...o, ribs: true }, mOf(o.col, "gun")) },
  box:   { draw: (p, a, o) => stick(p, a, { n: 6, w: 5, curve: 0, ...o }, mOf(o.col, "gun")) },
  clear: { draw: (p, [x, y], o) => { // a translucent magazine: the rounds show through
    const q = { n: 8, w: 4, curve: 4, ...o }, m = ["#86999a", "#aebfbd", "#cfdbd9", "#eef5f3"], n = q.n * 2, w = q.w * 2, cv = q.curve * 2;
    for (let i = 0; i < n; i++) { const s = x + (cv ? Math.floor(i / cv) : 0); H(p, s, s + w - 1, y + i, m[1]); p.set(s, y + i, m[2]); p.set(s + w - 1, y + i, m[0]); }
    for (let i = 1; i < n - 4; i += 2) { const s = x + (cv ? Math.floor(i / cv) : 0); H(p, s + 2, s + w - 3, y + i, i % 4 === 1 ? BRASS[1] : BRASS[0]); p.set(s + w - 3, y + i, BRASS[2]); }
    const s = x + (cv ? Math.floor((n - 1) / cv) : 0); H(p, s, s + w - 1, y + n - 1, m[0]); H(p, s, s + w - 1, y + n - 2, m[0]); p.set(x, y, m[3]);
  } },
  drum:  { draw: (p, [x, y], o) => { const m = mOf(o && o.col, "gun"); R(p, x, y, x + 7, y + 1, m[1]); H(p, x, x + 7, y, m[2]);
    const cx = x + 4, cy = y + 9, r = 7.5;
    for (let yy = y + 2; yy <= y + 16; yy++) for (let xx = x - 4; xx <= x + 12; xx++) { const nx = (xx - cx) / r, ny = (yy - cy) / r, d = nx * nx + ny * ny; if (d > 1) continue; const l = (nx + ny) / 1.4; p.set(xx, yy, l > 0.5 ? m[0] : l < -0.5 ? m[2] : m[1]); }
    for (let yy = y + 3; yy <= y + 15; yy++) for (let xx = x - 3; xx <= x + 11; xx++) { const nx = (xx - cx) / 5, ny = (yy - cy) / 5, d = nx * nx + ny * ny; if (d < 1.12 && d > 0.78 && p.get(xx, yy)) p.set(xx, yy, m[0]); } // the rib ring
    R(p, cx - 1, cy - 1, cx, cy, m[2]); p.set(cx - 2, cy - 3, m[3]); } },
  beltbox: { draw: (p, [x, y], o) => { const m = mOf(o && o.col, "od"); box(p, x - 6, y + 2, x + 10, y + 14, m, { wide: true, spec: false }); H(p, x - 5, x + 9, y + 5, m[0]); R(p, x - 2, y + 8, x + 5, y + 10, m[0]); R(p, x - 1, y + 9, x + 4, y + 9, m[2]); // the box, its lid seam, the label
    R(p, x - 2, y, x + 9, y + 1, BRASS[1]); for (let xx = x - 1; xx <= x + 8; xx += 2) { p.set(xx, y, BRASS[2]); p.set(xx, y + 1, BRASS[0]); } } }, // the links up into the feed tray
  top:   { draw: (p, [x, y], o) => { const n = (o.len || 20) * 2, m = ["#86999a", "#aebfbd", "#cfdbd9", "#eef5f3"]; cyl(p, x, x + n, y, y + 3, m); for (let xx = x + 2; xx < x + n - 2; xx += 3) { p.set(xx, y + 2, BRASS[1]); p.set(xx, y + 1, BRASS[2]); } } },
  none:  { draw: () => {} },
};
const MAG_LOOKS = { stick10: { t: "stick", n: 4, w: 4, curve: 0 }, stick20: { t: "stick", n: 6, w: 4, curve: 4 }, stick30: { t: "stick", n: 8, w: 4, curve: 3 }, stick40: { t: "stick", n: 10, w: 4, curve: 3 }, smg30: { t: "stick", n: 9, w: 3, curve: 3 }, ak30: { t: "curve", n: 8, w: 4, curve: 2 }, box10: { t: "box", n: 4, w: 5 }, box20: { t: "box", n: 6, w: 5 }, drum: { t: "drum" }, belt: { t: "beltbox" } };

// ---------- the part kinds ----------
const scopeShape = (p, [x, y], len, bell, m, o = {}) => {
  const L = len * 2, b = bell * 2;
  // rings and base first (behind the tube)
  rail(p, x - L + 2, x + L - 2, y - 2, IRON); // the base
  box(p, x - Math.floor(L / 2) - 1, y - 9, x - Math.floor(L / 2) + 1, y - 2, IRON, { spec: false }); box(p, x + Math.floor(L / 2) - 1, y - 9, x + Math.floor(L / 2) + 1, y - 2, IRON, { spec: false }); // the rings
  cyl(p, x - L, x + L, y - 8, y - 4, m); // the tube
  cyl(p, x - L - 3, x - L + 2, y - 9, y - 3, m, { capL: true }); // the eyepiece
  cyl(p, x + L - 3, x + L + 3, y - 8 - b, y - 3, m); // the objective bell
  lensV(p, x + L + 3, y - 7 - b, y - 4); lensV(p, x - L - 3, y - 8, y - 4); // the lenses
  box(p, x - 1, y - 12, x + 2, y - 9, IRON, { spec: false }); H(p, x - 1, x + 2, y - 12, m[2]); // the elevation turret
  box(p, x + 3, y - 7, x + 5, y - 5, IRON, { spec: false }); // the windage turret
  if (o.scrap) { H(p, x - 2, x + 4, y - 6, COYOTE[1]); H(p, x - 2, x + 4, y - 5, COYOTE[0]); H(p, x + L - 6, x + L - 2, y - 7, COYOTE[1]); } // tape
  if (o.lens) p.set(x + L + 3, y - 5 - b, M(o.lens)[2]);
};
const canShape = (p, [x, y], o) => {
  const m = mOf(o.col, "gun"), L = o.len * 2, rows = (o.rows || 4) * 2, y0 = y + 1 - rows / 2, y1 = y0 + rows - 1;
  cyl(p, x + 1, x + L, y0, y1, m);
  V(p, x + 3, y0 + 1, y1 - 1, m[0]); V(p, x + 4, y0 + 1, y1 - 1, m[2]); // the knurled mount ring
  if (o.bands) for (let i = 8; i < L - 2; i += 8) { V(p, x + i, y0 + 1, y1 - 1, m[0]); V(p, x + i + 1, y0 + 1, y1 - 1, m[2]); }
  else V(p, x + L - 3, y0 + 1, y1 - 1, m[0]);
  R(p, x + L, y, x + L, y + 1, m[0]); p.set(x + L, y, "#1c2230"); // the bore in the end cap
};
export const KINDS_HD = {
  // sights (up from the anchor: the rail's top row)
  dot: { slot: "optic", d: { len: 2, col: "gun", lens: "red" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2 + 2;
    box(p, x - L + 2, y - 2, x + L - 2, y - 1, IRON, { spec: false }); pin(p, x - 1, y - 2, IRON); R(p, x + L - 4, y - 2, x + L - 3, y - 2, IRON[2]); // the mount, its screw and lever
    cyl(p, x - L, x + L, y - 7, y - 3, m); box(p, x - L, y - 8, x - L + 2, y - 3, m, { spec: false }); box(p, x + L - 3, y - 8, x + L, y - 3, m, { spec: false }); // the tube, its lens hoods
    lensV(p, x + L, y - 7, y - 4); lensV(p, x - L, y - 7, y - 4); p.set(x - L + 1, y - 6, M(o.lens)[2]); // the lenses, the dot
    box(p, x - 1, y - 10, x + 1, y - 8, m, { spec: false }); p.set(x - 1, y - 10, m[2]); box(p, x + 2, y - 6, x + 3, y - 4, m, { spec: false }); } }, // the caps
  holo: { slot: "optic", d: { len: 3, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2;
    box(p, x - L, y - 2, x + L, y - 1, IRON, { spec: false }); box(p, x - L, y - 9, x + L, y - 3, m, { wide: true, spec: false }); // the base, the hood
    lensF(p, x - L + 2, y - 8, x + L - 4, y - 4); p.set(x - 1, y - 6, RED[2]); p.set(x - 2, y - 6, RED[1]); // the window, the reticle
    R(p, x - L + 1, y - 10, x + L - 1, y - 10, m[2]); dots(p, x - L + 2, x + L - 2, y - 7, m[0], 3); R(p, x + L - 2, y - 7, x + L - 1, y - 5, m[2]); } }, // the buttons
  mini: { slot: "optic", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2;
    H(p, x - L, x + L - 1, y - 1, IRON[0]); box(p, x - L, y - 6, x + L - 1, y - 2, m, { spec: false }); // the plate, the housing
    lensF(p, x - L + 2, y - 5, x + L - 3, y - 3); p.set(x + L - 3, y - 4, RED[2]); R(p, x - L + 1, y - 7, x + L - 2, y - 7, m[1]); p.set(x - L + 1, y - 7, m[2]); } },
  prism: { slot: "optic", d: { len: 4, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2;
    box(p, x - L + 1, y - 2, x + L - 2, y - 1, IRON, { spec: false }); pin(p, x - 2, y - 2, IRON);
    cyl(p, x - L, x + L - 2, y - 8, y - 3, m); cyl(p, x + L - 3, x + L + 1, y - 9, y - 3, m); cyl(p, x - L - 1, x - L + 1, y - 8, y - 4, m, { capL: true }); // the body, the objective, the eyepiece
    lensV(p, x + L + 1, y - 8, y - 4); lensV(p, x - L - 1, y - 7, y - 5);
    H(p, x - 2, x + L - 4, y - 9, RED[1]); p.set(x - 1, y - 9, RED[2]); } }, // the fibre optic
  scope: { slot: "optic", d: { len: 5, bell: 1, col: "gun" }, draw: (p, a, o) => scopeShape(p, a, o.len, o.bell, mOf(o.col), o) },
  magnifier: { slot: "optic", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2, cx = x - 12;
    box(p, cx - 3, y - 2, cx + 3, y - 1, IRON, { spec: false }); box(p, cx + 2, y - 7, cx + 3, y - 3, IRON, { spec: false }); // the flip mount
    cyl(p, cx - L - 1, cx + L + 1, y - 8, y - 3, m); lensV(p, cx + L + 1, y - 7, y - 4); lensV(p, cx - L - 1, y - 7, y - 4); } },
  thermal: { slot: "optic", d: { col: "olive" }, draw: (p, [x, y], o) => { const m = mOf(o.col);
    box(p, x - 8, y - 2, x + 6, y - 1, IRON, { spec: false }); box(p, x - 10, y - 10, x + 8, y - 3, m, { wide: true, spec: false }); // the base, the housing
    cyl(p, x + 8, x + 12, y - 9, y - 3, m); R(p, x + 12, y - 8, x + 12, y - 4, "#5a1e1e"); p.set(x + 12, y - 7, "#a04040"); // the germanium objective
    dots(p, x - 8, x + 6, y - 9, m[0], 2); box(p, x - 9, y - 7, x - 6, y - 5, IRON, { spec: false }); R(p, x - 5, y - 6, x + 3, y - 5, m[0]); p.set(x + 4, y - 7, PAL.green[2]); } }, // vents, the eyecup, the screen, the power LED
  irons: { slot: "optic", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); box(p, x - 3, y - 2, x + 3, y - 1, m, { spec: false }); V(p, x - 3, y - 5, y - 3, m[1]); V(p, x + 3, y - 5, y - 3, m[1]); p.set(x - 3, y - 5, m[2]); p.set(x + 3, y - 5, m[2]); R(p, x - 1, y - 4, x + 1, y - 3, m[0]); } },
  tritium: { slot: "optic", d: {}, draw: (p, [x, y]) => { const g = PAL.green; p.set(x - 6, y - 1, g[2]); p.set(x - 4, y - 1, g[2]); p.set(x + 8, y - 1, g[3]); R(p, x - 7, y - 2, x - 3, y - 2, IRON[2]); } },
  mount: { slot: "mount", d: { len: 4 }, draw: (p, [x, y], o) => { const L = o.len * 2; box(p, x - L, y - 3, x + L, y - 1, IRON, { spec: false }); rail(p, x - L, x + L, y - 4, IRON, 1); pin(p, x - L + 2, y - 2, IRON); pin(p, x + L - 3, y - 2, IRON); } },
  // muzzle devices (right from the anchor: the barrel's last column, the bore's top row)
  can: { slot: "muzzle", d: { len: 7, rows: 4, col: "gun" }, draw: canShape },
  brake: { slot: "muzzle", d: { len: 3, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; box(p, x + 1, y - 2, x + L, y + 3, m, { wide: true }); for (let i = 3; i < L; i += 3) { R(p, x + i, y - 2, x + i, y - 1, m[0]); R(p, x + i, y + 2, x + i, y + 3, m[0]); } R(p, x + L, y, x + L, y + 1, "#1c2230"); } },
  comp: { slot: "muzzle", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; box(p, x + 1, y - 2, x + L, y + 3, m, { wide: true }); for (let i = 2; i < L; i += 2) p.set(x + i, y - 2, m[0]); R(p, x + L, y, x + L, y + 1, "#1c2230"); } },
  choke: { slot: "muzzle", d: { len: 2, col: "metal" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; cyl(p, x + 1, x + L, y - 1, y + 2, m); for (let i = 2; i < L; i += 2) p.set(x + i, y + 1, m[0]); } },
  fh: { slot: "muzzle", d: { len: 3, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; cyl(p, x + 1, x + L, y - 2, y + 3, m); for (let i = 3; i < L; i += 2) V(p, x + i, y - 1, y + 1, m[0]); H(p, x + 1, x + L, y + 3, m[0]); } }, // the birdcage: closed at the bottom
  // under the barrel, grips, rails, slings
  vgrip: { slot: "grip", d: { len: 5, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; vcyl(p, x - 2, x + 2, y + 1, y + L, m); for (let i = 3; i < L - 1; i += 3) H(p, x - 1, x + 1, y + i, m[0]); H(p, x - 2, x + 2, y + L, m[0]); } },
  agrip: { slot: "grip", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); for (let i = 0; i < 6; i++) { H(p, x - 5 + i, x + 3 + Math.floor(i / 2), y + 1 + i, m[1]); p.set(x - 5 + i, y + 1 + i, m[2]); p.set(x + 3 + Math.floor(i / 2), y + 1 + i, m[0]); } H(p, x, x + 5, y + 6, m[0]); } },
  stop: { slot: "grip", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); box(p, x - 1, y + 1, x + 3, y + 4, m, { spec: false }); p.set(x - 1, y + 4, m[0]); } },
  laser: { slot: "tactical", d: { col: "gun", beam: "red" }, draw: (p, [x, y], o) => { const m = mOf(o.col); box(p, x - 4, y + 1, x + 4, y + 4, m, { spec: false }); p.set(x + 4, y + 2, M(o.beam)[2]); p.set(x + 4, y + 3, M(o.beam)[1]); R(p, x - 2, y + 1, x - 1, y + 1, m[2]); } },
  light: { slot: "tactical", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; cyl(p, x - L, x + L, y - 1, y + 2, m); cyl(p, x + L + 1, x + L + 3, y - 2, y + 3, m); lensV(p, x + L + 3, y - 1, y + 2); p.set(x + L + 3, y - 1, "#fbf3c8"); p.set(x + L + 3, y, "#ffffff"); R(p, x - L - 1, y - 1, x - L - 1, y + 2, m[0]); } }, // the tail cap
  combo: { slot: "tactical", d: { col: "tanD", beam: "red" }, draw: (p, [x, y], o) => { const m = mOf(o.col); box(p, x - 6, y - 2, x + 4, y + 2, m, { spec: false }); p.set(x + 4, y - 1, GLASS[2]); p.set(x + 4, y, GLASS[1]); p.set(x + 4, y + 2, M(o.beam)[2]); p.set(x + 4, y + 1, M(o.beam)[1]); R(p, x - 3, y - 1, x, y - 1, m[0]); p.set(x - 5, y + 1, m[2]); } },
  bipod: { slot: "bipod", d: { len: 6, col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; box(p, x - 3, y + 1, x + 3, y + 3, m, { spec: false });
    for (let i = 1; i <= L; i++) { const dx = Math.floor(i / 2); R(p, x - 3 - dx, y + 3 + i, x - 2 - dx, y + 3 + i, m[1]); p.set(x - 3 - dx, y + 3 + i, m[2]); R(p, x + 2 + dx, y + 3 + i, x + 3 + dx, y + 3 + i, m[1]); p.set(x + 3 + dx, y + 3 + i, m[0]); }
    const dx = Math.floor(L / 2); R(p, x - 4 - dx, y + 4 + L, x - 1 - dx, y + 5 + L, BLACK[1]); R(p, x + 1 + dx, y + 4 + L, x + 4 + dx, y + 5 + L, BLACK[1]); } }, // the feet
  launcher: { slot: "under", d: { len: 6, col: "olive" }, draw: (p, [x, y], o) => { const m = mOf(o.col), L = o.len * 2; cyl(p, x - L - 2, x + L - 2, y + 1, y + 7, m); box(p, x - L - 4, y + 1, x - L - 1, y + 8, IRON, { spec: false }); R(p, x - L - 2, y + 8, x - L, y + 10, IRON[1]); p.set(x - L - 1, y + 10, STEEL[2]); // the tube, the receiver, the trigger
    box(p, x - L, y - 1, x + L - 6, y, IRON, { spec: false }); R(p, x + L - 2, y + 2, x + L - 2, y + 6, m[0]); p.set(x + L - 2, y + 3, "#1c2230"); p.set(x + L - 2, y + 4, "#1c2230"); } }, // the clamp, the muzzle
  rail: { slot: "rail", d: { len: 6 }, draw: (p, [x, y], o) => { const L = o.len * 2; box(p, x - L, y - 1, x + L, y + 2, IRON, { spec: false }); rail(p, x - L, x + L, y - 2, IRON, 1); for (let xx = x - L; xx <= x + L; xx += 2) p.set(xx, y + 2, IRON[2]); dots(p, x - L + 2, x + L - 2, y, IRON[0], 4); } },
  saddle: { slot: "rail", d: { n: 4 }, draw: (p, [x, y], o, ctx) => { const a = (ctx && ctx.anchors && (ctx.anchors.mount || ctx.anchors.optic)) || [x, y]; const x0 = a[0] - o.n * 2 - 2, y0 = a[1] + 3;
    box(p, x0, y0, x0 + o.n * 4 + 1, y0 + 6, IRON, { spec: false }); for (let i = 0; i < o.n; i++) { const sx = x0 + 1 + i * 4; R(p, sx, y0 + 1, sx + 2, y0 + 3, RED[1]); p.set(sx, y0 + 1, RED[2]); p.set(sx + 2, y0 + 3, RED[0]); R(p, sx, y0 + 4, sx + 2, y0 + 5, BRASS[1]); p.set(sx, y0 + 4, BRASS[2]); p.set(sx + 2, y0 + 5, BRASS[0]); } } },
  cuff: { slot: "cuff", d: { n: 4, col: "sling", round: "shell" }, draw: (p, [x, y], o) => { const m = mOf(o.col), x0 = x - 4 - o.n * 4; box(p, x0, y - 3, x - 4, y + 4, m, { spec: false }); for (let i = 0; i < o.n; i++) { const sx = x0 + 1 + i * 4, rm = M(o.round); R(p, sx, y - 2, sx + 1, y + 1, rm[1]); p.set(sx, y - 2, rm[2]); R(p, sx, y + 2, sx + 1, y + 3, o.round === "shell" ? BRASS[1] : rm[0]); } } },
  sling: { slot: "sling", d: { col: "sling" }, draw: (p, [x, y], o) => { const m = mOf(o.col); for (let i = 0; i <= 24; i++) { const yy = y + 4 + Math.round(6 * Math.sin((Math.PI * i) / 24)); p.set(x - i, yy, m[1]); p.set(x - i, yy + 1, m[0]); if (i % 6 === 3) p.set(x - i, yy, m[2]); } R(p, x - 1, y + 1, x + 1, y + 3, STEEL[1]); p.set(x, y + 2, STEEL[3]); } },
  stock: { slot: "stock", d: { t: "tele" }, draw: (p, a, o) => (STOCKS_HD[o.t] || STOCKS_HD.tele).draw(p, a, o.col || o.c || "gun") },
  mag: { slot: "mag", d: { t: "stick", n: 8, w: 4, curve: 3 }, draw: (p, a, o) => (MAGS_HD[o.t] || MAGS_HD.stick).draw(p, a, o) },
  grips: { slot: "grip", d: { col: "wood", n: 9 }, draw: (p, [x, y], o) => { const m = mOf(o.col); gripHD(p, x + 1, y - 2, o.n * 2, 8, m, { slope: 7, ribs: !isWood(o.col) }); if (isWood(o.col)) for (let i = 3; i < o.n * 2 - 2; i += 3) p.set(x + 3 - Math.round(i * 7 / (o.n * 2 - 1)), y - 2 + i, m[0]); } },
  // the gun specs' own muzzle devices (ui/gunart.js): the crown, the MP5's lugs, the AK slant brake, the .50's brake
  crown: { slot: "muzzle", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); cyl(p, x + 1, x + 2, y - 1, y + 2, m); p.set(x + 2, y, "#1c2230"); } },
  lugs: { slot: "muzzle", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); cyl(p, x + 1, x + 4, y - 2, y + 3, m); V(p, x + 2, y - 1, y + 2, m[0]); } },
  brake_ak: { slot: "muzzle", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); box(p, x + 1, y - 2, x + 6, y + 3, m, { wide: true }); for (let i = 0; i < 3; i++) R(p, x + 4 + i, y - 2, x + 6, y - 2 + i, null); for (let i = 0; i < 3; i++) for (let j = x + 4 + i; j <= x + 6; j++) p.clear(j, y - 2 + i); H(p, x + 1, x + 3, y - 2, m[2]); } }, // the slant
  brake_big: { slot: "muzzle", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); cyl(p, x + 1, x + 12, y - 1, y + 2, m); for (const dx of [3, 7, 11]) { box(p, x + dx, y - 5, x + dx + 1, y + 6, m, { spec: false }); p.set(x + dx, y - 5, m[2]); } R(p, x + 12, y, x + 12, y + 1, "#1c2230"); } }, // the baffle plates
  fh_long: { slot: "muzzle", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); cyl(p, x + 1, x + 10, y - 2, y + 3, m); for (const dx of [4, 6, 8]) V(p, x + dx, y - 1, y + 2, m[0]); } },
  fh_m14: { slot: "muzzle", d: { col: "gun" }, draw: (p, [x, y], o) => { const m = mOf(o.col); cyl(p, x + 1, x + 8, y - 2, y + 3, m); V(p, x + 4, y - 1, y + 2, m[0]); V(p, x + 7, y - 1, y + 2, m[0]); R(p, x + 1, y + 4, x + 3, y + 5, m[1]); p.set(x + 3, y + 5, m[0]); } }, // the bayonet lug
  oilfilter: { slot: "muzzle", d: {}, draw: (p, [x, y]) => { cyl(p, x + 1, x + 4, y - 1, y + 2, GREY); const b = PAL.blue; cyl(p, x + 5, x + 16, y - 5, y + 6, b); R(p, x + 8, y - 3, x + 12, y + 4, PAL.white[2]); H(p, x + 8, x + 12, y - 3, PAL.white[3]); R(p, x + 9, y - 1, x + 11, y, RED[1]); V(p, x + 15, y - 4, y + 5, b[0]); } }, // the adapter, the can, its label
  bottle: { slot: "muzzle", d: {}, draw: (p, [x, y]) => { const b = PAL.bottle; cyl(p, x + 1, x + 4, y - 1, y + 2, b); cyl(p, x + 5, x + 16, y - 5, y + 6, b); H(p, x + 1, x + 4, y + 3, COYOTE[1]); H(p, x + 1, x + 4, y - 2, COYOTE[1]); R(p, x + 7, y - 2, x + 13, y + 3, PAL.white[1]); p.set(x + 7, y - 2, PAL.white[3]); } }, // tape at the neck, a label
  extmag: { slot: "mag", d: {}, draw: (p, [x, y]) => { box(p, x - 2, y + 1, x + 9, y + 6, IRON, { wide: true }); H(p, x - 2, x + 9, y + 6, IRON[0]); dots(p, x - 1, x + 8, y + 3, IRON[0], 3); } },
  rotary: { slot: "mag", d: {}, draw: (p, [x, y]) => { box(p, x - 2, y, x + 3, y + 3, IRON, { spec: false }); } },
  tube_ext: { slot: "mag", d: {}, draw: (p, [x, y]) => { cyl(p, x + 1, x + 11, y, y + 3, IRON); V(p, x + 1, y, y + 3, IRON[0]); V(p, x + 2, y + 1, y + 2, IRON[2]); R(p, x + 11, y, x + 11, y + 3, STEEL[1]); } },
  pad: { slot: "stock", d: {}, draw: (p, [x, y], o, ctx) => { const def = ctx && ctx.def && ctx.def.stock; if (def && def !== "pad") drawPart(p, def, [x, y], ctx); else STOCKS_HD.ar.draw(p, [x, y], "gun");
    for (let xx = 0; xx < x; xx++) { let any = false; for (let yy = y - 8; yy <= y + 12; yy++) if (p.get(xx, yy)) { any = true; p.set(xx, yy, PAD[1]); if (xx > 0) p.set(xx - 1, yy, PAD[0]); } if (any) break; } } }, // a thick pad on the stock's butt
};

// ---------- the hand-drawn looks of ui/gunart.js PART_ART, as kinds with options ----------
export const PART_HD = {
  irons: { kind: "irons" }, tritium: { kind: "tritium" }, rmr: { kind: "mini" }, reddot: { kind: "dot" }, holo: { kind: "holo" }, acog: { kind: "prism" },
  lpvo: { kind: "scope", len: 6, bell: 1 }, scope4: { kind: "scope", len: 5, bell: 1 }, scope9: { kind: "scope", len: 7, bell: 2 }, scope25: { kind: "scope", len: 8, bell: 2, col: "olive" },
  thermal: { kind: "thermal" }, scrapscope: { kind: "scope", len: 5, bell: 1, col: "pipe", scrap: true }, mount: { kind: "mount" },
  fh: { kind: "fh" }, crown: { kind: "crown" }, lugs: { kind: "lugs" }, brake_ak: { kind: "brake_ak" }, brake_big: { kind: "brake_big" }, can_s: { kind: "can", len: 6 }, can_l: { kind: "can", len: 8 },
  brake: { kind: "brake" }, comp: { kind: "comp" }, choke: { kind: "choke" }, oilfilter: { kind: "oilfilter" }, bottle: { kind: "bottle" }, fh_long: { kind: "fh_long" }, fh_m14: { kind: "fh_m14" },
  rotary: { kind: "rotary" }, extmag: { kind: "extmag" }, tube_ext: { kind: "tube_ext" },
  vgrip: { kind: "vgrip" }, agrip: { kind: "agrip" }, laser: { kind: "laser" }, light: { kind: "light" }, peq: { kind: "combo" }, bipod: { kind: "bipod" }, m203: { kind: "launcher" }, rail: { kind: "rail" }, sling: { kind: "sling" },
  revgrip: { kind: "grips", col: "rubber" }, grip_wood: { kind: "grips", col: "wood" }, grip_rubber: { kind: "grips", col: "rubber", n: 8 }, grip_snub: { kind: "grips", col: "wood", n: 6 },
  pad: { kind: "pad" },
};
for (const [look, [t, c]] of Object.entries(STOCK_LOOKS)) if (!PART_HD[look]) PART_HD[look] = { kind: "stock", t, col: c };
for (const [look, o] of Object.entries(MAG_LOOKS)) PART_HD[look] = { kind: "mag", ...o };

// A look (a PART_HD name or a { kind, ...options } spec) drawn at its anchor. ctx: { anchors, def } of the gun's art.
export function drawPart(p, look, a, ctx = {}) {
  const spec = typeof look === "string" ? PART_HD[look] : look;
  if (!spec) return false;
  const K = KINDS_HD[spec.kind];
  if (!K) return false;
  const o = { ...K.d };
  for (const [k, v] of Object.entries(spec)) if (v !== undefined) o[k] = v;
  K.draw(p, a, o, ctx);
  return true;
}
export const slotOfLook = (look) => { const s = typeof look === "string" ? PART_HD[look] : look; return s && KINDS_HD[s.kind] ? KINDS_HD[s.kind].slot : "optic"; };

// ---------- a part's look by its key (the game's rules: ui/gunparts.js lookOf) ----------
export function partLookHD(key, slot) {
  const g = key && GEAR[key];
  if (g && g.look && PART_HD[g.look]) return g.look;
  if (MOD_LOOK[key] && PART_HD[MOD_LOOK[key]]) return MOD_LOOK[key];
  if (/^mag/.test(String(key))) { const n = Number((/(\d+)/.exec(key) || [])[1]); if (n) return n >= 50 ? "drum" : n > 30 ? "stick40" : n > 20 ? "stick30" : n > 10 ? "stick20" : "stick10"; }
  const o = partSpecOf(key, slot);
  if (o && KINDS_HD[o.kind]) return o;
  return null;
}

// ---------- a part alone, on a cell (the builder's slot boxes, the parts sheet) ----------
// The part at its natural anchor beside a grey stub of what it fits to (a rail, a barrel's end, a magazine well, a
// receiver's back, a fore-end), so its orientation reads.
export function partIcon(look, w = 48, h = 32) {
  const p = painter(w, h), spec = typeof look === "string" ? PART_HD[look] : look;
  if (!spec) return p;
  const slot = slotOfLook(spec), stub = ["#2c3138", "#3a4049", "#4a515b", "#5a626c"], ctx = {};
  switch (slot) {
    case "optic": case "mount": { const tall = spec.kind === "scope" || spec.kind === "thermal" || spec.kind === "magnifier"; const y = tall ? 27 : 24; rail(p, 6, w - 7, y, stub, 2); H(p, 6, w - 7, y + 2, stub[0]); ctx.anchors = { optic: [24, y] }; drawPart(p, spec, [spec.kind === "magnifier" ? 32 : 23, y], ctx); break; }
    case "muzzle": { const long = ["can", "oilfilter", "bottle", "brake_big", "fh_long"].includes(spec.kind); const x = long ? 9 : 17; cyl(p, 2, x, 14, 17, stub); drawPart(p, spec, [x, 14], ctx); break; }
    case "mag": { const tall = spec.kind === "mag" && (spec.n || 8) >= 9; box(p, 12, 1, 35, tall ? 3 : 5, stub, { spec: false }); drawPart(p, spec, [spec.kind === "mag" && spec.t === "drum" ? 20 : 17, tall ? 4 : 6], ctx); break; }
    case "stock": { box(p, w - 8, 10, w - 1, 19, stub, { spec: false }); ctx.def = { stock: "stock_ar" }; drawPart(p, spec, [w - 9, 15], ctx); break; }
    case "sling": case "cuff": { box(p, 20, 11, w - 1, 20, stub, { spec: false }); drawPart(p, spec, slot === "sling" ? [w - 6, 20] : [w - 2, 15], ctx); break; }
    case "grip": case "under": case "bipod": case "tactical": case "rail": {
      if (spec.kind === "grips") { box(p, 20, 2, 36, 9, stub, { spec: false }); drawPart(p, spec, [20, 11], ctx); break; }
      const fe = spec.kind === "launcher" ? 10 : 11; box(p, 4, 4, w - 5, fe, stub, { spec: false });
      const y = slot === "tactical" ? 9 : slot === "rail" ? 8 : fe; ctx.anchors = { mount: [34, 4], optic: [34, 4] };
      drawPart(p, spec, [spec.kind === "saddle" ? 24 : 24, spec.kind === "rail" ? 9 : y], ctx); break; }
    default: drawPart(p, spec, [24, 16], ctx);
  }
  return p;
}
export { STOCK_LOOKS, MAG_LOOKS };
