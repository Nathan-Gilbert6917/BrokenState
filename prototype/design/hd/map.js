// HD designs for the State Map's non-building sprites (design preview only: the game is unchanged). Every painter
// here works on exactly twice its original grid in src/ui/mapsprites.js (a 22 × 13 truck becomes 44 × 26), so the
// on-screen footprint stays the same when the map draws them: mapsprites.js gridW() divides a cached canvas's width by
// UP to get its width in grid pixels, and render.js sizes parties in grid pixels (PARTY_W, SOLO_PX × gridW), so an HD
// sprite cached from a 2× grid must report HALF its grid width (gridW = cv.width / UP / 2, or UP doubled for the HD
// painters) or every party would draw twice as big. The look arguments (owner colour, armed, raft, supply, conditions,
// the ups armour code, levels) mean what they mean today.
//
// Style: the item icons' (design/hd/STYLE.md, design/hd/kit.js). Every material is a 4-tone ramp (PAL or ramp(hex)),
// light from the upper left, forms are round volumes shaded by their silhouette (blob / ellipseV / limb), one specular
// line on a vehicle body or a pane of glass, inner lines only where forms overlap (in the dark tone, never black; the
// outer black rim comes from outline()). People are built like the big figures: a shaded head, a rounded torso, arms
// that start at the torso's top corners and bend at an elbow (hanging: the hand at the hip), capsule legs with the
// walk cycle's feet. Deterministic (Rng from the sim where variety is wanted).
import { painter, shade, mix, desat, scaled } from "./hdcore.js";
import { PAL, ramp, skinRamp, blob, ellipseV, limb, elbowFor } from "./kit.js";
import { Rng } from "../../src/sim/rng.js";
import * as CUR from "./mapcurrent.js"; // the game's painters, copied verbatim, for the comparison cells only

// ---------- palette ----------
export const SHADOW = "#15171b"; // the contact shadow on the ground row (no alpha; a step above the outline so it reads as soft)
const DARK = "#0b0c0e";
const rampCache = new Map();
// A 4-tone ramp for a colour the game picks (memoised: the same colour gives the same tones).
export function R(hex) { let m = rampCache.get(hex); if (!m) { m = ramp(hex); rampCache.set(hex, m); } return m; }
const dimRamp = (m, k) => m.map((c) => mix(c, "#1a1c24", k));
const SKIN = "#d8a677", HAIR = "#3e2a1c", PANTS = "#3a3d46", PACK = "#6b5434";
const SKIN_R = skinRamp(SKIN), HAIR_R = ramp(HAIR), PANTS_R = ramp(PANTS), PACK_R = ramp(PACK);
const TYRE = PAL.black, RIM = PAL.grey, GLASS = PAL.glass, LAMP = ["#b08a2a", "#ffe28a", "#fff1c0", "#ffffff"], TAIL = ["#7a1c14", "#d24a3a", "#ff8a74", "#ffc0b0"];
const WOOD = PAL.wood, ASH = PAL.ash, IRON = PAL.iron, STEEL = PAL.steel, BONE = PAL.paper, RUST = PAL.rust;
const OLIVE = "#5d6b3a", OLIVE_DK = "#454f2a", STONE = "#8d8a82", SAND = "#b8a27a", GOLD = PAL.gold, RED = "#d0342c", WHITE = "#e8e4da", HAY = "#d8b85a", CANVAS = "#b3a27a";
const FIRE = ["#b32a12", "#e8641c", "#f6a52a", "#fbe67a"], GLOW = "#ff9a3a55", SMOKE = "#b4b4b4aa", SMOKE_FAINT = "#a0a0a066", SMOKE_DK = "#5a5a5acc";
const FLESH = ["#2e1016", "#5a2a2e", "#7e3c3e", "#a05a58"], BLOOD = "#7a1c18";
const OUT_RED = "#7a1a1a", OUT_GOLD = "#d9a520", OUT_GRAY = "#8a8a86";

// ---------- shapes ----------
// inside() predicates for blob(): a rounded rectangle (corners cut by r), a union, a difference, an ellipse.
const rr = (x0, y0, x1, y1, r = 1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && !(r && ((x - x0) + (y - y0) < r || (x1 - x) + (y - y0) < r || (x - x0) + (y1 - y) < r || (x1 - x) + (y1 - y) < r));
const union = (...fs) => (x, y) => fs.some((f) => f(x, y));
const minus = (a, b) => (x, y) => a(x, y) && !b(x, y);
const ell = (cx, cy, rx, ry) => (x, y) => ((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2 <= 1;
// A shaded form over a bounding box (blob scans only the box).
function form(p, inside, m, x0, y0, x1, y1, opts = {}) { return blob(p, inside, m, { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(p.w - 1, x1), y1: Math.min(p.h - 1, y1), ...opts }); }
// A pane of glass: the glass ramp, lower-right dark, one diagonal specular streak.
function glass(p, x0, y0, x1, y1, { dark = false, r = 1 } = {}) {
  const m = dark ? [GLASS[0], mix(GLASS[0], GLASS[1], 0.5), GLASS[1], GLASS[2]] : GLASS;
  form(p, rr(x0, y0, x1, y1, r), m, x0, y0, x1, y1, { rim: 1 });
  const n = Math.min(x1 - x0, y1 - y0);
  for (let i = 0; i <= n - 1; i++) { p.set(x0 + 1 + i, y1 - 1 - i, m[3]); if (x0 + 2 + i <= x1 - 1) p.set(x0 + 2 + i, y1 - 1 - i, m[3]); }
}
// A wheel 2r pixels across with its top-left at (x, y): a round tyre, the rim, a dark hub.
function wheel(p, x, y, r = 4) {
  const cx = x + r - 0.5, cy = y + r - 0.5;
  ellipseV(p, cx, cy, r - 0.5, r - 0.5, TYRE, { specular: false });
  ellipseV(p, cx, cy, r - 2.4, r - 2.4, RIM, { specular: r >= 4 });
  p.set(Math.floor(cx), Math.floor(cy), RIM[0]); if (r >= 4) p.set(Math.ceil(cx), Math.ceil(cy), RIM[0]);
}
// The big-tyred wheel (Humvee, MRAP, a tractor): a deep tyre with a thin rim.
function bigWheel(p, x, y, r) {
  const cx = x + r - 0.5, cy = y + r - 0.5;
  ellipseV(p, cx, cy, r - 0.5, r - 0.5, TYRE, { specular: false }); ellipseV(p, cx, cy, r - 2.6, r - 2.6, PAL.black.map((c, i) => (i ? shade(c, 0.25) : c)), { specular: false });
  ellipseV(p, cx, cy, r - 3.8, r - 3.8, RIM, { specular: true }); p.set(Math.floor(cx), Math.floor(cy), RIM[0]);
}
// A wooden cart wheel centred on (cx, cy): the felloe, a dark inside, four spokes and the hub.
function cartWheel(p, cx, cy, r) {
  ellipseV(p, cx, cy, r, r, WOOD, { specular: false }); ellipseV(p, cx, cy, r - 1.4, r - 1.4, [WOOD[0], WOOD[0], WOOD[0], WOOD[0]], { specular: false });
  const s = r - 1.2; limb(p, [cx - s, cy], [cx + s, cy], 0.6, 0.6, ASH); limb(p, [cx, cy - s], [cx, cy + s], 0.6, 0.6, ASH);
  ellipseV(p, cx, cy, 1, 1, ASH, { specular: false });
}
// The dark arch over a wheel (paint before the wheel).
const arch = (p, x, y, r, c) => p.ellipse(x + r - 0.5, y + r - 0.5, r + 1, r + 1, c);
// The ground shadow under something standing on row y between x0 and x1, where nothing is painted yet.
function groundShadow(p, x0, x1, y) { for (let x = x0; x <= x1; x++) if (!p.get(x, y)) p.set(x, y, SHADOW); }
// A crate, w × h with its top-left at (x, y): a lit box with one diagonal brace.
function crate(p, x, y, w, h, m = ASH) {
  form(p, rr(x, y, x + w - 1, y + h - 1, 0), m, x, y, x + w - 1, y + h - 1, { rim: 1 });
  if (w >= 5 && h >= 5) for (let i = 1; i < h - 1; i++) p.set(x + 1 + Math.round(((i - 1) * (w - 3)) / Math.max(1, h - 3)), y + i, m[0]);
}
// A tarp-covered lump from (x0, y0) to (x1, y1): a rounded mass with one fold and a rope.
function tarp(p, x0, y0, x1, y1, m) {
  form(p, rr(x0, y0, x1, y1, 2), m, x0, y0, x1, y1, { specular: true });
  const mx = Math.floor((x0 + x1) / 2), my = y0 + Math.floor((y1 - y0) / 2) + 1;
  for (let i = 0; i < y1 - y0 - 2; i++) p.set(mx + 1 + i, y0 + 2 + i, m[0]);
  p.hl(x0, x1, my, m[0]); for (let x = x0 + 1; x < x1; x += 3) p.set(x, my, ASH[2]);
}
// Paints through a fresh layer; the new pixels get a rim where they border what is already there (crowds stay apart).
function layer(p, paint, rim = DARK) {
  const q = painter(p.w, p.h);
  paint(q);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (q.get(x, y) || !p.get(x, y)) continue;
    if (q.get(x - 1, y) || q.get(x + 1, y) || q.get(x, y - 1) || q.get(x, y + 1)) p.set(x, y, rim);
  }
  p.blit(q, 0, 0);
}
// A painter view shifted by (ox, oy) (a vehicle beside a wagon in one sprite).
function shifted(p, ox, oy) {
  return { w: p.w - ox, h: p.h - oy, set: (x, y, c) => p.set(x + ox, y + oy, c), get: (x, y) => p.get(x + ox, y + oy), rect: (x0, y0, x1, y1, c) => p.rect(x0 + ox, y0 + oy, x1 + ox, y1 + oy, c),
    hl: (x0, x1, y, c) => p.hl(x0 + ox, x1 + ox, y + oy, c), vl: (x, y0, y1, c) => p.vl(x + ox, y0 + oy, y1 + oy, c), clear: (x, y) => p.clear(x + ox, y + oy),
    line: (x0, y0, x1, y1, c) => p.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, c), ellipse: (cx, cy, rx, ry, c) => p.ellipse(cx + ox, cy + oy, rx, ry, c), circle: (cx, cy, r, c) => p.circle(cx + ox, cy + oy, r, c),
    over: (x, y, c) => p.over(x + ox, y + oy, c), blit: (q, x, y) => p.blit(q, x + ox, y + oy) };
}
function star(p, x, y, c) { p.set(x + 2, y, c); p.hl(x, x + 4, y + 1, c); p.rect(x + 1, y + 2, x + 3, y + 2, c); p.set(x, y + 3, c); p.set(x + 4, y + 3, c); p.set(x + 2, y + 3, c); }

// ---------- people ----------
// Legs by walk frame (mapsprites.js LEGS, doubled): the far leg's knee and foot, its boot's top-left, then the near
// leg's, as offsets from the figure's top-left in the old grid's units (× 2 here). Boots are 3 × 2.
const LEGS = [
  { far: [[1, 8], [1, 9]], farBoot: [1, 10], near: [[3, 8], [3, 9]], nearBoot: [3, 10] },           // standing
  { far: [[1, 8], [0, 9]], farBoot: [0, 10], near: [[3, 8], [4, 9]], nearBoot: [4, 10] },           // near leg forward
  { far: [[2, 8], [2, 9]], farBoot: [2, 10], near: [[4, 8], [4, 8.6]], nearBoot: [4, 9] },         // passing, the near foot up
  { far: [[3, 8], [4, 9]], farBoot: [4, 10], near: [[2, 8], [1, 9]], nearBoot: [0, 10] },           // far leg forward
  { far: [[0, 8], [-1, 9]], farBoot: [-1, 10], near: [[3, 8], [3, 9]], nearBoot: [3, 10] },         // limp: the hurt leg dragged
];
const bootAt = (p, bx, by, m = PAL.black) => form(p, rr(bx, by, bx + 2, by + 1, 0), m, bx, by, bx + 2, by + 1, { rim: 1 });
function oneLeg(p, hip, pts, boot, x, y, m, r, bandage) {
  const knee = [x + pts[0][0] * 2 + 1.5, y + pts[0][1] * 2 + 1], foot = [x + pts[1][0] * 2 + 1.5, y + pts[1][1] * 2 + 1];
  limb(p, hip, knee, r + 0.2, r, m); limb(p, knee, foot, r, r * 0.85, m);
  bootAt(p, x + boot[0] * 2, y + boot[1] * 2);
  if (bandage) p.rect(Math.round(knee[0]) - 1, Math.round(knee[1]), Math.round(knee[0]), Math.round(knee[1]) + 1, PAL.white[2]);
}
// One person, 10 wide and 22 tall with the head's top row at y (hats rise above it), facing right. o as mapsprites.js
// person(): { cloth, pants, skin, hat, hatColor, robe, pack, band, arm, armColor, frame, bandage }. The arms start at
// the torso's top corners and bend at the elbow (upper arm and forearm 4 px each: a hanging hand reaches the hip).
function person(p, x, y, o = {}) {
  const cloth = R(o.cloth || "#5a6068"), clothF = R(shade(o.cloth || "#5a6068", -0.22)), skin = o.skin ? skinRamp(o.skin) : SKIN_R;
  const pants = o.pants ? R(o.pants) : PANTS_R, pantsF = R(shade(o.pants || PANTS, -0.22)), frame = o.frame || 0, L = LEGS[frame] || LEGS[0];
  const cx = x + 4.5, shoulderN = [x + 7.5, y + 6], shoulderF = [x + 1.5, y + 6];
  const drawArm = (s, e, h, m, r = 1.2, hand = true) => { limb(p, s, e, r + 0.2, r, m); limb(p, e, h, r, r * 0.9, m); if (hand) ellipseV(p, h[0], h[1] + 0.3, 1.1, 1.1, skin, { specular: false }); };
  const pose = (s, target, bend = 1) => elbowFor(s, target, 4, 4, bend);
  // Far side first: the far arm, the far leg (or the robe), the pack.
  if (!o.robe) { const fh = pose(shoulderF, [x + 0.5, y + 13]); drawArm(shoulderF, fh[0], fh[1], clothF, 1.1, true); }
  if (!o.robe) oneLeg(p, [x + 3, y + 14], L.far, L.farBoot, x, y, pantsF, 1.2, o.bandage);
  if (o.pack) form(p, rr(x - 1, y + 6, x + 1, y + 12, 1), PACK_R, x - 1, y + 6, x + 1, y + 12, { rim: 1 });
  if (o.robe) {
    form(p, (xx, yy) => yy >= y + 5 && yy <= y + 21 && Math.abs(xx - cx) <= 3 + Math.max(0, (yy - y - 11) / 10) * 2 + (yy <= y + 5 ? -0.5 : 0), cloth, x - 1, y + 5, x + 10, y + 21);
    p.vl(Math.round(cx) - 1, y + 9, y + 20, cloth[0]);
    if (frame) p.set(frame === 3 ? x - 1 : x + 10, y + 21, cloth[0]);
  } else {
    oneLeg(p, [x + 6, y + 14], L.near, L.nearBoot, x, y, pants, 1.3, false);
    // The torso: a rounded trapezoid, shoulders 6 wide, the waist 5, a belt where it meets the trousers.
    form(p, (xx, yy) => { if (yy < y + 5 || yy > y + 13) return false; const t = (yy - y - 5) / 8; const half = 3 - 0.5 * t; const round = yy === y + 5 ? 1 : 0; return xx >= cx - half + round && xx <= cx + half - round; }, cloth, x + 1, y + 5, x + 8, y + 13);
    p.hl(x + 2, x + 7, y + 13, PAL.leather[1]); p.set(x + 5, y + 13, PAL.brass[2]);
  }
  if (o.band) p.rect(x + 3, y + 7, x + 4, y + 8, o.band);
  // The head: a shaded ellipse, hair over the crown and down the back, an eye, the mouth.
  const hx = x + 5.5, hy = y + 2.5;
  ellipseV(p, hx, hy, 2.3, 2.6, skin, { specular: !o.hat });
  if (!o.hat || o.hat === "cap" || o.hat === "straw") form(p, (xx, yy) => ell(hx, hy, 2.3, 2.6)(xx, yy) && (yy <= y + 1 || (xx <= x + 4 && yy <= y + 3)), HAIR_R, x + 3, y, x + 8, y + 3, { rim: 1 });
  p.set(x + 7, y + 2, "#1a1412"); p.set(x + 7, y + 4, skin[0]);
  const hc = o.hatColor || o.cloth || "#5a6068", hm = R(hc);
  if (o.hat === "helmet") { ellipseV(p, hx, hy - 1.2, 3, 2.4, hm, { specular: true, cut: (xx, yy) => yy <= y + 1 }); p.hl(x + 3, x + 8, y + 1, hm[0]); }
  else if (o.hat === "mohawk") { form(p, ell(hx, hy, 2.3, 2.6), skin, x + 3, y, x + 8, y + 1, { rim: 1 }); limb(p, [hx - 0.5, y - 3], [hx + 0.5, y + 0.5], 0.9, 1.1, hm); }
  else if (o.hat === "hood") { ellipseV(p, hx - 0.3, hy - 0.2, 3, 3.1, hm, { specular: false }); ellipseV(p, x + 7, hy + 0.3, 1.2, 1.6, [skin[0], mix(skin[0], skin[1], 0.5), skin[1], skin[2]], { specular: false }); p.set(x + 7, y + 2, "#1a1412"); }
  else if (o.hat === "straw") { p.hl(x + 2, x + 9, y - 1, ASH[1]); p.set(x + 2, y - 1, ASH[2]); p.set(x + 9, y - 1, ASH[0]); ellipseV(p, hx, y - 2, 2, 1.4, ASH, { specular: false, cut: (xx, yy) => yy <= y - 2 }); p.hl(x + 3, x + 8, y, shade(skin[0], -0.2)); }
  else if (o.hat === "cap") { ellipseV(p, hx, hy - 1, 2.6, 2, hm, { specular: false, cut: (xx, yy) => yy <= y + 1 }); p.hl(x + 7, x + 9, y + 1, hm[0]); p.set(x + 8, y, hm[1]); }
  // The near arm by what it holds; the hand close to the body, the elbow bent.
  const ac = o.armColor || o.cloth || "#5a6068", am = R(ac);
  switch (o.arm) {
    case "rifle": { // the stock at the shoulder, the barrel ahead, the hand on the grip under it
      limb(p, [x + 4, y + 9.5], [x + 6.5, y + 8.5], 1.1, 1, WOOD); limb(p, [x + 6, y + 8.5], [x + 15, y + 8.5], 1, 0.8, IRON); p.set(x + 10, y + 8, IRON[3]); p.set(x + 11, y + 8, IRON[3]); limb(p, [x + 9, y + 9.5], [x + 9, y + 11], 0.9, 0.8, IRON);
      const [e, h] = pose(shoulderN, [x + 8.5, y + 10]); drawArm(shoulderN, e, h, cloth); break;
    }
    case "raised": { // a machete up
      const [e, h] = pose(shoulderN, [x + 10, y + 2.5], -1); drawArm(shoulderN, e, h, cloth);
      limb(p, [x + 10, y + 2], [x + 11.5, y + 0.5], 0.8, 0.8, WOOD); limb(p, [x + 11.5, y + 0.5], [x + 15.5, y - 3.5], 1, 0.6, STEEL); p.set(x + 13, y - 2, STEEL[3]); break;
    }
    case "spear": case "fork": case "torch": case "banner": case "staff": case "bar": { // a shaft in the leading hand
      const top = { spear: y - 8, fork: y - 7, torch: y, banner: y - 12, staff: y - 1, bar: y + 2 }[o.arm], bot = { spear: y + 19, fork: y + 19, torch: y + 11, banner: y + 19, staff: y + 21, bar: y + 13 }[o.arm];
      const sx = x + 10.5, shaft = o.arm === "bar" ? IRON : WOOD;
      limb(p, [sx, top], [sx, bot], 0.9, 0.9, shaft);
      if (o.arm === "spear") { limb(p, [sx, y - 8], [sx, y - 11], 1.1, 0.4, STEEL); p.set(x + 10, y - 10, STEEL[3]); }
      if (o.arm === "fork") { p.hl(x + 8, x + 13, y - 7, STEEL[1]); p.set(x + 8, y - 7, STEEL[2]); for (const fx of [x + 8, x + 10, x + 13]) { p.vl(fx, y - 10, y - 8, STEEL[2]); p.set(fx, y - 10, STEEL[3]); } p.vl(x + 11, y - 9, y - 8, STEEL[1]); }
      if (o.arm === "torch") { ellipseV(p, sx, y - 2.5, 1.6, 2.4, FIRE, { specular: false }); p.set(x + 10, y - 3, FIRE[3]); p.set(x + 11, y - 1, FIRE[2]); p.set(x + 12, y - 4, GLOW); p.set(x + 9, y - 5, GLOW); p.set(x + 11, y - 6, GLOW); }
      if (o.arm === "banner") { form(p, rr(x + 12, y - 12, x + 19, y - 3, 1), am, x + 12, y - 12, x + 19, y - 3, { rim: 1 }); p.rect(x + 14, y - 9, x + 17, y - 7, GOLD[2]); p.set(x + 14, y - 9, GOLD[3]); p.set(x + 17, y - 7, GOLD[0]); p.set(x + 10, y - 13, GOLD[2]); p.set(x + 11, y - 13, GOLD[3]); }
      if (o.arm === "bar") { limb(p, [sx, y + 2], [x + 12.5, y + 1], 0.9, 0.7, IRON); p.set(x + 11, y + 2, IRON[3]); }
      const hy2 = o.arm === "staff" ? y + 11 : o.arm === "bar" ? y + 9.5 : y + 8.5;
      const [e, h] = pose(shoulderN, [x + 9.5, hy2]); drawArm(shoulderN, e, h, cloth); break;
    }
    case "shield": { // the near arm behind a shield in the group's colour
      form(p, (xx, yy) => yy >= y + 5 && yy <= y + 16 && xx >= x + 8 && xx <= x + 13 && !(yy === y + 5 && (xx === x + 8 || xx === x + 13)) && !(yy > y + 13 && Math.abs(xx - x - 10.5) > 2.5 - (yy - y - 13) * 0.6), am, x + 8, y + 5, x + 13, y + 16, { specular: true });
      ellipseV(p, x + 10.5, y + 10, 1.3, 1.3, STEEL, { specular: true }); break;
    }
    case "binoc": { const [e, h] = pose(shoulderN, [x + 8, y + 4], 1); drawArm(shoulderN, e, h, cloth); form(p, rr(x + 7, y + 2, x + 10, y + 3, 0), IRON, x + 7, y + 2, x + 10, y + 3, { rim: 1 }); p.set(x + 11, y + 2, GLASS[1]); p.set(x + 11, y + 3, GLASS[0]); break; }
    case "none": default: { const [e, h] = pose(shoulderN, [x + 8.5, y + 13.5]); drawArm(shoulderN, e, h, cloth); }
  }
}
// A bedroll strapped over the pack.
function bedroll(p, x, y, c = "#a08a60") { limb(p, [x - 2, y + 4.5], [x + 2, y + 4.5], 1.1, 1.1, R(c)); }

// ---------- vehicles ----------
// Pickup truck (44 × 26): cab with a windscreen reflection, hood and grille, a bed with cargo under a tarp.
export function paintTruckHD(color) {
  const p = painter(44, 26);
  pickup(p, 0, 0, color);
  tarp(p, 4, 6, 21, 11, R("#8c7a52"));
  return p;
}
// Generic pickup at (x, y) in a body colour, the bed open (cargo painted by the caller). 42 × 26 from (x+1, y).
function pickup(p, x, y, body) {
  const m = R(body), q = shifted(p, x, y);
  form(q, union(rr(2, 12, 41, 19, 1), rr(24, 4, 33, 13, 2), rr(34, 10, 41, 13, 1)), m, 2, 4, 41, 19, { specular: true });
  q.vl(24, 12, 18, m[0]); q.vl(34, 11, 16, m[0]);                       // the bed / cab gap and the hood's edge
  glass(q, 25, 6, 27, 11, { dark: true }); glass(q, 29, 6, 33, 11); q.set(29, 6, m[1]); q.set(29, 7, m[1]); q.vl(28, 6, 11, m[0]); // door window, A-pillar, windscreen
  q.rect(40, 14, 41, 16, IRON[1]); q.rect(40, 14, 41, 15, LAMP[1]); q.set(40, 14, LAMP[2]);     // grille and headlight
  limb(q, [39, 18.5], [42, 18.5], 1, 1, STEEL);                                                 // the bumper
  q.rect(2, 14, 3, 15, TAIL[1]); q.set(2, 14, TAIL[2]);
  q.set(26, 13, m[0]); q.set(27, 13, m[0]); q.set(34, 8, m[0]); q.set(34, 9, m[0]);               // a door handle, the mirror
  arch(q, 6, 18, 4, m[0]); arch(q, 30, 18, 4, m[0]);
  wheel(q, 6, 18); wheel(q, 30, 18);
  groundShadow(q, 3, 41, 25);
}

// Old sedan (44 × 24): a low body with a belt line, a sloped cabin with two windows, a boot and a bonnet.
export function paintSedanHD(color) {
  const p = painter(44, 24), m = R(color);
  form(p, union(rr(2, 10, 41, 17, 1), rr(10, 4, 31, 10, 2), rr(9, 6, 32, 10, 0)), m, 2, 4, 41, 17, { specular: true });
  glass(p, 12, 6, 19, 9); glass(p, 22, 6, 29, 9); p.vl(20, 6, 11, m[0]); p.set(12, 6, m[1]); p.set(29, 6, m[1]);
  p.rect(23, 12, 25, 12, m[0]); p.rect(16, 12, 18, 12, m[0]);
  p.rect(40, 12, 41, 13, LAMP[1]); p.set(40, 12, LAMP[2]); p.rect(2, 12, 3, 13, TAIL[1]); p.set(2, 12, TAIL[2]);
  limb(p, [39, 16.5], [42, 16.5], 1, 1, STEEL); limb(p, [1, 16.5], [3, 16.5], 1, 1, STEEL);
  arch(p, 6, 16, 4, m[0]); arch(p, 30, 16, 4, m[0]);
  wheel(p, 6, 16); wheel(p, 30, 16);
  groundShadow(p, 3, 41, 23);
  return p;
}

// A few walkers with packs (40 × 28), 1–3 by team size; armed for raids.
export function paintWalkersHD(color, count, armed) {
  const p = painter(40, 28);
  const pos = [[14, 6, 1], [2, 2, 3], [26, 4, 0]].slice(0, Math.max(1, Math.min(3, count)));
  pos.sort((a, b) => a[1] - b[1]);
  pos.forEach(([x, y, f], i) => layer(p, (q) => person(q, x, y, { cloth: i % 2 ? shade(color, -0.15) : color, pack: true, arm: armed ? "rifle" : "none", frame: f, hat: i === 2 ? "cap" : "", hatColor: shade(color, -0.4) })));
  for (const [x, y] of pos) groundShadow(p, x, x + 10, y + 22);
  return p;
}

// Rowboat with the team and their gear, or a log raft with the vehicle lashed on top (48 × 26).
export function paintBoatHD(color, raft) {
  const p = painter(48, 26), m = R(color);
  if (raft) {
    for (let x = 2; x <= 44; x += 6) limb(p, [x + 0.5, 20.5], [x + 5.5, 20.5], 2.6, 2.6, WOOD, { capA: x === 2, capB: x >= 44 });
    for (let x = 2; x <= 44; x += 6) p.vl(x, 18, 23, WOOD[0]);
    p.hl(8, 35, 17, ASH[0]); for (let x = 9; x <= 35; x += 4) p.set(x, 17, ASH[2]);                 // the lashing
    form(p, union(rr(8, 10, 35, 16, 1), rr(20, 4, 31, 10, 2)), m, 8, 4, 35, 16, { specular: true }); glass(p, 25, 6, 30, 9); p.set(25, 6, m[1]);
    p.set(35, 13, LAMP[1]); p.set(8, 12, TAIL[1]);
    person(p, 36, 1, { cloth: color, arm: "staff", frame: 1 });
    return p;
  }
  form(p, (x, y) => (y >= 14 && y <= 23 && x >= 2 + (y - 14) * 1.1 && x <= 43 - (y - 14) * 0.9) || (y >= 10 && y <= 13 && x >= 42 && x <= 45 + (y - 10) * 0.4), ASH, 1, 10, 47, 23, { specular: false });
  p.hl(2, 43, 14, ASH[3]); p.hl(4, 41, 19, WOOD[1]); p.hl(10, 35, 22, WOOD[0]);                    // the gunwale's lit edge, the planks
  form(p, rr(14, 12, 29, 13, 0), [WOOD[0], WOOD[0], WOOD[1], WOOD[1]], 14, 12, 29, 13, { flat: true });  // the inside, seen over the gunwale
  for (const x of [12, 26]) {                                                                      // two rowers, bent to the oars
    form(p, (xx, yy) => yy >= 6 && yy <= 13 && Math.abs(xx - x - 2.5) <= 3 - (yy === 6 ? 1 : 0), m, x, 6, x + 5, 13);
    ellipseV(p, x + 3.5, 3.5, 2.3, 2.6, SKIN_R); form(p, (xx, yy) => ell(x + 3.5, 3.5, 2.3, 2.6)(xx, yy) && (yy <= 2 || (xx <= x + 2 && yy <= 4)), HAIR_R, x + 1, 1, x + 6, 4, { rim: 1 }); p.set(x + 5, 3, "#1a1412");
    const [e, h] = elbowFor([x + 5.5, 7], [x + 8.5, 11], 4, 4, 1); limb(p, [x + 5.5, 7], e, 1.4, 1.2, m); limb(p, e, h, 1.2, 1.1, m); ellipseV(p, h[0], h[1], 1.1, 1.1, SKIN_R, { specular: false });
  }
  crate(p, 32, 7, 8, 6, R("#8c7a52")); form(p, rr(6, 8, 9, 13, 1), PACK_R, 6, 8, 9, 13, { rim: 1 });
  limb(p, [10, 15], [1, 24], 0.8, 0.7, WOOD); limb(p, [1, 24], [0.5, 25], 1.4, 1.4, WOOD);          // an oar
  return p;
}

// Bicycles left leaning in the grass (40 × 28): two of them, frames in the team colour, the one behind in shade.
export function paintBikesHD(color, damaged) {
  const p = painter(40, 28), f = desat(color, 0.35);
  layer(p, (q) => bicycle(q, 3, 6, shade(f, -0.3), false, true));
  layer(p, (q) => bicycle(q, 4, 12, f, damaged, false));
  groundShadow(p, 4, 36, 27);
  return p;
}
// A bicycle 33 wide and 16 tall with its top-left at (x, y): the rear hub at (x + 5, y + 10), the front at (x + 25, y + 10).
function bicycle(p, x, y, f, bent, dim) {
  const m = dim ? dimRamp(R(f), 0.3) : R(f), tyre = dim ? "#383a41" : PAL.black[2], rim = dim ? PAL.grey[0] : PAL.grey[1], hub = dim ? PAL.grey[1] : PAL.grey[2];
  const wheel = (cx, cy, squash) => {
    for (let yy = -6; yy <= 6; yy++) for (let xx = -6; xx <= 6; xx++) { const d = Math.hypot(xx, yy * squash); if (d >= 4.3 && d <= 5.4) p.set(cx + xx, cy + yy, tyre); else if (d >= 3.4 && d < 4.3) p.set(cx + xx, cy + yy, rim); }
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [1, -1], [-1, 1]]) p.set(cx + dx, cy + dy, rim);
    p.set(cx, cy, hub); p.set(cx - 3, cy - 3, PAL.black[3]); p.set(cx - 4, cy - 2, PAL.black[3]);
  };
  wheel(x + 5, y + 10, 1); wheel(x + 25, y + 10, bent ? 1.35 : 1);
  limb(p, [x + 9, y + 3], [x + 20, y + 3], 0.8, 0.8, m); limb(p, [x + 9, y + 4], [x + 13, y + 10], 0.7, 0.7, m); limb(p, [x + 20, y + 4], [x + 14, y + 10], 0.7, 0.7, m);
  limb(p, [x + 21, y + 4], [x + 25, y + 9], 0.7, 0.7, m); limb(p, [x + 6, y + 10], [x + 13, y + 10], 0.6, 0.6, m);
  limb(p, [x + 7, y + 0.5], [x + 11, y + 0.5], 1, 1, dim ? dimRamp(PAL.black, 0.3) : PAL.black); limb(p, [x + 19, y + 0.5], [x + 23, y + 0.5], 0.9, 0.9, dim ? dimRamp(IRON, 0.3) : IRON);
  p.rect(x + 13, y + 10, x + 14, y + 11, IRON[1]); p.rect(x + 15, y + 12, x + 16, y + 12, IRON[2]);
  if (bent) { p.clear(x + 30, y + 10); p.clear(x + 30, y + 9); p.set(x + 31, y + 12, tyre); p.set(x + 32, y + 13, tyre); }
}

// On-foot convoy (48 × 28): two walkers hauling a handcart of crates (or drums and cans on a supply run).
export function paintHandcartHD(color, supply) {
  const p = painter(48, 28);
  person(p, 30, 4, { cloth: color, pack: true, arm: "none", frame: 1 });
  person(p, 4, 2, { cloth: shade(color, -0.15), pack: true, arm: "rifle", frame: 3 });
  form(p, rr(14, 12, 29, 19, 0), WOOD, 14, 12, 29, 19, { specular: true }); for (const x of [18, 23]) p.vl(x, 14, 18, WOOD[0]);
  if (supply) { form(p, rr(16, 6, 19, 11, 1), RUST, 16, 6, 19, 11, { rim: 1 }); p.hl(16, 19, 9, RUST[0]); form(p, rr(22, 6, 25, 11, 1), PAL.blue, 22, 6, 25, 11, { rim: 1 }); p.hl(22, 25, 9, PAL.blue[0]); }
  else { crate(p, 16, 6, 6, 6); crate(p, 22, 8, 6, 4, WOOD); }
  cartWheel(p, 19.5, 21.5, 3.5); limb(p, [30, 16.5], [33, 16.5], 1, 1, WOOD);
  groundShadow(p, 4, 44, 26);
  return p;
}

// Trade-route convoy (48 × 28): a pickup stacked with crates under a pennant in the route colour; a supply run carries
// drums and jerry cans under a tarp.
export function paintConvoyTruckHD(color, supply) {
  const p = painter(48, 28), m = R(color);
  pickup(p, 2, 2, color);
  if (supply) {
    for (const x of [4, 10, 16]) { const d = x === 10 ? PAL.blue : RUST; form(p, rr(x, 6, x + 5, 13, 1), d, x, 6, x + 5, 13, { specular: true }); p.hl(x, x + 5, 9, d[0]); p.hl(x, x + 5, 12, d[0]); }
    form(p, rr(4, 3, 21, 5, 1), R(shade(color, -0.1)), 4, 3, 21, 5, { rim: 1 });
    form(p, union(rr(22, 8, 25, 13, 1), rr(23, 6, 24, 7, 0)), PAL.red, 22, 6, 25, 13, { rim: 1 }); p.set(22, 11, PAL.red[0]);
  } else {
    crate(p, 4, 4, 10, 10); crate(p, 14, 8, 10, 7, WOOD); crate(p, 8, 0, 8, 5, R(shade(ASH[1], 0.1)));
    limb(p, [2.5, 0], [2.5, 15], 0.7, 0.7, STEEL); form(p, rr(3, 0, 8, 3, 0), m, 3, 0, 8, 3, { rim: 1 }); p.set(8, 3, m[0]);
  }
  return p;
}

// Recon team (32 × 28): one or two scouts, the lead glassing ahead.
export function paintScoutsHD(color, count) {
  const p = painter(32, 28);
  if (count > 1) person(p, 2, 4, { cloth: shade(color, -0.15), pack: true, hat: "cap", hatColor: shade(color, -0.4), arm: "rifle", frame: 3 });
  person(p, 16, 6, { cloth: color, pack: true, hat: "cap", hatColor: shade(color, -0.4), arm: "binoc" });
  groundShadow(p, 3, 28, 27);
  return p;
}
// Relief squad (48 × 34): armed walkers in helmets behind a banner with the red cross.
export function paintReliefHD(color, count) {
  const p = painter(48, 34);
  const slots = [[16, 10, 1], [2, 6, 3], [30, 8, 0]].slice(0, Math.max(1, Math.min(3, count))).sort((a, b) => a[1] - b[1]);
  slots.forEach(([x, y, f], i) => layer(p, (q) => person(q, x, y + 4, { cloth: i % 2 ? shade(color, -0.15) : color, pack: true, hat: "helmet", hatColor: shade(color, -0.45), arm: i === 0 ? "banner" : "raised", armColor: WHITE, frame: f })));
  { const [lx, ly] = slots[0], bx = lx + 12, by = ly + 4 - 12; p.rect(bx + 3, by + 2, bx + 4, by + 7, PAL.red[2]); p.rect(bx + 1, by + 4, bx + 6, by + 5, PAL.red[2]); p.set(bx + 3, by + 2, PAL.red[3]); p.set(bx + 1, by + 4, PAL.red[3]); }
  for (const [x, y] of slots) groundShadow(p, x, x + 10, y + 26);
  return p;
}

// ---------- a team of one ----------
export const SOLO = { w: 32, h: 36, x: 10, y: 12 }; // the grid (mapsprites.js SOLO doubled) and where the figure stands in it
function soloFigure(p, x, y, o, frame, light, gait = "") {
  const heavy = gait === "heavy", lean = heavy || frame === 1 || frame === 3 || frame === 4 ? 2 : 0;
  const opt = light === "torch" ? { ...o, arm: "torch" } : heavy ? { ...o, pack: false } : o;
  person(p, x + lean, y, { ...opt, frame, bandage: gait === "limp" });
  if (heavy) { // hunched under a big pack with a bedroll on top: the head forward and down
    const hx = x + lean, head = [];
    for (let yy = y - 4; yy <= y + 4; yy++) for (let xx = hx + 2; xx <= hx + 9; xx++) { const c = p.get(xx, yy); if (c) head.push([xx, yy, c]); p.clear(xx, yy); }
    for (const [xx, yy, c] of head) p.set(xx + 2, yy + 2, c);
    form(p, rr(hx - 4, y + 2, hx + 1, y + 13, 1), PACK_R, hx - 4, y + 2, hx + 1, y + 13, { specular: true }); p.rect(hx - 2, y + 8, hx - 1, y + 9, PACK_R[0]);
    limb(p, [hx - 5, y + 0.5], [hx + 1, y + 0.5], 1.3, 1.3, R("#a08a60"));
  }
  if (light && light !== "torch") { // a lamp in the leading hand and its beam ahead (see-through: alpha, no outline in the game)
    p.rect(x + lean + 8, y + 10, x + lean + 9, y + 11, "#f6f2d0"); p.set(x + lean + 9, y + 10, "#ffffff");
    for (let i = 1; i <= 6; i++) for (let j = 1 - Math.min(i, 4); j <= Math.min(i, 4) - 1; j++) if (!p.get(x + lean + 9 + i, y + 10 + j)) p.set(x + lean + 9 + i, y + 10 + j, i <= 2 ? "#fff3b080" : i <= 4 ? "#fff3b050" : "#fff3b030");
  }
}
export function paintSoloHD(o, frame = 0, light = "", gait = "") {
  const p = painter(SOLO.w, SOLO.h);
  soloFigure(p, SOLO.x, SOLO.y, o, frame, light, gait);
  groundShadow(p, SOLO.x - 1, SOLO.x + 12, SOLO.y + 22);
  return p;
}
export function soloLookHD(kind, color, frame) {
  const base = { cloth: color, pack: true };
  if (kind === "raid") return { ...base, arm: frame ? "rifle" : "raised" };
  if (kind === "scouts") return { ...base, hat: "cap", hatColor: shade(color, -0.4), arm: frame ? "none" : "binoc" };
  if (kind === "relief") return { ...base, hat: "helmet", hatColor: shade(color, -0.45), arm: "raised" };
  return { ...base, arm: "none" };
}

// A lone rider on a bicycle (38 × 34): frame 0 stands astride it, a foot down; 1 and 2 pedal.
export function paintCyclistHD(color, frame) {
  const p = painter(38, 34), fm = R(desat(color, 0.2)), cm = R(color);
  const bw = (cx, cy) => {
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) { const d = Math.hypot(x, y); if (d >= 5.6 && d <= 6.6) p.set(cx + x, cy + y, PAL.black[1]); else if (d >= 4.9 && d < 5.6) p.set(cx + x, cy + y, PAL.grey[0]); }
    for (const [x, y] of frame === 2 ? [[-3, -3], [3, 3], [-3, 3], [3, -3], [-4, -2], [4, 2]] : [[0, -4], [0, 4], [-4, 0], [4, 0], [0, -3], [0, 3]]) p.set(cx + x, cy + y, "#9aa0a6aa");
    p.set(cx, cy, PAL.grey[1]); p.set(cx - 1, cy, PAL.grey[3]); p.set(cx - 5, cy - 3, PAL.black[3]); p.set(cx - 4, cy - 4, PAL.black[3]); p.set(cx - 3, cy - 5, PAL.black[3]);
  };
  bw(8, 25); bw(28, 25);
  limb(p, [10, 24.5], [16, 24.5], 0.9, 0.9, fm); limb(p, [16.5, 23], [17.5, 19], 0.9, 0.9, fm); limb(p, [17, 18.5], [25, 18.5], 1, 1, fm);
  limb(p, [18.5, 20], [20.5, 23], 0.9, 0.9, fm); limb(p, [26.5, 20], [27.5, 23], 0.8, 0.8, fm);
  limb(p, [24.5, 15], [24.5, 17], 0.8, 0.8, IRON); limb(p, [24, 14.5], [27, 14.5], 0.9, 0.9, IRON); limb(p, [13, 16.5], [17, 16.5], 1.1, 1.1, PAL.black);
  // The rider, leaning over the bars: pack, the far arm, torso, head, the near arm to the bars.
  form(p, rr(12, 8, 13, 13, 0), PACK_R, 12, 8, 13, 13, { rim: 1 });
  const sh = [18.5, 10], far = elbowFor([15.5, 10], [23, 13.5], 4, 4, 1); limb(p, [15.5, 10], far[0], 1.2, 1.1, R(shade(color, -0.22))); limb(p, far[0], far[1], 1.1, 1, R(shade(color, -0.22)));
  form(p, (x, y) => (y >= 10 && y <= 15 && x >= 14 && x <= 17) || (y >= 8 && y <= 12 && x >= 15 && x <= 19 && !(y === 8 && x === 19)), cm, 14, 8, 19, 15, { specular: false });
  ellipseV(p, 21.5, 5.5, 2.3, 2.6, SKIN_R); form(p, (x, y) => ell(21.5, 5.5, 2.3, 2.6)(x, y) && (y <= 4 || (x <= 20 && y <= 6)), HAIR_R, 19, 3, 24, 6, { rim: 1 }); p.set(23, 5, "#1a1412");
  const [e, h] = elbowFor(sh, [24, 13.5], 4, 4, 1); limb(p, sh, e, 1.3, 1.2, cm); limb(p, e, h, 1.2, 1.1, cm); ellipseV(p, h[0], h[1], 1.1, 1.1, SKIN_R, { specular: false });
  // Legs from the hip (17, 16): the far leg darker; stopped, the near foot on the ground.
  const hip = [17, 16], pn = PANTS_R, pf = R(shade(PANTS, -0.22));
  const legTo = (knee, foot, m) => { limb(p, hip, knee, 1.5, 1.3, m); limb(p, knee, foot, 1.3, 1.1, m); bootAt(p, Math.round(foot[0]) - 1, Math.round(foot[1])); };
  if (frame === 0) { legTo([16.5, 20], [19, 23], pf); legTo([21, 21], [23, 30], pn); }
  else {
    p.rect(18, 24, 19, 25, IRON[1]);
    const up = [[21, 17.5], [23, 20.5]], down = [[16.5, 20.5], [19, 27]];
    legTo(...(frame === 1 ? down : up), pf); legTo(...(frame === 1 ? up : down), pn);
  }
  groundShadow(p, 3, 33, 32);
  return p;
}

// ---------- other groups' vehicles ----------
export function paintRaiderTruckHD(c) {
  const p = painter(48, 26);
  pickup(p, 0, 0, c);
  for (const [x0, x1] of [[6, 13], [16, 21], [26, 33]]) form(p, rr(x0, 14, x1, 17, 0), RUST, x0, 14, x1, 17, { rim: 1 });     // scrap plates along the flank
  for (let x = 2; x <= 23; x += 6) limb(p, [x + 0.5, 4.5], [x + 0.5, 11], 0.9, 0.9, STEEL);
  limb(p, [2.5, 4.5], [23.5, 4.5], 0.9, 0.9, STEEL);                                                                         // the pipe cage
  form(p, rr(10, 8, 17, 11, 1), PAL.leather, 10, 8, 17, 11, { rim: 1 });                                                   // a load in the bed
  ellipseV(p, 29.5, 8.5, 1.8, 2.4, SKIN_R, { specular: false }); limb(p, [29, 3.5], [30, 6.5], 0.8, 1, R(c === RED ? GOLD[2] : RED)); p.set(31, 8, "#1a1412"); // the mohawk at the wheel
  for (const y of [12.5, 16.5]) limb(p, [42, y], [47, y], 1, 0.4, BONE);                                                      // the spikes on the front
  p.rect(42, 14, 45, 15, STEEL[1]);
  return p;
}
function humvee(p, c) {
  const m = R(OLIVE), cm = R(c);
  form(p, union(rr(2, 12, 43, 21, 1), rr(12, 6, 33, 12, 2), rr(34, 10, 43, 13, 1)), m, 2, 6, 43, 21, { specular: true });
  glass(p, 26, 8, 33, 11); p.set(26, 8, m[1]); glass(p, 16, 8, 23, 11, { dark: true }); p.vl(24, 8, 12, m[0]); p.vl(34, 11, 16, m[0]);
  p.rect(42, 16, 43, 17, LAMP[1]); p.set(42, 16, LAMP[2]);
  form(p, rr(18, 2, 23, 5, 1), m, 18, 2, 23, 5, { rim: 1 }); limb(p, [22, 2.5], [33, 2.5], 0.9, 0.7, IRON); p.set(16, 4, m[0]); p.set(17, 4, m[0]); // the roof gun
  limb(p, [6.5, 0], [6.5, 11], 0.6, 0.6, STEEL); form(p, rr(7, 0, 13, 3, 0), cm, 7, 0, 13, 3, { rim: 1 });                     // the antenna pennant
  p.rect(8, 16, 11, 17, cm[1]); p.set(8, 16, cm[2]);
  arch(p, 6, 18, 5, m[0]); arch(p, 30, 18, 5, m[0]); bigWheel(p, 6, 18, 5); bigWheel(p, 30, 18, 5);
  groundShadow(p, 3, 43, 27);
}
export function paintHumveeHD(c) { const p = painter(48, 28); humvee(p, c); return p; }
function mrap(p, c) {
  const m = R(OLIVE), cm = R(c);
  form(p, union(rr(2, 8, 45, 23, 2), rr(6, 22, 41, 25, 2)), m, 2, 8, 45, 25, { specular: true });
  p.hl(6, 41, 23, m[0]);                                                                   // the V hull's crease
  for (const x of [8, 14, 20, 26, 32, 38]) p.set(x, 19, m[0]);                             // bolts along the flank
  glass(p, 30, 10, 37, 15, { dark: true }); glass(p, 39, 12, 43, 15, { dark: true }); p.vl(38, 10, 15, m[0]);
  form(p, rr(14, 4, 23, 7, 1), m, 14, 4, 23, 7, { rim: 1 }); limb(p, [22, 4.5], [35, 4.5], 0.9, 0.7, IRON); p.set(12, 6, m[0]); p.set(13, 6, m[0]);
  limb(p, [6.5, 0], [6.5, 7], 0.6, 0.6, STEEL); form(p, rr(7, 0, 13, 3, 0), cm, 7, 0, 13, 3, { rim: 1 });
  p.rect(44, 18, 45, 19, LAMP[1]); p.set(44, 18, LAMP[2]);
  arch(p, 6, 22, 5, m[0]); arch(p, 32, 22, 5, m[0]); bigWheel(p, 6, 22, 5); bigWheel(p, 32, 22, 5);
  groundShadow(p, 3, 45, 31);
}
export function paintMrapHD(c) { const p = painter(48, 32); mrap(p, c); return p; }

// Armored truck (48 × 32): a riveted steel box with slit windows and a big banner on a pole.
export function paintArmoredTruckHD(c) {
  const p = painter(48, 32), cm = R(c), m = PAL.grey;
  limb(p, [4.5, 2], [4.5, 15], 0.8, 0.8, ASH); form(p, rr(6, 2, 19, 11, 0), cm, 6, 2, 19, 11, { rim: 1 }); p.rect(10, 4, 15, 8, PAL.white[2]); p.rect(12, 4, 13, 8, cm[1]);
  form(p, union(rr(2, 12, 43, 25, 1), rr(30, 8, 43, 12, 1)), m, 2, 8, 43, 25, { specular: true });
  for (let x = 6; x <= 39; x += 8) for (const y of [15, 22]) { p.set(x, y, m[3]); p.set(x + 1, y, m[0]); }                    // rivets
  p.hl(2, 43, 18, m[0]); p.hl(2, 43, 19, m[2]);                                                                            // a plate seam
  form(p, rr(34, 10, 41, 11, 0), [IRON[0], IRON[0], IRON[1], IRON[1]], 34, 10, 41, 11, { flat: true }); p.set(34, 10, IRON[2]);  // the slit window
  form(p, rr(10, 18, 25, 21, 0), cm, 10, 18, 25, 21, { rim: 1 });
  form(p, rr(44, 18, 47, 23, 1), IRON, 44, 18, 47, 23, { rim: 1 }); p.rect(44, 20, 45, 21, LAMP[1]);
  for (const wx of [6, 18, 32]) { arch(p, wx, 24, 4, m[0]); wheel(p, wx, 24); }
  groundShadow(p, 3, 43, 31);
  return p;
}

// Trader caravan (52 × 28): a covered wagon with a stripe in the group's colour, pulled by a mule.
export function paintWagonHD(c) {
  const p = painter(52, 28), cv = R("#e2dccb"), cm = R(c), mule = R("#7a5a40");
  form(p, (x, y) => y >= 4 && y <= 15 && x >= 4 && x <= 28 && (y >= 10 || Math.abs(x - 16) <= 8 + (y - 4) * 0.75), cv, 4, 4, 28, 15, { specular: true });
  for (let x = 8; x <= 24; x += 8) p.vl(x, 6, 15, cv[0]);                                                                   // the hoops
  p.hl(4, 28, 10, cm[1]); p.hl(4, 28, 11, cm[0]); p.set(5, 10, cm[2]);                                                     // the stripe
  form(p, rr(2, 16, 30, 19, 0), WOOD, 2, 16, 30, 19, { specular: true }); crate(p, 0, 10, 6, 6);
  for (const wx of [4, 20]) cartWheel(p, wx + 4.5, 22.5, 4.5);
  limb(p, [31, 17], [36, 17], 1, 1, WOOD);                                                                                  // the shaft
  ellipseV(p, 41.5, 15.5, 6, 3.8, mule, { specular: false });                                                               // the mule's barrel
  limb(p, [45.5, 13.5], [48, 10], 2, 1.6, mule); ellipseV(p, 49, 9.5, 2.2, 2.1, mule, { specular: false }); limb(p, [50, 10.5], [51, 12.5], 1.3, 1, mule);  // neck, head, muzzle
  limb(p, [47.5, 7.5], [47, 5.5], 0.8, 0.5, mule); limb(p, [49.5, 7.5], [50, 5.5], 0.8, 0.5, mule); p.set(50, 9, "#1a1412"); p.set(51, 12, "#1a1412");  // ears, the eye, the nostril
  for (const [lx, far] of [[38, true], [44, true], [39.5, false], [45.5, false]]) limb(p, [lx, 18], [lx + (far ? -0.5 : 0.5), 26.5], 1.3, 1, far ? dimRamp(mule, 0.25) : mule);
  limb(p, [36, 14], [34, 21], 0.8, 0.5, dimRamp(mule, 0.2));                                                                  // the tail
  form(p, rr(38, 12, 43, 15, 1), cm, 38, 12, 43, 15, { rim: 1 });                                                           // the saddle blanket
  groundShadow(p, 3, 48, 27);
  return p;
}

// Commune tractor (52 × 28) hauling a wagon of hay and produce.
export function paintTractorHD(c) {
  const p = painter(52, 28), hay = R(HAY), cm = R(c);
  form(p, rr(0, 12, 23, 19, 0), WOOD, 0, 12, 23, 19, { specular: true }); for (const x of [6, 12, 18]) p.vl(x, 14, 18, WOOD[0]);
  form(p, union(rr(2, 4, 13, 11, 2), rr(14, 8, 21, 11, 1)), hay, 2, 4, 21, 11, { specular: true });
  for (const [x, y] of [[5, 7], [9, 9], [7, 6], [16, 10], [11, 8]]) p.set(x, y, hay[0]);
  ellipseV(p, 16.5, 6.5, 1.2, 1.2, PAL.red, { specular: false }); ellipseV(p, 19, 6.5, 1.2, 1.2, PAL.green, { specular: false }); ellipseV(p, 21, 7, 1, 1, PAL.orange, { specular: false });
  arch(p, 4, 18, 4, WOOD[0]); arch(p, 14, 18, 4, WOOD[0]); wheel(p, 4, 18); wheel(p, 14, 18); limb(p, [24, 16.5], [27, 16.5], 1, 1, STEEL);
  // The tractor.
  form(p, union(rr(28, 10, 47, 19, 1), rr(28, 2, 35, 11, 1)), cm, 28, 2, 47, 19, { specular: true });
  glass(p, 30, 4, 35, 9); p.set(30, 4, cm[1]); form(p, rr(26, 0, 37, 1, 0), cm, 26, 0, 37, 1, { rim: 1 });
  limb(p, [42.5, 3], [42.5, 9], 0.9, 0.9, IRON); p.set(42, 2, SMOKE_FAINT); p.set(43, 1, SMOKE_FAINT); p.set(42, 0, SMOKE_FAINT);
  form(p, rr(44, 14, 47, 17, 0), IRON, 44, 14, 47, 17, { rim: 1 });                                                        // the grille
  bigWheel(p, 26, 16, 6); wheel(p, 42, 20, 4); groundShadow(p, 2, 47, 27);
  return p;
}

// Zealot procession cart (48 × 32): a pale cart under a tall banner with the sun sign, torches at the corners, a robed
// figure walking beside it.
export function paintZealotCartHD(c) {
  const p = painter(48, 32), cm = R(c), cart = R("#d8cfb8");
  limb(p, [18.5, 0], [18.5, 19], 0.9, 0.9, WOOD);
  form(p, rr(20, 0, 31, 11, 0), cm, 20, 0, 31, 11, { rim: 1 });
  ellipseV(p, 25.5, 5.5, 2, 2, GOLD, { specular: true }); for (const [x, y] of [[23, 3], [28, 3], [23, 8], [28, 8], [22, 5.5], [29, 5.5], [25.5, 2], [25.5, 9]]) p.set(Math.round(x), Math.round(y), mix(cm[1], GOLD[2], 0.6));
  form(p, rr(4, 16, 35, 23, 1), cart, 4, 16, 35, 23, { specular: true });
  for (let x = 8; x <= 32; x += 8) p.rect(x, 19, x + 1, 20, cm[1]);
  for (const wx of [6, 24]) cartWheel(p, wx + 3.5, 26.5, 3.5);
  for (const tx of [4.5, 34.5]) { limb(p, [tx, 10], [tx, 16], 0.9, 0.9, WOOD); ellipseV(p, tx, 7, 1.6, 2.4, FIRE, { specular: false }); p.set(Math.floor(tx), 6, FIRE[3]); p.set(Math.floor(tx) + 2, 7, GLOW); p.set(Math.floor(tx) - 1, 8, GLOW); p.set(Math.floor(tx), 4, GLOW); }
  person(p, 36, 8, { cloth: shade(c, -0.2), hat: "hood", robe: true, arm: "none", frame: 1 });
  limb(p, [36, 20.5], [39, 20.5], 1, 1, WOOD);
  groundShadow(p, 5, 44, 30);
  return p;
}

// Fortress supply truck (48 × 28): a box truck in the group's colour with a shield crest and sandbags on the roof.
export function paintFortressTruckHD(c) {
  const p = painter(48, 28), sm = R(shade(STONE, -0.05)), cm = R(c), sb = R(SAND);
  form(p, rr(2, 4, 29, 21, 1), sm, 2, 4, 29, 21, { specular: true });
  for (let y = 8; y <= 19; y += 4) for (let x = 4 + (y % 8 ? 0 : 4); x <= 27; x += 8) { p.rect(x, y, x + 1, y, sm[0]); p.set(x, y + 1, sm[2]); }   // rivets
  form(p, (x, y) => x >= 12 && x <= 19 && y >= 6 && y <= 17 && !(y > 13 && Math.abs(x - 15.5) > 3.5 - (y - 13) * 0.9), cm, 12, 6, 19, 17, { specular: true });   // the crest
  form(p, rr(14, 8, 17, 13, 0), GOLD, 14, 8, 17, 13, { rim: 1 });
  for (const x of [4, 18]) limb(p, [x + 1, 1.5], [x + 7, 1.5], 1.6, 1.6, sb);                                                 // sandbags
  form(p, union(rr(30, 8, 41, 21, 1), rr(42, 14, 45, 21, 1)), cm, 30, 8, 45, 21, { specular: true }); glass(p, 34, 10, 41, 15); p.set(34, 10, cm[1]);
  p.rect(44, 16, 45, 17, LAMP[1]); p.set(44, 16, LAMP[2]); limb(p, [43, 20.5], [46, 20.5], 1, 1, STEEL);
  for (const wx of [6, 18, 32]) { arch(p, wx, 20, 4, sm[0]); wheel(p, wx, 20); }
  groundShadow(p, 3, 45, 27);
  return p;
}

// Army cargo truck (48 × 28): a tall square cab, a canvas-covered bed on six wheels, olive drab with a white star;
// `color` tints the canvas a little. burnt: black and rusted, the canvas gone to ribs; wrecked: faded, a flat.
export function paintMilTruckHD(color = OLIVE, cond = "intact") {
  const p = painter(48, 28);
  const m = R(cond === "burnt" ? "#2b2723" : cond === "wrecked" ? "#55583e" : OLIVE);
  const canvas = cond === "burnt" ? null : R(cond === "wrecked" ? "#7a7458" : mix(CANVAS, color, 0.15));
  form(p, union(rr(2, 16, 45, 21, 1), rr(32, 6, 43, 15, 1), rr(44, 12, 47, 17, 1)), m, 2, 6, 47, 21, { specular: true });
  if (canvas) {
    form(p, rr(2, 4, 29, 15, 1), canvas, 2, 4, 29, 15, { specular: true });
    for (const x of [8, 16, 24]) p.vl(x, 6, 15, canvas[0]);
    p.hl(3, 28, 12, canvas[0]); for (let x = 3; x <= 28; x += 4) p.set(x, 12, ASH[2]);                                        // the tie-down rope
  } else { for (const x of [2.5, 10.5, 18.5, 26.5]) limb(p, [x, 4.5], [x, 15], 0.9, 0.9, R("#3a2e26")); limb(p, [2.5, 4.5], [29.5, 4.5], 0.9, 0.9, R("#3a2e26")); }
  if (cond === "burnt") p.rect(36, 8, 43, 11, "#1a1a1a"); else { glass(p, 36, 8, 43, 11); p.set(36, 8, m[1]); }
  p.rect(46, 14, 47, 15, cond === "burnt" ? "#1a1a1a" : LAMP[1]); if (cond !== "burnt") p.set(46, 14, LAMP[2]);
  limb(p, [45, 20.5], [47, 20.5], 1, 1, STEEL);
  if (cond !== "burnt") star(p, 33, 17, PAL.white[2]);
  for (const wx of [4, 14, 34]) { arch(p, wx, 20, 4, m[0]); wheel(p, wx, 20); }
  if (cond === "wrecked") { p.rect(13, 26, 21, 27, TYRE[1]); p.clear(16, 24); p.clear(17, 24); p.hl(15, 20, 25, TYRE[1]); }
  if (cond === "burnt") { p.set(20, 2, SMOKE_FAINT); p.set(22, 1, SMOKE_FAINT); p.set(21, 0, SMOKE_FAINT); p.rect(12, 7, 13, 8, RUST[1]); p.rect(38, 13, 39, 14, RUST[1]); }
  groundShadow(p, 3, 45, 27);
  return p;
}

// ---------- the armour overlay (sim/vehicles.js upgrades) ----------
const PLATE = PAL.grey, SCRAP_A = RUST[1], SCRAP_B = "#5f6158", BGLASS = ["#3e6b60", "#7fb3a6", "#a8d2c6", "#dff2ea"], MESH = "#3e4044";
const ARMOUR_AT = { // the game's bands doubled: band along the body, band2 up the cab, roof: where the gun ring sits
  truck: { band: [2, 41, 14, 17], band2: [24, 27, 6, 13], roof: [26, 2] },
  sedan: { band: [2, 41, 12, 15], band2: [10, 11, 6, 11], roof: [18, 2] },
  miltruck: { band: [2, 45, 16, 19], band2: [32, 35, 8, 15], roof: [34, 4] },
};
const GLASSY = new Set([...GLASS, mix(GLASS[0], GLASS[1], 0.5)]);
export function armourOverlayHD(p, kind, code) {
  const A = ARMOUR_AT[kind];
  if (!A || !code) return p;
  const n = (k) => Number(code[code.indexOf(k) + 1]) || 0;
  const gun = code.slice(code.indexOf("t") + 1);
  const keep = (c) => !c || TYRE.includes(c) || RIM.includes(c) || GLASSY.has(c) || LAMP.includes(c) || TAIL.includes(c) || c === SHADOW || STEEL.includes(c) || IRON.includes(c);
  const plate = ([x0, x1, y0, y1], scrap) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (keep(p.get(x, y))) continue;
      if (scrap) p.set(x, y, ((x >> 2) + (y >> 1)) % 2 ? SCRAP_A : SCRAP_B);
      else p.set(x, y, y === y0 ? PLATE[2] : y === y1 ? PLATE[0] : x % 8 === 0 && y === y0 + 1 ? PLATE[3] : x % 8 === 1 && y === y0 + 1 ? PLATE[0] : x % 8 === 7 ? PLATE[0] : PLATE[1]);
    }
    if (scrap) for (let x = x0; x <= x1; x += 4) if (!keep(p.get(x, y0))) p.set(x, y0, RUST[2]);
  };
  if (n("s")) plate(A.band, true);
  if (n("p")) { plate(A.band, false); if (n("p") > 1) plate(A.band2, false); }
  if (n("m") || n("g")) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.get(x, y);
    if (!GLASSY.has(c)) continue;
    const i = Math.max(0, GLASS.indexOf(c));
    p.set(x, y, n("m") ? ((x + y) % 2 ? MESH : c === GLASS[3] ? GLASS[2] : c) : BGLASS[i]);
  }
  if (gun) {
    const [x, y] = A.roof;
    form(p, rr(x, y, x + 3, y + 1, 0), PLATE, x, y, x + 3, y + 1, { rim: 1 }); p.rect(x, y - 2, x + 1, y - 1, PLATE[0]); p.set(x, y - 2, PLATE[1]);  // the ring and the gunner's shield
    limb(p, [x + 2, y - 1.5], [x + 3 + (gun === "m2hb" ? 14 : 10), y - 1.5], 1, 0.8, IRON);                                         // the barrel, forward
  }
  return p;
}

// ---------- other groups' people, outsiders ----------
function groupLook(type, c, i, raid) {
  switch (type) {
    case "raider": return { cloth: i % 2 ? "#3a3028" : shade(c, -0.25), hat: "mohawk", hatColor: c, band: c, arm: raid ? "raised" : "rifle", pants: "#2a2a30" };
    case "military": return { cloth: OLIVE, pants: OLIVE_DK, hat: "helmet", hatColor: shade(OLIVE, -0.15), band: c, arm: i === 0 && !raid ? "banner" : "rifle", armColor: c, pack: !raid };
    case "zealot": return { cloth: i === 0 ? shade(c, -0.1) : "#cfc7b4", hat: "hood", hatColor: shade(c, -0.25), robe: true, arm: i === 0 ? "banner" : i === 1 ? "torch" : raid ? "raised" : "none", armColor: c };
    case "expansionist": return { cloth: "#5a6068", pants: "#3a3e44", hat: "helmet", hatColor: c, band: c, arm: i === 0 ? "banner" : raid ? "shield" : "rifle", armColor: c, pack: !raid };
    case "traders": return { cloth: i % 2 ? "#8a7a5a" : shade(c, -0.15), hat: "cap", hatColor: c, pack: true, arm: i === 0 ? "rifle" : "none" };
    case "commune": return { cloth: i % 2 ? "#6a7a9a" : shade(c, -0.1), pants: "#4a5a7a", hat: "straw", arm: i % 2 ? "fork" : raid ? "raised" : "fork", pack: !raid };
    default: return { cloth: shade(c, -0.1), hat: "helmet", hatColor: STONE, arm: i === 0 ? "spear" : "shield", armColor: c };
  }
}
// Motorbike with a rider, 22 wide and 22 tall, top-left at (x, y): the rider's head at the top, the wheels on the bottom row.
function biker(p, x, y, color, hair) {
  const cm = R(color), j = R("#3a3028"), hm = R(hair);
  for (const wx of [x, x + 15]) { ellipseV(p, wx + 3, y + 18.5, 3.5, 3.5, TYRE, { specular: false }); ellipseV(p, wx + 3, y + 18.5, 1.4, 1.4, RIM, { specular: false }); p.set(wx + 3, y + 18, RIM[0]); }
  form(p, rr(x + 6, y + 15, x + 14, y + 18, 1), IRON, x + 6, y + 15, x + 14, y + 18, { rim: 1 }); ellipseV(p, x + 9, y + 16.5, 1.4, 1.2, STEEL, { specular: false });   // the engine
  limb(p, [x + 2, y + 19.5], [x + 9, y + 19.5], 0.8, 0.8, STEEL);                                                                                            // exhaust
  form(p, rr(x + 7, y + 12, x + 13, y + 14, 1), cm, x + 7, y + 12, x + 13, y + 14, { specular: true });                                                      // the tank
  limb(p, [x + 3, y + 12.5], [x + 6, y + 12.5], 1.1, 1.1, PAL.black);                                                                                        // seat
  limb(p, [x + 15, y + 12], [x + 17, y + 16], 0.8, 0.8, STEEL); limb(p, [x + 15.5, y + 9], [x + 15.5, y + 11.5], 0.8, 0.8, STEEL); limb(p, [x + 15, y + 9], [x + 18, y + 9], 0.7, 0.7, STEEL);  // fork and bars
  form(p, (xx, yy) => yy >= y + 4 && yy <= y + 11 && xx >= x + 5 + (yy > y + 8 ? 1 : 0) && xx <= x + 10 + (yy < y + 7 ? 0 : 1) && !(yy === y + 4 && (xx === x + 5 || xx === x + 10)), j, x + 5, y + 4, x + 11, y + 11); // the jacket, leaning forward
  const [e, h] = elbowFor([x + 10, y + 5.5], [x + 15.5, y + 9.5], 4, 4, -1); limb(p, [x + 10, y + 5.5], e, 1.3, 1.2, j); limb(p, e, h, 1.2, 1.1, j); ellipseV(p, h[0], h[1], 1.1, 1.1, SKIN_R, { specular: false });
  ellipseV(p, x + 9.5, y + 2.5, 2.3, 2.6, SKIN_R); p.set(x + 11, y + 2, "#1a1412"); p.hl(x + 8, x + 10, y + 4, SKIN_R[0]);
  limb(p, [x + 8.5, y - 3], [x + 9.5, y + 0.5], 0.9, 1.1, hm);                                                                                               // the mohawk
  limb(p, [x + 9, y + 11.5], [x + 10, y + 14.5], 1.4, 1.2, PANTS_R); limb(p, [x + 10, y + 14.5], [x + 11, y + 16.5], 1.2, 1.1, PANTS_R); bootAt(p, x + 10, y + 16);     // leg and boot
}
// A stuffed burlap sack with a pipe and a can sticking out (group scavengers' haul).
function lootSack(p, x, y) {
  const s = R("#9a8358");
  form(p, union(rr(x + 2, y + 4, x + 9, y + 15, 2), rr(x, y + 8, x + 11, y + 17, 2)), s, x, y + 4, x + 11, y + 17, { specular: true });
  p.rect(x + 4, y + 2, x + 7, y + 3, s[0]);
  limb(p, [x + 8.5, y - 5], [x + 8.5, y + 3], 0.9, 0.9, STEEL);
  form(p, rr(x + 2, y - 2, x + 5, y + 1, 0), RUST, x + 2, y - 2, x + 5, y + 1, { rim: 1 });
}
// The people a group sends on foot (48 × 34; 52 × 34 for a raider raid with its biker). kind: "raid" | "walk" | "scav".
export function paintGroupWalkersHD(type, c, n, kind) {
  const raid = kind === "raid", scav = kind === "scav";
  const p = painter(type === "raider" && raid ? 52 : 48, 34);
  const slots = (scav ? [[12, 10], [0, 6], [24, 8]] : type === "traders" && !raid ? [[2, 8], [14, 6]] : [[16, 10], [2, 6], [30, 8], [38, 12]]).slice(0, Math.max(1, Math.min(scav ? 3 : 4, n))).sort((a, b) => a[1] - b[1]);
  const look = (i) => groupLook(type, c, i, raid);
  const frames = [1, 3, 0, 1];
  if (type === "raider" && raid) { biker(p, 30, 12, c, c); slots.splice(2); }
  if (scav) {
    slots.forEach(([x, y], i) => layer(p, (q) => person(q, x, y + 4, { ...look(i), pack: true, arm: i === 0 ? "bar" : look(i).arm === "banner" ? "rifle" : look(i).arm, frame: frames[i] })));
    lootSack(p, 36, 16);
    for (const [x, y] of slots) groundShadow(p, x, x + 10, y + 26);
    return p;
  }
  if (type === "traders" && !raid) {                                                       // a pack mule with the walkers
    const mule = R("#7a5a40");
    ellipseV(p, 34.5, 22.5, 7, 3.6, mule, { specular: false });
    limb(p, [40, 21], [43, 15.5], 2.2, 1.8, mule); ellipseV(p, 44.5, 17, 2.4, 2, mule, { specular: false }); limb(p, [45.5, 17.5], [46.5, 19], 1.2, 1, mule);
    limb(p, [42, 13.5], [41.5, 11.5], 0.8, 0.5, mule); limb(p, [43.5, 14], [44, 12], 0.8, 0.5, mule); p.set(44, 16, "#1a1412");
    for (const [lx, far] of [[30, true], [37, true], [31.5, false], [38.5, false]]) limb(p, [lx, 25], [lx + (far ? -0.5 : 0.5), 32.5], 1.3, 1, far ? dimRamp(mule, 0.25) : mule);
    limb(p, [28, 21], [26, 25], 0.8, 0.5, dimRamp(mule, 0.2));
    form(p, rr(30, 16, 39, 20, 1), R("#8c7a52"), 30, 16, 39, 20, { specular: true }); p.rect(34, 18, 35, 24, c);
    groundShadow(p, 27, 45, 33);
    slots.splice(2);
  }
  slots.forEach(([x, y], i) => layer(p, (q) => person(q, x, y + 4, { ...look(i), frame: frames[i] })));
  for (const [x, y] of slots) groundShadow(p, x, x + 10, y + 26);
  return p;
}
export function paintGroupPartyHD(type, kind, c, n) {
  if (kind !== "convoy") return paintGroupWalkersHD(type, c, n, kind);
  switch (type) {
    case "raider": return paintRaiderTruckHD(c);
    case "military": return paintHumveeHD(c);
    case "expansionist": return paintArmoredTruckHD(c);
    case "traders": return paintWagonHD(c);
    case "commune": return paintTractorHD(c);
    case "zealot": return paintZealotCartHD(c);
    default: return paintFortressTruckHD(c);
  }
}

// Raiders from outside the state (66 × 38, 56 × 38 for one or two): dark red rags and hoods, a biker and walkers with
// weapons up under a ragged black-and-red banner with a skull.
export function paintOutsiderRaidersHD(n) {
  const p = painter(n >= 3 ? 66 : 56, 38), rm = R(OUT_RED), bk = R("#1a1414");
  limb(p, [2.5, 0], [2.5, 27], 0.9, 0.9, WOOD);
  form(p, (x, y) => x >= 4 && x <= 15 && y >= 0 && y <= 7 && !(y === 7 && (x === 14 || x === 15)) && !(y === 6 && x === 15), bk, 4, 0, 15, 7, { rim: 1 }); p.rect(4, 6, 15, 7, rm[1]); p.set(4, 6, rm[2]); p.clear(14, 7); p.clear(15, 7); p.clear(15, 6); p.set(9, 8, rm[0]); p.set(12, 8, rm[0]);
  ellipseV(p, 9.5, 3, 2, 1.8, BONE, { specular: false }); p.set(9, 3, bk[0]); p.set(11, 3, bk[0]); p.rect(9, 5, 10, 5, BONE[1]);   // the skull sign
  biker(p, 32, 14, OUT_RED, "#1a1a1a");
  const slots = [[6, 12], [18, 8], [54, 10]].slice(0, Math.max(1, Math.min(3, n)));
  slots.forEach(([x, y], i) => layer(p, (q) => person(q, x, y + 4, { cloth: i % 2 ? "#2c2420" : shade(OUT_RED, -0.2), hat: "hood", hatColor: shade(OUT_RED, -0.35), band: "#c03030", arm: i === 1 ? "rifle" : "raised", pants: "#24222a", frame: [3, 1, 1][i] })));
  for (const [x, y] of slots) groundShadow(p, x, x + 10, y + 26);
  groundShadow(p, 33, 52, 35);
  return p;
}
function wagonAndOxen(p) {
  const ox = R("#6a4a34"), g = R(OUT_GOLD);
  for (const x0 of [48, 58]) {
    ellipseV(p, x0 + 6, 20, 6.5, 4.2, ox, { specular: false }); limb(p, [x0 + 10, 17], [x0 + 12, 12.5], 2.4, 2, ox); ellipseV(p, x0 + 12.5, 14.5, 2.4, 2.4, ox, { specular: false }); limb(p, [x0 + 13.5, 16], [x0 + 14.5, 18.5], 1.4, 1.2, ox);
    limb(p, [x0 + 13, 11.5], [x0 + 15, 9.5], 0.9, 0.5, BONE); limb(p, [x0 + 10, 11.5], [x0 + 8.5, 9.5], 0.9, 0.5, BONE); p.set(x0 + 13, 14, "#1a1412");
    for (const [lx, far] of [[x0 + 1.5, true], [x0 + 8.5, true], [x0 + 3, false], [x0 + 10, false]]) limb(p, [lx, 23], [lx + (far ? -0.5 : 0.5), 29], 1.5, 1.2, far ? dimRamp(ox, 0.25) : ox);
  }
  limb(p, [44, 18.5], [49, 18.5], 1, 1, WOOD); limb(p, [52, 14.5], [63, 14.5], 1, 1, ASH);                                   // shaft and yoke
  form(p, (x, y) => y >= 2 && y <= 17 && x >= 4 && x <= 40 && (y >= 8 || Math.abs(x - 22) <= 14 + (y - 2) * 0.75), g, 4, 2, 40, 17, { specular: true });
  for (let x = 10; x <= 34; x += 8) p.vl(x, 4, 15, g[0]);
  p.hl(4, 40, 10, "#9a3a28"); p.hl(4, 40, 11, "#7a2a1a");                                                                    // the red stripe
  form(p, rr(2, 18, 42, 21, 0), WOOD, 2, 18, 42, 21, { specular: true }); crate(p, 0, 12, 6, 6);
  for (const wx of [6, 30]) cartWheel(p, wx + 4.5, 24.5, 4.5);
  limb(p, [42.5, 4], [42.5, 13], 0.7, 0.7, STEEL); ellipseV(p, 44.5, 5.5, 1.4, 2, FIRE, { specular: false }); p.set(44, 5, FIRE[3]); p.set(46, 5, GLOW); p.set(43, 3, GLOW);  // the lantern pole
  groundShadow(p, 3, 70, 29);
}
// Merchants (88 × 34): a big covered wagon in gold canvas behind two oxen, a guard walking ahead. With an escort
// (124 × 36): a pickup behind, or a Humvee or an MRAP leading it, and a soldier beside.
export function paintOutsiderMerchantsHD(tier = "", vehicle = "") {
  if (tier === "armed" || tier === "armoured") {
    const p = painter(124, 36);
    wagonAndOxen(shifted(p, 52, 2));
    if (vehicle === "mrap") mrap(p, OUT_GOLD);
    else if (vehicle === "hummer") humvee(shifted(p, 0, 6), OUT_GOLD);
    else pickup(p, 2, 8, "#5a5a52");
    if (tier === "armoured") person(p, 114, 10, { cloth: "#4d5440", pants: "#34363c", hat: "helmet", hatColor: "#3a4030", arm: "rifle", frame: 1 });
    return p;
  }
  const p = painter(88, 34);
  wagonAndOxen(p);
  person(p, 76, 6, { cloth: "#6a5a3a", pants: "#34363c", hat: "cap", hatColor: "#4a3a2a", arm: "rifle", frame: 3 });
  groundShadow(p, 75, 86, 32);
  return p;
}
// Travellers (44 × 34; refugees 56 × 34 with a handcart): grey walkers with bedrolls; scouts glass ahead, wanderers
// lean on a staff.
export function paintOutsiderTravellersHD(sub, n) {
  const p = painter(sub === "refugees" ? 56 : 44, 34);
  const cloth = (i) => (i % 2 ? "#6e6a60" : OUT_GRAY);
  if (sub === "refugees") {
    form(p, rr(34, 18, 51, 25, 0), WOOD, 34, 18, 51, 25, { specular: true });
    form(p, rr(36, 10, 43, 17, 2), R("#8a7a6a"), 36, 10, 43, 17, { specular: true }); form(p, rr(44, 12, 49, 17, 1), R("#6a7a8a"), 44, 12, 49, 17, { rim: 1 }); limb(p, [38, 8.5], [41, 8.5], 1, 1, R("#b0a080"));
    cartWheel(p, 40.5, 28.5, 3); limb(p, [28, 20.5], [33, 20.5], 1, 1, WOOD);
    groundShadow(p, 34, 52, 32);
  }
  const slots = (sub === "refugees" ? [[18, 8], [4, 10], [10, 6]] : [[16, 8], [2, 6], [28, 10]]).slice(0, Math.max(1, Math.min(3, n))).sort((a, b) => a[1] - b[1]);
  slots.forEach(([x, y], i) => layer(p, (q) => {
    const arm = sub === "scouts" && i === 0 ? "binoc" : sub === "scouts" ? "rifle" : sub === "wanderers" ? "staff" : "none";
    person(q, x, y + 4, { cloth: cloth(i), pants: "#4a4840", hat: sub === "wanderers" && i === 0 ? "straw" : "cap", hatColor: "#5a5850", pack: true, arm, frame: [1, 3, 1][i] });
    bedroll(q, x, y + 4);
  }));
  for (const [x, y] of slots) groundShadow(p, x, x + 10, y + 26);
  return p;
}

// ---------- the dead: hordes, herds, hives ----------
const ZSKIN = { rotten: ["#8ea36b", "#7f9a62", "#9aa877"], ashen: ["#a7a69b", "#8f8e86", "#b5b2a5"], pale: ["#9fb0b5", "#8fa3aa", "#b4c2c4"], burnt: ["#6b5446", "#5c463a", "#7a6152"] };
const ZRAGS = ["#56606e", "#6a4a3a", "#55603f", "#6d6f73", "#7a3b32", "#45454a", "#8a7a5a", "#45606b"];
const ZEYES = { glow: "#e8e07a", red: "#e2412f", dead: null };
// One shambling zombie, 14 wide and 22 tall at (x, y), reaching to the right with both arms (straight out from the
// shoulders: anatomical length, a third of its height); i varies the pose; dim: a back row, darker and a little shorter.
function shambler(p, x, y, skin, rag, eye, i, dim = 0) {
  const k = (m) => (dim ? dimRamp(m, dim) : m);
  const sk = k(skinRamp(skin)), rg = k(R(rag)), pt = k(R(shade(rag, -0.45))), ptF = k(R(shade(rag, -0.6)));
  const lean = i % 3 === 1 ? 1 : 0, short = dim ? 2 : 0, cx = x + 4.5;
  // Shuffling legs: the far one dragged behind, the near one bent.
  limb(p, [x + 3, y + 14], [x + 2, y + 17.5], 1.3, 1.2, ptF); limb(p, [x + 2, y + 17.5], [x + 1.5, y + 20 - short], 1.2, 1, ptF); bootAt(p, x, y + 20 - short, k(PAL.black));
  limb(p, [x + 6, y + 14], [x + 6.5, y + 17.5], 1.4, 1.2, pt); limb(p, [x + 6.5, y + 17.5], [x + 7, y + 20 - short], 1.2, 1, pt); bootAt(p, x + 6, y + 20 - short, k(PAL.black));
  // The far arm, reaching from the far shoulder (behind the torso).
  limb(p, [x + 2, y + 6.5], [x + 5.5, y + 7.5], 1.2, 1.1, k(R(shade(rag, -0.22)))); limb(p, [x + 5.5, y + 7.5], [x + 9, y + 8.5], 1.1, 1, k(skinRamp(shade(skin, -0.15))));
  // The torn torso: a hunched trapezoid, a ragged hem.
  form(p, (xx, yy) => { if (yy < y + 5 || yy > y + 13) return false; const t = (yy - y - 5) / 8; const half = 3 - 0.4 * t; if (yy > y + 11 && ((xx + yy + i) % 3 === 0)) return false; return xx >= cx - half + (yy === y + 5 ? 1 : 0) && xx <= cx + half - (yy === y + 5 ? 1 : 0); }, rg, x + 1, y + 5, x + 8, y + 13);
  if (i % 2 === 0) ellipseV(p, x + 4.5, y + 9, 1.2, 1.4, sk, { specular: false });                       // skin through a tear
  if (i % 4 === 2) { p.set(x + 3, y + 7, BLOOD); p.set(x + 4, y + 7, BLOOD); p.set(x + 3, y + 8, BLOOD); }
  // The near arm straight out from the shoulder, the hand hanging.
  limb(p, [x + 7.5, y + 6], [x + 10.5, y + 6.3], 1.3, 1.2, rg); limb(p, [x + 10.5, y + 6.3], [x + 13, y + 7], 1.1, 1, sk); ellipseV(p, x + 13.5, y + 8, 1, 1.1, sk, { specular: false });
  // The head, tipped forward: a jaw hanging, a sunken eye with its glow.
  const hx = x + 5.5 + lean, hy = y + 2.8;
  ellipseV(p, hx, hy, 2.3, 2.6, sk, { specular: i % 2 === 0 });
  if (i % 2) form(p, (xx, yy) => ell(hx, hy, 2.3, 2.6)(xx, yy) && (yy <= y + 1 || (xx <= hx - 1.5 && yy <= y + 3)), k(R("#3a3028")), x + 2, y, x + 9, y + 3, { rim: 1 }); // lank hair on some
  p.rect(hx + 1, y + 4, hx + 2, y + 5, sk[0]); p.set(hx + 2, y + 5, mix(sk[0], "#1a1412", 0.5));            // the gaping mouth
  if (eye) { p.set(Math.round(hx) + 1, y + 2, eye); p.set(Math.round(hx), y + 2, mix(sk[0], eye, 0.45)); } else p.set(Math.round(hx) + 1, y + 2, sk[0]);
}
// A crowd of the dead: n figures (2–12) in two or three staggered rows, the front row lower and lit, the back rows
// smaller and in shadow; eye glow by the look settings.
export function paintHordeHD(n, look = {}) {
  n = Math.max(2, Math.min(12, n));
  const rows = n >= 8 ? 3 : 2;
  const per = []; let left = n; for (let r = rows; r >= 1; r--) { const k = Math.ceil(left / r); per.unshift(k); left -= k; } // back rows first; the front gets the most
  const widths = per.map((k, r) => k * 12 + (rows - 1 - r) * 6);
  const p = painter(Math.max(...widths) + 4, 30 + (rows - 2) * 6);
  const pals = look.palette && ZSKIN[look.palette] ? [ZSKIN[look.palette]] : [ZSKIN.rotten, ZSKIN.ashen, ZSKIN.pale, ZSKIN.rotten];
  const eye = look.eyes in ZEYES ? ZEYES[look.eyes] : ZEYES.glow;
  let k = 0;
  per.forEach((count, r) => {
    const back = rows - 1 - r, y = r * 8;
    for (let i = 0; i < count; i++) {
      const kk = k++, pal = pals[(kk * 3) % pals.length];
      layer(p, (q) => shambler(q, i * 12 + back * 6, y + 2 * back, pal[kk % pal.length], ZRAGS[(kk * 5 + 2) % ZRAGS.length], eye, kk, back * 0.22));
    }
  });
  for (let i = 0; i < per[rows - 1]; i++) groundShadow(p, i * 12, i * 12 + 10, p.h - 1);
  return p;
}

// Infested animals (sim/worm.js): n (1–3) gaunt grey deer or hogs with raw sores, heads hanging.
export function paintHerdHD(kind, n) {
  n = Math.max(1, Math.min(3, n));
  const p = painter(26 + (n - 1) * 14, 24 + (n > 1 ? 4 : 0));
  for (let i = n - 1; i >= 0; i--) layer(p, (q) => infestedBeast(q, i * 14, i % 2 ? 0 : n > 1 ? 4 : 0, kind === "hog" ? "hog" : "deer", i));
  for (let i = 0; i < n; i++) groundShadow(p, i * 14 + 2, i * 14 + 22, (i % 2 ? 0 : n > 1 ? 4 : 0) + 23);
  return p;
}
function infestedBeast(p, x, y, kind, k) {
  const hide = R(k % 2 ? "#8d877a" : "#7f796e"), hideF = dimRamp(hide, 0.25), SORE = "#9a2a2c", SORE_L = "#c84a44", EYE = "#ff6a3a";
  if (kind === "deer") {
    for (const [lx, far] of [[6, true], [15, true], [8, false], [17, false]]) { limb(p, [lx, 14], [lx + (far ? -0.5 : 0.5), 19], 1.2, 1, far ? hideF : hide); limb(p, [lx + (far ? -0.5 : 0.5), 19], [lx + (far ? -1 : 1), 22.5], 1, 0.8, far ? hideF : hide); p.set(x + lx + (far ? -1 : 1), y + 23, PAL.black[1]); }
    ellipseV(p, x + 10.5, y + 11.5, 7.5, 4, hide, { specular: false });                                                            // the gaunt barrel
    for (const rx of [7, 10, 13]) p.vl(x + rx, y + 10, y + 13, hide[0]);                                                         // ribs showing
    p.hl(x + 5, x + 15, y + 8, hide[2]);                                                                                         // the lit spine
    limb(p, [x + 2, y + 10], [x + 0.5, y + 9], 0.9, 0.5, hideF);                                                                 // tail
    limb(p, [x + 17, y + 11], [x + 20.5, y + 14.5], 2.2, 1.6, hide); ellipseV(p, x + 22.5, y + 16.5, 2.6, 2.2, hide, { specular: false }); limb(p, [x + 24, y + 18], [x + 25, y + 19.5], 1.2, 0.9, hide); // neck low, head hanging
    p.set(x + 22, y + 16, EYE); p.set(x + 23, y + 16, "#ffb080");
    limb(p, [x + 20.5, y + 13], [x + 21.5, y + 9.5], 0.7, 0.4, BONE); limb(p, [x + 21.5, y + 11], [x + 23, y + 9.5], 0.5, 0.3, BONE); limb(p, [x + 20, y + 11.5], [x + 18.5, y + 9.5], 0.5, 0.3, BONE); // antlers
  } else {
    for (const [lx, far] of [[7, true], [15, true], [9, false], [17, false]]) { limb(p, [lx, 17], [lx + (far ? -0.5 : 0.5), 22.5], 1.3, 1.1, far ? hideF : hide); p.set(x + lx + (far ? -1 : 1), y + 23, PAL.black[1]); }
    ellipseV(p, x + 11, y + 14, 8.5, 5, hide, { specular: false });
    for (const rx of [8, 11, 14]) p.vl(x + rx, y + 12, y + 16, hide[0]);
    p.hl(x + 5, x + 16, y + 9, hide[0]); p.hl(x + 6, x + 15, y + 10, hide[2]);                                                   // the bristle ridge
    limb(p, [x + 18, y + 13], [x + 21.5, y + 15], 2.6, 2.2, hide); ellipseV(p, x + 22.5, y + 16.5, 2.6, 2.3, hide, { specular: false }); limb(p, [x + 24, y + 17.5], [x + 25.5, y + 19], 1.3, 1.1, hide); p.set(x + 25, y + 19, hide[2]);
    p.set(x + 22, y + 16, EYE); limb(p, [x + 20.5, y + 13.5], [x + 20, y + 12], 0.8, 0.5, hide); limb(p, [x + 22.5, y + 13.5], [x + 23, y + 12], 0.8, 0.5, hide);
  }
  p.rect(x + 6, y + 10, x + 7, y + 11, SORE); p.set(x + 6, y + 10, SORE_L); p.rect(x + 12, y + 9, x + 13, y + 10, SORE); p.set(x + 12, y + 9, SORE_L); p.set(x + 10, y + 13, SORE); p.set(x + 15, y + 12, SORE_L);
}

// A hive (56 × 36): a festering mound of bodies over a dark pool, veins running out of it, pods glowing, bones sticking
// out; level 0–2 by how infected the ground is (bigger, redder, more pods).
export function paintHiveHD(level = 0) {
  const p = painter(56, 36), rng = new Rng(77 + level);
  const POOL = ["#1c0a10", "#2a1018", "#4a1a28", "#602434"], VEIN = "#8a1c22", VEIN_L = "#b83a38", POD = ["#b02a1c", "#ff5a3a", "#ffb43b", "#fff0a0"];
  const halo = mix(FLESH[1], POD[1], 0.45), halo2 = mix(FLESH[1], POD[1], 0.22);
  const prx = 20 + level * 3.2, pry = 6 + level * 0.8, cx = 28, cy = 28;
  ellipseV(p, cx, cy, prx, pry, POOL, { specular: false });
  for (const [dx, dy] of [[-1, 0], [1, 0], [-0.8, 0.5], [0.8, 0.5], [-0.4, 0.9], [0.4, 0.9], [-0.95, -0.3], [0.95, -0.3]]) {
    for (let t = 6; t < prx - 1; t += 0.5) { const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t * pry / prx); if (p.get(x, y)) p.set(x, y, (Math.floor(t) + level) % 5 < 2 ? VEIN_L : VEIN); }
  }
  // The mound: a dome of bodies shaded by its silhouette, then lumps on it.
  const h = 16 + level * 4, hw = 12 + level * 2;
  const dome = (x, y) => { const t = (cy - y) / h; if (t < 0 || t > 1) return false; return Math.abs(x + 0.5 - cx) <= hw * Math.sqrt(1 - t * t); };
  form(p, dome, FLESH, cx - hw - 1, cy - h - 1, cx + hw + 1, cy, { specular: true });
  for (let i = 0; i < 6 + level * 3; i++) {
    const bx = cx - hw + 3 + ((i * 7 + level * 3) % Math.max(1, hw * 2 - 5)), by = cy - 2 - ((i * 5) % (h - 4)), r = 1.5 + (i % 2);
    if (!dome(bx, by)) continue;
    ellipseV(p, bx, by, r + 0.5, r, FLESH, { specular: i % 3 === 0 });
  }
  for (const [sx, sy, ex, ey] of [[cx - hw + 2, cy - 3, cx - 4, cy - h + 5], [cx + hw - 3, cy - 2, cx + 2, cy - h + 6], [cx - 2, cy - 1, cx + hw - 6, cy - h / 2]]) { p.line(sx, sy, ex, ey, VEIN); p.line(sx + 1, sy, ex + 1, ey, VEIN_L); }  // veins over the surface
  // Bones: ribs arching out of the left flank, a long bone, an arm reaching up from the top, a skull in the pool.
  const rx = cx - hw;
  for (let i = 0; i < 3; i++) { const y = cy - 4 - i * 4; limb(p, [rx - 1, y + 0.5], [rx + 3.5, y - 2.5], 0.9, 0.7, BONE); limb(p, [rx + 3.5, y - 2.5], [rx + 8, y], 0.7, 0.5, BONE); }
  limb(p, [cx + 6 + level * 2, cy - 4], [cx + 12 + level * 2, cy - 11], 0.9, 0.9, BONE); ellipseV(p, cx + 12.5 + level * 2, cy - 11.5, 1.2, 1.2, BONE, { specular: false });
  limb(p, [cx + 2.5, cy - h + 2], [cx + 2.5, cy - h - 5], 1.1, 0.9, BONE); for (const [fx, fy] of [[cx + 0.5, cy - h - 4], [cx + 1.5, cy - h - 7], [cx + 3.5, cy - h - 7.5], [cx + 5, cy - h - 6]]) limb(p, [cx + 2.5, cy - h - 5], [fx, fy], 0.6, 0.4, BONE); // an arm with fingers
  const sx = cx + 10 + level * 2, sy = cy - 2;
  ellipseV(p, sx + 2.5, sy - 1, 3, 2.6, BONE, { specular: true }); p.rect(sx + 1, sy + 2, sx + 4, sy + 3, BONE[1]); p.set(sx + 2, sy + 3, BONE[0]); p.set(sx + 4, sy + 3, BONE[0]);
  p.rect(sx + 1, sy - 1, sx + 2, sy, DARK); p.rect(sx + 4, sy - 1, sx + 5, sy, DARK);                                      // the sockets
  // Glowing pods: a hot core, a halo of lit flesh around.
  const pods = [[22, 22], [34, 20], [28, 16], [20, 26], [32, 26], [26, 10], [32, 12], [24, 18], [36, 16], [18, 22]].slice(0, 3 + level * 2 + (level === 2 ? 2 : 0));
  for (const [x, y] of pods) {
    if (!dome(x, y)) continue;
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1], [-2, -1], [2, 1]]) p.over(x + dx, y + dy, level ? halo : halo2);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p.over(x + dx, y + dy, halo);
    p.rect(x, y, x + 1, y + 1, POD[1]); p.set(x, y, level ? POD[2] : mix(POD[1], POD[2], 0.4)); p.set(x + 1, y + 1, POD[0]); if (level === 2) p.set(x + 1, y, POD[2]);
  }
  if (level === 2) for (const [x, y] of [[14, 8], [42, 6], [10, 18], [46, 16], [20, 4]]) { p.set(x, y, "#ff3a3044"); p.set(x + 1, y, "#ff3a3022"); }
  return p;
}

// Danger pip (18 × 18): a skull, crisp, a little shading.
export function paintSkullHD() {
  const p = painter(18, 18);
  ellipseV(p, 8.5, 6.5, 5.6, 5.6, BONE, { specular: true });
  form(p, rr(5, 11, 12, 15, 1), BONE, 5, 11, 12, 15, { rim: 1 }); p.hl(4, 13, 11, BONE[1]); p.set(4, 11, BONE[0]); p.set(13, 11, BONE[0]);   // the jaw
  p.rect(5, 5, 7, 7, DARK); p.rect(10, 5, 12, 7, DARK); p.set(5, 5, "#2a2424"); p.set(10, 5, "#2a2424");                                  // the sockets
  p.rect(8, 9, 9, 9, BONE[0]); p.set(8, 8, BONE[1]); p.set(9, 8, BONE[1]);                                                               // the nose
  p.hl(5, 12, 12, BONE[1]); for (const x of [7, 9, 11]) p.rect(x, 13, x, 15, BONE[0]); p.set(5, 13, BONE[0]); p.set(12, 13, BONE[0]);        // teeth
  p.set(6, 12, BONE[3]); p.set(8, 12, BONE[3]); p.set(10, 12, BONE[3]);
  return p;
}

// ---------- status icons and markers ----------
export function paintIconHD(kind, color = "#ffd166") {
  const p = painter(18, 18), m = R(color);
  const disc = () => ellipseV(p, 8.5, 8.5, 8, 8, m, { specular: true });
  switch (kind) {
    case "alert": disc(); p.rect(8, 3, 9, 10, DARK); p.rect(8, 12, 9, 13, DARK); break;
    case "unknown": disc(); p.rect(6, 3, 11, 4, DARK); p.rect(11, 4, 12, 7, DARK); p.rect(9, 7, 11, 8, DARK); p.rect(8, 8, 9, 10, DARK); p.rect(8, 12, 9, 13, DARK); p.rect(5, 4, 6, 6, DARK); break;
    case "work": // a wrench, diagonal
      limb(p, [5, 5], [15.5, 15.5], 1.4, 1.1, STEEL); ellipseV(p, 4.5, 4.5, 4, 4, STEEL, { specular: true });
      for (let y = 0; y <= 6; y++) for (let x = 0; x <= 6; x++) if (Math.abs(x - y) <= 1 && x + y <= 8) p.clear(x, y);   // the open jaw, toward the upper left
      p.set(2, 5, STEEL[0]); p.set(5, 2, STEEL[0]); p.set(1, 6, STEEL[2]); p.set(6, 1, STEEL[3]); break;
    case "radio": { // a walkie-talkie, signal arcs
      form(p, rr(4, 6, 10, 17, 1), PAL.black, 4, 6, 10, 17, { specular: true });
      p.rect(5, 8, 9, 10, PAL.board[2]); p.set(5, 8, PAL.board[3]); p.hl(5, 9, 10, PAL.board[0]); p.rect(6, 13, 8, 13, PAL.grey[1]); p.rect(6, 15, 8, 15, PAL.grey[1]); p.set(5, 12, PAL.red[2]);
      limb(p, [4.5, 0.5], [4.5, 5.5], 0.8, 0.8, PAL.grey);
      for (const [x, y, c] of [[12, 3, "#9be39b"], [13, 4, "#9be39b"], [14, 5, "#9be39b"], [14, 6, "#9be39b"], [14, 7, "#9be39b"], [13, 1, "#9be39bbb"], [15, 2, "#9be39bbb"], [16, 4, "#9be39bbb"], [17, 6, "#9be39bbb"], [17, 8, "#9be39b88"], [16, 9, "#9be39b88"]]) p.set(x, y, c);
      break;
    }
    case "siege": // crossed swords
      limb(p, [2, 2], [14, 14], 1, 0.7, STEEL); limb(p, [15, 2], [3, 14], 1, 0.7, STEEL); p.set(3, 2, STEEL[3]); p.set(4, 3, STEEL[3]); p.set(14, 2, STEEL[3]);
      limb(p, [11, 12.5], [15, 12.5], 0.9, 0.9, GOLD); limb(p, [2, 12.5], [6, 12.5], 0.9, 0.9, GOLD);
      limb(p, [14, 14.5], [17, 17], 0.9, 0.8, WOOD); limb(p, [3, 14.5], [0.5, 17], 0.9, 0.8, WOOD);
      p.rect(8, 8, 9, 9, PAL.red[3]); p.set(8, 8, "#ffd0c0");
      break;
  }
  return p;
}

// Abandoned vehicle (base + 4 × 12): your truck, sedan or Army truck parked and dusty with its upgrades on; a red jerry
// can over it when it needs fuel, smoke and an open hood when it is badly damaged; bikes lying in the grass.
export function paintParkedHD(type, color, needsFuel, damaged, ups = "") {
  if (type === "bike") return paintBikesHD(color, damaged);
  const dusty = desat(color, 0.45), m = R(dusty);
  const base = armourOverlayHD(type === "sedan" ? paintSedanHD(dusty) : type === "miltruck" ? paintMilTruckHD(dusty, damaged ? "wrecked" : "intact") : paintTruckHD(dusty), type, ups);
  const p = painter(base.w + 4, base.h + 12);
  p.blit(base, 0, 12);
  const dust = mix(dusty, "#9a8a6a", 0.7);
  for (const [x, y] of [[6, 26], [7, 26], [14, 28], [15, 28], [24, 26], [32, 28], [33, 28], [18, 24], [36, 24], [37, 24], [10, 25], [28, 27]]) if (p.get(x, y) && p.get(x, y) !== SHADOW) p.set(x, y, dust);
  if (type === "sedan") { for (let x = 30; x <= 37; x++) p.clear(x, 35); p.rect(29, 35, 38, 35, TYRE[1]); p.rect(30, 34, 37, 34, TYRE[1]); p.set(31, 34, TYRE[2]); } // the flat
  if (damaged) {
    limb(p, [34, 18.5], [41, 18.5], 1, 1, m); limb(p, [40, 17], [41, 14.5], 0.9, 0.8, m);                                               // the hood up
    for (const [x, y, c] of [[38, 15, SMOKE_DK], [39, 13, SMOKE], [40, 11, SMOKE], [38, 9, SMOKE], [41, 7, SMOKE_FAINT], [39, 5, SMOKE_FAINT], [42, 3, SMOKE_FAINT], [40, 2, SMOKE_FAINT], [37, 11, SMOKE_FAINT], [41, 9, SMOKE_FAINT]]) p.set(x, y, c);
  }
  if (needsFuel) { form(p, rr(2, 3, 9, 11, 1), PAL.red, 2, 3, 9, 11, { specular: true }); limb(p, [4, 1.5], [7, 1.5], 0.9, 0.9, PAL.black); p.rect(4, 6, 5, 8, PAL.red[0]); p.set(6, 9, PAL.red[0]); p.set(7, 8, PAL.red[0]); p.set(6, 7, PAL.red[0]); p.set(8, 6, PAL.red[0]); }
  return p;
}
// Wrecked car (44 × 24): rusted, a wheel gone, the door hanging open. Stripped: up on blocks, no wheels, hood up.
export function paintWreckMarkerHD(stripped) {
  const body = "#7d5a43", p = paintSedanHD(body), m = R(body);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const v = p.get(x, y);
    if (GLASSY.has(v)) p.set(x, y, (x + y) % 5 < 2 ? "#5a6870" : "#2a2d30");
    if (LAMP.includes(v) || TAIL.includes(v)) p.set(x, y, "#3a3020");
  }
  for (const [x, y] of [[8, 12], [9, 12], [18, 11], [26, 14], [27, 14], [34, 12], [14, 7], [36, 16], [5, 15], [22, 15]]) p.set(x, y, RUST[2]);
  for (const [x, y] of [[9, 13], [19, 11], [27, 15], [35, 13]]) p.set(x, y, RUST[0]);
  if (!stripped) {
    for (let y = 16; y <= 23; y++) for (let x = 30; x <= 37; x++) p.clear(x, y);                                            // a wheel gone
    p.rect(30, 18, 37, 19, m[0]); p.rect(31, 17, 36, 17, m[0]); groundShadow(p, 3, 41, 23); p.clear(30, 23); p.clear(37, 23);
    limb(p, [22.5, 6], [22.5, 15], 1, 1, m); limb(p, [20.5, 10], [20.5, 17], 0.9, 0.9, R(shade(body, -0.25)));              // the rear door hanging open
    return p;
  }
  for (let y = 16; y <= 23; y++) for (let x = 0; x < p.w; x++) { const v = p.get(x, y); if (TYRE.includes(v) || RIM.includes(v) || v === SHADOW) p.clear(x, y); }
  for (const x of [8, 32]) form(p, rr(x, 18, x + 5, 21, 0), R(STONE), x, 18, x + 5, 21, { rim: 1 });
  p.rect(12, 6, 19, 15, "#2a2018"); p.rect(22, 6, 29, 15, "#2a2018"); p.rect(14, 10, 15, 12, PACK_R[0]); p.rect(24, 12, 26, 13, PACK_R[0]); p.hl(12, 19, 15, "#1a140e"); p.hl(22, 29, 15, "#1a140e"); // the doors pulled off
  for (let x = 30; x <= 43; x++) { p.clear(x, 8); p.clear(x, 9); }
  limb(p, [32, 2.5], [37, 2.5], 1, 1, m); limb(p, [37, 3], [41, 7], 0.9, 0.8, m); p.rect(30, 4, 31, 5, m[0]);                 // hood up
  form(p, rr(32, 8, 39, 9, 0), IRON, 32, 8, 39, 9, { flat: true }); p.set(34, 8, IRON[3]);
  groundShadow(p, 6, 39, 23);
  return p;
}
// Supply cache (36 × 22): crates under an olive tarp and a duffel bag. Emptied: a crate with its lid off, the tarp aside.
export function paintCacheMarkerHD(emptied) {
  const p = painter(36, 22), olive = R(OLIVE);
  if (emptied) {
    crate(p, 10, 8, 14, 12, WOOD); p.rect(12, 8, 21, 11, "#2a2018"); p.hl(12, 21, 8, "#1a140e"); p.set(13, 10, "#3a2c20");
    form(p, rr(26, 6, 29, 18, 0), ASH, 26, 6, 29, 18, { rim: 1 }); p.set(27, 12, ASH[0]); p.set(27, 13, ASH[0]);              // the lid, leaning
    form(p, rr(2, 16, 7, 19, 1), olive, 2, 16, 7, 19, { rim: 1 });                                                           // a folded tarp
    limb(p, [32.5, 18], [32.5, 20], 1, 1, PAL.steel); p.set(32, 18, PAL.steel[3]);                                           // an empty can
    groundShadow(p, 2, 34, 21);
    return p;
  }
  crate(p, 2, 8, 12, 12); crate(p, 14, 10, 12, 10, WOOD); crate(p, 6, 0, 10, 8, R(shade(ASH[1], 0.1)));
  form(p, union(rr(12, 6, 25, 9, 1), rr(12, 10, 13, 11, 0), rr(24, 10, 25, 11, 0)), olive, 12, 6, 25, 11, { specular: true });
  form(p, rr(24, 14, 35, 20, 2), R("#3a4a5a"), 24, 14, 35, 20, { specular: true }); limb(p, [26.5, 12.5], [29, 12.5], 0.9, 0.9, PAL.black); limb(p, [30.5, 12.5], [31.5, 12.5], 0.9, 0.9, PAL.black);
  p.rect(28, 16, 29, 19, R("#3a4a5a")[0]); p.set(32, 18, R("#3a4a5a")[0]);
  groundShadow(p, 2, 35, 21);
  return p;
}
// A-frame tent centred on cx standing on row yb, half rows tall; door: a dark opening.
function tent(p, cx, yb, half, m, door = true) {
  form(p, (x, y) => y >= yb - half && y <= yb && Math.abs(x - cx - 0.5) <= (y - yb + half) + 0.5, m, cx - half - 1, yb - half, cx + half + 1, yb, { rim: 2 });
  if (door) { p.rect(cx - 1, yb - Math.floor(half / 2), cx + 1, yb, m[0]); p.rect(cx, yb - Math.floor(half / 2) + 1, cx + 1, yb, mix(m[0], DARK, 0.5)); }
}
function campfire(p, x, yb, lit = true) {
  limb(p, [x + 0.5, yb + 0.5], [x + 7.5, yb + 0.5], 1.1, 1.1, WOOD); limb(p, [x + 0.5, yb - 1.5], [x + 2.5, yb - 0.5], 0.9, 0.9, WOOD); limb(p, [x + 7, yb - 1.5], [x + 5, yb - 0.5], 0.9, 0.9, WOOD);
  if (!lit) { ellipseV(p, x + 3.5, yb - 1.5, 2, 1.2, PAL.grey, { specular: false }); return; }
  for (const [dx, dy] of [[-2, 0], [9, 0], [-2, -4], [9, -4], [0, -8], [7, -8], [2, -10], [5, -10], [-1, -2], [8, -2]]) p.set(x + dx, yb + dy, GLOW);
  ellipseV(p, x + 3.5, yb - 4, 2.2, 3.6, FIRE, { specular: false }); p.set(x + 3, yb - 4, FIRE[3]); p.set(x + 4, yb - 3, FIRE[3]); p.set(x + 4, yb - 8, FIRE[2]); p.set(x + 3, yb - 9, "#ffb43b99");
}
// Abandoned camp (36 × 22): a grey tent and a dead fire; emptied: the tent collapsed and the camp picked through.
export function paintCampMarkerHD(emptied) {
  const p = painter(36, 22), g = R("#8a8478"), dirt = R("#6e5c40");
  form(p, rr(0, 20, 25, 21, 0), dirt, 0, 20, 25, 21, { rim: 1 }); for (const x of [3, 9, 17, 22]) p.set(x, 20, dirt[2]);
  if (!emptied) {
    tent(p, 12, 19, 12, g);
    p.clear(6, 13); p.clear(5, 14); p.clear(4, 15); p.set(6, 14, g[0]); p.set(5, 15, g[0]); p.clear(18, 11); p.clear(19, 12); p.set(18, 12, g[0]); // the canvas torn
  } else {
    form(p, (x, y) => x >= 2 && x <= 23 && y >= 15 && y <= 19 && y >= 17 - (x > 8 && x < 18 ? 2 : x > 5 && x < 21 ? 1 : 0), g, 2, 15, 23, 19, { rim: 1 });
    limb(p, [8.5, 16.5], [9, 18], 0.9, 0.9, WOOD); limb(p, [18.5, 14.5], [19, 16], 0.9, 0.9, WOOD);
  }
  campfire(p, 26, 18, false);
  groundShadow(p, 25, 35, 21); groundShadow(p, 0, 24, 21);
  return p;
}
// Death site (32 × 24): a cross over the grave; with the gear still lying there, a pack, a rifle and a helmet on the cross.
export function paintGraveMarkerHD(items) {
  const p = painter(32, 24), dirt = R("#6e5c40");
  form(p, union(rr(2, 18, 21, 21, 1), rr(4, 16, 19, 17, 1)), dirt, 2, 16, 21, 21, { specular: true });
  for (const [x, y] of [[7, 19], [14, 18], [17, 20]]) p.set(x, y, dirt[0]);
  limb(p, [11.5, 2.5], [11.5, 17], 1.6, 1.6, ASH); limb(p, [6.5, 7.5], [16.5, 7.5], 1.6, 1.6, ASH); p.hl(10, 13, 9, ASH[0]);
  if (items) {
    form(p, rr(20, 14, 27, 21, 1), PACK_R, 20, 14, 27, 21, { specular: true }); p.rect(23, 17, 24, 18, PACK_R[0]);
    limb(p, [31, 21], [21, 9], 0.9, 0.7, IRON); limb(p, [31, 21], [29, 18.5], 1.1, 1, WOOD);
    ellipseV(p, 11.5, 1.5, 3.8, 2.6, R(OLIVE), { specular: true, cut: (x, y) => y <= 2 }); p.hl(8, 15, 3, R(OLIVE)[0]);
  }
  groundShadow(p, 2, 30, 23);
  return p;
}

// Boat wake (52 × 12): two foam lines spreading behind (see-through, like the game's: alpha colours).
export function paintWakeHD() {
  const p = painter(52, 12), FOAM = "#d8ecf4";
  for (let i = 0; i < 24; i++) {
    const a = i < 6 ? "dd" : i < 12 ? "aa" : i < 18 ? "66" : "33", x = 40 - i * 2;
    const yTop = 2 + Math.floor(i / 6), yBot = 9 - Math.floor(i / 8);
    p.rect(x, yTop, x + 1, yTop, FOAM + a); if (i % 3 === 0) p.set(x + 1, yTop + 1, FOAM + (i < 12 ? "66" : "33"));
    p.rect(x, yBot, x + 1, yBot, FOAM + a); if (i % 3 === 1) p.set(x, yBot - 1, FOAM + (i < 12 ? "66" : "33"));
  }
  p.rect(42, 4, 49, 7, FOAM + "dd"); p.rect(43, 3, 48, 3, FOAM + "aa"); p.rect(44, 8, 47, 8, FOAM + "aa"); p.rect(44, 5, 47, 6, "#ffffffee"); p.rect(50, 5, 51, 6, FOAM + "99");
  return p;
}
// Where something came down but nobody has found it (20 × 32): a smoke column over the trees.
export function paintSearchSmokeHD() {
  const p = painter(20, 32), t1 = R("#3e5a32"), t2 = R("#456a38");
  form(p, rr(2, 28, 17, 31, 1), t1, 2, 28, 17, 31, { rim: 1 });
  form(p, (x, y) => y >= 21 && y <= 29 && Math.abs(x - 6.5) <= Math.min(3, (y - 20) * 0.7), t1, 3, 21, 10, 29, { rim: 1 });
  form(p, (x, y) => y >= 19 && y <= 29 && Math.abs(x - 12.5) <= Math.min(3, (y - 18) * 0.7), t2, 9, 19, 16, 29, { rim: 1 });
  ellipseV(p, 9, 24.5, 1.6, 1.8, FIRE, { specular: false }); p.set(9, 24, FIRE[3]); p.set(8, 22, "#ffb43b99"); p.set(10, 22, GLOW); p.set(7, 24, GLOW);
  for (let i = 0; i < 12; i++) {
    const cx = 9 + Math.round(Math.sin(i * 0.45) * 2.4), cy = 20 - i * 2, dk = i < 5;
    p.rect(cx - 1, cy, cx + 1, cy + 1, dk ? SMOKE_DK : SMOKE); p.set(cx - 2, cy, SMOKE_FAINT); p.set(cx + 2, cy + 1, SMOKE_FAINT); p.set(cx - 2, cy - 1, SMOKE_FAINT);
    if (i > 4) { p.set(cx + 2, cy, SMOKE); p.set(cx + 3, cy - 1, SMOKE_FAINT); p.set(cx - 3, cy + 1, SMOKE_FAINT); }
  }
  return p;
}

// ---------- the sheet ----------
const C = "#4f8fd6";
const cell = (label, f) => ({ label, paint: f });
export const SHEET_TITLE = "state map HD (2x grids)";
export const SHEET_COLS = 8;
export const SHEET = [
  // Your parties.
  cell("truck", () => paintTruckHD(C)), cell("sedan", () => paintSedanHD(C)), cell("walkers 3 armed", () => paintWalkersHD(C, 3, true)), cell("walkers 1", () => paintWalkersHD(C, 1, false)),
  cell("boat", () => paintBoatHD(C, false)), cell("raft", () => paintBoatHD(C, true)), cell("bikes", () => paintBikesHD(C, false)), cell("bikes damaged", () => paintBikesHD(C, true)),
  cell("handcart", () => paintHandcartHD(C, false)), cell("supply cart", () => paintHandcartHD(C, true)), cell("convoy", () => paintConvoyTruckHD(C, false)), cell("supply", () => paintConvoyTruckHD(C, true)),
  cell("scouts", () => paintScoutsHD(C, 2)), cell("relief", () => paintReliefHD(C, 3)), cell("truck armoured", () => armourOverlayHD(paintTruckHD(C), "truck", "p2s0g0m1tm2hb")), cell("sedan scrap", () => armourOverlayHD(paintSedanHD(C), "sedan", "p0s1g1m0t")),
  // Solo walk cycle and the cyclist.
  cell("solo 0", () => paintSoloHD(soloLookHD("walkers", C, 0), 0)), cell("solo 1", () => paintSoloHD(soloLookHD("walkers", C, 1), 1)), cell("solo 2", () => paintSoloHD(soloLookHD("walkers", C, 2), 2)), cell("solo 3", () => paintSoloHD(soloLookHD("walkers", C, 3), 3)),
  cell("limp 4", () => paintSoloHD(soloLookHD("walkers", C, 4), 4, "", "limp")), cell("heavy 1", () => paintSoloHD(soloLookHD("walkers", C, 1), 1, "", "heavy")), cell("raid torch", () => paintSoloHD(soloLookHD("raid", C, 1), 1, "torch")), cell("scout lamp", () => paintSoloHD(soloLookHD("scouts", C, 0), 0, "lamp")),
  cell("cyclist 0", () => paintCyclistHD(C, 0)), cell("cyclist 1", () => paintCyclistHD(C, 1)), cell("cyclist 2", () => paintCyclistHD(C, 2)), cell("relief solo", () => paintSoloHD(soloLookHD("relief", C, 1), 1)),
  cell("raider solo", () => paintSoloHD(groupLook("raider", "#a63a32", 0, false), 1)), cell("zealot solo", () => paintSoloHD(groupLook("zealot", "#d9b23a", 0, false), 1)), cell("commune solo", () => paintSoloHD(groupLook("commune", "#3a8a5a", 0, false), 3)), cell("scav solo", () => paintSoloHD({ ...groupLook("traders", "#d9a520", 0, false), pack: true, arm: "bar" }, 1)),
  // Group vehicles.
  cell("raider truck", () => paintRaiderTruckHD("#a63a32")), cell("humvee", () => paintHumveeHD("#3f7a3a")), cell("mrap", () => paintMrapHD("#3f7a3a")), cell("armored truck", () => paintArmoredTruckHD("#5a6a9a")),
  cell("wagon", () => paintWagonHD("#d9a520")), cell("tractor", () => paintTractorHD("#3a8a5a")), cell("zealot cart", () => paintZealotCartHD("#d9b23a")), cell("fortress truck", () => paintFortressTruckHD("#7a5aa0")),
  cell("miltruck", () => paintMilTruckHD(C, "intact")), cell("miltruck wrecked", () => paintMilTruckHD(C, "wrecked")), cell("miltruck burnt", () => paintMilTruckHD(C, "burnt")), cell("miltruck armd", () => armourOverlayHD(paintMilTruckHD(C), "miltruck", "p1s0g1m0tm2hb")),
  // Group and outsider walkers.
  cell("raider raid", () => paintGroupWalkersHD("raider", "#a63a32", 3, "raid")), cell("military walk", () => paintGroupWalkersHD("military", "#3f7a3a", 3, "walk")), cell("zealot walk", () => paintGroupWalkersHD("zealot", "#d9b23a", 3, "walk")), cell("traders walk", () => paintGroupWalkersHD("traders", "#d9a520", 3, "walk")),
  cell("commune walk", () => paintGroupWalkersHD("commune", "#3a8a5a", 4, "walk")), cell("expansionist raid", () => paintGroupWalkersHD("expansionist", "#5a6a9a", 3, "raid")), cell("fortress walk", () => paintGroupWalkersHD("fortress", "#7a5aa0", 3, "walk")), cell("commune scav", () => paintGroupWalkersHD("commune", "#3a8a5a", 3, "scav")),
  cell("out raiders", () => paintOutsiderRaidersHD(3)), cell("merchants", () => paintOutsiderMerchantsHD("", "")), cell("merchants armed", () => paintOutsiderMerchantsHD("armed", "")), cell("merchants mrap", () => paintOutsiderMerchantsHD("armoured", "mrap")),
  cell("scouts out", () => paintOutsiderTravellersHD("scouts", 3)), cell("refugees", () => paintOutsiderTravellersHD("refugees", 3)), cell("wanderers", () => paintOutsiderTravellersHD("wanderers", 2)), cell("raider raid 1", () => paintGroupWalkersHD("raider", "#a63a32", 1, "raid")),
  // Hordes, herds, hives, the skull.
  cell("horde 3", () => paintHordeHD(3)), cell("horde 6", () => paintHordeHD(6)), cell("horde 10", () => paintHordeHD(10)), cell("horde 6 red ashen", () => paintHordeHD(6, { palette: "ashen", eyes: "red" })),
  cell("deer 1", () => paintHerdHD("deer", 1)), cell("deer 3", () => paintHerdHD("deer", 3)), cell("hog 1", () => paintHerdHD("hog", 1)), cell("hog 3", () => paintHerdHD("hog", 3)),
  cell("hive 0", () => paintHiveHD(0)), cell("hive 1", () => paintHiveHD(1)), cell("hive 2", () => paintHiveHD(2)), cell("skull", () => paintSkullHD()),
  // Markers and icons.
  cell("parked truck", () => paintParkedHD("truck", C, true, true)), cell("parked armoured", () => paintParkedHD("truck", C, false, false, "p2s0g1m0tm2hb")), cell("parked sedan", () => paintParkedHD("sedan", C, false, false)), cell("parked miltruck", () => paintParkedHD("miltruck", C, false, true)),
  cell("wreck", () => paintWreckMarkerHD(false)), cell("stripped", () => paintWreckMarkerHD(true)), cell("cache", () => paintCacheMarkerHD(false)), cell("cache emptied", () => paintCacheMarkerHD(true)),
  cell("camp", () => paintCampMarkerHD(false)), cell("camp emptied", () => paintCampMarkerHD(true)), cell("grave", () => paintGraveMarkerHD(true)), cell("grave empty", () => paintGraveMarkerHD(false)),
  cell("alert", () => paintIconHD("alert")), cell("unknown", () => paintIconHD("unknown", "#9ab0c8")), cell("work", () => paintIconHD("work")), cell("radio", () => paintIconHD("radio")),
  cell("siege", () => paintIconHD("siege")), cell("wake", () => paintWakeHD()), cell("search smoke", () => paintSearchSmokeHD()), cell("parked bikes", () => paintParkedHD("bike", C, false, true)),
];
// Current (scaled 2×) next to HD, for eight representative sprites; map-compare.js shows only these.
export const COMPARE = [
  ["truck", () => CUR.paintTruck(C), () => paintTruckHD(C)],
  ["walkers 3 armed", () => CUR.paintWalkers(C, 3, true), () => paintWalkersHD(C, 3, true)],
  ["solo 1", () => CUR.paintSolo({ cloth: C, pack: true, arm: "none" }, 1, ""), () => paintSoloHD(soloLookHD("walkers", C, 1), 1)],
  ["humvee", () => CUR.paintHumvee("#3f7a3a"), () => paintHumveeHD("#3f7a3a")],
  ["horde 6", () => CUR.paintHorde(6), () => paintHordeHD(6)],
  ["hive 1", () => CUR.paintHive(1), () => paintHiveHD(1)],
  ["skull", () => CUR.paintSkull(), () => paintSkullHD()],
  ["parked truck", () => CUR.paintParked("truck", C, true, true, ""), () => paintParkedHD("truck", C, true, true)],
].flatMap(([label, cur, hd]) => [cell(`${label} (current 2x)`, () => scaled(cur(), 2)), cell(`${label} HD`, hd)]);
SHEET.push(...COMPARE);
