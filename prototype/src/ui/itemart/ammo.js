// The ammo family's icons (ui/itemart.js): boxes of rounds (GEAR, cat "ammo"; the reloading bench's brass, powder and
// primers; the ammo can, carton and bag) and loose rounds (SUPPLIES with a round), both built from data-ammo.js so
// every calibre and type has its picture.
// - The calibre gives the cartridge its SHAPE (PROFILE: a row map, tip at the top, rim at the bottom): a tiny .22, short
//   pistol cases, rimmed revolver cases (the .357's nickel), bottlenecked rifle cases (5.7×28's little one, the .300's
//   fat bullet, 7.62×39's steel case, the long .308, the flat-nosed rimmed .30-30, the fat .50), shotgun shells (12
//   gauge red, 20 gauge yellow, on a brass base), the 40 mm grenade and the rocket. Loose rounds stand 2–4 together
//   (5.56 on a stripper clip, .223 loose).
// - The type marks it (TYPE): FMJ / ball copper, soft point a lead tip, hollow point a flat nose with a cavity, AP a
//   black tip, match a polished nickel case, +P a red case band, subsonic a green band, tracer a red tip, rubber all
//   blue, API a silver tip; shells: buck pellet dots, a slug's lead nose, bird speckles on low brass, beanbag a blue band;
//   40 mm: the nose and band colours (HE olive / yellow, canister black flat top, smoke green, illumination white / red).
// - A hand-load (key ending _hand) is the same round with a tarnished case (a faded hull) and a purple marker scribble;
//   its box is a smoky plastic reloading box with a masking-tape label written in marker.
// - A box is a cardboard box tinted by the calibre's family (TINT), its calibre written on it, a stripe in the type's
//   colour, its rounds peeking out of the open top; .50 BMG and 40 mm come in a steel can, the rocket in a crate.
import { C, R, H, V, dots, shade, text, box, line, oval } from "./kit.js";
import { AMMO_GEAR, ROUND_SUPPLIES } from "../../sim/data-ammo.js";

const mix = (a, b, t) => {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = n(a), y = n(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
};

// ---------- colours ----------
const BRASS = "#c8a24a", NICKEL = "#c4cace", STEEL = "#7f8466", ALU = "#aab2b8";
const COPPER = "#bf7040", LEAD = "#8f949a", CAVITY = "#3a2f2a", BLACK = "#26282c";
const MARKER = "#6a3fa0"; // the hand-loader's purple marker
const TARNISH = "#6a5a3a"; // what a reloaded case dulls towards
const tarnish = (c) => mix(c, TARNISH, 0.42);

// A type's look on a cartridge: tip (the top rows), jacket (the rest of the bullet), band (a ring on the case), case (a
// case colour of its own), hp (flat nose with a cavity).
const TYPE = {
  fmj: {}, ball: {},
  sp: { tip: LEAD },
  hp: { hp: true },
  ap: { tip: BLACK },
  match: { case: NICKEL },
  plusp: { band: C.red },
  subsonic: { band: C.green },
  tracer: { tip: "#e8502a" },
  rubber: { tip: C.blue, jacket: C.blue },
  api: { tip: "#e2e6ea" },
};
// The stripe on a box: the type's colour (two colours: half and half).
const STRIPE = {
  fmj: COPPER, ball: COPPER, sp: LEAD, hp: C.yellow, ap: BLACK, match: C.white, plusp: C.red, subsonic: C.green,
  tracer: C.orange, rubber: C.blue, api: ["#e2e6ea", C.red],
  buck: BLACK, slug: LEAD, bird: C.white, beanbag: C.blue,
  he: C.yellow, smoke: C.greenL, illum: C.white, heat: C.red,
};

// ---------- cartridge shapes, by calibre ----------
// Rows from the tip down: t tip, j jacket, n neck, c case, B the type's band (else case), M the hand-load's marker
// (else case), e extractor groove, r rim. W columns; n rounds side by side when loose, gap columns apart.
const PROFILE = {
  "22lr": { n: 4, gap: 1, rows: [".t.", "jjj", "jjj", "ccc", "BBB", "ccc", "ccc", "rrr"] },
  "9mm": { n: 3, gap: 1, rows: [".tt.", "jjjj", "jjjj", "BBBB", "cccc", "MMMM", "cccc", "cccc", "eeee", "rrrr"] },
  "57x28": { n: 3, gap: 1, rows: [".tt.", ".tt.", ".jj.", ".jj.", ".nn.", "cccc", "BBBB", "cccc", "MMMM", "cccc", "cccc", "eeee", "rrrr"] },
  "45acp": { n: 2, gap: 2, rows: [".ttt.", "jjjjj", "jjjjj", "BBBBB", "ccccc", "MMMMM", "ccccc", "ccccc", "eeeee", "rrrrr"] },
  "38spl": { n: 2, gap: 1, rows: ["..tt..", ".jjjj.", ".BBBB.", ".cccc.", ".cccc.", ".MMMM.", ".cccc.", ".cccc.", ".cccc.", ".cccc.", "rrrrrr"] },
  "357": { n: 2, gap: 1, case: NICKEL, rows: ["..tt..", ".jjjj.", ".jjjj.", ".BBBB.", ".cccc.", ".cccc.", ".cccc.", ".MMMM.", ".cccc.", ".cccc.", ".cccc.", ".cccc.", "rrrrrr"] },
  "44mag": { n: 2, gap: 1, rows: ["..ttt..", ".jjjjj.", ".jjjjj.", ".BBBBB.", ".ccccc.", ".ccccc.", ".ccccc.", ".MMMMM.", ".ccccc.", ".ccccc.", ".ccccc.", ".ccccc.", "rrrrrrr"] },
  "223": { n: 3, gap: 1, rows: [".tt.", ".tt.", ".jj.", ".jj.", ".nn.", ".nn.", "cccc", "cccc", "BBBB", "cccc", "MMMM", "cccc", "cccc", "eeee", "rrrr"] },
  "556": { n: 3, gap: 1, clip: true, rows: [".tt.", ".tt.", ".jj.", ".jj.", ".nn.", ".nn.", "cccc", "cccc", "BBBB", "cccc", "MMMM", "cccc", "cccc", "eeee", "rrrr"] },
  "300blk": { n: 3, gap: 1, rows: [".tt.", ".jj.", "jjjj", "jjjj", "jjjj", "BBBB", "cccc", "cccc", "MMMM", "cccc", "cccc", "eeee", "rrrr"] },
  "762x39": { n: 3, gap: 1, case: STEEL, rows: [".tt.", ".tt.", ".jj.", ".jj.", ".jj.", ".nn.", "cccc", "BBBB", "cccc", "MMMM", "cccc", "cccc", "eeee", "rrrr"] },
  "308": { n: 2, gap: 2, rows: ["..t..", ".ttt.", ".jjj.", ".jjj.", ".jjj.", ".nnn.", ".nnn.", "ccccc", "ccccc", "BBBBB", "ccccc", "MMMMM", "ccccc", "ccccc", "eeeee", "rrrrr"] },
  "3030": { n: 2, gap: 1, rows: ["..ttt..", "..jjj..", "..jjj..", "..nnn..", "..nnn..", ".ccccc.", ".ccccc.", ".BBBBB.", ".ccccc.", ".MMMMM.", ".ccccc.", ".ccccc.", ".ccccc.", ".ccccc.", "rrrrrrr"] },
  "50bmg": { n: 2, gap: 1, rows: ["..tt..", "..tt..", ".jjjj.", ".jjjj.", ".jjjj.", ".nnnn.", ".nnnn.", "cccccc", "cccccc", "BBBBBB", "cccccc", "MMMMMM", "cccccc", "cccccc", "eeeeee", "rrrrrr"] },
};
// The look of a round of this calibre and type (hand: a hand-load).
function lookOf(cal, type, hand) {
  const pr = PROFILE[cal] || {}, t = TYPE[type] || {};
  const cs = t.case || pr.case || BRASS;
  const jacket = t.jacket || COPPER;
  return { tip: t.tip || jacket, deep: !!t.tip && !t.jacket, jacket, case: hand ? tarnish(cs) : cs, band: t.band || null, mark: hand ? MARKER : null, hp: !!t.hp };
}
// One cartridge, its bottom row at yBase, its left column at x.
function cartridge(p, x, yBase, rows, look) {
  const y0 = yBase - rows.length + 1;
  let firstTip = true;
  let painted = !look.deep; // a marked tip (lead, black, red, silver) runs a row down the bullet
  rows.forEach((row, j) => {
    let ch = row.replace(/\./g, "")[0];
    if (look.hp && ch === "t") return; // a hollow point's nose is flat: no tip rows
    if (ch === "j" && !painted) { painted = true; ch = "t"; }
    const cells = [];
    for (let i = 0; i < row.length; i++) if (row[i] !== ".") cells.push(i);
    const base = { t: look.tip, j: look.jacket, n: look.case, c: look.case, B: look.band || look.case, M: look.mark || look.case, e: shade(look.case, -0.32), r: shade(look.case, -0.12) }[ch];
    cells.forEach((i, k) => {
      let c = base;
      if (ch !== "e") {
        if (k === 0 && cells.length > 1) c = shade(base, 0.3);
        else if (k === cells.length - 1 && cells.length > 2) c = shade(base, -0.25);
      }
      p.set(x + i, y0 + j, c);
    });
    // the hollow point's cavity: the first bullet row under the (missing) tip, its middle dark, its rim lead
    if (look.hp && ch === "j" && firstTip) {
      firstTip = false;
      if (cells.length <= 2) { p.set(x + cells[0], y0 + j, LEAD); p.set(x + cells[cells.length - 1], y0 + j, CAVITY); }
      else { p.set(x + cells[0], y0 + j, shade(LEAD, 0.3)); p.set(x + cells[cells.length - 1], y0 + j, LEAD); for (const i of cells.slice(1, -1)) p.set(x + i, y0 + j, CAVITY); }
    }
  });
}
const widthOf = (rows) => Math.max(...rows.map((r) => r.length));
// The columns n things w wide stand at, gap apart, centred.
const columns = (n, w, gap) => { const x0 = Math.floor((16 - (n * w + (n - 1) * gap)) / 2); return Array.from({ length: n }, (_, i) => x0 + i * (w + gap)); };

// ---------- shotgun shells ----------
// A hull in the gauge's colour on a brass head: high brass for buck and slug, low for bird and beanbag. x: hull's left
// column, w its width, h its rows (the slug's nose stands above them).
const HULL = { "12ga": C.red, "20ga": C.yellow };
function shell(p, x, yBase, w, h, gauge, type, hand) {
  let hull = HULL[gauge];
  let brass = BRASS;
  if (hand) { hull = mix(hull, "#9a948a", 0.45); brass = tarnish(brass); }
  const top = yBase - h + 1, low = type === "bird" || type === "beanbag";
  const head = low ? 2 : 4; // brass rows (rim included)
  for (let y = top; y <= yBase; y++) {
    const b = y > yBase - head, c = b ? brass : hull;
    H(p, x, x + w - 1, y, c);
    p.set(x, y, shade(c, 0.3));
    p.set(x + w - 1, y, shade(c, -0.25));
  }
  H(p, x, x + w - 1, yBase, shade(brass, -0.2)); // the rim
  if (!low) H(p, x + 1, x + w - 2, yBase - head + 1, shade(brass, 0.25)); // the head's lit edge
  if (type === "slug") {
    // the lead slug's nose in an open roll crimp
    H(p, x + 1, x + w - 2, top - 1, LEAD); p.set(x + 1, top - 1, shade(LEAD, 0.3));
    H(p, x + 2, x + w - 3, top - 2, shade(LEAD, 0.2));
    H(p, x, x + w - 1, top, shade(hull, 0.2));
  } else {
    // the star crimp: a darker top, its centre darkest
    H(p, x + 1, x + w - 2, top, shade(hull, -0.3));
    p.set(x + Math.floor((w - 1) / 2), top, shade(hull, -0.55));
    if (w > 4) p.set(x + Math.ceil((w - 1) / 2), top, shade(hull, -0.55));
  }
  const mid = x + Math.floor(w / 2);
  if (type === "buck") { // big pellets
    for (const [dx, dy] of [[-1, 3], [1, 3], [0, 5], [-1, 7], [1, 7]]) if (top + dy < yBase - head) p.set(mid + dx - (w % 2 ? 0 : 1) + 1, top + dy, "#3a3d42");
  } else if (type === "bird") { // fine shot: light speckles
    for (let y = top + 2; y < yBase - head - 1; y += 2) for (let i = x + 1 + ((y >> 1) & 1); i < x + w - 1; i += 2) p.set(i, y, shade(hull, 0.5));
  } else if (type === "beanbag") { // the less-lethal blue band
    R(p, x, top + 2, x + w - 1, top + 4, C.blue); p.set(x, top + 2, C.blueL); H(p, x, x + w - 1, top + 2, C.blueL);
  }
  if (hand) H(p, x, x + w - 1, yBase - head - 1, MARKER); // the reloader's marker ring
}
const SHELL = { "12ga": { w: 6, h: 13, n: 2, gap: 2 }, "20ga": { w: 4, h: 11, n: 3, gap: 1 } };

// ---------- 40 mm grenades ----------
const GREN = {
  he: { nose: "#617056", band: C.yellow },
  buck: { nose: "#3a3d42", band: C.silver, flat: true },
  smoke: { nose: "#8fbf6a", band: BLACK },
  illum: { nose: C.white, band: C.red },
};
function grenade(p, x, yBase, type) {
  const g = GREN[type] || GREN.he, top = yBase - 11;
  const rows = g.flat ? ["", "nnnnnnn", "nnnnnnn", "BBBBBBB", "nnnnnnn"] : ["..nnn..", ".nnnnn.", "nnnnnnn", "BBBBBBB", "nnnnnnn"];
  rows.forEach((row, j) => {
    const cells = [...row].map((ch, i) => (ch === "." ? -1 : i)).filter((i) => i >= 0);
    cells.forEach((i, k) => {
      const base = row[i] === "B" ? g.band : g.nose;
      p.set(x + i, top + j, k === 0 ? shade(base, 0.3) : k === cells.length - 1 ? shade(base, -0.28) : base);
    });
  });
  for (let y = top + 5; y <= yBase; y++) { H(p, x, x + 6, y, ALU); p.set(x, y, shade(ALU, 0.35)); p.set(x + 6, y, shade(ALU, -0.3)); }
  H(p, x, x + 6, yBase - 1, shade(ALU, -0.35)); // the extractor groove
  H(p, x, x + 6, yBase, shade(ALU, -0.15));
  p.set(x + 3, top + 7, shade(ALU, -0.2)); // a dent in the case's shine
}

// ---------- the rocket ----------
const WARHEAD = "#5d6644", MOTOR = "#45494f";
function rocket(p, x, y) { // x: its left column (7 wide), y: its nose
  const head = ["...n...", "..nnn..", "..nnn..", ".nnnnn.", ".nnnnn.", "nnnnnnn", "nnnnnnn", "nnnnnnn", ".mmmmm."];
  head.forEach((row, j) => {
    const cells = [...row].map((ch, i) => (ch === "." ? -1 : i)).filter((i) => i >= 0);
    cells.forEach((i, k) => { const b = row[i] === "m" ? shade(WARHEAD, -0.25) : WARHEAD; p.set(x + i, y + j, k === 0 ? shade(b, 0.3) : k === cells.length - 1 && cells.length > 2 ? shade(b, -0.3) : b); });
  });
  p.set(x + 3, y, C.goldL); // the fuze
  R(p, x + 2, y + 9, x + 4, y + 15, MOTOR); V(p, x + 2, y + 9, y + 15, shade(MOTOR, 0.3)); V(p, x + 4, y + 9, y + 15, shade(MOTOR, -0.3));
  for (const s of [-1, 1]) { const fx = x + 3 + s * 2; R(p, Math.min(fx, fx + s), y + 12, Math.max(fx, fx + s), y + 15, C.steel); p.clear(fx + s, y + 12); }
  V(p, x, y + 13, y + 15, C.steel); V(p, x + 6, y + 13, y + 15, shade(C.steel, -0.25)); V(p, x + 1, y + 12, y + 15, C.metal); V(p, x + 5, y + 12, y + 15, C.steel);
}

// ---------- loose rounds ----------
// Short rounds stand staggered (every other one a few rows back) so the group fills the picture.
function lifts(n, h) {
  const l = Math.min(3, 16 - h);
  if (l < 2) return Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => ((n === 3 ? i === 1 : i % 2 === 0) ? l : 0));
}
function loose(p, cal, type, hand) {
  if (SHELL[cal]) {
    const s = SHELL[cal], up = lifts(s.n, s.h + (type === "slug" ? 2 : 0));
    columns(s.n, s.w, s.gap).forEach((x, i) => shell(p, x, 15 - up[i], s.w, s.h, cal, type, hand));
    return;
  }
  if (cal === "40mm") { const up = lifts(2, 12); columns(2, 7, 1).forEach((x, i) => grenade(p, x, 15 - up[i], type)); return; }
  if (cal === "rocket") { rocket(p, 4, 0); return; }
  const pr = PROFILE[cal], look = lookOf(cal, type, hand), w = widthOf(pr.rows), up = pr.clip ? [] : lifts(pr.n, pr.rows.length);
  columns(pr.n, w, pr.gap).forEach((x, i) => cartridge(p, x, 15 - (up[i] || 0), pr.rows, look));
  if (pr.clip) { // a steel stripper clip across the heads
    R(p, 0, 13, 15, 15, C.steel); H(p, 0, 15, 13, C.metal); H(p, 0, 15, 15, C.grey); V(p, 0, 13, 15, C.metal);
    for (const x of [3, 8, 13]) p.set(x, 14, C.grey);
  }
}

// ---------- boxes ----------
// The box's colour by calibre family (and its writing's): rimfire orange; pistol blues; revolver purples;
// intermediate rifle greens and black; full-power rifle card and brown; shotgun boxes the colour of their shells.
const TINT = {
  "22lr": [C.orange, C.ink], "9mm": [C.blue, C.white], "57x28": ["#2f6f8a", C.white], "45acp": ["#284e7e", C.white],
  "38spl": [C.purple, C.white], "357": ["#56376d", C.white], "44mag": ["#8e2a20", C.white],
  "223": ["#2f6f6a", C.white], "556": ["#4f5a44", C.yellow], "300blk": ["#383b41", C.white], "762x39": ["#6a6f4a", C.white],
  "308": [C.card, C.ink], "3030": [C.brown, C.white],
  "12ga": [C.red, C.white], "20ga": [C.yellow, C.ink],
};
const LABEL = {
  "22lr": "22", "9mm": "9MM", "57x28": "5.7", "45acp": "45", "38spl": "38", "357": "357", "44mag": "44M",
  "223": "223", "556": "556", "300blk": "300", "762x39": "762", "308": "308", "3030": "3030", "12ga": "12G", "20ga": "20G",
  "50bmg": "50", "40mm": "40",
};
const textX = (s) => Math.max(0, Math.floor((16 - (s.length * 4 - 1)) / 2)) + (s.length >= 4 ? 1 : 0);
// The type's stripe across rows y..y+1 from x0 to x1 (hand: a marker scribble).
function stripe(p, x0, x1, y, type, hand) {
  const s = STRIPE[type] || COPPER, a = Array.isArray(s) ? s[0] : s, b = Array.isArray(s) ? s[1] : s;
  const mid = Math.floor((x0 + x1) / 2);
  for (let x = x0; x <= x1; x++) {
    const c = x <= mid ? a : b;
    if (hand) { p.set(x, y + ((x + 1) % 2), c); if (x % 3 === 0) p.set(x, y + (x % 2), c); }
    else { p.set(x, y, shade(c, 0.12)); p.set(x, y + 1, shade(c, -0.18)); }
  }
}
// The rounds peeking out of an open box's top (their tips at row 1).
function peek(p, cal, type, hand) {
  if (SHELL[cal]) { const s = SHELL[cal], n = s.n + (cal === "12ga" ? 0 : 0); for (const x of columns(n, s.w, s.gap)) shell(p, x, s.h + (type === "slug" ? 2 : 0), s.w, s.h, cal, type, hand); return; }
  const pr = PROFILE[cal], look = lookOf(cal, type, hand), w = widthOf(pr.rows);
  for (const x of columns(pr.n === 4 ? 3 : pr.n, w, pr.gap)) cartridge(p, x, pr.rows.length + (cal === "22lr" ? 1 : 0), pr.rows, look);
}
function cardBox(p, cal, type, hand) {
  peek(p, cal, type, hand);
  const label = LABEL[cal];
  if (hand) { // a smoky plastic reloading box (a hint of the family's colour), masking tape on it written in marker
    const PL = mix(TINT[cal][0], "#a9b4b2", 0.62);
    box(p, 0, 5, 15, 15, PL);
    H(p, 0, 15, 6, shade(PL, -0.18)); // the lid's hinge line
    R(p, 1, 7, 14, 12, "#e2d6a8"); H(p, 1, 14, 12, "#c9bc8a"); p.set(14, 7, PL); p.set(1, 12, PL); // the tape, torn corners
    text(p, textX(label), 7, label, MARKER);
    stripe(p, 1, 14, 13, type, true);
    return;
  }
  const [tint, ink] = TINT[cal];
  box(p, 0, 5, 15, 15, tint);
  H(p, 1, 14, 6, shade(tint, -0.15)); // the open top's inner edge
  text(p, textX(label), 7, label, ink);
  stripe(p, 1, 14, 13, type, false);
}
// A steel ammo can (x0..x1, its lid's top at y): a carry handle, a latch on the right, its writing stencilled yellow.
const OD = "#5d6644";
function steelCan(p, x0, x1, y, label, type) {
  H(p, x0 + 4, x1 - 4, y - 2, C.steel); p.set(x0 + 4, y - 1, C.grey); p.set(x1 - 4, y - 1, C.grey); H(p, x0 + 5, x1 - 5, y - 2, C.metal); // the handle
  box(p, x0, y, x1, 15, OD);
  H(p, x0, x1, y + 2, shade(OD, -0.35)); H(p, x0 + 1, x1 - 1, y + 1, shade(OD, 0.1)); // the lid's seam
  R(p, x1 - 1, y + 1, x1, y + 4, shade(OD, -0.45)); p.set(x1 - 1, y + 1, shade(OD, 0.2)); // the latch
  if (label) text(p, x0 + Math.floor((x1 - x0 - 1 - (label.length * 4 - 1)) / 2), y + 3, label, C.yellow);
  if (type) stripe(p, x0 + 1, x1 - 1, 13, type, false);
}
function crate(p, label, type) {
  // a rocket's warhead out of the open top
  const nose = ["..n..", ".nnn.", ".nnn.", "nnnnn", "nnnnn"];
  nose.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "n") p.set(5 + i, 0 + j, i === row.indexOf("n") ? shade(WARHEAD, 0.3) : WARHEAD); }));
  p.set(7, 0, C.goldL);
  const WOOD = "#9a6d44";
  box(p, 0, 5, 15, 15, WOOD);
  for (const y of [6, 14]) { H(p, 0, 15, y, shade(WOOD, -0.2)); }
  H(p, 0, 15, 5, shade(WOOD, 0.25));
  for (const [x, y] of [[1, 6], [14, 6], [1, 14], [14, 14]]) p.set(x, y, C.silverD); // nails
  text(p, 1, 8, label, "#2a2018");
  if (type) p.set(15, 15, shade(WOOD, -0.4));
}
function ammoBox(p, cal, type, hand) {
  if (cal === "50bmg") return steelCan(p, 0, 15, 5, "50", type);
  if (cal === "40mm") return steelCan(p, 0, 15, 3, "40", type);
  if (cal === "rocket") return crate(p, "HEAT", type);
  cardBox(p, cal, type, hand);
}

// ---------- the reloading bench's supplies and the bulk containers ----------
const EXTRA = {
  // a sack of fired brass, tied at the neck, a few empty cases spilled in front
  brass: (p) => {
    const S = C.khaki;
    // the brass heaped in its open mouth: cases on end, their mouths dark
    for (const [x, y] of [[2, 3], [4, 1], [7, 2], [9, 0], [11, 3]]) { R(p, x, y, x + 1, 7, BRASS); V(p, x, y + 1, 7, shade(BRASS, 0.3)); p.set(x, y, shade(BRASS, -0.2)); p.set(x + 1, y, CAVITY); }
    oval(p, 0, 5, 14, 17, S);
    for (let y = 6; y <= 15; y++) { let a = -1, b = -1; for (let x = 0; x < 16; x++) if (p.get(x, y) === S) { if (a < 0) a = x; b = x; } if (a >= 0) { p.set(a, y, shade(S, 0.25)); p.set(b, y, shade(S, -0.28)); } }
    H(p, 2, 12, 7, shade(S, 0.3)); H(p, 2, 12, 8, shade(S, -0.2)); // the rolled-down rim
    line(p, 4, 10, 5, 14, shade(S, -0.15)); line(p, 9, 10, 10, 13, shade(S, -0.15)); // burlap creases
    // a case spilled in front
    R(p, 10, 14, 14, 15, BRASS); H(p, 10, 14, 14, shade(BRASS, 0.3)); p.set(14, 14, CAVITY); p.set(14, 15, CAVITY); p.set(10, 15, shade(BRASS, -0.3));
  },
  // a 1 lb can of smokeless powder: a black can, its red label, a screw cap
  powder: (p) => {
    const K = C.blackL;
    R(p, 6, 0, 9, 1, C.steel); H(p, 6, 9, 0, C.metal); // the cap
    box(p, 2, 2, 13, 15, K, shade(K, 0.3), shade(K, -0.3));
    H(p, 3, 12, 2, shade(K, 0.45));
    R(p, 2, 5, 13, 12, C.red); V(p, 2, 5, 12, C.redL); V(p, 13, 5, 12, C.redD); H(p, 2, 13, 12, C.redD);
    text(p, 3, 6, "1LB", C.white);
    H(p, 4, 11, 14, shade(K, 0.15));
  },
  // a tray of 100 primers, a grid of little cups
  primers: (p) => {
    const T = "#d8d2be";
    box(p, 0, 3, 15, 14, T);
    R(p, 1, 4, 14, 13, "#4a4d52");
    for (let y = 5; y <= 12; y += 2) for (let x = 2; x <= 13; x += 2) { p.set(x, y, BRASS); p.set(x + (x < 13 ? 0 : 0), y, x % 4 === 2 ? shade(BRASS, 0.3) : BRASS); }
    for (let y = 5; y <= 12; y += 2) p.set(13, y, NICKEL);
    H(p, 0, 15, 15, shade(T, -0.35));
  },
  // a steel ammo can, its handle raised, AMMO stencilled on it
  ammocan: (p) => {
    V(p, 4, 1, 4, C.steel); V(p, 11, 1, 4, C.steel); H(p, 4, 11, 1, C.metal); // the raised handle
    box(p, 0, 5, 15, 15, OD);
    H(p, 0, 15, 7, shade(OD, -0.35)); H(p, 1, 14, 6, shade(OD, 0.1));
    R(p, 14, 6, 15, 8, shade(OD, -0.45));
    text(p, 0, 9, "AMMO", C.yellow);
    H(p, 1, 14, 15, shade(OD, -0.3));
  },
  // a big cardboard carton, taped, 1000 printed on it
  ammocarton: (p) => {
    box(p, 0, 1, 15, 15, C.card, C.paperD, C.cardD);
    R(p, 6, 1, 9, 6, C.paperL); V(p, 9, 1, 6, C.paperD); // the tape over the flaps
    H(p, 0, 15, 6, C.cardD);
    text(p, 0, 8, "1000", C.ink);
    H(p, 1, 14, 14, C.cardD);
  },
  // a stuffed duffle: its handles, its zip, rounds poking out of it
  ammobag: (p) => {
    const D = "#4f5a44";
    for (const [x, c] of [[4, C.copper], [6, BRASS], [9, C.copper]]) { V(p, x, 2, 4, c); p.set(x, 1, x === 6 ? C.copper : shade(c, 0.3)); }
    oval(p, 0, 4, 15, 15, D); R(p, 1, 5, 14, 14, D);
    H(p, 2, 13, 5, shade(D, 0.25)); V(p, 1, 6, 13, shade(D, 0.2)); H(p, 2, 13, 15, shade(D, -0.3)); V(p, 15, 7, 12, shade(D, -0.3)); V(p, 14, 6, 14, shade(D, -0.2));
    H(p, 3, 12, 6, C.rubber); dots(p, 3, 12, 6, C.steel); // the zip, open
    for (const x of [4, 11]) { V(p, x, 7, 13, shade(D, -0.25)); } // the straps
    R(p, 6, 9, 9, 11, shade(D, 0.15)); H(p, 6, 9, 9, shade(D, 0.35)); // a pocket
  },
};
// ---------- the tables ----------
export const GEAR_ART = { ...EXTRA };
for (const [k, g] of Object.entries(AMMO_GEAR)) if (g.rounds) GEAR_ART[k] = (p) => ammoBox(p, g.rounds.cal, g.rounds.type, !!g.rounds.hand);
export const SUPPLY_ART = {};
for (const [k, s] of Object.entries(ROUND_SUPPLIES)) if (s.round) SUPPLY_ART[k] = (p) => loose(p, s.round.cal, s.round.type, !!s.round.hand);
