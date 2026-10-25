// @ts-check
// Industrial buildings, a dozen plans a type (the user's requests 2026-10-25, issue #37 of the interiors epic #7: "every
// building should have several varients"; "for buildings with no to only a few varients create a dozen varients per
// building type"): the warehouse, the factory and the lab building. Their plans (INDUSTRY_PLANS: buildingmaps.js BUILDINGS
// warehouse, factory and lab call industryPlan), the rooms those plans have that no other building does (INDUSTRY_ROLES,
// merged into buildingmaps.js ROLES), the rooms furnished for their kind on roomlayout.js's placement helpers
// (INDUSTRY_STYLES, by the plan leaf's ind mark: lanes kept clear, backs to the walls, a door's front never taken, the
// lootable pieces the containers) and their signs of survival (registered with interiorscenes.js).
//
// A variant is a plan of its own, not a recolour: each differs from the others in its rooms, their order, its entrances,
// corridor or open plan, its size or its storeys (tools/industryvarianttest.js counts the distinct plans by #32's plan
// signature: the set of room roles, which roles have a door between them, the entrance count and the footprint class).
// Which plan a building has: its own dice (a hash of the map's seed, read, never consumed) weighted by its setting (the
// site it stands at: SETTING_OF, the plan's `at` weights). opts.plan pins one (the tests, the renders). Each plan has a
// name (spec.vname): the raid map's plan carries it (plan.variant), the raid's opening line says it, and the choice of
// buildings before a raid names the building by it (buildingmaps.js buildingOptions).
//
// The plans (sizes in cells, a cell about a metre; #24's size table was not on dev, so each size is one row of
// INDUSTRY.SIZE here; the map caps of the size classes keep the footprints to 36 × 25):
//   warehouse  distribution centre (a racking hall, a cross-dock, a dock strip with three roller doors); cold store (a
//              front dock, the cold corridor, a freezer and a chiller behind cold-room doors, the plant room);
//              self-storage (a maze of lettered units behind roller doors off two corridors, two storeys sometimes); lumber
//              yard (a drive-through shed of lumber racks, the saw shop, a yard of lumber stacks); grain elevator (the scale
//              house, the leg, a headhouse and the dryer's control above, a row of grain bins); moving depot (wooden vaults,
//              the packing room, a truck in its bay); parcel hub (the sorting hall's conveyors, docks front and back); drinks
//              distributor (pallets of water, the beer cooler, the route trucks' bay); fuel depot (the pump house, the drum
//              store, a tank farm); tyre warehouse (tyre racks, the fitting bay, the counter); furniture showroom (two floors
//              of beds, sofas and wardrobes over a stock floor); old brick warehouse (three floors of bays off a stair hall,
//              the hoist); and the general warehouse (today's plan).
//   factory    food plant (the canning line, a cold room and a freezer, the dry store); meat packers (the cutting floor,
//              the chillers, the rendering room); metal fabrication works (machine tools, the welding bay, the steel
//              store); textile mill (loom halls on two or three floors, the dye house, the bale store); chemical plant
//              (the process hall's tanks, the control room, the QA lab, a tank farm outside); sawmill (the saw hall, the
//              saw-filing room, the planer shed, drive-through); bottling plant (the bottling line, the syrup room, pallets
//              of water); car-parts plant (the press shop, the assembly line, the parts store, the dock); printing works
//              (the press hall, the plate room, the bindery upstairs); brickworks (the kiln hall, the moulding shed, the
//              drying shed); brewery (the brewhouse's tanks, the cellar, the keg line, a taproom at the front);
//              electronics plant (the assembly floor, a gowning room and the clean room, engineering upstairs); and the
//              general factory (today's).
//   lab        teaching lab (benches in rows, the prep room, a lecture room, the chemical store); R&D lab (reception, the
//              open-plan office, labs, a server room, the prototype shop); biohazard lab (windowless: change rooms, the
//              airlock, the containment lab, the freezer room, the decon shower); crime lab (evidence intake, the evidence
//              store, the trace, firearms and DNA labs); water-testing lab (the sample lab, the pump room, settling tanks);
//              agricultural station (the soil lab, the seed store, a greenhouse of glass); pharmaceutical lab (the
//              formulation lab, the locked drug store, the pilot plant, a clean room); medical examiner's (the cold store,
//              the autopsy suite, the toxicology lab); weather station (the instrument room, the radio, bunks); clean-room
//              fab (gowning, a big clean room, utilities); assay lab (sample prep, the fire-assay furnace, the core store);
//              field research station (a common room, bunks, the field lab, the generator shed); and the general lab
//              building (today's).
// Older saves (roomsLegacy: opts.legacy) keep today's plan, laid out as before: buildingmaps.js calls industryPlan only
// for a new save.
import { hash01 } from "./skills.js";
import { registerScene } from "./interiorscenes.js";
import { COMMERCIAL_STYLES } from "./shoplayout.js";

export const INDUSTRY = {
  // Footprints in cells, [min, max], outer walls included; storeys [min, max].
  SIZE: {
    distrib: { w: [32, 36], h: [21, 24], n: [1, 1] }, coldstore: { w: [26, 30], h: [17, 20], n: [1, 1] }, selfstore: { w: [24, 30], h: [18, 22], n: [1, 2] },
    lumber: { w: [28, 34], h: [15, 18], n: [1, 1] }, grain: { w: [14, 17], h: [10, 12], n: [2, 3] }, moving: { w: [24, 28], h: [16, 19], n: [1, 1] },
    parcel: { w: [30, 36], h: [18, 22], n: [1, 1] }, drinks: { w: [24, 28], h: [16, 19], n: [1, 1] }, fueldepot: { w: [14, 18], h: [10, 12], n: [1, 1] },
    tyres: { w: [22, 26], h: [15, 18], n: [1, 1] }, furniture: { w: [26, 30], h: [16, 19], n: [2, 2] }, brickware: { w: [17, 20], h: [12, 14], n: [3, 3] },
    foodplant: { w: [26, 30], h: [17, 20], n: [1, 1] }, meat: { w: [24, 28], h: [17, 19], n: [1, 1] }, fab: { w: [24, 28], h: [16, 18], n: [1, 1] },
    textile: { w: [20, 24], h: [13, 15], n: [2, 3] }, chemical: { w: [26, 30], h: [17, 20], n: [1, 1] }, sawmill: { w: [28, 34], h: [14, 17], n: [1, 1] },
    bottling: { w: [26, 30], h: [17, 20], n: [1, 1] }, carparts: { w: [28, 34], h: [18, 22], n: [1, 1] }, printing: { w: [22, 26], h: [14, 17], n: [2, 2] },
    brickworks: { w: [26, 32], h: [15, 18], n: [1, 1] }, brewery: { w: [22, 26], h: [15, 18], n: [1, 1] }, electronics: { w: [24, 28], h: [15, 18], n: [2, 2] },
    teaching: { w: [22, 26], h: [13, 15], n: [2, 3] }, rnd: { w: [22, 26], h: [14, 16], n: [2, 3] }, biohazard: { w: [20, 24], h: [13, 15], n: [1, 2] },
    crimelab: { w: [22, 26], h: [14, 16], n: [2, 2] }, waterlab: { w: [12, 15], h: [9, 11], n: [1, 1] }, agri: { w: [20, 24], h: [12, 14], n: [1, 1] },
    pharma: { w: [24, 28], h: [15, 17], n: [2, 2] }, examiner: { w: [18, 22], h: [12, 14], n: [1, 1] }, weather: { w: [11, 13], h: [8, 10], n: [1, 1] },
    cleanfab: { w: [26, 30], h: [15, 18], n: [1, 1] }, assay: { w: [16, 20], h: [11, 13], n: [1, 1] }, fieldstation: { w: [14, 17], h: [10, 12], n: [1, 1] },
  },
  // The containers a plan's rooms hold: each room's share (buildingmaps.js furnishCtx target) × this (spec.boxScale),
  // so each kind holds about what it did a floor cell (tools/industryvarianttest.js: within ±10% over the mix, 200
  // seeds) while a lumber yard is still richer than a weather station's huts. Tuned there.
  LOOT: {
    distrib: 1.15, coldstore: 1.2, selfstore: 1.25, lumber: 0.4, grain: 0.65, moving: 1.2, parcel: 1.45, drinks: 0.75, fueldepot: 0.6, tyres: 0.9, furniture: 1.5, brickware: 0.85,
    foodplant: 0.9, meat: 0.95, fab: 0.75, textile: 0.95, chemical: 1.6, sawmill: 0.4, bottling: 0.7, carparts: 0.95, printing: 1.55, brickworks: 0.8, brewery: 1, electronics: 2.2,
    teaching: 1.75, rnd: 2.3, biohazard: 2.15, crimelab: 2.3, waterlab: 0.75, agri: 1.4, pharma: 0.45, examiner: 0.8, weather: 0.4, cleanfab: 1.5, assay: 0.8, fieldstation: 0.7,
  },
  EMPTY_UNIT: 0.45,   // a self-storage unit cleared out (nothing to search) on these dice
  UNIT_LOCK: 0.55,    // a unit's roller door locked
  YARD: { tanks: [6, 9], bins: [4, 6], stacks: [5, 8], settling: [2, 3], drums: [2, 4] }, // the pieces outside (spec.yardPieces)
};

// The setting a building stands in, from its site (buildingmaps.js siteBuildings: the location's type, else the
// terrain): the plans' `at` weights.
export const SETTING_OF = {
  city: "urban", town: "urban", mall: "urban", suburb: "urban", office: "urban",
  warehouse: "industrial", factory: "industrial", airport: "industrial", dam: "industrial", military: "industrial", quarry: "industrial",
  univ: "campus",
  farm: "rural", ranch: "rural", plains: "rural", forest: "rural", hills: "rural", mountain: "rural", water: "rural",
};
export const settingOf = (site) => (site && SETTING_OF[site]) || "any";

// ---------- the rooms only these buildings have (merged into buildingmaps.js ROLES) ----------
const role = (name, type, furnish, extra = {}) => ({ name, type, furnish, ...extra });
export const INDUSTRY_ROLES = {
  dock:       role("Loading dock", "warehouse", "racks", { hub: true, fl: "conc", maxBoxes: 3 }),
  coldroom:   role("Cold room", "kitchen", "shelves", { fl: "steel", windows: false, maxBoxes: 4 }),
  unit:       role("Storage unit", "warehouse", "shelves", { fl: "conc", windows: false, maxBoxes: 1 }),
  sorting:    role("Sorting hall", "warehouse", "racks", { hub: true, fl: "conc", maxBoxes: 6 }),
  line:       role("Production line", "workshop", "machines", { hub: true, fl: "conc", maxBoxes: 6 }),
  process:    role("Process hall", "workshop", "machines", { fl: "conc", maxBoxes: 4 }),
  kiln:       role("Kiln hall", "workshop", "machines", { fl: "conc", maxBoxes: 3 }),
  cleanroom:  role("Clean room", "lab", "lab", { fl: "rubber", windows: false, maxBoxes: 4 }),
  gowning:    role("Gowning room", "lab", "lockers", { fl: "tile", windows: false, maxBoxes: 1 }),
  greenhouse: role("Greenhouse", "barn", "shelves", { fl: "dirt", maxBoxes: 3 }),
};

// ---------- the plans ----------
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
/** A room: its role (buildingmaps.js ROLES), its style's mark (INDUSTRY_STYLES; null: the commercial or the home style) and the rest. */
const R = (role, ind, o = {}) => ({ role, ...(ind ? { ind } : {}), ...o });
const roll = (rng, r) => rng.int(r[0], r[1]);
const size = (rng, id) => { const S = INDUSTRY.SIZE[id]; return { bw: roll(rng, S.w), bh: roll(rng, S.h), storeys: roll(rng, S.n) }; };
// The footprint's class (tools/storeytest.js FOOT: small up to 190 cells, medium 90–360, large from 290, wide from 280
// and 20 across) for the size the dice rolled: a plan's own class, or the next one up where the footprint outgrew it.
const footOf = (s, cls) => { const a = s.bw * s.bh; return cls === "small" && a > 190 ? "medium" : cls === "medium" && a > 360 ? "large" : cls; };
const OFFICE = (name = "Office", o = {}) => R("office", "office", { name, entry: true, hub: true, ...o });
const lab = (name, kind, o = {}) => R("lab", "lab", { name, lab: kind, ...o });
const coldroom = (name, o = {}) => R("coldroom", "coldroom", { name, dk: "coldroom", ...o });
const roller = (side, roles, o = {}) => ({ side, roles, chance: 1, roller: true, width: 3, lock: 0.25, ...o });
const door = (side, roles, chance = 0.6, lock = 0.35) => ({ side, roles, chance, lock });

// Self-storage units side by side (each its own room behind a roller door, some cleared out, many locked): the parts of
// a band across the building; units(rng, n, depth) the band itself.
function unitParts(rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const empty = rng.chance(INDUSTRY.EMPTY_UNIT);
    out.push(["*", R("unit", "unit", { name: "Storage unit", dk: "roller", ...(empty ? { type: null } : {}), ...(rng.chance(INDUSTRY.UNIT_LOCK) ? { lock: ["door", 1] } : {}) })]);
  }
  return out;
}
const units = (rng, n, depth) => [depth, X(...unitParts(rng, n))];

/** @typedef {{ id: string, name: string, at?: Record<string, number>, sig: string[], make: (rng: any, o: any) => any }} IndustryPlan */
/** @type {Record<string, IndustryPlan[]>} */
export const INDUSTRY_PLANS = {
  warehouse: [
    { id: "distrib", name: "Distribution centre", at: { urban: 2, industrial: 3, rural: 0.3 }, sig: ["palletrack", "dock"], make: (rng) => {
      const s = size(rng, "distrib");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: Y([5, X([7, OFFICE("Shipping office")], [5, R("breakroom", null, { name: "Drivers' lounge" })], [3, R("restroom")], ["*", R("warefloor", null, { name: "Cross-dock", hub: true, maxBoxes: 4 })])],
          ["*", R("warefloor", null, { name: "Racking hall", maxBoxes: 10 })], [4, R("dock", "dock", { name: "Dock" })]),
        exits: [roller("back", ["dock"], { name: "Dock door" }), roller("back", ["dock"], { name: "Dock door" }), roller("back", ["dock"], { chance: 0.7, name: "Dock door" }), door(rng.chance(0.5) ? "left" : "right", ["warefloor"])],
      };
    } },
    { id: "coldstore", name: "Cold-storage warehouse", at: { urban: 1, industrial: 2, rural: 1 }, sig: ["coldshelf", "dock"], make: (rng) => {
      const s = size(rng, "coldstore");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: Y([5, X([6, OFFICE("Front office")], [5, R("lockerroom", null, { name: "Freezer-suit room", type: "workshop" })], ["*", R("dock", "dock", { name: "Cold dock" })])],
          [2, R("corridor", null, { name: "Cold corridor" })],
          ["*", X(["*", coldroom("Freezer room", { freeze: true })], ["*", coldroom("Chiller room")], [5, R("workshop", "plant", { name: "Plant room", type: "workshop" })])]),
        exits: [roller("front", ["dock"], { name: "Cold dock door" }), roller("front", ["dock"], { chance: 0.6, name: "Cold dock door" }), door("back", ["workshop"], 0.8, 0.4)],
      };
    } },
    { id: "selfstore", name: "Self-storage", at: { urban: 2, industrial: 1, rural: 1 }, sig: ["unit"], make: (rng) => {
      const s = size(rng, "selfstore");
      const per = Math.max(4, Math.floor((s.bw - 2) / 4));
      const corr = (name) => [2, R("corridor", null, { name })];
      const grid = (first) => Y(first, corr("Unit corridor A"), units(rng, per, 3), units(rng, per, 3), corr("Unit corridor B"), units(rng, per, "*"));
      return {
        ...s, front: { width: 1 }, ground: rng.chance(0.5) ? "lot" : "town", foot: "wide", stairs: { roles: ["corridor"], n: 1 },
        program: grid([4, X([7, OFFICE("Rental office")], ...unitParts(rng, per - 2))]),
        upper: s.storeys > 1 ? () => grid(units(rng, per, 4)) : null,
        exits: [door("left", ["corridor"], 1, 0.5), door("right", ["corridor"], 1, 0.5), roller("back", ["corridor"], { width: 2, chance: 0.5, lock: 0.6, name: "Gate" })],
      };
    } },
    { id: "lumber", name: "Lumber yard", at: { urban: 0.5, industrial: 2, rural: 2 }, sig: ["palletrack"], make: (rng) => {
      const s = size(rng, "lumber");
      return {
        ...s, storeys: 1, front: { width: 1 }, ground: "lot", foot: "wide", yardPieces: { name: "Lumber stacks", type: "hardware", pieces: [["palletrack", INDUSTRY.YARD.stacks]], loot: true },
        program: X([7, Y([5, OFFICE("Yard office")], ["*", R("workshop", "sawshop", { name: "Saw shop" })])], ["*", R("warefloor", "lumber", { name: "Lumber shed", type: "hardware", maxBoxes: 9 })]),
        exits: [roller("left", ["workshop"], { width: 2, chance: 0.6 }), roller("right", ["warefloor"], { name: "Drive-through" }), roller("back", ["warefloor"], { name: "Drive-through" })],
      };
    } },
    { id: "grain", name: "Grain elevator", at: { urban: 0.1, industrial: 0.5, rural: 4 }, sig: ["grainbin", "conveyor"], make: (rng) => {
      const s = size(rng, "grain");
      return {
        ...s, front: { width: 1 }, ground: "farm", foot: footOf(s, "medium"), stairs: { roles: ["workshop"], n: 1 }, yardPieces: { name: "Grain bins", pieces: [["grainbin", INDUSTRY.YARD.bins]] },
        program: Y([4, X([6, OFFICE("Scale house")], ["*", R("storage", "seedstore", { name: "Seed and chemical store", type: "barn", lock: ["door", 0.3] })])], ["*", R("workshop", "leg", { name: "Elevator leg", type: "barn", hub: true })]),
        upper: () => X(["*", R("workshop", "leg", { name: "Headhouse", type: "workshop", hub: true })], [5, R("control", "instruments", { name: "Dryer control", type: "control" })]),
        exits: [roller("back", ["workshop"], { width: 2, name: "Grain pit" })],
      };
    } },
    { id: "moving", name: "Moving-company depot", at: { urban: 2, industrial: 1, rural: 0.5 }, sig: ["crate"], make: (rng) => {
      const s = size(rng, "moving");
      return {
        ...s, front: { width: 1 }, ground: "town", foot: "wide",
        program: X(["*", Y([5, X([6, OFFICE("Booking office")], ["*", R("storage", "packing", { name: "Packing room", type: "house" })])], ["*", R("warefloor", "vaults", { name: "Storage vaults", maxBoxes: 8 })])],
          [9, R("bays", "truckbay", { name: "Truck bay", type: "garage", maxBoxes: 2 })]),
        exits: [roller("right", ["bays"], { name: "Truck door" }), roller("back", ["warefloor"], { chance: 0.6 })],
      };
    } },
    { id: "parcel", name: "Parcel sorting hub", at: { urban: 2, industrial: 2, rural: 0.3 }, sig: ["conveyor", "dock"], make: (rng) => {
      const s = size(rng, "parcel");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: Y([4, X([6, OFFICE("Hub office")], [5, R("lockerroom", null, { name: "Locker room", type: "lockers" })], [5, R("breakroom")], ["*", R("dock", "dock", { name: "Outbound dock" })])],
          ["*", R("sorting", "sorting", { name: "Sorting hall" })], [3, R("dock", "dock", { name: "Inbound dock" })]),
        exits: [roller("front", ["dock"], { name: "Outbound door" }), roller("back", ["dock"], { name: "Inbound door" }), roller("back", ["dock"], { name: "Inbound door" }), roller("back", ["dock"], { chance: 0.6, name: "Inbound door" })],
      };
    } },
    { id: "drinks", name: "Beverage distributor", at: { urban: 2, industrial: 1, rural: 0.5 }, sig: ["palletrack", "coldshelf"], make: (rng) => {
      const s = size(rng, "drinks");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: X([9, Y([5, OFFICE("Sales office")], [5, coldroom("Beer cooler", { type: "store", drinks: true })], ["*", R("bays", "truckbay", { name: "Route-truck bay", type: "garage", maxBoxes: 2 })])],
          ["*", R("warefloor", null, { name: "Drinks floor", type: "store", maxBoxes: 7 })]),
        exits: [roller("left", ["bays"], { name: "Truck door" }), roller("back", ["warefloor"], { name: "Loading dock" }), roller("back", ["warefloor"], { chance: 0.5, name: "Loading dock" })],
      };
    } },
    { id: "fueldepot", name: "Fuel depot", at: { urban: 0.5, industrial: 2, rural: 1.5 }, sig: ["vat", "fueltank"], make: (rng) => {
      const s = size(rng, "fueldepot");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: footOf(s, "small"), yardPieces: { name: "Tank farm", type: "garage", pieces: [["vat", INDUSTRY.YARD.tanks], ["drum", INDUSTRY.YARD.drums]], loot: true },
        program: Y([4, X([6, OFFICE("Depot office")], ["*", R("storage", "drums", { name: "Drum store", type: "garage" })], [4, R("breakroom", null, { name: "Drivers' room" })])], ["*", R("workshop", "pumphouse", { name: "Pump house", type: "garage", hub: true })]),
        exits: [door("back", ["workshop"], 1, 0.4), roller("left", ["workshop"], { width: 2, chance: 0.5 })],
      };
    } },
    { id: "tyres", name: "Tyre warehouse", at: { urban: 2, industrial: 1, rural: 1 }, sig: ["tirerack"], make: (rng) => {
      const s = size(rng, "tyres");
      return {
        ...s, front: { width: 1 }, ground: "town", foot: "wide",
        program: Y([5, X(["*", R("sales", "tyrecounter", { name: "Tyre counter", type: "garage", entry: true, hub: true, maxBoxes: 3 })], [9, R("bays", null, { name: "Fitting bay", type: "garage", maxBoxes: 3 })])],
          ["*", R("warefloor", "tyres", { name: "Tyre racks", type: "garage", maxBoxes: 8 })]),
        exits: [roller("front", ["bays"], { width: 2, name: "Fitting bay door" }), roller("back", ["warefloor"], { name: "Loading dock" })],
      };
    } },
    { id: "furniture", name: "Furniture warehouse", at: { urban: 2, industrial: 1, rural: 0.3 }, sig: ["sofa", "bed"], make: (rng) => {
      const s = size(rng, "furniture");
      return {
        ...s, front: { width: 2 }, ground: "town", foot: "wide", stairs: { roles: ["sales"], n: 1 },
        program: Y(["*", R("sales", "furnshow", { name: "Showroom", type: "house", entry: true, hub: true, maxBoxes: 6 })], [7, X(["*", R("warefloor", null, { name: "Stock floor", maxBoxes: 5 })], [5, R("office", "office", { name: "Sales office" })], [3, R("restroom")])]),
        upper: () => Y(["*", R("sales", "furnshow", { name: "Upper showroom", type: "house", hub: true, maxBoxes: 5 })], [5, X(["*", R("storage", null, { name: "Mattress store", type: "house" })], [5, R("breakroom")])]),
        exits: [roller("back", ["warefloor"], { name: "Loading dock" }), door(rng.chance(0.5) ? "left" : "right", ["sales"], 0.7, 0.3)],
      };
    } },
    { id: "brickware", name: "Old brick warehouse", at: { urban: 2, industrial: 1, rural: 0.3 }, sig: ["crate", "machine"], make: (rng) => {
      const s = size(rng, "brickware");
      const bay = () => R("storage", "bay", { name: "Bay", fl: "plank", maxBoxes: 3 });
      const hall = [2, R("hall", null, { name: "Stair hall", fl: "plank" })];
      return {
        ...s, front: { width: 1 }, ground: "city", foot: footOf(s, "medium"), stairs: { roles: ["hall"], n: 1 },
        program: Y([4, X([5, OFFICE("Wharf office", { fl: "plank" })], ["*", bay()], [4, R("workshop", "hoist", { name: "Hoist room", fl: "plank" })])], hall, ["*", X(["*", bay()], ["*", bay()])]),
        upper: () => Y([4, X(["*", bay()], [4, R("workshop", "hoist", { name: "Hoist room", fl: "plank" })])], hall, ["*", X(["*", bay()], ["*", bay()])]),
        exits: [roller("back", ["storage", "workshop"], { width: 2, name: "River door" })],
      };
    } },
  ],
  factory: [
    { id: "foodplant", name: "Food-processing plant", at: { urban: 1, industrial: 2, rural: 2 }, sig: ["conveyor", "coldshelf"], make: (rng) => {
      const s = size(rng, "foodplant");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: Y([4, X([6, OFFICE("Plant office")], [5, R("lockerroom", null, { name: "Locker room", type: "workshop" })], [5, R("breakroom")], ["*", R("pantry", "drystore", { name: "Dry store", type: "kitchen", maxBoxes: 3 })])],
          ["*", X(["*", R("line", "line", { name: "Canning line", type: "kitchen", line: "food" })], [7, Y(["*", coldroom("Cold room")], ["*", coldroom("Freezer", { freeze: true })])])]),
        exits: [roller("back", ["line"], { name: "Loading dock" }), door("left", ["line"])],
      };
    } },
    { id: "meat", name: "Meat-packing plant", at: { urban: 0.5, industrial: 2, rural: 2 }, sig: ["conveyor", "meatcase"], make: (rng) => {
      const s = size(rng, "meat");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: Y([4, X([5, OFFICE("Plant office")], [5, R("lockerroom", null, { name: "Locker room", type: "workshop" })], ["*", R("workshop", "rendering", { name: "Rendering room" })])],
          ["*", R("line", "line", { name: "Cutting floor", type: "kitchen", line: "meat" })],
          [5, X(["*", coldroom("Chiller")], ["*", coldroom("Chiller")], [7, R("dock", "dock", { name: "Shipping dock" })])]),
        exits: [roller("back", ["dock"], { name: "Shipping dock" }), door("right", ["line"], 0.6, 0.4)],
      };
    } },
    { id: "fab", name: "Metal fabrication works", at: { urban: 1, industrial: 3, rural: 1 }, sig: ["machine", "workbench"], make: (rng) => {
      const s = size(rng, "fab");
      const side = [7, Y([5, OFFICE("Works office")], [5, R("workshop", "welding", { name: "Welding bay" })], ["*", R("parts", null, { name: "Steel store", type: "workshop" })])];
      const left = rng.chance(0.5);
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide", yardPieces: { name: "Steel stock", type: "workshop", pieces: [["crate", INDUSTRY.YARD.stacks]], loot: true },
        program: X(...(left ? [side, ["*", R("factoryfloor", null, { name: "Fabrication shop" })]] : [["*", R("factoryfloor", null, { name: "Fabrication shop" })], side])),
        exits: [roller("front", ["factoryfloor"], { name: "Shop door" }), roller("back", ["factoryfloor"], { name: "Yard door" })],
      };
    } },
    { id: "textile", name: "Textile mill", at: { urban: 2, industrial: 2, rural: 1 }, sig: ["loom", "vat"], make: (rng) => {
      const s = size(rng, "textile");
      return {
        ...s, front: { width: 1 }, ground: "city", foot: footOf(s, "medium"), stairs: { roles: ["corridor"], n: 1 },
        program: Y([4, X([6, OFFICE("Mill office")], ["*", R("storage", "bales", { name: "Bale store", type: "warehouse" })], [6, R("process", "tanks", { name: "Dye house", tanks: "dye" })])],
          [2, R("corridor", null, { name: "Mill passage" })], ["*", R("line", "line", { name: "Weaving shed", line: "loom" })]),
        upper: (f) => Y(["*", R("line", "line", { name: f === 1 ? "Spinning floor" : "Carding floor", line: "loom", hub: true })], [4, X(["*", R("storage", "bales", { name: "Yarn store", type: "warehouse" })], [3, R("restroom")])]),
        exits: [roller("back", ["line"], { width: 2, name: "Loading door" }), door("left", ["corridor"], 0.7, 0.4), door("right", ["corridor"], 0.7, 0.4)],
      };
    } },
    { id: "chemical", name: "Chemical plant", at: { urban: 0.3, industrial: 3, rural: 1 }, sig: ["vat", "fumehood"], make: (rng) => {
      const s = size(rng, "chemical");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide", yardPieces: { name: "Tank farm", pieces: [["vat", INDUSTRY.YARD.tanks]] },
        program: X([9, Y([5, OFFICE("Plant office")], [5, R("control", "control", { name: "Control room" })], ["*", lab("QA lab", "chem")])],
          ["*", Y([4, R("lockerroom", null, { name: "Change room", type: "workshop" })], ["*", R("process", "tanks", { name: "Process hall", hub: true, tanks: "chem" })])]),
        exits: [roller("right", ["process"], { name: "Tanker door" }), door("back", ["process"], 0.7, 0.4)],
      };
    } },
    { id: "sawmill", name: "Sawmill", at: { urban: 0.2, industrial: 1, rural: 4 }, sig: ["machine", "palletrack"], make: (rng) => {
      const s = size(rng, "sawmill");
      return {
        ...s, front: { width: 1 }, ground: "rural", foot: "wide", yardPieces: { name: "Log deck", type: "hardware", pieces: [["palletrack", INDUSTRY.YARD.stacks]], loot: true },
        program: X([6, Y([5, OFFICE("Mill office")], ["*", R("workshop", "filing", { name: "Saw-filing room" })])], ["*", R("factoryfloor", null, { name: "Saw hall" })], [8, R("warefloor", "lumber", { name: "Planer shed", type: "hardware", maxBoxes: 5 })]),
        exits: [roller("left", ["workshop", "office"], { width: 2, chance: 0.5 }), roller("right", ["warefloor"], { name: "Drive-through" }), roller("back", ["factoryfloor"], { name: "Log door" })],
      };
    } },
    { id: "bottling", name: "Bottling plant", at: { urban: 1, industrial: 2, rural: 1 }, sig: ["conveyor", "palletrack"], make: (rng) => {
      const s = size(rng, "bottling");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: Y([5, X([6, OFFICE("Plant office")], [6, lab("QA lab", "qa")], [6, R("process", "tanks", { name: "Syrup room", type: "kitchen", tanks: "syrup" })], ["*", R("breakroom")])],
          ["*", X(["*", R("line", "line", { name: "Bottling line", type: "store", line: "bottle" })], [9, R("warefloor", null, { name: "Pallet store", type: "store", maxBoxes: 5 })])]),
        exits: [roller("back", ["warefloor"], { name: "Loading dock" }), roller("back", ["line"], { chance: 0.6 })],
      };
    } },
    { id: "carparts", name: "Car-parts plant", at: { urban: 1, industrial: 3, rural: 0.5 }, sig: ["machine", "conveyor"], make: (rng) => {
      const s = size(rng, "carparts");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: "wide",
        program: Y([4, X([6, OFFICE("Plant office")], [5, R("breakroom")], ["*", R("parts", null, { name: "Parts store", type: "garage" })])],
          ["*", X(["*", R("factoryfloor", null, { name: "Press shop" })], ["*", R("line", "line", { name: "Assembly line", type: "garage", line: "parts" })])], [3, R("dock", "dock", { name: "Dock" })]),
        exits: [roller("back", ["dock"], { name: "Dock door" }), roller("back", ["dock"], { name: "Dock door" }), door("left", ["factoryfloor", "line"]), door("right", ["factoryfloor", "line"])],
      };
    } },
    { id: "printing", name: "Printing works", at: { urban: 3, industrial: 1, rural: 0.3 }, sig: ["machine", "palletrack"], make: (rng) => {
      const s = size(rng, "printing");
      return {
        ...s, front: { width: 2 }, ground: "city", foot: "wide", stairs: { roles: ["storage", "office"], n: 1 },
        program: Y([4, X([6, OFFICE("Front office")], [5, R("workshop", "plates", { name: "Plate room" })], ["*", R("storage", "paper", { name: "Paper store", type: "warehouse" })])], ["*", R("factoryfloor", "presses", { name: "Press hall" })]),
        upper: () => Y(["*", R("line", "line", { name: "Bindery", type: "office", line: "bind" })], [5, X(["*", R("office", null, { name: "Offices" })], [5, R("breakroom")])]),
        exits: [roller("back", ["factoryfloor"], { name: "Paper door" }), door(rng.chance(0.5) ? "left" : "right", ["factoryfloor"])],
      };
    } },
    { id: "brickworks", name: "Brickworks", at: { urban: 0.3, industrial: 2, rural: 3 }, sig: ["kiln"], make: (rng) => {
      const s = size(rng, "brickworks");
      return {
        ...s, front: { width: 1 }, ground: "rural", foot: "wide", yardPieces: { name: "Brick yard", type: "warehouse", pieces: [["crate", INDUSTRY.YARD.stacks]], loot: true },
        program: X([7, Y([5, OFFICE("Works office")], ["*", R("storage", "drying", { name: "Drying shed", type: "warehouse" })])], ["*", R("kiln", "kiln", { name: "Kiln hall", hub: true })], [9, R("factoryfloor", null, { name: "Moulding shed" })]),
        exits: [roller("back", ["kiln"], { name: "Kiln door" }), roller("right", ["factoryfloor"], { chance: 0.7 })],
      };
    } },
    { id: "brewery", name: "Brewery", at: { urban: 3, industrial: 1, rural: 1 }, sig: ["vat", "barcounter"], make: (rng) => {
      const s = size(rng, "brewery");
      return {
        ...s, front: { width: 2 }, ground: "town", foot: "wide",
        program: Y([5, X(["*", R("dining", "taproom", { name: "Taproom", type: "kitchen", entry: true, hub: true })], [5, R("office", "office", { name: "Brewery office" })])],
          ["*", X(["*", R("process", "tanks", { name: "Brewhouse", type: "kitchen", hub: true, tanks: "brew" })], [7, Y(["*", coldroom("Cellar")], ["*", R("line", "line", { name: "Keg line", type: "warehouse", line: "keg", hub: false })])])]),
        exits: [roller("back", ["line", "process"], { width: 2, name: "Keg door" }), door("left", ["process"], 0.5)],
      };
    } },
    { id: "electronics", name: "Electronics plant", at: { urban: 2, industrial: 2, rural: 0.3 }, sig: ["labbench", "fumehood"], make: (rng) => {
      const s = size(rng, "electronics");
      return {
        ...s, front: { width: 2 }, ground: "town", foot: "wide", stairs: { roles: ["lobby"], n: 1 },
        program: Y([5, X([7, R("lobby", "lobby", { name: "Reception", entry: true, type: "office" })], [5, R("office", "office", { name: "Plant office" })], ["*", R("breakroom")])],
          ["*", X(["*", R("line", "line", { name: "Assembly floor", type: "control", line: "pcb" })], [4, R("gowning", "gowning", { name: "Gowning room" })], [8, R("cleanroom", "cleanroom", { name: "Clean room", type: "control" })])]),
        upper: () => Y([5, X(["*", R("office", null, { name: "Engineering" })], [4, R("restroom")])], [2, R("corridor")], ["*", X(["*", lab("Test lab", "test", { type: "control" })], ["*", R("storage", null, { name: "Component store", type: "control" })])]),
        exits: [roller("back", ["line"], { width: 2, name: "Goods door" }), door("left", ["line"], 0.6, 0.4)],
      };
    } },
  ],
  lab: [
    { id: "teaching", name: "University teaching lab", at: { urban: 1, campus: 4, rural: 0.3 }, sig: ["labbench", "fumehood"], make: (rng) => {
      const s = size(rng, "teaching");
      const tl = () => lab("Teaching lab", "teach");
      return {
        ...s, front: { width: 2 }, ground: "town", foot: footOf(s, "medium"), stairs: { roles: ["corridor"], n: 1 },
        program: Y([5, X(["*", tl()], [6, R("lobby", "lobby", { name: "Foyer", entry: true })], [5, lab("Prep room", "prep")])], [2, R("corridor")],
          ["*", X(["*", R("classroom", "lecture", { name: "Lecture room", type: "office" })], ["*", tl()], [4, R("storage", "chemstore", { name: "Chemical store", type: "lab", lock: ["door", 0.5], boxLock: ["drugs", 0.3] })])]),
        upper: () => Y([5, X(["*", tl()], [5, R("office", "office", { name: "Staff office" })], ["*", tl()])], [2, R("corridor")], ["*", X(["*", tl()], ["*", tl()], [3, R("restroom")])]),
        exits: [door("left", ["corridor"], 0.7, 0.4), door("right", ["corridor"], 0.7, 0.4)],
      };
    } },
    { id: "rnd", name: "Corporate R&D lab", at: { urban: 3, campus: 1, industrial: 1 }, sig: ["labbench", "serverrack"], make: (rng) => {
      const s = size(rng, "rnd");
      const rl = () => lab("R&D lab", "rnd");
      return {
        ...s, front: { width: 2 }, ground: "town", foot: footOf(s, "medium"), stairs: { roles: ["corridor"], n: 1 },
        program: Y([5, X([7, R("lobby", "lobby", { name: "Reception", entry: true })], ["*", R("office", "openplan", { name: "Open-plan office" })], [5, R("office", "meeting", { name: "Meeting room" })])], [2, R("corridor")],
          ["*", X(["*", rl()], ["*", rl()], [5, R("storage", "server", { name: "Server room", type: "control", lock: ["door", 0.4] })])]),
        upper: () => Y([5, X(["*", R("office", "openplan", { name: "Open-plan office" })], ["*", R("office", "meeting", { name: "Meeting room" })])], [2, R("corridor")], ["*", X(["*", rl()], [7, R("workshop", "protoshop", { name: "Prototype shop" })], [4, R("breakroom", "breakroom")])]),
        exits: [door("back", ["workshop", "lab", "storage"], 0.6, 0.4), door(rng.chance(0.5) ? "left" : "right", ["corridor"], 0.6, 0.4)],
      };
    } },
    { id: "biohazard", name: "Biohazard lab", at: { urban: 1, campus: 2, industrial: 1, rural: 0.5 }, sig: ["fumehood", "labfreezer", "deconshower"], make: (rng) => {
      const s = size(rng, "biohazard");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: footOf(s, "medium"), windows: false, stairs: { roles: ["corridor"], n: 1 },
        program: Y([4, X([6, R("lobby", "lobby", { name: "Security desk", entry: true })], [5, R("lockerroom", "changing", { name: "Change rooms", type: "lockers" })], ["*", R("office", "office", { name: "Lab office" })])], [2, R("corridor")],
          ["*", X([4, R("gowning", "airlock", { name: "Airlock", dk: "steel" })], ["*", lab("Containment lab", "bio", { dk: "security", lock: ["door", 0.3] })], [5, coldroom("Freezer room", { type: "lab", lab: "freezers", ind: "freezers" })], [3, R("gowning", "decon", { name: "Decon shower" })])]),
        upper: () => Y(["*", R("workshop", "plant", { name: "Filter plant", type: "workshop", hub: true })], [4, X(["*", R("office", "office", { name: "Records" })], [5, R("storage", "chemstore", { name: "Supply store", type: "lab" })])]),
        exits: [door("back", ["gowning", "lab"], 0.5, 0.7)],
      };
    } },
    { id: "crimelab", name: "State crime lab", at: { urban: 3, campus: 0.5, industrial: 0.5 }, sig: ["labbench", "evlocker"], make: (rng) => {
      const s = size(rng, "crimelab");
      return {
        ...s, front: { width: 1 }, ground: "city", foot: footOf(s, "medium"), stairs: { roles: ["corridor"], n: 1 },
        program: Y([5, X([6, R("lobby", "lobby", { name: "Evidence intake", entry: true })], [5, R("evidence", "evidence", { name: "Evidence store", lock: ["door", 0.6], boxLock: ["evidence", 0.4] })], ["*", R("office", "office", { name: "Case office" })])], [2, R("corridor")],
          ["*", X(["*", lab("Trace lab", "trace")], ["*", lab("Firearms lab", "firearms")], [6, lab("DNA lab", "dna")])]),
        upper: () => Y([5, X(["*", R("office", "openplan", { name: "Analysts' office" })], [5, R("breakroom", "breakroom")])], [2, R("corridor")], ["*", X(["*", R("storage", "records", { name: "Case records", type: "office" })], ["*", lab("Toxicology lab", "tox")])]),
        exits: [door("back", ["lab"], 0.6, 0.6), door("left", ["corridor"], 0.5, 0.5)],
      };
    } },
    { id: "waterlab", name: "Water-testing lab", at: { urban: 1, industrial: 2, rural: 2 }, sig: ["labbench", "vat"], make: (rng) => {
      const s = size(rng, "waterlab");
      return {
        ...s, front: { width: 1 }, ground: "rural", foot: footOf(s, "small"), yardPieces: { name: "Settling tanks", pieces: [["vat", INDUSTRY.YARD.settling]] },
        program: Y([4, X([5, OFFICE("Office")], ["*", lab("Sample lab", "water")])], ["*", X(["*", R("workshop", "pumproom", { name: "Pump room", type: "control" })], [4, R("storage", "chemstore", { name: "Reagent store", type: "lab" })])]),
        exits: [door("back", ["workshop"], 0.8, 0.4)],
      };
    } },
    { id: "agri", name: "Agricultural research station", at: { urban: 0.2, campus: 1, rural: 4 }, sig: ["labbench", "pottingbench"], make: (rng) => {
      const s = size(rng, "agri");
      const gh = [8, R("greenhouse", "greenhouse", { name: "Greenhouse", glass: true })];
      const main = ["*", Y([5, X([6, OFFICE("Station office")], ["*", lab("Soil lab", "soil")])], ["*", R("storage", "seedstore", { name: "Seed store", type: "barn" })])];
      const left = rng.chance(0.5);
      return {
        ...s, front: { width: 1 }, ground: "farm", foot: footOf(s, "medium"),
        program: X(...(left ? [gh, main] : [main, gh])),
        exits: [door("back", ["storage", "greenhouse"], 0.8, 0.3), door(left ? "left" : "right", ["greenhouse"], 0.7, 0.2)],
      };
    } },
    { id: "pharma", name: "Pharmaceutical lab", at: { urban: 2, campus: 1, industrial: 2 }, sig: ["fumehood", "vat"], make: (rng) => {
      const s = size(rng, "pharma");
      return {
        ...s, front: { width: 2 }, ground: "town", foot: "wide", stairs: { roles: ["corridor"], n: 1 },
        program: Y([5, X([6, R("lobby", "lobby", { name: "Reception", entry: true })], ["*", lab("Formulation lab", "chem")], [5, R("pharmroom", "drugstore", { name: "Drug store", type: "pharmacy", lock: ["door", 0.6], boxLock: ["drugs", 0.5] })])], [2, R("corridor")],
          ["*", X(["*", R("process", "tanks", { name: "Pilot plant", type: "pharmacy", tanks: "pharma" })], [4, R("gowning", "gowning", { name: "Gowning room" })], [7, R("cleanroom", "cleanroom", { name: "Clean room", type: "pharmacy" })])]),
        upper: () => Y([5, X(["*", R("office", "office", { name: "Offices" })], ["*", lab("Analytical lab", "chem")])], [2, R("corridor")], ["*", X(["*", lab("Stability lab", "chem")], [5, R("storage", "chemstore", { name: "Reagent store", type: "pharmacy" })], [4, R("restroom")])]),
        exits: [roller("back", ["process"], { width: 2, chance: 0.7, lock: 0.4 }), door("left", ["corridor"], 0.6, 0.4)],
      };
    } },
    { id: "examiner", name: "Medical examiner's lab", at: { urban: 3, campus: 0.5, rural: 0.5 }, sig: ["morguelocker", "autopsy"], make: (rng) => {
      const s = size(rng, "examiner");
      return {
        ...s, front: { width: 1 }, ground: "city", foot: footOf(s, "medium"),
        program: Y([4, X([6, R("lobby", "lobby", { name: "Reception", entry: true })], ["*", R("office", "office", { name: "Examiner's office" })])], [2, R("corridor")],
          ["*", X(["*", R("morgue", "morgue", { name: "Body store", dk: "coldroom" })], ["*", R("theatre", "autopsy", { name: "Autopsy suite" })], [6, lab("Toxicology lab", "tox")])]),
        exits: [roller("back", ["morgue"], { width: 2, lock: 0.5, name: "Body bay" }), door("right", ["corridor"], 0.5, 0.5)],
      };
    } },
    { id: "weather", name: "Weather station", at: { urban: 0.3, campus: 1, rural: 3 }, sig: ["radioconsole", "screens"], make: (rng) => {
      const s = size(rng, "weather");
      return {
        ...s, front: { width: 1 }, ground: "rural", foot: footOf(s, "small"),
        program: Y([4, X(["*", R("control", "instruments", { name: "Instrument room", entry: true, hub: true })], [4, R("office", "radio", { name: "Radio room", type: "control" })])],
          ["*", X(["*", R("bunk", "bunks", { name: "Bunk room", type: "cabin" })], [4, R("kitchen", "kitchenette", { name: "Kitchenette" })])]),
        exits: [door("back", ["bunk", "kitchen"], 0.6, 0.3)],
      };
    } },
    { id: "cleanfab", name: "Clean-room fab", at: { urban: 1, campus: 1, industrial: 3 }, sig: ["labbench", "fumehood"], make: (rng) => {
      const s = size(rng, "cleanfab");
      return {
        ...s, front: { width: 2 }, ground: "lot", foot: "wide",
        program: X([8, Y([5, R("lobby", "lobby", { name: "Reception", entry: true })], [5, R("office", "office", { name: "Fab office" })], ["*", R("lockerroom", "changing", { name: "Locker room", type: "lockers" })])],
          [4, R("gowning", "gowning", { name: "Gowning room" })], ["*", R("cleanroom", "cleanroom", { name: "Clean room", type: "control", maxBoxes: 6 })],
          [6, Y(["*", R("workshop", "plant", { name: "Utilities" })], [6, R("storage", "chemstore", { name: "Gas and chemical store", type: "lab", lock: ["door", 0.4] })])]),
        exits: [door("back", ["workshop", "storage"], 0.8, 0.5), roller("right", ["workshop"], { width: 2, chance: 0.5 })],
      };
    } },
    { id: "assay", name: "Assay lab", at: { urban: 0.5, industrial: 3, rural: 2 }, sig: ["fumehood", "kiln"], make: (rng) => {
      const s = size(rng, "assay");
      return {
        ...s, front: { width: 1 }, ground: "lot", foot: footOf(s, "medium"),
        program: Y([4, X([5, OFFICE("Assay office")], ["*", R("workshop", "sampleprep", { name: "Sample prep" })])],
          ["*", X(["*", lab("Assay lab", "assay")], [5, R("kiln", "kiln", { name: "Furnace room" })], [5, R("storage", "cores", { name: "Core store", type: "warehouse" })])]),
        exits: [door("back", ["storage", "kiln"], 0.8, 0.4)],
      };
    } },
    { id: "fieldstation", name: "Field research station", at: { urban: 0.1, campus: 0.5, rural: 4 }, sig: ["labbench", "bunk"], make: (rng) => {
      const s = size(rng, "fieldstation");
      return {
        ...s, front: { width: 1 }, ground: "woods", foot: footOf(s, "small"),
        program: X(["*", Y([5, R("dayroom", "commons", { name: "Common room", entry: true, hub: true, type: "cabin" })], ["*", R("bunk", "bunks", { name: "Bunk room", type: "cabin" })])],
          [6, Y(["*", lab("Field lab", "field")], [4, R("workshop", "genshed", { name: "Generator shed", type: "garage" })])]),
        exits: [door("back", ["workshop", "bunk"], 0.7, 0.3)],
      };
    } },
  ],
};
// Today's plan of each kind (buildingmaps.js openfloor / institution) is one more variant, by its old name.
export const GENERAL = { warehouse: { id: "general", name: "Warehouse", sig: ["palletrack"] }, factory: { id: "general", name: "Factory", sig: ["machine"] }, lab: { id: "general", name: "Lab building", sig: [] } };
export const INDUSTRY_KEYS = Object.keys(INDUSTRY_PLANS);
/** Every plan of a key, today's included. @param {string} key */
export const plansOf = (key) => [...(INDUSTRY_PLANS[key] || []), GENERAL[key]];

/**
 * The spec of an industrial building (a new save's): its plan by its dice and its setting (o.site), or o.plan's.
 * general(): today's plan (buildingmaps.js), for the "general" variant. The spec carries vname and vid.
 * @param {string} key @param {any} rng @param {any} o @param {() => any} general
 */
export function industryPlan(key, rng, o, general) {
  const list = plansOf(key);
  let p = o && o.plan ? list.find((q) => q.id === o.plan) : null;
  if (!p) {
    const set = settingOf(o && o.site);
    const w = list.map((q) => (q.at && q.at[set] != null ? q.at[set] : 1));
    let t = hash01(rng.state, "indplan", key) * w.reduce((a, b) => a + b, 0);
    p = list[list.length - 1];
    for (let i = 0; i < list.length; i++) { t -= w[i]; if (t < 0) { p = list[i]; break; } }
  }
  const spec = p.id === "general" ? general() : /** @type {IndustryPlan} */ (p).make(rng, o || {});
  const scale = INDUSTRY.LOOT[p.id];
  return { ...spec, vid: p.id, vname: p.name, ...(scale && p.id !== "general" ? { boxScale: scale } : {}) };
}

// ======================================================================================
// The rooms (INDUSTRY_STYLES, by the plan leaf's ind mark)
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
/** The room's share of containers × m. */
const share = (L, m) => { L.c.target = Math.max(L.c.target ? 1 : 0, Math.round(L.c.target * m)); };
/**
 * Lines of piece k down the room's long axis, a walk between (every `step` lines), clear of the walls at both ends (a
 * way round each line) and cut every `gap` cells (a cross aisle); a container of `box` every `every` cells while the
 * room has its share to come. size: [1, 1] or [2, 1] (a loom, two cells along the line). Returns the cells laid.
 */
function lines(L, k, o = {}) {
  const c = L.c, alongX = o.alongX ?? c.w >= c.h, step = o.step || 2, gap = o.gap || 0, len = o.len || 1;
  const [a0, a1, b0, b1] = alongX ? [c.x0 + 1, c.x1 - 1, c.y0 + (o.start ?? 1), c.y1 - (o.front ?? 1)] : [c.y0 + 1, c.y1 - 1, c.x0 + (o.start ?? 1), c.x1 - (o.front ?? 1)];
  let n = 0, i = 0;
  for (let b = b0; b <= b1; b += step) {
    for (let a = a0; a + len - 1 <= a1; a++) {
      if (gap && (a - a0) % gap === gap - 1) continue;
      const cells = [];
      for (let d = 0; d < len; d++) cells.push(alongX ? [a + d, b] : [b, a + d]);
      if (!cells.every(([x, y]) => L.ok(x, y))) continue;
      const want = o.box && !full(L) && i % (o.every || 3) === 0 ? o.box : k;
      i++;
      if (L.place(want, cells, { face: alongX ? "s" : "e", plain: full(L) })) { n += len; a += len - 1; }
    }
  }
  return n;
}
function deskSet(L, o = {}) { const d = L.wall("desk", P(L, { prefer: "middle", ...o })); if (d) L.around(d, "chair", 1); return d; }
const commercial = (name) => (L) => COMMERCIAL_STYLES[name](L);

export const INDUSTRY_STYLES = {
  // ---------- warehouses ----------
  // A loading dock: pallets waiting by the doors (crates), a forklift where it fits, a pallet rack or two along the side.
  dock(L) {
    const c = L.c;
    if (c.w * c.h >= 30) L.centre("forklift");
    some(L, "palletrack", 2, { sides: ["w", "e"] });
    fill(L, ["crate"]);
  },
  // A cold room: cold-room shelving round the walls (freezer shelving in a freezer), a pallet down the middle.
  coldroom(L) {
    share(L, 1.3);
    const k = L.room.freeze ? "freezershelf" : L.room.drinks ? "coldcase" : "coldshelf";
    fill(L, [k, k, "coldshelf"]);
    if (!L.has(k) && !L.has("coldshelf")) L.need(k);
  },
  // A self-storage unit: a household's things (boxes, a wardrobe, a chest of drawers) or a tradesman's (tools).
  unit(L) {
    if (!L.room.type) { if (L.variant(3, "junk") === 0) L.wall("crate", { plain: true }); return; }
    const kinds = [["crate", "wardrobe", "dresser"], ["toolchest", "crate", "shelf"], ["crate", "crate", "bookshelf"]][L.variant(3, "unit")];
    fill(L, kinds);
    if (!L.boxes()) L.need(kinds[0]);
  },
  // A lumber shed or a planer shed: long rack lines of lumber (pallet racks, some searched), a forklift.
  lumber(L) {
    if (L.c.w * L.c.h >= 40) L.centre("forklift");
    lines(L, "palletrack", { box: "palletrack", every: 4, step: 3, gap: 7 });
    fill(L, ["crate"]);
  },
  // A saw shop or a saw-filing room: a machine (the saw), workbenches, a tool chest.
  sawshop(L) { L.centre("machine", { size: [2, 1] }) || L.wall("machine"); const b = L.wall("workbench", P(L, { prefer: "corner" })); if (b) L.beside(b, "toolchest", P(L)); fill(L, ["toolchest", "shelf"]); },
  // The grain elevator's leg and headhouse: the leg's conveyor up the middle, the distributor, sacks of seed.
  leg(L) {
    const c = L.c, mx = Math.floor((c.x0 + c.x1) / 2);
    for (let y = c.y0 + 1; y <= c.y1 - 1; y++) if (L.ok(mx, y)) L.place("conveyor", [[mx, y]], { face: "e" });
    if (!L.has("conveyor")) L.need("conveyor");
    L.wall("machine", { prefer: "corner" });
    fill(L, ["crate", "shelf"]);
  },
  seedstore(L) { fill(L, ["crate", "shelf", "crate"]); L.wall("barrel"); },
  // A moving depot's storage vaults: rows of wooden vaults (crates) with a household's furniture between.
  vaults(L) {
    lines(L, "crate", { box: "crate", every: 2, step: 2, gap: 6 });
    some(L, "wardrobe", 2);
    fill(L, ["crate", "dresser"]);
  },
  packing(L) { L.centre("table"); fill(L, ["crate", "shelf"]); },
  // A truck in its bay (a moving van, a route truck), a tool chest, tyres.
  truckbay(L) {
    const c = L.c;
    const ax = c.w >= c.h ? "x" : "y";
    for (const [x, y] of c.innerSpots().slice(0, 14)) { if (L.lane(x, y)) continue; if (c.vehicle(x, y, { ax, len: 5, kind: "truck", body: "truck" })) break; }
    L.wall("toolchest", P(L, { prefer: "corner" }));
    fill(L, ["tirerack", "shelf"]);
  },
  // A parcel hub's sorting hall: conveyor lines down the hall with cages of parcels (crates) at their ends.
  sorting(L) {
    lines(L, "conveyor", { step: 3, gap: 8 });
    fill(L, ["crate", "crate", "shelf"]);
  },
  // A fuel depot: the pump house (pumps on the fuel tank, the compressor), the drum store (drums: barrels, crates).
  pumphouse(L) { L.wall("fueltank", { prefer: "corner" }) || L.need("fueltank"); L.wall("compressor", { prefer: "corner" }); fill(L, ["drum", "toolchest", "shelf"]); },
  drums(L) { share(L, 1.5); fill(L, ["drum", "drum", "shelf"]); if (!L.has("drum")) L.need("drum"); },
  // A tyre warehouse: lines of tyre racks; its counter: the counter, the till, a rack on show.
  tyres(L) { lines(L, "tirerack", { box: "tirerack", every: 3, step: 2, gap: 6 }); fill(L, ["tirerack", "shelf"]); },
  tyrecounter(L) { L.wall("counter", P(L, { prefer: "middle" })); L.wall("checkout", { prefer: "corner" }); fill(L, ["tirerack", "shelf"]); },
  // A furniture showroom: room sets (a bed with its nightstand, a sofa and an armchair, a wardrobe and a chest of drawers).
  furnshow(L) {
    for (let i = 0; i < 6; i++) {
      const set = i % 3;
      if (set === 0) { const b = L.centre("bed") || L.wall("bed"); if (b) L.beside(b, "nightstand", P(L)); }
      else if (set === 1) { const s = L.centre("sofa") || L.wall("sofa"); if (s) L.around(s, "armchair", 1); }
      else { L.wall("wardrobe", P(L)); L.wall("dresser", P(L)); }
    }
    if (!L.has("bed")) L.need("bed");
    if (!L.has("sofa")) L.need("sofa");
    fill(L, ["dresser", "wardrobe"]);
  },
  // An old brick warehouse's bay: crates and sacks in stacks, shelving along the brick; the hoist room's winch.
  bay(L) { lines(L, "crate", { box: "crate", every: 2, step: 3, gap: 5 }); fill(L, ["crate", "shelf"]); },
  hoist(L) { L.wall("machine", { prefer: "corner" }) || L.need("machine"); fill(L, ["toolchest", "crate"]); },
  // ---------- factories ----------
  // A production line: the line down the hall (conveyors), and along it what the line makes: steel counters and cold
  // cases (food), the butchers' cases (meat), looms (a mill), cases of bottles (bottling), presses and benches (parts),
  // benches (electronics, a bindery), kegs (a brewery).
  line(L) {
    const kind = L.room.line;
    share(L, 1.1);
    if (kind === "loom") { lines(L, "loom", { len: 2, step: 3, gap: 7 }); if (!L.has("loom")) L.need("loom"); fill(L, ["crate", "shelf"]); return; }
    lines(L, "conveyor", { step: L.c.h >= 9 ? 4 : 3, gap: 9 });
    if (!L.has("conveyor")) L.need("conveyor");
    const by = { food: ["counter", "coldcase", "crate"], meat: ["meatcase", "counter", "freezer"], bottle: ["crate", "palletrack"], parts: ["workbench", "toolchest", "shelf"], pcb: ["labbench", "workbench", "cabinet"], bind: ["workbench", "shelf", "cabinet"], keg: ["barrel", "crate"] }[kind] || ["crate", "shelf"];
    if (kind === "meat") L.wall("meatcase") || L.need("meatcase");
    if (kind === "pcb") { L.wall("labbench") || L.need("labbench"); L.wall("fumehood", { prefer: "corner" }); }
    fill(L, by);
  },
  drystore(L) { fill(L, ["shelf", "crate"]); },
  rendering(L) { some(L, "vat", 2, { prefer: "corner" }); L.wall("sink"); fill(L, ["barrel", "toolchest", "shelf"]); },
  welding(L) { const b = L.wall("workbench", P(L, { prefer: "middle" })) || L.need("workbench"); if (b) L.beside(b, "toolchest", P(L)); L.wall("compressor", { prefer: "corner" }); fill(L, ["toolchest", "shelf"]); },
  // A process hall: tanks in rows (a dye house's vats, a chemical plant's reactors, a brewhouse's mash tun and fermenters,
  // a syrup room, a pilot plant), drums and a control desk.
  tanks(L) {
    const c = L.c;
    for (let y = c.y0 + 1; y <= c.y1 - 1; y += 2) for (let x = c.x0 + 1; x <= c.x1 - 1; x += 3) if (L.ok(x, y)) L.place("vat", [[x, y]], { face: "s" });
    if (!L.has("vat")) L.need("vat");
    deskSet(L, { sides: ["s", "w", "e"] });
    if (L.room.tanks === "pharma") L.wall("fumehood") || L.need("fumehood");
    fill(L, L.room.tanks === "brew" ? ["barrel", "shelf"] : L.room.tanks === "pharma" ? ["cabinet", "shelf"] : ["barrel", "shelf", "toolchest"]);
  },
  control(L) { L.wall("screens", { prefer: "middle" }); deskSet(L); L.wall("serverrack", P(L, { prefer: "corner" })); fill(L, ["cabinet", "filing"]); },
  bales(L) { lines(L, "crate", { box: "crate", every: 2, step: 2, gap: 6 }); fill(L, ["crate", "shelf"]); },
  plates(L) { L.wall("workbench", P(L)) || L.need("workbench"); L.wall("sink"); fill(L, ["cabinet", "shelf"]); },
  paper(L) { lines(L, "palletrack", { box: "palletrack", every: 3, step: 3, gap: 6 }); fill(L, ["crate"]); },
  // A press hall: the presses (machine tools) in a row, pallets of paper beside them.
  presses(L) {
    const c = L.c;
    for (let x = c.x0 + 1; x + 1 <= c.x1 - 1; x += 4) if (L.ok(x, c.y0 + 1) && L.ok(x + 1, c.y0 + 1)) L.place("machine", [[x, c.y0 + 1], [x + 1, c.y0 + 1]], { face: "s" });
    if (!L.has("machine")) L.need("machine");
    fill(L, ["palletrack", "toolchest", "shelf"]);
  },
  // A kiln hall (a brickworks, an assay lab's furnace room): kilns along the walls, pallets of bricks.
  kiln(L) { some(L, "kiln", Math.max(2, Math.floor(Math.max(L.c.w, L.c.h) / 4)), { prefer: "corner" }); if (!L.has("kiln")) L.need("kiln"); fill(L, ["crate", "shelf"]); },
  drying(L) { lines(L, "palletrack", { box: "crate", every: 3, step: 2, gap: 5 }); fill(L, ["crate"]); },
  // A brewery's taproom: the bar counter with its stools, a beer fridge, tables.
  taproom(L) {
    const ws = L.walls();
    if (ws.length) L.run(["barcounter", "barcounter", "barcounter", "coldcase"], [ws[0].side], { plain: () => full(L) });
    if (!L.has("barcounter")) L.need("barcounter");
    for (let i = 0; i < 2; i++) { const t = L.centre("table"); if (!t) break; L.around(t, "chair", 3); }
    fill(L, ["coldcase", "cabinet"]);
  },
  // ---------- labs ----------
  // A lab: benches in rows (lab benches: a container each up to the share), fume hoods on the walls, a sink, cabinets;
  // by its kind a lab freezer (biology, DNA, a containment lab), a gun rack's bullet trap (firearms), a sample fridge.
  lab(L) {
    const k = L.room.lab;
    const hoods = k === "teach" || k === "chem" || k === "prep" || k === "assay" ? 2 : 1;
    for (let i = 0; i < hoods; i++) L.wall("fumehood", { prefer: "corner" });
    if (k !== "field" && k !== "firearms" && !L.has("fumehood")) L.need("fumehood");
    if (k === "prep") { L.wall("counter", P(L)); L.wall("sink"); fill(L, ["cabinet", "shelf"]); return; }
    lines(L, "labbench", { len: 2, step: 3, gap: 7, box: "labbench", every: 1 });
    if (!L.has("labbench")) L.need("labbench");
    L.wall("sink");
    if (k === "bio" || k === "dna" || k === "tox" || k === "water") L.wall("labfreezer", P(L, { prefer: "corner" }));
    if (k === "firearms") { L.wall("watertank", { prefer: "corner" }); L.wall("gunrack", P(L)); }
    if (k === "bio") L.wall("deconshower", { prefer: "corner" });
    fill(L, ["cabinet", "labbench", "shelf"]);
  },
  cleanroom(L) {
    lines(L, "labbench", { len: 2, step: 3, gap: 7, box: "labbench", every: 1 });
    if (!L.has("labbench")) L.need("labbench");
    L.wall("fumehood", { prefer: "corner" }) || L.need("fumehood");
    fill(L, ["cabinet", "labbench"]);
  },
  gowning(L) { some(L, "locker", 2, { prefer: "corner" }); L.centre("chair"); },
  airlock(L) { L.wall("hazmatrack", { prefer: "corner" }); L.wall("locker", P(L)); },
  decon(L) { L.wall("deconshower") || L.need("deconshower"); },
  changing(L) { fill(L, ["locker"]); L.centre("chair"); },
  freezers(L) { share(L, 1.2); fill(L, ["labfreezer", "labfreezer", "freezer"]); if (!L.has("labfreezer")) L.need("labfreezer"); },
  chemstore(L) { fill(L, ["cabinet", "shelf"]); L.wall("hazmatrack", { prefer: "corner" }); },
  lecture(L) {
    const c = L.c;
    L.wall("teacherdesk", P(L, { sides: ["n"] })) || L.wall("teacherdesk", P(L));
    for (let y = c.y0 + 2; y <= c.y1; y += 2) for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) if (L.ok(x, y)) L.place("schooldesk", [[x, y]], { face: "n", plain: full(L) });
  },
  lobby(L) {
    const c = L.c, mid = c.x0 + Math.floor(c.w / 2);
    if (c.h >= 3) for (const x of [mid, mid - 1]) L.place("counter", [[x, c.y0 + 1]], P(L, { face: "s" }));
    some(L, "chair", 2, { sides: ["s", "w", "e"] });
    fill(L, ["cabinet"]);
  },
  office(L) { deskSet(L); L.wall("filing", P(L, { prefer: "corner" })); fill(L, ["filing", "bookshelf"]); },
  openplan: commercial("officefloor"),
  meeting(L) { const t = L.centre("table"); if (t) L.around(t, "chair", 4); L.wall("whiteboard"); fill(L, ["cabinet"]); },
  server(L) { fill(L, ["serverrack", "serverrack", "cabinet"]); if (!L.has("serverrack")) L.need("serverrack"); },
  breakroom: commercial("breakroom"),
  protoshop(L) { L.centre("machine", { size: [2, 1] }); const b = L.wall("workbench", P(L)); if (b) L.beside(b, "toolchest", P(L)); fill(L, ["toolchest", "shelf"]); },
  plant(L) { L.wall("airfilter", { prefer: "corner" }); L.wall("compressor", { prefer: "corner" }); fill(L, ["toolchest", "shelf"]); },
  evidence(L) { fill(L, ["evlocker", "evlocker", "shelf"]); if (!L.has("evlocker")) L.need("evlocker"); },
  records(L) { fill(L, ["filing", "filing", "shelf"]); },
  pumproom(L) { L.wall("compressor", { prefer: "corner" }); L.wall("watertank", { prefer: "corner" }); fill(L, ["toolchest", "shelf"]); },
  greenhouse(L) { lines(L, "pottingbench", { box: "pottingbench", every: 2, step: 2, gap: 6 }); if (!L.has("pottingbench")) L.need("pottingbench"); some(L, "plant", 2, { prefer: "corner" }); },
  drugstore(L) { const s = L.need("drugsafe", { prefer: "corner" }); if (s && s.box) s.box.lockKind = "drugs"; fill(L, ["shelf", "cabinet"]); },
  morgue(L) {
    const ws = L.walls();
    if (ws.length) L.run(Array(Math.max(2, L.target())).fill("morguelocker"), [ws[0].side]);
    if (!L.has("morguelocker")) L.need("morguelocker");
    L.wall("gurney", { size: [2, 1] });
  },
  autopsy(L) { const t = L.centre("autopsy") || L.need("autopsy"); if (t) L.around(t, "floorlamp", 1); L.wall("sink"); L.wall("instcab", P(L, { prefer: "corner" })); fill(L, ["instcab", "cabinet"]); },
  instruments(L) { L.wall("screens", { prefer: "middle" }) || L.need("screens"); L.wall("radioconsole", P(L)) || L.need("radioconsole"); const t = L.centre("maptable"); if (t) L.around(t, "chair", 1); fill(L, ["cabinet", "filing"]); },
  radio(L) { L.wall("radioconsole", P(L)) || L.need("radioconsole"); deskSet(L); fill(L, ["cabinet"]); },
  bunks(L) { for (let i = 0; i < 4; i++) { const b = L.wall("bunk", { prefer: "corner" }); if (!b) break; L.beside(b, "footlocker", P(L)); } if (!L.has("bunk")) L.need("bunk"); fill(L, ["footlocker", "shelf"]); },
  kitchenette(L) { const ws = L.walls(); if (ws.length) L.run(["fridge", "stove", "sink", "counter"], [ws[0].side], { plain: () => full(L) }); for (const k of ["fridge", "stove"]) if (!L.has(k)) L.need(k); fill(L, ["cabinet"]); },
  commons(L) { const t = L.centre("table"); if (t) L.around(t, "chair", 4); L.wall("sofa"); L.wall("bookshelf", P(L)); fill(L, ["cabinet", "shelf"]); },
  genshed(L) { L.wall("fueltank", { prefer: "corner" }); L.wall("compressor"); fill(L, ["toolchest", "shelf"]); },
  sampleprep(L) { L.centre("machine", { size: [2, 1] }); L.wall("workbench", P(L)); L.wall("sink"); fill(L, ["toolchest", "shelf"]); },
  cores(L) { lines(L, "rack", { box: "shelf", every: 3, step: 2, gap: 5 }); fill(L, ["shelf", "crate"]); },
};
/** The style of a room of an industrial plan (its ind mark), or null. @param {any} room */
export function industryStyle(room) {
  return room && room.ind && INDUSTRY_STYLES[room.ind] ? INDUSTRY_STYLES[room.ind] : null;
}

// ======================================================================================
// The industrial buildings' signs of survival (interiorscenes.js registerScene; their own dice there), only on a map laid
// out by these plans (when: an area carries its ind mark, so an older save rolls its scenes as it did):
//   coldshut    someone shut in a cold room (a cold store's, a food plant's, a meat plant's, a brewery's cellar): its
//               door's insulated steel, the body against it, scratches and blood on the inside;
//   breach      a containment lab breached: its door open, a lab freezer's rack spilled, two or three in lab coats dead
//               across the floor and a blood trail out to the corridor;
//   lineshelter a production line's workers held out on the line: crates dragged across between the conveyors, the cots
//               of the night shift, the ones who never left.
// ======================================================================================
const indRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.ind) && !r.scene && !r.locked));
const marked = (ctx) => ctx.rooms.some((r) => !!r.ind);
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").toLowerCase();
function coldShut(ctx) {
  const { rng } = ctx;
  for (const r of indRooms(ctx, ["coldroom"])) {
    const f = r.f || 0, d = (r.doors || [])[0];
    if (!d) continue;
    const spot = ctx.freeIn(r).sort((p, q) => Math.abs(p[0] - d[0]) + Math.abs(p[1] - d[1]) - (Math.abs(q[0] - d[0]) + Math.abs(q[1] - d[1])))[0];
    if (!spot) continue;
    ctx.body(f, spot[0], spot[1], { human: true, quiet: true });
    ctx.splatter(f, spot[0], spot[1], "human", 1);
    return ctx.done("coldshut", r, spot[0], spot[1], `Someone was shut in the ${lower(r)}: scratches on the inside of the steel door, and they are still there.`);
  }
  return null;
}
function breach(ctx) {
  const { rng } = ctx;
  for (const r of indRooms(ctx, ["lab"]).filter((q) => /containment|bio|dna/i.test(q.name || ""))) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 4) continue;
    const n = Math.min(free.length - 1, rng.int(2, 3));
    const spots = rng.shuffle(free).slice(0, n);
    for (const [x, y] of spots) { ctx.body(f, x, y, { human: true, wormed: rng.chance(0.25) }); ctx.splatter(f, x, y, "human", rng.int(1, 2)); }
    const d = (r.doors || [])[0];
    if (d) ctx.trail(f, spots[0][0], spots[0][1], d[0], d[1], "human");
    return ctx.done("breach", r, spots[0][0], spots[0][1], `The ${lower(r)} was breached: ${n} in lab coats lie where they fell, and a trail of blood goes out the door.`);
  }
  return null;
}
function lineShelter(ctx) {
  const { rng } = ctx;
  for (const r of indRooms(ctx, ["line", "sorting"])) {
    const f = r.f || 0, free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0);
    if (free.length < 5) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(2, 4));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    if (!left.length) continue;
    const [cx, cy] = rng.pick(left);
    ctx.piece(f, cx, cy, "crate");
    const near = ctx.freeIn(r).filter(([x, y]) => Math.abs(x - cx) + Math.abs(y - cy) <= 3);
    const n = Math.min(near.length, rng.int(1, 2));
    for (const [x, y] of near.slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.5) });
    return ctx.done("lineshelter", r, cx, cy, `The night shift held out on the ${lower(r)}: cots between the machines, crates dragged across${n ? `, and ${n === 1 ? "one who never left" : `${n} who never left`}` : ""}.`);
  }
  return null;
}
registerScene("coldshut", { w: 2, place: coldShut, kinds: ["warehouse", "factory"], when: marked });
registerScene("breach", { w: 3, place: breach, kinds: ["lab"], when: marked });
registerScene("lineshelter", { w: 2, place: lineShelter, kinds: ["factory", "warehouse"], when: marked });
export const INDUSTRY_SCENES = ["coldshut", "breach", "lineshelter"];
