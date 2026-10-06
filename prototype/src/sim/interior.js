// The second map of a base battle: the YARD AND BUILDINGS (tiers 2 and 3), after the wall map (deploy.js, tier 1).
//
// A base battle (a horde breaking in, raiders or outsiders at the gates, a rescue) has three tiers:
//   1. the wall (deploy.js): the wall line with its hit points, the gate, the walkway and the towers;
//   2. the yard: barricades, sandbags, barbed wire, the base's own buildings, wells, tanks and stacks as cover;
//   3. the buildings: barred doors and windows to batter in, an upper floor in the bigger ones; the last stand.
// When BREACH_MIN attackers (or a BREACH_FRAC share of those left, if more) stand inside the wall at the start of your
// turn, or any do and nobody holds the wall line any more, the fight moves to this map; or the defenders fall back
// here themselves (the wall map's retreat: fallBack). Everyone keeps health, wounds, ammo (the base's stock), what
// they carry and where they were, more or less: a wall-map cell (x, y) becomes (x + SHIFT_X, y scaled from the wall
// map's rows to this map's) on this map, so the walkway and the gate are just inside this map's wall (2 columns in from
// its east edge) and the breaches are where they were. The map's size is the base's (battlesize.js SIZES.BASE: a hub
// Large to Extra-large, an outpost Medium to Large, by its buildings; 26 × 16 with no base), taller if its buildings
// still do not all fit (interiorSize); its columns are laid out from the east edge (yardGeom). The
// attackers inside the wall come with them; those still outside wait off the map and come in through the openings,
// WAVE + WAVE_PER_OPENING a turn. Then a short redeploy (the deploy step again, inside REDEPLOY tiles of where your
// people stood and at least REDEPLOY_GAP from an attacker; or the default posts at once, an option on the battle
// screen; headless always the defaults).
// A base without walls has no wall map: its battle opens here, the attackers coming over open ground from the side
// they came from.
//
// The map is generated from the base's real building list, deterministically per base (its own dice, seeded from the
// base and what is built there): the bigger buildings first (STRUCTURES), as many as fit west of the yard. Houses have
// barred doors (DOOR_HP) and windows (WINDOW_HP) the attackers batter in (the dead claw, people shoot the locks: combat.js
// siegeTarget and bash); the bigger ones have an upper floor (a loft, height 1, up the stairs) to shoot down from; flat-roofed
// blocks (a storehouse, a water tank) are climbed by a ladder. The yard gets the barricades (3 cells each, 2 more with
// a reinforced gate), the armory's sandbags (3 a bundle) and, without walls, the wire, bear traps, spike pits and the
// trench; wells, rain barrels, crates and a car from the garage add cover. A watchtower stands inside the wall (two
// towers, height 2).
// The yard is lost (the last stand, tier 3) once YARD_LOST × as many attackers as defenders still outside the
// buildings (at least 3) stand in it: the battle AI then takes everyone indoors (tierAI) and keeps them there. When
// nobody is left standing the base is overrun (defences.js, conflicts.js, conquest.js decide what that costs); the
// evac strip on the far side is the back gate: sounding the retreat here abandons the base.
//
// By the numbers (fights resolved without the map): baseTiers multiplies the defenders' strength by each tier's value
// (defences.js tierMults: walls, towers, the gate, the trench; barricades, sandbags, wire, spike pits; the buildings)
// and the fight is held at the first tier where they match the attackers.
import {
  CELL, active, unitAt, transformBattle, say, reachable, pathTo, distField, moveAlong, resizeBattle, floodReach,
  coverAgainst, isRanged, WEAPONS, placeCar, CAR_LEN,
} from "./combat.js";
import { count, countAll } from "./buildings.js";
import { Rng } from "./rng.js";
import { attackSide, fromTileOf, sideTf, sideUntf, setLit, DEPLOY, gateHp, wallHp } from "./deploy.js";
import { armoryDefence, tierMults, TIERS } from "./defences.js";
import { poweredType } from "./power.js";
import { isNight } from "./world.js";
import { dimsAt, baseScale, densify } from "./battlesize.js";
import { siegeWallCut } from "./siege.js";

// W × H: the smallest map (no base: a test, a base with nothing built); a base's own is its size class's (yardDims),
// H_GROW rows taller at a time (up to H_TRIES times) if its buildings do not all fit, and its wall map is as much longer
// (deploy.js, WALL_ROWS fewer than this map's). WALL_X, YARD_X, BUILD_X and SHIFT_X are for the 26-wide map: a wider one
// keeps them as far from its east edge (yardGeom). YARD_COVER: the share of the open yard with cover within 3 tiles
// that the yard is topped up to (crates, barrels, hay: battlesize.js densify).
export const INTERIOR = {
  W: 26, H: 16, H_GROW: 2, H_TRIES: 7, WALL_ROWS: 3, WALL_X: 24, YARD_X: 15, BUILD_X: [2, 19], EVAC: 2, SHIFT_X: 12, YARD_COVER: 0.72,
  DOOR_HP: 45, WIDE_DOOR_HP: 60, WINDOW_HP: 20,
  BREACH_MIN: 3, BREACH_FRAC: 0.25, WAVE: 3, WAVE_PER_OPENING: 2, YARD_LOST: 1.5,
  REDEPLOY: 12, REDEPLOY_GAP: 3,
};

// What a base's buildings become on this map, the most important first. storeys 2: an upper floor (loft) up the stairs;
// roof: a flat-roofed block climbed by a ladder (not entered); any: built if the base has any of these; per: one each
// (up to max); when: a rule of its own.
const HOSPITAL_NAME = { infirmary: "Infirmary", field_hosp: "Field hospital", clinic: "Clinic", hospital: "Trauma hospital" };
export const STRUCTURES = [
  { key: "hall", name: "Main house", w: 6, h: 5, storeys: 2, when: (base) => base.type === "hub" && base.tier !== 0 },
  // A shelter (buildings.js SHELTER, tier 0) has only its shack behind the barricade.
  { key: "shack", name: "Bunk shack", w: 5, h: 4, storeys: 1, when: (base) => (base.type !== "hub" || base.tier === 0) && !countAll(base, "bunkhouse") },
  { key: "bunkhouse", name: "Bunkhouse", w: 5, h: 4, storeys: 2, per: "bunkhouse", max: 2 },
  { key: "hospital", name: "Infirmary", w: 5, h: 4, storeys: 1, any: Object.keys(HOSPITAL_NAME) },
  { key: "workshop", name: "Workshop", w: 6, h: 4, storeys: 1, any: ["ammo_bench", "med_station", "machine_shop", "kitchen", "still", "generator"] },
  { key: "storehouse", name: "Storehouse", w: 4, h: 3, roof: true, any: ["storehouse"] },
  { key: "common", name: "Common room", w: 5, h: 4, storeys: 1, any: ["common_room", "chapel"] },
  { key: "cells", name: "Holding cells", w: 4, h: 4, storeys: 1, any: ["cells"] },
  { key: "radio", name: "Radio shack", w: 4, h: 3, storeys: 1, any: ["radio"] },
  { key: "garage", name: "Garage", w: 5, h: 4, storeys: 1, any: ["garage"], wide: true },
  { key: "tank", name: "Water tank", w: 2, h: 2, roof: true, any: ["cistern"] },
  { key: "shed", name: "Shed", w: 3, h: 3, storeys: 1, any: ["cellar", "coldstore", "huntcabin", "greenhouse", "smoker"] },
];
const SHED_NAME = { cellar: "Root cellar", coldstore: "Cold store", huntcabin: "Hunting cabin", greenhouse: "Greenhouse", smoker: "Smoke shed" };

// The structures a base has, in order, with their names. Used for the map and for the numbers (defences.js).
export function structuresOf(base) {
  if (!base) return [];
  const out = [];
  for (const s of STRUCTURES) {
    let n = 0;
    if (s.when) n = s.when(base) ? 1 : 0;
    else if (s.per) n = Math.min(s.max || 9, countAll(base, s.per));
    else if (s.any) n = s.any.some((k) => countAll(base, k)) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      let name = s.name;
      if (s.key === "hospital") name = HOSPITAL_NAME[s.any.find((k) => countAll(base, k))] || name;
      if (s.key === "shed") name = SHED_NAME[s.any.find((k) => countAll(base, k))] || name;
      if (s.key === "common" && !countAll(base, "common_room")) name = "Chapel";
      out.push({ ...s, name: n > 1 ? `${name} ${i + 1}` : name });
    }
  }
  return out;
}
// Buildings that can be held (entered), for the numbers: houses, not roofs.
export const defensibleCount = (base) => structuresOf(base).filter((s) => !s.roof).length;

const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// The base's own dice for its map: the same base with the same buildings always looks the same.
export function layoutSeed(base) {
  if (!base) return 7;
  return hashStr(`${base.tile}|${base.type}|${base.buildings.map((x) => x.type).sort().join(",")}`);
}

// ---------- the map (east-facing: the attackers on the east edge) ----------
// The columns of a W-wide yard map: the wall 2 in from the east edge, the yard 11 in, and a wall-map cell's column moved
// by SHIFT_X (the wall map's wall onto this one's). The buildings stand as close to the yard as on the 26-wide map
// (BUILD_X: the 17 columns west of it), the compound's grounds, fields and the back gate behind them; only a base whose
// buildings do not fit there spreads them west to column 2 (wide).
export function yardGeom(W, wide = false) {
  const d = W - INTERIOR.W;
  return { W, WALL_X: INTERIOR.WALL_X + d, YARD_X: INTERIOR.YARD_X + d, BUILD_X: [wide ? INTERIOR.BUILD_X[0] : INTERIOR.BUILD_X[0] + d, INTERIOR.BUILD_X[1] + d], SHIFT_X: INTERIOR.SHIFT_X + d, wide };
}
// A base's yard map before it grows for its buildings: its size class's (battlesize.js baseScale), never under 26 × 16.
export function yardDims(base) {
  if (!base) return [INTERIOR.W, INTERIOR.H];
  const [w, h] = dimsAt(baseScale(base, structuresOf(base).length));
  return [Math.max(INTERIOR.W, w), Math.max(INTERIOR.H, h)];
}
// The map's size for a base: its class's, as many H_GROW rows taller as it takes to hold all its buildings (the same
// base and buildings, the same size). { W, H }.
const sizeCache = new Map();
export function interiorSize(base) {
  const key = base ? `${layoutSeed(base)}|${structuresOf(base).length}` : "none";
  let s = sizeCache.get(key);
  if (!s) {
    const lay = buildInterior(base, { walled: true });
    s = { W: lay.W, H: lay.H };
    if (sizeCache.size > 200) sizeCache.clear();
    sizeCache.set(key, s);
  }
  return s;
}
// The rows of a base's wall map (deploy.js): as tall as its yard map, less WALL_ROWS (13 for the usual 16).
export const wallMapRows = (base) => interiorSize(base).H - INTERIOR.WALL_ROWS;

// opts: walled, rows (the wall map's wall line, east-facing, top to bottom: { k, hp, mhp, bar }), c (the setup's
// context: pits, kit, through), night. Returns the cells and what is where, with the map's size (W, H: the class's
// width, and the shortest height from its class's up that holds every building) and its columns (G: yardGeom).
export function buildInterior(base, opts = {}) {
  const [W0, H0] = yardDims(base);
  let out = layInterior(base, opts, W0, H0, false, false); // the buildings by the yard
  for (let i = 0; i < INTERIOR.H_TRIES && out.missed; i++) out = layInterior(base, opts, W0, H0 + i * INTERIOR.H_GROW, i > 0, W0 > INTERIOR.W);
  return out;
}

function layInterior(base, opts, W, H, tight = false, wide = false) {
  const G = yardGeom(W, wide), I = { ...INTERIOR, ...G };
  const rng = new Rng(layoutSeed(base));
  const cells = Array.from({ length: W * H }, (_, i) => ({ k: "open", f: i % W >= I.WALL_X ? "grass" : "dirt" }));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x, y) => (inside(x, y) ? cells[y * W + x] : null);
  const put = (x, y, k, f) => { const c = at(x, y); if (!c) return null; c.k = k; if (f) c.f = f; return c; };
  const used = new Uint8Array(W * H); // building footprints and their 1-cell margins
  const indoor = new Uint8Array(W * H);
  const free = (x, y) => { const c = at(x, y); return !!c && c.k === "open" && !used[y * W + x]; };
  const walled = !!opts.walled;
  const out = { W, H, G, missed: 0, cells, indoor, buildings: [], towers: [], openings: [], lofts: [], roofs: [], doors: [], windows: [], walled };
  // The wall line (column 24) as it stood on the wall map, rows scaled from its height (13 for 16) to this map's.
  if (walled) {
    const r0 = H - I.WALL_ROWS, gm = Math.floor(r0 / 2);
    const rows = opts.rows || [...Array(r0).keys()].map((y) => ({ k: y === gm - 1 || y === gm ? "gate" : "palisade", bar: true }));
    const h0 = rows.length;
    for (let y = 0; y < H; y++) {
      const r = rows[Math.round((y * (h0 - 1)) / (H - 1))] || { k: "palisade" };
      const c = put(I.WALL_X, y, r.k === "palisade" ? "palisade" : r.k === "gate" ? "gate" : "breach");
      if (c.k === "palisade") { c.t = 1; c.hp = r.hp ?? wallHp(base); c.mhp = r.mhp ?? wallHp(base); }
      if (c.k === "gate") { c.bar = r.bar !== false && r.hp > 0; c.hp = r.hp ?? gateHp(base); c.mhp = r.mhp ?? gateHp(base); }
      if (c.k !== "palisade" && !(c.k === "gate" && c.bar)) out.openings.push([I.WALL_X, y]);
      if (c.k === "gate") out.openings.push([I.WALL_X, y]);
      used[y * W + I.WALL_X] = 1;
    }
    out.openings = [...new Map(out.openings.map((p) => [`${p[0]},${p[1]}`, p])).values()];
  }
  for (let y = 0; y < H; y++) for (let x = I.WALL_X - 1; x < W; x++) used[y * W + x] = 1; // the wall's foot and outside: kept clear
  // A watchtower: two towers inside the wall.
  const towerX = walled ? I.WALL_X - 1 : I.WALL_X - 4;
  // Its two towers either side of the gate (rows 1 and 14 of the 16-row map; on a taller one as near the gate).
  if (base && count(base, "watchtower")) for (const y of [Math.max(1, Math.round(H / 2) - 7), Math.min(H - 2, Math.round(H / 2) + 6)]) { const c = put(towerX, y, "tower"); c.h = 2; out.towers.push([towerX, y]); used[y * W + towerX] = 1; }
  // ---------- the buildings ----------
  const fits = (x0, y0, w, h) => {
    if (x0 < I.BUILD_X[0] || y0 < 0 || x0 + w > I.BUILD_X[1] || y0 + h > H) return false;
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (inside(x, y) && used[y * W + x]) return false;
    return true;
  };
  const claim = (x0, y0, w, h) => { for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (inside(x, y)) used[y * W + x] = 1; };
  for (const s of structuresOf(base)) {
    let spot = null;
    for (const [w, h] of [[s.w, s.h], [s.w - 1, s.h], [s.w, s.h - 1], [s.w - 1, s.h - 1]]) {
      if (w < 2 || h < 2) continue;
      const tries = [];
      for (let y0 = 0; y0 + h <= H; y0++) for (let x0 = I.BUILD_X[0]; x0 + w <= I.BUILD_X[1]; x0++) if (fits(x0, y0, w, h)) tries.push([x0, y0]);
      if (!tries.length) continue;
      // The main house sits in the middle of the west side; the rest where the base's dice put them.
      const pick = s.key === "hall" ? tries.reduce((a, p) => (Math.abs(p[1] + h / 2 - H / 2) + Math.abs(p[0] - I.BUILD_X[0] - 2) * 0.5 < Math.abs(a[1] + h / 2 - H / 2) + Math.abs(a[0] - I.BUILD_X[0] - 2) * 0.5 ? p : a), tries[0]) : tight ? tries[rng.int(0, Math.min(2, tries.length - 1))] : H > INTERIOR.H ? nearMiddle(tries, w, h, H, rng) : rng.pick(tries); // a taller map (the buildings did not fit): packed more tightly; a big base's: the compound round the gate's rows
      spot = [pick[0], pick[1], w, h];
      break;
    }
    if (!spot) { out.missed++; continue; }
    const [x0, y0, w, h] = spot;
    claim(x0, y0, w, h);
    if (s.roof) roofBlock(x0, y0, w, h, s);
    else house(x0, y0, w, h, s);
  }
  function roofBlock(x0, y0, w, h, s) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = put(x, y, "roof", "roof"); c.h = 1; out.roofs.push([x, y]); }
    // A ladder up on the yard side (else any side with room).
    const cand = [[x0 + w, y0 + Math.floor(h / 2)], [x0 - 1, y0 + Math.floor(h / 2)], [x0 + Math.floor(w / 2), y0 - 1], [x0 + Math.floor(w / 2), y0 + h]];
    const lad = cand.find(([x, y]) => inside(x, y) && at(x, y).k === "open" && x < I.WALL_X - 1);
    if (lad) put(lad[0], lad[1], "ladder");
    out.buildings.push({ name: s.name, key: s.key, x0, y0, w, h, roof: true, doors: [], ladder: lad || null });
  }
  function house(x0, y0, w, h, s) {
    const two = s.storeys === 2 && w >= 5 && h >= 4;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      const c = put(x, y, border ? "wall" : "open", "floor");
      if (border && two) c.t = 2; // two storeys: the walls hide the upper floor from the ground
      if (!border) indoor[y * W + x] = 1;
    }
    const mid = y0 + Math.floor(h / 2);
    const doors = [];
    const door = (x, y, hp) => { const c = put(x, y, "bdoor", "floor"); c.hp = c.mhp = hp; delete c.t; indoor[y * W + x] = 1; doors.push([x, y]); out.doors.push([x, y]); };
    const win = (x, y) => { const c = at(x, y); if (!c || c.k !== "wall") return; const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1); if (corner) return; put(x, y, "window", "floor"); c.hp = c.mhp = INTERIOR.WINDOW_HP; delete c.t; out.windows.push([x, y]); };
    // The upper floor: the back (west) half, up the stairs at its east end.
    const loftX = two ? x0 + Math.floor((w - 2) / 2) : -1;
    if (two) {
      for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x <= loftX; x++) { const c = put(x, y, "loft", "floor"); c.h = 1; out.lofts.push([x, y]); }
      put(loftX + 1, y0 + h - 2, "stairs", "floor");
    }
    // Doors: one facing the yard (east; two cells for a garage), one more at the back (west) on bigger houses, else
    // on the north or south side (a house with an upper floor: the north side by the yard end, onto the ground floor).
    door(x0 + w - 1, mid, s.wide ? INTERIOR.WIDE_DOOR_HP : INTERIOR.DOOR_HP);
    if (s.wide && h >= 4) door(x0 + w - 1, mid - 1, INTERIOR.WIDE_DOOR_HP);
    const northOk = y0 > 0, southOk = y0 + h < H;
    if (two) door(x0 + w - 2, northOk ? y0 : y0 + h - 1, INTERIOR.DOOR_HP);
    else if (w * h >= 20) door(x0, mid, INTERIOR.DOOR_HP);
    else door(x0 + Math.floor(w / 2), (rng.chance(0.5) && northOk) || !southOk ? y0 : y0 + h - 1, INTERIOR.DOOR_HP);
    // Windows: two on the yard side, one on each other side.
    for (const y of [y0 + 1, y0 + h - 2]) win(x0 + w - 1, y);
    win(x0 + Math.floor(w / 2) - (w > 4 ? 1 : 0), y0);
    win(x0 + Math.floor(w / 2) + (w > 4 ? 1 : 0), y0 + h - 1);
    if (h >= 4) win(x0, y0 + 1);
    if (two) {
      // nothing else: the upper floor is the cover
    } else if (w >= 4 && h >= 3) {
      // A table or a counter inside: half cover.
      const spots = [];
      for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) {
        if (at(x, y).k !== "open") continue;
        if (doors.some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 1)) continue;
        spots.push([x, y]);
      }
      if (spots.length >= 3) { const [x, y] = rng.pick(spots); put(x, y, rng.chance(0.5) ? "counter" : "cabinet", "floor"); }
    }
    out.buildings.push({ name: s.name, key: s.key, x0, y0, w, h, storeys: two ? 2 : 1, doors: doors.filter(([x, y]) => at(x, y).k === "bdoor") });
  }
  // ---------- the yard ----------
  const yardFree = (x, y) => free(x, y) && x >= I.YARD_X && x < I.WALL_X - 1;
  const scatter = (n, k, x0, x1, test = yardFree) => {
    let placed = 0;
    for (let i = 0; i < n; i++) for (let t = 0; t < 12; t++) {
      const x = rng.int(x0, x1), y = rng.int(0, H - 1);
      if (test(x, y)) { put(x, y, k); placed++; break; }
    }
    return placed;
  };
  const c = opts.c || {};
  const kit = c.kit || armoryDefence(base);
  if (base) {
    // Barricades: a line across the yard (3 cells each, 2 more with a reinforced gate).
    scatter(count(base, "barricades") * 3 + (count(base, "gate") ? 2 : 0), "barricade", I.WALL_X - 7, I.WALL_X - 3);
    // Sandbags from the armory: in front of the doors first, then across the yard.
    let bags = (kit.bags || 0) * 3;
    for (const [dx, dy] of out.doors) {
      if (bags <= 0) break;
      for (const [ox, oy] of [[2, 0], [2, 1], [2, -1]]) if (bags > 0 && free(dx + ox, dy + oy) && !used[(dy + oy) * W + dx + ox - 1]) { put(dx + ox, dy + oy, "sandbag"); bags--; break; }
    }
    scatter(bags, "sandbag", I.WALL_X - 8, I.WALL_X - 3);
    // Without walls the dead come straight over the yard: the wire, the bear traps, the pits and the trench are here.
    if (!walled) {
      scatter((kit.wire || 0) * 4, "wire", I.WALL_X - 5, I.WALL_X - 3);
      scatter(kit.traps || 0, "beartrap", I.WALL_X - 6, I.WALL_X - 2, (x, y) => free(x, y) && x >= I.WALL_X - 6);
      scatter((c.pits || 0) * 5, "spikes", I.WALL_X - 6, I.WALL_X - 2, (x, y) => free(x, y) && x >= I.WALL_X - 6);
      if (count(base, "trench")) for (let y = 0; y < H; y++) if (free(I.WALL_X - 3, y) && y % 4 !== 2) put(I.WALL_X - 3, y, "trench");
    }
    // The base's own clutter as cover: wells, rain barrels, crates, a car from the garage; fields for the farm plots.
    scatter(countAll(base, "well"), "well", I.YARD_X - 2, I.WALL_X - 3, (x, y) => free(x, y) && x >= 4);
    scatter(Math.min(4, countAll(base, "rain_catcher")), "barrel", 3, I.WALL_X - 3, (x, y) => free(x, y));
    // The garage's car in the yard: 2 × 3–4 cells (combat.js placeCar), where it fits.
    if (countAll(base, "garage")) for (let t = 0; t < 16; t++) if (placeCar(cells, W, H, rng.int(I.YARD_X, I.WALL_X - 6), rng.int(0, H - 1), rng.chance(0.5) ? "x" : "y", rng.pick(CAR_LEN.car), "car", yardFree, rng.int(0, 1e6), { ring: false })) break;
    const plots = Math.min(3, Math.ceil((count(base, "farm_plot") * 2 + (base.tier === 0 ? 2 : base.type === "hub" ? 6 : 2)) / 4));
    for (let i = 0; i < plots; i++) {
      for (let t = 0; t < 20; t++) {
        const x0 = rng.int(I.BUILD_X[0], I.WALL_X - 5), y0 = rng.int(0, H - 2);
        let ok = true;
        for (let y = y0; y < y0 + 2 && ok; y++) for (let x = x0; x < x0 + 3 && ok; x++) ok = free(x, y);
        if (!ok) continue;
        for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 3; x++) at(x, y).f = "field";
        break;
      }
    }
  }
  scatter(walled ? 3 : 4, "crate", I.YARD_X - 2, I.WALL_X - 2);
  if (W > INTERIOR.W || H > INTERIOR.H) groundsBeyond(cells, W, H, I, out, used, rng);
  // A big yard is not an empty one: crates, barrels and hay over the open ground (battlesize.js), never in a building's
  // margin or by the wall.
  densify(cells, W, H, rng, { target: I.YARD_COVER, keep: (x, y) => !!used[y * W + x], props: (f) => YARD_PROPS[f] || null });
  // Every door, ladder and the far edge reachable from the back gate: clear whatever clutter is in the way.
  connect(cells, W, H, out);
  out.doors = out.doors.filter(([x, y]) => at(x, y).k === "bdoor");
  out.windows = out.windows.filter(([x, y]) => at(x, y).k === "window");
  return out;
}

// On a big base's yard map (a Large or Extra-large hub: sim/battlesize.js) the buildings cluster round the middle rows,
// where the gate and the breaches are, as on the old 16-row map; the grounds, fields and clutter lie beyond them. One
// of the YARD_NEAR spots nearest the middle row.
const YARD_NEAR = 4;
function nearMiddle(tries, w, h, H, rng) {
  const d = (p) => Math.abs(p[1] + h / 2 - H / 2);
  const best = tries.slice().sort((a, c) => d(a) - d(c) || c[0] - a[0]).slice(0, YARD_NEAR);
  return best[rng.int(0, best.length - 1)];
}
// A big base's grounds beyond its compound (west of the buildings and the far rows, inside the wall): grass with the
// base's fields (one 3–5 × 2–3 plot a GROUND_PLOT tiles of grounds) and, from densify, trees and rocks.
const GROUND_PLOT = 90;
function groundsBeyond(cells, W, H, I, out, used, rng) {
  const bs = out.buildings;
  if (!bs.length) return;
  const x0 = Math.min(...bs.map((s) => s.x0)) - 2, y0 = Math.min(...bs.map((s) => s.y0)) - 2, y1 = Math.max(...bs.map((s) => s.y0 + s.h)) + 1;
  const beyond = (x, y) => x < I.WALL_X - 1 && (x < x0 || ((y < y0 || y > y1) && x < I.YARD_X - 2));
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = cells[y * W + x]; if (beyond(x, y) && c.k === "open" && c.f === "dirt" && !used[y * W + x]) { c.f = "grass"; n++; } }
  for (let i = 0; i < Math.round(n / GROUND_PLOT); i++) {
    const w = rng.int(3, 5), h = rng.int(2, 3);
    for (let t = 0; t < 20; t++) {
      const px = rng.int(1, W - w - 1), py = rng.int(1, H - h - 1);
      let ok = true;
      for (let y = py - 1; y <= py + h && ok; y++) for (let x = px - 1; x <= px + w && ok; x++) ok = beyond(x, y) && cells[y * W + x].k === "open" && cells[y * W + x].f === "grass" && !used[y * W + x];
      if (!ok) continue;
      for (let y = py; y < py + h; y++) for (let x = px; x < px + w; x++) cells[y * W + x].f = "field";
      break;
    }
  }
  // A woodlot of the grounds: trees, rocks, hay and fencing as cover all over (not the empty field of a parade ground).
  densify(cells, W, H, rng, { target: GROUND_COVER, keep: (x, y) => !beyond(x, y) || !!used[y * W + x], props: (f) => GROUND_PROPS[f] || null });
}
const GROUND_COVER = 0.95;
const GROUND_PROPS = { grass: ["tree", "tree", "rock", "fence", "hay"], field: ["hay", "fence"] };
const YARD_PROPS = { dirt: ["crate", "barrel", "crate", "hay"], field: ["hay"], grass: ["rock", "tree"] };

// Clutter (not buildings) on the way from the back gate to every door, ladder and the wall is cleared.
function connect(cells, W, H, out) {
  const start = [0, Math.floor(H / 2)];
  const targets = [...out.doors.map(([x, y]) => outsideOf(cells, W, H, x, y)), ...out.buildings.filter((b) => b.ladder).map((b) => b.ladder), [W - 3, Math.floor(H / 2)], [W - 1, 0], [W - 1, H - 1]].filter(Boolean);
  const hard = (c) => ["wall", "window", "bdoor", "roof", "palisade", "tower", "loft", "stairs"].includes(c.k);
  for (const [tx, ty] of targets) {
    const d = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1);
    const s = start[1] * W + start[0];
    d[s] = 0;
    const open = [s];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (d[open[i]] < d[open[bi]]) bi = i;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      const x = cur % W, y = (cur / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const c = cells[ny * W + nx];
        if (hard(c) && !(nx === tx && ny === ty && c.k === "ladder")) continue;
        const nd = d[cur] + (CELL[c.k].walk ? 1 : 6);
        if (nd < d[ny * W + nx]) { if (d[ny * W + nx] === Infinity) open.push(ny * W + nx); d[ny * W + nx] = nd; prev[ny * W + nx] = cur; }
      }
    }
    let i = ty * W + tx;
    if (!isFinite(d[i])) continue;
    while (i >= 0) { const c = cells[i]; if (!CELL[c.k].walk && !hard(c)) c.k = "open"; i = prev[i]; }
  }
}
// The cell outside a door (the side away from the building's inside).
function outsideOf(cells, W, H, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy, ox = x - dx, oy = y - dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || ox < 0 || oy < 0 || ox >= W || oy >= H) continue;
    const inC = cells[oy * W + ox];
    if (["open", "loft", "stairs", "counter", "cabinet"].includes(inC.k) && inC.f === "floor" && cells[ny * W + nx].f !== "floor") return [nx, ny];
  }
  return null;
}

// ---------- a base without walls: the battle opens here (layout phases, defences.js "baseDefence") ----------
export function interiorMap(b, ctx, base, c) {
  const lay = buildInterior(base, { walled: false, c });
  resizeBattle(b, lay.W, lay.H, lay.cells, 0, Math.floor(lay.H / 2));
  b.deployPlan = { walled: false, interior: true, gate: [], breaches: [], towers: lay.towers, lay };
}

export function interiorUnits(b, ctx, base, c) {
  const state = ctx.state;
  const lay = b.deployPlan.lay;
  const I = { ...INTERIOR, ...lay.G };
  const W0 = lay.W, H0 = lay.H;
  const okCell = (x, y) => x >= 0 && y >= 0 && x < W0 && y < H0 && b.reach[y * W0 + x] && CELL[b.cells[y * W0 + x].k].walk && !unitAt(b, x, y);
  const floodlit = c.floodlit ?? (!!base && count(base, "floodlights") > 0 && (poweredType(base, "floodlights") || (base.stock.fuel || 0) >= 2));
  const night = c.night ?? isNight(state);
  b.floodAim = floodlit ? (night ? DEPLOY.FLOOD_NIGHT : DEPLOY.FLOOD_DAY) : 0;
  // The attackers come over open ground from the east edge, groups together, the bosses with them.
  const enemies = b.units.filter((u) => u.side === "enemy");
  for (const u of enemies) u.x = -100;
  const anchors = new Map();
  for (const u of enemies) {
    const cells = [];
    for (let y = 0; y < H0; y++) for (let x = W0 - 3; x < W0; x++) if (okCell(x, y) && Math.abs(y - H0 / 2) <= 8) cells.push([x, y]); // the front: the middle 16 rows, however long the base
    if (!cells.length) continue;
    let c0;
    if (u.pod != null) {
      if (!anchors.has(u.pod)) anchors.set(u.pod, ctx.rng.pick(cells));
      const a = anchors.get(u.pod);
      c0 = cells.reduce((m, p) => (Math.hypot(p[0] - a[0], p[1] - a[1]) < Math.hypot(m[0] - a[0], m[1] - a[1]) ? p : m), cells[0]);
    } else c0 = ctx.rng.pick(cells);
    u.x = c0[0]; u.y = c0[1];
  }
  b.units = b.units.filter((u) => u.x >= 0);
  const zoneE = (x, y) => x <= I.WALL_X - 3;
  for (const u of b.units) if (u.side === "player") u.x = -100;
  interiorDefaults(b, lay, okCell, zoneE);
  for (const u of b.units) if (u.side === "player" && u.x < 0) { const p = nearestFree(b, W0, H0, 2, Math.floor(H0 / 2), okCell); if (p) { u.x = p[0]; u.y = p[1]; } }
  const side = attackSide(state, base ? base.tile : null, fromTileOf(state, c));
  finishInterior(b, side, lay, { walled: false, zoneE, floodlit, night, base, deploy: !!b.setup.deploy });
  if (b.setup.deploy) {
    b.phase = "deploy";
    say(b, `No walls here: the attack comes from the ${side} straight over the yard. Place your defenders: in the buildings, at the windows, on the roofs or behind the barricades.`, "info");
  }
}

// After the map is laid out and the units placed (east-facing): turn it, and set the masks, the way out, the deploy
// step and the tier record.
function finishInterior(b, side, lay, o) {
  const I = { ...INTERIOR, ...lay.G }, W0 = lay.W, H0 = lay.H;
  const zoneArr = new Uint8Array(W0 * H0);
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) zoneArr[y * W0 + x] = o.zoneE(x, y) ? 1 : 0; // before the units are turned
  transformBattle(b, side);
  const tf = sideTf(side, W0, H0);
  const mask = (test) => { const m = new Uint8Array(b.w * b.h); for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (test(x, y)) { const [nx, ny] = tf(x, y); m[ny * b.w + nx] = 1; } return m; };
  const turn = (list) => list.map(([x, y]) => tf(x, y));
  const [ex, ey] = tf(0, Math.floor(H0 / 2));
  floodReach(b, ex, ey);
  if (b.evacCols) {
    b.evacMask = mask((x) => x < b.evacCols);
    b.evacSide = { east: "west", west: "east", north: "south", south: "north" }[side] || "west";
  }
  const indoor = mask((x, y) => !!lay.indoor[y * W0 + x]);
  const interior = mask((x) => x < I.WALL_X);
  const zone = mask((x, y) => !!zoneArr[y * W0 + x]);
  const entry = turn(o.walled ? [...Array(H0).keys()].map((y) => [W0 - 1, y]) : []);
  b.tier = {
    ...(b.tier || {}), map: "interior", stage: "yard", side, w0: W0, h0: H0, walled: o.walled, indoor, interior, entry,
    buildings: lay.buildings.map((s) => ({ name: s.name, key: s.key, roof: !!s.roof, storeys: s.storeys || 0, cells: rectCells(s).map(([x, y]) => tf(x, y)), doors: turn(s.doors || []) })),
    openings: turn(lay.openings), baseId: o.base ? o.base.id : (b.tier ? b.tier.baseId : null),
  };
  b.deploy = {
    side, walled: o.walled, interior: true, zone, gate: [], breaches: turn(lay.openings), towers: turn(lay.towers), walkway: [], ladders: [],
    floodlit: !!o.floodlit, night: !!o.night, lit: "center", frame: { w0: W0, h0: H0, fromX: I.YARD_X },
    defaults: b.units.filter((u) => u.side === "player" && active(u)).map((u) => [u.id, u.x, u.y, u.post || null]),
  };
  if (o.floodlit) setLit(b, "center");
  else b.lit = null;
}
const rectCells = (s) => { const out = []; for (let y = s.y0; y < s.y0 + s.h; y++) for (let x = s.x0; x < s.x0 + s.w; x++) out.push([x, y]); return out; };

// The nearest free cell to (x, y) that passes ok (rings outward).
function nearestFree(b, W0, H0, x, y, ok) {
  for (let r = 0; r < Math.max(W0, H0); r++) {
    let best = null;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (!ok(nx, ny)) continue;
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = { x: nx, y: ny, d };
    }
    if (best) return [best.x, best.y];
  }
  return null;
}

// ---------- default posts on this map (east-facing) ----------
// The best shots on the towers, then the upper floors and the roofs (where they can see the yard), then indoors at
// the windows; close fighters inside by the doors; anyone left behind the barricades and sandbags in the yard.
export function interiorDefaults(b, lay, okCell, zoneE) {
  const W0 = lay.W || INTERIOR.W, H0 = lay.H || INTERIOR.H, G = lay.G || yardGeom(W0);
  const defs = b.units.filter((u) => u.side === "player" && active(u));
  for (const u of defs) { u.post = null; u.x = -100; }
  const close = (u) => !!WEAPONS[u.weapon].melee || u.weapon === "shotgun" || u.weapon === "pipegun";
  const shooters = defs.filter((u) => isRanged(u) && !close(u)).sort((a, c) => c.aim - a.aim);
  const fighters = defs.filter((u) => !shooters.includes(u)).sort((a, c) => c.hp / c.armor - a.hp / a.armor);
  const ok = (x, y) => okCell(x, y) && zoneE(x, y);
  const takeSpot = (u, list, post) => {
    const spot = list.find(([x, y]) => ok(x, y));
    if (!spot) return false;
    u.x = spot[0]; u.y = spot[1]; u.post = post;
    return true;
  };
  const adj4 = (x, y, test) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => test(x + dx, y + dy));
  const isK = (k) => (x, y) => x >= 0 && y >= 0 && x < W0 && y < H0 && b.cells[y * W0 + x].k === k;
  // Perches: towers, then loft cells by a window, then the yard edge of the roofs, east first.
  const east = (a, c) => c[0] - a[0];
  const perches = [
    ...lay.towers,
    ...lay.lofts.filter(([x, y]) => adj4(x, y, isK("window"))).sort(east),
    ...lay.roofs.slice().sort(east),
  ];
  const windows = [];
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (lay.indoor[y * W0 + x] && b.cells[y * W0 + x].k === "open" && adj4(x, y, isK("window"))) windows.push([x, y]);
  windows.sort(east);
  const byDoors = [];
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (lay.indoor[y * W0 + x] && b.cells[y * W0 + x].k === "open" && adj4(x, y, isK("bdoor"))) byDoors.push([x, y]);
  byDoors.sort(east);
  const left = [];
  for (const u of shooters) {
    if (takeSpot(u, perches, "perch")) { removeSpot(perches, u); continue; }
    if (takeSpot(u, windows, "inside")) { removeSpot(windows, u); continue; }
    left.push(u);
  }
  for (const u of fighters) {
    if (takeSpot(u, byDoors, "door")) { removeSpot(byDoors, u); continue; }
    left.push(u);
  }
  // The rest: the yard, behind cover facing the attack, not right next to an opening.
  for (const u of left) {
    let best = null;
    for (let y = 0; y < H0; y++) for (let x = G.YARD_X - 2; x <= G.WALL_X - 3; x++) {
      if (!ok(x, y) || lay.indoor[y * W0 + x]) continue;
      const dOpen = Math.min(99, ...lay.openings.map(([ox, oy]) => Math.hypot(x - ox, y - oy)));
      if (dOpen < 3) continue;
      const sc = coverAgainst(b, x, y, W0 - 1, y).level * 3 - Math.abs(x - (G.WALL_X - 7)) * 0.3 - Math.abs(y - H0 / 2) * 0.1;
      if (!best || sc > best.sc) best = { x, y, sc };
    }
    if (best) { u.x = best.x; u.y = best.y; }
  }
  for (const u of defs) if (u.x >= 0 && b.cells[u.y * W0 + u.x].k === "tower") u.post = "tower";
}
function removeSpot(list, u) { const i = list.findIndex(([x, y]) => x === u.x && y === u.y); if (i >= 0) list.splice(i, 1); }

// ---------- off the walls: the move to this map ----------
// why: "breach" (they are through), "ordered" (you sounded it), "ai" (the battle AI did).
export function toInterior(state, b, opts = {}) {
  const T = b.tier;
  let I = INTERIOR;
  const base = state.bases.find((x) => x.id === b.setup.baseId) || null;
  const side = T.side;
  const un = sideUntf(side, T.w0, T.h0), tfA = sideTf(side, T.w0, T.h0);
  // The wall line as it stands now, east-facing, and where everyone is on the wall map.
  const rows = [];
  for (let y = 0; y < T.h0; y++) { const [x, yy] = tfA(DEPLOY.WALL_X, y); const c = b.cells[yy * b.w + x]; rows.push({ k: c.k, hp: c.hp, mhp: c.mhp, bar: c.bar }); }
  const pos = new Map(b.units.map((u) => [u.id, un(u.x, u.y)]));
  const lay = buildInterior(base, { walled: true, rows, c: b.setup.context || {} });
  const W0 = lay.W, H0 = lay.H;
  I = { ...INTERIOR, ...lay.G };
  resizeBattle(b, W0, H0, lay.cells, 0, Math.floor(H0 / 2));
  const mapY = (y) => Math.max(0, Math.min(H0 - 1, Math.round((y * (H0 - 1)) / (T.h0 - 1))));
  const walkable = (x, y) => x >= 0 && y >= 0 && x < W0 && y < H0 && b.reach[y * W0 + x] && CELL[b.cells[y * W0 + x].k].walk;
  const freeCell = (x, y) => walkable(x, y) && !unitAt(b, x, y);
  // Park everyone off the map first, then place them one by one.
  const order = b.units.slice();
  for (const u of order) { u.x = W0 - 1; u.y = 0; u.parked = true; }
  const outside = [];
  for (const u of order) {
    const [ex, ey] = pos.get(u.id);
    const tx = Math.max(0, Math.min(W0 - 1, ex + I.SHIFT_X)), ty = mapY(ey);
    delete u.parked;
    if (u.side === "enemy" && !u.dead && !u.fled && !u.left && ex > DEPLOY.WALL_X) { u.off = true; u.x = W0 - 1; u.y = ty; u.ow = u.hunker = false; outside.push(u); continue; }
    if (u.dead || u.left || u.fled) { const p = nearestFree(b, W0, H0, Math.min(tx, I.WALL_X - 1), ty, walkable); if (p) { u.x = p[0]; u.y = p[1]; } continue; }
    const inside = (x, y) => freeCell(x, y) && x < I.WALL_X && !(u.side === "enemy" && lay.indoor[y * W0 + x]);
    const p = nearestFree(b, W0, H0, Math.min(tx, I.WALL_X - 1), ty, (x, y) => inside(x, y) && !b.units.some((o) => o !== u && !o.parked && !o.off && o.x === x && o.y === y));
    if (p) { u.x = p[0]; u.y = p[1]; }
    u.ow = false; u.hunker = false;
    if (u.side === "player") u.post = null;
  }
  // Where your people may stand for the redeploy: inside the wall, within REDEPLOY walking tiles of where they were,
  // at least REDEPLOY_GAP from an attacker.
  const standing = b.units.filter((u) => u.side === "player" && active(u));
  const foes = b.units.filter((u) => u.side === "enemy" && active(u));
  const reach = standing.length ? distField(b, standing.map((u) => [u.x, u.y]), standing[0]) : null;
  const zoneE = (x, y) => x < I.WALL_X && (!reach || reach[y * W0 + x] <= I.REDEPLOY) && !foes.some((f) => Math.hypot(f.x - x, f.y - y) < I.REDEPLOY_GAP);
  const okCell = (x, y) => freeCell(x, y);
  interiorDefaults(b, lay, okCell, zoneE);
  for (const u of standing) if (u.x < 0) { const p = nearestFree(b, W0, H0, 4, Math.floor(H0 / 2), (x, y) => okCell(x, y) && zoneE(x, y)) || nearestFree(b, W0, H0, 4, Math.floor(H0 / 2), okCell); if (p) { u.x = p[0]; u.y = p[1]; } }
  // Whatever burned, smoked or rang on the wall map stays there.
  b.fires = []; b.smoke = []; b.flares = []; b.lures = [];
  b.ladders = []; // the ladders stay against the old wall (siege.js); a ram goes on with its crew, its old target gone
  b.rams = (b.rams || []).filter((r) => !r.dropped); for (const r of b.rams) r.target = null;
  b.ghosts = {};
  const floodlit = !!(b.deploy && b.deploy.floodlit);
  finishInterior(b, side, lay, { walled: true, zoneE, floodlit, night: b.night, base, deploy: !!b.setup.deploy });
  b.tier.fellBackTurn = b.turn;
  b.tier.why = opts.why || "breach";
  const n = outside.length;
  say(b, opts.why === "breach" ? "They are through the wall! Everyone falls back to the yard and the buildings."
    : opts.why === "ai" ? `Your people fall back from the walls: ${opts.text || "they cannot be held"}. Into the yard and the buildings!`
    : "Off the walls! Everyone falls back to the yard and the buildings.", "danger");
  if (n) say(b, `${n} of them ${n === 1 ? "is" : "are"} still outside the wall and will come through the openings.`, "info");
  if (b.setup.deploy) { b.phase = "deploy"; say(b, "Redeploy: move your people into the buildings, to the windows, the upper floors and the roofs, or behind the barricades. Then start the fight.", "info"); }
  b.acted = true;
  b.rev++;
}

// The wall map's retreat (combat.js soundRetreat / act "fallBack"): everyone off the walls; the attackers move next.
export function fallBack(state, opts = {}) {
  const b = state.combat;
  if (!b || b.over) return "The battle is over.";
  if (!b.tier || b.tier.map !== "wall") return "There is nowhere to fall back to.";
  if (b.phase !== "player") return "Wait for the enemy turn to finish.";
  toInterior(state, b, { why: opts.by === "ai" ? "ai" : "ordered", text: opts.why });
  b.tier.enemyNext = true;
  return "";
}

// ---------- turn hooks (combat.js) ----------
// The start of your turn: on the wall map, are they through? On the yard map, is the yard lost?
export function tierPlayerTurn(state, b) {
  const T = b.tier;
  const foes = b.units.filter((u) => u.side === "enemy" && active(u));
  if (T.map === "wall") {
    const inside = foes.filter((f) => T.interior[f.y * b.w + f.x]).length;
    const need = Math.max(INTERIOR.BREACH_MIN, Math.ceil(foes.length * INTERIOR.BREACH_FRAC));
    const onWall = b.units.some((u) => u.side === "player" && active(u) && ["walkway", "tower", "gate", "breach", "rubble"].includes(b.cells[u.y * b.w + u.x].k));
    if (inside >= need || (inside > 0 && !onWall)) toInterior(state, b, { why: "breach" });
    return;
  }
  if (T.stage === "yard" && T.indoor) {
    const mine = b.units.filter((u) => u.side === "player" && active(u));
    const out = mine.filter((u) => !T.indoor[u.y * b.w + u.x]).length;
    const yard = foes.filter((f) => T.interior[f.y * b.w + f.x] && !T.indoor[f.y * b.w + f.x]).length;
    if (yard >= 3 && yard >= out * INTERIOR.YARD_LOST) {
      T.stage = "buildings";
      T.lastStandTurn = b.turn;
      say(b, T.buildings.some((s) => !s.roof) ? "The yard is lost! Last stand in the buildings: bar the doors, hold the windows." : "The yard is lost! Hold where you stand.", "danger");
    }
  }
}

// The start of the attackers' turn: those still outside come in at the wall (through the openings, or batter it).
export function tierEnemyTurn(state, b) {
  const T = b.tier;
  if (T.map !== "interior") return;
  const waiting = b.units.filter((u) => u.off && !u.dead);
  if (!waiting.length) return;
  const open = (T.openings || []).filter(([x, y]) => { const c = b.cells[y * b.w + x]; return CELL[c.k].walk && !(c.bar && c.hp > 0); }).length;
  const n = INTERIOR.WAVE + INTERIOR.WAVE_PER_OPENING * open;
  const near = (x, y) => (T.openings || []).some(([ox, oy]) => Math.abs(ox - x) + Math.abs(oy - y) <= 3);
  const cells = (T.entry || []).filter(([x, y]) => !b.units.some((o) => !o.off && !o.dead && !o.left && !o.fled && o.x === x && o.y === y) && CELL[b.cells[y * b.w + x].k].walk);
  cells.sort((a, c) => (near(c[0], c[1]) ? 1 : 0) - (near(a[0], a[1]) ? 1 : 0));
  let k = 0;
  for (const u of waiting) {
    if (k >= n || k >= cells.length) break;
    const [x, y] = cells[k++];
    u.off = false; u.x = x; u.y = y; u.ap = 2;
  }
  if (k) say(b, `${k} more come in at the wall${waiting.length > k ? ` (${waiting.length - k} still outside)` : ""}.`, "danger");
}

// The battle AI on this map once the yard is lost: into the nearest building with a free cell. Returns true if the
// unit moved (it may still act with what is left).
export function tierAI(b, u) {
  const T = b.tier;
  if (!T || T.map !== "interior" || T.stage !== "buildings" || !T.indoor) return false;
  if (T.indoor[u.y * b.w + u.x]) return false;
  const free = [];
  for (let i = 0; i < b.w * b.h; i++) {
    const x = i % b.w, y = (i / b.w) | 0;
    if (T.indoor[i] && CELL[b.cells[i].k].walk && !unitAt(b, x, y)) free.push([x, y]);
  }
  if (!free.length) return false;
  const field = distField(b, free, u);
  const r = reachable(b, u, u.mob * u.ap);
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && (best < 0 || field[i] + r.dist[i] * 0.01 < field[best] + r.dist[best] * 0.01)) best = i;
  if (best < 0 || !(field[best] < field[u.y * b.w + u.x])) return false;
  u.ap -= r.dist[best] <= u.mob ? 1 : 2;
  u.hunker = false; u.post = null;
  moveAlong(b, u, pathTo(r, best % b.w, (best / b.w) | 0));
  return true;
}

// ---------- by the numbers ----------
// The defenders' strength ratio through the three tiers (combat.js autoResolveCombat, defences.js holdCheck).
export function baseTiers(state, base, setup, ratio) {
  const ctx = (setup && setup.context) || {};
  const night = ctx.night != null ? ctx.night : isNight(state);
  const m = { ...tierMults(state, base, night) };
  // Raiders with siege kit (siege.js): ladders, a ram and grenades make the walls count less.
  const kit = setup && setup.enemy && setup.enemy.siege;
  if (kit && m.walled) m.wall = Math.max(1, m.wall - siegeWallCut(kit));
  const wall = ratio * m.wall, yard = wall * m.yard, last = yard * m.buildings;
  const tier = m.walled && wall >= TIERS.HELD_AT_WALL ? "wall" : yard >= 1 ? "yard" : "buildings";
  return { wall, yard, last, tier, mults: m };
}
