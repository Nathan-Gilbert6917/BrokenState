// HD people (design preview only: src/ is unchanged): survivors and the hostile human kits (raiders, soldiers,
// zealots) on the 44 × 52 grid, in the item icons' style (items.js, STYLE.md), built from the figure kit (kit.js).
// Second design (2026-10-13), after the user turned down the block figures: "do it in a better style and make sure
// arms originate from the sides of the torso and do not look overly stretched".
//
//   paintSurvivorHD(app, weaponKey, armorKey, pose)        -> a 44 × 52 painter (p.muzzle = { mx, my } for guns)
//   paintEnemyHD(kit, factionColor, weaponKey, armorKey, seed) -> the same for raiders / soldiers / zealots
//   SHEET / SHEET_TITLE / SHEET_COLS                       -> node design/hd/render.js people 4
//
// The figure: facing right, about 4 heads tall (head rows 3..14, feet on row 49), a round head on a neck, a rounded
// torso, capsule limbs. Every form is a 4-tone ramp volume lit from the upper left; where one form lies over another
// the one behind gets a seam in its own dark tone (put()). The near arm and leg are on the right, in front; the far
// ones on the left, behind and a shade darker. Arms start at the shoulder joints (the torso's top outer corners) and
// bend at an elbow; no segment is longer than 8 px (kit.js reach / elbowToward / gunHold).
import { painter, scaled, desat } from "./hdcore.js";
import { PAL, ramp, skinRamp, blob, ellipseV, limb, bar, elbowToward, gunHold, headVolume, face, mix, shade } from "./kit.js";
import { Rng } from "../../src/sim/rng.js";
import { randomAppearance, LOOK_OPTIONS } from "../../src/sim/appearance.js";
import { paintSurvivor, paintEnemyHuman, enemyLookOf } from "../../src/ui/sprites.js";
import { BLADE_LOOK } from "../../src/sim/data-blades.js";

// ---------- ramps and seams ----------
// Every ramp used is registered so a seam can find "the dark tone of the form behind" from a pixel's colour.
const DARK_OF = new Map();
const reg = (m) => { for (const c of m) if (!DARK_OF.has(c)) DARK_OF.set(c, m[0]); return m; };
Object.values(PAL).forEach(reg);
const lum = (hex) => { const n = parseInt(hex.slice(1, 7), 16); return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11; };
const RAMPS = new Map();
const toHsl = (hex) => { const n = parseInt(hex.slice(1, 7), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * 60, s, l]; };
const fromHsl = (h, s, l) => { s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l)); const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join(""); };
// A 4-tone ramp from a game colour that keeps its hue: lights step up in lightness (warmer, a touch more saturated),
// darks step down (cooler). Dark colours (black hair, leather) get bigger steps so their light still reads.
export function R(hex) {
  if (RAMPS.has(hex)) return RAMPS.get(hex);
  const [h, s, l] = toHsl(hex), grey = s < 0.08;
  const toward = (target, k) => { let d = ((target - h + 540) % 360) - 180; return (h + Math.sign(d) * Math.min(Math.abs(d), k) + 360) % 360; };
  const warmH = (dh) => (grey ? h : dh > 0 ? toward(35, dh) : toward(225, -dh));
  const up = l < 0.18 ? [0.13, 0.25] : l < 0.35 ? [0.11, 0.22] : l > 0.72 ? [0.07, 0.14] : [0.1, 0.2];
  const m = reg([fromHsl(warmH(-8), s * 0.95, l * 0.62), hex, fromHsl(warmH(6), s * (grey ? 1 : 1.08), l + up[0]), fromHsl(warmH(10), s * (grey ? 1 : 1.05), l + up[1])]);
  RAMPS.set(hex, m); return m;
}
const SK = new Map();
const S = (hex) => { if (!SK.has(hex)) SK.set(hex, reg(skinRamp(hex))); return SK.get(hex); };
// The far side: a shade darker, still four tones.
const BACKS = new Map();
const back = (m) => { const k = m.join(); if (!BACKS.has(k)) BACKS.set(k, reg(m.map((c) => shade(c, -0.2)))); return BACKS.get(k); };
const lay = () => painter(44, 52);
// Lay `top` over `p`; the pixels of p it touches (and does not cover) get p's own dark tone: the inner line where one
// form overlaps another. seam = false: no line (a hand over its own arm, a buckle).
function put(p, top, seam = true) {
  if (seam) {
    const cov = (x, y) => !!top.get(x, y), hits = [];
    for (const [x, y, c] of p.pixels()) if (!cov(x, y) && (cov(x + 1, y) || cov(x - 1, y) || cov(x, y + 1) || cov(x, y - 1))) hits.push([x, y, c]);
    for (const [x, y, c] of hits) p.set(x, y, DARK_OF.get(c) || shade(c, -0.35));
  }
  p.blit(top, 0, 0);
}
// Recolour a layer's pixels through a map of colours (a ramp onto another ramp: camo, stubble, a check).
const remap = (q, from, to, where = () => true) => { for (const [x, y, c] of q.pixels()) { const i = from.indexOf(c); if (i >= 0 && where(x, y)) q.set(x, y, to[i]); } };
// Pixels of a capsule a→b (radius r) between t0 and t1 of its length: a sleeve's hem, a cuff, an armband.
function band(p, a, b, r, t0, t1, col, { only = null } = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  for (let y = Math.floor(Math.min(a[1], b[1]) - r - 1); y <= Math.ceil(Math.max(a[1], b[1]) + r + 1); y++) for (let x = Math.floor(Math.min(a[0], b[0]) - r - 1); x <= Math.ceil(Math.max(a[0], b[0]) + r + 1); x++) {
    const t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2; if (t < t0 || t > t1) continue;
    const qx = a[0] + dx * t, qy = a[1] + dy * t; if ((x - qx) ** 2 + (y - qy) ** 2 > (r + 0.45) ** 2) continue;
    if (only && !only(x, y)) continue;
    p.set(x, y, typeof col === "function" ? col(x, y, t) : col);
  }
}
const L = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

// ---------- the frame ----------
const BODY = {
  slim:    { sw: 8,    waist: 5.6, hip: 6.4, r: 2.0, leg: 2.3, belly: 0 },
  average: { sw: 9,    waist: 6.6, hip: 7.0, r: 2.3, leg: 2.6, belly: 0 },
  heavy:   { sw: 10.2, waist: 8.9, hip: 8.4, r: 2.8, leg: 3.0, belly: 1.6 },
};
// Joints (named as kit.skeleton's so kit.gunHold works on it). C: the torso's middle; head at (22.5, 8.5).
export function frame(build = "average") {
  const b = BODY[build] || BODY.average, C = 21.5, cx = 21;
  const hx = b.hip * 0.45;
  return {
    build: b, cx, C, name: build,
    head: [22.5, 8.5], headR: [5.4, 5.9],
    top: 16, belt: 29, bot: 30, front: Math.round(C + 2),
    shoulderN: [C + b.sw - 1.6, 18.6], shoulderF: [C - b.sw + 1.6, 18.6],
    elbowN: [C + b.sw - 0.9, 25.6], handN: [C + b.sw - 0.4, 32.2],
    elbowF: [C - b.sw + 0.9, 25.6], handF: [C - b.sw + 0.4, 32.2],
    hipN: [C + hx, 32], kneeN: [C + hx + 0.3, 39], ankleN: [C + hx + 0.5, 44.5],
    hipF: [C - hx, 32], kneeF: [C - hx - 0.4, 39], ankleF: [C - hx - 0.8, 44.5],
  };
}
// The torso's silhouette: rounded shoulders, a waist, the hips flaring into the belt; a belly forward on heavy builds.
function torsoInside(F, { top = F.top, bot = F.bot } = {}) {
  const { C, build: b } = F, turn = F.turn || 0;
  return (x, y) => {
    if (y < top || y > bot) return false;
    let half;
    if (y === top) half = b.sw - 3.2; else if (y === top + 1) half = b.sw - 1.2;
    else {
      const t = (y - top - 2) / (bot - top - 2), k = Math.min(1, Math.max(0, (t - 0.12) / 0.62)), s = k * k * (3 - 2 * k);
      half = b.sw + (b.waist - b.sw) * s + (t > 0.78 ? (b.hip - b.waist) * (t - 0.78) / 0.22 : 0);
    }
    const belly = b.belly * Math.max(0, Math.sin((Math.PI * (y - 20)) / 11));
    return x + 0.5 > C - half + turn * Math.max(0, Math.min(1, (bot - 1 - y) / 6)) && x - 0.5 < C + half + belly;
  };
}

// ---------- body parts ----------
// An arm into its own layer: skin capsules through the elbow, the sleeve over them, a cuff or a hem, the hand.
// len: "long" (to the wrist), "short" (a t-shirt), "none" (a tank top), "bell" (a robe's wide sleeve).
function armLayer(s, e, h, { skin, sleeve = null, len = "long", r = 2.3, hand = true, cuffM = null }) {
  const q = lay(), rU = r, rL = r * 0.84;
  limb(q, s, e, rU + 0.15, rU * 0.92, skin); limb(q, e, h, rL, rL * 0.82, skin);
  if (sleeve && len !== "none") {
    if (len === "short") {
      const m = L(s, e, 0.66);
      limb(q, s, m, rU + 0.65, rU + 0.6, sleeve, { capB: false });
      band(q, s, m, rU + 0.6, 0.86, 1.01, sleeve[0]);
    } else {
      const w = L(e, h, len === "bell" ? 0.82 : 0.74);
      limb(q, s, e, rU + 0.55, rU + 0.4, sleeve);
      limb(q, e, w, rU + 0.4, len === "bell" ? rL + 1.4 : rL + 0.5, sleeve, { capB: false });
      const c = cuffM || sleeve;
      band(q, e, w, len === "bell" ? rL + 1.4 : rL + 0.5, 0.72, 0.8, c[0]);
      band(q, e, w, len === "bell" ? rL + 1.4 : rL + 0.5, 0.8, 1.01, (x, y) => (q.get(x, y) === sleeve[0] ? c[0] : c[1]));
    }
  }
  if (hand) fist(q, h, skin, r);
  return q;
}
function fist(p, h, skin, r = 2.3, { grip = false } = {}) {
  const rx = Math.max(1.5, r * 0.78), ry = Math.max(1.4, r * 0.74);
  ellipseV(p, h[0] + 0.2, h[1] + 0.3, rx, ry, skin, { specular: false });
  if (grip) { p.set(Math.round(h[0] - rx * 0.4), Math.round(h[1] - ry * 0.6), skin[2]); p.set(Math.round(h[0] + rx * 0.5), Math.round(h[1] + 0.4), skin[0]); }
}
function legLayer(F, near, pants) {
  const q = lay(), b = F.build, m = near ? pants : back(pants);
  const hip = near ? F.hipN : F.hipF, knee = near ? F.kneeN : F.kneeF, ank = near ? F.ankleN : F.ankleF;
  limb(q, hip, knee, b.leg + 0.4, b.leg + 0.05, m); limb(q, knee, ank, b.leg + 0.05, b.leg * 0.86, m);
  // a crease behind the knee, the hem's shadow over the boot
  const kx = Math.round(knee[0]), ky = Math.round(knee[1]);
  q.set(kx - 1, ky - 1, m[0]); q.set(kx, ky, m[0]);
  return q;
}
function bootLayer(ank, m, sole) {
  const q = lay(), a = Math.round(ank[0]);
  const inside = (x, y) => (y >= 43 && y <= 48 && x >= a - 2 && x <= a + 2) || (y >= 46 && y <= 48 && x >= a - 2 && x <= a + (y === 46 ? 3 : 4));
  blob(q, inside, m, { rim: 1 });
  q.hl(a - 2, a + 4, 49, sole); q.set(a + 4, 49, sole); q.set(a + 3, 46, m[2]); q.set(a + 2, 46, m[2]);
  q.hl(a - 2, a + 2, 43, m[2]); q.set(a + 2, 43, m[1]); // the shaft's top edge in light
  return q;
}
function pelvisLayer(F, pants) {
  const q = lay(), { C, build: b } = F;
  const inside = (x, y) => y >= F.belt && y <= 35 && Math.abs(x + 0.5 - (C + 0.25)) <= b.hip + 0.6 - (y >= 34 ? 1 : 0) && !(y >= 33 && Math.abs(x + 0.5 - C) < 0.9 + (y - 33));
  blob(q, inside, pants, { rim: 1 });
  return q;
}
function beltLayer(F, torsoIn, { m = PAL.leather, buckle = PAL.brass } = {}) {
  const q = lay(), y0 = F.belt, fx = F.front;
  for (let x = 0; x < 44; x++) for (const y of [y0, y0 + 1]) if (torsoIn(x, y) || (y === y0 + 1 && torsoIn(x, y - 1))) q.set(x, y, y === y0 ? m[1] : m[0]);
  for (let y = y0; y <= y0 + 1; y++) { let x = 0; while (x < 44 && !q.get(x, y)) x++; q.set(x, y, m[2]); }
  q.set(fx, y0, buckle[3]); q.set(fx + 1, y0, buckle[2]); q.set(fx, y0 + 1, buckle[1]); q.set(fx + 1, y0 + 1, buckle[0]);
  return q;
}

// ---------- the top (torso clothes) ----------
// Returns the torso layer and the sleeve material and length for the arms.
function topLayer(F, style, top, skin, { check = false } = {}) {
  const q = lay(), C = F.C, fx = F.front, inside = torsoInside(F);
  blob(q, inside, top, { rim: 2 });
  const neckU = (x, y, rx = 2.6, ry = 2.2) => ((x - 22.3) / rx) ** 2 + ((y - F.top + 0.5) / ry) ** 2 <= 1;
  const onTorso = (x, y) => inside(x, y);
  const set = (x, y, c) => { if (onTorso(x, y)) q.set(x, y, c); };
  const fold = (pts, c = top[0]) => { for (const [x, y] of pts) set(x, y, c); };
  if (style === "tank") {
    // bare shoulders: the skin above a scooped neckline, two straps
    const sk = lay(); blob(sk, (x, y) => inside(x, y) && y <= 22, skin, { rim: 1 });
    const scoop = (x) => 19 + Math.max(0, 2.6 - Math.abs(x + 0.5 - (fx - 0.5)) * 0.6);
    const strap = (x) => Math.abs(x + 0.5 - (C - F.build.sw + 4.2)) <= 1.1 || Math.abs(x + 0.5 - (C + F.build.sw - 4.4)) <= 1.1;
    for (const [x, y] of sk.pixels().map(([x, y]) => [x, y])) if (y < scoop(x) && !strap(x)) q.set(x, y, sk.get(x, y));
    for (let x = 0; x < 44; x++) { const y = Math.ceil(scoop(x)); if (inside(x, y) && !strap(x) && q.get(x, y) !== null) set(x, y, top[2]); }
    fold([[fx + 1, 25], [fx + 2, 26], [fx + 2, 27]]);
    return { q, sleeve: null, len: "none" };
  }
  // the neck opening, the collar
  for (let y = F.top; y <= F.top + 2; y++) for (let x = 18; x <= 27; x++) if (neckU(x, y)) q.set(x, y, skin[1]);
  for (let y = F.top; y <= F.top + 3; y++) for (let x = 18; x <= 27; x++) if (!neckU(x, y) && neckU(x, y - 1) && inside(x, y)) q.set(x, y, x < 22 ? top[2] : top[0]);
  if (style === "jacket") {
    // open front over a shirt: the shirt's strip, lapels, the opening's edges, chest pockets, a fold
    const shirt = R(mix(desat(top[1], 0.6), "#d8d2c4", 0.55));
    for (let y = F.top + 1; y <= F.belt; y++) for (let x = fx - 1; x <= fx + 1; x++) set(x, y, x === fx + 1 ? shirt[0] : shirt[1]);
    for (let y = F.top + 1; y <= F.belt; y++) { set(fx - 2, y, top[0]); set(fx + 2, y, top[2]); }
    fold([[fx - 3, F.top + 1], [fx - 3, F.top + 2], [fx - 2, F.top + 3], [fx + 3, F.top + 1], [fx + 3, F.top + 2], [fx + 2, F.top + 3]], top[2]); // the lapels catch the light
    fold([[fx - 4, F.top + 3], [fx - 3, F.top + 4], [fx + 4, F.top + 3], [fx + 3, F.top + 4]], top[0]);
    for (const [x0, x1] of [[C - F.build.sw + 3, fx - 4], [fx + 4, C + F.build.sw - 3]]) { for (let x = Math.ceil(x0); x <= x1; x++) { set(x, 22, top[0]); set(x, 23, top[2]); } }
    fold([[C - 3, 26], [C - 2, 27]]);
    // a collar turned up round the back of the neck
    for (const [x, y] of [[18, F.top - 1], [19, F.top - 1], [18, F.top], [19, F.top], [20, F.top]]) q.set(x, y, y < F.top ? top[2] : top[1]);
    q.set(17, F.top, top[2]);
  } else if (style === "hoodie") {
    // drawstrings, the kangaroo pocket, a ribbed hem (the hood itself: hoodLayer, behind the head)
    const cord = PAL.white;
    for (let y = F.top + 2; y <= F.top + 6; y++) { set(fx - 1, y, cord[2]); if (y <= F.top + 5) set(fx + 1, y, cord[1]); }
    set(fx - 1, F.top + 7, cord[0]); set(fx + 1, F.top + 6, cord[0]);
    const px0 = Math.round(C - 3), px1 = Math.round(C + 5);
    for (let x = px0; x <= px1; x++) { set(x, 23, top[0]); set(x, 24, top[2]); }
    for (let y = 24; y <= 27; y++) { set(px0 - (y - 23 > 2 ? 1 : 0), y, top[0]); set(px1 + (y - 23 > 2 ? 1 : 0), y, top[0]); }
    for (let x = 0; x < 44; x++) { if (inside(x, F.bot) && q.get(x, F.bot)) q.set(x, F.bot, top[0]); if (inside(x, F.bot - 1) && x % 2 === 0) set(x, F.bot - 1, top[0]); }
  } else if (style === "flannel") {
    // a shirt collar's points, the button placket
    for (const [x, y, c] of [[19, F.top, top[2]], [20, F.top + 1, top[2]], [21, F.top + 2, top[1]], [25, F.top, top[1]], [24, F.top + 1, top[1]], [23, F.top + 2, top[0]]]) q.set(x, y, c);
    for (let y = F.top + 3; y <= F.belt; y++) set(fx, y, top[0]);
    for (let y = F.top + 4; y <= F.belt; y += 3) set(fx + 1, y, PAL.paper[2]);
    fold([[fx + 3, 24], [fx + 4, 25]]);
  } else { // t-shirt
    fold([[fx + 2, 21], [fx + 2, 22], [fx + 3, 23]]);
    fold([[C - 4, 25], [C - 3, 26]]);
  }
  if (check) flannelCheck(q, top);
  return { q, sleeve: top, len: style === "tshirt" ? "short" : "long" };
}
// A flannel's check: lines every 4 px both ways in the cloth's dark tone (a half step on the lit rim).
function flannelCheck(q, m) {
  const line = mix(m[1], m[0], 0.75), lineLit = mix(m[2], m[0], 0.45);
  for (const [x, y, c] of q.pixels()) {
    const vx = (x + 1) % 4 === 0, vy = (y + 2) % 4 === 0;
    if (!(vx || vy)) continue;
    if (c === m[1]) q.set(x, y, vx && vy ? m[0] : line); else if (c === m[2]) q.set(x, y, lineLit);
  }
}
// The hood of a hoodie bunched behind the neck (drawn before the head).
function hoodLayer(F, top) {
  const q = lay();
  ellipseV(q, 19.8, F.top - 0.6, 4.6, 2.7, top, { specular: false });
  ellipseV(q, 18.6, F.top - 2.2, 2.8, 2.6, top, { specular: false });
  for (let x = 19; x <= 22; x++) q.set(x, F.top - 1, top[0]); // the opening's shadow
  return q;
}

// ---------- head, face, hair ----------
const HC = [22.5, 8.5], HR = [5.4, 5.9];
function hairRamp(hex) { return R(hex); }
// The hairline: how far down hair reaches at column x (relative to the head's centre u = x - HC[0]): the forehead on
// the face side, a sideburn in front of the ear, the nape behind it.
function hairline(u, { fringe = true } = {}) {
  if (u >= 1.5) return HC[1] - 3.2 + (fringe && u > 2.5 && u < 4.5 ? 0.9 : 0);
  if (u >= -1.6) return HC[1] - 2.8;
  if (u >= -3) return HC[1] + 1.2; // the sideburn
  return HC[1] + 3.4;               // behind the ear, to the nape
}
const inHead = (x, y, grow = 0, c = HC, r = HR) => ((x - c[0]) / (r[0] + 0.5 + grow)) ** 2 + ((y - c[1]) / (r[1] + 0.5 + grow)) ** 2 <= 1;
// The hair behind the head and body: long hair's fall, a ponytail (drawn before the head, after the torso).
function hairBackLayer(style, hair) {
  const q = lay(), H = hairRamp(hair);
  if (style === "long") {
    const inside = (x, y) => y >= HC[1] - 2 && y <= 21 - (x < 17 ? 1 : 0) && x >= 15 + (y > 18 ? 1 : 0) && x <= 21 - Math.max(0, y - 17) * 0.5;
    blob(q, inside, H, { rim: 2 });
    for (const [x, y] of [[18, 15], [18, 16], [19, 17], [17, 17], [17, 18]]) q.set(x, y, H[0]); // strands
  } else if (style === "ponytail") {
    limb(q, [17.4, HC[1] - 1.2], [15.2, HC[1] + 4.5], 2.1, 1.6, H); limb(q, [15.2, HC[1] + 4.5], [15.8, HC[1] + 9.5], 1.6, 0.9, H);
    q.hl(16, 18, Math.round(HC[1] - 0.2), H[0]); // the tie
  }
  return q;
}
// The hair on the head (after the face): a shaded volume and one highlight run.
function hairLayer(style, hair, skin) {
  const q = lay(), H = hairRamp(hair), [hx, hy] = HC;
  const hi = (x0, x1, y) => { for (let x = x0; x <= x1; x++) if (q.get(x, y)) q.set(x, y, H[3]); };
  switch (style) {
    case "bald": return q;
    case "buzz": {
      const B = R(mix(skin[1], hair, 0.68));
      blob(q, (x, y) => inHead(x, y, 0.15) && y <= hairline(x - hx, { fringe: false }) - 0.4 && !(x - hx < -3 && x - hx > -4.6 && y > hy - 0.5), B, { rim: 1 });
      return q;
    }
    case "short": case "long": case "ponytail": {
      const longish = style !== "short";
      blob(q, (x, y) => inHead(x, y, 0.8, [hx - 0.4, hy - 0.4]) && y <= hairline(x - hx, { fringe: style === "short" }) + (longish && x - hx < -3 ? 1 : 0) && !(x - hx >= -4.8 && x - hx <= -2.8 && y >= hy + 0.2 && y <= hy + 2.4 && !longish), H, { rim: 2 });
      if (longish) blob(q, (x, y) => x - hx <= -2.8 && x - hx >= -6.6 && y >= hy - 1 && y <= hy + 5.5 && inHead(x, y, 1.4, [hx - 0.6, hy + 0.4]), H, { rim: 1 }); // the hair over the ear
      q.set(Math.round(hx - 2), Math.round(hy - 4.8), H[3]); q.set(Math.round(hx - 1), Math.round(hy - 4.8), H[2]); q.set(Math.round(hx - 3), Math.round(hy - 4), H[2]);
      q.set(Math.round(hx + 3), Math.round(hy - 3), H[0]); // a parting tuft's shadow
      return q;
    }
    case "mohawk": {
      const B = R(mix(skin[1], hair, 0.42));
      blob(q, (x, y) => inHead(x, y, 0.1) && y <= hairline(x - hx, { fringe: false }) - 0.4 && !(x - hx < -3 && x - hx > -4.6 && y > hy - 0.5), B, { rim: 1 });
      // the crest: a fin hugging the skull from the forehead to the nape, spiky along its top
      const crest = (x, y) => { const u = x - hx; if (u < -5.6 || u > 3.4 || y > hy - 0.5 + (u < -3 ? 3 : 0)) return false; const g = 1.8 + (x % 2 ? 1.2 : 0) - (u > 2 ? (u - 2) * 0.8 : 0); return inHead(x, y, g, [hx - 0.5, hy]) && !inHead(x, y, -0.6, [hx - 0.5, hy]) && (u < -3.4 || y < hy - 2.5); };
      blob(q, crest, H, { rim: 1 });
      q.set(Math.round(hx - 3), Math.round(hy - HR[1] - 1.4), H[3]); q.set(Math.round(hx - 2), Math.round(hy - HR[1] - 1.4), H[2]);
      return q;
    }
    case "curly": {
      const c = [hx - 0.7, hy - 1.3];
      const inside = (x, y) => { const dx = x - c[0], dy = y - c[1], a = Math.atan2(dy, dx), rr = 1 + 0.07 * Math.cos(a * 7); return (dx / (HR[0] + 1.9)) ** 2 + (dy / (HR[1] + 1.1)) ** 2 <= rr * rr && y <= hairline(x - hx, { fringe: false }) + (x - hx < -2.8 ? 1.5 : 0.4) && !(x - hx >= -4.5 && x - hx <= -2.8 && y >= hy + 0.2 && y <= hy + 2.4); };
      blob(q, inside, H, { rim: 2 });
      for (const [x, y] of [[18, 3], [19, 4], [22, 2], [23, 3], [16, 6], [17, 7], [25, 4], [26, 5], [20, 6], [21, 6]]) if (q.get(x, y) && q.get(x, y) !== H[2]) q.set(x, y, H[0]); // curls' shadows
      for (const [x, y] of [[17, 2], [18, 2], [21, 1], [15, 5]]) if (q.get(x, y)) q.set(x, y, H[3]);
      return q;
    }
    default: return q;
  }
}
function facialLayer(p, kind, hair, skin, f) {
  const H = hairRamp(hair), [hx, hy] = HC;
  if (kind === "stubble") {
    const st = skin.map((c) => mix(c, hair, 0.32));
    reg(st);
    for (let y = f.ey + 2; y <= f.chinY + 1; y++) for (let x = Math.round(hx - 3); x <= 30; x++) { const c = p.get(x, y), i = skin.indexOf(c); if (i >= 0 && !(y === f.mouth[2] && x >= f.mouth[0] && x <= f.mouth[1])) p.set(x, y, st[i]); }
    p.hl(f.mouth[0], f.mouth[1], f.mouth[2], skin[0]);
  } else if (kind === "beard") {
    const q = lay(), { edgeAt } = f;
    blob(q, (x, y) => { const u = x - hx; if (y < f.ey + 1 || u < -3.6) return false; if (y <= f.chinY) return x <= edgeAt(y) && (y >= f.ey + 2 || u < -2.2); return y <= f.chinY + 2 && u > -2.5 + (y - f.chinY) && x <= edgeAt(f.chinY) - (y - f.chinY); }, H, { rim: 1 });
    q.hl(f.mouth[0], f.mouth[1], f.mouth[2], mix(skin[0], "#5a2020", 0.35)); q.set(f.mouth[0] + 1, f.mouth[2] + 1, H[0]);
    q.set(f.nose[0] - 1, f.nose[1] + 1, null);
    put(p, q, false);
  } else if (kind === "stache") {
    const y = f.mouth[2] - 1, x1 = f.edgeAt(y);
    p.hl(x1 - 4, x1, y, H[1]); p.set(x1 - 4, y, H[2]); p.set(x1 - 3, y, H[2]); p.set(x1 - 4, y + 1, H[0]); p.set(x1 - 3, y + 1, H[0]); p.set(x1 - 2, y + 1, H[1]); p.set(x1, y + 1, H[0]);
  }
}
// The whole head: neck, head volume, face, facial hair, hair. opts.hood: no ears (a zealot's hood covers them).
function drawHead(p, { skin, hair, hairStyle = "short", facial = "none", ears = true, bald = false }) {
  const sk = S(skin);
  const nq = lay(); limb(nq, [22.6, 11], [22.2, 17], 2.1, 2.3, sk); for (let x = 20; x <= 25; x++) if (nq.get(x, 15)) nq.set(x, 15, sk[0]); put(p, nq);
  const hq = lay();
  const inside = headVolume(hq, HC, HR, sk, { specular: hairStyle === "bald" || bald });
  const hairDark = R(hair)[0], brow = lum(hair) < lum(skin) ? mix(hairDark, sk[0], 0.3) : sk[0];
  const f = face(hq, HC, HR, sk, { brow, inside, ear: ears });
  facialLayer(hq, facial, hair, sk, f);
  put(p, hq);
  put(p, hairLayer(hairStyle, hair, sk), false);
  return f;
}

// ---------- head gear ----------
function headgear(p, kind, col, f) {
  const A = Array.isArray(col) ? col : R(col), q = lay(), [hx, hy] = HC;
  if (kind === "cap") {
    blob(q, (x, y) => inHead(x, y, 0.75, [hx - 0.3, hy - 0.6]) && y <= hy - 2.3, A, { rim: 2 });
    for (let x = Math.round(hx + 2); x <= Math.round(hx + 8.4); x++) { q.set(x, Math.round(hy - 3), x > hx + 7.5 ? A[1] : A[2]); q.set(x, Math.round(hy - 2), A[0]); }
    q.set(Math.round(hx - 1), Math.round(hy - HR[1] - 1.1), A[2]); // the button
    q.set(Math.round(hx + 2), Math.round(hy - 4), A[0]); // the panel seam
    put(p, q);
  } else if (kind === "beanie") {
    blob(q, (x, y) => inHead(x, y, 0.85, [hx - 0.4, hy - 0.4]) && y <= hy - 1.6, A, { rim: 2 });
    const y0 = Math.round(hy - 3), y1 = Math.round(hy - 2);
    for (const [x, y, c] of q.pixels()) if (y >= y0 && y <= y1) q.set(x, y, y === y0 ? A[2] : (x % 2 ? A[1] : A[0]));
    for (const [x, y] of q.pixels()) if (y < y0 - 1 && x % 3 === 0 && q.get(x, y) === A[1]) q.set(x, y, A[0]);
    put(p, q);
  } else if (kind === "headband") {
    for (let x = 14; x <= 30; x++) for (const dy of [0, 1]) { const y = Math.round(hy - 3.4 + (x < hx - 3 ? 1 : 0)) + dy; if (inHead(x, y, 0.75, [hx - 0.4, hy - 0.4])) q.set(x, y, dy ? A[0] : A[2]); }
    limb(q, [16.6, hy - 1.5], [14.6, hy + 2.5], 1, 0.7, A); limb(q, [16.6, hy - 1.5], [15.8, hy + 3.8], 0.8, 0.6, A);
    put(p, q);
  } else if (kind === "bandana") { // over the nose and mouth, a point under the chin, knotted behind
    blob(q, (x, y) => { const u = x - hx; if (u < -3.2) return false; if (y >= f.ey + 1.2 && y <= f.chinY + 0.5) return x <= f.edgeAt(y) + (y === f.nose[1] || y === f.nose[1] - 1 ? 1 : 0); return y > f.chinY && y <= f.chinY + 4 && Math.abs(x - (hx + 1.6)) <= 4.6 - (y - f.chinY) * 1.1; }, A, { rim: 1 });
    q.set(Math.round(hx), f.chinY - 1, A[0]); q.set(Math.round(hx + 1), f.chinY, A[0]); q.set(Math.round(hx + 3), f.ey + 3, A[0]); // folds
    limb(q, [17.2, f.ey + 1.4], [15.4, f.ey + 4.4], 1.1, 0.8, A);
    put(p, q);
  } else if (kind === "glasses") {
    const fr = PAL.black[1], rim = PAL.black[2], gl = PAL.glass, y = f.ey;
    for (const ex of [f.exF, f.exN]) { p.hl(ex, ex + 1, y - 1, fr); p.set(ex - 1, y, fr); p.set(ex + 2, y, rim); p.set(ex + 1, y, gl[3]); p.hl(ex, ex + 1, y + 1, rim); }
    p.hl(Math.round(hx - 3.4), f.exF - 2, y, fr); // the arm back to the ear
  }
}

// ---------- armour (the item icons' vests, made to fit) ----------
function vestInside(F, torsoIn) {
  const { C, build: b } = F;
  return (x, y) => torsoIn(x, y) && y >= F.top + 1 && y <= F.belt + 1 && !(y <= F.top + 3 && Math.abs(x + 0.5 - 22.6) < 3.6 - (y - F.top) * 0.4) &&
    !(y <= F.top + 4 && (x < C - b.sw + 2.6 || x > C + b.sw - 2.8)) && x > C - b.sw + 1 && x < C + b.sw - 0.6 + b.belly;
}
function armorLayer(F, key, torsoIn) {
  if (!key) return null;
  const q = lay(), C = F.C, b = F.build, inV = vestInside(F, torsoIn);
  const x0 = Math.ceil(C - b.sw + 1.5), x1 = Math.floor(C + b.sw - 1.2 + b.belly), y0 = F.top + 1, y1 = F.belt + 1, fx = F.front;
  const fill = (m) => blob(q, inV, m, { rim: 2 });
  const boxr = (ax, ay, bx, by, m) => { for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (q.get(x, y)) q.set(x, y, y === ay || x === ax ? m[2] : y === by || x === bx ? m[0] : m[1]); };
  switch (key) {
    case "vest": { // police kevlar: navy, stitched panels, side straps, a white patch
      fill(PAL.navy);
      for (const y of [21, 25]) for (let x = x0 + 1; x <= x1 - 1; x++) if (q.get(x, y) === PAL.navy[1]) q.set(x, y, PAL.navy[2]);
      boxr(fx - 2, 22, fx + 2, 23, PAL.white); q.hl(fx - 1, fx + 1, 23, PAL.navy[0]);
      break;
    }
    case "plate": { // a plate carrier: olive, the plate pocket, molle rows, a cummerbund
      fill(PAL.olive);
      boxr(x0 + 2, 20, x1 - 2, y1 - 2, PAL.olive);
      for (const y of [22, 25]) for (let x = x0 + 3; x <= x1 - 3; x++) q.set(x, y, (x - x0) % 3 === 0 ? PAL.olive[3] : PAL.olive[0]);
      for (let y = 22; y <= y1; y++) { if (q.get(x0, y)) q.set(x0, y, PAL.olive[0]); if (q.get(x1 - 1, y)) q.set(x1 - 1, y, PAL.olive[0]); }
      break;
    }
    case "tacvest": { // black webbing with coyote mag pouches and a radio pouch
      fill(PAL.black);
      for (let k = 0; k < 3; k++) { const px = Math.round(C - 4.5 + k * 3.6); for (let y = 25; y <= 29; y++) for (let x = px; x <= px + 2; x++) q.set(x, y, y === 25 ? PAL.coyote[2] : y === 26 ? PAL.coyote[0] : x === px ? PAL.coyote[2] : x === px + 2 ? PAL.coyote[0] : PAL.coyote[1]); }
      for (let y = 20; y <= 22; y++) for (let x = fx + 1; x <= fx + 3; x++) q.set(x, y, y === 20 ? PAL.coyote[2] : x === fx + 3 ? PAL.coyote[0] : PAL.coyote[1]);
      q.vl(fx + 2, 17, 19, PAL.black[3]); // the antenna
      for (let y = 20; y <= 22; y++) for (let x = x0 + 2; x <= x0 + 3; x++) q.set(x, y, y === 20 ? PAL.coyote[2] : PAL.coyote[1]);
      break;
    }
    case "tirevest": { // tyre-rubber strips laced into a vest
      fill(PAL.black);
      for (let y = 19; y <= y1; y += 3) for (let x = x0; x <= x1; x++) if (q.get(x, y)) { q.set(x, y, PAL.black[0]); if (q.get(x, y + 1)) q.set(x, y + 1, PAL.black[2]); if ((x + y) % 4 === 0 && q.get(x, y + 2)) q.set(x, y + 2, PAL.black[0]); }
      for (let y = 20; y <= y1; y += 3) { q.set(fx, y, PAL.coyote[2]); q.set(fx + 1, y, PAL.coyote[1]); }
      break;
    }
    case "sportspads": { // football pads: hard white caps on the shoulders over a grey chest piece with laces
      blob(q, (x, y) => inV(x, y) && y >= 20, PAL.grey, { rim: 1 });
      for (let y = 21; y <= 27; y += 2) { q.set(fx - 1, y, PAL.white[2]); q.set(fx + 1, y, PAL.white[2]); q.set(fx, y + 1, PAL.grey[0]); }
      for (const sx of [C - b.sw + 2.4, C + b.sw - 2.6]) ellipseV(q, sx, 18.6, 3.4, 2.7, PAL.white, { specular: true });
      for (const sx of [C - b.sw + 2.4, C + b.sw - 2.6]) for (let x = Math.round(sx - 3); x <= Math.round(sx + 3); x++) if (q.get(x, 19) && Math.abs(x - sx) < 3) q.set(x, 19, PAL.white[0]);
      break;
    }
    case "scrapvest": { // steel plates riveted onto a leather vest
      fill(PAL.leather);
      for (const [px, py] of [[x0 + 1, 19], [fx, 19], [x0 + 1, 24], [fx, 24]]) {
        const w = Math.min(4, x1 - px - 1);
        for (let y = py; y <= py + 3; y++) for (let x = px; x <= px + w; x++) if (q.get(x, y)) q.set(x, y, y === py || x === px ? PAL.steel[2] : y === py + 3 || x === px + w ? PAL.steel[0] : PAL.steel[1]);
        q.set(px + 1, py + 1, PAL.steel[3]); q.set(px + w - 1, py + 2, PAL.iron[0]);
      }
      q.set(x0 + 3, 21, PAL.rust[1]); q.set(fx + 2, 26, PAL.rust[1]); q.set(fx + 3, 26, PAL.rust[2]);
      break;
    }
    case "padding": { // magazines duct-taped round the chest: glossy paper, colour covers, grey tape bands
      fill(PAL.paper);
      boxr(x0 + 2, 19, x0 + 5, 22, PAL.blue); boxr(fx, 19, fx + 3, 21, PAL.red); boxr(x0 + 3, 25, x0 + 6, 27, PAL.yellow);
      for (const y of [23, 28]) for (let x = x0; x <= x1; x++) if (q.get(x, y)) { q.set(x, y, PAL.grey[1]); if (q.get(x, y - 1)) q.set(x, y - 1, y === 23 ? PAL.grey[2] : PAL.grey[2]); }
      break;
    }
    default: { // any other armour: a grey vest with a plate seam
      fill(PAL.grey); for (let x = x0 + 1; x <= x1 - 1; x++) if (q.get(x, 23)) q.set(x, 23, PAL.grey[0]);
    }
  }
  return q;
}

// ---------- weapons ----------
export const GUN_LOOKS = {
  pistol: "pistol", compact9: "pistol", pistol45: "pistol", pistol22: "pistol", pistol57: "pistol", usp45: "pistol", fiveseven: "pistol", pipegun: "pistol",
  revolver: "revolver", snub357: "revolver", snub38: "revolver", service38: "revolver", revolver44: "revolver", magnum: "revolver",
  shotgun: "shotgun", semishotgun: "shotgun", dbshotgun: "shotgun", sawnoff: "shotgun", ou12: "shotgun", single12: "shotgun", pump20: "shotgun", ou20: "shotgun", tacpump: "shotgun",
  huntrifle: "huntrifle", bolt: "huntrifle", lever44: "huntrifle", leverrifle: "huntrifle", lever357: "huntrifle", single44: "huntrifle", singlerifle: "huntrifle", rifle22: "huntrifle", sniper: "huntrifle", varmint223: "huntrifle", ranch223: "huntrifle", single556: "huntrifle", single223: "huntrifle", single300: "huntrifle", m1a: "huntrifle", dmr: "ar", amr: "huntrifle",
  ar: "ar", ar15rifle: "ar", ar223: "ar", ar300: "ar", sbr300: "ar", ardmr: "ar", arpistol: "ar", carbine: "ar", m4: "ar", hk416: "ar", scarl: "ar", scarh: "ar", aug: "ar", famas: "ar", fal: "ak", g3: "ar", smg: "ar", mp5: "ar", ump45: "ar", p90: "ar", vector: "ar", lmg: "ar", m240: "ar",
  ak: "ak", akm: "ak",
  compbow: "compbow", pulleybow: "compbow", bow: "compbow", crossbow: "crossbow", xbow: "crossbow",
};
const MELEE = new Set(["knife", "huntknife", "combatknife", "machete", "sawmachete", "springmachete", "bat", "nailbat", "spikedbat", "crowbar", "prybar", "fireaxe", "sledge", "spear", "pipespear", "hatchet", "tomahawk", "baton", "stunbaton", "katana", "kukri", "pickaxe", "hammer", "etool", "golfclub", "fists", ...Object.keys(BLADE_LOOK)]);
export function gunKind(key) {
  if (!key || MELEE.has(key)) return null;
  if (GUN_LOOKS[key]) return GUN_LOOKS[key];
  if (/bow/.test(key)) return "compbow";
  if (/(pistol|9$|45$|22$)/.test(key)) return "pistol";
  if (/(revolver|snub|magnum|38|357|44)/.test(key)) return "revolver";
  if (/(shot|12|20|pump)/.test(key)) return "shotgun";
  if (/(rifle|lever|single|sniper|varmint)/.test(key)) return "huntrifle";
  if (/^(m79|m203|m32|rpg|at4)$/.test(key)) return "tube";
  return /^(ar|m\d|hk|scar|smg|mp|ump|p90|lmg|m2)/.test(key) ? "ar" : null;
}
// A melee weapon in the near hand at h, its shaft up and forward along (dx, -1) per row. Drawn over the arm; the
// fist goes over its handle afterwards.
function meleeLayer(key, h) {
  const q = lay(), [hx, hy] = [Math.round(h[0]), Math.round(h[1])];
  const at = (t, k = 0.5) => [hx + t * k, hy - t]; // t rows up the shaft from the hand, k: columns per row
  const shaft = (t0, t1, w, m, k = 0.5, w1 = w, edge) => { const a = at(t0, k), b = at(t1, k); bar(q, a[0], a[1], b[0], b[1], w, m, w1, edge); };
  const blade = (t0, t1, w, m = PAL.steel, k = 0.5) => { shaft(t0, t1, w, m, k, 1, m[3]); const a = at(t0 + 1, k), b = at(t1 - 2, k); q.line(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]), m[2]); };
  const L2 = BLADE_LOOK[key];
  switch (key) {
    case "knife": case "steakknife": shaft(-3, 2, 2, PAL.black); blade(2, 9, 3); break;
    case "combatknife": case "survivalknife": case "bayonet":
      shaft(-3, 2, 2, PAL.black); bar(q, hx - 1, hy - 2, hx + 3, hy - 3, 1, PAL.steel); blade(3, 11, 3, PAL.iron); break;
    case "huntknife": case "bowie": shaft(-3, 2, 2, PAL.wood); bar(q, hx - 1, hy - 2, hx + 3, hy - 3, 1, PAL.brass); blade(3, key === "bowie" ? 12 : 10, 3); break;
    case "machete": case "sawmachete": case "springmachete": case "kukri": case "cutlass": case "sabre": case "katana": case "broadsword": {
      const long = key === "katana" || key === "sabre" || key === "broadsword" ? 18 : key === "cutlass" ? 15 : 14;
      shaft(-3, 2, 2, key === "katana" || key === "sabre" ? PAL.black : PAL.wood);
      if (key !== "machete" && key !== "sawmachete" && key !== "kukri") bar(q, hx - 2, hy - 2, hx + 3, hy - 3, 1, key === "katana" ? PAL.brass : PAL.brass);
      shaft(2, long - 2, 3, PAL.steel, 0.5, 3, PAL.steel[3]); shaft(long - 2, long + 1, 3, PAL.steel, 0.5, 1, PAL.steel[3]);
      const a = at(3), b = at(long - 3); q.line(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]), PAL.steel[2]);
      if (key === "sawmachete") for (let t = 4; t < long - 2; t += 2) { const c = at(t); q.set(Math.round(c[0]) - 1, Math.round(c[1]), PAL.steel[0]); }
      break;
    }
    case "bat": case "nailbat": case "spikedbat": case "golfclub": {
      if (key === "golfclub") { shaft(-3, 17, 1, PAL.steel); bar(q, ...at(17), at(17)[0] + 3, at(17)[1], 2, PAL.iron); break; }
      shaft(-3, 2, 2, PAL.ash); shaft(2, 16, 2, PAL.ash, 0.5, 4); ellipseV(q, ...at(16.5), 1.8, 1.8, PAL.ash, { specular: false });
      ellipseV(q, ...at(-3.6), 1.2, 1, PAL.ash, { specular: false });
      if (key !== "bat") for (const t of [9, 12, 15]) { const c = at(t); q.line(Math.round(c[0]) - 2, Math.round(c[1]), Math.round(c[0]) - 4, Math.round(c[1]) - 1, PAL.steel[2]); q.set(Math.round(c[0]) - 4, Math.round(c[1]) - 1, PAL.steel[3]); q.line(Math.round(c[0]) + 3, Math.round(c[1]) + 1, Math.round(c[0]) + 4, Math.round(c[1]) + 2, PAL.steel[1]); }
      if (key === "spikedbat") for (const t of [10.5, 13.5]) { const c = at(t); q.hl(Math.round(c[0]) - 1, Math.round(c[0]) + 2, Math.round(c[1]), PAL.iron[1]); }
      break;
    }
    case "crowbar": case "prybar": {
      const m = key === "crowbar" ? PAL.red : PAL.iron, e = key === "crowbar" ? PAL.steel : PAL.iron;
      shaft(-4, 13, 2, m); const t = at(13); const tx = Math.round(t[0]), ty = Math.round(t[1]);
      q.hl(tx, tx + 3, ty - 1, e[1]); q.set(tx, ty - 1, e[2]); q.set(tx + 1, ty - 2, e[2]); q.set(tx + 2, ty - 2, e[3]); q.set(tx + 4, ty, e[1]); q.set(tx + 4, ty + 1, e[0]);
      const bt = at(-4); q.set(Math.round(bt[0]) - 1, Math.round(bt[1]) + 1, e[1]);
      break;
    }
    case "fireaxe": case "pickaxe": {
      shaft(-4, 15, 2, PAL.wood); const t = at(14), tx = Math.round(t[0]), ty = Math.round(t[1]);
      const H = key === "fireaxe" ? PAL.red : PAL.iron;
      for (let x = tx + 1; x <= tx + 5; x++) { const hh = 1 + (x - tx) * 0.55; for (let y = Math.round(ty - hh); y <= Math.round(ty + hh); y++) q.set(x, y, y === Math.round(ty - hh) ? H[2] : y === Math.round(ty + hh) ? H[0] : H[1]); }
      if (key === "fireaxe") { q.vl(tx + 6, ty - 3, ty + 3, PAL.steel[3]); q.vl(tx + 5, ty - 3, ty + 3, PAL.steel[2]); }
      for (let x = tx - 3; x <= tx - 1; x++) { q.set(x, ty, H[1]); q.set(x, ty - 1, H[2]); } q.set(tx - 4, ty, PAL.steel[2]);
      q.set(tx, ty - 1, H[0]); q.set(tx, ty, H[0]); q.set(tx, ty + 1, H[0]);
      break;
    }
    case "hatchet": case "tomahawk": case "hammer": {
      shaft(-3, 8, 2, key === "tomahawk" ? PAL.black : PAL.wood); const t = at(8), tx = Math.round(t[0]), ty = Math.round(t[1]);
      if (key === "hammer") { for (let y = ty - 1; y <= ty + 1; y++) q.hl(tx - 2, tx + 3, y, y === ty - 1 ? PAL.iron[2] : y === ty + 1 ? PAL.iron[0] : PAL.iron[1]); break; }
      for (let x = tx + 1; x <= tx + 4; x++) { const top = ty - 1 - Math.floor((x - tx) * 0.4), bot = ty + 1 + Math.floor((x - tx) * 0.6); for (let y = top; y <= bot; y++) q.set(x, y, y === top ? PAL.steel[2] : y === bot ? PAL.steel[0] : PAL.steel[1]); }
      q.vl(tx + 5, ty - 2, ty + 3, PAL.steel[3]); q.set(tx - 1, ty, PAL.steel[0]); q.set(tx - 1, ty - 1, PAL.steel[1]);
      break;
    }
    case "sledge": case "etool": {
      shaft(-4, 14, 2, key === "etool" ? PAL.olive : PAL.wood); const t = at(14.5), tx = Math.round(t[0]), ty = Math.round(t[1]);
      if (key === "etool") { for (let y = ty - 4; y <= ty; y++) q.hl(tx - 1, tx + 2, y, y === ty - 4 ? PAL.olive[2] : PAL.olive[1]); q.vl(tx + 2, ty - 3, ty, PAL.olive[0]); break; }
      for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 3; x <= tx + 4; x++) q.set(x, y, y === ty - 2 ? PAL.steel[2] : y === ty + 2 || x === tx + 4 ? PAL.steel[0] : x === tx - 3 ? PAL.steel[2] : PAL.steel[1]);
      q.hl(tx - 2, tx + 1, ty - 1, PAL.steel[3]);
      break;
    }
    case "baton": case "stunbaton": {
      shaft(-3, 3, 2, PAL.black); shaft(3, 8, 2, PAL.iron); shaft(8, 12, 1, PAL.iron);
      const t = at(12.5); ellipseV(q, t[0], t[1], 1.1, 1.1, key === "stunbaton" ? PAL.yellow : PAL.steel, { specular: false });
      break;
    }
    case "spear": case "pipespear": {
      const k = 0.36, m = key === "spear" ? PAL.ash : PAL.iron;
      shaft(-9, 20, 2, m, k); const t = at(20, k), tx = Math.round(t[0]), ty = Math.round(t[1]);
      if (key === "spear") { bar(q, tx - 1, ty + 1, tx + 2, ty + 1, 1, PAL.iron); bar(q, tx, ty, tx + 2.5, ty - 7, 3, PAL.steel, 1, PAL.steel[3]); q.line(tx + 1, ty - 1, tx + 2, ty - 5, PAL.steel[2]); }
      else { bar(q, tx, ty, tx + 2, ty - 6, 2, PAL.steel, 1, PAL.steel[3]); q.set(tx - 1, ty + 2, PAL.grey[2]); q.set(tx, ty + 2, PAL.grey[2]); q.set(tx, ty + 3, PAL.grey[1]); q.set(tx + 1, ty + 3, PAL.grey[1]); }
      break;
    }
    default: {
      if (L2) { // the knives and swords of data-blades.js by their look: blade length, colours, a guard
        const len = 2 * L2.len + 2, B = R(L2.blade), Hd = R(L2.handle);
        shaft(-1 - (L2.hilt || 2), 2, 2, Hd);
        if (L2.guard) bar(q, hx - 1, hy - 2, hx + 3, hy - 3, 1, R(L2.guard));
        shaft(3, len, len > 9 ? 3 : 2, B, 0.5, 1, B[3]);
      } else { shaft(-3, 2, 2, PAL.wood); shaft(2, 13, 2, PAL.wood, 0.5, 3); } // a club
    }
  }
  return q;
}
// A long gun along row y (the receiver's middle), grip hand at g, its butt at bx; returns the muzzle.
function longGunLayer(kind, g, bx, maxX = 42, axisY = g[1] - 4.2) {
  const q = lay(), gx = Math.round(g[0]), y = Math.round(axisY);
  const run = (x0, x1, yy, c) => q.hl(Math.round(x0), Math.round(x1), yy, c);
  const body = (x0, x1, y0, y1, m) => { for (let yy = y0; yy <= y1; yy++) run(x0, x1, yy, yy === y0 ? m[2] : yy === y1 ? m[0] : m[1]); };
  const hiLine = (x0, x1, yy, c) => run(x0, x1, yy, c);
  const grip = (m) => { for (let k = 0; k < 5; k++) { q.set(gx - Math.floor(k / 2), y + 2 + k, k === 4 ? m[0] : m[1]); q.set(gx - Math.floor(k / 2) + 1, y + 2 + k, m[0]); } };
  const guard = () => { q.set(gx + 2, y + 2, PAL.iron[1]); q.set(gx + 3, y + 3, PAL.iron[1]); q.set(gx + 2, y + 3, null); };
  let mx = maxX;
  if (kind === "ar") {
    const W = PAL.black, I = PAL.iron;
    body(bx, bx + 3, y - 1, y + 2, W); q.set(bx + 3, y + 2, null); run(bx + 4, gx - 3, y, I[1]); run(bx + 4, gx - 3, y - 1, I[2]); // stock on its buffer tube
    body(gx - 3, gx + 3, y - 1, y + 1, I); hiLine(gx - 2, gx + 3, y - 1, I[3]); run(gx - 2, gx + 2, y - 2, W[1]); q.set(gx + 1, y - 3, W[2]); q.set(gx - 1, y - 3, W[2]); // receiver, rail, sights
    for (let k = 0; k < 4; k++) run(gx + 1 + (k >> 1), gx + 2 + (k >> 1), y + 2 + k, k === 3 ? I[0] : I[1]); // the magazine
    body(gx + 4, gx + 9, y - 1, y + 1, W); for (let x = gx + 5; x <= gx + 8; x += 2) q.set(x, y, W[0]); // handguard and its vents
    run(gx + 10, mx - 1, y, I[1]); run(gx + 10, mx - 1, y - 1, I[2]); q.set(mx, y - 1, I[2]); q.set(mx, y, I[1]); q.set(gx + 9, y - 2, W[1]); q.set(gx + 9, y - 3, W[2]);
    grip(W); guard();
  } else if (kind === "ak") {
    const W = PAL.wood, I = PAL.iron;
    for (let x = bx; x <= gx - 3; x++) { const t = (x - bx) / Math.max(1, gx - 3 - bx), top = y - 1 + (t < 0.3 ? 0 : 0), bot = y + 2 - Math.round(t * 1.4); for (let yy = top; yy <= bot; yy++) q.set(x, yy, yy === top ? W[2] : yy === bot ? W[0] : W[1]); }
    body(gx - 3, gx + 3, y - 1, y + 1, I); hiLine(gx - 3, gx + 3, y - 1, I[3]);
    for (let k = 0; k < 5; k++) run(gx + 1 + Math.round(k * 0.7), gx + 2 + Math.round(k * 0.7), y + 2 + k, k === 4 ? I[0] : I[1]); // the curved magazine
    body(gx + 4, gx + 8, y - 1, y + 1, W); run(gx + 4, gx + 9, y - 2, I[1]);
    run(gx + 9, mx - 1, y, I[1]); run(gx + 9, mx - 1, y - 1, I[2]); q.set(mx, y - 1, I[1]); q.set(mx - 1, y - 2, I[2]); q.set(mx - 1, y - 3, I[2]);
    grip(W); guard();
  } else if (kind === "shotgun") {
    const W = PAL.wood, I = PAL.iron;
    for (let x = bx; x <= gx - 2; x++) { const t = (x - bx) / Math.max(1, gx - 2 - bx), bot = y + 2 - Math.round(t * 1.4); for (let yy = y - 1; yy <= bot; yy++) q.set(x, yy, yy === y - 1 ? W[2] : yy === bot ? W[0] : W[1]); }
    body(gx - 2, gx + 3, y - 1, y + 1, I); hiLine(gx - 2, gx + 3, y - 1, I[3]);
    run(gx + 4, mx - 1, y - 1, I[2]); run(gx + 4, mx - 1, y, I[1]); run(gx + 4, mx - 2, y + 1, I[0]); q.set(mx - 1, y - 2, PAL.brass[2]); // barrel over the magazine tube, a bead sight
    body(gx + 5, gx + 9, y, y + 2, W); for (let x = gx + 6; x <= gx + 8; x += 2) q.set(x, y + 1, W[0]); // the pump's grooves
    grip(W); guard();
  } else if (kind === "huntrifle") {
    const W = PAL.wood, I = PAL.iron;
    for (let x = bx; x <= gx - 2; x++) { const t = (x - bx) / Math.max(1, gx - 2 - bx), bot = y + 2 - Math.round(t * 1.6); for (let yy = y - 1; yy <= bot; yy++) q.set(x, yy, yy === y - 1 ? W[2] : yy === bot ? W[0] : W[1]); }
    body(gx - 2, gx + 2, y - 1, y, I); body(gx - 2, gx + 9, y + 1, y + 1, W); run(gx + 3, gx + 9, y, W[1]); run(gx + 3, gx + 9, y - 1, W[2]); run(gx + 3, gx + 9, y + 1, W[0]); // receiver, the long fore-end
    run(gx + 10, mx - 1, y - 1, I[2]); run(gx + 10, mx - 1, y, I[0]);
    q.set(gx - 1, y + 1, PAL.steel[2]); q.set(gx - 2, y + 1, PAL.steel[1]); // the bolt handle
    for (let x = gx - 3; x <= gx + 5; x++) { q.set(x, y - 3, I[2]); q.set(x, y - 2, I[0]); } q.set(gx - 3, y - 3, I[1]); q.set(gx + 5, y - 3, PAL.glass[2]); q.set(gx + 5, y - 2, PAL.glass[0]); q.set(gx - 1, y - 3, I[3]); // the scope, its lens
    grip(W); guard();
  } else if (kind === "crossbow") {
    const W = PAL.ash, I = PAL.iron, fx = Math.min(mx - 2, gx + 8);
    body(bx, fx, y - 1, y + 1, W); for (let x = bx; x <= gx - 3; x++) q.set(x, y + 2, W[0]); q.set(bx, y + 2, W[0]);
    for (let k = -6; k <= 6; k++) { const xx = fx + 1 - Math.round((k * k) / 14); q.set(xx, y + k, Math.abs(k) < 2 ? I[1] : k < 0 ? I[2] : I[0]); q.set(xx + 1, y + k, I[1]); } // the prod, side on
    q.line(fx - 2, y - 6, gx + 1, y - 1, PAL.white[1]); q.line(fx - 2, y + 6, gx + 1, y + 1, PAL.white[0]); // the string, drawn back to the latch
    run(gx, fx + 2, y - 2, PAL.steel[1]); q.set(fx + 3, y - 2, PAL.steel[3]); q.set(gx + 1, y - 2, PAL.red[1]); // the bolt and its fletching
    grip(PAL.ash); mx = fx + 3;
    return { q, mx, my: y - 2 };
  } else { // a tube (launchers) or anything else: a plain olive tube
    body(bx + 2, mx, y - 2, y + 1, PAL.olive); grip(PAL.black); mx += 0;
  }
  return { q, mx: mx + 1, my: y - 1 };
}
function pistolLayer(kind, h) {
  const q = lay(), hx = Math.round(h[0]), hy = Math.round(h[1]), I = kind === "revolver" ? PAL.steel : PAL.iron;
  const y = hy - 2;
  if (kind === "revolver") {
    for (let x = hx - 2; x <= hx + 6; x++) { q.set(x, y - 1, I[2]); q.set(x, y, x > hx + 1 ? I[0] : I[1]); }
    for (let yy = y - 1; yy <= y + 1; yy++) for (let x = hx - 1; x <= hx + 1; x++) q.set(x, yy, yy === y - 1 ? I[2] : yy === y + 1 ? I[0] : x === hx + 1 ? I[0] : I[1]); // the cylinder
    q.set(hx - 1, y - 1, I[3]); q.set(hx - 2, y - 2, I[1]); // the hammer
    for (let k = 0; k < 3; k++) { q.set(hx - 1 - (k >> 1), y + 1 + k, PAL.wood[1]); q.set(hx - (k >> 1), y + 1 + k, PAL.wood[0]); }
    q.set(hx + 6, y - 2, I[1]);
    return { q, mx: hx + 7, my: y - 1 };
  }
  for (let x = hx - 2; x <= hx + 4; x++) { q.set(x, y - 1, I[2]); q.set(x, y, I[1]); } q.set(hx - 1, y - 1, I[3]); q.set(hx, y - 1, I[3]); q.set(hx + 4, y, I[0]); // slide
  for (let k = 0; k < 3; k++) { q.set(hx - 1 - (k >> 1), y + 1 + k, PAL.black[1]); q.set(hx - (k >> 1), y + 1 + k, PAL.black[0]); }
  q.set(hx + 1, y + 1, PAL.black[1]);
  return { q, mx: hx + 5, my: y - 1 };
}
function bowLayer(h) {
  const q = lay(), hx = Math.round(h[0]), hy = Math.round(h[1]), K = PAL.black;
  for (let y = hy - 4; y <= hy + 4; y++) { q.set(hx, y, K[2]); q.set(hx + 1, y, K[1]); q.set(hx + 2, y, K[0]); } // the riser
  for (let k = 5; k <= 12; k++) for (const s of [-1, 1]) { const x = hx + 1 - Math.round(((k - 5) / 7) ** 1.6 * 3), y = hy + s * k; q.set(x, y, s < 0 ? K[2] : K[1]); q.set(x + 1, y, K[0]); } // the limbs, bending back
  for (const s of [-1, 1]) ellipseV(q, hx - 2, hy + s * 13, 1.3, 1.3, PAL.steel, { specular: false }); // the cams
  q.vl(hx - 4, hy - 12, hy + 12, PAL.white[1]); // the string
  q.hl(hx - 3, hx + 5, hy - 1, PAL.ash[2]); q.set(hx + 6, hy - 1, PAL.steel[2]); q.set(hx - 4, hy - 1, PAL.red[1]); q.set(hx - 4, hy - 2, PAL.red[2]); // an arrow nocked
  return { q, mx: hx + 6, my: hy - 1 };
}

// ---------- the figure ----------
// Draws a dressed figure; `look` holds every material and option (survivors and hostiles share it).
function figure(look, weaponKey, armorKey) {
  const p = painter(44, 52), F = frame(look.build), b = F.build;
  const skin = S(look.skin), top = look.topM, pants = look.pantsM;
  const kind = gunKind(weaponKey), melee = !!weaponKey && !kind;
  const long = !!kind && !["pistol", "revolver", "compbow"].includes(kind);
  if (long) F.turn = 1.6;
  const hold = long ? gunHold(F, "long") : kind === "compbow" ? gunHold(F, "bow") : kind ? gunHold(F, "pistol") : null;
  const torsoIn = torsoInside(F);
  const t = look.robe ? { q: null, sleeve: top, len: "bell" } : topLayer(F, look.topStyle, top, skin, { check: look.topStyle === "flannel" });
  const sleeve = look.sleeveM || t.sleeve, slen = look.sleeveLen || t.len;
  // behind: the pack, the far leg, the far arm
  if (look.accessory === "backpack") { const q = lay(); blob(q, (x, y) => y >= 17 && y <= 30 && x >= Math.round(F.C - b.sw - 3.6) && x <= Math.round(F.C - b.sw + 4) && !(y === 17 && x < F.C - b.sw - 1) && !(y === 30 && x < F.C - b.sw - 1), look.packM, { rim: 2 }); const x0 = Math.round(F.C - b.sw - 3.6); q.hl(x0 + 1, x0 + 4, 22, look.packM[0]); q.hl(x0 + 1, x0 + 4, 23, look.packM[2]); q.set(x0 + 2, 24, PAL.steel[2]); put(p, q); }
  if (!look.robe) { put(p, legLayer(F, false, pants)); put(p, bootLayer(F.ankleF, back(look.bootM), PAL.black[0]), false); }
  const farSleeve = sleeve ? back(sleeve) : null, farSkin = back(skin);
  if (long) put(p, armLayer(hold.shoulderF, hold.elbowF, hold.handF, { skin: farSkin, sleeve: farSleeve, len: slen, r: b.r * 0.95, hand: false }));
  else put(p, armLayer(F.shoulderF, F.elbowF, F.handF, { skin: farSkin, sleeve: farSleeve, len: slen, r: b.r }));
  if (look.armbandF) band(p, F.shoulderF, F.elbowF, b.r + 0.6, 0.45, 0.68, (x, y) => (p.get(x, y) ? look.armbandF[x < F.shoulderF[0] - 0.5 ? 2 : 1] : null), { only: (x, y) => !!p.get(x, y) });
  // the legs and the body
  if (look.robe) put(p, robeLayer(F, look, skin));
  else {
    put(p, legLayer(F, true, pants)); put(p, bootLayer(F.ankleN, look.bootM, PAL.black[0]), false);
    put(p, pelvisLayer(F, pants), false);
    if (look.pantsDetail) look.pantsDetail(p, F);
    put(p, t.q);
    if (look.topDetail) look.topDetail(p, F, torsoIn);
    if (!(look.topStyle === "hoodie")) put(p, beltLayer(F, torsoIn, look.beltM ? { m: look.beltM, buckle: look.buckleM || PAL.brass } : {}), false);
  }
  const arm = armorLayer(F, armorKey, torsoIn); if (arm) put(p, arm);
  if (look.accessory === "backpack") { // the straps over the shoulders
    const st = PAL.black;
    for (const sx of [F.C - b.sw + 3.4, F.C + b.sw - 4.6]) for (let y = F.top; y <= 26; y++) { const x = Math.round(sx + (y > 20 ? (sx < F.C ? 0.3 : -0.3) * (y - 20) : 0)); if (torsoIn(x, y)) { p.set(x, y, st[2]); p.set(x + 1, y, st[0]); } }
    p.set(Math.round(F.C + b.sw - 4.6), 23, PAL.steel[2]);
  }
  // the hood behind the head, long hair over the shoulders
  if (look.topStyle === "hoodie" && !look.robe) put(p, hoodLayer(F, top));
  if (!look.robe && look.hairStyle) { const hb = hairBackLayer(look.hairStyle, look.hair); if (hb.count()) put(p, hb); }
  // the head
  const f = drawHead(p, { skin: look.skin, hair: look.hair, hairStyle: look.hood ? "buzz" : look.hairStyle, facial: look.facial, ears: !look.hood });
  if (look.hood) put(p, look.hood(F, f));
  if (look.headgear) look.headgear(p, f);
  else if (look.accessory && look.accessory !== "none" && look.accessory !== "backpack") headgear(p, look.accessory, look.accentM, f);
  // the near arm and what it holds
  const armOpts = { skin, sleeve, len: slen, r: b.r };
  const band2 = (q, s, e) => { if (look.armbandN) band(q, s, e, b.r + 0.6, 0.45, 0.7, (x, y) => look.armbandN[q.get(x, y) === sleeve?.[2] || x < s[0] - 0.6 ? 2 : q.get(x, y) === sleeve?.[0] ? 0 : 1], { only: (x, y) => !!q.get(x, y) }); if (look.nearArmDetail) look.nearArmDetail(q, s, e); };
  if (long) {
    const ff = lay(); fist(ff, hold.handF, back(skin), b.r * 0.9, { grip: true }); put(p, ff);
    // the upper arm, then the gun with its stock tucked against it, then the forearm in front of the grip
    const uq = armLayer(hold.shoulderN, hold.elbowN, hold.elbowN, { ...armOpts, hand: false }); band2(uq, hold.shoulderN, hold.elbowN); put(p, uq);
    const g = longGunLayer(kind === "tube" ? "tube" : kind, hold.grip, Math.round(hold.butt[0]), 42, hold.axisY);
    put(p, g.q);
    const aq = armLayer(hold.shoulderN, hold.elbowN, hold.handN, { ...armOpts, hand: false });
    for (const [x, y] of aq.pixels()) { const t = ((x - hold.elbowN[0]) * (hold.handN[0] - hold.elbowN[0]) + (y - hold.elbowN[1]) * (hold.handN[1] - hold.elbowN[1])); if (t < 0) aq.clear(x, y); } // the forearm only
    put(p, aq);
    const gq = lay(); fist(gq, hold.grip, skin, b.r, { grip: true }); put(p, gq, false);
    p.muzzle = { mx: g.mx, my: g.my };
  } else if (kind) {
    const aq = armLayer(hold.shoulderN, hold.elbowN, hold.handN, { ...armOpts, hand: false }); band2(aq, hold.shoulderN, hold.elbowN); put(p, aq);
    const g = kind === "compbow" ? bowLayer(hold.handN) : pistolLayer(kind, hold.handN);
    put(p, g.q);
    const gq = lay(); fist(gq, hold.handN, skin, b.r, { grip: true }); put(p, gq, false);
    p.muzzle = { mx: g.mx, my: g.my };
  } else if (melee) {
    const s = F.shoulderN, [e, h] = elbowToward(s, [s[0] + 3.4, s[1] + 12.6], [s[0] + 0.2, s[1] + 7.2], 8, null);
    const aq = armLayer(s, e, h, { ...armOpts, hand: false }); band2(aq, s, e); put(p, aq);
    put(p, meleeLayer(weaponKey, h));
    const gq = lay(); fist(gq, h, skin, b.r, { grip: true }); put(p, gq, false);
    p.muzzle = null;
  } else {
    const aq = armLayer(F.shoulderN, F.elbowN, F.handN, armOpts); band2(aq, F.shoulderN, F.elbowN); put(p, aq);
    p.muzzle = null;
  }
  return p;
}

// ---------- survivors ----------
const BOOTS = [PAL.leather, PAL.black, R("#4a3a2c")];
export function lookOfApp(app) {
  const h = hash(`${app.skin}${app.hair}${app.top}${app.pants}`);
  return {
    build: app.build, skin: app.skin, hair: app.hair, hairStyle: app.hairStyle, facial: app.facial,
    topStyle: app.topStyle, topM: R(app.top), pantsM: R(app.pants), bootM: BOOTS[h % BOOTS.length],
    accessory: app.accessory, accentM: R(app.accent), packM: R(mix(app.accent, "#6b5a3a", 0.55)),
    pantsDetail: (p, F) => { const x = Math.round(F.C + F.build.hip - 1.5); p.over(x, 31, R(app.pants)[0]); p.over(x + 1, 32, R(app.pants)[0]); }, // a pocket's edge
  };
}
export function paintSurvivorHD(app, weaponKey = null, armorKey = null, pose = "stand") {
  return figure(lookOfApp(app), weaponKey, armorKey, pose);
}

// ---------- hostile humans ----------
// Soldiers' camo: 2-3 large blobs, recolouring the cloth's ramp so the light stays.
function camo(p, from, seed) {
  const rng = new Rng(seed * 7919 + 3), A = R(shade(from[1], -0.28)), B = R(mix(from[1], "#6b5a3a", 0.6));
  const blobs = [];
  for (let i = 0; i < 6; i++) blobs.push([10 + rng.next() * 24, 16 + rng.next() * 30, 2.2 + rng.next() * 2, 1.6 + rng.next() * 1.4, i % 2 ? B : A]);
  for (const [x, y, c] of p.pixels()) {
    const i = from.indexOf(c); if (i < 0) continue;
    for (const [bx, by, rx, ry, m] of blobs) if (((x - bx) / rx) ** 2 + ((y - by) / ry) ** 2 <= 1) { p.set(x, y, m[i]); break; }
  }
}
function robeLayer(F, look, skin) {
  const q = lay(), m = look.topM, { C, build: b } = F;
  const half = (y) => (y < F.top + 2 ? b.sw - (F.top + 2 - y) * 1.3 : y < 27 ? b.sw + (b.waist - b.sw) * Math.min(1, (y - F.top - 2) / 9) : b.waist + (y - 27) * 0.18);
  const inside = (x, y) => y >= F.top && y <= 47 - (x % 3 === 0 && y === 47 ? 1 : 0) && Math.abs(x + 0.5 - C) <= half(y) + (y > 20 && y < 31 ? b.belly * 0.6 : 0);
  blob(q, inside, m, { rim: 2 });
  for (const [fx, y0] of [[C - 3, 31], [C + 1, 33], [C + 5, 30], [C - 6, 35]]) for (let y = y0; y <= 46; y++) { const x = Math.round(fx + (y - y0) * (fx < C ? -0.12 : 0.12)); if (q.get(x, y)) { q.set(x, y, m[0]); if (q.get(x - 1, y) === m[1]) q.set(x - 1, y, m[2]); } }
  // the sash: from the far shoulder across to the near hip, its knot and a tail
  const fc = look.groupM;
  for (let y = F.top + 2; y <= 29; y++) { const x = Math.round(C - b.sw + 3 + (y - F.top - 2) * 1.15); for (let k = 0; k < 3; k++) if (q.get(x + k, y)) q.set(x + k, y, k === 0 ? fc[2] : k === 2 ? fc[0] : fc[1]); }
  for (let x = Math.round(C - b.waist); x <= Math.round(C + b.waist); x++) { if (q.get(x, 28)) q.set(x, 28, fc[2]); if (q.get(x, 29)) q.set(x, 29, fc[0]); }
  for (let y = 30; y <= 35; y++) { const x = Math.round(C + b.waist - 2 + (y - 30) * 0.2); q.set(x, y, fc[1]); q.set(x + 1, y, fc[0]); }
  // sandals under the hem
  for (const ax of [F.ankleF[0] - 0.5, F.ankleN[0] + 0.5]) { const a = Math.round(ax); q.hl(a - 1, a + 3, 48, ax < C ? back(skin)[1] : skin[1]); q.set(a + 3, 48, skin[0]); q.hl(a - 1, a + 3, 49, PAL.leather[0]); q.set(a, 48, PAL.leather[1]); }
  return q;
}
function hoodOf(m) {
  return (F, f) => {
    const q = lay(), [hx, hy] = HC;
    const face = (x, y) => ((x - (hx + 2.2)) / 4.1) ** 2 + ((y - (hy + 1.2)) / 5.2) ** 2 <= 1 && x >= hx - 1.2;
    const inside = (x, y) => (((x - (hx - 0.6)) / 7.1) ** 2 + ((y - (hy - 0.2)) / 7.4) ** 2 <= 1 || (y >= hy + 2 && y <= F.top + 2 && x >= hx - 6.5 && x <= hx + 4.6)) && !face(x, y) && y <= F.top + 2;
    blob(q, inside, m, { rim: 2 });
    for (const [x, y] of [[hx - 3, hy - 4], [hx - 4, hy - 2], [hx - 4.5, hy], [hx - 4.6, hy + 2]]) q.set(Math.round(x), Math.round(y), m[0]); // a fold down the hood
    const rim = []; for (const [x, y] of q.pixels()) if (face(x + 1, y) || face(x, y + 1) || face(x - 1, y)) rim.push([x, y]);
    for (const [x, y] of rim) q.set(x, y, y < hy ? m[2] : m[1]);
    return q;
  };
}
export function paintEnemyHD(kit, factionColor, weaponKey, armorKey, seed) {
  const k = enemyLookOf(kit, seed), fc = factionColor || "#a63a32", G = R(fc);
  if (kit === "soldiers") {
    const O = R(k.olive), P = R(shade(k.olive, -0.1));
    const look = {
      build: "average", skin: k.skin, hair: k.hair, hairStyle: "buzz", facial: k.facial, topStyle: "jacket", topM: O, pantsM: P, bootM: PAL.black,
      beltM: PAL.olive, buckleM: PAL.steel, armbandN: G, armbandF: G,
      topDetail: (p, F) => { for (let y = F.top + 2; y <= F.belt; y++) p.over(F.front, y, O[0]); for (let y = F.top + 4; y <= F.belt; y += 3) p.over(F.front + 1, y, O[2]); for (const x of [F.C - 4, F.C + 4]) { p.over(x, 21, O[0]); p.over(x + 1, 21, O[0]); p.over(x + 2, 21, O[0]); } },
      headgear: (p, f) => { // the helmet: a shaded dome with a rim, a chin strap
        const H = R(shade(k.olive, -0.05)), q = lay(), [hx, hy] = HC;
        ellipseV(q, hx - 0.6, hy - 1.6, 6.4, 5.4, H, { specular: true, cut: (x, y) => y <= hy - 0.6 });
        for (let x = Math.round(hx - 7.2); x <= Math.round(hx + 6.2); x++) { q.set(x, Math.round(hy - 0.2), H[0]); if (x > hx - 7 && x < hx + 6) q.set(x, Math.round(hy - 1), H[1]); }
        q.set(Math.round(hx - 7.2), Math.round(hy - 1), H[1]);
        put(p, q);
      },
    };
    const p = figure(look, weaponKey, armorKey || "plate");
    const m = p.muzzle; camo(p, O, seed); camo(p, P, seed + 1); p.muzzle = m;
    return p;
  }
  if (kit === "zealots") {
    const Rb = R(k.robe);
    const look = { build: "average", skin: k.skin, hair: k.hair, hairStyle: "buzz", facial: k.facial, robe: true, topM: Rb, groupM: G, hood: hoodOf(Rb), sleeveM: Rb, sleeveLen: "bell" };
    return figure(look, weaponKey, armorKey);
  }
  // raiders: leather and denim, studs, a bandana / cap / headband in the group's colour
  const J = R(k.jacket), D = R(k.pants);
  const look = {
    build: "average", skin: k.skin, hair: k.hair, hairStyle: k.acc === "cap" && k.hairStyle === "mohawk" ? "buzz" : k.hairStyle, facial: k.facial,
    topStyle: k.topStyle === "tank" ? "tank" : "jacket", topM: J, pantsM: D, bootM: PAL.black,
    sleeveM: k.topStyle === "tank" ? null : J, sleeveLen: k.topStyle === "tank" ? "none" : k.armStyle === "tshirt" ? "short" : "long",
    accessory: k.acc, accentM: G, armbandN: k.acc === "bandana" ? null : G,
    pantsDetail: (p, F) => { for (const [x, y] of [[F.kneeN[0] + 1, 38], [F.kneeN[0] + 2, 38]]) p.over(Math.round(x), y, D[3]); p.over(Math.round(F.kneeN[0] + 1), 39, D[0]); }, // a torn knee
    topDetail: (p, F) => {
      if (k.topStyle === "tank") { const S2 = S(k.skin); p.over(Math.round(F.C - 4), 18, mix(S2[1], "#2a3a5a", 0.5)); }
      if (k.studs && k.topStyle !== "tank") for (const x of [F.C - F.build.sw + 2.5, F.C - F.build.sw + 4.5, F.C + F.build.sw - 5.5]) p.over(Math.round(x), F.top + 1, PAL.steel[2]); // studs along the shoulders
      if (k.studs) { const x = Math.round(F.C - 4); for (let y = 24; y <= 26; y++) for (let xx = x; xx <= x + 2; xx++) p.over(xx, y, y === 24 ? G[2] : xx === x + 2 ? G[0] : G[1]); } // a patch
    },
  };
  return figure(look, weaponKey, armorKey);
}

// The game's painter (ui/sprites.js) as an HD painter, blown up 2× for the comparison cells.
export function fromGame(gp, k = 2) { const q = painter(gp.w, gp.h); q.px.splice(0, q.px.length, ...gp.px); return scaled(q, k); }

// ---------- the sheet ----------
const appOf = (seed) => randomAppearance(new Rng(seed));
const WEAPON_MIX = ["machete", "pistol", "bat", "ar", "knife", "shotgun", "fireaxe", "huntrifle", "crowbar", "revolver", "sledge", "compbow", "crossbow", "nailbat", "ak", null];
const ARMOR_MIX = [null, "padding", null, "tirevest", "sportspads", null, "scrapvest", null, "vest", null, "plate", "tacvest"];
const varied = (seed) => paintSurvivorHD(appOf(seed), WEAPON_MIX[seed % WEAPON_MIX.length], ARMOR_MIX[seed % ARMOR_MIX.length]);
const base = { build: "average", skin: "#d9a37c", hairStyle: "short", hair: "#3b2a1e", facial: "none", topStyle: "tshirt", top: "#3d4a5c", pants: "#2b3442", accessory: "none", accent: "#b8322a" };

export const SHEET_TITLE = "HD people (44 × 52): survivors, raiders, soldiers, zealots";
export const SHEET_COLS = 8;
export const SHEET = [];
for (let i = 0; i < 8; i++) { const s = 101 + i * 7; SHEET.push({ label: `survivor ${s}`, paint: () => varied(s) }); }
for (const [k] of LOOK_OPTIONS.topStyle.values) SHEET.push({ label: k, paint: () => paintSurvivorHD({ ...base, topStyle: k, top: k === "flannel" ? "#7a3b32" : k === "hoodie" ? "#6d6f73" : k === "jacket" ? "#5b4632" : k === "tank" ? "#c9c2b0" : "#2e5e6b" }) });
for (const b of ["slim", "average", "heavy"]) SHEET.push({ label: `${b} build`, paint: () => paintSurvivorHD({ ...base, build: b, topStyle: "jacket", top: "#33533b" }) });
for (const [k] of LOOK_OPTIONS.hairStyle.values) SHEET.push({ label: `hair ${k}`, paint: () => paintSurvivorHD({ ...base, hairStyle: k, hair: k === "curly" ? "#1d1a17" : k === "long" ? "#c9a25a" : k === "mohawk" ? "#a9442a" : k === "ponytail" ? "#6b4526" : "#3b2a1e", skin: k === "curly" ? "#7d5233" : k === "bald" ? "#a06e46" : k === "long" ? "#eac3a2" : base.skin }) });
SHEET.push({ label: "beard", paint: () => paintSurvivorHD({ ...base, facial: "beard", hair: "#9a6a3a", topStyle: "flannel", top: "#33533b" }) });
for (const [k] of LOOK_OPTIONS.facial.values.filter(([v]) => v !== "beard")) SHEET.push({ label: `face ${k}`, paint: () => paintSurvivorHD({ ...base, facial: k, hairStyle: "buzz", hair: "#1d1a17", skin: k === "stache" ? "#c08a5f" : k === "stubble" ? "#eac3a2" : "#5c3a24" }) });
for (const [k] of LOOK_OPTIONS.accessory.values.slice(1)) SHEET.push({ label: k, paint: () => paintSurvivorHD({ ...base, accessory: k, accent: k === "cap" ? "#2d5fa8" : k === "beanie" ? "#3f7a3a" : k === "bandana" ? "#b8322a" : k === "headband" ? "#d9b23a" : "#d97a2b", skin: k === "bandana" ? "#5c3a24" : base.skin, hair: k === "headband" ? "#1d1a17" : base.hair, topStyle: k === "backpack" ? "jacket" : "tshirt", top: k === "backpack" ? "#5a6b3a" : "#8a6a3a" }) });
SHEET.push({ label: "no armor", paint: () => paintSurvivorHD({ ...base, top: "#6d6f73", pants: "#4f4a3a" }) });
for (const k of ["padding", "tirevest", "sportspads", "scrapvest", "vest", "plate", "tacvest"]) SHEET.push({ label: `armor ${k}`, paint: () => paintSurvivorHD({ ...base, top: "#6d6f73", pants: "#4f4a3a" }, null, k) });
SHEET.push({ label: "plate + ar", paint: () => paintSurvivorHD({ ...base, top: "#6d6f73", pants: "#4f4a3a" }, "ar", "plate") });
for (const w of ["knife", "machete", "bat", "nailbat", "crowbar", "prybar", "fireaxe", "hatchet", "sledge", "baton", "spear", "bowie", "pistol", "revolver", "shotgun", "huntrifle", "ar", "ak", "compbow", "crossbow", "sabre", "kukri", "pipespear", "golfclub"]) SHEET.push({ label: w, paint: () => paintSurvivorHD({ ...base, topStyle: "jacket", top: "#5a6b3a", hairStyle: "short" }, w, null) });
for (const [fc, name] of [["#a63a32", "red"], ["#2d5fa8", "blue"]]) {
  for (let i = 0; i < 3; i++) SHEET.push({ label: `raider ${name} ${i + 1}`, paint: () => paintEnemyHD("raiders", fc, ["machete", "pistol", "nailbat"][i], i === 2 ? "tirevest" : null, 11 + i) });
  for (let i = 0; i < 3; i++) SHEET.push({ label: `soldier ${name} ${i + 1}`, paint: () => paintEnemyHD("soldiers", fc, ["ar", "shotgun", "pistol"][i], ["vest", "plate", "tacvest"][i], 21 + i) });
  for (let i = 0; i < 2; i++) SHEET.push({ label: `zealot ${name} ${i + 1}`, paint: () => paintEnemyHD("zealots", fc, ["knife", "huntrifle"][i], null, 31 + i) });
}
export const COMPARE_SEEDS = [3, 17, 42, 58, 77, 93];
export const comparePairs = () => COMPARE_SEEDS.flatMap((s, i) => {
  const app = appOf(s), w = ["machete", "ar", "bat", "pistol", "shotgun", "fireaxe"][i], a = [null, "padding", null, "scrapvest", "vest", null][i];
  return [
    { label: `current ${s}`, paint: () => fromGame(paintSurvivor(app, w, a)) },
    { label: `HD ${s}`, paint: () => paintSurvivorHD(app, w, a) },
  ];
});
SHEET.push(...comparePairs());
SHEET.push({ label: "current raider", paint: () => fromGame(paintEnemyHuman("raiders", "#a63a32", "machete", null, 11)) }, { label: "HD raider", paint: () => paintEnemyHD("raiders", "#a63a32", "machete", null, 11) });
SHEET.push({ label: "current soldier", paint: () => fromGame(paintEnemyHuman("soldiers", "#2d5fa8", "ar", "vest", 21)) }, { label: "HD soldier", paint: () => paintEnemyHD("soldiers", "#2d5fa8", "ar", "vest", 21) });
SHEET.push({ label: "current zealot", paint: () => fromGame(paintEnemyHuman("zealots", "#a63a32", "knife", null, 31)) }, { label: "HD zealot", paint: () => paintEnemyHD("zealots", "#a63a32", "knife", null, 31) });
