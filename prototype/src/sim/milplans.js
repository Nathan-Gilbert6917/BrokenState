// @ts-check
// Military bases, air bases and airports, a dozen plans a type (the user's requests 2026-10-25: "every building should
// have several varients"; "for buildings with no to only a few varients create a dozen varients per building type";
// issue #25 of the interiors epic #7, with #32's rule): the plans of the barracks, the armory, the motor pool, the mess
// hall, the hangar, the terminal, the control building, the transmitter hut, the HQ, the aid station, the gatehouse,
// the control tower and flight operations. (The prison's cell block is #31's; the bunkers #26's.)
//
// A variant is a plan of its own, not a recolour: each has a room list of its own (a set of room roles no other plan of
// its type has), and most differ in their arrangement too (a corridor, two corridors, an open hall with rooms behind,
// rooms down one side or both, a split hall), their entrances, their size or their storeys
// (tools/milvarianttest.js counts the distinct plans by #32's plan signature: the room roles, which roles have a door
// between them, the entrances, the footprint class). Today's plan of each type (buildingmaps.js milPlanOf, issue #25's
// first pass) is one of the twelve: "standard". Which plan a building has: its own dice (a hash of the map's seed, read
// and never consumed); opts.plan pins one (the tests, the renders). Each has a name (spec.vname: the raid's opening
// line, the choice before a raid). The rooms are furnished by their civic marks (militarylayout.js MILITARY_STYLES,
// civiclayout.js CIVIC_STYLES), so no room keeps the old furnishing. Sizes: data-buildingsize.js REAL_SIZE (#24) by the
// type's row, × the plan's scale. Older saves (roomsLegacy) never come here: buildingmaps.js keeps their plans.
//
// The layouts (LAYOUTS, by the plan's lay):
//   corridor   the rooms either side of a corridor along the building, the entrance in the middle of the front band
//   double     two corridors: a band of rooms at the front, one in the middle, one at the back
//   open       the main room across the front (the entrance into it), the rooms in a band behind it
//   front      the rooms in a band across the front (the entrance among them), the main room behind
//   side       the main room, the rooms down one side in a strip (the entrance at its front end)
//   both       the rooms down both sides, the main room between
//   split      the main room split in two halls with the rooms in a strip between them
//   court      the rooms round a central hall (the entrance hall): a strip each side, a band behind
//   stack      a tower's: the stair shaft, one room a floor (the plan's floors list, bottom to top)
import { hash01 } from "./skills.js";
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)

/** @typedef {{ s: number, leaf: any }} Opt */
/** @typedef {{ id: string, name: string, lay: string, rooms: string[], upper?: string[], storeys?: number, scale?: number[], ways?: number, floors?: string[] }} Plan */

const R = (role, civic, o = {}) => ({ role, ...(civic ? { civic } : {}), ...o });
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
const WASH = (name = "Washroom") => R("restroom", "washroom", { name, type: "lockers", maxBoxes: 1 });

// ---------- the room kits by type: the main room, the entrance, and the rooms a plan picks from (each its own role) ----------
// opt: { s: cells along the band (or down the strip), leaf }.
const o = (s, leaf) => ({ s, leaf });
/** @type {Record<string, { main: any, entry: any, opts: Record<string, Opt>, ground: string, front?: number, margins?: any, exitRoles: string[], roller?: number, boxScale?: number }>} */
export const KITS = {
  barracks: {
    boxScale: 2,
    main: R("dorm", "bay", { name: "Squad bay", maxBoxes: 6 }), entry: R("foyer", "dutydesk", { name: "Duty desk", type: "barracks" }), ground: "compound", exitRoles: ["corridor", "dorm"],
    opts: {
      latrine: o(6, R("restroom", "latrine", { name: "Latrine" })), dayroom: o(6, R("dayroom", "mdayroom", { name: "Day room", hub: false, type: "barracks", maxBoxes: 2 })),
      nco: o(4, R("bedroom", "nco", { name: "NCO room", type: "barracks", maxBoxes: 2 })), supply: o(5, R("storage", "qmcage", { name: "Supply room", type: "barracks", lock: ["door", 0.3] })),
      lockers: o(5, R("lockerroom", "guardroom", { name: "Locker room", type: "barracks" })), kitchenette: o(5, R("kitchen", "breakroom", { name: "Kitchenette" })),
      orderly: o(5, R("office", "squadron", { name: "Orderly room" })), laundry: o(4, R("laundry", null, { name: "Laundry" })), gym: o(7, R("gym", "fgym", { name: "Gym" })),
      classroom: o(7, R("classroom", "briefing", { name: "Classroom", type: "office" })), arms: o(4, R("armory", "riotstore", { name: "Arms room", lock: ["vault", 0.8], boxLock: ["cage", 0.4], dk: "steel" })),
      showers: o(4, R("bath", "washroom", { name: "Showers", type: "lockers", maxBoxes: 1 })),
    },
  },
  armorybldg: {
    main: R("armory", "vault", { name: "Arms vault", lock: ["vault", 1], boxLock: ["cage", 0.4], gunSafe: ["gunsafe3", 0.35], dk: "steel", maxBoxes: 6 }), entry: R("foyer", "issue", { name: "Issue window", type: "barracks" }), ground: "compound", exitRoles: ["foyer", "office"],
    opts: {
      ammo: o(6, R("storage", "ammostore", { name: "Ammo store", type: "armory", lock: ["door", 0.6], boxLock: ["crate", 0.3], dk: "steel" })), optics: o(5, R("evidence", "optics", { name: "Optics cage", type: "armory", lock: ["door", 0.5], dk: "cell", maxBoxes: 2 })),
      armorer: o(6, R("office", "armorer", { name: "Armorer's office", type: "workshop" })), cleaning: o(5, R("workshop", "toolcrib", { name: "Cleaning room", type: "workshop" })),
      parts: o(5, R("parts", "mparts", { name: "Weapon parts", type: "armory", lock: ["door", 0.4] })), range: o(9, R("lab", "briefing", { name: "Indoor range", type: "barracks" })),
      lockers: o(5, R("lockerroom", "guardroom", { name: "Guard room", type: "barracks" })), break: o(5, R("breakroom", "breakroom", {})), wash: o(3, WASH()),
      nbc: o(5, R("pantry", "lifesupport", { name: "NBC store", type: "flightgear" })), explosives: o(5, R("dispensary", "ammostore", { name: "Explosives store", type: "armory", lock: ["vault", 0.7], dk: "steel" })),
      records: o(4, R("control", "records", { name: "Records", type: "office" })),
    },
  },
  motorpool: {
    main: R("motor", "vbays", { name: "Vehicle bays" }), entry: R("office", "dispatchm", { name: "Dispatch office", hub: true }), ground: "compound", exitRoles: ["motor"], roller: 4,
    opts: {
      parts: o(7, R("parts", "mparts", { type: "motorpool", lock: ["door", 0.5], boxLock: ["crate", 0.3] })), crib: o(7, R("workshop", "toolcrib", { name: "Tool crib", type: "motorpool", lock: ["door", 0.4] })),
      tyres: o(6, R("storage", "mparts", { name: "Tyre store", type: "motorpool" })), lockers: o(5, R("lockerroom", "guardroom", { name: "Drivers' room", type: "barracks" })),
      wash: o(3, WASH()), break: o(6, R("breakroom", "breakroom", {})), paint: o(7, R("lab", "toolcrib", { name: "Paint shop", type: "workshop" })),
      fuel: o(6, R("pantry", "drystore", { name: "Fuel and oil store", type: "motorpool" })), batteries: o(5, R("control", "tequip", { name: "Battery room", type: "workshop" })),
      wash2: o(9, R("bays", "vbays", { name: "Wash bay", type: "motorpool" })), radio: o(5, R("dispensary", "comms", { name: "Radio shop", type: "control" })), records: o(4, R("evidence", "records", { name: "Vehicle records", type: "office" })),
    },
  },
  messhall: {
    main: R("mess", "mess", { name: "Mess hall", maxBoxes: 6 }), entry: R("foyer", "slobby", { name: "Entrance", type: "office" }), ground: "compound", exitRoles: ["mess", "kitchen", "pantry"],
    opts: {
      galley: o(10, R("kitchen", "galley", { name: "Galley", maxBoxes: 4 })), cooler: o(4, R("pantry", "mwalkin", { name: "Walk-in cooler", type: "kitchen", dk: "coldroom", boxTarget: 3 })),
      dry: o(6, R("storage", "drystore", { name: "Dry store", type: "kitchen", lock: ["door", 0.3], boxTarget: 4 })), bakery: o(6, R("workshop", "galley", { name: "Bakery", type: "kitchen" })),
      wash: o(3, WASH()), scullery: o(5, R("laundry", null, { name: "Scullery" })), office: o(5, R("office", "qmoffice", { name: "Mess sergeant's office" })),
      lockers: o(5, R("lockerroom", "guardroom", { name: "Cooks' locker room", type: "barracks" })), officers: o(8, R("dining", "mess", { name: "Officers' mess", type: "kitchen" })),
      bar: o(7, R("dayroom", "mdayroom", { name: "Club bar", type: "kitchen", hub: false })), freezer: o(4, R("dispensary", "mwalkin", { name: "Walk-in freezer", type: "kitchen", dk: "coldroom", boxTarget: 3 })),
      dock: o(6, R("parts", "drystore", { name: "Loading bay", type: "kitchen" })),
    },
  },
  hangar: {
    main: R("hangarfloor", "hfloor", { maxBoxes: 6 }), entry: R("office", "hoffice", { name: "Hangar office", hub: true }), ground: "airfield", front: 12, exitRoles: ["hangarfloor", "parts"], roller: 10,
    opts: {
      parts: o(8, R("parts", "hparts", { type: "hangar", lock: ["door", 0.35] })), avionics: o(8, R("workshop", "avionics", { name: "Avionics shop", type: "hangar" })),
      crew: o(7, R("lockerroom", "crewroom", { name: "Crew room", type: "flightgear" })), life: o(6, R("storage", "lifesupport", { name: "Life support", type: "flightgear" })),
      wash: o(3, WASH()), break: o(6, R("breakroom", "breakroom", {})), engines: o(10, R("bays", "avionics", { name: "Engine shop", type: "hangar" })),
      paint: o(9, R("lab", "toolcrib", { name: "Paint booth", type: "workshop" })), ops: o(6, R("control", "tradar", { name: "Line office" })), tyres: o(6, R("pantry", "hparts", { name: "Wheel and tyre shop", type: "hangar" })),
      nbc: o(5, R("dispensary", "lifesupport", { name: "Survival equipment", type: "flightgear" })), records: o(5, R("evidence", "records", { name: "Maintenance records", type: "office" })),
    },
  },
  terminal: {
    main: R("terminal", "gates", { name: "Departure gates", type: "store", maxBoxes: 3 }), entry: R("lobby", "checkin", { name: "Check-in hall", type: "store", maxBoxes: 3 }), ground: "airfield", front: 12, exitRoles: ["terminal", "warefloor"],
    opts: {
      security: o(14, R("checkpoint", "security", { name: "Security checkpoint", type: "office", maxBoxes: 1 })), confiscated: o(7, R("evidence", "confiscated", { name: "Confiscated items", lock: ["door", 0.6], boxLock: ["evidence", 0.4] })),
      police: o(8, R("office", "squad", { name: "Airport police", boxLock: ["evidence", 0.3] })), baggage: o(14, R("warefloor", "bhall", { name: "Baggage hall", type: "store", maxBoxes: 6 })),
      claim: o(12, R("hall", "claim", { name: "Baggage claim", type: "store", maxBoxes: 4, label: true })), food: o(14, R("kitchen", "foodcourt", { name: "Food court", hub: true, maxBoxes: 4 })),
      dutyfree: o(9, R("sales", "tshop", { name: "Duty free", hub: false, type: "store", maxBoxes: 4 })), wash: o(5, WASH()), lounge: o(12, R("dining", "lounge", { name: "Lounge", type: "store", maxBoxes: 3 })),
      medical: o(6, R("nurse", "aidward", { name: "First aid", type: "clinic" })), customs: o(10, R("control", "security", { name: "Customs hall", type: "office" })), chapel: o(5, R("vestry", "narthex", { name: "Chapel", type: "chapel" })),
    },
  },
  control: {
    main: R("control", "pcontrol", { name: "Control room" }), entry: R("lobby", "tlobby", { name: "Entry", type: "office" }), ground: "lot", exitRoles: ["workshop", "storage", "control"],
    opts: {
      workshop: o(6, R("workshop", "toolcrib", { name: "Workshop" })), store: o(5, R("storage", "hparts", { name: "Spares store", type: "workshop", lock: ["door", 0.4], boxLock: ["safe", 0.3] })),
      office: o(5, R("office", "squadron", { name: "Engineer's office" })), break: o(5, R("breakroom", "breakroom", {})), wash: o(3, WASH()), switch: o(7, R("lab", "tequip", { name: "Switchgear room", type: "control" })),
      lockers: o(5, R("lockerroom", "guardroom", { name: "Locker room", type: "lockers" })), gen: o(6, R("genroom", "tequip", { name: "Generator room", type: "workshop" })), records: o(5, R("evidence", "records", { name: "Records", type: "office" })),
      // bunks: a house's since issue #43, as the radio station's bunk room (a barracks' were its sniper rifles and LMGs)
      batteries: o(5, R("pantry", "tequip", { name: "Battery room", type: "workshop" })), bunks: o(6, R("dorm", "fdorm", { name: "Duty bunk room", type: "house" })), first: o(4, R("nurse", "medic", { name: "First aid", type: "nurse" })),
    },
  },
  radio: {
    boxScale: 0.35,
    main: R("control", "comms", { name: "Transmitter room" }), entry: R("foyer", "guardpost", { name: "Entry", type: "office" }), ground: "rural", exitRoles: ["workshop", "control"],
    opts: {
      gen: o(4, R("workshop", "tequip", { name: "Generator room" })), store: o(3, R("storage", "hparts", { name: "Store", type: "control", lock: ["door", 0.3] })), bunk: o(3, R("bedroom", "nco", { name: "Bunk room", type: "house" })),
      wash: o(2, WASH()), office: o(3, R("office", "weather", { name: "Engineer's desk" })), kitchen: o(3, R("kitchen", "breakroom", { name: "Kitchenette" })), fuel: o(3, R("pantry", "drystore", { name: "Fuel store", type: "motorpool" })),
      studio: o(4, R("lab", "comms", { name: "Studio", type: "control" })), batteries: o(3, R("genroom", "tequip", { name: "Battery room", type: "workshop" })), archive: o(3, R("evidence", "records", { name: "Tape archive", type: "office" })),
      first: o(3, R("nurse", "medic", { name: "First aid", type: "nurse" })), lockers: o(3, R("lockerroom", "guardroom", { name: "Kit room", type: "lockers" })),
    },
  },
  hq: {
    main: R("control", "ops", { name: "Operations room", type: "control", maxBoxes: 3 }), entry: R("lobby", "mlobby", { name: "Duty desk", type: "office" }), ground: "compound", exitRoles: ["corridor"],
    opts: {
      cmd: o(6, R("office", "cmdoffice", { name: "Commander's office", lock: ["door", 0.4], gunSafe: ["gunsafe2", 0.5] })), brief: o(8, R("classroom", "briefing", { name: "Briefing room", type: "office" })),
      comms: o(7, R("lab", "comms", { name: "Comms room", type: "control" })), records: o(5, R("evidence", "records", { name: "Records", boxLock: ["safe", 0.3] })), wash: o(3, WASH()),
      break: o(6, R("breakroom", "breakroom", {})), intel: o(6, R("storage", "records", { name: "Intelligence vault", type: "office", lock: ["door", 0.6], boxLock: ["safe", 0.5] })),
      arms: o(5, R("armory", "riotstore", { name: "Arms room", lock: ["vault", 0.8], boxLock: ["cage", 0.4], dk: "steel" })), med: o(5, R("nurse", "medic", { name: "Medical room", type: "nurse" })),
      bunks: o(6, R("dorm", "fdorm", { name: "Duty bunk room", type: "barracks" })), conf: o(8, R("dining", "briefing", { name: "Conference room", type: "office" })), servers: o(5, R("dispensary", "tequip", { name: "Server room", type: "control" })),
    },
  },
  aidstation: {
    main: R("ward", "aidward", { name: "Aid station" }), entry: R("lobby", "triage", { name: "Triage", type: "clinic" }), ground: "compound", exitRoles: ["corridor", "ward"],
    opts: {
      medic: o(5, R("office", "medic", { name: "Medic's office", type: "clinic" })), store: o(5, R("storage", "aidstore", { name: "Medical store", type: "clinic", lock: ["door", 0.4], boxLock: ["drugs", 0.3] })),
      exam: o(5, R("exam", "triage", { name: "Treatment room", type: "clinic" })), wash: o(3, WASH()), theatre: o(6, R("lab", "medic", { name: "Field surgery", type: "clinic" })),
      pharm: o(4, R("pharmroom", "aidstore", { name: "Pharmacy", lock: ["door", 0.6], boxLock: ["drugs", 0.5] })), dental: o(4, R("nurse", "medic", { name: "Dental room", type: "nurse" })),
      bunks: o(5, R("dorm", "fdorm", { name: "Medics' bunk room", type: "barracks" })), break: o(4, R("breakroom", "breakroom", {})), decon: o(4, R("bath", "washroom", { name: "Decontamination", type: "lockers", maxBoxes: 1 })),
      morgue: o(4, R("morgue", "aidstore", { name: "Morgue", type: "clinic" })), records: o(4, R("evidence", "records", { name: "Records", type: "office" })),
    },
  },
  gatehouse: {
    boxScale: 1.6,
    main: R("office", "guardpost", { name: "Guard post", type: "barracks" }), entry: R("foyer", "mlobby", { name: "Visitor desk", type: "office" }), ground: "compound", exitRoles: ["office", "foyer"],
    opts: {
      wash: o(2, WASH()), search: o(3, R("checkpoint", "security", { name: "Search room", type: "office" })), arms: o(3, R("armory", "riotstore", { name: "Arms locker", lock: ["vault", 0.7], dk: "steel" })),
      bunk: o(3, R("bedroom", "nco", { name: "Guard's bunk", type: "barracks" })), passes: o(3, R("evidence", "records", { name: "Pass office", type: "office" })), kitchen: o(3, R("kitchen", "breakroom", { name: "Kitchenette" })),
      store: o(3, R("storage", "hparts", { name: "Store", type: "barracks" })), radio: o(3, R("control", "comms", { name: "Radio room", type: "control" })), waiting: o(3, R("dayroom", "slobby", { name: "Waiting room", type: "office", hub: false })),
      lockers: o(3, R("lockerroom", "guardroom", { name: "Locker room", type: "barracks" })), first: o(3, R("nurse", "medic", { name: "First aid", type: "nurse" })), cells: o(3, R("pantry", "riotstore", { name: "Holding room", type: "barracks" })),
    },
  },
  flightops: {
    main: R("classroom", "briefing", { name: "Briefing room", type: "office" }), entry: R("lobby", "opsdesk", { name: "Ops desk", type: "office" }), ground: "airfield", front: 12, exitRoles: ["corridor"],
    opts: {
      crew: o(7, R("lockerroom", "crewroom", { name: "Crew room", type: "flightgear" })), life: o(6, R("storage", "lifesupport", { name: "Life support", type: "flightgear", lock: ["door", 0.3] })),
      weather: o(6, R("lab", "weather", { name: "Weather office", type: "office" })), sqn: o(7, R("office", "squadron", { name: "Squadron office" })), wash: o(3, WASH()),
      planning: o(7, R("control", "ops", { name: "Planning room", type: "control" })), break: o(6, R("breakroom", "breakroom", {})), sim: o(8, R("workshop", "avionics", { name: "Simulator room", type: "hangar" })),
      intel: o(6, R("evidence", "records", { name: "Intelligence", type: "office", lock: ["door", 0.5] })), bunks: o(6, R("dorm", "fdorm", { name: "Alert crew quarters", type: "barracks" })),
      med: o(5, R("nurse", "medic", { name: "Flight surgeon", type: "nurse" })), cmd: o(6, R("dining", "cmdoffice", { name: "Squadron commander", type: "office", gunSafe: ["gunsafe2", 0.3] })),
    },
  },
  tower: {
    main: R("control", "cab", { name: "Tower cab", maxBoxes: 3 }), entry: R("lobby", "tlobby", { name: "Tower entrance", type: "office" }), ground: "airfield", front: 12, exitRoles: ["workshop", "lobby"],
    opts: {
      equip: o(4, R("workshop", "tequip", { name: "Equipment room", type: "control" })), radar: o(0, R("lab", "tradar", { name: "Radar room", type: "control" })), approach: o(0, R("office", "tradar", { name: "Approach control" })),
      rest: o(0, R("breakroom", "breakroom", { name: "Rest room" })), wash: o(3, WASH()), gen: o(4, R("genroom", "tequip", { name: "Generator room", type: "workshop" })),
      store: o(3, R("storage", "hparts", { name: "Store", type: "control" })), weather: o(0, R("evidence", "weather", { name: "Weather room", type: "office" })), bunks: o(0, R("dorm", "fdorm", { name: "Crew bunks", type: "barracks" })),
      batteries: o(3, R("pantry", "tequip", { name: "Battery room", type: "workshop" })), training: o(0, R("classroom", "squadron", { name: "Training room", type: "office" })), crash: o(0, R("lockerroom", "crewroom", { name: "Crash crew room", type: "flightgear" })),
    },
  },
};

// ---------- the plans (twelve a type, today's "standard" among them: buildingmaps.js milPlanOf) ----------
/** @type {(id: string, name: string, lay: string, rooms: string[], x?: Partial<Plan>) => Plan} */
const P = (id, name, lay, rooms, x = {}) => ({ id, name, lay, rooms, ...x });
/** @type {Record<string, Plan[]>} */
export const MIL_PLANS = {
  barracks: [
    P("standard", "Barracks", "std", []),
    P("openbay", "Open-bay barracks", "open", ["latrine", "supply", "orderly"], { storeys: 1 }),
    P("hammerhead", "Hammerhead barracks", "both", ["latrine", "dayroom", "nco", "showers"], { storeys: 2 }),
    P("rolling", "Rolling-pin barracks", "corridor", ["latrine", "kitchenette", "laundry", "nco"], { storeys: 3 }),
    P("modular", "Modular barracks", "double", ["latrine", "lockers", "laundry", "dayroom", "orderly"], { storeys: 2 }),
    P("training", "Recruit training barracks", "court", ["latrine", "classroom", "supply", "arms"], { storeys: 2 }),
    P("nco", "NCO quarters", "corridor", ["showers", "nco", "kitchenette"], { storeys: 2, scale: [0.7, 1] }),
    P("guard", "Guard company barracks", "front", ["latrine", "arms", "lockers", "orderly", "kitchenette"], { storeys: 1 }),
    P("transit", "Transient barracks", "open", ["showers", "laundry", "dayroom"], { storeys: 1, scale: [0.8, 1] }),
    P("fitness", "Barracks with a gym", "side", ["latrine", "gym", "nco", "laundry"], { storeys: 2 }),
    P("quonset", "Quonset huts", "split", ["latrine", "supply"], { storeys: 1, scale: [0.9, 0.9] }),
    P("signal", "Signals company barracks", "double", ["showers", "classroom", "orderly", "supply", "kitchenette", "nco"], { storeys: 3 }),
  ],
  armorybldg: [
    P("standard", "Armory", "std", []),
    P("company", "Company arms room", "front", ["ammo", "armorer"]),
    P("battalion", "Battalion armory", "corridor", ["ammo", "optics", "armorer", "cleaning", "wash"]),
    P("ordnance", "Ordnance depot", "split", ["ammo", "explosives", "records"], { scale: [1.2, 1.1] }),
    P("range", "Armory and indoor range", "side", ["ammo", "range", "cleaning"], { scale: [1.3, 1] }),
    P("guard", "Guard armory", "front", ["lockers", "ammo", "nbc"]),
    P("vaults", "Vault row", "both", ["ammo", "optics", "parts", "records"]),
    P("smallarms", "Small-arms repair shop", "side", ["parts", "cleaning", "armorer", "break"]),
    P("nbc", "NBC and arms store", "corridor", ["nbc", "ammo", "lockers", "wash"]),
    P("bunkered", "Bunkered magazine", "open", ["explosives", "ammo"], { scale: [1, 0.9] }),
    P("special", "Special-forces cage", "court", ["optics", "parts", "range", "break"], { scale: [1.2, 1.1] }),
    P("depot", "Arms depot", "double", ["ammo", "records", "parts", "armorer", "lockers", "wash"], { scale: [1.3, 1.3] }),
  ],
  motorpool: [
    P("standard", "Motor pool", "std", []),
    P("drivethrough", "Drive-through motor pool", "side", ["parts", "crib", "lockers"], { ways: 2 }),
    P("twinbay", "Twin-bay motor pool", "split", ["parts", "crib", "wash"]),
    P("heavy", "Heavy maintenance shop", "both", ["parts", "crib", "paint", "batteries"]),
    P("wash", "Motor pool with a wash rack", "side", ["wash2", "parts", "break"]),
    P("dispatch", "Dispatch yard", "front", ["lockers", "records", "fuel"]),
    P("tyre", "Tyre and parts depot", "back", ["tyres", "parts", "crib", "records"]),
    P("signal", "Signals vehicle shop", "side", ["radio", "batteries", "crib", "wash"]),
    P("fuel", "Fuel and oil point", "front", ["fuel", "parts", "wash"], { scale: [0.8, 0.9] }),
    P("paint", "Paint and body shop", "both", ["paint", "crib", "tyres", "break"]),
    P("depot", "Vehicle depot", "back", ["parts", "records", "lockers", "batteries", "wash"], { ways: 2 }),
    P("field", "Field maintenance tent line", "split", ["crib", "fuel"], { scale: [0.8, 0.8] }),
  ],
  messhall: [
    P("standard", "Mess hall", "std", []),
    P("dfac", "Dining facility", "open", ["galley", "cooler", "dry", "wash"]),
    P("field", "Field kitchen", "open", ["galley", "dry"], { scale: [0.7, 0.8] }),
    P("officers", "Officers' club", "front", ["galley", "officers", "bar", "wash"]),
    P("bakery", "Mess and bakery", "open", ["galley", "bakery", "dry", "cooler", "freezer"]),
    P("cafeteria", "Cafeteria line", "side", ["galley", "scullery", "office", "dry"]),
    P("twin", "Twin dining halls", "split", ["galley", "cooler", "wash"], { scale: [1.2, 1] }),
    P("ration", "Ration depot kitchen", "back", ["galley", "dock", "dry", "freezer", "office"]),
    P("crew", "Cooks' training kitchen", "court", ["galley", "lockers", "office", "cooler"]),
    P("nco", "NCO club", "front", ["galley", "bar", "wash"], { scale: [0.8, 0.9] }),
    P("chow", "Chow hall with a scullery", "both", ["galley", "scullery", "cooler", "freezer", "dock"]),
    P("dining", "Dining facility, two lines", "double", ["galley", "bakery", "officers", "lockers", "dry", "wash"], { scale: [1.2, 1.1] }),
  ],
  hangar: [
    P("standard", "Hangar", "std", []),
    P("maintenance", "Maintenance hangar", "side", ["parts", "avionics", "crew"]),
    P("double", "Double hangar", "split", ["parts", "ops", "wash"], { scale: [1.2, 1] }),
    P("engine", "Engine shop hangar", "both", ["engines", "parts", "tyres", "records"]),
    P("paint", "Paint hangar", "side", ["paint", "life", "wash"]),
    P("alert", "Alert hangar", "front", ["crew", "life", "break", "ops"]),
    P("cargo", "Cargo hangar", "back", ["parts", "records", "tyres"]),
    P("heli", "Helicopter hangar", "side", ["avionics", "crew", "nbc"], { scale: [0.8, 0.8] }),
    P("lean", "Lean-to shop hangar", "both", ["avionics", "engines", "break", "wash"]),
    P("hardened", "Hardened aircraft shelter", "front", ["life", "ops"], { scale: [0.7, 0.8] }),
    P("corporate", "Corporate hangar", "back", ["ops", "break", "wash", "records"], { scale: [0.8, 0.8] }),
    P("depot", "Depot hangar", "double", ["parts", "avionics", "engines", "tyres", "records", "crew"], { scale: [1.2, 1.1] }),
  ],
  terminal: [
    P("standard", "Terminal", "std", []),
    P("regional", "Regional terminal", "open", ["security", "baggage", "wash"], { scale: [0.6, 0.7] }),
    P("pier", "Pier terminal", "double", ["security", "claim", "food", "dutyfree", "wash", "baggage"]),
    P("satellite", "Satellite terminal", "court", ["security", "lounge", "food", "wash"]),
    P("commuter", "Commuter terminal", "front", ["security", "claim", "wash"], { scale: [0.5, 0.6] }),
    P("international", "International terminal", "double", ["security", "customs", "claim", "dutyfree", "lounge", "police", "confiscated"], { scale: [1.1, 1] }),
    P("charter", "Charter terminal", "side", ["security", "baggage", "lounge"], { scale: [0.6, 0.7] }),
    P("cargo", "Cargo terminal", "back", ["baggage", "police", "customs"], { scale: [0.7, 0.8] }),
    P("linear", "Linear terminal", "corridor", ["security", "food", "claim", "medical", "wash"]),
    P("hub", "Hub terminal", "both", ["security", "food", "dutyfree", "chapel", "medical", "baggage"], { scale: [1.1, 1] }),
    P("military", "Military passenger terminal", "front", ["security", "confiscated", "baggage", "medical"], { scale: [0.5, 0.6] }),
    P("seaplane", "Small-field terminal", "open", ["claim", "food"], { scale: [0.4, 0.5] }),
  ],
  control: [
    P("standard", "Control building", "std", []),
    P("dam", "Dam control house", "front", ["workshop", "switch", "store"]),
    P("substation", "Substation control", "side", ["switch", "batteries", "wash"]),
    P("pump", "Pumping station control", "open", ["workshop", "gen", "office"]),
    P("plant", "Plant control room", "corridor", ["office", "break", "lockers", "records", "wash"]),
    P("grid", "Grid dispatch centre", "court", ["office", "records", "break", "bunks"]),
    P("water", "Water treatment control", "side", ["workshop", "store", "first"]),
    P("rail", "Signal box", "front", ["switch", "wash"], { scale: [0.7, 0.8] }),
    P("bunkered", "Hardened control bunker", "back", ["gen", "batteries", "bunks", "store"]),
    P("tower", "Control tower block", "stack", [], { floors: ["entry", "workshop", "office", "main"] }),
    P("remote", "Remote telemetry hut", "open", ["batteries"], { scale: [0.6, 0.7] }),
    P("district", "District control centre", "double", ["office", "records", "break", "lockers", "switch", "wash"], { scale: [1.2, 1.1] }),
  ],
  radio: [
    P("standard", "Transmitter hut", "std", []),
    P("relay", "Relay station", "front", ["gen", "store"]),
    P("broadcast", "Broadcast station", "corridor", ["studio", "archive", "wash", "office"], { scale: [1.5, 1.5] }),
    P("manned", "Manned relay with bunks", "side", ["bunk", "kitchen", "gen"]),
    P("solar", "Solar relay", "open", ["batteries"]),
    P("diesel", "Diesel relay", "back", ["fuel", "gen", "store"]),
    P("listening", "Listening post", "front", ["office", "archive", "bunk"]),
    P("emergency", "Emergency broadcast hut", "side", ["studio", "first"]),
    P("forest", "Forestry radio hut", "open", ["kitchen", "bunk", "wash"]),
    P("military", "Military radio relay", "front", ["lockers", "gen", "batteries"]),
    P("repeater", "Repeater shed", "open", ["store"], { scale: [0.8, 0.8] }),
    P("station", "Radio station", "double", ["studio", "office", "archive", "kitchen", "wash", "store"], { scale: [2, 2] }),
  ],
  hq: [
    P("standard", "Headquarters", "std", []),
    P("battalion", "Battalion headquarters", "corridor", ["cmd", "brief", "comms", "records", "wash"]),
    P("brigade", "Brigade headquarters", "double", ["cmd", "brief", "comms", "intel", "conf", "wash"], { storeys: 2 }),
    P("company", "Company orderly room", "front", ["cmd", "records", "arms"], { scale: [0.6, 0.7], storeys: 1 }),
    P("tactical", "Tactical operations centre", "open", ["comms", "servers", "bunks"], { storeys: 1 }),
    P("garrison", "Garrison headquarters", "court", ["cmd", "conf", "records", "break", "med"], { storeys: 2 }),
    P("hardened", "Hardened command post", "back", ["comms", "servers", "arms", "bunks"], { storeys: 1 }),
    P("signals", "Signals headquarters", "side", ["comms", "servers", "brief", "wash"], { storeys: 2 }),
    P("guard", "National Guard armory HQ", "both", ["cmd", "arms", "brief", "break"], { storeys: 2 }),
    P("emergency", "Emergency operations centre", "corridor", ["conf", "comms", "med", "bunks", "break"], { storeys: 2 }),
    P("intel", "Intelligence section", "front", ["intel", "servers", "records"], { storeys: 1, scale: [0.7, 0.8] }),
    P("staff", "Staff college block", "double", ["brief", "conf", "records", "break", "cmd", "wash"], { storeys: 3 }),
  ],
  aidstation: [
    P("standard", "Aid station", "std", []),
    P("battalion", "Battalion aid station", "corridor", ["medic", "store", "exam", "wash"]),
    P("clinic", "Troop clinic", "double", ["medic", "exam", "pharm", "dental", "records", "wash"], { scale: [1.2, 1.2] }),
    P("surgical", "Forward surgical team", "side", ["theatre", "store", "decon"]),
    P("field", "Field hospital tent", "open", ["store", "theatre"], { scale: [1.2, 1] }),
    P("casualty", "Casualty collection point", "front", ["exam", "decon", "morgue"]),
    P("dental", "Dental clinic", "corridor", ["dental", "records", "wash"], { scale: [0.8, 0.9] }),
    P("decon", "Decontamination station", "side", ["decon", "store", "bunks"]),
    P("pharmacy", "Medical supply point", "back", ["pharm", "store", "records"]),
    P("quarters", "Aid station with quarters", "both", ["medic", "bunks", "break", "store"]),
    P("isolation", "Isolation ward", "court", ["exam", "decon", "pharm", "morgue"]),
    P("combat", "Combat support hospital", "double", ["theatre", "pharm", "medic", "exam", "morgue", "wash"], { scale: [1.4, 1.3] }),
  ],
  gatehouse: [
    P("standard", "Gatehouse", "std", []),
    P("main", "Main gate", "side", ["wash", "search", "radio"], { scale: [1.5, 1.3] }),
    P("checkpoint", "Checkpoint booth", "open", ["wash"], { scale: [0.8, 0.9] }),
    P("visitor", "Visitor centre", "front", ["passes", "waiting", "wash"], { scale: [1.8, 1.4] }),
    P("guardroom", "Guard room", "side", ["bunk", "kitchen", "arms"], { scale: [1.3, 1.2] }),
    P("search", "Vehicle search station", "back", ["search", "store", "radio"], { scale: [1.4, 1.3] }),
    P("sentry", "Sentry post", "open", ["arms"], { scale: [0.8, 0.9] }),
    P("mp", "Military police post", "front", ["cells", "arms", "radio"], { scale: [1.6, 1.4] }),
    P("lodge", "Gate lodge", "side", ["kitchen", "bunk", "wash", "store"], { scale: [1.6, 1.4] }),
    P("pass", "Pass and ID office", "back", ["passes", "waiting", "first"], { scale: [1.5, 1.3] }),
    P("barrier", "Barrier control", "front", ["radio", "lockers"], { scale: [1.2, 1.1] }),
    P("fortified", "Fortified gatehouse", "both", ["arms", "search", "cells", "radio", "bunk"], { scale: [2, 1.6] }),
  ],
  flightops: [
    P("standard", "Flight operations", "std", []),
    P("squadron", "Squadron operations", "corridor", ["crew", "life", "sqn", "wash"]),
    P("alert", "Alert facility", "side", ["bunks", "crew", "life", "break"], { storeys: 1 }),
    P("base", "Base operations", "double", ["planning", "weather", "sqn", "intel", "wash", "break"], { storeys: 2 }),
    P("lifesupport", "Aircrew life support", "front", ["life", "crew", "wash"], { storeys: 1, scale: [0.7, 0.8] }),
    P("weather", "Weather and planning", "court", ["weather", "planning", "intel"], { storeys: 1 }),
    P("training", "Flight training centre", "both", ["sim", "crew", "sqn", "break"], { storeys: 2 }),
    P("medical", "Flight medicine", "side", ["med", "crew", "wash"], { storeys: 1 }),
    P("command", "Wing command post", "open", ["cmd", "planning", "intel", "bunks"], { storeys: 1 }),
    P("helicopter", "Helicopter operations", "front", ["crew", "life", "weather", "break"], { storeys: 1 }),
    P("ready", "Ready room", "open", ["crew", "wash"], { storeys: 1, scale: [0.6, 0.7] }),
    P("group", "Operations group", "double", ["cmd", "sqn", "planning", "sim", "life", "wash"], { storeys: 2, scale: [1.2, 1.1] }),
  ],
  tower: [
    P("standard", "Control tower", "std", []),
    P("field", "Field control tower", "stack", [], { floors: ["entry", "equip", "main"] }),
    P("approach", "Tower with approach control", "stack", [], { floors: ["entry", "equip", "approach", "radar", "main"] }),
    P("crash", "Tower over the crash crew", "stack", [], { floors: ["entry", "crash", "rest", "main"] }),
    P("weather", "Tower with a weather room", "stack", [], { floors: ["entry", "gen", "weather", "main"] }),
    P("training", "Training tower", "stack", [], { floors: ["entry", "store", "training", "main"] }),
    P("tall", "Tall tower", "stack", [], { floors: ["entry", "equip", "rest", "approach", "radar", "main"] }),
    P("bunks", "Tower with crew bunks", "stack", [], { floors: ["entry", "batteries", "bunks", "main"] }),
    P("short", "Low tower", "stack", [], { floors: ["entry", "main"] }),
    P("powered", "Tower with its own power", "stack", [], { floors: ["entry", "gen", "batteries", "radar", "main"] }),
    P("military", "Military tower", "stack", [], { floors: ["entry", "store", "crash", "approach", "main"] }),
    P("regional", "Regional tower", "stack", [], { floors: ["entry", "store", "rest", "weather", "main"] }),
  ],
};
// The registry's views (variantpick.js, issue #41): "mil:<key>", pinned by id (o.plan), else the building's hash dice
// (read, never consumed) uniform over the list, as before.
for (const key of Object.keys(MIL_PLANS)) registerVariants(`mil:${key}`, MIL_PLANS[key].map((p) => ({ id: p.id, name: p.name, src: p })));
export const MIL_PLAN_KEYS = Object.keys(MIL_PLANS);

// ---------- the layouts ----------
// Fit a list of [s, leaf] into a band `span` cells long (inner walls a cell): the ones that fit, the last taking the rest.
function band(list, span) {
  const out = [];
  let used = 0;
  for (const [s, leaf] of list) { if (out.length && used + s + 1 > span) break; out.push([s, leaf]); used += s + 1; }
  if (out.length) out[out.length - 1] = ["*", out[out.length - 1][1]];
  return out;
}
const half = (list) => [list.filter((_, i) => i % 2 === 0), list.filter((_, i) => i % 2 === 1)];
/**
 * The program of plan p for the kit K in a footprint bw × bh: { program, stairsRoles }.
 * @param {any} K @param {Plan} p @param {number} bw @param {number} bh @param {number} side 0 | 1 (a strip left or right, by the dice)
 */
export function layoutOf(K, p, bw, bh, side, ground = true) {
  const rooms = p.rooms.map((n) => [K.opts[n].s, K.opts[n].leaf]);
  const entry = { ...K.entry, ...(ground ? { entry: true } : {}) }, main = K.main; // upstairs the entrance's room is no entry
  const inX = bw - 2, inY = bh - 2;
  const bd = Math.max(4, Math.min(8, Math.floor(inY / 3))); // a band's depth
  const sw = Math.max(4, Math.min(9, Math.floor(inX / 4))); // a strip's width
  switch (p.lay) {
    case "corridor": { // rooms either side of a corridor, the entrance and the main room among the front
      const [a, b] = half(rooms);
      const fd = Math.max(4, Math.floor((inY - 2) / 2) - 1);
      return Y([fd, X(...band([[6, entry], ...a, [10, main]], inX))], [2, R("corridor")], ["*", X(...band([...b, [8, { ...main, name: `${main.name} 2` }]], inX))]);
    }
    case "double": { // three bands, two corridors
      const n = rooms.length, a = rooms.slice(0, Math.ceil(n / 3)), b = rooms.slice(Math.ceil(n / 3), Math.ceil((2 * n) / 3)), c = rooms.slice(Math.ceil((2 * n) / 3));
      const d = Math.max(4, Math.floor((inY - 4) / 3) - 1);
      return Y([d, X(...band([[6, entry], ...a], inX))], [2, R("corridor")], [d, X(...band([[10, main], ...b], inX))], [2, R("corridor", null, { name: "Back corridor" })], ["*", X(...band([...c, [8, { ...main, name: `${main.name} 2` }]], inX))]);
    }
    case "open": // the main room across the front, the entrance into it, the rooms behind
      return Y(["*", { ...main, ...(ground ? { entry: true } : {}), hub: true }], [bd, X(...band([...rooms, [5, { ...K.entry, hub: false }]], inX))]);
    case "front": // the rooms across the front with the entrance, the main room behind
      return Y([bd, X(...band([[6, entry], ...rooms], inX))], ["*", { ...main, hub: true }]);
    case "back": // the entrance and the main room at the front, the rooms behind, a corridor between
      return Y(["*", X(["*", { ...main, hub: true }], [Math.min(8, sw), entry])], [2, R("corridor")], [bd, X(...band(rooms, inX))]);
    case "side": { // the main room, the rooms in a strip down one side
      const strip = [sw, Y(...band([[4, entry], ...rooms.map(([s, l]) => [Math.max(3, Math.min(s, 6)), l])], inY).reverse())];
      return X(...(side ? [strip, ["*", { ...main, hub: true }]] : [["*", { ...main, hub: true }], strip]));
    }
    case "both": { // a strip down each side
      const [a, b] = half(rooms);
      const S = (list) => Y(...band(list.map(([s, l]) => [Math.max(3, Math.min(s, 6)), l]), inY).reverse());
      return X([sw, Y([4, entry], ["*", S(a)])], ["*", { ...main, hub: true }], [sw, S(b.length ? b : a.slice(0, 1))]);
    }
    case "split": { // two halls, the rooms in a strip between them
      const strip = [sw, Y(...band([[4, entry], ...rooms.map(([s, l]) => [Math.max(3, Math.min(s, 6)), l])], inY).reverse())];
      return X(["*", { ...main, hub: true }], strip, ["*", { ...main, name: `${main.name} 2`, hub: true }]);
    }
    case "court": { // the entrance hall in the middle, rooms down both sides and across the back
      const [a, b] = half(rooms);
      const S = (list) => Y(...band(list.map(([s, l]) => [Math.max(3, Math.min(s, 6)), l]), inY - bd - 1).reverse());
      return Y(["*", X([sw, S(a.length ? a : rooms)], ["*", { ...entry, hub: true }], [sw, S(b.length ? b : rooms.slice(0, 1))])], [bd, X(...band([[10, main], ...rooms.slice(0, 1)], inX))]);
    }
    default: throw new Error(`milplans: no layout ${p.lay}`);
  }
}
// A stack (a tower's): the stair shaft and one room a floor, the plan's floors list bottom to top ("entry", "main" or a
// kit room's name).
export function stackFloor(K, p, f) {
  const n = p.floors[f];
  const leaf = n === "entry" ? { ...K.entry, ...(f === 0 ? { entry: true } : {}) } : n === "main" ? K.main : K.opts[n].leaf;
  return X([2, R("stairwell")], ["*", leaf]);
}

/**
 * The plan for a military building in a new save: by its dice or o.plan. std(): today's plan (buildingmaps.js). size(k):
 * a footprint { bw, bh } (data-buildingsize.js realFoot). The spec carries vid and vname.
 * @param {string} key @param {any} rng @param {any} o @param {() => any} std @param {(k: string) => { bw: number, bh: number }} size
 */
export function milVariant(key, rng, o, std, size) {
  const list = MIL_PLANS[key];
  if (!list) return std();
  const p = /** @type {any} */ (pickVariant(`mil:${key}`, rng, { plan: (o && o.plan) || null, r: hash01(rng.state, "milplan", key) })).src;
  if (p.id === "standard") return { ...std(), vid: p.id, vname: p.name };
  const K0 = KITS[key], air = (o && o.site === "airbase") || key === "flightops";
  const K = key === "hangar" && air ? { ...K0, main: { ...K0.main, milAir: true } } : K0; // an air base's hangar floor holds military aircraft (militarylayout.js hfloor)
  const s = size(key);
  const [fw, fh] = p.scale || [1, 1];
  const [nw, nh] = needOf(K, p);
  const bw = Math.max(8, Math.round(s.bw * fw), nw + 2), bh = Math.max(7, Math.round(s.bh * fh), nh + 2); // at least what its rooms need (every room of the plan fits)
  const rdoor = (side) => ({ side, roles: [K.main.role], chance: 1, roller: true, width: Math.min(K.roller, Math.max(2, Math.floor(bw / 5))), lock: 0.1, name: key === "hangar" ? "Hangar door" : "Vehicle bay" });
  const roller = K.roller ? [rdoor("front"), ...(["front", "double", "court"].includes(p.lay) ? [rdoor("back")] : [])] : []; // the big door where the main hall meets the outside
  const ways = [{ side: "back", roles: K.exitRoles, chance: 0.8, lock: 0.3 }, ...(p.ways ? [{ side: "left", roles: [...K.exitRoles, K.main.role], chance: 1, lock: 0.3 }, { side: "right", roles: [...K.exitRoles, K.main.role], chance: 1, lock: 0.3 }] : [])];
  const common = { bw, bh, front: { width: 1 }, ground: K.ground, ...(key === "hq" ? { helipad: true, margins: { right: 13 } } : K.front ? { margins: { front: K.front } } : {}), ...(air ? { milAir: true } : {}), vid: p.id, vname: p.name, exits: [...roller, ...ways], ...(K.boxScale ? { boxScale: K.boxScale } : {}) };
  if (p.lay === "stack") {
    const n = p.floors.length;
    return { ...common, storeys: n, foot: footOf(bw, bh, n, true), stairs: { roles: ["stairwell"], n: 1, len: 2 }, program: stackFloor(K, p, 0), upper: n > 1 ? (f) => stackFloor(K, p, f) : null };
  }
  const n = p.storeys || 1;
  const program = layoutOf(K, p, bw, bh, hash01(rng.state, "milside", key) < 0.5 ? 0 : 1);
  const up = n > 1 ? (f) => layoutOf(K, { ...p, rooms: [...p.rooms].reverse() }, bw, bh, f % 2, false) : null;
  return { ...common, storeys: n, foot: footOf(bw, bh, n, false), ...(n > 1 ? { stairs: { roles: [K.main.role, K.entry.role, "corridor"], n: 1, len: 2 } } : {}), program, upper: up };
}
// The inside (cells across, cells deep) a plan's rooms need in its layout: every room fits its band or strip (layoutOf).
const SUM = (list) => list.reduce((a, s) => a + s + 1, 0);
const STRIP = (s) => Math.max(3, Math.min(s, 6));
function needOf(K, p) {
  if (p.lay === "stack" || p.lay === "std") return [0, 0];
  const ss = p.rooms.map((n) => K.opts[n].s);
  const a = ss.filter((_, i) => i % 2 === 0), b = ss.filter((_, i) => i % 2 === 1);
  const thirds = [ss.slice(0, Math.ceil(ss.length / 3)), ss.slice(Math.ceil(ss.length / 3), Math.ceil((2 * ss.length) / 3)), ss.slice(Math.ceil((2 * ss.length) / 3))];
  switch (p.lay) {
    case "corridor": return [Math.max(SUM([6, ...a, 10]), SUM([...b, 8])), 12];
    case "double": return [Math.max(SUM([6, ...thirds[0]]), SUM([10, ...thirds[1]]), SUM([...thirds[2], 8])), 20];
    case "open": return [SUM([...ss, 5]), 12];
    case "front": return [SUM([6, ...ss]) + 2, 12];
    case "back": return [SUM(ss) + 2, 14];
    case "side": case "split": return [p.lay === "split" ? 22 : 16, SUM([5, ...ss.map(STRIP)]) + 1];
    case "both": return [20, Math.max(SUM([5, ...a.map(STRIP)]), SUM(b.map(STRIP))) + 1];
    case "court": return [Math.max(22, SUM([10, ss[0] || 3])), Math.max(SUM(a.map(STRIP)), SUM(b.map(STRIP))) + 9];
    default: return [0, 0];
  }
}
// The footprint class storeytest.js checks (FOOT there): a tower's narrow, the rest by area.
function footOf(bw, bh, n, tall) {
  const a = bw * bh;
  if (tall && a <= 330 && bw <= 22) return "tower";
  if (a <= 190) return a >= 90 ? "medium" : "small";
  if (a <= 289) return "medium";
  return bw >= 20 && n === 1 ? "wide" : "large";
}

// ======================================================================================
// The sites' layouts (a dozen each for a military base, an air base and an airport): which buildings a site has beyond
// its core (buildingmaps.js siteBuildings: the core's ids as they were, the layout's extras after them), and its
// grounds (militarylayout.js militaryOutside, through spec.sl): the perimeter (fence: "wire" the fence with barbed wire
// outside it, "double" two fences, "sandbag" a sandbag line, "open" none), the watchtowers (0–4), the gate (on the front
// or on a side) and an airfield's runway (the apron across the front, down a side or along the back). Which layout:
// hash dice of the tile (its id and its name), the same every visit.
// ======================================================================================
/** @typedef {{ id: string, name: string, extra: (string | string[])[], fence: string, towers: number, gate: string, runway?: string }} SiteLayout */
const L = (id, name, extra, fence, towers, gate, runway = "front") => ({ id, name, extra, fence, towers, gate, runway });
/** @type {Record<string, { core: number, layouts: SiteLayout[] }>} */
export const MIL_SITES = {
  military: { core: 4, layouts: [
    L("garrison", "Garrison", ["hq", "messhall", "aidstation", "gatehouse"], "wire", 4, "front"),
    L("training", "Training base", [["barracks", "Recruit barracks"], "messhall", "aidstation", "gatehouse"], "wire", 2, "front"),
    L("depot", "Supply depot", ["gatehouse", ["warehouse", "Second warehouse"]], "double", 4, "side"),
    L("armor", "Armor base", ["hq", ["motorpool", "Tank park"], "gatehouse"], "wire", 3, "front"),
    L("guard", "National Guard armory", ["hq", "messhall"], "open", 0, "front"),
    L("signal", "Signals base", ["hq", ["radio", "Relay hut"], "gatehouse"], "wire", 2, "side"),
    L("airmobile", "Airmobile base", ["hq", ["hangar", "Helicopter hangar"], "messhall"], "double", 4, "front"),
    L("forward", "Forward operating base", ["hq", "aidstation"], "sandbag", 4, "front"),
    L("logistics", "Logistics base", ["messhall", ["motorpool", "Second motor pool"], "gatehouse"], "wire", 2, "side"),
    L("medical", "Medical brigade post", ["hq", "aidstation", ["aidstation", "Second aid station"]], "wire", 1, "front"),
    L("reserve", "Reserve centre", ["messhall"], "open", 0, "side"),
    L("command", "Command post", ["hq", "messhall", "aidstation", "gatehouse", ["control", "Signals bunker"]], "double", 4, "side"),
  ] },
  airbase: { core: 1, layouts: [
    L("fighter", "Fighter wing", ["tower", "flightops", "barracks", "messhall"], "wire", 4, "front", "front"),
    L("airlift", "Airlift wing", [["hangar", "Cargo hangar"], "tower", "flightops", ["warehouse", "Air freight warehouse"]], "wire", 2, "front", "side"),
    L("helicopter", "Helicopter base", ["tower", "flightops", "aidstation"], "wire", 3, "side", "front"),
    L("guard", "Air Guard field", ["tower", "messhall"], "open", 0, "front", "back"),
    L("training", "Flight school", ["tower", "flightops", "barracks", "messhall", "aidstation"], "wire", 2, "front", "side"),
    L("dispersal", "Dispersal field", ["tower", "barracks"], "sandbag", 4, "side", "back"),
    L("tanker", "Tanker wing", [["hangar", "Second hangar"], "tower", "flightops", "messhall"], "double", 4, "front", "front"),
    L("strip", "Forward airstrip", ["tower"], "sandbag", 2, "front", "side"),
    L("bomber", "Bomber base", [["hangar", "Second hangar"], "tower", "flightops", "barracks", "hq"], "double", 4, "side", "front"),
    L("rescue", "Rescue squadron", ["tower", "flightops", "aidstation", "messhall"], "wire", 2, "front", "back"),
    L("radar", "Radar station", [["radio", "Radar hut"], "tower", "barracks"], "wire", 3, "side", "side"),
    L("reserve", "Reserve air base", ["flightops", "messhall"], "open", 0, "front", "front"),
  ] },
  airport: { core: 3, layouts: [
    L("regional", "Regional airport", ["tower", "firestation"], "open", 0, "front", "front"),
    L("county", "County airfield", ["tower"], "open", 0, "front", "side"),
    L("cargo", "Cargo airport", ["tower", ["warehouse", "Second cargo warehouse"]], "wire", 0, "side", "front"),
    L("international", "International airport", ["tower", "firestation", ["terminal", "Second terminal"]], "wire", 2, "front", "front"),
    L("general", "General-aviation field", [["hangar", "Second hangar"]], "open", 0, "front", "back"),
    L("joint", "Joint civil-military airport", ["tower", "firestation", "flightops"], "wire", 2, "side", "front"),
    L("commuter", "Commuter airport", ["tower"], "open", 0, "front", "back"),
    L("hub", "Hub airport", ["tower", "firestation", ["terminal", "Concourse B"], ["hangar", "Maintenance hangar"]], "wire", 0, "front", "side"),
    L("seaplane", "Lakeside airfield", [["radio", "Radio hut"]], "open", 0, "side", "side"),
    L("crop", "Crop-duster strip", [["hangar", "Second hangar"], ["radio", "Radio hut"]], "open", 0, "front", "back"),
    L("freight", "Freight hub", ["tower", "firestation", ["warehouse", "Freight terminal"]], "double", 2, "side", "front"),
    L("private", "Private jet centre", ["tower", ["control", "Operations building"]], "wire", 0, "front", "side"),
  ] },
};
for (const type of Object.keys(MIL_SITES)) registerVariants(`milsite:${type}`, MIL_SITES[type].layouts.map((l) => ({ id: l.id, name: l.name, src: l }))); // the site layouts (variantpick.js, issue #41)
// The layout of a site's tile (hash dice of its id and name; null for a type with none).
export function milSiteOf(tile) {
  const t = tile && tile.loc && MIL_SITES[tile.loc.type];
  if (!t) return null;
  return /** @type {any} */ (pickVariant(`milsite:${tile.loc.type}`, null, { r: hash01(tile.id, "milsite", tile.loc.name || "") })).src;
}
export const milSiteById = (type, id) => (MIL_SITES[type] ? MIL_SITES[type].layouts.find((l) => l.id === id) || null : null);
