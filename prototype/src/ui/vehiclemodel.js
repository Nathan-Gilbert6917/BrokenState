// The battle map's cars and trucks as low-poly models, the look of the State Map's vehicles (ui/mapfigures.js; the
// user's ask 2026-10-25: "Improve the look of the vehicles in raid/crawls, make them look similar to the current world
// map vehicle sprite"): the same parts built from ui/figures.js's one primitive (limb: a tapered prism between two
// points, lit by its normals) in the battle's own 2:1 projection, at the battle's scale (a tile 16 art px along an
// axis, a person 30 tall), with the map's details: a body on eight-sided wheels with hubs and spokes, a cab of glass
// with a lit corner, lamps at the nose and tail lights behind, a pickup's bed rails and tarp, the Army truck's canvas on
// its ribs and the white star on its door, the Humvee's and the MRAP's ring gun, and the upgrades of sim/vehicles.js
// (steel plates riveted along the body, patchy scrap plates, grilles or thick green glass over the windows, a machine
// gun on a ring on the roof, a bright ring round the hatch while the gunner stands in it). A dark rim where one part
// stands in front of another and the outline round the whole, as the map's pieces have.
//
// A car covers 2 × 3–5 cells of the map (sim/combat.js placeCar, placeVehicle); the view draws the map by cell, back
// to front, with the people among them, so a car drawn as one picture would stand in front of someone beside its far
// end. So the car is painted whole, once, and every pixel is tagged with the cell its surface point stands over
// (figures.js paintLimbs' cell buffer, W.cell); each cell then draws its own share of the picture (vehicleCellSprite,
// cut from the whole: no outline along the cut, the outline round the whole car only), as the old per-cell prisms did
// (isoview.js carPieces: the straight view's still, where the 2:1 projection does not fit the grid).
//
// Model space: +x forward (along the car's length), +y left, z up, the ground at z = 0, art px, the origin under the
// middle of the car's footprint. The model turns with the car's heading in the view (a yaw in the figures' degrees:
// 0 the view's +u, screen down-right). Which model (modelOf): the team's own vehicle by its type (sim/vehicles.js
// VEHICLE_TYPES: a pickup, a sedan, an SUV, a Hummer, a work van, the Army cargo truck, a bicycle), the map's parked
// cars by their dice (a sedan, a pickup or a van), its box trucks, and the Army trucks of sim/miltrucks.js (the M35,
// the Humvee, the MRAP). Pure UI: a canvas per cell, cached by everything it depends on (the cell key is the view's,
// isoview.js sprite; the whole car's painting kept here by its look and heading).
import { limb as limbR, boxL as boxR, paintLimbs } from "./figures.js";
import { painter } from "./sprites.js";
import { shade } from "./itemart/kit.js";
import { onForgetPictures } from "./pictures.js";

const TILE = 16;              // art px along an axis of a cell (isoview.js HW)
const SW = 22, SH = 11;       // a cell in the straight view (isoview.js SW, SH): its top-left corner the origin, u right, v down
const SS = 2;                 // the painting's grid px an art px (supersampled: finer wheels, windows and rims than the figures' 1)
const UP = 4;                 // canvas px an art px of a cell's picture (the figures' toCanvas UP: crisp at the view's zooms)
const HH = 8;                 // half a tile's height on screen (isoview.js HH): a cell's centre is HH below its top vertex
export const VEH_TOP = 28;    // a car's roof, head high on a survivor (isoview.js VEH_TOP)
const OUTLINE = "#0b0c0e";
// The figures' light (figures.js LIGHT), a touch harder, as the carts have it (ui/cartmodel.js): the faces must part.
const LIGHT = (n) => 0.2 * n[2] - 0.34 * Math.max(0, n[0]) + 0.05 * Math.max(0, n[1]) - 0.08 * Math.max(0, -n[2]);
const SX = (p) => p[0] - p[1], SY = (p) => (p[0] + p[1]) / 2 - p[2];

// ---------- colours (the map's vehicles': ui/mapfigures.js) ----------
const TIRE = "#1c1c1e", HUB = "#8a8a8a", GLASS = "#7d9db5", GLASS_LIT = "#b9d3e2", WHITE = "#e8e4da", CANVAS = "#b3a27a", OLIVE = "#5d6b3a", OLIVE_DARK = "#454f2c";
const METAL = "#7d848c", STEEL = "#cdd5da", PLATE = "#6f757c", PLATE_DK = "#4d5258", SCRAP_A = "#7b5a44", SCRAP_B = "#5f6158", BGLASS = "#7fb3a6", MESH = "#3e4044", LAMP = "#ffe28a", TAIL = "#d24a3a";
const GUN = "#26272a", RING = "#e8c04a", RUST = "#8a5438", SOOT = "#1a1816", TARP = "#8c7a52", SNOW = "#e7ecf1", SHADOW = "#1a1a16", TRIM = "#2e3034", GRILLE = "#1f2124", MIRROR = "#3a3c40";
export const TEAM_BLUE = "#2f5d8a"; // the team's own vehicle (isoview.js PAL.blue)
const BURNT = "#2b2723", MIL_OLIVE = "#4d5a32", MIL_WRECK = "#4a4a34", BOX_RUST = "#653d2a"; // the prisms' colours (isoview.js carPieces), kept
export const CAR_COLORS = ["#7a3b34", "#3b5a7a", "#6b6b6b", "#7a6a34", "#3f6b4a", "#5a4a6a"]; // the map's parked cars by their dice (isoview.js)
const mixHex = (a, b, f) => { const x = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), y = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, "0")).join("")}`; };
const hash = (a, b = 0, c = 0) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// The models' limbs and boxes are true prisms (figures.js flat: straight sides between the corners, not a limb's cushion).
const limb = (A, B, ra, rb, col, o = {}) => limbR(A, B, ra, rb, col, { flat: true, ...o });
const boxL = (A, B, ha, hb, col, o = {}) => boxR(A, B, ha, hb, col, { flat: true, ...o });
// ---------- the parts ----------
// Groups: a part of its own within the car (the rim parts them; figures.js paintLimbs' group byte).
const G = { body: 1, wheels: 2, cab: 3, bonnet: 4, rails: 5, load: 6, weapon: 7, plate: 8, trim: 9, shadow: 10 };
// A wheel: a short 8-sided limb across the axle, its end faces a tyre with a hub and three spokes, grooves round the
// tread. f, l the hub; r the radius; tw the tyre's width.
function wheel(push, f, l, r, tw) {
  push(limb([f, l - tw / 2, r], [f, l + tw / 2, r], r, r, TIRE, {
    sides: 8, group: G.wheels,
    tex: (face, s, t) => {
      if (face !== "left" && face !== "right") return Math.round(s * 5) % 2 ? shade(TIRE, 0.14) : null; // the tread
      const dx = s - 0.5, dy = t - 0.5, d = Math.hypot(dx, dy) * 2, ang = Math.atan2(dy, dx);
      if (d < 0.26) return HUB;
      const T3 = (Math.PI * 2) / 3, a3 = ((ang % T3) + T3) % T3;
      if (d < 0.66 && (a3 < 0.3 || a3 > T3 - 0.3)) return shade(HUB, -0.25);
      return d < 0.7 ? "#3a3a3e" : null;
    },
  }));
}
// A cab's window on a face: glass with a lit corner; meshed over or armoured glass with upgrades; dark when burnt out.
// A cab is a vertical box (A its top, B its bottom, u forward), so its side faces get s along it and t down it. win:
// the band of t (down from the top) and s (along the face) that is glass; extra: the rest of the face's texture.
const glassTex = (o, win = [0.06, 0.55, 0.1, 0.9], extra = null, roof = null) => (face, s, t) => {
  if (face === "top") return roof;
  if (face === "bottom") return extra ? extra(face, s, t) : null;
  const [t0, t1, s0, s1] = win;
  if (!(t > t0 && t < t1 && s > s0 && s < s1)) return extra ? extra(face, s, t) : null;
  if (o.burnt) return SOOT;
  if (o.mesh) return (Math.round(s * 12) + Math.round(t * 12)) % 2 ? MESH : GLASS;
  return o.glass ? BGLASS : s < 0.3 && t < 0.25 ? GLASS_LIT : GLASS;
};
// The end of a box along the way (s up the face, t across it): the lamps at the front, the tail lights behind.
const endTex = (lamp, tail, dark = null, o = {}) => (face, s, t) => (face === "bottom" ? dark : face === "front" && lamp && Math.abs(t - 0.5) > 0.3 && Math.abs(s - 0.55) < 0.2 ? (o.burnt ? SOOT : lamp) : face === "back" && tail && Math.abs(t - 0.5) > 0.3 && Math.abs(s - 0.55) < 0.2 ? (o.burnt ? SOOT : tail) : null);
// Weather on a parked car (not the team's): rust in patches on the paint; burnt out: soot. Wrapped over a texture.
const worn = (o, seed, tex = null) => (!o.rust && !o.burnt ? tex : (face, s, t) => {
  const c = tex ? tex(face, s, t) : null;
  if (c) return c;
  const q = hash(Math.floor(s * 9) + seed * 7, Math.floor(t * 23) + seed, face.length);
  if (o.burnt) return q < 0.35 ? SOOT : null;
  return q > 0.9 ? RUST : q < 0.05 ? shade(RUST, -0.3) : null;
});
// The ground's shadow under a body (x0..x1 long, hw wide): a dark sheet on the ground, out past the sides a little.
const shadow = (push, x0, x1, hw) => push(boxL([x0 + 1.5, 0, 0.25], [x1 - 1.5, 0, 0.25], 0.25, hw + 1.2, SHADOW, { u: [0, 0, 1], group: G.shadow }));
// A bumper across an end of the body (x: where; z: its height; hw: half the body's width), the grille's dark band on a
// nose (a front face's tex), the door lines down a cab's sides (s along the face: toward the front on the left face,
// the back on the right, figures.js paintLimb; at: the doors' edges as s on the left face), a mirror out from a cab.
const bumper = (push, x, z, hw) => push(boxL([x, -hw + 0.5, z], [x, hw - 0.5, z], 0.9, 0.9, TRIM, { u: [1, 0, 0], group: G.trim }));
const grille = (o) => (face, s, t) => (face === "front" && t > 0.2 && t < 0.8 && Math.abs(s - 0.5) < 0.35 ? (Math.round(s * 9) % 2 ? GRILLE : shade(GRILLE, 0.25)) : null);
const doors = (body, at, extra = null) => (face, s, t) => {
  const sf = face === "right" ? 1 - s : s;
  if ((face === "left" || face === "right") && t > 0.1 && t < 0.97 && at.some((a) => Math.abs(sf - a) < 0.025)) return shade(body, -0.4);
  if ((face === "left" || face === "right") && t > 0.6 && t < 0.68 && at.some((a) => sf > a - 0.16 && sf < a - 0.06)) return shade(body, -0.3); // the handles
  return extra ? extra(face, s, t) : null;
};
const mirrors = (push, x, hw, z) => { for (const side of [-1, 1]) { push(boxL([x, side * hw, z], [x, side * (hw + 2.2), z], 0.4, 0.4, TRIM, { u: [0, 0, 1], group: G.trim })); push(boxL([x, side * (hw + 2.2), z + 0.2], [x, side * (hw + 2.2), z - 1.2], 1.0, 0.5, MIRROR, { u: [1, 0, 0], group: G.trim })); } };
// plates (p: 1 a row along the body up to its belt line, 2 over the windows' lower part as well), scrap (s): the sides
// armoured, a plate across the nose; a gun on the roof (t): a ring, a shield and a barrel forward; manned: a bright
// ring round the hatch.
function armour(push, o, x0, x1, hw, z0, z1, z2, roof) {
  const n = o.plating || 0, sc = o.scrap || 0;
  const zt = n > 1 ? Math.min(z2, z1 + 4) : z1;
  if (sc || n) {
    for (const side of [-1, 1]) push(boxL([x0 + 0.5, side * (hw + 0.6), (z0 + zt) / 2], [x1 - 0.5, side * (hw + 0.6), (z0 + zt) / 2], (zt - z0) / 2, 0.6, sc ? SCRAP_A : PLATE, { u: [0, 0, 1], group: G.plate, tex: (face, s, t) => (sc ? ((Math.round(s * 2) + Math.round(t * 9)) % 2 ? SCRAP_B : null) : Math.round(t * 11) % 2 && s > 0.8 ? PLATE_DK : null) }));
    if (n) push(boxL([x1 - 0.3, 0, (z0 + z1) / 2], [x1 + 0.6, 0, (z0 + z1) / 2], (z1 - z0) / 2, hw - 1, PLATE, { u: [0, 0, 1], group: G.plate, tex: (face, s, t) => (face === "front" && Math.round(s * 7) % 3 === 0 && Math.round(t * 5) % 2 ? PLATE_DK : null) })); // the nose
  }
  if (o.turret && roof) {
    const [f, z] = roof;
    push(limb([f, 0, z + 3.2], [f, 0, z], 4.2, 4.2, o.manned ? RING : PLATE_DK, { sides: 8, group: G.weapon, tex: (face) => (face === "top" ? (o.manned ? RING : PLATE_DK) : PLATE_DK) })); // the ring (bright while manned)
    push(boxL([f - 2.4, 0, z + 5.2], [f - 2.4, 0, z + 3.2], 0.5, 3.4, PLATE_DK, { u: [1, 0, 0], group: G.weapon })); // the gunner's shield, behind the gun
    push(boxL([f - 1.0, 0, z + 4.2], [f + (o.turret === "m2hb" ? 15 : 11), 0, z + 4.2], 0.8, 0.7, GUN, { u: [0, 0, 1], group: G.weapon })); // the barrel, forward
  }
}

// Every model: the parts between x0 and x1 (the body's ends), half-width HW, narrower than the two cells across it
// (a car is longer than it is wide, whatever its footprint); L cells long. The roofs at or under VEH_TOP (head high).
// o: { color, burnt, rust, seed, plating, scrap, glass, mesh, turret, manned }.
// A car's shell: the body a low box from sill to belt line (the hood and the boot are its top), the cabin a six-sided
// limb laid across it at the belt (cabin): its upper half shows, a flat roof with the windscreen and the rear window
// sloping down to the belt, the side windows on its ends in the shape of the cabin; the wheels in their arches, inside
// the body's width, their tyres showing under the sills and their outer faces just proud of the sides.
// The cabin limb lies along y, so on its sloped faces s and t both run across the car; on its ends (the sides) s runs
// along the car (toward the back) and t up it.
function cabin(push, o, body, xc, zb, half, height, hw, pillars = [0.5]) {
  const rb = height / Math.cos(Math.PI / 6), roof = shade(body, 0.2);
  const pane = (s, t) => (o.burnt ? SOOT : o.mesh ? ((Math.round(s * 14) + Math.round(t * 14)) % 2 ? MESH : GLASS) : o.glass ? BGLASS : s < 0.3 && t < 0.3 ? GLASS_LIT : GLASS);
  push(limb([xc, -hw, zb], [xc, hw, zb], half, rb, body, { sides: 6, phase: 0, group: G.cab, u: [-1, 0, 0], tex: (face, s, t) => {
    if (face === "top") return roof;
    if (face === "bottom") return shade(body, -0.3);
    if (face === "front" || face === "back") return t > 0.06 && t < 0.94 ? pane(t, face === "front" ? 1 - s : s) : shade(body, -0.35); // the windscreen and the rear window, a frame at their edges
    // The sides: windows above the belt (t > 0.5: the lower half is inside the body), the pillars between the doors.
    if (t < 0.56) return null;
    if (pillars.some((a) => Math.abs(s - a) < 0.03) || s < 0.1 || s > 0.9 || t > 0.93) return shade(body, -0.35);
    return pane(face === "left" ? s : 1 - s, 1 - t);
  } }));
}
// A wheel in its arch: the hub at (f, ±(hw - tw / 2 + 0.8)): the tyre's outer face a touch proud of the body's side.
const wheels = (push, fs, hw, r, tw) => { for (const f of fs) for (const side of [-1, 1]) wheel(push, f, side * (hw - tw / 2 + 0.7), r, tw); };
// The body: a low box from the sill (z0) to the belt line (z1), lamps and a grille at the nose, tail lights behind, the
// doors' seams down the sides (at: fractions along it from the back), a darker sill under it.
function shell(push, o, body, x0, x1, hw, z0, z1, at = [], lamps = true, tails = true) {
  const dark = shade(body, -0.3);
  const ends = endTex(lamps ? LAMP : null, tails ? TAIL : null, dark, o), gr = lamps ? grille(o) : () => null;
  push(boxL([x0, 0, (z0 + z1) / 2], [x1, 0, (z0 + z1) / 2], (z1 - z0) / 2, hw, body, { u: [0, 0, 1], group: G.body, tex: worn(o, 1, (face, s, t) => {
    if ((face === "left" || face === "right") && at.some((a) => Math.abs(t - a) < 0.012)) return shade(body, -0.4);
    if (face === "top") return shade(body, 0.12);
    return ends(face, s, t) || gr(face, s, t);
  }) }));
  push(boxL([x0 + 0.5, 0, z0 + 0.6], [x1 - 0.5, 0, z0 + 0.6], 0.6, hw + 0.3, shade(body, -0.45), { u: [0, 0, 1], group: G.trim })); // the sill
  bumper(push, x1 + 0.3, z0 + 1.6, hw); bumper(push, x0 - 0.3, z0 + 1.6, hw);
  shadow(push, x0, x1, hw);
}
// A sedan: a long low body, the cabin set back on it, the hood longer than the boot.
function sedan(push, o, L) {
  const body = o.color, x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 9, len = x1 - x0;
  const belt = 14, xc = x0 + len * 0.44, half = len * 0.3;
  shell(push, o, body, x0, x1, HW, 4.5, belt, [0.32, 0.56]);
  cabin(push, o, body, xc, belt, half, 9, HW - 0.8, [0.5]);
  mirrors(push, xc + half * 0.5, HW - 0.8, belt + 2.5);
  wheels(push, [x0 + 8, x1 - 8], HW, 6, 3.4);
  armour(push, o, x0, x1, HW, 4, belt, belt + 8, [xc, belt + 10]);
}
// A pickup: the cab on the body's middle, the bed behind it between its rails with a tailgate, a load under a tarp.
function pickup(push, o, L) {
  const body = o.color, x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 9, len = x1 - x0;
  const belt = 15, half = 9.5, xc = x0 + len * 0.6, cab0 = xc - half;
  shell(push, o, body, x0, x1, HW, 5.5, belt, [0.62]);
  cabin(push, o, body, xc, belt, half, 11, HW - 0.8, []);
  mirrors(push, xc + half * 0.5, HW - 0.8, belt + 3);
  for (const side of [-1, 1]) push(boxL([x0 + 0.6, side * (HW - 0.9), belt + 1.4], [cab0 - 1.2, side * (HW - 0.9), belt + 1.4], 1.4, 0.9, body, { u: [0, 0, 1], group: G.rails, tex: (face) => (face === "top" ? shade(body, -0.2) : null) })); // the bed's rails
  push(boxL([x0 + 0.6, 0, belt + 1.4], [x0 + 0.6, 0, belt + 1.4], 1.4, HW - 0.9, body, { u: [1, 0, 0], group: G.rails, tex: (face, s, t) => (face === "back" && Math.abs(t - 0.5) < 0.3 && Math.abs(s - 0.5) < 0.12 ? shade(body, -0.35) : null) })); // the tailgate
  if (!o.burnt) push(boxL([x0 + 3, 0, belt + 2.2], [cab0 - 3, 0, belt + 2.2], 2.6, HW - 2.4, TARP, { u: [0, 0, 1], group: G.load, tex: (face, s, t) => (face === "top" ? (Math.round(t * 6) % 3 === 0 ? shade(TARP, -0.15) : shade(TARP, 0.2)) : null) })); // the load under a tarp
  wheels(push, [x0 + 10, x1 - 10], HW, 6.5, 3.6);
  armour(push, o, x0, x1, HW, 5, belt, belt + 9, [xc, belt + 11]);
}
// An SUV: a tall body, a long cabin running back to the tailgate, two doors a side, a rack on the roof, big wheels.
function suv(push, o, L) {
  const body = o.color, x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 9.5, len = x1 - x0;
  const belt = 16, xc = x0 + len * 0.42, half = len * 0.4;
  shell(push, o, body, x0, x1, HW, 6, belt, [0.3, 0.58]);
  cabin(push, o, body, xc, belt, half, 11, HW - 0.8, [0.36, 0.62]);
  mirrors(push, xc + half * 0.55, HW - 0.8, belt + 3);
  const top = belt + 11;
  for (const l of [-HW + 3.5, HW - 3.5]) push(boxL([xc - half * 0.5, l, top + 1], [xc + half * 0.4, l, top + 1], 0.5, 0.5, METAL, { u: [0, 0, 1], group: G.rails })); // the roof rack
  for (const f of [xc - half * 0.4, xc + half * 0.3]) push(boxL([f, -HW + 3.5, top + 1], [f, HW - 3.5, top + 1], 0.5, 0.5, METAL, { u: [0, 0, 1], group: G.rails }));
  wheels(push, [x0 + 8.5, x1 - 8.5], HW, 6.8, 3.6);
  armour(push, o, x0, x1, HW, 6, belt, belt + 8, [xc, top]);
}
// A work van: a short nose, then one tall box to the back doors: the cab's windows forward, the sliding door's seam.
function van(push, o, L) {
  const body = o.color, x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 9.5, len = x1 - x0, top = VEH_TOP + 1;
  const belt = 15, box0 = x0 + 0.4, box1 = x1 - len * 0.2;
  shell(push, o, body, x0, x1, HW, 5.5, belt, [0.22, 0.5]);
  const pane = (s, t) => (o.burnt ? SOOT : o.mesh ? ((Math.round(s * 12) + Math.round(t * 12)) % 2 ? MESH : GLASS) : o.glass ? BGLASS : s < 0.3 && t < 0.25 ? GLASS_LIT : GLASS);
  push(boxL([(box0 + box1) / 2, 0, top], [(box0 + box1) / 2, 0, belt], (box1 - box0) / 2, HW - 0.4, body, { u: [1, 0, 0], group: G.cab, tex: worn(o, 2, (face, s, t) => {
    if (face === "top") return shade(body, 0.2);
    if (face === "bottom") return null;
    const sf = face === "right" ? 1 - s : s;
    if (face === "left" || face === "right") return sf > 0.76 && sf < 0.96 && t > 0.1 && t < 0.55 ? pane(sf, t) : (Math.abs(sf - 0.5) < 0.02 || Math.abs(sf - 0.22) < 0.02) && t > 0.1 ? shade(body, -0.4) : null;
    if (face === "front") return t > 0.1 && t < 0.6 && s > 0.08 && s < 0.92 ? pane(s, t) : null;
    return Math.abs(s - 0.5) < 0.02 && t > 0.1 ? shade(body, -0.4) : null;
  }) }));
  mirrors(push, box1 - 1.5, HW - 0.4, belt + 6);
  wheels(push, [x0 + 8.5, x1 - 8], HW, 6.2, 3.4);
  armour(push, o, x0, x1, HW, 5, belt, belt + 8, [(box0 + box1) / 2 + 3, top]);
}
// A Humvee: a wide low slab body with a long flat hood, a squat cab with near-vertical glass, big wheels; a ring gun
// on the roof when it has one (the team's by its upgrades; the enemy's and the groups' always).
function humvee(push, o, L) {
  const body = o.color, x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 11, len = x1 - x0, top = VEH_TOP;
  const belt = 16, cab0 = x0 + len * 0.1, cab1 = x0 + len * 0.52;
  shell(push, o, body, x0, x1, HW, 6.5, belt, [0.3, 0.52], true, false);
  push(boxL([(cab0 + cab1) / 2, 0, top], [(cab0 + cab1) / 2, 0, belt], (cab1 - cab0) / 2, HW - 0.6, body, { u: [1, 0, 0], group: G.cab, tex: worn(o, 2, glassTex(o, [0.1, 0.55, 0.06, 0.94], (face, s, t) => (face !== "top" && face !== "bottom" && Math.abs(s - 0.5) < 0.03 && t > 0.08 && t < 0.9 ? shade(body, -0.4) : null), shade(body, 0.2))) }));
  mirrors(push, cab1 - 1.5, HW - 0.6, belt + 7);
  wheels(push, [x0 + len * 0.17, x1 - len * 0.17], HW, 7.2, 3.8);
  const t = o.turret ? o : { ...o, turret: o.gun ? "m2hb" : null };
  armour(push, t, x0, x1, HW, 6, belt, belt + 8, [(cab0 + cab1) / 2 - 1, top]);
}
// An MRAP: a tall slab-sided hull with a V bottom, a crew box with slit windows, a short armoured nose and a turret.
function mrap(push, o, L) {
  const body = o.color, x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 11, top = VEH_TOP + 4;
  const cab0 = x0 + 1, cab1 = x1 - 11;
  shadow(push, x0, x1, HW - 1);
  push(boxL([x0 + 1, 0, 11.5], [x1 - 1, 0, 11.5], 5.5, HW - 1.5, body, { u: [0, 0, 1], group: G.body, tex: worn(o, 1, (face) => (face === "bottom" ? shade(body, -0.3) : null)) })); // the V hull
  bumper(push, x1 + 0.2, 8, HW - 1); bumper(push, x0 - 0.2, 8, HW - 1);
  push(boxL([(cab0 + cab1) / 2, 0, top], [(cab0 + cab1) / 2, 0, 17], (cab1 - cab0) / 2, HW, body, { u: [1, 0, 0], group: G.cab, tex: worn(o, 2, (face, s, t) => (face === "top" ? shade(body, 0.2) : (face === "left" || face === "right") && t > 0.12 && t < 0.3 && Math.round(s * 9) % 2 === 0 && s > 0.1 && s < 0.9 ? (o.burnt ? SOOT : BGLASS) : null)) })); // the crew box, slit windows
  push(boxL([cab1 + 0.3, 0, 22.5], [x1 - 0.4, 0, 22.5], 5.5, HW - 0.6, shade(body, 0.05), { u: [0, 0, 1], group: G.bonnet, tex: worn(o, 3, (face, s, t) => (face === "back" && t > 0.1 && t < 0.45 && Math.abs(s - 0.5) < 0.42 ? (o.burnt ? SOOT : BGLASS) : face === "top" ? shade(body, 0.15) : face === "front" && Math.abs(t - 0.5) > 0.32 && Math.abs(s - 0.5) < 0.2 ? (o.burnt ? SOOT : LAMP) : null)) })); // the nose, the windscreen up its back
  wheels(push, [x0 + 11, x1 - 11], HW + 1.5, 7, 3.8);
  const t = o.turret ? o : { ...o, turret: o.gun ? "m2hb" : null };
  armour(push, t, x0, x1, HW, 6, 17, 28, [(cab0 + cab1) / 2 + 2, top]);
}
// An Army cargo truck (the M35, sim/miltrucks.js): a tall square cab over a long bonnet, a canvas-covered bed on six
// wheels, a white star on the door; burnt out, the canvas gone to its ribs.
function m35(push, o, L) {
  const body = o.color, dark = shade(body, -0.3), x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 10, top = VEH_TOP + 2;
  const canvas = o.burnt ? null : o.cond === "wrecked" ? "#7a7458" : mixHex(CANVAS, o.tint || body, o.tint ? 0.3 : 0.1);
  const bed0 = x0 + 0.5, bed1 = x1 - 26, cab0 = bed1 + 1.5, cab1 = cab0 + 12;
  shadow(push, x0, x1, HW);
  push(boxL([x0, 0, 9.5], [x1, 0, 9.5], 3.5, HW, body, { u: [0, 0, 1], group: G.body, tex: worn(o, 1, (face) => (face === "bottom" ? dark : null)) })); // the chassis
  bumper(push, x1 + 0.4, 7, HW); bumper(push, x0 - 0.4, 7, HW);
  mirrors(push, cab1 - 1.5, HW - 0.6, 24);
  if (canvas) push(boxL([(bed0 + bed1) / 2, 0, top], [(bed0 + bed1) / 2, 0, 13], (bed1 - bed0) / 2, HW - 0.4, canvas, { u: [1, 0, 0], group: G.load, tex: (face, s, t) => (face === "top" ? shade(canvas, 0.2) : (face === "left" || face === "right") && Math.round(s * 12) % 3 === 0 ? shade(canvas, -0.18) : face === "back" && t > 0.2 && t < 0.9 && s > 0.15 && s < 0.85 ? shade(canvas, -0.3) : null) })); // the canvas over its ribs, laced shut behind
  else for (let f = bed0 + 2; f < bed1; f += 6) push(boxL([f, 0, top - 1], [f, 0, 13], 0.6, HW - 0.8, "#3a2e26", { u: [1, 0, 0], group: G.load })); // bare ribs
  push(boxL([(cab0 + cab1) / 2, 0, top], [(cab0 + cab1) / 2, 0, 13], (cab1 - cab0) / 2, HW - 0.6, body, { u: [1, 0, 0], group: G.cab, tex: worn(o, 2, glassTex(o, [0.08, 0.5, 0.1, 0.9], (face, s, t) => ((face === "left" || face === "right") && t > 0.58 && t < 0.92 && Math.abs(s - 0.5) < 0.22 && !o.burnt ? star(s, t) : null), shade(body, 0.2))) })); // the cab, the star on its door
  push(boxL([cab1 + 0.3, 0, 17], [x1 - 0.4, 0, 17], 4, HW - 1, body, { u: [0, 0, 1], group: G.bonnet, tex: worn(o, 3, (face, s, t) => endTex(LAMP, null, null, o)(face, s, t) || grille(o)(face, s, t) || (face === "top" ? shade(body, 0.15) : null)) })); // the bonnet: the lamps and the grille on its nose
  wheels(push, [x0 + 9, x0 + 23, x1 - 9], HW + 1.4, 6.5, 3.6);
  armour(push, o, x0, x1, HW, 6, 13, 26, [(cab0 + cab1) / 2 - 1, top]);
}
// The white star in a 0.44 × 0.34 patch of a door (s across, t down): five points round the middle.
function star(s, t) {
  const x = (s - 0.5) / 0.22, y = (t - 0.75) / 0.17, r = Math.hypot(x, y);
  if (r > 1) return null;
  const a = Math.atan2(y, x), k = Math.cos((a * 5) % (Math.PI * 2));
  return r < 0.45 + 0.55 * Math.max(0, k) ? WHITE : null;
}
// A box truck (the map's parked trucks): a tall cab and a cargo box behind it on six wheels.
function boxtruck(push, o, L) {
  const body = o.color, dark = shade(body, -0.3), x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 10, top = VEH_TOP + 2;
  const box0 = x0 + 0.5, box1 = x1 - 19, cab0 = box1 + 1.5, cab1 = x1 - 1;
  const boxC = o.box || mixHex("#5a5a5e", body, 0.15); // o.box: the box in its own paint (a fire engine's, an ambulance's)
  shadow(push, x0, x1, HW);
  push(boxL([x0, 0, 8.5], [x1, 0, 8.5], 3, HW, body, { u: [0, 0, 1], group: G.body, tex: worn(o, 1, endTex(null, TAIL, dark, o)) })); // the chassis
  bumper(push, x1 + 0.4, 6, HW); bumper(push, x0 - 0.4, 6, HW);
  mirrors(push, cab1 - 3, HW - 0.8, 22);
  push(boxL([(box0 + box1) / 2, 0, top], [(box0 + box1) / 2, 0, 11.5], (box1 - box0) / 2, HW - 0.2, boxC, { u: [1, 0, 0], group: G.load, tex: worn(o, 4, (face, s, t) => (face === "top" ? shade(boxC, 0.18) : (face === "left" || face === "right") && Math.round(s * 14) % 4 === 0 ? shade(boxC, -0.15) : face === "back" && (Math.abs(s - 0.5) < 0.02 || (t > 0.4 && t < 0.5 && Math.abs(s - 0.5) < 0.2)) ? shade(boxC, -0.35) : null)) })); // the box: its ribbed sides, the doors' line and latch behind
  push(boxL([(cab0 + cab1) / 2, 0, top - 2], [(cab0 + cab1) / 2, 0, 11.5], (cab1 - cab0) / 2, HW - 0.8, body, { u: [1, 0, 0], group: G.cab, tex: worn(o, 2, glassTex(o, [0.08, 0.5, 0.1, 0.9], (face, s, t) => (face === "front" && t > 0.72 && t < 0.78 && Math.abs(s - 0.5) < 0.25 ? shade(body, -0.4) : face === "front" && t > 0.84 && Math.abs(s - 0.5) > 0.3 && Math.abs(s - 0.5) < 0.42 ? (o.burnt ? SOOT : LAMP) : null), shade(body, 0.2))) })); // the cab: the grille, the lamps
  wheels(push, [x0 + 9, x0 + 18, x1 - 8], HW + 1.4, 6, 3.4);
}
// A bicycle (the team's, sim/vehicles.js bike: 2 × 1 cells), stood on its stand: two wheels, the frame's tubes, a saddle
// and the bars, a rack behind.
function bicycle(push, o) {
  const frameC = mixHex(o.color, "#8a8a8a", 0.25), dark = "#3a3a3a";
  for (const f of [-9, 9]) wheel(push, f, 0, 5.2, 1.2);
  const T = { sides: 4, group: G.body };
  push(limb([-9, 0, 5.2], [0, 0, 5.2], 0.7, 0.7, frameC, T)); push(limb([0, 0, 5.2], [-2.2, 0, 14], 0.7, 0.7, frameC, T)); // chainstay, seat tube
  push(limb([-2.2, 0, 14], [6.8, 0, 14.6], 0.7, 0.7, frameC, T)); push(limb([0, 0, 5.2], [6.8, 0, 14.6], 0.7, 0.7, frameC, T)); // top tube, down tube
  push(limb([6.8, 0, 14.6], [9, 0, 5.2], 0.7, 0.7, frameC, T)); push(boxL([7.4, -4, 16], [7.4, 4, 16], 0.6, 0.6, dark, { u: [0, 0, 1], group: G.trim })); // the fork, the bars
  push(boxL([-3.8, 0, 15.2], [-0.6, 0, 15.2], 0.6, 1.6, "#2a2a2a", { u: [0, 0, 1], group: G.trim })); // the saddle
  push(boxL([-10.5, 0, 11.5], [-4.5, 0, 11.5], 0.4, 2.2, METAL, { u: [0, 0, 1], group: G.rails })); push(limb([-9, 0, 5.2], [-8.5, 0, 11.2], 0.5, 0.5, METAL, T)); // the rack over the back wheel
  push(limb([0, 0, 5.2], [0, 0, 2.6], 0.6, 0.6, dark, T)); push(limb([0, -2.6, 5.2], [0, 2.6, 5.2], 0.9, 0.9, dark, { sides: 6, group: G.trim })); // the stand, the cranks
}
// The civic vehicles parked inside (sim/civiclayout.js, issue #15): a fire engine (2 × 5: a box truck's frame and cab in
// red, its box red, a ladder on the roof between its rails, hose reels on the flanks, a light bar on the cab), an
// ambulance (2 × 4: the box truck in white, a red stripe down the box, a light bar) and a police car (2 × 4: a sedan in
// black with white doors and a red and blue light bar on the roof). Burnt out, the paint and the trim are gone.
function truckFrame(L) {
  const x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, box1 = x1 - 19, cab0 = box1 + 1.5;
  return { x0, x1, HW: 10, top: VEH_TOP + 2, box0: x0 + 0.5, box1, cabX: (cab0 + x1 - 1) / 2 };
}
const lightBar = (push, x, z, half) => { push(boxL([x, -half, z], [x, 0, z], 0.7, 1.2, TAIL, { u: [0, 0, 1], group: G.trim })); push(boxL([x, 0, z], [x, half, z], 0.7, 1.2, "#3a5ad0", { u: [0, 0, 1], group: G.trim })); };
function fireengine(push, o, L) {
  boxtruck(push, { ...o, box: o.burnt ? null : o.color }, L);
  const { x0, x1, HW, top, box0, box1, cabX } = truckFrame(L);
  if (!o.burnt) {
    for (const y of [-4, 4]) push(boxL([box0 + 1, y, top + 0.8], [box1 - 1, y, top + 0.8], 0.5, 0.5, STEEL, { u: [0, 0, 1], group: G.rails })); // the ladder's rails
    for (let f = box0 + 3; f < box1 - 1; f += 4) push(boxL([f, -4, top + 0.8], [f, 4, top + 0.8], 0.3, 0.3, STEEL, { u: [0, 0, 1], group: G.rails })); // its rungs
    for (const sd of [-1, 1]) for (const f of [box0 + 6, box0 + 14]) push(limb([f, sd * (HW - 0.4), 12], [f, sd * (HW + 1.2), 12], 2.6, 2.6, METAL, { sides: 8, group: G.trim })); // the hose reels
    lightBar(push, cabX, top - 1, 6);
  }
  armour(push, o, x0, x1, HW, 6, 11.5, top, [cabX, top]);
}
function ambulance(push, o, L) {
  boxtruck(push, { ...o, box: o.burnt ? null : o.color }, L);
  const { x0, x1, HW, top, box0, box1, cabX } = truckFrame(L);
  if (!o.burnt) {
    for (const sd of [-1, 1]) push(boxL([box0 + 0.5, sd * (HW - 0.05), 15], [box1 - 0.5, sd * (HW - 0.05), 15], 1.1, 0.3, TAIL, { u: [0, 0, 1], group: G.trim })); // the stripe
    lightBar(push, cabX, top - 1, 5);
  }
  armour(push, o, x0, x1, HW, 6, 11.5, top, [cabX, top]);
}
function police(push, o, L) {
  sedan(push, o, L);
  const x0 = -L * TILE / 2 + 2, x1 = L * TILE / 2 - 2, HW = 9, xc = x0 + (x1 - x0) * 0.44;
  if (o.burnt) return;
  for (const sd of [-1, 1]) push(boxL([xc - 6, sd * (HW + 0.05), 9], [xc + 6, sd * (HW + 0.05), 9], 3, 0.25, WHITE, { u: [0, 0, 1], group: G.trim })); // the white doors
  lightBar(push, xc, 23.6, 5);
}
const MODELS = { pickup, sedan, suv, van, humvee, mrap, m35, boxtruck, bicycle, fireengine, ambulance, police };
export const MODEL_NAMES = Object.keys(MODELS);

// ---------- which model, in what colour ----------
// A cell's car (sim/combat.js placeCar: c.car { i, j, L, ax, kind, v, body, type, up, mil, wrecked }) → its model: the
// team's own vehicle ("vehicle") by its type (placeVehicle: VEHICLE_TYPES), else by its body: the Army trucks, the map's
// box trucks, and a parked car a sedan at 2 × 3, a van or a pickup at 2 × 4 by its dice (as the prisms drew them).
const CIVIC_MODEL = { engine: "fireengine", ambulance: "ambulance", police: "police" };
const CIVIC_PAINT = { fireengine: "#a8241c", ambulance: "#dcdad2", police: "#22252a" };
const BY_TYPE = { truck: "pickup", sedan: "sedan", suv: "suv", hummer: "humvee", van: "van", miltruck: "m35", bike: "bicycle" };
export function modelOf(car) {
  const b = car.body || car.kind;
  if (b === "bike") return "bicycle";
  if (b === "m35" || b === "humvee" || b === "mrap") return b;
  if (CIVIC_MODEL[b]) return CIVIC_MODEL[b]; // a fire station's engine and ambulance, a police car (sim/civiclayout.js)
  if (car.kind === "vehicle") return BY_TYPE[car.type] || (b === "truck" ? "pickup" : "sedan");
  if (b === "truck" || car.kind === "truck") return "boxtruck";
  return car.L === 3 ? "sedan" : (car.v || 0) % 2 ? "van" : "pickup";
}
// The look: the colour, the weather on it and its upgrades. The team's own in its blue (an Army truck olive, its canvas
// tinted; a Hummer olive mixed with blue); a blown-up vehicle (car.wrecked) or a burnt Army truck burnt out; the map's
// parked cars by their dice, rusting; the enemy's Humvee with its gun.
export function lookOf(car) {
  const model = modelOf(car), mil = car.mil || null, own = car.kind === "vehicle";
  const cond = car.wrecked ? "burnt" : mil ? mil.cond || "intact" : "intact";
  const u = car.up || null;
  const o = { model, cond, burnt: cond === "burnt", rust: !own && !mil && cond !== "burnt", seed: ((car.v || 0) % 97) + 1, plating: u ? u.p || 0 : 0, scrap: u ? u.s || 0 : 0, glass: u ? u.g || 0 : 0, mesh: u ? u.m || 0 : 0, turret: u && u.t ? u.t : null, manned: !!(u && u.manned), gun: !own && (model === "humvee" || model === "mrap") };
  if (cond === "burnt") o.color = BURNT;
  else if (model === "m35" || model === "humvee" || model === "mrap") { o.color = cond === "wrecked" ? MIL_WRECK : own && model === "humvee" ? mixHex(OLIVE_DARK, TEAM_BLUE, 0.5) : MIL_OLIVE; if (own && model === "m35") o.tint = TEAM_BLUE; }
  else if (own) o.color = TEAM_BLUE;
  else if (model === "boxtruck") o.color = BOX_RUST;
  else if (CIVIC_PAINT[model]) o.color = CIVIC_PAINT[model];
  else o.color = CAR_COLORS[(car.v || 0) % CAR_COLORS.length];
  if (!own && mil && mil.enemy) o.gun = true;
  return o;
}
// The limbs of a model (model space), for the whole car: L cells long. o as lookOf's (color, burnt, rust, seed, the
// upgrades; cond "intact" | "wrecked" | "burnt").
export function vehicleLimbs(model, o, L = 4) {
  const F = [], push = (q) => F.push(q);
  (MODELS[model] || sedan)(push, { color: "#6b6b6b", seed: 1, ...o }, L);
  return F;
}
// Snow on it (isoview.js snowPrims: the tops whitened in drifts by the snow lying, sn 0..1).
function snowed(F, sn) {
  const cover = 0.25 + sn;
  return F.map((q, i) => {
    const tex = q.tex, k = 71 + i * 3;
    return { ...q, tex: (face, s, t) => { const c = tex ? tex(face, s, t) : null; if (face !== "top") return c; const d = hash(Math.floor(s * 7) + k, Math.floor(t * 7), k) * 0.6 + hash(Math.floor(s * 23), Math.floor(t * 23) + k, 3) * 0.4; return d < cover ? (d < cover * 0.3 ? shade(SNOW, -0.1) : SNOW) : c; } };
  });
}

// ---------- the painting ----------
// The whole car painted once at a heading (yaw), every pixel tagged with the cell under its point: { px, zb, cb, g,
// w, h } with the grid g (ox, oy: the model origin). wide: cells across (2; a bicycle 1). straight: the straight view's
// projection (isoview.js iso.straight: u right SW px a cell, v down SH px a cell, z up 1:1, the +v and the top faces
// seen) instead of the 2:1 one; scale: the model shrunk (a car on one cell).
const GRID = { w: 240 * SS, h: 140 * SS, ox: 120 * SS, oy: 100 * SS }; // room for 2 × 5 cells at any heading in either view, the MRAP's turret on top (art px × SS)
const whole = new Map(), WHOLE_MAX = 24; // key -> the painting (a few cars a map; the cells' canvases are the view's)
function paintWhole(key, model, o, L, wide, ax, yaw, sn, straight = false, scale = 1) {
  const e = whole.get(key);
  if (e) { whole.delete(key); whole.set(key, e); return e; }
  let F = vehicleLimbs(model, o, L);
  if (sn) F = snowed(F, sn);
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), k = SS * scale;
  const W = (q) => [(q[0] * c - q[1] * s) * k, (q[0] * s + q[1] * c) * k, q[2] * k]; // turned by the heading, SS grid px an art px
  W.n = (q) => [q[0] * c - q[1] * s, q[0] * s + q[1] * c, q[2]]; // the normals turn, unscaled
  W.light = LIGHT;
  W.step = 0.45 / k; // the sampling step, in model units (art px): 0.45 grid px once scaled, about the figures' 0.4, no holes
  if (straight) { W.proj = (w) => [(w[0] * SW) / TILE, (w[1] * SH) / TILE - w[2], w[1] + 0.8 * w[2]]; W.view = [0, 1, 0.8]; }
  // The cell a model point stands over: i along the length, j across it (ax "x": +y is +j; "y": +y is −j: the car's
  // left is the map's −x there); what sticks out of the footprint (a wheel's tread, the gun) goes to the nearest cell.
  const sg = ax === "y" ? -1 : 1, i0 = L / 2, j0 = wide / 2;
  W.cell = (P) => Math.max(0, Math.min(L - 1, Math.floor(i0 + P[0] / TILE))) * wide + Math.max(0, Math.min(wide - 1, Math.floor(j0 + (sg * P[1]) / TILE)));
  const g = GRID, p = painter(g.w, g.h);
  const { zb, gb, cb } = paintLimbs(p, F, W, g, null);
  // The rim: where two parts meet, the one behind gets the dark edge; at one depth the part with the higher group does.
  // An art px wide (SS grid px): the first ring found, then the rings inside it within the same part.
  const px = p.px, rim = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    if (!px[i]) continue;
    const front = (j) => px[j] && gb[j] !== gb[i] && (zb[j] > zb[i] + 0.5 * SS || (Math.abs(zb[j] - zb[i]) <= 0.5 * SS && gb[j] < gb[i]));
    if ((x > 0 && front(i - 1)) || (x < g.w - 1 && front(i + 1)) || (y > 0 && front(i - g.w)) || (y < g.h - 1 && front(i + g.w))) rim[i] = 1;
  }
  for (let k = 2; k <= SS; k++) for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    if (!px[i] || rim[i]) continue;
    const near = (j) => rim[j] === k - 1 && gb[j] === gb[i];
    if ((x > 0 && near(i - 1)) || (x < g.w - 1 && near(i + 1)) || (y > 0 && near(i - g.w)) || (y < g.h - 1 && near(i + g.w))) rim[i] = k;
  }
  for (let i = 0; i < rim.length; i++) if (rim[i]) px[i] = OUTLINE;
  const out = { px, cb, g, W, straight };
  whole.set(key, out);
  while (whole.size > WHOLE_MAX) whole.delete(whole.keys().next().value);
  vehicleArtStats.painted++;
  return out;
}
export const vehicleArtStats = { painted: 0, cells: 0 }; // whole cars painted; cells cut from them (the tools)
const parsed = new Map(); // "#rrggbb" -> [r, g, b]
function rgbOf(c) {
  let v = parsed.get(c);
  if (!v) { const n = parseInt(c.slice(1, 7), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; if (parsed.size > 4096) parsed.clear(); parsed.set(c, v); }
  return v;
}
// Fog of war on a pixel (isoview.js fogPixels): darker, greyer, a little blue.
const fogged = ([r, g, b]) => { const l = r * 0.3 + g * 0.59 + b * 0.11; return [(r * 0.35 + l * 0.65) * 0.42 + 6, (g * 0.35 + l * 0.65) * 0.42 + 8, (b * 0.35 + l * 0.65) * 0.42 + 14]; };
let mkCanvas = (w, h) => { if (typeof document === "undefined") return null; const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function setVehicleCanvas(fn) { mkCanvas = fn; whole.clear(); }
onForgetPictures(() => whole.clear());

// One cell's share of a car's picture, as the view's sprites are ({ cv, ox, oy, w, h }: the canvas, UP px an art px,
// w × h art px, and its top-left from the cell's origin: its top vertex, in a straight view its top-left corner); null
// without a canvas (the tools). car: the cell's (sim/combat.js c.car); yaw: the car's heading in the view (degrees, the
// figures': the angle in the view's u, v); o: { fog, sn (snow lying 0..1), straight (the straight view) }.
export function vehicleCellSprite(car, yaw, o = {}) {
  const look = lookOf(car), L = car.L || 3, wide = car.body === "bike" ? 1 : 2;
  const y = (((Math.round(yaw / 15) * 15) % 360) + 360) % 360;
  const key = `${look.model}|${look.color}|${look.tint || ""}|${look.cond}|${look.rust ? look.seed : 0}|${look.plating}${look.scrap}${look.glass}${look.mesh}${look.turret || ""}${look.manned ? "*" : ""}${look.gun ? "g" : ""}|${L}|${wide}|${car.ax}|${y}|${o.sn || 0}|${o.straight ? "s" : ""}`;
  const w = paintWhole(key, look.model, look, L, wide, car.ax, y, o.sn || 0, !!o.straight);
  const i = car.i || 0, j = car.j || 0, sg = car.ax === "y" ? -1 : 1;
  return cutSprite(w, i * wide + j, [(i + 0.5 - L / 2) * TILE, sg * (j + 0.5 - wide / 2) * TILE, 0], o.fog);
}
// A car on one cell (the maps' decorative cars without a footprint of cells: isoview.js's "car", "truck" and
// "vehicle" cells with no c.car): the model shrunk onto the cell, along the view's u (ax "u") or v. kind: the cell's;
// v: its variant (the colour); o as vehicleCellSprite's.
export function vehicleOneSprite(kind, v, ax, o = {}) {
  const car = { kind, body: kind === "truck" ? "truck" : "car", L: kind === "truck" ? 4 : 3, ax: "x", v: v || 0 };
  const look = lookOf(car), scale = kind === "truck" ? 0.3 : 0.42, yaw = ax === "v" ? 90 : 0;
  const key = `one|${look.model}|${look.color}|${look.seed}|${yaw}|${o.sn || 0}|${o.straight ? "s" : ""}`;
  const w = paintWhole(key, look.model, look, car.L, 2, "x", yaw, o.sn || 0, !!o.straight, scale);
  return cutSprite(w, -1, [0, 0, 0], o.fog, scale);
}
// A share of a painting w: the pixels tagged k (every pixel for -1) and the whole's outline (an art px wide: SS grid
// px out from the car) where it touches them, on a canvas placed from the cell whose centre is the model point `centre`.
function cutSprite(w, k, centre, fog, scale = 1) {
  const { px, cb, g } = w;
  const mine = new Uint8Array(g.w * g.h);
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  const own = (q) => q >= 0 && q < mine.length && px[q] && (k < 0 || cb[q] === k);
  const mark = (xx, yy, v) => { mine[yy * g.w + xx] = v; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; };
  for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) {
    const q = yy * g.w + xx;
    if (own(q)) mark(xx, yy, 1);
    else if (!px[q] && ((xx > 0 && own(q - 1)) || (xx < g.w - 1 && own(q + 1)) || (yy > 0 && own(q - g.w)) || (yy < g.h - 1 && own(q + g.w)))) mark(xx, yy, 2);
  }
  for (let k2 = 3; k2 <= SS + 1; k2++) for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) { // the outline's further rings
    const q = yy * g.w + xx;
    if (px[q] || mine[q]) continue;
    const near = (j) => mine[j] === k2 - 1;
    if ((xx > 0 && near(q - 1)) || (xx < g.w - 1 && near(q + 1)) || (yy > 0 && near(q - g.w)) || (yy < g.h - 1 && near(q + g.w))) mark(xx, yy, k2);
  }
  if (x1 < 0) return null;
  // The picture: UP canvas px an art px, so each painted px is UP / SS canvas px (crisp at the view's zooms, as the figures).
  const K = UP / SS, cw = x1 - x0 + 1, ch = y1 - y0 + 1, cv = mkCanvas(cw * K, ch * K);
  if (!cv) return null;
  const c = cv.getContext("2d");
  const img = c && typeof c.createImageData === "function" ? c.createImageData(cw * K, ch * K) : null;
  const put = (x, yy, rgb, a) => {
    if (img && img.data) { for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) { const n = ((yy * K + dy) * cw * K + x * K + dx) * 4; img.data[n] = rgb[0]; img.data[n + 1] = rgb[1]; img.data[n + 2] = rgb[2]; img.data[n + 3] = a; } }
    else { c.fillStyle = `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${a / 255})`; c.fillRect(x * K, yy * K, K, K); }
  };
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const q = yy * g.w + xx, v = mine[q];
    if (!v) continue;
    if (v >= 2) { put(xx - x0, yy - y0, [11, 12, 14], 230); continue; }
    let rgb = rgbOf(px[q]);
    if (fog) rgb = fogged(rgb);
    put(xx - x0, yy - y0, rgb, 255);
  }
  if (img && img.data && typeof c.putImageData === "function") c.putImageData(img, 0, 0);
  // The cell's origin on the grid: its centre (the model point under it, through the heading and the projection) less
  // half a tile (its height to the top vertex; in a straight view half its width and height to the top-left corner);
  // the picture's corner from it, in art px (the view scales the canvas to w × h art px).
  const wc = w.W([centre[0] / scale, centre[1] / scale, 0]), pr = w.W.proj ? w.W.proj(wc) : [SX(wc), SY(wc)];
  const cx = g.ox + pr[0] - (w.straight ? (SW / 2) * SS : 0), cy = g.oy + pr[1] - (w.straight ? SH / 2 : HH) * SS;
  vehicleArtStats.cells++;
  return { cv, ox: (x0 - cx) / SS, oy: (y0 - cy) / SS, w: cw / SS, h: ch / SS };
}
// The whole car's painting, for a look at it (the tools, the dev page): { px, w, h, ox, oy } on the SS grid (ss: grid px an art px).
export function vehiclePainting(car, yaw = 330, straight = false) {
  const look = lookOf(car), L = car.L || 3, wide = car.body === "bike" ? 1 : 2;
  const y = (((Math.round(yaw / 15) * 15) % 360) + 360) % 360;
  const w = paintWhole(`look|${JSON.stringify(look)}|${L}|${wide}|${car.ax}|${y}|${straight ? "s" : ""}`, look.model, look, L, wide, car.ax, y, 0, straight);
  return { px: w.px, w: w.g.w, h: w.g.h, ox: w.g.ox, oy: w.g.oy, ss: SS };
}
