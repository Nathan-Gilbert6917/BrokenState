// @ts-check
// Data centres (the user's request 2026-10-26, issue #51 of the round-2 epic #39: "Add data center max size 400x400").
// A new building type, `datacenter` (buildingmaps.js BUILDINGS), a point of interest of its own (data.js LOCATIONS,
// placed by the placement table: data-placement.js PLACEMENT_ROWS, placement.js PLACE_EXTRA), with thirteen named plans
// registered with the shared variant picker (variantpick.js "datacenter", #41) and picked by the tile's class, its
// setting and the size class the placement table gives the kind there (placement.js placementCtx / sizeFor, #42).
//
// The plans (DC_PLANS; sizes in metres, a cell a metre: data-buildingsize.js REAL_SIZE datacenter, a sizes row a plan):
//   colo        City colocation hall: 3–5 storeys downtown; a security lobby and mantrap, the NOC, a data hall a floor,
//               UPS and battery rooms, the generator hall and the dock at the back, customer offices and the meet-me
//               room upstairs.
//   hyperscale  Hyperscale campus (a compound, compound.js): 3–4 single-storey halls of three data halls each, an
//               operations building, the generator yard in front of each hall (diesel sets and their day tanks), a
//               substation of transformers, cooling towers, a fuel farm, the car park, a perimeter fence and its gate.
//   edge        Edge data centre in a converted warehouse: one storey; a hall, UPS and batteries, the dock, a generator.
//   telecom     Telephone exchange: 2–4 storeys of switch rooms over the cable vault, the battery room, the test desk.
//   bankdr      A bank's disaster-recovery site: the recovery data hall, the tape vault, the recovery trading floor and
//               crisis room upstairs.
//   govdc       Government data centre (a compound): one or two two-storey secure halls behind a double fence and a
//               gatehouse, the guard room, the classified and records halls, the media destruction room.
//   research    University research cluster: the machine room, research computing offices, the visualisation and hardware
//               labs upstairs.
//   bunker      Underground data bunker (bunkerlayout.js's way: spec.below, the hillside's rock round a portal, its
//               levels named down): portal security and the vehicle tunnel on the surface, vault halls, the NOC and the
//               generator gallery off the main tunnel below.
//   crypto      Crypto mine in sheds: one long shed of mining rigs in two bays, the switchgear, a generator.
//   container   Modular container site: IT containers in rows with aisles between, the power and cooling containers.
//   playout     A broadcaster's playout centre: master control, the apparatus room, the satellite uplink room, the tape
//               library and the playout suite upstairs.
//   cloudregion Cloud region (a compound): three availability-zone halls of two storeys, an operations building, the
//               substation and cooling towers.
//   enterprise  Corporate data centre: the server room, the IT department, the help desk floor and the NOC upstairs.
// The rooms only data centres have (DC_ROLES, merged into buildingmaps.js ROLES): the security lobby, the mantrap, the
// data hall (a raised floor: ui/isoview.js "raised"), the UPS room, the battery room, the generator hall, the chiller
// plant, the network operations centre, the meet-me room, the loading dock and the staging room. Furnished for their
// kind by DC_STYLES (the plan leaf's dc mark, roomlayout.js's helpers): racks in rows, fronts facing across the cold
// aisle and backs across the hot one, CRAC units on the end walls; UPS cabinets and battery strings; the diesel sets
// with their tanks; the NOC's monitor wall and its desks; cable trays and cable drums. The loot is the kind's:
// electronics, parts, batteries, fuel, cable (scrap off the drums) and tools; very little food (a break room's).
//
// Base use (issue #19, #20's base power, recorded in docs/features/combat.md "Data centres"): a hall's diesel sets
// (dcgen) are 2 MW on skids, fixed; an edge site's or a NOC's standby set (standbyset) lifts as the Home standby
// generator item (data-power.js genset_standby: data-furniture.js FURNITURE_ITEM_KEY) and is set at a base like any
// found generator. A UPS cabinet or a battery string lifts as furniture only: the base's battery bank is built from car
// batteries (data-power.js battery_bank) and has no found form, so its batteries are its loot (Pack of batteries,
// electronics).
//
// Maps: battlesize.js MAP_CAP.datacenter 400 × 400. A compound plan's map is its campus (dcCampusMap), cut to fit.
// Older saves: a new type and a new POI kind (a new world's placement table only places it), so nothing an older save
// holds changes.
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { registerScene, rollScenes, sceneRng } from "./interiorscenes.js";
import { sizeOf } from "./data-buildingsize.js";
import { sizeFor } from "./placement.js";
import { COMMERCIAL_STYLES } from "./shoplayout.js";
import { assemble } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)
import { compoundGrid, placeBuilding, guard, parkingLot, compoundResult, compoundVehicle } from "./compound.js";

export const DC = {
  CAP: 400,          // the map's side at most (battlesize.js MAP_CAP.datacenter: the user's "max size 400x400")
  EDGE: 8,           // the ground between the map's edges and the fence
  ROAD: 5,           // the road along the south edge (the way in)
  GAP: [10, 16],     // the ground between two halls of a row
  YARD: 12,          // the generator yard in front of a row of halls
  LANE: 4,           // the service road under each row and the one down the west side
  DEAD: { hyperscale: 4, cloudregion: 4.5, govdc: 3 }, // a campus's dead: the site's roster × this (map.deadScale)
  // The containers a plan's rooms hold: each room's share (buildingmaps.js furnishCtx target) × this (spec.boxScale).
  LOOT: { colo: 1, hyperscale: 0.9, edge: 1.1, telecom: 1, bankdr: 1, govdc: 1, research: 1.1, bunker: 1, crypto: 1.2, container: 1.2, playout: 1, cloudregion: 0.9, enterprise: 1, dcadmin: 1, dcgate: 1 },
};

// ---------- the rooms only data centres have (merged into buildingmaps.js ROLES) ----------
const role = (name, type, furnish, extra = {}) => ({ name, type, furnish, ...extra });
export const DC_ROLES = {
  dclobby:  role("Security lobby", "office", "none", { hub: true, fl: "tile", maxBoxes: 1 }),
  mantrap:  role("Mantrap", null, "none", { fl: "tile", windows: false }),
  datahall: role("Data hall", "control", "none", { fl: "raised", windows: false, maxBoxes: 10 }),
  upsroom:  role("UPS room", "control", "none", { fl: "conc", windows: false, maxBoxes: 4 }),
  battroom: role("Battery room", "control", "none", { fl: "conc", windows: false, maxBoxes: 4 }),
  genhall:  role("Generator hall", "garage", "none", { fl: "conc", maxBoxes: 3 }), // a garage's table (fuel, parts, tools): a motor pool's is the Army's
  chillers: role("Chiller plant", "workshop", "none", { fl: "conc", maxBoxes: 2 }),
  noc:      role("Network operations centre", "control", "none", { fl: "carpet", maxBoxes: 3 }),
  meetme:   role("Meet-me room", "control", "none", { fl: "raised", windows: false, maxBoxes: 3 }),
  dcdock:   role("Loading dock", "workshop", "none", { hub: true, fl: "conc", maxBoxes: 3 }),
  staging:  role("Staging room", "workshop", "none", { fl: "conc", maxBoxes: 4 }),
};

// ---------- the plans ----------
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
/** A room: its role, its style's mark (DC_STYLES; null: the role's own furnishing) and the rest. */
const R = (role, dc, o = {}) => ({ role, ...(dc ? { dc } : {}), ...o });
const ROCK = { role: "rock" };
const roll = (rng, r) => rng.int(r[0], r[1]);
/** A plan's footprint and storeys from its REAL_SIZE row (data-buildingsize.js datacenter sizes). */
function size(rng, id) {
  const S = /** @type {any} */ (sizeOf("datacenter", id));
  return { bw: roll(rng, S.w), bh: roll(rng, S.d), storeys: roll(rng, S.storeys) };
}
// The footprint's class (tools/storeytest.js FOOT) by its area.
const footOf = (bw, bh) => { const a = bw * bh; return a >= 1800 && bw >= 50 ? "huge" : a >= 700 && bw >= 30 ? "xl" : bw >= 20 && a >= 280 ? "wide" : a > 360 ? "large" : a > 190 ? "medium" : "small"; };
const roller = (side, roles, o = {}) => ({ side, roles, chance: 1, roller: true, width: 3, lock: 0.3, ...o });
const door = (side, roles, chance = 0.7, lock = 0.4) => ({ side, roles, chance, lock });

const LOBBY = (name = "Security lobby") => R("dclobby", "lobby", { name, entry: true, hub: true });
const MANTRAP = () => R("mantrap", null, { name: "Mantrap", dk: "steel" });
const HALL = (name) => R("datahall", "datahall", { name });
const UPS = (name = "UPS room") => R("upsroom", "ups", { name, lock: ["door", 0.3] });
const BATT = (name = "Battery room") => R("battroom", "batteries", { name, lock: ["door", 0.3] });
const GEN = (name = "Generator hall") => R("genhall", "genhall", { name });
const CHILL = (name = "Chiller plant") => R("chillers", "chillers", { name });
const NOC = (name = "Network operations centre") => R("noc", "noc", { name });
const MMR = (name = "Meet-me room") => R("meetme", "meetme", { name, lock: ["door", 0.4] });
const DOCK = (name = "Loading dock") => R("dcdock", "dock", { name });
const STAGE = (name = "Staging room") => R("staging", "staging", { name });
const OFF = (name, o = {}) => R("office", "office", { name, ...o });
const BREAK = () => R("breakroom", null, { name: "Break room", type: "office" }); // the staff's coffee and water, a lunch in the fridge: next to no food
const CORR = (name = "Corridor") => R("corridor", null, { name });
const REST = () => R("restroom", null);

/** @typedef {(rng: any, o: any) => any} Maker */
/** @type {Record<string, Maker>} */
export const DC_MAKERS = {
  colo(rng) {
    const s = size(rng, "colo");
    return {
      ...s, front: { width: 2 }, ground: "city", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 2 },
      program: Y([8, X([10, LOBBY()], [4, MANTRAP()], ["*", NOC()], [8, OFF("Security office")])], [3, CORR("Spine corridor")],
        ["*", X(["*", HALL("Data hall 1")], [9, Y([8, UPS()], ["*", BATT()])])], [7, X(["*", DOCK()], [14, GEN()])]),
      upper: (f) => Y([8, X(["*", OFF("Customer offices")], [9, MMR()], [8, BREAK()])], [3, CORR("Spine corridor")],
        ["*", X(["*", HALL(`Data hall ${f + 1}`)], [9, UPS()], [8, STAGE("Customer cages")])]),
      exits: [roller("back", ["dcdock"], { name: "Dock door" }), door("back", ["genhall"], 1, 0.5)],
    };
  },
  hyperscale(rng) { // one hall of the campus (dcCampusMap); raided alone, the same hall
    const s = size(rng, "hyperscale");
    return {
      ...s, storeys: 1, front: { width: 2 }, ground: "lot", foot: footOf(s.bw, s.bh),
      program: Y([7, X([9, LOBBY()], [4, MANTRAP()], [12, NOC("Hall control room")], ["*", OFF("Hall offices")], [10, STAGE()])], [3, CORR("Main corridor")],
        ["*", X(["*", HALL("Data hall A")], ["*", HALL("Data hall B")], ["*", HALL("Data hall C")])], [3, CORR("Service corridor")],
        [8, X(["*", UPS()], ["*", BATT()], [12, CHILL("Electrical room")], [10, DOCK()])]),
      exits: [roller("back", ["dcdock"], { name: "Dock door" }), door("back", ["upsroom"], 1, 0.5), door("left", ["datahall"], 0.8, 0.6), door("right", ["datahall"], 0.8, 0.6)],
    };
  },
  edge(rng) {
    const s = size(rng, "edge");
    return {
      ...s, storeys: 1, front: { width: 1 }, ground: "town", foot: footOf(s.bw, s.bh),
      program: Y([6, X([8, LOBBY("Front office")], [3, MANTRAP()], ["*", OFF("Site office")], [6, BREAK()])],
        ["*", X(["*", HALL("Edge hall")], [8, Y(["*", UPS()], ["*", BATT()])])], [6, X(["*", DOCK("Old loading bay")], [10, GEN("Generator room")])]),
      exits: [roller("back", ["dcdock"], { name: "Roller door" }), door("right", ["genhall"], 1, 0.5)],
    };
  },
  telecom(rng) {
    const s = size(rng, "telecom");
    return {
      ...s, front: { width: 1 }, ground: "town", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 1 },
      program: Y([6, X([8, LOBBY("Front office")], ["*", BATT()], [8, GEN("Engine room")])], [3, CORR("Stair hall")],
        ["*", X(["*", R("datahall", "switch", { name: "Switch room", fl: "lino" })], [9, MMR("Cable vault")])]),
      upper: (f) => Y([6, X(["*", NOC("Test desk")], [8, OFF("Engineers' office")])], [3, CORR("Stair hall")],
        ["*", X(["*", R("datahall", "switch", { name: `Switch floor ${f + 1}`, fl: "lino" })], [8, STAGE("Spares store")])]),
      exits: [door("back", ["genhall"], 1, 0.5)],
    };
  },
  bankdr(rng) {
    const s = size(rng, "bankdr");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 1 },
      program: Y([7, X([9, LOBBY()], [4, MANTRAP()], ["*", OFF("Reception offices")], [8, R("office", "vault", { name: "Tape vault", lock: ["vault", 0.6] })])], [3, CORR()],
        ["*", X(["*", HALL("Recovery data hall")], [9, Y(["*", UPS()], ["*", BATT()])])], [7, X([12, GEN()], ["*", DOCK()])]),
      upper: () => Y([7, X(["*", NOC("Recovery trading floor")], [8, BREAK()])], [3, CORR()],
        ["*", X(["*", R("office", "workarea", { name: "Recovery work area" })], [10, NOC("Crisis room")], [6, REST()])]),
      exits: [roller("back", ["dcdock"], { name: "Dock door" }), door("back", ["genhall"], 1, 0.5)],
    };
  },
  govdc(rng) { // the secure hall of the government campus (dcCampusMap)
    const s = size(rng, "govdc");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 2 },
      program: Y([7, X([9, LOBBY()], [4, MANTRAP()], [10, R("office", "guardroom", { name: "Guard room" })], ["*", NOC()])], [3, CORR("Secure corridor")],
        ["*", X(["*", HALL("Classified data hall")], [10, Y(["*", UPS()], ["*", BATT()])])], [8, X([14, GEN()], ["*", DOCK()], [10, CHILL()])]),
      upper: () => Y([7, X(["*", OFF("Agency offices")], [9, MMR()], [8, BREAK()])], [3, CORR("Secure corridor")],
        ["*", X(["*", HALL("Records data hall")], [10, STAGE("Media destruction room")])]),
      exits: [roller("back", ["dcdock"], { name: "Dock door", lock: 0.6 }), door("back", ["genhall"], 1, 0.7)],
    };
  },
  research(rng) {
    const s = size(rng, "research");
    return {
      ...s, front: { width: 1 }, ground: "town", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 1 },
      program: Y([6, X([8, LOBBY("Front desk")], ["*", OFF("Research computing offices")], [8, BREAK()])], [3, CORR()],
        ["*", X(["*", HALL("Machine room")], [9, Y(["*", UPS()], ["*", CHILL()])])]),
      upper: () => Y([6, X(["*", R("lab", "viz", { name: "Visualisation lab" })], [9, OFF("Grad students' office")])], [3, CORR()],
        ["*", X(["*", R("lab", "hwlab", { name: "Hardware lab" })], [10, STAGE("Parts store")], [6, REST()])]),
      exits: [door("back", ["chillers"], 1, 0.4), door("left", ["datahall"], 0.6, 0.7)],
    };
  },
  bunker(rng) {
    const s = size(rng, "bunker"), iw = s.bw - 2;
    const lr = Math.floor((iw - 12 - 10 - 2) / 2);
    const entrance = X([lr, ROCK], [12, Y([7, LOBBY("Portal security")], [4, MANTRAP()], ["*", ROCK])], [10, Y([7, DOCK("Vehicle tunnel")], ["*", ROCK])], ["*", ROCK]);
    const tunnel = [12, R("corridor", null, { name: "Main tunnel", hub: true })];
    const levels = [
      X([lr, Y(["*", HALL("Vault hall 1")], [8, X(["*", UPS()], ["*", BATT()])])], tunnel, ["*", Y([8, NOC()], ["*", GEN("Generator gallery")], [6, CHILL()])]),
      X([lr, Y(["*", HALL("Vault hall 2")], [7, MMR()])], tunnel, ["*", Y([8, R("staging", "tapes", { name: "Tape store", type: "office" })], ["*", HALL("Vault hall 3")], [5, BREAK()])]),
    ];
    return {
      ...s, front: { width: 2 }, ground: "rock", foot: footOf(s.bw, s.bh), below: true, windows: false, extraDoors: 0.05, rockFill: true, fence: true, vent: true,
      stairs: { roles: ["dclobby"], n: 1, len: 2 }, margins: { front: 8 },
      program: entrance, upper: (f) => levels[f - 1] || levels[levels.length - 1],
      exits: [{ side: "front", roles: ["dcdock"], chance: 1, roller: true, width: 3, lock: 0.3, name: "Tunnel door" }],
    };
  },
  crypto(rng) {
    const s = size(rng, "crypto");
    const shed = (n) => R("datahall", "mining", { name: `Mining shed ${n}`, fl: "conc", windows: true });
    return {
      ...s, storeys: 1, front: { width: 1 }, ground: "farm", foot: footOf(s.bw, s.bh),
      program: X([8, Y([6, OFF("Site office", { entry: true, hub: true })], ["*", STAGE("Repair bench")])], ["*", shed("A")], ["*", shed("B")],
        [7, Y(["*", R("upsroom", "switchgear", { name: "Switchgear", windows: true })], [6, GEN("Generator shed")])]),
      exits: [door("back", ["datahall"], 1, 0.4), door("right", ["genhall"], 1, 0.4)],
    };
  },
  container(rng) {
    const s = size(rng, "container");
    const box = (n) => ["*", R("datahall", "container", { name: `IT container ${n}`, dk: "steel" })];
    const aisle = [2, R("corridor", null, { name: "Container aisle", hub: true, fl: "conc" })];
    return {
      ...s, storeys: 1, front: { width: 1 }, ground: "lot", foot: footOf(s.bw, s.bh),
      program: Y([5, X([8, OFF("Site cabin", { entry: true, hub: true })], ["*", STAGE("Delivery bay")])], aisle, [3, X(box(1), box(2))], aisle, [3, X(box(3), box(4))], aisle,
        ["*", X(["*", UPS("Power container")], ["*", CHILL("Cooling container")], [8, GEN("Generator container")])]),
      exits: [roller("back", ["genhall", "chillers"], { name: "Yard gate", width: 2 }), door("left", ["corridor"], 0.8, 0.3)],
    };
  },
  playout(rng) {
    const s = size(rng, "playout");
    return {
      ...s, front: { width: 2 }, ground: "city", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 1 },
      program: Y([7, X([9, LOBBY()], [4, MANTRAP()], ["*", NOC("Master control")])], [3, CORR()],
        ["*", X(["*", HALL("Apparatus room")], [10, MMR("Satellite uplink room")])], [7, X(["*", UPS()], [12, GEN()])]),
      upper: () => Y([7, X(["*", NOC("Playout suite")], [10, OFF("Scheduling office")])], [3, CORR()],
        ["*", X(["*", R("storage", "tapes", { name: "Tape library", type: "office" })], [9, BREAK()], [6, REST()])]),
      exits: [door("back", ["genhall"], 1, 0.5), door("back", ["upsroom"], 0.6, 0.6)],
    };
  },
  cloudregion(rng) { // an availability zone's hall (dcCampusMap)
    const s = size(rng, "cloudregion");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 2 },
      program: Y([7, X([9, LOBBY()], [4, MANTRAP()], ["*", NOC("Zone operations room")], [10, STAGE()])], [3, CORR("Main corridor")],
        ["*", X(["*", HALL("Data hall 1")], ["*", HALL("Data hall 2")], [10, Y(["*", UPS()], ["*", BATT()])])], [7, X(["*", DOCK()], [14, CHILL()])]),
      upper: () => Y([7, X(["*", OFF("Engineering offices")], [9, BREAK()], [9, MMR()])], [3, CORR("Main corridor")],
        ["*", X(["*", HALL("Data hall 3")], ["*", HALL("Data hall 4")], [10, UPS()])]),
      exits: [roller("back", ["dcdock"], { name: "Dock door" }), door("back", ["chillers"], 1, 0.5)],
    };
  },
  enterprise(rng) {
    const s = size(rng, "enterprise");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 1 },
      program: Y([7, X([9, LOBBY("Reception")], [4, MANTRAP()], ["*", OFF("IT department")], [8, BREAK()])], [3, CORR()],
        ["*", X(["*", HALL("Server room")], [9, Y(["*", UPS()], ["*", CHILL()])])], [7, X(["*", DOCK()], [12, GEN()])]),
      upper: () => Y([7, X(["*", NOC()], [9, MMR()])], [3, CORR()],
        ["*", X(["*", R("office", "workarea", { name: "Help desk floor" })], [10, STAGE("Hardware store")])]),
      exits: [roller("back", ["dcdock"], { name: "Dock door" }), door("back", ["genhall"], 1, 0.5)],
    };
  },
  // A campus's own buildings (dcCampusMap): the operations building and the gatehouse.
  dcadmin(rng) {
    const s = size(rng, "dcadmin");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s.bw, s.bh), stairs: { roles: ["corridor"], n: 1 },
      program: Y([6, X([9, LOBBY("Visitor lobby")], [4, MANTRAP()], ["*", NOC("Campus operations centre")])], [3, CORR()],
        ["*", X(["*", OFF("Site offices")], [9, BREAK()], [10, STAGE()])]),
      upper: () => Y([6, X(["*", OFF("Engineering offices")], [9, OFF("Training room", { dc: "training" })])], [3, CORR()],
        ["*", X(["*", STAGE("Spares store")], [8, REST()])]),
      exits: [door("back", ["staging"], 1, 0.4)],
    };
  },
  dcgate(rng) {
    const s = size(rng, "dcgate");
    return { ...s, storeys: 1, front: { width: 1 }, ground: "lot", foot: footOf(s.bw, s.bh), program: R("office", "guardroom", { name: "Gatehouse", entry: true, hub: true }), exits: [door("back", ["office"], 1, 0.2)] };
  },
};

// The campuses: the halls a plan's map holds, their names, the rest of the site.
//   halls [min, max], perRow: at most this many a row, gap: [min, max] between two, hall: the maker of each, admin / gate: an operations building / a gatehouse, fence: rings of
//   fence round the site (2: the government's double fence), yards: the outdoor plant (substation, cooling towers,
//   fuel farm), gens: the generator yard in front of each row of halls.
export const DC_CAMPUS = {
  hyperscale: { halls: [5, 9], perRow: 3, hall: "hyperscale", name: (i) => `Data hall building ${i + 1}`, admin: true, gate: false, fence: 1, yards: ["substation", "cooling", "fuel"], gens: true, lots: 2 },
  cloudregion: { halls: [3, 3], perRow: 3, gap: [30, 40], hall: "cloudregion", name: (i) => `Availability zone ${String.fromCharCode(65 + i)}`, admin: true, gate: false, fence: 1, yards: ["substation", "cooling"], gens: true, lots: 1 },
  govdc: { halls: [1, 2], hall: "govdc", name: (i) => (i ? "Secure hall II" : "Secure hall"), admin: false, gate: true, fence: 2, yards: ["substation", "fuel"], gens: false, lots: 1 },
};

// The variants (the picker's entries): id, name, weights by setting (w.any for a building with none given), the tile
// classes it stands on, its usual footprint (foot: its size class by placement.js sizeClassOf: a town's medium sites, a
// city's and a highway's large ones) and the maker.
/** @type {{ id: string, name: string, w: Record<string, number>, tile: string[], foot: number[], campus?: any, make: Maker }[]} */
export const DC_PLANS = [
  { id: "colo", name: "City colocation hall", w: { centre: 4, city: 3, suburb: 0.5, any: 1 }, tile: ["centre", "city", "suburb"], foot: [50, 34, 4], make: DC_MAKERS.colo },
  { id: "hyperscale", name: "Hyperscale campus", w: { highway: 3, suburb: 1.2, any: 1 }, tile: ["highway", "suburb"], foot: [80, 46, 1], campus: DC_CAMPUS.hyperscale, make: DC_MAKERS.hyperscale },
  { id: "edge", name: "Edge data centre", w: { town: 3, suburb: 1.5, city: 0.5, highway: 0.5, any: 1 }, tile: ["town", "suburb", "city", "highway"], foot: [35, 25, 1], make: DC_MAKERS.edge },
  { id: "telecom", name: "Telephone exchange", w: { centre: 1.5, city: 1.5, town: 2, suburb: 1, any: 1 }, tile: ["centre", "city", "town", "suburb"], foot: [28, 20, 3], make: DC_MAKERS.telecom },
  { id: "bankdr", name: "Bank disaster-recovery site", w: { suburb: 2, highway: 1, city: 0.5, any: 1 }, tile: ["suburb", "highway", "city"], foot: [43, 31, 2], make: DC_MAKERS.bankdr },
  { id: "govdc", name: "Government data centre", w: { suburb: 1, highway: 1.5, city: 0.3, any: 1 }, tile: ["suburb", "highway", "city"], foot: [57, 38, 2], campus: DC_CAMPUS.govdc, make: DC_MAKERS.govdc },
  { id: "research", name: "University research cluster", w: { centre: 0.5, city: 1, suburb: 1, town: 0.5, any: 1 }, tile: ["centre", "city", "suburb", "town"], foot: [39, 27, 2], make: DC_MAKERS.research },
  { id: "bunker", name: "Underground data bunker", w: { highway: 1, suburb: 0.3, any: 1 }, tile: ["highway", "suburb"], foot: [54, 31, 2], make: DC_MAKERS.bunker },
  { id: "crypto", name: "Crypto mine in sheds", w: { town: 1.5, highway: 1.5, any: 1 }, tile: ["town", "highway"], foot: [41, 18, 1], make: DC_MAKERS.crypto },
  { id: "container", name: "Modular container site", w: { town: 1.5, highway: 1, suburb: 0.8, any: 1 }, tile: ["town", "highway", "suburb"], foot: [34, 27, 1], make: DC_MAKERS.container },
  { id: "playout", name: "Broadcast playout centre", w: { centre: 1, city: 1.5, suburb: 1, any: 1 }, tile: ["centre", "city", "suburb"], foot: [40, 29, 2], make: DC_MAKERS.playout },
  { id: "cloudregion", name: "Cloud region", w: { highway: 2, suburb: 1, any: 1 }, tile: ["highway", "suburb"], foot: [70, 41, 2], campus: DC_CAMPUS.cloudregion, make: DC_MAKERS.cloudregion },
  { id: "enterprise", name: "Corporate data centre", w: { suburb: 2, city: 1, centre: 0.8, any: 1 }, tile: ["suburb", "city", "centre"], foot: [43, 29, 2], make: DC_MAKERS.enterprise },
];
registerVariants("datacenter", DC_PLANS, { index: true }); // a number pins by index (buildingmaps.js buildingHint's plan 0: the colocation hall)

/**
 * The picker's ctx for a building's options (buildingmaps.js makeSpec's o: siteWhere's where and tileClass, a pinned
 * plan): the setting, the tile class and the size class the placement table gives the kind there.
 * @param {any} o
 */
export function dcCtx(o = {}) {
  const tc = (o && o.tileClass) || null;
  return { plan: o && o.plan != null ? o.plan : null, setting: (o && o.where && o.where.setting) || null, tileClass: tc, size: tc ? sizeFor("datacenter", tc) : null };
}
/** The plan a data centre takes (hash dice of its building's dice, never consumed). @param {any} rng @param {any} o */
export const dcVariant = (rng, o) => /** @type {any} */ (pickVariant("datacenter", rng, dcCtx(o)));

/**
 * The spec of a data centre (buildingmaps.js BUILDINGS.datacenter make): its plan's, stamped with vid / vname; a
 * campus's its first hall (the hint, the tests; the map is dcCampusMap's).
 * @param {any} rng @param {any} o
 */
export function dcPlan(rng, o = {}) {
  const P = dcVariant(rng, o);
  const spec = P.make(rng, o || {});
  return { ...spec, vid: P.id, vname: P.name, boxScale: DC.LOOT[P.id] || 1 };
}
/** A campus building's spec by its maker's name. @param {string} id @param {any} rng */
const partSpec = (id, rng) => ({ ...DC_MAKERS[id](rng, {}), boxScale: DC.LOOT[id] || 1 });

// ======================================================================================
// The campus map (a compound: compound.js, #30's shared multi-building code)
// ======================================================================================
const seedOf = (state, ...keys) => Math.floor(hash01(state.seed, ...keys) * 4294967296) || 1;

/**
 * The map of a data-centre campus (buildingmaps.js buildingMap, for a plan with a campus: hyperscale, cloud region,
 * government): the halls in rows (wrapped to fit DC.CAP), the generator yard in front of each row, the service roads,
 * a row of the operations building and the outdoor plant (substation, cooling towers, fuel farm), the car parks, the
 * fence (two rings for the government's) with its gate and gatehouse, the road along the south edge. The same every
 * visit (its dice from the world seed, the tile and the option id).
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, name: string }} option @param {any} withVehicle @param {any} P the plan (DC_PLANS)
 */
export function dcCampusMap(state, tileId, option, withVehicle, P) {
  const D = P.campus, rng = new Rng(seedOf(state, "dcmap", tileId, option.id));
  const MAXW = DC.CAP - 2 * DC.EDGE - DC.LANE - 4;
  // ---------- the buildings, each its own plan and map, its signs of survival on it ----------
  const list = [];
  const nh = rng.int(D.halls[0], D.halls[1]);
  for (let i = 0; i < nh; i++) list.push({ id: D.hall, name: D.name(i), hall: true });
  if (D.admin) list.push({ id: "dcadmin", name: "Operations building" });
  if (D.gate) list.push({ id: "dcgate", name: "Gatehouse" });
  const built = list.map((b, k) => {
    const id = `${option.id}#${k + 1}`, hr = new Rng(seedOf(state, "dcbldg", tileId, id));
    const spec = partSpec(b.id, hr);
    spec.margins = { front: 1, back: 1, left: 1, right: 1 };
    spec.ground = "none";
    const m = assemble(hr, spec, { key: "datacenter", id, name: b.name });
    rollScenes(m, sceneRng(state, tileId, { id }), "datacenter");
    return { ...b, k, m, w: m.building.w, h: m.building.h, x0: 0, y0: 0, part: /** @type {any} */ (null) };
  });
  const halls = built.filter((B) => B.hall), admin = built.find((B) => B.id === "dcadmin"), gate = built.find((B) => B.id === "dcgate");
  // ---------- the layout: rows of halls, the plant row, the car parks, the road ----------
  const GP = D.gap || DC.GAP, gap = rng.int(GP[0], GP[1]); // a cloud region's zones stand well apart
  /** @type {any[][]} */
  const rows = [[]];
  let rw = 0;
  for (const B of halls) { if (rows[rows.length - 1].length && (rw + gap + B.w > MAXW || rows[rows.length - 1].length >= (D.perRow || 9))) { rows.push([]); rw = 0; } rw += (rw ? gap : 0) + B.w; rows[rows.length - 1].push(B); }
  const x0 = DC.EDGE + DC.LANE + 4; // west of it the service road down the side
  const fence0 = 3; // the outer fence's inset from the map's edge
  let y = DC.EDGE;
  const rowsAt = [];
  for (const row of rows) {
    const D0 = Math.max(...row.map((B) => B.h));
    let x = x0;
    for (const B of row) { B.x0 = x; B.y0 = y + D0 - B.h; x += B.w + gap; }
    const yard = D.gens ? DC.YARD : 4;
    rowsAt.push({ row, y0: y, D: D0, yard: y + D0 + 1, lane: y + D0 + 1 + yard });
    y += D0 + 1 + yard + DC.LANE + 3;
  }
  // The plant row: the operations building, then the yards side by side.
  const YS = { substation: [26, 16], cooling: [30, 14], fuel: [22, 14] };
  const plantY = y, yards = [];
  let px = x0, plantD = 16;
  if (admin) { admin.x0 = px; admin.y0 = plantY; px += admin.w + gap; plantD = Math.max(plantD, admin.h); }
  for (const k of D.yards) { const [w, h] = YS[k]; yards.push({ kind: k, x0: px, y0: plantY, w, h }); px += w + 6; }
  y = plantY + plantD + 4 + 3 * D.fence; // the gravel lane under the plant, then the fence's rings (3 cells apart)
  const lotY = y, lotH = 22;
  const sx = DC.EDGE + 1; // the service road down the west side, from the road to the top row
  const gateX0 = sx - 1, gateX1 = sx + DC.LANE; // the gate over it
  if (gate) { gate.x0 = gateX1 + 2; gate.y0 = lotY + 1; } // the gatehouse outside the gate, by the road in
  y += lotH + 2;
  const roadY = y + 2;
  const widest = Math.max(px, ...rowsAt.map((r) => r.row.reduce((a, B) => Math.max(a, B.x0 + B.w), 0)), x0 + 60);
  const W = Math.min(DC.CAP, widest + DC.EDGE + 2), H = Math.min(DC.CAP, roadY + DC.ROAD + 2);
  const storeys = Math.max(...built.map((B) => B.m.storeys || 1));
  const C = compoundGrid(W, H, storeys, () => "grass");
  const cells = C.cells, keep = C.keep, I = (xx, yy) => yy * W + xx;
  const inside = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H;
  const paint = (xx0, yy0, w, h, f, mark = true) => { for (let yy = yy0; yy < yy0 + h; yy++) for (let xx = xx0; xx < xx0 + w; xx++) if (inside(xx, yy)) { cells[I(xx, yy)].f = f; if (mark) keep[I(xx, yy)] = 1; } };
  // ---------- the roads ----------
  paint(0, roadY, W, DC.ROAD, "road");
  paint(0, roadY - 1, W, 1, "gravel"); paint(0, roadY + DC.ROAD, W, 1, "gravel");
  paint(sx, DC.EDGE - 2, DC.LANE, roadY - DC.EDGE + 2, "road");
  for (const R0 of rowsAt) paint(sx, R0.lane, Math.min(W - sx - 2, widest - sx + 2), DC.LANE, "road");
  paint(sx, plantY + plantD + 1, Math.min(W - sx - 2, widest - sx + 2), 2, "gravel");
  // ---------- the buildings copied in ----------
  const sceneList = [], sceneBodies = [], scenePiles = [], scenePieces = [];
  for (const B of built) placeOne(B);
  function placeOne(B) {
    const m = B.m, Rb = m.building;
    const part = placeBuilding(C, m, { x0: B.x0, y0: B.y0, face: "s", k: B.k, name: B.name, key: "datacenter" });
    B.part = part;
    const S = m.scenes;
    if (S) {
      const tx = (xx) => B.x0 + (xx - Rb.x0), ty = (yy) => B.y0 + (yy - Rb.y0);
      const ids = new Map(m.rooms.filter((a) => !a.outdoor).map((a, j) => [a.id, part.rooms[j]]));
      for (const sc of S.list) sceneList.push({ ...sc, x: tx(sc.x), y: ty(sc.y), room: sc.room == null ? null : ids.get(sc.room) ?? null, house: B.k });
      for (const o of S.bodies) sceneBodies.push({ ...o, x: tx(o.x), y: ty(o.y) });
      for (const q of S.piles) scenePiles.push({ ...q, x: tx(q.x), y: ty(q.y), area: q.area == null ? null : ids.get(q.area) ?? null });
      for (const q of S.pieces) scenePieces.push({ ...q, x: tx(q.x), y: ty(q.y) });
    }
  }
  // Paths from each building's doors on its front to the lane below it (a hall's across its generator yard).
  const laneBelow = (B) => { const R0 = rowsAt.find((r) => r.row.includes(B)); return R0 ? R0.lane : plantY + plantD + 1; };
  for (const B of built) {
    if (!B.part) continue;
    const to = laneBelow(B);
    const cellsOut = [...((B.part.front && B.part.front.cells) || []), ...B.part.exits.filter((ex) => ex.side === "s").flatMap((ex) => ex.cells)];
    for (const [xx, yy] of cellsOut) for (let q = yy + 1; q < to && inside(xx, q); q++) { keep[I(xx, q)] = 1; if (cells[I(xx, q)].f === "grass") cells[I(xx, q)].f = "gravel"; }
  }
  // The ground's guard: nothing put on the ground cuts a walkable cell off from the way in.
  const G = guard(C, 1, roadY + 2);
  const yardPieces = [];
  const put = (xx, yy, k) => { if (cells[I(xx, yy)] && cells[I(xx, yy)].k === "open" && G.block(xx, yy, k)) { keep[I(xx, yy)] = 1; return true; } return false; };
  // ---------- the generator yards: diesel sets in a row in front of each hall, a day tank beside each ----------
  const grounds = [];
  if (D.gens) for (const R0 of rowsAt) {
    for (const B of R0.row) {
      const gy = R0.yard + 2;
      paint(B.x0, R0.yard, B.w, DC.YARD - 1, "paving", false);
      let n = 0;
      for (let xx = B.x0 + 1; xx + 1 < B.x0 + B.w; xx += 4) { if (put(xx, gy, "dcgen")) { put(xx, gy + 2, "vat"); n++; } if (put(xx, gy + 5, "dcgen")) n++; }
      grounds.push({ kind: "genyard", name: `Generator yard, ${B.name}`, x0: B.x0, y0: R0.yard, w: B.w, h: DC.YARD - 1, gens: n });
    }
  }
  // ---------- the plant: the substation (transformers inside its own fence), cooling towers, the fuel farm ----------
  for (const Yd of yards) {
    paint(Yd.x0, Yd.y0, Yd.w, Yd.h, Yd.kind === "cooling" ? "paving" : "gravel", false);
    if (Yd.kind === "substation") {
      for (let xx = Yd.x0; xx < Yd.x0 + Yd.w; xx++) for (const yy of [Yd.y0, Yd.y0 + Yd.h - 1]) if (Math.abs(xx - (Yd.x0 + (Yd.w >> 1))) > 1 || yy === Yd.y0) put(xx, yy, "fence");
      for (let yy = Yd.y0 + 1; yy < Yd.y0 + Yd.h - 1; yy++) { put(Yd.x0, yy, "fence"); put(Yd.x0 + Yd.w - 1, yy, "fence"); }
      for (let yy = Yd.y0 + 3; yy < Yd.y0 + Yd.h - 3; yy += 4) for (let xx = Yd.x0 + 3; xx < Yd.x0 + Yd.w - 3; xx += 4) put(xx, yy, "transformer");
    } else if (Yd.kind === "cooling") {
      for (let yy = Yd.y0 + 2; yy < Yd.y0 + Yd.h - 2; yy += 3) for (let xx = Yd.x0 + 2; xx < Yd.x0 + Yd.w - 2; xx += 3) put(xx, yy, "coolingtower");
    } else {
      for (let yy = Yd.y0 + 2; yy < Yd.y0 + Yd.h - 2; yy += 3) for (let xx = Yd.x0 + 2; xx < Yd.x0 + Yd.w - 2; xx += 3) put(xx, yy, "vat");
    }
    grounds.push({ kind: Yd.kind, name: { substation: "Substation", cooling: "Cooling towers", fuel: "Fuel farm" }[Yd.kind], x0: Yd.x0, y0: Yd.y0, w: Yd.w, h: Yd.h });
  }
  // ---------- the car parks ----------
  const lots = [];
  const lx0 = gate ? gate.x0 + gate.w + 4 : x0; // the car park past the gatehouse
  const lw = Math.min(90, Math.floor((widest - lx0 - 6 * (D.lots - 1)) / D.lots));
  for (let l = 0; l < D.lots && lw >= 16; l++) {
    const r = { x0: lx0 + l * (lw + 6), y0: lotY, w: lw, h: lotH };
    const lot = parkingLot(C, G, r, rng, { name: D.lots > 1 ? `Car park ${String.fromCharCode(65 + l)}` : "Car park", parked: 0.35 });
    if (lot) { lots.push(lot); grounds.push({ kind: "lot", name: lot.name, x0: r.x0, y0: r.y0, w: r.w, h: r.h }); }
  }
  // ---------- the fence (two rings for the government's), its gate over the service road; the gatehouse inside ----------
  for (let ring = 0; ring < D.fence; ring++) {
    const f0 = fence0 + ring * 3, fx1 = W - 1 - f0, fy1 = (lotY - 2) - ring * 3;
    const line = (xx, yy) => { if (yy === fy1 && xx >= gateX0 && xx <= gateX1) return; if (cells[I(xx, yy)].k === "open" && !keep[I(xx, yy)] && G.block(xx, yy, "fence")) keep[I(xx, yy)] = 1; };
    for (let xx = f0; xx <= fx1; xx++) { line(xx, f0); line(xx, fy1); }
    for (let yy = f0; yy <= fy1; yy++) { line(f0, yy); line(fx1, yy); }
  }
  if (gate) grounds.push({ kind: "gate", name: "Main gate", x0: gateX0, y0: lotY - 3 * D.fence - 1, w: gateX1 - gateX0 + 1, h: 3 * D.fence });
  // ---------- the ways out ----------
  const Z = 3, zy = roadY + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the road", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the road", vehicle: false },
    { x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: "North edge of the site", vehicle: false },
  ];
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) { keep[I(p, q)] = 1; const c = cells[I(p, q)]; if (c.k === "fence" || c.k === "tree") { c.k = "open"; G.passAt(I(p, q)); } }
  // ---------- the result ----------
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  const scenes = sceneList.length ? { list: sceneList.map((sc, i) => ({ ...sc, id: i + 1 })), bodies: sceneBodies, piles: scenePiles, pieces: scenePieces, seed: (seedOf(state, "dcscenebattle", tileId, option.id) % 2147483646) + 1 } : null;
  const map = compoundResult(C, { key: option.key, id: option.id, name: option.name, zones, vehicle, kind: "datacenter", extra: { vid: P.id, vname: P.name, dc: P.id, grounds } });
  for (const r of map.plan.rooms) { const a = map.rooms[r.id]; if (a && a.dc) r.dc = a.dc; }
  return Object.assign(map, { scenes, deadScale: DC.DEAD[P.id] || 3 });
}

// ======================================================================================
// The rooms (DC_STYLES, by the plan leaf's dc mark)
// ======================================================================================
/** @typedef {any} Lay */
const full = (L) => L.boxes() >= L.target();
const P_ = (L, o = {}) => ({ ...o, plain: full(L) });
/** Lootable pieces of these kinds against the walls, then off them, until the room holds its share. */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
/** Up to n of k against the walls. */
function some(L, k, n, o = {}) { let got = 0; for (let i = 0; i < n; i++) { if (!L.wall(k, P_(L, o))) break; got++; } return got; }
function deskSet(L, o = {}) { const d = L.wall("desk", P_(L, { prefer: "middle", ...o })); if (d) L.around(d, "chair", 1); return d; }
/**
 * Rows of piece k down the room's long axis, a row every other line: the fronts of two rows face each other across the
 * cold aisle, their backs the next across the hot aisle; a cross aisle every `gap` cells; a container every `every`
 * pieces while the room has its share to come.
 */
function rackRows(L, k, o = {}) {
  const c = L.c, alongX = c.w >= c.h, gap = o.gap || 10, every = o.every || 3;
  const [a0, a1, b0, b1] = alongX ? [c.x0 + 2, c.x1 - 2, c.y0 + 2, c.y1 - 1] : [c.y0 + 2, c.y1 - 2, c.x0 + 2, c.x1 - 1];
  let n = 0, row = 0;
  for (let b = b0; b <= b1; b += 2, row++) {
    const face = alongX ? (row % 2 ? "n" : "s") : (row % 2 ? "w" : "e");
    for (let a = a0, i = 0; a <= a1; a++) {
      if ((a - a0) % gap === gap - 1) continue;
      const [x, y] = alongX ? [a, b] : [b, a];
      if (!L.ok(x, y)) continue;
      const box = !full(L) && i % every === 0;
      i++;
      if (L.place(k, [[x, y]], { face, plain: !box })) n++;
    }
  }
  return n;
}
const commercial = (name) => (L) => COMMERCIAL_STYLES[name](L);

export const DC_STYLES = {
  // The security lobby: the guard's desk and its monitors, a turnstile line, chairs for visitors, a plant.
  lobby(L) { L.wall("secdesk", P_(L, { prefer: "middle" })) || L.need("secdesk"); some(L, "chair", 2, { sides: ["s", "w", "e"] }); L.wall("plant", { prefer: "corner" }); fill(L, ["cabinet"]); },
  // A data hall: racks in hot and cold aisles on the raised floor, the CRAC units on the end walls, a cable tray riser.
  datahall(L) {
    const c = L.c, ends = c.w >= c.h ? ["w", "e"] : ["n", "s"];
    for (const s of ends) L.wall("crac", { sides: [s], prefer: "middle" });
    rackRows(L, "serverrack", { every: 3 });
    if (!L.has("serverrack")) L.need("serverrack");
    L.wall("cabletray", { prefer: "corner" });
    fill(L, ["serverrack"]);
  },
  // A telephone exchange's switch room: the switch frames in rows (racks), a battery string on the wall.
  switch(L) { rackRows(L, "serverrack", { every: 4, gap: 8 }); if (!L.has("serverrack")) L.need("serverrack"); L.wall("batterystring", P_(L, { prefer: "corner" })); fill(L, ["serverrack", "cabinet"]); },
  // A crypto mine's shed: open-frame mining rigs in rows, the fans' roar long gone.
  mining(L) { rackRows(L, "miningrig", { every: 2, gap: 8 }); if (!L.has("miningrig")) L.need("miningrig"); fill(L, ["miningrig", "shelf"]); },
  // An IT container: one line of racks along a wall, the aisle beside it.
  container(L) { some(L, "serverrack", 6, { sides: L.c.w >= L.c.h ? ["n"] : ["w"] }); if (!L.has("serverrack")) L.need("serverrack"); fill(L, ["serverrack"]); },
  // The UPS room: UPS cabinets along the walls, a cable tray; switchgear (a crypto shed's) the same with fewer.
  ups(L) { some(L, "upscab", 6, { prefer: "corner" }); if (!L.has("upscab")) L.need("upscab"); L.wall("cabletray"); fill(L, ["upscab"]); },
  switchgear(L) { some(L, "upscab", 2); if (!L.has("upscab")) L.need("upscab"); L.wall("cabletray"); fill(L, ["upscab", "toolchest"]); },
  // The battery room: strings of batteries on their racks in rows.
  batteries(L) { rackRows(L, "batterystring", { every: 2, gap: 8 }); if (!L.has("batterystring")) L.need("batterystring"); fill(L, ["batterystring"]); },
  // The generator hall: the diesel sets in a row (fixed, 2 MW each), the day tank, a standby set now and then (it
  // lifts: data-power.js genset_standby), drums of diesel and a tool chest.
  genhall(L) {
    const n = Math.max(1, Math.floor(Math.max(L.c.w, L.c.h) / 4));
    some(L, "dcgen", n);
    if (!L.has("dcgen")) L.need("dcgen");
    L.wall("fueltank", { prefer: "corner" });
    if (L.variant(3, "standby") === 0) L.wall("standbyset", { prefer: "corner" });
    fill(L, ["drum", "toolchest", "drum"]);
  },
  // The chiller plant (or the electrical room): chillers and their pumps, a water tank, the tools.
  chillers(L) { L.centre("crac") || L.wall("crac"); L.wall("compressor", { prefer: "corner" }); L.wall("watertank", { prefer: "corner" }); fill(L, ["toolchest", "shelf"]); },
  // The NOC: the monitor wall, desks facing it, a rack in the corner.
  noc(L) {
    L.wall("screens", { prefer: "middle" }) || L.need("screens");
    for (let i = 0; i < 3; i++) if (!deskSet(L)) break;
    L.wall("serverrack", P_(L, { prefer: "corner" }));
    fill(L, ["cabinet", "filing"]);
  },
  playout(L) { some(L, "screens", 2, { prefer: "middle" }); if (!L.has("screens")) L.need("screens"); for (let i = 0; i < 2; i++) if (!deskSet(L)) break; fill(L, ["cabinet", "serverrack"]); },
  // The meet-me room: the carriers' racks in rows, cable trays, cable drums.
  meetme(L) { rackRows(L, "serverrack", { every: 3, gap: 6 }); L.wall("cabletray", { prefer: "corner" }); fill(L, ["cablereel", "serverrack"]); },
  // The loading dock and the staging room: cable drums, crates of kit, the bench to build servers on.
  dock(L) { if (L.c.w * L.c.h >= 40) L.centre("forklift"); fill(L, ["cablereel", "crate", "toolchest"]); },
  staging(L) { const b = L.wall("workbench", P_(L, { prefer: "middle" })); if (b) L.beside(b, "toolchest", P_(L)); fill(L, ["shelf", "cablereel", "crate"]); },
  tapes(L) { fill(L, ["mobileshelf", "mobileshelf", "filing"]); if (!L.has("mobileshelf")) L.need("mobileshelf"); },
  vault(L) { fill(L, ["mobileshelf", "filing"]); if (!L.has("mobileshelf")) L.need("mobileshelf"); },
  office(L) { deskSet(L); L.wall("filing", P_(L, { prefer: "corner" })); fill(L, ["filing", "cabinet"]); },
  workarea: commercial("officefloor"),
  guardroom(L) { L.wall("secdesk", P_(L)) || L.need("secdesk"); L.wall("screens", { prefer: "middle" }); some(L, "locker", 2, { prefer: "corner" }); fill(L, ["locker", "cabinet"]); },
  training(L) { const t = L.centre("table"); if (t) L.around(t, "chair", 4); L.wall("whiteboard"); fill(L, ["cabinet"]); },
  viz(L) { some(L, "screens", 2, { prefer: "middle" }); const t = L.centre("table"); if (t) L.around(t, "chair", 3); fill(L, ["cabinet", "computer"]); },
  hwlab(L) { const b = L.wall("workbench", P_(L)); if (b) L.beside(b, "toolchest", P_(L)); L.wall("serverrack", P_(L, { prefer: "corner" })); fill(L, ["shelf", "cabinet", "toolchest"]); },
};
/** The style of a room of a data-centre plan (its dc mark), or null. @param {any} room */
export function dcStyle(room) {
  return room && room.dc && DC_STYLES[room.dc] ? DC_STYLES[room.dc] : null;
}

// ======================================================================================
// The data centres' signs of survival (interiorscenes.js registerScene; their own dice there), only on a map laid out
// by these plans (when: an area carries its dc mark):
//   dcgas      the gas suppression dumped in a data hall: those who sheltered among the racks lie where they fell;
//   dclastlog  the last shift in the NOC: one slumped at a desk, the incident log still up on the monitor wall;
//   dcfuel     someone kept the generators running to the end: drums dragged in, a body by the diesel sets.
// ======================================================================================
const dcRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.dc) && !r.scene && !r.locked));
const marked = (ctx) => ctx.rooms.some((r) => !!r.dc);
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").toLowerCase();
function gas(ctx) {
  const { rng } = ctx;
  for (const r of dcRooms(ctx, ["datahall", "meetme"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 4) continue;
    const n = Math.min(free.length - 1, rng.int(2, 4));
    const spots = rng.shuffle(free).slice(0, n);
    for (const [x, y] of spots) ctx.body(f, x, y, { human: true, quiet: true });
    return ctx.done("dcgas", r, spots[0][0], spots[0][1], `The gas suppression dumped in the ${lower(r)}: ${n} who sheltered among the racks lie where the air ran out.`);
  }
  return null;
}
function lastLog(ctx) {
  for (const r of dcRooms(ctx, ["noc", "playout"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (!free.length) continue;
    const [x, y] = ctx.rng.pick(free);
    ctx.body(f, x, y, { human: true, quiet: true });
    return ctx.done("dclastlog", r, x, y, `The last shift in the ${lower(r)}: one of them still at the desks, and the incident log on the monitor wall ends mid-sentence.`);
  }
  return null;
}
function fuel(ctx) {
  const { rng } = ctx;
  for (const r of dcRooms(ctx, ["genhall"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 3) continue;
    const spots = rng.shuffle(free).slice(0, 3);
    ctx.piece(f, spots[0][0], spots[0][1], "drum");
    ctx.piece(f, spots[1][0], spots[1][1], "drum");
    ctx.body(f, spots[2][0], spots[2][1], { human: true });
    ctx.splatter(f, spots[2][0], spots[2][1], "human", 1);
    return ctx.done("dcfuel", r, spots[2][0], spots[2][1], `Someone kept the generators running to the end: drums of diesel dragged into the ${lower(r)}, and they never left it.`);
  }
  return null;
}
registerScene("dcgas", { w: 3, place: gas, kinds: ["datacenter"], when: marked });
registerScene("dclastlog", { w: 2, place: lastLog, kinds: ["datacenter"], when: marked });
registerScene("dcfuel", { w: 2, place: fuel, kinds: ["datacenter"], when: marked });
export const DC_SCENES = ["dcgas", "dclastlog", "dcfuel"];
