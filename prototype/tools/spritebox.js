// A prototype of survivors and the dead as low-poly figures (Project Zomboid's kind: rounded, tapered body parts
// with arms that reach their weapon) painted in the battle map's own 2:1 dimetric projection (ui/isoview.js: a tile
// 32 × 16 art px, a unit 30 px tall, pixel art drawn nearest-neighbour), lit by the item art's light (the top lit,
// faces darker the more they turn to the screen's right). The figure has a yaw: it turns with the view's eight
// headings and spins through 360° in the inventory to show what is on it. Not wired into the game:
// tools/spritebox.html sheets it beside today's sprite (tools/spritemockshot.cjs spritebox.html saves the PNGs).
// Looks come from sim/appearance.js's data and ui/sprites.js zombieLookOf (the dead's own rolls).
//
// One primitive, the limb: a prism between two points with an n-sided (elliptical) cross-section, tapered toward
// its far end, its faces lit by their normals. Body parts are vertical limbs (8 sides: round enough), arms are two
// limbs shoulder → elbow → hand with the hand placed on the weapon, weapons are 4-sided limbs (boxes) along any
// direction. A depth buffer sorts everything per pixel, so an arm across the chest or a gun through the hands draws
// right at every yaw.
import { painter, zombieLookOf } from "../src/ui/sprites.js";
import { shade } from "../src/ui/itemart/kit.js";

export const BW = 48, BH = 52; // the pixel grid; the figure stands on the tile's centre
const OX = BW / 2, OY = BH - 9;
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
function paintLimb(p, zb, gb, L, W) {
  const d = sub(L.B, L.A), length = len(d), axis = norm(d);
  let u = L.u ? norm(L.u) : Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : norm(cross([0, 0, 1], axis));
  u = norm(sub(u, mul(axis, dot(u, axis))));
  const v = cross(axis, u);
  const plot = (P, col) => {
    const w = W(P), x = Math.round(OX + SX(w)), y = Math.round(OY + SY(w));
    if (x < 0 || y < 0 || x >= BW || y >= BH) return;
    const dep = DEPTH(w), i = y * BW + x;
    if (dep > zb[i]) { zb[i] = dep; p.px[i] = col; gb[i] = L.group; }
  };
  const lit = (nf, col) => { const n = W(nf); return shade(col, 0.18 * n[2] - 0.3 * Math.max(0, n[0]) + 0.04 * Math.max(0, n[1])); };
  const seen = (nf) => dot(W(nf), VIEW) > 0.02;
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
function paintLimbs(p, limbs, yaw) {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const W = (q) => [q[0] * c - q[1] * s, q[0] * s + q[1] * c, q[2]];
  const zb = new Float32Array(BW * BH).fill(-1e9), gb = new Uint8Array(BW * BH);
  for (const L of limbs) paintLimb(p, zb, gb, L, W);
  // a dark rim where a weapon (group 1) meets the body, so it reads against clothes of its own colour
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    const i = y * BW + x;
    if (!p.px[i] || gb[i]) continue;
    if ((x > 0 && gb[i - 1]) || (x < BW - 1 && gb[i + 1]) || (y > 0 && gb[i - BW]) || (y < BH - 1 && gb[i + BW])) p.px[i] = OUTLINE;
  }
}

// ---------- the figure ----------
const SHOE = "#2a2622";
const ARMOR = { vest: "#4d5440", plate: "#3c4148", padding: "#8a7f6a", tirevest: "#2a2a2a", sportspads: "#b8b0a0", scrapvest: "#6e5a48" };
export function holdOf(key) {
  if (!key || key === "fists" || key === "claws" || key === "acid") return null;
  if (["pistol", "revolver", "pistol22", "compact9", "pistol45", "usp45", "magnum", "snub357", "snub38", "service38", "fiveseven", "revolver44"].includes(key)) return "pistol";
  if (["smg", "ump45", "p90", "vector"].includes(key)) return "smg";
  if (["bat", "spikedbat", "nailbat", "sledge", "fireaxe", "pickaxe", "spear", "pipespear", "golfclub", "katana", "broadsword"].includes(key)) return "shoulder";
  if (["pulleybow", "compbow"].includes(key)) return "bow";
  if (["knife", "machete", "sawmachete", "springmachete", "prybar", "baton", "stunbaton", "combatknife", "hatchet", "tomahawk", "kukri", "hammer", "etool", "cleaver", "bowie", "cutlass", "sabre"].includes(key)) return "side";
  return "gun";
}
const GUN = "#3a3f47", WOOD = "#7a5230", STEEL = "#b8c0c6";

// The limbs of one figure. app: the survivor look (sim/appearance.js), plus for the dead app.dead = { eye, marks:
// [[part, s, t, kind]...], pose: "reach" | "hang", bloated, brute, run }. Figure space: forward +f, left +l, z up;
// the ground at z = 0; the right arm at -l.
export function figureLimbs(app, weaponKey = null, armorKey = null) {
  const F = [];
  const D = app.dead || null;
  const skin = app.skin, hair = app.hair, top = app.top, pants = app.pants;
  const big = D && D.brute ? 1.3 : 1;
  const wide = (app.build === "heavy" ? 1.22 : app.build === "slim" ? 0.86 : 1) * (D && D.bloated ? 1.45 : 1) * big;
  const TW = 8 * wide, TD = 4.2 * (app.build === "heavy" ? 1.25 : 1) * (D && D.bloated ? 1.6 : 1) * big; // the torso across and deep
  const legH = 10 * big, torsoH = 10 * big, headS = 6.4 * (D && D.brute ? 1.1 : 1);
  const shoulderZ = legH + torsoH;
  const short = app.topStyle === "tshirt" || app.topStyle === "tank";
  const run = D && D.run ? 1.8 : 0;
  // the dead's wounds and torn clothes on a part, over the part's own paint
  const marks = (part, under) => (face, s, t) => {
    if (D) for (const [pt, ms, mt, kind] of D.marks) if (pt === part && Math.abs(s - ms) < 0.14 && Math.abs(t - mt) < 0.1) return kind === "tear" ? skin : kind === "wound" ? "#7a1c18" : "#5c1210";
    return under ? under(face, s, t) : null;
  };
  // legs and feet (the right leg at -l), tapered to the ankle
  for (const side of [-1, 1]) {
    const l = side * TW / 4, lc = side > 0 ? pants : shade(pants, -0.1), fwd = run * side;
    F.push(limb([fwd, l, legH], [fwd, l, 1.4], TD / 2 * 0.92, TW / 4 * 0.9, lc, { taper: 0.78, tex: marks("leg" + side) }));
    F.push(limb([fwd - 0.8, l, 0.7], [fwd + 2.4, l, 0.7], 0.7, TW / 4 * 0.8, SHOE, { sides: 6, u: [0, 0, 1] }));
  }
  // the torso: narrower at the waist, the belt; a vest around it with its own depth
  const topTex = (face, s, t) => {
    if (t > 0.92 && !D) return "#2a2420";
    if (app.topStyle === "jacket" && face === "front" && Math.abs(s - 0.5) < 0.07) return shade(top, -0.4);
    if (app.topStyle === "flannel" && face !== "top" && ((Math.round(s * 6) % 2 === 0) !== (Math.round(t * 6) % 2 === 0))) return shade(top, -0.3);
    if (app.topStyle === "tank" && (face === "left" || face === "right") && t < 0.25) return skin;
    if (app.topStyle === "hoodie" && face === "back" && t < 0.2) return shade(top, -0.25);
    return null;
  };
  F.push(limb([0, 0, shoulderZ], [0, 0, legH], TD / 2, TW / 2, top, { taper: 0.88, tex: marks("torso", topTex) }));
  F.push(limb([0, 0, shoulderZ + 0.2], [0, 0, shoulderZ - 1.4], TD / 2 * 0.9, TW / 2 * 0.98, top, { taper: 1.0 })); // the shoulders' round
  const armor = armorKey ? ARMOR[armorKey] || ARMOR.vest : null;
  if (armor) F.push(limb([0, 0, shoulderZ - 0.8], [0, 0, legH + 2.6], TD / 2 + 0.6, TW / 2 + 0.5, armor, { taper: 0.92, tex: (face, s, t) => (face === "top" ? shade(armor, 0.1) : armorKey === "plate" && (face === "front" || face === "back") && s > 0.25 && s < 0.75 && t > 0.15 && t < 0.8 ? shade(armor, -0.2) : t < 0.12 && (face === "front" || face === "back") && Math.abs(s - 0.5) > 0.25 ? shade(armor, -0.3) : null) }));
  if (app.accessory === "backpack") F.push(boxL([-TD / 2 - 0.4, 0, legH + 9.5], [-TD / 2 - 0.4, 0, legH + 2.5], 1.6, TW * 0.34, "#6b4a2a", { u: [1, 0, 0], tex: (face, s, t) => (face === "back" && t > 0.3 && t < 0.4 ? "#4a3220" : null) }));
  // arms: shoulder → elbow → hand, the hand on the weapon
  const hold = holdOf(weaponKey);
  const armR = 1.35 * big, sideL = TW / 2 + armR + 0.25;
  const SH = (side) => [0, side * sideL, shoulderZ - 1.3];
  const armTex = (side) => marks("arm" + side, (face, s, t) => (short && t > 0.4 ? skin : null));
  const arm = (side, E, H) => {
    const S = SH(side);
    F.push(limb(S, E, armR, armR, top, { sides: 6, taper: 0.9, tex: armTex(side) }));
    F.push(limb(E, H, armR * 0.9, armR * 0.9, short ? skin : shade(top, -0.08), { sides: 6, taper: 0.9 }));
    F.push(limb(H, add(H, mul(norm(sub(H, E)), 1.8)), armR * 1.05, armR * 0.8, skin, { sides: 6 })); // the hand
  };
  const hang = (side) => arm(side, [-0.4, side * (sideL + 0.3), shoulderZ - 6.4], [0.4, side * (sideL + 0.4), shoulderZ - 11.3]);
  const reach = (side) => arm(side, [4.6, side * (sideL - 0.2), shoulderZ - 2.6], [9.4, side * TW * 0.3, shoulderZ - 3.2]);
  if (D && D.pose === "reach") { reach(1); reach(-1); }
  else if (hold === "gun" || hold === "smg") {
    // low ready: the gun ahead and a little to the right, muzzle down; the right hand on the grip, the left out to the fore-end
    const long = hold === "gun";
    const butt = [long ? -1.8 : -0.6, -2.8, shoulderZ - 3.2], muzzle = [long ? 11 : 8.2, -2.4, shoulderZ - (long ? 5.4 : 4.2)];
    const grip = lerp(butt, muzzle, 0.3), fore = lerp(butt, muzzle, long ? 0.68 : 0.66);
    arm(-1, [1.0, -(sideL + 1.0), shoulderZ - 5.8], add(grip, [0, -0.9, -0.9]));
    arm(1, [2.6, TW / 2 - 0.4, shoulderZ - 6.4], add(fore, [0, -0.3, -1.0]));
    F.push(boxL(butt, muzzle, 1.0, 0.6, GUN, { group: 1, u: [0, 0, 1], tex: (face, s, t) => (t < 0.26 ? shade(GUN, -0.2) : t > 0.8 ? shade(GUN, 0.1) : null) }));
    F.push(boxL(add(grip, [1.6, 0, -0.4]), add(grip, [1.9, 0, -3.2]), 0.6, 0.45, GUN, { group: 1 })); // the magazine
  } else if (hold === "pistol") {
    const H = [7.4, -(sideL - 0.3), shoulderZ - 3.6];
    arm(-1, [3.6, -(sideL + 0.6), shoulderZ - 3.2], H);
    hang(1);
    F.push(boxL(add(H, [0.2, 0, 1.0]), add(H, [4.6, 0, 0.7]), 0.6, 0.45, GUN, { group: 1, u: [0, 0, 1] }));
    F.push(boxL(add(H, [0.4, 0, 1.0]), add(H, [0.2, 0, -0.8]), 0.5, 0.45, shade(GUN, -0.2), { group: 1 })); // the grip through the fist
  } else if (hold === "side") {
    hang(1); hang(-1);
    const l = -(sideL + 0.5);
    F.push(boxL([1.0, l, shoulderZ - 12.6], [1.1, l, shoulderZ - 2.0], 0.75, 0.3, STEEL, { group: 1, u: [1, 0, 0], tex: (face, s, t) => (t < 0.2 ? "#3a2a1c" : null) }));
  } else if (hold === "shoulder") {
    const l = -(sideL + 0.2), A = [1.8, l, shoulderZ - 8.6], B = [-5.4, l, shoulderZ + 5.4];
    arm(-1, [1.0, l - 1.2, shoulderZ - 5.6], add(A, [-0.2, 0, 0.6]));
    arm(1, [2.6, TW / 2 - 0.6, shoulderZ - 5.6], add(lerp(A, B, 0.24), [0.2, 0.3, 0]));
    F.push(boxL(A, B, 0.55, 0.55, WOOD, { group: 1, u: [1, 0, 0] }));
    F.push(boxL(add(B, [0, -1.9, 0]), add(B, [0, 1.9, 0]), 1.2, 1.0, "#55595e", { group: 1, u: [0, 0, 1] })); // the head
  } else if (hold === "bow") {
    const H = [7.2, -(sideL - 0.4), shoulderZ - 4.2];
    arm(-1, [3.6, -(sideL + 0.6), shoulderZ - 3.6], H);
    arm(1, [-0.6, sideL + 0.8, shoulderZ - 3.8], [2.4, -1.2, shoulderZ - 4.2]); // the string hand drawn to the chest
    F.push(boxL(add(H, [0.6, 0, -7.4]), add(H, [0.6, 0, 7.2]), 0.42, 0.42, WOOD, { group: 1, u: [1, 0, 0] }));
    F.push(boxL(add(H, [0.1, 0, -7.0]), add(H, [0.1, 0, 6.8]), 0.16, 0.16, "#d6dde2", { group: 1, u: [1, 0, 0] })); // the string
  } else { hang(1); hang(-1); }
  // the neck and the head: rounder at the crown, the face on the front, hair by style
  F.push(limb([0, 0, shoulderZ + 1.2], [0, 0, shoulderZ - 0.6], 1.3, 1.4, shade(skin, -0.12), { sides: 6 }));
  const hz = shoulderZ + 0.9, hs = app.hairStyle, hairy = hs !== "bald";
  const hairOn = (face, t) => hairy && (face === "top" || (face === "back" && (hs === "long" || hs === "curly" ? t < 0.95 : t < 0.38)) || ((face === "left" || face === "right") && (hs === "long" ? t < 0.85 : hs === "buzz" ? t < 0.14 : t < 0.32)) || (face === "front" && t < (hs === "buzz" ? 0.1 : 0.22)));
  const eye = D ? D.eye : "#1a1a1a";
  const headTex = marks("head", (face, s, t) => {
    if (app.accessory === "bandana" && face !== "top" && face !== "back" && t > 0.62 && t < 0.95) return app.accent;
    if (app.accessory === "headband" && face !== "top" && t > 0.17 && t < 0.3) return app.accent;
    if (face === "front") {
      if (t > 0.42 && t < 0.56 && (Math.abs(s - 0.32) < 0.09 || Math.abs(s - 0.68) < 0.09)) return eye;
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
  F.push(limb([0, 0, hz + headS + 0.9], [0, 0, hz + headS - 0.1], headS / 2 * 0.78, headS / 2 * 0.8, hairy ? hair : skin, { taper: 1.25, tex: (face) => (face !== "top" && !hairy ? null : hairy ? hair : null) })); // the crown
  if (hs === "mohawk") F.push(boxL([headS * 0.4, 0, hz + headS + 0.5], [-headS * 0.4, 0, hz + headS + 0.5], 1.4, 0.6, hair, { u: [0, 0, 1] }));
  if (hs === "ponytail") F.push(limb([-headS / 2 - 0.4, 0, hz + headS - 1.4], [-headS / 2 - 1.2, 0, hz + 0.2], 0.9, 0.9, shade(hair, -0.2), { sides: 6, taper: 0.7 }));
  if (hs === "curly") F.push(limb([0, 0, hz + headS + 0.4], [0, 0, hz + headS - 2.2], headS / 2 + 0.7, headS / 2 + 0.7, hair, { taper: 1.0 }));
  if (app.accessory === "cap") { F.push(limb([0, 0, hz + headS + 1.4], [0, 0, hz + headS - 0.6], headS / 2 + 0.3, headS / 2 + 0.35, app.accent, { taper: 1.08 })); F.push(boxL([headS / 2 - 0.2, 0, hz + headS - 0.4], [headS / 2 + 2.6, 0, hz + headS - 0.7], 0.35, headS / 2 + 0.2, shade(app.accent, -0.3), { u: [0, 0, 1] })); }
  if (app.accessory === "beanie") F.push(limb([0, 0, hz + headS + 1.6], [0, 0, hz + headS - 1.6], headS / 2 * 0.8, headS / 2 * 0.82, app.accent, { taper: 1.3 }));
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
  return {
    build: z.build === "bloated" || z.build === "brute" ? "heavy" : z.build, skin: z.skin, hairStyle: rng.pick(["bald", "buzz", "short", "short", "long"]), hair: shade(z.skin, -0.5),
    facial: "none", topStyle: ZSTYLE[Math.abs(seed) % ZSTYLE.length], top: variant === "brute" ? z.skin : z.cloth, pants: z.pants, accessory: "none", accent: "#1f1f22",
    dead: { eye: z.eye, marks, pose: variant === "bloated" ? "hang" : "reach", bloated: variant === "bloated", brute: variant === "brute", run: variant === "runner" },
  };
}

// Paints a figure on a BW × BH grid at a yaw (degrees; YAW[facing] for the view's diagonals), standing on the
// tile's centre; tile: draw the 32 × 16 diamond under it. Returns the painter.
export function paintBoxFigure(app, weaponKey = null, armorKey = null, yaw = 0, tile = false) {
  const p = painter(BW, BH);
  if (tile) for (let y = -8; y <= 8; y++) { const w = 16 - Math.abs(y) * 2; for (let x = -w; x <= w; x++) p.set(OX + x, OY + y, (x + y) % 3 === 0 ? "#4a5a36" : "#55673d"); }
  paintLimbs(p, figureLimbs(app, weaponKey, armorKey), yaw);
  return p;
}
export const paintBoxSurvivor = (app, weaponKey = null, armorKey = null, facing = "SE", tile = false) => paintBoxFigure(app, weaponKey, armorKey, YAW[facing] ?? 0, tile);
export const paintBoxZombie = (variant, seed, facing = "SE", tile = false, look = undefined) => paintBoxFigure(zombieApp(variant, seed, look), null, null, YAW[facing] ?? 0, tile);
