// The gun painter: every gun drawn from its art spec (ui/gunspecs.js GUN_ART; the format is documented there), in three
// sizes, all on the sprites' pixel painter (ui/sprites.js painter: flat colours, the dark outline added by toCanvas):
//   - the big side view (gun builder, battle HUD; ui/gunart.js): 64 × 24 grid pixels, muzzle to the right. A spec's
//     body family (FAM below) paints the gun's core; its own stock and magazine are parts (STOCKS, MAGS) drawn at the
//     anchors, so a fitted stock or magazine replaces them; anchors (where each slot's part goes) come from the family,
//     a spec may move any;
//   - held in battle (ui/sprites.js drawWeapon): a few pixels in the right hand of a 22 × 26 sprite;
//   - dropped beside a body (ui/downsprites.js droppedWeapon): the same small drawing on the 26 × 14 grid.
// The small two are drawn from the same spec (paintMini): its length from the big one's landmarks, then its features
// (stock kind, magazine kind and place, a carry handle, a scope, a pump, a bipod, stacked barrels, a cylinder...).
// Nothing here is drawn per frame: the callers cache the canvases (gunart.js gunCanvas, sprites.js / downsprites.js
// caches by weapon key).
import { WEAPONS } from "../sim/combat.js";
import { GEAR } from "../sim/data.js";
import { GUN_ART, ART_ALIAS, SPEC_ALT, FALLBACK_LIKE } from "./gunspecs.js";

export const C = {
  metal: "#9aa3ab", steel: "#7d858c", gun: "#2b2e33", dark: "#1a1c20", hi: "#454a52", hg: "#33373d",
  wood: "#7a5230", woodD: "#5e3e22", woodL: "#94683e", olive: "#4b5236", oliveL: "#5d6644", tan: "#9c8862", tanD: "#7d6c4a",
  glass: "#7fb8e6", red: "#e04848", glow: "#9cff6a", sling: "#8a7350", pipe: "#5b5f63", board: "#4a3a2a", blue: "#2f5d8a", bottle: "#3d7a4a",
  // the gun specs' (2026-10-10)
  fde: "#a48c62", fdeD: "#86714c", fdeL: "#b9a276", nickel: "#c4cace", nickelD: "#9ea5ab", blued: "#363c46", bluedL: "#4a5260",
  poly: "#25282c", polyL: "#3a3e44", od: "#4f5a44", odL: "#617056", odD: "#3c4534", clear: "#aebfbd", clearD: "#86999a", brass: "#c8a24a",
  walnut: "#5c3a22", walnutL: "#77502f", rubber: "#1f1f22", plum: "#6a3d34", case: "#7b7064", caseL: "#978a7b", shell: "#b8322a",
  grey: "#5d636b", greyL: "#757c84", rust: "#7a4a2a",
};
const col = (c, d) => (c == null ? d : C[c] || c);
const lighter = { gun: C.hi, poly: C.polyL, fde: C.fdeL, od: C.odL, steel: C.metal, nickel: "#dfe3e6", blued: C.bluedL, wood: C.woodL, walnut: C.walnutL, olive: C.oliveL, case: C.caseL, grey: C.greyL, hg: C.hi, tan: "#b3a07a", plum: "#80503f" };
const darker = { gun: C.dark, poly: C.rubber, fde: C.fdeD, od: C.odD, steel: C.grey, nickel: C.nickelD, blued: C.gun, wood: C.woodD, walnut: "#47301c", olive: C.odD, case: "#5e554b", grey: C.hg, hg: C.dark, tan: C.tanD, plum: "#4e2d27", woodL: C.wood };
function shade(hex, f) { // f < 0 darker, f > 0 lighter
  const h = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16), v = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => (f < 0 ? x * (1 + f) : x + (255 - x) * f));
  return `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
}
const hiOf = (name) => lighter[name] || shade(col(name), 0.18) || C.hi;
const loOf = (name) => darker[name] || shade(col(name), -0.28) || C.dark;

// ---------- drawing helpers (grid pixels) ----------
export const R = (p, x0, y0, x1, y1, c) => p.rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), c);
export const H = (p, x0, x1, y, c) => R(p, x0, y, x1, y, c);
export const V = (p, x, y0, y1, c) => R(p, x, y0, x, y1, c);
// Every other pixel of a row (rail teeth, serrations, vents).
export const dots = (p, x0, x1, y, c, step = 2) => { for (let x = x0; x <= x1; x += step) p.set(x, y, c); };
// A pistol grip: n rows from (x, y) down, w wide, sloping back a pixel every `every` rows.
export function grip(p, x, y, n, w, c, every = 2) { for (let i = 0; i < n; i++) { const s = x - Math.floor(i / every); H(p, s, s + w - 1, y + i, c); } }
// A magazine: n rows from (x, y) down, w wide, sloping forward a pixel every `curve` rows (0: straight).
export function magShape(p, x, y, n, w, c, curve = 0) { for (let i = 0; i < n; i++) { const s = x + (curve ? Math.floor(i / curve) : 0); H(p, s, s + w - 1, y + i, c); } }
// A trigger guard under the receiver from x0 to x1 (y: the receiver's bottom row), the trigger inside.
export function guard(p, x0, x1, y, c = C.dark) { H(p, x0, x1, y + 2, c); p.set(x1, y + 1, c); p.set(x0 + 1, y + 1, C.metal); }
// A stock reaching back from (x, y), where it meets the receiver: len columns, its top and bottom rows at the butt.
export function stockShape(p, x, y, len, top, bot, c, opts = {}) {
  for (let i = 0; i < len; i++) {
    const t = len > 1 ? i / (len - 1) : 0; // 0 at the receiver, 1 at the butt
    const yt = Math.round(y - 1 + (top - (y - 1)) * t), yb = Math.round(y + 1 + (bot - (y + 1)) * t);
    R(p, x - i, yt, x - i, yb, c);
    if (opts.grain && i % 3 === 0) p.set(x - i, Math.round((yt + yb) / 2), opts.grain);
  }
  if (opts.pad) R(p, x - len, top, x - len, bot, opts.pad);
}
const forend = (p, x0, x1, y0, y1, c = C.wood, lo = C.woodD) => { R(p, x0, y0, x1, y1, c); H(p, x0, x1, y1, lo); };

// ---------- stocks: (p, [x, y] where it meets the receiver, colour name) ----------
// len (columns behind the anchor) and mini (the small drawing's kind: fixed, tele, wire, drop, grip, none) for each.
export const STOCKS = {
  ar:      { len: 10, mini: "fixed", draw: (p, [x, y], c) => stockShape(p, x - 1, y, 10, y - 1, y + 4, col(c), { pad: C.dark }) },
  a2:      { len: 13, mini: "fixed", draw: (p, [x, y], c) => { stockShape(p, x - 1, y, 13, y - 1, y + 4, col(c), { pad: C.dark }); p.set(x - 11, y + 1, hiOf(c)); p.set(x - 11, y + 2, hiOf(c)); } },
  tele:    { len: 12, mini: "tele", draw: (p, [x, y], c) => { const k = col(c); H(p, x - 8, x, y, C.gun); H(p, x - 8, x, y + 1, C.gun); R(p, x - 11, y - 1, x - 6, y + 3, k); R(p, x - 12, y - 1, x - 12, y + 4, C.dark); p.clear(x - 9, y + 1); } },
  crane:   { len: 13, mini: "tele", draw: (p, [x, y], c) => { const k = col(c); H(p, x - 7, x, y, C.gun); H(p, x - 7, x, y + 1, C.gun); R(p, x - 12, y - 2, x - 6, y + 3, k); H(p, x - 11, x - 7, y - 2, hiOf(c)); R(p, x - 13, y - 2, x - 13, y + 4, C.dark); p.set(x - 9, y + 2, C.dark); } },
  scar:    { len: 13, mini: "tele", draw: (p, [x, y], c) => {
    const k = col(c);
    R(p, x - 12, y - 2, x, y - 1, k); H(p, x - 10, x - 3, y - 2, hiOf(c)); // the cheek riser on the top beam
    for (let i = 0; i <= 12; i++) p.set(x - i, y + 1 + Math.floor(i / 4), k); // the lower strut, sloping down to the butt
    R(p, x - 12, y, x - 11, y + 4, k); R(p, x - 13, y - 2, x - 13, y + 4, C.rubber); // the butt, its pad
    R(p, x - 1, y - 1, x, y + 2, C.dark); // the hinge
  } },
  wire:    { len: 11, mini: "wire", draw: (p, [x, y], c) => { const k = col(c, C.gun); H(p, x - 10, x, y - 1, k); H(p, x - 10, x, y + 2, k); R(p, x - 11, y - 1, x - 10, y + 4, k); } },
  mp5:     { len: 11, mini: "wire", draw: (p, [x, y], c) => { const k = col(c, C.gun); H(p, x - 10, x, y, k); H(p, x - 10, x, y + 3, k); R(p, x - 11, y, x - 10, y + 5, k); } },
  ump:     { len: 12, mini: "wire", draw: (p, [x, y], c) => { const k = col(c, C.poly); H(p, x - 11, x, y - 1, k); H(p, x - 11, x, y + 3, k); for (let i = 0; i < 4; i++) p.set(x - 2 - i, y + i - 1, k); R(p, x - 12, y - 1, x - 11, y + 4, k); R(p, x - 13, y - 1, x - 13, y + 4, C.rubber); } },
  fal:     { len: 14, mini: "fixed", draw: (p, [x, y], c) => { stockShape(p, x, y, 14, y - 1, y + 5, col(c), { pad: C.rubber }); H(p, x - 12, x - 5, y - 1, hiOf(c)); } },
  g3:      { len: 13, mini: "fixed", draw: (p, [x, y], c) => { stockShape(p, x, y, 13, y - 2, y + 4, col(c), { pad: C.rubber }); p.set(x - 2, y - 1, col(c)); H(p, x - 11, x - 6, y - 2, hiOf(c)); } },
  m14:     { len: 15, mini: "drop", draw: (p, [x, y], c) => { const k = col(c); stockShape(p, x, y, 15, y, y + 6, k, { pad: C.steel, grain: loOf(c) }); R(p, x - 1, y + 1, x + 2, y + 3, k); } }, // the wrist under the receiver
  m240:    { len: 12, mini: "fixed", draw: (p, [x, y], c) => { stockShape(p, x - 1, y, 12, y - 2, y + 5, col(c), { pad: C.dark }); R(p, x - 1, y - 1, x, y + 1, C.dark); } },
  wood:    { len: 15, mini: "drop", draw: (p, [x, y], c) => stockShape(p, x, y, 15, y - 1, y + 5, col(c), { pad: C.dark, grain: loOf(c) }) },
  sporter: { len: 15, mini: "drop", draw: (p, [x, y], c) => { stockShape(p, x, y, 15, y - 1, y + 5, col(c), { pad: C.rubber, grain: loOf(c) }); H(p, x - 12, x - 5, y - 2, col(c)); H(p, x - 11, x - 6, y - 2, hiOf(c)); } }, // a Monte Carlo cheek
  pgwood:  { len: 14, mini: "drop", draw: (p, [x, y], c) => { stockShape(p, x, y, 14, y - 1, y + 5, col(c), { pad: C.rubber, grain: loOf(c) }); grip(p, x - 1, y + 2, 3, 3, col(c)); } }, // a sporting stock with a pistol-grip wrist
  lever:   { len: 14, mini: "drop", draw: (p, [x, y], c) => stockShape(p, x, y, 14, y, y + 5, col(c), { pad: C.steel, grain: loOf(c) }) },
  light:   { len: 14, mini: "drop", draw: (p, [x, y], c) => stockShape(p, x, y, 14, y - 1, y + 4, col(c), { pad: C.dark }) },
  poly:    { len: 13, mini: "drop", draw: (p, [x, y], c) => stockShape(p, x, y, 13, y - 1, y + 5, col(c), { pad: C.dark }) },
  sniper:  { len: 16, mini: "drop", draw: (p, [x, y], c) => { stockShape(p, x, y, 16, y - 2, y + 5, col(c), { pad: C.dark }); H(p, x - 10, x - 3, y - 2, hiOf(c)); } },
  thumb:   { len: 16, mini: "drop", draw: (p, [x, y], c) => { stockShape(p, x, y, 16, y - 2, y + 5, col(c), { pad: C.rubber }); R(p, x - 4, y + 1, x - 2, y + 2, null); p.clear(x - 3, y + 1); p.clear(x - 4, y + 1); p.clear(x - 3, y + 2); H(p, x - 12, x - 5, y - 2, hiOf(c)); } }, // a thumbhole
  sawn:    { len: 4, mini: "grip", draw: (p, [x, y], c) => grip(p, x, y, 6, 3, col(c)) },
  amr:     { len: 12, mini: "fixed", draw: (p, [x, y], c) => stockShape(p, x - 1, y, 11, y - 2, y + 4, col(c), { pad: C.dark }) },
  m79:     { len: 12, mini: "drop", draw: (p, [x, y], c) => { stockShape(p, x, y, 12, y - 1, y + 5, col(c), { pad: C.rubber, grain: loOf(c) }); R(p, x - 13, y - 1, x - 13, y + 5, C.rubber); } },
  folder:  { len: 11, mini: "wire", draw: (p, [x, y], c) => { const k = col(c, C.gun); H(p, x - 10, x, y - 1, k); H(p, x - 10, x - 4, y + 2, k); for (let i = 0; i < 4; i++) p.set(x - i, y + 2 - Math.floor(i / 2), k); R(p, x - 11, y - 1, x - 10, y + 3, k); } }, // an underfolder / side folder
  brace:   { len: 9, mini: "tele", draw: (p, [x, y], c) => { const k = col(c, C.gun); H(p, x - 5, x, y, C.gun); H(p, x - 5, x, y + 1, C.gun); R(p, x - 8, y - 1, x - 5, y + 3, k); R(p, x - 9, y - 1, x - 9, y + 3, C.dark); p.set(x - 9, y + 4, C.sling); p.set(x - 8, y + 4, C.sling); } }, // an AR pistol's arm brace
  none:    { len: 0, mini: "none", draw: () => {} },
};
// The gun builder's stock looks (gunart.js PART_ART) as STOCKS kinds, for the small drawing: their kind and length.
export const LOOK_STOCK = {
  stock_ar: ["fixed", 10], stock_fixed: ["fixed", 10], collapsible: ["tele", 12], precision: ["fixed", 13], fold: ["wire", 11], pad: ["fixed", 10],
  stock_skel: ["wire", 11], stock_ak: ["drop", 11], stock_mp5: ["wire", 11], stock_wood: ["drop", 15], stock_lever: ["drop", 14],
  stock_light: ["drop", 14], stock_poly: ["drop", 13], stock_sniper: ["drop", 16], stock_sawn: ["grip", 4], stock_amr: ["fixed", 12],
};

// ---------- magazines: (p, [x, y] the bottom of the magazine well, options) ----------
// mini: the small drawing's kind (stick, curve, box, drum, belt, clear, long, top, none).
function stickMag(p, [x, y], o, c) { magShape(p, x, y, o.n, o.w, c, o.curve || 0); const s = o.curve ? Math.floor((o.n - 1) / o.curve) : 0; H(p, x + s, x + s + o.w - 1, y + o.n - 1, o.base ? col(o.base) : C.dark); }
export const MAGS = {
  stick: { mini: "stick", draw: (p, a, o) => stickMag(p, a, { n: 8, w: 4, curve: 3, ...o }, col(o.col, C.gun)) },
  curve: { mini: "curve", draw: (p, a, o) => stickMag(p, a, { n: 8, w: 4, curve: 2, ...o }, col(o.col, C.gun)) },
  box:   { mini: "box", draw: (p, a, o) => stickMag(p, a, { n: 6, w: 5, curve: 0, ...o }, col(o.col, C.gun)) },
  // A clear plastic magazine: the rounds show through.
  clear: { mini: "clear", draw: (p, [x, y], o) => { const q = { n: 8, w: 4, curve: 4, ...o }; magShape(p, x, y, q.n, q.w, C.clear, q.curve); for (let i = 0; i < q.n - 2; i++) p.set(x + 1 + Math.floor(i / q.curve), y + i, i % 2 ? C.brass : "#a8862f"); const s = Math.floor((q.n - 1) / q.curve); H(p, x + s, x + s + q.w - 1, y + q.n - 1, C.clearD); } },
  drum:  { mini: "drum", draw: (p, [x, y]) => { H(p, x, x + 3, y, C.gun); for (let dy = -3; dy <= 3; dy++) { const w = Math.round(Math.sqrt(12.25 - dy * dy)); H(p, x + 2 - w, x + 2 + w, y + 4 + dy, C.gun); } p.set(x + 2, y + 4, C.hi); } },
  // A belt in its box or pouch hanging under the gun, the links running up into the feed tray.
  beltbox: { mini: "belt", draw: (p, [x, y], o) => { const k = col(o.col, C.od); R(p, x - 3, y + 1, x + 5, y + 7, k); H(p, x - 3, x + 5, y + 1, hiOf(o.col || "od")); H(p, x - 3, x + 5, y + 7, loOf(o.col || "od")); dots(p, x - 2, x + 4, y + 4, loOf(o.col || "od"), 3); dots(p, x + 1, x + 3, y, C.brass); } },
  // A box magazine on top of the gun along the receiver (the P90's): x, y its rear end's top-left.
  top:   { mini: "top", draw: (p, [x, y], o) => { const n = o.len || 20; R(p, x, y, x + n, y + 1, C.clear); H(p, x, x + n, y, C.clearD); dots(p, x + 1, x + n - 2, y + 1, C.brass, 2); p.set(x + n, y + 1, C.clearD); } },
  none:  { mini: "none", draw: () => {} },
};
export const LOOK_MAG = { stick10: "box", stick20: "stick", stick30: "stick", stick40: "long", smg30: "stick", ak30: "curve", box10: "box", box20: "box", rotary: "none", extmag: "box", drum: "drum", belt: "belt", tube_ext: "none" };

// ---------- the body families: the gun's core, from its spec ----------
// Each: d (its defaults: receiver r [x0, x1], fore-end end hg, barrel end bar, grip x gx, colours c...), paint(p, s,
// fitted) (fitted: the looks of the parts in its slots, e.g. a sight on the AUG's rail in place of its scope),
// anchors(s), and mini(s) (the small drawing's features, see paintMini).
const BAR = (p, s, x0, x1, y = 7, rows = 2) => R(p, x0, y, x1, y + rows - 1, s.c.bar);
export const FAM = {};

// The AR family: AR-15s and AR-10s (flat-top or carry handle; A2, carbine, quad-rail, M-LOK or free-float handguards).
FAM.ar = {
  d: { kind: "rifle", r: [16, 28], hg: 41, bar: 52, hgT: "carbine", fs: "fsb", stock: { t: "ar" }, mag: { t: "stick" }, muzzle: "fh", c: { body: "gun", hg: "hg", furn: "gun", bar: "dark" } },
  paint(p, s) {
    const { r0, r1, hg, bar, c } = s;
    if (s.buffer !== false) R(p, r0 - 4, 8, r0 - 1, 9, c.body); // the buffer tube
    R(p, r0, 6, r1, 8, c.body);
    H(p, r0 + 5, r0 + 8, 7, C.dark); p.set(r0 + 9, 8, c.hiBody); // ejection port, forward assist
    if (s.carry) { R(p, r0 + 2, 2, r1 - 2, 3, c.body); V(p, r0 + 2, 4, 5, c.body); V(p, r1 - 2, 4, 5, c.body); p.set(r0 + 2, 1, c.body); H(p, r0 + 3, r1 - 3, 3, c.hiBody); }
    else { H(p, r0, r1, 5, C.dark); dots(p, r0, r1, 5, C.hi); }
    if (s.tall) R(p, r0 + 1, 9, r1 - 1, 11, c.low); else R(p, r0 + 1, 9, r1 - 1, 10, c.low);
    H(p, r0 + 1, r1 - 2, 9, c.hiLow);
    grip(p, s.gx, s.tall ? 12 : 11, 6, 3, c.furn);
    guard(p, s.gx + 2, s.gx + 5, s.tall ? 11 : 10);
    arHandguard(p, s, r1 + 1, hg);
    if (s.fs === "fsb") { R(p, hg + 1, 4, hg + 2, 8, c.body); p.set(hg + 1, 3, c.body); }
    else if (s.fs === "gas") { R(p, hg + 1, 6, hg + 2, 8, C.gun); }
    else if (s.fs === "flip") { R(p, hg + 1, 6, hg + 2, 8, C.gun); R(p, hg - 2, 3, hg - 1, 4, C.gun); }
    if (s.piston) { R(p, hg + 1, 5, hg + 3, 8, C.gun); p.set(hg + 3, 5, C.hi); } // the piston's big gas block
    BAR(p, s, Math.max(hg, r1) + 1, bar);
    if (s.step) p.clear(hg + 5, 8); // the M4's step for a launcher
    if (s.rearSight && !s.carry) R(p, r0 + 1, 3, r0 + 2, 4, C.gun);
  },
  anchors: (s) => {
    const y0 = s.carry ? 1 : 5, mid = Math.round((s.r1 + s.hg) / 2);
    return { optic: [s.r0 + 6, y0], mount: [s.r0 + 6, y0], muzzle: [s.bar, 7], mag: [s.r0 + 9, s.tall ? 12 : 11], stock: [s.buffer === false ? s.r0 - 1 : s.r0 - 4, 8],
      under: [mid - 1, 9], grip: [mid - 3, 9], rail: [mid - 1, 7], tactical: [s.hg - 2, 7], bipod: [s.hg - 2, 9], sling: [s.r0 - 8, 9] };
  },
  mini: (s) => ({ top: [s.carry ? { t: "bar", x0: s.r0 + 2, x1: s.r1 - 2 } : null, s.fs === "fsb" ? { t: "post", x0: s.hg + 1 } : null], deep: !!s.tall }),
};
function arHandguard(p, s, x0, x1) {
  const c = s.c;
  switch (s.hgT) {
    case "a2": R(p, x0, 6, x1, 9, c.hg); for (let x = x0 + 1; x < x1; x += 2) { p.set(x, 7, c.loHg); p.set(x, 8, c.loHg); } V(p, x0, 5, 10, C.metal); break; // round, ribbed, the delta ring
    case "carbine": R(p, x0, 6, x1, 9, c.hg); dots(p, x0 + 2, x1 - 1, 7, C.dark, 3); dots(p, x0 + 3, x1 - 1, 8, C.dark, 3); V(p, x0, 5, 10, C.gun); break;
    case "quad": R(p, x0, 5, x1, 9, C.dark); dots(p, x0, x1, 5, C.hi); dots(p, x0, x1, 9, C.hi); dots(p, x0 + 1, x1 - 1, 7, C.hi); break;
    case "covers": R(p, x0, 5, x1, 9, C.dark); dots(p, x0, x1, 5, C.hi); dots(p, x0, x1, 9, C.hi); R(p, x0 + 2, 6, x1 - 2, 8, c.hg); dots(p, x0 + 2, x1 - 2, 7, c.loHg); break; // quad rail, ladder covers
    case "mlok": R(p, x0, 6, x1, 9, c.hg); H(p, x0, x1, 5, C.dark); dots(p, x0, x1, 5, C.hi); for (let x = x0 + 2; x < x1 - 1; x += 4) { p.set(x, 7, C.dark); p.set(x + 1, 7, C.dark); p.set(x, 8, C.dark); p.set(x + 1, 8, C.dark); } break;
    case "slim": R(p, x0, 6, x1, 8, c.hg); H(p, x0, x1, 5, C.dark); dots(p, x0, x1, 5, C.hi); dots(p, x0 + 2, x1 - 1, 7, C.dark, 3); break;
    default: R(p, x0, 6, x1, 9, c.hg); dots(p, x0 + 1, x1 - 1, 7, C.dark, 3);
  }
}

// The SCAR: one long upper with a top rail to the muzzle end, a polymer lower, the charging handle out at the side.
FAM.scar = {
  d: { kind: "rifle", r: [16, 29], hg: 42, bar: 51, stock: { t: "scar", c: "fde" }, mag: { t: "stick", col: "fde" }, muzzle: "fh", c: { body: "fde", low: "fde", furn: "fde", bar: "dark" } },
  paint(p, s) {
    const { r0, r1, hg, bar, c } = s;
    R(p, r0, 5, hg, 8, c.body); H(p, r0, hg, 4, C.dark); dots(p, r0, hg, 4, C.hi); // the upper, its one long rail
    R(p, r0 + 1, 9, r1, s.tall ? 11 : 10, c.low); H(p, r0 + 1, r1 - 1, 9, c.hiLow); // the lower
    p.set(r0, 9, c.low); R(p, r0 - 1, 5, r0, 8, c.lo); // the stock's hinge block
    H(p, r0 + 4, r0 + 7, 7, C.dark); // ejection port
    R(p, r1 + 2, 6, r1 + 3, 7, C.dark); p.set(r1 + 4, 6, C.gun); // the charging handle
    dots(p, r1 + 6, hg - 1, 7, C.dark, 2); H(p, r1 + 5, hg, 9, C.dark); dots(p, r1 + 5, hg, 9, C.hi); // side and bottom rails
    grip(p, s.gx, s.tall ? 12 : 11, 6, 3, c.furn);
    guard(p, s.gx + 2, s.gx + 5, s.tall ? 11 : 10);
    R(p, hg + 1, 6, hg + 2, 8, C.gun); R(p, hg - 1, 3, hg, 3, C.gun); R(p, r0 + 1, 3, r0 + 2, 3, C.gun); // gas block, folded sights
    BAR(p, s, hg + 1, bar);
  },
  anchors: (s) => ({ optic: [s.r0 + 7, 4], mount: [s.r0 + 7, 4], muzzle: [s.bar, 7], mag: [s.r0 + 9, s.tall ? 12 : 11], stock: [s.r0 - 1, 7], under: [s.r1 + 8, 10], grip: [s.r1 + 7, 10], rail: [s.r1 + 8, 9], tactical: [s.hg - 3, 7], bipod: [s.hg - 3, 10], sling: [s.r0 - 8, 9] }),
  mini: (s) => ({ top: [{ t: "rail", x0: s.r0, x1: s.hg }], deep: !!s.tall }),
};

// The Kalashnikov: dust cover, wood or polymer handguards over and under the gas tube, the tall front sight block.
FAM.ak = {
  d: { kind: "rifle", r: [13, 28], hg: 38, fs: 41, bar: 51, gx: 16, stock: { t: "ak", c: "wood" }, mag: { t: "curve" }, muzzle: "brake_ak", c: { body: "gun", furn: "wood", bar: "dark" } },
  paint(p, s) {
    const { r0, r1, hg, bar, c } = s;
    R(p, r0, 6, r1, 9, c.body); H(p, r0, r1, 6, c.hiBody); H(p, r0 + 1, r1 - 1, 5, c.body); // receiver, dust cover
    if (s.ribbed) dots(p, r0 + 2, r1 - 2, 5, c.hiBody, 3);
    H(p, r0 + 7, r0 + 10, 8, C.metal); p.set(r0 + 11, 9, C.metal); // the charging handle, the selector
    grip(p, s.gx, 10, 6, 3, c.furn);
    guard(p, s.gx + 3, s.gx + 6, 9);
    forend(p, r1 + 1, hg, 7, 9, c.furn, c.loFurn); R(p, r1 + 1, 4, hg + 2, 5, c.furn); // lower handguard, the upper over the gas tube
    R(p, s.fs, 3, s.fs + 1, 8, c.body); // front sight block
    R(p, s.fs, 7, bar, 7, c.bar);
  },
  anchors: (s) => ({ optic: [s.r0 + 7, 5], mount: [s.r0 + 7, 7], muzzle: [s.bar, 7], mag: [s.r0 + 11, 10], stock: [s.r0 - 1, 7], under: [s.r1 + 5, 9], grip: [s.r1 + 5, 9], rail: [s.r1 + 6, 7], tactical: [s.r1 + 8, 7], bipod: [s.r1 + 8, 9], sling: [s.r0 - 1, 9] }),
  mini: (s) => ({ top: [{ t: "post", x0: s.fs }, { t: "bar", x0: s.r1 + 1, x1: s.hg, col: s.c.furn }], fore: { x0: s.r1 + 1, x1: s.hg, row: 1, col: s.c.furn } }),
};

// The FAL: a tall receiver sloping at the back, the carry handle folded on top, a vented handguard, the sight "ears".
FAM.fal = {
  d: { kind: "rifle", r: [15, 31], hg: 43, bar: 52, stock: { t: "fal", c: "poly" }, mag: { t: "box", n: 7, w: 5, curve: 6 }, muzzle: "fh_long", c: { body: "gun", furn: "poly", bar: "dark", hg: "poly" } },
  paint(p, s) {
    const { r0, r1, hg, bar, c } = s;
    R(p, r0, 5, r1, 10, c.body); p.clear(r0, 5); p.clear(r0 + 1, 5); p.clear(r0, 6); H(p, r0 + 2, r1, 5, c.hiBody); // the receiver, its sloped back
    H(p, r0 + 7, r0 + 11, 7, C.dark); R(p, r1 - 3, 6, r1 - 2, 7, C.metal); // ejection port, the cocking handle
    R(p, r1 - 9, 3, r1 - 3, 3, C.gun); V(p, r1 - 9, 4, 4, C.gun); V(p, r1 - 3, 4, 4, C.gun); // the carry handle, folded down
    R(p, r0 + 2, 3, r0 + 3, 4, C.gun); // the rear aperture
    grip(p, s.gx, 11, 6, 3, c.furn);
    guard(p, s.gx + 2, s.gx + 6, 10);
    R(p, r1 + 1, 6, hg, 9, c.hg); dots(p, r1 + 2, hg - 1, 7, c.loHg, 2); dots(p, r1 + 3, hg - 1, 8, c.loHg, 2); // the vented handguard
    R(p, hg + 1, 6, hg + 3, 8, C.gun); R(p, hg + 2, 3, hg + 2, 5, C.gun); R(p, hg + 4, 4, hg + 4, 5, C.gun); p.set(hg + 3, 5, C.gun); // gas block, the ears around the post
    BAR(p, s, hg + 1, bar, 7, 1); H(p, hg + 4, bar, 8, c.bar);
  },
  anchors: (s) => ({ optic: [s.r0 + 8, 5], mount: [s.r0 + 8, 5], muzzle: [s.bar, 7], mag: [s.r0 + 10, 11], stock: [s.r0 - 1, 7], under: [s.r1 + 6, 10], grip: [s.r1 + 6, 10], rail: [s.r1 + 6, 6], tactical: [s.hg - 2, 7], bipod: [s.hg - 2, 9], sling: [s.r0 - 7, 10] }),
  mini: (s) => ({ deep: true, top: [{ t: "bar", x0: s.r1 - 9, x1: s.r1 - 3 }, { t: "post", x0: s.hg + 2 }] }),
};

// The HK roller-locked guns: the MP5 and the G3 (a slim stamped receiver, the cocking tube over the barrel, the drum
// rear sight and the hooded front post).
FAM.hk = {
  d: { kind: "smg", r: [15, 36], hg: 44, bar: 49, gx: 19, stock: { t: "mp5" }, mag: { t: "stick", n: 9, w: 3, curve: 3 }, muzzle: "lugs", c: { body: "gun", hg: "hg", furn: "gun", bar: "dark" } },
  paint(p, s) {
    const { r0, r1, hg, bar, c } = s;
    const big = !!s.big;
    R(p, r0, 6, r1, big ? 10 : 9, c.body); H(p, r0, r1, 6, c.hiBody); R(p, r0 + 1, 4, r0 + 2, 5, C.gun); // the receiver, the drum sight
    R(p, r1 - 3, 4, hg + 1, 5, C.gun); H(p, r1 - 3, hg + 1, 4, C.hi); // the cocking tube, out over the barrel
    if (big) { H(p, r0 + 9, r0 + 12, 7, C.dark); R(p, r1 - 5, 5, r1 - 4, 6, C.metal); } // ejection port, the cocking handle
    else p.set(r1 - 4, 5, C.metal);
    grip(p, s.gx, big ? 11 : 10, 6, 3, c.furn); R(p, s.gx - 2, big ? 11 : 10, s.gx + 5, big ? 11 : 10, c.furn); // the trigger pack
    guard(p, s.gx + 2, s.gx + 5, big ? 10 : 9);
    if (big) { R(p, r1 + 1, 7, hg, 10, c.hg); dots(p, r1 + 2, hg - 1, 8, c.loHg, 2); } // the slim handguard
    else { R(p, r1 + 1, 6, hg, 10, c.hg); dots(p, r1 + 2, hg - 1, 8, C.dark, 2); } // the fat one
    R(p, hg, 3, hg + 1, 5, C.gun); p.clear(hg, 3); // the hooded front post
    BAR(p, s, hg + 1, bar, 7, big ? 2 : 1);
  },
  anchors: (s) => ({ optic: [s.r0 + 11, 5], mount: [s.r0 + 11, 5], muzzle: [s.bar, 7], mag: [s.r0 + 12, s.big ? 11 : 10], stock: [s.r0 - 1, 7], under: [s.r1 + 4, s.big ? 10 : 10], grip: [s.r1 + 4, 10], rail: [s.r1 + 4, 7], tactical: [s.r1 + 5, 7], bipod: [s.hg - 2, 10], sling: [s.r0 - 1, 9] }),
  mini: (s) => ({ top: [{ t: "bar", x0: s.r1 - 3, x1: s.hg + 1, col: C.gun }], fore: { x0: s.r1 + 1, x1: s.hg, row: 1, col: s.c.hg } }),
};

// The M14 / M1A: a full-length wooden stock to near the muzzle, the steel receiver and op-rod on top, a box magazine.
FAM.m14 = {
  d: { kind: "rifle", r: [18, 31], hg: 45, bar: 53, gx: 21, stock: { t: "m14", c: "wood" }, mag: { t: "box", n: 6, w: 5 }, muzzle: "fh_m14", c: { body: "grey", furn: "wood", bar: "dark", hg: "wood" } },
  paint(p, s) {
    const { r0, r1, hg, bar, c } = s;
    R(p, r0 - 1, 8, hg - 1, 10, c.furn); H(p, r0 - 1, hg - 1, 10, c.loFurn); dots(p, r0 + 2, hg - 3, 9, c.loFurn, 4); // the stock's fore part
    R(p, r0, 5, r1, 7, c.body); H(p, r0, r1, 5, c.hiBody); // the receiver over the wood
    R(p, r0, 3, r0 + 1, 4, C.gun); p.set(r0, 2, C.gun); // the aperture sight
    R(p, r1 + 1, 6, hg - 3, 7, c.hg); H(p, r1 + 1, hg - 3, 6, c.hiHg); // the upper handguard
    H(p, r1 - 4, hg - 2, 8, C.steel); R(p, r1 - 5, 7, r1 - 4, 8, C.metal); // the op-rod and its handle
    R(p, hg - 2, 7, hg + 1, 9, C.gun); // the gas cylinder
    guard(p, s.gx + 1, s.gx + 5, 10, C.steel);
    BAR(p, s, r1 + 1, bar, 7, 1);
    if (s.ears !== false) { R(p, bar - 3, 3, bar - 2, 6, C.gun); p.clear(bar - 3, 3); } else R(p, bar - 1, 5, bar - 1, 6, C.gun); // the front sight's ears, or a plain blade
    if (s.lug !== false) p.set(hg + 3, 8, C.gun); // the bayonet lug
  },
  anchors: (s) => ({ optic: [s.r0 + 6, 5], mount: [s.r0 + 6, 5], muzzle: [s.bar, 7], mag: [s.gx + 7, 11], stock: [s.r0 - 1, 7], under: [s.r1 + 6, 10], grip: [s.r1 + 6, 10], rail: [s.r1 + 7, 6], tactical: [s.r1 + 9, 8], bipod: [s.hg - 4, 10], sling: [s.r0 - 8, 11] }),
  mini: (s) => ({ fore: { x0: s.r0, x1: s.hg - 1, row: 1, col: s.c.furn }, top: [{ t: "post", x0: s.bar - 2 }] }),
};

// Bolt-action, rimfire and long single guns with a classic action: receiver, barrel, a wooden or synthetic fore-end.
FAM.bolt = {
  d: { kind: "rifle", r: [19, 32], bar: 52, fe: 41, barRows: 2, taper: true, stock: { t: "wood", c: "wood" }, bolt: "knob", bead: true, c: { body: "gun", furn: "wood", bar: "gun", fe: "wood" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 6, r1, s.ry1 || 9, c.body); H(p, r0, r1, 6, c.hiBody);
    R(p, r1 + 1, 7, bar, 7 + s.barRows - 1, c.bar);
    if (s.taper && s.barRows === 2) H(p, r1 + 1, bar, 8, c.bar), p.clear(bar, 8), p.clear(bar - 1, 8); // tapering to the muzzle
    if (s.bead) p.set(bar, 6, C.metal);
    if (s.bolt === "knob") { p.set(r1 - 5, 9, C.metal); p.set(r1 - 4, 10, C.metal); p.set(r1 - 3, 10, C.metal); }
    else if (s.bolt === "small") { p.set(r1 - 6, 8, C.metal); p.set(r1 - 5, 9, C.metal); }
    else if (s.bolt === "tac") { p.set(r1 - 5, 9, C.metal); R(p, r1 - 4, 10, r1 - 3, 11, C.gun); }
    if (s.fe) { R(p, r0, 9, s.fe, 10, c.fe); H(p, r0, s.fe, 10, c.loFe); }
    guard(p, r0 + 2, r0 + 6, 10, C.gun);
    if (s.floor) H(p, r0 + 4, r0 + 9, 11, C.steel); // the hinged floorplate
    if (s.rail) { H(p, r0, r1 + 4, 5, C.dark); dots(p, r0, r1 + 4, 5, C.hi); }
  },
  anchors: (s) => ({ optic: [s.r0 + 7, s.rail ? 5 : 6], mount: [s.r0 + 7, 6], muzzle: [s.bar, 7], mag: [s.r0 + 4, 11], stock: [s.r0 - 1, 8], under: [Math.round((s.r1 + (s.fe || s.r1 + 8)) / 2) + 1, 10], bipod: [Math.round((s.r1 + (s.fe || s.r1 + 8)) / 2) + 1, 10], sling: [s.r0 - 4, 11] }),
  mini: (s) => ({ fore: s.fe ? { x0: s.r0, x1: s.fe, row: 1, col: s.c.fe } : null, bar2: s.barRows > 2 }),
};

// Break-action guns: a side-by-side double, an over-under (barrels stacked), a single barrel (hinge and hammer
// showing), a sawn-off, the grenade launcher's fat barrel.
FAM.brk = {
  d: { kind: "shotgun", r: [18, 26], bar: 52, n: 2, fe: 36, stock: { t: "wood", c: "wood" }, c: { body: "steel", furn: "wood", bar: "gun", fe: "wood" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    if (s.over) { // over-under: a deep action, two barrels stacked, a vent rib on top
      const lo = s.slim ? 7 : 8, hiB = s.slim ? 5 : 4; // the barrels' top rows
      R(p, r0, hiB, r1, lo + 3, c.body); H(p, r0, r1, hiB, c.hiBody); p.clear(r1, lo + 3); p.set(r0 + 1, hiB - 1, C.gun); // the action (its front rounded), the top lever
      for (let y = hiB + 2; y <= lo + 1; y += 2) dots(p, r0 + 1 + (y % 4 ? 1 : 0), r1 - 2, y, c.loBody, 2); // the engraving
      R(p, r1 + 1, hiB, bar, hiB + (s.slim ? 0 : 1), c.bar); H(p, r1 + 1, bar, hiB, c.hiBar); // the upper barrel
      H(p, r1 + 1, bar, lo - 1, C.dark); // the side rib between them
      R(p, r1 + 1, lo, bar, lo + (s.slim ? 0 : 1), c.bar); // the lower barrel
      H(p, r1 + 1, bar, hiB - 1, c.hiBar); // the rib
      if (!s.slim) H(p, r1 + 1, bar, lo, c.hiBar); // the lower barrel's light
      p.set(bar, hiB - 2, C.metal); // the bead
      forend(p, r1 + 1, s.fe, lo + (s.slim ? 1 : 2), lo + (s.slim ? 2 : 3), c.fe, c.loFe); p.set(s.fe + 1, lo + (s.slim ? 1 : 2), c.fe); // the schnabel fore-end
      guard(p, r0 + 1, r0 + 5, lo + (s.slim ? 2 : 3), C.gun);
      return;
    }
    if (s.n === 1) { // a single barrel: the action, its hinge pin, the hammer
      R(p, r0, 6, r1, 10, c.body); H(p, r0, r1, 6, c.hiBody);
      R(p, r0 - 1, 4, r0, 5, C.gun); p.set(r0 - 2, 3, C.gun); // the hammer's spur
      R(p, r1 + 1, 6, bar, 6 + (s.barRows || 2) - 1, c.bar); H(p, r1 + 1, bar, 6, c.hiBar);
      if (s.taper) { p.clear(bar, 7); p.clear(bar - 1, 7); p.clear(bar - 2, 7); }
      R(p, r1 - 1, 8, r1, 9, C.dark); p.set(r1, 8, C.metal); // the hinge pin
      p.set(r0 + 3, 11, C.metal); p.set(r0 + 3, 12, C.steel); // the release lever in front of the guard
      if (s.fe) forend(p, r1 + 1, s.fe, 8, 9, c.fe, c.loFe);
      guard(p, r0 + 1, r0 + 5, 10, C.gun);
      if (s.bead !== false) p.set(bar, 5, C.metal);
      if (s.base) { H(p, r0 + 1, r1 - 1, 5, C.dark); dots(p, r0 + 1, r1 - 1, 5, C.hi); } // a scope base
      return;
    }
    // a side-by-side double (one barrel hides the other): the action, the top lever, the rib
    R(p, r0, 6, r1, 10, c.body); H(p, r0, r1, 6, c.hiBody); p.set(r0 + 1, 5, C.gun);
    if (s.hammers) { R(p, r0 - 1, 4, r0, 5, C.gun); p.set(r0 - 2, 3, C.gun); }
    R(p, r1 + 1, 6, bar, s.fat ? 10 : 7, c.bar); if (!s.fat) H(p, r1 + 1, bar, 8, C.dark); H(p, r1 + 1, bar, 5, c.hiBar);
    if (s.fe) forend(p, r1 + 1, s.fe, s.fat ? 11 : 9, s.fat ? 12 : 10, c.fe, c.loFe);
    guard(p, r0 + 1, r0 + 5, 10, C.gun);
    p.set(bar, 4, C.metal);
    if (s.ladder) { R(p, r1 + 3, 2, r1 + 4, 4, C.gun); p.set(r1 + 5, 2, C.gun); R(p, bar - 2, 3, bar - 2, 5, C.gun); } // the launcher's ladder sight and blade
  },
  anchors: (s) => {
    const top = s.over ? (s.slim ? 5 : 4) : 6;
    return { optic: [s.r0 + 5, s.over ? top - 1 : 5], mount: [s.r0 + 5, s.over ? top - 1 : 5], muzzle: [s.bar, top], stock: [s.r0 - 1, 8], under: [Math.round((s.r1 + (s.fe || s.r1 + 8)) / 2), s.over ? (s.slim ? 9 : 11) : s.fat ? 12 : 10], sling: [s.r0 - 4, 11] };
  },
  mini: (s) => ({ bar2: s.n === 2 || !!s.fat, over: !!s.over, fore: s.fe ? { x0: s.r1 + 1, x1: s.fe, row: 1, col: s.c.fe } : null, top: s.n === 1 ? [{ t: "dot", x0: s.r0 - 1, col: C.gun }] : [], hinge: s.n === 1 ? s.r1 : null }),
};

// Lever-actions: the receiver (blued, case-coloured or nickel), the tube under the barrel, the lever's loop.
FAM.lever = {
  d: { kind: "rifle", r: [18, 27], bar: 50, tube: 46, fe: 37, loop: "small", stock: { t: "lever", c: "wood" }, c: { body: "steel", furn: "wood", bar: "gun", fe: "wood" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 6, r1, 10, c.body); H(p, r0, r1, 6, c.hiBody); p.set(r1 - 2, 8, C.dark); // the receiver, its loading gate
    R(p, r1 + 1, 7, bar, 7 + (s.barRows || 1) - 1, c.bar); p.set(bar, 6, C.metal);
    R(p, r1 + 1, 8, s.tube, 8, C.gun); // the magazine tube
    forend(p, r1 + 1, s.fe, 9, 10, c.fe, c.loFe);
    if (s.band) V(p, s.fe + 3, 7, 9, C.metal); // the barrel band
    const loop = s.loop === "big" ? [[r0 + 1, 11], [r0, 12], [r0, 13], [r0, 14], [r0 + 1, 15], [r0 + 2, 15], [r0 + 3, 15], [r0 + 4, 15], [r0 + 5, 14], [r0 + 6, 13], [r0 + 6, 12], [r0 + 7, 11]]
      : [[r0 + 1, 11], [r0 + 1, 12], [r0 + 2, 13], [r0 + 3, 13], [r0 + 4, 13], [r0 + 5, 12], [r0 + 6, 11], [r0 + 7, 11]];
    for (const [x, y] of loop) p.set(x, y, C.steel);
    p.set(r0, 5, C.gun); // the hammer
    if (s.ring) { p.set(r0 + 2, 10, C.metal); p.set(r0 + 3, 10, C.metal); } // the saddle ring
  },
  anchors: (s) => ({ optic: [s.r0 + 4, 6], mount: [s.r0 + 4, 6], muzzle: [s.bar, 7], mag: [s.tube, 8], stock: [s.r0 - 1, 8], under: [Math.round((s.r1 + s.fe) / 2), 10], bipod: [s.fe - 2, 10], sling: [s.r0 - 4, 11] }),
  mini: (s) => ({ fore: { x0: s.r1 + 1, x1: s.fe, row: 1, col: s.c.fe }, under: [{ t: "loop", x0: s.r0 + 2 }], top: [{ t: "dot", x0: s.r0, col: C.gun }] }),
};

// Pump shotguns: the receiver, the barrel, the magazine tube, the pump (a heat shield, shells in a side saddle).
FAM.pump = {
  d: { kind: "shotgun", r: [16, 28], bar: 52, tube: 46, pump: [32, 41], stock: { t: "wood", c: "wood" }, c: { body: "gun", furn: "wood", bar: "gun", pump: "wood" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 6, r1, 10, c.body); H(p, r0, r1, 6, c.hiBody); H(p, r0 + 4, r0 + 7, 8, C.dark); // the receiver, its port
    R(p, r1 + 1, 6, bar, s.slim ? 6 : 7, c.bar); p.set(bar, 5, C.metal); // barrel, bead
    if (s.rib) dots(p, r1 + 1, bar, 5, c.bar, 2);
    R(p, r1 + 1, s.slim ? 7 : 8, s.tube, s.slim ? 8 : 9, C.dark); // the magazine tube
    const [q0, q1] = s.pump;
    if (s.pumpT === "tac") { R(p, q0, s.slim ? 7 : 8, q1, 10, c.pump); H(p, q0, q1, 10, C.dark); dots(p, q0, q1, 10, C.hi); }
    else { R(p, q0, s.slim ? 7 : 8, q1, 10, c.pump); dots(p, q0 + 1, q1 - 1, 9, c.loPump, 2); }
    guard(p, r0 + 2, r0 + 6, 10, C.gun);
    if (s.pg) grip(p, r0 + 1, 11, 5, 3, c.furn);
    if (s.shield) { R(p, r1 + 1, 4, r1 + 13, 5, C.gun); dots(p, r1 + 2, r1 + 12, 4, C.dark, 2); } // the heat shield
    if (s.ghost) { R(p, r1 - 3, 3, r1 - 2, 5, C.gun); p.clear(r1 - 3, 4); R(p, bar - 1, 3, bar - 1, 5, C.gun); } // ghost ring and blade
    if (s.saddle) { R(p, r0 + 1, 7, r0 + 8, 9, C.dark); for (let x = r0 + 2; x <= r0 + 7; x += 2) { p.set(x, 7, C.shell); p.set(x, 8, C.shell); p.set(x, 9, C.brass); } } // shells in the side saddle
  },
  anchors: (s) => ({ optic: [s.r0 + 6, 5], mount: [s.r0 + 6, 5], muzzle: [s.bar, 6], mag: [s.tube, s.slim ? 7 : 8], stock: [s.r0 - 1, 8], under: [s.pump[1] + 3, 10], tactical: [s.pump[1] + 3, 10], grip: [s.pump[0] + 4, 10], sling: [s.r0 - 4, 11] }),
  mini: (s) => ({ under: [{ t: "pump", x0: s.pump[0], x1: s.pump[1], col: s.c.pump }], top: s.shield ? [{ t: "bar", x0: s.r1 + 1, x1: s.r1 + 13, col: C.gun }] : [], side: s.saddle ? { x0: s.r0 + 2, col: C.shell } : null }),
};

// The semi-automatic shotgun (and other plain long receivers): receiver, barrel, tube, a polymer fore-end.
FAM.semi = {
  d: { kind: "shotgun", r: [15, 30], bar: 52, tube: 46, fe: 41, stock: { t: "poly" }, pg: true, c: { body: "gun", furn: "gun", bar: "gun", fe: "hg" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 6, r1, 10, c.body); H(p, r0, r1, 6, c.hiBody); H(p, r0 + 3, r0 + 7, 8, C.metal);
    R(p, r1 + 1, 6, bar, 7, c.bar); p.set(bar, 5, C.metal);
    R(p, r1 + 1, 8, s.tube, 9, C.dark);
    R(p, r1 + 1, 8, s.fe, 10, c.fe);
    if (s.pg) grip(p, r0 + 1, 11, 5, 3, c.furn);
    guard(p, r0 + 4, r0 + 8, 10, C.gun);
    if (s.rail) { H(p, r0, r1, 5, C.dark); dots(p, r0, r1, 5, C.hi); }
    if (s.ghost) { R(p, r1 - 2, 3, r1 - 1, 4, C.gun); p.clear(r1 - 2, 3); }
  },
  anchors: (s) => ({ optic: [s.r0 + 8, 5], mount: [s.r0 + 8, 5], muzzle: [s.bar, 6], mag: [s.tube, 8], stock: [s.r0 - 1, 8], under: [s.fe + 3, 10], tactical: [s.fe + 3, 10], sling: [s.r0 - 4, 11] }),
  mini: (s) => ({ fore: { x0: s.r1 + 1, x1: s.fe, row: 1, col: s.c.fe } }),
};

// Pistols with a slide: the slide (serrations, sights), the frame and its rail, the grip (panels), a hammer.
FAM.slide = {
  d: { kind: "pistol", x0: 18, x1: 44, y0: 5, gx: 23, gripN: 10, gripW: 6, stock: null, c: { slide: "gun", frame: "hg", grip: "hg", bar: "dark" } },
  paint(p, s) {
    const { x0, x1, y0, c } = s, y1 = y0 + (s.tall ? 4 : 3);
    R(p, x0, y0, x1, y1, c.slide); H(p, x0, x1, y0, c.hiSlide); dots(p, x0 + 1, x0 + 6, y0 + 1, c.loSlide); // slide, rear serrations
    if (s.fserr) dots(p, x1 - 6, x1 - 2, y0 + 1, c.loSlide);
    if (s.tall) { H(p, x0 + 2, x1 - 2, y0 - 1, C.dark); dots(p, x0 + 2, x1 - 2, y0 - 1, C.hi); p.clear(x1, y1); p.clear(x1, y1 - 1); p.set(x1 - 1, y1, c.loSlide); H(p, x1 - 9, x1 - 4, y0 + 2, c.loSlide); } // the hand cannon: a top rail, the triangular nose, the ports
    if (s.port) H(p, x0 + 9, x0 + 13, y0 + 1, C.dark);
    R(p, x0 + 2, y1 + 1, x1 - 4, y1 + 2, c.frame); // the frame
    if (s.rail !== false) { H(p, x1 - 9, x1 - 4, y1 + 3, C.dark); dots(p, x1 - 9, x1 - 4, y1 + 3, C.hi); } // the accessory rail
    p.set(x1 - 1, y0 - 1, C.gun); p.set(x0 + 2, y0 - 1, C.gun); // the sights
    grip(p, s.gx, y1 + 3, s.gripN, s.gripW, c.grip, 3);
    if (s.panels) R(p, s.gx - 2, y1 + 5, s.gx + 2, y1 + 9, c.panels);
    if (s.stipple) for (let i = 0; i < s.gripN - 2; i += 2) p.set(s.gx + 2 - Math.floor(i / 3), y1 + 4 + i, c.loGrip);
    if (s.hammer) { p.set(x0 - 1, y0, C.gun); p.set(x0 - 1, y0 + 1, C.gun); }
    if (s.beaver) { p.set(x0 - 1, y1 + 2, c.frame); p.set(x0, y1 + 2, c.frame); }
    guard(p, s.gx + 5, s.gx + 10, y1 + 2);
    if (s.sqGuard) p.set(s.gx + 10, y1 + 3, C.dark);
    H(p, x1 + 1, x1 + 1, y0 + 1, C.dark); // the muzzle crown
    if (s.bbl) H(p, x1 + 1, x1 + s.bbl, y0 + 1, c.bar); // a barrel out past the slide
  },
  anchors: (s) => {
    const y1 = s.y0 + (s.tall ? 4 : 3), xm = s.x1 + (s.bbl || 0);
    return { optic: [s.x1 - 11, s.y0 - 1], mount: [s.x1 - 11, s.y0 - 1], muzzle: [xm + 1, s.y0 + 1], mag: [s.gx - 2, y1 + 2 + s.gripN], under: [s.x1 - 7, y1 + 3], tactical: [s.x1 - 7, y1 + 3], grip: [s.gx - 1, y1 + 7] };
  },
  mini: (s) => ({ len: s.x1 + (s.bbl || 0), tall: !!s.tall, hammer: !!s.hammer, grip: s.c.grip, rail: s.rail !== false && s.miniRail }),
};

// Revolvers: the frame, the cylinder (flutes), the barrel (an ejector rod or a full lug under it, a vent rib on
// top), the hammer, the grip (a part: the builder's grip slot).
FAM.revolver = {
  d: { kind: "revolver", fr: [19, 31], cyl: [22, 29], bar: 46, gx: 19, lug: false, grips: "grip_wood", c: { frame: "steel", cyl: "grey", bar: "steel", grip: "wood" } },
  paint(p, s) {
    const [f0, f1] = s.fr, [c0, c1] = s.cyl, { bar, c } = s;
    R(p, f0, 6, f1, 10, c.frame); H(p, f0, f1, 6, c.hiFrame); R(p, f0, 7, f0 + 1, 11, c.frame); // the frame: top strap, recoil shield
    R(p, c0, 6, c1, 11, c.cyl); p.clear(c0, 6); p.clear(c1, 6); p.clear(c0, 11); p.clear(c1, 11); // the cylinder, bulging past the frame
    if (!s.fluteless) for (let x = c0 + 1; x < c1; x += 2) V(p, x, 7, 10, c.hiCyl); // its flutes
    H(p, c0 + 1, c1 - 1, 11, c.loCyl);
    R(p, f1 + 1, 6, bar, 8, c.bar); H(p, f1 + 1, bar, 6, c.hiBar); // the barrel
    if (s.lug) { R(p, f1 + 1, 9, bar, 10, c.bar); H(p, f1 + 1, bar, 10, c.loBar); } // a full-length underlug
    else if (bar - f1 > 6) H(p, f1 + 1, Math.min(bar - 4, f1 + 10), 9, c.bar); // the ejector rod
    else p.set(f1 + 1, 9, c.bar);
    if (s.rib) H(p, f1 + 1, bar, 5, c.hiBar); // a rib on top
    R(p, bar - 1, 4, bar - 1, 5, c.bar); // the front sight
    if (s.hammer !== "bob") { p.set(f0 - 1, 5, C.gun); p.set(f0, 5, C.gun); p.set(f0 - 2, 4, C.gun); p.set(f0 - 1, 6, C.gun); } else p.set(f0, 5, c.frame); // the hammer (shrouded on a snub)
    guard(p, f0 + 2, f0 + 6, 10);
  },
  anchors: (s) => ({ optic: [s.fr[1] + 5, 5], mount: [s.fr[1] + 5, 5], muzzle: [s.bar, 7], grip: [s.fr[0] - 1, 12], under: [s.fr[1] + 4, s.lug ? 10 : 9], tactical: [s.fr[1] + 4, s.lug ? 10 : 9] }),
  mini: (s) => ({ len: s.bar, cyl: true, hammer: s.hammer !== "bob", grip: s.c.grip, frame: s.c.frame }),
};

// The .22 target pistol: a slim receiver and a long barrel, wooden grip panels.
FAM.rimpistol = {
  d: { kind: "pistol", x0: 18, x1: 30, bar: 46, gx: 21, c: { slide: "gun", bar: "gun", grip: "hg", panels: "wood" } },
  paint(p, s) {
    const { x0, x1, bar, c } = s;
    R(p, x0, 6, x1, 9, c.slide); H(p, x0, x1, 6, c.hiSlide);
    R(p, x1 + 1, 6, bar, 8, c.bar); H(p, x1 + 1, bar, 6, c.hiBar); p.set(bar, 5, C.gun);
    grip(p, s.gx, 10, 10, 5, c.grip, 3); R(p, s.gx - 2, 12, s.gx + 1, 16, c.panels);
    guard(p, s.gx + 4, s.gx + 8, 9);
  },
  anchors: (s) => ({ optic: [s.x0 + 8, 5], mount: [s.x0 + 8, 5], muzzle: [s.bar, 7], mag: [s.gx - 2, 19], under: [s.x1 + 5, 9], tactical: [s.x1 + 5, 9], grip: [s.gx - 1, 14] }),
  mini: (s) => ({ len: s.bar, grip: s.c.panels, slide: s.c.slide }),
};

// The UMP: a boxy polymer receiver, the rails, a straight magazine, a side-folding skeleton stock.
FAM.ump = {
  d: { kind: "smg", r: [14, 40], bar: 47, gx: 19, stock: { t: "ump" }, mag: { t: "box", n: 8, w: 4, curve: 8, col: "poly" }, muzzle: "crown", c: { body: "poly", furn: "poly", bar: "dark" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 5, r1, 10, c.body); H(p, r0, r1, 5, c.hiBody); H(p, r0 + 1, r1 - 6, 4, C.dark); dots(p, r0 + 1, r1 - 6, 4, C.hi); // the box, its top rail
    H(p, r0 + 8, r0 + 12, 7, C.dark); R(p, r0 + 3, 7, r0 + 4, 8, c.loBody); // ejection port, the knob
    p.clear(r1, 10); p.clear(r1, 9); p.set(r1 - 1, 10, c.loBody); // the front tapered
    H(p, r1 - 9, r1 - 2, 11, C.dark); dots(p, r1 - 9, r1 - 2, 11, C.hi); // the under rail
    dots(p, r1 - 8, r1 - 2, 7, c.loBody, 2); // the side rail
    grip(p, s.gx, 11, 6, 3, c.furn); R(p, s.gx + 2, 11, s.gx + 7, 13, c.body); p.clear(s.gx + 4, 12); p.clear(s.gx + 5, 12); p.clear(s.gx + 4, 13); p.clear(s.gx + 5, 13); p.clear(s.gx + 6, 12); // the grip, the big moulded guard
    R(p, r0 + 1, 2, r0 + 2, 3, C.gun); R(p, r1 - 4, 2, r1 - 3, 3, C.gun); // sights on the rail
    BAR(p, s, r1 + 1, bar, 7, 1);
  },
  anchors: (s) => ({ optic: [s.r0 + 12, 4], mount: [s.r0 + 12, 4], muzzle: [s.bar, 7], mag: [s.gx + 10, 11], stock: [s.r0 - 1, 7], under: [s.r1 - 5, 11], tactical: [s.r1 - 5, 11], grip: [s.r1 - 5, 11], sling: [s.r0 - 1, 9] }),
  mini: (s) => ({ deep: true }),
};

// The Vector: a long top rail, the low barrel under it, the angled housing in front of the grip, the magazine in it.
FAM.vector = {
  d: { kind: "smg", r: [16, 42], bar: 49, gx: 19, stock: { t: "tele" }, mag: { t: "box", n: 6, w: 3, curve: 0, col: "poly" }, muzzle: "crown", c: { body: "poly", furn: "poly", bar: "dark", low: "poly" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    H(p, r0, r1, 4, C.dark); dots(p, r0, r1, 4, C.hi); // the top rail
    R(p, r0, 5, r1, 8, c.body); H(p, r0, r1, 5, c.hiBody);
    for (let i = 0; i < 5; i++) H(p, s.gx + 3 + i, r1 - 2 - i, 9 + i, c.low); // the housing, its front sloping back
    p.set(r1 - 1, 9, c.low);
    H(p, s.gx + 6, r1 - 6, 10, c.loBody); // the kriss system's seam
    grip(p, s.gx, 9, 7, 3, c.furn);
    guard(p, s.gx + 1, s.gx + 3, 12);
    R(p, r1 - 1, 9, bar, 10, c.bar); H(p, r1 - 1, bar, 9, C.gun); // the low barrel
    R(p, r0 + 2, 2, r0 + 3, 3, C.gun); R(p, r1 - 3, 2, r1 - 2, 3, C.gun); // folding sights
    H(p, r1 - 12, r1 - 2, 7, c.loBody);
  },
  anchors: (s) => ({ optic: [s.r0 + 12, 4], mount: [s.r0 + 12, 4], muzzle: [s.bar, 9], mag: [s.gx + 9, 14], stock: [s.r0 - 1, 6], under: [s.r1 - 6, 8], tactical: [s.r1 - 4, 7], grip: [s.r1 - 6, 8], sling: [s.r0 - 1, 8] }),
  mini: (s) => ({ deep: true, low: true }),
};

// The P90: a rounded bullpup, the magazine lying on top, the thumbhole grip, a short muzzle.
FAM.p90 = {
  d: { kind: "smg", r: [12, 44], bar: 48, gx: 31, stock: null, mag: { t: "top", len: 21 }, muzzle: "fh", c: { body: "poly", furn: "poly", bar: "dark" } },
  paint(p, s, fitted = {}) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 6, r1, 11, c.body); H(p, r0 + 1, r1 - 1, 6, c.hiBody); // the shell
    p.clear(r0, 6); p.clear(r0, 11); p.clear(r1, 11); p.set(r0 + 1, 12, c.body); R(p, r0, 7, r0, 12, C.rubber); // the rounded butt
    for (let i = 0; i < 4; i++) H(p, r0 + 3 + i, r0 + 12 - i, 12 + i, c.body); // under the butt
    R(p, s.gx - 1, 12, s.gx + 9, 16, c.body); R(p, s.gx + 1, 12, s.gx + 6, 14, null); for (let y = 12; y <= 14; y++) for (let x = s.gx + 1; x <= s.gx + 6; x++) p.clear(x, y); // the thumbhole loop
    H(p, s.gx + 1, s.gx + 6, 15, c.loBody);
    if (!fitted.optic) { R(p, r0 + 18, 2, r0 + 25, 4, c.body); R(p, r0 + 19, 3, r0 + 24, 3, C.dark); p.set(r0 + 24, 3, C.glass); } // the ring sight's housing
    R(p, r1 + 1, 8, bar, 8, c.bar);
    p.set(r1 - 2, 9, C.dark);
  },
  anchors: (s) => ({ optic: [s.r0 + 21, 5], mount: [s.r0 + 21, 5], muzzle: [s.bar, 8], mag: [s.r0 + 6, 4], under: [s.r1 - 6, 12], tactical: [s.r1 - 3, 9], sling: [s.r0 + 1, 9] }),
  mini: (s) => ({ deep: true }),
};

// Bullpups: the AUG (its scope-handle, the clear magazine behind the grip, the folding foregrip) and the FAMAS (the
// long carry handle, its bipod legs folded along it).
FAM.bullpup = {
  d: { kind: "rifle", r: [8, 36], bar: 52, gx: 30, v: "aug", stock: null, mag: { t: "clear" }, muzzle: "fh", c: { body: "od", furn: "od", bar: "dark" } },
  paint(p, s, fitted = {}) {
    const { r0, r1, bar, c } = s, aug = s.v === "aug";
    R(p, r0, 6, r1, 11, c.body); H(p, r0 + 1, r1, 6, c.hiBody); R(p, r0, 6, r0, 11, C.rubber); // the body, the butt pad
    R(p, r0 + 3, 12, r0 + 11, 12, c.body); // the cheek
    grip(p, s.gx, 12, 6, 3, c.furn);
    if (aug) { // the guard all round the hand, from the grip's foot to the body
      H(p, s.gx - 1, s.gx + 6, 18, c.body); V(p, s.gx + 7, 12, 17, c.body); p.set(s.gx + 6, 17, c.body); p.set(s.gx + 3, 12, C.metal);
      R(p, r1 + 1, 6, r1 + 3, 10, c.body); // the barrel's shroud
      R(p, r1 + 5, 10, r1 + 6, 15, c.furn); p.set(r1 + 6, 16, c.loFurn); // the foregrip
      if (!fitted.optic) { R(p, s.gx - 6, 1, s.gx + 6, 2, c.body); V(p, s.gx - 4, 3, 5, c.body); V(p, s.gx + 4, 3, 5, c.body); R(p, s.gx - 7, 1, s.gx - 7, 2, C.dark); p.set(s.gx + 7, 1, C.glass); p.set(s.gx + 7, 2, C.glass); } // the scope-handle
      else { H(p, s.gx - 7, s.gx + 7, 5, C.dark); dots(p, s.gx - 7, s.gx + 7, 5, C.hi); }
    } else { // FAMAS
      guard(p, s.gx + 2, s.gx + 6, 11);
      H(p, s.gx - 2, s.gx + 7, 17, c.body); V(p, s.gx + 7, 12, 17, c.body); // the full guard
      if (!fitted.optic) { R(p, r0 + 8, 2, r1 + 1, 3, c.body); V(p, r0 + 9, 4, 5, c.body); V(p, r1, 4, 5, c.body); R(p, r0 + 9, 1, r0 + 10, 1, C.gun); R(p, r1, 1, r1 + 1, 1, C.gun); } // the carry handle, its sights
      else { H(p, r0 + 9, r1, 5, C.dark); dots(p, r0 + 9, r1, 5, C.hi); }
      R(p, r1 + 1, 7, r1 + 6, 10, c.body); // the handguard's nose
      H(p, r1 - 6, r1 + 6, 9, C.gun); V(p, r1 + 6, 9, 10, C.gun); // the bipod's legs, folded
    }
    p.set(r0 + 15, 7, C.dark); H(p, r0 + 15, r0 + 18, 8, C.dark); // the ejection port
    BAR(p, s, aug ? r1 + 4 : r1 + 7, bar, 7, aug ? 2 : 1);
    if (aug) R(p, r1 + 4, 6, r1 + 8, 6, C.gun); // the gas cylinder
    else p.set(bar - 2, 6, C.gun);
  },
  anchors: (s) => s.v === "aug"
    ? { optic: [s.gx, 4], mount: [s.gx, 4], muzzle: [s.bar, 7], mag: [s.gx - 9, 12], under: [s.r1 + 9, 10], tactical: [s.r1 + 10, 7], rail: [s.gx, 5], sling: [s.r0 + 2, 11] }
    : { optic: [s.r0 + 18, 4], mount: [s.r0 + 18, 4], muzzle: [s.bar, 7], mag: [s.gx - 8, 12], under: [s.r1 + 3, 11], tactical: [s.r1 + 4, 8], rail: [s.r0 + 18, 4], sling: [s.r0 + 2, 11] },
  mini: (s) => ({ deep: true, bullpup: true, top: s.v === "aug" ? [{ t: "scope", x0: s.gx - 5, x1: s.gx + 6 }] : [{ t: "bar", x0: s.r0 + 8, x1: s.r1 + 1 }], under: s.v === "aug" ? [{ t: "fgrip", x0: s.r1 + 5 }] : [] }),
};

// Machine guns: the M249 (feed cover, a carry handle on the receiver), the M240 (feed cover, carry handle on the
// barrel, gas tube under it), the M2 (spade grips, the perforated barrel jacket).
FAM.mg = {
  d: { kind: "mg", r: [15, 31], hg: 41, bar: 51, v: "m249", stock: { t: "wire" }, mag: { t: "beltbox" }, muzzle: "fh", bipod: "bipod", c: { body: "gun", hg: "olive", furn: "gun", bar: "dark" } },
  paint(p, s) {
    const { r0, r1, hg, bar, c } = s;
    if (s.v === "m2") {
      R(p, r0, 4, r1, 11, c.body); H(p, r0, r1, 4, c.hiBody); R(p, r0 + 3, 3, r1 - 4, 3, C.gun); // the receiver box, the feed cover
      R(p, r0 - 4, 5, r0 - 1, 6, C.gun); R(p, r0 - 4, 9, r0 - 1, 10, C.gun); V(p, r0 - 5, 4, 11, C.gun); // the spade grips
      p.set(r0 - 2, 7, C.metal); p.set(r0 - 2, 8, C.metal); // the butterfly trigger
      R(p, r1 + 1, 5, r1 + 12, 9, c.hg); for (let x = r1 + 2; x < r1 + 12; x += 2) { p.set(x, 6, C.dark); p.set(x, 8, C.dark); } // the perforated jacket
      R(p, r1 + 13, 6, bar, 8, c.bar); R(p, bar - 1, 5, bar, 9, C.gun); // the heavy barrel, its flash hider
      R(p, r1 - 6, 1, r1 - 3, 2, C.gun); // the rear sight leaf
      R(p, r0 + 9, 12, r0 + 11, 13, C.gun); for (let i = 0; i < 8; i++) { p.set(r0 + 9 - i, 14 + i, C.gun); p.set(r0 + 11 + i, 14 + i, C.gun); p.set(r0 + 10, 14 + Math.min(i, 5), C.gun); } // the tripod
      return;
    }
    if (s.v === "m240") {
      R(p, r0, 5, r1, 10, c.body); H(p, r0, r1, 5, c.hiBody); R(p, r0 + 4, 3, r1 - 1, 4, C.gun); p.set(r1, 4, C.gun); dots(p, r0 + 5, r1 - 2, 3, C.hi, 3); // the receiver, the feed cover
      H(p, r1 - 3, r1, 6, C.dark); dots(p, r0 + 2, r0 + 10, 8, C.hi, 2); // the cover's latch, the rivets
      grip(p, s.gx, 11, 6, 3, c.furn); guard(p, s.gx + 2, s.gx + 6, 10);
      R(p, r1 + 1, 6, bar, 7, c.bar); // the barrel
      R(p, r1 + 1, 8, hg, 9, C.gun); R(p, hg - 2, 8, hg, 10, C.gun); // the gas tube, its cylinder
      R(p, r1 + 3, 2, r1 + 8, 2, C.gun); V(p, r1 + 3, 3, 5, C.gun); V(p, r1 + 8, 3, 5, C.gun); // the carry handle on the barrel
      R(p, bar - 4, 3, bar - 3, 5, C.gun); // the front sight
      R(p, r0 - 1, 6, r0, 9, C.dark); // the buffer
      return;
    }
    FAM.ar.paint(p, { ...s, hgT: "x", fs: "fsb", buffer: true, c: { ...c, hg: c.hg } }); // the M249: an AR-like core
    R(p, r0 + 7, 2, r1 - 1, 3, C.gun); p.set(r0 + 7, 4, C.gun); p.set(r1 - 1, 4, C.gun); // carry handle
    R(p, r1 + 1, 4, r1 + 3, 5, C.gun); // feed cover hinge
  },
  anchors: (s) => s.v === "m2"
    ? { optic: [s.r0 + 8, 3], mount: [s.r0 + 8, 3], muzzle: [s.bar, 7], mag: [s.r0 + 8, 12], stock: [s.r0 - 1, 8], tactical: [s.r1 + 6, 9], sling: [s.r0 + 2, 11] }
    : s.v === "m240"
      ? { optic: [s.r0 + 10, 3], mount: [s.r0 + 10, 3], muzzle: [s.bar, 6], mag: [s.r0 + 10, 11], stock: [s.r0 - 1, 7], under: [s.hg + 2, 9], tactical: [s.hg + 3, 7], bipod: [s.hg + 3, 8], sling: [s.r0 - 8, 9] }
      : { optic: [s.r0 + 11, 1], mount: [s.r0 + 11, 1], muzzle: [s.bar, 7], mag: [s.r0 + 12, 11], stock: [s.r0 - 4, 8], under: [s.r1 + 5, 9], tactical: [s.r1 + 7, 7], bipod: [s.hg + 4, 8], sling: [s.r0 - 4, 9] },
  mini: (s) => s.v === "m2" ? { deep: true, top: [], under: [], spade: true } : { deep: s.v === "m240", top: [{ t: "bar", x0: s.v === "m240" ? s.r1 + 3 : s.r0 + 7, x1: s.v === "m240" ? s.r1 + 8 : s.r1 - 1, col: C.gun }] },
};

// The .50: a big receiver with its rail, a short fore-end, the monopod at the back.
FAM.amr = {
  d: { kind: "rifle", r: [14, 33], fe: 41, bar: 52, gx: 18, stock: { t: "amr" }, mag: { t: "box", n: 4, w: 5 }, muzzle: "brake_big", bipod: "bipod", c: { body: "gun", hg: "hg", furn: "gun", bar: "dark" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 5, r1, 10, c.body); H(p, r0, r1, 5, c.hiBody); H(p, r0, r1, 4, C.dark); dots(p, r0, r1, 4, C.hi);
    grip(p, s.gx, 11, 6, 3, c.furn); guard(p, s.gx + 2, s.gx + 6, 10, C.gun);
    R(p, r1 + 1, 6, s.fe, 9, c.hg);
    R(p, s.fe + 1, 7, bar, 8, c.bar);
    R(p, r0 - 5, 13, r0 - 4, 16, C.gun); // the rear monopod
  },
  anchors: (s) => ({ optic: [s.r0 + 10, 4], mount: [s.r0 + 10, 4], muzzle: [s.bar, 7], mag: [s.r0 + 13, 11], stock: [s.r0 - 1, 8], under: [s.r1 + 5, 9], bipod: [s.r1 + 6, 9], sling: [s.r0 - 1, 10], tactical: [s.r1 + 5, 7] }),
  mini: (s) => ({ deep: true }),
};

// The pipe gun: a plank stock, a pipe, tape.
FAM.zip = {
  d: { kind: "shotgun", r: [20, 26], bar: 50, stock: null, c: { body: "pipe", bar: "pipe", furn: "board" } },
  paint(p, s) {
    const { bar, c } = s;
    R(p, 6, 8, 22, 10, c.furn); H(p, 6, 22, 8, "#5c4a36");
    R(p, 20, 6, bar, 7, c.bar); H(p, 20, bar, 6, "#7a7f84");
    R(p, 23, 8, 26, 9, c.bar); p.set(24, 11, C.metal); p.set(24, 10, C.metal);
    H(p, 28, 34, 8, "#8a7a5a"); H(p, 40, 44, 8, "#8a7a5a");
  },
  anchors: (s) => ({ optic: [30, 5], muzzle: [s.bar, 6], stock: [12, 9], sling: [10, 10], under: [37, 8] }),
  mini: (s) => ({ butt: 6, stockT: "plank" }),
};

// Launchers: a tube on the shoulder (the AT4, the RPG with its warhead), the revolving 40 mm (the M32), the
// under-barrel 40 mm on its own (the M203).
FAM.tube = {
  d: { kind: "launcher", r: [6, 54], gx: 26, v: "at4", stock: null, c: { body: "#5f6b4a", furn: "gun", bar: "#5f6b4a" } },
  paint(p, s) {
    const { r0, r1, c } = s;
    if (s.v === "rpg") {
      R(p, r0 + 6, 7, r1 - 12, 9, c.body); R(p, r0 + 2, 6, r0 + 6, 10, c.body); H(p, r0 + 2, r0 + 6, 6, c.hiBody); // the tube, its flared back
      R(p, r0 + 16, 6, r0 + 26, 10, C.wood); H(p, r0 + 16, r0 + 26, 10, C.woodD); // the wooden heat guard
      grip(p, s.gx, 11, 6, 3, C.gun); grip(p, s.gx + 9, 11, 5, 3, C.gun); guard(p, s.gx + 2, s.gx + 5, 10);
      R(p, r1 - 11, 7, r1 - 6, 9, "#3d4a2e"); for (let i = 0; i < 4; i++) R(p, r1 - 6 + i, 5 + i, r1 - 6 + i, 11 - i, "#3d4a2e"); // the warhead
      R(p, r0 + 28, 4, r0 + 30, 6, C.gun); // the sight
      return;
    }
    R(p, r0, 6, r1, 10, c.body); H(p, r0, r1, 6, c.hiBody); H(p, r0, r1, 10, c.loBody); // the AT4's tube
    V(p, r0, 6, 10, C.dark); V(p, r1, 6, 10, C.dark); R(p, r0 + 14, 5, r0 + 18, 11, c.loBody); // its ends, the shoulder band
    grip(p, s.gx, 11, 5, 3, C.gun); R(p, s.gx + 8, 11, s.gx + 9, 14, C.gun); // the grips
    R(p, s.gx - 4, 3, s.gx - 2, 5, C.gun); R(p, s.gx + 14, 4, s.gx + 15, 5, C.gun); // the sights
    H(p, r0 + 3, r0 + 12, 8, C.tan); // the label band
  },
  anchors: (s) => ({ optic: [s.gx - 3, 5], muzzle: s.v === "rpg" ? [s.r1 - 3, 8] : [s.r1, 7], sling: [s.r0 + 4, 11], under: [s.gx + 9, 11], tactical: [s.gx + 12, 6] }),
  mini: (s) => ({ shoulder: true, tip: s.v === "rpg" }),
};
FAM.m32 = {
  d: { kind: "launcher", r: [18, 34], bar: 48, gx: 20, stock: { t: "tele" }, c: { body: "gun", bar: "od", furn: "gun", cyl: "od" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 4, r1, 13, c.cyl); H(p, r0, r1, 4, c.hiCyl); for (let y = 6; y <= 12; y += 3) H(p, r0 + 1, r1 - 1, y, c.loCyl); // the cylinder
    R(p, r0 - 2, 5, r0 - 1, 9, c.body); R(p, r1 + 1, 4, bar, 8, c.bar); H(p, r1 + 1, bar, 4, c.hiBar); // the frame, the barrel
    H(p, r0 - 2, bar - 4, 3, C.dark); dots(p, r0 - 2, bar - 4, 3, C.hi); // the top rail
    grip(p, s.gx - 2, 10, 6, 3, c.furn); R(p, r1 + 4, 9, r1 + 5, 13, c.furn); // the grips
  },
  anchors: (s) => ({ optic: [s.r0 + 8, 3], mount: [s.r0 + 8, 3], muzzle: [s.bar, 5], stock: [s.r0 - 3, 7], tactical: [s.r1 + 8, 7], sling: [s.r0 - 3, 9] }),
  mini: (s) => ({ deep: true, cylBlock: true }),
};
FAM.m203 = {
  d: { kind: "launcher", r: [20, 30], bar: 46, gx: 22, stock: null, c: { body: "od", bar: "od", furn: "gun" } },
  paint(p, s) {
    const { r0, r1, bar, c } = s;
    R(p, r0, 8, r1, 12, c.body); H(p, r0, r1, 8, c.hiBody); // the receiver
    R(p, r1 + 1, 8, bar, 11, c.bar); H(p, r1 + 1, bar, 8, c.hiBar); dots(p, r1 + 3, bar - 2, 10, c.loBar, 3); // the tube
    H(p, r0 - 2, bar - 2, 7, C.dark); dots(p, r0 - 2, bar - 2, 7, C.hi); // the clamp rail
    guard(p, r0 + 2, r0 + 6, 12, C.gun); p.set(r0 + 1, 13, C.gun);
    R(p, r0 + 3, 5, r0 + 4, 6, C.gun); // the leaf sight
  },
  anchors: (s) => ({ optic: [s.r0 + 4, 7], muzzle: [s.bar, 8], sling: [s.r0, 12] }),
  mini: (s) => ({ deep: true }),
};

// A gun (not a bow, a blade or acid).
export const isGunKey = (k) => { const w = WEAPONS[k]; return !!w && !w.melee && !w.arrows && !w.acid; };

// ---------- specs: normalised, with their family's defaults ----------
const NORM = new Map();
// A spec by gun key: its own (GUN_ART), the one it is an alias of (ART_ALIAS: a turret's gun), else null.
export const ownKey = (k) => (GUN_ART[k] ? k : ART_ALIAS[k] && GUN_ART[ART_ALIAS[k]] ? ART_ALIAS[k] : SPEC_ALT[k] && GUN_ART[SPEC_ALT[k]] ? SPEC_ALT[k] : null);
export const ownSpec = (k) => { const o = ownKey(k); return o ? GUN_ART[o] : null; };
// The spec a gun is drawn from: its own, else a look-alike's by what it is (FALLBACK_LIKE: by words in its name and
// description, then its category and calibre). { key, spec, own } (own: false for a fallback).
export function specOf(k) {
  const o = ownKey(k);
  if (o) return { key: o, spec: GUN_ART[o], own: true };
  const like = fallbackKey(k);
  return like && GUN_ART[like] ? { key: like, spec: GUN_ART[like], own: false } : null;
}
export function fallbackKey(k) {
  const w = WEAPONS[k] || {}, g = GEAR[k] || {};
  const text = `${w.name || ""} ${g.name || ""} ${g.desc || ""}`.toLowerCase();
  for (const [re, like] of FALLBACK_LIKE.words) if (re.test(text)) return like;
  const cat = g.cat || "", cal = w.cal || "", small = !!g.small || (["9mm", "45acp", "357", "22lr", "38spl", "44mag", "57"].includes(cal) && !((w.cap || 0) > 20));
  if (w.launcher) return FALLBACK_LIKE.launcher;
  if (cat === "shotgun" || /ga$/.test(cal)) return FALLBACK_LIKE.shotgun;
  if (small) return FALLBACK_LIKE.pistol;
  if ((w.cap || 0) >= 60) return FALLBACK_LIKE.mg;
  if (cat === "automatic") return ["9mm", "45acp", "57", "22lr"].includes(cal) ? FALLBACK_LIKE.smg : FALLBACK_LIKE.rifle;
  return FALLBACK_LIKE.longgun;
}
// A spec with its family's defaults and its colours resolved (s.c.* hex; s.c.hiX / loX: lighter and darker of X).
export function norm(key) {
  if (NORM.has(key)) return NORM.get(key);
  let spec = GUN_ART[key];
  if (!spec) return null;
  const chain = [];
  for (let s = spec, n = 0; s && n < 8; s = s.like ? GUN_ART[s.like] : null, n++) chain.unshift(s);
  const merged = {};
  for (const s of chain) { const c = { ...(merged.c || {}), ...(s.c || {}) }; Object.assign(merged, s); merged.c = c; }
  delete merged.like;
  const fam = FAM[merged.body];
  if (!fam) throw new Error(`gun art ${key}: no body family ${merged.body}`);
  const s = { ...fam.d, ...merged, c: { ...fam.d.c, ...merged.c } };
  if (s.r) { s.r0 = s.r[0]; s.r1 = s.r[1]; }
  if (s.gx == null) s.gx = s.r0 + 3;
  if (s.hg == null) s.hg = s.r1 + 12;
  const names = s.c;
  s.cn = { ...names };
  const out = {};
  for (const [k2, v] of Object.entries(names)) { out[k2] = col(v); const cap = k2[0].toUpperCase() + k2.slice(1); out[`hi${cap}`] = hiOf(v) || out[k2]; out[`lo${cap}`] = loOf(v) || out[k2]; }
  if (!out.low) { out.low = out.body; out.hiLow = out.hiBody; out.loLow = out.loBody; }
  s.c = out;
  s.key = key;
  s.fam = fam;
  NORM.set(key, s);
  return s;
}
export const clearNorm = () => NORM.clear();

// ---------- the small drawings (held in battle, dropped by a body) ----------
// form "held": in the right hand of a 22 × 26 sprite whose body's right edge is R; "dropped": on a body's 26 × 14
// grid, lying under the hand. Long guns are laid along one row (y) from the butt to the muzzle, the grip in the hand:
// x from the big drawing's x by FWD (ahead of the grip) and BACK (behind it); then the features above (y - 1) and
// below (y + 1, y + 2).
const FWD = 0.18, BACK = 0.26, PFWD = 0.16;
const clr = (p, x, y) => { if (x >= 0 && y >= 0 && x < p.w && y < p.h) p.px[y * p.w + x] = null; }; // (the bodies' painter has no clear)
export function paintMini(p, key, form, R0 = 14) {
  const sp = specOf(key);
  if (!sp) return false;
  const s = norm(sp.key);
  const m = { ...(s.fam.mini ? s.fam.mini(s) : {}), ...(s.mini || {}) };
  const held = form === "held";
  if (s.kind === "pistol" || s.kind === "revolver") return miniPistol(p, s, m, held ? R0 + 2 : 15, held ? 14 : 12), true;
  const hx = held ? R0 + 1 : 16, y = held ? 13 : 12;
  if (m.draw) { m.draw(p, { s, hx, y, held, H, R, V, C }); return true; }
  if (m.shoulder) { // a tube on the shoulder: over the body, the grip in the hand
    H(p, hx - 7, hx + 6, y - 2, s.c.body); H(p, hx - 7, hx + 6, y - 1, s.c.loBody); p.set(hx, y, C.gun);
    if (m.tip) { R(p, hx + 6, y - 3, hx + 7, y, "#3d4a2e"); p.set(hx + 8, y - 2, "#3d4a2e"); p.set(hx + 8, y - 1, "#3d4a2e"); H(p, hx - 3, hx - 1, y - 1, C.wood); }
    else { p.set(hx - 7, y - 2, C.dark); p.set(hx - 7, y - 1, C.dark); p.set(hx - 2, y - 3, C.gun); }
    return true;
  }
  const X = (x) => hx + Math.round((x - s.gx) * (x >= s.gx ? FWD : BACK));
  const st = miniStock(s, m);
  const x0 = X(st.butt), xr0 = X(s.r0), xr1 = X(s.r1), xh = X(s.hg), xb = X(s.bar);
  // the stock
  const fc = st.col;
  if (m.bullpup) { R(p, x0, y, xr0, y + 1, s.c.body); p.set(x0, y + 1, C.rubber); p.set(x0, y, C.rubber); }
  else if (st.t === "fixed") { H(p, x0, xr0 - 1, y, fc); R(p, x0, y + 1, Math.min(x0 + 1, xr0 - 1), y + 1, fc); }
  else if (st.t === "tele") { H(p, x0 + 1, xr0 - 1, y, C.gun); R(p, x0, y, x0 + 1, y + 1, fc); }
  else if (st.t === "wire") { H(p, x0, xr0 - 1, y, fc); p.set(x0, y + 1, fc); }
  else if (st.t === "drop") { H(p, x0, xr0 - 1, y + 1, fc); H(p, Math.round((x0 + xr0) / 2), xr0 - 1, y, fc); }
  else if (st.t === "grip") p.set(xr0 - 1, y + 1, fc);
  else if (st.t === "plank") { H(p, x0, xr0 + 1, y + 1, s.c.furn); }
  else if (m.spade) { V(p, xr0 - 1, y - 1, y + 1, C.gun); }
  // the receiver, fore-end and barrel
  H(p, xr0, xr1, y, s.c.body);
  if (m.deep) H(p, xr0, xr1, y + 1, m.low ? s.c.low : s.c.body);
  if (xh > xr1) H(p, xr1 + 1, xh, y, s.c.hg || s.c.body);
  if (xb > Math.max(xh, xr1)) H(p, Math.max(xh, xr1) + 1, xb, y, s.c.bar);
  if (m.low) { H(p, xr1 - 1, xb, y + 1, s.c.bar); clr(p, xb, y); }
  if (m.over) { H(p, xr1 + 1, xb, y - 1, s.c.bar); H(p, xr1 + 1, xb, y, C.dark === s.c.bar ? C.gun : C.dark); H(p, xr0, xr1, y - 1, s.c.body); }
  else if (m.bar2) H(p, xr1 + 1, xb, y - 1, s.c.bar);
  if (m.fore) { const f = m.fore; H(p, X(f.x0), X(f.x1), y + (f.row || 0), f.col || s.c.furn); }
  // the magazine
  const mg = miniMag(s, m);
  if (mg) {
    const mx = X(mg.x), mc = mg.col;
    switch (mg.t) {
      case "stick": V(p, mx, y + 1, y + 2, mc); break;
      case "curve": p.set(mx, y + 1, mc); p.set(mx + 1, y + 2, mc); break;
      case "long": p.set(mx, y + 1, mc); p.set(mx, y + 2, mc); p.set(mx + 1, y + 3, mc); break;
      case "box": R(p, mx, y + 1, mx + (mg.w > 4 ? 1 : 0), y + 1, mc); if (mg.n > 5) p.set(mx, y + 2, mc); break;
      case "clear": p.set(mx, y + 1, C.clear); p.set(mx, y + 2, C.clearD); break;
      case "drum": R(p, mx, y + 1, mx + 1, y + 2, mc); break;
      case "belt": R(p, mx - 1, y + 1, mx + 1, y + 2, col(mg.colName, C.od)); p.set(mx + 2, y + 1, C.brass); break;
      case "top": H(p, X(s.r0 + 6), X(s.r0 + 6 + (mg.len || 20)), y - 1, C.clear); break;
      default: break;
    }
  }
  // above and below
  for (const f of m.top || []) {
    if (!f) continue;
    if (f.t === "bar") H(p, X(f.x0), X(f.x1), y - 1, f.col || s.c.body);
    else if (f.t === "post") p.set(X(f.x0), y - 1, f.col || s.c.body);
    else if (f.t === "dot") p.set(X(f.x0), y - 1, f.col || s.c.body);
    else if (f.t === "rail") { /* a flat top: nothing above the line */ }
    else if (f.t === "scope") { H(p, X(f.x0), X(f.x1), y - 1, s.c.body); p.set(X(f.x1) + 1, y - 1, C.glass); }
  }
  for (const f of m.under || []) {
    if (f.t === "pump") H(p, X(f.x0), X(f.x1), y + 1, f.col || s.c.furn);
    else if (f.t === "loop") { p.set(X(f.x0), y + 1, C.steel); p.set(X(f.x0) + 1, y + 2, C.steel); }
    else if (f.t === "fgrip") V(p, X(f.x0), y + 1, y + 2, s.c.furn);
  }
  if (m.side) p.set(X(m.side.x0), y, m.side.col);
  if (m.hinge != null) p.set(X(m.hinge), y + 1, C.dark);
  if (m.cylBlock) R(p, xr0, y - 1, xr1, y + 1, s.c.cyl);
  // a built-in scope (the hunting rifle's) and bipod (the sniper's, the machine guns')
  const opt = s.optic;
  if (opt && /^scope|^lpvo|^acog|thermal/.test(opt)) {
    const ox = X(s.fam.anchors(s).optic[0]), big = /25|9|thermal/.test(opt);
    R(p, ox - 1, y - (big ? 2 : 1), ox + 2, y - 1, opt === "scope25" ? C.olive : C.dark); p.set(ox + 2, y - (big ? 2 : 1), C.glass);
  }
  if (s.bipod) { const bx = X(s.fam.anchors(s).bipod ? s.fam.anchors(s).bipod[0] : s.hg); p.set(bx, y + 1, C.gun); p.set(bx + 1, y + 2, C.gun); p.set(bx - 1, y + 2, C.gun); }
  // the muzzle
  const mz = s.muzzle;
  if (mz === "brake_big") V(p, xb + 1, y - 1, y + 1, C.gun);
  else if (mz === "fh_long" || mz === "fh_m14") p.set(xb + 1, y, C.gun);
  if (m.accent) for (const [dx, dy, c] of m.accent) p.set(dx < 0 ? x0 - dx - 1 : hx + dx, y + dy, col(c));
  return true;
}
// The stock of the small drawing: { t, butt (the big drawing's x of the butt), col }.
function miniStock(s, m) {
  if (m.stockT) return { t: m.stockT, butt: m.butt ?? s.r0 - 12, col: s.c.furn };
  const st = s.stock;
  const a = s.fam.anchors(s).stock || [s.r0 - 1, 8];
  if (!st) return { t: "none", butt: s.r0, col: s.c.furn };
  if (typeof st === "string") { const [t, len] = LOOK_STOCK[st] || ["fixed", 10]; return { t, butt: a[0] - len, col: s.c.furn }; }
  const S = STOCKS[st.t] || STOCKS.ar;
  return { t: S.mini, butt: a[0] - (st.len || S.len), col: col(st.c, s.c.furn) };
}
function miniMag(s, m) {
  if (m.magT === "none") return null;
  const mg = s.mag;
  if (!mg) return null;
  const a = s.fam.anchors(s).mag;
  if (!a) return null;
  if (typeof mg === "string") return { t: LOOK_MAG[mg] || "stick", x: a[0] + 1, col: C.gun };
  const M = MAGS[mg.t] || MAGS.stick;
  return { t: (mg.n || 8) >= 10 ? "long" : M.mini, x: a[0] + Math.floor((mg.w || 4) / 2), col: col(mg.col, mg.t === "clear" ? C.clear : C.gun), colName: mg.col, n: mg.n || (mg.t === "box" ? 6 : 8), w: mg.w || 4, len: mg.len };
}
// A pistol or revolver in the hand: the slide or barrel along y from the grip (hx) forward, the grip below.
function miniPistol(p, s, m, hx, y) {
  const len = Math.max(2, Math.floor(((m.len || s.x1 || s.bar) - s.gx) * PFWD));
  const body = s.kind === "revolver" ? s.c.bar : s.c.slide;
  const back = s.kind === "revolver" ? 0 : 0;
  H(p, hx - back, hx + len, y, body);
  if (m.tall) { H(p, hx, hx + len, y - 1, s.c.hiSlide); p.set(hx + len, y - 1, s.c.slide); }
  if (s.kind === "revolver") { R(p, hx, y, hx + 1, y + 1, s.c.cyl); p.set(hx + 1, y, s.c.frame); if (s.lug) p.set(hx + len, y + 1, s.c.bar); }
  else if (s.c.frame && s.c.frame !== s.c.slide) p.set(hx + 1, y + 1, s.c.frame);
  V(p, hx, y + 1, y + 2, m.grip || s.c.grip);
  if (m.hammer) p.set(hx - 1, y - 1, C.gun);
  if (m.rail) p.set(hx + len - 1, y + 1, C.dark);
  if (m.accent) for (const [dx, dy, c] of m.accent) p.set(hx + dx, y + dy, col(c));
  return true;
}
