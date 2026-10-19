// The base map (2026-10-19, user request): every base, from a camp to the biggest hub, has a square grid map of its
// own with the camp, shelter or base itself in the middle, and the player lays out where every building, field,
// defence and parked car goes on it. The same map is the one fought over when a horde or a raid reaches the base
// (fort.js builds the battle from it), so where things stand is where they are defended.
//
// The grid (GRID, by tier): a camp's is 40 × 40 with the camp itself at most 20 × 20 in the middle; a shelter's 48; an
// outpost's 72 growing to 140 and the main hub's 168 growing to 300 × 300 as buildings go up ("scale up and down": the
// yard half-size grows GRID.per cells a building with a footprint, up to GRID.cap, and never shrinks below what is
// placed; the open ground beyond the yard is GRID.out cells on every side). Coordinates are relative to the middle of
// the base (0, 0), so a base that grows keeps every placement.
//   The yard: the square [-C, C) the buildings, fields and cars stand in (C = yardHalf), one cell clear of its edge.
//   The band: the two cells round the yard where the walkway and the wall ring stand when the base has walls (fort.js:
//     the walkway at ±C, the wall at ±(C + 1)); nothing is placed on it, walls or no walls.
//   Outside: open ground to the grid's edge, where defences (and nothing else) may also go: a trench or spike pits
//     well out in front of the wall, a watchtower on the approach.
// The battle map (fort.js buildFort) is the grid cropped to what stands on it (the band, every defence and car) plus
// FORT.MARGIN of open ground all round, so attackers come at it from the north, east, south or west edge as they did
// on the fort map; the Base map tab's view (openBaseMap) shows VIEW_PAD cells more, so there is room to place things
// further out, and the view grows as they are placed.
//
// Placement (placeItem / placeProblemAt): every building, construction job, crop plot and car is an item (itemsOf)
// with a footprint (FOOT: w × h cells and what it is on the map, turned by r = 0–3 quarter turns) and a position: the
// top-left cell of its footprint in grid coordinates, kept on the record itself (bld.at = [x, y, r] on a building,
// job.at on a queued one, vehicle.at on a car, base.plan.plots[i] for the i-th crop plot). The one rule (user request,
// 2026-10-19: "the restriction now is the ability to build within the base"): anything goes anywhere on the base's map,
// inside the yard or out beyond the wall, right against anything else, so long as it stands on the map and not on top
// of something else: another footprint, the base itself in the middle (CORE: tents round a fire, a shack behind a
// barricade, the main house with its cellar and well), the band where the wall ring stands, or in a doorway (the cell
// outside every door stays open, and a door never opens onto a footprint or the wall: the building could not be used).
// Anything not placed by hand is placed by the game (autoLayout, deterministic for the same base and items): buildings
// spiral out from the middle to the nearest spot that fits, defences take sensible default spots (barricades across
// the yard, pits and the trench in front of the wall, the floodlights and the watchtower at the corners). A thing
// that fits nowhere is left off the map (it still counts by the numbers: defences.js).
//
// On the map: a building under construction (a queued job with a footprint) shows its outline (CELL "outline": stakes
// and string on open ground, walkable) in the Base map view only; when the base is raided the outlines are gone and
// the ground is open land. Every building keeps the 3D sprites of the battle map (ui/isoview.js): houses with barred
// doors and windows and an upper floor, flat-roofed stores, the props of the yard, fields, the wall ring.
// The stores (makeStores): the base's own stock and armory are what is on the map in a battle, spread over the
// buildings that hold goods (the core, the storage box, crates, shed, storehouse and warehouse, cellars, the cold store,
// the freezer: STORES) and the parked cars that are storage, as containers whose contents can be looked at by clicking
// them at any time (never "unknown" ones: ui/combat.js), each taking a share by its room (basestorage.js).
// Base storage limits (2026-10-19, the user: "You can also leave things out not in containers but if they are outside
// the durability decays and easier for raiders to steal. Camps start with no storage but using a vehicle you can use
// the storage of the truck as a storage unit until better storage is made"): what does not fit the base's room
// (basestorage.js storageOf) lies on the map as piles of crates in the yard near the middle (layPiles: open ground all
// round, no door), holding exactly those goods; a camp with nothing but a car keeps its goods in the car and the rest on
// the pile. Raiders steal from them (thiefTurn, combat.js aiUnit): a share of them (STEAL.SHARE) go for the nearest
// pile once the wall is passed (then the nearest container with goods), batter a door in the way, grab up to STEAL.TURN
// a turn (twice that from a pile) and STEAL.KG in all and make for the nearest edge of the map; what a raider gets away
// with is gone from the stores when the fight ends (settleBaseBattle: b.stolen, applied by conflicts.js applyStolen,
// a pile's and a car's goods alike from the base's stock and armory); what a raider dropped (killed, taken down) stays.
// "You can move your vehicle to any unoccupied tiles of the base view which it can fit": a parked car is placed like
// anything else (its length by type: carLen, an Army truck 5), in the yard or beyond the wall. Hordes and raiders batter what
// stands in their way: doors, windows, walls, barricades and parked cars (combat.js bash); when the fight is over the
// buildings battered on the map wear as fixtures (breakdowns.js) and the cars lose condition (settleBaseBattle).
import { BUILDINGS, STORE_KG, count, isCamp, isShelter, farmSlots, tierName } from "./buildings.js";
import { CELL, placeCar, say, unitAt, active, distField, reachable, pathTo, moveAlong, bash, siegeTarget, foesOf, nearRect, createBattle } from "./combat.js";
import { carsAtBase } from "./vehicles.js";
import { wallHp, gateHp } from "./deploy.js";
import { INTERIOR, layoutSeed } from "./interior.js";
import { densify, COVER } from "./battlesize.js";
import { Rng } from "./rng.js";
import { SUPPLIES } from "./data.js";
import { FOODS } from "./foods.js";
import { itemKg } from "./inventory.js";
import { FIXTURES, WEAR, breakFixture } from "./breakdowns.js";
import { log, atBase } from "./world.js";
import { layMines } from "./mines.js"; // the main base's minefield, buried in the open ground round the yard (call-time only)
import { FORT } from "./fort.js"; // the wire rings' and the mines' distances from the wall (call-time only: the modules load in a circle)
import { cfgOf } from "./worldcfg.js"; // the run's dials: Base yard to start / at most
import { storageOf, coreStoreKg, vehicleStoreKg } from "./basestorage.js"; // the base's room and what lies outside (call-time only)

// The grid by tier: core = the half-size of the middle structure's own ground, yard = the yard's half-size to start
// with, per = yard growth a building with a footprint, cap = the yard's largest half-size, out = open ground beyond the
// band on every side (the grid's half-size is yard + 2 + out, at most GRID_MAX).
export const GRID = {
  camp:    { core: 4, yard: 10, per: 0, cap: 10, out: 8 },   // 40 × 40, the camp itself within 20 × 20
  shelter: { core: 6, yard: 12, per: 0, cap: 12, out: 10 },  // 48 × 48
  outpost: { core: 6, yard: 16, per: 2, cap: 50, out: 18 },  // 72 growing to 140
  hub:     { core: 8, yard: 24, per: 3, cap: 90, out: 58 },  // 168 growing to 300
};
export const GRID_MAX = 150; // the biggest grid: 300 × 300
export const MARGIN = 8;     // open ground round what stands on the battle map (fort.js FORT.MARGIN)
export const VIEW_PAD = 8;   // the Base map view shows this much more than the battle map
export const FLOOD = { R: 7 }; // a placed floodlight lights the cells within this many tiles of it
export const DEF_HP = { barricade: 60, car: 50 }; // hit points of a barricade and a parked car on the map (bash)
// Raiders stealing from the stores: the share of a raid's people who go for the stores once the wall is passed, the
// most one carries off (kg), and the kg of a supply with no weight of its own.
// TURN: the most a raider grabs from a container in one turn (a heavy item alone may take the whole turn), × PILE from
// a pile left outside (no lid, no lock, nothing to batter: "easier for raiders to steal").
export const STEAL = { SHARE: 0.4, KG: 22, TURN: 11, PILE: 2, DEFAULT_KG: 1 };
// The goods left outside (basestorage.js): piles of PILE.W × PILE.H cells in the yard near the base itself, one a
// PILE.KG of what lies out, at most PILE.MAX.
export const PILE = { W: 2, H: 1, KG: 200, MAX: 4, LABEL: "Pile outside" };
// What the map's battering does to the buildings afterwards (breakdowns.js wear): a door or window broken in, a wall
// section breached, a barricade battered through; a parked car's condition lost for the hit points it lost.
export const MAP_WEAR = { door: 15, window: 8, breach: 30, barricade: 60, carCondition: 60 };

export const tierKey = (base) => (isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost");
// The grid by tier, under the run's Base yard dials (worldcfg.js baseMin / baseMax, stamped on the base as base.gridCfg by
// stampGrid from wherever a state is to hand: the yard to start with and the most it grows to are scaled, the yard
// never under the core's ground + 2, the cap never under the yard nor past GRID_MAX; a standard run reads GRID itself).
export function gridOf(base) {
  const g = GRID[tierKey(base)];
  const c = base && base.gridCfg;
  if (!c || (c.min === 1 && c.max === 1)) return g;
  const yard = Math.max(g.core + 2, Math.min(GRID_MAX - 2 - g.out, Math.round(g.yard * c.min)));
  const cap = Math.max(yard, Math.min(GRID_MAX - 2 - g.out, Math.round(g.cap * c.max)));
  return { ...g, yard, cap };
}
/** The run's Base yard dials on this base (once; a base made before they were set takes them on its next layout). @param {any} state @param {any} base */
export function stampGrid(state, base) {
  if (!base || base.gridCfg || !state || !state.worldCfg) return;
  const min = cfgOf(state, "baseMin"), max = cfgOf(state, "baseMax");
  if (min !== 1 || max !== 1) base.gridCfg = { min, max };
}

// ---------- footprints ----------
// kind: house (walls, barred doors, windows, an upper floor with storeys 2), roof (a flat-roofed block climbed by a
// ladder), prop (k: the yard thing it is drawn as), pen (a fence ring with hay inside), field (the ground only),
// defence (k: the cell kind; no buffer), vehicle (a parked car, 2 cells wide). Buildings with no footprint (walls,
// camouflage, cots, the step-ups and upgrades in place) are not on the map as things of their own.
const HOUSE = (w, h, storeys = 1, extra = {}) => ({ kind: "house", w, h, storeys, ...extra });
const ROOF = (w, h) => ({ kind: "roof", w, h });
const PROP = (k, w = 1, h = 1, extra = {}) => ({ kind: "prop", k, w, h, ...extra });
const DEF = (k, w, h, extra = {}) => ({ kind: "defence", k, w, h, ...extra });
export const FOOT = {
  bunkhouse: HOUSE(5, 4, 2), barracks: HOUSE(6, 4, 2), infirmary: HOUSE(5, 4), field_hosp: HOUSE(5, 4), clinic: HOUSE(5, 4), hospital: HOUSE(6, 5, 2),
  machine_shop: HOUSE(5, 4), radio: HOUSE(4, 3), garage: HOUSE(5, 4, 1, { wide: true }), common_room: HOUSE(5, 4), chapel: HOUSE(4, 4), kitchen: HOUSE(4, 3),
  canteen: HOUSE(5, 4), huntcabin: HOUSE(3, 3), greenhouse: HOUSE(4, 3, 1, { glass: true }), cells: HOUSE(4, 4), jailhouse: HOUSE(5, 4), freezer: HOUSE(3, 3),
  cellar: ROOF(3, 2), coldstore: ROOF(3, 3), storehouse: ROOF(4, 3), cistern: ROOF(2, 2),
  shed: ROOF(3, 2), warehouse: ROOF(6, 4), storebox: PROP("crate", 1, 1), // the storage ladder (basestorage.js): a box, a shed, a warehouse
  well: PROP("well"), rain_catcher: PROP("barrel"), water_barrel: PROP("barrel"), crates: PROP("crate", 1, 1, { v: 2 }), boiler: PROP("barrel"),
  cookhouse: PROP("firepit"), smoker: PROP("table", 2, 1), generator: PROP("pump", 2, 1), still: PROP("barrel"), sealer: PROP("table"), grainmill: PROP("table"),
  meatgrinder: PROP("table"), craftbench: PROP("counter", 2, 1), workbench: PROP("counter", 2, 1), toolbench: PROP("counter", 2, 1), ammo_bench: PROP("counter", 2, 1),
  reload_bench: PROP("counter", 2, 1), med_station: PROP("counter", 2, 1), lockup: PROP("bars", 2, 2), relay: PROP("locker"),
  animal_pen: { kind: "pen", w: 4, h: 3 },
  barricades: DEF("barricade", 3, 1), spike_pits: DEF("spikes", 3, 2), trench: DEF("trench", 16, 1), floodlights: DEF("lamp", 1, 1), watchtower: DEF("tower", 2, 2),
  sandbag_wall: DEF("sandbag", 4, 1), // the Defenses tab's sandbag positions: 4 cells, placed like a barricade
  // Not placed (laid round the wall by the map itself: the wire rings, the guard towers on the walkway, the minefield
  // in the open ground): barbed_wire, razor_wire, guard_towers, minefield.
};
export const FIELD = { kind: "field", w: 3, h: 2 };
// What holds the base's goods on the map (makeStores): a weight for the share of the stores each takes.
const STORES = { warehouse: 4, storehouse: 3, cellar: 2, coldstore: 2, freezer: 2, shed: 1.5, crates: 1, storebox: 0.5 };
const BUILD_KINDS = new Set(["house", "roof", "prop", "pen", "field", "vehicle"]); // the kinds the yard grows for (footCount) and the cover props keep off
export const hasFootprint = (type) => !!FOOT[type];

// ---------- the middle: the camp, the shelter, the base ----------
// Each part: a footprint (as FOOT) at a cell relative to the middle; store: it holds goods (a container in a battle),
// with its label.
const CORE = {
  camp: [
    { kind: "prop", k: "firepit", w: 1, h: 1, x: 0, y: 0, name: "Camp fire" },
    { kind: "prop", k: "tent", w: 1, h: 1, x: -3, y: -3 }, { kind: "prop", k: "tent", w: 1, h: 1, x: 2, y: -3 }, { kind: "prop", k: "tent", w: 1, h: 1, x: -3, y: 2 },
    { kind: "prop", k: "crate", v: 2, w: 1, h: 1, x: 2, y: 2, name: "Camp cache", store: 4 },
  ],
  shelter: [
    { kind: "house", w: 5, h: 4, storeys: 1, x: -5, y: -5, name: "Bunk shack", key: "shack", store: 4 },
    { kind: "prop", k: "firepit", w: 1, h: 1, x: 2, y: -3, name: "Fire" },
    { kind: "defence", k: "barricade", w: 3, h: 1, x: -4, y: 3 },
    { kind: "prop", k: "crate", v: 2, w: 1, h: 1, x: 3, y: 2, name: "Crates", store: 1 },
  ],
  outpost: [
    { kind: "house", w: 5, h: 4, storeys: 1, x: -5, y: -5, name: "Bunk shack", key: "shack", store: 4 },
    { kind: "prop", k: "well", w: 1, h: 1, x: 3, y: -4, name: "Spring" },
    { kind: "prop", k: "firepit", w: 1, h: 1, x: 3, y: -1, name: "Fire" },
    { kind: "prop", k: "crate", v: 2, w: 1, h: 1, x: 3, y: 2, name: "Pantry crates", store: 1 },
  ],
  hub: [
    { kind: "house", w: 6, h: 5, storeys: 2, x: -7, y: -7, name: "Main house", key: "hall", store: 4 },
    { kind: "prop", k: "well", w: 1, h: 1, x: 3, y: -6, name: "Well" },
    { kind: "roof", w: 2, h: 2, x: 3, y: -2, name: "Cellar", key: "cellar", store: 3 },
    { kind: "prop", k: "crate", v: 2, w: 1, h: 1, x: 3, y: 2, name: "Crates", store: 1 }, { kind: "prop", k: "crate", v: 1, w: 1, h: 1, x: 5, y: 2 },
  ],
};
export const coreParts = (base) => CORE[tierKey(base)];
export const coreName = (base) => tierName(base);

// ---------- sizes ----------
// How many buildings with a footprint stand or are queued (the yard grows with them).
const footCount = (base) => base.buildings.filter((b) => FOOT[b.type] && FOOT[b.type].kind !== "defence").length + base.construction.filter((c) => !c.target && FOOT[c.type] && FOOT[c.type].kind !== "defence").length;
// The yard's half-size: by tier and buildings, and never smaller than what is placed inside it needs.
export function yardHalf(base) {
  const g = gridOf(base);
  let C = Math.min(g.cap, g.yard + g.per * footCount(base));
  // Nothing placed stands under the wall ring: a thing the band would cut through (placed inside while the yard was
  // bigger, or just outside before the yard grew) pulls the yard out over it, up to the cap; a thing well beyond the
  // band stays outside the wall.
  for (let grown = true; grown && C < g.cap;) {
    grown = false;
    for (const it of placedItems(base)) {
      if (!it.at) continue;
      const r = rectOf(it, it.at);
      const inside = r.x0 >= -C && r.y0 >= -C && r.x0 + r.w <= C && r.y0 + r.h <= C;
      const beyond = r.x0 >= C + 2 || r.y0 >= C + 2 || r.x0 + r.w <= -C - 2 || r.y0 + r.h <= -C - 2;
      if (inside || beyond) continue;
      const need = Math.min(g.cap, Math.max(-r.x0, r.x0 + r.w, -r.y0, r.y0 + r.h));
      if (need > C) { C = need; grown = true; }
    }
  }
  return C;
}
// The grid's half-size: the yard, the band and the open ground beyond, at most GRID_MAX.
export const gridHalf = (base) => Math.min(GRID_MAX, yardHalf(base) + 2 + gridOf(base).out);
export const gridSize = (base) => gridHalf(base) * 2;
const inYard = (x, y, C) => x >= -C && x < C && y >= -C && y < C;
const onBand = (x, y, C) => !inYard(x, y, C) && inYard(x, y, C + 2);

// ---------- items ----------
// The dims of a footprint turned r quarter turns, and its rect at a position.
export const dimsOf = (f, r) => (r & 1 ? [f.h, f.w] : [f.w, f.h]);
export function rectOf(it, at) {
  const [w, h] = dimsOf(it, at[2] || 0);
  return { x0: at[0], y0: at[1], w, h };
}
const label = (type, n) => `${BUILDINGS[type] ? BUILDINGS[type].name : type}${n ? ` ${n}` : ""}`;
export const planOf = (base) => base.plan || (base.plan = { plots: [] });
// Every item that goes on the map, in a fixed order (the auto layout fills them in this order): standing buildings
// (b:id), queued ones with a footprint (c:id), the crop plots (p:i) and the cars parked here (v:id). at: where it was
// placed by hand, else null. built: false for a queued job (an outline in the view, open ground in a raid).
export function itemsOf(state, base) {
  stampGrid(state, base);
  const out = [];
  const seen = {};
  const n = (type) => (seen[type] = (seen[type] || 0) + 1);
  for (const b of base.buildings) {
    const f = FOOT[b.type];
    if (!f) continue;
    out.push({ key: `b:${b.id}`, type: b.type, ...f, label: label(b.type, n(b.type)), at: b.at || null, rec: b, built: true });
  }
  for (const c of base.construction) {
    const f = FOOT[c.type];
    if (!f || c.target) continue; // an upgrade in place keeps the standing building's spot
    out.push({ key: `c:${c.id}`, type: c.type, ...f, label: `${label(c.type, 0)} (building)`, at: c.at || null, rec: c, built: false });
  }
  const plots = planOf(base).plots;
  for (let i = 0; i < farmSlots(base); i++) out.push({ key: `p:${i}`, type: "plot", ...FIELD, label: `Crop plot ${i + 1}`, at: plots[i] || null, built: true });
  if (state) for (const v of carsAtBase(state, base.id)) {
    const L = carLen(v);
    out.push({ key: `v:${v.id}`, type: "vehicle", kind: "vehicle", w: L, h: 2, label: v.name, at: v.at || null, rec: v, built: true, veh: v });
  }
  return out;
}
// A parked car on the map: its length (2 cells wide) and what it is drawn as, as on any battle map (combat.js
// placeVehicle: an Army truck 5 long drawn as the Army's, a pickup 4, a car 3).
export const carLen = (v) => (v && v.type === "miltruck" ? 5 : v && v.type === "truck" ? 4 : 3);
const carBody = (v) => (v && v.type === "miltruck" ? "m35" : v && v.type === "truck" ? "truck" : "car");
// Only what is placed by hand (sizes: yardHalf).
function placedItems(base) {
  const out = [];
  for (const b of base.buildings) if (FOOT[b.type] && b.at) out.push({ ...FOOT[b.type], at: b.at });
  for (const c of base.construction) if (FOOT[c.type] && !c.target && c.at) out.push({ ...FOOT[c.type], at: c.at });
  for (const p of planOf(base).plots) if (p) out.push({ ...FIELD, at: p });
  return out;
}
export const itemByKey = (state, base, key) => itemsOf(state, base).find((it) => it.key === key) || null;

// ---------- local layouts (a footprint's cells, turned) ----------
// A house's cells in its own frame at r = 0 (the front on the south side): walls, a barred front door in the middle
// of the front (two for a wide one), a back door on bigger houses, windows, the upper floor (the back half) and its
// stairs. Each cell: { dx, dy, k, ... }; doors carry out: the cell outside them.
function houseCells(f) {
  const { w, h } = f, two = f.storeys === 2 && w >= 5 && h >= 4;
  const cells = [];
  const border = (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ dx: x, dy: y, k: border(x, y) ? "wall" : "open", f: "floor", t: border(x, y) && two ? 2 : 0, indoor: !border(x, y) });
  const at = (x, y) => cells[y * w + x];
  const door = (x, y, hp, out) => { const c = at(x, y); c.k = "bdoor"; c.hp = hp; c.t = 0; c.indoor = true; c.door = true; c.out = out; };
  const win = (x, y) => { const c = at(x, y); if (c.k !== "wall") return; if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) return; c.k = "window"; c.hp = INTERIOR.WINDOW_HP; c.t = 0; };
  const mx = Math.floor(w / 2);
  door(mx, h - 1, f.wide ? INTERIOR.WIDE_DOOR_HP : INTERIOR.DOOR_HP, [mx, h]);
  if (f.wide && w >= 4) door(mx - 1, h - 1, INTERIOR.WIDE_DOOR_HP, [mx - 1, h]);
  if (two || w * h >= 20) door(w - 1 - mx, 0, INTERIOR.DOOR_HP, [w - 1 - mx, -1]);
  if (f.glass) { for (let x = 1; x < w - 1; x++) { win(x, 0); if (x !== mx) win(x, h - 1); } for (let y = 1; y < h - 1; y++) { win(0, y); win(w - 1, y); } }
  else {
    win(mx - (w > 4 ? 2 : 1), h - 1); win(mx + (w > 4 ? 2 : 1), h - 1);
    win(mx, 0);
    if (h >= 4) { win(0, Math.floor(h / 2)); win(w - 1, Math.floor(h / 2)); }
  }
  if (two) {
    const loftY = Math.floor((h - 2) / 2); // the back (north) half is the upper floor, up the stairs at its south edge
    for (let y = 1; y <= loftY; y++) for (let x = 1; x < w - 1; x++) { const c = at(x, y); c.k = "loft"; c.h = 1; }
    const s = at(1, loftY + 1); s.k = "stairs";
  } else if (w >= 4 && h >= 3) {
    const c = at(mx > 1 ? mx - 1 : 1, 1);
    if (c.k === "open" && !cells.some((d) => d.door && Math.abs(d.dx - c.dx) + Math.abs(d.dy - c.dy) <= 1)) c.k = "counter";
  }
  return cells;
}
function roofCells(f) {
  const cells = [];
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) cells.push({ dx: x, dy: y, k: "roof", f: "roof", h: 1 });
  cells[0].ladder = [-1, 0]; // a ladder up on the west side
  return cells;
}
function penCells(f) {
  const cells = [];
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const edge = x === 0 || y === 0 || x === f.w - 1 || y === f.h - 1;
    cells.push({ dx: x, dy: y, k: edge && !(x === Math.floor(f.w / 2) && y === f.h - 1) ? "fence" : (x + y) % 3 === 1 ? "hay" : "open", f: "field" });
  }
  return cells;
}
function propCells(f) {
  const cells = [];
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) cells.push({ dx: x, dy: y, k: f.k, v: f.v, hp: f.k === "barricade" ? DEF_HP.barricade : undefined, h: f.k === "tower" ? 2 : undefined });
  return cells;
}
// The cells of a footprint at r = 0, by kind.
function localCells(f) {
  if (f.kind === "house") return houseCells(f);
  if (f.kind === "roof") return roofCells(f);
  if (f.kind === "pen") return penCells(f);
  if (f.kind === "field") { const out = []; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) out.push({ dx: x, dy: y, k: "open", f: "field" }); return out; }
  if (f.kind === "vehicle") return []; // placeCar lays a car
  return propCells(f);
}
// A local cell's offset turned r quarter turns (clockwise) within a w × h footprint.
function turn(dx, dy, w, h, r) {
  switch (r & 3) {
    case 1: return [h - 1 - dy, dx];
    case 2: return [w - 1 - dx, h - 1 - dy];
    case 3: return [dy, w - 1 - dx];
    default: return [dx, dy];
  }
}
// The cells of an item placed at `at` (grid coordinates), with each door's outside cell turned too.
export function cellsOf(it, at) {
  const r = at[2] || 0;
  return localCells(it).map((c) => {
    const [dx, dy] = turn(c.dx, c.dy, it.w, it.h, r);
    const o = { ...c, x: at[0] + dx, y: at[1] + dy };
    if (c.out) { const [ox, oy] = turn(c.out[0], c.out[1], it.w, it.h, r); o.out = [at[0] + ox, at[1] + oy]; }
    if (c.ladder) { const [lx, ly] = turn(c.ladder[0], c.ladder[1], it.w, it.h, r); o.ladder = [at[0] + lx, at[1] + ly]; }
    return o;
  });
}
// The cells outside an item's doors.
export const doorCellsOf = (it, at) => cellsOf(it, at).filter((c) => c.out).map((c) => c.out);

// ---------- placement rules ----------
const K = (x, y) => (y + 2048) * 4096 + (x + 2048);
// The occupancy of everything but `skip`: footprints and the cells outside doors, each with the key of what is there.
export function occupancy(state, base, skip = null, auto = null) {
  stampGrid(state, base);
  const occ = { foot: new Map(), door: new Map() };
  const put = (m, x, y, key) => { if (!m.has(K(x, y))) m.set(K(x, y), key); };
  const mark = (it, at, key) => {
    const r = rectOf(it, at);
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) put(occ.foot, x, y, key);
    for (const [x, y] of doorCellsOf(it, at)) put(occ.door, x, y, key);
  };
  for (const p of coreParts(base)) mark(p, [p.x, p.y, 0], "core");
  for (const it of itemsOf(state, base)) {
    if (it.key === skip) continue;
    const at = it.at || (auto && auto.get(it.key)) || null;
    if (at) mark(it, at, it.key);
  }
  return occ;
}
// Why an item cannot stand at (x, y) turned r, or "" when it can. occ: occupancy(…) without this item.
export function placeProblemAt(base, it, x, y, r, occ) {
  const at = [x, y, r & 3];
  const rect = rectOf(it, at);
  const G = gridHalf(base), C = yardHalf(base);
  if (rect.x0 < -G || rect.y0 < -G || rect.x0 + rect.w > G || rect.y0 + rect.h > G) return "Off the map";
  for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) {
    const k = K(xx, yy);
    if (onBand(xx, yy, C)) return "That is where the wall stands";
    if (occ.foot.has(k)) return `On top of ${nameOf(occ.foot.get(k))}`;
    if (occ.door.has(k)) return `In the doorway of ${nameOf(occ.door.get(k))}`;
  }
  for (const [ox, oy] of doorCellsOf(it, at)) {
    const k = K(ox, oy);
    if (occ.foot.has(k)) return `Its door would open onto ${nameOf(occ.foot.get(k))}`;
    if (onBand(ox, oy, C)) return "Its door would open onto the wall";
  }
  return "";
}
const nameOf = (key) => (key === "core" ? "the base itself" : key.startsWith("p:") ? "a crop plot" : key.startsWith("v:") ? "a parked car" : key.startsWith("c:") ? "a building going up" : "a building");
// Place an item by hand (the Base map view). Returns an error, or "".
export function placeItem(state, base, key, x, y, r = 0) {
  const it = itemByKey(state, base, key);
  if (!it) return "That is not on this base any more.";
  const why = placeProblemAt(base, it, x, y, r, occupancy(state, base, key, null)); // against what is placed by hand and the base itself: what the game placed moves out of the way (autoLayout)
  if (why) return why;
  setAt(base, it, [x, y, r & 3]);
  return "";
}
export function unplaceItem(state, base, key) {
  const it = itemByKey(state, base, key);
  if (!it) return "That is not on this base any more.";
  setAt(base, it, null);
  return "";
}
function setAt(base, it, at) {
  if (it.key.startsWith("p:")) { const plots = planOf(base).plots, i = Number(it.key.slice(2)); while (plots.length <= i) plots.push(null); plots[i] = at; return; }
  if (at) it.rec.at = at; else delete it.rec.at;
}
// A finished job's building takes the job's spot (buildings.js constructionHour); an upgrade in place keeps the
// standing building's (addBuilding: a hospital tier, a bench, a jail).
export function carryPlacement(from, to) { if (from && from.at && to) to.at = from.at.slice(); }

// ---------- the auto layout ----------
// Where everything not placed by hand goes: a Map key → [x, y, r], the same for the same base and items (its own
// dice: interior.js layoutSeed and the items). except: an item left out (being placed by hand).
const autoCache = new Map();
export function autoLayout(state, base, except = null) {
  stampGrid(state, base);
  const items = itemsOf(state, base);
  const sig = items.map((it) => `${it.key}${it.at ? `@${it.at.join(",")}` : ""}`).join("|");
  const key = `${base.id}|${layoutSeed(base)}|${yardHalf(base)}|${except || ""}|${sig}`;
  let out = autoCache.get(key);
  if (out) return out;
  out = new Map();
  const rng = new Rng(layoutSeed(base) ^ 0x5bd1e995);
  const C = yardHalf(base), G = gridHalf(base);
  const occ = occupancy(state, base, except, null);
  const take = (it, at) => {
    out.set(it.key, at);
    const r = rectOf(it, at);
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) occ.foot.set(K(x, y), it.key);
    for (const [x, y] of doorCellsOf(it, at)) if (!occ.door.has(K(x, y))) occ.door.set(K(x, y), it.key);
  };
  const fits = (it, x, y, r) => !placeProblemAt(base, it, x, y, r, occ);
  // Buildings, fields and cars: spiral out from the middle, the first spot that fits (a few of the nearest, by dice).
  const spiral = (it, rs) => {
    const found = [];
    for (let d = 0; d <= C && found.length < 3; d++) {
      for (let y = -d; y <= d; y++) for (let x = -d; x <= d; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== d) continue;
        for (const r of rs) { const [w, h] = dimsOf(it, r); if (fits(it, x - Math.floor(w / 2), y - Math.floor(h / 2), r)) found.push([x - Math.floor(w / 2), y - Math.floor(h / 2), r]); }
      }
    }
    return found.length ? found[rng.int(0, found.length - 1)] : null;
  };
  // Defences: the first of their default spots that fits (around the yard's edge inside the wall for barricades and
  // the lights, the corners for the watchtower, in front of the wall for pits and the trench).
  const defSpots = (it) => {
    const k = it.k, spots = [];
    const edge = C - 2, out = C + 3;
    if (k === "barricade") for (let i = 0; i < 12; i++) spots.push([rng.int(-edge + 1, edge - 4), rng.pick([-edge + 1, edge - 2, rng.int(-edge + 1, edge - 2)]), 0], [rng.pick([-edge + 1, edge - 2]), rng.int(-edge + 1, edge - 4), 1]);
    else if (k === "lamp") spots.push([edge, edge], [-edge, -edge], [edge, -edge], [-edge, edge]);
    else if (k === "tower") spots.push([edge - 1, edge - 1], [-edge, -edge], [edge - 1, -edge], [-edge, edge - 1]);
    else if (k === "spikes") spots.push([-1, out, 0], [-1, -out - 1, 0], [out, -1, 1], [-out - 1, -1, 1], [5, out, 0], [-7, out, 0], [5, -out - 1, 0], [-7, -out - 1, 0]);
    else if (k === "trench") spots.push([-5, out + 2, 0], [out + 2, -5, 1], [-5, -out - 3, 0], [-out - 3, -5, 1]);
    for (const s of spots) if (s[0] >= -G && s[1] >= -G && fits(it, s[0], s[1], s[2] || 0)) return [s[0], s[1], s[2] || 0];
    return spiral(it, [0, 1]);
  };
  for (const it of items) {
    if (it.key === except) continue;
    if (it.at) continue;
    const at = it.kind === "defence" ? defSpots(it) : spiral(it, it.kind === "field" || it.kind === "vehicle" ? [0, 1] : [0]);
    if (at) take(it, at);
  }
  if (autoCache.size > 300) autoCache.clear();
  autoCache.set(key, out);
  return out;
}
// Every item with where it stands (by hand or by the game): { it, at, auto }. Those that fit nowhere have at null.
export function layoutOf(state, base) {
  stampGrid(state, base);
  const auto = autoLayout(state, base);
  return itemsOf(state, base).map((it) => ({ it, at: it.at || auto.get(it.key) || null, auto: !it.at }));
}

// ---------- the map ----------
// Builds the base's map for a battle (fort.js buildFort) or the Base map view (opts.view: outlines for the queued
// buildings, VIEW_PAD more ground). opts.pitsAt: spike pits used up on the horde that reached the walls (defences.js
// hordeAttackBase keeps their spots so they show in the fight). Returns the fort record fort.js works with:
// W × H cells, the yard's origin and size, the wall rect, the ring, walkway, gates, towers, ladders, the masks, the
// buildings, plus ox/oy (grid → map), stores (where the goods are), vehicles (the cars and their cells), lights.
export function buildBaseMap(state, base, rng, opts = {}) {
  stampGrid(state, base);
  const view = !!opts.view;
  const C = yardHalf(base), G = gridHalf(base);
  const walled = count(base, "walls") > 0 && !isShelter(base);
  const lay = layoutOf(state, base).filter((e) => e.at && (view || e.it.built));
  // The crop: the band and everything on the map, plus the margin (and the view's pad), within the grid.
  let x0 = -C - 2, y0 = -C - 2, x1 = C + 2, y1 = C + 2; // half-open
  for (const e of lay) { const r = rectOf(e.it, e.at); x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + r.w); y1 = Math.max(y1, r.y0 + r.h); }
  if (opts.pitsAt) for (const at of opts.pitsAt) { if (!at) continue; const r = rectOf(FOOT.spike_pits, at); x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + r.w); y1 = Math.max(y1, r.y0 + r.h); }
  const pad = MARGIN + (view ? VIEW_PAD : 0);
  x0 = Math.max(-G, x0 - pad); y0 = Math.max(-G, y0 - pad); x1 = Math.min(G, x1 + pad); y1 = Math.min(G, y1 + pad);
  const W = x1 - x0, H = y1 - y0, ox = -x0, oy = -y0; // grid (gx, gy) → map (gx + ox, gy + oy)
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: "grass" }));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x, y) => (inside(x, y) ? cells[y * W + x] : null);
  const used = new Uint8Array(W * H), indoor = new Uint8Array(W * H), keep = new Uint8Array(W * H);
  const F = {
    W, H, cells, M: MARGIN, ox, oy, x0: -C + ox, y0: -C + oy, yw: 2 * C, yh: 2 * C, walled, view,
    wall: { x0: -C - 2 + ox, x1: C + 1 + ox, y0: -C - 2 + oy, y1: C + 1 + oy }, ring: [], walkway: [], gates: { north: [], east: [], south: [], west: [] }, towers: [], ladders: [],
    buildings: [], lofts: [], roofs: [], doors: [], windows: [], outlines: [], stores: [], vehicles: [], lights: [], inside: null, indoor, lay: { W, H, G: null, buildings: [] },
  };
  for (let y = -C; y < C; y++) for (let x = -C; x < C; x++) { const c = at(x + ox, y + oy); if (c) c.f = "dirt"; }
  // A thing's cells onto the map. built: false lays an outline instead (the view).
  const lay1 = (it, atG, key, built, name) => {
    const r = rectOf(it, atG);
    const mx = r.x0 + ox, my = r.y0 + oy;
    const buffer = BUILD_KINDS.has(it.kind);
    for (let y = my - (buffer ? 1 : 0); y < my + r.h + (buffer ? 1 : 0); y++) for (let x = mx - (buffer ? 1 : 0); x < mx + r.w + (buffer ? 1 : 0); x++) if (inside(x, y)) keep[y * W + x] = 1;
    if (!built) {
      for (let y = my; y < my + r.h; y++) for (let x = mx; x < mx + r.w; x++) { const c = at(x, y); if (c && c.k === "open") { c.k = "outline"; used[y * W + x] = 1; } }
      F.outlines.push({ key, name, x0: mx, y0: my, w: r.w, h: r.h });
      return;
    }
    if (it.kind === "vehicle") {
      const ax = (atG[2] || 0) & 1 ? "y" : "x";
      const rect = placeCar(cells, W, H, mx, my, ax, it.w, "car", (x, y) => inside(x, y) && cells[y * W + x].k === "open", (it.veh ? it.veh.id : 0) % 1000, { ring: false, body: carBody(it.veh) });
      if (rect) {
        for (let y = rect.y0; y < rect.y0 + rect.h; y++) for (let x = rect.x0; x < rect.x0 + rect.w; x++) { const c = cells[y * W + x]; c.hp = c.mhp = DEF_HP.car; used[y * W + x] = 1; }
        F.vehicles.push({ id: it.veh ? it.veh.id : null, name: it.label, x0: rect.x0, y0: rect.y0, w: rect.w, h: rect.h });
        // A car that is storage (basestorage.js vehicleStoreKg: its payload while it is parked here) holds goods.
        const room = it.veh ? vehicleStoreKg(it.veh) : 0;
        if (room > 0) F.stores.push({ id: F.stores.length + 1, label: it.label, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, weight: 1, bid: null, vid: it.veh.id, room });
      }
      return;
    }
    const doors = [], bcells = [];
    for (const c of cellsOf(it, atG)) {
      const x = c.x + ox, y = c.y + oy, q = at(x, y);
      if (!q) continue;
      q.k = c.k; if (c.f) q.f = c.f;
      if (c.t) q.t = c.t; else delete q.t;
      if (c.h) q.h = c.h; else delete q.h;
      if (c.hp) { q.hp = q.mhp = c.hp; }
      if (c.v != null) q.v = c.v;
      used[y * W + x] = 1;
      if (c.indoor) indoor[y * W + x] = 1;
      if (c.k === "loft") F.lofts.push([x, y]);
      if (c.k === "roof") F.roofs.push([x, y]);
      if (c.k === "window") F.windows.push([x, y]);
      if (c.k === "tower") F.towers.push([x, y]);
      if (c.k === "lamp") F.lights.push([x, y]);
      if (c.door) { doors.push([x, y]); F.doors.push([x, y]); }
      if (c.ladder) { const l = at(c.ladder[0] + ox, c.ladder[1] + oy); if (l && l.k === "open") { l.k = "ladder"; F.ladders.push([c.ladder[0] + ox, c.ladder[1] + oy]); } }
      bcells.push([x, y]);
    }
    if (it.kind === "house" || it.kind === "roof") {
      const b = { name, key: it.key0 || it.type, bid: it.rec && it.key && it.key.startsWith("b:") ? it.rec.id : null, type: it.type, x0: mx, y0: my, w: r.w, h: r.h, roof: it.kind === "roof", storeys: it.kind === "house" ? (it.storeys === 2 && r.w >= 4 && r.h >= 4 ? 2 : 1) : 0, doors };
      F.buildings.push(b);
      F.lay.buildings.push(b);
      if (it.store) F.stores.push({ id: F.stores.length + 1, label: name, x: mx, y: my, w: r.w, h: r.h, weight: it.store, bid: b.bid, room: it.room || 0 });
    } else if (it.store) F.stores.push({ id: F.stores.length + 1, label: name, x: mx, y: my, w: r.w, h: r.h, weight: it.store, bid: it.rec && it.key.startsWith("b:") ? it.rec.id : null, room: it.room || 0 });
  };
  // The middle: the camp, the shelter or the base itself.
  // room: the kg it holds (basestorage.js: the core's room shared over its stores, a storage building's STORE_KG).
  const coreW = coreParts(base).reduce((a, p) => a + (p.store || 0), 0) || 1;
  for (const p of coreParts(base)) lay1({ ...p, key0: p.key || p.k, room: p.store ? (coreStoreKg(base) * p.store) / coreW : 0 }, [p.x, p.y, 0], "core", true, p.name || coreName(base));
  // Everything placed, by hand or by the game.
  for (const e of lay) {
    const it = e.it;
    const store = STORES[it.type] || 0;
    lay1({ ...it, store, room: store ? STORE_KG[it.type] || 0 : 0 }, e.at, it.key, it.built, it.label);
  }
  if (opts.pitsAt) for (const atG of opts.pitsAt) if (atG) lay1({ ...FOOT.spike_pits, type: "spike_pits" }, atG, "pits", true, "Spike pits");
  layPiles(state, base, F, { C, G, inside, used, keep });
  // The band: the wall ring with a gate in the middle of each side and the walkway inside it (a walled base), else
  // open ground; the ladders up to the walkway where the yard's edge is free.
  const w = F.wall;
  if (walled) {
    const hpWall = wallHp(base), hpGate = gateHp(base);
    for (let y = w.y0; y <= w.y1; y++) for (let x = w.x0; x <= w.x1; x++) {
      const onRing = x === w.x0 || x === w.x1 || y === w.y0 || y === w.y1;
      const onWalk = !onRing && (x === w.x0 + 1 || x === w.x1 - 1 || y === w.y0 + 1 || y === w.y1 - 1);
      const q = at(x, y);
      if (!q) continue;
      if (onRing) { q.k = "palisade"; q.f = "dirt"; q.t = 1; q.hp = q.mhp = hpWall; delete q.h; F.ring.push([x, y]); }
      else if (onWalk) { q.k = "walkway"; q.f = "dirt"; q.h = 1; delete q.t; F.walkway.push([x, y]); }
    }
    const cx = Math.floor((w.x0 + w.x1) / 2), cy = Math.floor((w.y0 + w.y1) / 2);
    for (const side of ["north", "east", "south", "west"]) {
      for (let i = 0; i < 2; i++) {
        const o = i - 1;
        const [x, y] = side === "north" ? [cx + o, w.y0] : side === "south" ? [cx + o, w.y1] : side === "west" ? [w.x0, cy + o] : [w.x1, cy + o];
        const q = at(x, y);
        if (!q) continue;
        q.k = "gate"; delete q.t; q.bar = true; q.hp = q.mhp = hpGate;
        F.gates[side].push([x, y]);
        const [dx, dy] = side === "north" ? [0, 1] : side === "south" ? [0, -1] : side === "west" ? [1, 0] : [-1, 0];
        const inn = at(x + dx, y + dy); if (inn) { inn.k = "open"; inn.f = "dirt"; delete inn.h; }
        const outC = at(x - dx, y - dy); if (outC && outC.k !== "open") { outC.k = "open"; }
      }
    }
    const ladderAt = (x, y) => { const q = at(x, y); if (q && q.k === "open" && !used[y * W + x]) { q.k = "ladder"; F.ladders.push([x, y]); } };
    for (let x = F.x0 + 2; x < F.x0 + F.yw - 2; x += 7) { ladderAt(x, F.y0); ladderAt(x, F.y0 + F.yh - 1); }
    for (let y = F.y0 + 2; y < F.y0 + F.yh - 2; y += 7) { ladderAt(F.x0, y); ladderAt(F.x0 + F.yw - 1, y); }
  }
  for (let y = w.y0; y <= w.y1; y++) for (let x = w.x0; x <= w.x1; x++) if (inside(x, y) && (x === w.x0 || x === w.x1 || y === w.y0 || y === w.y1 || x === w.x0 + 1 || x === w.x1 - 1 || y === w.y0 + 1 || y === w.y1 - 1)) keep[y * W + x] = 1;
  // The guard towers (buildings.js guard_towers): two more towers on the walkway, a quarter of the way along the north
  // side and three quarters along the south.
  if (walled && count(base, "guard_towers")) {
    const q = Math.max(2, Math.round((w.x1 - w.x0) / 4));
    for (const [x, y] of [[w.x0 + q, w.y0 + 1], [w.x1 - q, w.y1 - 1]]) { const t = at(x, y); if (t && t.k === "walkway") { t.k = "tower"; t.h = 2; F.towers.push([x, y]); } }
  }
  // The wire (buildings.js barbed_wire, razor_wire): rings round the band FORT.WIRE cells out for each barbed wire fence
  // and FORT.RAZOR for the concertina wire, with a gap in front of every gate; wireOut: the outermost ring (the
  // attackers start beyond it: fort.js fortDefence).
  F.wireOut = 0;
  const gateLane = (x, y) => Object.entries(F.gates).some(([s, g]) => g.some(([gx, gy]) => (s === "north" || s === "south" ? Math.abs(gx - x) <= 1 && x >= w.x0 && x <= w.x1 : Math.abs(gy - y) <= 1 && y >= w.y0 && y <= w.y1)));
  const ringAt = (d, razor) => {
    for (let y = w.y0 - d; y <= w.y1 + d; y++) for (let x = w.x0 - d; x <= w.x1 + d; x++) {
      if (x !== w.x0 - d && x !== w.x1 + d && y !== w.y0 - d && y !== w.y1 + d) continue;
      if (gateLane(x, y)) continue;
      const q = at(x, y);
      if (!q || q.k !== "open" || used[y * W + x]) continue;
      q.k = "wire";
      if (razor) q.razor = true;
      keep[y * W + x] = 1;
    }
    F.wireOut = Math.max(F.wireOut, d);
  };
  for (let i = 0; i < Math.min(FORT.WIRE.length, count(base, "barbed_wire")); i++) ringAt(FORT.WIRE[i], false);
  if (count(base, "razor_wire")) ringAt(FORT.RAZOR, true);
  // The masks: inside the ring (the walkway and the yard).
  const insideM = new Uint8Array(W * H);
  for (let y = w.y0 + 1; y <= w.y1 - 1; y++) for (let x = w.x0 + 1; x <= w.x1 - 1; x++) if (inside(x, y)) insideM[y * W + x] = 1;
  F.inside = insideM;
  // Cover: a little in the yard (crates, barrels, hay on the open dirt, never in a buffer or by the wall), rocks and
  // trees over the open ground beyond (not within 2 cells of the band).
  const nearBand = (x, y) => x >= w.x0 - 2 && x <= w.x1 + 2 && y >= w.y0 - 2 && y <= w.y1 + 2 && !(x > w.x0 + 1 && x < w.x1 - 1 && y > w.y0 + 1 && y < w.y1 - 1);
  const keepOut = (x, y) => !!keep[y * W + x] || !!used[y * W + x] || nearBand(x, y);
  densify(cells, W, H, rng, { target: 0.45, keep: (x, y) => keepOut(x, y) || !insideM[y * W + x], props: (f) => (f === "dirt" ? ["crate", "barrel", "hay", "crate"] : f === "field" ? ["hay"] : null) });
  const nCover = Math.round(0.035 * Math.max(0, W * H - (w.x1 - w.x0 + 5) * (w.y1 - w.y0 + 5)));
  for (let i = 0; i < nCover; i++) {
    const x = rng.int(0, W - 1), y = rng.int(0, H - 1);
    if (insideM[y * W + x] || keepOut(x, y)) continue;
    const q = at(x, y);
    if (q && q.k === "open") q.k = rng.chance(0.6) ? "rock" : rng.chance(0.5) ? "tree" : "boulder";
  }
  densify(cells, W, H, rng, { target: COVER.OPEN, keep: (x, y) => !!insideM[y * W + x] || keepOut(x, y) });
  // Land mines (mines.js, the main base's Minefield): buried in the open ground FORT.MINES cells out from the band, off
  // the lanes to the gates, after the cover (nothing stands on one); the attackers start beyond them.
  F.minesLaid = 0;
  if (count(base, "minefield")) {
    const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.max(w.x0 - x, x - w.x1, w.y0 - y, y - w.y1);
      if (d >= FORT.MINES[0] && d <= FORT.MINES[1] && !gateLane(x, y) && cells[y * W + x].k === "open" && !used[y * W + x]) cand.push([x, y]);
    }
    F.minesLaid = layMines(null, base, cells, cand, rng, W);
    if (F.minesLaid) F.wireOut = Math.max(F.wireOut, FORT.MINES[1]);
  }
  return F;
}
// The battle map's size without building it (combat.js battleSize).
export function baseMapSize(state, base, opts = {}) {
  stampGrid(state, base);
  const F = buildBaseMap(state, base, new Rng(1), opts);
  return [F.W, F.H];
}

// ---------- the stores on the map ----------
// What lies outside (basestorage.js storageOf: the goods past the base's room), as it goes on the map: whole units of
// the supplies (a stack of 12.5 with 3.5 outside: 3 on the pile, the 9 that fit inside), the armory indices of the
// items, and their weight. null when nothing whole lies out.
export function outsideOf(state, base) {
  if (!base) return null;
  const st = storageOf(state, base);
  const sup = {}, gear = [];
  let kg = 0;
  for (const [k, q] of Object.entries(st.outside.sup)) {
    const n = Math.min(Math.floor((base.stock && base.stock[k]) || 0), Math.floor(q + 1e-6));
    if (n > 0) { sup[k] = n; kg += n * kgOf(k); }
  }
  for (const i of st.outside.gear) { const it = base.armory && base.armory[i]; if (it) { gear.push(i); kg += itemKg(it); } }
  return gear.length || Object.keys(sup).length ? { sup, gear, kg } : null;
}
// The piles of what lies outside, laid on the map (buildBaseMap, before the cover): crates stacked on the open ground
// of the yard as near the middle as there is room, every cell of a pile free (never on a footprint, a buffer round
// one, a doorway or the band) and open ground all round it (walkable, nothing to batter: no door). One a PILE.KG of
// what lies out, at most PILE.MAX; a yard too full for one puts it on the open ground beyond the band, and with no room
// at all the goods stay in the real containers (makeStores).
function layPiles(state, base, F, m) {
  const out = outsideOf(state, base);
  if (!out) return;
  const { C, G, inside, used, keep } = m, { cells, W, ox, oy } = F;
  const n = Math.max(1, Math.min(PILE.MAX, Math.ceil(out.kg / PILE.KG)));
  const pw = PILE.W, ph = PILE.H;
  const free = (x, y) => inside(x, y) && !used[y * W + x] && !keep[y * W + x] && cells[y * W + x].k === "open";
  const clear = (x, y) => inside(x, y) && !used[y * W + x] && cells[y * W + x].k === "open";
  const fits = (gx, gy) => {
    for (let y = gy - 1; y <= gy + ph; y++) for (let x = gx - 1; x <= gx + pw; x++) {
      if (onBand(x, y, C)) return false;
      const inR = x >= gx && x < gx + pw && y >= gy && y < gy + ph;
      if (inR ? !free(x + ox, y + oy) : !clear(x + ox, y + oy)) return false;
    }
    return true;
  };
  let laid = 0;
  for (let d = 0; d <= G && laid < n; d++) {
    for (let gy = -d; gy <= d && laid < n; gy++) for (let gx = -d; gx <= d && laid < n; gx++) {
      if (Math.max(Math.abs(gx), Math.abs(gy)) !== d || !fits(gx, gy)) continue;
      const mx = gx + ox, my = gy + oy;
      for (let y = my - 1; y <= my + ph; y++) for (let x = mx - 1; x <= mx + pw; x++) if (inside(x, y)) keep[y * W + x] = 1;
      for (let y = my; y < my + ph; y++) for (let x = mx; x < mx + pw; x++) { const c = cells[y * W + x]; c.k = "crate"; c.v = (x + y) % 2 ? 1 : 2; c.pile = true; used[y * W + x] = 1; }
      laid++;
      F.stores.push({ id: F.stores.length + 1, label: n > 1 ? `${PILE.LABEL} ${laid}` : PILE.LABEL, x: mx, y: my, w: pw, h: ph, weight: 0, bid: null, pile: true, room: 0 });
    }
  }
}
// The base's stock and armory spread over its containers (F.stores): what lies outside (outsideOf) on the piles, the
// rest over the real containers (the base itself, the storage buildings, the cars that are storage), supplies by whole
// units, the armory's items one by one, each container taking a share by its room (food leans to the cellars, the cold
// store, the freezer and the storehouse, gear to the core and the storehouse; with no room at all, by the STORES
// weights). Nothing leaves the base's records: a container holds counts and armory indexes, and only what a raider gets
// away with is taken from the base when the fight ends (settleBaseBattle, applyStolen). Deterministic (only rng).
export function makeStores(state, base, F, rng) {
  if (!F.stores.length) return null;
  const boxes = F.stores.map((s) => ({ ...s, sup: {}, gear: [] }));
  const piles = boxes.filter((b) => b.pile), real = boxes.filter((b) => !b.pile);
  const out = (piles.length && outsideOf(state, base)) || { sup: {}, gear: [] };
  const roomTot = real.reduce((a, b) => a + (b.room || 0), 0);
  const wOf = (b) => (roomTot > 0 ? b.room || 0 : b.weight || 1);
  const split = (q, weights) => {
    const tot = weights.reduce((a, v) => a + v, 0) || 1;
    const res = weights.map((v) => Math.floor((q * v) / tot));
    const left = q - res.reduce((a, v) => a + v, 0);
    if (left > 0) res[weights.indexOf(Math.max(...weights))] += left;
    return res;
  };
  for (const [k, q0] of Object.entries(base.stock)) {
    const q = Math.floor(q0 || 0);
    if (!(q > 0)) continue;
    const inN = real.length ? q - Math.min(q, out.sup[k] || 0) : 0;
    if (inN > 0) {
      const food = !!FOODS[k];
      const weights = real.map((b) => wOf(b) * (food && ["cellar", "coldstore", "freezer", "storehouse"].includes(typeOfStore(base, b)) ? 2 : 1) * rng.range(0.7, 1.3));
      split(inN, weights).forEach((n, i) => { if (n > 0) real[i].sup[k] = n; });
    }
    if (q - inN > 0) split(q - inN, piles.map(() => 1)).forEach((n, i) => { if (n > 0) piles[i].sup[k] = n; });
  }
  const outside = new Set(out.gear);
  let pi = 0;
  base.armory.forEach((it, i) => {
    if (!it) return;
    const g = { ai: i, key: it.key, name: it.name, kg: itemKg(it) };
    if (piles.length && (outside.has(i) || !real.length)) { piles[pi++ % piles.length].gear.push(g); return; }
    const weights = real.map((b) => wOf(b) * (["core", "storehouse", "warehouse"].includes(typeOfStore(base, b)) ? 2 : 1));
    const tot = weights.reduce((a, v) => a + v, 0);
    let pick = rng.range(0, tot), j = 0;
    while (j < weights.length - 1 && pick > weights[j]) { pick -= weights[j]; j++; }
    real[j].gear.push(g);
  });
  for (const b of boxes) b.kg = Object.entries(b.sup).reduce((a, [k, n]) => a + n * kgOf(k), 0) + b.gear.reduce((a, g) => a + g.kg, 0);
  return { containers: boxes }; // plain data: a save mid-battle keeps it
}
// A unit of a supply, in kg (the loot's weight).
const kgOf = (k) => (SUPPLIES[k] ? SUPPLIES[k].weight : FOODS[k] ? FOODS[k].kg : STEAL.DEFAULT_KG);
const typeOfStore = (base, s) => (s.pile ? "pile" : s.vid != null ? "vehicle" : s.bid == null ? "core" : (base.buildings.find((b) => b.id === s.bid) || {}).type || "core");
// The container at a cell of the battle (ui/combat.js hover and click), or null.
export const storeAt = (b, x, y) => (b.stores ? b.stores.containers.find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) || null : null);
// What is in a container, for the panel: [[name, qty], …] supplies first, then the gear.
export function storeContents(c) {
  const sup = Object.entries(c.sup).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => [SUPPLIES[k] ? SUPPLIES[k].name : FOODS[k] ? FOODS[k].name : k, n]);
  return { sup, gear: c.gear.map((g) => g.name), kg: Math.round(c.kg || 0) };
}

// ---------- raiders stealing (combat.js aiUnit) ----------
// Who among a raid's people goes for the stores (set when the units are placed: fort.js), and a thief's turn. Returns
// true when the turn was spent here.
export function markThieves(b, rng) {
  for (const u of b.units) if (u.side === "enemy" && u.kind === "human" && !u.boss && rng.chance(STEAL.SHARE)) u.thief = true;
}
const TAKE_ORDER = ["meds", "parts", "electronics", "gunparts", "carparts", "fuel", "ammo", "arrows", "scrap", "jars", "wood"];
export function thiefTurn(b, u) {
  const T = b.tier;
  if (!b.stores || !u.thief || !T || (T.walled && T.stage === "wall") || !active(u)) return false;
  const W = b.w, H = b.h;
  if (u.loot && (u.loot.kg >= STEAL.KG || u.loot.full)) return leaveWithLoot(b, u);
  const foes = foesOf(b, u);
  if (foes.some((f) => Math.max(Math.abs(f.x - u.x), Math.abs(f.y - u.y)) <= 1)) return false; // someone right there: fight
  const boxes = b.stores.containers.filter((c) => c.kg > 0.5);
  if (!boxes.length) return u.loot ? leaveWithLoot(b, u) : false;
  // A pile left outside first (no lid, no lock, no door to batter): the nearest one with goods; the rest once the
  // piles are bare. Whatever container is right there is taken from all the same.
  const piles = boxes.filter((c) => c.pile);
  const goal = piles.length ? piles : boxes;
  const near = (list) => list.find((c) => nearRect(c, u.x, u.y));
  const here = near(goal) || near(boxes);
  if (here) { takeLoot(b, u, here); u.ap = 0; return true; }
  // On toward the nearest one: the cells round every container with goods (the piles while there are any).
  const targets = [];
  for (const c of goal) for (let y = c.y - 1; y <= c.y + c.h; y++) for (let x = c.x - 1; x <= c.x + c.w; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if ((x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) || !CELL[b.cells[y * W + x].k].walk) continue;
    targets.push([x, y]);
  }
  if (!targets.length) return false;
  const field = distField(b, targets, u);
  let moved = false;
  while (u.ap > 0 && active(u)) {
    const r = reachable(b, u, u.mob);
    const hereD = field[u.y * W + u.x];
    let best = -1, bestV = Infinity;
    for (let i = 0; i < W * H; i++) {
      if (!isFinite(r.dist[i]) || r.dist[i] <= 0 || !isFinite(field[i]) || unitAt(b, i % W, (i / W) | 0)) continue;
      if (field[i] < bestV) { bestV = field[i]; best = i; }
    }
    if (best >= 0 && bestV < hereD) {
      u.ap -= 1; moved = true;
      moveAlong(b, u, pathTo(r, best % W, (best / W) | 0));
      const box = near(goal) || near(boxes);
      if (box && u.ap > 0) { takeLoot(b, u, box); u.ap = 0; }
      continue;
    }
    // No way nearer: a barred door or a wall in the way is battered.
    const wall = siegeTarget(b, u, field);
    if (wall) { bash(b, u, wall[0], wall[1]); u.ap = 0; return true; }
    break;
  }
  return moved;
}
// A raider fills up from a container: the gear first, then supplies dear by the kilo (meds, parts, fuel, rounds, then
// the food, scrap and firewood last; never water), up to STEAL.KG in all and STEAL.TURN a turn (a heavy item alone may
// take the turn), twice that from a pile left outside (STEAL.PILE). Nothing worth the weight left to take: off with
// what it has (u.loot.full).
export function takeLoot(b, u, box) {
  u.loot = u.loot || { sup: {}, gear: [], kg: 0 };
  const carry = STEAL.KG - u.loot.kg;
  let room = Math.min(carry, STEAL.TURN * (box.pile ? STEAL.PILE : 1));
  const got = [];
  for (const g of box.gear.slice()) {
    if (g.kg > room && !(got.length === 0 && g.kg <= carry)) continue;
    box.gear.splice(box.gear.indexOf(g), 1);
    u.loot.gear.push(g); u.loot.kg += g.kg; room = Math.max(0, room - g.kg); box.kg -= g.kg;
    got.push(g.name);
  }
  const keys = Object.keys(box.sup).filter((k) => box.sup[k] > 0 && k !== "water" && k !== "rawwater");
  const rank = (k) => { const i = TAKE_ORDER.indexOf(k); return i >= 0 ? i : FOODS[k] ? 5.5 - Math.min(0.4, FOODS[k].kcal / (FOODS[k].kg * 10000)) : SUPPLIES[k] && SUPPLIES[k].cat === "ammo" ? 6 : 8; };
  keys.sort((a, c) => rank(a) - rank(c));
  for (const k of keys) {
    const kg = Math.max(0.01, kgOf(k));
    const n = Math.min(box.sup[k], Math.floor(room / kg));
    if (n <= 0) continue;
    box.sup[k] -= n; if (box.sup[k] <= 0) delete box.sup[k];
    u.loot.sup[k] = (u.loot.sup[k] || 0) + n; u.loot.kg += n * kg; room -= n * kg; box.kg -= n * kg;
    got.push(`${n} ${SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : FOODS[k] ? FOODS[k].word : k}`);
  }
  if (got.length) say(b, `${u.name} grabs ${got.slice(0, 3).join(", ")}${got.length > 3 ? " and more" : ""} from the ${box.label.toLowerCase()}.`, "danger");
  else if (u.loot.kg > 0) { u.loot.full = true; say(b, `${u.name} rifles through the ${box.label.toLowerCase()} and makes off with what they have.`, "info"); }
  else say(b, `${u.name} rifles through the ${box.label.toLowerCase()} and finds nothing worth the weight.`, "info");
}
// Off the map with the loot: toward the nearest edge, gone once it is reached.
function leaveWithLoot(b, u) {
  const W = b.w, H = b.h;
  const edge = (x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1;
  if (edge(u.x, u.y)) { u.fled = true; u.ap = 0; say(b, `${u.name} slips away with the loot.`, "danger"); return true; }
  const exits = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (edge(x, y) && CELL[b.cells[y * W + x].k].walk) exits.push([x, y]);
  const field = distField(b, exits, u);
  let moved = false;
  while (u.ap > 0 && active(u)) {
    const r = reachable(b, u, u.mob);
    let best = -1, bestV = Infinity;
    for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && isFinite(field[i]) && field[i] < bestV && !unitAt(b, i % W, (i / W) | 0)) { bestV = field[i]; best = i; }
    if (best < 0 || !(bestV < field[u.y * W + u.x])) { const wall = siegeTarget(b, u, field); if (wall) { bash(b, u, wall[0], wall[1]); u.ap = 0; return true; } break; }
    u.ap -= 1; moved = true;
    moveAlong(b, u, pathTo(r, best % W, (best / W) | 0));
    if (edge(u.x, u.y)) { u.fled = true; u.ap = 0; say(b, `${u.name} slips away with the loot.`, "danger"); return true; }
  }
  if (!moved) u.ap = 0;
  return true;
}

// ---------- after the fight ----------
// What the battle on the base map leaves behind (combat.js finishCombat, before the handler): what the raiders who
// got away carried off (b.stolen), the parked cars' condition, the buildings' wear.
export function settleBaseBattle(state, b) {
  const F = b.deployPlan && b.deployPlan.fort;
  if (!F || !b.tier || b.tier.map !== "fort" || b.drill || b.layout) return;
  const base = state.bases.find((x) => x.id === b.tier.baseId) || null;
  // The loot that left with the raiders.
  const stolen = { sup: {}, gear: [], kg: 0 };
  for (const u of b.units) {
    if (!u.loot || !u.fled) continue;
    for (const [k, n] of Object.entries(u.loot.sup)) stolen.sup[k] = (stolen.sup[k] || 0) + n;
    stolen.gear.push(...u.loot.gear);
    stolen.kg += u.loot.kg;
  }
  b.stolen = stolen.kg > 0 ? stolen : null;
  if (!base) return;
  // The cars: condition lost for the hit points their cells lost; battered through, a wreck at 0.
  for (const v of F.vehicles) {
    const veh = state.vehicles.find((x) => x.id === v.id);
    if (!veh) continue;
    let lost = 0, n = 0, wrecked = false;
    for (let y = v.y0; y < v.y0 + v.h; y++) for (let x = v.x0; x < v.x0 + v.w; x++) {
      const c = b.cells[y * b.w + x];
      if (!c || !c.car) continue;
      n++;
      if (c.k === "truck") wrecked = true;
      if (c.mhp) lost += 1 - Math.max(0, c.hp) / c.mhp;
    }
    if (!n) continue;
    const drop = wrecked ? veh.condition : Math.round((lost / n) * MAP_WEAR.carCondition);
    if (drop > 0) { veh.condition = Math.max(0, veh.condition - drop); log(state, `${veh.name} at ${base.name} ${wrecked ? "was battered to a wreck in the fight" : `took ${drop} damage in the fight`}.`, "danger"); }
  }
  // The buildings battered: doors and windows broken in, wall sections breached, barricades battered through.
  const wearOn = (fx, n) => { if (!fx || !FIXTURES[fx.type] || n <= 0) return; fx.wear = Math.min(WEAR.breakAt, (fx.wear || 0) + n); if (fx.wear >= WEAR.breakAt && !fx.broken) breakFixture(state, base, fx, "battered in the fight", { card: false, quiet: true }); };
  for (const s of F.buildings) {
    if (s.bid == null) continue;
    const fx = base.buildings.find((x) => x.id === s.bid);
    let n = 0;
    for (const [x, y] of s.doors) if (b.cells[y * b.w + x].k === "doorway") n += MAP_WEAR.door;
    for (let y = s.y0; y < s.y0 + s.h; y++) for (let x = s.x0; x < s.x0 + s.w; x++) if (b.cells[y * b.w + x].k === "smashed") n += MAP_WEAR.window;
    wearOn(fx, n);
  }
  const breaches = F.ring.filter(([x, y]) => b.cells[y * b.w + x].k === "breach").length - (F.breaches ? F.breaches.length : 0);
  if (breaches > 0) { const walls = base.buildings.filter((x) => x.type === "walls"); if (walls.length) wearOn(walls[breaches % walls.length], MAP_WEAR.breach * breaches); }
  for (const e of layoutOf(state, base)) {
    if (!e.at || e.it.kind !== "defence" || e.it.k !== "barricade" || !e.it.rec) continue;
    const r = rectOf(e.it, e.at);
    let gone = 0;
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) { const c = b.cells[(y + F.oy) * b.w + x + F.ox]; if (c && c.k === "rubble") gone++; }
    if (gone) wearOn(e.it.rec, MAP_WEAR.barricade);
  }
}
// What the raiders carried off leaves the base's stock and armory (conflicts.js, after a raid beaten off on the map):
// returns { sup, gear (the items), text } for the raiders' group, or null.
export function applyStolen(state, base, stolen) {
  if (!stolen || !base) return null;
  const sup = {}, parts = [];
  for (const [k, n0] of Object.entries(stolen.sup)) {
    const n = Math.min(n0, Math.floor(base.stock[k] || 0));
    if (n <= 0) continue;
    takeStock(base, k, n);
    sup[k] = n;
    parts.push(`${n} ${SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : FOODS[k] ? FOODS[k].word : k}`);
  }
  // The items by their armory index (makeStores: a pile's, a car's or a building's alike); one no longer where it was
  // (the armory changed during the fight) is found again by its key.
  const taken = new Set();
  for (const g of stolen.gear) {
    const at = base.armory[g.ai];
    let i = at && !taken.has(g.ai) && (!g.key || at.key === g.key) ? g.ai : -1;
    if (i < 0 && g.key) i = base.armory.findIndex((it, j) => it && !taken.has(j) && it.key === g.key && (!g.name || it.name === g.name));
    if (i >= 0) taken.add(i);
  }
  const idx = [...taken].sort((a, c) => c - a);
  const gear = idx.map((i) => base.armory[i]);
  for (const i of idx) base.armory.splice(i, 1);
  for (const g of gear) parts.push(g.name);
  if (!parts.length) return null;
  const text = `They got away with ${parts.length > 4 ? `${parts.slice(0, 4).join(", ")} and more` : parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}.`;
  return { sup, gear, text };
}
// n of a supply out of a base's stock; a food's lots shrink with it (foods.js keeps them per key).
export function takeStock(base, k, n) {
  const have = base.stock[k] || 0;
  const q = Math.min(have, n);
  base.stock[k] = have - q;
  const L = base.foodLots && base.foodLots[k];
  if (L && have > 0) { const keep = (have - q) / have; for (const l of L) l.q *= keep; }
  return q;
}

// ---------- the Base map view (the Base map tab, Build) ----------
// Opens the base's map as a battle with nobody to fight, in layout mode: the queued buildings as outlines, every
// store's contents in view, and the picked item's footprint placed by a click (ui/combat.js layout mode). pick: the
// item to place first (a building just queued), or null.
export function openBaseMap(state, baseId, pick = null) {
  if (state.combat) return "Finish the battle first.";
  const base = state.bases.find((x) => x.id === baseId);
  if (!base) return "";
  const b = viewBattle(state, base);
  b.layout = { baseId: base.id, pick: pick && itemByKey(state, base, pick) ? pick : null, rot: 0, msg: "" };
  state.combat = b;
  return "";
}
function viewBattle(state, base, prev = null) {
  const setup = {
    mode: "battle", layout: "baseDefence", deploy: true, drill: true, baseId: base.id, canRetreat: false, handler: null,
    enemy: { kind: "zombies", count: 1, power: 1, types: { runner: 1 }, name: "nobody (the base map)" }, context: { baseId: base.id, drill: true, view: true, noPlan: true },
  };
  const b = createBattle(state, setup);
  b.units = b.units.filter((u) => u.side === "player");
  b.log = [];
  b.drill = true;
  b.phase = "deploy";
  b.acted = true;
  if (prev) { b.keepCam = true; b.layout = prev.layout; } // the same layout record: the pick and the last message carry over; keepCam: the view stays where it was (ui/isoview.js)
  return b;
}
// The view made again after a change (the map is laid out again; the camera stays: ui/isoview.js keepCam).
export function refreshBaseMap(state) {
  const b = state.combat;
  if (!b || !b.layout) return;
  const base = state.bases.find((x) => x.id === b.layout.baseId);
  if (!base) { state.combat = null; return; }
  state.combat = viewBattle(state, base, b);
}
// Map cell → grid cell in the view.
export const gridOfCell = (b, x, y) => { const F = b.deployPlan && b.deployPlan.fort; return F ? [x - F.ox, y - F.oy] : [x, y]; };
// The picked item's footprint over the hovered cell (centered on it): its map cells and whether it fits there.
export function ghostAt(state, b, x, y) {
  const L = b.layout, F = b.deployPlan && b.deployPlan.fort;
  if (!L || !L.pick || !F) return null;
  const base = state.bases.find((o) => o.id === L.baseId);
  const it = base && itemByKey(state, base, L.pick);
  if (!it) return null;
  const [w, h] = dimsOf(it, L.rot);
  const [gx, gy] = gridOfCell(b, x, y);
  const x0 = gx - Math.floor(w / 2), y0 = gy - Math.floor(h / 2);
  const why = placeProblemAt(base, it, x0, y0, L.rot, occupancy(state, base, L.pick, null));
  const cells = [];
  for (let yy = y0; yy < y0 + h; yy++) for (let xx = x0; xx < x0 + w; xx++) cells.push([xx + F.ox, yy + F.oy]);
  const doors = doorCellsOf(it, [x0, y0, L.rot]).map(([dx, dy]) => [dx + F.ox, dy + F.oy]);
  return { cells, doors, ok: !why, why, at: [x0, y0, L.rot] };
}
// The item whose footprint covers a map cell in the view (a click on a placed thing picks it up), or null.
export function itemAtCell(state, b, x, y) {
  const L = b.layout;
  if (!L) return null;
  const base = state.bases.find((o) => o.id === L.baseId);
  if (!base) return null;
  const [gx, gy] = gridOfCell(b, x, y);
  for (const e of layoutOf(state, base)) {
    if (!e.at) continue;
    const r = rectOf(e.it, e.at);
    if (gx >= r.x0 && gx < r.x0 + r.w && gy >= r.y0 && gy < r.y0 + r.h) return e;
  }
  return null;
}
// Layout mode's commands (combat.js combatAct via deploy.js): pick an item, turn it, put it down at a map cell, lift
// one off the map (back to the game's own spot), close the view. Returns an error, or "".
export function layoutAct(state, b, act) {
  const L = b.layout;
  if (!L) return "Not the base map.";
  const base = state.bases.find((o) => o.id === L.baseId);
  if (!base) { state.combat = null; return ""; }
  switch (act.type) {
    case "pick": L.pick = act.key && itemByKey(state, base, act.key) ? act.key : null; L.msg = ""; return "";
    case "rotate": L.rot = (L.rot + 1) & 3; return "";
    case "put": {
      if (!L.pick) return "Pick something to place first (the list on the right), or click a placed thing to move it.";
      const g = ghostAt(state, b, Number(act.x), Number(act.y));
      if (!g) return "Nothing picked.";
      if (!g.ok) return g.why;
      const err = placeItem(state, base, L.pick, g.at[0], g.at[1], g.at[2]);
      if (err) return err;
      const it = itemByKey(state, base, L.pick);
      L.msg = `${it ? it.label : "It"} placed.`;
      L.pick = null;
      refreshBaseMap(state);
      return "";
    }
    case "lift": {
      const it = itemByKey(state, base, act.key);
      if (!it) return "That is gone.";
      unplaceItem(state, base, act.key);
      L.pick = act.key;
      L.rot = it.at ? it.at[2] || 0 : 0;
      refreshBaseMap(state);
      state.combat.layout.msg = `${it.label} lifted: click where it goes (R turns it).`;
      return "";
    }
    case "unplace": {
      const it = itemByKey(state, base, act.key);
      if (!it) return "That is gone.";
      unplaceItem(state, base, act.key);
      if (L.pick === act.key) L.pick = null;
      refreshBaseMap(state);
      state.combat.layout.msg = `${it.label} is placed by the game again.`;
      return "";
    }
    case "endLayout": state.combat = null; return "";
    default: return "The base map: pick a building, field, defence or car and click where it goes.";
  }
}
// The Base map tab's lines (ui/basemap.js): the grid, the yard, the walls and what is placed.
export function baseMapSummary(state, base) {
  const G = gridHalf(base), C = yardHalf(base);
  const lay = layoutOf(state, base);
  const byHand = lay.filter((e) => !e.auto).length, off = lay.filter((e) => !e.at).length;
  const people = atBase(state, base.id).length;
  return { grid: 2 * G, yard: 2 * C, walled: count(base, "walls") > 0 && !isShelter(base), items: lay.length, byHand, off, people, tier: tierName(base) };
}
