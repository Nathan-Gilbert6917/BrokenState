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
// of something else: another footprint, the base itself in the middle (CORE: a camp fire and its cache, a shack behind a
// barricade, the main house with its cellar and well), the band where the wall ring stands, or in a doorway (the cell
// outside every door stays open, and a door never opens onto a footprint or the wall: the building could not be used).
// Anything not placed by hand is placed by the game (autoLayout, deterministic for the same base and items): buildings
// spiral out from the middle to the nearest spot that fits, defences take sensible default spots (barricades across
// the yard, pits and the trench in front of the wall, the floodlights and the watchtower at the corners). A thing
// that fits nowhere is left off the map (it still counts by the numbers: defences.js).
//
// Base building (the user's request 2026-10-19, "a full base building system": docs/base-building/plan.md):
//   The no-build margin (NO_BUILD): the five cells nearest every edge of the grid take nothing, by hand or by the game
//     ("Within 5 cells of the map's edge"); the view tints them (c.nb) and the fort record carries F.noBuild.
//   General buildings (buildings.js gen_hut … gen_barn; FOOT general: true, plain: true): empty shells of some size
//     whose indoor cells (the non-border cells) take fittings (FOOT fit: true: bunks, shelves, lockers, the stove) and
//     indoor props (FOOT indoor: true: the benches, crates, the relay…). occupancy keeps a standing general building's
//     floor cells apart (occ.floor: cell → the host's key) from its walls (occ.foot): a fitting must stand wholly on
//     one host's floor ("Only inside a building"), an indoor prop may stand there or in the yard, anything else on a
//     floor cell is "On top of" the building, and the cell inside every door (inn, the counterpart of out) stays clear
//     as the outside one does. placeItem keeps rec.host (the host's id) true on a fitting or an indoor prop inside;
//     moving or lifting a general building carries what stands inside it along by the same offset (rec.carry while
//     it is lifted; what does not fit afterwards is unplaced), and demolishing one pulls its fittings down with it
//     (buildings.js demolish). The auto layout puts fittings inside the general buildings with room, nearest the
//     middle first, and leaves them off the map when none has room.
//   Doorways (base.plan.links = [{ a, b }], item keys): two house-kind buildings whose footprints touch along a run of
//     at least one cell (neither cell a corner) can be linked; the pair of wall cells in the middle of the run become
//     barred doors facing each other (bdoor, INTERIOR.DOOR_HP, no outside cell to keep clear; the two cells inside
//     them stay clear as any door's). neighboursOf / canLink / linkBuildings / unlinkBuildings / linksOf; a link whose
//     buildings no longer touch is dropped when read; carryPlacement rewrites c:<job> keys to b:<building> when a
//     queued building finishes. Never between wall pieces (WALL_KINDS): only house-kind items link.
//   A way in and out (plan Part F; the "a way in and out" section): a walkable path at least PATH.WIDTH wide must join
//     the grid's edge to everything placed (a house by a door of its own or of a doorway link, anything else by a
//     cell next to it). Wall pieces block, gate pieces and stands walk; a wall piece that would close a ring with no
//     gate in it is refused (GATE_WHY), by hand and by the auto layout (which lays the gates before the walls).
//     reachProblem is the dearer check placeItem, ghostAt (so layoutAct put / build) and autoLayout run after
//     placeProblemAt passes.
//   The view (openBaseMap): nobody on the map (survivors never show); b.layout also keeps sel (a selected item's key)
//     and pickType (a type to build: layoutAct build queues it and places the job at the ghost); buildMenu lists what
//     can be built on the map by group.
//
// The wall (wallInfo, buildBaseMap): the pieces placed, nothing else. The base is walled when they close round the
// base itself (with the houses: a house's walls and barred doors keep the dead out as well as a wall does); the
// attackers then start outside and the fight opens at the wall, otherwise in the yard (a gap anywhere is a way in).
// On the map: a building under construction (a queued job with a footprint) shows its outline (CELL "outline": stakes
// and string on open ground, walkable) in the Base map view only; when the base is raided the outlines are gone and
// the ground is open land. Every building keeps the 3D sprites of the battle map (ui/isoview.js): houses with barred
// doors and windows and an upper floor, flat-roofed stores, the props of the yard, fields, the wall ring.
// The stores (makeStores): the base's own stock and armory are what is on the map in a battle, spread over the
// buildings that hold goods (the core, the storage box, crates, shed, storehouse and warehouse, cellars, the cold store,
// the freezer: STORES) and the parked cars that are storage, as containers whose contents can be looked at by clicking
// them at any time (never "unknown" ones: ui/combat.js), each taking a share by its room (basestorage.js). What the
// player or the game put in a container (containers.js: item.store, base.bins; base building 2026-10-19) is in that
// container's map entry (by key: "core", b:<id>, v:<id>) and a thief who takes it takes it out of that bin
// (takeLoot u.loot.from → b.stolen.from → applyStolen); the unassigned goods spread over the room left.
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
// The armory (buildings.js armory, the user's requests 2026-10-19) is a windowless block with one locked security door (ARMORY_LOCK.DOOR_HP: raiders
// batter it down like any barred door, your own people go in and out) and inside it two locked containers, the gun
// cage with the base's gear and the ammo lockers with its rounds: a raider at one batters the lock a turn at a time
// (forceLock, ARMORY_LOCK: a pry tool hits twice as hard) and takes nothing until it gives way; a lock smashed open
// wears the armory afterwards (MAP_WEAR.lock, settleBaseBattle, as the broken door does: MAP_WEAR.door), and with the
// armory broken its door is an ordinary barred door and its containers stand open until it is repaired. The base's
// own people hold its keys (keyOptions / keyAct, the user's request 2026-10-19): next to a building's door, the gate
// or a locked container they lock or unlock it, 1 action, from inside or out.
// "You can move your vehicle to any unoccupied tiles of the base view which it can fit": a parked car is placed like
// anything else (its length by type: carLen, an Army truck 5), in the yard or beyond the wall. Hordes and raiders batter what
// stands in their way: doors, windows, walls, barricades and parked cars (combat.js bash); when the fight is over the
// buildings battered on the map wear as fixtures (breakdowns.js) and the cars lose condition (settleBaseBattle).
import { BUILDINGS, STORE_KG, CAMP, TENTS, tentKind, tentOf, count, isCamp, isShelter, farmSlots, tierName, canBuild, queueBuild, cancelBuild, canDemolish, demolish, pieceName, pieceHp, matOf, ringMat, WALL_TIERS, WALL_DAMAGED } from "./buildings.js"; // (call-time only: the modules load in a circle) canBuild…demolish: the view's Build, Demolish; pieceName…: the wall pieces
import { CELL, placeCar, say, fx, unitAt, active, distField, reachable, pathTo, moveAlong, bash, siegeTarget, foesOf, nearRect, createBattle, barredCell, WEAPONS, structureName } from "./combat.js";
import { carsAtBase } from "./vehicles.js";
import { DEPLOY } from "./deploy.js"; // the reinforced gate's hit points (call-time only)
import { INTERIOR, layoutSeed } from "./interior.js";
import { landSpec, landOf as landMapOf, layLand, scatterSeed, clearOf, pieceWord, CLEAR } from "./basescatter.js"; // the land of the base map: trees, bushes, fences, rocks, wrecks, a road, a river (fixed by the tile, the same in the view and in a fight); clearing it
import { Rng } from "./rng.js";
import { SUPPLIES } from "./data.js";
import { FOODS } from "./foods.js";
import { itemKg } from "./inventory.js";
import { normalizeBins, OUTSIDE } from "./containers.js"; // the assignments (item.store, base.bins): a theft taken out of its bin; the piles' key
import { FIXTURES, WEAR, breakFixture } from "./breakdowns.js";
import { log, atBase, newId } from "./world.js";
import { fireLit } from "./fieldheat.js"; // (call-time only) a camp's fire drawn lit or cold
import { pitchStoredBag, bagsInStores } from "./tents.js"; // (call-time only) a tent bag pitched from the Build list
import { chopHands } from "./woodwork.js"; // who is felling a clearing (call-time only)
import { isChopTool, bestChop } from "./woodcutting.js"; // felling a tree goes slower without a cutting tool at the base (call-time only)
import { layMines } from "./mines.js"; // the main base's minefield, buried in the open ground round the yard (call-time only)
import { tunnelAt, queueFill } from "./tunnels.js"; // the tunnels the dead dug: a hole's card, Fill tunnel (call-time only)
import { FORT } from "./fort.js"; // the wire rings' and the mines' distances from the wall (call-time only: the modules load in a circle)
import { cfgOf } from "./worldcfg.js"; // the run's dials: Base yard to start / at most
import { storageOf, coreStoreKg, vehicleStoreKg, woodpileOf } from "./basestorage.js"; // the base's room and what lies outside (call-time only)
import { BED_FOOT } from "./data-beds.js"; // beds as furniture: a cot, bed or bunk bed 1 × 2, a large bed 2 × 2, on a general building's floor
import { setFurnitureAt, furnitureInStores } from "./beds.js"; // beds as furniture: set from the stores where the ghost is (call-time only)

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
// The no-build margin (the user's request 2026-10-19, "a 5 tile margin around the edge of the map as a no build
// section"): the cells within this many of the grid's edge take nothing, by hand or by the game (placeProblemAt).
export const NO_BUILD = 5;
export const NO_BUILD_WHY = `Within ${NO_BUILD} cells of the map's edge (nothing is built there)`;
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
// The armory's locks (buildings.js armory): the hit points of its locked security door (buildingmaps.js DOOR_KINDS
// security: battered like any barred door, combat.js bash) and of the lock on each of its two containers, how much
// harder a pry tool (a crowbar, a fire axe, a sledgehammer, a halligan bar, a pickaxe) hits a container's lock, and
// the blow at one of a raider with no melee weapon (a gun's butt, as combat.js BASH). A knife-armed raider is about
// four turns at a lock, one with a sledgehammer one.
export const ARMORY_LOCK = { DOOR_HP: 90, DOOR_KIND: "security", HP: 60, PRY: 2, PRY_WEAPONS: ["prybar", "crowbar", "fireaxe", "sledge", "halligan", "pickaxe"], BASH: [8, 12] };
// What the map's battering does to the buildings afterwards (breakdowns.js wear): a door or window broken in, a wall
// section breached, a barricade battered through, an armory lock smashed open; a parked car's condition lost for the
// hit points it lost.
export const MAP_WEAR = { door: 15, window: 8, breach: 30, barricade: 60, lock: 50, carCondition: 60 };

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
// Base building (2026-10-19): general: true, plain: true on a house is a general building (an empty shell: no counter,
// no loft; its indoor cells take fittings and indoor props); fit: true on a prop is a fitting (only inside a general
// building); indoor: true on a prop (every prop drawn as a counter, table, crate or locker: INDOOR_K) may stand
// inside one as well as in the yard. Not the barrels, the well, the pump, the fire pit, the bars.
const INDOOR_K = new Set(["counter", "table", "crate", "locker"]);
const HOUSE = (w, h, storeys = 1, extra = {}) => ({ kind: "house", w, h, storeys, ...extra });
const ROOF = (w, h) => ({ kind: "roof", w, h });
const PROP = (k, w = 1, h = 1, extra = {}) => ({ kind: "prop", k, w, h, ...(INDOOR_K.has(k) ? { indoor: true } : {}), ...extra });
const FIT = (k, w = 1, h = 1) => ({ kind: "prop", k, w, h, fit: true, indoor: true });
const DEF = (k, w, h, extra = {}) => ({ kind: "defence", k, w, h, ...extra });
export const FOOT = {
  // General buildings (buildings.js gen_*): the hut 4 × 4 (a 2 × 2 floor: bunks and a stove), the cabin, the lodge,
  // the hall, the barn. Fittings: bunks (a bed cell, 2 × 1), shelves, lockers, the stove (a counter cell).
  gen_hut: HOUSE(4, 4, 1, { general: true, plain: true }), gen_cabin: HOUSE(5, 4, 1, { general: true, plain: true }), gen_lodge: HOUSE(6, 5, 1, { general: true, plain: true }),
  gen_hall: HOUSE(8, 6, 1, { general: true, plain: true }), gen_barn: HOUSE(10, 7, 1, { general: true, plain: true }),
  tent: PROP("tent", 1, 2), // a tent (TENT): a makeshift one 1 × 2 (a bag's by its kind: itemsOf), its cells all "tent"
  bunks: FIT("bed", 2, 1), shelves: FIT("shelf", 2, 1), lockers: FIT("locker"), stove: FIT("counter"),
  bunkhouse: HOUSE(5, 4, 2), barracks: HOUSE(6, 4, 2), infirmary: HOUSE(5, 4), field_hosp: HOUSE(5, 4), clinic: HOUSE(5, 4), hospital: HOUSE(6, 5, 2),
  machine_shop: HOUSE(5, 4), radio: HOUSE(4, 3), garage: HOUSE(5, 4, 1, { wide: true }), common_room: HOUSE(5, 4), chapel: HOUSE(4, 4), kitchen: HOUSE(4, 3),
  canteen: HOUSE(5, 4), huntcabin: HOUSE(3, 3), greenhouse: HOUSE(4, 3, 1, { glass: true }), cells: HOUSE(4, 4), jailhouse: HOUSE(5, 4), freezer: HOUSE(3, 3),
  cellar: ROOF(3, 2), coldstore: ROOF(3, 3), storehouse: ROOF(4, 3), cistern: ROOF(2, 2),
  shed: ROOF(3, 2), warehouse: ROOF(6, 4), storebox: PROP("crate", 1, 1), // the storage ladder (basestorage.js): a box, a shed, a warehouse
  armory: HOUSE(5, 4, 1, { armory: true }), // armoryCells: one locked security door, no windows, the gun cage and the ammo lockers inside
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
Object.assign(FOOT, BED_FOOT); // beds as furniture (data-beds.js, beds.js): fittings set from the stores, drawn as bed cells
export const FIELD = { kind: "field", w: 3, h: 2 };
// What holds the base's goods on the map (makeStores): a weight for the share of the stores each takes.
const STORES = { warehouse: 4, storehouse: 3, cellar: 2, coldstore: 2, freezer: 2, shed: 1.5, crates: 1, storebox: 0.5, armory: 1, shelves: 1, lockers: 1 }; // the armory: two locked containers of its own kind (pushStore), no share of the rest; shelves and lockers: the fittings that keep goods (base building)
const BUILD_KINDS = new Set(["house", "roof", "prop", "pen", "field", "vehicle"]); // the kinds the yard grows for (footCount) and the cover props keep off
export const WALL_KINDS = new Set(["wall", "gate", "stand"]); // the wall pieces: anywhere, the ring too
export const hasFootprint = (type) => !!FOOT[type];

// ---------- the middle: the camp, the shelter, the base ----------
// Each part: a footprint (as FOOT) at a cell relative to the middle; store: it holds goods (a container in a battle),
// with its label. (What lies outside, past the base's room, is on the piles: layPiles.)
const CORE = {
  camp: [
    { kind: "prop", k: "firepit", w: 1, h: 1, x: 0, y: 0, name: "Camp fire" }, // the tents round it are items of their own (TENT: moved like anything else)
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
    { kind: "prop", k: "crate", v: 2, w: 1, h: 1, x: 3, y: 2, name: "Crates", store: 1 },
  ],
};
export const coreParts = (base) => CORE[tierKey(base)];
// The land the base stands on, for its scatter (basescatter.js PROFILES): the tile's terrain, a farm's or a ranch's
// fields as "farm".
export function terrainOf(state, base) {
  const t = state && state.tiles && base ? state.tiles[base.tile] : null;
  if (!t) return "plains";
  if (t.loc && ["farm", "ranch", "barn"].includes(t.loc.type)) return "farm";
  return t.terrain || "plains";
}
export const coreName = (base) => tierName(base);
// Tents (the user's rules 2026-10-20; buildings.js TENTS): one kind of map piece in sizes, a building record
// { type: "tent", tent: kind } whose footprint is its kind's (a makeshift tent and a one-person tent 1 × 2, a two-person
// tent 2 × 2, a four-person tent 3 × 3), every cell of it the one kind "tent" on the battle map (how a fight treats a
// tent is combat.js's). Placed and moved like anything else; the game puts one round the fire first (TENT.SPOTS, each
// its own spot first). The Makeshift tent is built (Build list); a tent bag's tent is pitched (pitchTent) and struck
// back into its bag (strikeTent). A new camp has none: no beds until one is up.
export const TENT = { SPOTS: [[-5, -5, 0], [3, -5, 0], [-5, 3, 0], [3, 2, 0], [-2, -6, 1], [-2, 4, 1], [-6, -1, 0], [5, -1, 0]] };
const campish = (base) => isCamp(base) || (!!base && base.camp === true && base.fid != null); // yours, or an AI group's (groupbases.js h.camp)
// Tents at a base: yours, standing; an AI group's camp pitches AI_CAMP_TENTS makeshift tents on the fight at it (conquest.js).
export const AI_CAMP_TENTS = 4;
export const tentCount = (base) => (!base ? 0 : base.fid != null && !isCamp(base) ? (campish(base) ? AI_CAMP_TENTS : 0) : (base.buildings || []).filter((b) => b.type === "tent").length);
// Pitch a tent of a kind (TENTS) at a base: { tent } (its record) or { error }. at: [x, y, r] on the base map (placed by
// hand, the placement rules and the land checked), else the game places it. For tent bags (another module's items).
export function pitchTent(state, base, kind, at = null) {
  if (!TENTS[kind]) return { error: "Not a kind of tent" };
  if (!base || base.id < 0) return { error: "Not a base of yours" };
  const rec = { id: newId(), type: "tent", tent: kind };
  base.buildings.push(rec);
  if (at) {
    const err = placeItem(state, base, `b:${rec.id}`, at[0], at[1], at[2] || 0);
    if (err) { base.buildings.splice(base.buildings.indexOf(rec), 1); return { error: err }; }
  }
  return { tent: rec };
}
// A tent bag picked from the Build list (Tents): its pick type "bag:<kind>" (pitched, not built: tents.js
// pitchStoredBag), its footprint its kind's. pickFoot: the footprint of any pick type, a bag's included.
export const BAG_PICK = "bag:";
export const bagKindOf = (bt) => (typeof bt === "string" && bt.startsWith(BAG_PICK) && TENTS[bt.slice(BAG_PICK.length)] && TENTS[bt.slice(BAG_PICK.length)].bag ? bt.slice(BAG_PICK.length) : null);
export const pickFoot = (bt) => { const k = bagKindOf(bt); return k ? { ...FOOT.tent, w: TENTS[k].w, h: TENTS[k].h } : FOOT[bt] || null; };
export const pickName = (bt) => { const k = bagKindOf(bt); return k ? TENTS[k].name : BUILDINGS[bt] ? BUILDINGS[bt].name : bt; };
// Strike a standing tent: off the base and its map. Returns { kind, name } (the bag to give back, for tent bags) or { error }.
export function strikeTent(state, base, id) {
  const rec = base && base.buildings.find((b) => b.id === id && b.type === "tent");
  if (!rec) return { error: "That tent is gone" };
  base.buildings.splice(base.buildings.indexOf(rec), 1);
  return { kind: tentKind(rec), name: tentOf(rec).name };
}

// ---------- sizes ----------
// How many buildings with a footprint stand or are queued (the yard grows with them; not the fittings: they stand
// inside a building that already counts; not the wall pieces: they stand round it).
const grows = (type) => { const f = FOOT[type]; return !!f && f.kind !== "defence" && !f.fit && !WALL_KINDS.has(f.kind); };
const footCount = (base) => base.buildings.filter((b) => grows(b.type)).length + base.construction.filter((c) => !c.target && grows(c.type)).length;
// The yard's half-size: by tier and buildings, and never smaller than what is placed inside it needs.
export function yardHalf(base, raw = false) {
  const g = gridOf(base);
  let C = Math.min(g.cap, g.yard + g.per * footCount(base));
  // The ring pegged out (ensureRing: its pieces counted, or laid): the yard stops at it, so nothing the game places
  // lands on the ring's cells and opens it again (the governor re-ringing, pt-int round 2); more room inside is
  // Widen the wall (widenRing), what does not fit goes outside the wall.
  if (!raw && base && base.plan && base.plan.ring != null) return Math.min(C, base.plan.ring); // raw: the yard the buildings would want (widenRing)
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
  const C = yardHalf(base, true), R = ringHalf(base);
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
    if (b.type === "tent") { const T = tentOf(b), k = tentKind(b); out.push({ key: `b:${b.id}`, type: "tent", ...f, w: T.w, h: T.h, tent: k, label: `${T.name} ${n(`tent:${k}`)}`, at: b.at || null, rec: b, built: true }); continue; } // its kind's footprint (TENTS)
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
  for (const b of base.buildings) if (FOOT[b.type] && b.at && !WALL_KINDS.has(FOOT[b.type].kind)) out.push({ ...FOOT[b.type], at: b.at });
  for (const c of base.construction) if (FOOT[c.type] && !c.target && c.at && !WALL_KINDS.has(FOOT[c.type].kind)) out.push({ ...FOOT[c.type], at: c.at });
  for (const p of planOf(base).plots) if (p) out.push({ ...FIELD, at: p });
  return out;
}
export const itemByKey = (state, base, key) => itemsOf(state, base).find((it) => it.key === key) || null;

// ---------- local layouts (a footprint's cells, turned) ----------
// A house's cells in its own frame at r = 0 (the front on the south side): walls, a barred front door in the middle
// of the front (two for a wide one), a back door on bigger houses, windows, the upper floor (the back half) and its
// stairs. Each cell: { dx, dy, k, ... }; doors carry out: the cell outside them, and inn: the cell inside (both kept
// clear). A plain house (FOOT plain: a general building) has no counter and never a loft: its floor is empty.
function houseCells(f) {
  if (f.armory) return armoryCells(f);
  const { w, h } = f, two = f.storeys === 2 && !f.plain && w >= 5 && h >= 4;
  const cells = [];
  const border = (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ dx: x, dy: y, k: border(x, y) ? "wall" : "open", f: "floor", t: border(x, y) && two ? 2 : 0, indoor: !border(x, y) });
  const at = (x, y) => cells[y * w + x];
  const door = (x, y, hp, out) => { const c = at(x, y); c.k = "bdoor"; c.hp = hp; c.t = 0; c.indoor = true; c.door = true; c.out = out; c.inn = [2 * x - out[0], 2 * y - out[1]]; };
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
  } else if (!f.plain && w >= 4 && h >= 3) {
    const c = at(mx > 1 ? mx - 1 : 1, 1);
    if (c.k === "open" && !cells.some((d) => d.door && Math.abs(d.dx - c.dx) + Math.abs(d.dy - c.dy) <= 1)) c.k = "counter";
  }
  return cells;
}
// The armory (ARMORY_LOCK): walls all round with no windows and one locked security door in the middle of the front
// (lockDoor), and inside, along the back, the gun cage (shelving: box "gear") and down one side the ammo lockers
// (box "ammo"), with the floor in front of them where a raider stands to break their locks (5 × 4: two cells of each).
function armoryCells(f) {
  const { w, h } = f;
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    cells.push({ dx: x, dy: y, k: border ? "wall" : "open", f: "floor", t: 0, indoor: !border });
  }
  const at = (x, y) => cells[y * w + x];
  const mx = Math.floor(w / 2);
  Object.assign(at(mx, h - 1), { k: "bdoor", hp: ARMORY_LOCK.DOOR_HP, dk: ARMORY_LOCK.DOOR_KIND, lockDoor: true, indoor: true, door: true, out: [mx, h], inn: [mx, h - 2] }); // inn: the cell inside, kept clear (base building)
  for (let x = 1; x < w - 2; x++) Object.assign(at(x, 1), { k: "rack", box: "gear" });
  for (let y = 1; y < h - 1; y++) Object.assign(at(w - 2, y), { k: "locker", box: "ammo" });
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
    if (c.inn) { const [ix, iy] = turn(c.inn[0], c.inn[1], it.w, it.h, r); o.inn = [at[0] + ix, at[1] + iy]; }
    if (c.out2) { const [ox, oy] = turn(c.out2[0], c.out2[1], it.w, it.h, r); o.out2 = [at[0] + ox, at[1] + oy]; }
    if (c.ladder) { const [lx, ly] = turn(c.ladder[0], c.ladder[1], it.w, it.h, r); o.ladder = [at[0] + lx, at[1] + ly]; }
    return o;
  });
}
// The cells outside an item's doors.
export const doorCellsOf = (it, at) => cellsOf(it, at).flatMap((c) => [c.out, c.out2]).filter(Boolean); // a gate keeps a cell clear on either side (out, out2)
// The cells inside an item's doors (inn, the counterpart of out): kept as clear as the outside ones.
export const innCellsOf = (it, at) => cellsOf(it, at).filter((c) => c.inn).map((c) => c.inn);
// A general building's floor: the indoor cells (not its doors) that take fittings and indoor props.
const isFloor = (c) => !!c.indoor && c.k === "open" && !c.door;
export const floorCellsOf = (it, at) => cellsOf(it, at).filter(isFloor).map((c) => [c.x, c.y]);
// The cells of an item's footprint rect.
function rectCells(it, at) {
  const r = rectOf(it, at), out = [];
  for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) out.push([x, y]);
  return out;
}

// ---------- placement rules ----------
const K = (x, y) => (y + 2048) * 4096 + (x + 2048);
// A standing general building (FOOT general; not one going up): its floor takes fittings and indoor props.
const hostOf = (it) => !!it && !!it.general && it.built !== false;
// A thing's cells into an occupancy: a standing general building's walls and doors in foot and its floor cells in
// floor (cell → its key), anything else's whole footprint in foot; the cells outside and inside its doors in door.
function markOcc(occ, it, at, key) {
  const put = (m, x, y, v) => { if (!m.has(K(x, y))) m.set(K(x, y), v); };
  if (hostOf(it)) for (const c of cellsOf(it, at)) put(isFloor(c) ? occ.floor : occ.foot, c.x, c.y, key);
  else for (const [x, y] of rectCells(it, at)) put(occ.foot, x, y, key);
  for (const [x, y] of doorCellsOf(it, at)) put(occ.door, x, y, key);
  for (const [x, y] of innCellsOf(it, at)) put(occ.door, x, y, key);
  if (it.label) occ.names.set(key, it.label);
}
// The occupancy of everything but `skip` (a key, or a Set of keys): footprints (foot), the cells outside and inside
// doors (door, the doorways between linked buildings too) and the floors of the general buildings (floor), each with
// the key of what is there; names: the keys' labels for the reasons.
export function occupancy(state, base, skip = null, auto = null) {
  stampGrid(state, base);
  const skips = skip instanceof Set ? skip : new Set(skip ? [skip] : []);
  const occ = { foot: new Map(), door: new Map(), floor: new Map(), names: new Map(), land: landFor(state, base) }; // land: what has to be cleared before anything is built on it (basescatter.js)
  for (const p of coreParts(base)) markOcc(occ, p, [p.x, p.y, 0], "core");
  const items = itemsOf(state, base), pos = new Map();
  for (const it of items) {
    if (skips.has(it.key)) continue;
    const at = it.at || (auto && auto.get(it.key)) || null;
    if (at) { pos.set(it.key, at); markOcc(occ, it, at, it.key); }
  }
  for (const l of liveLinks(base, items, pos)) for (const [x, y] of l.inn) if (!occ.door.has(K(x, y))) occ.door.set(K(x, y), l.a);
  return occ;
}
// Why an item cannot stand at (x, y) turned r, or "" when it can. occ: occupancy(…) without this item; dims: { G, R }
// worked out once (autoLayout). The rules (2026-10-19): on the map and not within the no-build margin (NO_BUILD);
// never on the ring's band (the wall pieces may: WALL_KINDS), on top of anything, in a doorway (the cell outside or
// inside a door, either side of a gate); a fitting wholly on one standing general building's floor, an indoor prop
// there or anywhere in the yard, and anything else never on a floor cell.
export function placeProblemAt(base, it, x, y, r, occ, dims = null) {
  const at = [x, y, r & 3];
  const rect = rectOf(it, at);
  const G = dims ? dims.G : gridHalf(base), R = dims ? dims.R : ringHalf(base), N = G - NO_BUILD, wallish = WALL_KINDS.has(it.kind);
  if (rect.x0 < -G || rect.y0 < -G || rect.x0 + rect.w > G || rect.y0 + rect.h > G) return "Off the map";
  if (rect.x0 < -N || rect.y0 < -N || rect.x0 + rect.w > N || rect.y0 + rect.h > N) return NO_BUILD_WHY;
  const inner = !!(it.fit || it.indoor);
  let host = null;
  for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) {
    const k = K(xx, yy);
    if (!wallish && onBand(xx, yy, R)) return "That is where the wall stands";
    if (occ.foot.has(k)) return `On top of ${nameOf(occ, occ.foot.get(k))}`;
    if (occ.door.has(k)) return `In the doorway of ${nameOf(occ, occ.door.get(k))}`;
    const fl = occ.floor ? occ.floor.get(k) : undefined;
    if (fl != null) {
      if (!inner) return `On top of ${nameOf(occ, fl)}`;
      if (host != null && host !== fl) return "Only inside one building";
      host = fl;
    } else if (it.fit) return "Only inside a building";
  }
  if (it.fit && host == null) return "Only inside a building";
  for (const [ox, oy] of doorCellsOf(it, at)) {
    const k = K(ox, oy);
    if (occ.foot.has(k)) return `Its door would open onto ${nameOf(occ, occ.foot.get(k))}`;
    if (occ.floor && occ.floor.has(k)) return `Its door would open onto ${nameOf(occ, occ.floor.get(k))}`;
    if (!wallish && onBand(ox, oy, R)) return "Its door would open onto the wall";
  }
  // The land (basescatter.js): every piece on its cells (and on the cells outside its doors) cleared first. Not inside a
  // standing building (a fitting, a bench on its floor): its ground was cleared when it went up.
  if (occ.land && !(host != null)) {
    const hit = landUnder(occ.land, it, at);
    if (hit.length) return landWhy(hit);
  }
  return "";
}
const nameOf = (occ, key) => (key === "core" ? "the base itself" : key.startsWith("p:") ? "a crop plot" :  key.startsWith("v:") ? "a parked car" : key.startsWith("w:") ? "the wall" : occ && occ.names && occ.names.get(key) ? occ.names.get(key) : key.startsWith("c:") ? "a building going up" : "a building");
// The host (a general building's item key) under a cell of an occupancy, or null.
export const floorHostAt = (occ, x, y) => (occ && occ.floor && occ.floor.get(K(x, y))) || null;
// What stands inside a general building at its spot: the fittings and indoor props whose cells are all on its floor.
export function hostedItems(state, base, host) {
  if (!host || !host.at || !hostOf(host)) return [];
  const fl = new Set(floorCellsOf(host, host.at).map(([x, y]) => K(x, y)));
  return itemsOf(state, base).filter((o) => (o.fit || o.indoor) && o.at && rectCells(o, o.at).every(([x, y]) => fl.has(K(x, y))));
}
// A standing, unbroken general building with room on its floor for a fitting of this type (buildings.js placeProblem
// / canBuild: "Needs a building to stand in"), as its item key, or null. Against everything placed by hand or by the
// game (the auto layout's fittings too). state may be null (the Construction tab's checks): the cars are left out.
export function fittingRoom(state, base, type) {
  const f = FOOT[type];
  if (!f || !f.fit) return null;
  const auto = autoLayout(state, base);
  const occ = occupancy(state, base, null, auto);
  const probe = { ...f, type, key: null, label: BUILDINGS[type] ? BUILDINGS[type].name : type };
  for (const it of itemsOf(state, base)) {
    if (!hostOf(it) || (it.rec && it.rec.broken)) continue;
    const at = it.at || auto.get(it.key);
    if (!at) continue;
    for (const [x, y] of floorCellsOf(it, at)) for (const r of [0, 1]) if (!placeProblemAt(base, probe, x, y, r, occ)) return it.key;
  }
  return null;
}
// The fittings standing inside a general building (by its id), placed there by hand or by the game: the items
// (b:<id> standing, c:<id> queued). buildings.js demolish pulls them down with it.
export function fittingsIn(state, base, id) {
  const auto = autoLayout(state, base);
  const items = itemsOf(state, base), host = items.find((it) => it.key === `b:${id}`);
  const at = host && (host.at || auto.get(host.key));
  if (!host || !at || !hostOf(host)) return [];
  const fl = new Set(floorCellsOf(host, at).map(([x, y]) => K(x, y)));
  return items.filter((o) => o.fit && o.rec && (o.at || auto.get(o.key)) && rectCells(o, o.at || auto.get(o.key)).every(([x, y]) => fl.has(K(x, y))));
}
// A fitting or an indoor prop keeps its host's id (rec.host) while it stands inside one.
const setHost = (it, hostKey) => { if (!it.rec) return; if (hostKey && hostKey.startsWith("b:")) it.rec.host = Number(hostKey.slice(2)); else delete it.rec.host; };
// Place an item by hand (the Base map view). Returns an error, or "". A general building moved takes what stands
// inside it along (carryInside); a fitting or an indoor prop put down inside one gets its host.
export function placeItem(state, base, key, x, y, r = 0) {
  const it = itemByKey(state, base, key);
  if (!it) return "That is not on this base any more.";
  const was = it.at ? it.at.slice() : null;
  const inside = hostOf(it) ? hostedItems(state, base, it) : [];
  const skip = new Set([key, ...inside.map((o) => o.key)]);
  const occ = occupancy(state, base, skip, null); // against what is placed by hand and the base itself: what the game placed moves out of the way (autoLayout)
  const at = [x, y, r & 3];
  const why = placeProblemAt(base, it, x, y, r, occ) || reachProblem(state, base, it, at, occ, { skip }); // and a way in and out stays (the dearer check second)
  if (why) return why;
  setAt(base, it, at);
  if (it.fit || it.indoor) setHost(it, floorHostAt(occ, x, y));
  if (hostOf(it)) carryInside(state, base, it, inside, was, at);
  return "";
}
// Lift an item off the map (back to the game's own spot). A general building lifted takes what stands inside it off
// too, remembering where each stood in it (rec.carry) for when it is put down again.
export function unplaceItem(state, base, key) {
  const it = itemByKey(state, base, key);
  if (!it) return "That is not on this base any more.";
  if (hostOf(it) && it.at) {
    const inside = hostedItems(state, base, it);
    if (inside.length) it.rec.carry = inside.map((o) => ({ key: o.key, dx: o.at[0] - it.at[0], dy: o.at[1] - it.at[1], r: o.at[2] || 0 }));
    for (const o of inside) setAt(base, o, null);
  }
  setAt(base, it, null);
  return "";
}
// A general building moved (was → at) or put down after a lift (rec.carry): what stood inside goes along by the same
// offset, turn-free; what does not fit there any more is unplaced (a fitting off the map, an indoor prop back to the
// game's own spot). Only things still off the map are carried (one placed by hand meanwhile stays where it is).
function carryInside(state, base, host, inside, was, at) {
  const moves = was ? inside.map((o) => ({ key: o.key, dx: o.at[0] - was[0], dy: o.at[1] - was[1], r: o.at[2] || 0 })) : host.rec.carry || [];
  delete host.rec.carry;
  if (was) for (const o of inside) setAt(base, o, null);
  for (const m of moves) {
    const o = itemByKey(state, base, m.key);
    if (!o || o.at || !(o.fit || o.indoor)) continue;
    const occ = occupancy(state, base, m.key, null);
    const nx = at[0] + m.dx, ny = at[1] + m.dy;
    if (placeProblemAt(base, o, nx, ny, m.r, occ)) continue;
    setAt(base, o, [nx, ny, m.r]);
    setHost(o, floorHostAt(occ, nx, ny));
  }
}
function setAt(base, it, at) {
  if (it.key.startsWith("p:")) { const plots = planOf(base).plots, i = Number(it.key.slice(2)); while (plots.length <= i) plots.push(null); plots[i] = at; return; }
  if (at) it.rec.at = at; else { delete it.rec.at; delete it.rec.host; }
}
// A finished job's building takes the job's spot and its host (buildings.js constructionHour); an upgrade in place
// keeps the standing building's (addBuilding: a hospital tier, a bench, a jail). With the base, the doorway links that
// named the job (c:<id>) or the old building (b:<id>) name the new building.
export function carryPlacement(from, to, base = null) {
  if (!from || !to) return;
  if (from.at) to.at = from.at.slice();
  if (from.host != null) to.host = from.host;
  if (base && from.id != null) for (const l of linksArr(base)) for (const s of ["a", "b"]) if (l[s] === `c:${from.id}` || l[s] === `b:${from.id}`) l[s] = `b:${to.id}`;
}

// ---------- the land (basescatter.js) ----------
// The land of the base map: every piece of it blocks building on its cells until it is cleared, by a clearing job in
// the construction queue (buildings.js BUILDINGS.clear; basescatter.js CLEAR: its hours and what it gives). base.land =
// { n (a version: what is cleared changed), cleared: { "x,y": 1 } (grid cells), looted: { piece: 1 } (wrecks stripped) }.
// Your bases only (an AI group's base has no grid: its stand-in maps wear the land in their margin, fort.js).
export const LAND_WHY = "Clear the land first";
export const landKey = (base) => (base && base.land ? `${base.land.n || 0}${base.land.off ? "o" : ""}` : "-");
export function landFor(state, base) {
  if (!state || !state.tiles || !base || base.id == null || base.id < 0 || base.group || state.landOff) return null; // landOff: the tests of the rules that are not about the land
  ensureLand(state, base);
  if (base.land.off) return null;
  stampGrid(state, base);
  const spec = landSpec(state, base, { G: gridHalf(base), C: yardHalf(base), tier: tierKey(base), terrain: terrainOf(state, base) });
  return landMapOf(spec, base.land);
}
// The first time a base's land is read (a new base, or a save from before the land): what stands on the map now, by
// hand or by the game, keeps its ground (the cells under it and outside its doors cleared), so nothing standing moves.
function ensureLand(state, base) {
  if (base.land) return;
  base.land = { v: 2, n: 0, cleared: {}, looted: {}, off: true };
  try {
    for (const e of layoutOf(state, base)) {
      if (!e.at) continue;
      for (const [x, y] of [...rectCells(e.it, e.at), ...doorCellsOf(e.it, e.at)]) base.land.cleared[`${x},${y}`] = 1;
    }
  } finally { delete base.land.off; base.land.n = 1; }
}
// The cell kind a piece is laid as on the battle map.
export const landCellKind = (p) => (p.k === "wreck" ? (p.body === "truck" ? "truck" : "car") : p.k);
// The pieces under a thing at `at` (its footprint and the cells outside its doors), once each.
export function landUnder(land, it, at) {
  const out = new Set();
  for (const [x, y] of [...rectCells(it, at), ...doorCellsOf(it, at)]) { const p = land.pieces.get(`${x},${y}`); if (p) out.add(p); }
  return [...out];
}
const PLURAL = { bush: "bushes", "fence panel": "fence panels", "hay bale": "hay bales", "broken crate": "broken crates", "old drum": "old drums", "fallen log": "fallen logs", "wrecked car": "wrecked cars", "wrecked truck": "wrecked trucks" };
// "2 trees, a bush and a wrecked car".
export function landWords(pieces) {
  const n = new Map();
  for (const p of pieces) { const w = pieceWord(p); n.set(w, (n.get(w) || 0) + 1); }
  const parts = [...n].map(([w, k]) => { if (k === 1) return w; const bare = w.replace(/^(an?|the) /, ""); return `${k} ${PLURAL[bare] || `${bare}s`}`; });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}
export function landWhy(pieces) {
  if (pieces.some((p) => p.k === "water")) return "On the river: nothing is built on the water";
  return `${LAND_WHY}: ${landWords(pieces)} (click the red site to queue the clearing)`;
}
// A cutting tool at the base (the armory's, or carried by someone there): a tree is felled faster with one (CLEAR.NO_TOOL).
export const chopToolAt = (state, base) => (base.armory || []).some((it) => isChopTool(it)) || atBase(state, base.id).some((s) => !!bestChop(s).item);
// Queue the clearing of these pieces (one job: their hours added up, what they give; the ones already queued left out).
// mode "strip": strip the wrecks among them of their scrap and a car part (once). Returns the job, or null.
export function queueClear(state, base, pieces, { mode = "clear", label = "", before = null } = {}) {
  const tool = chopToolAt(state, base);
  const busy = new Set(base.construction.filter((c) => c.type === "clear" && c.pieces).flatMap((c) => c.pieces.map((p) => `${p.g}|${c.mode || "clear"}`)));
  const list = pieces.filter((p) => p && p.k !== "water" && !busy.has(`${p.g}|${mode}`) && clearOf(p, tool, mode));
  if (!list.length) return null;
  let hours = 0;
  const get = {};
  for (const p of list) { const c = clearOf(p, tool, mode); hours += c.hours; for (const [k, v] of Object.entries(c.get)) get[k] = (get[k] || 0) + v; }
  const one = list.length === 1 ? list[0] : null;
  const name = label || (mode === "strip" ? `Strip ${landWords(list)}` : one ? `${(CLEAR[one.k] || CLEAR.wreck).verb} ${pieceWord(one)}` : `Clear ${landWords(list)}`);
  const job = { id: newId(), type: "clear", mode, label: name, pieces: list.map((p) => ({ k: p.k, g: p.g, cells: p.cells.map((c) => c.slice()), ...(p.body ? { body: p.body } : {}) })), hours: Math.round(hours * 10) / 10, progress: 0, get };
  const i = before ? base.construction.indexOf(before) : -1;
  if (i >= 0) base.construction.splice(i, 0, job); else base.construction.push(job);
  return job;
}
// A clearing job done (buildings.js constructionHour): the pieces gone for good (a wreck stripped: its loot gone), what
// they gave into the stores (basestorage.js: what has no room lies outside).
export function finishClear(state, base, job) {
  ensureLand(state, base);
  for (const p of job.pieces || []) {
    if (job.mode === "strip") base.land.looted[p.g] = 1;
    else for (const [x, y] of p.cells) base.land.cleared[`${x},${y}`] = 1;
  }
  base.land.n = (base.land.n || 0) + 1;
  const got = Object.entries(job.get || {}).filter(([, v]) => v > 0);
  for (const [k, v] of got) base.stock[k] = (base.stock[k] || 0) + v;
  log(state, `${base.name}: ${job.label ? job.label.charAt(0).toLowerCase() + job.label.slice(1) : "the land cleared"}: done${got.length ? ` (+${got.map(([k, v]) => `${v} ${k === "carparts" ? "car part" + (v === 1 ? "" : "s") : k}`).join(", +")})` : ""}.`, "good");
}
// Does this construction job wait for its site to be cleared (the game placed it over the land: autoLayout's second
// pass)? Its clearing is queued just before it the first time it is asked. (buildings.js constructionHour.)
export function siteWaits(state, base, job) {
  if (!job || job.type === "clear" || job.target || !FOOT[job.type]) return false;
  const land = landFor(state, base);
  if (!land) return false;
  const key = `c:${job.id}`, it = itemByKey(state, base, key);
  if (!it || it.fit) return false;
  const at = it.at || autoLayout(state, base).get(key);
  if (!at) return false;
  const hit = landUnder(land, it, at).filter((p) => p.k !== "water");
  if (!hit.length) return false;
  const queued = new Set(base.construction.filter((c) => c.type === "clear" && c.mode !== "strip" && c.pieces).flatMap((c) => c.pieces.map((p) => p.g)));
  if (hit.some((p) => !queued.has(p.g))) queueClear(state, base, hit, { label: `Clear the site for the ${it.label.replace(/ \(building\)$/, "").toLowerCase()}`, before: job });
  if (!it.at) pinQueued(state, base); // its site held for it while it is cleared, and the other queued builds' with it, from the one layout (pinAuto)
  return true;
}
// A thing put up where the game placed it over the land (the wall pieces of a Ring wall): its ground cleared with it.
export function clearUnder(state, base, key) {
  const land = landFor(state, base);
  if (!land) return;
  const it = itemByKey(state, base, key);
  const at = it && (it.at || autoLayout(state, base).get(key));
  if (!at) return;
  const hit = landUnder(land, it, at).filter((p) => p.k !== "water");
  if (!hit.length) return;
  for (const p of hit) for (const [x, y] of p.cells) base.land.cleared[`${x},${y}`] = 1;
  base.land.n++;
}
// Every piece of the land cleared at once, for nothing (the tests of the rules that are not about the land; a cheat).
export function clearAllLand(state, base) {
  const land = landFor(state, base);
  if (!land) return;
  for (const p of land.list) for (const [x, y] of p.cells) base.land.cleared[`${x},${y}`] = 1;
  base.land.n++;
}
// The piece of land at a grid cell, as a list (empty: none); with `clump`, the pieces of its kind joined to it (a stand
// of trees, a hedgerow, a fence run).
export function landPieceAt(state, base, gx, gy, clump = false) {
  const land = landFor(state, base);
  const p = land ? land.pieces.get(`${gx},${gy}`) || null : null;
  if (!p) return [];
  if (!clump || !["tree", "bush", "fence", "stump", "rock"].includes(p.k)) return [p];
  const out = [p], seen = new Set([p.g]);
  for (let i = 0; i < out.length && out.length < 40; i++) for (const [x, y] of out[i].cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const q = land.pieces.get(`${x + dx},${y + dy}`);
    if (q && !seen.has(q.g) && q.k === p.k) { seen.add(q.g); out.push(q); }
  }
  return out;
}

// ---------- the auto layout ----------
// Where everything not placed by hand goes: a Map key → [x, y, r], the same for the same base and items (its own
// dice: interior.js layoutSeed and the items). except: an item left out (being placed by hand). Everything keeps out
// of the no-build margin (placeProblemAt); the fittings go last, inside the general buildings with room (nearest the
// middle first), and are left off the map when none has room; an indoor prop goes in the yard as before.
const autoCache = new Map();
const SPIRAL_MORE = 24; // autoLayout: the spots further out tried when the three nearest leave no way in and out
export function autoLayout(state, base, except = null) {
  stampGrid(state, base);
  const items = itemsOf(state, base);
  const sig = items.map((it) => `${it.key}${it.at ? `@${it.at.join(",")}` : ""}`).join("|");
  // What reachProblem reads is in the key: the items and where they stand (the wall pieces among them), the core's
  // parts (the tier), the yard and the ring (the grid's size and the margin), the doorway links.
  const sticky = (base.plan && base.plan.autoAt) || null; // holdAuto: where the game had things before the player's last change on the map
  const key = `${base.id}|${tierKey(base)}|${layoutSeed(base)}|${yardHalf(base)}|${ringHalf(base)}|${except || ""}|${sig}|${linksArr(base).map((l) => `${l.a}>${l.b}`).join(",")}|${sticky ? JSON.stringify(sticky) : ""}|${landKey(base)}`;
  let out = autoCache.get(key);
  if (out) return out;
  out = new Map();
  const rng = new Rng(layoutSeed(base) ^ 0x5bd1e995);
  const C = yardHalf(base), G = gridHalf(base), R = ringHalf(base);
  const occ = occupancy(state, base, except, null);
  const take = (it, at) => { out.set(it.key, at); markOcc(occ, it, at, it.key); };
  const dims = { G, R };
  const fits = (it, x, y, r) => !placeProblemAt(base, it, x, y, r, occ, dims);
  // A way in and out (reachProblem) against what is placed by hand and what the layout has taken so far (out).
  const skips = new Set(except ? [except] : []);
  let noLand = false; // the second pass: over the land (its clearing queued: siteWaits), where no open ground was left
  const reach = (it, at) => !reachProblem(state, base, it, at, occ, { items, auto: out, skip: new Set([it.key, ...skips]), noLand });
  const yardOnly = (it) => (it.indoor && !it.fit ? { ...it, indoor: false } : it); // the game puts an indoor prop in the yard, never inside
  // Buildings, fields and cars: spiral out from the middle, the first spot that fits (a few of the nearest, by dice:
  // the dice pick one of up to three, then the others in order, the first that leaves a way in and out).
  // None of those leaving a way in: on out along the spiral, the next spots in turn (up to SPIRAL_MORE of them).
  const spiral = (it, rs) => {
    const found = [];
    let d0 = 0;
    for (let d = 0; d <= C && found.length < 3; d++, d0 = d) {
      for (let y = -d; y <= d; y++) for (let x = -d; x <= d; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== d) continue;
        for (const r of rs) { const [w, h] = dimsOf(it, r); if (fits(it, x - Math.floor(w / 2), y - Math.floor(h / 2), r)) found.push([x - Math.floor(w / 2), y - Math.floor(h / 2), r]); }
      }
    }
    if (!found.length) return null;
    const i = rng.int(0, found.length - 1);
    for (const at of [found[i], ...found.filter((_, j) => j !== i)]) if (reach(it, at)) return at;
    let more = 0;
    for (let d = d0; d <= C && more < SPIRAL_MORE; d++) {
      for (let y = -d; y <= d && more < SPIRAL_MORE; y++) for (let x = -d; x <= d && more < SPIRAL_MORE; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== d) continue;
        for (const r of rs) {
          const [w, h] = dimsOf(it, r), at = [x - Math.floor(w / 2), y - Math.floor(h / 2), r];
          if (!fits(it, at[0], at[1], r)) continue;
          more++;
          if (reach(it, at)) return at;
        }
      }
    }
    return null;
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
    else if (k === "trench") spots.push([-5, out + 2, 0], [out + 2, -5, 1], [-5, -out - 3, 0], [-out - 3, -5, 1], [-5, out + 1, 0], [out + 1, -5, 1], [-5, -out - 2, 0], [-out - 2, -5, 1]); // the nearer line too: a camp's grid ends in the margin two cells out
    for (const s of spots) if (s[0] >= -G && s[1] >= -G && fits(it, s[0], s[1], s[2] || 0) && reach(it, [s[0], s[1], s[2] || 0])) return [s[0], s[1], s[2] || 0];
    return spiral(it, [0, 1]);
  };
  // A camp's tents (TENT): round the fire, the first of TENT.SPOTS that fits and leaves a way in and out, else out
  // from the middle as anything else.
  const tentSpot = (it) => {
    const i = Math.max(0, items.filter((o) => o.type === "tent").indexOf(it)), own = TENT.SPOTS[i % TENT.SPOTS.length]; // its own spot first (one moved by hand leaves the others where they are)
    for (const s of [own, ...TENT.SPOTS.filter((q) => q !== own)]) if (fits(it, s[0], s[1], s[2]) && reach(it, s)) return s.slice();
    return spiral(it, [0, 1]);
  };
  // The wall pieces the game places (no dice): the gates in the middle of the ring's sides, then the walls round it from
  // the north-west corner, longest first, each in the first run of the ring it fits (ringPlan counts the same way) and
  // leaves a way in and out (reachProblem: the gates go first, so a planned ring closes; a wall that would close a ring
  // with no gate in it is left off the map); the stands on the inner line, nearest the middle of a side first (by the gates).
  const outer = ringSides(R), inner = ringSides(R, true);
  // from: where to start in the order (the walls of a length resume after the last one placed: nothing before it has
  // room for one, and only fills up). Returns [at, index] or null.
  const fitFirst = (it, sides, order, from = 0) => { for (let k = from; k < order.length; k++) { const [si, i] = order[k]; const sd = sides[si]; if (i < 0 || i + it.w > sd.cells.length) continue; const at = alongAt(sd, i); if (fits(it, at[0], at[1], at[2]) && reach(it, at)) return [at, k]; } return null; };
  const runOrder = (sides) => sides.flatMap((sd, si) => sd.cells.map((_, i) => [si, i]));
  const outerOrder = runOrder(outer);
  const gateOrder = outerOrder.filter(([si, i]) => gateSpot(outer[si], i, 4));
  const wallPass = () => {
    const autoWall = items.filter((it) => !it.at && it.key !== except && WALL_KINDS.has(it.kind) && !out.has(it.key));
    const resume = {}, standOrder = {};
    for (const it of autoWall.filter((q) => q.kind === "gate")) { const f = fitFirst(it, outer, outer.map((sd, si) => [si, Math.floor((sd.cells.length - it.w) / 2)])) || fitFirst(it, outer, gateOrder); if (f) take(it, f[0]); }
    for (const it of autoWall.filter((q) => q.kind === "wall").sort((a, c) => c.w - a.w)) { const f = fitFirst(it, outer, outerOrder, resume[it.w] || 0); resume[it.w] = f ? f[1] : outerOrder.length; if (f) take(it, f[0]); }
    for (const it of autoWall.filter((q) => q.kind === "stand").sort((a, c) => c.w - a.w)) {
      const order = standOrder[it.w] || (standOrder[it.w] = runOrder(inner).sort(([sa, ia], [sb, ib]) => Math.abs(ia + it.w / 2 - inner[sa].cells.length / 2) - Math.abs(ib + it.w / 2 - inner[sb].cells.length / 2) || sa - sb));
      const f = fitFirst(it, inner, order, resume[`s${it.w}`] || 0); resume[`s${it.w}`] = f ? f[1] : order.length; if (f) take(it, f[0]);
    }
  };
  // The wall pieces are laid over the land from the start (their ground cleared with them: buildings.js clearUnder), as
  // ringPlan counts the ring's runs: laid around the land first, a wall 4 long took the run another needed and the ring
  // was left with gaps no piece fits (the governor ringing again; pt-int round 2). Never on the river.
  if (occ.land) { const L = occ.land; occ.land = L.waterOnly; noLand = true; wallPass(); occ.land = L; noLand = false; } else wallPass();
  // Where the game had each thing before the player's last change on the map (holdAuto): there again while it still
  // fits and leaves a way in and out, so placing one thing never shuffles the rest; then the others as below.
  // Over the land as well (never the river): a spot held there had its clearing queued, or was cleared when it was built.
  if (sticky) {
    const L = occ.land;
    if (L) { occ.land = L.waterOnly; noLand = true; }
    for (const it of items) {
      if (it.key === except || it.at || it.fit || WALL_KINDS.has(it.kind)) continue;
      const s = sticky[it.key];
      if (s && fits(it, s[0], s[1], s[2] || 0) && reach(it, [s[0], s[1], s[2] || 0])) take(it, [s[0], s[1], s[2] || 0]);
    }
    if (L) { occ.land = L; noLand = false; }
  }
  const itemPass = () => {
    for (const it of items) {
      if (it.key === except || it.at || it.fit || WALL_KINDS.has(it.kind) || out.has(it.key)) continue; // the wall pieces were laid round the ring above
      const at = it.kind === "defence" ? defSpots(it) : it.type === "tent" ? tentSpot(it) : spiral(yardOnly(it), it.kind === "field" || it.kind === "vehicle" ? [0, 1] : [0]);
      if (at) take(it, at);
    }
  };
  itemPass();
  // No open ground left for some (the land: basescatter.js): placed over it all the same, the clearing of the site
  // queued (siteWaits) before the building goes up, so the game never gets stuck on the land.
  if (occ.land && items.some((it) => it.key !== except && !it.at && !it.fit && !out.has(it.key))) {
    const L = occ.land;
    occ.land = L.waterOnly; noLand = true; // never on the river
    wallPass(); itemPass();
    occ.land = L; noLand = false;
  }
  // The fittings: into the standing general buildings with room, those nearest the middle first, the first floor cell
  // that fits (turned if need be) and leaves the way to the door; the cells inside the doorways between linked
  // buildings stay clear.
  const pos = new Map(items.filter((it) => it.at || out.has(it.key)).map((it) => [it.key, it.at || out.get(it.key)]));
  for (const l of liveLinks(base, items, pos)) for (const [x, y] of l.inn) if (!occ.door.has(K(x, y))) occ.door.set(K(x, y), l.a);
  const mid = (it, at) => { const r = rectOf(it, at); return Math.hypot(r.x0 + r.w / 2, r.y0 + r.h / 2); };
  const hosts = items.filter((it) => hostOf(it) && it.key !== except && pos.has(it.key) && !(it.rec && it.rec.broken)).map((it) => ({ it, at: pos.get(it.key), d: mid(it, pos.get(it.key)) })).sort((p, q) => p.d - q.d);
  for (const it of items) {
    if (it.key === except || it.at || !it.fit) continue;
    let at = null;
    for (const h of hosts) {
      for (const [x, y] of floorCellsOf(h.it, h.at)) { for (const r of [0, 1]) if (fits(it, x, y, r) && reach(it, [x, y, r])) { at = [x, y, r]; break; } if (at) break; }
      if (at) break;
    }
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
// Before the player changes the map (the view's put, build, demolish, doorways, Auto): where the game has everything
// it placed (not the wall pieces nor the fittings: they have their own order) is remembered (base.plan.autoAt), and
// the auto layout keeps each there while it fits (the playtest 2026-10-20: moving one thing shuffled the rest).
// One thing the game placed held where it is (pt-int round 2: a crowded forest camp's huts shuffled round each time the
// land under them was cleared, a hut built on one site standing on another's the next hour): a job whose site's clearing
// is queued (siteWaits), a building finished where its job stood (buildings.js constructionHour).
export function pinAuto(base, key, at) {
  if (!at) return;
  const P = planOf(base);
  (P.autoAt || (P.autoAt = {}))[key] = at.slice();
}
// Every queued build the game placed, held where this one layout has it (siteWaits: a site's clearing queued). Held one
// at a time, each new layout moved the builds not yet held, one of them onto land whose clearing was never queued.
export function pinQueued(state, base) {
  const P = planOf(base), auto = autoLayout(state, base);
  for (const c of base.construction) {
    const key = `c:${c.id}`, f = FOOT[c.type];
    if (c.type === "clear" || c.at || !f || f.fit || WALL_KINDS.has(f.kind) || (P.autoAt && P.autoAt[key])) continue;
    pinAuto(base, key, auto.get(key));
  }
}
export function holdAuto(state, base) {
  const hold = {};
  for (const e of layoutOf(state, base)) if (e.auto && e.at && !e.it.fit && !WALL_KINDS.has(e.it.kind)) hold[e.it.key] = e.at.slice();
  planOf(base).autoAt = hold;
}

// ---------- doorways between buildings ----------
// The user's request 2026-10-19: "If you place buildings next to each other you can create a doorway between them."
// base.plan.links = [{ a, b }] (item keys as itemsOf gives them: b:<id> standing, c:<id> queued). Two house-kind
// items touch when their footprints stand side by side along a run of at least one cell: A's border cell orthogonally
// next to B's, neither a corner, both plain wall (or a window) with an open floor cell behind each. The doorway is
// the pair in the middle of the run: both wall cells become barred doors facing each other on the battle map
// (buildBaseMap), with no outside cell to keep clear; the two cells inside them stay clear as any door's (occupancy).
const linksArr = (base) => { const p = planOf(base); return p.links || (p.links = []); };
// Where A at atA and B at atB touch: null, or { run, a: [x, y], b: [x, y], inn: [[x, y], [x, y]] } (the run's length,
// the two door cells, the cell inside each).
function touching(A, atA, B, atB) {
  if (!A || !B || A.kind !== "house" || B.kind !== "house" || !atA || !atB) return null;
  const ra = rectOf(A, atA), rb = rectOf(B, atB);
  const ax1 = ra.x0 + ra.w, ay1 = ra.y0 + ra.h, bx1 = rb.x0 + rb.w, by1 = rb.y0 + rb.h;
  const ca = new Map(cellsOf(A, atA).map((c) => [K(c.x, c.y), c])), cb = new Map(cellsOf(B, atB).map((c) => [K(c.x, c.y), c]));
  const wallish = (c) => !!c && (c.k === "wall" || c.k === "window");
  const pairs = [];
  const tryPair = (pa, pb) => {
    const ia = [2 * pa[0] - pb[0], 2 * pa[1] - pb[1]], ib = [2 * pb[0] - pa[0], 2 * pb[1] - pa[1]];
    if (wallish(ca.get(K(...pa))) && wallish(cb.get(K(...pb))) && isFloor(ca.get(K(...ia)) || {}) && isFloor(cb.get(K(...ib)) || {})) pairs.push({ a: pa, b: pb, inn: [ia, ib] });
  };
  if (ax1 === rb.x0 || bx1 === ra.x0) { // side by side: the shared column pair
    const xa = ax1 === rb.x0 ? ax1 - 1 : ra.x0, xb = ax1 === rb.x0 ? rb.x0 : bx1 - 1;
    for (let y = Math.max(ra.y0, rb.y0); y < Math.min(ay1, by1); y++) if (y !== ra.y0 && y !== ay1 - 1 && y !== rb.y0 && y !== by1 - 1) tryPair([xa, y], [xb, y]);
  } else if (ay1 === rb.y0 || by1 === ra.y0) { // one above the other: the shared row pair
    const ya = ay1 === rb.y0 ? ay1 - 1 : ra.y0, yb = ay1 === rb.y0 ? rb.y0 : by1 - 1;
    for (let x = Math.max(ra.x0, rb.x0); x < Math.min(ax1, bx1); x++) if (x !== ra.x0 && x !== ax1 - 1 && x !== rb.x0 && x !== bx1 - 1) tryPair([x, ya], [x, yb]);
  }
  if (!pairs.length) return null;
  const p = pairs[(pairs.length - 1) >> 1];
  return { run: pairs.length, a: p.a, b: p.b, inn: p.inn };
}
// The links live at the positions given (pos: key → at; a link with an item off the map is not live), without
// changing the plan: [{ a, b, da, db, inn, run }].
function liveLinks(base, items, pos) {
  const out = [];
  const L = base.plan && base.plan.links;
  if (!L || !L.length) return out;
  const byKey = new Map(items.map((it) => [it.key, it]));
  for (const l of L) {
    const t = touching(byKey.get(l.a), pos.get(l.a), byKey.get(l.b), pos.get(l.b));
    if (t) out.push({ a: l.a, b: l.b, da: t.a, db: t.b, inn: t.inn, run: t.run });
  }
  return out;
}
const posOf = (state, base) => new Map(layoutOf(state, base).filter((e) => e.at).map((e) => [e.it.key, e.at]));
// The live links with their two door cells (grid coordinates); a link whose buildings are gone, or both stand on the
// map and no longer touch, is dropped from the plan here.
export function linksOf(state, base) {
  const items = itemsOf(state, base), pos = posOf(state, base), byKey = new Map(items.map((it) => [it.key, it]));
  const L = linksArr(base);
  for (let i = L.length - 1; i >= 0; i--) {
    const l = L[i], A = byKey.get(l.a), B = byKey.get(l.b);
    if (!A || !B || (pos.has(l.a) && pos.has(l.b) && !touching(A, pos.get(l.a), B, pos.get(l.b)))) L.splice(i, 1);
  }
  return liveLinks(base, items, pos);
}
const linkOf = (base, a, b) => linksArr(base).find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)) || null;
// The house-kind items touching this one on the map: [{ key, label, run, a, b, linked }] (a, b: the doorway's cells,
// this one's first).
export function neighboursOf(state, base, key) {
  const items = itemsOf(state, base), pos = posOf(state, base);
  const A = items.find((it) => it.key === key);
  if (!A || !pos.has(key)) return [];
  const out = [];
  for (const B of items) {
    if (B.key === key || B.kind !== "house" || !pos.has(B.key)) continue;
    const t = touching(A, pos.get(key), B, pos.get(B.key));
    if (t) out.push({ key: B.key, label: B.label, run: t.run, a: t.a, b: t.b, linked: !!linkOf(base, key, B.key) });
  }
  return out;
}
// Why a doorway cannot be opened between a and b, or "".
export function canLink(state, base, a, b) {
  const items = itemsOf(state, base), A = items.find((it) => it.key === a), B = items.find((it) => it.key === b);
  if (!A || !B) return "That building is gone";
  if (a === b) return "A building cannot share a doorway with itself";
  if (A.kind !== "house" || B.kind !== "house") return "Only buildings with walls share a doorway";
  if (A.armory || B.armory) return "The armory has one way in, its security door"; // ARMORY_LOCK: a doorway would go round its locked door
  const pos = posOf(state, base);
  if (!pos.has(a) || !pos.has(b)) return "Both buildings must stand on the map";
  const t = touching(A, pos.get(a), B, pos.get(b));
  if (!t) return "They do not stand against each other";
  if (linkOf(base, a, b)) return "They share a doorway already";
  const occ = occupancy(state, base, null, autoLayout(state, base));
  for (const [x, y] of t.inn) { const k = occ.foot.get(K(x, y)); if (k && k !== a && k !== b) return `${nameOf(occ, k)} stands inside where the doorway would open`; } // (a building going up holds its whole outline)
  return "";
}
export function linkBuildings(state, base, a, b) {
  const why = canLink(state, base, a, b);
  if (why) return why;
  linksArr(base).push({ a, b });
  autoCache.clear();
  return "";
}
export function unlinkBuildings(state, base, a, b) {
  const l = linkOf(base, a, b);
  if (!l) return "They share no doorway";
  const L = linksArr(base);
  L.splice(L.indexOf(l), 1);
  autoCache.clear();
  return "";
}

// ---------- a way in and out ----------
// The user's request 2026-10-19 (docs/base-building/plan.md Part F): "there needs to be at least a 1 × 4 tiles you can
// walk through from in the base to out of the base and from out of the base to into the base. Gates count. You can
// have a circle of buildings as long as one of the doors lets you in to the base to access all other buildings;
// otherwise you cannot place". The rule: on the base's map as it would be built, a walkable path at least PATH.WIDTH
// cells wide must join the grid's edge (the no-build margin is always open ground) to everything placed: a house-kind
// building by one of its door cells (a doorway link's door counts: the walk goes through buildings' floors), a fitting
// by a floor cell next to it (so its host's door must be reached), anything else (a prop, a crate, a defence, a crop
// plot, a car, the core's fire) by a walkable cell next to its footprint; the core by its house's doors, or a cell next
// to each part without a door. What walks is what CELL says walks on the battle map (open ground, fields, trenches,
// pits, wire, doors, gate pieces and wall stands) less what stands raised (SOLID: a flat roof, a watchtower); walls
// (the wall pieces among them: there is no drawn ring, the pieces are the wall), windows, fences, props, crates,
// barricades, fittings and parked cars do not; a queued building or piece counts as built (it will be), a broken piece
// as standing (it will be mended). A wall piece that would close a ring with no gate in it (a pocket of open ground the
// edge reached before it went down and does not after) is refused with GATE_WHY: always a way in and out on foot,
// gates counting (the user's rule; the auto layout lays the gates first, so a planned ring closes). reachProblem is the
// dearer check (one flood fill over the whole grid, two for a wall piece that closes something) callers run after
// placeProblemAt passes: placeItem, ghostAt (the hover's reason, so layoutAct put / build refuse it) and autoLayout on
// the spots it picks. It counts what is placed by hand, the core and, with opts.auto, what the layout has taken so far:
// what the game places re-flows after a hand placement and is checked again then.
export const PATH = { WIDTH: 1 }; // the path's least width in cells. Only 1 is implemented: a 4-neighbour flood fill, where one open cell joins two; a wider path would fill over the cells a WIDTH × WIDTH block of open cells fits on. The constant is here so the rule reads as one number.
export const REACH_WHY = "Nothing could walk to it from outside the base: leave a way in (a path at least one cell wide, a door or a gate)";
const SOLID = new Set(["roof", "tower"]); // raised cells the battle map lets people climb onto (a ladder, a tower's own) but no path in or out goes over
export const GATE_WHY = "Needs a gate in the wall first: the wall would shut everything inside off from the outside";
const walks = (k) => !SOLID.has(k) && !!CELL[k] && !!CELL[k].walk;
// Why `it` cannot stand at `at` (grid coordinates [x, y, r]) for want of a way in and out, or "". Checked after
// placeProblemAt passes (occ: the same occupancy, kept for the signature; the grid is built afresh from the items).
// Counted: the core, every item placed by hand (it.at) and, with opts.auto (a Map key → at, as occupancy takes), what
// the layout has taken so far; never the keys in opts.skip (default: it.key; a general building being moved also skips
// what stands inside it, which moves along). opts.items: the items (itemsOf) when the caller has them already.
// Returns REACH_WHY when nothing could walk to the candidate itself, GATE_WHY for a wall piece that closes a ring with
// no gate, else "That would shut off <label>: no way to walk to it from outside the base" naming the first thing (the
// core's parts first, then the items in their order) the placement would cut off. One Uint8Array over the (2G)² grid
// and one flood fill: a few ms on the biggest grid.
export function reachProblem(state, base, it, at, occ, opts = {}) {
  stampGrid(state, base);
  const G = gridHalf(base), N = 2 * G;
  const on = (x, y) => x >= -G && x < G && y >= -G && y < G;
  const idx = (x, y) => (y + G) * N + (x + G);
  const blk = new Uint8Array(N * N);
  const block = (x, y) => { if (on(x, y)) blk[idx(x, y)] = 1; };
  // The land that stops a walk (trees, fences, rocks, wrecks, the river; not bushes nor tents: combat.js CELL walk).
  const land = landFor(state, base);
  if (land) for (const p of opts.noLand ? land.waterOnly.list : land.list) if (!walks(landCellKind(p))) for (const [x, y] of p.cells) block(x, y);
  // A thing's cells onto the grid: a car's whole rect and a flat-roofed block stand solid; anything else by its cells
  // (cellsOf: a house's walls and windows block, its doors and floor walk; a pen's fence and hay block, its gap walks;
  // a field walks; a prop, a fitting or a defence by its cell kind: a trench or pits walk, a barricade or a crate not).
  const lay = (o, atO) => {
    if (o.kind === "vehicle" || o.kind === "roof") { for (const [x, y] of rectCells(o, atO)) block(x, y); return; }
    for (const c of cellsOf(o, atO)) if (!walks(c.k)) block(c.x, c.y);
  };
  const items = opts.items || itemsOf(state, base);
  const skips = opts.skip instanceof Set ? opts.skip : new Set(opts.skip ? [opts.skip] : it && it.key ? [it.key] : []);
  const auto = opts.auto || null;
  const counted = [], pos = new Map();
  for (const o of items) {
    if (skips.has(o.key)) continue;
    const a = o.at || (auto && auto.get(o.key)) || null;
    if (!a) continue;
    counted.push({ it: o, at: a }); pos.set(o.key, a); lay(o, a);
  }
  const core = coreParts(base);
  for (const p of core) lay(p, [p.x, p.y, 0]);
  if (it && at) { lay(it, at); if (it.key) pos.set(it.key, at); }
  // A wall piece's own cells (GATE_WHY's second flood leaves them open; placeProblemAt keeps them off everything else).
  const mine = it && at && it.kind === "wall" ? cellsOf(it, at).filter((c) => !walks(c.k) && on(c.x, c.y)).map((c) => idx(c.x, c.y)) : [];
  // (No ring is drawn: the wall pieces are the wall, laid above by their cells: a wall blocks, a gate and a stand walk.)
  // The doorways between linked buildings: both door cells walk.
  const links = liveLinks(base, items, pos);
  for (const l of links) for (const [x, y] of [l.da, l.db]) if (on(x, y)) blk[idx(x, y)] = 0;
  // The flood fill from every open cell on the grid's edge (PATH.WIDTH 1: 4-neighbour, over the open cells).
  const flood = (bk) => {
    const seen = new Uint8Array(N * N), q = new Int32Array(N * N);
    let qh = 0, qt = 0;
    const seed = (i) => { if (!bk[i] && !seen[i]) { seen[i] = 1; q[qt++] = i; } };
    for (let i = 0; i < N; i++) { seed(i); seed((N - 1) * N + i); seed(i * N); seed(i * N + N - 1); }
    while (qh < qt) {
      const i = q[qh++], x = i % N, y = (i / N) | 0;
      if (x > 0) seed(i - 1);
      if (x < N - 1) seed(i + 1);
      if (y > 0) seed(i - N);
      if (y < N - 1) seed(i + N);
    }
    return seen;
  };
  const seen = flood(blk);
  const reached = (x, y) => on(x, y) && seen[idx(x, y)] === 1;
  // A thing is reached: a house by a door cell of its own or of a doorway link it is part of; anything else by a
  // walkable cell 4-adjacent to its footprint (a fitting's: the host's open floor next to it).
  const nextTo = (o, atO) => {
    const r = rectOf(o, atO);
    for (let x = r.x0; x < r.x0 + r.w; x++) if (reached(x, r.y0 - 1) || reached(x, r.y0 + r.h)) return true;
    for (let y = r.y0; y < r.y0 + r.h; y++) if (reached(r.x0 - 1, y) || reached(r.x0 + r.w, y)) return true;
    return false;
  };
  const doorsOf = (o, atO, key) => {
    const d = cellsOf(o, atO).filter((c) => c.door).map((c) => [c.x, c.y]);
    if (key) for (const l of links) { if (l.a === key) d.push(l.da); if (l.b === key) d.push(l.db); }
    return d;
  };
  const ok = (o, atO, key) => (o.kind === "house" ? doorsOf(o, atO, key).some(([x, y]) => reached(x, y)) : nextTo(o, atO));
  if (it && at && !ok(it, at, it.key)) return REACH_WHY;
  // A wall piece closing a ring with no gate in it: an open cell next to it that the edge no longer reaches, but
  // reached without it (any pocket the piece closes touches it). A gate would have let the walk through.
  if (it && at && it.kind === "wall" && mine.length) {
    const pocket = [];
    for (const i of mine) for (const j of [i % N > 0 ? i - 1 : -1, i % N < N - 1 ? i + 1 : -1, i - N, i + N]) if (j >= 0 && j < N * N && !blk[j] && !seen[j]) pocket.push(j);
    if (pocket.length) {
      const open = blk.slice();
      for (const i of mine) open[i] = 0;
      const was = flood(open);
      if (pocket.some((j) => was[j])) return GATE_WHY;
    }
  }
  const shut = (name) => `That would shut off ${name}: no way to walk to it from outside the base`;
  for (const p of core) if (!ok(p, [p.x, p.y, 0], null)) return shut(p.name || coreName(base));
  for (const e of counted) if (!ok(e.it, e.at, e.it.key)) return shut(e.it.label);
  return "";
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
    noBuild: NO_BUILD, // the no-build margin round the grid (nothing stands within it; the view tints it: c.nb)
  };
  for (let y = -C; y < C; y++) for (let x = -C; x < C; x++) { const c = at(x + ox, y + oy); if (c) c.f = "dirt"; }
  if (view) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const gx = x - ox, gy = y - oy; if (gx < NO_BUILD - G || gy < NO_BUILD - G || gx >= G - NO_BUILD || gy >= G - NO_BUILD) cells[y * W + x].nb = 1; }
  // A container of the stores (makeStores), with its container's key (containers.js: "core", b:<id>, v:<id>). The
  // armory (ARMORY_LOCK): two locked containers inside it in place of one, the gun cage (holds "gear") and the ammo
  // lockers (holds "ammo"), each over its own cells (boxes: the map cells armoryCells tagged, turned with the
  // building); with the armory broken (breakdowns.js) they stand open.
  const pushStore = (label, x, y, w, h, weight, bid, it, boxes = null, key = null) => {
    const skey = key || (bid == null ? "core" : `b:${bid}`);
    if (it.type === "armory" && boxes) {
      const locked = !(it.rec && it.rec.broken);
      for (const [holds, what] of [["gear", "gun cage"], ["ammo", "ammo lockers"]]) {
        const list = boxes[holds] || [];
        if (!list.length) continue;
        const xs = list.map((p) => p[0]), ys = list.map((p) => p[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        F.stores.push({ id: F.stores.length + 1, key: skey, label: `${label} ${what}`, x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1, weight: 0, bid, holds, ...(locked ? { lock: { hp: ARMORY_LOCK.HP, mhp: ARMORY_LOCK.HP, open: false } } : {}) });
      }
      return;
    }
    F.stores.push({ id: F.stores.length + 1, key: skey, label, x, y, w, h, weight, bid, room: it.room || 0 });
  };
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
        if (room > 0) F.stores.push({ id: F.stores.length + 1, key: `v:${it.veh.id}`, label: it.label, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, weight: 1, bid: null, vid: it.veh.id, room });
      }
      return;
    }
    const doors = [], bcells = [], boxes = {};
    const weak = it.type === "armory" && it.rec && it.rec.broken; // the armory broken: its door an ordinary barred one
    const piece = WALL_KINDS.has(it.kind) ? { bid: it.rec && key && key.startsWith("b:") ? it.rec.id : null, kind: it.kind, cells: [] } : null;
    const broken = !!(piece && it.rec && it.rec.broken);
    for (const c of cellsOf(it, atG)) {
      const x = c.x + ox, y = c.y + oy, q = at(x, y);
      if (!q) continue;
      if (c.box) (boxes[c.box] = boxes[c.box] || []).push([x, y]);
      if (piece) { // a wall piece (buildings.js piece): its material's hit points; broken, a breach or a gate hanging open
        piece.cells.push([x, y]);
        q.k = broken && c.k === "palisade" ? "breach" : c.k; q.f = "dirt"; delete q.h; delete q.t;
        if (q.k === "palisade") { q.t = 1; q.hp = q.mhp = it.cellHp; q.wm = it.mat || 1; F.ring.push([x, y]); }
        else if (q.k === "gate") { q.hp = q.mhp = it.cellHp; q.wm = it.mat || 1; q.keyed = true; if (broken) q.hp = 0; else q.bar = true; } // keyed: your people hold the key (keyAct)
        else if (q.k === "stand") { q.h = 1; F.walkway.push([x, y]); }
        used[y * W + x] = 1;
        continue;
      }
      q.k = c.k; if (c.f) q.f = c.f;
      if (c.dk && !weak) q.dk = c.dk; else delete q.dk;
      if (c.lockDoor) { q.lockDoor = true; if (weak) c.hp = INTERIOR.DOOR_HP; }
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
      if (c.door) { doors.push([x, y]); F.doors.push([x, y]); q.keyed = true; } // the base's own door: its people hold the key (keyAct)
      if (c.ladder) { const l = at(c.ladder[0] + ox, c.ladder[1] + oy); if (l && l.k === "open") { l.k = "ladder"; F.ladders.push([c.ladder[0] + ox, c.ladder[1] + oy]); } }
      bcells.push([x, y]);
    }
    if (piece) { F.pieces.push(piece); return; }
    // A store entry's key (containers.js): "core" for the base itself, b:<id> for a building or a fitting that keeps
    // goods (the general buildings keep nothing of their own: their shelves and lockers do).
    const bid = it.rec && it.key && it.key.startsWith("b:") ? it.rec.id : null;
    const skey = key === "core" ? "core" : key;
    if (it.kind === "house" || it.kind === "roof") {
      const b = { name, key: it.key0 || it.type, ikey: key, bid, type: it.type, x0: mx, y0: my, w: r.w, h: r.h, roof: it.kind === "roof", storeys: it.kind === "house" ? (it.storeys === 2 && r.w >= 4 && r.h >= 4 ? 2 : 1) : 0, doors };
      F.buildings.push(b);
      F.lay.buildings.push(b);
      if (it.store) pushStore(name, mx, my, r.w, r.h, it.store, b.bid, it, boxes, skey);
    } else if (it.store) pushStore(name, mx, my, r.w, r.h, it.store, bid, it, null, skey);
  };
  // The middle: the camp, the shelter or the base itself.
  // room: the kg it holds (basestorage.js: the core's room shared over its stores, a storage building's STORE_KG).
  const coreW = coreParts(base).reduce((a, p) => a + (p.store || 0), 0) || 1;
  for (const p of coreParts(base)) lay1({ ...p, key0: p.key || p.k, room: p.store ? (coreStoreKg(base) * p.store) / coreW : 0 }, [p.x, p.y, 0], "core", true, p.name || coreName(base));
  // Everything placed, by hand or by the game: the buildings first, then the fittings and indoor props that stand
  // inside them (laid over their floor).
  const reinforced = count(base, "gate") ? DEPLOY.GATE_HP_REINFORCED : 0; // buildings.js gate: every gate stronger
  const late = (e) => !!(e.it.fit || e.it.indoor);
  for (const e of [...lay.filter((e) => !late(e)), ...lay.filter(late)]) {
    const it = e.it;
    const store = STORES[it.type] || 0;
    const cellHp = it.kind === "wall" ? pieceHp(it.rec) || WALL_TIERS[matOf(it.rec)].hp : it.kind === "gate" ? (pieceHp(it.rec) || WALL_TIERS[matOf(it.rec)].gateHp) + reinforced : 0;
    lay1({ ...it, store, room: store ? STORE_KG[it.type] || 0 : 0, cellHp }, e.at, it.key, it.built, it.label);
  }
  if (opts.pitsAt) for (const atG of opts.pitsAt) if (atG) lay1({ ...FOOT.spike_pits, type: "spike_pits" }, atG, "pits", true, "Spike pits");
  // A queued building's site in a fight (no outline drawn: open ground) is cleared ground all the same: no scatter on it.
  if (!view) for (const e of layoutOf(state, base)) {
    if (!e.at || e.it.built) continue;
    const r = rectOf(e.it, e.at);
    for (let y = r.y0 + oy - 1; y <= r.y0 + oy + r.h; y++) for (let x = r.x0 + ox - 1; x <= r.x0 + ox + r.w; x++) if (inside(x, y)) keep[y * W + x] = 1;
  }
  // The doorways between linked buildings (linksOf): the two facing wall cells become barred doors, in F.doors and in
  // each building's doors (settleBaseBattle wears them), with no outside cell; only between two buildings standing.
  const byIkey = new Map(F.buildings.map((s) => [s.ikey, s]));
  for (const l of linksOf(state, base)) {
    const A = byIkey.get(l.a), B = byIkey.get(l.b);
    if (!A || !B) continue;
    for (const [s, [gx, gy]] of [[A, l.da], [B, l.db]]) {
      const x = gx + ox, y = gy + oy, q = at(x, y);
      if (!q) continue;
      q.k = "bdoor"; q.f = "floor"; q.hp = q.mhp = INTERIOR.DOOR_HP; q.link = 1; delete q.t; delete q.h;
      indoor[y * W + x] = 1; used[y * W + x] = 1;
      F.windows = F.windows.filter(([wx, wy]) => wx !== x || wy !== y);
      F.doors.push([x, y]); s.doors.push([x, y]);
    }
  }
  layPiles(state, base, F, { C: R, G, inside, used, keep }); // what lies outside: piles near the middle, off the wall's ring
  // The fires (a camp's or a shelter's fire, a cook fire): drawn burning while lit (ui/isoview.js firepit: c.lit), cold
  // ash and stones once a camp's or a shelter's fire is out (fieldheat.js fireLit).
  const fireOn = !isShelter(base) || fireLit(base);
  for (const c of F.cells) if (c.k === "firepit") { if (fireOn) c.lit = true; else delete c.lit; }
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
  // The land (basescatter.js, the user's requests 2026-10-20): what stands on the ground round the base by its tile
  // (trees, bushes, hedgerows, fences, rocks, stumps, logs, wrecks, a road with its abandoned cars, a river) and what
  // lies about the yard, fixed by the tile in grid coordinates: the same in the Base map view and in a fight, and the
  // same whatever is built or moved. Nothing is built on it until it is cleared (placeProblemAt), so it stands wherever
  // nothing else does; a piece under something standing (an old save's, laid before the land) is hidden there.
  const land = landFor(state, base);
  F.scatter = land ? layLand({ cells, W, H, ox, oy, land, ok: (x, y) => cells[y * W + x].k === "open" && !used[y * W + x], floor: (x, y) => cells[y * W + x].k === "open" && !used[y * W + x] && !indoor[y * W + x] }).kinds : {};
  // The clearing under way (the construction queue's clearing jobs: basescatter.js CLEAR), for the view: the cells, how far,
  // and who is on it this hour (woodwork.js chopHands: the woodcutters felling it, the builders working it).
  F.clearing = (base.construction || []).filter((c) => c.type === "clear" && c.pieces).map((c) => ({ id: c.id, label: c.label, pct: Math.round((100 * (c.progress || 0)) / Math.max(1e-9, c.hours)), who: chopHands(state, base, c), cells: c.pieces.flatMap((p) => p.cells).map(([x, y]) => [x + ox, y + oy]).filter(([x, y]) => inside(x, y)) }));
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
// What lies outside (basestorage.js storageOf, the assignments honoured: the goods past the base's room), as it goes
// on the map: whole units of the supplies (a stack of 12.5 with 3.5 outside: 3 on the pile, the 9 that fit inside),
// the armory indices of the items, and their weight. null when nothing whole lies out.
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
  // The woodpile (basestorage.js woodpileOf: never in the room, never "outside" in the books) lies in the yard all the
  // same: it is laid with the piles, and a raid takes from it as from anything left out.
  const wood = woodpileOf(base);
  if (wood > 0) { sup.wood = (sup.wood || 0) + wood; kg += wood * kgOf("wood"); }
  return gear.length || Object.keys(sup).length ? { sup, gear, kg } : null;
}
// The piles of what lies outside, laid on the map (buildBaseMap, after the buildings and the doorways): crates stacked
// on the open ground of the yard as near the middle as there is room, every cell of a pile free (never on a footprint,
// a buffer round one, a doorway, the wall's ring or the no-build margin) and open ground all round it (walkable,
// nothing to batter: no door; so a pile never shuts a way in: basemap reachProblem). One a PILE.KG of what lies out, at
// most PILE.MAX; a yard too full for one puts it on the open ground beyond the ring, and with no room at all the goods
// stay in the real containers (makeStores). Their key is "outside" (containers.js OUTSIDE).
function layPiles(state, base, F, m) {
  const out = outsideOf(state, base);
  if (!out) return;
  const { C, G, inside, used, keep } = m, { cells, W, ox, oy } = F;
  const n = Math.max(1, Math.min(PILE.MAX, Math.ceil(out.kg / PILE.KG)));
  const pw = PILE.W, ph = PILE.H;
  const lim = G - NO_BUILD;
  const free = (x, y) => inside(x, y) && !used[y * W + x] && !keep[y * W + x] && cells[y * W + x].k === "open";
  const clear = (x, y) => inside(x, y) && !used[y * W + x] && cells[y * W + x].k === "open";
  const fits = (gx, gy) => {
    for (let y = gy - 1; y <= gy + ph; y++) for (let x = gx - 1; x <= gx + pw; x++) {
      if (onBand(x, y, C)) return false;
      const inR = x >= gx && x < gx + pw && y >= gy && y < gy + ph;
      if (inR && (x < -lim || y < -lim || x >= lim || y >= lim)) return false;
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
      F.stores.push({ id: F.stores.length + 1, key: OUTSIDE, label: n > 1 ? `${PILE.LABEL} ${laid}` : PILE.LABEL, x: mx, y: my, w: pw, h: ph, weight: 0, bid: null, pile: true, room: 0 });
    }
  }
}
// The base's stock and armory on its containers (F.stores: the core's parts, the storage buildings and fittings, the
// armory's gun cage and ammo lockers, the parked cars that are storage, the piles), by basestorage.js storageOf with
// the assignments honoured (containers.js: item.store, base.bins), one answer with the Storage tab and the storage
// lines:
//   1. what is assigned and fits its container is in that container's map entries, matched by key ("core", b:<id>,
//      v:<id>; the core's several parts share its goods by their room; the armory's rounds and arrows in its ammo
//      lockers, the rest in its gun cage), marked asg (takeLoot: what comes out of it comes out of that bin);
//   2. what lies outside (outsideOf) on the piles;
//   3. the rest (unassigned, or kept in a container that is not on the map) spread over the real containers, each
//      taking a share by the room it has left (food leans to the cellars, the cold store, the freezer and the
//      storehouse, gear to the core, the storehouse and the warehouse; with no room at all, by the STORES weights); an
//      armory's ammo lockers take every round and arrow and its gun cage every item of these, and nothing else.
// Supplies go by whole units, the armory's items one by one. Nothing leaves the base's records: a container holds
// counts and armory indexes, and only what a raider gets away with is taken from the base when the fight ends
// (settleBaseBattle, applyStolen). Deterministic (only rng); with nothing assigned, as the spread always was.
export function makeStores(state, base, F, rng) {
  if (!F.stores.length) return null;
  const keyOf = (s) => s.key || (s.pile ? OUTSIDE : s.vid != null ? `v:${s.vid}` : s.bid == null ? "core" : `b:${s.bid}`);
  const boxes = F.stores.map((s) => ({ ...s, key: keyOf(s), sup: {}, asg: {}, gear: [] }));
  const gearBox = boxes.find((b) => b.holds === "gear") || null, ammoBox = boxes.find((b) => b.holds === "ammo") || null;
  const piles = boxes.filter((b) => b.pile), real = boxes.filter((b) => !b.pile && !b.holds);
  const out = (piles.length && outsideOf(state, base)) || { sup: {}, gear: [] };
  const armory = base.armory || [];
  const gOf = (i) => { const it = armory[i]; return { ai: i, key: it.key, name: it.name, kg: itemKg(it) }; };
  const split = (q, weights) => {
    const tot = weights.reduce((a, v) => a + v, 0) || 1;
    const res = weights.map((v) => Math.floor((q * v) / tot));
    const left = q - res.reduce((a, v) => a + v, 0);
    if (left > 0) res[weights.indexOf(Math.max(...weights))] += left;
    return res;
  };
  // 1. The assigned goods (storageOf's containers: what fits of each assignment).
  const asgSup = {}, asgGear = new Set(), held = new Map(); // held: kg in a map entry by assignment
  const put = (b, k, n) => { b.sup[k] = (b.sup[k] || 0) + n; b.asg[k] = (b.asg[k] || 0) + n; held.set(b, (held.get(b) || 0) + n * kgOf(k)); };
  if (base.bins || armory.some((it) => it && it.store != null)) {
    for (const c of storageOf(state, base).containers) {
      const mine = boxes.filter((b) => !b.pile && b.key === c.key);
      if (!mine.length) continue; // not on the map: its goods are spread with the rest
      const pick = (holds) => { const l = mine.filter((b) => !b.holds || b.holds === holds); return l.length ? l : mine; };
      for (const [k, n] of Object.entries(c.sup)) {
        const list = pick(isAmmoKey(k) ? "ammo" : "gear");
        split(n, list.map((b) => Math.max(0.1, b.room || b.weight || 1))).forEach((q, j) => { if (q > 0) put(list[j], k, q); });
        asgSup[k] = (asgSup[k] || 0) + n;
      }
      for (const ai of c.gear) {
        if (!armory[ai]) continue;
        const list = pick("gear");
        let j = 0;
        for (let i = 1; i < list.length; i++) if ((held.get(list[i]) || 0) / Math.max(0.1, list[i].room || 1) < (held.get(list[j]) || 0) / Math.max(0.1, list[j].room || 1)) j = i;
        const g = gOf(ai);
        list[j].gear.push(g); held.set(list[j], (held.get(list[j]) || 0) + g.kg);
        asgGear.add(ai);
      }
    }
  }
  // 3. The rest: by the room each container has left (dev's spread, in the room left after the assignments).
  const left = (b) => Math.max(0, (b.room || 0) - (held.get(b) || 0));
  const roomTot = real.reduce((a, b) => a + left(b), 0);
  const wOf = (b) => (roomTot > 0 ? left(b) : b.weight || 1);
  for (const [k, q0] of Object.entries(base.stock)) {
    const q = Math.floor(q0 || 0) - (asgSup[k] || 0);
    if (!(q > 0)) continue;
    const ammo = !!ammoBox && isAmmoKey(k); // the rounds and arrows kept inside: the ammo lockers
    const inN = real.length || ammo ? q - Math.min(q, out.sup[k] || 0) : 0;
    if (inN > 0 && ammo) ammoBox.sup[k] = (ammoBox.sup[k] || 0) + inN;
    else if (inN > 0) {
      const food = !!FOODS[k];
      const weights = real.map((b) => wOf(b) * (food && ["cellar", "coldstore", "freezer", "storehouse"].includes(typeOfStore(base, b)) ? 2 : 1) * rng.range(0.7, 1.3));
      split(inN, weights).forEach((n, i) => { if (n > 0) real[i].sup[k] = (real[i].sup[k] || 0) + n; });
    }
    // 2. What lies outside: the piles (with no real container on the map, everything there).
    const pileN = q - inN;
    if (pileN > 0) { const to = piles.length ? piles : [gearBox || boxes[0]]; split(pileN, to.map(() => 1)).forEach((n, i) => { if (n > 0) to[i].sup[k] = (to[i].sup[k] || 0) + n; }); }
  }
  const outside = new Set(out.gear);
  let pi = 0;
  armory.forEach((it, i) => {
    if (!it || asgGear.has(i)) return;
    const g = gOf(i);
    if (piles.length && (outside.has(i) || (!real.length && !gearBox))) { piles[pi++ % piles.length].gear.push(g); return; }
    if (gearBox) { gearBox.gear.push(g); return; } // every item kept inside: the gun cage
    if (!real.length) { boxes[0].gear.push(g); return; }
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
// A supply the ammo lockers hold: the abstract rounds and arrows, and any supply of the ammo kind (rounds by calibre).
const isAmmoKey = (k) => k === "ammo" || k === "arrows" || !!(SUPPLIES[k] && SUPPLIES[k].cat === "ammo");
// The building type behind a map container (a pile: "pile"; a car: "vehicle"; the core's parts: "core").
const typeOfStore = (base, s) => (s.pile ? "pile" : s.vid != null ? "vehicle" : s.bid == null ? "core" : (base.buildings.find((b) => b.id === s.bid) || {}).type || "core");
// The container at a cell of the battle (ui/combat.js hover and click), or null.
export const storeAt = (b, x, y) => (b.stores ? b.stores.containers.find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) || null : null);
// What is in a container, for the panel: [[name, qty], …] supplies first, then the gear.
export function storeContents(c) {
  const sup = Object.entries(c.sup).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => [SUPPLIES[k] ? SUPPLIES[k].name : FOODS[k] ? FOODS[k].name : k, n]);
  return { sup, gear: c.gear.map((g) => g.name), kg: Math.round(c.kg || 0), lock: c.lock ? { open: !!c.lock.open, smashed: !(c.lock.hp > 0), hp: c.lock.hp, mhp: c.lock.mhp, by: c.lock.by || null } : null };
}
// A container whose lock still holds (the armory's): a raider batters it before taking anything (forceLock).
export const lockedBox = (c) => !!(c && c.lock && !c.lock.open);

// ---------- the defenders' keys (the user's request 2026-10-19) ----------
// The base's own people hold its keys: in a fight on their base's map, anyone of the side holding it (b.holders) next
// to one of its locks unlocks it or locks it again, KEY_AP action, quiet, from either side of a door (combat.js
// combatAct "keylock" / "keyunlock"; the order buttons: ui/combat.js keyButtons). The map starts with everything locked.
//   A building's door (c.keyed: lay1): locked it is the barred door (bdoor) raiders batter down and your people pass;
//     unlocked it is a closed door (idoor) anyone opens by walking in (the dead still batter it), left open (odoor)
//     behind whoever went through until it is shut. Locking shuts it as well, with nobody in the doorway. The armory's
//     keeps its kind either way (c.dk: the security door) and its hit points.
//   The gate (c.keyed): locked it is barred (c.bar); unlocked it stands open to everyone, the dead too. Its cells go
//     together, with nobody in the gateway to lock it.
//   The armory's gun cage and ammo lockers (c.lock): unlocked with the key (lock.open, lock.keyed) a raider takes from
//     them without battering; a lock smashed open (lock.hp 0) can no longer be locked.
// Nothing broken (a door or the gate battered to 0) is locked or unlocked any more.
export const KEY_AP = 1;
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DOOR_KS = new Set(["bdoor", "idoor", "odoor"]);
const inBox = (c, x, y) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
// The cells of the gate a cell belongs to (its side's gate cells, side by side).
function gateCellsAt(b, x, y) {
  const out = [[x, y]];
  for (let i = 0; i < out.length; i++) for (const [dx, dy] of NEXT4) {
    const nx = out[i][0] + dx, ny = out[i][1] + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || out.some(([px, py]) => px === nx && py === ny)) continue;
    const n = b.cells[ny * b.w + nx];
    if (n.k === "gate" && n.keyed && n.hp > 0) out.push([nx, ny]);
  }
  return out;
}
// Does this unit hold the base's keys: one of the side holding the map, a person.
export const holdsKeys = (b, u) => !!(b && u && u.kind === "human" && u.side === (b.holders || "player") && !b.drill && !b.layout);
// The locks next to a unit it can work: [{ x, y, what: "door" | "gate" | "box", locked, name, cells (a gate's), id (a box's) }].
// A door or the gate right next to them (not diagonally), a container within a step (nearRect).
export function keyOptions(b, u) {
  if (!holdsKeys(b, u) || !active(u)) return [];
  const out = [], seen = new Set();
  for (const [dx, dy] of NEXT4) {
    const x = u.x + dx, y = u.y + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const c = b.cells[y * b.w + x];
    if (!c.keyed || !(c.hp > 0)) continue;
    if (DOOR_KS.has(c.k)) out.push({ x, y, what: "door", locked: c.k === "bdoor", name: c.dk ? structureName(c).toLowerCase() : "door" });
    else if (c.k === "gate") {
      const cells = gateCellsAt(b, x, y), key = cells.map((p) => p.join(",")).sort()[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, what: "gate", locked: !!c.bar, name: "gate", cells });
    }
  }
  if (b.stores) for (const c of b.stores.containers) if (c.lock && c.lock.hp > 0 && nearRect(c, u.x, u.y)) out.push({ x: c.x, y: c.y, what: "box", locked: !c.lock.open, name: c.label.toLowerCase(), id: c.id });
  return out;
}
// What a Lock or an Unlock would work on (keyOptions with the right state), the one at (x, y) when given.
export function keyTargets(b, u, lock, x = null, y = null) {
  const list = keyOptions(b, u).filter((o) => o.locked !== lock);
  if (x == null) return list;
  x = Number(x); y = Number(y);
  return list.filter((o) => (o.what === "box" ? inBox(b.stores.containers.find((c) => c.id === o.id), x, y) : o.what === "gate" ? o.cells.some(([gx, gy]) => gx === x && gy === y) : o.x === x && o.y === y));
}
// combatAct "keylock" / "keyunlock": { unit, x?, y? } (the lock clicked; else the only one next to them). H: { say }.
export function keyAct(state, b, u, act, H) {
  const lock = act.type === "keylock";
  if (!holdsKeys(b, u)) return "Only the base's own people hold its keys.";
  const o = keyTargets(b, u, lock, act.x, act.y)[0];
  if (!o) return lock ? "Stand next to an unlocked door, the open gate or an unlocked container of the base (a door or the gate not diagonally)." : "Stand next to a locked door, the gate or a locked container of the base (a door or the gate not diagonally).";
  if (u.ap < KEY_AP) return "No action left.";
  if (o.what === "door") {
    const c = b.cells[o.y * b.w + o.x];
    if (lock) {
      if (unitAt(b, o.x, o.y)) return "Somebody is standing in the doorway.";
      if (c.k === "odoor" && c.tOpen) c.t = c.tOpen;
      c.k = "bdoor";
    } else c.k = "idoor";
    delete c.held;
  } else if (o.what === "gate") {
    if (lock && o.cells.some(([x, y]) => unitAt(b, x, y))) return "Somebody is standing in the gateway.";
    for (const [x, y] of o.cells) b.cells[y * b.w + x].bar = lock;
  } else {
    const box = b.stores.containers.find((c) => c.id === o.id);
    box.lock.open = !lock;
    if (lock) delete box.lock.keyed; else box.lock.keyed = true;
  }
  if (b.losCache) b.losCache.fill(0);
  u.ap -= KEY_AP;
  u.hunker = false;
  u.face = [Math.sign(o.x - u.x), Math.sign(o.y - u.y)];
  const what = o.what === "box" ? `the ${o.name}` : `the ${o.name}`;
  H.say(b, lock ? `${u.name} ${o.what === "door" ? "shuts and locks" : o.what === "gate" ? "bars" : "locks"} ${what}.` : `${u.name} ${o.what === "gate" ? "unbars and opens" : "unlocks"} ${what}.`, "info");
  return "";
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
  // The goods and valuables before the woodpile (the user's rule 2026-10-20): a container with anything but wood in it
  // first, wherever it is; the woodpile (wood on the piles: outsideOf) only when nothing better is left, and never by
  // one already carrying goods (off with them instead). A pile left outside first among those (no lid, no lock, no
  // door to batter): the nearest one; the rest once the piles are bare, an open one before a lock. Whatever container
  // is right there is taken from all the same, the woodpile only as above.
  const goodsKg = (c) => c.kg - ((c.sup && c.sup.wood) || 0) * kgOf("wood");
  const rich = boxes.filter((c) => goodsKg(c) > 0.5);
  if (!rich.length && u.loot && u.loot.kg > 0) return leaveWithLoot(b, u);
  const pool = rich.length ? rich : boxes;
  const piles = pool.filter((c) => c.pile);
  const goal = piles.length ? piles : pool;
  const nearIn = (list, x, y) => list.filter((c) => nearRect(c, x, y)).sort((a, c) => lockedBox(a) - lockedBox(c))[0] || null;
  const near = (x, y) => nearIn(goal, x, y) || nearIn(pool, x, y);
  const here = near(u.x, u.y);
  if (here) { if (lockedBox(here)) forceLock(b, u, here); else takeLoot(b, u, here, { noWood: rich.length > 0 }); u.ap = 0; return true; }
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
      const box = near(u.x, u.y);
      if (box && u.ap > 0) { if (lockedBox(box)) forceLock(b, u, box); else takeLoot(b, u, box, { noWood: rich.length > 0 }); u.ap = 0; }
      continue;
    }
    // No way nearer: a barred door or a wall in the way is battered.
    const wall = siegeTarget(b, u, field);
    if (wall) { bash(b, u, wall[0], wall[1]); u.ap = 0; return true; }
    break;
  }
  return moved;
}
// A raider at one of the armory's locked containers batters the lock: one blow a turn (the whole turn) with what they
// carry, as a door is battered (combat.js bash: a melee weapon's damage, a gun as a club at ARMORY_LOCK.BASH), a pry
// tool ARMORY_LOCK.PRY times as hard; at 0 the lock is open (lock.open, lock.by: who smashed it) and the next turn
// takes from it (takeLoot). Loud: it is in the log for everyone. Returns true when a blow was struck.
export function forceLock(b, u, box) {
  const L = box.lock;
  if (!L || L.open) return false;
  const w = WEAPONS[u.weapon];
  const pry = ARMORY_LOCK.PRY_WEAPONS.includes(u.weapon);
  const base = (w && w.melee && w.dmg) || ARMORY_LOCK.BASH;
  const dmg = Math.max(1, Math.round(b.rng.int(base[0], base[1]) * (pry ? ARMORY_LOCK.PRY : 1) * (u.dmgMult || 1)));
  const was = L.hp;
  L.hp = Math.max(0, L.hp - dmg);
  const tx = Math.max(box.x, Math.min(box.x + box.w - 1, u.x)), ty = Math.max(box.y, Math.min(box.y + box.h - 1, u.y));
  fx(b, { type: "melee", from: [u.x, u.y], to: [tx, ty], hit: true, crit: false, dmg, side: u.side, text: L.hp > 0 ? `-${dmg}` : "LOCK BROKEN" });
  const label = box.label.toLowerCase();
  const tool = pry && w ? ` with the ${w.name.toLowerCase()}` : "";
  if (L.hp <= 0) { L.open = true; L.by = u.name; say(b, `${u.name} smashes the lock on the ${label} open${tool}.`, "danger"); }
  else if (was >= L.mhp) say(b, `${u.name} batters at the lock on the ${label}${tool} (${L.hp}/${L.mhp}).`, "danger");
  else if (was > L.mhp / 2 && L.hp <= L.mhp / 2) say(b, `The lock on the ${label} is giving way (${L.hp}/${L.mhp}).`, "danger");
  return true;
}
// A raider fills up from a container: the gear first, then supplies dear by the kilo (meds, parts, fuel, rounds, then
// the food, scrap and wood last; never water), up to STEAL.KG in all and STEAL.TURN a turn (a heavy item alone may
// take the turn), twice that from a pile left outside (STEAL.PILE). Nothing worth the weight left to take: off with
// what it has (u.loot.full).
export function takeLoot(b, u, box, opts = {}) { // opts.noWood: leave the woodpile while goods are left on the map (thiefTurn)
  u.loot = u.loot || { sup: {}, gear: [], kg: 0, from: {} };
  u.loot.from = u.loot.from || {}; // { [containerKey]: { k: n } }: what came out of the assigned part of each container (applyStolen: out of its bin)
  const carry = STEAL.KG - u.loot.kg;
  let room = Math.min(carry, STEAL.TURN * (box.pile ? STEAL.PILE : 1));
  const got = [];
  for (const g of box.gear.slice()) {
    if (g.kg > room && !(got.length === 0 && g.kg <= carry)) continue;
    box.gear.splice(box.gear.indexOf(g), 1);
    u.loot.gear.push(g); u.loot.kg += g.kg; room = Math.max(0, room - g.kg); box.kg -= g.kg;
    got.push(g.name);
  }
  const keys = Object.keys(box.sup).filter((k) => box.sup[k] > 0 && k !== "water" && k !== "rawwater" && !(opts.noWood && k === "wood"));
  const rank = (k) => { const i = TAKE_ORDER.indexOf(k); return i >= 0 ? i : FOODS[k] ? 5.5 - Math.min(0.4, FOODS[k].kcal / (FOODS[k].kg * 10000)) : SUPPLIES[k] && SUPPLIES[k].cat === "ammo" ? 6 : 8; };
  keys.sort((a, c) => rank(a) - rank(c));
  for (const k of keys) {
    const kg = Math.max(0.01, kgOf(k));
    const n = Math.min(box.sup[k], Math.floor(room / kg));
    if (n <= 0) continue;
    // The spread part (nobody's bin) goes first; what comes out of the assigned part is charged to the container's bin.
    const asg = (box.asg && box.asg[k]) || 0;
    const fromBin = Math.max(0, n - Math.max(0, box.sup[k] - asg));
    if (fromBin > 0 && box.key) { box.asg[k] = asg - fromBin; const f = u.loot.from[box.key] || (u.loot.from[box.key] = {}); f[k] = (f[k] || 0) + fromBin; }
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
  const stolen = { sup: {}, gear: [], kg: 0, from: {} }; // from: by the container it came out of (containers.js bins: applyStolen)
  for (const u of b.units) {
    if (!u.loot || !u.fled) continue;
    for (const [k, n] of Object.entries(u.loot.sup)) stolen.sup[k] = (stolen.sup[k] || 0) + n;
    for (const [key, got] of Object.entries(u.loot.from || {})) { const f = stolen.from[key] || (stolen.from[key] = {}); for (const [k, n] of Object.entries(got)) f[k] = (f[k] || 0) + n; }
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
  // The armory's locks smashed open (forceLock): MAP_WEAR.lock a lock on the armory (both: broken, its containers
  // open until it is repaired).
  if (b.stores) for (const c of b.stores.containers) if (c.lock && !(c.lock.hp > 0) && c.bid != null) wearOn(base.buildings.find((x) => x.id === c.bid), MAP_WEAR.lock); // smashed, not unlocked with the key
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
  // Out of the bins of the containers it was taken from (containers.js; a stolen item's assignment goes with it), as
  // much as really left the stock; then the bins made to agree with what is left.
  const bins = base.bins || {};
  for (const [key, got] of Object.entries(stolen.from || {})) {
    const bin = bins[key];
    if (!bin) continue;
    for (const [k, n] of Object.entries(got)) if (bin[k] > 0 && sup[k] > 0) { const q = Math.min(bin[k], n, sup[k]); bin[k] -= q; if (bin[k] <= 0) delete bin[k]; }
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
  if (base.bins) normalizeBins(state, base);
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
// Opens the base's map as a battle with nobody on it (the survivors never show: the user's request 2026-10-19), in
// layout mode: the queued buildings as outlines, every store's contents in view, and the picked item's footprint
// placed by a click (ui/combat.js layout mode). pick: the item to place first (a building just queued), or null.
// The layout record (b.layout): baseId, pick (an item key being placed), pickType (a building type to build: the
// ghost is its footprint and a click queues and places it), rot, sel (a placed item's key, for the panel), msg.
export function openBaseMap(state, baseId, pick = null) {
  if (state.combat) return "Finish the battle first.";
  const base = state.bases.find((x) => x.id === baseId);
  if (!base) return "";
  const b = viewBattle(state, base);
  b.layout = { baseId: base.id, pick: pick && itemByKey(state, base, pick) ? pick : null, pickType: null, sel: null, land: null, rot: 0, msg: "" };
  state.combat = b;
  return "";
}
function viewBattle(state, base, prev = null) {
  const setup = {
    mode: "battle", layout: "baseDefence", deploy: true, drill: true, baseId: base.id, canRetreat: false, handler: null,
    enemy: { kind: "zombies", count: 1, power: 1, types: { runner: 1 }, name: "nobody (the base map)" }, context: { baseId: base.id, drill: true, view: true, noPlan: true },
  };
  // The view's own dice (the base's, fixed): the same view every time it is made again (a building put down, a doorway
  // opened), and the game's dice left where they were (looking at the map changes nothing to come).
  const keepDice = state.rng.state;
  state.rng.state = (scatterSeed(base.tile) ^ 0x51ed27) >>> 0;
  let b;
  try { b = createBattle(state, setup); } finally { state.rng.state = keepDice; }
  b.units = []; // nobody on the map: the survivors do not show in the building view
  // A base with nobody at home (a camp whose people are all out) came out of createBattle lost, "over": the view took no
  // clicks at all. Nothing is fought here.
  b.over = false; b.result = null;
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
// The picked item's footprint (L.pick), or the footprint of the type to build (L.pickType: FOOT[bt]), over the hovered
// cell (centered on it): its map cells and whether it fits there (a fitting fits only on a general building's floor;
// a general building being moved is checked without what stands inside it, which moves along).
export function ghostAt(state, b, x, y) {
  const L = b.layout, F = b.deployPlan && b.deployPlan.fort;
  if (!L || !F || (!L.pick && !L.pickType)) return null;
  const base = state.bases.find((o) => o.id === L.baseId);
  if (!base) return null;
  const pf = L.pickType ? pickFoot(L.pickType) : null;
  const it = L.pick ? itemByKey(state, base, L.pick) : pf ? { ...pf, key: null, type: bagKindOf(L.pickType) ? "tent" : L.pickType, label: pickName(L.pickType), built: true } : null;
  if (!it) return null;
  const [w, h] = dimsOf(it, L.rot);
  const [gx, gy] = gridOfCell(b, x, y);
  const x0 = gx - Math.floor(w / 2), y0 = gy - Math.floor(h / 2);
  const skip = L.pick ? new Set([L.pick, ...hostedItems(state, base, it).map((o) => o.key)]) : null;
  const occ = occupancy(state, base, skip, null);
  const why = placeProblemAt(base, it, x0, y0, L.rot, occ) || reachProblem(state, base, it, [x0, y0, L.rot], occ, { skip }); // the hover's reason: layoutAct put / build refuse what is red here
  // Only the land in the way (basescatter.js): a click queues its clearing (layoutAct put / build).
  let land = null;
  if (why && why.startsWith(LAND_WHY) && occ.land) {
    const L0 = occ.land; occ.land = L0.waterOnly;
    if (!placeProblemAt(base, it, x0, y0, L.rot, occ) && !reachProblem(state, base, it, [x0, y0, L.rot], occ, { skip, noLand: true })) land = landUnder(L0, it, [x0, y0, L.rot]);
    occ.land = L0;
  }
  const cells = [];
  for (let yy = y0; yy < y0 + h; yy++) for (let xx = x0; xx < x0 + w; xx++) cells.push([xx + F.ox, yy + F.oy]);
  const doors = doorCellsOf(it, [x0, y0, L.rot]).map(([dx, dy]) => [dx + F.ox, dy + F.oy]);
  // The picked thing where it stands now (the playtest's pick: a dimmed copy stays there while its ghost follows the mouse).
  const was = L.pick ? it.at || autoLayout(state, base).get(L.pick) || null : null;
  const from = was ? rectCells(it, was).map(([fx, fy]) => [fx + F.ox, fy + F.oy]) : null;
  return { cells, doors, ok: !why, why, at: [x0, y0, L.rot], type: it.type, fit: !!it.fit, host: it.fit || it.indoor ? floorHostAt(occ, x0, y0) : null, land, from };
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
// A red site with only the land in the way, clicked: its clearing queued (the pick stays up, to be put down there once
// the ground is clear).
function clearSite(state, base, L, pieces) {
  holdAuto(state, base);
  const job = queueClear(state, base, pieces, { label: `Clear a site: ${landWords(pieces)}` });
  L.msg = job ? `${job.label} queued (${job.hours} work-hours): the builders clear it from the construction queue; then it can go there.` : "Its clearing is queued already.";
  refreshBaseMap(state);
  return "";
}
// Layout mode's commands (combat.js combatAct via deploy.js): pick an item, turn it, put it down at a map cell, Move
// one (lift: picked, its ghost under the mouse, it and the map left as they are until it is put down), let the game
// place one again (unplace), close the view; base building (2026-10-19): select a placed thing
// (sel), pick a type to build (pickType), build it at a cell (queueBuild and the job placed at the ghost; a failed
// placement cancels the job and returns why), open or close a doorway (link / unlink), pull a building down or cancel
// a job (demolish). Returns an error, or "".
export function layoutAct(state, b, act) {
  const L = b.layout;
  if (!L) return "Not the base map.";
  const base = state.bases.find((o) => o.id === L.baseId);
  if (!base) { state.combat = null; return ""; }
  switch (act.type) {
    case "pick": L.pick = act.key && itemByKey(state, base, act.key) ? act.key : null; L.pickType = null; L.msg = ""; return "";
    case "rotate": L.rot = (L.rot + 1) & 3; return "";
    case "select": L.sel = act.key && itemByKey(state, base, act.key) ? act.key : null; if (L.sel) L.land = null; return "";
    // The land (basescatter.js): a piece's card (land: its grid cell), and its clearing queued (clump: the stand of
    // trees, the hedgerow or the fence run it is part of; mode "strip": a wreck stripped of its scrap and a part).
    case "unclear": { const job = base.construction.find((c) => c.id === Number(act.id) && c.type === "clear"); if (!job) return "That clearing is gone."; L.msg = cancelBuild(state, base, job.id); refreshBaseMap(state); return ""; }
    case "land": { const [gx, gy] = gridOfCell(b, Number(act.x), Number(act.y)); L.land = landPieceAt(state, base, gx, gy).length ? [gx, gy] : null; if (L.land) L.sel = null; return ""; }
    // The tunnels the dead dug (tunnels.js): a hole's card (tunnel: the record's id), Fill tunnel queued, cancelled.
    case "tunnel": { const r = act.id != null ? (base.tunnels || []).find((q) => q.id === Number(act.id)) : tunnelAt(base, Number(act.x), Number(act.y)); L.tunnel = r ? r.id : null; if (r) { L.sel = null; L.land = null; } return ""; }
    case "fillTunnel": { const job = queueFill(state, base, Number(act.id ?? L.tunnel)); if (!job) return "Already queued, or the tunnel is gone."; L.msg = `${job.label} queued first (${job.hours} work-hours): the builders fill it before the rest.`; return ""; }
    case "unfill": { const job = base.construction.find((c) => c.id === Number(act.id) && c.type === "filltunnel"); if (!job) return "That job is gone."; L.msg = cancelBuild(state, base, job.id); return ""; }
    case "clear": {
      const at = act.x != null ? gridOfCell(b, Number(act.x), Number(act.y)) : L.land;
      const list = at ? landPieceAt(state, base, at[0], at[1], !!act.clump) : [];
      if (!list.length) return "Nothing there to clear.";
      holdAuto(state, base);
      const job = queueClear(state, base, list, { mode: act.mode === "strip" ? "strip" : "clear" });
      if (!job) return act.mode === "strip" ? "Already stripped, or queued." : "Already queued.";
      L.msg = `${job.label} queued (${job.hours} work-hours${Object.keys(job.get).length ? `: ${Object.entries(job.get).map(([k, v]) => `+${v} ${k === "carparts" ? "car parts" : k}`).join(", ")}` : ""}): the builders do it from the construction queue.`;
      refreshBaseMap(state);
      return "";
    }
    case "pickType": {
      if (act.bt && !pickFoot(act.bt)) return "That is not built on the map.";
      L.pickType = act.bt || null; L.pick = null; L.rot = 0; L.msg = "";
      return "";
    }
    case "build": {
      if (!L.pickType) return "Pick something to build first.";
      const bt = L.pickType, d = BUILDINGS[bt];
      const g = ghostAt(state, b, Number(act.x), Number(act.y));
      if (!g) return "Nothing to build.";
      if (!g.ok && g.land) return clearSite(state, base, L, g.land);
      if (!g.ok) return g.why;
      if (d && d.furniture) return setFurnitureAt(state, b, base, bt, g); // beds.js: set from the stores where it was clicked (no job)
      if (bagKindOf(bt)) { // tents.js: a tent bag from the stores pitched where it was clicked (no job, no cost)
        holdAuto(state, base);
        const kind = bagKindOf(bt), r = pitchStoredBag(state, base, kind, g.at);
        if (r.error) return r.error;
        L.msg = `${TENTS[kind].name} pitched there: +${TENTS[kind].sleepers} bed${TENTS[kind].sleepers === 1 ? "" : "s"}${TENTS[kind].storeKg ? `, ${TENTS[kind].storeKg} kg out of the weather` : ""}.`;
        L.sel = `b:${r.id}`;
        if (!bagsInStores(base, kind)) L.pickType = null; // none left to pitch
        refreshBaseMap(state);
        return "";
      }
      const opts = pieceOpts(base, bt);
      const chk = canBuild(state, base, bt, opts);
      if (!chk.ok) return chk.reason || "It cannot be built here now.";
      holdAuto(state, base); // what the game placed stays where it is (autoLayout)
      const text = queueBuild(state, base, bt, opts);
      const job = base.construction.filter((c) => c.type === bt && !c.target).pop();
      if (!job) return text;
      const err = placeItem(state, base, `c:${job.id}`, g.at[0], g.at[1], g.at[2]);
      if (err) { cancelBuild(state, base, job.id); return err; }
      L.msg = `${d && d.piece ? pieceName({ type: bt, ...opts }) : d ? d.name : bt} queued and placed${g.host ? " inside" : ""}: the builders will put it up there.`;
      L.sel = `c:${job.id}`;
      refreshBaseMap(state);
      return "";
    }
    case "link": {
      holdAuto(state, base);
      const err = linkBuildings(state, base, act.a, act.b);
      if (err) return err;
      L.msg = "A doorway opened between them.";
      refreshBaseMap(state);
      return "";
    }
    case "unlink": {
      holdAuto(state, base);
      const err = unlinkBuildings(state, base, act.a, act.b);
      if (err) return err;
      L.msg = "The doorway is walled up again.";
      refreshBaseMap(state);
      return "";
    }
    case "demolish": {
      const it = itemByKey(state, base, act.key);
      if (!it || !it.rec) return "That is gone.";
      let text;
      holdAuto(state, base);
      if (it.key.startsWith("b:")) { const chk = canDemolish(state, base, it.rec.id); if (!chk.ok) return chk.reason; text = demolish(state, base, it.rec.id); }
      else if (it.key.startsWith("c:")) text = cancelBuild(state, base, it.rec.id);
      else return "Only a building or a job in the queue.";
      if (L.pick === act.key) L.pick = null;
      if (L.sel === act.key) L.sel = null;
      L.msg = text;
      refreshBaseMap(state);
      return "";
    }
    case "put": {
      if (!L.pick) return "Pick something to place first (the list on the right), or click a placed thing to move it.";
      const g = ghostAt(state, b, Number(act.x), Number(act.y));
      if (!g) return "Nothing picked.";
      if (!g.ok && g.land) return clearSite(state, base, L, g.land);
      if (!g.ok) return g.why;
      holdAuto(state, base); // the rest stays where the game had it (autoLayout)
      const err = placeItem(state, base, L.pick, g.at[0], g.at[1], g.at[2]);
      if (err) return err;
      const it = itemByKey(state, base, L.pick);
      L.msg = `${it ? it.label : "It"} placed.`;
      L.pick = null;
      refreshBaseMap(state);
      return "";
    }
    case "lift": { // Move (the playtest 2026-10-20: the map was made again on every Move): only the pick, its ghost under
      // the mouse; it stays where it stands (and so does everything else, the map and the view) until it is put down.
      const e = layoutOf(state, base).find((q) => q.it.key === act.key);
      if (!e) return "That is gone.";
      L.pick = act.key;
      L.pickType = null;
      L.rot = e.at ? e.at[2] || 0 : 0;
      L.msg = `${e.it.label}: click where it goes (R turns it, Esc leaves it where it is).`;
      return "";
    }
    case "unplace": {
      const it = itemByKey(state, base, act.key);
      if (!it) return "That is gone.";
      holdAuto(state, base);
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
// What can be built on the map (the layout panel's Build section, ui/basemap.js): every building type with a
// footprint and every fitting, by group, each with whether it can go up now (canBuild) and why not.
// A wall piece or gate built from the map is of the material the wall is mostly of (buildings.js ringMat: wood with
// none); the Defenses tab picks another. A stand has no material.
const pieceOpts = (base, bt) => (BUILDINGS[bt] && BUILDINGS[bt].piece && BUILDINGS[bt].piece !== "stand" ? { mat: ringMat(base) } : {});
const MENU_GROUPS = ["Tents", "General buildings", "Fittings", "Furniture", "Buildings", "Yard things", "Defences"];
export function buildMenu(state, base) {
  const out = [];
  for (const [type, d] of Object.entries(BUILDINGS)) {
    const f = FOOT[type];
    if (!f || d.upgradeOnly) continue; // an upgrade in place (the reloading bench) is queued from the building it upgrades
    const group = type === "tent" ? "Tents" : d.general ? "General buildings" : d.furniture ? "Furniture" : d.fit ? "Fittings" : f.kind === "defence" || WALL_KINDS.has(f.kind) ? "Defences" : f.kind === "prop" || f.kind === "pen" ? "Yard things" : "Buildings";
    const opts = pieceOpts(base, type);
    /** @type {any} */
    const chk = canBuild(state, base, type, opts);
    const piece = !!d.piece; // a wall piece, gate or stand: its material's name, cost and hours (buildings.js canBuildPiece)
    out.push({ type, name: piece ? pieceName({ type, ...opts }) : d.name, group, w: f.w, h: f.h, cost: piece && chk.cost ? { ...chk.cost } : { ...d.cost }, hours: piece && chk.hours != null ? chk.hours : d.hours, ok: !!chk.ok, why: chk.ok ? "" : chk.reason || "", desc: d.desc || "", ...(d.furniture ? { furniture: true, have: furnitureInStores(base, type) } : {}) });
  }
  // The tent bags in the stores (tents.js), pitched from the list: no cost, no builders (a click pitches one).
  for (const [k, T] of Object.entries(TENTS)) {
    if (!T.bag) continue;
    const have = bagsInStores(base, k);
    out.push({ type: `${BAG_PICK}${k}`, name: `${T.name} (bag)`, group: "Tents", w: T.w, h: T.h, cost: {}, hours: 0, ok: have > 0, why: have ? "" : `No ${T.name.toLowerCase()} bag in the stores: find one, or bring one home`, desc: `Pitch a ${T.name.toLowerCase()} from its bag in the stores: sleeps ${T.sleepers}, keeps ${T.storeKg} kg out of the weather. Strike it to pack it back into its bag.`, tentBag: true, have });
  }
  return out.sort((a, b) => MENU_GROUPS.indexOf(a.group) - MENU_GROUPS.indexOf(b.group)); // stable: BUILDINGS' order within a group
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
