// Item icons, the parts family: every gun attachment and magazine (GEAR, cat "gunmod"), 16 × 16, drawn here at the
// icon's own scale (the gun builder's PART_ART looks are shared by many items and too small to tell apart). Lying
// parts (sights, cans, muzzle devices, rails, lights) point their muzzle end right; magazines stand feed lips up, front
// to the right, their capacity written top right; reflex sights are seen from behind, their dot lit.
import { C, R, H, V, dots, shade, line, disc, ring, oval, box, text, stamp } from "./kit.js";

const lit = (c) => shade(c, 0.28), dim = (c) => shade(c, -0.32);
const DOT = "#ff3b30", BEAM = "#ff5a4a", LENS = "#fff3b0", LBL = "#f6f1e2", SOLAR = "#2c3b66";
const POLY = C.poly, POLYL = "#4a4f57", ALU = "#6f746c", CLONE = "#8c9298";

// ---------- shared shapes ----------
// A lying cylinder from x0 to x1, rows y0..y1, lit from the top (two bands each side when it is thick).
function cyl(p, x0, x1, y0, y1, c) {
  R(p, x0, y0, x1, y1, c);
  if (y1 - y0 >= 5) { H(p, x0, x1, y0 + 1, shade(c, 0.12)); H(p, x0, x1, y1 - 1, shade(c, -0.14)); }
  H(p, x0, x1, y0, lit(c));
  H(p, x0, x1, y1, dim(c));
}
// Round the four corners off a box.
function corners(p, x0, y0, x1, y1) { p.clear(x0, y0); p.clear(x1, y0); p.clear(x0, y1); p.clear(x1, y1); }
// A Picatinny rail seen from the side along row y (teeth) and y + 1 (the spine).
function rail(p, x0, x1, y, c = C.gun) { H(p, x0, x1, y + 1, c); dots(p, x0, x1, y, lit(c)); }
// A ring of thickness t inside the box (an oval band), its top edge lit and its bottom edge shaded.
function band(p, x0, y0, x1, y1, t, c) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
  const ins = (x, y, a, b) => ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 <= 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!ins(x, y, rx, ry) || ins(x, y, rx - t, ry - t)) continue;
    const edge = !ins(x, y, rx - 1, ry - 1);
    p.set(x, y, edge && y < cy - 1 ? lit(c) : edge && y > cy + 1 ? dim(c) : c);
  }
}
// The capacity, top right (or at tx, ty).
function cap(p, n, tx, ty = 0) { const s = String(n); text(p, tx ?? 17 - 4 * s.length, ty, s, LBL); }

// ---------- magazines ----------
// A box magazine standing up: w wide, n rows of body from (x, y), the top round showing on its lips. bend: how far the
// bottom sweeps forward (a banana curve); slant: back a pixel every slant rows (a pistol grip's rake); rib: a raised
// rib's column; see: translucent, the stacked rounds showing; bands: a lighter row every few rows (stamped steel);
// base / bh / bo / bf: the floor plate's colour, rows, overhang behind and in front; hump: the front catch at the top.
function mag(p, o) {
  const { x, y, w, n, c } = o, hc = o.hc || lit(c), lc = o.lc || dim(c), bend = o.bend || 0;
  const off = (i) => Math.round(bend * Math.pow(i / Math.max(1, n - 1), 1.6)) - (o.slant ? Math.floor(i / o.slant) : 0);
  if (!o.noRound) { H(p, x + 1, x + w - 3, y - 1, C.brass); p.set(x + w - 2, y - 1, o.tip || C.copper); }
  for (let i = 0; i < n; i++) {
    const s = x + off(i), yy = y + i;
    H(p, s, s + w - 1, yy, c);
    if (o.see && i > 0 && i < n - 1) H(p, s + 1 + (i % 2), s + w - 3 + (i % 2), yy, i % 2 ? C.brass : C.goldD);
    if (o.bands && i % o.bands === 1) H(p, s + 1, s + w - 2, yy, hc);
    if (o.rib != null && i > 0 && i < n - 1) { p.set(s + o.rib, yy, hc); p.set(s + o.rib + 1, yy, lc); }
    p.set(s, yy, hc); p.set(s + w - 1, yy, lc);
  }
  if (o.hump) { p.set(x + w, y, c); p.set(x + w, y + 1, lc); }
  const sb = x + off(n - 1), bh = o.bh ?? 1, base = o.base || lc;
  for (let j = 0; j < bh; j++) H(p, sb - (o.bo ?? 0), sb + w - 1 + (o.bf ?? 0), y + n + j, j === bh - 1 && bh > 1 ? dim(base) : base);
  if (o.cap != null) cap(p, o.cap, o.tx, o.ty ?? Math.max(0, y - 1));
}
// A pistol magazine: polymer, raked like the grip, a wider floor plate.
const pmag = (o) => (p) => mag(p, { x: 2, w: 5, slant: 6, bo: 1, bf: 1, base: POLYL, c: POLY, hc: POLYL, ...o });
// A rifle magazine.
const rmag = (o) => (p) => mag(p, { x: 1, w: 6, bo: 0, bf: 1, ...o });

// A drum: a disc of radius r at (cx, cy), lit top left, a winding key in the middle.
function drumDisc(p, cx, cy, r, c, key = C.metal) {
  disc(p, cx, cy, r, c);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = x * x + y * y;
    if (d <= r * r + r && d > (r - 1) * (r - 1) + (r - 1)) p.set(cx + x, cy + y, x + y < -1 ? lit(c) : x + y > 1 ? dim(c) : c);
  }
  ring(p, cx, cy, r - 2, shade(c, -0.18));
  R(p, cx - 1, cy - 1, cx, cy, key); p.set(cx - 1, cy - 1, lit(key)); p.set(cx + 1, cy, dim(key)); p.set(cx, cy + 1, dim(key));
}
// A belt of rounds rising from (x, y) up and right: brass cases, copper tips, dark links.
function belt(p, x, y, n, tip = C.copper) {
  for (let i = 0; i < n; i++) { const bx = x + i * 2, by = y - i; p.set(bx, by, C.brass); p.set(bx + 1, by, C.brass); p.set(bx, by - 1, tip); p.set(bx + 1, by + 1, C.dark); }
}

const MAGS = {
  // the polymer 9mm pistols': 8 to 33
  mag_glock_8: pmag({ y: 5, n: 7, cap: 8 }),
  mag_glock_15: pmag({ y: 3, n: 10, cap: 15 }),
  mag_glock_17: pmag({ y: 2, n: 11, cap: 17, base: "#5b5f66" }),
  mag_glock_17c: pmag({ y: 2, n: 11, cap: 17, c: "#4c5058", hc: "#676c75", base: C.tanD, bo: 0 }),
  extmag: pmag({ y: 1, n: 11, cap: 24, base: C.orange, bh: 3 }),
  mag_glock_33: pmag({ y: 1, n: 14, cap: 33, slant: 7 }),
  // other pistols: the 1911's slim steel, the .45 double stacks, the 5.7's long one, the hand cannon's
  mag_1911_7: (p) => mag(p, { x: 3, y: 5, w: 4, n: 8, c: C.nickel, hc: "#e4e8ea", lc: C.nickelD, slant: 6, base: POLY, bo: 1, bf: 1, cap: 7 }),
  mag_poly45_12: pmag({ x: 1, y: 3, w: 6, n: 9, cap: 12 }),
  mag_vector_13: pmag({ x: 1, y: 3, w: 6, n: 9, cap: 13, c: "#30343a", base: "#6a7480", bh: 2, slant: 0 }),
  mag_vector_25: pmag({ x: 1, y: 1, w: 6, n: 10, cap: 25, slant: 0, base: "#6a7480", bh: 4 }),
  mag_fn57_20: pmag({ x: 2, y: 1, w: 5, n: 13, cap: 20, c: "#3a3e44", hc: "#555a62", base: POLY, slant: 5 }),
  mag_deagle_9: (p) => mag(p, { x: 3, y: 3, w: 4, n: 10, c: C.steel, slant: 7, base: POLY, bo: 1, bf: 2, cap: 9 }),
  // .22: the rotary ten and the curved twenty-five
  mag_22_10: (p) => {
    box(p, 1, 5, 8, 12, POLY, POLYL, C.dark); H(p, 3, 5, 4, C.brass); p.set(6, 4, C.copper);
    disc(p, 4, 8, 2, C.clear); dots(p, 3, 5, 8, C.brass); p.set(4, 7, C.brass); p.set(4, 9, C.brass); p.set(4, 8, C.dark);
    H(p, 1, 9, 13, C.dark); cap(p, 10);
  },
  mag_22_25: (p) => mag(p, { x: 2, y: 1, w: 4, n: 13, c: POLY, hc: POLYL, bend: 4, base: POLYL, bf: 1, cap: 25 }),
  // the 9mm SMG's curved steel
  mag_mp5_30: (p) => mag(p, { x: 1, y: 1, w: 5, n: 13, c: C.gun, hc: C.hi, bend: 6, base: C.dark, bands: 4, cap: 30 }),
  // STANAG: aluminium, ribbed; the clone shinier; the 40 a long black polymer one
  mag_stanag_20: rmag({ y: 3, n: 9, c: ALU, rib: 2, base: C.dark, cap: 20 }),
  mag_stanag_30: rmag({ y: 1, n: 12, c: ALU, rib: 2, bend: 2, base: C.dark, cap: 30 }),
  mag_stanag_30c: rmag({ y: 1, n: 12, c: CLONE, rib: 2, bend: 2, base: "#b8b0a0", cap: 30 }),
  mag_stanag_40: rmag({ y: 1, n: 14, c: POLY, hc: POLYL, rib: 2, bend: 2, base: POLYL, cap: 40 }),
  // the AR drums: the 60 (a round-shouldered box drum with a window) and the 100 (two drums)
  drum: (p) => {
    mag(p, { x: 3, y: 1, w: 5, n: 4, c: POLY, hc: POLYL, base: POLY });
    box(p, 0, 5, 11, 15, POLY, POLYL, C.dark); corners(p, 0, 5, 11, 15); p.clear(1, 5); p.clear(0, 6); p.clear(10, 5); p.clear(11, 6);
    disc(p, 6, 10, 3, C.clear); ring(p, 6, 10, 2, C.brass); p.set(6, 10, C.metal); p.set(5, 9, C.silver); H(p, 4, 7, 7, "#d3dedc"); cap(p, 60);
  },
  mag_stanag_100: (p) => {
    mag(p, { x: 6, y: 1, w: 4, n: 6, c: POLY, hc: POLYL, base: POLY });
    for (const cx of [4, 11]) { drumDisc(p, cx, 10, 4, POLY, C.clear); disc(p, cx, 10, 1, C.clear); p.set(cx, 10, C.brass); p.set(cx - 1, 10, C.brass); }
    R(p, 6, 7, 9, 9, POLY); H(p, 6, 9, 7, POLYL);
  },
  // the AK's: bakelite banana, the RPK's long steel, the drums
  mag_ak_30: rmag({ y: 1, n: 12, c: C.plum, hc: "#8a5545", rib: 2, bend: 5, base: "#4e2d27", tip: C.copper, cap: 30 }),
  mag_ak_45: rmag({ y: 1, n: 14, c: "#4a5058", rib: 2, bend: 6, base: C.dark, cap: 45 }),
  mag_ak_75: (p) => { mag(p, { x: 1, y: 1, w: 5, n: 4, c: "#4a5260", bend: 1, base: "#4a5260" }); drumDisc(p, 7, 10, 5, "#4a5260", C.metal); cap(p, 75); },
  mag_ak_75c: (p) => { mag(p, { x: 1, y: 1, w: 5, n: 4, c: POLY, hc: POLYL, bend: 1, base: POLY }); drumDisc(p, 7, 10, 5, "#33363c", C.gold); cap(p, 75); },
  // the AR-10's polymer and the bolt guns' steel boxes
  mag_ar10_10: rmag({ x: 1, y: 4, w: 7, n: 7, c: POLY, hc: POLYL, base: POLYL, bands: 3, cap: 10 }),
  mag_ar10_20: rmag({ x: 1, y: 2, w: 7, n: 11, c: POLY, hc: POLYL, base: POLYL, bend: 1, bands: 3, cap: 20 }),
  mag_bolt_5: rmag({ x: 0, y: 6, w: 8, n: 5, c: C.metal, base: C.gun, bh: 2, cap: 5 }),
  mag_bolt_10: rmag({ x: 0, y: 4, w: 8, n: 8, c: C.metal, base: C.gun, bh: 2, rib: 3, cap: 10 }),
  mag_50_10: (p) => { mag(p, { x: 0, y: 3, w: 8, n: 10, c: "#3c4534", hc: "#58644c", base: C.dark, bh: 2, bo: 0, bf: 0, tip: C.copper, rib: 3 }); H(p, 2, 5, 2, C.brass); cap(p, 10); },
  // the battle rifles': SCAR-H grey steel, FAL steel with a front lip, M14 with its hump, the G3's ribbed aluminium
  mag_battle_10: rmag({ x: 1, y: 4, w: 7, n: 7, c: "#5d636b", base: POLY, bo: 1, cap: 10 }),
  mag_battle_20: rmag({ x: 1, y: 2, w: 7, n: 11, c: "#5d636b", base: POLY, bo: 1, bend: 1, cap: 20 }),
  mag_fal_20: rmag({ x: 1, y: 2, w: 6, n: 11, c: "#4f5446", base: "#3a3e33", hump: true, bands: 5, cap: 20 }),
  mag_fal_30: rmag({ x: 1, y: 1, w: 6, n: 14, c: "#4f5446", base: "#3a3e33", hump: true, bands: 5, bend: 2, cap: 30 }),
  mag_m14_10: rmag({ x: 1, y: 4, w: 7, n: 7, c: C.odD, hc: C.od, base: C.dark, hump: true, rib: 3, cap: 10 }),
  mag_m14_20: rmag({ x: 1, y: 2, w: 7, n: 11, c: C.odD, hc: C.od, base: C.dark, hump: true, rib: 3, bend: 1, cap: 20 }),
  mag_g3_20: rmag({ x: 1, y: 2, w: 6, n: 11, c: C.steel, base: C.gun, bands: 2, bend: 2, cap: 20 }),
  mag_famas_25: rmag({ x: 1, y: 2, w: 6, n: 11, c: "#6b6255", base: C.gun, rib: 1, bands: 4, cap: 25 }),
  // the bullpup's translucent ones, the ranch rifle's blued steel, the .45 SMG's smoke-grey polymer
  mag_aug_30: rmag({ y: 1, n: 12, c: C.clear, hc: "#cfdcda", lc: C.clearD, see: true, bend: 2, base: POLY, cap: 30 }),
  mag_aug_42: rmag({ y: 1, n: 14, c: C.clear, hc: "#cfdcda", lc: C.clearD, see: true, bend: 2, base: POLY, cap: 42 }),
  mag_mini14_20: rmag({ x: 2, y: 3, w: 5, n: 10, c: C.blued, hc: C.bluedL, base: C.gun, bo: 1, cap: 20 }),
  mag_mini14_30: rmag({ x: 2, y: 1, w: 5, n: 13, c: C.blued, hc: C.bluedL, base: C.gun, bo: 1, bend: 2, cap: 30 }),
  mag_ump_25: rmag({ x: 1, y: 2, w: 6, n: 12, c: "#5a5f66", hc: "#7a8088", see: true, base: POLY, cap: 25 }),
  // belts and the top magazine
  mag_m249_100: (p) => {
    box(p, 0, 6, 11, 15, C.od, C.odL, C.odD); H(p, 0, 11, 7, C.odD); R(p, 4, 6, 7, 6, C.dark);
    text(p, 1, 9, "100", LBL); belt(p, 8, 5, 4);
  },
  mag_m240_100: (p) => {
    box(p, 0, 5, 11, 15, C.khaki, shade(C.khaki, 0.2), C.khakiD); R(p, 0, 5, 11, 7, C.khakiD); H(p, 0, 11, 5, C.khaki); R(p, 5, 7, 6, 8, C.dark);
    R(p, 0, 9, 11, 15, C.khakiD); H(p, 0, 11, 15, shade(C.khakiD, -0.3)); text(p, 1, 10, "100", LBL); belt(p, 8, 4, 4, C.gold);
  },
  mag_p90_50: (p) => {
    cyl(p, 0, 15, 6, 11, C.clear); R(p, 0, 5, 2, 12, POLY); V(p, 0, 5, 12, POLYL);
    for (let xx = 3; xx <= 14; xx++) { p.set(xx, 8 + (xx % 2), C.brass); p.set(xx, 10 - (xx % 2) * 0, xx % 2 ? C.goldD : C.brass); }
    H(p, 3, 15, 6, "#d3dedc"); cap(p, 50);
  },
};

// ---------- clips ----------
const CLIPS = {
  speedloader: (p) => {
    drumDisc(p, 8, 8, 7, POLY, C.metal);
    for (const [x, y] of [[12, 8], [4, 8], [10, 4], [6, 4], [10, 12], [6, 12]]) { disc(p, x, y, 1, C.brass); p.set(x - 1, y - 1, C.goldL); p.set(x, y, C.silverD); }
    R(p, 7, 7, 8, 8, C.metal); p.set(7, 7, C.silver);
  },
  speedloader44: (p) => {
    drumDisc(p, 8, 8, 7, C.silverD, POLY);
    for (const [x, y] of [[8, 3], [8, 13], [12, 6], [12, 10], [4, 6], [4, 10]]) { disc(p, x, y, 1, C.goldD); p.set(x - 1, y - 1, C.brass); p.set(x, y, C.copper); }
    R(p, 7, 7, 8, 8, POLY);
  },
  stripper308: (p) => {
    for (let i = 0; i < 5; i++) {
      const x = 1 + i * 3;
      R(p, x, 6, x + 1, 13, C.brass); V(p, x, 6, 13, C.goldL); V(p, x + 1, 9, 13, C.goldD);
      R(p, x, 3, x + 1, 5, C.copper); p.set(x, 2, C.copper); p.set(x + 1, 3, C.copperD); p.clear(x + 1, 2);
    }
    R(p, 0, 13, 15, 14, C.steel); H(p, 0, 15, 13, C.metal); H(p, 0, 15, 15, C.grey);
  },
};

// ---------- suppressors ----------
// A can lying muzzle right: rows y0..y1 from x0 to x1, a thread stub at the left; bands: dark rings at these columns;
// endc: the end caps' colour; knurl: a knurled collar's columns.
function can(p, x0, x1, y0, y1, c, o = {}) {
  const my = Math.floor((y0 + y1) / 2);
  if (o.stub !== false) R(p, x0 - 1, my - 1, x0 - 1, my + 1, C.steel);
  cyl(p, x0, x1, y0, y1, c);
  const ec = o.endc || dim(c);
  if (o.endc) { R(p, x1 - 1, y0, x1, y1, ec); H(p, x1 - 1, x1, y0, lit(ec)); R(p, x0, y0, x0 + 1, y1, ec); H(p, x0, x0 + 1, y0, lit(ec)); }
  else V(p, x1, y0 + 1, y1 - 1, ec);
  for (const bx of o.bands || []) { V(p, bx, y0, y1, o.bandc || dim(c)); p.set(bx, y0, shade(c, 0.05)); }
  if (o.knurl) for (let x = o.knurl[0]; x <= o.knurl[1]; x++) for (let y = y0 + 1; y < y1; y++) if ((x + y) % 2) p.set(x, y, dim(c));
  corners(p, x0, y0, x1, y1);
}
const CANS = {
  // makeshift: an oil filter, a bottle, solvent traps
  suppressor: (p) => {
    R(p, 0, 7, 2, 9, C.steel); H(p, 0, 2, 7, C.metal);
    cyl(p, 3, 13, 2, 14, C.orange); R(p, 6, 5, 10, 11, "#1f3f7a"); H(p, 6, 10, 5, "#2f5a9e"); R(p, 7, 7, 9, 9, C.white);
    V(p, 13, 3, 13, C.orangeD); for (let y = 3; y <= 13; y += 2) p.set(14, y, C.steel); corners(p, 3, 2, 13, 14);
  },
  bottlecan: (p) => {
    R(p, 0, 7, 1, 9, C.gun);
    R(p, 2, 6, 5, 10, "#8a8d90"); H(p, 2, 5, 6, "#b0b3b6"); H(p, 2, 5, 10, "#606366"); p.set(3, 8, "#606366");
    R(p, 6, 5, 7, 11, "#9fd0e8"); cyl(p, 8, 15, 3, 13, "#7fc0e0"); R(p, 10, 6, 13, 10, C.red); H(p, 10, 13, 6, C.redL);
    V(p, 9, 4, 12, "#cfeaf5"); corners(p, 8, 3, 15, 13);
  },
  solventcan: (p) => can(p, 1, 15, 4, 11, C.silver, { endc: C.blue, bands: [5, 8, 11], bandc: C.silverD }),
  cheapcan: (p) => can(p, 1, 14, 5, 11, POLY, { endc: C.red, bands: [5, 8, 11], bandc: "#4a4e55" }),
  cheapcan308: (p) => can(p, 1, 15, 3, 12, "#3a3e44", { endc: C.red, bands: [4, 6, 8, 10, 12], bandc: C.red }),
  // pistol and rimfire cans
  can22: (p) => can(p, 2, 13, 5, 10, C.silver, { endc: POLY }),
  can22pro: (p) => { can(p, 2, 14, 5, 10, "#7d8088", { bands: [6, 10] }); H(p, 3, 13, 7, "#9aa0a8"); },
  pistolcan: (p) => { can(p, 2, 13, 4, 11, POLY, { bands: [11] }); H(p, 3, 10, 5, POLYL); },
  can9: (p) => can(p, 1, 14, 4, 11, "#4a4e55", { knurl: [1, 3], bands: [4] }),
  can9pro: (p) => { can(p, 1, 15, 3, 12, POLY, { bands: [4, 13] }); H(p, 5, 12, 5, "#4a4e55"); H(p, 5, 12, 10, C.dark); p.set(8, 7, C.hi); p.set(9, 8, C.hi); },
  // rifle cans
  riflecan: (p) => can(p, 1, 15, 4, 11, C.od, { knurl: [1, 3], bandc: C.odD, bands: [4] }),
  can556: (p) => can(p, 1, 15, 4, 11, C.fde, { endc: POLY }),
  can556pro: (p) => can(p, 1, 15, 4, 11, POLY, { knurl: [1, 4], bands: [5], bandc: C.fde }),
  can308: (p) => { can(p, 1, 15, 3, 12, POLY, { endc: "#4a4e55", knurl: [2, 4] }); H(p, 5, 13, 4, POLYL); },
  can308pro: (p) => { can(p, 1, 15, 3, 12, "#5d636b", { endc: POLY }); for (let x = 4; x <= 12; x += 2) V(p, x, 4, 11, "#3e434a"); },
  // shotgun cans: the box-shaped real one and the thin-walled tube
  can12: (p) => { R(p, 0, 6, 0, 9, C.steel); box(p, 1, 2, 15, 13, "#6a6f78", "#8c929b", "#474b52"); R(p, 3, 4, 13, 11, "#5d636b"); H(p, 3, 13, 4, "#7a8089"); dots(p, 4, 12, 13, "#8c929b"); },
  cheapcan12: (p) => can(p, 1, 15, 2, 13, "#2f3238", { bands: [5, 10], bandc: C.rust, endc: "#4a4e55" }),
};

// ---------- muzzle devices ----------
const MUZZLE = {
  // flash hiders and brakes: a stub of barrel at the left, the device's ports dark
  flashhider: (p) => {
    R(p, 0, 7, 2, 8, C.steel); cyl(p, 3, 14, 4, 11, C.gun);
    for (const y of [6, 9]) H(p, 8, 14, y, C.dark);
    H(p, 8, 14, 7, C.hi); p.clear(14, 6); p.clear(14, 9); corners(p, 3, 4, 14, 11);
  },
  flashpro: (p) => {
    R(p, 0, 7, 1, 8, C.steel); cyl(p, 2, 15, 3, 12, POLY);
    for (const x of [5, 8]) R(p, x, 5, x + 1, 10, C.dark);
    for (const y of [4, 7, 10]) H(p, 12, 15, y, C.dark); V(p, 11, 4, 11, C.hi); corners(p, 2, 3, 15, 12);
  },
  brake: (p) => { R(p, 0, 7, 2, 8, C.steel); cyl(p, 3, 14, 4, 11, C.gun); for (const x of [6, 9, 12]) R(p, x, 5, x, 10, C.dark); corners(p, 3, 4, 14, 11); },
  brakepro: (p) => {
    R(p, 0, 7, 1, 8, C.steel); cyl(p, 2, 15, 3, 12, "#3a3e44");
    for (const x of [4, 8, 12]) { R(p, x, 5, x + 1, 10, C.dark); p.set(x + 2, 5, C.dark); p.set(x + 2, 10, C.dark); }
    V(p, 15, 4, 11, C.dark); corners(p, 2, 3, 15, 12);
  },
  cheapbrake: (p) => { R(p, 0, 7, 2, 8, C.steel); cyl(p, 3, 14, 4, 11, C.silver); for (const x of [5, 8, 11]) R(p, x, 4, x + 1, 8, "#555a60"); corners(p, 3, 4, 14, 11); },
  comp: (p) => {
    R(p, 0, 7, 1, 9, C.steel); box(p, 2, 4, 14, 12, C.gun, C.hi, C.dark);
    for (const x of [6, 9, 12]) R(p, x, 4, x, 7, C.dark); p.set(14, 8, C.dark); R(p, 3, 10, 4, 10, C.metal);
  },
  cheapcomp: (p) => {
    R(p, 0, 7, 2, 9, C.steel); box(p, 3, 5, 13, 11, C.silver, C.white, C.silverD);
    for (const x of [7, 10]) R(p, x, 5, x + 1, 7, "#555a60"); p.set(5, 9, C.dark); p.set(5, 7, C.dark);
  },
  // shotgun chokes: the full (three notches), the open IC (one, gold), the long ported turkey tube
  choke: (p) => { cyl(p, 3, 15, 5, 10, C.steel); box(p, 0, 3, 3, 12, C.metal, C.silver, C.steel); for (let y = 4; y <= 11; y += 2) p.set(1, y, C.steel); for (const y of [5, 7, 9]) p.set(3, y, C.dark); },
  icchoke: (p) => { cyl(p, 4, 13, 5, 10, C.gold); box(p, 1, 3, 4, 12, C.goldD, C.gold, "#7a5e1e"); for (let y = 4; y <= 11; y += 2) p.set(2, y, "#7a5e1e"); p.set(4, 7, C.dark); },
  turkeychoke: (p) => {
    cyl(p, 3, 15, 4, 11, C.gun); box(p, 0, 2, 3, 13, C.steel, C.metal, C.grey);
    for (const [x, y, c] of [[5, 5, C.leaf], [6, 9, C.brown], [9, 6, C.leafD], [12, 8, C.brownL], [7, 7, C.leaf]]) R(p, x, y, x + 1, y + 1, c);
    for (let x = 10; x <= 14; x += 2) { p.set(x, 5, C.dark); p.set(x, 10, C.dark); }
  },
  // the pump's longer tube, its barrel clamp ring up top
  tubeext: (p) => {
    cyl(p, 0, 15, 3, 5, C.steel); V(p, 15, 4, 4, C.dark);
    cyl(p, 0, 14, 9, 12, C.gun); V(p, 15, 9, 12, C.dark); for (let x = 1; x <= 6; x += 2) p.set(x, 13, C.dark);
    box(p, 9, 2, 12, 13, POLY, POLYL, C.dark); R(p, 10, 6, 11, 7, C.metal); p.set(10, 6, C.silver);
  },
};

// ---------- telescopic sights ----------
// A scope lying objective right: a 3-row tube from x0 to x1 at ty; the eyepiece bell (el wide, a row each side) at the
// left, the objective bell (ol wide, r rows each side) at the right; a turret at tx; on rings (rings: their columns) on
// a rail (railc) or a one-piece mount (mount: [x0, x1]).
function scope(p, o) {
  const { x0, x1, ty, c } = o, r = o.r ?? 1, ol = o.ol ?? 3, el = o.el ?? 3, tx = o.tx ?? Math.round((x0 + x1) / 2) - 1;
  const rc = o.ringc || C.gun, hc = o.hc || lit(c);
  if (o.rings) {
    for (const rx of o.rings) { R(p, rx, ty - 1, rx + 1, ty + 4, rc); p.set(rx, ty - 1, lit(rc)); }
    rail(p, o.rings[0] - 1, o.rings[o.rings.length - 1] + 2, ty + 4, o.railc || C.gun);
  }
  if (o.mount) { R(p, o.mount[0], ty + 3, o.mount[1], ty + 4, rc); rail(p, o.mount[0] + 2, o.mount[1], ty + 5, rc); H(p, o.mount[0], o.mount[1], ty + 3, lit(rc)); }
  // turret and the windage knob
  R(p, tx, ty - 2 - (o.tall || 0), tx + 1 + (o.tw || 0), ty - 1, o.turretc || c); H(p, tx, tx + 1 + (o.tw || 0), ty - 2 - (o.tall || 0), lit(o.turretc || c));
  cyl(p, x0, x1, ty, ty + 2, c); H(p, x0, x1, ty, hc);
  cyl(p, x0, x0 + el - 1, ty - 1, ty + 3, c); H(p, x0, x0 + el - 1, ty - 1, hc);
  cyl(p, x1 - ol + 1, x1, ty - r, ty + 2 + r, c); H(p, x1 - ol + 1, x1, ty - r, hc);
  if (r >= 2) { V(p, x1 - ol, ty - r + 1, ty + r + 1, c); p.set(x1 - ol, ty - r + 1, hc); }
  V(p, x1, ty - r + 1, ty + 1 + r, C.glass); p.set(x1, ty - r + 1, "#cfe6f7");
  V(p, x0, ty, ty + 2, C.glass);
  p.set(tx, ty + 1, dim(c)); p.set(tx + 1, ty + 1, dim(c));
  if (o.power) for (let y = ty - 1; y <= ty + 3; y++) if (y % 2) p.set(o.power, y, lit(c)); else p.set(o.power, y, c);
  if (o.trim) V(p, x1 - ol + 1, ty - r, ty + 2 + r, o.trim);
}
const SCOPES = {
  scope4x: (p) => scope(p, { x0: 1, x1: 14, ty: 6, c: POLY, rings: [4, 10], r: 1 }),
  huntscope: (p) => scope(p, { x0: 0, x1: 15, ty: 6, c: "#1c1d21", hc: "#4a4f58", r: 2, ol: 4, el: 4, rings: [5, 9], trim: C.gold, power: 4 }),
  huntrifscope: (p) => scope(p, { x0: 0, x1: 15, ty: 6, c: "#3a3e44", r: 2, ol: 4, el: 4, rings: [5, 9], power: 3 }),
  cheapscope: (p) => scope(p, { x0: 0, x1: 15, ty: 6, c: "#30343a", r: 2, ol: 4, el: 4, rings: [5, 9], ringc: C.silver, railc: C.silverD, turretc: C.silver, trim: C.red }),
  tacscope: (p) => scope(p, { x0: 0, x1: 15, ty: 7, c: POLY, r: 3, ol: 5, el: 3, rings: [4, 8], tx: 6, tall: 2, tw: 1 }),
  lpvo: (p) => { scope(p, { x0: 1, x1: 14, ty: 6, c: POLY, r: 0, ol: 2, el: 4, mount: [4, 11], tx: 8 }); V(p, 5, 2, 4, C.metal); p.set(5, 2, C.silver); },
  cheaplpvo: (p) => { scope(p, { x0: 1, x1: 14, ty: 6, c: "#4a4e55", r: 0, ol: 2, el: 4, mount: [4, 11], ringc: C.silver, tx: 8, trim: C.red }); R(p, 5, 1, 6, 4, C.red); },
  // the prisms: the ACOG (tan, green fibre) and its clone (black, a painted orange stripe)
  acog: (p) => {
    R(p, 4, 12, 11, 12, C.gun); rail(p, 3, 12, 13, C.gun); p.set(5, 11, C.metal); p.set(10, 11, C.metal);
    box(p, 3, 5, 11, 11, C.fde, C.fdeL, C.fdeD); cyl(p, 11, 15, 4, 11, C.fde); V(p, 15, 5, 10, C.glass);
    cyl(p, 0, 3, 6, 10, C.fdeD); V(p, 0, 7, 9, C.glass); H(p, 4, 10, 4, C.glow); H(p, 4, 10, 3, C.fdeD); R(p, 6, 8, 7, 9, C.fdeD);
  },
  cheapacog: (p) => {
    R(p, 4, 12, 11, 12, C.steel); rail(p, 3, 12, 13, C.steel);
    box(p, 3, 5, 11, 11, POLY, POLYL, C.dark); cyl(p, 11, 15, 4, 11, POLY); V(p, 15, 5, 10, "#7fd0b0");
    cyl(p, 0, 3, 6, 10, C.gun); V(p, 0, 7, 9, "#7fd0b0"); H(p, 4, 10, 4, C.orange); R(p, 6, 8, 7, 9, C.dark);
  },
  // the thermal: an olive box, a big dark lens, a rubber eyecup; its screen glows
  thermalscope: (p) => {
    rail(p, 4, 11, 12, C.gun); box(p, 3, 3, 12, 11, C.od, C.odL, C.odD); dots(p, 5, 9, 3, C.odD);
    R(p, 12, 2, 15, 12, C.odD); V(p, 15, 3, 11, "#3a2a3e"); V(p, 14, 3, 11, C.dark); p.set(15, 4, "#8a6aa0");
    R(p, 0, 5, 2, 9, C.rubber); V(p, 0, 6, 8, C.fire); p.set(0, 7, C.fireL); R(p, 6, 6, 8, 7, C.dark);
  },
  // a pipe and a lens, wired on
  scrapscope: (p) => {
    cyl(p, 1, 14, 5, 9, C.rust); V(p, 14, 6, 8, C.glass); V(p, 1, 6, 8, C.glass);
    for (const x of [4, 10]) { V(p, x, 4, 10, C.copper); p.set(x, 11, C.copperD); p.set(x + 1, 12, C.copper); }
    R(p, 2, 11, 13, 12, C.board); H(p, 2, 13, 11, C.woodL);
  },
  // the flip-to-side magnifiers: a short fat tube on a hinged mount
  magnifier: (p) => {
    rail(p, 2, 14, 13, C.gun); R(p, 10, 9, 13, 12, C.gun); disc(p, 12, 10, 1, C.metal); p.set(11, 9, C.silver);
    cyl(p, 3, 11, 2, 8, POLY); cyl(p, 1, 3, 1, 9, POLY); V(p, 1, 2, 8, C.glass); V(p, 11, 3, 7, C.glass); R(p, 6, 2, 7, 8, C.hi);
  },
  cheapmagnifier: (p) => {
    rail(p, 2, 14, 13, C.silverD); R(p, 10, 9, 13, 12, C.silver); disc(p, 12, 10, 1, C.steel);
    cyl(p, 3, 11, 2, 8, "#6a6f78"); cyl(p, 1, 3, 1, 9, "#6a6f78"); V(p, 1, 2, 8, "#6fa0c0"); V(p, 11, 3, 7, "#6fa0c0");
  },
};

// ---------- red dots and holo sights ----------
const DOTS = {
  // tubes seen from the side: the small battery dot and the military tube with its flip caps and tall mount
  reddot: (p) => {
    rail(p, 2, 13, 13, C.gun); R(p, 4, 10, 11, 12, C.gun); H(p, 4, 11, 10, C.hi); p.set(10, 11, C.metal);
    cyl(p, 3, 12, 4, 9, POLY); R(p, 7, 2, 8, 3, POLY); H(p, 7, 8, 2, POLYL); V(p, 12, 5, 8, C.pink); V(p, 3, 5, 8, C.glass); p.set(12, 5, DOT);
  },
  aimpoint: (p) => {
    rail(p, 3, 12, 14, C.gun); R(p, 5, 9, 10, 13, C.gun); H(p, 5, 10, 9, C.hi); disc(p, 8, 11, 1, C.metal);
    cyl(p, 2, 13, 3, 8, C.od); R(p, 7, 1, 8, 2, C.od); H(p, 7, 8, 1, C.odL);
    V(p, 14, 0, 4, POLY); V(p, 15, 0, 4, POLYL); V(p, 1, 0, 4, POLY); V(p, 0, 1, 3, C.glass); V(p, 13, 4, 7, C.pink); p.set(13, 4, DOT);
  },
  // open reflex (rear view): the Holosun-style with its solar panel and the clone with a smeary dot
  holosun: (p) => {
    R(p, 3, 13, 12, 14, C.gun); dots(p, 3, 12, 15, C.hi);
    box(p, 2, 3, 13, 13, POLY, POLYL, C.dark); corners(p, 2, 3, 13, 13); p.clear(3, 3); p.clear(12, 3);
    R(p, 4, 5, 11, 10, C.glass); H(p, 4, 11, 5, "#a8d0f0"); R(p, 4, 2, 11, 3, SOLAR); H(p, 5, 10, 2, "#4a62a8");
    p.set(8, 8, DOT); R(p, 4, 11, 11, 11, POLY); p.set(12, 12, C.metal);
  },
  cheapdot: (p) => {
    R(p, 3, 13, 12, 14, C.silverD);
    box(p, 2, 4, 13, 12, "#5d636b", "#7a8089", "#3e434a"); corners(p, 2, 4, 13, 12);
    R(p, 4, 5, 11, 10, "#7fc8b0"); H(p, 4, 11, 5, "#a8e0cc"); V(p, 8, 7, 9, C.pink); p.set(9, 8, C.pink); p.set(8, 8, "#e86a7a");
  },
  // the EOTech-style box and its fogged tan clone
  holo: (p) => {
    R(p, 3, 13, 12, 14, C.gun); dots(p, 3, 12, 15, C.hi);
    box(p, 1, 2, 14, 12, POLY, POLYL, C.dark); R(p, 3, 3, 12, 9, C.glass); H(p, 3, 12, 3, "#a8d0f0");
    ring(p, 8, 6, 2, DOT); p.set(8, 6, DOT); H(p, 2, 13, 10, C.gun); p.set(5, 11, C.metal); p.set(10, 11, C.metal);
  },
  cheapholo: (p) => {
    R(p, 3, 13, 12, 14, C.fdeD);
    box(p, 1, 2, 14, 12, C.fde, C.fdeL, C.fdeD); R(p, 3, 3, 12, 9, C.whiteD); H(p, 3, 12, 3, C.white); R(p, 5, 6, 7, 8, "#d8dce0");
    p.set(8, 4, C.pink); p.set(10, 6, C.pink); p.set(8, 8, C.pink); p.set(8, 6, C.pink); p.set(5, 11, C.fdeL);
  },
  // the pistol dots (rear view, no rail): the RMR's horned hood, its clone, the Holosun-style round window
  rmr: (p) => {
    stamp(p, 1, 4, [
      "..aa......aa..",
      "..abbbbbbbba..",
      "..bggggggggb..",
      ".abgggggggga..",
      ".abgggggggggb.",
      "abggggggggggbc",
      "abbbbbbbbbbbbc",
      "abbbbbbbbbbbbc",
      "cccccccccccccc",
    ], { a: POLYL, b: POLY, c: C.dark, g: C.glass });
    H(p, 4, 11, 6, "#a8d0f0"); p.set(8, 8, DOT); p.set(4, 11, C.metal); p.set(11, 11, C.metal);
  },
  cheaprmr: (p) => {
    stamp(p, 1, 4, [
      "..aa......aa..",
      "..abbbbbbbba..",
      "..bggggggggb..",
      ".abgggggggga..",
      ".abgggggggggb.",
      "abggggggggggbc",
      "abbbbbbbbbbbbc",
      "abbbbbbbbbbbbc",
      "cccccccccccccc",
    ], { a: "#8c929b", b: "#6a6f78", c: "#474b52", g: "#d9a84a" });
    H(p, 4, 11, 6, "#efd08a"); p.set(8, 8, C.pink); p.set(7, 9, C.pink);
  },
  holopistol: (p) => {
    box(p, 1, 4, 14, 13, POLY, POLYL, C.dark); corners(p, 1, 4, 14, 13); p.clear(2, 4); p.clear(13, 4);
    disc(p, 8, 8, 3, C.glass); H(p, 6, 10, 5, "#a8d0f0"); ring(p, 8, 8, 2, DOT); p.set(8, 8, DOT);
    R(p, 13, 9, 14, 12, C.silver); R(p, 4, 3, 11, 3, SOLAR); p.set(3, 12, C.metal);
  },
  // the pistol's night sights: the rear notch and the front post, three green dots
  tritium: (p) => {
    stamp(p, 0, 4, [
      "aaaa..aaaa",
      "abbb..bbbc",
      "abgbbbbgbc",
      "abbbbbbbbc",
      "abbbbbbbbc",
      ".cccccccc.",
    ], { a: POLYL, b: POLY, c: C.dark, g: C.glow });
    p.set(2, 7, C.white); p.set(7, 7, C.white);
    stamp(p, 11, 1, [
      ".ab.",
      ".gb.",
      ".bb.",
      ".bb.",
      ".bb.",
      ".bb.",
      ".bb.",
      "abbc",
      "abbc",
      "cccc",
    ], { a: POLYL, b: POLY, c: C.dark, g: C.glow });
    p.set(13, 2, C.white); R(p, 1, 12, 14, 13, C.steel); H(p, 1, 14, 12, C.metal);
  },
};

// ---------- mounts and rails ----------
const MOUNTS = {
  // scope rings seen end on: a ring, its cap screws, its clamp on the rail
  scopemount: (p) => {
    ring(p, 8, 6, 5, C.gun); ring(p, 8, 6, 4, C.gun);
    for (let y = 1; y <= 11; y++) for (let x = 3; x <= 13; x++) if (p.get(x, y) && x + y < 11) p.set(x, y, C.hi);
    R(p, 1, 5, 3, 6, C.gun); R(p, 13, 5, 15, 6, C.gun); p.set(1, 5, C.metal); p.set(15, 5, C.metal); H(p, 1, 3, 7, C.dark); H(p, 13, 15, 7, C.dark);
    R(p, 5, 11, 11, 13, C.gun); H(p, 5, 11, 11, C.hi); dots(p, 3, 13, 14, C.hi); H(p, 3, 13, 15, C.dark); R(p, 12, 12, 13, 13, C.metal);
  },
  cheapmount: (p) => {
    ring(p, 8, 6, 5, C.silver); ring(p, 8, 6, 4, C.silverD);
    R(p, 3, 11, 13, 13, C.silver); H(p, 3, 13, 11, C.white); H(p, 3, 13, 13, C.silverD); R(p, 1, 14, 15, 14, C.silverD); p.set(13, 6, C.gold); p.set(3, 5, C.gold); p.set(4, 12, C.gold);
  },
  // the Kalashnikov's side mount (rear view) and the HK claw (side view)
  sidemount: (p) => {
    box(p, 1, 3, 5, 14, C.gun, C.hi, C.dark); box(p, 1, 2, 14, 5, C.gun, C.hi, C.dark); dots(p, 2, 14, 1, C.hi);
    R(p, 6, 8, 8, 9, C.metal); disc(p, 3, 11, 1, C.metal); p.set(2, 10, C.silver);
  },
  clawmount: (p) => {
    rail(p, 0, 15, 3, "#5d636b"); R(p, 0, 5, 15, 6, "#5d636b"); H(p, 0, 15, 6, "#3e434a");
    for (const x of [2, 11]) stamp(p, x, 7, ["aaa", "aaa", "ab.", "ab.", "abbb", ".ccc"], { a: "#5d636b", b: "#3e434a", c: C.dark });
    R(p, 6, 7, 8, 8, C.silver); p.set(7, 9, C.silverD);
  },
  // handguards (side view, muzzle right)
  quadrail: (p) => {
    R(p, 0, 3, 15, 12, POLY); rail(p, 0, 15, 2, C.gun); rail(p, 0, 15, 11, C.gun);
    for (let x = 0; x <= 15; x++) V(p, x, 6, 8, x % 2 ? C.dark : C.hi); H(p, 0, 15, 5, POLYL); H(p, 0, 15, 9, C.dark);
    V(p, 0, 2, 13, C.metal);
  },
  cheaprail: (p) => {
    R(p, 0, 3, 15, 12, "#8a8f96"); rail(p, 0, 15, 2, "#9aa0a6"); rail(p, 0, 15, 11, "#9aa0a6");
    for (let x = 0; x <= 15; x++) V(p, x, 6, 8, x % 3 ? "#6a6f76" : "#b6bbc0"); H(p, 0, 15, 5, "#b6bbc0");
    for (const x of [2, 13]) { p.set(x, 4, C.gold); p.set(x, 10, C.gold); }
  },
  mlok: (p) => {
    cyl(p, 0, 15, 5, 11, POLY); rail(p, 0, 15, 3, C.gun);
    for (const x of [1, 6, 11]) { H(p, x, x + 2, 7, C.dark); H(p, x + 2, x + 4, 9, C.dark); }
  },
  mlokpro: (p) => {
    const c = "#6b5a45";
    cyl(p, 0, 15, 5, 12, c); rail(p, 0, 15, 3, "#5a4b3a"); for (const x of [1, 5, 9, 13]) { H(p, x, x + 2, 8, "#3a3027"); H(p, x, x + 2, 10, "#3a3027"); }
    R(p, 15, 5, 15, 12, C.metal); V(p, 0, 4, 12, C.dark);
  },
};

// ---------- grips ----------
// A rail clamp: the rail's teeth on top, the clamp body under them.
function clamp(p, x0, x1, y, c = C.gun) { dots(p, x0, x1, y, lit(c)); R(p, x0, y + 1, x1, y + 2, c); H(p, x0, x1, y + 2, dim(c)); }
const GRIPS = {
  foregrip: (p) => { clamp(p, 3, 12, 0); box(p, 5, 3, 10, 14, POLY, POLYL, C.dark); for (const y of [6, 9]) H(p, 6, 9, y, C.dark); H(p, 5, 10, 15, C.gun); },
  vgrippro: (p) => { clamp(p, 2, 13, 3); box(p, 4, 6, 11, 12, C.fde, C.fdeL, C.fdeD); corners(p, 4, 6, 11, 12); H(p, 5, 10, 9, C.fdeD); },
  cheapgrip: (p) => {
    clamp(p, 4, 11, 0, C.silverD); R(p, 6, 3, 9, 15, "#4a4e55"); V(p, 6, 3, 15, "#6a6f78"); V(p, 9, 3, 15, "#30343a");
    for (let y = 5; y <= 13; y += 2) H(p, 7, 8, y, "#5d636b"); V(p, 8, 3, 15, "#7a8088");
  },
  anglegrip: (p) => {
    clamp(p, 1, 14, 2);
    stamp(p, 1, 5, ["abbbbbbbbbbbbc", ".abbbbbbbbbbc.", "..abbbbbbbbc..", "...abbbbbbc...", "....abbbbc....", ".....cccc....."], { a: POLYL, b: POLY, c: C.dark });
  },
  handstop: (p) => {
    R(p, 0, 2, 15, 5, C.gun); H(p, 0, 15, 2, C.hi); for (const x of [2, 7, 12]) H(p, x, x + 2, 4, C.dark);
    clamp(p, 6, 13, 6, C.fdeD); stamp(p, 9, 9, ["aaaa", ".abb", "..ab", "..ab", "...c"], { a: C.fdeL, b: C.fde, c: C.fdeD });
  },
  // rifle pistol grips: the textured tan MOE and the slick clone with its finger nub
  pgrip: (p) => {
    stamp(p, 3, 1, [
      "aaaaaaaaa", ".abbbbbbc", "..abbbbbc", "..abbbbbc", "..abbbbbbc", ".abbbbbbc", ".abbbbbbc",
      ".abbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbc", "abbbbbc", "abbbbbc", ".ccccc",
    ], { a: C.fdeL, b: C.fde, c: C.fdeD });
    for (let y = 4; y <= 12; y += 2) for (let x = 5; x <= 8; x += 2) p.set(x - Math.floor(y / 6) + (y % 4 ? 1 : 0), y, C.fdeD);
  },
  cheappgrip: (p) => {
    stamp(p, 3, 1, [
      "aaaaaaaaa", ".abbbbbbc", "..abbbbbc", "..abbbbbc", "..abbbbbbc", ".abbbbbbbc", ".abbbbbbc",
      ".abbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbc", "abbbbbc", "abbbbbc", ".ccccc",
    ], { a: "#4a4e55", b: "#2b2e33", c: "#1a1c20" });
    V(p, 5, 3, 12, "#5d636b"); p.set(4, 9, "#5d636b");
  },
  // revolver grips: finger grooves down the front (right)
  revgrip: (p) => {
    stamp(p, 3, 0, [
      ".aaaaa..", "abbbbbc.", "abbbbbc.", "abbbbbbc", "abbbbbc.", "abbbbbbc", "abbbbbbc", "abbbbbc.",
      "abbbbbbc", "abbbbbbbc", "abbbbbbc", "abbbbbbbc", "abbbbbbbc", "abbbbbbbc", ".abbbbbc", "..cccc..",
    ], { a: C.blackL, b: C.rubber, c: "#0f0f11" });
    for (let y = 3; y <= 13; y += 3) H(p, 5, 7, y, C.blackL);
  },
  cheaprevgrip: (p) => {
    stamp(p, 3, 0, [
      ".aaaaa..", "abbbbbc.", "abbbbbc.", "abbbbbc.", "abbbbbbc", "abbbbbbc", "abbbbbc.", "abbbbbc.",
      "abbbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbbc", ".abbbbbc", "..cccc..",
    ], { a: "#6a4a3a", b: "#4a3226", c: "#2e1f18" });
    V(p, 5, 2, 13, "#7a5a48");
  },
  // laser grips: wood panels, the laser on top, its beam
  lasergrip: (p) => {
    stamp(p, 1, 4, [
      "aaaaa..", "abbbbc.", "abbbbc.", "abbbbbc", "abbbbbc", "abbbbbc", "abbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbbc", ".cccccc.",
    ], { a: C.walnutL, b: C.walnut, c: "#3a2516" });
    for (let y = 6; y <= 12; y += 2) p.set(3 + (y % 4 ? 1 : 0), y, C.woodL);
    box(p, 4, 1, 8, 4, POLY, POLYL, C.dark); p.set(8, 2, DOT); H(p, 9, 15, 2, BEAM); p.set(7, 7, C.red);
  },
};

// ---------- stocks (the butt left, where they meet the gun right) ----------
const STOCKS = {
  collapsible: (p) => {
    cyl(p, 8, 15, 5, 7, C.gun); for (let x = 9; x <= 14; x += 2) p.set(x, 8, C.dark);
    stamp(p, 0, 3, [
      "aaaaaaaaaaa", "abbbbbbbbbc", "abbbbbbbbbc", "abbbbbbbbc", "abbbbbbbc", "abbbbbbc", "abbbbbc", "abbbbc", "abbbc", "abbc", "cccc",
    ], { a: POLYL, b: POLY, c: C.dark });
    V(p, 0, 3, 13, C.rubber); R(p, 8, 9, 9, 10, C.hi);
  },
  ctrstock: (p) => {
    cyl(p, 9, 15, 5, 7, C.gun);
    stamp(p, 0, 2, [
      "aaaaaaaaaaa.", "abbbbbbbbbbc", "abbbbbbbbbbc", "abbbbbbbbbbc", "abbbbbbbbbc", "abbbbbbbbc", "abbbbbbbc", "abbbbbbc", "abbbbbc", "abbbbc", "abbbc", "cccc",
    ], { a: C.fdeL, b: C.fde, c: C.fdeD });
    V(p, 0, 2, 13, C.rubber); R(p, 7, 9, 11, 10, C.fdeD); H(p, 7, 11, 9, C.fde); for (const y of [5, 8]) H(p, 2, 6, y, C.fdeD);
  },
  cheapstock: (p) => {
    cyl(p, 9, 15, 5, 7, "#4a4e55");
    stamp(p, 0, 4, ["aaaaaaaaa", "abbbbbbbc", "abbbbbbbc", "abbbbbbc", "abbbbbc", "abbbbc", "abbbc", "abbc", "ccc"], { a: "#7a8089", b: "#5d636b", c: "#3e434a" });
    V(p, 0, 4, 12, "#30343a"); p.set(8, 8, C.silver);
  },
  fixedstock: (p) => {
    stamp(p, 0, 3, [
      "aaaaaaaaaaaaaaaa", "abbbbbbbbbbbbbbc", "abbbbbbbbbbbbbbc", "abbbbbbbbbbbbbc", "abbbbbbbbbbbbc", "abbbbbbbbbbbc",
      "abbbbbbbbbbc", "abbbbbbbbbc", "abbbbbbbbc", "abbbbbbbc", "cccccccc",
    ], { a: POLYL, b: POLY, c: C.dark });
    V(p, 0, 3, 13, C.metal); V(p, 1, 3, 13, C.steel); R(p, 3, 6, 6, 8, POLYL); p.set(15, 5, C.metal);
  },
  precision: (p) => {
    cyl(p, 12, 15, 6, 8, C.gun);
    stamp(p, 0, 1, [
      "...hhhhhhhhh....", "...gggggggggd...", "rr..m.....m.....", "rraaaaaaaaaaaaaa", "rrabbbbbbbbbbbbc", "rrabbbbbbbbbbbbc",
      "rrabb.....bbbbc.", "rrabb......bbc..", "rrabbbbbbbbbc...", "rrabbbbbbbbc....", "rr.ccccccccc....", "rr..............", "rr..............",
    ], { h: C.hi, g: C.gun, d: C.dark, m: C.metal, a: POLYL, b: POLY, c: C.dark, r: C.rubber });
    V(p, 0, 3, 13, C.blackL); p.set(2, 12, C.metal);
    cyl(p, 14, 15, 5, 7, C.gun);
  },
  foldstock: (p) => {
    R(p, 0, 3, 11, 4, C.steel); H(p, 0, 11, 3, C.metal); line(p, 1, 12, 11, 6, C.steel); line(p, 1, 13, 11, 7, C.grey);
    R(p, 0, 3, 1, 13, C.grey); V(p, 0, 3, 13, C.steel); box(p, 11, 2, 15, 9, C.gun, C.hi, C.dark); disc(p, 13, 5, 1, C.metal);
  },
  pistolbrace: (p) => {
    cyl(p, 10, 15, 4, 6, C.gun);
    stamp(p, 0, 2, [
      "aaaaaaaaaaa", "abbbbbbbbbc", "abbbbbbbbbc", "abbbbbbbbc", "abbc...abbc", "abbc...abbc", "abbc...abbc", "abbc...abbc", "abbc...abbc", ".cc.....cc",
    ], { a: POLYL, b: POLY, c: C.dark });
    R(p, 0, 11, 9, 12, C.whiteD); H(p, 0, 9, 11, C.white); p.set(4, 12, C.silverD); p.set(5, 12, C.silverD);
  },
  recoilpad: (p) => {
    box(p, 3, 0, 12, 15, "#5a3328", "#7a4a3a", "#3a1f18"); corners(p, 3, 0, 12, 15); p.clear(4, 0); p.clear(3, 1);
    for (let y = 3; y <= 12; y += 2) H(p, 5, 10, y, "#3a1f18"); V(p, 3, 2, 13, C.paper);
    p.set(7, 2, C.metal); p.set(7, 13, C.metal);
  },
};

// ---------- lights and lasers (lens / emitter right) ----------
const LIGHTS = {
  weaponlight: (p) => {
    clamp(p, 3, 9, 2); cyl(p, 1, 10, 6, 10, POLY); cyl(p, 10, 13, 4, 12, POLY); V(p, 14, 5, 11, LENS); p.set(14, 5, C.white);
    R(p, 0, 7, 0, 9, C.rubber); p.set(6, 4, C.metal);
  },
  surefire: (p) => {
    R(p, 3, 2, 8, 3, C.fde); H(p, 3, 8, 2, C.fdeL); R(p, 5, 4, 6, 6, C.fde);
    cyl(p, 0, 11, 7, 10, POLY); cyl(p, 11, 13, 6, 11, POLY); V(p, 14, 7, 10, LENS);
    p.set(15, 5, C.fireL); p.set(15, 8, C.white); p.set(15, 9, C.white); p.set(15, 12, C.fireL); dots(p, 2, 8, 8, C.dark);
  },
  pistollight: (p) => {
    clamp(p, 3, 9, 2); box(p, 1, 5, 11, 10, POLY, POLYL, C.dark); box(p, 11, 4, 13, 11, C.gun, C.hi, C.dark); V(p, 14, 5, 10, LENS);
    R(p, 0, 9, 1, 10, C.hi); p.set(14, 5, C.white);
  },
  lightlaser: (p) => {
    clamp(p, 3, 9, 1); box(p, 1, 4, 11, 11, POLY, POLYL, C.dark); box(p, 11, 3, 13, 9, C.gun, C.hi, C.dark); V(p, 14, 4, 8, LENS);
    R(p, 11, 10, 12, 11, C.dark); p.set(13, 11, DOT); H(p, 14, 15, 11, BEAM); p.set(14, 4, C.white);
  },
  cheaplight: (p) => {
    cyl(p, 0, 11, 6, 9, C.silver); cyl(p, 11, 14, 4, 11, C.silver); for (let y = 4; y <= 11; y += 2) p.set(15, y, C.silverD);
    V(p, 14, 5, 10, "#d8cf98"); ring(p, 6, 7, 3, POLY); p.set(6, 3, C.metal); V(p, 6, 6, 9, POLY);
  },
  laser: (p) => { clamp(p, 2, 9, 3); box(p, 2, 6, 10, 11, POLY, POLYL, C.dark); R(p, 10, 8, 10, 9, DOT); H(p, 11, 15, 8, BEAM); H(p, 11, 15, 9, "#c8402f"); R(p, 4, 8, 5, 9, C.hi); },
  cheaplaser: (p) => { cyl(p, 1, 10, 6, 9, "#b5463a"); V(p, 10, 7, 8, DOT); H(p, 11, 15, 7, BEAM); ring(p, 5, 7, 3, C.gun); p.set(5, 3, C.metal); V(p, 5, 6, 9, C.gun); V(p, 1, 6, 9, C.dark); },
  // aiming lasers in a box: the tan military one (two windows) and the black replica (a red beam)
  peq: (p) => {
    box(p, 0, 3, 13, 11, C.fde, C.fdeL, C.fdeD); R(p, 13, 4, 14, 6, C.dark); R(p, 13, 8, 14, 10, C.dark); p.set(14, 5, "#5a3a6a"); p.set(14, 9, "#5a3a6a");
    R(p, 3, 1, 5, 2, C.fdeD); R(p, 8, 1, 9, 2, POLY); R(p, 2, 12, 11, 13, C.gun); dots(p, 2, 11, 14, C.hi); dots(p, 2, 10, 7, C.fdeD);
  },
  cheappeq: (p) => {
    box(p, 0, 3, 12, 11, POLY, POLYL, C.dark); R(p, 12, 4, 13, 6, C.gun); R(p, 12, 8, 13, 10, C.gun); p.set(13, 5, LENS); p.set(13, 9, DOT);
    H(p, 14, 15, 9, BEAM); R(p, 3, 1, 5, 2, C.red); R(p, 2, 12, 10, 13, C.steel);
  },
};

// ---------- bipods, slings, shell carriers, charging handles ----------
const MISC = {
  bipod: (p) => {
    clamp(p, 4, 11, 0); box(p, 5, 3, 10, 5, C.gun, C.hi, C.dark);
    for (const [a, b] of [[6, 2], [9, 13]]) { line(p, a, 6, b, 14, POLY); line(p, a + (a < b ? 1 : -1), 6, b + (a < b ? 1 : -1), 14, POLYL); }
    H(p, 1, 3, 15, C.rubber); H(p, 12, 14, 15, C.rubber);
  },
  harris: (p) => {
    clamp(p, 3, 12, 0); box(p, 3, 3, 12, 5, C.gun, C.hi, C.dark);
    for (const x of [4, 10]) { R(p, x, 6, x + 1, 10, POLY); R(p, x, 11, x + 1, 14, C.silverD); V(p, x, 11, 14, C.silver); H(p, x - 1, x + 2, 15, C.rubber); }
    for (let y = 6; y <= 10; y += 2) H(p, 7, 8, y, C.silver);
  },
  cheapbipod: (p) => {
    R(p, 5, 1, 10, 3, C.silverD); H(p, 5, 10, 1, C.silver); line(p, 6, 4, 0, 14, C.silver); line(p, 9, 4, 15, 14, C.silver);
    line(p, 6, 5, 1, 14, C.silverD); line(p, 9, 5, 14, 14, C.silverD); H(p, 0, 1, 15, C.orange); H(p, 14, 15, 15, C.orange);
  },
  sling: (p) => { band(p, 1, 2, 14, 13, 2, C.od); R(p, 11, 2, 13, 4, C.steel); p.set(12, 3, C.dark); R(p, 1, 7, 3, 9, C.metal); p.set(2, 8, C.dark); },
  cheapsling: (p) => { band(p, 0, 1, 15, 14, 1, POLY); R(p, 11, 1, 13, 3, C.whiteD); R(p, 1, 6, 2, 9, C.white); H(p, 2, 4, 14, "#3a3e44"); },
  slingpro: (p) => {
    band(p, 1, 1, 14, 14, 2, C.fde);
    R(p, 3, 11, 12, 13, C.fde); H(p, 3, 12, 11, C.fdeL); H(p, 3, 12, 13, C.fdeD); dots(p, 4, 11, 12, C.fdeD);
    disc(p, 2, 6, 1, C.metal); disc(p, 13, 6, 1, C.metal); p.set(2, 6, C.dark); p.set(13, 6, C.dark); R(p, 7, 0, 8, 2, C.orange);
  },
  // shells: the side saddle (six upright on a plate), the elastic strip, the leather and elastic stock cuffs
  sidesaddle: (p) => {
    box(p, 0, 3, 15, 12, C.gun, C.hi, C.dark); p.set(1, 4, C.metal); p.set(14, 4, C.metal);
    for (let i = 0; i < 6; i++) { const x = 1 + i * 2 + (i > 2 ? 1 : 0); R(p, x, 1, x + 1, 10, C.shell); V(p, x, 1, 10, C.redL); R(p, x, 11, x + 1, 13, C.brass); p.set(x + 1, 13, C.goldD); }
    H(p, 0, 15, 6, C.gun); H(p, 0, 15, 7, C.dark);
  },
  cheapsaddle: (p) => {
    for (let i = 0; i < 5; i++) { const x = 1 + i * 3; R(p, x, 2, x + 1, 10, C.green); V(p, x, 2, 10, C.greenL); R(p, x, 11, x + 1, 13, C.brass); }
    R(p, 0, 5, 15, 8, C.black); H(p, 0, 15, 5, C.blackL); dots(p, 0, 15, 7, "#4a4e55");
  },
  buttcuff: (p) => {
    box(p, 3, 0, 12, 15, C.brown, C.brownL, C.brownD);
    for (let i = 0; i < 5; i++) { const y = 1 + i * 3; R(p, 0, y, 2, y + 1, C.brass); R(p, 13, y, 15, y + 1, C.shell); H(p, 13, 15, y, C.redL); }
    for (let y = 1; y <= 14; y += 2) { p.set(4, y, C.brownL); p.set(11, y, C.brownD); }
  },
  cheapcuff: (p) => {
    box(p, 3, 2, 12, 13, POLY, POLYL, C.dark);
    for (let i = 0; i < 3; i++) { const y = 3 + i * 4; R(p, 0, y, 2, y + 1, C.brass); R(p, 13, y, 15, y + 1, C.orange); H(p, 13, 15, y, C.yellow); }
    dots(p, 4, 11, 7, C.hi); dots(p, 4, 11, 11, C.hi);
  },
  riflecuff: (p) => {
    for (let i = 0; i < 5; i++) { const x = 1 + i * 3; R(p, x, 4, x + 1, 13, C.brass); V(p, x, 4, 13, C.goldL); R(p, x, 2, x + 1, 3, C.copper); p.set(x, 1, C.copper); }
    box(p, 0, 7, 15, 11, C.brownL, C.card, C.brown); dots(p, 0, 15, 8, C.brown); dots(p, 1, 15, 10, C.brown);
  },
  // the AR's charging handle seen from above: the latch T at the left, the shaft right
  chandle: (p) => {
    R(p, 6, 6, 15, 9, POLY); H(p, 6, 15, 6, POLYL); H(p, 6, 15, 9, C.dark); R(p, 12, 7, 13, 8, C.dark);
    stamp(p, 0, 1, ["aaa.....", "abbba...", "abbbbbc.", ".abbbbc.", ".abbbbc.", ".abbbbbc", ".abbbbbc", ".abbbbbc", ".abbbbbc", ".abbbbc.", ".abbbbc.", "abbbbbc.", "abbbc...", "ccc....."], { a: POLYL, b: POLY, c: C.dark });
    R(p, 2, 6, 3, 9, C.hi);
  },
  cheapchandle: (p) => {
    R(p, 5, 6, 15, 9, "#5d636b"); H(p, 5, 15, 6, "#7a8089"); H(p, 5, 15, 9, "#3e434a");
    stamp(p, 1, 3, ["aa....", "abbbc.", ".abbc.", ".abbbc", ".abbbc", ".abbbc", ".abbbc", ".abbc.", "abbbc.", "cc...."], { a: "#7a8089", b: "#5d636b", c: "#3e434a" });
    p.clear(1, 12); R(p, 3, 7, 3, 8, C.silver);
  },
};

export const GEAR_ART = { ...MAGS, ...CLIPS, ...CANS, ...MUZZLE, ...SCOPES, ...DOTS, ...MOUNTS, ...GRIPS, ...STOCKS, ...LIGHTS, ...MISC };
export const SUPPLY_ART = {};
