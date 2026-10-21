// Item icons, the wear family (ui/itemart.js; the kit and the rules: ui/itemart/kit.js): melee weapons, bows and
// crossbows, body armour, helmets and visors, plates, guards, packs, rigs, gun cases, the bicycle and the carts (a
// wheelbarrow, a hand cart). Long things lie
// on the diagonal, the handle bottom left and the head top right; armour, packs and guards face the viewer; helmets are
// seen from the side, facing right. The blade and armour colours follow the battle sprites (ui/sprites.js drawWeapon,
// drawArmor; sim/data-blades.js BLADE_LOOK).
import { R, H, V, line, disc, ring, oval, stamp, shade } from "./kit.js";

// ---------- helpers ----------
// Diagonal coordinates: a = x - y runs along the diagonal (bottom left to top right), b = x + y across it (top left to
// bottom right); the main diagonal is b = 15. area fills the pixels where f(a, b, x, y) holds; band a box in a and b.
const put = (p, x, y, c) => (c ? p.set(x, y, c) : p.clear(Math.round(x), Math.round(y))); // null clears
const area = (p, f, c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (f(x - y, x + y, x, y)) put(p, x, y, c); };
const band = (p, a0, a1, b0, b1, c) => area(p, (a, b) => a >= a0 && a <= a1 && b >= b0 && b <= b1, c);
const at = (p, a, b, c) => put(p, (a + b) / 2, (b - a) / 2, c);
// Light from the top left: the pixels of each colour with an empty pixel above or left of them lighter, the ones with
// an empty pixel below or right darker.
function lit(p, ...cols) {
  const s = p.px.slice(), g = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15 ? null : s[y * 16 + x]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const c = s[y * 16 + x];
    if (!c || !cols.includes(c)) continue;
    if (!g(x - 1, y) || !g(x, y - 1)) p.set(x, y, shade(c, 0.3));
    else if (!g(x + 1, y) || !g(x, y + 1)) p.set(x, y, shade(c, -0.3));
  }
}
// Rows of runs from y0 down: each row a list of x0, x1 pairs.
const rows = (p, y0, list, c) => list.forEach((r, j) => { for (let i = 0; i < r.length; i += 2) H(p, r[i], r[i + 1], y0 + j, c); });
// The top of an ellipse (its box x0..x1, y0..2 × y1 − y0), rows y0..y1: a dome.
const dome = (p, x0, y0, x1, y1, c) => area(p, (a, b, x, y) => y >= y0 && y <= y1 && ((x - (x0 + x1) / 2) / ((x1 - x0) / 2 + 0.5)) ** 2 + ((y - y1) / (y1 - y0 + 0.5)) ** 2 <= 1, c);
// A pair (guards), each drawn by f(x0) in the 7 columns from x0.
const twin = (f) => { f(1); f(9); };

// ---------- colours ----------
const K = {
  steel: "#b4bcc3", steelD: "#8d959c", glint: "#f4f7f9", dark: "#6d7378", gun: "#55595e", blk: "#3a3e45", poly: "#2e3238",
  wood: "#7a5230", woodL: "#a07a48", woodD: "#4a3324", hick: "#b08a5a", ash: "#9a7a52", brass: "#b89a4a", red: "#c8362e",
  olive: "#4d5440", oliveL: "#5f6b4a", coyote: "#9c8862", navy: "#2f3a4f", tape: "#9aa0a6", cream: "#e4ddcc", kev: "#c9a83a",
  string: "#e8e0c8", tan: "#b89a62",
};

// ---------- knives ----------
// The handle a ∈ [-13, -5], the bolster or guard at -4..-3, the blade from -2 to the tip.
const handle = (p, a0, a1, c, b0 = 15, b1 = 16) => band(p, a0, a1, b0, b1, c);
function chef(p) { // kitchen: a wide blade, black handle, two rivets
  handle(p, -13, -5, K.blk);
  band(p, -4, -3, 15, 16, K.steelD);
  area(p, (a, b) => a >= -2 && a <= 13 && b >= 15 && b <= Math.min(19, 15 + (13 - a) * 0.4), K.steel);
  lit(p, K.blk, K.steel);
  at(p, -11, 15, K.steel); at(p, -7, 15, K.steel); at(p, 13, 15, K.glint);
}
function steak(p) { // a narrow serrated blade, rounded tip, dark wood, three rivets
  handle(p, -13, -5, K.woodD);
  area(p, (a, b) => a >= -4 && a <= 11 && b >= 15 && b <= (a >= 9 ? 16 : 17), K.steel);
  lit(p, K.woodD, K.steel);
  for (let a = -3; a <= 9; a += 4) at(p, a, 18, K.steelD); // the teeth
  for (const a of [-12, -9, -6]) at(p, a, 16, "#c9b48a");
}
function fillet(p) { // long, thin and flexible, black handle with a finger bump
  handle(p, -15, -6, K.poly);
  at(p, -5, 17, K.poly);
  area(p, (a, b) => a >= -4 && a <= 14 && b >= (a > 8 ? 14 : 15) && b <= (a > 8 ? 15 : 16), K.steel);
  lit(p, K.poly, K.steel);
  at(p, 14, 14, K.glint);
}
function cleaver(p) { // a broad rectangle of steel, a hole in its corner
  handle(p, -13, -5, K.woodD);
  band(p, -3, 9, 15, 20, K.steelD);
  lit(p, K.woodD, K.steelD);
  band(p, -2, 8, 20, 20, K.steel); // the edge's bevel
  p.px[5 * 16 + 12] = null; // the hanging hole
  for (const a of [-11, -7]) at(p, a, 15, K.steel);
}
function hunter(p) { // a drop point, a stacked leather handle, a little brass guard
  area(p, (a, b) => a >= -14 && a <= -5 && b >= 15 && b <= 16, "#8a5a34");
  area(p, (a, b) => a >= -14 && a <= -5 && b >= 15 && b <= 16 && ((a + 20) % 4) < 2, "#5b3a22");
  band(p, -4, -3, 14, 17, K.brass);
  area(p, (a, b) => a >= -2 && a <= 12 && b >= 15 + Math.max(0, (a - 8) / 2) && b <= 17 - Math.max(0, (a - 9) / 2), K.steel);
  lit(p, K.steel, K.brass);
}
function survival(p) { // a saw back, a dark blade, a hollow handle with a compass cap
  handle(p, -13, -5, K.blk);
  band(p, -15, -14, 14, 17, K.steelD);
  at(p, -15, 15, "#5fae8a"); // the compass
  band(p, -4, -3, 12, 19, K.gun);
  area(p, (a, b) => a >= -2 && a <= 12 && b >= 15 + Math.max(0, a - 9) && b <= 17, "#7d858c");
  lit(p, K.blk, K.gun, "#7d858c");
  for (let a = 0; a <= 8; a += 4) at(p, a, 14, "#7d858c"); // the saw teeth on the spine
}
function bowie(p) { // a big clip point, brass guard and pommel
  handle(p, -14, -6, "#5b3a22");
  band(p, -15, -15, 14, 17, K.brass);
  band(p, -5, -4, 12, 19, K.brass);
  area(p, (a, b) => a >= -3 && a <= 14 && b >= 14 + Math.max(0, a - 8) && b <= Math.min(18, 18 - (a - 11) / 1.5), K.steel);
  lit(p, "#5b3a22", K.brass, K.steel);
  band(p, 7, 10, 14, 14, K.glint); // the clip's false edge
}
function bayonet(p) { // a parkerized blade with a fuller, an olive grip, a muzzle ring on the guard
  handle(p, -13, -5, "#4f5a3e");
  band(p, -15, -14, 15, 16, K.poly);
  band(p, -4, -3, 13, 18, K.poly);
  area(p, (a, b) => a >= -2 && a <= 13 && b >= 15 + Math.max(0, (a - 10) / 1.5) && b <= 17 - Math.max(0, (a - 10) / 1.5), "#7d877c");
  lit(p, "#4f5a3e", K.poly, "#7d877c");
  band(p, 0, 8, 16, 16, "#5a6258"); // the fuller
  at(p, -4, 12, null); p.set(4, 8, null); p.set(3, 8, K.poly); p.set(4, 7, K.poly); // the ring
  for (const a of [-11, -8]) at(p, a, 16, "#3c4530");
}
function combat(p) { // a black blade with a bright edge, a tanto point, a ribbed black grip
  area(p, (a, b) => a >= -13 && a <= -5 && b >= 15 && b <= 16, K.poly);
  area(p, (a, b) => a >= -13 && a <= -5 && b >= 15 && b <= 16 && ((a + 20) % 3) === 0, "#4a4f57");
  band(p, -4, -3, 13, 18, K.poly);
  area(p, (a, b) => a >= -2 && a <= 12 && b >= 15 && b <= (a >= 10 ? 15 + (12 - a) : 17), "#4a4f57");
  lit(p, "#4a4f57");
  area(p, (a, b) => a >= -2 && a <= 12 && b === (a >= 10 ? 15 + (12 - a) : 17), "#c2c9cf"); // the edge
  area(p, (a, b) => a >= -2 && a <= 11 && b === 18 && a < 9, "#c2c9cf");
}
function shiv(p) { // a strip of scrap ground to a point, the handle wrapped in tape
  band(p, -12, -3, 14, 17, K.tape);
  lit(p, K.tape);
  area(p, (a, b) => a >= -11 && a <= -4 && b >= 14 && b <= 17 && ((a + 20) % 3) === 0, "#6d737a");
  area(p, (a, b) => a >= -2 && a <= 10 && b >= 15 + Math.max(0, a - 8) && b <= 17 - Math.max(0, (a - 4) / 2), "#9a9a92");
  lit(p, "#9a9a92");
  at(p, 1, 17, "#8a5a32"); at(p, 4, 16, "#8a5a32"); at(p, -1, 15, "#8a5a32"); at(p, 0, 16, "#7a4a2a"); // rust
  at(p, 9, 15, K.glint);
}

// ---------- folders and utility knives ----------
function pocket(p) { // a red handle with a white cross, a short blade
  area(p, (a, b) => a >= -12 && a <= -1 && b >= 14 && b <= 17 && !((a <= -11 || a >= -2) && (b === 14 || b === 17)), "#b8382a");
  area(p, (a, b) => a >= 0 && a <= 8 && b >= 15 && b <= (a >= 6 ? 15 : 16), K.steel);
  lit(p, "#b8382a", K.steel);
  at(p, -6, 16, "#f4f4f4"); at(p, -7, 15, "#f4f4f4"); at(p, -5, 15, "#f4f4f4"); at(p, -7, 17, "#f4f4f4"); at(p, -5, 17, "#f4f4f4");
  at(p, 1, 17, K.steelD); at(p, 2, 18, K.steelD); // the folded tool's nail nick
}
function flick(p) { // a switchblade: a slim stiletto blade, black scales between silver bolsters, a button
  handle(p, -13, -3, K.poly, 14, 16);
  band(p, -14, -13, 14, 16, K.steel); band(p, -3, -2, 14, 16, K.steel);
  area(p, (a, b) => a >= -1 && a <= 14 && b >= 15 + Math.max(0, (a - 11)) && b <= 16 - Math.max(0, (a - 12)), K.steel);
  lit(p, K.poly, K.steel);
  at(p, -8, 14, "#d0362a"); // the button
  at(p, 13, 15, K.glint);
}
function lockback(p) { // a wooden folder with brass bolsters at both ends, a lock notch on its spine
  handle(p, -13, -2, K.woodL, 14, 17);
  band(p, -14, -13, 14, 17, K.brass); band(p, -2, -1, 14, 17, K.brass);
  area(p, (a, b) => a >= 0 && a <= 11 && b >= 15 + Math.max(0, (a - 7) / 2) && b <= 17 - Math.max(0, (a - 8) / 2), K.steel);
  lit(p, K.woodL, K.brass, K.steel);
  at(p, -11, 14, K.woodD); // the lock's notch
  at(p, -7, 16, K.brass);
}
function multitool(p) { // open pliers: two steel handles splayed, the jaws above
  const hi = "#c9ced3";
  line(p, 7, 8, 2, 14, hi); line(p, 6, 8, 1, 14, hi); line(p, 7, 9, 3, 14, K.steelD);
  line(p, 9, 8, 13, 14, hi); line(p, 10, 8, 14, 14, K.steelD); line(p, 9, 9, 12, 14, K.steelD);
  R(p, 6, 6, 10, 8, K.dark); p.set(8, 7, K.glint); // the pivot
  line(p, 7, 5, 5, 0, K.steelD); line(p, 8, 5, 6, 0, K.dark);
  line(p, 9, 5, 10, 0, K.steelD); line(p, 10, 5, 11, 0, K.dark);
}
function dots(p, x0, x1, y, c, step = 4) { for (let x = x0; x <= x1; x += step) p.set(x, y, c); }
function boxcutter(p) { // a fat yellow body with a slider, a segmented snap-off blade
  area(p, (a, b) => a >= -12 && a <= 1 && b >= 14 && b <= 18 && !(a <= -11 && (b === 14 || b === 18)), "#d9b23a");
  lit(p, "#d9b23a");
  band(p, -8, -5, 13, 13, K.poly); // the slider
  band(p, 0, 1, 15, 17, K.dark); // the nose
  area(p, (a, b) => a >= 2 && a <= 9 && b >= 15 && b <= 17 && a - 2 * (17 - b) <= 7 - 2, K.steel);
  lit(p, K.steel);
  at(p, 4, 16, K.steelD); at(p, 7, 17, K.steelD); at(p, 5, 15, K.steelD); // the score lines
}
function balisong(p) { // two skeleton handles with a slot between, a latch, the blade out
  band(p, -13, -2, 13, 14, "#6d7378"); band(p, -13, -2, 17, 18, "#6d7378");
  lit(p, "#6d7378");
  for (const a of [-11, -7, -3]) { at(p, a, 13, null); at(p, a, 17, null); }
  band(p, -15, -14, 13, 18, K.dark); // the latch end
  area(p, (a, b) => a >= -1 && a <= 13 && b >= 15 && b <= (a >= 11 ? 16 : 17), K.steel);
  lit(p, K.steel);
  at(p, 13, 15, K.glint);
}

// ---------- machetes and swords: the full diagonal ----------
function machete(p) {
  handle(p, -15, -7, "#3a2a1c");
  for (const a of [-13, -9]) at(p, a, 15, K.steelD);
  area(p, (a, b) => a >= -6 && a <= 14 && b >= 14 && b <= (a > 3 ? 18 : 17) && a + (b - 14) <= 17, "#a9b0b6");
  lit(p, "#3a2a1c", "#a9b0b6");
}
function sawmachete(p) { // a circular-saw blade ground into a cleaver: a round toothed blade, the arbor hole, a wrapped grip
  handle(p, -15, -4, "#5b5048");
  area(p, (a, b) => a >= -15 && a <= -4 && b >= 15 && b <= 16 && ((a + 20) % 4) < 2, "#7d6a5a");
  disc(p, 10, 6, 5, "#bcc4cb");
  area(p, (a, b) => b < 13, null);
  const s = p.px.slice(), e = (x, y) => x < 0 || y < 0 || x > 15 || y > 15 || !s[y * 16 + x];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (s[y * 16 + x] === "#bcc4cb" && x + y > 14 && (e(x + 1, y) || e(x, y - 1) || e(x + 1, y - 1) && e(x, y + 1)) && (x + y) % 2) p.clear(x, y); // the teeth
  lit(p, "#bcc4cb");
  p.clear(10, 6); // the arbor hole
  line(p, 7, 7, 9, 4, "#c86a3a");
}
function springmachete(p) { // a forged leaf spring: a dark scaled blade with a bright ground edge, cord-wrapped grip
  handle(p, -15, -7, "#4f5a3e");
  area(p, (a, b) => a >= -15 && a <= -7 && b >= 15 && b <= 16 && ((a + 20) % 3) === 0, "#2e3328");
  area(p, (a, b) => a >= -6 && a <= 14 && b >= 14 + Math.max(0, a - 11) && b <= 18 - Math.max(0, (a - 11) / 2) - (a < -2 ? 1 : 0), "#4a4f57");
  lit(p, "#4a4f57");
  area(p, (a, b) => a >= -6 && a <= 13 && b === (18 - Math.max(0, Math.ceil((a - 11) / 2)) - (a < -2 ? 1 : 0)), "#dfe5ea");
  area(p, (a, b) => a >= -6 && a <= 13 && b === (17 - Math.max(0, Math.ceil((a - 11) / 2)) - (a < -2 ? 1 : 0)), "#9aa3ab");
}
function kukri(p) { // a forward-bent blade, wide at the belly; a wooden grip with a brass cap
  handle(p, -15, -7, "#5b3a22");
  band(p, -15, -15, 14, 17, K.brass);
  area(p, (a, b) => {
    if (a < -6 || a > 12) return false;
    const c = 15.5 + (a > 0 ? (a * a) / 24 : 0), w = 1.5 + (a > 0 && a < 10 ? Math.min(a, 10 - a) / 3 : 0);
    return b >= c - w && b <= c + w;
  }, "#b4bcc3");
  lit(p, "#5b3a22", "#b4bcc3");
  at(p, -5, 17, "#3a2a1c"); // the notch
}
function katana(p) { // long and slightly curved, a round gold tsuba, a black wrapped grip
  handle(p, -15, -9, K.poly);
  for (const a of [-14, -12, -10]) at(p, a, 16, "#e8e0c8");
  area(p, (a, b) => Math.abs(a + 7) <= 1 && b >= 12 && b <= 19, "#b89a4a");
  area(p, (a, b) => a >= -5 && a <= 15 && b >= 15 - (a > 6 ? 1 : 0) && b <= 16 - (a > 6 ? 1 : 0), "#d6dde2");
  lit(p, "#b89a4a", "#d6dde2");
  at(p, 14, 14, K.glint);
}
function cutlass(p) { // short, heavy and curved, a brass basket round the grip
  handle(p, -14, -8, "#3a2a1c");
  area(p, (a, b) => a >= -14 && a <= -6 && b >= 17 && b <= 21 - (a < -12 || a > -8 ? 1 : 0), K.brass); // the basket
  band(p, -7, -6, 12, 18, K.brass);
  area(p, (a, b) => a >= -5 && a <= 11 && b >= 14 + (a > 6 ? 1 : 0) && b <= 18 - Math.max(0, (a - 6) / 1.6), "#c2c9cf");
  lit(p, K.brass, "#c2c9cf");
  for (const [a, b] of [[-11, 19], [-9, 19], [-10, 20]]) at(p, a, b, "#6e5a2a");
}
function sabre(p) { // long, narrow and curved; a gold D-guard to the pommel
  handle(p, -14, -8, K.poly);
  band(p, -7, -6, 13, 19, "#b89a4a");
  area(p, (a, b) => a >= -15 && a <= -6 && b === 19 + (a < -8 ? 1 : 0), "#b89a4a");
  band(p, -15, -15, 14, 20, "#b89a4a");
  area(p, (a, b) => a >= -5 && a <= 15 && b >= 15 - Math.floor(Math.max(0, a - 2) / 4) && b <= 16 - Math.floor(Math.max(0, a - 2) / 4), "#d6dde2");
  lit(p, "#b89a4a", "#d6dde2");
}
function broadsword(p) { // straight and broad with a fuller, a steel cross, a round pommel
  handle(p, -12, -7, "#5b3a22");
  disc(p, 1, 14, 1, "#8d959c");
  band(p, -6, -5, 9, 21, "#8d959c");
  area(p, (a, b) => a >= -4 && a <= 15 && b >= 14 + Math.max(0, a - 12) && b <= 17 - Math.max(0, a - 12), "#c2c9cf");
  lit(p, "#5b3a22", "#8d959c", "#c2c9cf");
  band(p, -3, 9, 15, 16, "#9aa3ab"); band(p, -3, 9, 16, 16, "#7d858c"); // the fuller
}

// ---------- clubs, tools and axes ----------
function batShape(p, c) {
  area(p, (a, b) => a >= -15 && a <= 13 && b >= 15 && b <= 16, c);
  area(p, (a, b) => a >= -2 && a <= 12 && b >= 14 && b <= 17 && !(a >= 11 && (b === 14 || b === 17)), c);
  area(p, (a, b) => a >= -6 && a <= -3 && (b === 14 || b === 17) && a % 2 === 0, null);
}
const knob = (p, c) => band(p, -15, -15, 14, 17, c);
function bat(p) { // aluminium: silver barrel, black grip tape, a knob
  batShape(p, "#b9c0c6");
  lit(p, "#b9c0c6");
  band(p, -15, -7, 15, 16, K.poly); knob(p, K.poly);
  area(p, (a, b) => a >= -14 && a <= -7 && b >= 15 && b <= 16 && ((a + 20) % 3) === 0, "#4a4f57");
  band(p, 3, 4, 14, 17, "#c8402f"); // the maker's band
}
function woodBat(p, c) { batShape(p, c); lit(p, c); band(p, -15, -9, 15, 16, shade(c, -0.25)); knob(p, shade(c, -0.35)); }
function nailbat(p) { // a wooden bat driven full of nails: heads on the barrel, points out the far side
  woodBat(p, "#a07a48");
  for (const [a, b] of [[1, 15], [5, 15], [9, 15], [3, 17], [7, 17], [11, 15]]) at(p, a, b, "#c9ced3");
  for (const a of [0, 4, 8]) at(p, a, 18, "#9aa3ab");
  for (const a of [2, 6, 10]) at(p, a, 12, "#9aa3ab");
}
function spikedbat(p) { // a darker club with long spikes out of both sides, a taped grip
  woodBat(p, "#8a6638");
  for (const a of [0, 4, 8]) { at(p, a, 12, "#9aa1a8"); at(p, a, 10, "#e0e5e9"); }
  for (const a of [-1, 3, 7, 11]) { at(p, a, 19, "#9aa1a8"); at(p, a, 21, "#c9ced3"); }
  band(p, -12, -9, 14, 17, K.tape);
}
function baton(p) { // expandable: a black grip, two steel tubes, a ball tip
  area(p, (a, b) => a >= -15 && a <= -5 && b >= 14 && b <= 16, K.poly);
  area(p, (a, b) => a >= -4 && a <= 3 && b >= 15 && b <= 16, "#7d858c");
  area(p, (a, b) => a >= 4 && a <= 11 && b >= 15 && b <= 16, "#aab2b9");
  band(p, 12, 13, 14, 17, "#c2c9cf");
  lit(p, K.poly, "#7d858c", "#aab2b9", "#c2c9cf");
  area(p, (a, b) => a >= -14 && a <= -6 && b === 15 && ((a + 20) % 2) === 0, "#4a4f57");
}
function stunbaton(p) { // a thick black prod, a yellow band, contacts and a spark at the tip
  area(p, (a, b) => a >= -15 && a <= 9 && b >= 14 && b <= 17, K.poly);
  lit(p, K.poly);
  band(p, -4, -3, 14, 17, "#e6c23a");
  at(p, -9, 13, "#d0362a"); // the button
  band(p, 10, 12, 14, 14, "#d8b43a"); band(p, 10, 12, 17, 17, "#d8b43a"); // the contacts
  p.set(14, 2, "#7fe6ff"); p.set(15, 1, "#ffffff"); p.set(13, 0, "#7fe6ff"); p.set(15, 3, "#ffe24a"); // the spark
}
function golfclub(p) { // a thin steel shaft, a black grip, the driver's big rounded head turned out to the side
  handle(p, -15, -8, K.poly);
  area(p, (a, b) => a >= -7 && a <= 10 && b >= 15 && b <= 16, "#c9ced3");
  lit(p, K.poly, "#c9ced3");
  area(p, (a, b) => a >= 9 && a <= 12 && b >= 14 && b <= 24 && !(a >= 12 && b >= 22) && !(a <= 9 && b >= 23), "#30343a");
  lit(p, "#30343a");
  area(p, (a, b) => a === 9 && b >= 17 && b <= 21, "#c9ced3"); // the face
  at(p, 11, 19, "#6a7484");
}
function hockeystick(p) { // the stick as it lies on the ice: the shaft down from the grip (top right), the flat blade along the bottom,
  // bent forward at the heel, taped white, the toe turned up; black tape and a knob on the grip, a red maker's stripe
  for (let i = 0; i <= 10; i++) { const x = 15 - Math.round(i * 0.8); R(p, x - 1, i, x, i, i <= 2 ? K.poly : "#c9a46a"); }
  p.set(15, 0, "#4a4f57"); p.set(14, 2, "#4a4f57");
  for (const i of [5, 6, 7]) p.set(15 - Math.round(i * 0.8), i, "#c8402f");
  lit(p, "#c9a46a");
  H(p, 1, 8, 11, "#2a2c30"); H(p, 0, 8, 12, "#2a2c30"); H(p, 1, 7, 13, "#2a2c30"); p.set(0, 10, "#2a2c30"); p.set(0, 11, "#2a2c30"); // the blade, the toe up
  for (const x of [2, 3, 5, 6]) V(p, x, 11, 13, "#e8e4d8"); // the tape
  H(p, 1, 7, 14, "#1d1f22");
}
function prybar(p) { // a forged bar: a hooked claw at the top, a bent chisel at the foot
  stamp(p, 0, 0, [
    "..........kkk...",
    ".........kllkk..",
    ".........k..dk..",
    ".............kd.",
    "............ld..",
    "...........ld...",
    "..........ld....",
    ".........ld.....",
    "........ld......",
    ".......ld.......",
    "......ld........",
    ".....ld.........",
    "....ld..........",
    "...ld...........",
    ".lld............",
    "ld..............",
  ], { k: "#5d636b", l: "#9aa1a8", d: "#5d636b" });
}
function hammer(p) { // a framing hammer: a steel shank with a blue rubber grip, the head across its top, the face one end, the claw the other
  handle(p, -15, -5, "#2f5d8a");
  handle(p, -4, 4, "#9aa1a8");
  lit(p, "#2f5d8a", "#9aa1a8");
  area(p, (a, b) => b >= 9 && b <= 18 && a >= 4 && a <= 7, "#5d636b");
  area(p, (a, b) => b >= 7 && b <= 9 && a >= 3 && a <= 8, "#5d636b"); // the face
  area(p, (a, b) => b >= 18 && b <= 22 && a >= 5 - (b - 18) * 1.2 && a <= 7 - (b - 18) * 0.8, "#5d636b"); // the claw
  lit(p, "#5d636b");
  at(p, 4, 20, null); // the claw's split
}
function sledge(p) { // a big steel block on a long hickory handle
  handle(p, -15, 6, K.hick);
  lit(p, K.hick);
  area(p, (a, b) => a >= 4 && a <= 11 && b >= 9 && b <= 21, K.gun);
  lit(p, K.gun);
}
function axeHead(p, a0, a1, bladeTo, c) { // the cheek at a0..a1, the blade flaring toward small b
  area(p, (a, b) => a >= a0 && a <= a1 && b >= 13 && b <= 18, c);
  area(p, (a, b) => b <= 13 && b >= bladeTo && a >= a0 - (13 - b) / 2 && a <= a1 + (13 - b) / 2, c);
}
function fireaxe(p) { // a red head with a steel edge and a pick behind, a pale handle
  handle(p, -15, 6, K.hick);
  lit(p, K.hick);
  axeHead(p, 6, 9, 7, K.red);
  area(p, (a, b) => b >= 18 && b <= 23 && Math.abs(a - 7.5) <= (23 - b) / 2.5 + 0.5, K.red); // the pick
  lit(p, K.red);
  area(p, (a, b) => b >= 7 && b <= 8 && a >= 1 && a <= 14, "#d6dde2"); // the edge
}
function hatchet(p) { // a short wooden handle, a small steel head
  handle(p, -11, 5, K.wood);
  lit(p, K.wood);
  axeHead(p, 5, 8, 9, "#8d959c");
  lit(p, "#8d959c");
  area(p, (a, b) => b === 9 && a >= 2 && a <= 11, "#d6dde2");
}
function tomahawk(p) { // tactical: a black handle, a black narrow head with a bright edge and a long beard, a spike behind
  handle(p, -15, 6, K.poly);
  lit(p, K.poly);
  area(p, (a, b) => a >= 6 && a <= 8 && b >= 11 && b <= 18, "#3e434b");
  area(p, (a, b) => b >= 8 && b <= 11 && a >= 2 && a <= 9, "#3e434b"); // the blade, its beard reaching down the handle
  area(p, (a, b) => b >= 18 && b <= 24 && Math.abs(a - 7) <= (24 - b) / 2.5 + 0.5, "#3e434b"); // the spike
  lit(p, "#3e434b");
  area(p, (a, b) => b === 8 && a >= 2 && a <= 9, "#d6dde2");
  at(p, 7, 23, "#c9ced3"); at(p, 6, 14, "#7d858c");
}
function pickaxe(p) { // a wooden handle, a curved double-pointed head
  handle(p, -15, 6, K.wood);
  lit(p, K.wood);
  area(p, (a, b) => { const c = 8 - ((b - 15) ** 2) / 22; return b >= 4 && b <= 26 && a >= c - (Math.abs(b - 15) > 8 ? 0 : 1) && a <= c + 1; }, "#6d7378");
  lit(p, "#6d7378");
}
function etool(p) { // the folding shovel: olive shaft, a hinge nut, a pointed spade
  handle(p, -15, 1, "#4b5340");
  band(p, -15, -14, 13, 18, "#4b5340");
  lit(p, "#4b5340");
  band(p, 1, 2, 14, 17, K.poly); // the hinge nut
  area(p, (a, b) => a >= 3 && a <= 14 && Math.abs(b - 15.5) <= Math.min(4.5, (15 - a) * 0.9), "#5f6b4a");
  lit(p, "#5f6b4a");
  area(p, (a, b) => a >= 5 && a <= 10 && b === 15, "#4b5340"); // the spade's ridge
}

// ---------- spears ----------
function pipespear(p) { // a steel pipe, a kitchen knife taped to its end
  handle(p, -15, 5, "#5d636b");
  lit(p, "#5d636b");
  at(p, -15, 15, "#1f2226"); // the pipe's open end
  band(p, 7, 9, 15, 16, K.blk); // the knife's handle
  area(p, (a, b) => a >= 9 && a <= 15 && b >= 15 && b <= 17 - (a > 12 ? 1 : 0) - (a > 14 ? 1 : 0), K.steel);
  lit(p, K.steel);
  at(p, 15, 15, K.glint);
  band(p, 2, 7, 14, 17, "#c9ced3"); // the tape
  area(p, (a, b) => a >= 2 && a <= 7 && b >= 14 && b <= 17 && (a === 4 || a === 7), "#8a9096");
}
function spear(p) { // an ash shaft, lugs, a long leaf-shaped head
  handle(p, -15, 4, K.ash);
  lit(p, K.ash);
  band(p, 4, 5, 12, 19, "#8d959c"); // the lugs
  area(p, (a, b) => a >= 6 && a <= 15 && Math.abs(b - 15.5) <= (a < 10 ? (a - 5) / 2.5 + 0.5 : (15 - a) / 2.5 + 0.5), "#c9ced3");
  lit(p, "#8d959c", "#c9ced3");
}

// ---------- bows and crossbows ----------
function compbow(p) { // a black riser with a sight and a stabilizer, short limbs, cams top and bottom, the string and a cable
  stamp(p, 0, 0, [
    ".......ccc......",
    "......lcXcs.....",
    ".....lccc.s.....",
    "....kl...vs.....",
    "...kN....vs.....",
    "...kNrrr.vs.....",
    "...kk..R.vs.....",
    "..gkk....vs.....",
    "..gkk....vs.....",
    "kkkkk....vs.....",
    "...kk....vs.....",
    "...kN....vs.....",
    "....kl...vs.....",
    ".....lccc.s.....",
    "......lcXcs.....",
    ".......ccc......",
  ], { k: "#35383e", N: "#4f545c", l: "#4a4f57", c: "#c9ced3", X: "#5d636b", s: "#e8e0c8", v: "#a8a08c", g: "#6b4a2a", r: "#5d636b", R: "#e04848" });
}
function pulleybow(p) { // a smooth arc of laminated wood, little pulleys at the tips, an arrow on the string
  stamp(p, 0, 0, [
    "........cs......",
    ".......oD.s.....",
    "......oD..s.....",
    ".....oD...s.....",
    "....oD....s.....",
    "...oD.....s.....",
    "...oD.....s.....",
    "hhggaaaaaaFF....",
    "...gg.....s.....",
    "...oD.....s.....",
    "....oD....s.....",
    ".....oD...s.....",
    "......oD..s.....",
    ".......oD.s.....",
    "........cs......",
    "................",
  ], { o: "#b8895a", D: "#6e4a2c", c: "#c9ced3", s: "#e8e0c8", g: "#3a2a1c", a: "#c9a46a", h: "#9aa1a8", F: "#d0362a" });
}
function crossbowShape(p, stock, prod, str) { // from above: the stock up the diagonal, the prod across it, the string drawn back
  handle(p, -15, 11, stock);
  lit(p, stock);
  area(p, (a, b) => { const k = Math.floor(Math.abs(b - 15) / 4); return b >= 6 && b <= 24 && a >= 2 - k && a <= 4 - k; }, prod);
  lit(p, prod);
  line(p, 4, 3, 5, 9, str); line(p, 12, 11, 6, 10, str);
}
function crossbow(p) { // scrap: a pale wooden stock, a dark leaf-spring prod, a cord string, taped
  crossbowShape(p, "#9a7448", "#4a4f57", "#e8e4da");
  band(p, -2, 0, 14, 17, K.tape);
  at(p, -9, 17, K.poly); at(p, -10, 18, K.poly); // the trigger
}
function xbow(p) { // hunting: a black stock, black limbs with cams, a scope, a bolt with red vanes
  crossbowShape(p, K.poly, "#3a3e45", "#e8e0c8");
  R(p, 3, 1, 4, 2, "#c9ced3"); R(p, 13, 11, 14, 12, "#c9ced3");
  band(p, -9, -2, 12, 13, "#1f2226");
  lit(p, "#1f2226");
  at(p, -2, 12, "#7fb8e6");
  band(p, -6, 13, 15, 15, "#d6dde2"); at(p, 13, 15, "#9aa1a8");
  at(p, -5, 15, "#e04848"); at(p, -7, 15, "#e04848"); at(p, -6, 14, "#e04848");
}

// ---------- vests and carriers (from the front) ----------
const VEST = [[3, 5, 10, 12], [3, 5, 10, 12], [2, 6, 9, 13], [2, 7, 8, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [3, 12]];
function vest(p) { // soft Kevlar: olive, its velcro side straps
  rows(p, 1, VEST, K.olive);
  lit(p, K.olive);
  for (const y of [7, 11]) { H(p, 2, 4, y, "#6f7860"); H(p, 11, 13, y, "#6f7860"); H(p, 2, 4, y + 1, "#3a4030"); H(p, 11, 13, y + 1, "#3a4030"); }
  V(p, 7, 5, 13, "#454b39");
}
function plate(p) { // a plate carrier: the plate's square bag, MOLLE rows, the cummerbund, magazine pouches
  rows(p, 1, [[3, 4, 11, 12], [3, 4, 11, 12], [4, 11], [3, 12], [3, 12], [3, 12], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [3, 12], [3, 12]], "#3c4148");
  lit(p, "#3c4148");
  for (const y of [5, 7]) dots(p, 4, 11, y, "#2a2e33", 2);
  for (const x of [4, 7, 10]) { R(p, x, 9, x + 1, 13, "#4a5058"); H(p, x, x + 1, 9, "#5a616a"); H(p, x, x + 1, 8, "#2a2e33"); }
  H(p, 3, 4, 2, "#8d959c"); H(p, 11, 12, 2, "#8d959c"); // the buckles
}
function tacvest(p) { // police navy: a white panel, three magazine pouches, a radio with its aerial
  rows(p, 1, VEST, K.navy);
  lit(p, K.navy);
  H(p, 4, 11, 6, "#e8ecf0"); dots(p, 5, 10, 6, "#9aa6b8", 2);
  for (const x of [3, 6, 9]) { R(p, x, 9, x + 1, 13, "#3f4c66"); H(p, x, x + 1, 9, "#56658a"); }
  R(p, 11, 3, 12, 6, K.poly); V(p, 12, 0, 2, K.poly); p.set(11, 4, "#5a616a");
}
function tirevest(p) { // strips of black tread laced with rope
  rows(p, 1, VEST, "#2c2c2e");
  for (let y = 4; y <= 14; y += 3) H(p, 2, 13, y, "#47474a");
  for (let y = 5; y <= 14; y += 3) dots(p, 3, 12, y, "#1c1c1e", 2);
  for (const y of [1, 2]) { p.set(4, y, "#47474a"); p.set(11, y, "#47474a"); }
  for (let y = 5; y <= 13; y += 2) { p.set(7, y, K.tan); p.set(8, y + 1, K.tan); }
  V(p, 2, 4, 13, "#47474a");
}
function scrapvest(p) { // a brown work jacket with riveted steel plates
  rows(p, 1, VEST, "#6e5a48");
  lit(p, "#6e5a48");
  for (const [x, y, c] of [[3, 4, "#8d959c"], [9, 4, "#7d858c"], [3, 9, "#7d858c"], [8, 9, "#9aa1a8"]]) {
    R(p, x, y, x + 4, y + 3, c); H(p, x, x + 4, y, shade(c, 0.3)); H(p, x, x + 4, y + 3, shade(c, -0.3));
    p.set(x + 1, y + 1, "#e8eef2"); p.set(x + 3, y + 1, "#e8eef2"); p.set(x + 1, y + 2, shade(c, -0.25)); p.set(x + 3, y + 2, shade(c, -0.25));
  }
}
function sportspads(p) { // football shoulder pads: two big caps, the neck hole, the chest plates and laces
  rows(p, 2, [[2, 6, 9, 13], [1, 7, 8, 14], [0, 15], [0, 15], [0, 15], [1, 14], [2, 13], [3, 12], [3, 12], [3, 12], [4, 11]], "#e4ddcc");
  lit(p, "#e4ddcc");
  R(p, 6, 2, 9, 4, null);
  for (let y = 7; y <= 12; y += 2) { p.set(7, y, "#3a3e45"); p.set(8, y, "#3a3e45"); }
  H(p, 0, 15, 6, "#b9b19c"); V(p, 7, 6, 12, "#b9b19c"); V(p, 8, 6, 12, "#b9b19c");
  for (let y = 7; y <= 12; y += 2) { p.set(7, y, "#3a3e45"); p.set(8, y, "#3a3e45"); }
}

// ---------- guards: a pair ----------
function padding(p) { // magazines (the paper kind) taped round the forearms
  twin((x) => {
    const cv = x === 1 ? ["#c8402f", "#e6c23a"] : ["#3a6fb0", "#e8e0c8"];
    R(p, x, 1, x + 5, 14, cv[0]); R(p, x + 1, 1, x + 4, 1, cv[0]);
    for (let y = 3; y <= 12; y += 2) H(p, x + 1, x + 3, y, cv[1]);
    for (const y of [1, 6, 7, 13]) H(p, x, x + 5, y, "#a8adb3");
    V(p, x, 1, 14, shade(cv[0], 0.25)); V(p, x + 5, 1, 14, shade(cv[0], -0.3));
    H(p, x, x + 5, 14, "#7d838a");
  });
}
function shinguards(p) { // cut plastic bottles taped round the shins
  twin((x) => {
    oval(p, x, 0, x + 5, 6, "#8fc4b8"); R(p, x, 3, x + 5, 15, "#8fc4b8");
    lit(p, "#8fc4b8");
    V(p, x + 2, 2, 14, "#c8eae2");
    for (const y of [3, 8, 13]) { H(p, x, x + 5, y, "#b8bec4"); H(p, x, x + 5, y + 1, "#8a9096"); }
  });
}
function kneeguards(p) { // dirt-bike plastic: a knee cup, a ridged shin plate, black straps
  twin((x) => {
    disc(p, x + 3, 3, 3, "#d9772a"); R(p, x + 1, 5, x + 5, 15, "#d9772a");
    lit(p, "#d9772a");
    for (const y of [9, 12]) H(p, x + 2, x + 4, y, "#a85718");
    for (const y of [6, 14]) H(p, x, x + 6, y, "#2a2c30");
    p.set(x + 2, 2, "#f2b070");
  });
}
function riotarms(p) { // hard black forearm shells: an elbow cup, ridges, straps
  twin((x) => {
    rows(p, 2, [[x + 1, x + 5], [x, x + 6], [x, x + 6], [x, x + 6], [x + 1, x + 5], [x + 1, x + 5], [x + 1, x + 5], [x + 1, x + 5], [x + 1, x + 5], [x + 2, x + 4]], "#33373e");
    lit(p, "#33373e");
    for (const y of [7, 9]) H(p, x + 2, x + 4, y, "#5a616a");
    H(p, x + 2, x + 4, 3, "#4a4f57");
  });
}
function riotlegs(p) { // black thigh, knee and shin guards, tall
  twin((x) => {
    R(p, x + 1, 0, x + 5, 3, "#33373e");
    disc(p, x + 3, 6, 2, "#3e434b");
    R(p, x + 1, 9, x + 5, 15, "#33373e");
    lit(p, "#33373e", "#3e434b");
    for (const y of [11, 13]) H(p, x + 2, x + 4, y, "#5a616a");
    p.set(x + 2, 5, "#7a828c");
  });
}

// ---------- helmets: from the side, facing right ----------
function hardhat(p) { // builder's yellow: a dome with a ridge, a brim with a longer peak
  dome(p, 3, 3, 12, 10, "#e6c23a");
  lit(p, "#e6c23a");
  H(p, 1, 13, 11, "#d8b030"); H(p, 9, 15, 11, "#d8b030"); H(p, 1, 15, 12, "#a8842a");
  H(p, 5, 10, 3, "#f6e28a"); p.set(4, 4, "#f6e28a");
  dots(p, 4, 12, 9, "#b8952a", 2);
}
function footballhelmet(p) { // a blue shell with a white stripe, an ear hole, the grey cage
  dome(p, 1, 2, 12, 12, "#3a6fb0");
  lit(p, "#3a6fb0");
  H(p, 4, 9, 3, "#eef0f2"); p.set(3, 4, "#eef0f2"); p.set(10, 4, "#eef0f2");
  p.set(6, 8, "#1c2026");
  V(p, 14, 5, 12, "#9aa1a8"); for (const y of [6, 9, 12]) H(p, 11, 14, y, "#9aa1a8"); V(p, 12, 6, 12, "#7d858c");
  R(p, 1, 12, 9, 13, "#284e7e");
}
function goaliemask(p) { // a hockey goalie's moulded mask from the front: off-white, eye holes behind a grey cage, a red stripe, breathing holes
  area(p, (a, b, x, y) => ((x - 7.5) / 6.5) ** 2 + ((y - 7.5) / 7.8) ** 2 <= 1, "#e8e4d8");
  lit(p, "#e8e4d8");
  V(p, 7, 0, 3, "#c8402f"); V(p, 8, 0, 3, "#c8402f"); H(p, 4, 11, 1, "#c8402f"); // the painted stripe over the brow
  R(p, 3, 5, 6, 7, "#2a2c30"); R(p, 9, 5, 12, 7, "#2a2c30"); // the eye holes
  for (const x of [4, 6, 9, 11]) V(p, x, 4, 8, "#9aa1a8"); H(p, 3, 12, 6, "#b4bcc3"); // the cage over them
  p.set(7, 10, "#9a9384"); p.set(8, 10, "#9a9384"); // the nose ridge
  for (const [x, y] of [[5, 11], [7, 12], [9, 11], [6, 13], [8, 13], [10, 12]]) p.set(x, y, "#4a4f57"); // the breathing holes
  for (const y of [5, 10]) { p.set(1, y, "#2e3238"); p.set(14, y, "#2e3238"); } // the strap rivets
}
function bikehelmet(p) { // a red full-face shell, a smoked visor, a chin bar, scratched
  oval(p, 1, 1, 14, 14, "#c8402f");
  lit(p, "#c8402f");
  R(p, 9, 5, 15, 8, "#2a3440"); H(p, 10, 14, 5, "#4a5a6c"); p.set(15, 5, null); p.set(15, 8, null); p.set(14, 6, "#8fa8bf");
  H(p, 3, 14, 13, "#8e2a20"); H(p, 4, 12, 14, "#1f2226");
  line(p, 3, 6, 5, 4, "#e2654f"); p.set(6, 10, "#e2654f"); p.set(7, 11, "#e2654f");
}
function riothelmet(p) { // a black shell, the clear visor down over the face, a neck curtain
  dome(p, 1, 1, 12, 9, "#2c3036");
  lit(p, "#2c3036");
  R(p, 1, 9, 4, 13, "#22252a"); H(p, 1, 4, 13, "#1a1c20");
  area(p, (a, b, x, y) => y >= 3 && y <= 14 && x >= 9 && x <= 15 && !(x === 15 && (y < 5 || y > 12)) && !(x >= 14 && y >= 14), "#9fc6dc");
  V(p, 10, 4, 13, "#c8e2f0"); V(p, 15, 6, 11, "#7aa2ba"); H(p, 9, 14, 3, "#3a3e45");
  p.set(6, 6, "#9aa1a8"); p.set(7, 6, "#6d7378");
}
function milhelmet(p) { // the army helmet in its cloth cover: woodland spots, a flared rim, the strap hanging
  dome(p, 2, 2, 13, 10, "#55603b");
  rows(p, 10, [[1, 14], [0, 5, 12, 15]], "#55603b");
  lit(p, "#55603b");
  for (const [x, y, c] of [[5, 4, "#3e4630"], [6, 4, "#3e4630"], [9, 6, "#6b5a3a"], [10, 6, "#6b5a3a"], [4, 8, "#6b5a3a"], [11, 9, "#3e4630"], [8, 3, "#6b6a4a"], [7, 8, "#3e4630"], [8, 8, "#3e4630"]]) p.set(x, y, c);
  line(p, 7, 12, 9, 15, K.tan); line(p, 8, 12, 10, 14, K.tan);
}
function rivethelmet(p) { // patched steel plates, rows of rivets, a nape guard and a padded rim
  dome(p, 2, 2, 13, 10, "#8d959c");
  area(p, (a, b, x, y) => y >= 2 && y <= 10 && x >= 8 && p.get(x, y), "#77808a");
  rows(p, 9, [[0, 4], [0, 4], [0, 3]], "#6d7378");
  lit(p, "#8d959c", "#77808a", "#6d7378");
  H(p, 5, 13, 11, "#6b4a2a"); H(p, 4, 13, 10, "#8a6038");
  for (const [x, y] of [[4, 5], [6, 3], [8, 3], [8, 5], [8, 7], [11, 6], [4, 8], [1, 10], [3, 11]]) p.set(x, y, "#e8eef2");
  p.set(10, 8, "#8a5a32"); p.set(11, 8, "#8a5a32");
}
function highcut(p) { // coyote tan, cut away over the ear, a rail, the night-vision shroud at the brow
  dome(p, 2, 2, 13, 11, K.coyote);
  area(p, (a, b, x, y) => (y >= 9 && x >= 6 && x <= 10) || (y === 8 && x >= 7 && x <= 9), null);
  lit(p, K.coyote);
  H(p, 3, 5, 8, K.poly); H(p, 11, 12, 8, K.poly); H(p, 4, 11, 7, K.poly); dots(p, 4, 11, 7, "#4a4f57", 2);
  R(p, 12, 3, 14, 5, K.poly); p.set(14, 3, "#4a4f57"); p.set(13, 4, "#4a4f57");
  R(p, 6, 3, 8, 4, "#86714c");
}
function ballvisor(p) { // a thick smoked face shield on a black mounting band
  area(p, (a, b, x, y) => y >= 3 && y <= 15 && ((x - 7.5) / 7) ** 2 + ((y - 4) / 11.5) ** 2 <= 1, "#4f6a80");
  lit(p, "#4f6a80");
  R(p, 1, 2, 14, 4, K.poly); H(p, 1, 14, 2, "#4a4f57");
  p.set(3, 3, "#9aa1a8"); p.set(12, 3, "#9aa1a8");
  line(p, 4, 7, 6, 13, "#9ab8cc"); line(p, 5, 6, 6, 9, "#c8e2f0");
}
function riotvisor(p) { // a wide clear clip-on shield, a black trim at its foot, two clips
  area(p, (a, b, x, y) => y >= 2 && y <= 12 && x >= 0 && x <= 15 && !(y >= 11 && (x < 2 || x > 13)) && !(y === 12 && (x < 3 || x > 12)), "#b8d6e6");
  lit(p, "#b8d6e6");
  H(p, 3, 12, 12, K.poly); H(p, 2, 13, 13, K.poly);
  R(p, 2, 0, 3, 2, K.poly); R(p, 12, 0, 13, 2, K.poly);
  line(p, 4, 4, 7, 10, "#e6f4fa"); line(p, 6, 4, 8, 7, "#e6f4fa");
}
function nvgmount(p) { // a black shroud bolted on, a swing arm and its knurled knob
  rows(p, 1, [[3, 12], [2, 13], [2, 13], [3, 12], [4, 11]], "#3a3e45");
  lit(p, "#3a3e45");
  for (const x of [4, 11]) p.set(x, 3, "#c9ced3");
  H(p, 6, 9, 4, "#1c1e22");
  R(p, 6, 6, 9, 11, "#5d636b"); lit(p, "#5d636b");
  R(p, 4, 12, 11, 14, "#4a4f57"); dots(p, 5, 10, 13, "#7d858c", 2); H(p, 4, 11, 12, "#6d7378");
  p.set(1, 2, "#e6c23a"); p.set(14, 2, "#e6c23a"); p.set(1, 3, "#b8952a"); p.set(14, 3, "#b8952a");
}

// ---------- plates ----------
const SAPI = [[6, 9], [5, 10], [4, 11], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [4, 11]];
function ceramicplate(p) { // cream ceramic, a black label, a hairline crack
  rows(p, 1, SAPI, "#ddd4c0");
  lit(p, "#ddd4c0");
  R(p, 5, 8, 10, 11, K.poly); H(p, 6, 9, 9, "#c9ced3"); H(p, 6, 8, 10, "#9aa1a8");
  line(p, 9, 2, 11, 6, "#a89e88");
}
function steelplate(p) { // bare steel, a bright streak, weld seams
  rows(p, 1, SAPI, "#8d959c");
  lit(p, "#8d959c");
  line(p, 5, 6, 9, 2, "#c9ced3"); line(p, 5, 7, 10, 2, "#aab2b9");
  H(p, 4, 11, 11, "#6d7378"); dots(p, 4, 11, 11, "#a8706a", 3);
}
function softinsert(p) { // a soft Kevlar panel, rounded, quilted
  rows(p, 1, [[4, 11], [3, 12], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [3, 12], [4, 11]], K.kev);
  lit(p, K.kev);
  for (let y = 3; y <= 12; y += 3) dots(p, 3, 12, y, "#a8862a", 2);
  for (let y = 4; y <= 12; y += 3) dots(p, 4, 12, y + 0, "#a8862a", 4);
}
function kevlarkit(p) { // two yellow patches with stitched edges, a curved needle and its thread
  R(p, 1, 3, 8, 10, K.kev); lit(p, K.kev);
  R(p, 6, 7, 13, 14, "#b8952a"); lit(p, "#b8952a");
  for (let x = 2; x <= 7; x += 2) { p.set(x, 4, "#7a6020"); p.set(x, 9, "#7a6020"); }
  for (let x = 7; x <= 12; x += 2) { p.set(x, 8, "#5a4a18"); p.set(x, 13, "#5a4a18"); }
  line(p, 10, 1, 14, 5, "#d6dde2"); p.set(15, 5, "#8d959c"); p.set(9, 1, "#8d959c");
  line(p, 9, 2, 11, 5, "#2a2d33"); p.set(12, 6, "#2a2d33");
}

// ---------- bags and packs (from the front) ----------
function backpack(p) { // a blue school bag: a front pocket and its zip, brown reinforcing straps, a handle loop
  rows(p, 0, [[6, 9], [5, 5, 10, 10]], "#6b4a2a");
  rows(p, 2, [[5, 10], [4, 11], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [4, 11]], "#3a6fb0");
  lit(p, "#3a6fb0");
  R(p, 4, 9, 11, 13, "#2f5c94"); H(p, 4, 11, 9, "#c9ced3"); p.set(10, 10, "#c9ced3");
  for (const x of [2, 13]) R(p, x, 4, x, 12, "#6b4a2a");
  H(p, 3, 12, 6, "#6b4a2a"); p.set(7, 6, "#b8952a"); p.set(8, 6, "#b8952a");
}
function slingbag(p) { // a small cross-body bag: a long strap with a buckle off its corner, a zipped front pocket
  for (let i = 0; i <= 5; i++) { p.set(i, i, "#2e3238"); p.set(i + 1, i, "#4a4f57"); }
  R(p, 2, 1, 3, 3, "#c9ced3"); p.set(2, 2, "#8d959c");
  rows(p, 6, [[6, 13], [5, 14], [5, 14], [4, 14], [4, 14], [4, 14], [4, 14], [5, 13], [6, 12]], "#5a616a");
  lit(p, "#5a616a");
  R(p, 6, 10, 12, 13, "#4a4f57"); H(p, 6, 12, 10, "#c9ced3"); p.set(12, 11, "#c9ced3");
  H(p, 6, 13, 7, "#6d7378");
}
function assaultpack(p) { // olive drab, a rounded lid, MOLLE rows, compression straps
  rows(p, 1, [[5, 10], [4, 11], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [4, 11]], "#55603b");
  lit(p, "#55603b");
  R(p, 4, 2, 11, 4, "#4a5434"); H(p, 4, 11, 4, "#3a4128");
  for (const y of [7, 9, 11]) dots(p, 4, 11, y, "#3a4128", 2);
  for (const x of [3, 12]) { p.set(x, 6, "#2a2e22"); p.set(x, 11, "#2a2e22"); }
  p.set(7, 4, "#2a2e22"); p.set(8, 4, "#2a2e22");
}
function hikingpack(p) { // tall and bright: a red lid, orange body, a blue mat rolled under, a hip belt
  rows(p, 0, [[5, 10], [4, 11], [4, 11]], "#a83a2a");
  rows(p, 3, [[4, 11], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11]], "#e07a2a");
  lit(p, "#a83a2a", "#e07a2a");
  R(p, 2, 9, 3, 10, "#2a2d33"); R(p, 12, 9, 13, 10, "#2a2d33");
  R(p, 1, 12, 14, 14, "#3a6fb0"); H(p, 1, 14, 12, "#5f93cf"); H(p, 1, 14, 14, "#284e7e"); V(p, 1, 12, 14, "#7fb0e0");
  V(p, 5, 13, 13, "#2a2d33"); V(p, 10, 13, 13, "#2a2d33");
  R(p, 6, 5, 9, 8, "#c86a24");
}
function rucksack(p) { // a big olive rucksack on an external frame, a top flap, side pockets
  for (const x of [2, 13]) V(p, x, 0, 15, "#c9ced3");
  H(p, 2, 13, 15, "#9aa1a8"); V(p, 13, 1, 15, "#9aa1a8");
  rows(p, 1, [[5, 10], [4, 11], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12]], "#4f5a3e");
  lit(p, "#4f5a3e");
  rows(p, 1, [[5, 10], [4, 11], [3, 12], [3, 12]], "#5c6849"); H(p, 3, 12, 5, "#3c4530"); H(p, 5, 10, 1, "#6c7a58");
  for (const x of [1, 11]) { R(p, x, 8, x + 3, 13, "#5c6849"); H(p, x, x + 3, 8, "#6c7a58"); H(p, x, x + 3, 13, "#3c4530"); p.set(x + 1, 9, "#2a2e22"); }
  p.set(7, 5, "#2a2e22"); p.set(8, 5, "#2a2e22"); V(p, 7, 6, 7, "#3c4530");
}
function duffle(p) { // a big canvas cylinder on its side, two handles, straps round it
  line(p, 4, 4, 6, 2, "#5b4a32"); H(p, 6, 9, 2, "#5b4a32"); line(p, 9, 2, 11, 4, "#5b4a32");
  rows(p, 5, [[1, 14], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [1, 14]], "#7f7750");
  lit(p, "#7f7750");
  R(p, 0, 6, 1, 10, "#a39a6a"); p.set(0, 6, null); p.set(0, 10, null);
  for (const x of [4, 11]) V(p, x, 5, 11, "#5b4a32");
  H(p, 3, 12, 5, "#5b4a32"); dots(p, 5, 10, 5, "#c9ced3", 2);
}

// ---------- rigs ----------
function rig(p, panel, pouch, strap, mags, widths) {
  for (const x of [3, 12]) V(p, x, 0, 6, strap);
  H(p, 3, 12, 2, strap);
  rows(p, 7, [[1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [2, 13]], panel); lit(p, panel);
  let x = 2;
  for (const w of widths) {
    R(p, x, 5, x + w - 1, 11, pouch); H(p, x, x + w - 1, 5, shade(pouch, 0.3)); V(p, x + w - 1, 6, 11, shade(pouch, -0.3)); H(p, x, x + w - 1, 7, shade(pouch, -0.25));
    if (mags) H(p, x, x + w - 2, 4, mags);
    x += w + 1;
  }
}
function chestrig(p) { rig(p, "#9c8862", "#8a7856", "#2e3238", "#2a2d33", [2, 2, 2, 2, 2]); }
function makeshiftrig(p) { // a school bag cut into pouches: blue, a red patch, white stitches, uneven
  rig(p, "#3a6fb0", "#34629c", "#6b4a2a", null, [3, 2, 3, 3]);
  R(p, 6, 8, 7, 10, "#c8402f");
  for (let x = 2; x <= 13; x += 2) p.set(x, 12, "#eef0f2");
  dots(p, 2, 12, 9, "#eef0f2", 3);
}

// ---------- cases ----------
function riflecase(p) { // a long black hard case: a handle, latches, a lock
  R(p, 6, 3, 9, 3, "#2a2d33"); V(p, 6, 3, 5, "#2a2d33"); V(p, 9, 3, 5, "#2a2d33");
  rows(p, 6, [[1, 14], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [1, 14]], "#3a3e45");
  lit(p, "#3a3e45");
  H(p, 1, 14, 9, "#26292e");
  for (const x of [2, 13]) R(p, x, 8, x, 10, "#c9ced3");
  R(p, 7, 9, 8, 10, K.brass);
  dots(p, 2, 14, 7, "#4a4f57", 2);
}
function pistolcase(p) { // closed (what is inside is unknown until it is opened): a small black case, its handle, two latches
  R(p, 6, 3, 9, 3, "#2a2d33"); V(p, 6, 3, 5, "#2a2d33"); V(p, 9, 3, 5, "#2a2d33");
  rows(p, 6, [[2, 13], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [2, 13]], "#3a3e45");
  lit(p, "#3a3e45");
  H(p, 1, 14, 9, "#26292e"); dots(p, 3, 12, 12, "#4a4f57", 3);
  for (const x of [3, 12]) R(p, x, 8, x, 10, "#c9ced3");
  p.set(7, 10, K.brass); p.set(8, 10, K.brass);
}

// ---------- lock boxes and equipment cases (2026-10-19, sim/data-boxes.js) ----------
function cashbox(p) { // a grey steel petty-cash box: the fold-down handle, a round wafer lock on the front
  R(p, 5, 2, 10, 2, "#55595e"); V(p, 5, 2, 4, "#55595e"); V(p, 10, 2, 4, "#55595e");
  rows(p, 5, [[1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14]], "#8d959c");
  lit(p, "#8d959c");
  H(p, 1, 14, 7, "#6d7378");
  disc(p, 7, 10, 1, "#b89a4a"); p.set(7, 10, "#3a3e45"); p.set(7, 11, "#3a3e45");
}
function firebox(p) { // a black fire safe: a thick door seam, a keyed handle, the carry bar on top
  R(p, 4, 0, 11, 1, "#3a3e45"); V(p, 4, 0, 2, "#3a3e45"); V(p, 11, 0, 2, "#3a3e45");
  rows(p, 3, [[0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [1, 14]], "#2a2d33");
  lit(p, "#2a2d33");
  H(p, 1, 14, 6, "#4a4f57"); R(p, 6, 9, 9, 11, "#6d7378"); p.set(7, 10, "#c9ced3"); p.set(8, 10, "#1a1c20");
  R(p, 11, 9, 13, 10, "#b4bcc3"); H(p, 2, 4, 13, "#c8362e");
}
function toolbox(p) { // a red cantilever toolbox: the handle across the lid, two latches, the trays' seams
  R(p, 4, 1, 11, 2, "#2e3238"); V(p, 4, 1, 4, "#2e3238"); V(p, 11, 1, 4, "#2e3238");
  rows(p, 4, [[1, 14], [1, 14], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [1, 14]], "#c8362e");
  lit(p, "#c8362e");
  H(p, 0, 15, 7, "#8e2a20"); H(p, 0, 15, 10, "#8e2a20");
  for (const x of [3, 12]) R(p, x, 6, x, 8, "#c9ced3");
}
function gearcase(p) { // a yellow-tan waterproof case: ribbed sides, two big latches, a pressure valve
  R(p, 5, 2, 10, 3, "#2a2d33");
  rows(p, 4, [[1, 14], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [1, 14]], "#b89a4a");
  lit(p, "#b89a4a");
  H(p, 0, 15, 8, "#8a7236"); for (const x of [2, 13]) V(p, x, 5, 13, "#9a8040");
  for (const x of [4, 10]) R(p, x, 7, x + 1, 9, "#2a2d33");
  disc(p, 7, 12, 1, "#55595e");
}

// ---------- carts (sim/carts.js) ----------
// Drawn after their battle models (ui/cartmodel.js) in the models' colours, seen three-quarters on from above: the
// inside of the tray or the bed showing, the top lit, the right-hand faces in shade, the wheel in front.
const CART = { rim: "#8cb87c", green: "#4a7f44", greenD: "#36603a", inner: "#2a4a2a", wood: "#9a7046", woodD: "#6b4a2c", grip: "#3a2e24", tire: "#1f1d1a", hub: "#a9a59c", steel: "#3c4147", plank: "#7a5532", plankL: "#a87c4e", iron: "#2e2c2a" };
function wheelbarrow(p) { // a green steel tub on one wheel, two wooden handles back to the left, dark grips, a leg
  const K = CART;
  line(p, 0, 6, 11, 11, K.woodD); // the far handle
  disc(p, 12, 12, 3, K.tire); disc(p, 12, 12, 1, K.steel); p.set(12, 12, K.hub); p.set(11, 10, "#3a3734"); // the wheel
  stamp(p, 2, 2, [
    "..rrrrrrrrrrr.",
    ".riiiiiiiiiiir",
    "rriiiiiiiiiir.",
    "rrrrrrrrrrrrg.",
    ".ggggggggggd..",
    "..gggggggggd..",
    "...ddddddd....",
  ], { r: K.rim, i: K.inner, g: K.green, d: K.greenD });
  line(p, 1, 8, 12, 12, K.wood); // the near handle, to the axle
  H(p, 0, 2, 6, K.grip); H(p, 0, 2, 8, K.grip); p.set(0, 7, K.grip); // the grips
  V(p, 6, 10, 13, K.steel); H(p, 5, 7, 14, K.steel); // a leg and its foot
}
function handcart(p) { // a plank bed with side boards on a big spoked wheel, the pole and T handle forward to the right
  const K = CART;
  line(p, 11, 7, 14, 4, K.woodD); V(p, 15, 1, 5, K.grip); p.set(14, 3, K.grip); // the pole, the T handle's crossbar end on
  stamp(p, 0, 2, [
    "..llllllllll",
    ".ppPpppPpppl",
    "lllllllllllw",
    "LLLLLLLLLLLw",
    "wwwwwwwwwwww",
    "LLLLLLLLLLLw",
    "wwwwwwwwwwww",
  ], { l: K.plankL, p: K.plank, P: K.woodD, L: K.wood, w: K.woodD });
  V(p, 11, 9, 13, K.woodD); // the prop leg
  ring(p, 5, 11, 4, K.iron); // the near wheel: iron tyre, wooden felloe, spokes, the hub
  ring(p, 5, 11, 3, K.wood);
  line(p, 3, 9, 7, 13, K.plankL); line(p, 7, 9, 3, 13, K.plankL); H(p, 3, 7, 11, K.plankL); V(p, 5, 9, 13, K.plankL);
  p.set(5, 11, K.iron);
}

// ---------- the bicycle ----------
function bicycle(p) { // a red mountain bike: knobby wheels, a diamond frame, flat bars and a saddle
  const wheel = [".ttttt.", "tt...tt", "t..s..t", "tsshsst", "t..s..t", "tt...tt", ".ttttt."];
  const k = { t: "#4a4f57", h: "#c9ced3", s: "#7d858c" };
  stamp(p, 0, 9, wheel, k); stamp(p, 9, 9, wheel, k);
  const f = "#c8402f";
  line(p, 3, 12, 7, 12, f); line(p, 3, 12, 5, 6, f); line(p, 5, 6, 7, 12, f); line(p, 11, 7, 7, 12, f);
  H(p, 5, 11, 6, "#e2654f"); line(p, 11, 7, 12, 12, "#9aa1a8");
  H(p, 3, 6, 4, "#2a2d33"); p.set(5, 5, "#9aa1a8");
  V(p, 11, 4, 5, "#9aa1a8"); H(p, 10, 13, 3, "#2a2d33");
  R(p, 7, 12, 8, 12, "#c9ced3");
}

// ---------- survival gear (2026-10-19, sim/data-survival.js) ----------
function halligan(p) { // a forged steel bar: a fork at the foot, an adze and a pick at the head
  stamp(p, 0, 0, [
    "...........kkkk.",
    "..........klllkk",
    "...........kld.d",
    "...........ld...",
    "..........ld....",
    ".........ld.....",
    "........ld......",
    ".......ld.......",
    "......ld........",
    ".....ld.........",
    "....ld..........",
    "...ld...........",
    "..ld............",
    ".ld.............",
    "kd.k............",
    "k...............",
  ], { k: "#8d959c", l: "#b4bcc3", d: "#6d7378" });
  for (const [x, y] of [[6, 9], [8, 7], [10, 5]]) p.set(x, y, "#c8362e"); // the red rings of its knurled grip
}
function pipewrench(p) { // a red cast-iron handle, the hook jaw and its knurled nut at the top
  stamp(p, 0, 0, [
    "........ssss....",
    ".......sggggs...",
    "........ssssgs..",
    "............gs..",
    "..........nnn...",
    ".........nnnn...",
    "........rrn.....",
    ".......rrr......",
    "......rrr.......",
    ".....rrr........",
    "....rrr.........",
    "...rrr..........",
    "..rrr...........",
    ".rrr............",
    "rrr.............",
    "rr..............",
  ], { s: "#8d959c", g: "#b4bcc3", n: "#6d7378", r: "#c8362e" });
  lit(p, "#c8362e");
}
function leatherjacket(p) { // a black biker's jacket: the asymmetric zip, wide lapels, silver snaps
  rows(p, 1, [[4, 6, 9, 11], [2, 13], [1, 14], [1, 14], [0, 15], [0, 15], [0, 2, 3, 12, 13, 15], [0, 2, 3, 12, 13, 15], [0, 2, 3, 12, 13, 15], [0, 2, 3, 12, 13, 15], [0, 1, 3, 12, 14, 15], [3, 12], [3, 12], [3, 12]], "#2a2622");
  lit(p, "#2a2622");
  line(p, 9, 3, 6, 14, "#c9ced3"); // the slanted zip
  for (const [x, y] of [[4, 3], [11, 3], [3, 6], [12, 6]]) p.set(x, y, "#c9ced3");
  line(p, 5, 2, 7, 6, "#4a443d"); line(p, 10, 2, 9, 5, "#4a443d"); // the lapels
}
function chainsleeves(p) { // a pair of butcher's chainmail gauntlets: a mesh of steel rings, a strap at the wrist
  twin((x) => {
    rows(p, 0, [[x + 1, x + 5], [x, x + 6], [x, x + 6], [x, x + 6], [x, x + 6], [x, x + 6], [x, x + 6], [x, x + 6], [x, x + 6], [x + 1, x + 5], [x + 1, x + 5], [x + 1, x + 5], [x + 1, x + 5], [x + 2, x + 4]], K.steel);
    for (let y = 0; y < 14; y++) for (let i = x; i <= x + 6; i++) if ((i + y) % 2 && p.get(i, y)) p.set(i, y, K.steelD);
    H(p, x, x + 6, 9, "#3a6fb0"); // the blue strap
    p.set(x + 1, 1, K.glint);
  });
}
function motopants(p) { // black riding trousers, grey knee and shin armour
  rows(p, 0, [[2, 13], [2, 13], [2, 13], [2, 7, 8, 13], [2, 7, 8, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [2, 6, 9, 13], [1, 6, 9, 14]], "#2e3238");
  lit(p, "#2e3238");
  for (const x of [3, 10]) { R(p, x, 7, x + 2, 9, "#6d7378"); R(p, x, 11, x + 2, 14, "#55595e"); H(p, x, x + 2, 7, "#8d959c"); }
  H(p, 2, 13, 1, "#c8362e");
}
function legrig(p) { // a thigh platform: two pistol mag pouches, an admin flap, the leg straps
  for (const x of [5, 10]) V(p, x, 0, 3, "#2e3238");
  rows(p, 3, [[3, 12], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [2, 13], [3, 12], [4, 11]], "#9c8862"); lit(p, "#9c8862");
  for (const x of [3, 6]) { R(p, x, 5, x + 1, 10, "#8a7856"); H(p, x, x + 1, 4, "#2a2d33"); H(p, x, x + 1, 5, "#b29e78"); }
  R(p, 9, 6, 12, 10, "#8a7856"); H(p, 9, 12, 6, "#b29e78"); p.set(10, 8, "#c8402f");
  for (const y of [8, 12]) { H(p, 0, 1, y, "#2e3238"); H(p, 14, 15, y, "#2e3238"); }
}

// ---------- tools for building and crafting (sim/data-tools.js) ----------
function felling(p) { // the felling axe: a long hickory handle, a broad dark head with a bright edge and a flat poll
  handle(p, -15, 7, K.hick);
  lit(p, K.hick);
  axeHead(p, 5, 9, 6, "#4a4f57");
  band(p, 5, 9, 18, 19, "#4a4f57"); // the poll
  lit(p, "#4a4f57");
  area(p, (a, b) => b >= 6 && b <= 7 && a >= 5 - (13 - b) / 2 && a <= 9 + (13 - b) / 2, "#d6dde2"); // the edge, along the blade only
}
function scrapaxe(p) { // a rusty leaf-spring blade wedged in a crooked branch, bound with cord
  handle(p, -13, 6, K.woodD);
  at(p, -8, 14, K.woodD); at(p, -2, 17, K.woodD); // the branch's knots
  lit(p, K.woodD);
  axeHead(p, 4, 7, 10, "#9a5a2e");
  lit(p, "#9a5a2e");
  band(p, 2, 3, 13, 18, "#c9b07a"); band(p, 8, 9, 13, 18, "#c9b07a"); // the cord
}
function shovel(p) { // a round-point shovel: an ash handle with a D grip, a steel blade
  handle(p, -12, 2, K.ash);
  area(p, (a, b) => a >= -15 && a <= -13 && b >= 13 && b <= 18 && !(a === -14 && b >= 15 && b <= 16), K.blk); // the D grip
  lit(p, K.ash, K.blk);
  area(p, (a, b) => a >= 3 && a <= 15 && Math.abs(b - 15.5) <= Math.min(5.5, (16 - a) * 0.8 + 0.5), "#8d959c");
  lit(p, "#8d959c");
  area(p, (a, b) => a >= 4 && a <= 11 && b >= 15 && b <= 16, "#6d7378"); // the spine
}
function scrapshovel(p) { // a hubcap beaten flat and bolted to a length of pipe
  handle(p, -15, 2, "#6d7378");
  lit(p, "#6d7378");
  area(p, (a, b) => (a - 8) ** 2 + (b - 15.5) ** 2 <= 30, "#c9ced3");
  lit(p, "#c9ced3");
  at(p, 8, 15, K.gun); at(p, 8, 16, K.gun); at(p, 5, 13, "#9aa1a8"); at(p, 11, 18, "#9aa1a8"); // the bolt and the dents
}
function scraphammer(p) { // a hex bolt-head lashed across the end of a stick
  handle(p, -15, 4, K.woodL);
  lit(p, K.woodL);
  band(p, 4, 9, 11, 20, K.gun);
  lit(p, K.gun);
  band(p, 2, 3, 13, 18, "#c9b07a"); // the lashing
  at(p, 6, 15, "#3a3e45"); at(p, 7, 16, "#3a3e45");
}
function handsaw(p) { // a carpenter's panel saw: a wooden handle with a grip hole, a long tapering blade, its teeth below
  area(p, (a, b) => a >= -15 && a <= -9 && b >= 11 && b <= 20, K.wood);
  area(p, (a, b) => a >= -13 && a <= -11 && b >= 14 && b <= 17, null); // the grip hole
  lit(p, K.wood);
  area(p, (a, b) => a >= -8 && a <= 14 && b >= 12 && b <= 20 - (a + 8) * 0.25, "#c9ced3");
  lit(p, "#c9ced3");
  area(p, (a, b) => a >= -8 && a <= 14 && Math.round(b) === Math.round(20 - (a + 8) * 0.25) && (a & 1) === 0, "#7d858c"); // the teeth
  at(p, -6, 14, "#b89a4a"); // the brass screw
}
function bowsaw(p) { // a tubular orange bow over a straight coarse blade, the handle end taped
  area(p, (a, b) => Math.abs(a) <= 13 && Math.abs(b - (19 - 10 * (1 - (a / 13) ** 2))) <= 0.8, "#e0672a");
  area(p, (a, b) => Math.abs(a) <= 13 && b >= 19 && b <= 20, "#c9ced3");
  area(p, (a, b) => Math.abs(a) <= 13 && b === 20 && (a & 1) === 0, "#7d858c"); // the teeth
  lit(p, "#e0672a", "#c9ced3");
  band(p, -14, -11, 17, 20, K.poly); // the grip end
}
function scrapsaw(p) { // a hacksaw blade in a frame of bent grey rod, a taped grip
  band(p, -6, 11, 11, 11, "#6d7378"); band(p, -6, -6, 11, 18, "#6d7378"); band(p, 11, 11, 11, 18, "#6d7378"); // the frame
  band(p, -5, 10, 17, 18, "#c9ced3"); // the blade
  lit(p, "#6d7378", "#c9ced3");
  band(p, -14, -7, 14, 17, K.tape);
  lit(p, K.tape);
}
function toolkit(p) { // a blue hard case with a yellow latch, a black handle, a hammer and a spanner on its lid
  R(p, 1, 6, 14, 14, "#2f5d8a"); H(p, 1, 14, 6, "#4a7ab0"); V(p, 1, 6, 14, "#4a7ab0"); H(p, 1, 14, 14, "#1f3f60"); V(p, 14, 7, 14, "#1f3f60");
  H(p, 1, 14, 9, "#244a70"); // the lid's seam
  R(p, 5, 3, 10, 4, K.blk); V(p, 5, 3, 6, K.blk); V(p, 10, 3, 6, K.blk); // the handle
  R(p, 7, 8, 8, 10, "#e6c23a"); // the latch
  H(p, 3, 6, 12, "#c9ced3"); V(p, 3, 11, 13, "#9aa1a8"); // a spanner
  H(p, 10, 12, 11, "#55595e"); V(p, 11, 12, 13, "#a07a48"); // a hammer
}
function welder(p) { // a green inverter welder: a dial, two sockets, a coiled black lead and its electrode holder
  R(p, 1, 4, 11, 13, "#2f6b4a"); H(p, 1, 11, 4, "#4a8a64"); V(p, 1, 4, 13, "#4a8a64"); H(p, 1, 11, 13, "#1f4a33"); V(p, 11, 5, 13, "#1f4a33");
  R(p, 3, 2, 9, 3, K.blk); // the carry strap
  disc(p, 5, 8, 2, "#d6dde2"); p.set(5, 7, "#c8362e"); // the dial
  p.set(9, 7, "#e6c23a"); p.set(9, 10, K.blk); // the switch and a socket
  ring(p, 13, 10, 2, K.blk); V(p, 13, 12, 14, K.blk); R(p, 12, 14, 15, 15, "#c8362e"); // the lead and the holder
}
function sewingkit(p) { // a round pink tin, a spool of red thread and a needle across it
  disc(p, 8, 9, 6, "#d77a9a"); ring(p, 8, 9, 6, "#b05a7a");
  R(p, 5, 6, 10, 11, "#c8362e"); H(p, 5, 10, 6, "#a07a48"); H(p, 5, 10, 11, "#a07a48"); H(p, 6, 9, 8, "#e2654f"); // the spool
  line(p, 2, 14, 13, 3, "#c9ced3"); p.set(13, 3, "#eef0f2"); // the needle
}
function handdrill(p) { // a brace and bit: a wooden knob on top, the bent steel crank with a handle, the chuck and the bit
  R(p, 6, 0, 9, 1, K.wood); // the head knob
  V(p, 7, 2, 4, "#9aa1a8"); H(p, 7, 12, 4, "#9aa1a8"); V(p, 12, 4, 9, "#9aa1a8"); H(p, 7, 12, 9, "#9aa1a8"); // the crank
  R(p, 13, 5, 14, 8, K.woodL); // the sweep's handle
  R(p, 6, 10, 8, 11, K.gun); // the chuck
  V(p, 7, 12, 15, "#c9ced3"); p.set(8, 13, "#7d858c"); p.set(6, 14, "#7d858c"); // the auger bit
  lit(p, K.wood, K.woodL, "#9aa1a8");
}

export const GEAR_ART = {
  halligan, pipewrench, leatherjacket, chainsleeves, motopants, legrig, // survival gear
  axe: felling, scrapaxe, shovel, scrapshovel, scraphammer, handsaw, bowsaw, scrapsaw, toolkit, welder, sewingkit, handdrill, // tools (sim/data-tools.js)
  cashbox, firebox, toolbox, gearcase, // lock boxes and equipment cases
  wheelbarrow, handcart, // carts (sim/carts.js)
  knife: chef, steakknife: steak, filletknife: fillet, cleaver, huntknife: hunter, survivalknife: survival, bowie, bayonet,
  combatknife: combat, shiv, pocketknife: pocket, flipknife: flick, lockback, multitool, boxcutter, balisong,
  machete, sawmachete, springmachete, kukri, katana, cutlass, sabre, broadsword,
  bat, nailbat, spikedbat, baton, stunbaton, golfclub, hockeystick, prybar, hammer, sledge, fireaxe, hatchet, tomahawk, pickaxe, etool,
  pipespear, spear, compbow, pulleybow, crossbow, xbow,
  vest, plate, tacvest, tirevest, scrapvest, sportspads, padding, shinguards, kneeguards, riotarms, riotlegs,
  hardhat, footballhelmet, goaliemask, bikehelmet, riothelmet, milhelmet, rivethelmet, highcut, ballvisor, riotvisor, nvgmount,
  ceramicplate, steelplate, softinsert, kevlarkit,
  backpack, slingbag, assaultpack, hikingpack, rucksack, duffle, chestrig, makeshiftrig, riflecase, pistolcase, bicycle,
};
export const SUPPLY_ART = {};
