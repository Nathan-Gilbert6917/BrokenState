// @ts-check
// College campus buildings (the user's request 2026-10-25, issue #28 of the interiors epic #7: "Add college campus maps
// that are max 500x500 with connected and disconnected buildings courtyards and dorms"): the floor plans of the
// buildings a campus is made of (campus.js lays them out on one map) and the room styles that furnish them, on
// roomlayout.js's placement helpers (lanes kept clear between the doors and to the stairs, backs to the walls, a door's
// front never taken, the lootable pieces the containers). A plan leaf carries campus: <style> (campusStyle, run by
// buildingmaps.js assemble), or civic: <style> where #15's school, police and church rooms fit (a seminar room is a
// classroom, a locker room a station's); a few rooms borrow #16's styles (the bookstore, the food court, the kitchen,
// the stacks) and the health centre is #14's clinic, its rooms furnished by MEDICAL_STYLES. Every building is a
// BUILDINGS archetype of buildingmaps.js, so a raid can open one alone (setup.raid.place = { id, key, name }).
//
// The buildings (CAMPUS_PLANS, by key; sizes in CAMPUS_SIZE, cells of about a metre, until #24's size table is on dev):
//   dorm          a residence hall of 2–8 storeys: a corridor of double rooms (two beds, two desks, two wardrobes, a
//                 mini fridge) or suites (bedrooms round a common room: o.suite), a lounge on every floor (sofas, a TV,
//                 a kitchenette with a microwave and a fridge), a shared bathroom (shower stalls, toilets, sinks), the
//                 RA's room; on the ground floor the front desk with the mailboxes and the laundry.
//   lecturehall   two lecture halls (rows of fixed seating facing a lectern and the screen), seminar rooms, faculty offices.
//   sciencehall   teaching labs (lab benches, fume hoods, sinks), a prep room, a locked chemical store, a research lab
//                 with chest freezers (#19's freezer rules: good food in winter) and a server rack.
//   univlibrary   3–5 storeys: the circulation desk, the stacks in long rows, reading rooms, study carrels, a locked
//                 archive, a computer lab.
//   studentunion  the food court (#16's dining room) and its kitchen and walk-in, the campus bookstore (#16's bookshelf
//                 aisles), a games room (a pool table, a TV), club offices; upstairs a ballroom.
//   dininghall    the dining room (#15's cafeteria tables), the servery, an industrial kitchen, a walk-in cooler and a
//                 walk-in freezer (chest freezers), a dish room, a dry store.
//   athletics     a basketball court with bleachers, the pool hall (the pool drained: its blue tiles, fl "pool"), a
//                 weight room, locker rooms (#15's), an equipment room of storage cages (bats, sticks: melee weapons).
//   admin         the registrar's counter with queue posts, admissions and the bursar (#16's office floors), records;
//                 upstairs the president's office with a safe, the boardroom.
//   security      campus security: the front desk, dispatch, the officers' room, lockers and a small armory (a gun
//                 rack, an ammo cabinet, a locker) behind a steel door.
//   maintenance   the physical plant: a vehicle bay with the maintenance truck (a container: fuel, parts, tools), the
//                 boiler room, a tool room, the stores.
//   theatre       an auditorium (seating facing a stage with a piano and a lectern), the scene shop, the green room,
//                 the box office; upstairs an art studio, a music room, a rehearsal room.
//   parkgarage    a parking garage of 2–4 levels of parked cars (each a container: AREAS.wreck), a stair run up each level.
//   chapel        #15's church plan (the nave's pews, the altar, the vestry) under the campus's name.
//   healthcentre  #14's clinic (exam rooms, a drug cupboard), under the campus's name.
// Older saves: none of these buildings existed before, so there is nothing to keep; an older save's university keeps its
// one building (buildingmaps.js SITES univ, the roomsLegacy rule: campus.js campusLegacy).
import { hash01 } from "./skills.js";
import { pieceDef } from "./data-furniture.js";
import { registerScene, SCENES } from "./interiorscenes.js"; // the campus buildings' signs of survival (issue #11's hook)
import { CIVIC_STYLES } from "./civiclayout.js";
import { COMMERCIAL_STYLES } from "./shoplayout.js";
import { MEDICAL_STYLES } from "./roomlayout.js";
import { boardCell } from "./barricade.js";

// The footprints, [width range], [depth range] in cells (≈ 1 m a cell, #24's CELL_M), and the storeys, by building.
export const CAMPUS_SIZE = {
  dorm:         { w: [34, 46], h: [17, 17], storeys: [2, 4] },
  lecturehall:  { w: [30, 38], h: [22, 26], storeys: [1, 2] },
  sciencehall:  { w: [32, 40], h: [19, 21], storeys: [2, 3] },
  univlibrary:  { w: [34, 42], h: [24, 28], storeys: [3, 4] },
  studentunion: { w: [38, 46], h: [22, 26], storeys: [2, 2] },
  dininghall:   { w: [28, 34], h: [20, 24], storeys: [1, 2] },
  athletics:    { w: [38, 46], h: [28, 32], storeys: [1, 1] },
  admin:        { w: [28, 36], h: [17, 19], storeys: [2, 3] },
  security:     { w: [18, 22], h: [13, 15], storeys: [1, 1] },
  maintenance:  { w: [24, 30], h: [16, 18], storeys: [1, 1] },
  theatre:      { w: [28, 34], h: [24, 28], storeys: [1, 2] },
  parkgarage:   { w: [34, 42], h: [24, 30], storeys: [2, 4] },
};
export const CAMPUSL = {
  DORM_ROOM: 4,       // a double room's width (a bed, a desk and a wardrobe either side)
  SUITE: 0.35,        // a residence hall is suite-style on these dice (bedrooms round a common room)
  DORM_BOXES: 3,      // a dorm room's containers: a desk, a wardrobe, the fridge (the rest of its pieces plain)
  SEAT_ROWS: 2,       // a lecture hall's rows of seating: every this many cells from the front
  FREEZERS: [1, 2],   // a research lab's chest freezers
  STALL: 3,           // a parking stall's width (a car 2 wide and a cell between)
};
const OPP = { n: "s", s: "n", w: "e", e: "w" };
const D4 = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const ART_D = { n: 2, s: 3, w: 0, e: 1 }; // decor.js wall art's d (toward the room) for a wall on this side
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const range = (rng, [a, b]) => rng.int(a, b);
// A band in front, a corridor, a band behind (buildingmaps.js corridorPlan's shape): front and back are [size, leaf] lists.
const hallPlan = (front, back, fd, cw = 2, hall = null) => ({ split: "y", parts: [[fd, { split: "x", parts: leaves(front) }], [cw, { role: "corridor", ...(hall || {}) }], ["*", { split: "x", parts: leaves(back) }]] });
const ENDS = { roles: ["corridor"], n: 2, len: 2, ends: true }; // a stair run at each end of the main corridor
const fireExits = (lock = 0.4) => [{ side: "left", roles: ["corridor"], chance: 0.8, lock }, { side: "right", roles: ["corridor"], chance: 0.8, lock }];
// The storeys: the campus's say (o.storeys, by the campus kind: campus.js) within MAX, else the building's dice.
const storeysOf = (rng, key, o) => Math.max(1, Math.min(o.maxStoreys || 8, o.storeys || range(rng, CAMPUS_SIZE[key].storeys)));
const footOf = (rng, key, o) => ({ bw: o.bw || range(rng, CAMPUS_SIZE[key].w), bh: o.bh || range(rng, CAMPUS_SIZE[key].h) });

// ---------- the plans ----------
// Each (rng, o) → a buildingmaps.js assemble spec. o: { storeys, maxStoreys, suite, bw, bh } from campus.js (a raid on
// the building alone: its own dice).
const room = (role, name, campus, extra = {}) => ({ role, name, campus, ...extra });
const civ = (role, name, civic, extra = {}) => ({ role, name, civic, ...extra });
const restroom = () => civ("restroom", "Restroom", "washroom");
function dorm(rng, o = {}) {
  const { bw, bh } = footOf(rng, "dorm", o), n = storeysOf(rng, "dorm", o);
  const suite = o.suite != null ? !!o.suite : rng.chance(CAMPUSL.SUITE);
  const inner = bw - 2, fd = 6;
  const rooms = (k, f, side) => Array.from({ length: Math.max(1, k) }, (_, i) => ["*", room("bedroom", "Dorm room", "dormroom", { type: "house", maxBoxes: CAMPUSL.DORM_BOXES, boxTarget: CAMPUSL.DORM_BOXES, fl: "carpet", dorm: `${f}${side}${i}` })]);
  // Suites along the front: two bedrooms either side of a common room, one unit (assemble: its doors stay inside it).
  const suites = (k, f, side) => Array.from({ length: Math.max(1, k) }, (_, i) => {
    const unit = `s${f}${side}${i}`, nm = `Suite ${f + 1}${side}${i + 1}`;
    return ["*", { split: "x", parts: [[CAMPUSL.DORM_ROOM, room("bedroom", `${nm}: bedroom`, "dormroom", { type: "house", unit, maxBoxes: 2, boxTarget: 2, fl: "carpet" })], ["*", room("apt", `${nm}: common room`, "suitecommon", { type: "house", unit, maxBoxes: 1, fl: "carpet" })], [CAMPUSL.DORM_ROOM, room("bedroom", `${nm}: bedroom`, "dormroom", { type: "house", unit, maxBoxes: 2, boxTarget: 2, fl: "carpet" })]] }];
  });
  const lobbyW = 7, perRoom = CAMPUSL.DORM_ROOM + 1, perSuite = 3 * CAMPUSL.DORM_ROOM + 3;
  const frontRow = (f) => {
    const mid = f === 0 ? [lobbyW, room("lobby", "Front desk", "dormlobby", { entry: true, type: "office", maxBoxes: 1 })] : [lobbyW, room("dayroom", "Lounge", "lounge", { hub: false, type: "house", maxBoxes: 2 })];
    const k = Math.floor((inner - lobbyW - 1) / (suite ? perSuite : perRoom));
    const L = Math.ceil(k / 2), R = Math.max(1, k - L);
    const make = suite ? suites : rooms;
    return [...make(L, f, "A"), mid, ...make(R, f, "B")];
  };
  const backRow = (f) => {
    /** @type {[number, any][]} */
    const fixed = f === 0 ? [[5, room("bath", "Bathroom", "dormbath", { maxBoxes: 1 })], [5, room("laundry", "Laundry", "laundry")], [4, room("bedroom", "RA's room", "raroom", { type: "house", maxBoxes: 2, fl: "carpet", ra: true })]]
      : [[5, room("bath", "Bathroom", "dormbath", { maxBoxes: 1 })], [4, room("bedroom", "RA's room", "raroom", { type: "house", maxBoxes: 2, fl: "carpet", ra: true })]];
    /** @type {[number, any]} */
    const end = f === 0 ? [6, room("dayroom", "Lounge", "lounge", { hub: false, type: "house", maxBoxes: 2 })] : [5, room("office", "Study room", "study", { type: "office", maxBoxes: 2 })];
    const used = fixed.reduce((a, [s]) => a + s + 1, 0) + end[0] + 1;
    const k = Math.max(1, Math.floor((inner - used) / perRoom));
    return [...fixed, ...rooms(k, f, "C"), end];
  };
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: n >= 4 ? "tower" : "large", stairs: ENDS, suite,
    program: hallPlan(frontRow(0), backRow(0), fd),
    upper: (f) => hallPlan(frontRow(f), backRow(f), fd),
    exits: [{ side: "back", roles: ["dayroom", "laundry"], chance: 0.6, lock: 0.4 }, ...fireExits(0.3)],
  };
}
function lecturehall(rng, o = {}) {
  const { bw, bh } = footOf(rng, "lecturehall", o), n = storeysOf(rng, "lecturehall", o);
  const hallL = room("classroom", "Lecture hall", "lecture", { type: "office", maxBoxes: 1, fl: "carpet" });
  const seminar = () => civ("classroom", "Seminar room", "classroom");
  const faculty = () => room("office", "Faculty office", "faculty", { type: "office", maxBoxes: 2 });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS,
    program: hallPlan([["*", seminar()], [3, restroom()], [7, room("lobby", "Lobby", "hallobby", { entry: true, type: "office", maxBoxes: 1 })], [4, faculty()], ["*", seminar()]], [["*", hallL], [5, faculty()], ["*", { ...hallL }]], 6),
    upper: () => hallPlan([["*", faculty()], ["*", faculty()], [7, room("office", "Department office", "faculty", { type: "office", maxBoxes: 2 })], ["*", faculty()], ["*", faculty()]], [["*", seminar()], ["*", seminar()], [3, restroom()], ["*", seminar()]], 6),
    exits: [{ side: "back", roles: ["classroom", "office"], chance: 0.5, lock: 0.4 }, ...fireExits(0.3)],
  };
}
function sciencehall(rng, o = {}) {
  const { bw, bh } = footOf(rng, "sciencehall", o), n = storeysOf(rng, "sciencehall", o);
  const teach = () => room("lab", "Teaching lab", "teachlab", { maxBoxes: 3 });
  const research = () => room("lab", "Research lab", "research", { maxBoxes: 3 });
  const prep = () => room("storage", "Prep room", "prep", { type: "lab", maxBoxes: 2 });
  const office = () => room("office", "Faculty office", "faculty", { type: "office", maxBoxes: 2 });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS,
    program: hallPlan([["*", teach()], [4, prep()], [7, room("lobby", "Lobby", "hallobby", { entry: true, type: "office", maxBoxes: 1 })], [3, restroom()], ["*", teach()]],
      [["*", research()], [5, room("storage", "Chemical store", "chemstore", { type: "lab", lock: ["door", 0.6], boxLock: ["drugs", 0.4], maxBoxes: 3, windows: false })], ["*", teach()], [4, office()]], 7),
    upper: () => hallPlan([["*", teach()], [4, prep()], [7, room("office", "Department office", "faculty", { type: "office", maxBoxes: 2 })], ["*", teach()]], [["*", research()], ["*", teach()], [4, office()], [3, restroom()]], 7),
    exits: [{ side: "back", roles: ["lab", "storage"], chance: 0.6, lock: 0.4 }, ...fireExits(0.3)],
  };
}
function univlibrary(rng, o = {}) {
  const { bw, bh } = footOf(rng, "univlibrary", o), n = storeysOf(rng, "univlibrary", o);
  const stacks = () => room("stock", "Stacks", "stacks", { type: "office", maxBoxes: 6, fl: "carpet" });
  const archive = (name) => room("storage", name, "archive", { type: "office", lock: ["door", 0.5], boxLock: ["safe", 0.15], maxBoxes: 3, windows: false });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS,
    program: hallPlan([["*", room("office", "Computer lab", "complab", { type: "office", maxBoxes: 3 })], [8, room("lobby", "Circulation desk", "circ", { entry: true, type: "office", maxBoxes: 2 })], [3, restroom()], ["*", room("office", "Reading room", "reading", { type: "office", maxBoxes: 2, fl: "carpet" })]],
      [["*", stacks()], ["*", stacks()], [6, archive("Archive")]], 7),
    upper: (f, r, ctx) => hallPlan([["*", room("office", "Study carrels", "carrels", { type: "office", maxBoxes: 3, fl: "carpet" })], [8, room("office", "Reading room", "reading", { type: "office", maxBoxes: 2, fl: "carpet" })], [3, restroom()], ["*", stacks()]],
      [["*", stacks()], ["*", stacks()], [6, ctx.top ? archive("Special collections") : room("office", "Group study", "study", { type: "office", maxBoxes: 2 })]], 7),
    exits: [{ side: "back", roles: ["storage", "stock"], chance: 0.4, lock: 0.5 }, ...fireExits(0.4)],
  };
}
function studentunion(rng, o = {}) {
  const { bw, bh } = footOf(rng, "studentunion", o), n = storeysOf(rng, "studentunion", o);
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS,
    program: hallPlan([["*", room("sales", "Campus bookstore", "bookstore", { type: "store", hub: false, maxBoxes: 6 })], [7, room("lobby", "Lobby", "hallobby", { entry: true, type: "office", maxBoxes: 1 })], ["*", room("dining", "Food court", "foodcourt", { type: "kitchen", maxBoxes: 3 })]],
      [["*", room("dayroom", "Games room", "games", { hub: false, type: "house", maxBoxes: 2 })], [4, room("office", "Club office", "faculty", { type: "office", maxBoxes: 2 })], [3, restroom()], [7, room("kitchen", "Kitchen", "kitchen", { maxBoxes: 3 })], [3, room("pantry", "Walk-in", "walkin", { type: "kitchen", dk: "steel", maxBoxes: 2 })]], 9),
    upper: () => hallPlan([["*", room("dining", "Ballroom", "ballroom", { type: "kitchen", maxBoxes: 2, fl: "hardwood" })], [6, room("dayroom", "Lounge", "lounge", { hub: false, type: "house", maxBoxes: 2 })]],
      [["*", room("office", "Club office", "faculty", { type: "office", maxBoxes: 2 })], ["*", room("office", "Student newspaper", "faculty", { type: "office", maxBoxes: 2 })], [4, room("storage", "Storeroom", "drystore", { type: "warehouse", maxBoxes: 2 })], [3, restroom()]], 9),
    exits: [{ side: "back", roles: ["kitchen", "pantry", "dayroom"], chance: 0.8, lock: 0.3 }, ...fireExits(0.3)],
  };
}
function dininghall(rng, o = {}) {
  const { bw, bh } = footOf(rng, "dininghall", o), n = storeysOf(rng, "dininghall", o);
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["cafeteria"], n: 1, len: 2 },
    program: { split: "y", parts: [["*", civ("cafeteria", "Dining room", "cafeteria", { entry: true, maxBoxes: 3 })],
      [4, { split: "x", parts: leaves([["*", room("kitchen", "Servery", "servery", { maxBoxes: 3 })], [5, room("kitchen", "Dish room", "dishroom", { maxBoxes: 1 })]]) }],
      [6, { split: "x", parts: leaves([["*", room("kitchen", "Kitchen", "kitchen", { maxBoxes: 3 })], [4, room("pantry", "Walk-in cooler", "walkin", { type: "kitchen", dk: "coldroom", maxBoxes: 2 })], [4, room("pantry", "Walk-in freezer", "freezerroom", { type: "kitchen", dk: "coldroom", maxBoxes: 3 })], [4, room("storage", "Dry store", "drystore", { type: "kitchen", maxBoxes: 3 })]]) }]] },
    upper: () => ({ split: "y", parts: [["*", room("dining", "Private dining room", "ballroom", { type: "kitchen", maxBoxes: 2 })], [5, { split: "x", parts: leaves([["*", room("office", "Catering office", "faculty", { type: "office", maxBoxes: 2 })], [4, room("storage", "Linen store", "drystore", { type: "house", maxBoxes: 2 })], [3, restroom()]]) }]] }),
    exits: [{ side: "back", roles: ["kitchen", "storage"], chance: 0.9, lock: 0.3, roller: true, width: 2, name: "Loading dock" }, { side: "left", roles: ["cafeteria"], chance: 0.6, lock: 0.3 }, { side: "right", roles: ["cafeteria"], chance: 0.6, lock: 0.3 }],
  };
}
function athletics(rng, o = {}) {
  const { bw, bh } = footOf(rng, "athletics", o);
  const lockers = (name) => civ("lockerroom", name, "plockers", { type: "lockers", maxBoxes: 3 });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "wide",
    program: hallPlan([["*", lockers("Men's locker room")], [5, room("office", "Coaches' office", "faculty", { type: "office", maxBoxes: 2 })], [8, room("lobby", "Lobby", "hallobby", { entry: true, type: "office", maxBoxes: 1 })], [5, room("storage", "Equipment room", "equipment", { type: "lockers", maxBoxes: 3 })], ["*", lockers("Women's locker room")]],
      [["*", room("gym", "Basketball court", "court", { maxBoxes: 1 })], [8, room("gym", "Weight room", "weights", { maxBoxes: 1 })], ["*", room("gym", "Pool hall", "pool", { maxBoxes: 1, fl: "tile" })]], 7),
    exits: [{ side: "back", roles: ["gym"], chance: 0.9, lock: 0.3 }, ...fireExits(0.3)],
  };
}
function admin(rng, o = {}) {
  const { bw, bh } = footOf(rng, "admin", o), n = storeysOf(rng, "admin", o);
  const office = (name) => room("office", name, "officefloor", { type: "office", maxBoxes: 3 });
  const records = () => room("storage", "Records", "records", { type: "office", lock: ["door", 0.3], maxBoxes: 3 });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS,
    program: hallPlan([["*", room("office", "Registrar", "registrar", { type: "office", maxBoxes: 3 })], [7, room("lobby", "Lobby", "adminlobby", { entry: true, type: "office", maxBoxes: 1 })], ["*", office("Admissions")]],
      [["*", office("Bursar")], [5, records()], [4, civ("breakroom", "Break room", "breakroom")], [3, restroom()]], 6),
    upper: (f, r, ctx) => (ctx.top
      ? hallPlan([["*", room("office", "President's office", "president", { type: "office", lock: ["door", 0.3], maxBoxes: 3 })], [7, room("office", "Boardroom", "boardroom", { type: "office", maxBoxes: 2 })], ["*", room("office", "Provost's office", "faculty", { type: "office", maxBoxes: 2 })]], [["*", office("Deans' offices")], [5, records()], [3, restroom()]], 6)
      : hallPlan([["*", office("Financial aid")], [7, office("Human resources")], ["*", office("Student affairs")]], [["*", office("Offices")], [5, records()], [3, restroom()]], 6)),
    exits: [{ side: "back", roles: ["breakroom", "storage"], chance: 0.5, lock: 0.4 }, ...fireExits(0.4)],
  };
}
function security(rng, o = {}) {
  const { bw, bh } = footOf(rng, "security", o);
  return {
    bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "small",
    program: hallPlan([["*", civ("lobby", "Front desk", "frontdesk", { entry: true, type: "office", maxBoxes: 1 })], [5, civ("office", "Dispatch", "dispatch", { maxBoxes: 2 })]],
      [["*", civ("office", "Officers' room", "squad", { maxBoxes: 2 })], [4, civ("lockerroom", "Locker room", "plockers", { type: "lockers", maxBoxes: 2 })], [4, room("armory", "Gun locker", "smallarmory", { lock: ["vault", 0.85], boxLock: ["cage", 0.4], dk: "steel", boxTarget: 3 })]], 5, 1),
    exits: [{ side: "back", roles: ["office", "lockerroom"], chance: 0.6, lock: 0.5 }],
  };
}
function maintenance(rng, o = {}) {
  const { bw, bh } = footOf(rng, "maintenance", o);
  const left = rng.chance(0.5);
  const bay = [0.45, room("bays", "Vehicle bay", "vehbay", { type: "garage", maxBoxes: 4 })];
  const rest = ["*", { split: "y", parts: [["*", { split: "x", parts: leaves([["*", room("workshop", "Tool room", "toolroom", { entry: true, hub: true, maxBoxes: 3 })], [5, room("office", "Foreman's office", "faculty", { type: "office", maxBoxes: 2 })]]) }],
    ["*", { split: "x", parts: leaves([["*", room("workshop", "Boiler room", "plantroom", { maxBoxes: 2 })], [5, room("storage", "Stores", "stores", { type: "warehouse", lock: ["door", 0.3], maxBoxes: 3 })]]) }]] }];
  return {
    bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "medium",
    program: { split: "x", parts: left ? [bay, rest] : [rest, bay] },
    exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Bay door" }, { side: "back", roles: ["workshop", "storage"], chance: 0.6, lock: 0.4 }],
  };
}
function theatre(rng, o = {}) {
  const { bw, bh } = footOf(rng, "theatre", o), n = storeysOf(rng, "theatre", o);
  const back = { split: "y", parts: leaves([["*", room("workshop", "Scene shop", "sceneshop", { maxBoxes: 2 })], ["*", room("dayroom", "Green room", "greenroom", { hub: false, type: "house", maxBoxes: 2 })]]) };
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["lobby", "corridor"], n: 1, len: 2 },
    program: hallPlan([[4, room("office", "Box office", "faculty", { type: "office", maxBoxes: 1 })], ["*", room("lobby", "Lobby", "hallobby", { entry: true, type: "office", maxBoxes: 1 })], [3, restroom()]],
      [["*", room("classroom", "Auditorium", "auditorium", { type: "office", maxBoxes: 1, fl: "carpet" })], [8, back]], 6),
    upper: () => hallPlan([["*", room("workshop", "Art studio", "artstudio", { type: "office", maxBoxes: 2 })], ["*", room("classroom", "Music room", "music", { type: "office", maxBoxes: 1 })]],
      [["*", room("classroom", "Rehearsal room", "music", { type: "office", maxBoxes: 1, fl: "hardwood" })], [6, room("office", "Drama office", "faculty", { type: "office", maxBoxes: 2 })]], 6),
    exits: [{ side: "back", roles: ["workshop", "dayroom"], chance: 0.8, lock: 0.3, roller: rng.chance(0.5), width: 2 }, ...fireExits(0.3)],
  };
}
function parkgarage(rng, o = {}) {
  const { bw, bh } = footOf(rng, "parkgarage", o), n = storeysOf(rng, "parkgarage", o);
  const deck = (f) => ({ split: "x", parts: [["*", room("bays", `Level ${f + 1}`, "deck", { type: "wreck", fl: "conc", maxBoxes: 14, entry: f === 0 })], [5, { split: "y", parts: leaves([[8, { role: "stairwell", name: "Stairs" }], ["*", room("storage", f === 0 ? "Pay booth" : "Utility room", "stores", { type: "garage", maxBoxes: 1 })]]) }]] });
  return {
    bw, bh, front: { width: 3 }, ground: "lot", storeys: n, foot: "wide", stairs: { roles: ["stairwell", "bays"], n: 2, len: 3 },
    program: deck(0), upper: (f) => deck(f),
    exits: [{ side: "back", roles: ["bays"], chance: 0.7, width: 3, lock: 0.1, name: "Exit ramp" }, { side: "left", roles: ["bays"], chance: 0.5, lock: 0.3 }],
  };
}
// key → plan maker; buildingmaps.js BUILDINGS makes each through it (chapel and healthcentre are the church's and the clinic's).
export const CAMPUS_PLANS = { dorm, lecturehall, sciencehall, univlibrary, studentunion, dininghall, athletics, admin, security, maintenance, theatre, parkgarage };
export const CAMPUS_NAMES = {
  dorm: "Residence hall", lecturehall: "Lecture hall", sciencehall: "Science building", univlibrary: "University library", studentunion: "Student union",
  dininghall: "Dining hall", athletics: "Athletics centre", admin: "Administration building", security: "Campus security", maintenance: "Maintenance building",
  theatre: "Theatre and arts building", parkgarage: "Parking garage", chapel: "Chapel", healthcentre: "Health centre",
};
// The building keys whose rooms take these styles (the health centre's by role: #14's MEDICAL_STYLES).
export const CAMPUS_KEYS = new Set([...Object.keys(CAMPUS_PLANS), "chapel", "healthcentre"]);

// ---------- the room styles ----------
/** @typedef {any} Lay */
const isLoot = (k) => !!(pieceDef(k) && pieceDef(k).loot);
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
// The cells along wall `side` inside the room.
function line(L, side) {
  const c = L.c, out = [];
  if (side === "n" || side === "s") { const y = side === "n" ? c.y0 : c.y1; for (let x = c.x0; x <= c.x1; x++) out.push([x, y]); }
  else { const x = side === "w" ? c.x0 : c.x1; for (let y = c.y0; y <= c.y1; y++) out.push([x, y]); }
  return out;
}
// The wall with no door in it, longest first: the wall a room's seats face.
function quietWall(L, salt = "") {
  const c = L.c, doors = L.room.doors || [];
  const doorOn = (side) => doors.some(([x, y]) => (side === "n" ? y === c.y0 - 1 : side === "s" ? y === c.y1 + 1 : side === "w" ? x === c.x0 - 1 : x === c.x1 + 1));
  const sides = ["n", "s", "w", "e"].map((s, i) => ({ s, len: s === "n" || s === "s" ? c.w : c.h, door: doorOn(s), j: hash01(c.seed, "cquiet", L.room.id, salt, i) }));
  sides.sort((a, b) => (a.door ? 1 : 0) - (b.door ? 1 : 0) || b.len - a.len || a.j - b.j);
  return sides[0].s;
}
// The screen or the whiteboard on the wall behind the middle of `side` (decor.js wall art), unless the map is bare.
function screen(L, side) {
  const c = L.c;
  if (!c.decor) return null;
  const [dx, dy] = D4[side];
  const cells = line(L, side).map((p, i, all) => [...p, Math.abs(i - (all.length - 1) / 2)]).sort((p, q) => p[2] - q[2]);
  for (const [x, y] of cells) {
    const wx = x + dx, wy = y + dy;
    if (c.kindAt(wx, wy) !== "wall" || c.ridAt(wx, wy) !== -1) continue;
    const cl = c.cell(wx, wy);
    if (cl.wart) continue;
    cl.wart = { k: "whiteboard", d: ART_D[side] };
    return [wx, wy];
  }
  return null;
}
// Pieces of k (w cells long along the wall) in rows facing the wall `side`, from `from` cells off it, every `step` rows,
// never on a lane. A lecture hall's seating, an auditorium's.
function seatRows(L, k, side, from = 2, step = CAMPUSL.SEAT_ROWS, most = 99) {
  const c = L.c, along = side === "n" || side === "s";
  const len = along ? c.w : c.h, depth = along ? c.h : c.w;
  const w = (pieceDef(k) || { size: [1, 1] }).size[0];
  let n = 0;
  for (let d = from; d < depth && n < most; d += step) {
    for (let a = 0; a + w <= len && n < most;) {
      const cells = [];
      for (let i = 0; i < w; i++) {
        const t = a + i;
        cells.push(along ? [c.x0 + t, side === "n" ? c.y0 + d : c.y1 - d] : [side === "w" ? c.x0 + d : c.x1 - d, c.y0 + t]);
      }
      if (L.place(k, cells, { face: side })) { n++; a += w; } else a++;
    }
  }
  return n;
}
function deskWithChair(L, opts = {}) {
  const d = L.wall("desk", P(L, opts)) || L.centre("desk", P(L, opts));
  if (d) L.around(d, "chair", 1);
  return d;
}
function tableSet(L, chairs = 4) {
  const t = L.centre("table");
  if (t) L.around(t, "chair", chairs);
  return t;
}
function some(L, k, n, opts = {}) { const out = []; for (let i = 0; i < n; i++) { const r = L.wall(k, isLoot(k) ? P(L, opts) : opts); if (!r) break; out.push(r); } return out; }
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
// A fixed piece that is its own locked container (the president's safe), as shoplayout.js's.
function lockedPiece(L, k, opts = {}) {
  const r = L.wall(k, { prefer: "corner", ...opts });
  if (!r) return null;
  const [x, y] = r.cells[0];
  L.c.unblock(x, y);
  const box = L.c.container(x, y, k, L.lane);
  if (box) box.lockKind = "safe"; else L.c.block(x, y, k);
  L.c.cell(x, y).fc = r.face;
  return box;
}
// A vehicle in the room off its lanes: placeCar through the room's tools (buildingmaps.js furnishCtx vehicle).
function vehicleAt(L, o) {
  const c = L.c, cands = [];
  const [w, h] = o.ax === "x" ? [o.len, 2] : [2, o.len];
  for (let y = c.y0; y + h - 1 <= c.y1; y++) for (let x = c.x0; x + w - 1 <= c.x1; x++) {
    let lane = 0, ok = true;
    for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w; xx++) { if (!c.free(xx, yy)) { ok = false; break; } if (L.lane(xx, yy)) lane++; }
    if (ok) cands.push({ x, y, s: lane * 6 + hash01(c.seed, "cveh", L.room.id, x, y) });
  }
  cands.sort((a, b) => a.s - b.s);
  for (const cd of cands.slice(0, 16)) { const r = c.vehicle(cd.x, cd.y, o); if (r) return r; }
  return null;
}
// A kitchenette's run along a wall: the fridge, a counter, the microwave, the sink.
function kitchenette(L) {
  const ws = L.walls();
  L.run(["fridge", "counter", "microwave", "sink"], ws.length ? [ws[ws.length > 1 ? 1 : 0].side] : ["n"], { plain: () => full(L) });
}

/** @type {Record<string, (L: Lay) => void>} */
export const CAMPUS_STYLES = {
  // ---------- residence halls ----------
  // A double: a bed, a desk and a wardrobe for each of the two, a mini fridge, a chair; the desks, a wardrobe and the
  // fridge searched (CAMPUSL.DORM_BOXES), the rest plain. A suite's bedroom: the same, for one or two.
  dormroom(L) {
    const b1 = L.wall("bed", { prefer: "corner" }) || L.need("bed", { size: [1, 2] });
    const b2 = L.c.w * L.c.h >= 16 ? L.wall("bed", { prefer: "corner", far: b1 ? b1.cells[0] : undefined }) : null;
    for (const bed of [b1, b2]) if (bed) L.beside(bed, "dormdesk", P(L)) || L.wall("dormdesk", P(L, { near: bed.cells[0] }));
    L.wall("minifridge", P(L, { prefer: "corner" }));
    for (const bed of [b1, b2]) if (bed) L.wall("wardrobe", P(L, { prefer: "corner", near: bed.cells[0] }));
    L.wall("chair", { prefer: "middle" });
    if (!L.has("dormdesk")) L.need("dormdesk");
  },
  // The RA's room: one bed, a desk, a wardrobe, a bookshelf, the fridge (their notes: interiorscenes, dormbarricade).
  raroom(L) {
    const bed = L.wall("bed", { prefer: "corner" }) || L.need("bed", { size: [1, 2] });
    if (bed) L.beside(bed, "dormdesk", P(L)) || L.wall("dormdesk", P(L));
    L.wall("wardrobe", P(L, { prefer: "corner" }));
    L.wall("minifridge", P(L));
    L.wall("bookshelf", P(L, { prefer: "corner" }));
  },
  // A floor's lounge: the TV with a sofa facing it, an armchair, a kitchenette (a fridge, the microwave, a sink), a table.
  lounge(L) {
    const tv = L.wall("tvstand", P(L, { prefer: "middle" }));
    const sofa = (tv && L.facing(tv, "sofa")) || L.wall("sofa", { prefer: "middle" });
    L.centre("armchair", sofa ? { near: sofa.cells[0] } : {}) || L.wall("armchair", { prefer: "corner" });
    kitchenette(L);
    if (!L.has("microwave")) L.wall("microwave");
    tableSet(L, 3);
    L.wall("vending", P(L, { prefer: "corner" }));
  },
  // The shared bathroom: shower stalls along one wall, toilets along another, the sinks, a medicine cabinet.
  dormbath(L) {
    const ws = L.walls();
    const n = Math.max(1, Math.min(4, Math.floor(Math.max(L.c.w, L.c.h) / 2)));
    some(L, "shower", n, ws[0] ? { sides: [ws[0].side] } : {});
    some(L, "toilet", n, ws[1] ? { sides: [ws[1].side] } : {});
    if (!L.has("toilet")) L.need("toilet", { prefer: "corner" });
    some(L, "sink", 2, ws[2] ? { sides: [ws[2].side] } : {});
    if (!L.has("sink")) L.need("sink");
    fill(L, ["medcab"]);
  },
  // The front desk: its counter and chair, the wall of mailboxes, a sofa and chairs for the waiting.
  dormlobby(L) {
    const back = quietWall(L, "desk");
    const desk = L.wall("counter", P(L, { sides: [back], prefer: "middle" }));
    if (desk) L.around(desk, "chair", 1);
    const side = L.walls().find((w) => w.side !== back);
    some(L, "mailboxes", 3, side ? { sides: [side.side] } : {});
    L.wall("sofa", { prefer: "middle" });
    L.wall("chair", { prefer: "corner" });
  },
  // A suite's common room: a sofa and the TV, a table, the fridge and a microwave.
  suitecommon(L) {
    const tv = L.wall("tvstand", P(L, { prefer: "middle" }));
    if (!(tv && L.facing(tv, "sofa"))) L.wall("sofa", { prefer: "middle" });
    L.wall("minifridge", P(L, { prefer: "corner" }));
    L.wall("microwave", { prefer: "corner" });
    tableSet(L, 2);
  },
  // A study room: tables with chairs, carrels along the walls, a bookshelf.
  study(L) {
    some(L, "carrel", 3);
    tableSet(L, 4);
    L.wall("bookshelf", P(L, { prefer: "corner" }));
  },
  // ---------- teaching ----------
  // A lecture hall: the lectern and the screen on the wall with no door, rows of fixed seating facing them every other
  // row (the tiers drawn flat: floor heights change only at the stairs), a cabinet.
  lecture(L) {
    const side = quietWall(L, "lecture");
    L.wall("lectern", { sides: [side], prefer: "middle" }) || L.wall("lectern", { prefer: "middle" });
    screen(L, side);
    if (!seatRows(L, "lectureseat", side, 2)) L.need("lectureseat", { face: side });
    fill(L, ["cabinet"]);
  },
  // A faculty office: a desk and its chair, bookshelves, a filing cabinet, a visitor's chair.
  faculty(L) {
    deskWithChair(L) || L.need("desk");
    L.wall("bookshelf", P(L, { prefer: "corner" }));
    fill(L, ["filing", "bookshelf"]);
    L.wall("chair", { prefer: "corner" });
  },
  // A lobby: a reception counter, chairs, a notice board (decor).
  hallobby(L) {
    const back = quietWall(L, "desk");
    const desk = L.wall("counter", P(L, { sides: [back], prefer: "middle" }));
    if (desk) L.around(desk, "chair", 1);
    L.run(["chair", "chair", "chair"], [OPP[back]]);
    L.wall("vending", P(L, { prefer: "corner" }));
  },
  // A teaching lab: fume hoods and a sink on the quiet wall, the whiteboard, lab benches in the middle, cabinets.
  teachlab(L) {
    const side = quietWall(L, "lab");
    some(L, "fumehood", 2, { sides: [side], prefer: "corner" });
    L.wall("sink", { sides: [side] }) || L.wall("sink");
    screen(L, side);
    for (let i = 0; i < 4; i++) if (!L.centre("labbench", P(L))) break;
    if (!L.has("labbench")) L.need("labbench");
    fill(L, ["cabinet"]);
  },
  // A research lab: a bench, the chest freezers (#19's freezer rules: a winter's cold keeps them), a server rack, a
  // fume hood, cabinets.
  research(L) {
    const nf = hash01(L.c.seed, "freezers", L.room.id) < 0.5 ? CAMPUSL.FREEZERS[0] : CAMPUSL.FREEZERS[1];
    some(L, "freezer", nf, { prefer: "corner" });
    L.wall("fumehood", { prefer: "corner" });
    L.wall("serverrack", P(L, { prefer: "corner" }));
    L.centre("labbench", P(L)) || L.wall("labbench", P(L));
    L.wall("monitor");
    fill(L, ["cabinet"]);
  },
  // The chemical store (locked): shelves and cabinets of reagents (meds and parts: the game has no chemicals).
  chemstore(L) { fill(L, ["shelf", "cabinet"]); },
  // The prep room: a counter run with the sink and a fridge, shelves.
  prep(L) {
    const ws = L.walls();
    L.run(["sink", "counter", "fridge"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    fill(L, ["shelf", "cabinet"]);
  },
  // A computer lab: desks in rows with their chairs, a server rack in a corner.
  complab(L) {
    L.wall("serverrack", P(L, { prefer: "corner" }));
    for (let i = 0; i < 6; i++) if (!deskWithChair(L)) break;
    L.wall("copier", { prefer: "corner" });
  },
  // Study carrels along the walls, a bookshelf.
  carrels(L) {
    some(L, "carrel", 8);
    for (const p of L.placed.filter((q) => q.k === "carrel").slice(0, 4)) L.beside(p, "chair");
    fill(L, ["bookshelf"]);
  },
  // The archive: filing cabinets and shelves.
  archive(L) { fill(L, ["filing", "shelf", "filing"]); },
  // ---------- the student union ----------
  // A games room: the pool table, a TV and a sofa, a card table, the vending machine.
  games(L) {
    L.centre("pooltable");
    const tv = L.wall("tvstand", P(L, { prefer: "middle" }));
    if (!(tv && L.facing(tv, "sofa"))) L.wall("sofa", { prefer: "middle" });
    tableSet(L, 4);
    L.wall("vending", P(L, { prefer: "corner" }));
    L.wall("jukebox", { prefer: "corner" });
  },
  // A ballroom or an event hall: round tables with chairs, a piano, a lectern, chairs stacked along a wall.
  ballroom(L) {
    const n = Math.max(1, Math.min(6, Math.floor((L.c.w * L.c.h) / 18)));
    for (let i = 0; i < n; i++) if (!tableSet(L, 4)) break;
    L.wall("piano", { prefer: "corner" });
    L.wall("lectern", { prefer: "middle" });
    fill(L, ["cabinet"]);
  },
  // ---------- the dining hall ----------
  // The servery: a counter run with cold cases and display cases, the trays' cabinet.
  servery(L) {
    const ws = L.walls();
    L.run(["counter", "coldcase", "counter", "displaycase", "counter"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    fill(L, ["cabinet", "coldcase"]);
  },
  // The dish room: the sinks, a dishwasher, shelves.
  dishroom(L) {
    const ws = L.walls();
    L.run(["sink", "dishwasher", "sink"], ws.length ? [ws[0].side] : ["n"]);
    fill(L, ["shelf"]);
  },
  // The walk-in freezer: chest freezers in rows (#19), shelves.
  freezerroom(L) {
    some(L, "freezer", 3, { prefer: "corner" });
    fill(L, ["coldshelf", "freezer"]);
  },
  // A dry store: shelves.
  drystore(L) { fill(L, ["shelf", "rack"]); },
  // ---------- athletics ----------
  // The equipment room: storage cages of bats, sticks and pads (combat.js BOX_LOOT sportcage: melee weapons).
  equipment(L) { fill(L, ["sportcage"]); if (!L.has("sportcage")) L.need("sportcage"); },
  // The basketball court: bleachers along both long walls, a storage cage.
  court(L) {
    const c = L.c, sides = c.w >= c.h ? ["n", "s"] : ["w", "e"];
    for (const s of sides) for (let i = 0; i < 4; i++) if (!L.wall("bleachers", { sides: [s] })) break;
    fill(L, ["sportcage"]);
  },
  // The pool hall: the pool drained (its tiles blue, a cell in from the walls, fl "pool": walked in), benches round it.
  pool(L) {
    const c = L.c;
    for (let y = c.y0 + 2; y <= c.y1 - 2; y++) for (let x = c.x0 + 2; x <= c.x1 - 2; x++) { const cl = c.cell(x, y); if (cl.k === "open" && !L.lane(x, y)) cl.fl = "pool"; }
    some(L, "campusbench", 2);
    fill(L, ["locker"]);
  },
  // The weight room: weight benches, a rack of plates.
  weights(L) {
    for (let i = 0; i < 4; i++) if (!L.centre("weightbench") && !L.wall("weightbench")) break;
    fill(L, ["rack", "locker"]);
  },
  // ---------- the theatre ----------
  // The auditorium: the stage along the quiet wall (its boards), the piano and a lectern on it, seating facing it.
  auditorium(L) {
    const c = L.c, side = quietWall(L, "stage");
    const along = side === "n" || side === "s";
    for (const [x, y] of line(L, side)) for (let d = 0; d < 3; d++) {
      const [dx, dy] = D4[OPP[side]], px = x + dx * d, py = y + dy * d;
      if (px >= c.x0 && px <= c.x1 && py >= c.y0 && py <= c.y1 && c.cell(px, py).k === "open") c.cell(px, py).fl = "hardwood";
    }
    L.wall("piano", { sides: [side], prefer: "corner" });
    L.wall("lectern", { sides: [side], prefer: "middle" });
    if (!seatRows(L, "lectureseat", side, along ? 4 : 4)) L.need("lectureseat", { face: side });
    fill(L, ["cabinet"]);
  },
  greenroom(L) {
    L.wall("wardrobe", P(L, { prefer: "corner" }));
    L.wall("clothesrack", P(L, { prefer: "corner" }));
    L.wall("dresser", P(L));
    L.wall("sofa", { prefer: "middle" });
  },
  sceneshop(L) {
    const bench = L.wall("workbench", P(L, { prefer: "corner" })) || L.need("workbench");
    if (bench) L.beside(bench, "toolchest", P(L));
    fill(L, ["shelf", "crate"]);
  },
  artstudio(L) {
    L.wall("sink", { prefer: "corner" });
    for (let i = 0; i < 3; i++) if (!tableSet(L, 2)) break;
    fill(L, ["shelf", "cabinet"]);
  },
  music(L) {
    const side = quietWall(L, "music");
    L.wall("piano", { sides: [side], prefer: "middle" }) || L.wall("piano");
    seatRows(L, "chair", side, 3, 2, 10);
    fill(L, ["cabinet"]);
  },
  // ---------- the parking garage ----------
  // A level: cars in stalls along the walls and down the middle (each a container: AREAS.wreck), the lanes clear.
  deck(L) {
    const c = L.c, horiz = c.w >= c.h;
    const want = Math.max(1, Math.floor((c.w * c.h) / 30));
    let n = 0;
    for (let t = 0; t < want * 2 && n < want; t++) if (vehicleAt(L, { kind: "car", len: 4, ax: horiz ? "y" : "x", box: "car" })) n++; else break;
  },
  // ---------- the physical plant ----------
  vehbay(L) {
    vehicleAt(L, { kind: "truck", len: 5, ax: "y", box: "maintruck" }) || vehicleAt(L, { kind: "truck", len: 5, ax: "x", box: "maintruck" });
    const bench = L.wall("workbench", P(L, { prefer: "corner" }));
    if (bench) L.beside(bench, "toolchest", P(L));
    L.wall("compressor", { prefer: "corner" });
    fill(L, ["tirerack", "shelf"]);
  },
  toolroom(L) {
    const bench = L.wall("workbench", P(L, { prefer: "corner" })) || L.need("workbench");
    if (bench) L.beside(bench, "toolchest", P(L));
    fill(L, ["toolchest", "shelf"]);
  },
  plantroom(L) {
    some(L, "boiler", 2, { prefer: "corner" });
    L.wall("waterheater", { prefer: "corner" });
    L.wall("compressor", { prefer: "corner" });
    fill(L, ["toolchest"]);
  },
  stores(L) { fill(L, ["shelf", "crate"]); },
  // ---------- campus security ----------
  // A small armory: a gun rack, an ammo cabinet, a locker (the gun safe may take it: locks.js placeGunSafes).
  smallarmory(L) {
    L.wall("gunrack", { prefer: "corner" });
    L.wall("ammocab", { prefer: "corner" });
    L.wall("locker", { prefer: "corner" });
  },
  // ---------- administration ----------
  // The registrar: the counter across the room with queue posts before it, filing behind, desks.
  registrar(L) {
    const back = quietWall(L, "reg");
    L.run(["counter", "counter", "counter"], [back], { plain: () => full(L) });
    for (const p of L.placed.filter((q) => q.k === "counter").slice(0, 3)) L.facing(p, "stanchion");
    fill(L, ["filing", "desk"]);
  },
  // The president's office: the desk, bookshelves, a sofa and an armchair, the safe (locked: its own container).
  president(L) {
    deskWithChair(L) || L.need("desk");
    lockedPiece(L, "safe");
    L.wall("bookshelf", P(L, { prefer: "corner" }));
    L.wall("sofa", { prefer: "middle" });
    L.wall("armchair", { prefer: "corner" });
    fill(L, ["cabinet", "bookshelf"]);
  },
  // The boardroom: a long table with chairs round it, the screen.
  boardroom(L) {
    const c = L.c, n = Math.max(2, Math.min(5, Math.max(c.w, c.h) - 3)), horiz = c.w >= c.h;
    const [mx, my] = [Math.floor((c.x0 + c.x1) / 2), Math.floor((c.y0 + c.y1) / 2)], cells = [];
    for (let i = 0; i < n; i++) { const x = horiz ? mx - Math.floor(n / 2) + i : mx, y = horiz ? my : my - Math.floor(n / 2) + i; if (L.place("table", [[x, y]])) cells.push([x, y]); }
    if (cells.length) L.around({ k: "table", cells, face: null, side: null, box: null }, "chair", cells.length * 2);
    screen(L, quietWall(L, "board"));
    fill(L, ["cabinet"]);
  },
  // ---------- borrowed: #16's shops, offices and the library's rooms ----------
  laundry: (L) => COMMERCIAL_STYLES.laundry(L),
  circ: (L) => COMMERCIAL_STYLES.circulation(L),
  reading: (L) => COMMERCIAL_STYLES.reading(L),
  stacks: (L) => COMMERCIAL_STYLES.stacks(L),
  bookstore: (L) => COMMERCIAL_STYLES.bookfront(L),
  foodcourt: (L) => COMMERCIAL_STYLES.dining(L),
  kitchen: (L) => COMMERCIAL_STYLES.galley(L),
  walkin: (L) => COMMERCIAL_STYLES.walkin(L),
  officefloor: (L) => COMMERCIAL_STYLES.officefloor(L),
  records: (L) => COMMERCIAL_STYLES.records(L),
  adminlobby: (L) => COMMERCIAL_STYLES.officelobby(L),
};

// The campus style for a room (buildingmaps.js assemble): its plan leaf's campus mark; the health centre's rooms by
// role (#14's clinic). null: the room keeps the other styles (a civic mark: civiclayout.js) or buildingmaps.js FURNISH.
/** @param {any} r @param {string | undefined} key */
export function campusStyle(r, key) {
  if (r && r.campus && CAMPUS_STYLES[r.campus]) return CAMPUS_STYLES[r.campus];
  if (key === "healthcentre" && r && MEDICAL_STYLES[r.role]) return MEDICAL_STYLES[r.role];
  return null;
}

// ======================================================================================
// The campus buildings' signs of survival (interiorscenes.js registerScene, issue #11's hook; their own dice there):
//   dormbarricade  students barricaded on a dorm's upper floor: the floor's stair run blocked with furniture (on its
//                  landing and the cells round it), the RA's last notes in their room (a ground pile), and the ones who
//                  held it: alive (floorfolk.js's survivors take the floor's rooms first: area.scene.alive) or bodies;
//   lectureshelter a lecture hall used as a shelter: cots between the rows, a water barrel, the ones who never left;
//   diningoverrun  the dining hall overrun: its tables and chairs knocked about, blood, 4–8 of the dead on the floor and
//                  a student's body by the servery;
//   sealedlab      a lab sealed from inside: its door boarded up, a bench shoved against it, a researcher dead inside
//                  with their notes, now and then one of the dead that will rise (a Sleeper);
//   quarantine     (campus.js, on the quad: an outdoor scene) a quarantine tent: tents, cots in rows, bodies.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const campusRooms = (ctx, style) => ctx.rng.shuffle(ctx.rooms.filter((r) => r.campus === style && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").replace(/ \d+$/, "").replace(/,.*$/, "").toLowerCase();
function dormBarricade(ctx) {
  const { rng, map } = ctx;
  const runs = (map.runs || []).filter((r) => !r.single);
  for (const ra of rng.shuffle(ctx.rooms.filter((r) => r.campus === "raroom" && (r.f || 0) > 0 && !r.scene))) {
    const f = ra.f || 0;
    // The stair run that reaches this floor nearest the RA's room: its top landing and the free cells round it get the pieces.
    const run = runs.filter((r) => r.f1 >= f && r.f0 < f).sort((a, b) => Math.hypot(a.x - ra.x0, a.y - ra.y0) - Math.hypot(b.x - ra.x0, b.y - ra.y0))[0];
    if (!run) continue;
    const steps = [];
    for (let i = 0; i < run.len; i++) steps.push([run.x + i * run.dx, run.y + i * run.dy]);
    const top = steps[steps.length - 1], land = [top[0] + run.dx, top[1] + run.dy];
    const spots = [land, ...NEXT4.map(([dx, dy]) => [land[0] + dx, land[1] + dy])].filter(([x, y]) => { const c = ctx.at(f, x, y); return c && c.k === "open" && !ctx.used(f, x, y) && !steps.some(([sx, sy]) => sx === x && sy === y); });
    if (!spots.length) continue;
    const ks = ["desk", "dormdesk", "chair", "wardrobe", "bed", "mailboxes", "sofa"].filter((k) => pieceDef(k) && pieceDef(k).carry !== "fixed");
    let n = 0;
    // A piece on the landing and the cells beside it: the way down shut (the dead crawl over half cover, the living vault it).
    for (const [x, y] of spots.slice(0, 3)) { ctx.piece(f, x, y, rng.pick(ks.filter((k) => pieceDef(k).cell.cover === 1)) || "chair"); n++; }
    const free = ctx.freeIn(ra);
    if (!free.length) continue;
    const [nx, ny] = rng.pick(free);
    ctx.pile(f, nx, ny, "The RA's last notes: a list of names, most of them crossed out", rng.chance(0.5) ? { food: 1 } : {}, ra.id);
    const alive = rng.chance(SCENES.ALIVE + 0.2);
    if (!alive) {
      const rooms = ctx.rooms.filter((r) => (r.f || 0) === f && r.campus === "dormroom" && !r.scene);
      for (const r of rng.shuffle(rooms).slice(0, rng.int(1, 2))) { const c = rng.pick(ctx.freeIn(r)); if (c) { ctx.body(f, c[0], c[1], { human: true, quiet: rng.chance(0.5) }); ctx.splatter(f, c[0], c[1], "human", 1); } }
    }
    return ctx.done("dormbarricade", ra, land[0], land[1], `Students barricaded floor ${f + 1}: ${n} pieces of furniture jammed at the top of the stairs. The RA left notes.`, alive ? { alive: true } : {});
  }
  return null;
}
function lectureShelter(ctx) {
  const { rng } = ctx;
  for (const r of campusRooms(ctx, "lecture")) {
    const f = r.f || 0;
    const free = ctx.freeIn(r).filter(([x, y]) => NEXT4.every(([ox, oy]) => { const c = ctx.at(f, x + ox, y + oy); return c && c.k !== "stairs"; }));
    if (free.length < 6) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(4, 9));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    if (!left.length) continue;
    const [bx, by] = rng.pick(left);
    ctx.piece(f, bx, by, "barrel");
    const near = ctx.freeIn(r);
    const n = Math.min(near.length, rng.int(2, 4));
    for (const [x, y] of rng.shuffle(near).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.6) });
    const p = ctx.freeIn(r)[0];
    if (p) ctx.pile(f, p[0], p[1], "Water bottles and a box of granola bars", { water: rng.int(1, 2), food: 1 }, r.id);
    return ctx.done("lectureshelter", r, bx, by, `The ${lower(r)} was a shelter: cots between the rows of seats, and ${n === 1 ? "one who never left" : `${n} who never left`}.`);
  }
  return null;
}
function diningOverrun(ctx) {
  const { rng } = ctx;
  for (const r of ctx.rng.shuffle(ctx.rooms.filter((q) => q.civic === "cafeteria" && !q.scene && (q.f || 0) === 0))) {
    const f = r.f || 0;
    const inner = ctx.inner(r);
    const pieces = inner.filter(([x, y]) => { const c = ctx.at(f, x, y); return c && (c.k === "table" || c.k === "chair"); });
    for (const [x, y] of rng.shuffle(pieces).slice(0, rng.int(2, 5))) { const c = ctx.at(f, x, y); c.moved = true; ctx.blood(f, x + 1, y, "human", 1); }
    const free = ctx.freeIn(r);
    if (free.length < 8) continue;
    const dead = rng.int(4, 8);
    for (const [x, y] of rng.shuffle(free).slice(0, dead)) { ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", rng.int(1, 2)); }
    const left = ctx.freeIn(r);
    if (left.length) { const [x, y] = left[0]; ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", 3); }
    return ctx.done("diningoverrun", r, free[0][0], free[0][1], `The dining room was overrun at a mealtime: tables knocked about, ${dead} of the dead on the floor.`);
  }
  return null;
}
function sealedLab(ctx) {
  const { rng } = ctx;
  for (const r of ctx.rng.shuffle(ctx.rooms.filter((q) => (q.campus === "research" || q.campus === "teachlab") && !q.scene && !q.locked && (q.doors || []).length === 1))) {
    const f = r.f || 0, [dx, dy] = r.doors[0];
    const door = ctx.at(f, dx, dy);
    if (!door || !["idoor", "odoor"].includes(door.k) || ctx.exit(dx, dy, f)) continue;
    const inn = NEXT4.map(([ox, oy]) => [dx + ox, dy + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
    if (!inn) continue;
    const free = ctx.freeIn(r).filter(([x, y]) => x !== inn[0] || y !== inn[1]);
    if (free.length < 3) continue;
    delete door.blood;
    door.k = "idoor";
    boardCell({ units: [], losCache: { fill() {} } }, door, dx, dy);
    ctx.take(f, dx, dy);
    ctx.out.pieces.push({ f, x: dx, y: dy, k: "boarded" });
    const ic = ctx.at(f, inn[0], inn[1]);
    if (ic && ic.k === "open" && !ctx.stair(inn[0], inn[1])) ctx.piece(f, inn[0], inn[1], "table");
    const far = nearest(free, dx, dy).reverse();
    const [bx, by] = far[0];
    const turned = rng.chance(0.35);
    ctx.body(f, bx, by, turned ? { sleeper: true } : { human: true, quiet: true });
    if (far[1]) ctx.pile(f, far[1][0], far[1][1], "A researcher's notebook: dates, doses, then nothing", { meds: rng.int(0, 1) }, r.id);
    return ctx.done("sealedlab", r, dx, dy, `The ${lower(r)} was sealed from inside: the door boarded over${turned ? ", and something moves behind it" : ""}.`);
  }
  return null;
}
const has = (style) => (ctx) => ctx.rooms.some((r) => r.campus === style);
registerScene("dormbarricade", { w: 4, place: dormBarricade, kinds: ["dorm"], when: has("raroom") });
registerScene("lectureshelter", { w: 3, place: lectureShelter, kinds: ["lecturehall"], when: has("lecture") });
registerScene("diningoverrun", { w: 4, place: diningOverrun, kinds: ["dininghall"], when: (ctx) => ctx.rooms.some((r) => r.civic === "cafeteria") });
registerScene("sealedlab", { w: 3, place: sealedLab, kinds: ["sciencehall"], when: (ctx) => ctx.rooms.some((r) => r.campus === "research" || r.campus === "teachlab") });
