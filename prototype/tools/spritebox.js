// A prototype of survivors and the dead as box figures (Minecraft / Roblox body parts) painted in the battle map's
// own 2:1 dimetric projection (ui/isoview.js: a tile 32 × 16 art px, a unit 30 px tall, pixel art drawn
// nearest-neighbour), lit by the item art's light (the top lit, faces darker the more they turn to the screen's
// right). The figure has a yaw: it turns with the view's eight headings and spins through 360° in the inventory to
// show what is on it. Not wired into the game: tools/spritebox.html sheets it beside today's sprite
// (tools/spritemockshot.cjs spritebox.html saves the PNGs). Looks come from sim/appearance.js's data and
// ui/sprites.js zombieLookOf (the dead's own rolls: palette, eyes, gore, build).
import { painter, zombieLookOf } from "../src/ui/sprites.js";
import { shade } from "../src/ui/itemart/kit.js";

export const BW = 48, BH = 50; // the pixel grid; the figure stands on the tile's centre
const OX = BW / 2, OY = BH - 9;
export const FACINGS = ["SE", "SW", "NW", "NE"];
export const YAW = { SE: 0, SW: 90, NW: 180, NE: 270 }; // the four diagonal views; the straight ones lie 45° between

// ---------- the projection (isoview.js geometry: screen x = wx - wy, screen y = (wx + wy) / 2 - z) ----------
const SX = (x, y) => x - y, SY = (x, y, z) => (x + y) / 2 - z;
const VIEW = [1, 1, 0.8]; // toward the viewer: a face is seen when its normal leans this way

// A box in figure space: centre (f, l) on the ground, bottom z0, size (df forward, dl across, dz up), a colour,
// and an optional tex(face, s, t) → colour painted on its faces (s across 0..1, t down 0..1).
const box = (f, l, z0, df, dl, dz, col, tex = null) => ({ f, l, z0, df, dl, dz, col, tex });
// The six faces: an origin corner, the across and down vectors (figure space, unit extents), the outward normal.
const FACES = [
  { name: "front", o: (b) => [b.f + b.df / 2, b.l + b.dl / 2, b.z0 + b.dz], u: (b) => [0, -b.dl, 0], v: (b) => [0, 0, -b.dz], n: [1, 0, 0] },
  { name: "back",  o: (b) => [b.f - b.df / 2, b.l - b.dl / 2, b.z0 + b.dz], u: (b) => [0, b.dl, 0],  v: (b) => [0, 0, -b.dz], n: [-1, 0, 0] },
  { name: "left",  o: (b) => [b.f + b.df / 2, b.l + b.dl / 2, b.z0 + b.dz], u: (b) => [-b.df, 0, 0], v: (b) => [0, 0, -b.dz], n: [0, 1, 0] },
  { name: "right", o: (b) => [b.f - b.df / 2, b.l - b.dl / 2, b.z0 + b.dz], u: (b) => [b.df, 0, 0],  v: (b) => [0, 0, -b.dz], n: [0, -1, 0] },
  { name: "top",   o: (b) => [b.f - b.df / 2, b.l - b.dl / 2, b.z0 + b.dz], u: (b) => [b.df, 0, 0],  v: (b) => [0, b.dl, 0],  n: [0, 0, 1] },
];
function paintBox(p, b, yaw) {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const W = ([f, l, z]) => [f * c - l * s, f * s + l * c, z]; // figure → world
  for (const F of FACES) {
    const n = W(F.n);
    const seen = n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2];
    if (seen <= 0.02) continue;
    // the light: the top lit, a face darker the more it turns to the screen's right (+x), a little lighter to the left
    const light = 0.18 * n[2] - 0.3 * Math.max(0, n[0]) + 0.04 * Math.max(0, n[1]);
    const base = shade(b.col, light);
    const o = W(F.o(b)), u = W(F.u(b)), v = W(F.v(b));
    const lu = Math.hypot(u[0], u[1], u[2]) || 1, lv = Math.hypot(v[0], v[1], v[2]) || 1;
    const du = 0.45 / lu, dv = 0.45 / lv;
    for (let t = 0; t <= 1; t += dv) for (let q = 0; q <= 1; q += du) {
      const x = o[0] + u[0] * q + v[0] * t, y = o[1] + u[1] * q + v[1] * t, z = o[2] + u[2] * q + v[2] * t;
      let col = base;
      if (b.tex) { const tc = b.tex(F.name, q, t); if (tc) col = shade(tc, light); }
      p.set(Math.round(OX + SX(x, y)), Math.round(OY + SY(x, y, z)), col);
    }
  }
}
// Far boxes first: by the world depth of the box's centre, then its bottom.
function paintBoxes(p, boxes, yaw) {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const depth = (b) => (b.f * c - b.l * s) + (b.f * s + b.l * c);
  for (const b of [...boxes].sort((x, y) => depth(x) - depth(y) || x.z0 - y.z0)) paintBox(p, b, yaw);
}

// ---------- the figure ----------
const SHOE = "#2a2622";
const ARMOR = { vest: "#4d5440", plate: "#3c4148", padding: "#8a7f6a", tirevest: "#2a2a2a", sportspads: "#b8b0a0", scrapvest: "#6e5a48" };
export function holdOf(key) {
  if (!key || key === "fists" || key === "claws" || key === "acid") return null;
  if (["pistol", "revolver", "pistol22", "compact9", "pistol45", "usp45", "magnum", "snub357", "snub38", "service38", "fiveseven", "revolver44"].includes(key)) return "pistol";
  if (["bat", "spikedbat", "nailbat", "sledge", "fireaxe", "pickaxe", "spear", "pipespear", "golfclub", "katana", "broadsword"].includes(key)) return "shoulder";
  if (["pulleybow", "compbow"].includes(key)) return "bow";
  if (["knife", "machete", "sawmachete", "springmachete", "prybar", "baton", "stunbaton", "combatknife", "hatchet", "tomahawk", "kukri", "hammer", "etool", "cleaver", "bowie", "cutlass", "sabre"].includes(key)) return "side";
  return "gun";
}
const WEAPON_COL = { gun: "#2b2e33", pistol: "#2b2e33", side: "#9aa3ab", shoulder: "#7a5230", bow: "#7a5230" };

// The boxes of one figure. app: the survivor look (sim/appearance.js), plus for the dead: app.dead = { eye, wounds:
// [[part, s, t]...], tears: [[part, s, t]...], pose: "reach" | "hang", bloated, brute, run }. detail: "blocky"
// (six parts, Minecraft's) or "fine" (neck, hands, feet, a bent arm, a vest with depth).
// Figure space: forward +f, left +l, z up; the ground at z = 0; the right arm at -l.
export function figureBoxes(app, weaponKey = null, armorKey = null, detail = "fine") {
  const B = [];
  const fine = detail === "fine";
  const D = app.dead || null;
  const skin = app.skin, hair = app.hair, top = app.top, pants = app.pants;
  const big = D && D.brute ? 1.3 : 1;
  const wide = (app.build === "heavy" ? 1.25 : app.build === "slim" ? 0.85 : 1) * (D && D.bloated ? 1.5 : 1) * big;
  const TW = 8 * wide, TD = 4 * (app.build === "heavy" ? 1.3 : 1) * (D && D.bloated ? 1.7 : 1) * big;
  const legH = (fine ? 10 : 11) * big, torsoH = (fine ? 10 : 11) * big, headS = (fine ? 6.5 : 7) * (D && D.brute ? 1.1 : 1);
  const legW = TW / 2 - 0.3, legD = TD;
  const run = D && D.run ? 1.6 : 0;
  // the dead's wounds and torn clothes on a part: a tex layer over the part's own
  const marks = (part, under) => (face, s, t) => {
    if (D) {
      for (const [pt, ms, mt, kind] of D.marks) if (pt === part && Math.abs(s - ms) < 0.14 && Math.abs(t - mt) < 0.1) return kind === "tear" ? skin : kind === "wound" ? "#7a1c18" : "#5c1210";
    }
    return under ? under(face, s, t) : null;
  };
  // legs (the right leg at -l)
  for (const side of [-1, 1]) {
    const lc = side > 0 ? pants : shade(pants, -0.12);
    const fwd = run * side;
    if (fine) { B.push(box(fwd + 0.2, side * TW / 4, 0, legD + 0.6, legW + 0.4, 1.2, SHOE)); B.push(box(fwd, side * TW / 4, 1.2, legD, legW, legH - 1.2, lc, marks("leg" + side))); }
    else B.push(box(fwd, side * TW / 4, 0, legD, legW, legH, lc, marks("leg" + side, (face, s, t) => (t > 0.9 ? SHOE : null))));
  }
  // torso, the belt, the armour
  const armor = armorKey ? ARMOR[armorKey] || ARMOR.vest : null;
  const topTex = (face, s, t) => {
    if (t > 0.92 && !D) return "#2a2420";
    if (armor && t < 0.72 && t > 0.05 && face !== "top") return face === "front" || face === "back" ? (armorKey === "plate" && t > 0.2 && t < 0.6 && s > 0.2 && s < 0.8 ? shade(armor, -0.2) : armor) : shade(armor, -0.1);
    if (app.topStyle === "jacket" && face === "front" && Math.abs(s - 0.5) < 0.07) return shade(top, -0.4);
    if (app.topStyle === "flannel" && face !== "top" && ((Math.round(s * 6) % 2 === 0) !== (Math.round(t * 6) % 2 === 0))) return shade(top, -0.3);
    if (app.topStyle === "tank" && (face === "left" || face === "right") && t < 0.25) return skin;
    if (app.topStyle === "hoodie" && face === "back" && t < 0.2) return shade(top, -0.25);
    return null;
  };
  B.push(box(0, 0, legH, TD, TW, torsoH, top, marks("torso", topTex)));
  if (fine && armor) B.push(box(0, 0, legH + torsoH * 0.3, TD + 1, TW + 1, torsoH * 0.62, armor, (face, s, t) => (face === "top" ? shade(armor, 0.1) : armorKey === "plate" && face === "front" && s > 0.25 && s < 0.75 && t > 0.2 && t < 0.8 ? shade(armor, -0.2) : null)));
  if (app.accessory === "backpack") B.push(box(-TD / 2 - 1.5, 0, legH + 2, 3, TW * 0.7, torsoH * 0.8, "#6b4a2a", (face, s, t) => (face === "back" && t > 0.3 && t < 0.4 ? "#4a3220" : null)));
  // arms: the far (left, +l) arm hangs; the near (right, -l) hangs or holds; the dead reach with both
  const hold = holdOf(weaponKey);
  const reach = D && D.pose === "reach";
  const armW = (fine ? 2.6 : 3) * big, armH = (fine ? 6 : 11) * big, sleeve = app.topStyle === "tshirt" || app.topStyle === "tank";
  const armTex = (side) => marks("arm" + side, (face, s, t) => (sleeve && t > (fine ? 0.35 : 0.25) ? skin : null));
  const shoulderZ = legH + torsoH;
  const armAt = (side) => side * (TW / 2 + armW / 2 + 0.1);
  const forwardArm = (side, len, hand) => { // the whole arm out ahead, the hand at its end
    const l = armAt(side);
    if (fine) { B.push(box(0, l, shoulderZ - 3, armW, armW, 3, top, armTex(side))); B.push(box(len / 2 + 0.5, l, shoulderZ - 3.2, len, armW, armW, sleeve ? skin : shade(top, -0.1))); if (hand) B.push(box(len + 1.5, l, shoulderZ - 3.4, 2, armW + 0.2, armW + 0.4, skin)); }
    else B.push(box(len / 2, l, shoulderZ - 3, len, armW, armW, top, (face, s, t) => (sleeve && s > 0.3 ? skin : null)));
  };
  const hangArm = (side) => {
    const l = armAt(side);
    B.push(box(0, l, shoulderZ - armH, armW, armW, armH, top, armTex(side)));
    if (fine) { B.push(box(0, l, shoulderZ - 10, armW, armW, 4, sleeve ? skin : top)); B.push(box(0, l, shoulderZ - 11.6, armW, armW, 1.6, skin)); }
  };
  const bentArm = (side) => { // the upper arm down, the forearm forward at chest height, the fist on the grip
    const l = armAt(side);
    if (fine) { B.push(box(0, l, shoulderZ - 6, armW, armW, 6, top, armTex(side))); B.push(box(2.5, l, shoulderZ - 6.5, 5, armW, armW, sleeve ? skin : shade(top, -0.1))); B.push(box(5.8, l, shoulderZ - 6.5, 2, armW, armW + 0.2, skin)); }
    else B.push(box(5, l, shoulderZ - 3, 11, armW, armW, top, (face, s, t) => (sleeve && s > 0.3 ? skin : null)));
  };
  if (reach) { forwardArm(1, 9, true); forwardArm(-1, 9, true); }
  else {
    hangArm(1);
    if (hold === "gun" || hold === "pistol" || hold === "bow") bentArm(-1); else hangArm(-1);
  }
  // the weapon
  const nl = armAt(-1), wc = WEAPON_COL[hold];
  if (hold === "gun") { B.push(box(6, nl - 0.5, shoulderZ - 6, 11, 1.2, 1.8, wc)); B.push(box(4.5, nl - 0.5, shoulderZ - 8.5, 1.2, 1.2, 3, wc)); if (fine) B.push(box(7.5, armAt(1) * 0.3, shoulderZ - 7.5, 2.4, armW, 2, skin)); }
  else if (hold === "pistol") B.push(box(8, nl, shoulderZ - 6.5, 4, 1, 1.6, wc));
  else if (hold === "side") B.push(box(1.2, nl, shoulderZ - 12, 0.9, 0.9, 10, wc, (face, s, t) => (t > 0.8 ? "#7a5230" : null)));
  else if (hold === "shoulder") B.push(box(-2.5, nl - 0.5, shoulderZ - 4, 1.2, 1.2, 12, wc, (face, s, t) => (t < 0.2 ? "#55595e" : null)));
  else if (hold === "bow") B.push(box(7.5, nl, shoulderZ - 12, 0.9, 0.9, 13, wc));
  // the head: skin, the face on the front, hair by style, a helmet-sized cap or beanie
  const hz = shoulderZ + (fine ? 1 : 0);
  if (fine) B.push(box(0, 0, shoulderZ, 2.4, 2.6, 1, shade(skin, -0.15)));
  const hs = app.hairStyle, hairy = hs !== "bald";
  const hairOn = (face, t) => hairy && (face === "top" || (face === "back" && (hs === "long" || hs === "curly" ? t < 0.95 : t < 0.35)) || ((face === "left" || face === "right") && (hs === "long" ? t < 0.85 : hs === "buzz" ? t < 0.12 : t < 0.3)) || (face === "front" && t < (hs === "buzz" ? 0.08 : 0.2)));
  const eye = D ? D.eye : "#1a1a1a";
  const headTex = marks("head", (face, s, t) => {
    if (app.accessory === "bandana" && face !== "top" && t > 0.62 && t < 0.95 && face !== "back") return app.accent;
    if (app.accessory === "headband" && face !== "top" && t > 0.15 && t < 0.3) return app.accent;
    if (face === "front") {
      if (t > 0.42 && t < 0.56 && (Math.abs(s - 0.3) < 0.08 || Math.abs(s - 0.7) < 0.08)) return eye;
      if (app.accessory === "glasses" && t > 0.4 && t < 0.58) return "#1d1f24";
      if (app.facial === "beard" && t > 0.72) return hair;
      if (app.facial === "stache" && t > 0.68 && t < 0.78 && Math.abs(s - 0.5) < 0.3) return hair;
      if (app.facial === "stubble" && t > 0.72 && ((Math.round(s * 7) + Math.round(t * 7)) % 2 === 0)) return shade(skin, -0.25);
      if (D && t > 0.74 && t < 0.9 && Math.abs(s - 0.5) < 0.24) return "#3a1210"; // the dead's open mouth
      if (t > 0.8 && t < 0.88 && Math.abs(s - 0.5) < 0.22) return shade(skin, -0.3);
    }
    if (hairOn(face, t)) return face === "top" ? shade(hair, 0.18) : face === "right" || face === "back" ? shade(hair, -0.25) : hair;
    return null;
  });
  B.push(box(0, 0, hz, headS, headS, headS, skin, headTex));
  if (hs === "mohawk") B.push(box(0, 0, hz + headS, headS * 0.8, 1.2, 2.5, hair));
  if (hs === "ponytail") B.push(box(-headS / 2 - 0.8, 0, hz + 1, 1.4, 1.6, headS * 0.8, shade(hair, -0.2)));
  if (hs === "curly") B.push(box(0, 0, hz + headS - 0.5, headS + 1.2, headS + 1.2, 1.6, hair));
  if (app.accessory === "cap") { B.push(box(0, 0, hz + headS, headS + 0.6, headS + 0.6, 1.8, app.accent)); B.push(box(headS / 2 + 1.2, 0, hz + headS, 2.6, headS + 0.6, 0.6, shade(app.accent, -0.3))); }
  if (app.accessory === "beanie") B.push(box(0, 0, hz + headS - 1, headS + 0.6, headS + 0.6, 3, app.accent));
  return B;
}

// One of the dead as a figure: the game's own roll for the variant and seed (ui/sprites.js zombieLookOf: palette,
// cloth, eyes, gore, build), reaching like the walkers do, torn clothes and wounds where the roll puts them.
const ZSTYLE = ["tshirt", "jacket", "tank", "jacket"];
export function zombieApp(variant, seed, look = undefined) {
  const z = look ? zombieLookOf(variant, seed, look) : zombieLookOf(variant, seed);
  const rng = z.rng;
  const parts = ["torso", "torso", "torso", "arm1", "arm-1", "leg1", "leg-1", "head"];
  const marks = [];
  const tears = z.style === undefined ? 4 : 4;
  for (let i = 0; i < tears; i++) marks.push([rng.pick(parts), rng.next(), rng.next(), "tear"]);
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
export function paintBoxFigure(app, weaponKey = null, armorKey = null, yaw = 0, detail = "fine", tile = false) {
  const p = painter(BW, BH);
  if (tile) for (let y = -8; y <= 8; y++) { const w = 16 - Math.abs(y) * 2; for (let x = -w; x <= w; x++) p.set(OX + x, OY + y, (x + y) % 3 === 0 ? "#4a5a36" : "#55673d"); }
  paintBoxes(p, figureBoxes(app, weaponKey, armorKey, detail), yaw);
  return p;
}
export const paintBoxSurvivor = (app, weaponKey = null, armorKey = null, facing = "SE", detail = "fine", tile = false) => paintBoxFigure(app, weaponKey, armorKey, YAW[facing] ?? 0, detail, tile);
export const paintBoxZombie = (variant, seed, facing = "SE", detail = "fine", tile = false, look = undefined) => paintBoxFigure(zombieApp(variant, seed, look), null, null, YAW[facing] ?? 0, detail, tile);
