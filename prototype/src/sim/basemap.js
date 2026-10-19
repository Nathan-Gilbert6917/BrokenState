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
//   The ring (ringHalf R: the yard's half-size when the first wall piece went up, base.plan.ring; the yard's own
//     before): the two cells round [-R, R) where the game lays the wall pieces and gates it places itself (the outer
//     line, ±(R + 1)) and the wall stands (the inner one, ±R). Nothing else goes on it; walls, gates and stands go
//     anywhere (the user's request 2026-10-19: walls placed and turned by hand, 1×1, 1×2, 1×4; gates 1×4; stands).
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
// The wall (wallInfo, buildBaseMap): the pieces placed, nothing else. The base is walled when they close round the
// base itself (with the houses: a house's walls and barred doors keep the dead out as well as a wall does); the
// attackers then start outside and the fight opens at the wall, otherwise in the yard (a gap anywhere is a way in).
// On the map: a building under construction (a queued job with a footprint) shows its outline (CELL "outline": stakes
// and string on open ground, walkable) in the Base map view only; when the base is raided the outlines are gone and
// the ground is open land. Every building keeps the 3D sprites of the battle map (ui/isoview.js): houses with barred
// doors and windows and an upper floor, flat-roofed stores, the props of the yard, fields, the wall ring.
// The stores (makeStores): the base's own stock and armory are what is on the map in a battle, spread over the
// buildings that hold goods (the core, the storehouse, cellars, the cold store, the freezer, the crates: STORES) as
// containers whose contents can be looked at by clicking them at any time (never "unknown" ones: ui/combat.js).
// Raiders steal from them (thiefTurn, combat.js aiUnit): a share of them (STEAL.SHARE) go for the nearest container
// with goods once the wall is passed, batter a door in the way, fill up to STEAL.KG and make for the nearest edge of the
// map; what a raider gets away with is gone from the stores when the fight ends (settleBaseBattle: b.stolen, applied by
// conflicts.js applyStolen); what a raider dropped (killed, taken down) stays yours. Hordes and raiders batter what
// stands in their way: doors, windows, walls, barricades and parked cars (combat.js bash); when the fight is over the
// buildings battered on the map wear as fixtures (breakdowns.js) and the cars lose condition (settleBaseBattle).
import { BUILDINGS, count, isCamp, isShelter, farmSlots, tierName, pieceName, pieceHp, matOf, WALL_TIERS, WALL_DAMAGED } from "./buildings.js";
import { CELL, placeCar, say, unitAt, active, distField, reachable, pathTo, moveAlong, bash, siegeTarget, foesOf, nearRect, createBattle, barredCell } from "./combat.js";
import { carsAtBase } from "./vehicles.js";
import { DEPLOY } from "./deploy.js"; // the reinforced gate's hit points (call-time only)
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
export const STEAL = { SHARE: 0.4, KG: 22, DEFAULT_KG: 1 };
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
  well: PROP("well"), rain_catcher: PROP("barrel"), water_barrel: PROP("barrel"), crates: PROP("crate", 1, 1, { v: 2 }), boiler: PROP("barrel"),
  cookhouse: PROP("firepit"), smoker: PROP("table", 2, 1), generator: PROP("pump", 2, 1), still: PROP("barrel"), sealer: PROP("table"), grainmill: PROP("table"),
  meatgrinder: PROP("table"), craftbench: PROP("counter", 2, 1), workbench: PROP("counter", 2, 1), toolbench: PROP("counter", 2, 1), ammo_bench: PROP("counter", 2, 1),
  reload_bench: PROP("counter", 2, 1), med_station: PROP("counter", 2, 1), lockup: PROP("bars", 2, 2), relay: PROP("locker"),
  animal_pen: { kind: "pen", w: 4, h: 3 },
  barricades: DEF("barricade", 3, 1), spike_pits: DEF("spikes", 3, 2), trench: DEF("trench", 16, 1), floodlights: DEF("lamp", 1, 1), watchtower: DEF("tower", 2, 2),
  sandbag_wall: DEF("sandbag", 4, 1), // the Defenses tab's sandbag positions: 4 cells, placed like a barricade
  // The wall pieces (buildings.js piece): a line of wall cells, a 1×4 gate, a raised wall stand; turned by R.
  wall1: { kind: "wall", w: 1, h: 1 }, wall2: { kind: "wall", w: 2, h: 1 }, wall4: { kind: "wall", w: 4, h: 1 }, gate4: { kind: "gate", w: 4, h: 1 },
  stand1: { kind: "stand", w: 1, h: 1 }, stand2: { kind: "stand", w: 2, h: 1 }, stand4: { kind: "stand", w: 4, h: 1 },
  // Not placed (laid round the wall by the map itself: the wire rings, the guard towers on the walkway, the minefield
  // in the open ground): barbed_wire, razor_wire, guard_towers, minefield.
};
export const FIELD = { kind: "field", w: 3, h: 2 };
// What holds the base's goods on the map (makeStores): a weight for the share of the stores each takes.
const STORES = { storehouse: 3, cellar: 2, coldstore: 2, freezer: 2, crates: 1 };
const BUILD_KINDS = new Set(["house", "roof", "prop", "pen", "field", "vehicle"]); // the kinds the yard grows for (footCount) and the cover props keep off
export const WALL_KINDS = new Set(["wall", "gate", "stand"]); // the wall pieces: anywhere, the ring too
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
const grows = (type) => !!FOOT[type] && FOOT[type].kind !== "defence" && !WALL_KINDS.has(FOOT[type].kind);
const footCount = (base) => base.buildings.filter((b) => grows(b.type)).length + base.construction.filter((c) => !c.target && grows(c.type)).length;
// The yard's half-size: by tier and buildings, and never smaller than what is placed inside it needs.
export function yardHalf(base) {
  const g = gridOf(base);
  let C = Math.min(g.cap, g.yard + g.per * footCount(base));
  // Nothing placed stands under the wall ring: a thing the band would cut through (placed inside while the yard was
  // bigger, or just outside before the yard grew) pulls the yard out over it, up to the cap; a thing well beyond the
  // band stays outside the wall.
  for (let grown = !(base.plan && base.plan.ring != null); grown && C < g.cap;) { // once the ring is pegged out it stays where it is
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
export const gridHalf = (base) => Math.min(GRID_MAX, Math.max(yardHalf(base), ringHalf(base)) + 2 + gridOf(base).out);
// The ring the game lays the wall on (R): pegged out at the yard's edge when the first piece goes up (ensureRing), so
// the pieces it placed stay put as the yard grows (Widen the wall: widenRing); the yard's own edge before that.
export const ringHalf = (base) => (base && base.plan && base.plan.ring != null ? base.plan.ring : yardHalf(base));
export function ensureRing(base) { const P = planOf(base); if (P.ring == null) P.ring = yardHalf(base); return P.ring; }
// The yard has grown past the ring: the ring out to the yard's edge (the game's pieces move out with it; the gaps
// they leave want more pieces: Ring wall). Returns a message.
export function widenRing(base) {
  const C = yardHalf(base), R = ringHalf(base);
  if (C <= R) return "The wall already runs round the whole yard.";
  planOf(base).ring = C;
  return `The ring is pegged out ${C - R} cells further out, round the whole yard: the wall pieces the game places move out to it (close the gaps with Ring wall).`;
}
export const gridSize = (base) => gridHalf(base) * 2;
const inYard = (x, y, C) => x >= -C && x < C && y >= -C && y < C;
const onBand = (x, y, R) => !inYard(x, y, R) && inYard(x, y, R + 2);

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
    out.push({ key: `b:${b.id}`, type: b.type, ...f, label: WALL_KINDS.has(f.kind) ? `${pieceName(b)} ${n(pieceName(b))}` : label(b.type, n(b.type)), at: b.at || null, rec: b, built: true, ...(b.mat ? { mat: b.mat } : {}) });
  }
  for (const c of base.construction) {
    const f = FOOT[c.type];
    if (!f || c.target) continue; // an upgrade in place keeps the standing building's spot
    out.push({ key: `c:${c.id}`, type: c.type, ...f, label: `${WALL_KINDS.has(f.kind) ? pieceName(c) : label(c.type, 0)} (building)`, at: c.at || null, rec: c, built: false, ...(c.mat ? { mat: c.mat } : {}) });
  }
  const plots = planOf(base).plots;
  for (let i = 0; i < farmSlots(base); i++) out.push({ key: `p:${i}`, type: "plot", ...FIELD, label: `Crop plot ${i + 1}`, at: plots[i] || null, built: true });
  if (state) for (const v of carsAtBase(state, base.id)) {
    const L = v.type === "truck" || v.type === "miltruck" ? 4 : 3;
    out.push({ key: `v:${v.id}`, type: "vehicle", kind: "vehicle", w: L, h: 2, label: v.name, at: v.at || null, rec: v, built: true, veh: v });
  }
  return out;
}
// Only what is placed by hand (sizes: yardHalf).
function placedItems(base) {
  const out = [];
  for (const b of base.buildings) if (FOOT[b.type] && b.at && !WALL_KINDS.has(FOOT[b.type].kind)) out.push({ ...FOOT[b.type], at: b.at });
  for (const c of base.construction) if (FOOT[c.type] && !c.target && c.at && !WALL_KINDS.has(FOOT[c.type].kind)) out.push({ ...FOOT[c.type], at: c.at });
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
// A wall piece's cells (r = 0: the piece runs east–west): wall cells people shoot over from higher up (t 1), gate
// cells (barred to the attackers; the cells either side kept open as a door's are), stand cells a level up with a
// ladder (climb). Hit points and the material are the piece's own (buildBaseMap).
function pieceCells(f) {
  const out = [];
  for (let x = 0; x < f.w; x++) {
    if (f.kind === "wall") out.push({ dx: x, dy: 0, k: "palisade", f: "dirt", t: 1 });
    else if (f.kind === "gate") out.push({ dx: x, dy: 0, k: "gate", f: "dirt", out: [x, -1], out2: [x, 1] });
    else out.push({ dx: x, dy: 0, k: "stand", f: "dirt", h: 1 });
  }
  return out;
}
// The cells of a footprint at r = 0, by kind.
function localCells(f) {
  if (f.kind === "house") return houseCells(f);
  if (f.kind === "roof") return roofCells(f);
  if (f.kind === "pen") return penCells(f);
  if (f.kind === "field") { const out = []; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) out.push({ dx: x, dy: y, k: "open", f: "field" }); return out; }
  if (f.kind === "vehicle") return []; // placeCar lays a car
  if (WALL_KINDS.has(f.kind)) return pieceCells(f);
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
    if (c.out2) { const [ox, oy] = turn(c.out2[0], c.out2[1], it.w, it.h, r); o.out2 = [at[0] + ox, at[1] + oy]; }
    if (c.ladder) { const [lx, ly] = turn(c.ladder[0], c.ladder[1], it.w, it.h, r); o.ladder = [at[0] + lx, at[1] + ly]; }
    return o;
  });
}
// The cells outside an item's doors.
export const doorCellsOf = (it, at) => cellsOf(it, at).flatMap((c) => [c.out, c.out2]).filter(Boolean);

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
export function placeProblemAt(base, it, x, y, r, occ, dims = null) { // dims: { G, R } worked out once (autoLayout)
  const at = [x, y, r & 3];
  const rect = rectOf(it, at);
  const G = dims ? dims.G : gridHalf(base), R = dims ? dims.R : ringHalf(base), wallish = WALL_KINDS.has(it.kind);
  if (rect.x0 < -G || rect.y0 < -G || rect.x0 + rect.w > G || rect.y0 + rect.h > G) return "Off the map";
  for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) {
    const k = K(xx, yy);
    if (!wallish && onBand(xx, yy, R)) return "That is where the wall stands";
    if (occ.foot.has(k)) return `On top of ${nameOf(occ.foot.get(k))}`;
    if (occ.door.has(k)) return `In the doorway of ${nameOf(occ.door.get(k))}`;
  }
  for (const [ox, oy] of doorCellsOf(it, at)) {
    const k = K(ox, oy);
    if (occ.foot.has(k)) return `Its door would open onto ${nameOf(occ.foot.get(k))}`;
    if (!wallish && onBand(ox, oy, R)) return "Its door would open onto the wall";
  }
  return "";
}
const nameOf = (key) => (key === "core" ? "the base itself" : key.startsWith("p:") ? "a crop plot" : key.startsWith("v:") ? "a parked car" : key.startsWith("c:") ? "a building going up" : key.startsWith("w:") ? "the wall" : "a building");
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
  const key = `${base.id}|${layoutSeed(base)}|${yardHalf(base)}|${ringHalf(base)}|${except || ""}|${sig}`;
  let out = autoCache.get(key);
  if (out) return out;
  out = new Map();
  const rng = new Rng(layoutSeed(base) ^ 0x5bd1e995);
  const C = yardHalf(base), G = gridHalf(base), R = ringHalf(base);
  const occ = occupancy(state, base, except, null);
  const take = (it, at) => {
    out.set(it.key, at);
    const r = rectOf(it, at);
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) occ.foot.set(K(x, y), it.key);
    for (const [x, y] of doorCellsOf(it, at)) if (!occ.door.has(K(x, y))) occ.door.set(K(x, y), it.key);
  };
  const dims = { G, R };
  const fits = (it, x, y, r) => !placeProblemAt(base, it, x, y, r, occ, dims);
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
    const edge = Math.min(C, R) - 2, out = R + 3; // inside the wall's ring, and in front of it
    if (k === "barricade") for (let i = 0; i < 12; i++) spots.push([rng.int(-edge + 1, edge - 4), rng.pick([-edge + 1, edge - 2, rng.int(-edge + 1, edge - 2)]), 0], [rng.pick([-edge + 1, edge - 2]), rng.int(-edge + 1, edge - 4), 1]);
    else if (k === "lamp") spots.push([edge, edge], [-edge, -edge], [edge, -edge], [-edge, edge]);
    else if (k === "tower") spots.push([edge - 1, edge - 1], [-edge, -edge], [edge - 1, -edge], [-edge, edge - 1]);
    else if (k === "spikes") spots.push([-1, out, 0], [-1, -out - 1, 0], [out, -1, 1], [-out - 1, -1, 1], [5, out, 0], [-7, out, 0], [5, -out - 1, 0], [-7, -out - 1, 0]);
    else if (k === "trench") spots.push([-5, out + 2, 0], [out + 2, -5, 1], [-5, -out - 3, 0], [-out - 3, -5, 1]);
    for (const s of spots) if (s[0] >= -G && s[1] >= -G && fits(it, s[0], s[1], s[2] || 0)) return [s[0], s[1], s[2] || 0];
    return spiral(it, [0, 1]);
  };
  // The wall pieces the game places (no dice): the gates in the middle of the ring's sides, then the walls round it from
  // the north-west corner, longest first, each in the first run of the ring it fits (ringPlan counts the same way);
  // the stands on the inner line, nearest the middle of a side first (by the gates).
  const outer = ringSides(R), inner = ringSides(R, true);
  // from: where to start in the order (the walls of a length resume after the last one placed: nothing before it has
  // room for one, and only fills up). Returns [at, index] or null.
  const fitFirst = (it, sides, order, from = 0) => { for (let k = from; k < order.length; k++) { const [si, i] = order[k]; const sd = sides[si]; if (i < 0 || i + it.w > sd.cells.length) continue; const at = alongAt(sd, i); if (fits(it, at[0], at[1], at[2])) return [at, k]; } return null; };
  const runOrder = (sides) => sides.flatMap((sd, si) => sd.cells.map((_, i) => [si, i]));
  const autoWall = items.filter((it) => !it.at && it.key !== except && WALL_KINDS.has(it.kind));
  const outerOrder = runOrder(outer), resume = {};
  const gateOrder = outerOrder.filter(([si, i]) => gateSpot(outer[si], i, 4));
  for (const it of autoWall.filter((q) => q.kind === "gate")) { const f = fitFirst(it, outer, outer.map((sd, si) => [si, Math.floor((sd.cells.length - it.w) / 2)])) || fitFirst(it, outer, gateOrder); if (f) take(it, f[0]); }
  for (const it of autoWall.filter((q) => q.kind === "wall").sort((a, c) => c.w - a.w)) { const f = fitFirst(it, outer, outerOrder, resume[it.w] || 0); resume[it.w] = f ? f[1] : outerOrder.length; if (f) take(it, f[0]); }
  const standOrder = {};
  for (const it of autoWall.filter((q) => q.kind === "stand").sort((a, c) => c.w - a.w)) {
    const order = standOrder[it.w] || (standOrder[it.w] = runOrder(inner).sort(([sa, ia], [sb, ib]) => Math.abs(ia + it.w / 2 - inner[sa].cells.length / 2) - Math.abs(ib + it.w / 2 - inner[sb].cells.length / 2) || sa - sb));
    const f = fitFirst(it, inner, order, resume[`s${it.w}`] || 0); resume[`s${it.w}`] = f ? f[1] : order.length; if (f) take(it, f[0]);
  }
  for (const it of items) {
    if (it.key === except) continue;
    if (it.at || WALL_KINDS.has(it.kind)) continue;
    const at = it.kind === "defence" ? defSpots(it) : spiral(it, it.kind === "field" || it.kind === "vehicle" ? [0, 1] : [0]);
    if (at) take(it, at);
  }
  if (autoCache.size > 300) autoCache.clear();
  autoCache.set(key, out);
  return out;
}
// ---------- the ring and the wall ----------
// The ring round the yard (R: ringHalf): the outer line where the game lays walls and gates (the old wall ring's), the
// inner one where it lays the stands (the old walkway's). Each side: its cells in order and how a piece lies along it
// (north and south take the corners).
export function ringSides(R, inner = false) {
  const lo = inner ? -R - 1 : -R - 2, hi = inner ? R : R + 1;
  const run = (n, f) => Array.from({ length: Math.max(0, n) }, (_, i) => f(i));
  return [
    { side: "north", horiz: true, cells: run(hi - lo + 1, (i) => [lo + i, lo]) },
    { side: "east", horiz: false, cells: run(hi - lo - 1, (i) => [hi, lo + 1 + i]) },
    { side: "south", horiz: true, cells: run(hi - lo + 1, (i) => [lo + i, hi]) },
    { side: "west", horiz: false, cells: run(hi - lo - 1, (i) => [lo, lo + 1 + i]) },
  ];
}
const alongAt = (sd, i) => [sd.cells[i][0], sd.cells[i][1], sd.horiz ? 0 : 1]; // a piece from cell i, lying along the side
// A gate never takes a corner of the ring: the cell kept open inside it would be the next side's wall.
const gateSpot = (sd, i, w) => !(sd.horiz && (i === 0 || i + w >= sd.cells.length));
// What it takes to close the ring round the yard, given everything placed and going up: a gate in the middle of each
// side that has none (where one fits), then each open run of the ring in 1×4s, a 1×2 and a 1×1 as it comes out (the
// game lays them that way: autoLayout). { pieces (types, gates first), open (cells of the ring still open) }.
export function ringPlan(state, base) {
  stampGrid(state, base);
  const R = ringHalf(base), G = gridHalf(base);
  const auto = autoLayout(state, base);
  const occ = occupancy(state, base, null, auto);
  const free = (x, y) => x >= -G && y >= -G && x < G && y < G && !occ.foot.has(K(x, y)) && !occ.door.has(K(x, y));
  const gates = itemsOf(state, base).filter((it) => it.kind === "gate").map((it) => it.at || auto.get(it.key)).filter(Boolean).map((at) => rectOf(FOOT.gate4, at));
  const gateIt = { ...FOOT.gate4, type: "gate4" };
  const out = { gate4: 0, wall4: 0, wall2: 0, wall1: 0 };
  let open = 0;
  const sides = ringSides(R).map((sd) => ({ sd, on: sd.cells.map(([x, y]) => free(x, y)) }));
  const tryGate = (side, m) => {
    const { sd, on } = side;
    if (m < 0 || m + 4 > on.length || !gateSpot(sd, m, 4) || ![0, 1, 2, 3].every((k) => on[m + k])) return false;
    const at = alongAt(sd, m);
    if (placeProblemAt(base, gateIt, at[0], at[1], at[2], occ, { G, R })) return false;
    out.gate4++; for (let k = 0; k < 4; k++) on[m + k] = false;
    return true;
  };
  for (const side of sides) {
    open += side.on.filter(Boolean).length;
    const hasGate = gates.some((r) => side.sd.cells.some(([x, y]) => x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h));
    if (!hasGate) tryGate(side, Math.floor((side.sd.cells.length - 4) / 2));
  }
  // No gate anywhere (none fits in the middle of a side): one at the first place along the ring it fits, as autoLayout
  // lays a gate that misses the middles, so the ring always keeps a way in.
  if (!gates.length && !out.gate4) for (const side of sides) { let done = false; for (let i = 0; i + 4 <= side.on.length && !done; i++) done = tryGate(side, i); if (done) break; }
  for (const { on } of sides) {
    for (let i = 0; i < on.length;) {
      if (!on[i]) { i++; continue; }
      let n = 0;
      while (i + n < on.length && on[i + n]) n++;
      out.wall4 += Math.floor(n / 4); out.wall2 += Math.floor((n % 4) / 2); out.wall1 += n % 2;
      i += n;
    }
  }
  const pieces = [];
  for (const t of ["gate4", "wall4", "wall2", "wall1"]) for (let i = 0; i < out[t]; i++) pieces.push(t);
  return { pieces, open, ...out };
}
// The base's wall by the numbers (buildings.js baseWalls, wallTier; the Defenses tab): the pieces placed (by hand or
// by the game), and whether they close round the base itself, with the houses (a flood from the map's edge that never
// reaches it: the dead cannot walk round). { walls, gates, stands (pieces standing), cells, enclosed, tier (the
// material it is mostly of, 0 open), strength (its material's, by cell, two thirds where damaged; 0 open), hp (a wall
// cell's on average), broken (pieces broken: gaps until repaired), gap ([x, y]: the first open cell of the ring, when it
// is open there), byMat }.
const infoCache = new Map();
// A cheap stamp of what the layout depends on (the buildings, the jobs, the plots, the ring, the cars), so the hourly
// callers (the hold limit, raids by the numbers) do not lay the base out again while nothing has changed.
const quick = new WeakMap();
const stampOf = (state, base) => `${state ? "s" : "n"}|${base.buildings.map((b) => `${b.id}${b.at ? `@${b.at}` : ""}${b.broken ? "x" : ""}${b.mat || ""}${(b.wear || 0) >= 60 ? "d" : ""}`).join(",")}|${base.construction.map((c) => `${c.id}${c.at ? `@${c.at}` : ""}`).join(",")}|${base.plan ? `${base.plan.ring}|${(base.plan.plots || []).map(String).join(";")}` : ""}|${base.tier}|${base.camp}|${base.type}|${state ? carsAtBase(state, base.id).map((v) => `${v.id}${v.at ? `@${v.at}` : ""}`).join(",") : ""}`;
export function wallInfo(state, base) {
  stampGrid(state, base);
  const stamp = stampOf(state, base), slot = state ? "s" : "n", q = quick.get(base) || {};
  if (q[slot] && q[slot].stamp === stamp) return q[slot].info;
  const info = wallInfoOf(state, base);
  quick.set(base, { ...q, [slot]: { stamp, info } });
  return info;
}
function wallInfoOf(state, base) {
  const lay = layoutOf(state, base);
  const G = gridHalf(base);
  const solid = (it) => it.built && (WALL_KINDS.has(it.kind) || it.kind === "house" || it.kind === "roof");
  const sig = lay.filter((e) => e.at && solid(e.it)).map((e) => `${e.it.key}@${e.at.join(",")}${e.it.rec && e.it.rec.broken ? "x" : ""}${e.it.rec && e.it.rec.mat ? `m${e.it.rec.mat}` : ""}${e.it.rec && (e.it.rec.wear || 0) >= 60 ? "d" : ""}`).join("|");
  const key = `${base.id}|${G}|${tierKey(base)}|${sig}`;
  const hit = infoCache.get(key);
  if (hit) return hit;
  const N = 2 * G, at = (x, y) => (y + G) * N + (x + G);
  const block = new Uint8Array(N * N);
  const info = { walls: 0, gates: 0, stands: 0, broken: 0, cells: 0, enclosed: false, tier: 0, strength: 0, hp: 0, gap: null, byMat: [0, 0, 0, 0, 0] };
  let sumS = 0, sumM = 0, sumHp = 0, nHp = 0;
  const fill = (r) => { for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (x >= -G && y >= -G && x < G && y < G) block[at(x, y)] = 1; };
  for (const p of coreParts(base)) if (p.kind === "house" || p.kind === "roof") fill({ x0: p.x, y0: p.y, w: p.w, h: p.h });
  for (const e of lay) {
    if (!e.at || !solid(e.it)) continue;
    const it = e.it, rec = it.rec || {};
    if (it.kind === "stand") { info.stands++; continue; }
    if (WALL_KINDS.has(it.kind)) {
      if (it.kind === "gate") info.gates++; else info.walls++;
      if (rec.broken) { info.broken++; continue; } // a gap until it is repaired
      const n = it.w, m = matOf(rec), dmg = (rec.wear || 0) >= 60 ? WALL_DAMAGED : 1;
      info.cells += n; info.byMat[m] += n;
      sumS += WALL_TIERS[m].strength * dmg * n; sumM += m * n;
      if (it.kind === "wall") { sumHp += pieceHp(rec) * n; nHp += n; }
    }
    fill(rectOf(it, e.at));
  }
  // The flood from the map's edge: the dead walking in.
  const seen = new Uint8Array(N * N), q = [];
  for (let i = 0; i < N; i++) for (const [x, y] of [[i - G, -G], [i - G, G - 1], [-G, i - G], [G - 1, i - G]]) { const j = at(x, y); if (!block[j] && !seen[j]) { seen[j] = 1; q.push(j); } }
  for (let h = 0; h < q.length; h++) {
    const j = q[h], x = (j % N) - G, y = Math.floor(j / N) - G;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < -G || ny < -G || nx >= G || ny >= G) continue;
      const k = at(nx, ny);
      if (!block[k] && !seen[k]) { seen[k] = 1; q.push(k); }
    }
  }
  let near = null;
  for (const p of coreParts(base)) for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) {
    if (x < -G || y < -G || x >= G || y >= G || !seen[at(x, y)]) continue;
    if (!near || Math.hypot(x, y) < Math.hypot(near[0], near[1])) near = [x, y];
  }
  info.enclosed = info.cells > 0 && !near;
  if (info.enclosed) {
    info.tier = Math.max(1, Math.min(WALL_TIERS.length - 1, Math.round(sumM / info.cells)));
    info.strength = Math.round((sumS / info.cells) * 10) / 10;
  } else if (info.walls + info.gates) {
    // The gap the dead find: the first open cell of the ring round the yard, when the wall stands on it (a wall laid
    // elsewhere by hand: no cell to name).
    const line = ringSides(ringHalf(base)).flatMap((sd) => sd.cells).filter(([x, y]) => x >= -G && y >= -G && x < G && y < G);
    if (line.some(([x, y]) => block[at(x, y)])) info.gap = line.find(([x, y]) => !block[at(x, y)]) || null;
  }
  info.hp = nHp ? Math.round(sumHp / nHp) : 0;
  if (infoCache.size > 200) infoCache.clear();
  infoCache.set(key, info);
  return info;
}
// The side of a wall rect a cell faces (north, east, south or west of its middle), for the gates, the breaches and the
// posts on the stands (fort.js).
export function faceOf(F, x, y) {
  const w = F.wall, cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
  const u = (x - cx) / Math.max(1, (w.x1 - w.x0) / 2), v = (y - cy) / Math.max(1, (w.y1 - w.y0) / 2);
  return Math.abs(u) > Math.abs(v) ? (u > 0 ? "east" : "west") : v > 0 ? "south" : "north";
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
  const C = yardHalf(base), G = gridHalf(base), R = ringHalf(base), Bh = Math.max(C, R);
  const lay = layoutOf(state, base).filter((e) => e.at && (view || e.it.built));
  // The crop: the yard, the ring and everything on the map, plus the margin (and the view's pad), within the grid.
  let x0 = -Bh - 2, y0 = -Bh - 2, x1 = Bh + 2, y1 = Bh + 2; // half-open
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
    W, H, cells, M: MARGIN, ox, oy, x0: -C + ox, y0: -C + oy, yw: 2 * C, yh: 2 * C, walled: false, view,
    wall: { x0: -R - 2 + ox, x1: R + 1 + ox, y0: -R - 2 + oy, y1: R + 1 + oy }, ring: [], walkway: [], gates: { north: [], east: [], south: [], west: [] }, towers: [], ladders: [], pieces: [],
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
      const rect = placeCar(cells, W, H, mx, my, ax, it.w, "car", (x, y) => inside(x, y) && cells[y * W + x].k === "open", (it.veh ? it.veh.id : 0) % 1000, { ring: false, body: it.veh && (it.veh.type === "truck" || it.veh.type === "miltruck") ? "truck" : "car" });
      if (rect) {
        for (let y = rect.y0; y < rect.y0 + rect.h; y++) for (let x = rect.x0; x < rect.x0 + rect.w; x++) { const c = cells[y * W + x]; c.hp = c.mhp = DEF_HP.car; used[y * W + x] = 1; }
        F.vehicles.push({ id: it.veh ? it.veh.id : null, name: it.label, x0: rect.x0, y0: rect.y0, w: rect.w, h: rect.h });
      }
      return;
    }
    const doors = [], bcells = [];
    const piece = WALL_KINDS.has(it.kind) ? { bid: it.rec && key && key.startsWith("b:") ? it.rec.id : null, kind: it.kind, cells: [] } : null;
    const broken = !!(piece && it.rec && it.rec.broken);
    for (const c of cellsOf(it, atG)) {
      const x = c.x + ox, y = c.y + oy, q = at(x, y);
      if (!q) continue;
      if (piece) { // a wall piece (buildings.js piece): its material's hit points; broken, a breach or a gate hanging open
        piece.cells.push([x, y]);
        q.k = broken && c.k === "palisade" ? "breach" : c.k; q.f = "dirt"; delete q.h; delete q.t;
        if (q.k === "palisade") { q.t = 1; q.hp = q.mhp = it.cellHp; q.wm = it.mat || 1; F.ring.push([x, y]); }
        else if (q.k === "gate") { q.hp = q.mhp = it.cellHp; q.wm = it.mat || 1; if (broken) q.hp = 0; else q.bar = true; }
        else if (q.k === "stand") { q.h = 1; F.walkway.push([x, y]); }
        used[y * W + x] = 1;
        continue;
      }
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
    if (piece) { F.pieces.push(piece); return; }
    if (it.kind === "house" || it.kind === "roof") {
      const b = { name, key: it.key0 || it.type, bid: it.rec && it.key && it.key.startsWith("b:") ? it.rec.id : null, type: it.type, x0: mx, y0: my, w: r.w, h: r.h, roof: it.kind === "roof", storeys: it.kind === "house" ? (it.storeys === 2 && r.w >= 4 && r.h >= 4 ? 2 : 1) : 0, doors };
      F.buildings.push(b);
      F.lay.buildings.push(b);
      if (it.store) F.stores.push({ id: F.stores.length + 1, label: name, x: mx, y: my, w: r.w, h: r.h, weight: it.store, bid: b.bid });
    } else if (it.store) F.stores.push({ id: F.stores.length + 1, label: name, x: mx, y: my, w: r.w, h: r.h, weight: it.store, bid: it.rec && it.key.startsWith("b:") ? it.rec.id : null });
  };
  // The middle: the camp, the shelter or the base itself.
  for (const p of coreParts(base)) lay1({ ...p, key0: p.key || p.k }, [p.x, p.y, 0], "core", true, p.name || coreName(base));
  // Everything placed, by hand or by the game.
  const reinforced = count(base, "gate") ? DEPLOY.GATE_HP_REINFORCED : 0; // buildings.js gate: every gate stronger
  for (const e of lay) {
    const it = e.it;
    const store = STORES[it.type] || 0;
    const cellHp = it.kind === "wall" ? pieceHp(it.rec) || WALL_TIERS[matOf(it.rec)].hp : it.kind === "gate" ? (pieceHp(it.rec) || WALL_TIERS[matOf(it.rec)].gateHp) + reinforced : 0;
    lay1({ ...it, store, cellHp }, e.at, it.key, it.built, it.label);
  }
  if (opts.pitsAt) for (const atG of opts.pitsAt) if (atG) lay1({ ...FOOT.spike_pits, type: "spike_pits" }, atG, "pits", true, "Spike pits");
  // The wall: the pieces placed (by hand or by the game). Walled when no way in from the map's edge reaches the base
  // itself (the attackers' way: open ground they can walk, never a barred gate or door): the inside is then what they
  // cannot reach round the base (its yard, its houses, the stands), the wall's rect its bounds; else the yard and the
  // ring round it as on an open base (the pieces stand on it as they are: a gap is a way in).
  const coreCells = [];
  for (const p of coreParts(base)) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (inside(x + ox, y + oy)) coreCells.push([x + ox, y + oy]);
  const reached = new Uint8Array(W * H), q0 = [];
  const pass = (i) => CELL[cells[i].k].walk && !barredCell(cells[i]);
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (pass(y * W + x) && !reached[y * W + x]) { reached[y * W + x] = 1; q0.push(y * W + x); }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (pass(y * W + x) && !reached[y * W + x]) { reached[y * W + x] = 1; q0.push(y * W + x); }
  for (let h = 0; h < q0.length; h++) {
    const i = q0[h], x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, j = ny * W + nx; if (inside(nx, ny) && !reached[j] && pass(j)) { reached[j] = 1; q0.push(j); } }
  }
  const nearReached = ([x, y]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(x + dx, y + dy) && reached[(y + dy) * W + x + dx]) return true; return false; };
  const insideM = new Uint8Array(W * H);
  F.walled = F.pieces.some((p) => p.kind !== "stand") && coreCells.length > 0 && !coreCells.some(nearReached);
  if (F.walled) {
    const qi = [];
    for (const [x, y] of coreCells) { const i = y * W + x; if (!insideM[i]) { insideM[i] = 1; qi.push(i); } }
    let mnx = W, mny = H, mxx = 0, mxy = 0;
    for (let h = 0; h < qi.length; h++) {
      const i = qi[h], x = i % W, y = (i - x) / W;
      mnx = Math.min(mnx, x); mny = Math.min(mny, y); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (!inside(nx, ny) || insideM[j] || reached[j] || cells[j].k === "palisade" || cells[j].k === "gate") continue;
        insideM[j] = 1; qi.push(j);
      }
    }
    F.wall = { x0: Math.max(0, mnx - 1), x1: Math.min(W - 1, mxx + 1), y0: Math.max(0, mny - 1), y1: Math.min(H - 1, mxy + 1) };
  } else {
    const r = F.wall;
    for (let y = r.y0 + 1; y <= r.y1 - 1; y++) for (let x = r.x0 + 1; x <= r.x1 - 1; x++) if (inside(x, y)) insideM[y * W + x] = 1;
  }
  F.inside = insideM;
  const w = F.wall;
  // The gates by the side of the wall they face (fort.js: the gate facing the attack is held first).
  for (const p of F.pieces) if (p.kind === "gate" && p.cells.length) {
    const [mx, my] = p.cells[Math.floor(p.cells.length / 2)];
    F.gates[faceOf(F, mx, my)].push(...p.cells);
  }
  // Cover keeps off the pieces (a cell round a wall, two round a gate: its way in and out stays clear).
  for (const p of F.pieces) {
    const d = p.kind === "gate" ? 2 : 1;
    for (const [px, py] of p.cells) for (let y = py - d; y <= py + d; y++) for (let x = px - d; x <= px + d; x++) if (inside(x, y)) keep[y * W + x] = 1;
  }
  // The guard towers (buildings.js guard_towers): two more towers right behind the wall, a quarter of the way along
  // its north side and three quarters along its south.
  if (F.walled && count(base, "guard_towers")) {
    const qd = Math.max(2, Math.round((w.x1 - w.x0) / 4));
    const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = cells[y * W + x].k;
      if (!insideM[y * W + x] || !(k === "open" || k === "stand")) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(x + dx, y + dy) && cells[(y + dy) * W + x + dx].k === "palisade")) cand.push([x, y]);
    }
    for (const [tx, ty] of [[w.x0 + qd, w.y0 + 1], [w.x1 - qd, w.y1 - 1]]) {
      let best = null;
      for (const c of cand) if (cells[c[1] * W + c[0]].k !== "tower" && (!best || Math.hypot(c[0] - tx, c[1] - ty) < Math.hypot(best[0] - tx, best[1] - ty))) best = c;
      if (best) { const t = cells[best[1] * W + best[0]]; t.k = "tower"; t.h = 2; F.towers.push(best); }
    }
  }
  // The wire (buildings.js barbed_wire, razor_wire): rings round the band FORT.WIRE cells out for each barbed wire fence
  // and FORT.RAZOR for the concertina wire, with a gap in front of every gate; wireOut: the outermost ring (the
  // attackers start beyond it: fort.js fortDefence).
  F.wireOut = 0;
  // A lane out from every gate (along its line, a cell either side) is kept clear of wire and mines: the way in.
  const gateRects = F.pieces.filter((p) => p.kind === "gate" && p.cells.length).map((p) => ({ x0: Math.min(...p.cells.map((c) => c[0])), x1: Math.max(...p.cells.map((c) => c[0])), y0: Math.min(...p.cells.map((c) => c[1])), y1: Math.max(...p.cells.map((c) => c[1])) }));
  const gateLane = (x, y) => gateRects.some((g) => (g.y0 === g.y1 ? x >= g.x0 - 1 && x <= g.x1 + 1 : y >= g.y0 - 1 && y <= g.y1 + 1));
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
// The base's stock and armory spread over its containers (F.stores): supplies by whole units, the armory's items one
// by one, each container taking its weight's share (food leans to the cellars and the cold store, gear to the core and
// the storehouse). Nothing leaves the base's records: a container holds counts and armory indexes, and only what a
// raider gets away with is taken from the base when the fight ends (settleBaseBattle, applyStolen).
export function makeStores(state, base, F, rng) {
  if (!F.stores.length) return null;
  const boxes = F.stores.map((s) => ({ ...s, sup: {}, gear: [] }));
  const split = (q, weights) => {
    const tot = weights.reduce((a, v) => a + v, 0) || 1;
    const out = weights.map((v) => Math.floor((q * v) / tot));
    let left = q - out.reduce((a, v) => a + v, 0);
    while (left > 0) { out[weights.indexOf(Math.max(...weights))] += left; left = 0; }
    return out;
  };
  for (const [k, q0] of Object.entries(base.stock)) {
    const q = Math.floor(q0 || 0);
    if (!(q > 0)) continue;
    const food = !!FOODS[k];
    const weights = boxes.map((b) => Math.max(0.1, b.weight * (food && ["cellar", "coldstore", "freezer", "storehouse"].includes(typeOfStore(base, b)) ? 2 : 1) * rng.range(0.7, 1.3)));
    split(q, weights).forEach((n, i) => { if (n > 0) boxes[i].sup[k] = n; });
  }
  base.armory.forEach((it, i) => {
    if (!it) return;
    const weights = boxes.map((b) => b.weight * (["core", "storehouse"].includes(typeOfStore(base, b)) ? 2 : 1));
    const tot = weights.reduce((a, v) => a + v, 0);
    let pick = rng.range(0, tot), j = 0;
    while (j < weights.length - 1 && pick > weights[j]) { pick -= weights[j]; j++; }
    boxes[j].gear.push({ ai: i, name: it.name, kg: itemKg(it) });
  });
  for (const b of boxes) b.kg = Object.entries(b.sup).reduce((a, [k, n]) => a + n * kgOf(k), 0) + b.gear.reduce((a, g) => a + g.kg, 0);
  return { containers: boxes }; // plain data: a save mid-battle keeps it
}
// A unit of a supply, in kg (the loot's weight).
const kgOf = (k) => (SUPPLIES[k] ? SUPPLIES[k].weight : FOODS[k] ? FOODS[k].kg : STEAL.DEFAULT_KG);
const typeOfStore = (base, s) => (s.bid == null ? "core" : (base.buildings.find((b) => b.id === s.bid) || {}).type || "core");
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
  if (u.loot && u.loot.kg >= STEAL.KG) return leaveWithLoot(b, u);
  const foes = foesOf(b, u);
  if (foes.some((f) => Math.max(Math.abs(f.x - u.x), Math.abs(f.y - u.y)) <= 1)) return false; // someone right there: fight
  const boxes = b.stores.containers.filter((c) => c.kg > 0.5);
  if (!boxes.length) return u.loot ? leaveWithLoot(b, u) : false;
  const here = boxes.find((c) => nearRect(c, u.x, u.y));
  if (here) { takeLoot(b, u, here); u.ap = 0; return true; }
  // On toward the nearest one: the cells round every container with goods.
  const targets = [];
  for (const c of boxes) for (let y = c.y - 1; y <= c.y + c.h; y++) for (let x = c.x - 1; x <= c.x + c.w; x++) {
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
      const box = boxes.find((c) => nearRect(c, u.x, u.y));
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
// the food, scrap and firewood last; never water), up to STEAL.KG in all.
export function takeLoot(b, u, box) {
  u.loot = u.loot || { sup: {}, gear: [], kg: 0 };
  let room = STEAL.KG - u.loot.kg;
  const got = [];
  for (const g of box.gear.slice()) {
    if (g.kg > room) continue;
    box.gear.splice(box.gear.indexOf(g), 1);
    u.loot.gear.push(g); u.loot.kg += g.kg; room -= g.kg; box.kg -= g.kg;
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
  // The wall pieces: a breach battered through a piece (not one there when the fight began), a gate battered open.
  const pre = new Set((F.breaches || []).map(([x, y]) => y * b.w + x));
  for (const p of F.pieces || []) {
    const fx = p.bid != null ? base.buildings.find((x) => x.id === p.bid) : null;
    if (!fx || fx.broken || p.kind === "stand") continue;
    const n = p.cells.filter(([x, y]) => !pre.has(y * b.w + x) && (p.kind === "gate" ? !barredCell(b.cells[y * b.w + x]) && b.cells[y * b.w + x].mhp : b.cells[y * b.w + x].k === "breach")).length;
    if (n) wearOn(fx, MAP_WEAR.breach * (p.kind === "gate" ? 1 : n));
  }
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
  const idx = [...new Set(stolen.gear.map((g) => g.ai))].filter((i) => base.armory[i]).sort((a, c) => c - a);
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
  const wi = wallInfo(state, base);
  return { grid: 2 * G, yard: 2 * C, ring: 2 * ringHalf(base), walled: wi.enclosed, wall: wi, items: lay.length, byHand, off, people, tier: tierName(base) };
}
