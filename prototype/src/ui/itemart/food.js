// Item icons, the food family (ui/itemart.js; the kit and the rules: ui/itemart/kit.js): every food (sim/foods.js
// FOODS: tins, dry goods, snacks, rations, fresh food, crops, forage, meat and fish, preserves and cooked meals) and the
// base supplies (sim/data.js SUPPLIES: water, fuel, meds, generic rounds, reloading stock, arrows, parts, scrap, jars,
// firewood, building materials). Each drawing is a 16 × 16 grid, light from the top left; toCanvas adds the outline.
import { C, R, H, V, dots, shade, line, disc, ring, oval, box, text, stamp } from "./kit.js";

// A few colours of this family's own.
const K = {
  glass: "#bcd6da", glassD: "#8fb0b6", glassL: "#e8f3f4", murk: "#6f6a3c", murkD: "#55512c", murkL: "#8a8650",
  steel: "#7d858c", grey: "#5d636b", greyL: "#80878f", brass: "#c8a24a", brassD: "#9a7a30", shell: "#b8322a",
  pine: "#d4ac70", pineD: "#a8844a", cinder: "#9a9a92", cinderD: "#6e6e68", od: "#4f5a44", tan: "#9c8862", tanL: "#b9a57a",
  frozen: "#a8505a", frost: "#d4e8f2", venison: "#8e2f2a", venisonL: "#a84438", pinkM: "#e48a8a", pinkL: "#f2aca4",
  rawSkin: "#ecc4a6", roast: "#a85a28", roastL: "#cf8240", smoked: "#b8742e", smokedL: "#d9a050", smokedD: "#7a4a20",
  sausage: "#8a3a24", sausageL: "#a85234", jerky: "#6e3022", jerkyL: "#8e4630", cream: "#ecdcaa", creamD: "#c9b680",
  peanut: "#a8703a", nut: "#b07a3e", potato: "#b48a52", onion: "#c8873a", onionL: "#e0a85a", turnip: "#ece6dc",
  turnipP: "#8a4a8e", blueberry: "#4a5aa8", blackberry: "#3e2a52", lettuce: "#8cc45a", lettuceL: "#b4dc7a",
  kale: "#3f6a3a", kaleL: "#5a8a4a", root: "#b8a27a", rootD: "#8f7a54", mush: "#a8743e", mushL: "#c99560",
  stew: "#9a4e24", iron: "#4a4e55", ironL: "#62676f", plate: "#eef0f2",
};
const hi = (c, f = 0.25) => shade(c, f), lo = (c, f = -0.3) => shade(c, f);

// ---------- shared painters ----------
// Light a flat shape from the top left: its pixels of colour c on a bottom / right edge in l, on a top / left edge in h.
function lit(p, c, h = hi(c), l = lo(c)) {
  const out = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (p.get(x, y) !== c) continue;
    if (!p.get(x + 1, y) || !p.get(x, y + 1)) out.push([x, y, l]);
    else if (!p.get(x - 1, y) || !p.get(x, y - 1)) out.push([x, y, h]);
  }
  for (const [x, y, k] of out) p.set(x, y, k);
}
// Recolour the drawn pixels of rows y0..y1 (a label band on a sack, a bottle or a pouch).
function band(p, y0, y1, c, x0 = 0, x1 = 15) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (p.get(x, y)) p.set(x, y, c); }
// A tin can, its paper label in lab, an emblem painted on the label.
function can(p, lab, emblem) {
  H(p, 4, 11, 1, C.silverD); H(p, 3, 12, 2, C.silver); H(p, 5, 10, 2, C.white); H(p, 3, 12, 3, C.silverD); // the lid and its rim
  R(p, 3, 4, 12, 12, lab); V(p, 4, 4, 12, hi(lab, 0.3)); R(p, 11, 4, 12, 12, lo(lab, -0.22)); V(p, 12, 4, 12, lo(lab, -0.35));
  H(p, 3, 12, 13, C.silver); dots(p, 4, 12, 13, C.silverD); H(p, 4, 11, 14, C.silverD); // the bottom rim
  emblem(p);
}
// A sack tied at the neck.
function sack(p, c) {
  H(p, 4, 11, 2, c); H(p, 5, 10, 3, c); H(p, 3, 5, 1, c); H(p, 10, 12, 1, c); p.set(7, 1, c); p.set(3, 0, c); p.set(12, 0, c); // the ruffled top
  H(p, 4, 11, 5, c); H(p, 3, 12, 6, c); R(p, 2, 7, 13, 14, c); H(p, 3, 12, 15, c); // the body
  lit(p, c); H(p, 6, 9, 4, C.rope); p.set(9, 4, C.ropeD); // the tie
}
// A glass jar with a screw lid (x0..x1, y0..y1), filled from row `from` with fill (null: empty).
function jar(p, x0, y0, x1, y1, lid, fill, from) {
  R(p, x0 + 1, y0, x1 - 1, y0 + 1, lid); H(p, x0 + 1, x1 - 1, y0, hi(lid, 0.3)); H(p, x0 + 1, x1 - 1, y0 + 1, lo(lid, -0.2));
  R(p, x0, y0 + 2, x1, y1, K.glass); p.clear(x0, y0 + 2); p.clear(x1, y0 + 2); p.clear(x0, y1); p.clear(x1, y1);
  if (fill) { R(p, x0 + 1, from, x1 - 1, y1 - 1, fill); H(p, x0 + 1, x1 - 1, from, hi(fill, 0.25)); V(p, x1 - 1, from, y1 - 1, lo(fill, -0.2)); }
  V(p, x0 + 1, y0 + 3, y1 - 2, K.glassL); V(p, x1, y0 + 3, y1 - 1, K.glassD); H(p, x0 + 1, x1 - 1, y1, K.glassD);
}
// A bar of chocolate's or a cracker's square (x, y, its size), lit.
const square = (p, x, y, n, c) => box(p, x, y, x + n - 1, y + n - 1, c, hi(c, 0.3), lo(c, -0.25));
// A cartridge standing, 4 wide from x, its top at y: a bullet (tip) or an open mouth (tip null).
function round(p, x, y, tip) {
  if (tip) { H(p, x + 1, x + 2, y, hi(tip, 0.25)); R(p, x, y + 1, x + 3, y + 2, tip); p.set(x, y + 1, hi(tip, 0.3)); V(p, x + 3, y + 1, y + 2, lo(tip, -0.25)); }
  else { H(p, x + 1, x + 2, y + 1, K.brass); p.set(x + 1, y + 1, "#5a4418"); p.set(x + 2, y + 1, K.brassD); H(p, x, x + 3, y + 2, K.brass); }
  R(p, x, y + 3, x + 3, 14, K.brass); V(p, x, y + 2, 14, C.goldL); V(p, x + 3, y + 2, 14, K.brassD); H(p, x, x + 3, 13, K.brassD); H(p, x + 1, x + 2, 14, C.gold);
}
// An arrow from its nock (x, y) up and to the right, len pixels of shaft.
function arrow(p, x, y, len, fl) {
  line(p, x, y, x + len, y - len, C.woodL);
  const tx = x + len + 2, ty = y - len - 2;
  stamp(p, tx - 3, ty, ["..ab", ".aaa", "aaa.", "ab.."].map((r, i) => (i === 3 ? "..a." : r)), { a: C.silver, b: C.white });
  for (let i = 0; i < 3; i++) { p.set(x + i - 1, y - i - 1, fl); p.set(x + i + 1, y - i + 1, lo(fl, -0.2)); }
  p.set(x - 1, y + 1, C.brownD);
}
// A plate seen from above and the front (white or gold-rimmed), x0..x1, y0..y1.
function plate(p, x0, y0, x1, y1, rim, face) {
  oval(p, x0, y0, x1, y1, rim); oval(p, x0 + 2, y0 + 1, x1 - 2, y1 - 1, face);
  H(p, x0 + 3, x1 - 3, y1, lo(rim, -0.25)); p.set(x0 + 1, y0 + 2, hi(rim, 0.4));
}

export const GEAR_ART = {};

export const SUPPLY_ART = {
  // ---------- water and the base supplies ----------
  water: (p) => { // a plastic bottle of clear water, a blue cap, a label with a drop
    R(p, 6, 0, 9, 1, C.blue); H(p, 6, 8, 0, C.blueL); V(p, 9, 0, 1, C.blueD);
    R(p, 6, 2, 9, 2, K.glass); H(p, 5, 10, 3, K.glass); R(p, 4, 4, 11, 15, C.water); H(p, 4, 11, 4, "#8cc4e8");
    p.clear(4, 15); p.clear(11, 15); V(p, 5, 5, 14, "#cfe8f6"); V(p, 11, 4, 14, C.waterD); H(p, 5, 10, 15, C.waterD);
    H(p, 4, 11, 6, "#4f98c8"); H(p, 4, 11, 13, "#4f98c8"); // the ribs
    R(p, 4, 8, 11, 11, C.white); V(p, 11, 8, 11, C.whiteD); stamp(p, 7, 8, [".a", "aa", "ab"], { a: C.blue, b: C.blueD }); p.set(7, 10, C.blueL);
  },
  rawwater: (p) => { // a galvanised bucket of murky water, its wire handle
    stamp(p, 0, 0, ["....aaaaaaaa....", "..aa........aa..", ".a............a.", "a..............a"], { a: K.steel });
    oval(p, 0, 3, 15, 7, C.silverD); oval(p, 2, 4, 13, 6, K.murk); H(p, 4, 9, 4, K.murkL); dots(p, 5, 11, 6, K.murkD, 3); p.set(9, 5, "#6b7a3a");
    for (let y = 7; y <= 15; y++) { const i = Math.floor((y - 7) / 3); H(p, 1 + i, 14 - i, y, C.silver); p.set(2 + i, y, "#dfe3e6"); p.set(14 - i, y, C.silverD); }
    H(p, 1, 14, 8, C.silverD); H(p, 3, 12, 12, C.silverD); H(p, 4, 11, 15, C.silverD); // the hoops
  },
  fuel: (p) => { // a red jerry can: three handles, the spout cap, the embossed X
    box(p, 1, 4, 14, 15, C.red, C.redL, C.redD);
    R(p, 2, 1, 8, 3, C.red); H(p, 2, 8, 1, C.redL); p.clear(4, 2); p.clear(5, 2); p.clear(7, 2); // the handles
    R(p, 11, 1, 13, 3, C.blackL); H(p, 11, 12, 1, "#565a62"); // the spout cap
    line(p, 3, 6, 12, 13, C.redD); line(p, 12, 6, 3, 13, C.redD); line(p, 3, 5, 12, 12, C.redL); line(p, 12, 5, 3, 12, C.redL);
  },
  meds: (p) => { // an orange pill bottle (white cap, a label with a red cross) and two capsules
    R(p, 0, 1, 10, 3, C.white); H(p, 0, 10, 1, C.paperL); dots(p, 1, 10, 3, C.whiteD);
    R(p, 1, 4, 9, 15, C.orange); V(p, 2, 4, 14, "#f0a050"); V(p, 9, 4, 15, C.orangeD); H(p, 1, 9, 15, C.orangeD);
    R(p, 1, 7, 9, 12, C.white); V(p, 9, 7, 12, C.whiteD); H(p, 4, 6, 9, C.red); H(p, 4, 6, 10, C.red); R(p, 5, 8, 5, 11, C.red); H(p, 3, 7, 9, C.red); H(p, 3, 7, 10, C.redD);
    R(p, 12, 8, 14, 10, C.red); p.set(12, 8, C.redL); R(p, 12, 11, 14, 13, C.white); H(p, 12, 14, 13, C.whiteD); // a capsule
    R(p, 11, 15, 14, 15, C.paperL);
  },
  ammo: (p) => { // three rounds standing, copper bullets on brass
    round(p, 0, 3, C.copper); round(p, 6, 1, C.copper); round(p, 12, 5, K.steel);
  },
  arrows: (p) => { // two arrows, steel heads and red fletching
    arrow(p, 1, 12, 9, C.red); arrow(p, 4, 15, 8, C.white);
  },
  parts: (p) => { // a steel cog
    disc(p, 7, 8, 5, C.silver);
    for (const [x, y] of [[6, 1], [6, 14], [0, 7], [13, 7], [2, 3], [11, 3], [2, 12], [11, 12]]) R(p, x, y, x + (x === 0 || x === 13 ? 1 : x === 6 ? 2 : 1), y + (x === 6 ? 0 : x === 0 || x === 13 ? 2 : 1), C.silver);
    lit(p, C.silver, C.white, C.silverD); ring(p, 7, 8, 3, C.silverD);
    for (const [x, y] of [[7, 7], [6, 8], [7, 8], [8, 8], [7, 9]]) p.clear(x, y);
  },
  scrap: (p) => { // a rusty corrugated sheet, a bent pipe, a nut
    for (let x = 0; x <= 11; x++) { const top = 7 + ((x * 7) % 3); V(p, x, top, 14 - (x % 4 === 3 ? 1 : 0), x % 2 ? "#7a4a2a" : C.copper); }
    p.set(0, 7, C.copperD); p.clear(3, 11); p.clear(4, 11);
    for (let i = 0; i < 11; i++) { p.set(4 + i, 14 - i, K.grey); p.set(5 + i, 14 - i, K.steel); p.set(4 + i, 13 - i, K.greyL); }
    stamp(p, 2, 1, [".ab.", "a..c", "a..c", ".cc."], { a: C.white, b: C.silver, c: C.silverD }); // a nut
  },
  jars: (p) => { // two empty canning jars
    jar(p, 0, 5, 6, 15, C.silver, null); jar(p, 8, 1, 14, 15, C.silver, null);
  },
  wood: (p) => { // three split logs stacked, end grain out
    for (const [x, y] of [[3, 11], [11, 11], [7, 4]]) {
      disc(p, x, y, 3, C.brown); lit(p, C.brown, C.brownL, C.brownD); disc(p, x, y, 2, K.pine);
      p.set(x - 1, y - 2, "#e8c890"); p.set(x - 2, y - 1, "#e8c890"); ring(p, x, y, 1, K.pineD); p.set(x, y, K.pineD);
    }
  },
  carparts: (p) => { // a tyre on its rim
    disc(p, 7, 8, 7, C.blackL); ring(p, 7, 8, 7, "#4d5058");
    for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; p.set(7 + Math.round(Math.cos(t) * 6.6), 8 + Math.round(Math.sin(t) * 6.6), C.black); }
    disc(p, 7, 8, 3, C.silver); lit(p, C.silver, C.white, C.silverD); p.set(7, 8, C.silverD);
    for (const [x, y] of [[7, 6], [5, 8], [9, 8], [7, 10]]) p.set(x, y, K.grey);
  },
  gunparts: (p) => { // a pistol slide, a recoil spring, a trigger
    box(p, 0, 2, 15, 6, K.grey, K.greyL, "#454a52"); p.set(1, 1, K.grey); p.set(14, 1, K.grey);
    for (const x of [2, 4, 6]) V(p, x, 3, 5, "#454a52"); R(p, 9, 3, 12, 4, "#2b2e33"); // serrations, the ejection port
    for (let x = 0; x <= 9; x += 3) { line(p, x + 1, 9, x + 2, 13, C.silverD); line(p, x, 13, x + 2, 9, C.silver); p.set(x + 2, 9, C.white); } // the spring
    stamp(p, 12, 8, ["aa..", ".ab.", "..a.", "..ab", "..a.", ".aa."], { a: K.greyL, b: K.grey });
  },
  electronics: (p) => { // a green circuit board: a chip, a capacitor, a red LED, gold traces
    box(p, 0, 3, 15, 13, C.green, C.greenL, C.greenD);
    H(p, 1, 4, 6, C.gold); V(p, 4, 6, 11, C.gold); H(p, 4, 7, 11, C.goldD); H(p, 11, 14, 11, C.gold); V(p, 11, 9, 11, C.gold);
    R(p, 5, 6, 10, 9, C.blackL); H(p, 5, 9, 6, "#565a62"); dots(p, 5, 10, 5, C.silver); dots(p, 5, 10, 10, C.silver);
    R(p, 12, 4, 13, 8, C.blue); V(p, 12, 4, 8, C.blueL); H(p, 12, 13, 4, C.silver);
    p.set(2, 9, C.red); p.set(2, 10, C.redL); p.set(14, 4, C.silver); p.set(1, 12, C.silver);
  },
  buildmat: (p) => { // two boards of lumber on a cinder block
    box(p, 0, 9, 10, 15, K.cinder, "#b4b4ac", K.cinderD); R(p, 2, 11, 4, 13, K.cinderD); R(p, 6, 11, 8, 13, K.cinderD);
    box(p, 3, 2, 15, 4, K.pine, "#e8c890", K.pineD); box(p, 1, 5, 14, 7, K.pine, "#e8c890", K.pineD);
    dots(p, 6, 13, 3, K.pineD, 3); dots(p, 4, 12, 6, K.pineD, 4); V(p, 1, 5, 7, "#c09050"); V(p, 3, 2, 4, "#c09050");
  },
  brass: (p) => { // empty cases, open-mouthed, and a red shotgun hull
    round(p, 0, 3, null); round(p, 5, 6, null);
    R(p, 10, 2, 14, 10, K.shell); V(p, 10, 2, 10, "#d4504a"); V(p, 14, 2, 10, "#8a2420"); dots(p, 10, 14, 2, "#8a2420"); p.set(12, 3, "#8a2420");
    R(p, 10, 11, 14, 14, K.brass); V(p, 10, 11, 14, C.goldL); V(p, 14, 11, 14, K.brassD); H(p, 10, 14, 14, K.brassD);
  },
  powder: (p) => { // a jug of smokeless powder: black, a red label with a flame
    R(p, 3, 0, 7, 2, C.white); H(p, 3, 7, 0, C.paperL); V(p, 7, 0, 2, C.whiteD);
    R(p, 1, 3, 14, 15, C.blackL); p.clear(1, 3); p.clear(14, 3); lit(p, C.blackL, "#565a62", "#2a2c30");
    R(p, 10, 1, 13, 2, C.blackL); p.set(10, 1, "#565a62"); // the handle
    R(p, 2, 6, 13, 12, C.red); H(p, 2, 13, 6, C.redL); H(p, 2, 13, 12, C.redD);
    stamp(p, 5, 7, ["..a..", ".aa..", ".aba.", "abbba", ".aba."], { a: C.orange, b: C.fireL });
  },
  blackpowder: (p) => { // a little keg of black powder, marked BP
    for (let y = 1; y <= 15; y++) { const b = y >= 4 && y <= 12 ? 1 : y === 1 || y === 15 ? 3 : 2; H(p, b, 15 - b - 1, y, C.wood); }
    lit(p, C.wood, C.woodL, C.woodD); for (const x of [4, 7, 10]) V(p, x, 2, 14, C.woodD);
    band(p, 3, 3, K.iron); band(p, 13, 13, K.iron); H(p, 3, 11, 3, K.ironL);
    R(p, 3, 5, 11, 11, C.paper); H(p, 3, 11, 11, C.paperD); V(p, 11, 5, 11, C.paperD); text(p, 4, 6, "BP", C.ink);
  },
  primers: (p) => { // a tray of primers, rows of little brass cups
    box(p, 0, 3, 14, 14, C.white, C.paperL, C.whiteD); H(p, 1, 14, 2, C.whiteD); p.set(15, 3, C.whiteD);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
      const x = 2 + i * 3, y = 5 + j * 3;
      p.set(x, y, C.goldL); p.set(x + 1, y, K.brass); p.set(x, y + 1, K.brass); p.set(x + 1, y + 1, K.brassD);
    }
  },
  matchprimers: (p) => { // match heads and the primer cups they fill
    for (const [x0, y0, x1, y1] of [[2, 15, 4, 4], [6, 15, 7, 2], [10, 15, 10, 4]]) {
      line(p, x0, y0, x1, y1, C.paperD); R(p, x1 - 1, y1 - 2, x1, y1 - 1, C.red); p.set(x1 - 1, y1 - 2, C.redL);
    }
    R(p, 12, 10, 14, 11, K.brass); p.set(13, 10, C.red); H(p, 12, 14, 11, K.brassD); R(p, 12, 13, 14, 14, K.brass); p.set(13, 13, C.red); H(p, 12, 14, 14, K.brassD);
  },

  // ---------- tins ----------
  f_beans: (p) => can(p, C.orange, () => { // orange label, a heap of beans
    for (const [x, y] of [[5, 6], [8, 6], [6, 8], [9, 8], [5, 10], [8, 10]]) { H(p, x, x + 1, y, C.brown); H(p, x, x + 1, y + 1, C.brownD); p.set(x, y, C.brownL); }
  }),
  f_soup: (p) => can(p, C.red, () => { // red over white, a gold medallion
    R(p, 3, 9, 12, 12, C.white); V(p, 3, 9, 12, C.paperL); R(p, 11, 9, 12, 12, C.whiteD);
    disc(p, 7, 9, 1, C.gold); p.set(6, 8, C.goldL); p.set(8, 10, C.goldD); H(p, 5, 10, 11, C.redL);
  }),
  f_cannedveg: (p) => can(p, C.green, () => { // green label, a carrot and corn
    for (let i = 0; i < 4; i++) { p.set(5 + i, 11 - i, C.orange); p.set(6 + i, 11 - i, C.orangeD); }
    p.set(9, 6, C.greenL); p.set(10, 5, C.greenL); p.set(10, 6, C.leaf);
    for (const [x, y] of [[5, 5], [6, 6], [5, 7]]) p.set(x, y, C.yellow);
  }),
  f_cannedfruit: (p) => can(p, C.yellow, () => { // yellow label, a peach half
    disc(p, 7, 8, 2, C.orange); p.set(6, 7, C.fireL); p.set(8, 9, C.redL); p.set(9, 8, C.orangeD); p.set(7, 8, C.brownL);
    p.set(9, 5, C.leaf); p.set(10, 5, C.greenL); p.set(9, 6, C.leafD);
  }),
  f_cannedmeat: (p) => { // a flat oblong tin of luncheon meat, blue and yellow, the key on top
    H(p, 2, 13, 3, C.silverD); R(p, 1, 4, 14, 5, C.silver); H(p, 2, 13, 4, C.white); H(p, 11, 14, 2, C.silverD); p.set(14, 3, C.silverD);
    box(p, 1, 6, 14, 14, C.blue, C.blueL, C.blueD); H(p, 1, 14, 6, C.yellow); H(p, 1, 14, 14, C.yellowD);
    R(p, 4, 8, 11, 12, K.pinkM); H(p, 4, 11, 8, K.pinkL); V(p, 11, 8, 12, C.flesh); H(p, 4, 11, 12, C.flesh); p.set(6, 10, K.pinkL); p.set(9, 11, C.fat);
  },

  // ---------- dry goods ----------
  f_rice: (p) => { // a white cloth sack, a red band
    sack(p, C.paperL); band(p, 9, 11, C.red); lit(p, C.red, C.redL, C.redD); dots(p, 5, 10, 10, C.white, 2);
  },
  f_pasta: (p) => { // a long blue box, spaghetti in its window
    H(p, 3, 15, 3, C.blueL); H(p, 2, 14, 4, C.blueL); box(p, 1, 5, 14, 13, C.blue, C.blueL, C.blueD); V(p, 15, 4, 12, C.blueD);
    R(p, 3, 7, 12, 10, C.yellow); H(p, 3, 12, 8, C.goldL); H(p, 3, 12, 10, C.yellowD); H(p, 3, 12, 7, C.yellowD);
    H(p, 3, 6, 12, C.white); H(p, 8, 9, 12, C.yellow);
  },
  f_oats: (p) => { // a round cardboard canister of oats, a blue lid, a cream medallion
    H(p, 5, 10, 0, C.blueL); R(p, 4, 1, 11, 2, C.blue); H(p, 4, 11, 2, C.blueD);
    R(p, 4, 3, 11, 15, C.card); V(p, 5, 3, 15, "#d2bc94"); V(p, 11, 3, 15, C.cardD); H(p, 5, 10, 15, C.cardD); p.clear(4, 15); p.clear(11, 15);
    H(p, 4, 11, 4, C.red); H(p, 4, 11, 13, C.red); oval(p, 5, 6, 10, 11, C.paperL); H(p, 6, 9, 11, C.paperD);
    for (const [x, y] of [[6, 7], [8, 8], [7, 9], [9, 9]]) p.set(x, y, C.card);
  },
  f_flour: (p) => { // a paper bag folded over at the top, a blue band, a wheat ear
    R(p, 4, 1, 11, 3, C.paperD); H(p, 4, 11, 1, C.paper); R(p, 3, 4, 12, 15, C.paper); lit(p, C.paper, C.paperL, C.paperD);
    H(p, 3, 12, 5, C.blue); H(p, 3, 12, 6, C.blueD); V(p, 7, 9, 14, C.goldD);
    for (const [x, y] of [[6, 9], [8, 10], [6, 11], [8, 12], [7, 8]]) p.set(x, y, C.gold);
  },
  f_cereal: (p) => { // a tall red cereal box, a bowl on the front
    H(p, 4, 13, 1, C.redL); R(p, 3, 2, 11, 15, C.red); V(p, 3, 2, 15, C.redL); R(p, 12, 2, 13, 14, C.redD);
    R(p, 4, 3, 10, 5, C.yellow); H(p, 4, 10, 5, C.yellowD); dots(p, 5, 9, 4, C.red);
    oval(p, 4, 9, 10, 13, C.white); H(p, 4, 10, 9, C.orange); dots(p, 4, 10, 8, C.orangeD); p.set(6, 9, C.fireL); H(p, 5, 9, 13, C.whiteD);
  },
  f_crackers: (p) => { // two square saltines, docked with holes
    square(p, 5, 1, 10, "#e6bd76"); square(p, 1, 5, 10, "#e6bd76");
    for (const [x, y] of [[3, 7], [6, 7], [9, 7], [3, 10], [6, 10], [9, 10], [3, 13], [6, 13], [9, 13], [8, 3], [11, 3], [14, 3], [14, 6]]) p.set(x, y, "#b88a44");
  },
  f_sugar: (p) => { // three sugar cubes
    for (const [x, y] of [[1, 9], [8, 9], [4, 3]]) {
      R(p, x, y, x + 5, y + 5, C.white); H(p, x, x + 5, y, "#ffffff"); V(p, x, y, y + 5, "#ffffff"); H(p, x + 1, x + 5, y + 5, C.whiteD); V(p, x + 5, y + 1, y + 5, C.whiteD);
      p.set(x + 2, y + 2, C.whiteD); p.set(x + 3, y + 3, "#ffffff");
    }
  },
  f_honey: (p) => { // a squat jar of golden honey: a wooden lid, a drip down the side, a bee on the label
    oval(p, 0, 5, 15, 15, C.gold); R(p, 3, 4, 12, 6, C.gold); lit(p, C.gold, C.goldL, C.goldD);
    R(p, 2, 2, 13, 4, C.brownL); H(p, 2, 13, 2, "#b88a58"); H(p, 2, 13, 4, C.brown); R(p, 6, 0, 9, 1, C.brownL); H(p, 6, 9, 0, "#b88a58"); // the lid, its knob
    V(p, 4, 5, 9, "#f8e080"); p.set(4, 10, C.goldL); V(p, 5, 5, 7, C.goldL); p.set(3, 7, "#f8e080");
    R(p, 6, 9, 12, 12, C.paperL); H(p, 6, 12, 12, C.paperD); stamp(p, 8, 10, ["aba", ".c."], { a: C.ink, b: C.yellow, c: C.ink });
  },
  f_peanutbutter: (p) => { // a jar of peanut butter: a red lid, a peanut on the label
    R(p, 3, 1, 12, 3, C.red); H(p, 3, 12, 1, C.redL); H(p, 3, 12, 3, C.redD);
    R(p, 3, 4, 12, 15, K.peanut); p.clear(3, 15); p.clear(12, 15); lit(p, K.peanut, "#c8904e", "#7a5028");
    R(p, 3, 7, 12, 12, C.paper); V(p, 12, 7, 12, C.paperD);
    stamp(p, 4, 8, [".aa..aa.", "abbbbbba", ".aa..aa."], { a: "#c08a4a", b: "#a8703a" }); p.set(5, 8, "#dcae6e");
  },
  f_grain: (p) => { // an open burlap sack of wheat, ears standing out of it
    R(p, 1, 7, 14, 14, C.khaki); H(p, 2, 13, 15, C.khaki); lit(p, C.khaki, "#bdb48a", C.khakiD);
    for (let y = 9; y <= 14; y += 2) dots(p, 2 + (y % 4 === 1 ? 1 : 0), 13, y, C.khakiD, 3);
    H(p, 2, 13, 6, C.goldD); H(p, 1, 14, 7, "#bdb48a"); H(p, 1, 14, 8, C.khakiD); // the rolled rim, the grain in it
    for (const [x, y] of [[2, 1], [6, 0], [10, 1]]) stamp(p, x, y, [".a.", "aba", "aba", "abb", ".c.", ".c."], { a: C.gold, b: C.goldD, c: C.goldD });
    p.set(7, 0, C.goldL); p.set(3, 1, C.goldL); p.set(11, 1, C.goldL);
  },
  f_drybeans: (p) => { // a heap of dried kidney beans
    const beans = [[6, 2], [3, 5], [8, 5], [11, 6], [1, 9], [5, 8], [9, 9], [12, 10], [3, 12], [7, 12], [11, 13]];
    beans.forEach(([x, y], i) => { const c = i % 3 ? "#8a3a2a" : "#a8503a"; R(p, x, y, x + 2, y + 1, c); p.set(x, y, hi(c, 0.35)); H(p, x + 1, x + 2, y + 1, lo(c, -0.3)); });
  },

  // ---------- snacks and rations ----------
  f_chips: (p) => { // a pillow bag of chips: yellow, a red banner, a chip
    dots(p, 2, 13, 1, C.yellow); R(p, 2, 2, 13, 13, C.yellow); R(p, 1, 4, 14, 11, C.yellow); dots(p, 2, 13, 14, C.yellow);
    lit(p, C.yellow, "#f2d870", C.yellowD); R(p, 2, 4, 13, 6, C.red); H(p, 2, 13, 4, C.redL); H(p, 2, 13, 6, C.redD);
    oval(p, 4, 8, 11, 12, C.fireL); H(p, 5, 10, 12, C.orange); V(p, 11, 9, 11, C.orange); H(p, 5, 7, 8, "#fff0a0"); line(p, 5, 11, 8, 9, C.gold); line(p, 8, 11, 10, 10, C.gold);
  },
  f_candybar: (p) => { // a chocolate bar, the red wrapper torn back
    for (let y = 5; y <= 11; y++) H(p, 0, 6, y, C.brown); for (const x of [0, 3]) for (const y of [5, 8]) { H(p, x, x + 2, y, C.brownL); }
    V(p, 2, 5, 11, C.brownD); V(p, 5, 5, 11, C.brownD); H(p, 0, 6, 7, C.brownD); H(p, 0, 6, 11, C.brownD);
    R(p, 6, 4, 14, 12, C.red); H(p, 6, 14, 4, C.redL); H(p, 6, 14, 12, C.redD); dots(p, 15, 15, 5, C.redD); V(p, 15, 5, 11, C.redD);
    for (let y = 4; y <= 12; y += 2) p.set(6, y, C.brown); oval(p, 8, 6, 13, 10, C.yellow); H(p, 9, 12, 8, C.redD);
  },
  f_energybar: (p) => { // a green-wrapped energy bar, crimped ends, oats in its window
    R(p, 1, 4, 14, 11, C.green); lit(p, C.green, C.greenL, C.greenD);
    for (let y = 4; y <= 11; y++) { p.set(0, y, y % 2 ? C.silver : C.silverD); p.set(15, y, y % 2 ? C.silverD : C.silver); }
    R(p, 4, 6, 11, 9, C.bread); H(p, 4, 11, 6, "#e0a860"); dots(p, 5, 11, 7, C.breadD, 2); dots(p, 4, 10, 8, C.brownL, 3); H(p, 3, 12, 10, C.yellow);
  },
  f_mre: (p) => { // a tan MRE pouch, its heat seal, the letters MRE
    box(p, 1, 1, 14, 15, C.khaki, "#bdb48a", C.khakiD); dots(p, 2, 13, 2, C.khakiD); p.clear(1, 4); p.clear(14, 4);
    text(p, 2, 6, "MRE", C.ink); H(p, 3, 12, 13, C.khakiD);
  },
  f_rationbar: (p) => { // a lifeboat ration block, cream segments, half out of its foil
    H(p, 3, 14, 3, K.cream); H(p, 2, 13, 4, K.cream); R(p, 1, 5, 13, 13, K.cream); V(p, 14, 4, 12, K.creamD); V(p, 15, 3, 3, K.creamD);
    V(p, 4, 5, 13, K.creamD); V(p, 1, 5, 13, "#f6ecc8"); H(p, 1, 7, 9, K.creamD); H(p, 1, 13, 13, K.creamD);
    for (let y = 3; y <= 13; y++) for (let x = 8 - (y % 2); x <= 15; x++) if (p.get(x, y)) p.set(x, y, (x + y) % 3 ? C.silver : C.silverD);
    V(p, 9, 5, 12, C.white); H(p, 10, 12, 4, C.white);
  },
  f_survivalmeal: (p) => { // a freeze-dried pouch: dark green, a zip seal, an orange label with a steaming bowl
    for (let y = 1; y <= 15; y++) { const b = y < 4 ? 4 : y < 11 ? 3 : 2; H(p, b, 15 - b, y, K.od); }
    lit(p, K.od, "#647054", "#3c4534"); H(p, 4, 11, 3, "#3c4534"); p.clear(4, 2);
    R(p, 4, 6, 11, 12, C.orange); H(p, 4, 11, 6, "#f0a050"); H(p, 4, 11, 12, C.orangeD);
    stamp(p, 5, 7, [".a.a..", "a.a...", "bbbbbb", ".bbbb."], { a: C.white, b: C.white }); H(p, 6, 9, 10, C.whiteD);
  },
  f_pemmican: (p) => { // a dark block of pemmican, flecked with fat and berries, tied with twine
    H(p, 3, 13, 3, C.brownL); H(p, 2, 13, 4, C.brownL); box(p, 1, 5, 12, 14, C.brown, C.brownL, C.brownD); V(p, 13, 4, 13, C.brownD); V(p, 14, 3, 12, "#40291a");
    for (const [x, y] of [[3, 7], [9, 6], [5, 11], [10, 12], [3, 13]]) p.set(x, y, C.fat);
    for (const [x, y] of [[5, 8], [10, 9], [2, 10], [8, 13]]) p.set(x, y, C.purple);
    V(p, 7, 3, 14, C.rope); H(p, 1, 12, 9, C.rope); p.set(8, 3, C.rope); p.set(7, 9, C.ropeD); p.set(8, 10, C.ropeD);
  },

  // ---------- fresh food ----------
  f_bread: (p) => { // a loaf, scored on top, a slice cut in front
    oval(p, 2, 2, 15, 12, C.bread); R(p, 2, 8, 15, 13, C.bread); lit(p, C.bread, "#e0a860", C.breadD);
    for (const x of [6, 9, 12]) { p.set(x, 4, "#f0c888"); p.set(x + 1, 5, "#f0c888"); }
    R(p, 0, 5, 4, 14, "#f2e2b0"); V(p, 0, 6, 14, C.breadD); H(p, 1, 3, 4, C.breadD); p.set(4, 5, C.breadD); V(p, 4, 5, 14, C.breadD); H(p, 0, 4, 14, C.breadD);
    p.set(2, 8, "#d8c490"); p.set(1, 11, "#d8c490"); p.set(3, 12, "#d8c490");
  },
  f_cheese: (p) => { // a wedge of cheese with holes, its orange rind
    for (let x = 1; x <= 14; x++) V(p, x, 7 - Math.round(((x - 1) * 5) / 13), 7, "#f2d870");
    R(p, 1, 8, 14, 14, C.cheese); H(p, 1, 14, 14, "#b8952a"); V(p, 15, 2, 14, C.orange); V(p, 1, 8, 13, "#f2d870");
    for (const [x, y] of [[4, 10], [9, 9], [12, 12], [6, 13]]) { p.set(x, y, "#b8952a"); p.set(x + 1, y, "#c9a432"); }
    p.set(8, 5, "#c9a432"); p.set(11, 4, "#c9a432");
  },
  f_frozenmeat: (p) => { // a steak frozen on a foam tray, frost on it
    for (let y = 10; y <= 14; y++) H(p, y - 10, 25 - y, y, K.frost); H(p, 0, 15, 10, C.white); H(p, 4, 11, 14, "#a8c4d4"); // the tray, frosted
    stamp(p, 2, 2, ["...ffffff...", ".ffmmmmmmff.", "fmmmmmmmmmmf", "fmmmmmmmmmmf", "fmmmmmmmmmmm", ".fmmmmmmmmm.", "..ffmmmmmf.."], { f: "#e8d4d4", m: K.frozen });
    for (const [x, y] of [[4, 4], [7, 5], [10, 4], [5, 7], [9, 7], [12, 6], [3, 3]]) p.set(x, y, K.frost);
    for (const [x, y] of [[6, 3], [11, 6], [8, 8]]) p.set(x, y, C.white);
    stamp(p, 11, 0, ["a.a.a", ".bab.", "aaaaa", ".bab.", "a.a.a"], { a: C.white, b: K.frost }); // a snowflake
  },
  f_eggs: (p) => { // half a carton of eggs
    for (const x of [2, 7, 12]) { oval(p, x - 1, 3, x + 2, 8, C.egg); p.set(x - 1 + 1, 4, "#ffffff"); }
    for (const x of [1, 6, 11]) { oval(p, x, 6, x + 4, 11, C.egg); p.set(x + 1, 7, "#ffffff"); V(p, x + 4, 8, 10, C.paperD); }
    R(p, 0, 11, 15, 15, "#b0a898"); H(p, 0, 15, 11, "#c8c0b0"); H(p, 1, 15, 15, "#8a8274"); dots(p, 1, 15, 13, "#9a9284", 5);
  },
  f_milk: (p) => { // a glass bottle of milk, a red cap
    R(p, 6, 0, 9, 1, C.red); H(p, 6, 9, 0, C.redL); R(p, 6, 2, 9, 4, C.white); H(p, 5, 10, 5, C.white); H(p, 4, 11, 6, C.white);
    R(p, 3, 7, 12, 15, C.white); p.clear(3, 15); p.clear(12, 15); lit(p, C.white, "#ffffff", C.whiteD); V(p, 4, 7, 13, "#ffffff"); V(p, 6, 2, 4, "#ffffff");
    R(p, 3, 9, 12, 12, C.blue); H(p, 3, 12, 9, C.blueL); H(p, 3, 12, 12, C.blueD); stamp(p, 6, 10, ["a..a", "aaaa"], { a: C.white });
  },

  // ---------- produce and crops ----------
  f_apples: (p) => { // a red apple in front of a green one, stems and a leaf
    disc(p, 11, 8, 4, C.greenL); lit(p, C.greenL, "#9ccc6a", C.green); p.clear(11, 4); V(p, 11, 2, 4, C.brown);
    disc(p, 5, 10, 5, C.red); lit(p, C.red, C.redL, C.redD); p.clear(5, 5); p.set(3, 8, "#f08a7a"); p.set(2, 9, C.redL);
    V(p, 5, 3, 5, C.brown); p.set(6, 3, C.leaf); p.set(7, 3, C.greenL); p.set(7, 4, C.leaf); p.set(8, 3, C.leafD);
  },
  f_potatoes: (p) => { // a heap of three potatoes, their eyes
    for (const [x0, y0, x1, y1] of [[4, 2, 12, 8], [0, 7, 8, 13], [8, 8, 15, 14]]) oval(p, x0, y0, x1, y1, K.potato);
    lit(p, K.potato, "#d0a870", "#8a6638"); oval(p, 0, 7, 8, 13, K.potato); lit(p, K.potato, "#d0a870", "#8a6638");
    for (const [x, y] of [[6, 4], [10, 6], [3, 9], [6, 11], [11, 10], [13, 12]]) p.set(x, y, "#7a5a30");
  },
  f_onions: (p) => { // a golden onion: the dry neck, its layers, its roots
    oval(p, 2, 4, 13, 14, K.onion); lit(p, K.onion, K.onionL, "#9a6020"); V(p, 7, 1, 4, K.onionL); V(p, 8, 2, 4, K.onion); p.set(7, 0, "#9a6020");
    line(p, 5, 6, 4, 11, "#a86a28"); line(p, 10, 6, 11, 11, "#a86a28"); V(p, 7, 6, 12, K.onionL);
    H(p, 6, 9, 15, C.paperD); p.set(5, 15, C.paperD); p.set(10, 15, C.paper);
  },
  f_greenbeans: (p) => { // three pods of green beans
    for (const [x, c] of [[1, C.green], [5, C.greenL], [9, C.leaf]]) {
      for (let y = 1; y <= 14; y++) { const dx = Math.round(Math.sin(y / 4.5) * 2); H(p, x + dx, x + dx + 1, y, c); p.set(x + dx, y, hi(c, 0.25)); if (y % 3 === 0) p.set(x + dx + 1, y, lo(c, -0.3)); }
      p.set(x + 1, 0, C.leafD);
    }
  },
  f_corn: (p) => { // an ear of corn in its husk
    oval(p, 5, 0, 10, 13, C.yellow); for (let y = 1; y <= 12; y += 2) dots(p, 5 + (y % 4 === 1 ? 1 : 0), 10, y, C.yellowD, 2); V(p, 6, 2, 10, C.goldL);
    stamp(p, 1, 6, ["aa..........aa", ".aa........aa.", ".baa......aab.", "..bba....abb..", "..bbaa..aabb..", "...bbaaaabb...", "....bbaabb....", ".....bbbb.....", "......bb......", "......b......."], { a: C.greenL, b: C.green });
  },
  f_squash: (p) => { // a ribbed orange squash, its stem
    oval(p, 0, 4, 15, 15, C.orange); lit(p, C.orange, "#f0a050", C.orangeD); for (const x of [4, 8, 11]) for (let y = 5; y <= 14; y++) if (p.get(x, y) === C.orange) p.set(x, y, C.orangeD);
    V(p, 3, 7, 11, "#f0a050"); R(p, 7, 1, 8, 4, C.leafD); p.set(7, 1, C.leaf); p.set(9, 1, C.leaf); p.set(10, 2, C.leaf);
  },
  f_greens: (p) => { // a round head of lettuce, its ruffled leaves
    disc(p, 7, 8, 7, K.lettuce); lit(p, K.lettuce, K.lettuceL, C.green); disc(p, 7, 9, 3, K.lettuceL);
    for (const [x, y] of [[1, 5], [4, 2], [10, 2], [13, 5], [14, 10]]) p.clear(x, y);
    line(p, 7, 12, 3, 6, C.green); line(p, 8, 12, 12, 6, C.green); V(p, 7, 7, 14, "#d4ec9a");
  },
  f_turnips: (p) => { // a turnip, purple shoulders, a taproot, its leaf stalks
    disc(p, 7, 9, 4, K.turnip); lit(p, K.turnip, "#ffffff", "#c9bfae"); for (let y = 5; y <= 7; y++) for (let x = 0; x < 16; x++) if (p.get(x, y)) p.set(x, y, y === 5 ? "#a868aa" : K.turnipP);
    V(p, 7, 14, 15, "#c9bfae"); p.set(8, 15, "#c9bfae");
    stamp(p, 2, 0, ["aa.....aa..", ".aa...aa...", "..ab.ba....", "...bbb.....", "....b......"], { a: C.leaf, b: C.leafD }); p.set(7, 0, C.greenL); V(p, 7, 1, 3, C.leafD);
  },
  f_kale: (p) => { // a bunch of curly dark kale, the stems tied
    for (const [x0, y0, x1, y1] of [[1, 1, 7, 9], [8, 0, 14, 8], [4, 2, 11, 10]]) oval(p, x0, y0, x1, y1, K.kale);
    for (const [x, y] of [[1, 3], [2, 1], [14, 2], [13, 0], [1, 7], [14, 6], [8, 0]]) p.set(x, y, K.kaleL);
    for (const [x, y] of [[0, 4], [0, 6], [15, 3], [15, 5], [5, 0], [10, 0]]) p.set(x, y, K.kale);
    lit(p, K.kale, K.kaleL, "#2a4a28"); line(p, 4, 4, 7, 13, "#a8c890"); line(p, 11, 3, 8, 13, "#a8c890"); V(p, 7, 8, 14, "#a8c890"); H(p, 6, 9, 12, C.purple);
  },
  f_roots: (p) => { // gnarled wild roots, a little green on top
    for (const [x0, x1] of [[2, 9], [7, 13]]) { line(p, x0, 2, x1, 14, K.root); line(p, x0 + 1, 2, x1 + 1, 13, K.rootD); line(p, x0 - 1, 3, x1 - 1, 13, "#d4c49a"); }
    for (const [x, y] of [[4, 8], [7, 11], [12, 8], [9, 6], [14, 11]]) p.set(x, y, K.rootD);
    for (const [x, y] of [[1, 0], [2, 1], [3, 0], [7, 0], [8, 1], [9, 0]]) p.set(x, y, C.leaf);
  },

  // ---------- forage ----------
  f_berries: (p) => { // blueberries, a blackberry and a leaf
    stamp(p, 7, 0, ["..aaa..", ".aaaab.", "aaabbb.", ".abb..."], { a: C.greenL, b: C.leaf });
    for (const [x, y] of [[4, 6], [9, 10], [3, 11]]) { disc(p, x, y, 2, K.blueberry); p.set(x - 1, y - 1, "#7a8ad0"); p.set(x + 1, y + 1, "#34407a"); p.set(x, y - 2, "#34407a"); }
    disc(p, 11, 6, 2, K.blackberry); dots(p, 10, 12, 5, "#6a4a8a", 2); dots(p, 9, 13, 7, "#6a4a8a", 2); p.set(11, 4, C.leafD);
  },
  f_nuts: (p) => { // an acorn and a walnut
    oval(p, 1, 6, 7, 14, K.nut); lit(p, K.nut, "#d09a5a", "#7a5028"); oval(p, 0, 3, 8, 7, C.brownD); dots(p, 1, 7, 4, C.brown); dots(p, 2, 7, 6, C.brown); V(p, 4, 1, 2, C.brownD);
    oval(p, 8, 6, 15, 14, C.card); lit(p, C.card, "#d2bc94", C.cardD); V(p, 11, 6, 14, C.cardD); for (const [x, y] of [[9, 9], [13, 8], [10, 12], [14, 11]]) p.set(x, y, C.cardD);
  },
  f_mushrooms: (p) => { // a big and a small brown mushroom
    oval(p, 0, 1, 11, 7, K.mush); lit(p, K.mush, K.mushL, "#7a5028"); H(p, 1, 10, 7, "#7a5028"); R(p, 4, 8, 7, 14, C.bone); V(p, 4, 8, 14, C.paperL); V(p, 7, 8, 14, C.paperD);
    oval(p, 9, 8, 15, 11, K.mush); lit(p, K.mush, K.mushL, "#7a5028"); R(p, 11, 12, 13, 15, C.bone); V(p, 13, 12, 15, C.paperD);
    p.set(3, 3, "#e0c090"); p.set(6, 2, "#e0c090"); p.set(11, 9, "#e0c090");
  },
  f_wildgreens: (p) => { // a sprig of wild greens, leaves in pairs on a curving stem
    line(p, 6, 15, 9, 1, C.leafD);
    for (const [x, y, s] of [[8, 3, 1], [8, 6, -1], [8, 9, 1], [7, 11, -1], [7, 13, 1]]) {
      const d = s > 0 ? 1 : -1;
      for (let i = 1; i <= 4; i++) { p.set(x + d * i, y - (i > 2 ? 1 : 0), C.leaf); p.set(x + d * i, y + 1 - (i > 2 ? 1 : 0), C.leafD); }
      p.set(x + d, y - 1, C.greenL);
      for (let i = 1; i <= 3; i++) { p.set(x - d * i, y + 1, C.leaf); p.set(x - d * i, y + 2, C.leafD); }
    }
    stamp(p, 8, 0, [".a", "aa"], { a: C.greenL });
  },

  // ---------- raw meat and fish ----------
  f_venison: (p) => { // a lean, dark-red steak of venison
    stamp(p, 0, 3, ["....fffffff.....", "..ffmmmmmmmff...", ".fmmmmmmmmmmmf..", "fmmmmmmmmmmmmmf.", "fmmmmmmmmmmmmmmf", "fmmmmmmmmmmmmmmf", ".fmmmmmmmmmmmmmf", "..fmmmmmmmmmmmf.", "...ffmmmmmmmff..", ".....fffffff...."], { f: C.fat, m: K.venison });
    for (const [x, y] of [[3, 6], [4, 7], [8, 5], [9, 6], [11, 8], [6, 9], [7, 10]]) p.set(x, y, K.venisonL);
    H(p, 5, 9, 4, "#f8e8dc"); p.set(2, 5, "#f8e8dc"); H(p, 6, 12, 12, "#c9a898");
  },
  f_boar: (p) => { // a fatty leg of boar on the bone
    oval(p, 0, 0, 11, 11, C.fat); oval(p, 1, 1, 10, 10, C.meat); lit(p, C.meat, C.meatL, C.redD);
    for (const [x, y] of [[3, 3], [6, 4], [4, 6], [7, 7]]) p.set(x, y, C.fat); p.set(3, 1, "#fbeee4");
    for (let i = 0; i < 4; i++) { p.set(9 + i, 9 + i, C.bone); p.set(10 + i, 9 + i, C.bone); p.set(9 + i, 10 + i, C.paperD); }
    R(p, 13, 11, 14, 12, C.bone); R(p, 11, 13, 12, 14, C.bone); R(p, 14, 13, 15, 15, C.bone); p.set(13, 11, "#ffffff"); p.set(15, 15, C.paperD);
  },
  f_smallgame: (p) => { // a rabbit, lying dead: long ears laid back, a white scut
    stamp(p, 0, 2, ["........aa......", ".......abba.....", "........abba....", ".........aab....", "....ffffffaafff.", "..ffffffffffffff", ".fffffffffffffff", "wfffffffffffff..", "wffffffffffff...", ".ffffffffff.....", "..ll.....ll.....", ".lll....lll....."],
      { a: "#8a7458", b: C.pink, f: "#9a8466", w: C.white, l: "#7a6650" });
    lit(p, "#9a8466", "#b8a282", "#6e5c46"); p.set(13, 7, C.ink); p.set(12, 7, C.ink); p.set(15, 8, C.pink); p.set(8, 9, "#b8a282"); p.set(5, 10, "#b8a282");
  },
  f_fowl: (p) => { // a plucked bird, its drumsticks up
    oval(p, 0, 5, 13, 15, K.rawSkin); lit(p, K.rawSkin, "#f8dcc4", "#c9967a");
    oval(p, 8, 3, 13, 9, K.rawSkin); oval(p, 3, 3, 8, 8, K.rawSkin); lit(p, K.rawSkin, "#f8dcc4", "#c9967a");
    line(p, 11, 3, 13, 1, C.bone); R(p, 13, 0, 14, 1, C.bone); line(p, 6, 3, 6, 1, C.bone); R(p, 5, 0, 6, 0, C.bone); p.set(7, 0, C.bone);
    oval(p, 3, 9, 9, 13, "#e2b496"); H(p, 4, 8, 9, "#f8dcc4"); H(p, 4, 8, 13, "#c9967a"); // the wing
  },
  f_fish: (p) => { // a raw trout, silver with a pink stripe
    oval(p, 0, 4, 11, 12, "#8fa7b4"); H(p, 2, 9, 4, "#5d7686"); H(p, 1, 10, 5, "#6f8a9a"); for (let y = 10; y <= 12; y++) for (let x = 0; x <= 11; x++) if (p.get(x, y)) p.set(x, y, "#d8e0e2");
    H(p, 2, 10, 8, "#d88a94"); p.set(2, 6, C.white); p.set(3, 6, C.black); p.set(0, 8, "#6f8a9a"); V(p, 4, 6, 10, "#6f8a9a");
    stamp(p, 11, 3, ["...aa", "..aab", ".aab.", "aab..", "aa...", "aab..", ".aab.", "..aab", "...aa", "....b"], { a: "#7a94a2", b: "#5d7686" });
    R(p, 5, 2, 7, 3, "#6f8a9a"); p.set(5, 2, "#8fa7b4"); p.set(6, 13, "#8fa7b4"); p.set(7, 13, "#6f8a9a");
  },
  f_groundmeat: (p) => { // a steel bowl heaped with mince
    oval(p, 2, 1, 13, 10, K.pinkM); for (let y = 2; y <= 9; y++) for (let x = 2; x <= 13; x++) if (p.get(x, y) && (x * 3 + y * 5) % 4 === 0) p.set(x, y, C.flesh); else if (p.get(x, y) && (x + y * 3) % 7 === 0) p.set(x, y, K.pinkL);
    for (let y = 8; y <= 15; y++) { const i = Math.max(0, y - 12); H(p, i, 15 - i, y, C.silver); }
    H(p, 0, 15, 8, C.white); H(p, 1, 14, 9, C.silverD); V(p, 1, 10, 12, C.white); for (let y = 10; y <= 15; y++) { const i = Math.max(0, y - 12); p.set(15 - i, y, C.silverD); } H(p, 4, 11, 15, C.silverD);
  },
  f_sausage: (p) => { // a ring of smoked sausage, its ends tied
    for (let a = 0; a <= 26; a++) { const t = Math.PI * (0.92 + (a / 26) * 1.16); disc(p, 7.5 + Math.cos(t) * 5.2, 8.5 + Math.sin(t) * 5.2, 1, K.sausage); }
    for (let a = 0; a <= 26; a++) { const t = Math.PI * (0.92 + (a / 26) * 1.16); p.set(7.5 + Math.cos(t) * 6.2, 8.5 + Math.sin(t) * 6.2, K.sausage); }
    lit(p, K.sausage, K.sausageL, "#5e2618");
    for (let a = 4; a <= 22; a++) { const t = Math.PI * (0.92 + (a / 26) * 1.16); p.set(7.5 + Math.cos(t) * 5.4, 8.5 + Math.sin(t) * 5.4, "#c86a48"); }
    R(p, 1, 13, 2, 14, C.rope); R(p, 13, 13, 14, 14, C.rope); p.set(1, 15, C.ropeD); p.set(14, 15, C.ropeD);
  },
  f_jerky: (p) => { // three ragged strips of jerky
    for (const [x0, y0, y1, c] of [[1, 2, 14, K.jerky], [6, 0, 13, "#7a3a26"], [11, 3, 15, K.jerky]]) {
      for (let y = y0; y <= y1; y++) { const x = x0 + ((y >> 2) & 1); H(p, x, x + 2, y, c); p.set(x, y, K.jerkyL); p.set(x + 2, y, "#4e2218"); }
      p.set(x0 + 1, y0, c); p.clear(x0 + 2, y0); p.clear(x0, y1);
      for (let y = y0 + 2; y < y1; y += 4) p.set(x0 + 1 + ((y >> 2) & 1), y, "#c87a5a");
    }
  },
  f_smokedfish: (p) => { // a split fish, smoked gold, hung from a string
    V(p, 7, 0, 1, C.rope);
    stamp(p, 3, 2, ["...ddd...", "..dmmmd..", ".dmmmmmd.", "dmmmmmmmd", "dmmmmmmmd", "dmmmmmmmd", "dmmmmmmmd", ".dmmmmmd.", ".dmmmmmd.", "..dmmmd..", "...dmd...", "..dd.dd..", ".dd...dd.", "dd.....dd"], { d: K.smokedD, m: K.smoked });
    V(p, 7, 4, 11, K.smokedD); for (let y = 5; y <= 10; y += 2) { H(p, 5, 6, y, K.smokedL); H(p, 8, 9, y, K.smokedL); }
    p.set(6, 3, C.ink);
  },

  // ---------- preserved and cooked ----------
  f_driedfruit: (p) => { // dried apple rings, an apricot and raisins
    for (const [x, y] of [[4, 4], [10, 9]]) { disc(p, x, y, 3, "#d8b070"); ring(p, x, y, 3, "#b88a48"); disc(p, x, y, 1, "#f0d8a0"); p.clear(x, y); p.set(x - 2, y - 2, "#f0d8a0"); }
    oval(p, 10, 1, 15, 5, C.orange); p.set(11, 2, C.fireL); H(p, 11, 14, 5, C.orangeD);
    for (const [x, y] of [[1, 10], [3, 12], [5, 10], [2, 14], [6, 13]]) { R(p, x, y, x + 1, y + 1, C.purpleD); p.set(x, y, C.purple); }
  },
  f_jarred: (p) => { // a canning jar of preserves, a gingham cloth over the lid
    jar(p, 2, 3, 13, 15, C.silver, C.redL, 6);
    R(p, 1, 0, 14, 3, C.white); for (let y = 0; y <= 3; y++) for (let x = 1; x <= 14; x++) if ((x >> 1) % 2 === 0 || y % 2 === 0) p.set(x, y, (x >> 1) % 2 === 0 && y % 2 === 0 ? C.redD : C.red);
    p.set(1, 4, C.red); p.set(14, 4, C.redD); H(p, 2, 13, 4, C.rope);
    for (const [x, y] of [[5, 8], [9, 9], [6, 11], [10, 12], [8, 13]]) { p.set(x, y, C.orange); p.set(x + 1, y, C.fireL); }
  },
  f_simplemeal: (p) => { // a wooden bowl of food and a spoon
    line(p, 9, 6, 13, 0, C.silver); R(p, 12, 0, 14, 1, C.silver); p.set(12, 0, C.white);
    oval(p, 1, 4, 14, 9, K.stew); H(p, 3, 8, 5, "#b86a3a"); for (const [x, y] of [[4, 6], [10, 7], [7, 7]]) p.set(x, y, C.greenL); p.set(6, 6, C.orange); p.set(11, 6, C.orange);
    for (let y = 7; y <= 14; y++) { const i = Math.max(0, Math.round((y - 9) / 1.6)); H(p, i, 15 - i, y, C.wood); p.set(i, y, C.woodL); p.set(15 - i, y, C.woodD); }
    H(p, 0, 15, 7, C.woodL); H(p, 4, 11, 14, C.woodD); H(p, 5, 9, 15, C.woodD);
  },
  f_stew: (p) => { // an iron pot of stew, its ears and the steam
    for (const x of [3, 7, 11]) { p.set(x, 0, K.frost); p.set(x + 1, 1, C.smoke); p.set(x, 2, C.smoke); p.set(x + 1, 3, K.frost); }
    oval(p, 1, 4, 14, 7, K.ironL); oval(p, 2, 5, 13, 6, K.stew); p.set(5, 5, C.orange); p.set(9, 6, C.greenL); p.set(11, 5, "#d4a060");
    for (let y = 7; y <= 14; y++) { const i = y >= 12 ? y - 11 : 0; H(p, 1 + i, 14 - i, y, K.iron); p.set(1 + i, y, K.ironL); p.set(14 - i, y, "#33363b"); }
    R(p, 0, 7, 0, 9, K.iron); R(p, 15, 7, 15, 9, "#33363b"); H(p, 1, 14, 7, K.ironL); H(p, 4, 11, 14, "#33363b");
  },
  f_finemeal: (p) => { // a plate: a steak, a potato, greens
    plate(p, 0, 4, 15, 15, K.plate, C.white);
    oval(p, 3, 6, 9, 11, K.roast); H(p, 4, 7, 6, K.roastL); dots(p, 4, 8, 8, "#7a3a1a", 2); dots(p, 5, 8, 10, "#7a3a1a", 2);
    oval(p, 9, 6, 12, 9, C.yellow); p.set(10, 6, C.goldL); for (const [x, y] of [[10, 11], [11, 10], [12, 11], [9, 12], [11, 12]]) p.set(x, y, C.green);
  },
  f_lavishmeal: (p) => { // a gold-rimmed platter: a roast bird, grapes, an orange slice
    plate(p, 0, 6, 15, 15, C.gold, C.white);
    oval(p, 3, 3, 12, 12, K.roast); lit(p, K.roast, K.roastL, "#7a3a1a"); line(p, 11, 4, 13, 1, C.bone); R(p, 13, 0, 14, 1, C.bone); line(p, 4, 4, 2, 1, C.bone); R(p, 1, 0, 2, 1, C.bone);
    p.set(6, 5, "#e8a860"); p.set(7, 5, "#e8a860"); p.set(5, 6, "#e8a860");
    for (const [x, y] of [[1, 11], [2, 12], [3, 13], [1, 13]]) { p.set(x, y, C.purple); } p.set(2, 11, C.purpleD);
    oval(p, 11, 11, 14, 14, C.orange); p.set(12, 12, C.fireL); p.set(13, 12, C.yellow);
  },
};
