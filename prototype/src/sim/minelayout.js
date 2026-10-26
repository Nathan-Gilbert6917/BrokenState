// @ts-check
// Mines and quarries (issue #52 of the round-2 epic #39, the user's request 2026-10-26: "Add mine, quarry"): two
// building types of their own, `mine` and `quarry` (buildingmaps.js BUILDINGS.mine, BUILDINGS.quarry), thirteen plans
// each. They renovate the world's quarry site (laid out as a workshop before) and the mine shack point of interest (a
// cabin before): in a new save SITES.quarry opens the quarry type and SITES.mineshack the mine type (buildingmaps.js
// MINE_SITES); an older save (worldcfg.js legacyMines) keeps the workshop and the cabin, its maps and containers as
// they were.
//
// The mine's plans (MINE_PLANS; sizes in metres, a cell a metre, from data-buildingsize.js REAL_SIZE.mine.sizes):
//   shaft      a shaft mine: the headframe over the shaft in its collar house, the hoist house, the lamp room, the dry,
//              the generator house; below, two or three levels (the engine's storeys named down, spec.below, as #26's
//              bunkers: "Level −1"...): the shaft station and the haulage drift under the collar, drifts, stopes, the
//              ore pass, the pump room and the sump, a refuge chamber, rock between them;
//   hardrock   a deep hard-rock mine of three levels below: a skip-and-cage shaft, an underground explosives magazine, a
//              crusher station by the ore pass, the stopes and drifts either side of the haulage way;
//   drift      a drift mine into a hillside: the portal and its lamp shed on the slope, the main drift straight into the
//              rock with crosscuts, stopes and a ventilation raise off it (one level, the hill all round it);
//   gold       an abandoned gold mine: the prospector's shack, the adit with a caved-in drift and a winze down to the
//              old stope below;
//   coal       a coal mine with its tipple: the tipple over the loading track, the lamp house, the office, the
//              bathhouse; below, the belt drift and the room-and-pillar workings (pillars of coal left standing);
//   dry        the mine office, bathhouse and lamp room: the superintendent's office, the dry (lockers, showers, the
//              clothes hung on chains), the lamp room and its charging racks, first aid, the rescue room;
//   magazine   an explosives magazine: the powder magazine behind its steel door (locked), the cap house, the
//              magazine keeper's shed;
//   slope      a slope mine: the portal and the hoist room at the head of an incline, two levels down the slope;
//   salt       a salt mine: the shaft house and the office on top, a level of huge rooms and pillars below;
//   showmine   a show mine: the visitor centre (tickets, the gift shop, a mining museum room), the tour tunnel below;
//   rescue     a mine rescue station: the apparatus room, the rescue truck's garage, the training gallery below;
//   mill       an ore mill and concentrator of two storeys: the crusher room, the ball mill hall, the flotation cells,
//              the assay office, the reagent store;
//   complex    a mine complex (compound.js, a map up to 400 × 400): the shaft mine's headframe building with its levels,
//              the office and dry, the ore mill, the mine shops, the explosives magazine off by itself, the waste dump,
//              ore cars on their track, haul trucks (complexMap).
// The quarry's plans (QUARRY_PLANS; REAL_SIZE.quarry.sizes):
//   pit        an open-pit quarry (compound.js, a map up to 400 × 400): the pit stepped down in benches (crag faces,
//              gravel benches, a pond at the bottom), the haul road spiralling down it, haul trucks and a loader on the
//              benches, the crusher and screening plant at the rim, the scale house by the gate, the maintenance shop,
//              the explosives magazine off by itself, the gravel yard's stockpiles (pitMap);
//   crusher    a crusher and screening plant of two storeys: the primary and secondary crushers, the screen house
//              above, the conveyor gallery, the control room, the motor control room;
//   scale      a scale house: the scale office and its window, a restroom; the scale deck and a stockpile outside;
//   shop       the maintenance shop: truck bays, the parts room, the lube room, the welding bay, the office;
//   magazine   the quarry's explosives magazine: the powder magazine and the cap magazine (locked), the blaster's shed;
//   gravel     a gravel yard: the yard office and counter, the loader shed; stockpiles outside;
//   granite    a granite quarry's cutting shed: the wire saw and the gang saw, the finishing shop, the slab store;
//   lime       a limestone quarry's lime kilns: the kiln house (two storeys: the charging floor over the draw hole), the
//              lime shed, the office;
//   slate      a slate quarry: the splitting shed, the dressing shed, the tool house, the powder house;
//   sand       a sand and gravel pit's wash plant: the wash plant, the screen, the pump house, the office;
//   asphalt    an asphalt plant: the drum mixer house, the control house, the lab, the burner fuel room;
//   concrete   a ready-mix batch plant: the batch house, the control room, the cement store, the lab, the wash bay;
//   flooded    an abandoned flooded quarry: the old cutting shed, the derrick house, a tool shed; the water outside.
//
// Underground (the choice, recorded in docs/features/combat.md "Mines and quarries"): #26's storeys named down
// (spec.below; bunkerlayout.js levelName), each the footprint's full size, rock between the workings (a { role: "rock" }
// leaf: crag cells). Every room down there (room.under, areas' `under`) is dark by day too, and its lights work only
// while the mine's generator runs: indoorlight.js treats an `under` room as a bunker's, and the generator house's genset
// (data-furniture.js genset: the act "genset", combat.js) lights every one of them at once, loud. The shaft is the stair
// run: a manway beside the cage, from the collar house down through every level's shaft station.
// Collapsed drifts: a drift's dead end caved in (COLLAPSE of them; the gold mine's always): cave-in pieces wall to wall
// across its last cells (data-furniture.js cavein: rock fall, fixed, no way through), timber sets broken along it; a
// scene ("caved") puts someone under it.
//
// The rooms (MINE_ROLES, merged into buildingmaps.js ROLES) use the loot tables a mine or a quarry really holds
// (combat.js AREAS): the shops a workshop's (tools, parts, scrap), the generator, compressor and lube rooms a garage's
// (fuel, parts), the workings underground their own (mineunder: ore as stone, scrap, a tool left, a lamp), the dry its
// own (minedry: hard hats, lamps, work clothes' pockets), the lamp room its own (minelamp), the magazines their own
// (minemag: fuse and flares mostly; the explosives in the locked powder boxes, combat.js BOX_LOOT powderbox, rare).
// Their pieces (MINE_STYLES, by the room's mine mark): the headframe's shaft and cage, the hoist drum, the genset, timber
// sets and ore cars down the drifts, the ore chute, rock pillars, the jaw crusher, the screen deck, conveyors, lamp
// racks; stockpiles outside (gravelpile).
//
// Which plan: the building's own dice (hash dice, never consumed) through the shared picker (variantpick.js
// pickVariant, #41) weighted by the tile's class (#42's placement.js: scenic hills and mountains most, then the
// country; w.any where unset). opts.plan pins one. An older save never builds one (legacyMines: its sites keep the
// workshop and the cabin; BUILDINGS' o.legacy: the workshop's classic plan).
import { REAL_SIZE } from "./data-buildingsize.js";
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { registerScene } from "./interiorscenes.js";
import { compoundGrid, placeBuilding, guard, compoundResult, compoundVehicle } from "./compound.js";
import { levelName } from "./bunkerlayout.js";
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";

export const MINE = {
  // The containers a plan's rooms hold: each room's share × this (spec.boxScale), tuned with tools/lootsensetest.js and
  // tools/minetest.js so a mine or a quarry holds about what a factory or a workshop does an area.
  LOOT: {
    mine: { shaft: 3.2, hardrock: 4.6, drift: 1.7, gold: 1.1, coal: 3, dry: 2, magazine: 2.4, slope: 1.6, salt: 4.2, showmine: 1.4, rescue: 2, mill: 4, complex: 2.8 },
    quarry: { pit: 2.7, crusher: 4, scale: 3.6, shop: 2.3, magazine: 2.3, gravel: 1, granite: 2.3, lime: 2, slate: 1.1, sand: 1.8, asphalt: 2, concrete: 1.3, flooded: 0.9 },
  },
  COLLAPSE: 0.35,       // a drift's dead end caved in
  CARTS: [1, 3],        // ore cars down a drift
  WALL: "#7d6e5d",      // the rock's colour on the walls underground (decor.js wallColour: room.wallc)
  YARD: { piles: [2, 4] },
  // The mine complex's map (complexMap) and the open pit's (pitMap): the edge, the gaps between buildings; the pit's
  // radius (its rim), its benches' width and count, the haul road's width; the haul trucks. CAP: issue #52's 400.
  COMPLEX: { EDGE: 8, GAP: [8, 12], DUMP: [18, 26], CARTS: [4, 8], TRUCKS: [1, 3], CAP: 400 },
  PIT: { EDGE: 10, R: [60, 130], BENCH: [7, 10], ROAD: 4, TRUCKS: [2, 4], PILES: [6, 10], CAP: 400 },
};

// ---------- the rooms only these buildings have (merged into buildingmaps.js ROLES) ----------
const role = (name, type, furnish, extra = {}) => ({ name, type, furnish, ...extra });
export const MINE_ROLES = {
  // the mine's surface
  minecollar:  role("Collar house", "workshop", "machines", { hub: true, fl: "conc", maxBoxes: 3 }),
  minehoist:   role("Hoist house", "workshop", "machines", { fl: "conc", maxBoxes: 3 }),
  minegen:     role("Generator house", "garage", "machines", { fl: "conc", windows: false, maxBoxes: 3 }),
  minelamp:    role("Lamp room", "minelamp", "racks", { fl: "conc", maxBoxes: 4 }),
  minedry:     role("Bathhouse", "minedry", "lockers", { fl: "tile", maxBoxes: 6 }),
  minemag:     role("Explosives magazine", "minemag", "racks", { fl: "conc", windows: false, maxBoxes: 4, dk: "steel" }),
  minetipple:  role("Tipple", "workshop", "machines", { hub: true, fl: "plank", maxBoxes: 4 }),
  mineshack:   role("Prospector's shack", "cabin", "home", { fl: "plank", maxBoxes: 3 }),
  minemill:    role("Mill hall", "workshop", "machines", { hub: true, fl: "conc", maxBoxes: 4 }),
  mineassay:   role("Assay office", "lab", "workbench", { fl: "conc", maxBoxes: 3 }),
  // underground (every one dark: room.under)
  minestation: role("Shaft station", "mineunder", "none", { hub: true, fl: "dirt", windows: false, maxBoxes: 4 }),
  minedrift:   role("Drift", "mineunder", "none", { hub: true, fl: "dirt", windows: false, maxBoxes: 5 }),
  minestope:   role("Stope", "mineunder", "none", { fl: "dirt", windows: false, maxBoxes: 6 }),
  mineorepass: role("Ore pass", "mineunder", "none", { fl: "dirt", windows: false, maxBoxes: 3 }),
  minepump:    role("Pump room", "garage", "machines", { fl: "conc", windows: false, maxBoxes: 2 }),
  minecrush:   role("Crusher station", "mineunder", "machines", { fl: "conc", windows: false, maxBoxes: 2 }),
  minerefuge:  role("Refuge chamber", "mineunder", "none", { fl: "conc", windows: false, maxBoxes: 3, dk: "steel" }),
  mineworkings: role("Workings", "mineunder", "none", { hub: true, fl: "dirt", windows: false, maxBoxes: 10 }),
  // the quarry's
  qcrusher:    role("Crusher room", "workshop", "machines", { hub: true, fl: "conc", maxBoxes: 3 }),
  qscreen:     role("Screen house", "workshop", "machines", { fl: "steel", maxBoxes: 3 }),
  qcontrol:    role("Control room", "control", "office", { fl: "conc", maxBoxes: 2 }),
  qscale:      role("Scale office", "office", "office", { hub: true, fl: "conc", maxBoxes: 2 }),
  qbay:        role("Truck bay", "garage", "machines", { hub: true, fl: "conc", maxBoxes: 5 }),
  qlube:       role("Lube room", "garage", "racks", { fl: "conc", windows: false, maxBoxes: 3 }),
  qweld:       role("Welding bay", "workshop", "workbench", { fl: "conc", maxBoxes: 3 }),
  qcut:        role("Cutting shed", "workshop", "machines", { hub: true, fl: "conc", maxBoxes: 4 }),
  qkiln:       role("Kiln house", "workshop", "machines", { hub: true, fl: "conc", windows: false, maxBoxes: 3 }),
  qsplit:      role("Splitting shed", "workshop", "workbench", { hub: true, fl: "plank", maxBoxes: 4 }),
  qwash:       role("Wash plant", "workshop", "machines", { hub: true, fl: "steel", maxBoxes: 3 }),
  qmixer:      role("Mixer house", "workshop", "machines", { hub: true, fl: "conc", maxBoxes: 3 }),
  qlab:        role("Materials lab", "lab", "workbench", { fl: "tile", maxBoxes: 3 }),
  minegift:    role("Gift shop", "store", "shelves", { fl: "tile", maxBoxes: 4 }),
};

// ---------- the plans ----------
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
const ROCK = { role: "rock" };
/** A room: its role (buildingmaps.js ROLES), its style's mark (MINE_STYLES) and the rest. */
const R = (role, mine, o = {}) => ({ role, mine, ...o });
/** A room underground: dark (indoorlight.js), the rock's colour on its walls, no windows. */
const U = (role, mine, o = {}) => R(role, mine, { under: true, windows: false, wallc: MINE.WALL, ...o });
const roll = (rng, r) => rng.int(r[0], r[1]);
/** A plan's size: its REAL_SIZE row's. @param {any} rng @param {string} kind @param {string} id */
const size = (rng, kind, id) => { const S = REAL_SIZE[kind].sizes[id]; return { bw: roll(rng, S.w), bh: roll(rng, S.d), storeys: roll(rng, S.storeys) }; };
// The footprint's class (tools/storeytest.js FOOT): small up to 190 cells, medium to 360, large past it; wide from 280
// cells 20 across; xl from 700 cells 30 across.
const footOf = (s) => { const a = s.bw * s.bh; return a >= 700 && s.bw >= 30 ? "xl" : a > 360 ? (s.bw >= 20 ? "wide" : "large") : a <= 190 ? "small" : "medium"; };
const OFFICE = (name = "Mine office", o = {}) => R("office", "mineofc", { name, hub: true, ...o });
const roller = (side, roles, o = {}) => ({ side, roles, chance: 1, roller: true, width: 3, lock: 0.25, ...o });
const door = (side, roles, chance = 0.6, lock = 0.35) => ({ side, roles, chance, lock });
const piles = (n, name = "Stockpiles", type = "workshop") => ({ name, type, pieces: [["gravelpile", n]], loot: false });
// Underground rooms
const station = (name = "Shaft station", o = {}) => U("minestation", "station", { name, ...o });
const drift = (name = "Drift", o = {}) => U("minedrift", "drift", { name, ...o });
const stope = (name = "Stope", o = {}) => U("minestope", "stope", { name, ...o });
const orepass = (name = "Ore pass", o = {}) => U("mineorepass", "orepass", { name, ...o });
const pump = (name = "Pump room and sump", o = {}) => U("minepump", "pump", { name, ...o });
const refuge = (name = "Refuge chamber", o = {}) => U("minerefuge", "refuge", { name, ...o });
const workings = (name = "Workings", o = {}) => U("mineworkings", "workings", { name, ...o });
const undermag = () => U("minemag", "magazine", { name: "Underground magazine", lock: ["door", 0.8] });
// Surface rooms
const collar = (name = "Collar house", o = {}) => R("minecollar", "collar", { name, ...o });
const hoist = (name = "Hoist house", o = {}) => R("minehoist", "hoist", { name, ...o });
const gen = (name = "Generator house", o = {}) => R("minegen", "gen", { name, ...o });
const lamp = (name = "Lamp room", o = {}) => R("minelamp", "lamp", { name, ...o });
const dry = (name = "Bathhouse", o = {}) => R("minedry", "dry", { name, ...o });
const mag = (name = "Powder magazine", o = {}) => R("minemag", "magazine", { name, lock: ["door", 0.85], ...o });
const shop = (name = "Mine shop", o = {}) => R("workshop", "mineshop", { name, ...o });

/**
 * A level below: a hub column under the shaft (the station at the front, the haulage drift behind it) and the
 * workings either side, rock between them. L, Rt: [[depth, room | null (rock)], ...] front to back ("*": the rest).
 * @param {number} lw @param {number} sw @param {any[]} L @param {any[]} Rt @param {string} [haul]
 */
function level(lw, sw, L, Rt, haul = "Haulage drift") {
  const col = (list) => Y(...list.map(([d, r]) => [d, r || ROCK]));
  return X([lw, col(L)], [sw, Y([8, station()], ["*", drift(haul)])], ["*", col(Rt)]);
}

/** The shaft mine's plan (its own and the mine complex's headframe building: its REAL_SIZE row id). @param {any} rng @param {string} id */
function shaftMine(rng, id) {
  const s = size(rng, "mine", id), lw = Math.floor((s.bw - 2 - 7 - 2) / 2);
  const levels = [
    level(lw, 7, [[6, stope()], [2, null], [6, drift("East drift")], [2, null], ["*", stope("Stope 2")]], [[6, pump()], [2, null], [7, orepass()], [2, null], ["*", refuge()]]),
    level(lw, 7, [[7, drift("East drift")], [2, null], ["*", stope()]], [[7, orepass()], [2, null], [6, drift("West drift")], ["*", null]]),
  ];
  return {
    ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), below: true, windows: true, stairs: { roles: ["minecollar"], n: 1, len: 2 },
    program: X([lw, Y([7, lamp("Lamp room", { entry: true })], ["*", dry()])], [7, Y([10, collar("Collar house and headframe")], ["*", hoist()])], ["*", Y([7, OFFICE("Mine office")], [7, gen()], ["*", shop()])]),
    upper: (f) => levels[f - 1] || levels[levels.length - 1],
    exits: [roller("back", ["minehoist", "workshop"], { name: "Shop door", chance: 0.8 }), door("left", ["minedry"], 0.6, 0.3)],
  };
}

/** The crusher and screening plant's plan (its own and the open pit's main building). @param {any} rng @param {string} id */
function crusherPlant(rng, id) {
  const s = size(rng, "quarry", id);
  return {
    ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), stairs: { roles: ["qcrusher"], n: 1 }, yardPieces: piles(MINE.YARD.piles),
    program: X([9, Y([6, R("qcontrol", "control", { name: "Control room", entry: true })], ["*", R("storage", "mcc", { name: "Motor control room", type: "control" })])], ["*", Y([8, R("qcrusher", "crusher", { name: "Secondary crusher" })], ["*", R("qcrusher", "crusher", { name: "Primary crusher", primary: true })])]),
    upper: () => X([9, R("corridor", null, { name: "Conveyor gallery" })], ["*", R("qscreen", "screen", { name: "Screen house" })]),
    exits: [roller("back", ["qcrusher"], { name: "Dump hopper" }), roller("right", ["qcrusher"], { name: "Conveyor door", chance: 0.8 })],
  };
}

/** @typedef {{ id: string, name: string, w: Record<string, number>, make: (rng: any, o: any) => any }} MinePlan */
/** @type {MinePlan[]} */
export const MINE_PLANS = [
  { id: "shaft", name: "Shaft mine and headframe", w: { scenic: 3, rural: 1.5, any: 1 }, make: (rng) => shaftMine(rng, "shaft") },
  { id: "hardrock", name: "Deep hard-rock mine", w: { scenic: 2.5, rural: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "hardrock"), lw = Math.floor((s.bw - 2 - 8 - 2) / 2);
    const levels = [
      level(lw, 8, [[7, undermag()], [2, null], [7, drift("North crosscut")], [2, null], ["*", stope("Cut-and-fill stope")]], [[7, pump()], [2, null], ["*", refuge("Lunchroom and refuge")]], "Haulage way"),
      level(lw, 8, [[8, stope("Shrinkage stope")], [2, null], ["*", drift("Footwall drift")]], [[8, orepass("Ore pass and grizzly")], [2, null], ["*", stope("Long-hole stope")]], "Haulage way"),
      level(lw, 8, [[9, U("minecrush", "crushstation", { name: "Crusher station" })], ["*", null]], [[8, orepass("Skip pocket")], [2, null], ["*", drift("Exploration drift")]], "Haulage way"),
    ];
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), below: true, stairs: { roles: ["minecollar"], n: 1, len: 2 },
      program: X([lw, Y([8, OFFICE("Shift office", { entry: true })], [8, lamp()], ["*", dry("Change house")])], [8, Y([12, collar("Shaft house")], ["*", hoist("Double-drum hoist room")])], ["*", Y([8, R("minegen", "gen", { name: "Compressor and generator house" })], [7, shop("Machine shop")], ["*", R("storage", "minestores", { name: "Warehouse", type: "warehouse" })])]),
      upper: (f) => levels[f - 1] || levels[levels.length - 1],
      exits: [roller("back", ["minehoist"], { name: "Hoist room door", chance: 0.7 }), roller("right", ["storage"], { name: "Warehouse dock" })],
    };
  } },
  { id: "drift", name: "Drift mine into the hillside", w: { scenic: 3, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "drift");
    const side = (list) => Y(...list.map(([d, r]) => [d, r || ROCK]));
    return {
      ...s, front: { width: 2 }, ground: "rock", rockFill: true, foot: footOf(s), windows: false,
      program: X([9, Y([6, lamp("Portal shed", { entry: true, under: false })], [5, gen("Compressor shed")], ["*", ROCK])],
        [6, side([[6, U("minedrift", "drift", { name: "Portal", hub: true })], ["*", drift("Main drift")]])],
        ["*", side([[4, stope("Crosscut stope")], [2, null], [4, drift("Crosscut")], [2, null], [4, orepass("Ventilation raise")], ["*", stope("Back stope")]])]),
      exits: [],
    };
  } },
  { id: "gold", name: "Abandoned gold mine", w: { scenic: 2.5, rural: 0.5, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "gold");
    return {
      ...s, front: { width: 1 }, ground: "rock", rockFill: true, foot: footOf(s), below: true, windows: true, openDoors: 0.5, stairs: { roles: ["minedrift"], n: 1, len: 2 },
      program: X([7, Y([7, R("mineshack", "shack", { name: "Prospector's shack", entry: true })], ["*", R("storage", "minestores", { name: "Powder and tool shed", type: "workshop" })])],
        ["*", Y([5, U("minedrift", "drift", { name: "Adit", hub: true })], ["*", drift("Old drift", { caved: true })])]),
      upper: () => X([7, ROCK], ["*", Y([5, stope("Winze stope")], ["*", drift("Lower drift", { caved: true })])]),
      exits: [],
    };
  } },
  { id: "coal", name: "Coal mine and tipple", w: { scenic: 2, rural: 1.5, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "coal"), lw = Math.floor((s.bw - 2 - 7 - 2) / 2);
    const levels = [X([lw, Y([8, workings("Working face")], ["*", workings("Room-and-pillar workings")])], [7, Y([8, station("Slope bottom")], ["*", drift("Belt drift")])], ["*", Y([6, pump("Sump")], [2, ROCK], ["*", workings("Old workings")])])];
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), below: true, stairs: { roles: ["minetipple"], n: 1, len: 2 },
      program: X([lw, Y([7, OFFICE("Mine office", { entry: true })], [6, lamp("Lamp house")], ["*", dry()])], [7, R("minetipple", "tipple", { name: "Tipple" })], ["*", Y([7, R("minehoist", "hoist", { name: "Belt drive house" })], [6, gen()], ["*", shop("Supply house")])]),
      upper: (f) => levels[f - 1] || levels[0],
      exits: [roller("back", ["minetipple"], { name: "Loading track", width: 3 }), door("right", ["workshop"], 0.6, 0.3)],
    };
  } },
  { id: "dry", name: "Mine office, bathhouse and lamp room", w: { scenic: 1.5, rural: 1.5, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "dry");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), stairs: { roles: ["corridor"], n: 1 },
      program: Y([6, X([9, OFFICE("Superintendent's office", { entry: true })], [3, R("corridor", null, { name: "Hall" })], [6, R("medbay", "minefirst", { name: "First aid", type: "nurse" })], ["*", lamp()])], ["*", X(["*", dry("The dry")], [8, R("storage", "minerescue", { name: "Rescue room", type: "minelamp" })])]),
      upper: () => Y([6, X([9, OFFICE("Engineer's office")], [3, R("corridor", null, { name: "Hall" })], ["*", R("office", "mineofc", { name: "Map room" })])], ["*", R("breakroom", null, { name: "Lunchroom" })]),
      exits: [door("back", ["minedry"], 0.8, 0.3), door("left", ["minelamp"], 0.6, 0.3)],
    };
  } },
  { id: "magazine", name: "Explosives magazine", w: { scenic: 1.5, rural: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "magazine");
    return {
      ...s, front: { width: 1 }, ground: "rock", foot: footOf(s), windows: false,
      program: X([4, R("office", "mineofc", { name: "Keeper's shed", entry: true })], ["*", mag()], [3, mag("Cap house", { lock: ["door", 0.7], caps: true })]),
      exits: [],
    };
  } },
  { id: "slope", name: "Slope mine", w: { scenic: 2, rural: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "slope"), lw = Math.floor((s.bw - 2 - 6 - 2) / 2);
    const levels = [
      X([lw, Y([6, stope("Upper stope")], [2, ROCK], ["*", drift("Upper drift")])], [6, Y([7, station("Slope landing")], ["*", drift("Slope")])], ["*", Y([7, orepass("Chute")], ["*", ROCK])]),
      X([lw, Y([6, refuge()], ["*", stope("Lower stope")])], [6, Y([7, station("Slope bottom")], ["*", drift("Slope")])], ["*", Y([6, pump("Sump")], [2, ROCK], ["*", drift("Lower drift")])]),
    ];
    return {
      ...s, front: { width: 2 }, ground: "rock", rockFill: true, foot: footOf(s), below: true, stairs: { roles: ["minecollar"], n: 1, len: 2 },
      program: X([lw, Y([6, lamp("Lamp shed", { entry: true })], ["*", ROCK])], [6, Y([8, collar("Slope portal")], ["*", ROCK])], ["*", Y([7, hoist("Hoist room")], [5, gen("Compressor room")], ["*", ROCK])]),
      upper: (f) => levels[f - 1] || levels[levels.length - 1],
      exits: [],
    };
  } },
  { id: "salt", name: "Salt mine", w: { rural: 2, scenic: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "salt"), lw = Math.floor((s.bw - 2 - 7 - 2) / 2);
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), below: true, stairs: { roles: ["minecollar"], n: 1, len: 2 },
      program: X([lw, Y([8, OFFICE("Mine office", { entry: true })], ["*", R("storage", "minestores", { name: "Salt warehouse", type: "warehouse" })])], [7, Y([10, collar("Shaft house")], ["*", hoist()])], ["*", Y([8, gen()], ["*", shop("Maintenance shop")])]),
      upper: () => X([lw, Y([9, workings("Salt room", { salt: true })], ["*", workings("Salt room 2", { salt: true })])], [7, Y([8, station()], ["*", drift("Main entry")])], ["*", Y([8, R("minepump", "pump", { name: "Underground shop", under: true, windows: false, wallc: MINE.WALL, type: "workshop" })], ["*", workings("Salt room 3", { salt: true })])]),
      exits: [roller("back", ["storage"], { name: "Loading door" }), roller("right", ["workshop"], { chance: 0.7 })],
    };
  } },
  { id: "showmine", name: "Show mine", w: { scenic: 1.5, rural: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "showmine"), lw = Math.floor((s.bw - 2 - 6 - 2) / 2);
    return {
      ...s, front: { width: 2 }, ground: "rural", foot: footOf(s), below: true, stairs: { roles: ["minecollar"], n: 1, len: 2 },
      program: X([lw, Y([7, R("office", "minetickets", { name: "Ticket office", entry: true })], ["*", R("office", "minemuseum", { name: "Mining museum room" })])], [6, Y([7, collar("Tour entrance")], ["*", gen("Generator room")])], ["*", Y([7, R("minegift", "minegift")], ["*", lamp("Lamp and hat room")])]),
      upper: () => X([lw, Y([6, stope("Old stope")], [2, ROCK], ["*", drift("Tour drift")])], [6, Y([8, station("Tour landing")], ["*", drift("Tour tunnel")])], ["*", Y([6, refuge()], ["*", stope("Gold room")])]),
      exits: [door("back", ["minegen"], 0.5, 0.4)],
    };
  } },
  { id: "rescue", name: "Mine rescue station", w: { scenic: 1, rural: 1.5, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "rescue");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), below: true, stairs: { roles: ["storage"], n: 1, len: 2 },
      program: X([8, Y([6, OFFICE("Captain's office", { entry: true })], ["*", R("storage", "minerescue", { name: "Apparatus room", type: "minelamp" })])], ["*", R("bays", "minegarage", { name: "Rescue truck garage", type: "garage" })]),
      upper: () => X([8, Y([6, refuge("Training refuge")], ["*", station("Gallery stair foot")])], ["*", drift("Smoke gallery")]),
      exits: [roller("front", ["bays"], { name: "Garage door" }), door("back", ["bays"], 0.6, 0.3)],
    };
  } },
  { id: "mill", name: "Ore mill and concentrator", w: { scenic: 1.5, rural: 1.5, any: 1 }, make: (rng) => {
    const s = size(rng, "mine", "mill");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), stairs: { roles: ["minemill"], n: 1 },
      program: X([9, Y([7, R("mineassay", "assay", { name: "Assay office", entry: true })], ["*", R("storage", "minestores", { name: "Reagent store", type: "garage", lock: ["door", 0.3] })])], ["*", Y([10, R("minemill", "crusher", { name: "Crusher room" })], ["*", R("minemill", "ballmill", { name: "Ball mill hall" })])]),
      upper: () => X([9, Y([7, R("qcontrol", "control", { name: "Mill control room" })], ["*", R("storage", "minestores", { name: "Concentrate store", type: "workshop" })])], ["*", R("minemill", "flotation", { name: "Flotation floor" })]),
      exits: [roller("back", ["minemill"], { name: "Ore bin door" }), roller("right", ["minemill"], { name: "Concentrate door", chance: 0.7 })],
    };
  } },
  { id: "complex", name: "Mine complex", w: { scenic: 1.5, rural: 0.5, any: 0.8 }, make: (rng) => ({ ...shaftMine(rng, "complex"), complex: "mine" }) },
];

/** @type {MinePlan[]} */
export const QUARRY_PLANS = [
  { id: "pit", name: "Open-pit quarry", w: { scenic: 3, rural: 1.5, any: 1 }, make: (rng) => ({ ...crusherPlant(rng, "pit"), complex: "pit" }) },
  { id: "crusher", name: "Crusher and screening plant", w: { scenic: 1.5, rural: 1.5, any: 1 }, make: (rng) => crusherPlant(rng, "crusher") },

  { id: "scale", name: "Scale house", w: { scenic: 1.5, rural: 1.5, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "scale");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: piles([1, 2], "Scale deck and stockpile"),
      program: X(["*", R("qscale", "scale", { name: "Scale office", entry: true })], [3, R("restroom")]),
      exits: [door("right", ["qscale"], 0.8, 0.3)],
    };
  } },
  { id: "shop", name: "Quarry maintenance shop", w: { scenic: 1.5, rural: 1.5, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "shop");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s),
      program: X([9, Y([6, R("office", "mineofc", { name: "Shop office", entry: true })], [6, R("breakroom")], ["*", R("storage", "minestores", { name: "Parts room", type: "warehouse" })])], ["*", R("qbay", "bay", { name: "Truck bays" })], [9, Y([8, R("qweld", "weld", { name: "Welding bay" })], ["*", R("qlube", "lube", { name: "Lube room" })])]),
      exits: [roller("front", ["qbay"], { name: "Bay door", width: 5 }), roller("back", ["qbay"], { name: "Back bay door", width: 5 }), door("right", ["qweld", "qlube"], 0.6, 0.3)],
    };
  } },
  { id: "magazine", name: "Quarry explosives magazine", w: { scenic: 1.5, rural: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "magazine");
    return {
      ...s, front: { width: 1 }, ground: "rock", foot: footOf(s), windows: false,
      program: Y([3, R("office", "mineofc", { name: "Blaster's shed", entry: true })], ["*", X(["*", mag("Powder magazine")], [3, mag("Cap magazine", { lock: ["door", 0.75], caps: true })])]),
      exits: [],
    };
  } },
  { id: "gravel", name: "Gravel yard", w: { rural: 2, scenic: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "gravel");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: piles([4, 7], "Gravel yard"),
      program: X([8, R("office", "minecounter", { name: "Yard office and counter", entry: true, type: "hardware" })], ["*", R("qbay", "bay", { name: "Loader shed", loader: true })]),
      exits: [roller("right", ["qbay"], { name: "Loader door" })],
    };
  } },
  { id: "granite", name: "Granite quarry and cutting shed", w: { scenic: 2, rural: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "granite");
    return {
      ...s, front: { width: 2 }, ground: "rock", foot: footOf(s), yardPieces: piles([2, 4], "Block yard"),
      program: X([8, Y([6, R("office", "mineofc", { name: "Quarry office", entry: true })], ["*", R("storage", "minestores", { name: "Slab store", type: "hardware" })])], ["*", R("qcut", "cut", { name: "Cutting shed" })], [9, R("qweld", "weld", { name: "Finishing shop", finish: true })]),
      exits: [roller("back", ["qcut"], { name: "Block door", width: 4 }), roller("right", ["qweld"], { chance: 0.7 })],
    };
  } },
  { id: "lime", name: "Limestone quarry and lime kilns", w: { scenic: 2, rural: 1.5, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "lime");
    return {
      ...s, front: { width: 1 }, ground: "rock", foot: footOf(s), stairs: { roles: ["qkiln"], n: 1 }, yardPieces: piles([1, 3], "Stone pile"),
      program: X([7, Y([6, R("office", "mineofc", { name: "Kiln office", entry: true })], ["*", R("storage", "minestores", { name: "Lime shed", type: "hardware" })])], ["*", R("qkiln", "kiln", { name: "Draw hole and kilns" })]),
      upper: () => X([7, R("storage", "minestores", { name: "Coal store", type: "garage" })], ["*", R("qkiln", "kiln", { name: "Charging floor", top: true })]),
      exits: [roller("back", ["qkiln"], { name: "Draw door", width: 2 })],
    };
  } },
  { id: "slate", name: "Slate quarry and splitting sheds", w: { scenic: 2.5, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "slate");
    return {
      ...s, front: { width: 2 }, ground: "rock", foot: footOf(s), yardPieces: piles([2, 3], "Slate tips"),
      program: X(["*", R("qsplit", "split", { name: "Splitting shed", entry: true })], [8, R("qsplit", "split", { name: "Dressing shed", dress: true })], [6, R("storage", "minestores", { name: "Tool house", type: "workshop" })], [4, mag("Powder house", { lock: ["door", 0.6] })]),
      exits: [roller("back", ["qsplit"], { name: "Tram door", width: 2 })],
    };
  } },
  { id: "sand", name: "Sand and gravel pit with wash plant", w: { rural: 2, scenic: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "sand");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: piles([3, 5], "Sand piles"),
      program: X([7, Y([6, R("office", "mineofc", { name: "Pit office", entry: true })], ["*", R("minepump", "pump", { name: "Pump house", type: "garage" })])], ["*", R("qwash", "wash", { name: "Wash plant" })], [7, R("qscreen", "screen", { name: "Screen room" })]),
      exits: [roller("back", ["qwash"], { name: "Feed door" }), roller("right", ["qscreen"], { name: "Stacker door", chance: 0.7 })],
    };
  } },
  { id: "asphalt", name: "Asphalt plant", w: { rural: 1.5, scenic: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "asphalt");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: piles([2, 4], "Aggregate bins"),
      program: X([8, Y([6, R("qcontrol", "control", { name: "Control house", entry: true })], ["*", R("qlab", "lab", { name: "Asphalt lab" })])], ["*", R("qmixer", "mixer", { name: "Drum mixer house", drum: true })], [7, R("qlube", "lube", { name: "Burner fuel room", fuel: true })]),
      exits: [roller("back", ["qmixer"], { name: "Silo door" }), door("right", ["qlube"], 0.7, 0.5)],
    };
  } },
  { id: "concrete", name: "Ready-mix batch plant", w: { rural: 1.5, scenic: 0.5, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "concrete");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), yardPieces: piles([2, 3], "Aggregate piles"),
      program: Y([6, X([8, R("qcontrol", "control", { name: "Batch control room", entry: true })], [7, R("qlab", "lab", { name: "Concrete lab" })], ["*", R("storage", "minestores", { name: "Cement store", type: "hardware" })])], ["*", X(["*", R("qmixer", "mixer", { name: "Batch house" })], [8, R("qbay", "bay", { name: "Truck wash bay", wash: true })])]),
      exits: [roller("back", ["qmixer"], { name: "Charging door" }), roller("right", ["qbay"], { name: "Wash bay door" })],
    };
  } },
  { id: "flooded", name: "Abandoned flooded quarry", w: { scenic: 2, rural: 1, any: 1 }, make: (rng) => {
    const s = size(rng, "quarry", "flooded");
    return {
      ...s, front: { width: 1 }, ground: "rock", foot: footOf(s), openDoors: 0.6, yardPieces: piles([1, 2], "Spoil heap"),
      program: X(["*", R("qcut", "cut", { name: "Old cutting shed", old: true, entry: true })], [5, Y([5, R("minehoist", "hoist", { name: "Derrick house" })], ["*", R("storage", "minestores", { name: "Tool shed", type: "workshop" })])]),
      exits: [door("back", ["qcut"], 0.8, 0.1)],
    };
  } },
];
export const MINE_IDS = MINE_PLANS.map((p) => p.id);
export const QUARRY_IDS = QUARRY_PLANS.map((p) => p.id);
// The registry's view (variantpick.js, issue #41): "mine" and "quarry", weighted by the tile's class (any where
// unset), each entry's foot its REAL_SIZE row's middle (its size class by #42's sizeClassOf).
const mid = (r) => Math.round((r[0] + r[1]) / 2);
for (const [kind, list] of /** @type {[string, MinePlan[]][]} */ ([["mine", MINE_PLANS], ["quarry", QUARRY_PLANS]])) {
  registerVariants(kind, list.map((p) => { const S = REAL_SIZE[kind].sizes[p.id]; return { id: p.id, name: p.name, w: { ...p.w }, size: p.id, foot: [mid(S.w), mid(S.d), mid(S.storeys)], make: p.make }; }));
}

/**
 * The spec of a mine or a quarry (a new save's): its plan by its dice and its tile's class (o.tileClass; else its
 * setting), or o.plan's. The spec carries vid, vname and realSize (its REAL_SIZE sizes row).
 * @param {"mine" | "quarry"} kind @param {any} rng @param {any} o
 */
export function minePlan(kind, rng, o = {}) {
  const set = o.where && o.where.setting ? o.where.setting : o.setting || null;
  const e = /** @type {any} */ (pickVariant(kind, rng, { plan: o.plan ?? null, tileClass: o.tileClass || null, setting: o.tileClass ? null : set }));
  const spec = e.make(rng, o);
  return { ...spec, vid: e.id, vname: e.name, realSize: e.id, boxScale: MINE.LOOT[kind][e.id] || 1, mineKind: kind };
}

// ======================================================================================
// The rooms (MINE_STYLES, by the plan leaf's mine mark)
// ======================================================================================
/** @typedef {any} Lay */
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
/** Lootable pieces of these kinds against the walls, then off them, until the room holds its share. */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
/** Up to n of k against the walls. */
function some(L, k, n, o = {}) { const out = []; for (let i = 0; i < n; i++) { const r = L.wall(k, P(L, o)); if (!r) break; out.push(r); } return out; }
function deskSet(L, o = {}) { const d = L.wall("desk", P(L, { prefer: "middle", ...o })); if (d) L.around(d, "chair", 1); return d; }
const longX = (c) => c.w >= c.h;
/**
 * A drift's dead end caved in: cave-in pieces wall to wall across its last `n` cells along its long axis (the end with
 * no door: the far end from the room's first door), only where the room's lanes and the guard allow. Returns the cells.
 */
function caveIn(L, n) {
  const c = L.c, ax = longX(c), d = (L.room.doors || [])[0];
  const lo = ax ? c.x0 : c.y0, hi = ax ? c.x1 : c.y1;
  const dpos = d ? (ax ? d[0] : d[1]) : lo;
  const farHi = Math.abs(dpos - hi) >= Math.abs(dpos - lo);
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = farHi ? hi - k : lo + k;
    for (let b = ax ? c.y0 : c.x0; b <= (ax ? c.y1 : c.x1); b++) {
      const [x, y] = ax ? [a, b] : [b, a];
      if (L.ok(x, y) && L.place("cavein", [[x, y]], { face: "s" })) out.push([x, y]);
    }
  }
  return out;
}
/** Timber sets down a drift's walls every few cells (the props holding the back). */
function timbers(L, every = 3) {
  const c = L.c, ax = longX(c);
  for (let a = (ax ? c.x0 : c.y0) + 1; a <= (ax ? c.x1 : c.y1) - 1; a += every) {
    for (const b of ax ? [c.y0, c.y1] : [c.x0, c.x1]) { const [x, y] = ax ? [a, b] : [b, a]; if (L.ok(x, y)) L.place("timberset", [[x, y]], { face: ax ? (b === c.y0 ? "s" : "n") : b === c.x0 ? "e" : "w" }); }
  }
}

export const MINE_STYLES = {
  // ---------- the mine's surface ----------
  // The collar house: the headframe's shaft and cage over the shaft (2 × 2, fixed), the bell signal (a control panel),
  // a tool chest; the stair run beside the cage is the manway down.
  collar(L) { L.centre("headframe", { size: [2, 2] }) || L.need("headframe"); L.wall("ctrlpanel", { prefer: "corner" }); fill(L, ["toolchest", "orecart"]); },
  // The hoist house: the hoist drum and its control stand, the hoistman's chair, the brake's oil drums.
  hoist(L) { L.centre("hoist", { size: [2, 1] }) || L.need("hoist"); L.wall("ctrlpanel", P(L, { prefer: "middle" })); fill(L, ["toolchest", "drum", "shelf"]); },
  // The generator house: the genset that powers the mine's lights (act "genset": every room underground lit), the fuel
  // tank, drums, the compressor.
  gen(L) { L.wall("genset", { prefer: "corner" }) || L.need("genset"); L.wall("fueltank", { prefer: "corner" }); L.wall("compressor", { prefer: "corner" }); fill(L, ["drum", "toolchest", "shelf"]); },
  // The lamp room: racks of cap lamps on their chargers along the walls, the check-in board (a whiteboard), the counter.
  lamp(L) { some(L, "lamprack", 3, { prefer: "middle" }); if (!L.has("lamprack")) L.need("lamprack"); L.wall("counter", P(L, { prefer: "corner" })); L.wall("whiteboard"); fill(L, ["lamprack", "locker", "shelf"]); },
  // The dry (the bathhouse): rows of lockers, the benches, the showers along the back wall.
  dry(L) { const c = L.c; L.wall("shower", { sides: [longX(c) ? "n" : "w"], prefer: "corner" }); L.wall("shower", { sides: [longX(c) ? "n" : "w"], prefer: "corner" }); some(L, "locker", 6); L.centre("chair"); fill(L, ["locker"]); },
  // A magazine: the powder boxes (locked: boxLock) on the shelves, nothing else; the cap house's few.
  magazine(L) { some(L, "powderbox", L.room.caps ? 1 : 3, { prefer: "corner" }); if (!L.has("powderbox")) L.need("powderbox"); fill(L, ["powderbox", "shelf"]); },
  tipple(L) {
    const c = L.c, ax = longX(c);
    for (let a = (ax ? c.x0 : c.y0) + 1; a <= (ax ? c.x1 : c.y1) - 1; a++) { const [x, y] = ax ? [a, c.y0 + 1] : [c.x0 + 1, a]; if (L.ok(x, y)) L.place("conveyor", [[x, y]], { face: ax ? "s" : "e" }); }
    L.wall("orechute", { prefer: "middle" }) || L.need("orechute");
    fill(L, ["orecart", "toolchest", "orecart"]);
  },
  shack(L) { L.wall("cot", { prefer: "corner" }) || L.need("cot"); L.wall("woodstove", { prefer: "corner" }); L.centre("table"); fill(L, ["crate", "shelf", "cabinet"]); },
  mineofc(L) { deskSet(L); L.wall("filing", P(L, { prefer: "corner" })); L.wall("whiteboard"); fill(L, ["filing", "cabinet", "keyrack"]); },
  minecounter(L) { L.wall("counter", P(L, { prefer: "middle" })); L.wall("checkout", { prefer: "corner" }); deskSet(L); fill(L, ["shelf", "cabinet"]); },
  minestores(L) { fill(L, ["shelf", "crate", "palletrack"]); },
  mineshop(L) { const b = L.wall("workbench", P(L, { prefer: "middle" })) || L.need("workbench"); if (b) L.beside(b, "toolchest", P(L)); L.wall("machine", { prefer: "corner" }); fill(L, ["toolchest", "shelf", "crate"]); },
  minefirst(L) { L.wall("exambed", { prefer: "corner" }) || L.need("exambed"); fill(L, ["medcab", "cabinet"]); },
  minerescue(L) { some(L, "lamprack", 2); L.wall("hazmatrack", { prefer: "corner" }); fill(L, ["locker", "lamprack", "shelf"]); },
  minegarage(L) { L.wall("genset", { prefer: "corner" }) || L.need("genset"); L.wall("toolchest", P(L, { prefer: "corner" })); L.wall("tirerack", P(L)); fill(L, ["shelf", "locker"]); },
  minetickets(L) { L.wall("counter", P(L, { prefer: "middle" })); L.wall("checkout", { prefer: "corner" }); fill(L, ["cabinet", "displaycase"]); },
  minemuseum(L) { some(L, "displaycase", 3); L.centre("orecart"); fill(L, ["displaycase", "cabinet"]); },
  minegift(L) { L.wall("checkout", { prefer: "corner" }); some(L, "displaycase", 2); fill(L, ["shelf", "displaycase"]); },
  assay(L) { some(L, "labbench", 2); L.wall("fumehood", { prefer: "corner" }); fill(L, ["cabinet", "shelf"]); },
  crushstation(L) { L.centre("jawcrusher", { size: [2, 2] }) || L.need("jawcrusher"); fill(L, ["toolchest", "orecart"]); },
  // the mill's halls: a crusher (the jaw crusher), the ball mill (a machine of two cells) and its conveyors, the
  // flotation floor's cells (vats in rows)
  ballmill(L) { L.centre("machine", { size: [2, 1] }) || L.need("machine"); L.centre("machine", { size: [2, 1] }); L.wall("conveyor", { prefer: "middle" }); fill(L, ["toolchest", "drum", "shelf"]); },
  flotation(L) { const c = L.c; for (let y = c.y0 + 1; y <= c.y1 - 1; y += 3) for (let x = c.x0 + 1; x <= c.x1 - 1; x += 3) if (L.ok(x, y)) L.place("vat", [[x, y]], { face: "s" }); if (!L.has("vat")) L.need("vat"); fill(L, ["drum", "shelf"]); },
  // ---------- underground ----------
  // The shaft station: the cage's landing (ore cars waiting on the track), the bell phone (a control panel).
  station(L) { L.wall("ctrlpanel", { prefer: "corner" }); fill(L, ["orecart", "toolchest"]); },
  // A drift: timber sets along the walls, ore cars on the track, a tool chest; a dead end caved in now and then (the
  // gold mine's always).
  drift(L) {
    const r = L.room;
    timbers(L);
    const caved = r.caved || L.variant(100, "cave") < MINE.COLLAPSE * 100;
    if (caved && (r.doors || []).length <= 1) { const cells = caveIn(L, longX(L.c) ? 3 : 2); if (cells.length) r.caved = true; }
    for (let i = 0, n = 1 + L.variant(MINE.CARTS[1], "carts"); i < n && !full(L); i++) L.centre("orecart");
    fill(L, ["orecart", "toolchest"]);
  },
  // A stope: the broken ore piled on the floor (ore cars and the ore heap), timber, the drill's tools.
  stope(L) { timbers(L, 4); L.centre("gravelpile"); fill(L, ["orecart", "toolchest", "orecart"]); },
  orepass(L) { L.wall("orechute", { prefer: "middle" }) || L.need("orechute"); fill(L, ["orecart"]); },
  pump(L) { L.wall("machine", { prefer: "corner" }) || L.need("machine"); L.wall("drum", P(L)); fill(L, ["toolchest", "drum", "shelf"]); },
  // The refuge chamber: cots, the water tank, the first-aid cabinet, the ration shelf.
  refuge(L) { some(L, "cot", 2); L.wall("watertank", { prefer: "corner" }); fill(L, ["rationshelf", "medcab"]); },
  // Room-and-pillar workings (coal, salt): pillars of rock left standing in a grid, ore cars between them.
  workings(L) {
    const c = L.c, step = L.room.salt ? 6 : 4;
    for (let y = c.y0 + 2; y + 1 <= c.y1 - 1; y += step) for (let x = c.x0 + 2; x + 1 <= c.x1 - 1; x += step) {
      const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      if (cells.every(([a, b]) => L.ok(a, b))) L.place("pillar", cells, { face: "s", size: [2, 2] });
    }
    fill(L, ["orecart", "toolchest", "orecart"]);
  },
  // ---------- the quarry's ----------
  crusher(L) { L.centre("jawcrusher", { size: [2, 2] }) || L.need("jawcrusher"); if (!L.room.primary) L.wall("conveyor", { prefer: "middle" }); fill(L, ["toolchest", "shelf", "drum"]); },
  screen(L) { L.centre("screendeck", { size: [2, 1] }) || L.need("screendeck"); L.wall("conveyor", { prefer: "middle" }); fill(L, ["toolchest", "shelf"]); },
  control(L) { L.wall("ctrlpanel", { prefer: "middle" }) || L.need("ctrlpanel"); deskSet(L); fill(L, ["cabinet", "filing"]); },
  mcc(L) { some(L, "ctrlpanel", 2); fill(L, ["cabinet", "shelf"]); },
  scale(L) { L.wall("counter", P(L, { prefer: "middle" })); deskSet(L); fill(L, ["filing", "cabinet"]); },
  bay(L) { const r = L.room; if (r.loader || L.c.w * L.c.h >= 60) L.centre("forklift"); if (!r.wash) L.wall("carlift", { prefer: "middle" }); L.wall("toolchest", P(L, { prefer: "corner" })); L.wall("tirerack", P(L)); L.wall("enginestand", { prefer: "corner" }); fill(L, ["toolchest", "shelf", "drum"]); },
  lube(L) { if (L.room.fuel) L.wall("fueltank", { prefer: "corner" }); fill(L, ["drum", "drum", "shelf"]); if (!L.has("drum")) L.need("drum"); },
  weld(L) { const b = L.wall("workbench", P(L, { prefer: "middle" })) || L.need("workbench"); if (b) L.beside(b, "toolchest", P(L)); if (L.room.finish) L.centre("machine"); fill(L, ["toolchest", "shelf", "crate"]); },
  cut(L) { const r = L.room; if (!r.old) L.centre("machine", { size: [2, 1] }); L.centre("gravelpile"); L.wall("workbench", P(L)); fill(L, ["toolchest", "crate", "shelf"]); if (!L.has("gravelpile") && !L.has("machine")) L.need("gravelpile"); },
  kiln(L) { L.wall("kiln", { prefer: "middle" }) || L.need("kiln"); L.wall("kiln", { prefer: "middle" }); fill(L, ["crate", "toolchest", "shelf"]); },
  split(L) { some(L, "workbench", L.room.dress ? 2 : 3, { prefer: "middle" }); fill(L, ["crate", "toolchest", "shelf"]); if (!L.has("workbench")) L.need("workbench"); },
  wash(L) { L.centre("screendeck", { size: [2, 1] }) || L.need("screendeck"); L.wall("vat", { prefer: "corner" }); L.wall("conveyor", { prefer: "middle" }); fill(L, ["toolchest", "drum"]); },
  mixer(L) { L.centre("mixer") || L.need("mixer"); if (L.room.drum) L.wall("fueltank", { prefer: "corner" }); L.wall("vat", { prefer: "corner" }); fill(L, ["drum", "toolchest", "shelf"]); },
  lab(L) { some(L, "labbench", 2); fill(L, ["cabinet", "shelf"]); },
};
/** The style of a room of a mine or a quarry plan (its mine mark), or null. @param {any} room */
export function mineStyle(room) {
  return room && room.mine && MINE_STYLES[room.mine] ? MINE_STYLES[room.mine] : null;
}

// ======================================================================================
// The mine complex and the open pit (compound.js): many buildings on one map up to 400 × 400
// ======================================================================================
// The buildings besides the main one (each built with assemble at a ring of one cell, then placed facing south).
// Sizes in cells.
const PARTS = {
  dry: (rng) => ({ bw: rng.int(22, 26), bh: rng.int(12, 14), front: { width: 2 }, storeys: 1, foot: "wide", program: X([9, OFFICE("Mine office", { entry: true })], ["*", dry()], [8, lamp()]), exits: [door("back", ["minedry"], 0.7, 0.3)] }),
  mill: (rng) => ({ bw: rng.int(26, 32), bh: rng.int(16, 20), front: { width: 2 }, storeys: 1, foot: "wide", program: X([8, R("mineassay", "assay", { name: "Assay office", entry: true })], ["*", R("minemill", "ballmill", { name: "Mill hall" })], [10, R("minemill", "crusher", { name: "Crusher room" })]), exits: [roller("back", ["minemill"], { name: "Ore bin door" })] }),
  shops: (rng) => ({ bw: rng.int(24, 30), bh: rng.int(14, 16), front: { width: 2 }, storeys: 1, foot: "wide", program: X(["*", R("qbay", "bay", { name: "Vehicle shop", entry: true })], [10, Y([7, shop("Machine shop")], ["*", R("storage", "minestores", { name: "Warehouse", type: "warehouse" })])]), exits: [roller("front", ["qbay"], { name: "Shop door", width: 4 })] }),
  magazine: (rng) => ({ bw: rng.int(10, 12), bh: rng.int(7, 8), front: { width: 1 }, storeys: 1, foot: "small", windows: false, program: X([4, R("office", "mineofc", { name: "Keeper's shed", entry: true })], ["*", mag()]), exits: [] }),
  scale: (rng) => QUARRY_PLANS[2].make(rng),
  qshop: (rng) => QUARRY_PLANS[3].make(rng),
  qmag: (rng) => QUARRY_PLANS[4].make(rng),
};
const zone = (x0, y0, side, name) => ({ x0, y0, w: 3, h: 3, side, exit: side, name, vehicle: false });
/** A building of a compound: its spec assembled at a ring of one cell, its ground the compound's. */
function partOf(assemble, spec, rng, opts, boxScale) {
  spec.margins = { front: 1, back: 1, left: 1, right: 1 };
  spec.boxScale = spec.boxScale || boxScale;
  spec.ground = "none";
  delete spec.yardPieces; delete spec.rockFill;
  return assemble(rng, spec, opts);
}
const partRng = (state, tileId, id, k) => new Rng(Math.floor(hash01(state.seed, "minepart", tileId, id, k) * 4294967296) || 1);

/**
 * The mine complex's raid map (buildingmaps.js buildingMap: a spec with complex "mine"): the headframe building (the
 * shaft mine's plan, with its levels below) in the middle, the office and dry by the gate, the ore mill beside the
 * headframe, the mine shops, the explosives magazine off in a corner behind a berm, the waste dump (rock piles), ore
 * cars along the track from the collar to the mill, haul trucks. One map of many buildings (compound.js), its floors
 * below named as the mine's levels. assemble: buildingmaps.js's (handed over: no import back).
 * @param {any} state @param {number} tileId @param {any} option @param {any} withVehicle @param {any} spec @param {(rng: any, spec: any, opts: any) => any} assemble
 */
export function complexMap(state, tileId, option, withVehicle, spec, assemble) {
  const rng = new Rng(Math.floor(hash01(state.seed, "minecomplex", tileId, option.id) * 4294967296) || 1);
  const M = MINE.COMPLEX, key = option.key || "mine", id = option.id || key, scale = MINE.LOOT.mine.complex;
  const part = (k, sp, name) => ({ name, m: partOf(assemble, sp, partRng(state, tileId, id, k), { key, id: `${id}#${k}`, name }, scale) });
  const main = { name: "Headframe and hoist house", m: partOf(assemble, { ...spec, complex: null }, rng, { key, id: `${id}#0`, name: "Headframe and hoist house" }, scale) };
  const B = [main, part(1, PARTS.dry(rng), "Office and dry"), part(2, PARTS.mill(rng), "Ore mill"), part(3, PARTS.shops(rng), "Mine shops"), part(4, PARTS.magazine(rng), "Explosives magazine")];
  const [HF, DR, ML, SH, MG] = B.map((b) => ({ ...b, w: b.m.building.w, h: b.m.building.h }));
  const E = M.EDGE, gap = () => rng.int(M.GAP[0], M.GAP[1]), dumpW = rng.int(M.DUMP[0], M.DUMP[1]);
  // Rows, north to south: the dump and the magazine; the headframe and the mill; the shops and the office; the gate.
  const yTop = E, yMid = yTop + Math.max(MG.h, 16) + gap(), yLow = yMid + Math.max(HF.h, ML.h) + gap() + 6;
  const xHF = E + dumpW + gap(), xML = xHF + HF.w + gap() + 6;
  const W = Math.min(M.CAP, Math.max(xML + ML.w, E + DR.w + gap() + SH.w, xHF + MG.w) + E + 10);
  const H = Math.min(M.CAP, yLow + Math.max(DR.h, SH.h) + 14);
  const storeys = Math.max(...B.map((b) => b.m.storeys || 1));
  const C = compoundGrid(W, H, storeys, (x, y) => (y >= H - 4 ? "road" : Math.abs(x - Math.floor(W / 2)) <= 2 && y >= yLow - 4 ? "gravel" : "dirt"));
  for (let g = 1; g < storeys; g++) C.floors[g].name = levelName(g);
  C.floors[0].name = "Surface";
  const placed = [];
  const put = (b, x0, y0, role) => { const p = placeBuilding(C, b.m, { x0, y0, face: "s", k: C.parts.length, name: b.name, key, tag: { part: { role } } }); placed.push(p); return p; };
  put(HF, xHF, yMid, "headframe");
  put(ML, Math.min(W - E - ML.w, xML), yMid, "mill");
  put(DR, E, yLow, "dry");
  put(SH, Math.min(W - E - SH.w, Math.max(E + DR.w + gap(), Math.floor(W / 2) + 4)), yLow, "shops");
  put(MG, Math.min(W - E - MG.w, xHF + Math.floor(HF.w / 2)), yTop, "magazine");
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The mine gate"), zone(0, Math.floor(H / 2), "west", "The dump road"), zone(W - 3, Math.floor(H / 2), "east", "The mill road"), zone(Math.floor(W / 2) - 1, 0, "north", "The hill track")];
  const inZone = (x, y) => zones.some((z) => x >= z.x0 - 2 && x <= z.x0 + z.w + 1 && y >= z.y0 - 2 && y <= z.y0 + z.h + 1);
  const free = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && C.cells[y * W + x].k === "open" && !C.keep[y * W + x] && !C.built[y * W + x] && !inZone(x, y);
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free });
  // The waste dump: piles of rock (gravelpile, fixed) in a heap west of the headframe; its own outdoor area.
  const dumpA = { id: C.areas.length, type: null, name: "Waste dump", outdoor: true, f: 0, x0: E, y0: yTop, w: dumpW, h: yLow - yTop, house: null };
  C.areas.push(dumpA);
  const cx = E + Math.floor(dumpW / 2), cy = yTop + Math.floor((yLow - yTop) / 2), rad = Math.floor(Math.min(dumpW, yLow - yTop) / 2) - 2;
  for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) if (Math.hypot(x - cx, y - cy) <= rad && (x + y) % 3 !== 0) G.block(x, y, "gravelpile");
  // The ore track: ore cars (containers: ore as stone, scrap) between the headframe and the mill, a yard of its own.
  const trackA = { id: C.areas.length, type: "mineunder", name: "Ore track", outdoor: true, f: 0, x0: xHF, y0: yMid + HF.h + 1, w: Math.max(4, W - E - xHF), h: 3, house: null };
  let carts = 0;
  const want = rng.int(M.CARTS[0], M.CARTS[1]), ty = yMid + HF.h + 2;
  for (let x = xHF + 2; x < W - E - 2 && carts < want; x += 3) {
    if (rng.chance(0.3) || !G.block(x, ty, "orecart")) continue;
    C.containers.push({ id: C.cid++, x, y: ty, f: 0, area: trackA.id, kind: "orecart", searched: false, label: `${trackA.name}: ore car` });
    carts++;
  }
  if (carts) C.areas.push(trackA);
  // A berm round the magazine's back and sides (rock piles), the haul trucks by the shops.
  const mp = placed[4];
  for (let x = mp.x0 - 2; x <= mp.x0 + mp.w + 1; x++) G.block(x, Math.max(1, mp.y0 - 2), "gravelpile");
  for (let y = mp.y0 - 2; y <= mp.y0 + mp.h; y++) { G.block(mp.x0 - 2, y, "gravelpile"); G.block(mp.x0 + mp.w + 1, y, "gravelpile"); }
  const yardA = { id: C.areas.length, type: "garage", name: "Truck yard", outdoor: true, f: 0, x0: E, y0: yLow - 6, w: W - 2 * E, h: 5, house: null };
  let trucks = 0;
  for (let i = 0, n = rng.int(M.TRUCKS[0], M.TRUCKS[1]); i < n; i++) {
    const rect = G.car(E + 4 + rng.int(0, Math.max(0, W - 2 * E - 12)), yLow - 6, "x", 5, "truck", rng.int(0, 1e6));
    if (rect) { C.containers.push({ id: C.cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: yardA.id, kind: "car", searched: false, label: `${yardA.name}: haul truck` }); trucks++; }
  }
  if (trucks) C.areas.push(yardA);
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  return compoundResult(C, { key, id, name: option.name || "Mine", zones, vehicle, kind: "mine", extra: { vid: spec.vid, vname: spec.vname, variant: spec.vname, yard: true, word: "buildings" } });
}

/**
 * The open pit's raid map (a spec with complex "pit"): the pit in the middle of the map, a bowl stepped down in
 * benches (each bench a ring of gravel floor, the face between two benches a ring of crag), the haul road cut down
 * through the faces on one side to the bottom (a pond there, the water that seeps in once the pumps stop), haul trucks
 * and a loader on the benches; round the rim the crusher and screening plant (spec, the main building), the scale house
 * by the gate, the maintenance shop, the explosives magazine off behind a berm, the gravel yard's stockpiles.
 * @param {any} state @param {number} tileId @param {any} option @param {any} withVehicle @param {any} spec @param {(rng: any, spec: any, opts: any) => any} assemble
 */
export function pitMap(state, tileId, option, withVehicle, spec, assemble) {
  const rng = new Rng(Math.floor(hash01(state.seed, "quarrypit", tileId, option.id) * 4294967296) || 1);
  const M = MINE.PIT, key = option.key || "quarry", id = option.id || key, scale = MINE.LOOT.quarry.pit;
  const part = (k, sp, name) => ({ name, m: partOf(assemble, sp, partRng(state, tileId, id, k), { key, id: `${id}#${k}`, name }, scale) });
  const main = { name: "Crusher and screening plant", m: partOf(assemble, { ...spec, complex: null }, rng, { key, id: `${id}#0`, name: "Crusher and screening plant" }, scale) };
  const B = [main, part(1, PARTS.scale(rng), "Scale house"), part(2, PARTS.qshop(rng), "Maintenance shop"), part(3, PARTS.qmag(rng), "Explosives magazine")];
  const [CR, SC, SH, MG] = B.map((b) => ({ ...b, w: b.m.building.w, h: b.m.building.h }));
  const E = M.EDGE, rad = rng.int(M.R[0], M.R[1]), bw = rng.int(M.BENCH[0], M.BENCH[1]);
  const rimTop = E + MG.h + 8; // the magazine behind the pit's north rim
  const cx = E + Math.max(rad, 40) + 4, cy = rimTop + rad;
  const yPlant = cy + rad + 6;
  const W = Math.min(M.CAP, cx + rad + 4 + Math.max(CR.w, SH.w) + E);
  const H = Math.min(M.CAP, yPlant + Math.max(CR.h, SC.h, SH.h) + 18);
  const storeys = Math.max(...B.map((b) => b.m.storeys || 1));
  const benches = Math.max(2, Math.floor(rad / bw));
  const roadX = (y) => cx + Math.round((y - cy) * 0.15); // the haul road's line: from the rim on the south side straight down to the pit floor, crossing every bench
  // The ground: the pit's rings (crag faces, gravel benches), the haul road through them, the pond at the bottom.
  const ring = (x, y) => Math.hypot(x - cx, y - cy);
  const C = compoundGrid(W, H, storeys, (x, y) => (y >= H - 4 ? "road" : ring(x, y) <= rad ? "gravel" : "dirt"));
  const W0 = W;
  const roadCell = (x, y) => y > cy && Math.abs(x - roadX(y)) <= Math.floor(M.ROAD / 2) && ring(x, y) <= rad + 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = ring(x, y);
    if (d > rad) continue;
    const c = C.cells[y * W0 + x];
    if (roadCell(x, y)) { c.f = "dirt"; continue; }
    if (d <= Math.max(5, rad - benches * bw)) { c.k = "water"; c.f = "water"; continue; } // the pond on the pit floor
    if (Math.floor(d) % bw === 0 && d > 6) { c.k = "crag"; c.f = "gravel"; } // a face between two benches
  }
  const placed = [];
  const put = (b, x0, y0, role) => { const p = placeBuilding(C, b.m, { x0, y0, face: "s", k: C.parts.length, name: b.name, key, tag: { part: { role } } }); placed.push(p); return p; };
  put(CR, Math.min(W - E - CR.w, cx + rad + 4), Math.max(E, cy - Math.floor(CR.h / 2)), "crusher");
  put(SH, Math.min(W - E - SH.w, cx + rad + 4), Math.min(H - SH.h - 10, cy + Math.floor(CR.h / 2) + 10), "shop");
  put(SC, Math.max(E, cx - Math.floor(SC.w / 2) - 20), yPlant, "scale");
  put(MG, Math.max(E, cx - Math.floor(MG.w / 2)), E, "magazine");
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The quarry gate"), zone(0, Math.floor(H / 2), "west", "The west rim"), zone(W - 3, Math.floor(H / 2), "east", "The plant road"), zone(Math.floor(W / 2) - 1, 0, "north", "The north rim")];
  const inZone = (x, y) => zones.some((z) => x >= z.x0 - 2 && x <= z.x0 + z.w + 1 && y >= z.y0 - 2 && y <= z.y0 + z.h + 1);
  const free = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && C.cells[y * W + x].k === "open" && !C.keep[y * W + x] && !C.built[y * W + x] && !inZone(x, y);
  // The pit's faces must not cut a bench off: every bench reached down the haul road (open its faces where it crosses
  // them, and a ramp cut through each face on the far side too, so no bench is a dead end).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = C.cells[y * W + x];
    if (c.k !== "crag") continue;
    if (roadCell(x, y) || (y < cy && Math.abs(x - (cx - Math.round((cy - y) * 0.15))) <= 1)) { c.k = "open"; c.f = "dirt"; } // the north ramp: a second way down every face
  }
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free });
  const pitA = { id: C.areas.length, type: "workshop", name: "The pit", outdoor: true, f: 0, x0: cx - rad, y0: cy - rad, w: 2 * rad + 1, h: 2 * rad + 1, house: null };
  C.areas.push(pitA);
  // The haul trucks and a loader on the benches (a container each: the cab's glovebox and the tool box).
  for (let i = 0, n = rng.int(M.TRUCKS[0], M.TRUCKS[1]); i < n; i++) {
    const a = rng.next() * Math.PI * 2, d = rad - bw * rng.int(1, benches - 1) + Math.floor(bw / 2);
    const rect = G.car(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), rng.chance(0.5) ? "x" : "y", 5, "truck", rng.int(0, 1e6));
    if (rect) C.containers.push({ id: C.cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: pitA.id, kind: "car", searched: false, label: `${pitA.name}: ${i ? "haul truck" : "loader"}` });
  }
  // The gravel yard: stockpiles in a row along the south rim (fixed), its own area; a berm behind the magazine.
  const yardA = { id: C.areas.length, type: null, name: "Gravel yard", outdoor: true, f: 0, x0: cx + 4, y0: yPlant, w: Math.max(4, W - E - cx - 4), h: 8, house: null };
  C.areas.push(yardA);
  for (let i = 0, n = rng.int(M.PILES[0], M.PILES[1]); i < n; i++) { const x = cx + 6 + i * 4, y = yPlant + 2 + (i % 2) * 2; G.block(x, y, "gravelpile"); G.block(x + 1, y, "gravelpile"); }
  const mp = placed[3];
  for (let x = mp.x0 - 2; x <= mp.x0 + mp.w + 1; x++) G.block(x, Math.max(1, mp.y0 + mp.h + 2), "gravelpile");
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  return compoundResult(C, { key, id, name: option.name || "Quarry", zones, vehicle, kind: "quarry", extra: { vid: spec.vid, vname: spec.vname, variant: spec.vname, yard: true, word: "buildings" } });
}

// ======================================================================================
// The mines' and the quarries' signs of survival (interiorscenes.js registerScene; their own dice there), only on a map
// laid out by these plans (when: a room carries a mine mark, so no other building rolls them):
//   caved      someone caught under a drift's cave-in: the body at the fall's foot, blood on the rock, a lamp still lit;
//   refuge     survivors who sealed themselves in the refuge chamber below: cots, the ones who never came out (alive
//              sometimes: area.scene.alive);
//   magazine   someone who held out in an explosives magazine behind its steel door: a cot, a crate dragged to the door.
// ======================================================================================
const mined = (ctx) => ctx.rooms.some((r) => typeof r.mine === "string");
const mineRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.mine) && !r.scene && !r.locked));
const lower = (r) => String(r.name || "room").replace(/ \d+$/, "").replace(/, .*$/, "").toLowerCase();
function caved(ctx) {
  const { rng } = ctx;
  for (const r of mineRooms(ctx, ["drift"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    const falls = [];
    for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) { const c = ctx.at(f, x, y); if (c && c.k === "cavein") falls.push([x, y]); }
    if (!falls.length || !free.length) continue;
    const [fx, fy] = falls[0];
    const spot = free.slice().sort((p, q) => Math.abs(p[0] - fx) + Math.abs(p[1] - fy) - (Math.abs(q[0] - fx) + Math.abs(q[1] - fy)))[0];
    ctx.body(f, spot[0], spot[1], { human: true, quiet: true });
    ctx.splatter(f, spot[0], spot[1], "human", 1);
    return ctx.done("caved", r, spot[0], spot[1], `The ${lower(r)} caved in on someone: the body lies at the foot of the fall, half under the rock.`);
  }
  return null;
}
/** Someone held out in a room of these marks: cots, the ones who never came out. */
const holdOut = (kind, marks, where) => (ctx) => {
  const { rng } = ctx;
  for (const r of mineRooms(ctx, marks)) {
    const f = r.f || 0, free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0);
    if (free.length < 2) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(1, 2));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    const n = Math.min(left.length, rng.int(0, 2));
    for (const [x, y] of rng.shuffle(left).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: true });
    const [cx, cy] = cots[0];
    return ctx.done(kind, r, cx, cy, `Someone ${where(lower(r))}: cots on the floor${n ? `, and ${n === 1 ? "one who never came out" : `${n} who never came out`}` : ""}.`);
  }
  return null;
};
registerScene("caved", { w: 3, place: caved, kinds: ["mine"], when: mined });
registerScene("refuge", { w: 2, place: holdOut("refuge", ["refuge"], (n) => `sealed themselves in the ${n} down here`), kinds: ["mine"], when: mined });
registerScene("maghold", { w: 1.5, place: holdOut("maghold", ["magazine"], (n) => `held out in the ${n} behind its steel door`), kinds: ["mine", "quarry"], when: mined });
export const MINE_SCENES = ["caved", "refuge", "maghold"];
