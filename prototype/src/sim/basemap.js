// The base map (2026-10-19, user request): every base, from a camp to the biggest hub, has a square grid map of its
// own with the camp, shelter or base itself in the middle, and the player lays out where every building, field,
// defence and parked car goes on it. The same map is the one fought over when a horde or a raid reaches the base
// (fort.js builds the battle from it), so where things stand is where they are defended.
//
// The grid (BASE_GRID, the user's request 2026-10-22: "Increase the Base map sizes to be all the same 250x250 base
// size"): every base's map is 500 × 500, a camp's as a hub's. Within it the yard grows by tier (GRID: 76 × 76 round the
// camp, shelter or base itself since 2026-10-23 (YARD), a camp's and a shelter's staying so, an outpost's growing to 100
// and the main hub's to 180 as buildings go up: "scale up and down": the yard half-size grows GRID.per cells a building with a footprint, up to
// GRID.cap, never past the map's edge (gridOf) and never below what is placed). Coordinates are relative to the base
// itself (0, 0), so a base that grows keeps every placement. Where the base stands on its map (base.plan.origin: the
// cells from the map's middle to it) is picked when its camp is set up (the camp's spot: chooseSite, staging.js; the
// user's request 2026-10-22: "choose where in the 250 x 250 with a highlighted 10x10 to start"); a base from before
// that, or one occupied, taken or handed over, stands in the middle. gridBox is the map's extent in grid coordinates.
//   The yard: the square [-C, C) the buildings, fields and cars stand in (C = yardHalf), one cell clear of its edge.
//   The ring (ringHalf R: the yard's half-size when the first wall piece went up, base.plan.ring; the yard's own
//     before): the two cells round [-R, R) where the game lays the wall pieces and gates it places itself (the outer
//     line, ±(R + 1)) and the wall stands (the inner one, ±R). Nothing else goes on it; walls, gates and stands go
//     anywhere (the user's request 2026-10-19: walls placed and turned by hand, 1×1, 1×2, 1×4; gates 1×4; stands).
//   Outside: open ground to the grid's edge, where defences (and nothing else) may also go: a trench or spike pits
//     well out in front of the wall, a watchtower on the approach.
// The battle map (fort.js buildFort) is the grid cropped to what stands on it (the band, every defence and car) plus
// FORT.MARGIN of open ground all round, so attackers come at it from the north, east, south or west edge as they did
// on the fort map; the Base map tab's view (openBaseMap) is the build map instead: 150 × 150 round the base (VIEW_HALF,
// the user's request 2026-10-23: "Increase base size from 56x56 to 150x150 selected from a 500x500 map from 250x250";
// a new camp's view was 56 × 56 and the tile's map 250 × 250 before BASE_GRID went to 500), slid back onto the map by its
// edge, with nothing placed within VIEW_EDGE (3) cells of its edge: you build out from the camp to the 150 × 150 less
// that margin (the user's request 2026-10-24).
//
// Placement (placeItem / placeProblemAt): every building, construction job, crop plot and car is an item (itemsOf)
// with a footprint (FOOT: w × h cells and what it is on the map, turned by r = 0–3 quarter turns) and a position: the
// top-left cell of its footprint in grid coordinates, kept on the record itself (bld.at = [x, y, r] on a building,
// job.at on a queued one, vehicle.at on a car; a crop plot is a Farm plot building, at on its record). The one rule (user request,
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
import { BUILDINGS, STORE_KG, CAMP, TENTS, tentKind, tentOf, count, isCamp, isShelter, tierName, canBuild, queueBuild, cancelBuild, canDemolish, demolish, pieceName, pieceHp, matOf, ringMat, WALL_TIERS, WALL_DAMAGED } from "./buildings.js"; // (call-time only: the modules load in a circle) canBuild…demolish: the view's Build, Demolish; pieceName…: the wall pieces
import { CELL, placeCar, say, fx, unitAt, active, distField, reachable, pathTo, moveAlong, bash, siegeTarget, foesOf, nearRect, createBattle, barredCell, WEAPONS, structureName } from "./combat.js";
import { carsAtBase } from "./vehicles.js";
import { DEPLOY } from "./deploy.js"; // the reinforced gate's hit points (call-time only)
import { INTERIOR, layoutSeed } from "./interior.js";
import { cragWays } from "./relief.js"; // a base map's crag leaves the ways in open (tools/mapreachtest.js)
import { landSpec, landOf as landMapOf, layLand, landBeyond, BEYOND_R, scatterSeed, clearOf, pieceWord, CLEAR, SITE, siteBox, siteGet, siteLevel } from "./basescatter.js"; // the land of the base map: trees, bushes, fences, rocks, wrecks, a road, a river (fixed by the tile, the same in the view and in a fight); clearing it
import { Rng } from "./rng.js";
import { bestSite } from "./siteinfo.js"; // the game's own camp spot by the spot's facts (call-time only: siteinfo.js reads this module)
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
import { knownMask } from "./campscout.js"; // a camp set up blind: the view's known ground (call-time only)
import { cfgOf } from "./worldcfg.js"; // the run's dials: Base yard to start / at most
import { terraBusy, terraJobs, terraLeft, terraPct, terraModeOf, terraPlan, terraLevels, queueTerra, cancelTerra, dirtProblem, shovelCrew, unEdit, TERRA, TERRA_PICK, TERRA_NAME, TERRA_VERB } from "./terraform.js"; // terraforming: hollows dug, hills raised (call-time only)
import { storageOf, coreStoreKg, vehicleStoreKg, woodpileOf } from "./basestorage.js"; // the base's room and what lies outside (call-time only)
import { BED_FOOT } from "./data-beds.js"; // beds as furniture: a cot, bed or bunk bed 1 × 2, a large bed 2 × 2, on a general building's floor
import { setFurnitureAt, furnitureInStores } from "./beds.js"; // beds as furniture: set from the stores where the ghost is (call-time only)
import { POWER_FOOT, SPOT } from "./data-power.js"; // the power grid: found generators, spotlights (on a wall stand or the ground), fridges, the panel, the press, the pump, the charger
import { isSetPiece, setPlacedAt, placedInStores, spotOn, fenceCharged } from "./electric.js"; // set from the stores; a spotlight lit, the wire charged (call-time only)
import { pondsOn, pondWhy, pondWaits } from "./ponds.js"; // the hollows' ponds and mud: nothing built on them or filled in until dry

// The grid by tier: core = the half-size of the middle structure's own ground, yard = the yard's half-size to start
// with, per = yard growth a building with a footprint, cap = the yard's largest half-size (never past the map's edge,
// less the band and the no-build margin: gridOf).
// The user's request 2026-10-23: "The yard for bases should be 75 x 75": every tier's yard starts at YARD (76 × 76: the
// yard is square round the base itself, so an even number of cells; 75 would need a half cell); a camp's and a
// shelter's stay there, an outpost's grows to 100 and the main hub's to 140 (it was 180: the build map is 150 × 150 now, VIEW_ROOM).
export const YARD = 38;
export const GRID = {
  camp:    { core: 4, yard: YARD, per: 0, cap: YARD },  // the camp itself within 76 × 76
  shelter: { core: 6, yard: YARD, per: 0, cap: YARD },  // 76 × 76
  outpost: { core: 6, yard: YARD, per: 2, cap: 50 },    // 76 growing to 100
  hub:     { core: 8, yard: YARD, per: 3, cap: 70 },    // 76 growing to 140 (VIEW_ROOM: the 150 × 150 build map less its margin)
};
export const BASE_GRID = 500; // every base's map: 500 × 500 cells
export const GRID_MAX = BASE_GRID / 2; // the grid's half-size
export const MARGIN = 8;     // open ground round what stands on the battle map (fort.js FORT.MARGIN)
// The build map's size (the user's requests 2026-10-23/24: "Increase the base map size double the size after selecting
// your base location"; "Increase the base building area even when it's a campsite to be a margin of 3 tiles away from
// the map border"; "the map should be 150x150 after you select your camp location on the 500x500 board. You can build
// out from your camp site to the 150x150 minus the 3 margin along the outer border"): the view (openBaseMap) is
// 150 × 150 round the base for every tier (VIEW_HALF 75), slid back onto the map by its edge, and does not grow as
// things are placed: nothing is placed within the VIEW_EDGE cells nearest its edge (tinted, c.nb: viewEdgeWhy). The
// yard and its wall ring stay inside it (VIEW_ROOM). Only what stood outside it already (a base from before) widens
// it. The 500 × 500 is the tile's map the camp's spot is picked on (the site view); the battle maps keep their own crop.
export const VIEW_HALF = { camp: 75, shelter: 75, outpost: 75, hub: 75 }, VIEW_EDGE = 3;
export const VIEW_ROOM = VIEW_HALF.hub - VIEW_EDGE - 2; // the most a yard's half-size may be: the ring's band (two cells) and the edge's margin stay on the build map
export const VIEW_EDGE_WHY = `Within ${VIEW_EDGE} cells of the map's edge (nothing is built there)`;
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
export const MAP_WEAR = { door: 15, window: 8, breach: 30, barricade: 60, lock: 50, carCondition: 60, sandbag: 100 }; // sandbag: a 1×1 Sandbags smashed or shoved off its cell is burst (broken: refilled as a repair)

export const tierKey = (base) => (isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost");
// The grid by tier, under the run's Base yard dials (worldcfg.js baseMin / baseMax, stamped on the base as base.gridCfg by
// stampGrid from wherever a state is to hand: the yard to start with and the most it grows to are scaled, the yard
// never under the core's ground + 2, the cap never under the yard nor past GRID_MAX; a standard run reads GRID itself).
export function gridOf(base) {
  const g = GRID[tierKey(base)];
  const c = base && base.gridCfg;
  const room = edgeRoom(base); // the yard never runs off the map: a base set up near its edge grows only as far as it
  if ((!c || (c.min === 1 && c.max === 1)) && g.cap <= room) return g;
  const yard = Math.max(g.core + 2, Math.min(room, Math.round(g.yard * (c ? c.min : 1))));
  const cap = Math.max(yard, Math.min(room, Math.round(g.cap * (c ? c.max : 1))));
  return { ...g, yard, cap };
}
// Where the base stands on its map: [x, y] cells from the map's middle (base.plan.origin; [0, 0] in the middle).
export const originOf = (base) => (base && base.plan && Array.isArray(base.plan.origin) ? base.plan.origin : [0, 0]);
// The map's extent in grid coordinates (relative to the base itself), half-open: { x0, y0, x1, y1 }.
export function gridBox(base) {
  const [ox, oy] = originOf(base);
  return { x0: -GRID_MAX - ox, y0: -GRID_MAX - oy, x1: GRID_MAX - ox, y1: GRID_MAX - oy };
}
const onGrid = (B, x, y) => x >= B.x0 && y >= B.y0 && x < B.x1 && y < B.y1;
// The most the yard's half-size may be with the ring's band and the no-build margin still on the map.
export const edgeRoom = (base) => { const [ox, oy] = originOf(base); return Math.min(VIEW_ROOM, GRID_MAX - NO_BUILD - 2 - Math.max(Math.abs(ox), Math.abs(oy))); };
// A base whose camp was set up on its own spot (base.plan.fresh, staging.js makeCamp): its land is the tile's own all
// round (no yard swept for it), the clearing its setup made is cleared ground like any other, and the camp fire stays
// the middle of the base whatever its tier (its shelter, outpost or main house is a building placed on the map).
export const freshBase = (base) => !!(base && base.plan && base.plan.fresh);
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
// camouflage, cots, the upgrades in place) are not on the map as things of their own.
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
  // The step ups (buildings.js tierUp, the user's request 2026-10-22): the shelter shack, the outpost house and the main
  // house are buildings placed on the map like any other.
  camp_up: HOUSE(5, 4), outpost_up: HOUSE(5, 4), hub_up: HOUSE(6, 5, 2),
  armory: HOUSE(5, 4, 1, { armory: true }), // armoryCells: one locked security door, no windows, the gun cage and the ammo lockers inside
  well: PROP("well"), rain_catcher: PROP("barrel"), water_barrel: PROP("barrel"), crates: PROP("crate", 1, 1, { v: 2 }), boiler: PROP("barrel"),
  cookhouse: PROP("firepit"), smoker: PROP("table", 2, 1), generator: PROP("pump", 2, 1), still: PROP("barrel"), sealer: PROP("table"), grainmill: PROP("table"),
  meatgrinder: PROP("table"), craftbench: PROP("counter", 2, 1), workbench: PROP("counter", 2, 1), toolbench: PROP("counter", 2, 1), ammo_bench: PROP("counter", 2, 1),
  reload_bench: PROP("counter", 2, 1), med_station: PROP("counter", 2, 1), lockup: PROP("bars", 2, 2), relay: PROP("locker"),
  animal_pen: { kind: "pen", w: 4, h: 3 },
  farm_plot: { kind: "field", w: 2, h: 2 }, // a crop plot (buildings.js farm_plot): 2 × 2 of tilled soil, only on soil (SOIL)
  barricades: DEF("barricade", 3, 1), spike_pits: DEF("spikes", 3, 2), trench: DEF("trench", 16, 1), floodlights: DEF("lamp", 1, 1), watchtower: DEF("tower", 2, 2),
  sandbag_wall: DEF("sandbag", 4, 1), // the Defenses tab's sandbag positions: 4 cells, placed like a barricade
  sandbag1: DEF("sandbag", 1, 1), // Sandbags (buildings.js sandbag1): one cell; side by side they are drawn as one wall (ui/isoview.js)
  // The wall pieces (buildings.js piece): a line of wall cells, a 1×4 gate, a raised wall stand; turned by R.
  wall1: { kind: "wall", w: 1, h: 1 }, wall2: { kind: "wall", w: 2, h: 1 }, wall4: { kind: "wall", w: 4, h: 1 }, gate4: { kind: "gate", w: 4, h: 1 },
  stand1: { kind: "stand", w: 1, h: 1 }, stand2: { kind: "stand", w: 2, h: 1 }, stand4: { kind: "stand", w: 4, h: 1 },
  // Not placed (laid round the wall by the map itself: the wire rings, the guard towers on the walkway, the minefield
  // in the open ground): barbed_wire, razor_wire, guard_towers, minefield.
};
Object.assign(FOOT, BED_FOOT); // beds as furniture (data-beds.js, beds.js): fittings set from the stores, drawn as bed cells
Object.assign(FOOT, POWER_FOOT); // the power grid (data-power.js): a spotlight may stand on a wall stand's cell (mount), a fridge on a floor (fit)
export const FIELD = FOOT.farm_plot; // a crop plot's footprint
// Soil (the user's request 2026-10-22: "Farm plots can only be set on soil tiles in a base map"): a crop plot (a field)
// goes only on bare ground, the grass and dirt of the land; never the road, a paved lot or a ford (the land's floors:
// basescatter.js landOf), the water, or a building's floor.
export const NOT_SOIL = new Set(["road", "gravel", "rubble", "floor", "roof", "deck"]);
export const SOIL_WHY = "Crop plots go on soil only: not on the road or paved ground";
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
// The middle by tier, but a base founded on its own spot (freshBase) or whose shelter, outpost or main house stands as
// a building of its own (the step up placed on the map: buildings.js camp_up, outpost_up, hub_up; tierBuilt) keeps the
// camp's: its fire and its cache, with that building wherever it was placed.
export const tierBuilt = (base) => !!base && (base.buildings || []).some((b) => BUILDINGS[b.type] && BUILDINGS[b.type].tierUp);
const coreKey = (base) => (freshBase(base) || tierBuilt(base) ? "camp" : tierKey(base));
// A camp's middle is its fire and its cache; the fire itself is moved by hand in build mode (the user's request
// 2026-10-22: "You can move the campfire around as well in the build mode"): it is an item of its own on the map (FIRE:
// key k:fire, base.plan.fireSpot, [0, 0] until it is moved), so coreParts leaves it out where the camp's middle is kept.
export const FIRE = { KEY: "k:fire", TYPE: "campfire", LABEL: "Camp fire", FOOT: { kind: "prop", k: "firepit", w: 1, h: 1 } };
export const movableFire = (base) => !!base && base.id != null && base.id >= 0 && !base.group && coreKey(base) === "camp";
export const coreParts = (base) => (movableFire(base) ? CORE.camp.filter((p) => p.k !== "firepit") : CORE[coreKey(base)]);
// Where the camp fire stands (grid coordinates [x, y, r]); null where the fire is part of the middle (a shelter's, a base's).
export const fireSpot = (base) => (!movableFire(base) ? null : base.plan && Array.isArray(base.plan.fireSpot) ? base.plan.fireSpot : [0, 0, 0]);
// The land the base stands on, for its scatter (basescatter.js PROFILES): the tile's terrain, a farm's or a ranch's
// fields as "farm".
export function terrainOf(state, base) {
  const t = state && state.tiles && base ? state.tiles[base.tile] : null;
  if (!t) return "plains";
  if (t.loc && ["farm", "ranch", "barn"].includes(t.loc.type)) return "farm";
  if (t.loc && t.loc.type === "town" && t.terrain !== "city") return "suburb"; // a town's own tile: its streets and houses (basescatter.js townLayer)
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
// inside a building that already counts; not the wall pieces: they stand round it; not the crop plots, 2 × 2 of soil
// each, as the old free plots never did).
const grows = (type) => { const f = FOOT[type]; return !!f && f.kind !== "defence" && f.kind !== "field" && !f.fit && !WALL_KINDS.has(f.kind); };
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
// The grid's half-size (every base's map is BASE_GRID square; where the base stands on it: gridBox).
export const gridHalf = (base) => GRID_MAX;
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
export const planOf = (base) => base.plan || (base.plan = {});
// Every item that goes on the map, in a fixed order (the auto layout fills them in this order): standing buildings
// (b:id), queued ones with a footprint (c:id), the crop plots (p:i) and the cars parked here (v:id). at: where it was
// placed by hand, else null. built: false for a queued job (an outline in the view, open ground in a raid).
export function itemsOf(state, base) {
  stampGrid(state, base);
  const out = [];
  const seen = {};
  const n = (type) => (seen[type] = (seen[type] || 0) + 1);
  const fs = fireSpot(base); // the camp fire, moved by hand (FIRE): always on the map, never placed by the game
  if (fs) out.push({ key: FIRE.KEY, type: FIRE.TYPE, ...FIRE.FOOT, label: FIRE.LABEL, at: fs.slice(), rec: null, built: true, fire: true });
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
// A wall stand's cells also go in stand, a spotlight's (FOOT mount) in mount: a spotlight may stand on a stand's cell
// (placeProblemAt), never two on one.
function markOcc(occ, it, at, key) {
  const put = (m, x, y, v) => { if (!m.has(K(x, y))) m.set(K(x, y), v); };
  if (hostOf(it)) for (const c of cellsOf(it, at)) put(isFloor(c) ? occ.floor : occ.foot, c.x, c.y, key);
  else for (const [x, y] of rectCells(it, at)) put(occ.foot, x, y, key);
  if (it.kind === "stand" && occ.stand) for (const [x, y] of rectCells(it, at)) occ.stand.add(K(x, y));
  if (it.mount && occ.mount) for (const [x, y] of rectCells(it, at)) occ.mount.add(K(x, y));
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
  const occ = { foot: new Map(), door: new Map(), floor: new Map(), names: new Map(), stand: new Set(), mount: new Set(), land: landFor(state, base), work: new Map() }; // land: what has to be cleared before anything is built on it (basescatter.js); work: the ground being terraformed (terraform.js)
  for (const [k, j] of terraBusy(base)) { const [x, y] = k.split(",").map(Number); occ.work.set(K(x, y), j); }
  if (occ.land && occ.land.heights && occ.land.heights.size) occ.ponds = pondsOn(state, base.tile); // ponds.js: the hollows wet or dry today (placeProblemAt)
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
// Why an item cannot stand at (x, y) turned r, or "" when it can. occ: occupancy(…) without this item; dims: { B (gridBox), R }
// worked out once (autoLayout). The rules (2026-10-19): on the map and not within the no-build margin (NO_BUILD);
// never on the ring's band (the wall pieces may: WALL_KINDS), on top of anything, in a doorway (the cell outside or
// inside a door, either side of a gate); a fitting wholly on one standing general building's floor, an indoor prop
// there or anywhere in the yard, and anything else never on a floor cell.
export function placeProblemAt(base, it, x, y, r, occ, dims = null) {
  const at = [x, y, r & 3];
  const rect = rectOf(it, at);
  const B = dims && dims.B ? dims.B : gridBox(base), R = dims ? dims.R : ringHalf(base), wallish = WALL_KINDS.has(it.kind);
  if (rect.x0 < B.x0 || rect.y0 < B.y0 || rect.x0 + rect.w > B.x1 || rect.y0 + rect.h > B.y1) return "Off the map";
  if (rect.x0 < B.x0 + NO_BUILD || rect.y0 < B.y0 + NO_BUILD || rect.x0 + rect.w > B.x1 - NO_BUILD || rect.y0 + rect.h > B.y1 - NO_BUILD) return NO_BUILD_WHY;
  const inner = !!(it.fit || it.indoor);
  let host = null, mounted = false;
  for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) {
    const k = K(xx, yy);
    // A spotlight (FOOT mount) on a wall stand's cell: up on the stand, the ring's band too; never two on one cell.
    if (it.mount && occ.mount && occ.mount.has(k)) return "There is a spotlight there already";
    if (it.mount && occ.stand && occ.stand.has(k)) { mounted = true; continue; }
    if (!wallish && onBand(xx, yy, R)) return "That is where the wall stands";
    if (occ.foot.has(k)) return `On top of ${nameOf(occ, occ.foot.get(k))}`;
    if (occ.door.has(k)) return `In the doorway of ${nameOf(occ, occ.door.get(k))}`;
    if (occ.work && occ.work.has(k)) return `On ground being ${occ.work.get(k).mode === "raise" ? "raised" : "dug"} (${occ.work.get(k).label.toLowerCase()}): wait for it, or cancel it`; // terraform.js
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
  if (occ.land && !(host != null) && !mounted) {
    const wet = occ.ponds ? pondWhy(occ.ponds, occ.land.heights, rectCells(it, at), occ.land.springs) : ""; // ponds.js: a pond or mud in a hollow, until it dries (a spring's pond never)
    if (wet) return wet;
    const hit = landUnder(occ.land, it, at);
    if (hit.length) return landWhy(hit);
    const uneven = groundWhy(occ.land, it, at);
    if (uneven) return uneven;
  }
  // A crop plot only on soil (NOT_SOIL: the land's road, paved lots and fords).
  if (it.kind === "field" && occ.land && occ.land.floors) for (const [cx, cy] of rectCells(it, at)) if (NOT_SOIL.has(occ.land.floors.get(`${cx},${cy}`))) return SOIL_WHY;
  return "";
}
const nameOf = (occ, key) => (key === "core" ? "the base itself" : key.startsWith("v:") ? "a parked car" : key.startsWith("w:") ? "the wall" : occ && occ.names && occ.names.get(key) ? occ.names.get(key) : key.startsWith("c:") ? "a building going up" : "a building");
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
// Room on the base map for one more crop plot (buildings.js canBuild farm_plot: the map's soil is the limit): a free
// 2 × 2 of soil anywhere on it, against everything placed by hand or by the game and the queued plots too; the land in
// the way counts as room (the game places over it and queues the clearing: autoLayout), the river and the road do
// not. Nearest the middle first, so a base with room answers at once. Without a state (no land to read): room.
export function soilRoom(state, base) {
  if (!state) return true;
  const auto = autoLayout(state, base);
  const occ = occupancy(state, base, null, auto);
  if (occ.land) occ.land = occ.land.waterOnly; // the land is cleared for it; the soil's floors stay (waterOnly keeps them)
  const probe = { ...FIELD, type: "farm_plot", key: null, label: BUILDINGS.farm_plot.name };
  const N = gridHalf(base) - NO_BUILD;
  for (let d = 0; d <= N; d++) for (let y = -d; y <= d; y++) for (let x = -d; x <= d; x++) {
    if (Math.max(Math.abs(x), Math.abs(y)) !== d) continue;
    if (!placeProblemAt(base, probe, x, y, 0, occ)) return true;
  }
  return false;
}
export const SOIL_FULL = "No free soil on the base map for another 2 × 2 crop plot: clear land, or move or pull down something";
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
  if (it.fire) return "The camp fire is moved by hand only (Move).";
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
  if (it.key === FIRE.KEY) { if (at) planOf(base).fireSpot = at.slice(); else delete planOf(base).fireSpot; return; }
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
  const spec = landSpec(state, base, { G: gridHalf(base), C: yardHalf(base), tier: tierKey(base), terrain: terrainOf(state, base), origin: originOf(base), fresh: freshBase(base), compact: landCompact(base), level: levelOf(base) });
  return landMapOf(spec, base.land);
}
// What stands on the map on the ground's own height (the user's request 2026-10-23: "just build on the hill as if it was
// the ground floor"): a cell laid by the base (a building, the wire, a parked car) where the land is higher or lower
// than the map's datum is on that ground, c.ter and c.h its level as the land's own cells (drawn on its column, walked
// and seen over as a hill: combat.js losTop); one with a height of its own (a loft, a wall stand, a watchtower) keeps
// it over the ground (c.gh: the ground under it; c.h the two). c.bld: built, no pond in it (ponds.js).
function groundBuilt(cells, W, H, ox, oy, land, lift) {
  const G = land.ground || land.heights;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cells[y * W + x];
    if (c.ter || c.k === "crag" || c.k === "water") continue;
    const p = land.pieces.get(`${x - ox},${y - oy}`);
    if (p && (p.k === "water" || p.k === "crag")) continue;
    const g = (G.get(`${x - ox},${y - oy}`) || 0) - lift;
    if (!g) continue;
    const own = c.h ?? (CELL[c.k] && CELL[c.k].h);
    if (own != null && c.k !== "open") { c.gh = g; c.h = own + g; } else { c.ter = 1; c.h = g; }
    c.bld = 1;
  }
}
// The base's own ground level (base.plan.level: the camp's 5 × 5 levelled to its own ground, siteLevel; a camp on a hill
// stands on it, the user's request 2026-10-23); 0 for level ground and a base laid out before it.
export const levelOf = (base) => (base && base.plan && base.plan.fresh && base.plan.level) || 0;
// The first time a base's land is read (a new base, or a save from before the land): what stands on the map now, by
// hand or by the game, keeps its ground (the cells under it and outside its doors cleared), so nothing standing moves.
// A base read since the user's request 2026-10-24 ("The clearing of initial foliage is done in the 5x5"; land.v 3) has
// the tile's own land all round, only the 5 × 5 round its middle (the camp's own square) and what stands cleared, as a
// camp set up on its own spot has; one read before keeps the yard and the clearing it was laid out with.
export const landCompact = (base) => !!(base && base.land && base.land.v >= 3);
function ensureLand(state, base) {
  if (base.land) return;
  base.land = { v: 3, n: 0, cleared: {}, looted: {}, off: true };
  try {
    for (const e of layoutOf(state, base)) {
      if (!e.at) continue;
      for (const [x, y] of [...rectCells(e.it, e.at), ...doorCellsOf(e.it, e.at)]) base.land.cleared[`${x},${y}`] = 1;
    }
    const B = siteBox([0, 0]);
    for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) base.land.cleared[`${x},${y}`] = 1;
  } finally { delete base.land.off; base.land.n = 1; }
}
// The cell kind a piece is laid as on the battle map.
export const landCellKind = (p) => (p.k === "wreck" ? (p.body === "truck" ? "truck" : "car") : p.k === "rise" || p.k === "dip" ? "open" : p.k); // a hill's or a hollow's cell is open ground at its height (basescatter.js layLand)
// The pieces under a thing at `at` (its footprint and the cells outside its doors), once each.
// The hills and hollows themselves are not in the way (the user's request 2026-10-23: "It should not be trying to burrow
// just build on the hill as if it was the ground floor"): a building stands on level ground at any height (groundWhy);
// a spring's pond is never built on.
export function landUnder(land, it, at) {
  const out = new Set();
  for (const [x, y] of [...rectCells(it, at), ...doorCellsOf(it, at)]) { const p = land.pieces.get(`${x},${y}`); if (p && !((p.k === "rise" || p.k === "dip") && !p.spring)) out.add(p); }
  return [...out];
}
export const UNEVEN_WHY = "Over a hill's edge: it has to stand whole on one level (all of it up on the hill, or all of it off it)";
// Why `it` at `at` would not stand on one level of the ground (its cells and the cells outside its doors), or "". A wall,
// a gate, a wall stand and the defences follow the ground a cell at a time (WALL_KINDS).
export function groundWhy(land, it, at) {
  const G = land && (land.ground || land.heights);
  if (!G || WALL_KINDS.has(it.kind) || it.kind === "defence") return "";
  let h0 = null;
  for (const [x, y] of [...rectCells(it, at), ...doorCellsOf(it, at)]) { const h = G.get(`${x},${y}`) || 0; if (h0 == null) h0 = h; else if (h !== h0) return UNEVEN_WHY; }
  return "";
}
const PLURAL = { bush: "bushes", "fence panel": "fence panels", "field gate": "field gates", "wire fence panel": "wire fence panels", "hay bale": "hay bales", "broken crate": "broken crates", "old drum": "old drums", "fallen log": "fallen logs", "wrecked car": "wrecked cars", "wrecked truck": "wrecked trucks", "patch of high ground": "patches of high ground", "store": "stores" };
// "2 trees, a bush and a wrecked car".
export function landWords(pieces) {
  const n = new Map();
  for (const p of pieces) { const w = pieceWord(p); n.set(w, (n.get(w) || 0) + 1); }
  const parts = [...n].map(([w, k]) => { if (k === 1) return w; const bare = w.replace(/^(an?|the) /, ""); return `${k} ${PLURAL[bare] || `${bare}s`}`; });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}
export function landWhy(pieces) {
  if (pieces.some((p) => p.k === "water")) return "On the river: nothing is built on the water";
  if (pieces.some((p) => p.k === "crag")) return "On the mountainside: nothing is built on the rock"; // never cleared (basescatter.js CLEAR)
  if (pieces.some((p) => p.spring)) return "In the pond: nothing is built on its spring-fed water, and it is never filled in"; // basescatter.js SPRING
  return `${LAND_WHY}: ${landWords(pieces)} (click the red site to queue the clearing)`;
}
// A cutting tool at the base (the armory's, or carried by someone there): a tree is felled faster with one (CLEAR.NO_TOOL).
export const chopToolAt = (state, base) => (base.armory || []).some((it) => isChopTool(it)) || atBase(state, base.id).some((s) => !!bestChop(s).item);
// Queue the clearing of these pieces (one job: their hours added up, what they give; the ones already queued left out).
// mode "strip": strip the wrecks among them of their scrap and a car part (once). Returns the job, or null.
export function queueClear(state, base, pieces, { mode = "clear", label = "", before = null } = {}) {
  const tool = chopToolAt(state, base);
  const busy = new Set(base.construction.filter((c) => c.type === "clear" && c.pieces).flatMap((c) => c.pieces.map((p) => `${p.g}|${c.mode || "clear"}`)));
  const dug = terraBusy(base); // the ground being terraformed is left to its job (terraform.js)
  const list = pieces.filter((p) => p && p.k !== "water" && !busy.has(`${p.g}|${mode}`) && !p.cells.some(([x, y]) => dug.has(`${x},${y}`)) && clearOf(p, tool, mode));
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
    else for (const [x, y] of p.cells) { base.land.cleared[`${x},${y}`] = 1; unEdit(base, x, y); } // terraformed ground dug down or filled in: level again (terraform.js)
  }
  base.land.n = (base.land.n || 0) + 1;
  const got = Object.entries(job.get || {}).filter(([, v]) => v > 0);
  for (const [k, v] of got) base.stock[k] = (base.stock[k] || 0) + v;
  log(state, `${base.name}: ${job.label ? job.label.charAt(0).toLowerCase() + job.label.slice(1) : "the land cleared"}: done${got.length ? ` (+${got.map(([k, v]) => `${v} ${k === "carparts" ? "car part" + (v === 1 ? "" : "s") : k === "metalsheet" ? "metal sheet" + (v === 1 ? "" : "s") : k}`).join(", +")})` : ""}.`, "good");
}
// ---------- the camp's spot (the user's request 2026-10-22) ----------
// "When you establish a base choose where in the 250 x 250 with a highlighted 10x10 to start": the land of a tile on
// its 500 × 500 map before any base stands on it (map coordinates, the middle 0, 0: the picker, ui/campsite.js), why a
// spot cannot take the camp, and the game's own spot (the governor, a team with nobody to ask, a pick put off).
// SITE_RANGE: the farthest the camp's middle may be from the map's middle, so its yard, the wall's band round it and
// the no-build margin stay on the map (gridOf: the yard grows only as far as the edge allows).
export const SITE_RANGE = GRID_MAX - NO_BUILD - 2 - GRID.camp.yard;
export function siteLand(state, tile) {
  const probe = { tile };
  return landMapOf(landSpec(state, probe, { G: GRID_MAX, C: 0, tier: "camp", terrain: terrainOf(state, probe), origin: [0, 0], fresh: true }), null);
}
/** Why the camp cannot go with its middle at `at` (map coordinates), or "". @param {any} state @param {number} tile @param {any} at */
export function siteProblem(state, tile, at) {
  if (!Array.isArray(at) || at.length < 2 || !Number.isInteger(at[0]) || !Number.isInteger(at[1])) return "Pick a spot for the camp";
  if (Math.abs(at[0]) > SITE_RANGE || Math.abs(at[1]) > SITE_RANGE) return "Too near the edge of the map: the camp's yard and a wall round it would run off it";
  const land = siteLand(state, tile), B = siteBox(at);
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) { const p = land.pieces.get(`${x},${y}`); if (p && p.k === "water") return "On the river: pick dry ground"; if (p && p.k === "crag") return "On the mountainside: pick open ground"; if (p && p.spring) return "In the pond: pick dry ground"; }
  // Whole on one level (the user's request 2026-10-23: "only allow building the camp if the 5x5 fits on the hill in
  // whole otherwise set it to red"): never dug into a hill's edge nor half down a hollow; on a hill it stands on it.
  const h0 = land.heights.get(`${B.x0},${B.y0}`) || 0;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) if ((land.heights.get(`${x},${y}`) || 0) !== h0) return "Over a hill's edge: the camp's square has to stand whole on one level (all of it up on the hill, or all of it off it)";
  return "";
}
// What clearing the spot would give and take ({ hours: work-hours at a builder's pace, get, n: pieces and cells
// levelled; dig: { hours, up, down }: the part of it levelling the ground, cells dug down and filled in, so an open
// spot on a hill's slope reads as the dig it is, not "clearing 25 things": the user's report 2026-10-23; level: the
// level it is levelled to, basescatter.js siteLevel: an open hilltop is no work, the camp stands on it }; the picker's
// line, staging.js siteSetup). Bare ground is dug down or filled in to the level a level a cell (CLEAR rise, dip); under
// a tree, a bush or a rock the ground goes with it. tool: a cutting tool to hand (else a tree, a log or a stump takes
// CLEAR.NO_TOOL as long).
export function siteYield(state, tile, at, tool = true) {
  const land = siteLand(state, tile), B = siteBox(at), level = siteLevel(land, at), seen = new Set(), get = {}, dig = { hours: 0, up: 0, down: 0 };
  let hours = 0;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
    const p = land.pieces.get(`${x},${y}`);
    if (p && p.k === "water") continue;
    if (!p || p.k === "rise" || p.k === "dip") {
      const d = ((land.heights && land.heights.get(`${x},${y}`)) || 0) - level;
      if (!d) continue;
      const h = CLEAR[d > 0 ? "rise" : "dip"].hours * Math.abs(d);
      hours += h; dig.hours += h; dig[d > 0 ? "up" : "down"]++;
      continue;
    }
    if (seen.has(p)) continue;
    seen.add(p);
    const c = clearOf(p, tool, "clear");
    if (!c) continue;
    hours += c.hours;
    for (const [k, v] of Object.entries(siteGet(p, c, tool))) get[k] = (get[k] || 0) + v;
  }
  dig.hours = Math.round(dig.hours * 10) / 10;
  return { hours: Math.round(hours * 10) / 10, get, n: seen.size + dig.up + dig.down, dig, level };
}
// The game's spot (the governor, a team with nobody to ask, a pick put off, Let the game pick): the best spot in reach
// by its facts (siteinfo.js bestSite, the user's words 2026-10-23: "Update let the game pick": the setup's time, the
// lie of the land, sight lines, water, the road, room to grow, wood, room to the edge), off the river and the crag,
// and off buildings and high ground while any spot is (pulling a house down or digging a hill away to pitch a camp is
// days of work: the user's request 2026-10-22). The same for the same land.
export function defaultSite(state, tile) { return bestSite(state, tile); }
// A camp set up on its own spot (staging.js makeCamp; basescatter.js SITE): its setup clears the square round the fire
// (every piece with a cell in it, a wreck whole; never the river) and what that gives (wood, scrap, car parts, metal
// sheets) comes into its stores when the camp stands. The square's ground is cleared ground from then on. Returns
// { got: { supply: n }, pieces: [...] } (nothing on a base with no land).
export function clearCampSite(state, base) {
  const land = landFor(state, base);
  if (!land) return { got: {}, pieces: [] };
  const tool = chopToolAt(state, base), B = siteBox();
  const inSite = (x, y) => x >= B.x0 && y >= B.y0 && x < B.x1 && y < B.y1;
  const hit = land.list.filter((p) => p.k !== "water" && p.cells.some(([x, y]) => inSite(x, y)));
  const got = {};
  for (const p of hit) {
    const c = clearOf(p, tool, "clear");
    if (c) for (const [k, v] of Object.entries(siteGet(p, c, tool))) got[k] = (got[k] || 0) + v;
    for (const [x, y] of p.cells) base.land.cleared[`${x},${y}`] = 1;
  }
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) { const p = land.pieces.get(`${x},${y}`); if (!p || p.k !== "water") base.land.cleared[`${x},${y}`] = 1; }
  base.land.n = (base.land.n || 0) + 1;
  for (const [k, v] of Object.entries(got)) base.stock[k] = (base.stock[k] || 0) + v;
  return { got, pieces: hit };
}
// Does this construction job wait for its site to be cleared (the game placed it over the land: autoLayout's second
// pass)? Its clearing is queued just before it the first time it is asked. (buildings.js constructionHour.)
export function siteWaits(state, base, job) {
  if (job && job.type === "clear") { const land = job.pieces && job.pieces.some((p) => p.k === "dip") ? landFor(state, base) : null; return !!land && pondWaits(state, base, job, land.heights, land.springs); } // ponds.js: a wet hollow is filled in once it is dry
  if (!job || job.type === "clear" || job.target || !FOOT[job.type]) return false;
  const land = landFor(state, base);
  if (!land) return false;
  const key = `c:${job.id}`, it = itemByKey(state, base, key);
  if (!it || it.fit) return false;
  const at = it.at || autoLayout(state, base).get(key);
  if (!at) return false;
  const hit = landUnder(land, it, at).filter((p) => p.k !== "water" && p.k !== "crag"); // the river and the mountainside are never cleared
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
  const hit = landUnder(land, it, at).filter((p) => p.k !== "water" && p.k !== "crag"); // the river and the mountainside are never cleared
  if (!hit.length) return;
  for (const p of hit) for (const [x, y] of p.cells) { base.land.cleared[`${x},${y}`] = 1; unEdit(base, x, y); }
  base.land.n++;
}
// Every piece of the land cleared at once, for nothing (the tests of the rules that are not about the land; a cheat).
export function clearAllLand(state, base) {
  const land = landFor(state, base);
  if (!land) return;
  for (const p of land.list) for (const [x, y] of p.cells) { base.land.cleared[`${x},${y}`] = 1; unEdit(base, x, y); }
  base.land.n++;
}
// The piece of land at a grid cell, as a list (empty: none); with `clump`, the pieces of its kind joined to it (a stand
// of trees, a hedgerow, a fence run or a field's fence: basescatter.js fieldLayer).
export function landPieceAt(state, base, gx, gy, clump = false) {
  const land = landFor(state, base);
  const p = land ? land.pieces.get(`${gx},${gy}`) || null : null;
  if (!p) return [];
  if (!clump || !["tree", "bush", "fence", "wirefence", "stump", "rock", "rise", "slope", "dip"].includes(p.k)) return [p];
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
  const key = `${base.id}|${tierKey(base)}|${originOf(base)}|${freshBase(base) ? "f" : ""}|${layoutSeed(base)}|${yardHalf(base)}|${ringHalf(base)}|${except || ""}|${sig}|${linksArr(base).map((l) => `${l.a}>${l.b}`).join(",")}|${sticky ? JSON.stringify(sticky) : ""}|${landKey(base)}|${terraJobs(base).map((c) => c.id).join(",")}`; // the ground being terraformed: nothing placed there (occupancy work)
  let out = autoCache.get(key);
  if (out) return out;
  out = new Map();
  const rng = new Rng(layoutSeed(base) ^ 0x5bd1e995);
  const C = yardHalf(base), B = gridBox(base), R = ringHalf(base);
  const occ = occupancy(state, base, except, null);
  const take = (it, at) => { out.set(it.key, at); markOcc(occ, it, at, it.key); };
  const laid = out; // what the layout has taken so far, by key (defSpots' own out is the line in front of the wall)
  const dims = { B, R };
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
    else if (k === "spot") { // a mounted spotlight (data-power.js): up on a wall stand first, else at the yard's corners and sides by the walls
      for (const o of items) { const p = o !== it && o.kind === "stand" && (o.at || laid.get(o.key)); if (p) for (const [x, y] of rectCells(o, p)) spots.push([x, y, 0]); }
      spots.push([edge, edge], [-edge, -edge], [edge, -edge], [-edge, edge], [0, edge], [0, -edge], [edge, 0], [-edge, 0]);
    }
    else if (k === "tower") spots.push([edge - 1, edge - 1], [-edge, -edge], [edge - 1, -edge], [-edge, edge - 1]);
    else if (k === "spikes") spots.push([-1, out, 0], [-1, -out - 1, 0], [out, -1, 1], [-out - 1, -1, 1], [5, out, 0], [-7, out, 0], [5, -out - 1, 0], [-7, -out - 1, 0]);
    else if (k === "trench") spots.push([-5, out + 2, 0], [out + 2, -5, 1], [-5, -out - 3, 0], [-out - 3, -5, 1], [-5, out + 1, 0], [out + 1, -5, 1], [-5, -out - 2, 0], [-out - 2, -5, 1]); // the nearer line too: a camp's grid ends in the margin two cells out
    else if (k === "sandbag" && it.w === 1 && it.h === 1) { // Sandbags (sandbag1): on from either end of a row already down, else a new row inside the yard's south edge, the middle out
      for (const o of items) { const p = o !== it && o.kind === "defence" && o.k === "sandbag" && o.w === 1 && o.h === 1 && (o.at || laid.get(o.key)); if (p) spots.push([p[0] + 1, p[1], 0], [p[0] - 1, p[1], 0]); } // by hand or laid by the game already
      for (let i = 0; i < 2 * edge; i++) spots.push([i % 2 ? -((i + 1) >> 1) : i >> 1, edge - 3, 0]);
    }
    for (const s of spots) if (onGrid(B, s[0], s[1]) && fits(it, s[0], s[1], s[2] || 0) && reach(it, [s[0], s[1], s[2] || 0])) return [s[0], s[1], s[2] || 0];
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
  const R = ringHalf(base), B = gridBox(base);
  const auto = autoLayout(state, base);
  const occ = occupancy(state, base, null, auto);
  if (occ.land) occ.land = occ.land.waterOnly; // over the land, as autoLayout lays the pieces (its clearing goes with them): a gate counted where it goes
  const free = (x, y) => onGrid(B, x, y) && !occ.foot.has(K(x, y)) && !occ.door.has(K(x, y));
  const gates =itemsOf(state, base).filter((it) => it.kind === "gate").map((it) => it.at || auto.get(it.key)).filter(Boolean).map((at) => rectOf(FOOT.gate4, at));
  const gateIt = { ...FOOT.gate4, type: "gate4" };
  const out = { gate4: 0, wall4: 0, wall2: 0, wall1: 0 };
  let open = 0;
  const sides = ringSides(R).map((sd) => ({ sd, on: sd.cells.map(([x, y]) => free(x, y)) }));
  const tryGate = (side, m) => {
    const { sd, on } = side;
    if (m < 0 || m + 4 > on.length || !gateSpot(sd, m, 4) || ![0, 1, 2, 3].every((k) => on[m + k])) return false;
    const at = alongAt(sd, m);
    if (placeProblemAt(base, gateIt, at[0], at[1], at[2], occ, { B, R })) return false;
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
const stampOf = (state, base) => `${state ? "s" : "n"}|${base.buildings.map((b) => `${b.id}${b.at ? `@${b.at}` : ""}${b.broken ? "x" : ""}${b.mat || ""}${(b.wear || 0) >= 60 ? "d" : ""}`).join(",")}|${base.construction.map((c) => `${c.id}${c.at ? `@${c.at}` : ""}`).join(",")}|${base.plan ? `${base.plan.ring}|${(base.plan.plots || []).map(String).join(";")}|${originOf(base)}|${base.plan.fireSpot || ""}` : ""}|${base.tier}|${base.camp}|${base.type}|${state ? carsAtBase(state, base.id).map((v) => `${v.id}${v.at ? `@${v.at}` : ""}`).join(",") : ""}`;
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
  const B = gridBox(base);
  const solid = (it) => it.built && (WALL_KINDS.has(it.kind) || it.kind === "house" || it.kind === "roof");
  const sig = lay.filter((e) => e.at && solid(e.it)).map((e) => `${e.it.key}@${e.at.join(",")}${e.it.rec && e.it.rec.broken ? "x" : ""}${e.it.rec && e.it.rec.mat ? `m${e.it.rec.mat}` : ""}${e.it.rec && (e.it.rec.wear || 0) >= 60 ? "d" : ""}`).join("|");
  const key = `${base.id}|${B.x0},${B.y0}|${tierKey(base)}|${coreKey(base)}|${sig}`;
  const hit = infoCache.get(key);
  if (hit) return hit;
  const N = B.x1 - B.x0, at = (x, y) => (y - B.y0) * N + (x - B.x0); // the grid is square (BASE_GRID)
  const block = new Uint8Array(N * N);
  const info = { walls: 0, gates: 0, stands: 0, broken: 0, cells: 0, enclosed: false, tier: 0, strength: 0, hp: 0, gap: null, byMat: [0, 0, 0, 0, 0] };
  let sumS = 0, sumM = 0, sumHp = 0, nHp = 0;
  const fill = (r) => { for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (onGrid(B, x, y)) block[at(x, y)] = 1; };
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
  for (let i = 0; i < N; i++) for (const [x, y] of [[B.x0 + i, B.y0], [B.x0 + i, B.y1 - 1], [B.x0, B.y0 + i], [B.x1 - 1, B.y0 + i]]) { const j = at(x, y); if (!block[j] && !seen[j]) { seen[j] = 1; q.push(j); } }
  for (let h = 0; h < q.length; h++) {
    const j = q[h], x = (j % N) + B.x0, y = Math.floor(j / N) + B.y0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!onGrid(B, nx, ny)) continue;
      const k = at(nx, ny);
      if (!block[k] && !seen[k]) { seen[k] = 1; q.push(k); }
    }
  }
  let near = null;
  for (const p of coreParts(base)) for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) {
    if (!onGrid(B, x, y) || !seen[at(x, y)]) continue;
    if (!near || Math.hypot(x, y) < Math.hypot(near[0], near[1])) near = [x, y];
  }
  info.enclosed = info.cells > 0 && !near;
  if (info.enclosed) {
    info.tier = Math.max(1, Math.min(WALL_TIERS.length - 1, Math.round(sumM / info.cells)));
    info.strength = Math.round((sumS / info.cells) * 10) / 10;
  } else if (info.walls + info.gates) {
    // The gap the dead find: the first open cell of the ring round the yard, when the wall stands on it (a wall laid
    // elsewhere by hand: no cell to name).
    const line = ringSides(ringHalf(base)).flatMap((sd) => sd.cells).filter(([x, y]) => onGrid(B, x, y));
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
export const PATH = { WIDTH: 1 };
const REACH_PAD = 12; // reachProblem: the open ground round what stands that the walk is worked out over (cells)
// The cells of the land that stop a walk over the whole map (gridBox), once a land (landOf: made again when anything is
// cleared) and kind: all of it, or the river alone (noLand).
const blockCache = new WeakMap();
function landBlocks(land, GB, waterOnly) {
  let c = blockCache.get(land);
  if (!c || c.x0 !== GB.x0 || c.y0 !== GB.y0) blockCache.set(land, (c = { x0: GB.x0, y0: GB.y0 }));
  const k = waterOnly ? "w" : "a";
  if (c[k]) return c[k];
  const W = GB.x1 - GB.x0, H = GB.y1 - GB.y0, out = new Uint8Array(W * H);
  for (const p of waterOnly ? land.waterOnly.list : land.list) {
    if (p.parts) { p.cells.forEach(([x, y], i) => { if (!walks(p.parts[i].k) && onGrid(GB, x, y)) out[(y - GB.y0) * W + (x - GB.x0)] = 1; }); continue; } // a building: its walls, not its rooms
    if (!walks(landCellKind(p))) for (const [x, y] of p.cells) if (onGrid(GB, x, y)) out[(y - GB.y0) * W + (x - GB.x0)] = 1;
  }
  return (c[k] = out);
} // the path's least width in cells. Only 1 is implemented: a 4-neighbour flood fill, where one open cell joins two; a wider path would fill over the cells a WIDTH × WIDTH block of open cells fits on. The constant is here so the rule reads as one number.
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
  const items = opts.items || itemsOf(state, base);
  const skips = opts.skip instanceof Set ? opts.skip : new Set(opts.skip ? [opts.skip] : it && it.key ? [it.key] : []);
  const auto = opts.auto || null;
  const counted = [], pos = new Map();
  for (const o of items) {
    if (skips.has(o.key)) continue;
    const a = o.at || (auto && auto.get(o.key)) || null;
    if (!a) continue;
    counted.push({ it: o, at: a }); pos.set(o.key, a);
  }
  const core = coreParts(base);
  if (it && at && it.key) pos.set(it.key, at);
  // The walk is worked out over what stands (the core, everything counted, the candidate) and REACH_PAD cells round it,
  // within the map: beyond that is the base's open land, walked round anything in it (every base's map is 500 × 500,
  // and a flood over all of it for each spot the game tries made a camp's layout eight times slower).
  const GB = gridBox(base);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (r) => { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + r.w); y1 = Math.max(y1, r.y0 + r.h); };
  for (const p of core) grow({ x0: p.x, y0: p.y, w: p.w, h: p.h });
  for (const e of counted) grow(rectOf(e.it, e.at));
  if (it && at) grow(rectOf(it, at));
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 1; }
  const B = { x0: Math.max(GB.x0, x0 - REACH_PAD), y0: Math.max(GB.y0, y0 - REACH_PAD), x1: Math.min(GB.x1, x1 + REACH_PAD), y1: Math.min(GB.y1, y1 + REACH_PAD) };
  const W = B.x1 - B.x0, H = B.y1 - B.y0, N = W * H;
  const on = (x, y) => onGrid(B, x, y);
  const idx = (x, y) => (y - B.y0) * W + (x - B.x0);
  const blk = new Uint8Array(N);
  const block = (x, y) => { if (on(x, y)) blk[idx(x, y)] = 1; };
  // The land that stops a walk (trees, fences, rocks, wrecks, the river; not bushes nor tents: combat.js CELL walk).
  const land = landFor(state, base);
  if (land) {
    const L = landBlocks(land, GB, !!opts.noLand), LW = GB.x1 - GB.x0;
    for (let y = B.y0; y < B.y1; y++) for (let x = B.x0, i = (y - GB.y0) * LW + (B.x0 - GB.x0); x < B.x1; x++, i++) if (L[i]) blk[idx(x, y)] = 1;
  }
  // A thing's cells onto the grid: a car's whole rect and a flat-roofed block stand solid; anything else by its cells
  // (cellsOf: a house's walls and windows block, its doors and floor walk; a pen's fence and hay block, its gap walks;
  // a field walks; a prop, a fitting or a defence by its cell kind: a trench or pits walk, a barricade or a crate not).
  const lay = (o, atO) => {
    if (o.kind === "vehicle" || o.kind === "roof") { for (const [x, y] of rectCells(o, atO)) block(x, y); return; }
    for (const c of cellsOf(o, atO)) if (!walks(c.k)) block(c.x, c.y);
  };
  for (const e of counted) lay(e.it, e.at);
  for (const p of core) lay(p, [p.x, p.y, 0]);
  if (it && at) lay(it, at);
  // A wall piece's own cells (GATE_WHY's second flood leaves them open; placeProblemAt keeps them off everything else).
  const mine = it && at && it.kind === "wall" ? cellsOf(it, at).filter((c) => !walks(c.k) && on(c.x, c.y)).map((c) => idx(c.x, c.y)) : [];
  // (No ring is drawn: the wall pieces are the wall, laid above by their cells: a wall blocks, a gate and a stand walk.)
  // The doorways between linked buildings: both door cells walk.
  const links = liveLinks(base, items, pos);
  for (const l of links) for (const [x, y] of [l.da, l.db]) if (on(x, y)) blk[idx(x, y)] = 0;
  // The flood fill from every open cell on the edge of that ground (PATH.WIDTH 1: 4-neighbour, over the open cells).
  const flood = (bk) => {
    const seen = new Uint8Array(N), q = new Int32Array(N);
    let qh = 0, qt = 0;
    const seed = (i) => { if (!bk[i] && !seen[i]) { seen[i] = 1; q[qt++] = i; } };
    for (let i = 0; i < W; i++) { seed(i); seed((H - 1) * W + i); }
    for (let j = 0; j < H; j++) { seed(j * W); seed(j * W + W - 1); }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      if (x > 0) seed(i - 1);
      if (x < W - 1) seed(i + 1);
      if (y > 0) seed(i - W);
      if (y < H - 1) seed(i + W);
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
    for (const i of mine) for (const j of [i % W > 0 ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && !blk[j] && !seen[j]) pocket.push(j);
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
// buildings, the 150 × 150 build map). opts.pitsAt: spike pits used up on the horde that reached the walls (defences.js
// hordeAttackBase keeps their spots so they show in the fight). Returns the fort record fort.js works with:
// W × H cells, the yard's origin and size, the wall rect, the ring, walkway, gates, towers, ladders, the masks, the
// buildings, plus ox/oy (grid → map), stores (where the goods are), vehicles (the cars and their cells), lights.
export function buildBaseMap(state, base, rng, opts = {}) {
  stampGrid(state, base);
  const site = !!opts.site; // the camp's spot (openSiteView): the tile's whole map, its land and nothing built
  const view = !!opts.view || site;
  const C = yardHalf(base), GB = gridBox(base), R = ringHalf(base), Bh = Math.max(C, R);
  const lay = site ? [] : layoutOf(state, base).filter((e) => e.at && (view || e.it.built));
  const cleared = Object.keys((base.land && base.land.cleared) || {}).map((k) => k.split(",").map(Number)); // the ground cleared so far (basescatter.js)
  // The crop: the yard, the ring and everything on the map, plus the margin (and the view's pad), within the grid.
  let x0 = -Bh - 2, y0 = -Bh - 2, x1 = Bh + 2, y1 = Bh + 2; // half-open
  for (const e of lay) { const r = rectOf(e.it, e.at); x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + r.w); y1 = Math.max(y1, r.y0 + r.h); }
  if (opts.pitsAt) for (const at of opts.pitsAt) { if (!at) continue; const r = rectOf(FOOT.spike_pits, at); x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + r.w); y1 = Math.max(y1, r.y0 + r.h); }
  // The view takes in the ground cleared and being cleared too, so clearing on out from the camp opens more of the map.
  if (view) {
    for (const [x, y] of cleared) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    for (const c of base.construction) if (c.type === "clear") for (const p of c.pieces || []) for (const [x, y] of p.cells) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    // The ground terraformed and being terraformed (terraform.js): in view too.
    const dug = [...Object.keys((base.land && base.land.heightEdits) || {}).map((k) => k.split(",").map(Number)), ...terraJobs(base).flatMap((c) => c.cells || [])];
    for (const [x, y] of dug) { x0 = Math.min(x0, x - 1); y0 = Math.min(y0, y - 1); x1 = Math.max(x1, x + 2); y1 = Math.max(y1, y + 2); }
  }
  const pad = view ? VIEW_EDGE : MARGIN; // the view: what stands outside the 150 × 150 keeps its margin; the battle map's open ground
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  // VIEW_HALF: the build map 150 × 150 round the base, slid back onto the map by its edge (it keeps its size).
  if (view && !site) {
    const m = VIEW_HALF[tierKey(base)];
    const fit = (a0, a1, g0, g1) => { a0 = Math.min(a0, -m); a1 = Math.max(a1, m); if (a0 < g0) { a1 += g0 - a0; a0 = g0; } if (a1 > g1) { a0 = Math.max(g0, a0 - (a1 - g1)); a1 = g1; } return [a0, a1]; };
    [x0, x1] = fit(x0, x1, GB.x0, GB.x1); [y0, y1] = fit(y0, y1, GB.y0, GB.y1);
  }
  x0 = Math.max(GB.x0, x0); y0 = Math.max(GB.y0, y0); x1 = Math.min(GB.x1, x1); y1 = Math.min(GB.y1, y1);
  if (site) ({ x0, y0, x1, y1 } = GB);
  const W = x1 - x0, H = y1 - y0, ox = -x0, oy = -y0; // grid (gx, gy) → map (gx + ox, gy + oy)
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: "grass" }));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x, y) => (inside(x, y) ? cells[y * W + x] : null);
  const used = new Uint8Array(W * H), indoor = new Uint8Array(W * H), keep = new Uint8Array(W * H);
  const F = {
    W, H, cells, M: MARGIN, ox, oy, x0: -C + ox, y0: -C + oy, yw: 2 * C, yh: 2 * C, walled: false, view,
    wall: { x0: -R - 2 + ox, x1: R + 1 + ox, y0: -R - 2 + oy, y1: R + 1 + oy }, ring: [], walkway: [], gates: { north: [], east: [], south: [], west: [] }, towers: [], ladders: [], pieces: [],
    buildings: [], lofts: [], roofs: [], doors: [], windows: [], outlines: [], stores: [], vehicles: [], lights: [], spots: [], inside: null, indoor, lay: { W, H, G: null, buildings: [] },
    noBuild: NO_BUILD, // the no-build margin round the grid (nothing stands within it; the view tints it: c.nb)
  };
  // The yard keeps the tile's own ground (the user's request 2026-10-24: "Do not add the brown tiling for the your camp
  // area": it was painted trodden dirt, a brown square, over every base's yard); a base set up on its own spot
  // (freshBase): the ground cleared so far, the camp's clearing first, is dirt.
  if (freshBase(base)) { for (const [x, y] of cleared) { const c = at(x + ox, y + oy); if (c) c.f = "dirt"; } }
  // A hill raised there (terraform.js): grassed over as the land's own hills are (the user's word 2026-10-23: "like they
  // were created by the seed"); a hollow dug keeps its dirt.
  for (const [k, hv] of Object.entries((base.land && base.land.heightEdits) || {})) { if (!(hv > 0)) continue; const [x, y] = k.split(",").map(Number), c = at(x + ox, y + oy); if (c && c.f === "dirt") c.f = "grass"; }
  // The tint: the no-build margins (the tile map's NO_BUILD, the build map's own VIEW_EDGE); on the camp's spot (site)
  // the ground too near the edge for the camp (SITE_RANGE).
  const reach = SITE_RANGE - SITE.LO, E = site ? 0 : VIEW_EDGE;
  if (view) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const gx = x - ox, gy = y - oy; if (site ? Math.abs(gx) > reach || Math.abs(gy) > reach : gx < GB.x0 + NO_BUILD || gy < GB.y0 + NO_BUILD || gx >= GB.x1 - NO_BUILD || gy >= GB.y1 - NO_BUILD || x < E || y < E || x >= W - E || y >= H - E) cells[y * W + x].nb = 1; }
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
    if (it.type === "sandbag1" && it.rec && it.rec.broken) return; // a burst Sandbags: open ground, no cover there until it is refilled
    // A mounted spotlight (data-power.js SPOT): on a wall stand's cell the stand stays (its ladder, its walkway) with the
    // light up on it (c.spot: drawn there); on the ground a lamp cell of its own. Either way one of F.spots: its cell,
    // its reach (higher on a stand), and whether it has power now (electric.js spotOn: fort.js lights it at night).
    if (it.mount) {
      for (const c of cellsOf(it, atG)) {
        const x = c.x + ox, y = c.y + oy, q = at(x, y);
        if (!q) continue;
        const stand = q.k === "stand";
        if (!stand) { q.k = "spot"; delete q.h; delete q.t; }
        q.spot = 1;
        if (it.rec && it.rec.broken) q.spotBroken = 1;
        used[y * W + x] = 1;
        F.spots.push({ x, y, r: stand ? SPOT.STAND_R : SPOT.R, stand, on: !!(it.rec && spotOn(base, it.rec)), bid: it.rec ? it.rec.id : null });
      }
      return;
    }
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
      if (it.kind === "field") q.plot = 1; // a crop plot's cell: the view edges the plot with wood, the sides with no plot beside it (ui/isoview.js plotEdges)
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
  if (!site) for (const p of coreParts(base)) lay1({ ...p, key0: p.key || p.k, room: p.store ? (coreStoreKg(base) * p.store) / coreW : 0 }, [p.x, p.y, 0], "core", true, p.name || coreName(base));
  // Everything placed, by hand or by the game: the buildings first, then the fittings and indoor props that stand
  // inside them (laid over their floor).
  const reinforced = count(base, "gate") ? DEPLOY.GATE_HP_REINFORCED : 0; // buildings.js gate: every gate stronger
  const late = (e) => !!(e.it.fit || e.it.indoor || e.it.mount); // a spotlight after the wall stands it may stand on
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
  layPiles(state, base, F, { C: R, B: GB, inside, used, keep }); // what lies outside: piles near the middle, off the wall's ring
  // The fires (a camp's or a shelter's fire, a cook fire): drawn burning while lit (ui/isoview.js firepit: c.lit), cold
  // ash and stones once a camp's or a shelter's fire is out (fieldheat.js fireLit).
  const fireOn = !isShelter(base) || fireLit(base);
  for (const c of F.cells) if (c.k === "firepit") { if (fireOn) c.lit = true; else delete c.lit; }
  // The wall: the pieces placed (by hand or by the game). Walled when no way in from the map's edge reaches the base
  // itself (the attackers' way: open ground they can walk, never a barred gate or door): the inside is then what they
  // cannot reach round the base (its yard, its houses, the stands), the wall's rect its bounds; else the yard and the
  // ring round it as on an open base (the pieces stand on it as they are: a gap is a way in).
  const coreCells = [];
  if (!site) for (const p of coreParts(base)) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (inside(x + ox, y + oy)) coreCells.push([x + ox, y + oy]);
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
  const charged = fenceCharged(base);
  const ringAt = (d, razor) => {
    for (let y = w.y0 - d; y <= w.y1 + d; y++) for (let x = w.x0 - d; x <= w.x1 + d; x++) {
      if (x !== w.x0 - d && x !== w.x1 + d && y !== w.y0 - d && y !== w.y1 + d) continue;
      if (gateLane(x, y)) continue;
      const q = at(x, y);
      if (!q || q.k !== "open" || used[y * W + x]) continue;
      q.k = "wire";
      if (razor) q.razor = true;
      if (charged) q.shock = true; // electric.js: the fence charger powered (combat.js shocks what steps in)
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
  F.lv = land ? land.level || 0 : 0; // the map's datum (combat.js mapLv): laid from the base's own level
  F.scatter = land ? layLand({ cells, W, H, ox, oy, land, lift: F.lv, ok: (x, y) => cells[y * W + x].k === "open" && !used[y * W + x], floor: (x, y) => cells[y * W + x].k === "open" && !used[y * W + x] && !indoor[y * W + x] }).kinds : {};
  if (land) groundBuilt(cells, W, H, ox, oy, land, F.lv);
  if (land) F.passes = cragWays(cells, W, H); // relief.js: the crag the crop takes in never shuts the base off from the map's edge; the ground a level a step to the edge and what stands
  // The land running on past the map's edge into the fog (basescatter.js landBeyond; ui/isoview.js draws it): scenery only.
  if (land && !site) F.beyond = { R: BEYOND_R, cells: landBeyond(land, W, H, ox, oy, BEYOND_R, (gx, gy) => onGrid(GB, gx, gy), F.lv) }; // F.lv: from the base's own level, as the map
  // The clearing under way (the construction queue's clearing jobs: basescatter.js CLEAR), for the view: the cells, how far,
  // and who is on it this hour (woodwork.js chopHands: the woodcutters felling it, the builders working it).
  F.clearing = (base.construction || []).filter((c) => c.type === "clear" && c.pieces).map((c) => ({ id: c.id, label: c.label, pct: Math.round((100 * (c.progress || 0)) / Math.max(1e-9, c.hours)), who: chopHands(state, base, c), cells: c.pieces.flatMap((p) => p.cells).map(([x, y]) => [x + ox, y + oy]).filter(([x, y]) => inside(x, y)) }));
  // The ground being terraformed (terraform.js): the cells still to dig or raise, how far, who dug this hour (verb: the tag's word).
  for (const c of terraJobs(base)) F.clearing.push({ id: c.id, label: c.label, pct: terraPct(c), terra: c.mode, verb: TERRA_VERB[c.mode].split(" ")[0], who: (c.built != null && c.built >= state.hour - 1 ? c.crew || [] : []).map((id) => { const s = state.survivors.find((q) => q.id === id); return s ? s.name.split(" ")[0] : ""; }).filter(Boolean), cells: terraLeft(c).map(([x, y]) => [x + ox, y + oy]).filter(([x, y]) => inside(x, y)) });
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
  if (opts.site) return [BASE_GRID, BASE_GRID]; // the camp's spot: the tile's whole map
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
  const { C, B, inside, used, keep } = m, { cells, W, ox, oy } = F;
  const n = Math.max(1, Math.min(PILE.MAX, Math.ceil(out.kg / PILE.KG)));
  const pw = PILE.W, ph = PILE.H;
  const free = (x, y) => inside(x, y) && !used[y * W + x] && !keep[y * W + x] && cells[y * W + x].k === "open";
  const clear = (x, y) => inside(x, y) && !used[y * W + x] && cells[y * W + x].k === "open";
  const fits = (gx, gy) => {
    for (let y = gy - 1; y <= gy + ph; y++) for (let x = gx - 1; x <= gx + pw; x++) {
      if (onBand(x, y, C)) return false;
      const inR = x >= gx && x < gx + pw && y >= gy && y < gy + ph;
      if (inR && (x < B.x0 + NO_BUILD || y < B.y0 + NO_BUILD || x >= B.x1 - NO_BUILD || y >= B.y1 - NO_BUILD)) return false;
      if (inR ? !free(x + ox, y + oy) : !clear(x + ox, y + oy)) return false;
    }
    return true;
  };
  let laid = 0;
  for (let d = 0; d <= 2 * GRID_MAX && laid < n; d++) {
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
    if (!(q > 0) || k === "dirt") continue; // dirt: heaped in the yard, in no store (terraform.js)
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
const TAKE_ORDER = ["meds", "parts", "electronics", "gunparts", "carparts", "fuel", "ammo", "arrows", "metalsheet", "buildmat", "scrap", "jars", "wood"];
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
  // Sandbags (sandbag1) smashed by the dead or shoved off their cell: burst, refilled as a repair (breakdowns.js).
  for (const e of layoutOf(state, base)) {
    if (!e.at || e.it.type !== "sandbag1" || !e.it.built || !e.it.rec || e.it.rec.broken) continue; // a queued one was only its outline
    const r = rectOf(e.it, e.at), c = b.cells[(r.y0 + F.oy) * b.w + r.x0 + F.ox];
    if (c && c.k !== "sandbag") wearOn(e.it.rec, MAP_WEAR.sandbag);
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
function viewBattle(state, base, prev = null, site = false) {
  const setup = {
    mode: "battle", layout: "baseDefence", deploy: true, drill: true, baseId: base.id, canRetreat: false, handler: null,
    enemy: { kind: "zombies", count: 1, power: 1, types: { runner: 1 }, name: "nobody (the base map)" }, context: { baseId: base.id, drill: true, view: true, noPlan: true, ...(site ? { site: true } : {}) },
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
  const known = site ? null : knownMask(b, base); // campscout.js: a camp set up blind, its map known only round the fire until surveyed (combat.js playerVision)
  if (known) b.knownMask = known;
  return b;
}
// The camp's spot picked on the tile's own map, in the same isometric view (the user's request 2026-10-22: "For the
// campsite selection I was thinking keep the isometric view just have a isometric highlight of the 5x5 area"): the
// tile's whole 500 × 500 map with its land and nothing built (buildBaseMap site), made from a stand-in camp that is on
// the books only while the view is made, and b.site = { partyId, tile, sel (the spot clicked: map coordinates of the
// fire), focus (where the view opens: the game's own spot) }. No units, no layout record: the clicks pick the spot
// (ui/combat.js siteClick), the 5 × 5 under the mouse is drawn as the view's ghost (siteGhostAt), the panel is
// ui/campsite.js sitePanel. Returns "" or why not.
export function openSiteView(state, p) {
  if (state.combat) return "Finish the battle first.";
  if (!p) return "That team is gone.";
  const tile = p.dest != null ? p.dest : p.path && p.path.length ? p.path[p.idx || 0] : null;
  if (tile == null || !state.tiles[tile]) return "No tile to camp on.";
  const probe = {
    id: SITE_PROBE, tile, type: "outpost", name: "The camp's spot", stock: {}, buildings: [], construction: [], armory: [], radio: false, watchtower: false,
    tier: 0, camp: true, fire: true, plan: { plots: [], origin: [0, 0], fresh: true }, land: { v: 2, n: 1, cleared: {}, looted: {} },
  };
  state.bases.push(probe);
  let b;
  try { b = viewBattle(state, probe, null, true); } finally { state.bases.splice(state.bases.indexOf(probe), 1); }
  const focus = p.campAt && !siteProblem(state, tile, p.campAt) ? p.campAt.slice(0, 2) : defaultSite(state, tile);
  b.site = { partyId: p.id, tile, sel: focus, focus };
  state.combat = b;
  return "";
}
const SITE_PROBE = 2 ** 31 - 7; // the stand-in camp's id while the spot's view is made (never a real base's)
// The 5 × 5 under the mouse (view cell x, y; null: no mouse over the map) and the one picked: { cells (view cells under
// the mouse), ok, why, at (that fire, map coordinates), picked (the picked 5 × 5's view cells), pickedAt (its fire's
// view cell), gameAt (the game's own spot's fire, view cell, while another is picked) } (ui/isoview.js draws them: the
// one under the mouse green or red, the picked one gold, the game's own tagged).
export function siteGhostAt(state, b, x = null, y = null) {
  if (!b || !b.site) return null;
  const F = b.deployPlan && b.deployPlan.fort;
  if (!F) return null;
  const cellsOf5 = (at) => { const B = siteBox(at), out = []; for (let yy = B.y0; yy < B.y1; yy++) for (let xx = B.x0; xx < B.x1; xx++) out.push([xx + F.ox, yy + F.oy]); return out; };
  const sel = b.site.sel, game = defaultSite(state, b.site.tile); // the game's own spot (siteinfo.js bestSite): tagged while another is picked
  const out = { cells: [], doors: [], ok: true, why: "", at: null, picked: sel ? cellsOf5(sel) : null, pickedAt: sel ? [sel[0] + F.ox, sel[1] + F.oy] : null, gameAt: !sel || sel[0] !== game[0] || sel[1] !== game[1] ? [game[0] + F.ox, game[1] + F.oy] : null };
  if (x == null || y == null) return out;
  const at = [x - F.ox, y - F.oy];
  const why = siteProblem(state, b.site.tile, at);
  return { ...out, cells: cellsOf5(at), ok: !why, why, at };
}
// A click on the spot's view (ui/combat.js): the 5 × 5 there picked (not yet set up: Set up camp here), or why not.
export function siteClickAt(state, b, x, y) {
  const g = siteGhostAt(state, b, x, y);
  if (!g) return "";
  if (!g.ok) return g.why;
  b.site.sel = g.at;
  return "";
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
// A footprint (grid x0, y0, w × h) within VIEW_EDGE cells of the build map's edge: its reason, else "".
function viewEdgeWhy(b, x0, y0, w, h) {
  const F = b.deployPlan && b.deployPlan.fort;
  if (!F || !F.view) return "";
  const mx = x0 + F.ox, my = y0 + F.oy;
  return mx < VIEW_EDGE || my < VIEW_EDGE || mx + w > b.w - VIEW_EDGE || my + h > b.h - VIEW_EDGE ? VIEW_EDGE_WHY : "";
}
export function ghostAt(state, b, x, y) {
  const L = b.layout, F = b.deployPlan && b.deployPlan.fort;
  if (!L || !F || (!L.pick && !L.pickType)) return null;
  const base = state.bases.find((o) => o.id === L.baseId);
  if (!base) return null;
  if (terraModeOf(L.pickType)) return terraGhost(state, b, base, x, y); // terraform.js: an area of ground, not a footprint
  const pf = L.pickType ? pickFoot(L.pickType) : null;
  const it = L.pick ? itemByKey(state, base, L.pick) : pf ? { ...pf, key: null, type: bagKindOf(L.pickType) ? "tent" : L.pickType, label: pickName(L.pickType), built: true } : null;
  if (!it) return null;
  const [w, h] = dimsOf(it, L.rot);
  const [gx, gy] = gridOfCell(b, x, y);
  const x0 = gx - Math.floor(w / 2), y0 = gy - Math.floor(h / 2);
  const skip = L.pick ? new Set([L.pick, ...hostedItems(state, base, it).map((o) => o.key)]) : null;
  const occ = occupancy(state, base, skip, null);
  const pw = placeProblemAt(base, it, x0, y0, L.rot, occ);
  const why = (pw === NO_BUILD_WHY || pw === "Off the map" ? pw : viewEdgeWhy(b, x0, y0, w, h) || pw) || reachProblem(state, base, it, [x0, y0, L.rot], occ, { skip }); // the hover's reason (the tile's own edge first: where the view meets it): layoutAct put / build refuse what is red here
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
// The terraforming pick (terraform.js, the user's request 2026-10-23): before its first corner, the hovered cell alone
// (dirt or not); then the rectangle from that corner (L.anchor, grid) to the hovered cell and its plan: the cells that
// change green (cells), those left out amber (doors), all of it red with the reason when nothing can; terra: the plan
// (ui/basemap.js layoutHover: its cost, time and shovels), terraPick: the mode (ui/isoview.js draws it over the hills).
function terraGhost(state, b, base, x, y) {
  const L = b.layout, F = b.deployPlan.fort, mode = terraModeOf(L.pickType), g = gridOfCell(b, x, y);
  const toMap = ([gx, gy]) => [gx + F.ox, gy + F.oy];
  const ghost = { cells: [toMap(g)], doors: [], ok: false, why: "", at: [g[0], g[1], 0], type: L.pickType, terra: null, terraPick: mode, anchor: L.anchor ? toMap(L.anchor) : null, land: null, from: null };
  if (!L.anchor) {
    const land = landFor(state, base);
    const occ = occupancy(state, base, null, autoLayout(state, base));
    occ.land = null;
    ghost.why = land ? dirtProblem(base, land, occ, g[0], g[1]) : "No base map here";
    ghost.ok = !ghost.why;
    return ghost;
  }
  const plan = terraPlan(state, base, mode, L.anchor, g, terraLevels(L.rot)), R = plan.rect;
  ghost.cells = [];
  if (plan.ok) { ghost.cells = plan.cells.map(([cx, cy]) => toMap([cx, cy])); ghost.doors = plan.out.map(([cx, cy]) => toMap([cx, cy])); }
  else for (let yy = R.y0; yy <= R.y1; yy++) for (let xx = R.x0; xx <= R.x1; xx++) ghost.cells.push(toMap([xx, yy]));
  return { ...ghost, ok: plan.ok, why: plan.why, terra: plan };
}
// A click with the terraforming pick: the first corner (on dirt), then the opposite one queues the order (terraform.js
// queueTerra); the pick stays up for the next.
function terraClick(state, b, base, L, x, y) {
  const g = gridOfCell(b, x, y), mode = terraModeOf(L.pickType);
  if (!L.anchor) {
    const gh = terraGhost(state, b, base, x, y);
    if (!gh.ok) return gh.why;
    L.anchor = g;
    L.msg = `First corner at ${g[0]}, ${g[1]}: click the opposite corner (up to ${TERRA.MAX} × ${TERRA.MAX} cells; Esc stops).`;
    return "";
  }
  const plan = terraPlan(state, base, mode, L.anchor, g, terraLevels(L.rot));
  if (!plan.ok) return plan.why;
  const job = queueTerra(state, base, plan);
  L.anchor = null;
  L.msg = `${job.label} queued: ${plan.cells.length} cells, ${plan.steps} cell-level${plan.steps === 1 ? "" : "s"} (${plan.hours} work-hours${plan.eta != null ? `, about ${plan.eta} h with ${plan.crew.workers.length} shovel${plan.crew.workers.length === 1 ? "" : "s"} at work` : ""}; ${mode === "raise" ? `−${-plan.dirt}` : `+${plan.dirt}`} dirt)${plan.crew.shovels ? "" : ". It waits for a shovel: one in the armory or on a builder"}.`;
  refreshBaseMap(state);
  return "";
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
    case "rotate": L.rot = terraModeOf(L.pickType) ? (L.rot + 1) % TERRA.LEVELS : (L.rot + 1) & 3; return ""; // terraforming: R steps the levels (terraform.js terraLevels)
    case "select": L.sel = act.key && itemByKey(state, base, act.key) ? act.key : null; if (L.sel) L.land = null; return "";
    // The land (basescatter.js): a piece's card (land: its grid cell), and its clearing queued (clump: the stand of
    // trees, the hedgerow or the fence run it is part of; mode "strip": a wreck stripped of its scrap and a part).
    case "unclear": { const job = base.construction.find((c) => c.id === Number(act.id) && (c.type === "clear" || c.type === "terra")); if (!job) return "That clearing is gone."; L.msg = job.type === "terra" ? cancelTerra(base, job.id) : cancelBuild(state, base, job.id); refreshBaseMap(state); return ""; } // terra: a terraforming job (terraform.js)
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
      L.msg = `${job.label} queued (${job.hours} work-hours${Object.keys(job.get).length ? `: ${Object.entries(job.get).map(([k, v]) => `+${v} ${k === "carparts" ? "car parts" : k === "metalsheet" ? "metal sheets" : k}`).join(", ")}` : ""}): the builders do it from the construction queue.`;
      refreshBaseMap(state);
      return "";
    }
    case "pickType": {
      if (act.bt && !pickFoot(act.bt) && !terraModeOf(act.bt)) return "That is not built on the map.";
      L.pickType = act.bt || null; L.pick = null; L.rot = 0; L.msg = ""; L.anchor = null; // anchor: a terraforming area's first corner
      if (terraModeOf(act.bt)) L.msg = `${TERRA_NAME[terraModeOf(act.bt)]}: click one corner of the area, then the opposite one (R: how many levels).`;
      return "";
    }
    case "build": {
      if (!L.pickType) return "Pick something to build first.";
      if (terraModeOf(L.pickType)) return terraClick(state, b, base, L, Number(act.x), Number(act.y)); // terraform.js: a corner of the area
      const bt = L.pickType, d = BUILDINGS[bt];
      const g = ghostAt(state, b, Number(act.x), Number(act.y));
      if (!g) return "Nothing to build.";
      if (!g.ok && g.land) return clearSite(state, base, L, g.land);
      if (!g.ok) return g.why;
      if (d && d.furniture) return isSetPiece(bt) ? setPlacedAt(state, b, base, bt, g) : setFurnitureAt(state, b, base, bt, g); // beds.js, electric.js: set from the stores where it was clicked (no job)
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
const MENU_GROUPS = ["Tents", "General buildings", "Fittings", "Furniture", "Power", "Buildings", "Yard things", "Defences", "Terrain"]; // Terrain: dig a hollow, raise a hill (terraform.js)
export function buildMenu(state, base) {
  const out = [];
  for (const [type, d] of Object.entries(BUILDINGS)) {
    const f = FOOT[type];
    if (!f || d.upgradeOnly) continue; // an upgrade in place (the reloading bench) is queued from the building it upgrades
    const group = type === "tent" ? "Tents" : d.general ? "General buildings" : d.grid ? "Power" : d.furniture ? "Furniture" : d.fit ? "Fittings" : f.kind === "defence" || WALL_KINDS.has(f.kind) ? "Defences" : f.kind === "prop" || f.kind === "pen" ? "Yard things" : "Buildings";
    const opts = pieceOpts(base, type);
    /** @type {any} */
    const chk = canBuild(state, base, type, opts);
    const piece = !!d.piece; // a wall piece, gate or stand: its material's name, cost and hours (buildings.js canBuildPiece)
    out.push({ type, name: piece ? pieceName({ type, ...opts }) : d.name, group, w: f.w, h: f.h, cost: piece && chk.cost ? { ...chk.cost } : { ...d.cost }, hours: piece && chk.hours != null ? chk.hours : d.hours, ok: !!chk.ok, why: chk.ok ? "" : chk.reason || "", desc: d.desc || "", ...(d.furniture ? { furniture: true, have: isSetPiece(type) ? placedInStores(base, type) : furnitureInStores(base, type) } : {}) });
  }
  // The tent bags in the stores (tents.js), pitched from the list: no cost, no builders (a click pitches one).
  for (const [k, T] of Object.entries(TENTS)) {
    if (!T.bag) continue;
    const have = bagsInStores(base, k);
    out.push({ type: `${BAG_PICK}${k}`, name: `${T.name} (bag)`, group: "Tents", w: T.w, h: T.h, cost: {}, hours: 0, ok: have > 0, why: have ? "" : `No ${T.name.toLowerCase()} bag in the stores: find one, or bring one home`, desc: `Pitch a ${T.name.toLowerCase()} from its bag in the stores: sleeps ${T.sleepers}, keeps ${T.storeKg} kg out of the weather. Strike it to pack it back into its bag.`, tentBag: true, have });
  }
  // Terraforming (terraform.js, the user's request 2026-10-23): dig a hollow, raise a hill, over an area picked with two
  // clicks. No cost but the work, the shovels (one a person) and, for a hill, the dirt a hollow gave. A base with land only.
  if (landFor(state, base)) {
    const crew = shovelCrew(state, base), dirt = Math.floor(base.stock.dirt || 0);
    const desc = {
      dig: `Lower an area of dirt (grass, trodden ground, a field: not the road, paving, rock, trees or buildings) into a hollow a level down (a hill dug down 1 to ${TERRA.LEVELS} levels first: R), the slopes round it eased so nobody steps more than a level. Two clicks pick its corners. ${TERRA.HOURS.dig} work-hour a cell-level, only for builders with a shovel (one a person; the armory's and their own); +${TERRA.DIRT} dirt a cell-level into the heap.`,
      raise: `Raise an area of dirt into a hill, 1 to ${TERRA.LEVELS} levels up (R): its levels nested and its slopes eased as the land's own hills are, and joined to a hill beside it as one. Two clicks pick its corners. ${TERRA.HOURS.raise} work-hour and ${TERRA.DIRT} dirt a cell-level (dig a hollow for the dirt), only for builders with a shovel (one a person).`,
    };
    for (const mode of ["dig", "raise"]) {
      const short = mode === "raise" && dirt < TERRA.DIRT;
      out.push({ type: TERRA_PICK[mode], name: TERRA_NAME[mode], group: "Terrain", w: 1, h: 1, cost: {}, hours: TERRA.HOURS[mode], ok: !short, why: short ? `No dirt in the heap (${TERRA.DIRT} a cell-level raised): dig a hollow first` : "", desc: desc[mode], terra: mode, shovels: crew.shovels, workers: crew.workers.length, builders: crew.builders.length, dirt });
    }
  }
  return out.sort((a, b) => MENU_GROUPS.indexOf(a.group) - MENU_GROUPS.indexOf(b.group)); // stable: BUILDINGS' order within a group
}
// The Base map tab's lines (ui/basemap.js): the grid, the yard, the walls and what is placed.
export function baseMapSummary(state, base) {
  const G = gridHalf(base), C = yardHalf(base), [ox, oy] = originOf(base);
  const lay = layoutOf(state, base);
  const byHand = lay.filter((e) => !e.auto).length, off = lay.filter((e) => !e.at).length;
  const people = atBase(state, base.id).length;
  const wi = wallInfo(state, base);
  return { grid: 2 * G, origin: [ox, oy], yard: 2 * C, ring: 2 * ringHalf(base), walled: wi.enclosed, wall: wi, items: lay.length, byHand, off, people, tier: tierName(base) };
}
