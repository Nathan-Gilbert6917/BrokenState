// Survivors, human enemies and the plain dead as low-poly figures (docs/design-doc/sprites/survivor-sprites-3d.md):
// rounded, tapered body parts with arms that reach their weapon, drawn in the battle map's own 2:1 projection and
// lit by the item art's light (the top lit, faces darker the more they turn to the screen's right). A figure has a
// yaw: on the battle map it faces the way the unit faces (sim/vision.js u.face; the dead their last move) at every
// turn of the view, no mirroring; the inventory spins it through 360° to show what is on it (figureSpinImg).
// Looks come from sim/appearance.js's data, ui/sprites.js enemyLookOf (the kits) and zombieLookOf (the dead's rolls).
//
// One primitive, the limb: a prism between two points with an n-sided (elliptical) cross-section, tapered toward
// its far end, its faces lit by their normals. Body parts are vertical limbs (8 sides: round enough), arms are two
// limbs shoulder → elbow → hand with the hand placed on the weapon, weapons are 4-sided limbs (boxes) along any
// direction. A depth buffer sorts everything per pixel, so an arm across the chest or a gun through the hands draws
// right at every yaw. Painted on a BW × BH grid (1 grid px = 1 art px, the figure 30 tall), upscaled by toCanvas
// and cached by look and heading (figureCanvas). Special dead, bosses and the risen keep their flat sprites
// (ui/sprites.js, ui/hivesprites.js): unitFigure returns null for them.
import { painter, toCanvas, zombieLookOf, zombieVariant, enemyLookOf, zombieLook } from "./sprites.js";
import { shade } from "./itemart/kit.js";
import { ensureAppearance } from "../sim/appearance.js";
import { spriteArmorKey } from "../sim/inventory.js";
import { weaponLook, unitGun } from "./gunparts.js";

export const BW = 48, BH = 52; // the pixel grid of a figure at scale 1; the figure stands on the tile's centre at (OX, OY)
const OX = BW / 2, OY = BH - 9;
export const FIG = { ox: OX, oy: OY, w: BW, h: BH }; // where the feet are on the grid (isoview.js draws the canvas so they land on the unit's feet); cv.figure holds a canvas's own
// The grid for a figure: scaled with it (bosses, the brute); a lying one wide and low, its tile centre at (ox, oy).
function gridFor(scale = 1, lie = false) {
  const w = Math.ceil(BW * scale), h = lie ? Math.ceil(BH * scale * 0.8) : Math.ceil(BH * scale);
  return { ox: Math.floor(w / 2), oy: lie ? Math.round(h * 0.6) : h - Math.round(9 * scale), w, h };
}
export const FACINGS = ["SE", "SW", "NW", "NE"];
export const YAW = { SE: 0, SW: 90, NW: 180, NE: 270 }; // the four diagonal views; the straight ones lie 45° between

// ---------- vectors and the projection (isoview.js: screen x = wx - wy, screen y = (wx + wy) / 2 - z) ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const SX = (p) => p[0] - p[1], SY = (p) => (p[0] + p[1]) / 2 - p[2], DEPTH = (p) => p[0] + p[1] + 0.8 * p[2];
const VIEW = [1, 1, 0.8]; // toward the viewer: a face is seen when its normal leans this way

// limb(A, B, ra, rb, col, o): from A to B; ra, rb the half-sizes of the section along its u and v axes (u: forward
// for a vertical limb, else across the limb; v the other). o: sides (8), phase (the section's turn), taper (the
// section's scale at B), tex(face, s, t) → colour (face by the figure-space normal: front, back, left, right, top,
// bottom; s across the face 0..1, t along the limb 0..1 from A), u (the u axis to use).
const limb = (A, B, ra, rb, col, o = {}) => ({ A, B, ra, rb, col, sides: o.sides ?? 8, phase: o.phase ?? 0, taper: o.taper ?? 1, tex: o.tex || null, u: o.u || null, group: o.group || 0 });
const OUTLINE = "#0b0c0e";
// A box from A to B: half-height ha (along u) and half-width hb.
const boxL = (A, B, ha, hb, col, o = {}) => limb(A, B, ha * Math.SQRT2, hb * Math.SQRT2, col, { sides: 4, phase: Math.PI / 4, ...o });

function faceOf(n) { // a figure-space normal's face
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (az >= ax && az >= ay) return n[2] > 0 ? "top" : "bottom";
  if (ax >= ay) return n[0] > 0 ? "front" : "back";
  return n[1] > 0 ? "left" : "right";
}
// Paints one limb: p the painter, zb the depth buffer, W the yaw (figure → world) for points and normals.
function paintLimb(p, zb, gb, L, W, g) {
  const d = sub(L.B, L.A), length = len(d), axis = norm(d);
  let u = L.u ? norm(L.u) : Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : norm(cross([0, 0, 1], axis));
  u = norm(sub(u, mul(axis, dot(u, axis))));
  const v = cross(axis, u);
  const plot = (P, col) => {
    const w = W(P), x = Math.round(g.ox + SX(w)), y = Math.round(g.oy + SY(w));
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
    const dep = DEPTH(w), i = y * g.w + x;
    if (dep > zb[i]) { zb[i] = dep; p.px[i] = col; gb[i] = L.group; }
  };
  const N = (nf) => norm(W.n ? W.n(nf) : W(nf)); // a normal through the transform (its own, when the transform is not a rotation)
  const lit = (nf, col) => { const n = N(nf); return shade(col, 0.18 * n[2] - 0.3 * Math.max(0, n[0]) + 0.04 * Math.max(0, n[1])); };
  const seen = (nf) => dot(N(nf), VIEW) > 0.02;
  const n = L.sides, ST = 0.4;
  const radial = (th, sc) => add(mul(u, L.ra * Math.cos(th) * sc), mul(v, L.rb * Math.sin(th) * sc));
  // the sides
  for (let k = 0; k < n; k++) {
    const th0 = L.phase + (2 * Math.PI * k) / n, th1 = L.phase + (2 * Math.PI * (k + 1)) / n, mid = (th0 + th1) / 2;
    const nf = norm(add(mul(u, Math.cos(mid) / L.ra), mul(v, Math.sin(mid) / L.rb)));
    if (!seen(nf)) continue;
    const face = faceOf(nf);
    const chord = len(sub(radial(th1, 1), radial(th0, 1)));
    const qs = Math.max(1, Math.ceil(chord / ST)), ts = Math.max(1, Math.ceil(length / ST));
    for (let ti = 0; ti <= ts; ti++) {
      const t = ti / ts, sc = 1 + (L.taper - 1) * t, C = lerp(L.A, L.B, t);
      for (let qi = 0; qi <= qs; qi++) {
        const q = qi / qs, th = th0 + (th1 - th0) * q;
        const P = add(C, radial(th, sc));
        // s across the face: the point's place across the limb as seen from that face
        const s = face === "front" ? 0.5 - (P[1] - C[1]) / (2 * L.rb) : face === "back" ? 0.5 + (P[1] - C[1]) / (2 * L.rb) : face === "left" ? 0.5 + (P[0] - C[0]) / (2 * L.ra) : 0.5 - (P[0] - C[0]) / (2 * L.ra);
        const tc = L.tex ? L.tex(face, Math.max(0, Math.min(1, s)), t) : null;
        plot(P, lit(nf, tc || L.col));
      }
    }
  }
  // the ends
  for (const [C, nf, sc, face] of [[L.A, mul(axis, -1), 1, null], [L.B, axis, L.taper, null]]) {
    if (!seen(nf)) continue;
    const f = faceOf(nf), rs = Math.max(1, Math.ceil(Math.max(L.ra, L.rb) * sc / ST));
    for (let ri = 0; ri <= rs; ri++) {
      const r = ri / rs, steps = Math.max(4, Math.ceil((2 * Math.PI * Math.max(L.ra, L.rb) * r * sc) / ST));
      for (let k = 0; k <= steps; k++) {
        const th = (2 * Math.PI * k) / steps;
        const P = add(C, radial(th, r * sc));
        const tc = L.tex ? L.tex(f, (Math.cos(th) * r + 1) / 2, (Math.sin(th) * r + 1) / 2) : null;
        plot(P, lit(nf, tc || L.col));
      }
    }
  }
}
// The transform of a figure into the world: a yaw (degrees), and lying: the figure's up along the world's +x (the
// head toward +x), its front turned up and pressed flat, centred on the tile (height: the figure's, to centre it).
function transformOf(yaw, lie = false, height = 30) {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = (q) => [q[0] * c - q[1] * s, q[0] * s + q[1] * c, q[2]];
  if (!lie) return rot;
  const W = (q) => rot([q[2] - height / 2, q[1], q[0] * 0.35 + 0.9]);
  W.n = (n) => rot([n[2], n[1], n[0]]); // the normals turn with it, unsquashed
  return W;
}
// Paints limbs through a transform onto the grid g, into the depth and group buffers (shared by a figure's parts).
function paintLimbs(p, limbs, W, g, buf) {
  const zb = buf ? buf.zb : new Float32Array(g.w * g.h).fill(-1e9), gb = buf ? buf.gb : new Uint8Array(g.w * g.h);
  for (const L of limbs) paintLimb(p, zb, gb, L, W, g);
  if (limbs.muzzle) { const m = W(limbs.muzzle); p.muzzle = { mx: g.ox + SX(m), my: g.oy + SY(m) }; } // where a shot starts (isoview.js muzzlePoint), grid px
  return { zb, gb };
}
// A dark rim where a weapon (group 1) meets the body, so it reads against clothes of its own colour.
function rim(p, g, gb) {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    if (!p.px[i] || gb[i]) continue;
    if ((x > 0 && gb[i - 1]) || (x < g.w - 1 && gb[i + 1]) || (y > 0 && gb[i - g.w]) || (y < g.h - 1 && gb[i + g.w])) p.px[i] = OUTLINE;
  }
}

// ---------- the figure ----------
const SHOE = "#2a2622";
const ARMOR = { vest: "#4d5440", plate: "#3c4148", padding: "#8a7f6a", tirevest: "#2a2a2a", sportspads: "#b8b0a0", scrapvest: "#6e5a48", riot: "#3a3d44" };
export function holdOf(key) {
  if (!key || key === "fists" || key === "claws" || key === "acid") return null;
  if (["pistol", "revolver", "pistol22", "compact9", "pistol45", "usp45", "magnum", "snub357", "snub38", "service38", "fiveseven", "revolver44"].includes(key)) return "pistol";
  if (["smg", "ump45", "p90", "vector"].includes(key)) return "smg";
  if (["bat", "spikedbat", "nailbat", "sledge", "fireaxe", "pickaxe", "spear", "pipespear", "golfclub", "katana", "broadsword"].includes(key)) return "shoulder";
  if (["pulleybow", "compbow"].includes(key)) return "bow";
  if (["knife", "machete", "sawmachete", "springmachete", "prybar", "baton", "stunbaton", "combatknife", "hatchet", "tomahawk", "kukri", "hammer", "etool", "cleaver", "bowie", "cutlass", "sabre"].includes(key)) return "side";
  return "gun";
}
const GUN = "#4b5159", GUNL = "#6d747d", WOOD = "#8a5e36", STEEL = "#cdd5da", GLINT = "#e9eef1";
const BONE = "#d8d0bc", WORM = "#f0e4c0", WORM_D = "#c4b48a"; // the hives' bone and worms (ui/hivesprites.js)
const HELMET_COL = { hardhat: "#e6c23a", highcut: "#b89a62", milhelmet: "#55603b", rivethelmet: "#7d858c", footballhelmet: "#3a6fb0", bikehelmet: "#c8402f", riothelmet: "#202226" }; // sim/data-helmets.js, the icons' colours
// every weapon: its top edge catches the light, so it reads at a glance (the rim below separates it from the body)
const glint = (under, col = null) => (face, s, t) => (face === "top" ? (col ? shade(col, 0.45) : GLINT) : under ? under(face, s, t) : null);

// The limbs of one figure. app: the survivor look (sim/appearance.js), plus for the dead app.dead = { eye, marks:
// [[part, s, t, kind]...], pose: "reach" | "hang", bloated, brute, run }. Figure space: forward +f, left +l, z up;
// the ground at z = 0; the right arm at -l.
export function figureLimbs(app, weaponKey = null, armorKey = null) {
  const D = app.dead || null;
  if (D && D.body === "swarm") return swarmLimbs(D);
  if (D && D.body === "hivemind") return hivemindLimbs(D);
  if (D && D.body === "broodmother") return broodmotherLimbs(D);
  const F = [];
  const skin = app.skin, hair = app.hair, top = app.top, pants = app.pants;
  const big = (D && (D.scale || (D.brute ? 1.3 : 1))) || 1;
  const wide = (app.build === "heavy" ? 1.22 : app.build === "slim" ? 0.86 : 1) * (D && D.bloated ? 1.45 : 1) * (D && D.wide || 1) * (D && D.thin ? 0.82 : 1) * big;
  const TW = 8 * wide, TD = 4.2 * (app.build === "heavy" ? 1.25 : 1) * (D && D.bloated ? 1.6 : 1) * (D && D.wide ? 1.2 : 1) * (D && D.thin ? 0.85 : 1) * big; // the torso across and deep
  const legH = 10 * big * (D && D.legs === "short" ? 0.8 : 1), torsoH = 10 * big, headS = 6.4 * (D && D.brute ? 1.1 : 1) * (D && D.head || 1);
  const shoulderZ = legH + torsoH;
  const short = app.topStyle === "tshirt" || app.topStyle === "tank";
  const run = D && D.run ? 1.8 : 0;
  const down = app.down || null; // lying: "dead" (arms out a little), "down" (knees drawn up, arms over the chest)
  F.height = shoulderZ + headS + 2;
  if (D && D.body === "crawler") return crawlerLimbs(F, { skin, cloth: top, eye: D.eye, TW, TD, headS, marks: D.marks });
  // the dead's wounds and torn clothes on a part, over the part's own paint
  const marks = (part, under) => (face, s, t) => {
    if (D) for (const [pt, ms, mt, kind] of D.marks) if (pt === part && Math.abs(s - ms) < 0.14 && Math.abs(t - mt) < 0.1) return kind === "tear" ? skin : kind === "wound" ? "#7a1c18" : "#5c1210";
    return under ? under(face, s, t) : null;
  };
  // legs and feet (the right leg at -l), tapered to the ankle; a shroud or a mound instead for some of the dead
  if (D && D.shroud) F.push(limb([0, 0, shoulderZ - 0.5], [0, 0, 0.2], TD / 2, TW / 2, D.shroud, { taper: 1.15, tex: (face, s, t) => (t > 0.9 ? shade(D.shroud, -0.35) : face !== "top" && t > 0.42 && t < 0.46 ? shade(D.shroud, -0.3) : null) }));
  else if (D && D.mound) F.push(limb([0, 0, legH + 1], [0, 0, 0], TD / 2 * 1.4, TW / 2 * 1.3, D.mound, { taper: 1.25 }));
  else for (const side of [-1, 1]) {
    const l = side * TW / 4, lc = side > 0 ? pants : shade(pants, -0.1), fwd = run * side;
    if (down && down.pose === "down") { // knees drawn up: the thigh forward, the shin back down
      F.push(limb([0, l, legH], [4.5 * big, l, legH - 3 * big], TD / 2 * 0.9, TW / 4 * 0.9, lc, { taper: 0.9, tex: marks("leg" + side) }));
      F.push(limb([4.5 * big, l, legH - 3 * big], [2 * big, l, 1.4], TD / 2 * 0.8, TW / 4 * 0.8, lc, { taper: 0.85 }));
      F.push(limb([1.2 * big, l, 0.7], [4.4 * big, l, 0.7], 0.7, TW / 4 * 0.8, SHOE, { sides: 6, u: [0, 0, 1] }));
      continue;
    }
    F.push(limb([fwd, l, legH], [fwd, l, 1.4], TD / 2 * 0.92, TW / 4 * 0.9, lc, { taper: 0.78, tex: marks("leg" + side) }));
    F.push(limb([fwd - 0.8, l, 0.7], [fwd + 2.4, l, 0.7], 0.7, TW / 4 * 0.8, SHOE, { sides: 6, u: [0, 0, 1] }));
  }
  // the torso: narrower at the waist, the belt; a vest around it with its own depth
  const topTex = (face, s, t) => {
    if (t > 0.92 && !D) return "#2a2420";
    if (D && D.camo && face !== "top" && (Math.round(s * 9) + Math.round(t * 7) * 3) % 5 === 0) return D.camo[1 + ((Math.round(s * 9) + Math.round(t * 7)) % 3)]; // a dead soldier's fatigues
    if (D && D.ribs && face === "front" && (Math.abs(t - 0.42) < 0.03 || Math.abs(t - 0.56) < 0.03) && Math.abs(s - 0.5) < 0.3) return shade(top, -0.35); // ribs through the skin
    if (D && D.splits && face !== "top" && ((Math.abs(t - 0.55) < 0.04 && Math.abs(s - 0.35) < 0.12) || (Math.abs(t - 0.7) < 0.04 && Math.abs(s - 0.68) < 0.1))) return "#5c1e1a"; // the belly split
    if (app.topStyle === "jacket" && face === "front" && Math.abs(s - 0.5) < 0.07) return shade(top, -0.4);
    if (app.topStyle === "flannel" && face !== "top" && ((Math.round(s * 6) % 2 === 0) !== (Math.round(t * 6) % 2 === 0))) return shade(top, -0.3);
    if (app.topStyle === "tank" && (face === "left" || face === "right") && t < 0.25) return skin;
    if (app.topStyle === "hoodie" && face === "back" && t < 0.2) return shade(top, -0.25);
    if (app.sash && face !== "top" && t > 0.72 && t < 0.84) return app.sash; // a zealot's sash in the group's colour
    return null;
  };
  if (!(D && D.shroud)) {
    F.push(limb([0, 0, shoulderZ], [0, 0, legH], TD / 2, TW / 2, top, { taper: D && D.bloated ? 0.96 : 0.88, tex: marks("torso", topTex) }));
    F.push(limb([0, 0, shoulderZ + 0.2], [0, 0, shoulderZ - 1.4], TD / 2 * 0.9, TW / 2 * 0.98, top, { taper: 1.0 })); // the shoulders' round
  }
  if (D && D.pads) for (const side of [-1, 1]) F.push(limb([0, side * (TW / 2 + 0.4), shoulderZ + 1.2], [0, side * (TW / 2 + 0.4), shoulderZ - 2.2], 2.2, 2.0, D.pads, { sides: 6, taper: 1.1 })); // a riot cop's shoulder guards
  const armor = armorKey ? ARMOR[armorKey] || ARMOR.vest : null;
  if (armor) F.push(limb([0, 0, shoulderZ - 0.8], [0, 0, legH + 2.6], TD / 2 + 0.6, TW / 2 + 0.5, armor, { taper: 0.92, tex: (face, s, t) => (face === "top" ? shade(armor, 0.1) : armorKey === "plate" && (face === "front" || face === "back") && s > 0.25 && s < 0.75 && t > 0.15 && t < 0.8 ? shade(armor, -0.2) : t < 0.12 && (face === "front" || face === "back") && Math.abs(s - 0.5) > 0.25 ? shade(armor, -0.3) : null) }));
  if (app.accessory === "backpack") F.push(boxL([-TD / 2 - 0.4, 0, legH + 9.5], [-TD / 2 - 0.4, 0, legH + 2.5], 1.6, TW * 0.34, "#6b4a2a", { u: [1, 0, 0], tex: (face, s, t) => (face === "back" && t > 0.3 && t < 0.4 ? "#4a3220" : null) }));
  // arms: shoulder → elbow → hand, the hand on the weapon
  const hold = holdOf(weaponKey);
  const armR = 1.35 * big, sideL = TW / 2 + armR + 0.25;
  const SH = (side) => [0, side * sideL, shoulderZ - 1.3];
  const armTex = (side) => marks("arm" + side, (face, s, t) => (side > 0 && app.armband && t > 0.3 && t < 0.5 ? app.armband : short && t > 0.4 ? skin : null)); // a soldier's armband in the group's colour
  const arm = (side, E, H) => {
    const S = SH(side);
    F.push(limb(S, E, armR, armR, top, { sides: 6, taper: 0.9, tex: armTex(side) }));
    F.push(limb(E, H, armR * 0.9, armR * 0.9, short ? skin : shade(top, -0.08), { sides: 6, taper: 0.9 }));
    F.push(limb(H, add(H, mul(norm(sub(H, E)), 1.8)), armR * 1.05, armR * 0.8, skin, { sides: 6 })); // the hand
  };
  const hang = (side) => arm(side, [-0.4, side * (sideL + 0.3), shoulderZ - 6.4], [0.4, side * (sideL + 0.4), shoulderZ - 11.3]);
  const reach = (side) => arm(side, [4.6, side * (sideL - 0.2), shoulderZ - 2.6], [9.4, side * TW * 0.3, shoulderZ - 3.2]);
  const longArm = D && D.longArms ? 1.35 : 1;
  const armUp = (side) => arm(side, [-1.2, side * (sideL + 1.4), shoulderZ + 1.5 * longArm], [-2.8, side * (sideL + 2.6), shoulderZ + 6.5 * longArm]); // flung up and back
  const hangLong = (side) => arm(side, [-0.4, side * (sideL + 0.4), shoulderZ - 7 * longArm], [0.6, side * (sideL + 0.6), shoulderZ - 13 * longArm]);
  if (down) { // lying: dead with the arms out a little; down with them over the chest
    if (down.pose === "down") { arm(1, [1.6, sideL * 0.9, shoulderZ - 5.5], [TD / 2 + 1.2, -1.5, shoulderZ - 4]); arm(-1, [1.6, -sideL * 0.9, shoulderZ - 6.5], [TD / 2 + 1.4, 1.5, shoulderZ - 5]); }
    else { arm(1, [0.2, sideL + 1.6, shoulderZ - 6], [0.8, sideL + 3.2, shoulderZ - 11]); arm(-1, [0.2, -(sideL + 1.6), shoulderZ - 6], [0.8, -(sideL + 3.2), shoulderZ - 11]); }
  }
  else if (D && D.pose === "reach") { reach(1); reach(-1); }
  else if (D && D.pose === "up") { armUp(1); armUp(-1); if (D.hooks) for (const side of [-1, 1]) F.push(limb([-2.8, side * (sideL + 2.6), shoulderZ + 6.5 * longArm], [-3.4, side * (sideL + 3.0), shoulderZ + 9.2 * longArm], 0.55, 0.55, BONE, { sides: 4 })); } // hooked bone fingers
  else if (D && D.pose === "throw") { // one arm cocked back over the head with a mass of worms, the other long and hanging
    const H = [-3.2, -(sideL + 0.6), shoulderZ + 7.5];
    arm(-1, [-1.6, -(sideL + 1.2), shoulderZ + 2.8], H); hangLong(1);
    F.push(limb(add(H, [-0.4, 0, 0.6]), add(H, [-1.0, 0, 3.8]), 2.4, 2.2, WORM_D, { sides: 6, tex: (face, s, t) => ((Math.round(s * 6) + Math.round(t * 4)) % 3 === 0 ? WORM : null) }));
    F.push(limb(add(H, [0.6, 0.8, 0.4]), add(H, [1.4, 1.2, -2.2]), 0.4, 0.4, WORM, { sides: 4 })); // dripping
  }
  else if (D && D.pose === "crook") { // one arm out to a long bone crook, the other raised a little
    const H = [1.8, -(sideL + 2.6), shoulderZ - 5];
    arm(-1, [0.6, -(sideL + 1.6), shoulderZ - 3.2], H); arm(1, [-0.6, sideL + 0.8, shoulderZ - 5], [0.8, sideL + 1.0, shoulderZ - 8.5]);
    F.push(limb([2.6, H[1], 0.2], [2.6, H[1], shoulderZ + 12], 0.5, 0.5, BONE, { sides: 4, group: 1 }));
    F.push(limb([2.6, H[1], shoulderZ + 12], [4.6, H[1], shoulderZ + 11.4], 0.5, 0.5, BONE, { sides: 4, group: 1 })); // the hook
  }
  else if (D && D.pose === "slab") { // the Wallbreaker: a slab of concrete raised in one fist, the other arm hanging, knuckles down
    const H = [2.4, -(sideL + 1.0), shoulderZ + 5.5];
    arm(-1, [1.2, -(sideL + 1.6), shoulderZ + 1.5], H); hangLong(1);
    F.push(boxL(add(H, [0, 0, 0.8]), add(H, [0, 0, 7.5]), 2.8 * big * 0.75, 2.4 * big * 0.75, "#9a968c", { u: [1, 0, 0], group: 1, tex: (face, s, t) => (face === "top" ? "#b8b4aa" : (Math.round(s * 5) + Math.round(t * 7)) % 4 === 0 ? "#7a4a30" : null) }));
  }
  else if (D && D.pose === "claws") { hangLong(1); hangLong(-1); for (const side of [-1, 1]) F.push(limb([0.6, side * (sideL + 0.6), shoulderZ - 13 * longArm], [1.6, side * (sideL + 0.6), shoulderZ - 15.5 * longArm], 0.5, 0.5, BONE, { sides: 4 })); } // clawed, hanging
  else if (D && D.pose === "stubs") { arm(1, [0.2, sideL + 0.2, shoulderZ - 3.5], [0.8, sideL + 0.4, shoulderZ - 7]); arm(-1, [0.2, -(sideL + 0.2), shoulderZ - 3.5], [0.8, -(sideL + 0.4), shoulderZ - 7]); } // stubby arms on a swollen body
  else if (hold === "gun" || hold === "smg") {
    // low ready: the gun ahead and a little to the right, muzzle down; the right hand on the grip, the left out to the fore-end
    const long = hold === "gun";
    const butt = [long ? -2.2 : -0.8, -2.8, shoulderZ - 2.4], muzzle = [long ? 11.6 : 8.6, -2.4, shoulderZ - (long ? 4.2 : 3.2)];
    const grip = lerp(butt, muzzle, 0.3), fore = lerp(butt, muzzle, long ? 0.68 : 0.66);
    arm(-1, [1.0, -(sideL + 1.0), shoulderZ - 5.8], add(grip, [0, -0.9, -0.9]));
    arm(1, [2.6, TW / 2 - 0.4, shoulderZ - 6.4], add(fore, [0, -0.3, -1.0]));
    F.muzzle = muzzle;
    F.push(boxL(butt, muzzle, 1.25, 0.75, GUN, { group: 1, u: [0, 0, 1], tex: glint((face, s, t) => (t < 0.26 ? shade(GUN, -0.3) : t > 0.62 ? GUNL : null), GUNL) }));
    F.push(boxL(add(grip, [1.8, 0, -0.6]), add(grip, [2.3, 0, -3.8]), 0.8, 0.6, shade(GUN, -0.25), { group: 1 })); // the magazine
  } else if (hold === "pistol") {
    const H = [7.4, -(sideL - 0.3), shoulderZ - 3.6];
    arm(-1, [3.6, -(sideL + 0.6), shoulderZ - 3.2], H);
    hang(1);
    F.muzzle = add(H, [5.4, 0, 0.9]);
    F.push(boxL(add(H, [0.0, 0, 1.2]), add(H, [5.4, 0, 0.9]), 0.85, 0.6, GUNL, { group: 1, u: [0, 0, 1], tex: glint(null, GUNL) }));
    F.push(boxL(add(H, [0.5, 0, 1.0]), add(H, [0.2, 0, -1.2]), 0.65, 0.55, shade(GUN, -0.3), { group: 1 })); // the grip through the fist
  } else if (hold === "side") {
    hang(1); hang(-1);
    const l = -(sideL + 0.5);
    F.push(boxL([1.0, l, shoulderZ - 12.8], [1.4, l, shoulderZ - 0.6], 1.0, 0.32, STEEL, { group: 1, u: [1, 0, 0], tex: glint((face, s, t) => (t < 0.2 ? "#3a2a1c" : t < 0.25 ? "#1a1c20" : null)) }));
  } else if (hold === "shoulder") {
    const l = -(sideL + 0.2), A = [1.8, l, shoulderZ - 8.6], B = [-5.4, l, shoulderZ + 5.4];
    arm(-1, [1.0, l - 1.2, shoulderZ - 5.6], add(A, [-0.2, 0, 0.6]));
    arm(1, [2.6, TW / 2 - 0.6, shoulderZ - 5.6], add(lerp(A, B, 0.24), [0.2, 0.3, 0]));
    F.push(boxL(A, B, 0.7, 0.7, WOOD, { group: 1, u: [1, 0, 0], tex: glint(null, WOOD) }));
    F.push(boxL(add(B, [0, -2.4, 0]), add(B, [0, 2.4, 0]), 1.5, 1.3, "#7d858c", { group: 1, u: [0, 0, 1], tex: glint(null, "#7d858c") })); // the head
  } else if (hold === "bow") {
    const H = [7.2, -(sideL - 0.4), shoulderZ - 4.2];
    arm(-1, [3.6, -(sideL + 0.6), shoulderZ - 3.6], H);
    arm(1, [-0.6, sideL + 0.8, shoulderZ - 3.8], [2.4, -1.2, shoulderZ - 4.2]); // the string hand drawn to the chest
    F.push(boxL(add(H, [0.8, 0, -8.0]), add(H, [0.8, 0, 7.8]), 0.6, 0.55, WOOD, { group: 1, u: [1, 0, 0], tex: glint(null, WOOD) }));
    F.push(boxL(add(H, [0.1, 0, -7.6]), add(H, [0.1, 0, 7.4]), 0.22, 0.22, GLINT, { group: 1, u: [1, 0, 0] })); // the string
  } else { hang(1); hang(-1); }
  // the neck and the head: rounder at the crown, the face on the front, hair by style
  F.push(limb([0, 0, shoulderZ + 1.2], [0, 0, shoulderZ - 0.6], 1.3, 1.4, shade(skin, -0.12), { sides: 6 }));
  const hz = shoulderZ + 0.9 - (D && D.headDrop ? D.headDrop * big : 0), hs = app.hairStyle, hairy = hs !== "bald";
  const hairOn = (face, t) => hairy && (face === "top" || (face === "back" && (hs === "long" || hs === "curly" ? t < 0.95 : t < 0.38)) || ((face === "left" || face === "right") && (hs === "long" ? t < 0.85 : hs === "buzz" ? t < 0.14 : t < 0.32)) || (face === "front" && t < (hs === "buzz" ? 0.1 : 0.22)));
  const eye = D ? D.eye : "#1a1a1a";
  const headTex = marks("head", (face, s, t) => {
    if (app.accessory === "bandana" && face !== "top" && face !== "back" && t > 0.62 && t < 0.95) return app.accent;
    if (app.accessory === "headband" && face !== "top" && t > 0.17 && t < 0.3) return app.accent;
    if (face === "front") {
      if (D && D.jaw && t > 0.5 && Math.abs(s - 0.5) < 0.3) return t < 0.56 && Math.round(s * 7) % 2 ? BONE : "#14060a"; // the jaw hanging open far wider than a jaw should
      if (D && D.eyes === 3 && t > 0.42 && t < 0.56 && (Math.abs(s - 0.25) < 0.08 || Math.abs(s - 0.5) < 0.08 || Math.abs(s - 0.75) < 0.08)) return eye;
      if (D && D.mask && t < 0.9) return Math.abs(t - 0.48) < 0.06 && (Math.abs(s - 0.32) < 0.08 || Math.abs(s - 0.68) < 0.08) ? eye : Math.abs(t - 0.3) < 0.03 || Math.abs(t - 0.66) < 0.03 ? shade(BONE, -0.3) : BONE; // a mask of fused bone, the eyes peering through
      if (t > 0.42 && t < 0.56 && (Math.abs(s - 0.32) < 0.09 || Math.abs(s - 0.68) < 0.09)) return eye;
      if (D && D.acid && t > 0.72 && Math.abs(s - 0.5) < 0.26) return t > 0.88 ? D.acid : "#3a1412"; // a mouth dripping acid
      if (app.accessory === "glasses" && t > 0.4 && t < 0.58) return "#1d1f24";
      if (app.facial === "beard" && t > 0.72) return hair;
      if (app.facial === "stache" && t > 0.68 && t < 0.78 && Math.abs(s - 0.5) < 0.3) return hair;
      if (app.facial === "stubble" && t > 0.72 && ((Math.round(s * 7) + Math.round(t * 7)) % 2 === 0)) return shade(skin, -0.25);
      if (D && t > 0.74 && t < 0.9 && Math.abs(s - 0.5) < 0.24) return "#3a1210";
      if (t > 0.8 && t < 0.88 && Math.abs(s - 0.5) < 0.22) return shade(skin, -0.3);
    }
    if (hairOn(face, t)) return face === "top" ? shade(hair, 0.18) : face === "right" || face === "back" ? shade(hair, -0.25) : hair;
    return null;
  });
  F.push(limb([0, 0, hz + headS], [0, 0, hz], headS / 2 * 0.98, headS / 2, skin, { taper: 1.06, tex: headTex }));
  if (D && D.acid) F.push(limb([headS / 2 + 0.2, 0.4, hz + 0.6], [headS / 2 + 0.8, 0.6, hz - 2.4], 0.4, 0.4, D.acid, { sides: 4 })); // the drip
  if (D && D.sac) F.push(limb([-TD / 2 - 1.6, 1.2, shoulderZ + 2.4], [-TD / 2 - 1.8, 1.2, shoulderZ - 4.2], 2.9, 2.6, D.sac, { tex: (face, s, t) => (face === "top" || t < 0.2 ? shade(D.sac, 0.35) : t > 0.8 ? shade(D.sac, -0.3) : null) })); // the acid sac on its back
  if (D && D.eggs) for (const [f, l, z, r] of [[-TD / 2 - 1.0, -2.2, legH + 6.5, 2.4], [-TD / 2 - 1.3, 2.6, legH + 3.2, 2.1], [0.6, TW / 2 + 1.5, legH + 4.2, 2.2], [-0.8, -(TW / 2 + 1.5), legH + 6.8, 1.9]]) F.push(limb([f, l, z + r * 0.9], [f, l, z - r * 0.9], r, r, D.eggs, { sides: 6, tex: (face, s, t) => (face === "top" || t < 0.25 ? "#fff6c8" : t > 0.8 ? shade(D.eggs, -0.25) : null) })); // egg sacs hung on its back and sides
  if (D && D.plates) { for (const z of [legH + 2.6, legH + 5.6, legH + 8.4]) F.push(boxL([TD / 2 + 0.5, -TW / 2 + 0.3, z], [TD / 2 + 0.5, TW / 2 - 0.3, z], 1.3, 0.5, BONE, { u: [0, 0, 1], tex: (face, s, t) => (t > 0.85 ? shade(BONE, -0.3) : null) })); for (const side of [-1, 1]) F.push(boxL([0.6, side * (sideL + 0.2), shoulderZ - 7], [1.2, side * (sideL + 0.3), shoulderZ - 10.5], 0.9, 0.9, BONE, { u: [1, 0, 0] })); } // plates of fused bone over the chest and the forearms
  if (D && D.worms) { for (const [l, f0] of [[-1.6, 0.2], [1.2, -0.4], [0.2, 0.6]]) F.push(limb([TD / 2 + 0.2, l, legH + 4 + f0 * 3], [TD / 2 + 2.0 + f0, l + 0.6, legH + 1.2 + f0 * 2], 0.45, 0.45, WORM, { sides: 5, tex: (face, s, t) => (t > 0.85 ? WORM_D : null) })); F.push(limb([headS / 2, 0.2, hz + 1.6], [headS / 2 + 1.6, 0.6, hz - 1.2], 0.4, 0.4, WORM, { sides: 4 })); } // worms pushing out of the splits and the mouth
  if (D && D.crown) for (const l of [-2, 0, 2]) F.push(limb([0, l, hz + headS + 0.4], [0.2, l, hz + headS + 3.6], 0.5, 0.5, BONE, { sides: 4, taper: 0.4 })); // a crown of bone
  if (D && D.visorUp) F.push(boxL([headS / 2 - 1.2, -headS / 2 + 0.3, hz + headS + 0.4], [headS / 2 - 1.2, headS / 2 - 0.3, hz + headS + 0.4], 0.7, 0.4, "#9fb4c4", { u: [1, 0, 0], tex: (face, s, t) => (Math.abs(s - 0.4) < 0.08 ? "#5f7484" : null) })); // a riot visor pushed up, cracked
  F.push(limb([0, 0, hz + headS + 0.9], [0, 0, hz + headS - 0.1], headS / 2 * 0.78, headS / 2 * 0.8, hairy ? hair : skin, { taper: 1.25, tex: (face) => (face !== "top" && !hairy ? null : hairy ? hair : null) })); // the crown
  if (hs === "mohawk") F.push(boxL([headS * 0.4, 0, hz + headS + 0.5], [-headS * 0.4, 0, hz + headS + 0.5], 1.4, 0.6, hair, { u: [0, 0, 1] }));
  if (hs === "ponytail") F.push(limb([-headS / 2 - 0.4, 0, hz + headS - 1.4], [-headS / 2 - 1.2, 0, hz + 0.2], 0.9, 0.9, shade(hair, -0.2), { sides: 6, taper: 0.7 }));
  if (hs === "curly") F.push(limb([0, 0, hz + headS + 0.4], [0, 0, hz + headS - 2.2], headS / 2 + 0.7, headS / 2 + 0.7, hair, { taper: 1.0 }));
  if (app.helmet && HELMET_COL[app.helmet]) { // a worn helmet (the head slot; the soldier kit's): a shell over the crown, the full-face ones down to the jaw
    const hc = HELMET_COL[app.helmet], full = app.helmet === "bikehelmet" || app.helmet === "riothelmet" || app.helmet === "footballhelmet";
    F.push(limb([0, 0, hz + headS + 0.9], [0, 0, hz + headS * (full ? 0.12 : 0.45)], headS / 2 + 0.55, headS / 2 + 0.6, hc, { taper: full ? 1.0 : 1.12, tex: (face, s, t) => (full && face === "front" && t > 0.45 && t < 0.8 ? "#383b41" : face === "top" ? shade(hc, 0.1) : null) }));
    if (app.helmet === "hardhat" || app.helmet === "milhelmet") F.push(limb([0, 0, hz + headS * 0.5], [0, 0, hz + headS * 0.38], headS / 2 + 1.3, headS / 2 + 1.3, shade(hc, -0.2), { sides: 8 })); // the brim
  } else if (app.accessory === "cap") { F.push(limb([0, 0, hz + headS + 1.4], [0, 0, hz + headS - 0.6], headS / 2 + 0.3, headS / 2 + 0.35, app.accent, { taper: 1.08 })); F.push(boxL([headS / 2 - 0.2, 0, hz + headS - 0.4], [headS / 2 + 2.6, 0, hz + headS - 0.7], 0.35, headS / 2 + 0.2, shade(app.accent, -0.3), { u: [0, 0, 1] })); }
  if (app.hood) F.push(limb([0, 0, hz + headS + 1.4], [0, 0, hz + headS * 0.2], headS / 2 + 0.7, headS / 2 + 0.7, app.hood, { taper: 1.1, tex: (face, s, t) => (face === "front" && t > 0.35 ? skin : null) })); // a zealot's hood: the face open
  if (!app.helmet && app.accessory === "beanie") F.push(limb([0, 0, hz + headS + 1.6], [0, 0, hz + headS - 1.6], headS / 2 * 0.8, headS / 2 * 0.82, app.accent, { taper: 1.3 }));
  return F;
}

// The Crawler: what is left of one, flat to the ground, the head low and looking up, dragging itself on its arms.
function crawlerLimbs(F, o) {
  const { skin, cloth, eye, TW, TD, headS } = o;
  const marks = (part) => (face, s, t) => { for (const [pt, ms, mt, kind] of o.marks || []) if (pt === part && Math.abs(s - ms) < 0.14 && Math.abs(t - mt) < 0.1) return kind === "tear" ? skin : "#7a1c18"; return null; };
  F.push(limb([-6, 0, 2.4], [2.5, 0, 3.0], TD / 2 * 0.8, TW / 2 * 0.85, cloth, { u: [0, 0, 1], taper: 1.1, tex: marks("torso") })); // the body, flat
  F.push(limb([-6, -1.4, 1.4], [-9, -1.6, 1.0], 1.0, 1.0, shade(skin, -0.25), { sides: 6, taper: 0.6 })); // what is left of the legs
  F.push(limb([-6, 1.4, 1.4], [-8.4, 1.6, 1.0], 1.0, 1.0, shade(skin, -0.25), { sides: 6, taper: 0.6 }));
  F.push(limb([2.6, 0, 2.6], [5.4, 0, 2.8], 1.3, 1.4, shade(skin, -0.12), { sides: 6, u: [0, 0, 1] })); // the neck, craning up
  F.push(limb([4.6, 0, 1.0], [6.2, 0, 1.0 + headS * 1.1], headS / 2, headS / 2, skin, { taper: 0.95, tex: (face, s, t) => (face === "front" && t > 0.35 && t < 0.5 && (Math.abs(s - 0.32) < 0.09 || Math.abs(s - 0.68) < 0.09) ? eye : face === "front" && t > 0.65 && t < 0.78 && Math.abs(s - 0.5) < 0.22 ? "#3a1412" : null) })); // the head, looking up
  for (const side of [-1, 1]) { // the arms dragging it forward, bone at the fingertips
    const S = [1.6, side * (TW / 2 + 0.6), 3.4], E = [5.5, side * (TW / 2 + 2.2), 2.2], H = [9.5, side * (TW / 2 + 1.2), 0.9];
    F.push(limb(S, E, 1.2, 1.2, skin, { sides: 6, taper: 0.9 })); F.push(limb(E, H, 1.1, 1.1, skin, { sides: 6, taper: 0.9 }));
    F.push(limb(H, add(H, [1.8, 0, -0.2]), 0.6, 0.9, BONE, { sides: 4 }));
  }
  F.height = 8;
  return F;
}
// A worm swarm: a low, writhing mass of pale worms with a few raised heads.
function swarmLimbs(D) {
  const F = [], WL = "#fff8e0";
  F.push(limb([0, 0, 1.2], [0, 0, 0], 9.5, 7.5, "#7a6a48", { taper: 1.05 })); // the slime it moves on
  F.push(limb([0, 0, 3.0], [0, 0, 0.8], 8, 6.2, WORM_D, { taper: 1.2, tex: (face, s, t) => ((Math.round(s * 11) * 7 + Math.round(t * 5) * 3) % 4 === 0 ? WORM : (Math.round(s * 13) + Math.round(t * 7)) % 9 === 0 ? WL : null) })); // the mass
  for (const [f, l, h] of [[-4, -2, 4], [0, 3, 6], [3, -3, 5], [5.5, 2, 3], [-1, 0, 3.5]]) { F.push(limb([f, l, 2.4], [f + 0.8, l, 2.4 + h], 0.75, 0.75, WORM, { sides: 5, taper: 0.8 })); F.push(limb([f + 0.8, l, 2.4 + h], [f + 1.6, l, 2.4 + h + 0.8], 0.55, 0.55, "#5c1e1a", { sides: 4 })); } // raised heads
  F.height = 8;
  return F;
}
// The Broodmother (sim/hives.js; the flat sprite in ui/hivesprites.js), two tiles by two: the bloated queen on the
// mound she grows from, a swollen abdomen hung with egg sacs, a thorax rising to a small head with three eyes and a
// crown of bone, two long clawed arms reaching down the front to the ground. A tile is 16 units a side.
function broodmotherLimbs(D) {
  const F = [];
  const SKIN = "#9a7a86", DARK = "#5e3a48", LIT = "#c4a2ae", SAC = "#e8b46a", SAC_D = "#b07a3a", EYE = "#ffd166", VEIN = "#8a1c22";
  const veins = (face, s, t) => { const q = (Math.round(s * 10) * 7 + Math.round(t * 6) * 5) % 11; return q === 0 ? VEIN : q === 4 && t < 0.4 ? LIT : face === "top" ? LIT : null; };
  F.push(limb([0, 0, 5], [0, 0, 0], 15, 13, DARK, { taper: 1.12, tex: (face, s, t) => (face === "top" ? shade(DARK, 0.12) : (Math.round(s * 12) + Math.round(t * 3)) % 5 === 0 ? shade(DARK, -0.3) : null) })); // the mound
  F.push(limb([1, 0, 18], [1, 0, 4], 11.5, 10.5, SKIN, { taper: 1.1, tex: veins })); // the abdomen
  F.push(limb([3, 0, 27], [3, 0, 16], 6.5, 7.5, SKIN, { taper: 1.25, tex: veins })); // the thorax, leaning forward
  F.push(limb([4.5, 0, 29.5], [4.5, 0, 26], 2.4, 2.8, DARK, { sides: 6 })); // the neck
  F.push(limb([5, 0, 36.5], [5, 0, 29], 3.6, 3.8, SKIN, { taper: 1.05, tex: (face, s, t) => (face === "front" && t > 0.3 && t < 0.45 && (Math.abs(s - 0.25) < 0.08 || Math.abs(s - 0.5) < 0.08 || Math.abs(s - 0.75) < 0.08) ? EYE : face === "front" && t > 0.65 && t < 0.9 && Math.abs(s - 0.5) < 0.3 ? (Math.round(s * 9) % 2 ? BONE : "#3a1412") : face === "top" ? DARK : null) })); // the head: three eyes, a mouth ringed with bone
  for (const l of [-2.4, -1.2, 0, 1.2, 2.4]) F.push(limb([5, l, 36.2], [5.4, l, 36.2 + 3.4 - Math.abs(l) * 0.5], 0.55, 0.55, BONE, { sides: 4, taper: 0.35 })); // the crown of bone
  for (const [f, l, z, r] of [[-7, -8, 11, 3.2], [-8, 6, 9, 3.0], [-3, -11, 8, 2.8], [-2, 11, 10, 2.9], [-10, -1, 13, 3.4], [5, -10, 7, 2.5], [6, 10, 8, 2.6]]) F.push(limb([f, l, z + r * 0.9], [f, l, z - r * 0.9], r, r, SAC, { sides: 6, tex: (face, s, t) => (face === "top" || t < 0.3 ? "#fff0c0" : t > 0.78 ? SAC_D : null) })); // egg sacs round the abdomen
  for (const side of [-1, 1]) { // the arms: long, down the front, clawed
    const S = [5, side * 7.5, 25], E = [11, side * 10, 14], H = [14.5, side * 9, 3];
    F.push(limb(S, E, 2.2, 2.2, DARK, { sides: 6, taper: 0.85 })); F.push(limb(E, H, 1.9, 1.9, DARK, { sides: 6, taper: 0.8 }));
    for (const dl of [-1.4, 0, 1.4]) F.push(limb(H, add(H, [2.6, dl, -2.4]), 0.55, 0.55, BONE, { sides: 4, taper: 0.3 }));
  }
  for (const [f, l] of [[-12, -9], [-11, 10], [13, -11], [12, 12]]) F.push(limb([f, l, 2.2], [f, l, 0.3], 1.6, 1.5, "#e8b46a", { sides: 6, tex: (face) => (face === "top" ? "#fff0c0" : null) })); // pods at the mound's edge
  F.height = 40;
  return F;
}
// The Hivemind (sim/hivecrawl.js), two tiles by two: the organ at the heart of a hive, a swollen, folded mass of
// grey-pink flesh like a brain the size of a car, lobes on lobes, veined and glowing from inside, amber pods and
// tendrils coiled at its foot in a pool of flesh; its second phase swollen redder and torn open down the middle with
// light pouring out of the wound, the pods burst, the veins standing out, the tendrils thrashing.
function hivemindLimbs(D) {
  const F = [], p2 = D.phase === 2;
  const FLESH = p2 ? "#b8566a" : "#b07a86", DARK = p2 ? "#5a1a2a" : "#6a3a4a", LIT = p2 ? "#e07a8a" : "#d8a8b2", FOLD = p2 ? "#7a2a3a" : "#8a4a5a", VEIN = p2 ? "#ff3a2a" : "#8a1c22", GLOW = p2 ? "#ffd36b" : "#ffb43b", POD = "#e8b46a", CORE = "#fff4c8";
  const fold = (wound) => (face, s, t) => {
    if (wound && face === "front" && Math.abs(s - 0.5) < 0.13 && t > 0.1 && t < 0.92) return Math.abs(s - 0.5) < 0.06 ? CORE : GLOW; // the wound, pouring light
    const q = (Math.round(s * 12) * 5 + Math.round(t * 8) * 3) % 9;
    if (q === 0) return FOLD;
    if (q === 4 && (p2 || t < 0.6)) return VEIN;
    if (q === 7 && t < 0.5) return face === "top" ? "#fff0c0" : GLOW;
    return face === "top" ? LIT : null;
  };
  F.push(limb([0, 0, 1.2], [0, 0, 0], 16, 14, p2 ? "#3a0c14" : "#2a1018", { taper: 1.05 })); // the pool of flesh it grows from
  F.push(limb([0, 0, 22], [0, 0, 1], 12.5, 11.5, FLESH, { taper: 0.78, tex: fold(p2) })); // the mass
  for (const [f, l, z, r] of [[-6, -7, 15, 6.5], [5, 7.5, 16, 6.2], [7, -6, 13, 5.8], [-6, 6, 12, 5.6], [-9, 0, 17, 5.0], [8, 1, 18, 5.4]]) F.push(limb([f, l, z + r * 0.85], [f, l, z - r * 0.85], r, r * 0.95, FLESH, { sides: 8, taper: 1.12, tex: fold(false) })); // the lobes
  F.push(limb([1, 0, 28], [1, 0, 19], 6.5, 6.0, FLESH, { taper: 1.3, tex: fold(p2) })); // the crown lobe
  for (const [f, l] of [[-13, -6], [13, 5], [-9, 12], [10, -11], [-3, -15], [2, 14]]) F.push(limb([f, l, 3.2], [f, l, 0.4], 1.9, 1.8, p2 ? DARK : POD, { sides: 6, tex: (face) => (face === "top" ? (p2 ? VEIN : "#fff0c0") : null) })); // the pods at its foot, burst in the second phase
  for (const [f, l, df, dl] of [[-10, -10, -6, -4], [11, 9, 5, 6], [-6, 13, -4, 6], [12, -8, 6, -6], [-13, 3, -7, 2], [4, -14, 3, -6]]) { // tendrils, coiled; thrashing in the second phase
    const A = [f, l, 2.2], M = [f + df * 0.6, l + dl * 0.6, p2 ? 5.5 : 2.0], B = [f + df, l + dl, p2 ? 7.5 : 0.8];
    F.push(limb(A, M, 1.1, 1.1, DARK, { sides: 5, taper: 0.8 })); F.push(limb(M, B, 0.9, 0.9, DARK, { sides: 5, taper: 0.5 }));
  }
  F.height = 36;
  return F;
}
// One of the dead as a figure: the game's own roll for the variant and seed (ui/sprites.js zombieLookOf: palette,
// cloth, eyes, gore, build), reaching like the walkers do, torn clothes and wounds where the roll puts them.
const ZSTYLE = ["tshirt", "jacket", "tank", "jacket"];
export function zombieApp(variant, seed, look = undefined) {
  const z = look ? zombieLookOf(variant, seed, look) : zombieLookOf(variant, seed);
  const rng = z.rng;
  const parts = ["torso", "torso", "torso", "arm1", "arm-1", "leg1", "leg-1", "head"];
  const marks = [];
  for (let i = 0; i < 4; i++) marks.push([rng.pick(parts), rng.next(), rng.next(), "tear"]);
  const wounds = z.gore === 0 ? 0 : z.gore === 1 ? rng.int(2, 3) : rng.int(5, 8);
  for (let i = 0; i < wounds; i++) marks.push([rng.pick(parts), rng.next(), rng.next(), i % 2 ? "wound" : "blood"]);
  const zl = look || zombieLook();
  return {
    key: `z:${variant}:${seed}:${zl.palette}${zl.gore}${zl.eyes}${zl.clothes}`,
    build: z.build === "bloated" || z.build === "brute" ? "heavy" : z.build, skin: z.skin, hairStyle: rng.pick(["bald", "buzz", "short", "short", "long"]), hair: shade(z.skin, -0.5),
    facial: "none", topStyle: ZSTYLE[Math.abs(seed) % ZSTYLE.length], top: variant === "brute" ? z.skin : z.cloth, pants: z.pants, accessory: "none", accent: "#1f1f22",
    dead: { eye: z.eye, marks, pose: variant === "bloated" ? "hang" : "reach", bloated: variant === "bloated", brute: variant === "brute", run: variant === "runner" },
  };
}

// The special dead (sim/zombietypes.js, middead.js; the flat painters in ui/hivesprites.js) as figures: each one's
// colours, build, pose and the parts that mark it. Sleepers on their feet are walkers.
const Z = { red: "#e2412f", amber: "#e2e07a", cloth: "#4a4f44" };
export function specialApp(ztype, seed) {
  const key = `zt:${ztype}:${seed}`;
  const base = (skin, cloth, eye, dead, more = {}) => ({ key, build: "average", skin, hairStyle: "bald", hair: shade(skin, -0.5), facial: "none", topStyle: "tshirt", top: cloth, pants: shade(cloth, -0.15), accessory: "none", accent: "#1f1f22", dead: { eye, marks: [], pose: "reach", ...dead }, ...more });
  switch (ztype) {
    case "spitter": return base("#8ea36b", Z.cloth, Z.amber, { wide: 1.15, sac: "#9ad63a", acid: "#9ad63a", headDrop: 1.2 });
    case "screamer": return base("#a7a69b", "#3d3d42", Z.red, { thin: true, pose: "up" });
    case "crawler": return base("#9fb0b5", "#55603f", Z.red, { body: "crawler", room: 1.3 });
    case "shepherd": return base("#b9b4c8", "#5d5a66", "#e8e2ff", { pose: "crook", shroud: "#5d5a66", scale: 1.1 }, { hood: "#5d5a66" });
    case "carrier": return base("#c9c0a0", "#5a5648", Z.amber, { wide: 1.35, bloated: true, pose: "stubs", worms: true, splits: true, head: 0.85, headDrop: 1.5, legs: "short" });
    case "swarm": return base("#f0e4c0", "#7a6a48", Z.amber, { body: "swarm" });
    case "boneback": return base("#9a9483", "#3e3d36", Z.red, { wide: 1.2, plates: true, mask: true, headDrop: 1.0, scale: 1.1 });
    case "climber": return base("#a59a8c", "#4d4438", Z.amber, { thin: true, pose: "up", longArms: true, hooks: true });
    case "flinger": return base("#8f9a86", "#3f4a3a", Z.amber, { pose: "throw", longArms: true });
    case "sower": return base("#a8a07a", "#5a5440", Z.amber, { wide: 1.3, bloated: true, pose: "stubs", eggs: "#e8dca0", legs: "short" });
    case "nightmare": return base("#6e6a78", "#1e1c24", "#ff3a2a", { thin: true, scale: 1.15, pose: "claws", longArms: true, jaw: true });
    case "soldier": return base("#8ea36b", "#55603b", Z.amber, { camo: ["#55603b", "#3e4630", "#6b6a4a", "#4a3f2c"] }, { topStyle: "jacket", helmet: "milhelmet", armor: "plate" }); // the armoured dead (sim/deadsoldiers.js)
    case "riot": return base("#a7a69b", "#23262d", Z.amber, { pads: "#2e3137", visorUp: true }, { topStyle: "jacket", helmet: "riothelmet", armor: "riot" });
    default: return zombieApp("walker", seed); // a sleeper on its feet, anything new
  }
}
// The bosses (ui/hivesprites.js): the Wallbreaker, the Broodmother, the Hivemind and its second phase.
export function bossApp(kind) {
  const key = `boss:${kind}`;
  if (kind === "broodmother") return { key, build: "heavy", skin: "#9a7a86", hairStyle: "bald", hair: "#5e3a48", facial: "none", topStyle: "tank", top: "#9a7a86", pants: "#5e3a48", accessory: "none", accent: "#1f1f22", dead: { eye: "#ffd166", marks: [], body: "broodmother", scale: 2.3 } }; // two tiles by two (the grid; the body is in units)
  if (kind === "hivemind" || kind === "hivemind2") return { key, build: "average", skin: "#b07a86", hairStyle: "bald", hair: "#6a3a4a", facial: "none", topStyle: "tshirt", top: "#b07a86", pants: "#6a3a4a", accessory: "none", accent: "#1f1f22", dead: { eye: "#ffb43b", marks: [], body: "hivemind", phase: kind === "hivemind2" ? 2 : 1, scale: 2.3 } }; // two tiles by two
  return { key, build: "heavy", skin: "#8f9a86", hairStyle: "bald", hair: "#5e6858", facial: "none", topStyle: "tank", top: "#8f9a86", pants: "#3a3a36", accessory: "none", accent: "#1f1f22", dead: { eye: "#e2412f", marks: [["torso", 0.35, 0.4, "wound"], ["torso", 0.6, 0.55, "wound"], ["arm1", 0.5, 0.4, "wound"]], pose: "slab", wide: 1.35, scale: 1.5, headDrop: 2.2, head: 0.9, ribs: true } }; // the Wallbreaker
}
// One of the risen (sim/carriers.js): the person as they were and in what they wore, gone grey-green, reaching.
export function risenApp(app, armorKey, id) {
  const g = (c) => shade(c, -0.1);
  return { ...app, key: `risen:${app.key || ""}:${id}:${armorKey || ""}`, skin: mixHex(app.skin, "#9aa877", 0.6), top: mixHex(g(app.top), "#7f9a62", 0.22), pants: mixHex(g(app.pants), "#7f9a62", 0.22), hair: mixHex(app.hair, "#7f9a62", 0.3), dead: { eye: "#c8c4b0", marks: [["torso", 0.4, 0.5, "wound"], ["head", 0.6, 0.3, "blood"], ["leg-1", 0.5, 0.4, "tear"]], pose: "reach" } };
}
const mixHex = (a, b, t) => { const x = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), y = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`; };

// Paints a figure on a BW × BH grid at a yaw (degrees; YAW[facing] for the view's diagonals), standing on the
// tile's centre; tile: draw the 32 × 16 diamond under it (the preview sheets). Returns the painter (p.muzzle for guns).
export function paintBoxFigure(app, weaponKey = null, armorKey = null, yaw = 0, tile = false) {
  const lie = !!app.down;
  const limbs = figureLimbs(app, weaponKey, armorKey || (app.armor || null));
  const g = gridFor(((app.dead && app.dead.scale) || (app.dead && app.dead.brute ? 1.3 : 1)) * ((app.dead && app.dead.room) || 1), lie); // room: a wider grid for what reaches past the body
  const p = painter(g.w, g.h);
  p.fig = g;
  if (tile && !lie) for (let y = -8; y <= 8; y++) { const w = 16 - Math.abs(y) * 2; for (let x = -w; x <= w; x++) p.set(g.ox + x, g.oy + y, (x + y) % 3 === 0 ? "#4a5a36" : "#55673d"); }
  let buf = null;
  if (lie && app.down.pool) buf = paintLimbs(p, [limb([0, 0, 0.5], [0, 0, 0], 9.5, 6.5, app.down.burnt ? "#2a2220" : "#5c1210", { taper: 1.02 })], transformOf(yaw), g); // the pool it lies in
  buf = paintLimbs(p, limbs, transformOf(yaw, lie, limbs.height || 30), g, buf);
  rim(p, g, buf.gb);
  return p;
}
export const paintBoxSurvivor = (app, weaponKey = null, armorKey = null, facing = "SE", tile = false) => paintBoxFigure(app, weaponKey, armorKey, YAW[facing] ?? 0, tile);
export const paintBoxZombie = (variant, seed, facing = "SE", tile = false, look = undefined) => paintBoxFigure(zombieApp(variant, seed, look), null, null, YAW[facing] ?? 0, tile);

// ---------- the cache, the units, the inventory's spin ----------
const cache = new Map();
const MUZZLE = new WeakMap();
export const figureMuzzle = (cv) => (cv && MUZZLE.get(cv)) || null;
const lookKey = (a) => (a.key || [a.build, a.skin, a.hairStyle, a.hair, a.facial, a.topStyle, a.top, a.pants, a.accessory, a.accent, a.helmet, a.hood, a.sash, a.armband].join("|")) + (a.down ? `|down:${a.down.pose}:${a.down.pool ? 1 : 0}:${a.down.burnt ? 1 : 0}` : "");
const STEP = 15; // degrees a cached heading
// The figure's canvas at a yaw (rounded to STEP), cached by its look, weapon, armour and heading; cv.figure = FIG.
export function figureCanvas(app, look = null, armorKey = null, yaw = 0, o = {}) {
  const y = (((Math.round(yaw / STEP) * STEP) % 360) + 360) % 360;
  const key = `${lookKey(app)}|${look || ""}|${armorKey || ""}|${o.pack ? 1 : 0}|${y}`;
  let cv = cache.get(key);
  if (cv === undefined) {
    if (cache.size > 1200) cache.clear();
    const p = paintBoxFigure({ ...app, accessory: o.pack ? "backpack" : app.accessory }, look ? String(look).split("|")[0] : null, armorKey, y, false);
    cv = toCanvas(p);
    if (cv) { cv.figure = p.fig; if (p.muzzle) MUZZLE.set(cv, p.muzzle); }
    cache.set(key, cv);
  }
  return cv;
}
// A human enemy's look as a figure (ui/sprites.js enemyLookOf: the same rolls as its flat sprite).
function enemyApp(kit, color, seed) {
  const k = enemyLookOf(kit, seed), fc = color || "#a63a32", key = `e:${kit}:${seed}:${fc}`;
  if (kit === "soldiers") return { key, build: "average", skin: k.skin, hairStyle: "buzz", hair: k.hair, facial: k.facial, topStyle: "jacket", top: k.olive, pants: shade(k.olive, -0.1), accessory: "none", accent: fc, helmet: "milhelmet", armband: fc };
  if (kit === "zealots") return { key, build: "average", skin: k.skin, hairStyle: "bald", hair: k.hair, facial: k.facial, topStyle: "tshirt", top: k.robe, pants: shade(k.robe, -0.1), accessory: "none", accent: fc, hood: k.robe, sash: fc };
  return { key, build: "average", skin: k.skin, hairStyle: k.hairStyle, hair: k.hair, facial: k.facial, topStyle: k.topStyle, top: k.jacket, pants: k.pants, accessory: k.acc, accent: fc };
}
const variants = new WeakMap(); // battle unit -> zombie variant (kept off the sim objects, as ui/sprites.js does)
// The look of a battle unit as a figure's app (with its weapon look and armour): every kind of body the battle map
// has. salt varies looks between battles.
function unitApp(state, b, t, salt) {
  const seed = (t.id * 131 + salt) | 0;
  if (t.turned) { // one of the risen (sim/carriers.js): one of yours by their own look, else a raider's
    const T = t.turned, s = T.sid != null ? state.survivors.find((x) => x.id === T.sid) : null;
    if (s) return { app: risenApp(ensureAppearance(s, state.seed), spriteArmorKey(s), s.id), look: null, armor: spriteArmorKey(s) };
    const f = b.setup && b.setup.enemy && b.setup.enemy.factionId != null ? (state.factions || []).find((x) => x.id === b.setup.enemy.factionId) : null;
    return { app: risenApp(enemyApp(T.kit || "raiders", f ? f.color : null, Math.abs((T.from * 131) | 0) % 61), T.armorKey, T.from), look: null, armor: T.armorKey };
  }
  if (t.boss) return { app: bossApp(t.boss === "hivemind" && t.phase2 ? "hivemind2" : t.boss), look: null, armor: null };
  if (t.side === "player" && t.kind !== "zombie") {
    const s = state.survivors.find((x) => x.id === t.sid);
    const app = s ? ensureAppearance(s, state.seed) : ensureAppearance({ id: t.id }, salt);
    const g = s && s.gear;
    return { app: g && g.head ? { ...app, helmet: g.head.key } : app, look: t.weapon && t.weapon !== "fists" ? weaponLook(unitGun(t)) : null, armor: spriteArmorKey(s), o: { pack: !!(g && g.backpack) } };
  }
  if (t.kind === "zombie") {
    if (t.ztype === "runner" || t.ztype === "brute") return { app: zombieApp(t.ztype, seed), look: null, armor: null };
    if (t.ztype) return { app: specialApp(t.ztype, seed), look: null, armor: null };
    let c = variants.get(t);
    if (!c || c.seed !== seed) variants.set(t, (c = { seed, variant: zombieVariant(t, seed) }));
    return { app: zombieApp(c.variant, seed), look: null, armor: null };
  }
  const f = b.setup && b.setup.enemy && b.setup.enemy.factionId != null ? (state.factions || []).find((x) => x.id === b.setup.enemy.factionId) : null;
  return { app: enemyApp(t.kit || "raiders", f ? f.color : null, seed), look: t.weapon && t.weapon !== "fists" ? weaponLook(unitGun(t)) : null, armor: t.armorKey };
}
// The figure for a battle unit at a yaw (standing: on its feet even when down or dead, for a panel's doll).
export function unitFigure(state, b, t, salt, yaw, standing = false) {
  if (!standing && (t.dead || t.down)) return null;
  const u = unitApp(state, b, t, salt);
  return figureCanvas(u.app, u.look, u.armor, yaw, u.o || {});
}
// The figure of a unit lying on the ground (dead, or down and alive), its head toward the yaw; the dead in a pool.
export function unitFigureDown(state, b, t, salt, yaw) {
  const u = unitApp(state, b, t, salt);
  const D = u.app.dead;
  if (D && (D.body === "swarm" || D.body === "hivemind" || D.body === "broodmother")) return figureCanvas(t.dead ? { ...u.app, skin: shade(u.app.skin, -0.4), top: shade(u.app.top, -0.4) } : u.app, null, null, yaw); // no way to lay a mass down: darker
  return figureCanvas({ ...u.app, down: { pose: t.dead ? "dead" : "down", pool: !!t.dead } }, null, u.armor, yaw, u.o || {});
}
// A body on the ground (sim/sleepers.js: c.seed, c.burnt, c.burst) as a lying figure.
export function corpseFigure(c, yaw) {
  const app = zombieApp(c.seed % 5 === 0 ? "bloated" : "walker", c.seed);
  if (c.burnt) { app.key += ":burnt"; app.skin = "#2b2723"; app.top = "#1e1b19"; app.pants = "#1e1b19"; app.dead.marks = []; }
  if (c.burst) { app.key += ":burst"; app.dead.marks.push(["torso", 0.5, 0.5, "wound"], ["torso", 0.4, 0.6, "wound"], ["torso", 0.6, 0.4, "blood"]); }
  return figureCanvas({ ...app, down: { pose: "dead", pool: true, burnt: !!c.burnt } }, null, null, yaw);
}

// The inventory's spin: an <img> of the survivor that turns through 360° (24 frames, one every SPIN_MS), every
// frame drawn once and kept as a data URL. The panel may be rebuilt any time: the ticker finds every img[data-spin].
const SPIN_MS = 110, SPIN_N = 24;
const spins = new Map(); // key -> { args, urls }
let ticker = null;
function spinURL(key, k) {
  const sp = spins.get(key);
  if (!sp) return "";
  if (!sp.urls[k]) { const cv = figureCanvas(...sp.args, k * (360 / SPIN_N), sp.o); sp.urls[k] = cv ? cv.toDataURL() : ""; }
  return sp.urls[k];
}
function tick() {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
  const k = Math.floor(Date.now() / SPIN_MS) % SPIN_N;
  for (const img of document.querySelectorAll("img[data-spin]")) { const url = spinURL(img.dataset.spin, k); if (url && img.src !== url) img.src = url; }
}
export function figureSpinImg(state, s, size = 7) {
  const app = ensureAppearance(s, state.seed), g = s.gear || {};
  const look = g.weapon ? weaponLook(g.weapon) : null, armor = spriteArmorKey(s), o = { pack: !!g.backpack };
  const a = g.head ? { ...app, helmet: g.head.key } : app;
  const key = `${lookKey(a)}|${look || ""}|${armor || ""}|${o.pack ? 1 : 0}`;
  if (!spins.has(key)) { if (spins.size > 40) spins.clear(); spins.set(key, { args: [a, look, armor], o, urls: [] }); }
  if (!ticker && typeof document !== "undefined" && typeof document.querySelectorAll === "function" && typeof setInterval === "function") ticker = setInterval(tick, SPIN_MS); // only with a page to tick (the tests have none)
  return `<img class="sprite" data-spin="${key.replace(/"/g, "")}" src="${spinURL(key, 0)}" alt="" style="width:${(BW / BH) * size}rem;height:${size}rem">`;
}
